"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { accesosPorDefecto, leerPerfiles, permisosDePerfil } from "@/lib/seguridad/permisos";

const CLAVE_PERFIL = "hipico_perfil";
const CLAVE_PERMISOS = "hipico_permisos";

/** Deja los permisos en una cookie para que src/middleware.ts pueda bloquear rutas. */
export function publicarPermisosEnCookies(perfiles: string[], permisos: string[]): void {
  if (typeof document === "undefined") return;
  const exp = "; path=/; max-age=86400; SameSite=Lax";
  try {
    document.cookie = `${CLAVE_PERFIL}=${encodeURIComponent(perfiles.join(","))}${exp}`;
    document.cookie = `${CLAVE_PERMISOS}=${encodeURIComponent([...permisos].join(","))}${exp}`;
  } catch {
    /* sinop */
  }
}

export type EstadoAuth = {
  /** true después del primer ciclo de carga inicial. */
  inicializada: boolean;
  /** true cuando ya se sembró el RBAC por primera vez (evita pisar permisos simulados). */
  sembrada: boolean;
  /** Identificación local del operador (sin Supabase Auth se usa el usuario demo). */
  usuario: string;
  email?: string | null;
  /** Nombres de perfil asignados (ej. ["Admin"]). */
  perfiles: string[];
  /** Set exacto de permisos vigentes del usuario actual (en memoria). */
  permisos: string[];
  cargando: boolean;
  inicializar: () => Promise<void>;
  /** Cambia el perfil de la sesión actual (la matriz de /seguridad lo usa para simular). */
  simularPerfil: (nombre: string) => Promise<void>;
  setPermisos: (permisos: string[]) => void;
  salir: () => void;
};

const inicioDefault = {
  usuario: "operador-admin",
  email: null as string | null,
  perfiles: ["Admin"],
  permisos: [...accesosPorDefecto("Admin")],
};

/**
 * Store de autenticación y RBAC. Al iniciar (o simular otro perfil) carga en
 * memoria el set de permisos EXACTO del usuario actual. La sesión persiste en
 * localStorage (zustand persist). Si Supabase tiene las tablas de RBAC, los
 * permisos se leen de ahí; si no, se usan los accesos por defecto.
 */
export const useAuthStore = create<EstadoAuth>()(
  persist(
    (set, get) => ({
      inicializada: false,
      sembrada: false,
      usuario: inicioDefault.usuario,
      email: null,
      perfiles: inicioDefault.perfiles,
      permisos: inicioDefault.permisos,
      cargando: false,

      inicializar: async () => {
        const { sembrada } = get();
        if (sembrada) {
          // Rehidratación ya restaurada desde localStorage → refresca cookies.
          const { perfiles, permisos } = get();
          publicarPermisosEnCookies(perfiles, permisos);
          set({ inicializada: true, cargando: false });
          return;
        }
        // Primera siembra: lee el perfil Admin desde Supabase (o defaults).
        set({ cargando: true });
        const perfiles = await leerPerfiles();
        const admin = perfiles.find((p) => /admin/i.test(p.nombre));
        const perfil = admin ?? perfiles[0];
        const setPermisos = perfil ? await permisosDePerfil(perfil) : accesosPorDefecto("Admin");
        const permisos = [...setPermisos];
        publicarPermisosEnCookies(perfil ? [perfil.nombre] : ["Admin"], permisos);
        set({
          inicializada: true,
          sembrada: true,
          cargando: false,
          usuario: perfil ? `operador@${perfil.nombre.toLowerCase()}` : get().usuario,
          perfiles: perfil ? [perfil.nombre] : get().perfiles,
          permisos,
        });
      },

      simularPerfil: async (nombre) => {
        set({ cargando: true });
        const perfiles = await leerPerfiles();
        const perfil = perfiles.find((p) => p.nombre === nombre) ?? { id: "x", nombre };
        const setPermisos = await permisosDePerfil(perfil);
        const permisos = [...setPermisos];
        publicarPermisosEnCookies([perfil.nombre], permisos);
        set({
          cargando: false,
          usuario: `operador@${perfil.nombre.toLowerCase()}`,
          perfiles: [perfil.nombre],
          permisos,
        });
      },

      setPermisos: (permisos) => set({ permisos }),

      salir: () => {
        if (typeof document !== "undefined") {
          try {
            document.cookie = `${CLAVE_PERFIL}=; path=/; max-age=0; SameSite=Lax`;
            document.cookie = `${CLAVE_PERMISOS}=; path=/; max-age=0; SameSite=Lax`;
          } catch {
            /* sinop */
          }
        }
        set({
          inicializada: false,
          sembrada: false,
          usuario: inicioDefault.usuario,
          email: null,
          perfiles: inicioDefault.perfiles,
          permisos: inicioDefault.permisos,
        });
      },
    }),
    {
      name: "sistema-hipico:auth",
      partialize: (s) => ({
        sembrada: s.sembrada,
        usuario: s.usuario,
        email: s.email,
        perfiles: s.perfiles,
        permisos: s.permisos,
      }),
    }
  )
);

/**
 * Utilidad RBAC síncrona. Devuelve true si el usuario actual posee TODOS los
 * permisos indicados (una clave o una lista).
 */
export function hasPermission(permiso: string | string[]): boolean {
  const set = new Set(useAuthStore.getState().permisos);
  if (Array.isArray(permiso)) return permiso.every((p) => set.has(p));
  return set.has(permiso);
}

export default useAuthStore;