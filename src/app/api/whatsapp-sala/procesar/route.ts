import { NextResponse } from "next/server";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { supabaseAdmin } from "@/core/supabase-admin";
import {
  analizarYEstandarizarJugada,
  evaluarMensajePedagogico,
  evaluarConcrecionEstricta,
  analizarComandoRetiro,
  evaluarAmpliacionPropuesta,
  normalizarParadaPremio,
} from "@/features/sala-juegos/lib/parser-pedagogico";
import { formatearMontoRegional } from "@/shared/lib/dinero";
import { sincronizarTicketsPropuestaATaquilla } from "@/features/whatsapp-sala/lib/sincronizar-tickets-sala";

export const dynamic = "force-dynamic";

function sanitizarTexto(str: unknown): string {
  if (typeof str !== "string") return "";
  return str
    .replace(/[^\w\s.,!¡?¿$*+=\-()\[\]/@ªáéíóúÁÉÍÓÚñÑ]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

const BOT_DAEMON_URL = process.env.WHATSAPP_BOT_URL || "http://127.0.0.1:3005";
const INTERNAL_BOT_SECRET = process.env.INTERNAL_BOT_SECRET || "SH-BOT-SECRET-2026";

// Cierre VULN-15: Set en memoria de los últimos 500 whatsappMsgId para descartar reintentos en < 1ms
const ultimosWhatsappMsgIds = new Set<string>();
function esWhatsappMsgIdDuplicado(msgId?: string | null): boolean {
  if (!msgId) return false;
  if (ultimosWhatsappMsgIds.has(msgId)) return true;
  ultimosWhatsappMsgIds.add(msgId);
  if (ultimosWhatsappMsgIds.size > 500) {
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
        messages: [{ topic: `realtime:sala:${salaId}`, event: evento, payload }],
      }),
    }).catch(() => {});
  } catch {
    // No bloqueante
  }
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
    if (body.whatsappMsgId && esWhatsappMsgIdDuplicado(body.whatsappMsgId)) {
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

      const textoPlano =
        `📋 *PLANO DE JUGADAS / PREJUGADAS*\n` +
        `🏇 *${hipodromo}* — Carrera #${numCarrera}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `${lineas}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `💰 *Total Jugado:* $${formatearMontoRegional(totalPactado)} (${lista.length} tickets)`;

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
      const textoResultado =
        `🏁 *SENTENCIA OFICIAL — ${hipodromo} C${numCarrera}*\n` +
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

      return NextResponse.json({
        ok: true,
        textoResultado,
        positivos,
        negativos,
        pizarra: numeros,
        enviadoWhatsApp: false,
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
    if (!sala) {
      const { data: grp } = await supabaseAdmin
        .from("grupos")
        .select("id")
        .eq("whatsapp_group_id", groupJid)
        .limit(1)
        .maybeSingle();
      if (grp?.id) {
        const { data: sGrp } = await supabaseAdmin
          .from("salas_juego")
          .select("*")
          .eq("grupo_id", grp.id)
          .eq("activa", true)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        sala = sGrp || null;
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
    if (!quotedMsgId) {
      const preAnalisis = analizarYEstandarizarJugada(textoUsuarioLimpio, 999999);
      if (!preAnalisis.esIntencionDeJugada) {
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
          origen_canal: "whatsapp",
          origen: "WHATSAPP",
        });
        await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });

        return NextResponse.json({
          ok: true,
          tipo: "CHARLA",
          respuestaGrupo: null,
          mensajePrivadoAutor: null,
        });
      }
    }

    // 2. Identificar al jugador estrictamente en `public.clientes` del `grupo_id` de la sala (SIN pushName ni auto-creación)
    const participantAlt = String(body.participantAlt || "");
    const telefonoRealProp = String(body.telefonoReal || "");

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

    let cliente: any =
      body.clientePreviamenteIdentificado?.id &&
      body.clientePreviamenteIdentificado?.grupo_id === grupoId
        ? body.clientePreviamenteIdentificado
        : null;

    // A. Búsqueda exacta por JID o teléfono normalizado dentro del grupo_id
    if (!cliente && (participantJid || participantAlt || telReal)) {
      const orConds = [];
      if (participantJid) orConds.push(`whatsapp_jid.eq.${participantJid}`);
      if (participantAlt && participantAlt !== participantJid) orConds.push(`whatsapp_jid.eq.${participantAlt}`);
      if (telReal && telReal.length >= 7) orConds.push(`telefono_normalizado.eq.${telReal}`);
      if (telAlt && telAlt !== telReal && telAlt.length >= 7) orConds.push(`telefono_normalizado.eq.${telAlt}`);

      if (orConds.length > 0) {
        const { data: clPorJidOTel } = await supabaseAdmin
          .from("clientes")
          .select(
            "id, grupo_id, nombre, seudonimo, saldo_actual, saldo_retenido, saldo_disponible, libre, aval, whatsapp_jid, telefono, telefono_normalizado"
          )
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

    // B. Búsqueda por sufijo numérico (últimos 8 dígitos de teléfono real) dentro del grupo_id
    if (!cliente && telReal && telReal.length >= 7) {
      const sufijo8 = telReal.slice(-8);
      const { data: clPorSufijo } = await supabaseAdmin
        .from("clientes")
        .select(
          "id, grupo_id, nombre, seudonimo, saldo_actual, saldo_retenido, saldo_disponible, libre, aval, whatsapp_jid, telefono, telefono_normalizado"
        )
        .eq("grupo_id", grupoId)
        .ilike("telefono", `%${sufijo8}%`)
        .order("saldo_actual", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (clPorSufijo) {
        cliente = clPorSufijo;
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

    // Vincular automáticamente el whatsapp_jid (@lid o jid actual) en la ficha del cliente para consultas instantáneas futuras
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
      await supabaseAdmin.from("clientes").update(updatesCl).eq("id", cliente.id);
      cliente.whatsapp_jid = participantJid;
      if (telReal) cliente.telefono_normalizado = telReal;
    }

    const saldoDisponible = calcularSaldoDisponible(cliente);
    if (!cliente.libre && (cliente.saldo_disponible == null || Number(cliente.saldo_disponible) !== saldoDisponible)) {
      await supabaseAdmin.from("clientes").update({ saldo_disponible: saldoDisponible }).eq("id", cliente.id);
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
              origen_canal: "whatsapp",
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
          origen_canal: "whatsapp",
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

        // Cancelar únicamente esa propuesta específica (cancelar_propuesta_proponente_atomica)
        const remanenteRetirar = Number(propMsg.monto_disponible ?? propMsg.monto_original ?? 0);
        await supabaseAdmin
          .from("chat_mensajes")
          .update({ estado_propuesta: "cancelada", monto_disponible: 0 })
          .eq("id", propMsg.id);

        if (!cliente.libre && remanenteRetirar > 0) {
          const nuevoRet = Math.max(0, Number((Number(cliente.saldo_retenido || 0) - remanenteRetirar).toFixed(2)));
          await supabaseAdmin
            .from("clientes")
            .update({
              saldo_retenido: nuevoRet,
              saldo_disponible: Math.max(
                0,
                Number((Number(cliente.saldo_actual || 0) + Number(cliente.aval || 0) - nuevoRet).toFixed(2))
              ),
            })
            .eq("id", cliente.id);
        }

        const jugadaTexto = propMsg.jugada_estandarizada || propMsg.contenido || "propuesta";
        const msgRetiroCita = `🚫 *Se Fue* — ${nombreJugador} retiró su propuesta (${jugadaTexto}).`;
        await supabaseAdmin.from("chat_mensajes").insert({
          grupo_id: grupoId,
          sala_id: salaId,
          remitente_nombre: "🤖 ASISTENTE DE SALA",
          es_operador: true,
          tipo_mensaje: "concrecion_fifo",
          contenido: msgRetiroCita,
          whatsapp_msg_id: whatsappMsgId || null,
          whatsapp_group_jid: groupJid || null,
          whatsapp_group_nombre: whatsappGroupNombre || null,
          origen_canal: "whatsapp",
        });

        await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });

        return NextResponse.json({
          ok: true,
          tipo: "RETIRO_PROPUESTA_ESPECIFICA",
          respuestaGrupo: msgRetiroCita,
          msg_publico: msgRetiroCita,
          msg_publico_bot: msgRetiroCita,
          respuestaPublica: msgRetiroCita,
          mensajePrivadoAutor: `✅ Tu propuesta (${jugadaTexto}) fue retirada ("Se fue"). Saldo liberado: $${formatearMontoRegional(remanenteRetirar)}.`,
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
            origen_canal: "whatsapp",
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
          return NextResponse.json({
            ok: false,
            tipo: "SIN_SALDO",
            respuestaGrupo: `*Nada Aquí* — ${nombreJugador} no posee saldo disponible ($0,00)`,
            mensajePrivadoAutor: `"Atento", no publique jugadas por encima de saldo disponible, nos agrada tenerlo en este grupo`,
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
            return NextResponse.json({
              ok: false,
              tipo: "SIN_SALDO",
              respuestaGrupo: `${nombreJugador} solo dispone de $0 para esta jugada.`,
              mensajePrivadoAutor: `"Atento", no publique jugadas por encima de saldo disponible, nos agrada tenerlo en este grupo`,
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
            origen_canal: "whatsapp",
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
              origen_canal: "whatsapp",
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

        const jugadaTexto = propFresca.jugada_estandarizada || propFresca.contenido;
        let respuestaGrupo = "";
        let mensajePrivadoAutor = "";

        if (evalConcrecion.excedioSaldo) {
          // Regla estricta: si el aceptante supera su saldo
          respuestaGrupo = `Esta jugada solo por $${formatearMontoRegional(saldoDispAceptante)} — *Aquí Jugaron*`;
          mensajePrivadoAutor = `"Atento", no publique jugadas por encima de saldo disponible, nos agrada tenerlo en este grupo`;
        } else if (llenoRemanenteParcial && nuevoRemanente === 0) {
          // Regla estricta: si llena un remanente parcial (ej. quedaban $10 de $100)
          respuestaGrupo =
            `Solo quedaban $${formatearMontoRegional(remanenteDisponible)} disponibles en esta jugada — *Aquí Jugaron*\n` +
            `✅ *${nombreJugador}* completó los últimos *$${formatearMontoRegional(montoEfectivo)}* con *${propFresca.remitente_nombre}* (${jugadaTexto}). ¡Jugada 100% pactada!`;
          mensajePrivadoAutor =
            `✅ *Confirmación de Jugada*: Tomaste el remanente final de *$${formatearMontoRegional(montoEfectivo)}* contra *${propFresca.remitente_nombre}* en *${jugadaTexto}*.`;
        } else {
          respuestaGrupo =
            `🤝 *Aquí Jugaron* — *${nombreJugador}* jugó *$${formatearMontoRegional(montoEfectivo)}* con *${propFresca.remitente_nombre}* (${jugadaTexto}).` +
            (nuevoRemanente > 0
              ? `\n⏳ Quedan *$${formatearMontoRegional(nuevoRemanente)}* disponibles en esta parada.`
              : `\n✅ ¡Parada completada al 100%!`);
          mensajePrivadoAutor =
            `✅ *Confirmación de Jugada*: Pactaste *$${formatearMontoRegional(montoEfectivo)}* contra *${propFresca.remitente_nombre}* en *${jugadaTexto}*.`;
        }

        const mensajePrivadoProponente =
          `🔔 *Confirmación de Jugada*: *${nombreJugador}* tomó *$${formatearMontoRegional(montoEfectivo)}* de tu propuesta (*${jugadaTexto}*). ` +
          (nuevoRemanente > 0
            ? `Quedan *$${formatearMontoRegional(nuevoRemanente)}* disponibles.`
            : `¡Tu jugada de $${formatearMontoRegional(Number(propFresca.monto_original || montoEfectivo))} fue completada al 100%!`);

        const msgPublicoFinal =
          (resRpcData as any)?.msg_publico ||
          (resRpcData as any)?.msg_publico_bot ||
          (resRpcData as any)?.respuestaPublica ||
          respuestaGrupo;

        const msgPrivAceptante =
          (resRpcData as any)?.msg_privado_aceptante ||
          (resRpcData as any)?.msg_privado_bot ||
          (resRpcData as any)?.alertaPrivada ||
          mensajePrivadoAutor;

        const msgPrivProponente =
          (resRpcData as any)?.msg_privado_proponente ||
          mensajePrivadoProponente;

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
          origen_canal: "whatsapp",
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

      // Cancela en bloque TODAS las propuestas abiertas vigentes de ese jugador en la sala/carrera actual
      let qAbiertas = supabaseAdmin
        .from("chat_mensajes")
        .select("id, monto_disponible")
        .eq("sala_id", salaId)
        .eq("remitente_id", cliente.id)
        .in("estado_propuesta", ["abierta", "parcial"])
        .gt("monto_disponible", 0);

      if (sala.carrera_activa_id) {
        qAbiertas = qAbiertas.eq("carrera_id", sala.carrera_activa_id);
      }

      const { data: abiertas } = await qAbiertas;

      let liberado = 0;
      for (const p of abiertas || []) {
        liberado += Number(p.monto_disponible || 0);
        await supabaseAdmin
          .from("chat_mensajes")
          .update({ estado_propuesta: "cancelada", monto_disponible: 0 })
          .eq("id", p.id);
      }

      if (!cliente.libre && liberado > 0) {
        const nuevoRet = Math.max(0, Number((Number(cliente.saldo_retenido || 0) - liberado).toFixed(2)));
        await supabaseAdmin
          .from("clientes")
          .update({
            saldo_retenido: nuevoRet,
            saldo_disponible: Math.max(
              0,
              Number((Number(cliente.saldo_actual || 0) + Number(cliente.aval || 0) - nuevoRet).toFixed(2))
            ),
          })
          .eq("id", cliente.id);
      }

      const msgPublicoRetiro = `🚫 *Se Fue* — Todas las propuestas abiertas de ${nombreJugador} fueron retiradas.`;
      await supabaseAdmin.from("chat_mensajes").insert({
        grupo_id: grupoId,
        sala_id: salaId,
        remitente_nombre: "🤖 ASISTENTE DE SALA",
        es_operador: true,
        tipo_mensaje: "concrecion_fifo",
        contenido: msgPublicoRetiro,
        whatsapp_msg_id: whatsappMsgId || null,
        whatsapp_group_jid: groupJid || null,
        whatsapp_group_nombre: whatsappGroupNombre || null,
        origen_canal: "whatsapp",
      });

      await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });

      return NextResponse.json({
        ok: true,
        tipo: "RETIRO_PROPUESTAS",
        respuestaGrupo: msgPublicoRetiro,
        msg_publico: msgPublicoRetiro,
        msg_publico_bot: msgPublicoRetiro,
        respuestaPublica: msgPublicoRetiro,
        mensajePrivadoAutor: `✅ Todas tus propuestas abiertas fueron retiradas ("Se fue"). Saldo liberado: $${formatearMontoRegional(liberado)}.`,
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

    // Analizar con `evaluarMensajePedagogico`
    const retirados = Array.isArray(sala.retirados) ? sala.retirados : [];
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
        origen_canal: "whatsapp",
        origen: "WHATSAPP",
      });
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
        senderJid: participantJid,
      });
    }

    // Caso: Publicó jugada por encima de su saldo y tiene $0 disponible
    if (!analisis.valido && analisis.excedioSaldo) {
      const msgPubExceso = `*Nada Aquí* — ${nombreJugador} no posee saldo disponible ($0,00)`;
      const msgPrivExceso = `"Atento", no publique jugadas por encima de saldo disponible, nos agrada tenerlo en este grupo`;
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
          usuario_id: cliente.id,
          origen: "whatsapp",
        });
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
        senderJid: participantJid,
      });
    }

    // Bloqueo estricto: Si el cliente no posee saldo disponible
    if (saldoDisponible <= 0 && !cliente.libre) {
      const msgSinSaldo = `*Nada Aquí* — ${nombreJugador} no posee saldo disponible ($0,00)`;
      const msgPrivSinSaldo = '"Atento", no publique jugadas por encima de saldo disponible, nos agrada tenerlo en este grupo';
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
        origen_canal: "whatsapp",
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
        senderJid: participantJid,
      });
    }

    // Determinar monto a publicar (topado a saldoDisponible si excedió su saldo)
    const excedioSaldo = Boolean(analisis.excedioSaldo || analisis.monto > saldoDisponible);
    const montoAPublicar = excedioSaldo
      ? Math.max(0, Number(saldoDisponible.toFixed(2)))
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

    if (!rpcPublicado || !propId) {
      const msgErrPub = (rpcResFinal as any)?.msg_publico || (rpcResFinal as any)?.msg_publico_bot || "🚫 *Error al publicar propuesta* — Intente nuevamente.";
      const msgErrPriv = (rpcResFinal as any)?.msg_privado_proponente || (rpcResFinal as any)?.msg_privado_bot || (rpcResFinal as any)?.alertaPrivada || "La propuesta no pudo ser registrada de forma atómica.";
      return NextResponse.json({
        ok: false,
        tipo: "PROPUESTA_ERROR",
        respuestaGrupo: msgErrPub,
        msg_publico: msgErrPub,
        msg_publico_bot: msgErrPub,
        respuestaPublica: msgErrPub,
        mensajePrivadoAutor: msgErrPriv,
        msg_privado_bot: msgErrPriv,
        msg_privado_proponente: msgErrPriv,
        alertaPrivada: (rpcResFinal as any)?.alertaPrivada || null,
        notificaciones_privadas: (rpcResFinal as any)?.notificaciones_privadas || [],
        senderJid: participantJid,
      });
    }

    await supabaseAdmin
      .from("chat_mensajes")
      .update({
        whatsapp_msg_id: whatsappMsgId,
        whatsapp_group_jid: groupJid,
        whatsapp_group_nombre: whatsappGroupNombre,
        origen_canal: "whatsapp",
      })
      .eq("id", propId);

    await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });

    // Si publicó por encima de su saldo_disponible, devolver los textos exactos requeridos
    if (excedioSaldo) {
      const msgPubRecorte = `⚠️ *${nombreJugador}*: Disponible $${formatearMontoRegional(saldoDisponible)}`;
      const msgPrivRecorte = (rpcResFinal as any)?.msg_privado_proponente || (rpcResFinal as any)?.msg_privado_bot || (rpcResFinal as any)?.alertaPrivada || `"Atento", no publique jugadas por encima de saldo disponible, nos agrada tenerlo en este grupo`;
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
        senderJid: participantJid,
      });
    }

    const msgPublicoRpc =
      (rpcResFinal as any)?.msg_publico ||
      (rpcResFinal as any)?.msg_publico_bot ||
      (rpcResFinal as any)?.respuestaPublica ||
      analisis.msgPublicoBot ||
      null;

    const msgPrivadoRpc =
      (rpcResFinal as any)?.msg_privado_proponente ||
      (rpcResFinal as any)?.msg_privado_bot ||
      (rpcResFinal as any)?.alertaPrivada ||
      analisis.msgPrivadoBot ||
      null;

    return NextResponse.json({
      ok: true,
      tipo: "PROPUESTA",
      propuestaId: propId,
      jugadaEstandarizada: analisis.jugadaEstandarizada,
      montoPublicado: montoAPublicar,
      reaccionEmoji: "🏇",
      respuestaGrupo: msgPublicoRpc,
      msg_publico: msgPublicoRpc,
      msg_publico_bot: msgPublicoRpc,
      respuestaPublica: msgPublicoRpc,
      mensajePrivadoAutor: msgPrivadoRpc,
      msg_privado_bot: msgPrivadoRpc,
      msg_privado_proponente: msgPrivadoRpc,
      alertaPrivada: (rpcResFinal as any)?.alertaPrivada || null,
      notificaciones_privadas: (rpcResFinal as any)?.notificaciones_privadas || [],
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
