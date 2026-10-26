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
  relacionJugadas,
  relacionResultados,
  cabeceraCarrera,
  fmtMonto,
  type JugadaRelacion,
  type MetaCarrera,
} from "@/features/impresion/lib/reportGenerator";
import { liquidarOficial } from "@/features/motores/lib/oficiales";
import {
  parsearNini,
  normalizarNini,
  type TicketMotor,
  type ResultadoMotor,
  type BloqueDetalleResultado,
} from "@/features/betting/lib/bettingEngine";
import type { PizarraCarrera } from "@/features/liquidacion/lib/liquidacion";
import {
  agruparAdelantadasPorSeccion,
  esJugadaAdelantadaReporte,
} from "@/features/liquidacion/lib/reporte-carrera";

/** Forma mínima de un ticket de sesión de la Taquilla (compatible con
 *  `TicketTaquilla` del store; no importa el store para mantener los tests
 *  puros y librarse del persist de zustand). */
export type TicketMensaje = {
  comando: string;
  monto: number;
  caballo?: string | null;
  cliente1?: string | null;
  cliente2?: string | null;
  esAdelantada?: boolean;
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
  /** Saldo ajustado (disponible) por cliente: se anota en cada jugada en *negrita* o `S/S`. */
  saldos?: Record<string, number>;
  /** Observaciones libres que van al pie de la relación. */
  observaciones?: string;
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

  return relacionResultados(meta, jugadas, {
    saldos: opts.saldos,
    observaciones: opts.observaciones,
  });
}

// ============================================================
// PLANO DE JUGADAS (pre-carrera) — plantilla 1, formato TERCIOS
// ============================================================

/** Jugada de la plantilla 1 (plano de jugadas) desde un ticket de sesión. */
export function jugadaRelacionDeTicket(t: TicketMensaje): JugadaRelacion {
  const { tipo, monto } = dividirComando(t.comando);
  const montoFinal = monto != null && monto > 0 ? monto : t.monto;
  return {
    clienteJuega: String(t.cliente1 ?? "—"),
    jugada: String(tipo ?? "").trim().toUpperCase(),
    caballo: String(t.caballo ?? "").trim(),
    monto: montoFinal,
    clienteConsigue: t.cliente2 ? String(t.cliente2) : undefined,
  };
}

export type OpcionesMensajePlano = {
  hipodromo: string;
  carrera: number | string;
  /** Fecha de la carrera ("YYYY-MM-DD" o Date). Si falta, se usa hoy. */
  fecha?: string | Date;
  /** Nombre del grupo que encabeza el plano (por defecto el hipódromo). */
  grupo?: string;
  retirados?: string;
  tickets: TicketMensaje[];
};

/**
 * Mensaje TERCIOS del PLANO DE JUGADAS (pre-carrera) para pegar/enviar al
 * grupo: 🐎 … 🐎 + FECHA/HIPÓDROMO en la cabecera, jugadas numeradas y el pie
 * del plano referencial. Usa la MISMA plantilla 1 que "Copiar Relación"; el
 * orden es el de la sesión (cómo se cargaron los tickets).
 */
export function mensajePlanoDeCarrera(opts: OpcionesMensajePlano): string {
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
  };
  const enVivoTickets: TicketMensaje[] = [];
  const adelantadasTickets: TicketMensaje[] = [];
  for (const t of opts.tickets) {
    const { tipo } = dividirComando(t.comando);
    const esAdel = Boolean(t.esAdelantada) || esJugadaAdelantadaReporte({ jugo: tipo, esAdelantada: t.esAdelantada });
    if (esAdel) {
      adelantadasTickets.push(t);
    } else {
      enVivoTickets.push(t);
    }
  }

  if (adelantadasTickets.length === 0) {
    return relacionJugadas(meta, opts.tickets.map(jugadaRelacionDeTicket));
  }

  const baseEnVivo = relacionJugadas(meta, enVivoTickets.map(jugadaRelacionDeTicket));
  const secciones = agruparAdelantadasPorSeccion(
    adelantadasTickets.map((t) => {
      const rel = jugadaRelacionDeTicket(t);
      return {
        ...rel,
        jugo: rel.jugada,
        esAdelantada: true,
      };
    })
  );

  const lineasAdel: string[] = ["", "⏳ JUGADAS ADELANTADAS (PRE-JUGADAS)"];
  for (const sec of secciones) {
    lineasAdel.push(`▪ ${sec.titulo.toUpperCase()} (${sec.filas.length}):`);
    sec.filas.forEach((j, idx) => {
      const partes = [j.clienteJuega];
      if (String(j.jugada ?? "").trim()) partes.push(String(j.jugada).trim());
      if (String(j.caballo ?? "").trim()) partes.push(`(${String(j.caballo).trim()})`);
      partes.push(`con ${fmtMonto(j.monto)}`);
      if (String(j.clienteConsigue ?? "").trim()) partes.push(`da ${String(j.clienteConsigue).trim()}`);
      lineasAdel.push(`${idx + 1}) Juega ${partes.join(" ")}`);
    });
  }

  const sep = "------------------------------";
  if (baseEnVivo.includes(sep)) {
    const [antes, despues] = baseEnVivo.split(sep);
    const despuesActualizado = despues.replace(
      /Total jugadas:\s*\d+/,
      `Total jugadas: ${opts.tickets.length}`
    );
    return `${antes.trimEnd()}\n${lineasAdel.join("\n")}\n\n${sep}${despuesActualizado}`;
  }
  return `${baseEnVivo}\n${lineasAdel.join("\n")}`;
}

// ============================================================
// PRELIMINAR DE RESULTADOS (post-carrera, sin balance)
// ============================================================

export type OpcionesPreliminarResultado = {
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
  /**
   * Saldo AJUSTADO (disponible = saldo + aval) por cliente. Si se pasa, cada
   * jugada muestra el disponible de quien JUEGA en *negrita* de WhatsApp; con
   * disponible 0 se escribe `S/S` y el nombre entra en la lista de "sin saldo".
   */
  saldos?: Record<string, number>;
  /** Observaciones libres que van al pie del mensaje (después del resumen). */
  observaciones?: string;
};

export type VeredictoJugada = "GANA" | "PIERDE" | "PENDIENTE" | "ANULADA";

/**
 * Saldo ajustado de un cliente por NOMBRE (sin distinguir mayúsculas ni
 * espacios). `undefined` = no hay dato (cliente libre o fuera del mapa), en
 * cuyo caso la jugada NO se anota.
 */
function saldoAjustadoDe(
  saldos: Record<string, number> | undefined,
  nombre: string
): number | undefined {
  if (!saldos) return undefined;
  const clave = String(nombre ?? "").trim().toUpperCase();
  if (!clave) return undefined;
  for (const k of Object.keys(saldos)) {
    if (String(k).trim().toUpperCase() === clave) {
      const n = Number(saldos[k]);
      return Number.isFinite(n) ? n : undefined;
    }
  }
  return undefined;
}

/**
 * Veredicto corto de una jugada contra el motor universal (solo pizarra +
 * dividendos): GANA / PIERDE / PENDIENTE (falta dato que cuantifica el premio)
 * / ANULADA (el motor devolvió el capital: empate oficial o NINI que termina
 * justo en el puesto N). Sin balance de dinero.
 */
export function veredictoDeJugada(
  t: TicketMensaje,
  pizarra: PizarraCarrera,
  dividendos: Record<string, number> | null,
  tasaComision?: number | null
): VeredictoJugada {
  const { res } = resultadoDeJugada(t, pizarra, dividendos, tasaComision);
  if (res.indeterminado) return "PENDIENTE";
  if (res.ok) return "GANA";
  // El motor devuelve el capital (`totalClienteNeto` = monto) con ok:false en
  // los empates oficiales y los NINI que caen justo en el puesto N: no es una
  // pérdida, es una anulación (el "Juega" recupera su dinero).
  if (res.totalClienteNeto > 0) return "ANULADA";
  return "PIERDE";
}

const EMOJI_VEREDICTO: Record<VeredictoJugada, string> = {
  GANA: "✅",
  PIERDE: "❌",
  PENDIENTE: "⏳",
  ANULADA: "🔁",
};

/** "1P→✅" / "1Y2N→❌(1P→❌ · 2N→🔁)": veredicto de UN bloque, con sus sub-bloques. */
function textoBloque(b: BloqueDetalleResultado): string {
  const emoji = b.estado === "GANA" ? "✅" : b.estado === "PIERDE" ? "❌" : "🔁";
  const hijos = b.bloques?.length ? " (" + b.bloques.map(textoBloque).join(" · ") + ")" : "";
  return String(b.fuente).toUpperCase() + "→" + emoji + hijos;
}

/** Estimación POR BLOQUE de una COMBINADA/COMPUESTA, si el motor la desglosa. */
function sufijoBloques(res: ResultadoMotor): string {
  if (!res.bloquesDetalle || res.bloquesDetalle.length === 0) return "";
  return " · BLOQUES: " + res.bloquesDetalle.map(textoBloque).join(" · ");
}

/** Línea TERCIOS de una jugada con su veredicto: "1) Juega X 2Y2N (3) con 6.000,00 da Y → ✅ GANA". */
function lineaJugadaConVeredicto(
  j: JugadaRelacion,
  i: number,
  veredicto: VeredictoJugada,
  sufijo = ""
): string {
  const partes = [j.clienteJuega];
  if (String(j.jugada ?? "").trim()) partes.push(String(j.jugada).trim());
  if (String(j.caballo ?? "").trim()) partes.push(`(${String(j.caballo).trim()})`);
  partes.push(`con ${fmtMonto(j.monto)}`);
  if (String(j.clienteConsigue ?? "").trim()) partes.push(`da ${String(j.clienteConsigue).trim()}`);
  return `${i + 1}) Juega ${partes.join(" ")} → ${EMOJI_VEREDICTO[veredicto]} ${veredicto}${sufijo}`;
}

/**
 * PRELIMINAR DE RESULTADOS: el texto que se copia al grupo apenas se confirma
 * la pizarra, ANTES de liquidar. Cabecera con la pizarra de llegada + cada
 * jugada con su veredicto rápido GANA / PIERDE / PENDIENTE (según el motor),
 * SIN el balance de dinero ni el cierre POSITIVOS/NEGATIVOS.
 */
export function mensajePreliminarDeCarrera(opts: OpcionesPreliminarResultado): string {
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
  };

  const sinSaldo: string[] = [];
  const lineas = opts.tickets.map((t, i) => {
    const { relacion, res } = resultadoDeJugada(t, opts.pizarra, opts.dividendos ?? null, opts.tasaComision);
    const veredicto = veredictoDeJugada(t, opts.pizarra, opts.dividendos ?? null, opts.tasaComision);
    // Saldo ajustado del que financia: en *negrita* (WhatsApp) o `S/S` si el
    // disponible quedó en 0 (el jugador juega sin saldo, se registra en la lista).
    let sufijo = sufijoBloques(res);
    if (opts.saldos) {
      const saldo = saldoAjustadoDe(opts.saldos, relacion.clienteJuega);
      if (saldo !== undefined) {
        if (saldo > 0) {
          sufijo += ` · Disp *${fmtMonto(saldo)}*`;
        } else {
          sufijo += ` · Disp *S/S*`;
          const n = String(relacion.clienteJuega).trim();
          if (n && !sinSaldo.includes(n)) sinSaldo.push(n);
        }
      }
    }
    return lineaJugadaConVeredicto(relacion, i, veredicto, sufijo);
  });

  const pendientes = opts.tickets.filter(
    (t) => veredictoDeJugada(t, opts.pizarra, opts.dividendos ?? null, opts.tasaComision) === "PENDIENTE"
  ).length;

  // Notas al pie: la leyenda S/S + la lista de jugadores sin saldo disponible.
  const notas: string[] = [];
  if (sinSaldo.length) {
    notas.push("S/S = Sin saldo");
    notas.push(`⚠️ Sin saldo disponible: ${sinSaldo.join(", ")}`);
  }
  const observaciones = opts.observaciones?.trim();

  return [
    "🏁 RESULTADO PRELIMINAR",
    cabeceraCarrera(meta),
    "",
    ...lineas,
    "",
    "------------------------------",
    `Total jugadas: ${opts.tickets.length}`,
    pendientes > 0
      ? `⏳ ${pendientes} jugada(s) PENDIENTE(s) — falta el dividendo oficial que cuantifica el premio.`
      : "PRELIMINAR — veredicto según la pizarra; el pago oficial lo confirma la liquidación.",
    ...notas,
    "La guía es el chat · RECLAMOS AL PRIVADO",
    ...(observaciones ? ["", "📝 Observaciones:", observaciones] : []),
  ].join("\n");
}