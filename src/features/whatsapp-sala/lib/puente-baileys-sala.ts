import crypto from "crypto";
import { supabaseAdmin } from "@/core/supabase-admin";
import {
  analizarYEstandarizarJugada,
  evaluarConcrecionEstricta,
  analizarComandoRetiro,
  esIntentoConcrecionOMontoParcial,
} from "@/features/sala-juegos/lib/parser-pedagogico";
import { ejecutarRetiroPropuestasSeFue } from "../concretarJugada";
import { formatearMontoRegional, prefijoMonedaGrupo } from "@/shared/lib/dinero";
import {
  mensajeConCodigoSala,
  resolverCodigoSalaGrupo,
} from "@/features/grupos/lib/codigo-sala";
import { sincronizarTicketsPropuestaATaquilla } from "./sincronizar-tickets-sala";
import { insertarTicketFifo } from "./ticket-fifo";
import {
  cargarPlantillasGrupo,
  obtenerPlantillaGrupo,
} from "@/features/whatsapp/lib/plantillas-grupo-server";
import { variablesEncabezadoGrupo } from "@/features/whatsapp/lib/plantillas-grupo";
import { mensajeJugaronPorSaldoParcial } from "@/features/whatsapp/lib/mensajes-concrecion";

export interface MensajeEntranteWhatsApp {
  groupJid: string;
  senderJid: string;
  senderNombre?: string;
  texto: string;
  quotedMsgId?: string | null;
  whatsappMsgId?: string | null;
}

export interface RespuestaPuenteWhatsApp {
  ok: boolean;
  tipo: "PROPUESTA" | "CONCRECION" | "PEDAGOGICO" | "TEXTO" | "ERROR" | "IGNORADO";
  mensaje?: string;
  acciones?: {
    responderEnGrupo?: string | null;
    enviarPrivadoJugador?: string | null;
    enviarPrivadoProponente?: string | null;
  };
  data?: any;
}

// Mutex en memoria por ID de propuesta para garantizar ejecución estrictamente FIFO
const colasConcrecionPorPropuesta = new Map<string, Promise<any>>();

function encolarConcrecion<T>(propuestaId: string, fn: () => Promise<T>): Promise<T> {
  const colaPrevia = colasConcrecionPorPropuesta.get(propuestaId) || Promise.resolve();
  const siguiente = colaPrevia.then(fn, fn);
  colasConcrecionPorPropuesta.set(propuestaId, siguiente.then(() => {}, () => {}));
  return siguiente;
}

/**
 * Normaliza números de teléfono para coincidencia flexible (elimina @s.whatsapp.net, +, guiones, etc.)
 */
function normalizarTelefono(tel?: string | null): string {
  if (!tel) return "";
  return tel.replace(/@.*$/, "").replace(/[^0-9]/g, "");
}

/**
 * Calcula saldo disponible de un cliente
 */
function calcularDisponibleCliente(cliente: any): number {
  if (!cliente) return 0;
  if (cliente.libre) return 999999;
  const saldo = Number(cliente.saldo_actual || 0);
  const aval = Number(cliente.aval || 0);
  const retenido = Number(cliente.saldo_retenido || 0);
  return Math.max(0, Number((saldo + aval - retenido).toFixed(2)));
}

/**
 * Emite evento de Realtime Supabase Broadcast hacia los navegadores
 */
async function emitirBroadcast(salaId: string, evento: string, payload: any) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return;

    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        messages: [
          {
            topic: `realtime:sala:${salaId}`,
            event: evento,
            payload,
          },
        ],
      }),
    }).catch(() => {});
  } catch {
    // Silencioso
  }
}

/**
 * Procesa en tiempo real un mensaje recibido desde WhatsApp (Baileys)
 * Maneja tanto propuestas nuevas como concreciones por citación en cascada (ej. 90 + 10 = 100).
 */
export async function procesarMensajeEntranteWhatsApp(
  msg: MensajeEntranteWhatsApp
): Promise<RespuestaPuenteWhatsApp> {
  const { groupJid, senderJid, senderNombre, texto, quotedMsgId, whatsappMsgId } = msg;

  if (!groupJid || !senderJid || !texto || !texto.trim()) {
    return { ok: false, tipo: "IGNORADO", mensaje: "Mensaje vacío o sin datos de emisor/grupo" };
  }

  const textoLimpio = texto.trim();

  // 1. Identificar la sala activa vinculada a este grupo de WhatsApp
  const { data: sala, error: errSala } = await supabaseAdmin
    .from("salas_juego")
    .select("*")
    .eq("whatsapp_group_jid", groupJid)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (errSala || !sala) {
    return {
      ok: false,
      tipo: "IGNORADO",
      mensaje: `No hay sala activa vinculada al grupo de WhatsApp ${groupJid}`,
    };
  }

  const salaId = sala.id;
  const grupoId = sala.grupo_id;
  const esCarreraAbierta = sala.estado_carrera === "abierta";

  // Moneda del grupo: todos los mensajes/reportes del bot deben usar el mismo
  // símbolo que el grupo (USD -> $, VES -> Bs.).
  const { data: grupoMoneda } = await supabaseAdmin
    .from("grupos_venta")
    .select("moneda")
    .eq("id", grupoId)
    .maybeSingle();
  const prefijo = prefijoMonedaGrupo(grupoMoneda?.moneda || sala.moneda);
  const codigoSala = await resolverCodigoSalaGrupo(supabaseAdmin, {
    salaId: salaId,
    grupoId,
    nombre: sala.nombre_grupo || sala.nombre || sala.whatsapp_group_nombre || "PRINCIPAL",
  });
  const dm = (texto?: string | null) => mensajeConCodigoSala(texto, codigoSala);

  // 2. Identificar al cliente en la base de datos estrictamente dentro de `grupoId = sala.grupo_id`
  const telLimpio = normalizarTelefono(senderJid);
  const pushNameLimpio = String(senderNombre || "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
  const pushNameValido =
    pushNameLimpio &&
    !["USUARIO", "JUGADOR", "OPERADOR", "OPERADOR (TELEFONO)", "ADMIN"].includes(pushNameLimpio)
      ? pushNameLimpio
      : "";
  const CAMPOS_CLIENTE =
    "id, grupo_id, nombre, seudonimo, saldo_actual, saldo_retenido, saldo_disponible, libre, aval, whatsapp_jid, telefono, telefono_normalizado";
  let cliente: any = null;

  // A. Búsqueda por whatsapp_jid o telefono_normalizado dentro de `grupo_id = sala.grupo_id`
  const condsOr: string[] = [];
  if (senderJid) condsOr.push(`whatsapp_jid.eq.${senderJid}`);
  if (telLimpio && telLimpio.length >= 7) condsOr.push(`telefono_normalizado.eq.${telLimpio}`);
  if (condsOr.length > 0) {
    const { data: clPorJid } = await supabaseAdmin
      .from("clientes")
      .select(CAMPOS_CLIENTE)
      .eq("grupo_id", grupoId)
      .or(condsOr.join(","))
      .order("saldo_actual", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (clPorJid) {
      cliente = clPorJid;
    }
  }

  // B. Búsqueda parcial de teléfono dentro de `grupo_id = sala.grupo_id`
  if (!cliente && telLimpio && telLimpio.length >= 7) {
    const { data: clPorTel } = await supabaseAdmin
      .from("clientes")
      .select(CAMPOS_CLIENTE)
      .eq("grupo_id", grupoId)
      .ilike("telefono", `%${telLimpio.slice(-8)}%`)
      .order("saldo_actual", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (clPorTel) {
      cliente = clPorTel;
    }
  }

  // C. Búsqueda por UPPER(TRIM(nombre)) o UPPER(TRIM(seudonimo)) = UPPER(TRIM(pushName)) dentro de `grupo_id = sala.grupo_id`
  if (!cliente && pushNameValido) {
    const { data: candidatosGrupo } = await supabaseAdmin
      .from("clientes")
      .select(CAMPOS_CLIENTE)
      .eq("grupo_id", grupoId);
    if (Array.isArray(candidatosGrupo) && candidatosGrupo.length > 0) {
      cliente =
        candidatosGrupo.find((c: any) => {
          const nom = String(c.nombre || "").trim().replace(/\s+/g, " ").toUpperCase();
          const seu = String(c.seudonimo || "").trim().replace(/\s+/g, " ").toUpperCase();
          return nom === pushNameValido || (seu && seu === pushNameValido);
        }) || null;
    }
  }

  // D. Pista de identidad multi-grupo: si el jugador tiene otra fila en otro grupo con el mismo whatsapp_jid/teléfono,
  // usar su teléfono/nombre/seudónimo para localizar su fila independiente en `sala.grupo_id`.
  if (!cliente && condsOr.length > 0) {
    const { data: filasOtroGrupo } = await supabaseAdmin
      .from("clientes")
      .select("nombre, seudonimo, telefono, telefono_normalizado")
      .or(condsOr.join(","))
      .limit(5);
    if (Array.isArray(filasOtroGrupo) && filasOtroGrupo.length > 0) {
      const { data: candidatosGrupo } = await supabaseAdmin
        .from("clientes")
        .select(CAMPOS_CLIENTE)
        .eq("grupo_id", grupoId);
      if (Array.isArray(candidatosGrupo) && candidatosGrupo.length > 0) {
        for (const pista of filasOtroGrupo) {
          const telP = normalizarTelefono(pista.telefono_normalizado || pista.telefono);
          const sufP = telP.length >= 7 ? telP.slice(-8) : "";
          const nomP = String(pista.nombre || "").trim().replace(/\s+/g, " ").toUpperCase();
          const seuP = String(pista.seudonimo || "").trim().replace(/\s+/g, " ").toUpperCase();
          const encontrado = candidatosGrupo.find((c: any) => {
            const telC = normalizarTelefono(c.telefono_normalizado || c.telefono);
            if (telP && telC && (telC === telP || (sufP && telC.endsWith(sufP)))) return true;
            const nomC = String(c.nombre || "").trim().replace(/\s+/g, " ").toUpperCase();
            const seuC = String(c.seudonimo || "").trim().replace(/\s+/g, " ").toUpperCase();
            if (nomP && (nomC === nomP || seuC === nomP)) return true;
            if (seuP && (nomC === seuP || seuC === seuP)) return true;
            return false;
          });
          if (encontrado) {
            cliente = encontrado;
            break;
          }
        }
      }
    }
  }

  // E. Fallback a `clientes_grupos` donde `grupo_id = sala.grupo_id`
  if (!cliente) {
    try {
      const { data: membresias } = await supabaseAdmin
        .from("clientes_grupos")
        .select("cliente_id")
        .eq("grupo_id", grupoId);
      const idsMembresia = (membresias || []).map((m: any) => m?.cliente_id).filter(Boolean);
      if (idsMembresia.length > 0) {
        const { data: candidatosMem } = await supabaseAdmin
          .from("clientes")
          .select(CAMPOS_CLIENTE)
          .in("id", idsMembresia);
        if (Array.isArray(candidatosMem) && candidatosMem.length > 0) {
          const suf8 = telLimpio.length >= 7 ? telLimpio.slice(-8) : "";
          cliente =
            candidatosMem.find((c: any) => {
              if (senderJid && c.whatsapp_jid === senderJid) return true;
              const telC = normalizarTelefono(c.telefono_normalizado || c.telefono);
              if (telLimpio && telC && (telC === telLimpio || (suf8 && telC.endsWith(suf8)))) return true;
              const nomC = String(c.nombre || "").trim().replace(/\s+/g, " ").toUpperCase();
              const seuC = String(c.seudonimo || "").trim().replace(/\s+/g, " ").toUpperCase();
              if (pushNameValido && (nomC === pushNameValido || seuC === pushNameValido)) return true;
              return false;
            }) || null;
        }
      }
    } catch {
      // clientes_grupos opcional
    }
  }

  // Auto-vincular `whatsapp_jid` en la fila de `sala.grupo_id` filtrando por `id` y `grupo_id`
  if (cliente && senderJid && cliente.whatsapp_jid !== senderJid) {
    const patchVinc: Record<string, any> = {
      whatsapp_jid: senderJid,
      whatsapp_vinculado: true,
      updated_at: new Date().toISOString(),
    };
    if (!cliente.telefono_normalizado && telLimpio.length >= 7) {
      patchVinc.telefono_normalizado = telLimpio;
    }
    let qVinc = supabaseAdmin.from("clientes").update(patchVinc).eq("id", cliente.id);
    if (cliente.grupo_id) {
      qVinc = qVinc.eq("grupo_id", cliente.grupo_id);
    }
    await qVinc;
    cliente.whatsapp_jid = senderJid;
  }

  const nombreJugador = cliente?.seudonimo || cliente?.nombre || senderNombre || "Jugador";

  if (!cliente) {
    return {
      ok: false,
      tipo: "ERROR",
      mensaje: "Cliente no registrado",
      acciones: {
        responderEnGrupo: `Hola ${nombreJugador}, para participar en las jugadas debes vincular tu número en la plataforma o contactar a la administración.`,
      },
    };
  }

  const saldoDisponible = calcularDisponibleCliente(cliente);

  // =========================================================================
  // CASO 1: CONCRECIÓN POR RESPUESTA CITADA (QUOTED MESSAGE)
  // =========================================================================
  if (quotedMsgId) {
    // Buscar la propuesta citada por whatsapp_msg_id o por ID interno
    const { data: propMsg } = await supabaseAdmin
      .from("chat_mensajes")
      .select("*")
      .or(`whatsapp_msg_id.eq.${quotedMsgId},id.eq.${quotedMsgId}`)
      .eq("sala_id", salaId)
      .limit(1)
      .maybeSingle();

    if (propMsg && (propMsg.tipo_mensaje === "propuesta_jugada" || propMsg.tipo_mensaje === "PROPUESTA")) {
      const cmdRetiroCita = analizarComandoRetiro(textoLimpio);
      if (cmdRetiroCita.esComandoRetiro) {
        if (!esCarreraAbierta) {
          return {
            ok: true,
            tipo: "IGNORADO",
            acciones: {
              responderEnGrupo: null,
              enviarPrivadoJugador: null,
            },
          };
        }

        if (!cmdRetiroCita.esValido) {
          return {
            ok: false,
            tipo: "PEDAGOGICO",
            acciones: {
              responderEnGrupo: null,
              enviarPrivadoJugador: dm(
                cmdRetiroCita.mensajeAclaratoria ||
                  "Por favor aclara si deseas retirar tus jugadas con: 'Se fue', 'sf' o 'cf'"
              ),
            },
          };
        }

        if (propMsg.remitente_id !== cliente.id) {
          return {
            ok: false,
            tipo: "PEDAGOGICO",
            acciones: {
              responderEnGrupo: null,
              enviarPrivadoJugador: dm("⚠️ Solo el autor de la propuesta puede retirarla con 'Se fue'."),
            },
          };
        }

        await ejecutarRetiroPropuestasSeFue({
          grupoId,
          salaId,
          jugadorId: cliente.id,
          propuestaId: propMsg.id,
        });
        await emitirBroadcast(salaId, "nuevo_mensaje", { salaId });

        return {
          ok: true,
          tipo: "TEXTO",
          acciones: {
            responderEnGrupo: null,
            enviarPrivadoJugador: null,
          },
        };
      }

      if (!esCarreraAbierta) {
        return {
          ok: false,
          tipo: "PEDAGOGICO",
          acciones: {
            responderEnGrupo: `⛔ La carrera se encuentra ${sala.estado_carrera.toUpperCase()}. No se admiten nuevas concreciones.`,
          },
        };
      }

      if (propMsg.remitente_id === cliente.id) {
        return {
          ok: false,
          tipo: "PEDAGOGICO",
          acciones: {
            responderEnGrupo: `⚠️ No puedes concretar tu propia propuesta de jugada.`,
          },
        };
      }

      const estadoPropInicial = String(propMsg.estado_propuesta || "abierta").toLowerCase();
      if (estadoPropInicial === "cancelada" || estadoPropInicial === "se_fue") {
        if (esIntentoConcrecionOMontoParcial(textoLimpio)) {
          return {
            ok: false,
            tipo: "PEDAGOGICO",
            acciones: {
              responderEnGrupo: "🚫Nada aquí, Se fue.",
              enviarPrivadoJugador: null,
            },
          };
        }
        return {
          ok: false,
          tipo: "IGNORADO",
          acciones: {
            responderEnGrupo: null,
            enviarPrivadoJugador: null,
          },
        };
      }

      // Control estricto de vigencia de la jugada (tiempo configurable, default 120s)
      const tiempoVigencia = Number(sala.tiempo_vigencia_segundos || 120);
      const edadSegundos = (Date.now() - new Date(propMsg.created_at).getTime()) / 1000;
      const remanenteDisponible = Number(propMsg.monto_disponible ?? propMsg.monto_original ?? 0);

      if (edadSegundos > tiempoVigencia || propMsg.estado_propuesta !== "abierta" || remanenteDisponible <= 0) {
        if (propMsg.estado_propuesta === "abierta") {
          await supabaseAdmin
            .from("chat_mensajes")
            .update({ estado_propuesta: "cerrada", monto_disponible: 0 })
            .eq("id", propMsg.id);
        }
        return {
          ok: false,
          tipo: "PEDAGOGICO",
          acciones: {
            responderEnGrupo: "Jugada no concreta por estar vencida.",
          },
        };
      }

      // Encolar en el Mutex de la propuesta para garantizar ejecución atómica FIFO
      return await encolarConcrecion(propMsg.id, async () => {
        // Reconsultar propuesta fresca con bloqueo
        const { data: propFresca } = await supabaseAdmin
          .from("chat_mensajes")
          .select("*")
          .eq("id", propMsg.id)
          .single();

        const estadoFresca = String(propFresca?.estado_propuesta || "abierta").toLowerCase();
        if (estadoFresca === "cancelada" || estadoFresca === "se_fue") {
          if (esIntentoConcrecionOMontoParcial(textoLimpio)) {
            return {
              ok: false,
              tipo: "PEDAGOGICO",
              acciones: {
                responderEnGrupo: "🚫Nada aquí, Se fue.",
                enviarPrivadoJugador: null,
              },
            };
          }
          return {
            ok: false,
            tipo: "IGNORADO",
            acciones: {
              responderEnGrupo: null,
              enviarPrivadoJugador: null,
            },
          };
        }

        const remanenteActual = Number(propFresca?.monto_disponible ?? propFresca?.monto_original ?? 0);
        const edadFresca = (Date.now() - new Date(propFresca?.created_at || propMsg.created_at).getTime()) / 1000;

        if (edadFresca > tiempoVigencia || remanenteActual <= 0 || propFresca?.estado_propuesta !== "abierta") {
          if (propFresca?.estado_propuesta === "abierta") {
            await supabaseAdmin
              .from("chat_mensajes")
              .update({ estado_propuesta: "cerrada", monto_disponible: 0 })
              .eq("id", propMsg.id);
          }
          return {
            ok: false,
            tipo: "PEDAGOGICO",
            acciones: {
              responderEnGrupo: "Jugada no concreta por estar vencida.",
            },
          };
        }

        // Control dinámico de saldo concurrente del proponente
        const { data: proponente } = await supabaseAdmin
          .from("clientes")
          .select("id, nombre, saldo_actual, saldo_retenido, libre, aval")
          .eq("id", propFresca.remitente_id)
          .single();

        const saldoDispProponente = calcularDisponibleCliente(proponente);
        const maxSaldoLimitador = saldoDispProponente <= saldoDisponible ? "PROPONENTE" : "ACEPTANTE";
        if (!proponente?.libre && saldoDispProponente <= 0) {
          await supabaseAdmin
            .from("chat_mensajes")
            .update({ estado_propuesta: "cerrada", monto_disponible: 0 })
            .eq("id", propFresca.id);

          return {
            ok: false,
            tipo: "PEDAGOGICO",
            acciones: {
              responderEnGrupo: "Jugada no concreta por falta de saldo disponible.",
            },
          };
        }

        const accionProp: 'JUEGA' | 'CONSIGUE' =
          (propFresca.accion_proponente || "").toUpperCase() === "CONSIGUE" ||
          (propFresca.contenido || "").toLowerCase().startsWith("consigo")
            ? "CONSIGUE"
            : "JUEGA";

        const evaluacion = evaluarConcrecionEstricta(
          textoLimpio,
          accionProp,
          remanenteActual,
          saldoDisponible,
          nombreJugador,
          undefined,
          codigoSala,
          Boolean(quotedMsgId)
        );

        if (!evaluacion.valido) {
          // Registrar en auditoría
          await supabaseAdmin.from("registro_revision_llm").insert({
            grupo_id: grupoId,
            sala_id: salaId,
            usuario_id: cliente.id,
            usuario_nombre: nombreJugador,
            mensaje_usuario_original: textoLimpio,
            jugada_corregida_sugerida: evaluacion.motivoRechazo || "Palabra no autorizada",
            motivo_rechazo: "CONCRECION_VERBO_INVALIDO",
          });

          return {
            ok: false,
            tipo: "PEDAGOGICO",
            acciones: {
              enviarPrivadoJugador: dm(evaluacion.motivoRechazo || "Palabra no autorizada para concretar esta jugada."),
            },
          };
        }

        let montoConcretado = evaluacion.montoEfectivo;
        let excedioSaldoProponente = false;
        if (!proponente?.libre && montoConcretado > saldoDispProponente) {
          montoConcretado = saldoDispProponente;
          excedioSaldoProponente = true;
        }
        const nuevoRemanente = Math.max(0, Number((remanenteActual - montoConcretado).toFixed(2)));

        // Intentar ejecutar el RPC atómico oficial
        let rpcExitoso = false;
        try {
          const { data: resRpc, error: errRpc } = await supabaseAdmin.rpc("concretar_jugada_fifo_atomica", {
            p_grupo_id: grupoId,
            p_sala_id: salaId,
            p_propuesta_msg_id: propFresca.id,
            p_aceptante_id: cliente.id,
            p_monto_pedido: montoConcretado,
          });
          if (errRpc || (resRpc as any)?.ok === false) {
            console.error("[RPC_CONCRETAR_ERR]", {
              errRpc,
              resRpc,
              p_grupo_id: grupoId,
              p_sala_id: salaId,
              p_propuesta_msg_id: propFresca.id,
              p_aceptante_id: cliente.id,
              p_monto_pedido: montoConcretado,
            });
          }
          if (!errRpc && resRpc && (resRpc as any).ok !== false) {
            rpcExitoso = true;
          }
        } catch (exRpc) {
          console.error("[RPC_CONCRETAR_CATCH]", exRpc);
          rpcExitoso = false;
        }

        // Si el RPC no procesó, ejecutar fallback seguro
        if (!rpcExitoso) {
          if (!cliente.libre) {
            const nuevoRetenido = Number((Number(cliente.saldo_retenido || 0) + montoConcretado).toFixed(2));
            await supabaseAdmin.from("clientes").update({ saldo_retenido: nuevoRetenido }).eq("id", cliente.id);
          }

          await supabaseAdmin
            .from("chat_mensajes")
            .update({
              monto_disponible: nuevoRemanente,
              estado_propuesta: nuevoRemanente <= 0 ? "cerrada" : "abierta",
            })
            .eq("id", propFresca.id);

          const codigoTicket = `WA-${Date.now().toString().slice(-6)}`;
          const rawFirma = `${codigoTicket}:${propFresca.remitente_id}:${cliente.id}:${montoConcretado}:${new Date().toISOString()}`;
          const firma = crypto.createHash("sha256").update(rawFirma).digest("hex");

          await insertarTicketFifo({
            codigoTicket,
            firmaSha256: firma,
            grupoId,
            salaId,
            propuestaMsgId: propFresca.id,
            proponenteId: propFresca.remitente_id,
            proponenteNombre: propFresca.remitente_nombre || "Proponente",
            aceptanteId: cliente.id,
            aceptanteNombre: nombreJugador,
            carreraId: propFresca.carrera_id || sala.carrera_activa_id,
            accionProponente: propFresca.accion_proponente || "JUEGA",
            esMatch: Boolean(propFresca.es_match),
            modalidad: propFresca.modalidad_jugada || "1P",
            ejemplarNumero: propFresca.ejemplar_numero || (propFresca.caballos_bando_a?.[0] ?? "1"),
            caballosBandoA: propFresca.caballos_bando_a || [],
            caballosBandoB: propFresca.caballos_bando_b || [],
            proporcionPremio: propFresca.proporcion_premio || "1x1",
            montoSolicitado: montoConcretado,
            montoConcretado,
            riesgoProponente: montoConcretado,
            riesgoAceptante: montoConcretado,
            estado: "ABIERTO",
          });
        }

        await sincronizarTicketsPropuestaATaquilla(supabaseAdmin, {
          propuestaMsgId: propFresca.id,
          sala,
          grupoId,
          condicionProponente: propFresca.condicion_proponente,
          carreraAbierta: String((sala as any)?.estado_carrera || "").toLowerCase() === "abierta",
          montoAConcretar: montoConcretado,
        });

        // Consultar desglose completo de quienes van jugando esta propuesta
        const { data: ticketsPropuesta } = await supabaseAdmin
          .from("chat_tickets_fifo")
          .select("aceptante_nombre, monto_concretado, created_at")
          .eq("propuesta_msg_id", propFresca.id)
          .order("created_at", { ascending: true });

        const listaJugaron =
          ticketsPropuesta && ticketsPropuesta.length > 0
            ? ticketsPropuesta.map((t: any) => ({
                jugador: String(t.aceptante_nombre || nombreJugador),
                monto: Number(t.monto_concretado || 0),
              }))
            : [{ jugador: nombreJugador, monto: montoConcretado }];

        const totalVanJugando = listaJugaron.reduce((acc, x) => acc + x.monto, 0);
        const lineasDesglose = listaJugaron
          .map((x) => `• ${x.jugador} jugó ${prefijo}${formatearMontoRegional(x.monto)}`)
          .join("\n");

        const contenidoVanJugando =
          `🤝 *Van jugando por ${prefijo}${formatearMontoRegional(totalVanJugando)}* (${propFresca.jugada_estandarizada || propFresca.contenido})\n` +
          `${lineasDesglose}\n` +
          `${nuevoRemanente > 0 ? `Remanente disponible: ${prefijo}${formatearMontoRegional(nuevoRemanente)}` : "✅ ¡Jugada completada!"}`;

        // Registrar mensaje de concreción en chat_mensajes ("Van jugando por X", nunca "CRUCE")
        await supabaseAdmin.from("chat_mensajes").insert({
          grupo_id: grupoId,
          sala_id: salaId,
          remitente_id: cliente.id,
          remitente_nombre: nombreJugador,
          es_operador: false,
          tipo_mensaje: "CONCRECION",
          contenido: contenidoVanJugando,
          reply_to_msg_id: propFresca.id,
          whatsapp_msg_id: whatsappMsgId || null,
          whatsapp_quoted_msg_id: quotedMsgId,
          origen_canal: "whatsapp",
          carrera_id: propFresca.carrera_id || sala.carrera_activa_id,
        });

        await emitirBroadcast(salaId, "nuevo_mensaje", { salaId });

        // Mensajes del Bot según especificación exacta ("Van jugando por X", nunca "CRUCE")
        let msgPublicoBot: string | null = null;
        let msgPrivadoBot: string | null = null;

        if (evaluacion.excedioSaldo) {
          msgPublicoBot = evaluacion.msgPublicoBot || `Esta jugada solo por ${prefijo}${formatearMontoRegional(saldoDisponible)}`;
          msgPrivadoBot = evaluacion.msgPrivadoBot || `"Atento", no publique jugadas por encima de saldo disponible, nos agrada tenerlo en este grupo`;
        }

        const montoSolicitadoReal = Number(evaluacion.montoSolicitado || montoConcretado);
        const esConcrecionSaldoParcial =
          montoConcretado > 0 && montoConcretado < montoSolicitadoReal;
        let mensajeSaldoParcial: string | null = null;
        if (esConcrecionSaldoParcial) {
          const nombreJuega =
            accionProp === "CONSIGUE"
              ? nombreJugador
              : propFresca.remitente_nombre || "Proponente";
          const nombreDa =
            accionProp === "CONSIGUE"
              ? propFresca.remitente_nombre || "Proponente"
              : nombreJugador;
          const nombreSaldo =
            maxSaldoLimitador === "PROPONENTE"
              ? accionProp === "CONSIGUE"
                ? nombreDa
                : nombreJuega
              : accionProp === "CONSIGUE"
              ? nombreJuega
              : nombreDa;
          const mapaParcial = await cargarPlantillasGrupo(sala?.grupo_id || grupoId);
          mensajeSaldoParcial = obtenerPlantillaGrupo(
            mapaParcial,
            "concrecion_saldo_parcial",
            {
              ...variablesEncabezadoGrupo(sala, "concrecion"),
              juega: nombreJuega,
              da: nombreDa,
              monto: formatearMontoRegional(montoConcretado),
              saldo_de: nombreSaldo,
            },
            mensajeJugaronPorSaldoParcial({
              juega: nombreJuega,
              da: nombreDa,
              monto: montoConcretado,
              saldoDe: nombreSaldo,
            })
          );
        }

        const msgGrupoFinal = [mensajeSaldoParcial, msgPublicoBot, contenidoVanJugando]
          .filter(Boolean)
          .join("\n");

        const msgPrivadoAceptante = msgPrivadoBot || `✅ Has tomado la jugada de ${propFresca.remitente_nombre} por ${prefijo}${formatearMontoRegional(montoConcretado)}. Retención aplicada: ${prefijo}${formatearMontoRegional(montoConcretado)}.`;
        const msgPrivadoProponente = `🔔 ${nombreJugador} jugó ${prefijo}${formatearMontoRegional(montoConcretado)} en tu jugada (${propFresca.jugada_estandarizada || propFresca.contenido}). Van jugando por ${prefijo}${formatearMontoRegional(totalVanJugando)}. ${nuevoRemanente > 0 ? `Remanente activo: ${prefijo}${formatearMontoRegional(nuevoRemanente)}` : "Tu jugada está 100% pactada."}`;

        return {
          ok: true,
          tipo: "CONCRECION",
          acciones: {
            responderEnGrupo: msgGrupoFinal,
            enviarPrivadoJugador: dm(msgPrivadoAceptante),
            enviarPrivadoProponente: dm(msgPrivadoProponente),
          },
          data: {
            montoConcretado,
            nuevoRemanente,
            propuestaId: propFresca.id,
          },
        };
      });
    }
  }

  // =========================================================================
  // CASO 2: MENSAJE SIN CITA -> ANALIZAR SI ES COMANDO RETIRO, PROPUESTA O TEXTO
  // =========================================================================

  // 1. Detección de orden de cierre/retiro de jugadas abiertas ("Se fue", "sf", etc.)
  const analisisRetiro = analizarComandoRetiro(textoLimpio);
  if (analisisRetiro.esComandoRetiro) {
    if (!esCarreraAbierta) {
      return {
        ok: true,
        tipo: "IGNORADO",
        acciones: {
          responderEnGrupo: null,
          enviarPrivadoJugador: null,
        },
      };
    }

    if (!analisisRetiro.esValido) {
      return {
        ok: false,
        tipo: "PEDAGOGICO",
        acciones: {
          responderEnGrupo: null,
          enviarPrivadoJugador: dm(
            analisisRetiro.mensajeAclaratoria ||
              "Por favor aclara si deseas retirar tus jugadas con: 'Se fue', 'sf' o 'cf'"
          ),
        },
      };
    }

    await ejecutarRetiroPropuestasSeFue({
      grupoId,
      salaId,
      jugadorId: cliente.id,
      propuestaId: null,
    });

    await emitirBroadcast(salaId, "nuevo_mensaje", { salaId });

    return {
      ok: true,
      tipo: "TEXTO",
      acciones: {
        responderEnGrupo: null,
        enviarPrivadoJugador: dm("✅ Todas tus propuestas abiertas fueron retiradas."),
      },
    };
  }

  const retirados = sala.retirados || [];
  const analisis = analizarYEstandarizarJugada(
    textoLimpio,
    saldoDisponible,
    retirados,
    16,
    nombreJugador,
    undefined,
    codigoSala
  );

  // Si tuvo intención de jugar pero no fue válida (error sintaxis, ejemplar retirado, etc.)
  if (analisis.esIntencionDeJugada && !analisis.valido) {
    await supabaseAdmin.from("registro_revision_llm").insert({
      grupo_id: grupoId,
      sala_id: salaId,
      usuario_id: cliente.id,
      usuario_nombre: nombreJugador,
      mensaje_usuario_original: textoLimpio,
      jugada_corregida_sugerida: analisis.jugadaEstandarizada || analisis.mensajePedagogicoPrivado,
      motivo_rechazo: "SINTAXIS_O_SALDO_INVALIDO",
    });

    try {
      await supabaseAdmin.from("diccionario_aprendizaje_bot").insert({
        grupo_id: grupoId,
        termino_original: textoLimpio,
        jugada_corregida: analisis.jugadaEstandarizada || analisis.mensajePedagogicoPrivado,
        usuario_id: cliente.id,      });
    } catch {
      // Resiliente
    }

    return {
      ok: false,
      tipo: "PEDAGOGICO",
      acciones: {
        enviarPrivadoJugador: dm(
          analisis.mensajePedagogicoPrivado ||
          "Formato de jugada no reconocido. Ejemplo: Juego 1p del 5 con 50"
        ),
      },
    };
  }

  // Si es una propuesta válida
  if (analisis.esIntencionDeJugada && analisis.valido) {
    if (!esCarreraAbierta) {
      return {
        ok: false,
        tipo: "PEDAGOGICO",
        acciones: {
          responderEnGrupo: `⛔ La carrera se encuentra ${sala.estado_carrera.toUpperCase()}. No se reciben nuevas jugadas.`,
        },
      };
    }

    let montoEfectivo = Number(analisis.monto);
    let rpcExitoso = false;
    let propId: string | null = null;
    let excedioSaldoRpc = Boolean(analisis.excedioSaldo);

    // Intentar primero RPC oficial publicar_propuesta_atomica
    try {
      const { data: resRpc, error: errRpc } = await supabaseAdmin.rpc("publicar_propuesta_atomica", {
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
        p_proporcion: "1x1",
        p_monto_solicitado: analisis.monto,
        p_texto_estandarizado: analisis.jugadaEstandarizada,
      });

      if (!errRpc && resRpc) {
        propId = (resRpc as any).propuesta_id;
        if ((resRpc as any).monto_publicado != null) montoEfectivo = Number((resRpc as any).monto_publicado);
        if ((resRpc as any).excedio_saldo != null) excedioSaldoRpc = Boolean((resRpc as any).excedio_saldo);
        rpcExitoso = true;
      }
    } catch {
      rpcExitoso = false;
    }

    // Si el RPC creó la propuesta, asociar el whatsapp_msg_id y canal
    if (rpcExitoso && propId) {
      await supabaseAdmin
        .from("chat_mensajes")
        .update({
          whatsapp_msg_id: whatsappMsgId || null,
          origen_canal: "whatsapp",
        })
        .eq("id", propId);
    } else {
      // Fallback directo si el RPC no estaba desplegado o falló por concurrencia
      if (!cliente.libre) {
        const saldoRetenidoActual = Number(cliente.saldo_retenido || 0);
        const nuevoRetenido = Number((saldoRetenidoActual + montoEfectivo).toFixed(2));
        await supabaseAdmin.from("clientes").update({ saldo_retenido: nuevoRetenido }).eq("id", cliente.id);
      }

      const rawFirma = `PROPUESTA_WA:${salaId}:${cliente.id}:${montoEfectivo}:${Date.now()}`;
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
          carrera_id: sala.carrera_activa_id || null,
          accion_proponente: analisis.accionProponente || "JUEGA",
          es_match: Boolean(analisis.esMatch),
          modalidad_jugada: analisis.modalidad,
          ejemplar_numero: analisis.ejemplarTexto,
          caballos_bando_a: analisis.caballosBandoA || (analisis.ejemplarTexto ? [analisis.ejemplarTexto] : []),
          caballos_bando_b: analisis.caballosBandoB || [],
          jugada_estandarizada: analisis.jugadaEstandarizada,
          monto_original: montoEfectivo,
          monto_disponible: montoEfectivo,
          estado_propuesta: "abierta",
          proporcion_premio: "1x1",
          firma_sha256: firma,
          whatsapp_msg_id: whatsappMsgId || null,
          origen_canal: "whatsapp",
        })
        .select()
        .single();

      if (errInsert) {
        return { ok: false, tipo: "ERROR", mensaje: errInsert.message };
      }

      propId = nuevaPropuesta?.id;
    }

    await emitirBroadcast(salaId, "nuevo_mensaje", { salaId });

    // Mensajes exactos del bot si excedió saldo
    let msgPublicoBot: string | null = null;
    let msgPrivadoBot: string | null = null;

    if (excedioSaldoRpc) {
      msgPublicoBot = analisis.msgPublicoBot || `[${nombreJugador}] solo dispone de ${prefijo}${formatearMontoRegional(saldoDisponible)} para esta jugada.`;
      msgPrivadoBot = analisis.msgPrivadoBot || `"Atento", no publique jugadas por encima de saldo disponible, nos agrada tenerlo en este grupo`;
    }

    const msgGrupo = msgPublicoBot
      ? `${msgPublicoBot}\n🏇 *Propuesta Registrada*: ${analisis.jugadaEstandarizada} por ${prefijo}${formatearMontoRegional(montoEfectivo)}`
      : `🏇 *Nueva Propuesta*: ${analisis.jugadaEstandarizada} (${prefijo}${formatearMontoRegional(montoEfectivo)})\n↩️ Responde a este mensaje con *Consigo*, *J* o *Ponte* para tomarla.`;

    return {
      ok: true,
      tipo: "PROPUESTA",
      acciones: {
        responderEnGrupo: msgGrupo,
        enviarPrivadoJugador: dm(msgPrivadoBot),
      },
      data: {
        propuestaId: propId,
        monto: montoEfectivo,
      },
    };
  }

  // =========================================================================
  // CASO 3: MENSAJE DE TEXTO ESTÁNDAR
  // =========================================================================
  await supabaseAdmin.from("chat_mensajes").insert({
    grupo_id: grupoId,
    sala_id: salaId,
    remitente_id: cliente.id,
    remitente_nombre: nombreJugador,
    es_operador: false,
    tipo_mensaje: "TEXTO",
    contenido: textoLimpio,
    whatsapp_msg_id: whatsappMsgId || null,
    whatsapp_quoted_msg_id: quotedMsgId || null,
    origen_canal: "whatsapp",
  });

  await emitirBroadcast(salaId, "nuevo_mensaje", { salaId });

  return {
    ok: true,
    tipo: "TEXTO",
    mensaje: "Mensaje de texto registrado",
  };
}
