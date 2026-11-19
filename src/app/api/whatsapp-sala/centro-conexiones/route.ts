import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/core/supabase-admin";
import {
  autenticarPeticionSala,
  grupoPermitido,
  type IdentidadSala,
} from "@/features/sala-juegos/lib/sala-auth";
import { obtenerSecretoInternoBot } from "@/features/whatsapp-sala/lib/bot-secret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Centro de Conexiones 1-a-1 (Sala ⇄ Grupo de WhatsApp).
 *
 * - Protegido por sesión de staff (nunca se pide ni se envía el secreto del bot desde el navegador).
 * - El secreto interno (`INTERNAL_BOT_SECRET`) solo se lee en el servidor (helper `bot-secret`) y solo se inyecta
 *   al hablar con el demonio Baileys.
 */

const BOT_DAEMON_URL =
  process.env.BOT_DAEMON_URL || process.env.BOT_WHATSAPP_DAEMON_URL || "http://127.0.0.1:3005";
const TIMEOUT_BOT_MS = 4000;

interface GrupoBot {
  jid: string;
  nombre: string;
  participantes: number;
}

interface EstadoBot {
  online: boolean;
  conectado: boolean;
  numero: string | null;
  grupos: GrupoBot[];
  error?: string;
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function autenticarStaff(
  req: Request
): Promise<{ identidad: IdentidadSala } | { respuesta: NextResponse }> {
  const auth = await autenticarPeticionSala(req);
  if (!auth.ok || !auth.identidad) {
    return {
      respuesta: json({ ok: false, error: auth.error || "No autorizado." }, auth.status || 401),
    };
  }
  const identidad = auth.identidad;
  if (identidad.tipo !== "STAFF" || !(identidad.esAdmin || identidad.esOperador)) {
    return { respuesta: json({ ok: false, error: "Solo el personal puede gestionar conexiones." }, 403) };
  }
  if (!identidad.esAdmin && !identidad.grupoId) {
    return { respuesta: json({ ok: false, error: "Tu usuario no tiene un grupo asignado." }, 403) };
  }
  return { identidad };
}

async function fetchBot(path: string): Promise<any> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "x-internal-bot-secret": obtenerSecretoInternoBot(),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_BOT_MS);
  try {
    const res = await fetch(`${BOT_DAEMON_URL}${path}`, {
      method: "GET",
      headers,
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function normalizarGrupos(lista: unknown): GrupoBot[] {
  if (!Array.isArray(lista)) return [];
  const vistos = new Set<string>();
  const salida: GrupoBot[] = [];
  for (const g of lista as any[]) {
    const jid = String(g?.jid || g?.id || "").trim();
    if (!jid || vistos.has(jid)) continue;
    vistos.add(jid);
    salida.push({
      jid,
      nombre: String(g?.nombre || g?.subject || jid),
      participantes: Number(g?.participantes) || 0,
    });
  }
  return salida.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

/** Estado en vivo de Baileys con timeout de 4s y fallback elegante si el demonio está caído. */
async function obtenerEstadoBot(): Promise<EstadoBot> {
  const [status, groups] = await Promise.allSettled([fetchBot("/status"), fetchBot("/groups")]);

  if (status.status === "rejected" && groups.status === "rejected") {
    return {
      online: false,
      conectado: false,
      numero: null,
      grupos: [],
      error: "El demonio de WhatsApp no responde (puerto 3005).",
    };
  }

  const st = status.status === "fulfilled" ? status.value : null;
  const gr = groups.status === "fulfilled" ? groups.value : null;
  const conectado = Boolean(gr?.conectado ?? st?.conectado);
  const grupos = normalizarGrupos(gr?.grupos?.length ? gr.grupos : st?.grupos);

  return {
    online: true,
    conectado,
    numero: String(gr?.numeroVinculado || st?.numeroVinculado || st?.numero || "") || null,
    grupos,
    error: conectado ? undefined : "WhatsApp no está vinculado (sin sesión activa).",
  };
}

async function nombresDeGrupos(ids: string[]): Promise<Record<string, string>> {
  const mapa: Record<string, string> = {};
  if (ids.length === 0) return mapa;
  for (const tabla of ["grupos_venta", "grupos"]) {
    const { data, error } = await supabaseAdmin.from(tabla).select("id, nombre").in("id", ids);
    if (!error && Array.isArray(data) && data.length > 0) {
      for (const g of data as any[]) mapa[String(g.id)] = String(g.nombre || "");
      break;
    }
  }
  return mapa;
}

async function contarClientesConTelefono(grupoId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("clientes")
    .select("id", { count: "exact", head: true })
    .eq("grupo_id", grupoId)
    .not("telefono", "is", null)
    .neq("telefono", "");
  if (error) return 0;
  return count || 0;
}

async function cargarSalasPermitidas(identidad: IdentidadSala, salaId?: string) {
  let q = supabaseAdmin
    .from("salas_juego")
    .select(
      "id, grupo_id, nombre_sala, orden_sala, estado_carrera, carrera_activa_id, hipodromo_activo, numero_carrera_activa, whatsapp_group_jid, whatsapp_group_nombre"
    )
    .eq("activa", true);
  if (salaId) q = q.eq("id", salaId);
  if (!identidad.esAdmin && identidad.grupoId) q = q.eq("grupo_id", identidad.grupoId);
  const { data, error } = await q.order("grupo_id", { ascending: true }).order("orden_sala", {
    ascending: true,
  });
  if (error) throw new Error(error.message);
  return (data || []) as any[];
}

export async function GET(req: NextRequest) {
  const a = await autenticarStaff(req);
  if ("respuesta" in a) return a.respuesta;

  try {
    const [salas, bot] = await Promise.all([cargarSalasPermitidas(a.identidad), obtenerEstadoBot()]);

    const salaIds = salas.map((s) => String(s.id));
    const grupoIds = Array.from(new Set(salas.map((s) => String(s.grupo_id || "")).filter(Boolean)));

    const [vinculosRes, nombres, conteos] = await Promise.all([
      salaIds.length
        ? supabaseAdmin
            .from("salas_whatsapp_grupos")
            .select("id, sala_id, grupo_id, whatsapp_group_jid, whatsapp_group_nombre, estado_conexion, activo, updated_at")
            .eq("activo", true)
        : Promise.resolve({ data: [] as any[], error: null }),
      nombresDeGrupos(grupoIds),
      Promise.all(grupoIds.map(async (g) => [g, await contarClientesConTelefono(g)] as const)),
    ]);

    // Vínculos de TODAS las salas (necesario para etiquetar "En uso por"), sin exponer más que jid/sala.
    const vinculos = ((vinculosRes.data || []) as any[]).map((v) => ({
      id: v.id,
      sala_id: v.sala_id,
      grupo_id: v.grupo_id,
      whatsapp_group_jid: v.whatsapp_group_jid,
      whatsapp_group_nombre: v.whatsapp_group_nombre,
      estado_conexion: v.estado_conexion,
      activo: v.activo,
    }));

    // Nombre de sala que ocupa cada JID (incluye salas fuera de mi alcance, solo para la etiqueta).
    const salaIdsVinculadas = Array.from(new Set(vinculos.map((v) => String(v.sala_id))));
    const nombresSalaMap: Record<string, string> = {};
    if (salaIdsVinculadas.length) {
      const { data: salasVinc } = await supabaseAdmin
        .from("salas_juego")
        .select("id, nombre_sala")
        .in("id", salaIdsVinculadas);
      for (const s of (salasVinc || []) as any[]) nombresSalaMap[String(s.id)] = String(s.nombre_sala || "");
    }

    return json({
      ok: true,
      salas: salas.map((s) => ({
        ...s,
        grupo_nombre: nombres[String(s.grupo_id)] || null,
      })),
      vinculos: vinculos.map((v) => {
        // Un operador no-admin no puede mover grupos de otra banca ni ver el nombre de sus salas.
        const bloqueado = !a.identidad.esAdmin && String(v.grupo_id || "") !== String(a.identidad.grupoId || "");
        return {
          ...v,
          bloqueado,
          sala_nombre: bloqueado ? "otra banca" : nombresSalaMap[String(v.sala_id)] || null,
        };
      }),
      clientesPorGrupo: Object.fromEntries(conteos),
      bot,
      generadoEn: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[CENTRO_CONEXIONES_ERROR] GET", err);
    return json({ ok: false, error: err?.message || "No se pudo cargar el centro de conexiones." }, 500);
  }
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin && !origin.includes(host || "")) {
    return json({ ok: false, error: "CSRF bloqueado" }, 403);
  }

  const a = await autenticarStaff(req);
  if ("respuesta" in a) return a.respuesta;
  const { identidad } = a;

  const body = await req.json().catch(() => ({} as Record<string, any>));
  const accion = String(body?.accion || "");
  const salaId = String(body?.salaId || "").trim();
  if (!salaId) return json({ ok: false, error: "salaId es requerido." }, 400);

  let sala: any;
  try {
    const salas = await cargarSalasPermitidas(identidad, salaId);
    sala = salas[0];
  } catch (err: any) {
    return json({ ok: false, error: err?.message || "No se pudo leer la sala." }, 500);
  }
  if (!sala || !grupoPermitido(identidad, String(sala.grupo_id || ""))) {
    return json({ ok: false, error: "Sala no encontrada o sin permiso." }, 404);
  }

  try {
    // ------------------------------------------------------------------ VINCULAR
    if (accion === "vincular") {
      const whatsappGroupJid = String(body?.whatsappGroupJid || "").trim();
      const whatsappGroupNombre = String(body?.whatsappGroupNombre || "").trim() || null;
      if (!whatsappGroupJid.endsWith("@g.us")) {
        return json({ ok: false, error: "whatsappGroupJid inválido (debe terminar en @g.us)." }, 400);
      }
      // El grupo/banca sale SIEMPRE de la sala, nunca del body.
      const grupoId = String(sala.grupo_id);
      if (body?.grupoId && String(body.grupoId) !== grupoId) {
        return json({ ok: false, error: "grupoId no coincide con la sala." }, 400);
      }

      // Dueño actual del JID (para limpiar el espejo en salas_juego tras mover).
      const { data: previo } = await supabaseAdmin
        .from("salas_whatsapp_grupos")
        .select("sala_id, grupo_id")
        .eq("whatsapp_group_jid", whatsappGroupJid)
        .maybeSingle();
      const salaPrevia = previo?.sala_id ? String(previo.sala_id) : null;
      if (previo && !identidad.esAdmin && String(previo.grupo_id || "") !== grupoId) {
        return json({ ok: false, error: "Ese grupo de WhatsApp está en uso por otra banca." }, 403);
      }

      // 1-a-1: la sala solo puede tener un grupo → eliminar otros vínculos de esta sala.
      await supabaseAdmin
        .from("salas_whatsapp_grupos")
        .delete()
        .eq("sala_id", salaId)
        .neq("whatsapp_group_jid", whatsappGroupJid);

      const { error } = await supabaseAdmin.from("salas_whatsapp_grupos").upsert(
        {
          grupo_id: grupoId,
          sala_id: salaId,
          whatsapp_group_jid: whatsappGroupJid,
          whatsapp_group_nombre: whatsappGroupNombre,
          estado_conexion: "conectado",
          activo: true,
        },
        { onConflict: "whatsapp_group_jid" }
      );
      if (error) {
        console.error("[CENTRO_CONEXIONES_ERROR] vincular", error);
        return json({ ok: false, error: error.message }, 500);
      }

      // Espejo best-effort (el trigger de BD ya sincroniza; esto solo cubre triggers ausentes).
      const ahora = new Date().toISOString();
      try {
        if (salaPrevia && salaPrevia !== salaId) {
          await supabaseAdmin
            .from("salas_juego")
            .update({ whatsapp_group_jid: null, whatsapp_group_nombre: null, updated_at: ahora })
            .eq("id", salaPrevia)
            .eq("whatsapp_group_jid", whatsappGroupJid);
        }
        await supabaseAdmin
          .from("salas_juego")
          .update({ whatsapp_group_jid: whatsappGroupJid, whatsapp_group_nombre: whatsappGroupNombre, updated_at: ahora })
          .eq("id", salaId);
      } catch (e) {
        console.error("[CENTRO_CONEXIONES_ERROR] espejo salas_juego", e);
      }

      return json({ ok: true, movidoDesdeSalaId: salaPrevia && salaPrevia !== salaId ? salaPrevia : null });
    }

    // --------------------------------------------------------------- DESVINCULAR
    if (accion === "desvincular") {
      const { error } = await supabaseAdmin.from("salas_whatsapp_grupos").delete().eq("sala_id", salaId);
      if (error) {
        console.error("[CENTRO_CONEXIONES_ERROR] desvincular", error);
        return json({ ok: false, error: error.message }, 500);
      }
      try {
        await supabaseAdmin
          .from("salas_juego")
          .update({ whatsapp_group_jid: null, whatsapp_group_nombre: null, updated_at: new Date().toISOString() })
          .eq("id", salaId);
      } catch (e) {
        console.error("[CENTRO_CONEXIONES_ERROR] espejo salas_juego", e);
      }
      return json({ ok: true });
    }

    // -------------------------------------------------------------------- PROBAR
    if (accion === "probar") {
      const t0 = Date.now();
      const checks: Array<{ nombre: string; ok: boolean; detalle: string }> = [];

      // 1. Vínculo activo sincronizado con salas_juego
      const { data: vinculo } = await supabaseAdmin
        .from("salas_whatsapp_grupos")
        .select("whatsapp_group_jid, whatsapp_group_nombre, activo")
        .eq("sala_id", salaId)
        .eq("activo", true)
        .limit(1)
        .maybeSingle();
      const jid = vinculo?.whatsapp_group_jid ? String(vinculo.whatsapp_group_jid) : "";
      const sincronizado = Boolean(jid) && String(sala.whatsapp_group_jid || "") === jid;
      checks.push({
        nombre: "Vínculo sala ⇄ grupo",
        ok: sincronizado,
        detalle: !jid
          ? "La sala no tiene un grupo de WhatsApp vinculado."
          : sincronizado
          ? `Vinculada con "${vinculo?.whatsapp_group_nombre || jid}".`
          : "El vínculo existe pero salas_juego.whatsapp_group_jid no coincide (desincronizado).",
      });

      // 2. Bot conectado y presente en el grupo
      const bot = await obtenerEstadoBot();
      const presente = Boolean(jid) && bot.grupos.some((g) => g.jid === jid);
      checks.push({
        nombre: "Bot en el grupo",
        ok: bot.online && bot.conectado && presente,
        detalle: !bot.online
          ? "El demonio de WhatsApp no responde."
          : !bot.conectado
          ? "El bot no tiene sesión de WhatsApp activa."
          : !jid
          ? "No hay grupo vinculado que verificar."
          : presente
          ? "El bot está conectado y es participante del grupo."
          : "El bot está conectado pero NO aparece en ese grupo.",
      });

      // 3. Carrera abierta con ID
      const abierta = String(sala.estado_carrera || "").toLowerCase() === "abierta";
      const tieneId = Boolean(sala.carrera_activa_id);
      checks.push({
        nombre: "Carrera abierta",
        ok: abierta && tieneId,
        detalle: !abierta
          ? `La carrera está "${sala.estado_carrera || "sin estado"}".`
          : !tieneId
          ? "Carrera abierta pero sin carrera_activa_id (se resolverá al concretar)."
          : `${sala.hipodromo_activo || "Hipódromo"} · Carrera ${sala.numero_carrera_activa || "?"} abierta.`,
      });

      // 4. Al menos un cliente con teléfono válido
      let telefonosValidos = 0;
      if (sala.grupo_id) {
        const { data: tels } = await supabaseAdmin
          .from("clientes")
          .select("telefono")
          .eq("grupo_id", sala.grupo_id)
          .not("telefono", "is", null)
          .neq("telefono", "")
          .limit(200);
        telefonosValidos = ((tels || []) as any[]).filter(
          (c) => String(c.telefono || "").replace(/\D/g, "").length >= 7
        ).length;
      }
      checks.push({
        nombre: "Nómina con teléfonos",
        ok: telefonosValidos > 0,
        detalle:
          telefonosValidos > 0
            ? `Hay clientes con teléfono válido en el grupo.`
            : "Ningún cliente del grupo tiene teléfono válido: las jugadas darían SIN_REGISTRO.",
      });

      return json({
        ok: checks.every((c) => c.ok),
        latenciaMs: Date.now() - t0,
        checks,
      });
    }

    return json({ ok: false, error: `Acción no soportada: ${accion || "(vacía)"}` }, 400);
  } catch (err: any) {
    console.error("[CENTRO_CONEXIONES_ERROR] POST", accion, err);
    return json({ ok: false, error: err?.message || "Error interno." }, 500);
  }
}
