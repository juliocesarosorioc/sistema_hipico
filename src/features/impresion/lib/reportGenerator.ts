/**
 * Motor de reportes de texto (paridad con el flujo real de WhatsApp del club).
 *
 *  - Plantilla 1 · Relación de Jugadas (pre-carrera):
 *      Cabecera + cuerpo TERCIOS ("Juega X ... da Y") + pie estricto.
 *  - Plantilla 2 · Relación de Resultados (post-liquidación):
 *      Cabecera con Pizarra + jugadas numeradas con balance financiero según la
 *      regla del bettingEngine (comisión 5% SOLO sobre ganancia bruta) y cierre
 *      🟢 POSITIVOS (+) / 🔴 NEGATIVOS (-) por cliente.
 *  - Plantilla 3 · Reporte de Disponibilidad (saldos):
 *      Lista en dos columnas (nombre \t saldo) con separador de miles.
 *
 * Formato de montos local (es-VE): 40,00 / 2.951.
 */
import { supabase } from "@/core/supabase";
import { COMISION_CASA, parsearNini, normalizarNini } from "@/features/betting/lib/bettingEngine";
import { etiquetaJugada, caballoPareoLegible } from "@/features/taquilla/lib/nomenclatura";
import { liquidarOficial } from "@/features/motores/lib/oficiales";
import { filtroDiaJornada } from "@/features/liquidacion/lib/fecha";
import { _reembolsosCruce, normalizarNombreCliente } from "@/features/taquilla/lib/cruces-y-tapas";
import type { TicketMotor } from "@/features/betting/lib/bettingEngine";
import type { PizarraCarrera } from "@/features/liquidacion/lib/liquidacion";

// ============================================================
// Tipos
// ============================================================

export type MetaCarrera = {
  /** Nombre del grupo o hipódromo que encabeza la relación (🏇🏆...🏆🏇). */
  grupo?: string;
  /** Fecha de la relación (por defecto hoy). */
  fecha?: Date;
  hipodromo: string;
  carrera: number | string;
  retirados?: string;
  pizarra?: string;
  /** Números de los ejemplares (hasta 8 puestos) en orden de llegada, para
   *  resolver NINIS contra la pizarra oficial con el motor matemático. */
  pizarraPuestos?: string[];
  /** Pagos por $1 que cargo la casa en `resultados_carreras.dividendos`.
   *  Si falta la clave de la modalidad se conserva la paridad de la casa. */
  dividendos?: Record<string, number> | null;
};

export type JugadaRelacion = {
  /** Cliente que FINANCIA la jugada ("Juega"). */
  clienteJuega: string;
  /** Sigla del tipo de jugada (1P, 2T, 1/2, SEÑAL…). */
  jugada: string;
  /** Número/ejemplar apostado. */
  caballo: string;
  /** Monto financiado, en la moneda del ticket. */
  monto: number;
  /** Cliente que COBRA si acierta ("da [Cliente2]"). Opcional (jugada sola). */
  clienteConsigue?: string;
  /** Modalidad Normalizada del ticket ("NINI" cuando la jugada usa sintaxis N). */
  modalidad?: "NINI" | "GENERICA";
  cantidadTablas?: number;
  premioPorTabla?: number;
  /** Premio potencial bruto (tokenTable columna premio_potencial). */
  premioPotencial?: number;
  /** Comisión en porcentaje (por defecto COMISION_CASA.rate → 5%). */
  comisionPct?: number;
  /**
   * Si la jugada acertó (aplica a la Relación de Resultados).
   *
   * "pendiente": el motor SABE que la jugada podía ganar pero falta el dato que
   * cuantifica el premio (p. ej. la matriz W/P/S sin cargar). Se imprime la
   * jugada con un aviso y NO se la acumula en el cierre de clientes: marcarla
   * como ganada o perdida cobraría $ a una jugada aún no decidida.
   */
  ganador?: boolean | "pendiente";
};

export type SaldoCliente = {
  nombre?: string | null;
  saldo?: number | string | null;
};

export type FiltroCarrera = {
  hipodromo: string;
  carrera: number | string;
  /**
   * Fecha local (YYYY-MM-DD) de la jornada. Si se indica, los tickets se
   * acotan al MISMO día de la CARRERA (`filtroDiaJornada`) que usa el Reporte
   * de Liquidación. Sin esto, la relación de resultados mezclaba tickets de
   * otras fechas con el mismo hipódromo + N° de carrera y suministraba datos
   * distintos al reporte.
   */
  fecha?: string;
  /** Si true, solo tickets estado = Pendiente (relación pre-carrera). */
  soloPendientes?: boolean;
};

// ============================================================
// Formato local es-VE (40,00 / 2.951)
// ============================================================

const VE2 = new Intl.NumberFormat("es-VE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const VE0 = new Intl.NumberFormat("es-VE", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function fmtMonto(n: number | string | null | undefined): string {
  const num = Number(n);
  return VE2.format(Number.isFinite(num) ? num : 0);
}

/** Número entero con separador de miles: 2.951. */
export function fmtMiles(n: number | string | null | undefined): string {
  const num = Number(n);
  return VE0.format(Number.isFinite(num) ? num : 0);
}

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function num(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

/**
 * Tasa de comisión EFECTIVA de una jugada, en porcentaje. El `0` es un valor
 * válido (jugada sin comisión) y NO debe caer al default; solo un `comisionPct`
 * ausente (`undefined`/`null`) usa `COMISION_CASA` (5%).
 */
function tasaDeJugada(comisionPct: number | null | undefined): number {
  if (comisionPct == null) return COMISION_CASA.rate * 100;
  const n = Number(comisionPct);
  return Number.isFinite(n) && n >= 0 ? n : COMISION_CASA.rate * 100;
}

// ============================================================
// Pie estricto (se mantiene a toda costa en jugadas y resultados)
// ============================================================

export function pieEstricto(totalJugadas: number): string {
  return [
    `------------------------------`,
    `Total jugadas: ${totalJugadas}`,
    `------------------------------`,
    `PLANO REFERENCIAL`,
    `La guía es el chat`,
    `(se gana y se cobra con el chat)`,
    `USTED ES SU PROPIO CORREDOR`,
    `RECLAMOS AL PRIVADO`,
    `VERIFICAR SUS JUGADAS POR FAVOR`,
    `NO DIGA: ❌MALO❌; CASA FALTA...`,
    `TILDE SU JUGADA Y SE REVISARÁ`,
  ].join("\n");
}

export function cabeceraCarrera(meta: MetaCarrera): string {
  const fecha = meta.fecha ?? new Date();
  const weekday = cap(fecha.toLocaleDateString("es-VE", { weekday: "long" }));
  const dia = fecha.toLocaleDateString("es-VE", { day: "numeric" });
  const mes = cap(fecha.toLocaleDateString("es-VE", { month: "long" }));
  const anio = fecha.toLocaleDateString("es-VE", { year: "numeric" });
  const retirados = meta.retirados?.trim()
    ? meta.retirados.trim()
    : "NO HUBO RETIROS";
  const pizarra = meta.pizarra?.trim() ? meta.pizarra.trim() : ".....";
  return [
    `🏇🏆${meta.grupo ?? meta.hipodromo}🏆🏇`,
    `${weekday}, ${dia} de ${mes} de ${anio}`,
    `${meta.hipodromo}, ${meta.carrera} Carrera`,
    `Ret: ${retirados}`,
    `Pizarra: ${pizarra}`,
  ].join("\n");
}

// ============================================================
// Plantilla 1 · Relación de Jugadas (pre-carrera)
// Formato TERCIOS del club (mensaje del plano de jugadas):
//
//   🐎 NOMBRE DEL GRUPO 🐎
//   FECHA: Sábado, 10 de octubre de 2026
//   HIPÓDROMO Y CARRERA: Gulfstream Park, 9na Carrera
//   Ret:
//   Pizarra: .....
//
//   TERCIOS
//   1) Juega Yaiber 2Y2N (3) con 6.000,00 da Newyork
//   ...
//   ------------------------------
//   Total jugadas: 15
//   [pie del plano referencial]
// ============================================================

const LINEA_SEPARADOR = "------------------------------";

/** Cabecera del plano de jugadas: 🐎 … 🐎 con etiquetas FECHA / HIPÓDROMO Y CARRERA. */
export function cabeceraPlanoJugadas(meta: MetaCarrera): string {
  const fecha = meta.fecha ?? new Date();
  const weekday = cap(fecha.toLocaleDateString("es-VE", { weekday: "long" }));
  const dia = fecha.toLocaleDateString("es-VE", { day: "numeric" });
  const mes = cap(fecha.toLocaleDateString("es-VE", { month: "long" }));
  const anio = fecha.toLocaleDateString("es-VE", { year: "numeric" });
  const retirados = String(meta.retirados ?? "").trim();
  const pizarra = String(meta.pizarra ?? "").trim() || ".....";
  return [
    `🐎 ${String(meta.grupo ?? meta.hipodromo).trim()} 🐎`,
    `FECHA: ${weekday}, ${dia} de ${mes} de ${anio}`,
    `HIPÓDROMO Y CARRERA: ${meta.hipodromo}, ${meta.carrera} Carrera`,
    `Ret: ${retirados}`,
    `Pizarra: ${pizarra}`,
  ].join("\n");
}

/** Pie del plano referencial que acompaña a la relación de jugadas (pre-carrera). */
export function piePlanoJugadas(): string {
  return [
    LINEA_SEPARADOR,
    "PLANO REFERENCIAL",
    "La guía es el chat",
    "(se gana y se cobra con el chat)",
    "SEÑORES REVISAR SU POZO Y JUEGUEN SU DISPONIBLE ✅🚨",
    "Se pasan planos de jugadas y de pozo antes y después de la carrera POR FAVOR REVISAR Y VERIFICAR si nota algún error avisar de una vez para poder corregir al instante 🔴⚠️",
  ].join("\n");
}

export function relacionJugadas(meta: MetaCarrera, jugadas: JugadaRelacion[]): string {
  /* Línea del TERCIOS: "Juega {cliente} {jugada} ({caballo}) con {monto} da {consigue}".
     Se omiten los campos vacíos ("Juega Fabio (9x2) con …") para que la línea nunca
     quede con dobles espacios. El orden es el mismo de `fecha_registro` (cómo se
     cargaron las jugadas en la mesa). */
  const lineas = jugadas.map((j, i) => {
    const partes = [j.clienteJuega];
    const jugada = etiquetaJugada(String(j.jugada ?? ""));
    if (jugada) partes.push(jugada);
    if (String(j.caballo ?? "").trim()) partes.push(`(${caballoPareoLegible(String(j.caballo))})`);
    partes.push(`con ${fmtMonto(j.monto)}`);
    if (String(j.clienteConsigue ?? "").trim()) partes.push(`da ${String(j.clienteConsigue).trim()}`);
    return `${i + 1}) Juega ${partes.join(" ")}`;
  });
  return [
    cabeceraPlanoJugadas(meta),
    "",
    "TERCIOS",
    ...lineas,
    LINEA_SEPARADOR,
    `Total jugadas: ${jugadas.length}`,
    "",
    piePlanoJugadas(),
  ].join("\n");
}

// ============================================================
// Plantilla 2 · Relación de Resultados (post-liquidación)
// ============================================================

export type BalanceJugada = {
  jugada: JugadaRelacion;
  premioPotencial: number;
  gananciaBruta: number;
  comision: number;
  gananciaNeta: number;
  /** La jugada quedó ANULADA (empate oficial / el caballo terminó justo en el
   *  puesto N del NINI): el motor devuelve el capital y nadie gana ni pierde. */
  anulada?: boolean;
  /** La jugada GANÓ por posición pero falta el dato que cuantifica el premio
   *  (matriz W/P/S sin cargar): NO es una derrota. Se lista con aviso y no se
   *  acumula en el cierre. */
  indeterminado?: boolean;
};

/**
 * Regla del bettingEngine aplicada a una jugada:
 *   premioPotencial = premio a pagar (o cantidad × premio_por_tabla) si acertó, si no 0.
 *   gananciaBruta   = premioPotencial − monto (solo si > 0).
 *   comision        = gananciaBruta × (comisionPct ?? 5%) — SOLO sobre ganancia bruta.
 *   gananciaNeta    = gananciaBruta − comision  → lo que cobra el "Consigue".
 *   pérdida         = monto financiado          → lo que arriesgó el "Juega".
 */
export function balanceJugada(j: JugadaRelacion): BalanceJugada {
  const esGanador = j.ganador === true;
  let premioPotencial = esGanador
    ? num(j.premioPotencial) || num(j.cantidadTablas) * num(j.premioPorTabla)
    : 0;
  // NINI a la par: si no vino premio de la base, el premio bruto es 2× monto.
  if (j.modalidad === "NINI" && esGanador && premioPotencial <= 0) {
    premioPotencial = num(j.monto) * 2;
  }
  const gananciaBruta = Math.max(0, premioPotencial - num(j.monto));
  const comision =
    gananciaBruta > 0
      ? gananciaBruta * tasaDeJugada(j.comisionPct) / 100
      : 0;
  return {
    jugada: j,
    premioPotencial,
    gananciaBruta,
    comision,
    gananciaNeta: gananciaBruta - comision,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const CLAVES_PIZARRA = [
  "primero",
  "segundo",
  "tercero",
  "cuarto",
  "quinto",
  "sexto",
  "septimo",
  "octavo",
] as const;

/** Convierte una lista de números de ejemplares (hasta 8) en PizarraCarrera. */
export function pizarraDesdeNums(nums?: string[]): PizarraCarrera {
  const base: Record<string, string> = { primero: "" };
  (nums ?? []).slice(0, 8).forEach((v, i) => {
    base[CLAVES_PIZARRA[i]] = String(v).trim();
  });
  return base as unknown as PizarraCarrera;
}

/**
 * Resuelve el balance de UNA jugada con el MOTOR UNIVERSAL contra la pizarra
 * oficial (no contra `premio_pagar`, que sólo existe después de liquidar el
 * ticket).
 *
 * Antes esto se hacía SOLO para los NINI; el resto de modalidades (A PREMIO,
 * PUESTO, PAREOS, TABLAS, W/P/S…) caía a `balanceJugada`, que lee
 * `premio_pagar`. En una carrera con la pizarra ya cargada pero los tickets
 * todavía PENDIENTES (`premio_pagar = 0`), TODAS esas jugadas se marcaban como
 * perdidas y la Relación de WhatsApp salía INVERTIDA: los ganadores aparecían
 * en NEGATIVOS y los perdedores en POSITIVOS. Ahora, si hay pizarra, decide el
 * motor para cualquier modalidad (no sólo el NINI).
 */
function balanceDesdePizarra(
  j: JugadaRelacion,
  puestos: string[],
  dividendos: Record<string, number> | null
): BalanceJugada | null {
  if (!puestos.length || !j.caballo) return null;
  const monto = num(j.monto);
  if (monto <= 0) return null;
  const pizarra = pizarraDesdeNums(puestos);
  // El motor resuelve la posicion desde la pizarra. `puesto_final` se deja
  // coherente con ella y no inventado: antes iba fijo en 1, lo que hacia que
  // cualquier lectura del ticketDijera que el caballo salio primero.
  const idx = puestos.findIndex((p) => String(p).trim() === String(j.caballo).trim());
  const ticket: TicketMotor = {
    hipodromo: "",
    carrera: "",
    caballo: String(j.caballo).trim(),
    fechas: [],
    id: "reporte-" + j.clienteJuega,
    cruces: 1,
    cuota: null,
    total: num(j.monto),
    addedAt: 0,
    tipo_jugada: normNini(j.jugada),
    monto,
    puesto_final: (idx >= 0 ? idx + 1 : "SOC") as TicketMotor["puesto_final"],
    pizarra,
    dividendos,
    proporcion: proporcionDe(j.jugada),
    premio_por_tabla: premioTablaDe(j.jugada),
  };
  let r: ReturnType<typeof liquidarOficial>;
  try {
    r = liquidarOficial(ticket, num(j.comisionPct));
  } catch {
    // Nomenclatura irreconocible: no rompas la relación entera, cae a la vía
    // persistida (`balanceJugada`) con `null`.
    return null;
  }
  // El motor reconoció la POSICIÓN pero le falta el dato que cuantifica el
  // premio (p. ej. matriz W/P/S sin cargar): NO es una derrota.
  if (r.indeterminado) {
    return { jugada: j, premioPotencial: 0, gananciaBruta: 0, comision: 0, gananciaNeta: 0, indeterminado: true };
  }
  // ANULADA (empate oficial, o NINI que termina JUSTO en el puesto N): el motor
  // devuelve el capital — `totalClienteNeto` = monto — pero con ok:false. No es
  // una pérdida: el "Juega" recupera su capital y el "da" no entrega nada (0/0).
  // Sin este caso, `relacionResultados` la contaba como PERDIDA y le cobraba el
  // monto completo al que jugaba (y le abonaba la paridad al "da").
  if (!r.ok && r.totalClienteNeto > 0) {
    return { jugada: j, premioPotencial: 0, gananciaBruta: 0, comision: 0, gananciaNeta: 0, anulada: true };
  }
  // El BRUTO REAL de la jugada sale del motor (no de un ×2 fijo): las jugadas
  // que el motor resuelve como COMBINADA/COMPUESTA de un solo NINI, como
  // "2Y2N" (2p + 2n), pagan una fracción. El "da" entrega el BRUTO real
  // (premio − monto), no el monto entero.
  const premioPotencial = r.ok ? round2(r.totalClienteNeto + r.gananciaCasa) : 0;
  const gananciaBruta = r.ok ? round2(premioPotencial - monto) : 0;
  return {
    jugada: j,
    premioPotencial,
    gananciaBruta,
    comision: r.ok ? r.gananciaCasa : 0,
    gananciaNeta: r.ok ? round2(r.totalClienteNeto - monto) : 0,
  };
}

/** Proporción ("10/6") de una jugada a premio; null si no trae (igual que
 *  `reportes.ts::proporcionDe`: el motor re-parsea el tipo de todos modos). */
function proporcionDe(tipo: string): string | null {
  const m = /(\d+)\s*\/\s*(\d+)/.exec(String(tipo ?? ""));
  return m ? `${m[1]}/${m[2]}` : null;
}

/** Premio por tabla de una "TABLA N" (bruto = monto × N); null si no es tabla. */
function premioTablaDe(tipo: string): number | null {
  const t = String(tipo ?? "").toUpperCase();
  return /^TABLA\s+(\d+)/i.test(t)
    ? parseInt(t.match(/^TABLA\s+(\d+)/i)?.[1] ?? "2", 10)
    : null;
}

function normNini(tipo: string): string {
  const info = parsearNini(tipo);
  return info ? info.modalidad : String(tipo ?? "").trim().toUpperCase();
}

/**
 * Saldo ajustado (disponible) de un cliente por NOMBRE, sin distinguir
 * mayúsculas ni espacios. `undefined` = no hay dato (cliente libre o fuera del
 * mapa), y en ese caso la jugada NO se anota.
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
 * Relación de Resultados (mensaje de WhatsApp con el balance de dinero).
 *
 * `opts.saldos` (disponible por cliente) anota cada jugada con el saldo de
 * quien financia en *negrita* de WhatsApp, o `*S/S*` si quedó en 0; `opts.
 * observaciones` se anexa al pie. Ambos opcionales: sin ellos el texto es
 * idéntico al de siempre.
 */
export function relacionResultados(
  meta: MetaCarrera,
  jugadas: JugadaRelacion[],
  opts?: { saldos?: Record<string, number>; observaciones?: string }
): string {
  const cuerpo: string[] = [];
  const balances = new Map<string, number>();
  const nombreVisiblePorClave = new Map<string, string>();
  const lineasCruce: Array<{ cliente: string; resultado: number }> = [];
  const sinSaldo: string[] = [];

  const acumular = (nombre: string, valor: number) => {
    const clave = normalizarNombreCliente(nombre);
    if (!clave) return;
    const existente = nombreVisiblePorClave.get(clave);
    const limpio = String(nombre ?? "").trim();
    if (!existente || (existente === existente.toLowerCase() && limpio === limpio.toUpperCase())) {
      nombreVisiblePorClave.set(clave, limpio);
    }
    balances.set(clave, round2((balances.get(clave) ?? 0) + valor));
    lineasCruce.push({ cliente: nombreVisiblePorClave.get(clave) ?? limpio, resultado: valor });
  };

  /** Sufijo de disponible del que financia: ` · Disp *X*` o ` · Disp *S/S*`. */
  const sufijoSaldoDe = (j: JugadaRelacion): string => {
    if (!opts?.saldos) return "";
    const saldo = saldoAjustadoDe(opts.saldos, j.clienteJuega);
    if (saldo === undefined) return "";
    if (saldo > 0) return ` · Disp *${fmtMonto(saldo)}*`;
    const n = String(j.clienteJuega).trim();
    if (n && !sinSaldo.includes(n)) sinSaldo.push(n);
    return " · Disp *S/S*";
  };

  jugadas.forEach((j, i) => {
    const sufijoSaldo = sufijoSaldoDe(j);
    // Jugada aún no decidible (falta el dato que cuantifica el premio): se
    // lista con aviso y NO se acumula en el cierre de clientes.
    if (j.ganador === "pendiente") {
      cuerpo.push(
        `${i + 1}) ${etiquetaJugada(j.jugada)} (${caballoPareoLegible(j.caballo)}) con ${fmtMonto(j.monto)}${sufijoSaldo}`
      );
      cuerpo.push("  ⚠️ PENDIENTE — falta el dividendo que cuantifica el premio.");
      return;
    }
    // Si hay pizarra oficial y la jugada es evaluable por puestos/a premio/nini/pareo,
    // SIEMPRE evaluamos con `balanceDesdePizarra` primero para que jugadas multi-caballo
    // (ej. SAM 1P con "1 2 3" donde gana el #3) se liquiden correctamente incluso si en BD
    // tenían estado perdedor.
    const nombreJug = String(j.jugada ?? "").trim().toUpperCase();
    const esEspecial = /^(TABLA|MARCA|DUPLETA|REMATE|POLLA)\b/.test(nombreJug);
    const bPizarra =
      !esEspecial && (meta.pizarraPuestos?.length ?? 0) > 0
        ? balanceDesdePizarra(j, meta.pizarraPuestos ?? [], meta.dividendos ?? null)
        : null;
    const b =
      bPizarra ??
      (j.ganador === true
        ? balanceJugada(j)
        : balanceDesdePizarra(j, meta.pizarraPuestos ?? [], meta.dividendos ?? null) ??
          balanceJugada(j));
    // Leg "Juega": arriesga lo financiado. Leg "Consigue" (el "da"): cobra la
    // ganancia neta cuando el que juega NO acierta.
    const perdida = num(j.monto);
    const beneficiario = j.clienteConsigue || "";
    cuerpo.push(
      `${i + 1}) ${etiquetaJugada(j.jugada)} (${caballoPareoLegible(j.caballo)}) con ${fmtMonto(j.monto)}${sufijoSaldo}`
    );
    // ANULADA: el motor devolvió el capital, así que ni el que JUEGA gana/pierde
    // ni el "da" entrega nada. Se muestra 0/0 y NO se acumula en el cierre.
    if (b.anulada) {
      cuerpo.push(`Juega ${j.clienteJuega} $ +0,00`);
      if (beneficiario) cuerpo.push(`Consigue ${beneficiario} $ +0,00`);
      return;
    }
    // El motor reconoció la POSICIÓN pero falta el dividendo que cuantifica el
    // premio (p. ej. matriz W/P/S sin cargar): NO es una derrota. Se avisa y no
    // se acumula en el cierre (antes caía en el `else` y se cobraba como perdida).
    if (b.indeterminado) {
      cuerpo.push("⚠️ PENDIENTE — falta el dividendo que cuantifica el premio.");
      return;
    }
    // La jugada es de SUMA CERO entre el que JUEGA y el "da" (Consigue): el que
    // acierta cobra la ganancia neta y el otro entrega el monto financiado. La
    // decisión se toma por el RESULTADO (no por la modalidad): así la compuesta
    // "1Y2N Y 2N", que el motor clasifica GENERICA, también acredita y debita
    // bien cuando acierta (antes se liquidaba al revés, como si hubiera fallado).
    if (b.gananciaNeta > 0) {
      // Acertó el que JUEGA → cobra la ganancia neta; el "da" entrega SU riesgo,
      // que es el BRUTO de la jugada: el monto a la par, y 8/10·monto en "10a8".
      cuerpo.push(`Juega ${j.clienteJuega} $ +${fmtMonto(b.gananciaNeta)}`);
      acumular(j.clienteJuega, round2(b.gananciaNeta));
      if (beneficiario) {
        const perdidaDa = round2(b.gananciaBruta);
        cuerpo.push(`Consigue ${beneficiario} $ -${fmtMonto(perdidaDa)}`);
        acumular(beneficiario, -perdidaDa);
      }
    } else if (j.modalidad === "NINI") {
      // Falló el NINI (el caballo figuró) → pierde el que JUEGA; el "da" cobra la paridad neta.
      cuerpo.push(`Juega ${j.clienteJuega} $ -${fmtMonto(perdida)}`);
      acumular(j.clienteJuega, -perdida);
      if (beneficiario) {
        const porUno = Number(meta.dividendos?.nini);
        const mult = Number.isFinite(porUno) && porUno >= 1 ? porUno : 2;
        const premioNini = num(j.monto) * mult;
        const tasa = tasaDeJugada(j.comisionPct);
        const com2 = round2((premioNini - num(j.monto)) * (tasa / 100));
        const netoC2 = round2(premioNini - com2 - num(j.monto));
        cuerpo.push(`Consigue ${beneficiario} $ +${fmtMonto(netoC2)}`);
        acumular(beneficiario, netoC2);
      }
    } else {
      // Jugada genérica fallida → pierde el que JUEGA; el "da" (banquero) cobra
      // la PARIDAD NETA, igual que un NINI fallido, sin importar la modalidad
      // (suma cero: lo que pierde el que JUEGA menos la comisión de la casa).
      cuerpo.push(`Juega ${j.clienteJuega} $ -${fmtMonto(perdida)}`);
      acumular(j.clienteJuega, -perdida);
      if (beneficiario) {
        const tasa = tasaDeJugada(j.comisionPct);
        const netoDa = round2(perdida - perdida * (tasa / 100));
        cuerpo.push(`Consigue ${beneficiario} $ +${fmtMonto(netoDa)}`);
        acumular(beneficiario, netoDa);
      }
    }
  });

  // Asiento contable interno "Bono por Cruce de jugadas": no se muestra en el detalle
  // de jugadas pero se contabiliza en el cierre de POSITIVOS (+) y NEGATIVOS (-).
  const { porCliente: reembolsosCruce } = _reembolsosCruce(lineasCruce, "con_cruces", 5);
  for (const [clave, info] of reembolsosCruce.entries()) {
    if (info.reembolsoCruce > 0) {
      balances.set(clave, round2((balances.get(clave) ?? 0) + info.reembolsoCruce));
    }
  }

  const positivos = [...balances.entries()]
    .map(([clave, v]) => [nombreVisiblePorClave.get(clave) ?? clave, v] as [string, number])
    .filter(([, v]) => v > 0.0001)
    .sort((a, b) => b[1] - a[1]);
  const negativos = [...balances.entries()]
    .map(([clave, v]) => [nombreVisiblePorClave.get(clave) ?? clave, v] as [string, number])
    .filter(([, v]) => v < -0.0001)
    .sort((a, b) => a[1] - b[1]);

  const cierre: string[] = ["🟢 POSITIVOS (+)"];
  if (positivos.length === 0) cierre.push("—");
  else positivos.forEach(([nombre, valor], i) => cierre.push(`${i + 1}) ${nombre} +${fmtMonto(valor)}`));
  cierre.push("🔴 NEGATIVOS (-)");
  if (negativos.length === 0) cierre.push("—");
  else negativos.forEach(([nombre, valor], i) => cierre.push(`${i + 1}) ${nombre} -${fmtMonto(Math.abs(valor))}`));

  // Notas al pie: la leyenda S/S + la lista de jugadores sin saldo disponible,
  // y por último las observaciones libres del operador.
  const notas: string[] = [];
  if (sinSaldo.length) {
    notas.push("S/S = Sin saldo");
    notas.push(`⚠️ Sin saldo disponible: ${sinSaldo.join(", ")}`);
  }
  const observaciones = opts?.observaciones?.trim();

  return [
    cabeceraCarrera(meta),
    "",
    ...cuerpo,
    "",
    ...cierre,
    "",
    pieEstricto(jugadas.length),
    ...notas,
    ...(observaciones ? ["", "📝 Observaciones:", observaciones] : []),
  ].join("\n");
}

// ============================================================
// Plantilla 3 · Reporte de Disponibilidad (saldos)
// ============================================================

export function reporteDisponibilidad(clientes: SaldoCliente[]): string {
  const cabe = `🏇🏆 TERCIOS DISPONIBLE 🏆🏇`;
  const listado = clientes.map((c) => `${String(c.nombre ?? "—")}\t${fmtMiles(num(c.saldo))}`).join("\n");
  return [cabe, "", listado].join("\n");
}

// ============================================================
// Datos reales: jugadas de una carrera (tickets_apuestas)
// ============================================================

export type TicketApuestaJugada = {
  id: string;
  nombre_jugada?: string | null;
  caballo?: string | null;
  cantidad_tablas?: number | string | null;
  monto_jugado?: number | string | null;
  premio_pagar?: number | string | null;
  premio_por_tabla?: number | string | null;
  comision_porcentaje?: number | string | null;
  estado?: string | null;
  cliente_juega_nombre?: string | null;
  cliente_consigue_nombre?: string | null;
};

/**
 * ¿La fila es una VENTA DE REMATE? Esas ventas caen en `tickets_apuestas` con
 * el mismo hipódromo y N° de carrera que la carrera del día, pero NO son
 * apuestas de esa carrera: son ventas de caballos. Se marcan por el prefijo de
 * `nombre_jugada` ("REMATE …") porque `origen` solo vive en `nota_auditoria`.
 *
 * Fuente ÚNICA de la regla: la usan tanto la relación de WhatsApp
 * (`cargarJugadasDeCarrera`) como el Reporte de Liquidación (`reportes.ts`),
 * para que ambos suministren la MISMA lista de jugadas.
 */
export function esVentaDeRemate(nombreJugada: unknown): boolean {
  return String(nombreJugada ?? "").trim().toUpperCase().startsWith("REMATE ");
}

function mapearJugada(r: TicketApuestaJugada): JugadaRelacion {
  const jugadaCruda = String(r.nombre_jugada ?? "").trim();
  const esNini = parsearNini(jugadaCruda) !== null;
  return {
    clienteJuega: String(r.cliente_juega_nombre ?? "—"),
    jugada: esNini ? normalizarNini(jugadaCruda) : jugadaCruda,
    caballo: String(r.caballo ?? "").trim(),
    monto: num(r.monto_jugado),
    clienteConsigue: r.cliente_consigue_nombre ? String(r.cliente_consigue_nombre) : undefined,
    modalidad: esNini ? "NINI" : "GENERICA",
    cantidadTablas: num(r.cantidad_tablas),
    premioPorTabla: num(r.premio_por_tabla),
    premioPotencial: num(r.premio_pagar),
    comisionPct: r.comision_porcentaje != null ? num(r.comision_porcentaje) : undefined,
    ganador: num(r.premio_pagar) > 0,
  };
}

export async function cargarJugadasDeCarrera(
  filtro: FiltroCarrera
): Promise<JugadaRelacion[]> {
  if (!supabase) return [];
  try {
    let q = supabase
      .from("tickets_apuestas")
      .select(
        "id, nombre_jugada, caballo, cantidad_tablas, monto_jugado, premio_pagar, premio_por_tabla, comision_porcentaje, estado, cliente_juega_nombre, cliente_consigue_nombre"
      )
      // Mismo emparejamiento de hipódromo que el Reporte de Liquidación
      // (`reportes.ts` usa `.ilike("%hip%")`): el hipódromo puede venir con
      // variantes de mayúsculas/espacios y la comparación exacta dejaba la
      // lista vacía o distinta a la del reporte.
      .ilike("hipodromo", `%${String(filtro.hipodromo).trim().toUpperCase()}%`)
      .eq("carrera", num(filtro.carrera))
      .order("fecha_registro", { ascending: true });
    // Acotar a la MISMA ventana de fecha que el Reporte de Liquidación. Sin
    // esto, la relación de resultados mezclaba tickets de otras fechas con el
    // mismo hipódromo + N° de carrera (datos distintos al reporte).
    if (filtro.fecha) {
      q = q.or(filtroDiaJornada(String(filtro.fecha)));
    }
    if (filtro.soloPendientes) {
      q = q.eq("estado", "Pendiente");
    }
    const { data, error } = await q;
    if (error) throw error;
    // VENTAS DE REMATE fuera: no son apuestas de la carrera (misma regla que el
    // Reporte de Liquidación vía `esVentaDeRemate`).
    const filas = (data ?? []).filter(
      (r) => !esVentaDeRemate((r as { nombre_jugada?: unknown }).nombre_jugada)
    );

    // Evitar duplicados por ID (defensa ante escrituras dobles en tickets_apuestas)
    const vistos = new Set<string>();
    const unicas: Array<Record<string, unknown>> = [];
    for (const r of filas) {
      const id = String((r as { id?: unknown }).id ?? "").trim();
      if (id && vistos.has(id)) continue;
      if (id) vistos.add(id);
      unicas.push(r as Record<string, unknown>);
    }

    return unicas
      .map((r) => mapearJugada(r as unknown as TicketApuestaJugada))
      .filter((j) => j.clienteJuega !== "—" && (j.jugada || j.caballo) && j.monto > 0);
  } catch {
    return [];
  }
}