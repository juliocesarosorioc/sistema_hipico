/**
 * SEMÁFORO DE CARRERAS — MÁQUINA DE ESTADOS DETERMINÍSTICA ESTRICTA (4 ESTADOS)
 *
 * REGLAS OFICIALES:
 * 1. GRIS (inactiva): Si la carrera no tiene ni registros de jugadas ni caballos su color es GRIS.
 * 2. VERDE (abierta): Si la carrera tiene caballos registrados (precargado), es VERDE.
 * 3. AMARILLO (con_jugadas): Si hay jugadas y no está liquidada es AMARILLO.
 * 4. ROJO (cerrada): Si se liquidaron las jugadas es ROJO.
 *
 * TRANSICIONES ESTRICTAS:
 * - Luego de liquidada (ROJO) SOLO puede pasar a AMARILLO si se reversa.
 * - Luego de estar en AMARILLO SOLO puede pasar a VERDE si tiene caballos registrados y se borran todas las jugadas.
 * - Y SOLO puede pasar de vuelta a GRIS si se eliminan todos los caballos de la carrera.
 * - NO hay manera que pase de un color a otro de forma diferente.
 */

export type EstadoCarrera = "inactiva" | "abierta" | "con_jugadas" | "cerrada" | "borrada";

export type ConfigColorCarrera = {
  chip: string;
  label: string;
  txt: string;
  hex: string;
  colorName: "gris" | "verde" | "amarillo" | "rojo";
};

export const COLORES_SEMAFORO: Record<EstadoCarrera, ConfigColorCarrera> = {
  // GRIS: Si la carrera no tiene ni registros de jugadas ni caballos su color es gris.
  inactiva: {
    chip: "border-slate-400 bg-slate-300 text-slate-800 shadow-xs",
    label: "Sin registros de jugadas ni caballos (Gris)",
    txt: "text-slate-800",
    hex: "#cbd5e1",
    colorName: "gris",
  },
  // VERDE: Si la carrera tiene caballos registrados (precargado), es verde.
  abierta: {
    chip: "border-emerald-700 bg-emerald-600 text-white shadow-xs",
    label: "Caballos registrados · Precargado (Verde)",
    txt: "text-emerald-600",
    hex: "#059669",
    colorName: "verde",
  },
  // AMARILLO: Si hay jugadas y no está liquidada es amarillo.
  con_jugadas: {
    chip: "border-amber-500 bg-amber-400 text-slate-950 shadow-xs ring-1 ring-amber-500",
    label: "Con jugadas · Sin liquidar (Amarillo)",
    txt: "text-amber-600",
    hex: "#fbbf24",
    colorName: "amarillo",
  },
  // ROJO: Y si se liquidaron las jugadas es rojo.
  cerrada: {
    chip: "border-red-700 bg-red-600 text-white shadow-xs",
    label: "Jugadas liquidadas (Rojo)",
    txt: "text-red-600",
    hex: "#dc2626",
    colorName: "rojo",
  },
  // Alias compatible
  borrada: {
    chip: "border-slate-400 bg-slate-300 text-slate-800 shadow-xs",
    label: "Sin registros de jugadas ni caballos (Gris)",
    txt: "text-slate-800",
    hex: "#cbd5e1",
    colorName: "gris",
  },
};

export type ParametrosEstadoCarrera = {
  /** Indica si las jugadas de la carrera han sido liquidadas. */
  liquidada: boolean;
  /** Indica si la carrera tiene al menos una jugada/ticket activo (no anulado). */
  tieneJugadas: boolean;
  /** Indica si la carrera tiene ejemplares/caballos precargados o registrados (> 0). */
  tieneCaballos: boolean;
};

/**
 * Función pura determinística que resuelve el estado exacto de la carrera según la máquina de estados.
 */
export function resolverEstadoSemaforo({
  liquidada,
  tieneJugadas,
  tieneCaballos,
}: ParametrosEstadoCarrera): EstadoCarrera {
  // 1. ROJO: Si se liquidaron las jugadas es ROJO.
  if (liquidada) {
    return "cerrada";
  }

  // 2. AMARILLO: Si hay jugadas y no está liquidada es AMARILLO.
  //    (Al reversar una liquidación, como las jugadas persisten, pasa inmediatamente a AMARILLO).
  if (tieneJugadas) {
    return "con_jugadas";
  }

  // 3. VERDE: Si tiene caballos registrados (precargado) y NO tiene jugadas es VERDE.
  //    (Al anular o borrar todas las jugadas, si tiene caballos registrados, pasa a VERDE).
  if (tieneCaballos) {
    return "abierta";
  }

  // 4. GRIS: Si la carrera no tiene ni registros de jugadas ni caballos su color es GRIS.
  //    (Al eliminar todos los caballos de la carrera, vuelve a GRIS).
  return "inactiva";
}

/**
 * Validador estricto de transiciones de estado permitidas en el sistema.
 * Retorna true solo si la transición cumple la máquina de estados irreversible/reversable.
 */
export function validarTransicionPermitida(
  estadoAnterior: EstadoCarrera,
  estadoNuevo: EstadoCarrera,
  accion: "precargar_caballos" | "registrar_jugada" | "liquidar" | "reversar" | "borrar_jugadas" | "eliminar_caballos"
): { valida: boolean; motivo?: string } {
  if (estadoAnterior === estadoNuevo) return { valida: true };

  switch (accion) {
    case "precargar_caballos":
      // De GRIS a VERDE
      if (estadoAnterior === "inactiva" && estadoNuevo === "abierta") {
        return { valida: true };
      }
      return { valida: false, motivo: "Precargar caballos solo transiciona de GRIS a VERDE." };

    case "registrar_jugada":
      // De VERDE a AMARILLO, o de GRIS a AMARILLO (en modo manual)
      if ((estadoAnterior === "abierta" || estadoAnterior === "inactiva") && estadoNuevo === "con_jugadas") {
        return { valida: true };
      }
      return { valida: false, motivo: "Registrar jugada solo transiciona a AMARILLO." };

    case "liquidar":
      // De AMARILLO a ROJO
      if (estadoAnterior === "con_jugadas" && estadoNuevo === "cerrada") {
        return { valida: true };
      }
      return { valida: false, motivo: "Liquidar solo transiciona de AMARILLO a ROJO." };

    case "reversar":
      // Luego de liquidada (ROJO) SOLO puede pasar a AMARILLO si se reversa
      if (estadoAnterior === "cerrada" && estadoNuevo === "con_jugadas") {
        return { valida: true };
      }
      return {
        valida: false,
        motivo: "Luego de liquidada SOLO puede pasar a AMARILLO si se reversa (nunca a VERDE ni a GRIS).",
      };

    case "borrar_jugadas":
      // Luego de estar en AMARILLO SOLO puede pasar a VERDE si tiene caballos registrados
      if (estadoAnterior === "con_jugadas" && estadoNuevo === "abierta") {
        return { valida: true };
      }
      // O a GRIS si no tenía caballos registrados
      if (estadoAnterior === "con_jugadas" && estadoNuevo === "inactiva") {
        return { valida: true };
      }
      return {
        valida: false,
        motivo: "Borrar jugadas solo puede pasar de AMARILLO a VERDE (si tiene caballos) o a GRIS.",
      };

    case "eliminar_caballos":
      // Solo puede pasar de vuelta a GRIS si se eliminan todos los caballos de la carrera
      if (estadoAnterior === "abierta" && estadoNuevo === "inactiva") {
        return { valida: true };
      }
      return {
        valida: false,
        motivo: "Eliminar todos los caballos solo pasa de VERDE de vuelta a GRIS.",
      };

    default:
      return { valida: false, motivo: "Acción no reconocida." };
  }
}
