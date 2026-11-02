import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calcularEstadoCuentaCliente, construirFichaEstadoCuentaUnificada } from "@/features/saldos/lib/contabilidad-central";

const tickets = [
  {
    id: 313,
    fecha_carrera: "2026-10-29",
    hipodromo: "CHURCHILL DOWNS",
    carrera: 5,
    cliente_juega_nombre: "SAM",
    cliente_consigue_nombre: "ARELY",
    monto_jugado: 50,
    monto_decidido: 50,
    premio_pagar: 0,
    estado: "Perdedor",
    comision_porcentaje: 5,
    comision_pagada: 0,
  },
  {
    id: 260,
    fecha_carrera: "2026-10-29",
    hipodromo: "CHURCHILL DOWNS",
    carrera: 5,
    cliente_juega_nombre: "ARELY",
    cliente_consigue_nombre: "SAM",
    monto_jugado: 50,
    monto_decidido: 50,
    premio_pagar: 0,
    estado: "Perdedor",
    comision_porcentaje: 5,
    comision_pagada: 0,
  }
];

describe("Contabilidad Central Arely Cruce", () => {
  it("calcula estado cuenta para Arely", () => {
    const params = {
      id: "687eb4da-aeb3-496c-869c-9b19b95e84c6",
      nombre: "ARELY",
      saldoBaseBd: 0,
      aval: 0,
      comisionPct: 5,
      devolucionPct: 0,
      devolucionIncentivo: 0,
      libre: false,
      movimientos: tickets as any,
    };

    const est = calcularEstadoCuentaCliente(params);
    console.log("Estado cuenta Arely:", {
      jugadasGanadasBruto: est.jugadasGanadasBruto,
      comisionesCobradas: est.comisionesCobradas,
      reembolsoCruce: est.reembolsoCruce,
      jugadasPerdidas: est.jugadasPerdidas,
      saldoContable: est.saldoContable,
    });

    const ficha = construirFichaEstadoCuentaUnificada(params);
    console.log("Ficha Arely:", {
      jugadasGanadasBruto: ficha.jugadasGanadasBruto,
      comisionesCobradas: ficha.comisionesCobradas,
      reembolsoCruce: ficha.reembolsoCruce,
    });
  });
});
