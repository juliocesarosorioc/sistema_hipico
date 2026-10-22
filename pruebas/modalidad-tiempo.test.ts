// ============================================================================
// MODALIDAD DE TIEMPO DE LA JUGADA — ⚡ EN VIVO vs ⏳ JUGADA ADELANTADA
//
// Una jugada puede cargarse ANTES de que corra la carrera (⏳ adelantada, la
// parada adelantada de cobro) o DURANTE (⚡ en vivo, el comportamiento de
// siempre). El atributo NUEVO es `es_adelantada` (booleano) — no confundir con
// `banquero_cliente.modalidad` ni con `nota_auditoria.modalidad`, que son el
// TIPO de producto (PUESTO/MARCAS/…) — y vive en:
//
//   · `tickets_apuestas.es_adelantada` (Taquilla, Marcas, Tablas, Dupletas, Remates)
//   · `polla_ventas.es_adelantada`     (Pollas)
//
// Qué protege esta prueba:
//   1. La LECTURA del flag es tolerante y por defecto NUNCA cambia nada
//      (todo lo que no diga "adelantada" es EN VIVO, la regla histórica).
//   2. El FILTRO segmentado del Reporte de Liquidación recorta las filas y con
//      ellas TODO lo que se calcula encima (riesgo, neto, subtotales).
//   3. Los marcadores compartidos de la UI (badge, etiquetas, clases).
//   4. La migración SQL trae las dos columnas y la RPC de Pollas, y NO cambia
//      ninguna firma de venta existente.
//   5. W.P.S. quedó inactiva (🚧 En Planificación) en los selectores, SIN tocar
//      el motor `motores/wps.ts`.
//
// Corre con:  node pruebas/correr.cjs
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  esAdelantadaDe,
  pasaFiltroModalidad,
  notaAuditoriaDe,
  toggleActiva,
  claseBotonToggle,
  MODALIDAD_POR_DEFECTO,
  BADGE_ADELANTADA,
  ETIQUETA_EN_VIVO,
  ETIQUETA_ADELANTADA,
  OPCIONES_FILTRO,
} from "../src/features/jugadas/lib/modalidad-tiempo";
import { esJugadaWps, WPS_PLANIFICACION } from "../src/features/motores/lib/wps-planificacion";
import { armarReporteCarrera } from "../src/features/liquidacion/lib/reporte-carrera";
import { normalizarVenta } from "../src/features/tablas/lib/reporte-tablas-nucleo";
import type { CarreraReporte, FilaReporte } from "../src/features/liquidacion/lib/reportes";

let pasan = 0;
let fallan = 0;
const ok = (m: string) => { pasan++; console.log(`  ok   ${m}`); };
const mal = (m: string, d?: string) => { fallan++; console.log(`  FALLA ${m}${d ? `\n         ${d}` : ""}`); };
const si = (c: boolean, m: string, d?: string) => (c ? ok(m) : mal(m, d));
const igual = (a: unknown, b: unknown, m: string) =>
  si(JSON.stringify(a) === JSON.stringify(b), m, `esperado ${JSON.stringify(b)} · recibido ${JSON.stringify(a)}`);

const raiz = process.cwd();
const leer = (...partes: string[]) => readFileSync(join(raiz, ...partes), "utf8");

// ---------------------------------------------------------------------------
console.log("\nBLOQUE 1 — lectura del flag es_adelantada");
// ---------------------------------------------------------------------------
igual(MODALIDAD_POR_DEFECTO, "EN_VIVO", "el default es EN VIVO (nadie cambia de comportamiento)");

si(esAdelantadaDe({ es_adelantada: true }), "booleano true → adelantada");
si(!esAdelantadaDe({ es_adelantada: false }), "booleano false → en vivo");
si(esAdelantadaDe({ es_adelantada: "true" }), "texto 'true' → adelantada");
si(esAdelantadaDe({ es_adelantada: "T" }), "texto 'T' → adelantada");
si(esAdelantadaDe({ es_adelantada: "1" }), "texto '1' → adelantada");
si(esAdelantadaDe({ es_adelantada: 1 }), "número 1 → adelantada");
si(!esAdelantadaDe({ es_adelantada: 0 }), "número 0 → en vivo");
si(!esAdelantadaDe({ es_adelantada: "no" }), "texto raro → en vivo (nunca rompe)");
si(!esAdelantadaDe({}), "fila sin el campo → en vivo");
si(!esAdelantadaDe(null), "null → en vivo");
si(!esAdelantadaDe(undefined), "undefined → en vivo");

// Respaldo: la columna puede no existir todavía y el flag venir en la nota.
si(
  esAdelantadaDe({ nota_auditoria: JSON.stringify({ es_adelantada: true }) }),
  "respaldo: nota_auditoria (texto JSON) con el flag embebido"
);
si(
  esAdelantadaDe({ nota_auditoria: { es_adelantada: true } }),
  "respaldo: nota_auditoria ya parseada"
);
si(
  esAdelantadaDe({ modalidad_tiempo: "ADELANTADA" }),
  "alternativa modalidad_tiempo = ADELANTADA"
);
si(
  !esAdelantadaDe({ modalidad_tiempo: "EN_VIVO" }),
  "alternativa modalidad_tiempo = EN_VIVO"
);
// La columna manda sobre el tipo de producto de la nota.
si(
  !esAdelantadaDe({ es_adelantada: false, nota_auditoria: '{"modalidad":"WPS"}' }),
  "nota_auditoria con modalidad de PRODUCTO (WPS) no se confunde con el tiempo"
);
si(
  !esAdelantadaDe({ nota_auditoria: "{no es json}" }),
  "nota_auditoria ilegible → en vivo, sin excepción"
);
igual(notaAuditoriaDe('{"a":1}'), { a: 1 }, "notaAuditoriaDe parsea texto");
igual(notaAuditoriaDe("nada"), null, "notaAuditoriaDe devuelve null si no hay JSON");

// ---------------------------------------------------------------------------
console.log("\nBLOQUE 2 — filtro segmentado (Todas / En Vivo / Adelantadas)");
// ---------------------------------------------------------------------------
const vivo = { es_adelantada: false };
const adelantada = { es_adelantada: true };

si(pasaFiltroModalidad(vivo, "TODAS"), "TODAS deja pasar en vivo");
si(pasaFiltroModalidad(adelantada, "TODAS"), "TODAS deja pasar adelantada");
si(pasaFiltroModalidad(vivo, "EN_VIVO"), "EN VIVO deja pasar en vivo");
si(!pasaFiltroModalidad(adelantada, "EN_VIVO"), "EN VIVO recorta adelantada");
si(pasaFiltroModalidad(adelantada, "ADELANTADA"), "ADELANTADA deja pasar adelantada");
si(!pasaFiltroModalidad(vivo, "ADELANTADA"), "ADELANTADA recorta en vivo");
si(pasaFiltroModalidad({}, null), "sin filtro (null) no recorta");
si(pasaFiltroModalidad(adelantada, undefined), "sin filtro (undefined) no recorta");

igual(OPCIONES_FILTRO.map((o) => o.id), ["TODAS", "EN_VIVO", "ADELANTADA"], "las tres opciones, en orden");
igual(OPCIONES_FILTRO[1].etiqueta, "⚡ Solo En Vivo", "etiqueta de la opción en vivo");
igual(OPCIONES_FILTRO[2].etiqueta, "⏳ Solo Adelantadas", "etiqueta de la opción adelantada");

igual(BADGE_ADELANTADA, "⏳ ADELANTADA", "badge distintivo de la jugada adelantada");
igual(ETIQUETA_EN_VIVO, "⚡ En Vivo", "etiqueta del toggle (en vivo)");
igual(ETIQUETA_ADELANTADA, "⏳ Jugada Adelantada", "etiqueta del toggle (adelantada)");
si(toggleActiva("EN_VIVO", "EN_VIVO") && !toggleActiva("EN_VIVO", "ADELANTADA"), "toggleActiva marca el elegido");
si(claseBotonToggle(true).includes("bg-amber-500"), "el botón activo del toggle se pinta");
si(claseBotonToggle(false).includes("text-slate-400"), "el botón inactivo queda apagado");
si(claseBotonToggle(true) !== claseBotonToggle(false), "activo e inactivo no comparten clase");

// ---------------------------------------------------------------------------
console.log("\nBLOQUE 3 — el reporte recorta filas Y subtotales con el filtro");
// ---------------------------------------------------------------------------
// Misma forma que produce `carreraReporte`: JUEGA + DA por ticket, con el flag
// de modalidad de tiempo en las dos filas del par. El ticket 0 es ⚡ en vivo
// (ANA juega $100 contra LUIS) y el ticket 1 es ⏳ adelantado (PEDRO $300 contra
// MARIA). La pizarra es "5 · 2 · 9": el 5 gana, así que el que juega al 5 acierta.
const fila = (
  i: number,
  rol: "Juega" | "Consigue",
  cliente: string,
  monto: number,
  adelantada: boolean,
  resultado: number
): FilaReporte => ({
  id: `2026-04-10-SANTA ANITA-7-${rol === "Juega" ? "j" : "c"}-${i}`,
  rol,
  cliente,
  jugada: "5P",
  caballo: "5",
  monto,
  resultado,
  esAdelantada: adelantada,
});

const CARRERA: CarreraReporte = {
  numero: 7,
  hipodromo: "SANTA ANITA",
  fecha: "2026-04-10",
  pizarra: "5 · 2 · 9",
  subtotal: 0,
  filas: [
    fila(0, "Juega", "ANA", 100, false, 250),
    fila(0, "Consigue", "LUIS", 100, false, -250),
    fila(1, "Juega", "PEDRO", 300, true, 900),
    fila(1, "Consigue", "MARIA", 300, true, -900),
  ],
};

const todas = armarReporteCarrera(CARRERA, "GRUPO", undefined, { filtroModalidad: "TODAS" });
const soloVivo = armarReporteCarrera(CARRERA, "GRUPO", undefined, { filtroModalidad: "EN_VIVO" });
const soloAdel = armarReporteCarrera(CARRERA, "GRUPO", undefined, { filtroModalidad: "ADELANTADA" });

/** Riesgo total de la carrera visible en el reporte (suma de todos los clientes). */
const riesgoTotal = (d: ReturnType<typeof armarReporteCarrera>) =>
  [...d.resumen.ganan, ...d.resumen.pierden].reduce((a, f) => a + (f.riesgo ?? 0), 0);

igual(todas.jugadasVivo.length, 2, "TODAS: las dos jugadas");
igual(soloVivo.jugadasVivo.length, 1, "EN VIVO: solo la jugada en vivo");
igual(soloAdel.jugadasVivo.length, 1, "ADELANTADA: solo la jugada adelantada");
igual(soloVivo.jugadasVivo[0].juega, "ANA", "EN VIVO deja la fila correcta");
igual(soloAdel.jugadasVivo[0].juega, "PEDRO", "ADELANTADA deja la fila correcta");
si(soloAdel.jugadasVivo[0].esAdelantada === true, "la fila adelantada viaja marcada para pintar el badge");
si(soloVivo.jugadasVivo[0].esAdelantada !== true, "la fila en vivo NO se marca");
igual(todas.filtroModalidad, "TODAS", "el reporte dice con qué filtro se armó");
igual(soloAdel.filtroModalidad, "ADELANTADA", "el filtro activo viaja en los datos");

// Totales recalculados: cada ticket arriesga el monto en sus DOS lados (el que
// juega y el que consigue), así que el ticket de 100 pesa 200 y el de 300 pesa 600.
igual(riesgoTotal(soloVivo), 200, "el riesgo se recalcula con lo visible (en vivo)");
igual(riesgoTotal(soloAdel), 600, "el riesgo se recalcula con lo visible (adelantada)");
igual(riesgoTotal(todas), 800, "sin filtro el riesgo es el total");
si(
  riesgoTotal(soloVivo) + riesgoTotal(soloAdel) === riesgoTotal(todas),
  "en vivo + adelantadas = total (los subtotales no se pierden ni se duplican)"
);
// El filtro también recorta el RESUMEN: cada mitad tiene sus propios clientes.
igual(
  todas.resumen.ganan.map((f) => f.nombre).sort(),
  ["ANA", "PEDRO"],
  "sin filtro ganan los dos jugadores"
);
igual(soloVivo.resumen.ganan.map((f) => f.nombre), ["ANA"], "EN VIVO: solo gana el jugador en vivo");
igual(soloAdel.resumen.ganan.map((f) => f.nombre), ["PEDRO"], "ADELANTADA: solo gana el jugador adelantado");

// ---------------------------------------------------------------------------
console.log("\nBLOQUE 4 — la migración SQL y las RPC de venta");
// ---------------------------------------------------------------------------
const sql = leer("sql", "jugadas_adelantadas.sql");

si(
  /alter table public\.tickets_apuestas[\s\S]*?add column if not exists es_adelantada boolean/.test(sql),
  "tickets_apuestas suma es_adelantada (idempotente, ADD COLUMN IF NOT EXISTS)"
);
si(
  /alter table public\.polla_ventas[\s\S]*?add column if not exists es_adelantada boolean/.test(sql),
  "polla_ventas suma es_adelantada"
);
si(/default false/.test(sql), "el default es false = EN VIVO");
si(
  /create or replace function public\.club_marcar_adelantada_polla\([\s\S]*?security definer/.test(sql),
  "las Pollas se marcan por RPC security definer (la tabla es de solo lectura)"
);
si(
  /grant execute on function public\.club_marcar_adelantada_polla\(uuid, boolean\) to authenticated;/.test(sql),
  "la RPC de Pollas se expone a authenticated"
);
si(
  !/grant execute on function public\.club_marcar_adelantada_polla\(uuid, boolean\) to anon/.test(sql),
  "la RPC de Pollas NO se expone a anon"
);
si(
  !/create or replace function public\.club_vender_jugada/.test(sql),
  "la migración NO redefine club_vender_jugada (ninguna firma de venta cambia)"
);

// El código cliente escribe por UPDATE directo en tickets_apuestas (mismo
// camino que el Monitor) y por RPC en polla_ventas.
const marcar = leer("src", "features", "jugadas", "lib", "marcar-adelantadas.ts");
si(
  /from\("tickets_apuestas"\)[\s\S]*?\.update\(\{ es_adelantada: adelantada \}\)/.test(marcar),
  "el cliente marca tickets con un UPDATE acotado por id"
);
si(
  /rpc\("club_marcar_adelantada_polla"/.test(marcar),
  "el cliente marca Pollas por RPC"
);
si(/es_adelantada/.test(marcar) && /ok: false/.test(marcar), "la marca es mejor esfuerzo: falla sin romper la venta");

// ---------------------------------------------------------------------------
console.log("\nBLOQUE 5 — W.P.S. (Win / Place / Show) en planificación");
// ---------------------------------------------------------------------------
si(esJugadaWps("W") && esJugadaWps("P") && esJugadaWps("S"), "W / P / S son jugadas W.P.S.");
si(esJugadaWps("w.p.s."), "la nomenclatura con puntos también se reconoce");
si(esJugadaWps("Win / Place / Show"), "el nombre completo con barras también");
si(esJugadaWps("PLACE") && esJugadaWps("SHOW") && esJugadaWps("WIN"), "las americanas en inglés también");
si(!esJugadaWps("GANADOR"), "GANADOR NO es W.P.S. (viaja por Taquilla como jugada propia)");
si(!esJugadaWps("EXACTA") && !esJugadaWps("5Y6"), "las demás modalidades quedan activas");
si(!esJugadaWps("") && !esJugadaWps(null) && !esJugadaWps(undefined), "vacío/nulo nunca es W.P.S.");
si(WPS_PLANIFICACION.includes("En Planificación"), "el badge dice En Planificación");

const sidebar = leer("src", "shared", "components", "layout", "Sidebar.tsx");
si(!/href:\s*"\/taquilla\?modalidad=wps"/.test(sidebar), "el menú lateral ya no enlaza a la Taquilla W.P.S.");
si(/txt: "W\.P\.S\."/.test(sidebar) && /WPS_PLANIFICACION/.test(sidebar), "la entrada W.P.S. sigue visible, con su badge 🚧");

const taquilla = leer("src", "features", "taquilla", "components", "TaquillaModule.tsx");
si(/disabled=\{esWps\}/.test(taquilla), "la pestaña W.P.S. de la Taquilla queda deshabilitada");
si(!/function AvisoWps/.test(taquilla), "la ayuda de venta de W.P.S. ya no se ofrece");

const slip = leer("src", "features", "taquilla", "components", "BetSlip.tsx");
si(!/\[\.\.\.EJEMPLOS, "100 W"/.test(slip), "el BetSlip ya no ofrece los ejemplos de W.P.S.");
si(!/setComando\("100 W"\)/.test(slip), "el BetSlip no tiene un botón que cargue una W.P.S.");

const reglas = leer("src", "features", "reglas-jugadas", "components", "ReglasJugadasModule.tsx");
si(/esJugadaWps/.test(reglas), "Reglas de Jugadas detecta las filas W.P.S.");
si(/disabled=\{wps\}/.test(reglas), "las acciones de las filas W.P.S. quedan deshabilitadas");
si(!/window\.(confirm|alert)/.test(reglas), "sin window.confirm/alert (usa el store de confirmación)");

// El MOTOR no se toca: sigue completo e intacto.
const motor = leer("src", "features", "motores", "lib", "wps.ts");
si(motor.includes("matrizWps") || motor.includes("liquidarWps"), "el motor W.P.S. sigue existiendo e intacto");

// ---------------------------------------------------------------------------
console.log("\nBLOQUE 6 — la barra de carga de cada módulo");
// ---------------------------------------------------------------------------
const modulos: Array<[string, string[]]> = [
  ["Taquilla", ["src", "features", "taquilla", "components", "TaquillaModule.tsx"]],
  ["BetSlip", ["src", "features", "taquilla", "components", "BetSlip.tsx"]],
  ["Marcas", ["src", "features", "marcas", "components", "ModalMarcas.tsx"]],
  ["Tablas Fijas", ["src", "features", "tablas", "components", "TablasModule.tsx"]],
  ["Dupletas", ["src", "features", "dupletas", "components", "DupletaModule.tsx"]],
  ["Remates", ["src", "features", "remates", "components", "RematesModule.tsx"]],
  ["Pollas", ["src", "features", "pollas", "components", "PollasModule.tsx"]],
];
for (const [nombre, ruta] of modulos) {
  const src = leer(...ruta);
  si(/ToggleModalidadTiempo/.test(src), `${nombre}: tiene el toggle ⚡/⏳ en su barra de carga`);
}

const store = leer("src", "shared", "store", "useTaquillaStore.ts");
si(/modalidadTiempo/.test(store) && /MODALIDAD_POR_DEFECTO/.test(store), "la Taquilla comparte el estado de modalidad");
si(
  /partialize:\s*\(s\)\s*=>\s*\(\{\s*tickets:\s*s\.tickets\s*\}\)/.test(store),
  "la modalidad NO se persiste: solo se guardan los tickets (cada recarga arranca en ⚡ En Vivo)"
);

const reporteCarrera = leer("src", "features", "saldos", "components", "ReporteCarrera.tsx");
si(/esAdelantada/.test(reporteCarrera), "la plantilla del reporte pinta el badge de la jugada adelantada");
si(!/rounded-full/.test(reporteCarrera), "el reporte sigue sin discos redondos");

const modal = leer("src", "features", "gestion", "components", "ReporteLiquidacionModal.tsx");
si(/OPCIONES_FILTRO/.test(modal), "la cabecera del reporte tiene el filtro segmentado");
si(/setFiltroModalidad\("TODAS"\)/.test(modal), "el filtro se resetea al abrir el reporte");

// ---------------------------------------------------------------------------
console.log("\nBLOQUE 7 — el Reporte de Ventas muestra y edita la modalidad");
// ---------------------------------------------------------------------------
// (a) El modelo de la fila del Reporte de Ventas lleva la modalidad, leída de
// `es_adelantada` con el respaldo de la nota. Es la MISMA normalización que
// comparten Tablas Fijas, Marcas, Dupletas y Remates.
const filaReporte = (over: Record<string, unknown> = {}) => ({
  id: "tk-7",
  monto_jugado: "100",
  estado: "Pendiente",
  ...over,
});
igual(normalizarVenta(filaReporte()).adelantada, false, "la venta sin flag es ⚡ en vivo");
igual(normalizarVenta(filaReporte({ es_adelantada: true })).adelantada, true, "es_adelantada → ⏳ adelantada");
igual(
  normalizarVenta(filaReporte({ nota_auditoria: JSON.stringify({ es_adelantada: true }) })).adelantada,
  true,
  "la nota sirve de respaldo en la fila del reporte"
);

// (b) La tabla de detalle del Reporte de Ventas tiene la columna-símbolo.
const reporteVentas = leer("src", "features", "reportes", "components", "ReporteVentasModal.tsx");
si(/function PuntoModalidad/.test(reporteVentas), "el reporte define el símbolo de modalidad (punto de color)");
si(/<PuntoModalidad adelantada=\{v\.adelantada\}/.test(reporteVentas), "cada fila pinta su punto según `adelantada`");
si(
  /bg-amber-500/.test(reporteVentas) && /bg-emerald-500/.test(reporteVentas),
  "ámbar = ⏳ adelantada · verde = ⚡ en vivo"
);
si(/ETIQUETA_ADELANTADA/.test(reporteVentas) && /ETIQUETA_EN_VIVO/.test(reporteVentas), "los títulos usan las etiquetas compartidas");

// (c) El modal de CORREGIR deja ver y cambiar la modalidad, y la persiste.
const modalReporte = leer("src", "features", "reportes", "components", "ModalAccionJugadaReporte.tsx");
si(/venta\.adelantada\s*\?\s*"ADELANTADA"\s*:\s*"EN_VIVO"/.test(modalReporte), "el modal arranca con la modalidad ACTUAL de la jugada");
si(/es_adelantada:\s*modalidad === "ADELANTADA"/.test(modalReporte), "al guardar persiste la modalidad elegida");
si(/setModalidad\("EN_VIVO"\)/.test(modalReporte) && /setModalidad\("ADELANTADA"\)/.test(modalReporte), "el operador puede alternar ⚡/⏳");

// (d) `es_adelantada` es un campo editable de la jugada (vía `editarJugada`).
const libJugadas = leer("src", "features", "jugadas", "lib", "jugadas.ts");
si(/es_adelantada\?:\s*boolean \| null/.test(libJugadas), "EditablesJugada expone es_adelantada para la edición");

// ---------------------------------------------------------------------------
console.log(`\nRESULTADO — modalidad de tiempo: ${pasan} ok, ${fallan} fallan\n`);
if (fallan > 0) process.exit(1);
