import { NextRequest, NextResponse } from "next/server";
import { SignJWT } from "jose";
import { supabaseAdmin } from "@/core/supabase-admin";
import { verificarTokenStaff } from "@/features/sala-juegos/lib/sala-auth";
import { CAPACIDADES_POR_CLAVE } from "@/features/seguridad/lib/capacidades";
import {
  baseDeTipo,
  esUsuarioPrincipal,
  resolverAccesos,
} from "@/features/seguridad/lib/resolver";
import type { ExcepcionUsuario, TipoUsuario } from "@/features/seguridad/lib/tipos";

export const dynamic = "force-dynamic";

const MAX_AGE = 604800;
const CAPS_CLIENTE = [
  "portal:ruta_portal",
  "portal:btn_jugar",
  "portal:celda_saldo_portal",
];

type ClaimsSesion = {
  usuario: string;
  perfil: string;
  rol: string;
  permisos: string[];
  acceso: "ok" | "sin";
  grupoId: string | null;
};

function claveDeUsuario(v: unknown): string {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .split("@")[0];
}

function capacidadesDeRuta(permitidas: Iterable<string>): string[] {
  return [...new Set(permitidas)].filter(
    (k) => CAPACIDADES_POR_CLAVE.get(k)?.tipo === "ruta"
  );
}

function perfilesPorRol(rol: string, tipoNombre: string): string[] {
  if (rol === "cliente") return ["cliente"];
  if (rol === "superadmin") return ["admin"];
  return [tipoNombre || "admin_grupo"];
}

function opcionesCookie(req?: NextRequest) {
  const esHttps =
    req?.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https" ||
    req?.nextUrl.protocol === "https:";
  return {
    path: "/",
    httpOnly: true,
    secure: Boolean(esHttps),
    sameSite: "lax" as const,
    maxAge: MAX_AGE,
  };
}

/** Sesiones de operador: la identidad sale del token HMAC que emite /api/sala. */
function claimsDesdeStaff(token: string): ClaimsSesion | null {
  const verificada = verificarTokenStaff(token);
  if (!verificada.valido || !verificada.payload?.usuarioId) return null;

  const { usuarioId, grupoId, esAdmin, esOperador } = verificada.payload;
  const principal = esUsuarioPrincipal(usuarioId);
  const tipoNombre = esAdmin ? "admin" : esOperador ? "operador" : "admin_grupo";
  const rol = principal ? "superadmin" : "admin_grupo";
  const base = esAdmin ? baseDeTipo("admin") : baseDeTipo("operador");
  const permisos = capacidadesDeRuta(base);
  const perfiles = perfilesPorRol(rol, tipoNombre);

  return {
    usuario: claveDeUsuario(usuarioId),
    perfil: perfiles.join(","),
    rol,
    permisos,
    acceso: perfiles.length || permisos.length ? "ok" : "sin",
    grupoId: grupoId || null,
  };
}

/** Sesiones admin/usuario: la identidad la verifica Supabase Auth. */
async function claimsDesdeSupabase(accessToken: string): Promise<ClaimsSesion | null> {
  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !data.user) return null;

  const id = claveDeUsuario(
    data.user.email ?? (data.user.user_metadata as {usuario?: unknown} | undefined)?.usuario ?? data.user.id
  );
  if (!id) return null;

  if (esUsuarioPrincipal(id)) {
    return {
      usuario: id,
      perfil: "admin",
      rol: "superadmin",
      permisos: capacidadesDeRuta(baseDeTipo("admin")),
      acceso: "ok",
      grupoId: null,
    };
  }

  const { data: alta } = await supabaseAdmin
    .from("usuario_sistema")
    .select("id, tipo_usuario_id, activo, grupo_id")
    .eq("id", id)
    .maybeSingle();
  if (!alta || (alta as {activo?: unknown}).activo === false) return null;

  const tipoId = (alta as {tipo_usuario_id?: unknown}).tipo_usuario_id;
  if (tipoId == null) return null;

  const { data: tipoRow } = await supabaseAdmin
    .from("tipo_usuario")
    .select("id, nombre, activo")
    .eq("id", tipoId)
    .maybeSingle();
  if (!tipoRow || (tipoRow as {activo?: unknown}).activo === false) return null;

  const [capsRes, excRes] = await Promise.all([
    supabaseAdmin
      .from("tipo_usuario_capacidad")
      .select("decision, capacidad (clave)")
      .eq("tipo_usuario_id", tipoId),
    supabaseAdmin
      .from("usuario_capacidad")
      .select("decision, capacidad (clave)")
      .eq("usuario_id", id),
  ]);

  const capacidades = (capsRes.data ?? [])
    .filter((f) => f.decision !== "denegado")
    .map((f) => (f.capacidad as {clave?: string} | null)?.clave)
    .filter((k): k is string => Boolean(k));
  const excepciones: ExcepcionUsuario = {};
  for (const f of excRes.data ?? []) {
    const clave = (f.capacidad as {clave?: string} | null)?.clave;
    if (!clave) continue;
    if (f.decision === "permitido" || f.decision === "denegado" || f.decision === "heredado") {
      excepciones[clave] = f.decision;
    }
  }

  const tipo: TipoUsuario = {
    id: String((tipoRow as {id: unknown}).id),
    nombre: String((tipoRow as {nombre: unknown}).nombre ?? ""),
    activo: true,
    capacidades,
  };
  const resolucion = resolverAccesos({ identificador: id, tipo, excepciones });
  const rol = resolucion.total
    ? "superadmin"
    : /jugador|cliente/i.test(tipo.nombre)
      ? "cliente"
      : "admin_grupo";
  const perfiles = perfilesPorRol(rol, tipo.nombre);
  let permisos = capacidadesDeRuta(resolucion.permitidas);
  if (rol === "cliente") {
    const soloPortal = permisos.filter((k) => CAPS_CLIENTE.includes(k));
    permisos = soloPortal.length ? soloPortal : [...CAPS_CLIENTE];
  }
  const grupoIdRaw = (alta as {grupo_id?: unknown}).grupo_id;

  return {
    usuario: id,
    perfil: perfiles.join(","),
    rol,
    permisos,
    acceso: perfiles.length || permisos.length ? "ok" : "sin",
    grupoId: grupoIdRaw ? String(grupoIdRaw) : null,
  };
}

export async function POST(req: NextRequest) {
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    console.error("[SESSION_ERR] Falta SESSION_SECRET");
    return NextResponse.json(
      { ok: false, error: "Error interno al procesar la sesión." },
      { status: 500 }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const staffToken = typeof body?.staffToken === "string" ? body.staffToken.trim() : "";
    const accessToken = typeof body?.accessToken === "string" ? body.accessToken.trim() : "";

    const claims = staffToken
      ? claimsDesdeStaff(staffToken)
      : accessToken
        ? await claimsDesdeSupabase(accessToken)
        : null;
    if (!claims) {
      return NextResponse.json({ ok: false, error: "No autorizado." }, { status: 401 });
    }

    const token = await new SignJWT({ ...claims })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(claims.usuario)
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(new TextEncoder().encode(sessionSecret));

    const respuesta = NextResponse.json({ ok: true });
    respuesta.cookies.set("hipico_session", token, opcionesCookie(req));
    return respuesta;
  } catch (err) {
    console.error("[SESSION_ERR]", err);
    return NextResponse.json(
      { ok: false, error: "Error interno al procesar la sesión." },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  const respuesta = NextResponse.json({ ok: true });
  respuesta.cookies.set("hipico_session", "", { ...opcionesCookie(), maxAge: 0 });
  return respuesta;
}
