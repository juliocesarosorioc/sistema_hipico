/**
 * MATRIZ MAESTRA DE CARRERAS — la única fuente del catálogo.
 *
 * POR QUÉ ESTE MÓDULO
 * -------------------
 * Antes no había tabla maestra: cada módulo preguntaba "qué carreras hay" por su
 * cuenta y el único grano de "una fila por carrera" era `resultados_carreras`,
 * que es el LIBRO DE RESULTADOS. Eso obligaba a que una carrera solo existiera
 * para el resto de la plataforma cuando alguien corría resultados o pulsaba
 * Publicar — al revés, porque para apostar hay que tener la carrera ANTES de
 * que exista resultado.
 *
 * `carreras` (sql/carreras.sql) es la matriz: una fila por (fecha, hipódromo,
 * carrera). Desde acá se lee el catálogo con UN query —el resultado viene
 * embebido por `resultados_carreras.carrera_id`— y se escribe desde la IA.
 *
 * La lógica pura (normalizadores, estado, mapeo a `CarreraCatalogo`) vive en
 * `maestro-nucleo.ts`, testeable en node. Este archivo es solo la puerta a
 * Supabase.
 *
 * COMPATIBILIDAD
 * --------------
 * No hay fallback: `listarCarrerasCentrales` lee SOLO esta matriz. Si
 * `sql/carreras.sql` no esta aplicado, `leerCarrerasMaestro` marca la tabla como
 * ausente/en mala forma y los modulos reciben el error en vez de una lista
 * armada con `resultados_carreras` (habria dos verdades sobre que carreras hay).
 * Por eso la matriz tiene que estar aplicada y poblada para que Remates, Marcas,
 * Dupleta y el resto listen carreras.
 */
import { supabase } from "@/core/supabase";
import { exigirCapacidad, usuarioVigente } from "@/features/seguridad/lib/vigente";
import { normalizarRetirados } from "@/features/carreras/lib/retiros-nucleo";
import { hoyLocal } from "@/features/gaceta/lib/programa";
import { claveHipodromo, numeroCarrera } from "@/features/carreras/lib/claves";
import {
  COLUMNAS_MAESTRO,
  ESTADOS_MAESTRO,
  aCarreraCentral,
  dedupFilasMaestro,
  fusionarEjemplaresAcumulativo,
  hipodromosAEscribir,
  ordenarPorNumero,
} from "@/features/carreras/lib/maestro-nucleo";
import type {
  EjemplarMatriz,
  EntradaCarrera,
  FilaCarreraMaestro,
} from "@/features/carreras/lib/maestro-nucleo";

export * from "@/features/carreras/lib/maestro-nucleo";

// ---------------------------------------------------------------------------
// Estado de la migración
// ---------------------------------------------------------------------------

/**
 * `null` = todavía no se miró. Una vez que la tabla responde "no existe", no se
 * vuelve a preguntar en cada render: el fallback a `resultados_carreras` queda
 * cacheado y se reintenta solo si el operador invalida.
 */
let maestroDisponible: boolean | null = null;

/** Lo llama el resto de la app cuando una escritura revela que el SQL no corrió. */
export function marcarMaestroAusente(): void {
  maestroDisponible = false;
}

/** Fuerza a volver a intentar la matriz (tras aplicar el SQL y recargar). */
export function reintentarMaestro(): void {
  maestroDisponible = null;
  idsHipodromos.clear();
}

/** ¿Está aplicada la matriz maestra? */
export function maestroActivo(): boolean {
  return maestroDisponible === true;
}

/** `true` cuando el error dice "esta tabla/relación no existe" → falta el SQL. */
function esAusente(msg: string): boolean {
  return /does not exist|not found|PGRST202|PGRST204|schema cache/i.test(msg);
}

const CLAVE_CARRERAS_ELIMINADAS = "hipico_carreras_eliminadas_v1";

function claveTombstone(fecha: unknown, hipodromo: unknown, carrera: unknown): string {
  const f = String(fecha ?? "").slice(0, 10);
  const h = claveHipodromo(hipodromo);
  const c = numeroCarrera(carrera);
  if (!f || !h || !c) return "";
  return `${f}|${h}|${c}`;
}

function leerTombstonesLocal(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(CLAVE_CARRERAS_ELIMINADAS);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.map(String)) : new Set();
  } catch {
    return new Set();
  }
}

function guardarTombstonesLocal(set: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CLAVE_CARRERAS_ELIMINADAS, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

export function marcarCarreraEliminadaLocal(fecha: unknown, hipodromo: unknown, carrera: unknown): void {
  const k = claveTombstone(fecha, hipodromo, carrera);
  if (!k) return;
  const set = leerTombstonesLocal();
  set.add(k);
  guardarTombstonesLocal(set);
}

export function desmarcarCarreraEliminadaLocal(fecha: unknown, hipodromo: unknown, carrera: unknown): void {
  const k = claveTombstone(fecha, hipodromo, carrera);
  if (!k) return;
  const set = leerTombstonesLocal();
  if (set.delete(k)) guardarTombstonesLocal(set);
}

export function esCarreraEliminadaLocal(fecha: unknown, hipodromo: unknown, carrera: unknown): boolean {
  const k = claveTombstone(fecha, hipodromo, carrera);
  if (!k) return false;
  return leerTombstonesLocal().has(k);
}

// ---------------------------------------------------------------------------
// Lectura de la matriz
// ---------------------------------------------------------------------------

export type ResMaestro = { ok: boolean; filas: FilaCarreraMaestro[]; error?: string };

/**
 * Lee la matriz para `fecha` (+ hipódromo opcional). El resultado va EMBEBIDO
 * para que el catálogo y el resultado salgan en un solo viaje: antes cada módulo
 * hacía su consulta extra de ganadores.
 *
 * Si el embed falla (la FK `carrera_id` se acaba de aplicar y PostgREST aún no
 * recacheó el esquema) reintenta sin embed antes de rendirse.
 */
export async function leerCarrerasMaestro(
  fecha?: string,
  hipodromo?: string
): Promise<ResMaestro> {
  const sb = supabase;
  if (!sb) return { ok: false, filas: [], error: "Sin credenciales Supabase (.env.local)." };
  if (maestroDisponible === false) return { ok: false, filas: [], error: "matriz no aplicada" };

  const f = fecha || hoyLocal();
  const hipo = claveHipodromo(hipodromo);

  const consulta = (conEmbed: boolean) =>
    sb
      .from("carreras")
      .select(conEmbed ? `${COLUMNAS_MAESTRO}, resultados_carreras(*)` : COLUMNAS_MAESTRO)
      .eq("fecha", f)
      .order("hipodromo")
      .order("carrera");

  /**
   * El filtro de hipódromo se aplica AQUÍ, con `claveHipodromo`, y no con un
   * `.eq("hipodromo", ...)` sobre el texto crudo: la BD guarda el hipódromo
   * como lo escribió el operador ("LA RINCONADA", "La Rinconada") y el resto de
   * la app lo cruza con mayúsculas sin espacios ("LARINCONADA"). Con el `.eq`
   * crudo cada forma daba un conjunto DISTINTO, y por eso el registro central
   * (que fetcha el día completo y agrupa por clave) veía una carrera que el
   * módulo que filtraba en SQL no veía.
   *
   * Además colapsa por la clave canónica con `dedupFilasMaestro`: una fila por
   * carrera, fusionando las copias. Sin esto una carrera se pintaba dos veces en
   * el semáforo y una de las copias, vacía, la marcaba "sin ejemplares".
   *
   * Filtrar acá no cuesta nada: el día son decenas de filas.
   */
  const cerrar = (data: unknown): ResMaestro => {
    const filas = (data ?? []) as FilaCarreraMaestro[];
    const tombstones = leerTombstonesLocal();
    const vigentes = filas.filter((x) => {
      const k = claveTombstone(x.fecha || f, x.hipodromo, x.carrera);
      if (k && tombstones.has(k)) {
        if (x.id != null && sb) {
          void sb.from("carreras").delete().eq("id", x.id);
        }
        return false;
      }
      return true;
    });
    const delHipo = hipo ? vigentes.filter((x) => claveHipodromo(x.hipodromo) === hipo) : vigentes;
    return { ok: true, filas: dedupFilasMaestro(delHipo) };
  };

  try {
    const conResultado = await consulta(true);
    if (!conResultado.error) {
      maestroDisponible = true;
      return cerrar(conResultado.data);
    }
    // El embed no resuelve (FK recién aplicada y PostgREST sin recachear):
    // reintento sin embed; la fila igual trae todo el catálogo.
    if (/relationship|embed|foreign key|PGRST/i.test(conResultado.error.message)) {
      const reintento = await consulta(false);
      if (!reintento.error) {
        maestroDisponible = true;
        return cerrar(reintento.data);
      }
      return { ok: false, filas: [], error: reintento.error.message };
    }
    if (esAusente(conResultado.error.message)) maestroDisponible = false;
    return { ok: false, filas: [], error: conResultado.error.message };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (esAusente(msg)) maestroDisponible = false;
    return { ok: false, filas: [], error: msg };
  }
}

// ---------------------------------------------------------------------------
// Escritura en la matriz
// ---------------------------------------------------------------------------

/** Nombre normalizado (MAYÚSCULAS) → id de `hipodromos`. Se llena una vez. */
const idsHipodromos = new Map<string, number>();

/**
 * `OpcionHipodromo` (lib/tablas/rpc) solo trae value/label, así que el id se
 * pide directo a la tabla: es un select de 2 columnas y se cachea para toda la
 * sesión. Si falla, las carreras se guardan sin `hipodromo_id` — no bloquea.
 */
async function resolverIdsHipodromos(): Promise<Map<string, number>> {
  if (idsHipodromos.size > 0) return idsHipodromos;
  if (!supabase) return idsHipodromos;
  try {
    const { data, error } = await supabase.from("hipodromos").select("id, nombre");
    if (!error) {
      for (const r of (data ?? []) as Array<{ id?: unknown; nombre?: unknown }>) {
        const k = claveHipodromo(r.nombre);
        if (k && r.id != null) idsHipodromos.set(k, Number(r.id));
      }
    }
  } catch {
    /* sin catálogo: se guarda sin hipodromo_id, no es bloqueante */
  }
  return idsHipodromos;
}

/**
 * Estado ACTUAL (fecha/hipodromo/carrera) de la matriz para las fechas que se
 * van a tocar. Con eso `hipodromosAEscribir` sabe qué TEXTO de hipódromo ya está
 * guardado por clave canónica, para que el upsert actualice la fila existente y
 * no siembre una segunda por una grafía distinta.
 */
async function cargarHipodromosExistentes(fechas: string[]): Promise<Record<string, unknown>[]> {
  if (!supabase || !fechas.length) return [];
  try {
    const { data, error } = await supabase
      .from("carreras")
      .select("fecha,hipodromo,carrera")
      .in("fecha", fechas);
    if (error) return [];
    return (data ?? []) as Record<string, unknown>[];
  } catch {
    return [];
  }
}

/**
 * Deja intacta una columna de las filas cuyo llamador no la informó.
 *
 * Sin esto, guardar el programa desde la IA mandaría `retirados: null` a cada
 * carrera y borraría los retiros que un operador acaba de aplicar: la matriz
 * tiene que poder seguir guardando caballos, estados y horario sin pisar las
 * listas que los módulos leen.
 *
 * Sirve igual para `invalidado_remate`, que es el otro caso: la IA no lo
 * controla, y mandarlo en NULL dejaría pujables ejemplares que el operador del
 * remate invalidó a propósito.
 *
 * Si la lectura falla no se inventa nada: se saca la columna del payload, que
 * es lo único que evita mandarla en NULL a ciegas.
 */
async function preservarColumna(
  filas: Record<string, unknown>[],
  claves: string[],
  columna: "retirados" | "invalidado_remate"
): Promise<void> {
  const pedidas = new Set(claves);
  const fechas = [...new Set(claves.map((c) => c.split("|")[0]))].filter(Boolean);
  const quitar = () => filas.forEach((f) => delete f[columna]);
  if (!fechas.length || !supabase) return quitar();
  try {
    const { data, error } = await supabase
      .from("carreras")
      .select("fecha,hipodromo,carrera,retirados,invalidado_remate")
      .in("fecha", fechas);
    if (error) return quitar();
    const guardados = new Map<string, unknown>();
    // La clave es la CANÓNICA (fecha | hipódromo sin espacios | número), la misma
    // de `claveHipodromo`: así dar igual que la BD guarde "LA RINCONADA" o
    // "La Rinconada" — el retiro se conserva, no se pisotea con null.
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      const clave = `${String(r.fecha ?? "").slice(0, 10)}|${claveHipodromo(String(r.hipodromo ?? ""))}|${Number(r.carrera) || 0}`;
      if (pedidas.has(clave)) guardados.set(clave, r[columna] ?? null);
    }
    for (const f of filas) {
      const clave = `${String(f.fecha ?? "").slice(0, 10)}|${claveHipodromo(String(f.hipodromo ?? ""))}|${Number(f.carrera) || 0}`;
      if (!pedidas.has(clave)) continue;
      if (guardados.has(clave)) f[columna] = guardados.get(clave);
      else delete f[columna];
    }
  } catch {
    quitar();
  }
}

const preservarRetirados = (filas: Record<string, unknown>[], claves: string[]) =>
  preservarColumna(filas, claves, "retirados");
const preservarInvalidados = (filas: Record<string, unknown>[], claves: string[]) =>
  preservarColumna(filas, claves, "invalidado_remate");

/**
 * FUSIÓN ACUMULATIVA de los ejemplares de las filas que lo piden.
 *
 * Una carga de gaceta llega por LOTES: el operador sube el documento de un
 * hipódromo y, otro día, el de otro. Con la fila de la matriz reescrita por
 * completo, el segundo lote borraba los ejemplares del primero, y una carrera
 * leída a medias (6 de 10 ejemplares) se quedaba con 6.
 *
 * Aquí la lista de ejemplares se FUSIONA por número de gualdrapa con la que
 * ya está guardada: los números nuevos se agregan, los repetidos se actualizan
 * y los que el lote no trae se conservan.
 *
 * Solo se aplica a las filas que lo piden (`fusionar_ejemplares: true`): el
 * editor manual de la carrera tiene que poder QUITAR un ejemplar, y una
 * fusión acumulada se lo impediría.
 */
async function fusionarEjemplaresGuardados(
  filas: Record<string, unknown>[],
  claves: string[]
): Promise<void> {
  const pedidas = new Set(claves);
  if (!pedidas.size || !supabase) return;
  const fechas = [...new Set(claves.map((c) => c.split("|")[0]))].filter(Boolean);
  if (!fechas.length) return;
  try {
    const { data, error } = await supabase
      .from("carreras")
      .select("fecha,hipodromo,carrera,caballos")
      .in("fecha", fechas);
    if (error) return;
    const guardados = new Map<string, unknown>();
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      const clave = `${String(r.fecha ?? "").slice(0, 10)}|${claveHipodromo(String(r.hipodromo ?? ""))}|${Number(r.carrera) || 0}`;
      if (pedidas.has(clave)) guardados.set(clave, r.caballos ?? []);
    }
    for (const f of filas) {
      const clave = `${String(f.fecha ?? "").slice(0, 10)}|${claveHipodromo(String(f.hipodromo ?? ""))}|${Number(f.carrera) || 0}`;
      if (!pedidas.has(clave)) continue;
      const previos = guardados.get(clave);
      if (!previos) continue;
      f.caballos = fusionarEjemplaresAcumulativo(previos, f.caballos);
    }
  } catch {
    /* sin lectura previa: se escribe el lote tal cual (nunca se pierde la carga) */
  }
}

/**
 * Da de alta / actualiza carreras en la matriz (una fila por hipódromo+carrera).
 * Es la vía que usa la IA al guardar el programa: la carrera existe para TODOS
 * los módulos apenas se guarda, sin esperar resultados ni Publicar.
 *
 * Deduplica por (fecha, hipodromo, carrera) ANTES de escribir: un solo upsert
 * con N filas en vez de N idas a la red.
 */
export async function escribirCarrerasMaestro(
  entradas: EntradaCarrera[]
): Promise<{ ok: boolean; error?: string; guardadas?: number }> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  if (!entradas.length) return { ok: true, guardadas: 0 };
  try {
    exigirCapacidad("carreras:fn_registrar_carrera");
  } catch (e) {
    console.warn("Aviso de capacidad al escribir carreras en matriz:", e);
  }

  const ids = await resolverIdsHipodromos();
  const fechaDef = hoyLocal();
  const filas: Record<string, unknown>[] = [];
  const vistas = new Set<string>();
  const sinRetirados: string[] = [];
  const sinInvalidados: string[] = [];
  const aFusionar: string[] = [];

  // Texto de hipódromo a escribir por clave canónica: reusa el que ya está
  // guardado (si la carrera existe con otra grafía) para que el `onConflict`
  // (fecha,hipodromo,carrera) actualice en vez de crear una fila duplicada.
  const fechasUnicas = [...new Set(entradas.map((e) => String(e.fecha || fechaDef).slice(0, 10)))];
  const existentes = await cargarHipodromosExistentes(fechasUnicas);
  const textosAEscribir = hipodromosAEscribir(entradas, existentes);

  for (const e of entradas) {
    const hip = String(e.hipodromo ?? "").trim().toUpperCase();
    const num = Number(e.carrera) || 0;
    if (!hip || !num) continue;
    const fecha = e.fecha || fechaDef;
    const hipoEscrito = textosAEscribir.get(`${String(fecha).slice(0, 10)}|${claveHipodromo(hip)}|${num}`) || hip;
    // Clave canónica (fecha | hipódromo sin espacios | número): es la que usan
    // también `vistas`, `preservarColumna` y el dedup de la matriz.
    const clave = `${String(fecha).slice(0, 10)}|${claveHipodromo(hipoEscrito)}|${num}`;
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    // Una entrada que no informa `retirados` significa "no tocar los retiros",
    // no "borrar los retiros". Se resuelven más abajo contra lo que ya está
    // guardado, porque el editor de programa de la IA no tiene control de ellos.
    if (e.retirados === undefined) sinRetirados.push(clave);
    if (e.invalidado_remate === undefined) sinInvalidados.push(clave);
    if (e.fusionar_ejemplares === true) aFusionar.push(clave);
    filas.push({
      fecha,
      hipodromo: hipoEscrito,
      hipodromo_id: ids.get(claveHipodromo(hipoEscrito)) ?? null,
      carrera: num,
      estado: ESTADOS_MAESTRO.has(String(e.estado ?? "")) ? String(e.estado) : "Programada",
      caballos: ordenarPorNumero(Array.isArray(e.caballos) ? e.caballos : []) as EjemplarMatriz[],
      retirados: e.retirados ?? null,
      invalidado_remate: e.invalidado_remate ?? null,
      distancia: e.distancia ?? null,
      superficie: e.superficie ?? null,
      premio: e.premio != null && Number.isFinite(Number(e.premio)) ? Number(e.premio) : null,
      hora: e.hora ?? null,
      origen: e.origen ?? "ia",
      actualizado_por: usuarioVigente() || null,
      updated_at: new Date().toISOString(),
    });
  }
  if (!filas.length) return { ok: true, guardadas: 0 };
  for (const f of filas) {
    desmarcarCarreraEliminadaLocal(f.fecha, f.hipodromo, f.carrera);
  }
  if (sinRetirados.length) await preservarRetirados(filas, sinRetirados);
  if (sinInvalidados.length) await preservarInvalidados(filas, sinInvalidados);
  if (aFusionar.length) await fusionarEjemplaresGuardados(filas, aFusionar);

  try {
    // 1. Intentar Bulk Upsert en 1 Sola Transacción vía RPC `upsert_lote_carreras_completo`
    try {
      const viaRpc = await supabase.rpc("upsert_lote_carreras_completo", {
        p_carreras: filas,
        p_origen: String(filas[0]?.origen ?? "ia"),
        p_usuario: usuarioVigente() || "sistema",
      });
      if (!viaRpc.error && viaRpc.data && (viaRpc.data as { ok?: boolean }).ok) {
        maestroDisponible = true;
        return { ok: true, guardadas: filas.length };
      }
    } catch {
      /* Fallback directo a upsert masivo en 1 llamada si la RPC aún no está aplicada */
    }

    // 2. Fallback Bulk Upsert directo en 1 sola petición HTTP a PostgREST
    const { error } = await supabase
      .from("carreras")
      .upsert(filas, { onConflict: "fecha,hipodromo,carrera" });
    if (error) {
      if (esAusente(error.message)) maestroDisponible = false;
      return { ok: false, error: error.message };
    }
    maestroDisponible = true;
    return { ok: true, guardadas: filas.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (esAusente(msg)) maestroDisponible = false;
    return { ok: false, error: msg };
  }
}

/**
 * Da de baja una carrera de la matriz. NO borra resultados, tablas fijas ni
 * jugadas ya registradas: la carrera deja de ofrecerse, el histórico queda.
 */
/**
 * Texto EXACTO con el que el hipódromo está guardado en la matriz.
 *
 * Las escrituras filtran con `.eq("hipodromo", ...)`, que compara texto. La BD
 * guarda el hipódromo como lo escribió el operador ("LA RINCONADA", "La
 * Rinconada"), y los módulos lo cruzan normalizado ("LARINCONADA"): con
 * mayúsculas distintas el `update`/`delete` no toca NADA y lo reporta como
 * éxito — el retiro se guardaba en resultados, la matriz no lo reflejaba y el
 * módulo tenía que recargar para "verificar" algo que nunca se había escrito.
 *
 * Primero prueba el texto tal cual llega (un viaje, el caso normal) y solo si
 * no hay coincidencia busca la fila por clave canónica, que ya sí depende solo
 * de la fecha del día.
 */
async function textoHipodromoEnMatriz(
  fecha: string,
  hipodromo: string
): Promise<string | null> {
  const sb = supabase;
  if (!sb) return null;
  const clave = claveHipodromo(hipodromo);
  if (!clave) return null;
  const pedido = String(hipodromo).trim().toUpperCase();
  const directo = await sb
    .from("carreras")
    .select("hipodromo")
    .eq("fecha", fecha)
    .eq("hipodromo", pedido)
    .limit(1);
  if (directo.error) throw new Error(directo.error.message);
  if (directo.data && directo.data.length) return pedido;
  const { data, error } = await sb.from("carreras").select("hipodromo").eq("fecha", fecha);
  if (error) throw new Error(error.message);
  const fila = (data ?? []).find((f) => claveHipodromo(f.hipodromo) === clave);
  return fila ? String(fila.hipodromo) : null;
}

export async function eliminarCarreraMaestro(
  fecha: string,
  hipodromo: string,
  carrera: number | string
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  const num = numeroCarrera(carrera);
  const clave = claveHipodromo(hipodromo);
  if (!clave || !num) {
    return { ok: false, error: "Hipódromo y Nº de carrera requeridos." };
  }
  const fechaNorm = String(fecha || hoyLocal()).slice(0, 10);
  marcarCarreraEliminadaLocal(fechaNorm, hipodromo, num);

  // Limpiar registros locales de gaceta y ensamblaje para que no resincronicen la carrera eliminada
  if (typeof window !== "undefined") {
    for (const k of ["gaceta_registro_v2", "gaceta_registro_v1", "gaceta_registro", "ensamblaje_carreras", "gaceta_prellenado"]) {
      try {
        const raw = window.localStorage.getItem(k);
        if (!raw) continue;
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) continue;
        const filtrado = arr.filter((item: Record<string, unknown>) => {
          const itemHipo = claveHipodromo(item?.hipodromo);
          const itemNum = numeroCarrera(item?.carrera);
          const itemFecha = item?.fecha ? String(item.fecha).slice(0, 10) : fechaNorm;
          return !(itemHipo === clave && itemNum === num && itemFecha === fechaNorm);
        });
        if (filtrado.length !== arr.length) {
          window.localStorage.setItem(k, JSON.stringify(filtrado));
        }
      } catch {
        /* ignore */
      }
    }
  }

  try {
    const pedido = String(hipodromo).trim().toUpperCase();
    const nombresHipo = new Set([pedido]);
    const idsCarreras: Array<string | number> = [];

    // Buscar todas las variantes del hipódromo registradas para este día en la matriz
    const { data: filasHipo } = await supabase
      .from("carreras")
      .select("id, hipodromo, carrera")
      .eq("fecha", fechaNorm);
    for (const f of filasHipo ?? []) {
      if (claveHipodromo(f.hipodromo) === clave) {
        nombresHipo.add(String(f.hipodromo));
        if (numeroCarrera(f.carrera) === num && f.id != null) {
          idsCarreras.push(f.id as string | number);
        }
      }
    }

    const listaHipos = [...nombresHipo];

    // 1. Borrar de carreras (matriz de oferta) por id y por clave natural
    if (idsCarreras.length > 0) {
      await supabase.from("carreras").delete().in("id", idsCarreras);
    }
    const { error: errCarreras } = await supabase
      .from("carreras")
      .delete()
      .eq("fecha", fechaNorm)
      .in("hipodromo", listaHipos)
      .eq("carrera", num);

    if (errCarreras && !/row-level security/i.test(errCarreras.message)) {
      return { ok: false, error: errCarreras.message };
    }

    // 2. Borrar también de resultados_carreras si existía un libro de resultados para esa carrera
    try {
      const { data: resFilas } = await supabase
        .from("resultados_carreras")
        .select("hipodromo")
        .eq("fecha", fechaNorm);
      const resHipos = new Set(listaHipos);
      for (const rf of resFilas ?? []) {
        if (claveHipodromo(rf.hipodromo) === clave) {
          resHipos.add(String(rf.hipodromo));
        }
      }
      await supabase
        .from("resultados_carreras")
        .delete()
        .eq("fecha", fechaNorm)
        .in("hipodromo", [...resHipos])
        .eq("carrera", num);
    } catch {
      /* best-effort si resultados_carreras no existe o no tiene fila */
    }

    // 3. Borrar también de tablas_fijas si existía una tabla publicada para esa carrera
    try {
      const { data: tfFilas } = await supabase
        .from("tablas_fijas")
        .select("id, hipodromo, carrera")
        .eq("fecha", fechaNorm);
      const tfIds = (tfFilas ?? [])
        .filter((tf) => claveHipodromo(tf.hipodromo) === clave && numeroCarrera(tf.carrera) === num && tf.id != null)
        .map((tf) => tf.id as string | number);
      if (tfIds.length > 0) {
        await supabase.from("tablas_fijas").delete().in("id", tfIds);
      }
    } catch {
      /* best-effort */
    }

    // 4. Limpiar programa_dia para que una recarga no restaure la carrera eliminada
    try {
      const { data: progFila } = await supabase
        .from("programa_dia")
        .select("fecha, carreras")
        .eq("fecha", fechaNorm)
        .maybeSingle();
      if (progFila && Array.isArray(progFila.carreras)) {
        const filtradas = (progFila.carreras as Array<Record<string, unknown>>).filter(
          (c) => !(claveHipodromo(c?.hipodromo) === clave && numeroCarrera(c?.carrera) === num)
        );
        if (filtradas.length === 0) {
          await supabase.from("programa_dia").delete().eq("fecha", fechaNorm);
        } else if (filtradas.length !== progFila.carreras.length) {
          await supabase.from("programa_dia").update({ carreras: filtradas }).eq("fecha", fechaNorm);
        }
      }
    } catch {
      /* best-effort */
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}


/**
 * Marca una carrera como verificada (o la desmarca).
 *
 * Verificar es un acto administrativo, no un dato del resultado: deja rastro de
 * QUIÉN revisó la fila y CUÁNDO. Es lo que permite auditar el catálogo: una
 * carrera cargada por la IA y nunca revisada se ve distinta de una que alguien
 * miró y dio por buena.
 */
export async function marcarCarreraVerificada(
  fecha: string,
  hipodromo: string,
  carrera: number | string,
  verificada: boolean
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  try {
    exigirCapacidad("carreras:btn_verificar_carrera");
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
const num = numeroCarrera(carrera);
  if (!claveHipodromo(hipodromo) || !num) {
    return { ok: false, error: "Hipódromo y Nº de carrera requeridos." };
  }
  const usuario = usuarioVigente() || null;
  const parche: Record<string, unknown> = {
    verificado: verificada,
    verificado_por: verificada ? usuario : null,
    verificado_at: verificada ? new Date().toISOString() : null,
    actualizado_por: usuario,
    updated_at: new Date().toISOString(),
  };
  try {
    const guardado = await textoHipodromoEnMatriz(fecha, hipodromo);
    if (!guardado) return { ok: true };
    const { error } = await supabase
      .from("carreras")
      .update(parche)
      .eq("fecha", fecha)
      .eq("hipodromo", guardado)
      .eq("carrera", num);
    if (error) {
      if (esAusente(error.message)) maestroDisponible = false;
      return { ok: false, error: error.message };
    }
    maestroDisponible = true;
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (esAusente(msg)) maestroDisponible = false;
    return { ok: false, error: msg };
  }
}

/**
 * Guarda la lista de ejemplares INVALIDADOS para Remates.
 *
 * Deliberadamente aparte de `retirados`: invalidar solo impide pujar y deja la
 * participación intacta, mientras que retirar saca el ejemplar de todos los
 * módulos. Mezclarlos haría que un INV de Remates desapareciera de Tablas,
 * Marcas y Taquilla.
 *
 * Misma semántica que los retiros: la lista es COMPLETA, nunca un delta.
 */
export async function guardarInvalidadosRemate(
  fecha: string,
  hipodromo: string,
  carrera: number | string,
  numeros: (string | number)[]
): Promise<{ ok: boolean; error?: string; invalidados: string[] }> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local).", invalidados: [] };
  const invalidados = normalizarRetirados(numeros);
  try {
exigirCapacidad("carreras:btn_invalidate_remate");
  } catch (e) {
    return { ok: false, error: (e as Error).message, invalidados };
  }
  const r = await reflejarInvalidadosMatriz(
    fecha,
    hipodromo,
    carrera,
    invalidados.length ? invalidados.join(",") : null
  );
  return { ok: r.ok, error: r.error, invalidados };
}

/**
 * Espeja UNA columna de la carrera en la matriz, sin tocar el resto de la fila.
 *
 * Es el patrón que usan los reflejos de retiros e invalidados: el dato se
 * guarda donde vive (resultados_carreras / el módulo que lo administra) y acá
 * solo se copia a `carreras`, que es lo que leen Dupletas, Gestión, Marcas y
 * Carreras del Día.
 *
 * No inventa fila: si la carrera todavía no está en la matriz no hace nada,
 * porque darla de alta acá escribiría estado y caballos vacíos.
 */
async function reflejarColumnaMatriz(
  fecha: string,
  hipodromo: string,
  carrera: number | string,
  columna: "retirados" | "invalidado_remate" | "invalidado_polla",
  valor: string | null
): Promise<{ ok: boolean; error?: string }> {
if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  const num = numeroCarrera(carrera);
  if (!claveHipodromo(hipodromo) || !num) {
    return { ok: false, error: "Hipódromo y Nº de carrera requeridos." };
  }
  try {
    const guardado = await textoHipodromoEnMatriz(fecha, hipodromo);
    if (!guardado) return { ok: true };
    const { error } = await supabase
      .from("carreras")
      .update({ [columna]: valor, actualizado_por: usuarioVigente() || null, updated_at: new Date().toISOString() })
      .eq("fecha", fecha)
      .eq("hipodromo", guardado)
      .eq("carrera", num)
      .select("carrera");
    if (error) {
      if (esAusente(error.message)) maestroDisponible = false;
      return { ok: false, error: error.message };
    }
    maestroDisponible = true;
    // Si la carrera no está en la matriz el update no toca nada y no es un
    // fallo: la lista ya quedó guardada en resultados_carreras y la corrida se
    // hidrata desde ahí cuando se cree la fila.
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (esAusente(msg)) maestroDisponible = false;
    return { ok: false, error: msg };
  }
}

export const reflejarRetiradosMatriz = (
  fecha: string,
  hipodromo: string,
  carrera: number | string,
  valor: string | null
) => reflejarColumnaMatriz(fecha, hipodromo, carrera, "retirados", valor);

/**
 * Invalida ejemplares SOLO para Pollas.
 *
 * Es gemelo de `guardarInvalidadosRemate` y va a otra columna por el mismo
 * motivo: los juegos son independientes. Un INV de Remates deja al ejemplar
 * pujable en una subasta y tiene que seguir disponible para una Polla, y al
 * revés. El retiro es lo único que saca a un ejemplar de todos los módulos.
 */
export async function guardarInvalidadosPolla(
  fecha: string,
  hipodromo: string,
  carrera: number | string,
  numeros: (string | number)[]
): Promise<{ ok: boolean; error?: string; invalidados: string[] }> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local).", invalidados: [] };
  const invalidados = normalizarRetirados(numeros);
  try {
    exigirCapacidad("pollas:btn_marcar_invalido");
  } catch (e) {
    return { ok: false, error: (e as Error).message, invalidados };
  }
  const r = await reflejarColumnaMatriz(
    fecha,
    hipodromo,
    carrera,
    "invalidado_polla",
    invalidados.length ? invalidados.join(",") : null
  );
  return { ok: r.ok, error: r.error, invalidados };
}

const reflejarInvalidadosMatriz = (
  fecha: string,
  hipodromo: string,
  carrera: number | string,
  valor: string | null
) => reflejarColumnaMatriz(fecha, hipodromo, carrera, "invalidado_remate", valor);

/** Mapea filas de la matriz al tipo que consume la plataforma. */
export { aCarreraCentral };

/**
 * Registra en la matriz una carrera suelta (alta manual, pizarra, arranque de una
 * apuesta). Si la tabla no está aplicada no rompe: devuelve el error para que el
 * operador sepa que falta correr sql/carreras.sql.
 */
export async function registrarCarreraMaestro(
  e: EntradaCarrera
): Promise<{ ok: boolean; error?: string }> {
  const r = await escribirCarrerasMaestro([e]);
  return { ok: r.ok, error: r.error };
}

export type DatosEdicionCarrera = {
  id?: string;
  fechaAntigua: string;
  hipodromoAntiguo: string;
  carreraAntigua: number;
  fechaNueva: string;
  hipodromoNuevo: string;
  carreraNueva: number;
  distanciaNueva?: string;
  horaNueva?: string;
};

/**
 * [Módulo 2 - Edición Manual de Carreras Registradas]
 * Modifica directamente una carrera registrada y actualiza en cascada
 * transaccionalmente todas las referencias asociadas (resultados, tablas fijas,
 * jugadas, marcas, pollas, remates, dupletas).
 */
export async function actualizarCarreraMaestro(
  datos: DatosEdicionCarrera
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase." };
  const u = usuarioVigente() || "admin";

  try {
    // 1. Intentar vía RPC transaccional optimizada
    const { data, error } = await supabase.rpc("club_actualizar_carrera_transaccional", {
      p_carrera_id: datos.id || null,
      p_fecha_antigua: datos.fechaAntigua,
      p_hipodromo_antiguo: datos.hipodromoAntiguo.trim().toUpperCase(),
      p_carrera_antigua: datos.carreraAntigua,
      p_fecha_nueva: datos.fechaNueva,
      p_hipodromo_nuevo: datos.hipodromoNuevo.trim().toUpperCase(),
      p_carrera_nueva: datos.carreraNueva,
      p_distancia_nueva: datos.distanciaNueva || null,
      p_hora_nueva: datos.horaNueva || null,
      p_usuario: u,
    });

    if (!error && data && (data as { ok?: boolean }).ok) {
      return { ok: true };
    }
    if (error && !error.message.includes("function") && !error.message.includes("does not exist")) {
      return { ok: false, error: error.message };
    }
  } catch (err) {
    console.warn("Fallo RPC club_actualizar_carrera_transaccional, recurriendo a actualización directa:", err);
  }

  // 2. Fallback transaccional del lado cliente si la RPC no estuviese compilada
  try {
    const hipoAntLimpio = datos.hipodromoAntiguo.trim().toUpperCase();
    const hipoNuevoLimpio = datos.hipodromoNuevo.trim().toUpperCase();

    // Actualizar fila en `carreras`
    let query = supabase.from("carreras").update({
      fecha: datos.fechaNueva,
      hipodromo: hipoNuevoLimpio,
      carrera: datos.carreraNueva,
      distancia: datos.distanciaNueva || undefined,
      hora: datos.horaNueva || undefined,
      actualizado_por: u,
      updated_at: new Date().toISOString(),
    });

    if (datos.id) {
      query = query.eq("id", datos.id);
    } else {
      query = query
        .eq("fecha", datos.fechaAntigua)
        .eq("hipodromo", hipoAntLimpio)
        .eq("carrera", datos.carreraAntigua);
    }

    const { error: errCarrera } = await query;
    if (errCarrera) {
      return { ok: false, error: `Error al actualizar carrera en maestro: ${errCarrera.message}` };
    }

    // Actualizar en cascada en tablas_fijas
    await supabase
      .from("tablas_fijas")
      .update({
        fecha: datos.fechaNueva,
        hipodromo: hipoNuevoLimpio,
        carrera: datos.carreraNueva,
      })
      .eq("fecha", datos.fechaAntigua)
      .eq("hipodromo", hipoAntLimpio)
      .eq("carrera", datos.carreraAntigua);

    // Actualizar en cascada en resultados_carreras
    await supabase
      .from("resultados_carreras")
      .update({
        fecha: datos.fechaNueva,
        hipodromo: hipoNuevoLimpio,
        carrera: datos.carreraNueva,
      })
      .eq("fecha", datos.fechaAntigua)
      .eq("hipodromo", hipoAntLimpio)
      .eq("carrera", datos.carreraAntigua);

    // Actualizar en cascada en jugadas
    await supabase
      .from("jugadas")
      .update({
        fecha: datos.fechaNueva,
        hipodromo: hipoNuevoLimpio,
        carrera: datos.carreraNueva,
      })
      .eq("fecha", datos.fechaAntigua)
      .eq("hipodromo", hipoAntLimpio)
      .eq("carrera", datos.carreraAntigua);

    return { ok: true };
  } catch (errFallback) {
    return {
      ok: false,
      error: `Error al editar la carrera: ${errFallback instanceof Error ? errFallback.message : String(errFallback)}`,
    };
  }
}