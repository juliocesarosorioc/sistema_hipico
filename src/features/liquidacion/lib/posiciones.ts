/**
 * Posiciones de llegada de una pizarra, en orden y sin huecos.
 *
 * `PizarraCarrera` es un objeto con campos por nombre (primero..octavo) porque
 * es cómodo de editar en un form, pero la fuente de verdad (`resultados_carreras.
 * ganadores`) guarda una lista ordenada. Convertir de una a otra aparecía
 * copiado en los tres puntos donde se centraliza un resultado, y una de esas
 * copias solo mandaba el ganador: se perdían del 2º al 8º y las jugadas de
 * puestos quedaban sin datos en Carreras del Día.
 */

/** Campos de `PizarraCarrera` que son una posición de llegada, en orden. */
export const CAMPOS_POSICION = [
  "primero",
  "segundo",
  "tercero",
  "cuarto",
  "quinto",
  "sexto",
  "septimo",
  "octavo",
] as const;

export type CampoPosicion = (typeof CAMPOS_POSICION)[number];

/** Subconjunto de `PizarraCarrera` que este módulo necesita (sin `empates`). */
export type PizarraConPosiciones = Partial<Record<CampoPosicion, string | number | undefined | null>>;

/**
 * Devuelve los números de llegada en orden, sin entradas vacías y recortados.
 * Un `"0"` o un `"-"` no cuentan como llegada: `0` es un valor no-nulo, así
 * que hace falta tratar el `0` numérico aparte del "".
 */
export function posicionesDePizarra(pizarra: PizarraConPosiciones | null | undefined): string[] {
  if (!pizarra) return [];
  const out: string[] = [];
  for (const campo of CAMPOS_POSICION) {
    const crudo = pizarra[campo];
    if (crudo === null || crudo === undefined) continue;
    const n = String(crudo).trim();
    if (!n) continue;
    if (/^0+$/.test(n)) continue;
    out.push(n);
  }
  return out;
}

/**
 * Inversa de `posicionesDePizarra`: arma la pizarra (`primero`..`octavo`) desde
 * la lista ordenada de números de llegada.
 *
 * Sirve para PRECARGAR el formulario con el resultado oficial ya guardado de
 * una carrera liquidada: sin esto, abrir una carrera que ya pagó mostraba la
 * llegada en blanco y el operador tipeaba de nuevo un resultado que ya existía
 * (y el sistema lo tomaba como un cambio). `null` si no hay ninguna posición.
 */
export function pizarraDePosiciones(
  posiciones: ReadonlyArray<string | number | null | undefined> | null | undefined
): PizarraConPosiciones | null {
  if (!posiciones || !posiciones.length) return null;
  const p: PizarraConPosiciones = {};
  let hay = false;
  CAMPOS_POSICION.forEach((campo, i) => {
    const v = posiciones[i];
    const n = v === null || v === undefined ? "" : String(v).trim();
    if (!n) return;
    p[campo] = n;
    hay = true;
  });
  return hay ? p : null;
}

/**
 * Orden de llegada oficial `[{numero,puesto}]` derivado de la pizarra.
 *
 * Es la forma ESTRUCTURADA que guarda `resultados_carreras.orden_llegada` (la
 * que prefiere `leerPizarra()` en reportes). Antes vivía dentro de
 * `PagarCarreraModal`, así que la liquidación de Taquilla la guardaba y la de
 * Gestión de Jugadas no: la carrera quedaba con `orden_llegada = null` y solo
 * se podía reconstruir por el fallback `ganadores`.
 */
export function ordenLlegadaDePizarra(
  pizarra: (PizarraConPosiciones & { primero_raya?: string; orden_llegada_raya?: string[] }) | null | undefined
): Array<{ numero: string; puesto: number; primero_raya?: string; orden_llegada_raya?: string[] }> {
  if (!pizarra) return [];
  const out: Array<{ numero: string; puesto: number; primero_raya?: string; orden_llegada_raya?: string[] }> = [];
  CAMPOS_POSICION.forEach((campo, i) => {
    const v = pizarra[campo];
    if (typeof v === "string" && v.trim() !== "") out.push({ numero: v.trim(), puesto: i + 1 });
    else if (typeof v === "number" && Number.isFinite(v)) out.push({ numero: String(v), puesto: i + 1 });
  });
  if (out.length > 0) {
    const oficial = out.map((x) => x.numero);
    const raya = posicionesRayaDePizarra(pizarra);
    if (raya.length > 0 && raya.join(",") !== oficial.join(",")) {
      out[0] = {
        ...out[0],
        primero_raya: raya[0],
        orden_llegada_raya: raya,
      };
    }
  }
  return out;
}

/**
 * Devuelve el Orden de Llegada en Raya (para Tablas Fijas y Remates).
 * Por defecto el Orden de Llegada es idéntico al Orden Oficial, pero si hubo
 * distanciamiento (`orden_llegada_raya` o `primero_raya`), devuelve el orden en raya.
 */
export function posicionesRayaDePizarra(
  pizarra: (PizarraConPosiciones & { primero_raya?: string; orden_llegada_raya?: string[] }) | null | undefined
): string[] {
  const oficial = posicionesDePizarra(pizarra);
  if (!pizarra) return oficial;
  if (Array.isArray(pizarra.orden_llegada_raya)) {
    const limpios = pizarra.orden_llegada_raya
      .map((x) => String(x ?? "").trim())
      .filter((x) => x !== "" && !/^0+$/.test(x));
    if (limpios.length > 0) return limpios;
  }
  const primRaya = String(pizarra.primero_raya ?? "").trim();
  if (primRaya && !/^0+$/.test(primRaya) && primRaya !== oficial[0]) {
    const resto = oficial.filter((n) => n !== primRaya);
    return [primRaya, ...resto];
  }
  return oficial;
}

/**
 * Extrae el Orden de Llegada en Raya desde `resultados_carreras.orden_llegada`
 * (si hubo distanciamiento guardado en el primer elemento) o devuelve `oficial` por defecto.
 */
export function extraerOrdenLlegadaRaya(orden_llegada: unknown, oficial: string[] = []): string[] {
  if (Array.isArray(orden_llegada) && orden_llegada.length > 0) {
    const primero = orden_llegada[0];
    if (primero && typeof primero === "object") {
      const obj = primero as Record<string, unknown>;
      if (Array.isArray(obj.orden_llegada_raya)) {
        const raya = obj.orden_llegada_raya
          .map((x) => String(x ?? "").trim())
          .filter(Boolean);
        if (raya.length > 0) return raya;
      }
      const primRaya = String(obj.primero_raya ?? "").trim();
      if (primRaya && primRaya !== oficial[0]) {
        return [primRaya, ...oficial.filter((n) => n !== primRaya)];
      }
    }
  }
  return oficial;
}

/** Determina si la Pizarra Oficial difiere del Orden de Llegada (hubo distanciamiento). */
export function hayDistanciamientoPizarra(oficial: ReadonlyArray<string>, raya?: ReadonlyArray<string> | null): boolean {
  if (!raya || raya.length === 0 || oficial.length === 0) return false;
  return oficial.map((x) => String(x).trim()).join(",") !== raya.map((x) => String(x).trim()).join(",");
}

/**
 * Une los dividendos por CABALLO con la matriz de las AMERICANAS W/P/S en el
 * único objeto que leen el motor y `resultados_carreras.dividendos`.
 *
 * Viven separados porque miden cosas distintas (la matriz depende del tipo
 * apostado, los pools solo del puesto alcanzado), pero el motor los resuelve en
 * la misma clave plana: `wps_WW`, `wps_WP`, ... conviviendo con `win:7`.
 * Prefijadas, no se pisan entre sí ni con el Pareo ("PP").
 */
export function dividendosDePizarra(r: {
  dividendos?: Record<string, number> | null;
  matrizWps?: Record<string, number> | null;
} | null | undefined): Record<string, number> | null {
  const porCaballo = r?.dividendos ?? {};
  const matriz = r?.matrizWps ?? {};
  if (!Object.keys(porCaballo).length && !Object.keys(matriz).length) return null;
  return { ...porCaballo, ...matriz };
}

export type ValidacionUnicidadPizarra = {
  ok: boolean;
  duplicados: string[];
  retiradosEnPizarra: string[];
  mensaje: string | null;
};

/**
 * Valida que ningún número de ejemplar se repita en dos o más posiciones de la pizarra
 * (`1°` a `8°`) y que ningún ejemplar retirado sea asignado como puesto oficial.
 */
export function validarPizarraSinDuplicados(
  posiciones: ReadonlyArray<string | number | null | undefined> | PizarraConPosiciones | null | undefined,
  retirados?: Iterable<string | number> | null
): ValidacionUnicidadPizarra {
  const listaRaw: string[] = Array.isArray(posiciones)
    ? posiciones.map((v) => String(v ?? "").trim().replace(/^0+(?=\d)/, "")).filter(Boolean)
    : posicionesDePizarra(posiciones as PizarraConPosiciones | null | undefined).map((v) =>
        v.replace(/^0+(?=\d)/, "")
      );

  const setRetirados = new Set<string>();
  if (retirados) {
    for (const r of retirados) {
      const norm = String(r ?? "").trim().replace(/^0+(?=\d)/, "");
      if (norm) setRetirados.add(norm);
    }
  }

  const vistos = new Set<string>();
  const duplicadosSet = new Set<string>();
  const retiradosSet = new Set<string>();

  for (const num of listaRaw) {
    if (!num) continue;
    if (vistos.has(num)) {
      duplicadosSet.add(num);
    } else {
      vistos.add(num);
    }
    if (setRetirados.has(num)) {
      retiradosSet.add(num);
    }
  }

  const duplicados = [...duplicadosSet];
  const retiradosEnPizarra = [...retiradosSet];

  if (duplicados.length > 0) {
    return {
      ok: false,
      duplicados,
      retiradosEnPizarra,
      mensaje: `⚠️ El ejemplar #${duplicados[0]} ya está asignado en otra posición de la pizarra`,
    };
  }

  if (retiradosEnPizarra.length > 0) {
    return {
      ok: false,
      duplicados,
      retiradosEnPizarra,
      mensaje: `⚠️ El ejemplar #${retiradosEnPizarra[0]} figura como RETIRADO y no puede ocupar puesto en la pizarra`,
    };
  }

  return {
    ok: true,
    duplicados: [],
    retiradosEnPizarra: [],
    mensaje: null,
  };
}
