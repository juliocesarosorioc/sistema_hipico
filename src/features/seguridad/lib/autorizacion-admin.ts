/**
 * Verificación y autorización por contraseña de administrador.
 *
 * Se utiliza para autorizar ventas de Tablas Fijas o Marcas que superen los
 * límites de monto o cantidad establecidos para un grupo.
 *
 * Utiliza un cliente efímero de Supabase (persistSession: false) para no alterar
 * la sesión activa del operador que está en la taquilla.
 */
import { createClient } from "@supabase/supabase-js";
import { resolverCorreo } from "@/features/auth/lib/sesion";
import { esUsuarioPrincipal } from "@/features/seguridad/lib/resolver";
import { leerTipoDeUsuario } from "@/features/seguridad/lib/accesos";
import { registrarAuditoria } from "@/features/grupos/lib/grupos";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export async function verificarPasswordAdmin(
  identificador: string,
  contrasena: string
): Promise<{ ok: boolean; error?: string; usuarioAdmin?: string }> {
  const idLimpio = String(identificador ?? "").trim();
  const pass = String(contrasena ?? "");

  if (!idLimpio) return { ok: false, error: "Indique el usuario o correo del administrador." };
  if (!pass) return { ok: false, error: "Ingrese la contraseña del administrador." };
  if (!URL || !KEY) return { ok: false, error: "Sin conexión configurada a Supabase (.env.local)." };

  try {
    // 1. Cliente efímero sin almacenamiento de sesión para validar credenciales
    const authClient = createClient(URL, KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    const correo = resolverCorreo(idLimpio);
    const { data, error } = await authClient.auth.signInWithPassword({
      email: correo,
      password: pass,
    });

    if (error || !data.user) {
      return { ok: false, error: "Usuario o contraseña de administrador incorrecta." };
    }

    // 2. Verificar que el usuario tenga rol de administrador
    const esAdmin = esUsuarioPrincipal(idLimpio) || esUsuarioPrincipal(data.user.email);
    if (esAdmin) {
      return { ok: true, usuarioAdmin: data.user.email ?? idLimpio };
    }

    // Si no es el principal por alias, verificar si tiene tipo admin en usuario_sistema
    const tipo = await leerTipoDeUsuario(idLimpio);
    const nombreTipo = String(tipo?.nombre ?? "").toLowerCase();
    if (nombreTipo === "admin" || nombreTipo.includes("administrador")) {
      return { ok: true, usuarioAdmin: idLimpio };
    }

    return {
      ok: false,
      error: "El usuario ingresado no tiene permisos de Administrador para autorizar ventas fuera de límite.",
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Error al validar contraseña del administrador.",
    };
  }
}

/**
 * Registra en auditoría la autorización de una jugada que superó los límites.
 */
export async function registrarAutorizacionVentaFueraLimite(opts: {
  modalidad: "TABLAS_FIJAS" | "MARCAS";
  usuarioAdmin: string;
  grupoNombre: string;
  jugadorNombre: string;
  monto: number;
  cantidad?: number;
  detalle: string;
}): Promise<void> {
  const msg = `[${opts.modalidad}] Venta fuera de límite autorizada por admin ${opts.usuarioAdmin}. Grupo: ${opts.grupoNombre}, Jugador: ${opts.jugadorNombre}, Monto: $${opts.monto}${opts.cantidad ? ` (Cant: ${opts.cantidad})` : ""}. Detalle: ${opts.detalle}`;
  void registrarAuditoria("AUTORIZACION_ADMIN", "VENTA_LIMITE_EXCEDIDO", msg);
}
