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
import { filtroDiaJornada, perteneceADiaJornada } from "@/features/liquidacion/lib/fecha";
import { listarCarrerasPorDia } from "@/features/tablas/lib/rpc";
import { pizarraDesdeNums, esVentaDeRemate } from "@/features/impresion/lib/reportGenerator";
import {
  desgloseJugada,
  esMarca,
  extraerPrecioUnitarioTabla,
  resolverContraparteModalidad,
} from "@/features/liquidacion/lib/etiquetas-reporte";
import { extraerOrdenLlegadaRaya, hayDistanciamientoPizarra } from "@/features/liquidacion/lib/posiciones";
import { rivalesDeNota } from "@/features/marcas/lib/reporte-marcas-nucleo";
import { calcularEstadoCuentaCliente, aplicarDevolucionIncentivoAFavor } from "@/features/saldos/lib/contabilidad-central";

export { calcularEstadoCuentaCliente, aplicarDevolucionIncentivoAFavor };
import { _reembolsosCruce } from "@/features/taquilla/lib/cruces-y-tapas";
import { liquidarOficial, puestosDesdeOrdenLlegada } from "@/features/motores/lib/oficiales";
import {
  numerosPizarra,
  netearComisionCruce,
  claveCruceFinanciero,
  type NeteoCruceItem,
  type TicketMotor,
} from "@/features/betting/lib/bettingEngine";
import { esPrincipalVigente, grupoActivoVigente, veTodosLosGruposVigente } from "@/features/seguridad/lib/vigente";
import { esAdelantadaDe } from "@/features/jugadas/lib/modalidad-tiempo";

export type FilaReporte = {
  id: string;
  rol: "Juega" | "Consigue" | "CRUCE";
  cliente: string;
  jugada: string;
  caballo: string;
  monto: number;
  /** Precio unitario del ejemplar en Tabla Fija (ej. 38 en "5 a 38"). */
  precioTabla?: number;
  /** Riesgo explícito de la fila (ej. en Marcas el que Da arriesga monto * 5/6; en Tablas Fijas arriesga el premio de la tabla). */
  riesgo?: number;
  /** Resultado NETO de la casa sobre esa fila; null = pendiente de liquidar. */
  resultado: number | null;
  esPareo?: boolean;
  /**
   * Desglose breve del/los ejemplar(es) SIN el tipo de jugada (Bloque 5):
   * "2 x 8" en Marcas, "6" en Tablas Fijas. Lo usa la sección «Parada
   * Adelantadas» del Reporte de Carrera; si falta se cae a `caballo`.
   */
  ejemplar?: string;
  /**
   * Tipo de jugada para clasificar en «Parada Adelantadas». Se guarda aparte
   * porque la columna "Jugada" ahora va compacta ("2 x 8", "TABLA FIJA 6") y
   * ya no se puede deducir la modalidad por el prefijo del texto.
   */
  tipoJugada?: "TABLA" | "MARCA" | null;
  /**
   * Modalidad de TIEMPO de la jugada (PROMPT #4): `true` = ⏳ ADELANTADA, o sea
   * cargada ANTES de que corra la carrera; `false`/ausente = ⚡ EN VIVO (la
   * regla histórica). Sale de `tickets_apuestas.es_adelantada` y alimenta el
   * filtro segmentado del Reporte de Liquidación.
   */
  esAdelantada?: boolean;
  /** Hora de carga de la jugada en formato HH:mm (extraída de fecha_registro). */
  horaCarga?: string | null;
};

export type CarreraReporte = {
  numero: number;
  hipodromo: string;
  fecha: string;
  pizarra: string | null;
  /** Orden de llegada en raya (1º · 2º · 3º…) cuando difiere de la pizarra oficial por distanciamiento. */
  pizarraRaya?: string | null;
  /** Ejemplares retirados oficialmente en la carrera. */
  retirados?: string[];
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

/** Extrae la hora de carga (HH:mm) de la jugada a partir de su timestamp de registro. */
export function formatearHoraCarga(f: Record<string, unknown>): string | null {
  const raw = txt(f.fecha_registro ?? f.created_at ?? "");
  if (!raw) return null;
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(raw)) return raw.slice(0, 5);
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleTimeString("es-VE", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
  const m = /(\d{2}:\d{2})/.exec(raw);
  return m ? m[1] : null;
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
  const rawCab = txt(f.caballo);
  const caballo =
    /\d/.test(rawCab)
      ? rawCab
      : f.ejemplar_numero != null && txt(f.ejemplar_numero) !== ""
        ? txt(f.ejemplar_numero)
        : rawCab;
  return {
    hipodromo,
    carrera: String(carrera),
    caballo,
    fechas: [],
    id: "reporte-" + txt(f.id),
    cruces: 1,
    cuota: null,
    total: monto,
    addedAt: 0,
    tipo_jugada: tipo,
    monto,
    puesto_final: puestoFinalDe(caballo, puestos),
    pizarra,
    // Sin esto el motor oficial liquidaba siempre a la par de la casa (2x/120x):
    // los dividendos que carga la casa se guardaban y NADIE los leia.
    dividendos,
    proporcion: proporcionDe(tipo),
    premio_por_tabla: /^TABLA\s+(\d+)/i.test(tipo) ? parseInt(tipo.match(/^TABLA\s+(\d+)/i)?.[1] ?? "2", 10) : null,
  };
}

function premioCongeladoDeNota(nota: unknown): number {
  if (!nota) return 0;
  try {
    const obj = typeof nota === "string" ? JSON.parse(nota) : nota;
    if (obj && typeof obj === "object") {
      const r = obj as Record<string, unknown>;
      return cifra(r.premio_congelado) || cifra(r.premio_por_tabla) || 0;
    }
  } catch {
    /* ignore */
  }
  return 0;
}

export function pagoPotencialTablaFija(f: Record<string, unknown>): number {
  const pagado = cifra(f.premio_pagar) || cifra(f.monto_decidido);
  if (pagado > 0) return Math.round(pagado * 100) / 100;
  const cant = Math.max(1, cifra(f.cantidad_tablas) || 1);
  const unit = cifra(f.premio_por_tabla) || premioCongeladoDeNota(f.nota_auditoria);
  if (unit > 0) return Math.round(cant * unit * 100) / 100;
  const monto = cifra(f.monto_jugado);
  return Math.round(monto * 2 * 100) / 100;
}

export type EvaluacionTicketReporte = {
  ok: boolean | null;
  bruto: number;
  comision: number;
  tasa: number;
  riesgoDa?: number;
  resultadoJuega?: number | null;
  resultadoDa?: number | null;
};

/** Evalúa un ticket: null = pendiente sin pizarra; true/false = decidido. */
function evaluar(
  f: Record<string, unknown>,
  hipodromo: string,
  carrera: string | number,
  pizarra: PizarraCarrera | null,
  tasaComision?: number | null
): EvaluacionTicketReporte {
  const estado = txt(f.estado).toUpperCase();
  const monto = cifra(f.monto_jugado);
  // Una jugada ANULADA es NEUTRA en el reporte: se devolvió el capital, así que
  // ni gana ni pierde ni paga comisión. Se decide ANTES de mirar el estado,
  // porque al anular el Monitor NO reescribe `estado` (sigue en
  // Ganador/Perdedor/Retirado): sin este corte, la anulada se evaluaba como
  // jugada vigente e inflaba el subtotal y el resumen de la carrera.
  if (f.anulada === true || estado === "ANULADO" || estado === "ANULADA") {
    return { ok: false, bruto: 0, comision: 0, tasa: 0, resultadoJuega: 0, resultadoDa: 0 };
  }
  const nombreJugada = txt(f.nombre_jugada).toUpperCase();
  const esTablaFija = nombreJugada.startsWith("TABLA FIJA");
  const tienePct =
    f.comision_porcentaje != null && String(f.comision_porcentaje).trim() !== "";
  const pct = cifra(f.comision_porcentaje);
  const tasaEfectiva = tienePct
    ? pct
    : Number.isFinite(Number(tasaComision)) && Number(tasaComision) >= 0
      ? Number(tasaComision)
      : 5;
  const tasaGrupoModalidad =
    cifra(f.banquero_comision_porcentaje) > 0
      ? cifra(f.banquero_comision_porcentaje)
      : pct > 0
        ? pct
        : Number.isFinite(Number(tasaComision)) && Number(tasaComision) >= 0
          ? Number(tasaComision)
          : 5;

  // ── REGLA CONTABLE DE MARCAS (Proporción 5/6) ──
  // Quien Juega arriesga `monto` y si gana cobra exactamente la proporción 5/6 sin descuento de comisión.
  // Quien Da (usuario asignado a Marcas / "Marcas") arriesga `monto * 5 / 6`:
  //   - Si gana el Jugador: Marcas pierde `pagoMarca + comisionGrupo(pagoMarca)`.
  //   - Si pierde el Jugador: Marcas gana `monto - comisionGrupo(monto)`.
  if (esMarca(nombreJugada)) {
    const pagoMarca = Math.round(((monto * 5) / 6) * 100) / 100;
    if (
      estado === "RETIRADO" ||
      estado === "EMPATE" ||
      estado === "SIN DECISION" ||
      estado === "SIN DECISIÓN"
    ) {
      return {
        ok: false,
        bruto: monto,
        comision: 0,
        tasa: tasaGrupoModalidad,
        riesgoDa: pagoMarca,
        resultadoJuega: 0,
        resultadoDa: 0,
      };
    }
    let ganaMarca: boolean | null = null;
    if ((pizarra?.puestos?.length ?? 0) > 0) {
      const numElegido = txt(f.ejemplar_numero) || (txt(f.caballo).match(/\d+/)?.[0] ?? "");
      let rivales = rivalesDeNota(f.nota_auditoria);
      if (rivales.length === 0) {
        const numsCab = (txt(f.caballo).match(/\d+/g) ?? []).map((x) => x.trim());
        if (numsCab.length >= 2) {
          rivales = numsCab.filter((n, idx) => idx > 0 && n !== numElegido);
        } else {
          const numsJug = (txt(f.nombre_jugada).match(/\d+/g) ?? []).map((x) => x.trim());
          rivales = numsJug.filter((n) => n !== numElegido);
        }
      }
      if (numElegido && rivales.length > 0) {
        const posElegido = pizarra!.puestos.findIndex((p) => txt(p) === numElegido);
        const posRivales = rivales.map((rv) => pizarra!.puestos.findIndex((p) => txt(p) === String(rv).trim()));
        if (posElegido === -1 && posRivales.every((pr) => pr === -1)) {
          // Ninguno de los ejemplares de la marca entró en pizarra oficial → SIN DECISIÓN (0 / 0)
          return {
            ok: false,
            bruto: monto,
            comision: 0,
            tasa: tasaGrupoModalidad,
            riesgoDa: pagoMarca,
            resultadoJuega: 0,
            resultadoDa: 0,
          };
        }
        if (posElegido !== -1 && posRivales.every((pr) => pr === -1 || posElegido < pr)) {
          ganaMarca = true;
        } else if (posRivales.some((pr) => pr !== -1 && (posElegido === -1 || pr <= posElegido))) {
          ganaMarca = false;
        }
      }
    }
    if (ganaMarca === null) {
      if (estado === "GANADOR" || estado === "GANO" || estado === "SOLUCIONADO") {
        ganaMarca = true;
      } else if (estado === "PERDEDOR" || estado === "PERDIO") {
        ganaMarca = false;
      }
    }
    if (ganaMarca === true) {
      const comGrupo = Math.round(pagoMarca * (tasaGrupoModalidad / 100) * 100) / 100;
      return {
        ok: true,
        bruto: Math.round((monto + pagoMarca) * 100) / 100,
        comision: comGrupo,
        tasa: tasaGrupoModalidad,
        riesgoDa: pagoMarca,
        resultadoJuega: pagoMarca,
        resultadoDa: -Math.round((pagoMarca + comGrupo) * 100) / 100,
      };
    }
    if (ganaMarca === false) {
      const comGrupo = Math.round(monto * (tasaGrupoModalidad / 100) * 100) / 100;
      return {
        ok: false,
        bruto: 0,
        comision: 0,
        tasa: tasaGrupoModalidad,
        riesgoDa: pagoMarca,
        resultadoJuega: -monto,
        resultadoDa: Math.round((monto - comGrupo) * 100) / 100,
      };
    }
    return {
      ok: null,
      bruto: 0,
      comision: 0,
      tasa: tasaGrupoModalidad,
      riesgoDa: pagoMarca,
      resultadoJuega: null,
      resultadoDa: null,
    };
  }

  // ── REGLA CONTABLE DE TABLAS FIJAS (TF / Usuario asignado a Tablas Fijas) ──
  // Se evalúa por Orden de Llegada en Raya (`puestosRaya[0]`).
  // Quien Juega arriesga `monto` y si gana cobra `pagoTabla` sin descuento de comisión.
  // Quien Da (TF) arriesga `pagoTabla`:
  //   - Si gana el Jugador: TF pierde `pagoTabla + comisionGrupo(pagoTabla)`.
  //   - Si pierde el Jugador: TF gana `monto - comisionGrupo(monto)`.
  if (esTablaFija) {
    const pagoTabla = pagoPotencialTablaFija(f);
    if (estado === "RETIRADO" || estado === "EMPATE") {
      return {
        ok: false,
        bruto: monto,
        comision: 0,
        tasa: tasaGrupoModalidad,
        riesgoDa: pagoTabla,
        resultadoJuega: 0,
        resultadoDa: 0,
      };
    }
    const puestosRaya = (pizarra?.puestosRaya?.length ? pizarra.puestosRaya : pizarra?.puestos) ?? [];
    const numEjemplar = txt(f.ejemplar_numero) || (/^\d+$/.test(txt(f.caballo)) ? txt(f.caballo) : "");
    let ganaTabla: boolean | null = null;
    if (puestosRaya.length > 0 && numEjemplar) {
      ganaTabla = txt(puestosRaya[0]) === numEjemplar;
    } else if (estado === "GANADOR" || estado === "GANO" || estado === "SOLUCIONADO") {
      ganaTabla = true;
    } else if (estado === "PERDEDOR" || estado === "PERDIO") {
      ganaTabla = false;
    }
    if (ganaTabla === true) {
      const comGrupo = Math.round(pagoTabla * (tasaGrupoModalidad / 100) * 100) / 100;
      return {
        ok: true,
        bruto: Math.round((monto + pagoTabla) * 100) / 100,
        comision: comGrupo,
        tasa: tasaGrupoModalidad,
        riesgoDa: pagoTabla,
        resultadoJuega: pagoTabla,
        resultadoDa: -Math.round((pagoTabla + comGrupo) * 100) / 100,
      };
    }
    if (ganaTabla === false) {
      const comGrupo = Math.round(monto * (tasaGrupoModalidad / 100) * 100) / 100;
      return {
        ok: false,
        bruto: 0,
        comision: 0,
        tasa: tasaGrupoModalidad,
        riesgoDa: pagoTabla,
        resultadoJuega: -monto,
        resultadoDa: Math.round((monto - comGrupo) * 100) / 100,
      };
    }
    return {
      ok: null,
      bruto: 0,
      comision: 0,
      tasa: tasaGrupoModalidad,
      riesgoDa: pagoTabla,
      resultadoJuega: null,
      resultadoDa: null,
    };
  }

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
  const esEspecialPersistencia = /^(DUPLETA|REMATE|POLLA)\b/i.test(nombreJugada);
  const esRemate = /^REMATE\b/i.test(nombreJugada);
  if (esRemate) {
    const puestosRaya = (pizarra?.puestosRaya?.length ? pizarra.puestosRaya : pizarra?.puestos) ?? [];
    const numEjemplar = txt(f.ejemplar_numero) || (/^\d+$/.test(txt(f.caballo)) ? txt(f.caballo) : "");
    if (puestosRaya.length > 0 && numEjemplar) {
      const ganoEnRaya = txt(puestosRaya[0]) === numEjemplar;
      if (!ganoEnRaya) {
        return { ok: false, bruto: 0, comision: 0, tasa: tasaEfectiva };
      }
      const brutoRemate = cifra(f.premio_pagar) || cifra(f.monto_decidido);
      if (brutoRemate > monto) {
        const d = desglosar(brutoRemate);
        return { ok: true, bruto: d.neto, comision: d.comision, tasa: tasaEfectiva };
      }
    }
  }
  const puestosAnticipados = pizarra?.puestos ?? [];
  if (
    estado !== "SOLUCIONADO" &&
    estado !== "RECHAZADO" &&
    !esEspecialPersistencia &&
    puestosAnticipados.length > 0 &&
    monto > 0
  ) {
    try {
      const r = liquidarOficial(
        ticketMotorDe(f, hipodromo, carrera, puestosAnticipados, pizarra?.dividendos ?? null),
        tasaEfectiva
      );
      if (!r.indeterminado) {
        return { ok: r.ok, bruto: r.totalClienteNeto, comision: r.gananciaCasa, tasa: tasaEfectiva };
      }
    } catch {
      // Si falla el motor oficial, continúa al respaldo por estado persistido
    }
  }
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
  if (estado === "RETIRADO" || estado === "EMPATE") {
    // Un ticket en estado RETIRADO / EMPATE (ej. Nini que llegó exactamente en
    // el puesto N, o ejemplar retirado con devolución de capital) recupera el
    // 100% del monto apostado: ni gana ni pierde ninguno de los dos lados (0/0).
    return { ok: false, bruto: monto, comision: 0, tasa: tasaEfectiva };
  }
  if (estado === "PERDEDOR" || estado === "PERDIO" || estado === "RECHAZADO" || estado === "ANULADO") {
    return { ok: false, bruto: 0, comision: 0, tasa: tasaEfectiva };
  }
  const puestos = pizarra?.puestos ?? [];
  if (puestos.length && monto > 0) {
    try {
      const r = liquidarOficial(
        ticketMotorDe(f, hipodromo, carrera, puestos, pizarra?.dividendos ?? null),
        tasaEfectiva
      );
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
  ev: EvaluacionTicketReporte
): number | null {
  if (ev.resultadoDa !== undefined) return ev.resultadoDa;
  if (ev.ok === null) return null;
  const brutoTotalJuega = ev.bruto + ev.comision;
  if (Math.abs(brutoTotalJuega - monto) < 0.005) return 0;
  if (brutoTotalJuega > monto) {
    return Math.round((monto - brutoTotalJuega) * 100) / 100;
  }
  const perdida = Math.max(0, monto - brutoTotalJuega);
  return Math.round((perdida - perdida * (ev.tasa / 100)) * 100) / 100;
}

/* ─────────────────────────── consultas ─────────────────────────── */

/** Pizarra oficial de una carrera tal como la cargo la casa. */
export type PizarraCarrera = {
  /** Orden de llegada oficial (1º, 2º, 3º…): `orden_llegada` si existe, si no `ganadores`. */
  puestos: string[];
  /** Orden de llegada en raya (1º, 2º, 3º…) para Tablas Fijas y Remates. */
  puestosRaya: string[];
  /** Pagos por $1 (`dividendos`): los usa el motor oficial de liquidacion. */
  dividendos: Record<string, number> | null;
  /** Ejemplares retirados oficialmente en la carrera. */
  retirados: string[];
};

export function extraerNumerosRetiradosDeTexto(raw: unknown): string[] {
  const s = String(raw ?? "").trim();
  if (!s || /NO\s+HUBO\s+RETIRO/i.test(s)) return [];
  return [...new Set((s.match(/\d+/g) ?? []).map((x) => x.trim()).filter(Boolean))];
}

export function extraerNumerosRetiradosDeCaballos(caballos: unknown): string[] {
  if (!Array.isArray(caballos)) return [];
  const out: string[] = [];
  for (const c of caballos as Array<Record<string, unknown>>) {
    if (c && typeof c === "object" && c.retirado === true) {
      const n = String(c.numero ?? c.dorsal ?? "").trim();
      if (/^\d+$/.test(n)) out.push(n);
    }
  }
  return out;
}

export function unirRetirados(...listas: Array<string[] | undefined | null>): string[] {
  const set = new Set<string>();
  for (const l of listas) {
    for (const item of l ?? []) {
      const n = String(item ?? "").trim();
      if (/^\d+$/.test(n)) set.add(n);
    }
  }
  return [...set].sort((a, b) => Number(a) - Number(b));
}

export function filtrarRetiradosSinLlegada(
  retirados: string[] | undefined | null,
  puestos?: string[] | null,
  puestosRaya?: string[] | null
): string[] {
  const enLlegada = new Set(
    [...(puestos ?? []), ...(puestosRaya ?? [])]
      .map((x) => String(x ?? "").trim())
      .filter(Boolean)
  );
  return unirRetirados(retirados).filter((n) => !enLlegada.has(n));
}

/** Normaliza una fila de `resultados_carreras` a la pizarra que usa el motor. */
export function normalizarPizarra(r: {
  ganadores?: unknown;
  orden_llegada?: unknown;
  dividendos?: unknown;
  retirados?: unknown;
}): PizarraCarrera | null {
  const oficial = puestosDesdeOrdenLlegada(r.orden_llegada);
  const puestos = oficial.length ? oficial : puestosDesdeOrdenLlegada(r.ganadores);
  const puestosRaya = extraerOrdenLlegadaRaya(r.orden_llegada, puestos);
  const div = r.dividendos;
  const dividendos =
    div && typeof div === "object" && !Array.isArray(div) ? (div as Record<string, number>) : null;
  const retirados = filtrarRetiradosSinLlegada(
    extraerNumerosRetiradosDeTexto(r.retirados),
    puestos,
    puestosRaya
  );
  if (!puestos.length && !dividendos && !retirados.length) return null;
  return { puestos, puestosRaya, dividendos, retirados };
}

export async function leerPizarra(fecha: string, hipodromo: string, carrera: number | string): Promise<PizarraCarrera | null> {
  if (!supabase) return null;
  try {
    const [resR, carR, tabR] = await Promise.all([
      supabase
        .from("resultados_carreras")
        .select("ganadores, orden_llegada, dividendos, retirados")
        .eq("fecha", fecha)
        .eq("carrera", carrera)
        .ilike("hipodromo", `%${hipodromo}%`),
      supabase
        .from("carreras")
        .select("retirados, caballos")
        .eq("fecha", fecha)
        .eq("carrera", carrera)
        .ilike("hipodromo", `%${hipodromo}%`),
      supabase
        .from("tablas_fijas")
        .select("retirados_oficiales, caballos")
        .eq("fecha", fecha)
        .eq("carrera", carrera)
        .ilike("hipodromo", `%${hipodromo}%`),
    ]);
    let data = resR.data as Array<Record<string, unknown>> | null;
    if (resR.error && /retirados/i.test(resR.error.message)) {
      const r2 = await supabase
        .from("resultados_carreras")
        .select("ganadores, orden_llegada, dividendos")
        .eq("fecha", fecha)
        .eq("carrera", carrera)
        .ilike("hipodromo", `%${hipodromo}%`);
      data = r2.data as Array<Record<string, unknown>> | null;
    }
    const retExtra: string[] = [];
    for (const row of (carR.data ?? []) as Array<Record<string, unknown>>) {
      retExtra.push(...extraerNumerosRetiradosDeTexto(row.retirados));
      retExtra.push(...extraerNumerosRetiradosDeCaballos(row.caballos));
    }
    for (const row of (tabR.data ?? []) as Array<Record<string, unknown>>) {
      retExtra.push(...extraerNumerosRetiradosDeTexto(row.retirados_oficiales));
      retExtra.push(...extraerNumerosRetiradosDeCaballos(row.caballos));
    }
    let basePizarra: PizarraCarrera | null = null;
    for (const row of data ?? []) {
      const norm = normalizarPizarra(row);
      if (norm) {
        if (!basePizarra) {
          basePizarra = norm;
        } else {
          if (!basePizarra.puestos.length && norm.puestos.length) {
            basePizarra.puestos = norm.puestos;
            basePizarra.puestosRaya = norm.puestosRaya;
          }
          if (!basePizarra.dividendos && norm.dividendos) basePizarra.dividendos = norm.dividendos;
          basePizarra.retirados = unirRetirados(basePizarra.retirados, norm.retirados);
        }
      }
    }
    const puestosFinal = basePizarra?.puestos ?? [];
    const puestosRayaFinal = basePizarra?.puestosRaya ?? [];
    const retiradosFinal = filtrarRetiradosSinLlegada(
      unirRetirados(basePizarra?.retirados, retExtra),
      puestosFinal,
      puestosRayaFinal
    );
    if (!basePizarra && !retiradosFinal.length) return null;
    return {
      puestos: puestosFinal,
      puestosRaya: puestosRayaFinal,
      dividendos: basePizarra?.dividendos ?? null,
      retirados: retiradosFinal,
    };
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
    const base = error
      ? []
      : ((data ?? []) as Record<string, unknown>[]).filter((r) => perteneceADiaJornada(r, dia));
    const extras = await leerJugadasModulosExtrasHipodromo(dia, hipodromo, String(carrera), base);
    return [...base, ...(extras.get(claveCarrera(carrera)) ?? [])];
  } catch {
    return [];
  }
}

/**
 * Importa jugadas registradas en módulos con tablas propias (`remates` + `remate_caballos`
 * aún no volcadas a `tickets_apuestas`, y `pollas` + `polla_ventas`) vinculadas a la
 * fecha de la carrera `dia`, para que TODOS los módulos alimenten el reporte del día
 * de la carrera sin importar cuándo se hayan registrado.
 */
export async function leerJugadasModulosExtrasHipodromo(
  dia: string,
  hipodromo: string,
  carreraFiltro: string | null,
  ticketsExistentes: Record<string, unknown>[]
): Promise<Map<string, Record<string, unknown>[]>> {
  const extras = new Map<string, Record<string, unknown>[]>();
  if (!supabase || !dia) return extras;
  const activo = grupoActivoVigente();
  const idsCaballosRemateEnTickets = new Set<string>();
  for (const t of ticketsExistentes) {
    const rawNota = String(t.nota_auditoria ?? "");
    const m = /"remate_caballo_id"\s*:\s*"([^"]+)"/.exec(rawNota);
    if (m?.[1]) idsCaballosRemateEnTickets.add(m[1]);
  }

  // 1) Remates de la fecha `dia` cuyas pujas con comprador aún no tienen ticket en `tickets_apuestas`
  try {
    let qr = supabase
      .from("remates")
      .select("id, nombre, hipodromo, carrera, fecha, comision_pct, grupo_id")
      .eq("fecha", dia)
      .ilike("hipodromo", `%${hipodromo}%`);
    if (carreraFiltro) qr = qr.eq("carrera", carreraFiltro);
    if (activo) qr = qr.eq("grupo_id", activo);
    const { data: remates } = await qr;
    const listaRemates = (remates ?? []) as Array<Record<string, unknown>>;
    if (listaRemates.length > 0) {
      const remateIds = listaRemates.map((r) => String(r.id ?? "")).filter(Boolean);
      const mapaRem = new Map(listaRemates.map((r) => [String(r.id ?? ""), r]));
      const { data: cabs } = await supabase
        .from("remate_caballos")
        .select("id, remate_id, numero, ejemplar_numero, nombre, monto_usd, cliente_id, clientes(nombre)")
        .in("remate_id", remateIds)
        .not("cliente_id", "is", null)
        .gt("monto_usd", 0);
      for (const c of (cabs ?? []) as Array<Record<string, unknown>>) {
        const cabId = String(c.id ?? "");
        if (!cabId || idsCaballosRemateEnTickets.has(cabId)) continue;
        const rem = mapaRem.get(String(c.remate_id ?? ""));
        if (!rem) continue;
        const k = claveCarrera(rem.carrera);
        if (!k) continue;
        const cliObj = c.clientes as { nombre?: unknown } | null;
        const numEj = String(c.ejemplar_numero ?? c.numero ?? "").trim();
        const sint: Record<string, unknown> = {
          id: `rem-cab-${cabId}`,
          fecha_registro: `${dia}T12:00:00.000Z`,
          fecha_carrera: dia,
          hipodromo: String(rem.hipodromo ?? hipodromo).toUpperCase(),
          carrera: Number(rem.carrera) || rem.carrera,
          nombre_jugada: `REMATE ${String(rem.hipodromo ?? hipodromo).toUpperCase()} (C${rem.carrera})`,
          caballo: numEj || String(c.nombre ?? ""),
          ejemplar_numero: Number(numEj) || null,
          monto_jugado: Number(c.monto_usd) || 0,
          monto_decidido: Number(c.monto_usd) || 0,
          premio_pagar: 0,
          cliente_juega_id: c.cliente_id,
          cliente_juega_nombre: cliObj?.nombre != null ? String(cliObj.nombre) : String(c.cliente_id ?? ""),
          cliente_consigue_nombre: "REMATES",
          comision_porcentaje: Number(rem.comision_pct) || 0,
          estado: "Pendiente",
          nota_auditoria: JSON.stringify({
            origen: "REMATE",
            remate_id: rem.id,
            remate_caballo_id: cabId,
            fecha_carrera: dia,
          }),
        };
        const arr = extras.get(k);
        if (arr) arr.push(sint);
        else extras.set(k, [sint]);
      }
    }
  } catch {
    /* best-effort */
  }

  // 2) Pollas de la fecha `dia` (ventas en `polla_ventas`)
  try {
    let qp = supabase.from("pollas").select("id, nombre, fecha, grupo_id, comision_pct, carreras").eq("fecha", dia);
    if (activo) qp = qp.eq("grupo_id", activo);
    const { data: pollas } = await qp;
    const listaPollas = (pollas ?? []) as Array<Record<string, unknown>>;
    const pollasHipo = listaPollas.filter((p) => {
      const carrs = Array.isArray(p.carreras) ? (p.carreras as Array<Record<string, unknown>>) : [];
      return carrs.some((c) => txt(c.hipodromo).toUpperCase().includes(txt(hipodromo).toUpperCase()));
    });
    if (pollasHipo.length > 0) {
      const pollaIds = pollasHipo.map((p) => String(p.id ?? "")).filter(Boolean);
      const mapaPolla = new Map(pollasHipo.map((p) => [String(p.id ?? ""), p]));
      const { data: ventasP } = await supabase
        .from("polla_ventas")
        .select("id, polla_id, cliente_id, pagado, combinaciones, texto_original, fecha_registro, clientes(nombre)")
        .in("polla_id", pollaIds);
      for (const vp of (ventasP ?? []) as Array<Record<string, unknown>>) {
        const polla = mapaPolla.get(String(vp.polla_id ?? ""));
        if (!polla) continue;
        const carrs = Array.isArray(polla.carreras) ? (polla.carreras as Array<Record<string, unknown>>) : [];
        const primeraHipo =
          carrs.find((c) => txt(c.hipodromo).toUpperCase().includes(txt(hipodromo).toUpperCase())) ?? carrs[0];
        const numCarrera = primeraHipo?.carrera ?? 1;
        const k = claveCarrera(numCarrera);
        if (carreraFiltro && k !== claveCarrera(carreraFiltro)) continue;
        const cliObj = vp.clientes as { nombre?: unknown } | null;
        const sint: Record<string, unknown> = {
          id: `polla-v-${vp.id}`,
          fecha_registro: vp.fecha_registro ?? `${dia}T12:00:00.000Z`,
          fecha_carrera: dia,
          hipodromo: String(primeraHipo?.hipodromo ?? hipodromo).toUpperCase(),
          carrera: Number(numCarrera) || 1,
          nombre_jugada: `POLLA ${String(polla.nombre ?? "").toUpperCase()} (${vp.combinaciones ?? 1} comb.)`,
          caballo: txt(vp.texto_original) || "POLLA",
          monto_jugado: Number(vp.pagado) || 0,
          monto_decidido: Number(vp.pagado) || 0,
          premio_pagar: 0,
          cliente_juega_id: vp.cliente_id,
          cliente_juega_nombre: cliObj?.nombre != null ? String(cliObj.nombre) : String(vp.cliente_id ?? ""),
          cliente_consigue_nombre: "POLLA",
          comision_porcentaje: Number(polla.comision_pct) || 0,
          estado: "Pendiente",
          nota_auditoria: JSON.stringify({
            origen: "POLLA",
            polla_id: polla.id,
            venta_id: vp.id,
            fecha_carrera: dia,
          }),
        };
        const arr = extras.get(k);
        if (arr) arr.push(sint);
        else extras.set(k, [sint]);
      }
    }
  } catch {
    /* best-effort */
  }

  return extras;
}

/** Hipódromos con actividad del día (Matriz carreras + Gaceta + tablas fijas + tickets). */
async function hipodromosDelDia(fecha: string): Promise<string[]> {
  const set = new Set<string>();
  const prog = await leerProgramaPorFecha(fecha);
  for (const h of prog.data?.hipodromos ?? []) if (txt(h)) set.add(txt(h).toUpperCase());
  for (const c of prog.data?.carreras ?? []) if (txt(c.hipodromo)) set.add(txt(c.hipodromo).toUpperCase());
  const sig = sumarDias(fecha, 1);
  if (supabase) {
    try {
      // MATRIZ MAESTRA DE CARRERAS: hipódromos oficialmente programados en la fecha.
      const { data: carrs, error } = await supabase
        .from("carreras")
        .select("hipodromo")
        .eq("fecha", fecha);
      if (!error) {
        for (const r of (carrs ?? []) as Array<{ hipodromo?: unknown }>) {
          if (txt(r.hipodromo)) set.add(txt(r.hipodromo).toUpperCase());
        }
      }
    } catch {
      /* sin tabla */
    }
    try {
      // TABLAS FIJAS: fecha del evento, o heredadas sin fecha creadas durante el día.
      const { data: tabs, error } = await supabase
        .from("tablas_fijas")
        .select("hipodromo")
        .eq("fecha", fecha);
      if (!error) for (const r of (tabs ?? []) as Array<{ hipodromo?: unknown }>) if (txt(r.hipodromo)) set.add(txt(r.hipodromo).toUpperCase());
      const { data: tabs2 } = await supabase
        .from("tablas_fijas")
        .select("hipodromo, fecha")
        .is("fecha", null)
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
        .select("hipodromo, fecha_carrera, fecha_registro, nota_auditoria")
        .or(filtroDiaJornada(dia));
      if (!e2) {
        for (const r of (tk2 ?? []) as Array<Record<string, unknown>>) {
          if (perteneceADiaJornada(r, dia) && txt(r.hipodromo)) {
            set.add(txt(r.hipodromo).toUpperCase());
          }
        }
      }
      // Remates del día
      const { data: rems } = await supabase.from("remates").select("hipodromo").eq("fecha", dia);
      for (const r of (rems ?? []) as Array<{ hipodromo?: unknown }>) {
        if (txt(r.hipodromo)) set.add(txt(r.hipodromo).toUpperCase());
      }
      // Dupletas del día
      const { data: dups } = await supabase.from("dupletas").select("hipodromo").eq("fecha", dia);
      for (const r of (dups ?? []) as Array<{ hipodromo?: unknown }>) {
        if (txt(r.hipodromo)) set.add(txt(r.hipodromo).toUpperCase());
      }
      // Pollas del día
      const { data: pols } = await supabase.from("pollas").select("carreras").eq("fecha", dia);
      for (const r of (pols ?? []) as Array<{ carreras?: unknown }>) {
        const carrs = Array.isArray(r.carreras) ? (r.carreras as Array<{ hipodromo?: unknown }>) : [];
        for (const c of carrs) {
          if (txt(c.hipodromo)) set.add(txt(c.hipodromo).toUpperCase());
        }
      }
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
    const filasValidas = error
      ? []
      : ((data ?? []) as Record<string, unknown>[]).filter((r) => perteneceADiaJornada(r, dia));
    for (const row of filasValidas) {
      const k = claveCarrera(row.carrera);
      const lista = porCarrera.get(k);
      if (lista) lista.push(row);
      else porCarrera.set(k, [row]);
    }
    const extras = await leerJugadasModulosExtrasHipodromo(dia, hipodromo, null, filasValidas);
    for (const [k, rowsExtra] of extras.entries()) {
      const lista = porCarrera.get(k);
      if (lista) lista.push(...rowsExtra);
      else porCarrera.set(k, [...rowsExtra]);
    }
    return porCarrera;
  } catch {
    return porCarrera;
  }
}

export async function leerPizarrasHipodromo(fecha: string, hipodromo: string): Promise<Map<string, PizarraCarrera | null>> {
  const porCarrera = new Map<string, PizarraCarrera | null>();
  if (!supabase) return porCarrera;
  try {
    const [resR, carR, tabR] = await Promise.all([
      supabase
        .from("resultados_carreras")
        .select("carrera, ganadores, orden_llegada, dividendos, retirados")
        .eq("fecha", fecha)
        .ilike("hipodromo", `%${hipodromo}%`),
      supabase
        .from("carreras")
        .select("carrera, retirados, caballos")
        .eq("fecha", fecha)
        .ilike("hipodromo", `%${hipodromo}%`),
      supabase
        .from("tablas_fijas")
        .select("carrera, retirados_oficiales, caballos")
        .eq("fecha", fecha)
        .ilike("hipodromo", `%${hipodromo}%`),
    ]);
    let data = resR.data as Array<Record<string, unknown>> | null;
    if (resR.error && /retirados/i.test(resR.error.message)) {
      const r2 = await supabase
        .from("resultados_carreras")
        .select("carrera, ganadores, orden_llegada, dividendos")
        .eq("fecha", fecha)
        .ilike("hipodromo", `%${hipodromo}%`);
      data = r2.data as Array<Record<string, unknown>> | null;
    }
    for (const row of data ?? []) {
      const k = claveCarrera(row.carrera);
      if (!k) continue;
      const norm = normalizarPizarra(row);
      const prev = porCarrera.get(k);
      if (!prev) {
        porCarrera.set(k, norm);
      } else if (norm) {
        porCarrera.set(k, {
          puestos: prev.puestos.length ? prev.puestos : norm.puestos,
          puestosRaya: prev.puestosRaya.length ? prev.puestosRaya : norm.puestosRaya,
          dividendos: prev.dividendos ?? norm.dividendos,
          retirados: unirRetirados(prev.retirados, norm.retirados),
        });
      }
    }
    const agregarRetiradosExtra = (k: string, nums: string[]) => {
      if (!k || nums.length === 0) return;
      const prev = porCarrera.get(k);
      if (prev) {
        prev.retirados = filtrarRetiradosSinLlegada(
          unirRetirados(prev.retirados, nums),
          prev.puestos,
          prev.puestosRaya
        );
      } else {
        porCarrera.set(k, { puestos: [], puestosRaya: [], dividendos: null, retirados: unirRetirados(nums) });
      }
    };
    for (const row of (carR.data ?? []) as Array<Record<string, unknown>>) {
      const k = claveCarrera(row.carrera);
      agregarRetiradosExtra(k, [
        ...extraerNumerosRetiradosDeTexto(row.retirados),
        ...extraerNumerosRetiradosDeCaballos(row.caballos),
      ]);
    }
    for (const row of (tabR.data ?? []) as Array<Record<string, unknown>>) {
      const k = claveCarrera(row.carrera);
      agregarRetiradosExtra(k, [
        ...extraerNumerosRetiradosDeTexto(row.retirados_oficiales),
        ...extraerNumerosRetiradosDeCaballos(row.caballos),
      ]);
    }
    return porCarrera;
  } catch {
    return porCarrera;
  }
}

/**
 * Carga en lote todas las pizarras (con retirados unificados de `resultados_carreras`,
 * `carreras` y `tablas_fijas`) para un conjunto de fechas. Se indexa por
 * `${fecha}|${hipodromoCanónico}|${carrera}` y `${fecha}|${hipodromoRaw}|${carrera}`.
 */
export async function leerPizarrasPorFechas(fechas: string[]): Promise<Map<string, PizarraCarrera>> {
  const mapa = new Map<string, PizarraCarrera>();
  if (!supabase || fechas.length === 0) return mapa;
  const fechasValidas = [...new Set(fechas.map((f) => String(f ?? "").slice(0, 10)).filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f)))];
  if (fechasValidas.length === 0) return mapa;

  const normHipo = (h: unknown) =>
    String(h ?? "")
      .trim()
      .toUpperCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Z0-9]/g, "");

  const fusionar = (f: string, hRaw: unknown, carrRaw: unknown, parcial: PizarraCarrera) => {
    const c = claveCarrera(carrRaw);
    const hTxt = txt(hRaw).toUpperCase();
    const hCan = normHipo(hRaw);
    if (!f || !c || (!hTxt && !hCan)) return;
    for (const hKey of new Set([hTxt, hCan].filter(Boolean))) {
      const k = `${f}|${hKey}|${c}`;
      const prev = mapa.get(k);
      if (!prev) {
        mapa.set(k, {
          puestos: [...parcial.puestos],
          puestosRaya: [...parcial.puestosRaya],
          dividendos: parcial.dividendos,
          retirados: filtrarRetiradosSinLlegada(parcial.retirados, parcial.puestos, parcial.puestosRaya),
        });
      } else {
        if (!prev.puestos.length && parcial.puestos.length) {
          prev.puestos = [...parcial.puestos];
          prev.puestosRaya = [...parcial.puestosRaya];
        }
        if (!prev.dividendos && parcial.dividendos) prev.dividendos = parcial.dividendos;
        prev.retirados = filtrarRetiradosSinLlegada(
          unirRetirados(prev.retirados, parcial.retirados),
          prev.puestos,
          prev.puestosRaya
        );
      }
    }
  };

  try {
    const [resR, carR, tabR] = await Promise.all([
      supabase
        .from("resultados_carreras")
        .select("fecha, hipodromo, carrera, ganadores, orden_llegada, dividendos, retirados")
        .in("fecha", fechasValidas),
      supabase
        .from("carreras")
        .select("fecha, hipodromo, carrera, retirados, caballos")
        .in("fecha", fechasValidas),
      supabase
        .from("tablas_fijas")
        .select("fecha, hipodromo, carrera, retirados_oficiales, caballos")
        .in("fecha", fechasValidas),
    ]);
    for (const row of (resR.data ?? []) as Array<Record<string, unknown>>) {
      const f = String(row.fecha ?? "").slice(0, 10);
      const norm = normalizarPizarra(row);
      if (norm) fusionar(f, row.hipodromo, row.carrera, norm);
    }
    for (const row of (carR.data ?? []) as Array<Record<string, unknown>>) {
      const f = String(row.fecha ?? "").slice(0, 10);
      const ret = unirRetirados(
        extraerNumerosRetiradosDeTexto(row.retirados),
        extraerNumerosRetiradosDeCaballos(row.caballos)
      );
      if (ret.length) fusionar(f, row.hipodromo, row.carrera, { puestos: [], puestosRaya: [], dividendos: null, retirados: ret });
    }
    for (const row of (tabR.data ?? []) as Array<Record<string, unknown>>) {
      const f = String(row.fecha ?? "").slice(0, 10);
      const ret = unirRetirados(
        extraerNumerosRetiradosDeTexto(row.retirados_oficiales),
        extraerNumerosRetiradosDeCaballos(row.caballos)
      );
      if (ret.length) fusionar(f, row.hipodromo, row.carrera, { puestos: [], puestosRaya: [], dividendos: null, retirados: ret });
    }
  } catch {
    /* best-effort */
  }
  return mapa;
}

export function buscarPizarraEnMapa(
  mapa: Map<string, PizarraCarrera> | undefined | null,
  fecha: string,
  hipodromo: string,
  carrera: number | string
): PizarraCarrera | null {
  if (!mapa || mapa.size === 0) return null;
  const f = String(fecha ?? "").slice(0, 10);
  const c = claveCarrera(carrera);
  const hTxt = txt(hipodromo).toUpperCase();
  const hCan = hTxt.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9]/g, "");
  return mapa.get(`${f}|${hTxt}|${c}`) ?? mapa.get(`${f}|${hCan}|${c}`) ?? null;
}

export type FilaTicketUnificada = {
  id: string;
  ticketId: string;
  rol: "Juega" | "Consigue";
  clienteId: string;
  clienteNombre: string;
  fechaCarrera: string;
  horaCarga: string | null;
  hipodromo: string;
  carrera: number;
  jugada: string;
  caballo: string;
  ejemplar?: string;
  tipoJugada?: "TABLA" | "MARCA" | null;
  esAdelantada: boolean;
  monto: number;
  riesgo: number;
  premio: number;
  resultado: number | null;
  estado: string;
  anulada: boolean;
};

/**
 * MOTOR UNIFICADO DE DESGLOSE POR TICKET (Juega + Consigue):
 * Usa exactamente la misma lógica que `carreraReporte` (Reportes Finales de Carreras)
 * para producir las filas `Juega` y `Consigue` de cualquier ticket, garantizando
 * que todos los reportes del sistema (Reporte Final de Carrera, Reporte Diario Admin,
 * Portal de Usuario y Estado de Cuenta) muestren exactamente las mismas jugadas,
 * descripciones, montos y resultados netos.
 */
export function desglosarTicketEnFilasUnificadas(
  f: Record<string, unknown>,
  pizarra: PizarraCarrera | null,
  tasaComision?: number | null
): { juega: FilaTicketUnificada; consigue: FilaTicketUnificada | null } {
  const idBase = txt(f.id) || "tk";
  const hipodromo = txt(f.hipodromo).toUpperCase() || "—";
  const carrera = Number(claveCarrera(f.carrera)) || 0;
  const fechaCarrera =
    txt(f.fecha_carrera).slice(0, 10) ||
    (() => {
      const m = /"fecha_carrera"\s*:\s*"(\d{4}-\d{2}-\d{2})"/.exec(String(f.nota_auditoria ?? ""));
      return m?.[1] ?? "";
    })() ||
    txt(f.fecha_registro).slice(0, 10);
  const horaCarga = formatearHoraCarga(f);
  const adelantada = esAdelantadaDe(f);
  const estadoRaw = txt(f.estado).toUpperCase();
  const anulada = f.anulada === true || estadoRaw === "ANULADO" || estadoRaw === "ANULADA";
  const monto = cifra(f.monto_jugado);
  const desglose = desgloseJugada(f);
  const ev = evaluar(f, hipodromo, carrera, pizarra, tasaComision);

  const clienteJuegaId = txt(f.cliente_juega_id);
  const clienteJuegaNombre = txt(f.cliente_juega_nombre) || clienteJuegaId || txt(f.cliente_juega) || "—";

  const clienteConsigueId = txt(f.cliente_consigue_id) || txt(f.banquero_cliente_id);
  const clienteConsigueRaw =
    txt(f.banquero_nombre) ||
    txt(f.cliente_consigue_nombre) ||
    clienteConsigueId;
  const clienteConsigueNombre = resolverContraparteModalidad(
    f.nombre_jugada,
    clienteConsigueRaw,
    desglose.tipo
  );

  const resultadoJuega =
    anulada
      ? 0
      : ev.resultadoJuega !== undefined
        ? ev.resultadoJuega
        : ev.ok === null
          ? null
          : Math.round((ev.bruto - monto) * 100) / 100;

  const resolverEstadoFila = (res: number | null): string => {
    if (anulada) return "ANULADA";
    if (res === null) return "PENDIENTE";
    if (res > 0) return "GANADOR";
    if (res < 0) return "PERDEDOR";
    if (desglose.tipo === "MARCA" && ((pizarra?.puestos?.length ?? 0) > 0 || /SIN\s+DECISI/i.test(estadoRaw))) {
      return "SIN DECISIÓN";
    }
    if (estadoRaw === "RETIRADO") return "RETIRADO";
    return "EMPATE";
  };

  const estadoJuega = resolverEstadoFila(resultadoJuega);
  const premioJuega =
    anulada || resultadoJuega === null
      ? 0
      : resultadoJuega > 0
        ? Math.round((monto + resultadoJuega) * 100) / 100
        : resultadoJuega === 0 && (estadoJuega === "RETIRADO" || estadoJuega === "EMPATE")
          ? monto
          : 0;

  const filaJuega: FilaTicketUnificada = {
    id: `${idBase}-j`,
    ticketId: idBase,
    rol: "Juega",
    clienteId: clienteJuegaId,
    clienteNombre: clienteJuegaNombre,
    fechaCarrera,
    horaCarga,
    hipodromo,
    carrera,
    jugada: desglose.jugada,
    caballo: desglose.caballo,
    ejemplar: desglose.ejemplar,
    tipoJugada: desglose.tipo,
    esAdelantada: adelantada,
    monto,
    riesgo: monto,
    premio: premioJuega,
    resultado: resultadoJuega,
    estado: estadoJuega,
    anulada,
  };

  let filaConsigue: FilaTicketUnificada | null = null;
  if (clienteConsigueNombre) {
    const resConsigue = anulada ? 0 : resultadoConsigueDe(monto, ev);
    const estadoConsigue = resolverEstadoFila(resConsigue);
    const premioConsigue =
      anulada || resConsigue === null
        ? 0
        : resConsigue > 0
          ? Math.round((monto + resConsigue) * 100) / 100
          : resConsigue === 0 && (estadoConsigue === "RETIRADO" || estadoConsigue === "EMPATE")
            ? monto
            : 0;
    filaConsigue = {
      id: `${idBase}-c`,
      ticketId: idBase,
      rol: "Consigue",
      clienteId: clienteConsigueId,
      clienteNombre: clienteConsigueNombre,
      fechaCarrera,
      horaCarga,
      hipodromo,
      carrera,
      jugada: desglose.jugada,
      caballo: desglose.caballo,
      ejemplar: desglose.ejemplar,
      tipoJugada: desglose.tipo,
      esAdelantada: adelantada,
      monto,
      riesgo: ev.riesgoDa ?? monto,
      premio: premioConsigue,
      resultado: resConsigue,
      estado: estadoConsigue,
      anulada,
    };
  }

  return { juega: filaJuega, consigue: filaConsigue };
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
  if (!tickets.length && !enTablas && !datos) {
    const carrerasMaestro = await listarCarrerasPorDia(fecha, hipodromo);
    if (!carrerasMaestro.includes(Number(numero))) return null;
  }
  // La carrera aparece si tiene jugadas, resultados de una carrera registrada en
  // la jornada o sus tablas publicadas (cargadas por el operador aunque aún no tengan tickets).
  if (!tickets.length && !enTablas && !pizarra?.puestos.length) return null;

  const filas: FilaReporte[] = [];
  const neteoItems: NeteoCruceItem[] = [];
  const meta: Array<{ cliente: string; clienteNombre: string; caballo: string }> = [];

  tickets.forEach((f, i) => {
    // Una jugada ANULADA no entra al reporte de liquidación: se devolvió el
    // capital y no se liquidó. Excluirla evita que reste el monto (como
    // "perdedora") o que infle el cruce y el resumen de la carrera.
    if (f.anulada === true) return;
    const monto = cifra(f.monto_jugado);
    // El cruce financiero agrupa por (cliente, caballo): ese agrupamiento y el
    // neteo usan el número TAL COMO está en el ticket, nunca el rotulado.
    const caballo = txt(f.caballo);
    const esPareo = caballo.toUpperCase().includes("X") || /^PP/i.test(txt(f.nombre_jugada));
    // BLOQUE 5: lo que se MUESTRA siempre lleva los ejemplares involucrados
    // (Marcas: "#8 vs #3"; Tablas Fijas: "#7 (Golfo)").
    const desglose = desgloseJugada(f);
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
    const clienteConsigueRaw =
      txt(f.banquero_nombre) ||
      txt(f.cliente_consigue_nombre) ||
      txt(f.cliente_consigue_id) ||
      txt(f.banquero_cliente_id);
    const clienteConsigueNombre = resolverContraparteModalidad(
      f.nombre_jugada,
      clienteConsigueRaw,
      desglose.tipo
    );

    const resultadoJuega =
      ev.resultadoJuega !== undefined
        ? ev.resultadoJuega
        : ev.ok === null
          ? null
          : Math.round((ev.bruto - monto) * 100) / 100;
    // Modalidad de TIEMPO: misma lectura para el que JUEGA y el que CONSIGUE
    // (es el mismo ticket, las dos filas se parean por índice).
    const adelantada = esAdelantadaDe(f);
    const horaCarga = formatearHoraCarga(f);
    const precioTabla = desglose.tipo === "TABLA" ? extraerPrecioUnitarioTabla(f) : undefined;
    filas.push({
      id: `${fecha}-${hipodromo}-${numero}-j-${i}`,
      rol: "Juega",
      cliente: clienteJuegaNombre || "—",
      jugada: desglose.jugada,
      caballo: desglose.caballo,
      monto,
      ...(precioTabla !== undefined ? { precioTabla } : {}),
      riesgo: monto,
      resultado: resultadoJuega,
      esPareo,
      ejemplar: desglose.ejemplar,
      tipoJugada: desglose.tipo,
      esAdelantada: adelantada,
      horaCarga,
    });

    if (clienteConsigueNombre) {
      filas.push({
        id: `${fecha}-${hipodromo}-${numero}-c-${i}`,
        rol: "Consigue",
        cliente: clienteConsigueNombre,
        jugada: desglose.jugada,
        caballo: desglose.caballo,
        monto,
        ...(precioTabla !== undefined ? { precioTabla } : {}),
        riesgo: ev.riesgoDa,
        resultado: resultadoConsigueDe(monto, ev),
        esPareo,
        ejemplar: desglose.ejemplar,
        tipoJugada: desglose.tipo,
        esAdelantada: adelantada,
        horaCarga,
      });
    }

    // Bruto ANTES de comisión (como en pagarYCerrar): neto + comisión casa.
    // Excluir empates Nini (donde bruto + comision === monto) para que no se
    // cuenten como pérdidas en el neteo de cruces.
    const esEmpateNini = ev.ok === false && Math.abs(ev.bruto + ev.comision - monto) < 0.01;
    if (!esEmpateNini) {
      neteoItems.push({
        cliente: clienteJuega,
        caballo,
        monto,
        bruto: ev.ok ? Math.round((ev.bruto + ev.comision) * 100) / 100 : Math.round((ev.bruto + ev.comision) * 100) / 100,
        ok: ev.ok === true,
      });
      meta.push({ cliente: clienteJuega, clienteNombre: clienteJuegaNombre, caballo });
    }
  });

  // 🔀 CRUCE FINANCIERO: comisión NETA por (cliente, caballo) con ≥2 tickets.
  const cruces = new Map<string, { cliente: string; caballo: string; comision: number }>();
  const gruposNeteo = netearComisionCruce(neteoItems, numero, tasaComision);
  meta.forEach((m, i) => {
    const k = claveCruceFinanciero(numero, m.cliente, m.caballo);
    const g = gruposNeteo.get(k);
    if (g && g.conteo >= 2 && g.comisionNeta > 0 && !cruces.has(k)) {
      // Reemplazado íntegramente por el asiento contable interno "Bono por Cruce de jugadas"
      void cruces;
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

  // 🔀 ASIENTO CONTABLE INTERNO: "Bono por Cruce de jugadas" por carrera y cliente.
  const lineasCruceCarrera = filas
    .filter((f) => f.rol !== "CRUCE" && f.resultado !== null && Number.isFinite(f.resultado))
    .map((f) => ({ cliente: f.cliente, resultado: f.resultado as number }));
  const { porCliente: reembolsosCrucePorCliente } = _reembolsosCruce(
    lineasCruceCarrera,
    "con_cruces",
    tasaComision ?? 5
  );
  for (const [claveCliente, info] of reembolsosCrucePorCliente.entries()) {
    if (info.reembolsoCruce > 0) {
      filas.push({
        id: `${fecha}-${hipodromo}-${numero}-bono-cruce-${claveCliente}`,
        rol: "CRUCE",
        cliente: info.cliente,
        jugada: "Bono por Cruce de jugadas",
        caballo: "",
        monto: 0,
        resultado: Math.round(info.reembolsoCruce * 100) / 100,
      });
    }
  }

  const subtotal = Math.round(filas.reduce((a, f) => a + (f.resultado ?? 0), 0) * 100) / 100;
  const puestos = pizarra?.puestos ?? [];
  const puestosRaya = pizarra?.puestosRaya ?? [];
  const pizarraRaya = hayDistanciamientoPizarra(puestos, puestosRaya) ? puestosRaya.join(" · ") : null;
  return {
    numero,
    hipodromo,
    fecha,
    pizarra: puestos.length ? puestos.join(" · ") : null,
    pizarraRaya,
    retirados: filtrarRetiradosSinLlegada(pizarra?.retirados, puestos, puestosRaya),
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
  const [numerosMaestro, ticketsPorCarrera, pizarrasPorCarrera, tablasPorCarrera] = await Promise.all([
    listarCarrerasPorDia(fecha, hipodromo),
    leerTicketsHipodromo(fecha, hipodromo),
    leerPizarrasHipodromo(fecha, hipodromo),
    leerTablasHipodromo(fecha, hipodromo),
  ]);
  const setNumeros = new Set<number>(numerosMaestro);
  for (const k of ticketsPorCarrera.keys()) {
    const n = Number(k);
    if (Number.isFinite(n) && n > 0) setNumeros.add(n);
  }
  for (const k of tablasPorCarrera) {
    const n = Number(k);
    if (Number.isFinite(n) && n > 0) setNumeros.add(n);
  }
  // NUNCA inventar carreras desde filas huérfanas de `resultados_carreras`
  // si la carrera no existe en el catálogo maestro (`carreras`), en `tablas_fijas`
  // ni tiene jugadas reales (`ticketsPorCarrera`) en esa fecha.
  const numeros = [...setNumeros].sort((a, b) => a - b);
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