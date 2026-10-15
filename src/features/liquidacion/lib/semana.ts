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
 * el grupo ya ejecutó su consolidación (los tres botones viven en
 * `src/components/dashboard/DashboardGrupos.tsx` y escriben en
 * `src/lib/liquidacion/cierres.ts`).
 *
 * SEMANA VIGENTE
 * El ciclo dice QUÉ DÍAS forman la semana, pero no cuál de las muchas posibles es
 * la que se está operando. Eso se deducía de hoy y la deducción falla cuando la
 * casa sigue con la semana anterior porque la actual todavía no arrancó, o
 * cuando el cierre se hace días después del corte. Para eso está
 * `grupos_venta.semana_vigente_inicio` (`sql/semana_vigente.sql`): si tiene
 * fecha, esa es la semana; si es NULL, se sigue deduciendo de hoy como siempre.
 * `semanaVigenteDe()` es el único lugar que decide entre las dos.
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
  const diaInicio = diaValido(g.dia_inicio_semana) ?? CICLO_DEFAULT.diaInicio;
  // El corte cae al default (domingo), NO al inicio. Caer al inicio producía un
  // ciclo de UN día: sin `dia_fin_semana` la semana "vigente" duraba 24 horas y
  // el cierre semanal consolidaba un solo día. Ahora la semana siempre abarca
  // 7 días.
  const diaFin = diaValido(g.dia_fin_semana) ?? CICLO_DEFAULT.diaFin;
  return { diaInicio, diaFin };
}

/** 1..7 o null si el dato no sirve (ausente, cero, texto, fuera de rango). */
function diaValido(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 7 ? n : null;
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

/**
 * Rango de la semana que contiene `inicioIso`, con el ciclo del grupo.
 *
 * Es el mismo cálculo que `rangoSemanaDeGrupo` pero anclado a una fecha
 * cualquiera, no a hoy. Lo usa la semana fijada: cuando el dueño dice "seguimos
 * en la semana del lunes", el rango que hay que mostrar y consolidar es el de
 * ESE lunes, no el de hoy.
 */
export function rangoSemanaDesde(
  inicioIso: string,
  grupo: CicloSemanal
): { inicio: string; fin: string } {
  const base = inicioIso.slice(0, 10);
  // Si el inicio fijado no coincide con el día de apertura del ciclo, el rango
  // se ancla igual: se corrige hacia atrás hasta la apertura anterior. Es lo
  // que evita que "volvamos" una semana a medio curso por un dedo de más.
  const retro = (diaFiscalDeIso(base) - grupo.diaInicio + 7) % 7;
  const inicio = sumarDias(base, -retro);
  const span = grupo.diaFin >= grupo.diaInicio ? grupo.diaFin - grupo.diaInicio : 7 - grupo.diaInicio + grupo.diaFin;
  return { inicio, fin: sumarDias(inicio, span) };
}

/** Día fiscal 1..7 (Lunes=1) de una fecha ISO, sin construir un Date con UTC. */
function diaFiscalDeIso(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return 1;
  return diaFiscal(new Date(y, m - 1, d));
}

/**
 * Semana que hay que mostrar y consolidar: la fijada si existe, la deducida de
 * hoy si no.
 *
 * La distinción importa: `semana_vigente_inicio = NULL` es el estado NORMAL y
 * no significa "sin semana". Significa "seguí el calendario", que es como
 * funcionaba el sistema antes de que existiera la columna. Por eso el fallback
 * es la deducción y no un error.
 *
 * `fijada` sale en el resultado para que la UI pueda avisar que está mirando una
 * semana elegida a mano y no la del reloj: si el operador ve "ABIERTA" un martes
-- a la semana del lunes, tiene que saber por qué.
 */
export function semanaVigenteDe(
  hoyIso: string,
  grupo: CicloSemanal,
  fijadaInicio?: string | null
): { inicio: string; fin: string; fijada: boolean } {
  const f = String(fijadaInicio ?? "").slice(0, 10);
  if (esIsoReal(f)) {
    const r = rangoSemanaDesde(f, grupo);
    return { ...r, fijada: true };
  }
  return { ...rangoSemanaDeGrupo(hoyIso, grupo), fijada: false };
}

/**
 * ¿Es una fecha ISO real? Formato YYYY-MM-DD **y** que exista en el calendario.
 *
 * La segunda mitad no es un detalle: con solo la expresión regular, "2026-13-45"
 * pasa el filtro y `new Date(2026, 12, 45)` no lanza — se corre solo a febrero de
 * 2027. El sistema finitamente fijaría la semana vigente a un rango que nadie
 * pidió. Por eso se compara el formato con la fecha que reconstruye el número.
 */
function esIsoReal(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split("-").map(Number);
  // Fuera de rango de forma obvia: el `new Date` las normalizaría igual.
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const fecha = new Date(y, m - 1, d);
  return (
    fecha.getFullYear() === y && fecha.getMonth() === m - 1 && fecha.getDate() === d
  );
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