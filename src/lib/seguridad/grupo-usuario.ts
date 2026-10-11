/**
 * ============================================================================
 * GRUPO DEL USUARIO — a qué grupo de venta sirve la sesión
 * ============================================================================
 *
 * El aislamiento de la información por grupo vive en la BASE
 * (sql/grupos_usuarios.sql + sql/rls_por_grupo.sql). Este módulo es lo que la
 * app usa para saber, además, con qué grupo entra la persona: sirve para
 * mostrar el grupo en pantalla, para poner el grupo por defecto en las altas
 * (un cliente nuevo es de MI grupo) y para el filtro "ver todos" del super
 * administrador.
 *
 * La lectura va por la RPC `club_mi_grupo()`, que es `security definer`: así no
 * depende de la RLS de `usuario_sistema`, que hoy no deja leer ni la propia
 * fila cuando el `id` no coincide con el correo del JWT.
 *
 * Si la migración todavía no se aplicó (la RPC no existe), esta función NO
 * rompe el login: devuelve `aplicado: false` y la app sigue como antes (sin
 * aislamiento del lado del cliente).
 */

import { supabase } from "@/lib/supabase";

export type MiGrupo = {
  /** Grupo asignado, o "" si todavía no tiene (ve todo). */
  grupoId: string;
  /** Nombre del grupo, para mostrar. */
  grupoNombre: string;
  /** true si puede ver todos los grupos (principal o sin asignar). */
  veTodos: boolean;
  /** true si es el usuario principal. */
  esPrincipal: boolean;
  /** false si la migración `sql/grupos_usuarios.sql` todavía no se aplicó. */
  aplicado: boolean;
};

const SIN_APLICAR: MiGrupo = {
  grupoId: "",
  grupoNombre: "",
  veTodos: true,
  esPrincipal: false,
  aplicado: false,
};

/** El grupo de venta del usuario logueado (según `club_mi_grupo()`). */
export async function leerMiGrupo(): Promise<MiGrupo> {
  if (!supabase) return SIN_APLICAR;
  try {
    const { data, error } = await supabase.rpc("club_mi_grupo");
    if (error || !data) return SIN_APLICAR;
    const d = data as Record<string, unknown>;
    const grupoId = String(d.grupo_id ?? "").trim();
    return {
      grupoId,
      grupoNombre: String(d.grupo_nombre ?? "").trim(),
      // Sin grupo asignado se ve todo: misma regla que `ve_todos_los_grupos`.
      veTodos: d.ve_todos == null ? !grupoId : Boolean(d.ve_todos),
      esPrincipal: Boolean(d.es_principal),
      aplicado: true,
    };
  } catch {
    return SIN_APLICAR;
  }
}
