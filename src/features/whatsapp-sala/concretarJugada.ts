import crypto from "crypto";
import { supabaseAdmin } from "@/core/supabase-admin";
import {
  analizarYEstandarizarJugada,
  calcularRiesgoReal,
  evaluarConcrecionEstricta,
  analizarComandoRetiro,
  evaluarAmpliacionPropuesta,
  esIntentoConcrecionOMontoParcial,
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
import { resolverCliente, resolverTelefonoWhatsappCliente } from "./resolverCliente";
import { calcularMaximosBilateral, detallePublicoPropuesta } from "./validarSaldo";
import { emitirBroadcastSala, enviarNotificacionesPrivadasDaemon } from "./notificador";
import type { ContextoSala, ClienteResuelto, ResultadoConcrecion, RespuestaGrupoItem } from "./types";

async function obtenerSiguienteOrdenFifo(propuestaMsgId: string): Promise<number> {
  if (!propuestaMsgId) return 1;
  try {
    const { data } = await supabaseAdmin
      .from("chat_tickets_fifo")
      .select("orden_fifo")
      .eq("propuesta_msg_id", propuestaMsgId)
      .order("orden_fifo", { ascending: false })
      .limit(1)
      .maybeSingle();
    const maxOrden = Number(data?.orden_fifo || 0);
    return Number.isFinite(maxOrden) && maxOrden >= 0 ? maxOrden + 1 : 1;
  } catch {
    return 1;
  }
}

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
    `✅ Jugaron: *${nombreJuega} Juega ${detalle} con $${formatearMontoRegional(monto)} da ${nombreDa}*`
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

/**
 * Recorta o cierra cualquier otra propuesta abierta/parcial de un jugador en la sala
 * cuando su nuevo saldo_disponible (tras una concreción) queda por debajo del riesgo requerido.
 */
export async function recortarPropuestasAbiertasPorSaldo(params: {
  salaId: string;
  jugadorId: string;
  nuevoSaldoDisponible: number;
  esLibre?: boolean;
}): Promise<void> {
  const { salaId, jugadorId, nuevoSaldoDisponible, esLibre = false } = params;
  if (esLibre || !salaId || !jugadorId) return;
  try {
    const { data: abiertas } = await supabaseAdmin
      .from("chat_mensajes")
      .select("id, monto_disponible, monto_original, proporcion_premio, accion_proponente, contenido, jugada_estandarizada")
      .eq("sala_id", salaId)
      .eq("remitente_id", jugadorId)
      .in("estado_propuesta", ["abierta", "parcial"])
      .gt("monto_disponible", 0);

    if (!abiertas || abiertas.length === 0) return;

    for (const p of abiertas) {
      const prop = String(p.proporcion_premio || "1x1").trim();
      const accion: "JUEGA" | "CONSIGUE" =
        String(p.accion_proponente || "").toUpperCase() === "CONSIGUE" ||
        /^(consigo|doy)\b/i.test(String(p.contenido || ""))
          ? "CONSIGUE"
          : "JUEGA";
      const factor = calcularRiesgoReal(1, prop, accion, "PROPONENTE") || 1;
      const maxMontoPermitido =
        nuevoSaldoDisponible <= 0
          ? 0
          : Math.floor((nuevoSaldoDisponible / factor) * 100) / 100;

      const dispActual = Number(p.monto_disponible || 0);
      if (dispActual > maxMontoPermitido) {
        if (maxMontoPermitido <= 0) {
          await supabaseAdmin
            .from("chat_mensajes")
            .update({ monto_disponible: 0, estado_propuesta: "cerrada" })
            .eq("id", p.id);
        } else {
          const nuevoFmt = formatearMontoRegional(maxMontoPermitido);
          const textoBase = String(p.jugada_estandarizada || p.contenido || "").trim();
          const textoRecortado = textoBase
            ? textoBase.replace(/(\s+)[\d.,]+(?:\s*(?:k|mil))?$/i, `$1${nuevoFmt}`)
            : textoBase;
          await supabaseAdmin
            .from("chat_mensajes")
            .update({
              monto_disponible: maxMontoPermitido,
              ...(textoRecortado ? { jugada_estandarizada: textoRecortado, contenido: textoRecortado } : {}),
            })
            .eq("id", p.id);
        }
      }
    }
  } catch (err) {
    console.warn("[concretarJugada] Aviso al recortar propuestas abiertas restantes:", err);
  }
}

/**
 * Calcula el riesgo total retenido en tickets ya casados/activos (`chat_tickets_fifo`)
 * para garantizar que el retiro ("Se fue") o cierre de carrera NUNCA afecte las jugadas ya casadas.
 */
async function calcularRiesgoTicketsCasadosActivos(jugadorId: string, grupoId?: string | null): Promise<number> {
  if (!jugadorId) return 0;
  try {
    let q = supabaseAdmin
      .from("chat_tickets_fifo")
      .select("proponente_id, aceptante_id, monto_concretado, riesgo_proponente, riesgo_aceptante, proporcion_premio, accion_proponente")
      .or(`proponente_id.eq.${jugadorId},aceptante_id.eq.${jugadorId}`)
      .in("estado", ["PENDIENTE", "ACTIVO", "ABIERTO"]);
    if (grupoId) {
      q = q.eq("grupo_id", grupoId);
    }
    const { data: tickets } = await q;
    let totalRiesgo = 0;
    for (const t of tickets || []) {
      const esProp = String(t.proponente_id) === String(jugadorId);
      const rExplicito = Number(esProp ? t.riesgo_proponente : t.riesgo_aceptante);
      if (Number.isFinite(rExplicito) && rExplicito > 0) {
        totalRiesgo += rExplicito;
      } else {
        const monto = Number(t.monto_concretado || 0);
        const prop = String(t.proporcion_premio || "1x1");
        const acc = String(t.accion_proponente || "JUEGA").toUpperCase() === "CONSIGUE" ? "CONSIGUE" : "JUEGA";
        totalRiesgo += calcularRiesgoReal(monto, prop, acc, esProp ? "PROPONENTE" : "ACEPTANTE");
      }
    }
    return Number(totalRiesgo.toFixed(2));
  } catch {
    return 0;
  }
}

/**
 * Retira una propuesta específica (con cita) o todas las propuestas abiertas del jugador (sin cita)
 * bajo las reglas de "Se fue", protegiendo las jugadas ya casadas y sin publicar ruido en el grupo.
 */
export async function ejecutarRetiroPropuestasSeFue(params: {
  grupoId: string;
  salaId: string;
  jugadorId: string;
  propuestaId: string | null;
}): Promise<{ ok: boolean; canceladasIds: string[]; montoLiberado: number; error?: string }> {
  const { grupoId, salaId, jugadorId, propuestaId } = params;
  const canceladasIds: string[] = [];
  let montoLiberado = 0;

  const cancelarColaPropuesta = async (propId: string, soloAceptanteId?: string) => {
    try {
      let q = supabaseAdmin
        .from("chat_tickets_fifo")
        .select("id, monto_concretado, monto_solicitado, monto_pendiente_ampliacion, estado")
        .eq("propuesta_msg_id", propId)
        .neq("estado", "ANULADO");
      if (soloAceptanteId) {
        q = q.eq("aceptante_id", soloAceptanteId);
      }
      const { data: rows } = await q;
      let cerrados = 0;
      for (const r of rows || []) {
        const conc = Number(r.monto_concretado || 0);
        const sol = Number(r.monto_solicitado || 0);
        const pend = Number(r.monto_pendiente_ampliacion ?? Math.max(0, sol - conc));
        const esCola = String(r.estado || "").toUpperCase() === "EN_COLA";
        if (pend > 0 || esCola || sol > conc) {
          if (conc <= 0) {
            await supabaseAdmin
              .from("chat_tickets_fifo")
              .update({ estado: "ANULADO", monto_pendiente_ampliacion: 0, monto_solicitado: 0 })
              .eq("id", r.id);
          } else {
            await supabaseAdmin
              .from("chat_tickets_fifo")
              .update({
                monto_pendiente_ampliacion: 0,
                monto_solicitado: conc,
                fue_ajuste_parcial: false,
              })
              .eq("id", r.id);
          }
          canceladasIds.push(String(r.id));
          cerrados += 1;
        }
      }
      return cerrados;
    } catch {
      return 0;
    }
  };

  if (propuestaId) {
    const { data: prop } = await supabaseAdmin
      .from("chat_mensajes")
      .select("id, remitente_id, estado_propuesta, monto_disponible, proporcion_premio, accion_proponente")
      .eq("id", propuestaId)
      .eq("sala_id", salaId)
      .maybeSingle();

    if (!prop) {
      return { ok: false, canceladasIds: [], montoLiberado: 0, error: "PROPUESTA_NO_ENCONTRADA" };
    }
    if (String(prop.remitente_id) !== String(jugadorId)) {
      // Si quien dice "Se Fue" es un aceptante con jugada parcial o en cola (ej. 3er o 4to jugador),
      // cerrar su remanente pendiente en cola sin tocar lo ya concretado.
      const cerradosAceptante = await cancelarColaPropuesta(String(prop.id), String(jugadorId));
      if (cerradosAceptante > 0) {
        return { ok: true, canceladasIds, montoLiberado: 0 };
      }
      return { ok: false, canceladasIds: [], montoLiberado: 0, error: "NO_ES_PROPONENTE" };
    }

    const est = String(prop.estado_propuesta || "").toLowerCase();
    const disp = Number(prop.monto_disponible || 0);
    if ((est === "abierta" || est === "parcial") && disp > 0) {
      montoLiberado = disp;
      canceladasIds.push(String(prop.id));
    }
    await supabaseAdmin
      .from("chat_mensajes")
      .update({ estado_propuesta: "cancelada", monto_disponible: 0 })
      .eq("id", prop.id);
    await cancelarColaPropuesta(String(prop.id));
  } else {
    const { data: abiertas } = await supabaseAdmin
      .from("chat_mensajes")
      .select("id, monto_disponible")
      .eq("sala_id", salaId)
      .eq("remitente_id", jugadorId)
      .in("estado_propuesta", ["abierta", "parcial"])
      .gt("monto_disponible", 0);

    for (const p of abiertas || []) {
      montoLiberado += Number(p.monto_disponible || 0);
      canceladasIds.push(String(p.id));
    }

    if (canceladasIds.length > 0) {
      await supabaseAdmin
        .from("chat_mensajes")
        .update({ estado_propuesta: "cancelada", monto_disponible: 0 })
        .in("id", canceladasIds);
      for (const pid of canceladasIds) {
        await cancelarColaPropuesta(pid);
      }
    }

    // Cerrar también cualquier remanente pendiente o turno en cola donde este jugador sea aceptante (ej. 3ro o 4to jugador)
    try {
      const { data: pendientesAcep } = await supabaseAdmin
        .from("chat_tickets_fifo")
        .select("id, monto_concretado, monto_solicitado, monto_pendiente_ampliacion, estado")
        .eq("sala_id", salaId)
        .eq("aceptante_id", jugadorId)
        .neq("estado", "ANULADO");
      for (const r of pendientesAcep || []) {
        const conc = Number(r.monto_concretado || 0);
        const sol = Number(r.monto_solicitado || 0);
        const pend = Number(r.monto_pendiente_ampliacion ?? Math.max(0, sol - conc));
        const esCola = String(r.estado || "").toUpperCase() === "EN_COLA";
        if (pend > 0 || esCola || sol > conc) {
          if (conc <= 0) {
            await supabaseAdmin
              .from("chat_tickets_fifo")
              .update({ estado: "ANULADO", monto_pendiente_ampliacion: 0, monto_solicitado: 0 })
              .eq("id", r.id);
          } else {
            await supabaseAdmin
              .from("chat_tickets_fifo")
              .update({
                monto_pendiente_ampliacion: 0,
                monto_solicitado: conc,
                fue_ajuste_parcial: false,
              })
              .eq("id", r.id);
          }
          canceladasIds.push(String(r.id));
        }
      }
    } catch {}
  }

  if (montoLiberado > 0) {
    const { data: cl } = await supabaseAdmin
      .from("clientes")
      .select("id, saldo_actual, saldo_retenido, libre, aval")
      .eq("id", jugadorId)
      .maybeSingle();

    if (cl && !cl.libre) {
      const pisoCasadas = await calcularRiesgoTicketsCasadosActivos(jugadorId, grupoId);
      const retActual = Number(cl.saldo_retenido || 0);
      const nuevoRet = Math.max(pisoCasadas, Number((retActual - montoLiberado).toFixed(2)));
      const nuevoDisp = Math.max(
        0,
        Number((Number(cl.saldo_actual || 0) + Number(cl.aval || 0) - nuevoRet).toFixed(2))
      );
      await supabaseAdmin
        .from("clientes")
        .update({ saldo_retenido: nuevoRet, saldo_disponible: nuevoDisp })
        .eq("id", jugadorId);
    }
  }

  return { ok: true, canceladasIds, montoLiberado: Number(montoLiberado.toFixed(2)) };
}

/**
 * Al cerrar la carrera, todas las paradas (propuestas abiertas o parciales) de la sala se van
 * automáticamente sin necesidad de que los jugadores envíen "Se fue".
 */
export async function cerrarParadasAbiertasDeSala(salaId: string, grupoId?: string | null): Promise<void> {
  if (!salaId) return;
  try {
    // Limpiar también cualquier entrada en cola o ampliación pendiente en chat_tickets_fifo
    try {
      await supabaseAdmin
        .from("chat_tickets_fifo")
        .update({ estado: "ANULADO", monto_pendiente_ampliacion: 0 })
        .eq("sala_id", salaId)
        .eq("estado", "EN_COLA");
      await supabaseAdmin
        .from("chat_tickets_fifo")
        .update({ monto_pendiente_ampliacion: 0, fue_ajuste_parcial: false })
        .eq("sala_id", salaId)
        .gt("monto_pendiente_ampliacion", 0);
    } catch {}

    const { data: paradasAbiertas } = await supabaseAdmin
      .from("chat_mensajes")
      .select("id, remitente_id, monto_disponible")
      .eq("sala_id", salaId)
      .in("tipo_mensaje", ["propuesta_jugada", "PROPUESTA"])
      .in("estado_propuesta", ["abierta", "parcial"])
      .gt("monto_disponible", 0);

    if (!paradasAbiertas || paradasAbiertas.length === 0) return;

    const idsCerrar = paradasAbiertas.map((p) => p.id);
    const liberadoPorJugador = new Map<string, number>();

    for (const p of paradasAbiertas) {
      if (!p.remitente_id) continue;
      const jId = String(p.remitente_id);
      const prev = liberadoPorJugador.get(jId) || 0;
      liberadoPorJugador.set(jId, prev + Number(p.monto_disponible || 0));
    }

    await supabaseAdmin
      .from("chat_mensajes")
      .update({ estado_propuesta: "cancelada", monto_disponible: 0 })
      .in("id", idsCerrar);

    for (const [jugadorId, liberado] of liberadoPorJugador.entries()) {
      if (liberado <= 0) continue;
      const { data: cl } = await supabaseAdmin
        .from("clientes")
        .select("id, saldo_actual, saldo_retenido, libre, aval")
        .eq("id", jugadorId)
        .maybeSingle();

      if (cl && !cl.libre) {
        const pisoCasadas = await calcularRiesgoTicketsCasadosActivos(jugadorId, grupoId);
        const retActual = Number(cl.saldo_retenido || 0);
        const nuevoRet = Math.max(pisoCasadas, Number((retActual - liberado).toFixed(2)));
        const nuevoDisp = Math.max(
          0,
          Number((Number(cl.saldo_actual || 0) + Number(cl.aval || 0) - nuevoRet).toFixed(2))
        );
        await supabaseAdmin
          .from("clientes")
          .update({ saldo_retenido: nuevoRet, saldo_disponible: nuevoDisp })
          .eq("id", jugadorId);
      }
    }
  } catch (err) {
    console.warn("[concretarJugada] Aviso cerrando paradas abiertas al cerrar carrera:", err);
  }
}

export async function ejecutarAmpliacionCupo(params: {
  contextoSala: ContextoSala;
  cliente: ClienteResuelto;
  quotedPropuestaId: string | null;
  nuevoTope: number | null;
  whatsappMsgId?: string | null;
  groupJid?: string | null;
  whatsappGroupNombre?: string | null;
  participantJid?: string | null;
}): Promise<ResultadoConcrecion> {
  const {
    contextoSala,
    cliente,
    quotedPropuestaId,
    nuevoTope,
    whatsappMsgId,
    groupJid,
    whatsappGroupNombre,
    participantJid,
  } = params;

  // 1. Resolver la propuesta objetivo del proponente
  let propMsg: any = null;
  if (quotedPropuestaId) {
    const esUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(quotedPropuestaId);
    let q = supabaseAdmin.from("chat_mensajes").select("*").eq("sala_id", contextoSala.salaId);
    q = esUuid ? q.or(`id.eq.${quotedPropuestaId},whatsapp_msg_id.eq.${quotedPropuestaId}`) : q.eq("whatsapp_msg_id", quotedPropuestaId);
    const { data: pDirecta } = await q.limit(1).maybeSingle();
    if (pDirecta) {
      if (pDirecta.tipo_mensaje === "propuesta_jugada" || pDirecta.tipo_mensaje === "PROPUESTA") {
        propMsg = pDirecta;
      } else if (pDirecta.reply_to_msg_id) {
        const { data: pPadre } = await supabaseAdmin
          .from("chat_mensajes")
          .select("*")
          .eq("id", pDirecta.reply_to_msg_id)
          .maybeSingle();
        if (pPadre) propMsg = pPadre;
      }
    }
    if (!propMsg) {
      const { data: tkCita } = await supabaseAdmin
        .from("chat_tickets_fifo")
        .select("propuesta_msg_id")
        .eq("sala_id", contextoSala.salaId)
        .eq("whatsapp_concrecion_msg_id", quotedPropuestaId)
        .limit(1)
        .maybeSingle();
      if (tkCita?.propuesta_msg_id) {
        const { data: pDeTk } = await supabaseAdmin
          .from("chat_mensajes")
          .select("*")
          .eq("id", tkCita.propuesta_msg_id)
          .maybeSingle();
        if (pDeTk) propMsg = pDeTk;
      }
    }
  }

  if (!propMsg) {
    // Buscar la propuesta más reciente del jugador en la sala que tenga tickets pendientes en cola o parciales
    const { data: tksPend } = await supabaseAdmin
      .from("chat_tickets_fifo")
      .select("propuesta_msg_id, monto_concretado, monto_solicitado, monto_pendiente_ampliacion, estado, created_at")
      .eq("sala_id", contextoSala.salaId)
      .eq("proponente_id", cliente.id)
      .neq("estado", "ANULADO")
      .order("created_at", { ascending: false });

    const tkConPendiente = (tksPend || []).find((t: any) => {
      const conc = Number(t.monto_concretado || 0);
      const sol = Number(t.monto_solicitado || 0);
      const pend = Number(t.monto_pendiente_ampliacion ?? Math.max(0, sol - conc));
      return pend > 0 || String(t.estado || "").toUpperCase() === "EN_COLA" || sol > conc;
    });

    if (tkConPendiente?.propuesta_msg_id) {
      const { data: pEncontrada } = await supabaseAdmin
        .from("chat_mensajes")
        .select("*")
        .eq("id", tkConPendiente.propuesta_msg_id)
        .maybeSingle();
      if (pEncontrada) propMsg = pEncontrada;
    }
  }

  if (!propMsg) {
    const { data: ultProp } = await supabaseAdmin
      .from("chat_mensajes")
      .select("*")
      .eq("sala_id", contextoSala.salaId)
      .eq("remitente_id", cliente.id)
      .in("tipo_mensaje", ["propuesta_jugada", "PROPUESTA"])
      .not("estado_propuesta", "in", '("cancelada","anulada","se_fue")')
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (ultProp) propMsg = ultProp;
  }

  if (!propMsg || String(propMsg.remitente_id) !== String(cliente.id)) {
    const msgErr = "⚠️ No tienes ninguna propuesta activa con jugadas pendientes para concretar con todos.";
    return {
      ok: false,
      tipo: "AMPLIACION_ERROR",
      respuestaGrupo: null,
      msg_publico: null,
      msg_publico_bot: null,
      respuestaPublica: null,
      mensajePrivadoAutor: msgErr,
      msg_privado_bot: msgErr,
      msg_privado_proponente: msgErr,
      senderJid: participantJid || cliente.whatsapp_jid || undefined,
    };
  }

  return await encolarConcrecionSecuencial(propMsg.id, async () => {
    const { data: ticketsProp } = await supabaseAdmin
      .from("chat_tickets_fifo")
      .select("*")
      .eq("propuesta_msg_id", propMsg.id)
      .neq("estado", "ANULADO")
      .order("created_at", { ascending: true })
      .order("orden_fifo", { ascending: true });

    const pendientes = (ticketsProp || []).filter((t: any) => {
      const conc = Number(t.monto_concretado || 0);
      const sol = Number(t.monto_solicitado || 0);
      const pend = Number(t.monto_pendiente_ampliacion ?? Math.max(0, sol - conc));
      return pend > 0 || String(t.estado || "").toUpperCase() === "EN_COLA" || sol > conc;
    });

    if (pendientes.length === 0) {
      const msgSinPend = "⚠️ No hay jugadores pendientes en cola para concretar en esta propuesta.";
      return {
        ok: false,
        tipo: "AMPLIACION_ERROR",
        respuestaGrupo: null,
        msg_publico: null,
        msg_publico_bot: null,
        respuestaPublica: null,
        mensajePrivadoAutor: msgSinPend,
        msg_privado_bot: msgSinPend,
        msg_privado_proponente: msgSinPend,
        senderJid: participantJid || cliente.whatsapp_jid || undefined,
      };
    }

    const { data: proponenteRow } = await supabaseAdmin
      .from("clientes")
      .select(
        "id, nombre, seudonimo, saldo_actual, saldo_retenido, libre, aval, whatsapp_jid, telefono, telefono_normalizado, saldo_disponible"
      )
      .eq("id", cliente.id)
      .maybeSingle();

    const accionProp: "JUEGA" | "CONSIGUE" =
      String(propMsg.accion_proponente || "").toUpperCase() === "CONSIGUE" ||
      /^(consigo|doy)\b/i.test(String(propMsg.contenido || ""))
        ? "CONSIGUE"
        : "JUEGA";
    const propRaw = String(propMsg.proporcion_premio || propMsg.proporcion || "1x1").trim();
    const factorProp = calcularRiesgoReal(1, propRaw, accionProp, "PROPONENTE") || 1;
    const factorAcep = calcularRiesgoReal(1, propRaw, accionProp, "ACEPTANTE") || 1;

    let retProp = Number(proponenteRow?.saldo_retenido || 0);
    let dispProp = proponenteRow?.libre
      ? 999999
      : Math.max(
          0,
          Number(
            (
              Number(proponenteRow?.saldo_actual || 0) +
              Number(proponenteRow?.aval || 0) -
              retProp
            ).toFixed(2)
          )
        );

    const totalYaConcretado = (ticketsProp || []).reduce(
      (acc: number, t: any) => acc + Number(t.monto_concretado || 0),
      0
    );
    let cupoTopeRestante =
      nuevoTope !== null && Number.isFinite(nuevoTope) && nuevoTope > 0
        ? Math.max(0, Number((nuevoTope - totalYaConcretado).toFixed(2)))
        : null;

    const mensajesPublicos: string[] = [];
    const respuestasGrupo: RespuestaGrupoItem[] = [];
    const notificaciones: any[] = [];
    const jugadoresAmpliados: Array<{
      aceptanteId: string;
      aceptanteNombre: string;
      montoConcretado: number;
      montoAdicional: number;
      eraParcial: boolean;
      mensaje: string;
    }> = [];

    for (const tk of pendientes) {
      const montoPrevio = Number(tk.monto_concretado || 0);
      const montoSolicitado = Number(
        tk.monto_solicitado || montoPrevio + Number(tk.monto_pendiente_ampliacion || 0)
      );
      const faltante = Number(
        tk.monto_pendiente_ampliacion ?? Math.max(0, Number((montoSolicitado - montoPrevio).toFixed(2)))
      );
      if (faltante <= 0) continue;

      const { data: aceptanteRow } = await supabaseAdmin
        .from("clientes")
        .select(
          "id, nombre, seudonimo, saldo_actual, saldo_retenido, libre, aval, whatsapp_jid, telefono, telefono_normalizado, saldo_disponible"
        )
        .eq("id", tk.aceptante_id)
        .maybeSingle();

      if (!aceptanteRow) continue;

      const retAcep = Number(aceptanteRow.saldo_retenido || 0);
      const dispAcep = aceptanteRow.libre
        ? 999999
        : Math.max(
            0,
            Number(
              (
                Number(aceptanteRow.saldo_actual || 0) +
                Number(aceptanteRow.aval || 0) -
                retAcep
              ).toFixed(2)
            )
          );

      const maxAdicProp = proponenteRow?.libre
        ? faltante
        : Math.floor((dispProp / factorProp) * 100) / 100;
      const maxAdicAcep = aceptanteRow.libre
        ? faltante
        : Math.floor((dispAcep / factorAcep) * 100) / 100;

      let adicional = Math.min(faltante, maxAdicProp, maxAdicAcep);
      if (cupoTopeRestante !== null) {
        adicional = Math.min(adicional, cupoTopeRestante);
      }
      adicional = Math.max(0, Number(adicional.toFixed(2)));
      if (adicional <= 0) continue;

      if (cupoTopeRestante !== null) {
        cupoTopeRestante = Math.max(0, Number((cupoTopeRestante - adicional).toFixed(2)));
      }

      const riesgoAdicProp = calcularRiesgoReal(adicional, propRaw, accionProp, "PROPONENTE");
      const riesgoAdicAcep = calcularRiesgoReal(adicional, propRaw, accionProp, "ACEPTANTE");

      if (proponenteRow && !proponenteRow.libre) {
        retProp = Math.max(0, Number((retProp + riesgoAdicProp).toFixed(2)));
        dispProp = Math.max(
          0,
          Number(
            (
              Number(proponenteRow.saldo_actual || 0) +
              Number(proponenteRow.aval || 0) -
              retProp
            ).toFixed(2)
          )
        );
        await supabaseAdmin
          .from("clientes")
          .update({ saldo_retenido: retProp, saldo_disponible: dispProp })
          .eq("id", proponenteRow.id);
      }

      if (!aceptanteRow.libre) {
        const nuevoRetAcep = Math.max(0, Number((retAcep + riesgoAdicAcep).toFixed(2)));
        const nuevoDispAcep = Math.max(
          0,
          Number(
            (
              Number(aceptanteRow.saldo_actual || 0) +
              Number(aceptanteRow.aval || 0) -
              nuevoRetAcep
            ).toFixed(2)
          )
        );
        await supabaseAdmin
          .from("clientes")
          .update({ saldo_retenido: nuevoRetAcep, saldo_disponible: nuevoDispAcep })
          .eq("id", aceptanteRow.id);
        await recortarPropuestasAbiertasPorSaldo({
          salaId: contextoSala.salaId,
          jugadorId: String(aceptanteRow.id),
          nuevoSaldoDisponible: nuevoDispAcep,
          esLibre: false,
        });
      }

      const eraParcial = montoPrevio > 0;
      const nuevoMontoConcretado = Number((montoPrevio + adicional).toFixed(2));
      const nuevoPendiente = Math.max(0, Number((faltante - adicional).toFixed(2)));
      const riesgoTotalProp = calcularRiesgoReal(nuevoMontoConcretado, propRaw, accionProp, "PROPONENTE");
      const riesgoTotalAcep = calcularRiesgoReal(nuevoMontoConcretado, propRaw, accionProp, "ACEPTANTE");

      await supabaseAdmin
        .from("chat_tickets_fifo")
        .update({
          monto_concretado: nuevoMontoConcretado,
          monto_pendiente_ampliacion: nuevoPendiente,
          fue_ajuste_parcial: nuevoPendiente > 0,
          riesgo_proponente: riesgoTotalProp,
          riesgo_aceptante: riesgoTotalAcep,
          estado: "ACTIVO",
        })
        .eq("id", tk.id);

      const textoJugador =
        eraParcial && nuevoPendiente === 0
          ? `Jugó Completo ${formatearMontoRegional(nuevoMontoConcretado)}`
          : `Jugo ${formatearMontoRegional(nuevoMontoConcretado)}`;

      mensajesPublicos.push(textoJugador);
      const nomAcep = String(
        tk.aceptante_nombre || aceptanteRow.seudonimo || aceptanteRow.nombre || "Jugador"
      );
      respuestasGrupo.push({
        texto: textoJugador,
        quotedMsgId: tk.whatsapp_concrecion_msg_id || propMsg.whatsapp_msg_id || whatsappMsgId || null,
        aceptanteId: String(tk.aceptante_id),
        aceptanteNombre: nomAcep,
        montoConcretado: nuevoMontoConcretado,
        eraParcial,
      });
      jugadoresAmpliados.push({
        aceptanteId: String(tk.aceptante_id),
        aceptanteNombre: nomAcep,
        montoConcretado: nuevoMontoConcretado,
        montoAdicional: adicional,
        eraParcial,
        mensaje: textoJugador,
      });

      await supabaseAdmin.from("chat_mensajes").insert({
        grupo_id: contextoSala.grupoId,
        sala_id: contextoSala.salaId,
        remitente_id: tk.aceptante_id,
        remitente_nombre: nomAcep,
        es_operador: true,
        tipo_mensaje: "concrecion_fifo",
        contenido: textoJugador,
        reply_to_msg_id: propMsg.id,
        whatsapp_msg_id: whatsappMsgId || null,
        whatsapp_quoted_msg_id: tk.whatsapp_concrecion_msg_id || propMsg.whatsapp_msg_id || null,
        whatsapp_group_jid: groupJid || null,
        whatsapp_group_nombre: whatsappGroupNombre || null,
        origen_canal: "WHATSAPP",
        carrera_id: propMsg.carrera_id || contextoSala.sala?.carrera_activa_id || null,
      });

      const jidAcep =
        aceptanteRow.whatsapp_jid ||
        (aceptanteRow.telefono_normalizado ? `${aceptanteRow.telefono_normalizado}@s.whatsapp.net` : null) ||
        aceptanteRow.telefono ||
        null;
      if (jidAcep) {
        notificaciones.push({
          whatsapp_jid: jidAcep,
          cliente_id: aceptanteRow.id,
          mensaje: `✅ *${textoJugador}* contra *${cliente.nombreJugador}* (${propMsg.jugada_estandarizada || propMsg.contenido || "Jugada"}).`,
        });
      }
    }

    if (proponenteRow && !proponenteRow.libre) {
      await recortarPropuestasAbiertasPorSaldo({
        salaId: contextoSala.salaId,
        jugadorId: String(proponenteRow.id),
        nuevoSaldoDisponible: dispProp,
        esLibre: false,
      });
    }

    await sincronizarTicketsPropuestaATaquilla(supabaseAdmin, {
      propuestaMsgId: propMsg.id,
      sala: contextoSala.sala,
      grupoId: contextoSala.grupoId,
      condicionProponente: propMsg.condicion_proponente,
      carreraAbierta: contextoSala.carreraAbierta,
      montoAConcretar: jugadoresAmpliados.reduce((acc, j) => acc + j.montoAdicional, 0),
    });

    await emitirBroadcastSala(contextoSala.salaId, "nuevo_mensaje", { salaId: contextoSala.salaId });
    await enviarNotificacionesPrivadasDaemon(notificaciones);

    const msgPublico = mensajesPublicos.length > 0 ? mensajesPublicos.join("\n") : null;
    const totalAdicional = jugadoresAmpliados.reduce((acc, j) => acc + j.montoAdicional, 0);

    return {
      ok: jugadoresAmpliados.length > 0,
      tipo: "AMPLIACION_CUPO",
      respuestaGrupo: msgPublico,
      respuestas_grupo: respuestasGrupo,
      msg_publico: msgPublico,
      msg_publico_bot: msgPublico,
      respuestaPublica: msgPublico,
      mensajePrivadoAutor: null,
      msg_privado_bot: null,
      msg_privado_proponente: null,
      alertaPrivada: null,
      notificaciones_privadas: notificaciones,
      senderJid: participantJid || cliente.whatsapp_jid || undefined,
      datos: {
        propuestaId: propMsg.id,
        montoConcretado: totalAdicional,
        remanenteDisponible: 0,
        jugadoresAmpliados,
      },
    };
  });
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
    const ampSinCita = evaluarAmpliacionPropuesta(texto);
    if (ampSinCita.esAmpliacion) {
      if (!contextoSala.carreraAbierta) {
        return {
          ok: false,
          tipo: "CARRERA_CERRADA",
          respuestaGrupo: `⛔ La carrera se encuentra ${String(contextoSala.sala.estado_carrera || "CERRADA").toUpperCase()}. No se admiten concreciones.`,
          mensajePrivadoAutor: null,
        };
      }
      return await ejecutarAmpliacionCupo({
        contextoSala,
        cliente,
        quotedPropuestaId: null,
        nuevoTope: ampSinCita.nuevoTope,
        whatsappMsgId,
        groupJid,
        whatsappGroupNombre,
        participantJid,
      });
    }

    const comandoRetiro = analizarComandoRetiro(texto);
    if (comandoRetiro.esComandoRetiro) {
      if (!contextoSala.carreraAbierta) {
        return {
          ok: true,
          tipo: "IGNORADO",
          respuestaGrupo: null,
          msg_publico: null,
          msg_publico_bot: null,
          respuestaPublica: null,
          mensajePrivadoAutor: null,
          msg_privado_bot: null,
        };
      }

      if (!comandoRetiro.esValido) {
        return {
          ok: false,
          tipo: "PEDAGOGICO",
          respuestaGrupo: null,
          mensajePrivadoAutor:
            comandoRetiro.mensajeAclaratoria ||
            "Por favor aclara si deseas retirar tus jugadas con: 'Se fue', 'sf' o 'cf'",
        };
      }

      const resSeFue = await ejecutarRetiroPropuestasSeFue({
        grupoId: contextoSala.grupoId,
        salaId: contextoSala.salaId,
        jugadorId: cliente.id,
        propuestaId: null,
      });

      if (!resSeFue.ok) {
        return {
          ok: false,
          tipo: "ERROR_RETIRO",
          respuestaGrupo: null,
          msg_publico_bot: null,
          msg_privado_bot: null,
          clienteTelefono: resolverTelefonoWhatsappCliente(cliente.rawCliente),
          error: resSeFue.error || "No se pudieron retirar las propuestas",
        };
      }

      const msgPrivadoRetiro = "✅ Todas tus propuestas abiertas fueron retiradas.";

      await emitirBroadcastSala(contextoSala.salaId, "nuevo_mensaje", { salaId: contextoSala.salaId });

      return {
        ok: true,
        tipo: "RETIRO_PROPUESTAS",
        respuestaGrupo: null,
        msg_publico: null,
        msg_publico_bot: null,
        respuestaPublica: null,
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

  // Si citó cualquier mensaje y dijo "Jugue con Todos" / "Todos", permitir resolver la propuesta
  const ampConCitaPre = evaluarAmpliacionPropuesta(texto);

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

  const { data: propMsgRaw } = await queryProp.limit(1).maybeSingle();
  let propMsg = propMsgRaw;

  if (
    propMsg &&
    propMsg.tipo_mensaje !== "propuesta_jugada" &&
    propMsg.tipo_mensaje !== "PROPUESTA" &&
    propMsg.reply_to_msg_id
  ) {
    const { data: propPadre } = await supabaseAdmin
      .from("chat_mensajes")
      .select("*")
      .eq("id", propMsg.reply_to_msg_id)
      .maybeSingle();
    if (propPadre) propMsg = propPadre;
  }

  // Si la propuesta citada no estaba en chat_mensajes por su whatsapp_msg_id,
  // intentar recuperarla del texto/autor citado de WhatsApp (contextInfo)
  if (
    (!propMsg ||
      (propMsg.tipo_mensaje !== "propuesta_jugada" && propMsg.tipo_mensaje !== "PROPUESTA")) &&
    params.body
  ) {
    const quotedTextRaw = String(
      params.body.quotedText || params.body.quoted_text || ""
    ).trim();
    const quotedAuthorJid = String(
      params.body.quotedParticipantJid || params.body.quoted_participant_jid || ""
    ).trim();

    if (quotedTextRaw && quotedAuthorJid) {
      try {
        const autorCita = await resolverCliente({
          grupoId: contextoSala.grupoId,
          participantJid: quotedAuthorJid,
        });
        if (autorCita && autorCita.id) {
          const anCita = analizarYEstandarizarJugada(
            quotedTextRaw,
            autorCita.saldo_disponible,
            [],
            16,
            autorCita.nombreJugador
          );
          if (anCita.esIntencionDeJugada && anCita.valido) {
            const { data: propExistente } = await supabaseAdmin
              .from("chat_mensajes")
              .select("*")
              .eq("sala_id", contextoSala.salaId)
              .eq("remitente_id", autorCita.id)
              .eq("jugada_estandarizada", anCita.jugadaEstandarizada)
              .in("tipo_mensaje", ["propuesta_jugada", "PROPUESTA"])
              .in("estado_propuesta", ["abierta", "parcial"])
              .gt("monto_disponible", 0)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();

            if (propExistente) {
              propMsg = propExistente;
            } else if (autorCita.libre || autorCita.saldo_disponible > 0) {
              const montoPubCita = Number(anCita.montoDisponibleValido ?? anCita.monto ?? 0);
              if (montoPubCita > 0) {
                const rawFirmaCita = `PROPUESTA_REC:${contextoSala.salaId}:${autorCita.id}:${quotedMsgId}:${Date.now()}`;
                const firmaCita = crypto.createHash("sha256").update(rawFirmaCita).digest("hex");
                const { data: propRecuperada } = await supabaseAdmin
                  .from("chat_mensajes")
                  .insert({
                    grupo_id: contextoSala.grupoId,
                    sala_id: contextoSala.salaId,
                    remitente_id: autorCita.id,
                    remitente_nombre: autorCita.nombreJugador,
                    es_operador: false,
                    tipo_mensaje: "propuesta_jugada",
                    contenido: anCita.jugadaEstandarizada,
                    carrera_id:
                      contextoSala.sala?.carrera_activa_id || contextoSala.carreraActivaId || null,
                    accion_proponente: anCita.accionProponente || "JUEGA",
                    es_match: Boolean(anCita.esMatch),
                    modalidad_jugada: anCita.modalidad,
                    ejemplar_numero: anCita.ejemplarTexto,
                    caballos_bando_a:
                      anCita.caballosBandoA ||
                      (anCita.ejemplarTexto ? [anCita.ejemplarTexto] : []),
                    caballos_bando_b: anCita.caballosBandoB || [],
                    jugada_estandarizada: anCita.jugadaEstandarizada,
                    monto_original: montoPubCita,
                    monto_disponible: montoPubCita,
                    estado_propuesta: "abierta",
                    proporcion_premio: anCita.proporcion || "1x1",
                    firma_sha256: firmaCita,
                    whatsapp_msg_id: quotedMsgId || null,
                    whatsapp_group_jid: groupJid || null,
                    whatsapp_group_nombre: whatsappGroupNombre || null,
                    origen_canal: "WHATSAPP",
                  })
                  .select("*")
                  .maybeSingle();
                if (propRecuperada) {
                  propMsg = propRecuperada;
                }
              }
            }
          }
        }
      } catch {}
    }
  }

  if (
    !propMsg ||
    (propMsg.tipo_mensaje !== "propuesta_jugada" && propMsg.tipo_mensaje !== "PROPUESTA")
  ) {
    if (ampConCitaPre.esAmpliacion) {
      if (!contextoSala.carreraAbierta) {
        return {
          ok: false,
          tipo: "CARRERA_CERRADA",
          respuestaGrupo: `⛔ La carrera se encuentra ${String(contextoSala.sala.estado_carrera || "CERRADA").toUpperCase()}. No se admiten concreciones.`,
          mensajePrivadoAutor: null,
        };
      }
      return await ejecutarAmpliacionCupo({
        contextoSala,
        cliente,
        quotedPropuestaId: quotedMsgId,
        nuevoTope: ampConCitaPre.nuevoTope,
        whatsappMsgId,
        groupJid,
        whatsappGroupNombre,
        participantJid,
      });
    }
    const cmdRetiroSinProp = analizarComandoRetiro(texto);
    if (cmdRetiroSinProp.esComandoRetiro && cmdRetiroSinProp.esValido) {
      await ejecutarRetiroPropuestasSeFue({
        grupoId: contextoSala.grupoId,
        salaId: contextoSala.salaId,
        jugadorId: cliente.id,
        propuestaId: null,
      });
      return {
        ok: true,
        tipo: "RETIRO_PROPUESTAS",
        respuestaGrupo: null,
        mensajePrivadoAutor: "✅ Todas tus propuestas abiertas fueron retiradas.",
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

  // 1. Comando de retiro de propuesta citada ("Se Fue" por su autor o por aceptante en cola/parcial)
  const cmdRetiroCita = analizarComandoRetiro(texto);
  if (cmdRetiroCita.esComandoRetiro) {
    // Validación de carrera: La carrera debe estar abierta (si ya cerró, no hace nada)
    if (!contextoSala.carreraAbierta) {
      return {
        ok: true,
        tipo: "IGNORADO",
        respuestaGrupo: null,
        msg_publico: null,
        msg_publico_bot: null,
        respuestaPublica: null,
        mensajePrivadoAutor: null,
        msg_privado_bot: null,
      };
    }

    if (!cmdRetiroCita.esValido) {
      return {
        ok: false,
        tipo: "PEDAGOGICO",
        respuestaGrupo: null,
        mensajePrivadoAutor:
          cmdRetiroCita.mensajeAclaratoria ||
          "Por favor aclara si deseas retirar tus jugadas con: 'Se fue', 'sf' o 'cf'",
      };
    }

    const resSeFue = await ejecutarRetiroPropuestasSeFue({
      grupoId: contextoSala.grupoId,
      salaId: contextoSala.salaId,
      jugadorId: cliente.id,
      propuestaId: propMsg.id,
    });

    if (!resSeFue.ok) {
      if (resSeFue.error === "NO_ES_PROPONENTE") {
        return {
          ok: false,
          tipo: "NO_AUTORIZADO",
          respuestaGrupo: null,
          mensajePrivadoAutor: "⚠️ Solo el autor de la propuesta o un jugador con remanente pendiente puede retirarla con 'Se fue'.",
        };
      }
      return {
        ok: false,
        tipo: "ERROR_RETIRO",
        respuestaGrupo: null,
        msg_publico_bot: null,
        msg_privado_bot: null,
        clienteTelefono: resolverTelefonoWhatsappCliente(cliente.rawCliente),
        error: resSeFue.error || "No se pudo retirar la propuesta",
      };
    }

    await emitirBroadcastSala(contextoSala.salaId, "nuevo_mensaje", { salaId: contextoSala.salaId });

    return {
      ok: true,
      tipo: "RETIRO_PROPUESTA_ESPECIFICA",
      respuestaGrupo: null,
      msg_publico: null,
      msg_publico_bot: null,
      respuestaPublica: null,
      msg_privado_bot: null,
      mensajePrivadoAutor: null,
      clienteTelefono: resolverTelefonoWhatsappCliente(cliente.rawCliente),
      senderJid: participantJid,
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

  // 2. Auto-concreción o ampliación ("Jugue con Todos", "Todos", etc.)
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
        participantJid,
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

    // Si la propuesta fue retirada con "Se fue" y un usuario le responde que jugaron o un monto parcial
    if (estadoProp === "cancelada" || estadoProp === "se_fue") {
      if (esIntentoConcrecionOMontoParcial(texto)) {
        const msgSeFue = "🚫Nada aquí, Se fue.";
        await supabaseAdmin.from("chat_mensajes").insert({
          grupo_id: contextoSala.grupoId,
          sala_id: contextoSala.salaId,
          remitente_nombre: "🤖 ASISTENTE DE SALA",
          es_operador: true,
          tipo_mensaje: "concrecion_fifo",
          contenido: msgSeFue,
          whatsapp_msg_id: whatsappMsgId || null,
          whatsapp_group_jid: groupJid || null,
          whatsapp_group_nombre: whatsappGroupNombre || null,
          origen_canal: "WHATSAPP",
        });
        await emitirBroadcastSala(contextoSala.salaId, "nuevo_mensaje", { salaId: contextoSala.salaId });
        return {
          ok: false,
          tipo: "PROPUESTA_SE_FUE",
          nada_aqui: true,
          respuestaGrupo: msgSeFue,
          msg_publico: msgSeFue,
          msg_publico_bot: msgSeFue,
          respuestaPublica: msgSeFue,
          mensajePrivadoAutor: null,
          msg_privado_bot: null,
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

    // Asegurar que saldo_retenido refleje únicamente jugadas concretadas activas (nunca propuestas no concretadas)
    if (proponenteRow && !proponenteRow.libre && Number(proponenteRow.saldo_retenido || 0) > 0) {
      const retCasadasProp = await calcularRiesgoTicketsCasadosActivos(
        String(proponenteRow.id),
        contextoSala.grupoId
      );
      if (retCasadasProp < Number(proponenteRow.saldo_retenido || 0)) {
        proponenteRow.saldo_retenido = retCasadasProp;
        proponenteRow.saldo_disponible = Math.max(
          0,
          Number(
            (
              Number(proponenteRow.saldo_actual || 0) +
              Number(proponenteRow.aval || 0) -
              retCasadasProp
            ).toFixed(2)
          )
        );
      }
    }

    if (aceptanteFresco && !aceptanteFresco.libre && Number(aceptanteFresco.saldo_retenido || 0) > 0) {
      const retCasadasAcep = await calcularRiesgoTicketsCasadosActivos(
        String(aceptanteFresco.id),
        contextoSala.grupoId
      );
      if (retCasadasAcep < Number(aceptanteFresco.saldo_retenido || 0)) {
        aceptanteFresco.saldo_retenido = retCasadasAcep;
        aceptanteFresco.saldo_disponible = Math.max(
          0,
          Number(
            (
              Number(aceptanteFresco.saldo_actual || 0) +
              Number(aceptanteFresco.aval || 0) -
              retCasadasAcep
            ).toFixed(2)
          )
        );
      }
    }

    const accionProp: "JUEGA" | "CONSIGUE" =
      String(propFresca.accion_proponente || "").toUpperCase() === "CONSIGUE" ||
      /^(consigo|doy)\b/i.test(String(propFresca.contenido || ""))
        ? "CONSIGUE"
        : "JUEGA";

    const refDisponibleEvaluacion =
      remanenteDisponible > 0
        ? remanenteDisponible
        : Math.max(100, Number(propFresca?.monto_original || 100));

    const { maxBaseAceptante, maxBaseProponente, saldoDispAceptante, saldoDispProponente } =
      calcularMaximosBilateral({
        remanenteDisponible: refDisponibleEvaluacion,
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

    // Si la propuesta ya agotó su cupo inicial (remanenteDisponible <= 0) pero sigue activa en la carrera
    // (ej. el 4to jugador que concreta con 30 después de 60 + 30 + 10 = 100), validar su jugada y saldo
    // y registrarlo en cola FIFO (estado = 'EN_COLA') a la espera de "Jugue con Todos" o "Todos".
    if (
      remanenteDisponible <= 0 ||
      (estadoProp !== "abierta" && estadoProp !== "parcial")
    ) {
      if (
        estadoProp === "cancelada" ||
        estadoProp === "se_fue" ||
        estadoProp === "anulada" ||
        estadoProp === "expirada"
      ) {
        return {
          ok: false,
          tipo: "PROPUESTA_AGOTADA",
          respuestaGrupo: `⚠️ Esta parada ya fue tomada al 100% o no tiene saldo disponible.`,
          mensajePrivadoAutor: null,
        };
      }

      const evalCola = evaluarConcrecionEstricta(
        texto,
        accionProp,
        Number(propFresca?.monto_original || 100),
        Math.max(0, maxBaseAceptante),
        cliente.nombreJugador,
        undefined,
        contextoSala.codigoSala,
        true
      );

      if (!evalCola.valido) {
        return {
          ok: false,
          tipo: "PEDAGOGICO",
          respuestaGrupo: null,
          mensajePrivadoAutor:
            evalCola.motivoRechazo || "Palabra no autorizada para concretar esta jugada.",
        };
      }

      const apuestaMinimaCola = contextoSala.apuestaMinima;
      if (evalCola.montoSolicitado < apuestaMinimaCola) {
        const msgMinimoBot = `⛔ *Nada aquí* — El monto mínimo de apuesta es $${apuestaMinimaCola.toFixed(2)}`;
        return {
          ok: false,
          tipo: "APUESTA_MINIMA",
          nada_aqui: true,
          respuestaGrupo: msgMinimoBot,
          msg_publico: msgMinimoBot,
          msg_publico_bot: msgMinimoBot,
          respuestaPublica: msgMinimoBot,
          mensajePrivadoAutor: `El monto mínimo de apuesta configurado es $${apuestaMinimaCola.toFixed(2)}.`,
          senderJid: participantJid,
        };
      }

      const montoEnCola = Math.min(evalCola.montoSolicitado, maxBaseAceptante);
      const codigoTicketCola = `TK-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const ordenFifoCola = await obtenerSiguienteOrdenFifo(propFresca.id);

      await supabaseAdmin.from("chat_tickets_fifo").insert({
        codigo_ticket: codigoTicketCola,
        orden_fifo: ordenFifoCola,
        grupo_id: contextoSala.grupoId,
        sala_id: contextoSala.salaId,
        carrera_id:
          propFresca.carrera_id ||
          contextoSala.sala?.carrera_activa_id ||
          contextoSala.carreraActivaId ||
          null,
        propuesta_msg_id: propFresca.id,
        proponente_id: propFresca.remitente_id,
        proponente_nombre:
          proponenteRow?.seudonimo ||
          proponenteRow?.nombre ||
          propFresca.remitente_nombre ||
          "Proponente",
        aceptante_id: cliente.id,
        aceptante_nombre: cliente.nombreJugador,
        accion_proponente: accionProp,
        es_match: Boolean(propFresca.es_match),
        modalidad:
          propFresca.modalidad_jugada ||
          propFresca.modalidad_propuesta ||
          propFresca.modalidad ||
          "1P",
        ejemplar_numero:
          propFresca.ejemplar_numero ||
          propFresca.ejemplar_texto ||
          (Array.isArray(propFresca.caballos_bando_a) ? propFresca.caballos_bando_a[0] : "1"),
        caballos_bando_a: propFresca.caballos_bando_a || [],
        caballos_bando_b: propFresca.caballos_bando_b || [],
        proporcion_premio: propFresca.proporcion_premio || "1x1",
        monto_solicitado: montoEnCola,
        monto_concretado: 0,
        monto_pendiente_ampliacion: montoEnCola,
        fue_ajuste_parcial: true,
        riesgo_proponente: 0,
        riesgo_aceptante: 0,
        estado: "EN_COLA",
        whatsapp_concrecion_msg_id: whatsappMsgId || null,
      });

      return {
        ok: true,
        tipo: "CONCRECION_EN_COLA",
        respuestaGrupo: null,
        msg_publico: null,
        msg_publico_bot: null,
        respuestaPublica: null,
        mensajePrivadoAutor: null,
        msg_privado_bot: null,
        senderJid: participantJid,
        datos: {
          propuestaId: propFresca.id,
          montoConcretado: 0,
          montoPendienteAmpliacion: montoEnCola,
          remanenteDisponible: 0,
          excedioSaldo: evalCola.excedioSaldo,
        },
      };
    }

    // Evaluar palabras estrictas según diccionario direccional (con soporte de monto parcial suelto al citar)
    const evalConcrecion = evaluarConcrecionEstricta(
      texto,
      accionProp,
      remanenteDisponible,
      Math.max(0, Math.min(maxBaseAceptante, maxBaseProponente)),
      cliente.nombreJugador,
      undefined,
      contextoSala.codigoSala,
      true
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

    // Protección contra carrera_id nulo en la propuesta y en la sala
    const carreraEfectivaId = propFresca?.carrera_id || contextoSala.sala?.carrera_activa_id || contextoSala.carreraActivaId;
    if (!carreraEfectivaId) {
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
        }
      }

      if (carreraId) {
        await supabaseAdmin
          .from("salas_juego")
          .update({ carrera_activa_id: carreraId, updated_at: new Date().toISOString() })
          .eq("id", contextoSala.salaId);
        if (contextoSala.sala) contextoSala.sala.carrera_activa_id = carreraId;
        contextoSala.carreraActivaId = carreraId;

        if (propFresca?.id && !propFresca.carrera_id) {
          await supabaseAdmin
            .from("chat_mensajes")
            .update({ carrera_id: carreraId })
            .eq("id", propFresca.id);
          propFresca.carrera_id = carreraId;
        }
      }
    } else if (propFresca?.id && !propFresca.carrera_id && carreraEfectivaId) {
      await supabaseAdmin
        .from("chat_mensajes")
        .update({ carrera_id: carreraEfectivaId })
        .eq("id", propFresca.id);
      propFresca.carrera_id = carreraEfectivaId;
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

    const montoSolicitadoReal = Number(evalConcrecion.montoSolicitado || montoEfectivo);
    const topeSolicitadoAceptante = Math.min(montoSolicitadoReal, maxBaseAceptante);
    const fueRecortadoPorRemanente =
      montoSolicitadoReal > remanenteDisponible &&
      montoEfectivo === remanenteDisponible &&
      Math.min(maxBaseAceptante, maxBaseProponente) >= remanenteDisponible;
    const montoPendienteAmpliacion = fueRecortadoPorRemanente
      ? Math.max(0, Number((topeSolicitadoAceptante - montoEfectivo).toFixed(2)))
      : 0;

    // Fallback determinístico si el RPC no fue exitoso (ej. sqlstate 23502 por orden_fifo en chat_tickets_fifo)
    if (!rpcExitoso) {
      try {
        const ordenFifoFallback = await obtenerSiguienteOrdenFifo(propFresca.id);
        const codigoTicketFallback = `TK-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
        const propRawFb = String(propFresca.proporcion_premio || propFresca.proporcion || "1x1").trim();
        const riesgoPropFb = calcularRiesgoReal(montoEfectivo, propRawFb, accionProp, "PROPONENTE");
        const riesgoAcepFb = calcularRiesgoReal(montoEfectivo, propRawFb, accionProp, "ACEPTANTE");

        await supabaseAdmin
          .from("chat_mensajes")
          .update({
            monto_disponible: nuevoRemanente,
            estado_propuesta: nuevoRemanente <= 0 ? "concretada" : "parcial",
          })
          .eq("id", propFresca.id);

        const { data: tkInsertado, error: errInsertTk } = await supabaseAdmin
          .from("chat_tickets_fifo")
          .insert({
            codigo_ticket: codigoTicketFallback,
            orden_fifo: ordenFifoFallback,
            grupo_id: contextoSala.grupoId,
            sala_id: contextoSala.salaId,
            carrera_id:
              propFresca.carrera_id ||
              contextoSala.sala?.carrera_activa_id ||
              contextoSala.carreraActivaId ||
              null,
            propuesta_msg_id: propFresca.id,
            proponente_id: propFresca.remitente_id,
            proponente_nombre:
              proponenteRow?.seudonimo ||
              proponenteRow?.nombre ||
              propFresca.remitente_nombre ||
              "Proponente",
            aceptante_id: cliente.id,
            aceptante_nombre: cliente.nombreJugador,
            accion_proponente: accionProp,
            es_match: Boolean(propFresca.es_match),
            modalidad:
              propFresca.modalidad_jugada ||
              propFresca.modalidad_propuesta ||
              propFresca.modalidad ||
              "1P",
            ejemplar_numero:
              propFresca.ejemplar_numero ||
              propFresca.ejemplar_texto ||
              (Array.isArray(propFresca.caballos_bando_a) ? propFresca.caballos_bando_a[0] : "1"),
            caballos_bando_a: propFresca.caballos_bando_a || [],
            caballos_bando_b: propFresca.caballos_bando_b || [],
            proporcion_premio: propRawFb,
            monto_solicitado: topeSolicitadoAceptante,
            monto_concretado: montoEfectivo,
            monto_pendiente_ampliacion: montoPendienteAmpliacion,
            fue_ajuste_parcial: montoPendienteAmpliacion > 0 || montoEfectivo < montoSolicitadoReal,
            riesgo_proponente: riesgoPropFb,
            riesgo_aceptante: riesgoAcepFb,
            estado: "ACTIVO",
            whatsapp_concrecion_msg_id: whatsappMsgId || null,
          })
          .select("id")
          .maybeSingle();

        if (!errInsertTk && tkInsertado?.id) {
          rpcExitoso = true;
          resRpcData = {
            ok: true,
            ticket_id: tkInsertado.id,
            codigo_ticket: codigoTicketFallback,
            monto_concretado: montoEfectivo,
            remanente_propuesta: nuevoRemanente,
          };
        } else if (errInsertTk) {
          console.error("[CONCRETAR_FALLBACK_ERR]", errInsertTk);
        }
      } catch (errFbConcretar) {
        console.error("[CONCRETAR_FALLBACK_CATCH]", errFbConcretar);
      }
    }

    if (!rpcExitoso) {
      const error = errorConcretar ?? "RPC concretar_jugada_fifo_atomica sin ok=true";
      console.error("[CONCRETAR_ERROR]", error);
      const codigoError = (errorConcretar as any)?.code ? ` (${(errorConcretar as any).code})` : "";
      const msgErrPub =
        (resRpcData as any)?.msg_publico ||
        (resRpcData as any)?.msg_publico_bot ||
        (resRpcData as any)?.respuestaPublica ||
        `🚫 *Error al concretar jugada*${codigoError} — Intente nuevamente.`;
      const msgErrPriv =
        (resRpcData as any)?.msg_privado_aceptante ||
        (resRpcData as any)?.msg_privado_bot ||
        (resRpcData as any)?.alertaPrivada ||
        `La concreción no pudo ser procesada por el motor atómico${codigoError}.`;
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

    // Registrar monto_solicitado real, monto_pendiente_ampliacion y whatsapp_concrecion_msg_id en el ticket recién creado
    try {
      let ticketIdCreado = (resRpcData as any)?.ticket_id || null;
      if (!ticketIdCreado) {
        const { data: ultTk } = await supabaseAdmin
          .from("chat_tickets_fifo")
          .select("id")
          .eq("propuesta_msg_id", propFresca.id)
          .eq("aceptante_id", cliente.id)
          .neq("estado", "ANULADO")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        ticketIdCreado = ultTk?.id || null;
      }
      if (ticketIdCreado) {
        await supabaseAdmin
          .from("chat_tickets_fifo")
          .update({
            monto_solicitado: topeSolicitadoAceptante,
            monto_concretado: montoEfectivo,
            monto_pendiente_ampliacion: montoPendienteAmpliacion,
            fue_ajuste_parcial: montoPendienteAmpliacion > 0 || montoEfectivo < montoSolicitadoReal,
            ...(whatsappMsgId ? { whatsapp_concrecion_msg_id: whatsappMsgId } : {}),
          })
          .eq("id", ticketIdCreado);
      }
    } catch {}

    const registroTaquilla = await sincronizarTicketsPropuestaATaquilla(supabaseAdmin, {
      propuestaMsgId: propFresca.id,
      sala: contextoSala.sala,
      grupoId: contextoSala.grupoId,
      condicionProponente: propFresca.condicion_proponente,
      carreraAbierta: contextoSala.carreraAbierta,
      montoAConcretar: montoEfectivo,
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

    // Garantizar saldo_retenido y saldo_disponible exactos para proponente y aceptante y recortar propuestas abiertas restantes
    if (proponenteRow && !proponenteRow.libre && !registroTaquilla.clientesJuegaCompensados.has(String(proponenteRow.id))) {
      const nuevoRetProp = Math.max(0, Number((Number(proponenteRow.saldo_retenido || 0) + riesgoProponente).toFixed(2)));
      const nuevoDispProp = Math.max(
        0,
        Number((Number(proponenteRow.saldo_actual || 0) + Number(proponenteRow.aval || 0) - nuevoRetProp).toFixed(2))
      );
      await supabaseAdmin
        .from("clientes")
        .update({ saldo_retenido: nuevoRetProp, saldo_disponible: nuevoDispProp })
        .eq("id", proponenteRow.id);
      await recortarPropuestasAbiertasPorSaldo({
        salaId: contextoSala.salaId,
        jugadorId: String(proponenteRow.id),
        nuevoSaldoDisponible: nuevoDispProp,
        esLibre: false,
      });
    }

    const rowAcep = aceptanteFresco || cliente.rawCliente;
    if (rowAcep && !rowAcep.libre && !registroTaquilla.clientesJuegaCompensados.has(String(cliente.id))) {
      const nuevoRetAcep = Math.max(0, Number((Number(rowAcep.saldo_retenido || 0) + riesgoAceptante).toFixed(2)));
      const nuevoDispAcep = Math.max(
        0,
        Number((Number(rowAcep.saldo_actual || 0) + Number(rowAcep.aval || 0) - nuevoRetAcep).toFixed(2))
      );
      await supabaseAdmin
        .from("clientes")
        .update({ saldo_retenido: nuevoRetAcep, saldo_disponible: nuevoDispAcep })
        .eq("id", cliente.id);
      await recortarPropuestasAbiertasPorSaldo({
        salaId: contextoSala.salaId,
        jugadorId: String(cliente.id),
        nuevoSaldoDisponible: nuevoDispAcep,
        esLibre: false,
      });
    }

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

    const esConcrecionSaldoParcial =
      !fueRecortadoPorRemanente &&
      llenoRemanenteParcial &&
      montoEfectivo > 0 &&
      montoEfectivo < montoSolicitadoReal;
    const nombreLimitador =
      pozoLimitadorBilateral ||
      (maxBaseAceptante <= maxBaseProponente ? nombreDa : nombreJuega);

    const msgPublicoFinal = fueRecortadoPorRemanente
      ? `Jugo ${formatearMontoRegional(montoEfectivo)}, Es lo que queda`
      : esConcrecionSaldoParcial
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
        montoPendienteAmpliacion,
      },
    };
  });
}
