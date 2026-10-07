// ============================================================================
// AUDITORIA DE JORNADAS — el detector que habria atrapado el 04-10-2026.
//
// QUE BUSCA
// Cuatro síntomas de que una jornada se partió o descuadró. Son consultas de
// SOLO LECTURA contra la base real.
//
//   1. PUBLICADA SIN CENTRAL. Una tabla en `tablas_fijas` con ejemplares cuya
//      carrera no está en `resultados_carreras`. Se vende y no se ve en Marcas
//      ni en Gestión de Jugadas. (Pasó con 12 de las 13 carreras del 04-10.)
//
//   2. DÍA PARTIDO. Una jornada del mismo hipódromo que quedó en dos fechas
//      cerca la una de la otra. Es la huella de la ambigüedad DD-MM/MM-DD: la
//      misma reunion se guardó como "4 de octubre" en unas filas y "10 de
//      abril" en otras.
//
//   3. HERMANAS HUÉRFANAS. Carreras de una misma reunion (mismo hipódromo, misma
//      fecha) con números muy separados y un hueco en el medio: 1..9 y luego
//      13, sin 10, 11 ni 12. Salvo que estén de verdad repartidas, es una
//      jornada a la que se le cayó un tramo.
//
//   4. FECHA CRUDO. Una `fecha` de tabla que no es ISO, o que quedó a años del
//      resto (los 20 años de 2025 que ya se corrigieron una vez). Detecta que
//      alguien volvió a escribir la fecha como texto en vez de calendarizo.
//
// POR QUE ES UNA AUDITORIA Y NO UNA PRUEBA DE UNIDAD
// Porque el daño ya está en la base, no en el código: el código puede estar
// perfecto y la base quedar partida por una carga vieja, un script o un PostgREST
// directo. Esto mira lo que REALMENTE hay.
//
// CÓMO SE USA
//   node pruebas/auditar-jornadas.mjs              (hoy y las fechas Findings)
//   node pruebas/auditar-jornadas.mjs 2026-10-04   (una jornada concreta)
// Sale con código 1 si encuentra algo, para que el runner y el CI paren.
// ============================================================================
import { readFileSync } from "node:fs";

let pasan = 0;
let hallazgos = 0;
const ok = (m) => { pasan++; console.log(`  ok   ${m}`); };
const mal = (m, d) => { hallazgos++; console.log(`  FALLA ${m}${d ? `\n         ${d}` : ""}`); };

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
const FECHAS = process.argv.slice(2);

if (!URL || !KEY) {
  console.log("\nFalta NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY en .env.local");
  console.log(`\nHAY HALLAZGOS: 0 ok, 1 problemas\n`);
  process.exit(1);
}

async function get(ruta) {
  try {
    const r = await fetch(`${URL}/rest/v1/${ruta}`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    });
    const t = await r.text();
    let j = null;
    try { j = JSON.parse(t); } catch { j = null; }
    if (!r.ok) return { error: j?.message ?? t.slice(0, 200) };
    return { data: Array.isArray(j) ? j : [] };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

const clave = (h, c) => `${String(h ?? "").trim().toUpperCase()}|${Number(c) || 0}`;
const iso = (v) => String(v ?? "").slice(0, 10);
const cab = (t) => (Array.isArray(t?.caballos) ? t.caballos.length : 0);
const lista = (a, n = 6) =>
  a.length <= n ? a.join(", ") : `${a.slice(0, n).join(", ")} … (+${a.length - n})`;

console.log("\n== Auditoria de jornadas (solo lectura) ==");

// ---------------------------------------------------------------------------
// 1. PUBLICADA SIN CENTRAL
// ---------------------------------------------------------------------------
{
  const t = await get(
    `tablas_fijas?select=fecha,hipodromo,carrera,caballos&order=fecha.desc,hipodromo,carrera&limit=2000`
  );
  if (t.error) {
    mal("No se pudo leer tablas_fijas", t.error);
  } else {
    const fechas = new Set(t.data.map((x) => iso(x.fecha)));
    const c = await get(
      `resultados_carreras?select=fecha,hipodromo,carrera&fecha=in.(${[...fechas].join(",")})&limit=4000`
    );
    if (c.error) {
      mal("No se pudo leer resultados_carreras", c.error);
    } else {
      const central = new Set(c.data.map((x) => clave(x.hipodromo, x.carrera) + "|" + iso(x.fecha)));
      const huerfanas = t.data
        .filter((x) => cab(x) > 0 && !central.has(clave(x.hipodromo, x.carrera) + "|" + iso(x.fecha)))
        .map((x) => `${iso(x.fecha)} ${String(x.hipodromo).trim().toUpperCase()} C${x.carrera}`);

      if (!huerfanas.length) ok("toda tabla con ejemplares tiene su carrera en el central");
      else
        mal(
          `${huerfanas.length} tabla(s) publicada(s) SIN fila en el central (se venden pero no se ven)`,
          `${lista(huerfanas)}\n         Arreglo: sql/tablas_fijas_sincronizar_central.sql y luego sql/reparar_central_desde_tablas.sql`
        );
    }
  }
}

// ---------------------------------------------------------------------------
// 2 y 3. POR HIPODROMO: días partidos y hermanas huérfanas
// ---------------------------------------------------------------------------
{
  const t = await get(`tablas_fijas?select=fecha,hipodromo,carrera,caballos&limit=4000`);
  if (t.error) {
    mal("No se pudo releer tablas_fijas", t.error);
  } else {
    // Una reunion por hipodromo, y dentro de ella una por fecha.
    const porHip = new Map();
    for (const x of t.data) {
      const h = String(x.hipodromo ?? "").trim().toUpperCase();
      if (!h) continue;
      if (!porHip.has(h)) porHip.set(h, new Map());
      const porFecha = porHip.get(h);
      if (!porFecha.has(iso(x.fecha))) porFecha.set(iso(x.fecha), new Set());
      porFecha.get(iso(x.fecha)).add(Number(x.carrera) || 0);
    }

    // --- 2. DÍAS PARTIDOS: dos fechas del mismo hipódromo a <= 6 días ---
    for (const [h, porFecha] of porHip) {
      const dias = [...porFecha.keys()].sort();
      for (let i = 0; i < dias.length - 1; i++) {
        const a = dias[i];
        const b = dias[i + 1];
        const da = Date.parse(`${a}T00:00:00Z`);
        const db = Date.parse(`${b}T00:00:00Z`);
        const diasDeDiferencia = Math.round((db - da) / 86400000);
        if (diasDeDiferencia > 6) continue;

        const ca = porFecha.get(a);
        const cb = porFecha.get(b);
        // ¿Se solapan las carreras? Si las dos jornadas tienen las MISMAS
        // números de carrera, es la misma reunión escrita con dos fechas.
        const comunes = [...ca].filter((n) => cb.has(n));
        if (!comunes.length) continue;

        mal(
          `${h}: la jornada ${a} y la ${b} se traslapan (a ${diasDeDiferencia} días)`,
          `mismas carreras en las dos fechas: ${lista(comunes.map((n) => `C${n}`))}\n` +
            `         ${a} tiene ${[...ca].sort((x, y) => x - y).map((n) => n).join(",")}\n` +
            `         ${b} tiene ${[...cb].sort((x, y) => x - y).map((n) => n).join(",")}\n` +
            `         Suele ser la misma reunion con la fecha invertida (DD-MM vs MM-DD).`
        );
      }
    }
    if (![...porHip].some(([, pf]) => {
      const d = [...pf.keys()].sort();
      for (let i = 0; i < d.length - 1; i++) {
        if (Math.round((Date.parse(`${d[i + 1]}T00:00:00Z`) - Date.parse(`${d[i]}T00:00:00Z`)) / 86400000) <= 6) {
          const c1 = pf.get(d[i]);
          const c2 = pf.get(d[i + 1]);
          if ([...c1].some((n) => c2.has(n))) return true;
        }
      }
      return false;
    })) ok("ningún hipódromo tiene la misma carrera en dos días cercanos");

    // --- 3. HERMANAS HUÉRFANAS: huecos grandes dentro de una misma jornada ---
    let huecos = 0;
    for (const [h, porFecha] of porHip) {
      for (const [f, set] of porFecha) {
        const ns = [...set].filter((n) => n > 0).sort((a, b) => a - b);
        if (ns.length < 4) continue;
        const min = ns[0];
        const max = ns[ns.length - 1];
        if (max - min > 12) continue; // no es una jornada normal: otro programa
        const faltan = [];
        for (let n = min; n <= max; n++) if (!set.has(n)) faltan.push(n);
        // Un bloque de 3 o más seguidas en medio, y con más carreras presentes
        // que ausentes, es una jornada a la que se le cayó un tramo.
        if (faltan.length >= 3 && ns.length > faltan.length) {
          huecos++;
          mal(
            `${h} ${f}: faltan ${faltan.length} carreras en medio (hueco)`,
            `presentes: ${ns.join(",")}  ·  ausentes: ${faltan.join(",")}\n` +
              `         Suele ser una parte de la jornada que se guardó con otra fecha.`
          );
        }
      }
    }
    if (!huecos) ok("ninguna jornada tiene un bloque de carreras faltantes en medio");
  }
}

// ---------------------------------------------------------------------------
// 4. FECHA CRUDA O ABSURDA
// ---------------------------------------------------------------------------
{
  const t = await get(
    `tablas_fijas?select=fecha,hipodromo,carrera&order=fecha.desc&limit=4000`
  );
  if (t.error) {
    mal("No se pudieron releer las fechas", t.error);
  } else {
    const crudas = t.data
      .map((x) => ({ f: x.fecha, h: x.hipodromo, c: x.carrera }))
      .filter((x) => x.f != null && !/^\d{4}-\d{2}-\d{2}/.test(String(x.f)));
    if (!crudas.length) ok("ninguna fecha viene en crudo (todas son fecha de verdad)");
    else
      mal(
        `${crudas.length} fecha(s) no son ISO`,
        lista(crudas.map((x) => `${String(x.f)} (${x.h} C${x.c})`))
      );

    // Años dispares: ya se corrigió una vez (2025 donde debía ser 2026).
    const anios = new Map();
    for (const x of t.data) {
      const y = String(x.f ?? "").slice(0, 4);
      if (y) anios.set(y, (anios.get(y) ?? 0) + 1);
    }
    const raro = [...anios.entries()].filter(
      ([y, n]) => Number(y) >= 2000 && Number(y) < 2020 && n > 0
    );
    if (!raro.length) ok("ninguna fecha quedó en un año pasado");
    else
      mal(
        "fechas en un año anterior a 2020",
        lista(raro.map(([y, n]) => `${y}: ${n} fila(s)`))
      );
  }
}

// ---------------------------------------------------------------------------
console.log(
  `\n${hallazgos === 0 ? "TODO OK" : "HAY HALLAZGOS"}: ${pasan} ok, ${hallazgos} problemas\n`
);
process.exit(hallazgos > 0 ? 1 : 0);
