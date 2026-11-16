import { NextResponse } from "next/server";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { supabaseAdmin } from "@/core/supabase-admin";
import {
  analizarYEstandarizarJugada,
  analizarBloqueJugadas,
  calcularRiesgoReal,
  evaluarMensajePedagogico,
  evaluarConcrecionEstricta,
  analizarComandoRetiro,
  evaluarAmpliacionPropuesta,
  normalizarParadaPremio,
  extraerMontoNumerico,
} from "@/features/sala-juegos/lib/parser-pedagogico";
import { formatearMontoRegional } from "@/shared/lib/dinero";
import { sincronizarTicketsPropuestaATaquilla } from "@/features/whatsapp-sala/lib/sincronizar-tickets-sala";

export const dynamic = "force-dynamic";

function sanitizarTexto(str: unknown): string {
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

function normalizarTelefonoCompleto(codigoPais?: string | null, telefono?: string | null): string {
  const cp = String(codigoPais || "").replace(/\D/g, "");
  const tel = String(telefono || "").replace(/\D/g, "").replace(/^0+/, "");
  if (!tel) return cp;
  if (!cp) return tel;
  if (tel.startsWith(cp)) return tel;
  return `${cp}${tel}`;
}

const BOT_DAEMON_URL = process.env.WHATSAPP_BOT_URL || "http://127.0.0.1:3005";
const INTERNAL_BOT_SECRET = process.env.INTERNAL_BOT_SECRET || "SH-BOT-SECRET-2026";

// Cierre VULN-15: Set en memoria de los últimos 1000 whatsappMsgId (por sala) para descartar reintentos en < 1ms
const ultimosWhatsappMsgIds = new Set<string>();
function esWhatsappMsgIdDuplicado(msgId?: string | null, salaId?: string | null): boolean {
  if (!msgId) return false;
  const key = salaId ? `${msgId}:${salaId}` : msgId;
  if (ultimosWhatsappMsgIds.has(key)) return true;
  ultimosWhatsappMsgIds.add(key);
  if (ultimosWhatsappMsgIds.size > 1000) {
    const primer = ultimosWhatsappMsgIds.values().next().value;
    if (primer) ultimosWhatsappMsgIds.delete(primer);
  }
  return false;
}

// Respaldo de grupos desconectados. Usa el MISMO archivo que el demonio Baileys
// (AUTH_DIR/salas_desconectadas.json) para que ambos vean lo mismo tras un
// reinicio, aunque el demonio esté caído en el momento de desconectar.
const AUTH_DIR_WHATSAPP =
  process.env.WHATSAPP_AUTH_DIR ||
  (process.platform === "linux"
    ? "/root/sistema_hipico/whatsapp_auth"
    : path.join(process.cwd(), "whatsapp_auth"));
const ARCHIVO_SALAS_DESCONECTADAS = path.join(AUTH_DIR_WHATSAPP, "salas_desconectadas.json");

type RespaldoSalaDesconectada = {
  groupJid?: string | null;
  groupNombre?: string | null;
  desconectadoEn?: string;
};

function leerRespaldoDesconectadas(): Record<string, RespaldoSalaDesconectada> {
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

function escribirRespaldoDesconectadas(
  datos: Record<string, RespaldoSalaDesconectada>
): void {
  try {
    fs.mkdirSync(AUTH_DIR_WHATSAPP, { recursive: true });
    fs.writeFileSync(
      ARCHIVO_SALAS_DESCONECTADAS,
      JSON.stringify(datos, null, 2),
      "utf8"
    );
  } catch {
    // El respaldo en disco es best-effort; no debe romper la acción.
  }
}

// Mutex FIFO en memoria por propuesta para garantizar ejecución secuencial (1 a la vez: Caso 90 + 10 = 100)
const colasConcrecionFifo = new Map<string, Promise<any>>();

function encolarConcrecionSecuencial<T>(propuestaId: string, tarea: () => Promise<T>): Promise<T> {
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

function normalizarTelefono(raw?: string | null): string {
  if (!raw) return "";
  return String(raw)
    .replace(/@.*$/, "")
    .replace(/:.*$/, "")
    .replace(/[^0-9]/g, "");
}

function calcularSaldoDisponible(cliente: any): number {
  if (!cliente) return 0;
  if (cliente.libre) return 999999;
  const saldo = Number(cliente.saldo_actual ?? 0);
  const aval = Number(cliente.aval ?? cliente.limite_credito ?? 0);
  const retenido = Number(cliente.saldo_retenido ?? 0);
  const dispCalculado = Math.max(0, Number((saldo + aval - retenido).toFixed(2)));
  const dispDb = Number(cliente.saldo_disponible ?? 0);
  return Math.max(dispCalculado, dispDb);
}

async function emitirBroadcastSala(salaId: string, evento: string, payload: any) {
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
          { topic: `realtime:sala:${salaId}`, event: evento, payload },
          { topic: `realtime:sala-${salaId}`, event: evento, payload },
        ],
      }),
    }).catch(() => {});
  } catch {
    // No bloqueante
  }
}

async function construirResumenEstadoCuentaCliente(cliente: any, grupoId: string): Promise<string> {
  const nombreJugador = cliente.seudonimo || cliente.nombre || "Jugador";
  const saldoActual = Number(cliente.saldo_actual || 0);
  const aval = Number(cliente.aval || cliente.limite_credito || 0);
  const retenido = Number(cliente.saldo_retenido || 0);
  const disponible = cliente.libre ? 999999 : Math.max(0, Number((saldoActual + aval - retenido).toFixed(2)));

  const hoyStr = new Date().toISOString().split("T")[0];
  const inicioDia = `${hoyStr}T00:00:00.000Z`;

  const { data: ticketsHoy } = await supabaseAdmin
    .from("chat_tickets_fifo")
    .select("*")
    .eq("grupo_id", grupoId)
    .or(`proponente_id.eq.${cliente.id},aceptante_id.eq.${cliente.id}`)
    .gte("created_at", inicioDia);

  const lista = ticketsHoy || [];
  let ganadas = 0;
  let perdidas = 0;
  let empatadas = 0;
  let netoDia = 0;
  let vivasRiesgo = 0;
  let montoEnRiesgo = 0;

  for (const t of lista) {
    const estado = String(t.estado || "").toUpperCase();
    const esProponente = String(t.proponente_id) === String(cliente.id);
    const monto = Number(t.monto_concretado || 0);

    if (["PENDIENTE", "ACTIVO", "ABIERTO"].includes(estado)) {
      vivasRiesgo++;
      montoEnRiesgo += monto;
    } else if (estado === "GANADOR_PROPONENTE") {
      if (esProponente) {
        ganadas++;
        netoDia += monto;
      } else {
        perdidas++;
        netoDia -= monto;
      }
    } else if (estado === "GANADOR_ACEPTANTE") {
      if (!esProponente) {
        ganadas++;
        netoDia += monto;
      } else {
        perdidas++;
        netoDia -= monto;
      }
    } else if (estado === "EMPATE") {
      empatadas++;
    }
  }

  netoDia = Number(netoDia.toFixed(2));
  const signoNeto = netoDia >= 0 ? `+$${formatearMontoRegional(netoDia)}` : `-$${formatearMontoRegional(Math.abs(netoDia))}`;

  return (
    `💰 *ESTADO DE CUENTA ACTUAL*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 *Jugador:* ${nombreJugador}\n` +
    `💵 *Saldo Actual:* $${formatearMontoRegional(saldoActual)}\n` +
    `🛡️ *Aval / Crédito:* $${formatearMontoRegional(aval)}\n` +
    `⏳ *Retenido:* $${formatearMontoRegional(retenido)}\n` +
    `🟢 *Saldo Disponible:* $${formatearMontoRegional(disponible)}\n\n` +
    `📊 *RESUMEN DE OPERACIONES DEL DÍA*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🎯 *Jugadas Casadas Hoy:* ${lista.length}\n` +
    `🏆 *Ganadas:* ${ganadas}\n` +
    `❌ *Perdidas:* ${perdidas}\n` +
    `🤝 *Empatadas:* ${empatadas}\n` +
    `⚖️ *Neto del Día:* ${signoNeto}\n` +
    `⚠️ *Jugadas Vivas en Riesgo:* ${vivasRiesgo} ($${formatearMontoRegional(montoEnRiesgo)})`
  );
}

async function verificarEsOperador(clienteId?: string | null, telefono?: string | null, grupoId?: string | null): Promise<boolean> {
  if (!telefono && !clienteId) return false;
  try {
    if (telefono) {
      const telClean = String(telefono).replace(/\D/g, "");
      const sufijo8 = telClean.slice(-8);
      const { data: usuario } = await supabaseAdmin
        .from("usuario_sistema")
        .select("id, activo, es_principal, grupo_id")
        .ilike("telefono", `%${sufijo8}%`)
        .limit(1)
        .maybeSingle();
      if (usuario && usuario.activo !== false) {
        if (usuario.es_principal) return true;
        if (grupoId && String(usuario.grupo_id) === String(grupoId)) return true;
      }
    }
  } catch {}
  return false;
}

async function intentarCruceAutomatico(params: {
  sala: any;
  grupoId: string;
  nuevaPropuestaId: string;
  nuevoCliente: any;
  analisis: any;
  groupJid?: string | null;
  whatsappGroupNombre?: string | null;
  whatsappMsgId?: string | null;
}) {
  const { sala, grupoId, nuevaPropuestaId, nuevoCliente, analisis, groupJid, whatsappGroupNombre, whatsappMsgId } = params;

  let queryInversas = supabaseAdmin
    .from("chat_mensajes")
    .select("*")
    .eq("sala_id", sala.id)
    .in("tipo_mensaje", ["propuesta_jugada", "PROPUESTA"])
    .in("estado_propuesta", ["abierta", "parcial"])
    .gt("monto_disponible", 0)
    .neq("remitente_id", nuevoCliente.id)
    .neq("id", nuevaPropuestaId)
    .order("created_at", { ascending: true })
    .limit(10);

  if (sala.carrera_activa_id) {
    queryInversas = queryInversas.or(`carrera_id.eq.${sala.carrera_activa_id},carrera_id.is.null`);
  }

  const { data: candidatas } = await queryInversas;
  if (!candidatas || candidatas.length === 0) return null;

  for (const cand of candidatas) {
    const candAccion = String(cand.accion_proponente || "").toUpperCase();
    const nuevaAccion = String(analisis.accionProponente || "").toUpperCase();
    let esCalce = false;

    if (analisis.esMatch && cand.es_match) {
      const candA = (cand.caballos_bando_a || []).join("-");
      const candB = (cand.caballos_bando_b || []).join("-");
      const nuevoA = (analisis.caballosBandoA || []).join("-");
      const nuevoB = (analisis.caballosBandoB || []).join("-");

      if (candA === nuevoB && candB === nuevoA && candAccion === nuevaAccion) {
        esCalce = true;
      } else if (candA === nuevoA && candB === nuevoB && candAccion !== nuevaAccion) {
        esCalce = true;
      }
    } else if (!analisis.esMatch && !cand.es_match) {
      const modCand = String(cand.modalidad_propuesta || cand.modalidad || "1P").toUpperCase();
      const modNueva = String(analisis.modalidad || "1P").toUpperCase();
      const ejCand = String(cand.ejemplar_texto || (cand.caballos_bando_a || [])[0] || "").trim();
      const ejNuevo = String(analisis.ejemplarTexto || (analisis.caballosBandoA || [])[0] || "").trim();

      if (modCand === modNueva && ejCand === ejNuevo && candAccion !== nuevaAccion) {
        esCalce = true;
      }
    }

    if (esCalce) {
      const montoDisponibleCand = Number(cand.monto_disponible || 0);
      const montoNuevo = Number(analisis.montoDisponibleValido || analisis.monto || 0);
      const montoACruzar = Math.min(montoDisponibleCand, montoNuevo);

      if (montoACruzar <= 0) continue;

      const { data: resCruce, error: errCruce } = await supabaseAdmin.rpc("concretar_jugada_fifo_atomica", {
        p_grupo_id: grupoId,
        p_sala_id: sala.id,
        p_propuesta_msg_id: cand.id,
        p_aceptante_id: nuevoCliente.id,
        p_monto_pedido: montoACruzar,
      });

      if (!errCruce && resCruce && (resCruce as any).ok !== false && !(resCruce as any).nada_aqui) {
        await sincronizarTicketsPropuestaATaquilla(supabaseAdmin, {
          propuestaMsgId: cand.id,
          sala,
          grupoId,
          condicionProponente: cand.condicion_proponente,
        });

        const nuevoRemanenteNueva = Math.max(0, montoNuevo - montoACruzar);
        await supabaseAdmin
          .from("chat_mensajes")
          .update({
            monto_disponible: nuevoRemanenteNueva,
            estado_propuesta: nuevoRemanenteNueva <= 0 ? "agotada" : "parcial",
          })
          .eq("id", nuevaPropuestaId);

        let nombreJuega = "";
        let nombreDa = "";
        if (candAccion === "CONSIGUE") {
          nombreDa = cand.remitente_nombre || "Proponente";
          nombreJuega = nuevoCliente.seudonimo || nuevoCliente.nombre;
        } else {
          nombreJuega = cand.remitente_nombre || "Proponente";
          nombreDa = nuevoCliente.seudonimo || nuevoCliente.nombre;
        }

        let modCab = "";
        if (cand.es_match) {
          const bA = (cand.caballos_bando_a || []).join("-");
          const bB = (cand.caballos_bando_b || []).join("-");
          modCab = `Match (${bA}x${bB})`;
        } else {
          const m = cand.modalidad_propuesta || cand.modalidad || "1P";
          const e = cand.ejemplar_texto || (cand.caballos_bando_a || [])[0] || "";
          modCab = `${m} (${e})`.trim();
        }

        let pRaw = String(cand.proporcion_premio || cand.proporcion || "1x1").trim();
        pRaw = pRaw.replace(/\/>/g, "a").replace(/\//g, "a").replace(/@/g, "a");
        const pTexto = pRaw && pRaw !== "1x1" && pRaw !== "10a10" ? `[${pRaw}] ` : "";

        const rJuega = Math.round(calcularRiesgoReal(montoACruzar, cand.proporcion_premio || cand.proporcion, "JUEGA") * 100) / 100;
        const rDa = Math.round(calcularRiesgoReal(montoACruzar, cand.proporcion_premio || cand.proporcion, "CONSIGUE") * 100) / 100;

        const montoBaseFmt = Number(montoACruzar).toFixed(montoACruzar % 1 === 0 ? 0 : 2);
        const rJuegaFmt = rJuega.toFixed(2);
        const rDaFmt = rDa.toFixed(2);

        const msgCruce =
          `✅ Jugaron: *${nombreJuega} Juega ${modCab} ${pTexto}da ${nombreDa} $${montoBaseFmt}*\n` +
          `🔹 Juega: ${nombreJuega} (Riesgo $${rJuegaFmt})\n` +
          `🔸 Da: ${nombreDa} (Riesgo $${rDaFmt})`;

        await supabaseAdmin.from("chat_mensajes").insert({
          grupo_id: grupoId,
          sala_id: sala.id,
          remitente_id: nuevoCliente.id,
          remitente_nombre: nuevoCliente.seudonimo || nuevoCliente.nombre,
          es_operador: false,
          tipo_mensaje: "CONCRECION",
          contenido: msgCruce,
          reply_to_msg_id: cand.id,
          whatsapp_msg_id: whatsappMsgId || null,
          whatsapp_group_jid: groupJid || null,
          whatsapp_group_nombre: whatsappGroupNombre || null,
          origen_canal: "WHATSAPP",
          carrera_id: cand.carrera_id || sala.carrera_activa_id,
        });

        await emitirBroadcastSala(sala.id, "nuevo_mensaje", { salaId: sala.id });

        if (groupJid) {
          try {
            await fetch(`${BOT_DAEMON_URL}/publicar-grupo`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-internal-bot-secret": INTERNAL_BOT_SECRET,
              },
              body: JSON.stringify({
                groupJid,
                texto: msgCruce,
              }),
            });
          } catch {}
        }

        return {
          cruzado: true,
          montoCruzado: montoACruzar,
          msgCruce,
        };
      }
    }
  }

  return null;
}

async function asegurarDosSalasPrincipales() {
  const { data: salasExistentes } = await supabaseAdmin
    .from("salas_juego")
    .select("*")
    .eq("activa", true)
    .order("orden_sala", { ascending: true });

  const { data: gruposSistema } = await supabaseAdmin
    .from("grupos_venta")
    .select("id, nombre");
  const grupoNombrePorId = new Map<string, string>();
  for (const g of gruposSistema || []) {
    if (g?.id) grupoNombrePorId.set(String(g.id), String(g.nombre || ""));
  }

  if (salasExistentes && salasExistentes.length > 0) {
    return salasExistentes.map((s: any) => ({
      ...s,
      grupo_nombre: grupoNombrePorId.get(String(s.grupo_id)) || null,
    }));
  }

  let { data: grupoPrincipal } = await supabaseAdmin
    .from("grupos_venta")
    .select("id, nombre")
    .eq("activo", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!grupoPrincipal) {
    const { data: creado } = await supabaseAdmin
      .from("grupos_venta")
      .insert({
        nombre: "Grupo Oficial",
        slug: "oficial",
        activo: true,
        permite_cruces: true,
        comision_default: 5,
        moneda: "USD",
      })
      .select("id, nombre")
      .single();
    grupoPrincipal = creado;
  }

  const grupoId = grupoPrincipal?.id || "default";

  if (!salasExistentes || salasExistentes.length === 0) {
    await supabaseAdmin.from("salas_juego").insert([
      {
        grupo_id: grupoId,
        nombre_sala: "Sala 1 - Nacionales",
        orden_sala: 1,
        activa: true,
        estado_carrera: "abierta",
        hipodromo_activo: "LA RINCONADA",
        numero_carrera_activa: 1,
      },
      {
        grupo_id: grupoId,
        nombre_sala: "Sala 2 - Americanas",
        orden_sala: 2,
        activa: true,
        estado_carrera: "abierta",
        hipodromo_activo: "GULFSTREAM PARK",
        numero_carrera_activa: 1,
      },
    ]);
  } else if (salasExistentes.length === 1) {
    await supabaseAdmin.from("salas_juego").insert({
      grupo_id: salasExistentes[0].grupo_id || grupoId,
      nombre_sala: "Sala 2 - Americanas",
      orden_sala: 2,
      activa: true,
      estado_carrera: "abierta",
      hipodromo_activo: "GULFSTREAM PARK",
      numero_carrera_activa: 1,
    });
  }

  const { data: salasFinales } = await supabaseAdmin
    .from("salas_juego")
    .select("*")
    .eq("activa", true)
    .order("orden_sala", { ascending: true })
    .limit(2);

  return salasFinales || [];
}

// ============================================================================
// GET: Estado del Demonio Baileys + Salas Activas
// ============================================================================
export async function GET(req: Request) {
  let estadoBot = {
    conectado: false,
    qrDataUrl: null as string | null,
    numeroVinculado: null as string | null,
    grupos: [] as Array<{ jid: string; nombre: string }>,
    daemonOnline: false,
    salasDesconectadas: {} as Record<string, RespaldoSalaDesconectada>,
  };

  const url = new URL(req.url);
  const forzar = url.searchParams.get("force") === "true";

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(`${BOT_DAEMON_URL}/status${forzar ? "?force=true" : ""}`, {
      cache: "no-store",
      headers: { "x-internal-bot-secret": INTERNAL_BOT_SECRET },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.ok) {
      const json = await res.json();
      estadoBot = {
        conectado: Boolean(json.conectado),
        qrDataUrl: json.qrDataUrl || null,
        numeroVinculado: json.numeroVinculado || null,
        grupos: Array.isArray(json.grupos) ? json.grupos : [],
        daemonOnline: true,
        salasDesconectadas:
          json.salasDesconectadas &&
          typeof json.salasDesconectadas === "object" &&
          !Array.isArray(json.salasDesconectadas)
            ? json.salasDesconectadas
            : {},
      };
    }
  } catch {
    // Si el demonio local en :3005 aún no está encendido, responder estado desconectado limpio
  }

  // El respaldo en disco es la fuente más confiable (sobrevive a reinicios y a
  // que el demonio esté apagado). Se fusiona con lo que reporte el demonio.
  const respaldoDisco = leerRespaldoDesconectadas();
  estadoBot.salasDesconectadas = {
    ...respaldoDisco,
    ...estadoBot.salasDesconectadas,
  };

  let salas: any[] = [];
  try {
    salas = await asegurarDosSalasPrincipales();
  } catch {
    salas = [];
  }

  // Enriquecer cada grupo de WhatsApp con su estado de conexión real a la plataforma
  let gruposEnriquecidos = estadoBot.grupos;
  try {
    const { data: vinculosActivos } = await supabaseAdmin
      .from("salas_whatsapp_grupos")
      .select("whatsapp_group_jid, whatsapp_group_nombre, sala_id, grupo_id, estado_conexion")
      .eq("activo", true);

    const { data: todasSalas } = await supabaseAdmin
      .from("salas_juego")
      .select("id, nombre_sala, grupo_id, whatsapp_group_jid")
      .eq("activa", true);

    const { data: gruposVenta } = await supabaseAdmin
      .from("grupos_venta")
      .select("id, nombre");

    const grupoNombreMap = new Map<string, string>();
    for (const g of gruposVenta || []) {
      if (g?.id) grupoNombreMap.set(String(g.id), String(g.nombre || ""));
    }

    const salaInfoMap = new Map<string, { id: string; nombre_sala: string; grupo_id: string; grupo_nombre: string }>();
    for (const s of todasSalas || []) {
      salaInfoMap.set(String(s.id), {
        id: String(s.id),
        nombre_sala: String(s.nombre_sala || ""),
        grupo_id: String(s.grupo_id || ""),
        grupo_nombre: grupoNombreMap.get(String(s.grupo_id)) || "",
      });
    }

    gruposEnriquecidos = (estadoBot.grupos || []).map((g) => {
      const vinc = (vinculosActivos || []).find((v: any) => v.whatsapp_group_jid === g.jid);
      let sInfo = vinc ? salaInfoMap.get(String(vinc.sala_id)) : null;

      // Respaldo de compatibilidad con salas_juego.whatsapp_group_jid directo
      if (!sInfo) {
        const sDirecta = (todasSalas || []).find((s: any) => s.whatsapp_group_jid === g.jid);
        if (sDirecta) {
          sInfo = salaInfoMap.get(String(sDirecta.id)) || null;
        }
      }

      const estaConectado = Boolean(sInfo);

      return {
        ...g,
        conectado: estaConectado,
        salaId: sInfo?.id || null,
        salaNombre: sInfo?.nombre_sala || null,
        grupoId: sInfo?.grupo_id || null,
        grupoNombre: sInfo?.grupo_nombre || null,
        estadoConexion: vinc?.estado_conexion || (estaConectado ? "conectado" : "desconectado"),
      };
    });

    const vinculosPorSalaId = new Map<string, any[]>();
    for (const v of vinculosActivos || []) {
      const sId = String(v.sala_id);
      if (!vinculosPorSalaId.has(sId)) vinculosPorSalaId.set(sId, []);
      vinculosPorSalaId.get(sId)!.push(v);
    }

    salas = (salas || []).map((s: any) => {
      const sVinculos = vinculosPorSalaId.get(String(s.id)) || [];
      const primerV = sVinculos[0];
      return {
        ...s,
        grupos_whatsapp: sVinculos,
        whatsapp_group_jid: s.whatsapp_group_jid || primerV?.whatsapp_group_jid || null,
        whatsapp_group_nombre: s.whatsapp_group_nombre || primerV?.whatsapp_group_nombre || null,
      };
    });
  } catch {
    // Si falla el enriquecimiento, conservar grupos originales
  }

  const metricasGrupos = {
    total: gruposEnriquecidos.length,
    conectados: gruposEnriquecidos.filter((g: any) => g.conectado).length,
    desconectados: gruposEnriquecidos.filter((g: any) => !g.conectado).length,
  };

  return NextResponse.json({
    ok: true,
    ...estadoBot,
    grupos: gruposEnriquecidos,
    metricasGrupos,
    salas,
  });
}

// ============================================================================
// POST: Procesamiento en vivo de Jugadas, Concreciones y Acciones de Sala
// ============================================================================
export async function POST(req: Request) {
  const _origin = req.headers.get("origin");
  const _host = req.headers.get("host");
  if (_origin && !_origin.includes(_host || "")) {
    return NextResponse.json({ error: "CSRF bloqueado" }, { status: 403 });
  }
  try {
    // Blindaje SecOps Parche 1: Header de secreto interno estricto
    const authHeader = req.headers.get("x-internal-bot-secret");
    if (authHeader !== INTERNAL_BOT_SECRET) {
      return NextResponse.json(
        {
          ok: false,
          error: "401 Unauthorized: Solicitud no autorizada. Header x-internal-bot-secret requerido.",
          respuestaGrupo: null,
          mensajePrivadoAutor: null,
        },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => ({}));

    // Sanitización estricta Anti-XSS: descartar etiquetas, SQL y caracteres de control
    if (typeof body.pushName === "string") {
      body.pushName = sanitizarTexto(body.pushName) || "Usuario";
    }
    if (typeof body.senderNombre === "string") {
      body.senderNombre = sanitizarTexto(body.senderNombre) || "Usuario";
    }
    if (typeof body.texto === "string") {
      body.texto = normalizarParadaPremio(sanitizarTexto(body.texto));
    }

    // Cierre VULN-15: Descartar reintentos en < 1ms por idempotencia de whatsappMsgId
    if (body.whatsappMsgId && esWhatsappMsgIdDuplicado(body.whatsappMsgId, body.salaId)) {
      return NextResponse.json({
        ok: true,
        tipo: "REINTENTO_DESCARTADO",
        idempotente: true,
        respuestaGrupo: null,
        mensajePrivadoAutor: null,
      });
    }

    // ------------------------------------------------------------------------
    // ACCIONES ADMINISTRATIVAS DESDE LA PANTALLA /whatsapp
    // ------------------------------------------------------------------------
    if (body.accion === "abrir-carrera") {
      const { salaId, hipodromo, carrera } = body;
      if (!salaId) {
        return NextResponse.json({ ok: false, error: "salaId es requerido" }, { status: 400 });
      }

      const hipoLimpio = String(hipodromo || "LA RINCONADA").toUpperCase().trim();
      const numCarrera = parseInt(carrera, 10) || 1;
      const ord = numCarrera === 1 ? "1ra" : numCarrera === 2 ? "2da" : numCarrera === 3 ? "3ra" : `${numCarrera}ta`;

      const { data: salaActualizada, error } = await supabaseAdmin
        .from("salas_juego")
        .update({
          hipodromo_activo: hipoLimpio,
          numero_carrera_activa: numCarrera,
          estado_carrera: "abierta",
          updated_at: new Date().toISOString(),
        })
        .eq("id", salaId)
        .select()
        .maybeSingle();

      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }

      const textoApertura = `🏆🏇${hipoLimpio}, ${ord} Carrera🏆🏇\nCARRERA ABIERTA Y EN JUEGO\nMucha suerte a todos.`;

      let enviadoWhatsApp = false;
      if (salaActualizada?.whatsapp_group_jid) {
        try {
          const rBot = await fetch(`${BOT_DAEMON_URL}/publicar-grupo`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-internal-bot-secret": INTERNAL_BOT_SECRET,
            },
            body: JSON.stringify({
              groupJid: salaActualizada.whatsapp_group_jid,
              texto: textoApertura,
            }),
          });
          enviadoWhatsApp = rBot.ok;
        } catch {
          enviadoWhatsApp = false;
        }
      }

      await emitirBroadcastSala(salaId, "carrera_abierta", {
        salaId,
        hipodromo: hipoLimpio,
        carrera: numCarrera,
      });

      return NextResponse.json({
        ok: true,
        sala: salaActualizada,
        textoApertura,
        enviadoWhatsApp,
      });
    }

    if (body.accion === "cerrar-carrera") {
      const { salaId } = body;
      if (!salaId) {
        return NextResponse.json({ ok: false, error: "salaId es requerido" }, { status: 400 });
      }

      const { data: salaPrevia } = await supabaseAdmin
        .from("salas_juego")
        .select("*")
        .eq("id", salaId)
        .maybeSingle();

      const { data: salaActualizada, error } = await supabaseAdmin
        .from("salas_juego")
        .update({
          estado_carrera: "cerrada",
          carrera_recien_cerrada_id: salaPrevia?.carrera_activa_id || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", salaId)
        .select()
        .maybeSingle();

      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }

      const hipo = String(salaActualizada?.hipodromo_activo || "HIPÓDROMO").toUpperCase();
      const numCarrera = salaActualizada?.numero_carrera_activa || 1;
      const ord = numCarrera === 1 ? "1ra" : numCarrera === 2 ? "2da" : numCarrera === 3 ? "3ra" : `${numCarrera}ta`;
      const textoCierre = `${hipo}, ${ord} Carrera\nCARRERA CERRADA\n\nPUEDE ESCRIBIR LA PIZARRA: LLEGADA: 1RO.2DO.3RO.4TO.5TO`;

      let enviadoWhatsApp = false;
      if (salaActualizada?.whatsapp_group_jid) {
        try {
          const rBot = await fetch(`${BOT_DAEMON_URL}/publicar-grupo`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-internal-bot-secret": INTERNAL_BOT_SECRET,
            },
            body: JSON.stringify({
              groupJid: salaActualizada.whatsapp_group_jid,
              texto: textoCierre,
            }),
          });
          enviadoWhatsApp = rBot.ok;
        } catch {
          enviadoWhatsApp = false;
        }
      }

      await emitirBroadcastSala(salaId, "carrera_cerrada", { salaId });

      return NextResponse.json({
        ok: true,
        sala: salaActualizada,
        textoCierre,
        enviadoWhatsApp,
      });
    }

    if (body.accion === "vincular-sala") {
      const { salaId, groupJid, groupNombre } = body;
      if (!salaId) {
        return NextResponse.json({ ok: false, error: "salaId es requerido" }, { status: 400 });
      }

      const updatePayload: Record<string, any> = {
        whatsapp_group_jid: groupJid || null,
        updated_at: new Date().toISOString(),
      };
      if (!groupJid) {
        updatePayload.whatsapp_group_nombre = null;
      } else if (groupNombre) {
        updatePayload.whatsapp_group_nombre = groupNombre;
      }

      const { data: salaActualizada, error } = await supabaseAdmin
        .from("salas_juego")
        .update(updatePayload)
        .eq("id", salaId)
        .select()
        .maybeSingle();

      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }

      // Notificar también al demonio local en :3005 si está activo
      try {
        await fetch(`${BOT_DAEMON_URL}/vincular-sala`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-bot-secret": INTERNAL_BOT_SECRET,
          },
          body: JSON.stringify({ salaId, groupJid, groupNombre }),
        });
      } catch {
        // Demonio offline, pero ya quedó guardado en Supabase
      }

      // Al vincular manualmente ya no hay nada que reconectar.
      const respaldo = leerRespaldoDesconectadas();
      if (respaldo[salaId]) {
        delete respaldo[salaId];
        escribirRespaldoDesconectadas(respaldo);
      }

      return NextResponse.json({
        ok: true,
        sala: salaActualizada,
        groupJid: groupJid || null,
        groupNombre: groupNombre || null,
      });
    }

    // ------------------------------------------------------------------------
    // DESCONECTAR SALA: guarda el grupo en el respaldo y deja la sala sin JID
    // ------------------------------------------------------------------------
    if (body.accion === "desconectar-sala") {
      const { salaId } = body;
      if (!salaId) {
        return NextResponse.json({ ok: false, error: "salaId es requerido" }, { status: 400 });
      }

      let groupJid: string | null = null;
      let groupNombre: string | null = null;

      // 1) Intentar con el demonio (guarda el respaldo junto a la sesión Baileys)
      try {
        const rBot = await fetch(`${BOT_DAEMON_URL}/desconectar-sala`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-bot-secret": INTERNAL_BOT_SECRET,
          },
          body: JSON.stringify({ salaId }),
        });
        const json = await rBot.json().catch(() => ({}));
        if (rBot.ok && json?.ok) {
          return NextResponse.json({
            ok: true,
            salaId,
            desconectado: true,
            puedeReconectar: Boolean(json.puedeReconectar),
            groupJid: json.groupJid || null,
            groupNombre: json.groupNombre || null,
            viaDaemon: true,
          });
        }
        groupJid = json?.groupJid || null;
        groupNombre = json?.groupNombre || null;
      } catch {
        // Demonio offline: se resuelve directo contra Supabase + respaldo en disco
      }

      // 2) Fallback directo contra Supabase
      const { data: sala, error: errorLectura } = await supabaseAdmin
        .from("salas_juego")
        .select("id, whatsapp_group_jid, whatsapp_group_nombre")
        .eq("id", salaId)
        .maybeSingle();

      if (errorLectura) {
        return NextResponse.json({ ok: false, error: errorLectura.message }, { status: 500 });
      }
      if (!sala) {
        return NextResponse.json({ ok: false, error: "Sala no encontrada" }, { status: 404 });
      }

      const respaldoActual = leerRespaldoDesconectadas();
      const jidRespaldo = groupJid || sala.whatsapp_group_jid || respaldoActual[salaId]?.groupJid || null;
      const nombreRespaldo =
        groupNombre || sala.whatsapp_group_nombre || respaldoActual[salaId]?.groupNombre || null;

      if (jidRespaldo) {
        respaldoActual[salaId] = {
          groupJid: jidRespaldo,
          groupNombre: nombreRespaldo,
          desconectadoEn: new Date().toISOString(),
        };
        escribirRespaldoDesconectadas(respaldoActual);
      }

      const { error } = await supabaseAdmin
        .from("salas_juego")
        .update({
          whatsapp_group_jid: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", salaId);

      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }

      return NextResponse.json({
        ok: true,
        salaId,
        desconectado: true,
        puedeReconectar: Boolean(jidRespaldo),
        groupJid: jidRespaldo,
        groupNombre: nombreRespaldo,
        viaDaemon: false,
      });
    }

    // ------------------------------------------------------------------------
    // RECONECTAR SALA: restaura el grupo guardado (o el que envíe la UI)
    // ------------------------------------------------------------------------
    if (body.accion === "reconectar-sala") {
      const { salaId, groupJid, groupNombre } = body;
      if (!salaId) {
        return NextResponse.json({ ok: false, error: "salaId es requerido" }, { status: 400 });
      }

      // 1) Intentar con el demonio
      try {
        const rBot = await fetch(`${BOT_DAEMON_URL}/reconectar-sala`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-bot-secret": INTERNAL_BOT_SECRET,
          },
          body: JSON.stringify({ salaId, groupJid, groupNombre }),
        });
        const json = await rBot.json().catch(() => ({}));
        if (rBot.ok && json?.ok) {
          return NextResponse.json({
            ok: true,
            salaId,
            reconectado: true,
            groupJid: json.groupJid || null,
            groupNombre: json.groupNombre || null,
            viaDaemon: true,
          });
        }
      } catch {
        // Demonio offline: se resuelve directo contra Supabase + respaldo en disco
      }

      // 2) Fallback directo contra Supabase
      const { data: sala, error: errorLectura } = await supabaseAdmin
        .from("salas_juego")
        .select("id, whatsapp_group_jid, whatsapp_group_nombre")
        .eq("id", salaId)
        .maybeSingle();

      if (errorLectura) {
        return NextResponse.json({ ok: false, error: errorLectura.message }, { status: 500 });
      }
      if (!sala) {
        return NextResponse.json({ ok: false, error: "Sala no encontrada" }, { status: 404 });
      }

      const respaldoActual = leerRespaldoDesconectadas();
      const respaldoSala = respaldoActual[salaId] || {};
      const jidFinal =
        groupJid || sala.whatsapp_group_jid || respaldoSala.groupJid || null;
      const nombreFinal =
        groupNombre || sala.whatsapp_group_nombre || respaldoSala.groupNombre || null;

      if (!jidFinal) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "No hay un grupo de WhatsApp guardado para esta sala. Vincúlala de nuevo desde el selector.",
          },
          { status: 400 }
        );
      }

      const { error } = await supabaseAdmin
        .from("salas_juego")
        .update({
          whatsapp_group_jid: jidFinal,
          whatsapp_group_nombre: nombreFinal,
          updated_at: new Date().toISOString(),
        })
        .eq("id", salaId);

      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }

      if (respaldoActual[salaId]) {
        delete respaldoActual[salaId];
        escribirRespaldoDesconectadas(respaldoActual);
      }

      return NextResponse.json({
        ok: true,
        salaId,
        reconectado: true,
        groupJid: jidFinal,
        groupNombre: nombreFinal,
        viaDaemon: false,
      });
    }

    if (body.accion === "ping-grupo") {
      const { groupJid } = body;
      if (!groupJid) {
        return NextResponse.json({ ok: false, error: "groupJid es requerido" }, { status: 400 });
      }

      try {
        const rBot = await fetch(`${BOT_DAEMON_URL}/ping-grupo?groupJid=${encodeURIComponent(groupJid)}`, {
          method: "GET",
          headers: {
            "x-internal-bot-secret": INTERNAL_BOT_SECRET,
          },
          signal: AbortSignal.timeout(6000),
        });
        const json = await rBot.json().catch(() => ({}));
        return NextResponse.json(json, { status: rBot.status });
      } catch (errPing: any) {
        return NextResponse.json({
          ok: false,
          conectado: false,
          latenciaMs: 0,
          error: errPing?.message || "Daemon offline o no respondió",
        });
      }
    }

    if (body.accion === "publicar-plano") {
      const { salaId } = body;
      if (!salaId) {
        return NextResponse.json({ ok: false, error: "salaId es requerido" }, { status: 400 });
      }

      const { data: sala } = await supabaseAdmin
        .from("salas_juego")
        .select("*")
        .eq("id", salaId)
        .maybeSingle();

      if (!sala) {
        return NextResponse.json({ ok: false, error: "Sala no encontrada" }, { status: 404 });
      }

      const hipodromo = String(sala.hipodromo_activo || "HIPÓDROMO").toUpperCase();
      const numCarrera = sala.numero_carrera_activa || 1;
      const carreraId = sala.carrera_activa_id || null;

      let query = supabaseAdmin
        .from("chat_tickets_fifo")
        .select("*")
        .eq("sala_id", sala.id)
        .in("estado", ["PENDIENTE", "ACTIVO", "ABIERTO"])
        .order("created_at", { ascending: true });

      if (carreraId) {
        query = query.or(`carrera_id.eq.${carreraId},carrera_id.is.null`);
      }

      const { data: tickets } = await query;
      const lista = tickets || [];
      const totalPactado = lista.reduce((acc, t) => acc + Number(t.monto_concretado || 0), 0);

      const lineas =
        lista.length > 0
          ? lista
              .map((t, idx) => {
                const codigo = (t.codigo_ticket || String(t.id || "").slice(0, 6)).toUpperCase();
                const detalle = t.es_match
                  ? `Match ${(t.caballos_bando_a || []).join("-")} x ${(t.caballos_bando_b || []).join("-")}`
                  : `${t.modalidad || "1P"} #${t.ejemplar_numero || (t.caballos_bando_a || []).join("-")}`;
                return `${idx + 1}. [${codigo}] *${t.proponente_nombre}* vs *${t.aceptante_nombre}* — ${detalle} por *$${formatearMontoRegional(Number(t.monto_concretado || 0))}*`;
              })
              .join("\n")
          : "_No hay jugadas activas pactadas en esta carrera._";

      let qProps = supabaseAdmin
        .from("chat_mensajes")
        .select("remitente_nombre, jugada_estandarizada, contenido, monto_disponible, modalidad_propuesta, ejemplar_texto, es_match, caballos_bando_a, caballos_bando_b")
        .eq("sala_id", sala.id)
        .in("tipo_mensaje", ["propuesta_jugada", "PROPUESTA"])
        .in("estado_propuesta", ["abierta", "parcial"])
        .gt("monto_disponible", 0)
        .order("created_at", { ascending: true });

      if (carreraId) {
        qProps = qProps.or(`carrera_id.eq.${carreraId},carrera_id.is.null`);
      }
      const { data: propsAbiertas } = await qProps;
      const listaProps = propsAbiertas || [];
      const lineasProps =
        listaProps.length > 0
          ? listaProps
              .map((p: any) => {
                const detalle = p.jugada_estandarizada || p.contenido || "Propuesta";
                return `• *${p.remitente_nombre}*: ${detalle} (Disp: *$${formatearMontoRegional(Number(p.monto_disponible || 0))}*)`;
              })
              .join("\n")
          : "_No hay propuestas abiertas en cola._";

      const textoPlano =
        `📋 *PLANO DE JUGADAS / PREJUGADAS*\n` +
        `🏇 *${hipodromo}* — Carrera #${numCarrera}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🤝 *JUGADAS CASADAS (${lista.length}):*\n` +
        `${lineas}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `⏳ *PROPUESTAS ABIERTAS (${listaProps.length}):*\n` +
        `${lineasProps}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `💰 *Total Jugado Casado:* $${formatearMontoRegional(totalPactado)} (${lista.length} tickets)`;

      let enviadoWhatsApp = false;
      if (sala.whatsapp_group_jid) {
        try {
          const rBot = await fetch(`${BOT_DAEMON_URL}/publicar-grupo`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-internal-bot-secret": INTERNAL_BOT_SECRET,
            },
            body: JSON.stringify({
              groupJid: sala.whatsapp_group_jid,
              texto: textoPlano,
              quotedMsgId: null,
            }),
          });
          enviadoWhatsApp = rBot.ok;
        } catch {
          enviadoWhatsApp = false;
        }
      }

      return NextResponse.json({
        ok: true,
        textoPlano,
        totalTickets: lista.length,
        totalPactado,
        enviadoWhatsApp,
      });
    }

    if (body.accion === "publicar-sentencia") {
      const { salaId, pizarra } = body;
      if (!salaId || !pizarra) {
        return NextResponse.json(
          { ok: false, error: "salaId y pizarra son requeridos" },
          { status: 400 }
        );
      }

      const { data: sala } = await supabaseAdmin
        .from("salas_juego")
        .select("*")
        .eq("id", salaId)
        .maybeSingle();

      if (!sala) {
        return NextResponse.json({ ok: false, error: "Sala no encontrada" }, { status: 404 });
      }

      const numeros = String(pizarra).match(/\b\d+[A-Za-z]?\b/g) || [];
      if (numeros.length === 0) {
        return NextResponse.json(
          { ok: false, error: "Formato de pizarra inválido (ej. 10.5.1.2.7)" },
          { status: 400 }
        );
      }

      // Intentar delegar al demonio si está en línea, o liquidar directamente desde aquí
      try {
        const rDaemon = await fetch(`${BOT_DAEMON_URL}/publicar-sentencia`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-bot-secret": INTERNAL_BOT_SECRET,
          },
          body: JSON.stringify({
            salaId,
            groupJid: sala.whatsapp_group_jid,
            pizarra,
          }),
        });
        if (rDaemon.ok) {
          const jsonDaemon = await rDaemon.json();
          return NextResponse.json({ ...jsonDaemon, enviadoWhatsApp: true });
        }
      } catch {
        // Fallback local si el demonio no está activo
      }

      const [p1, p2 = null, p3 = null, p4 = null, p5 = null] = numeros;
      const hipodromo = String(sala.hipodromo_activo || "HIPÓDROMO").toUpperCase();
      const numCarrera = sala.numero_carrera_activa || 1;
      const carreraId = sala.carrera_activa_id || sala.carrera_recien_cerrada_id || null;

      let positivos: string[] = [];
      let negativos: string[] = [];
      let rpcLiquidado = false;

      try {
        const { data: resRpc, error: errRpc } = await supabaseAdmin.rpc(
          "liquidar_carrera_sala_oficial",
          {
            p_grupo_id: sala.grupo_id,
            p_sala_id: sala.id,
            p_carrera_id: carreraId,
            p_p1: p1,
            p_p2: p2,
            p_p3: p3,
            p_p4: p4,
            p_p5: p5,
          }
        );
        if (!errRpc && resRpc) {
          rpcLiquidado = true;
          if (Array.isArray((resRpc as any).positivos)) positivos = (resRpc as any).positivos;
          if (Array.isArray((resRpc as any).negativos)) negativos = (resRpc as any).negativos;
        }
      } catch {
        rpcLiquidado = false;
      }

      if (!rpcLiquidado || (positivos.length === 0 && negativos.length === 0)) {
        const { data: grupo } = await supabaseAdmin
          .from("grupos_venta")
          .select("permite_cruces, comision_default")
          .eq("id", sala.grupo_id)
          .maybeSingle();

        const permiteCruces = grupo?.permite_cruces ?? true;
        const porcComision = Number(grupo?.comision_default ?? 5) / 100;

        let queryTickets = supabaseAdmin
          .from("chat_tickets_fifo")
          .select("*")
          .eq("sala_id", sala.id)
          .in("estado", ["PENDIENTE", "ACTIVO", "ABIERTO"]);

        if (carreraId) {
          queryTickets = queryTickets.or(`carrera_id.eq.${carreraId},carrera_id.is.null`);
        }

        const { data: tickets } = await queryTickets;
        const balance: Record<
          string,
          { nombre: string; ganancias: number; perdidas: number; comisionInd: number; stake: number }
        > = {};

        const asegurar = (id: string, nombre: string) => {
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

          const { data: evalData, error: evalErr } = await supabaseAdmin.rpc(
            "evaluar_jugada_universal",
            {
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
            }
          );

          const factor = evalErr ? 0 : Number(evalData || 0);
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
            await supabaseAdmin
              .from("chat_tickets_fifo")
              .update({ estado: nuevoEstado })
              .eq("id", t.id);
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
            const { data: cl } = await supabaseAdmin
              .from("clientes")
              .select("saldo_actual, saldo_retenido, libre, aval")
              .eq("id", jugadorId)
              .maybeSingle();

            if (cl) {
              const nuevoSaldo = Number((Number(cl.saldo_actual || 0) + neto).toFixed(2));
              const nuevoRet = Math.max(
                0,
                Number((Number(cl.saldo_retenido || 0) - b.stake).toFixed(2))
              );
              await supabaseAdmin
                .from("clientes")
                .update({
                  saldo_actual: nuevoSaldo,
                  saldo_retenido: nuevoRet,
                  saldo_disponible: cl.libre
                    ? 999999
                    : Math.max(0, nuevoSaldo + Number(cl.aval || 0) - nuevoRet),
                })
                .eq("id", jugadorId);

              if (neto > 0) {
                await supabaseAdmin.from("libro_mayor_clientes").insert({
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
                  creado_por: "OPERADOR_SALA",
                });
              } else if (neto < 0) {
                const montoAbs = Math.abs(neto);
                await supabaseAdmin.from("libro_mayor_clientes").insert({
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
                  creado_por: "OPERADOR_SALA",
                });
              }
            }
          }

          if (neto > 0) {
            positivos.push(`🟢 *${b.nombre}*: +$${formatearMontoRegional(neto)}`);
          } else if (neto < 0) {
            negativos.push(`🔴 *${b.nombre}*: -$${formatearMontoRegional(Math.abs(neto))}`);
          }
        }

        await supabaseAdmin
          .from("salas_juego")
          .update({
            estado_carrera: "liquidada",
            carrera_recien_cerrada_id: carreraId,
            updated_at: new Date().toISOString(),
          })
          .eq("id", sala.id);
      }

      let qJugadas = supabaseAdmin
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
              .map((t: any, idx: number) => {
                const detalle = t.es_match
                  ? `Match ${(t.caballos_bando_a || []).join("-")} x ${(t.caballos_bando_b || []).join("-")}`
                  : `${t.modalidad || "1P"} #${t.ejemplar_numero || (t.caballos_bando_a || []).join("-")}`;
                const montoStr = `$${formatearMontoRegional(Number(t.monto_concretado || 0))}`;
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
      const prefijoRectificado = body.esRectificacion ? "🔄 *PIZARRA RECTIFICADA OFICIALMENTE*\n\n" : "";
      const textoResultado =
        `${prefijoRectificado}🏁 *SENTENCIA OFICIAL — ${hipodromo} C${numCarrera}*\n` +
        `📊 *Pizarra Oficial:* ${pizarraFormateada}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `📋 *TODAS LAS JUGADAS (${listaJugadas.length}):*\n` +
        `${bloqueJugadas}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `📈 *POSITIVOS (+):*\n` +
        `${positivos.length > 0 ? positivos.join("\n") : "_Sin saldos positivos en esta carrera_"}\n\n` +
        `📉 *NEGATIVOS (-):*\n` +
        `${negativos.length > 0 ? negativos.join("\n") : "_Sin saldos negativos en esta carrera_"}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━`;

      if (sala.whatsapp_group_jid) {
        try {
          await fetch(`${BOT_DAEMON_URL}/publicar-grupo`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-internal-bot-secret": INTERNAL_BOT_SECRET,
            },
            body: JSON.stringify({
              groupJid: sala.whatsapp_group_jid,
              texto: textoResultado,
            }),
          });
        } catch {}
      }

      return NextResponse.json({
        ok: true,
        textoResultado,
        positivos,
        negativos,
        pizarra: numeros,
        enviadoWhatsApp: Boolean(sala.whatsapp_group_jid),
      });
    }

    if (body.accion === "ajuste-saldo-operador") {
      const { grupoId, targetNombre, signo, monto, operadorNombre } = body;
      if (!grupoId || !targetNombre || !signo || !monto) {
        return NextResponse.json({ ok: false, error: "Datos incompletos para ajuste" }, { status: 400 });
      }

      const { data: candidatos } = await supabaseAdmin
        .from("clientes")
        .select("id, nombre, seudonimo, saldo_actual, saldo_retenido, saldo_disponible, libre, aval, whatsapp_jid, telefono, telefono_normalizado")
        .eq("grupo_id", grupoId);

      const targetLimpio = String(targetNombre).trim().toUpperCase();
      const match = (candidatos || []).find((c: any) => {
        const n = String(c.nombre || "").trim().toUpperCase();
        const s = String(c.seudonimo || "").trim().toUpperCase();
        return n === targetLimpio || s === targetLimpio || n.includes(targetLimpio) || (s && s.includes(targetLimpio));
      });

      if (!match) {
        return NextResponse.json({ ok: false, error: `Jugador "${targetNombre}" no encontrado en este grupo.` }, { status: 404 });
      }

      const montoNum = Number(monto);
      const saldoActual = Number(match.saldo_actual || 0);
      const delta = signo === "+" ? montoNum : -montoNum;
      const nuevoSaldo = Number((saldoActual + delta).toFixed(2));
      const nuevoDisponible = match.libre ? 999999 : Math.max(0, Number((nuevoSaldo + Number(match.aval || 0) - Number(match.saldo_retenido || 0)).toFixed(2)));

      await supabaseAdmin
        .from("clientes")
        .update({
          saldo_actual: nuevoSaldo,
          saldo_disponible: nuevoDisponible,
          updated_at: new Date().toISOString(),
        })
        .eq("id", match.id);

      await supabaseAdmin.from("libro_mayor_clientes").insert({
        cliente_id: match.id,
        cliente_nombre: match.nombre,
        grupo_id: grupoId,
        tipo_movimiento: signo === "+" ? "DEPOSITO" : "RETIRO",
        monto_centavos: Math.round(montoNum * 100),
        monto: montoNum,
        observacion: "Ajuste operador WhatsApp",
        creado_por: operadorNombre || "OPERADOR_WHATSAPP",
        fecha_carrera: new Date().toISOString().split("T")[0],
      });

      const nombreFinal = match.seudonimo || match.nombre;
      const msgPublico = `✅ Saldo actualizado para *${nombreFinal}*: Nuevo saldo $${formatearMontoRegional(nuevoSaldo)}`;
      const msgPrivado = `💰 Tu cuenta ha sido ${signo === "+" ? "acreditada" : "debitada"} con $${formatearMontoRegional(montoNum)}. Tu nuevo saldo disponible es $${formatearMontoRegional(nuevoDisponible)}.`;

      return NextResponse.json({
        ok: true,
        clienteId: match.id,
        nombre: nombreFinal,
        nuevoSaldo,
        nuevoDisponible,
        msgPublico,
        msgPrivado,
        clienteJid: match.whatsapp_jid || (match.telefono_normalizado ? `${match.telefono_normalizado}@s.whatsapp.net` : null),
      });
    }

    // ========================================================================
    // PROCESAMIENTO EN VIVO DE MENSAJES DESDE bot-whatsapp-server.mjs
    // ========================================================================
    const groupJid = String(body.groupJid || "").trim();
    const participantJid = String(body.participantJid || body.senderJid || "").trim();
    const texto = String(body.texto || "").trim();
    const whatsappMsgId = body.whatsappMsgId ? String(body.whatsappMsgId) : null;
    const quotedMsgId = body.quotedMsgId ? String(body.quotedMsgId) : null;

    if (!groupJid || !participantJid || !texto) {
      return NextResponse.json(
        {
          ok: false,
          error: "groupJid, participantJid y texto son requeridos",
          respuestaGrupo: null,
          mensajePrivadoAutor: null,
        },
        { status: 400 }
      );
    }

    // 1. Buscar la Sala vinculada (por salaId explícito de multi-grupo, por salas_whatsapp_grupos, o por salas_juego.whatsapp_group_jid)
    const salaIdBody = body.salaId ? String(body.salaId) : null;
    const whatsappGroupNombre = body.whatsappGroupNombre ? String(body.whatsappGroupNombre) : null;
    let sala: any = null;

    if (salaIdBody) {
      const { data: sPorId } = await supabaseAdmin
        .from("salas_juego")
        .select("*")
        .eq("id", salaIdBody)
        .maybeSingle();
      sala = sPorId || null;
    }
    if (!sala) {
      const { data: vinculo } = await supabaseAdmin
        .from("salas_whatsapp_grupos")
        .select("salas_juego(*)")
        .eq("whatsapp_group_jid", groupJid)
        .eq("activo", true)
        .limit(1)
        .maybeSingle();
      if ((vinculo as any)?.salas_juego) {
        sala = (vinculo as any).salas_juego;
      }
    }
    if (!sala) {
      const { data: sLegacy } = await supabaseAdmin
        .from("salas_juego")
        .select("*")
        .eq("whatsapp_group_jid", groupJid)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      sala = sLegacy || null;
    }
    if (!sala && body.grupoId) {
      const { data: sGrp } = await supabaseAdmin
        .from("salas_juego")
        .select("*")
        .eq("grupo_id", String(body.grupoId))
        .eq("activa", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (sGrp) {
        sala = sGrp;
        if (!sGrp.whatsapp_group_jid) {
          await supabaseAdmin
            .from("salas_juego")
            .update({
              whatsapp_group_jid: groupJid,
              whatsapp_group_nombre: whatsappGroupNombre || sGrp.whatsapp_group_nombre || null,
            })
            .eq("id", sGrp.id);
          sala.whatsapp_group_jid = groupJid;
        }
      }
    }

    if (!sala) {
      return NextResponse.json({
        ok: false,
        tipo: "IGNORADO",
        mensaje: "Grupo no vinculado a ninguna sala activa",
        respuestaGrupo: null,
        mensajePrivadoAutor: null,
      });
    }

    const salaId = sala.id;
    const grupoId = sala.grupo_id;
    const carreraAbierta = String(sala.estado_carrera || "").toLowerCase() === "abierta";

    // Todo mensaje entrante del grupo (sea texto normal o jugada) debe registrarse
    // para que aparezca en el monitor en vivo de la Sala de Juegos Web
    const textoUsuarioLimpio = String(texto || "").trim();
    const esComandoOp = textoUsuarioLimpio.startsWith("!");
    const cmdRetiroPre = analizarComandoRetiro(textoUsuarioLimpio);
    const esAmpliacionPre = evaluarAmpliacionPropuesta(textoUsuarioLimpio).esAmpliacion;
    const esConsultaSaldo = /^(?:!?(?:saldo|mi\s+saldo|cuenta|mi\s+cuenta|resumen|mi\s+resumen|estado\s+de\s+cuenta|ver\s+saldo))\b/i.test(textoUsuarioLimpio);
    const esSolicitudCajero = /^(?:!?(?:deposito|depósito|reportar\s+pago|retiro|solicito\s+retiro|quiero\s+retirar|recarga|solicito\s+recarga))\b/i.test(textoUsuarioLimpio);
    const esAceptacionSinCita = !quotedMsgId && /^(?:j|voy|ponte|juego|jugamos|jugue|jugué|copiado|pago|entro)(?:\s+(?:con\s+|por\s+|\$)?([0-9kK.,]+))?$/i.test(textoUsuarioLimpio);
    const matchAjusteOperador = textoUsuarioLimpio.match(
      /^(?:!)?(?:(?:recargar?|abonar?|ajuste|cargar?)\s+)?([a-zA-Z0-9áéíóúÁÉÍÓÚñÑ\s._-]+?)\s*([+-])\s*([0-9kK.,]+)$/i
    );
    const preAnalisis = analizarYEstandarizarJugada(textoUsuarioLimpio, 999999);

    const esAccionOJugada =
      Boolean(quotedMsgId) ||
      esComandoOp ||
      cmdRetiroPre.esComandoRetiro ||
      esAmpliacionPre ||
      esConsultaSaldo ||
      esSolicitudCajero ||
      esAceptacionSinCita ||
      Boolean(matchAjusteOperador) ||
      preAnalisis.esIntencionDeJugada;

    if (!esAccionOJugada) {
      const nombreRemitente = String(body.senderNombre || body.pushName || "Usuario").trim();
      await supabaseAdmin.from("chat_mensajes").insert({
        grupo_id: grupoId,
        sala_id: salaId,
        remitente_nombre: nombreRemitente,
        es_operador: Boolean(body.esMensajePropioTelefono),
        tipo_mensaje: "texto",
        contenido: textoUsuarioLimpio,
        whatsapp_msg_id: body.whatsappMsgId || null,
        whatsapp_group_jid: groupJid,
        whatsapp_group_nombre: whatsappGroupNombre,
        origen_canal: "WHATSAPP",
      });
      await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });

      return NextResponse.json({
        ok: true,
        tipo: "CHARLA",
        respuestaGrupo: null,
        mensajePrivadoAutor: null,
      });
    }

    // 2. Identificar al jugador estrictamente en `public.clientes` del `grupo_id` de la sala
    const participantAlt = String(body.participantAlt || "");
    const telefonoRealProp = String(body.telefonoReal || "");
    const pushNameLimpio = String(body.pushName || body.senderNombre || "")
      .trim()
      .replace(/\s+/g, " ")
      .toUpperCase();
    const pushNameValido =
      pushNameLimpio &&
      !["USUARIO", "JUGADOR", "OPERADOR", "OPERADOR (TELEFONO)", "ADMIN"].includes(pushNameLimpio)
        ? pushNameLimpio
        : "";

    const telAlt = normalizarTelefono(participantAlt);
    let telReal = normalizarTelefono(telefonoRealProp);
    if (!telReal) {
      if (participantAlt && participantAlt.endsWith("@s.whatsapp.net")) {
        telReal = telAlt;
      } else if (participantJid && participantJid.endsWith("@s.whatsapp.net")) {
        telReal = normalizarTelefono(participantJid);
      } else if (telAlt && telAlt.length >= 7 && telAlt.length <= 15) {
        telReal = telAlt;
      } else if (!participantJid.endsWith("@lid")) {
        const tPrinc = normalizarTelefono(participantJid);
        if (tPrinc.length >= 7) telReal = tPrinc;
      }
    }

    const CAMPOS_CLIENTE_SALA =
      "id, grupo_id, nombre, seudonimo, saldo_actual, saldo_retenido, saldo_disponible, libre, aval, whatsapp_jid, codigo_pais, telefono, telefono_normalizado";

    let cliente: any =
      body.clientePreviamenteIdentificado?.id &&
      String(body.clientePreviamenteIdentificado?.grupo_id || "") === String(grupoId)
        ? body.clientePreviamenteIdentificado
        : null;

    // A. Búsqueda en `clientes` donde `grupo_id = sala.grupo_id` por JID o teléfono normalizado
    if (!cliente && (participantJid || participantAlt || telReal)) {
      const orConds: string[] = [];
      if (participantJid) orConds.push(`whatsapp_jid.eq.${participantJid}`);
      if (participantAlt && participantAlt !== participantJid) orConds.push(`whatsapp_jid.eq.${participantAlt}`);
      if (telReal && telReal.length >= 7) orConds.push(`telefono_normalizado.eq.${telReal}`);
      if (telAlt && telAlt !== telReal && telAlt.length >= 7) orConds.push(`telefono_normalizado.eq.${telAlt}`);

      if (orConds.length > 0) {
        const { data: clPorJidOTel } = await supabaseAdmin
          .from("clientes")
          .select(CAMPOS_CLIENTE_SALA)
          .eq("grupo_id", grupoId)
          .or(orConds.join(","))
          .order("saldo_actual", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (clPorJidOTel) {
          cliente = clPorJidOTel;
        }
      }
    }

    // B. Búsqueda por teléfono compuesto (codigo_pais + telefono) y últimos 9/8 dígitos dentro del grupo_id
    if (!cliente && telReal && telReal.length >= 7) {
      const sufijo9 = telReal.slice(-9);
      const { data: candidatosTel } = await supabaseAdmin
        .from("clientes")
        .select(CAMPOS_CLIENTE_SALA)
        .eq("grupo_id", grupoId);

      if (Array.isArray(candidatosTel) && candidatosTel.length > 0) {
        const clCompuesto = candidatosTel.find((c: any) => {
          const comp = normalizarTelefonoCompleto(c.codigo_pais, c.telefono);
          const norm = normalizarTelefono(c.telefono_normalizado || c.telefono);
          return (
            (comp && (comp === telReal || comp === telAlt || (sufijo9.length >= 9 && comp.endsWith(sufijo9)))) ||
            (norm && (norm === telReal || norm === telAlt || (sufijo9.length >= 9 && norm.endsWith(sufijo9))))
          );
        });
        if (clCompuesto) {
          cliente = clCompuesto;
        }
      }

      if (!cliente) {
        const sufijo8 = telReal.slice(-8);
        const { data: clPorSufijo } = await supabaseAdmin
          .from("clientes")
          .select(CAMPOS_CLIENTE_SALA)
          .eq("grupo_id", grupoId)
          .ilike("telefono", `%${sufijo8}%`)
          .order("saldo_actual", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (clPorSufijo) {
          cliente = clPorSufijo;
        }
      }
    }

    // C. Búsqueda en `clientes` donde `grupo_id = sala.grupo_id` por UPPER(TRIM(nombre)) o UPPER(TRIM(seudonimo)) = UPPER(TRIM(pushName))
    if (!cliente && pushNameValido) {
      const { data: candidatosGrupo } = await supabaseAdmin
        .from("clientes")
        .select(CAMPOS_CLIENTE_SALA)
        .eq("grupo_id", grupoId);

      if (Array.isArray(candidatosGrupo) && candidatosGrupo.length > 0) {
        const matchNombre = candidatosGrupo.find((c: any) => {
          const nom = String(c.nombre || "").trim().replace(/\s+/g, " ").toUpperCase();
          const seu = String(c.seudonimo || "").trim().replace(/\s+/g, " ").toUpperCase();
          return nom === pushNameValido || (seu && seu === pushNameValido);
        });
        if (matchNombre) {
          cliente = matchNombre;
        }
      }
    }

    // D. Si el jugador está registrado en múltiples grupos y su fila en `sala.grupo_id` aún tiene `whatsapp_jid = null`,
    // pero otra fila en otro grupo ya tiene ese `whatsapp_jid` o `telefono_normalizado`, usar esa pista (teléfono/nombre/seudónimo)
    // para localizar su fila independiente dentro de `sala.grupo_id`.
    if (!cliente && (participantJid || participantAlt || telReal)) {
      const orPista: string[] = [];
      if (participantJid) orPista.push(`whatsapp_jid.eq.${participantJid}`);
      if (participantAlt && participantAlt !== participantJid) orPista.push(`whatsapp_jid.eq.${participantAlt}`);
      if (telReal && telReal.length >= 7) orPista.push(`telefono_normalizado.eq.${telReal}`);

      if (orPista.length > 0) {
        const { data: filasOtroGrupo } = await supabaseAdmin
          .from("clientes")
          .select("nombre, seudonimo, telefono, telefono_normalizado")
          .or(orPista.join(","))
          .limit(5);

        if (Array.isArray(filasOtroGrupo) && filasOtroGrupo.length > 0) {
          const { data: candidatosGrupo } = await supabaseAdmin
            .from("clientes")
            .select(CAMPOS_CLIENTE_SALA)
            .eq("grupo_id", grupoId);

          if (Array.isArray(candidatosGrupo) && candidatosGrupo.length > 0) {
            for (const pista of filasOtroGrupo) {
              const telPista = normalizarTelefono(pista.telefono_normalizado || pista.telefono);
              const sufijoPista = telPista.length >= 7 ? telPista.slice(-8) : "";
              const nomPista = String(pista.nombre || "").trim().replace(/\s+/g, " ").toUpperCase();
              const seuPista = String(pista.seudonimo || "").trim().replace(/\s+/g, " ").toUpperCase();

              const encontrado = candidatosGrupo.find((c: any) => {
                const telC = normalizarTelefono(c.telefono_normalizado || c.telefono);
                if (telPista && telC && (telC === telPista || (sufijoPista && telC.endsWith(sufijoPista)))) {
                  return true;
                }
                const nomC = String(c.nombre || "").trim().replace(/\s+/g, " ").toUpperCase();
                const seuC = String(c.seudonimo || "").trim().replace(/\s+/g, " ").toUpperCase();
                if (nomPista && (nomC === nomPista || seuC === nomPista)) return true;
                if (seuPista && (nomC === seuPista || seuC === seuPista)) return true;
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
    }

    // E. Fallback a `clientes_grupos` donde `grupo_id = sala.grupo_id`
    if (!cliente) {
      try {
        const { data: membresias } = await supabaseAdmin
          .from("clientes_grupos")
          .select("cliente_id")
          .eq("grupo_id", grupoId);

        const idsMembresia = (membresias || [])
          .map((m: any) => m?.cliente_id)
          .filter(Boolean);

        if (idsMembresia.length > 0) {
          const { data: candidatosMembresia } = await supabaseAdmin
            .from("clientes")
            .select(CAMPOS_CLIENTE_SALA)
            .in("id", idsMembresia);

          if (Array.isArray(candidatosMembresia) && candidatosMembresia.length > 0) {
            const sufijo8 = telReal && telReal.length >= 7 ? telReal.slice(-8) : "";
            const matchMem = candidatosMembresia.find((c: any) => {
              if (participantJid && c.whatsapp_jid === participantJid) return true;
              if (participantAlt && c.whatsapp_jid === participantAlt) return true;
              const telC = normalizarTelefono(c.telefono_normalizado || c.telefono);
              if (telReal && telC && (telC === telReal || (sufijo8 && telC.endsWith(sufijo8)))) return true;
              const nomC = String(c.nombre || "").trim().replace(/\s+/g, " ").toUpperCase();
              const seuC = String(c.seudonimo || "").trim().replace(/\s+/g, " ").toUpperCase();
              if (pushNameValido && (nomC === pushNameValido || seuC === pushNameValido)) return true;
              return false;
            });
            if (matchMem) {
              cliente = matchMem;
            }
          }
        }
      } catch {
        // Tabla clientes_grupos opcional
      }
    }

    // Si no existe en public.clientes para ese grupo_id, rechazar de inmediato sin tocar la BD
    if (!cliente) {
      return NextResponse.json({
        ok: false,
        tipo: "SIN_REGISTRO",
        respuestaGrupo: "🚫 *Nada Aquí* — Jugador no registrado en la nómina oficial del grupo.",
        mensajePrivadoAutor: null,
      });
    }

    const nombreJugador = cliente.seudonimo || cliente.nombre;

    // Auto-vincular el whatsapp_jid en la fila de `sala.grupo_id` filtrando por `id` y `grupo_id`
    const updatesCl: Record<string, any> = {};
    if (participantJid && cliente.whatsapp_jid !== participantJid) {
      updatesCl.whatsapp_jid = participantJid;
      updatesCl.whatsapp_vinculado = true;
    }
    if (!cliente.telefono_normalizado && telReal && telReal.length >= 7) {
      updatesCl.telefono_normalizado = telReal;
    }
    if (Object.keys(updatesCl).length > 0) {
      updatesCl.updated_at = new Date().toISOString();
      let qUpd = supabaseAdmin.from("clientes").update(updatesCl).eq("id", cliente.id);
      if (cliente.grupo_id) {
        qUpd = qUpd.eq("grupo_id", cliente.grupo_id);
      }
      await qUpd;
      cliente.whatsapp_jid = participantJid;
      if (telReal) cliente.telefono_normalizado = telReal;
    }

    const saldoDisponible = calcularSaldoDisponible(cliente);
    if (!cliente.libre && (cliente.saldo_disponible == null || Number(cliente.saldo_disponible) !== saldoDisponible)) {
      let qDisp = supabaseAdmin.from("clientes").update({ saldo_disponible: saldoDisponible }).eq("id", cliente.id);
      if (cliente.grupo_id) {
        qDisp = qDisp.eq("grupo_id", cliente.grupo_id);
      }
      await qDisp;
      cliente.saldo_disponible = saldoDisponible;
    }

    // ========================================================================
    // 1. REGLAS ENTRENADAS DE LA SALA DE JUEGOS
    // Si no es comando de operador (!), consultar evaluar_respuesta_entrenada_sala
    // ========================================================================
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

          return NextResponse.json({
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
        console.warn("[procesar] Aviso evaluar_respuesta_entrenada_sala:", errRpcEntrenada);
      }

    if (matchAjusteOperador) {
      const esOp = Boolean(body.esMensajePropioTelefono) || Boolean(body.esOperador) || (await verificarEsOperador(cliente?.id, telReal || participantJid, grupoId));
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
            const nuevoDisponible = targetCliente.libre ? 999999 : Math.max(0, Number((nuevoSaldo + Number(targetCliente.aval || 0) - Number(targetCliente.saldo_retenido || 0)).toFixed(2)));

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

            const jidTarget = targetCliente.whatsapp_jid || (targetCliente.telefono_normalizado ? `${targetCliente.telefono_normalizado}@s.whatsapp.net` : null);

            return NextResponse.json({
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

      return NextResponse.json({
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

    if (esSolicitudCajero) {
      const esRetiro = /retiro|quiero\s+retirar|solicito\s+retiro/i.test(textoUsuarioLimpio);
      const tipoOp = esRetiro ? "Retiro" : "Depósito";
      const msgPriv = esRetiro
        ? `🏧 *Solicitud de Retiro*\n\nHola *${nombreJugador}*, tu solicitud de retiro ha sido notificada al operador.\nTu saldo disponible actual es *$${formatearMontoRegional(saldoDisponible)}*.\nEl operador se comunicará contigo a la brevedad.`
        : `🏦 *Solicitud de Recarga / Depósito*\n\nHola *${nombreJugador}*, hemos recibido tu solicitud. Por favor envía el comprobante de pago o capture por este medio.\nEl operador revisará y acreditará tu saldo a la brevedad.`;

      const notifOp = `🔔 *Solicitud de ${tipoOp} de Jugador:*\n👤 *${nombreJugador}* (${cliente.telefono || "Sin teléfono"})\n💰 Saldo Disponible: $${formatearMontoRegional(saldoDisponible)}\nPara procesar escribe: *${nombreJugador} +[MONTO]* o *${nombreJugador} -[MONTO]*`;

      return NextResponse.json({
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

    if (esConsultaSaldo) {
      const resumenDm = await construirResumenEstadoCuentaCliente(cliente, grupoId);

      return NextResponse.json({
        ok: true,
        tipo: "CONSULTA_SALDO",
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
    }

    const ejecutarAmpliacionCupo = async (
      quotedPropuestaId: string | null,
      nuevoTope: number | null
    ) => {
      const { data: dataAmp, error: errAmp } = await supabaseAdmin.rpc(
        "ampliar_cupo_propuesta_fifo_atomica",
        {
          p_grupo_id: grupoId,
          p_sala_id: salaId,
          p_proponente_id: cliente.id,
          p_propuesta_msg_id: quotedPropuestaId || null,
          p_nuevo_tope_total: nuevoTope,
        }
      );

      if (errAmp || !dataAmp || (dataAmp as any).ok === false) {
        const msgErrPublico = (dataAmp as any)?.msg_publico || (dataAmp as any)?.msg_publico_bot || (dataAmp as any)?.respuestaPublica || null;
        const msgErrPrivado =
          (dataAmp as any)?.msg_privado_proponente ||
          (dataAmp as any)?.msg_privado_bot ||
          (dataAmp as any)?.alertaPrivada ||
          (dataAmp as any)?.error ||
          (dataAmp as any)?.motivo ||
          errAmp?.message ||
          "No se pudo ampliar el cupo de la propuesta.";
        return NextResponse.json({
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
          senderJid: participantJid,
        });
      }

      const msgPublico: string | null =
        (dataAmp as any).msg_publico ||
        (dataAmp as any).msg_publico_bot ||
        (dataAmp as any).respuestaPublica ||
        null;
      if (msgPublico) {
        await supabaseAdmin.from("chat_mensajes").insert({
          grupo_id: grupoId,
          sala_id: salaId,
          remitente_nombre: "🤖 ASISTENTE DE SALA",
          es_operador: true,
          tipo_mensaje: "concrecion_fifo",
          contenido: msgPublico,
          whatsapp_msg_id: whatsappMsgId || null,
          whatsapp_group_jid: groupJid || null,
          whatsapp_group_nombre: whatsappGroupNombre || null,
          origen_canal: "WHATSAPP",
        });
        await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });
      }

      const notificaciones: any[] = Array.isArray((dataAmp as any).notificaciones_privadas)
        ? (dataAmp as any).notificaciones_privadas
        : [];
      for (const notif of notificaciones) {
        const msgPriv = notif?.mensaje || notif?.msg || notif?.texto;
        if (!msgPriv) continue;
        let destinoJid = notif?.whatsapp_jid || notif?.jid || notif?.telefono || null;
        if (!destinoJid && (notif?.cliente_id || notif?.jugador_id)) {
          const { data: clDest } = await supabaseAdmin
            .from("clientes")
            .select("whatsapp_jid, telefono, telefono_normalizado")
            .eq("id", notif.cliente_id || notif.jugador_id)
            .maybeSingle();
          destinoJid =
            clDest?.whatsapp_jid ||
            (clDest?.telefono_normalizado ? `${clDest.telefono_normalizado}@s.whatsapp.net` : null) ||
            clDest?.telefono ||
            null;
        }
        if (destinoJid) {
          try {
            await fetch(`${BOT_DAEMON_URL}/enviar-privado`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-internal-bot-secret": INTERNAL_BOT_SECRET,
              },
              body: JSON.stringify({ telefonoOjid: destinoJid, texto: msgPriv }),
            });
          } catch {
            // No bloqueante si el bot daemon está offline
          }
        }
      }

      const msgPrivadoProponente =
        (dataAmp as any).msg_privado_proponente ||
        (dataAmp as any).msg_privado_bot ||
        (dataAmp as any).alertaPrivada ||
        null;

      return NextResponse.json({
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
        notificacionesPrivadas: notificaciones,
        senderJid: participantJid,
        data: dataAmp,
      });
    };

    // ========================================================================
    // FLUJO A: CONCRECIÓN SECUENCIAL POR RESPUESTA CITADA (quotedMsgId)
    // ========================================================================
    if (quotedMsgId) {
      const esUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(quotedMsgId);
      let queryProp = supabaseAdmin
        .from("chat_mensajes")
        .select("*")
        .eq("sala_id", salaId);

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
        return NextResponse.json({
          ok: false,
          tipo: "IGNORADO",
          respuestaGrupo: null,
          mensajePrivadoAutor: null,
        });
      }

      if (!carreraAbierta) {
        return NextResponse.json({
          ok: false,
          tipo: "CARRERA_CERRADA",
          respuestaGrupo: `⛔ La carrera se encuentra ${String(sala.estado_carrera || "CERRADA").toUpperCase()}. No se admiten concreciones.`,
          mensajePrivadoAutor: null,
        });
      }

      // 1. Comando de retiro de propuesta citada por su autor ("Se Fue")
      const cmdRetiroCita = analizarComandoRetiro(texto);
      if (cmdRetiroCita.esComandoRetiro) {
        if (!cmdRetiroCita.esValido) {
          return NextResponse.json({
            ok: false,
            tipo: "PEDAGOGICO",
            respuestaGrupo: null,
            mensajePrivadoAutor:
              cmdRetiroCita.mensajeAclaratoria ||
              "Por favor aclara si deseas retirar tu propuesta con: 'Se fue' o 'sf'",
          });
        }

        if (propMsg.remitente_id !== cliente.id) {
          return NextResponse.json({
            ok: false,
            tipo: "NO_AUTORIZADO",
            respuestaGrupo: null,
            mensajePrivadoAutor: "⚠️ Solo el autor de la propuesta puede retirarla con 'Se fue'.",
          });
        }

        const { data: rpcSeFue, error: errSeFue } = await supabaseAdmin.rpc(
          "cerrar_propuestas_se_fue_atomica",
          {
            p_grupo_id: grupoId,
            p_sala_id: salaId,
            p_jugador_id: cliente.id,
            p_propuesta_id: propMsg.id,
          }
        );

        if (errSeFue || rpcSeFue?.ok === false) {
          return NextResponse.json({
            ok: false,
            tipo: "ERROR_RETIRO",
            respuestaGrupo: rpcSeFue?.msg_publico_bot || null,
            msg_publico_bot: rpcSeFue?.msg_publico_bot || null,
            msg_privado_bot: rpcSeFue?.msg_privado_bot || null,
            clienteTelefono: cliente?.telefono_normalizado || (cliente?.telefono ? String(cliente.telefono).replace(/\D/g, "") : null),
            error: errSeFue?.message || rpcSeFue?.error || "No se pudo retirar la propuesta",
          });
        }

        const remanenteRetirar = Number(rpcSeFue?.monto_liberado ?? propMsg.monto_disponible ?? propMsg.monto_original ?? 0);
        const jugadaTexto = propMsg.jugada_estandarizada || propMsg.contenido || "propuesta";
        const msgRetiroCita = rpcSeFue?.msg_publico_bot || `🚫 *Se Fue* — ${nombreJugador} retiró su propuesta (${jugadaTexto}).`;
        const msgPrivadoCita = rpcSeFue?.msg_privado_bot || `✅ Tu propuesta (${jugadaTexto}) fue retirada ("Se fue"). Saldo liberado: $${formatearMontoRegional(remanenteRetirar)}.`;

        await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });

        return NextResponse.json({
          ok: true,
          tipo: "RETIRO_PROPUESTA_ESPECIFICA",
          respuestaGrupo: msgRetiroCita,
          msg_publico: msgRetiroCita,
          msg_publico_bot: msgRetiroCita,
          respuestaPublica: msgRetiroCita,
          msg_privado_bot: msgPrivadoCita,
          mensajePrivadoAutor: msgPrivadoCita,
          clienteTelefono: cliente?.telefono_normalizado || (cliente?.telefono ? String(cliente.telefono).replace(/\D/g, "") : null),
          senderJid: participantJid,
        });
      }

      if (propMsg.remitente_id === cliente.id) {
        const amp = evaluarAmpliacionPropuesta(texto);
        if (amp.esAmpliacion) {
          return await ejecutarAmpliacionCupo(propMsg.id, amp.nuevoTope);
        }
        return NextResponse.json({
          ok: false,
          tipo: "AUTO_CONCRECION",
          respuestaGrupo: null,
          mensajePrivadoAutor: "⚠️ No puedes concretar tu propia propuesta de jugada.",
        });
      }

      // Ejecutar secuencialmente (1 a la vez por propuesta, Caso 90 + 10 = 100)
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

        // 2. Vencimiento por Tiempo (X minutos): Si superó el tiempo, expirada + devolver saldo retenido
        const tiempoVencimientoMin = Number(sala.tiempo_vencimiento_propuesta_min || sala.tiempo_vencimiento_min || 5);
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
              const nuevoRet = Math.max(0, Number((Number(propOwner.saldo_retenido || 0) - remanenteDisponible).toFixed(2)));
              await supabaseAdmin
                .from("clientes")
                .update({
                  saldo_retenido: nuevoRet,
                  saldo_disponible: Math.max(
                    0,
                    Number((Number(propOwner.saldo_actual || 0) + Number(propOwner.aval || 0) - nuevoRet).toFixed(2))
                  ),
                })
                .eq("id", propOwner.id);
            }
          }

          const msgFueraTiempo = "❌⏰ Nada aquí, fuera de tiempo";
          await supabaseAdmin.from("chat_mensajes").insert({
            grupo_id: grupoId,
            sala_id: salaId,
            remitente_nombre: "🤖 ASISTENTE DE SALA",
            es_operador: true,
            tipo_mensaje: "concrecion_fifo",
            contenido: msgFueraTiempo,
            whatsapp_msg_id: whatsappMsgId || null,
            whatsapp_group_jid: groupJid || null,
            whatsapp_group_nombre: whatsappGroupNombre || null,
            origen_canal: "WHATSAPP",
          });

          await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });

          return NextResponse.json({
            ok: false,
            tipo: "FUERA_DE_TIEMPO",
            nada_aqui: true,
            respuestaGrupo: msgFueraTiempo,
            msg_publico: msgFueraTiempo,
            msg_publico_bot: msgFueraTiempo,
            respuestaPublica: msgFueraTiempo,
            mensajePrivadoAutor: "Esta propuesta superó el tiempo máximo de vigencia y ha expirado.",
            senderJid: participantJid,
          });
        }

        if (
          remanenteDisponible <= 0 ||
          (estadoProp !== "abierta" && estadoProp !== "parcial")
        ) {
          return NextResponse.json({
            ok: false,
            tipo: "PROPUESTA_AGOTADA",
            respuestaGrupo: `⚠️ Esta parada ya fue tomada al 100% o no tiene saldo disponible.`,
            mensajePrivadoAutor: null,
          });
        }

        // Recalcular saldo fresco del aceptante dentro del candado FIFO
        const { data: aceptanteFresco } = await supabaseAdmin
          .from("clientes")
          .select(
            "id, nombre, seudonimo, saldo_actual, saldo_retenido, libre, aval, whatsapp_jid, telefono"
          )
          .eq("id", cliente.id)
          .single();

        const saldoDispAceptante = calcularSaldoDisponible(aceptanteFresco || cliente);
        if (Number(saldoDispAceptante) <= 0) {
          const saldoFmt = formatearMontoRegional(Math.max(0, saldoDispAceptante));
          return NextResponse.json({
            ok: false,
            tipo: "SIN_SALDO",
            respuestaGrupo: `⚠️ *${nombreJugador}* dispone de $${saldoFmt}`,
            msg_publico: `⚠️ *${nombreJugador}* dispone de $${saldoFmt}`,
            msg_publico_bot: `⚠️ *${nombreJugador}* dispone de $${saldoFmt}`,
            respuestaPublica: `⚠️ *${nombreJugador}* dispone de $${saldoFmt}`,
            mensajePrivadoAutor: `⚠️ Nos agrada tenerlo en el grupo, por favor no exceda su saldo, ajuste el monto de sus jugadas. Muchas gracias.`,
            msg_privado_bot: `⚠️ Nos agrada tenerlo en el grupo, por favor no exceda su saldo, ajuste el monto de sus jugadas. Muchas gracias.`,
            clienteTelefono: telefonoClienteCompleto,
            senderJid: participantJid,
          });
        }

        const accionProp: "JUEGA" | "CONSIGUE" =
          String(propFresca.accion_proponente || "").toUpperCase() === "CONSIGUE" ||
          /^(consigo|doy)\b/i.test(String(propFresca.contenido || ""))
            ? "CONSIGUE"
            : "JUEGA";

        // Evaluar palabras estrictas según diccionario direccional
        const evalConcrecion = evaluarConcrecionEstricta(
          texto,
          accionProp,
          remanenteDisponible,
          saldoDispAceptante,
          nombreJugador
        );

        if (!evalConcrecion.valido) {
          // Si no tenía saldo en absoluto
          if (saldoDispAceptante <= 0 && evalConcrecion.montoSolicitado > 0) {
            const saldoFmt = formatearMontoRegional(Math.max(0, saldoDispAceptante));
            return NextResponse.json({
              ok: false,
              tipo: "SIN_SALDO",
              respuestaGrupo: `⚠️ *${nombreJugador}* dispone de $${saldoFmt}`,
              msg_publico: `⚠️ *${nombreJugador}* dispone de $${saldoFmt}`,
              msg_publico_bot: `⚠️ *${nombreJugador}* dispone de $${saldoFmt}`,
              respuestaPublica: `⚠️ *${nombreJugador}* dispone de $${saldoFmt}`,
              mensajePrivadoAutor: `⚠️ Nos agrada tenerlo en el grupo, por favor no exceda su saldo, ajuste el monto de sus jugadas. Muchas gracias.`,
              msg_privado_bot: `⚠️ Nos agrada tenerlo en el grupo, por favor no exceda su saldo, ajuste el monto de sus jugadas. Muchas gracias.`,
              clienteTelefono: telefonoClienteCompleto,
              senderJid: participantJid,
            });
          }

          // Palabra no autorizada -> Enseñanza pedagógica en privado sin ensuciar el grupo
          return NextResponse.json({
            ok: false,
            tipo: "PEDAGOGICO",
            respuestaGrupo: null,
            mensajePrivadoAutor:
              evalConcrecion.motivoRechazo ||
              "Palabra no autorizada para concretar esta jugada.",
          });
        }

        // 3. Validación de Apuesta Mínima (salvo que el remanente sea menor)
        const apuestaMinima = Number(sala.apuesta_minima || 10.00);
        if (evalConcrecion.montoSolicitado < apuestaMinima && remanenteDisponible >= apuestaMinima) {
          const msgMinimoBot = `⛔ *Nada aquí* — El monto mínimo de apuesta es $${apuestaMinima.toFixed(2)}`;
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
          return NextResponse.json({
            ok: false,
            tipo: "APUESTA_MINIMA",
            nada_aqui: true,
            respuestaGrupo: msgMinimoBot,
            msg_publico: msgMinimoBot,
            msg_publico_bot: msgMinimoBot,
            respuestaPublica: msgMinimoBot,
            mensajePrivadoAutor: `El monto mínimo de apuesta configurado es $${apuestaMinima.toFixed(2)}.`,
            senderJid: participantJid,
          });
        }

        // Determinar si el aceptante pidió más de lo que quedaba disponible en el remanente (ej. quedaban $10 de $100)
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
        try {
          const { data: resRpc, error: errRpc } = await supabaseAdmin.rpc(
            "concretar_jugada_fifo_atomica",
            {
              p_grupo_id: grupoId,
              p_sala_id: salaId,
              p_propuesta_msg_id: propFresca.id,
              p_aceptante_id: cliente.id,
              p_monto_pedido: montoEfectivo,
            }
          );
          resRpcData = resRpc;
          if (!errRpc && resRpc && (resRpc as any).nada_aqui === true) {
            const msgPublicoNadaAqui =
              (resRpc as any).msg_publico ||
              (resRpc as any).msg_publico_bot ||
              (resRpc as any).respuestaPublica ||
              "*Nada Aquí*";
            await supabaseAdmin.from("chat_mensajes").insert({
              grupo_id: grupoId,
              sala_id: salaId,
              remitente_nombre: "🤖 ASISTENTE DE SALA",
              es_operador: true,
              tipo_mensaje: "concrecion_fifo",
              contenido: msgPublicoNadaAqui,
              whatsapp_msg_id: whatsappMsgId || null,
              whatsapp_group_jid: groupJid || null,
              whatsapp_group_nombre: whatsappGroupNombre || null,
              origen_canal: "WHATSAPP",
            });
            await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });
            return NextResponse.json({
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
            });
          }
          if (!errRpc && resRpc && (resRpc as any).ok !== false) {
            rpcExitoso = true;
          }
        } catch {
          rpcExitoso = false;
        }

        // Fallback atómico si el RPC no fue exitoso
        if (!rpcExitoso) {
          const msgErrPub = (resRpcData as any)?.msg_publico || (resRpcData as any)?.msg_publico_bot || (resRpcData as any)?.respuestaPublica || "🚫 *Error al concretar jugada* — Intente nuevamente.";
          const msgErrPriv =
            (resRpcData as any)?.msg_privado_aceptante ||
            (resRpcData as any)?.msg_privado_bot ||
            (resRpcData as any)?.alertaPrivada ||
            "La concreción no pudo ser procesada por el motor atómico.";
          return NextResponse.json({
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
          });
        }

        await sincronizarTicketsPropuestaATaquilla(supabaseAdmin, {
          propuestaMsgId: propFresca.id,
          sala,
          grupoId,
          condicionProponente: propFresca.condicion_proponente,
        });

        // Obtener datos de contacto del proponente para notificación privada a ambos jugadores
        const { data: proponenteRow } = await supabaseAdmin
          .from("clientes")
          .select("id, nombre, whatsapp_jid, telefono, telefono_normalizado")
          .eq("id", propFresca.remitente_id)
          .maybeSingle();

        const esConsigueProp =
          accionProp === "CONSIGUE" ||
          /^(consigo|doy)\b/i.test(String(propFresca.contenido || ""));

        let nombreJuega = "";
        let nombreDa = "";
        if (esConsigueProp) {
          nombreDa = propFresca.remitente_nombre || "Proponente";
          nombreJuega = nombreJugador;
        } else {
          nombreJuega = propFresca.remitente_nombre || "Proponente";
          nombreDa = nombreJugador;
        }

        // Modalidad / Caballos
        let modalidadCaballos = "";
        if (propFresca.es_match) {
          const bA = Array.isArray(propFresca.caballos_bando_a)
            ? propFresca.caballos_bando_a.join("-")
            : String(propFresca.caballos_bando_a || "");
          const bB = Array.isArray(propFresca.caballos_bando_b)
            ? propFresca.caballos_bando_b.join("-")
            : String(propFresca.caballos_bando_b || "");
          if (bA && bB) {
            modalidadCaballos = `${bA}x${bB}`;
          } else {
            modalidadCaballos = propFresca.ejemplar_texto || propFresca.modalidad_propuesta || "MATCH";
          }
        } else {
          const mod = propFresca.modalidad_propuesta || propFresca.modalidad || "";
          const ej =
            propFresca.ejemplar_texto ||
            (Array.isArray(propFresca.caballos_bando_a) ? propFresca.caballos_bando_a.join("-") : "") ||
            "";
          modalidadCaballos = `${mod} ${ej}`.trim() || propFresca.jugada_estandarizada || "JUGADA";
        }

        // Proporción
        const propRaw = String(propFresca.proporcion_premio || propFresca.proporcion || "1x1").trim();
        const propTexto = propRaw.includes("/") ? propRaw.replace("/", "a") : propRaw;

        // Riesgos
        const matchProp = /^10[x\/\-a@ª](\d+(?:\.\d+)?)$/i.exec(propRaw.replace(',', '.'));
        let riesgoJuega = Number(montoEfectivo || 0);
        let riesgoDa = Number(montoEfectivo || 0);
        if (matchProp) {
          const xVal = parseFloat(matchProp[1]);
          if (Number.isFinite(xVal) && xVal > 0) {
            riesgoDa = Math.round(montoEfectivo * 100) / 100;
            riesgoJuega = Math.round(montoEfectivo * (xVal / 10) * 100) / 100;
          }
        }

        const montoBaseFmt = Number(montoEfectivo).toFixed(montoEfectivo % 1 === 0 ? 0 : 2);
        const riesgoJuegaFmt = riesgoJuega.toFixed(2);
        const riesgoDaFmt = riesgoDa.toFixed(2);

        const msgPublicoFinal =
          `✅ Jugaron: *${nombreJuega} Juega ${modalidadCaballos} ${propTexto} da ${nombreDa} $${montoBaseFmt}*\n` +
          `🔹 Juega: ${nombreJuega} (Riesgo $${riesgoJuegaFmt})\n` +
          `🔸 Da: ${nombreDa} (Riesgo $${riesgoDaFmt})`;

        const msgPrivAceptante = evalConcrecion.excedioSaldo
          ? `⚠️ Nos agrada tenerlo en el grupo, por favor no exceda su saldo, ajuste el monto de sus jugadas. Muchas gracias.`
          : `✅ *Confirmación de Jugada*:\n` +
            `Pactaste con *${propFresca.remitente_nombre}* en *${modalidadCaballos} ${propTexto}* por *$${montoBaseFmt}*.\n` +
            `Tu rol: *${nombreJugador === nombreJuega ? "Juega" : "Da"}* (Riesgo: $${nombreJugador === nombreJuega ? riesgoJuegaFmt : riesgoDaFmt}).`;

        const msgPrivProponente =
          `🔔 *Confirmación de Jugada*:\n` +
          `*${nombreJugador}* aceptó tu jugada en *${modalidadCaballos} ${propTexto}* por *$${montoBaseFmt}*.\n` +
          `Tu rol: *${propFresca.remitente_nombre === nombreJuega ? "Juega" : "Da"}* (Riesgo: $${propFresca.remitente_nombre === nombreJuega ? riesgoJuegaFmt : riesgoDaFmt}).` +
          (nuevoRemanente > 0 ? `\n⏳ Quedan *$${formatearMontoRegional(nuevoRemanente)}* disponibles en tu propuesta.` : "");

        const notifs = (resRpcData as any)?.notificaciones_privadas || [];

        // Registrar mensaje de concreción en chat_mensajes
        await supabaseAdmin.from("chat_mensajes").insert({
          grupo_id: grupoId,
          sala_id: salaId,
          remitente_id: cliente.id,
          remitente_nombre: nombreJugador,
          es_operador: false,
          tipo_mensaje: "CONCRECION",
          contenido: msgPublicoFinal,
          reply_to_msg_id: propFresca.id,
          whatsapp_msg_id: whatsappMsgId,
          whatsapp_quoted_msg_id: quotedMsgId,
          whatsapp_group_jid: groupJid,
          whatsapp_group_nombre: whatsappGroupNombre,
          origen_canal: "WHATSAPP",
          carrera_id: propFresca.carrera_id || sala.carrera_activa_id,
        });

        await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });

        return NextResponse.json({
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
        });
      });
    }

    // ========================================================================
    // FLUJO B: MENSAJE SIN CITAR -> RETIRO DE PARADA ("Se fue") O PROPUESTA NUEVA
    // FLUJO B: PROPUESTAS / CONTRAMARCHA / RETIRO DE JUGADAS
    // ========================================================================
    if (carreraAbierta) {
      const ampSinCita = evaluarAmpliacionPropuesta(texto);
      if (ampSinCita.esAmpliacion) {
        return await ejecutarAmpliacionCupo(null, ampSinCita.nuevoTope);
      }
    }

    const comandoRetiro = analizarComandoRetiro(texto);
    if (comandoRetiro.esComandoRetiro) {
      if (!comandoRetiro.esValido) {
        return NextResponse.json({
          ok: false,
          tipo: "PEDAGOGICO",
          respuestaGrupo: null,
          mensajePrivadoAutor:
            comandoRetiro.mensajeAclaratoria ||
            "Por favor aclara si deseas retirar tus jugadas con: 'Se fue' o 'sf'",
        });
      }

      const { data: rpcSeFue, error: errSeFue } = await supabaseAdmin.rpc(
        "cerrar_propuestas_se_fue_atomica",
        {
          p_grupo_id: grupoId,
          p_sala_id: salaId,
          p_jugador_id: cliente.id,
          p_propuesta_id: null,
        }
      );

      if (errSeFue || rpcSeFue?.ok === false) {
        return NextResponse.json({
          ok: false,
          tipo: "ERROR_RETIRO",
          respuestaGrupo: rpcSeFue?.msg_publico_bot || null,
          msg_publico_bot: rpcSeFue?.msg_publico_bot || null,
          msg_privado_bot: rpcSeFue?.msg_privado_bot || null,
          clienteTelefono: cliente?.telefono_normalizado || (cliente?.telefono ? String(cliente.telefono).replace(/\D/g, "") : null),
          error: errSeFue?.message || rpcSeFue?.error || "No se pudieron retirar las propuestas",
        });
      }

      const liberado = Number(rpcSeFue?.monto_liberado ?? 0);
      const msgPublicoRetiro = rpcSeFue?.msg_publico_bot || `🚫 *Se Fue* — Todas las propuestas abiertas de ${nombreJugador} fueron retiradas.`;
      const msgPrivadoRetiro = rpcSeFue?.msg_privado_bot || `✅ Todas tus propuestas abiertas fueron retiradas ("Se fue"). Saldo liberado: $${formatearMontoRegional(liberado)}.`;

      await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });

      return NextResponse.json({
        ok: true,
        tipo: "RETIRO_PROPUESTAS",
        respuestaGrupo: msgPublicoRetiro,
        msg_publico: msgPublicoRetiro,
        msg_publico_bot: msgPublicoRetiro,
        respuestaPublica: msgPublicoRetiro,
        msg_privado_bot: msgPrivadoRetiro,
        mensajePrivadoAutor: msgPrivadoRetiro,
        clienteTelefono: cliente?.telefono_normalizado || (cliente?.telefono ? String(cliente.telefono).replace(/\D/g, "") : null),
        senderJid: participantJid,
      });
    }

    // ------------------------------------------------------------------------
    // 3. APRENDIZAJE DINÁMICO: Consultar reglas y respuestas entrenadas en BD
    // para que WhatsApp responda idéntico a la Sala Web
    // ------------------------------------------------------------------------
    let respuestaAprendida: string | null = null;
    let jugadaAprendidaSugerida: string | null = null;
    try {
      const { data: revPrevia } = await supabaseAdmin
        .from("registro_revision_llm")
        .select("jugada_corregida_sugerida, respuesta_ia_enviada, intencion_detectada")
        .eq("grupo_id", grupoId)
        .ilike("mensaje_usuario_original", texto.trim())
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
    } catch {
      // Resiliente
    }

    // Analizar en bloque (multilínea o múltiples caballos separados por coma: "Juego 2p 3,5,8 con 100")
    const retirados = Array.isArray(sala.retirados) ? sala.retirados : [];
    const telefonoClienteCompleto =
      normalizarTelefonoCompleto(cliente.codigo_pais, cliente.telefono) ||
      cliente?.telefono_normalizado ||
      (cliente?.telefono ? String(cliente.telefono).replace(/\D/g, "") : null);

    const bloqueItems = analizarBloqueJugadas(
      texto,
      saldoDisponible,
      retirados,
      16,
      nombreJugador
    );
    const bloquesValidos = bloqueItems.filter((b) => b.esIntencionDeJugada && b.valido);

    if (bloquesValidos.length > 1) {
      if (!carreraAbierta) {
        const msgCerrada = `⛔ La carrera está ${String(sala.estado_carrera || "CERRADA").toUpperCase()}. No se reciben nuevas propuestas.`;
        return NextResponse.json({
          ok: false,
          tipo: "CARRERA_CERRADA",
          respuestaGrupo: msgCerrada,
          msg_publico: msgCerrada,
          msg_publico_bot: msgCerrada,
          respuestaPublica: msgCerrada,
          clienteTelefono: telefonoClienteCompleto,
          senderJid: participantJid,
        });
      }

      if (saldoDisponible <= 0 && !cliente.libre) {
        const saldoFmt = formatearMontoRegional(Math.max(0, saldoDisponible));
        const msgSinSaldo = `⚠️ *${nombreJugador}* dispone de $${saldoFmt}`;
        const msgPrivSinSaldo = `⚠️ Nos agrada tenerlo en el grupo, por favor no exceda su saldo, ajuste el monto de sus jugadas. Muchas gracias.`;
        return NextResponse.json({
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
        });
      }

      const pPropuestas = bloquesValidos.map((b) => ({
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
      let excedioSaldoBloque = bloquesValidos.some((b) => Boolean(b.excedioSaldo));

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
      } catch {
        // Fallback secuencial si la RPC de bloque no está en BD
      }

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

      const msgPubBlk = excedioSaldoBloque
        ? `⚠️ *${nombreJugador}* dispone de $${formatearMontoRegional(Math.max(0, saldoDisponible))}`
        : null;
      const msgPrivBlk = excedioSaldoBloque
        ? `⚠️ Nos agrada tenerlo en el grupo, por favor no exceda su saldo, ajuste el monto de sus jugadas. Muchas gracias.`
        : null;

      return NextResponse.json({
        ok: propIdsBloque.length > 0,
        tipo: "PROPUESTA_BLOQUE",
        propuestasIds: propIdsBloque,
        reaccionEmoji: "🏇",
        respuestaGrupo: msgPubBlk,
        msg_publico: msgPubBlk,
        msg_publico_bot: msgPubBlk,
        respuestaPublica: msgPubBlk,
        mensajePrivadoAutor: msgPrivBlk,
        msg_privado_bot: msgPrivBlk,
        clienteTelefono: telefonoClienteCompleto,
        senderJid: participantJid,
      });
    }

    // Analizar con `evaluarMensajePedagogico`
    let analisis = evaluarMensajePedagogico(
      texto,
      saldoDisponible,
      retirados,
      16,
      nombreJugador
    );

    // Si con el texto original no fue válido pero hay sugerencia aprendida en BD, reintentar con la sugerencia
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

    // Si no tiene intención de jugada, registrar en chat_mensajes para la Sala de Juegos Web
    if (!analisis.esIntencionDeJugada) {
      await supabaseAdmin.from("chat_mensajes").insert({
        grupo_id: grupoId,
        sala_id: salaId,
        remitente_id: cliente?.id || null,
        remitente_nombre: nombreJugador || "Jugador",
        es_operador: false,
        tipo_mensaje: "texto",
        contenido: texto,
        whatsapp_msg_id: whatsappMsgId || null,
        whatsapp_group_jid: groupJid || null,
        whatsapp_group_nombre: whatsappGroupNombre || null,
        origen_canal: "WHATSAPP",      });
      await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });

      return NextResponse.json({
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
        clienteTelefono: cliente?.telefono_normalizado || (cliente?.telefono ? String(cliente.telefono).replace(/\D/g, "") : null),
        senderJid: participantJid,
      });
    }

    // Bloqueo estricto de jugadas sin saldo (saldo_disponible <= 0)
    if (Number(saldoDisponible) <= 0) {
      const msgPubSinSaldo = `*Nada Aquí* — ${nombreJugador} no posee saldo disponible ($0,00)`;
      const msgPrivSinSaldo = `"Atento", no publique jugadas por encima de saldo disponible, nos agrada tenerlo en este grupo`;
      return NextResponse.json({
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
        clienteTelefono: cliente?.telefono_normalizado || (cliente?.telefono ? String(cliente.telefono).replace(/\D/g, "") : null),
        senderJid: participantJid,
      });
    }

    // Caso: Publicó jugada por encima de su saldo y tiene $0 disponible
    if (!analisis.valido && analisis.excedioSaldo) {
      const saldoFmt = formatearMontoRegional(Math.max(0, saldoDisponible));
      const msgPubExceso = `⚠️ *${nombreJugador}* dispone de $${saldoFmt}`;
      const msgPrivExceso = `⚠️ Nos agrada tenerlo en el grupo, por favor no exceda su saldo, ajuste el monto de sus jugadas. Muchas gracias.`;
      return NextResponse.json({
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
        clienteTelefono: cliente?.telefono_normalizado || (cliente?.telefono ? String(cliente.telefono).replace(/\D/g, "") : null),
        senderJid: participantJid,
      });
    }

    // Caso: Enseñanza Pedagógica en Privado (mal escrita: falta Condición, Ejemplar, Jugada o Monto)
    if (!analisis.valido) {
      // Guardar en aprendizaje dinámico (idéntico a la Sala Web)
      try {
        await supabaseAdmin.from("registro_revision_llm").insert({
          grupo_id: grupoId,
          sala_id: salaId,
          usuario_id: cliente.id,
          usuario_nombre: nombreJugador,
          mensaje_usuario_original: texto.trim(),
          jugada_corregida_sugerida: analisis.sugerenciasUnClic?.[0] || analisis.jugadaEstandarizada || jugadaAprendidaSugerida,
          intencion_detectada: analisis.modalidad,
          respuesta_ia_enviada: respuestaAprendida || analisis.msgPrivadoBot || analisis.mensajePedagogicoPrivado || "Corrección pedagógica",
          nivel_confianza: analisis.confianza,
          requiere_intervencion_humana: analisis.requiereOperador,
          estado_ticket_soporte: analisis.requiereOperador ? "pendiente_operador" : "resuelto_ia",
        });

        await supabaseAdmin.from("diccionario_aprendizaje_bot").insert({
          grupo_id: grupoId,
          termino_original: texto.trim(),
          jugada_corregida: analisis.jugadaEstandarizada || analisis.mensajePedagogicoPrivado,
          usuario_id: cliente.id,        });
      } catch {
        // Resiliente
      }

      const msgPrivPedagogico =
        respuestaAprendida ||
        analisis.msgPrivadoBot ||
        analisis.mensajePedagogicoPrivado ||
        `🤖 Corrección Pedagógica: Para publicar una jugada indica Condición (Juego/Consigo), Jugada, Ejemplar y Monto. Ejemplo: Juego 1P 5 100`;

      return NextResponse.json({
        ok: false,
        tipo: "PEDAGOGICO",
        respuestaGrupo: analisis.msgPublicoBot || null,
        msg_publico: analisis.msgPublicoBot || null,
        msg_publico_bot: analisis.msgPublicoBot || null,
        respuestaPublica: analisis.msgPublicoBot || null,
        mensajePrivadoAutor: msgPrivPedagogico,
        msg_privado_bot: msgPrivPedagogico,
        alertaPrivada: null,
        notificaciones_privadas: [],
        clienteTelefono: cliente?.telefono_normalizado || (cliente?.telefono ? String(cliente.telefono).replace(/\D/g, "") : null),
        senderJid: participantJid,
      });
    }

    if (!carreraAbierta) {
      const msgCerrada = `⛔ La carrera está ${String(sala.estado_carrera || "CERRADA").toUpperCase()}. No se reciben nuevas propuestas.`;
      return NextResponse.json({
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
        clienteTelefono: cliente?.telefono_normalizado || (cliente?.telefono ? String(cliente.telefono).replace(/\D/g, "") : null),
        senderJid: participantJid,
      });
    }

    // Bloqueo estricto: Si el cliente no posee saldo disponible
    if (saldoDisponible <= 0 && !cliente.libre) {
      const saldoFmt = formatearMontoRegional(Math.max(0, saldoDisponible));
      const msgSinSaldo = `⚠️ *${nombreJugador}* dispone de $${saldoFmt}`;
      const msgPrivSinSaldo = `⚠️ Nos agrada tenerlo en el grupo, por favor no exceda su saldo, ajuste el monto de sus jugadas. Muchas gracias.`;
      return NextResponse.json({
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
      });
    }

    // Regla: Apuesta Mínima para proponer
    const apuestaMinima = Number(sala.apuesta_minima || 10.00);
    if (analisis.monto < apuestaMinima) {
      const msgMinimoBot = `⛔ *Nada aquí* — El monto mínimo de apuesta es $${apuestaMinima.toFixed(2)}`;
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
      return NextResponse.json({
        ok: false,
        tipo: "APUESTA_MINIMA",
        nada_aqui: true,
        respuestaGrupo: msgMinimoBot,
        msg_publico: msgMinimoBot,
        msg_publico_bot: msgMinimoBot,
        respuestaPublica: msgMinimoBot,
        mensajePrivadoAutor: `El monto mínimo para publicar es $${apuestaMinima.toFixed(2)}.`,
        clienteTelefono: telefonoClienteCompleto,
        senderJid: participantJid,
      });
    }

    // Determinar monto a publicar (topado según riesgo real 10/X vs saldoDisponible)
    const riesgoReal = calcularRiesgoReal(analisis.monto, analisis.proporcion, analisis.accionProponente);
    const excedioSaldo = Boolean(analisis.excedioSaldo || riesgoReal > saldoDisponible);
    const montoAPublicar = excedioSaldo
      ? Math.max(0, Number((analisis.montoDisponibleValido ?? saldoDisponible).toFixed(2)))
      : Number(analisis.monto);

    let propId: string | null = null;
    let rpcPublicado = false;
    let rpcResFinal: any = null;

    // Llamar a `publicar_propuesta_atomica` según especificación exclusiva
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

    // Fallback resiliente: inserción directa en chat_mensajes si el RPC falla
    if (!rpcPublicado || !propId) {
      try {
        if (!cliente.libre) {
          const saldoRetenidoActual = Number(cliente.saldo_retenido || 0);
          const nuevoRetenido = Number((saldoRetenidoActual + montoAPublicar).toFixed(2));
          await supabaseAdmin
            .from("clientes")
            .update({
              saldo_retenido: nuevoRetenido,
              saldo_disponible: Math.max(0, Number((Number(cliente.saldo_actual || 0) + Number(cliente.aval || 0) - nuevoRetenido).toFixed(2))),
            })
            .eq("id", cliente.id);
        }

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
            carrera_id: sala.carrera_activa_id || null,
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
          console.error("[procesar] Fallback inserción directa error:", errInsert);
        }
      } catch (errFb) {
        console.error("[procesar] Error en bloque fallback propuesta:", errFb);
      }
    }

    if (!rpcPublicado || !propId) {
      const msgErrPriv =
        `⚠️ Hola *${nombreJugador}*, tu mensaje "${texto}" no pudo procesarse porque ocurrió un problema registrando tu propuesta.\n\n✅ *Ejemplo correcto:* "Juego 1P 5 20.000" o "Juego 3x5 10a8 100".`;
      return NextResponse.json({
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
        clienteTelefono: cliente?.telefono_normalizado || (cliente?.telefono ? String(cliente.telefono).replace(/\D/g, "") : null),
        senderJid: participantJid,
      });
    }

    await supabaseAdmin
      .from("chat_mensajes")
      .update({
        whatsapp_msg_id: whatsappMsgId,
        whatsapp_group_jid: groupJid,
        whatsapp_group_nombre: whatsappGroupNombre,
        origen_canal: "WHATSAPP",
      })
      .eq("id", propId);

    await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });

    // Si publicó por encima de su saldo_disponible, devolver los textos exactos requeridos
    if (excedioSaldo) {
      const saldoFmt = formatearMontoRegional(Math.max(0, saldoDisponible));
      const msgPubRecorte = `⚠️ *${nombreJugador}* dispone de $${saldoFmt}`;
      const msgPrivRecorte = `⚠️ Nos agrada tenerlo en el grupo, por favor no exceda su saldo, ajuste el monto de sus jugadas. Muchas gracias.`;
      return NextResponse.json({
        ok: true,
        excedio_saldo: true,
        tipo: "PROPUESTA_CON_RECORTE_SALDO",
        propuestaId: propId,
        respuestaGrupo: msgPubRecorte,
        msg_publico: msgPubRecorte,
        msg_publico_bot: msgPubRecorte,
        respuestaPublica: msgPubRecorte,
        mensajePrivadoAutor: msgPrivRecorte,
        msg_privado_bot: msgPrivRecorte,
        msg_privado_proponente: msgPrivRecorte,
        alertaPrivada: (rpcResFinal as any)?.alertaPrivada || msgPrivRecorte,
        notificaciones_privadas: (rpcResFinal as any)?.notificaciones_privadas || [],
        clienteTelefono: cliente?.telefono_normalizado || (cliente?.telefono ? String(cliente.telefono).replace(/\D/g, "") : null),
        senderJid: participantJid,
      });
    }

    // Propuesta Exitosa con Saldo: SILENCIO en grupo público.
    // Cuando un jugador publica una jugada (ej. Juego 3x5 10a8 100) y tiene saldo,
    // el bot NO responde nada en el grupo público. Solo la registra en la memoria interna (BD).
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
          nuevoCliente: cliente,
          analisis,
          groupJid,
          whatsappGroupNombre,
          whatsappMsgId,
        });
      }
    }

    if (resCruceAuto?.cruzado) {
      return NextResponse.json({
        ok: true,
        tipo: "PROPUESTA_CON_CRUCE",
        propuestaId: propId,
        jugadaEstandarizada: analisis.jugadaEstandarizada,
        montoPublicado: montoAPublicar,
        reaccionEmoji: "🏇",
        respuestaGrupo: resCruceAuto.msgCruce,
        msg_publico: resCruceAuto.msgCruce,
        msg_publico_bot: resCruceAuto.msgCruce,
        respuestaPublica: resCruceAuto.msgCruce,
        mensajePrivadoAutor: null,
        senderJid: participantJid,
      });
    }

    return NextResponse.json({
      ok: true,
      tipo: "PROPUESTA",
      propuestaId: propId,
      jugadaEstandarizada: analisis.jugadaEstandarizada,
      montoPublicado: montoAPublicar,
      reaccionEmoji: "🏇",
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
    });
  } catch (err: any) {
    return NextResponse.json(
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
