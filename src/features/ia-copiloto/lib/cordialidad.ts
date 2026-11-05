/**
 * ============================================================================
 * MOTOR DE CORDIALIDAD HUMANA Y CONVERSACIÓN EMPÁTICA (`cordialidad.ts`)
 * ============================================================================
 *
 * Dota al Agente IA Copiloto, Asistente de Soporte y Agente de WhatsApp de la
 * capacidad de sostener un diálogo cálido, educado, empático y proactivo:
 *  1. Reconoce saludos, preguntas de bienestar, identidad, agradecimientos,
 *     despedidas y elogios.
 *  2. Responde con calidez humana adaptada a la hora del día (mañana, tarde, noche).
 *  3. Personaliza el trato dirigiéndose al usuario por su nombre.
 *  4. Formula contrapreguntas cordiales para mantener la conversación viva y
 *     guiar amablemente al usuario hacia sus objetivos hípicos o de consulta.
 *  5. Distingue entre interacciones puramente cordiales y mensajes mixtos que
 *     combinan cortesía con comandos transaccionales.
 */

export type TipoCordialidad =
  | "SALUDO"
  | "ESTADO_BIENESTAR"
  | "IDENTIDAD"
  | "AGRADECIMIENTO"
  | "DESPEDIDA"
  | "ANIMO_SUERTE"
  | "APROBACION";

export type MomentoDelDia = "DIA" | "TARDE" | "NOCHE";

export interface EvaluacionCordialidad {
  esCordial: boolean;
  esPuroCordial: boolean;
  tipo: TipoCordialidad | null;
  momentoDia: MomentoDelDia;
}

export interface OpcionesRespuestaCordial {
  nombre?: string | null;
  hora?: Date | null;
  club?: string | null;
  rolUsuario?: string | null;
}

// Expresiones de cortesía
const RE_SALUDOS =
  /\b(?:hola|buenos?\s*d[ií]as?|buenas?\s*tardes?|buenas?\s*noches?|buenas|saludos?|saludos?\s*cordiales?|[eé]pale|que\s*mas|qu[eé]\s*m[aá]s|hey|que\s*onda|qu[eé]\s*onda)\b/i;

const RE_ESTADO_BIENESTAR =
  /\b(?:c[oó]mo\s*(?:est[aá]s|estas|andas|te\s*va|est[aá]|te\s*encuentras)|qu[eé]\s*tal(?:\s*todo)?|todo\s*bien|qu[eé]\s*hay(?:\s*de\s*nuevo)?|c[oó]mo\s*va\s*(?:la\s*jornada|todo|el\s*d[ií]a))\b/i;

const RE_IDENTIDAD =
  /\b(?:qui[eé]n\s*(?:eres|sos|es\s*usted)|c[oó]mo\s*te\s*llamas|qu[eé]\s*(?:haces|puedes\s*hacer|eres)|eres\s*(?:un\s*bot|un\s*robot|una\s*ia|humano|persona)|con\s*qui[eé]n\s*hablo)\b/i;

const RE_AGRADECIMIENTO =
  /\b(?:gracias|muchas\s*gracias|much[ií]simas\s*gracias|te\s*lo\s*agradezco|agradecido|muy\s*amable|mil\s*gracias|gracias\s*amigo|gracias\s*hermano|vale\s*gracias)\b/i;

const RE_DESPEDIDA =
  /\b(?:hasta\s*luego|nos\s*vemos|chao|chau|adi[oó]s|hasta\s*ma[ñn]ana|hasta\s*pronto|feliz\s*noche|feliz\s*resto|feliz\s*tarde|buenas\s*noches\s*(?:descanso|a\s*todos)|me\s*retiro)\b/i;

const RE_ANIMO_SUERTE =
  /\b(?:mucha\s*suerte|buena\s*suerte|a\s*ganar|buen\s*pulso|[eé]xito[s]?|feliz\s*jornada|un\s*abrazo|fuerte\s*abrazo)\b/i;

const RE_APROBACION =
  /\b(?:excelente|buen[ií]simo|perfecto|genial|ok\s*amigo|ch[eé]vere|fino|de\s*acuerdo|entendido|dale|plomo|activo)\b/i;

// Patrones transaccionales / comandos que indican que el mensaje tiene una acción además de cortesía
const RE_ACCION_TRANSACCIONAL =
  /\b(?:le\s*pagu[eé]|le\s*cobr[eé]|deposit[oó]|transfir(?:i[oó]|ieron)|abierta|cerrada|no\s*va\s*m[aá]s|pizarra|saldo|juega|tabla|apuesta|carrera|retirad[oa]|remate|polla|dupleta|1p|2p|3p|1y2n|10a|pp|\$|\b\d+\b)\b/i;

/**
 * Determina el momento del día a partir de una fecha u hora.
 */
export function obtenerMomentoDelDia(fecha?: Date | null): MomentoDelDia {
  const h = (fecha ?? new Date()).getHours();
  if (h >= 5 && h < 12) return "DIA";
  if (h >= 12 && h < 19) return "TARDE";
  return "NOCHE";
}

/**
 * Detecta y clasifica la intención de cordialidad en un texto.
 */
export function detectarCordialidad(
  texto: string,
  fechaReferencia?: Date | null
): EvaluacionCordialidad {
  const t = String(texto ?? "").trim();
  if (!t) {
    return {
      esCordial: false,
      esPuroCordial: false,
      tipo: null,
      momentoDia: obtenerMomentoDelDia(fechaReferencia),
    };
  }

  const momentoDia = obtenerMomentoDelDia(fechaReferencia);

  // Clasificar tipo prioritario de cordialidad
  let tipo: TipoCordialidad | null = null;
  if (RE_ESTADO_BIENESTAR.test(t)) {
    tipo = "ESTADO_BIENESTAR";
  } else if (RE_IDENTIDAD.test(t)) {
    tipo = "IDENTIDAD";
  } else if (RE_AGRADECIMIENTO.test(t)) {
    tipo = "AGRADECIMIENTO";
  } else if (RE_DESPEDIDA.test(t)) {
    tipo = "DESPEDIDA";
  } else if (RE_ANIMO_SUERTE.test(t)) {
    tipo = "ANIMO_SUERTE";
  } else if (RE_SALUDOS.test(t)) {
    tipo = "SALUDO";
  } else if (RE_APROBACION.test(t) && t.split(/\s+/).length <= 4) {
    tipo = "APROBACION";
  }

  const esCordial = tipo !== null;

  // Un mensaje es puramente cordial si NO tiene órdenes de dinero, jugadas ni comandos operativos
  const tieneAccion = RE_ACCION_TRANSACCIONAL.test(t);
  const esPuroCordial = esCordial && !tieneAccion;

  return {
    esCordial,
    esPuroCordial,
    tipo,
    momentoDia,
  };
}

/**
 * Genera una respuesta humana, empática y cordial, incluyendo contrapreguntas proactivas.
 */
export function generarRespuestaCordial(
  evaluacion: EvaluacionCordialidad,
  opciones?: OpcionesRespuestaCordial
): string {
  const nombreRaw = opciones?.nombre?.trim();
  const nombreTratamiento =
    nombreRaw && !/^operador|admin|usuario|cliente$/i.test(nombreRaw)
      ? `, *${nombreRaw}*`
      : "";
  const club = opciones?.club || "Club del Dinero";
  const momento = evaluacion.momentoDia;

  switch (evaluacion.tipo) {
    case "SALUDO": {
      if (momento === "DIA") {
        return (
          `¡Muy buenos días${nombreTratamiento}! ☀️ Qué gusto saludarte.\n` +
          `Espero que estés teniendo un excelente inicio de día. 🏇\n\n` +
          `¿Cómo pinta tu jornada de carreras para hoy? ¿Tienes algún ejemplar favorito en mente o deseas consultar tu saldo disponible? 🍀💰`
        );
      }
      if (momento === "TARDE") {
        return (
          `¡Muy buenas tardes${nombreTratamiento}! 🌤️ Un placer saludarte.\n` +
          `¿Cómo te está tratando la jornada hípica de hoy? 🏇💨\n\n` +
          `¿Listo para las próximas carreras o deseas que te apoye con alguna consulta de saldo o pizarra? 🎯`
        );
      }
      return (
        `¡Muy buenas noches${nombreTratamiento}! 🌙 Un placer saludarte.\n` +
        `Espero que hayas tenido una jornada muy productiva. 🏇✨\n\n` +
        `¿Cómo te fue hoy con las carreras? ¿Deseas consultar tu balance de cierre o revisar alguna pizarra? 🏆`
      );
    }

    case "ESTADO_BIENESTAR": {
      return (
        `¡Todo marchando excelente por aquí${nombreTratamiento}! 🏇💨\n` +
        `Con la mejor energía, monitoreando cada carrera y listos para servirte.\n\n` +
        `¿Y tú, cómo te encuentras hoy? ¿Qué tal tu día y cómo va esa emoción hípica? 🤝🍀`
      );
    }

    case "IDENTIDAD": {
      return (
        `👋 ¡Hola${nombreTratamiento}! Soy tu **Asistente y Copiloto Inteligente de ${club}** 🏇🤖.\n` +
        `----------------------------------------\n` +
        `Estoy aquí para acompañarte durante toda la jornada:\n` +
        `• 💰 Consultar tu saldo y balance en tiempo real.\n` +
        `• 🏁 Seguir aperturas, cierres y pizarras oficiales.\n` +
        `• 📋 Guiarte con jugadas, tablas fijas y remates.\n` +
        `• 💳 Asistirte con registros contables y comprobantes de forma segura.\n` +
        `----------------------------------------\n` +
        `¿En qué te puedo colaborar en este momento? ¿Deseas revisar carreras o consultar tu cuenta? 🤝`
      );
    }

    case "AGRADECIMIENTO": {
      return (
        `¡Con el mayor de los gustos${nombreTratamiento}! 🤝 Es un verdadero placer atenderte.\n\n` +
        `¿Hay alguna otra consulta o jugada en la que pueda apoyarte hoy? ¡Mucho éxito y que sigan los aciertos! 🍀💰`
      );
    }

    case "DESPEDIDA": {
      if (momento === "NOCHE") {
        return (
          `¡Que tengas una feliz noche y un merecido descanso${nombreTratamiento}! 🌙✨\n` +
          `Muchas gracias por compartir con nosotros en ${club}. Aquí estaré atento cuando me necesites. ¡Hasta pronto! 🏇👋`
        );
      }
      return (
        `¡Hasta pronto${nombreTratamiento}! Que tengas un excelente resto del día. 🌤️🏇\n` +
        `Siempre a tu total disposición. ¡Mucho éxito en cada jugada! 🍀💰`
      );
    }

    case "ANIMO_SUERTE": {
      return (
        `¡Muchísimas gracias e igualmente para ti${nombreTratamiento}! 🍀💰\n` +
        `Que haya mucho pulso, precisión y grandes ganancias en la jornada de hoy. 🏇🏁\n\n` +
        `¿Ya tienes tus ejemplares seleccionados para la próxima? 🎯`
      );
    }

    case "APROBACION": {
      return (
        `¡Perfecto${nombreTratamiento}! Quedo completamente a tu orden. 🤝\n\n` +
        `¿Deseas verificar algún saldo, consultar una pizarra o necesitas apoyo con alguna jugada? 🏇`
      );
    }

    default: {
      return (
        `¡Hola${nombreTratamiento}! Qué gusto saludarte. 🏇👋\n` +
        `Estoy a tu completa disposición en ${club}. ¿Cómo te encuentras hoy y en qué te puedo apoyar? 🍀`
      );
    }
  }
}
