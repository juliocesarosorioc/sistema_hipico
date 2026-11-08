/**
 * DERIVACIÓN PURA DEL SEMÁFORO DE CARRERAS.
 *
 * La máquina de estados (GRIS/VERDE/AMARILLO/ROJO y las transiciones
 * permitidas) vive en `semaforo-core.ts`. Este módulo es la capa que traduce
 * la DATA técnica de una carrera a los tres booleanos que consume esa máquina:
 *
 *   liquidada    → ROJO  (resultado aplicado a tablas / estado Liquidada)
 *   tieneJugadas → AMARILLO (si no está liquidada)
 *   tieneCaballos→ VERDE (si no tiene jugadas)
 *
 * REGLAS QUE ESTA CAPA GARANTIZA:
 *
 *  1. NO recibe la carrera seleccionada/activa. Seleccionar o deseleccionar
 *     una carrera no puede cambiar su color: el resaltado de la selección es
 *     otra capa (un anillo en el botón), nunca el estado.
 *  2. ROJO solo significa LIQUIDADA. Tener `ganadores`/resultados cargados
 *     (estado "Resultados") NO la pinta roja: mientras no se aplique a tablas
 *     sigue AMARILLA si tiene jugadas.
 *  3. Cuando el registro CENTRAL conoce la carrera, él manda. Las copias
 *     locales (`tabla.cerrada`, ledger del navegador) solo se usan como
 *     respaldo si el central no tiene la carrera, para que una copia vieja en
 *     localStorage no vuelva roja una carrera que fue REVERSADA (reabierta).
 *
 * Se mantiene como función pura (sin React, sin Supabase, sin Zustand) para
 * poder probarla de forma determinista en `pruebas/`.
 */

import {
  resolverEstadoSemaforo,
  type EstadoCarrera,
} from "@/features/gestion/lib/semaforo-core";

/** Los cuatro colores oficiales del semáforo (+ el alias `borrada`). */
export type EstadoSemaforoCarrera = EstadoCarrera;

export type EntradaEstadoSemaforo = {
  /** Número de carrera evaluado. */
  carrera: number | string;
  /** Fila del registro central (matriz `carreras` + resultado embebido). */
  central?: {
    estado?: string | null;
    aplicado_a_tablas?: boolean | null;
    ganadores?: readonly unknown[] | null;
    caballos?: readonly unknown[] | null;
    origen?: string | null;
    hora?: string | null;
    distancia?: string | null;
  } | null;
  /** Libro local de tablas fijas, YA filtrado por la jornada correcta. */
  tabla?: {
    cerrada?: boolean | null;
    estado?: string | null;
    cantidad_vendida?: number | null;
  } | null;
  /** Ledger local de carreras del día (`useCarrerasDiaStore`), misma jornada. */
  registro?: {
    estado?: string | null;
    aplicado_a_tablas?: boolean | null;
    ganadores?: readonly unknown[] | null;
    ventas?: readonly unknown[] | null;
  } | null;
  /** ¿Existen jugadas/tickets reales (persistidos o en sesión) para la carrera? */
  tieneJugadas?: boolean;
  /** ¿Tiene ejemplares/caballos registrados o precargados (> 0)? */
  tieneCaballos?: boolean;
  /** Carreras que el módulo padre ya conoce como liquidadas (respaldo). */
  carrerasLiquidadas?: readonly number[] | null;
  /** Carreras liquidadas leídas de BD (`aplicado_a_tablas === true`). */
  carrerasBdLiquidadas?: readonly number[] | null;
  /** Carreras reversadas en esta sesión: fuerzan NO liquidada hasta re-liquidar. */
  carrerasReversadas?: readonly number[] | null;
};

/** Normaliza un estado textual para compararlo sin depender de mayúsculas. */
function estadoTexto(valor: unknown): string {
  return String(valor ?? "").trim().toLowerCase();
}

function incluyeNumero(lista: readonly number[] | null | undefined, numero: number): boolean {
  return (lista ?? []).map(Number).includes(numero);
}

/**
 * ¿La fila del central es un placeholder de "Modo Manual" todavía vacío?
 * Se registra solo para poder abrir la carrera, pero aún no tiene ejemplares ni
 * datos propios: no debe pintarse VERDE como una carrera real.
 */
export function esPlaceholderManual(central: EntradaEstadoSemaforo["central"]): boolean {
  if (central == null) return false;
  return (
    estadoTexto(central.origen) === "manual" &&
    (central.caballos?.length ?? 0) === 0 &&
    !central.hora &&
    !central.distancia
  );
}

/**
 * Deriva el color del semáforo SOLO a partir de la data técnica de la carrera.
 *
 * No existe (ni debe existir) un parámetro de selección: el resultado es
 * determinista para el mismo estado de datos.
 */
export function estadoSemaforoCarrera(entrada: EntradaEstadoSemaforo): EstadoSemaforoCarrera {
  const numero = Number(entrada.carrera);
  if (!Number.isFinite(numero) || numero <= 0) return "inactiva";

  const central = entrada.central ?? null;
  const estCentral = estadoTexto(central?.estado);
  const aplicadoCentral = central?.aplicado_a_tablas === true;
  const conGanadores = (central?.ganadores?.length ?? 0) > 0;

  // El central puede decir EXPLÍCITAMENTE que la carrera volvió a "Programada"
  // (p. ej. después de reversar la liquidación). En ese caso, una copia local
  // vieja (tabla.cerrada o ledger) no puede volver a pintarla de rojo.
  const centralReabierta =
    central != null && estCentral === "programada" && !aplicadoCentral && !conGanadores;

  // ROJO = liquidada. Tener ganadores NO liquida: eso es "Resultados", que aún
  // no se aplicó a las tablas y por tanto sigue AMARILLO si tiene jugadas.
  const liquidadaCentral = aplicadoCentral || estCentral === "liquidada";

  // Respaldo local SOLO cuando el central no conoce la carrera (o no cargó).
  // Si el central existe manda él, para no revivir copias viejas del navegador.
  const liquidadaLocal =
    central == null &&
    (Boolean(entrada.tabla?.cerrada) ||
      estadoTexto(entrada.tabla?.estado) === "cerrada" ||
      estadoTexto(entrada.registro?.estado) === "liquidada" ||
      entrada.registro?.aplicado_a_tablas === true);

  // Una reversión explícita de la sesión manda sobre cualquier copia vieja:
  // mientras el operador no vuelva a liquidar, la carrera NO es ROJO.
  const reversada = incluyeNumero(entrada.carrerasReversadas, numero);

  // ROJO si CUALQUIERA de las fuentes confiables dice liquidada:
  //  - el central aplicado a tablas / estado "Liquidada",
  //  - la lista del padre o la detectada en BD (evidencia adicional),
  //  - las copias locales, SOLO si el central no conoce la carrera.
  // La reversión (sesión o central reabierto) siempre gana.
  const liquidada =
    reversada || centralReabierta
      ? false
      : liquidadaCentral ||
        incluyeNumero(entrada.carrerasLiquidadas, numero) ||
        incluyeNumero(entrada.carrerasBdLiquidadas, numero) ||
        liquidadaLocal;

  return resolverEstadoSemaforo({
    liquidada,
    tieneJugadas: Boolean(entrada.tieneJugadas),
    tieneCaballos: Boolean(entrada.tieneCaballos),
  });
}
