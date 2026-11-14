// ============================================================================
// DEMONIO / SERVICIO 24/7 DEL BOT DE WHATSAPP (@whiskeysockets/baileys)
// Puerto Local: 3005 (http://127.0.0.1:3005)
// Sesión persistente: /root/sistema_hipico/whatsapp_auth
// ============================================================================

import http from "node:http";
import WebSocket from "ws";

if (typeof globalThis.WebSocket === "undefined") {
  globalThis.WebSocket = WebSocket;
}
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Cargar variables de entorno desde .env.local o .env sin dependencias externas
function cargarVariablesEntorno() {
  const archivos = [
    path.join(__dirname, ".env.local"),
    path.join(__dirname, ".env"),
    "/root/sistema_hipico/.env.local",
    "/root/sistema_hipico/.env",
  ];
  for (const archivo of archivos) {
    try {
      if (!fs.existsSync(archivo)) continue;
      const contenido = fs.readFileSync(archivo, "utf8");
      for (const linea of contenido.split(/\r?\n/)) {
        const limpia = linea.trim();
        if (!limpia || limpia.startsWith("#")) continue;
        const idx = limpia.indexOf("=");
        if (idx === -1) continue;
        const clave = limpia.slice(0, idx).trim();
        let valor = limpia.slice(idx + 1).trim();
        if (
          (valor.startsWith('"') && valor.endsWith('"')) ||
          (valor.startsWith("'") && valor.endsWith("'"))
        ) {
          valor = valor.slice(1, -1);
        }
        if (!process.env[clave]) {
          process.env[clave] = valor;
        }
      }
    } catch {
      // Continuar silenciosamente
    }
  }
}

cargarVariablesEntorno();

const PORT = Number(process.env.WHATSAPP_BOT_PORT || 3005);
const NEXT_API_BASE = process.env.NEXT_INTERNAL_URL || "http://127.0.0.1:3000";
const AUTH_DIR =
  process.env.WHATSAPP_AUTH_DIR ||
  (process.platform === "linux"
    ? "/root/sistema_hipico/whatsapp_auth"
    : path.join(__dirname, "whatsapp_auth"));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
        realtime: {
          transport: WebSocket,
        },
      })
    : null;

// Estado en memoria del demonio Baileys
let sock = null;
let conectado = false;
let qrDataUrl = null;
let numeroVinculado = null;
let gruposCache = [];
let reconectando = false;

// Caché de mensajes recientes por ID para poder construir el objeto `quoted` en Baileys
const mensajesRecientesCache = new Map();
function guardarMensajeEnCache(msg) {
  if (!msg?.key?.id) return;
  mensajesRecientesCache.set(msg.key.id, msg);
  if (mensajesRecientesCache.size > 1500) {
    const primeraKey = mensajesRecientesCache.keys().next().value;
    if (primeraKey) mensajesRecientesCache.delete(primeraKey);
  }
}

function normalizarTelefono(raw) {
  if (!raw) return "";
  return String(raw)
    .replace(/@.*$/, "")
    .replace(/:.*$/, "")
    .replace(/[^0-9]/g, "");
}

function aJidPrivado(telefonoOjid) {
  if (!telefonoOjid) return "";
  const str = String(telefonoOjid).trim();
  if (str.endsWith("@s.whatsapp.net") || str.endsWith("@lid")) return str;
  const digitos = normalizarTelefono(str);
  return digitos ? `${digitos}@s.whatsapp.net` : "";
}

function formatearMonto(n) {
  const num = Number(n || 0);
  return num.toLocaleString("es-VE", {
    minimumFractionDigits: num % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

async function convertirQrADataUrl(qrTexto) {
  if (!qrTexto) return null;
  try {
    const QRCode = await import("qrcode");
    const fn = QRCode.toDataURL || QRCode.default?.toDataURL;
    if (typeof fn === "function") {
      return await fn(qrTexto, { margin: 2, width: 320 });
    }
  } catch {
    // Fallback si el paquete `qrcode` no está instalado localmente
  }
  return `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(qrTexto)}`;
}

async function refrescarGruposParticipantes() {
  if (!sock || !conectado) return gruposCache;
  try {
    const participando = await sock.groupFetchAllParticipating();
    gruposCache = Object.values(participando || {}).map((g) => ({
      jid: g.id,
      nombre: g.subject || g.id,
    }));
  } catch (err) {
    console.error("[Bot WhatsApp] Error al listar grupos:", err?.message || err);
  }
  return gruposCache;
}

async function enviarMensajeGrupo(groupJid, texto, quotedMsgId = null) {
  if (!sock || !conectado) {
    throw new Error("El Bot de WhatsApp no está conectado actualmente.");
  }
  if (!groupJid || !texto) return null;

  const opciones = {};
  if (quotedMsgId) {
    const msgOriginal = mensajesRecientesCache.get(quotedMsgId);
    if (msgOriginal) {
      opciones.quoted = msgOriginal;
    } else {
      opciones.quoted = {
        key: {
          remoteJid: groupJid,
          fromMe: false,
          id: quotedMsgId,
        },
        message: { conversation: "" },
      };
    }
  }

  return await sock.sendMessage(groupJid, { text: texto }, opciones);
}

async function enviarMensajePrivado(telefonoOjid, texto) {
  if (!sock || !conectado) {
    throw new Error("El Bot de WhatsApp no está conectado actualmente.");
  }
  const jid = aJidPrivado(telefonoOjid);
  if (!jid || !texto) return null;
  return await sock.sendMessage(jid, { text: texto });
}

// ============================================================================
// GENERADORES DE APERTURA, CIERRE, PLANO Y LLEGADA / SENTENCIA
// ============================================================================

export async function ejecutarAperturaCarrera(sala, groupJid, hipodromoArg, carreraArg) {
  if (!supabase) throw new Error("Supabase no configurado");

  const hipoLimpio = String(hipodromoArg || sala.hipodromo_activo || "LA RINCONADA").toUpperCase().trim();
  const numCarrera = parseInt(carreraArg, 10) || 1;

  // Actualizar sala en Supabase
  await supabase
    .from("salas_juego")
    .update({
      hipodromo_activo: hipoLimpio,
      numero_carrera_activa: numCarrera,
      estado_carrera: "abierta",
      retirados: [],
      updated_at: new Date().toISOString(),
    })
    .eq("id", sala.id);

  // Formatear ordinal y mensaje oficial
  const ord = numCarrera === 1 ? "1ra" : numCarrera === 2 ? "2da" : numCarrera === 3 ? "3ra" : `${numCarrera}ta`;
  const textoApertura = `🏆🏇${hipoLimpio}, ${ord} Carrera🏆🏇\nCARRERA ABIERTA Y EN JUEGO\nMucha suerte a todos.`;

  if (groupJid && conectado) {
    await enviarMensajeGrupo(groupJid, textoApertura);
  }

  return { ok: true, hipodromo: hipoLimpio, carrera: numCarrera, textoApertura };
}

export async function ejecutarCierreCarrera(sala, groupJid) {
  if (!supabase) throw new Error("Supabase no configurado");

  await supabase
    .from("salas_juego")
    .update({
      estado_carrera: "cerrada",
      carrera_recien_cerrada_id: sala.carrera_activa_id || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sala.id);

  const hipo = String(sala.hipodromo_activo || "HIPÓDROMO").toUpperCase();
  const numCarrera = sala.numero_carrera_activa || 1;
  const ord = numCarrera === 1 ? "1ra" : numCarrera === 2 ? "2da" : numCarrera === 3 ? "3ra" : `${numCarrera}ta`;

  const textoCierre = `${hipo}, ${ord} Carrera\nCARRERA CERRADA\n\nPUEDE ESCRIBIR LA PIZARRA: LLEGADA: 1RO.2DO.3RO.4TO.5TO`;

  if (groupJid && conectado) {
    await enviarMensajeGrupo(groupJid, textoCierre);
  }

  return { ok: true, textoCierre };
}

export async function construirYPublicarPlano(sala, groupJid) {
  if (!supabase) throw new Error("Supabase no configurado en bot-whatsapp-server");

  const hipodromo = String(sala.hipodromo_activo || "HIPÓDROMO").toUpperCase();
  const numCarrera = sala.numero_carrera_activa || 1;
  const carreraId = sala.carrera_activa_id || null;

  let query = supabase
    .from("chat_tickets_fifo")
    .select("*")
    .eq("sala_id", sala.id)
    .in("estado", ["PENDIENTE", "ACTIVO", "ABIERTO"])
    .order("created_at", { ascending: true });

  if (carreraId) {
    query = query.or(`carrera_id.eq.${carreraId},carrera_id.is.null`);
  }

  const { data: tickets, error } = await query;
  if (error) throw new Error(error.message);

  const lista = tickets || [];
  const totalPactado = lista.reduce((acc, t) => acc + Number(t.monto_concretado || 0), 0);

  const lineas =
    lista.length > 0
      ? lista
          .map((t, idx) => {
            const codigo = (t.codigo_ticket || String(t.id || "").slice(0, 6)).toUpperCase();
            const detalleJugada = t.es_match
              ? `Match ${(t.caballos_bando_a || []).join("-")} x ${(t.caballos_bando_b || []).join("-")}`
              : `${t.modalidad || "1P"} #${t.ejemplar_numero || (t.caballos_bando_a || []).join("-")}`;
            return `${idx + 1}. [${codigo}] *${t.proponente_nombre}* vs *${t.aceptante_nombre}* — ${detalleJugada} por *$${formatearMonto(t.monto_concretado)}*`;
          })
          .join("\n")
      : "_No hay jugadas activas pactadas en esta carrera._";

  const textoPlano =
    `📋 *PLANO DE JUGADAS / PREJUGADAS*\n` +
    `🏇 *${hipodromo}* — Carrera #${numCarrera}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `${lineas}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💰 *Total Jugado:* $${formatearMonto(totalPactado)} (${lista.length} tickets)`;

  if (groupJid && conectado) {
    await enviarMensajeGrupo(groupJid, textoPlano);
  }

  return { ok: true, textoPlano, totalTickets: lista.length, totalPactado };
}

export async function ejecutarAnulacionORetiro(sala, groupJid, comando, argumento) {
  if (!supabase) throw new Error("Supabase no configurado");
  const argLimpio = String(argumento || "").trim();
  if (!argLimpio) {
    return {
      ok: false,
      mensaje: `⚠️ Uso correcto: ${comando === "retirar" ? "!retirar [ejemplar]" : "!anular [codigo_ticket]"}`,
    };
  }

  if (comando === "retirar") {
    const carreraEfectivaId = sala.carrera_activa_id || sala.carrera_recien_cerrada_id || null;
    let procesadoRpc = false;

    try {
      const { error: errRpc } = await supabase.rpc("procesar_retirado_en_sala", {
        p_grupo_id: sala.grupo_id,
        p_sala_id: sala.id,
        p_carrera_id: carreraEfectivaId,
        p_ejemplar_retirado: argLimpio,
      });
      if (!errRpc) procesadoRpc = true;
    } catch {
      procesadoRpc = false;
    }

    // Fallback determinístico si el RPC no está o requiere liberar tickets manualmente
    if (!procesadoRpc) {
      const retiradosActuales = Array.from(new Set([...(sala.retirados || []), argLimpio]));
      await supabase
        .from("salas_juego")
        .update({ retirados: retiradosActuales, updated_at: new Date().toISOString() })
        .eq("id", sala.id);

      const { data: ticketsActivos } = await supabase
        .from("chat_tickets_fifo")
        .select("*")
        .eq("sala_id", sala.id)
        .in("estado", ["PENDIENTE", "ACTIVO", "ABIERTO"]);

      for (const tk of ticketsActivos || []) {
        const caballos = [
          String(tk.ejemplar_numero || ""),
          ...(tk.caballos_bando_a || []),
          ...(tk.caballos_bando_b || []),
        ].map((x) => String(x).trim());

        if (caballos.includes(argLimpio)) {
          await supabase.from("chat_tickets_fifo").update({ estado: "ANULADO" }).eq("id", tk.id);
          const monto = Number(tk.monto_concretado || 0);
          for (const jId of [tk.proponente_id, tk.aceptante_id]) {
            if (!jId) continue;
            const { data: cl } = await supabase
              .from("clientes")
              .select("saldo_actual, saldo_retenido, libre, aval")
              .eq("id", jId)
              .maybeSingle();
            if (cl && !cl.libre) {
              const nuevoRet = Math.max(0, Number((Number(cl.saldo_retenido || 0) - monto).toFixed(2)));
              await supabase
                .from("clientes")
                .update({
                  saldo_retenido: nuevoRet,
                  saldo_disponible: Math.max(
                    0,
                    Number((Number(cl.saldo_actual || 0) + Number(cl.aval || 0) - nuevoRet).toFixed(2))
                  ),
                })
                .eq("id", jId);
            }
          }
        }
      }
    }

    const textoConfirmacion =
      `🚫 *RETIRADO OFICIAL PROCESADO*\n` +
      `Ejemplar *#${argLimpio}* retirado en *${sala.hipodromo_activo || "HIPÓDROMO"} C${sala.numero_carrera_activa || 1}*.\n` +
      `✅ Todas las jugadas con el ejemplar #${argLimpio} fueron anuladas y los saldos retenidos han sido liberados.`;

    if (groupJid && conectado) {
      await enviarMensajeGrupo(groupJid, textoConfirmacion);
    }
    return { ok: true, mensaje: textoConfirmacion };
  }

  // !anular [codigo_ticket]
  const { data: ticket } = await supabase
    .from("chat_tickets_fifo")
    .select("*")
    .eq("sala_id", sala.id)
    .ilike("codigo_ticket", `%${argLimpio}%`)
    .neq("estado", "ANULADO")
    .limit(1)
    .maybeSingle();

  if (!ticket) {
    const msgNoEncontrado = `⚠️ No se encontró ningún ticket activo con el código *${argLimpio}*.`;
    if (groupJid && conectado) await enviarMensajeGrupo(groupJid, msgNoEncontrado);
    return { ok: false, mensaje: msgNoEncontrado };
  }

  await supabase.from("chat_tickets_fifo").update({ estado: "ANULADO" }).eq("id", ticket.id);
  const monto = Number(ticket.monto_concretado || 0);

  for (const jId of [ticket.proponente_id, ticket.aceptante_id]) {
    if (!jId) continue;
    const { data: cl } = await supabase
      .from("clientes")
      .select("saldo_actual, saldo_retenido, libre, aval")
      .eq("id", jId)
      .maybeSingle();
    if (cl && !cl.libre) {
      const nuevoRet = Math.max(0, Number((Number(cl.saldo_retenido || 0) - monto).toFixed(2)));
      await supabase
        .from("clientes")
        .update({
          saldo_retenido: nuevoRet,
          saldo_disponible: Math.max(
            0,
            Number((Number(cl.saldo_actual || 0) + Number(cl.aval || 0) - nuevoRet).toFixed(2))
          ),
        })
        .eq("id", jId);
    }
  }

  const textoAnulacion =
    `🚫 *TICKET ANULADO OFICIALMENTE*\n` +
    `Código: *${ticket.codigo_ticket}*\n` +
    `Jugadores: *${ticket.proponente_nombre}* vs *${ticket.aceptante_nombre}*\n` +
    `Monto liberado: *$${formatearMonto(monto)}*`;

  if (groupJid && conectado) {
    await enviarMensajeGrupo(groupJid, textoAnulacion);
  }
  return { ok: true, mensaje: textoAnulacion };
}

export async function ejecutarSentenciaPizarra(sala, groupJid, pizarraRaw) {
  if (!supabase) throw new Error("Supabase no configurado");
  const numeros = String(pizarraRaw || "").match(/\b\d+[A-Za-z]?\b/g) || [];
  if (numeros.length === 0) {
    const msgError = "⚠️ Formato de sentencia inválido. Uso: *!sentenciar 10.5.1.2.7*";
    if (groupJid && conectado) await enviarMensajeGrupo(groupJid, msgError);
    return { ok: false, mensaje: msgError };
  }

  const [p1, p2 = null, p3 = null, p4 = null, p5 = null] = numeros;
  const hipodromo = String(sala.hipodromo_activo || "HIPÓDROMO").toUpperCase();
  const numCarrera = sala.numero_carrera_activa || 1;
  const carreraId = sala.carrera_activa_id || sala.carrera_recien_cerrada_id || null;

  let positivos = [];
  let negativos = [];
  let rpcLiquidado = false;

  // 1. Intentar el RPC oficial `public.liquidar_carrera_sala_oficial`
  try {
    const { data: resRpc, error: errRpc } = await supabase.rpc("liquidar_carrera_sala_oficial", {
      p_grupo_id: sala.grupo_id,
      p_sala_id: sala.id,
      p_carrera_id: carreraId,
      p_p1: p1,
      p_p2: p2,
      p_p3: p3,
      p_p4: p4,
      p_p5: p5,
    });

    if (!errRpc && resRpc) {
      rpcLiquidado = true;
      if (Array.isArray(resRpc.positivos)) positivos = resRpc.positivos;
      if (Array.isArray(resRpc.negativos)) negativos = resRpc.negativos;
    }
  } catch {
    rpcLiquidado = false;
  }

  // 2. Si el RPC no devolvió el desglose o no estaba instalado, liquidar determinísticamente en Supabase
  if (!rpcLiquidado || (positivos.length === 0 && negativos.length === 0)) {
    const { data: grupo } = await supabase
      .from("grupos_venta")
      .select("permite_cruces, comision_default")
      .eq("id", sala.grupo_id)
      .maybeSingle();

    const permiteCruces = grupo?.permite_cruces ?? true;
    const porcComision = Number(grupo?.comision_default ?? 5) / 100;

    let queryTickets = supabase
      .from("chat_tickets_fifo")
      .select("*")
      .eq("sala_id", sala.id)
      .in("estado", ["PENDIENTE", "ACTIVO", "ABIERTO"]);

    if (carreraId) {
      queryTickets = queryTickets.or(`carrera_id.eq.${carreraId},carrera_id.is.null`);
    }

    const { data: tickets } = await queryTickets;
    const balance = {};

    const asegurar = (id, nombre) => {
      if (!balance[id]) {
        balance[id] = {
          nombre: nombre || "Jugador",
          ganancias: 0,
          perdidas: 0,
          comisionInd: 0,
          stake: 0,
        };
      }
    };

    for (const t of tickets || []) {
      asegurar(t.proponente_id, t.proponente_nombre);
      asegurar(t.aceptante_id, t.aceptante_nombre);

      const monto = Number(t.monto_concretado || 0);
      balance[t.proponente_id].stake += monto;
      balance[t.aceptante_id].stake += monto;

      let factor = 0;
      try {
        const { data: evalData, error: evalErr } = await supabase.rpc("evaluar_jugada_universal", {
          p_es_match: Boolean(t.es_match),
          p_accion_proponente: t.accion_proponente || "JUEGA",
          p_modalidad: t.modalidad || "1P",
          p_caballos_a: t.caballos_bando_a || (t.ejemplar_numero ? [t.ejemplar_numero] : []),
          p_caballos_b: t.caballos_bando_b || [],
          p_p1: p1,
          p_p2: p2,
          p_p3: p3,
          p_p4: p4,
          p_p5: p5,
        });
        if (!evalErr) factor = Number(evalData || 0);
      } catch {
        const cabA = String(t.ejemplar_numero || t.caballos_bando_a?.[0] || "");
        const ganoA = cabA === String(p1);
        const esJuega = (t.accion_proponente || "JUEGA") === "JUEGA";
        factor = esJuega ? (ganoA ? 1 : -1) : ganoA ? -1 : 1;
      }

      let nuevoEstado = "EMPATE";
      if (factor > 0) {
        nuevoEstado = "GANADOR_PROPONENTE";
        balance[t.proponente_id].ganancias += monto;
        balance[t.aceptante_id].perdidas += monto;
        balance[t.proponente_id].comisionInd += monto * porcComision;
      } else if (factor < 0) {
        nuevoEstado = "GANADOR_ACEPTANTE";
        balance[t.aceptante_id].ganancias += monto;
        balance[t.proponente_id].perdidas += monto;
        balance[t.aceptante_id].comisionInd += monto * porcComision;
      }

      if (!rpcLiquidado) {
        await supabase.from("chat_tickets_fifo").update({ estado: nuevoEstado }).eq("id", t.id);
      }
    }

    for (const [jugadorId, b] of Object.entries(balance)) {
      let neto = 0;
      if (permiteCruces) {
        const bruto = b.ganancias - b.perdidas;
        neto = bruto > 0 ? bruto - bruto * porcComision : bruto;
      } else {
        neto = b.ganancias - b.comisionInd - b.perdidas;
      }
      neto = Number(neto.toFixed(2));

      if (!rpcLiquidado && jugadorId) {
        const { data: cl } = await supabase
          .from("clientes")
          .select("saldo_actual, saldo_retenido, libre, aval")
          .eq("id", jugadorId)
          .maybeSingle();

        if (cl) {
          const nuevoSaldo = Number((Number(cl.saldo_actual || 0) + neto).toFixed(2));
          const nuevoRet = Math.max(0, Number((Number(cl.saldo_retenido || 0) - b.stake).toFixed(2)));
          await supabase
            .from("clientes")
            .update({
              saldo_actual: nuevoSaldo,
              saldo_retenido: nuevoRet,
              saldo_disponible: cl.libre ? 999999 : Math.max(0, nuevoSaldo + Number(cl.aval || 0) - nuevoRet),
            })
            .eq("id", jugadorId);
        }
      }

      if (neto > 0) {
        positivos.push(`🟢 *${b.nombre}*: +$${formatearMonto(neto)}`);
      } else if (neto < 0) {
        negativos.push(`🔴 *${b.nombre}*: -$${formatearMonto(Math.abs(neto))}`);
      }
    }

    await supabase
      .from("salas_juego")
      .update({
        estado_carrera: "liquidada",
        carrera_recien_cerrada_id: carreraId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sala.id);
  }

  const pizarraFormateada = numeros.map((n, i) => `${i + 1}º: #${n}`).join(" · ");
  const textoResultado =
    `🏁 *LLEGADA OFICIAL — ${hipodromo} C${numCarrera}*\n` +
    `📊 *Pizarra:* ${pizarraFormateada}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📈 *POSITIVOS (+):*\n` +
    `${positivos.length > 0 ? positivos.join("\n") : "_Sin saldos positivos en esta carrera_"}\n\n` +
    `📉 *NEGATIVOS (-):*\n` +
    `${negativos.length > 0 ? negativos.join("\n") : "_Sin saldos negativos en esta carrera_"}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━`;

  if (groupJid && conectado) {
    await enviarMensajeGrupo(groupJid, textoResultado);
  }

  return {
    ok: true,
    textoResultado,
    positivos,
    negativos,
    pizarra: numeros,
  };
}

// ============================================================================
// PROCESAMIENTO EN VIVO DE MENSAJES ENTRANTES DE WHATSAPP
// ============================================================================

async function manejarMensajeEntrante(msg) {
  try {
    if (!msg?.key || msg.key.fromMe) return;

    const remoteJid = msg.key.remoteJid || "";
    if (!remoteJid.endsWith("@g.us")) return;

    guardarMensajeEnCache(msg);

    const texto =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      msg.message?.videoMessage?.caption ||
      "";

    const textoLimpio = String(texto || "").trim();
    if (!textoLimpio) return;

    if (!supabase) return;

    // Verificar si el grupo está vinculado en public.salas_juego.whatsapp_group_jid
    const { data: sala } = await supabase
      .from("salas_juego")
      .select("*")
      .eq("whatsapp_group_jid", remoteJid)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!sala) return;

    const participantJid = msg.key.participant || msg.participant || "";
    const whatsappMsgId = msg.key.id || null;
    const quotedMsgId =
      msg.message?.extendedTextMessage?.contextInfo?.stanzaId || null;

    // 1. Comandos de Operador desde WhatsApp:
    // - !abrir [hipodromo] [carrera] (o "abrir la rinconada 1")
    // - !cerrar
    // - LLEGADA: A.B.C.D.E (o !llegada, !sentenciar, !pizarra)
    // - !plano o !prejugadas
    // - !anular o !retirar

    // Detección de LLEGADA: A.B.C.D.E (con o sin '!')
    const matchLlegada = textoLimpio.match(/^(?:!)?(?:llegada|sentenciar|pizarra)\s*[:=\-]?\s*([0-9\s,./·\-_]+)$/i);
    if (matchLlegada) {
      await ejecutarSentenciaPizarra(sala, remoteJid, matchLlegada[1]);
      return;
    }

    // Detección de Apertura: !abrir [hipodromo] [carrera] o "abierta [hipodromo] [carrera]"
    const matchAbrir = textoLimpio.match(/^(?:!)?(?:abrir|abierta)\s+(.+?)(?:\s+(?:c(?:arrera)?\s*)?(\d{1,2}))?$/i);
    if (matchAbrir) {
      const posibleHipo = matchAbrir[1].trim();
      const posibleCarrera = matchAbrir[2] || "1";
      await ejecutarAperturaCarrera(sala, remoteJid, posibleHipo, posibleCarrera);
      return;
    }

    // Detección de Cierre: !cerrar o "cerrada"
    if (/^(?:!)?(?:cerrar|cerrada|no va mas|no va más)$/i.test(textoLimpio)) {
      await ejecutarCierreCarrera(sala, remoteJid);
      return;
    }

    if (textoLimpio.startsWith("!")) {
      const partes = textoLimpio.slice(1).trim().split(/\s+/);
      const cmd = (partes[0] || "").toLowerCase();
      const resto = partes.slice(1).join(" ").trim();

      if (cmd === "plano" || cmd === "prejugadas") {
        await construirYPublicarPlano(sala, remoteJid);
        return;
      }

      if (cmd === "anular" || cmd === "retirar") {
        await ejecutarAnulacionORetiro(sala, remoteJid, cmd, resto);
        return;
      }
    }

    // 2. Cruzar remitente con public.clientes (por telefono_normalizado o whatsapp_jid)
    const telNormalizado = normalizarTelefono(participantJid);
    let cliente = null;

    if (participantJid || telNormalizado) {
      const { data: clExacto } = await supabase
        .from("clientes")
        .select("id, nombre, saldo_actual, saldo_retenido, saldo_disponible, libre, aval, whatsapp_jid, telefono, telefono_normalizado")
        .or(`whatsapp_jid.eq.${participantJid},telefono_normalizado.eq.${telNormalizado}`)
        .limit(1)
        .maybeSingle();

      if (clExacto) {
        cliente = clExacto;
      } else if (telNormalizado.length >= 8) {
        const { data: clParcial } = await supabase
          .from("clientes")
          .select("id, nombre, saldo_actual, saldo_retenido, saldo_disponible, libre, aval, whatsapp_jid, telefono, telefono_normalizado")
          .ilike("telefono", `%${telNormalizado.slice(-8)}%`)
          .limit(1)
          .maybeSingle();
        cliente = clParcial;
      }
    }

    // 3 y 4. Delegar a http://127.0.0.1:3000/api/whatsapp-sala/procesar
    const res = await fetch(`${NEXT_API_BASE}/api/whatsapp-sala/procesar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        groupJid: remoteJid,
        participantJid,
        senderNombre: msg.pushName || cliente?.nombre || "Jugador",
        texto: textoLimpio,
        whatsappMsgId,
        quotedMsgId: quotedMsgId || null,
      }),
    });

    const data = await res.json().catch(() => null);
    if (!data) return;

    // Publicar respuesta en el grupo (citando el mensaje original del jugador)
    const respuestaGrupo = data.respuestaGrupo || data.acciones?.responderEnGrupo;
    if (respuestaGrupo) {
      await enviarMensajeGrupo(remoteJid, respuestaGrupo, whatsappMsgId);
    }

    // Enviar mensaje privado al autor (corrección pedagógica, alerta de saldo o confirmación)
    const mensajePrivadoAutor = data.mensajePrivadoAutor || data.acciones?.enviarPrivadoJugador;
    if (mensajePrivadoAutor && participantJid) {
      await enviarMensajePrivado(participantJid, mensajePrivadoAutor);
    }

    // Enviar mensaje privado al proponente original cuando le concretan una parada
    const mensajePrivadoProponente =
      data.mensajePrivadoProponente || data.acciones?.enviarPrivadoProponente;
    const proponenteDestino = data.proponenteJid || data.proponenteTelefono;
    if (mensajePrivadoProponente && proponenteDestino) {
      await enviarMensajePrivado(proponenteDestino, mensajePrivadoProponente);
    }
  } catch (err) {
    console.error("[Bot WhatsApp] Error procesando mensaje en vivo:", err?.message || err);
  }
}

// ============================================================================
// CONEXIÓN 24/7 CON @whiskeysockets/baileys
// ============================================================================

async function iniciarConexionBaileys() {
  if (reconectando) return;
  reconectando = true;

  try {
    fs.mkdirSync(AUTH_DIR, { recursive: true });

    const baileys = await import("@whiskeysockets/baileys");
    const makeWASocket = baileys.default?.default || baileys.default || baileys.makeWASocket;
    const useMultiFileAuthState = baileys.useMultiFileAuthState;
    const DisconnectReason = baileys.DisconnectReason;
    const fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion;

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    let version = [2, 3000, 1015901307];
    if (typeof fetchLatestBaileysVersion === "function") {
      try {
        const vInfo = await fetchLatestBaileysVersion();
        if (vInfo?.version) version = vInfo.version;
      } catch {
        // Usar versión por defecto si falla la consulta
      }
    }

    // Logger silencioso compatible con pino
    const silentLogger = {
      level: "silent",
      trace: () => {},
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      fatal: () => {},
      child: () => silentLogger,
    };

    sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: true,
      logger: silentLogger,
      browser: ["Sistema Hipico", "Chrome", "120.0.0"],
      syncFullHistory: false,
      markOnlineOnConnect: true,
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        conectado = false;
        qrDataUrl = await convertirQrADataUrl(qr);
        console.log("[Bot WhatsApp] Nuevo código QR generado y listo en GET /status");
      }

      if (connection === "open") {
        conectado = true;
        qrDataUrl = null;
        numeroVinculado = normalizarTelefono(sock?.user?.id) || sock?.user?.id || "Conectado";
        console.log(`[Bot WhatsApp] 🟢 Conectado exitosamente como +${numeroVinculado}`);
        await refrescarGruposParticipantes();
      }

      if (connection === "close") {
        conectado = false;
        const statusCode =
          lastDisconnect?.error?.output?.statusCode ||
          lastDisconnect?.error?.statusCode ||
          0;
        const fueLogout = statusCode === (DisconnectReason?.loggedOut ?? 401);

        console.warn(`[Bot WhatsApp] Conexión cerrada (código ${statusCode}). Logout: ${fueLogout}`);

        if (fueLogout) {
          numeroVinculado = null;
          qrDataUrl = null;
          try {
            fs.rmSync(AUTH_DIR, { recursive: true, force: true });
          } catch {
            // Ignorar
          }
        }

        setTimeout(() => {
          reconectando = false;
          iniciarConexionBaileys();
        }, 3500);
      }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify" && type !== "append") return;
      for (const msg of messages || []) {
        await manejarMensajeEntrante(msg);
      }
    });
  } catch (err) {
    console.error(
      "[Bot WhatsApp] Aviso al inicializar @whiskeysockets/baileys:",
      err?.message || err
    );
    setTimeout(() => {
      reconectando = false;
      iniciarConexionBaileys();
    }, 10000);
  } finally {
    reconectando = false;
  }
}

// ============================================================================
// SERVIDOR HTTP LOCAL (http://127.0.0.1:3005)
// ============================================================================

function leerBodyJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 2 * 1024 * 1024) {
        reject(new Error("Payload demasiado grande"));
      }
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function responderJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    return responderJson(res, 200, { ok: true });
  }

  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
  const pathname = url.pathname;

  try {
    // 1. GET /status
    if (req.method === "GET" && pathname === "/status") {
      if (conectado && gruposCache.length === 0) {
        await refrescarGruposParticipantes();
      }
      return responderJson(res, 200, {
        conectado,
        qrDataUrl,
        numeroVinculado,
        grupos: gruposCache,
      });
    }

    // 2. POST /vincular-sala
    if (req.method === "POST" && pathname === "/vincular-sala") {
      const body = await leerBodyJson(req);
      const { salaId, groupJid, groupNombre } = body;

      if (!salaId) {
        return responderJson(res, 400, { ok: false, error: "salaId es requerido" });
      }
      if (!supabase) {
        return responderJson(res, 500, { ok: false, error: "Supabase no configurado" });
      }

      const updates = {
        whatsapp_group_jid: groupJid || null,
        updated_at: new Date().toISOString(),
      };

      const { data: salaActualizada, error } = await supabase
        .from("salas_juego")
        .update(updates)
        .eq("id", salaId)
        .select()
        .maybeSingle();

      if (error) {
        return responderJson(res, 500, { ok: false, error: error.message });
      }

      return responderJson(res, 200, {
        ok: true,
        salaId,
        groupJid: groupJid || null,
        groupNombre: groupNombre || null,
        sala: salaActualizada,
      });
    }

    // 3. POST /publicar-grupo
    if (req.method === "POST" && pathname === "/publicar-grupo") {
      const body = await leerBodyJson(req);
      const { groupJid, texto, quotedMsgId } = body;

      if (!groupJid || !texto) {
        return responderJson(res, 400, {
          ok: false,
          error: "groupJid y texto son requeridos",
        });
      }

      await enviarMensajeGrupo(groupJid, texto, quotedMsgId || null);
      return responderJson(res, 200, { ok: true, groupJid });
    }

    // 4. POST /enviar-privado
    if (req.method === "POST" && pathname === "/enviar-privado") {
      const body = await leerBodyJson(req);
      const { telefonoOjid, texto } = body;

      if (!telefonoOjid || !texto) {
        return responderJson(res, 400, {
          ok: false,
          error: "telefonoOjid y texto son requeridos",
        });
      }

      await enviarMensajePrivado(telefonoOjid, texto);
      return responderJson(res, 200, { ok: true, telefonoOjid });
    }

    // 5. POST /publicar-plano (Disparo directo desde panel /whatsapp)
    if (req.method === "POST" && pathname === "/publicar-plano") {
      const body = await leerBodyJson(req);
      const { salaId, groupJid } = body;
      if (!supabase || !salaId) {
        return responderJson(res, 400, { ok: false, error: "salaId es requerido" });
      }
      const { data: sala } = await supabase
        .from("salas_juego")
        .select("*")
        .eq("id", salaId)
        .maybeSingle();
      if (!sala) {
        return responderJson(res, 404, { ok: false, error: "Sala no encontrada" });
      }
      const jidDestino = groupJid || sala.whatsapp_group_jid;
      const resultado = await construirYPublicarPlano(sala, jidDestino);
      return responderJson(res, 200, resultado);
    }

    // 6. POST /publicar-sentencia (Disparo directo desde panel /whatsapp)
    if (req.method === "POST" && pathname === "/publicar-sentencia") {
      const body = await leerBodyJson(req);
      const { salaId, groupJid, pizarra } = body;
      if (!supabase || !salaId || !pizarra) {
        return responderJson(res, 400, {
          ok: false,
          error: "salaId y pizarra son requeridos",
        });
      }
      const { data: sala } = await supabase
        .from("salas_juego")
        .select("*")
        .eq("id", salaId)
        .maybeSingle();
      if (!sala) {
        return responderJson(res, 404, { ok: false, error: "Sala no encontrada" });
      }
      const jidDestino = groupJid || sala.whatsapp_group_jid;
      const resultado = await ejecutarSentenciaPizarra(sala, jidDestino, pizarra);
      return responderJson(res, 200, resultado);
    }

    return responderJson(res, 404, { ok: false, error: "Ruta no encontrada" });
  } catch (err) {
    return responderJson(res, 500, {
      ok: false,
      error: err?.message || "Error interno en bot-whatsapp-server",
    });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(
    `[Bot WhatsApp] 🚀 Demonio HTTP escuchando en http://127.0.0.1:${PORT} (Sesión: ${AUTH_DIR})`
  );
  iniciarConexionBaileys();
});
