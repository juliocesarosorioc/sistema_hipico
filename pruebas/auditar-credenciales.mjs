// ============================================================================
// AUDITORÍA DE CREDENCIALES EXPUESTAS.
//
// Busca, en todas las tablas que la aplicación toca, columnas que guardan
// contraseñas o secretos, y avisa si son legibles con la llave ANON.
//
// Por qué existe: la llave anon va incrustada en el bundle de JavaScript. No
// es un secreto, es texto público que se lee abriendo devtools. Cualquier tabla
// que deje leerla es una tabla que anybody puede leer, esté o no la use el
// código hoy. Se encontró `operadores.password` con las contraseñas DEL NEGOCIO
// en texto plano, y nadie la estaba usando desde el código nuevo: seguiría
// expuesta igual.
//
// IMPORTANTE: este script NO imprime los valores. Una auditoría que los imprime
// los deja copiados en el log de CI, en el historial del terminal y en el
// informe: convierte una fuga en diez. Solo dice cuántas filas hay y si el
// valor parece hash o no.
//
//   node pruebas/auditar-credenciales.mjs
// ============================================================================
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { RAIZ } from "./cargar-maestro.mjs";

// Tablas que el código consulta, más la del login legacy.
const LEGACY = ["operadores"];

// Dos niveles, porque con un solo patrón la auditoría se llenaba de falsos
// positivos y dejaba de leerse. `dupletas.clave` es
// "hipodromo|fecha|carrera1|carrera2": una clave de negocio, no una credencial.
//
//  FUERTE = el nombre no admite otra lectura. Si guarda algo que no parece hash,
//           es una credencial en texto plano.
//  AMBIGUA = "clave" y "token" a secas son palabras que en este sistema también
//           son datos de negocio. Se informa, pero no se falla: que alguien lo
//           revise, sin romper la suite por un nombre.
//
// OJO con los que arrancan con algo antes del nombre (`portal_clave`,
// `portal_token`, `reset_token`): son credenciales de acceso al portal y NO
// pueden quedar en la columna "ambigua". Se encontraron legibles con la llave
// anon, con el token y la clave de entrada de los 16 clientes, y el propio
// portal comparaba `portal_clave` en el navegador. Eso no lo atrapa un patrón
// anclado: hace falta mirar el sufijo también.
const CRED_FUERTE = /^(password|passwd|pass|pwd|contrasena|contraseña|secret|api_key|apikey|salt|hash)/i;
const CRED_CON_SUFIJO = /^(portal_clave|portal_token|clave_acceso|token_acceso|reset_token|verification_token|recovery_token|api_token)$/i;
const CRED_AMBIGUA = /^(clave|token|pin)$/i;

const esCredencialFuerte = (c) => CRED_FUERTE.test(c) || CRED_CON_SUFIJO.test(c);
const esCredencialAmbigua = (c) => !esCredencialFuerte(c) && CRED_AMBIGUA.test(c);

/** Un valor con estas formas es un hash; cualquier otra cosa es texto plano. */
function pareceHash(v) {
  const s = String(v ?? "");
  if (s.length < 20) return false;
  return (
    /^\$2[aby]\$/.test(s) || // bcrypt
    /^\$argon2(id|i|d)?\$/.test(s) || // argon2
    /^[0-9a-f]{40,}$/i.test(s) || // sha1/sha256 hex
    /^[A-Za-z0-9+/]{27,}={0,2}$/.test(s) // base64
  );
}

function listarArchivos(dir, exts, out = []) {
  let entradas;
  try {
    entradas = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entradas) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) listarArchivos(p, exts, out);
    else if (exts.some((x) => e.endsWith(x))) out.push(p);
  }
  return out;
}

function leerEnv() {
  const env = {};
  try {
    for (const l of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
      const m = l.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* sin .env.local */
  }
  return env;
}

const env = leerEnv();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !anon) {
  console.log("  FALLA sin NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY en .env.local");
  process.exit(1);
}
const db = createClient(url, anon, { auth: { persistSession: false } });

// --- tablas que toca el código --------------------------------------------
const tablas = new Set(LEGACY);
for (const p of listarArchivos(join(RAIZ, "src"), [".ts", ".tsx"])) {
  for (const m of readFileSync(p, "utf8").matchAll(/\.from\(\s*["'`]([a-z_][a-z0-9_]*)["'`]\s*\)/gi)) {
    tablas.add(m[1]);
  }
}
const ordenadas = [...tablas].sort();

let hallazgos = 0;
const marcar = (mal) => {
  hallazgos++;
  console.log(`  FALLA ${mal}`);
};

console.log("\n[1] Columnas de credencial legibles con la llave anon");
console.log("=".repeat(70));
console.log(`  revisando ${ordenadas.length} tablas que usa la aplicacion`);
console.log("");

for (const tabla of ordenadas) {
  // Se pide una sola fila y solo las claves: el objetivo es ver los NOMBRES de
  // las columnas, no leer contenido.
  const { data, error } = await db.from(tabla).select("*").limit(1);
  if (error) continue; // tabla inexistente o RLS la oculta: no se puede auditar
  if (!data || !data.length) continue; // vacía: no expone nada

  const fuertes = Object.keys(data[0]).filter(esCredencialFuerte);
  const ambiguas = Object.keys(data[0]).filter(esCredencialAmbigua);
  if (!fuertes.length && !ambiguas.length) continue;

  console.log(`  ${tabla}`);
  const { count } = await db.from(tabla).select("*", { count: "exact", head: true });
  for (const col of fuertes) {
    // "¿Hay ALGUNA fila con esto poblado?", y no "mirá la primera".
    //
    // La primera versión leía `limit(1)` y daba por buena la columna si esa fila
    // venía vacía. Con `clientes` pasaba justo eso: 1 de 16 clientes tiene el
    // portal habilitado, así que la fila que tocó no traía `portal_clave` y la
    // auditoría|ga reported OK con la credencial de acceso del portal expuesta
    // en la base. Un NULL no es una credencial protegida.
    const { count: pobladas, error: eCount } = await db
      .from(tabla)
      .select("*", { count: "exact", head: true })
      .not(col, "is", null);
    if (eCount) {
      console.log(`    ?     ${col}: no se pudo contar (${eCount.message.slice(0, 40)})`);
      continue;
    }
    if (!pobladas) {
      console.log(`    ok    ${col}: sin valores en ninguna fila`);
      continue;
    }
    const { data: fila } = await db.from(tabla).select(col).not(col, "is", null).limit(1);
    const valor = fila?.[0]?.[col];
    if (valor == null || valor === "") {
      console.log(`    ok    ${col}: ${pobladas} fila(s) pero todas vacias`);
      continue;
    }
    if (pareceHash(valor)) {
      console.log(`    ok    ${col}: parece hash (${String(valor).length} chars, ${pobladas} fila(s))`);
    } else {
      console.log(`    FALLA ${col}: TEXTO PLANO en ${pobladas} fila(s) de ${count}, legible con la llave anon`);
      hallazgos++;
    }
  }
  for (const col of ambiguas) {
    const { count: pobladas } = await db
      .from(tabla)
      .select("*", { count: "exact", head: true })
      .not(col, "is", null);
    const { data: fila } = await db.from(tabla).select(col).not(col, "is", null).limit(1);
    const valor = fila?.[0]?.[col];
    const clase = valor != null && valor !== "" && !pareceHash(valor) ? "texto plano" : "hash o vacia";
    console.log(`    ?     ${col}: nombre ambiguo, valor ${clase} (${pobladas} filas) - revisar a mano`);
  }
  console.log("");
}

console.log(`\n${hallazgos ? "HAY FALLAS" : "TODO OK"}: ${hallazgos} problema(s)`);
if (hallazgos) {
  console.log("\nQue hacer, en orden de impacto:");
  console.log("  1. CAMBIAR esas contrasenas YA. Es lo primero: la exposure no se");
  console.log("     arregla bloqueando la lectura despues, se arregla rotando.");
  console.log("  2. node pruebas/crear-admin.mjs josorioc \"NUEVA\"   (credencial real)");
  console.log("  3. En Supabase: Authentication > Users, rotar las demas cuentas.");
  console.log("  4. Aplicar src/db/retirar-legacy-operadores.sql: RLS sin policies");
  console.log("     para anon, asi la tabla deja de ser legible de una vez.");
  console.log("  5. Cuando se confirme que nadie la necesita, DROP TABLE public.operadores.");
  console.log("\n  Ojo: hasta que se roten, cualquiera que abra devtools en el sitio puede");
  console.log("  leerlas. No hace falta saber nada del sistema, solo copiar la llave anon.");
}
console.log("");
process.exit(hallazgos ? 1 : 0);
