"use client";

/**
 * Puente con Supabase Auth. El login del sistema es REAL: la contraseña nunca
 * se guarda ni se compara en el navegador, se verifica contra Supabase y lo
 * que queda en el cliente es la sesión firmada que emite el servidor.
 */
import { supabase } from "@/lib/supabase";

/**
 * El usuario escribe `josorioc`, pero Supabase autentica por correo. Para que el
 * login no dependa de que cada operador memorice el dominio, el identificador
 * corto se resuelve con `NEXT_PUBLIC_AUTH_DOMAIN`. Si ya viene con `@`, se usa
 * tal cual.
 */
export const DOMINIO_POR_DEFECTO = "sistemahipico.local";

function dominio(): string {
  return (process.env.NEXT_PUBLIC_AUTH_DOMAIN || DOMINIO_POR_DEFECTO).trim().toLowerCase();
}

/** `josorioc` -> `josorioc@sistemahipico.local`. Un correo entra sin cambios. */
export function resolverCorreo(identificador: string): string {
  const id = (identificador ?? "").trim().toLowerCase();
  if (!id) return "";
  return id.includes("@") ? id : `${id}@${dominio()}`;
}

export type ResultadoLogin =
  | { ok: true; correo: string }
  | { ok: false; error: string };

function mensajeDeError(codigo: string, descripcion: string): string {
  if (codigo === "invalid_credentials") {
    return "Usuario o contraseña incorrectos.";
  }
  if (codigo === "email_not_confirmed") {
    return "El usuario todavía no está confirmado. Revisá el correo de invitación.";
  }
  if (codigo === "email_exists" || descripcion.includes("already been registered")) {
    return "Ese usuario ya está registrado.";
  }
  if (!supabase) {
    return "Supabase no está configurado (faltan las variables de entorno).";
  }
  return descripcion || "No se pudo iniciar sesión.";
}

/**
 * Corta una promesa que se quedó colgada.
 *
 * Por qué existe: `supabase.auth.getSession()` puede no resolver nunca si la red
 * no contesta (en este proyecto la base Supabase es intermitente). Como
 * `AppShell` no dibuja nada hasta que `inicializada` sea true, una promesa
 * colgada dejaba la APLICACIÓN ENTERA girando en el spinner: no se veía ni el
 * login. Un timeout convierte ese cuelgue en la respuesta correcta —"no hay
 * sesión", que es lo único que se puede afirmar sin servidor— y además deja
 * aparecer un error en vez de una pantalla muerta.
 *
 * `ms = 0` desactiva el corte, para las llamadas que sí pueden tardar de verdad.
 */
export async function conTimeout<T>(promesa: Promise<T>, ms: number, etiqueta: string): Promise<T> {
  if (!ms || ms <= 0) return promesa;
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promesa,
      new Promise<never>((_, rechazar) => {
        temporizador = setTimeout(
          () => rechazar(new Error(`${etiqueta} no respondió en ${Math.round(ms / 1000)}s.`)),
          ms
        );
      }),
    ]);
  } finally {
    if (temporizador) clearTimeout(temporizador);
  }
}

/**
 * Milisegundos que puede tardar la red antes de que la app deje de esperar.
 *
 * Es el MISMO presupuesto que el arranque (`MS_CARGA_INICIAL`) y que el portal
 * (`TIMEOUT_PORTAL_MS`): antes valía 6000 y cortaba el login (auth + lecturas
 * del RBAC) dos segundos antes que el propio arranque, así que con la base
 * intermitente el operador veía "no respondió" cuando la app todavía se estaba
 * dando tiempo a sí misma. Un solo número para toda la red evita ese desfase.
 */
export const TIMEOUT_SESION_MS = 8000;

/**
 * Verifica las credenciales contra Supabase. No guarda nada del lado del
 * navegador: la sesión la persiste el propio cliente de Supabase.
 */
export async function iniciarSesion(identificador: string, clave: string): Promise<ResultadoLogin> {
  if (!supabase) {
    return { ok: false, error: "Supabase no está configurado (faltan las variables de entorno)." };
  }
  const correo = resolverCorreo(identificador);
  if (!correo) return { ok: false, error: "Escribí tu usuario." };
  if (!clave) return { ok: false, error: "Escribí tu contraseña." };

  try {
    const { data, error } = await conTimeout(
      supabase.auth.signInWithPassword({ email: correo, password: clave }),
      TIMEOUT_SESION_MS,
      "El inicio de sesión"
    );
    if (error || !data.user) {
      return { ok: false, error: mensajeDeError(error?.code ?? "", error?.message ?? "") };
    }
    return { ok: true, correo: data.user.email ?? correo };
  } catch (e) {
    return { ok: false, error: mensajeDeError("", (e as Error).message) };
  }
}

/**
 * Sesión vigente, o null si no hay ninguna.
 *
 * NUNCA se cuelga: si la red no contesta devuelve null y la app abre el login
 * en vez de quedarse girando. Devolver null es el fallo seguro correcto: sin
 * sesión verificada no se concede ni una capacidad.
 */
export async function sesionActual(): Promise<{ correo: string; id: string } | null> {
  if (!supabase) return null;
  try {
    const { data } = await conTimeout(supabase.auth.getSession(), TIMEOUT_SESION_MS, "La sesión");
    const u = data.session?.user;
    if (!u) return null;
    return { correo: u.email ?? "", id: u.id };
  } catch {
    return null;
  }
}

/** Cierra la sesión en Supabase y borra las cookies de permisos del middleware. */
export async function cerrarSesion(): Promise<void> {
  if (!supabase) return;
  try {
    await conTimeout(supabase.auth.signOut(), TIMEOUT_SESION_MS, "El cierre de sesión");
  } catch {
    /* la sesión local ya se limpió en el store; no se bloquea el logout */
  }
}

// ============================================================================
// Recuperación de contraseña
// ============================================================================

/** Mensaje único para cualquier resultado. Ver la nota de `pedirRecuperacion`. */
export const AVISO_RECOVERY =
  "Si ese usuario existe, te llega un correo con el enlace para poner una contraseña nueva.";

export type ResultadoRecuperacion = { ok: true; aviso: string } | { ok: false; error: string };

/**
 * Pide el correo de recuperación.
 *
 * El mensaje que devuelve NO depende de si el usuario existe: siempre es el
 * mismo aviso. Distinguir "te mandamos el correo" de "ese usuario no existe"
 * convierte este formulario en una herramienta para enumerar quién tiene
 * cuenta en el sistema, que es medio camino para un ataque de fuerza bruta con
 * nombres plausibles. Supabase tampoco filtra la respuesta; el neutral es
 * nuestro.
 *
 * El token no viaja en nuestra URL ni se guarda: lo manda Supabase al correo y
 * vuelve como sesión de recuperación de un solo uso y con vencimiento.
 */
export async function pedirRecuperacion(identificador: string): Promise<ResultadoRecuperacion> {
  if (!supabase) return { ok: false, error: "Supabase no está configurado (faltan las variables de entorno)." };
  const correo = resolverCorreo(identificador);
  if (!correo) return { ok: false, error: "Escribí tu usuario para continuar." };
  try {
    // `redirectTo` se arma con el origen real porque el build es estático
    // (`output: "export"`): no hay servidor que nos diga cuál es, y una URL
    // fija en el código fallaría en cuanto el sitio se sirviera en otro host.
    // Ese origen tiene que estar en las "Redirect URLs" de Supabase; si no
    // está, Supabase cae al `SITE_URL` y el enlace vuelve a la raíz.
    const origen = typeof window !== "undefined" ? window.location.origin : "";
    const { error } = await conTimeout(
      supabase.auth.resetPasswordForEmail(correo, { redirectTo: `${origen}/reset-password` }),
      TIMEOUT_SESION_MS,
      "El pedido de recuperación"
    );
    if (error) {
      // Un rate limit también se reporta de forma neutral: no le confirma a
      // nadie que la cuenta exista.
      if (/rate|too many|429/i.test(error.message)) return { ok: true, aviso: AVISO_RECOVERY };
      return { ok: false, error: "No se pudo pedir la recuperación. Probá de nuevo en un momento." };
    }
    return { ok: true, aviso: AVISO_RECOVERY };
  } catch (e) {
    if (e instanceof Error && e.message.includes("tardó demasiado")) {
      return { ok: false, error: "El servidor no respondió. Revisá la conexión y probá otra vez." };
    }
    return { ok: false, error: "No se pudo pedir la recuperación. Probá de nuevo en un momento." };
  }
}

export type ResultadoCambioClave = { ok: true } | { ok: false; error: string };

/**
 * Guarda la contraseña nueva.
 *
 * Solo funciona si la página llegó desde el enlace del correo: ese enlace
 * deja una sesión de recuperación temporal, y es lo único que autoriza este
 * cambio. Sin ella, `updateUser` responde que no hay usuario y acá se traduce
 * al mismo mensaje que se ve al abrir la página a mano.
 */
export async function cambiarClave(nueva: string): Promise<ResultadoCambioClave> {
  if (!supabase) return { ok: false, error: "Supabase no está configurado (faltan las variables de entorno)." };
  if (!nueva || nueva.length < 8) {
    return { ok: false, error: "La contraseña nueva tiene que tener al menos 8 caracteres." };
  }
  try {
    const { error } = await conTimeout(
      supabase.auth.updateUser({ password: nueva }),
      TIMEOUT_SESION_MS,
      "El cambio de contraseña"
    );
    if (error) return { ok: false, error: "No se pudo guardar la contraseña nueva. Pedí un enlace nuevo." };
    return { ok: true };
  } catch {
    return { ok: false, error: "El servidor no respondió. Revisá la conexión y probá otra vez." };
  }
}

export default iniciarSesion;
