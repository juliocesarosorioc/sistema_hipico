import { NextResponse, type NextRequest } from "next/server";

/**
 * Middleware de protección de rutas RBAC (Next.js 14, App Router).
 *
 * El store de auth (useAuthStore) publica dos cookies al iniciar sesión /
 * simular perfil:
 *   hipico_perfil   → nombre(s) de perfil (ej. "Taquillero", "Cliente")
 *   hipico_permisos → set de permisos vigentes separados por comas
 *
 * Reglas:
 *  1) El rol "Cliente" (permiso `acceso_portal`) SOLO puede entrar a /portal.
 *     Cualquier otra ruta admin → redirige a /portal.
 *  2) Rutas listadas en RUTAS_PERMISOS exigen su permiso específico.
 *  3) Si el usuario NO tiene la cookie (RBAC aún no sembrado) se deja pasar
 *     (modo demo) para no romper el flujo actual sin pantalla de login.
 */
const RUTAS_PERMISOS: Array<{ ruta: string; permiso: string }> = [
  { ruta: "/seguridad", permiso: "administrar_seguridad" },
  { ruta: "/clientes", permiso: "gestionar_clientes" },
  // Módulos futuros (ej. cuando se migre contabilidad):
  // { ruta: "/contabilidad", permiso: "ver_contabilidad" },
  // { ruta: "/auditoria", permiso: "ver_auditoria" },
];

/** Rutas del portal: accesibles para el rol Cliente (y también para admin). */
const ES_PORTAL = (p: string) => p === "/portal" || p.startsWith("/portal/");

/** ¿El usuario posee SOLO el acceso al portal (rol Cliente) y nada más de admin? */
function esRolCliente(perfil: string, permisos: Set<string>): boolean {
  const nombres = perfil.split(",").map((s) => s.trim().toLowerCase());
  const esCliente = nombres.some((n) => n === "cliente");
  if (!esCliente) return false;
  // Si además tiene permisos de administración, no es un cliente "puro".
  const tieneAdmin = [...permisos].some((p) => p !== "acceso_portal");
  return !tieneAdmin;
}

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

  // 1) Rol Cliente: solo /portal (bloquea cualquier intento de entrar al Dashboard admin).
  if (esRolCliente(perfil, permisos) && !ES_PORTAL(pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = "/portal";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // 2) Rutas con permiso específico.
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
  // Cubre las rutas admin protegidas + el portal + el dashboard.
  matcher: [
    "/seguridad/:path*",
    "/clientes/:path*",
    "/portal/:path*",
    "/dashboard/:path*",
    "/gestion-jugadas/:path*",
    "/tablas-fijas/:path*",
    "/ejemplares/:path*",
    "/hipodromos/:path*",
    "/whatsapp/:path*",
  ],
};
