import assert from "node:assert/strict";
import { test } from "node:test";
import { consultarAsistenteIa } from "../src/features/soporte/lib/asistenteIa";
import {
  crearTicketIncidencia,
  listarTickets,
  obtenerTicketPorId,
  responderTicket,
  cambiarEstadoTicket,
  contarTicketsPendientes,
  obtenerTodosLosTickets,
} from "../src/features/soporte/lib/ticketsStorage";

test("Asistente IA: responde correctamente dudas sobre Puestos y combinaciones de varios ejemplares", () => {
  const res = consultarAsistenteIa("¿Cómo funcionan los puestos con varios ejemplares como 1y2 o 3y4?");
  assert.equal(res.resuelto, true);
  assert.equal(res.sugerenciaEscalamiento, false);
  assert.match(res.respuesta, /mejor posición de llegada/i);
  assert.match(res.respuesta, /1P/i);
});

test("Asistente IA: responde correctamente sobre Win Place Show (WPS) e Incentivos", () => {
  const res = consultarAsistenteIa("¿Cuál es el formato de carga de jugadas WPS y los incentivos?");
  assert.equal(res.resuelto, true);
  assert.match(res.respuesta, /win/i);
  assert.match(res.respuesta, /place/i);
  assert.match(res.respuesta, /show/i);
  assert.match(res.respuesta, /Boleto 100,00 Bs/i);
});

test("Asistente IA: responde sobre la diferencia entre saldo Libre, Avalado y Pozo", () => {
  const res = consultarAsistenteIa("¿Qué significa jugador avalado vs libre y pozo?");
  assert.equal(res.resuelto, true);
  assert.match(res.respuesta, /Jugadores Libres/i);
  assert.match(res.respuesta, /Jugadores Avalados/i);
  assert.match(res.respuesta, /Jugadores con Pozo/i);
});

test("Asistente IA: responde sobre Control de Cruces y Bloqueo de Grupo Principal", () => {
  const res = consultarAsistenteIa("¿Por qué no puedo cargar jugadas en el grupo principal?");
  assert.equal(res.resuelto, true);
  assert.match(res.respuesta, /Principal.*exclusivamente de supervisión/i);
});

test("Asistente IA: detecta incidencias críticas o solicitud de humano y sugiere escalamiento a ticket", () => {
  const res = consultarAsistenteIa("Tengo un problema grave con un saldo y quiero hablar con el administrador");
  assert.equal(res.resuelto, false);
  assert.equal(res.sugerenciaEscalamiento, true);
  assert.equal(res.prioridadDetectada, "urgente");
  assert.match(res.respuesta, /Ticket de Incidencia/i);
});

test("Gestor de Tickets: Creación, respuesta y resolución de tickets", () => {
  const conteoInicial = obtenerTodosLosTickets().length;

  const nuevo = crearTicketIncidencia({
    titulo: "Fallo en registro de jugada WPS en taquilla 4",
    descripcion: "El operador indica que la taquilla arrojó timeout al registrar 'Carlos WPS 5 100'.",
    categoria: "error_sistema",
    prioridad: "alta",
    emisor: {
      id: "usr-test-10",
      nombre: "Operador Test",
      rol: "operador",
      grupoId: "grp-test",
      grupoNombre: "Grupo Prueba",
    },
    destinatario: "admin",
  });

  assert.ok(nuevo.id);
  assert.match(nuevo.codigo, /^INC-\d{2}-\d{4}$/);
  assert.equal(nuevo.estado, "abierto");
  assert.equal(nuevo.titulo, "Fallo en registro de jugada WPS en taquilla 4");

  // Buscar por ID y código
  const encontrado = obtenerTicketPorId(nuevo.id);
  assert.ok(encontrado);
  assert.equal(encontrado?.codigo, nuevo.codigo);

  // Responder ticket por el Administrador
  const respondido = responderTicket(nuevo.id, "Hemos revisado los logs y la jugada no se duplicó.", {
    id: "admin-1",
    nombre: "Admin Principal",
    rol: "admin",
  });
  assert.ok(respondido);
  assert.equal(respondido?.estado, "en_proceso");
  assert.equal(respondido?.mensajes.length, 2);

  // Resolver ticket
  const resuelto = cambiarEstadoTicket(nuevo.id, "resuelto", "Incidencia verificada y cerrada.", {
    id: "admin-1",
    nombre: "Admin Principal",
    rol: "Administrador Principal",
  });
  assert.ok(resuelto);
  assert.equal(resuelto?.estado, "resuelto");
  assert.equal(resuelto?.resolucionNota, "Incidencia verificada y cerrada.");
});

console.log("🎉 TODAS LAS PRUEBAS DE SOPORTE, MENSAJERÍA INTELIGENTE Y TICKETS PASARON EXITOSAMENTE.");
