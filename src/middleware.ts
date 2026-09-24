import { NextResponse, type NextRequest } from "next/server";

/**
 * Middleware de protección de rutas RBAC (Next.js 14, App Router).
 *
 * El store de auth (useAuthStore) publica dos cookies al iniciar sesión /
 * simular perfil:
 *   hipico_perfil   → nombre(s) de perfil (ej. "Taquillero")
 *   hipico_permisos → set de permisos vigentes separados por comas
 *
 * Solo se bloquean las rutas listadas en RUTAS_PERMISOS. Si el usuario NO
 * tiene la cookie (RBAC aún no sembrado) se deja pasar (modo demo) para no
 * romper el flujo actual sin pantalla de login.
 */
const RUTAS_PERMISOS: Array<{ ruta: string; permiso: string }> = [
  { ruta: "/seguridad", permiso: "administrar_seguridad" },
  // Módulos futuros (ej. cuando se migre contabilidad):
  // { ruta: "/contabilidad", permiso: "ver_contabilidad" },
  // { ruta: "/auditoria", permiso: "ver_auditoria" },
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const perfil = req.cookies.get("hipico_perfil")?.value;
  if (!perfil) return NextResponse.next();

  let permisos: Set<string>;
  try {
    permisos = new Set((req.cookies.get("hipico_permisos")?.value ?? "").split(",").filter(Boolean));
  } catch {
    permisos = new Set();
  }

  const exigido = RUTAS_PERMISOS.find((g) => pathname === g.ruta || pathname.startsWith(`${g.ruta}/`));
  if (exigido && !permisos.has(exigido.permiso)) {
    const url = req.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/seguridad/:path*"],
};