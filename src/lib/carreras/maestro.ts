/**
 * MATRIZ MAESTRA DE CARRERAS â€” la Ãºnica fuente del catÃ¡logo.
 *
 * POR QUÃ‰ ESTE MÃ“DULO
 * -------------------
 * Antes no habÃ­a tabla maestra: cada mÃ³dulo preguntaba "quÃ© carreras hay" por su
 * cuenta y el Ãºnico grano de "una fila por carrera" era `resultados_carreras`,
 * que es el LIBRO DE RESULTADOS. Eso obligaba a que una carrera solo existiera
 * para el resto de la plataforma cuando alguien corrÃ­a resultados o pulsaba
 * Publicar â€” al revÃ©s, porque para apostar hay que tener la carrera ANTES de
 * que exista resultado.
 *
 * `carreras` (sql/carreras.sql) es la matriz: una fila por (fecha, hipÃ³dromo,
 * carrera). Desde acÃ¡ se lee el catÃ¡logo con UN query â€”el resultado viene
 * embebido por `resultados_carreras.carrera_id`â€” y se escribe desde la IA.
 *
 * La lÃ³gica pura (normalizadores, estado, mapeo a `CarreraCatalogo`) vive en
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
import { supabase } from "@/lib/supabase";
import { exigirCapacidad, usuarioVigente } from "@/lib/seguridad/vigente";
import { normalizarRetirados } from "@/lib/carreras/retiros-nucleo";
import { hoyLocal } from "@/lib/gaceta/programa";
import { claveHipodromo, numeroCarrera } from "@/lib/carreras/claves";
import {
  COLUMNAS_MAESTRO,
  ESTADOS_MAESTRO,
  aCarreraCentral,
  dedupFilasMaestro,
} from "@/lib/carreras/maestro-nucleo";
import type {
  EjemplarMatriz,
  EntradaCarrera,
  FilaCarreraMaestro,
} from "@/lib/carreras/maestro-nucleo";

export * from "@/lib/carreras/maestro-nucleo";

// ---------------------------------------------------------------------------
// Estado de la migraciÃ³n
// ---------------------------------------------------------------------------

/**
 * `null` = todavÃ­a no se mirÃ³. Una vez que la tabla responde "no existe", no se
 * vuelve a preguntar en cada render: el fallback a `resultados_carreras` queda
 * cacheado y se reintenta solo si el operador invalida.
 */
let maestroDisponible: boolean | null = null;

/** Lo llama el resto de la app cuando una escritura revela que el SQL no corriÃ³. */
export function marcarMaestroAusente(): void {
  maestroDisponible = false;
}

/** Fuerza a volver a intentar la matriz (tras aplicar el SQL y recargar). */
export function reintentarMaestro(): void {
  maestroDisponible = null;
  idsHipodromos.clear();
}

/** Â¿EstÃ¡ aplicada la matriz maestra? */
export function maestroActivo(): boolean {
  return maestroDisponible === true;
}

/** `true` cuando el error dice "esta tabla/relaciÃ³n no existe" â†’ falta el SQL. */
function esAusente(msg: string): boolean {
  return /does not exist|not found|PGRST202|PGRST204|schema cache/i.test(msg);
}

// ---------------------------------------------------------------------------
// Lectura de la matriz
// ---------------------------------------------------------------------------

export type ResMaestro = { ok: boolean; filas: FilaCarreraMaestro[]; error?: string };

/**
 * Lee la matriz para `fecha` (+ hipÃ³dromo opcional). El resultado va EMBEBIDO
 * para que el catÃ¡logo y el resultado salgan en un solo viaje: antes cada mÃ³dulo
 * hacÃ­a su consulta extra de ganadores.
 *
 * Si el embed falla (la FK `carrera_id` se acaba de aplicar y PostgREST aÃºn no
 * recacheÃ³ el esquema) reintenta sin embed antes de rendirse.
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
    const delHipo = hipo ? filas.filter((x) => claveHipodromo(x.hipodromo) === hipo) : filas;
    return { ok: true, filas: dedupFilasMaestro(delHipo) };
  };

  try {
    const conResultado = await consulta(true);
    if (!conResultado.error) {
      maestroDisponible = true;
      return cerrar(conResultado.data);
    }
    // El embed no resuelve (FK reciÃ©n aplicada y PostgREST sin recachear):
    // reintento sin embed; la fila igual trae todo el catÃ¡logo.
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

/** Nombre normalizado (MAYÃšSCULAS) â†’ id de `hipodromos`. Se llena una vez. */
const idsHipodromos = new Map<string, number>();

/**
 * `OpcionHipodromo` (lib/tablas/rpc) solo trae value/label, asÃ­ que el id se
 * pide directo a la tabla: es un select de 2 columnas y se cachea para toda la
 * sesiÃ³n. Si falla, las carreras se guardan sin `hipodromo_id` â€” no bloquea.
 */
async function resolverIdsHipodromos(): Promise<Map<string, number>> {
  if (idsHipodromos.size > 0) return idsHipodromos;
  if (!supabase) return idsHipodromos;
  try {
    const { data, error } = await supabase.from("hipodromos").select("id, nombre");
    if (!error) {
      for (const r of (data ?? []) as Array<{ id?: unknown; nombre?: unknown }>) {
        const k = String(r.nombre ?? "").trim().toUpperCase();
        if (k && r.id != null) idsHipodromos.set(k, Number(r.id));
      }
    }
  } catch {
    /* sin catÃ¡logo: se guarda sin hipodromo_id, no es bloqueante */
  }
  return idsHipodromos;
}

/**
 * Deja intacta una columna de las filas cuyo llamador no la informÃ³.
 *
 * Sin esto, guardar el programa desde la IA mandarÃ­a `retirados: null` a cada
 * carrera y borrarÃ­a los retiros que un operador acaba de aplicar: la matriz
 * tiene que poder seguir guardando caballos, estados y horario sin pisar las
 * listas que los mÃ³dulos leen.
 *
 * Sirve igual para `invalidado_remate`, que es el otro caso: la IA no lo
 * controla, y mandarlo en NULL dejarÃ­a pujables ejemplares que el operador del
 * remate invalidÃ³ a propÃ³sito.
 *
 * Si la lectura falla no se inventa nada: se saca la columna del payload, que
 * es lo Ãºnico que evita mandarla en NULL a ciegas.
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
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      const clave = `${r.fecha}|${String(r.hipodromo ?? "").toUpperCase()}|${Number(r.carrera) || 0}`;
      if (pedidas.has(clave)) guardados.set(clave, r[columna] ?? null);
    }
    for (const f of filas) {
      const clave = `${f.fecha}|${f.hipodromo}|${f.carrera}`;
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
 * Da de alta / actualiza carreras en la matriz (una fila por hipÃ³dromo+carrera).
 * Es la vÃ­a que usa la IA al guardar el programa: la carrera existe para TODOS
 * los mÃ³dulos apenas se guarda, sin esperar resultados ni Publicar.
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
    return { ok: false, error: (e as Error).message };
  }

  const ids = await resolverIdsHipodromos();
  const fechaDef = hoyLocal();
  const filas: Record<string, unknown>[] = [];
  const vistas = new Set<string>();
  const sinRetirados: string[] = [];
  const sinInvalidados: string[] = [];

  for (const e of entradas) {
    const hip = String(e.hipodromo ?? "").trim().toUpperCase();
    const num = Number(e.carrera) || 0;
    if (!hip || !num) continue;
    const fecha = e.fecha || fechaDef;
    const clave = `${fecha}|${hip}|${num}`;
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    // Una entrada que no informa `retirados` significa "no tocar los retiros",
    // no "borrar los retiros". Se resuelven mÃ¡s abajo contra lo que ya estÃ¡
    // guardado, porque el editor de programa de la IA no tiene control de ellos.
if (e.retirados === undefined) sinRetirados.push(clave);
    if (e.invalidado_remate === undefined) sinInvalidados.push(clave);
    filas.push({
      fecha,
      hipodromo: hip,
      hipodromo_id: ids.get(hip) ?? null,
      carrera: num,
      estado: ESTADOS_MAESTRO.has(String(e.estado ?? "")) ? String(e.estado) : "Programada",
      caballos: (Array.isArray(e.caballos) ? e.caballos : []) as EjemplarMatriz[],
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
  if (sinRetirados.length) await preservarRetirados(filas, sinRetirados);
  if (sinInvalidados.length) await preservarInvalidados(filas, sinInvalidados);

  try {
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
 * jugadas ya registradas: la carrera deja de ofrecerse, el histÃ³rico queda.
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
  try {
    exigirCapacidad("carreras:fn_eliminar_carrera");
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const num = numeroCarrera(carrera);
  if (!claveHipodromo(hipodromo) || !num) {
    return { ok: false, error: "Hipódromo y Nº de carrera requeridos." };
  }
  try {
    const guardado = await textoHipodromoEnMatriz(fecha, hipodromo);
    // No hay fila con esa clave: no hay nada que borrar, y no es un fallo.
    if (!guardado) return { ok: true };
    const { error } = await supabase
      .from("carreras")
      .delete()
      .eq("fecha", fecha)
      .eq("hipodromo", guardado)
      .eq("carrera", num);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}


/**
 * Marca una carrera como verificada (o la desmarca).
 *
 * Verificar es un acto administrativo, no un dato del resultado: deja rastro de
 * QUIÃ‰N revisÃ³ la fila y CUÃNDO. Es lo que permite auditar el catÃ¡logo: una
 * carrera cargada por la IA y nunca revisada se ve distinta de una que alguien
 * mirÃ³ y dio por buena.
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
 * participaciÃ³n intacta, mientras que retirar saca el ejemplar de todos los
 * mÃ³dulos. Mezclarlos harÃ­a que un INV de Remates desapareciera de Tablas,
 * Marcas y Taquilla.
 *
 * Misma semÃ¡ntica que los retiros: la lista es COMPLETA, nunca un delta.
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
 * Es el patrÃ³n que usan los reflejos de retiros e invalidados: el dato se
 * guarda donde vive (resultados_carreras / el mÃ³dulo que lo administra) y acÃ¡
 * solo se copia a `carreras`, que es lo que leen Dupletas, GestiÃ³n, Marcas y
 * Carreras del DÃ­a.
 *
 * No inventa fila: si la carrera todavÃ­a no estÃ¡ en la matriz no hace nada,
 * porque darla de alta acÃ¡ escribirÃ­a estado y caballos vacÃ­os.
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
    // Si la carrera no estÃ¡ en la matriz el update no toca nada y no es un
    // fallo: la lista ya quedÃ³ guardada en resultados_carreras y la corrida se
    // hidrata desde ahÃ­ cuando se cree la fila.
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
 * apuesta). Si la tabla no estÃ¡ aplicada no rompe: devuelve el error para que el
 * operador sepa que falta correr sql/carreras.sql.
 */
export async function registrarCarreraMaestro(
  e: EntradaCarrera
): Promise<{ ok: boolean; error?: string }> {
  const r = await escribirCarrerasMaestro([e]);
  return { ok: r.ok, error: r.error };
}
