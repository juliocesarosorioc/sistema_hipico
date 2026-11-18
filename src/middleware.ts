import { NextResponse, type NextRequest } from "next/server";
import {
  esRolCliente,
  esRolOperadorExclusivo,
  esRutaPermitidaOperador,
  primeraRutaPermitida,
  rutaPermitida,
} from "@/features/seguridad/lib/capacidades";
import { esUsuarioPrincipal } from "@/features/seguridad/lib/resolver";

/**
 * Middleware de protección de rutas:
 * - NINGUNA ruta se sirve sin sesión, excepto /login.
 * - Todas las respuestas protegidas llevan cabeceras anti-caché para anular
 *   el BFCache (botón "Atrás" del navegador).
 * - La lista de rutas y capacidades sale del REGISTRO MAESTRO.
 */

const ES_PUBLICA = (p: string) =>
  p === "/login" ||
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

export function middleware(req: NextRequest) {
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

  if (ES_PUBLICA(pathname)) return sinCache(NextResponse.next());

  const usuario = req.cookies.get("hipico_usuario")?.value ?? "";
  const perfil = req.cookies.get("hipico_perfil")?.value;
  const crudo = req.cookies.get("hipico_permisos")?.value;
  const acceso = req.cookies.get("hipico_acceso")?.value;
  const tokenSala = req.cookies.get("sala_staff_token")?.value ?? "";
  const tokenSupabase = req.cookies
    .getAll()
    .some((c) => c.name.startsWith("sb-") && c.name.endsWith("-auth-token") && Boolean(c.value));

  const tieneSesion = Boolean(
    usuario || tokenSala || tokenSupabase || (perfil && crudo)
  );

  if (!tieneSesion && !ES_SERVICIO_INTERNO(pathname)) {
    return irA("/login");
  }

  if (acceso === "sin") return irA("/login", "sin-accesos");

  if (ES_SERVICIO_INTERNO(pathname)) return sinCache(NextResponse.next());

  if (esUsuarioPrincipal(usuario)) return sinCache(NextResponse.next());

  if (!perfil || !crudo || !usuario) return irA("/login");

  let permisos: Set<string>;
  try {
    permisos = new Set(crudo.split(",").filter(Boolean));
  } catch {
    permisos = new Set();
  }

  if (esUsuarioPrincipal(usuario)) return sinCache(NextResponse.next());

  if (esRolCliente(perfil, permisos)) {
    if (pathname === "/portal" || pathname.startsWith("/portal/")) {
      return sinCache(NextResponse.next());
    }
    return irA("/portal");
  }

  if (esRolOperadorExclusivo(perfil)) {
    if (!esRutaPermitidaOperador(pathname)) {
      return irA("/apuestas");
    }
  }

  if (!rutaPermitida(pathname, permisos)) {
    const destino = primeraRutaPermitida(permisos);
    if (!destino) return irA("/login", "sin-accesos");
    return irA(destino);
  }

  return sinCache(NextResponse.next());
}

export const config = {
  matcher: ["/((?!login|verificacion|_next|favicon.ico|.*\\..*).*)", "/:path*\\.(sql|mjs|cjs)"],
};
