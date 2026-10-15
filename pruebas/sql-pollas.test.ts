/**
 * Integridad de los RPC de POLLAS en sql/pollas.sql.
 *
 * Este archivo se pegó en el SQL Editor y falló con dos errores:
 *
 *   42P13  input parameters after one with a default value must also have defaults
 *   42601  syntax error at or near "`"
 *
 * Los dos son errores de TEXTO, no de lógica: no hacen falta datos ni una base
 * con datos para detectarlos. `club_guardar_polla` tenía `p_id uuid default null`
 * seguido de `p_datos jsonb` sin default, y el mismo error estaba en
 * `club_registrar_venta_polla` con `p_combinaciones`. PostgreSQL exige que los
 * parámetros con default formen un SUFIJO de la lista: apenas hay uno con
 * default, todos los que vienen después tienen que tenerlo también.
 *
 * El 42601 además delató algo peor: cambiar el orden de los parámetros de una
 * función NO cambia su firma para `grant`/`revoke`/`comment on function`, que la
 * escriben con los tipos en orden. Si la firma y el grant no coinciden, la
 * función queda creada pero el navegador no tiene permiso de ejecutarla, y eso
 * solo aparece en producción, cuando alguien intenta guardar una Polla.
 *
 * Por eso estas pruebas leen el SQL como texto y comparan las tres cosas por
 * separado: los defaults, el balance de `$$`, y que cada grant/revoke/comment
 * apunte a una firma que exista de verdad.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RUTA = join(process.cwd(), "sql", "pollas.sql");

let pasan = 0;
let fallan = 0;
function ok(cond: boolean, msg: string) {
  if (cond) {
    pasan++;
    console.log("  ok   " + msg);
  } else {
    fallan++;
    console.log("  FALLA " + msg);
  }
}

const sql = readFileSync(RUTA, "utf8");

type Param = { nombre: string; tipo: string; def: boolean };

/** Parte los parámetros de una firma de PL/pgSQL en tipo y si tiene default. */
function leerParams(cuerpo: string): Param[] {
  return cuerpo
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !p.startsWith("--"))
    .map((p) => {
      const def = /\bdefault\b/i.test(p);
      const limpio = p.replace(/\bdefault\b[\s\S]*$/i, "").trim();
      const partes = limpio.split(/\s+/);
      return { nombre: partes[0], tipo: partes[partes.length - 1], def };
    });
}

/** Todas las funciones del archivo, con sus tipos en orden de declaración. */
function leerFunciones(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const re = /create\s+or\s+replace\s+function\s+(?:public\.)?(\w+)\s*\(([\s\S]*?)\)\s*\nreturns/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    out.set(m[1], leerParams(m[2]).map((p) => p.tipo));
  }
  return out;
}

// ---------------------------------------------------------------------------
console.log("\n[1] Los delimitadores $$ estan balanceados");
// ---------------------------------------------------------------------------
// Un `$$` de menos convierte todo el resto del archivo en texto de cadena y el
// error que sale es "syntax error at or near" en una linea que en realidad es un
// comentario. Es el error mas dificil de leer de los dos que pegaron.
{
  const n = (sql.match(/\$\$/g) ?? []).length;
  ok(n % 2 === 0, `hay ${n} marcadores $$ (par=${n % 2 === 0})`);
}

// ---------------------------------------------------------------------------
console.log("\n[2] Ningun comentario quedo sin su --");
// ---------------------------------------------------------------------------
// El 42601 apuntaba a un comentario que habia perdido el `--`, y por eso
// PostgreSQL intento parsear el texto y se quejo de los acentos graves.
{
  const sueltas = sql
    .split(/\r?\n/)
    .map((l, i) => ({ n: i + 1, l }))
    .filter(({ l }) => /^\s*`[^`]*`\s/.test(l));
  ok(sueltas.length === 0, "ninguna linea empieza con texto entre acentos graves sin --");
  for (const a of sueltas) console.log(`        linea ${a.n}: ${a.l.trim()}`);
}

// ---------------------------------------------------------------------------
console.log("\n[3] Los parametros con default forman un sufijo de la lista");
// ---------------------------------------------------------------------------
// El 42P13. Regla de PL/pgSQL: en cuanto un parametro declara `default`, todos
// los siguientes tienen que declararlo tambien.
{
  const firmas = leerFunciones();
  ok(firmas.size >= 6, `se leyeron ${firmas.size} funciones de Pollas`);

  for (const [nombre] of firmas) {
    const re = new RegExp(
      `create\\s+or\\s+replace\\s+function\\s+(?:public\\.)?${nombre}\\s*\\(([\\s\\S]*?)\\)\\s*\\nreturns`,
      "i"
    );
    const m = re.exec(sql);
    if (!m) continue;
    const params = leerParams(m[1]);

    const nombres = params.map((p) => p.nombre);
    ok(new Set(nombres).size === nombres.length, `${nombre}: no repite nombres de parametro`);

    // Indice del ultimo parametro SIN default: todo lo que sigue debe tenerlo.
    let ultimoSinDefault = -1;
    params.forEach((p, i) => {
      if (!p.def) ultimoSinDefault = i;
    });
    const trasDefault = params
      .slice(ultimoSinDefault + 1)
      .filter((p) => !p.def)
      .map((p) => p.nombre);
    ok(
      trasDefault.length === 0,
      `${nombre}: ningun parametro sin default va despues de uno con default` +
        (trasDefault.length ? ` (sin default: ${trasDefault.join(", ")})` : "")
    );
  }
}

// ---------------------------------------------------------------------------
console.log("\n[4] grant / revoke / comment apuntan a una firma que existe");
// ---------------------------------------------------------------------------
{
  const firmas = leerFunciones();

  const chequear = (re: RegExp, etiqueta: string) => {
    let x: RegExpExecArray | null;
    while ((x = re.exec(sql)) !== null) {
      const nombre = x[1];
      const esperado = x[2]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .join(", ");
      const real = firmas.get(nombre);
      if (real === undefined) {
        ok(false, `${etiqueta} ${nombre}: la funcion existe`);
        continue;
      }
      ok(
        real.join(", ") === esperado,
        `${etiqueta} ${nombre} coincide con la firma` +
          (real.join(", ") === esperado
            ? ""
            : `\n        el SQL dice (${esperado}) y la firma es (${real.join(", ")})`)
      );
    }
  };

  chequear(
    /grant\s+execute\s+on\s+function\s+(?:public\.)?(\w+)\s*\(([^)]*)\)/gi,
    "grant"
  );
  chequear(
    /revoke\s+execute\s+on\s+function\s+(?:public\.)?(\w+)\s*\(([^)]*)\)/gi,
    "revoke"
  );
  chequear(
    /comment\s+on\s+function\s+(?:public\.)?(\w+)\s*\(([^)]*)\)/gi,
    "comment"
  );

  // Toda funcion creada debe tener grant a `authenticated`: sin el la RPC
  // existe pero el navegador no la puede llamar.
  for (const nombre of firmas.keys()) {
    ok(
      new RegExp(
        `grant\\s+execute\\s+on\\s+function\\s+(?:public\\.)?${nombre}\\s*\\([^)]*\\)\\s*to\\s+authenticated`,
        "i"
      ).test(sql),
      `${nombre}: hay grant execute ... to authenticated`
    );
    ok(
      new RegExp(
        `revoke\\s+execute\\s+on\\s+function\\s+(?:public\\.)?${nombre}\\s*\\([^)]*\\)\\s*from\\s+public`,
        "i"
      ).test(sql),
      `${nombre}: revoca execute a public`
    );
  }
}

// ---------------------------------------------------------------------------
console.log("\n[5] Los premios se pueden BORRAR (no solo cambiar)");
// ---------------------------------------------------------------------------
// El bug de dinero: `coalesce(p_datos->>'premio_1o', premio_1o)` no distingue
// "la clave no vino" de "la vino en null". El cliente manda SIEMPRE el payload
// completo, con null explicito cuando el campo esta vacio, asi que ese coalesce
// devolvia el premio viejo y era imposible poner "No paga": la casa seguia
// pagando un premio que el operador habia borrado, sin error ni aviso.
{
  const i = sql.indexOf("update public.pollas set");
  const upd = sql.slice(i, sql.indexOf("returning", i));
  ok(i > -1, "se encontro el update public.pollas");

  for (const clave of [
    "premio_1o",
    "premio_2o",
    "premio_3o",
    "premio_1o_txt",
    "premio_2o_txt",
    "premio_3o_txt",
    "notas",
    "hipodromo_id",
    "grupo_id",
  ]) {
    ok(
      new RegExp(`${clave}\\s*=\\s*case\\s+when\\s+p_datos\\s*\\?\\s*'${clave}'`, "i").test(upd),
      `${clave}: distingue clave ausente de clave en null`
    );
  }
  ok(
    !/premio_1o\s*=\s*coalesce\(/i.test(upd),
    "premio_1o ya NO usa coalesce contra el valor viejo"
  );
}

console.log(`\nTODO ${fallan === 0 ? "OK" : "FALLA"}: ${pasan} pasaron, ${fallan} fallaron`);
if (fallan > 0) process.exit(1);