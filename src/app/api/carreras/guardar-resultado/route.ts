import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { claveHipodromo } from "@/features/carreras/lib/claves";
import { filtroDiaJornada } from "@/features/liquidacion/lib/fecha";

export const dynamic = "force-dynamic";

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { accion, fecha, hipodromo, carrera, fila } = body;

    const hip = String(hipodromo ?? "").trim().toUpperCase();
    const num = Number(carrera);
    const f = String(fecha ?? "").trim().slice(0, 10);

    if (!hip || !num || !f) {
      return NextResponse.json({ ok: false, error: "Datos incompletos (fecha, hipodromo, carrera requeridos)" }, { status: 400 });
    }

    const supabase = getAdminClient();
    if (!supabase) {
      return NextResponse.json({ ok: false, error: "Base de datos no configurada" }, { status: 500 });
    }

    const claveHip = claveHipodromo(hip);

    // =========================================================================
    // ACCIÓN: REVERTIR LIQUIDACIÓN Y ELIMINAR PIZARRA POR COMPLETO (SERVICE ROLE)
    // =========================================================================
    if (accion === "revertir") {
      // 1) Eliminar por completo la pizarra en `resultados_carreras` para esta fecha + hipódromo + carrera
      const { data: resRows } = await supabase
        .from("resultados_carreras")
        .select("id, hipodromo, fecha")
        .eq("fecha", f)
        .eq("carrera", num);

      const idsResultados = ((resRows ?? []) as Array<Record<string, unknown>>)
        .filter((r) => claveHipodromo(String(r.hipodromo ?? "")) === claveHip)
        .map((r) => r.id)
        .filter(Boolean);

      if (idsResultados.length > 0) {
        const { error: delErr } = await supabase
          .from("resultados_carreras")
          .delete()
          .in("id", idsResultados as never[]);
        if (delErr) {
          await supabase
            .from("resultados_carreras")
            .update({
              ganadores: [],
              orden_llegada: null,
              dividendos: null,
              aplicado_a_tablas: false,
              premio_oficial: null,
              premio_recalculado: null,
              detalle: null,
            })
            .in("id", idsResultados as never[]);
        }
      } else {
        await supabase
          .from("resultados_carreras")
          .delete()
          .eq("fecha", f)
          .ilike("hipodromo", `%${hip.replace(/\s+/g, "%")}%`)
          .eq("carrera", num);
      }

      // 2) Volver la matriz `carreras` a estado "Programada"
      const { data: carRows } = await supabase
        .from("carreras")
        .select("id, hipodromo")
        .eq("fecha", f)
        .eq("carrera", num);

      const idsCarreras = ((carRows ?? []) as Array<Record<string, unknown>>)
        .filter((r) => claveHipodromo(String(r.hipodromo ?? "")) === claveHip)
        .map((r) => r.id)
        .filter(Boolean);

      if (idsCarreras.length > 0) {
        await supabase
          .from("carreras")
          .update({ estado: "Programada", updated_at: new Date().toISOString() })
          .in("id", idsCarreras as never[]);
      } else {
        await supabase
          .from("carreras")
          .update({ estado: "Programada", updated_at: new Date().toISOString() })
          .eq("fecha", f)
          .ilike("hipodromo", `%${hip.replace(/\s+/g, "%")}%`)
          .eq("carrera", num);
      }

      // 3) Reabrir `tablas_fijas` y limpiar ganadores de esa carrera
      const { data: tabRows } = await supabase
        .from("tablas_fijas")
        .select("id, hipodromo, fecha, fecha_creacion")
        .eq("carrera", num)
        .or(`fecha.eq.${f},fecha.is.null`);

      const idsTablas = ((tabRows ?? []) as Array<Record<string, unknown>>)
        .filter((t) => claveHipodromo(String(t.hipodromo ?? "")) === claveHip)
        .filter((t) => String(t.fecha ?? t.fecha_creacion ?? "").slice(0, 10) === f)
        .map((t) => t.id)
        .filter(Boolean);

      if (idsTablas.length > 0) {
        await supabase
          .from("tablas_fijas")
          .update({ estado: "Abierta", ganador: null, ganadores: null })
          .in("id", idsTablas as never[]);
      }

      // 4) Asegurar que todos los tickets de `tickets_apuestas` de esa carrera queden en "Pendiente"
      const { data: tkRows } = await supabase
        .from("tickets_apuestas")
        .select("id, hipodromo, anulada")
        .eq("carrera", num)
        .or(filtroDiaJornada(f))
        .in("estado", ["Ganador", "Perdedor", "Retirado", "Liquidada", "GANO", "PERDIO", "Solucionado", "SOLUCIONADO"])
        .limit(2000);

      const idsTickets = ((tkRows ?? []) as Array<Record<string, unknown>>)
        .filter((t) => t.anulada !== true && claveHipodromo(String(t.hipodromo ?? "")) === claveHip)
        .map((t) => t.id)
        .filter(Boolean);

      if (idsTickets.length > 0) {
        await supabase
          .from("tickets_apuestas")
          .update({ estado: "Pendiente", premio_pagar: 0, monto_decidido: 0, comision_pagada: 0 })
          .in("id", idsTickets as never[]);
      }

      return NextResponse.json({
        ok: true,
        revertida: true,
        eliminadosResultados: idsResultados.length,
        carrerasReabiertas: idsCarreras.length,
        tablasReabiertas: idsTablas.length,
        ticketsPendientes: idsTickets.length,
      });
    }

    // Buscar fila existente en resultados_carreras (comparando por clave canónica de hipódromo)
    const { data: existentes } = await supabase
      .from("resultados_carreras")
      .select("*")
      .eq("fecha", f)
      .eq("carrera", num);

    const existente =
      ((existentes ?? []) as Array<Record<string, unknown>>).find(
        (r) => claveHipodromo(String(r.hipodromo ?? "")) === claveHip
      ) ?? null;

    const payload: Record<string, unknown> = {
      fecha: f,
      hipodromo: hip,
      carrera: num,
      ...(existente ?? {}),
      ...(fila ?? {}),
      updated_at: new Date().toISOString(),
    };

    if (fila?.ganadores && Array.isArray(fila.ganadores)) {
      payload.ganadores = fila.ganadores;
    }
    if (fila?.orden_llegada !== undefined) {
      payload.orden_llegada = fila.orden_llegada;
    }
    if (fila?.dividendos !== undefined) {
      payload.dividendos = fila.dividendos;
    }
    if (fila?.retirados !== undefined) {
      payload.retirados = fila.retirados;
    }
    if (fila?.aplicado_a_tablas !== undefined) {
      payload.aplicado_a_tablas = Boolean(fila.aplicado_a_tablas);
    }
    if (fila?.cargado_por) {
      payload.cargado_por = fila.cargado_por;
    }
    if (fila?.detalle !== undefined) {
      payload.detalle = fila.detalle;
    }

    let err: string | null = null;
    if (existente?.id) {
      const { error: upErr } = await supabase
        .from("resultados_carreras")
        .update(payload)
        .eq("id", existente.id);
      if (upErr) err = upErr.message;
    } else {
      const { error: insErr } = await supabase
        .from("resultados_carreras")
        .insert([payload]);
      if (insErr) err = insErr.message;
    }

    if (err) {
      return NextResponse.json({ ok: false, error: err }, { status: 500 });
    }

    return NextResponse.json({ ok: true, data: payload });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
