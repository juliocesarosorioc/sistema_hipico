/**
 * Centralización de resultados de carreras del día.
 * La tabla public.resultados_carreras (paquete SQL, RLS off) es la fuente de
 * verdad compartida entre módulos: los resultados + pizarra se persistén aquí
 * y el store "Carreras del Día" (sistema-hipico:carreras-dia) mantiene las
 * ventas/estado en vivo para la UI (sincronizado entre pestañas por persist).
 */
import { supabase } from "@/core/supabase";
import {
  exigirCapacidad,
  grupoActivoVigente,
  grupoVigente,
  tieneCapacidad,
  veTodosLosGruposVigente,
} from "@/features/seguridad/lib/vigente";
import { puestosDesdeOrdenLlegada } from "@/features/motores/lib/oficiales";
import { useCarrerasDiaStore, type CarreraDelDia } from "@/shared/store/useCarrerasDiaStore";
import { claveCarrera, claveHipodromo } from "@/features/carreras/lib/claves";
import { registrarCarreraMaestro, ordenarPorNumero, actualizarCarreraMaestro, type DatosEdicionCarrera } from "@/features/carreras/lib/maestro";
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

/**
 * Control persistente de carreras reversadas por jornada (`reversadas:YYYY-MM-DD`).
 * Garantiza que al reversar una liquidación se elimine la pizarra y la carrera
 * NUNCA vuelva a aparecer como Liquidada ni con pizarra registrada hasta que el
 * operador o administrador la liquide de nuevo explícitamente.
 */
export function grupoStorageEfectivo(grupoId?: string | null): string {
  const explicito = String(grupoId ?? "").trim();
  if (explicito) return explicito;
  const g = veTodosLosGruposVigente()
    ? grupoActivoVigente() || grupoVigente()
    : grupoVigente() || grupoActivoVigente();
  return String(g ?? "").trim();
}

export function claveStorageReversadas(fecha: string | undefined, grupoId?: string | null): string {
  const f = String(fecha || hoy()).slice(0, 10);
  const g = grupoStorageEfectivo(grupoId);
  return g ? `reversadas:${g}:${f}` : `reversadas:${f}`;
}

export function claveStorageLiquidadas(fecha: string | undefined, grupoId?: string | null): string {
  const f = String(fecha || hoy()).slice(0, 10);
  const g = grupoStorageEfectivo(grupoId);
  return g ? `liquidadas:${g}:${f}` : `liquidadas:${f}`;
}

export function marcarCarreraReversadaLocal(
  fecha: string | undefined,
  hipodromo: string,
  carrera: number | string,
  grupoId?: string | null
): void {
  if (typeof window === "undefined") return;
  try {
    const f = String(fecha || hoy()).slice(0, 10);
    const cur = claveHipodromo(hipodromo);
    const num = Number(carrera) || 0;
    if (!f || !cur || !num) return;
    const key = claveStorageReversadas(f, grupoId);
    const raw = window.localStorage.getItem(key);
    const prev = raw ? (JSON.parse(raw) as string[]) : [];
    const set = new Set(Array.isArray(prev) ? prev.map(String) : []);
    set.add(`${cur}|${num}`);
    window.localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

export function desmarcarCarreraReversadaLocal(
  fecha: string | undefined,
  hipodromo: string,
  carrera: number | string,
  grupoId?: string | null
): void {
  if (typeof window === "undefined") return;
  try {
    const f = String(fecha || hoy()).slice(0, 10);
    const cur = claveHipodromo(hipodromo);
    const num = Number(carrera) || 0;
    if (!f || !cur || !num) return;
    const key = claveStorageReversadas(f, grupoId);
    const raw = window.localStorage.getItem(key);
    if (!raw) return;
    const prev = JSON.parse(raw) as string[];
    if (!Array.isArray(prev)) return;
    const set = new Set(prev.map(String));
    if (set.delete(`${cur}|${num}`)) {
      window.localStorage.setItem(key, JSON.stringify([...set]));
    }
  } catch {
    /* ignore */
  }
}

export function esCarreraReversadaLocal(
  fecha: string | undefined,
  hipodromo: string,
  carrera: number | string,
  grupoId?: string | null
): boolean {
  if (typeof window === "undefined") return false;
  try {
    const f = String(fecha || hoy()).slice(0, 10);
    const cur = claveHipodromo(hipodromo);
    const num = Number(carrera) || 0;
    if (!f || !cur || !num) return false;
    const key = claveStorageReversadas(f, grupoId);
    const raw = window.localStorage.getItem(key);
    if (!raw) return false;
    const arr = JSON.parse(raw) as string[];
    if (!Array.isArray(arr)) return false;
    const target = `${cur}|${num}`;
    return arr.some((x) => String(x).toUpperCase().replace(/\s+/g, "") === target);
  } catch {
    return false;
  }
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
    const fechaEfectiva = (fecha ? String(fecha).slice(0, 10) : null) || (await jornadaDeCarrera(hip, carrera));
    if (fechaEfectiva && esCarreraReversadaLocal(fechaEfectiva, hip, carrera)) {
      return null;
    }
    const q = supabase
      .from("resultados_carreras")
      .select("fecha, hipodromo, carrera, ganadores, orden_llegada, dividendos")
      .eq("carrera", carrera as never)
      .ilike("hipodromo", `%${hip}%`)
      .order("fecha", { ascending: false })
      .limit(1);
    const { data, error } = fechaEfectiva ? await q.eq("fecha", fechaEfectiva) : await q;
    if (error || !data?.length) return null;
    const r = data[0] as { fecha?: unknown; hipodromo?: unknown; carrera?: unknown; ganadores?: unknown; orden_llegada?: unknown; dividendos?: unknown };
    const fechaRow = String(r.fecha ?? fechaEfectiva ?? "").slice(0, 10);
    if (fechaRow && esCarreraReversadaLocal(fechaRow, hip, carrera)) {
      return null;
    }
    // `orden_llegada` es [{numero,puesto}] y `ganadores` es text[]: ambos se
    // normalizan a la lista 1º..8º que entiende la pizarra.
    const oficial = puestosDesdeOrdenLlegada(r.orden_llegada);
    const puestos = oficial.length ? oficial : puestosDesdeOrdenLlegada(r.ganadores);
    if (!puestos.length) return null;
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
      fecha: fechaRow,
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
  // Intentar primero vía API route administrativa para garantizar guardado sin bloqueos por RLS
  try {
    const resApi = await fetch("/api/carreras/guardar-resultado", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fecha, hipodromo, carrera, fila }),
    });
    const json = await resApi.json();
    if (json.ok) return null;
  } catch {
    /* fallback a RPC */
  }

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
      if (esCarreraReversadaLocal(f, c.hipodromo, c.carrera)) continue;
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
        const reversada = esCarreraReversadaLocal(f, c.hipodromo, c.carrera);
        const prev = reversada ? undefined : porClave.get(claveCarrera(c.hipodromo, c.carrera));
        if (prev) {
          const retPrev = (String(prev.retirados ?? "")
            .replace(/NO\s+HUBO\s+RETIROS?/gi, "")
            .match(/\d+/g) ?? []).map((x) => x.trim());
          const retUnidos = [...new Set([...retPrev, ...(c.retirados ?? [])].filter(Boolean))];
          res.push({
            ...prev,
            retirados: retUnidos.length > 0 ? retUnidos.join(", ") : prev.retirados,
          });
          continue;
        }
        const propio = reversada ? "Programada" : String(fila.estado ?? "").trim();
        const estado: CarreraDelDia["estado"] =
          reversada
            ? "Programada"
            : propio === "Liquidada" || propio === "Resultados" || propio === "Programada"
              ? propio
              : estadoDeCarrera(fila, null) === "Liquidada"
                ? "Liquidada"
                : "Programada";
        res.push({
          fecha: f,
          hipodromo: c.hipodromo,
          carrera: c.carrera,
          estado,
          ganadores: reversada ? [] : undefined,
          aplicado_a_tablas: reversada ? false : undefined,
          retirados: c.retirados?.join(", ") || undefined,
          ventas: [],
          pago: null,
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
  useCarrerasDiaStore.getState().reemplazarDia(f, res);
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
  // Al guardar y liquidar un resultado nuevo explícitamente, se desmarca la reversión previa
  desmarcarCarreraReversadaLocal(f, input.hipodromo, input.carrera);

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
 * blanco y eliminando la fila de pizarra en `resultados_carreras`) para que el
 * semáforo y «Carreras del Día» vuelvan a "Programada" — o sea, la carrera
 * vuelve a estar ABIERTA y sin pizarra colocada hasta que el operador la
 * liquide de nuevo.
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
  let dbOk = false;

  // Persistir inmediatamente la marca local de reversión para que ninguna lectura
  // recargue la pizarra ni el estado Liquidada.
  marcarCarreraReversadaLocal(f, hip, carrera);

  // Store en vivo: la carrera vuelve a "Programada" (sin ganadores, sin pizarra ni pago).
  useCarrerasDiaStore.getState().upsert({
    fecha: f,
    hipodromo: hip,
    carrera,
    estado: "Programada",
    ganadores: [],
    premio_oficial: undefined,
    premio_recalculado: undefined,
    aplicado_a_tablas: false,
    ventas,
    pago: null,
  });

  // 0) Ejecutar primero por la ruta administrativa con service_role para eliminar
  //    la pizarra de `resultados_carreras`, volver `carreras` a "Programada",
  //    reabrir `tablas_fijas` y pasar `tickets_apuestas` a "Pendiente" sin bloqueos RLS.
  try {
    const resApi = await fetch("/api/carreras/guardar-resultado", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accion: "revertir",
        fecha: f,
        hipodromo: hip,
        carrera,
      }),
    });
    const json = await resApi.json();
    if (json?.ok) {
      dbOk = true;
    }
  } catch {
    /* fallback a cliente / RPC */
  }

  if (!supabase) return { ok: true };
  const sdb = supabase;
  const clave = claveHipodromo(hip);

  // 1) Asegurar que la tabla matriz `carreras` vuelva a "Programada".
  // Se buscan las filas por fecha+carrera y se filtran por clave de hipódromo
  // (robusto ante diferencias de espacios/mayúsculas), actualizando por id.
  try {
    const { data: rows } = await sdb
      .from("carreras")
      .select("id, hipodromo")
      .eq("fecha", f)
      .eq("carrera", carrera);
    const ids = (rows ?? [])
      .filter((r: Record<string, unknown>) => claveHipodromo(String(r.hipodromo ?? "")) === clave)
      .map((r: Record<string, unknown>) => r.id);
    if (ids.length > 0) {
      const { error } = await sdb.from("carreras").update({ estado: "Programada" }).in("id", ids as never[]);
      if (!error) dbOk = true;
    } else {
      const { error } = await sdb
        .from("carreras")
        .update({ estado: "Programada" })
        .eq("fecha", f)
        .ilike("hipodromo", `%${hip.replace(/\s+/g, "%")}%`)
        .eq("carrera", carrera);
      if (!error) dbOk = true;
    }
  } catch {
    /* best-effort */
  }

  // 2) Resetear la fila en `resultados_carreras` (eliminarla para limpieza absoluta o blanquearla)
  try {
    const { data: rows } = await sdb
      .from("resultados_carreras")
      .select("id, hipodromo")
      .eq("fecha", f)
      .eq("carrera", carrera);
    const ids = (rows ?? [])
      .filter((r: Record<string, unknown>) => claveHipodromo(String(r.hipodromo ?? "")) === clave)
      .map((r: Record<string, unknown>) => r.id);
    if (ids.length > 0) {
      const { error: errDel } = await sdb.from("resultados_carreras").delete().in("id", ids as never[]);
      if (!errDel) {
        dbOk = true;
      } else {
        const { error } = await sdb
          .from("resultados_carreras")
          .update({
            estado: "Programada",
            ganadores: null,
            aplicado_a_tablas: false,
            orden_llegada: null,
            dividendos: null,
            premio_oficial: null,
            premio_recalculado: null,
          })
          .in("id", ids as never[]);
        if (!error) dbOk = true;
      }
    } else {
      const { error: errDel } = await sdb
        .from("resultados_carreras")
        .delete()
        .eq("fecha", f)
        .ilike("hipodromo", `%${hip.replace(/\s+/g, "%")}%`)
        .eq("carrera", carrera);
      if (!errDel) {
        dbOk = true;
      } else {
        const { error } = await sdb
          .from("resultados_carreras")
          .update({
            estado: "Programada",
            ganadores: null,
            aplicado_a_tablas: false,
            orden_llegada: null,
            dividendos: null,
            premio_oficial: null,
            premio_recalculado: null,
          })
          .eq("fecha", f)
          .ilike("hipodromo", `%${hip.replace(/\s+/g, "%")}%`)
          .eq("carrera", carrera);
        if (!error) dbOk = true;
      }
    }
  } catch {
    /* best-effort */
  }

  // 3) RPC dedicada en servidor (si existe y tiene permisos). Es la fuente
  //    autoritativa: si existe, su resultado manda sobre los updates directos.
  try {
    const { error } = await sdb.rpc("club_revertir_resultado_carrera", {
      p_fecha: f,
      p_hipodromo: hip,
      p_carrera: carrera,
      p_usuario: null,
    });
    if (!error) dbOk = true;
  } catch {
    /* RPC opcional */
  }

  return { ok: dbOk, error: dbOk ? undefined : "No se pudo actualizar la base de datos al revertir. Verifique permisos/RLS." };
}


/**
 * [Módulo 2] Edita manualmente una carrera en la base de datos y sincroniza el store local.
 */
export async function editarCarreraRegistrada(
  datos: DatosEdicionCarrera
): Promise<{ ok: boolean; error?: string }> {
  const res = await actualizarCarreraMaestro(datos);
  if (!res.ok) return res;

  // Actualizar store reactivo en el cliente
  try {
    const store = useCarrerasDiaStore.getState();
    const carreras = [...store.carreras];
    const hipAnt = datos.hipodromoAntiguo.trim().toUpperCase();
    const hipNuevo = datos.hipodromoNuevo.trim().toUpperCase();

    const idx = carreras.findIndex(
      (c) =>
        c.fecha === datos.fechaAntigua &&
        c.hipodromo.trim().toUpperCase() === hipAnt &&
        Number(c.carrera) === Number(datos.carreraAntigua)
    );

    if (idx >= 0) {
      carreras[idx] = {
        ...carreras[idx],
        fecha: datos.fechaNueva,
        hipodromo: hipNuevo,
        carrera: Number(datos.carreraNueva),
      };
      useCarrerasDiaStore.setState({ carreras });
    }
  } catch {
    /* ignore store update */
  }

  return { ok: true };
}