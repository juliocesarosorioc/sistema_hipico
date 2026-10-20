/**
 * Carga de los grupos con su % de convenio para los reportes.
 *
 * `listarGruposVenta` ya pide `SELECT *` de `grupos_venta` (y cae a
 * `club_listar_grupos`, que también devuelve las columnas nuevas), así que las
 * tasas por producto vienen en la misma fila que el nombre. No hace falta una
 * consulta extra ni permisos de administración.
 */
import type { GrupoComisiones } from "@/features/grupos/lib/comisiones-convenio";
import { listarGruposVenta } from "@/features/grupos/lib/grupos";

/** Grupos activos con todas las columnas de convenio (0 si no hay sesión). */
export async function cargarGruposConvenio(): Promise<GrupoComisiones[]> {
  try {
    return await listarGruposVenta();
  } catch {
    return [];
  }
}
