/**
 * Suite de Verificación Contable NIIF: Plan Único de Cuentas (PUC) y Partida Doble Automática
 */

import assert from "node:assert/strict";
import {
  PLAN_CUENTAS_HIPICO,
  MAPA_CUENTAS_HIPICO,
  generarAsientoPartidaDoble,
  generarAsientoDepositoCliente,
  generarAsientoRetiroCliente,
  generarAsientoTrasladoClientes,
  generarAsientoAval,
  generarAsientoLiquidacionCarrera,
  generarAsientoReembolsoCruce,
  generarAsientoDevolucionIncentivo,
  generarContraAsientoSimetrico,
  calcularSaldosPlanCuentas,
  calcularEstadoResultadosSemana,
  type AsientoContableRegistrado,
} from "../src/features/contabilidad/lib/plan-cuentas";
import { aCentavos, deCentavos, formatearMontoSinMoneda } from "../src/shared/lib/dinero";

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
console.log("SUITE: PLAN ÚNICO DE CUENTAS (PUC-NIIF) Y MOTOR DE PARTIDA DOBLE HÍPICO");
console.log("================================================================================\n");

async function runTests() {
  // ==============================================================================
  // TEST 1: CATÁLOGO OFICIAL PUC Y REGLAS ESTRUCTURALES NIIF
  // ==============================================================================
  try {
    // 1.1 Verificar existencia y unicidad de códigos
    assert.ok(PLAN_CUENTAS_HIPICO.length >= 25, "El catálogo debe contener al menos 25 cuentas básicas");
    const codigos = new Set<string>();
    for (const c of PLAN_CUENTAS_HIPICO) {
      assert.ok(!codigos.has(c.codigo), `Código duplicado encontrado: ${c.codigo}`);
      codigos.add(c.codigo);
    }
    ok("1.1 Catálogo PUC sin duplicados de código");

    // 1.2 Verificar cuentas clave operativas
    const cuentasClave = [
      { codigo: "1.1.02.001", clase: "ACTIVO", nat: "DEUDORA" },
      { codigo: "1.2.01.001", clase: "ACTIVO", nat: "DEUDORA" },
      { codigo: "1.2.02.001", clase: "ACTIVO", nat: "DEUDORA" },
      { codigo: "2.1.01.001", clase: "PASIVO", nat: "ACREEDORA" },
      { codigo: "3.1.01.001", clase: "PATRIMONIO", nat: "ACREEDORA" },
      { codigo: "4.1.01.001", clase: "INGRESO", nat: "ACREEDORA" },
      { codigo: "5.1.01.001", clase: "COSTO_CONTRA_INGRESO", nat: "DEUDORA" },
      { codigo: "5.1.02.001", clase: "COSTO_CONTRA_INGRESO", nat: "DEUDORA" },
      { codigo: "5.1.03.001", clase: "COSTO_CONTRA_INGRESO", nat: "DEUDORA" },
      { codigo: "6.1.01.001", clase: "GASTO", nat: "DEUDORA" },
      { codigo: "7.1.01.001", clase: "ORDEN", nat: "DEUDORA" },
      { codigo: "7.1.01.002", clase: "ORDEN", nat: "ACREEDORA" },
    ];

    for (const exp of cuentasClave) {
      const c = MAPA_CUENTAS_HIPICO.get(exp.codigo);
      assert.ok(c, `Cuenta clave ${exp.codigo} no existe en MAPA_CUENTAS_HIPICO`);
      assert.equal(c.clase, exp.clase, `Clase incorrecta para ${exp.codigo}`);
      assert.equal(c.naturaleza, exp.nat, `Naturaleza incorrecta para ${exp.codigo}`);
    }
    ok("1.2 Todas las cuentas maestras clave verificadas en clase y naturaleza");

    // 1.3 Validación estricta de coherencia Clase vs Naturaleza
    for (const c of PLAN_CUENTAS_HIPICO) {
      if (c.clase === "ACTIVO" || c.clase === "GASTO" || c.clase === "COSTO_CONTRA_INGRESO") {
        assert.equal(c.naturaleza, "DEUDORA", `Cuenta ${c.codigo} (${c.clase}) debe ser DEUDORA`);
      } else if (c.clase === "PASIVO" || c.clase === "PATRIMONIO" || c.clase === "INGRESO") {
        assert.equal(c.naturaleza, "ACREEDORA", `Cuenta ${c.codigo} (${c.clase}) debe ser ACREEDORA`);
      }
    }
    ok("1.3 Coherencia estricta Clase vs Naturaleza NIIF (Activos/Costos/Gastos=Deudora, Pasivos/Patrimonio/Ingresos=Acreedora)");
  } catch (e: any) {
    mal("1. Catálogo PUC", e.message);
  }

  // ==============================================================================
  // TEST 2: SIMULACIÓN DE LIQUIDACIÓN DE CARRERA (COMISIÓN 5%, CRUCES E INCENTIVOS)
  // ==============================================================================
  try {
    // Escenario:
    // - Cliente A gana 100 bruto con 5% de comisión (95 netos)
    // - Cliente B pierde 100
    // - Comisión de la casa = 5
    // - Reembolso por cruces (5.1.01.001) = 2.50
    // - Devolución de incentivo (5.1.02.001) = 2.00 a favor del cliente
    const resLiq = await generarAsientoLiquidacionCarrera({
      carreraId: "carr-001",
      carreraNumero: 3,
      hipodromo: "La Rinconada",
      ganadores: [
        { clienteId: "cli-A", clienteNombre: "Pedro Ganador", montoGanadoNeto: 95 },
      ],
      perdedores: [
        { clienteId: "cli-B", clienteNombre: "Juan Perdedor", montoPerdido: 100 },
      ],
      totalComisionCasa: 5,
    });

    assert.ok(resLiq.ok && resLiq.asiento, "Liquidación debe registrarse exitosamente");
    const asientoLiq = resLiq.asiento!;
    assert.equal(asientoLiq.total_debe, 100, "Debe liquidación debe ser exactamente 100");
    assert.equal(asientoLiq.total_haber, 100, "Haber liquidación debe ser exactamente 100");
    assert.equal(aCentavos(asientoLiq.total_debe), aCentavos(asientoLiq.total_haber), "Centavos deben estar estrictamente cuadrados");
    ok("2.1 Asiento de liquidación de carrera genera Debe === Haber exacto en centavos (100.00)");

    // Asiento de reembolso por cruce (5.1.01.001 a 2.1.01.001)
    const resCruce = await generarAsientoReembolsoCruce({
      carreraId: "carr-001",
      carreraNumero: 3,
      hipodromo: "La Rinconada",
      clienteId: "cli-A",
      clienteNombre: "Pedro Ganador",
      montoReembolso: 2.5,
    });
    assert.ok(resCruce.ok && resCruce.asiento, "Reembolso cruce debe registrarse");
    const asientoCruce = resCruce.asiento!;
    assert.equal(asientoCruce.total_debe, 2.5, "Debe cruce debe ser 2.50");
    assert.equal(asientoCruce.total_haber, 2.5, "Haber cruce debe ser 2.50");
    assert.equal(aCentavos(asientoCruce.total_debe), aCentavos(asientoCruce.total_haber));
    ok("2.2 Asiento de reembolso por cruces (5.1.01.001) perfectamente cuadrado en centavos (2.50)");

    // Asiento de devolución de incentivos (5.1.02.001 a favor de cliente 2.1.01.001)
    const resIncentivo = await generarAsientoDevolucionIncentivo({
      referenciaId: "inc-001",
      clienteId: "cli-A",
      clienteNombre: "Pedro Ganador",
      montoIncentivo: 2.0,
      esAvalador: false,
    });
    assert.ok(resIncentivo.ok && resIncentivo.asiento, "Incentivo debe registrarse");
    const asientoIncentivo = resIncentivo.asiento!;
    assert.equal(asientoIncentivo.total_debe, 2.0, "Debe incentivo debe ser 2.00");
    assert.equal(asientoIncentivo.total_haber, 2.0, "Haber incentivo debe ser 2.00");
    assert.equal(aCentavos(asientoIncentivo.total_debe), aCentavos(asientoIncentivo.total_haber));
    ok("2.3 Asiento de devolución de incentivos (5.1.02.001) a favor del cliente cuadrado en centavos (2.00)");

    // Verificar el saldo acumulado del cliente A en las cuentas de clientes (2.1.01.001):
    // Líneas del cliente A en Haber (abonos a su favor en custodia de jugadores):
    // Liquidación: +95 (Haber)
    // Cruce: +2.50 (Haber)
    // Incentivo: +2.00 (Haber)
    // Total a favor = 99.50
    const lineasCliA = [
      ...asientoLiq.lineas.filter((l) => l.cliente_id === "cli-A"),
      ...asientoCruce.lineas.filter((l) => l.cliente_id === "cli-A"),
      ...asientoIncentivo.lineas.filter((l) => l.cliente_id === "cli-A"),
    ];

    let haberTotalA = 0;
    let debeTotalA = 0;
    for (const l of lineasCliA) {
      haberTotalA += aCentavos(l.haber);
      debeTotalA += aCentavos(l.debe);
    }
    const saldoFinalCliA = deCentavos(haberTotalA - debeTotalA);
    assert.equal(saldoFinalCliA, 99.5, "El saldo contable del cliente A debe ser exactamente +99.50 a favor");
    ok("2.4 Saldo del cliente A (+99.50) coincide exactamente con ganancia neta + cruces + incentivos");
  } catch (e: any) {
    mal("2. Liquidación, Cruces e Incentivos", e.message);
  }

  // ==============================================================================
  // TEST 3: REVERSIÓN Y ANULACIÓN SIMÉTRICA (IMPACTO NETO CERO)
  // ==============================================================================
  try {
    const resOrig = await generarAsientoLiquidacionCarrera({
      carreraId: "carr-002",
      carreraNumero: 4,
      hipodromo: "Gulfstream Park",
      ganadores: [
        { clienteId: "cli-X", clienteNombre: "Cliente X", montoGanadoNeto: 190 },
      ],
      perdedores: [
        { clienteId: "cli-Y", clienteNombre: "Cliente Y", montoPerdido: 200 },
      ],
      totalComisionCasa: 10,
    });
    const asientoOriginal = resOrig.asiento!;

    const resContra = await generarContraAsientoSimetrico(asientoOriginal, "Anulación por reclamo ratificado de carrera 4");
    assert.ok(resContra.ok && resContra.asiento);
    const contraAsiento = resContra.asiento!;

    assert.equal(contraAsiento.tipo_evento, "REVERSION_LIQUIDACION");
    assert.equal(contraAsiento.total_debe, asientoOriginal.total_haber, "El contra-asiento debe tener Debe igual al Haber original");
    assert.equal(contraAsiento.total_haber, asientoOriginal.total_debe, "El contra-asiento debe tener Haber igual al Debe original");
    assert.equal(aCentavos(contraAsiento.total_debe), aCentavos(contraAsiento.total_haber));

    // Simular la acumulación de ambos asientos en el balance general
    const asientosTest: AsientoContableRegistrado[] = [asientoOriginal, contraAsiento];

    const saldosCuentas = calcularSaldosPlanCuentas(asientosTest);
    for (const [_codigo, reg] of saldosCuentas.entries()) {
      assert.equal(reg.saldo, 0, `La cuenta ${_codigo} debe tener saldo neto 0 tras anulación simétrica`);
    }
    ok("3.1 Contra-asiento simétrico anula 100% de los impactos contables dejando todas las cuentas en 0.00");
  } catch (e: any) {
    mal("3. Reversión / Anulación simétrica", e.message);
  }

  // ==============================================================================
  // TEST 4: DEPÓSITOS, RETIROS, TRASLADOS Y AVALES
  // ==============================================================================
  try {
    // Depósito de 500
    const resDep = await generarAsientoDepositoCliente({
      referencia: "dep-101",
      clienteId: "cli-1",
      clienteNombre: "Carlos Gómez",
      monto: 500,
      bancoCodigo: "1.1.02.001",
    });
    assert.ok(resDep.ok && resDep.asiento);
    const asDep = resDep.asiento!;
    assert.equal(asDep.total_debe, 500);
    assert.equal(asDep.total_haber, 500);
    assert.equal(asDep.lineas[0].cuenta_codigo, "1.1.02.001");
    assert.equal(asDep.lineas[0].debe, 500);
    assert.equal(asDep.lineas[1].cuenta_codigo, "2.1.01.001");
    assert.equal(asDep.lineas[1].haber, 500);
    ok("4.1 Asiento de depósito debita Banco (1.1.02.001) y acredita Cliente (2.1.01.001) por 500.00");

    // Retiro de 300
    const resRet = await generarAsientoRetiroCliente({
      referencia: "ret-102",
      clienteId: "cli-1",
      clienteNombre: "Carlos Gómez",
      monto: 300,
      bancoCodigo: "1.1.02.001",
    });
    assert.ok(resRet.ok && resRet.asiento);
    const asRet = resRet.asiento!;
    assert.equal(asRet.total_debe, 300);
    assert.equal(asRet.total_haber, 300);
    assert.equal(asRet.lineas[0].cuenta_codigo, "2.1.01.001");
    assert.equal(asRet.lineas[0].debe, 300);
    assert.equal(asRet.lineas[1].cuenta_codigo, "1.1.02.001");
    assert.equal(asRet.lineas[1].haber, 300);
    ok("4.2 Asiento de retiro debita Cliente (2.1.01.001) y acredita Banco (1.1.02.001) por 300.00");

    // Traslado de 150 entre clientes
    const resTras = await generarAsientoTrasladoClientes({
      referencia: "tras-103",
      origenId: "cli-1",
      origenNombre: "Carlos Gómez",
      destinoId: "cli-2",
      destinoNombre: "María López",
      monto: 150,
    });
    assert.ok(resTras.ok && resTras.asiento);
    const asTras = resTras.asiento!;
    assert.equal(asTras.total_debe, 150);
    assert.equal(asTras.total_haber, 150);
    assert.equal(asTras.lineas[0].cliente_id, "cli-1");
    assert.equal(asTras.lineas[0].debe, 150);
    assert.equal(asTras.lineas[1].cliente_id, "cli-2");
    assert.equal(asTras.lineas[1].haber, 150);
    ok("4.3 Traslado entre clientes debita origen y acredita destino manteniendo partida doble (150.00)");

    // Aval otorgado de 1000
    const resAval = await generarAsientoAval({
      clienteId: "cli-3",
      clienteNombre: "Avalado Andrés",
      monto: 1000,
      tipo: "OTORGAR",
    });
    assert.ok(resAval.ok && resAval.asiento);
    const asAval = resAval.asiento!;
    assert.equal(asAval.total_debe, 1000);
    assert.equal(asAval.total_haber, 1000);
    assert.equal(asAval.lineas[0].cuenta_codigo, "1.2.02.001");
    assert.equal(asAval.lineas[1].cuenta_codigo, "3.1.02.001");
    ok("4.4 Otorgamiento de Aval carga Cartera de Avales (1.2.02.001) y acredita Fondo de Respaldo (3.1.02.001)");
  } catch (e: any) {
    mal("4. Depósitos, Retiros, Traslados y Avales", e.message);
  }

  // ==============================================================================
  // TEST 5: ESTADO DE RESULTADOS CASCADA Y PARTIDA DOBLE RECHAZA DESCUADRES
  // ==============================================================================
  try {
    // Rechazo de asiento descuadrado
    const resDescuadrado = await generarAsientoPartidaDoble({
      tipo_evento: "AJUSTE_AUDITORIA",
      referencia_id: "test-err",
      descripcion: "Asiento intencionalmente descuadrado",
      lineas: [
        { cuenta_codigo: "1.1.02.001", debe: 100, haber: 0, concepto: "Debe" },
        { cuenta_codigo: "2.1.01.001", debe: 0, haber: 99, concepto: "Haber descuadrado" },
      ],
    });
    assert.equal(resDescuadrado.ok, false, "El motor debe rechazar cualquier asiento donde Debe !== Haber");
    assert.ok(resDescuadrado.error?.includes("Descuadre de partida doble"), "Debe devolver mensaje de descuadre");
    ok("5.1 Motor contable rechaza estrictamente cualquier intento de insertar asiento descuadrado");

    // Estado de Resultados cascada
    const asientosSemana: AsientoContableRegistrado[] = [
      {
        id: "a-com",
        numero_asiento: 10,
        fecha_contable: "2026-10-28",
        tipo_evento: "LIQUIDACION_APUESTAS",
        referencia_id: "c-10",
        descripcion: "Comisión Apuestas",
        total_debe: 1000,
        total_haber: 1000,
        estado: "PUBLICADO",
        creado_el: "2026-10-28T12:00:00Z",
        lineas: [
          { cuenta_codigo: "2.1.01.001", debe: 1000, haber: 0, concepto: "Cobra comision perdedores" },
          { cuenta_codigo: "4.1.01.001", debe: 0, haber: 1000, concepto: "Ingreso comisiones" },
        ],
      },
      {
        id: "a-cruce",
        numero_asiento: 11,
        fecha_contable: "2026-10-28",
        tipo_evento: "REEMBOLSO_CRUCE",
        referencia_id: "cr-10",
        descripcion: "Reembolso cruce",
        total_debe: 200,
        total_haber: 200,
        estado: "PUBLICADO",
        creado_el: "2026-10-28T12:05:00Z",
        lineas: [
          { cuenta_codigo: "5.1.01.001", debe: 200, haber: 0, concepto: "Reembolso cruces" },
          { cuenta_codigo: "2.1.01.001", debe: 0, haber: 200, concepto: "Abono cliente cruce" },
        ],
      },
      {
        id: "a-inc",
        numero_asiento: 12,
        fecha_contable: "2026-10-28",
        tipo_evento: "DEVOLUCION_INCENTIVO",
        referencia_id: "in-10",
        descripcion: "Devolución incentivo",
        total_debe: 100,
        total_haber: 100,
        estado: "PUBLICADO",
        creado_el: "2026-10-28T12:10:00Z",
        lineas: [
          { cuenta_codigo: "5.1.02.001", debe: 100, haber: 0, concepto: "Incentivo a cliente" },
          { cuenta_codigo: "2.1.01.001", debe: 0, haber: 100, concepto: "Abono cliente incentivo" },
        ],
      },
      {
        id: "a-gasto",
        numero_asiento: 13,
        fecha_contable: "2026-10-28",
        tipo_evento: "GASTO_OPERATIVO",
        referencia_id: "g-10",
        descripcion: "Comisión bancaria",
        total_debe: 50,
        total_haber: 50,
        estado: "PUBLICADO",
        creado_el: "2026-10-28T12:15:00Z",
        lineas: [
          { cuenta_codigo: "6.1.01.001", debe: 50, haber: 0, concepto: "Gasto bancario" },
          { cuenta_codigo: "1.1.02.001", debe: 0, haber: 50, concepto: "Salida banco" },
        ],
      },
    ];

    const er = calcularEstadoResultadosSemana(asientosSemana);
    assert.equal(er.ingresos.totalIngresosBrutos, 1000, "Ingresos brutos deben ser 1000");
    assert.equal(er.rebajasEIncentivos.reembolsosCruces, 200, "Reembolso cruces debe ser 200");
    assert.equal(er.rebajasEIncentivos.incentivosClientes, 100, "Devolución incentivos debe ser 100");
    assert.equal(er.rebajasEIncentivos.totalRebajasEIncentivos, 300, "Total deducciones debe ser 300 (200 + 100)");
    assert.equal(er.ingresoNetoOperacional, 700, "Ingreso neto operacional debe ser 700 (1000 - 300)");
    assert.equal(er.gastos.totalGastos, 50, "Gastos operativos deben ser 50");
    assert.equal(er.utilidadNeta, 650, "Utilidad neta debe ser 650 (700 - 50)");
    ok("5.2 Cascada de Estado de Resultados calcula con exactitud matemática: Bruto (1000) - Cruces (200) - Incentivos (100) = Neto Operacional (700) - Gastos (50) = Utilidad (650)");
  } catch (e: any) {
    mal("5. Estado de Resultados y Control de Descuadres", e.message);
  }

  // ==============================================================================
  // TEST 6: PROHIBICIÓN ESTRICTA DE SÍMBOLOS MONETARIOS EN FORMATEO
  // ==============================================================================
  try {
    const montos = [1234.56, 0, -450.75, 1000000];
    const prohibidos = ["$", "Bs", "USD", "VES", "EUR"];

    for (const m of montos) {
      const fmt = formatearMontoSinMoneda(m);
      for (const p of prohibidos) {
        assert.ok(!fmt.includes(p), `El formateo de ${m} ('${fmt}') no debe incluir el símbolo '${p}'`);
      }
    }
    ok("6.1 Formato de montos cumple con la regla de cero símbolos monetarios ($, Bs, USD, VES)");
  } catch (e: any) {
    mal("6. Formato sin monedas", e.message);
  }

  console.log(`\n${pasan} pasan, ${fallan} fallan.`);
  if (fallan > 0) process.exit(1);
}

void runTests();
