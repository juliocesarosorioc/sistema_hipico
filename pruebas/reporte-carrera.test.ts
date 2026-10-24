// ============================================================================
// REPORTE DE CARRERA — arma la plantilla de liquidación con datos REALES.
//
// Protege el contrato del armado: la `CarreraReporte` que produce el motor
// oficial (filas liquidadas + pizarra) se traduce a `ReporteCarreraDatos` sin
// duplicar la apuesta en "en vivo", con el DA pareado por ticket, la parada
// adelantada por tipo de jugada y el resumen Ganan/Pierden por cliente.
//
// Corre con:  node pruebas/correr.cjs   (o npx tsx pruebas/reporte-carrera.test.ts)
// ============================================================================
import { armarReporteCarrera, colorDiscoNumero, riesgoDeFila } from "../src/features/liquidacion/lib/reporte-carrera";
import { resultadoConsigueDe, type CarreraReporte, type FilaReporte } from "../src/features/liquidacion/lib/reportes";

let pasan = 0;
let fallan = 0;
const ok = (m: string) => { pasan++; console.log(`  ok   ${m}`); };
const mal = (m: string, d?: string) => { fallan++; console.log(`  FALLA ${m}${d ? `\n         ${d}` : ""}`); };
const si = (c: boolean, m: string, d?: string) => (c ? ok(m) : mal(m, d));
const buscar = <T extends { nombre: string }>(arr: T[], nombre: string) => arr.find((x) => x.nombre === nombre);

const CARRERA: CarreraReporte = {
  numero: 7,
  hipodromo: "LA RINCONADA",
  fecha: "2026-10-12",
  pizarra: "7 · 2 · 5",
  subtotal: 0,
  filas: [
    // Ticket 0: Perrito juega "2p al 7" y Emy consigue/da. Perrito pierde 100.
    { id: "2026-10-12-LA RINCONADA-7-j-0", rol: "Juega", cliente: "Perrito Molinas", jugada: "2p", caballo: "7", monto: 100, resultado: -100, esPareo: false, observacion: "Excedido 100", saldoRestante: 0 },
    { id: "2026-10-12-LA RINCONADA-7-c-0", rol: "Consigue", cliente: "Emy", jugada: "2p", caballo: "7", monto: 100, resultado: 100, esPareo: false },
    // Ticket 1: Marlene gana con una TABLA FIJA (adelantada).
    { id: "2026-10-12-LA RINCONADA-7-j-1", rol: "Juega", cliente: "Marlene", jugada: "TABLA 2", caballo: "2", monto: 500, resultado: 1200, esPareo: false },
    // CRUCE financiero: NO debe aparecer como jugada.
    { id: "2026-10-12-LA RINCONADA-7-x-2", rol: "CRUCE", cliente: "Marlene", jugada: "🔀 CRUCE", caballo: "2", monto: 0, resultado: 25 },
  ],
};

const d = armarReporteCarrera(CARRERA);

// ── 1. Encabezado y pizarra ──
si(d.encabezado.hipodromo === "LA RINCONADA", "encabezado lleva el hipódromo de la carrera");
si(d.encabezado.carrera === "Carrera 7", "encabezado arma «Carrera 7»");
si(/oct/.test(d.encabezado.fecha), `fecha legible: «${d.encabezado.fecha}»`);
si(d.encabezado.llegada.length === 3, "la pizarra 7·2·5 se vuelve 3 discos de llegada");
si(d.encabezado.llegada[0]?.numero === "7" && d.encabezado.llegada[0]?.puesto === "1º", "1er disco es el 7 con puesto 1º");
si(d.encabezado.llegada[2]?.numero === "5" && d.encabezado.llegada[2]?.puesto === "3º", "3er disco es el 5 con puesto 3º");
// ── Colores de gualdrapa: codificación 1–20, fuente única en shared/lib/horseColors ──
// La paleta viva es la de las GUALDRAPAS OFICIALES (`shared/lib/horseColors.ts`):
// 7 anaranjado (bg-orange-600), 3 azul rey (bg-blue-700), 9 turquesa (bg-cyan-500),
// 10 morado (bg-purple-700), 11 gris (bg-slate-500), 12 verde lima (bg-lime-600),
// 5 verde (bg-green-700), 6 negro/oro (bg-slate-900 + número amarillo).
// Estas aserciones apuntaban a la paleta ANTERIOR (bg-orange-500, bg-sky-700,
// bg-teal-500, bg-slate-400, bg-emerald-400/600, bg-slate-800): el cambio a la
// codificación oficial se hizo en el módulo y el test quedó viejo, así que
// verificaba algo que la app ya no hace.
si(colorDiscoNumero(7).includes("bg-orange-600"), "color del disco 7 = anaranjado (gualdrapa oficial)");
si(colorDiscoNumero(3).includes("bg-blue-700"), "color del disco 3 = azul rey (gualdrapa oficial)");
si(colorDiscoNumero(9).includes("bg-cyan-500"), "color del disco 9 = turquesa (gualdrapa oficial)");
si(colorDiscoNumero(10).includes("bg-purple-700"), "color del disco 10 = morado (gualdrapa oficial)");
si(colorDiscoNumero(11).includes("bg-slate-500"), "color del disco 11 = gris (gualdrapa oficial)");
si(colorDiscoNumero(12).includes("bg-lime-600"), "color del disco 12 = verde lima (gualdrapa oficial)");
si(
  colorDiscoNumero(2).includes("bg-white") && colorDiscoNumero(2).includes("border border-slate-300"),
  "el 2 blanco se pinta con borde para no perderse sobre panel blanco"
);
si(colorDiscoNumero(15).includes("bg-lime-100"), "el 15 caqui usa su propio color (ya no repite el ciclo)");
si(colorDiscoNumero(99).includes("bg-slate-700"), "número fuera del rango cae al gris de respaldo (bg-slate-700)");
// Color del NÚMERO según la codificación (fondo intacto).
si(
  colorDiscoNumero(5).includes("bg-green-700") && colorDiscoNumero(5).includes("text-white"),
  "el 5 verde lleva su fondo y número BLANCO"
);
si(
  colorDiscoNumero(10).includes("bg-purple-700") && colorDiscoNumero(10).includes("text-white"),
  "el 10 morado lleva su fondo y número BLANCO"
);
si(colorDiscoNumero(6).includes("bg-slate-900") && colorDiscoNumero(6).includes("text-yellow-400"), "el 6 negro lleva número AMARILLO");

// ── 2. Jugadas "en vivo" ──
si(d.jugadasVivo.length === 2, "una fila por ticket (el CRUCE no cuenta y el Consigue viaja como DA)");
const perrito = d.jugadasVivo[0];
si(perrito && perrito.juega === "Perrito Molinas", "fila 1: JUEGA = Perrito Molinas");
si(perrito && perrito.da === "Emy", "fila 1: DA = Emy (pareo por índice del ticket)");
si(perrito && perrito.jugo === "2p" && perrito.aposto === 100, "fila 1: JUGÓ 2p · APOSTÓ 100");
si(perrito && perrito.resultado === -100, "fila 1: RESULTADO = -100 (perdió)");
si(perrito && perrito.caballo === "7", "fila 1: lleva el ejemplar (7) para pintar el disco de color");
si(perrito && perrito.observacion === "Excedido 100" && perrito.saldoRestante === 0,
  "fila 1: reporta observación progresiva y saldo restante cero");
si(perrito && !("tipo" in perrito), "fila 1: SIN etiqueta de premio/puestos debajo de la jugada");
const marleneVivo = d.jugadasVivo[1];
si(marleneVivo && marleneVivo.juega === "Marlene" && marleneVivo.da === "", "fila 2: Marlene sin pareja (DA vacío)");
si(marleneVivo && marleneVivo.apostoDa === null, "fila 2: sin DA no hay APOSTÓ del lado que da (null → «—»)");
si(perrito && perrito.apostoDa === 100, "fila 1: APOSTÓ del DA = 100 (Emy arriesga el monto: sin fracción)");

// ── 3. Parada Adelantadas por tipo de jugada ──
si(d.adelantadas.tablas.length === 1, "la TABLA ganadora va a la sección Tablas Fijas");
si(d.adelantadas.tablas[0]?.juega === "Marlene" && d.adelantadas.tablas[0]?.resultado === 1200, "sección Tablas: Marlene con resultado 1200");
si(d.adelantadas.marcas.length === 0 && d.adelantadas.tercios.length === 0, "sin Marcas ni Tercios en esta corrida");

// ── 4. Resumen Ganan / Pierden por cliente ──
si(d.resumen.ganan.length === 2, "Ganan agrupa los dos clientes que ganaron (Emy y Marlene)");
const gananEmy = buscar(d.resumen.ganan, "Emy");
const gananMarlene = buscar(d.resumen.ganan, "Marlene");
si(gananEmy?.monto === 100, "Ganan: Emy +100 (mitad Consigue del ticket 0)");
si(gananMarlene?.monto === 1200, "Ganan: Marlene +1200 (ganancia de la TABLA)");
si(d.resumen.pierden.length === 1 && buscar(d.resumen.pierden, "Perrito Molinas")?.monto === -100, "Pierden: Perrito Molinas -100");

// ── 4b. Los PENDIENTES (resultado null) no ensucian el resumen ──
const conPendiente = armarReporteCarrera({
  ...CARRERA,
  filas: [
    ...CARRERA.filas,
    { id: "2026-10-12-LA RINCONADA-7-j-9", rol: "Juega", cliente: "Pendiente", jugada: "1p", caballo: "9", monto: 50, resultado: null, esPareo: false },
  ],
});
si(
  buscar([...conPendiente.resumen.ganan, ...conPendiente.resumen.pierden], "Pendiente") === undefined,
  "un ticket pendiente (null) NO cae en Ganan 0.00: queda fuera del resumen"
);
si(
  conPendiente.jugadasVivo.find((j) => j.juega === "Pendiente")?.resultado === null,
  "la fila en vivo del pendiente conserva resultado null (no se pinta hasta decidirse)"
);

// ── 5. Carrera sin filas ──
const vacia = armarReporteCarrera({ ...CARRERA, filas: [], pizarra: null });
si(vacia.jugadasVivo.length === 0, "carrera sin filas no inventa jugadas");
si(vacia.encabezado.llegada.length === 0, "carrera sin pizarra no inventa llegada");
si(vacia.resumen.ganan.length === 0 && vacia.resumen.pierden.length === 0, "carrera sin filas no inventa resumen");

// ── 6. Ítem 10: cuánto arriesgó cada jugador + asterisco por exceder el disponible ──
const fila = (p: Partial<FilaReporte>): FilaReporte => ({
  id: "x", rol: "Juega", cliente: "X", jugada: "", caballo: "", monto: 0, resultado: null, ...p,
});
si(riesgoDeFila(fila({ rol: "Juega", monto: 1000 })) === 1000, "el que JUEGA arriesga el monto");
si(riesgoDeFila(fila({ rol: "Consigue", jugada: "2p", monto: 1000 })) === 1000, "PP sin fracción: el DA arriesga lo mismo (10/10)");
si(riesgoDeFila(fila({ rol: "Consigue", jugada: "10/6", monto: 1000 })) === 600, "a premio 10/6: el DA arriesga su lado (1000·6/10 = 600)");
si(riesgoDeFila(fila({ rol: "CRUCE", monto: 500 })) === 0, "el CRUCE no arriesga");

// Pareo 10/6: Marlene (juega) arriesga 1000 y dispone 400 → asterisco;
// Dador (consigue) arriesga 600 y dispone 5000 → sin asterisco.
const conDisp = armarReporteCarrera(
  {
    ...CARRERA,
    filas: [
      fila({ id: "2026-10-12-LA RINCONADA-7-j-1", rol: "Juega", cliente: "Marlene", jugada: "10/6", caballo: "2", monto: 1000, resultado: 500, esPareo: true }),
      fila({ id: "2026-10-12-LA RINCONADA-7-c-1", rol: "Consigue", cliente: "Dador", jugada: "10/6", caballo: "2", monto: 1000, resultado: -600, esPareo: true }),
    ],
  },
  undefined,
  (n) => (n === "Marlene" ? 400 : 5000)
);
const rMarlene = buscar(conDisp.resumen.ganan, "Marlene");
const rDador = buscar(conDisp.resumen.pierden, "Dador");
si(rMarlene?.riesgo === 1000, "Marlene arriesgó 1000");
si(rMarlene?.excede === true, "Marlene EXCEDE su disponible (1000 > 400)");
si(rDador?.riesgo === 600, "Dador arriesgó 600");
si(rDador?.excede === false, "Dador NO excede su disponible (600 < 5000)");
si(conDisp.notaExcedidos?.length === 1 && conDisp.notaExcedidos[0]?.nombre === "Marlene", "la nota al pie lista solo a Marlene");
si(conDisp.notaExcedidos?.[0]?.disponible === 400, "la nota al pie lleva su disponible (400)");
si(conDisp.jugadasVivo[0]?.apostoDa === 600, "filas en vivo: el APOSTÓ del DA en «10/6» es 600 (1000·6/10)");
si(conDisp.jugadasVivo[0]?.aposto === 1000, "filas en vivo: el APOSTÓ del que juega en «10/6» es 1000");
// Sin lookup de disponible (o modo libre = undefined) no se marca a nadie.
const sinDisp = armarReporteCarrera({ ...CARRERA, filas: [fila({ rol: "Juega", cliente: "Libre", monto: 9_999_999, resultado: 1 })] });
si(sinDisp.notaExcedidos?.length === 0 && sinDisp.resumen.ganan[0]?.excede === false, "sin disponible informado no hay asterisco");
const libre = armarReporteCarrera(
  { ...CARRERA, filas: [fila({ rol: "Juega", cliente: "Libre", monto: 9_999_999, resultado: 1 })] },
  undefined,
  () => undefined
);
si(libre.notaExcedidos?.length === 0, "modo libre (undefined) no marca asterisco");

// ── 7. Pareo: la JUGADA se rotula "PP" y el monto del "da" descuenta la comisión ──
// Un MATCH legacy guardado como "4X7" debe leerse "PP" (nunca "10/10") y
// conservar los ejemplares para pintarlos "1 × 8".
const pareo = armarReporteCarrera({
  ...CARRERA,
  filas: [
    fila({ id: "2026-10-12-LA RINCONADA-7-j-0", rol: "Juega", cliente: "Fabio", jugada: "4X7", caballo: "1X8", monto: 100, resultado: 95, esPareo: true }),
    fila({ id: "2026-10-12-LA RINCONADA-7-c-0", rol: "Consigue", cliente: "Zorro", jugada: "4X7", caballo: "1X8", monto: 100, resultado: -100, esPareo: true }),
  ],
});
si(pareo.jugadasVivo[0]?.jugo === "PP", "el MATCH legacy «4X7» se rotula «PP» (nunca 10/10)");
si(pareo.jugadasVivo[0]?.caballo === "1X8" && pareo.jugadasVivo[0]?.da === "Zorro", "conserva los ejemplares (1X8) y el DA (Zorro)");

// Una jugada declarada como "10/10" (pelo a pelo) también se rotula "PP".
const peloAPelo = armarReporteCarrera({
  ...CARRERA,
  filas: [
    fila({ id: "2026-10-12-LA RINCONADA-7-j-1", rol: "Juega", cliente: "Fabio", jugada: "10/10", caballo: "1X8", monto: 100, resultado: 95, esPareo: true }),
  ],
});
si(peloAPelo.jugadasVivo[0]?.jugo === "PP", "la jugada «10/10» se rotula «PP» en el reporte");

// Paridad con WhatsApp: cuando el que JUEGA acierta, el "da" entrega la ganancia
// BRUTA (neto + comisión); cuando pierde, el "da" cobra el monto MENOS comisión.
// (monto 100, ganancia neta 95, comisión 5 → bruto 100.)
si(
  resultadoConsigueDe(100, { ok: true, bruto: 195, comision: 5, tasa: 5 }) === -100,
  "el «da» que pierde entrega la ganancia BRUTA (−100 = neto 95 + comisión 5)"
);
si(
  resultadoConsigueDe(100, { ok: false, bruto: 0, comision: 0, tasa: 5 }) === 95,
  "el «da» que gana cobra el monto MENOS comisión (+95)"
);
si(
  resultadoConsigueDe(100, { ok: false, bruto: 100, comision: 0, tasa: 5 }) === 0,
  "jugada ANULADA (capital devuelto): el «da» queda 0"
);
si(resultadoConsigueDe(100, { ok: null, bruto: 0, comision: 0, tasa: 5 }) === null, "ticket pendiente: el «da» queda null");

console.log(`\n${pasan} pasan, ${fallan} fallan.`);
if (fallan > 0) process.exit(1);