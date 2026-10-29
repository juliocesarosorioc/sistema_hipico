/**
 * Suite de Certificacion: WPS con Incentivos, Rangos de Precios y Tabla Oficial de Venezuela
 */

import assert from "node:assert/strict";
import {
  parsearLineaWps,
  parsearBloqueWps,
  resolverDividendoVenezuela,
  calcularDividendoConIncentivos,
  calcularPagoWps,
  type ConfiguracionIncentivosWps,
} from "../src/features/motores/lib/wps-incentivos";
import { liquidarWps } from "../src/features/motores/lib/wps";
import type { TicketMotor } from "../src/features/betting/lib/bettingEngine";

let totalOk = 0;
function test(desc: string, fn: () => void) {
  try {
    fn();
    totalOk++;
    console.log(`  ok  ${desc}`);
  } catch (e) {
    console.error(`  FALLA ${desc}`);
    throw e;
  }
}

console.log("\n=======================================================");
console.log("SUITE: WPS INCENTIVOS, RANGOS DE PRECIO Y TABLA VENEZUELA");
console.log("=======================================================\n");

// 1. PARSEO DE LECTURA DE JUGADAS
test("1.1 Parsea 'Jugador win Ejemplar Monto'", () => {
  const apuestas = parsearLineaWps("Carlos win 4 100");
  assert.equal(apuestas.length, 1);
  assert.equal(apuestas[0].jugador, "Carlos");
  assert.equal(apuestas[0].modalidad, "WIN");
  assert.equal(apuestas[0].tipoWps, "W");
  assert.equal(apuestas[0].ejemplar, "4");
  assert.equal(apuestas[0].monto, 100);
});

test("1.2 Parsea 'Jugador place Ejemplar Monto'", () => {
  const apuestas = parsearLineaWps("Maria place 7 50");
  assert.equal(apuestas.length, 1);
  assert.equal(apuestas[0].jugador, "Maria");
  assert.equal(apuestas[0].modalidad, "PLACE");
  assert.equal(apuestas[0].tipoWps, "P");
  assert.equal(apuestas[0].ejemplar, "7");
  assert.equal(apuestas[0].monto, 50);
});

test("1.3 Parsea 'Jugador show Ejemplar Monto'", () => {
  const apuestas = parsearLineaWps("Pedro show 2 80");
  assert.equal(apuestas.length, 1);
  assert.equal(apuestas[0].jugador, "Pedro");
  assert.equal(apuestas[0].modalidad, "SHOW");
  assert.equal(apuestas[0].tipoWps, "S");
  assert.equal(apuestas[0].ejemplar, "2");
  assert.equal(apuestas[0].monto, 80);
});

test("1.4 'Jugador WPS Ejemplar Monto' genera las 3 apuestas (Win, Place y Show)", () => {
  const apuestas = parsearLineaWps("Juan WPS 5 100");
  assert.equal(apuestas.length, 3);
  assert.equal(apuestas[0].modalidad, "WIN");
  assert.equal(apuestas[0].tipoWps, "W");
  assert.equal(apuestas[0].monto, 100);
  assert.equal(apuestas[1].modalidad, "PLACE");
  assert.equal(apuestas[1].tipoWps, "P");
  assert.equal(apuestas[1].monto, 100);
  assert.equal(apuestas[2].modalidad, "SHOW");
  assert.equal(apuestas[2].tipoWps, "S");
  assert.equal(apuestas[2].monto, 100);
});

test("1.5 Parsea bloque multilínea con formato mixto y comentarios", () => {
  const bloque = `
    # Apuestas de la carrera 5
    Alana win 1 200
    Roberto place 3 150
    Andres show 8 100
    Jose WPS 6 50
  `;
  const { apuestas, lineasRechazadas } = parsearBloqueWps(bloque);
  assert.equal(lineasRechazadas.length, 0);
  assert.equal(apuestas.length, 6); // 1 + 1 + 1 + 3 = 6 apuestas
});

// 2. TABLA OFICIAL DE VENEZUELA (IMAGEN: BOLETO 100,00 BS.)
test("2.1 Fracciones exactas de la tabla oficial INH", () => {
  const r1_9 = resolverDividendoVenezuela("1-9");
  assert.ok(r1_9);
  assert.equal(r1_9.montoBs, 110.0);
  assert.equal(r1_9.factorDecimal, 1.1);

  const r3_2 = resolverDividendoVenezuela("3-2");
  assert.ok(r3_2);
  assert.equal(r3_2.montoBs, 250.0);
  assert.equal(r3_2.factorDecimal, 2.5);

  const r5_2 = resolverDividendoVenezuela("5-2");
  assert.ok(r5_2);
  assert.equal(r5_2.montoBs, 305.0);
  assert.equal(r5_2.factorDecimal, 3.05);

  const r9_2 = resolverDividendoVenezuela("9-2");
  assert.ok(r9_2);
  assert.equal(r9_2.montoBs, 550.0);
  assert.equal(r9_2.factorDecimal, 5.5);
});

test("2.2 Proporciones enteras N a 1 (pagando (N+1)*100 Bs)", () => {
  const r1 = resolverDividendoVenezuela("1");
  assert.ok(r1);
  assert.equal(r1.montoBs, 200.0);
  assert.equal(r1.factorDecimal, 2.0);

  const r5 = resolverDividendoVenezuela(5);
  assert.ok(r5);
  assert.equal(r5.montoBs, 600.0);
  assert.equal(r5.factorDecimal, 6.0);

  const r25 = resolverDividendoVenezuela(25);
  assert.ok(r25);
  assert.equal(r25.montoBs, 2600.0);
  assert.equal(r25.factorDecimal, 26.0);

  const r99 = resolverDividendoVenezuela(99);
  assert.ok(r99);
  assert.equal(r99.montoBs, 10000.0);
  assert.equal(r99.factorDecimal, 100.0);
});

test("2.3 Montos directos en Bolívares por boleto de 100 Bs", () => {
  const b250 = resolverDividendoVenezuela("Bs. 250,00");
  assert.ok(b250);
  assert.equal(b250.factorDecimal, 2.5);

  const b1300 = resolverDividendoVenezuela("1300 Bs");
  assert.ok(b1300);
  assert.equal(b1300.factorDecimal, 13.0);
});

// 3. MOTOR DE INCENTIVOS: RANGOS DE PRECIOS Y SUMA FIJA
test("3.1 Rango de precios: de 2.10 a 2.50 llevalo a 2.50", () => {
  const config: ConfiguracionIncentivosWps = {
    activo: true,
    sumaFijaWin: 0,
    sumaFijaPlace: 0,
    sumaFijaShow: 0,
    rangos: [
      { min: 2.1, max: 2.5, llevarA: 2.5 },
      { min: 2.51, max: 3.0, llevarA: 3.0 },
      { min: 3.01, max: 3.5, llevarA: 3.5 },
    ],
    aplicarTablaVenezuela: true,
  };

  const res220 = calcularDividendoConIncentivos(2.2, config, "W");
  assert.equal(res220.dividendoFinal, 2.5);
  assert.equal(res220.incentivoTotal, 0.3);

  const res240 = calcularDividendoConIncentivos(2.4, config, "W");
  assert.equal(res240.dividendoFinal, 2.5);
  assert.equal(res240.incentivoTotal, 0.1);
});

test("3.2 Rango de precios: de 2.51 a 3.00 llevalo a 3.00 y de 3.01 a 3.50 llevalo a 3.50", () => {
  const config: ConfiguracionIncentivosWps = {
    activo: true,
    sumaFijaWin: 0,
    sumaFijaPlace: 0,
    sumaFijaShow: 0,
    rangos: [
      { min: 2.1, max: 2.5, llevarA: 2.5 },
      { min: 2.51, max: 3.0, llevarA: 3.0 },
      { min: 3.01, max: 3.5, llevarA: 3.5 },
    ],
    aplicarTablaVenezuela: true,
  };

  const res280 = calcularDividendoConIncentivos(2.8, config, "P");
  assert.equal(res280.dividendoFinal, 3.0);
  assert.equal(res280.incentivoTotal, 0.2);

  const res305 = calcularDividendoConIncentivos(3.05, config, "S");
  assert.equal(res305.dividendoFinal, 3.5);
  assert.equal(res305.incentivoTotal, 0.45);
});

test("3.3 Suma fija combinada con modalidad específica", () => {
  const config: ConfiguracionIncentivosWps = {
    activo: true,
    sumaFijaWin: 0.5,
    sumaFijaPlace: 0.25,
    sumaFijaShow: 0.1,
    rangos: [],
    aplicarTablaVenezuela: true,
  };

  const win = calcularDividendoConIncentivos(3.0, config, "W");
  assert.equal(win.dividendoFinal, 3.5);

  const place = calcularDividendoConIncentivos(3.0, config, "P");
  assert.equal(place.dividendoFinal, 3.25);

  const show = calcularDividendoConIncentivos(3.0, config, "S");
  assert.equal(show.dividendoFinal, 3.1);
});

// 4. CÁLCULO DE PAGOS Y LIQUIDACIÓN INTEGRADA
test("4.1 Cálculo del pago total: (dividendo + incentivo) * monto en riesgo", () => {
  const config: ConfiguracionIncentivosWps = {
    activo: true,
    sumaFijaWin: 0,
    sumaFijaPlace: 0,
    sumaFijaShow: 0,
    rangos: [{ min: 2.1, max: 2.5, llevarA: 2.5 }],
    aplicarTablaVenezuela: true,
  };

  // Monto 100, dividendo base 2.20 -> con incentivo pasa a 2.50 -> pago 250
  const pago = calcularPagoWps(100, 2.2, config, "W");
  assert.equal(pago.dividendoFinal, 2.5);
  assert.equal(pago.pagoTotal, 250);
  assert.equal(pago.gananciaNeta, 150);
});

test("4.2 liquidarWps con configuración de incentivos del grupo", () => {
  const config: ConfiguracionIncentivosWps = {
    activo: true,
    sumaFijaWin: 0.5, // Suma 0.50 al dividendo final
    sumaFijaPlace: 0,
    sumaFijaShow: 0,
    rangos: [],
    aplicarTablaVenezuela: true,
  };

  const ticket: TicketMotor = {
    id: "test-wps-1",
    cruces: 1,
    cuota: null,
    total: 100,
    addedAt: Date.now(),
    puesto_final: 1,
    hipodromo: "LA RINCONADA",
    carrera: "1",
    caballo: "3",
    tipo_jugada: "W",
    monto: 100,
    fechas: [],
    pizarra: { primero: "3", segundo: "7", tercero: "2" },
    dividendos: { wps_WW: 3.0 }, // Base paga 3.00x
  };

  // Sin incentivos (comisión casa 5% sobre ganancia 200 = 10 -> neto 290)
  const resBase = liquidarWps(ticket, 5);
  assert.ok(resBase && resBase.ok);
  assert.equal(resBase.totalClienteNeto, 290);

  // Con incentivo de +0.50 -> dividendo pasa a 3.50x -> bruto 350 -> ganancia 250 -> comisión 12.50 -> neto 337.50
  const resInc = liquidarWps(ticket, 5, config);
  assert.ok(resInc && resInc.ok);
  assert.equal(resInc.totalClienteNeto, 337.5);
});

console.log(`\n🎉 TODAS LAS ASIGNACIONES DE LA SUITE WPS INCENTIVOS Y TABLA VENEZUELA PASARON EXITOSAMENTE (${totalOk} casos).\n`);
