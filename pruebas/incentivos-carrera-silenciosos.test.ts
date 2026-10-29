/**
 * SUITE DE PRUEBAS AUTOMATIZADAS:
 * ACREDITACIÓN SILENCIOSA DE INCENTIVOS CARRERA A CARRERA
 *
 * Valida estrictamente las 3 reglas de negocio:
 * 1. Acreditación Carrera a Carrera al Saldo y Disponible del Cliente:
 *    - Carrera 1: neto -200 + incentivo +15 => saldo 815,00
 *    - Carrera 2: neto +500 + incentivo +25 => saldo 1340,00
 * 2. Ocultación Estricta en el Resumen de Jugadas de la Carrera:
 *    - En la tabla de 7 columnas y en Ganadores/Perdedores:
 *      Carrera 1 muestra estrictamente -200,00 (Oculta los +15)
 *      Carrera 2 muestra estrictamente +500,00 (Oculta los +25)
 * 3. Reversión Simétrica Carrera a Carrera:
 *    - Al reversar la Carrera 2, el saldo/disponible regresa exactamente a 815,00.
 */

import assert from "node:assert/strict";
import {
  calcularResumenContableCliente,
  calcularIncentivoCarreraCliente,
  calcularResultadoLiquidacionClienteCarrera,
  type TicketContableRaw,
} from "../src/features/saldos/lib/contabilidad-central";
import { armarReporteCarrera } from "../src/features/liquidacion/lib/reporte-carrera";
import { generarTextoSaldosWhatsapp } from "../src/features/liquidacion/lib/reporte-imagen";
import { sumarDinero, restarDinero } from "../src/shared/lib/dinero";
import type { CarreraReporte } from "../src/features/liquidacion/lib/reportes";

let pasan = 0;
let fallan = 0;
const ok = (m: string) => {
  pasan++;
  console.log(`  ok   ${m}`);
};
const mal = (m: string, d?: string) => {
  fallan++;
  console.error(`  FALLA ${m}${d ? ` -> ${d}` : ""}`);
};

console.log("\n================================================================================");
console.log("SUITE: ACREDITACIÓN SILENCIOSA DE INCENTIVOS CARRERA A CARRERA");
console.log("================================================================================\n");

async function runTests() {
  const CLIENTE_ID = "cli-test-001";
  const CLIENTE_NOMBRE = "CARLOS MARTINEZ";
  const DEVOLUCION_PCT = 5; // 5% de incentivo sobre puestos decididos

  // ==============================================================================
  // PASO 1: SALDO INICIAL = 1000,00
  // ==============================================================================
  let saldoCliente = 1000.0;
  const saldoInicial = 1000.0;

  const estadoInicial = calcularResumenContableCliente({
    clienteId: CLIENTE_ID,
    nombre: CLIENTE_NOMBRE,
    saldoInicial,
    depositos: 0,
    retiros: 0,
    tickets: [],
    devolucionPct: DEVOLUCION_PCT,
  });

  assert.equal(estadoInicial.saldoContable, 1000.0);
  assert.equal(estadoInicial.disponibleParaJugar, 1000.0);
  ok("Paso 1: Cliente inicia con Saldo Contable = 1000,00 y Disponible = 1000,00");

  // ==============================================================================
  // PASO 2: CARRERA 1 — Jugadas con neto negativo -200 y devolución/incentivo de +15
  // ==============================================================================
  // Simulamos: 300 jugados en puestos (50 y 250).
  // Ticket 1: 50 1P gana neto 50 (premio 100)
  // Ticket 2: 250 2P pierde 250
  // Neto jugadas carrera = 50 - 250 = -200
  // Monto decidido en puestos = 50 + 250 = 300
  // Incentivo ganado = 5% de 300 = +15,00
  const ticketsCarrera1: TicketContableRaw[] = [
    {
      id: "tk-c1-1",
      cliente_juega_id: CLIENTE_ID,
      cliente_juega_nombre: CLIENTE_NOMBRE,
      cliente_consigue_nombre: "JUAN BANQUERO",
      hipodromo: "LA RINCONADA",
      carrera: 1,
      fecha_carrera: "2026-10-30",
      fecha_registro: "2026-10-30T14:00:00Z",
      nombre_jugada: "1P",
      caballo: "1",
      monto_jugado: 50,
      monto_decidido: 100,
      premio_pagar: 100,
      comision_porcentaje: 0,
      estado: "GANADOR",
      anulada: false,
      es_adelantada: false,
    },
    {
      id: "tk-c1-2",
      cliente_juega_id: CLIENTE_ID,
      cliente_juega_nombre: CLIENTE_NOMBRE,
      cliente_consigue_nombre: "JUAN BANQUERO",
      hipodromo: "LA RINCONADA",
      carrera: 1,
      fecha_carrera: "2026-10-30",
      fecha_registro: "2026-10-30T14:05:00Z",
      nombre_jugada: "2P",
      caballo: "2",
      monto_jugado: 250,
      monto_decidido: 250,
      premio_pagar: 0,
      comision_porcentaje: 0,
      estado: "PERDEDOR",
      anulada: false,
      es_adelantada: false,
    },
  ];

  const resultadoC1 = calcularResultadoLiquidacionClienteCarrera({
    clienteId: CLIENTE_ID,
    clienteNombre: CLIENTE_NOMBRE,
    carreraNumero: 1,
    hipodromo: "LA RINCONADA",
    devolucionPct: DEVOLUCION_PCT,
    ticketsDeCarrera: ticketsCarrera1,
  });

  assert.equal(resultadoC1.netoJugadasCarrera, -200.0, "Neto jugadas puro debe ser -200,00");
  assert.equal(resultadoC1.incentivoCarrera, 15.0, "Incentivo ganado debe ser +15,00");
  assert.equal(resultadoC1.impactoSaldoTotalCarrera, -185.0, "Impacto en saldo debe ser -200 + 15 = -185,00");
  ok("2.1 Carrera 1: Separación estricta de neto (-200,00) e incentivo (+15,00)");

  // 2.2 Verificación de Ocultación en el Resumen de Jugadas de la Carrera (ReporteCarrera)
  const carreraReporte1: CarreraReporte = {
    numero: 1,
    subtotal: -200,
    hipodromo: "LA RINCONADA",
    fecha: "2026-10-30",
    pizarra: "1 · 4 · 5",
    filas: [
      {
        id: "tk-c1-1-j-1",
        cliente: CLIENTE_NOMBRE,
        jugada: "1P",
        caballo: "1",
        monto: 50,
        resultado: 50,
        rol: "Juega",
      },
      {
        id: "tk-c1-1-c-1",
        cliente: "JUAN BANQUERO",
        jugada: "1P",
        caballo: "1",
        monto: 50,
        resultado: -50,
        rol: "Consigue",
      },
      {
        id: "tk-c1-2-j-2",
        cliente: CLIENTE_NOMBRE,
        jugada: "2P",
        caballo: "2",
        monto: 250,
        resultado: -250,
        rol: "Juega",
      },
      {
        id: "tk-c1-2-c-2",
        cliente: "JUAN BANQUERO",
        jugada: "2P",
        caballo: "2",
        monto: 250,
        resultado: 250,
        rol: "Consigue",
      },
    ],
  };

  const rep1 = armarReporteCarrera(carreraReporte1, "GRUPO DEMO", undefined, { modalidadCruce: "sin_cruces" });
  // En resumen de la carrera, CARLOS MARTINEZ debe estar en pierden con exactamente 200
  const perdedorC1 = rep1.resumen.pierden.find((p) => p.nombre.toUpperCase() === CLIENTE_NOMBRE);
  assert.ok(perdedorC1, "Cliente debe figurar en pierden del resumen");
  assert.equal(Math.abs(perdedorC1.monto), 200.0, "Resumen de carrera debe mostrar estrictamente 200,00 de pérdida pura");

  // PROHIBIDO que figure ninguna línea de incentivo en el reporte de la carrera
  const tieneLineasIncentivo = rep1.jugadasVivo.some(
    (f: { jugo?: string; juega?: string }) => /INCENTIVO|DEVOLUCION/i.test(f.jugo ?? "") || /INCENTIVO|DEVOLUCION/i.test(f.juega ?? "")
  );
  assert.equal(tieneLineasIncentivo, false, "PROHIBIDO mostrar líneas de incentivo en tabla de jugadas de carrera");
  ok("2.2 Carrera 1: Resumen de carrera oculta estrictamente el incentivo y muestra pérdida pura de 200,00");

  // 2.3 Actualización de Saldo y Disponible del Cliente: 1000 - 200 + 15 = 815,00
  saldoCliente = sumarDinero(saldoCliente, resultadoC1.impactoSaldoTotalCarrera);
  assert.equal(saldoCliente, 815.0, "Saldo del cliente pasa exactamente a 815,00");

  const estadoTrasC1 = calcularResumenContableCliente({
    clienteId: CLIENTE_ID,
    nombre: CLIENTE_NOMBRE,
    saldoInicial,
    depositos: 0,
    retiros: 0,
    tickets: ticketsCarrera1,
    devolucionPct: DEVOLUCION_PCT,
  });
  assert.equal(estadoTrasC1.saldoContable, 815.0, "saldoContable calculado por libro mayor = 815,00");
  assert.equal(estadoTrasC1.disponibleParaJugar, 815.0, "disponibleParaJugar para Carrera 2 = 815,00");
  ok("2.3 Carrera 1: Saldo Contable y Disponible acreditado carrera a carrera = 815,00 (1000 - 200 + 15)");

  // ==============================================================================
  // PASO 3: CARRERA 2 — Jugadas con neto positivo +500 y devolución/incentivo de +25
  // ==============================================================================
  // Simulamos: 500 jugados en puestos (5 tickets de 100).
  // 4 tickets ganan neto 200 c/u => +800
  // 1 ticket pierde 300 (o 3 de 100) => -300
  // Neto jugadas carrera = +800 - 300 = +500
  // Monto decidido en puestos = 500
  // Incentivo ganado = 5% de 500 = +25,00
  const ticketsCarrera2: TicketContableRaw[] = [
    {
      id: "tk-c2-1",
      cliente_juega_id: CLIENTE_ID,
      cliente_juega_nombre: CLIENTE_NOMBRE,
      cliente_consigue_nombre: "JUAN BANQUERO",
      hipodromo: "LA RINCONADA",
      carrera: 2,
      fecha_carrera: "2026-10-30",
      fecha_registro: "2026-10-30T15:00:00Z",
      nombre_jugada: "1P",
      caballo: "5",
      monto_jugado: 250,
      monto_decidido: 1000,
      premio_pagar: 1000,
      comision_porcentaje: 0,
      estado: "GANADOR",
      anulada: false,
      es_adelantada: false,
    },
    {
      id: "tk-c2-2",
      cliente_juega_id: CLIENTE_ID,
      cliente_juega_nombre: CLIENTE_NOMBRE,
      cliente_consigue_nombre: "JUAN BANQUERO",
      hipodromo: "LA RINCONADA",
      carrera: 2,
      fecha_carrera: "2026-10-30",
      fecha_registro: "2026-10-30T15:05:00Z",
      nombre_jugada: "2P",
      caballo: "6",
      monto_jugado: 250,
      monto_decidido: 250,
      premio_pagar: 0,
      comision_porcentaje: 0,
      estado: "PERDEDOR",
      anulada: false,
      es_adelantada: false,
    },
  ];

  const resultadoC2 = calcularResultadoLiquidacionClienteCarrera({
    clienteId: CLIENTE_ID,
    clienteNombre: CLIENTE_NOMBRE,
    carreraNumero: 2,
    hipodromo: "LA RINCONADA",
    devolucionPct: DEVOLUCION_PCT,
    ticketsDeCarrera: ticketsCarrera2,
  });

  // Ganancia neta = (1000 - 250) - 250 = 750 - 250 = 500
  assert.equal(resultadoC2.netoJugadasCarrera, 500.0, "Neto jugadas puro debe ser +500,00");
  // Monto decidido = 250 + 250 = 500. 5% de 500 = 25
  assert.equal(resultadoC2.incentivoCarrera, 25.0, "Incentivo ganado debe ser +25,00");
  assert.equal(resultadoC2.impactoSaldoTotalCarrera, 525.0, "Impacto en saldo debe ser +500 + 25 = +525,00");
  ok("3.1 Carrera 2: Separación estricta de neto (+500,00) e incentivo (+25,00)");

  // 3.2 Ocultación en el Resumen de Jugadas de la Carrera 2
  const carreraReporte2: CarreraReporte = {
    numero: 2,
    subtotal: 500,
    hipodromo: "LA RINCONADA",
    fecha: "2026-10-30",
    pizarra: "5 · 2 · 8",
    filas: [
      {
        id: "tk-c2-1-j-1",
        cliente: CLIENTE_NOMBRE,
        jugada: "1P",
        caballo: "5",
        monto: 250,
        resultado: 750,
        rol: "Juega",
      },
      {
        id: "tk-c2-1-c-1",
        cliente: "JUAN BANQUERO",
        jugada: "1P",
        caballo: "5",
        monto: 250,
        resultado: -750,
        rol: "Consigue",
      },
      {
        id: "tk-c2-2-j-2",
        cliente: CLIENTE_NOMBRE,
        jugada: "2P",
        caballo: "6",
        monto: 250,
        resultado: -250,
        rol: "Juega",
      },
      {
        id: "tk-c2-2-c-2",
        cliente: "JUAN BANQUERO",
        jugada: "2P",
        caballo: "6",
        monto: 250,
        resultado: 250,
        rol: "Consigue",
      },
    ],
  };

  const rep2 = armarReporteCarrera(carreraReporte2, "GRUPO DEMO", undefined, { modalidadCruce: "sin_cruces" });
  const ganadorC2 = rep2.resumen.ganan.find((g) => g.nombre.toUpperCase() === CLIENTE_NOMBRE);
  assert.ok(ganadorC2, "Cliente debe figurar en ganan del resumen de Carrera 2");
  assert.equal(Math.abs(ganadorC2.monto), 500.0, "Resumen de carrera debe mostrar estrictamente +500,00 neto puro");
  ok("3.2 Carrera 2: Resumen de carrera oculta estrictamente el incentivo y muestra ganancia pura de 500,00");

  // 3.3 Actualización Acumulada de Saldo y Disponible: 815 + 500 + 25 = 1340,00
  saldoCliente = sumarDinero(saldoCliente, resultadoC2.impactoSaldoTotalCarrera);
  assert.equal(saldoCliente, 1340.0, "Saldo del cliente pasa exactamente a 1340,00");

  const estadoTrasC2 = calcularResumenContableCliente({
    clienteId: CLIENTE_ID,
    nombre: CLIENTE_NOMBRE,
    saldoInicial,
    depositos: 0,
    retiros: 0,
    tickets: [...ticketsCarrera1, ...ticketsCarrera2],
    devolucionPct: DEVOLUCION_PCT,
  });
  assert.equal(estadoTrasC2.saldoContable, 1340.0, "saldoContable calculado por libro mayor = 1340,00");
  assert.equal(estadoTrasC2.disponibleParaJugar, 1340.0, "disponibleParaJugar = 1340,00");
  ok("3.3 Carrera 2: Saldo Contable y Disponible acumulado = 1340,00 (815 + 500 + 25)");

  // 3.4 Reporte de Saldos para WhatsApp refleja el disponible real con incentivos incluidos
  const wspText = generarTextoSaldosWhatsapp({
    grupo: "GRUPO DEMO",
    hipodromo: "LA RINCONADA",
    carrera: 2,
    clientes: [
      {
        nombre: CLIENTE_NOMBRE,
        saldoContable: estadoTrasC2.saldoContable,
        disponible: estadoTrasC2.disponibleParaJugar,
        aval: 0,
        riesgoEnCurso: 0,
        libre: false,
        tuvoMovimiento: true,
      },
    ],
  });
  assert.ok(wspText.includes("1.340,00") || wspText.includes("1340"), "WhatsApp muestra disponible real 1340,00");
  ok("3.4 WhatsApp Reporte de Saldos: Muestra el Disponible real de 1340,00 con incentivos");

  // ==============================================================================
  // PASO 4: REVERSIÓN SIMÉTRICA DE LA CARRERA 2
  // ==============================================================================
  // Al reversar Carrera 2, se debe descontar exactamente el impacto total de la Carrera 2:
  // impactoSaldoTotalCarrera = +525,00 (500 jugadas + 25 incentivo)
  // saldoCliente = 1340,00 - 525,00 = 815,00
  saldoCliente = restarDinero(saldoCliente, resultadoC2.impactoSaldoTotalCarrera);
  assert.equal(saldoCliente, 815.0, "Saldo regresa simétricamente a 815,00 tras reversar Carrera 2");

  // El libro mayor sin los tickets de la Carrera 2 (o con ellos pendientes/anulados) da exactamente 815,00
  const estadoTrasReversionC2 = calcularResumenContableCliente({
    clienteId: CLIENTE_ID,
    nombre: CLIENTE_NOMBRE,
    saldoInicial,
    depositos: 0,
    retiros: 0,
    tickets: ticketsCarrera1, // solo quedan los de C1
    devolucionPct: DEVOLUCION_PCT,
  });
  assert.equal(estadoTrasReversionC2.saldoContable, 815.0, "saldoContable tras reversión = 815,00");
  assert.equal(estadoTrasReversionC2.disponibleParaJugar, 815.0, "disponibleParaJugar tras reversión = 815,00");
  ok("Paso 4: Reversión simétrica perfecta: Saldo Contable y Disponible regresa a 815,00");

  console.log("\n================================================================================");
  console.log(`RESULTADO DE LA SUITE: ${pasan} pasaron, ${fallan} fallaron.`);
  console.log("================================================================================\n");
  if (fallan > 0) process.exit(1);
}

runTests().catch((e) => {
  console.error("ERROR FATAL EN SUITE:", e);
  process.exit(1);
});
