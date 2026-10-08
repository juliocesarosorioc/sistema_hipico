/**
 * Centralización de resultados de carreras del día.
 * La tabla public.resultados_carreras (paquete SQL, RLS off) es la fuente de
 * verdad compartida entre módulos: los resultados + pizarra se persistén aquí
 * y el store "Carreras del Día" (sistema-hipico:carreras-dia) mantiene las
 * ventas/estado en vivo para la UI (sincronizado entre pestañas por persist).
 */
import { supabase } from "@/lib/supabase";
import { exigirCapacidad, tieneCapacidad } from "@/lib/seguridad/vigente";
import { puestosDesdeOrdenLlegada } from "@/lib/motores/oficiales";
import { useCarrerasDiaStore, type CarreraDelDia } from "@/store/useCarrerasDiaStore";
import { claveCarrera } from "@/lib/carreras/claves";
import { registrarCarreraMaestro, ordenarPorNumero } from "@/lib/carreras/maestro";
import { hoyLocal, type CaballoPrograma } from "@/lib/gaceta/programa";

export type ResultadoCentralInput = {
  fecha?: string;
  hipodromo: string;
  carrera: number | string;
  ganadores: string[];
  retirados: string;
  premio_oficial?: number;
  premio_recalculado?: number;
  detalle?: unknown;
  orden_llegada?: unknown;
  dividendos?: unknown;
  cargado_por?: string;
};

function hoy(): string {
  // Fecha LOCAL (no UTC): con toISOString().slice(0,10) entre 20:00 y 24:00
  // (UTC−4) se escribía el DÍA ANTERIOR → jornadas que "desaparecían" del
  // filtro por fecha. ISO 8601 estricto con la fecha que ve el operador.
  return hoyLocal();
}

function normalizarRenglon(r: Record<string, unknown>): CarreraDelDia {
  const detalle = (Array.isArray(r.detalle) ? r.detalle : {}) as Record<string, unknown>;
  const ventas = Array.isArray(detalle.ventas)
    ? (detalle.ventas as CarreraDelDia["ventas"])
    : [];
  const pagado = detalle.pago;
  return {
    fecha: String(r.fecha ?? hoy()).slice(0, 10),
    hipodromo: String(r.hipodromo ?? "").trim().toUpperCase(),
    carrera: Number(r.carrera) || 0,
    estado: Boolean(r.aplicado_a_tablas)
      ? "Liquidada"
      : Array.isArray(r.ganadores) && (r.ganadores as unknown[]).length
        ? "Resultados"
        : "Programada",
    ganadores: Array.isArray(r.ganadores) ? (r.ganadores ?? []).map(String) : undefined,
    retirados: r.retirados ? String(r.retirados) : undefined,
    premio_oficial: r.premio_oficial != null ? Number(r.premio_oficial) : undefined,
    premio_recalculado: r.premio_recalculado != null ? Number(r.premio_recalculado) : undefined,
    aplicado_a_tablas: Boolean(r.aplicado_a_tablas),
    cargado_por: r.cargado_por ? String(r.cargado_por) : undefined,
    ventas,
    pago: pagado ? (pagado as CarreraDelDia["pago"]) : null,
    updatedAt: r.updated_at ? String(r.updated_at) : undefined,
  };
}

/**
 * Lee el resultado OFICIAL ya cargado de una carrera: orden de llegada y
 * dividendos por $1. Es lo que consumen los reportes y la relación de
 * resultados; antes solo se ESCRIBIAN estas columnas y ningún reporte las
 * leia, así que todo se liquidaba a la par de la casa.
 */
export type ResultadoOficial = {
  fecha: string;
  hipodromo: string;
  carrera: number | string;
  /** Orden de llegada (1º, 2º, 3º…); cae a `ganadores` si no hay orden oficial. */
  puestos: string[];
  /** Pagos por $1 (`dividendos`): claves "win", "nini", "tabla", "win:7"… */
  dividendos: Record<string, number> | null;
};

export async function leerResultadoOficial(
  hipodromo: string,
  carrera: number | string,
  fecha?: string
): Promise<ResultadoOficial | null> {
  if (!supabase) return null;
  const hip = String(hipodromo ?? "").trim().toUpperCase();
  if (!hip) return null;
  try {
    const q = supabase
      .from("resultados_carreras")
      .select("fecha, hipodromo, carrera, ganadores, orden_llegada, dividendos")
      .eq("carrera", carrera as never)
      .ilike("hipodromo", `%${hip}%`)
      .order("fecha", { ascending: false })
      .limit(1);
    const { data, error } = fecha ? await q.eq("fecha", fecha) : await q;
    if (error || !data?.length) return null;
    const r = data[0] as { fecha?: unknown; hipodromo?: unknown; carrera?: unknown; ganadores?: unknown; orden_llegada?: unknown; dividendos?: unknown };
    // `orden_llegada` es [{numero,puesto}] y `ganadores` es text[]: ambos se
    // normalizan a la lista 1º..8º que entiende la pizarra.
    const oficial = puestosDesdeOrdenLlegada(r.orden_llegada);
    const puestos = oficial.length ? oficial : puestosDesdeOrdenLlegada(r.ganadores);
    const div = r.dividendos;
    return {
      fecha: String(r.fecha ?? fecha ?? "").slice(0, 10),
      hipodromo: String(r.hipodromo ?? hip).toUpperCase(),
      carrera: (r.carrera ?? carrera) as number | string,
      puestos,
      dividendos: div && typeof div === "object" && !Array.isArray(div) ? (div as Record<string, number>) : null,
    };
  } catch {
    return null;
  }
}

/**
 * Permisos que habilitan a GUARDAR el resultado de una carrera. Cada botón
 * legítimo (Carga de Resultados, Liquidar, Pagar carrera, Registrar carrera)
 * entra por uno distinto, así que se acepta cualquiera de ellos. La lista
 * está replicada dentro de la RPC: la app es una primera barrera, el servidor
 * es la que manda.
 */
const PERMISOS_GUARDAR_RESULTADO = [
  "gestion_jugadas:fn_liquidar_carrera",
  "gestion_jugadas:btn_cargar_resultados",
  "taquilla:btn_cargar_resultados",
  "carreras:fn_registrar_carrera",
] as const;

function exigirPermisoGuardarResultado(): void {
  if (!tieneCapacidad(...PERMISOS_GUARDAR_RESULTADO)) {
    throw new Error("Sin permiso para guardar resultados de carrera.");
  }
}

/**
 * Escribe en `resultados_carreras` pasando por la RPC `security definer`, que
 * valida la capacidad EN EL SERVIDOR. Antes se hacía un `.upsert()` directo
 * contra una tabla abierta a `anon`, así que la anon key (que va incrustada en
 * el bundle público) permitía modificar los dividendos desde fuera.
 *
 * Las columnas que no se pasan no se tocan: registrar de nuevo una carrera ya
 * liquidada no le borra el resultado.
 *
 * Si la RPC todavía no existe en Supabase (sql/resultados_rpc.sql sin correr)
 * cae al upsert directo para que la operación no se caiga.
 */
async function guardarResultado(
  fecha: string,
  hipodromo: string,
  carrera: number,
  fila: Record<string, unknown>
): Promise<string | null> {
  const r = await supabase!.rpc("club_guardar_resultado_carrera", {
    p_fecha: fecha,
    p_hipodromo: hipodromo,
    p_carrera: carrera,
    p_fila: fila,
  });
  if (!r.error) return null;
  const texto = String(r.error.message ?? r.error);
  // "No existe la función" → todavía no se corrió el SQL: comportamiento viejo.
  if (/PGRST202|not found|does not exist|404/i.test(texto)) {
    const u = await supabase!
      .from("resultados_carreras")
      .upsert({ fecha, hipodromo, carrera, ...fila }, { onConflict: "fecha,hipodromo,carrera" });
    return u.error?.message ?? null;
  }
  return texto;
}

/** Trae las carreras del día y alimenta el store. */
export async function cargarCarrerasDelDia(fecha?: string): Promise<CarreraDelDia[]> {
  const res: CarreraDelDia[] = [];
  const f = fecha || hoy();
  if (!supabase) return res;

  // 1) Resultados (ganadores, dividendos, ventas/detalle/pago) por clave. Es el
  //    LIBRO de resultados, no la lista de carreras.
  const porClave = new Map<string, CarreraDelDia>();
  try {
    const { data, error } = await supabase
      .from("resultados_carreras")
      .select("*")
      .eq("fecha", f);
    if (error) throw error;
    for (const r of (data ?? []) as unknown[]) {
      const c = normalizarRenglon(r as Record<string, unknown>);
      porClave.set(claveCarrera(c.hipodromo, c.carrera), c);
    }
  } catch {
    /* sin tabla de resultados → se arma solo desde la matriz */
  }

  // 2) La MATRIZ MAESTRA `carreras` es la fuente de QUÉ carreras hay. A cada una
  //    se le adjunta su resultado si existe, sin inventar carreras que solo
  //    estén en el libro (eso era la lista partida). El RESULTADO siempre gana
  //    sobre el estado de la matriz.
  try {
    const { leerCarrerasMaestro, aCarreraCentral, estadoDeCarrera } = await import("@/lib/carreras/maestro");
    const m = await leerCarrerasMaestro(f, "");
    if (m.ok) {
      for (const fila of m.filas) {
        const c = aCarreraCentral(fila);
        const prev = porClave.get(claveCarrera(c.hipodromo, c.carrera));
        if (prev) {
          res.push(prev);
          continue;
        }
        const propio = String(fila.estado ?? "").trim();
        const estado: CarreraDelDia["estado"] =
          propio === "Liquidada" || propio === "Resultados" || propio === "Programada"
            ? propio
            : estadoDeCarrera(fila, null) === "Liquidada"
              ? "Liquidada"
              : "Programada";
        res.push({
          fecha: f,
          hipodromo: c.hipodromo,
          carrera: c.carrera,
          estado,
          retirados: c.retirados?.join(", ") || undefined,
          ventas: [],
        });
      }
    }
  } catch {
    /* matriz no aplicada → sin carreras (la matriz es la fuente) */
  }

  res.sort((a, b) => a.hipodromo.localeCompare(b.hipodromo) || a.carrera - b.carrera);
  if (res.length) useCarrerasDiaStore.getState().setCarreras(res);
  return res;
}

/**
 * Registra una carrera manual (Modo Manual / bypass Gaceta) contra la BD.
 *
 * Escribe SOLO la matriz `carreras`, que es la fuente única del catálogo y la
 * que listan `listarCarrerasPorDia` y `listarCarrerasCentrales`. Carreras del Día
 * ya no escribe la oferta en `resultados_carreras` (que queda como libro de
 * resultados) ni en `programa_dia` (documento crudo del importador).
 *
 * `caballos` es opcional: si viene, viaja con la carrera para que el catálogo
 * tenga los ejemplares (ver `sincronizarCentralDesdeTabla`).
 */

export async function registrarCarreraProgramada(
    input: {
      fecha?: string;
      hipodromo: string;
      carrera: number | string;
      /** Ejemplares de la carrera, si se conocen al registrar. */
      caballos?: CaballoPrograma[];
    }
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      exigirCapacidad("carreras:fn_registrar_carrera");
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    const f = input.fecha || hoy();
  const hip = String(input.hipodromo).trim().toUpperCase();
  const num = Number(input.carrera) || 0;
  if (!hip || !num) return { ok: false, error: "Hipódromo y carrera requeridos." };
  if (!useCarrerasDiaStore.getState().existeCarrera(hip, num, f)) {
    useCarrerasDiaStore.getState().upsert({
      fecha: f,
      hipodromo: hip,
      carrera: num,
      estado: "Programada",
      ventas: [],
    });
  }
  if (!supabase) return { ok: true };

  // La matriz `carreras` es la fuente única: la carrera se registra SOLO acá.
  // `resultados_carreras` y `programa_dia` no reciben la oferta desde Carreras
  // del Día.
  try {
    const r = await registrarCarreraMaestro({
      fecha: f,
      hipodromo: hip,
      carrera: num,
      estado: "Programada",
      caballos: (input.caballos ?? []) as never,
      origen: "manual",
    });
    if (r.ok) return { ok: true };
    return { ok: false, error: r.error ?? "No se pudo registrar la carrera." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Normaliza ejemplares de cualquier forma (`EjemplarTabla`, `EjemplarCarreraCentral`,
 * objetos sueltos) a la del Programa del Día.
 *
 * Se hace aquí y no en el llamador porque `tablas_fijas` y el central tipan el
 * ejemplar cada uno a su manera: `nacionalidad` es obligatoria en uno y
 * opcional-en-null en el otro, y `valor` se llama distinto. Si no se normaliza,
 * TS obliga a hacer el cast en cada uno de los llamadores y el primero que se
 * equivoque escribe basura al programa del día.
 */
function aCaballosPrograma(bruto: unknown[] | null | undefined): CaballoPrograma[] {
  if (!Array.isArray(bruto)) return [];
  const out: CaballoPrograma[] = [];
  for (const c of bruto) {
    if (c == null) continue;
    const r = c as Record<string, unknown>;
    const numero = r.numero ?? r.n ?? null;
    if (numero == null || String(numero).trim() === "") continue;
    const nombre = String(r.nombre ?? "").trim();
    // Sin nombre el ejemplar no sirve para marcar ni para la pizarra: se
    // descarta en vez de meter un placeholder que después aparece como caballo.
    if (!nombre) continue;
    const valor = r.valor_ejemplar ?? r.valor ?? r.pts ?? null;
    out.push({
      numero: numero as string | number,
      nombre: nombre.toUpperCase(),
      nacionalidad: String(r.nacionalidad ?? "VE").toUpperCase(),
      valor: valor != null && Number.isFinite(Number(valor)) ? Number(valor) : undefined,
      ejemplar_id: (r.ejemplar_id ?? r.id ?? null) as string | number | null,
      retirado: r.retirado === true ? true : undefined,
      peso: (r.peso ?? undefined) as string | number | undefined,
      jockey: (r.jockey ?? undefined) as string | undefined,
    } as CaballoPrograma);
  }
  return ordenarPorNumero(out);
}

/**
 * SINCRONIZA EL CENTRAL al publicar una tabla.
 *
 * Este es el agujero que hacía desaparecer carreras. Publicar escribía SOLO en
 * `tablas_fijas`, y el central (`resultados_carreras`) únicamente se llenaba
 * desde el Modo Manual para carreras VACÍAS. Como Marcas, Gestión de Jugadas y
 * Dupletas leen el central, una tabla publicada con sus caballos existía en
 * Tablas y en Taquilla pero era INVISIBLE en los otros tres módulos — y el
 * operador no podía venderla ni cargarle marcas sin registrarla a mano.
 *
 * Se llama desde `publicarTabla` / `publicarTablasLote` para que la
 * sincronización ocurra con cualquier llamador, no solo desde el módulo de
 * Tablas. Es best-effort: si el central no se puede escribir, la tabla igual
 * queda publicada (que es lo importante para la venta) y se devuelve el motivo.
 */
export async function sincronizarCentralDesdeTabla(tabla: {
  hipodromo?: string | null;
  carrera?: number | string | null;
  fecha?: string | null;
  fecha_creacion?: string | null;
  caballos?: unknown[] | null;
  distancia_carrera?: number | string | null;
  superficie?: string | null;
  premio_original?: number | null;
}): Promise<{ ok: boolean; error?: string }> {
  const f = tabla.fecha || tabla.fecha_creacion || "";
  if (!f) return { ok: false, error: "La tabla no tiene fecha: no se puede sincronizar el central." };
  const caballos = aCaballosPrograma(tabla.caballos);
  return registrarCarreraProgramada({
    fecha: String(f).slice(0, 10),
    hipodromo: tabla.hipodromo ?? "",
    carrera: tabla.carrera ?? 0,
    caballos,
  });
}

/**
 * Persisté el resultado central (upsert por fecha+hipodromo+carrera) y
 * actualiza el store. Las ventas de la sesión viajan dentro de detalle.ventas
 * y detalle.pago para sobrevivir al cierre de pestaña / recarga.
 */
export async function upsertResultadoCentral(
  input: ResultadoCentralInput
): Promise<{ ok: boolean; error?: string }> {
  try {
    exigirPermisoGuardarResultado();
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const f = input.fecha || hoy();
  const estado = useCarrerasDiaStore.getState().estadoDe(input.hipodromo, input.carrera, f);
  const ventas = estado?.ventas ?? [];
  const pago = estado?.pago ?? null;

  // Actualiza el store (fuente en vivo, se paga si había ventas ganadoras).
  useCarrerasDiaStore.getState().upsert({
    fecha: f,
    hipodromo: String(input.hipodromo).trim().toUpperCase(),
    carrera: Number(input.carrera) || 0,
    estado: "Liquidada",
    ganadores: input.ganadores,
    retirados: input.retirados,
    premio_oficial: input.premio_oficial,
    premio_recalculado: input.premio_recalculado,
    aplicado_a_tablas: true,
    cargado_por: input.cargado_por,
    ventas,
    pago,
  });
  useCarrerasDiaStore.getState().pagar(input.hipodromo, input.carrera, input.premio_recalculado ?? 0, f);

  if (!supabase) return { ok: true };
  try {
    const detalle = {
      ventas: useCarrerasDiaStore.getState().estadoDe(input.hipodromo, input.carrera, f)?.ventas ?? ventas,
      pago: useCarrerasDiaStore.getState().estadoDe(input.hipodromo, input.carrera, f)?.pago ?? pago,
    };
    const err = await guardarResultado(
      f,
      String(input.hipodromo).trim().toUpperCase(),
      Number(input.carrera) || 0,
      {
        ganadores: input.ganadores,
        retirados: input.retirados,
        premio_oficial: input.premio_oficial ?? null,
        premio_recalculado: input.premio_recalculado ?? null,
        detalle,
        aplicado_a_tablas: true,
        cargado_por: input.cargado_por ?? null,
        orden_llegada: input.orden_llegada ?? null,
        dividendos: input.dividendos ?? null,
      }
    );
    return err ? { ok: false, error: err } : { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
