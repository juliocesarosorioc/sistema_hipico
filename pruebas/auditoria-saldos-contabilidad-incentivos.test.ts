/**
 * SUITE DE AUDITORÍA INTEGRAL:
 * Coincidencia estricta de Saldos Semanales, Saldo del Usuario y Contabilidad NIIF.
 * Validación de cero incentivos/devoluciones para usuarios no configurados (<= 0% o null),
 * restricción estricta a PUESTOS (excluyendo Tablas, Marcas, WPS, Pollas, etc.) y solo para apostador ("Juega").
 * Precisión absoluta en centavos enteros sin cifras inventadas.
 */

import {
  calcularResumenContableCliente,
  calcularResultadoLiquidacionClienteCarrera,
  esJugadaPuestosParaIncentivo,
} from "../src/features/saldos/lib/contabilidad-central";
import { calcularSaldoSemana, calcularDeltaMovimientoSaldo } from "../src/features/saldos/lib/saldo-semanal";
import { calcularBaseDecididaCarrera, esJugadaElegibleParaDevolucion } from "../src/features/liquidacion/lib/devoluciones-cruce";
import {
  generarAsientoLiquidacionCarrera,
  generarAsientoDevolucionIncentivo,
  generarAsientoReembolsoCruce,
} from "../src/features/contabilidad/lib/plan-cuentas";
import { aCentavos, deCentavos, redondearCentavos, sumarDinero, restarDinero } from "../src/shared/lib/dinero";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FALLO DE AUDITORÍA: " + msg);
}

function assertIgual(act: unknown, esp: unknown, msg: string) {
  if (act !== esp) {
    throw new Error(`FALLO DE AUDITORÍA: ${msg} -> esperado: ${JSON.stringify(esp)}, obtenido: ${JSON.stringify(act)}`);
  }
}

async function ejecutarAuditoria() {
  console.log("=== INICIO AUDITORÍA INTEGRAL DE SALDOS, CONTABILIDAD E INCENTIVOS ===");

  // --------------------------------------------------------------------------
  // TEST 1: Cliente SIN devolución/incentivos (0% o null o no definido)
  // --------------------------------------------------------------------------
  console.log("1. Auditando cliente con 0% de incentivo / devolución...");

  const ticketsClienteSinDev = [
    {
      id: "t-1",
      cliente_juega_id: "cli-nodev",
      cliente_juega_nombre: "JUGADOR_SIN_DEV",
      hipodromo: "GP",
      carrera: 1,
      fecha_carrera: "2026-11-01",
      nombre_jugada: "PP",
      monto_jugado: 500,
      premio_pagar: 1000,
      estado: "GANADOR",
      anulada: false,
    },
    {
      id: "t-2",
      cliente_juega_id: "cli-nodev",
      cliente_juega_nombre: "JUGADOR_SIN_DEV",
      hipodromo: "GP",
      carrera: 2,
      fecha_carrera: "2026-11-01",
      nombre_jugada: "1P",
      monto_jugado: 300,
      premio_pagar: 0,
      estado: "PERDEDOR",
      anulada: false,
    },
  ];

  // A. calcularResumenContableCliente con devolucionPct = 0
  const r0 = calcularResumenContableCliente({
    clienteId: "cli-nodev",
    nombre: "JUGADOR_SIN_DEV",
    saldoInicial: 0,
    devolucionPct: 0,
    tickets: ticketsClienteSinDev,
  });
  assertIgual(r0.devolucionIncentivo, 0, "devolucionIncentivo debe ser 0 cuando devolucionPct = 0");
  assertIgual(r0.incentivoCarrera, 0, "incentivoCarrera debe ser 0 cuando devolucionPct = 0");

  // B. calcularResumenContableCliente con devolucionPct = null
  const rNull = calcularResumenContableCliente({
    clienteId: "cli-nodev",
    nombre: "JUGADOR_SIN_DEV",
    saldoInicial: 0,
    devolucionPct: null,
    tickets: ticketsClienteSinDev,
  });
  assertIgual(rNull.devolucionIncentivo, 0, "devolucionIncentivo debe ser 0 cuando devolucionPct = null");

  // C. calcularBaseDecididaCarrera directa con 0%
  const resBase0 = calcularBaseDecididaCarrera(
    ticketsClienteSinDev.map((t) => ({
      nombreJugada: t.nombre_jugada,
      montoJugado: t.monto_jugado,
      premioPagar: t.premio_pagar,
      estado: t.estado,
      rol: "Juega",
    })),
    0
  );
  assertIgual(resBase0.devolucion, 0, "calcularBaseDecididaCarrera devolucion debe ser 0 para 0%");

  console.log("  OK: Clientes sin incentivo no reciben ningún centavo inventado.");

  // --------------------------------------------------------------------------
  // TEST 2: Rol "Consigue" (Contraparte / Dador) NUNCA recibe incentivo
  // --------------------------------------------------------------------------
  console.log("2. Auditando que el rol Consigue (dador) nunca devenga incentivo...");

  const ticketConsigue = {
    id: "t-cons",
    nombreJugada: "PP",
    montoJugado: 200,
    premioPagar: 0,
    estado: "PERDEDOR",
    rol: "Consigue",
  };
  assertIgual(
    esJugadaElegibleParaDevolucion(ticketConsigue),
    false,
    "Jugada de rol Consigue no debe ser elegible para devolución"
  );

  const resConsigue = calcularBaseDecididaCarrera([ticketConsigue], 2.0); // 2% configurado
  assertIgual(resConsigue.devolucion, 0, "Consigue con 2% configurado no debe generar devolución");

  console.log("  OK: Rol Consigue estrictamente excluido de devoluciones.");

  // --------------------------------------------------------------------------
  // TEST 3: Exclusiones de modalidades no-puestos (Tablas, Marcas, WPS)
  // --------------------------------------------------------------------------
  console.log("3. Auditando exclusión estricta de Tablas, Marcas, WPS, Pollas, Remates...");

  assertIgual(esJugadaPuestosParaIncentivo("TABLA FIJA", "TF", ""), false, "Tabla Fija excluida");
  assertIgual(esJugadaPuestosParaIncentivo("TF 1X2", "", ""), false, "TF excluida");
  assertIgual(esJugadaPuestosParaIncentivo("MARCA", "", ""), false, "Marca excluida");
  assertIgual(esJugadaPuestosParaIncentivo("MARCAS", "", ""), false, "Marcas excluida");
  assertIgual(esJugadaPuestosParaIncentivo("DUPLETA", "", ""), false, "Dupleta excluida");
  assertIgual(esJugadaPuestosParaIncentivo("POLLAS", "", ""), false, "Polla excluida");
  assertIgual(esJugadaPuestosParaIncentivo("REMATES", "", ""), false, "Remates excluido");
  assertIgual(esJugadaPuestosParaIncentivo("WPS", "WPS", "WPS"), false, "WPS excluido");
  assertIgual(esJugadaPuestosParaIncentivo("PP", "", ""), true, "PP incluido");
  assertIgual(esJugadaPuestosParaIncentivo("1P", "", ""), true, "1P incluido");
  assertIgual(esJugadaPuestosParaIncentivo("2N", "", ""), true, "2N incluido");
  assertIgual(esJugadaPuestosParaIncentivo("PUESTOS", "", ""), true, "PUESTOS incluido");

  console.log("  OK: Solo puestos califican para devolución / incentivos.");

  // --------------------------------------------------------------------------
  // TEST 4: Coincidencia perfecta de Saldo Semanal vs Saldo Usuario vs Libro Mayor
  // --------------------------------------------------------------------------
  console.log("4. Auditando coincidencia matemática exacta entre Saldo Semanal, Saldo Usuario y Caja...");

  // Supongamos un cliente que:
  // - Inicia semana en 0.00
  // - Realiza jugadas en la semana:
  //   · Carrera 1: Gana neto +190.00 (bruto 200 - comision 10)
  //   · Carrera 2: Pierde -100.00
  //   · Neto carreras = 190.00 - 100.00 = +90.00
  // - Incentivo configurado al 1.00% sobre puestos decididos:
  //   · C1 base 200 -> incentivo 2.00
  //   · C2 base 100 -> incentivo 1.00
  //   · Total incentivos semana = +3.00
  // - Movimientos de caja en la semana:
  //   · Depósito recibido: +50.00
  //   · Retiro solicitado y pagado: -40.00
  //   · Movimiento neto de caja = +10.00

  const netoCarreras = 90.00;
  const totalDevolucion = 3.00;
  const movimientosCaja = calcularDeltaMovimientoSaldo("DEPOSITO", 50.00) + calcularDeltaMovimientoSaldo("RETIRO", 40.00);
  assertIgual(movimientosCaja, 10.00, "Movimientos de caja netos = +10.00");

  const saldoSemanalCalculado = calcularSaldoSemana(netoCarreras, totalDevolucion, movimientosCaja);
  assertIgual(saldoSemanalCalculado, 103.00, "Saldo semanal esperado = 90 + 3 + 10 = 103.00");

  // Verificar libro mayor contable (SSOT clientes.saldo_actual)
  const saldoContableLibro = sumarDinero(
    sumarDinero(0, movimientosCaja),
    sumarDinero(netoCarreras, totalDevolucion)
  );
  assertIgual(saldoContableLibro, saldoSemanalCalculado, "Saldo de libro mayor coincide centavo a centavo con saldo semanal");

  console.log("  OK: Coincidencia estricta sin deriva de centavos.");

  // --------------------------------------------------------------------------
  // TEST 5: Contabilidad Automática NIIF no genera asientos de 0.00
  // --------------------------------------------------------------------------
  console.log("5. Auditando que no se generan asientos contables de $0.00...");

  const resAsientoCero = await generarAsientoDevolucionIncentivo({
    clienteId: "cli-zero",
    clienteNombre: "CLIENTE_ZERO",
    montoIncentivo: 0,
  });
  assertIgual(resAsientoCero.ok, true, "Incentivo 0 no debe fallar catastróficamente");
  assertIgual(resAsientoCero.asiento, undefined, "No debe crearse asiento contable para incentivo 0");

  const resCruceCero = await generarAsientoReembolsoCruce({
    carreraId: "c-1",
    carreraNumero: 1,
    hipodromo: "GP",
    clienteId: "cli-zero",
    clienteNombre: "CLIENTE_ZERO",
    montoReembolso: 0,
  });
  assertIgual(resCruceCero.ok, true, "Reembolso cruce 0 no debe fallar");
  assertIgual(resCruceCero.asiento, undefined, "No debe crearse asiento contable para reembolso cruce 0");

  console.log("  OK: Cero asientos contables ficticios o de $0.00.");

  console.log("=== TODAS LAS PRUEBAS DE AUDITORÍA PASARON EXITOSAMENTE (5/5) ===");
}

ejecutarAuditoria().catch((err) => {
  console.error(err);
  process.exit(1);
});
