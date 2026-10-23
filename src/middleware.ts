import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const RUTAS_PUBLICAS = ["/login", "/portal", "/reset-password", "/"];

export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  const { pathname } = request.nextUrl;

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

  response.headers.set("Content-Security-Policy", cspHeader);
  response.headers.set("X-Frame-Options", "SAMEORIGIN");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  // 2. Bloqueo de acceso directo a archivos sensibles o scripts internos
  if (
    pathname.endsWith(".sql") ||
    pathname.endsWith(".mjs") ||
    pathname.endsWith(".cjs") ||
    pathname.startsWith("/pruebas") ||
    pathname.startsWith("/sondas")
  ) {
    return new NextResponse("Acceso Denegado", { status: 403 });
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};