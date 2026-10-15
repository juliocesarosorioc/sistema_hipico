// ============================================================================
// DIAGNÓSTICO DE LA JORNADA PARTIDA — 04-10-2026.
//
// SOLO LECTURA. No escribe nada en la base.
//
// CONTEXTO
// El 04-10-2026 se publicaron 13 carreras. El chequeo de coherencia reporta:
//     2026-10-04 -> 9 publicadas SIN fila en el central (C1..C9)
//     2026-04-10 -> 3 publicadas SIN fila en el central (C10, C11, C12)
// Las C10-C12 quedaron fechadas en `2026-04-10` (10 de ABRIL) en vez de
// `2026-10-04`. Los módulos filtran por `2026-10-04`, así que esas tres no
// aparecen en Tablas Fijas ni en Gestión de Jugadas.
//
// ESTE SCRIPT DICE EXACTO QUÉ PASA, PARA CADA CARRERA:
//   - en qué fecha está en `tablas_fijas` (la que el operador usó),
//   - si existe fila en `resultados_carreras` con ESA fecha,
//   - si existe con OTRA fecha (la ambigua),
//   - cuántos ejemplares tiene cada lado.
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
const KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const FECHA_QUE_BUSCA = process.argv[2] || "2026-10-04";

if (!URL || !KEY) {
  console.log("\nFalta NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY en .env.local");
  console.log(`\nHAY FALLAS: 0 ok, 1 fallas\n`);
  process.exit(1);
}

async function get(ruta) {
  const r = await fetch(`${URL}/rest/v1/${ruta}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: "return=representation" },
  });
  const t = await r.text();
  let j = null;
  try { j = JSON.parse(t); } catch { j = null; }
  return { status: r.status, data: Array.isArray(j) ? j : [], error: Array.isArray(j) ? null : (j?.message ?? t) };
}

console.log(`\n== Diagnostico de la jornada ${FECHA_QUE_BUSCA} (solo lectura) ==`);

const tablas = await get(
  `tablas_fijas?select=fecha,hipodromo,carrera,estado,caballos,distancia_carrera,superficie,premio_original` +
  `&fecha=in.(${FECHA_QUE_BUSCA},2026-04-10)&order=hipodromo,carrera`
);

if (tablas.error) {
  console.log(`  No se pudo leer tablas_fijas: ${tablas.error}`);
  console.log(`\nHAY FALLAS: 0 ok, 1 fallas\n`);
  process.exit(1);
}

if (!tablas.data.length) {
  console.log(`  No hay tablas publicadas en ${FECHA_QUE_BUSCA} ni en 2026-04-10.`);
  console.log(`\nTODO OK: 0 ok, 0 fallas\n`);
  process.exit(0);
}

const clave = (h, c) => `${String(h ?? "").trim().toUpperCase()}|${Number(c) || 0}`;
const porHipodromo = new Map();
for (const t of tablas.data) {
  const k = clave(t.hipodromo, t.carrera);
  if (!porHipodromo.has(k)) porHipodromo.set(k, []);
  porHipodromo.get(k).push(t);
}

console.log(`\n  Publicadas leidas: ${tablas.data.length}`);

// Lee el central para las MISMAS fechas.
const fechas = [...new Set(tablas.data.map((t) => t.fecha))].join(",");
const central = await get(
  `resultados_carreras?select=fecha,hipodromo,carrera,caballos,ganadores,aplicado_a_tablas,distancia,superficie,premio` +
  `&fecha=in.(${fechas})`
);
if (central.error) console.log(`  (aviso) No se pudo leer resultados_carreras: ${central.error}`);

const centralPorClave = new Map();
for (const c of central.data) {
  const k = clave(c.hipodromo, c.carrera);
  if (!centralPorClave.has(k)) centralPorClave.set(k, []);
  centralPorClave.get(k).push(c);
}

console.log("\n== Cada carrera publicada, con su fecha en el central ==");
let sinCentral = 0;
let conFechaDistinta = 0;

for (const t of tablas.data) {
  const k = clave(t.hipodromo, t.carrera);
  const cabT = Array.isArray(t.caballos) ? t.caballos.length : 0;
  const filas = centralPorClave.get(k) ?? [];
  const misma = filas.filter((c) => String(c.fecha).slice(0, 10) === String(t.fecha).slice(0, 10));
  const otra = filas.filter((c) => String(c.fecha).slice(0, 10) !== String(t.fecha).slice(0, 10));

  if (!cabT) continue;

  if (misma.length) {
    const cabC = Array.isArray(misma[0].caballos) ? misma[0].caballos.length : 0;
    ok(`${t.hipodromo} C${t.carrera} · tabla ${String(t.fecha).slice(0, 10)} -> central OK (${cabT} ejemplares, central ${cabC})`);
  } else if (otra.length) {
    conFechaDistinta++;
    mal(
      `${t.hipodromo} C${t.carrera} · tabla ${String(t.fecha).slice(0, 10)} -> NO hay central en esa fecha`,
      `pero SI en ${otra.map((c) => String(c.fecha).slice(0, 10)).join(", ")}  ->  FECHA AMBIGUA (la Gaceta la escribio al reves)`
    );
  } else {
    sinCentral++;
    mal(`${t.hipodromo} C${t.carrera} · tabla ${String(t.fecha).slice(0, 10)} -> NO existe en el central (${cabT} ejemplares)`);
  }
  if (otra.length && misma.length) {
    mal(
      `${t.hipodromo} C${t.carrera} · esta carrera esta en el central en DOS fechas`,
      `${filas.map((c) => String(c.fecha).slice(0, 10)).join(" y ")}  ->  la jornada esta partida`
    );
  }
}

console.log(`\n== Resumen ==`);
console.log(`  publicadas con ejemplares, sin fila en el central : ${sinCentral}`);
console.log(`  con el central en OTRA fecha (fecha ambigua)     : ${conFechaDistinta}`);

console.log(`\n== Como se arregla ==`);
if (sinCentral || conFechaDistinta) {
  console.log(`  Es un problema de DATOS, no de codigo: las carreras estan publicadas en`);
  console.log(`  tablas_fijas pero no llegaron al central (resultados_carreras), que es lo que`);
  console.log(`  leen Marcas, Gestion de Jugadas y Dupletas. El codigo ya no lo vuelve a`);
  console.log(`  pasar (publicarTabla sincroniza el central), pero estas filas hay que crearlas.`);
  console.log("");
  console.log(`  Aplicar en el SQL Editor de Supabase (escribe SOLO en resultados_carreras):`);
  console.log(`      sql/reparar_central_desde_tablas.sql`);
  console.log("");
  console.log(`  Trae un informe antes de escribir y reconcilia la fecha ambigua:`);
  console.log(`  ${conFechaDistinta} carrera(s) con la fecha invertida.`);
} else {
  console.log(`  El central esta completo para esa jornada. Si aun no se ven en Tablas Fijas`);
  console.log(`  ni en Gestion de Jugadas, el problema ya no es de datos: revisar el filtro de`);
  console.log(`  fecha de cada pantalla y la cache del registro central.`);
}

console.log(`\n${fallan === 0 ? "TODO OK" : "HAY FALLAS"}: ${pasan} ok, ${fallan} fallaron\n`);
process.exit(fallan > 0 ? 1 : 0);
