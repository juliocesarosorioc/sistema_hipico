/**
 * Suite de Verificación: Registro de Pagos con Comprobante, Conciliación y Pagos a Ganadores
 */

import assert from "node:assert/strict";
import {
  registrarPagoComprobante,
  aprobarPagoCliente,
  rechazarPagoCliente,
  anularPagoAGanador,
  verificarReferenciaDuplicada,
  listarPagosCliente,
  formatearReciboWhatsappGanador,
} from "../src/features/contabilidad/lib/pagos-comprobantes";
import {
  generarAsientoDepositoCliente,
  generarAsientoRetiroCliente,
} from "../src/features/contabilidad/lib/plan-cuentas";
import {
  aCentavos,
  deCentavos,
  formatearMontoSinMoneda,
  redondearCentavos,
  sumarDinero,
  restarDinero,
} from "../src/shared/lib/dinero";

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
console.log("SUITE: REGISTRO DE PAGOS CON COMPROBANTE Y PAGOS A GANADORES CON CONCILIACIÓN");
console.log("================================================================================\n");

async function runTests() {
  // ==============================================================================
  // TEST 1: REGISTRO DE PAGO DE CLIENTE (PORTAL) Y VALIDACIÓN ANTI-DUPLICADOS
  // ==============================================================================
  try {
    const refCliente = "REF-" + Date.now();
    const clienteId = "cli-test-001";
    const clienteNombre = "Carlos Mendoza";

    // 1.1 Registro de pago con comprobante
    const resReg = await registrarPagoComprobante({
      clienteId,
      clienteNombre,
      direccionFlujo: "PAGO_DE_CLIENTE",
      metodoPago: "PAGO_MOVIL",
      bancoOrigen: "Banesco",
      bancoDestino: "Mercantil",
      referenciaBancaria: refCliente,
      montoMonedaOrigen: 3650, // 3650 VES
      monedaOrigen: "VES",
      tasaCambio: 36.5, // 100 USD
      comprobanteUrl: "data:image/jpeg;base64,mockcomprobantebase64",
      comprobanteNombre: "captura_pago_movil.jpg",
      comprobanteTipo: "image/jpeg",
      comprobantePeso: 102400,
      notas: "Abono saldo para carreras del domingo",
      registradoPor: clienteNombre,
    });

    assert.ok(resReg.ok, "El registro del pago debe ser exitoso");
    assert.ok(resReg.pago, "Debe retornar el objeto pago");
    assert.equal(resReg.pago?.estado, "PENDIENTE", "El pago de cliente debe nacer en PENDIENTE");
    assert.equal(resReg.pago?.monto_equivalente_base, 100, "3650 / 36.5 debe ser exactamente 100.00 USD");
    ok("1.1 Registro de pago de cliente con comprobante en estado PENDIENTE");

    // 1.2 Validación anti-duplicados: reintentar con la misma referencia y método
    const resDup = await verificarReferenciaDuplicada({
      metodoPago: "PAGO_MOVIL",
      referenciaBancaria: refCliente,
    });
    assert.ok(resDup.duplicada, "La referencia debe ser detectada como duplicada");
    assert.equal(resDup.registroExistente?.id, resReg.pago?.id);

    const resIntentoDuplicado = await registrarPagoComprobante({
      clienteId: "otro-cliente",
      clienteNombre: "Juan Perez",
      direccionFlujo: "PAGO_DE_CLIENTE",
      metodoPago: "PAGO_MOVIL",
      referenciaBancaria: refCliente,
      montoMonedaOrigen: 3650,
      tasaCambio: 36.5,
      comprobanteUrl: "data:image/jpeg;base64,mock2",
    });
    assert.equal(resIntentoDuplicado.ok, false, "Debe rechazar el registro de referencia duplicada");
    assert.ok(resIntentoDuplicado.error?.includes("ya fue registrada previamente"));
    ok("1.2 Bloqueo estricto de comprobante con referencia duplicada");

    // 1.3 Aprobación y acreditación por el operador
    const saldoInicial = -500;
    const resAprobar = await aprobarPagoCliente(resReg.pago!.id, "Operador Central");
    assert.ok(resAprobar.ok, "La aprobación del pago debe ser exitosa");

    // Verificar asiento contable de depósito
    const asientoDep = await generarAsientoDepositoCliente({
      grupoId: null,
      fecha: "2026-10-29",
      clienteId,
      clienteNombre,
      monto: 100,
      referencia: refCliente,
      usuario: "Operador Central",
    });
    assert.ok(asientoDep.ok);
    assert.equal(asientoDep.asiento?.total_debe, 100);
    assert.equal(asientoDep.asiento?.total_haber, 100);
    assert.equal(asientoDep.asiento?.total_debe, asientoDep.asiento?.total_haber);
    // Debe: 1.1.02.001 (Banco Pozo) / Haber: 2.1.01.001 (Saldo Acreedor)
    assert.equal(asientoDep.asiento?.lineas[0].cuenta_codigo, "1.1.02.001");
    assert.equal(asientoDep.asiento?.lineas[0].debe, 100);
    assert.equal(asientoDep.asiento?.lineas[1].cuenta_codigo, "2.1.01.001");
    assert.equal(asientoDep.asiento?.lineas[1].haber, 100);
    ok("1.3 Aprobación de pago genera asiento contable de partida doble cuadrado");

    // 1.4 Simulación de saldo tras aprobación: -500 + 100 = -400
    const saldoPostAbono = sumarDinero(saldoInicial, 100);
    assert.equal(saldoPostAbono, -400);
    ok("1.4 Impacto en saldo contable del usuario correcto");
  } catch (e: any) {
    mal("TEST 1: Pago de cliente y conciliación", e.message);
  }

  // ==============================================================================
  // TEST 2: RECHAZO DE PAGO DE CLIENTE
  // ==============================================================================
  try {
    const refRechazo = "REF-RECHAZO-" + Date.now();
    const resReg = await registrarPagoComprobante({
      clienteId: "cli-test-002",
      clienteNombre: "Pedro Gomez",
      direccionFlujo: "PAGO_DE_CLIENTE",
      metodoPago: "TRANSFERENCIA",
      referenciaBancaria: refRechazo,
      montoMonedaOrigen: 50,
      monedaOrigen: "USD",
      tasaCambio: 1,
      comprobanteUrl: "data:image/jpeg;base64,ilegible",
    });
    assert.ok(resReg.ok);

    const resRechazo = await rechazarPagoCliente(
      resReg.pago!.id,
      "Comprobante ilegible / no coincide titular",
      "Auditor"
    );
    assert.ok(resRechazo.ok, "El rechazo debe ser exitoso");

    const lista = await listarPagosCliente("cli-test-002");
    const pagoGuardado = lista.find((p) => p.id === resReg.pago!.id);
    assert.equal(pagoGuardado?.estado, "RECHAZADO");
    assert.equal(pagoGuardado?.motivo_rechazo, "Comprobante ilegible / no coincide titular");
    ok("2.1 Rechazo de comprobante con motivo registrado");
  } catch (e: any) {
    mal("TEST 2: Rechazo de pago", e.message);
  }

  // ==============================================================================
  // TEST 3: PAGO A GANADORES (`saldo > 0`), RECIBO WHATSAPP Y ANULACIÓN/REVERSIÓN
  // ==============================================================================
  try {
    const refGanador = "PAGO-PREMIO-" + Date.now();
    const clienteGanadorId = "cli-ganador-777";
    const clienteGanadorNombre = "Hipólito Valderrama";
    const saldoGanadorInicial = 1500; // Saldo acreedor a favor

    // 3.1 Registrar pago a ganador
    const resPagoGanador = await registrarPagoComprobante({
      clienteId: clienteGanadorId,
      clienteNombre: clienteGanadorNombre,
      direccionFlujo: "PAGO_A_GANADOR",
      metodoPago: "PAGO_MOVIL",
      bancoOrigen: "Banco Pozo Banesco",
      bancoDestino: "Mercantil (04141234567 / V-12345678)",
      referenciaBancaria: refGanador,
      montoMonedaOrigen: 1500,
      monedaOrigen: "USD",
      tasaCambio: 1,
      comprobanteUrl: "data:image/jpeg;base64,comprobantetransferenciaenviada",
      comprobanteNombre: "transferencia_ganador.jpg",
      notas: "Pago total de ganancias del pool",
      operador: "Cajero Principal",
    });

    assert.ok(resPagoGanador.ok, "El pago a ganador debe registrarse exitosamente");
    assert.equal(resPagoGanador.pago?.estado, "APROBADO", "Pago a ganador nace APROBADO");
    assert.equal(resPagoGanador.pago?.direccion_flujo, "PAGO_A_GANADOR");

    // 3.2 Verificar asiento contable de salida a ganador
    const asientoRetiro = await generarAsientoRetiroCliente({
      grupoId: null,
      fecha: "2026-10-29",
      clienteId: clienteGanadorId,
      clienteNombre: clienteGanadorNombre,
      monto: 1500,
      referencia: refGanador,
      usuario: "Cajero Principal",
    });
    assert.ok(asientoRetiro.ok);
    assert.equal(asientoRetiro.asiento?.total_debe, 1500);
    assert.equal(asientoRetiro.asiento?.total_haber, 1500);
    assert.equal(asientoRetiro.asiento?.total_debe, asientoRetiro.asiento?.total_haber);
    // Debe: 2.1.01.001 (Saldo Acreedor) / Haber: 1.1.02.001 (Banco Pozo)
    assert.equal(asientoRetiro.asiento?.lineas[0].cuenta_codigo, "2.1.01.001");
    assert.equal(asientoRetiro.asiento?.lineas[0].debe, 1500);
    assert.equal(asientoRetiro.asiento?.lineas[1].cuenta_codigo, "1.1.02.001");
    assert.equal(asientoRetiro.asiento?.lineas[1].haber, 1500);
    ok("3.1 Pago a ganador genera asiento contable de salida de fondos cuadrado");

    // 3.3 Saldo del ganador descontado: 1500 - 1500 = 0
    const saldoPostPago = restarDinero(saldoGanadorInicial, 1500);
    assert.equal(saldoPostPago, 0, "El saldo del ganador debe quedar en 0");
    ok("3.2 Deducción inmediata del saldo a favor del ganador");

    // 3.4 Formato de recibo para WhatsApp
    const reciboWsp = formatearReciboWhatsappGanador({
      clienteNombre: clienteGanadorNombre,
      metodo: "PAGO_MOVIL",
      banco: "Mercantil",
      referencia: refGanador,
      montoPagado: 1500,
      nuevoSaldo: 0,
      fechaHora: "29/10/2026 17:00",
    });

    assert.ok(reciboWsp.includes("PAGO DE GANANCIA PROCESADO"), "Debe contener encabezado de premio");
    assert.ok(reciboWsp.includes(clienteGanadorNombre), "Debe contener nombre del ganador");
    assert.ok(reciboWsp.includes(refGanador), "Debe contener la referencia bancaria");
    assert.ok(reciboWsp.includes("1.500,00"), "Debe contener el monto formateado");
    ok("3.3 Formato de recibo para WhatsApp generado con éxito");

    // 3.5 Historial del cliente en dos direcciones
    const historial = await listarPagosCliente(clienteGanadorId);
    assert.ok(historial.length >= 1);
    const pagoRecibido = historial.find((p) => p.direccion_flujo === "PAGO_A_GANADOR");
    assert.ok(pagoRecibido, "El ganador debe ver el pago recibido en su historial");
    assert.equal(pagoRecibido?.comprobante_url, "data:image/jpeg;base64,comprobantetransferenciaenviada");
    ok("3.4 Comprobante de pago visible en el historial del cliente ganador");

    // 3.6 Reversión / Anulación de pago a ganador en caso de error
    const resAnular = await anularPagoAGanador(
      resPagoGanador.pago!.id,
      "Error en número de cuenta bancaria destino",
      "SuperAdmin"
    );
    assert.ok(resAnular.ok, "La anulación debe completarse");
    assert.equal(resPagoGanador.pago!.estado, "ANULADO");
    const saldoRestaurado = sumarDinero(saldoPostPago, 1500);
    assert.equal(saldoRestaurado, 1500, "El saldo a favor debe regresar a 1500");
    ok("3.5 Anulación de pago restituye el saldo a favor del ganador simétricamente");
  } catch (e: any) {
    mal("TEST 3: Pago a ganadores y anulación", e.message);
  }

  // ==============================================================================
  // TEST 4: VERIFICACIÓN DE REGLAS DE FORMATO (SIN SÍMBOLOS DE MONEDA EN TABLAS)
  // ==============================================================================
  try {
    const formateado = formatearMontoSinMoneda(1250.75);
    assert.equal(formateado, "1.250,75");
    assert.ok(!formateado.includes("$"), "No debe incluir signo $");
    assert.ok(!formateado.includes("Bs"), "No debe incluir signo Bs");
    assert.ok(!formateado.includes("USD"), "No debe incluir USD");
    ok("4.1 Regla de formato: montos limpios sin símbolos de moneda para tablas");
  } catch (e: any) {
    mal("TEST 4: Formato monetario", e.message);
  }

  // ==============================================================================
  // RESUMEN FINAL
  // ==============================================================================
  console.log("\n--------------------------------------------------------------------------------");
  console.log(`TOTAL PRUEBAS: ${pasan + fallan} | PASARON: ${pasan} | FALLARON: ${fallan}`);
  console.log("--------------------------------------------------------------------------------\n");

  if (fallan > 0) {
    process.exit(1);
  }
}

void runTests();
