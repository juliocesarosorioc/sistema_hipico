// ============================================================================
// REPORTE DE MARCAS JUGADAS — normalización de los tickets de marcas.
//
// Una marca escribe el MISMO ticket que una tabla fija (`tickets_apuestas`), así
// que el reporte reutiliza el núcleo de tablas. Lo propio de la marca —y lo que
// protege esta prueba— es:
//   · el matchup: el ticket guarda `caballo = '<n>'` (solo el número) y el rival
//     en `nota_auditoria.rivales_snapshot`; el reporte arma "MARCA <n> vs <...>";
//   · el día: se usa la fecha de la CARRERA (columna `fecha_carrera`), no la de
//     la venta.
//
// Corre con:  node pruebas/correr.cjs
// ============================================================================
import {
  etiquetaMarca,
  leerNota,
  normalizarMarca,
  normalizarMarcas,
  rivalesDeNota,
} from "../src/features/marcas/lib/reporte-marcas-nucleo";
import { estadoNormalizado, totalesDe } from "../src/features/tablas/lib/reporte-tablas-nucleo";

let pasan = 0;
let fallan = 0;
const ok = (m: string) => { pasan++; console.log(`  ok   ${m}`); };
const mal = (m: string, d?: string) => { fallan++; console.log(`  FALLA ${m}${d ? `\n         ${d}` : ""}`); };
const si = (c: boolean, m: string, d?: string) => (c ? ok(m) : mal(m, d));
const igual = (a: unknown, b: unknown, m: string) =>
  si(JSON.stringify(a) === JSON.stringify(b), m, `esperado ${JSON.stringify(b)} · recibido ${JSON.stringify(a)}`);

console.log("\nREPORTE DE MARCAS — normalización de tickets");

// Fila cruda tal como la escribe club_vender_marca: la marca elegida en
// `ejemplar_numero` (y `caballo`, que guarda solo el número), el matchup en la
// nota y la fecha de CARRERA en la columna dedicada.
const filaMarca = (over: Record<string, unknown> = {}) => ({
  id: "mk-1",
  fecha_registro: "2026-10-17T14:03:00Z",
  fecha_carrera: "2026-10-17",
  hipodromo: "santa anita",
  carrera: 7,
  nombre_jugada: "MARCA 8",
  caballo: "8",
  ejemplar_numero: 8,
  cantidad_tablas: 1,
  monto_jugado: "120.00",
  cliente_juega_id: "c-1",
  cliente_juega_nombre: "Fabio",
  grupo_cobro_id: "g-1",
  grupo_cobro_nombre: "LOS COMPADRES",
  comision_porcentaje: 0,
  estado: "Pendiente",
  premio_pagar: 0,
  comision_pagada: 0,
  moneda: "usd",
  nota_auditoria: JSON.stringify({
    origen: "MARCAS",
    fecha_carrera: "2026-10-17",
    tipo_matchup: "a_la_izquierda",
    rivales_snapshot: [3, 5],
  }),
  ...over,
});

const m = normalizarMarca(filaMarca());
igual(m.hipodromo, "SANTA ANITA", "hipódromo normalizado a mayúsculas");
igual(m.carrera, 7, "carrera numérica");
igual(m.numero, "8", "número de la marca desde ejemplar_numero");
igual(m.caballo, "MARCA 8 x 3 x 5", "ejemplar compuesto con el matchup");
igual(m.jugador, "Fabio", "jugador tomado de cliente_juega_nombre");
igual(m.grupo, "LOS COMPADRES", "grupo tomado de grupo_cobro_nombre");
igual(m.monto, 120, "monto desde string decimal");
igual(m.moneda, "USD", "moneda a mayúsculas");
igual(m.fecha, "2026-10-17", "fecha de la CARRERA (columna fecha_carrera)");

// Sin la columna `fecha_carrera` (fila heredada) cae a la nota de auditoría.
const sinColumna = normalizarMarca(filaMarca({ fecha_carrera: null }));
igual(sinColumna.fecha, "2026-10-17", "fecha cae a nota_auditoria.fecha_carrera");

// Sin nota ni columna cae al día de la venta (fecha_registro).
const sinNada = normalizarMarca(
  filaMarca({ fecha_carrera: null, nota_auditoria: null, fecha_registro: "2026-10-16T14:03:00Z" })
);
igual(sinNada.fecha, "2026-10-16", "sin fecha de carrera cae al día de la venta");

console.log("\nREPORTE DE MARCAS — matchup");

igual(etiquetaMarca(filaMarca()), "MARCA 8 x 3 x 5", "etiqueta con un rival");
igual(
  etiquetaMarca(filaMarca({ nota_auditoria: JSON.stringify({ origen: "MARCAS", rivales_snapshot: [] }) })),
  "MARCA 8",
  "sin rivales la etiqueta es solo la marca"
);
igual(
  etiquetaMarca(filaMarca({ nota_auditoria: JSON.stringify({ origen: "MARCAS", rivales_snapshot: ["1"] }) })),
  "MARCA 8 x 1",
  "acepta rivales como string"
);
igual(etiquetaMarca(filaMarca({ nota_auditoria: null })), "MARCA 8", "sin nota no inventa matchup");

igual(rivalesDeNota(filaMarca().nota_auditoria), ["3", "5"], "rivales desde JSON string");
igual(rivalesDeNota({ rivales_snapshot: [2] }), ["2"], "rivales desde objeto ya parseado");
igual(rivalesDeNota(null), [], "sin nota → sin rivales");
igual(leerNota("no es json"), {}, "nota no-JSON se ignora sin reventar");
igual(leerNota('{"origen":"MARCAS"}'), { origen: "MARCAS" }, "nota JSON parseada");

console.log("\nREPORTE DE MARCAS — lote y estados");

igual(normalizarMarcas([filaMarca(), filaMarca({ id: "mk-2" })]).length, 2, "normaliza un lote de filas");
igual(estadoNormalizado("Ganador"), "Ganador", "'Ganador' (mismo vocabulario que tablas)");
igual(estadoNormalizado("Perdedor"), "Perdedor", "'Perdedor'");

console.log("\nREPORTE DE MARCAS — totales (núcleo compartido con tablas)");

const ventas = [
  { ...normalizarMarca(filaMarca()), id: "b1", estado: "Ganador", monto: 120, pagado: 600 },
  { ...normalizarMarca(filaMarca()), id: "b2", estado: "Perdedor", monto: 80, pagado: 0 },
  { ...normalizarMarca(filaMarca()), id: "b3", estado: "Retirado", monto: 50, pagado: 0 },
];
const t = totalesDe(ventas);
igual(t.tickets, 3, "tres jugadas");
igual(t.jugadores, 1, "un solo jugador (misma marca)");
igual(t.enRiesgo, 250, "en riesgo = 120+80+50");
igual(t.ganadores, 1, "un ganador");
igual(t.pagado, 600, "pagado del ganador");
igual(t.reembolsado, 50, "reembolso del retirado");
igual(t.balance, 250 - 50 - 600, "balance = enRiesgo − reembolso − pagado");

console.log(`\n  REPORTE DE MARCAS: ${pasan} ok, ${fallan} fallaron\n`);
if (fallan > 0) process.exit(1);
