/**
 * ============================================================================
 * AGENTE DE PIZARRA — liquidar, anular por variación y rectificar
 * ============================================================================
 *
 * Interpreta los comandos de pizarra que el operador dicta al Agente (o pulsa en
 * la barra de Apuestas) y orquesta el ciclo completo SIN conocer la base de
 * datos: toda la E/S entra por un `PuertoPizarra`.
 *
 *   "Pizarra: 5 - 2 - 8 - 1 - 4" · "Llegada 5,2,8,1,4" · "Oficial C3: 1° 5, 2° 2, 3° 8"
 *        → liquida la carrera y entrega el mensaje de WhatsApp de resultados.
 *   "Anular pizarra por variación" · "Reversar pizarra"
 *        → revierte pagos, cobros, comisiones, cruces e incentivos y reabre la carrera.
 *   "Nueva pizarra: 2 - 5 - 8 - 1 - 4"
 *        → liquida de nuevo sobre los saldos limpios y entrega el mensaje rectificado.
 *
 * En producción el puerto envuelve `liquidarCarreraYCerrarTabla` +
 * `aplicarLiquidacionSaldos` (pagarYCerrar.ts / saldos.ts) y
 * `reversarLiquidacionCarrera` (reversar.ts → recalcular.ts / reversar-nucleo.ts);
 * en las pruebas es un libro en memoria sobre el MISMO motor de puestos.
 */
import { fmtMonto, pizarraDesdeNums } from "@/features/impresion/lib/reportGenerator";
import {
  mensajeResultadoDeCarrera,
  type OpcionesMensajeResultado,
} from "@/features/taquilla/lib/mensajeResultado";
import type { PizarraCarrera } from "@/features/liquidacion/lib/liquidacion";

export type ComandoPizarra =
  | { tipo: "LIQUIDAR"; nueva: boolean; llegada: string[]; carrera?: number }
  | { tipo: "ANULAR" }
  | { tipo: "INVALIDO"; motivo: string }
  | { tipo: "NINGUNO" };

/** Mínimo de puestos que hay que dictar para dar una pizarra por válida. */
export const PUESTOS_MINIMOS_PIZARRA = 3;

const sinTildes = (s: string): string =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const RE_ANULAR = /\b(?:anular|anula|anulen|reversar|reversa|revertir)\b[^.]*\bpizarra\b|\bpizarra\b[^.]*\b(?:anulada|reversada)\b/;
const RE_ENCABEZADO = /^(?:(nueva|corregida|rectificada)\s+)?(?:pizarra\s+oficial|pizarra|llegada|oficial|resultados?)\b/;

/** Interpreta un texto del operador como comando de pizarra (o `NINGUNO`). */
export function parsearComandoPizarra(texto: string): ComandoPizarra {
  const t = sinTildes(texto).replace(/\s+/g, " ").trim();
  if (!t) return { tipo: "NINGUNO" };
  if (RE_ANULAR.test(t)) return { tipo: "ANULAR" };

  const enc = RE_ENCABEZADO.exec(t);
  if (!enc) return { tipo: "NINGUNO" };
  let resto = t.slice(enc[0].length);

  let carrera: number | undefined;
  const mCarrera = /\b(?:c|carrera|carr)\s*#?\s*(\d{1,2})\b/.exec(resto);
  if (mCarrera) {
    carrera = Number(mCarrera[1]);
    resto = resto.replace(mCarrera[0], " ");
  }

  // Forma con ordinales: "1° 5, 2° 2, 3° 8".
  const ordinales = [...resto.matchAll(/(\d{1,2})\s*[°º]\s*[:=-]?\s*(\d{1,2})/g)];
  let llegada: string[];
  if (ordinales.length > 0) {
    const porPuesto = new Map<number, string>();
    for (const m of ordinales) porPuesto.set(Number(m[1]), String(Number(m[2])));
    llegada = [];
    for (let pos = 1; porPuesto.has(pos); pos++) llegada.push(porPuesto.get(pos)!);
    if (llegada.length !== porPuesto.size) {
      return { tipo: "INVALIDO", motivo: "Los puestos de la llegada tienen que ser consecutivos desde el 1°." };
    }
  } else {
    llegada = [...resto.matchAll(/\d{1,2}/g)].map((m) => String(Number(m[0])));
  }

  if (llegada.length < PUESTOS_MINIMOS_PIZARRA) {
    return {
      tipo: "INVALIDO",
      motivo: `Necesito al menos los ${PUESTOS_MINIMOS_PIZARRA} primeros puestos de la llegada (ej. «Pizarra: 5-2-8»).`,
    };
  }
  const repetido = llegada.find((n, i) => llegada.indexOf(n) !== i);
  if (repetido !== undefined) {
    return {
      tipo: "INVALIDO",
      motivo: `El ejemplar ${repetido} aparece repetido en la llegada. Un empate oficial se carga desde el modal de resultados.`,
    };
  }
  return { tipo: "LIQUIDAR", nueva: Boolean(enc[1]), llegada, ...(carrera !== undefined ? { carrera } : {}) };
}

/** Llegada (["5","2","8"]) → pizarra oficial del motor. */
export function pizarraDeLlegada(llegada: string[]): PizarraCarrera {
  return pizarraDesdeNums(llegada);
}

/** Bloque final `*💰 SALDOS*` del mensaje de WhatsApp (saldos reales ya actualizados). */
export function bloqueSaldos(saldos: Record<string, number>): string {
  const filas = Object.entries(saldos)
    .sort(([a], [b]) => a.localeCompare(b, "es"))
    .map(([nombre, saldo], i) => `${i + 1}) ${nombre} ${fmtMonto(saldo)}`);
  return ["*💰 SALDOS*", ...(filas.length ? filas : ["-"])].join("\n");
}

/**
 * Mensaje de WhatsApp COMPLETO que entrega el Agente tras liquidar: relación de
 * resultados (cabecera, pizarra oficial, jugadas, 🟢 POSITIVOS / 🔴 NEGATIVOS de
 * la carrera, observaciones de límites) + el bloque final de SALDOS actualizados.
 * Los incentivos se acreditan en silencio: no aparecen en el resumen de jugadas.
 */
export function construirMensajeResultadosAgente(
  opts: OpcionesMensajeResultado & { saldosFinales: Record<string, number> }
): string {
  const { saldosFinales, ...resto } = opts;
  return `${mensajeResultadoDeCarrera(resto)}\n\n${bloqueSaldos(saldosFinales)}`;
}

export const MENSAJE_PIZARRA_ANULADA =
  "🔄 Pizarra anulada por variación. Pagos y cobros revertidos; saldos restituidos. Ingresa la nueva pizarra oficial.";

export type PuertoPizarra = {
  /** Liquida la carrera con esa llegada (pagos, cobros, comisiones, cruces, incentivos). */
  liquidar(llegada: string[], pizarra: PizarraCarrera): Promise<{ ok: boolean; error?: string }>;
  /** Revierte por completo la liquidación vigente y deja las jugadas ACTIVAS. */
  reversar(): Promise<{ ok: boolean; error?: string }>;
  /** Mensaje de WhatsApp de resultados, ya con los saldos posteriores a la liquidación. */
  mensajeResultados(llegada: string[], pizarra: PizarraCarrera): Promise<string>;
};

export type EstadoPizarraAgente = { liquidada: boolean; llegada: string[] | null };

export type RespuestaPizarra = {
  ok: boolean;
  accion: "LIQUIDADA" | "RELIQUIDADA" | "ANULADA" | "RECHAZADA" | "NINGUNA";
  respuesta: string;
  mensajeWhatsapp?: string;
  estado: EstadoPizarraAgente;
};

export const ESTADO_PIZARRA_INICIAL: EstadoPizarraAgente = { liquidada: false, llegada: null };

/**
 * Ejecuta un comando de pizarra contra el puerto. NUNCA lanza: cualquier falla del
 * puerto vuelve como `ok: false` con el motivo, y el estado no cambia.
 */
export async function ejecutarComandoPizarra(
  texto: string,
  puerto: PuertoPizarra,
  estado: EstadoPizarraAgente = ESTADO_PIZARRA_INICIAL
): Promise<RespuestaPizarra> {
  const cmd = parsearComandoPizarra(texto);

  if (cmd.tipo === "NINGUNO") {
    return { ok: false, accion: "NINGUNA", respuesta: "No es un comando de pizarra.", estado };
  }
  if (cmd.tipo === "INVALIDO") {
    return { ok: false, accion: "RECHAZADA", respuesta: `⚠️ ${cmd.motivo}`, estado };
  }

  if (cmd.tipo === "ANULAR") {
    if (!estado.liquidada) {
      return { ok: false, accion: "RECHAZADA", respuesta: "No hay una pizarra liquidada para anular.", estado };
    }
    const r = await puerto.reversar();
    if (!r.ok) {
      return { ok: false, accion: "RECHAZADA", respuesta: `❌ No se pudo anular la pizarra: ${r.error ?? "error desconocido"}`, estado };
    }
    return {
      ok: true,
      accion: "ANULADA",
      respuesta: MENSAJE_PIZARRA_ANULADA,
      estado: { liquidada: false, llegada: null },
    };
  }

  // LIQUIDAR / NUEVA PIZARRA
  if (estado.liquidada && !cmd.nueva) {
    return {
      ok: false,
      accion: "RECHAZADA",
      respuesta: `⚠️ Ya hay una pizarra liquidada (${(estado.llegada ?? []).join("-")}). Escribe «Anular pizarra por variación» o «Nueva pizarra: …» para rectificarla.`,
      estado,
    };
  }

  let reliquidando = false;
  if (estado.liquidada && cmd.nueva) {
    const r = await puerto.reversar();
    if (!r.ok) {
      return { ok: false, accion: "RECHAZADA", respuesta: `❌ No se pudo anular la pizarra anterior: ${r.error ?? "error desconocido"}`, estado };
    }
    reliquidando = true;
  }

  const pizarra = pizarraDeLlegada(cmd.llegada);
  const liq = await puerto.liquidar(cmd.llegada, pizarra);
  if (!liq.ok) {
    // Si ya se había revertido la anterior, la carrera quedó abierta.
    const estadoFinal: EstadoPizarraAgente = reliquidando ? { liquidada: false, llegada: null } : estado;
    return { ok: false, accion: "RECHAZADA", respuesta: `❌ No se pudo liquidar la pizarra: ${liq.error ?? "error desconocido"}`, estado: estadoFinal };
  }

  const mensajeWhatsapp = await puerto.mensajeResultados(cmd.llegada, pizarra);
  const llegadaTxt = cmd.llegada.join("-");
  return {
    ok: true,
    accion: reliquidando ? "RELIQUIDADA" : "LIQUIDADA",
    respuesta: reliquidando
      ? `✅ Pizarra rectificada ${llegadaTxt}. Pagos y cobros recalculados sobre los saldos limpios. Aquí está el nuevo reporte de WhatsApp:`
      : `✅ Pizarra ${llegadaTxt} liquidada. Pagos, cobros y saldos actualizados. Aquí está el reporte de WhatsApp:`,
    mensajeWhatsapp,
    estado: { liquidada: true, llegada: cmd.llegada },
  };
}
