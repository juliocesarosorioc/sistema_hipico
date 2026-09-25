/**
 * Capa de datos RBAC. Fuente de verdad: tablas de Supabase
 * (src/db/rbac.sql). Si el esquema aún no existe en la BD, se usan los
 * accesos por defecto en memoria para que la SPA no se rompa.
 */
import { supabase } from "@/lib/supabase";
import type { Permiso, Perfil, ResGuardarAccesos, UsuarioSistema } from "@/lib/seguridad/tipos";

/** Catálogo canónico de permisos (mismas claves que src/db/rbac.sql). */
export const PERMISOS_CANONICOS: Permiso[] = [
  // general
  { id: 1, clave: "acceso_dashboard", modulo: "general", descripcion: "Acceso al Dashboard / inicio" },
  // taquilla
  { id: 10, clave: "ver_taquilla", modulo: "taquilla", descripcion: "Ver módulo de taquilla" },
  { id: 11, clave: "registrar_jugada", modulo: "taquilla", descripcion: "Registrar jugadas (boleto)" },
  { id: 12, clave: "anular_ticket", modulo: "taquilla", descripcion: "Anular ticket / boleto" },
  { id: 13, clave: "liquidar_carrera", modulo: "taquilla", descripcion: "Liquidar carrera (resultados)" },
  // tablas fijas
  { id: 20, clave: "ver_tablas_fijas", modulo: "tablas", descripcion: "Ver módulo de Tablas Fijas" },
  { id: 21, clave: "publicar_tabla", modulo: "tablas", descripcion: "Publicar tablas (ensamblaje)" },
  { id: 22, clave: "editar_tabla", modulo: "tablas", descripcion: "Editar premio, valores y cupos" },
  { id: 23, clave: "vender_tabla", modulo: "tablas", descripcion: "Vender tablas (carrito/taquilla)" },
  { id: 24, clave: "imprimir_tablas", modulo: "tablas", descripcion: "Imprimir tablas publicadas" },
  { id: 25, clave: "eliminar_tabla", modulo: "tablas", descripcion: "Eliminar tabla publicada (solo la oferta de venta)" },
  // gestión de jugadas
  { id: 30, clave: "gestionar_jugadas", modulo: "gestion", descripcion: "Ver y operar Gestión de Jugadas" },
  // ejemplares y gaceta
  { id: 40, clave: "ver_ejemplares", modulo: "ejemplares", descripcion: "Ver ejemplares y gaceta" },
  { id: 41, clave: "administrar_ejemplares", modulo: "ejemplares", descripcion: "Editar padrón de ejemplares" },
  // contabilidad
  { id: 50, clave: "ver_contabilidad", modulo: "contabilidad", descripcion: "Ver módulo de contabilidad" },
  { id: 51, clave: "registrar_ingresos", modulo: "contabilidad", descripcion: "Registrar ingresos / avales" },
  { id: 52, clave: "autorizar_pagos", modulo: "contabilidad", descripcion: "Autorizar pagos y cierres" },
  // clientes / portal
  { id: 45, clave: "gestionar_clientes", modulo: "clientes", descripcion: "Ver y operar Gestión de Clientes (cartera, portal y reclamos)" },
  // seguridad
  { id: 60, clave: "administrar_seguridad", modulo: "seguridad", descripcion: "Administrar perfiles y accesos" },
  { id: 61, clave: "ver_auditoria", modulo: "seguridad", descripcion: "Ver trazabilidad / auditoría" },
  // portal del cliente
  { id: 70, clave: "acceso_portal", modulo: "portal", descripcion: "Acceso al Portal del Cliente" },
];

export const MODULOS = [...new Set(PERMISOS_CANONICOS.map((p) => p.modulo))];

export const todasLasClaves = (): Set<string> => new Set(PERMISOS_CANONICOS.map((p) => p.clave));

const CLAVES_TAQUILLERO = [
  "acceso_dashboard",
  "ver_taquilla",
  "registrar_jugada",
  "liquidar_carrera",
  "ver_tablas_fijas",
  "vender_tabla",
  "imprimir_tablas",
  "gestionar_jugadas",
  "ver_ejemplares",
];

const CLAVES_AUDITOR = [
  "acceso_dashboard",
  "ver_taquilla",
  "ver_tablas_fijas",
  "imprimir_tablas",
  "gestionar_jugadas",
  "ver_ejemplares",
  "ver_contabilidad",
  "ver_auditoria",
];

export const PERFILES_DEFECTO: Perfil[] = [
  { id: 1, nombre: "Admin", descripcion: "Administrador Principal" },
  { id: 2, nombre: "Taquillero", descripcion: "Operador de taquilla" },
  { id: 3, nombre: "Auditor", descripcion: "Auditoría (solo lectura)" },
  { id: 4, nombre: "Cliente", descripcion: "Acceso solo al Portal del Cliente" },
];

/** Accesos por defecto según el nombre del perfil (si la BD no existe). */
export function accesosPorDefecto(nombrePerfil: string): Set<string> {
  const n = (nombrePerfil ?? "").toLowerCase();
  if (n.includes("cliente")) return new Set(["acceso_portal"]);
  if (n.includes("admin")) return todasLasClaves();
  if (n.includes("taqui")) return new Set(CLAVES_TAQUILLERO);
  if (n.includes("audit")) return new Set(CLAVES_AUDITOR);
  return new Set(["acceso_dashboard"]);
}

// ---------------------------------------------------------------------------
// Lectura desde Supabase (con fallback a los valores en memoria)
// ---------------------------------------------------------------------------

/** Perfiles: tabla `perfiles` o defaults si no existe. */
export async function leerPerfiles(): Promise<Perfil[]> {
  if (supabase) {
    try {
      const { data, error } = await supabase.from("perfiles").select("id, nombre, descripcion").order("id");
      if (!error && Array.isArray(data) && data.length) return data as Perfil[];
    } catch {
      /* fallback */
    }
  }
  return PERFILES_DEFECTO;
}

/** Permisos: tabla `permisos` o catálogo canónico. */
export async function leerPermisos(): Promise<Permiso[]> {
  if (supabase) {
    try {
      const { data, error } = await supabase.from("permisos").select("id, clave, modulo, descripcion").order("id");
      if (!error && Array.isArray(data) && data.length) return data as Permiso[];
    } catch {
      /* fallback */
    }
  }
  return PERMISOS_CANONICOS;
}

/** Permisos vigentes de un perfil (tabla perfil_permisos o mapa por defecto). */
export async function permisosDePerfil(perfil: Perfil): Promise<Set<string>> {
  if (supabase && perfil.id != null) {
    try {
      const { data, error } = await supabase
        .from("perfil_permisos")
        .select("permisos (clave), activo")
        .eq("perfil_id", perfil.id);
      if (!error && Array.isArray(data) && data.length) {
        return new Set(
          data
            .filter((r) => r.activo !== false)
            .map((r) => (Array.isArray(r.permisos) ? r.permisos[0] : r.permisos)?.clave)
            .filter(Boolean)
        );
      }
    } catch {
      /* fallback */
    }
  }
  return accesosPorDefecto(perfil.nombre);
}

/** Guarda la matriz completa de un perfil: borra y reinserta (transaccional desde el front). */
export async function guardarAccesosPerfil(perfil: Perfil, claves: string[]): Promise<ResGuardarAccesos> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase." };
  try {
    const { data: permisos } = await supabase.from("permisos").select("id, clave");
    if (!Array.isArray(permisos) || !permisos.length) return { ok: false, error: "La tabla de permisos no existe en la BD." };
    const idPorClave = new Map((permisos as { id: number | string; clave: string }[]).map((p) => [p.clave, p.id]));
    const clavesValidas = claves.filter((c) => idPorClave.has(c));

    const { error: del } = await supabase.from("perfil_permisos").delete().eq("perfil_id", perfil.id);
    if (del) return { ok: false, error: del.message };

    if (clavesValidas.length) {
      const filas = clavesValidas.map((c) => ({ perfil_id: perfil.id, permiso_id: idPorClave.get(c) }));
      const { error: ins } = await supabase.from("perfil_permisos").insert(filas);
      if (ins) return { ok: false, error: ins.message };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Usuarios (auth.users) + sus perfiles, para la pestaña de asignación por usuario. */
export async function leerUsuarios(): Promise<UsuarioSistema[]> {
  if (supabase) {
    try {
      const { data, error } = await supabase.from("auth.users").select("id, email, raw_user_meta_data");
      if (!error && Array.isArray(data)) {
        return data.map((u) => {
          const meta = (u.raw_user_meta_data ?? {}) as Record<string, unknown>;
          return {
            id: String(u.id),
            email: u.email ?? null,
            nombre: meta.nombre ? String(meta.nombre) : null,
            perfiles: [],
          };
        });
      }
    } catch {
      /* fallback */
    }
  }
  return [];
}

/** Permisos individuales extra de un usuario (usuario_permisos). */
export async function permisosDeUsuario(usuarioId: string): Promise<Set<string>> {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("usuario_permisos")
        .select("permisos (clave), activo")
        .eq("usuario_id", usuarioId);
      if (!error && Array.isArray(data) && data.length) {
        return new Set(
          data
            .filter((r) => r.activo !== false)
            .map((r) => (Array.isArray(r.permisos) ? r.permisos[0] : r.permisos)?.clave)
            .filter(Boolean)
        );
      }
    } catch {
      /* fallback */
    }
  }
  return new Set();
}

/** Guarda los permisos extra individuales de un usuario. */
export async function guardarAccesosUsuario(usuarioId: string, claves: string[]): Promise<ResGuardarAccesos> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase." };
  try {
    const { data: permisos } = await supabase.from("permisos").select("id, clave");
    if (!Array.isArray(permisos) || !permisos.length) return { ok: false, error: "La tabla de permisos no existe en la BD." };
    const idPorClave = new Map((permisos as { id: number | string; clave: string }[]).map((p) => [p.clave, p.id]));
    const clavesValidas = claves.filter((c) => idPorClave.has(c));

    const { error: del } = await supabase.from("usuario_permisos").delete().eq("usuario_id", usuarioId);
    if (del) return { ok: false, error: del.message };

    if (clavesValidas.length) {
      const filas = clavesValidas.map((c) => ({ usuario_id: usuarioId, permiso_id: idPorClave.get(c) }));
      const { error: ins } = await supabase.from("usuario_permisos").insert(filas);
      if (ins) return { ok: false, error: ins.message };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}