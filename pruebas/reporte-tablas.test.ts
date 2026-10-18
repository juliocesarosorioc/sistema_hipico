// ============================================================================
// REPORTE DE TABLAS FIJAS VENDIDAS — núcleo de normalización y agregación.
//
// Protege el contrato del reporte que abre el ícono del Monitor: cada ticket de
// `tickets_apuestas` se convierte en una venta (grupo, jugador, ejemplar, monto,
// estado, pagado, comisión) y de ahí salen los totales: en riesgo, ganadores,
// perdidos, comisión del grupo, retiros/reembolso y balance.
//
// Corre con:  node pruebas/correr.cjs
// ============================================================================
import {
  agruparPor,
  claveDe,
  estadoNormalizado,
  filtrarVentas,
  normalizarVenta,
  opcionesDe,
  ordenarFilas,
  totalesDe,
  type VentaTablaReporte,
} from "../src/features/tablas/lib/reporte-tablas-nucleo";

let pasan = 0;
let fallan = 0;
const ok = (m: string) => { pasan++; console.log(`  ok   ${m}`); };
const mal = (m: string, d?: string) => { fallan++; console.log(`  FALLA ${m}${d ? `\n         ${d}` : ""}`); };
const si = (c: boolean, m: string, d?: string) => (c ? ok(m) : mal(m, d));
const igual = (a: unknown, b: unknown, m: string) =>
  si(JSON.stringify(a) === JSON.stringify(b), m, `esperado ${JSON.stringify(b)} · recibido ${JSON.stringify(a)}`);

console.log("\nREPORTE DE TABLAS FIJAS — normalización de tickets");

// Fila cruda tal como la escribe club_vender_tabla_fija: un ticket por ejemplar,
// con el grupo congelado y la nota de auditoría (JSON string) con la fecha de
// carrera y el origen.
const fila = (over: Record<string, unknown> = {}) => ({
  id: "tk-1",
  fecha_registro: "2026-10-16T14:03:00Z",
  hipodromo: "santa anita",
  carrera: 7,
  nombre_jugada: "TABLA FIJA (SANTA ANITA C7)",
  caballo: "ZORRO",
  ejemplar_numero: 8,
  cantidad_tablas: 1,
  monto_jugado: "100.00",
  premio_por_tabla: 500,
  pts_ejemplar: 12.5,
  cliente_juega_id: "c-1",
  cliente_juega_nombre: "Fabio",
  grupo_cobro_id: "g-1",
  grupo_cobro_nombre: "LOS COMPADRES",
  comision_porcentaje: 5,
  estado: "Pendiente",
  premio_pagar: 0,
  comision_pagada: 0,
  moneda: "usd",
  nota_auditoria: JSON.stringify({ tabla_id: 33, fecha_carrera: "2026-10-16", origen: "TABLAS_FIJAS" }),
  ...over,
});

const v = normalizarVenta(fila());
igual(v.hipodromo, "SANTA ANITA", "hipódromo normalizado a mayúsculas");
igual(v.carrera, 7, "carrera numérica");
igual(v.numero, "8", "ejemplar como texto");
igual(v.jugador, "Fabio", "jugador tomado de cliente_juega_nombre");
igual(v.grupo, "LOS COMPADRES", "grupo tomado de grupo_cobro_nombre");
igual(v.monto, 100, "monto desde string decimal");
igual(v.comisionPct, 5, "tasa de comisión del grupo");
igual(v.moneda, "USD", "moneda a mayúsculas");
igual(v.fecha, "2026-10-16", "fecha de carrera desde la nota de auditoría");

// Sin nota JSON la fecha cae al día de la venta (fecha_registro).
const sinNota = normalizarVenta(fila({ nota_auditoria: null }));
igual(sinNota.fecha, "2026-10-16", "fecha cae a fecha_registro sin nota");

// El reporte filtra/agrupa por el DÍA DE LA CARRERA, pero conserva el día de la
// venta como dato aparte (patrón de consulta adicional).
igual(v.fechaVenta, "2026-10-16", "día de la venta (fecha_registro) en fechaVenta");
const otraFecha = normalizarVenta(
  fila({ nota_auditoria: JSON.stringify({ tabla_id: 33, fecha_carrera: "2026-10-18", origen: "TABLAS_FIJAS" }) })
);
igual(otraFecha.fecha, "2026-10-18", "fecha = día de la CARRERA (nota), no el de la venta");
igual(otraFecha.fechaVenta, "2026-10-16", "fechaVenta sigue siendo el día de la venta");

console.log("\nREPORTE DE TABLAS FIJAS — estados");

igual(estadoNormalizado("Ganador"), "Ganador", "'Ganador'");
igual(estadoNormalizado("Perdedor"), "Perdedor", "'Perdedor'");
igual(estadoNormalizado("Retirado"), "Retirado", "'Retirado'");
igual(estadoNormalizado("Pendiente"), "Pendiente", "'Pendiente'");
igual(estadoNormalizado("otra cosa"), "Otro", "estado desconocido → Otro");

console.log("\nREPORTE DE TABLAS FIJAS — totales");

const ventas: VentaTablaReporte[] = [
  { ...normalizarVenta(fila()), id: "a1", estado: "Ganador", monto: 100, pagado: 500, comision: 20 },
  { ...normalizarVenta(fila()), id: "a2", estado: "Perdedor", monto: 50, pagado: 0, comision: 0 },
  { ...normalizarVenta(fila()), id: "a3", estado: "Retirado", monto: 30, pagado: 0, comision: 0 },
  { ...normalizarVenta(fila({ cliente_juega_id: "c-2", cliente_juega_nombre: "Emy", grupo_cobro_id: "g-2", grupo_cobro_nombre: "LA BANDA" })), id: "b1", estado: "Ganador", monto: 200, pagado: 900, comision: 35 },
];

const t = totalesDe(ventas);
igual(t.tickets, 4, "4 tickets");
igual(t.jugadores, 2, "2 jugadores distintos");
igual(t.enRiesgo, 380, "en riesgo = 100+50+30+200");
igual(t.ganadores, 2, "2 ganadores");
igual(t.perdidos, 1, "1 perdido");
igual(t.retirados, 1, "1 retirado");
igual(t.pagado, 1400, "pagado = 500+900");
igual(t.comision, 55, "comisión = 20+35");
igual(t.reembolsado, 30, "reembolso = monto del retirado");
igual(t.balance, 380 - 30 - 1400, "balance = enRiesgo − reembolso − pagado");

console.log("\nREPORTE DE TABLAS FIJAS — agrupación y filtros");

const porGrupo = agruparPor(ventas, "grupo");
igual(porGrupo.length, 2, "dos grupos");
const compadres = porGrupo.find((g) => g.etiqueta === "LOS COMPADRES");
si(!!compadres, "aparece el grupo LOS COMPADRES");
igual(compadres?.enRiesgo, 180, "en riesgo del grupo = 100+50+30");
igual(compadres?.ganadores, 1, "1 ganador en LOS COMPADRES");
igual(compadres?.retirados, 1, "1 retirado en LOS COMPADRES");
igual(compadres?.reembolsado, 30, "reembolso del grupo");
igual(compadres?.balance, 180 - 30 - 500, "balance del grupo");

const porCarrera = agruparPor(ventas, "carrera");
igual(porCarrera[0].etiqueta, "SANTA ANITA C7", "la dimensión carrera incluye el hipódromo");
igual(claveDe(ventas[0], "carrera"), "SANTA ANITA|7", "clave de carrera = hipódromo|número");

const soloCompadres = filtrarVentas(ventas, { grupo: claveDe(ventas[0], "grupo") });
igual(soloCompadres.length, 3, "filtro por grupo deja 3 tickets");
const soloEmy = filtrarVentas(ventas, { jugador: "c-2" });
igual(soloEmy.length, 1, "filtro por jugador deja 1 ticket");
const combo = filtrarVentas(ventas, { grupo: claveDe(ventas[0], "grupo"), jugador: "c-2" });
igual(combo.length, 0, "filtros combinados sin coincidencia → 0");

const op = opcionesDe(ventas, "grupo");
igual(op.map((o) => o.label), ["LA BANDA", "LOS COMPADRES"], "opciones de grupo ordenadas por nombre");

const orden = ordenarFilas(porGrupo, "enRiesgo", "desc");
igual(orden[0].etiqueta, "LA BANDA", "orden por en riesgo desc pone primero al grupo de 200");
const ordenAsc = ordenarFilas(porGrupo, "enRiesgo", "asc");
igual(ordenAsc[0].etiqueta, "LOS COMPADRES", "orden asc pone primero al grupo de 180");

console.log(`\n  REPORTE DE TABLAS FIJAS: ${pasan} ok, ${fallan} fallaron\n`);
if (fallan > 0) process.exit(1);
