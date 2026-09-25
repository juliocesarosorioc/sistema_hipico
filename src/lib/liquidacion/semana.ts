/**
 * CICLOS DE FACTURACIÓN SEMANAL POR GRUPO
 * ----------------------------------------
 * Cada grupo define su semana fiscal con dos columnas (grupos_venta):
 *   dia_inicio_semana · 1..7 (1 = Lunes … 7 = Domingo) — día de APERTURA
 *   dia_fin_semana    · 1..7 — día de CORTE/CIERRE de la semana.
 * El default (Lunes–Domingo) cubre el ciclo natural de la mayoría.
 *
 * LOS SALDOS CONSOLIDADADOS DEBEN EVALUAR ESTE PARÁMETRO: las consultas de
 * "Semana en curso" (movimientos, saldos por cliente, cierres) deben filtrarse
 * por el rango que devuelve `rangoSemanaDeGrupo()` para el grupo seleccionado.
 * Ej. grupo con inicio=Jueves(4) y fin=Miércoles(3): la semana en curso que
 * contiene el Jueves 24/09/2026 va del Jue 24/09 (00:00) al Mié 30/09 (23:59).
 *
 * El "estado" de la semana es conceptual: ABIERTA mientras hoy ∈ del ciclo
 * actual y al menos un día del ciclo aún no reporta cierre de caja; CERRADA si
 * el grupo ya ejecutó su consolidación (pendiente implementación del botón
 * "Cerrar Semana" — ver backlog en PLANIFICACION.md).
 */

export type CicloSemanal = {
  /** Día de apertura 1..7 (1 = Lunes). */
  diaInicio: number;
  /** Día de corte 1..7 (1 = Lunes). */
  diaFin: number;
};

export const CICLO_DEFAULT: CicloSemanal = { diaInicio: 1, diaFin: 7 };

/** Normaliza el ciclo leído de la BD (default Lunes→Domingo). */
export function cicloSemanalDe(g: {
  dia_inicio_semana?: number | null;
  dia_fin_semana?: number | null;
}): CicloSemanal {
  const i = Number(g.dia_inicio_semana);
  const f = Number(g.dia_fin_semana);
  const diaInicio = Number.isInteger(i) && i >= 1 && i <= 7 ? i : 1;
  const diaFin = Number.isInteger(f) && f >= 1 && f <= 7 ? f : diaInicio;
  return { diaInicio, diaFin };
}

/** getDay() de JS (0=Domingo…6=Sábado) → día fiscal 1..7 (Lunes=1). */
function diaFiscal(d: Date): number {
  const js = d.getDay();
  return js === 0 ? 7 : js;
}

/** Fecha ISO (YYYY-MM-DD) sumando `dias` a una fecha local. */
function sumarDias(d: string, dias: number): string {
  const [y, m, dd] = d.split("-").map(Number);
  const base = new Date(y, m - 1, dd);
  base.setDate(base.getDate() + dias);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;
}

/**
 * Rango [inicio, fin] de la semana fiscal (ciclo del grupo) que contiene la
 * fecha `hoyIso` (YYYY-MM-DD, local). El rango nunca cruza dos semanas
 * naturales: el fin se calcula como "el día anterior al próximo inicio".
 *
 * Uso en Saldos Consolidados:
 *   const { inicio, fin } = rangoSemanaDeGrupo(hoyLocal(), grupo);
 *   ... tabs.eq("fecha", ...).gte("fecha", inicio).lte("fecha", fin)
 */
export function rangoSemanaDeGrupo(hoyIso: string, grupo: CicloSemanal): { inicio: string; fin: string } {
  const { diaInicio, diaFin } = grupo;
  const [y, m, d] = hoyIso.split("-").map(Number);
  const hoy = new Date(y, m - 1, d);
  const df = diaFiscal(hoy);
  // Inicio: retroceder hasta el último día de apertura ≤ hoy.
  const retro = (df - diaInicio + 7) % 7;
  const inicio = sumarDias(hoyIso, -retro);
  // Fin: día de corte de la MISMA semana → si fin<inicio cierra tras cruzar
  // el próximo inicio (semana corrida tipo Jue→Mié).
  let fin: string;
  if (diaFin >= diaInicio) {
    fin = sumarDias(inicio, diaFin - diaInicio);
  } else {
    fin = sumarDias(inicio, 7 - diaInicio + diaFin);
  }
  return { inicio, fin };
}

/** Días 1..7 con etiqueta (para los selectores de /grupos y el Dashboard). */
export const DIAS_SEMANA = [
  { valor: 1, corto: "Lun", nombre: "Lunes" },
  { valor: 2, corto: "Mar", nombre: "Martes" },
  { valor: 3, corto: "Mié", nombre: "Miércoles" },
  { valor: 4, corto: "Jue", nombre: "Jueves" },
  { valor: 5, corto: "Vie", nombre: "Viernes" },
  { valor: 6, corto: "Sáb", nombre: "Sábado" },
  { valor: 7, corto: "Dom", nombre: "Domingo" },
] as const;

export function etiquetaDia(v: number | null | undefined): string {
  return DIAS_SEMANA.find((d) => d.valor === Number(v))?.nombre ?? "—";
}