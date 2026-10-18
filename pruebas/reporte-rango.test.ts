// ============================================================================
// RANGO DEL REPORTE DE SALDOS CONSOLIDADOS — extremos independientes.
//
// El monitor (ReporteModule) trae por defecto el DÍA de hoy, pero el usuario
// puede fijar solo el "desde" o solo el "hasta". Antes `construirReporteSemana`
// exigía AMBOS: con uno solo ignoraba el filtro entero y el reporte volvía a la
// semana fiscal completa (el usuario veía que su rango "se borraba").
// `rangoReporteDe` es la regla pura que resuelve esa mezcla.
//
// Corre con:  node pruebas/correr.cjs
// ============================================================================
import { rangoReporteDe } from "../src/features/liquidacion/lib/reportes";

let pasan = 0;
let fallan = 0;
const ok = (m: string) => { pasan++; console.log(`  ok   ${m}`); };
const mal = (m: string, d?: string) => { fallan++; console.log(`  FALLA ${m}${d ? `\n         ${d}` : ""}`); };
const si = (c: boolean, m: string, d?: string) => (c ? ok(m) : mal(m, d));

/** Ciclo fiscal de una semana tipo (Lun 19 → Dom 25 de octubre de 2026). */
const base = () => ({ inicio: "2026-10-19", fin: "2026-10-25" });

// ---------------------------------------------------------------------------
// 1. Sin filtros: se usa el ciclo fiscal completo del grupo
// ---------------------------------------------------------------------------
console.log("\n== Sin filtros: ciclo fiscal completo ==");
{
  const r = rangoReporteDe(base());
  si(r.desde === "2026-10-19" && r.hasta === "2026-10-25",
    "sin opciones devuelve [inicio, fin] de la semana", JSON.stringify(r));
}

// ---------------------------------------------------------------------------
// 2. Solo "desde": el "hasta" cae al fin de la semana (NO se ignora el filtro)
// ---------------------------------------------------------------------------
console.log("\n== Solo el extremo 'desde' ==");
{
  const r = rangoReporteDe(base(), { desde: "2026-10-20" });
  si(r.desde === "2026-10-20" && r.hasta === "2026-10-25",
    "fija el 20 y completa con el fin de la semana", JSON.stringify(r));
}

// ---------------------------------------------------------------------------
// 3. Solo "hasta": el "desde" cae al inicio de la semana
// ---------------------------------------------------------------------------
console.log("\n== Solo el extremo 'hasta' ==");
{
  const r = rangoReporteDe(base(), { hasta: "2026-10-22" });
  si(r.desde === "2026-10-19" && r.hasta === "2026-10-22",
    "fija el 22 y completa con el inicio de la semana", JSON.stringify(r));
}

// ---------------------------------------------------------------------------
// 4. Ambos extremos: manda lo que pidió el usuario (un solo día = hoy)
// ---------------------------------------------------------------------------
console.log("\n== Rango explícito de un solo día (hoy) ==");
{
  const r = rangoReporteDe(base(), { desde: "2026-10-19", hasta: "2026-10-19" });
  si(r.desde === "2026-10-19" && r.hasta === "2026-10-19",
    "el día de hoy se respeta tal cual", JSON.stringify(r));
}

// ---------------------------------------------------------------------------
// 5. Cadenas vacías cuentan como "sin filtro" (input date limpiado)
// ---------------------------------------------------------------------------
console.log("\n== Cadenas vacías = sin filtro ==");
{
  const r = rangoReporteDe(base(), { desde: "", hasta: "" });
  si(r.desde === "2026-10-19" && r.hasta === "2026-10-25",
    "vacío → ciclo fiscal del grupo", JSON.stringify(r));
}

// ---------------------------------------------------------------------------
// 6. Rango invertido: se ordena (nunca devuelve un rango vacío)
// ---------------------------------------------------------------------------
console.log("\n== Rango invertido se ordena ==");
{
  const r = rangoReporteDe(base(), { desde: "2026-10-24", hasta: "2026-10-20" });
  si(r.desde === "2026-10-20" && r.hasta === "2026-10-24",
    "desde > hasta → se intercambian", JSON.stringify(r));
}

// ---------------------------------------------------------------------------
// 7. No muta la entrada (las opciones quedan intactas)
// ---------------------------------------------------------------------------
console.log("\n== No muta las opciones recibidas ==");
{
  const opts = { desde: "2026-10-24", hasta: "2026-10-20" };
  rangoReporteDe(base(), opts);
  si(opts.desde === "2026-10-24" && opts.hasta === "2026-10-20",
    "no comparte estado con quien llama", JSON.stringify(opts));
}

console.log(`\n${pasan} pasaron, ${fallan} fallaron`);
if (fallan > 0) process.exit(1);
