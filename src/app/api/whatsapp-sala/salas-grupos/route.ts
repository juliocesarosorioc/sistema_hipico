import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/core/supabase-admin";
import { obtenerSecretoInternoBot } from "@/features/whatsapp-sala/lib/bot-secret";

export const dynamic = "force-dynamic";

const BOT_DAEMON_URL =
  process.env.BOT_DAEMON_URL || process.env.WHATSAPP_BOT_URL || "http://127.0.0.1:3005";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const grupoId = searchParams.get("grupoId") || searchParams.get("grupo_id") || "";
    const salaId = searchParams.get("salaId") || searchParams.get("sala_id") || "";

    const { data: gruposSistema } = await supabaseAdmin
      .from("grupos_venta")
      .select("id, nombre, moneda, activo")
      .eq("activo", true)
      .order("created_at", { ascending: true });

    let qSalas = supabaseAdmin
      .from("salas_juego")
      .select("*")
      .eq("activa", true)
      .order("orden_sala", { ascending: true });

    if (grupoId) {
      const gIds = grupoId.split(",").map((x) => x.trim()).filter(Boolean);
      if (gIds.length === 1) {
        qSalas = qSalas.eq("grupo_id", gIds[0]).limit(2);
      } else if (gIds.length > 1) {
        qSalas = qSalas.in("grupo_id", gIds);
      }
    }
    if (salaId) {
      qSalas = qSalas.eq("id", salaId);
    }

    const { data: salasRaw, error: errSalas } = await qSalas;
    if (errSalas) {
      return NextResponse.json({ ok: false, salas: [], gruposSistema: [], vinculosGlobales: [], motivo: errSalas.message }, { status: 200 });
    }

    const salaIds = (salasRaw || []).map((s: any) => s.id);
    let vinculosPorSala: Record<string, any[]> = {};

    if (salaIds.length > 0) {
      const { data: vinculos, error: errVinc } = await supabaseAdmin
        .from("salas_whatsapp_grupos")
        .select("*")
        .in("sala_id", salaIds)
        .eq("activo", true)
        .order("updated_at", { ascending: true });

      if (errVinc) {
        console.error("Error al obtener vinculosPorSala:", errVinc);
      }

      for (const v of vinculos || []) {
        if (!vinculosPorSala[v.sala_id]) vinculosPorSala[v.sala_id] = [];
        vinculosPorSala[v.sala_id].push(v);
      }
    }

    const { data: todosVinculosRaw, error: errTodosVinc } = await supabaseAdmin
      .from("salas_whatsapp_grupos")
      .select("id, sala_id, grupo_id, whatsapp_group_jid, whatsapp_group_nombre, estado_conexion, activo, updated_at")
      .eq("activo", true);

    if (errTodosVinc) {
      console.error("Error al obtener todosVinculosRaw:", errTodosVinc);
    }

    const { data: todasSalasRaw } = await supabaseAdmin
      .from("salas_juego")
      .select("id, nombre_sala, grupo_id, activa")
      .eq("activa", true);

    const grupoNombrePorId = new Map<string, string>();
    for (const g of gruposSistema || []) {
      if (g?.id) grupoNombrePorId.set(String(g.id), String(g.nombre || ""));
    }

    const salaInfoPorId = new Map<string, { nombre_sala: string; grupo_id: string; grupo_nombre: string }>();
    for (const s of todasSalasRaw || []) {
      const gNom = grupoNombrePorId.get(String(s.grupo_id)) || "";
      salaInfoPorId.set(String(s.id), {
        nombre_sala: String(s.nombre_sala || ""),
        grupo_id: String(s.grupo_id || ""),
        grupo_nombre: gNom,
      });
    }

    const vinculosGlobales = (todosVinculosRaw || [])
      .filter((v: any) => salaInfoPorId.has(String(v.sala_id)))
      .map((v: any) => {
        const sInfo = salaInfoPorId.get(String(v.sala_id));
        return {
          ...v,
          sala_nombre: sInfo?.nombre_sala || null,
          grupo_nombre: sInfo?.grupo_nombre || grupoNombrePorId.get(String(v.grupo_id)) || null,
        };
      });

    const vinculosPorGrupoId = new Map<string, any[]>();
    for (const v of vinculosGlobales) {
      const gId = String(v.grupo_id || "");
      if (gId) {
        if (!vinculosPorGrupoId.has(gId)) vinculosPorGrupoId.set(gId, []);
        vinculosPorGrupoId.get(gId)!.push(v);
      }
    }

    const gruposSistemaEnriquecidos = (gruposSistema || []).map((g: any) => {
      const gId = String(g.id);
      const salasDelG = (todasSalasRaw || []).filter((s: any) => String(s.grupo_id) === gId);
      const vG = vinculosPorGrupoId.get(gId) || [];
      const salasConectadasCount = salasDelG.filter((s: any) =>
        vG.some((v: any) => String(v.sala_id) === String(s.id))
      ).length;
      const nombresWa = Array.from(new Set(vG.map((v: any) => v.whatsapp_group_nombre || v.whatsapp_group_jid).filter(Boolean)));
      return {
        ...g,
        totalSalas: salasDelG.length,
        salasConectadas: salasConectadasCount,
        conectado: salasConectadasCount > 0,
        gruposWhatsappNombres: nombresWa,
      };
    });

    const salas = (salasRaw || []).map((s: any) => ({
      ...s,
      grupo_nombre: grupoNombrePorId.get(String(s.grupo_id)) || null,
      grupos_whatsapp: vinculosPorSala[s.id] || [],
    }));

    return NextResponse.json({
      ok: true,
      salas,
      gruposSistema: gruposSistemaEnriquecidos,
      vinculosGlobales,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, salas: [], gruposSistema: [], vinculosGlobales: [], motivo: err?.message || "Error consultando salas y grupos" },
      { status: 200 }
    );
  }
}

export async function POST(req: NextRequest) {
  const _origin = req.headers.get("origin");
  const _host = req.headers.get("host");
  if (_origin && !_origin.includes(_host || "")) {
    return NextResponse.json({ error: "CSRF bloqueado" }, { status: 403 });
  }
  try {
    const body = await req.json();
    const accion = String(body.accion || "");

    if (accion === "crear-sala") {
      const { grupoId, nombreSala, hipodromoActivo } = body;
      if (!grupoId) {
        return NextResponse.json({ ok: false, motivo: "grupoId es requerido" }, { status: 400 });
      }

      const { data: existentes } = await supabaseAdmin
        .from("salas_juego")
        .select("id, orden_sala")
        .eq("grupo_id", grupoId)
        .eq("activa", true)
        .order("orden_sala", { ascending: true });

      if ((existentes?.length || 0) >= 1) {
        return NextResponse.json(
          { ok: true, sala: existentes![0], motivo: "Ya existe una Sala de Juegos unificada para este grupo" },
          { status: 200 }
        );
      }

      const nombreFinal = String(nombreSala || "").trim() || "Sala de Juegos";

      const { data: creada, error: errCrear } = await supabaseAdmin
        .from("salas_juego")
        .insert({
          grupo_id: grupoId,
          nombre_sala: nombreFinal,
          orden_sala: 1,
          activa: true,
          estado_carrera: "abierta",
          hipodromo_activo: hipodromoActivo || "LA RINCONADA",
          numero_carrera_activa: 1,
        })
        .select()
        .single();

      if (errCrear) {
        return NextResponse.json({ ok: false, motivo: errCrear.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true, sala: creada, motivo: `Sala "${nombreFinal}" creada` });
    }

    if (accion === "eliminar-sala") {
      const { salaId } = body;
      if (!salaId) {
        return NextResponse.json({ ok: false, motivo: "salaId es requerido" }, { status: 400 });
      }

      await supabaseAdmin.from("salas_whatsapp_grupos").delete().eq("sala_id", salaId);
      const { error: errDel } = await supabaseAdmin
        .from("salas_juego")
        .update({ activa: false, whatsapp_group_jid: null, updated_at: new Date().toISOString() })
        .eq("id", salaId);

      if (errDel) {
        return NextResponse.json({ ok: false, motivo: errDel.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true, motivo: "Sala eliminada correctamente" });
    }

    if (accion === "limpiar-huerfanos") {
      const { salaId } = body;
      await supabaseAdmin
        .from("salas_whatsapp_grupos")
        .update({ activo: false, estado_conexion: "desconectado", updated_at: new Date().toISOString() })
        .eq("estado_conexion", "desconectado");

      if (salaId) {
        await supabaseAdmin
          .from("salas_whatsapp_grupos")
          .delete()
          .eq("sala_id", salaId);
        await supabaseAdmin
          .from("salas_juego")
          .update({ whatsapp_group_jid: null, whatsapp_group_nombre: null, updated_at: new Date().toISOString() })
          .eq("id", salaId);
      }

      try {
        await fetch(`${BOT_DAEMON_URL}/limpiar-huerfanos`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-bot-secret": obtenerSecretoInternoBot(),
          },
          body: JSON.stringify({ salaId }),
        });
      } catch {}

      return NextResponse.json({ ok: true, motivo: "Vínculos huérfanos liberados exitosamente." });
    }

    /**
     * Vinculación directa desde la pantalla de bloqueo de la Sala de Juegos.
     * Escribe SIEMPRE en `salas_juego.whatsapp_group_jid` /
     * `whatsapp_group_nombre` con service_role, sin depender de que el daemon
     * acepte `/verificar-y-vincular` (ese aviso queda como best-effort).
     */
    if (accion === "vincular-grupo-sala") {
      const { grupoId, salaId, groupJid, nombreGrupo } = body;
      const jid = String(groupJid || "").trim();
      if (!/@g\.us$/i.test(jid)) {
        return NextResponse.json(
          { ok: false, motivo: "El JID debe ser un grupo de WhatsApp válido (@g.us)" },
          { status: 400 }
        );
      }

      let salaObjetivoId = String(salaId || "").trim();
      if (!salaObjetivoId && grupoId) {
        const { data: primera } = await supabaseAdmin
          .from("salas_juego")
          .select("id")
          .eq("grupo_id", grupoId)
          .eq("activa", true)
          .order("orden_sala", { ascending: true })
          .limit(1)
          .maybeSingle();
        salaObjetivoId = String(primera?.id || "");
      }
      if (!salaObjetivoId) {
        return NextResponse.json(
          { ok: false, motivo: "No se encontró la sala de juegos a vincular" },
          { status: 400 }
        );
      }

      const nombreFinal = String(nombreGrupo || jid).trim() || jid;
      const ahora = new Date().toISOString();

      // Un mismo grupo solo puede pertenecer a una sala.
      await supabaseAdmin
        .from("salas_juego")
        .update({
          whatsapp_group_jid: null,
          whatsapp_group_nombre: null,
          updated_at: ahora,
        })
        .eq("whatsapp_group_jid", jid)
        .neq("id", salaObjetivoId);

      try {
        await supabaseAdmin.from("salas_whatsapp_grupos").upsert(
          {
            sala_id: salaObjetivoId,
            grupo_id: grupoId || null,
            whatsapp_group_jid: jid,
            whatsapp_group_nombre: nombreFinal,
            activo: true,
            estado_conexion: "conectado",
            motivo_estado: "Vinculado desde Sala de Juegos",
            updated_at: ahora,
          },
          { onConflict: "whatsapp_group_jid" }
        );
      } catch {
        /* la fuente de verdad para la Sala es `salas_juego` */
      }

      const { data: sala, error: errUpdate } = await supabaseAdmin
        .from("salas_juego")
        .update({
          whatsapp_group_jid: jid,
          whatsapp_group_nombre: nombreFinal,
          updated_at: ahora,
        })
        .eq("id", salaObjetivoId)
        .select()
        .single();

      if (errUpdate) {
        return NextResponse.json(
          { ok: false, motivo: errUpdate.message },
          { status: 500 }
        );
      }

      try {
        await fetch(`${BOT_DAEMON_URL}/verificar-y-vincular`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-bot-secret": obtenerSecretoInternoBot(),
          },
          body: JSON.stringify({ grupoId, salaId: salaObjetivoId, groupJid: jid }),
          cache: "no-store",
          signal: AbortSignal.timeout(3000),
        });
      } catch {
        /* aviso best-effort: la vinculación ya quedó persistida */
      }

      return NextResponse.json({
        ok: true,
        sala,
        groupJid: jid,
        whatsapp_group_nombre: nombreFinal,
        motivo: "Grupo de WhatsApp vinculado correctamente",
      });
    }

    if (accion === "verificar-y-vincular") {
      const { grupoId, salaId, groupJid } = body;
      if (!salaId || !groupJid) {
        return NextResponse.json(
          { ok: false, motivo: "salaId y groupJid son requeridos" },
          { status: 400 }
        );
      }

      // Regla 1 a 1: Si este grupo estaba vinculado a otra sala, desvincularla para reasignar limpiamente
      const { data: otraSala } = await supabaseAdmin
        .from("salas_juego")
        .select("id, nombre_sala")
        .eq("whatsapp_group_jid", groupJid)
        .neq("id", salaId)
        .limit(1)
        .maybeSingle();

      if (otraSala) {
        await supabaseAdmin
          .from("salas_juego")
          .update({ whatsapp_group_jid: null, whatsapp_group_nombre: null, updated_at: new Date().toISOString() })
          .eq("id", otraSala.id);
        await supabaseAdmin
          .from("salas_whatsapp_grupos")
          .update({ activo: false, estado_conexion: "desconectado", updated_at: new Date().toISOString() })
          .eq("sala_id", otraSala.id);
      }

      const { data: otroVinc } = await supabaseAdmin
        .from("salas_whatsapp_grupos")
        .select("sala_id")
        .eq("whatsapp_group_jid", groupJid)
        .neq("sala_id", salaId)
        .limit(1)
        .maybeSingle();

      if (otroVinc) {
        await supabaseAdmin
          .from("salas_whatsapp_grupos")
          .update({ activo: false, estado_conexion: "desconectado", updated_at: new Date().toISOString() })
          .eq("whatsapp_group_jid", groupJid)
          .neq("sala_id", salaId);
      }

      try {
        const resBot = await fetch(`${BOT_DAEMON_URL}/verificar-y-vincular`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-bot-secret": obtenerSecretoInternoBot(),
          },
          body: JSON.stringify({ grupoId, salaId, groupJid }),
          cache: "no-store",
        });
        const json = await resBot.json().catch(() => ({}));
        if (json?.ok) {
          await supabaseAdmin
            .from("salas_whatsapp_grupos")
            .delete()
            .eq("sala_id", salaId)
            .neq("whatsapp_group_jid", groupJid);

          await supabaseAdmin
            .from("salas_whatsapp_grupos")
            .upsert(
              {
                sala_id: salaId,
                grupo_id: grupoId || null,
                whatsapp_group_jid: groupJid,
                whatsapp_group_nombre: json?.nombreGrupo || null,
                activo: true,
                estado_conexion: "conectado",
                motivo_estado: "Conectado y verificado",
                updated_at: new Date().toISOString(),
              },
              { onConflict: "whatsapp_group_jid" }
            );

          try {
            await supabaseAdmin
              .from("salas_juego")
              .update({
                whatsapp_group_jid: groupJid,
                whatsapp_group_nombre: json?.nombreGrupo || null,
                updated_at: new Date().toISOString(),
              })
              .eq("id", salaId);
          } catch {
            // No bloqueante
          }
        }

        return NextResponse.json({
          ok: Boolean(json?.ok),
          motivo: json?.motivo || json?.error || "Sin respuesta del motor Baileys",
          nombreGrupo: json?.nombreGrupo || null,
        });
      } catch {
        return NextResponse.json({
          ok: false,
          motivo: "Motor Baileys desconectado o inaccesible en 127.0.0.1:3005",
        });
      }
    }

    if (accion === "desvincular-grupo" || accion === "desconectar_grupo_jid") {
      const { id, salaId, groupJid } = body;
      try {
        await fetch(`${BOT_DAEMON_URL}/desvincular-grupo`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-bot-secret": obtenerSecretoInternoBot(),
          },
          body: JSON.stringify({ id, salaId, groupJid }),
          cache: "no-store",
          signal: AbortSignal.timeout(3000),
        }).catch(() => {});
      } catch {
        // Fallback directo a Supabase si el daemon está offline
      }

      let qDel = supabaseAdmin.from("salas_whatsapp_grupos").delete();
      if (id) {
        qDel = qDel.eq("id", id);
      } else if (salaId && groupJid) {
        qDel = qDel.eq("sala_id", salaId).eq("whatsapp_group_jid", groupJid);
      } else if (groupJid) {
        qDel = qDel.eq("whatsapp_group_jid", groupJid);
      } else if (salaId) {
        qDel = qDel.eq("sala_id", salaId);
      } else {
        return NextResponse.json({ ok: false, motivo: "id, salaId o groupJid son requeridos" }, { status: 400 });
      }
      const { error } = await qDel;
      if (error) {
        return NextResponse.json({ ok: false, motivo: error.message }, { status: 500 });
      }

      if (salaId) {
        const { data: otros } = await supabaseAdmin
          .from("salas_whatsapp_grupos")
          .select("whatsapp_group_jid, whatsapp_group_nombre")
          .eq("sala_id", salaId)
          .eq("activo", true);

        const siguiente = (otros || []).find((o: any) => o.whatsapp_group_jid !== groupJid);
        await supabaseAdmin
          .from("salas_juego")
          .update({
            whatsapp_group_jid: siguiente ? siguiente.whatsapp_group_jid : null,
            whatsapp_group_nombre: siguiente ? siguiente.whatsapp_group_nombre : null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", salaId);
      } else if (groupJid) {
        await supabaseAdmin
          .from("salas_juego")
          .update({
            whatsapp_group_jid: null,
            whatsapp_group_nombre: null,
            updated_at: new Date().toISOString(),
          })
          .eq("whatsapp_group_jid", groupJid);

        await supabaseAdmin
          .from("grupos")
          .update({
            whatsapp_group_id: null,
            whatsapp_group_nombre: null,
          })
          .eq("whatsapp_group_id", groupJid);
      }
      return NextResponse.json({ ok: true, motivo: "Grupo desvinculado correctamente" });
    }

    return NextResponse.json({ ok: false, motivo: `Acción no soportada: ${accion}` }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, motivo: err?.message || "Error procesando solicitud" },
      { status: 200 }
    );
  }
}
