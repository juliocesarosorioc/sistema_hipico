import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cerrarParadasAbiertasDeSala } from "@/features/whatsapp-sala/concretarJugada";

export const dynamic = "force-dynamic";

const BOT_DAEMON_URL = process.env.BOT_DAEMON_URL || "http://127.0.0.1:3005";
const INTERNAL_BOT_SECRET = process.env.INTERNAL_BOT_SECRET || "SH-BOT-SECRET-2026";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
});

async function emitirBroadcastSalaAdmin(salaId: string, evento: string, payload: any) {
  try {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !key || !salaId) return;
    await fetch(`${supabaseUrl}/realtime/v1/api/broadcast`, {
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
  } catch {}
}

async function registrarEstadoCarreraEnChatAdmin(salaActualizada: any, texto: string, evento: string) {
  if (!salaActualizada?.id || !texto) return;
  try {
    const filaBase = {
      grupo_id: salaActualizada.grupo_id,
      sala_id: salaActualizada.id,
      remitente_nombre: "Operador de Sala",
      es_operador: true,
      tipo_mensaje: "ESTADO_CARRERA",
      contenido: texto,
      whatsapp_group_jid: salaActualizada.whatsapp_group_jid || null,
      eliminado: false,
    };
    const { error } = await supabaseAdmin.from("chat_mensajes").insert({
      ...filaBase,
      estado_propuesta: "no_aplica",
      origen_canal: "WEB",
    });
    if (error) {
      await supabaseAdmin.from("chat_mensajes").insert(filaBase);
    }
    await emitirBroadcastSalaAdmin(salaActualizada.id, evento, { salaId: salaActualizada.id });
    await emitirBroadcastSalaAdmin(salaActualizada.id, "nuevo_mensaje", { salaId: salaActualizada.id });
  } catch {}
}

export async function GET() {
  try {
    const res = await fetch(`${BOT_DAEMON_URL}/status`, {
      method: "GET",
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false,
          conectado: false,
          grupos: [],
          motivo: "Bot Baileys en puerto 3005 apagado o reiniciando",
        },
        { status: 200 }
      );
    }
    const data = await res.json();
    return NextResponse.json(data, { status: 200 });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        conectado: false,
        grupos: [],
        motivo: "Bot Baileys en puerto 3005 apagado o reiniciando",
      },
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
    const body = await req.json().catch(() => ({}));
    const accion = String(body.accion || body.action || "");

    // 1. Vincular grupo a sala (Regla 1 a 1)
    if (accion === "vincular_grupo_sala" || accion === "vincular-grupo-sala") {
      const { grupoId, salaId, groupJid } = body;
      if (salaId && groupJid) {
        const { data: otraSala } = await supabaseAdmin
          .from("salas_juego")
          .select("id, nombre_sala")
          .eq("whatsapp_group_jid", groupJid)
          .eq("activa", true)
          .neq("id", salaId)
          .limit(1)
          .maybeSingle();

        if (otraSala) {
          // Desvincular automáticamente de la sala anterior para transferir a la nueva cumpliendo Regla 1 a 1
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
          .eq("activo", true)
          .neq("sala_id", salaId)
          .limit(1)
          .maybeSingle();

        if (otroVinc) {
          // Limpiar vínculo huérfano o transferir de la sala previa
          await supabaseAdmin
            .from("salas_whatsapp_grupos")
            .update({ activo: false, estado_conexion: "desconectado", updated_at: new Date().toISOString() })
            .eq("sala_id", otroVinc.sala_id);
          await supabaseAdmin
            .from("salas_juego")
            .update({ whatsapp_group_jid: null, whatsapp_group_nombre: null, updated_at: new Date().toISOString() })
            .eq("id", otroVinc.sala_id);
        }
      }
      try {
        const resBot = await fetch(`${BOT_DAEMON_URL}/verificar-y-vincular`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-bot-secret": INTERNAL_BOT_SECRET,
          },
          body: JSON.stringify({ grupoId, salaId, groupJid }),
        });
        const json = await resBot.json().catch(() => null);
        return NextResponse.json(
          json || { ok: false, motivo: "Respuesta inválida del demonio Baileys" },
          { status: 200 }
        );
      } catch {
        return NextResponse.json(
          {
            ok: false,
            conectado: false,
            grupos: [],
            motivo: "Bot Baileys en puerto 3005 apagado o reiniciando",
          },
          { status: 200 }
        );
      }
    }

    // 2. Desvincular grupo de sala
    if (accion === "desvincular_grupo_sala" || accion === "desvincular-grupo-sala") {
      const { salaId, groupJid } = body;
      try {
        if (salaId) {
          await supabaseAdmin
            .from("salas_juego")
            .update({ whatsapp_group_jid: null, whatsapp_group_nombre: null, updated_at: new Date().toISOString() })
            .eq("id", salaId);
          await supabaseAdmin
            .from("salas_whatsapp_grupos")
            .update({ activo: false, estado_conexion: "desconectado", updated_at: new Date().toISOString() })
            .eq("sala_id", salaId);
        } else if (groupJid) {
          await supabaseAdmin
            .from("salas_juego")
            .update({ whatsapp_group_jid: null, whatsapp_group_nombre: null, updated_at: new Date().toISOString() })
            .eq("whatsapp_group_jid", groupJid);
          await supabaseAdmin
            .from("salas_whatsapp_grupos")
            .update({ activo: false, estado_conexion: "desconectado", updated_at: new Date().toISOString() })
            .eq("whatsapp_group_jid", groupJid);
        }

        const resBot = await fetch(`${BOT_DAEMON_URL}/desvincular-grupo`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-bot-secret": INTERNAL_BOT_SECRET,
          },
          body: JSON.stringify({ salaId, groupJid }),
        });
        const json = await resBot.json().catch(() => null);
        return NextResponse.json(
          json || { ok: true, motivo: "Grupo desvinculado correctamente" },
          { status: 200 }
        );
      } catch {
        return NextResponse.json(
          { ok: true, motivo: "Grupo desvinculado en base de datos" },
          { status: 200 }
        );
      }
    }

    // 2.a Limpieza de vínculos huérfanos / zombies
    if (accion === "limpiar_vinculos_huerfanos" || accion === "limpiar-vinculos-huerfanos") {
      try {
        const { data: vinculosActivos } = await supabaseAdmin
          .from("salas_whatsapp_grupos")
          .select("id, sala_id, whatsapp_group_jid")
          .eq("activo", true);

        if (vinculosActivos && vinculosActivos.length > 0) {
          for (const v of vinculosActivos) {
            const { data: salaRow } = await supabaseAdmin
              .from("salas_juego")
              .select("id, activa")
              .eq("id", v.sala_id)
              .maybeSingle();

            if (!salaRow || salaRow.activa === false) {
              await supabaseAdmin
                .from("salas_whatsapp_grupos")
                .update({ activo: false, estado_conexion: "desconectado", updated_at: new Date().toISOString() })
                .eq("id", v.id);
              await supabaseAdmin
                .from("salas_juego")
                .update({ whatsapp_group_jid: null, whatsapp_group_nombre: null, updated_at: new Date().toISOString() })
                .eq("id", v.sala_id);
            }
          }
        }
        return NextResponse.json({ ok: true, motivo: "Vínculos huérfanos depurados con éxito" });
      } catch (err: any) {
        return NextResponse.json({ ok: false, error: err?.message || err }, { status: 500 });
      }
    }

    // 2.b Desconectar sala (Pausar WhatsApp en la sala)
    if (accion === "desconectar-sala" || accion === "desconectar_sala") {
      const { salaId } = body;
      if (!salaId) {
        return NextResponse.json({ ok: false, motivo: "salaId es requerido" }, { status: 200 });
      }

      const { data: salaPrev } = await supabaseAdmin
        .from("salas_juego")
        .select("id, whatsapp_group_jid, whatsapp_group_nombre")
        .eq("id", salaId)
        .maybeSingle();

      const jidPrev = salaPrev?.whatsapp_group_jid || null;

      await supabaseAdmin
        .from("salas_juego")
        .update({
          whatsapp_group_jid: null,
          whatsapp_group_nombre: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", salaId);

      await supabaseAdmin
        .from("salas_whatsapp_grupos")
        .update({
          activo: false,
          estado_conexion: "pausado",
          motivo_estado: "Desconectado manualmente",
          updated_at: new Date().toISOString(),
        })
        .eq("sala_id", salaId);

      try {
        await fetch(`${BOT_DAEMON_URL}/desconectar-sala`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-bot-secret": INTERNAL_BOT_SECRET,
          },
          body: JSON.stringify({ salaId }),
        });
      } catch {}

      return NextResponse.json({
        ok: true,
        salaId,
        desconectado: true,
        groupJid: jidPrev,
        groupNombre: salaPrev?.whatsapp_group_nombre || null,
        motivo: "Sala desconectada correctamente de WhatsApp",
      });
    }

    // 2.c Reconectar sala (Restaurar WhatsApp en la sala)
    if (accion === "reconectar-sala" || accion === "reconectar_sala") {
      const { salaId, groupJid, groupNombre } = body;
      if (!salaId) {
        return NextResponse.json({ ok: false, motivo: "salaId es requerido" }, { status: 200 });
      }

      if (groupJid) {
        await supabaseAdmin
          .from("salas_juego")
          .update({
            whatsapp_group_jid: groupJid,
            whatsapp_group_nombre: groupNombre || null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", salaId);

        const { data: sActual } = await supabaseAdmin
          .from("salas_juego")
          .select("grupo_id")
          .eq("id", salaId)
          .maybeSingle();

        await supabaseAdmin
          .from("salas_whatsapp_grupos")
          .upsert(
            {
              sala_id: salaId,
              grupo_id: sActual?.grupo_id || null,
              whatsapp_group_jid: groupJid,
              whatsapp_group_nombre: groupNombre || null,
              activo: true,
              estado_conexion: "conectado",
              motivo_estado: "Reconectado",
              updated_at: new Date().toISOString(),
            },
            { onConflict: "whatsapp_group_jid" }
          );
      }

      try {
        await fetch(`${BOT_DAEMON_URL}/reconectar-sala`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-bot-secret": INTERNAL_BOT_SECRET,
          },
          body: JSON.stringify({ salaId, groupJid, groupNombre }),
        });
      } catch {}

      return NextResponse.json({
        ok: true,
        salaId,
        groupJid,
        groupNombre,
        motivo: "Sala reconectada correctamente",
      });
    }

    // 2.d Desconectar grupo por JID directo (desde la lista de grupos de WhatsApp)
    if (
      accion === "desconectar_grupo_jid" ||
      accion === "desconectar-grupo-jid" ||
      accion === "desvincular_grupo_directo" ||
      accion === "desvincular-grupo-directo"
    ) {
      const { groupJid } = body;
      if (!groupJid) {
        return NextResponse.json({ ok: false, motivo: "groupJid es requerido" }, { status: 200 });
      }

      await supabaseAdmin
        .from("salas_whatsapp_grupos")
        .update({
          activo: false,
          estado_conexion: "desconectado",
          motivo_estado: "Desconectado por el usuario",
          updated_at: new Date().toISOString(),
        })
        .eq("whatsapp_group_jid", groupJid);

      await supabaseAdmin
        .from("salas_juego")
        .update({
          whatsapp_group_jid: null,
          whatsapp_group_nombre: null,
          updated_at: new Date().toISOString(),
        })
        .eq("whatsapp_group_jid", groupJid);

      try {
        await fetch(`${BOT_DAEMON_URL}/desvincular-grupo`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-bot-secret": INTERNAL_BOT_SECRET,
          },
          body: JSON.stringify({ groupJid }),
        });
      } catch {}

      return NextResponse.json({
        ok: true,
        groupJid,
        motivo: "Grupo de WhatsApp desconectado y desvinculado con éxito",
      });
    }

    // 2.e Desconectar todas las salas
    if (accion === "desconectar_todas_las_salas" || accion === "desconectar-todas-salas") {
      const { grupoId } = body;
      let qSalas = supabaseAdmin.from("salas_juego").update({
        whatsapp_group_jid: null,
        whatsapp_group_nombre: null,
        updated_at: new Date().toISOString(),
      });
      if (grupoId) qSalas = qSalas.eq("grupo_id", grupoId);
      await qSalas;

      let qVinc = supabaseAdmin.from("salas_whatsapp_grupos").update({
        activo: false,
        estado_conexion: "pausado",
        motivo_estado: "Desconectado masivo",
        updated_at: new Date().toISOString(),
      });
      if (grupoId) qVinc = qVinc.eq("grupo_id", grupoId);
      await qVinc;

      return NextResponse.json({ ok: true, motivo: "Todas las salas desconectadas exitosamente" });
    }

    // 3. Crear sala (máximo 2 salas por grupo_id)
    if (accion === "crear_sala" || accion === "crear-sala") {
      const { grupoId, nombreSala, hipodromoActivo } = body;
      if (!grupoId) {
        return NextResponse.json({ ok: false, motivo: "grupoId es requerido" }, { status: 200 });
      }

      const { data: existentes } = await supabaseAdmin
        .from("salas_juego")
        .select("id, orden_sala")
        .eq("grupo_id", grupoId)
        .eq("activa", true)
        .order("orden_sala", { ascending: true });

      if ((existentes?.length || 0) >= 2) {
        return NextResponse.json(
          { ok: false, motivo: "Máximo 2 salas permitidas por grupo" },
          { status: 200 }
        );
      }

      const siguienteOrden = (existentes?.length || 0) + 1;
      const nombreFinal =
        String(nombreSala || "").trim() ||
        (siguienteOrden === 1 ? "Sala 1 - Nacionales" : "Sala 2 - Americanas");

      const { data: creada, error: errCrear } = await supabaseAdmin
        .from("salas_juego")
        .insert({
          grupo_id: grupoId,
          nombre_sala: nombreFinal,
          orden_sala: siguienteOrden,
          activa: true,
          estado_carrera: "abierta",
          hipodromo_activo:
            hipodromoActivo || (siguienteOrden === 1 ? "LA RINCONADA" : "GULFSTREAM PARK"),
          numero_carrera_activa: 1,
        })
        .select()
        .single();

      if (errCrear) {
        return NextResponse.json({ ok: false, motivo: errCrear.message }, { status: 200 });
      }
      return NextResponse.json(
        { ok: true, sala: creada, motivo: `Sala "${nombreFinal}" creada exitosamente` },
        { status: 200 }
      );
    }

    // 4. Eliminar sala
    if (accion === "eliminar_sala" || accion === "eliminar-sala") {
      const { salaId } = body;
      if (!salaId) {
        return NextResponse.json({ ok: false, motivo: "salaId es requerido" }, { status: 200 });
      }

      await supabaseAdmin.from("salas_whatsapp_grupos").delete().eq("sala_id", salaId);
      const { error: errDel } = await supabaseAdmin
        .from("salas_juego")
        .update({ activa: false, whatsapp_group_jid: null, updated_at: new Date().toISOString() })
        .eq("id", salaId);

      if (errDel) {
        return NextResponse.json({ ok: false, motivo: errDel.message }, { status: 200 });
      }
      return NextResponse.json(
        { ok: true, motivo: "Sala eliminada correctamente" },
        { status: 200 }
      );
    }

    // 4.0 Leer configuración de sala + comisión/cruces del grupo dueño
    if (accion === "obtener_config_sala" || accion === "obtener-config-sala") {
      const { salaId } = body;
      if (!salaId) {
        return NextResponse.json({ ok: false, motivo: "salaId es requerido" }, { status: 200 });
      }
      const { data: sala, error: errSala } = await supabaseAdmin
        .from("salas_juego")
        .select("*")
        .eq("id", salaId)
        .maybeSingle();
      if (errSala) {
        return NextResponse.json({ ok: false, motivo: errSala.message }, { status: 200 });
      }
      if (!sala) {
        return NextResponse.json({ ok: false, motivo: "Sala no encontrada" }, { status: 200 });
      }
      let grupo = null;
      if (sala.grupo_id) {
        const { data: g } = await supabaseAdmin
          .from("grupos_venta")
          .select("id, nombre, comision_default, cruce_mismo_ejemplar, cruce_diferente_ejemplar, permite_cruces")
          .eq("id", sala.grupo_id)
          .maybeSingle();
        grupo = g || null;
      }
      return NextResponse.json({ ok: true, sala, grupo }, { status: 200 });
    }

    // 4.1 Actualizar configuración de sala (apuesta mínima, vencimiento, topes de marcas)
    if (accion === "actualizar_config_sala" || accion === "actualizar-config-sala") {
      const {
        salaId,
        apuestaMinima,
        tiempoVencimientoPropuestaMin,
        topeCaballosMarcasNacional,
        topeCaballosMarcasInternacional,
        comisionDefault,
        cruceMismoEjemplar,
        cruceDiferenteEjemplar,
        nombreSala,
        hipodromoActivo,
      } = body;
      if (!salaId) {
        return NextResponse.json({ ok: false, motivo: "salaId es requerido" }, { status: 200 });
      }

      // OJO: `salas_juego` NO tiene columnas `tiempo_vencimiento_propuesta_min`,
      // `tope_caballos_marcas_nacional` ni `tope_caballos_marcas_internacional`.
      // Escribirlas hacía que Supabase rechazara TODO el UPDATE (42703) y el
      // botón Guardar pareciera no disparar. Solo se escriben columnas reales.
      const payload: Record<string, any> = {
        updated_at: new Date().toISOString(),
      };
      if (apuestaMinima !== undefined) {
        const n = parseFloat(String(apuestaMinima));
        if (Number.isFinite(n) && n > 0) payload.apuesta_minima = n;
      }
      if (tiempoVencimientoPropuestaMin !== undefined) {
        const n = parseInt(String(tiempoVencimientoPropuestaMin), 10);
        if (Number.isFinite(n) && n > 0) payload.tiempo_vencimiento_min = n;
      }
      if (topeCaballosMarcasNacional !== undefined) {
        const n = parseInt(String(topeCaballosMarcasNacional), 10);
        if (Number.isFinite(n) && n > 0) payload.tope_marcas_nacional = n;
      }
      if (topeCaballosMarcasInternacional !== undefined) {
        const n = parseInt(String(topeCaballosMarcasInternacional), 10);
        if (Number.isFinite(n) && n > 0) payload.tope_marcas_americano = n;
      }
      if (nombreSala) payload.nombre_sala = String(nombreSala).trim();
      if (hipodromoActivo) payload.hipodromo_activo = String(hipodromoActivo).trim().toUpperCase();
      if (body.whatsappGroupJid !== undefined) {
        payload.whatsapp_group_jid = body.whatsappGroupJid ? String(body.whatsappGroupJid).trim() : null;
      }
      if (body.whatsappGroupNombre !== undefined) {
        payload.whatsapp_group_nombre = body.whatsappGroupNombre ? String(body.whatsappGroupNombre).trim() : null;
      }

      const { data: updated, error: errUpd } = await supabaseAdmin
        .from("salas_juego")
        .update(payload)
        .eq("id", salaId)
        .select()
        .single();

      if (errUpd) {
        return NextResponse.json({ ok: false, motivo: errUpd.message }, { status: 200 });
      }

      // Sincronizar también columnas alias de migración 20261115000000 si existen en la BD
      const payloadAlias: Record<string, any> = {};
      if (payload.tiempo_vencimiento_min !== undefined) {
        payloadAlias.tiempo_vencimiento_propuesta_min = payload.tiempo_vencimiento_min;
      }
      if (payload.tope_marcas_nacional !== undefined) {
        payloadAlias.tope_caballos_marcas_nacional = payload.tope_marcas_nacional;
      }
      if (payload.tope_marcas_americano !== undefined) {
        payloadAlias.tope_caballos_marcas_internacional = payload.tope_marcas_americano;
      }
      if (Object.keys(payloadAlias).length > 0) {
        try {
          await supabaseAdmin.from("salas_juego").update(payloadAlias).eq("id", salaId);
          Object.assign(updated, payloadAlias);
        } catch {}
      }

      // Comisión y permisos de cruce viven en `grupos_venta`. Se actualizan
      // contra el grupo_id de la sala, nunca con un id suelto del frontend.
      let grupoActualizado = null;
      const hayDatosGrupo =
        comisionDefault !== undefined || cruceMismoEjemplar !== undefined || cruceDiferenteEjemplar !== undefined;
      if (hayDatosGrupo && updated?.grupo_id) {
        const pg: Record<string, any> = {};
        if (comisionDefault !== undefined) {
          const n = parseFloat(String(comisionDefault));
          if (Number.isFinite(n) && n >= 0) pg.comision_default = n;
        }
        if (cruceMismoEjemplar !== undefined) pg.cruce_mismo_ejemplar = Boolean(cruceMismoEjemplar);
        if (cruceDiferenteEjemplar !== undefined) pg.cruce_diferente_ejemplar = Boolean(cruceDiferenteEjemplar);
        if (Object.keys(pg).length > 0) {
          const { data: g, error: errG } = await supabaseAdmin
            .from("grupos_venta")
            .update(pg)
            .eq("id", updated.grupo_id)
            .select("id, nombre, comision_default, cruce_mismo_ejemplar, cruce_diferente_ejemplar")
            .maybeSingle();
          if (errG) {
            return NextResponse.json(
              { ok: false, motivo: `Salas actualizada, pero la comisión/cruces falló: ${errG.message}` },
              { status: 200 }
            );
          }
          grupoActualizado = g || null;
          if (g && (cruceMismoEjemplar !== undefined || cruceDiferenteEjemplar !== undefined)) {
            const permiteCruces = Boolean(g.cruce_mismo_ejemplar || g.cruce_diferente_ejemplar);
            try {
              await supabaseAdmin
                .from("grupos_venta")
                .update({ permite_cruces: permiteCruces })
                .eq("id", updated.grupo_id);
            } catch {}
          }
        }
      }

      // Invalidar caché del demonio de WhatsApp si está corriendo
      try {
        await fetch(`${BOT_DAEMON_URL}/invalidar-cache`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-bot-secret": INTERNAL_BOT_SECRET,
          },
          body: JSON.stringify({ salaId }),
        });
      } catch {}

      return NextResponse.json({ ok: true, sala: updated, grupo: grupoActualizado }, { status: 200 });
    }

    // 4.2 Difusión multimedia a 1 o varios grupos seleccionados por ícono
    if (accion === "difundir_grupos" || accion === "difundir-grupos") {
      const { groupJids, tipo, texto, mediaBase64, mimetype } = body;
      try {
        const resBot = await fetch(`${BOT_DAEMON_URL}/difundir-grupos`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-bot-secret": INTERNAL_BOT_SECRET,
          },
          body: JSON.stringify({ groupJids, tipo, texto, mediaBase64, mimetype }),
        });
        const json = await resBot.json().catch(() => null);
        return NextResponse.json(
          json || { ok: false, motivo: "Respuesta inválida del demonio Baileys" },
          { status: 200 }
        );
      } catch {
        return NextResponse.json(
          { ok: false, motivo: "Bot Baileys en puerto 3005 apagado o reiniciando" },
          { status: 200 }
        );
      }
    }

    // 4.3 Limpiar imágenes y audios de WhatsApp por rango de fechas
    if (accion === "limpiar_multimedia" || accion === "limpiar-multimedia") {
      const { fechaInicio, fechaFin } = body;
      if (!fechaInicio || !fechaFin) {
        return NextResponse.json(
          { ok: false, motivo: "fechaInicio y fechaFin son requeridos" },
          { status: 200 }
        );
      }

      const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc(
        "limpiar_multimedia_whatsapp_por_fechas",
        {
          p_fecha_inicio: fechaInicio,
          p_fecha_fin: fechaFin,
        }
      );

      if (!rpcErr) {
        return NextResponse.json(
          {
            ok: true,
            eliminados: typeof rpcData === "number" ? rpcData : (rpcData as any)?.eliminados ?? 0,
            motivo: "Limpieza multimedia ejecutada correctamente",
          },
          { status: 200 }
        );
      }

      // Fallback si la RPC no está desplegada aún
      const { data: borrados, error: errDel } = await supabaseAdmin
        .from("chat_mensajes")
        .delete()
        .in("tipo_mensaje", ["IMAGEN", "AUDIO", "NOTA_VOZ", "imagen", "audio", "nota_voz"])
        .gte("created_at", `${fechaInicio}T00:00:00.000Z`)
        .lte("created_at", `${fechaFin}T23:59:59.999Z`)
        .select("id");

      if (errDel) {
        return NextResponse.json({ ok: false, motivo: errDel.message }, { status: 200 });
      }
      return NextResponse.json(
        {
          ok: true,
          eliminados: borrados?.length || 0,
          motivo: `Limpieza multimedia completada (${borrados?.length || 0} registros)`,
        },
        { status: 200 }
      );
    }

    // 4.4 Abrir carrera y anunciar en el grupo
    if (accion === "abrir-carrera" || accion === "abrir_carrera") {
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

      await registrarEstadoCarreraEnChatAdmin(salaActualizada, textoApertura, "carrera_abierta");

      return NextResponse.json({
        ok: true,
        sala: salaActualizada,
        textoApertura,
        enviadoWhatsApp,
      });
    }

    // 4.5 Cerrar carrera y anunciar en el grupo
    if (accion === "cerrar-carrera" || accion === "cerrar_carrera") {
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

      // Al cerrar la carrera se van todas las paradas abiertas de la sala
      await cerrarParadasAbiertasDeSala(salaId, salaActualizada?.grupo_id || salaPrevia?.grupo_id || null);

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

      await registrarEstadoCarreraEnChatAdmin(salaActualizada, textoCierre, "carrera_cerrada");

      return NextResponse.json({
        ok: true,
        sala: salaActualizada,
        textoCierre,
        enviadoWhatsApp,
      });
    }

    // 4.6 Publicar plano oficial de jugadas en el grupo
    if (accion === "publicar-plano" || accion === "publicar_plano") {
      const { salaId, groupJid } = body;
      if (!salaId) {
        return NextResponse.json({ ok: false, error: "salaId es requerido" }, { status: 400 });
      }

      try {
        const resBot = await fetch(`${BOT_DAEMON_URL}/publicar-plano`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-bot-secret": INTERNAL_BOT_SECRET,
          },
          body: JSON.stringify({ salaId, groupJid }),
        });
        const json = await resBot.json().catch(() => null);
        if (json && json.ok) {
          return NextResponse.json({ ...json, enviadoWhatsApp: true });
        }
      } catch {}

      return NextResponse.json({
        ok: false,
        error: "Daemon Baileys en puerto 3005 no pudo generar y publicar el plano",
      });
    }

    // 4.7 Publicar sentencia y liquidar pizarra
    if (accion === "publicar-sentencia" || accion === "publicar_sentencia") {
      const { salaId, pizarra, groupJid } = body;
      if (!salaId || !pizarra) {
        return NextResponse.json({ ok: false, error: "salaId y pizarra son requeridos" }, { status: 400 });
      }

      try {
        const resBot = await fetch(`${BOT_DAEMON_URL}/publicar-sentencia`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-bot-secret": INTERNAL_BOT_SECRET,
          },
          body: JSON.stringify({ salaId, pizarra, groupJid }),
        });
        const json = await resBot.json().catch(() => null);
        if (json && json.ok) {
          return NextResponse.json({ ...json, enviadoWhatsApp: true });
        }
        return NextResponse.json(json || { ok: false, error: "Error al publicar sentencia" });
      } catch (err: any) {
        return NextResponse.json({
          ok: false,
          error: err?.message || "Daemon Baileys en puerto 3005 no respondió",
        });
      }
    }

    // 4.8 Ping de latencia y estado a un grupo
    if (accion === "ping-grupo" || accion === "ping_grupo") {
      const groupJid = body.groupJid || body.whatsapp_group_jid;
      if (!groupJid) {
        return NextResponse.json({ ok: false, error: "groupJid es requerido" }, { status: 400 });
      }
      try {
        const rBot = await fetch(
          `${BOT_DAEMON_URL}/ping-grupo?groupJid=${encodeURIComponent(groupJid)}`,
          {
            method: "GET",
            headers: { "x-internal-bot-secret": INTERNAL_BOT_SECRET },
            signal: AbortSignal.timeout(6000),
          }
        );
        const json = await rBot.json().catch(() => ({}));
        return NextResponse.json(json, { status: rBot.status || 200 });
      } catch (errPing: any) {
        return NextResponse.json({
          ok: false,
          conectado: false,
          latenciaMs: 0,
          error: errPing?.message || "Daemon offline o no respondió",
        });
      }
    }

    // 4.9 Acciones directas de sesión Baileys: status, connect, disconnect
    if (accion === "status") {
      try {
        const resBot = await fetch(`${BOT_DAEMON_URL}/status`, {
          method: "GET",
          headers: { "x-internal-bot-secret": INTERNAL_BOT_SECRET },
        });
        const json = await resBot.json().catch(() => ({}));
        return NextResponse.json(json, { status: 200 });
      } catch {
        return NextResponse.json({ ok: false, conectado: false, grupos: [], motivo: "Daemon Baileys apagado" }, { status: 200 });
      }
    }

    if (accion === "connect") {
      try {
        const resBot = await fetch(`${BOT_DAEMON_URL}/connect`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-bot-secret": INTERNAL_BOT_SECRET,
          },
          body: JSON.stringify(body),
        });
        const json = await resBot.json().catch(() => ({}));
        return NextResponse.json(json, { status: 200 });
      } catch {
        return NextResponse.json({ ok: false, motivo: "Daemon Baileys apagado" }, { status: 200 });
      }
    }

    if (accion === "disconnect") {
      try {
        const resBot = await fetch(`${BOT_DAEMON_URL}/disconnect`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-bot-secret": INTERNAL_BOT_SECRET,
          },
          body: JSON.stringify(body),
        });
        const json = await resBot.json().catch(() => ({}));
        return NextResponse.json(json, { status: 200 });
      } catch {
        return NextResponse.json({ ok: false, motivo: "Daemon Baileys apagado" }, { status: 200 });
      }
    }

    // 5. Proxy fallback seguro a http://127.0.0.1:3005 solo si se especifica endpoint explícito
    if (body.endpoint) {
      try {
        const endpoint = String(body.endpoint).trim();
        const cleanEndpoint = endpoint.startsWith("/") ? endpoint : "/" + endpoint;
        const method = (
          body.method
            ? String(body.method)
            : cleanEndpoint.includes("/status")
            ? "GET"
            : "POST"
        ).toUpperCase();

        const resBot = await fetch(`${BOT_DAEMON_URL}${cleanEndpoint}`, {
          method,
          headers: {
            "Content-Type": "application/json",
            "x-internal-bot-secret": INTERNAL_BOT_SECRET,
          },
          body: method !== "GET" ? JSON.stringify(body) : undefined,
        });
        const json = await resBot.json().catch(() => null);
        return NextResponse.json(
          json || { ok: false, motivo: "Respuesta sin contenido del demonio Baileys" },
          { status: 200 }
        );
      } catch {
        return NextResponse.json(
          {
            ok: false,
            conectado: false,
            grupos: [],
            motivo: "Bot Baileys en puerto 3005 apagado o reiniciando",
          },
          { status: 200 }
        );
      }
    }

    return NextResponse.json(
      { ok: false, error: `Acción o endpoint no reconocido: ${accion || "(ninguno)"}` },
      { status: 400 }
    );
  } catch {
    return NextResponse.json(
      {
        ok: false,
        conectado: false,
        grupos: [],
        motivo: "Bot Baileys en puerto 3005 apagado o reiniciando",
      },
      { status: 200 }
    );
  }
}
