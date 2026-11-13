import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const COLUMNAS_OPCIONALES_TICKET = new Set([
  "fecha_carrera",
  "es_adelantada",
  "banquero_nombre",
  "grupo",
  "grupo_comision_nombre",
  "grupo_comision_id",
  "nota_auditoria",
]);

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function extraerColumnaFaltante(error: { code?: string; message?: string } | null): string | null {
  if (!error) return null;
  const txt = `${error.code ?? ""} ${error.message ?? ""}`;
  if (!/(PGRST204|42703|does not exist|schema cache|Could not find)/i.test(txt)) return null;
  const m1 = txt.match(/Could not find the ['"]([^'"]+)['"] column/i);
  if (m1?.[1]) return m1[1];
  const m2 = txt.match(/column\s+["']?([a-zA-Z0-9_]+)["']?\s+(?:of relation|does not exist)/i);
  if (m2?.[1]) return m2[1];
  for (const col of COLUMNAS_OPCIONALES_TICKET) {
    if (txt.includes(col)) return col;
  }
  return null;
}

/**
 * POST /api/jugadas/editar
 * Respaldo autenticado con Service Role para corregir tickets cuando RLS
 * restringe UPDATE directo en el cliente.
 */
export async function POST(req: NextRequest) {
  try {
    const admin = getAdminClient();
    if (!admin) {
      return NextResponse.json(
        { ok: false, error: "Configuración de servidor incompleta para editar jugadas." },
        { status: 500 }
      );
    }

    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) {
      return NextResponse.json({ ok: false, error: "Sesión no autorizada para editar jugadas." }, { status: 401 });
    }
    const { data: userRes, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !userRes?.user) {
      return NextResponse.json({ ok: false, error: "Token de sesión inválido o expirado." }, { status: 401 });
    }

    const body = (await req.json()) as {
      id?: string | number;
      payload?: Record<string, unknown>;
      ajusteSaldo?: {
        anulada?: boolean;
        idViejo?: string;
        idNuevo?: string;
        montoViejo?: number;
        montoNuevo?: number;
      };
      auditoria?: {
        ticket_id: string;
        hipodromo?: string | null;
        carrera?: number | null;
        accion: string;
        motivo?: string | null;
        detalle?: unknown;
        imagen?: string | null;
        usuario?: string | null;
      };
    };

    const id = body.id;
    if (id == null || String(id).trim() === "" || !body.payload || typeof body.payload !== "object") {
      return NextResponse.json({ ok: false, error: "Parámetros inválidos para editar jugada." }, { status: 400 });
    }

    const copia = { ...body.payload };
    let errorMsg: string | null = null;
    let updatedCount = 0;

    for (let intento = 0; intento < 6; intento++) {
      const { data: rows, error } = await admin
        .from("tickets_apuestas")
        .update(copia)
        .eq("id", id)
        .select("id");

      if (!error) {
        updatedCount = rows?.length ?? 0;
        errorMsg = null;
        break;
      }
      errorMsg = error.message;
      const col = extraerColumnaFaltante(error);
      if (col && col in copia && COLUMNAS_OPCIONALES_TICKET.has(col)) {
        delete copia[col];
        continue;
      }
      if (/(fecha_carrera|es_adelantada|banquero_nombre)/i.test(errorMsg)) {
        delete copia.fecha_carrera;
        delete copia.es_adelantada;
        delete copia.banquero_nombre;
        continue;
      }
      break;
    }

    if (errorMsg) {
      return NextResponse.json({ ok: false, error: errorMsg }, { status: 400 });
    }
    if (updatedCount === 0) {
      return NextResponse.json({ ok: false, error: "La jugada no existe o no pudo actualizarse." }, { status: 404 });
    }

    const aj = body.ajusteSaldo;
    if (aj && !aj.anulada) {
      const montoViejo = Number(aj.montoViejo ?? 0) || 0;
      const montoNuevo = Number(aj.montoNuevo ?? 0) || 0;
      const idViejo = String(aj.idViejo ?? "").trim();
      const idNuevo = String(aj.idNuevo ?? "").trim();

      if (idViejo && idNuevo && idViejo === idNuevo) {
        const diff = montoNuevo - montoViejo;
        if (Math.abs(diff) >= 0.01) {
          const { data: cli } = await admin
            .from("clientes")
            .select("saldo_actual")
            .eq("id", idViejo as never)
            .maybeSingle();
          if (cli) {
            const actual = Number((cli as Record<string, unknown>).saldo_actual ?? 0) || 0;
            await admin
              .from("clientes")
              .update({ saldo_actual: actual - diff })
              .eq("id", idViejo as never);
          }
        }
      } else {
        if (idViejo && montoViejo > 0) {
          const { data: cliV } = await admin
            .from("clientes")
            .select("saldo_actual")
            .eq("id", idViejo as never)
            .maybeSingle();
          if (cliV) {
            const actualV = Number((cliV as Record<string, unknown>).saldo_actual ?? 0) || 0;
            await admin
              .from("clientes")
              .update({ saldo_actual: actualV + montoViejo })
              .eq("id", idViejo as never);
          }
        }
        if (idNuevo && montoNuevo > 0) {
          const { data: cliN } = await admin
            .from("clientes")
            .select("saldo_actual")
            .eq("id", idNuevo as never)
            .maybeSingle();
          if (cliN) {
            const actualN = Number((cliN as Record<string, unknown>).saldo_actual ?? 0) || 0;
            await admin
              .from("clientes")
              .update({ saldo_actual: actualN - montoNuevo })
              .eq("id", idNuevo as never);
          }
        }
      }
    }

    let auditError: string | null = null;
    if (body.auditoria) {
      const { error: errAud } = await admin.from("jugadas_auditoria").insert({
        ticket_id: body.auditoria.ticket_id,
        hipodromo: body.auditoria.hipodromo ?? null,
        carrera: body.auditoria.carrera ?? null,
        accion: body.auditoria.accion,
        motivo: body.auditoria.motivo ?? null,
        detalle: body.auditoria.detalle ?? null,
        imagen: body.auditoria.imagen ?? null,
        usuario: body.auditoria.usuario ?? null,
      });
      if (errAud) auditError = errAud.message;
    }

    return NextResponse.json({ ok: true, auditError });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Error inesperado editando la jugada." },
      { status: 500 }
    );
  }
}
