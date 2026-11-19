import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/core/supabase-admin";

export const dynamic = "force-dynamic";

function normalizarTexto(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function normalizarDigitos(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}

function credencialesPorDefecto(c: any) {
  const idClean = String(c.id ?? "0").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 6) || "0001";
  return {
    portal_habilitado: c.portal_habilitado !== false,
    portal_token: String(c.portal_token ?? "").trim() || `TK${idClean}`,
    portal_clave: String(c.portal_clave ?? "").trim() || `CL${idClean}`,
  };
}

/** Rate limiter en memoria: 5 fallos por IP + identificador en 15 minutos. */
const LIMITE_INTENTOS = 5;
const VENTANA_MS = 15 * 60 * 1000;
const intentosFallidos = new Map<string, { cantidad: number; expira: number }>();

function ipDeLaPeticion(req: NextRequest): string {
  const reenviado = req.headers.get("x-forwarded-for");
  if (reenviado) return reenviado.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "ip-desconocida";
}

function claveDeIntento(req: NextRequest, usuario: string, grupoId: string): string {
  return `${ipDeLaPeticion(req)}|${grupoId || "sin-grupo"}|${normalizarTexto(usuario)}`;
}

function estaBloqueado(clave: string): boolean {
  const registro = intentosFallidos.get(clave);
  if (!registro) return false;
  if (Date.now() >= registro.expira) {
    intentosFallidos.delete(clave);
    return false;
  }
  return registro.cantidad >= LIMITE_INTENTOS;
}

function registrarFallo(clave: string): void {
  const ahora = Date.now();
  const registro = intentosFallidos.get(clave);
  if (!registro || ahora >= registro.expira) {
    intentosFallidos.set(clave, { cantidad: 1, expira: ahora + VENTANA_MS });
    return;
  }
  registro.cantidad += 1;
}

function limpiarIntentos(clave: string): void {
  intentosFallidos.delete(clave);
}

function respuestaFallida(clave: string, mensaje: string, status: number) {
  if (status === 401 || status === 400) registrarFallo(clave);
  return NextResponse.json({ ok: false, error: mensaje }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const usuarioRaw = typeof body?.usuario === "string" ? body.usuario.trim() : "";
    const claveRaw = typeof body?.clave === "string" ? body.clave.trim() : "";
    const grupoId = typeof body?.grupoId === "string" ? body.grupoId.trim() : "";
    const claveIntento = claveDeIntento(req, usuarioRaw, grupoId);

    if (estaBloqueado(claveIntento)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Demasiados intentos fallidos. Espera 15 minutos antes de volver a intentar.",
        },
        { status: 429 }
      );
    }

    if (!usuarioRaw || !claveRaw) {
      return respuestaFallida(claveIntento, "Ingresa tu usuario y contraseña.", 400);
    }

    // Traer candidatos activos del grupo o sistema
    let query = supabaseAdmin
      .from("clientes")
      .select("*")
      .or("activo.is.null,activo.neq.false")
      .or("portal_habilitado.is.null,portal_habilitado.neq.false");

    if (grupoId) {
      query = query.eq("grupo_id", grupoId);
    }

    const { data: rows, error: errQuery } = await query.limit(5000);
    if (errQuery || !Array.isArray(rows)) {
      console.error("[PORTAL_LOGIN_ERR] Error consultando clientes:", errQuery);
      return respuestaFallida(claveIntento, "Usuario o contraseña incorrectos.", 401);
    }

    const uNorm = normalizarTexto(usuarioRaw);
    const uDigitos = normalizarDigitos(usuarioRaw);
    const uDigitos10 = uDigitos.length >= 10 ? uDigitos.slice(-10) : (uDigitos.length >= 7 ? uDigitos : "");

    // 1. Filtrar candidatos donde coincida el identificador (case-insensitive) con:
    // portal_token, seudonimo, nombre, email, o últimos 10 dígitos de telefono / telefono_normalizado
    const candidatos = rows.filter((c: any) => {
      // Activos check estricto en memoria
      if (c.activo === false || c.portal_habilitado === false) return false;

      const pToken = normalizarTexto(c.portal_token);
      if (pToken && (pToken === uNorm || pToken.replace(/^tk/, "") === uNorm.replace(/^tk/, ""))) return true;

      const creds = credencialesPorDefecto(c);
      const defToken = normalizarTexto(creds.portal_token);
      if (defToken && (defToken === uNorm || defToken.replace(/^tk/, "") === uNorm.replace(/^tk/, ""))) return true;

      const seudonimo = normalizarTexto(c.seudonimo);
      if (seudonimo && seudonimo === uNorm) return true;

      const nombre = normalizarTexto(c.nombre);
      if (nombre && nombre === uNorm) return true;

      const nombreCompleto = normalizarTexto(`${c.nombre ?? ""} ${c.apellido ?? ""}`);
      if (nombreCompleto && nombreCompleto === uNorm) return true;

      const email = normalizarTexto(c.email);
      if (email && email === uNorm) return true;

      if (uDigitos10) {
        const tel = normalizarDigitos(c.telefono);
        const telNorm = normalizarDigitos(c.telefono_normalizado);
        const tel10 = tel.length >= 10 ? tel.slice(-10) : tel;
        const telNorm10 = telNorm.length >= 10 ? telNorm.slice(-10) : telNorm;
        if (tel.length >= 7 && (tel10 === uDigitos10 || tel.endsWith(uDigitos10) || uDigitos10.endsWith(tel))) return true;
        if (telNorm.length >= 7 && (telNorm10 === uDigitos10 || telNorm.endsWith(uDigitos10) || uDigitos10.endsWith(telNorm))) return true;
      }

      // Si ingresó ID exacto
      const cId = String(c.id ?? "").toLowerCase();
      if (cId === uNorm) return true;

      return false;
    });

    if (candidatos.length === 0) {
      return respuestaFallida(claveIntento, "Usuario o contraseña incorrectos.", 401);
    }

    // 2. Validación de clave contra los candidatos:
    // coincide con portal_clave (case-insensitive) O con pin_acceso (exacto tras .trim())
    const claveTrim = claveRaw.trim();
    const claveLower = claveTrim.toLowerCase();

    let clienteValido: any = null;

    for (const c of candidatos) {
      const creds = credencialesPorDefecto(c);
      const cPortalClave = (c.portal_clave ? String(c.portal_clave).trim() : creds.portal_clave).toLowerCase();
      const cPinAcceso = c.pin_acceso ? String(c.pin_acceso).trim() : "";

      // Coincidencia con portal_clave (case-insensitive)
      if (cPortalClave && (cPortalClave === claveLower || cPortalClave.replace(/^cl/, "") === claveLower.replace(/^cl/, ""))) {
        clienteValido = { ...c, portal_clave: c.portal_clave || creds.portal_clave, portal_token: c.portal_token || creds.portal_token };
        break;
      }

      // Coincidencia con pin_acceso (exacto tras .trim())
      if (cPinAcceso && cPinAcceso === claveTrim) {
        clienteValido = { ...c, portal_clave: c.portal_clave || creds.portal_clave, portal_token: c.portal_token || creds.portal_token };
        break;
      }
    }

    if (!clienteValido) {
      return respuestaFallida(claveIntento, "Usuario o contraseña incorrectos.", 401);
    }

    // Sincronizar credenciales por defecto si faltaban en la BD
    try {
      const orig = rows.find((r: any) => String(r.id) === String(clienteValido.id));
      if (orig && (!orig.portal_token || !orig.portal_clave || orig.portal_habilitado !== true)) {
        const patch: Record<string, unknown> = {};
        if ("portal_habilitado" in orig || orig.portal_habilitado == null) patch.portal_habilitado = true;
        if (!orig.portal_token) patch.portal_token = clienteValido.portal_token;
        if (!orig.portal_clave) patch.portal_clave = clienteValido.portal_clave;
        if (Object.keys(patch).length > 0) {
          await supabaseAdmin.from("clientes").update(patch).eq("id", clienteValido.id);
        }
      }
    } catch (errSync) {
      console.warn("[PORTAL_LOGIN_ERR] Sync credenciales warning:", errSync);
    }

    limpiarIntentos(claveIntento);
    const respuesta = NextResponse.json({ ok: true, cliente: clienteValido });

    // Emite la cookie/sesión del portal con path: "/" y sameSite: "lax"
    // para que funcione tanto en HTTP como HTTPS sin perderse en redirecciones.
    // También se establecen las cookies compatibles con el middleware para que no rebote a /login.
    const maxAge = 60 * 60 * 24 * 7; // 7 días
    const cookieOpts = {
      path: "/",
      sameSite: "lax" as const,
      maxAge,
      httpOnly: false,
    };

    respuesta.cookies.set("portal_cliente_id", String(clienteValido.id), cookieOpts);
    respuesta.cookies.set("portal_token", String(clienteValido.portal_token), cookieOpts);
    respuesta.cookies.set("sala_cliente_id", String(clienteValido.id), cookieOpts);
    respuesta.cookies.set("sala_portal_token", String(clienteValido.portal_token), cookieOpts);

    // Permisos y perfil compatibles con el middleware (esRolCliente)
    const nombreUsuario = String(clienteValido.seudonimo || clienteValido.nombre || clienteValido.id);
    respuesta.cookies.set("hipico_usuario", encodeURIComponent(nombreUsuario), cookieOpts);
    respuesta.cookies.set("hipico_perfil", encodeURIComponent("cliente"), cookieOpts);
    respuesta.cookies.set("hipico_permisos", encodeURIComponent("portal:ruta_portal,portal:btn_jugar,portal:celda_saldo_portal"), cookieOpts);
    respuesta.cookies.set("hipico_acceso", "ok", cookieOpts);

    return respuesta;
  } catch (err: any) {
    console.error("[PORTAL_LOGIN_ERR]", err);
    return NextResponse.json(
      { ok: false, error: "Error interno al procesar el ingreso al portal." },
      { status: 500 }
    );
  }
}
