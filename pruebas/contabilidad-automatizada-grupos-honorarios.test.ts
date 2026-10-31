/**
 * PRUEBAS: Contabilidad Automatizada NIIF, Partida Doble, Aislamiento por Grupos,
 * Tratamiento de Clientes Avalados, Imputación Argentina y Honorarios de Equipo.
 */

import {
  generarAsientoLiquidacionCarrera,
  generarAsientoImputacionArgentina,
  generarAsientoHonorariosEquipo,
  calcularSaldosPlanCuentas,
  calcularEstadoResultadosSemana,
  obtenerAsientosMemoria,
  PLAN_CUENTAS_HIPICO,
  obtenerCuentaPorCodigo,
} from "../src/features/contabilidad/lib/plan-cuentas";

import {
  guardarMiembroEquipo,
  listarMiembrosEquipo,
  registrarPagoHonorario,
} from "../src/features/contabilidad/lib/honorarios-equipo";

import {
  encolarTareaContable,
  procesarColaContableSegundoPlano,
  obtenerEstadoColaContable,
} from "../src/features/contabilidad/lib/contabilidad-automatica";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("Fallo: " + msg);
}

function assertIgual(act: unknown, esp: unknown, msg: string) {
  if (act !== esp) {
    throw new Error(`${msg} -> esperado: ${JSON.stringify(esp)}, obtenido: ${JSON.stringify(act)}`);
  }
}

console.log("=== INICIO PRUEBAS CONTABILIDAD AUTOMATIZADA Y NIIF ===");

// 1. Verificación del Plan de Cuentas NIIF actualizado
console.log("1. Verificando subcuentas analíticas en el Plan de Cuentas...");
const ctaAvalPagar = obtenerCuentaPorCodigo("2.1.01.003");
assert(Boolean(ctaAvalPagar), "Cuenta 2.1.01.003 debe existir");
assertIgual(ctaAvalPagar?.nombre, "Cuentas por Pagar — Premios Clientes Ganadores Avalados", "Nombre 2.1.01.003 correcto");

const ctaHonorariosPagar = obtenerCuentaPorCodigo("2.1.06.001");
assert(Boolean(ctaHonorariosPagar), "Cuenta 2.1.06.001 debe existir");

const ctaVentaArgentina = obtenerCuentaPorCodigo("4.3.01.002");
assert(Boolean(ctaVentaArgentina), "Cuenta 4.3.01.002 Venta Argentina debe existir");

const ctaComisionTablas = obtenerCuentaPorCodigo("4.1.01.002");
assert(Boolean(ctaComisionTablas), "Cuenta 4.1.01.002 Comisión Tablas Fijas debe existir");

const ctaComisionMarcas = obtenerCuentaPorCodigo("4.1.01.003");
assert(Boolean(ctaComisionMarcas), "Cuenta 4.1.01.003 Comisión Marcas debe existir");

console.log("  OK: Catálogo de cuentas NIIF verificado.");

// 2. Liquidación de Carrera: Tratamiento Estricto de Avalados (Cuentas por Pagar vs Cuentas por Cobrar)
console.log("2. Liquidación con clientes avalados vs clientes regulares...");
async function testLiquidacionAvalados() {
  const resLiq = await generarAsientoLiquidacionCarrera({
    grupoId: "grupo-test-1",
    fecha: "2026-10-31",
    carreraId: "GP-C1",
    carreraNumero: 1,
    hipodromo: "GULFSTREAM",
    perdedores: [
      // Cliente AVALADO que pierde $100 -> Debe ir a Cuentas por Cobrar Aval (1.2.02.001)
      { clienteId: "cli-aval-1", clienteNombre: "JUAN AVAL", montoPerdido: 100, esAvalado: true },
      // Cliente REGULAR que pierde $50 -> Debe ir a Fondos en Custodia (2.1.01.001)
      { clienteId: "cli-reg-1", clienteNombre: "PEDRO REGULAR", montoPerdido: 50, esAvalado: false },
    ],
    ganadores: [
      // Cliente AVALADO que gana $80 -> Debe ir a Cuentas por Pagar Premios Avalados (2.1.01.003)
      { clienteId: "cli-aval-2", clienteNombre: "MARIA AVAL", montoGanadoNeto: 80, esAvalado: true },
      // Cliente REGULAR que gana $50 -> Debe ir a Fondos en Custodia (2.1.01.001)
      { clienteId: "cli-reg-2", clienteNombre: "LORENA REGULAR", montoGanadoNeto: 50, esAvalado: false },
    ],
    // Comisión de la casa = 150 - 130 = 20
    totalComisionCasa: 20,
    comisionesPorModalidad: {
      entreTercios: 10,
      tablasFijas: 10,
    },
    usuario: "CONTADOR_TEST",
  });

  assert(Boolean(resLiq.ok), "Asiento de liquidación debe ser exitoso");
  const asiento = resLiq.asiento!;

  assertIgual(asiento.total_debe, 150, "Total Debe debe ser $150.00");
  assertIgual(asiento.total_haber, 150, "Total Haber debe ser $150.00");

  // Verificar imputación de perdedor avalado
  const lineaPerdAval = asiento.lineas.find((l) => l.cliente_nombre === "JUAN AVAL");
  assert(Boolean(lineaPerdAval), "Línea de Juan Aval debe existir");
  assertIgual(lineaPerdAval?.cuenta_codigo, "1.2.02.001", "Perdedor avalado va a 1.2.02.001 (Cuentas por Cobrar)");
  assertIgual(lineaPerdAval?.debe, 100, "Debe ser $100");

  // Verificar imputación de perdedor regular
  const lineaPerdReg = asiento.lineas.find((l) => l.cliente_nombre === "PEDRO REGULAR");
  assertIgual(lineaPerdReg?.cuenta_codigo, "2.1.01.001", "Perdedor regular va a 2.1.01.001 (Custodia)");

  // Verificar imputación de ganador avalado
  const lineaGanAval = asiento.lineas.find((l) => l.cliente_nombre === "MARIA AVAL");
  assert(Boolean(lineaGanAval), "Línea de Maria Aval debe existir");
  assertIgual(lineaGanAval?.cuenta_codigo, "2.1.01.003", "Ganador avalado va a 2.1.01.003 (Cuentas por Pagar)");
  assertIgual(lineaGanAval?.haber, 80, "Haber ser $80");

  // Verificar desglose de comisiones
  const comTercios = asiento.lineas.find((l) => l.cuenta_codigo === "4.1.01.001");
  assertIgual(comTercios?.haber, 10, "Comisión entre tercios debe ser $10.00");

  const comTablas = asiento.lineas.find((l) => l.cuenta_codigo === "4.1.01.002");
  assertIgual(comTablas?.haber, 10, "Comisión tablas fijas debe ser $10.00");

  console.log("  OK: Reglas de avalados y desglose de comisiones superadas con éxito.");
}

// 3. Imputación Inter-Grupos para Argentina (Sin ganador vs Con ganador)
console.log("3. Imputación Inter-Grupos para Argentina...");
async function testImputacionArgentina() {
  // Caso A: Sin Ganador (Argentina retiene $300 de venta de otro grupo)
  const resArgSinGanador = await generarAsientoImputacionArgentina({
    grupoIdArgentina: "grupo-argentina-uuid",
    grupoOrigenId: "grupo-venezuela-uuid",
    grupoOrigenNombre: "Grupo Caracas",
    modalidad: "TABLAS_FIJAS",
    referenciaId: "TF-101",
    montoCobrado: 300,
    premioPagar: 0,
    huboGanador: false,
    fecha: "2026-10-31",
  });

  assert(Boolean(resArgSinGanador.ok), "Asiento Argentina sin ganador debe registrarse");
  const asArg1 = resArgSinGanador.asiento!;
  assertIgual(asArg1.total_debe, 300, "Debe ser $300");
  assertIgual(asArg1.total_haber, 300, "Haber ser $300");

  const lineaCobro = asArg1.lineas.find((l) => l.cuenta_codigo === "1.2.03.001");
  assertIgual(lineaCobro?.debe, 300, "Cuentas por cobrar a grupo origen = $300");

  const lineaIngresoArg = asArg1.lineas.find((l) => l.cuenta_codigo === "4.3.01.002");
  assertIgual(lineaIngresoArg?.haber, 300, "Ingreso para Argentina = $300");

  // Caso B: Con Ganador (Premio $500, Venta $400 -> Pérdida neta de $100 para Argentina)
  const resArgConGanador = await generarAsientoImputacionArgentina({
    grupoIdArgentina: "grupo-argentina-uuid",
    grupoOrigenId: "grupo-venezuela-uuid",
    grupoOrigenNombre: "Grupo Caracas",
    modalidad: "MARCAS",
    referenciaId: "MC-202",
    montoCobrado: 400,
    premioPagar: 500,
    huboGanador: true,
    fecha: "2026-10-31",
  });

  assert(Boolean(resArgConGanador.ok), "Asiento Argentina con ganador debe registrarse");
  const asArg2 = resArgConGanador.asiento!;
  assertIgual(asArg2.total_debe, 900, "Total Debe $500 + $400 = $900");
  assertIgual(asArg2.total_haber, 900, "Total Haber $500 + $400 = $900");

  console.log("  OK: Imputación de Argentina superada correctamente.");
}

// 4. Honorarios del Equipo de Trabajo
console.log("4. Honorarios del Equipo de Trabajo...");
async function testHonorariosEquipo() {
  // Guardar colaborador
  const resMiembro = await guardarMiembroEquipo({
    nombre_completo: "ROBERTO GUERRA",
    cedula_rif: "V-19882314",
    cargo_rol: "Operador de Taquilla Nocturna",
    monto_pactado: 140,
    frecuencia_pago: "SEMANAL",
    metodo_pago: "Pago Móvil",
    datos_pago: "0102-04141234567-V19882314",
  });

  assert(Boolean(resMiembro.ok), "Colaborador debe guardarse");
  const m = resMiembro.miembro!;
  assertIgual(m.nombre_completo, "ROBERTO GUERRA", "Nombre guardado en mayúsculas");

  // Pago inmediato desembolsado por Banco
  const resPago = await registrarPagoHonorario({
    grupoId: "grupo-test-1",
    miembroId: m.id,
    miembroNombre: m.nombre_completo,
    monto: 140,
    concepto: "Semana activa guardia de carreras nocturnas",
    estado: "PAGADO",
    medioPago: "Pago Móvil",
    cuentaPagoCodigo: "1.1.02.002",
  });

  assert(Boolean(resPago.ok), "Pago de honorarios debe ser exitoso");
  assertIgual(resPago.registro?.estado, "PAGADO", "Estado PAGADO registrado");

  // Causación por pagar
  const resPorPagar = await registrarPagoHonorario({
    grupoId: "grupo-test-1",
    miembroId: m.id,
    miembroNombre: m.nombre_completo,
    monto: 70,
    concepto: "Guardia extra sábado",
    estado: "POR_PAGAR",
  });

  assert(Boolean(resPorPagar.ok), "Causación por pagar exitosa");
  assertIgual(resPorPagar.registro?.estado, "POR_PAGAR", "Estado POR_PAGAR registrado");

  console.log("  OK: Registro y causación de honorarios probados.");
}

// 5. Cola de Contabilidad Asíncrona en Segundo Plano
console.log("5. Cola contable en segundo plano...");
async function testColaAsincrona() {
  const idTarea = encolarTareaContable("LIQUIDACION_CARRERA", {
    carreraNumero: 3,
    hipodromo: "TAMPA",
    perdedores: [{ clienteNombre: "CLIENTE ASINC", montoPerdido: 50, esAvalado: true }],
    ganadores: [{ clienteNombre: "GANADOR ASINC", montoGanadoNeto: 40, esAvalado: true }],
    totalComisionCasa: 10,
  });

  assert(Boolean(idTarea), "Tarea debe encolarse con ID");
  const estadoAntes = obtenerEstadoColaContable();
  assert(estadoAntes.total > 0, "Cola debe tener elementos");

  // Procesar cola
  await procesarColaContableSegundoPlano();

  const estadoDespues = obtenerEstadoColaContable();
  assert(estadoDespues.completados > 0, "Al menos una tarea completada");

  console.log("  OK: Cola asíncrona procesada con éxito.");
}

// 6. Aislamiento por Grupo
console.log("6. Aislamiento por Grupo...");
async function testAislamientoGrupo() {
  // Asiento para Grupo 1
  await generarAsientoHonorariosEquipo({
    grupoId: "GRUPO-A",
    miembroId: "m1",
    miembroNombre: "Colaborador Grupo A",
    monto: 100,
    concepto: "Honorarios A",
    estado: "PAGADO",
  });

  // Asiento para Grupo 2
  await generarAsientoHonorariosEquipo({
    grupoId: "GRUPO-B",
    miembroId: "m2",
    miembroNombre: "Colaborador Grupo B",
    monto: 250,
    concepto: "Honorarios B",
    estado: "PAGADO",
  });

  const asientosGrupoA = obtenerAsientosMemoria("GRUPO-A");
  assert(asientosGrupoA.every((a) => !a.grupo_id || a.grupo_id === "GRUPO-A"), "Grupo A solo contiene sus asientos");

  const estResultadosA = calcularEstadoResultadosSemana(asientosGrupoA, "GRUPO-A");
  assert(estResultadosA.gastos.honorariosEquipo >= 100, "Gastos de honorarios de Grupo A reflejados");

  console.log("  OK: Aislamiento contable por grupo verificado.");
}

async function correrSuite() {
  await testLiquidacionAvalados();
  await testImputacionArgentina();
  await testHonorariosEquipo();
  await testColaAsincrona();
  await testAislamientoGrupo();
  console.log("=== TODAS LAS PRUEBAS DE CONTABILIDAD AUTOMATIZADA Y NIIF PASARON EXITOSAMENTE ===");
}

void correrSuite();
