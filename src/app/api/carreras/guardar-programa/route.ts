import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function ordenarPorNumero(lista: any[]) {
  if (!Array.isArray(lista)) return [];
  return [...lista].sort((a, b) => {
    const na = parseInt(String(a?.numero || "").trim(), 10);
    const nb = parseInt(String(b?.numero || "").trim(), 10);
    if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
    return String(a?.numero || "").localeCompare(String(b?.numero || ""));
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { programa, creadoPor, opciones } = body;

    if (!programa || !programa.fecha) {
      return NextResponse.json({ ok: false, error: "Falta la fecha o los datos del programa." }, { status: 400 });
    }

    const supabase = getAdminClient();
    if (!supabase) {
      return NextResponse.json({ ok: false, error: "Base de datos no configurada en el servidor." }, { status: 500 });
    }

    const fecha = String(programa.fecha).slice(0, 10);
    const hipodromos = [...new Set((programa.hipodromos || []).map((h: any) => String(h).toUpperCase().trim()).filter(Boolean))];
    const carreras = (programa.carreras || []).map((c: any) => ({
      ...c,
      fecha,
      hipodromo: String(c.hipodromo || hipodromos[0] || "").trim().toUpperCase(),
      carrera: Number(c.carrera),
      caballos: ordenarPorNumero(c.caballos || []),
    })).filter((c: any) => c.hipodromo && c.carrera > 0);

    const resumen = `${carreras.length} carrera(s) · ${hipodromos.join(", ")}`;
    const normP = {
      fecha,
      hipodromos,
      carreras,
      resumen,
      creado_por: creadoPor || "desconocido",
    };

    // 1) Upsert en programa_dia como admin (bypasses RLS)
    const { error: errProg } = await supabase
      .from("programa_dia")
      .upsert(normP, { onConflict: "fecha" });

    if (errProg) {
      console.error("[API guardar-programa] Error en programa_dia:", errProg);
      return NextResponse.json({ ok: false, error: `Error guardando programa_dia: ${errProg.message}` }, { status: 500 });
    }

    // 2) Upsert en carreras matriz como admin
    if (opciones?.registrarEnMatriz !== false && carreras.length > 0) {
      const filasCarreras = carreras.map((c: any) => ({
        fecha,
        hipodromo: c.hipodromo,
        carrera: c.carrera,
        estado: c.estado || "Programada",
        caballos: c.caballos,
        distancia: c.distancia ? String(c.distancia) : null,
        superficie: c.superficie || "ARENA",
        premio: c.premio != null && Number.isFinite(Number(c.premio)) ? Number(c.premio) : null,
        hora: c.hora || null,
        origen: c.origen || "manual",
        actualizado_por: creadoPor || "sistema",
        updated_at: new Date().toISOString(),
      }));

      const { error: errCarr } = await supabase
        .from("carreras")
        .upsert(filasCarreras, { onConflict: "fecha,hipodromo,carrera" });

      if (errCarr) {
        console.error("[API guardar-programa] Error en carreras:", errCarr);
        return NextResponse.json({ ok: false, error: `Error guardando matriz de carreras: ${errCarr.message}` }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true, data: normP, guardadas: carreras.length });
  } catch (err: any) {
    console.error("[API guardar-programa] Excepción:", err);
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
