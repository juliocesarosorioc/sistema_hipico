import { NextResponse, type NextRequest } from "next/server";
import {
  esRolCliente,
  primeraRutaPermitida,
  rutaPermitida,
} from "@/lib/seguridad/capacidades";
import { esUsuarioPrincipal } from "@/lib/seguridad/resolver";

/**
 * Middleware de protección de rutas. La lista de rutas y las capacidades que
 * exige cada una salen del REGISTRO MAESTRO (src/lib/seguridad/capacidades.ts):
 * no hay una segunda lista que mantener acá.
 *
 * El store de auth publica cuatro cookies al resolver la sesión:
 *   hipico_usuario → identificador del usuario (josorioc, operador1...)
 *   hipico_perfil  → nombre(s) del tipo de usuario
 *   hipico_permisos → capacidades vigentes separadas por comas
 *   hipico_acceso  → "ok" | "sin": si la sesión se verificó y el usuario tiene
 *                    algo con qué entrar, o si entró pero no tiene NADA
 *
 * La cuarta cookie es la que evita el bucle de "ingresé el usuario y no me dejó
 * entrar": sin ella, un usuario sin tipo asignado publicaba perfil y permisos
 * VACÍOS, el middleware lo mandaba a /login y la pantalla de login —que ve que
 * hay sesión— lo volvía a mandar a /dashboard, sin fin. Con el sello explícito
 * cada caso tiene un destino y el operador además lee por qué.
 *
 * REGLAS:
 *  1) El sello `hipico_acceso=sin` manda al login CON motivo: la sesión se
 *     verificó pero el usuario no tiene nada con qué entrar.
 *  2) Sin cookies de sesión: al login, sin motivo. No se entra a nada sin haber
 *     pasado por /login.
 *  3) El usuario principal pasa siempre: es el dueño del sistema.
 *  4) Un usuario "cliente/jugador" puro se queda en /portal.
 *  5) El resto de las rutas exige la capacidad que el esquema les asigna; una
 *     ruta que el esquema no conoce se NIEGA.
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
 *
 * Para una herramienta con datos de clientes y saldos, el despliegue con
 * `npm run build` + `next start` es el que conserva esta capa de servidor.
 */

const ES_PUBLICA = (p: string) => p === "/login" || p === "/";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const irA = (destino: string, motivo?: string) => {
    const url = req.nextUrl.clone();
    url.pathname = destino;
    url.search = "";
    // El motivo viaja en la query para que la pantalla diga POR QUÉ, y no para
    // autorizar nada: la decisión ya está tomada antes de redirigir.
    if (motivo) url.searchParams.set("motivo", motivo);
    return NextResponse.redirect(url);
  };

  if (ES_PUBLICA(pathname)) return NextResponse.next();

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
  }

  // 3) El usuario principal entra a todo. Se lee el IDENTIFICADOR, no el perfil:
  //    el perfil del principal es "admin" (su tipo), igual que el de cualquier
  //    otro administrador, y comparando el perfil nunca se distinguían.
  if (esUsuarioPrincipal(usuario)) return NextResponse.next();

  // 4) Cliente/jugador puro: solo el portal.
  if (esRolCliente(perfil, permisos)) {
    if (pathname === "/portal" || pathname.startsWith("/portal/")) return NextResponse.next();
    return irA("/portal");
  }

  // 5) Cada ruta exige su capacidad. La decisión la toma `rutaPermitida`, la
  //    MISMA función que usa `RutaProtegida` en el cliente: si las dos capas
  //    decidieran distinto, el usuario vería la página que el middleware dejó
  //    pasar o la redirección que el cliente ya había rechazado.
  //
  //    Una ruta NO registrada se NIEGA. Antes pasaba de largo: una página nueva
  //    sin declarar en PUERTAS se abría por URL directa sin comprobar nada.
  if (!rutaPermitida(pathname, permisos)) {
    // A la PRIMERA ruta que el usuario puede abrir. `/dashboard` fijo era un
    // bucle: exige `general:ruta_dashboard`, que un operador de Taquilla o de
    // Marcas no tiene, así que lo echaba de /dashboard a /dashboard para
    // siempre. Sin ninguna ruta posible se vuelve al login.
    const destino = primeraRutaPermitida(permisos);
    if (!destino) return irA("/login", "sin-accesos");
    return irA(destino);
  }

  return NextResponse.next();
}

export const config = {
  // Todo el sitio menos la raíz, /login y los archivos estáticos. El portal NO
  // queda fuera: también exige sesión.
  matcher: ["/((?!login|_next|favicon.ico|.*\\..*).*)"],
};