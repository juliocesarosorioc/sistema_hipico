import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { codigoSalaDeGrupo, codigoSalaFallback, slugifyNombreSala } from "@/features/grupos/lib/codigo-sala";

export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function cargarMapaCodigosSalasJuego(grupoIds?: string[]): Promise<Map<string, string[]>> {
  const mapa = new Map<string, string[]>();
  try {
    let q = supabaseAdmin
      .from("salas_juego")
      .select("grupo_id, codigo_sala, activa, orden_sala")
      .order("orden_sala", { ascending: true });
    if (grupoIds && grupoIds.length > 0) {
      q = q.in("grupo_id", grupoIds);
    }
    const { data } = await q;
    for (const s of data ?? []) {
      const gid = String((s as any).grupo_id ?? "").trim();
      const cod = String((s as any).codigo_sala ?? "").trim().toLowerCase();
      if (!gid || !cod) continue;
      const arr = mapa.get(gid) ?? [];
      if (!arr.includes(cod)) arr.push(cod);
      mapa.set(gid, arr);
    }
  } catch {
    /* columna o tabla opcional */
  }
  return mapa;
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const grupoIdParam = String(sp.get("grupoId") || "").trim();
    const codigoParam = String(sp.get("codigo") || "").trim().toLowerCase();

    if (grupoIdParam) {
      const { data: g } = await supabaseAdmin
        .from("grupos_venta")
        .select("*")
        .eq("id", grupoIdParam)
        .maybeSingle();
      if (!g) {
        return NextResponse.json({ ok: false, error: "Grupo no encontrado" }, { status: 404 });
      }
      const mapaSalas = await cargarMapaCodigosSalasJuego([String(g.id)]);
      const salaCod = mapaSalas.get(String(g.id))?.[0] ?? null;
      const codigoSala = codigoSalaDeGrupo(g, salaCod);
      return NextResponse.json({
        ok: true,
        grupo: {
          id: String(g.id),
          nombre: String(g.nombre ?? ""),
          codigo_sala: codigoSala,
        },
      });
    }

    if (!codigoParam) {
      return NextResponse.json({ ok: false, error: "codigo es requerido" }, { status: 400 });
    }

    return await resolverPorCodigo(codigoParam);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Error resolviendo código de sala" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    // Opcional: guardar/actualizar código de sala desde Configuración de Grupos
    if (body?.accion === "guardar_codigo" && body?.grupoId) {
      const grupoId = String(body.grupoId).trim();
      const nuevoCodigo = String(body.codigoSala || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/g, "-")
        .replace(/^-+|-+$/g, "");
      if (!nuevoCodigo || nuevoCodigo.length < 3) {
        return NextResponse.json(
          { ok: false, error: "El código de sala debe tener al menos 3 caracteres alfanuméricos." },
          { status: 400 }
        );
      }

      const { data: todosGrupos } = await supabaseAdmin
        .from("grupos_venta")
        .select("*")
        .neq("id", grupoId);
      const mapaOtros = await cargarMapaCodigosSalasJuego();
      const ocupado = (todosGrupos ?? []).some((otro: any) => {
        const codOtro = codigoSalaDeGrupo(otro, mapaOtros.get(String(otro.id))?.[0] ?? null);
        return (
          codOtro === nuevoCodigo ||
          String(otro.slug || "").trim().toLowerCase() === nuevoCodigo ||
          String(otro.codigo_sala || "").trim().toLowerCase() === nuevoCodigo
        );
      });
      if (ocupado) {
        return NextResponse.json(
          { ok: false, error: `El código "${nuevoCodigo}" ya pertenece a otro grupo.` },
          { status: 409 }
        );
      }

      // Intentar guardar en grupos_venta.codigo_sala (si migración aplicada), grupos_venta.slug y salas_juego.codigo_sala
      await supabaseAdmin.from("grupos_venta").update({ codigo_sala: nuevoCodigo }).eq("id", grupoId);
      await supabaseAdmin.from("grupos_venta").update({ slug: nuevoCodigo }).eq("id", grupoId);
      await supabaseAdmin.from("salas_juego").update({ codigo_sala: nuevoCodigo }).eq("grupo_id", grupoId);

      return NextResponse.json({ ok: true, codigo_sala: nuevoCodigo });
    }

    const codigo = String(body?.codigo || "").trim().toLowerCase();
    if (!codigo) {
      return NextResponse.json({ ok: false, error: "Ingresá el código de sala." }, { status: 400 });
    }
    return await resolverPorCodigo(codigo);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Error resolviendo código de sala" },
      { status: 500 }
    );
  }
}

async function resolverPorCodigo(codigo: string) {
  // 1. Intentar RPC oficial si ya fue aplicada en Supabase
  try {
    const { data, error } = await supabaseAdmin.rpc("club_resolver_codigo_sala", {
      p_codigo: codigo,
    });
    if (!error && data) {
      const fila = Array.isArray(data) ? data[0] : data;
      if (fila?.id) {
        return NextResponse.json({
          ok: true,
          grupo: {
            id: String(fila.id),
            nombre: String(fila.nombre ?? ""),
            codigo_sala: String(fila.codigo_sala ?? codigo),
          },
        });
      }
    }
  } catch {
    /* caer a resolución administrada */
  }

  // 2. Resolución directa vía Service Role sobre grupos activos y salas_juego
  const { data: grupos, error } = await supabaseAdmin.from("grupos_venta").select("*");
  if (error || !Array.isArray(grupos)) {
    return NextResponse.json(
      { ok: false, error: "Código de sala no válido. Verificá el código con tu administrador." },
      { status: 404 }
    );
  }

  const mapaSalas = await cargarMapaCodigosSalasJuego();

  for (const g of grupos as any[]) {
    if (g.activo === false) continue;
    const codsSala = mapaSalas.get(String(g.id)) ?? [];
    const codCanonico = codigoSalaDeGrupo(g, codsSala[0] ?? null);
    const codColumna = String(g.codigo_sala ?? "").trim().toLowerCase();
    const codSlug = String(g.slug ?? "").trim().toLowerCase();
    const codNombreSinEspacios = codigoSalaFallback(g.nombre).toLowerCase();
    const codSlugConId = `${slugifyNombreSala(g.nombre)}-${String(g.id ?? "").replace(/-/g, "").slice(0, 8)}`.toLowerCase();

    const coincide =
      codCanonico.toLowerCase() === codigo ||
      (codColumna && codColumna === codigo) ||
      (codSlug && codSlug === codigo) ||
      (codNombreSinEspacios && codNombreSinEspacios === codigo) ||
      codSlugConId === codigo ||
      codsSala.includes(codigo) ||
      (g.es_principal === true && codigo === "principal");

    if (coincide) {
      return NextResponse.json({
        ok: true,
        grupo: {
          id: String(g.id),
          nombre: String(g.nombre ?? ""),
          codigo_sala: codCanonico,
        },
      });
    }
  }

  return NextResponse.json(
    { ok: false, error: "Código de sala no válido. Verificá el código con tu administrador." },
    { status: 404 }
  );
}
