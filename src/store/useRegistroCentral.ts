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
import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { listarHipodromos, type OpcionHipodromo } from "@/lib/tablas/rpc";
import { listarCarrerasCentrales, type CarreraCentral } from "@/lib/carreras/central";
import { claveHipodromo, numeroCarrera, agruparCarreras } from "@/lib/carreras/claves";
import { hoyLocal } from "@/lib/gaceta/programa";

// La clave vive en `lib/carreras/claves` (puro, testeable, compartido con el
// Monitor y Dupletas). Se reexporta para no obligar a los módulos a conocer el
// módulo puro.
export { claveHipodromo, numeroCarrera } from "@/lib/carreras/claves";

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
  invalidarHipodromos: () => set((s) => ({ versionHipodromos: s.versionHipodromos + 1 })),
  invalidar: () =>
    set((s) => ({ versionCarreras: s.versionCarreras + 1, versionHipodromos: s.versionHipodromos + 1 })),
}));

// `set` suelto para no arrastrarlo por todos los closures.
const set = useRegistroCentral.setState;

/** Peticiones en vuelo por clave, para que N módulos disparen UNA consulta. */
const enVueloCarreras = new Map<string, Promise<CarreraCentral[]>>();
const enVueloHipodromos = new Map<string, Promise<OpcionHipodromo[]>>();

/** Carga (o reutiliza) las carreras del día para `fecha`. */
export async function cargarRegistroCarreras(fecha: string): Promise<CarreraCentral[]> {
  const f = fecha || hoyLocal();
  const previa = enVueloCarreras.get(f);
  if (previa) return previa;

  set((s) => ({ cargando: { ...s.cargando, [f]: true } }));

  const p = listarCarrerasCentrales(f, "")
    .then((r): CarreraCentral[] => {
      if (!r.ok) {
        set((s) => ({ errores: { ...s.errores, [f]: r.error ?? "No se pudieron leer las carreras del día." } }));
        return [];
      }
      set((s) => ({ errores: { ...s.errores, [f]: null } }));
      return r.datos ?? [];
    })
    .catch((e) => {
      set((s) => ({
        errores: { ...s.errores, [f]: e instanceof Error ? e.message : String(e) },
      }));
      return [] as CarreraCentral[];
    })
    .then((datos) => {
      set((s) => ({
        porFecha: { ...s.porFecha, [f]: datos },
        cargando: { ...s.cargando, [f]: false },
      }));
      enVueloCarreras.delete(f);
      return datos;
    });

  enVueloCarreras.set(f, p);
  return p;
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
    void cargarRegistroCarreras(f);
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
    recargar: () => set((s) => ({ versionCarreras: s.versionCarreras + 1 })),
  };
}

const EMPTY: CarreraCentral[] = [];
