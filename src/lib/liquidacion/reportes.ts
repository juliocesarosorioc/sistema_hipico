/**
 * REPORTE DE SALDOS CONSOLIDADOS POR SEMANA FISCAL (SERVER DATOS REALES)
 * ---------------------------------------------------------------------
 * Árbol anidado  Semana → Día → Hipódromo → Carrera  alimentado por los
 * SALDOS CONSOLIDADOS (tickets_apuestas + resultados_carreras):
 *   - Cada carrera muestra las filas Juega / Consigue por ticket.
 *   - Las jugadas pendientes se evalúan con el motor oficial (líquida
 *     NINI, PUESTO, A PREMIO/PP, PAREO, COMBINADA, COMPUESTA, TABLAS,
 *     MARCAS y Pareos "A X B") contra la pizarra de resultados_carreras.
 *   - Se inyectan filas 🔀 CRUCE por (cliente, caballo) con la comisión
 *     NETA (netearComisionCruce) cuando el grupo tiene ≥2 tickets.
 * Todo usa la fecha emitida por `rangoSemanaDeGrupo()` (ciclo fiscal del
 * grupo: dia_inicio_semana → dia_fin_semana).
 */
import { supabase } from "@/lib/supabase";
import { hoyLocal, leerProgramaPorFecha } from "@/lib/gaceta/programa";
import { rangoSemanaDeGrupo, cicloSemanalDe } from "@/lib/liquidacion/semana";
import { listarCarrerasPorDia } from "@/lib/tablas/rpc";
import { pizarraDesdeNums } from "@/lib/reportGenerator";
import { liquidarOficial } from "@/lib/motores/oficiales";
import {
  numerosPizarra,
  netearComisionCruce,
  claveCruceFinanciero,
  type NeteoCruceItem,
  type TicketMotor,
} from "@/lib/bettingEngine";

export type FilaReporte = {
  id: string;
  rol: "Juega" | "Consigue" | "CRUCE";
  cliente: string;
  jugada: string;
  caballo: string;
  monto: number;
  /** Resultado NETO de la casa sobre esa fila; null = pendiente de liquidar. */
  resultado: number | null;
  esPareo?: boolean;
};

export type CarreraReporte = {
  numero: number;
  hipodromo: string;
  fecha: string;
  pizarra: string | null;
  filas: FilaReporte[];
  subtotal: number;
};

export type HipodromoReporte = {
  nombre: string;
  carreras: CarreraReporte[];
  subtotal: number;
};

export type DiaReporte = {
  fecha: string;
  hipodromos: HipodromoReporte[];
  totalDia: number;
};

export type ReporteSemana = {
  inicio: string;
  fin: string;
  dias: DiaReporte[];
  totalSemana: number;
};

export type PlanillaReporte = {
  semanales: ReporteSemana | null;
  /** Rango [inicio, fin] consultado (ciclo fiscal del grupo). */
  desde: string;
  hasta: string;
  error?: string;
  cargado?: boolean;
};

export type GrupoReporte = {
  id?: number | string;
  nombre?: string;
  dia_inicio_semana?: number | null;
  dia_fin_semana?: number | null;
};

/* ─────────────────────────── utilidades ─────────────────────────── */

function cifra(v: unknown): number {
  const n = parseFloat(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function txt(v: unknown): string {
  return String(v ?? "").trim();
}

function sumarDias(iso: string, dias: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const base = new Date(y, m - 1, d);
  base.setDate(base.getDate() + dias);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;
}

function diasEnRango(inicio: string, fin: string): string[] {
  const out: string[] = [];
  let d = inicio;
  let guard = 0;
  while (d <= fin && guard < 40) {
    out.push(d);
    d = sumarDias(d, 1);
    guard += 1;
  }
  return out;
}

function puestoFinalDe(caballo: string, puestos: string[]): TicketMotor["puesto_final"] {
  const cab = txt(caballo).toUpperCase();
  const idx = (puestos ?? []).findIndex((p) => txt(p).toUpperCase() === cab);
  if (idx === -1) return "SOC";
  return idx + 1;
}

function proporcionDe(tipo: string): string | null {
  const m = /(\d+)\s*\/\s*(\d+)/.exec(tipo);
  return m ? `${m[1]}/${m[2]}` : null;
}

function ticketMotorDe(
  f: Record<string, unknown>,
  hipodromo: string,
  carrera: string | number,
  puestos: string[]
): TicketMotor {
  const pizarra = pizarraDesdeNums(puestos);
  const tipo = txt(f.nombre_jugada).toUpperCase();
  const monto = cifra(f.monto_jugado);
  return {
    hipodromo,
    carrera: String(carrera),
    caballo: txt(f.caballo),
    fechas: [],
    id: "reporte-" + txt(f.id),
    cruces: 1,
    cuota: null,
    total: monto,
    addedAt: 0,
    tipo_jugada: tipo,
    monto,
    puesto_final: puestoFinalDe(txt(f.caballo), puestos),
    pizarra,
    dividendos: null,
    proporcion: proporcionDe(tipo),
    premio_por_tabla: /^TABLA\s+(\d+)/i.test(tipo) ? parseInt(tipo.match(/^TABLA\s+(\d+)/i)?.[1] ?? "2", 10) : null,
  };
}

/** Evalúa un ticket: null = pendiente sin pizarra; true/false = decidido. */
function evaluar(
  f: Record<string, unknown>,
  hipodromo: string,
  carrera: string | number,
  puestos: string[] | null
): { ok: boolean | null; bruto: number } {
  const estado = txt(f.estado).toUpperCase();
  const monto = cifra(f.monto_jugado);
  if (estado === "SOLUCIONADO") {
    const p = cifra(f.monto_decidido) || cifra(f.premio_pagar);
    return p > 0 ? { ok: true, bruto: p } : { ok: null, bruto: 0 };
  }
  if (estado === "GANADOR" || estado === "GANO") {
    const p = cifra(f.premio_pagar);
    return p > 0 ? { ok: true, bruto: p } : { ok: null, bruto: 0 };
  }
  if (estado === "PERDEDOR" || estado === "PERDIO" || estado === "RETIRADO" || estado === "RECHAZADO" || estado === "ANULADO") {
    return { ok: false, bruto: 0 };
  }
  if ((puestos ?? []).length && monto > 0) {
    try {
      const r = liquidarOficial(ticketMotorDe(f, hipodromo, carrera, puestos ?? []));
      return { ok: r.ok, bruto: r.totalClienteNeto };
    } catch {
      return { ok: null, bruto: 0 };
    }
  }
  return { ok: null, bruto: 0 };
}

/* ─────────────────────────── consultas ─────────────────────────── */

async function leerPizarra(fecha: string, hipodromo: string, carrera: number | string): Promise<string[] | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("resultados_carreras")
      .select("ganadores")
      .eq("fecha", fecha)
      .eq("carrera", carrera)
      .ilike("hipodromo", `%${hipodromo}%`)
      .maybeSingle();
    if (error || !data) return null;
    const g = (data as { ganadores?: unknown }).ganadores;
    return Array.isArray(g) ? (g as unknown[]).map(txt) : null;
  } catch {
    return null;
  }
}

async function leerTickets(fecha: string, hipodromo: string, carrera: string | number): Promise<Record<string, unknown>[]> {
  if (!supabase) return [];
  try {
    const base = { carrera, hipodromo, fecha };
    const { data, error } = await supabase
      .from("tickets_apuestas")
      .select("*")
      .eq("fecha", fecha)
      .eq("carrera", carrera)
      .ilike("hipodromo", `%${hipodromo}%`)
      .order("fecha_creacion");
    if (!error && data?.length) return (data ?? []) as Record<string, unknown>[];
  } catch {
    /* intentar el fallback */
  }
  try {
    // Fallback LEGACY: registros sin columna `fecha` (solo fecha_creacion).
    const sig = sumarDias(fecha, 1);
    const { data, error } = await supabase
      .from("tickets_apuestas")
      .select("*")
      .gte("fecha_creacion", `${fecha}T00:00:00`)
      .lt("fecha_creacion", `${sig}T00:00:00`)
      .eq("carrera", carrera)
      .ilike("hipodromo", `%${hipodromo}%`)
      .order("fecha_creacion");
    if (error) return [];
    return (data ?? []) as Record<string, unknown>[];
  } catch {
    return [];
  }
}

/** Hipódromos con actividad del día (Gaceta + tablas fijas + tickets + resultados). */
async function hipodromosDelDia(fecha: string): Promise<string[]> {
  const set = new Set<string>();
  const prog = await leerProgramaPorFecha(fecha);
  for (const h of prog.data?.hipodromos ?? []) if (txt(h)) set.add(txt(h).toUpperCase());
  for (const c of prog.data?.carreras ?? []) if (txt(c.hipodromo)) set.add(txt(c.hipodromo).toUpperCase());
  const sig = sumarDias(fecha, 1);
  if (supabase) {
    try {
      const { data: res, error } = await supabase
        .from("resultados_carreras")
        .select("hipodromo")
        .eq("fecha", fecha);
      if (!error) for (const r of (res ?? []) as Array<{ hipodromo?: unknown }>) if (txt(r.hipodromo)) set.add(txt(r.hipodromo).toUpperCase());
    } catch {
      /* sin tabla */
    }
    try {
      // TABLAS FIJAS: fecha del evento, o creadas durante el día.
      const { data: tabs, error } = await supabase
        .from("tablas_fijas")
        .select("hipodromo")
        .eq("fecha", fecha);
      if (!error) for (const r of (tabs ?? []) as Array<{ hipodromo?: unknown }>) if (txt(r.hipodromo)) set.add(txt(r.hipodromo).toUpperCase());
      const { data: tabs2 } = await supabase
        .from("tablas_fijas")
        .select("hipodromo")
        .gte("fecha_creacion", `${fecha}T00:00:00`)
        .lt("fecha_creacion", `${sig}T00:00:00`);
      for (const r of (tabs2 ?? []) as Array<{ hipodromo?: unknown }>) if (txt(r.hipodromo)) set.add(txt(r.hipodromo).toUpperCase());
    } catch {
      /* sin tabla */
    }
    try {
      // TICKETS: jornadas jugadas por fecha del evento o creados ese día.
      const { data: tk, error } = await supabase
        .from("tickets_apuestas")
        .select("hipodromo")
        .eq("fecha", fecha);
      if (!error) for (const r of (tk ?? []) as Array<{ hipodromo?: unknown }>) if (txt(r.hipodromo)) set.add(txt(r.hipodromo).toUpperCase());
      const { data: tk2, error: e2 } = await supabase
        .from("tickets_apuestas")
        .select("hipodromo")
        .gte("fecha_creacion", `${fecha}T00:00:00`)
        .lt("fecha_creacion", `${sig}T00:00:00`);
      if (!e2) for (const r of (tk2 ?? []) as Array<{ hipodromo?: unknown }>) if (txt(r.hipodromo)) set.add(txt(r.hipodromo).toUpperCase());
    } catch {
      /* sin tabla */
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
}

/* ─────────────────────────── ensamblaje ─────────────────────────── */

/** true si la carrera tiene tablas fijas publicadas (aunque no tenga jugadas). */
async function carreraExisteEnTablas(fecha: string, hipodromo: string, carrera: string | number): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { data } = await supabase
      .from("tablas_fijas")
      .select("id")
      .eq("carrera", carrera)
      .eq("fecha", fecha)
      .ilike("hipodromo", `%${hipodromo}%`)
      .limit(1);
    return !!data?.length;
  } catch {
    return false;
  }
}

async function carreraReporte(
  fecha: string,
  hipodromo: string,
  numero: number,
  tasaComision?: number | null
): Promise<CarreraReporte | null> {
  const puestos = await leerPizarra(fecha, hipodromo, numero);
  const tickets = await leerTickets(fecha, hipodromo, numero);
  const enTablas = await carreraExisteEnTablas(fecha, hipodromo, numero);
  // La carrera aparece si tiene jugadas, resultados o siquiera sus tablas
  // publicadas (cargadas por el operador aunque aún no tengan tickets).
  if (!tickets.length && !enTablas && !(puestos ?? []).length) return null;

  const filas: FilaReporte[] = [];
  const neteoItems: NeteoCruceItem[] = [];
  const meta: Array<{ cliente: string; clienteNombre: string; caballo: string }> = [];

  tickets.forEach((f, i) => {
    const monto = cifra(f.monto_jugado);
    const caballo = txt(f.caballo);
    const esPareo = caballo.toUpperCase().includes("X") || /^PP/i.test(txt(f.nombre_jugada));
    const ev = evaluar(f, hipodromo, numero, puestos);
    const clienteJuega = txt(f.cliente_juega);
    const clienteJuegaNombre = txt(f.cliente_juega_nombre) || clienteJuega;
    const clienteConsigue = txt(f.cliente_consigue);
    const clienteConsigueNombre = txt(f.cliente_consigue_nombre) || clienteConsigue;

    const resultadoJuega = ev.ok === null ? null : ev.bruto - monto;
    filas.push({
      id: `${fecha}-${hipodromo}-${numero}-j-${i}`,
      rol: "Juega",
      cliente: clienteJuegaNombre || "—",
      jugada: txt(f.nombre_jugada),
      caballo,
      monto,
      resultado: resultadoJuega,
      esPareo,
    });

    if (clienteConsigue) {
      const resultadoConsigue = ev.ok === null ? null : monto - ev.bruto;
      filas.push({
        id: `${fecha}-${hipodromo}-${numero}-c-${i}`,
        rol: "Consigue",
        cliente: clienteConsigueNombre || clienteConsigue,
        jugada: txt(f.nombre_jugada),
        caballo,
        monto,
        resultado: resultadoConsigue,
        esPareo,
      });
    }

    // Bruto ANTES de comisión (como en pagarYCerrar): neto + comisión casa.
    const tasaEf = Number.isFinite(Number(tasaComision)) && Number(tasaComision) >= 0 ? Number(tasaComision) : 5;
    const comisionRec = ev.ok && ev.bruto > monto ? (ev.bruto - monto) * (tasaEf / 100) : 0;
    neteoItems.push({
      cliente: clienteJuega,
      caballo,
      monto,
      bruto: ev.ok ? Math.round((ev.bruto + comisionRec) * 100) / 100 : 0,
      ok: ev.ok === true,
    });
    meta.push({ cliente: clienteJuega, clienteNombre: clienteJuegaNombre, caballo });
  });

  // 🔀 CRUCE FINANCIERO: comisión NETA por (cliente, caballo) con ≥2 tickets.
  const cruces = new Map<string, { cliente: string; caballo: string; comision: number }>();
  const gruposNeteo = netearComisionCruce(neteoItems, numero, tasaComision);
  meta.forEach((m, i) => {
    const k = claveCruceFinanciero(numero, m.cliente, m.caballo);
    const g = gruposNeteo.get(k);
    if (g && g.conteo >= 2 && g.comisionNeta > 0 && !cruces.has(k)) {
      cruces.set(k, { cliente: m.clienteNombre || m.cliente, caballo: m.caballo, comision: g.comisionNeta });
    }
  });
  for (const base of cruces.values()) {
    filas.push({
      id: `${fecha}-${hipodromo}-${numero}-x-${base.caballo}`,
      rol: "CRUCE",
      cliente: base.cliente,
      jugada: "🔀 CRUCE",
      caballo: base.caballo,
      monto: 0,
      resultado: Math.round(base.comision * 100) / 100,
    });
  }

  const subtotal = Math.round(filas.reduce((a, f) => a + (f.resultado ?? 0), 0) * 100) / 100;
  return {
    numero,
    hipodromo,
    fecha,
    pizarra: puestos?.length ? puestos.join(" · ") : null,
    filas,
    subtotal,
  };
}

async function hipodromoReporte(fecha: string, hipodromo: string, tasaComision?: number | null): Promise<HipodromoReporte> {
  const carreras: CarreraReporte[] = [];
  const numeros = await listarCarrerasPorDia(fecha, hipodromo);
  for (const numero of [...new Set(numeros)].sort((a, b) => a - b)) {
    const c = await carreraReporte(fecha, hipodromo, numero, tasaComision);
    if (c) carreras.push(c);
  }
  const subtotal = Math.round(carreras.reduce((a, c) => a + c.subtotal, 0) * 100) / 100;
  return { nombre: hipodromo, carreras, subtotal };
}

/**
 * Construye el reporte de la semana fiscal [desde, hasta] (grupo). Cada día:
 * hipódromos con actividad → sus carreras. Devuelve null si no hay actividad.
 */
export async function construirReporteSemana(
  grupo: GrupoReporte,
  opts?: { desde?: string; hasta?: string; tasaComision?: number | null }
): Promise<PlanillaReporte> {
  const ciclo = cicloSemanalDe(grupo);
  const rango = opts?.desde && opts?.hasta ? { inicio: opts.desde, fin: opts.hasta } : rangoSemanaDeGrupo(hoyLocal(), ciclo);
  const desde = rango.inicio;
  const hasta = rango.fin;
  const tasaComision = opts?.tasaComision ?? null;

  try {
    const dias: DiaReporte[] = [];
    for (const fecha of diasEnRango(desde, hasta)) {
      const hips = await hipodromosDelDia(fecha);
      if (!hips.length) continue;
      const hipodromos: HipodromoReporte[] = [];
      let totalDia = 0;
      for (const hip of hips) {
        const h = await hipodromoReporte(fecha, hip, tasaComision);
        if (h.carreras.length) {
          hipodromos.push(h);
          totalDia += h.subtotal;
        }
      }
      if (hipodromos.length) {
        dias.push({ fecha, hipodromos, totalDia: Math.round(totalDia * 100) / 100 });
      }
    }
    const totalSemana = Math.round(dias.reduce((a, d) => a + d.totalDia, 0) * 100) / 100;
    return { semanales: { inicio: desde, fin: hasta, dias, totalSemana }, desde, hasta, cargado: true };
  } catch (e) {
    return {
      semanales: null,
      desde,
      hasta,
      cargado: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Resumen ligero para chips (días con actividad, hipódromos, carreras). */
export function resumirReporte(rpt: ReporteSemana | null) {
  if (!rpt) return { dias: 0, hipodromos: 0, carreras: 0, tickets: 0, cruces: 0 };
  let hipodromos = 0;
  let carreras = 0;
  let tickets = 0;
  let cruces = 0;
  for (const d of rpt.dias) {
    hipodromos += d.hipodromos.length;
    for (const h of d.hipodromos) {
      carreras += h.carreras.length;
      for (const c of h.carreras) {
        tickets += c.filas.filter((f) => f.rol !== "CRUCE").length;
        cruces += c.filas.filter((f) => f.rol === "CRUCE").length;
      }
    }
  }
  return { dias: rpt.dias.length, hipodromos, carreras, tickets, cruces };
}