// ============================================================================
// VALIDADOR DE PRE-VUELO para sql/reparar_central_desde_tablas.sql
//
// Mismo criterio que validar-marcas-ddl.mjs: este script se aplica A MANO en el
// SQL Editor y nunca pasa por PostgreSQL. Si algo esta mal, se descubre
// mientras esta caida la caja.
//
// Lo que atrapa aqui, y es especifico de ESTE script:
//
//   1) Parentesis y begin/commit desbalanceados. Un parentesis sin cerrar hace
//      que Postgres se coma el resto del script y no ejecute NADA: se pierde el
//      tiempo y no queda registro de por que.
//   2) Columnas del INSERT que NO existen en resultados_carreras segun el DDL
//      del repo. Este es el fallo caro: `insert into ... (foo)` revienta al
//      ejecutar, y como todo va en una transaccion, no se aplica ninguna de las
//      reparaciones.
//   3) Que el script pise resultados ya liquidados. Esta es la parte que hace
//      falta mirar a ojo: la idea es arreglar la oferta (caballos, distancia,
//      superficie, premio) y no tocar NUNCA ganadores ni aplicado_a_tablas.
//      Si alguien "completa" un UPDATE con esas columnas, aqui salta.
//   4) Que no se aplicable dos veces de forma distinta (idempotencia).
//
// Ademas comprueba que el CODIGO que evita el problema ya este aplicado:
// publicar tiene que sincronizar el central, o el script habra que correrlo a
// mano cada vez que se publique una tabla.
// ============================================================================
import { readFileSync } from "node:fs";

const RUTA_SQL = "sql/reparar_central_desde_tablas.sql";

let pasan = 0;
const fallas = [];

function ok(n, d = "") { pasan++; console.log(`  ok    ${n}${d ? "  " + d : ""}`); }
function falla(n, d) { fallas.push(`${n}: ${d}`); console.log(`  FALLA ${n}\n        ${d}`); }
function check(n, cond, d = "") { cond ? ok(n, d) : falla(n, d || "condicion falsa"); }

let sql = "";
try {
  sql = readFileSync(RUTA_SQL, "utf8");
} catch (e) {
  console.log(`  FALLA no se pudo leer ${RUTA_SQL}: ${e.message}`);
  console.log(`\nHAY FALLAS: 0 ok, 1 fallas\n`);
  process.exit(1);
}

const lineas = sql.split(/\r?\n/);
/** Quita comentarios y el contenido de las comillas simples. */
const limpiar = (l) => l.replace(/--.*$/, "").replace(/'(\\.|[^'])*'/g, "''");
const codigo = lineas.map(limpiar).join("\n");

// ---------------------------------------------------------------------------
console.log("\n[1] El script esta completo y balanceado");
// ---------------------------------------------------------------------------
check("no esta vacio", sql.length > 500, `${sql.length} bytes`);
// Este script se pega en el SQL Editor de Supabase, que NO es psql: cualquier
// linea que empiece con `\` (el viejo `\set ON_ERROR_STOP on`, los `\echo`) hace
// que el Editor responda "syntax error at or near \" y no ejecute NADA.
check(
  "sin meta-comandos de psql (se aplica en el SQL Editor)",
  !/^\s*\\/m.test(sql),
  "el Editor no entiende backslash; usar comentarios SQL"
);
check("hay begin", /\bbegin\s*;/i.test(codigo));
check("hay commit", /\bcommit\s*;/i.test(codigo));
{
  const abre = (codigo.match(/\(/g) ?? []).length;
  const cierra = (codigo.match(/\)/g) ?? []).length;
  check(
    "parentesis balanceados",
    abre === cierra,
    `${abre} abren, ${cierra} cierran  (si no, Postgres se come el resto del script)`
  );
}
{
  const dollar = (codigo.match(/\$\$/g) ?? []).length;
  check("ningun $$ sin cerrar", dollar % 2 === 0, `${dollar} apariciones`);
}
// `array_length` exige DOS argumentos: array_length(arr, 1). Con uno solo,
// Postgres responde 42883 "function array_length(text[]) does not exist" y el
// script no corre. `jsonb_array_length` (el prefijo jsonb_) SI es de uno solo:
// por eso el lookbehind, para no marcarlo a el.
check(
  "todo array_length lleva su dimension (arr, 1)",
  !/(?<!jsonb_)array_length\s*\([^,)]*\)/i.test(codigo),
  "array_length(arr) revienta: falta el segundo argumento (la dimension)"
);
check(
  "la reparacion filtra los liquidados con la dimension correcta",
  /array_length\(\s*r\.ganadores\s*,\s*1\s*\)/i.test(codigo),
  "sin la dimension, el filtro de 'sin resultado' siquiera compila"
);
check("no quedan restos de edicion", !/\bTODO\b|\bFIXME\b|\bXXX\b/.test(sql));
check("sin caracteres CJK (copia/pega accidental)", !/[\u4e00-\u9fff\uff00-\uffef]/.test(sql));

// ---------------------------------------------------------------------------
console.log("\n[2] Columnas del INSERT: existen en el DDL del repo");
// ---------------------------------------------------------------------------
// El DDL real de resultados_carreras vive repartido en varios .sql del repo.
// Se recogen TODAS las declaraciones para no depender de un solo archivo.
{
  const ddl = [
    "sql/paquete_pendientes.sql",
    "sql/unificar_carreras.sql",
    "sql/resultados_rpc.sql",
    "sql/multi_grupos.sql",
  ]
    .map((f) => {
      try {
        return readFileSync(f, "utf8");
      } catch {
        return "";
      }
    })
    .join("\n")
    .toLowerCase();

  check("se encontro el DDL de resultados_carreras", ddl.includes("resultados_carreras"));

  // Columnas del INSERT ... ( ... ) de la seccion 3.
  const m = /insert\s+into\s+public\.resultados_carreras\s*\(([\s\S]*?)\)/i.exec(codigo);
  check("el INSERT del central lista sus columnas", !!m);
  if (m) {
    const cols = m[1]
      .split(",")
      .map((c) => c.trim().toLowerCase())
      .filter(Boolean);
    check("no hay columnas repetidas en el INSERT", new Set(cols).size === cols.length, cols.join(", "));
    for (const c of cols) {
      const declarada =
        new RegExp(`\\b${c}\\s+(text|int|integer|numeric|boolean|date|jsonb|timestamptz|uuid|bigint)`, "i").test(ddl) ||
        new RegExp(`add\\s+column\\s+(if\\s+not\\s+exists\\s+)?${c}\\s+\\w`, "i").test(ddl) ||
        new RegExp(`\\b${c}\\b\\s+(text|int|integer|numeric|boolean|date|jsonb|timestamptz|uuid|bigint)\\s*(,|\\))`, "i").test(ddl);
      check(`la columna "${c}" existe en resultados_carreras`, declarada);
    }
  }

  // Columnas de tablas_fijas que lee.
  for (const c of ["hipodromo", "carrera", "fecha", "caballos", "distancia_carrera", "superficie", "premio_original", "retirados_oficiales"]) {
    const declarada = new RegExp(`\\b${c}\\b`, "i").test(ddl) ||
      new RegExp(`add\\s+column\\s+(if\\s+not\\s+exists\\s+)?${c}\\s+\\w`, "i").test(ddl);
    check(`tablas_fijas/resultados_carreras declara "${c}"`, declarada);
  }
}

// ---------------------------------------------------------------------------
console.log("\n[3] No toca resultados de carreras ya liquidadas");
// ---------------------------------------------------------------------------
{
  // Esta es la regla de oro: el script arregla la OFERTA de la carrera. Tocar
  // `ganadores`, `aplicado_a_tablas`, `orden_llegada`, `dividendos`,
  // `premio_recalculado` o `detalle` significa borrar liquidaciones.
  const partes = codigo.split(/;(?![^(]*\))/);
  const actualizaciones = partes.filter((p) => /^\s*update\s+public\.resultados_carreras/im.test(p));
  check("hay al menos un UPDATE del central", actualizaciones.length > 0, `${actualizaciones.length}`);

  const prohibidas = ["ganadores", "aplicado_a_tablas", "orden_llegada", "dividendos", "premio_recalculado", "detalle"];
  for (const p of actualizaciones) {
    // Solo el lado derecho del SET: `= ARRAY_LENGTH(ganadores, 1)` como filtro
    // del WHERE es legitimo y no es una escritura.
    const sets = p.split(/where/i)[0];
    for (const col of prohibidas) {
      const asigna = new RegExp(`\\b${col}\\b\\s*=\\s*[^,]`, "i").test(sets.replace(/=\s*where/i, ""));
      check(`el UPDATE no asigna "${col}"`, !asigna, "asignarlo borra el resultado de una liquidacion");
    }
  }

  // Y el DELETE solo puede tocar filas huerfanas: sin ganadores y sin aplicado.
  const del = partes.filter((p) => /^\s*delete\s+from\s+public\.resultados_carreras/im.test(p));
  check("el DELETE protege las filas con resultado", del.every((p) => /array_length\(\s*\w+\.ganadores/.test(p) || /coalesce\(array_length/i.test(sql)));
  if (del.length) {
    check(
      "el DELETE exige que la carrera tenga tabla en la fecha correcta",
      /exists\s*\(/i.test(del[0]) || /huerfanas/i.test(codigo),
      "sin el EXISTS borra filas de cualquier dia"
    );
  }
}

// ---------------------------------------------------------------------------
console.log("\n[4] Idempotencia");
// ---------------------------------------------------------------------------
{
  // Correrlo dos veces no debe duplicar carreras ni pisar ejemplares.
  check("el INSERT usa on conflict", /on\s+conflict\s*\(\s*fecha\s*,\s*hipodromo\s*,\s*carrera\s*\)/i.test(codigo));
  check("el INSERT solo crea lo que falta", /not\s+exists\s*\(/i.test(codigo));
  // Este se chequea contra el SQL CRUDO: `limpiar()` vacia las comillas
  // simples y se comería el `'[]'::jsonb` que hace la guarda.
  check(
    "el ON CONFLICT no pisa con un array vacio",
    /coalesce\(\s*nullif\(\s*excluded\.caballos\s*,\s*'\[\]'\s*::\s*jsonb\s*\)/i.test(sql),
    "sin esto, una segunda corrida borra los ejemplares"
  );
  check("el ON CONFLICT preserva valores existentes", /coalesce\(\s*excluded\.(distancia|superficie|premio)\s*,\s*resultados_carreras\./i.test(codigo));
}

// ---------------------------------------------------------------------------
console.log("\n[5] El CODIGO ya evita el problema (si no, hay que correr esto a mano siempre)");
// ---------------------------------------------------------------------------
{
  let rpc = "";
  try {
    rpc = readFileSync("src/lib/tablas/rpc.ts", "utf8");
  } catch {
    /* vacio */
  }
  check("src/lib/tablas/rpc.ts existe", rpc.length > 0);
  check(
    "publicarTabla sincroniza el central",
    /publicarTabla[\s\S]{0,900}sincronizarCentralDesdeTabla/.test(rpc),
    "sin esto, publicar NO registra la carrera y este SQL hay que correrlo cada vez"
  );
  check(
    "publicarTablasLote tambien sincroniza",
    /publicarTablasLote[\s\S]{0,2600}sincronizarCentralDesdeTabla/.test(rpc),
    "el lote ('Publicar todas') es la via por la que se publican las 13 carreras"
  );
  check("la sincronizacion existe en el modulo", /export async function sincronizarCentralDesdeTabla/.test(readFileSync("src/lib/carreras-dia.ts", "utf8")));

  // Y la publicacion no se cae si el central falla: la tabla ya esta publicada.
  const bloque = /publicarTabla[\s\S]{0,1200}?\n}/.exec(rpc)?.[0] ?? "";
  check(
    "publicarTabla no tira la publicacion si el central falla",
    /sync\.ok\s*\?/.test(bloque) && /return\s*\{\s*ok:\s*true/.test(bloque),
    "la venta depende de la tabla; el central es best-effort"
  );

  // Distinguir "no se publico" de "se publico pero sin central" es lo que evita
  // que el operador vea "exito" mientras la carrera queda invisible en
  // Marcas/Gestion/Dupletas (el sintoma del 04-10-2026).
  check(
    "el lote marca los avisos de central como `publicada`",
    /publicada:\s*true/.test(rpc),
    "sin la marca, el modulo no puede distinguir un fallo de un aviso"
  );
  check(
    "el ok del lote no da 'no publicado' por un aviso de central",
    /errores\.every\(\s*\(e\)\s*=>\s*e\.publicada\s*===\s*true\s*\)/.test(rpc),
    "un aviso de central no es un fallo de publicacion"
  );

  let modulo = "";
  try {
    modulo = readFileSync("src/components/tablas/TablasModule.tsx", "utf8");
  } catch {
    /* vacio */
  }
  check("src/components/tablas/TablasModule.tsx existe", modulo.length > 0);
  check(
    "el publicador del modulo propaga el aviso de central",
    /return\s*\{\s*ok:\s*true,\s*error:\s*r\.error\s*\}/.test(modulo),
    "si lo descarta, el operador ve 'publicada con exito' y nunca se entera"
  );
  check(
    "el modulo separa avisos de central de los fallos de publicacion",
    /e\.publicada\s*\?\s*avisos\s*:\s*errores/.test(modulo),
    "si los mezcla, una tabla publicada sin central vuelve al Ensamblaje o se oculta el aviso"
  );
  check(
    "el modulo avisa cuando publica sin central",
    /sin central \(no se ver/i.test(modulo),
    "el operador tiene que enterarse de que la carrera no se ve en los demas modulos"
  );
}

// ---------------------------------------------------------------------------
console.log("\n[6] La fecha ambigua queda diagnosticada antes de tocarse");
// ---------------------------------------------------------------------------
{
  // El informe ya no usa `\echo` (que el SQL Editor rechaza): los titulos son
  // comentarios SQL y se comprueba la consulta diagnostica que los respalda.
  check(
    "hay informe previo",
    /==\s*1\.\s*Fecha invertida/i.test(sql) && /fecha_si_se_invierte/i.test(sql),
    "el operador tiene que ver que falta antes de aplicar"
  );
  check("el informe lista las que faltan del central", /sin\s+fila\s+en\s+el\s+central/i.test(sql));
  check("el informe lista la carrera partida en dos fechas", /dos\s+fechas/i.test(sql));
  check("la seccion 4 verifica con un conteo", /quedan_sin_central/i.test(sql) && /carreras_partidas/i.test(sql));
}

// ---------------------------------------------------------------------------
console.log(`\n${fallas.length === 0 ? "TODO OK" : "HAY FALLAS"}: ${pasan} ok, ${fallas.length} fallas`);
if (fallas.length) {
  console.log("\nFallas:");
  for (const f of fallas) console.log("  - " + f);
}
console.log("");
process.exit(fallas.length ? 1 : 0);
