import crypto from "crypto";
import { supabaseAdmin } from "@/core/supabase-admin";
import { esUsuarioPrincipal } from "@/features/seguridad/lib/resolver";

export interface IdentidadSala {
  tipo: "STAFF" | "JUGADOR";
  usuarioId: string;
  nombre: string;
  grupoId: string | null;
  esAdmin: boolean;
  esOperador: boolean;
  permisos: string[];
  clienteRow?: {
    id: string;
    nombre: string;
    seudonimo?: string;
    telefono?: string;
    saldo_actual: number;
    saldo_retenido: number;
    saldo_disponible: number;
    libre: boolean;
    modo_juego?: string;
    grupo_id: string;
    activo: boolean;
  };
}

const SERVICE_SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

/**
 * Genera un token firmado HMAC-SHA256 para sesiones staff/operador
 */
export function generarTokenStaff(payload: {
  usuarioId: string;
  nombre: string;
  grupoId?: string | null;
  esAdmin?: boolean;
  esOperador?: boolean;
}): string {
  const data = JSON.stringify({
    ...payload,
    iat: Date.now(),
    exp: Date.now() + 1000 * 60 * 60 * 24 * 7, // 7 días
  });
  const dataB64 = Buffer.from(data).toString("base64url");
  const firma = crypto.createHmac("sha256", SERVICE_SECRET).update(dataB64).digest("hex");
  return `sala_staff_${dataB64}.${firma}`;
}

function compararSeguro(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Valida un token HMAC-SHA256 generado por el servidor
 */
export function verificarTokenStaff(token: string): {
  valido: boolean;
  payload?: {
    usuarioId: string;
    nombre: string;
    grupoId?: string | null;
    esAdmin?: boolean;
    esOperador?: boolean;
    exp: number;
  };
} {
  if (!token || typeof token !== "string" || !token.startsWith("sala_staff_")) return { valido: false };
  const sinPrefijo = token.slice("sala_staff_".length);
  const [dataB64, firma] = sinPrefijo.split(".");
  if (!dataB64 || !firma) return { valido: false };

  const firmaEsperada = crypto.createHmac("sha256", SERVICE_SECRET).update(dataB64).digest("hex");
  if (!compararSeguro(firma, firmaEsperada)) return { valido: false };

  try {
    const raw = Buffer.from(dataB64, "base64url").toString("utf8");
    const payload = JSON.parse(raw);
    if (!payload || !payload.usuarioId) return { valido: false };
    if (!Number.isFinite(payload.exp) || Date.now() > payload.exp) return { valido: false };
    return { valido: true, payload };
  } catch {
    return { valido: false };
  }
}

/**
 * Valida credenciales de operador contra `usuario_sistema` mediante la RPC
 * oficial `club_login_operador` (incluye bloqueo por intentos fallidos) y emite
 * un token HMAC de sala. El token es lo único que la API acepta después: no se
 * confía en cookies ni en cabeceras de identidad del navegador.
 */
export async function iniciarSesionOperadorSala(
  identificador: string,
  clave: string,
  ip: string
): Promise<
  | { ok: true; token: string; usuario: { id: string; nombre: string; grupoId: string | null; grupoNombre: string; esAdmin: boolean } }
  | { ok: false; status: number; error: string }
> {
  const id = String(identificador ?? "").trim();
  if (!id || !clave) {
    return { ok: false, status: 400, error: "Usuario y contraseña son obligatorios." };
  }

  const { data, error } = await supabaseAdmin.rpc("club_login_operador", {
    p_identificador: id,
    p_clave: clave,
    p_ip: ip || "127.0.0.1",
  });
  if (error) {
    return { ok: false, status: 500, error: "No se pudo validar el operador." };
  }

  const r = (data ?? {}) as Record<string, unknown>;
  if (r.bloqueado === true) {
    return {
      ok: false,
      status: 429,
      error: String(r.error || "Acceso bloqueado temporalmente por intentos fallidos."),
    };
  }
  if (r.ok !== true || !r.id) {
    return {
      ok: false,
      status: 401,
      error: String(r.error || "Usuario o contraseña incorrectos."),
    };
  }

  const usuarioId = String(r.id);
  const { data: alta } = await supabaseAdmin
    .from("usuario_sistema")
    .select("id, nombre, grupo_id, activo, es_principal, tipo_usuario_id")
    .eq("id", usuarioId)
    .maybeSingle();

  if (alta && (alta as any).activo === false) {
    return { ok: false, status: 403, error: "El usuario está dado de baja." };
  }

  const esPrincipal = esUsuarioPrincipal(usuarioId) || Boolean((alta as any)?.es_principal);
  let tipoNombre = "";
  if ((alta as any)?.tipo_usuario_id != null) {
    const { data: tipo } = await supabaseAdmin
      .from("tipo_usuario")
      .select("nombre")
      .eq("id", (alta as any).tipo_usuario_id)
      .maybeSingle();
    tipoNombre = String((tipo as any)?.nombre || "");
  }
  const esAdmin = esPrincipal || /admin|dueño|dueno|banquero/i.test(tipoNombre);

  const nombre = String(r.nombre || (alta as any)?.nombre || usuarioId);
  const grupoId = String(r.grupoId || (alta as any)?.grupo_id || "").trim() || null;
  const grupoNombre = String(r.grupoNombre || "");

  const token = generarTokenStaff({
    usuarioId,
    nombre,
    grupoId,
    esAdmin,
    esOperador: true,
  });

  return {
    ok: true,
    token,
    usuario: { id: usuarioId, nombre, grupoId, grupoNombre, esAdmin },
  };
}

/**
 * Autentica la petición a la Sala de Juegos sin confiar en datos enviados en el body.
 *
 * Solo hay dos credenciales aceptadas:
 *  1. Jugador: `X-Sala-Cliente-Id` + `X-Sala-Portal-Token`, validados contra `clientes`.
 *  2. Staff: `Authorization: Bearer <JWT_Supabase | Token_HMAC_Staff>`.
 *
 * Las cookies `hipico_usuario` / `hipico_perfil` / `hipico_permisos` y las
 * cabeceras `X-Sala-Usuario` las escribe el navegador: NO son credenciales y no
 * se usan para autorizar.
 */
export async function autenticarPeticionSala(
  req: Request
): Promise<{ ok: boolean; identidad?: IdentidadSala; error?: string; status?: number }> {
  // 1. Chequeo de credenciales de Jugador vía Portal Token
  const clienteId = req.headers.get("x-sala-cliente-id");
  const portalToken = req.headers.get("x-sala-portal-token");
  const tieneAuthStaff = Boolean(
    req.headers.get("authorization") || req.headers.get("Authorization")
  );

  if (clienteId && portalToken) {
    try {
      const { data: clienteRaw, error } = await supabaseAdmin
        .from("clientes")
        .select("*")
        .eq("id", clienteId)
        .maybeSingle();

      if (!error && clienteRaw) {
        const cl = clienteRaw as Record<string, unknown>;
        const activoOk =
          cl.activo !== false &&
          cl.portal_habilitado !== false &&
          !["inactivo", "bloqueado", "suspendido"].includes(String(cl.estado ?? "activo").trim().toLowerCase());
        const idClean = String(cl.id ?? "").replace(/[^a-zA-Z0-9]/g, "");
        const tokenBd = String(cl.portal_token ?? "").trim().toUpperCase();
        const tokenDefecto = idClean ? `TK${idClean}`.toUpperCase() : "";
        const tokenReq = portalToken.trim().slice(0, 128).toUpperCase();
        const tokenCoincide = Boolean(
          tokenReq &&
            ((tokenBd && compararSeguro(tokenReq, tokenBd)) ||
              (!tokenBd && tokenDefecto && compararSeguro(tokenReq, tokenDefecto)))
        );

        if (activoOk && tokenCoincide) {
          const saldoActual = Number(cl.saldo_actual ?? 0) || 0;
          const saldoRetenido = Number(cl.saldo_retenido ?? 0) || 0;
          const aval = Number(cl.aval ?? 0) || 0;
          const saldoDisp =
            cl.saldo_disponible != null
              ? Number(cl.saldo_disponible) || 0
              : cl.disponible != null
                ? Number(cl.disponible) || 0
                : Math.max(0, saldoActual + aval - saldoRetenido);
          const modoJuego = String(cl.modo_juego ?? "aval");
          const libre = Boolean(cl.libre || modoJuego.toLowerCase() === "libre");
          const grupoId = String(cl.grupo_id ?? cl.grupo_cobro_id ?? "");

          return {
            ok: true,
            identidad: {
              tipo: "JUGADOR",
              usuarioId: String(cl.id),
              nombre: String(cl.seudonimo || cl.nombre || "Jugador"),
              grupoId,
              esAdmin: false,
              esOperador: false,
              permisos: ["jugar"],
              clienteRow: {
                id: String(cl.id),
                nombre: String(cl.nombre ?? "Jugador"),
                seudonimo: cl.seudonimo ? String(cl.seudonimo) : undefined,
                telefono: cl.telefono ? String(cl.telefono) : undefined,
                saldo_actual: saldoActual,
                saldo_retenido: saldoRetenido,
                saldo_disponible: saldoDisp,
                libre,
                modo_juego: modoJuego,
                grupo_id: grupoId,
                activo: true,
              },
            },
          };
        }
      }

      if (!tieneAuthStaff) {
        return { ok: false, error: "Credenciales de portal inválidas o cliente inactivo", status: 401 };
      }
    } catch (err: any) {
      if (!tieneAuthStaff) {
        return { ok: false, error: "Error validando credenciales de portal: " + (err?.message || err), status: 500 };
      }
    }
  }

  // 2. Chequeo de Staff vía Authorization Header
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim();

    // 2.a Token HMAC Staff firmado por el servidor
    if (token.startsWith("sala_staff_")) {
      const verificado = verificarTokenStaff(token);
      if (verificado.valido && verificado.payload) {
        const p = verificado.payload;
        return {
          ok: true,
          identidad: {
            tipo: "STAFF",
            usuarioId: p.usuarioId,
            nombre: p.nombre,
            grupoId: p.grupoId || null,
            esAdmin: Boolean(p.esAdmin),
            esOperador: Boolean(p.esOperador || p.esAdmin),
            permisos: p.esAdmin ? ["*"] : ["operar_sala", "liquidar_sala", "retirar_ejemplar"],
          },
        };
      }
    }

    // 2.b JWT de Supabase Auth
    try {
      const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
      if (!error && user) {
        const metadata = user.user_metadata || {};
        const perfil = String(metadata.perfil || "");
        const username = String(metadata.username || user.email?.split("@")[0] || "");
        const esAdmin =
          /admin/i.test(perfil) ||
          /josorioc/i.test(username) ||
          user.email === "josorioc@sistemahipico.local" ||
          esUsuarioPrincipal(username);

        let grupoId: string | null = null;
        if (!esAdmin) {
          // Si es banquero/operador, buscar grupo por slug o asignación
          const { data: grupo } = await supabaseAdmin
            .from("grupos_venta")
            .select("id")
            .ilike("slug", username)
            .maybeSingle();
          if (grupo) grupoId = grupo.id;
        }

        return {
          ok: true,
          identidad: {
            tipo: "STAFF",
            usuarioId: user.id,
            nombre: username || "Operador",
            grupoId,
            esAdmin,
            esOperador: true,
            permisos: esAdmin ? ["*"] : ["operar_sala", "liquidar_sala", "retirar_ejemplar"],
          },
        };
      }
    } catch {
      // Intento con supabase auth falló, continuar a verificación por sesión de app
    }
  }

  return {
    ok: false,
    error: "No autorizado. Se requiere token de portal (X-Sala-Portal-Token) o sesión de staff válida.",
    status: 401,
  };
}

/**
 * Valida si la identidad tiene permisos para operar la sala del grupo
 */
export function puedeOperarSala(identidad: IdentidadSala, grupoId: string): boolean {
  if (identidad.tipo !== "STAFF") return false;
  if (identidad.esAdmin) return true;
  if (!identidad.esOperador) return false;
  // Sin grupo asignado no se puede operar: permitirlo abriría las salas de
  // todos los grupos a cualquier operador mal configurado.
  return Boolean(identidad.grupoId) && identidad.grupoId === grupoId;
}

/**
 * Valida si la identidad puede liquidar carreras en el grupo
 */
export function puedeLiquidarSala(identidad: IdentidadSala, grupoId: string): boolean {
  return puedeOperarSala(identidad, grupoId);
}

/**
 * Valida si la identidad puede procesar retirados en el grupo
 */
export function puedeRetirarEjemplar(identidad: IdentidadSala, grupoId: string): boolean {
  return puedeOperarSala(identidad, grupoId);
}

/**
 * Valida si el grupo solicitado está permitido para esta identidad
 */
export function grupoPermitido(identidad: IdentidadSala, grupoId: string): boolean {
  if (identidad.esAdmin) return true;
  return Boolean(identidad.grupoId) && identidad.grupoId === grupoId;
}

/**
 * Resuelve el grupo efectivo aislando usuarios (jugadores u operadores) estrictamente a su grupo asignado
 */
export function resolverGrupoEfectivo(
  identidad: IdentidadSala,
  grupoIdSolicitado?: string | null
): string | null {
  if (identidad.tipo === "JUGADOR" || (!identidad.esAdmin && Boolean(identidad.grupoId))) {
    return identidad.grupoId;
  }
  return grupoIdSolicitado || identidad.grupoId || null;
}
