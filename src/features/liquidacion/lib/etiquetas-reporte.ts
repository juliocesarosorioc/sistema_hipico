/**
 * BLOQUE 5 — DESGLOSE EXPLÍCITO DE EJEMPLARES EN EL REPORTE DE LIQUIDACIÓN.
 *
 * Regla de la casa: el reporte NUNCA puede mostrar una jugada sin los
 * ejemplares involucrados:
 *
 *  · Marcas contra la banca → "MARCA #8 vs #3" (o "MARCA (#3, #5) x
 *    (#8, #9)" cuando el matchup lleva varios ejemplares por lado). El ticket
 *    solo guarda el número ELEGIDO (`caballo` / `ejemplar_numero`); los
 *    rivales viven en `nota_auditoria.rivales_snapshot` —los mismos que lee
 *    `club_liquidar_marca`—, así que sin componerlo acá el reporte mostraba
 *    la marca a medias.
 *
 *  · Tablas Fijas → "TABLA FIJA (HIPO C4) · Caballo #7 (Golfo)". El ticket
 *    congela el NÚMERO en `ejemplar_numero` y el NOMBRE en `caballo`; el
 *    reporte antes mostraba solo el nombre (o nada si el ejemplar no tenía),
 *    y contra la pizarra lo que decide es el número.
 *
 *  · Cualquier otra jugada se devuelve TAL CUAL (sin tocar la nomenclatura).
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

/** "#8" para un ejemplar; "(#3, #5)" para un lado de varios. */
function ladoTexto(numeros: string[]): string {
  const lista = numeros.map((n) => `#${n}`);
  return lista.length > 1 ? `(${lista.join(", ")})` : (lista[0] ?? "");
}

/** Desglose de una jugada para el reporte de liquidación. */
export type DesgloseJugada = {
  /** Jugada rotulada con sus ejemplares (columna "Jugada" del reporte). */
  jugada: string;
  /** Ejemplar(es) para los discos de color ("8x3" se pinta "8 × 3"). */
  caballo: string;
  /** Desglose breve SIN el tipo de jugada (sección "Parada Adelantadas"). */
  ejemplar: string;
};

/** Marca: elegido (número del ticket) vs rivales (nota de auditoría). */
function desgloseMarca(f: Record<string, unknown>): DesgloseJugada {
  const nombre = txt(f.nombre_jugada);
  let elegidos = numerosDe(f.ejemplar_numero);
  if (!elegidos.length) elegidos = numerosDe(f.caballo);
  if (!elegidos.length) elegidos = numerosDe(nombre.replace(/^MARCAS?\s*#?/i, ""));
  if (!elegidos.length) {
    // Fila legacy sin número recuperable: no se inventa matchup.
    return { jugada: nombre || "MARCA", caballo: txt(f.caballo), ejemplar: txt(f.caballo) };
  }
  const rivales = rivalesDeNota(f.nota_auditoria);
  const elegido = ladoTexto(elegidos);
  const rival = ladoTexto(rivales);
  // 1 vs 1 → "vs"; dos lados con varios → "x" (el formato de la casa:
  // "MARCA (#3, #5) x (#8, #9)"); casos mixtos conservan el "vs".
  const enfrentamiento = !rival
    ? elegido
    : elegidos.length > 1 && rivales.length > 1
      ? `${elegido} x ${rival}`
      : `${elegido} vs ${rival}`;
  return {
    jugada: `MARCA ${enfrentamiento}`,
    // Pareo estilo "8x3" / "3,5x8,9": la plantilla separa los lados y pinta
    // un disco por ejemplar de cada uno.
    caballo: rivales.length ? `${elegidos.join(",")}x${rivales.join(",")}` : elegidos.join(","),
    ejemplar: enfrentamiento,
  };
}

/** Tabla Fija: número del ticket + nombre congelado en `caballo`. */
function desgloseTablaFija(f: Record<string, unknown>): DesgloseJugada {
  const nombre = txt(f.nombre_jugada);
  const numero = txt(f.ejemplar_numero);
  const nombreEjemplar = txt(f.caballo);
  // TABLA COMPLETA (todos los caballos): sin número no hay qué desglosar.
  if (!numero) return { jugada: nombre, caballo: nombreEjemplar, ejemplar: nombreEjemplar };
  const ejemplar = nombreEjemplar ? `#${numero} (${nombreEjemplar})` : `#${numero}`;
  return {
    jugada: `${nombre} · Caballo ${ejemplar}`,
    caballo: numero,
    ejemplar,
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
  return { jugada: nombre, caballo: txt(f.caballo), ejemplar: txt(f.caballo) };
}
