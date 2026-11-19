import { NextResponse } from "next/server";
import { resolverSala, esWhatsappMsgIdDuplicado } from "@/features/whatsapp-sala/resolverSala";
import {
  crearClienteOperadorSimbolico,
  resolverCliente,
  verificarEsOperador,
} from "@/features/whatsapp-sala/resolverCliente";
import {
  sanitizarTexto,
  detectarIntencionRapida,
  manejarIntencionComando,
  parsearJugada,
  manejarFalloAnalisisJugada,
  AVISO_REDACCION_GRUPO,
  COMANDO_OPERADOR_EXACTO,
} from "@/features/whatsapp-sala/parsearJugada";
import { validarYPublicarPropuesta } from "@/features/whatsapp-sala/validarSaldo";
import { concretarJugada } from "@/features/whatsapp-sala/concretarJugada";
import {
  respuestaSala,
  registrarMensajeChat,
} from "@/features/whatsapp-sala/notificador";
import {
  ejecutarAccionAdmin,
  obtenerEstadoDemonioYSalas,
} from "@/features/whatsapp-sala/accionesAdmin";
import { supabaseAdmin } from "@/core/supabase-admin";
import { formatearMontoRegional } from "@/shared/lib/dinero";
import { limpiarEtiquetasProhibidas } from "@/features/sala-juegos/lib/modalidades-progresivas";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    return await obtenerEstadoDemonioYSalas(req);
  } catch (err: any) {
    console.error("[PROCESAR_SALA_ERR] GET status daemon:", err);
    return NextResponse.json(
      { ok: false, error: err?.message || "Error consultando estado de salas" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // 0. Acciones administrativas (abrir/cerrar/vincular/desconectar/plano/sentencia/ajuste)
    if (body?.accion) {
      const resAdmin = await ejecutarAccionAdmin(body);
      if (resAdmin) return resAdmin;
    }

    // 1. Validar request
    const groupJid = String(body?.groupJid || "").trim();
    const participantJid = String(body?.participantJid || body?.senderJid || "").trim();
    const textoRaw = String(body?.texto || "").trim();
    const texto = sanitizarTexto(textoRaw);
    const whatsappMsgId = body?.whatsappMsgId ? String(body.whatsappMsgId) : null;
    const quotedMsgId = body?.quotedMsgId ? String(body.quotedMsgId) : null;
    const whatsappGroupNombre = body?.whatsappGroupNombre ? String(body.whatsappGroupNombre) : null;

    if (!groupJid || !participantJid || !texto) {
      return respuestaSala(
        {
          ok: false,
          error: "groupJid, participantJid y texto son requeridos",
          respuestaGrupo: null,
          mensajePrivadoAutor: null,
        },
        { status: 400 }
      );
    }

    // Descartar mensajes duplicados / reintentos inmediatos
    if (esWhatsappMsgIdDuplicado(whatsappMsgId)) {
      return respuestaSala({
        ok: true,
        tipo: "REINTENTO_DESCARTADO",
        respuestaGrupo: null,
        mensajePrivadoAutor: null,
      });
    }

    // 2. Servicio 1: resolverSala
    const contextoSala = await resolverSala({
      groupJid,
      salaId: body.salaId,
      grupoId: body.grupoId,
      whatsappGroupNombre,
    });

    if (!contextoSala) {
      return respuestaSala({
        ok: false,
        tipo: "IGNORADO",
        mensaje: "Grupo no vinculado a ninguna sala activa",
        respuestaGrupo: null,
        mensajePrivadoAutor: null,
      });
    }

    const { salaId, grupoId, codigoSala, carreraAbierta, sala } = contextoSala;

    // Inmunidad del operador: su texto libre se ignora en silencio.
    // Los comandos operativos se aceptan con o sin «!» y se evalúan ANTES de
    // exigir que el remitente figure en la nómina de `clientes`.
    // El flag `esOperador` del demonio NO basta: además se revalida en backend
    // por teléfono (últimos 10 dígitos) / whatsapp_lid contra la nómina de
    // administradores y operadores del grupo o la sala.
    const esMensajePropioBot = Boolean(body.esMensajePropioTelefono) || Boolean(body.esFromMe);
    const operadorVerificadoBackend = await verificarEsOperador(
      null,
      participantJid,
      grupoId,
      {
        participantJid,
        participantAlt: body.participantAlt || body.participant_alt || null,
        telefonoReal: body.telefonoReal || body.participant_phone || null,
        salaId,
      }
    );
    const esOperadorRemitente =
      esMensajePropioBot || (Boolean(body.esOperador) && operadorVerificadoBackend);

    const esComandoOperador = esOperadorRemitente && COMANDO_OPERADOR_EXACTO.test(texto);

    // Detección rápida de intención
    const deteccion = detectarIntencionRapida(texto, quotedMsgId, codigoSala);

    // Si no es comando, ni acción, ni intención de jugada
    if (!deteccion.esAccionOJugada && !esComandoOperador) {
      if (esOperadorRemitente) {
        return respuestaSala({
          ok: true,
          tipo: "IGNORADO_OPERADOR",
          respuestaGrupo: null,
          mensajePrivadoAutor: null,
          msg_publico: null,
          msg_publico_bot: null,
          respuestaPublica: null,
          msg_privado_bot: null,
        });
      }

      const nombreRemitente = String(body.senderNombre || body.pushName || "Usuario").trim();
      await registrarMensajeChat({
        salaId,
        grupoId,
        remitenteNombre: nombreRemitente,
        esOperador: Boolean(body.esMensajePropioTelefono),
        mensajeTexto: deteccion.textoUsuarioLimpio,
        whatsappMsgId,
        whatsappGroupJid: groupJid,
        whatsappGroupNombre,
      });

      return respuestaSala({
        ok: true,
        tipo: "CHARLA",
        respuestaGrupo: null,
        mensajePrivadoAutor: null,
      });
    }

    // 3. Servicio 2: resolverCliente
    let cliente: NonNullable<Awaited<ReturnType<typeof resolverCliente>>>;
    const clienteResuelto = await resolverCliente({
      grupoId,
      participantJid,
      participantAlt: body.participantAlt,
      telefonoReal: body.telefonoReal || body.participant_phone,
      pushName: body.push_name || body.pushName || body.senderNombre,
      clientePreviamenteIdentificado: body.clientePreviamenteIdentificado,
      esOperadorRemitente,
    });

    if (esComandoOperador) {
      cliente =
        clienteResuelto ||
        crearClienteOperadorSimbolico({
          grupoId,
          participantJid,
          nombre: body.pushName || body.push_name || body.senderNombre,
          telefono: body.telefonoReal || body.participant_phone || null,
          whatsappLid: participantJid.endsWith("@lid") ? participantJid : null,
        });
    } else {
      if (!clienteResuelto) {
        if (esOperadorRemitente) {
          return respuestaSala({
            ok: true,
            tipo: "IGNORADO_OPERADOR",
            respuestaGrupo: null,
            mensajePrivadoAutor: null,
            msg_publico: null,
            msg_publico_bot: null,
            respuestaPublica: null,
            msg_privado_bot: null,
          });
        }
        return respuestaSala({
          ok: false,
          tipo: "SIN_REGISTRO",
          respuestaGrupo: "🚫 *Nada Aquí* — Jugador no registrado en la nómina oficial del grupo.",
          mensajePrivadoAutor: null,
        });
      }

      // Si es operador pero el mensaje no es una propuesta válida, ni cita una propuesta, ni es retiro/ampliación/comando, ignorar en silencio
      const esJugadaOAccionValidaJugador =
        Boolean(quotedMsgId) ||
        Boolean(deteccion.cmdRetiroPre.esComandoRetiro) ||
        Boolean(deteccion.esAmpliacionPre) ||
        Boolean(deteccion.esConsultaSaldo) ||
        Boolean(deteccion.esConsultaCuenta) ||
        Boolean(deteccion.esComandoPlano) ||
        Boolean(deteccion.esSolicitudCajero) ||
        Boolean(texto.includes("\n") && deteccion.preAnalisis.esIntencionDeJugada) ||
        Boolean(deteccion.preAnalisis.esIntencionDeJugada && deteccion.preAnalisis.valido);

      if (esOperadorRemitente && !esJugadaOAccionValidaJugador) {
        return respuestaSala({
          ok: true,
          tipo: "IGNORADO_OPERADOR",
          respuestaGrupo: null,
          mensajePrivadoAutor: null,
          msg_publico: null,
          msg_publico_bot: null,
          respuestaPublica: null,
          msg_privado_bot: null,
        });
      }

      cliente = clienteResuelto;

      // Auto-guardado de @lid en clientes en segundo plano (sin bloquear la respuesta)
      if (participantJid.endsWith("@lid") && cliente.whatsapp_lid !== participantJid) {
        (async () => {
          try {
            await supabaseAdmin
              .from("clientes")
              .update({ whatsapp_lid: participantJid, whatsapp_vinculado: true })
              .eq("id", cliente.id);
          } catch {
            // Silencioso
          }
        })();
        cliente.whatsapp_lid = participantJid;
      }
    }

    // 4. Procesar intenciones de comandos y entrenadas
    const resComando = await manejarIntencionComando({
      contextoSala,
      cliente,
      texto,
      body,
      participantJid,
      whatsappMsgId,
      groupJid,
      whatsappGroupNombre,
    });
    if (resComando) return resComando;

    // 5. Servicio 5: concretarJugada (Aceptaciones con cita, o comandos de retiro/ampliación)
    if (quotedMsgId || deteccion.cmdRetiroPre.esComandoRetiro || deteccion.esAmpliacionPre) {
      const resConcrecion = await concretarJugada({
        contextoSala,
        cliente,
        texto,
        body,
        participantJid,
        whatsappMsgId,
        quotedMsgId,
        groupJid,
        whatsappGroupNombre,
      });
      return respuestaSala(resConcrecion);
    }

    // 6. Servicio 3: parsearJugada
    const analisis = await parsearJugada({
      contextoSala,
      cliente,
      texto,
    });

    // Si es bloque de múltiples jugadas, delegar directamente a validarYPublicarPropuesta
    if (analisis.tipoIntent === "PROPUESTA_BLOQUE") {
      const resBloque = await validarYPublicarPropuesta({
        contextoSala,
        cliente,
        analisis,
        whatsappMsgId,
        groupJid,
        whatsappGroupNombre,
        participantJid,
      });
      return respuestaSala(resBloque);
    }

    // Si no tiene intención de jugada, registrar charla
    if (!analisis.esIntencionDeJugada) {
      await registrarMensajeChat({
        salaId,
        grupoId,
        remitenteNombre: cliente.nombreJugador,
        esOperador: false,
        mensajeTexto: texto,
        whatsappMsgId,
        whatsappGroupJid: groupJid,
        whatsappGroupNombre,
      });

      return respuestaSala({
        ok: true,
        tipo: "CHARLA",
        respuestaGrupo: null,
        msg_publico: null,
        msg_publico_bot: null,
        respuestaPublica: null,
        mensajePrivadoAutor: null,
        msg_privado_bot: null,
        alertaPrivada: null,
        notificaciones_privadas: [],
        clienteTelefono: cliente.telefonoClienteCompleto,
        senderJid: participantJid,
      });
    }

    // Bloqueo estricto de jugadas sin saldo (saldo_disponible <= 0)
    if (Number(cliente.saldo_disponible) <= 0 && !cliente.libre) {
      const msgPubSinSaldo = `*Nada Aquí* — ${cliente.nombreJugador} no posee saldo disponible (${formatearMontoRegional(0)})`;
      const msgPrivSinSaldo = `"Atento", no publique jugadas por encima de saldo disponible, nos agrada tenerlo en este grupo`;
      return respuestaSala({
        ok: false,
        tipo: "EXCESO_SALDO",
        respuestaGrupo: msgPubSinSaldo,
        msg_publico: msgPubSinSaldo,
        msg_publico_bot: msgPubSinSaldo,
        respuestaPublica: msgPubSinSaldo,
        mensajePrivadoAutor: msgPrivSinSaldo,
        msg_privado_bot: msgPrivSinSaldo,
        alertaPrivada: msgPrivSinSaldo,
        notificaciones_privadas: [],
        clienteTelefono: cliente.telefonoClienteCompleto,
        senderJid: participantJid,
      });
    }

    // Caso: Jugada inválida (exceso de saldo con $0 disp o corrección pedagógica en privado)
    if (!analisis.valido) {
      return await manejarFalloAnalisisJugada({
        contextoSala,
        cliente,
        analisis,
        texto,
        whatsappMsgId,
        groupJid,
        whatsappGroupNombre,
        participantJid,
        esOperadorRemitente,
      });
    }

    // 7. Servicio 4: validarSaldo y publicación atómica
    const resPropuesta = await validarYPublicarPropuesta({
      contextoSala,
      cliente,
      analisis,
      whatsappMsgId,
      groupJid,
      whatsappGroupNombre,
      participantJid,
    });

    return respuestaSala(resPropuesta);
  } catch (err: any) {
    console.error("[PROCESAR_SALA_ERR]", err);
    return respuestaSala(
      {
        ok: false,
        error: err?.message || "Error interno en /api/whatsapp-sala/procesar",
        respuestaGrupo: null,
        mensajePrivadoAutor: null,
      },
      { status: 500 }
    );
  }
}
