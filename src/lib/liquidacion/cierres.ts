/**
 * CIERRES DE CAJA POR GRUPO — el registro que faltaba para que "Cierre del
 * Día", "Cerrar Semana" y "Semanas Anteriores" dejen de ser stubs.
 *
 * QUÉ ES UN CIERRE
 * Una FOTO del balance de la casa en un rango: qué día (o qué semana fiscal) se
 * consolidó, cuánto saldo dejó y quién lo ejecutó. No mueve dinero ni bloquea la
 * operatoria — consolidar es una LECTURA del reporte, no un pago. Quien paga es
 * el módulo de Liquidación. Por eso volver a cerrar el mismo rango actualiza el
 * balance en vez de duplicar la fila: en un hipódromo, corregir una liquidación
 * y reconsolidar es normal.
 *
 * POR QUÉ NO SE USA EL ESTADO DEL GRUPO
 * Un grupo tiene un ciclo semanal (dia_inicio_semana/dia_fin_semana) y MUCHOS
 * ciclos. "La semana del 12 al 18 ya se cerró y la del 19 todavía no" no cabe en
 * dos flags, y es justo lo que el operador necesita ver en Semanas Anteriores.
 *
 * SIN EL SQL, ESTO AVISA
 * `sql/cierres_jornada.sql` crea la tabla. Si no está aplicada, cada función
 * devuelve el motivo en `error` y la UI lo muestra: es preferible a escribir el
 * balance en un lugar que después nadie pueda leer.
 */
import { supabase } from "@/lib/supabase";
import { exigirCapacidad, usuarioVigente } from "@/lib/seguridad/vigente";
import { hoyLocal } from "@/lib/gaceta/programa";
import { construirReporteSemana, resumirReporte, type GrupoReporte } from "@/lib/liquidacion/reportes";
import { cicloSemanalDe, semanaVigenteDe } from "@/lib/liquidacion/semana";

export type TipoCierre = "DIA" | "SEMANA";

export type CierreJornada = {
  id: number;
  grupo_id: string;
  tipo: TipoCierre;
  fecha_inicio: string;
  fecha_fin: string;
  balance: number;
  detalle: Record<string, unknown> | null;
  cerrado_por: string | null;
  created_at: string;
};

/** Resumen del reporte que queda congelado en el cierre. */
export type DetalleCierre = {
  dias: number;
  hipodromos: number;
  carreras: number;
  tickets: number;
  cruces: number;
};

export const MENSAJE_SIN_TABLA =
  "La tabla de cierres no está disponible. Aplicá sql/cierres_jornada.sql en Supabase.";

/**
 * Capacidad que habilita consolidar. Es la de "escribir un movimiento de caja"
 * a propósito: el cierre es la consolidación de la caja del período, así que
 * quien puede mover la caja puede cerrarla. No se inventó una capacidad nueva
 * porque declararla sin fila en la base deja el botón muerto para todo el mundo.
 */
const CAPACIDAD_CERRAR = "contabilidad:fn_registrar_movimiento";

const TABLA = "cierres_jornada";

/** `true` cuando el error dice "esta tabla no existe" → falta correr el SQL. */
function esAusente(msg: string): boolean {
  return /does not exist|not found|PGRST202|PGRST204|schema cache/i.test(msg);
}

const COLS = "id,grupo_id,tipo,fecha_inicio,fecha_fin,balance,detalle,cerrado_por,created_at";

/**
 * Rango que se cierra: el día, o la semana fiscal VIGENTE del grupo.
 *
 * Para la semana usa `semana_vigenteDe`, no `rangoSemanaDeGrupo`: si el dueño
 * fijó la semana a mano (ver sql/semana_vigente.sql), consolidar tiene que caer
 * sobre ESA semana. Si cerráramos la deducida de hoy, el botón cerraría una
 * semana distinta de la que la pantalla muestra y el histórico quedaría
 * contradictorio.
 *
 * El cierre del DÍA sigue siendo el día de hoy: fijar la semana no mueve la
 * jornada.
 */
export function rangoACerrar(grupo: GrupoReporte, tipo: TipoCierre, fecha?: string): { inicio: string; fin: string } {
  if (tipo === "DIA") {
    const dia = (fecha || hoyLocal()).slice(0, 10);
    return { inicio: dia, fin: dia };
  }
  // Se toman solo las dos fechas: `semanaVigenteDe` devuelve además `fijada`, que
  // es para la UI. Este rango va al `upsert`, y mandar campos de más a una fila
  // es la forma más rápida de que el cierre deje de guardarse.
  const { inicio, fin } = semanaVigenteDe(fecha || hoyLocal(), cicloSemanalDe(grupo), grupo.semana_vigente_inicio);
  return { inicio, fin };
}

/**
 * Histórico del grupo, del rango más nuevo al más viejo.
 *
 * Se leen también los cierres por DÍA dentro de cada semana: el histórico del
 * operador son los dos niveles (la semana consolidada y sus cierres diarios), y
 * filtrar solo por `tipo = 'SEMANA'` escondería el trabajo del día a día.
 */
export async function listarCierres(
  grupoId: string | number | null | undefined
): Promise<{ ok: boolean; cierres: CierreJornada[]; error?: string }> {
  if (!supabase) return { ok: false, cierres: [], error: "Sin credenciales Supabase (.env.local)." };
  const gid = String(grupoId ?? "").trim();
  if (!gid) return { ok: true, cierres: [] };
  try {
    const { data, error } = await supabase
      .from(TABLA)
      .select(COLS)
      .eq("grupo_id", gid)
      .order("fecha_fin", { ascending: false })
      .order("id", { ascending: false });
    if (error) return { ok: false, cierres: [], error: esAusente(error.message) ? MENSAJE_SIN_TABLA : error.message };
    return { ok: true, cierres: (data ?? []) as unknown as CierreJornada[] };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, cierres: [], error: esAusente(msg) ? MENSAJE_SIN_TABLA : msg };
  }
}

/**
 * Días con cierre de caja dentro de un rango (para pintar la Semana Activa de
 * verde). Vienen como Set porque la grilla los consulta uno por uno.
 */
export async function diasCerrados(
  grupoId: string | number | null | undefined,
  desde: string,
  hasta: string
): Promise<{ ok: boolean; fechas: Set<string>; error?: string }> {
  const r = await listarCierres(grupoId);
  if (!r.ok) return { ok: false, fechas: new Set(), error: r.error };
  const fechas = new Set<string>();
  for (const c of r.cierres) {
    if (c.tipo !== "DIA") continue;
    const f = String(c.fecha_inicio).slice(0, 10);
    if (f >= desde && f <= hasta) fechas.add(f);
  }
  return { ok: true, fechas };
}

/**
 * Balance del rango, leído del MISMO reporte que muestra /saldos-reportes.
 *
 * Se reutiliza `construirReporteSemana` a propósito: si el cierre calculara su
 * propia cifra, el operador vería un número en el histórico que no coincide con
 * el de la planilla. Que el cierre sea la MISMA lectura es lo que hace creíble
 * el histórico.
 */
export async function balanceDeRango(
  grupo: GrupoReporte,
  desde: string,
  hasta: string
): Promise<{ ok: boolean; balance: number; detalle: DetalleCierre; error?: string }> {
  const vacio: DetalleCierre = { dias: 0, hipodromos: 0, carreras: 0, tickets: 0, cruces: 0 };
  const planilla = await construirReporteSemana(grupo, { desde, hasta });
  if (planilla.error) return { ok: false, balance: 0, detalle: vacio, error: planilla.error };
  const semanas = planilla.semanales;
  return {
    ok: true,
    balance: semanas?.totalSemana ?? 0,
    detalle: { ...vacio, ...resumirReporte(semanas) },
  };
}

/**
 * Consolida y registra el cierre.
 *
 * Es idempotente por (grupo, tipo, rango): reconsolidar la misma semana después
 * de una corrección actualiza el snapshot en vez de dejar dos filas que se
 * contradicen.
 */
export async function cerrarRango(opts: {
  grupoId: string | number;
  grupo: GrupoReporte;
  tipo: TipoCierre;
  fecha?: string;
}): Promise<{ ok: boolean; cierre?: CierreJornada; rango?: { inicio: string; fin: string }; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  const gid = String(opts.grupoId ?? "").trim();
  if (!gid) return { ok: false, error: "Elegí un grupo de venta." };
  try {
    exigirCapacidad(CAPACIDAD_CERRAR);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const rango = rangoACerrar(opts.grupo, opts.tipo, opts.fecha);
  const balance = await balanceDeRango(opts.grupo, rango.inicio, rango.fin);
  if (!balance.ok) return { ok: false, rango, error: balance.error ?? "No se pudo calcular el balance del rango." };

  const fila = {
    grupo_id: gid,
    tipo: opts.tipo,
    fecha_inicio: rango.inicio,
    fecha_fin: rango.fin,
    balance: balance.balance,
    detalle: balance.detalle as unknown as Record<string, unknown>,
    cerrado_por: usuarioVigente() || null,
    created_at: new Date().toISOString(),
  };

  try {
    const { data, error } = await supabase
      .from(TABLA)
      .upsert(fila, { onConflict: "grupo_id,tipo,fecha_inicio,fecha_fin" })
      .select(COLS)
      .maybeSingle();
    if (error) return { ok: false, rango, error: esAusente(error.message) ? MENSAJE_SIN_TABLA : error.message };
    return { ok: true, rango, cierre: (data ?? undefined) as unknown as CierreJornada | undefined };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, rango, error: esAusente(msg) ? MENSAJE_SIN_TABLA : msg };
  }
}

/**
 * Reabre un cierre (borra el registro).
 *
 * Existe porque el cierre es una foto, no un estado bloqueante: si el día se
 * consolidó con una liquidación mal cargada, corregir y reconsolidar tiene que
 * ser posible sin dejar el histórico mintiendo.
 */
export async function reabrirCierre(id: number | string): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  if (id == null || id === "") return { ok: false, error: "Falta el id del cierre." };
  try {
    exigirCapacidad(CAPACIDAD_CERRAR);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  try {
    const { error } = await supabase.from(TABLA).delete().eq("id", id);
    if (error) return { ok: false, error: esAusente(error.message) ? MENSAJE_SIN_TABLA : error.message };
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: esAusente(msg) ? MENSAJE_SIN_TABLA : msg };
  }
}

/** "$1.234,56" — el histórico se lee en la moneda local del operador. */
export function formatCierre(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n)
    ? n.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "0,00";
}
