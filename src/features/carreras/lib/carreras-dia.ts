/**
 * Centralización de resultados de carreras del día.
 * La tabla public.resultados_carreras (paquete SQL, RLS off) es la fuente de
 * verdad compartida entre módulos: los resultados + pizarra se persistén aquí
 * y el store "Carreras del Día" (sistema-hipico:carreras-dia) mantiene las
 * ventas/estado en vivo para la UI (sincronizado entre pestañas por persist).
 */
import { supabase } from "@/core/supabase";
import { exigirCapacidad, tieneCapacidad } from "@/features/seguridad/lib/vigente";
import { puestosDesdeOrdenLlegada } from "@/features/motores/lib/oficiales";
import { useCarrerasDiaStore, type CarreraDelDia } from "@/shared/store/useCarrerasDiaStore";
import { claveCarrera } from "@/features/carreras/lib/claves";
import { registrarCarreraMaestro, ordenarPorNumero } from "@/features/carreras/lib/maestro";
import { hoyLocal, type CaballoPrograma } from "@/features/gaceta/lib/programa";

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
  cruces_carrera_override?: unknown;
};

function hoy(): string {
  // Fecha LOCAL (no UTC): con toISOString().slice(0,10) entre 20:00 y 24:00
  // (UTC−4) se escribía el DÍA ANTERIOR → jornadas que "desaparecían" del
  // filtro por fecha. ISO 8601 estricto con la fecha que ve el operador.
  return hoyLocal();
}

function normalizarRenglon(r: Record<string, unknown>): CarreraDelDia {
  const detalle = (r.detalle && typeof r.detalle === "object" && !Array.isArray(r.detalle)
    ? r.detalle
    : {}) as Record<string, unknown>;
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
    cruces_carrera_override: (r.cruces_carrera_override ?? detalle.cruces_carrera_override) &&
      typeof (r.cruces_carrera_override ?? detalle.cruces_carrera_override) === "object"
      ? (r.cruces_carrera_override ?? detalle.cruces_carrera_override) as CarreraDelDia["cruces_carrera_override"]
      : undefined,
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
  /** Orden de llegada en raya (1º, 2º, 3º…) si hubo distanciamiento; por defecto igual a `puestos`. */
  puestosRaya?: string[];
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
    let puestosRaya: string[] = puestos;
    if (Array.isArray(r.orden_llegada) && r.orden_llegada.length > 0) {
      const p0 = r.orden_llegada[0] as Record<string, unknown> | null;
      if (p0 && typeof p0 === "object") {
        if (Array.isArray(p0.orden_llegada_raya) && p0.orden_llegada_raya.length > 0) {
          puestosRaya = p0.orden_llegada_raya.map((x) => String(x ?? "").trim()).filter(Boolean);
        } else if (typeof p0.primero_raya === "string" && p0.primero_raya.trim() && p0.primero_raya.trim() !== puestos[0]) {
          const pr = p0.primero_raya.trim();
          puestosRaya = [pr, ...puestos.filter((n) => n !== pr)];
        }
      }
    }
    const div = r.dividendos;
    return {
      fecha: String(r.fecha ?? fecha ?? "").slice(0, 10),
      hipodromo: String(r.hipodromo ?? hip).toUpperCase(),
      carrera: (r.carrera ?? carrera) as number | string,
      puestos,
      puestosRaya,
      dividendos: div && typeof div === "object" && !Array.isArray(div) ? (div as Record<string, number>) : null,
    };
  } catch {
    return null;
  }
}

/**
 * JORNADA REAL de una carrera: el día al que pertenece, resuelto por su
 * identidad (hipódromo + número), no por el reloj.
 *
 * POR QUÉ EXISTE
 * --------------
 * La Taquilla liquidaba con `hoyLocal()` fijo. Si el operador cargaba el
 * resultado al día siguiente (o de una carrera de otra jornada), el motor
 * buscaba los tickets en el día de HOY, no los encontraba y devolvía
 * «Sin tickets pendientes»: nadie cobraba ni pagaba (VALENCIA C9, LA RINCONADA
 * C9). Acá se resuelve el día correcto antes de liquidar.
 *
 * ORDEN DE CONFIANZA (la primera que responda gana):
 *   1. `carreras` (la MATRIZ MAESTRA): una fila por carrera, es la definición
 *      de a qué jornada pertenece.
 *   2. `resultados_carreras`: la carrera que ya tiene resultado cargado.
 *   3. `tickets_apuestas.fecha_carrera`: la jornada con la que se vendieron.
 * Si ninguna responde, devuelve `null` y el llamador decide el fallback.
 */
export async function jornadaDeCarrera(
  hipodromo: string,
  carrera: number | string
): Promise<string | null> {
  if (!supabase) return null;
  const hip = String(hipodromo ?? "").trim().toUpperCase();
  const n = Number(carrera) || 0;
  if (!hip || n < 1) return null;
  const sdb = supabase;

  const masReciente = (valor: unknown): string | null => {
    const iso = String(valor ?? "").slice(0, 10);
    return iso ? iso : null;
  };

  // 1) Matriz maestra (`carreras`): fuente de verdad de la jornada.
  try {
    const { data, error } = await sdb
      .from("carreras")
      .select("fecha")
      .ilike("hipodromo", `%${hip}%`)
      .eq("carrera", n)
      .order("fecha", { ascending: false })
      .limit(1);
    if (!error && data?.length) {
      const f = masReciente((data[0] as { fecha?: unknown }).fecha);
      if (f) return f;
    }
  } catch {
    /* best-effort: se intenta con la siguiente fuente */
  }

  // 2) La carrera que ya tiene resultado cargado.
  try {
    const { data, error } = await sdb
      .from("resultados_carreras")
      .select("fecha")
      .ilike("hipodromo", `%${hip}%`)
      .eq("carrera", n)
      .order("fecha", { ascending: false })
      .limit(1);
    if (!error && data?.length) {
      const f = masReciente((data[0] as { fecha?: unknown }).fecha);
      if (f) return f;
    }
  } catch {
    /* best-effort */
  }

  // 3) La jornada con la que se vendieron los tickets.
  try {
    const { data, error } = await sdb
      .from("tickets_apuestas")
      .select("fecha_carrera")
      .eq("hipodromo", hip)
      .eq("carrera", n)
      .not("fecha_carrera", "is", null)
      .order("fecha_carrera", { ascending: false })
      .limit(1);
    if (!error && data?.length) {
      const f = masReciente((data[0] as { fecha_carrera?: unknown }).fecha_carrera);
      if (f) return f;
    }
  } catch {
    /* best-effort */
  }

  return null;
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
    const { leerCarrerasMaestro, aCarreraCentral, estadoDeCarrera } = await import("@/features/carreras/lib/maestro");
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
  // ACUMULA, no reemplaza: esta función trae SOLO el día pedido. Con
  // `setCarreras` (que reemplaza el ledger entero) cargar un día borraba las
  // carreras ya registradas de los demás días — y un lote PARCIAL de gaceta
  // (Belmont 1-3, luego Charles Town 4-6) se comía el hipódromo anterior.
  if (res.length) useCarrerasDiaStore.getState().fusionarLote(res);
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
    cruces_carrera_override: input.cruces_carrera_override as CarreraDelDia["cruces_carrera_override"],
    ventas,
    pago,
  });
  useCarrerasDiaStore.getState().pagar(input.hipodromo, input.carrera, input.premio_recalculado ?? 0, f);

  if (!supabase) return { ok: true };
  try {
    const detalle = {
      ventas: useCarrerasDiaStore.getState().estadoDe(input.hipodromo, input.carrera, f)?.ventas ?? ventas,
      pago: useCarrerasDiaStore.getState().estadoDe(input.hipodromo, input.carrera, f)?.pago ?? pago,
      ...(input.cruces_carrera_override !== undefined
        ? { cruces_carrera_override: input.cruces_carrera_override }
        : {}),
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
        ...(input.cruces_carrera_override !== undefined
          ? { cruces_carrera_override: input.cruces_carrera_override }
          : {}),
      }
    );
    return err ? { ok: false, error: err } : { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Permisos que habilitan REVERTIR una liquidación (dejar la carrera ABIERTA). */
const PERMISOS_REVERTIR_RESULTADO = [
  "gestion_jugadas:fn_reabrir_carrera",
  ...PERMISOS_GUARDAR_RESULTADO,
] as const;

/**
 * REVIERTE el resultado central de una carrera: la deja SIN resultado oficial
 * (`aplicado_a_tablas=false`, `ganadores`/`orden_llegada`/`dividendos` en
 * blanco) para que el semáforo y «Carreras del Día» vuelvan a "Programada" —
 * o sea, la carrera vuelve a estar ABIERTA y se puede cargar y liquidar de
 * nuevo. Es el paso final de `reversarLiquidacionCarrera`.
 *
 * Escribe por la RPC dedicada `club_revertir_resultado_carrera` (valida
 * `gestion_jugadas:fn_reabrir_carrera` en el servidor). Si esa RPC todavía no
 * está aplicada, cae al camino de `guardarResultado` con los campos en blanco
 * (que valida los permisos de carga/liquidación).
 */
export async function revertirResultadoCentral(input: {
  fecha?: string;
  hipodromo: string;
  carrera: number | string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!tieneCapacidad(...PERMISOS_REVERTIR_RESULTADO)) {
    return { ok: false, error: "Sin permiso para revertir el resultado de la carrera." };
  }
  const f = input.fecha || hoy();
  const hip = String(input.hipodromo ?? "").trim().toUpperCase();
  const carrera = Number(input.carrera) || 0;
  const estado = useCarrerasDiaStore.getState().estadoDe(hip, carrera, f);
  const ventas = estado?.ventas ?? [];

  // Store en vivo: la carrera vuelve a "Programada" (sin ganadores ni pago).
  useCarrerasDiaStore.getState().upsert({
    fecha: f,
    hipodromo: hip,
    carrera,
    estado: "Programada",
    ganadores: [],
    aplicado_a_tablas: false,
    ventas,
    pago: null,
  });

  if (!supabase) return { ok: true };
  const sdb = supabase;
  // Asegurar que tanto `resultados_carreras` como `carreras` vuelvan a "Programada"
  try {
    await sdb
      .from("resultados_carreras")
      .update({
        estado: "Programada",
        ganadores: [],
        aplicado_a_tablas: false,
        orden_llegada: null,
        dividendos: null,
        premio_oficial: null,
        premio_recalculado: null,
      })
      .eq("fecha", f)
      .ilike("hipodromo", hip)
      .eq("carrera", carrera);
  } catch {
    /* best-effort */
  }
  // 1) RPC dedicada (permiso de reversión validado en el servidor).
  try {
    const { error } = await sdb.rpc("club_revertir_resultado_carrera", {
      p_fecha: f,
      p_hipodromo: hip,
      p_carrera: carrera,
      p_usuario: null,
    });
    if (!error) return { ok: true };
    if (!/club_revertir_resultado_carrera|not found|404|PGRST202/i.test(error.message ?? "")) {
      return { ok: false, error: error.message };
    }
  } catch {
    /* RPC ausente → se usa el camino de guardarResultado */
  }
  // 2) Fallback: deja los campos del resultado en blanco.
  try {
    const err = await guardarResultado(f, hip, carrera, {
      ganadores: [],
      retirados: "NO HUBO RETIROS",
      aplicado_a_tablas: false,
      orden_llegada: null,
      dividendos: null,
      premio_oficial: null,
      premio_recalculado: null,
    });
    return err ? { ok: false, error: err } : { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
