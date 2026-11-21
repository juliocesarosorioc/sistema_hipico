import { jwtVerify } from "jose";
import type { NextRequest } from "next/server";

export type SesionVerificada = {
  sub: string;
  usuario: string;
  perfil: string;
  rol: string;
  permisos: string[];
  acceso: string;
  clienteId: string | null;
  grupoId: string | null;
};

export type ResultadoSesion =
  | { ok: true; sesion: SesionVerificada }
  | { ok: false; status: number; error: string };

/** Valida `hipico_session` firmada (HS256) y autoriza por rol server-side. */
export async function requireSession(
  req: NextRequest,
  rolesPermitidos: readonly string[]
): Promise<ResultadoSesion> {
  const secreto = process.env.SESSION_SECRET;
  if (!secreto) {
    return { ok: false, status: 500, error: "SESSION_SECRET no configurado." };
  }

  const token = req.cookies.get("hipico_session")?.value;
  if (!token) {
    return { ok: false, status: 401, error: "Sesión firmada requerida." };
  }

  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(secreto),
      { algorithms: ["HS256"] }
    );

    const usuario = typeof payload.usuario === "string" ? payload.usuario.trim() : "";
    const perfil = typeof payload.perfil === "string" ? payload.perfil.trim() : "";
    const rol = typeof payload.rol === "string" ? payload.rol.trim() : "";
    const acceso = typeof payload.acceso === "string" ? payload.acceso.trim() : "";
    const sub =
      (typeof payload.sub === "string" && payload.sub.trim()) ||
      (typeof payload.clienteId === "string" && payload.clienteId.trim()) ||
      usuario;
    const permisos = Array.isArray(payload.permisos)
      ? payload.permisos.filter((p): p is string => typeof p === "string")
      : [];

    if (!sub || !usuario || !perfil || !rol || acceso === "sin") {
      return { ok: false, status: 401, error: "Sesión inválida." };
    }
    if (rolesPermitidos.length && !rolesPermitidos.includes(rol)) {
      return { ok: false, status: 403, error: "Rol no autorizado." };
    }

    return {
      ok: true,
      sesion: {
        sub,
        usuario,
        perfil,
        rol,
        permisos,
        acceso,
        clienteId: typeof payload.clienteId === "string" ? payload.clienteId.trim() || null : null,
        grupoId: typeof payload.grupoId === "string" ? payload.grupoId.trim() || null : null,
      },
    };
  } catch {
    return { ok: false, status: 401, error: "Sesión inválida o expirada." };
  }
}
