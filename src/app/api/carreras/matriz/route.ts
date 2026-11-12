import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { claveHipodromo } from "@/features/carreras/lib/claves";
import { COLUMNAS_MAESTRO, dedupFilasMaestro } from "@/features/carreras/lib/maestro-nucleo";

export const dynamic = "force-dynamic";

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const fecha = searchParams.get("fecha");
    const hipodromo = searchParams.get("hipodromo");

    if (!fecha) {
      return NextResponse.json({ ok: false, error: "Parámetro fecha requerido" }, { status: 400 });
    }

    const supabase = getAdminClient();
    if (!supabase) {
      return NextResponse.json({ ok: false, error: "Base de datos no configurada en el servidor" }, { status: 500 });
    }

    const hipo = claveHipodromo(hipodromo);

    // Intentar con resultados embebidos
    let data: any = null;
    let error: any = null;

    const resConEmbed = await supabase
      .from("carreras")
      .select(`${COLUMNAS_MAESTRO}, resultados_carreras(*)`)
      .eq("fecha", fecha)
      .order("hipodromo")
      .order("carrera");

    data = resConEmbed.data;
    error = resConEmbed.error;

    if (error) {
      // Reintento sin embed si falla relación
      const retry = await supabase
        .from("carreras")
        .select(COLUMNAS_MAESTRO)
        .eq("fecha", fecha)
        .order("hipodromo")
        .order("carrera");
      data = retry.data;
      error = retry.error;
    }

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    let filas = (data ?? []) as any[];
    if (hipo) {
      filas = filas.filter((x) => claveHipodromo(x.hipodromo) === hipo);
    }

    const deduplicadas = dedupFilasMaestro(filas);
    return NextResponse.json({ ok: true, filas: deduplicadas });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
