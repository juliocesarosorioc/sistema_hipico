import crypto from "crypto";
import { supabaseAdmin } from "@/core/supabase-admin";
import { formatearMontoRegional } from "@/shared/lib/dinero";
import { calcularRiesgoReal } from "@/features/sala-juegos/lib/parser-pedagogico";
import {
  formatearModalidadMensaje,
  limpiarEtiquetasProhibidas,
} from "@/features/sala-juegos/lib/modalidades-progresivas";
import { calcularSaldoDisponible, resolverTelefonoWhatsappCliente } from "./resolverCliente";
import { emitirBroadcastSala, respuestaSala } from "./notificador";
import { intentarCruceAutomatico } from "./accionesAdmin";
import type { ContextoSala, ClienteResuelto, JugadaParseada, ResultadoSaldo, ResultadoConcrecion } from "./types";

/**
 * Formatea el detalle público estándar de una propuesta para avisos y notificaciones.
 */
export function detallePublicoPropuesta(prop: any): string {
  if (prop?.es_match) {
    const bA = Array.isArray(prop.caballos_bando_a) ? prop.caballos_bando_a.join("-") : String(prop.caballos_bando_a || "");
    const bB = Array.isArray(prop.caballos_bando_b) ? prop.caballos_bando_b.join("-") : String(prop.caballos_bando_b || "");
    const propRaw = String(prop.proporcion_premio || prop.proporcion || "1x1").trim();
    const canon = limpiarEtiquetasProhibidas(propRaw);
    const etiqueta = canon && canon.toLowerCase() !== "pp" && !/^1x1$/i.test(canon) ? canon : "PP";
    return `${etiqueta} (${bA}x${bB})`.trim();
  }
  const mod = String(prop?.modalidad_propuesta || prop?.modalidad || "1P").trim();
  const ej = String(prop?.ejemplar_texto || (Array.isArray(prop?.caballos_bando_a) ? prop.caballos_bando_a[0] : "") || "").trim();
  return limpiarEtiquetasProhibidas(formatearModalidadMensaje(mod, ej));
}

/**
 * Calcula los montos base máximos que proponente y aceptante pueden apostar en función de sus saldos disponibles y proporciones.
 */
export function calcularMaximosBilateral(params: {
  remanenteDisponible: number;
  propFresca: any;
  proponenteRow: any;
  aceptanteRow: any;
}) {
  const { remanenteDisponible, propFresca, proponenteRow, aceptanteRow } = params;
  const propRawCheck = String(propFresca.proporcion_premio || propFresca.proporcion || "1x1").trim();
  const accionProp: "JUEGA" | "CONSIGUE" =
    String(propFresca.accion_proponente || "").toUpperCase() === "CONSIGUE" ||
    /^(consigo|doy)\b/i.test(String(propFresca.contenido || ""))
      ? "CONSIGUE"
      : "JUEGA";

  const factorPropBilat = calcularRiesgoReal(1, propRawCheck, accionProp, "PROPONENTE") || 1;
  const factorAcepBilat = calcularRiesgoReal(1, propRawCheck, accionProp, "ACEPTANTE") || 1;

  const saldoDispAceptante = calcularSaldoDisponible(aceptanteRow);
  const saldoDispProponente = proponenteRow ? calcularSaldoDisponible(proponenteRow) : remanenteDisponible;

  const maxBaseAceptante = aceptanteRow?.libre
    ? Math.max(999999, remanenteDisponible)
    : Math.floor((saldoDispAceptante / factorAcepBilat) * 100) / 100;
  const maxBaseProponente =
    !proponenteRow || proponenteRow.libre
      ? Math.max(999999, remanenteDisponible)
      : Math.floor((saldoDispProponente / factorPropBilat) * 100) / 100;

  return {
    maxBaseAceptante,
    maxBaseProponente,
    saldoDispAceptante,
    saldoDispProponente,
    factorPropBilat,
    factorAcepBilat,
  };
}

/**
 * Valida el saldo de un apostador frente a un monto requerido y genera alertas o recorte si corresponde.
 */
export function validarSaldo(params: {
  cliente: ClienteResuelto | any;
  montoRequerido: number;
  proporcion?: string;
  accion?: "JUEGA" | "CONSIGUE";
}): ResultadoSaldo {
  const { cliente, montoRequerido, proporcion = "1x1", accion = "JUEGA" } = params;
  const esLibre = Boolean(cliente.libre);
  const saldoActual = Number(cliente.saldo_actual || 0);
  const aval = Number(cliente.aval || 0);
  const saldoRetenido = Number(cliente.saldo_retenido || 0);
  const saldoDisponible = esLibre ? 999999 : calcularSaldoDisponible(cliente);

  const riesgoReal = calcularRiesgoReal(montoRequerido, proporcion, accion);
  const excedioSaldo = !esLibre && riesgoReal > saldoDisponible;
  const factorRiesgo = riesgoReal > 0 ? montoRequerido / riesgoReal : 1;

  let montoEfectivo = montoRequerido;
  let alertaExceso = null;
  let alertaSinSaldo = null;

  if (saldoDisponible <= 0 && !esLibre) {
    montoEfectivo = 0;
    const saldoFmt = formatearMontoRegional(0);
    const nombre = cliente.nombreJugador || cliente.nombre || "Jugador";
    alertaSinSaldo = {
      msgPublico: `⚠️ *${nombre}* dispone de $${saldoFmt}`,
      msgPrivado: `⚠️ Nos agrada tenerlo en el grupo, por favor no exceda su saldo, ajuste el monto de sus jugadas. Muchas gracias.`,
    };
  } else if (excedioSaldo) {
    montoEfectivo = Math.max(0, Number((saldoDisponible * factorRiesgo).toFixed(2)));
    const saldoFmt = formatearMontoRegional(saldoDisponible);
    const montoAjustadoFmt = formatearMontoRegional(montoEfectivo);
    const nombre = cliente.nombreJugador || cliente.nombre || "Jugador";
    alertaExceso = {
      msgPublico: `⚠️${nombre} solo dispone de $${saldoFmt} - Proponga solo su disponible.`,
      msgPrivado: `⚠️Hola ${nombre}, por favor, solo juega tu disponible que actualmente es $${saldoFmt}. ¡Gracias!`,
    };
  }

  return {
    saldoActual,
    aval,
    saldoRetenido,
    saldoDisponible,
    esLibre,
    montoSolicitado: montoRequerido,
    montoEfectivo,
    excedioSaldo,
    alertaExceso,
    alertaSinSaldo,
    validoParaApostar: esLibre || montoEfectivo > 0,
  };
}

/**
 * Valida saldo, aplica apuesta mínima, recorta si excede saldo y publica atómicamente la propuesta.
 */
export async function validarYPublicarPropuesta(params: {
  contextoSala: ContextoSala;
  cliente: ClienteResuelto;
  analisis: JugadaParseada;
  whatsappMsgId?: string | null;
  groupJid?: string | null;
  whatsappGroupNombre?: string | null;
  participantJid?: string | null;
}): Promise<ResultadoConcrecion> {
  const {
    contextoSala,
    cliente,
    analisis,
    whatsappMsgId = null,
    groupJid = null,
    whatsappGroupNombre = null,
    participantJid = null,
  } = params;

  const { sala, salaId, grupoId, apuestaMinima } = contextoSala;
  const saldoDisponible = cliente.saldo_disponible;
  const nombreJugador = cliente.nombreJugador;
  const telefonoClienteCompleto = cliente.telefonoClienteCompleto;

  // Manejo de propuestas múltiples en bloque (multilínea o lista de caballos)
  if (analisis.tipoIntent === "PROPUESTA_BLOQUE" && Array.isArray(analisis.bloques) && analisis.bloques.length > 1) {
    if (!contextoSala.carreraAbierta) {
      const msgCerrada = `⛔ La carrera está ${String(sala.estado_carrera || "CERRADA").toUpperCase()}. No se reciben nuevas propuestas.`;
      return {
        ok: false,
        tipo: "CARRERA_CERRADA",
        respuestaGrupo: msgCerrada,
        msg_publico: msgCerrada,
        msg_publico_bot: msgCerrada,
        respuestaPublica: msgCerrada,
        clienteTelefono: telefonoClienteCompleto,
        senderJid: participantJid,
      };
    }

    if (saldoDisponible <= 0 && !cliente.libre) {
      const saldoFmt = formatearMontoRegional(Math.max(0, saldoDisponible));
      const msgSinSaldo = `⚠️ *${nombreJugador}* dispone de $${saldoFmt}`;
      const msgPrivSinSaldo = `⚠️ Nos agrada tenerlo en el grupo, por favor no exceda su saldo, ajuste el monto de sus jugadas. Muchas gracias.`;
      return {
        ok: false,
        tipo: "SIN_SALDO",
        respuestaGrupo: msgSinSaldo,
        msg_publico: msgSinSaldo,
        msg_publico_bot: msgSinSaldo,
        respuestaPublica: msgSinSaldo,
        mensajePrivadoAutor: msgPrivSinSaldo,
        msg_privado_bot: msgPrivSinSaldo,
        alertaPrivada: msgPrivSinSaldo,
        notificaciones_privadas: [],
        clienteTelefono: telefonoClienteCompleto,
        senderJid: participantJid,
      };
    }

    const pPropuestas = analisis.bloques.map((b) => ({
      accion: b.accionProponente,
      es_match: b.esMatch,
      modalidad: b.modalidad,
      caballos_a: b.caballosBandoA,
      caballos_b: b.caballosBandoB,
      ejemplar_texto: b.ejemplarTexto,
      proporcion: b.proporcion || "1x1",
      monto_solicitado: b.montoDisponibleValido ?? b.monto,
      texto_estandarizado: b.jugadaEstandarizada,
    }));

    let propIdsBloque: string[] = [];
    const excedioSaldoBloque = analisis.bloques.some((b) => Boolean(b.excedioSaldo));

    try {
      const { data: rpcBlk, error: errBlk } = await supabaseAdmin.rpc(
        "publicar_bloque_propuestas_atomica",
        {
          p_grupo_id: grupoId,
          p_sala_id: salaId,
          p_carrera_id: sala.carrera_activa_id || "00000000-0000-0000-2026-111400000001",
          p_jugador_id: cliente.id,
          p_propuestas: pPropuestas,
          p_whatsapp_msg_id: whatsappMsgId || null,
        }
      );
      if (!errBlk && rpcBlk && Array.isArray((rpcBlk as any).propuestas_ids)) {
        propIdsBloque = (rpcBlk as any).propuestas_ids;
      }
    } catch {}

    if (propIdsBloque.length === 0) {
      for (const p of pPropuestas) {
        if ((p.monto_solicitado || 0) <= 0) continue;
        const { data: rpcInd } = await supabaseAdmin.rpc("publicar_propuesta_atomica", {
          p_grupo_id: grupoId,
          p_sala_id: salaId,
          p_carrera_id: sala.carrera_activa_id || "00000000-0000-0000-2026-111400000001",
          p_jugador_id: cliente.id,
          p_accion: p.accion,
          p_es_match: p.es_match,
          p_modalidad: p.modalidad,
          p_caballos_a: p.caballos_a,
          p_caballos_b: p.caballos_b,
          p_ejemplar_texto: p.ejemplar_texto,
          p_proporcion: p.proporcion,
          p_monto_solicitado: p.monto_solicitado,
          p_texto_estandarizado: p.texto_estandarizado,
        });
        if ((rpcInd as any)?.propuesta_id) {
          propIdsBloque.push((rpcInd as any).propuesta_id);
        }
      }
    }

    if (propIdsBloque.length > 0) {
      await supabaseAdmin
        .from("chat_mensajes")
        .update({
          whatsapp_msg_id: whatsappMsgId,
          whatsapp_group_jid: groupJid,
          whatsapp_group_nombre: whatsappGroupNombre,
          origen_canal: "WHATSAPP",
        })
        .in("id", propIdsBloque);
      await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });
    }

    const saldoBlkFmt = formatearMontoRegional(Math.max(0, saldoDisponible));
    const msgPubBlk = excedioSaldoBloque
      ? `⚠️${nombreJugador} solo dispone de $${saldoBlkFmt} - Proponga solo su disponible.`
      : null;
    const msgPrivBlk = excedioSaldoBloque
      ? `⚠️Hola ${nombreJugador}, por favor, solo juega tu disponible que actualmente es $${saldoBlkFmt}. ¡Gracias!`
      : null;

    return {
      ok: propIdsBloque.length > 0,
      tipo: "PROPUESTA_BLOQUE",
      respuestaGrupo: msgPubBlk,
      msg_publico: msgPubBlk,
      msg_publico_bot: msgPubBlk,
      respuestaPublica: msgPubBlk,
      mensajePrivadoAutor: msgPrivBlk,
      msg_privado_bot: msgPrivBlk,
      clienteTelefono: telefonoClienteCompleto,
      senderJid: participantJid,
    } as any;
  }

  // Validación de carrera abierta para proponer
  if (!contextoSala.carreraAbierta) {
    const msgCerrada = `⛔ La carrera está ${String(sala.estado_carrera || "CERRADA").toUpperCase()}. No se reciben nuevas propuestas.`;
    return {
      ok: false,
      tipo: "CARRERA_CERRADA",
      respuestaGrupo: msgCerrada,
      msg_publico: msgCerrada,
      msg_publico_bot: msgCerrada,
      respuestaPublica: msgCerrada,
      mensajePrivadoAutor: null,
      msg_privado_bot: null,
      alertaPrivada: null,
      notificaciones_privadas: [],
      clienteTelefono: telefonoClienteCompleto,
      senderJid: participantJid,
    };
  }

  // Bloqueo estricto: Si el cliente no posee saldo disponible
  if (saldoDisponible <= 0 && !cliente.libre) {
    const saldoFmt = formatearMontoRegional(Math.max(0, saldoDisponible));
    const msgSinSaldo = `⚠️ *${nombreJugador}* está jugando por encima de su saldo disponible ($${saldoFmt}). Debes recargar para proponer jugadas.`;
    const msgPrivSinSaldo = `⚠️ Hola *${nombreJugador}*, estás jugando por encima de tu saldo disponible ($${saldoFmt}). Por favor recarga o ajusta el monto de tus jugadas.`;

    await supabaseAdmin.from("chat_mensajes").insert({
      grupo_id: grupoId,
      sala_id: salaId,
      remitente_nombre: "🤖 ASISTENTE DE SALA",
      es_operador: true,
      tipo_mensaje: "sistema",
      contenido: msgSinSaldo,
      whatsapp_msg_id: whatsappMsgId || null,
      whatsapp_group_jid: groupJid || null,
      whatsapp_group_nombre: whatsappGroupNombre || null,
      origen_canal: "WHATSAPP",
      eliminado: false,
    });
    await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });

    return {
      ok: false,
      tipo: "SIN_SALDO",
      respuestaGrupo: msgSinSaldo,
      msg_publico: msgSinSaldo,
      msg_publico_bot: msgSinSaldo,
      respuestaPublica: msgSinSaldo,
      mensajePrivadoAutor: msgPrivSinSaldo,
      msg_privado_bot: msgPrivSinSaldo,
      alertaPrivada: msgPrivSinSaldo,
      notificaciones_privadas: [],
      clienteTelefono: telefonoClienteCompleto,
      senderJid: participantJid,
    };
  }

  // Regla: Apuesta Mínima para proponer
  if (analisis.monto < apuestaMinima) {
    const msgMinimoBot = `⛔ *Nada aquí* — El monto mínimo de apuesta es $${formatearMontoRegional(apuestaMinima)}`;
    await supabaseAdmin.from("chat_mensajes").insert({
      grupo_id: grupoId,
      sala_id: salaId,
      remitente_nombre: "🤖 ASISTENTE DE SALA",
      es_operador: true,
      tipo_mensaje: "concrecion_fifo",
      contenido: msgMinimoBot,
      whatsapp_msg_id: whatsappMsgId || null,
      whatsapp_group_jid: groupJid || null,
      whatsapp_group_nombre: whatsappGroupNombre || null,
      origen_canal: "WHATSAPP",
    });
    await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });
    return {
      ok: false,
      tipo: "APUESTA_MINIMA",
      nada_aqui: true,
      respuestaGrupo: msgMinimoBot,
      msg_publico: msgMinimoBot,
      msg_publico_bot: msgMinimoBot,
      respuestaPublica: msgMinimoBot,
      mensajePrivadoAutor: `El monto mínimo para publicar es $${formatearMontoRegional(apuestaMinima)}.`,
      clienteTelefono: telefonoClienteCompleto,
      senderJid: participantJid,
    };
  }

  // Determinar monto a publicar (topado según riesgo real 10/X vs saldoDisponible)
  const riesgoReal = calcularRiesgoReal(analisis.monto, analisis.proporcion, analisis.accionProponente);
  const excedioSaldo = Boolean(analisis.excedioSaldo || (!cliente.libre && riesgoReal > saldoDisponible));
  const montoAPublicar = excedioSaldo && !cliente.libre
    ? Math.max(0, Number((analisis.montoDisponibleValido ?? saldoDisponible).toFixed(2)))
    : Number(analisis.monto);

  let propId: string | null = null;
  let rpcPublicado = false;
  let rpcResFinal: any = null;

  try {
    let rpcRes: any = null;
    let rpcErr: any = null;

    // 1. Intentar con p_whatsapp_msg_id
    try {
      const intentoConWa = await supabaseAdmin.rpc("publicar_propuesta_atomica", {
        p_grupo_id: grupoId,
        p_sala_id: salaId,
        p_carrera_id: sala.carrera_activa_id || "00000000-0000-0000-2026-111400000001",
        p_jugador_id: cliente.id,
        p_accion: analisis.accionProponente,
        p_es_match: analisis.esMatch,
        p_modalidad: analisis.modalidad,
        p_caballos_a: analisis.caballosBandoA,
        p_caballos_b: analisis.caballosBandoB,
        p_ejemplar_texto: analisis.ejemplarTexto,
        p_proporcion: analisis.proporcion || "1x1",
        p_monto_solicitado: montoAPublicar,
        p_texto_estandarizado: analisis.jugadaEstandarizada,
        p_whatsapp_msg_id: whatsappMsgId || null,
      });
      rpcRes = intentoConWa.data;
      rpcErr = intentoConWa.error;
    } catch (errConWa) {
      rpcErr = errConWa;
    }

    // 2. Si falla por schema cache (función sin p_whatsapp_msg_id en BD), invocar sin el parámetro
    if (rpcErr && (rpcErr.message?.includes("schema cache") || rpcErr.message?.includes("Could not find"))) {
      const intentoSinWa = await supabaseAdmin.rpc("publicar_propuesta_atomica", {
        p_grupo_id: grupoId,
        p_sala_id: salaId,
        p_carrera_id: sala.carrera_activa_id || "00000000-0000-0000-2026-111400000001",
        p_jugador_id: cliente.id,
        p_accion: analisis.accionProponente,
        p_es_match: analisis.esMatch,
        p_modalidad: analisis.modalidad,
        p_caballos_a: analisis.caballosBandoA,
        p_caballos_b: analisis.caballosBandoB,
        p_ejemplar_texto: analisis.ejemplarTexto,
        p_proporcion: analisis.proporcion || "1x1",
        p_monto_solicitado: montoAPublicar,
        p_texto_estandarizado: analisis.jugadaEstandarizada,
      });
      rpcRes = intentoSinWa.data;
      rpcErr = intentoSinWa.error;
    }

    rpcResFinal = rpcRes;
    if (!rpcErr && rpcRes && (rpcRes as any).propuesta_id) {
      propId = (rpcRes as any).propuesta_id;
      rpcPublicado = true;
    }
  } catch {
    rpcPublicado = false;
  }

  // Fallback resiliente: inserción directa en chat_mensajes si el RPC falla (0 RETENCIÓN al proponer)
  if (!rpcPublicado || !propId) {
    try {
      const rawFirma = `PROPUESTA_WA:${salaId}:${cliente.id}:${montoAPublicar}:${Date.now()}`;
      const firma = crypto.createHash("sha256").update(rawFirma).digest("hex");

      const { data: nuevaPropuesta, error: errInsert } = await supabaseAdmin
        .from("chat_mensajes")
        .insert({
          grupo_id: grupoId,
          sala_id: salaId,
          remitente_id: cliente.id,
          remitente_nombre: nombreJugador,
          es_operador: false,
          tipo_mensaje: "propuesta_jugada",
          contenido: analisis.jugadaEstandarizada,
          carrera_id: sala.carrera_activa_id || contextoSala.carreraActivaId || null,
          accion_proponente: analisis.accionProponente || "JUEGA",
          es_match: Boolean(analisis.esMatch),
          modalidad_jugada: analisis.modalidad,
          ejemplar_numero: analisis.ejemplarTexto,
          caballos_bando_a: analisis.caballosBandoA || (analisis.ejemplarTexto ? [analisis.ejemplarTexto] : []),
          caballos_bando_b: analisis.caballosBandoB || [],
          jugada_estandarizada: analisis.jugadaEstandarizada,
          monto_original: montoAPublicar,
          monto_disponible: montoAPublicar,
          estado_propuesta: "abierta",
          proporcion_premio: analisis.proporcion || "1x1",
          firma_sha256: firma,
          whatsapp_msg_id: whatsappMsgId || null,
          whatsapp_group_jid: groupJid || null,
          whatsapp_group_nombre: whatsappGroupNombre || null,
          origen_canal: "WHATSAPP",
        })
        .select()
        .single();

      if (!errInsert && nuevaPropuesta?.id) {
        propId = nuevaPropuesta.id;
        rpcPublicado = true;
      } else if (errInsert) {
        console.error("[validarSaldo] Fallback inserción directa error:", errInsert);
      }
    } catch (errFb) {
      console.error("[validarSaldo] Error en bloque fallback propuesta:", errFb);
    }
  }

  if (!rpcPublicado || !propId) {
    const msgErrPriv =
      `⚠️ Hola *${nombreJugador}*, tu mensaje no pudo procesarse porque ocurrió un problema registrando tu propuesta.\n\n✅ *Ejemplo correcto:* "Juego 1P 5 20.000" o "Juego 3x5 10a8 100".`;
    return {
      ok: false,
      tipo: "PROPUESTA_ERROR",
      respuestaGrupo: null,
      msg_publico: null,
      msg_publico_bot: null,
      respuestaPublica: null,
      mensajePrivadoAutor: msgErrPriv,
      msg_privado_bot: msgErrPriv,
      msg_privado_proponente: msgErrPriv,
      alertaPrivada: null,
      notificaciones_privadas: [],
      clienteTelefono: resolverTelefonoWhatsappCliente(cliente.rawCliente),
      senderJid: participantJid,
    };
  }

  await supabaseAdmin
    .from("chat_mensajes")
    .update({
      whatsapp_msg_id: whatsappMsgId,
      whatsapp_group_jid: groupJid,
      whatsapp_group_nombre: whatsappGroupNombre,
      origen_canal: "WHATSAPP",
      monto_original: montoAPublicar,
      monto_disponible: montoAPublicar,
      contenido: analisis.jugadaEstandarizada,
      jugada_estandarizada: analisis.jugadaEstandarizada,
    })
    .eq("id", propId);

  await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });

  // Advertencia explícita y ajuste automático cuando propone por encima de su saldo disponible
  if (excedioSaldo && montoAPublicar > 0) {
    const saldoFmt = formatearMontoRegional(Math.max(0, saldoDisponible));
    const montoAjustadoFmt = formatearMontoRegional(montoAPublicar);
    const propPublica = {
      es_match: analisis.esMatch,
      caballos_bando_a: analisis.caballosBandoA,
      caballos_bando_b: analisis.caballosBandoB,
      modalidad_propuesta: analisis.modalidad,
      ejemplar_texto: analisis.ejemplarTexto,
      proporcion_premio: analisis.proporcion,
    };
    const msgPubRecorte = `⚠️${nombreJugador} solo dispone de $${saldoFmt} - Proponga solo su disponible.`;
    const msgPrivRecorte = `⚠️Hola ${nombreJugador}, por favor, solo juega tu disponible que actualmente es $${saldoFmt}. ¡Gracias!`;

    await supabaseAdmin.from("chat_mensajes").insert({
      grupo_id: grupoId,
      sala_id: salaId,
      remitente_nombre: "🤖 ASISTENTE DE SALA",
      es_operador: true,
      tipo_mensaje: "sistema",
      contenido: msgPubRecorte,
      whatsapp_msg_id: whatsappMsgId || null,
      whatsapp_group_jid: groupJid || null,
      whatsapp_group_nombre: whatsappGroupNombre || null,
      origen_canal: "WHATSAPP",
      eliminado: false,
    });
    await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });

    return {
      ok: true,
      tipo: "PROPUESTA_CON_RECORTE_SALDO",
      datos: {
        propuestaId: propId,
        montoConcretado: montoAPublicar,
        excedioSaldo: true,
      },
      respuestaGrupo: msgPubRecorte,
      msg_publico: msgPubRecorte,
      msg_publico_bot: msgPubRecorte,
      respuestaPublica: msgPubRecorte,
      mensajePrivadoAutor: msgPrivRecorte,
      msg_privado_bot: msgPrivRecorte,
      msg_privado_proponente: msgPrivRecorte,
      alertaPrivada: (rpcResFinal as any)?.alertaPrivada || msgPrivRecorte,
      notificaciones_privadas: (rpcResFinal as any)?.notificaciones_privadas || [],
      clienteTelefono: resolverTelefonoWhatsappCliente(cliente.rawCliente),
      senderJid: participantJid,
    };
  }

  // Propuesta Exitosa con Saldo: SILENCIO en grupo público.
  let resCruceAuto: any = null;
  if (sala.grupo_id) {
    const { data: gCruces } = await supabaseAdmin
      .from("grupos_venta")
      .select("permite_cruces")
      .eq("id", sala.grupo_id)
      .maybeSingle();

    if (gCruces?.permite_cruces) {
      resCruceAuto = await intentarCruceAutomatico({
        sala,
        grupoId,
        nuevaPropuestaId: propId,
        nuevoCliente: cliente.rawCliente,
        analisis,
        groupJid,
        whatsappGroupNombre,
        whatsappMsgId,
      });
    }
  }

  if (resCruceAuto?.cruzado || resCruceAuto?.esSugerencia) {
    const msgCrucePub = (resCruceAuto as any).msgCruce || (resCruceAuto as any).msgPublico || null;
    return {
      ok: true,
      tipo: resCruceAuto?.cruzado ? "PROPUESTA_CON_CRUCE" : "SUGERENCIA_CRUCE",
      datos: {
        propuestaId: propId,
        montoConcretado: montoAPublicar,
      },
      respuestaGrupo: msgCrucePub,
      msg_publico: msgCrucePub,
      msg_publico_bot: msgCrucePub,
      respuestaPublica: msgCrucePub,
      mensajePrivadoAutor: null,
      senderJid: participantJid,
    };
  }

  return {
    ok: true,
    tipo: "PROPUESTA",
    datos: {
      propuestaId: propId,
      montoConcretado: montoAPublicar,
    },
    respuestaGrupo: null,
    msg_publico: null,
    msg_publico_bot: null,
    respuestaPublica: null,
    mensajePrivadoAutor: null,
    msg_privado_bot: null,
    msg_privado_proponente: null,
    alertaPrivada: null,
    notificaciones_privadas: [],
    senderJid: participantJid,
  };
}
