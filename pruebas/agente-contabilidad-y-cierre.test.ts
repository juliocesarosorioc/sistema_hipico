/**
 * ============================================================================
 * SUITE AUTOMATIZADA: AGENTE IA COPILOTO — CONTABILIDAD PASO A PASO,
 * BLOQUEO ESTRICTO POST-CIERRE DE CARRERAS Y SALDOS EN CALIENTE
 * (`pruebas/agente-contabilidad-y-cierre.test.ts`)
 * ============================================================================
 */

import assert from "node:assert/strict";
import {
  crearSesionAgente,
  procesarTurnoAgente,
  actualizarEstadoCarreraAgente,
  MENSAJE_CARRERA_CERRADA,
  PREGUNTAS_PAGO_GANADOR,
  PREGUNTAS_COBRO_CLIENTE,
} from "../src/features/ia-copiloto/lib/agente-transaccional";
import {
  esCarreraCerradaOEnPartida,
  verificarEstadoCarreraParaJugada,
  marcarEstadoCarreraEnMemoria,
  limpiarEstadosCarreraEnMemoria,
} from "../src/features/portal/lib/bloqueo-jugadas";
import {
  crearMesa,
  fijarEstadoCarreraMesa,
  proponer,
  concretar,
  procesarMensajeMesa,
  disponibleDe,
  notificarSinSaldo,
  notificarAjusteDisponible,
} from "../src/features/portal/lib/propuestas-puestos";
import {
  aplicarIncrementoODescuentoEnCaliente,
  formatearAlertaSinSaldo,
  formatearAlertaAtentoDisponible,
} from "../src/features/saldos/lib/contabilidad-central";

let ok = 0;
let fallos = 0;

function verificar(nombre: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      ok += 1;
      console.log(`  ok   ${nombre}`);
    })
    .catch((err) => {
      fallos += 1;
      console.error(`  FALLO ${nombre}:`, err instanceof Error ? err.message : err);
    });
}

async function ejecutarSuite(): Promise<void> {
  console.log("\n=== SUITE: AGENTE CONTABILIDAD CONVERSACIONAL Y CIERRE DE CARRERAS ===");

  // ==========================================================================
  // 1. CONTROL DE ESTADO DE CARRERAS (BLOQUEO ESTRICTO POST-CIERRE)
  // ==========================================================================
  await verificar("1.1 Bloquea propuestas y jugadas cuando la carrera está en estatus 'CERRADA'", async () => {
    limpiarEstadosCarreraEnMemoria();
    let sesion = crearSesionAgente({
      saldosIniciales: { Pedro: 1000, Juan: 1000 },
      hipodromo: "LA RINCONADA",
      carrera: 3,
      estadoCarrera: "CERRADA",
    });

    const rPropuesta = await procesarTurnoAgente(sesion, {
      jugador: "Pedro",
      texto: "Consigo 1p de 2y5 con 300",
    });
    assert.equal(rPropuesta.ok, false);
    assert.equal(rPropuesta.bloqueado, true);
    assert.equal(rPropuesta.tipoAccion, "BLOQUEO_CARRERA_CERRADA");
    assert.equal(
      rPropuesta.mensaje,
      "⛔ Esta carrera ya se encuentra cerrada. No se permiten más jugadas ni propuestas."
    );
    assert.equal(rPropuesta.mensaje, MENSAJE_CARRERA_CERRADA);
    assert.equal(disponibleDe(rPropuesta.estado.mesa, "Pedro"), 1000);
    assert.equal(rPropuesta.estado.mesa.propuestas.length, 0);
  });

  await verificar("1.2 Bloquea aceptaciones P2P ('J', 'Ponte') cuando la carrera pasa a 'CERRADA' o 'LIQUIDADA'", async () => {
    limpiarEstadosCarreraEnMemoria();
    let sesion = crearSesionAgente({
      saldosIniciales: { Pedro: 1000, Juan: 1000 },
      hipodromo: "LA RINCONADA",
      carrera: 4,
      estadoCarrera: "ABIERTA",
    });

    // Con carrera abierta, Pedro publica propuesta
    const pasoAbierta = await procesarTurnoAgente(sesion, {
      jugador: "Pedro",
      texto: "consigo 1p 2-5 300",
    });
    assert.equal(pasoAbierta.ok, true);
    sesion = pasoAbierta.estado;
    assert.equal(disponibleDe(sesion.mesa, "Pedro"), 700);

    // La carrera cierra antes de que Juan acepte
    sesion = actualizarEstadoCarreraAgente(sesion, "CERRADA");

    const intentoP2P = await procesarTurnoAgente(sesion, {
      jugador: "Juan",
      texto: "J",
    });
    assert.equal(intentoP2P.ok, false);
    assert.equal(intentoP2P.bloqueado, true);
    assert.equal(
      intentoP2P.mensaje,
      "⛔ Esta carrera ya se encuentra cerrada. No se permiten más jugadas ni propuestas."
    );
    assert.equal(disponibleDe(intentoP2P.estado.mesa, "Juan"), 1000);
    assert.equal(intentoP2P.estado.mesa.concreciones.length, 0);

    // También en estado LIQUIDADA
    sesion = actualizarEstadoCarreraAgente(sesion, "LIQUIDADA");
    const intentoLiquidada = await procesarTurnoAgente(sesion, {
      jugador: "Juan",
      texto: "Ponte 200",
    });
    assert.equal(intentoLiquidada.ok, false);
    assert.equal(intentoLiquidada.bloqueado, true);
    assert.equal(intentoLiquidada.mensaje, MENSAJE_CARRERA_CERRADA);
  });

  await verificar("1.3 Bloquea jugadas automáticamente cuando ya se dio la partida según la hora (hora_partida <= ahora)", async () => {
    limpiarEstadosCarreraEnMemoria();
    const sesion = crearSesionAgente({
      saldosIniciales: { Pedro: 800 },
      hipodromo: "GULFSTREAM",
      carrera: 5,
      fecha: "2026-10-29",
      estadoCarrera: "ABIERTA",
      horaPartida: "2026-10-29T15:00:00Z",
    });

    // Si ahora es 15:05 UTC (5 minutos después de la partida), debe rechazar
    const resPostPartida = await procesarTurnoAgente(sesion, {
      jugador: "Pedro",
      texto: "juego 1p del 4 con 200",
      ahora: Date.parse("2026-10-29T15:05:00Z"),
    });
    assert.equal(resPostPartida.ok, false);
    assert.equal(resPostPartida.bloqueado, true);
    assert.equal(resPostPartida.mensaje, MENSAJE_CARRERA_CERRADA);

    // Verificación directa en propuestas-puestos.ts y bloqueo-jugadas.ts
    assert.equal(
      esCarreraCerradaOEnPartida({
        estado: "ABIERTA",
        horaPartida: "14:00",
        fecha: "2026-10-29",
        ahora: new Date(2026, 9, 29, 14, 30, 0),
      }),
      true
    );

    let mesa = crearMesa({ Pedro: 500 });
    mesa = fijarEstadoCarreraMesa(mesa, "CERRADA");
    const rProponerMesa = proponer(mesa, {
      autor: "Pedro",
      rol: "DA",
      jugada: "1P",
      caballos: "5",
      monto: 100,
    });
    assert.equal(rProponerMesa.ok, false);
    assert.equal(rProponerMesa.bloqueado, true);
    assert.deepEqual(rProponerMesa.mensajes, [MENSAJE_CARRERA_CERRADA]);

    const rConcretarMesa = concretar(mesa, { jugador: "Pedro" });
    assert.equal(rConcretarMesa.ok, false);
    assert.equal(rConcretarMesa.bloqueado, true);
    assert.deepEqual(rConcretarMesa.mensajes, [MENSAJE_CARRERA_CERRADA]);

    const rMsgMesa = procesarMensajeMesa(mesa, {
      jugador: "Pedro",
      texto: "consigo 1p 2y5 100",
    });
    assert.equal(rMsgMesa.ok, false);
    assert.equal(rMsgMesa.bloqueado, true);
    assert.deepEqual(rMsgMesa.mensajes, [MENSAJE_CARRERA_CERRADA]);

    // Verificación de memoria centralizada en bloqueo-jugadas.ts
    marcarEstadoCarreraEnMemoria({
      hipodromo: "LA RINCONADA",
      carrera: 6,
      estado: "CERRADA",
    });
    const verifMem = await verificarEstadoCarreraParaJugada({
      hipodromo: "LA RINCONADA",
      carrera: 6,
    });
    assert.equal(verifMem.permitida, false);
    assert.equal(verifMem.cerrada, true);
    assert.equal(verifMem.mensaje, MENSAJE_CARRERA_CERRADA);
  });

  // ==========================================================================
  // 2. GESTIÓN INTEGRAL DE CONTABILIDAD: CASO "LE PAGUÉ A PEDRO" PASO A PASO
  // ==========================================================================
  await verificar("2.1 Flujo conversacional 'Le pagué a Pedro' solicita monto, método, referencia/comprobante, pide confirmación y genera Partida Doble", async () => {
    limpiarEstadosCarreraEnMemoria();
    let sesion = crearSesionAgente({
      saldosIniciales: { Pedro: 500, Juan: 400 },
      hipodromo: "LA RINCONADA",
      carrera: 1,
    });

    // Turno 1: "Le pagué a Pedro" (ya tiene cliente = Pedro, falta monto)
    const t1 = await procesarTurnoAgente(sesion, {
      operador: "Admin",
      texto: "Le pagué a Pedro",
    });
    sesion = t1.estado;
    assert.equal(t1.tipoAccion, "PREGUNTA_CONTABLE_PASO");
    assert.equal(t1.mensaje, PREGUNTAS_PAGO_GANADOR.monto);
    assert.equal(t1.mensaje, "¿Cuál es el monto pagado?");

    // Turno 2: Operador responde el monto -> pregunta el método
    const t2 = await procesarTurnoAgente(sesion, {
      operador: "Admin",
      texto: "500",
    });
    sesion = t2.estado;
    assert.equal(t2.tipoAccion, "PREGUNTA_CONTABLE_PASO");
    assert.equal(t2.mensaje, PREGUNTAS_PAGO_GANADOR.metodo);
    assert.equal(t2.mensaje, "¿Por qué método (Pago Móvil, Zelle, Transferencia)?");

    // Turno 3: Operador responde el método -> pregunta referencia y comprobante
    const t3 = await procesarTurnoAgente(sesion, {
      operador: "Admin",
      texto: "Pago Móvil",
    });
    sesion = t3.estado;
    assert.equal(t3.tipoAccion, "PREGUNTA_CONTABLE_PASO");
    assert.equal(t3.mensaje, PREGUNTAS_PAGO_GANADOR.referenciaYComprobante);
    assert.equal(
      t3.mensaje,
      "¿Cuál es la referencia bancaria y el comprobante (captura/imagen)?"
    );

    // Turno 4: Operador suministra referencia y comprobante -> pide Confirmación Obligatoria
    const refUnica = `PM-${Date.now()}`;
    const t4 = await procesarTurnoAgente(sesion, {
      operador: "Admin",
      texto: `Ref ${refUnica} comprobante captura_pago_pedro.png`,
    });
    sesion = t4.estado;
    assert.equal(t4.tipoAccion, "SOLICITUD_CONFIRMACION_CONTABLE");
    assert.ok(
      t4.mensaje.includes("¿Confirmas que deseas registrar este pago por 500 para Pedro? (Sí / No)")
    );
    assert.ok(
      t4.mensaje.includes(
        "¿Confirmas que deseas registrar este cobro/pago por 500 para Pedro? (Sí / No)"
      )
    );
    // Antes de confirmar, NO debe haberse descontado el saldo ni creado asiento
    assert.equal(disponibleDe(sesion.mesa, "Pedro"), 500);
    assert.equal(sesion.asientosRegistrados.length, 0);

    // Turno 5: Operador confirma con "Sí" -> Registra egreso en Partida Doble y descuenta saldo
    const t5 = await procesarTurnoAgente(sesion, {
      operador: "Admin",
      texto: "Sí",
    });
    sesion = t5.estado;
    assert.equal(t5.ok, true);
    assert.equal(t5.tipoAccion, "REGISTRO_CONTABLE_COMPLETADO");
    assert.ok(t5.asiento, "Debe generar el asiento de Partida Doble");
    assert.equal(t5.asiento?.total_debe, 500);
    assert.equal(t5.asiento?.total_haber, 500);
    assert.equal(t5.asiento?.lineas[0].cuenta_codigo, "2.1.01.001"); // Disminución Saldo Acreedor
    assert.equal(t5.asiento?.lineas[0].debe, 500);
    assert.equal(t5.asiento?.lineas[1].cuenta_codigo, "1.1.02.001"); // Banco Emisor
    assert.equal(t5.asiento?.lineas[1].haber, 500);

    // Saldo de Pedro descontado de 500 a 0 y notificación automática de sin saldo
    assert.equal(disponibleDe(sesion.mesa, "Pedro"), 0);
    assert.equal(t5.nuevoSaldoCliente, 0);
    assert.ok(t5.notificacionesSaldo.includes("⛔ Pedro sin saldo disponible."));
    assert.ok(t5.mensaje.includes("⛔ Pedro sin saldo disponible."));
  });

  await verificar("2.2 Flujo 'Le pagué' (sin cliente inicial) pregunta primero '¿A cuál cliente (Pedro)?' y recorre los 4 pasos", async () => {
    let sesion = crearSesionAgente({
      saldosIniciales: { Pedro: 800 },
    });

    const p1 = await procesarTurnoAgente(sesion, { texto: "Le pagué" });
    sesion = p1.estado;
    assert.equal(p1.mensaje, "¿A cuál cliente (Pedro)?");

    const p2 = await procesarTurnoAgente(sesion, { texto: "Pedro" });
    sesion = p2.estado;
    assert.equal(p2.mensaje, "¿Cuál es el monto pagado?");

    const p3 = await procesarTurnoAgente(sesion, { texto: "300" });
    sesion = p3.estado;
    assert.equal(p3.mensaje, "¿Por qué método (Pago Móvil, Zelle, Transferencia)?");

    const p4 = await procesarTurnoAgente(sesion, { texto: "Zelle" });
    sesion = p4.estado;
    assert.equal(
      p4.mensaje,
      "¿Cuál es la referencia bancaria y el comprobante (captura/imagen)?"
    );

    const refZelle = `ZL-${Date.now()}`;
    const p5 = await procesarTurnoAgente(sesion, {
      texto: `Ref ${refZelle} zelle_capture.jpg`,
    });
    sesion = p5.estado;
    assert.equal(p5.tipoAccion, "SOLICITUD_CONFIRMACION_CONTABLE");

    const p6 = await procesarTurnoAgente(sesion, { texto: "Sí" });
    sesion = p6.estado;
    assert.equal(p6.tipoAccion, "REGISTRO_CONTABLE_COMPLETADO");
    assert.equal(disponibleDe(sesion.mesa, "Pedro"), 500);
    assert.equal(p6.asiento?.total_debe, 300);
    assert.equal(p6.asiento?.total_haber, 300);
    assert.equal(p6.asiento?.lineas[1].cuenta_codigo, "1.1.02.003"); // Zelle / Internacional
  });

  // ==========================================================================
  // 3. GESTIÓN INTEGRAL DE CONTABILIDAD: CASO "LE COBRÉ A PEDRO" / "PEDRO DEPOSITÓ"
  // ==========================================================================
  await verificar("3.1 Flujo conversacional 'Le cobré a Pedro' / 'Pedro depositó' recolecta los 4 pasos, pide confirmación y acredita en Partida Doble", async () => {
    let sesion = crearSesionAgente({
      saldosIniciales: { Pedro: 0 },
    });

    // Turno 1: Sin cliente -> "¿Quién es el cliente (Pedro)?"
    const c1 = await procesarTurnoAgente(sesion, { texto: "Le cobré" });
    sesion = c1.estado;
    assert.equal(c1.mensaje, PREGUNTAS_COBRO_CLIENTE.cliente);
    assert.equal(c1.mensaje, "¿Quién es el cliente (Pedro)?");

    // Turno 2: "Pedro" -> "¿Cuál es el monto recibido?"
    const c2 = await procesarTurnoAgente(sesion, { texto: "Pedro" });
    sesion = c2.estado;
    assert.equal(c2.mensaje, PREGUNTAS_COBRO_CLIENTE.monto);
    assert.equal(c2.mensaje, "¿Cuál es el monto recibido?");

    // Turno 3: "450" -> "¿Por qué método y número de referencia?"
    const c3 = await procesarTurnoAgente(sesion, { texto: "450" });
    sesion = c3.estado;
    assert.equal(c3.mensaje, PREGUNTAS_COBRO_CLIENTE.metodoYReferencia);
    assert.equal(c3.mensaje, "¿Por qué método y número de referencia?");

    // Turno 4: "Transferencia ref 99112233" -> "¿Adjunto de comprobante?"
    const refCobro = `TR-${Date.now()}`;
    const c4 = await procesarTurnoAgente(sesion, {
      texto: `Transferencia ref ${refCobro}`,
    });
    sesion = c4.estado;
    assert.equal(c4.mensaje, PREGUNTAS_COBRO_CLIENTE.comprobante);
    assert.equal(c4.mensaje, "¿Adjunto de comprobante?");

    // Turno 5: Adjunta comprobante -> Resumen y Confirmación Obligatoria
    const c5 = await procesarTurnoAgente(sesion, {
      texto: "comprobante_deposito_pedro.png",
    });
    sesion = c5.estado;
    assert.equal(c5.tipoAccion, "SOLICITUD_CONFIRMACION_CONTABLE");
    assert.ok(
      c5.mensaje.includes("¿Confirmas que deseas registrar este cobro por 450 para Pedro? (Sí / No)")
    );
    assert.ok(
      c5.mensaje.includes(
        "¿Confirmas que deseas registrar este cobro/pago por 450 para Pedro? (Sí / No)"
      )
    );
    assert.equal(disponibleDe(sesion.mesa, "Pedro"), 0);

    // Turno 6: Confirmación "Sí" -> Ingreso en Partida Doble y saldo acreditado a 450
    const c6 = await procesarTurnoAgente(sesion, { texto: "Sí" });
    sesion = c6.estado;
    assert.equal(c6.ok, true);
    assert.equal(c6.tipoAccion, "REGISTRO_CONTABLE_COMPLETADO");
    assert.equal(disponibleDe(sesion.mesa, "Pedro"), 450);
    assert.equal(c6.asiento?.total_debe, 450);
    assert.equal(c6.asiento?.total_haber, 450);
    assert.equal(c6.asiento?.lineas[0].cuenta_codigo, "1.1.02.001"); // Debe Banco
    assert.equal(c6.asiento?.lineas[0].debe, 450);
    assert.equal(c6.asiento?.lineas[1].cuenta_codigo, "2.1.01.001"); // Haber Saldo Cliente
    assert.equal(c6.asiento?.lineas[1].haber, 450);
  });

  await verificar("3.2 Cancelación ('No') en la confirmación obligatoria aborta el registro y preserva intacto el saldo", async () => {
    let sesion = crearSesionAgente({
      saldosIniciales: { Pedro: 250 },
    });

    const d1 = await procesarTurnoAgente(sesion, {
      texto: `Pedro depositó 300 por Pago Móvil ref CAN-${Date.now()} comprobante capture.png`,
    });
    sesion = d1.estado;
    assert.equal(d1.tipoAccion, "SOLICITUD_CONFIRMACION_CONTABLE");

    const d2 = await procesarTurnoAgente(sesion, { texto: "No" });
    sesion = d2.estado;
    assert.equal(d2.ok, false);
    assert.equal(d2.tipoAccion, "OPERACION_CONTABLE_CANCELADA");
    assert.equal(disponibleDe(sesion.mesa, "Pedro"), 250);
    assert.equal(sesion.asientosRegistrados.length, 0);
  });

  // ==========================================================================
  // 4. INCREMENTOS Y DESCUENTOS DE SALDO EN CALIENTE CON NOTIFICACIÓN
  // ==========================================================================
  await verificar("4.1 Notificaciones exactas al ajustar propuesta por límite de saldo y al quedar sin fondos", async () => {
    assert.equal(notificarSinSaldo("Pedro"), "⛔ Pedro sin saldo disponible.");
    assert.equal(notificarAjusteDisponible("Pedro", 500), "⚠️ Atento 'Pedro', disponible 500.");
    assert.equal(formatearAlertaSinSaldo("Pedro"), "⛔ Pedro sin saldo disponible.");
    assert.equal(formatearAlertaAtentoDisponible("Pedro", 500), "⚠️ Atento 'Pedro', disponible 500.");

    let sesion = crearSesionAgente({
      saldosIniciales: { Pedro: 500 },
      estadoCarrera: "ABIERTA",
    });

    // Pedro tiene 500 y propone 800 -> recorta a 500 y avisa "⚠️ Atento 'Pedro', disponible 500."
    // y al consumir sus 500 queda en 0 -> avisa "⛔ Pedro sin saldo disponible."
    const rAjuste = await procesarTurnoAgente(sesion, {
      jugador: "Pedro",
      texto: "Consigo 1p de 2y5 con 800",
    });
    sesion = rAjuste.estado;
    assert.equal(rAjuste.ok, true);
    assert.equal(rAjuste.propuesta?.montoOriginal, 500);
    assert.equal(disponibleDe(sesion.mesa, "Pedro"), 0);
    assert.ok(rAjuste.notificacionesSaldo.includes("⚠️ Atento 'Pedro', disponible 500."));
    assert.ok(rAjuste.notificacionesSaldo.includes("⛔ Pedro sin saldo disponible."));

    // Si Pedro intenta volver a proponer estando en 0 -> bloqueado con "⛔ Pedro sin saldo disponible."
    const rSinFondos = await procesarTurnoAgente(sesion, {
      jugador: "Pedro",
      texto: "Juego 2p del 3 con 100",
    });
    assert.equal(rSinFondos.ok, false);
    assert.equal(rSinFondos.bloqueado, true);
    assert.equal(rSinFondos.mensaje, "⛔ Pedro sin saldo disponible.");

    // Verificación del helper central en contabilidad-central.ts
    const mov = aplicarIncrementoODescuentoEnCaliente({
      saldos: { Pedro: 500 },
      cliente: "Pedro",
      monto: 700,
      tipo: "AJUSTE_PROPUESTA",
    });
    assert.equal(mov.montoEfectivo, 500);
    assert.equal(mov.nuevoSaldo, 0);
    assert.ok(mov.notificaciones.includes("⚠️ Atento 'Pedro', disponible 500."));
    assert.ok(mov.notificaciones.includes("⛔ Pedro sin saldo disponible."));
  });

  console.log(`\nResultado final: ${ok} ok / ${fallos} fallaron\n`);
  if (fallos > 0) {
    process.exit(1);
  }
}

ejecutarSuite();
