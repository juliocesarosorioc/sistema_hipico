import assert from "node:assert";
import {
  calcularReembolsosCruce,
  _reembolsosCruce,
} from "../src/features/taquilla/lib/cruces-y-tapas";
import {
  calcularBaseDecididaCarrera,
  esJugadaElegibleParaDevolucion,
} from "../src/features/liquidacion/lib/devoluciones-cruce";
import {
  calcularLiquidacionPuestosCarrera,
  type EntradaCrucePuestos,
} from "../src/features/motores/lib/puestos";
import {
  calcularIncentivoCarreraCliente,
} from "../src/features/saldos/lib/contabilidad-central";
import {
  parsearPropuestaChat,
} from "../src/features/whatsapp-sala/lib/chat-p2p";

let pasan = 0;
const test = (nombre: string, fn: () => void) => {
  try {
    fn();
    pasan++;
    console.log(`  ok   ${nombre}`);
  } catch (e) {
    console.error(`  FALLA ${nombre}:`, (e as Error).message);
    throw e;
  }
};

console.log("=== PRUEBAS CRUCES Y DEVOLUCIONES ROL CONSIGUE ===");

// 1. Caso PARTNER Belmont Park C1
test("Caso PARTNER: Cruce de comisiones incluye pérdidas como Consigue", () => {
  const lineas = [
    { cliente: "PARTNER", brutoGanado: 0, brutoPerdido: 300, rol: "Consigue" },
    { cliente: "PARTNER", brutoGanado: 80, brutoPerdido: 0, comisionCobrada: 4, rol: "Juega" },
  ];
  const res = calcularReembolsosCruce(lineas, "con_cruces", 5);
  const item = res.porCliente.get("PARTNER");
  assert.ok(item, "Debe existir reembolso para PARTNER");
  assert.strictEqual(item?.brutoGanado, 80);
  assert.strictEqual(item?.brutoPerdido, 300);
  assert.strictEqual(item?.baseCruce, 80);
  assert.strictEqual(item?.reembolsoCruce, 4, "Debe reembolsar los 4.00 de comisión cobrada");
});

test("Caso PARTNER: Base decidida e incentivo sobre la diferencia con rol Consigue (saldo negativo = 0)", () => {
  const jugadas = [
    { nombreJugada: "2N", montoJugado: 300, resultado: -300, estado: "GANADOR", rol: "Consigue" },
    { nombreJugada: "2N Y 2Y2N", montoJugado: 80, premioPagar: 160, resultado: 80, estado: "GANADOR", rol: "Juega" },
  ];
  const res = calcularBaseDecididaCarrera(jugadas, 1.0); // 1% de incentivo
  assert.strictEqual(res.hayCruce, true);
  assert.strictEqual(res.consigueIncluidoPorCruce, true);
  assert.strictEqual(res.totalGanadoBruto, 80);
  assert.strictEqual(res.totalPerdidoBruto, 300);
  assert.strictEqual(res.baseDecidida, 0, "Si el saldo termina negativo (80 - 300 = -220), no hay base de incentivo");
  assert.strictEqual(res.devolucion, 0, "Devolución con saldo neto negativo debe ser 0");
});

test("Caso PARTNER: Base decidida e incentivo cuando saldo termina POSITIVO (ganado 300, perdido 80 = +220)", () => {
  const jugadas = [
    { nombreJugada: "2N", montoJugado: 80, resultado: -80, estado: "GANADOR", rol: "Consigue" },
    { nombreJugada: "2N Y 2Y2N", montoJugado: 150, premioPagar: 450, resultado: 300, estado: "GANADOR", rol: "Juega" },
  ];
  const res = calcularBaseDecididaCarrera(jugadas, 1.0); // 1% de incentivo
  assert.strictEqual(res.hayCruce, true);
  assert.strictEqual(res.consigueIncluidoPorCruce, true);
  assert.strictEqual(res.totalGanadoBruto, 300);
  assert.strictEqual(res.totalPerdidoBruto, 80);
  assert.strictEqual(res.baseDecidida, 220, "Base decidida debe ser 300 - 80 = 220");
  assert.strictEqual(res.devolucion, 2.2, "Devolución al 1% sobre 220 debe ser 2.20");
  assert.ok(res.notaAsiento?.includes("Cruce con rol Consigue"), "Debe generar nota para el asiento");
});

test("Rol Consigue aislado sin cruce NO devenga incentivo ni devolución", () => {
  const soloConsigue = [
    { nombreJugada: "2N", montoJugado: 300, resultado: -300, estado: "GANADOR", rol: "Consigue" },
  ];
  const res = calcularBaseDecididaCarrera(soloConsigue, 1.0);
  assert.strictEqual(res.hayCruce, false);
  assert.strictEqual(res.consigueIncluidoPorCruce, false);
  assert.strictEqual(res.devolucion, 0);
  assert.strictEqual(esJugadaElegibleParaDevolucion(soloConsigue[0]), false);
});

test("calcularIncentivoCarreraCliente considera cruce con Consigue (solo si saldo positivo)", () => {
  const ticketsNegativo = [
    {
      id: 1,
      nombre_jugada: "2N",
      monto_jugado: 300,
      cliente_juega_nombre: "ANGELO",
      cliente_consigue_nombre: "PARTNER",
      estado: "Ganador",
      resultado_neto: 300, // Ganó Angelo -> perdió Partner ($300)
    },
    {
      id: 2,
      nombre_jugada: "2N Y 2Y2N",
      monto_jugado: 80,
      premio_pagar: 160,
      cliente_juega_nombre: "PARTNER",
      cliente_consigue_nombre: "SPEEDY",
      estado: "Ganador",
      resultado_neto: 80, // Ganó Partner ($80)
    },
  ];
  const incNeg = calcularIncentivoCarreraCliente(ticketsNegativo, 1.0, "PARTNER");
  assert.strictEqual(incNeg, 0, "Con saldo negativo (80 - 300 = -220), incentivo debe ser 0");

  const ticketsPositivo = [
    {
      id: 1,
      nombre_jugada: "2N",
      monto_jugado: 80,
      cliente_juega_nombre: "ANGELO",
      cliente_consigue_nombre: "PARTNER",
      estado: "Ganador",
      resultado_neto: 80, // Ganó Angelo -> perdió Partner ($80)
    },
    {
      id: 2,
      nombre_jugada: "2N Y 2Y2N",
      monto_jugado: 150,
      premio_pagar: 450,
      cliente_juega_nombre: "PARTNER",
      cliente_consigue_nombre: "SPEEDY",
      estado: "Ganador",
      resultado_neto: 300, // Ganó Partner ($300)
    },
  ];
  const incPos = calcularIncentivoCarreraCliente(ticketsPositivo, 1.0, "PARTNER");
  assert.strictEqual(incPos, 2.2, "Incentivo debe ser 2.20 sobre la diferencia de 220 positiva");
});

test("Motor de puestos: cruce de comisiones neto compensando pérdida como Consigue", () => {
  const entradas: EntradaCrucePuestos[] = [
    // 3 jugadas ganadoras como juega ($80 total ganancia)
    { cliente: "PARTNER", clienteId: "partner-uuid", ok: true, bruto: 20, monto: 10, caballo: "1" },
    { cliente: "PARTNER", clienteId: "partner-uuid", ok: true, bruto: 80, monto: 40, caballo: "1" },
    { cliente: "PARTNER", clienteId: "partner-uuid", ok: true, bruto: 60, monto: 30, caballo: "1" },
    // 1 pérdida como consigue ($300 perdida)
    { cliente: "PARTNER", clienteId: "partner-uuid", ok: false, bruto: 0, monto: 300, caballo: "1" },
  ];

  const res = calcularLiquidacionPuestosCarrera(entradas, {
    permiteCruces: true,
    pctComision: 5,
    grupo: { mismoEjemplar: true, diferenteEjemplar: true },
  });

  assert.strictEqual(res.length, 1);
  const part = res[0];
  assert.strictEqual(part.ganadoBruto, 80);
  assert.strictEqual(part.perdidoBruto, 300);
  assert.strictEqual(part.baseComision, 0, "Base de comisión con cruce debe ser 0");
  assert.strictEqual(part.comision, 0, "Comisión con cruce total debe ser 0");
  assert.strictEqual(part.neto, -220, "Neto es 80 - 300 = -220");
});

test("Chat P2P: 'Doy 50 al 2' NO es propuesta ni jugada (solo puestos permitidos)", () => {
  assert.strictEqual(parsearPropuestaChat("Doy 50 al 2"), null);
  assert.strictEqual(parsearPropuestaChat("Doy 2 50"), null);
  assert.strictEqual(parsearPropuestaChat("dar 50 al 2"), null);
});

test("Chat P2P: Las propuestas de chat reconocen exactamente jugadas de puestos", () => {
  const p1 = parsearPropuestaChat("Juego 1p 7 100");
  assert.deepStrictEqual(p1, { esPropuesta: true, rol: "JUEGA", jugada: "1P", caballo: "7", monto: 100, contraparte: undefined });

  const p2 = parsearPropuestaChat("Juego 2n 1 50 con @SAM");
  assert.deepStrictEqual(p2, { esPropuesta: true, rol: "JUEGA", jugada: "2N", caballo: "1", monto: 50, contraparte: "SAM" });

  const p3 = parsearPropuestaChat("50 2p al 7");
  assert.deepStrictEqual(p3, { esPropuesta: true, rol: "JUEGA", jugada: "2P", caballo: "7", monto: 50, contraparte: undefined });

  const p4 = parsearPropuestaChat("250 10/6 1.3");
  assert.deepStrictEqual(p4, { esPropuesta: true, rol: "JUEGA", jugada: "10/6", caballo: "1.3", monto: 250, contraparte: undefined });

  const p5 = parsearPropuestaChat("100 al 5");
  assert.deepStrictEqual(p5, { esPropuesta: true, rol: "JUEGA", jugada: "1P", caballo: "5", monto: 100, contraparte: undefined });
});

console.log(`\n🎉 TODAS LAS PRUEBAS DE CRUCE Y DEVOLUCIÓN ROL CONSIGUE PASARON (${pasan}/${pasan})`);
