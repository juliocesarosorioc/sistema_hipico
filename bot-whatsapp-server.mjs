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
const INTERNAL_BOT_SECRET = process.env.INTERNAL_BOT_SECRET || "SH-BOT-SECRET-2026";
const AUTH_DIR =
  process.env.WHATSAPP_AUTH_DIR ||
  (process.platform === "linux"
    ? "/root/sistema_hipico/whatsapp_auth"
    : path.join(__dirname, "whatsapp_auth"));

// Respaldo de los grupos desconectados: permite volver a conectar una sala sin
// obligar al operador a recordar el JID. Vive junto a la sesión de Baileys para
// sobrevivir a reinicios del demonio y a recargas/cambios de navegador.
const ARCHIVO_SALAS_DESCONECTADAS = path.join(AUTH_DIR, "salas_desconectadas.json");
let salasDesconectadas = {};

function cargarSalasDesconectadas() {
  try {
    if (!fs.existsSync(ARCHIVO_SALAS_DESCONECTADAS)) return {};
    const crudo = fs.readFileSync(ARCHIVO_SALAS_DESCONECTADAS, "utf8");
    const parseado = JSON.parse(crudo);
    return parseado && typeof parseado === "object" && !Array.isArray(parseado)
      ? parseado
      : {};
  } catch {
    return {};
  }
}

function persistirSalasDesconectadas() {
  try {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    fs.writeFileSync(
      ARCHIVO_SALAS_DESCONECTADAS,
      JSON.stringify(salasDesconectadas, null, 2),
      "utf8"
    );
  } catch (err) {
    console.warn(
      "[Bot WhatsApp] No se pudo persistir el respaldo de salas desconectadas:",
      err?.message || err
    );
  }
}

salasDesconectadas = cargarSalasDesconectadas();

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

// Caché en memoria para verificar operadores autorizados sin sobrecargar Supabase
const cacheOperadores = new Map();

// Rate Limiter Anti-Spam (escudo térmico)
const messageTimestamps = new Map();
const mutedJids = new Set();
const RATE_LIMIT_WINDOW_MS = 10000; // 10 segundos
const MAX_MESSAGES_PER_WINDOW = 5;

async function verificarEsOperadorAutorizado(sala, remoteJid, participantJid, telNormalizado) {
  const cacheKey = `${remoteJid}_${participantJid}`;
  const enCache = cacheOperadores.get(cacheKey);
  if (enCache && Date.now() < enCache.exp) {
    return enCache.esOp;
  }

  let esAutorizado = false;

  // 1. Chequeo de Admin / Superadmin del grupo en Baileys
  if (sock && remoteJid) {
    try {
      const meta = await sock.groupMetadata(remoteJid);
      const participant = (meta?.participants || []).find(
        (p) => p.id === participantJid || normalizarTelefono(p.id) === telNormalizado
      );
      if (participant?.admin === "admin" || participant?.admin === "superadmin") {
        esAutorizado = true;
      }
    } catch (errMeta) {
      console.warn("[Bot WhatsApp] Error consultando groupMetadata:", errMeta?.message);
    }
  }

  // 2. Chequeo vía RPC Supabase public.es_operador_autorizado_whatsapp
  if (!esAutorizado && supabase && sala?.id && telNormalizado) {
    try {
      const { data: esOpRpc, error: errRpc } = await supabase.rpc(
        "es_operador_autorizado_whatsapp",
        {
          p_sala_id: sala.id,
          p_telefono: telNormalizado,
        }
      );
      if (!errRpc && esOpRpc === true) {
        esAutorizado = true;
      }
    } catch {
      // Si la función RPC no existe en la BD o falla la firma
    }
  }

  // 3. Chequeo directo en usuario_sistema (si es_principal o es operador del grupo de la sala)
  if (!esAutorizado && supabase && telNormalizado) {
    try {
      const { data: usuario } = await supabase
        .from("usuario_sistema")
        .select("id, nombre, activo, es_principal, grupo_id")
        .ilike("telefono", `%${telNormalizado.slice(-8)}%`)
        .limit(1)
        .maybeSingle();

      if (usuario && usuario.activo !== false) {
        if (usuario.es_principal) {
          esAutorizado = true;
        } else if (sala.grupo_id && usuario.grupo_id === sala.grupo_id) {
          esAutorizado = true;
        }
      }
    } catch {
      // Ignorar fallback
    }
  }

  cacheOperadores.set(cacheKey, { esOp: esAutorizado, exp: Date.now() + 1000 * 60 * 2 }); // 2 min
  return esAutorizado;
}

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

// Cierre VULN-15: Set en memoria de los últimos 500 msg.key.id para descartar reintentos en < 1ms
const ultimosMensajesProcesados = new Set();
function esMensajeDuplicado(msgId) {
  if (!msgId) return false;
  if (ultimosMensajesProcesados.has(msgId)) {
    return true;
  }
  ultimosMensajesProcesados.add(msgId);
  if (ultimosMensajesProcesados.size > 500) {
    const primerId = ultimosMensajesProcesados.values().next().value;
    if (primerId) ultimosMensajesProcesados.delete(primerId);
  }
  return false;
}

// OPTIMIZACIÓN DE VELOCIDAD: Caché en memoria de Salas vinculadas (TTL 60s)
const salasCacheMap = new Map();
async function obtenerSalasPorGroupJid(remoteJid) {
  const cached = salasCacheMap.get(remoteJid);
  if (cached && Date.now() < cached.exp) {
    return cached.salas;
  }
  if (!supabase) return [];

  const resultados = [];
  const idsVistos = new Set();

  // 1. Buscar en tabla multi-grupo salas_whatsapp_grupos WHERE activo = true
  try {
    const { data: vinculos, error: errVinc } = await supabase
      .from("salas_whatsapp_grupos")
      .select("sala_id, whatsapp_group_jid, whatsapp_group_nombre, salas_juego(*)")
      .eq("whatsapp_group_jid", remoteJid)
      .eq("activo", true);

    if (!errVinc && Array.isArray(vinculos)) {
      for (const v of vinculos) {
        const s = v.salas_juego;
        if (s && s.id && !idsVistos.has(s.id)) {
          idsVistos.add(s.id);
          resultados.push({
            ...s,
            _whatsapp_group_jid: v.whatsapp_group_jid || remoteJid,
            _whatsapp_group_nombre: v.whatsapp_group_nombre || s.whatsapp_group_nombre || null,
          });
        }
      }
    }
  } catch {
    // Fallback abajo si la tabla aún no existe
  }

  // 2. Respaldo compatible con salas_juego.whatsapp_group_jid
  if (resultados.length === 0) {
    const { data: sala, error: errSala } = await supabase
      .from("salas_juego")
      .select("*")
      .eq("whatsapp_group_jid", remoteJid)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (errSala) {
      console.error("[Bot WhatsApp] Error consultando sala:", errSala.message);
      return [];
    }
    if (sala) {
      resultados.push({
        ...sala,
        _whatsapp_group_jid: remoteJid,
        _whatsapp_group_nombre: sala.whatsapp_group_nombre || null,
      });
    }
  }

  salasCacheMap.set(remoteJid, { salas: resultados, exp: Date.now() + 60000 });
  return resultados;
}

async function obtenerSalaPorGroupJid(remoteJid) {
  const lista = await obtenerSalasPorGroupJid(remoteJid);
  return lista[0] || null;
}

// OPTIMIZACIÓN DE VELOCIDAD: Caché en memoria de Clientes identificados (TTL 120s)
const clientesCacheMap = new Map();

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

async function buscarClienteEnGrupo(grupoId, pJid, pAlt, telR) {
  if (!supabase || !grupoId) return null;
  const cacheKey = `${grupoId}:${pJid || pAlt || telR}`;
  const cached = clientesCacheMap.get(cacheKey);
  if (cached && Date.now() < cached.exp) return cached.cliente;

  const condicionesOr = [];
  if (pJid) condicionesOr.push(`whatsapp_jid.eq.${pJid}`);
  if (pAlt && pAlt !== pJid) condicionesOr.push(`whatsapp_jid.eq.${pAlt}`);
  if (telR && telR.length >= 7) condicionesOr.push(`telefono_normalizado.eq.${telR}`);

  if (condicionesOr.length > 0) {
    const { data: clExacto } = await supabase
      .from("clientes")
      .select(
        "id, grupo_id, nombre, seudonimo, saldo_actual, saldo_retenido, saldo_disponible, libre, aval, whatsapp_jid, telefono, telefono_normalizado"
      )
      .eq("grupo_id", grupoId)
      .or(condicionesOr.join(","))
      .order("saldo_actual", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (clExacto) {
      clientesCacheMap.set(cacheKey, { cliente: clExacto, exp: Date.now() + 120000 });
      return clExacto;
    }
  }

  if (telR && telR.length >= 7) {
    const sufijo8 = telR.slice(-8);
    const { data: clParcial } = await supabase
      .from("clientes")
      .select(
        "id, grupo_id, nombre, seudonimo, saldo_actual, saldo_retenido, saldo_disponible, libre, aval, whatsapp_jid, telefono, telefono_normalizado"
      )
      .eq("grupo_id", grupoId)
      .ilike("telefono", `%${sufijo8}%`)
      .order("saldo_actual", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (clParcial) {
      clientesCacheMap.set(cacheKey, { cliente: clParcial, exp: Date.now() + 120000 });
      return clParcial;
    }
  }

  return null;
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

const mensajesEnviadosPorBot = new Set();
function registrarMensajeEnviadoPorBot(res) {
  const id = res?.key?.id;
  if (!id) return;
  mensajesEnviadosPorBot.add(id);
  if (mensajesEnviadosPorBot.size > 1000) {
    const first = mensajesEnviadosPorBot.values().next().value;
    if (first) mensajesEnviadosPorBot.delete(first);
  }
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

  const res = await sock.sendMessage(groupJid, { text: texto }, opciones);
  registrarMensajeEnviadoPorBot(res);
  return res;
}

async function enviarMensajePrivado(telefonoOjid, texto) {
  if (!sock || !conectado) {
    throw new Error("El Bot de WhatsApp no está conectado actualmente.");
  }
  const jid = aJidPrivado(telefonoOjid);
  if (!jid || !texto) return null;
  const res = await sock.sendMessage(jid, { text: texto });
  registrarMensajeEnviadoPorBot(res);
  return res;
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
      await supabase
        .from("salas_juego")
        .update({ updated_at: new Date().toISOString() })
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

  let qJugadas = supabase
    .from("chat_tickets_fifo")
    .select("*")
    .eq("sala_id", sala.id)
    .in("estado", ["PENDIENTE", "ACTIVO", "ABIERTO", "GANADOR_PROPONENTE", "GANADOR_ACEPTANTE", "EMPATE"])
    .order("created_at", { ascending: true });
  if (carreraId) {
    qJugadas = qJugadas.or(`carrera_id.eq.${carreraId},carrera_id.is.null`);
  }
  const { data: jugadasCarrera } = await qJugadas;
  const listaJugadas = jugadasCarrera || [];
  const bloqueJugadas =
    listaJugadas.length > 0
      ? listaJugadas
          .map((t, idx) => {
            const detalle = t.es_match
              ? `Match ${(t.caballos_bando_a || []).join("-")} x ${(t.caballos_bando_b || []).join("-")}`
              : `${t.modalidad || "1P"} #${t.ejemplar_numero || (t.caballos_bando_a || []).join("-")}`;
            const montoStr = `$${formatearMonto(t.monto_concretado || 0)}`;
            const estadoEmoji =
              t.estado === "GANADOR_PROPONENTE"
                ? `✅ Gana ${t.proponente_nombre}`
                : t.estado === "GANADOR_ACEPTANTE"
                ? `✅ Gana ${t.aceptante_nombre}`
                : t.estado === "EMPATE"
                ? "🤝 Empate"
                : "";
            return `${idx + 1}) *${t.proponente_nombre}* vs *${t.aceptante_nombre}* · ${detalle} · *${montoStr}*${estadoEmoji ? ` (${estadoEmoji})` : ""}`;
          })
          .join("\n")
      : "_Sin jugadas concretadas en esta carrera._";

  const pizarraFormateada = numeros.map((n, i) => `${i + 1}º: #${n}`).join(" · ");
  const textoResultado =
    `🏁 *LLEGADA OFICIAL — ${hipodromo} C${numCarrera}*\n` +
    `📊 *Pizarra:* ${pizarraFormateada}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📋 *TODAS LAS JUGADAS (${listaJugadas.length}):*\n` +
    `${bloqueJugadas}\n` +
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
    if (!msg?.key) return;

    const whatsappMsgId = msg.key.id || null;
    const esFromMe = Boolean(msg.key.fromMe);

    // Si el mensaje fue enviado automáticamente por este mismo servidor/bot, ignorarlo para evitar bucles.
    // Si NO está en mensajesEnviadosPorBot, fue escrito por el usuario manualmente desde su teléfono/WhatsApp Web.
    if (esFromMe && whatsappMsgId && mensajesEnviadosPorBot.has(whatsappMsgId)) {
      return;
    }

    // Cierre VULN-15: Descartar mensajes duplicados / reintentos en < 1ms
    if (whatsappMsgId && esMensajeDuplicado(whatsappMsgId)) {
      console.log(`[Bot WhatsApp] ⏩ [Idempotencia] Reintento descartado: ${whatsappMsgId}`);
      return;
    }

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

    // Cierre VULN-14: Soporte para JIDs @lid, participantAlt y cuenta propia del teléfono
    const participantJid =
      msg.key.participant ||
      msg.participant ||
      (esFromMe ? (sock?.user?.id ? `${normalizarTelefono(sock.user.id)}@s.whatsapp.net` : "") : "");
    const participantAlt = msg.key.participantAlt || msg.participantAlt || "";
    const senderNombre = msg.pushName || (esFromMe ? "Operador (Teléfono)" : "Jugador");

    const senderJid = participantJid || participantAlt || "";

    // Rate Limiter Anti-Spam: silenciar usuarios que exceden el límite de mensajes
    if (senderJid && mutedJids.has(senderJid)) {
      return;
    }
    if (senderJid) {
      const now = Date.now();
      const userTimes = messageTimestamps.get(senderJid) || [];
      const recentTimes = userTimes.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
      if (recentTimes.length >= MAX_MESSAGES_PER_WINDOW) {
        mutedJids.add(senderJid);
        try {
          await sock.sendMessage(remoteJid, {
            text: "⚠️ [SISTEMA] Usuario silenciado por Spam/Flooding.",
          });
        } catch {
          /* no bloqueante */
        }
        setTimeout(() => {
          mutedJids.delete(senderJid);
          messageTimestamps.delete(senderJid);
        }, 120000);
        return;
      }
      recentTimes.push(now);
      messageTimestamps.set(senderJid, recentTimes);
    }

    const telPrincipal = normalizarTelefono(participantJid);
    const telAlt = normalizarTelefono(participantAlt);

    // En WhatsApp Multi-Device / Baileys, participantJid suele ser un LID (@lid) y participantAlt contiene el número real (@s.whatsapp.net).
    let telReal = "";
    if (participantAlt && participantAlt.endsWith("@s.whatsapp.net")) {
      telReal = telAlt;
    } else if (participantJid && participantJid.endsWith("@s.whatsapp.net")) {
      telReal = telPrincipal;
    } else if (telAlt && telAlt.length >= 7 && telAlt.length <= 15) {
      telReal = telAlt;
    } else if (!participantJid.endsWith("@lid") && telPrincipal && telPrincipal.length >= 7) {
      telReal = telPrincipal;
    }
    const telNormalizado = telReal || telAlt || telPrincipal;

    console.log(`[Bot WhatsApp] 📩 [${remoteJid}] (${senderNombre}${esFromMe ? " [PROPIO]" : ""} / ${participantJid}${participantAlt ? ` / alt:${participantAlt}` : ""}): "${textoLimpio}"`);

    // Obtener todas las Salas vinculadas a este groupJid usando caché ultra-rápido (0ms)
    const salasDestino = await obtenerSalasPorGroupJid(remoteJid);
    const sala = salasDestino[0] || null;
    if (!sala) {
      return;
    }

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
      const esOp = esFromMe || (await verificarEsOperadorAutorizado(sala, remoteJid, participantJid, telNormalizado));
      if (!esOp) {
        console.warn(`[Bot WhatsApp] ⛔ Comando sentenciar rechazado: ${participantJid} no es operador.`);
        await enviarMensajePrivado(participantJid, "⚠️ No está autorizado para sentenciar o publicar resultados oficiales.");
        return;
      }
      console.log(`[Bot WhatsApp] 🏁 Ejecutando sentencia de pizarra: ${matchLlegada[1]}`);
      await ejecutarSentenciaPizarra(sala, remoteJid, matchLlegada[1]);
      return;
    }

    // Detección de Apertura: !abrir [hipodromo] [carrera] o "abrir [hipodromo] [carrera]"
    const matchAbrir = textoLimpio.match(/^(?:!)?(?:abrir|abierta|abrir\s+carrera)\s*(.+?)?(?:\s+(?:c(?:arrera)?\s*)?(\d{1,2}))?$/i);
    if (matchAbrir && (/^(?:!)?abrir/i.test(textoLimpio) || /^(?:!)?abierta/i.test(textoLimpio))) {
      const esOp = esFromMe || (await verificarEsOperadorAutorizado(sala, remoteJid, participantJid, telNormalizado));
      if (!esOp) {
        console.warn(`[Bot WhatsApp] ⛔ Comando abrir rechazado: ${participantJid} no es operador.`);
        await enviarMensajePrivado(participantJid, "⚠️ No está autorizado para abrir carreras en la sala.");
        return;
      }
      const posibleHipo = (matchAbrir[1] || "").trim() || sala.hipodromo_activo || "LA RINCONADA";
      const posibleCarrera = matchAbrir[2] || sala.numero_carrera_activa || "1";
      console.log(`[Bot WhatsApp] 🏆 Abriendo carrera: ${posibleHipo} #${posibleCarrera}`);
      await ejecutarAperturaCarrera(sala, remoteJid, posibleHipo, posibleCarrera);
      return;
    }

    // Detección de Cierre: !cerrar o "cerrada"
    if (/^(?:!)?(?:cerrar|cerrada|no va mas|no va más|carrera cerrada)$/i.test(textoLimpio)) {
      const esOp = esFromMe || (await verificarEsOperadorAutorizado(sala, remoteJid, participantJid, telNormalizado));
      if (!esOp) {
        console.warn(`[Bot WhatsApp] ⛔ Comando cerrar rechazado: ${participantJid} no es operador.`);
        await enviarMensajePrivado(participantJid, "⚠️ No está autorizado para cerrar carreras en la sala.");
        return;
      }
      console.log(`[Bot WhatsApp] 🔒 Cerrando carrera en sala "${sala.nombre_sala}"`);
      await ejecutarCierreCarrera(sala, remoteJid);
      return;
    }

    // Detección de Plano / Prejugadas: !plano o plano
    if (/^(?:!)?(?:plano|prejugadas)$/i.test(textoLimpio)) {
      console.log(`[Bot WhatsApp] 📋 Publicando plano de jugadas en "${sala.nombre_sala}"`);
      await construirYPublicarPlano(sala, remoteJid);
      return;
    }

    if (textoLimpio.startsWith("!")) {
      const partes = textoLimpio.slice(1).trim().split(/\s+/);
      const cmd = (partes[0] || "").toLowerCase();
      const resto = partes.slice(1).join(" ").trim();

      if (cmd === "anular" || cmd === "retirar") {
        const esOp = esFromMe || (await verificarEsOperadorAutorizado(sala, remoteJid, participantJid, telNormalizado));
        if (!esOp) {
          console.warn(`[Bot WhatsApp] ⛔ Comando ${cmd} rechazado: ${participantJid} no es operador.`);
          await enviarMensajePrivado(participantJid, `⚠️ No está autorizado para ejecutar el comando !${cmd}.`);
          return;
        }
        console.log(`[Bot WhatsApp] 🚫 Ejecutando ${cmd}: ${resto}`);
        await ejecutarAnulacionORetiro(sala, remoteJid, cmd, resto);
        return;
      }
    }

    // 2. Cruzar remitente estrictamente con public.clientes para cada grupo_id de las salas vinculadas
    const clientesPorSalaId = new Map();
    for (const salaDest of salasDestino) {
      if (salaDest?.grupo_id) {
        const cl = await buscarClienteEnGrupo(salaDest.grupo_id, participantJid, participantAlt, telReal);
        if (cl) {
          clientesPorSalaId.set(salaDest.id, cl);
          if (participantJid && cl.whatsapp_jid !== participantJid) {
            try {
              await supabase
                .from("clientes")
                .update({
                  whatsapp_jid: participantJid,
                  whatsapp_vinculado: true,
                  telefono_normalizado: telReal || cl.telefono_normalizado,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", cl.id);
              cl.whatsapp_jid = participantJid;
              if (telReal) cl.telefono_normalizado = telReal;
              console.log(`[Bot WhatsApp] 🔗 Auto-guardado whatsapp_jid (${participantJid}) en ficha de "${cl.nombre}" (${cl.id})`);
            } catch (errVinculo) {
              console.warn("[Bot WhatsApp] Aviso al auto-guardar whatsapp_jid:", errVinculo?.message);
            }
          }
        }
      }
    }

    // 3 y 4. Delegar a http://127.0.0.1:3000/api/whatsapp-sala/procesar para todas las salas vinculadas
    const nombreGrupoOrigen =
      sala._whatsapp_group_nombre ||
      gruposCacheLista.find((g) => g.jid === remoteJid)?.nombre ||
      null;

    const respuestasProcesar = await Promise.all(
      salasDestino.map(async (salaDest) => {
        const clienteEstaSala = clientesPorSalaId.get(salaDest.id) || null;
        const r = await fetch(`${NEXT_API_BASE}/api/whatsapp-sala/procesar`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-bot-secret": INTERNAL_BOT_SECRET,
          },
          body: JSON.stringify({
            salaId: salaDest.id,
            grupoId: salaDest.grupo_id,
            groupJid: remoteJid,
            groupNombre: salaDest._whatsapp_group_nombre || nombreGrupoOrigen,
            whatsappGroupNombre: salaDest._whatsapp_group_nombre || nombreGrupoOrigen,
            senderJid: participantJid,
            participantJid,
            participantAlt: participantAlt || null,
            telefonoReal: telReal || null,
            pushName: senderNombre,
            senderNombre: senderNombre || clienteEstaSala?.seudonimo || clienteEstaSala?.nombre || "Jugador",
            clientePreviamenteIdentificado: clienteEstaSala || null,
            esMensajePropioTelefono: esFromMe,
            texto: textoLimpio,
            whatsappMsgId,
            quotedMsgId: quotedMsgId || null,
          }),
        });
        return r.json().catch(() => null);
      })
    );

    // Priorizar respuesta exitosa si alguna sala vinculada aceptó la jugada
    const data = respuestasProcesar.find((r) => r && r.ok) || respuestasProcesar.find(Boolean) || null;
    if (!data) return;

    console.log(`[Bot WhatsApp] 🤖 Respuesta del procesador:`, JSON.stringify({ ok: data.ok, tipo: data.tipo, respuestaGrupo: data.respuestaGrupo, reaccionEmoji: data.reaccionEmoji }));

    // Despacho ultra-rápido concurrente en paralelo (de >1200ms a <80ms)
    const envios = [];
    if (data.reaccionEmoji && sock && msg.key) {
      envios.push(
        sock.sendMessage(remoteJid, {
          react: { text: data.reaccionEmoji, key: msg.key },
        }).then(registrarMensajeEnviadoPorBot).catch((errReact) => console.warn("[Bot WhatsApp] Aviso enviando reacción:", errReact?.message || errReact))
      );
    }

    // 1. Respuesta al Grupo WA (con reply/quoted al whatsappMsgId original)
    const respuestaGrupo =
      data.msg_publico ||
      data.msg_publico_bot ||
      data.respuestaPublica ||
      data.respuestaGrupo ||
      data.acciones?.responderEnGrupo ||
      data.data?.msg_publico ||
      data.data?.msg_publico_bot ||
      data.data?.respuestaPublica;

    if (respuestaGrupo) {
      envios.push(
        enviarMensajeGrupo(remoteJid, respuestaGrupo, whatsappMsgId)
          .catch((errG) => console.warn("[Bot WhatsApp] Aviso enviando respuesta de grupo:", errG?.message || errG))
      );
    }

    // 2. Respuesta al Privado WA: autor / aceptante
    const mensajePrivadoAutor =
      data.msg_privado_bot ||
      data.alertaPrivada ||
      data.msg_privado_aceptante ||
      data.mensajePrivadoAutor ||
      data.acciones?.enviarPrivadoJugador ||
      data.data?.msg_privado_bot ||
      data.data?.alertaPrivada ||
      data.data?.msg_privado_aceptante;

    const jidPrivadoAutor =
      participantJid ||
      data.senderJid ||
      (telNormalizado ? `${telNormalizado}@s.whatsapp.net` : null);

    if (mensajePrivadoAutor && jidPrivadoAutor) {
      envios.push(
        enviarMensajePrivado(jidPrivadoAutor, mensajePrivadoAutor)
          .catch((errPriv) => console.warn("[Bot WhatsApp] Aviso enviando privado autor:", errPriv?.message || errPriv))
      );
    }

    // 3. Respuesta al Privado WA: proponente
    const mensajePrivadoProponente =
      data.msg_privado_proponente ||
      data.mensajePrivadoProponente ||
      data.acciones?.enviarPrivadoProponente ||
      data.data?.msg_privado_proponente;

    const proponenteDestino =
      data.proponenteJid ||
      data.proponenteTelefono ||
      (data.proponenteTelefonoNormalizado ? `${data.proponenteTelefonoNormalizado}@s.whatsapp.net` : null);

    if (mensajePrivadoProponente && proponenteDestino) {
      envios.push(
        enviarMensajePrivado(proponenteDestino, mensajePrivadoProponente)
          .catch((errProp) => console.warn("[Bot WhatsApp] Aviso enviando privado proponente:", errProp?.message || errProp))
      );
    }

    // 4. Notificaciones privadas en lote (array notificaciones_privadas)
    const notifs =
      data.notificaciones_privadas ||
      data.notificacionesPrivadas ||
      data.data?.notificaciones_privadas ||
      [];

    if (Array.isArray(notifs) && notifs.length > 0) {
      for (const notif of notifs) {
        const txt = typeof notif === "string" ? notif : (notif?.mensaje || notif?.msg || notif?.texto || notif?.contenido);
        const jidN = typeof notif === "object" ? (notif?.whatsapp_jid || notif?.jid || (notif?.telefono ? `${normalizarTelefono(notif.telefono)}@s.whatsapp.net` : null)) : null;
        const destino = jidN || jidPrivadoAutor;
        if (txt && destino) {
          envios.push(
            enviarMensajePrivado(destino, txt)
              .catch((errN) => console.warn("[Bot WhatsApp] Aviso enviando notif privada:", errN?.message || errN))
          );
        }
      }
    }

    await Promise.allSettled(envios);
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
    // Cierre VULN-16: Permisos restringidos 700 para proteger las llaves de sesión
    fs.mkdirSync(AUTH_DIR, { recursive: true, mode: 0o700 });
    try {
      if (process.platform === "linux") {
        fs.chmodSync(AUTH_DIR, 0o700);
      }
    } catch (errPerm) {
      console.warn("[Bot WhatsApp] Aviso aplicando chmod 700:", errPerm?.message);
    }

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

  // Blindaje SecOps Parche 1: Secreto interno obligatorio para todas las acciones (excepto /status local)
  if (pathname !== "/status") {
    const authHeader = req.headers["x-internal-bot-secret"];
    if (authHeader !== INTERNAL_BOT_SECRET) {
      return responderJson(res, 401, {
        ok: false,
        error: "401 Unauthorized: Header x-internal-bot-secret inválido o ausente",
      });
    }
  }

  try {
    // 1. GET /status (Soporta ?force=true para refresco instantáneo de grupos)
    if (req.method === "GET" && pathname === "/status") {
      const forzarRefresco = url.searchParams.get("force") === "true";
      if (conectado && (gruposCache.length === 0 || forzarRefresco)) {
        await refrescarGruposParticipantes();
      }
      return responderJson(res, 200, {
        conectado,
        qrDataUrl,
        numeroVinculado,
        grupos: gruposCache,
        salasDesconectadas,
      });
    }

    // 1.b GET /ping-grupo (Medición de latencia y verificación de conexión con el grupo en vivo)
    if (req.method === "GET" && pathname === "/ping-grupo") {
      const groupJid = url.searchParams.get("groupJid");
      if (!groupJid) {
        return responderJson(res, 400, { ok: false, error: "groupJid es requerido" });
      }
      if (!sock || !conectado) {
        return responderJson(res, 200, {
          ok: false,
          conectado: false,
          latenciaMs: 0,
          error: "Bot desconectado de WhatsApp",
        });
      }
      const t0 = Date.now();
      try {
        const metadata = await sock.groupMetadata(groupJid);
        const latenciaMs = Date.now() - t0;
        return responderJson(res, 200, {
          ok: true,
          conectado: true,
          latenciaMs,
          groupJid,
          groupNombre: metadata?.subject || null,
          totalParticipantes: metadata?.participants?.length || 0,
        });
      } catch (errPing) {
        return responderJson(res, 200, {
          ok: false,
          conectado: false,
          latenciaMs: Date.now() - t0,
          error: errPing?.message || "No se pudo consultar el grupo en WhatsApp",
        });
      }
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

      salasCacheMap.clear();

      const updates = {
        whatsapp_group_jid: groupJid || null,
        whatsapp_group_nombre: groupNombre || null,
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

      if (groupJid) {
        await supabase
          .from("salas_whatsapp_grupos")
          .upsert(
            {
              sala_id: salaId,
              grupo_id: salaActualizada?.grupo_id || null,
              whatsapp_group_jid: groupJid,
              whatsapp_group_nombre: groupNombre || null,
              activo: true,
              estado_conexion: "conectado",
              motivo_estado: "Vinculado",
              updated_at: new Date().toISOString(),
            },
            { onConflict: "sala_id,whatsapp_group_jid" }
          );
      }

      // Al vincular manualmente, cualquier respaldo de desconexión previo deja
      // de tener sentido: la sala ya tiene un grupo activo.
      if (salasDesconectadas[salaId]) {
        delete salasDesconectadas[salaId];
        persistirSalasDesconectadas();
      }

      return responderJson(res, 200, {
        ok: true,
        salaId,
        groupJid: groupJid || null,
        groupNombre: groupNombre || null,
        sala: salaActualizada,
      });
    }

    // 2.b POST /desconectar-sala
    // Pausa la sala: guarda el JID/nombre en el respaldo persistente y deja la
    // sala sin grupo de WhatsApp activo (whatsapp_group_jid = null).
    if (req.method === "POST" && pathname === "/desconectar-sala") {
      const body = await leerBodyJson(req);
      const { salaId } = body;

      if (!salaId) {
        return responderJson(res, 400, { ok: false, error: "salaId es requerido" });
      }
      if (!supabase) {
        return responderJson(res, 500, { ok: false, error: "Supabase no configurado" });
      }

      salasCacheMap.clear();

      const { data: sala, error: errorLectura } = await supabase
        .from("salas_juego")
        .select("id, whatsapp_group_jid, whatsapp_group_nombre, nombre_sala")
        .eq("id", salaId)
        .maybeSingle();

      if (errorLectura) {
        return responderJson(res, 500, { ok: false, error: errorLectura.message });
      }
      if (!sala) {
        return responderJson(res, 404, { ok: false, error: "Sala no encontrada" });
      }

      const groupJid = sala.whatsapp_group_jid || salasDesconectadas[salaId]?.groupJid || null;
      const groupNombre =
        sala.whatsapp_group_nombre || salasDesconectadas[salaId]?.groupNombre || null;

      if (groupJid) {
        salasDesconectadas[salaId] = {
          groupJid,
          groupNombre,
          desconectadoEn: new Date().toISOString(),
        };
        persistirSalasDesconectadas();
      }

      const { error } = await supabase
        .from("salas_juego")
        .update({
          whatsapp_group_jid: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", salaId);

      if (error) {
        return responderJson(res, 500, { ok: false, error: error.message });
      }

      await supabase
        .from("salas_whatsapp_grupos")
        .update({
          activo: false,
          estado_conexion: "pausado",
          motivo_estado: "Desconectado temporalmente",
          updated_at: new Date().toISOString(),
        })
        .eq("sala_id", salaId);

      return responderJson(res, 200, {
        ok: true,
        salaId,
        desconectado: true,
        puedeReconectar: Boolean(groupJid),
        groupJid,
        groupNombre,
        respaldo: salasDesconectadas[salaId] || null,
      });
    }

    // 2.c POST /reconectar-sala
    // Reactiva la sala con el grupo guardado (o con el JID/nombre que envíe la UI).
    if (req.method === "POST" && pathname === "/reconectar-sala") {
      const body = await leerBodyJson(req);
      const { salaId, groupJid, groupNombre } = body;

      if (!salaId) {
        return responderJson(res, 400, { ok: false, error: "salaId es requerido" });
      }
      if (!supabase) {
        return responderJson(res, 500, { ok: false, error: "Supabase no configurado" });
      }

      salasCacheMap.clear();

      const { data: sala, error: errorLectura } = await supabase
        .from("salas_juego")
        .select("id, whatsapp_group_jid, whatsapp_group_nombre")
        .eq("id", salaId)
        .maybeSingle();

      if (errorLectura) {
        return responderJson(res, 500, { ok: false, error: errorLectura.message });
      }
      if (!sala) {
        return responderJson(res, 404, { ok: false, error: "Sala no encontrada" });
      }

      const respaldo = salasDesconectadas[salaId] || {};
      const jidFinal = groupJid || sala.whatsapp_group_jid || respaldo.groupJid || null;
      const nombreFinal = groupNombre || sala.whatsapp_group_nombre || respaldo.groupNombre || null;

      if (!jidFinal) {
        return responderJson(res, 400, {
          ok: false,
          error: "No hay un grupo de WhatsApp guardado para esta sala. Vincúlala de nuevo.",
        });
      }

      const { data: salaActualizada, error } = await supabase
        .from("salas_juego")
        .update({
          whatsapp_group_jid: jidFinal,
          whatsapp_group_nombre: nombreFinal,
          updated_at: new Date().toISOString(),
        })
        .eq("id", salaId)
        .select()
        .maybeSingle();

      if (error) {
        return responderJson(res, 500, { ok: false, error: error.message });
      }

      if (groupJid) {
        await supabase
          .from("salas_whatsapp_grupos")
          .upsert(
            {
              sala_id: salaId,
              grupo_id: salaActualizada?.grupo_id || null,
              whatsapp_group_jid: groupJid,
              whatsapp_group_nombre: groupNombre || null,
              activo: true,
              estado_conexion: "conectado",
              motivo_estado: "Vinculado",
              updated_at: new Date().toISOString(),
            },
            { onConflict: "sala_id,whatsapp_group_jid" }
          );
      }

      if (salasDesconectadas[salaId]) {
        delete salasDesconectadas[salaId];
        persistirSalasDesconectadas();
      }

      return responderJson(res, 200, {
        ok: true,
        salaId,
        reconectado: true,
        groupJid: jidFinal,
        groupNombre: nombreFinal,
        sala: salaActualizada,
      });
    }

    // 2.5 POST /verificar-y-vincular
    if (req.method === "POST" && pathname === "/verificar-y-vincular") {
      const body = await leerBodyJson(req);
      const { grupoId, salaId, groupJid } = body;

      if (!salaId || !groupJid) {
        return responderJson(res, 400, {
          ok: false,
          motivo: "salaId y groupJid son requeridos",
        });
      }
      if (!sock?.user) {
        return responderJson(res, 200, {
          ok: false,
          motivo: "Motor Baileys desconectado (Escanee el QR en /whatsapp)",
        });
      }

      let metadata;
      try {
        metadata = await sock.groupMetadata(groupJid);
      } catch {
        return responderJson(res, 200, {
          ok: false,
          motivo: "El Bot no pertenece a este grupo de WhatsApp o el JID es inválido",
        });
      }

      const botTel = normalizarTelefono(sock.user.id);
      const botLid = sock.user.lid ? normalizarTelefono(sock.user.lid) : "";
      const participantes = Array.isArray(metadata?.participants) ? metadata.participants : [];
      const botParticipante = participantes.find((p) => {
        const pTel = normalizarTelefono(p.phoneNumber || p.jid || p.id);
        const pId = normalizarTelefono(p.id);
        return (botTel && (pTel === botTel || pId === botTel)) || (botLid && (pId === botLid || pTel === botLid));
      });

      if (!botParticipante) {
        return responderJson(res, 200, {
          ok: false,
          motivo: "El Bot no pertenece a este grupo de WhatsApp o el JID es inválido",
        });
      }

      const botEsAdmin =
        botParticipante.admin === "admin" || botParticipante.admin === "superadmin";
      if (metadata?.announce === true && !botEsAdmin) {
        return responderJson(res, 200, {
          ok: false,
          motivo: "El grupo está cerrado a solo Administradores y el Bot no es Admin",
        });
      }

      const nombreGrupo = metadata?.subject || groupJid;
      let grupoIdFinal = grupoId || null;

      if (supabase) {
        if (!grupoIdFinal) {
          const { data: salaRow } = await supabase
            .from("salas_juego")
            .select("grupo_id")
            .eq("id", salaId)
            .maybeSingle();
          if (salaRow?.grupo_id) grupoIdFinal = salaRow.grupo_id;
        }

        const { error: errUpsert } = await supabase
          .from("salas_whatsapp_grupos")
          .upsert(
            {
              grupo_id: grupoIdFinal,
              sala_id: salaId,
              whatsapp_group_jid: groupJid,
              whatsapp_group_nombre: metadata.subject,
              estado_conexion: "conectado",
              motivo_estado: "Vinculado y verificado con Baileys 24/7",
              activo: true,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "sala_id,whatsapp_group_jid" }
          );

        if (errUpsert) {
          return responderJson(res, 500, {
            ok: false,
            motivo: errUpsert.message || "Error guardando vinculación en Supabase",
          });
        }

        // Mantener también sincronizado salas_juego.whatsapp_group_jid para que permanezca conectado
        try {
          await supabase
            .from("salas_juego")
            .update({
              whatsapp_group_jid: groupJid,
              whatsapp_group_nombre: metadata.subject,
              updated_at: new Date().toISOString(),
            })
            .eq("id", salaId);
        } catch {
          // No bloqueante
        }
      }

      salasCacheMap.clear();
      if (salasDesconectadas[salaId]) {
        delete salasDesconectadas[salaId];
        persistirSalasDesconectadas();
      }

      await enviarMensajeGrupo(
        groupJid,
        "🟢 *SALA VINCULADA* — Conectado en vivo con Sala de Juegos"
      );

      return responderJson(res, 200, {
        ok: true,
        nombreGrupo: metadata.subject,
        motivo: "Conectado correctamente al Motor Baileys 24/7",
      });
    }

    // 2.6 POST /desvincular-grupo
    if (req.method === "POST" && pathname === "/desvincular-grupo") {
      const body = await leerBodyJson(req);
      const { salaId, groupJid } = body;

      if (!supabase) {
        return responderJson(res, 500, { ok: false, motivo: "Supabase no configurado" });
      }
      if (!salaId || !groupJid) {
        return responderJson(res, 400, {
          ok: false,
          motivo: "salaId y groupJid son requeridos",
        });
      }

      const { error: errDel } = await supabase
        .from("salas_whatsapp_grupos")
        .delete()
        .eq("sala_id", salaId)
        .eq("whatsapp_group_jid", groupJid);

      if (errDel) {
        return responderJson(res, 500, { ok: false, motivo: errDel.message });
      }

      try {
        const { data: otros } = await supabase
          .from("salas_whatsapp_grupos")
          .select("whatsapp_group_jid, whatsapp_group_nombre")
          .eq("sala_id", salaId)
          .eq("activo", true)
          .order("updated_at", { ascending: false });

        const siguiente = (otros || [])[0] || null;
        await supabase
          .from("salas_juego")
          .update({
            whatsapp_group_jid: siguiente ? siguiente.whatsapp_group_jid : null,
            whatsapp_group_nombre: siguiente ? siguiente.whatsapp_group_nombre : null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", salaId);
      } catch {
        // No bloqueante
      }

      salasCacheMap.clear();
      return responderJson(res, 200, { ok: true });
    }

    // 3. POST /publicar-grupo
    if (req.method === "POST" && pathname === "/publicar-grupo") {
      const body = await leerBodyJson(req);
      const { groupJid, salaId, texto, quotedMsgId } = body;

      if (!texto || (!groupJid && !salaId)) {
        return responderJson(res, 400, {
          ok: false,
          error: "texto y (groupJid o salaId) son requeridos",
        });
      }

      const destinos = new Set();
      if (groupJid) destinos.add(groupJid);

      if (salaId && supabase) {
        try {
          const { data: vinculos } = await supabase
            .from("salas_whatsapp_grupos")
            .select("whatsapp_group_jid")
            .eq("sala_id", salaId)
            .eq("activo", true);
          for (const v of vinculos || []) {
            if (v.whatsapp_group_jid) destinos.add(v.whatsapp_group_jid);
          }
        } catch {
          // Si falla tabla multi-grupo, usar fallback abajo
        }
        try {
          const { data: salaRow } = await supabase
            .from("salas_juego")
            .select("whatsapp_group_jid")
            .eq("id", salaId)
            .maybeSingle();
          if (salaRow?.whatsapp_group_jid) destinos.add(salaRow.whatsapp_group_jid);
        } catch {
          // No bloqueante
        }
      }

      for (const jidDest of destinos) {
        await enviarMensajeGrupo(jidDest, texto, quotedMsgId || null);
      }
      return responderJson(res, 200, { ok: true, groupJid: groupJid || null, destinos: [...destinos] });
    }

    // 4. POST /enviar-privado y alias /enviar
    if (req.method === "POST" && (pathname === "/enviar-privado" || pathname === "/enviar")) {
      const body = await leerBodyJson(req);
      const telefonoOjid = body.telefonoOjid || body.jid || body.telefono || body.destinatario;
      const texto = body.texto || body.mensaje || body.contenido;

      if (!telefonoOjid || !texto) {
        return responderJson(res, 400, {
          ok: false,
          error: "telefonoOjid (o jid) y texto (o mensaje) son requeridos",
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
