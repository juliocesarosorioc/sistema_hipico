import { supabaseAdmin } from "@/core/supabase-admin";
import {
  calcularRiesgoReal,
  evaluarConcrecionEstricta,
  analizarComandoRetiro,
  evaluarAmpliacionPropuesta,
} from "@/features/sala-juegos/lib/parser-pedagogico";
import { formatearMontoRegional } from "@/shared/lib/dinero";
import { sincronizarTicketsPropuestaATaquilla } from "@/features/whatsapp-sala/lib/sincronizar-tickets-sala";
import {
  formatearModalidadMensaje,
  limpiarEtiquetasProhibidas,
} from "@/features/sala-juegos/lib/modalidades-progresivas";
import {
  cargarPlantillasGrupo,
  obtenerPlantillaGrupo,
} from "@/features/whatsapp/lib/plantillas-grupo-server";
import { variablesEncabezadoGrupo } from "@/features/whatsapp/lib/plantillas-grupo";
import { mensajeJugaronPorSaldoParcial } from "@/features/whatsapp/lib/mensajes-concrecion";
import { asegurarCarreraActivaSala } from "./resolverSala";
import { resolverTelefonoWhatsappCliente } from "./resolverCliente";
import { calcularMaximosBilateral, detallePublicoPropuesta } from "./validarSaldo";
import { emitirBroadcastSala, enviarNotificacionesPrivadasDaemon } from "./notificador";
import type { ContextoSala, ClienteResuelto, ResultadoConcrecion } from "./types";

// Mutex FIFO en memoria por propuesta para garantizar ejecución secuencial (1 a la vez: Caso 90 + 10 = 100)
export const colasConcrecionFifo = new Map<string, Promise<any>>();

export function encolarConcrecionSecuencial<T>(propuestaId: string, tarea: () => Promise<T>): Promise<T> {
  const previa = colasConcrecionFifo.get(propuestaId) || Promise.resolve();
  const actual = previa.then(tarea, tarea);
  colasConcrecionFifo.set(
    propuestaId,
    actual.then(
      () => {},
      () => {}
    )
  );
  return actual;
}

export function mensajeJugaronPorPozo(prop: any, monto: number, limitador: string): string {
  return `✅ Jugaron ${detallePublicoPropuesta(prop)} con ${formatearMontoRegional(monto)} por Pozo de ${limitador}`;
}

export async function construirMensajeSaldoParcial(params: {
  sala: any;
  juega: string;
  da: string;
  monto: number;
  saldoDe: string;
  detalle?: string;
}): Promise<string> {
  const { sala, juega, da, monto, saldoDe, detalle } = params;
  const mapa = await cargarPlantillasGrupo(sala?.grupo_id);
  return obtenerPlantillaGrupo(
    mapa,
    "concrecion_saldo_parcial",
    {
      ...variablesEncabezadoGrupo(sala, "concrecion"),
      juega,
      da,
      monto: formatearMontoRegional(monto),
      saldo_de: saldoDe,
      detalle: detalle || "",
    },
    mensajeJugaronPorSaldoParcial({ juega, da, monto, saldoDe, detalle })
  );
}

export function mensajeJugaronCompleto(
  nombreJuega: string,
  detalle: string,
  nombreDa: string,
  monto: number
): string {
  return limpiarEtiquetasProhibidas(
    `✅ Jugaron: *${nombreJuega} Juega ${detalle} da ${nombreDa} $${formatearMontoRegional(monto)}*`
  );
}

export function limitadorPorPozo(
  montoSolicitado: number,
  montoEfectivo: number,
  disponibleProponente: number,
  disponibleAceptante: number,
  nombreProponente: string,
  nombreAceptante: string
): string | null {
  if (montoEfectivo <= 0 || montoEfectivo >= montoSolicitado) return null;
  return disponibleProponente <= disponibleAceptante ? nombreProponente : nombreAceptante;
}

export async function ejecutarAmpliacionCupo(params: {
  contextoSala: ContextoSala;
  cliente: ClienteResuelto;
  quotedPropuestaId: string | null;
  nuevoTope: number | null;
  whatsappMsgId?: string | null;
  groupJid?: string | null;
  whatsappGroupNombre?: string | null;
}): Promise<ResultadoConcrecion> {
  const {
    contextoSala,
    cliente,
    quotedPropuestaId,
    nuevoTope,
    whatsappMsgId,
    groupJid,
    whatsappGroupNombre,
  } = params;

  const { data: dataAmp, error: errAmp } = await supabaseAdmin.rpc(
    "ampliar_cupo_propuesta_fifo_atomica",
    {
      p_grupo_id: contextoSala.grupoId,
      p_sala_id: contextoSala.salaId,
      p_proponente_id: cliente.id,
      p_propuesta_msg_id: quotedPropuestaId || null,
      p_nuevo_tope_total: nuevoTope,
    }
  );

  if (errAmp || !dataAmp || (dataAmp as any).ok === false) {
    const msgErrPublico =
      (dataAmp as any)?.msg_publico ||
      (dataAmp as any)?.msg_publico_bot ||
      (dataAmp as any)?.respuestaPublica ||
      null;
    const msgErrPrivado =
      (dataAmp as any)?.msg_privado_proponente ||
      (dataAmp as any)?.msg_privado_bot ||
      (dataAmp as any)?.alertaPrivada ||
      (dataAmp as any)?.error ||
      (dataAmp as any)?.motivo ||
      errAmp?.message ||
      "No se pudo ampliar el cupo de la propuesta.";

    return {
      ok: false,
      tipo: "AMPLIACION_ERROR",
      respuestaGrupo: msgErrPublico,
      msg_publico: msgErrPublico,
      msg_publico_bot: msgErrPublico,
      respuestaPublica: msgErrPublico,
      mensajePrivadoAutor: msgErrPrivado,
      msg_privado_bot: (dataAmp as any)?.msg_privado_bot || msgErrPrivado,
      msg_privado_proponente: (dataAmp as any)?.msg_privado_proponente || msgErrPrivado,
      alertaPrivada: (dataAmp as any)?.alertaPrivada || null,
      notificaciones_privadas: (dataAmp as any)?.notificaciones_privadas || [],
      senderJid: cliente.whatsapp_jid || undefined,
    };
  }

  const msgPublico: string | null =
    (dataAmp as any).msg_publico ||
    (dataAmp as any).msg_publico_bot ||
    (dataAmp as any).respuestaPublica ||
    null;

  if (msgPublico) {
    await supabaseAdmin.from("chat_mensajes").insert({
      grupo_id: contextoSala.grupoId,
      sala_id: contextoSala.salaId,
      remitente_nombre: "🤖 ASISTENTE DE SALA",
      es_operador: true,
      tipo_mensaje: "concrecion_fifo",
      contenido: msgPublico,
      whatsapp_msg_id: whatsappMsgId || null,
      whatsapp_group_jid: groupJid || null,
      whatsapp_group_nombre: whatsappGroupNombre || null,
      origen_canal: "WHATSAPP",
    });
    await emitirBroadcastSala(contextoSala.salaId, "nuevo_mensaje", { salaId: contextoSala.salaId });
  }

  const notificaciones: any[] = Array.isArray((dataAmp as any).notificaciones_privadas)
    ? (dataAmp as any).notificaciones_privadas
    : [];

  await enviarNotificacionesPrivadasDaemon(notificaciones);

  const msgPrivadoProponente =
    (dataAmp as any).msg_privado_proponente ||
    (dataAmp as any).msg_privado_bot ||
    (dataAmp as any).alertaPrivada ||
    null;

  return {
    ok: true,
    tipo: "AMPLIACION_CUPO",
    respuestaGrupo: msgPublico,
    msg_publico: msgPublico,
    msg_publico_bot: (dataAmp as any).msg_publico_bot || msgPublico,
    respuestaPublica: (dataAmp as any).respuestaPublica || msgPublico,
    mensajePrivadoAutor: msgPrivadoProponente,
    msg_privado_bot: (dataAmp as any).msg_privado_bot || msgPrivadoProponente,
    msg_privado_proponente: msgPrivadoProponente,
    alertaPrivada: (dataAmp as any).alertaPrivada || null,
    notificaciones_privadas: notificaciones,
    senderJid: cliente.whatsapp_jid || undefined,
    datos: dataAmp,
  };
}

export async function concretarJugada(params: {
  contextoSala: ContextoSala;
  cliente: ClienteResuelto;
  texto: string;
  quotedMsgId?: string | null;
  whatsappMsgId?: string | null;
  groupJid?: string | null;
  whatsappGroupNombre?: string | null;
  participantJid?: string | null;
  body?: any;
}): Promise<ResultadoConcrecion> {
  const {
    contextoSala,
    cliente,
    texto,
    quotedMsgId,
    whatsappMsgId,
    groupJid,
    whatsappGroupNombre,
    participantJid,
  } = params;

  if (!quotedMsgId) {
    const comandoRetiro = analizarComandoRetiro(texto);
    if (comandoRetiro.esComandoRetiro) {
      if (!comandoRetiro.esValido) {
        return {
          ok: false,
          tipo: "PEDAGOGICO",
          respuestaGrupo: null,
          mensajePrivadoAutor:
            comandoRetiro.mensajeAclaratoria ||
            "Por favor aclara si deseas retirar tus jugadas con: 'Se fue' o 'sf'",
        };
      }

      const { data: rpcSeFue, error: errSeFue } = await supabaseAdmin.rpc(
        "cerrar_propuestas_se_fue_atomica",
        {
          p_grupo_id: contextoSala.grupoId,
          p_sala_id: contextoSala.salaId,
          p_jugador_id: cliente.id,
          p_propuesta_id: null,
        }
      );

      if (errSeFue || rpcSeFue?.ok === false) {
        return {
          ok: false,
          tipo: "ERROR_RETIRO",
          respuestaGrupo: rpcSeFue?.msg_publico_bot || null,
          msg_publico_bot: rpcSeFue?.msg_publico_bot || null,
          msg_privado_bot: rpcSeFue?.msg_privado_bot || null,
          clienteTelefono: resolverTelefonoWhatsappCliente(cliente.rawCliente),
          error: errSeFue?.message || rpcSeFue?.error || "No se pudieron retirar las propuestas",
        };
      }

      const liberado = Number(rpcSeFue?.monto_liberado ?? 0);
      const msgPublicoRetiro =
        rpcSeFue?.msg_publico_bot ||
        `🚫 *Se Fue* — Todas las propuestas abiertas de ${cliente.nombreJugador} fueron retiradas.`;
      const msgPrivadoRetiro =
        rpcSeFue?.msg_privado_bot ||
        `✅ Todas tus propuestas abiertas fueron retiradas ("Se fue"). Saldo liberado: $${formatearMontoRegional(liberado)}.`;

      await emitirBroadcastSala(contextoSala.salaId, "nuevo_mensaje", { salaId: contextoSala.salaId });

      return {
        ok: true,
        tipo: "RETIRO_PROPUESTAS",
        respuestaGrupo: msgPublicoRetiro,
        msg_publico: msgPublicoRetiro,
        msg_publico_bot: msgPublicoRetiro,
        respuestaPublica: msgPublicoRetiro,
        msg_privado_bot: msgPrivadoRetiro,
        mensajePrivadoAutor: msgPrivadoRetiro,
        clienteTelefono: resolverTelefonoWhatsappCliente(cliente.rawCliente),
        senderJid: participantJid,
      };
    }

    return {
      ok: false,
      tipo: "IGNORADO",
      respuestaGrupo: null,
      mensajePrivadoAutor: null,
    };
  }

  const esUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(quotedMsgId);
  let queryProp = supabaseAdmin
    .from("chat_mensajes")
    .select("*")
    .eq("sala_id", contextoSala.salaId);

  if (esUuid) {
    queryProp = queryProp.or(`whatsapp_msg_id.eq.${quotedMsgId},id.eq.${quotedMsgId}`);
  } else {
    queryProp = queryProp.eq("whatsapp_msg_id", quotedMsgId);
  }

  const { data: propMsg, error: errProp } = await queryProp.limit(1).maybeSingle();

  if (
    !propMsg ||
    (propMsg.tipo_mensaje !== "propuesta_jugada" && propMsg.tipo_mensaje !== "PROPUESTA")
  ) {
    return {
      ok: false,
      tipo: "IGNORADO",
      respuestaGrupo: null,
      mensajePrivadoAutor: null,
    };
  }

  if (!contextoSala.carreraAbierta) {
    return {
      ok: false,
      tipo: "CARRERA_CERRADA",
      respuestaGrupo: `⛔ La carrera se encuentra ${String(contextoSala.sala.estado_carrera || "CERRADA").toUpperCase()}. No se admiten concreciones.`,
      mensajePrivadoAutor: null,
    };
  }

  // 1. Comando de retiro de propuesta citada por su autor ("Se Fue")
  const cmdRetiroCita = analizarComandoRetiro(texto);
  if (cmdRetiroCita.esComandoRetiro) {
    if (!cmdRetiroCita.esValido) {
      return {
        ok: false,
        tipo: "PEDAGOGICO",
        respuestaGrupo: null,
        mensajePrivadoAutor:
          cmdRetiroCita.mensajeAclaratoria ||
          "Por favor aclara si deseas retirar tu propuesta con: 'Se fue' o 'sf'",
      };
    }

    if (propMsg.remitente_id !== cliente.id) {
      return {
        ok: false,
        tipo: "NO_AUTORIZADO",
        respuestaGrupo: null,
        mensajePrivadoAutor: "⚠️ Solo el autor de la propuesta puede retirarla con 'Se fue'.",
      };
    }

    const { data: rpcSeFue, error: errSeFue } = await supabaseAdmin.rpc(
      "cerrar_propuestas_se_fue_atomica",
      {
        p_grupo_id: contextoSala.grupoId,
        p_sala_id: contextoSala.salaId,
        p_jugador_id: cliente.id,
        p_propuesta_id: propMsg.id,
      }
    );

    if (errSeFue || rpcSeFue?.ok === false) {
      return {
        ok: false,
        tipo: "ERROR_RETIRO",
        respuestaGrupo: rpcSeFue?.msg_publico_bot || null,
        msg_publico_bot: rpcSeFue?.msg_publico_bot || null,
        msg_privado_bot: rpcSeFue?.msg_privado_bot || null,
        clienteTelefono: resolverTelefonoWhatsappCliente(cliente.rawCliente),
        error: errSeFue?.message || rpcSeFue?.error || "No se pudo retirar la propuesta",
      };
    }

    const remanenteRetirar = Number(
      rpcSeFue?.monto_liberado ?? propMsg.monto_disponible ?? propMsg.monto_original ?? 0
    );
    const jugadaTexto = propMsg.jugada_estandarizada || propMsg.contenido || "propuesta";
    const msgRetiroCita =
      rpcSeFue?.msg_publico_bot ||
      `🚫 *Se Fue* — ${cliente.nombreJugador} retiró su propuesta (${jugadaTexto}).`;
    const msgPrivadoCita =
      rpcSeFue?.msg_privado_bot ||
      `✅ Tu propuesta (${jugadaTexto}) fue retirada ("Se fue"). Saldo liberado: $${formatearMontoRegional(remanenteRetirar)}.`;

    await emitirBroadcastSala(contextoSala.salaId, "nuevo_mensaje", { salaId: contextoSala.salaId });

    return {
      ok: true,
      tipo: "RETIRO_PROPUESTA_ESPECIFICA",
      respuestaGrupo: msgRetiroCita,
      msg_publico: msgRetiroCita,
      msg_publico_bot: msgRetiroCita,
      respuestaPublica: msgRetiroCita,
      msg_privado_bot: msgPrivadoCita,
      mensajePrivadoAutor: msgPrivadoCita,
      clienteTelefono: resolverTelefonoWhatsappCliente(cliente.rawCliente),
      senderJid: participantJid,
    };
  }

  // 2. Auto-concreción o ampliación
  if (propMsg.remitente_id === cliente.id) {
    const amp = evaluarAmpliacionPropuesta(texto);
    if (amp.esAmpliacion) {
      return await ejecutarAmpliacionCupo({
        contextoSala,
        cliente,
        quotedPropuestaId: propMsg.id,
        nuevoTope: amp.nuevoTope,
        whatsappMsgId,
        groupJid,
        whatsappGroupNombre,
      });
    }
    return {
      ok: false,
      tipo: "AUTO_CONCRECION",
      respuestaGrupo: null,
      mensajePrivadoAutor: "⚠️ No puedes concretar tu propia propuesta de jugada.",
    };
  }

  // 3. Ejecutar secuencialmente (1 a la vez por propuesta, Caso 90 + 10 = 100)
  return await encolarConcrecionSecuencial(propMsg.id, async () => {
    const { data: propFresca } = await supabaseAdmin
      .from("chat_mensajes")
      .select("*")
      .eq("id", propMsg.id)
      .single();

    const remanenteDisponible = Number(
      propFresca?.monto_disponible ?? propFresca?.monto_original ?? 0
    );
    const estadoProp = String(propFresca?.estado_propuesta || "abierta").toLowerCase();

    // Vencimiento por Tiempo (X minutos): Si superó el tiempo, expirada + devolver saldo retenido
    const tiempoVencimientoMin = contextoSala.tiempoVencimientoMin;
    const fechaPropMs = propFresca?.created_at ? new Date(propFresca.created_at).getTime() : Date.now();
    const minutosTranscurridos = (Date.now() - fechaPropMs) / (1000 * 60);

    if (minutosTranscurridos > tiempoVencimientoMin && estadoProp !== "expirada") {
      await supabaseAdmin
        .from("chat_mensajes")
        .update({ estado_propuesta: "expirada", monto_disponible: 0 })
        .eq("id", propFresca.id);

      if (remanenteDisponible > 0) {
        const { data: propOwner } = await supabaseAdmin
          .from("clientes")
          .select("id, saldo_retenido, saldo_actual, aval, libre")
          .eq("id", propFresca.remitente_id)
          .maybeSingle();

        if (propOwner && !propOwner.libre) {
          const nuevoRet = Math.max(
            0,
            Number((Number(propOwner.saldo_retenido || 0) - remanenteDisponible).toFixed(2))
          );
          await supabaseAdmin
            .from("clientes")
            .update({
              saldo_retenido: nuevoRet,
              saldo_disponible: Math.max(
                0,
                Number(
                  (
                    Number(propOwner.saldo_actual || 0) +
                    Number(propOwner.aval || 0) -
                    nuevoRet
                  ).toFixed(2)
                )
              ),
            })
            .eq("id", propOwner.id);
        }
      }

      const msgFueraTiempo = "❌⏰ Nada aquí, fuera de tiempo";
      await supabaseAdmin.from("chat_mensajes").insert({
        grupo_id: contextoSala.grupoId,
        sala_id: contextoSala.salaId,
        remitente_nombre: "🤖 ASISTENTE DE SALA",
        es_operador: true,
        tipo_mensaje: "concrecion_fifo",
        contenido: msgFueraTiempo,
        whatsapp_msg_id: whatsappMsgId || null,
        whatsapp_group_jid: groupJid || null,
        whatsapp_group_nombre: whatsappGroupNombre || null,
        origen_canal: "WHATSAPP",
      });

      await emitirBroadcastSala(contextoSala.salaId, "nuevo_mensaje", { salaId: contextoSala.salaId });

      return {
        ok: false,
        tipo: "FUERA_DE_TIEMPO",
        nada_aqui: true,
        respuestaGrupo: msgFueraTiempo,
        msg_publico: msgFueraTiempo,
        msg_publico_bot: msgFueraTiempo,
        respuestaPublica: msgFueraTiempo,
        mensajePrivadoAutor: "Esta propuesta superó el tiempo máximo de vigencia y ha expirado.",
        senderJid: participantJid,
      };
    }

    if (
      remanenteDisponible <= 0 ||
      (estadoProp !== "abierta" && estadoProp !== "parcial")
    ) {
      return {
        ok: false,
        tipo: "PROPUESTA_AGOTADA",
        respuestaGrupo: `⚠️ Esta parada ya fue tomada al 100% o no tiene saldo disponible.`,
        mensajePrivadoAutor: null,
      };
    }

    // Recalcular saldo fresco de ambos jugadores dentro del candado FIFO
    const { data: aceptanteFresco } = await supabaseAdmin
      .from("clientes")
      .select(
        "id, nombre, seudonimo, saldo_actual, saldo_retenido, libre, aval, whatsapp_jid, telefono, saldo_disponible"
      )
      .eq("id", cliente.id)
      .single();

    const { data: proponenteRow } = await supabaseAdmin
      .from("clientes")
      .select(
        "id, nombre, seudonimo, saldo_actual, saldo_retenido, libre, aval, whatsapp_jid, telefono, telefono_normalizado, saldo_disponible"
      )
      .eq("id", propFresca.remitente_id)
      .maybeSingle();

    const accionProp: "JUEGA" | "CONSIGUE" =
      String(propFresca.accion_proponente || "").toUpperCase() === "CONSIGUE" ||
      /^(consigo|doy)\b/i.test(String(propFresca.contenido || ""))
        ? "CONSIGUE"
        : "JUEGA";

    const { maxBaseAceptante, maxBaseProponente, saldoDispAceptante, saldoDispProponente } =
      calcularMaximosBilateral({
        remanenteDisponible,
        propFresca,
        proponenteRow,
        aceptanteRow: aceptanteFresco || cliente.rawCliente,
      });

    if (maxBaseAceptante <= 0) {
      const saldoFmt = formatearMontoRegional(Math.max(0, saldoDispAceptante));
      return {
        ok: false,
        tipo: "SIN_SALDO",
        respuestaGrupo: `⚠️ *${cliente.nombreJugador}* dispone de $${saldoFmt}`,
        msg_publico: `⚠️ *${cliente.nombreJugador}* dispone de $${saldoFmt}`,
        msg_publico_bot: `⚠️ *${cliente.nombreJugador}* dispone de $${saldoFmt}`,
        respuestaPublica: `⚠️ *${cliente.nombreJugador}* dispone de $${saldoFmt}`,
        mensajePrivadoAutor: `⚠️ Nos agrada tenerlo en el grupo, por favor no exceda su saldo, ajuste el monto de sus jugadas. Muchas gracias.`,
        msg_privado_bot: `⚠️ Nos agrada tenerlo en el grupo, por favor no exceda su saldo, ajuste el monto de sus jugadas. Muchas gracias.`,
        clienteTelefono: resolverTelefonoWhatsappCliente(cliente.rawCliente),
        senderJid: participantJid,
      };
    }

    if (maxBaseProponente <= 0) {
      const nomProp =
        proponenteRow?.seudonimo ||
        proponenteRow?.nombre ||
        propFresca.remitente_nombre ||
        "Proponente";
      const saldoPropFmt = formatearMontoRegional(Math.max(0, saldoDispProponente));
      await supabaseAdmin
        .from("chat_mensajes")
        .update({ estado_propuesta: "cerrada", monto_disponible: 0 })
        .eq("id", propFresca.id);
      return {
        ok: false,
        tipo: "SIN_SALDO_PROPONENTE",
        respuestaGrupo: `⚠️ *${nomProp}* ya no dispone de saldo suficiente ($${saldoPropFmt}). Propuesta cerrada.`,
        msg_publico: `⚠️ *${nomProp}* ya no dispone de saldo suficiente ($${saldoPropFmt}). Propuesta cerrada.`,
        msg_publico_bot: `⚠️ *${nomProp}* ya no dispone de saldo suficiente ($${saldoPropFmt}). Propuesta cerrada.`,
        senderJid: participantJid,
      };
    }

    // Evaluar palabras estrictas según diccionario direccional
    const evalConcrecion = evaluarConcrecionEstricta(
      texto,
      accionProp,
      remanenteDisponible,
      Math.max(0, Math.min(maxBaseAceptante, maxBaseProponente)),
      cliente.nombreJugador,
      undefined,
      contextoSala.codigoSala
    );

    if (!evalConcrecion.valido) {
      if (saldoDispAceptante <= 0 && evalConcrecion.montoSolicitado > 0) {
        const saldoFmt = formatearMontoRegional(Math.max(0, saldoDispAceptante));
        return {
          ok: false,
          tipo: "SIN_SALDO",
          respuestaGrupo: `⚠️ *${cliente.nombreJugador}* dispone de $${saldoFmt}`,
          msg_publico: `⚠️ *${cliente.nombreJugador}* dispone de $${saldoFmt}`,
          msg_publico_bot: `⚠️ *${cliente.nombreJugador}* dispone de $${saldoFmt}`,
          respuestaPublica: `⚠️ *${cliente.nombreJugador}* dispone de $${saldoFmt}`,
          mensajePrivadoAutor: `⚠️ Nos agrada tenerlo en el grupo, por favor no exceda su saldo, ajuste el monto de sus jugadas. Muchas gracias.`,
          msg_privado_bot: `⚠️ Nos agrada tenerlo en el grupo, por favor no exceda su saldo, ajuste el monto de sus jugadas. Muchas gracias.`,
          clienteTelefono: resolverTelefonoWhatsappCliente(cliente.rawCliente),
          senderJid: participantJid,
        };
      }

      return {
        ok: false,
        tipo: "PEDAGOGICO",
        respuestaGrupo: null,
        mensajePrivadoAutor:
          evalConcrecion.motivoRechazo || "Palabra no autorizada para concretar esta jugada.",
      };
    }

    // Validación de Apuesta Mínima
    const apuestaMinima = contextoSala.apuestaMinima;
    if (evalConcrecion.montoSolicitado < apuestaMinima && remanenteDisponible >= apuestaMinima) {
      const msgMinimoBot = `⛔ *Nada aquí* — El monto mínimo de apuesta es $${apuestaMinima.toFixed(2)}`;
      await supabaseAdmin.from("chat_mensajes").insert({
        grupo_id: contextoSala.grupoId,
        sala_id: contextoSala.salaId,
        remitente_nombre: "🤖 ASISTENTE DE SALA",
        es_operador: true,
        tipo_mensaje: "concrecion_fifo",
        contenido: msgMinimoBot,
        whatsapp_msg_id: whatsappMsgId || null,
        whatsapp_group_jid: groupJid || null,
        whatsapp_group_nombre: whatsappGroupNombre || null,
        origen_canal: "WHATSAPP",
      });
      await emitirBroadcastSala(contextoSala.salaId, "nuevo_mensaje", { salaId: contextoSala.salaId });
      return {
        ok: false,
        tipo: "APUESTA_MINIMA",
        nada_aqui: true,
        respuestaGrupo: msgMinimoBot,
        msg_publico: msgMinimoBot,
        msg_publico_bot: msgMinimoBot,
        respuestaPublica: msgMinimoBot,
        mensajePrivadoAutor: `El monto mínimo de apuesta configurado es $${apuestaMinima.toFixed(2)}.`,
        senderJid: participantJid,
      };
    }

    const llenoRemanenteParcial =
      remanenteDisponible < Number(propFresca.monto_original || remanenteDisponible) ||
      evalConcrecion.montoSolicitado > remanenteDisponible;

    const montoEfectivo = evalConcrecion.montoEfectivo;
    const nuevoRemanente = Math.max(
      0,
      Number((remanenteDisponible - montoEfectivo).toFixed(2))
    );

    // Ejecutar RPC oficial `concretar_jugada_fifo_atomica`
    let rpcExitoso = false;
    let resRpcData: any = null;
    let errorConcretar: any = null;

    // Protección contra carrera_activa_id nulo
    const estadoCarreraActual = String(
      contextoSala.sala?.estado_carrera || (contextoSala.carreraAbierta ? "abierta" : "")
    ).toLowerCase();

    if (estadoCarreraActual === "abierta" && !contextoSala.sala?.carrera_activa_id) {
      let carreraId = await asegurarCarreraActivaSala(contextoSala.sala);
      if (!carreraId) {
        const hipodromo = contextoSala.sala?.hipodromo_activo || "LA RINCONADA";
        const { data: ultCarrera } = await supabaseAdmin
          .from("carreras")
          .select("id")
          .ilike("hipodromo", hipodromo)
          .ilike("estado", "abierta")
          .order("fecha", { ascending: false })
          .order("carrera", { ascending: false })
          .limit(1)
          .maybeSingle();

        const cid = ultCarrera?.id ? String(ultCarrera.id) : null;
        if (cid) {
          carreraId = cid;
          await supabaseAdmin
            .from("salas_juego")
            .update({ carrera_activa_id: cid, updated_at: new Date().toISOString() })
            .eq("id", contextoSala.salaId);
          if (contextoSala.sala) contextoSala.sala.carrera_activa_id = cid;
          contextoSala.carreraActivaId = cid;
        }
      } else {
        contextoSala.carreraActivaId = carreraId;
      }
    }

    try {
      const { data: resRpc, error: errRpc } = await supabaseAdmin.rpc(
        "concretar_jugada_fifo_atomica",
        {
          p_grupo_id: contextoSala.grupoId,
          p_sala_id: contextoSala.salaId,
          p_propuesta_msg_id: propFresca.id,
          p_aceptante_id: cliente.id,
          p_monto_pedido: montoEfectivo,
        }
      );
      resRpcData = resRpc;
      if (errRpc || (resRpc as any)?.ok === false) {
        console.error("[RPC_CONCRETAR_ERR]", {
          errRpc,
          resRpc,
          p_grupo_id: contextoSala.grupoId,
          p_sala_id: contextoSala.salaId,
          p_propuesta_msg_id: propFresca.id,
          p_aceptante_id: cliente.id,
          p_monto_pedido: montoEfectivo,
        });
      }
      if (errRpc) errorConcretar = errRpc;
      if (!errRpc && resRpc && (resRpc as any).ok === false && (resRpc as any).nada_aqui !== true) {
        errorConcretar = resRpc;
      }
      if (!errRpc && resRpc && (resRpc as any).nada_aqui === true) {
        const msgPublicoNadaAqui =
          (resRpc as any).msg_publico ||
          (resRpc as any).msg_publico_bot ||
          (resRpc as any).respuestaPublica ||
          "*Nada Aquí*";
        await supabaseAdmin.from("chat_mensajes").insert({
          grupo_id: contextoSala.grupoId,
          sala_id: contextoSala.salaId,
          remitente_nombre: "🤖 ASISTENTE DE SALA",
          es_operador: true,
          tipo_mensaje: "concrecion_fifo",
          contenido: msgPublicoNadaAqui,
          whatsapp_msg_id: whatsappMsgId || null,
          whatsapp_group_jid: groupJid || null,
          whatsapp_group_nombre: whatsappGroupNombre || null,
          origen_canal: "WHATSAPP",
        });
        await emitirBroadcastSala(contextoSala.salaId, "nuevo_mensaje", { salaId: contextoSala.salaId });
        return {
          ok: false,
          tipo: "NADA_AQUI",
          nada_aqui: true,
          respuestaGrupo: msgPublicoNadaAqui,
          msg_publico: msgPublicoNadaAqui,
          msg_publico_bot: (resRpc as any).msg_publico_bot || msgPublicoNadaAqui,
          respuestaPublica: (resRpc as any).respuestaPublica || msgPublicoNadaAqui,
          mensajePrivadoAutor:
            (resRpc as any).msg_privado_aceptante ||
            (resRpc as any).msg_privado_bot ||
            (resRpc as any).alertaPrivada ||
            null,
          msg_privado_bot: (resRpc as any).msg_privado_bot || null,
          msg_privado_aceptante: (resRpc as any).msg_privado_aceptante || null,
          alertaPrivada: (resRpc as any).alertaPrivada || null,
          notificaciones_privadas: (resRpc as any).notificaciones_privadas || [],
          senderJid: participantJid,
        };
      }
      if (!errRpc && resRpc && (resRpc as any).ok !== false) {
        rpcExitoso = true;
      }
    } catch (exRpc) {
      console.error("[RPC_CONCRETAR_CATCH]", exRpc);
      errorConcretar = exRpc;
      rpcExitoso = false;
    }

    // Fallback si el RPC no fue exitoso
    if (!rpcExitoso) {
      const error = errorConcretar ?? "RPC concretar_jugada_fifo_atomica sin ok=true";
      console.error("[CONCRETAR_ERROR]", error);
      const msgErrPub =
        (resRpcData as any)?.msg_publico ||
        (resRpcData as any)?.msg_publico_bot ||
        (resRpcData as any)?.respuestaPublica ||
        "🚫 *Error al concretar jugada* — Intente nuevamente.";
      const msgErrPriv =
        (resRpcData as any)?.msg_privado_aceptante ||
        (resRpcData as any)?.msg_privado_bot ||
        (resRpcData as any)?.alertaPrivada ||
        "La concreción no pudo ser procesada por el motor atómico.";
      return {
        ok: false,
        tipo: "CONCRECION_ERROR",
        respuestaGrupo: msgErrPub,
        msg_publico: msgErrPub,
        msg_publico_bot: (resRpcData as any)?.msg_publico_bot || msgErrPub,
        respuestaPublica: (resRpcData as any)?.respuestaPublica || msgErrPub,
        mensajePrivadoAutor: msgErrPriv,
        msg_privado_bot: (resRpcData as any)?.msg_privado_bot || msgErrPriv,
        msg_privado_aceptante: (resRpcData as any)?.msg_privado_aceptante || msgErrPriv,
        alertaPrivada: (resRpcData as any)?.alertaPrivada || null,
        notificaciones_privadas: (resRpcData as any)?.notificaciones_privadas || [],
        senderJid: participantJid,
      };
    }

    await sincronizarTicketsPropuestaATaquilla(supabaseAdmin, {
      propuestaMsgId: propFresca.id,
      sala: contextoSala.sala,
      grupoId: contextoSala.grupoId,
      condicionProponente: propFresca.condicion_proponente,
    });

    const esConsigueProp =
      accionProp === "CONSIGUE" ||
      /^(consigo|doy)\b/i.test(String(propFresca.contenido || ""));

    let nombreJuega = "";
    let nombreDa = "";
    if (esConsigueProp) {
      nombreDa = propFresca.remitente_nombre || "Proponente";
      nombreJuega = cliente.nombreJugador;
    } else {
      nombreJuega = propFresca.remitente_nombre || "Proponente";
      nombreDa = cliente.nombreJugador;
    }

    // Modalidad / Caballos y Proporción
    let detalleJugada = "";
    const propRaw = String(propFresca.proporcion_premio || propFresca.proporcion || "1x1").trim();
    if (propFresca.es_match) {
      const bA = Array.isArray(propFresca.caballos_bando_a)
        ? propFresca.caballos_bando_a.join("-")
        : String(propFresca.caballos_bando_a || "");
      const bB = Array.isArray(propFresca.caballos_bando_b)
        ? propFresca.caballos_bando_b.join("-")
        : String(propFresca.caballos_bando_b || "");
      let propTexto = "";
      const propParaMostrar = limpiarEtiquetasProhibidas(propRaw);
      if (propParaMostrar && !["1x1", "pp"].includes(propParaMostrar.toLowerCase())) {
        propTexto = ` ${propParaMostrar.replace("@", "/").replace(/a/i, "/")}`;
      }
      detalleJugada = `(${bA}x${bB})${propTexto}`;
    } else {
      const mod = propFresca.modalidad_propuesta || propFresca.modalidad || "";
      const ej =
        propFresca.ejemplar_texto ||
        (Array.isArray(propFresca.caballos_bando_a) ? propFresca.caballos_bando_a.join("-") : "") ||
        "";
      detalleJugada = `${mod} ${ej}`.trim() || propFresca.jugada_estandarizada || "JUGADA";
    }

    const riesgoProponente = calcularRiesgoReal(montoEfectivo, propRaw, accionProp, "PROPONENTE");
    const riesgoAceptante = calcularRiesgoReal(montoEfectivo, propRaw, accionProp, "ACEPTANTE");
    const riesgoJuega = esConsigueProp ? riesgoAceptante : riesgoProponente;
    const riesgoDa = esConsigueProp ? riesgoProponente : riesgoAceptante;

    const montoBaseFmt = formatearMontoRegional(montoEfectivo);
    const riesgoJuegaFmt = formatearMontoRegional(riesgoJuega);
    const riesgoDaFmt = formatearMontoRegional(riesgoDa);

    const montoSolicitadoTotal = Math.min(
      Number(evalConcrecion.montoSolicitado || montoEfectivo),
      remanenteDisponible
    );
    const pozoLimitadorBilateral =
      montoEfectivo > 0 && montoEfectivo < montoSolicitadoTotal
        ? maxBaseProponente <= maxBaseAceptante
          ? proponenteRow?.seudonimo || proponenteRow?.nombre || propFresca.remitente_nombre || "Proponente"
          : cliente.nombreJugador
        : limitadorPorPozo(
            Number(evalConcrecion.montoSolicitado || montoEfectivo),
            Number(montoEfectivo || 0),
            Number(remanenteDisponible || 0),
            Number(maxBaseAceptante || 0),
            propFresca.remitente_nombre || "Proponente",
            cliente.nombreJugador
          );

    const montoSolicitadoReal = Number(evalConcrecion.montoSolicitado || montoEfectivo);
    const esConcrecionSaldoParcial =
      llenoRemanenteParcial && montoEfectivo > 0 && montoEfectivo < montoSolicitadoReal;
    const nombreLimitador =
      pozoLimitadorBilateral ||
      (maxBaseAceptante <= maxBaseProponente ? nombreDa : nombreJuega);

    const msgPublicoFinal = esConcrecionSaldoParcial
      ? await construirMensajeSaldoParcial({
          sala: contextoSala.sala,
          juega: nombreJuega,
          da: nombreDa,
          monto: montoEfectivo,
          saldoDe: nombreLimitador,
        })
      : pozoLimitadorBilateral
      ? mensajeJugaronPorPozo(propFresca, montoEfectivo, pozoLimitadorBilateral)
      : mensajeJugaronCompleto(nombreJuega, detalleJugada, nombreDa, montoEfectivo);

    const msgPrivAceptante = evalConcrecion.excedioSaldo
      ? `⚠️ Nos agrada tenerlo en el grupo, por favor no exceda su saldo, ajuste el monto de sus jugadas. Usted dispone de $${formatearMontoRegional(evalConcrecion.montoEfectivo)}. Muchas gracias.`
      : `✅ *Confirmación de Jugada*:\n` +
        `Pactaste con *${propFresca.remitente_nombre}* en *${detalleJugada}* por *$${montoBaseFmt}*.\n` +
        `Tu rol: *${cliente.nombreJugador === nombreJuega ? "Juega" : "Da"}* (Riesgo: $${cliente.nombreJugador === nombreJuega ? riesgoJuegaFmt : riesgoDaFmt}).`;

    const msgPrivProponente =
      `🔔 *Confirmación de Jugada*:\n` +
      `*${cliente.nombreJugador}* aceptó tu jugada en *${detalleJugada}* por *$${montoBaseFmt}*.\n` +
      `Tu rol: *${propFresca.remitente_nombre === nombreJuega ? "Juega" : "Da"}* (Riesgo: $${propFresca.remitente_nombre === nombreJuega ? riesgoJuegaFmt : riesgoDaFmt}).` +
      (nuevoRemanente > 0 ? `\n⏳ Quedan *$${formatearMontoRegional(nuevoRemanente)}* disponibles en tu propuesta.` : "");

    const notifs = (resRpcData as any)?.notificaciones_privadas || [];

    await supabaseAdmin.from("chat_mensajes").insert({
      grupo_id: contextoSala.grupoId,
      sala_id: contextoSala.salaId,
      remitente_id: cliente.id,
      remitente_nombre: cliente.nombreJugador,
      es_operador: false,
      tipo_mensaje: "CONCRECION",
      contenido: msgPublicoFinal,
      reply_to_msg_id: propFresca.id,
      whatsapp_msg_id: whatsappMsgId,
      whatsapp_quoted_msg_id: quotedMsgId,
      whatsapp_group_jid: groupJid,
      whatsapp_group_nombre: whatsappGroupNombre,
      origen_canal: "WHATSAPP",
      carrera_id: propFresca.carrera_id || contextoSala.sala.carrera_activa_id,
    });

    await emitirBroadcastSala(contextoSala.salaId, "nuevo_mensaje", { salaId: contextoSala.salaId });

    return {
      ok: true,
      tipo: "CONCRECION",
      respuestaGrupo: msgPublicoFinal,
      msg_publico: msgPublicoFinal,
      msg_publico_bot: msgPublicoFinal,
      respuestaPublica: msgPublicoFinal,
      mensajePrivadoAutor: msgPrivAceptante,
      msg_privado_bot: (resRpcData as any)?.msg_privado_bot || msgPrivAceptante,
      msg_privado_aceptante: msgPrivAceptante,
      msg_privado_proponente: msgPrivProponente,
      alertaPrivada: (resRpcData as any)?.alertaPrivada || null,
      notificaciones_privadas: notifs,
      senderJid: participantJid,
      proponenteJid:
        proponenteRow?.whatsapp_jid ||
        (proponenteRow?.telefono_normalizado ? `${proponenteRow.telefono_normalizado}@s.whatsapp.net` : null) ||
        proponenteRow?.telefono ||
        null,
      datos: {
        propuestaId: propFresca.id,
        montoConcretado: montoEfectivo,
        remanenteDisponible: nuevoRemanente,
        excedioSaldo: evalConcrecion.excedioSaldo,
      },
    };
  });
}
