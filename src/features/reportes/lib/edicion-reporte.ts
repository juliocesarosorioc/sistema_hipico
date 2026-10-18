/**
 * EDICIÓN AUDITADA DE JUGADAS DESDE LOS REPORTES (Marcas y Tablas Fijas).
 *
 * El Reporte de Marcas y el de Tablas Fijas comparten el mismo detalle de
 * tickets (`ReporteVentasModal`). Desde ahí, y SOLO desde ahí, el dueño del
 * negocio puede corregir, anular y restaurar una jugada —cada acción con su
 * motivo y su rastro en `jugadas_auditoria`—.
 *
 * ¿Por qué una puerta aparte y no llamar directo a `editarJugada`? Porque el
 * requisito es de PERFIL, no de capacidad: un operador puede tener
 * `jugadas:fn_editar_jugada` para trabajar en el Monitor de Jugadas y aun así NO
 * debe tocar las ventas desde el reporte. Acá se exige el perfil
 * "Administrador Principal" (`esPerfilAdministradorVigente`) ANTES de delegar,
 * y recién entonces `editarJugada`/`anularJugada`/`restaurarJugada` vuelven a
 * chequear su capacidad (defensa en profundidad).
 */
import {
  anularJugada,
  editarJugada,
  restaurarJugada,
  type EditablesJugada,
  type Resultado,
} from "@/features/jugadas/lib/jugadas";
import { esPerfilAdministradorVigente, usuarioVigente } from "@/features/seguridad/lib/vigente";

/** Mensaje único cuando la sesión no tiene el perfil que habilita la edición. */
export const SIN_PERFIL_ADMIN =
  "Solo el perfil Administrador Principal puede corregir, anular o restaurar jugadas desde el reporte.";

/** ¿La sesión vigente puede editar jugadas desde el reporte? */
export function puedeEditarDesdeReporte(): boolean {
  return esPerfilAdministradorVigente();
}

/** Corrige una jugada (monto, ejemplar, estado, premio) con su motivo. */
export async function editarJugadaDeReporte(
  id: string | number,
  campos: EditablesJugada,
  motivo: string
): Promise<Resultado> {
  if (!puedeEditarDesdeReporte()) return { ok: false, error: SIN_PERFIL_ADMIN };
  return editarJugada(id, campos, motivo, usuarioVigente());
}

/** Anula una jugada con su motivo (queda auditada). */
export async function anularJugadaDeReporte(id: string | number, motivo: string): Promise<Resultado> {
  if (!puedeEditarDesdeReporte()) return { ok: false, error: SIN_PERFIL_ADMIN };
  return anularJugada(id, motivo, null, usuarioVigente());
}

/** Restaura una jugada anulada con su motivo. */
export async function restaurarJugadaDeReporte(id: string | number, motivo: string): Promise<Resultado> {
  if (!puedeEditarDesdeReporte()) return { ok: false, error: SIN_PERFIL_ADMIN };
  return restaurarJugada(id, motivo, usuarioVigente());
}
