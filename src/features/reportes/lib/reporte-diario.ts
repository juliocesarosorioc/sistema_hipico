/**
 * Reporte Diario y por Carrera — cálculo y lectura.
 *
 * Fuente ÚNICA del cálculo (KPIs, tabla por carrera y pie de totales) que
 * comparten el módulo del personal (`/reporte-diario`) y el Portal del Cliente.
 * El armado es lógica PURA (sin Supabase) para poder testearlo: recibe jugadas
 * ya normalizadas y devuelve las filas y los totales.
 *
 * Reglas de negocio (confirmadas por la casa):
 *  - Total Jugado   = suma de `monto_jugado` de las jugadas NO anuladas.
 *  - Total Premios  = suma del premio (`premio_pagar`, con `premio_por_tabla`
 *                     como respaldo).
 *  - Devolución     = % de Incentivo configurado a CADA cliente, aplicado sobre
 *                     el monto DECIDIDO de la carrera (mismo cálculo que el
 *                     estado de cuenta: base * devolucion / 100).
 *  - Balance Neto   = Total Jugado − Total Premios − Devolución.
 *
 * La FECHA del reporte es la fecha de la CARRERA (`fecha_carrera`), con respaldo
 * `fecha_registro::date` para las filas heredadas sin fecha de carrera: los
 * reportes del sistema leen ahí (ver `sql/fecha_carrera_tickets.sql`).
 *
 * Alcance por rol: la lectura intenta la RPC `club_reporte_diario`, que fuerza
 * el grupo del usuario en el SERVIDOR (auth.uid()). Si esa RPC todavía no está
 * aplicada, cae a una consulta directa a `tickets_apuestas`, donde la frontera
 * sigue siendo el RLS por grupo (`sql/rls_por_grupo.sql`). En ningún caso el
 * navegador es la última palabra: la base aísla por grupo/cliente.
 */
import { supabase } from "@/core/supabase";
import { extraerFechaCarreraTicket, filtroDiaJornada } from "@/features/liquidacion/lib/fecha";
import {
  buscarPizarraEnMapa,
  desglosarTicketEnFilasUnificadas,
  leerJugadasModulosExtrasHipodromo,
  leerPizarrasPorFechas,
  type PizarraCarrera,
} from "@/features/liquidacion/lib/reportes";
import { _reembolsosCruce } from "@/features/taquilla/lib/cruces-y-tapas";
import { aplicarDevolucionIncentivoAFavor, calcularResumenContableCliente } from "@/features/saldos/lib/contabilidad-central";

export { aplicarDevolucionIncentivoAFavor, calcularResumenContableCliente };

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/** Detalle de una jugada individual dentro de una carrera en la Tabla Dinámica. */
export type DetalleJugadaReporteDiario = {
  id: string;
  fecha: string;
  horaCarga?: string | null;
  rol?: "Juega" | "Consigue";
  cliente: string;
  jugada: string;
  caballo: string;
  montoJugado: number;
  premio: number;
  resultadoNeto: number;
  devolucion: number;
  comisionDevuelta: number;
  estado: string;
};

/** Una jugada ya normalizada, lista para sumar. */
export type JugadaReporte = {
  id?: string | number;
  fecha?: string;
  horaCarga?: string | null;
  rol?: "Juega" | "Consigue";
  cliente?: string;
  jugada?: string;
  caballo?: string;
  estado?: string;
  hipodromo: string;
  carrera: number;
  montoJugado: number;
  /** Premio a pagar por esa jugada. */
  premio: number;
  /** Resultado neto explícito (unificado con el motor oficial de `reportes.ts`). */
  resultadoNeto?: number | null;
  /** Incentivo ya calculado para esa jugada (base * devolucion% / 100). */
  devolucion: number;
  /** Comisión devuelta explícita (si ya viene calculada). */
  comisionDevuelta?: number;
  /** true si la jugada fue anulada: no cuenta como jugado ni como ticket. */
  anulada: boolean;
};

/** Una fila de la tabla: una carrera (por hipódromo + número). */
export type FilaReporteDiario = {
  fecha?: string;
  hipodromo: string;
  carrera: number;
  tickets: number;
  totalJugado: number;
  totalPremios: number;
  resultadoNetoTotal?: number;
  devolucion: number;
  comisionDevuelta?: number;
  balance: number;
  jugadasDetalle?: DetalleJugadaReporteDiario[];
};

export type HipodromoPivotDiario = {
  hipodromo: string;
  carreras: FilaReporteDiario[];
  tickets: number;
  totalJugado: number;
  totalPremios: number;
  resultadoNetoTotal?: number;
  devolucion: number;
  comisionDevuelta: number;
  balance: number;
};

export type DiaPivotDiario = {
  fecha: string;
  hipodromos: HipodromoPivotDiario[];
  tickets: number;
  totalJugado: number;
  totalPremios: number;
  resultadoNetoTotal?: number;
  devolucion: number;
  comisionDevuelta: number;
  balance: number;
};

export type TotalesReporteDiario = {
  tickets: number;
  totalJugado: number;
  totalPremios: number;
  resultadoNetoTotal?: number;
  devolucion: number;
  comisionDevuelta?: number;
  balance: number;
};

export type ReporteDiario = {
  filas: FilaReporteDiario[];
  totales: TotalesReporteDiario;
  /** Árbol jerárquico para la Tabla Dinámica: Día → Hipódromo → Carrera → Jugadas. */
  dias?: DiaPivotDiario[];
};

/** Filtros del reporte. El alcance por rol NO se decide acá: lo fuerza el servidor. */
export type OpcionesReporteDiario = {
  /** Primer día del rango (YYYY-MM-DD). */
  desde: string;
  /** Último día del rango (YYYY-MM-DD). */
  hasta: string;
  /** Hipódromo exacto, o vacío/null = todos. */
  hipodromo?: string | null;
  /** Grupo a mirar. Solo el super administrador lo aprovecha. */
  grupoId?: string | null;
  /** Cliente a mirar, o vacío/null = todos los permitidos. */
  clienteId?: string | null;
};

export type ResultadoReporteDiario = {
  ok: boolean;
  datos?: ReporteDiario;
  /**
   * De dónde salieron los números: `rpc` (agregado en el servidor) o `cliente`
   * (respaldo que suma en el navegador sobre filas que ya filtró el RLS).
   */
  fuente?: "rpc" | "cliente";
  /**
   * true cuando la RPC del servidor todavía no está aplicada y se usó el
   * respaldo del navegador. La pantalla lo avisa sin romperse.
   */
  respaldo?: boolean;
  error?: string;
};

// ---------------------------------------------------------------------------
// Cálculo puro
// ---------------------------------------------------------------------------

/** Redondea a centavos para que la suma no arrastre errores de coma flotante. */
const centavos = (n: number): number => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;

/** Formato pedido por la casa: separador de miles y dos decimales ($1,250.00). */
export function formatoDinero(
  v: number | string | null | undefined,
  moneda = "USD"
): string {
  const n = typeof v === "string" ? parseFloat(v) : v ?? 0;
  const seguro = Number.isFinite(n as number) ? (n as number) : 0;
  const m = String(moneda ?? "USD").toUpperCase();
  const prefijo = m === "VES" || m === "BS" ? "Bs " : "$";
  return (
    prefijo +
    seguro.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

/** Clave de agrupación de una carrera: hipódromo + número. */
function claveCarrera(hipodromo: string, carrera: number): string {
  return `${hipodromo}\u0000${carrera}`;
}

function claveDiaCarrera(fecha: string, hipodromo: string, carrera: number): string {
  return `${fecha}\u0000${hipodromo}\u0000${carrera}`;
}

function resultadoNetoJugada(montoJugado: number, premio: number, estado: string): number {
  const est = String(estado ?? "").trim().toUpperCase();
  if (est === "PENDIENTE" || est === "EN_REVISION" || est === "RETIRADO" || est === "EMPATE") {
    return premio > 0 ? centavos(premio - montoJugado) : 0;
  }
  if (premio > 0) return centavos(premio - montoJugado);
  return centavos(-Math.abs(montoJugado));
}

/**
 * Agrupa las jugadas por hipódromo + carrera y además arma el árbol jerárquico
 * de Tabla Dinámica (Día → Hipódromo → Carrera → Cada Jugada con resultado y comisión devuelta).
 * Las jugadas anuladas no cuentan ni como ticket ni como jugado.
 */
export function armarReporteDiario(jugadas: JugadaReporte[]): ReporteDiario {
  const mapa = new Map<string, FilaReporteDiario>();
  const mapaDiaCarrera = new Map<string, FilaReporteDiario>();

  let seq = 0;
  for (const j of jugadas) {
    if (j.anulada) continue;
    seq += 1;
    const fecha = String(j.fecha ?? "").trim().slice(0, 10) || "JORNADA";
    const hipodromo = String(j.hipodromo ?? "—").trim() || "—";
    const carrera = Math.trunc(Number(j.carrera) || 0);
    const key = claveCarrera(hipodromo, carrera);
    const keyDia = claveDiaCarrera(fecha, hipodromo, carrera);

    const monto = Number(j.montoJugado) || 0;
    const premio = Number(j.premio) || 0;
    const dev = Number(j.devolucion) || 0;
    const estado = String(j.estado ?? (premio > 0 ? "GANADOR" : "DECIDIDO")).trim().toUpperCase();
    const resNeto =
      j.resultadoNeto !== undefined && j.resultadoNeto !== null && Number.isFinite(Number(j.resultadoNeto))
        ? centavos(Number(j.resultadoNeto))
        : resultadoNetoJugada(monto, premio, estado);

    const detalle: DetalleJugadaReporteDiario = {
      id: String(j.id ?? `jug-${seq}`),
      fecha,
      horaCarga: j.horaCarga ?? null,
      ...(j.rol ? { rol: j.rol } : {}),
      cliente: String(j.cliente ?? "—").trim() || "—",
      jugada: String(j.jugada ?? "JUGADA").trim() || "JUGADA",
      caballo: String(j.caballo ?? "—").trim() || "—",
      montoJugado: centavos(monto),
      premio: centavos(premio),
      resultadoNeto: resNeto,
      devolucion: centavos(dev),
      comisionDevuelta: centavos(Number(j.comisionDevuelta) || 0),
      estado,
    };

    let fila = mapa.get(key);
    if (!fila) {
      fila = {
        fecha,
        hipodromo,
        carrera,
        tickets: 0,
        totalJugado: 0,
        totalPremios: 0,
        resultadoNetoTotal: 0,
        devolucion: 0,
        comisionDevuelta: 0,
        balance: 0,
        jugadasDetalle: [],
      };
      mapa.set(key, fila);
    }

    fila.tickets += 1;
    fila.totalJugado += monto;
    fila.totalPremios += premio;
    fila.resultadoNetoTotal = (fila.resultadoNetoTotal ?? 0) + resNeto;
    fila.devolucion += dev;
    fila.jugadasDetalle!.push(detalle);

    let filaDia = mapaDiaCarrera.get(keyDia);
    if (!filaDia) {
      filaDia = {
        fecha,
        hipodromo,
        carrera,
        tickets: 0,
        totalJugado: 0,
        totalPremios: 0,
        resultadoNetoTotal: 0,
        devolucion: 0,
        comisionDevuelta: 0,
        balance: 0,
        jugadasDetalle: [],
      };
      mapaDiaCarrera.set(keyDia, filaDia);
    }
    filaDia.tickets += 1;
    filaDia.totalJugado += monto;
    filaDia.totalPremios += premio;
    filaDia.resultadoNetoTotal = (filaDia.resultadoNetoTotal ?? 0) + resNeto;
    filaDia.devolucion += dev;
    filaDia.jugadasDetalle!.push({ ...detalle });
  }

  const calcularCruceCarrera = (f: FilaReporteDiario) => {
    const dets = f.jugadasDetalle ?? [];
    const lineas = dets
      .filter((d) => d.resultadoNeto !== 0)
      .map((d) => ({ cliente: d.cliente, resultado: d.resultadoNeto }));
    const { porCliente, totalReembolsado } = _reembolsosCruce(lineas, "con_cruces", 5);
    if (totalReembolsado > 0) {
      // Asignar la comisión devuelta al cliente correspondiente en su primera jugada ganadora de la carrera
      const asignados = new Set<string>();
      for (const d of dets) {
        const claveCli = d.cliente.trim().toUpperCase();
        const info = porCliente.get(claveCli);
        if (info && info.reembolsoCruce > 0 && !asignados.has(claveCli) && d.resultadoNeto > 0) {
          d.comisionDevuelta = centavos((d.comisionDevuelta || 0) + info.reembolsoCruce);
          asignados.add(claveCli);
        }
      }
    }
    const sumaExplicita = dets.reduce((acc, d) => acc + (d.comisionDevuelta || 0), 0);
    f.comisionDevuelta = centavos(Math.max(totalReembolsado, sumaExplicita));
  };

  const filas = [...mapa.values()]
    .map((f) => {
      calcularCruceCarrera(f);
      f.totalJugado = centavos(f.totalJugado);
      f.totalPremios = centavos(f.totalPremios);
      f.resultadoNetoTotal = centavos(f.resultadoNetoTotal ?? 0);
      f.devolucion = centavos(f.devolucion);
      f.balance = centavos(f.totalJugado - f.totalPremios - f.devolucion);
      return f;
    })
    .sort((a, b) =>
      a.hipodromo === b.hipodromo
        ? Number(a.carrera) - Number(b.carrera)
        : a.hipodromo.localeCompare(b.hipodromo, "es")
    );

  // Construir árbol jerárquico Día → Hipódromo → Carrera → Jugadas
  const porDiaMap = new Map<string, Map<string, FilaReporteDiario[]>>();
  for (const fDia of mapaDiaCarrera.values()) {
    calcularCruceCarrera(fDia);
    fDia.totalJugado = centavos(fDia.totalJugado);
    fDia.totalPremios = centavos(fDia.totalPremios);
    fDia.resultadoNetoTotal = centavos(fDia.resultadoNetoTotal ?? 0);
    fDia.devolucion = centavos(fDia.devolucion);
    fDia.balance = centavos(fDia.totalJugado - fDia.totalPremios - fDia.devolucion);

    const dKey = fDia.fecha || "JORNADA";
    if (!porDiaMap.has(dKey)) porDiaMap.set(dKey, new Map());
    const hipoMap = porDiaMap.get(dKey)!;
    if (!hipoMap.has(fDia.hipodromo)) hipoMap.set(fDia.hipodromo, []);
    hipoMap.get(fDia.hipodromo)!.push(fDia);
  }

  const dias: DiaPivotDiario[] = [...porDiaMap.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([fecha, hipoMap]) => {
      const hipodromos: HipodromoPivotDiario[] = [...hipoMap.entries()]
        .sort((a, b) => a[0].localeCompare(b[0], "es"))
        .map(([hipodromo, carreras]) => {
          carreras.sort((a, b) => Number(a.carrera) - Number(b.carrera));
          const sub = totalesDe(carreras);
          return {
            hipodromo,
            carreras,
            tickets: sub.tickets,
            totalJugado: sub.totalJugado,
            totalPremios: sub.totalPremios,
            resultadoNetoTotal: sub.resultadoNetoTotal,
            devolucion: sub.devolucion,
            comisionDevuelta: sub.comisionDevuelta ?? 0,
            balance: sub.balance,
          };
        });
      const todasCarrerasDia = hipodromos.flatMap((h) => h.carreras);
      const subDia = totalesDe(todasCarrerasDia);
      return {
        fecha,
        hipodromos,
        tickets: subDia.tickets,
        totalJugado: subDia.totalJugado,
        totalPremios: subDia.totalPremios,
        resultadoNetoTotal: subDia.resultadoNetoTotal,
        devolucion: subDia.devolucion,
        comisionDevuelta: subDia.comisionDevuelta ?? 0,
        balance: subDia.balance,
      };
    });

  return { filas, totales: totalesDe(filas), dias };
}

/** Suma las filas de la tabla para el pie "TOTAL DEL DÍA". */
export function totalesDe(filas: FilaReporteDiario[]): TotalesReporteDiario {
  const t: TotalesReporteDiario = {
    tickets: 0,
    totalJugado: 0,
    totalPremios: 0,
    resultadoNetoTotal: 0,
    devolucion: 0,
    comisionDevuelta: 0,
    balance: 0,
  };
  let tieneResNeto = false;
  for (const f of filas) {
    t.tickets += f.tickets;
    t.totalJugado += f.totalJugado;
    t.totalPremios += f.totalPremios;
    if (f.resultadoNetoTotal !== undefined) {
      tieneResNeto = true;
      t.resultadoNetoTotal = (t.resultadoNetoTotal ?? 0) + f.resultadoNetoTotal;
    }
    t.devolucion += f.devolucion;
    t.comisionDevuelta = (t.comisionDevuelta ?? 0) + (f.comisionDevuelta ?? 0);
  }
  t.totalJugado = centavos(t.totalJugado);
  t.totalPremios = centavos(t.totalPremios);
  t.resultadoNetoTotal = tieneResNeto ? centavos(t.resultadoNetoTotal ?? 0) : undefined;
  t.devolucion = centavos(t.devolucion);
  t.comisionDevuelta = centavos(t.comisionDevuelta ?? 0);
  t.balance = centavos(t.totalJugado - t.totalPremios - t.devolucion);
  return t;
}

// ---------------------------------------------------------------------------
// Normalización de filas crudas de `tickets_apuestas`
// ---------------------------------------------------------------------------

/** Fila cruda tal como la devuelve PostgREST (respaldos tipados a propósito). */
export type TicketCrudo = {
  id?: string | number | null;
  hipodromo?: string | null;
  carrera?: number | string | null;
  fecha_carrera?: string | null;
  fecha_registro?: string | null;
  nombre_jugada?: string | null;
  caballo?: string | null;
  ejemplar_numero?: number | string | null;
  cantidad_tablas?: number | string | null;
  monto_jugado?: number | string | null;
  monto_decidido?: number | string | null;
  premio_pagar?: number | string | null;
  premio_por_tabla?: number | string | null;
  comision_porcentaje?: number | string | null;
  comision_pagada?: number | string | null;
  estado?: string | null;
  anulada?: boolean | null;
  es_adelantada?: boolean | null;
  cliente_juega_id?: string | number | null;
  cliente_juega_nombre?: string | null;
  cliente_consigue_id?: string | number | null;
  cliente_consigue_nombre?: string | null;
  banquero_cliente_id?: string | number | null;
  banquero_nombre?: string | null;
  nota_auditoria?: unknown;
};

const num = (v: unknown): number => {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : 0;
  return Number.isFinite(n) ? n : 0;
};

function horaDeRegistro(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) return s.slice(0, 5);
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  const m = /(\d{2}:\d{2})/.exec(s);
  return m ? m[1] : null;
}

/** ¿La jugada está anulada? Se mira la bandera y, si no, el estado. */
export function esJugadaAnulada(estado: unknown, anulada: unknown): boolean {
  if (anulada === true) return true;
  const e = String(estado ?? "").trim().toUpperCase();
  return e.includes("ANUL") || e.includes("CANCEL");
}

/**
 * Convierte filas crudas de `tickets_apuestas` en jugadas normalizadas, usando
 * el % de devolución/incentivo de cada cliente. Mismo cálculo que el estado de
 * cuenta: base = `monto_decidido` (o `monto_jugado` si todavía no se decidió).
 */
export function normalizarTickets(
  tickets: TicketCrudo[],
  devolucionPorCliente: Map<string, number>,
  optsUnificados?: {
    pizarras?: Map<string, PizarraCarrera>;
    clienteFiltro?: { id?: string; nombres?: string[] } | null;
  }
): JugadaReporte[] {
  if (!optsUnificados) {
    return tickets.map((t, idx) => {
      const base = t.monto_decidido != null ? num(t.monto_decidido) : num(t.monto_jugado);
      const pct = devolucionPorCliente.get(String(t.cliente_juega_id ?? "")) ?? 0;
      const premio = t.premio_pagar != null ? num(t.premio_pagar) : num(t.premio_por_tabla);
      const fecha =
        extraerFechaCarreraTicket(t as Record<string, unknown>) ||
        String(t.fecha_carrera ?? t.fecha_registro ?? "").slice(0, 10) ||
        undefined;
      return {
        id: t.id ?? `tk-${idx}`,
        fecha,
        horaCarga: horaDeRegistro(t.fecha_registro),
        cliente: String(t.cliente_juega_nombre ?? t.cliente_juega_id ?? "—"),
        jugada: String(t.nombre_jugada ?? "JUGADA"),
        caballo: String(t.caballo ?? "—"),
        estado: String(t.estado ?? "PENDIENTE"),
        hipodromo: String(t.hipodromo ?? "—"),
        carrera: Math.trunc(num(t.carrera)),
        montoJugado: num(t.monto_jugado),
        premio,
        devolucion: base * (pct / 100),
        anulada: esJugadaAnulada(t.estado, t.anulada),
      };
    });
  }

  const out: JugadaReporte[] = [];
  const filtroId = String(optsUnificados.clienteFiltro?.id ?? "").trim();
  const filtroNombres = new Set(
    (optsUnificados.clienteFiltro?.nombres ?? [])
      .map((n) => String(n ?? "").trim().toUpperCase())
      .filter(Boolean)
  );
  const hayFiltroCliente = Boolean(filtroId || filtroNombres.size > 0);

  const coincideCliente = (id: string, nombre: string): boolean => {
    if (!hayFiltroCliente) return true;
    if (filtroId && id && id === filtroId) return true;
    const nomNorm = String(nombre ?? "").trim().toUpperCase();
    return Boolean(nomNorm && filtroNombres.has(nomNorm));
  };

  tickets.forEach((t, idx) => {
    const rec = t as unknown as Record<string, unknown>;
    const fecha =
      extraerFechaCarreraTicket(rec) ||
      String(t.fecha_carrera ?? t.fecha_registro ?? "").slice(0, 10) ||
      "JORNADA";
    const hipodromo = String(t.hipodromo ?? "—").trim().toUpperCase();
    const carrera = Math.trunc(num(t.carrera));
    const pizarra = buscarPizarraEnMapa(optsUnificados.pizarras, fecha, hipodromo, carrera);
    const { juega, consigue } = desglosarTicketEnFilasUnificadas(rec, pizarra, null);

    const base = t.monto_decidido != null ? num(t.monto_decidido) : num(t.monto_jugado);

    if (coincideCliente(juega.clienteId, juega.clienteNombre)) {
      const pctJ =
        devolucionPorCliente.get(juega.clienteId) ??
        devolucionPorCliente.get(juega.clienteNombre.toUpperCase()) ??
        0;
      out.push({
        id: `${t.id ?? idx}-j`,
        fecha,
        horaCarga: juega.horaCarga,
        rol: "Juega",
        cliente: juega.clienteNombre,
        jugada: juega.jugada,
        caballo: juega.caballo,
        estado: juega.estado,
        hipodromo,
        carrera,
        montoJugado: juega.monto,
        premio: juega.premio,
        resultadoNeto: juega.resultado ?? 0,
        devolucion: juega.anulada ? 0 : base * (pctJ / 100),
        anulada: juega.anulada,
      });
    }

    if (consigue && coincideCliente(consigue.clienteId, consigue.clienteNombre)) {
      const pctC =
        devolucionPorCliente.get(consigue.clienteId) ??
        devolucionPorCliente.get(consigue.clienteNombre.toUpperCase()) ??
        0;
      out.push({
        id: `${t.id ?? idx}-c`,
        fecha,
        horaCarga: consigue.horaCarga,
        rol: "Consigue",
        cliente: consigue.clienteNombre,
        jugada: consigue.jugada,
        caballo: consigue.caballo,
        estado: consigue.estado,
        hipodromo,
        carrera,
        montoJugado: consigue.monto,
        premio: consigue.premio,
        resultadoNeto: consigue.resultado ?? 0,
        devolucion: consigue.anulada ? 0 : base * (pctC / 100),
        anulada: consigue.anulada,
      });
    }
  });

  return out;
}

// ---------------------------------------------------------------------------
// Lectura (RPC del servidor con respaldo del navegador)
// ---------------------------------------------------------------------------

/** Fila agregada que devuelve la RPC `club_reporte_diario` (claves snake_case). */
type FilaRpc = Record<string, unknown>;

/** ¿El error es "la función no existe" (falta aplicar el SQL)? */
function esFuncionAusente(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  const msg = String(error.message ?? "");
  return (
    code === "PGRST202" ||
    code === "42883" ||
    /could not find the function|does not exist|schema cache/i.test(msg)
  );
}

/** Normaliza la respuesta de la RPC a un `ReporteDiario`, por si llegara suelta. */
function leerRespuestaRpc(data: unknown): ReporteDiario | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as { filas?: unknown; totales?: unknown };
  const filasCrudas = Array.isArray(obj.filas) ? (obj.filas as FilaRpc[]) : [];
  const filas: FilaReporteDiario[] = filasCrudas.map((f) => {
    const totalJugado = centavos(num(f.totalJugado ?? f.total_jugado));
    const totalPremios = centavos(num(f.totalPremios ?? f.total_premios));
    const devolucion = centavos(num(f.devolucion));
    return {
      hipodromo: String(f.hipodromo ?? "—"),
      carrera: Math.trunc(num(f.carrera)),
      tickets: Math.trunc(num(f.tickets)),
      totalJugado,
      totalPremios,
      devolucion,
      balance: centavos(totalJugado - totalPremios - devolucion),
    };
  }).sort((a, b) =>
    a.hipodromo === b.hipodromo
      ? Number(a.carrera) - Number(b.carrera)
      : a.hipodromo.localeCompare(b.hipodromo, "es")
  );
  // Los totales se recalculan de las filas para que el pie siempre cuadre con
  // la tabla, aunque la RPC los mande redondeados aparte.
  return { filas, totales: totalesDe(filas) };
}

/** Trae y suma las jugadas del rango usando el motor unificado de `reportes.ts`. */
async function leerPorRespaldo(opts: OpcionesReporteDiario): Promise<ResultadoReporteDiario> {
  if (!supabase) return { ok: false, error: "Supabase no está configurado." };

  // Fecha de la carrera (incluyendo jugadas registradas cualquier día para carreras dentro del rango).
  const orFecha =
    opts.desde === opts.hasta
      ? filtroDiaJornada(opts.desde)
      : [
          `and(fecha_carrera.gte.${opts.desde},fecha_carrera.lte.${opts.hasta})`,
          `and(fecha_carrera.is.null,fecha_registro.gte.${opts.desde}T00:00:00,fecha_registro.lte.${opts.hasta}T23:59:59)`,
          `nota_auditoria.ilike.%fecha_carrera%`,
        ].join(",");

  let q = supabase
    .from("tickets_apuestas")
    .select("*")
    .or(orFecha)
    .order("fecha_registro", { ascending: true })
    .limit(20000);
  if (opts.hipodromo) q = q.ilike("hipodromo", `%${opts.hipodromo}%`);
  if (opts.grupoId) q = q.eq("grupo_cobro_id", opts.grupoId);

  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };

  const ticketsBase = ((data ?? []) as TicketCrudo[]).filter((t) => {
    const fc = extraerFechaCarreraTicket(t as Record<string, unknown>);
    if (!fc) return true;
    return fc >= opts.desde && fc <= opts.hasta;
  });

  // Importar jugadas extras de remates y pollas del rango (igual que `reportes.ts`).
  const fechasEnTickets = new Set<string>();
  for (const t of ticketsBase) {
    const fc =
      extraerFechaCarreraTicket(t as Record<string, unknown>) ||
      String(t.fecha_carrera ?? t.fecha_registro ?? "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(fc)) fechasEnTickets.add(fc);
  }
  if (opts.desde === opts.hasta && /^\d{4}-\d{2}-\d{2}$/.test(opts.desde)) {
    fechasEnTickets.add(opts.desde);
  }

  const ticketsTotales: TicketCrudo[] = [...ticketsBase];
  for (const dia of fechasEnTickets) {
    try {
      const extrasMap = await leerJugadasModulosExtrasHipodromo(
        dia,
        opts.hipodromo ?? "",
        null,
        ticketsBase as unknown as Record<string, unknown>[]
      );
      for (const rowsExtra of extrasMap.values()) {
        ticketsTotales.push(...(rowsExtra as unknown as TicketCrudo[]));
      }
    } catch {
      /* best-effort */
    }
  }

  // Cargar pizarras y clientes para evaluar con el motor oficial de `reportes.ts`.
  const [pizarras, resClientes] = await Promise.all([
    leerPizarrasPorFechas([...fechasEnTickets]),
    supabase.from("clientes").select("id, nombre, seudonimo, devolucion"),
  ]);

  const devolucionPorCliente = new Map<string, number>();
  let clienteFiltro: { id?: string; nombres?: string[] } | null = null;
  const idBuscado = String(opts.clienteId ?? "").trim();

  for (const c of (resClientes.data ?? []) as Array<{
    id: string | number;
    nombre?: string | null;
    seudonimo?: string | null;
    devolucion?: number | string | null;
  }>) {
    const idStr = String(c.id);
    const pct = num(c.devolucion);
    devolucionPorCliente.set(idStr, pct);
    if (c.nombre) devolucionPorCliente.set(String(c.nombre).trim().toUpperCase(), pct);
    if (c.seudonimo) devolucionPorCliente.set(String(c.seudonimo).trim().toUpperCase(), pct);
    if (idBuscado && idStr === idBuscado) {
      clienteFiltro = {
        id: idStr,
        nombres: [c.nombre ?? "", c.seudonimo ?? ""].filter(Boolean),
      };
    }
  }
  if (idBuscado && !clienteFiltro) {
    clienteFiltro = { id: idBuscado, nombres: [idBuscado] };
  }

  const jugadas = normalizarTickets(ticketsTotales, devolucionPorCliente, {
    pizarras,
    clienteFiltro,
  });
  return { ok: true, datos: armarReporteDiario(jugadas), fuente: "cliente", respaldo: true };
}

/**
 * Lee el reporte del rango pedido. Primero intenta la RPC del servidor (que
 * fuerza el alcance por rol); si no está aplicada, cae al respaldo del
 * navegador, que sigue sujeto al RLS por grupo.
 */
export async function leerReporteDiario(
  opts: OpcionesReporteDiario
): Promise<ResultadoReporteDiario> {
  if (!supabase) return { ok: false, error: "Supabase no está configurado." };

  // Primero leemos el detalle completo de tickets para alimentar la Tabla Dinámica
  // jerárquica (Día → Hipódromo → Carrera → Cada jugada con resultado y comisión devuelta).
  const detalle = await leerPorRespaldo(opts);
  if (detalle.ok && detalle.datos && detalle.datos.filas.length > 0) {
    return { ...detalle, respaldo: false };
  }

  try {
    const { data, error } = await supabase.rpc("club_reporte_diario", {
      p_desde: opts.desde,
      p_hasta: opts.hasta,
      p_hipodromo: opts.hipodromo ?? null,
      p_grupo_id: opts.grupoId ?? null,
      p_cliente_id: opts.clienteId ?? null,
    });

    if (!error && data) {
      const datos = leerRespuestaRpc(data);
      if (datos) return { ok: true, datos, fuente: "rpc" };
    }
    if (error && !esFuncionAusente(error)) {
      if (detalle.ok) return detalle;
      return { ok: false, error: error.message };
    }
  } catch {
    /* la RPC no está aplicada: se usa el respaldo */
  }

  return detalle;
}
