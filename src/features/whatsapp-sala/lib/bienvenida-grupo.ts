/**
 * Bienvenida individual: se envía por DM la PRIMERA vez que un jugador
 * escribe en el grupo. La redacción sale de la plantilla `bienvenida_individual`
 * (global > grupo > default), igual que el resto de mensajes del bot.
 */
import { supabaseAdmin } from "@/core/supabase-admin";
import {
  cargarPlantillasGrupo,
  obtenerPlantillaGrupo,
} from "@/features/whatsapp/lib/plantillas-grupo-server";
import { variablesEncabezadoGrupo } from "@/features/whatsapp/lib/plantillas-grupo";
import { formatearMontoRegional } from "@/shared/lib/dinero";
import { enviarNotificacionesPrivadasDaemon } from "../notificador";

const enviadasEnMemoria = new Set<string>();

type ParamsBienvenida = {
  cliente: any;
  grupoId: string;
  sala?: any;
  codigoSala?: string | null;
  participantJid?: string | null;
  esOperador?: boolean;
};

/** true cuando se envió (o ya estaba enviada en este proceso). */
export async function enviarBienvenidaSiEsPrimeraVez(
  params: ParamsBienvenida
): Promise<boolean> {
  const { cliente, grupoId, sala, codigoSala, participantJid, esOperador } = params;
  if (!cliente?.id || !grupoId || esOperador) return false;

  const clave = `${grupoId}|${cliente.id}`;
  if (enviadasEnMemoria.has(clave)) return true;

  try {
    const porCliente = await supabaseAdmin
      .from("chat_mensajes")
      .select("id")
      .eq("grupo_id", grupoId)
      .eq("remitente_id", String(cliente.id))
      .limit(1)
      .maybeSingle();
    if (porCliente?.data?.id) {
      enviadasEnMemoria.add(clave);
      return false;
    }

    if (participantJid) {
      const porJid = await supabaseAdmin
        .from("chat_mensajes")
        .select("id")
        .eq("grupo_id", grupoId)
        .eq("whatsapp_jid", String(participantJid))
        .limit(1)
        .maybeSingle();
      if (porJid?.data?.id) {
        enviadasEnMemoria.add(clave);
        return false;
      }
    }
  } catch {
    // Si la tabla no está disponible, no bloqueamos el mensaje del jugador.
  }

  const nombre = String(
    cliente.seudonimo || cliente.nombre || cliente.nombreJugador || "Jugador"
  ).trim();
  const saldo = Number(
    cliente.saldo_disponible ??
      cliente.saldoDisponible ??
      cliente.saldo_actual ??
      0
  );
  const mapa = await cargarPlantillasGrupo(grupoId);
  const mensaje = obtenerPlantillaGrupo(
    mapa,
    "bienvenida_individual",
    {
      ...variablesEncabezadoGrupo(sala, "apertura"),
      nombre,
      jugador: nombre,
      codigo_sala: String(codigoSala || cliente.codigo_sala || "").trim(),
      grupo: String(sala?.whatsapp_group_nombre || cliente.grupo_nombre || "el grupo").trim(),
      saldo_disponible: formatearMontoRegional(saldo),
    },
    ""
  );

  if (!mensaje) return false;

  try {
    await enviarNotificacionesPrivadasDaemon([
      {
        cliente_id: cliente.id,
        whatsapp_jid: participantJid || cliente.whatsapp_jid || null,
        mensaje,
        tipo: "bienvenida_individual",
      },
    ]);
    enviadasEnMemoria.add(clave);
    return true;
  } catch {
    return false;
  }
}
