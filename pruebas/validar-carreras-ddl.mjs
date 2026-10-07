// ============================================================================
// VALIDADOR DE PRE-VUELO para sql/carreras.sql
//
// Mismo criterio que validar-marcas-ddl.mjs / validar-trigger-central.mjs: este
// SQL se aplica A MANO en el SQL Editor y nunca pasa por PostgreSQL antes de que
// estea en produccion. Lo que mas se paga aqui:
//
//   1) 42804 â€” TIPOS INCOMPATIBLES en una FK. Ya ocurrio: `carreras.hipodromo_id`
//      se declaro `bigint` cuando `hipodromos.id` es `uuid`, y PostgreSQL tiro
//      "foreign key constraint cannot be implemented". Como todo el script va
//      en una transaccion, el error tiro ABAJO la tabla, el respaldo y los
//      enlaces: no se instalo NADA. Un validador que no mira el tipo no lo ve.
//
//   2) `format('%s', <oid>)` imprime el NUMERO del OID (2951), no "uuid".
//      `alter table ... add column 2951` no existe: el DDL "dinamico" revienta
//      justo en la linea que pretendia arreglar el problema anterior.
//
//   3) Delimitadores $$ desbalanceados -> Postgres se come el resto del script
//      sin instalar nada y sin dejar rastro.
//
//   4) Que el tipo de la FK se PREGUNTE a la tabla, no se suponga. Es lo que
//      hace que el archivo serve tanto en esta base (uuid) como en una legacy
//      que tuviera bigint, y que no vuelva a pasar lo mismo en otro lado.
//
//   5) Que el respaldo use `on conflict ... do nothing`: re-correr el script
//      tiene que ser un no-op sobre las filas, no un 23505 que tumbe la
//      transaccion entera.
//
//   6) Que se ENDUREZCA programa_dia (RLS + permisos), que es la parte que
//      cierra la escritura sin login. Si se quita y nadie lo nota, el script
//      pasa igual.
// ============================================================================
import { readFileSync } from "node:fs";

const RUTA_SQL = "sql/carreras.sql";

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

// El codigo sin comentarios: para buscar SQL real, no lo que el comentario dice.
const sinComentarios = sql
  .split("\n")
  .map((l) => l.replace(/--.*$/, ""))
  .join("\n");
const sinBloques = sinComentarios.replace(/\/\*[\s\S]*?\*\//g, "");

console.log("\n== carreras.sql: estructura ==");

check("abre y cierra transaccion", /^\s*begin\s*;/im.test(sql) && /^\s*commit\s*;/im.test(sql));
check("los delimitadores $$ estan balanceados", (sql.match(/\$\$/g) || []).length % 2 === 0,
  `${(sql.match(/\$\$/g) || []).length} apariciones`);
check("cada do $$ termina en $$;", /do\s*\$\$[\s\S]*?end\s*\$\$\s*;/i.test(sql));
check("no usa metacomandos de psql (\\i, \\set)", !/^\s*\\(i|set|connect|c)\b/im.test(sql));
check("el archivo no rompe el encoding (sin U+FFFD)", !sql.includes("\uFFFD"));

console.log("\n== carreras.sql: tipos de clave foranea (el 42804) ==");

// El fallo real. `hipodromos.id` es uuid en esta base; la FK exige el mismo tipo.
check("NO declara hipodromo_id como bigint (42804 contra hipodromos.id uuid)",
  !/\bhipodromo_id\s+bigint\b/i.test(sinBloques));

check("carreras.id es uuid",
  /create table if not exists public\.carreras\s*\((?:[^;]*?)\bid\s+uuid\b/i.test(sql));

check("el tipo de la FK se PREGUNTA con format_type(), no se supone",
  /format_type\s*\(\s*id_tipo\s*,\s*null\s*\)/.test(sql));

check("NO pasa un oid crudo a format() (imprimiria 2951, no 'uuid')",
  !/format\s*\([^)]*'%s'[^)]*,\s*id_tipo\s*\)/.test(sql));

check("lee el tipo real desde pg_attribute de hipodromos",
  /pg_attribute[\s\S]{0,400}?hipodromos/.test(sql) && /atttypid/.test(sql));

check("avisa con un mensaje claro si falta hipodromos",
  /hipodromos\.id\s*:?\s*aplica primero/i.test(sql) || /No existe public\.hipodromos\.id/.test(sql));

console.log("\n== carreras.sql: las FK se rehacen (idempotencia que repara) ==");

for (const [nombre, referenciada] of [
  ["carreras_hipodromo_id_fkey", "hipodromos"],
  ["resultados_carreras_carrera_id_fkey", "carreras"],
]) {
  check(`drop constraint if exists ${nombre}`,
    new RegExp(`drop constraint if exists\\s+${nombre}`, "i").test(sql));
  check(`${nombre} se vuelve a crear`,
    new RegExp(`add constraint\\s+${nombre}[\\s\\S]{0,300}?references\\s+public\\.${referenciada}\\(id\\)`, "i").test(sql));
}

// Una FK que no se puede dejar a medias: si el constraint quedo de un intento
// anterior con el tipo viejo, drop+add lo deja bien sin tocar el script.
check("una columna del tipo equivocado se rehace, no se ignora",
  /col_tipo\s*<>\s*id_tipo/.test(sinBloques) && /drop column hipodromo_id/.test(sinBloques));

console.log("\n== carreras.sql: la forma de la tabla (el 42703) ==");

// `create table if not exists` es un mentiroso: si `public.carreras` ya existe
// con otra forma, no hace nada y el respaldo revienta con
// "42703: column carrera of relation carreras does not exist". Ya ocurrio.
check("NO depende solo del create table if not exists para las columnas del grano",
  /add column fecha date/.test(sinBloques) &&
  /add column hipodromo text/.test(sinBloques) &&
  /add column carrera integer/.test(sinBloques));

check("asegura la primary key de carreras",
  /contype = 'p'/.test(sinBloques) && /primary key \(id\)/.test(sinBloques));

check("rellena los id nulos antes de declarar la PK",
  /update public\.carreras set id = gen_random_uuid\(\) where id is null/.test(sinBloques));

check("el grano queda NOT NULL",
  /alter column hipodromo set not null/.test(sinBloques) &&
  /alter column carrera\s+set not null/.test(sinBloques));

// Lo importante: si la tabla ya tenia filas y no se pueden identificar, el
// script ABORTA en vez de inventar hipodromo/carrera. Inventar claves crea
// carreras fantasma que se entierran en el maestro.
check("aborta si hay filas sin poder identificar (no inventa claves)", (() => {
  if (!/raise exception/i.test(sinBloques)) return false;
  if (!/hay_filas\s*>\s*0/.test(sinBloques)) return false;
  return /where hipodromo is null or btrim\(hipodromo\) = '' or carrera is null/.test(sinBloques);
})());

check("el UNIQUE del grano existe como indice (habilita on conflict)", /create unique index if not exists carreras_unico_idx/i.test(sql));

// Las columnas con default las lee la app directo: un NULL ahi se ve como
// Las columnas con default las lee la app directo: un NULL ahi se ve como
// carrera rota en pantalla.
check("rellena estado/caballos/origen/verificado que quedaron NULL",
  /set estado\s+= 'Programada'\s+where estado\s+is null/.test(sinBloques) &&
  /set caballos\s+= '\[\]'::jsonb\s+where caballos\s+is null/.test(sinBloques) &&
  /set origen\s+= 'ia'\s+where origen\s+is null/.test(sinBloques) &&
  // `verificado` en NULL se veria como "sin verificar" indistinguible de
  // "verificada": el default tiene que rellenar tambien las filas viejas.
  /set verificado = false\s+where verificado\s+is null/.test(sinBloques));

// La auditoria y el INV tienen que existir aunque `carreras` haya venido de
// otra forma.
for (const col of [
  "actualizado_por",
  "verificado",
  "verificado_por",
  "verificado_at",
  "invalidado_remate",
]) {
  check(`asegura la columna ${col}`, new RegExp(`add column if not exists ${col}\\s`, "i").test(sql));
}

console.log("\n== carreras.sql: el respaldo no puede romper la transaccion ==");

// Sin `on conflict do nothing`, re-correr el script falla con 23505 y -como todo
// esta en `begin/commit`- se lleva por delante la activacion de RLS y los grants.
const inserts = sinBloques.match(/insert into public\.carreras/gi) || [];
check("hay respaldos desde resultados y desde el programa de la IA", inserts.length >= 2, `${inserts.length} inserts`);
check("cada respaldo usa on conflict ... do nothing",
  (sinBloques.match(/on conflict\s*\(fecha,\s*hipodromo,\s*carrera\)\s*do nothing/gi) || []).length >= inserts.length,
  `${(sinBloques.match(/on conflict\s*\(fecha,\s*hipodromo,\s*carrera\)\s*do nothing/gi) || []).length} de ${inserts.length}`);

// El cast del programa de la IA es donde mas se revienta un INSERT: una clave
// "carrera" en texto o con signo rompe el ::int y tumba todo.
check("el ::int del numero de carrera va filtrado con una regex",
  /::int/.test(sinBloques) && /\(carrera_json ->> 'carrera'\)\s*~\s*'\^\[0-9\]\+\$'/.test(sinBloques));
check("el premio del JSON se limpia antes del ::numeric",
  /nullif\(carrera_json ->> 'premio', ''\)\s*::numeric/.test(sinBloques));

console.log("\n== carreras.sql: endurecimiento de programa_dia ==");

check("programa_dia queda con RLS activado", /alter table public\.programa_dia enable row level security/i.test(sql));
check("la policy de programa_dia es solo de authenticated",
  /create policy programa_dia_publico[\s\S]{0,200}?for all to authenticated/i.test(sql));
check("carreras queda con RLS activado", /alter table public\.carreras enable row level security/i.test(sql));
check("carreras no le deja INSERT/UPDATE/DELETE a anon",
  /grant select on public\.carreras to anon/i.test(sql) &&
  !/grant[^;]*\b(insert|update|delete)\b[^;]*\bto\b[^;]*\banon\b/i.test(sql));

console.log("\n== carreras.sql: lo que el resto de la app lee ==");

// El embed es lo que hace que un solo query traiga catalogo + resultado. Si el
// nombre de la columna cambia, la app cae al camino lento sin avisar.
check("existe resultados_carreras.carrera_id", /carrera_id/.test(sql));
check("hay indice parcial sobre carrera_id", /create index if not exists resultados_carreras_carrera_id_idx/i.test(sql));
check("hay indice (fecha, hipodromo)", /create index if not exists carreras_fecha_hipodromo_idx/i.test(sql));
check("el grano unico es (fecha, hipodromo, carrera)",
  /constraint carreras_unico unique \(fecha, hipodromo, carrera\)/i.test(sql));
check("el enlace de hipodromo se rellena comparando por NOMBRE en mayusculas",
  /upper\(trim\(h\.nombre\)\)\s*=\s*c\.hipodromo/.test(sinBloques));

console.log(`\ncarreras.sql: ${pasan} ok, ${fallas.length} fallas\n`);
if (fallas.length > 0) {
  console.log("HAY FALLAS: este SQL se aplico a mano y fallo con 42804. NO lo apliques todavia.\n");
  process.exit(1);
}
