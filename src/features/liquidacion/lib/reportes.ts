/**
 * REPORTE DE SALDOS CONSOLIDADOS POR SEMANA FISCAL (SERVER DATOS REALES)
 * ---------------------------------------------------------------------
 * Árbol anidado  Semana → Día → Hipódromo → Carrera  alimentado por los
 * SALDOS CONSOLIDADOS (tickets_apuestas + resultados_carreras):
 *   - Cada carrera muestra las filas Juega / Consigue por ticket.
 *   - Las jugadas pendientes se evalúan con el motor oficial (líquida
 *     NINI, PUESTO, A PREMIO/PP, PAREO, COMBINADA, COMPUESTA, TABLAS,
 *     Pareos "A X B") contra la pizarra de resultados_carreras.
 *   - Se inyectan filas 🔀 CRUCE por (cliente, caballo) con la comisión
 *     NETA (netearComisionCruce) cuando el grupo tiene ≥2 tickets.
 * Todo usa la fecha emitida por `rangoSemanaDeGrupo()` (ciclo fiscal del
 * grupo: dia_inicio_semana → dia_fin_semana).
 */
import { supabase } from "@/core/supabase";
import { hoyLocal, leerProgramaPorFecha } from "@/features/gaceta/lib/programa";
import { rangoSemanaDeGrupo, cicloSemanalDe } from "@/features/liquidacion/lib/semana";
import { filtroDiaJornada } from "@/features/liquidacion/lib/fecha";
import { listarCarrerasPorDia } from "@/features/tablas/lib/rpc";
import { pizarraDesdeNums, esVentaDeRemate } from "@/features/impresion/lib/reportGenerator";
import { liquidarOficial, puestosDesdeOrdenLlegada } from "@/features/motores/lib/oficiales";
import {
  numerosPizarra,
  netearComisionCruce,
  claveCruceFinanciero,
  type NeteoCruceItem,
  type TicketMotor,
} from "@/features/betting/lib/bettingEngine";
import { esPrincipalVigente, grupoActivoVigente, veTodosLosGruposVigente } from "@/features/seguridad/lib/vigente";

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
  /**
   * Inicio de la semana vigente del grupo. NULL = se deduce de hoy.
   * Ver `src/lib/liquidacion/semana.ts` y sql/semana_vigente.sql.
   */
  semana_vigente_inicio?: string | null;
};

/* ─────────────────────────── utilidades ─────────────────────────── */

function cifra(v: unknown): number {
  const n = parseFloat(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function txt(v: unknown): string {
  return String(v ?? "").trim();
}

/**
 * Clave canónica de n° de carrera para agrupar en memoria. `resultados_carreras`
 * y `tickets_apuestas` pueden guardar la carrera como número o como texto
 * ("1" / 1 / "01"); el emparejamiento por `.eq("carrera", …)` de la BD los
 * iguala, así que el agrupado en JS también debe hacerlo.
 */
function claveCarrera(v: unknown): string {
  const s = txt(v);
  if (s === "") return "";
  const n = Number(s);
  return Number.isFinite(n) ? String(n) : s;
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
  puestos: string[],
  dividendos: Record<string, number> | null
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
    // Sin esto el motor oficial liquidaba siempre a la par de la casa (2x/120x):
    // los dividendos que carga la casa se guardaban y NADIE los leia.
    dividendos,
    proporcion: proporcionDe(tipo),
    premio_por_tabla: /^TABLA\s+(\d+)/i.test(tipo) ? parseInt(tipo.match(/^TABLA\s+(\d+)/i)?.[1] ?? "2", 10) : null,
  };
}

/** Evalúa un ticket: null = pendiente sin pizarra; true/false = decidido. */
function evaluar(
  f: Record<string, unknown>,
  hipodromo: string,
  carrera: string | number,
  pizarra: PizarraCarrera | null,
  tasaComision?: number | null
): { ok: boolean | null; bruto: number; comision: number; tasa: number } {
  const estado = txt(f.estado).toUpperCase();
  const monto = cifra(f.monto_jugado);
  const nombreJugada = txt(f.nombre_jugada).toUpperCase();
  const esTablaFija = nombreJugada.startsWith("TABLA FIJA");
  // Tasa de comisión EFECTIVA del ticket: la propia es la que manda; solo si
  // falta se usa la del grupo (o 5% por defecto). Es la MISMA prioridad que usa
  // la relación de WhatsApp (`balanceDesdePizarra` → `j.comisionPct`), que era
  // justo la que antes NO se le pasaba al motor en la vía de tickets PENDIENTES:
  // el reporte liquidaba con la tasa por defecto y el mensaje con la del ticket,
  // y de ahí que suministraran importes distintos.
  // Un 0% EXPLÍCITO en el ticket es válido (`pct > 0` lo confundía con "falta
  // el dato" y lo subía al default). Solo se respalda si el campo viene
  // ausente/vacío, nunca por valer 0.
  const tienePct =
    f.comision_porcentaje != null && String(f.comision_porcentaje).trim() !== "";
  const pct = cifra(f.comision_porcentaje);
  const tasaEfectiva = tienePct
    ? pct
    : Number.isFinite(Number(tasaComision)) && Number(tasaComision) >= 0
      ? Number(tasaComision)
      : 5;
  // `premio_pagar` / `monto_decidido` se persisten BRUTOS (capital + ganancia,
  // como los escriben la liquidación legacy y `aplicarLiquidacionSaldos`). Este
  // reporte trabaja internamente con el NETO del ganador (lo que recibe) y con
  // la COMISIÓN retenida sobre la ganancia bruta, así el "da" (Consigue) y el
  // resumen Ganan/Pierden cuadran con la relación de WhatsApp.
  const desglosar = (brutoGuardado: number): { neto: number; comision: number } => {
    if (brutoGuardado <= 0) return { neto: 0, comision: 0 };
    if (monto <= 0) return { neto: brutoGuardado, comision: 0 };
    const gananciaBruta = brutoGuardado - monto;
    if (gananciaBruta <= 0) return { neto: brutoGuardado, comision: 0 };
    const comision = Math.round(gananciaBruta * (tasaEfectiva / 100) * 100) / 100;
    return { neto: Math.round((brutoGuardado - comision) * 100) / 100, comision };
  };
  if (estado === "SOLUCIONADO") {
    const d = desglosar(cifra(f.monto_decidido) || cifra(f.premio_pagar));
    return d.neto > 0
      ? { ok: true, bruto: d.neto, comision: d.comision, tasa: tasaEfectiva }
      : { ok: null, bruto: 0, comision: 0, tasa: tasaEfectiva };
  }
  if (estado === "GANADOR" || estado === "GANO") {
    const d = desglosar(cifra(f.premio_pagar));
    return d.neto > 0
      ? { ok: true, bruto: d.neto, comision: d.comision, tasa: tasaEfectiva }
      : { ok: null, bruto: 0, comision: 0, tasa: tasaEfectiva };
  }
  if (esTablaFija && (estado === "PERDEDOR" || estado === "PERDIO")) {
    // Tablas fijas: el fallo del legacy NO marcaba el Nº de ejemplar ("TABLA FIJA (HIPO Cn)")
    // y los dejaba 'Perdedor' con premio 0 cuando sí podían ser ganadoras. La decisión
    // correcta la toma `club_liquidar_tabla_fija` (ejemplar exacto). En el reporte
    // NO forzamos false: los tickets PERDEDOR de tabla fija deben seguir evaluándose
    // contra la pizarra con el ejemplar, para que "9" aparezca como ganador.
    // No hacer nada aquí: cae al motor oficial si hay pizarra.
  }
  if (estado === "PERDEDOR" || estado === "PERDIO" || estado === "RETIRADO" || estado === "RECHAZADO" || estado === "ANULADO") {
    if (esTablaFija && (estado === "PERDEDOR" || estado === "PERDIO")) {
      // ya tratamos: no retornar false automático
    } else {
      return { ok: false, bruto: 0, comision: 0, tasa: tasaEfectiva };
    }
  }
  const puestos = pizarra?.puestos ?? [];
  if (puestos.length && monto > 0) {
    try {
      const r = liquidarOficial(
        ticketMotorDe(f, hipodromo, carrera, puestos, pizarra?.dividendos ?? null),
        tasaEfectiva
      );
      // El motor ganó por posición pero no hay dividendo con el que cuantificar
      // el premio: es PENDIENTE, no una derrota. Contarlo como `ok: false`
      // reportaba $0 pagado sobre una jugada que la casa tiene que pagar.
      if (r.indeterminado) return { ok: null, bruto: 0, comision: 0, tasa: tasaEfectiva };
      return { ok: r.ok, bruto: r.totalClienteNeto, comision: r.gananciaCasa, tasa: tasaEfectiva };
    } catch {
      return { ok: null, bruto: 0, comision: 0, tasa: tasaEfectiva };
    }
  }
  return { ok: null, bruto: 0, comision: 0, tasa: tasaEfectiva };
}

/**
 * Resultado NETO del "da" (Consigue) de un ticket, en la MISMA convención que la
 * relación de WhatsApp (`relacionResultados`):
 *   · Si el que JUEGA acierta, el "da" entrega la ganancia BRUTA (el neto del
 *     jugador MÁS la comisión de la casa).
 *   · Si el que JUEGA pierde, el "da" cobra el monto MENOS la comisión.
 *   · ANULADA (devolución de capital): `bruto` = monto y `comision` = 0 → 0.
 * Antes se hacía `monto − bruto` (el neto del jugador), así que a los ganadores
 * del lado "da" NO se les descontaba la comisión y el reporte mostraba un monto
 * distinto al de WhatsApp.
 */
export function resultadoConsigueDe(
  monto: number,
  ev: { ok: boolean | null; bruto: number; comision: number; tasa: number }
): number | null {
  if (ev.ok === null) return null;
  if (ev.bruto > 0) return Math.round((monto - ev.bruto - ev.comision) * 100) / 100;
  return Math.round((monto - monto * (ev.tasa / 100)) * 100) / 100;
}

/* ─────────────────────────── consultas ─────────────────────────── */

/** Pizarra oficial de una carrera tal como la cargo la casa. */
type PizarraCarrera = {
  /** Orden de llegada (1º, 2º, 3º…): `orden_llegada` si existe, si no `ganadores`. */
  puestos: string[];
  /** Pagos por $1 (`dividendos`): los usa el motor oficial de liquidacion. */
  dividendos: Record<string, number> | null;
};

/** Normaliza una fila de `resultados_carreras` a la pizarra que usa el motor. */
function normalizarPizarra(r: { ganadores?: unknown; orden_llegada?: unknown; dividendos?: unknown }): PizarraCarrera | null {
  // `orden_llegada` es [{numero,puesto}] y `ganadores` es text[]; el
  // normalizador entiende ambas formas además del mapa {puesto: ejemplar}.
  // Se prefiere el orden oficial y se cae a ganadores para no perder las
  // carreras cargadas antes de que existiera la columna.
  const oficial = puestosDesdeOrdenLlegada(r.orden_llegada);
  const puestos = oficial.length ? oficial : puestosDesdeOrdenLlegada(r.ganadores);
  const div = r.dividendos;
  const dividendos =
    div && typeof div === "object" && !Array.isArray(div) ? (div as Record<string, number>) : null;
  if (!puestos.length && !dividendos) return null;
  return { puestos, dividendos };
}

async function leerPizarra(fecha: string, hipodromo: string, carrera: number | string): Promise<PizarraCarrera | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("resultados_carreras")
      .select("ganadores, orden_llegada, dividendos")
      .eq("fecha", fecha)
      .eq("carrera", carrera)
      .ilike("hipodromo", `%${hipodromo}%`)
      .maybeSingle();
    if (error || !data) return null;
    return normalizarPizarra(data as { ganadores?: unknown; orden_llegada?: unknown; dividendos?: unknown });
  } catch {
    return null;
  }
}

async function leerTickets(fecha: string, hipodromo: string, carrera: string | number): Promise<Record<string, unknown>[]> {
  if (!supabase) return [];
  const dia = String(fecha ?? "").slice(0, 10);
  try {
    let q = supabase
      .from("tickets_apuestas")
      .select("*")
      // El día de la jugada es el de la CARRERA, no el de la venta (ver
      // `filtroDiaJornada`).
      .or(filtroDiaJornada(dia))
      .eq("carrera", carrera)
      .ilike("hipodromo", `%${hipodromo}%`)
      .order("fecha_registro");
    const activo = grupoActivoVigente();
    if (esPrincipalVigente() && activo) {
      q = q.eq("grupo_cobro_id", activo);
    } else if (!esPrincipalVigente()) {
      if (activo) q = q.eq("grupo_cobro_id", activo);
      // if no active group, RLS applies
    }
    const { data, error } = await q;
    if (error) return [];
    return (data ?? []).filter(
      (r) => !esVentaDeRemate((r as { nombre_jugada?: unknown }).nombre_jugada)
    ) as Record<string, unknown>[];
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
      // TICKETS: por el día de la CARRERA (`fecha_carrera`); las filas heredadas
      // sin la columna caen al día local de la venta (`fecha_registro`). `fecha`
      // y `fecha_creacion` no existen en `tickets_apuestas`.
      const dia = String(fecha ?? "").slice(0, 10);
      const { data: tk2, error: e2 } = await supabase
        .from("tickets_apuestas")
        .select("hipodromo")
        .or(filtroDiaJornada(dia));
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

/** Datos ya leídos para una carrera: permite liquidar sin tocar la BD. */
type DatosCarrera = {
  pizarra: PizarraCarrera | null;
  tickets: Record<string, unknown>[];
  enTablas: boolean;
};

/**
 * Lecturas por HIPÓDROMO (no por carrera). Es el antídoto del N+1 de
 * `construirReporteSemana`: antes cada carrera disparaba 3 consultas
 * (`leerPizarra` + `leerTickets` + `carreraExisteEnTablas`); con una jornada de
 * decenas de carreras eso sumaba cientos de viajes. Ahora se lee TODO el
 * hipódromo en 3 consultas y se reparte en memoria por n° de carrera.
 */
async function leerTicketsHipodromo(fecha: string, hipodromo: string): Promise<Map<string, Record<string, unknown>[]>> {
  const porCarrera = new Map<string, Record<string, unknown>[]>();
  if (!supabase) return porCarrera;
  const dia = String(fecha ?? "").slice(0, 10);
  try {
    let q = supabase
      .from("tickets_apuestas")
      .select("*")
      // Día de la CARRERA (`fecha_carrera`); heredadas sin la columna caen a la
      // ventana local de la venta. Ver `filtroDiaJornada`.
      .or(filtroDiaJornada(dia))
      .ilike("hipodromo", `%${hipodromo}%`)
      .order("fecha_registro");
    const activo = grupoActivoVigente();
    if (esPrincipalVigente() && activo) {
      q = q.eq("grupo_cobro_id", activo);
    } else if (!esPrincipalVigente()) {
      if (activo) q = q.eq("grupo_cobro_id", activo);
    }
    const { data, error } = await q;
    if (error) return porCarrera;
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      if (esVentaDeRemate(row.nombre_jugada)) continue;
      const k = claveCarrera(row.carrera);
      const lista = porCarrera.get(k);
      if (lista) lista.push(row);
      else porCarrera.set(k, [row]);
    }
    return porCarrera;
  } catch {
    return porCarrera;
  }
}

async function leerPizarrasHipodromo(fecha: string, hipodromo: string): Promise<Map<string, PizarraCarrera | null>> {
  const porCarrera = new Map<string, PizarraCarrera | null>();
  if (!supabase) return porCarrera;
  try {
    const { data, error } = await supabase
      .from("resultados_carreras")
      .select("carrera, ganadores, orden_llegada, dividendos")
      .eq("fecha", fecha)
      .ilike("hipodromo", `%${hipodromo}%`);
    if (error) return porCarrera;
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const k = claveCarrera(row.carrera);
      if (!porCarrera.has(k)) porCarrera.set(k, normalizarPizarra(row));
    }
    return porCarrera;
  } catch {
    return porCarrera;
  }
}

async function leerTablasHipodromo(fecha: string, hipodromo: string): Promise<Set<string>> {
  const numeros = new Set<string>();
  if (!supabase) return numeros;
  try {
    const { data, error } = await supabase
      .from("tablas_fijas")
      .select("carrera")
      .eq("fecha", fecha)
      .ilike("hipodromo", `%${hipodromo}%`);
    if (error) return numeros;
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const k = claveCarrera(row.carrera);
      if (k) numeros.add(k);
    }
    return numeros;
  } catch {
    return numeros;
  }
}

async function carreraReporte(
  fecha: string,
  hipodromo: string,
  numero: number,
  tasaComision?: number | null,
  datos?: DatosCarrera
): Promise<CarreraReporte | null> {
  const pizarra = datos ? datos.pizarra : await leerPizarra(fecha, hipodromo, numero);
  const tickets = datos ? datos.tickets : await leerTickets(fecha, hipodromo, numero);
  const enTablas = datos ? datos.enTablas : await carreraExisteEnTablas(fecha, hipodromo, numero);
  // La carrera aparece si tiene jugadas, resultados o siquiera sus tablas
  // publicadas (cargadas por el operador aunque aún no tengan tickets).
  if (!tickets.length && !enTablas && !pizarra?.puestos.length) return null;

  const filas: FilaReporte[] = [];
  const neteoItems: NeteoCruceItem[] = [];
  const meta: Array<{ cliente: string; clienteNombre: string; caballo: string }> = [];

  tickets.forEach((f, i) => {
    const monto = cifra(f.monto_jugado);
    const caballo = txt(f.caballo);
    const esPareo = caballo.toUpperCase().includes("X") || /^PP/i.test(txt(f.nombre_jugada));
    const ev = evaluar(f, hipodromo, numero, pizarra, tasaComision);
    // `tickets_apuestas` NO tiene `cliente_juega` / `cliente_consigue`: son
    // `cliente_juega_id|_nombre` y `cliente_consigue_id|_nombre`. Leer las
    // columnas inexistentes dejaba `clienteConsigue` SIEMPRE vacío, así que
    // `if (clienteConsigue)` nunca creaba la fila del que CONSIGUE (el "DA"):
    // el reporte no mostraba a los que dan y esa mitad del resumen (los
    // ganadores del pareo) desaparecía de Ganan. El id del que JUEGA se deja
    // como estaba para no activar el CRUCE financiero (feature pendiente).
    const clienteJuega = txt(f.cliente_juega);
    const clienteJuegaNombre = txt(f.cliente_juega_nombre) || txt(f.cliente_juega_id) || clienteJuega;
    const clienteConsigue = txt(f.cliente_consigue_nombre) || txt(f.cliente_consigue_id);
    const clienteConsigueNombre = txt(f.cliente_consigue_nombre) || clienteConsigue;

    const resultadoJuega = ev.ok === null ? null : Math.round((ev.bruto - monto) * 100) / 100;
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
      filas.push({
        id: `${fecha}-${hipodromo}-${numero}-c-${i}`,
        rol: "Consigue",
        cliente: clienteConsigueNombre || clienteConsigue,
        jugada: txt(f.nombre_jugada),
        caballo,
        monto,
        resultado: resultadoConsigueDe(monto, ev),
        esPareo,
      });
    }

    // Bruto ANTES de comisión (como en pagarYCerrar): neto + comisión casa.
    neteoItems.push({
      cliente: clienteJuega,
      caballo,
      monto,
      bruto: ev.ok ? Math.round((ev.bruto + ev.comision) * 100) / 100 : 0,
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
  const puestos = pizarra?.puestos ?? [];
  return {
    numero,
    hipodromo,
    fecha,
    pizarra: puestos.length ? puestos.join(" · ") : null,
    filas,
    subtotal,
  };
}

/**
 * Reporte de UNA carrera (hipódromo + fecha + n°): filas liquidadas + pizarra
 * oficial, con el MISMO motor de neteo que el consolidado. Es la fuente del
 * «Reporte de Liquidación» (plantilla ReporteCarrera) tanto del selector de
 * Saldos/Reportes como del «Ver Reporte» de PagarCarreraModal apenas se paga.
 */
export async function carreraReporteDetalle(
  fecha: string,
  hipodromo: string,
  numero: number | string,
  tasaComision?: number | null
): Promise<CarreraReporte | null> {
  return carreraReporte(fecha, hipodromo, Number(numero), tasaComision);
}

/**
 * Reportes de VARIAS carreras de una misma jornada en un solo lote de consultas.
 *
 * El Historial pedía el detalle de hasta 40 carreras y cada una disparaba 3
 * consultas (~120 por día). Aquí se agrupan por hipódromo y se reutilizan las
 * lecturas por hipódromo (`leerTicketsHipodromo`, …): ~4 consultas por hipódromo
 * en vez de 3 por carrera. Devuelve un array en el MISMO orden que `items`.
 */
export async function reportesCarrerasLote(
  items: Array<{ fecha: string; hipodromo: string; carrera: number | string }>,
  tasaComision?: number | null
): Promise<Array<CarreraReporte | null>> {
  const salida = new Array<CarreraReporte | null>(items.length).fill(null);
  const grupos = new Map<string, number[]>();
  items.forEach((it, i) => {
    const k = `${it.fecha}\u0000${txt(it.hipodromo).toUpperCase()}`;
    const lista = grupos.get(k);
    if (lista) lista.push(i);
    else grupos.set(k, [i]);
  });

  await Promise.all(
    [...grupos.values()].map(async (indices) => {
      const primera = items[indices[0]];
      const [ticketsPorCarrera, pizarrasPorCarrera, tablasPorCarrera] = await Promise.all([
        leerTicketsHipodromo(primera.fecha, primera.hipodromo),
        leerPizarrasHipodromo(primera.fecha, primera.hipodromo),
        leerTablasHipodromo(primera.fecha, primera.hipodromo),
      ]);
      for (const i of indices) {
        const it = items[i];
        const k = claveCarrera(it.carrera);
        salida[i] = await carreraReporte(it.fecha, it.hipodromo, Number(it.carrera), tasaComision, {
          pizarra: pizarrasPorCarrera.get(k) ?? null,
          tickets: ticketsPorCarrera.get(k) ?? [],
          enTablas: tablasPorCarrera.has(k),
        });
      }
    })
  );

  return salida;
}

async function hipodromoReporte(fecha: string, hipodromo: string, tasaComision?: number | null): Promise<HipodromoReporte> {
  const carreras: CarreraReporte[] = [];
  const numeros = [...new Set(await listarCarrerasPorDia(fecha, hipodromo))].sort((a, b) => a - b);
  // 3 consultas para TODO el hipódromo (no 3 por carrera): ver
  // `leerTicketsHipodromo`. Es el fix del N+1 del reporte semanal.
  const [ticketsPorCarrera, pizarrasPorCarrera, tablasPorCarrera] = await Promise.all([
    leerTicketsHipodromo(fecha, hipodromo),
    leerPizarrasHipodromo(fecha, hipodromo),
    leerTablasHipodromo(fecha, hipodromo),
  ]);
  for (const numero of numeros) {
    const k = claveCarrera(numero);
    const c = await carreraReporte(fecha, hipodromo, numero, tasaComision, {
      pizarra: pizarrasPorCarrera.get(k) ?? null,
      tickets: ticketsPorCarrera.get(k) ?? [],
      enTablas: tablasPorCarrera.has(k),
    });
    if (c) carreras.push(c);
  }
  const subtotal = Math.round(carreras.reduce((a, c) => a + c.subtotal, 0) * 100) / 100;
  return { nombre: hipodromo, carreras, subtotal };
}

/**
 * Resuelve el rango [desde, hasta] de un reporte mezclando los extremos que
 * fijó el usuario con el ciclo fiscal del grupo (`base`).
 *
 * Regla: cada extremo es INDEPENDIENTE. Si falta `desde`, se usa `base.inicio`;
 * si falta `hasta`, `base.fin`. Un rango invertido se ordena para no devolver
 * nunca una planilla vacía por accidente. Es puro (sin BD) para poder testearlo.
 */
export function rangoReporteDe(
  base: { inicio: string; fin: string },
  opts?: { desde?: string; hasta?: string }
): { desde: string; hasta: string } {
  let desde = opts?.desde || base.inicio;
  let hasta = opts?.hasta || base.fin;
  if (desde > hasta) [desde, hasta] = [hasta, desde];
  return { desde, hasta };
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
  // Cada extremo del rango es INDEPENDIENTE: si el usuario fija solo el "desde"
  // (o solo el "hasta"), el extremo vacío cae al ciclo fiscal del grupo. Antes
  // el rango exigía AMBOS; con uno solo se ignoraba TODO y el reporte volvía a
  // la semana completa — por eso parecía que el filtro se "borraba".
  const base = rangoSemanaDeGrupo(hoyLocal(), ciclo);
  const { desde, hasta } = rangoReporteDe(base, opts);
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