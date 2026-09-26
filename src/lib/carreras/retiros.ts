/**
 * RETIROS DE EJEMPLARES — servicio CENTRAL de la carrera.
 *
 * La información de la carrera vive en UNA sola data: `resultados_carreras`
 * (única por fecha + hipódromo + carrera). Este módulo es el ÚNICO camino de
 * escritura de un retiro, sin importar desde qué módulo se haga:
 *
 *   1. Escribe `retirados` en la carrera central (resultados_carreras).
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
import { hoyLocal } from "@/lib/gaceta/programa";

export type NumeroRetirado = string | number;

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

const num = (n: unknown): number => {
  const v = parseFloat(String(n ?? "").replace(",", "."));
  return Number.isFinite(v) ? v : 0;
};

/** Normaliza a strings únicas ordenadas numéricamente ("2", "5", "10"). */
export function normalizarRetirados(numeros: NumeroRetirado[] | null | undefined): string[] {
  const limpio = (numeros ?? [])
    .map((n) => String(n ?? "").trim())
    .filter((n) => n.length > 0);
  return [...new Set(limpio)].sort((a, b) => (num(a) - num(b)) || a.localeCompare(b));
}

/** Texto canónico que se guarda en `retirados` / `retirados_oficiales`. */
export function textoRetirados(numeros: NumeroRetirado[] | null | undefined): string {
  const lista = normalizarRetirados(numeros);
  return lista.length ? lista.join(",") : SIN_RETIRADOS;
}

/**
 * Parsea tolerantemente lo que escribe el operador ("2,5" · "2 5" · "2, 5" ·
 * "2-5" · "#2 #5") y devuelve la lista de números. El rango "a-b" se expande.
 */
export function parsearRetirados(texto: string): string[] {
  const salida = new Set<string>();
  const limpio = String(texto ?? "").trim();
  if (!limpio || limpio.toUpperCase() === SIN_RETIRADOS) return [];
  // Rangos "2-5" primero (evita leer el guion como separador).
  for (const m of limpio.matchAll(/(\d+)\s*[-–—a]{1,2}\s*(\d+)/gi)) {
    const a = num(m[1]);
    const b = num(m[2]);
    if (a > 0 && b >= a && b - a <= 99) for (let i = a; i <= b; i++) salida.add(String(i));
  }
  for (const m of limpio.matchAll(/\d+/g)) salida.add(String(num(m[0])));
  return normalizarRetirados([...salida]);
}

const claveHipodromo = (h: unknown) => String(h ?? "").trim().toUpperCase();

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
    const r = await supabase
      .from("tablas_fijas")
      .select("id, hipodromo, carrera, fecha, caballos, premio_original, premio_recalculado, suma_base_tabla")
      .eq("fecha", fecha)
      .ilike("hipodromo", `%${hipodromo}%`)
      .eq("carrera", carrera);
    if (r.error) throw r.error;
    // `ilike` es parcial: se descarta cualquier tabla de otro hipódromo cuyo
    // nombre contenga el nuestro (p. ej. "RINCONADA" vs "LA RINCONADA").
    filas = ((r.data ?? []) as Array<Record<string, unknown>>).filter(
      (f) => claveHipodromo(f.hipodromo as string) === claveHipodromo(hipodromo)
    );
  } catch (e) {
    return { tablas: 0, premios, reembolsos: 0, errores: [e instanceof Error ? e.message : String(e)] };
  }

  let reembolsos = 0;

  for (const fila of filas) {
    const caballos = Array.isArray(fila.caballos) ? (fila.caballos as Array<Record<string, unknown>>) : [];
    if (!caballos.length) continue;
    const nuevos: Array<Record<string, unknown>> = caballos.map((c) => {
      const n = String(c.numero ?? "").trim();
      const retirado = retirados.has(n);
      return retirado ? { ...c, retirado: true, ganador: false } : { ...c, retirado: false };
    });
    const yaRetiradosAntes = new Set(
      caballos.filter((c) => c.retirado).map((c) => String(c.numero ?? "").trim())
    );
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

    // Reembolso best-effort SOLO de los que se acaban de retirar.
    const nuevosRetirados = [...retirados].filter((n) => !yaRetiradosAntes.has(n));
    if (nuevosRetirados.length) {
      const r = await reembolsarTickets(fecha, hipodromo, carrera, nuevosRetirados);
      reembolsos += r.reembolsados;
      errores.push(...r.avisos);
    }
  }
  return { tablas: filas.length, premios, reembolsos, errores };
}

/** Reembolsa tickets Pendientes de ejemplares retirados y suma al saldo del cliente. */
async function reembolsarTickets(
  fecha: string,
  hipodromo: string,
  carrera: number,
  numeros: string[]
): Promise<{ reembolsados: number; avisos: string[] }> {
  const avisos: string[] = [];
  if (!supabase) return { reembolsados: 0, avisos };
  let reembolsados = 0;
  for (const n of numeros) {
    try {
      // La fecha es parte de la clave: sin ella se reembolsarían tickets
      // PENDIENTES de jornadas anteriores del mismo hipódromo/carrera.
      const { data: tickets } = await supabase
        .from("tickets_apuestas")
        .select("id, cliente_juega_id, monto_jugado")
        .eq("fecha", fecha)
        .eq("hipodromo", hipodromo)
        .eq("carrera", carrera)
        .eq("ejemplar_numero", num(n) || 0)
        .eq("estado", "Pendiente");
      if (!tickets || !tickets.length) continue;
      for (const tk of tickets as Array<{ id: string; cliente_juega_id: string | null; monto_jugado: unknown }>) {
        const monto = num(tk.monto_jugado);
        const { error } = await supabase
          .from("tickets_apuestas")
          .update({
            estado: "Retirado",
            premio_pagar: 0,
            accion_aplicada: "REEMBOLSO",
            monto_resuelto: monto,
          })
          .eq("id", tk.id);
        if (error) throw error;
        if (monto > 0 && tk.cliente_juega_id) {
          const { data: cl } = await supabase
            .from("clientes")
            .select("saldo_actual")
            .eq("id", tk.cliente_juega_id)
            .maybeSingle();
          if (cl) {
            await supabase
              .from("clientes")
              .update({ saldo_actual: num(cl.saldo_actual) + monto })
              .eq("id", tk.cliente_juega_id);
          }
        }
        reembolsados += 1;
      }
    } catch (e) {
      avisos.push(`reembolso ${n}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { reembolsados, avisos };
}

/**
 * ÚNICO punto de escritura de retiros. Guarda la lista en la carrera central
 * y la propaga a todas las tablas fijas de esa carrera.
 */
export async function aplicarRetirosCarrera(entrada: EntradaRetiros): Promise<ResultadoRetiros> {
  const texto = textoRetirados(entrada.numeros);
  const retirados = normalizarRetirados(entrada.numeros);
  const hipodromo = claveHipodromo(entrada.hipodromo);
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
    const { error } = await supabase.from("resultados_carreras").upsert(
      { fecha, hipodromo, carrera, retirados: texto },
      { onConflict: "fecha,hipodromo,carrera" }
    );
    if (error) return { ...vacio, error: `Carrera central: ${error.message}` };

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
  const hipodromo = claveHipodromo(opts.hipodromo);
  const carrera = num(opts.carrera) || 0;
  const n = String(opts.numero ?? "").trim();
  const actuales = await leerRetirosCarrera(fecha, hipodromo, carrera);
  const lista = new Set(actuales);
  if (opts.retirado) lista.add(n);
  else lista.delete(n);
  const r = await aplicarRetirosCarrera({ fecha, hipodromo, carrera, numeros: [...lista] });
  return { ...r, reembolsos: r.reembolsos };
}

/** Lee la lista central de retirados de la carrera ("2,5" → ["2","5"]). */
export async function leerRetirosCarrera(
  fecha: string,
  hipodromo: string,
  carrera: number | string
): Promise<string[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("resultados_carreras")
      .select("retirados")
      .eq("fecha", fecha)
      .eq("hipodromo", claveHipodromo(hipodromo))
      .eq("carrera", num(carrera) || 0)
      .maybeSingle();
    if (error || !data) return [];
    return parsearRetirados(String((data as { retirados?: unknown }).retirados ?? ""));
  } catch {
    return [];
  }
}
