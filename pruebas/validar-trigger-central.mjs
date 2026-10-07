// ============================================================================
// VALIDADOR DE PRE-VUELO para sql/tablas_fijas_sincronizar_central.sql
//
// Mismo criterio que validar-marcas-ddl.mjs: este SQL se aplica A MANO en el SQL
// Editor y nunca pasa por PostgreSQL antes de que esteakes en produccion.
//
// Un trigger roto no da error al aplicarse: da error DESPUES, en el primer
// INSERT a `tablas_fijas`, o sea con la caja abierta. Lo que mas se paga aqui:
//
//   1) Parentesis y delimitadores $$ desbalanceados -> Postgres se come el resto
//      del script y no instala NADA, sin dejar rastro.
//   2) Columnas que NO existen en resultados_carreras segun el DDL del repo.
//      Inventar una columna (`estado_tabla`, `retirado`) es el fallo clasico de
//      este tipo de script y revienta en tiempo de ejecucion, no de compilacion.
//   3) Que el trigger pise resultados de liquidacion. Si alguna vez actualiza
//      `ganadores` o `aplicado_a_tablas`, deja de liquidar bien y no hay prueba
//      que lo note: el resultado se ve mal, mucho despues.
//   4) Que NO escuche cambios de `fecha`. Sin `update of fecha`, mover una tabla
//      de dia reordenaria la oferta sin actualizar el central: exactamente como
//      se parto la jornada del 04-10-2026.
//   5) Que la guarda de columnas este ANTES del `create trigger`.
// ============================================================================
import { readFileSync, readdirSync } from "node:fs";

const RUTA_SQL = "sql/tablas_fijas_sincronizar_central.sql";

let pasan = 0;
const fallas = [];
const ok = (n, d = "") => { pasan++; console.log(`  ok    ${n}${d ? "  " + d : ""}`); };
const falla = (n, d) => { fallas.push(`${n}: ${d}`); console.log(`  FALLA ${n}\n        ${d}`); };
const check = (n, cond, d = "") => (cond ? ok(n, d) : falla(n, d || "condicion falsa"));

let sql = "";
try {
  sql = readFileSync(RUTA_SQL, "utf8");
} catch (e) {
  console.log(`  FALLA no se pudo leer ${RUTA_SQL}: ${e.message}`);
  console.log(`\nHAY FALLAS: 0 ok, 1 fallas\n`);
  process.exit(1);
}

console.log(`\nValidando ${RUTA_SQL}...`);

// ---------------------------------------------------------------------------
// El archivo existe y es idempotente
// ---------------------------------------------------------------------------
check("el script existe y no esta vacio", sql.trim().length > 0);
check(
  "usa CREATE OR REPLACE (reaplicable)",
  /create\s+or\s+replace\s+function\s+public\.tgf_tablas_fijas_sincronizar_central/i.test(sql)
);
check(
  "el trigger se puede reinstalar (DROP IF EXISTS)",
  /drop\s+trigger\s+if\s+exists\s+trg_tablas_fijas_central/i.test(sql)
);

// ---------------------------------------------------------------------------
// 1) Delimitadores balanceados
// ---------------------------------------------------------------------------
{
  const dollars = (sql.match(/\$\$/g) || []).length;
  check(
    "los delimitadores $$ estan balanceados",
    dollars % 2 === 0,
    `se encontraron ${dollars} marcas $$`
  );
  const abre = (sql.match(/\bbegin\b/gi) || []).length;
  // Los bloques terminan en `end;` (la funcion) o en `end $$;` (los bloques DO).
  // Buscar solo `end;` daria un falso negativo en cuanto hay dos bloques DO.
  const cierra = (sql.match(/\bend\b\s*(?:;|\$\$)/gi) || []).length;
  check(
    "cada BEGIN tiene su END",
    abre === cierra,
    `begin=${abre}, end=${cierra}`
  );
  // balance de parentesis dentro del cuerpo de la funcion
  const cuerpo = sql.slice(sql.toLowerCase().indexOf("as $$"), sql.toLowerCase().lastIndexOf("$$"));
  const pa = (cuerpo.match(/\(/g) || []).length;
  const pc = (cuerpo.match(/\)/g) || []).length;
  check("los parentesis del cuerpo de la funcion balancean", pa === pc, `( = ${pa}, ) = ${pc}`);
}

// ---------------------------------------------------------------------------
// 2) Solo columnas que EXISTEN en resultados_carreras
// ---------------------------------------------------------------------------
{
  // El DDL de `resultados_carreras` no esta siempre en el mismo archivo (se ha
  // movido entre migraciones), asi que se busca en TODOS los .sql del repo. Si
  // un dia se declara en otro sitio (un dump, por ejemplo) esto avisa en vez de
  // dar un "ok" falso.
  const ddl = readdirSync("sql")
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(`sql/${f}`, "utf8"))
    .join("\n");

  const conocidas = new Set([
    "fecha", "hipodromo", "carrera", "ganadores", "retirados", "premio_oficial",
    "premio_recalculado", "detalle", "aplicado_a_tablas", "cargado_por",
    "created_at", "updated_at", "dividendos", "orden_llegada", "caballos",
    "distancia", "superficie", "premio", "hora", "id",
  ]);

  // Extraer la lista de columnas del INSERT del trigger.
  const m = sql.match(/insert\s+into\s+public\.resultados_carreras\s*\(([^)]+)\)/i);
  check("el trigger hace INSERT en resultados_carreras", !!m);
  if (m) {
    const cols = m[1]
      .split(",")
      .map((c) => c.trim().toLowerCase())
      .filter(Boolean);
    const inventadas = cols.filter((c) => !conocidas.has(c));
    check(
      "el INSERT no usa columnas inventadas",
      inventadas.length === 0,
      inventadas.length ? `inexistentes: ${inventadas.join(", ")}` : `${cols.length} columnas`
    );
    // Las columnas de la lista deben aparecer en el DDL del repo. Se reporta
    // CUALES faltan en vez de un si/no, para poder corregir sin abrir el SQL.
    const noDeclaradas = cols.filter((c) => c !== "id" && !new RegExp(`\\b${c}\\b`).test(ddl));
    check(
      "el DDL del repo declara las columnas usadas",
      noDeclaradas.length === 0,
      noDeclaradas.length
        ? `ningun .sql de sql/ declara: ${noDeclaradas.join(", ")}`
        : `${cols.length} columnas verificadas en sql/*.sql`
    );
  }

  // La tabla destino (tablas_fijas) debe existir y traer estas columnas.
  const fuente = sql.match(/on\s+public\.tablas_fijas[\s\S]*?for\s+each\s+row/i);
  check("el trigger esta sobre tablas_fijas", !!fuente);
  const colsFuente = [
    "fecha", "hipodromo", "carrera", "caballos",
    "distancia_carrera", "superficie", "premio_original", "retirados_oficiales",
  ];
  const faltanFuente = colsFuente.filter((c) => !new RegExp(`new\\.${c}\\b`).test(sql));
  check(
    "el cuerpo lee las columnas que necesita de la fila nueva",
    faltanFuente.length === 0,
    faltanFuente.length ? `no leidas: ${faltanFuente.join(", ")}` : `${colsFuente.length} columnas`
  );
}

// ---------------------------------------------------------------------------
// 3) No toca resultados de liquidacion
// ---------------------------------------------------------------------------
{
  // Entre `do update` y `set` hay comentarios de bloque. Un `[\s\S]*?` corto
  // se corta antes del `set` y daria un falso negativo sobre un SQL correcto.
  const setMatch = sql.match(/do\s+update[\s\S]{0,600}?\bset\b([\s\S]*?)where\s+resultados_carreras\.ganadores/i);
  check(
    "el ON CONFLICT tiene una clausula WHERE que protege la liquidacion",
    !!setMatch,
    setMatch ? "" : "no se encontro `on conflict ... do update set ... where resultados_carreras.ganadores`"
  );

  const cuerpo = setMatch ? setMatch[1] : "";
  for (const prohibido of ["ganadores", "premio_recalculado", "detalle", "dividendos", "orden_llegada", "aplicado_a_tablas", "premio_oficial"]) {
    check(
      `el SET del ON CONFLICT NO actualiza ${prohibido}`,
      !new RegExp(`^\\s*${prohibido}\\s*=`, "im").test(cuerpo),
      "si lo actualizara, el trigger reescribiria el resultado de la liquidacion"
    );
  }
  check(
    "el ON CONFLICT no pisa caballos con un array vacio",
    /\bcaballos\s*=\s*case/i.test(cuerpo) &&
      /jsonb_array_length\(excluded\.caballos\)\s*>\s*0/i.test(cuerpo) &&
      /else\s+resultados_carreras\.caballos/i.test(cuerpo),
    "un array vacio borraria los ejemplares ya cargados en el central"
  );
  check(
    "los vapores (null) no borran el central: coalesce en distancia/superficie/premio",
    /coalesce\(excluded\.distancia/.test(cuerpo) &&
      /coalesce\(excluded\.superficie/.test(cuerpo) &&
      /coalesce\(excluded\.premio/.test(cuerpo)
  );
}

// ---------------------------------------------------------------------------
// 4) Escucha cambios de fecha (si no, se repite el incidente)
// ---------------------------------------------------------------------------
{
  const trig = sql.match(/create\s+trigger[\s\S]*?for\s+each\s+row/i);
  check("el trigger se crea", !!trig);
  const decl = trig ? trig[0] : "";
  check(
    "el trigger es AFTER INSERT OR UPDATE",
    /after\s+insert\s+or\s+update/i.test(decl),
    "despues de insertar o modificar, no antes (si es BEFORE, el pago puede reventar)"
  );
  check(
    "el trigger vigila la columna `fecha`",
    /update\s+of[\s\S]*\bfecha\b/i.test(decl),
    "sin `update of ... fecha`, cambiar el dia de una tabla no actualiza el central"
  );
  for (const col of ["caballos", "hipodromo", "carrera", "distancia_carrera", "superficie", "premio_original"]) {
    check(`el trigger vigila ${col}`, new RegExp(`\\b${col}\\b`).test(decl));
  }
  check(
    "el trigger NO es de tipo BEFORE (no debe poder bloquear una venta)",
    !/\bbefore\b/i.test(decl)
  );
  check(
    "la funcion es SECURITY DEFINER (el usuario de la app no necesita permiso de escritura en el central)",
    /security\s+definer/i.test(sql)
  );
  check(
    "la funcion fija search_path (no se deja arrastrar por el esquema del atacante)",
    /set\s+search_path/i.test(sql)
  );
}

// ---------------------------------------------------------------------------
// 5) Orden: la guarda de columnas va ANTES del create trigger
// ---------------------------------------------------------------------------
{
  const iGuardia = sql.search(/no\s+tiene\s+estas\s+columnas/i);
  const iTrigger = sql.search(/create\s+trigger/i);
  check("el script valida las columnas", iGuardia >= 0);
  check("el script crea el trigger", iTrigger >= 0);
  // El CREATE TRIGGER valida su propia lista `update of` al instante; si una
  // columna de tablas_fijas no existe, no se instala y el error recien aparece
  // al publicar. La guarda tiene que cubrir esa tabla tambien, no solo el central.
  check(
    "la guarda tambien cubre las columnas de tablas_fijas",
    /tablas_fijas\s+no\s+tiene\s+estas\s+columnas/i.test(sql),
    "el UPDATE OF del trigger exige que existan sus columnas al crearlo"
  );
  check(
    "la validacion de columnas va ANTES de crear el trigger",
    iGuardia >= 0 && iTrigger >= 0 && iGuardia < iTrigger,
    "si se creara primero, un trigger roto queda instalado y falla al primer INSERT"
  );
}

// ---------------------------------------------------------------------------
// 6) El codigo de la app NO vuelve a publicar en crudo
// ---------------------------------------------------------------------------
{
  // El trigger cubre los escritores que no son la UI. La UI, ademas, tiene que
  // seguir normalizando: si la app manda texto crudo, el trigger lo guardaria
  // igual (para la base 2026-04-10 es valida).
  const rpc = readFileSync("src/lib/tablas/rpc.ts", "utf8");
  check(
    "el publicador sigue sincronizando el central en codigo",
    /sincronizarCentralDesdeTabla/.test(rpc),
    "si soloDepends del trigger, la UI no refleja el cambio sin recargar"
  );
}

// ---------------------------------------------------------------------------
console.log(
  `\n${fallas.length === 0 ? "TODO OK" : "HAY FALLAS"}: ${pasan} ok, ${fallas.length} fallas\n`
);
process.exit(fallas.length > 0 ? 1 : 0);
