// ============================================================================
// Backfill: pasar las tablas publicadas a la carrera CENTRAL.
//
// Publicar una tabla escribia solo en `tablas_fijas`. Como /marcas, /dupleta y
// Carreras del Dia leen `resultados_carreras`, una jornada publicada completa
// quedaba invisible en esos modulos. Esto rellena lo que ya se publico.
//
// NO toca resultados: `ganadores`, `retirados`, `dividendos`, `orden_llegada` y
// `premio_oficial/premio_recalculado` no se escriben, asi que la liquidacion
// previa se conserva. Solo oferta: `caballos`, `distancia`, `superficie`,
// `premio`.
//
//   node pruebas/backfill-carreras-centrales.mjs              (solo informe)
//   node pruebas/backfill-carreras-centrales.mjs --aplicar    (escribe)
//   node pruebas/backfill-carreras-centrales.mjs --aplicar --fecha 2026-09-27
// ============================================================================
import { readFileSync } from "node:fs";

const env = {};
for (const l of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i.exec(l);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const HEAD = {
  apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  Authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
  "Content-Type": "application/json",
};

const APLICAR = process.argv.includes("--aplicar");
const iFecha = process.argv.indexOf("--fecha");
const SOLO_FECHA = iFecha >= 0 ? process.argv[iFecha + 1] : null;

let pasan = 0;
let fallan = 0;
const ok = (m) => { pasan++; console.log(`  ok    ${m}`); };
const mal = (m, d) => { fallan++; console.log(`  FALLA ${m}${d ? `\n          ${d}` : ""}`); };

async function pedir(ruta, opciones = {}) {
  const r = await fetch(`${URL}/rest/v1/${ruta}`, {
    ...opciones,
    headers: { ...HEAD, ...(opciones.headers ?? {}) },
  });
  const t = await r.text();
  let d = null;
  try { d = t ? JSON.parse(t) : null; } catch { d = t; }
  return { status: r.status, d, txt: t };
}

const clave = (f, h, c) => `${f}|${String(h ?? "").trim().toUpperCase()}|${c}`;

const tf = await pedir("tablas_fijas?select=*&limit=2000");
if (!Array.isArray(tf.d)) {
  console.log(`No pude leer tablas_fijas (${tf.status}): ${String(tf.txt).slice(0, 200)}`);
  process.exit(1);
}
const rc = await pedir("resultados_carreras?select=*&limit=2000");
if (!Array.isArray(rc.d)) {
  console.log(`No pude leer resultados_carreras (${rc.status}): ${String(rc.txt).slice(0, 200)}`);
  process.exit(1);
}

const enCentral = new Map(rc.d.map((r) => [clave(r.fecha, r.hipodromo, r.carrera), r]));

const porFecha = new Map();
for (const t of tf.d) {
  const f = (t.fecha ?? "").slice(0, 10);
  if (!f) continue;
  if (SOLO_FECHA && f !== SOLO_FECHA) continue;
  if (!porFecha.has(f)) porFecha.set(f, []);
  porFecha.get(f).push(t);
}

const dias = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
console.log(`tablas_fijas: ${tf.d.length} · resultados_carreras: ${rc.d.length}`);
console.log(`modo: ${APLICAR ? "ESCRIBIR" : "solo informe"}${SOLO_FECHA ? ` · fecha ${SOLO_FECHA}` : ""}\n`);

let aCrear = 0;
let aCompletar = 0;

for (const [f, rows] of [...porFecha.entries()].sort()) {
  const dow = dias[new Date(`${f}T12:00:00Z`).getUTCDay()];
  console.log(`--- ${f} (${dow}) · ${rows.length} publicadas`);

  for (const t of rows) {
    const k = clave(f, t.hipodromo, t.carrera);
    const existe = enCentral.get(k);
    const cab = Array.isArray(t.caballos) ? t.caballos.length : 0;
    const cabCentral = existe && Array.isArray(existe.caballos) ? existe.caballos.length : 0;
    const etiqueta = `${String(t.hipodromo).padEnd(15)} C${String(t.carrera).padEnd(3)} ${String(cab).padStart(2)} ejemplares`;

    if (!existe) {
      aCrear++;
      if (!APLICAR) { console.log(`  nuevo  ${etiqueta}`); continue; }
      const r = await pedir("resultados_carreras?on_conflict=fecha,hipodromo,carrera", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(filaDe(t, f)),
      });
      if (r.status >= 200 && r.status < 300) ok(`creada en el central · ${etiqueta}`);
      else mal(`no se pudo crear · ${etiqueta}`, `status ${r.status}: ${String(r.txt).slice(0, 180)}`);
      continue;
    }

    if (cabCentral === cab && cab > 0) continue; // ya está
    aCompletar++;
    if (cabCentral > 0) continue; // no pisar una lista más rica sin permiso
    if (!APLICAR) { console.log(`  faltan ${etiqueta} (central tiene ${cabCentral} ejemplares)`); continue; }
    const r = await pedir("resultados_carreras?on_conflict=fecha,hipodromo,carrera", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(filaDe(t, f)),
    });
    if (r.status >= 200 && r.status < 300) ok(`ejemplares volcados al central · ${etiqueta}`);
    else mal(`no se pudieron volcar los ejemplares · ${etiqueta}`, `status ${r.status}: ${String(r.txt).slice(0, 180)}`);
  }
  console.log("");
}

function filaDe(t, f) {
  // Solo oferta. Lo que es resultado NO va: el merge-duplicates actualiza solo
  // las columnas presentes, asi que lo que no se manda queda como estaba.
  const fila = {
    fecha: f,
    hipodromo: String(t.hipodromo ?? "").trim().toUpperCase(),
    carrera: Number(t.carrera) || 0,
    caballos: Array.isArray(t.caballos) ? t.caballos : [],
    aplicado_a_tablas: false,
  };
  const dist = String(t.distancia_carrera ?? "").trim();
  const sup = String(t.superficie ?? "").trim();
  const prem = Number(t.premio_original);
  if (dist) fila.distancia = dist;
  if (sup) fila.superficie = sup;
  if (Number.isFinite(prem) && prem > 0) fila.premio = prem;
  return fila;
}

console.log(`a crear: ${aCrear} · a completar: ${aCompletar}`);
console.log(`\nTODAS: ${pasan} pasaron, ${fallan} fallaron`);
if (!APLICAR && (aCrear || aCompletar)) {
  console.log("\n(dry-run: repetí con --aplicar para escribir)");
}
process.exit(fallan ? 1 : 0);
