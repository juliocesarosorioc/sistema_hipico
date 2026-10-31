/**
 * REGISTRO CENTRAL de hipódromos y carreras del día.
 *
 * Este módulo es la ÚNICA fuente de "qué hipódromos existen" y "qué carreras
 * corren en esta fecha" para los módulos de gestión: Gestión de Jugadas,
 * Marcas, Tablas Fijas, Dupletas y el modal de Hipódromos.
 *
 * POR QUÉ EXISTE (los problemas que venía causando):
 *
 *  1) Cada módulo cargaba su propia copia y por su cuenta: `listarHipodromos()`
 *     directo en Marcas / Carreras del Día / el editor, el store en Gestión y
 *     Tablas, y `incluirTodos: true` en Dupletas. Cuatro caminos distintos, y
 *     los que llamaban la función directo NUNCA se enteraban de un alta o baja
 *     en el CRUD de Hipódromos (solo `HipodromosModule` bumpeaba `version`).
 *
 *  2) Marcas leía `marcas_carrera` (la pizarra oficial) y no el registro central.
 *     Una carrera recién cargada y todavía sin marcas no era una fila conocida
 *     por el resto de la app, así que aparecía en un módulo y en otro no.
 *
 *  3) `useCarrerasDiaStore` (el semáforo que pintan Tablas y Gestión) solo se
 *     hidrataba dentro de un handler de realtime de Tablas: por cualquier otra
 *     ruta nunca se llenaba y los chips salían vacíos.
 *
 * El store deduplica además las peticiones en vuelo: aunque entren ocho módulos
 * a la vez, sale UNA consulta a `resultados_carreras`.
 *
 * La caché es un MAP POR FECHA a propósito. Con una sola fecha compartida, dos
 * módulos filtrando jornadas distintas se pisan la lista entre sí — que es
 * justo el síntoma de "esta carrera aparece en unos módulos y en otros no".
 */
import { useEffect, useMemo, useCallback } from "react";
import { create } from "zustand";
import { listarHipodromos, type OpcionHipodromo } from "@/features/tablas/lib/rpc";
import { listarCarrerasCentrales, type CarreraCentral } from "@/features/carreras/lib/central";
import { completarResultadosPorClave } from "@/features/carreras/lib/maestro-nucleo";
import { claveHipodromo, numeroCarrera, agruparCarreras } from "@/features/carreras/lib/claves";
import { hoyLocal } from "@/features/gaceta/lib/programa";

// La clave vive en `lib/carreras/claves` (puro, testeable, compartido con el
// Monitor y Dupletas). Se reexporta para no obligar a los módulos a conocer el
// módulo puro.
export { claveHipodromo, numeroCarrera } from "@/features/carreras/lib/claves";

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

type Estado = {
  /** Carreras por fecha ISO. Un mapa, no un array único: dos módulos pueden
   *  estar viendo jornadas distintas sin pisarse. */
  porFecha: Record<string, CarreraCentral[]>;
  /** Catálogo de hipódromos REGISTRADOS (base `hipodromos`), inactivos incluidos. */
  hipodromos: OpcionHipodromo[];
  cargando: Record<string, boolean>;
  errores: Record<string, string | null>;
  /**
   * Versiones SEPARADAS a propósito. Renombrar o dar de baja un hipódromo no
   * cambia ninguna carrera, así que no debe disparar una ráfaga de consultas a
   * `resultados_carreras` en todos los módulos abiertos; y registrar una carrera
   * tampoco vuelve a descargar el catálogo.
   */
  versionCarreras: number;
  versionHipodromos: number;
  /** Invalida las carreras (registro/publicación de una carrera). */
  invalidarCarreras: () => void;
  /** Siembra el caché central con una carrera que ya se escribió en la matriz. */
  registrarCarrera: (carrera: CarreraCentral) => void;
  /** Elimina una carrera del caché central al darla de baja. */
  eliminarCarrera: (fecha: string, hipodromo: string, carrera: number | string) => void;
  /** Invalida el catálogo (alta/baja/edición de hipódromo). */
  invalidarHipodromos: () => void;
  /** Invalida todo. */
  invalidar: () => void;
};

export const useRegistroCentral = create<Estado>(() => ({
  porFecha: {},
  hipodromos: [],
  cargando: {},
  errores: {},
  versionCarreras: 0,
  versionHipodromos: 0,
  invalidarCarreras: () => set((s) => ({ versionCarreras: s.versionCarreras + 1 })),
  registrarCarrera: (carrera) =>
    set((s) => {
      const fecha = String(carrera.fecha ?? "").slice(0, 10);
      const hipodromo = claveHipodromo(carrera.hipodromo);
      const numero = numeroCarrera(carrera.carrera);
      if (!fecha || !hipodromo || !numero) {
        return { versionCarreras: s.versionCarreras + 1 };
      }
      const lista = s.porFecha[fecha] ?? [];
      const indice = lista.findIndex(
        (fila) =>
          claveHipodromo(fila.hipodromo) === hipodromo &&
          numeroCarrera(fila.carrera) === numero
      );
      const actualizada = [...lista];
      const fila = { ...carrera, fecha, carrera: numero };
      if (indice < 0) actualizada.push(fila);
      else actualizada[indice] = { ...actualizada[indice], ...fila };
      return {
        porFecha: { ...s.porFecha, [fecha]: actualizada },
        versionCarreras: s.versionCarreras + 1,
      };
    }),
  eliminarCarrera: (fechaRaw, hipoRaw, carreraRaw) =>
    set((s) => {
      const fecha = String(fechaRaw ?? "").slice(0, 10);
      const hipodromo = claveHipodromo(hipoRaw);
      const numero = numeroCarrera(carreraRaw);
      if (!fecha || !hipodromo || !numero) {
        return { versionCarreras: s.versionCarreras + 1 };
      }
      const lista = s.porFecha[fecha] ?? [];
      const filtrada = lista.filter(
        (fila) =>
          !(claveHipodromo(fila.hipodromo) === hipodromo && numeroCarrera(fila.carrera) === numero)
      );
      return {
        porFecha: { ...s.porFecha, [fecha]: filtrada },
        versionCarreras: s.versionCarreras + 1,
      };
    }),
  invalidarHipodromos: () => set((s) => ({ versionHipodromos: s.versionHipodromos + 1 })),
  invalidar: () =>
    set((s) => ({ versionCarreras: s.versionCarreras + 1, versionHipodromos: s.versionHipodromos + 1 })),
}));

// `set` suelto para no arrastrarlo por todos los closures.
const set = useRegistroCentral.setState;

/** Peticiones en vuelo por clave, para que N módulos disparen UNA consulta. */
const enVueloCarreras = new Map<string, Promise<CarreraCentral[]>>();
const enVueloHipodromos = new Map<string, Promise<OpcionHipodromo[]>>();

// ---------------------------------------------------------------------------
// Realtime de la MATRIZ `carreras`
// ---------------------------------------------------------------------------
// El registro central refresca por versión (`invalidarCarreras`), que solo vale
// DENTRO de la pestaña que escribe. Al extraer las carreras con IA, las demás
// pestañas, los otros módulos ya abiertos y los demás usuarios seguían viendo la
// lista vieja hasta recargar: la carrera existía en la matriz pero "no cargaba".
//
// La cura es escuchar la propia matriz: cualquier alta/edición de una carrera
// (IA, Ensamblaje, carga manual o reparación) llega por `postgres_changes` y
// bumpea `versionCarreras`, que es lo que todos los módulos ya observan. Basta
// con que la tabla `public.carreras` esté en la publicación `supabase_realtime`
// (sql/realtime_carreras.sql).
//
// Una sola suscripción por pestaña, levantada por el PRIMER consumidor y bajada
// por el último (ref-count): abrir y cerrar módulos no abre canales de más.
let canalCarreras: { unsubscribe: () => void } | null = null;
let oyentesCarreras = 0;
let conectandoCarreras = false;

async function conectarRealtimeCarreras(): Promise<void> {
  if (canalCarreras || conectandoCarreras) return;
  conectandoCarreras = true;
  try {
    const { supabase } = await import("@/core/supabase");
    if (!supabase || canalCarreras) return;
    canalCarreras = supabase
      .channel("registro-central-carreras")
      .on("postgres_changes", { event: "*", schema: "public", table: "carreras" }, () => {
        set((s) => ({ versionCarreras: s.versionCarreras + 1 }));
      })
      .subscribe();
  } catch {
    // Sin realtime (publicación no aplicada o red): queda el refresco por
    // versión + el botón de recargar de cada módulo.
    canalCarreras = null;
  } finally {
    conectandoCarreras = false;
  }
}

function desconectarRealtimeCarreras(): void {
  if (!canalCarreras) return;
  const canal = canalCarreras;
  canalCarreras = null;
  try {
    canal.unsubscribe();
  } catch {
    /* noop */
  }
}

/**
 * Mantiene viva UNA suscripción realtime a la matriz `carreras` mientras haya
 * módulos montados. Es lo que hace que una carrera extraída con IA quede
 * DISPONIBLE DE INMEDIATO en todos los módulos, pestañas y usuarios.
 */
export function useRealtimeCarreras(): void {
  useEffect(() => {
    oyentesCarreras += 1;
    void conectarRealtimeCarreras();
    return () => {
      oyentesCarreras = Math.max(0, oyentesCarreras - 1);
      if (oyentesCarreras === 0) desconectarRealtimeCarreras();
    };
  }, []);
}

/** Carga (o reutiliza) las carreras del día para `fecha`. */
/**
 * Versión del store con la que se completó la última lectura de cada fecha. Es
 * la clave de la caché RESUELTA: si la fecha ya está en `porFecha` y nadie
 * invalidó el registro (misma `versionCarreras`), no se vuelve a consultar.
 */
const versionCargadaCarreras = new Map<string, number>();

/** Carga (o reutiliza) las carreras del día para `fecha`. */
export async function cargarRegistroCarreras(fecha: string, version = 0): Promise<CarreraCentral[]> {
  const f = fecha || hoyLocal();
  const claveCarga = `${f}|${version}`;

  // Caché RESUELTA (no solo "en vuelo"): si ya se cargó esta fecha con la
  // versión vigente del registro, se devuelve sin consultar. Antes, remontar un
  // módulo o volver a una pestaña repetía la lectura de las mismas carreras
  // aunque nada hubiera cambiado.
  const enStore = useRegistroCentral.getState().porFecha[f];
  if (enStore && versionCargadaCarreras.get(f) === version) return enStore;

  const previa = enVueloCarreras.get(claveCarga);
  if (previa) return previa;

  set((s) => ({ cargando: { ...s.cargando, [f]: true } }));

  const p = listarCarrerasCentrales(f, "")
    .then(async (r): Promise<CarreraCentral[]> => {
      if (!r.ok) {
        if (useRegistroCentral.getState().versionCarreras === version) {
          set((s) => ({ errores: { ...s.errores, [f]: r.error ?? "No se pudieron leer las carreras del día." } }));
        }
        return [];
      }
      if (useRegistroCentral.getState().versionCarreras === version) {
        set((s) => ({ errores: { ...s.errores, [f]: null } }));
      }
      return completarResultadosDelDia(f, r.datos ?? []);
    })
    .catch((e) => {
      if (useRegistroCentral.getState().versionCarreras === version) {
        set((s) => ({
          errores: { ...s.errores, [f]: e instanceof Error ? e.message : String(e) },
        }));
      }
      return [] as CarreraCentral[];
    })
    .then((datos) => {
      const versionVigente = useRegistroCentral.getState().versionCarreras;
      if (versionVigente === version) {
        set((s) => ({
          porFecha: { ...s.porFecha, [f]: datos },
          cargando: { ...s.cargando, [f]: false },
        }));
        // Solo se marca como "cargada" la lectura exitosa: así un fallo de red
        // se reintenta en el próximo montaje en vez de quedar cacheado vacío.
        if (useRegistroCentral.getState().errores[f] == null) versionCargadaCarreras.set(f, version);
      } else if (!enVueloCarreras.has(`${f}|${versionVigente}`)) {
        set((s) => ({ cargando: { ...s.cargando, [f]: false } }));
      }
      enVueloCarreras.delete(claveCarga);
      return datos;
    });

  enVueloCarreras.set(claveCarga, p);
  return p;
}

/**
 * Completa el RESULTADO de cada carrera con un respaldo por CLAVE NATURAL.
 *
 * El resultado viaja embebido en la matriz (`resultados_carreras(*)`, vía la FK
 * `carrera_id`). Si esa FK está NULL —la migración la llena con una igualdad
 * EXACTA de hipódromo, así que una fila con otra grafía("La Rinconada" vs
 * "LA RINCONADA") nunca se enlaza— el embed devuelve NADA y sin error: el
 * catálogo entero queda sin ganadores y el «Progreso de la jornada» se queda en
 * 0% para siempre (el síntoma: "Programadas: N, Con resultado: 0").
 *
 * Acá se lee la MISMA tabla `resultados_carreras` del día en UNA consulta y se
 * completa por `fecha + hipódromo + carrera` solo lo que el embed no trajo. No
 * es una segunda verdad: es la misma fuente, leída por su clave natural. Si el
 * embed ya respondió, no se consulta siquiera.
 */
async function completarResultadosDelDia(fecha: string, carrera: CarreraCentral[]): Promise<CarreraCentral[]> {
  // Nada que rescatar: o no hay carreras, o TODAS ya traen su resultado.
  if (!carrera.length || carrera.every((c) => c.ganadores?.length || c.aplicado_a_tablas)) return carrera;
  try {
    const { supabase } = await import("@/core/supabase");
    if (!supabase) return carrera;
    const { data, error } = await supabase
      .from("resultados_carreras")
      .select("fecha, hipodromo, carrera, ganadores, orden_llegada, aplicado_a_tablas")
      .eq("fecha", fecha);
    // Best-effort: si la tabla no está (o falla), el catálogo queda como vino.
    if (error || !data?.length) return carrera;
    return completarResultadosPorClave(carrera, data as Parameters<typeof completarResultadosPorClave>[1]);
  } catch {
    return carrera;
  }
}

/** Carga (o reutiliza) el catálogo de hipódromos registrados. */
export async function cargarRegistroHipodromos(incluirTodos = true): Promise<OpcionHipodromo[]> {
  const clave = incluirTodos ? "all" : "activos";
  const previa = enVueloHipodromos.get(clave);
  if (previa) return previa;

  const p = listarHipodromos({ incluirTodos })
    .catch(() => [] as OpcionHipodromo[])
    .then((lista) => {
      set({ hipodromos: lista });
      enVueloHipodromos.delete(clave);
      return lista;
    });

  enVueloHipodromos.set(clave, p);
  return p;
}

/**
 * Siembra una carrera en la caché central sin esperar un refetch, y pide el
 * refresco para reconciliar con la base. Se usa tras registrar/publicar para que
 * el módulo que publica la vea al instante, igual que todos los demás.
 *
 * IMPORTANTE: se llama DESPUÉS de la escritura, nunca antes. Si se sembrara
 * antes, el bump dispararía el refetch, que leería la fila antes de que exista y
 * volvería a borrarla de la lista.
 */
export function sembrarCarreraCentral(hipodromo: string, carrera: number | string, fecha?: string): void {
  const f = fecha || hoyLocal();
  const h = claveHipodromo(hipodromo);
  const n = numeroCarrera(carrera);
  if (!h || !n) return;
  set((s) => {
    const lista = s.porFecha[f] ?? [];
    const yaEsta = lista.some((c) => claveHipodromo(c.hipodromo) === h && numeroCarrera(c.carrera) === n);
    if (yaEsta) return {};
    return { porFecha: { ...s.porFecha, [f]: [...lista, { fecha: f, hipodromo: h, carrera: n, estado: "Programada" }] } };
  });
  set((s) => ({ versionCarreras: s.versionCarreras + 1 }));
}

// ---------------------------------------------------------------------------
// Hook de consumo
// ---------------------------------------------------------------------------

export type RegistroCentral = {
  fecha: string;
  /** Catálogo de hipódromos REGISTRADOS (selectores y filtro de matrices). */
  hipodromos: OpcionHipodromo[];
  /** Claves normalizadas de los hipódromos registrados. */
  registrados: Set<string>;
  /** Todas las carreras de la fecha, de todos los hipódromos. */
  carreras: CarreraCentral[];
  /** Carreras del hipódromo dado (normalizado), ordenadas por número. */
  carrerasDe: (hipodromo: string | null | undefined) => CarreraCentral[];
  /** Números de carrera registrados del hipódromo en esa fecha. */
  numerosDe: (hipodromo: string | null | undefined) => number[];
  /** ¿Está registrada esa carrera en el día? */
  registrada: (hipodromo: string | null | undefined, carrera: number | string) => boolean;
  /** Claves de los hipódromos que tienen carreras ese día. */
  hipodromosDelDia: string[];
  cargando: boolean;
  error: string | null;
  recargar: () => void;
};

/**
 * Suscripción al registro central. `fecha` vacía = hoy. Es la única forma de
 * obtener hipódromos y carreras en los módulos de gestión.
 */
export function useRegistroCentralOpts(fecha?: string): RegistroCentral {
  const f = fecha || hoyLocal();

  // Escucha la matriz: las carreras extraídas con IA (o cargadas desde otra
  // pestaña/usuario) entran a este registro sin recargar la página.
  useRealtimeCarreras();

  const carreras = useRegistroCentral((s) => s.porFecha[f] ?? EMPTY);
  const cargando = useRegistroCentral((s) => Boolean(s.cargando[f]));
  const errorCarreras = useRegistroCentral((s) => s.errores[f] ?? null);
  const hipodromos = useRegistroCentral((s) => s.hipodromos);
  const versionCarreras = useRegistroCentral((s) => s.versionCarreras);
  const versionHipodromos = useRegistroCentral((s) => s.versionHipodromos);

  /**
   * Una lectura por (fecha, versión de carreras). `cargarRegistroCarreras` ya
   * deduplica en vuelo y ya escribe `cargando`/`errores`/`porFecha`, así que el
   * efecto solo dispara: si el usuario cambia de fecha mientras vuela la
   * consulta, la que llegue tarde escribe en SU clave y no pisa la visible.
   */
  useEffect(() => {
    void cargarRegistroCarreras(f, versionCarreras);
  }, [f, versionCarreras]);

  /** El catálogo no depende de la fecha: se lee una vez por versión de catálogo. */
  useEffect(() => {
    void cargarRegistroHipodromos(true);
  }, [versionHipodromos]);

  const registrados = useMemo(() => new Set(hipodromos.map((h) => claveHipodromo(h.value))), [hipodromos]);

  const porHipodromo = useMemo(() => agruparCarreras(carreras), [carreras]);

  const carrerasDe = useMemo(
    () => (hipodromo: string | null | undefined) => {
      const k = claveHipodromo(hipodromo);
      return k ? porHipodromo.get(k) ?? [] : [];
    },
    [porHipodromo]
  );

  const numerosDe = useMemo(
    () => (hipodromo: string | null | undefined) => {
      const k = claveHipodromo(hipodromo);
      if (!k) return [];
      const lista = porHipodromo.get(k) ?? [];
      return [...new Set(lista.map((c) => numeroCarrera(c.carrera)))].sort((a, b) => a - b);
    },
    [porHipodromo]
  );

  const hipodromosDelDia = useMemo(
    () => [...porHipodromo.keys()].sort((a, b) => a.localeCompare(b)),
    [porHipodromo]
  );

  const recargar = useCallback(
    () => set((s) => ({ versionCarreras: s.versionCarreras + 1 })),
    []
  );

  return {
    fecha: f,
    hipodromos,
    registrados,
    carreras,
    carrerasDe,
    numerosDe,
    registrada: (hipodromo, carrera) => {
      const lista = porHipodromo.get(claveHipodromo(hipodromo));
      if (!lista) return false;
      const n = numeroCarrera(carrera);
      return lista.some((c) => numeroCarrera(c.carrera) === n);
    },
    hipodromosDelDia,
    cargando,
    error: errorCarreras,
    recargar,
  };
}

const EMPTY: CarreraCentral[] = [];
