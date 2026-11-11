import crypto from "crypto";
import { supabaseAdmin } from "@/core/supabase-admin";

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
  if (!token.startsWith("sala_staff_")) return { valido: false };
  const sinPrefijo = token.slice("sala_staff_".length);
  const [dataB64, firma] = sinPrefijo.split(".");
  if (!dataB64 || !firma) return { valido: false };

  const firmaEsperada = crypto.createHmac("sha256", SERVICE_SECRET).update(dataB64).digest("hex");
  if (firma !== firmaEsperada) return { valido: false };

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
 * Autentica la petición a la Sala de Juegos sin confiar en datos enviados en el body
 * Jugador: Headers X-Sala-Cliente-Id y X-Sala-Portal-Token validados contra clientes
 * Staff: Header Authorization: Bearer <JWT_Supabase | Token_HMAC_Staff>
 */
export async function autenticarPeticionSala(
  req: Request
): Promise<{ ok: boolean; identidad?: IdentidadSala; error?: string; status?: number }> {
  // 1. Chequeo de credenciales de Jugador vía Portal Token
  const clienteId = req.headers.get("x-sala-cliente-id");
  const portalToken = req.headers.get("x-sala-portal-token");

  if (clienteId && portalToken) {
    try {
      const { data: cliente, error } = await supabaseAdmin
        .from("clientes")
        .select("id, nombre, seudonimo, telefono, saldo_actual, saldo_retenido, saldo_disponible, libre, modo_juego, grupo_id, activo")
        .eq("id", clienteId)
        .eq("portal_token", portalToken)
        .eq("activo", true)
        .maybeSingle();

      if (error || !cliente) {
        return { ok: false, error: "Credenciales de portal inválidas o cliente inactivo", status: 401 };
      }

      return {
        ok: true,
        identidad: {
          tipo: "JUGADOR",
          usuarioId: cliente.id,
          nombre: cliente.seudonimo || cliente.nombre || "Jugador",
          grupoId: cliente.grupo_id,
          esAdmin: false,
          esOperador: false,
          permisos: ["jugar"],
          clienteRow: cliente,
        },
      };
    } catch (err: any) {
      return { ok: false, error: "Error validando credenciales de portal: " + (err?.message || err), status: 500 };
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
          user.email === "josorioc@sistemahipico.local";

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
      // Intento con supabase auth falló
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
