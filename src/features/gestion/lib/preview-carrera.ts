/**
 * ============================================================================
 * NÚCLEO PURO de la PRE-VISUALIZACIÓN de jugadas cargadas (Bloque 2)
 * ============================================================================
 *
 * El panel de pre-visualización de Gestión de Jugadas debe mostrar SIEMPRE las
 * jugadas de la carrera que ya están en `tickets_apuestas` —no solo las de la
 * sesión en curso—. Antes el panel leía únicamente el store de la taquilla: al
 * recargar la página, cambiar de operador o liquidar la carrera, la lista se
 * vaciaba aunque las jugadas siguieran en la base.
 *
 * Este módulo cruza las dos fuentes:
 *   · `persistidas`: filas de `v_jugadas_carrera` (ya cobradas y auditables);
 *   · `sesion`: tickets del store local (pueden incluir ventas recién hechas
 *     que todavía no se reflejan en la lista persistida).
 *
 * Reglas:
 *   · Una jugada persistida SIEMPRE se pinta y lleva `✅ Validada / Cargada`.
 *   · Un ticket de sesión con `ticketId` también está en la base → validado.
 *   · Una venta de TABLA FIJA / MARCA / DUPLETA / REMATE / POLLA no es una
 *     jugada de taquilla y no entra al panel (igual que antes).
 *   · No se duplica: el ticket de sesión que ya tiene fila persistida se usa
 *     solo para completar la proyección, no como fila aparte.
 *
 * Sin React ni Supabase: testeable en node (pruebas/preview-carrera.test.ts).
 */

import { esAdelantadaDe } from "@/features/jugadas/lib/modalidad-tiempo";
import {
  esMarca,
  esTablaFija,
  extraerNumeroTablaFija,
  extraerPareoMarca,
  extraerPrecioUnitarioTabla,
  resolverContraparteModalidad,
} from "@/features/liquidacion/lib/etiquetas-reporte";
import {
  categoriaJugadaAdelantada,
  type CategoriaJugadaAdelantada,
} from "@/features/liquidacion/lib/reporte-carrera";
import { pagoPotencialTablaFija } from "@/features/liquidacion/lib/reportes";
import { evaluarPuestoPorPosicion } from "@/features/motores/lib/puestos";
import { esJugadaAnuladaOExcluida } from "@/features/saldos/lib/contabilidad-central";
import { jugadaInvolucraRetirado } from "@/features/carreras/lib/retiros-nucleo";

export { esJugadaAnuladaOExcluida };

/** Fila mínima de `v_jugadas_carrera` que necesita el panel. */
export type JugadaPersistida = {
  id: string | number;
  nombre_jugada?: string | null;
  caballo?: string | null;
  ejemplar_numero?: number | null;
  monto_jugado?: number | null;
  premio_pagar?: number | null;
  cantidad_tablas?: number | string | null;
  premio_por_tabla?: number | string | null;
  pts_ejemplar?: number | string | null;
  /** Tasa de comisión del ticket (%), la que retiene la casa sobre la ganancia. */
  comision_porcentaje?: number | null;
  estado?: string | null;
  cliente_juega_nombre?: string | null;
  cliente_consigue_nombre?: string | null;
  anulada?: boolean | null;
  es_adelantada?: boolean | null;
  nota_auditoria?: unknown;
};

/**
 * Resultado de UN lado de la jugada (el que JUEGA o el que DA/CONSIGUE).
 *
 * El panel muestra, a la derecha de cada jugador, si GANÓ o PERDIÓ (✅ / ✖) y el
 * saldo: mientras la carrera NO esté liquidada, el dinero que ARRIESGA; una vez
 * liquidada, la ganancia o la pérdida definitiva.
 */
export type LadoResultado = {
  /** Cómo se pinta el lado. */
  estado: "GANO" | "PERDIO" | "ARRIESGA" | "ANULADA" | "RETIRADO" | "SIN_DATO";
  /** true si la carrera YA está liquidada (el saldo es definitivo). */
  liquidada: boolean;
  /** Signo del saldo: 1 gana · -1 pierde · 0 neutro/arriesga. */
  signo: -1 | 0 | 1;
  /** Importe a mostrar, SIEMPRE en positivo (el signo lo aporta `signo`). */
  monto: number;
};

/** Ticket del store de la taquilla (solo lo que usa la proyección). */
export type TicketSesion = {
  id?: string;
  comando: string;
  monto: number;
  caballo?: string;
  cliente1?: string;
  cliente2?: string;
  cobro1?: number;
  cobro2?: number;
  gananciaProyectada?: number;
  ticketId?: number | string;
  esAdelantada?: boolean;
};

/** Una fila lista para pintar en el panel. */
export type FilaPreviewCarrera = {
  /** Clave estable de React. */
  clave: string;
  /** id del ticket en `tickets_apuestas` (null si solo vive en la sesión). */
  ticketId: string | null;
  /** Nomenclatura de la jugada, sin el monto. */
  jugada: string;
  caballo: string;
  monto: number;
  /** Precio unitario del ejemplar en Tabla Fija (ej. 38 en "5 a 38"). */
  precioTabla?: number;
  /** Cantidad de tablas compradas en Tabla Fija. */
  cantidadTablas?: number;
  /** Monto apostado / arriesgado por Quien Juega (Cliente 1). */
  aposto1?: number;
  /** Monto apostado / arriesgado por Quien Da (Cliente 2 / TF / Marcas). */
  aposto2?: number;
  cliente1: string;
  cliente2: string;
  /** Pendiente | Ganador | Perdedor | Retirado | Anulada. */
  estado: string;
  /**
   * Estado que muestra la COLUMNA «Estado» del panel: SOLO refleja el ciclo de
   * vida de la jugada, nunca si ganó o perdió.
   *   · `Liquidada` — la carrera ya se liquidó (antes decía Ganador/Perdedor).
   *   · `Pendiente` — todavía falta liquidar la carrera.
   *   · `Anulada`   — la jugada se anuló.
   */
  estadoLiquidacion: "Liquidada" | "Pendiente" | "Anulada";
  /** true si ya está guardada en la base (✅ Validada / Cargada). */
  validada: boolean;
  anulada: boolean;
  /** true si la fila solo existe en la sesión (todavía no se refleja en la BD). */
  soloSesion: boolean;
  /** Premio neto (+) o saldo en contra (−) que muestra la última columna. */
  premioSaldo: number;
  /** true si `premioSaldo` es una ganancia; false si es un saldo en contra. */
  esPremio: boolean;
  /** false si no hay proyección disponible (se pinta «—»). */
  tieneProyeccion: boolean;
  /** Resultado del que JUEGA (Cliente 1): ✅/✖ y su saldo. */
  lado1: LadoResultado;
  /** Resultado del que DA/CONSIGUE (Cliente 2): ✅/✖ y su saldo. */
  lado2: LadoResultado;
  /** true si la jugada fue cargada como adelantada (⏳ PRE-JUGADA). */
  esAdelantada?: boolean;
  /** Categoría de la jugada adelantada (tercios, marcas, tablas, remates, dupletas). */
  categoriaAdelantada?: CategoriaJugadaAdelantada;
  /** true cuando una Marca no se decide en la pizarra oficial (ninguno entró en pizarra / empate sin decisión). */
  sinDecision?: boolean;
};

const NUM = (v: unknown): number => {
  const n = parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

const TXT = (v: unknown): string => (v == null ? "" : String(v).trim());

/**
 * ¿El nombre de jugada corresponde a una modalidad siempre adelantada
 * (MARCA, TABLA FIJA, TABLA, REMATE, DUPLETA, POLLA, TERCIO, 3Y3)?
 */
export function esNombreModalidadAdelantada(nombre: unknown): boolean {
  const n = TXT(nombre).toUpperCase();
  if (!n) return false;
  if (/^(MARCA|TABLA|REMATE|DUPLETA|POLLA|TERCIO)\b/.test(n)) return true;
  if (/^T\d{1,2}\b|3Y3/.test(n)) return true;
  return false;
}

/**
 * ¿La fila es una jugada de TAQUILLA? Excluye las modalidades que se venden
 * por su propio módulo y caen en la misma tabla de tickets.
 */
export function esJugadaDeTaquilla(nombre: unknown): boolean {
  const n = TXT(nombre).toUpperCase();
  if (!n) return false;
  if (n.startsWith("REMATE ")) return false;
  if (n.startsWith("TABLA FIJA")) return false;
  if (n.startsWith("MARCA")) return false;
  if (n.startsWith("DUPLETA")) return false;
  if (n.startsWith("POLLA")) return false;
  return true;
}

/** Quita el monto del comando crudo de la taquilla ("100 2P" → "2P"). */
export function jugadaSinMonto(comando: unknown): string {
  return TXT(comando).replace(/^\d+(?:[.,]\d+)?\s+/, "").trim() || TXT(comando);
}

/** Mejor cobro proyectado de un ticket de sesión (mismo criterio del panel). */
function mejorCobreDe(t: TicketSesion): number {
  const monto = NUM(t.monto);
  return Math.max(NUM(t.cobro1), NUM(t.cobro2), NUM(t.gananciaProyectada) + monto);
}

/** Estado normalizado para pintar (las filas anuladas ganan). */
function estadoDeFila(estado: unknown, anulada: boolean): string {
  if (anulada) return "Anulada";
  const s = TXT(estado);
  if (!s) return "Pendiente";
  const low = s.toLowerCase();
  if (low.startsWith("gan")) return "Ganador";
  if (low.startsWith("perd")) return "Perdedor";
  if (low.startsWith("retir")) return "Retirado";
  if (low.startsWith("anul")) return "Anulada";
  return "Pendiente";
}

/**
 * Traduce el estado fino (Ganador/Perdedor/Retirado/…) al estado que muestra la
 * columna «Estado» del panel: solo Liquidada / Pendiente / Anulada.
 *
 * Una jugada Ganador o Perdedor YA se liquidó; una Retirada también se resolvió
 * (se devuelve el capital), así que ambas cuentan como `Liquidada`. La Anulada
 * se conserva aparte para distinguirla de una liquidación normal.
 */
export function estadoLiquidacionDe(estadoFino: string): "Liquidada" | "Pendiente" | "Anulada" {
  if (estadoFino === "Anulada") return "Anulada";
  if (estadoFino === "Ganador" || estadoFino === "Perdedor" || estadoFino === "Retirado") return "Liquidada";
  return "Pendiente";
}

/**
 * Resultados por LADO de la jugada.
 *
 * Reproduce la MISMA convención que el reporte de liquidación y la relación de
 * WhatsApp:
 *   · `premio_pagar` se guarda BRUTO (capital + ganancia).
 *   · la casa retiene `comisionPct` sobre la ganancia bruta.
 *   · el que JUEGA gana el NETO (`premio_pagar − comisión`); si pierde, arriesga
 *     el monto.
 *   · el que DA/CONSIGUE juega en espejo: si el que juega acierta, el que da
 *     entrega el neto del jugador más la comisión; si el que juega falla, el que
 *     da cobra el monto menos la comisión.
 *
 * Mientras la carrera NO esté liquidada (Pendiente) se muestra el saldo que
 * ARRIESGA cada uno (el monto), sin ✅ ni ✖.
 */
function ladosDeLaJugada(
  monto: number,
  estadoFila: string,
  premioPagar: number,
  comisionPct: number,
  nombreJugada?: string
): { lado1: LadoResultado; lado2: LadoResultado; aposto1: number; aposto2: number } {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const jugTxt = TXT(nombreJugada).toUpperCase();
  const esTablaFija = /^TABLA\s+FIJA\b|^TF\b|^TABLA$/i.test(jugTxt);
  const esMarca = /^MARCAS?\b/i.test(jugTxt);

  const pagoTabla = esTablaFija
    ? round2(premioPagar > monto ? premioPagar : premioPagar > 0 ? premioPagar : monto)
    : 0;
  const pagoMarca = esMarca ? round2((monto * 5) / 6) : 0;

  const aposto1 = round2(monto);
  const aposto2 = esTablaFija ? pagoTabla : esMarca ? pagoMarca : round2(monto);

  const arriesga1 = (): LadoResultado => ({ estado: "ARRIESGA", liquidada: false, signo: 0, monto: aposto1 });
  const arriesga2 = (): LadoResultado => ({ estado: "ARRIESGA", liquidada: false, signo: 0, monto: aposto2 });

  if (estadoFila === "Anulada") {
    const lado: LadoResultado = { estado: "ANULADA", liquidada: true, signo: 0, monto: 0 };
    return { lado1: lado, lado2: lado, aposto1, aposto2 };
  }
  if (estadoFila === "Retirado") {
    const lado: LadoResultado = { estado: "RETIRADO", liquidada: true, signo: 0, monto: 0 };
    return { lado1: lado, lado2: lado, aposto1, aposto2 };
  }

  if (estadoFila === "Ganador" || estadoFila === "Perdedor") {
    const gano = estadoFila === "Ganador";
    const pct = comisionPct > 0 ? comisionPct : 5;

    if (esTablaFija) {
      if (gano) {
        return {
          lado1: { estado: "GANO", liquidada: true, signo: 1, monto: pagoTabla },
          lado2: {
            estado: "PERDIO",
            liquidada: true,
            signo: -1,
            monto: round2(pagoTabla + (pagoTabla * pct) / 100),
          },
          aposto1,
          aposto2,
        };
      }
      return {
        lado1: { estado: "PERDIO", liquidada: true, signo: -1, monto: aposto1 },
        lado2: {
          estado: "GANO",
          liquidada: true,
          signo: 1,
          monto: round2(Math.max(0, aposto1 - (aposto1 * pct) / 100)),
        },
        aposto1,
        aposto2,
      };
    }

    if (esMarca) {
      if (gano) {
        return {
          lado1: { estado: "GANO", liquidada: true, signo: 1, monto: pagoMarca },
          lado2: {
            estado: "PERDIO",
            liquidada: true,
            signo: -1,
            monto: round2(pagoMarca + (pagoMarca * pct) / 100),
          },
          aposto1,
          aposto2,
        };
      }
      return {
        lado1: { estado: "PERDIO", liquidada: true, signo: -1, monto: aposto1 },
        lado2: {
          estado: "GANO",
          liquidada: true,
          signo: 1,
          monto: round2(Math.max(0, aposto1 - (aposto1 * pct) / 100)),
        },
        aposto1,
        aposto2,
      };
    }

    // Ganancia bruta sobre la que se cobra la comisión (nunca negativa).
    const gananciaBruta = gano ? Math.max(0, round2(premioPagar - monto)) : 0;
    const comision = round2(gananciaBruta * (comisionPct / 100));
    const netoJuega = round2(gananciaBruta - comision); // ganancia NETA del que juega
    const ladoJuegaGano: LadoResultado = { estado: "GANO", liquidada: true, signo: 1, monto: Math.max(0, netoJuega) };
    const ladoJuegaPerdio: LadoResultado = { estado: "PERDIO", liquidada: true, signo: -1, monto };
    const ladoDaGano: LadoResultado = {
      estado: "GANO",
      liquidada: true,
      signo: 1,
      monto: round2(Math.max(0, monto - monto * (comisionPct / 100))),
    };
    const ladoDaPerdio: LadoResultado = {
      estado: "PERDIO",
      liquidada: true,
      signo: -1,
      monto: round2(Math.max(0, premioPagar - monto)),
    };
    return gano
      ? { lado1: ladoJuegaGano, lado2: ladoDaPerdio, aposto1, aposto2 }
      : { lado1: ladoJuegaPerdio, lado2: ladoDaGano, aposto1, aposto2 };
  }

  return { lado1: arriesga1(), lado2: arriesga2(), aposto1, aposto2 };
}

function filaDesdePersistida(
  j: JugadaPersistida,
  sesion?: TicketSesion,
  pizarraPuestos?: string[],
  retirados?: Array<string | number>
): FilaPreviewCarrera {
  const monto = NUM(j.monto_jugado);
  const nombreJug = TXT(j.nombre_jugada);
  const jRec = j as unknown as Record<string, unknown>;
  const esJugMarca = esMarca(nombreJug);
  const esJugTabla = esTablaFija(nombreJug);
  const caballo = esJugMarca
    ? extraerPareoMarca(jRec).caballoPareo
    : esJugTabla
      ? extraerNumeroTablaFija(jRec)
      : TXT(j.caballo) || (j.ejemplar_numero != null ? String(j.ejemplar_numero) : "");
  const involucraRetirado =
    Array.isArray(retirados) &&
    retirados.length > 0 &&
    jugadaInvolucraRetirado(caballo || j.caballo, j.ejemplar_numero, nombreJug, retirados);
  const anulada = Boolean(j.anulada) || involucraRetirado;
  let estado = involucraRetirado ? "Retirado" : estadoDeFila(j.estado, Boolean(j.anulada));
  const ticketId = String(j.id ?? "").trim() || null;
  const precioTabla = esJugTabla ? extraerPrecioUnitarioTabla(jRec) : undefined;
  const cantidadTablas = esJugTabla
    ? Math.max(1, NUM(j.cantidad_tablas) || (precioTabla && precioTabla > 0 ? Math.round(monto / precioTabla) : 1))
    : undefined;
  const comisionPct = NUM(j.comision_porcentaje);

  let sinDecision = false;
  // Evaluación en vivo de MARCAS según el resultado de la carrera (`pizarraPuestos`):
  // Si la jugada de Marca aún figura como Pendiente (o para verificar contra la pizarra),
  // se evalúa el ejemplar jugado contra sus rivales para mostrar su pago y cobro exactos.
  if (!anulada && /^MARCAS?\b/i.test(nombreJug) && pizarraPuestos && pizarraPuestos.length > 0) {
    const numElegido = (j.ejemplar_numero != null ? String(j.ejemplar_numero).trim() : "") || (caballo.match(/\d+/)?.[0] ?? "");
    let rivales: string[] = [];
    try {
      const nota = typeof j.nota_auditoria === "string" ? JSON.parse(j.nota_auditoria) : j.nota_auditoria;
      if (nota && typeof nota === "object" && Array.isArray((nota as Record<string, unknown>).rivales_snapshot)) {
        rivales = ((nota as Record<string, unknown>).rivales_snapshot as unknown[])
          .map((x) => (String(x ?? "").match(/\d+/)?.[0] ?? "").trim())
          .filter((n) => Boolean(n && n !== numElegido));
      }
    } catch {
      /* ignore */
    }
    if (rivales.length === 0) {
      const numsCab = (caballo.match(/\d+/g) ?? []).map((x) => x.trim());
      rivales = numsCab.filter((n, idx) => idx > 0 && n !== numElegido);
    }
    if (rivales.length === 0) {
      const numsJug = (nombreJug.match(/\d+/g) ?? []).map((x) => x.trim());
      rivales = numsJug.filter((n) => n !== numElegido);
    }
    if (numElegido && rivales.length > 0) {
      const posElegido = pizarraPuestos.findIndex((p) => String(p).trim() === numElegido);
      const posRivales = rivales.map((rv) => pizarraPuestos.findIndex((p) => String(p).trim() === rv));
      if (posElegido !== -1 && posRivales.every((pr) => pr === -1 || posElegido < pr)) {
        estado = "Ganador";
      } else if (posRivales.some((pr) => pr !== -1 && (posElegido === -1 || pr <= posElegido))) {
        estado = "Perdedor";
      } else if (posElegido === -1 && posRivales.every((pr) => pr === -1)) {
        estado = "Retirado";
        sinDecision = true;
      }
    } else if (estado === "Retirado" || estado === "Pendiente") {
      estado = "Retirado";
      sinDecision = true;
    }
  } else if (!anulada && /^MARCAS?\b/i.test(nombreJug) && estado === "Retirado") {
    sinDecision = true;
  }
  // Si hay pizarra oficial (o si el ticket quedó con estado "Perdedor" pero premio_pagar === monto),
  // en el empate NINI ni gana ni pierde nadie (0 / 0 = Retirado/Empate).
  if (!anulada && (estado === "Ganador" || estado === "Perdedor") && esJugadaDeTaquilla(nombreJug)) {
    if (pizarraPuestos && pizarraPuestos.length > 0 && caballo) {
      const idx = pizarraPuestos.findIndex((p) => String(p).trim() === caballo);
      const pos = idx >= 0 ? idx + 1 : 99;
      const r = evaluarPuestoPorPosicion(
        nombreJug,
        pos,
        monto,
        comisionPct > 0 ? comisionPct : 5
      );
      if (r && !r.ok && Math.abs(r.totalClienteNeto - monto) < 0.01) {
        estado = "Retirado";
      }
    } else if (
      estado === "Perdedor" &&
      monto > 0 &&
      Math.abs(NUM(j.premio_pagar) - monto) < 0.01 &&
      /\b[2345]N\b/i.test(nombreJug)
    ) {
      estado = "Retirado";
    }
  }

  let premioSaldo = 0;
  let esPremio = false;
  let tieneProyeccion = true;

  if (estado === "Ganador") {
    premioSaldo = NUM(j.premio_pagar);
    esPremio = premioSaldo > 0;
  } else if (estado === "Perdedor") {
    premioSaldo = -monto;
  } else if (estado === "Retirado" || estado === "Anulada") {
    premioSaldo = 0;
  } else {
    // Pendiente: la proyección de la sesión (si está) es la única disponible.
    if (sesion) {
      const mejor = mejorCobreDe(sesion);
      premioSaldo = mejor > monto ? mejor - monto : -monto;
      esPremio = mejor > monto;
    } else {
      tieneProyeccion = false;
    }
  }

  const { lado1, lado2, aposto1, aposto2 } = ladosDeLaJugada(
    monto,
    estado,
    esJugTabla ? pagoPotencialTablaFija(jRec) : NUM(j.premio_pagar),
    comisionPct,
    nombreJug
  );

  const esAdel =
    esAdelantadaDe(j) ||
    Boolean(sesion?.esAdelantada) ||
    esNombreModalidadAdelantada(nombreJug);

  return {
    clave: `db-${ticketId ?? nombreJug}-${caballo}`,
    ticketId,
    jugada: nombreJug,
    caballo,
    monto,
    ...(precioTabla !== undefined ? { precioTabla } : {}),
    ...(cantidadTablas !== undefined ? { cantidadTablas } : {}),
    aposto1,
    aposto2,
    cliente1: TXT(j.cliente_juega_nombre),
    cliente2: resolverContraparteModalidad(nombreJug, j.cliente_consigue_nombre),
    estado,
    estadoLiquidacion: involucraRetirado ? "Anulada" : estadoLiquidacionDe(estado),
    validada: true,
    anulada: estado === "Anulada" || involucraRetirado,
    soloSesion: false,
    premioSaldo,
    esPremio,
    tieneProyeccion,
    lado1,
    lado2,
    esAdelantada: esAdel,
    categoriaAdelantada: esAdel ? categoriaJugadaAdelantada(nombreJug) : undefined,
    ...(sinDecision ? { sinDecision: true } : {}),
  };
}

function filaDesdeSesion(
  t: TicketSesion,
  retirados?: Array<string | number>
): FilaPreviewCarrera {
  const monto = NUM(t.monto);
  const mejor = mejorCobreDe(t);
  const esPremio = mejor > monto;
  const ticketId = t.ticketId != null && String(t.ticketId).trim() !== "" ? String(t.ticketId) : null;
  const nombreJug = jugadaSinMonto(t.comando);
  const caballo = TXT(t.caballo);
  const involucraRetirado =
    Array.isArray(retirados) &&
    retirados.length > 0 &&
    jugadaInvolucraRetirado(caballo, null, nombreJug, retirados);
  const estado = involucraRetirado ? "Retirado" : "Pendiente";
  const { lado1, lado2, aposto1, aposto2 } = ladosDeLaJugada(monto, estado, 0, 0, nombreJug);
  const esAdel = Boolean(t.esAdelantada) || esNombreModalidadAdelantada(nombreJug);
  return {
    clave: `ses-${t.id ?? ticketId ?? nombreJug}`,
    ticketId,
    jugada: nombreJug,
    caballo,
    monto,
    aposto1,
    aposto2,
    cliente1: TXT(t.cliente1),
    cliente2: resolverContraparteModalidad(nombreJug, t.cliente2),
    estado,
    estadoLiquidacion: involucraRetirado ? "Anulada" : "Pendiente",
    validada: ticketId !== null,
    anulada: involucraRetirado,
    soloSesion: true,
    premioSaldo: involucraRetirado ? 0 : esPremio ? mejor - monto : -monto,
    esPremio: involucraRetirado ? false : esPremio,
    tieneProyeccion: true,
    lado1,
    lado2,
    esAdelantada: esAdel,
    categoriaAdelantada: esAdel ? categoriaJugadaAdelantada(nombreJug) : undefined,
  };
}

/**
 * Arma las filas del panel: primero las persistidas (en el orden que trae la
 * base) y después las ventas de sesión que todavía no aparecen en la lista.
 * Incluye tanto jugadas en vivo como jugadas adelantadas (Tercios, Marcas,
 * Tablas, Remates y Dupletas) para que se visualicen en la sección
 * `⏳ JUGADAS ADELANTADAS (PRE-JUGADAS)`.
 */
export function armarFilasPreview(
  persistidas: JugadaPersistida[],
  sesion: TicketSesion[],
  pizarraPuestos?: string[],
  retirados?: Array<string | number>
): FilaPreviewCarrera[] {
  const ticketsSesion = sesion.filter((t) => TXT(t.comando) !== "");
  const porTicketId = new Map<string, TicketSesion>();
  for (const t of ticketsSesion) {
    if (t.ticketId == null) continue;
    porTicketId.set(String(t.ticketId), t);
  }

  const filas: FilaPreviewCarrera[] = [];
  const idsUsados = new Set<string>();

  for (const j of persistidas) {
    if (!TXT(j.nombre_jugada)) continue;
    const id = String(j.id ?? "").trim();
    const sesionDeFila = id ? porTicketId.get(id) : undefined;
    if (id) idsUsados.add(id);
    filas.push(filaDesdePersistida(j, sesionDeFila, pizarraPuestos, retirados));
  }

  for (const t of ticketsSesion) {
    const id = t.ticketId != null ? String(t.ticketId) : "";
    if (id && idsUsados.has(id)) continue;
    filas.push(filaDesdeSesion(t, retirados));
  }

  return filas;
}

/** Totales del panel (para el encabezado y el resumen del operador). */
export function resumenPreview(filas: FilaPreviewCarrera[]): {
  jugadas: number;
  validadas: number;
  soloSesion: number;
  monto: number;
} {
  let monto = 0;
  let validadas = 0;
  let soloSesion = 0;
  for (const f of filas) {
    // Una jugada ANULADA no suma al monto del panel: se devolvió el capital, así
    // que no es plata en juego. El conteo de jugadas sí la incluye (está en la
    // lista), pero no aporta al total de dinero.
    if (!f.anulada) monto += f.monto;
    if (f.validada) validadas += 1;
    if (f.soloSesion) soloSesion += 1;
  }
  return {
    jugadas: filas.length,
    validadas,
    soloSesion,
    monto: Math.round(monto * 100) / 100,
  };
}
