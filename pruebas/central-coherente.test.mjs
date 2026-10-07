// ============================================================================
// Coherencia Tablas Fijas <-> CENTRAL (Carreras del Dia).
//
// LA DIRECCION DEL DATO: la carrera se REGISTRA en Carreras del Dia
// (`resultados_carreras`) con fecha + hipodromo + carrera + ejemplares, y Tablas
// Fijas se ALIMENTA de ahi. Publicar una tabla NO crea la carrera.
//
// El bug que motivó esto: el 2026-09-27 se publicaron 14 carreras en
// `tablas_fijas` y el central TENIA 0 filas de ese dia, asi que /marcas,
// /dupleta y Carreras del Dia no mostraban ninguna. La causa fue de DATOS (las
// 14 no se habian registrado en el central), no de codigo.
//
// Esta prueba corre contra la base real, en modo SOLO LECTURA, y verifica:
//   1. toda carrera de `tablas_fijas` con ejemplares tiene su fila en el
//      central CON los mismos ejemplares;
//   2. el central NO inventa ejemplares que la tabla no tiene;
//   3. el central NO tiene resultados cargados que nadie liquidó.
// No escribe nada.
//
// Si (1) falla, el arreglo NO es tocar `publicarTabla`: es registrar la
// carrera en Carreras del Dia (Ensamblaje / Gaceta) o correr
// pruebas/backfill-carreras-centrales.mjs.
//
// Corre con pruebas/run-marcas.ps1
// ============================================================================
import { readFileSync } from "node:fs";

let pasan = 0;
let fallan = 0;
const ok = (m) => { pasan++; console.log(`  ok   ${m}`); };
const mal = (m, d) => { fallan++; console.log(`  FALLA ${m}${d ? `\n         ${d}` : ""}`); };

function leerEnv() {
  const salida = {};
  let txt = "";
  try { txt = readFileSync(".env.local", "utf8"); } catch { txt = ""; }
  for (const l of txt.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i.exec(l);
    if (m) salida[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return salida;
}

const env = leerEnv();
const URL = env.NEXT_PUBLIC_SUPABASE_URL || "";
const H = {
  apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
  Authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""}`,
};

if (!URL || !H.apikey) {
  console.log("  FALLA sin credenciales en .env.local; no puedo verificar el central");
  process.exit(1);
}

async function pedir(tabla) {
  const r = await fetch(`${URL}/rest/v1/${tabla}?select=*&limit=2000`, { headers: H });
  const t = await r.text();
  try { const d = JSON.parse(t); return Array.isArray(d) ? d : []; } catch { return []; }
}

const tf = await pedir("tablas_fijas");
const rc = await pedir("resultados_carreras");

if (!tf.length) { console.log("  FALLA no pude leer tablas_fijas (RLS?); la prueba no serviria de nada"); process.exit(1); }
if (!rc.length) { console.log("  FALLA no pude leer resultados_carreras (RLS?); la prueba no serviria de nada"); process.exit(1); }

const clave = (f, h, c) => `${String(f || "").slice(0, 10)}|${String(h || "").trim().toUpperCase()}|${Number(c) || 0}`;
const nCab = (x) => (Array.isArray(x) ? x.length : 0);

const central = new Map();
for (const r of rc) central.set(clave(r.fecha, r.hipodromo, r.carrera), r);

const fechas = [...new Set(tf.map((t) => String(t.fecha || "").slice(0, 10)).filter(Boolean))].sort();

console.log("\n-- Publicar una tabla tiene que dejar la carrera en el central");
console.log(`   tablas_fijas: ${tf.length} · resultados_carreras: ${rc.length} · fechas: ${fechas.join(", ")}`);

for (const f of fechas) {
  const conCab = tf.filter((t) => String(t.fecha || "").slice(0, 10) === f && nCab(t.caballos) > 0);
  const faltan = [];
  const vacias = [];
  for (const t of conCab) {
    const c = central.get(clave(t.fecha, t.hipodromo, t.carrera));
    if (!c) faltan.push(`C${t.carrera}`);
    else if (nCab(c.caballos) === 0) vacias.push(`C${t.carrera}`);
  }
  const etiqueta = `${f} · ${conCab.length} publicadas con ejemplares`;
  if (!faltan.length && !vacias.length) ok(`${etiqueta} -> todas en el central con sus ejemplares`);
  else if (faltan.length) mal(`${etiqueta} -> ${faltan.length} SIN fila en el central`, `faltan: ${faltan.join(", ")}`);
  else mal(`${etiqueta} -> ${vacias.length} con ejemplares vacios en el central`, `vacias: ${vacias.join(", ")}`);
}

console.log("\n-- El central no inventa ejemplares que la tabla no tiene");
let discrepancias = 0;
for (const t of tf) {
  const c = central.get(clave(t.fecha, t.hipodromo, t.carrera));
  if (!c) continue;
  const enTabla = nCab(t.caballos);
  const enCentral = nCab(c.caballos);
  if (enCentral > enTabla) {
    discrepancias++;
    if (discrepancias <= 5) mal(`C${t.carrera} del ${String(t.fecha).slice(0, 10)}: central ${enCentral} > tabla ${enTabla}`);
  }
}
if (!discrepancias) ok("ninguna carrera tiene mas ejemplares en el central que en su tabla");

// El usuario NO ha cargado ningun resultado a mano. Si el central aparece con
// ganadores u orden de llegada sin que la tabla este liquidada, es dato
// fabricado y hay que borrarlo.
console.log("\n-- El central no tiene resultados que nadie liquidó");
const liquidadas = new Set(
  tf
    .filter((t) => t.estado_liquidacion || t.estado === "Liquidada" || t.estado === "liquidada")
    .map((t) => clave(t.fecha, t.hipodromo, t.carrera))
);
let conResultados = 0;
const marcadas = [];
for (const r of rc) {
  const k = clave(r.fecha, r.hipodromo, r.carrera);
  if (liquidadas.has(k)) continue;
  const hayGanador = Array.isArray(r.ganadores) ? r.ganadores.length > 0 : r.ganadores != null;
  const hayOrden = r.orden_llegada != null && String(r.orden_llegada).trim() !== "";
  if (!hayGanador && !hayOrden) continue;
  conResultados++;
  if (marcadas.length < 6) marcadas.push(`C${r.carrera} del ${String(r.fecha).slice(0, 10)}`);
}
if (!conResultados) ok(`ninguna de las ${rc.length} carreras del central tiene ganador u orden de llegada`);
else mal(`${conResultados} carreras del central tienen resultado sin liquidacion`, marcadas.join(", "));

console.log(`\nTODAS: ${pasan} pasaron, ${fallan} fallaron`);
process.exit(fallan ? 1 : 0);
