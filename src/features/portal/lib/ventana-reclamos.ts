/**
 * VENTANA DE REVISIÓN Y RECLAMOS POR GRUPO (PROMPT #6)
 * ===================================================
 * Cada grupo define hasta cuándo el jugador puede reclamar una jugada o pedir
 * que le incluyan una "jugada no relacionada" (la que quedó fuera del sistema).
 *
 * Son dos ajustes de calendario, no de dinero:
 *
 *   · SOLO_DIA_EN_CURSO  → la ventana es el DÍA de la jugada. Una jugada del
 *     lunes se puede reclamar el lunes; el martes ya no. Es el modo estricto,
 *     pensado para la operación diaria.
 *
 *   · SEMANA_EN_CURSO    → la ventana es la SEMANA fiscal del grupo (la que
 *     `rangoSemanaDeGrupo()` calcula con dia_inicio_semana / dia_fin_semana).
 *     Una jugada del lunes se puede reclamar hasta que cierre la semana.
 *
 * Este archivo es un núcleo PURO: no toca Supabase ni el DOM. La decisión se
 * puede probar sin base de datos, que es lo importante — que la ventana esté bien
 * calculada importa más que el color del botón.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ "DÍA EN CURSO" COMPARA CONTRA HOY Y NO CONTRA EL CIERRE
 * ---------------------------------------------------------------------------
 * "En curso" quiere decir que el día todavía no terminó. Para la jugada de hoy
 * siempre está abierta; para la de ayer, cerrada. Es una ventana móvil: no hay
 * que guardar nada por jugada, la antigüedad se deduce de la fecha.
 */

/** Modos admitidos por `grupos_venta.ventana_reclamos`. */
export const VENTANAS = ["SOLO_DIA_EN_CURSO", "SEMANA_EN_CURSO"] as const;
export type VentanaReclamos = (typeof VENTANAS)[number];

/** Default del sistema: la operación diaria, sin necesidad de configuración. */
export const VENTANA_POR_DEFECTO: VentanaReclamos = "SOLO_DIA_EN_CURSO";

/** ¿Es uno de los dos modos? Se usa para sanear lo que venga de la base. */
export function esVentanaValida(v: unknown): v is VentanaReclamos {
  return VENTANAS.includes(String(v ?? "").toUpperCase() as VentanaReclamos);
}

/** Normaliza lo que venga de la base o de un formulario; cae al default. */
export function normalizarVentana(v: unknown): VentanaReclamos {
  const s = String(v ?? "").trim().toUpperCase();
  return esVentanaValida(s) ? (s as VentanaReclamos) : VENTANA_POR_DEFECTO;
}

/** Etiqueta humana del modo (para el toggle de Grupos y el portal). */
export function etiquetaVentana(v: unknown): string {
  return normalizarVentana(v) === "SEMANA_EN_CURSO" ? "Semana en curso" : "Sólo día en curso";
}

/** Ciclo semanal del grupo (1..7, Lunes=1), como lo usa `rangoSemanaDeGrupo`. */
export type CicloGrupo = { diaInicio: number; diaFin: number };

/** Día fiscal 1..7 (Lunes=1) de una fecha YYYY-MM-DD, sin UTC. */
function diaFiscalDeIso(iso: string): number {
  const [y, m, d] = String(iso ?? "").slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return 1;
  const js = new Date(y, m - 1, d).getDay(); // 0=Domingo
  return js === 0 ? 7 : js;
}

/** Suma (o resta) días a una fecha ISO sin cruzar el meridiano local. */
function sumarDias(iso: string, n: number): string {
  const [y, m, d] = String(iso ?? "").slice(0, 10).split("-").map(Number);
  const t = new Date(y, m - 1, d);
  t.setDate(t.getDate() + n);
  const p = (v: number): string => String(v).padStart(2, "0");
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}

/**
 * Rango [inicio, fin] de la semana fiscal del grupo que contiene `hoyIso`.
 *
 * Es el mismo cálculo que `rangoSemanaDeGrupo()` de liquidación, reimplementado
 * acá para que este núcleo no arrastre dependencias del módulo de saldos: la
 * ventana de reclamos tiene que poder probarse sola.
 */
export function rangoSemana(hoyIso: string, grupo: CicloGrupo): { inicio: string; fin: string } {
  const diaInicio = normalizarDia(grupo?.diaInicio, 1);
  const diaFin = normalizarDia(grupo?.diaFin, 7);
  const df = diaFiscalDeIso(hoyIso);
  const retro = (df - diaInicio + 7) % 7;
  const inicio = sumarDias(hoyIso, -retro);
  const span = diaFin >= diaInicio ? diaFin - diaInicio : 7 - diaInicio + diaFin;
  return { inicio, fin: sumarDias(inicio, span) };
}

function normalizarDia(v: unknown, porDefecto: number): number {
  const n = Math.floor(Number(v));
  return n >= 1 && n <= 7 ? n : porDefecto;
}

/**
 * ¿La fecha `fechaJugada` cae dentro de la ventana de reclamos del grupo?
 *
 * `hoyIso` se pasa explícito (no se lee el reloj acá) para poder testear la
 * función en cualquier fecha. Una fecha vacía o inválida NUNCA es reclamable:
 * mejor cerrar que dejar reclamar algo sin fecha.
 */
export function dentroDeVentana(
  fechaJugada: string | null | undefined,
  hoyIso: string,
  ventana: unknown,
  grupo?: CicloGrupo | null
): boolean {
  const f = String(fechaJugada ?? "").slice(0, 10);
  const hoy = String(hoyIso ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || !/^\d{4}-\d{2}-\d{2}$/.test(hoy)) return false;
  // Una jugada "del futuro" no se reclama: es un error de carga, no una jugada.
  if (f > hoy) return false;

  if (normalizarVentana(ventana) === "SEMANA_EN_CURSO") {
    const { inicio, fin } = rangoSemana(hoy, grupo ?? { diaInicio: 1, diaFin: 7 });
    return f >= inicio && f <= fin;
  }
  // SOLO_DIA_EN_CURSO: únicamente el día de hoy.
  return f === hoy;
}

/** Última fecha (ISO) que todavía admite reclamo, para el `max` del input. */
export function fechaTopeReclamo(hoyIso: string, ventana: unknown, grupo?: CicloGrupo | null): string {
  const hoy = String(hoyIso ?? "").slice(0, 10);
  if (normalizarVentana(ventana) === "SEMANA_EN_CURSO") {
    return rangoSemana(hoy, grupo ?? { diaInicio: 1, diaFin: 7 }).fin;
  }
  return hoy;
}

/** Primera fecha (ISO) que todavía admite reclamo, para el `min` del input. */
export function fechaPisoReclamo(hoyIso: string, ventana: unknown, grupo?: CicloGrupo | null): string {
  const hoy = String(hoyIso ?? "").slice(0, 10);
  if (normalizarVentana(ventana) === "SEMANA_EN_CURSO") {
    return rangoSemana(hoy, grupo ?? { diaInicio: 1, diaFin: 7 }).inicio;
  }
  return hoy;
}

/**
 * Explicación corta de la ventana, para mostrar bajo el botón de reclamo.
 * Un texto, no un booleano: el jugador tiene que entender por qué no puede.
 */
export function explicarVentana(ventana: unknown): string {
  if (normalizarVentana(ventana) === "SEMANA_EN_CURSO") {
    return "Podés reclamar jugadas de toda la semana en curso (según el ciclo del grupo).";
  }
  return "Sólo podés reclamar jugadas del día de hoy.";
}
