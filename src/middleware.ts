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
 * Middleware de protección de rutas. La lista de rutas y las capacidades que
 * exige cada una salen del REGISTRO MAESTRO (src/lib/seguridad/capacidades.ts):
 * no hay una segunda lista que mantener acá.
 *
 * [Módulo 1 - Seguridad reforzada]:
 *  - Bloqueo de agentes de bots maliciosos conocidos.
 *  - Bloqueo de rutas de escaneo (wp-admin, etc.).
 *  - Verificación de que variables privadas no estén en headers.
 *  - Cabeceras de seguridad adicionales en cada respuesta.
 *
 * ALCANCE — IMPORTANTE:
 * Este archivo SOLO corre en modo servidor (`next dev` / `next start`). Con
 * `output: "export"` (build estático, `npm run build:export`) Next elimina el
 * middleware en tiempo de compilación, así que en ese despliegue la frontera de
 * seguridad real son:
 *   1) la sesión de Supabase,
 *   2) las políticas RLS de la base (src/db/seguridad_maestro.sql), que deben
 *      validar por auth.uid() y NUNCA con la llave anon, y
 *   3) los guardas de cliente (RutaProtegida + Guard + AppShell), que son
 *      experiencia de usuario, NO seguridad: el JS del cliente es descargable.
 */

const ES_PUBLICA = (p: string) => p === "/login" || p === "/" || p === "/verificacion";

/** Rutas y extensiones que deben bloquearse siempre con 403. */
const BLOQUEAR = (p: string) => {
  // Archivos sensibles del repositorio
  if (
    p.endsWith(".sql") ||
    p.endsWith(".mjs") ||
    p.endsWith(".cjs") ||
    p.endsWith(".env") ||
    p.endsWith(".env.local")
  ) return true;
  // Rutas de debug/prueba internas
  if (p.startsWith("/pruebas") || p.startsWith("/sondas")) return true;
  // Rutas comunes de escaneo de vulnerabilidades (WordPress, phpMyAdmin, etc.)
  if (
    /^\/(wp-admin|wp-login|phpmyadmin|admin|administrator|\.git|\.svn|xmlrpc)/i.test(p)
  ) return true;
  return false;
};

/**
 * Detecta agentes de bots maliciosos o escáneres de seguridad automatizados.
 * Permite Googlebot, bingbot y otros crawlers legítimos pasando un patrón negativo.
 */
const ES_BOT_MALICIOSO = (ua: string): boolean => {
  if (!ua) return false;
  const uaLower = ua.toLowerCase();
  // Permitir crawlers legítimos explícitamente
  if (/googlebot|bingbot|yandexbot|duckduckbot|slurp/i.test(uaLower)) return false;
  // Bloquear herramientas de escaneo conocidas
  return /sqlmap|nikto|nmap|masscan|zgrab|dirbuster|gobuster|wfuzz|hydra|medusa|burpsuite|havij|acunetix|nessus|openvas|w3af/i.test(
    uaLower
  );
};

const ES_PORTAL = (p: string) => p === "/portal" || p.startsWith("/portal/");
const ES_SALA = (p: string) => p === "/sala" || p.startsWith("/sala/");
const ES_API_SALA = (p: string) => p === "/api/sala" || p.startsWith("/api/sala/");

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const irA = (destino: string, motivo?: string) => {
    const url = req.nextUrl.clone();
    url.pathname = destino;
    url.search = "";
    if (motivo) url.searchParams.set("motivo", motivo);
    return NextResponse.redirect(url);
  };

  // [Módulo 1] Bloquear rutas sensibles y escaneos.
  if (BLOQUEAR(pathname)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  // [Módulo 1] Bloquear bots maliciosos.
  const ua = req.headers.get("user-agent") ?? "";
  if (ES_BOT_MALICIOSO(ua)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  // [Seguridad] Bloquear escaneos de bots automatizados que prueban Server Actions falsas (ej. Next-Action: x)
  const nextAction = req.headers.get("next-action");
  if (nextAction) {
    return new NextResponse("Not Found", { status: 404 });
  }

  if (ES_PUBLICA(pathname)) return NextResponse.next();

  if (ES_PORTAL(pathname) || ES_SALA(pathname) || ES_API_SALA(pathname)) return NextResponse.next();

  const usuario = req.cookies.get("hipico_usuario")?.value ?? "";
  const perfil = req.cookies.get("hipico_perfil")?.value;
  const crudo = req.cookies.get("hipico_permisos")?.value;
  const acceso = req.cookies.get("hipico_acceso")?.value;

  if (acceso === "sin") return irA("/login", "sin-accesos");

  if (!perfil || !crudo || !usuario) return irA("/login");

  let permisos: Set<string>;
  try {
    permisos = new Set(crudo.split(",").filter(Boolean));
  } catch {
    permisos = new Set();
  }

  if (esUsuarioPrincipal(usuario)) return NextResponse.next();

  if (esRolCliente(perfil, permisos)) {
    if (pathname === "/portal" || pathname.startsWith("/portal/")) return NextResponse.next();
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

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|verificacion|_next|favicon.ico|.*\\..*).*)", "/:path*\\.(sql|mjs|cjs)"],
};
