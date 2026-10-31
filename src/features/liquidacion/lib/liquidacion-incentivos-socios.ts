/**
 * ============================================================================
 * LIQUIDACIÓN CENTRALIZADA CON COMISIÓN PARTICULAR, INCENTIVOS Y SOCIOS
 * (`liquidacion-incentivos-socios.ts`)
 * ============================================================================
 *
 * Función pura y determinista para liquidar cualquier jugada (carreras, puestos,
 * eventos libres deportivos, etc.) calculando:
 *  1. Cobro de comisión al ganador (usa `comision_particular_pct` si existe, o la del grupo).
 *  2. Devolución de incentivo al jugador (+ a su saldo), visible en su cuenta diaria,
 *     calculado según su base ('PERDIDA', 'GANANCIA' o 'MONTO_DECIDIDO').
 *  3. Comisión confidencial al socio del jugador (+ al saldo del socio), visible
 *     SOLO para el socio con detalle de origen, base, monto y jugador que lo dejó.
 *     Regla estricta: El jugador jamás ve rastro del socio.
 */

import { redondearCentavos, sumarDinero, restarDinero, calcularComisionExacta } from "@/shared/lib/dinero";

export type BaseIncentivo = "PERDIDA" | "GANANCIA" | "MONTO_DECIDIDO";
export type BaseSocio = "MONTO_DECIDIDO" | "PERDIDA" | "GANANCIA" | "COMISION_COBRADA";

export interface ConfigJugadorLiquidacion {
  clienteId: string | number;
  clienteNombre: string;
  comision_particular_pct?: number | null;
  incentivo_pct?: number | null;
  incentivo_base?: BaseIncentivo | null;
  socio_id?: string | null;
  socio_nombre?: string | null;
  socio_comision_pct?: number | null;
  socio_base?: BaseSocio | null;
}

export interface JugadaParaLiquidacion {
  id?: string | number;
  referencia?: string; // Ej: "GP C1", "MLB NYY vs BOS"
  montoJugado: number;
  montoDecidido: number;
  premioBruto?: number; // Lo que paga la jugada antes de comisiones
  estado: "GANADOR" | "PERDEDOR" | "EMPATE" | "RETIRADO" | string;
  perdidaEfectiva?: number;
  modalidad?: string;
  esJugadaPuestos?: boolean;
}

export interface ResultadoLiquidacionJugador {
  clienteId: string | number;
  clienteNombre: string;
  estado: string;
  gananciaBruta: number;
  comisionPctAplicada: number;
  comisionCasa: number;
  gananciaNeta: number;
  perdida: number;
  netoJugada: number; // gananciaNeta - perdida (+ devolucion capital en empate/retiro)
  incentivoDevolucion: number;
  impactoSaldoTotal: number;
  detalleIncentivo?: {
    base: BaseIncentivo;
    baseMonto: number;
    pct: number;
    monto: number;
  };
}

export interface DesgloseComisionSocio {
  socioId: string | number;
  socioNombre: string;
  jugadorGeneradorId: string | number;
  jugadorGeneradorNombre: string;
  base: BaseSocio;
  baseMonto: number;
  comisionPct: number;
  montoAcreditado: number;
  referencia: string;
  motivo: string;
}

export interface ResultadoLiquidacionUnificada {
  referencia: string;
  jugador1: ResultadoLiquidacionJugador;
  socioJugador1?: DesgloseComisionSocio;
  jugador2?: ResultadoLiquidacionJugador;
  socioJugador2?: DesgloseComisionSocio;
  totalComisionCasa: number;
  asientoContableSugerido: {
    debe: Array<{ cuenta: string; concepto: string; monto: number }>;
    haber: Array<{ cuenta: string; concepto: string; monto: number }>;
    cuadrado: boolean;
  };
}

/**
 * Calcula de manera pura y auditable la liquidación de una jugada con incentivos y socios
 */
export function calcularLiquidacionConIncentivosYSocios(
  jugada: JugadaParaLiquidacion,
  config1: ConfigJugadorLiquidacion,
  config2?: ConfigJugadorLiquidacion | null,
  comisionGrupoDefault = 5
): ResultadoLiquidacionUnificada {
  const est = String(jugada.estado ?? "PENDIENTE").toUpperCase().trim();
  const esGanador1 = est === "GANADOR" || est === "GANO";
  const esPerdedor1 = est === "PERDEDOR" || est === "PERDIO";
  const esEmpate = est === "EMPATE" || est === "NULO";
  const esRetirado = est === "RETIRADO";

  const monto = redondearCentavos(jugada.montoJugado ?? 0);
  const montoDecidido = redondearCentavos(
    jugada.montoDecidido > 0 ? jugada.montoDecidido : monto
  );

  // 1. COMISIÓN PARTICULAR DEL JUGADOR 1
  const comisionPct1 =
    config1.comision_particular_pct !== null &&
    config1.comision_particular_pct !== undefined &&
    !Number.isNaN(Number(config1.comision_particular_pct))
      ? Number(config1.comision_particular_pct)
      : comisionGrupoDefault;

  let gananciaBruta1 = 0;
  let comisionCasa1 = 0;
  let gananciaNeta1 = 0;
  let perdida1 = 0;
  let neto1 = 0;

  if (esGanador1) {
    const premioTotal = redondearCentavos(jugada.premioBruto ?? montoDecidido * 2);
    gananciaBruta1 = Math.max(0, restarDinero(premioTotal, monto));
    comisionCasa1 = calcularComisionExacta(gananciaBruta1, comisionPct1);
    gananciaNeta1 = restarDinero(gananciaBruta1, comisionCasa1);
    neto1 = gananciaNeta1;
  } else if (esPerdedor1) {
    perdida1 = redondearCentavos(jugada.perdidaEfectiva ?? monto);
    neto1 = -perdida1;
  } else if (esEmpate || esRetirado) {
    // Devuelve el capital apostado
    neto1 = 0;
  }

  // 2. DEVOLUCIÓN DE INCENTIVO AL JUGADOR 1
  const incPct1 = Math.max(0, Number(config1.incentivo_pct) || 0);
  const incBase1: BaseIncentivo = config1.incentivo_base || "MONTO_DECIDIDO";
  let baseMontoInc1 = 0;

  if (incPct1 > 0) {
    if (incBase1 === "GANANCIA") {
      baseMontoInc1 = esGanador1 ? gananciaBruta1 : 0;
    } else if (incBase1 === "PERDIDA") {
      baseMontoInc1 = esPerdedor1 ? perdida1 : 0;
    } else {
      // MONTO_DECIDIDO (gane o pierda)
      baseMontoInc1 = esGanador1 || esPerdedor1 ? montoDecidido : 0;
    }
  }

  const incentivoMonto1 =
    baseMontoInc1 > 0 ? calcularComisionExacta(baseMontoInc1, incPct1) : 0;

  const impactoSaldo1 = sumarDinero(neto1, incentivoMonto1);

  const resJugador1: ResultadoLiquidacionJugador = {
    clienteId: config1.clienteId,
    clienteNombre: config1.clienteNombre,
    estado: est,
    gananciaBruta: gananciaBruta1,
    comisionPctAplicada: comisionPct1,
    comisionCasa: comisionCasa1,
    gananciaNeta: gananciaNeta1,
    perdida: perdida1,
    netoJugada: neto1,
    incentivoDevolucion: incentivoMonto1,
    impactoSaldoTotal: impactoSaldo1,
    ...(incPct1 > 0 && {
      detalleIncentivo: {
        base: incBase1,
        baseMonto: baseMontoInc1,
        pct: incPct1,
        monto: incentivoMonto1,
      },
    }),
  };

  // 3. COMISIÓN CONFIDENCIAL AL SOCIO DEL JUGADOR 1
  let socioDesglose1: DesgloseComisionSocio | undefined;
  const socioPct1 = Math.max(0, Number(config1.socio_comision_pct) || 0);
  if (config1.socio_id && socioPct1 > 0) {
    const socBase1: BaseSocio = config1.socio_base || "MONTO_DECIDIDO";
    let baseMontoSoc1 = 0;

    if (socBase1 === "GANANCIA") {
      baseMontoSoc1 = esGanador1 ? gananciaBruta1 : 0;
    } else if (socBase1 === "PERDIDA") {
      baseMontoSoc1 = esPerdedor1 ? perdida1 : 0;
    } else if (socBase1 === "COMISION_COBRADA") {
      baseMontoSoc1 = comisionCasa1;
    } else {
      // MONTO_DECIDIDO
      baseMontoSoc1 = esGanador1 || esPerdedor1 ? montoDecidido : 0;
    }

    const montoSocio1 =
      baseMontoSoc1 > 0 ? calcularComisionExacta(baseMontoSoc1, socioPct1) : 0;

    if (montoSocio1 > 0) {
      socioDesglose1 = {
        socioId: config1.socio_id,
        socioNombre: config1.socio_nombre || `Socio #${config1.socio_id}`,
        jugadorGeneradorId: config1.clienteId,
        jugadorGeneradorNombre: config1.clienteNombre,
        base: socBase1,
        baseMonto: baseMontoSoc1,
        comisionPct: socioPct1,
        montoAcreditado: montoSocio1,
        referencia: jugada.referencia || "Evento",
        motivo: `Comisión de Socio ${socioPct1}% sobre ${socBase1} ($${baseMontoSoc1.toFixed(2)}) de ${config1.clienteNombre}`,
      };
    }
  }

  // 4. JUGADOR 2 (SI ES APUESTA P2P / CONTRAPARTE DIRECTA)
  let resJugador2: ResultadoLiquidacionJugador | undefined;
  let socioDesglose2: DesgloseComisionSocio | undefined;

  if (config2) {
    const esGanador2 = esPerdedor1;
    const esPerdedor2 = esGanador1;

    const comisionPct2 =
      config2.comision_particular_pct !== null &&
      config2.comision_particular_pct !== undefined &&
      !Number.isNaN(Number(config2.comision_particular_pct))
        ? Number(config2.comision_particular_pct)
        : comisionGrupoDefault;

    let gananciaBruta2 = 0;
    let comisionCasa2 = 0;
    let gananciaNeta2 = 0;
    let perdida2 = 0;
    let neto2 = 0;

    if (esGanador2) {
      gananciaBruta2 = perdida1 > 0 ? perdida1 : monto;
      comisionCasa2 = calcularComisionExacta(gananciaBruta2, comisionPct2);
      gananciaNeta2 = restarDinero(gananciaBruta2, comisionCasa2);
      neto2 = gananciaNeta2;
    } else if (esPerdedor2) {
      perdida2 = gananciaBruta1 > 0 ? gananciaBruta1 : monto;
      neto2 = -perdida2;
    } else {
      neto2 = 0;
    }

    const incPct2 = Math.max(0, Number(config2.incentivo_pct) || 0);
    const incBase2: BaseIncentivo = config2.incentivo_base || "MONTO_DECIDIDO";
    let baseMontoInc2 = 0;
    if (incPct2 > 0) {
      if (incBase2 === "GANANCIA") {
        baseMontoInc2 = esGanador2 ? gananciaBruta2 : 0;
      } else if (incBase2 === "PERDIDA") {
        baseMontoInc2 = esPerdedor2 ? perdida2 : 0;
      } else {
        baseMontoInc2 = esGanador2 || esPerdedor2 ? montoDecidido : 0;
      }
    }
    const incentivoMonto2 =
      baseMontoInc2 > 0 ? calcularComisionExacta(baseMontoInc2, incPct2) : 0;
    const impactoSaldo2 = sumarDinero(neto2, incentivoMonto2);

    resJugador2 = {
      clienteId: config2.clienteId,
      clienteNombre: config2.clienteNombre,
      estado: esGanador2 ? "GANADOR" : esPerdedor2 ? "PERDEDOR" : est,
      gananciaBruta: gananciaBruta2,
      comisionPctAplicada: comisionPct2,
      comisionCasa: comisionCasa2,
      gananciaNeta: gananciaNeta2,
      perdida: perdida2,
      netoJugada: neto2,
      incentivoDevolucion: incentivoMonto2,
      impactoSaldoTotal: impactoSaldo2,
      ...(incPct2 > 0 && {
        detalleIncentivo: {
          base: incBase2,
          baseMonto: baseMontoInc2,
          pct: incPct2,
          monto: incentivoMonto2,
        },
      }),
    };

    const socioPct2 = Math.max(0, Number(config2.socio_comision_pct) || 0);
    if (config2.socio_id && socioPct2 > 0) {
      const socBase2: BaseSocio = config2.socio_base || "MONTO_DECIDIDO";
      let baseMontoSoc2 = 0;
      if (socBase2 === "GANANCIA") {
        baseMontoSoc2 = esGanador2 ? gananciaBruta2 : 0;
      } else if (socBase2 === "PERDIDA") {
        baseMontoSoc2 = esPerdedor2 ? perdida2 : 0;
      } else if (socBase2 === "COMISION_COBRADA") {
        baseMontoSoc2 = comisionCasa2;
      } else {
        baseMontoSoc2 = esGanador2 || esPerdedor2 ? montoDecidido : 0;
      }
      const montoSocio2 =
        baseMontoSoc2 > 0 ? calcularComisionExacta(baseMontoSoc2, socioPct2) : 0;

      if (montoSocio2 > 0) {
        socioDesglose2 = {
          socioId: config2.socio_id,
          socioNombre: config2.socio_nombre || `Socio #${config2.socio_id}`,
          jugadorGeneradorId: config2.clienteId,
          jugadorGeneradorNombre: config2.clienteNombre,
          base: socBase2,
          baseMonto: baseMontoSoc2,
          comisionPct: socioPct2,
          montoAcreditado: montoSocio2,
          referencia: jugada.referencia || "Evento",
          motivo: `Comisión de Socio ${socioPct2}% sobre ${socBase2} ($${baseMontoSoc2.toFixed(2)}) de ${config2.clienteNombre}`,
        };
      }
    }
  }

  const totalComisionCasa = sumarDinero(comisionCasa1, resJugador2?.comisionCasa ?? 0);

  // Asiento Contable NIIF cuadrado
  const debe: Array<{ cuenta: string; concepto: string; monto: number }> = [];
  const haber: Array<{ cuenta: string; concepto: string; monto: number }> = [];

  // Ingresos por comisiones de la casa
  if (totalComisionCasa > 0) {
    haber.push({
      cuenta: "4.1.01.001",
      concepto: `Ingreso por comisión de jugadas ${jugada.referencia || ""}`,
      monto: totalComisionCasa,
    });
  }

  // Costo de incentivos otorgados
  const totalIncentivos = sumarDinero(incentivoMonto1, resJugador2?.incentivoDevolucion ?? 0);
  if (totalIncentivos > 0) {
    debe.push({
      cuenta: "5.1.02.001",
      concepto: `Gasto de incentivos/devoluciones a jugadores`,
      monto: totalIncentivos,
    });
  }

  // Costo de comisiones a socios
  const totalSocios = sumarDinero(
    socioDesglose1?.montoAcreditado ?? 0,
    socioDesglose2?.montoAcreditado ?? 0
  );
  if (totalSocios > 0) {
    debe.push({
      cuenta: "5.1.03.001",
      concepto: `Gasto de comisiones devengadas por socios`,
      monto: totalSocios,
    });
  }

  // Pasivo con clientes / cuentas por pagar y cobrar
  // Partida doble básica de cuadre
  const sumaDebe = debe.reduce((acc, x) => acc + x.monto, 0);
  const sumaHaber = haber.reduce((acc, x) => acc + x.monto, 0);
  const dif = redondearCentavos(sumaHaber - sumaDebe);
  if (dif > 0) {
    debe.push({
      cuenta: "1.1.01.001",
      concepto: `Caja y bancos / Acreditación neta operativa`,
      monto: dif,
    });
  } else if (dif < 0) {
    haber.push({
      cuenta: "2.1.01.001",
      concepto: `Pasivo exigible clientes / Liquidación de fondos`,
      monto: Math.abs(dif),
    });
  }

  const totalD = redondearCentavos(debe.reduce((acc, x) => acc + x.monto, 0));
  const totalH = redondearCentavos(haber.reduce((acc, x) => acc + x.monto, 0));

  return {
    referencia: jugada.referencia || "Evento",
    jugador1: resJugador1,
    socioJugador1: socioDesglose1,
    jugador2: resJugador2,
    socioJugador2: socioDesglose2,
    totalComisionCasa,
    asientoContableSugerido: {
      debe,
      haber,
      cuadrado: Math.abs(totalD - totalH) < 0.01,
    },
  };
}

/**
 * Emite mensajería progresiva visual en la interfaz a través de ToastHost / CustomEvent
 */
export function emitirMensajePaso(
  msg: string,
  tipo: "info" | "success" | "warning" | "error" = "info"
): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));
    window.dispatchEvent(
      new CustomEvent("sistema_hipico:progreso_operacion", {
        detail: { msg, tipo, timestamp: Date.now() },
      })
    );
  }
}
