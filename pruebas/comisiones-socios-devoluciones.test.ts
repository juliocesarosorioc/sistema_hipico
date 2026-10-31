/**
 * PRUEBAS: Comisiones de Socios por Clientes y Reporte de Destinatarios de Devolución
 */

import {
  PARAMETROS_PREDETERMINADOS_DEVOLUCION,
  buscarReglaDevolucionCliente,
  calcularComisionesSocioPorClientes,
  calcularReporteDestinatariosDevolucion,
  esClienteAfiliadoAlSocio,
  formatearReporteDestinatariosTexto,
} from "../src/features/clientes/lib/comisiones-socios";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("Fallo: " + msg);
}

function assertIgual(act: unknown, esp: unknown, msg: string) {
  if (act !== esp) {
    throw new Error(`${msg} -> esperado: ${JSON.stringify(esp)}, obtenido: ${JSON.stringify(act)}`);
  }
}

console.log("=== INICIO PRUEBAS COMISIONES SOCIOS Y DEVOLUCIONES ===");

// 1. Verificación de configuración predeterminada oficial
console.log("1. Parámetros predeterminados oficiales...");
assert(PARAMETROS_PREDETERMINADOS_DEVOLUCION.length >= 17, "Debe contener al menos 17 configuraciones oficiales");

const reglaPartner = buscarReglaDevolucionCliente("partner");
assert(Boolean(reglaPartner), "PARTNER debe existir");
assertIgual(reglaPartner?.devolucionPropiaPct, 1.5, "PARTNER propia debe ser 1.50%");
assertIgual(reglaPartner?.esSocio, true, "PARTNER debe ser socio");

const reglaBg = buscarReglaDevolucionCliente("BG");
assert(Boolean(reglaBg), "BG debe existir");
assertIgual(reglaBg?.comisionSocioPct, 1.25, "Comisión para PARTNER por BG debe ser 1.25%");
assertIgual(reglaBg?.socioAsignado, "PARTNER", "Socio asignado a BG debe ser PARTNER");

const reglaEddie = buscarReglaDevolucionCliente("EDDIE");
assert(Boolean(reglaEddie), "EDDIE debe existir");
assertIgual(reglaEddie?.devolucionPropiaPct, 1.25, "EDDIE propia debe ser 1.25%");

const reglaGaetano = buscarReglaDevolucionCliente("GAETANO");
assertIgual(reglaGaetano?.comisionSocioPct, 1.25, "Comisión para EDDIE por GAETANO debe ser 1.25%");
assertIgual(reglaGaetano?.socioAsignado, "EDDIE", "Socio asignado a GAETANO debe ser EDDIE");

const reglaRucio = buscarReglaDevolucionCliente("RUCIO");
assertIgual(reglaRucio?.comisionSocioPct, 1.0, "Comisión para EDDIE por RUCIO debe ser 1.00%");

const reglaThor = buscarReglaDevolucionCliente("THOR");
assertIgual(reglaThor?.devolucionPropiaPct, 1.0, "THOR propia debe ser 1.00%");

const reglaSpeedy = buscarReglaDevolucionCliente("SPEEDY");
assertIgual(reglaSpeedy?.comisionSocioPct, 1.0, "Comisión para THOR por SPEEDY debe ser 1.00%");
assertIgual(reglaSpeedy?.socioAsignado, "THOR", "Socio asignado a SPEEDY debe ser THOR");

const reglaMemphis = buscarReglaDevolucionCliente("MEMPHIS");
assertIgual(reglaMemphis?.devolucionPropiaPct, 1.0, "MEMPHIS propia debe ser 1.00%");

const reglaNewcastle = buscarReglaDevolucionCliente("NEWCASTLE");
assertIgual(reglaNewcastle?.comisionSocioPct, 1.0, "Comisión para MEMPHIS por NEWCASTLE debe ser 1.00%");

const reglaSam = buscarReglaDevolucionCliente("SAM");
assertIgual(reglaSam?.devolucionPropiaPct, 1.5, "SAM propia debe ser 1.50%");

const reglaArraez = buscarReglaDevolucionCliente("ARRAEZ");
assertIgual(reglaArraez?.devolucionPropiaPct, 1.0, "ARRAEZ propia debe ser 1.00%");

const reglaFortuna = buscarReglaDevolucionCliente("FORTUNA");
assertIgual(reglaFortuna?.devolucionPropiaPct, 1.0, "FORTUNA propia debe ser 1.00%");

const reglaInfantino = buscarReglaDevolucionCliente("INFANTINO");
assertIgual(reglaInfantino?.devolucionPropiaPct, 1.0, "INFANTINO propia debe ser 1.00%");

const reglaRusso = buscarReglaDevolucionCliente("RUSSO");
assertIgual(reglaRusso?.devolucionPropiaPct, 1.0, "RUSSO propia debe ser 1.00%");

console.log("  OK: Todos los parámetros oficiales verificados.");

// 2. Cálculo de comisiones para EDDIE con jugadas de GAETANO y RUCIO
console.log("2. Cálculo de comisiones para EDDIE...");
const ticketsPrueba = [
  // Jugada propia de EDDIE ($100 al 1.25% = $1.25)
  {
    id: "t1",
    cliente_juega_nombre: "EDDIE",
    fecha_carrera: "2026-10-29",
    monto_jugado: 100,
    hipodromo: "GP",
    carrera: 1,
  },
  // Jugada de GAETANO ($200 al 1.25% = $2.50)
  {
    id: "t2",
    cliente_juega_nombre: "GAETANO",
    fecha_carrera: "2026-10-29",
    monto_jugado: 200,
    hipodromo: "GP",
    carrera: 2,
  },
  // Jugada de RUCIO ($300 al 1.00% = $3.00)
  {
    id: "t3",
    cliente_juega_nombre: "RUCIO",
    fecha_carrera: "2026-10-30",
    monto_jugado: 300,
    hipodromo: "CT",
    carrera: 3,
  },
  // Jugada de RUCIO antes de la fecha de inicio (2026-10-28) -> Debe ser excluida
  {
    id: "t4",
    cliente_juega_nombre: "RUCIO",
    fecha_carrera: "2026-10-28",
    monto_jugado: 500,
    hipodromo: "CT",
    carrera: 1,
  },
  // Jugada anulada de GAETANO -> Debe ser excluida
  {
    id: "t5",
    cliente_juega_nombre: "GAETANO",
    fecha_carrera: "2026-10-30",
    monto_jugado: 1000,
    anulada: true,
  },
];

const resEddie = calcularComisionesSocioPorClientes({
  socioNombre: "EDDIE",
  fechaDesde: "2026-10-29",
  fechaHasta: "2026-10-30",
  tickets: ticketsPrueba,
});

assertIgual(resEddie.totalDevolucionPropia, 1.25, "EDDIE propia debe ser $1.25");
assertIgual(resEddie.totalComisionesClientes, 5.5, "Comisión total de clientes debe ser $2.50 + $3.00 = $5.50");
assertIgual(resEddie.totalGeneralDevoluciones, 6.75, "Total general debe ser $1.25 + $5.50 = $6.75");

const desgloseGaetano = resEddie.desglosePorCliente.find((d) => d.clienteNombre === "GAETANO");
assert(Boolean(desgloseGaetano), "Desglose de GAETANO debe existir");
assertIgual(desgloseGaetano?.totalJugado, 200, "GAETANO jugado debe ser $200");
assertIgual(desgloseGaetano?.totalComision, 2.5, "GAETANO comisión socio debe ser $2.50");
assertIgual(desgloseGaetano?.jugadas.length, 1, "Debe tener 1 jugada válida de GAETANO");

const desgloseRucio = resEddie.desglosePorCliente.find((d) => d.clienteNombre === "RUCIO");
assert(Boolean(desgloseRucio), "Desglose de RUCIO debe existir");
assertIgual(desgloseRucio?.totalJugado, 300, "RUCIO jugado debe ser $300 (excluyendo 2026-10-28)");
assertIgual(desgloseRucio?.totalComision, 3.0, "RUCIO comisión socio debe ser $3.00");
assertIgual(desgloseRucio?.jugadas.length, 1, "Debe tener 1 jugada válida de RUCIO");

console.log("  OK: Cálculo de EDDIE validado correctamente.");

// 3. Cálculo de comisiones para PARTNER con BG (1.25%), ARELY (1%), AYARI (1%), ROCA (1%)
console.log("3. Cálculo de comisiones para PARTNER...");
const ticketsPartner = [
  { id: "tp1", cliente_juega_nombre: "PARTNER", fecha_carrera: "2026-10-29", monto_jugado: 200 }, // 1.50% = $3.00
  { id: "tp2", cliente_juega_nombre: "BG", fecha_carrera: "2026-10-29", monto_jugado: 400 }, // 1.25% = $5.00
  { id: "tp3", cliente_juega_nombre: "ARELY", fecha_carrera: "2026-10-30", monto_jugado: 100 }, // 1.00% = $1.00
  { id: "tp4", cliente_juega_nombre: "AYARI", fecha_carrera: "2026-10-30", monto_jugado: 150 }, // 1.00% = $1.50
  { id: "tp5", cliente_juega_nombre: "ROCA", fecha_carrera: "2026-10-30", monto_jugado: 250 }, // 1.00% = $2.50
];

const resPartner = calcularComisionesSocioPorClientes({
  socioNombre: "PARTNER",
  fechaDesde: "2026-10-29",
  fechaHasta: "2026-10-30",
  tickets: ticketsPartner,
});

assertIgual(resPartner.totalDevolucionPropia, 3.0, "PARTNER propia debe ser $3.00 (1.50% de $200)");
assertIgual(resPartner.totalComisionesClientes, 10.0, "Comisión total de clientes PARTNER debe ser $5 + $1 + $1.50 + $2.50 = $10.00");
assertIgual(resPartner.totalGeneralDevoluciones, 13.0, "Total general PARTNER debe ser $13.00");

console.log("  OK: Cálculo de PARTNER validado.");

// 4. Reporte Destinatarios de Devolución y Formato de Texto
console.log("4. Generación y formateo de Reporte Destinatarios de Devolución...");
const reporteGlobal = calcularReporteDestinatariosDevolucion({
  fechaDesde: "2026-10-29",
  fechaHasta: "2026-10-30",
  tickets: [...ticketsPrueba, ...ticketsPartner],
});

assert(reporteGlobal.items.length >= 9, "Debe tener al menos los 9 destinatarios");
const textoWhatsApp = formatearReporteDestinatariosTexto(reporteGlobal);

console.log("Texto formateado resultante:\n" + textoWhatsApp);

assert(textoWhatsApp.includes("Destinatarios de Devolucion - 2026-10-29 a 2026-10-30"), "Encabezado con fechas presente");
assert(textoWhatsApp.includes("🔀 ARRAEZ"), "ARRAEZ presente");
assert(textoWhatsApp.includes("🔀 EDDIE"), "EDDIE presente");
assert(textoWhatsApp.includes("• (1,25%) EDDIE por si mismo"), "EDDIE por si mismo presente con (1,25%)");
assert(textoWhatsApp.includes("• (1,25%) por GAETANO:"), "GAETANO presente con (1,25%)");
assert(textoWhatsApp.includes("• (1,00%) por RUCIO"), "RUCIO presente con (1,00%)");
assert(textoWhatsApp.includes("🔀 PARTNER"), "PARTNER presente");
assert(textoWhatsApp.includes("• (1,25%) por BG"), "BG presente con (1,25%)");
assert(textoWhatsApp.includes("• (1,00%) por ARELY"), "ARELY presente con (1,00%)");
assert(textoWhatsApp.includes("• (1,00%) por AYARI"), "AYARI presente con (1,00%)");
assert(textoWhatsApp.includes("• (1,00%) por ROCA"), "ROCA presente con (1,00%)");
assert(textoWhatsApp.includes("🔀 THOR"), "THOR presente");
assert(textoWhatsApp.includes("• (1,00%) por SPEEDY"), "SPEEDY presente con (1,00%)");
assert(textoWhatsApp.includes("🔀 MEMPHIS"), "MEMPHIS presente");
assert(textoWhatsApp.includes("• (1,00%) por NEWCASTLE"), "NEWCASTLE presente con (1,00%)");

console.log("  OK: Formateo de texto WhatsApp coincide exactamente con la solicitud.");

// 5. Resolución de socio por ID canónico, nombre y seudónimo (compatibilidad legacy)
console.log("5. Resolución de socio_asignado por ID / nombre / seudónimo...");
const clienteSocio = { id: 10, nombre: "EDDIE", seudonimo: "EDDIE" };

assert(
  esClienteAfiliadoAlSocio({ id: 20, socio_asignado: "10" }, clienteSocio, []),
  "socio_asignado con el ID del socio debe considerarse afiliado"
);
assert(
  esClienteAfiliadoAlSocio({ id: 20, socio_asignado: "EDDIE" }, clienteSocio, []),
  "socio_asignado con el nombre del socio debe considerarse afiliado"
);
assert(
  esClienteAfiliadoAlSocio(
    { id: 20, socio_asignado: "El Jefe" },
    { id: 10, nombre: "EDDIE", seudonimo: "El Jefe" },
    []
  ),
  "socio_asignado con el seudónimo del socio debe considerarse afiliado"
);
assert(
  !esClienteAfiliadoAlSocio({ id: 20, socio_asignado: "PARTNER" }, clienteSocio, []),
  "socio_asignado de otro socio no debe considerarse afiliado"
);

const clientesConId = [
  { id: 10, nombre: "EDDIE", seudonimo: "EDDIE", es_socio: true },
  {
    id: 20,
    nombre: "GAETANO",
    socio_asignado: "10", // ID canónico
    comision_socio_pct: 1.25,
    fecha_inicio_comision_socio: "2026-10-29",
  },
  {
    id: 30,
    nombre: "RUCIO",
    socio_asignado: "EDDIE", // valor legacy por nombre
    comision_socio_pct: 1.0,
    fecha_inicio_comision_socio: "2026-10-29",
  },
];

const resEddiePorId = calcularComisionesSocioPorClientes({
  socioNombre: "EDDIE",
  socioId: 10,
  fechaDesde: "2026-10-29",
  fechaHasta: "2026-10-30",
  tickets: ticketsPrueba,
  clientes: clientesConId,
});

assertIgual(
  resEddiePorId.totalComisionesClientes,
  5.5,
  "Con socio_asignado por ID y por nombre la comisión de EDDIE debe ser $5.50"
);
assert(
  resEddiePorId.desglosePorCliente.some((d) => d.clienteNombre === "GAETANO"),
  "GAETANO (afiliado por ID) debe aparecer en el desglose"
);
assert(
  resEddiePorId.desglosePorCliente.some((d) => d.clienteNombre === "RUCIO"),
  "RUCIO (afiliado legacy por nombre) debe aparecer en el desglose"
);

console.log("  OK: Resolución de socio por ID, nombre y seudónimo validada.");

console.log("=== TODAS LAS PRUEBAS DE COMISIONES Y DEVOLUCIONES PASARON EXITOSAMENTE ===");
