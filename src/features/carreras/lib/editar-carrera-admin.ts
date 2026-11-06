import { supabase } from "@/core/supabase";

export interface ParametrosEditarCarreraAdmin {
  fechaActual: string;
  hipodromoActual: string;
  carreraActual: number;
  nuevaFecha: string;
  nuevoHipodromo: string;
  nuevaCarrera: number;
  distancia?: string;
  superficie?: string;
  ejemplares?: any;
}

/**
 * RPC: editar_carrera_admin
 * Permite a operadores/administradores actualizar de forma atómica fecha, hipódromo,
 * número de carrera y ejemplares en carreras central, tablas_fijas y chat_estado_grupo.
 */
export async function ejecutarEdicionCarreraAdmin(
  params: ParametrosEditarCarreraAdmin
): Promise<{ ok: boolean; mensaje?: string; error?: string }> {
  if (!supabase) {
    return { ok: false, error: "Sin conexión a base de datos" };
  }

  try {
    const { data, error } = await supabase.rpc("editar_carrera_admin", {
      p_fecha_actual: params.fechaActual,
      p_hipodromo_actual: params.hipodromoActual.toUpperCase().trim(),
      p_carrera_actual: params.carreraActual,
      p_nueva_fecha: params.nuevaFecha,
      p_nuevo_hipodromo: params.nuevoHipodromo.toUpperCase().trim(),
      p_nueva_carrera: params.nuevaCarrera,
      p_distancia: params.distancia || null,
      p_superficie: params.superficie || null,
      p_ejemplares: params.ejemplares || null,
    });

    if (error) {
      console.warn("[editar_carrera_admin] Error RPC:", error.message);
      return { ok: false, error: error.message };
    }

    return {
      ok: true,
      mensaje: data?.mensaje || "Carrera actualizada exitosamente",
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || "Error al invocar editar_carrera_admin",
    };
  }
}
