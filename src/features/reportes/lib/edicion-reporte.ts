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
 *
 * RECÁLCULO TOTAL
 * ---------------
 * El reporte muestra carreras habitualmente YA LIQUIDADAS. Corregir/anular/
 * restaurar una jugada cambia ganadores, premios y la comisión del grupo, así
 * que después del cambio se dispara `autoReliquidarSiLiquidada`: si la carrera
 * tiene resultado oficial, REHACE la liquidación íntegra (revierte, re-liquida
 * universal + especiales y re-cobra remates) y los totales del reporte
 * (cobrado / pagado / comisión de grupo / balance) quedan recalculados de punta
 * a punta. Si no hay resultado, no hace nada (la liquidación normal lo hará).
 */
import {
  anularJugada,
  editarJugada,
  restaurarJugada,
  type EditablesJugada,
  type Resultado,
} from "@/features/jugadas/lib/jugadas";
import { esPerfilAdministradorVigente, usuarioVigente } from "@/features/seguridad/lib/vigente";
import { autoReliquidarSiLiquidada } from "@/features/liquidacion/lib/recalcular";

/** Mensaje único cuando la sesión no tiene el perfil que habilita la edición. */
export const SIN_PERFIL_ADMIN =
  "Solo el perfil Administrador Principal puede corregir, anular o restaurar jugadas desde el reporte.";

/** ¿La sesión vigente puede editar jugadas desde el reporte? */
export function puedeEditarDesdeReporte(): boolean {
  return esPerfilAdministradorVigente();
}

/** Carrera de la jugada editada, para poder recalcularla si está liquidada. */
export type CarreraDeLaJugada = {
  hipodromo: string;
  carrera: number | string;
  fecha?: string;
  tasaComision?: number | null;
};

/**
 * Tras un cambio en una jugada del reporte, rehace la carrera si está liquidada.
 * Anexa al resultado el resumen del recálculo (o el aviso de por qué no se pudo)
 * sin convertir un cambio ya aplicado en error.
 */
async function recalcularTrasCambio(
  base: Resultado,
  ctx: CarreraDeLaJugada | undefined
): Promise<Resultado> {
  if (!base.ok || !ctx?.hipodromo || !ctx.carrera) return base;
  try {
    const r = await autoReliquidarSiLiquidada({
      hipodromo: ctx.hipodromo,
      carrera: ctx.carrera,
      fecha: ctx.fecha,
      tasaComision: ctx.tasaComision,
      usuario: usuarioVigente(),
    });
    if (r.reliquidada && r.resumen) {
      const resumen = r.resumen;
      return {
        ok: base.ok,
        error: `${base.error ? `${base.error} · ` : ""}Carrera recalculada: ${resumen.revertidos} revertida(s) · ${resumen.reliquidados} re-liquidada(s) · tablas ${resumen.jugadas?.tablasFijas?.tablas ?? 0}.`,
      };
    }
  } catch (e) {
    return { ok: base.ok, error: `${base.error ? `${base.error} · ` : ""}No se pudo recalcular la carrera: ${(e as Error).message}` };
  }
  return base;
}

/** Corrige una jugada (monto, ejemplar, estado, premio) con su motivo. */
export async function editarJugadaDeReporte(
  id: string | number,
  campos: EditablesJugada,
  motivo: string,
  ctx?: CarreraDeLaJugada
): Promise<Resultado> {
  if (!puedeEditarDesdeReporte()) return { ok: false, error: SIN_PERFIL_ADMIN };
  const base = await editarJugada(id, campos, motivo, usuarioVigente());
  return recalcularTrasCambio(base, ctx);
}

/** Anula una jugada con su motivo (queda auditada). */
export async function anularJugadaDeReporte(
  id: string | number,
  motivo: string,
  ctx?: CarreraDeLaJugada
): Promise<Resultado> {
  if (!puedeEditarDesdeReporte()) return { ok: false, error: SIN_PERFIL_ADMIN };
  const base = await anularJugada(id, motivo, null, usuarioVigente());
  return recalcularTrasCambio(base, ctx);
}

/** Restaura una jugada anulada con su motivo. */
export async function restaurarJugadaDeReporte(
  id: string | number,
  motivo: string,
  ctx?: CarreraDeLaJugada
): Promise<Resultado> {
  if (!puedeEditarDesdeReporte()) return { ok: false, error: SIN_PERFIL_ADMIN };
  const base = await restaurarJugada(id, motivo, usuarioVigente());
  return recalcularTrasCambio(base, ctx);
}
