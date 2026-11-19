import { supabaseAdmin } from "@/core/supabase-admin";
import {
  analizarYEstandarizarJugada,
  analizarBloqueJugadas,
  evaluarMensajePedagogico,
  analizarComandoRetiro,
  evaluarAmpliacionPropuesta,
  extraerMontoNumerico,
} from "@/features/sala-juegos/lib/parser-pedagogico";
import { formatearMontoRegional } from "@/shared/lib/dinero";
import {
  limpiarEtiquetasProhibidas,
} from "@/features/sala-juegos/lib/modalidades-progresivas";
import {
  cargarPlantillasGrupo,
  obtenerPlantillaGrupo,
} from "@/features/whatsapp/lib/plantillas-grupo-server";
import { variablesEncabezadoGrupo } from "@/features/whatsapp/lib/plantillas-grupo";
import { encabezadoGrupo } from "@/features/whatsapp/lib/encabezados-grupo";
import { resolverHipodromoEnTabla } from "./resolverSala";
import { resolverTelefonoWhatsappCliente, verificarEsOperador, CAMPOS_CLIENTE_SALA } from "./resolverCliente";
import { emitirBroadcastSala, respuestaSala, registrarMensajeChat } from "./notificador";
import {
  generarTextoPlanoOficial,
  construirResumenEstadoCuentaCliente,
  liquidarYSentenciarCarreraPlataforma,
} from "./accionesAdmin";
import type { ContextoSala, ClienteResuelto, JugadaParseada } from "./types";

export const AVISO_REDACCION_GRUPO = "⚠️¡Por favor, verificar redacción! ¡Gracias!";
export const RE_MONTO_INPUT = "(?:\\d+(?:[\\.,]\\d+)?\\s*(?:k|mil)?)";

export function sanitizarTexto(str: unknown): string {
  if (typeof str !== "string") return "";
  return str
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/[^\w\s.,!¡?¿$*+=\-()\[\]/@ªáéíóúÁÉÍÓÚñÑ]/gi, "")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean)
    .join("\n");
}

/**
 * Detecta si el texto entrante representa alguna acción, comando o intención de apuesta.
 */
export function detectarIntencionRapida(texto: string, quotedMsgId?: string | null, codigoSala?: string) {
  const textoUsuarioLimpio = String(texto || "").trim();
  const esComandoOp = textoUsuarioLimpio.startsWith("!");
  const cmdRetiroPre = analizarComandoRetiro(textoUsuarioLimpio);
  const esAmpliacionPre = evaluarAmpliacionPropuesta(textoUsuarioLimpio).esAmpliacion;
  const esConsultaSaldo = /^(?:!?(?:saldo|mi\s+saldo|ver\s+saldo))$/i.test(textoUsuarioLimpio);
  const esConsultaCuenta = /^(?:!?(?:cuenta|mi\s+cuenta|resumen|mi\s+resumen|estado\s+de\s+cuenta))$/i.test(textoUsuarioLimpio);
  const esComandoSaldosAdmin = /^(?:!?(?:saldos|ver\s+saldos|lista\s+saldos|todos\s+los\s+saldos))$/i.test(textoUsuarioLimpio);
  const esComandoPlano = /^(?:!?(?:plano|prejugadas))$/i.test(textoUsuarioLimpio);
  const esComandoCerrar = /^(?:!?(?:cerrar(?:\s+carrera)?|cerrada|cerrado|trancar|no\s+va\s+m[aá]s))$/i.test(textoUsuarioLimpio);
  const matchAbrirComando = textoUsuarioLimpio.match(/^(?:!)?(?:abrir|abierta)(?:\s+carrera)?(?:\s+(.+?))?(?:\s+(?:c(?:arrera)?\s*|#\s*)?(\d{1,2}))?$/i);
  const matchHipodromoComando = textoUsuarioLimpio.match(/^!?hip[óo]dromo\s+(.+)$/i);
  const matchRetirarCarreraComando = textoUsuarioLimpio.match(/^!retirar\s+(.+)$/i);
  const matchCreditoOperador = textoUsuarioLimpio.match(
    new RegExp(`^!(recargar|aval)\\s+(.+?)\\s+(${RE_MONTO_INPUT})$`, "i")
  );
  const matchPizarraComando = textoUsuarioLimpio.match(/^(?:!)?(?:llegada|sentenciar|pizarra)\s*[:=\-]?\s*([0-9\s,./·\-_]+)$/i);
  const matchRectificarComando = textoUsuarioLimpio.match(/^(?:!)?rectificar(?:\s+pizarra)?\s*[:=\-]?\s*([0-9\s,./·\-_]+)$/i);
  const esSolicitudCajero = /^(?:!?(?:deposito|depósito|reportar\s+pago|retiro|solicito\s+retiro|quiero\s+retirar|recarga|solicito\s+recarga))\b/i.test(textoUsuarioLimpio);
  const esAceptacionSinCita =
    !quotedMsgId &&
    new RegExp(
      `^(?:j|voy|ponte|juego|jugamos|jugue|jugué|copiado|pago|entro)(?:\\s+(?:con\\s+|por\\s+|\\$)?(${RE_MONTO_INPUT}))?$`,
      "i"
    ).test(textoUsuarioLimpio);
  const matchAjusteOperador = textoUsuarioLimpio.match(
    new RegExp(
      `^(?:!)?(?:(?:recargar?|abonar?|ajuste|cargar?)\\s+)?([a-zA-Z0-9áéíóúÁÉÍÓÚñÑ\\s._-]+?)\\s*([+-])\\s*(${RE_MONTO_INPUT})$`,
      "i"
    )
  );
  const preAnalisis = analizarYEstandarizarJugada(textoUsuarioLimpio, 999999, [], 16, undefined, undefined, codigoSala);

  const esAccionOJugada =
    Boolean(quotedMsgId) ||
    esComandoOp ||
    cmdRetiroPre.esComandoRetiro ||
    esAmpliacionPre ||
    esConsultaSaldo ||
    esConsultaCuenta ||
    esComandoSaldosAdmin ||
    esComandoPlano ||
    esComandoCerrar ||
    Boolean(matchAbrirComando) ||
    Boolean(matchPizarraComando) ||
    Boolean(matchRectificarComando) ||
    esSolicitudCajero ||
    esAceptacionSinCita ||
    Boolean(matchAjusteOperador) ||
    preAnalisis.esIntencionDeJugada;

  return {
    textoUsuarioLimpio,
    esComandoOp,
    cmdRetiroPre,
    esAmpliacionPre,
    esConsultaSaldo,
    esConsultaCuenta,
    esComandoSaldosAdmin,
    esComandoPlano,
    esComandoCerrar,
    matchAbrirComando,
    matchHipodromoComando,
    matchRetirarCarreraComando,
    matchCreditoOperador,
    matchPizarraComando,
    matchRectificarComando,
    esSolicitudCajero,
    esAceptacionSinCita,
    matchAjusteOperador,
    preAnalisis,
    esAccionOJugada,
  };
}

/**
 * Maneja intenciones de comandos de operador, consultas de saldo, cajero, plano y respuestas entrenadas.
 * Retorna una respuesta procesada (NextResponse) o null si el flujo debe continuar hacia jugadas/concreciones.
 */
export async function manejarIntencionComando(params: {
  contextoSala: ContextoSala;
  cliente: ClienteResuelto;
  texto: string;
  body: any;
  participantJid: string;
  whatsappMsgId?: string | null;
  groupJid?: string | null;
  whatsappGroupNombre?: string | null;
}): Promise<any | null> {
  const {
    contextoSala,
    cliente,
    texto,
    body,
    participantJid,
    whatsappMsgId,
    groupJid,
    whatsappGroupNombre,
  } = params;

  const { sala, salaId, grupoId } = contextoSala;
  const textoUsuarioLimpio = String(texto || "").trim();
  const nombreJugador = cliente.nombreJugador;
  const saldoDisponible = cliente.saldo_disponible;
  const quotedMsgId = body.quotedMsgId || null;

  // 1. REGLAS ENTRENADAS DE LA SALA DE JUEGOS
  if (!texto.trim().startsWith("!")) {
    try {
      const { data: dataEntrenada } = await supabaseAdmin.rpc(
        "evaluar_respuesta_entrenada_sala",
        {
          p_grupo_id: grupoId,
          p_jugador_id: cliente.id,
          p_texto: texto,
        }
      );

      if (
        dataEntrenada?.coincidencia === true &&
        (dataEntrenada.accion_sistema === "respuesta_directa" ||
          dataEntrenada.accion_sistema === "consultar_saldo")
      ) {
        const msgPublico = dataEntrenada.msg_publico || null;
        const msgPrivado = dataEntrenada.msg_privado || null;

        if (msgPublico) {
          await supabaseAdmin.from("chat_mensajes").insert({
            grupo_id: grupoId,
            sala_id: salaId,
            remitente_nombre: "🤖 ASISTENTE DE SALA",
            es_operador: true,
            tipo_mensaje: "bot_entrenado",
            contenido: msgPublico,
            whatsapp_msg_id: whatsappMsgId || null,
            whatsapp_group_jid: groupJid || null,
            whatsapp_group_nombre: whatsappGroupNombre || null,
            origen_canal: "WHATSAPP",
          });
          await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });
        }

        return respuestaSala({
          ok: true,
          tipo: "RESPUESTA_ENTRENADA",
          respuestaGrupo: msgPublico,
          msg_publico: msgPublico,
          msg_publico_bot: msgPublico,
          respuestaPublica: msgPublico,
          mensajePrivadoAutor: msgPrivado,
          msg_privado_bot: msgPrivado,
          alertaPrivada: null,
          notificaciones_privadas: [],
          senderJid: participantJid,
        });
      }
    } catch (errRpcEntrenada) {
      console.warn("[parsearJugada] Aviso evaluar_respuesta_entrenada_sala:", errRpcEntrenada);
    }
  }

  // 2. AJUSTE DE SALDO POR OPERADOR: [Nombre] +/- [Monto]
  const matchAjusteOperador = textoUsuarioLimpio.match(
    new RegExp(
      `^(?:!)?(?:(?:recargar?|abonar?|ajuste|cargar?)\\s+)?([a-zA-Z0-9áéíóúÁÉÍÓÚñÑ\\s._-]+?)\\s*([+-])\\s*(${RE_MONTO_INPUT})$`,
      "i"
    )
  );
  if (matchAjusteOperador) {
    const esOp =
      Boolean(body.esMensajePropioTelefono) ||
      Boolean(body.esOperador) ||
      (await verificarEsOperador(cliente?.id, cliente.telefono || participantJid, grupoId));
    if (esOp) {
      const targetNombre = matchAjusteOperador[1].trim();
      const signo = matchAjusteOperador[2];
      const montoRaw = matchAjusteOperador[3];
      const { monto } = extraerMontoNumerico(montoRaw);

      if (monto > 0) {
        const { data: candidatos } = await supabaseAdmin
          .from("clientes")
          .select(CAMPOS_CLIENTE_SALA)
          .eq("grupo_id", grupoId);

        const targetLimpio = targetNombre.toUpperCase();
        const targetCliente = (candidatos || []).find((c: any) => {
          const n = String(c.nombre || "").trim().toUpperCase();
          const s = String(c.seudonimo || "").trim().toUpperCase();
          return n === targetLimpio || s === targetLimpio || n.includes(targetLimpio) || (s && s.includes(targetLimpio));
        });

        if (targetCliente) {
          const saldoActual = Number(targetCliente.saldo_actual || 0);
          const delta = signo === "+" ? monto : -monto;
          const nuevoSaldo = Number((saldoActual + delta).toFixed(2));
          const nuevoDisponible = targetCliente.libre
            ? 999999
            : Math.max(
                0,
                Number((nuevoSaldo + Number(targetCliente.aval || 0) - Number(targetCliente.saldo_retenido || 0)).toFixed(2))
              );

          await supabaseAdmin
            .from("clientes")
            .update({
              saldo_actual: nuevoSaldo,
              saldo_disponible: nuevoDisponible,
              updated_at: new Date().toISOString(),
            })
            .eq("id", targetCliente.id);

          await supabaseAdmin.from("libro_mayor_clientes").insert({
            cliente_id: targetCliente.id,
            cliente_nombre: targetCliente.nombre,
            grupo_id: grupoId,
            tipo_movimiento: signo === "+" ? "DEPOSITO" : "RETIRO",
            monto_centavos: Math.round(monto * 100),
            monto: monto,
            observacion: "Ajuste operador WhatsApp",
            creado_por: body.pushName || "OPERADOR_WHATSAPP",
            fecha_carrera: new Date().toISOString().split("T")[0],
          });

          const nombreFinal = targetCliente.seudonimo || targetCliente.nombre;
          const msgPublico = `✅ Saldo actualizado para *${nombreFinal}*: Nuevo saldo $${formatearMontoRegional(nuevoSaldo)}`;
          const msgPrivado = `💰 Tu cuenta ha sido ${signo === "+" ? "acreditada" : "debitada"} con $${formatearMontoRegional(monto)}. Tu nuevo saldo disponible es $${formatearMontoRegional(nuevoDisponible)}.`;

          await supabaseAdmin.from("chat_mensajes").insert({
            grupo_id: grupoId,
            sala_id: salaId,
            remitente_nombre: "🤖 ASISTENTE DE SALA",
            es_operador: true,
            tipo_mensaje: "sistema",
            contenido: msgPublico,
            whatsapp_msg_id: whatsappMsgId || null,
            whatsapp_group_jid: groupJid || null,
            whatsapp_group_nombre: whatsappGroupNombre || null,
            origen_canal: "WHATSAPP",
          });
          await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });

          const jidTarget =
            targetCliente.whatsapp_jid ||
            (targetCliente.telefono_normalizado ? `${targetCliente.telefono_normalizado}@s.whatsapp.net` : null);

          return respuestaSala({
            ok: true,
            tipo: "AJUSTE_SALDO_OPERADOR",
            respuestaGrupo: msgPublico,
            msg_publico: msgPublico,
            msg_publico_bot: msgPublico,
            respuestaPublica: msgPublico,
            mensajePrivadoAutor: null,
            notificaciones_privadas: jidTarget ? [{ whatsapp_jid: jidTarget, mensaje: msgPrivado }] : [],
            senderJid: participantJid,
          });
        }
      }
    }
  }

  // 3. ACEPTACIÓN SIN CITA: "j", "voy", etc. sin citar mensaje
  const esAceptacionSinCita =
    !quotedMsgId &&
    new RegExp(
      `^(?:j|voy|ponte|juego|jugamos|jugue|jugué|copiado|pago|entro)(?:\\s+(?:con\\s+|por\\s+|\\$)?(${RE_MONTO_INPUT}))?$`,
      "i"
    ).test(textoUsuarioLimpio);
  if (esAceptacionSinCita) {
    const msgPubNada = "Nada aquí, verifique";
    const msgPrivNada = "⚠️ Para aceptar una jugada debes citar (responder directamente) la propuesta original.";

    await supabaseAdmin.from("chat_mensajes").insert({
      grupo_id: grupoId,
      sala_id: salaId,
      remitente_nombre: "🤖 ASISTENTE DE SALA",
      es_operador: true,
      es_bot: true,
      tipo_mensaje: "sistema",
      contenido: msgPubNada,
      whatsapp_msg_id: whatsappMsgId || null,
      whatsapp_group_jid: groupJid || null,
      whatsapp_group_nombre: whatsappGroupNombre || null,
      origen_canal: "WHATSAPP",
    });
    await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });

    return respuestaSala({
      ok: false,
      tipo: "ACEPTACION_SIN_CITA",
      nada_aqui: true,
      respuestaGrupo: msgPubNada,
      msg_publico: msgPubNada,
      msg_publico_bot: msgPubNada,
      respuestaPublica: msgPubNada,
      mensajePrivadoAutor: msgPrivNada,
      msg_privado_bot: msgPrivNada,
      senderJid: participantJid,
    });
  }

  // 4. SOLICITUD DE CAJERO / RECARGA / RETIRO
  const esSolicitudCajero = /^(?:!?(?:deposito|depósito|reportar\s+pago|retiro|solicito\s+retiro|quiero\s+retirar|recarga|solicito\s+recarga))\b/i.test(textoUsuarioLimpio);
  if (esSolicitudCajero) {
    const esRetiro = /retiro|quiero\s+retirar|solicito\s+retiro/i.test(textoUsuarioLimpio);
    const tipoOp = esRetiro ? "Retiro" : "Depósito";
    const msgPriv = esRetiro
      ? `🏧 *Solicitud de Retiro*\n\nHola *${nombreJugador}*, tu solicitud de retiro ha sido notificada al operador.\nTu saldo disponible actual es *$${formatearMontoRegional(saldoDisponible)}*.\nEl operador se comunicará contigo a la brevedad.`
      : `🏦 *Solicitud de Recarga / Depósito*\n\nHola *${nombreJugador}*, hemos recibido tu solicitud. Por favor envía el comprobante de pago o capture por este medio.\nEl operador revisará y acreditará tu saldo a la brevedad.`;

    const notifOp = `🔔 *Solicitud de ${tipoOp} de Jugador:*\n👤 *${nombreJugador}* (${cliente.telefono || "Sin teléfono"})\n💰 Saldo Disponible: $${formatearMontoRegional(saldoDisponible)}\nPara procesar escribe: *${nombreJugador} +[MONTO]* o *${nombreJugador} -[MONTO]*`;

    return respuestaSala({
      ok: true,
      tipo: "SOLICITUD_CAJERO",
      respuestaGrupo: null,
      msg_publico: null,
      mensajePrivadoAutor: msgPriv,
      msg_privado_bot: msgPriv,
      notificaciones_privadas: [{ tipo: "operador", mensaje: notifOp }],
      senderJid: participantJid,
    });
  }

  // 5. LISTADO DE SALDOS ADMIN
  const esComandoSaldosAdmin = /^(?:!?(?:saldos|ver\s+saldos|lista\s+saldos|todos\s+los\s+saldos))$/i.test(textoUsuarioLimpio);
  if (esComandoSaldosAdmin) {
    const esOp =
      Boolean(body.esMensajePropioTelefono) ||
      Boolean(body.esOperador) ||
      (await verificarEsOperador(cliente?.id, cliente.telefono || participantJid, grupoId));
    if (esOp) {
      const { data: listaCl } = await supabaseAdmin
        .from("clientes")
        .select("id, nombre, seudonimo, saldo_actual, saldo_disponible, libre")
        .eq("grupo_id", grupoId)
        .order("nombre", { ascending: true });

      const lineas = (listaCl || [])
        .map((c) => {
          const nom = c.seudonimo || c.nombre || "Jugador";
          const actual = formatearMontoRegional(Number(c.saldo_actual || 0));
          const disp = formatearMontoRegional(Number(c.saldo_disponible || 0));
          return `• *${nom}*: $${actual} ${c.libre ? "(Libre)" : `(Disp: $${disp})`}`;
        })
        .join("\n");

      const msgSaldos = `📊 *LISTADO OFICIAL DE SALDOS*\n━━━━━━━━━━━━━━━━━━━━━━\n${lineas || "_No hay jugadores registrados en este grupo._"}`;

      await supabaseAdmin.from("chat_mensajes").insert({
        grupo_id: grupoId,
        sala_id: salaId,
        remitente_nombre: "🤖 ASISTENTE DE SALA",
        es_operador: true,
        tipo_mensaje: "sistema",
        contenido: msgSaldos,
        whatsapp_msg_id: whatsappMsgId || null,
        whatsapp_group_jid: groupJid || null,
        whatsapp_group_nombre: whatsappGroupNombre || null,
        origen_canal: "WHATSAPP",
      });
      await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });

      return respuestaSala({
        ok: true,
        tipo: "LISTADO_SALDOS",
        respuestaGrupo: msgSaldos,
        msg_publico: msgSaldos,
        msg_publico_bot: msgSaldos,
        respuestaPublica: msgSaldos,
        mensajePrivadoAutor: null,
        senderJid: participantJid,
      });
    }
  }

  // 6. PLANO OFICIAL
  const esComandoPlano = /^(?:!?(?:plano|prejugadas))$/i.test(textoUsuarioLimpio);
  if (esComandoPlano) {
    const { data: ticketsPlano } = await supabaseAdmin
      .from("chat_tickets_fifo")
      .select("*")
      .eq("sala_id", salaId)
      .in("estado", ["PENDIENTE", "ACTIVO", "ABIERTO"])
      .order("created_at", { ascending: true });

    const { data: propsPlano } = await supabaseAdmin
      .from("chat_mensajes")
      .select("remitente_nombre, jugada_estandarizada, contenido, monto_disponible")
      .eq("sala_id", salaId)
      .in("tipo_mensaje", ["propuesta_jugada", "PROPUESTA"])
      .in("estado_propuesta", ["abierta", "parcial"])
      .gt("monto_disponible", 0)
      .order("created_at", { ascending: true });

    let retiradosLista: string[] = [];
    if (sala.carrera_activa_id) {
      try {
        const { data: cRow } = await supabaseAdmin
          .from("carreras")
          .select("ejemplares_retirados")
          .eq("id", sala.carrera_activa_id)
          .maybeSingle();
        if (cRow?.ejemplares_retirados && Array.isArray(cRow.ejemplares_retirados)) {
          retiradosLista = cRow.ejemplares_retirados;
        }
      } catch {}
    }

    const planoTexto = await generarTextoPlanoOficial(sala, ticketsPlano || [], propsPlano || [], retiradosLista);

    await supabaseAdmin.from("chat_mensajes").insert({
      grupo_id: grupoId,
      sala_id: salaId,
      remitente_nombre: "🤖 ASISTENTE DE SALA",
      es_operador: true,
      tipo_mensaje: "sistema",
      contenido: planoTexto,
      whatsapp_msg_id: whatsappMsgId || null,
      whatsapp_group_jid: groupJid || null,
      whatsapp_group_nombre: whatsappGroupNombre || null,
      origen_canal: "WHATSAPP",
    });
    await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });

    return respuestaSala({
      ok: true,
      tipo: "PLANO_OFICIAL",
      respuestaGrupo: planoTexto,
      msg_publico: planoTexto,
      msg_publico_bot: planoTexto,
      respuestaPublica: planoTexto,
      mensajePrivadoAutor: null,
      senderJid: participantJid,
    });
  }

  // 7. CIERRE DE CARRERA
  const esComandoCerrar = /^(?:!?(?:cerrar(?:\s+carrera)?|cerrada|cerrado|trancar|no\s+va\s+m[aá]s))$/i.test(textoUsuarioLimpio);
  if (esComandoCerrar) {
    const esOp =
      Boolean(body.esMensajePropioTelefono) ||
      Boolean(body.esOperador) ||
      (await verificarEsOperador(cliente?.id, cliente.telefono || participantJid, grupoId));
    if (esOp) {
      await supabaseAdmin
        .from("salas_juego")
        .update({
          estado_carrera: "cerrada",
          carrera_recien_cerrada_id: sala.carrera_activa_id || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", salaId);

      const hipo = String(sala.hipodromo_activo || "HIPÓDROMO").toUpperCase();
      const numCarrera = sala.numero_carrera_activa || 1;
      const mapaCierreChat = await cargarPlantillasGrupo(sala?.grupo_id || grupoId);
      const msgCierre = obtenerPlantillaGrupo(
        mapaCierreChat,
        "cierre_carrera",
        {
          ...variablesEncabezadoGrupo(sala, "cierre"),
          hipodromo: hipo,
          carrera: numCarrera,
        },
        `${encabezadoGrupo(sala, "cierre")}\n🔒 *${hipo} CARRERA ${numCarrera} CERRADA* — No más jugadas. Suerte a todos.`
      );

      await supabaseAdmin.from("chat_mensajes").insert({
        grupo_id: grupoId,
        sala_id: salaId,
        remitente_nombre: "🤖 ASISTENTE DE SALA",
        es_operador: true,
        tipo_mensaje: "sistema",
        contenido: msgCierre,
        whatsapp_msg_id: whatsappMsgId || null,
        whatsapp_group_jid: groupJid || null,
        whatsapp_group_nombre: whatsappGroupNombre || null,
        origen_canal: "WHATSAPP",
      });
      await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });

      return respuestaSala({
        ok: true,
        tipo: "CIERRE_CARRERA",
        respuestaGrupo: msgCierre,
        msg_publico: msgCierre,
        msg_publico_bot: msgCierre,
        respuestaPublica: msgCierre,
        mensajePrivadoAutor: null,
        senderJid: participantJid,
      });
    }
  }

  // 8. APERTURA DE CARRERA
  const matchAbrirComando = textoUsuarioLimpio.match(
    /^(?:!)?(?:abrir|abierta)(?:\s+carrera)?(?:\s+(.+?))?(?:\s+(?:c(?:arrera)?\s*|#\s*)?(\d{1,2}))?$/i
  );
  if (matchAbrirComando && (/^(?:!)?abrir/i.test(textoUsuarioLimpio) || /^(?:!)?abierta/i.test(textoUsuarioLimpio))) {
    const esOp =
      Boolean(body.esMensajePropioTelefono) ||
      Boolean(body.esOperador) ||
      (await verificarEsOperador(cliente?.id, cliente.telefono || participantJid, grupoId));
    if (esOp) {
      const parteArgumentos = textoUsuarioLimpio.replace(/^!?(?:abrir|abierta)(?:\s+carrera)?\s*/i, "").trim();
      const matchRetApertura = parteArgumentos.match(/(?:^|\s)ret(?:irados?)?\s*[:=]?\s*([0-9\s,./·#-]+)$/i);
      const retiradosApertura = matchRetApertura
        ? matchRetApertura[1]
            .split(/[\s,]+/)
            .map((x) => x.replace(/^#/, "").trim())
            .filter(Boolean)
        : [];
      const argumentosSinRet = matchRetApertura
        ? parteArgumentos.slice(0, matchRetApertura.index).trim()
        : parteArgumentos;
      const matchAbrirBase = argumentosSinRet
        ? `!abrir ${argumentosSinRet}`.match(
            /^(?:!)?(?:abrir|abierta)(?:\s+carrera)?(?:\s+(.+?))?(?:\s+(?:c(?:arrera)?\s*|#\s*)?(\d{1,2}))?$/i
          )
        : matchAbrirComando;

      let posibleHipo = ((matchAbrirBase as RegExpMatchArray | null)?.[1] || "").trim();
      let posibleCarrera = ((matchAbrirBase as RegExpMatchArray | null)?.[2] || "").trim();
      if (!posibleCarrera && /^\d{1,2}$/.test(posibleHipo)) {
        posibleCarrera = posibleHipo;
        posibleHipo = "";
      }
      const hipoSolicitado = String(posibleHipo || sala.hipodromo_activo || "LA RINCONADA").trim();
      const hipoTab = await resolverHipodromoEnTabla(hipoSolicitado);
      if (posibleHipo && !hipoTab) {
        const msgErrHipo = limpiarEtiquetasProhibidas(
          `⚠️ El hipódromo "${hipoSolicitado}" no está registrado en la tabla oficial. No se abrió la carrera.`
        );
        return respuestaSala({
          ok: false,
          tipo: "HIPODROMO_NO_REGISTRADO",
          respuestaGrupo: msgErrHipo,
          msg_publico: msgErrHipo,
          msg_publico_bot: msgErrHipo,
          respuestaPublica: msgErrHipo,
          mensajePrivadoAutor: null,
          senderJid: participantJid,
        });
      }
      const hipoLimpio = hipoTab?.nombre || hipoSolicitado.toUpperCase();
      const numCarrera = parseInt(posibleCarrera, 10) || parseInt(sala.numero_carrera_activa, 10) || 1;

      await supabaseAdmin
        .from("salas_juego")
        .update({
          hipodromo_activo: hipoLimpio,
          numero_carrera_activa: numCarrera,
          estado_carrera: "abierta",
          updated_at: new Date().toISOString(),
        })
        .eq("id", salaId);

      if (retiradosApertura.length > 0 && sala.carrera_activa_id) {
        try {
          await supabaseAdmin
            .from("carreras")
            .update({ ejemplares_retirados: retiradosApertura })
            .eq("id", sala.carrera_activa_id);
        } catch {}
      }

      const mapaAperturaChat = await cargarPlantillasGrupo(sala?.grupo_id || grupoId);
      const msgAbrir = limpiarEtiquetasProhibidas(
        obtenerPlantillaGrupo(
          mapaAperturaChat,
          "apertura_carrera",
          {
            ...variablesEncabezadoGrupo(sala, "apertura"),
            hipodromo: hipoLimpio,
            carrera: numCarrera,
            retirados:
              retiradosApertura.length > 0
                ? `\n🚫 Retirados: ${retiradosApertura.map((r) => `#${r}`).join(", ")}`
                : "",
          },
          `${encabezadoGrupo(sala, "apertura")}\n` +
            `🟢 *${hipoLimpio} CARRERA ${numCarrera} ABIERTA* — Hagan sus jugadas.` +
            (retiradosApertura.length > 0
              ? `\n🚫 Retirados: ${retiradosApertura.map((r) => `#${r}`).join(", ")}`
              : "")
        )
      );

      await supabaseAdmin.from("chat_mensajes").insert({
        grupo_id: grupoId,
        sala_id: salaId,
        remitente_nombre: "🤖 ASISTENTE DE SALA",
        es_operador: true,
        tipo_mensaje: "sistema",
        contenido: msgAbrir,
        whatsapp_msg_id: whatsappMsgId || null,
        whatsapp_group_jid: groupJid || null,
        whatsapp_group_nombre: whatsappGroupNombre || null,
        origen_canal: "WHATSAPP",
      });
      await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });

      return respuestaSala({
        ok: true,
        tipo: "APERTURA_CARRERA",
        respuestaGrupo: msgAbrir,
        msg_publico: msgAbrir,
        msg_publico_bot: msgAbrir,
        respuestaPublica: msgAbrir,
        mensajePrivadoAutor: null,
        senderJid: participantJid,
      });
    }
  }

  // 9. COMANDO HIPODROMO ACTIVO
  const matchHipodromoComando = textoUsuarioLimpio.match(/^!?hip[óo]dromo\s+(.+)$/i);
  if (matchHipodromoComando) {
    const esOp =
      Boolean(body.esMensajePropioTelefono) ||
      Boolean(body.esOperador) ||
      (await verificarEsOperador(cliente?.id, cliente.telefono || participantJid, grupoId));
    if (!esOp) {
      return respuestaSala({
        ok: false,
        tipo: "NO_AUTORIZADO",
        respuestaGrupo: null,
        mensajePrivadoAutor: "⚠️ No está autorizado para cambiar el hipódromo activo.",
        senderJid: participantJid,
      });
    }
    const nombreSolicitado = String(matchHipodromoComando[1] || "")
      .trim()
      .replace(/^["']|["']$/g, "");
    const hipoTab = await resolverHipodromoEnTabla(nombreSolicitado);
    if (!hipoTab) {
      const msgErrHipo = limpiarEtiquetasProhibidas(
        `⚠️ El hipódromo "${nombreSolicitado}" no está registrado en la tabla oficial.`
      );
      return respuestaSala({
        ok: false,
        tipo: "HIPODROMO_NO_REGISTRADO",
        respuestaGrupo: msgErrHipo,
        msg_publico: msgErrHipo,
        msg_publico_bot: msgErrHipo,
        respuestaPublica: msgErrHipo,
        mensajePrivadoAutor: null,
        senderJid: participantJid,
      });
    }
    await supabaseAdmin
      .from("salas_juego")
      .update({ hipodromo_activo: hipoTab.nombre, updated_at: new Date().toISOString() })
      .eq("id", salaId);
    sala.hipodromo_activo = hipoTab.nombre;

    const msgHipodromo = limpiarEtiquetasProhibidas(
      `📍 *HIPÓDROMO ACTIVO:* ${hipoTab.nombre} — Carrera ${sala.numero_carrera_activa || 1}.`
    );
    await supabaseAdmin.from("chat_mensajes").insert({
      grupo_id: grupoId,
      sala_id: salaId,
      remitente_nombre: "🤖 ASISTENTE DE SALA",
      es_operador: true,
      tipo_mensaje: "sistema",
      contenido: msgHipodromo,
      whatsapp_msg_id: whatsappMsgId || null,
      whatsapp_group_jid: groupJid || null,
      whatsapp_group_nombre: whatsappGroupNombre || null,
      origen_canal: "WHATSAPP",
    });
    await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });

    return respuestaSala({
      ok: true,
      tipo: "HIPODROMO_ACTIVO",
      respuestaGrupo: msgHipodromo,
      msg_publico: msgHipodromo,
      msg_publico_bot: msgHipodromo,
      respuestaPublica: msgHipodromo,
      mensajePrivadoAutor: null,
      senderJid: participantJid,
    });
  }

  // 10. RETIRAR EJEMPLAR
  const matchRetirarCarreraComando = textoUsuarioLimpio.match(/^!retirar\s+(.+)$/i);
  if (matchRetirarCarreraComando) {
    const esOp =
      Boolean(body.esMensajePropioTelefono) ||
      Boolean(body.esOperador) ||
      (await verificarEsOperador(cliente?.id, cliente.telefono || participantJid, grupoId));
    if (!esOp) {
      return respuestaSala({
        ok: false,
        tipo: "NO_AUTORIZADO",
        respuestaGrupo: null,
        mensajePrivadoAutor: "⚠️ No está autorizado para procesar retirados.",
        senderJid: participantJid,
      });
    }
    const ejemplar = String(matchRetirarCarreraComando[1] || "").trim().replace(/^#/, "");
    if (!ejemplar) {
      return respuestaSala({
        ok: false,
        tipo: "RETIRO_ARGUMENTOS",
        respuestaGrupo: limpiarEtiquetasProhibidas("⚠️ Uso correcto: !retirar [ejemplar]"),
        mensajePrivadoAutor: null,
        senderJid: participantJid,
      });
    }
    if (String(sala.estado_carrera || "").toLowerCase() === "liquidada") {
      return respuestaSala({
        ok: false,
        tipo: "CARRERA_LIQUIDADA",
        respuestaGrupo: limpiarEtiquetasProhibidas("⚠️ Carrera liquidada: reversa la liquidación antes de procesar retirados."),
        mensajePrivadoAutor: null,
        senderJid: participantJid,
      });
    }
    const carreraEfectivaId = sala.carrera_activa_id || sala.carrera_recien_cerrada_id || null;
    const { data: retRes, error: errRet } = await supabaseAdmin.rpc("procesar_retirado_en_sala", {
      p_grupo_id: grupoId,
      p_sala_id: salaId,
      p_carrera_id: carreraEfectivaId,
      p_ejemplar_retirado: ejemplar,
    });
    if (errRet || (retRes as any)?.ok === false) {
      const msgErrRetiro = limpiarEtiquetasProhibidas(
        `⚠️ No se pudo procesar el retiro del ejemplar #${ejemplar}: ${errRet?.message || (retRes as any)?.error || (retRes as any)?.motivo || "error desconocido"}`
      );
      return respuestaSala({
        ok: false,
        tipo: "ERROR_RETIRO_EJEMPLAR",
        respuestaGrupo: msgErrRetiro,
        msg_publico: msgErrRetiro,
        msg_publico_bot: msgErrRetiro,
        respuestaPublica: msgErrRetiro,
        mensajePrivadoAutor: null,
        senderJid: participantJid,
      });
    }
    const msgRetirado = limpiarEtiquetasProhibidas(
      `🚫 EJEMPLAR RETIRADO: Se ha procesado el retiro del ejemplar #${ejemplar}. Las jugadas pactadas han sido anuladas y los saldos restituidos.`
    );
    await supabaseAdmin.from("chat_mensajes").insert({
      grupo_id: grupoId,
      sala_id: salaId,
      remitente_nombre: "🤖 ASISTENTE DE SALA",
      es_operador: true,
      tipo_mensaje: "sistema",
      contenido: msgRetirado,
      whatsapp_msg_id: whatsappMsgId || null,
      whatsapp_group_jid: groupJid || null,
      whatsapp_group_nombre: whatsappGroupNombre || null,
      origen_canal: "WHATSAPP",
    });
    await emitirBroadcastSala(salaId, "ejemplar_retirado", { salaId, ejemplar });
    await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });

    return respuestaSala({
      ok: true,
      tipo: "RETIRO_EJEMPLAR",
      respuestaGrupo: msgRetirado,
      msg_publico: msgRetirado,
      msg_publico_bot: msgRetirado,
      respuestaPublica: msgRetirado,
      mensajePrivadoAutor: null,
      senderJid: participantJid,
    });
  }

  // 11. CREDITO / AVAL OPERADOR: !recargar [jugador] [monto] / !aval [jugador] [monto]
  const matchCreditoOperador = textoUsuarioLimpio.match(
    new RegExp(`^!(recargar|aval)\\s+(.+?)\\s+(${RE_MONTO_INPUT})$`, "i")
  );
  if (matchCreditoOperador) {
    const esOp =
      Boolean(body.esMensajePropioTelefono) ||
      Boolean(body.esOperador) ||
      (await verificarEsOperador(cliente?.id, cliente.telefono || participantJid, grupoId));
    if (!esOp) {
      return respuestaSala({
        ok: false,
        tipo: "NO_AUTORIZADO",
        respuestaGrupo: null,
        mensajePrivadoAutor: "⚠️ No está autorizado para acreditar saldo o aval.",
        senderJid: participantJid,
      });
    }
    const esAval = String(matchCreditoOperador[1] || "").toLowerCase() === "aval";
    const targetNombre = String(matchCreditoOperador[2] || "").trim();
    const { monto } = extraerMontoNumerico(String(matchCreditoOperador[3] || ""));
    if (!targetNombre || !(monto > 0)) {
      const msgErrCredito = limpiarEtiquetasProhibidas(
        `⚠️ Uso correcto: !${esAval ? "aval" : "recargar"} [Jugador] [Monto]`
      );
      return respuestaSala({
        ok: false,
        tipo: "CREDITO_ARGUMENTOS",
        respuestaGrupo: msgErrCredito,
        msg_publico: msgErrCredito,
        msg_publico_bot: msgErrCredito,
        respuestaPublica: msgErrCredito,
        mensajePrivadoAutor: null,
        senderJid: participantJid,
      });
    }

    const { data: candidatos } = await supabaseAdmin
      .from("clientes")
      .select(CAMPOS_CLIENTE_SALA)
      .eq("grupo_id", grupoId);
    const targetLimpio = targetNombre.toUpperCase();
    const targetCliente = (candidatos || []).find((c: any) => {
      const n = String(c.nombre || "").trim().toUpperCase();
      const s = String(c.seudonimo || "").trim().toUpperCase();
      return n === targetLimpio || s === targetLimpio || n.includes(targetLimpio) || (s && s.includes(targetLimpio));
    });

    if (!targetCliente) {
      const msgNoCliente = limpiarEtiquetasProhibidas(
        `⚠️ Jugador "${targetNombre}" no encontrado en este grupo.`
      );
      return respuestaSala({
        ok: false,
        tipo: "JUGADOR_NO_ENCONTRADO",
        respuestaGrupo: msgNoCliente,
        msg_publico: msgNoCliente,
        msg_publico_bot: msgNoCliente,
        respuestaPublica: msgNoCliente,
        mensajePrivadoAutor: null,
        senderJid: participantJid,
      });
    }

    const saldoActual = Number(targetCliente.saldo_actual || 0);
    const avalActual = Number(targetCliente.aval || (targetCliente as any).limite_credito || 0);
    const retenido = Number(targetCliente.saldo_retenido || 0);
    const nuevoSaldo = esAval ? saldoActual : Number((saldoActual + monto).toFixed(2));
    const nuevoAval = esAval ? Number((avalActual + monto).toFixed(2)) : avalActual;
    const nuevoDisponible = targetCliente.libre
      ? 999999
      : Math.max(0, Number((nuevoSaldo + nuevoAval - retenido).toFixed(2)));

    await supabaseAdmin
      .from("clientes")
      .update({
        saldo_actual: nuevoSaldo,
        aval: nuevoAval,
        saldo_disponible: nuevoDisponible,
        updated_at: new Date().toISOString(),
      })
      .eq("id", targetCliente.id);

    await supabaseAdmin.from("libro_mayor_clientes").insert({
      cliente_id: targetCliente.id,
      cliente_nombre: targetCliente.nombre,
      grupo_id: grupoId,
      tipo_movimiento: "DEPOSITO",
      monto_centavos: Math.round(monto * 100),
      monto,
      observacion: esAval ? "Aval otorgado por operador WhatsApp" : "Recarga operador WhatsApp",
      creado_por: body.pushName || body.senderNombre || "OPERADOR_WHATSAPP",
      fecha_carrera: new Date().toISOString().split("T")[0],
    });

    const nombreFinal = targetCliente.seudonimo || targetCliente.nombre;
    const msgPublico = limpiarEtiquetasProhibidas(
      esAval
        ? `✅ Aval acreditado a *${nombreFinal}*: $${formatearMontoRegional(monto)}. Aval total: $${formatearMontoRegional(nuevoAval)}.`
        : `✅ Recarga acreditada a *${nombreFinal}*: $${formatearMontoRegional(monto)}. Nuevo saldo: $${formatearMontoRegional(nuevoSaldo)}.`
    );
    const msgPrivado = limpiarEtiquetasProhibidas(
      esAval
        ? `🛡️ Se ha acreditado un aval de $${formatearMontoRegional(monto)} a tu cuenta. Tu aval disponible es $${formatearMontoRegional(nuevoAval)} y tu saldo disponible es $${formatearMontoRegional(nuevoDisponible)}.`
        : `💰 Tu cuenta ha sido acreditada con $${formatearMontoRegional(monto)}. Tu nuevo saldo disponible es $${formatearMontoRegional(nuevoDisponible)}.`
    );

    await supabaseAdmin.from("chat_mensajes").insert({
      grupo_id: grupoId,
      sala_id: salaId,
      remitente_nombre: "🤖 ASISTENTE DE SALA",
      es_operador: true,
      tipo_mensaje: "sistema",
      contenido: msgPublico,
      whatsapp_msg_id: whatsappMsgId || null,
      whatsapp_group_jid: groupJid || null,
      whatsapp_group_nombre: whatsappGroupNombre || null,
      origen_canal: "WHATSAPP",
    });
    await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });

    const jidTarget =
      targetCliente.whatsapp_jid ||
      (targetCliente.telefono_normalizado ? `${targetCliente.telefono_normalizado}@s.whatsapp.net` : null);

    return respuestaSala({
      ok: true,
      tipo: esAval ? "AVAL_OPERADOR" : "RECARGA_OPERADOR",
      respuestaGrupo: msgPublico,
      msg_publico: msgPublico,
      msg_publico_bot: msgPublico,
      respuestaPublica: msgPublico,
      mensajePrivadoAutor: null,
      notificaciones_privadas: jidTarget ? [{ whatsapp_jid: jidTarget, mensaje: msgPrivado }] : [],
      senderJid: participantJid,
    });
  }

  // 12. SENTENCIAR O RECTIFICAR PIZARRA
  const matchPizarraComando = textoUsuarioLimpio.match(
    /^(?:!)?(?:llegada|sentenciar|pizarra)\s*[:=\-]?\s*([0-9\s,./·\-_]+)$/i
  );
  const matchRectificarComando = textoUsuarioLimpio.match(
    /^(?:!)?rectificar(?:\s+pizarra)?\s*[:=\-]?\s*([0-9\s,./·\-_]+)$/i
  );
  if (matchPizarraComando || matchRectificarComando) {
    const esOp =
      Boolean(body.esMensajePropioTelefono) ||
      Boolean(body.esOperador) ||
      (await verificarEsOperador(cliente?.id, cliente.telefono || participantJid, grupoId));
    if (!esOp) {
      return respuestaSala({
        ok: false,
        tipo: "NO_AUTORIZADO",
        respuestaGrupo: null,
        mensajePrivadoAutor: "⚠️ No está autorizado para sentenciar o rectificar resultados oficiales.",
        senderJid: participantJid,
      });
    }

    const esRectificacion = Boolean(matchRectificarComando);
    const pizarraRaw = (matchPizarraComando?.[1] || matchRectificarComando?.[1] || "").trim();

    const resSentencia = await liquidarYSentenciarCarreraPlataforma({
      sala,
      pizarra: pizarraRaw,
      esRectificacion,
      operadorNombre: String(body.senderNombre || body.pushName || nombreJugador || "OPERADOR_WHATSAPP"),
      origenMsgId: whatsappMsgId || null,
    });

    if (!resSentencia.ok) {
      return respuestaSala({
        ok: false,
        tipo: "ERROR_PIZARRA",
        respuestaGrupo: `⚠️ ${resSentencia.error || "Formato de pizarra inválido"}`,
        mensajePrivadoAutor: null,
        senderJid: participantJid,
      });
    }

    return respuestaSala({
      ok: true,
      tipo: esRectificacion ? "RECTIFICACION_PIZARRA" : "SENTENCIA_PIZARRA",
      respuestaGrupo: resSentencia.textoResultado,
      msg_publico: resSentencia.textoResultado,
      msg_publico_bot: resSentencia.textoResultado,
      respuestaPublica: resSentencia.textoResultado,
      mensajePrivadoAutor: null,
      senderJid: participantJid,
    });
  }

  // 13. CONSULTA DE SALDO PRIVADA
  const esConsultaSaldo = /^(?:!?(?:saldo|mi\s+saldo|ver\s+saldo))$/i.test(textoUsuarioLimpio);
  if (esConsultaSaldo) {
    const saldoActualFmt = formatearMontoRegional(Number(cliente.saldo_actual || 0));
    const avalFmt = formatearMontoRegional(Number(cliente.aval || 0));
    const retenidoFmt = formatearMontoRegional(Number(cliente.saldo_retenido || 0));
    const dispFmt = formatearMontoRegional(cliente.libre ? 999999 : Number(cliente.saldo_disponible || 0));

    const msgSaldoDm =
      `💰 *CONSULTA DE SALDO*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 *Jugador:* ${nombreJugador}\n` +
      `💵 *Saldo Actual:* $${saldoActualFmt}\n` +
      `🛡️ *Aval / Crédito:* $${avalFmt}\n` +
      `⏳ *Retenido:* $${retenidoFmt}\n` +
      `🟢 *Saldo Disponible:* $${dispFmt}`;

    return respuestaSala({
      ok: true,
      tipo: "CONSULTA_SALDO",
      respuestaGrupo: null,
      msg_publico: null,
      msg_publico_bot: null,
      respuestaPublica: null,
      mensajePrivadoAutor: msgSaldoDm,
      msg_privado_bot: msgSaldoDm,
      alertaPrivada: null,
      notificaciones_privadas: [],
      senderJid: participantJid,
    });
  }

  // 14. CONSULTA DE CUENTA / RESUMEN PRIVADA
  const esConsultaCuenta = /^(?:!?(?:cuenta|mi\s+cuenta|resumen|mi\s+resumen|estado\s+de\s+cuenta))$/i.test(textoUsuarioLimpio);
  if (esConsultaCuenta) {
    const resumenDm = await construirResumenEstadoCuentaCliente(cliente.rawCliente, grupoId);

    return respuestaSala({
      ok: true,
      tipo: "CONSULTA_CUENTA",
      respuestaGrupo: null,
      msg_publico: null,
      msg_publico_bot: null,
      respuestaPublica: null,
      mensajePrivadoAutor: resumenDm,
      msg_privado_bot: resumenDm,
      alertaPrivada: null,
      notificaciones_privadas: [],
      senderJid: participantJid,
    });
  }

  return null;
}

/**
 * Parsea el texto libre de WhatsApp y retorna la estructura analizada de jugada.
 */
export async function parsearJugada(params: {
  contextoSala: ContextoSala;
  cliente: ClienteResuelto;
  texto: string;
}): Promise<JugadaParseada> {
  const { contextoSala, cliente, texto } = params;
  const { grupoId, salaId, retirados, codigoSala } = contextoSala;
  const saldoDisponible = cliente.saldo_disponible;
  const nombreJugador = cliente.nombreJugador;

  let respuestaAprendida: string | null = null;
  let jugadaAprendidaSugerida: string | null = null;

  try {
    const { data: revPrevia } = await supabaseAdmin
      .from("registro_revision_llm")
      .select("respuesta_ia_enviada, jugada_corregida_sugerida")
      .eq("grupo_id", grupoId)
      .eq("mensaje_usuario_original", texto.trim())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (revPrevia) {
      respuestaAprendida = revPrevia.respuesta_ia_enviada || null;
      jugadaAprendidaSugerida = revPrevia.jugada_corregida_sugerida || null;
    }

    if (!respuestaAprendida && !jugadaAprendidaSugerida) {
      const { data: dictPrevio } = await supabaseAdmin
        .from("diccionario_aprendizaje_bot")
        .select("jugada_corregida, termino_original")
        .eq("grupo_id", grupoId)
        .ilike("termino_original", texto.trim())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (dictPrevio?.jugada_corregida) {
        jugadaAprendidaSugerida = dictPrevio.jugada_corregida;
      }
    }
  } catch {}

  const bloqueItems = analizarBloqueJugadas(
    texto,
    saldoDisponible,
    retirados,
    16,
    nombreJugador,
    undefined,
    codigoSala
  );
  const bloquesValidos = bloqueItems.filter((b) => b.esIntencionDeJugada && b.valido);

  if (bloquesValidos.length > 1) {
    return {
      esIntencionDeJugada: true,
      tipoIntent: "PROPUESTA_BLOQUE",
      valido: true,
      bloques: bloquesValidos,
      monto: bloquesValidos.reduce((acc, b) => acc + (b.monto || 0), 0),
    };
  }

  let analisis = evaluarMensajePedagogico(
    texto,
    saldoDisponible,
    retirados,
    16,
    nombreJugador
  );

  if (!analisis.valido && jugadaAprendidaSugerida) {
    const intentoAprendido = evaluarMensajePedagogico(
      jugadaAprendidaSugerida,
      saldoDisponible,
      retirados,
      16,
      nombreJugador
    );
    if (intentoAprendido.valido) {
      analisis = intentoAprendido;
    }
  }

  const tipoIntent = !analisis.esIntencionDeJugada
    ? "CHARLA"
    : !analisis.valido
    ? (analisis.excedioSaldo ? "EXCESO_SALDO" : "PEDAGOGICO")
    : "PROPUESTA";

  return {
    esIntencionDeJugada: analisis.esIntencionDeJugada,
    tipoIntent,
    valido: analisis.valido,
    modalidad: analisis.modalidad,
    ejemplarTexto: analisis.ejemplarTexto,
    caballosBandoA: analisis.caballosBandoA,
    caballosBandoB: analisis.caballosBandoB,
    esMatch: analisis.esMatch,
    proporcion: analisis.proporcion,
    monto: analisis.monto,
    accionProponente: analisis.accionProponente,
    jugadaEstandarizada: analisis.jugadaEstandarizada,
    excedioSaldo: analisis.excedioSaldo,
    montoDisponibleValido: analisis.montoDisponibleValido,
    motivoRechazo: (analisis as any).motivoRechazo,
    msgPrivadoBot: analisis.msgPrivadoBot,
    mensajePedagogicoPrivado: analisis.mensajePedagogicoPrivado,
    confianza: analisis.confianza,
    requiereOperador: analisis.requiereOperador,
    sugerenciasUnClic: analisis.sugerenciasUnClic,
  };
}

/**
 * Maneja jugadas inválidas: exceso de saldo o fallos de redacción (enseñanza pedagógica).
 */
export async function manejarFalloAnalisisJugada(params: {
  contextoSala: ContextoSala;
  cliente: ClienteResuelto;
  analisis: JugadaParseada;
  texto: string;
  whatsappMsgId?: string | null;
  groupJid?: string | null;
  whatsappGroupNombre?: string | null;
  participantJid?: string | null;
  esOperadorRemitente?: boolean;
}): Promise<any> {
  const {
    contextoSala,
    cliente,
    analisis,
    texto,
    whatsappMsgId,
    groupJid,
    whatsappGroupNombre,
    participantJid,
    esOperadorRemitente = false,
  } = params;

  const { salaId, grupoId } = contextoSala;

  // Caso: Publicó jugada por encima de su saldo y tiene $0 disponible
  if (analisis.excedioSaldo) {
    const saldoFmt = formatearMontoRegional(Math.max(0, cliente.saldo_disponible));
    const msgPubExceso = `⚠️ *${cliente.nombreJugador}* está jugando por encima de su saldo disponible ($${saldoFmt}). Debes recargar para proponer jugadas.`;
    const msgPrivExceso = `⚠️ Hola *${cliente.nombreJugador}*, estás jugando por encima de tu saldo disponible ($${saldoFmt}). Por favor recarga o ajusta el monto de tus jugadas.`;

    await registrarMensajeChat({
      salaId,
      grupoId,
      tipo: "BOT",
      tipoMensaje: "sistema",
      remitenteNombre: "🤖 ASISTENTE DE SALA",
      esOperador: true,
      mensajeTexto: msgPubExceso,
      whatsappMsgId,
      whatsappGroupJid: groupJid,
      whatsappGroupNombre,
    });

    return respuestaSala({
      ok: false,
      tipo: "EXCESO_SALDO",
      respuestaGrupo: msgPubExceso,
      msg_publico: msgPubExceso,
      msg_publico_bot: msgPubExceso,
      respuestaPublica: msgPubExceso,
      mensajePrivadoAutor: msgPrivExceso,
      msg_privado_bot: msgPrivExceso,
      alertaPrivada: msgPrivExceso,
      notificaciones_privadas: [],
      clienteTelefono: cliente.telefonoClienteCompleto,
      senderJid: participantJid,
    });
  }

  // Caso: Enseñanza Pedagógica en Privado (mal escrita)
  try {
    await supabaseAdmin.from("registro_revision_llm").insert({
      grupo_id: grupoId,
      sala_id: salaId,
      usuario_id: cliente.id,
      usuario_nombre: cliente.nombreJugador,
      mensaje_usuario_original: texto.trim(),
      jugada_corregida_sugerida: analisis.sugerenciasUnClic?.[0] || analisis.jugadaEstandarizada,
      intencion_detectada: analisis.modalidad,
      respuesta_ia_enviada: analisis.msgPrivadoBot || analisis.mensajePedagogicoPrivado || "Corrección pedagógica",
      nivel_confianza: analisis.confianza,
      requiere_intervencion_humana: analisis.requiereOperador,
      estado_ticket_soporte: analisis.requiereOperador ? "pendiente_operador" : "resuelto_ia",
    });

    await supabaseAdmin.from("diccionario_aprendizaje_bot").insert({
      grupo_id: grupoId,
      termino_original: texto.trim(),
      jugada_corregida: analisis.jugadaEstandarizada || analisis.mensajePedagogicoPrivado,
      usuario_id: cliente.id,
    });
  } catch {}

  const msgPrivPedagogico =
    analisis.msgPrivadoBot ||
    analisis.mensajePedagogicoPrivado ||
    `🤖 Corrección Pedagógica: Para publicar una jugada indica Condición (Juego/Consigo), Jugada, Ejemplar y Monto. Ejemplo: Juego 1P 5 100`;

  const avisoPublico = esOperadorRemitente ? null : AVISO_REDACCION_GRUPO;
  const avisoPrivado = esOperadorRemitente ? null : limpiarEtiquetasProhibidas(msgPrivPedagogico);

  return respuestaSala({
    ok: false,
    tipo: "PEDAGOGICO",
    respuestaGrupo: avisoPublico,
    msg_publico: avisoPublico,
    msg_publico_bot: avisoPublico,
    respuestaPublica: avisoPublico,
    mensajePrivadoAutor: avisoPrivado,
    msg_privado_bot: avisoPrivado,
    alertaPrivada: null,
    notificaciones_privadas: [],
    clienteTelefono: cliente.telefonoClienteCompleto,
    senderJid: participantJid,
  });
}
