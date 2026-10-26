/**
 * BLOQUE 5 — DESGLOSE EXPLÍCITO DE EJEMPLARES EN EL REPORTE DE LIQUIDACIÓN.
 *
 * Regla de la casa: el reporte NUNCA puede mostrar una jugada sin los
 * ejemplares involucrados. La columna "Jugada" muestra SOLO el rótulo de la
 * modalidad; los ejemplares van como DISCOS de color que la plantilla pinta
 * desde `caballo` (un disco por número):
 *
 *  · Marcas → rótulo "MARCA" + discos "2 × 8" (o "(3, 5) × (8, 9)" con varios
 *    por lado). El ticket solo guarda el número ELEGIDO (`caballo` /
 *    `ejemplar_numero`); los rivales viven en `nota_auditoria.rivales_snapshot`
 *    —los mismos que lee `club_liquidar_marca`—, así que sin componerlo acá el
 *    reporte mostraba la marca a medias.
 *
 *  · Tablas Fijas → rótulo "TABLA FIJA" + disco del Nº de ejemplar (que el
 *    ticket congela en `ejemplar_numero`). Contra la pizarra lo que decide es
 *    el número, así que no se muestra el nombre ni el rótulo del hipódromo.
 *
 *  · Cualquier otra jugada se devuelve TAL CUAL (sin tocar la nomenclatura).
 *
 * Como la "Jugada" ya no lleva el prefijo de la modalidad, el desglose expone
 * también `tipo` ("TABLA" / "MARCA") para clasificar en «Parada Adelantadas».
 *
 * Lógica pura, sin I/O: la aplica `carreraReporte` al armar cada fila del
 * reporte (src/features/liquidacion/lib/reportes.ts) y se testea en node
 * (pruebas/desglose-reporte.test.ts).
 */
import { rivalesDeNota } from "@/features/marcas/lib/reporte-marcas-nucleo";

const txt = (v: unknown): string => (v == null ? "" : String(v).trim());

/** Números dentro de un valor suelto ("8" → ["8"], "3, 5" → ["3", "5"]). */
function numerosDe(v: unknown): string[] {
  return txt(v).match(/\d{1,2}/g) ?? [];
}

/** ¿La jugada es una Marca contra la banca ("MARCA 8")? */
export function esMarca(nombre: unknown): boolean {
  return /^MARCAS?\b/i.test(txt(nombre));
}

/** ¿La jugada es una Tabla Fija ("TABLA FIJA (HIPO C4)")? */
export function esTablaFija(nombre: unknown): boolean {
  return /^TABLA FIJA\b/i.test(txt(nombre));
}

/** Desglose de una jugada para el reporte de liquidación. */
export type DesgloseJugada = {
  /** Jugada rotulada con sus ejemplares (columna "Jugada" del reporte). */
  jugada: string;
  /** Ejemplar(es) para los discos de color ("8x3" se pinta "8 × 3"). */
  caballo: string;
  /** Desglose breve SIN el tipo de jugada (sección "Parada Adelantadas"). */
  ejemplar: string;
  /**
   * Tipo de jugada (para clasificar en «Parada Adelantadas»). Se expone acá
   * porque la columna "Jugada" se muestra COMPACTA ("2 x 8", "TABLA FIJA 6")
   * y ya no sirve para deducir la modalidad por el prefijo del texto.
   */
  tipo: "TABLA" | "MARCA" | null;
};

/** Marca: elegido (número del ticket) vs rivales (nota de auditoría). */
function desgloseMarca(f: Record<string, unknown>): DesgloseJugada {
  const nombre = txt(f.nombre_jugada);
  let elegidos = numerosDe(f.ejemplar_numero);
  if (!elegidos.length) elegidos = numerosDe(f.caballo);
  if (!elegidos.length) elegidos = numerosDe(nombre.replace(/^MARCAS?\s*#?/i, ""));
  if (!elegidos.length) {
    // Fila legacy sin número recuperable: no se inventa matchup.
    return { jugada: "MARCA", caballo: txt(f.caballo), ejemplar: "MARCA", tipo: "MARCA" };
  }
  const rivales = rivalesDeNota(f.nota_auditoria);
  // La columna "Jugada" muestra SOLO el rótulo "MARCA": los ejemplares van como
  // discos de color ("2 × 8") que la plantilla arma desde `caballo`.
  return {
    jugada: "MARCA",
    // Pareo estilo "8x3" / "3,5x8,9": la plantilla separa los lados y pinta
    // un disco por ejemplar de cada uno.
    caballo: rivales.length ? `${elegidos.join(",")}x${rivales.join(",")}` : elegidos.join(","),
    ejemplar: enfrentamientoDe(elegidos, rivales),
    tipo: "MARCA",
  };
}

/** "2 × 8" (o "(3, 5) × (8, 9)" con varios por lado); sin rivales, solo el elegido. */
function enfrentamientoDe(elegidos: string[], rivales: string[]): string {
  if (!rivales.length) return elegidos.join(", ");
  const lado = (ns: string[]) => (ns.length > 1 ? `(${ns.join(", ")})` : ns[0]);
  return `${lado(elegidos)} × ${lado(rivales)}`;
}

/** Tabla Fija: número del ticket + nombre congelado en `caballo`. */
function desgloseTablaFija(f: Record<string, unknown>): DesgloseJugada {
  const nombre = txt(f.nombre_jugada);
  const numero = txt(f.ejemplar_numero);
  const nombreEjemplar = txt(f.caballo);
  // TABLA COMPLETA (todos los caballos): sin número no hay qué desglosar.
  if (!numero) return { jugada: nombre, caballo: nombreEjemplar, ejemplar: nombreEjemplar, tipo: "TABLA" };
  // La columna "Jugada" muestra SOLO el rótulo "TABLA FIJA": el ejemplar va como
  // disco de color que la plantilla arma desde `caballo`.
  return {
    jugada: "TABLA FIJA",
    caballo: numero,
    ejemplar: numero,
    tipo: "TABLA",
  };
}

/**
 * Desglosa una fila cruda de `tickets_apuestas` para el reporte de
 * liquidación. Marcas y Tablas Fijas siempre muestran SUS ejemplares; el
 * resto de las jugadas pasa intacto.
 */
export function desgloseJugada(f: Record<string, unknown>): DesgloseJugada {
  const nombre = txt(f.nombre_jugada);
  if (esMarca(nombre)) return desgloseMarca(f);
  if (esTablaFija(nombre)) return desgloseTablaFija(f);
  return { jugada: nombre, caballo: txt(f.caballo), ejemplar: txt(f.caballo), tipo: null };
}


/**
 * Resuelve automáticamente el usuario contraparte ("Quien Da" / `cliente_consigue_nombre`)
 * según la modalidad de la jugada:
 *  - Marcas → "Marcas"
 *  - Tablas Fijas → "TF"
 *  - Dupleta → "Dupleta"
 *  - Remate → "Remate"
 *  - Pollas → "Polla"
 *  - Ganador (WPS) → "Win"
 *  - Place (WPS) → "Place"
 *  - Show (WPS) → "Show"
 */
export function resolverContraparteModalidad(
  nombreJugada: unknown,
  clienteDaActual?: unknown,
  origen?: unknown
): string {
  const jug = txt(nombreJugada).toUpperCase();
  const orig = txt(origen).toUpperCase();
  const actual = txt(clienteDaActual);

  if (/^MARCAS?\b/i.test(jug) || orig === "MARCAS" || orig === "MARCA") {
    return "Marcas";
  }
  if (/^(?:TABLA\s*FIJA|TABLAS?\s*FIJAS?|TABLA|TF)\b/i.test(jug) || orig === "TABLAS" || orig === "TABLA_FIJA") {
    return "TF";
  }
  if (/^DUPLETAS?\b/i.test(jug) || orig === "DUPLETAS" || orig === "DUPLETA") {
    return "Dupleta";
  }
  if (/^REMATES?\b/i.test(jug) || orig === "REMATES" || orig === "REMATE") {
    return "Remate";
  }
  if (/^POLLAS?\b/i.test(jug) || orig === "POLLAS" || orig === "POLLA") {
    return "Polla";
  }
  if (/^(?:WIN|W|GANADOR|WPS\s*WIN|WPS\s*W|WPS\s*GANADOR)$/i.test(jug)) {
    return "Win";
  }
  if (/^(?:PLACE|P|PLAC[EÉ]|WPS\s*PLACE|WPS\s*P)$/i.test(jug)) {
    return "Place";
  }
  if (/^(?:SHOW|S|WPS\s*SHOW|WPS\s*S)$/i.test(jug)) {
    return "Show";
  }

  return actual;
}
