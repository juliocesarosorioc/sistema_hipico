import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const RUTAS_PUBLICAS = ["/login", "/portal", "/reset-password", "/"];

export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  const { pathname } = request.nextUrl;

<<<<<<< HEAD
const BLOQUEAR = (p: string) => {
  return (
    p.endsWith(".sql") ||
    p.endsWith(".mjs") ||
    p.endsWith(".cjs") ||
    p.startsWith("/pruebas") ||
    p.startsWith("/sondas")
  );
};

/**
 * El Portal del Cliente (`/portal`) NO se autentica con la sesión de Supabase:
 * el jugador entra con su token/clave (o el enlace `?c=&k=`) y la autorización
 * real la hace la Edge Function `portal-auth` con service_role. Exigirle las
 * cookies `hipico_*` (que solo publica el login del staff) lo mandaba a
 * `/login` y PERDÍA el `?c=&k=` del enlace: ningún enlace del portal funcionaba.
 *
 * Por eso se lo exceptúa igual que en `AppShell` (`ES_PORTAL`): se renderiza
 * standalone y su frontera es el token, no la sesión del sistema. La ruta sigue
 * declarada y protegida en `PUERTAS` (`portal:ruta_portal`) para el personal;
 * lo único que se saltea acá es el requisito de sesión de Supabase.
 */
const ES_PORTAL = (p: string) => p === "/portal" || p.startsWith("/portal/");
=======
  // 1. Cabeceras de Seguridad de Nivel Bancario (CSP + Anti-Sniffing + Anti-Iframe)
  const cspHeader = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
    "img-src 'self' blob: data: https://*.supabase.co",
    "font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://generativelanguage.googleapis.com",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
>>>>>>> ab6b89d (feat(arquitectura): blindaje seguridad, inteligencia hipica con historial, fix carga gacetas, caballo invalidado y contabilidad NIIF)

  response.headers.set("Content-Security-Policy", cspHeader);
  response.headers.set("X-Frame-Options", "SAMEORIGIN");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

<<<<<<< HEAD
  if (BLOQUEAR(pathname)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  if (ES_PUBLICA(pathname)) return NextResponse.next();

  // El portal se valida solo (token/clave contra la Edge Function), así que no
  // se le exige la sesión de Supabase. Va ANTES del chequeo de cookies: si no,
  // un jugador que llega por el enlace `?c=&k=` caería en `/login` y perdería
  // el enlace (ver el comentario de ES_PORTAL).
  if (ES_PORTAL(pathname)) return NextResponse.next();

  const usuario = req.cookies.get("hipico_usuario")?.value ?? "";
  const perfil = req.cookies.get("hipico_perfil")?.value;
  const crudo = req.cookies.get("hipico_permisos")?.value;
  const acceso = req.cookies.get("hipico_acceso")?.value;

  // 1) Sesión verificada SIN permisos: se explica el motivo en el login.
  //    Va ANTES del chequeo de cookies vacías porque este caso se publica con
  //    perfil y permisos en blanco: si se preguntara por ellos primero, el
  //    motivo se perdería y el operador vería el formulario limpio, como si su
  //    contraseña hubiera estado mal.
  //
  //    El sello solo lo escribe el store después de resolver una sesión real
  //    contra Supabase, y `salir()` lo borra: falsificarlo no abre nada, manda
  //    al login.
  if (acceso === "sin") return irA("/login", "sin-accesos");

  // 2) Sin sesión: al login. No se entra a nada sin haber pasado por /login.
  if (!perfil || !crudo || !usuario) return irA("/login");

  let permisos: Set<string>;
  try {
    permisos = new Set(crudo.split(",").filter(Boolean));
  } catch {
    permisos = new Set();
=======
  // 2. Bloqueo de acceso directo a archivos sensibles o scripts internos
  if (
    pathname.endsWith(".sql") ||
    pathname.endsWith(".mjs") ||
    pathname.endsWith(".cjs") ||
    pathname.startsWith("/pruebas") ||
    pathname.startsWith("/sondas")
  ) {
    return new NextResponse("Acceso Denegado", { status: 403 });
>>>>>>> ab6b89d (feat(arquitectura): blindaje seguridad, inteligencia hipica con historial, fix carga gacetas, caballo invalidado y contabilidad NIIF)
  }

  return response;
}

export const config = {
<<<<<<< HEAD
  // Todo el sitio menos la raíz, /login y los archivos estáticos. El portal SÍ
  // pasa por el matcher, pero `middleware()` lo deja pasar sin sesión porque se
  // autentica con su propio token (ver ES_PORTAL).
  //
  // El segundo patrón existe PORQUE el primero se salta todo lo que tenga un
  // punto (`.*\..*`), y los archivos dangerousos del repo (`*.sql`, `*.mjs`,
  // `*.cjs`) tienen punto en el nombre. Sin esta entrada, un `GET /algo.sql`
  // se escapaba del middleware por el matcher y lo servía el servidor de
  // archivos en vez de recibir el 403 de `BLOQUEAR`.
  matcher: ["/((?!login|_next|favicon.ico|.*\\..*).*)", "/:path*\\.(sql|mjs|cjs)"],
=======
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
>>>>>>> ab6b89d (feat(arquitectura): blindaje seguridad, inteligencia hipica con historial, fix carga gacetas, caballo invalidado y contabilidad NIIF)
};