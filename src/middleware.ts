import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import {
  esRolCliente,
  esRolOperadorExclusivo,
  esRutaPermitidaOperador,
  primeraRutaPermitida,
  rutaPermitida,
} from "@/features/seguridad/lib/capacidades";

const SESSION_SECRET = process.env.SESSION_SECRET;

type SesionVerificada = {
  usuario: string;
  perfil: string;
  rol: string;
  permisos: string[];
  acceso: string;
};

async function leerSesion(req: NextRequest): Promise<SesionVerificada | null> {
  const token = req.cookies.get("hipico_session")?.value;
  if (!token || !SESSION_SECRET) return null;

  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(SESSION_SECRET),
      { algorithms: ["HS256"] }
    );
    const usuario = typeof payload.usuario === "string" ? payload.usuario : "";
    const perfil = typeof payload.perfil === "string" ? payload.perfil : "";
    const rol = typeof payload.rol === "string" ? payload.rol : "";
    const acceso = typeof payload.acceso === "string" ? payload.acceso : "";
    const permisos = Array.isArray(payload.permisos)
      ? payload.permisos.filter((p): p is string => typeof p === "string")
      : [];
    if (!usuario || !perfil || !rol) return null;
    return { usuario, perfil, rol, permisos, acceso };
  } catch {
    return null;
  }
}

/**
 * Middleware de protección de rutas:
 * - Entrada pública única recomendada: `/` (bienvenida/publicidad + acceso).
 * - `/login` y `/comercial` redirigen a `/` para evitar accesos duplicados.
 * - Todas las respuestas protegidas llevan cabeceras anti-caché para anular
 *   el BFCache (botón "Atrás" del navegador).
 * - La lista de rutas y capacidades sale del REGISTRO MAESTRO.
 */

const ES_PUBLICA = (p: string) =>
  p === "/" ||
  // El SW precachea esta ruta al instalarla: si el middleware la redirigiera a
  // "/", la página de respaldo offline se guardaría con el HTML de portada.
  p === "/_offline" ||
  p === "/verificacion" ||
  p === "/reset-password" ||
  p === "/api/ip" ||
  p.startsWith("/api/auth/");

/** Superficies internas con su propia validación (CSRF / secreto del daemon). */
const ES_SERVICIO_INTERNO = (p: string) =>
  p === "/api/whatsapp/upload" ||
  p === "/api/whatsapp-sala" ||
  p.startsWith("/api/whatsapp-sala/") ||
  p.startsWith("/api/whatsapp/") ||
  p.startsWith("/api/auth/");

/** Rutas y extensiones que deben bloquearse siempre con 403. */
const BLOQUEAR = (p: string) => {
  if (p === "/pdf.worker.min.mjs" || p.endsWith("/pdf.worker.min.mjs")) return false;
  if (
    p.endsWith(".sql") ||
    p.endsWith(".mjs") ||
    p.endsWith(".cjs") ||
    p.endsWith(".env") ||
    p.endsWith(".env.local")
  ) return true;
  if (p.startsWith("/pruebas") || p.startsWith("/sondas")) return true;
  if (
    /^\/(wp-admin|wp-login|phpmyadmin|admin|administrator|\.git|\.svn|xmlrpc)/i.test(p)
  ) return true;
  return false;
};

const ES_BOT_MALICIOSO = (ua: string): boolean => {
  if (!ua) return false;
  const uaLower = ua.toLowerCase();
  if (/googlebot|bingbot|yandexbot|duckduckbot|slurp/i.test(uaLower)) return false;
  return /sqlmap|nikto|nmap|masscan|zgrab|dirbuster|gobuster|wfuzz|hydra|medusa|burpsuite|havij|acunetix|nessus|openvas|w3af/i.test(
    uaLower
  );
};

/** Cabeceras que impiden que "Atrás" recupere HTML de una sesión cerrada. */
function sinCache<T extends NextResponse>(respuesta: T): T {
  respuesta.headers.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );
  respuesta.headers.set("Pragma", "no-cache");
  respuesta.headers.set("Expires", "0");
  return respuesta;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const irA = (destino: string, motivo?: string) => {
    const url = req.nextUrl.clone();
    url.pathname = destino;
    url.search = "";
    if (motivo) url.searchParams.set("motivo", motivo);
    return sinCache(NextResponse.redirect(url));
  };

  // Permitir explícitamente el worker de pdf.js sin autenticación ni bloqueos
  if (pathname === "/pdf.worker.min.mjs" || pathname.endsWith("/pdf.worker.min.mjs")) {
    return sinCache(NextResponse.next());
  }

  if (BLOQUEAR(pathname)) {
    return sinCache(new NextResponse("Forbidden", { status: 403 }));
  }

  const ua = req.headers.get("user-agent") ?? "";
  if (ES_BOT_MALICIOSO(ua)) {
    return sinCache(new NextResponse("Forbidden", { status: 403 }));
  }

  const nextAction = req.headers.get("next-action");
  if (nextAction) {
    return sinCache(new NextResponse("Not Found", { status: 404 }));
  }

  // Entrada única: `/login` y `/comercial` apuntan siempre a la portada.
  if (pathname === "/login" || pathname === "/comercial") {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return sinCache(NextResponse.redirect(url));
  }

  if (ES_PUBLICA(pathname)) return sinCache(NextResponse.next());

  const sesion = await leerSesion(req);

  if (!sesion && !ES_SERVICIO_INTERNO(pathname)) {
    return irA("/");
  }

  if (sesion?.acceso === "sin") return irA("/", "sin-accesos");

  if (ES_SERVICIO_INTERNO(pathname)) return sinCache(NextResponse.next());

  if (!sesion) return irA("/");

  const permisos = new Set(sesion.permisos);

  if (esRolCliente(sesion.perfil, permisos)) {
    if (pathname === "/portal" || pathname.startsWith("/portal/")) {
      return sinCache(NextResponse.next());
    }
    return irA("/portal");
  }

  if (esRolOperadorExclusivo(sesion.perfil)) {
    if (!esRutaPermitidaOperador(pathname)) {
      return irA("/apuestas");
    }
  }

  if (!rutaPermitida(pathname, permisos)) {
    const destino = primeraRutaPermitida(permisos);
    if (!destino) return irA("/", "sin-accesos");
    return irA(destino);
  }

  return sinCache(NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next|favicon.ico|.*\\..*).*)", "/:path*\\.(sql|mjs|cjs)"],
};
