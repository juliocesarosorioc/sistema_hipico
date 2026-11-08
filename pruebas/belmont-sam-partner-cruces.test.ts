import test from "node:test";
import assert from "node:assert/strict";
import { calcularBaseDecididaCarrera } from "../src/features/liquidacion/lib/devoluciones-cruce";
import { calcularReembolsosCruce } from "../src/features/taquilla/lib/cruces-y-tapas";
import { decidirTickets } from "../src/features/liquidacion/lib/saldos";

test("Belmont Park 1: Sam y Partner cruzan jugadas y comisiones unificadas por carrera", () => {
  // Sam: gana 200 en una jugada y pierde 50 en otra como Consigue
  const lineasSam = [
    { cliente: "SAM", brutoGanado: 200, brutoPerdido: 0, comisionCobrada: 10, rol: "Juega" },
    { cliente: "SAM", brutoGanado: 0, brutoPerdido: 50, comisionCobrada: 0, rol: "Consigue" },
  ];
  const resSam = calcularReembolsosCruce(lineasSam, "con_cruces", 5);
  const itemSam = resSam.porCliente.get("SAM");
  assert.ok(itemSam, "SAM debe tener cruce registrado");
  assert.equal(itemSam.brutoGanado, 200);
  assert.equal(itemSam.brutoPerdido, 50);
  assert.equal(itemSam.baseCruce, 50);
  assert.equal(itemSam.reembolsoCruce, 2.5); // 10 * 50 / 200 = 2.50 de reembolso

  // Saldo unificado neto de Sam:
  // Ganado (200) - Perdido (50) = 150 diferencia positiva
  // Comisión al 5% sobre la diferencia = 7.50
  // Saldo neto = 150 - 7.50 = 142.50
  const netoSam = 200 - 10 - 50 + itemSam.reembolsoCruce;
  assert.equal(netoSam, 142.5);

  // Devolución / incentivo de Sam:
  // Solo en base al monto positivo (150) se estima el incentivo al 1.50%
  const jugadasSam = [
    { nombreJugada: "PUESTOS", montoJugado: 100, premioPagar: 300, resultado: 200, estado: "GANADOR", rol: "Juega" },
    { nombreJugada: "PUESTOS", montoJugado: 50, resultado: -50, estado: "GANADOR", rol: "Consigue" },
  ];
  const devSam = calcularBaseDecididaCarrera(jugadasSam, 1.5);
  assert.equal(devSam.hayCruce, true);
  assert.equal(devSam.totalGanadoBruto, 200);
  assert.equal(devSam.totalPerdidoBruto, 50);
  assert.equal(devSam.baseDecidida, 150, "Base decidida debe ser la diferencia positiva 200 - 50 = 150");
  assert.equal(devSam.devolucion, 2.25, "Incentivo 1.5% de 150 = 2.25");
});

test("Belmont Park 1: Partner con cruce calcula devolución sobre monto neto decidido |80 - 300| = 220", () => {
  // Partner: gana 80 y pierde 300 -> monto decidido = |80 - 300| = 220
  const jugadasPartner = [
    { nombreJugada: "2N Y 2Y2N", montoJugado: 80, premioPagar: 160, resultado: 80, estado: "GANADOR", rol: "Juega" },
    { nombreJugada: "2N", montoJugado: 300, resultado: -300, estado: "GANADOR", rol: "Consigue" },
  ];
  const devPartner = calcularBaseDecididaCarrera(jugadasPartner, 1.0);
  assert.equal(devPartner.hayCruce, true);
  assert.equal(devPartner.totalGanadoBruto, 80);
  assert.equal(devPartner.totalPerdidoBruto, 300);
  assert.equal(devPartner.baseDecidida, 220, "Base decidida debe ser |80 - 300| = 220 sobre monto decidido");
  assert.equal(devPartner.devolucion, 2.2, "Incentivo 1.0% de 220 = 2.20");
});

test("decidirTickets netea comisiones simétricamente entre Juega y Consigue", () => {
  const ticketsBelmont1 = [
    {
      id: "t-1",
      cliente_juega_id: "sam-id",
      cliente_juega_nombre: "SAM",
      cliente_consigue_id: "partner-id",
      cliente_consigue_nombre: "PARTNER",
      nombre_jugada: "1P",
      caballo: "1",
      monto_jugado: 50,
      premio_pagar: 100,
      comision_porcentaje: 5,
    },
    {
      id: "t-2",
      cliente_juega_id: "sam-id",
      cliente_juega_nombre: "SAM",
      nombre_jugada: "1P",
      caballo: "2",
      monto_jugado: 30,
      premio_pagar: 0,
      comision_porcentaje: 5,
    },
  ];

  // Pizarra con caballo 1 ganador y caballo 2 fuera
  const pizarra = { primero: "1", segundo: "3", tercero: "4" };
  const res = decidirTickets(ticketsBelmont1, {
    carrera: 1,
    hipodromo: "BELMONT PARK",
    pizarra,
    tasaComision: 5,
    permiteCruces: true,
  });

  assert.equal(res.length, 2);
  // Ticket 1 gana (SAM gana 50, PARTNER pierde 50)
  assert.equal(res[0].res.ok, true);
  // Ticket 2 pierde (SAM pierde 30)
  assert.equal(res[1].res.ok, false);

  // Cruce de SAM en Belmont 1:
  // Gana 50 en t-1 y pierde 30 en t-2
  // Diferencia positiva: 20
  // Comisión al 5% sobre 20 = 1.00
  // Antes de cruce la comisión era 2.50 (5% de 50)
  // Tras el cruce la comisión total neta de Sam debe ser 1.00
  const comisionSam = res.filter((d) => d.fila.cliente_juega_id === "sam-id")
    .reduce((sum, d) => sum + (d.res.ok ? d.res.gananciaCasa : 0), 0);
  assert.equal(comisionSam, 1.0, "La comisión neta de Sam debe ser 1.00 sobre la diferencia de 20");
});
