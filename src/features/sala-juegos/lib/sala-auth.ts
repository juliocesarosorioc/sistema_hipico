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
    if (payload.exp && Date.now() > payload.exp) return { valido: false };
    return { valido: true, payload };
  } catch {
    return { valido: false };
  }
}

/**
 * Extrae y decodifica pares clave-valor de cookies
 */
function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {};
  const res: Record<string, string> = {};
  for (const part of header.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k && v) {
      try {
        res[decodeURIComponent(k)] = decodeURIComponent(v);
      } catch {
        res[k] = v;
      }
    }
  }
  return res;
}

/**
 * Autentica la petición a la Sala de Juegos sin confiar en datos enviados en el body
 * 1. Jugador: Headers X-Sala-Cliente-Id y X-Sala-Portal-Token validados contra clientes
 * 2. Staff: Header Authorization: Bearer <JWT_Supabase | Token_HMAC_Staff>
 * 3. Staff / Admin de Aplicación: Cookies de sesión o cabeceras X-Sala-Usuario / X-Sala-Perfil
 */
export async function autenticarPeticionSala(
  req: Request
): Promise<{ ok: boolean; identidad?: IdentidadSala; error?: string; status?: number }> {
  // 1. Chequeo de credenciales de Jugador vía Portal Token
  const clienteId = req.headers.get("x-sala-cliente-id");
  const portalToken = req.headers.get("x-sala-portal-token");
  const tieneAuthStaff = Boolean(
    req.headers.get("authorization") ||
      req.headers.get("Authorization") ||
      req.headers.get("x-sala-usuario") ||
      req.headers.get("x-usuario")
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

  // 3. Chequeo de Staff vía Cookies de sesión o cabeceras de aplicación (X-Sala-Usuario, etc.)
  const cookies = parseCookies(req.headers.get("cookie"));
  const headerUsuario = req.headers.get("x-sala-usuario") || req.headers.get("x-usuario");
  const headerPerfil = req.headers.get("x-sala-perfil") || req.headers.get("x-perfil");
  const headerPermisos = req.headers.get("x-sala-permisos");
  const headerGrupo = req.headers.get("x-sala-grupo");

  let usuario = (headerUsuario || cookies["hipico_usuario"] || "").trim();
  if (usuario.startsWith("{")) {
    try {
      const parsed = JSON.parse(usuario);
      usuario = (parsed.nombre || parsed.usuario || parsed.id || "").trim();
    } catch {}
  }
  const perfil = (headerPerfil || cookies["hipico_perfil"] || "").trim().toLowerCase();
  const permisosRaw = headerPermisos || cookies["hipico_permisos"] || "";
  const grupoCookie = headerGrupo || cookies["hipico_grupo_activo"] || null;

  if (usuario || cookies["hipico_usuario"] === "josorioc") {
    const usuarioEfectivo = (usuario || "josorioc").replace(/[\u0000-\u001F<>"]/g, "").trim().slice(0, 64);
    if (!usuarioEfectivo) {
      return {
        ok: false,
        error: "Identificador de usuario inválido.",
        status: 401,
      };
    }

    let esAdmin = esUsuarioPrincipal(usuarioEfectivo);
    let esOperador =
      esAdmin ||
      usuarioEfectivo.toLowerCase() === "operador" ||
      perfil === "operador" ||
      cookies["hipico_perfil"] === "operador" ||
      permisosRaw.includes("operar_sala") ||
      Boolean(cookies["hipico_modo_operador"]);

    let grupoId: string | null =
      grupoCookie && grupoCookie !== "null" && grupoCookie !== "undefined" ? grupoCookie : null;

    if (!esAdmin) {
      try {
        const { data: uRow } = await supabaseAdmin
          .from("usuario_sistema")
          .select("id, tipo_id, activo, grupo_id")
          .ilike("id", usuarioEfectivo)
          .maybeSingle();

        if (uRow) {
          if (uRow.activo === false) {
            return { ok: false, error: "Cuenta de operador inactiva.", status: 403 };
          }
          if (Number(uRow.tipo_id) === 1 && (perfil === "admin" || cookies["hipico_perfil"] === "admin")) {
            esAdmin = true;
          }
          esOperador = true;
          if (!grupoId && uRow.grupo_id) {
            grupoId = String(uRow.grupo_id);
          }
        }
      } catch {
        // Continúa con validación de grupo si la tabla no existe en el entorno
      }
    }

    if (esAdmin || esOperador) {
      if (!esAdmin && !grupoId) {
        try {
          const { data: grupo } = await supabaseAdmin
            .from("grupos_venta")
            .select("id")
            .ilike("slug", usuarioEfectivo)
            .maybeSingle();
          if (grupo) grupoId = grupo.id;
        } catch {
          // Fallback silencioso
        }
      }

      return {
        ok: true,
        identidad: {
          tipo: "STAFF",
          usuarioId: usuarioEfectivo,
          nombre: esUsuarioPrincipal(usuarioEfectivo) ? "Julio Osorio" : usuarioEfectivo,
          grupoId,
          esAdmin,
          esOperador: true,
          permisos: esAdmin ? ["*"] : ["operar_sala", "liquidar_sala", "retirar_ejemplar"],
        },
      };
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
  return !identidad.grupoId || identidad.grupoId === grupoId;
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
  if (identidad.tipo === "JUGADOR") {
    return identidad.grupoId === grupoId;
  }
  if (identidad.esAdmin) return true;
  return !identidad.grupoId || identidad.grupoId === grupoId;
}

/**
 * Resuelve el grupo efectivo aislando jugadores a su propio grupo
 */
export function resolverGrupoEfectivo(
  identidad: IdentidadSala,
  grupoIdSolicitado?: string | null
): string | null {
  if (identidad.tipo === "JUGADOR") {
    return identidad.grupoId;
  }
  return grupoIdSolicitado || identidad.grupoId || null;
}
