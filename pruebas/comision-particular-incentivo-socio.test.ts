import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calcularLiquidacionConIncentivosYSocios,
  type ConfigJugadorLiquidacion,
  type JugadaParaLiquidacion,
} from "../src/features/liquidacion/lib/liquidacion-incentivos-socios";

describe("FASE 1: Comisión Particular, Incentivo Carrera a Carrera y Comisión al Socio", () => {
  it("1. Cobra comision_particular_pct propia ignorando la del grupo cuando gana", () => {
    // Grupo cobra 5% por defecto, pero este jugador tiene 3% particular configurado
    const jugador: ConfigJugadorLiquidacion = {
      clienteId: "cli-101",
      clienteNombre: "CARLOS_PARTICULAR",
      comision_particular_pct: 3.0,
      incentivo_pct: 0,
      incentivo_base: "MONTO_DECIDIDO",
    };

    const jugada: JugadaParaLiquidacion = {
      referencia: "GP C1",
      montoJugado: 100,
      montoDecidido: 100,
      premioBruto: 300, // Ganancia bruta = 200
      estado: "GANADOR",
    };

    const res = calcularLiquidacionConIncentivosYSocios(jugada, jugador, null, 5.0);

    assert.equal(res.jugador1.comisionPctAplicada, 3.0, "Debe aplicar 3% particular y no el 5% del grupo");
    assert.equal(res.jugador1.gananciaBruta, 200.0, "Ganancia bruta = 300 - 100 = 200");
    assert.equal(res.jugador1.comisionCasa, 6.0, "3% sobre 200 = 6.00");
    assert.equal(res.jugador1.gananciaNeta, 194.0, "Ganancia neta = 200 - 6 = 194.00");
    assert.equal(res.jugador1.impactoSaldoTotal, 194.0, "Impacto en saldo debe ser +194.00");
  });

  it("2. Cobra 0% si comision_particular_pct está configurada en 0%", () => {
    const jugador: ConfigJugadorLiquidacion = {
      clienteId: "cli-vip",
      clienteNombre: "VIP_SIN_COMISION",
      comision_particular_pct: 0,
    };

    const jugada: JugadaParaLiquidacion = {
      referencia: "BEL C4",
      montoJugado: 500,
      montoDecidido: 500,
      premioBruto: 1000, // Ganancia bruta = 500
      estado: "GANADOR",
    };

    const res = calcularLiquidacionConIncentivosYSocios(jugada, jugador, null, 5.0);

    assert.equal(res.jugador1.comisionPctAplicada, 0);
    assert.equal(res.jugador1.comisionCasa, 0);
    assert.equal(res.jugador1.gananciaNeta, 500.0);
    assert.equal(res.jugador1.impactoSaldoTotal, 500.0);
  });

  it("3. Calcula incentivo sobre MONTO_DECIDIDO (gane o pierda) y suma al saldo", () => {
    const jugador: ConfigJugadorLiquidacion = {
      clienteId: "cli-inc-dec",
      clienteNombre: "PEDRO_DECIDIDO",
      incentivo_pct: 1.5,
      incentivo_base: "MONTO_DECIDIDO",
    };

    // Caso A: Jugador pierde 200
    const jugadaPerdida: JugadaParaLiquidacion = {
      referencia: "SAR C2",
      montoJugado: 200,
      montoDecidido: 200,
      estado: "PERDEDOR",
    };

    const resA = calcularLiquidacionConIncentivosYSocios(jugadaPerdida, jugador, null, 5.0);

    assert.equal(resA.jugador1.netoJugada, -200);
    assert.equal(resA.jugador1.incentivoDevolucion, 3.0, "1.5% sobre 200 decidido = 3.00");
    assert.equal(resA.jugador1.impactoSaldoTotal, -197.0, "-200 + 3.00 = -197.00");
    assert.equal(resA.jugador1.detalleIncentivo?.base, "MONTO_DECIDIDO");

    // Caso B: Jugador gana 200 bruto (190 neto con 5% comision)
    const jugadaGanada: JugadaParaLiquidacion = {
      referencia: "SAR C3",
      montoJugado: 100,
      montoDecidido: 100,
      premioBruto: 300, // Ganancia bruta = 200
      estado: "GANADOR",
    };

    const resB = calcularLiquidacionConIncentivosYSocios(jugadaGanada, jugador, null, 5.0);
    assert.equal(resB.jugador1.gananciaNeta, 190.0);
    assert.equal(resB.jugador1.incentivoDevolucion, 1.5, "1.5% sobre 100 decidido = 1.50");
    assert.equal(resB.jugador1.impactoSaldoTotal, 191.5, "190 + 1.5 = 191.50");
  });

  it("4. Calcula incentivo sobre PERDIDA y GANANCIA adecuadamente", () => {
    const jugadorPerdida: ConfigJugadorLiquidacion = {
      clienteId: "cli-inc-perd",
      clienteNombre: "JUAN_PERDIDA",
      incentivo_pct: 2.0,
      incentivo_base: "PERDIDA",
    };

    // Si pierde: recibe incentivo
    const resPerd = calcularLiquidacionConIncentivosYSocios(
      { montoJugado: 100, montoDecidido: 100, estado: "PERDEDOR" },
      jugadorPerdida,
      null,
      5.0
    );
    assert.equal(resPerd.jugador1.incentivoDevolucion, 2.0);

    // Si gana: base es 0 para PERDIDA
    const resGano = calcularLiquidacionConIncentivosYSocios(
      { montoJugado: 100, montoDecidido: 100, premioBruto: 200, estado: "GANADOR" },
      jugadorPerdida,
      null,
      5.0
    );
    assert.equal(resGano.jugador1.incentivoDevolucion, 0);

    // Jugador sobre GANANCIA
    const jugadorGanancia: ConfigJugadorLiquidacion = {
      clienteId: "cli-inc-gan",
      clienteNombre: "MARIA_GANANCIA",
      incentivo_pct: 2.0,
      incentivo_base: "GANANCIA",
    };

    const resGano2 = calcularLiquidacionConIncentivosYSocios(
      { montoJugado: 100, montoDecidido: 100, premioBruto: 300, estado: "GANADOR" },
      jugadorGanancia,
      null,
      5.0
    );
    assert.equal(resGano2.jugador1.incentivoDevolucion, 4.0, "2% sobre ganancia bruta 200 = 4.00");
  });

  it("5. Comisión confidencial al socio: acredita de inmediato al socio y jugador no tiene rastro", () => {
    const jugadorAfiliado: ConfigJugadorLiquidacion = {
      clienteId: "cli-afiliado-1",
      clienteNombre: "GAETANO",
      incentivo_pct: 1.25,
      incentivo_base: "MONTO_DECIDIDO",
      socio_id: "socio-eddie-1",
      socio_nombre: "EDDIE",
      socio_comision_pct: 1.25,
      socio_base: "MONTO_DECIDIDO",
    };

    const jugada: JugadaParaLiquidacion = {
      referencia: "CT C1",
      montoJugado: 1000,
      montoDecidido: 1000,
      premioBruto: 0,
      estado: "PERDEDOR",
    };

    const res = calcularLiquidacionConIncentivosYSocios(jugada, jugadorAfiliado, null, 5.0);

    // 1. En la ficha/resultado del jugador NO hay referencia al socio
    assert.equal((res.jugador1 as any).socioId, undefined, "El jugador no debe tener socioId en su resultado");
    assert.equal((res.jugador1 as any).socioNombre, undefined, "El jugador no debe tener socioNombre en su resultado");
    assert.equal(res.jugador1.incentivoDevolucion, 12.5, "1.25% de incentivo propio para GAETANO");

    // 2. En el resultado para el socio SÍ existe el desglose completo
    assert.ok(res.socioJugador1, "Debe existir registro para el socio");
    assert.equal(res.socioJugador1?.socioId, "socio-eddie-1");
    assert.equal(res.socioJugador1?.socioNombre, "EDDIE");
    assert.equal(res.socioJugador1?.jugadorGeneradorNombre, "GAETANO");
    assert.equal(res.socioJugador1?.comisionPct, 1.25);
    assert.equal(res.socioJugador1?.montoAcreditado, 12.5, "1.25% sobre 1000 = 12.50 para EDDIE");
    assert.equal(res.socioJugador1?.referencia, "CT C1");
    assert.ok(res.socioJugador1?.motivo.includes("GAETANO"), "El motivo debe identificar al jugador");
  });

  it("6. Partida Doble NIIF cuadrada (Debe === Haber)", () => {
    const jugador: ConfigJugadorLiquidacion = {
      clienteId: "cli-niif",
      clienteNombre: "LORENZO",
      comision_particular_pct: 5.0,
      incentivo_pct: 1.0,
      incentivo_base: "MONTO_DECIDIDO",
      socio_id: "socio-1",
      socio_nombre: "THOR",
      socio_comision_pct: 1.0,
      socio_base: "MONTO_DECIDIDO",
    };

    const jugada: JugadaParaLiquidacion = {
      referencia: "DMR C5",
      montoJugado: 500,
      montoDecidido: 500,
      premioBruto: 1500, // Gana 1000
      estado: "GANADOR",
    };

    const res = calcularLiquidacionConIncentivosYSocios(jugada, jugador, null, 5.0);

    assert.equal(res.asientoContableSugerido.cuadrado, true, "El asiento contable debe estar cuadrado");
    const totalDebe = res.asientoContableSugerido.debe.reduce((acc, x) => acc + x.monto, 0);
    const totalHaber = res.asientoContableSugerido.haber.reduce((acc, x) => acc + x.monto, 0);
    assert.equal(Math.round(totalDebe * 100) / 100, Math.round(totalHaber * 100) / 100);
  });
});
