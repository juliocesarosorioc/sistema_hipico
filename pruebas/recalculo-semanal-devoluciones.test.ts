import test from "node:test";
import assert from "node:assert/strict";
import {
  obtenerRangoSemanaFiscalActual,
  recalcularDevolucionesEIncentivosSemana,
} from "../src/features/clientes/lib/recalculo-semanal";
import {
  calcularReporteDestinatariosDevolucion,
  calcularComisionesSocioPorClientes,
} from "../src/features/clientes/lib/comisiones-socios";

test("Rango fiscal semanal hípico calcula ciclo Jueves a Miércoles", () => {
  // Sábado 7 de Noviembre de 2026:
  // Apertura: Jueves 5 de Noviembre de 2026
  // Cierre: Miércoles 11 de Noviembre de 2026
  const rango = obtenerRangoSemanaFiscalActual("2026-11-07");
  assert.equal(rango.desde, "2026-11-05");
  assert.equal(rango.hasta, "2026-11-11");
});

test("Dinamismo en destinatarios: incluye clientes nuevos con devolucion > 0", () => {
  const clientesMock = [
    {
      id: "cli-101",
      nombre: "JUGADOR_NUEVO_VIP",
      devolucion: 2.5,
      saldo_actual: 500,
    },
    {
      id: "cli-102",
      nombre: "CLIENTE_COMUN",
      devolucion: 0,
      saldo_actual: 100,
    },
  ];

  const ticketsMock = [
    {
      id: "t-1",
      cliente_juega_nombre: "JUGADOR_NUEVO_VIP",
      nombre_jugada: "PUESTOS 1P",
      fecha_carrera: "2026-11-06",
      monto_jugado: 1000,
      estado: "GANADOR",
      anulada: false,
    },
  ];

  const rep = calcularReporteDestinatariosDevolucion({
    fechaDesde: "2026-11-05",
    fechaHasta: "2026-11-11",
    tickets: ticketsMock,
    clientes: clientesMock,
  });

  const itemNuevo = rep.items.find((i) => i.socio === "JUGADOR_NUEVO_VIP");
  assert.ok(itemNuevo, "El nuevo cliente con devolución debe estar presente en el reporte");
  assert.equal(itemNuevo.devolucionPropiaPct, 2.5);
  assert.equal(itemNuevo.totalDevolucionPropia, 25.0); // 2.5% de 1000
});

test("Recálculo semanal calcula delta exacto e idempotencia estricta", async () => {
  const clientesMock = [
    {
      id: "cli-201",
      nombre: "JUGADOR_DELTA",
      devolucion: 1.5, // Se le subió de 1% a 1.5%
      saldo_actual: 200,
    },
  ];

  const ticketsMock = [
    {
      id: "t-201",
      cliente_juega_id: "cli-201",
      cliente_juega_nombre: "JUGADOR_DELTA",
      nombre_jugada: "PUESTOS",
      fecha_carrera: "2026-11-06",
      monto_jugado: 2000,
      estado: "GANADOR",
      anulada: false,
    },
  ];

  // Supongamos que previamente en la semana se le había acreditado $20 (1.0% de 2000)
  const asientosPreviosMock = [
    {
      id: "as-1",
      clave: "INC:2026-11-06:GULF:C1:cli-201",
      fecha: "2026-11-06",
      concepto: "Devolución incentivo JUGADOR_DELTA",
      total_debe: 20.0,
      total_haber: 20.0,
    },
  ];

  // 1. Simulación (dryRun = true):
  // Debido actual con 1.5%: $30.00
  // Previo acreditado: $20.00
  // Delta esperado: +$10.00
  const sim = await recalcularDevolucionesEIncentivosSemana({
    fechaDesde: "2026-11-05",
    fechaHasta: "2026-11-11",
    dryRun: true,
    clientesMock,
    ticketsMock,
    asientosMock: asientosPreviosMock,
  });

  assert.equal(sim.ok, true);
  assert.equal(sim.totalClientesEvaluados, 1);
  assert.equal(sim.totalClientesAjustados, 1);
  assert.equal(sim.granTotalDebido, 30.0);
  assert.equal(sim.granTotalYaAcreditado, 20.0);
  assert.equal(sim.granTotalDelta, 10.0);

  const det = sim.detalles[0];
  assert.equal(det.nombre, "JUGADOR_DELTA");
  assert.equal(det.delta, 10.0);
  assert.equal(det.saldoAnterior, 200.0);
  assert.equal(det.saldoNuevo, 210.0);

  // 2. Idempotencia: Si ya se acreditó el total debido ($30.00), el delta debe ser $0.00
  const asientosCompletosMock = [
    ...asientosPreviosMock,
    {
      id: "as-2",
      clave: "RECALCULO:SEMANA:2026-11-05:2026-11-11:cli-201",
      fecha: "2026-11-11",
      concepto: "Ajuste recálculo semanal JUGADOR_DELTA",
      total_debe: 10.0,
      total_haber: 10.0,
    },
  ];

  const segundaCorrida = await recalcularDevolucionesEIncentivosSemana({
    fechaDesde: "2026-11-05",
    fechaHasta: "2026-11-11",
    dryRun: true,
    clientesMock,
    ticketsMock,
    asientosMock: asientosCompletosMock,
  });

  assert.equal(segundaCorrida.granTotalDebido, 30.0);
  assert.equal(segundaCorrida.granTotalYaAcreditado, 30.0);
  assert.equal(segundaCorrida.granTotalDelta, 0.0);
  assert.equal(segundaCorrida.totalClientesAjustados, 0);
  assert.equal(segundaCorrida.detalles[0].delta, 0.0);
  assert.equal(segundaCorrida.detalles[0].saldoNuevo, 200.0);
});

test("Comisión de socio por afiliados se recalcula correctamente", async () => {
  const clientesMock = [
    {
      id: "soc-1",
      nombre: "SOCIO_JEFE",
      es_socio: true,
      devolucion: 0,
      saldo_actual: 1000,
    },
    {
      id: "af-1",
      nombre: "AFILIADO_A",
      socio_asignado: "soc-1",
      comision_socio_pct: 1.25,
      fecha_inicio_comision_socio: "2026-11-01",
      saldo_actual: 50,
    },
  ];

  const ticketsMock = [
    {
      id: "t-af-1",
      cliente_juega_id: "af-1",
      cliente_juega_nombre: "AFILIADO_A",
      nombre_jugada: "PUESTOS",
      fecha_carrera: "2026-11-06",
      monto_jugado: 4000,
      estado: "GANADOR",
      anulada: false,
    },
  ];

  const resSocio = await recalcularDevolucionesEIncentivosSemana({
    fechaDesde: "2026-11-05",
    fechaHasta: "2026-11-11",
    dryRun: true,
    clientesMock,
    ticketsMock,
    asientosMock: [],
  });

  const detSocio = resSocio.detalles.find((d) => d.nombre === "SOCIO_JEFE");
  assert.ok(detSocio, "Debe existir el detalle para SOCIO_JEFE");
  // 1.25% de 4000 = $50.00
  assert.equal(detSocio.totalComisionesSocios, 50.0);
  assert.equal(detSocio.totalDebido, 50.0);
  assert.equal(detSocio.delta, 50.0);
  assert.equal(detSocio.saldoNuevo, 1050.0);
});
