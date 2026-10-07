/**
 * RETIROS DE EJEMPLARES — servicio CENTRAL de la carrera.
 *
 * La información de la carrera vive en UNA sola data: `resultados_carreras`
 * (única por fecha + hipódromo + carrera). Este módulo es el ÚNICO camino de
 * escritura de un retiro, sin importar desde qué módulo se haga:
 *
 *   1. Escribe `retirados` en la carrera central (resultados_carreras).
 *   1b. Refleja esa lista en la matriz `carreras.retirados`, que es la columna
 *       de la que leen Dupletas, Gestión, Marcas y Carreras del Día (best-effort:
 *       si la matriz no está aplicada, se hidrata desde resultados).
 *   2. Propaga a TODAS las tablas fijas de esa misma carrera
 *      (`caballos[].retirado`, `retirados_oficiales`) y recalcula el premio
 *      con baja proporcional (misma fórmula del legacy js/tablas.js):
 * *      nuevoPremio = premio_original * (1 − sumaRetirados / suma_base_tabla)
 *   3. Reembolsa (best-effort) los tickets pendientes de los ejemplares que se
 *      acaban de retirar y devuelve el importe al saldo del cliente.
 *
 * Como la lista es la misma para todos, retirar en Tablas Fijas, en la
 * Taquilla o en Carreras del Día se refleja en los demás módulos sin que
 * tengan que escribir nada.
 */
import { supabase } from "@/lib/supabase";
import { exigirPermiso } from "@/lib/seguridad/vigente";
import { hoyLocal } from "@/lib/gaceta/programa";
import { num, normalizarRetirados, parsearRetirados, textoRetirados } from "@/lib/carreras/retiros-nucleo";
import { claveHipodromo } from "@/lib/carreras/claves";
import { reflejarRetiradosMatriz } from "@/lib/carreras/maestro";

export type NumeroRetirado = string | number;

// El parseo/normalización de la lista de retirados es lógica pura y la consultan
// la matriz de carreras (carreras/maestro-nucleo) y la liquidación, así que vive
// en `retiros-nucleo.ts`, sin Supabase, para poder testearla en node.
export { SIN_RETIRADOS, normalizarRetirados, textoRetirados, parsearRetirados, num } from "@/lib/carreras/retiros-nucleo";

export type EntradaRetiros = {
  fecha?: string;
  hipodromo: string;
  carrera: number | string;
  /** Lista COMPLETA (no un delta) de números retirados de la carrera. */
  numeros: NumeroRetirado[];
};

export type ResultadoRetiros = {
  ok: boolean;
  /** Números retirados ya normalizados. */
  retirados: string[];
  /** Texto persistido: "2,5" o "NO HUBO RETIROS". */
  texto: string;
  /** Cuántas tablas fijas de la carrera quedaron sincronizadas. */
  tablasAfectadas: number;
  /** Tickets reembolsados (best-effort). */
  reembolsos: number;
  /** Premios recalculados por tabla (id → nuevo premio). */
  premios: Array<{ tabla: string; premio: number }>;
  errores?: string[];
  error?: string;
};

const SIN_RETIRADOS = "NO HUBO RETIROS";

/**
 * Texto con el que `resultados_carreras` guarda el hipódromo (con espacios).
 *
 * OJO con la diferencia con `claveHipodromo` de `claves.ts`: esta función
 * conserva los espacios porque acá se usa como `.eq` sobre una columna que ya
 * está guardada así, y cambiar la forma escribiría una fila NUEVA en vez de
 * actualizar la existente (el `onConflict` es por texto). Para COMPARAR datos
 * que pueden venir escritos de cualquier forma hay que usar `claveHipodromo`.
 */
const textoHipodromo = (h: unknown) => String(h ?? "").trim().toUpperCase();

/**
 * Aplica la lista COMPLETA de retirados de una carrera a TODAS sus tablas
 * fijas: marca `caballos[].retirado`, recalcula `retirados_oficiales` y el
 * premio con baja proporcional. Devuelve cuántas tablas quedaron sincronizadas.
 */
async function propagarATablas(
  fecha: string,
  hipodromo: string,
  carrera: number,
  retirados: Set<string>
): Promise<{
  tablas: number;
  premios: Array<{ tabla: string; premio: number }>;
  reembolsos: number;
  errores: string[];
}> {
  const premios: Array<{ tabla: string; premio: number }> = [];
  const errores: string[] = [];
  if (!supabase) return { tablas: 0, premios, reembolsos: 0, errores };
  let filas: Array<Record<string, unknown>> = [];
  try {
    // Filtro por clave canónica, no por texto: `.ilike('%LA RINCONADA%')` no
    // encuentra la tabla si el tablista la guardó como "LARINCONADA", y
    // `ilike('%RINCONADA%')` sí trae las de otro hipódromo. El día son pocas
    // filas, así que la comparación se hace acá con `claveHipodromo`, que es la
    // misma clave que usan matrices, marcas y dupletas.
    const r = await supabase
      .from("tablas_fijas")
      .select("id, hipodromo, carrera, fecha, caballos, premio_original, premio_recalculado, suma_base_tabla")
      .eq("fecha", fecha)
      .eq("carrera", carrera);
    if (r.error) throw r.error;
    const clave = claveHipodromo(hipodromo);
    filas = ((r.data ?? []) as Array<Record<string, unknown>>).filter(
      (f) => claveHipodromo(f.hipodromo as string) === clave
    );
  } catch (e) {
    errores.push(`tablas fijas: ${e instanceof Error ? e.message : String(e)}`);
  }

  for (const fila of filas) {
    const caballos = Array.isArray(fila.caballos) ? (fila.caballos as Array<Record<string, unknown>>) : [];
    if (!caballos.length) continue;
    const nuevos: Array<Record<string, unknown>> = caballos.map((c) => {
      const n = String(c.numero ?? "").trim();
      const retirado = retirados.has(n);
      return retirado ? { ...c, retirado: true, ganador: false } : { ...c, retirado: false };
    });
    const base = num(fila.suma_base_tabla);
    const sumaRetirados = nuevos
      .filter((c) => c.retirado)
      .reduce((a, c) => a + (num(c.valor_ejemplar) || 0), 0);
    let premio = num(fila.premio_original ?? fila.premio_recalculado);
    if (base > 0) premio = Math.max(0, premio * (1 - sumaRetirados / base));
    const texto = [...retirados].join(",") || SIN_RETIRADOS;

    try {
      const { error } = await supabase
        .from("tablas_fijas")
        .update({ caballos: nuevos, retirados_oficiales: texto, premio_recalculado: premio })
        .eq("id", fila.id);
      if (error) throw error;
      premios.push({ tabla: String(fila.id), premio });
    } catch (e) {
      errores.push(`tabla ${String(fila.id)}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // El reembolso va FUERA del loop de tablas fijas: si la carrera no tiene
  // ninguna tabla publicada el loop no corre y los tickets pendientes de los
  // retirados (tablas, dupletas, marcas, remates) quedaban sin devolver. La RPC
  // solo toca tickets en 'Pendiente', asi que repetirla es idempotente.
  let reembolsos = 0;
  if (retirados.size) {
    const r = await reembolsarTickets(fecha, hipodromo, carrera, [...retirados]);
    reembolsos += r.reembolsados;
    errores.push(...r.avisos);
  }
  return { tablas: filas.length, premios, reembolsos, errores };
}

/**
 * Reembolsa los tickets PENDIENTES de ejemplares retirados y acredita el saldo.
 *
 * Va por RPC (sql/tablas_venta.sql) porque la versión anterior lo hacía a mano
 * y estaba rota por dos motivos:
 *
 *  1) Filtraba con `.eq("fecha", fecha)`. `tickets_apuestas` no tiene columna
 *     `fecha`, se llama `fecha_registro`. El filtro no aplicaba y el reembolso
 *     salía en cero: nadie recuperaba lo del caballo retirado.
 *  2) Escribía `accion_aplicada` y `monto_resuelto`, que tampoco existen. Como
 *     el abono ya se había hecho antes, el UPDATE fallaba dejando el saldo
 *     acreditado y el ticket en Pendiente. El reintento abonaba OTRA VEZ: dinero
 *     duplicado. Por eso el marcado va dentro de la misma transaccion.
 *
 * El monto devuelto es el `monto_jugado` íntegro: en tabla fija el jugador no
 * tiene comisión, así que no hay nada que restar.
 */
async function reembolsarTickets(
  fecha: string,
  hipodromo: string,
  carrera: number,
  numeros: string[]
): Promise<{ reembolsados: number; avisos: string[] }> {
  const avisos: string[] = [];
  if (!supabase) return { reembolsados: 0, avisos };
  if (!numeros.length) return { reembolsados: 0, avisos };
  const { data, error } = await supabase.rpc("club_reembolsar_retirados", {
    p_fecha: fecha,
    p_hipodromo: hipodromo,
    p_carrera: carrera,
    p_numeros: numeros.join(","),
    p_usuario: null,
  });
  if (error) {
    return { reembolsados: 0, avisos: [`RPC: ${error.message}`] };
  }
  const d = (data ?? {}) as { reembolsados?: number; avisos?: string[] };
  for (const a of d.avisos ?? []) avisos.push(a);
  return { reembolsados: Number(d.reembolsados ?? 0), avisos };
}

/**
 * ÚNICO punto de escritura de retiros. Guarda la lista en la carrera central
 * y la propaga a todas las tablas fijas de esa carrera.
 */
export async function aplicarRetirosCarrera(entrada: EntradaRetiros): Promise<ResultadoRetiros> {
    try {
      // Con contexto, no solo con permiso. Además del hipódromo propio, el
      // `monto` se pone en 0 a propósito: esta operación no mueve dinero, así
      // que el único número que tiene sentido acá es el invariante de que el
      // monto nunca sea negativo (que la regla valida como un tope bajo).
      exigirPermiso("gestion_jugadas:fn_aplicar_retiros", {
        hipodromo: entrada.hipodromo,
        monto: 0,
      });
    } catch (e) {
      return {
        ok: false,
        retirados: [],
        texto: textoRetirados(entrada.numeros),
        tablasAfectadas: 0,
        reembolsos: 0,
        premios: [],
        error: (e as Error).message,
      };
    }
    const texto = textoRetirados(entrada.numeros);
  const retirados = normalizarRetirados(entrada.numeros);
  const hipodromo = textoHipodromo(entrada.hipodromo);
  const fecha = entrada.fecha || hoyLocal();
  const carrera = num(entrada.carrera) || 0;
  const vacio: ResultadoRetiros = {
    ok: false,
    retirados,
    texto,
    tablasAfectadas: 0,
    reembolsos: 0,
    premios: [],
  };
  if (!supabase) return { ...vacio, error: "Sin credenciales Supabase (.env.local)." };
  if (!hipodromo || !carrera) return { ...vacio, error: "Hipódromo y Nº de carrera requeridos." };

  const errores: string[] = [];
  try {
    // 1) CARRERA CENTRAL — fuente de verdad de la lista de retiros.
    //
    // Se actualiza la fila que YA existe en vez de hacer `upsert` a ciegas: la
    // clave única es (fecha, hipodromo, carrera) sobre TEXTO, así que un upsert
    // con otra forma de escribir el hipódromo no actualizaba la fila previa,
    // creaba una segunda y la carrera quedaba con dos listas de retiros
    // disputándose cuál manda. Con la fila locateda se actualiza siempre la
    // misma, sin importar cómo la escribió el módulo que la creó.
    const clave = claveHipodromo(hipodromo);
    const { data: existentes, error: errorLectura } = await supabase
      .from("resultados_carreras")
      .select("id, hipodromo")
      .eq("fecha", fecha)
      .eq("carrera", carrera);
    if (errorLectura) return { ...vacio, error: `Carrera central: ${errorLectura.message}` };
    const fila = ((existentes ?? []) as Array<{ id?: unknown; hipodromo?: string | null }>).find(
      (f) => claveHipodromo(f.hipodromo) === clave
    );
    if (fila?.id) {
      const { error } = await supabase
        .from("resultados_carreras")
        .update({ retirados: texto })
        .eq("id", fila.id as string);
      if (error) return { ...vacio, error: `Carrera central: ${error.message}` };
    } else {
      const { error } = await supabase
        .from("resultados_carreras")
        .upsert({ fecha, hipodromo, carrera, retirados: texto }, { onConflict: "fecha,hipodromo,carrera" });
      if (error) return { ...vacio, error: `Carrera central: ${error.message}` };
    }

    // 1b) MATRIZ `carreras` — los módulos leen los retiros de acá, no de
    // resultados. Sin este reflejo un retiro aplicado desde un módulo no se ve
    // en Dupletas, Gestión, Marcas ni Carreras del Día.
    //
    // Best-effort a propósito: si la matriz todavía no está aplicada, el retiro
    // igual quedó guardado arriba y se hidrata cuando se corra sql/carreras.sql.
    const mat = await reflejarRetiradosMatriz(fecha, hipodromo, carrera, texto);
    if (!mat.ok) errores.push(`Matriz de carreras: ${mat.error}`);

    // 2) TABLAS FIJAS de esa misma carrera + 3) REEMBOLSO.
    const set = new Set(retirados);
    const prop = await propagarATablas(fecha, hipodromo, carrera, set);
    errores.push(...prop.errores);
    return {
      ok: true,
      retirados,
      texto,
      tablasAfectadas: prop.tablas,
      reembolsos: prop.reembolsos,
      premios: prop.premios,
      errores: errores.length ? errores : undefined,
    };
  } catch (e) {
    return { ...vacio, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Agrega (o quita) un ejemplar de la lista central de retiros de la carrera y
 * deja el resto sin tocar. Es el atajo que usan los módulos al tocar un solo
 * caballo: lee la lista vigente, la ajusta y la reaplica.
 */
export async function alternarRetiroCarrera(opts: {
  fecha?: string;
  hipodromo: string;
  carrera: number | string;
  numero: NumeroRetirado;
  retirado: boolean;
}): Promise<ResultadoRetiros> {
  const fecha = opts.fecha || hoyLocal();
  const hipodromo = textoHipodromo(opts.hipodromo);
  const carrera = num(opts.carrera) || 0;
  const n = String(opts.numero ?? "").trim();
  const actuales = await leerRetirosCarrera(fecha, hipodromo, carrera);
  const lista = new Set(actuales);
  if (opts.retirado) lista.add(n);
  else lista.delete(n);
  const r = await aplicarRetirosCarrera({ fecha, hipodromo, carrera, numeros: [...lista] });
  return { ...r, reembolsos: r.reembolsos };
}

/**
 * Lee la lista central de retirados de la carrera ("2,5" → ["2","5"]).
 *
 * Tolera cualquiera de las dos formas en que el hipódromo quedó escrito en
 * `resultados_carreras` ("LA RINCONADA" o "LARINCONADA"): filtra por clave
 * canónica en vez de por texto. Importa porque `alternarRetiroCarrera` lee,
 * suma o quita UN número y vuelve a guardar la lista COMPLETA — si la lectura
 * fallaba, un solo clic borraba los retiros que ya había.
 */
export async function leerRetirosCarrera(
  fecha: string,
  hipodromo: string,
  carrera: number | string
): Promise<string[]> {
  if (!supabase) return [];
  const clave = claveHipodromo(hipodromo);
  const n = num(carrera) || 0;
  if (!clave || !n) return [];
  try {
    const { data, error } = await supabase
      .from("resultados_carreras")
      .select("hipodromo, retirados")
      .eq("fecha", fecha)
      .eq("carrera", n);
    if (error) return [];
    const fila = ((data ?? []) as Array<{ hipodromo?: string | null; retirados?: unknown }>).find(
      (f) => claveHipodromo(f.hipodromo) === clave
    );
    if (!fila) return [];
    return parsearRetirados(String(fila.retirados ?? ""));
  } catch {
    return [];
  }
}
