/**
 * PRUEBAS: Sala de Jugadas de Puestos estilo WhatsApp + control apertura/cierre.
 *
 * Cubre las reglas solicitadas:
 *  - Propuestas válidas de puestos y rechazo de nomenclaturas inválidas (1n).
 *  - "Solo dispone de X monto" cuando se propone por encima del saldo.
 *  - Concreción respondiendo SOBRE el mensaje (obligatorio).
 *  - "*Aquí Jugaron*" con saldo suficiente y "*Jugaron X monto*" si excede.
 *  - "Favor aclarar" ante roles incompatibles.
 *  - Bloqueo estricto cuando la carrera está cerrada.
 */

import {
  asegurarSaldoJugador,
  evaluarConcrecionRespuesta,
  evaluarPropuestaJugada,
  formatearMonto,
  procesarMensajeSalaJugadas,
  type EstadoSalaJugadas,
  type ReferenciaRespuesta,
} from "../src/features/portal/lib/sala-jugadas-whatsapp";
import {
  alternarEstadoCarreraGlobal,
  esCarreraCerradaOEnPartida,
  limpiarEstadosCarreraEnMemoria,
  marcarEstadoCarreraEnMemoria,
  obtenerEstadoCarreraEnMemoria,
} from "../src/features/portal/lib/bloqueo-jugadas";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("Fallo: " + msg);
}

function assertIgual(act: unknown, esp: unknown, msg: string) {
  if (act !== esp) {
    throw new Error(`${msg} -> esperado: ${JSON.stringify(esp)}, obtenido: ${JSON.stringify(act)}`);
  }
}

/** Estado de sala con saldos explícitos por jugador. */
function estadoBase(saldosIniciales: Record<string, number> = { PEDRO: 200, JUAN: 200 }): EstadoSalaJugadas {
  const saldos: EstadoSalaJugadas["saldos"] = {};
  for (const [nombre, total] of Object.entries(saldosIniciales)) {
    asegurarSaldoJugador(saldos, nombre, total);
  }
  return {
    hipodromo: "LA RINCONADA",
    carrera: 1,
    estadoCarrera: "ABIERTA",
    mensajes: [],
    saldos,
    concrecionesConfirmadas: [],
  };
}

function ultimoMensajeIa(estado: EstadoSalaJugadas) {
  return [...estado.mensajes].reverse().find((m) => m.esIa);
}

function refDePropuesta(estado: EstadoSalaJugadas, autor: string): ReferenciaRespuesta {
  const original = [...estado.mensajes]
    .reverse()
    .find((m) => m.autor === autor && m.propuesta);
  if (!original?.propuesta) throw new Error(`No se encontró propuesta de ${autor}`);
  return {
    id: original.id,
    autor: original.autor,
    texto: original.texto,
    propuesta: original.propuesta,
  };
}

console.log("=== INICIO PRUEBAS SALA DE JUGADAS WHATSAPP ===");

// 1. Gramática de propuestas
console.log("1. Gramática de propuestas de puestos...");
const propValida = evaluarPropuestaJugada("consigo 1p del 5 con 50");
assert(propValida.esPropuesta && propValida.ok, "«consigo 1p del 5 con 50» debe ser propuesta válida");
if (propValida.esPropuesta && propValida.ok) {
  assertIgual(propValida.datos.rol, "DA", "«consigo» debe ser rol DA");
  assertIgual(propValida.datos.jugada, "1P", "La jugada debe normalizarse a 1P");
  assertIgual(propValida.datos.caballos, "5", "El ejemplar debe ser 5");
  assertIgual(propValida.datos.monto, 50, "El monto debe ser 50");
}

const propJuega = evaluarPropuestaJugada("juego 1p del 2 con 40");
assert(propJuega.esPropuesta && propJuega.ok, "«juego 1p del 2 con 40» debe ser propuesta válida");
if (propJuega.esPropuesta && propJuega.ok) {
  assertIgual(propJuega.datos.rol, "JUEGA", "«juego» debe ser rol JUEGA");
}

const propInvalida = evaluarPropuestaJugada("juego 1n del 5 con 50");
if (!propInvalida.esPropuesta) throw new Error("«1n» debe detectarse como intento de jugada");
assert(!propInvalida.ok, "«1n» NUNCA debe ser una jugada válida");

const charla = evaluarPropuestaJugada("hola, buenas tardes");
assert(!charla.esPropuesta, "La charla casual no debe interrumpirse");
console.log("  OK: gramática y rechazo de 1n validados.");

// 2. Propuesta por encima del saldo -> "Solo dispone de X monto"
console.log("2. Límite de saldo al proponer...");
const rExceso = procesarMensajeSalaJugadas(estadoBase({ PEDRO: 200 }), {
  autor: "PEDRO",
  texto: "consigo 1p del 5 con 500",
});
const iaExceso = ultimoMensajeIa(rExceso.nuevoEstado);
assert(Boolean(iaExceso), "Debe responder la IA");
assertIgual(iaExceso?.texto, `Solo dispone de ${formatearMonto(200)}`, "Debe indicar el saldo disponible");
assertIgual(
  rExceso.nuevoEstado.mensajes.filter((m) => !m.esIa && m.propuesta).length,
  0,
  "No debe registrarse la propuesta fuera de saldo"
);
console.log("  OK: límite de saldo al proponer.");

// 3. Propuesta válida + concreción respondiendo sobre el mensaje
console.log("3. Concreción respondiendo sobre el mensaje...");
const r1 = procesarMensajeSalaJugadas(estadoBase(), {
  autor: "PEDRO",
  texto: "consigo 1p del 5 con 100",
});
const propuestaPedro = [...r1.nuevoEstado.mensajes].reverse().find((m) => m.autor === "PEDRO");
assert(Boolean(propuestaPedro?.propuesta), "PEDRO debe dejar una propuesta abierta");
assertIgual(propuestaPedro?.propuesta?.montoAbierto, 100, "El monto abierto debe ser 100");

const refPedro = refDePropuesta(r1.nuevoEstado, "PEDRO");
const r2 = procesarMensajeSalaJugadas(r1.nuevoEstado, {
  autor: "JUAN",
  texto: "voy",
  respuestaA: refPedro,
});
const iaConcrecion = ultimoMensajeIa(r2.nuevoEstado);
assert(Boolean(iaConcrecion?.texto.includes("*Aquí Jugaron*")), "Debe responder *Aquí Jugaron*");
assertIgual(r2.nuevoEstado.concrecionesConfirmadas.length, 1, "Debe registrar 1 concreción confirmada");
assertIgual(
  r2.nuevoEstado.concrecionesConfirmadas[0]?.monto,
  100,
  "La concreción debe ser por el monto abierto"
);
assertIgual(r2.nuevoEstado.saldos.PEDRO.bloqueado, 100, "PEDRO debe tener 100 bloqueados");
assertIgual(r2.nuevoEstado.saldos.JUAN.bloqueado, 100, "JUAN debe tener 100 bloqueados");
assertIgual(r2.nuevoEstado.saldos.JUAN.disponible, 100, "JUAN debe quedar con 100 disponibles");
console.log("  OK: concreción y bloqueo de saldos.");

// 4. Concreción por encima del saldo del aceptante -> "*Jugaron X monto*"
console.log("4. Concreción topada al saldo disponible...");
const baseTopada = estadoBase({ PEDRO: 500, JUAN: 100 });
const rp = procesarMensajeSalaJugadas(baseTopada, {
  autor: "PEDRO",
  texto: "consigo 1p del 5 con 300",
});
const rTopada = procesarMensajeSalaJugadas(rp.nuevoEstado, {
  autor: "JUAN",
  texto: "voy 300",
  respuestaA: refDePropuesta(rp.nuevoEstado, "PEDRO"),
});
const iaTopada = ultimoMensajeIa(rTopada.nuevoEstado);
assert(Boolean(iaTopada?.texto.includes("*Jugaron")), "Debe responder *Jugaron X monto*");
assertIgual(rTopada.nuevoEstado.concrecionesConfirmadas[0]?.monto, 100, "Debe toparse a los $100 de JUAN");
assertIgual(rTopada.nuevoEstado.saldos.JUAN.bloqueado, 100, "JUAN compromete todo su saldo");
console.log("  OK: concreción topada al saldo.");

// 5. Roles incompatibles -> "Favor aclarar"
console.log("5. Validación semántica de roles...");
const semantica = evaluarConcrecionRespuesta("jugaste", {
  rol: "DA",
  jugada: "1P",
  caballos: "5",
  montoAbierto: 50,
});
assert(!semantica.ok, "Quien no da el puesto no puede responder «jugaste» a un DA");
if (!semantica.ok) {
  assert(semantica.error.includes("Favor aclarar"), "Debe pedir aclaración");
}

const rRol = procesarMensajeSalaJugadas(rp.nuevoEstado, {
  autor: "JUAN",
  texto: "jugaste",
  respuestaA: refDePropuesta(rp.nuevoEstado, "PEDRO"),
});
const iaRol = ultimoMensajeIa(rRol.nuevoEstado);
assert(Boolean(iaRol?.texto.includes("Favor aclarar")), "La IA debe responder «Favor aclarar»");
assertIgual(rRol.nuevoEstado.concrecionesConfirmadas.length, 0, "No debe concretarse con roles incompatibles");
console.log("  OK: validación semántica de roles.");

// 6. Carrera cerrada -> se bloquean propuestas y concreciones
console.log("6. Bloqueo estricto de carrera cerrada...");
limpiarEstadosCarreraEnMemoria();
const rCerrada = procesarMensajeSalaJugadas(
  { ...estadoBase(), estadoCarrera: "CERRADA" },
  { autor: "PEDRO", texto: "consigo 1p del 5 con 50" }
);
const iaCerrada = ultimoMensajeIa(rCerrada.nuevoEstado);
assert(Boolean(iaCerrada?.texto.includes("ya se encuentra cerrada")), "Debe informar que la carrera está cerrada");
assertIgual(
  rCerrada.nuevoEstado.mensajes.filter((m) => m.propuesta).length,
  0,
  "No debe aceptarse ninguna propuesta con la carrera cerrada"
);
console.log("  OK: bloqueo de carrera cerrada.");

// 7. Control global de apertura/cierre (memoria compartida)
console.log("7. Control global de apertura/cierre de carrera...");
limpiarEstadosCarreraEnMemoria();
alternarEstadoCarreraGlobal({ hipodromo: "LA RINCONADA", carrera: 1, estado: "CERRADA" });
assert(
  esCarreraCerradaOEnPartida({ hipodromo: "LA RINCONADA", carrera: 1 }),
  "La carrera debe quedar cerrada globalmente"
);
assertIgual(
  obtenerEstadoCarreraEnMemoria({ hipodromo: "LA RINCONADA", carrera: 1 })?.cerrada,
  true,
  "El estado en memoria debe reflejar el cierre"
);

alternarEstadoCarreraGlobal({ hipodromo: "LA RINCONADA", carrera: 1, estado: "ABIERTA" });
assert(
  !esCarreraCerradaOEnPartida({ hipodromo: "LA RINCONADA", carrera: 1 }),
  "La carrera debe poder reabrirse"
);

marcarEstadoCarreraEnMemoria({ hipodromo: "LA RINCONADA", carrera: 2, estado: "LIQUIDADA" });
assert(esCarreraCerradaOEnPartida("LIQUIDADA"), "LIQUIDADA debe considerarse cerrada");
console.log("  OK: apertura/cierre global validado.");

console.log("=== TODAS LAS PRUEBAS DE LA SALA DE JUGADAS PASARON EXITOSAMENTE ===");
