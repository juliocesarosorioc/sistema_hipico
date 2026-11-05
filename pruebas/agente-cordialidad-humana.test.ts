/**
 * Pruebas del Motor de Cordialidad Humana y Diálogo Empático con el Agente IA
 */

import {
  detectarCordialidad,
  generarRespuestaCordial,
  obtenerMomentoDelDia,
} from "../src/features/ia-copiloto/lib/cordialidad";
import {
  parsearInteraccionCordial,
  respuestaCordial,
} from "../src/features/whatsapp/lib/agente-grupo";
import {
  crearSesionAgente,
  procesarTurnoAgente,
} from "../src/features/ia-copiloto/lib/agente-transaccional";
import { consultarAsistenteIa } from "../src/features/soporte/lib/asistenteIa";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("Fallo: " + msg);
}

async function run() {
  console.log("=== INICIO PRUEBAS DE CORDIALIDAD HUMANA Y DIÁLOGO EMPÁTICO ===");

  // 1. Detección de intenciones cordiales
  const c1 = detectarCordialidad("¡Hola, muy buenos días!");
  assert(c1.esCordial, "Debe detectar saludo de buenos días");
  assert(c1.tipo === "SALUDO", "Tipo debe ser SALUDO");
  assert(c1.esPuroCordial, "Debe ser puramente cordial sin transacciones");

  const c2 = detectarCordialidad("¿Cómo estás amigo? ¿Cómo te va?");
  assert(c2.esCordial, "Debe detectar estado y bienestar");
  assert(c2.tipo === "ESTADO_BIENESTAR", "Tipo debe ser ESTADO_BIENESTAR");

  const c3 = detectarCordialidad("¿Quién eres tú y qué haces?");
  assert(c3.esCordial, "Debe detectar pregunta de identidad");
  assert(c3.tipo === "IDENTIDAD", "Tipo debe ser IDENTIDAD");

  const c4 = detectarCordialidad("Muchísimas gracias por tu ayuda, muy amable");
  assert(c4.esCordial, "Debe detectar agradecimiento");
  assert(c4.tipo === "AGRADECIMIENTO", "Tipo debe ser AGRADECIMIENTO");

  const c5 = detectarCordialidad("Hasta luego, que tengas feliz noche");
  assert(c5.esCordial, "Debe detectar despedida");
  assert(c5.tipo === "DESPEDIDA", "Tipo debe ser DESPEDIDA");

  const c6 = detectarCordialidad("Mucha suerte en la jornada de hoy, a ganar");
  assert(c6.esCordial, "Debe detectar buenos deseos y ánimo");
  assert(c6.tipo === "ANIMO_SUERTE", "Tipo debe ser ANIMO_SUERTE");

  // 2. Distinción entre cordialidad pura y mensaje mixto con transacción
  const mixto = detectarCordialidad("Hola amigo, buenas tardes, le pagué 50 a Pedro");
  assert(mixto.esCordial, "Reconoce que hay cortesía");
  assert(!mixto.esPuroCordial, "NO es puro cordial porque incluye orden contable ('le pagué 50')");

  // 3. Generación de respuesta cordial con contrapregunta activa
  const respManana = generarRespuestaCordial(
    { esCordial: true, esPuroCordial: true, tipo: "SALUDO", momentoDia: "DIA" },
    { nombre: "Carlos" }
  );
  assert(respManana.includes("Carlos"), "Debe incluir el nombre del usuario");
  assert(respManana.includes("buenos días"), "Debe saludar con buenos días");
  assert(
    respManana.includes("¿") && respManana.includes("?"),
    "Debe formular una contrapregunta cordial proactiva"
  );

  const respBienestar = generarRespuestaCordial(
    { esCordial: true, esPuroCordial: true, tipo: "ESTADO_BIENESTAR", momentoDia: "TARDE" },
    { nombre: "Pedro" }
  );
  assert(respBienestar.includes("¿Y tú, cómo te encuentras"), "Debe preguntar cómo se encuentra el usuario");

  const respIdentidad = generarRespuestaCordial(
    { esCordial: true, esPuroCordial: true, tipo: "IDENTIDAD", momentoDia: "DIA" },
    { nombre: "Juan" }
  );
  assert(respIdentidad.includes("Asistente y Copiloto Inteligente"), "Debe explicar su identidad con cordialidad");
  assert(respIdentidad.includes("¿En qué te puedo colaborar"), "Debe preguntar cordialmente cómo ayudar");

  // 4. WhatsApp Agente Grupo
  const evGrupo = parsearInteraccionCordial("Hola agente, buenas tardes");
  assert(Boolean(evGrupo), "parsearInteraccionCordial debe detectar saludo en grupo");
  const respGrupo = respuestaCordial(evGrupo!, { nombre: "Administrador" });
  assert(respGrupo.includes("saludarte"), "Respuesta de grupo debe ser educada y cálida");

  // 5. Agente Transaccional no bloquea carreras cerradas para cortesía y formula contrapregunta
  const sesionCerrada = crearSesionAgente({
    hipodromo: "GULFSTREAM PARK",
    carrera: 3,
    estadoCarrera: "CERRADA",
  });

  const resTurnoSaludo = await procesarTurnoAgente(sesionCerrada, {
    texto: "Hola agente, ¿cómo estás?",
    jugador: "Roberto",
  });

  assert(resTurnoSaludo.ok, "Turno debe ser exitoso");
  assert(resTurnoSaludo.tipoAccion === "RESPUESTA_CORDIAL", "tipoAccion debe ser RESPUESTA_CORDIAL");
  assert(!resTurnoSaludo.bloqueado, "No debe bloquear con mensaje de carrera cerrada cuando es saludo");
  assert(resTurnoSaludo.mensaje.includes("Roberto"), "Debe personalizar con el nombre Roberto");
  assert(resTurnoSaludo.mensaje.includes("¿"), "Debe incluir una pregunta cordial de seguimiento");

  // 6. Asistente IA de Soporte
  const resSoporte = consultarAsistenteIa("Buenas tardes, ¿cómo te va hoy?", "Carlos");
  assert(resSoporte.resuelto, "Consulta de cortesía se resuelve inmediatamente");
  assert(resSoporte.respuesta.includes("excelente"), "Responde a la pregunta de bienestar");
  assert(resSoporte.respuesta.includes("¿"), "Formula contrapregunta cordial");

  console.log("=== TODAS LAS PRUEBAS DE CORDIALIDAD HUMANA PASARON EXITOSAMENTE (6/6) ===");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
