/**
 * ============================================================================
 * MOTOR Y ESTADO DE SALA DE JUGADAS P2P TIPO WHATSAPP (AGENTE IA)
 * ============================================================================
 *
 * Reglas de negocio del Agente:
 *  1. Los jugadores realizan propuestas de jugadas de puestos (1P, 2P, 3P, etc.).
 *  2. Solo pueden jugar su saldo disponible y carreras que estén ABIERTAS.
 *  3. Si la carrera está CERRADA: "⛔ Esta carrera ya se encuentra cerrada. No se permiten más jugadas ni propuestas."
 *  4. Si un jugador propone por encima de su saldo: la IA responde sobre el mensaje:
 *     "Solo dispone de X monto."
 *  5. Si una jugada está mal propuesta: la IA responde sobre el mensaje:
 *     "Favor aclarar"
 *  6. Si una jugada está mal concretada (ej. ambos dicen "juego"/"jugué" o roles incompatibles):
 *     la IA responde sobre el mensaje:
 *     "Favor aclarar: Una persona juega y la otra debe dar o aceptar la contraria."
 *  7. Otro jugador puede responder (citar) la propuesta para concretarla.
 *  8. Si el que concreta tiene menos saldo que el propuesto:
 *     la IA responde sobre el mensaje: "*Jugaron X monto*" (con el monto topado a su saldo disponible).
 *  9. Si ambos disponen de saldo suficiente:
 *     la IA sombrea la concreción y responde sobre ese mensaje diciendo:
 *     "*Aquí Jugaron*" (en negritas).
 * 10. Ambos quedan con el saldo comprometido (saldo bloqueado) hasta que se concrete la carrera.
 * 11. Las conversaciones comunes no son interrumpidas por la IA.
 */

import {
  esComandoCerrarJugada,
  esComandoJugueConTodos,
  parsearMensajeJugada,
  type DatosJugada,
  type RolJugada,
} from "@/features/portal/lib/gramatica-concrecion-hipica";
import {
  esCarreraCerradaOEnPartida,
  obtenerEstadoCarreraEnMemoria,
  marcarEstadoCarreraEnMemoria,
  type EstadoOperativoCarrera,
} from "@/features/portal/lib/bloqueo-jugadas";

export interface SaldoUsuarioSala {
  nombre: string;
  total: number;
  bloqueado: number; // Saldo comprometido en jugadas de la carrera
  disponible: number; // total - bloqueado
}

export interface ReferenciaRespuesta {
  id: string;
  autor: string;
  texto: string;
  propuesta?: {
    id: string;
    rol: RolJugada;
    jugada: string;
    caballos: string;
    montoOriginal: number;
    montoAbierto: number;
  };
}

export interface MensajeSalaWhatsApp {
  id: string;
  autor: string;
  texto: string;
  fecha: string;
  esIa?: boolean;
  esConcrecion?: boolean;
  sombrear?: boolean;
  respuestaA?: ReferenciaRespuesta | null;
  propuesta?: {
    id: string;
    rol: RolJugada;
    jugada: string;
    caballos: string;
    montoOriginal: number;
    montoAbierto: number;
  };
  concrecion?: {
    id: string;
    propuestaId: string;
    autorPropuesta: string;
    jugadorAcepta: string;
    jugada: string;
    caballos: string;
    monto: number;
  };
}

export interface PendienteAmpliacionSala {
  propuestaId: string;
  proponente: string;
  aceptante: string;
  jugada: string;
  caballos: string;
  montoSolicitado: number;
  montoConcretado: number;
  montoPendiente: number;
  mensajeConcrecionId: string;
  textoConcrecion: string;
  cerrada: boolean;
}

export interface EstadoSalaJugadas {
  hipodromo: string;
  carrera: number;
  estadoCarrera: EstadoOperativoCarrera;
  mensajes: MensajeSalaWhatsApp[];
  saldos: Record<string, SaldoUsuarioSala>;
  concrecionesConfirmadas: Array<{
    id: string;
    propuestaId: string;
    proponente: string;
    aceptante: string;
    jugada: string;
    caballos: string;
    monto: number;
    fecha: string;
  }>;
  pendientesAmpliacion?: PendienteAmpliacionSala[];
}

const fmt = (n: number): string =>
  Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");

export function formatearMonto(n: number): string {
  return `$${fmt(n)}`;
}

/**
 * Normaliza nombres para comparación insensible a mayúsculas/espacios.
 */
export function normalizarNombre(nombre: string): string {
  return String(nombre ?? "")
    .trim()
    .toUpperCase();
}

/**
 * Inicializa o recupera el saldo de un jugador.
 */
export function asegurarSaldoJugador(
  saldos: Record<string, SaldoUsuarioSala>,
  nombre: string,
  saldoInicialPorDefecto = 200
): SaldoUsuarioSala {
  const norm = normalizarNombre(nombre);
  if (!saldos[norm]) {
    saldos[norm] = {
      nombre,
      total: saldoInicialPorDefecto,
      bloqueado: 0,
      disponible: saldoInicialPorDefecto,
    };
  }
  return saldos[norm];
}

/**
 * Bloquea saldo comprometido para un jugador.
 */
export function comprometerSaldo(
  saldos: Record<string, SaldoUsuarioSala>,
  nombre: string,
  monto: number
): boolean {
  const jugador = asegurarSaldoJugador(saldos, nombre);
  if (jugador.disponible < monto) return false;
  jugador.bloqueado = Math.round((jugador.bloqueado + monto) * 100) / 100;
  jugador.disponible = Math.max(0, Math.round((jugador.total - jugador.bloqueado) * 100) / 100);
  return true;
}

/**
 * Libera saldo bloqueado de un jugador (al liquidar o cancelar).
 */
export function liberarSaldoComprometido(
  saldos: Record<string, SaldoUsuarioSala>,
  nombre: string,
  monto: number
): void {
  const jugador = asegurarSaldoJugador(saldos, nombre);
  jugador.bloqueado = Math.max(0, Math.round((jugador.bloqueado - monto) * 100) / 100);
  jugador.disponible = Math.round((jugador.total - jugador.bloqueado) * 100) / 100;
}

/**
 * Detección preliminar de si un mensaje aparenta ser una propuesta de jugada.
 */
export function pareceIntentoDeJugada(texto: string): boolean {
  const t = String(texto ?? "").toLowerCase();
  return (
    /\b(consigo|doy|banco|juego|voy|apuesto|pongo|1p|2p|3p|pp|ganador|place|concreta|jugaste|jugue)\b/.test(
      t
    ) || /\b\d+p\b/.test(t)
  );
}

/**
 * Analiza si un mensaje de propuesta tiene una sintaxis válida de puestos.
 */
export function evaluarPropuestaJugada(
  texto: string
):
  | { esPropuesta: true; ok: true; datos: DatosJugada }
  | { esPropuesta: true; ok: false; error: "Favor aclarar" }
  | { esPropuesta: false } {
  const t = String(texto ?? "").trim();
  if (!pareceIntentoDeJugada(t)) {
    return { esPropuesta: false };
  }

  // Comprobar patrón directo venezolano: "consigo 1p del 5 con 50", "juego 1p 5 100", etc.
  const patDirecto =
    /^(consigo|consigue|doy|da|banco|juego|juega|voy|apuesto|pongo)\s+(\d+p(?:\s*y\s*\d+(?:\/\d+)?n)?|\d+a\d+|pp|ganador|place)\s+(?:del?\s+)?([0-9y\-]+)\s+(?:con\s+)?(\d+(?:[.,]\d+)?)$/i;
  const m = patDirecto.exec(t);
  if (m) {
    const rol: RolJugada = /consigo|consigue|doy|da|banco/i.test(m[1]) ? "DA" : "JUEGA";
    const jugada = m[2].toUpperCase().replace(/\s+/g, "");
    const caballos = m[3].replace(/\s+/g, "");
    const monto = parseFloat(m[4].replace(",", "."));
    if (monto > 0 && caballos) {
      return {
        esPropuesta: true,
        ok: true,
        datos: { rol, jugada, caballos, monto },
      };
    }
  }

  // Intentar con el parser exhaustivo gramatical de la plataforma
  const parsed = parsearMensajeJugada(t);
  if (parsed.ok) {
    return {
      esPropuesta: true,
      ok: true,
      datos: parsed.datos,
    };
  }

  // Si intentó dictar una jugada pero no se pudo determinar con certeza ejemplar, puesto o monto:
  return {
    esPropuesta: true,
    ok: false,
    error: "Favor aclarar",
  };
}

/**
 * Detecta si la respuesta sobre una propuesta es una concreción válida o un error semántico de roles.
 *
 * Caso 1: A dice "juego 1p del 5 con 100" (JUEGA) y B responde "juego" o "jugue":
 *         -> Error: Ambos juegan, nadie da la contra.
 * Caso 2: A dice "consigo 1p del 5 con 50" (DA) y B responde "jugaste" o "te doy":
 *         -> Error: El autor conseguía (daba), quien responde no puede decir "jugaste".
 */
export function evaluarConcrecionRespuesta(
  textoRespuesta: string,
  propuesta: { rol: RolJugada; jugada: string; caballos: string; montoAbierto: number; montoOriginal?: number }
):
  | { ok: true; montoAceptado: number; montoSolicitado: number }
  | { ok: false; error: string } {
  const t = String(textoRespuesta ?? "")
    .trim()
    .toLowerCase();

  // Si el texto es una charla casual y no intenta concretar
  const palabrasAceptacion = [
    "voy",
    "juego",
    "jugue",
    "jugué",
    "jugo",
    "jugó",
    "te doy",
    "doy",
    "consigo",
    "jugaste",
    "banco",
    "dale",
    "agarro",
    "llevo",
    "ponte",
    "pago",
    "anota",
    "j",
  ];
  const tienePalabraClave = palabrasAceptacion.some((p) => new RegExp(`\\b${p}\\b`, "i").test(t));
  const montoMencionadoMatch = /\b(\d+(?:[.,]\d+)?)\b/.exec(t);

  if (!tienePalabraClave && !montoMencionadoMatch) {
    return {
      ok: false,
      error: "Favor aclarar",
    };
  }

  // Incompatibilidad de roles:
  // Propuesta JUEGA: El autor juega a favor. El aceptante DEBE ser DA (dar, conseguir, bancar, jugaste).
  if (propuesta.rol === "JUEGA") {
    if (/\b(jugue|jugué|juego|voy|apuesto)\b/i.test(t) && !/\b(te doy|doy|banco|jugaste|consigo)\b/i.test(t)) {
      return {
        ok: false,
        error: "Favor aclarar: Una persona juega y la otra debe dar o aceptar la contraria.",
      };
    }
  }

  // Propuesta DA: El autor da/consigue puesto. El aceptante DEBE ser JUEGA (juego, voy, agarro, jugué).
  if (propuesta.rol === "DA") {
    if (/\b(jugaste|te doy|doy|consigo|banco)\b/i.test(t) && !/\b(jugue|jugué|juego|voy|agarro)\b/i.test(t)) {
      return {
        ok: false,
        error:
          "Favor aclarar: Una persona indicó que da/consigue el puesto y la contra debe indicar que juega ('voy', 'juego', 'jugué').",
      };
    }
  }

  // Determinar monto solicitado y monto aceptado
  let montoSolicitado = propuesta.montoAbierto > 0 ? propuesta.montoAbierto : Number(propuesta.montoOriginal || 0);
  let montoAceptado = propuesta.montoAbierto;
  if (montoMencionadoMatch) {
    const val = parseFloat(montoMencionadoMatch[1].replace(",", "."));
    if (val > 0) {
      montoSolicitado = val;
      montoAceptado = Math.min(val, propuesta.montoAbierto);
    }
  }

  return {
    ok: true,
    montoAceptado,
    montoSolicitado,
  };
}

/**
 * Procesa un mensaje en la Sala de Jugadas WhatsApp.
 * Devuelve el nuevo estado y los mensajes agregados (usuario + eventuales intervenciones de la IA).
 */
export function procesarMensajeSalaJugadas(
  estado: EstadoSalaJugadas,
  params: {
    autor: string;
    texto: string;
    respuestaA?: ReferenciaRespuesta | null;
  }
): {
  nuevoEstado: EstadoSalaJugadas;
  mensajesGenerados: MensajeSalaWhatsApp[];
} {
  const { autor, texto, respuestaA } = params;
  const ahoraFmt = new Date().toLocaleTimeString("es-VE", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const idMsg = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const saldos = { ...estado.saldos };
  const saldoAutor = asegurarSaldoJugador(saldos, autor);

  // 1. Mensaje del usuario
  const mensajeUsuario: MensajeSalaWhatsApp = {
    id: idMsg,
    autor,
    texto,
    fecha: ahoraFmt,
    respuestaA: respuestaA ?? null,
  };

  const mensajesGenerados: MensajeSalaWhatsApp[] = [mensajeUsuario];
  let concreciones = [...estado.concrecionesConfirmadas];
  let pendientes = (estado.pendientesAmpliacion ?? []).map((p) => ({ ...p }));

  // =========================================================================
  // CASO 0: COMANDO DE CIERRE ("Se Fue", "sf", "cf", "c fue", "ce fue")
  // =========================================================================
  if (esComandoCerrarJugada(texto)) {
    const propTargetId = respuestaA?.propuesta?.id;
    for (const item of pendientes) {
      if (
        !item.cerrada &&
        item.montoPendiente > 0 &&
        normalizarNombre(item.aceptante) === normalizarNombre(autor) &&
        (!propTargetId || item.propuestaId === propTargetId)
      ) {
        item.cerrada = true;
        item.montoPendiente = 0;
      }
    }
    for (const m of estado.mensajes) {
      if (
        m.propuesta &&
        normalizarNombre(m.autor) === normalizarNombre(autor) &&
        (!propTargetId || m.propuesta.id === propTargetId)
      ) {
        m.propuesta.montoAbierto = 0;
        for (const item of pendientes) {
          if (item.propuestaId === m.propuesta.id && !item.cerrada) {
            item.cerrada = true;
            item.montoPendiente = 0;
          }
        }
      }
    }
    return {
      nuevoEstado: {
        ...estado,
        saldos,
        concrecionesConfirmadas: concreciones,
        pendientesAmpliacion: pendientes,
        mensajes: [...estado.mensajes, ...mensajesGenerados],
      },
      mensajesGenerados,
    };
  }

  // =========================================================================
  // CASO 0.B: "Jugue con Todos" / "Todos" POR PARTE DEL PROPONENTE
  // =========================================================================
  if (esComandoJugueConTodos(texto)) {
    const propTargetId = respuestaA?.propuesta?.id;
    const msgProp = propTargetId
      ? estado.mensajes.find(
          (m) => m.propuesta?.id === propTargetId && normalizarNombre(m.autor) === normalizarNombre(autor)
        )
      : [...estado.mensajes]
          .reverse()
          .find(
            (m) =>
              m.propuesta &&
              normalizarNombre(m.autor) === normalizarNombre(autor) &&
              pendientes.some((p) => p.propuestaId === m.propuesta!.id && !p.cerrada && p.montoPendiente > 0)
          );

    if (msgProp?.propuesta) {
      const prop = msgProp.propuesta;
      const saldoProponente = asegurarSaldoJugador(saldos, msgProp.autor);

      for (const item of pendientes) {
        if (item.propuestaId !== prop.id || item.cerrada || item.montoPendiente <= 0) continue;
        const saldoAceptante = asegurarSaldoJugador(saldos, item.aceptante);
        const adicional = Math.min(item.montoPendiente, saldoProponente.disponible, saldoAceptante.disponible);
        if (adicional <= 0) continue;

        comprometerSaldo(saldos, msgProp.autor, adicional);
        comprometerSaldo(saldos, item.aceptante, adicional);

        const eraParcial = item.montoConcretado > 0;
        const nuevoTotal = Math.round((item.montoConcretado + adicional) * 100) / 100;
        item.montoConcretado = nuevoTotal;
        item.montoPendiente = Math.max(0, Math.round((item.montoPendiente - adicional) * 100) / 100);

        if (eraParcial) {
          const concExistente = [...concreciones]
            .reverse()
            .find(
              (c) =>
                c.propuestaId === prop.id &&
                normalizarNombre(c.aceptante) === normalizarNombre(item.aceptante)
            );
          if (concExistente) {
            concExistente.monto = nuevoTotal;
          } else {
            concreciones.push({
              id: `conc-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
              propuestaId: prop.id,
              proponente: msgProp.autor,
              aceptante: item.aceptante,
              jugada: prop.jugada,
              caballos: prop.caballos,
              monto: nuevoTotal,
              fecha: ahoraFmt,
            });
          }
        } else {
          concreciones.push({
            id: `conc-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            propuestaId: prop.id,
            proponente: msgProp.autor,
            aceptante: item.aceptante,
            jugada: prop.jugada,
            caballos: prop.caballos,
            monto: nuevoTotal,
            fecha: ahoraFmt,
          });
        }

        const textoIa =
          eraParcial && item.montoPendiente === 0
            ? `Jugó Completo ${fmt(nuevoTotal)}`
            : `Jugo ${fmt(nuevoTotal)}`;

        mensajesGenerados.push({
          id: `ia-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          autor: "🤖 Agente IA",
          texto: textoIa,
          fecha: ahoraFmt,
          esIa: true,
          sombrear: true,
          respuestaA: {
            id: item.mensajeConcrecionId,
            autor: item.aceptante,
            texto: item.textoConcrecion,
          },
        });
      }

      return {
        nuevoEstado: {
          ...estado,
          saldos,
          concrecionesConfirmadas: concreciones,
          pendientesAmpliacion: pendientes,
          mensajes: [...estado.mensajes, ...mensajesGenerados],
        },
        mensajesGenerados,
      };
    }
  }

  // =========================================================================
  // CASO A: RESPUESTA A UN MENSAJE PREVIO CON PROPUESTA (CONCRECIÓN P2P)
  // =========================================================================
  if (respuestaA?.propuesta) {
    // Usar el estado más reciente de la propuesta en estado.mensajes por si ya tuvo concreciones previas
    const msgPropOriginal = estado.mensajes.find((m) => m.id === respuestaA.propuesta!.id);
    const prop = msgPropOriginal?.propuesta ?? respuestaA.propuesta;

    // Verificar si la carrera está cerrada
    const enMem = obtenerEstadoCarreraEnMemoria({
      hipodromo: estado.hipodromo,
      carrera: estado.carrera,
    });
    const cerrada = estado.estadoCarrera === "CERRADA" || enMem?.cerrada || esCarreraCerradaOEnPartida(estado.estadoCarrera);

    if (cerrada) {
      const msgIa: MensajeSalaWhatsApp = {
        id: `ia-${Date.now()}-cierre`,
        autor: "🤖 Agente IA",
        texto: "⛔ Esta carrera ya se encuentra cerrada. No se permiten más jugadas ni propuestas.",
        fecha: ahoraFmt,
        esIa: true,
        respuestaA: { id: idMsg, autor, texto },
      };
      mensajesGenerados.push(msgIa);
      return {
        nuevoEstado: {
          ...estado,
          saldos,
          pendientesAmpliacion: pendientes,
          mensajes: [...estado.mensajes, ...mensajesGenerados],
        },
        mensajesGenerados,
      };
    }

    // Regla: un jugador no puede jugar ni dar contra sí mismo.
    if (normalizarNombre(autor) === normalizarNombre(respuestaA.autor)) {
      const msgIa: MensajeSalaWhatsApp = {
        id: `ia-${Date.now()}-mismo`,
        autor: "🤖 Agente IA",
        texto: "Favor aclarar: un jugador no puede jugar ni dar contra sí mismo.",
        fecha: ahoraFmt,
        esIa: true,
        respuestaA: { id: idMsg, autor, texto },
      };
      mensajesGenerados.push(msgIa);
      return {
        nuevoEstado: {
          ...estado,
          saldos,
          pendientesAmpliacion: pendientes,
          mensajes: [...estado.mensajes, ...mensajesGenerados],
        },
        mensajesGenerados,
      };
    }

    // Evaluar si la concreción es válida sintáctica y semánticamente
    const evaluacionConcrecion = evaluarConcrecionRespuesta(texto, prop);

    if (!evaluacionConcrecion.ok) {
      const msgIa: MensajeSalaWhatsApp = {
        id: `ia-${Date.now()}-aclara`,
        autor: "🤖 Agente IA",
        texto: evaluacionConcrecion.error,
        fecha: ahoraFmt,
        esIa: true,
        respuestaA: { id: idMsg, autor, texto },
      };
      mensajesGenerados.push(msgIa);
      return {
        nuevoEstado: {
          ...estado,
          saldos,
          pendientesAmpliacion: pendientes,
          mensajes: [...estado.mensajes, ...mensajesGenerados],
        },
        mensajesGenerados,
      };
    }

    // Verificar saldos disponibles de ambas partes
    const saldoAceptante = saldoAutor;
    const saldoProponente = asegurarSaldoJugador(saldos, respuestaA.autor);

    const montoSolicitado = evaluacionConcrecion.montoSolicitado;
    const montoDeseado = evaluacionConcrecion.montoAceptado;

    // ¿El aceptante dispone de menos saldo que el monto deseado?
    if (saldoAceptante.disponible <= 0) {
      const msgIa: MensajeSalaWhatsApp = {
        id: `ia-${Date.now()}-sinsaldo`,
        autor: "🤖 Agente IA",
        texto: `Solo dispone de ${formatearMonto(saldoAceptante.disponible)}`,
        fecha: ahoraFmt,
        esIa: true,
        respuestaA: { id: idMsg, autor, texto },
      };
      mensajesGenerados.push(msgIa);
      return {
        nuevoEstado: {
          ...estado,
          saldos,
          pendientesAmpliacion: pendientes,
          mensajes: [...estado.mensajes, ...mensajesGenerados],
        },
        mensajesGenerados,
      };
    }

    // Si la propuesta ya agotó su montoAbierto (0) pero el jugador tiene saldo y pide un monto válido (ej. el 4to con 30),
    // queda en cola FIFO a la espera de que el proponente diga "Jugue con Todos" / "Todos".
    if (prop.montoAbierto <= 0 && montoSolicitado > 0) {
      const topeJugador = Math.min(montoSolicitado, saldoAceptante.disponible);
      pendientes.push({
        propuestaId: prop.id,
        proponente: respuestaA.autor,
        aceptante: autor,
        jugada: prop.jugada,
        caballos: prop.caballos,
        montoSolicitado: topeJugador,
        montoConcretado: 0,
        montoPendiente: topeJugador,
        mensajeConcrecionId: idMsg,
        textoConcrecion: texto,
        cerrada: false,
      });
      return {
        nuevoEstado: {
          ...estado,
          saldos,
          concrecionesConfirmadas: concreciones,
          pendientesAmpliacion: pendientes,
          mensajes: [...estado.mensajes, ...mensajesGenerados],
        },
        mensajesGenerados,
      };
    }

    // Si concreta por encima de su saldo: se topa al saldo disponible del aceptante
    const porEncimaDeSaldo = saldoAceptante.disponible < montoDeseado;
    const montoEfectivo = Math.min(montoDeseado, saldoAceptante.disponible, saldoProponente.disponible);

    if (montoEfectivo <= 0) {
      const msgIa: MensajeSalaWhatsApp = {
        id: `ia-${Date.now()}-sinsaldo`,
        autor: "🤖 Agente IA",
        texto: `Solo dispone de ${formatearMonto(0)}`,
        fecha: ahoraFmt,
        esIa: true,
        respuestaA: { id: idMsg, autor, texto },
      };
      mensajesGenerados.push(msgIa);
      return {
        nuevoEstado: {
          ...estado,
          saldos,
          pendientesAmpliacion: pendientes,
          mensajes: [...estado.mensajes, ...mensajesGenerados],
        },
        mensajesGenerados,
      };
    }

    const fueRecortadoPorRemanente =
      montoSolicitado > prop.montoAbierto &&
      montoEfectivo === prop.montoAbierto &&
      !porEncimaDeSaldo;

    // Bloquear saldo comprometido para ambos hasta la liquidación de la carrera
    comprometerSaldo(saldos, autor, montoEfectivo);
    comprometerSaldo(saldos, respuestaA.autor, montoEfectivo);

    // Marcar concreción y sombrear el mensaje del usuario
    mensajeUsuario.esConcrecion = true;
    mensajeUsuario.sombrear = true;

    const idConcrecion = `conc-${Date.now()}`;
    mensajeUsuario.concrecion = {
      id: idConcrecion,
      propuestaId: prop.id,
      autorPropuesta: respuestaA.autor,
      jugadorAcepta: autor,
      jugada: prop.jugada,
      caballos: prop.caballos,
      monto: montoEfectivo,
    };

    concreciones.push({
      id: idConcrecion,
      propuestaId: prop.id,
      proponente: respuestaA.autor,
      aceptante: autor,
      jugada: prop.jugada,
      caballos: prop.caballos,
      monto: montoEfectivo,
      fecha: ahoraFmt,
    });

    if (fueRecortadoPorRemanente) {
      const topeSolicitado = Math.min(montoSolicitado, saldoAceptante.disponible);
      const faltante = Math.max(0, Math.round((topeSolicitado - montoEfectivo) * 100) / 100);
      if (faltante > 0) {
        pendientes.push({
          propuestaId: prop.id,
          proponente: respuestaA.autor,
          aceptante: autor,
          jugada: prop.jugada,
          caballos: prop.caballos,
          montoSolicitado: topeSolicitado,
          montoConcretado: montoEfectivo,
          montoPendiente: faltante,
          mensajeConcrecionId: idMsg,
          textoConcrecion: texto,
          cerrada: false,
        });
      }
    }

    // Actualizar monto abierto de la propuesta original en el historial
    if (msgPropOriginal?.propuesta) {
      msgPropOriginal.propuesta.montoAbierto = Math.max(
        0,
        Math.round((msgPropOriginal.propuesta.montoAbierto - montoEfectivo) * 100) / 100
      );
    }
    if (respuestaA.propuesta && respuestaA.propuesta !== msgPropOriginal?.propuesta) {
      respuestaA.propuesta.montoAbierto = Math.max(
        0,
        Math.round((respuestaA.propuesta.montoAbierto - montoEfectivo) * 100) / 100
      );
    }

    // Respuesta de la IA
    let textoIa = "";
    if (porEncimaDeSaldo || fueRecortadoPorRemanente) {
      const jugadorLimitador = porEncimaDeSaldo ? autor : respuestaA.autor;
      textoIa = `✅ Aquí Jugaron ⚠️Solo ${formatearMonto(montoEfectivo)} por pozo de "${jugadorLimitador}"`;
    } else {
      textoIa = "✅ Aquí Jugaron";
    }

    const msgIa: MensajeSalaWhatsApp = {
      id: `ia-${Date.now()}-exito`,
      autor: "🤖 Agente IA",
      texto: textoIa,
      fecha: ahoraFmt,
      esIa: true,
      sombrear: true,
      respuestaA: { id: idMsg, autor, texto },
    };
    mensajesGenerados.push(msgIa);

    return {
      nuevoEstado: {
        ...estado,
        saldos,
        concrecionesConfirmadas: concreciones,
        pendientesAmpliacion: pendientes,
        mensajes: [...estado.mensajes, ...mensajesGenerados],
      },
      mensajesGenerados,
    };
  }

  // =========================================================================
  // CASO B: MENSAJE NORMAL O INTENTO DE PROPUESTA
  // =========================================================================
  const evalProp = evaluarPropuestaJugada(texto);

  // Si no es un intento de jugada, el chat continúa sin interrupción de la IA
  if (!evalProp.esPropuesta) {
    return {
      nuevoEstado: {
        ...estado,
        saldos,
        mensajes: [...estado.mensajes, mensajeUsuario],
      },
      mensajesGenerados: [mensajeUsuario],
    };
  }

  // Si fue un intento de propuesta mal planteado: responder "Favor aclarar"
  if (!evalProp.ok) {
    const msgIa: MensajeSalaWhatsApp = {
      id: `ia-${Date.now()}-malprop`,
      autor: "🤖 Agente IA",
      texto: "Favor aclarar",
      fecha: ahoraFmt,
      esIa: true,
      respuestaA: { id: idMsg, autor, texto },
    };
    mensajesGenerados.push(msgIa);
    return {
      nuevoEstado: {
        ...estado,
        saldos,
        mensajes: [...estado.mensajes, ...mensajesGenerados],
      },
      mensajesGenerados,
    };
  }

  // Verificar si la carrera está cerrada
  const enMem = obtenerEstadoCarreraEnMemoria({
    hipodromo: estado.hipodromo,
    carrera: estado.carrera,
  });
  const cerrada = estado.estadoCarrera === "CERRADA" || enMem?.cerrada || esCarreraCerradaOEnPartida(estado.estadoCarrera);

  if (cerrada) {
    const msgIa: MensajeSalaWhatsApp = {
      id: `ia-${Date.now()}-cierre`,
      autor: "🤖 Agente IA",
      texto: "⛔ Esta carrera ya se encuentra cerrada. No se permiten más jugadas ni propuestas.",
      fecha: ahoraFmt,
      esIa: true,
      respuestaA: { id: idMsg, autor, texto },
    };
    mensajesGenerados.push(msgIa);
    return {
      nuevoEstado: {
        ...estado,
        saldos,
        mensajes: [...estado.mensajes, ...mensajesGenerados],
      },
      mensajesGenerados,
    };
  }

  // Verificar si el jugador propone por encima de su saldo
  const { rol, jugada, caballos, monto } = evalProp.datos;
  if (monto > saldoAutor.disponible) {
    // Regla exacta: Si un jugador propone por encima de su saldo la IA responde sobre el mensaje:
    // "Solo dispone de X monto."
    const msgIa: MensajeSalaWhatsApp = {
      id: `ia-${Date.now()}-exceso`,
      autor: "🤖 Agente IA",
      texto: `Solo dispone de ${formatearMonto(saldoAutor.disponible)}`,
      fecha: ahoraFmt,
      esIa: true,
      respuestaA: { id: idMsg, autor, texto },
    };
    mensajesGenerados.push(msgIa);
    return {
      nuevoEstado: {
        ...estado,
        saldos,
        mensajes: [...estado.mensajes, ...mensajesGenerados],
      },
      mensajesGenerados,
    };
  }

  // Propuesta válida dentro de su saldo: queda registrada y abierta para que otro responda
  mensajeUsuario.propuesta = {
    id: idMsg,
    rol,
    jugada,
    caballos,
    montoOriginal: monto,
    montoAbierto: monto,
  };

  return {
    nuevoEstado: {
      ...estado,
      saldos,
      mensajes: [...estado.mensajes, mensajeUsuario],
    },
    mensajesGenerados: [mensajeUsuario],
  };
}
