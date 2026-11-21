import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/core/supabase-admin";
import { requireSession } from "@/features/seguridad/lib/require-session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const autorizacion = await requireSession(req, ["superadmin"]);
  if (!autorizacion.ok) {
    return NextResponse.json(
      { ok: false, error: autorizacion.error },
      { status: autorizacion.status }
    );
  }

  try {
    const { data: rows, error } = await supabaseAdmin
      .from("grupos_venta")
      .select("*")
      .order("nombre", { ascending: true });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    const inquilinos = (rows || []).map((r) => {
      const activo = r.activo !== false;
      const estatusSuscripcion = r.estatus_suscripcion || (activo ? "al_dia" : "vencido");
      return {
        id: String(r.id),
        nombre: String(r.nombre || "Sin Nombre"),
        responsable: String(r.responsable || "Sin Asignar"),
        activo,
        estatus_suscripcion: estatusSuscripcion,
        moneda: r.moneda || "USD",
        cupo_tabla: r.cupo_tabla ?? null,
        created_at: r.created_at,
      };
    });

    return NextResponse.json({ ok: true, inquilinos });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || "Error al listar inquilinos" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const autorizacion = await requireSession(req, ["superadmin"]);
  if (!autorizacion.ok) {
    return NextResponse.json(
      { ok: false, error: autorizacion.error },
      { status: autorizacion.status }
    );
  }

  try {
    const body = await req.json();
    const { grupoId, accion, estatus, suspender } = body;

    if (!grupoId) {
      return NextResponse.json({ ok: false, error: "grupoId es obligatorio" }, { status: 400 });
    }

    let nuevoActivo = true;
    let nuevoEstatus = "al_dia";

    if (accion === "suspender_sistema" || accion === "toggle_suscripcion") {
      if (typeof suspender === "boolean") {
        nuevoActivo = !suspender;
        nuevoEstatus = suspender ? "vencido" : "al_dia";
      } else if (estatus) {
        nuevoEstatus = estatus === "al_dia" ? "al_dia" : "vencido";
        nuevoActivo = nuevoEstatus === "al_dia";
      } else {
        // Toggle dinámico
        const { data: gActual } = await supabaseAdmin
          .from("grupos_venta")
          .select("activo, estatus_suscripcion")
          .eq("id", grupoId)
          .maybeSingle();

        const actualmenteActivo = gActual?.activo !== false;
        nuevoActivo = !actualmenteActivo;
        nuevoEstatus = nuevoActivo ? "al_dia" : "vencido";
      }
    }

    // 1. Actualización via RPC segura de negocio
    try {
      await supabaseAdmin.rpc("club_toggle_grupo", { p_id: grupoId, p_activo: nuevoActivo });
    } catch {
      // Ignorar si la función RPC no existe
    }

    // 2. Actualización en grupos_venta (tolerante si no existe estatus_suscripcion)
    const { error: errUpdateVenta } = await supabaseAdmin
      .from("grupos_venta")
      .update({ activo: nuevoActivo, estatus_suscripcion: nuevoEstatus })
      .eq("id", grupoId);

    if (errUpdateVenta && errUpdateVenta.code === "42703") {
      // Si la columna estatus_suscripcion aún no está en grupos_venta, actualiza solo activo
      await supabaseAdmin
        .from("grupos_venta")
        .update({ activo: nuevoActivo })
        .eq("id", grupoId);
    }

    // 3. Sincronización en tabla legacy grupos si existe
    try {
      const { error: errG } = await supabaseAdmin
        .from("grupos")
        .update({ estatus: nuevoActivo ? "Activo" : "Inactivo", estatus_suscripcion: nuevoEstatus })
        .eq("id", grupoId);

      if (errG && errG.code === "42703") {
        await supabaseAdmin
          .from("grupos")
          .update({ estatus: nuevoActivo ? "Activo" : "Inactivo" })
          .eq("id", grupoId);
      }
    } catch {
      // Ignorar si no existe tabla grupos
    }

    return NextResponse.json({
      ok: true,
      grupoId,
      activo: nuevoActivo,
      estatus_suscripcion: nuevoEstatus,
      motivo: nuevoActivo ? "Sistema activado (Al Día)" : "Sistema suspendido (Vencido)",
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || "Error al procesar acción" }, { status: 500 });
  }
}
