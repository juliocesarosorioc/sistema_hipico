/**
 * Mensaje de WhatsApp de RESULTADOS de una carrera, generado AL INSTANTE desde
 * las jugadas en sesión de la Taquilla (Gestión de Jugadas), con la MISMA
 * plantilla y el MISMO motor que la liquidación oficial:
 *
 *  - Cabecera: grupo/hipódromo, día, hipódromo + N° de carrera, Retirados, Pizarra.
 *  - Jugadas enumeradas con su detalle y el veredicto del motor por cliente
 *    (cuánto gana el que gana y cuánto pierde el que pierde, vía "Juega X" /
 *    "Consigue Y" de la plantilla 2 del reportGenerator).
 *  - Cierre 🟢 POSITIVOS (+) / 🔴 NEGATIVOS (-): saldo TOTAL de la carrera por
 *    cliente, y pie estricto con la cantidad de jugadas.
 *
 * El resultado de cada jugada sale de `liquidarOficial` (motor universal:
 * NINI contra la pizarra, PUESTOS, GANADOR, PP, americanas W/P/S con la
 * matriz…), así el mensaje refleja EXACTAMENTE lo que pagará la liquidación.
 * Si el motor no puede decidir una jugada (indeterminado → falta dividendo),
 * se lista con aviso y NO se la acumula en el cierre.
 */
import {
  relacionResultados,
  type JugadaRelacion,
  type MetaCarrera,
} from "../reportGenerator";
import { liquidarOficial } from "../motores/oficiales";
import {
  parsearNini,
  normalizarNini,
  type TicketMotor,
  type ResultadoMotor,
} from "../bettingEngine";
import type { PizarraCarrera } from "../liquidacion";

/** Forma mínima de un ticket de sesión de la Taquilla (compatible con
 *  `TicketTaquilla` del store; no importa el store para mantener los tests
 *  puros y librarse del persist de zustand). */
export type TicketMensaje = {
  comando: string;
  monto: number;
  caballo?: string | null;
  cliente1?: string | null;
  cliente2?: string | null;
};

export type OpcionesMensajeResultado = {
  hipodromo: string;
  carrera: number | string;
  /** Fecha de la carrera ("YYYY-MM-DD" o Date). Si falta, se usa hoy. */
  fecha?: string | Date;
  /** Nombre del grupo que encabeza la relación (por defecto el hipódromo). */
  grupo?: string;
  retirados?: string;
  pizarra: PizarraCarrera;
  dividendos?: Record<string, number> | null;
  tickets: TicketMensaje[];
  tasaComision?: number | null;
};

const CLAVES_ORDEN = [
  "primero",
  "segundo",
  "tercero",
  "cuarto",
  "quinto",
  "sexto",
  "septimo",
  "octavo",
] as const;

/** Números de los ejemplares (hasta 8) en orden de llegada, para resolver
 *  NINIS contra la pizarra oficial. */
export function puestosOrdenadosDe(p: PizarraCarrera): string[] {
  const rec = p as unknown as Record<string, unknown>;
  const salida: string[] = [];
  for (const k of CLAVES_ORDEN) {
    const v = rec[k];
    const txt = v == null ? "" : String(v).trim();
    if (txt) salida.push(txt);
  }
  return salida;
}

/** Pizarra para la cabecera del mensaje ("7-2-4"). */
export function pizarraParaMensaje(p: PizarraCarrera): string {
  return puestosOrdenadosDe(p).join("-").toUpperCase();
}

function dividirComando(comando: string): { tipo: string; monto: number | null } {
  const c = String(comando ?? "").trim();
  const m = /^(\d+(?:[.,]\d+)?)\s+(.+)$/.exec(c);
  if (m) {
    return { tipo: m[2].trim(), monto: Number(m[1].replace(",", ".")) };
  }
  return { tipo: c, monto: null };
}

/**
 * Resuelve UNA jugada de sesión contra el motor universal, igual que la
 * liquidación: pizarra + dividendos + tasa → veredicto, premio bruto y la
 * `JugadaRelacion` lista para la plantilla 2.
 */
export function resultadoDeJugada(
  t: TicketMensaje,
  pizarra: PizarraCarrera,
  dividendos: Record<string, number> | null,
  tasaComision?: number | null
): { relacion: JugadaRelacion; res: ResultadoMotor } {
  const { tipo, monto } = dividirComando(t.comando);
  const montoFinal = monto != null && monto > 0 ? monto : t.monto;
  const esNini = parsearNini(tipo) !== null;

  // Mismo `puesto_final` que motorDesdeFila: leído de la pizarra, nunca
  // inventado (no todos los ganadores cruzan primero la raya).
  const primero = (pizarra as unknown as Record<string, unknown>).primero;
  const puesto_final =
    typeof primero === "number" ? primero : parseInt(String(primero ?? ""), 10) || 1;

  const ticket: TicketMotor = {
    hipodromo: "",
    carrera: "",
    caballo: String(t.caballo ?? "").trim(),
    fechas: [],
    id: `mensaje-${t.cliente1 ?? "?"}-${String(t.comando).trim()}`,
    cruces: 1,
    cuota: null,
    total: montoFinal,
    addedAt: 0,
    tipo_jugada: String(tipo).trim().toUpperCase(),
    monto: montoFinal,
    puesto_final,
    pizarra,
    dividendos,
  };

  const res = liquidarOficial(ticket, tasaComision);

  let ganador: JugadaRelacion["ganador"] = res.ok;
  if (res.indeterminado) ganador = "pendiente";

  const relacion: JugadaRelacion = {
    clienteJuega: String(t.cliente1 ?? "—"),
    jugada: esNini ? normalizarNini(tipo) : String(tipo || "?").trim().toUpperCase(),
    caballo: String(t.caballo ?? "").trim(),
    monto: montoFinal,
    clienteConsigue: t.cliente2 ? String(t.cliente2) : undefined,
    modalidad: esNini ? "NINI" : "GENERICA",
    // Premio bruto del ganador (capital + ganancia neta recompuesta con la
    // comisión del motor): totalClienteNeto ya viene neto de comisión.
    ...(res.ok ? { premioPotencial: Number(res.totalClienteNeto) + Number(res.gananciaCasa) } : {}),
    comisionPct:
      tasaComision != null && Number(tasaComision) >= 0 ? Number(tasaComision) : undefined,
    ganador,
  };

  return { relacion, res };
}

/** Mensaje completo de la Relación de Resultados para pegar/enviar al grupo. */
export function mensajeResultadoDeCarrera(opts: OpcionesMensajeResultado): string {
  const fecha =
    opts.fecha instanceof Date
      ? opts.fecha
      : opts.fecha
        ? new Date(`${String(opts.fecha).slice(0, 10)}T12:00:00`)
        : new Date();

  const meta: MetaCarrera = {
    grupo: opts.grupo?.trim() || opts.hipodromo,
    fecha,
    hipodromo: opts.hipodromo,
    carrera: opts.carrera,
    retirados: opts.retirados?.trim() || undefined,
    pizarra: pizarraParaMensaje(opts.pizarra),
    pizarraPuestos: puestosOrdenadosDe(opts.pizarra),
    dividendos: opts.dividendos || null,
  };

  const jugadas = opts.tickets.map((t) =>
    resultadoDeJugada(t, opts.pizarra, meta.dividendos ?? null, opts.tasaComision).relacion
  );

  return relacionResultados(meta, jugadas);
}