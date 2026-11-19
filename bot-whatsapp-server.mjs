// ============================================================================
// DEMONIO / SERVICIO 24/7 DEL BOT DE WHATSAPP (@whiskeysockets/baileys)
// Puerto Local: 3005 (http://127.0.0.1:3005)
// Sesión persistente: /root/sistema_hipico/whatsapp_auth
// ============================================================================

import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import WebSocket from "ws";

if (typeof globalThis.WebSocket === "undefined") {
  try {
    const wsMod = await import("ws");
    globalThis.WebSocket = wsMod.default || wsMod;
  } catch {
    // Node 20+ provee globalThis.WebSocket de forma nativa
  }
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
const INTERNAL_BOT_SECRET = String(process.env.INTERNAL_BOT_SECRET ?? "").trim();
if (!INTERNAL_BOT_SECRET) {
  throw new Error("INTERNAL_BOT_SECRET no configurado: el demonio aborta (fail-closed).");
}

/** Comparación en tiempo constante del secreto interno recibido por HTTP. */
function esSecretoInternoValido(valor) {
  if (typeof valor !== "string" || !valor) return false;
  const recibido = Buffer.from(valor);
  const configurado = Buffer.from(INTERNAL_BOT_SECRET);
  if (recibido.length !== configurado.length) return false;
  return timingSafeEqual(recibido, configurado);
}

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

async function liberarVinculosHuerfanos(salaId = null) {
  try {
    salasCacheMap.clear();
    if (supabase) {
      if (salaId) {
        await supabase
          .from("salas_juego")
          .update({ whatsapp_group_jid: null, whatsapp_group_nombre: null, updated_at: new Date().toISOString() })
          .eq("id", salaId);
      } else {
        await supabase
          .from("salas_juego")
          .update({ whatsapp_group_jid: null, whatsapp_group_nombre: null, updated_at: new Date().toISOString() })
          .eq("activa", false)
          .not("whatsapp_group_jid", "is", null);
      }
    }
    console.log(`[Bot WhatsApp] 🧹 Vínculos huérfanos liberados en BD y memoria.`);
  } catch (err) {
    console.warn("[Bot WhatsApp] Aviso liberando vínculos huérfanos:", err?.message || err);
  }
}

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

function normalizarParadaPremio(raw) {
  if (typeof raw !== "string" || !raw) return "";
  return raw
    .replace(
      /(?:^|(?<=[\s,(\[]))(?:10)?[aª@\/](\d+(?:[.,]\d+)?)(?=$|[\s,)\]])/gi,
      "10/$1"
    )
    .replace(
      /(?:^|(?<=[\s,(\[]))10-(\d+(?:[.,]\d+)?)(?=$|[\s,)\]])/gi,
      "10/$1"
    );
}

function normalizarTelefonoCompleto(codigoPais, telefono) {
  const cp = String(codigoPais || "").replace(/\D/g, "");
  const tel = String(telefono || "").replace(/\D/g, "").replace(/^0+/, "");
  if (!tel) return cp;
  if (!cp) return tel;
  if (tel.startsWith(cp)) return tel;
  return `${cp}${tel}`;
}

const sanitizarTexto = (str) => {
  if (typeof str !== "string") return "";
  const conPremio = normalizarParadaPremio(str);
  return conPremio
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/[^\w\s.,!¡?¿$*+=\-()\[\]/@ªáéíóúÁÉÍÓÚñÑ]/gi, "")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean)
    .join("\n");
};

async function verificarEsOperadorAutorizado(
  sala,
  remoteJid,
  participantJid,
  telNormalizado,
  participantAlt = null
) {
  const cacheKey = `${remoteJid}_${participantJid}_${participantAlt || ""}`;
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

  // 4. Chequeo por whatsapp_lid / whatsapp_jid del operador registrado
  if (!esAutorizado && supabase && (participantJid || participantAlt)) {
    try {
      const jids = [participantJid, participantAlt].filter(Boolean);
      const filtros = jids.flatMap((jid) => [
        `whatsapp_lid.eq.${jid}`,
        `whatsapp_jid.eq.${jid}`,
      ]);
      if (filtros.length > 0) {
        const { data: usuarioPorJid } = await supabase
          .from("usuario_sistema")
          .select("id, nombre, activo, es_principal, grupo_id")
          .or(filtros.join(","))
          .limit(1)
          .maybeSingle();
        if (usuarioPorJid && usuarioPorJid.activo !== false) {
          if (usuarioPorJid.es_principal) {
            esAutorizado = true;
          } else if (sala?.grupo_id && usuarioPorJid.grupo_id === sala.grupo_id) {
            esAutorizado = true;
          }
        }
      }
    } catch {
      // Columnas opcionales ausentes: se ignora este fallback
    }
  }

  cacheOperadores.set(cacheKey, { esOp: esAutorizado, exp: Date.now() + 1000 * 60 * 2 }); // 2 min
  return esAutorizado;
}

// Estado en memoria del demonio Baileys
let sock = null;
let conectado = false;
let qrRaw = null;
let qrDataUrl = null;
let numeroVinculado = null;
let gruposCache = [];
let reconectando = false;
let reconnectTimer = null;

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
  if (!supabase || !remoteJid) return [];

  const resultados = [];
  const { data: salas, error: errSala } = await supabase
    .from("salas_juego")
    .select("*")
    .eq("whatsapp_group_jid", remoteJid)
    .eq("activa", true)
    .order("created_at", { ascending: false })
    .limit(1);

  if (errSala) {
    console.error("[Bot WhatsApp] Error consultando sala:", errSala.message);
    return [];
  }
  for (const sala of salas || []) {
    resultados.push({
      ...sala,
      _whatsapp_group_jid: remoteJid,
      _whatsapp_group_nombre: sala.whatsapp_group_nombre || null,
    });
  }

  // 3. Respaldo por grupos.whatsapp_group_id o grupos.whatsapp_group_jid
  if (resultados.length === 0) {
    try {
      const { data: grp } = await supabase
        .from("grupos")
        .select("id, nombre, whatsapp_group_id")
        .eq("whatsapp_group_id", remoteJid)
        .limit(1)
        .maybeSingle();

      if (grp?.id) {
        const { data: salasGrp } = await supabase
          .from("salas_juego")
          .select("*")
          .eq("grupo_id", grp.id)
          .order("created_at", { ascending: false });

        for (const s of salasGrp || []) {
          if (!idsVistos.has(s.id)) {
            idsVistos.add(s.id);
            resultados.push({
              ...s,
              _whatsapp_group_jid: remoteJid,
              _whatsapp_group_nombre: s.whatsapp_group_nombre || grp.nombre || null,
            });
          }
        }
      }
    } catch {
      // noop
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

async function buscarClienteEnGrupo(grupoId, pJid, pAlt, telR, pushName = "") {
  if (!supabase || !grupoId) return null;
  const pushNameNorm = String(pushName || "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
  const pushNameValido =
    pushNameNorm &&
    !["USUARIO", "JUGADOR", "OPERADOR", "OPERADOR (TELEFONO)", "ADMIN"].includes(pushNameNorm)
      ? pushNameNorm
      : "";
  const cacheKey = `${grupoId}:${pJid || pAlt || telR || pushNameValido}`;
  const cached = clientesCacheMap.get(cacheKey);
  if (cached && Date.now() < cached.exp) return cached.cliente;

  const CAMPOS_CLIENTE =
    "id, grupo_id, nombre, seudonimo, saldo_actual, saldo_retenido, saldo_disponible, libre, aval, whatsapp_jid, codigo_pais, telefono, telefono_normalizado";

  const condicionesOr = [];
  if (pJid) condicionesOr.push(`whatsapp_jid.eq.${pJid}`);
  if (pAlt && pAlt !== pJid) condicionesOr.push(`whatsapp_jid.eq.${pAlt}`);
  if (telR && telR.length >= 7) condicionesOr.push(`telefono_normalizado.eq.${telR}`);

  if (condicionesOr.length > 0) {
    const { data: clExacto } = await supabase
      .from("clientes")
      .select(CAMPOS_CLIENTE)
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
    const sufijo9 = telR.slice(-9);
    const { data: candidatosTel } = await supabase
      .from("clientes")
      .select(CAMPOS_CLIENTE)
      .eq("grupo_id", grupoId);

    if (Array.isArray(candidatosTel) && candidatosTel.length > 0) {
      const clCompuesto = candidatosTel.find((c) => {
        const comp = normalizarTelefonoCompleto(c.codigo_pais, c.telefono);
        const norm = normalizarTelefono(c.telefono_normalizado || c.telefono);
        return (
          (comp && (comp === telR || (sufijo9.length >= 9 && comp.endsWith(sufijo9)))) ||
          (norm && (norm === telR || (sufijo9.length >= 9 && norm.endsWith(sufijo9))))
        );
      });
      if (clCompuesto) {
        clientesCacheMap.set(cacheKey, { cliente: clCompuesto, exp: Date.now() + 120000 });
        return clCompuesto;
      }
    }

    const sufijo8 = telR.slice(-8);
    const { data: clParcial } = await supabase
      .from("clientes")
      .select(CAMPOS_CLIENTE)
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

  // Búsqueda por UPPER(TRIM(nombre)) / UPPER(TRIM(seudonimo)) = UPPER(TRIM(pushName)) dentro de `grupoId`
  if (pushNameValido) {
    const { data: candidatosGrupo } = await supabase
      .from("clientes")
      .select(CAMPOS_CLIENTE)
      .eq("grupo_id", grupoId);

    if (Array.isArray(candidatosGrupo) && candidatosGrupo.length > 0) {
      const clPorNombre = candidatosGrupo.find((c) => {
        const nom = String(c.nombre || "").trim().replace(/\s+/g, " ").toUpperCase();
        const seu = String(c.seudonimo || "").trim().replace(/\s+/g, " ").toUpperCase();
        return nom === pushNameValido || (seu && seu === pushNameValido);
      });
      if (clPorNombre) {
        clientesCacheMap.set(cacheKey, { cliente: clPorNombre, exp: Date.now() + 120000 });
        return clPorNombre;
      }
    }
  }

  // Pista multi-grupo: si el jugador tiene otra fila en otro grupo con el mismo whatsapp_jid/teléfono,
  // usar su teléfono/nombre/seudónimo para localizar su fila independiente en `grupoId`.
  if (condicionesOr.length > 0) {
    const { data: filasOtroGrupo } = await supabase
      .from("clientes")
      .select("nombre, seudonimo, telefono, telefono_normalizado")
      .or(condicionesOr.join(","))
      .limit(5);

    if (Array.isArray(filasOtroGrupo) && filasOtroGrupo.length > 0) {
      const { data: candidatosGrupo } = await supabase
        .from("clientes")
        .select(CAMPOS_CLIENTE)
        .eq("grupo_id", grupoId);

      if (Array.isArray(candidatosGrupo) && candidatosGrupo.length > 0) {
        for (const pista of filasOtroGrupo) {
          const telP = normalizarTelefono(pista.telefono_normalizado || pista.telefono);
          const sufP = telP.length >= 7 ? telP.slice(-8) : "";
          const nomP = String(pista.nombre || "").trim().replace(/\s+/g, " ").toUpperCase();
          const seuP = String(pista.seudonimo || "").trim().replace(/\s+/g, " ").toUpperCase();

          const encontrado = candidatosGrupo.find((c) => {
            const telC = normalizarTelefono(c.telefono_normalizado || c.telefono);
            if (telP && telC && (telC === telP || (sufP && telC.endsWith(sufP)))) return true;
            const nomC = String(c.nombre || "").trim().replace(/\s+/g, " ").toUpperCase();
            const seuC = String(c.seudonimo || "").trim().replace(/\s+/g, " ").toUpperCase();
            if (nomP && (nomC === nomP || seuC === nomP)) return true;
            if (seuP && (nomC === seuP || seuC === seuP)) return true;
            return false;
          });

          if (encontrado) {
            clientesCacheMap.set(cacheKey, { cliente: encontrado, exp: Date.now() + 120000 });
            return encontrado;
          }
        }
      }
    }
  }

  // Fallback a `clientes_grupos` donde `grupo_id = grupoId`
  try {
    const { data: membresias } = await supabase
      .from("clientes_grupos")
      .select("cliente_id")
      .eq("grupo_id", grupoId);

    const idsMem = (membresias || []).map((m) => m?.cliente_id).filter(Boolean);
    if (idsMem.length > 0) {
      const { data: candidatosMem } = await supabase
        .from("clientes")
        .select(CAMPOS_CLIENTE)
        .in("id", idsMem);

      if (Array.isArray(candidatosMem) && candidatosMem.length > 0) {
        const suf8 = telR && telR.length >= 7 ? telR.slice(-8) : "";
        const matchMem = candidatosMem.find((c) => {
          if (pJid && c.whatsapp_jid === pJid) return true;
          if (pAlt && c.whatsapp_jid === pAlt) return true;
          const telC = normalizarTelefono(c.telefono_normalizado || c.telefono);
          if (telR && telC && (telC === telR || (suf8 && telC.endsWith(suf8)))) return true;
          const nomC = String(c.nombre || "").trim().replace(/\s+/g, " ").toUpperCase();
          const seuC = String(c.seudonimo || "").trim().replace(/\s+/g, " ").toUpperCase();
          if (pushNameValido && (nomC === pushNameValido || seuC === pushNameValido)) return true;
          return false;
        });
        if (matchMem) {
          clientesCacheMap.set(cacheKey, { cliente: matchMem, exp: Date.now() + 120000 });
          return matchMem;
        }
      }
    }
  } catch {
    // clientes_grupos opcional
  }

  return null;
}

function parsearMontoFlexible(montoRaw) {
  if (typeof montoRaw === "number") return Math.max(0, montoRaw);
  if (!montoRaw) return 0;
  let s = String(montoRaw).trim().toUpperCase();
  const matchMil = /^(\d+(?:[.,]\d+)?)\s*(K|MIL)$/.exec(s);
  if (matchMil) {
    const base = parseFloat(matchMil[1].replace(/\./g, "").replace(",", ".")) || 0;
    return base * 1000;
  }
  if (s.includes(".") && s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(".")) {
    if (/\.\d{3}$/.test(s)) {
      s = s.replace(/\./g, "");
    }
  } else if (s.includes(",")) {
    if (/,\d{3}$/.test(s)) {
      s = s.replace(/,/g, "");
    } else {
      s = s.replace(",", ".");
    }
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : Math.max(0, n);
}

function formatearMonto(n) {
  const num = Number(n || 0);
  return num.toLocaleString("es-VE", {
    minimumFractionDigits: num % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

// ============================================================================
// IDENTIDAD DE GRUPO Y PLANTILLAS EFECTIVAS (réplica del servidor Next)
// ============================================================================
const ENCABEZADO_INSTITUCIONAL = "🏇🏻Administración Hípica🏇🏻";
const CONECTORES_GRUPO = {
  plano: "comparte el plano oficial de jugadas",
  resultado: "informa el resultado y la liquidación oficial",
  apertura: "da la bienvenida a la carrera",
  cierre: "informa que la carrera quedó cerrada",
  concrecion: "confirma una jugada pactada",
  propuesta: "comparte una propuesta en vivo",
};

function nombreGrupoMensaje(sala) {
  const candidatos = [
    sala?.grupo_nombre,
    sala?.nombre_grupo,
    sala?.whatsapp_group_nombre,
    sala?.grupo?.nombre,
    sala?.nombre_sala,
    sala?.nombre,
  ];
  for (const valor of candidatos) {
    const nombre = String(valor ?? "").replace(/\s+/g, " ").trim();
    if (nombre) return nombre.toUpperCase();
  }
  return "PRINCIPAL";
}

function encabezadoGrupo(sala, contexto) {
  const conector = CONECTORES_GRUPO[contexto] || CONECTORES_GRUPO.plano;
  return `${ENCABEZADO_INSTITUCIONAL}\nTU Grupo "${nombreGrupoMensaje(sala)}" te ${conector}:`;
}

function aplicarVariablesPlantilla(texto, variables) {
  let resultado = String(texto || "");
  for (const [clave, valor] of Object.entries(variables || {})) {
    const key = clave.startsWith("{") && clave.endsWith("}") ? clave : `{${clave}}`;
    resultado = resultado.split(key).join(valor == null ? "" : String(valor));
  }
  return resultado;
}

const PLANTILLAS_DAEMON_DEFAULT = {
  apertura_carrera: "{encabezado}\n🟢 *{hipodromo} CARRERA {carrera} ABIERTA* — Hagan sus jugadas.{retirados}",
  cierre_carrera: "{encabezado}\n🔒 *{hipodromo} CARRERA {carrera} CERRADA* — No más jugadas. Suerte a todos.",
  plano_encabezado: "{encabezado}\n{fecha}\n{hipodromo}, {carrera} Carrera\nRetirado: {retirados}",
};

async function cargarPlantillasGrupo(grupoId) {
  const mapa = new Map(Object.entries(PLANTILLAS_DAEMON_DEFAULT));
  if (!grupoId || !supabase) return mapa;
  try {
    const { data, error } = await supabase
      .from("whatsapp_plantillas_grupo")
      .select("clave, contenido, activo")
      .eq("grupo_id", String(grupoId));
    if (!error && Array.isArray(data)) {
      for (const fila of data) {
        const clave = String(fila?.clave ?? "").trim();
        const contenido = typeof fila?.contenido === "string" ? fila.contenido : "";
        if (clave && contenido.trim() && fila?.activo !== false) mapa.set(clave, contenido);
      }
    }
  } catch {}
  return mapa;
}

function obtenerPlantillaGrupo(mapa, clave, variables, fallback) {
  const contenido = mapa?.get(clave);
  if (!contenido) return fallback;
  const aplicada = aplicarVariablesPlantilla(contenido, variables).trim();
  return aplicada || fallback;
}

function variablesEncabezadoGrupo(sala, contexto) {
  return {
    encabezado: encabezadoGrupo(sala, contexto),
    grupo: nombreGrupoMensaje(sala),
    conector: CONECTORES_GRUPO[contexto] || CONECTORES_GRUPO.plano,
  };
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

let ultimoRefrescoGrupos = 0;
async function refrescarGruposParticipantes(forzar = false) {
  if (!sock || !conectado) return gruposCache;
  const ahora = Date.now();
  if (!forzar && ahora - ultimoRefrescoGrupos < 60000 && gruposCache.length > 0) {
    return gruposCache;
  }
  try {
    const participando = await sock.groupFetchAllParticipating();
    gruposCache = Object.values(participando || {}).map((g) => ({
      jid: g.id,
      id: g.id,
      nombre: g.subject || g.id,
      subject: g.subject || g.id,
      participantes: g.participants?.length || 0,
      totalParticipantes: g.participants?.length || 0,
      participantesLista: (g.participants || []).map((p) => ({
        jid: p.id,
        esAdmin: Boolean(p.admin || p.isAdmin || p.isSuperAdmin),
      })),
      icono: null,
    }));
    ultimoRefrescoGrupos = ahora;
    console.log(`[Bot WhatsApp] 📋 Grupos participantes refrescados (${gruposCache.length})`);
  } catch (err) {
    console.warn("[Bot WhatsApp] Error al listar grupos:", err?.message || err);
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

async function registrarMensajeEnChatWeb(sala, groupJid, texto, tipo = "sistema") {
  if (!supabase || !sala?.id || !texto) return;
  try {
    await supabase.from("chat_mensajes").insert({
      grupo_id: sala.grupo_id,
      sala_id: sala.id,
      remitente_nombre: "🤖 ASISTENTE DE SALA",
      es_operador: true,
      es_bot: true,
      tipo_mensaje: tipo,
      contenido: texto,
      whatsapp_group_jid: groupJid || sala.whatsapp_group_jid || null,
      origen_canal: "WHATSAPP",
    });
  } catch (err) {
    // best-effort
  }
}

export function normalizarHipodromo(str) {
  const s = String(str || "").toUpperCase().trim();
  if (s === "LR" || s === "RINCONADA" || s === "LA RINCONADA") return "LA RINCONADA";
  if (s === "GP" || s === "GULFSTREAM" || s === "GULFSTREAM PARK") return "GULFSTREAM PARK";
  if (s === "TAM" || s === "TAMPA" || s === "TAMPA BAY") return "TAMPA BAY DOWNS";
  if (s === "AQU" || s === "AQUEDUCT") return "AQUEDUCT";
  return s || "LA RINCONADA";
}

export async function ejecutarAperturaCarrera(sala, groupJid, hipodromoArg, carreraArg) {
  if (!supabase) throw new Error("Supabase no configurado");

  const hipoLimpio = normalizarHipodromo(hipodromoArg || sala.hipodromo_activo || "LA RINCONADA");
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

  const mapaApertura = await cargarPlantillasGrupo(sala?.grupo_id);
  const textoApertura = obtenerPlantillaGrupo(
    mapaApertura,
    "apertura_carrera",
    {
      ...variablesEncabezadoGrupo(sala, "apertura"),
      hipodromo: hipoLimpio,
      carrera: numCarrera,
      retirados: "",
    },
    `${encabezadoGrupo(sala, "apertura")}\n🟢 *${hipoLimpio} CARRERA ${numCarrera} ABIERTA* — Hagan sus jugadas.`
  );

  if (groupJid && conectado) {
    await enviarMensajeGrupo(groupJid, textoApertura);
  }
  await registrarMensajeEnChatWeb(sala, groupJid, textoApertura, "sistema");

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

  // Al cerrar la carrera se van todas las paradas abiertas de la sala
  try {
    const { data: paradasAbiertas } = await supabase
      .from("chat_mensajes")
      .select("id, remitente_id, monto_disponible")
      .eq("sala_id", sala.id)
      .in("tipo_mensaje", ["propuesta_jugada", "PROPUESTA"])
      .in("estado_propuesta", ["abierta", "parcial"])
      .gt("monto_disponible", 0);

    if (Array.isArray(paradasAbiertas) && paradasAbiertas.length > 0) {
      const idsCerrar = paradasAbiertas.map((p) => p.id);
      const liberadoPorJugador = new Map();
      for (const p of paradasAbiertas) {
        if (!p.remitente_id) continue;
        const jId = String(p.remitente_id);
        liberadoPorJugador.set(jId, (liberadoPorJugador.get(jId) || 0) + Number(p.monto_disponible || 0));
      }
      await supabase
        .from("chat_mensajes")
        .update({ estado_propuesta: "cancelada", monto_disponible: 0 })
        .in("id", idsCerrar);

      for (const [jugadorId, liberado] of liberadoPorJugador.entries()) {
        if (liberado <= 0) continue;
        const { data: cl } = await supabase
          .from("clientes")
          .select("id, saldo_actual, saldo_retenido, libre, aval")
          .eq("id", jugadorId)
          .maybeSingle();
        if (cl && !cl.libre) {
          const nuevoRet = Math.max(0, Number((Number(cl.saldo_retenido || 0) - liberado).toFixed(2)));
          const nuevoDisp = Math.max(
            0,
            Number((Number(cl.saldo_actual || 0) + Number(cl.aval || 0) - nuevoRet).toFixed(2))
          );
          await supabase
            .from("clientes")
            .update({ saldo_retenido: nuevoRet, saldo_disponible: nuevoDisp })
            .eq("id", jugadorId);
        }
      }
    }
  } catch (errParadas) {
    console.warn("[Bot WhatsApp] Aviso cerrando paradas al cerrar carrera:", errParadas?.message || errParadas);
  }

  const hipo = String(sala.hipodromo_activo || "HIPÓDROMO").toUpperCase();
  const numCarrera = sala.numero_carrera_activa || 1;

  const mapaCierre = await cargarPlantillasGrupo(sala?.grupo_id);
  const textoCierre = obtenerPlantillaGrupo(
    mapaCierre,
    "cierre_carrera",
    {
      ...variablesEncabezadoGrupo(sala, "cierre"),
      hipodromo: hipo,
      carrera: numCarrera,
    },
    `${encabezadoGrupo(sala, "cierre")}\n🔒 *${hipo} CARRERA ${numCarrera} CERRADA* — No más jugadas. Suerte a todos.`
  );

  if (groupJid && conectado) {
    await enviarMensajeGrupo(groupJid, textoCierre);
  }
  await registrarMensajeEnChatWeb(sala, groupJid, textoCierre, "sistema");

  return { ok: true, textoCierre };
}

export async function construirYPublicarPlano(sala, groupJid) {
  if (!supabase) throw new Error("Supabase no configurado en bot-whatsapp-server");

  const hipodromo = String(sala.hipodromo_activo || "La Rinconada").trim();
  const numCarrera = sala.numero_carrera_activa || 1;
  const ord = numCarrera === 1 ? "1ra" : numCarrera === 2 ? "2da" : numCarrera === 3 ? "3ra" : `${numCarrera}ta`;
  const carreraId = sala.carrera_activa_id || null;

  const diasSemana = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const meses = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
  ];
  const now = new Date();
  const fechaStr = `${diasSemana[now.getDay()]}, ${now.getDate()} de ${meses[now.getMonth()]} de ${now.getFullYear()}`;

  let query = supabase
    .from("chat_tickets_fifo")
    .select("*")
    .eq("sala_id", sala.id)
    .in("estado", ["PENDIENTE", "ACTIVO", "ABIERTO"])
    .gt("monto_concretado", 0)
    .order("created_at", { ascending: true });

  if (carreraId) {
    query = query.eq("carrera_id", carreraId);
  }

  const { data: tickets, error } = await query;
  if (error) throw new Error(error.message);

  const lista = (tickets || []).filter((t) => Number(t?.monto_concretado || 0) > 0);
  const totalPactado = lista.reduce((acc, t) => acc + Number(t.monto_concretado || 0), 0);

  let retiradosStr = "";
  if (carreraId) {
    try {
      const { data: cRow } = await supabase.from("carreras").select("ejemplares_retirados").eq("id", carreraId).maybeSingle();
      if (cRow?.ejemplares_retirados && Array.isArray(cRow.ejemplares_retirados) && cRow.ejemplares_retirados.length > 0) {
        retiradosStr = cRow.ejemplares_retirados.map((r) => `#${String(r).replace(/^#/, "")}`).join(", ");
      }
    } catch {}
  }

  const lineas =
    lista.length > 0
      ? lista
          .map((t, idx) => {
            const proponente = t.proponente_nombre || "Jugador A";
            const aceptante = t.aceptante_nombre || "Jugador B";
            const accProp = String(t.accion_proponente || "JUEGA").trim().toUpperCase();
            const esConsigueProp = accProp === "CONSIGUE" || accProp === "CONSIGO" || accProp === "DA" || accProp === "DOY";
            const jugadorJuega = esConsigueProp ? aceptante : proponente;
            const jugadorDa = esConsigueProp ? proponente : aceptante;
            const prop = String(t.proporcion_premio || t.proporcion || "").trim();
            const tieneProp10 = /^10\s*[\/aAª@\-]\s*\d+(?:[.,]\d+)?$/i.test(prop) && !/^10\s*[\/aAª@\-]\s*10$/i.test(prop);
            const propCanon = tieneProp10 ? prop.toUpperCase().replace(/\s+/g, "").replace(/[aAª@\-]/g, "/").replace(",", ".") : "";
            let jugadaToken = "";
            let caballoToken = "";
            if (t.es_match || (Array.isArray(t.caballos_bando_b) && t.caballos_bando_b.length > 0)) {
              const bA = (t.caballos_bando_a || []).join("-") || t.ejemplar_numero || "1";
              const bB = (t.caballos_bando_b || []).join("-");
              caballoToken = `${bA}x${bB}`;
              jugadaToken = propCanon;
            } else {
              const mod = String(t.modalidad || "1P").trim().toUpperCase();
              caballoToken = String(t.ejemplar_numero || (t.caballos_bando_a || []).join("-") || "1").trim();
              jugadaToken = propCanon || (mod === "MATCH" ? "PP" : mod);
            }
            return `${idx + 1}) Juega ${jugadorJuega} ${jugadaToken ? `${jugadaToken} ` : ""}(${caballoToken}) con ${formatearMonto(t.monto_concretado)} da ${jugadorDa}`;
          })
          .join("\n")
      : "_No hay jugadas concretadas en esta carrera._";

  const mapaPlano = await cargarPlantillasGrupo(sala?.grupo_id);
  const encabezadoPlano = obtenerPlantillaGrupo(
    mapaPlano,
    "plano_encabezado",
    {
      ...variablesEncabezadoGrupo(sala, "plano"),
      fecha: fechaStr,
      hipodromo,
      carrera: ord,
      retirados: retiradosStr || "—",
    },
    `${encabezadoGrupo(sala, "plano")}\n` +
      `${fechaStr}\n` +
      `${hipodromo}, ${ord} Carrera\n` +
      `Retirado: ${retiradosStr}`
  );

  let textoPlano =
    `${encabezadoPlano}\n\n` +
    `[Listado de jugadas concretadas]\n` +
    `${lineas}`;

  if (lista.length > 0) {
    textoPlano += `\n\nTotal Jugadas (${lista.length})\nMonto Jugado: $${formatearMonto(totalPactado)}`;
  }

  if (groupJid && conectado) {
    await enviarMensajeGrupo(groupJid, textoPlano);
  }
  await registrarMensajeEnChatWeb(sala, groupJid, textoPlano, "sistema");

  return { ok: true, textoPlano, totalTickets: lista.length, totalPactado, totalPropuestas: 0 };
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
    await registrarMensajeEnChatWeb(sala, groupJid, textoConfirmacion, "sistema");
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
  await registrarMensajeEnChatWeb(sala, groupJid, textoAnulacion, "sistema");
  return { ok: true, mensaje: textoAnulacion };
}

export async function ejecutarSentenciaPizarra(sala, groupJid, pizarraRaw, esRectificacion = false) {
  if (!supabase) throw new Error("Supabase no configurado");
  const numeros = String(pizarraRaw || "").match(/\b\d+[A-Za-z]?\b/g) || [];
  if (numeros.length === 0) {
    const msgError = "⚠️ Formato de sentencia inválido. Uso: *!sentenciar 10.5.1.2.7* o *!pizarra 10-5-1-2-7*";
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
      queryTickets = queryTickets.eq("carrera_id", carreraId);
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

          if (neto > 0) {
            await supabase.from("libro_mayor_clientes").insert({
              cliente_id: jugadorId,
              cliente_nombre: b.nombre,
              grupo_id: sala.grupo_id,
              tipo_movimiento: "JUGADA_GANADA_NETO",
              monto_centavos: Math.round(neto * 100),
              monto: neto,
              hipodromo,
              carrera: numCarrera,
              fecha_carrera: new Date().toISOString().split("T")[0],
              observacion: `Liquidación Sala ${sala.nombre_sala}`,
              creado_por: "OPERADOR_WHATSAPP",
            });
          } else if (neto < 0) {
            const montoAbs = Math.abs(neto);
            await supabase.from("libro_mayor_clientes").insert({
              cliente_id: jugadorId,
              cliente_nombre: b.nombre,
              grupo_id: sala.grupo_id,
              tipo_movimiento: "JUGADA_PERDIDA",
              monto_centavos: Math.round(montoAbs * 100),
              monto: montoAbs,
              hipodromo,
              carrera: numCarrera,
              fecha_carrera: new Date().toISOString().split("T")[0],
              observacion: `Liquidación Sala ${sala.nombre_sala}`,
              creado_por: "OPERADOR_WHATSAPP",
            });
          }
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
    qJugadas = qJugadas.eq("carrera_id", carreraId);
  }
  const { data: jugadasCarrera } = await qJugadas;
  const listaJugadas = jugadasCarrera || [];
  const bloqueJugadas =
    listaJugadas.length > 0
      ? listaJugadas
          .map((t, idx) => {
            const detalle = t.es_match
              ? `A Premio ${(t.caballos_bando_a || []).join("-")} x ${(t.caballos_bando_b || []).join("-")}`
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
  const prefijoTitulo = esRectificacion ? "🔄 *PIZARRA RECTIFICADA OFICIALMENTE*\n\n" : "";
  const textoResultado =
    `${prefijoTitulo}🏁 *LLEGADA OFICIAL — ${hipodromo} C${numCarrera}*\n` +
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
  await registrarMensajeEnChatWeb(sala, groupJid, textoResultado, "llegada");

  return {
    ok: true,
    textoResultado,
    positivos,
    negativos,
    pizarra: numeros,
  };
}

export async function ejecutarRectificacionPizarra(sala, groupJid, pizarraRaw) {
  if (!supabase) throw new Error("Supabase no configurado");
  const hipo = String(sala.hipodromo_activo || "HIPÓDROMO").toUpperCase();
  const numCarrera = sala.numero_carrera_activa || 1;
  const carreraId = sala.carrera_recien_cerrada_id || sala.carrera_activa_id;

  // 1. Revertir movimientos previos en libro_mayor_clientes
  try {
    const { data: movimientos } = await supabase
      .from("libro_mayor_clientes")
      .select("*")
      .eq("grupo_id", sala.grupo_id)
      .eq("hipodromo", hipo)
      .eq("carrera", numCarrera)
      .in("tipo_movimiento", ["JUGADA_GANADA_NETO", "JUGADA_PERDIDA"]);

    for (const mov of movimientos || []) {
      const { data: cl } = await supabase
        .from("clientes")
        .select("saldo_actual, saldo_retenido, libre, aval")
        .eq("id", mov.cliente_id)
        .single();

      if (cl) {
        let ajusteSaldo = 0;
        if (mov.tipo_movimiento === "JUGADA_GANADA_NETO") {
          ajusteSaldo = -Number(mov.monto || 0);
        } else if (mov.tipo_movimiento === "JUGADA_PERDIDA") {
          ajusteSaldo = Number(mov.monto || 0);
        }

        const nuevoSaldo = Number(((cl.saldo_actual || 0) + ajusteSaldo).toFixed(2));
        await supabase
          .from("clientes")
          .update({
            saldo_actual: nuevoSaldo,
            saldo_disponible: cl.libre ? 999999 : Math.max(0, Number((nuevoSaldo + (cl.aval || 0) - Number(cl.saldo_retenido || 0)).toFixed(2))),
          })
          .eq("id", mov.cliente_id);

        await supabase.from("libro_mayor_clientes").insert({
          cliente_id: mov.cliente_id,
          cliente_nombre: mov.cliente_nombre,
          grupo_id: sala.grupo_id,
          tipo_movimiento: "REVERSION_LIQUIDACION",
          monto_centavos: Math.round(Math.abs(ajusteSaldo) * 100),
          monto: Math.abs(ajusteSaldo),
          hipodromo: hipo,
          carrera: numCarrera,
          fecha_carrera: new Date().toISOString().split("T")[0],
          observacion: `Reversión por Rectificación de Pizarra Carrera ${hipo} C${numCarrera}`,
          creado_por: "OPERADOR_WHATSAPP",
        });
      }
    }

    // Restablecer tickets a ACTIVO
    let qTickets = supabase
      .from("chat_tickets_fifo")
      .select("*")
      .eq("sala_id", sala.id)
      .in("estado", ["GANADOR_PROPONENTE", "GANADOR_ACEPTANTE", "EMPATE"]);
    if (carreraId) {
      qTickets = qTickets.or(`carrera_id.eq.${carreraId},carrera_id.is.null`);
    }
    const { data: ticketsLiquidados } = await qTickets;
    for (const t of ticketsLiquidados || []) {
      await supabase.from("chat_tickets_fifo").update({ estado: "ACTIVO" }).eq("id", t.id);
      for (const jId of [t.proponente_id, t.aceptante_id]) {
        const { data: cl } = await supabase.from("clientes").select("saldo_retenido, libre, saldo_actual, aval").eq("id", jId).single();
        if (cl && !cl.libre) {
          const ret = Number(((cl.saldo_retenido || 0) + Number(t.monto_concretado || 0)).toFixed(2));
          await supabase.from("clientes").update({
            saldo_retenido: ret,
            saldo_disponible: Math.max(0, Number(((cl.saldo_actual || 0) + (cl.aval || 0) - ret).toFixed(2))),
          }).eq("id", jId);
        }
      }
    }
  } catch (errRev) {
    console.error("[Bot WhatsApp] Error en reversión previa a rectificación:", errRev);
  }

  // 2. Liquidar con la nueva pizarra indicando esRectificacion = true
  return await ejecutarSentenciaPizarra(sala, groupJid, pizarraRaw, true);
}

export async function ejecutarAjusteOperador(sala, groupJid, targetNombre, signo, monto, operadorNombre) {
  if (!supabase) throw new Error("Supabase no configurado");
  const { data: candidatos } = await supabase
    .from("clientes")
    .select("id, nombre, seudonimo, saldo_actual, saldo_retenido, saldo_disponible, libre, aval, whatsapp_jid, telefono, telefono_normalizado")
    .eq("grupo_id", sala.grupo_id);

  const targetLimpio = String(targetNombre).trim().toUpperCase();
  const match = (candidatos || []).find((c) => {
    const n = String(c.nombre || "").trim().toUpperCase();
    const s = String(c.seudonimo || "").trim().toUpperCase();
    return n === targetLimpio || s === targetLimpio || n.includes(targetLimpio) || (s && s.includes(targetLimpio));
  });

  if (!match) {
    const msgError = `⚠️ Jugador "${targetNombre}" no encontrado en este grupo.`;
    if (groupJid && conectado) await enviarMensajeGrupo(groupJid, msgError);
    return { ok: false, mensaje: msgError };
  }

  const montoNum = Number(monto);
  const saldoActual = Number(match.saldo_actual || 0);
  const delta = signo === "+" ? montoNum : -montoNum;
  const nuevoSaldo = Number((saldoActual + delta).toFixed(2));
  const nuevoDisponible = match.libre ? 999999 : Math.max(0, Number((nuevoSaldo + Number(match.aval || 0) - Number(match.saldo_retenido || 0)).toFixed(2)));

  await supabase
    .from("clientes")
    .update({
      saldo_actual: nuevoSaldo,
      saldo_disponible: nuevoDisponible,
      updated_at: new Date().toISOString(),
    })
    .eq("id", match.id);

  await supabase.from("libro_mayor_clientes").insert({
    cliente_id: match.id,
    cliente_nombre: match.nombre,
    grupo_id: sala.grupo_id,
    tipo_movimiento: signo === "+" ? "DEPOSITO" : "RETIRO",
    monto_centavos: Math.round(montoNum * 100),
    monto: montoNum,
    observacion: "Ajuste operador WhatsApp",
    creado_por: operadorNombre || "OPERADOR_WHATSAPP",
    fecha_carrera: new Date().toISOString().split("T")[0],
  });

  const nombreFinal = match.seudonimo || match.nombre;
  const msgPublico = `✅ Saldo actualizado para *${nombreFinal}*: Nuevo saldo $${formatearMonto(nuevoSaldo)}`;
  const msgPrivado = `💰 Tu cuenta ha sido ${signo === "+" ? "acreditada" : "debitada"} con $${formatearMonto(montoNum)}. Tu nuevo saldo disponible es $${formatearMonto(nuevoDisponible)}.`;

  if (groupJid && conectado) {
    await enviarMensajeGrupo(groupJid, msgPublico);
  }
  await registrarMensajeEnChatWeb(sala, groupJid, msgPublico, "sistema");

  const jidTarget = match.whatsapp_jid || (match.telefono_normalizado ? `${match.telefono_normalizado}@s.whatsapp.net` : null);
  if (jidTarget && conectado) {
    await enviarMensajePrivado(jidTarget, msgPrivado);
  }

  return { ok: true, nuevoSaldo, nuevoDisponible, msgPublico, msgPrivado };
}

// ============================================================================
// CLIENTE HTTP CON COLA DE REINTENTOS Y BACKOFF PROGRESIVO
// Reintenta únicamente ante errores de red (fetch failed, ECONNREFUSED, ETIMEDOUT)
// o códigos de servidor 502/503/504 (típicos durante reinicios de PM2).
// ============================================================================
const CODIGOS_RED_REINTENTABLES = new Set(["ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "ECONNRESET", "EAI_AGAIN"]);
const STATUS_HTTP_REINTENTABLES = new Set([502, 503, 504]);

function esErrorRedReintentable(error) {
  if (!error) return false;
  const msg = String(error.message || error).toLowerCase();
  if (
    msg.includes("fetch failed") ||
    msg.includes("network") ||
    msg.includes("econnrefused") ||
    msg.includes("etimedout") ||
    msg.includes("terminated")
  ) {
    return true;
  }
  if (error.code && CODIGOS_RED_REINTENTABLES.has(String(error.code).toUpperCase())) {
    return true;
  }
  if (error.cause) {
    return esErrorRedReintentable(error.cause);
  }
  return false;
}

async function fetchConReintento(url, options = {}, maxIntentos = 3) {
  const delays = [1000, 2500];
  let ultimoError = null;

  for (let intento = 1; intento <= maxIntentos; intento++) {
    try {
      const res = await fetch(url, options);
      if (STATUS_HTTP_REINTENTABLES.has(res.status)) {
        if (intento < maxIntentos) {
          const delay = delays[intento - 1] || 2500;
          console.warn(
            `[Bot WhatsApp] ⚠️ HTTP ${res.status} al llamar ${url}. Reintentando (${intento}/${maxIntentos}) en ${delay}ms...`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        console.warn(`[Bot WhatsApp] ❌ HTTP ${res.status} persistente en ${url} tras ${maxIntentos} intentos.`);
      }
      return res;
    } catch (err) {
      ultimoError = err;
      const reintentable = esErrorRedReintentable(err);
      if (reintentable && intento < maxIntentos) {
        const delay = delays[intento - 1] || 2500;
        console.warn(
          `[Bot WhatsApp] ⚠️ Error de red (${err?.message || err}) al llamar ${url}. Reintentando (${intento}/${maxIntentos}) en ${delay}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      if (intento >= maxIntentos) {
        console.warn(
          `[Bot WhatsApp] ❌ Fallo definitivo tras ${maxIntentos} intentos al llamar ${url}:`,
          err?.message || err
        );
      }
      throw err;
    }
  }
  throw ultimoError;
}

// ============================================================================
// PROCESAMIENTO EN VIVO DE MENSAJES ENTRANTES DE WHATSAPP
// ============================================================================

async function manejarMensajeEntrante(msg) {
  try {
    if (!msg?.key) return;

    const whatsappMsgId = msg.key.id || null;
    const esFromMe = Boolean(msg.key.fromMe);

    // Evitar procesar mensajes que el propio bot envió automáticamente vía sock.sendMessage
    if (whatsappMsgId && mensajesEnviadosPorBot.has(whatsappMsgId)) {
      return;
    }

    // Descartar mensajes duplicados / reintentos
    if (whatsappMsgId && esMensajeDuplicado(whatsappMsgId)) {
      return;
    }

    const remoteJid = msg.key.remoteJid || "";
    const esGrupo = remoteJid.endsWith("@g.us");
    const esPrivado = remoteJid.endsWith("@s.whatsapp.net");
    if (!esGrupo && !esPrivado) return;

    guardarMensajeEnCache(msg);

    const texto =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      msg.message?.videoMessage?.caption ||
      "";

    const textoLimpio = sanitizarTexto(String(texto || ""));
    if (!textoLimpio) return;

    // Extracción estricta del remitente real:
    // En grupos (@g.us), NUNCA usar remoteJid como remitente; extraer msg.key.participant || msg.participant
    const myPhone = sock?.user?.id ? normalizarTelefono(sock.user.id) : "";
    const participantJid = esGrupo
      ? (msg.key.participant || msg.participant || (esFromMe && myPhone ? `${myPhone}@s.whatsapp.net` : ""))
      : remoteJid;
    const participantAlt = msg.key.participantAlt || msg.participantAlt || "";
    const ctxInfo =
      msg.message?.extendedTextMessage?.contextInfo ||
      msg.message?.imageMessage?.contextInfo ||
      msg.message?.videoMessage?.contextInfo ||
      msg.message?.contextInfo ||
      null;
    const quotedMsgId = ctxInfo?.stanzaId || null;
    const quotedParticipantJid = ctxInfo?.participant || null;
    const quotedTextRaw =
      ctxInfo?.quotedMessage?.conversation ||
      ctxInfo?.quotedMessage?.extendedTextMessage?.text ||
      ctxInfo?.quotedMessage?.imageMessage?.caption ||
      ctxInfo?.quotedMessage?.videoMessage?.caption ||
      "";
    const quotedText = quotedTextRaw ? sanitizarTexto(String(quotedTextRaw)) : null;

    const senderNombre = sanitizarTexto(msg.pushName) || (esFromMe ? "Operador" : "Usuario");
    const esLid = participantJid.endsWith("@lid");
    const esAltLid = participantAlt.endsWith("@lid");
    const telPrincipal = normalizarTelefono(participantJid);
    const telAlt = normalizarTelefono(participantAlt);
    let telReal = null;
    if (participantAlt && participantAlt.endsWith("@s.whatsapp.net")) {
      telReal = telAlt;
    } else if (participantJid && participantJid.endsWith("@s.whatsapp.net")) {
      telReal = telPrincipal;
    } else if (!esLid && telPrincipal && telPrincipal.length >= 7 && telPrincipal.length <= 15) {
      telReal = telPrincipal;
    } else if (!esAltLid && telAlt && telAlt.length >= 7 && telAlt.length <= 15) {
      telReal = telAlt;
    } else if (esGrupo && esLid && sock) {
      // Resolver teléfono real desde groupMetadata cuando WhatsApp envía participantJid en formato @lid
      try {
        const meta = await sock.groupMetadata(remoteJid);
        const parts = Array.isArray(meta?.participants) ? meta.participants : [];
        const pFound = parts.find((p) => p.id === participantJid || p.lid === participantJid);
        const jidCandidato = pFound?.phoneNumber || (pFound?.jid && pFound.jid.endsWith("@s.whatsapp.net") ? pFound.jid : null);
        if (jidCandidato) {
          const tRes = normalizarTelefono(jidCandidato);
          if (tRes && tRes.length >= 7 && tRes.length <= 15) {
            telReal = tRes;
          }
        }
      } catch {}
    }

    // Rate Limiter Anti-Spam
    const senderJid = participantJid || remoteJid;
    if (senderJid && mutedJids.has(senderJid)) return;
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
        } catch {}
        setTimeout(() => {
          mutedJids.delete(senderJid);
          messageTimestamps.delete(senderJid);
        }, 120000);
        return;
      }
      recentTimes.push(now);
      messageTimestamps.set(senderJid, recentTimes);
    }

    // Resolución estricta de sala(s) vinculadas: en grupos, descartar silenciosamente si no está vinculado en salas_juego
    let salasDestino = [];
    if (esGrupo) {
      salasDestino = await obtenerSalasPorGroupJid(remoteJid);
      if (salasDestino.length === 0) {
        return;
      }
    } else {
      // En DM privado, buscar sala por grupo_id del cliente
      if (telReal && supabase) {
        const suf8 = telReal.slice(-8);
        const { data: clList } = await supabase
          .from("clientes")
          .select("id, grupo_id, nombre, seudonimo, telefono, telefono_normalizado")
          .or(`whatsapp_jid.eq.${remoteJid},telefono_normalizado.eq.${telReal},telefono.ilike.%${suf8}%`)
          .limit(1);
        const clDm = clList?.[0] || null;
        if (clDm?.grupo_id) {
          const { data: salas } = await supabase
            .from("salas_juego")
            .select("*")
            .eq("grupo_id", clDm.grupo_id)
            .order("created_at", { ascending: false });
          const salaDm = salas?.find((s) => s.estado_carrera === "abierta") || salas?.[0] || null;
          if (salaDm) salasDestino = [salaDm];
        }
      }
      if (salasDestino.length === 0) {
        salasDestino = [{}];
      }
    }

    const nombreGrupoOrigen =
      salasDestino[0]?._whatsapp_group_nombre ||
      gruposCache.find((g) => g.jid === remoteJid)?.nombre ||
      null;

    // Identificación de rol de operador/admin (delegando el filtrado inteligente a /api/whatsapp-sala/procesar-unificado)
    let esOperadorMensaje = esFromMe;
    if (!esOperadorMensaje && (telReal || participantJid)) {
      try {
        esOperadorMensaje = await verificarEsOperadorAutorizado(
          salasDestino[0] || null,
          remoteJid,
          participantJid,
          telReal,
          participantAlt || null
        );
      } catch {
        esOperadorMensaje = false;
      }
    }

    console.log(
      `[Bot WhatsApp] 📩 [${remoteJid}] (${senderNombre}${esFromMe ? " [PROPIO]" : ""} / ${participantJid}): "${textoLimpio}"`
    );

    // Bot 100% Pasivo: Delegar cálculo y validación a la plataforma Next.js
    const respuestasProcesar = await Promise.all(
      salasDestino.map(async (salaDest) => {
        const payload = {
          salaId: salaDest.id || null,
          grupoId: salaDest.grupo_id || null,
          grupo_id: salaDest.grupo_id || null,
          groupJid: remoteJid,
          whatsapp_group_jid: remoteJid,
          groupNombre: salaDest._whatsapp_group_nombre || nombreGrupoOrigen,
          whatsappGroupNombre: salaDest._whatsapp_group_nombre || nombreGrupoOrigen,
          senderJid: participantJid,
          participantJid,
          participantAlt: participantAlt || null,
          telefonoReal: telReal,
          participant_phone: telReal,
          pushName: senderNombre,
          push_name: msg.pushName || senderNombre,
          senderNombre,
          esMensajePropioTelefono: esFromMe,
          esOperador: Boolean(esOperadorMensaje),
          texto: textoLimpio,
          text: textoLimpio,
          whatsappMsgId,
          whatsapp_msg_id: whatsappMsgId,
          quotedMsgId,
          quoted_msg_id: quotedMsgId,
          quotedText,
          quoted_text: quotedText,
          quotedParticipantJid,
          quoted_participant_jid: quotedParticipantJid,
        };

        try {
          const r = await fetchConReintento(`${NEXT_API_BASE}/api/whatsapp-sala/procesar-unificado`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-internal-bot-secret": INTERNAL_BOT_SECRET,
            },
            body: JSON.stringify(payload),
          });
          return r ? await r.json().catch(() => null) : null;
        } catch (err) {
          console.warn("[Bot WhatsApp] Error al procesar mensaje en API:", err?.message || err);
          return null;
        }
      })
    );

    const data = respuestasProcesar.find((r) => r && r.ok) || respuestasProcesar.find(Boolean) || null;
    if (!data) return;

    const envios = [];

    // 1. Despacho reply_public (al grupo)
    const respuestasGrupo = Array.isArray(data.respuestas_grupo) ? data.respuestas_grupo : [];
    const replyPublic =
      data.reply_public ||
      data.respuestaGrupo ||
      data.msg_publico_bot ||
      data.msg_publico ||
      data.respuestaPublica;

    if (respuestasGrupo.length > 0 && esGrupo && sock) {
      envios.push(
        (async () => {
          for (const item of respuestasGrupo) {
            if (!item || !item.texto) continue;
            await enviarMensajeGrupo(remoteJid, item.texto, item.quotedMsgId || whatsappMsgId).catch((errG) =>
              console.warn("[Bot WhatsApp] Aviso enviando respuesta múltiple de grupo:", errG?.message || errG)
            );
          }
        })()
      );
    } else if (replyPublic && esGrupo && sock) {
      envios.push(
        enviarMensajeGrupo(remoteJid, replyPublic, whatsappMsgId).catch((errG) =>
          console.warn("[Bot WhatsApp] Aviso enviando respuesta de grupo:", errG?.message || errG)
        )
      );
    }

    // 2. Despacho reply_private (al DM del jugador)
    const replyPrivate =
      data.reply_private ||
      data.mensajePrivadoAutor ||
      data.msg_privado_bot ||
      data.alertaPrivada ||
      data.msg_privado_aceptante;

    const telClienteFallback = data.clienteTelefono ? normalizarTelefono(data.clienteTelefono) : null;
    const dmDest =
      (telReal ? `${telReal}@s.whatsapp.net` : null) ||
      (telClienteFallback ? `${telClienteFallback}@s.whatsapp.net` : null) ||
      (participantJid && participantJid.endsWith("@s.whatsapp.net") ? participantJid : null) ||
      (esPrivado ? remoteJid : null);

    if (replyPrivate && dmDest && dmDest.endsWith("@s.whatsapp.net") && sock) {
      envios.push(
        enviarMensajePrivado(dmDest, replyPrivate).catch((errPriv) =>
          console.warn("[Bot WhatsApp] Aviso enviando privado autor:", errPriv?.message || errPriv)
        )
      );
    }

    // 3. Despacho mensaje proponente (si difiere del aceptante)
    const replyProponente = data.msg_privado_proponente || data.mensajePrivadoProponente;
    const propDest =
      data.proponenteJid ||
      (data.proponenteTelefono ? `${normalizarTelefono(data.proponenteTelefono)}@s.whatsapp.net` : null);

    if (replyProponente && propDest && propDest.endsWith("@s.whatsapp.net") && sock) {
      envios.push(
        enviarMensajePrivado(propDest, replyProponente).catch((errProp) =>
          console.warn("[Bot WhatsApp] Aviso enviando privado proponente:", errProp?.message || errProp)
        )
      );
    }

    // 4. Despacho notificaciones privadas adicionales
    const notifs = data.notificaciones_privadas || data.notificacionesPrivadas || [];
    if (Array.isArray(notifs) && notifs.length > 0 && sock) {
      for (const notif of notifs) {
        const txt = typeof notif === "string" ? notif : notif?.mensaje || notif?.msg || notif?.texto;
        const dest =
          typeof notif === "object"
            ? notif?.whatsapp_jid ||
              notif?.jid ||
              (notif?.telefono ? `${normalizarTelefono(notif.telefono)}@s.whatsapp.net` : null)
            : null;
        if (txt && dest && dest.endsWith("@s.whatsapp.net")) {
          envios.push(
            enviarMensajePrivado(dest, txt).catch((errN) =>
              console.warn("[Bot WhatsApp] Aviso enviando notif privada:", errN?.message || errN)
            )
          );
        }
      }
    }

    await Promise.allSettled(envios);
  } catch (err) {
    console.error("[Bot WhatsApp] Error en bot pasivo:", err?.message || err);
  }
}

// ============================================================================
// CONEXIÓN 24/7 CON @whiskeysockets/baileys
// ============================================================================

async function iniciarConexionBaileys() {
  if (conectado && sock) return;
  if (reconectando) return;
  reconectando = true;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  // Si existía un socket anterior, asegurar limpieza total de listeners y cierre del socket
  if (sock) {
    try {
      sock.ev?.removeAllListeners();
      sock.end?.(undefined);
    } catch {}
    sock = null;
  }

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
        qrRaw = qr;
        qrDataUrl = await convertirQrADataUrl(qr);
        console.log("[Bot WhatsApp] Nuevo código QR generado y listo en GET /status");
      }

      if (connection === "open") {
        conectado = true;
        reconectando = false;
        qrRaw = null;
        qrDataUrl = null;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        numeroVinculado = normalizarTelefono(sock?.user?.id) || sock?.user?.id || "Conectado";
        console.log(`[Bot WhatsApp] 🟢 Conectado exitosamente como +${numeroVinculado}`);
        await refrescarGruposParticipantes(true);
      }

      if (connection === "close") {
        conectado = false;
        const statusCode =
          lastDisconnect?.error?.output?.statusCode ||
          lastDisconnect?.error?.statusCode ||
          0;
        const fueLogout = statusCode === (DisconnectReason?.loggedOut ?? 401);

        console.warn(`[Bot WhatsApp] Conexión cerrada (código ${statusCode}). Logout: ${fueLogout}`);

        try {
          sock?.ev?.removeAllListeners();
          sock?.end?.(undefined);
        } catch {}
        sock = null;

        if (fueLogout) {
          await liberarVinculosHuerfanos();
          reconectando = false;
          numeroVinculado = null;
          qrRaw = null;
          qrDataUrl = null;
          try {
            fs.rmSync(AUTH_DIR, { recursive: true, force: true });
          } catch {
            // Ignorar
          }
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(() => {
            reconectando = false;
            iniciarConexionBaileys();
          }, 2000);
          return;
        }

        // Si statusCode === 440 (connectionReplaced), esperar 15s para no competir en loop
        const delayMs = statusCode === 440 ? 15000 : 4000;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
          reconectando = false;
          iniciarConexionBaileys();
        }, delayMs);
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
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      reconectando = false;
      iniciarConexionBaileys();
    }, 10000);
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
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-internal-bot-secret",
  });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    return responderJson(res, 200, { ok: true });
  }

  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
  const pathname = (url.pathname || "/").replace(/\/+$/, "") || "/";
  console.log(`[Bot HTTP] ${req.method} ${pathname}`);

  // Blindaje SecOps Parche 1: Secreto interno obligatorio para todas las acciones excepto status/connect/disconnect/health/root
  const esRutaPublicaLocal =
    pathname === "/" ||
    pathname === "/status" ||
    pathname === "/api/whatsapp/status" ||
    pathname === "/groups" ||
    pathname === "/api/whatsapp/groups" ||
    pathname === "/connect" ||
    pathname === "/api/whatsapp/connect" ||
    pathname === "/disconnect" ||
    pathname === "/api/whatsapp/disconnect" ||
    pathname === "/health" ||
    pathname === "/api/health";

  if (!esRutaPublicaLocal) {
    const authHeader = req.headers["x-internal-bot-secret"];
    if (!esSecretoInternoValido(authHeader)) {
      return responderJson(res, 401, {
        ok: false,
        error: "401 Unauthorized: Header x-internal-bot-secret inválido o ausente",
      });
    }
  }

  try {
    // 0. GET/POST / y /health (Sonda de salud)
    if (pathname === "/" || pathname === "/health" || pathname === "/api/health") {
      return responderJson(res, 200, {
        ok: true,
        servicio: "bot-whatsapp",
        version: "1.0.0",
        status: conectado ? "connected" : qrRaw || qrDataUrl ? "qr" : "ready",
        conectado,
        numero: numeroVinculado,
        timestamp: Date.now(),
      });
    }

    // 1. GET/POST /status y /api/whatsapp/status (Soporta ?session_id= y ?force=true o por body)
    if ((req.method === "GET" || req.method === "POST") && (pathname === "/status" || pathname === "/api/whatsapp/status")) {
      const body = req.method === "POST" ? await leerBodyJson(req).catch(() => ({})) : {};
      const sessionId = url.searchParams.get("session_id") || body?.session_id || "";
      const forzarRefresco = url.searchParams.get("force") === "true" || body?.force === true;
      if (conectado && (gruposCache.length === 0 || forzarRefresco)) {
        await refrescarGruposParticipantes();
      }

      let estadoActual = "disconnected";
      if (conectado) {
        estadoActual = "connected";
      } else if (qrRaw || qrDataUrl) {
        estadoActual = "qr";
      }

      return responderJson(res, 200, {
        ok: true,
        status: estadoActual,
        session_id: sessionId,
        qr: qrRaw || qrDataUrl,
        qrDataUrl,
        conectado,
        numero: numeroVinculado,
        numeroVinculado,
        grupos: gruposCache,
        salasDesconectadas,
      });
    }

    // 1.d GET/POST /groups y /api/whatsapp/groups (Lista de grupos con sock.groupFetchAllParticipating())
    if ((req.method === "GET" || req.method === "POST") && (pathname === "/groups" || pathname === "/api/whatsapp/groups")) {
      const grupos = await refrescarGruposParticipantes(true);
      return responderJson(res, 200, {
        ok: true,
        conectado: Boolean(conectado),
        numeroVinculado,
        grupos: (grupos || []).map((g) => ({
          jid: g.jid || g.id,
          id: g.id || g.jid,
          nombre: g.nombre || g.subject || g.id,
          subject: g.subject || g.nombre || g.id,
          participantes: g.participantes || 0,
        })),
        total: (grupos || []).length,
      });
    }

    // 1.c GET/POST /connect y /api/whatsapp/connect (Inicia conexión Baileys)
    if ((req.method === "GET" || req.method === "POST") && (pathname === "/connect" || pathname === "/api/whatsapp/connect")) {
      const body = req.method === "POST" ? await leerBodyJson(req).catch(() => ({})) : {};
      const sessionId = body?.session_id || url.searchParams.get("session_id") || "";

      if (!conectado && !sock && !reconectando) {
        iniciarConexionBaileys();
      }

      let estadoActual = "disconnected";
      if (conectado) {
        estadoActual = "connected";
      } else if (qrRaw || qrDataUrl) {
        estadoActual = "qr";
      }

      return responderJson(res, 200, {
        ok: true,
        status: estadoActual,
        session_id: sessionId,
        qr: qrRaw || qrDataUrl,
        qrDataUrl,
        conectado,
        motivo: conectado ? "Ya conectado" : "Iniciando Baileys para generar QR...",
      });
    }

    // 1.b GET/POST /ping-grupo (Medición de latencia y verificación de conexión con el grupo en vivo)
    if ((req.method === "GET" || req.method === "POST") && pathname === "/ping-grupo") {
      const body = req.method === "POST" ? await leerBodyJson(req).catch(() => ({})) : {};
      const groupJid = url.searchParams.get("groupJid") || body?.groupJid || body?.whatsapp_group_jid || null;
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

    // 1.c POST /invalidar-cache
    if (req.method === "POST" && pathname === "/invalidar-cache") {
      salasCacheMap.clear();
      return responderJson(res, 200, { ok: true, cacheInvalidado: true });
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

      if (groupJid) {
        // Regla 1 a 1: Un Grupo de WhatsApp = Una Sala
        await supabase
          .from("salas_juego")
          .update({ whatsapp_group_jid: null, whatsapp_group_nombre: null, updated_at: new Date().toISOString() })
          .eq("whatsapp_group_jid", groupJid)
          .neq("id", salaId);
      }

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
          whatsapp_group_nombre: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", salaId);

      if (error) {
        return responderJson(res, 500, { ok: false, error: error.message });
      }

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

        // Regla 1 a 1: Un Grupo de WhatsApp = Una Sala
        await supabase
          .from("salas_juego")
          .update({ whatsapp_group_jid: null, whatsapp_group_nombre: null, updated_at: new Date().toISOString() })
          .eq("whatsapp_group_jid", groupJid)
          .neq("id", salaId);

        const { error: errUpdSala } = await supabase
          .from("salas_juego")
          .update({
            whatsapp_group_jid: groupJid,
            whatsapp_group_nombre: metadata.subject,
            updated_at: new Date().toISOString(),
          })
          .eq("id", salaId);

        if (errUpdSala) {
          return responderJson(res, 500, {
            ok: false,
            motivo: errUpdSala.message || "Error guardando vinculación en Supabase",
          });
        }

        salasCacheMap.clear();
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
      if (!groupJid) {
        return responderJson(res, 400, {
          ok: false,
          motivo: "groupJid es requerido",
        });
      }

      if (salaId) {
        const { error: errDesv } = await supabase
          .from("salas_juego")
          .update({
            whatsapp_group_jid: null,
            whatsapp_group_nombre: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", salaId);
        if (errDesv) {
          return responderJson(res, 500, { ok: false, motivo: errDesv.message });
        }
      } else {
        const { error: errDesv } = await supabase
          .from("salas_juego")
          .update({
            whatsapp_group_jid: null,
            whatsapp_group_nombre: null,
            updated_at: new Date().toISOString(),
          })
          .eq("whatsapp_group_jid", groupJid);
        if (errDesv) {
          return responderJson(res, 500, { ok: false, motivo: errDesv.message });
        }
      }

      salasCacheMap.clear();
      return responderJson(res, 200, { ok: true });
    }

    // 3. POST /publicar-grupo y alias /send-group-message
    if (req.method === "POST" && (pathname === "/publicar-grupo" || pathname === "/send-group-message")) {
      const body = await leerBodyJson(req);
      const groupJid = body.groupJid || body.whatsapp_group_id || body.whatsapp_group_jid || null;
      const salaId = body.salaId || body.sala_id || null;
      const texto = body.texto || body.message || body.mensaje || "";
      const quotedMsgId = body.quotedMsgId || body.quoted_msg_id || null;

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
          const { data: salaRow } = await supabase
            .from("salas_juego")
            .select("whatsapp_group_jid, grupo_id")
            .eq("id", salaId)
            .maybeSingle();
          if (salaRow?.whatsapp_group_jid) destinos.add(salaRow.whatsapp_group_jid);
          if (salaRow?.grupo_id) {
            const { data: grpRow } = await supabase
              .from("grupos")
              .select("whatsapp_group_id")
              .eq("id", salaRow.grupo_id)
              .maybeSingle();
            if (grpRow?.whatsapp_group_id) destinos.add(grpRow.whatsapp_group_id);
          }
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

    // 6.b POST /desvincular-grupo y POST /desconectar-grupo
    if (req.method === "POST" && (pathname === "/desvincular-grupo" || pathname === "/desconectar-grupo")) {
      const body = await leerBodyJson(req);
      const groupJid = body.groupJid || body.whatsapp_group_jid || body.whatsapp_group_id || null;
      const salaId = body.salaId || body.sala_id || null;

      salasCacheMap.clear();

      if (groupJid) {
        salasDesconectadas[groupJid] = {
          desconectado_en: new Date().toISOString(),
          sala_id: salaId || null,
        };
        persistirSalasDesconectadas();
      }

      console.log(`[Bot WhatsApp] 🔌 Grupo desvinculado en demonio: ${groupJid || "todos"} (sala ${salaId || "todas"})`);
      return responderJson(res, 200, {
        ok: true,
        motivo: "Grupo desvinculado en demonio de WhatsApp",
        groupJid,
        salaId,
      });
    }

    // 6.c POST /limpiar-huerfanos
    if (req.method === "POST" && pathname === "/limpiar-huerfanos") {
      const body = await leerBodyJson(req);
      await liberarVinculosHuerfanos(body?.salaId || null);
      return responderJson(res, 200, { ok: true, motivo: "Vínculos huérfanos liberados exitosamente" });
    }

    // 7. GET/POST /disconnect y /api/whatsapp/disconnect (Cerrar sesión WhatsApp y regenerar QR)
    if ((req.method === "POST" || req.method === "GET") && (pathname === "/disconnect" || pathname === "/api/whatsapp/disconnect")) {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      reconectando = false;
      await liberarVinculosHuerfanos();

      try {
        if (sock) {
          try {
            sock.ev?.removeAllListeners();
            await sock.logout();
          } catch {
            try {
              sock.end?.(undefined);
            } catch {}
          }
        }
      } catch {}

      sock = null;
      conectado = false;
      qrRaw = null;
      qrDataUrl = null;
      numeroVinculado = null;
      gruposCache = [];

      try {
        if (fs.existsSync(AUTH_DIR)) {
          const entries = fs.readdirSync(AUTH_DIR);
          for (const entry of entries) {
            if (entry === "salas_desconectadas.json") continue;
            fs.rmSync(path.join(AUTH_DIR, entry), { recursive: true, force: true });
          }
        }
      } catch {}

      setTimeout(() => {
        try {
          reconectando = false;
          iniciarConexionBaileys();
        } catch {}
      }, 1200);

      return responderJson(res, 200, {
        ok: true,
        motivo: "Sesión de WhatsApp cerrada. Generando nuevo QR...",
      });
    }

    // 8. POST /difundir-grupos (Difusión TEXTO / IMAGEN / NOTA_VOZ a 1 o varios grupos)
    if (req.method === "POST" && pathname === "/difundir-grupos") {
      const body = await leerBodyJson(req);
      const groupJids = Array.isArray(body.groupJids) ? body.groupJids.filter(Boolean) : [];
      const tipo = String(body.tipo || "TEXTO").toUpperCase();
      const texto = String(body.texto || body.caption || "").trim();
      const mediaBase64 = String(body.mediaBase64 || "").trim();
      const mimetype = String(body.mimetype || "").trim();

      if (!sock || !conectado) {
        return responderJson(res, 200, {
          ok: false,
          motivo: "Bot desconectado de WhatsApp",
        });
      }
      if (groupJids.length === 0) {
        return responderJson(res, 400, {
          ok: false,
          motivo: "Selecciona al menos un grupo de WhatsApp",
        });
      }

      const enviados = [];
      const fallidos = [];
      let bufferMedia = null;
      if (mediaBase64) {
        const cleanB64 = mediaBase64.replace(/^data:[^;]+;base64,/, "");
        bufferMedia = Buffer.from(cleanB64, "base64");
      }

      for (const jid of groupJids) {
        try {
          let resSend = null;
          if (tipo === "IMAGEN" && bufferMedia) {
            resSend = await sock.sendMessage(jid, {
              image: bufferMedia,
              caption: texto || undefined,
              mimetype: mimetype || "image/jpeg",
            });
          } else if (tipo === "NOTA_VOZ" && bufferMedia) {
            resSend = await sock.sendMessage(jid, {
              audio: bufferMedia,
              mimetype: mimetype || "audio/ogg; codecs=opus",
              ptt: true,
            });
          } else {
            if (!texto) throw new Error("Texto requerido para difusión");
            resSend = await sock.sendMessage(jid, { text: texto });
          }
          if (resSend) registrarMensajeEnviadoPorBot(resSend);
          enviados.push(jid);
        } catch (errEnv) {
          fallidos.push({ jid, error: errEnv?.message || "Error enviando" });
        }
      }

      return responderJson(res, 200, {
        ok: enviados.length > 0,
        enviados,
        fallidos,
        motivo: `Difusión enviada a ${enviados.length}/${groupJids.length} grupo(s)`,
      });
    }

    console.warn(`[Bot HTTP 404] Ruta no encontrada: ${req.method} ${pathname}`);
    return responderJson(res, 404, {
      ok: false,
      error: "Ruta no encontrada",
      metodo: req.method,
      ruta: pathname,
    });
  } catch (err) {
    return responderJson(res, 500, {
      ok: false,
      error: err?.message || "Error interno en bot-whatsapp-server",
    });
  }
});

const HOST = "127.0.0.1";
server.listen(PORT, HOST, () => {
  console.log(
    `[Bot WhatsApp] 🚀 Demonio HTTP escuchando SOLO en http://${HOST}:${PORT} (Sesión: ${AUTH_DIR})`
  );
  iniciarConexionBaileys();
});
