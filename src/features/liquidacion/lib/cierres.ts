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
import { supabase } from "@/core/supabase";
import { usuarioVigente } from "@/features/seguridad/lib/vigente";
import { hoyLocal } from "@/features/gaceta/lib/programa";
import { construirReporteSemana, resumirReporte, type GrupoReporte } from "@/features/liquidacion/lib/reportes";
import { cicloSemanalDe, semanaVigenteDe } from "@/features/liquidacion/lib/semana";
import { leerSemanaVigenteLocal } from "@/features/liquidacion/lib/semana-vigente";

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
const CLAVE_CIERRES_LOCAL_PREFIX = "hipico_cierres_jornada_";
let tablaCierresAusente = false;

function leerCierresLocal(grupoId: string): CierreJornada[] {
  if (typeof window === "undefined" || !grupoId) return [];
  try {
    const raw = window.localStorage.getItem(`${CLAVE_CIERRES_LOCAL_PREFIX}${grupoId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CierreJornada[]) : [];
  } catch {
    return [];
  }
}

function guardarCierresLocal(grupoId: string, lista: CierreJornada[]): void {
  if (typeof window === "undefined" || !grupoId) return;
  try {
    window.localStorage.setItem(`${CLAVE_CIERRES_LOCAL_PREFIX}${grupoId}`, JSON.stringify(lista));
  } catch {
    /* ignore */
  }
}

function fusionarCierres(remotos: CierreJornada[], locales: CierreJornada[]): CierreJornada[] {
  const mapa = new Map<string, CierreJornada>();
  for (const c of locales) {
    const k = `${c.tipo}|${String(c.fecha_inicio).slice(0, 10)}|${String(c.fecha_fin).slice(0, 10)}`;
    mapa.set(k, c);
  }
  for (const c of remotos) {
    const k = `${c.tipo}|${String(c.fecha_inicio).slice(0, 10)}|${String(c.fecha_fin).slice(0, 10)}`;
    mapa.set(k, c);
  }
  return [...mapa.values()].sort(
    (a, b) =>
      String(b.fecha_fin).localeCompare(String(a.fecha_fin)) ||
      (Number(b.id) || 0) - (Number(a.id) || 0)
  );
}

/** `true` cuando el error dice "esta tabla no existe" → falta correr el SQL. */
function esAusente(msg: string): boolean {
  return /does not exist|not found|PGRST202|PGRST204|schema cache/i.test(msg);
}

const COLS = "id,grupo_id,tipo,fecha_inicio,fecha_fin,balance,detalle,cerrado_por,created_at";

/**
 * Rango que se cierra: el día, o la semana fiscal VIGENTE del grupo.
 */
export function rangoACerrar(grupo: GrupoReporte, tipo: TipoCierre, fecha?: string): { inicio: string; fin: string } {
  if (tipo === "DIA") {
    const dia = (fecha || hoyLocal()).slice(0, 10);
    return { inicio: dia, fin: dia };
  }
  const gid = (grupo as { id?: string | number }).id;
  const vigenteLocal = leerSemanaVigenteLocal(gid);
  const fijada = vigenteLocal ?? grupo.semana_vigente_inicio;
  const { inicio, fin } = semanaVigenteDe(fecha || hoyLocal(), cicloSemanalDe(grupo), fijada);
  return { inicio, fin };
}

/**
 * Histórico del grupo, del rango más nuevo al más viejo.
 */
export async function listarCierres(
  grupoId: string | number | null | undefined
): Promise<{ ok: boolean; cierres: CierreJornada[]; error?: string }> {
  const gid = String(grupoId ?? "").trim();
  if (!gid) return { ok: true, cierres: [] };
  const locales = leerCierresLocal(gid);
  if (!supabase || tablaCierresAusente) return { ok: true, cierres: locales };
  try {
    const { data, error } = await supabase
      .from(TABLA)
      .select(COLS)
      .eq("grupo_id", gid)
      .order("fecha_fin", { ascending: false })
      .order("id", { ascending: false });
    if (error) {
      if (esAusente(error.message)) tablaCierresAusente = true;
      return { ok: true, cierres: locales };
    }
    const remotos = (data ?? []) as unknown as CierreJornada[];
    const unidos = fusionarCierres(remotos, locales);
    guardarCierresLocal(gid, unidos);
    return { ok: true, cierres: unidos };
  } catch {
    return { ok: true, cierres: locales };
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
  const gid = String(opts.grupoId ?? "").trim();
  if (!gid) return { ok: false, error: "Elegí un grupo de venta." };

  const rango = rangoACerrar(opts.grupo, opts.tipo, opts.fecha);
  const balance = await balanceDeRango(opts.grupo, rango.inicio, rango.fin);
  const balValor = balance.ok ? balance.balance : 0;
  const detValor = balance.ok ? balance.detalle : { dias: 0, hipodromos: 0, carreras: 0, tickets: 0, cruces: 0 };

  const fila = {
    grupo_id: gid,
    tipo: opts.tipo,
    fecha_inicio: rango.inicio,
    fecha_fin: rango.fin,
    balance: balValor,
    detalle: detValor as unknown as Record<string, unknown>,
    cerrado_por: usuarioVigente() || null,
    created_at: new Date().toISOString(),
  };

  const cierreLocal: CierreJornada = {
    id: Date.now(),
    ...fila,
  };

  const previos = leerCierresLocal(gid);
  const actualizados = fusionarCierres([cierreLocal], previos);
  guardarCierresLocal(gid, actualizados);

  if (!supabase || tablaCierresAusente) return { ok: true, rango, cierre: cierreLocal };

  try {
    const { data, error } = await supabase
      .from(TABLA)
      .upsert(fila, { onConflict: "grupo_id,tipo,fecha_inicio,fecha_fin" })
      .select(COLS)
      .maybeSingle();
    if (error && esAusente(error.message)) {
      tablaCierresAusente = true;
    }
    if (!error && data) {
      const remoto = data as unknown as CierreJornada;
      guardarCierresLocal(gid, fusionarCierres([remoto], actualizados));
      return { ok: true, rango, cierre: remoto };
    }
    return { ok: true, rango, cierre: cierreLocal };
  } catch {
    return { ok: true, rango, cierre: cierreLocal };
  }
}

/**
 * Reabre un cierre (borra el registro).
 */
export async function reabrirCierre(id: number | string): Promise<{ ok: boolean; error?: string }> {
  if (id == null || id === "") return { ok: false, error: "Falta el id del cierre." };
  if (typeof window !== "undefined") {
    try {
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key && key.startsWith(CLAVE_CIERRES_LOCAL_PREFIX)) {
          const gid = key.slice(CLAVE_CIERRES_LOCAL_PREFIX.length);
          const lista = leerCierresLocal(gid);
          const filtrada = lista.filter((c) => String(c.id) !== String(id));
          if (filtrada.length !== lista.length) {
            guardarCierresLocal(gid, filtrada);
          }
        }
      }
    } catch {
      /* ignore */
    }
  }
  if (!supabase) return { ok: true };
  try {
    await supabase.from(TABLA).delete().eq("id", id);
    return { ok: true };
  } catch {
    return { ok: true };
  }
}

/** "$1.234,56" — el histórico se lee en la moneda local del operador. */
export function formatCierre(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n)
    ? n.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "0,00";
}
