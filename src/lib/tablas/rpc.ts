import { supabase } from "@/lib/supabase";
import type { TablaFijaRow } from "@/lib/tablas-fijas";
import { parseNum } from "@/lib/tablas/tipos";
import { leerProgramaPorFecha } from "@/lib/gaceta/programa";

export const FALLBACK_HIPODROMOS = [
  "LA RINCONADA",
  "VALENCIA",
  "SANTA RITA",
  "POMONA",
  "GULFSTREAM",
  "AQUEDUCT",
  "BELMONT",
  "SARATOGA",
  "CHURCHILL DOWNS",
  "KEENELAND",
  "SANTA ANITA",
  "DEL MAR",
  "MONMOUTH",
  "LAUREL",
  "WOODBINE",
];

export type OpcionHipodromo = { value: string; label: string };

/**
 * Lista de hipódromos operativos (misma fuente que el legacy: `hipodromos`
 * con SELECT plano ordenado — sin filtros de columna inventados).
 * La data sale SIEMPRE de la tabla real cuando hay conexión; el respaldo
 * local solo aparece si la tabla/RLS impide la lectura.
 */
export async function listarHipodromos(): Promise<OpcionHipodromo[]> {
  const mapear = (rows: unknown[]): OpcionHipodromo[] =>
    rows
      .map((r) => {
        const h = r as { nombre?: unknown };
        return { value: String(h.nombre ?? "").toUpperCase(), label: String(h.nombre ?? "") };
      })
      .filter((h) => h.label.trim().length)
      .sort((a, b) => a.label.localeCompare(b.label));

  const sdb = supabase;
  if (!sdb) return mapear(FALLBACK_HIPODROMOS);

  const orquestar = async () => {
    // Intento 1 — SELECT plano (exactamente como js/hipodromos.js y js/taquilla.js).
    const r1 = await sdb.from("hipodromos").select("id, nombre").order("nombre", { ascending: true });
    if (!r1.error) return r1.data as unknown[];
    // Intento 2 — esquema con borrado lógico explícito (deleted_at).
    const r2 = await sdb.from("hipodromos").select("id, nombre").is("deleted_at", null).order("nombre");
    if (!r2.error) return r2.data as unknown[];
    // Intento 3 — esquema mínimo legacy (estado = 'Activo').
    const r3 = await sdb.from("hipodromos").select("id, nombre").eq("estado", "Activo").order("nombre");
    if (!r3.error) return r3.data as unknown[];
    // Intento 4 — variante "estatus" (algunas BD usan este nombre).
    const r4 = await sdb.from("hipodromos").select("id, nombre").eq("estatus", "Activo").order("nombre");
    if (!r4.error) return r4.data as unknown[];
    throw new Error([r1.error?.message, r2.error?.message, r3.error?.message, r4.error?.message].filter(Boolean).join("; "));
  };

  try {
    const filas = await orquestar();
    return mapear(filas);
  } catch (e) {
    console.warn("listarHipodromos: sin acceso a la tabla, usando respaldo local.", e);
    return mapear(FALLBACK_HIPODROMOS);
  }
}

/**
 * Asegura que un hipódromo exista en la tabla `hipodromos` (modo manual).
 * Si el nombre tipeado no está registrado, lo inserta `{ nombre, pais }`
 * (mismo shape del legacy js/hipodromos.js). El llamador debe refrescar el
 * caché de la UI (useHipodromosStore.invalidar) para que el buscador lo
 * encuentre en sesiones futuras.
 */
export async function asegurarHipodromo(nombre: string): Promise<{ ok: boolean; yaExistia: boolean; error?: string }> {
  const n = String(nombre ?? "").trim().toUpperCase();
  if (!n) return { ok: false, yaExistia: false, error: "Nombre vacío." };
  const sdb = supabase;
  if (!sdb) return { ok: true, yaExistia: false };
  try {
    const { data, error } = await sdb
      .from("hipodromos")
      .select("id, nombre")
      .ilike("nombre", n)
      .limit(1)
      .maybeSingle();
    if (error && error.code !== "PGRST116") return { ok: false, yaExistia: false, error: error.message };
    if (data) return { ok: true, yaExistia: true };
    const { error: eIns } = await sdb.from("hipodromos").insert([{ nombre: n, pais: "OTRO" }]);
    if (eIns) return { ok: false, yaExistia: false, error: eIns.message };
    return { ok: true, yaExistia: false };
  } catch (e) {
    return { ok: false, yaExistia: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const nombrarRpc = "club_listar_tablas_fijas_publicadas";

/** Normaliza el nombre de hipódromo para comparaciones (mayus, sin espacios). */
function hipoKey(h: unknown): string {
  return String(h ?? "").toUpperCase().replace(/\s+/g, "");
}

/**
 * Carreras registradas para [fecha + hipódromo] en la BD.
 * Cruza tres fuentes: el Programa del Día (programa_dia), las Tablas Fijas
 * publicadas (tablas_fijas) y las carreras manuales/resultados
 * (resultados_carreras). Devuelve números únicos ordenados — alimenta el
 * semáforo dinámico de la Taquilla contextualizada por fecha.
 */
export async function listarCarrerasPorDia(fecha: string, hipodromo: string): Promise<number[]> {
  const set = new Set<number>();
  const clave = hipoKey(hipodromo);

  const fuentePrograma = async () => {
    if (!fecha) return;
    const r = await leerProgramaPorFecha(fecha);
    for (const c of r.data?.carreras ?? []) {
      if (!c.carrera) continue;
      if (clave && hipoKey(c.hipodromo) !== clave) continue;
      set.add(Number(c.carrera));
    }
  };

  const fuenteTablas = async () => {
    if (!supabase || !fecha) return;
    try {
      // Query ESTRICTO por la fecha del evento (ISO YYYY-MM-DD): las tablas
      // publicadas desde el Ensamblaje siempre llevan `fecha` explícita.
      const { data, error } = await supabase
        .from("tablas_fijas")
        .select("carrera, hipodromo, fecha, fecha_creacion")
        .ilike("hipodromo", `%${hipodromo}%`)
        .eq("fecha", fecha);
      if (error) return;
      for (const r of (data ?? []) as Array<{ carrera?: unknown; hipodromo?: unknown }>) {
        const n = Number(r.carrera);
        if (Number.isFinite(n) && n > 0) set.add(n);
      }
      // Fallback LEGACY: registros antiguos que solo tienen fecha_creacion
      // (migrados) y ninguna `fecha` — se cruzan por el prefijo del día.
      if (data && data.length > 0) return;
      const { data: leg } = await supabase
        .from("tablas_fijas")
        .select("carrera")
        .ilike("hipodromo", `%${hipodromo}%`)
        .or(`fecha_creacion.like.${fecha}%`);
      for (const r of (leg ?? []) as Array<{ carrera?: unknown }>) {
        const n = Number(r.carrera);
        if (Number.isFinite(n) && n > 0) set.add(n);
      }
    } catch {
      /* RLS o esquema distinto → se ignora */
    }
  };

  // Fuente manual: carreras registradas sin Gaceta en resultados_carreras
  // (upsert de registrarCarreraProgramada) para la misma fecha + hipódromo.
  const fuenteManual = async () => {
    if (!supabase || !fecha) return;
    try {
      const { data, error } = await supabase
        .from("resultados_carreras")
        .select("carrera, hipodromo, fecha")
        .eq("fecha", fecha)
        .ilike("hipodromo", `%${hipodromo}%`);
      if (error) return;
      for (const r of (data ?? []) as Array<{ carrera?: unknown }>) {
        const n = Number(r.carrera);
        if (Number.isFinite(n) && n > 0) set.add(n);
      }
    } catch {
      /* sin tabla → se ignora */
    }
  };

  try {
    await Promise.all([fuentePrograma(), fuenteTablas(), fuenteManual()]);
  } catch {
    /* insignificante */
  }

  return [...set].sort((a, b) => a - b);
}

/** Lee las Tablas Fijas publicadas (Abierta) desde la RPC del legacy. */
export async function listarTablasPublicadas(): Promise<TablaFijaRow[]> {
  if (supabase) {
    try {
      const { data, error } = await supabase.rpc(nombrarRpc);
      if (error) throw error;
      if (Array.isArray(data)) return normalizarFilas(data);
    } catch (e) {
      console.warn("RPC tablas publicadas no disponible:", e);
    }
  }
  return [];
}

/** Normaliza filas crudas (número/string) al contrato de la SPA. */
export function normalizarFilas(data: unknown[]): TablaFijaRow[] {
  return data.map((r) => {
    const raw = r as Record<string, unknown>;
    const caballos = Array.isArray(raw.caballos)
      ? raw.caballos.map((c) => {
          const cc = c as Record<string, unknown>;
          return {
            numero: String(cc.numero ?? ""),
            nombre: String(cc.nombre ?? ""),
            nacionalidad: cc.nacionalidad ? String(cc.nacionalidad) : null,
            valor_ejemplar: cc.valor_ejemplar != null ? parseNum(cc.valor_ejemplar) : null,
            retirado: Boolean(cc.retirado),
          };
        })
      : null;
    const grupos = Array.isArray(raw.tabla_grupos)
      ? raw.tabla_grupos.map((g) => g as Record<string, unknown>)
      : null;
    return {
      id: String(raw.id ?? ""),
      hipodromo: raw.hipodromo ? String(raw.hipodromo) : null,
      hipodromo_id: raw.hipodromo_id != null ? (raw.hipodromo_id as string | number) : null,
      carrera: parseNum(raw.carrera) || null,
      fecha: raw.fecha ? String(raw.fecha) : null,
      fecha_creacion: raw.fecha_creacion ? String(raw.fecha_creacion) : null,
      estado: raw.estado ? String(raw.estado) : null,
      premio_original: raw.premio_original != null ? parseNum(raw.premio_original) : null,
      premio_recalculado: raw.premio_recalculado != null ? parseNum(raw.premio_recalculado) : null,
      suma_base_tabla: raw.suma_base_tabla != null ? parseNum(raw.suma_base_tabla) : null,
      monto_tabla: raw.monto_tabla != null ? parseNum(raw.monto_tabla) : null,
      limite_ventas: raw.limite_ventas != null ? parseNum(raw.limite_ventas) : null,
      cantidad_vendida: raw.cantidad_vendida != null ? parseNum(raw.cantidad_vendida) : null,
      moneda: raw.moneda ? String(raw.moneda) : null,
      distancia_carrera: raw.distancia_carrera ? String(raw.distancia_carrera) : null,
      superficie: raw.superficie ? String(raw.superficie) : null,
      retirados_oficiales: raw.retirados_oficiales ? String(raw.retirados_oficiales) : null,
      caballos,
      tabla_grupos: grupos as TablaFijaRow["tabla_grupos"],
    };
  });
}

/** Detecta "column X does not exist" para retirar columnas del esquema real. */
function columnaInexistente(msj: string): string | null {
  const m = /column "([^"]+)" does not exist/.exec(msj);
  return m ? m[1] : null;
}

/**
 * Payload SQL seguro para tablas_fijas (mismas columnas que js/tablas.js).
 * NO incluye hipodromo_id/premio: el esquema productivo real no las tiene y
 * el upsert por (hipódromo+carrera) se resuelve vía idExistente (id de la BD).
 */
function payloadDeTabla(t: TablaFijaRow): Record<string, unknown> {
  return {
    hipodromo: t.hipodromo,
    carrera: t.carrera,
    fecha: t.fecha,
    fecha_creacion: t.fecha_creacion ?? new Date().toISOString(),
    estado: "Abierta",
    premio_original: t.premio_original,
    premio_recalculado: t.premio_recalculado,
    suma_base_tabla: t.suma_base_tabla,
    limite_ventas: t.limite_ventas ?? 300,
    cantidad_vendida: t.cantidad_vendida ?? 0,
    moneda: t.moneda ?? "USD",
    distancia_carrera: t.distancia_carrera,
    superficie: t.superficie,
    retirados_oficiales: t.retirados_oficiales || "NO HUBO RETIROS",
    comision_grupo: t.comision_grupo ?? 0,
    grupo_venta: t.grupo_venta ?? "GRUPOS",
    monto_tabla: t.monto_tabla ?? 100,
    tasa_cambio: t.tasa_cambio ?? null,
    caballos: t.caballos ?? [],
  };
}

/** Busca la fila existente por (hipodromo, carrera) para actualizar en vez de duplicar. */
const ORDENES_ID = ["fecha_creacion", "created_at", "id"] as const;

async function idExistente(hipodromo?: string | null, carrera?: number | null): Promise<number | string | null> {
  if (!supabase || !hipodromo || !carrera) return null;
  for (const col of ORDENES_ID) {
    try {
      const { data, error } = await supabase
        .from("tablas_fijas")
        .select("id")
        .ilike("hipodromo", hipodromo)
        .eq("carrera", carrera)
        .order(col, { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) continue;
      return data ? (data as { id: number | string }).id : null;
    } catch {
      continue;
    }
  }
  return null;
}

/** INSERT/UPDATE tolerantes: retiran columnas inexistentes del esquema real y reintentan. */
async function persistirFila(
  payload: Record<string, unknown>,
  modo: "insert" | "update",
  id?: number | string
): Promise<{ id?: number | string; error?: string }> {
  if (!supabase) return { error: "Sin conexión a Supabase" };
  let actual = { ...payload };
  for (let i = 0; i < 6; i++) {
    const op =
      modo === "insert"
        ? await supabase.from("tablas_fijas").insert(actual).select("id").maybeSingle()
        : await supabase.from("tablas_fijas").update(actual).eq("id", id);
    if (!op.error) {
      const raw = op.data as { id?: number | string } | null;
      return { id: modo === "insert" ? raw?.id : id };
    }
    const col = columnaInexistente(op.error.message || "");
    if (!col || !(col in actual)) return { error: op.error.message };
    delete actual[col];
  }
  return { error: "Columnas del esquema sin resolver en tablas_fijas" };
}

/**
 * Elimina SOLO la oferta de venta (registro de la tabla fija) de `tablas_fijas`.
 * NO toca `carreras` ni `ejemplares` del Padrón: la carrera sigue disponible
 * para que la Taquilla opere (resultados, pizarras, cobros y pagos).
 * RLS está desactivado sobre tablas_fijas → DELETE directo válido.
 */
export async function eliminarTablaFija(
  id: string | number | null | undefined
): Promise<{ ok: boolean; error?: string }> {
  if (id == null) return { ok: false, error: "Falta el id de la tabla." };
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    const { error } = await supabase.from("tablas_fijas").delete().eq("id", id);
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Publica una tabla en Supabase (upsert por hipódromo+carrera). RLS off → anon OK. */
export async function publicarTabla(t: TablaFijaRow): Promise<{ ok: boolean; id?: string | number; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    const existente = await idExistente(t.hipodromo, t.carrera);
    const r = existente != null
      ? await persistirFila(payloadDeTabla(t), "update", existente)
      : await persistirFila(payloadDeTabla(t), "insert");
    if (r.error) return { ok: false, error: r.error };
    return { ok: true, id: r.id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export type ErrorPublicacionLote = { hipodromo: string; carrera: number | null; error: string };

/**
 * Publicación en LOTE ("Publicar todas"): resuelve los ids existentes (upsert
 * por hipódromo+carrera) y hace INSERT batch ([...payloads]) en una sola
 * llamada para las nuevas. Nunca es silenciosa: devuelve okCount + errores
 * legibles por tabla para los toasts del módulo.
 */
export async function publicarTablasLote(
  tablas: TablaFijaRow[]
): Promise<{ ok: boolean; okCount: number; errores: ErrorPublicacionLote[] }> {
  if (!supabase) return { ok: false, okCount: 0, errores: tablas.map((t) => ({ hipodromo: t.hipodromo ?? "", carrera: t.carrera ?? null, error: "Sin conexión a Supabase" })) };
  const errores: ErrorPublicacionLote[] = [];
  let okCount = 0;

  for (const t of tablas) {
    try {
      const existente = await idExistente(t.hipodromo, t.carrera);
      const r = existente != null
        ? await persistirFila(payloadDeTabla(t), "update", existente)
        : await persistirFila(payloadDeTabla(t), "insert");
      if (r.error) throw new Error(r.error);
      okCount++;
    } catch (e) {
      errores.push({ hipodromo: t.hipodromo ?? "", carrera: t.carrera ?? null, error: (e as Error).message });
    }
  }

  return { ok: errores.length === 0, okCount, errores };
}

const COLUMNAS_EDITABLES = [
  "premio_original",
  "premio_recalculado",
  "suma_base_tabla",
  "limite_ventas",
  "cantidad_vendida",
  "distancia_carrera",
  "superficie",
  "retirados_oficiales",
] as const;

/** Actualiza solo columnas seguras de una tabla por su id real. */
export async function actualizarTabla(
  id: string | number,
  patch: Record<string, unknown>
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  const limpio: Record<string, unknown> = {};
  for (const key of COLUMNAS_EDITABLES) {
    if (key in patch) limpio[key] = patch[key];
  }
  if (!Object.keys(limpio).length) return { ok: true };
  try {
    const { error } = await supabase.from("tablas_fijas").update(limpio).eq("id", id);
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Incrementa las ventas de una tabla (+ monto) para el contador del Monitor. */
export async function registrarVenta(
  id: string | number,
  monto: number
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    const { data } = await supabase
      .from("tablas_fijas")
      .select("cantidad_vendida")
      .eq("id", id)
      .maybeSingle();
    const actual = data && data.cantidad_vendida != null ? Number(data.cantidad_vendida) : 0;
    const { error } = await supabase
      .from("tablas_fijas")
      .update({ cantidad_vendida: actual + monto })
      .eq("id", id);
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Retira (o rehabilita) un ejemplar de la tabla publicada y recalcula el premio
 * con baja proporcional (misma fórmula del legacy js/tablas.js retirarEjemplar):
 *   nuevoPremio = premio_original * (1 − sumaRetirados / suma_base_tabla)
 * También reembolsa (best-effort) los tickets pendientes de ese ejemplar y
 * actualiza retirados_oficiales. El cambio se propaga con realtime → refresh.
 */
export async function retirarEjemplarTabla(
  tabla: TablaFijaRow,
  idx: number,
  retirado: boolean
): Promise<{ ok: boolean; error?: string; premio?: number; reembolsos?: number }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  const caballos = Array.isArray(tabla.caballos) ? [...tabla.caballos] : [];
  if (idx < 0 || idx >= caballos.length) return { ok: false, error: "Ejemplar no encontrado." };
  const ejemplar = caballos[idx];
  const caballosNuevos = caballos.map((x, i) =>
    i === idx ? { ...x, retirado, ganador: retirado ? false : x.ganador } : x
  );
  const base = parseNum(tabla.suma_base_tabla);
  const sumaRetirados = caballosNuevos
    .filter((c) => c.retirado)
    .reduce((a, c) => a + (parseNum(c.valor_ejemplar) || 0), 0);
  let nuevoPremio = parseNum(tabla.premio_original ?? tabla.premio_recalculado);
  if (base > 0) nuevoPremio = Math.max(0, nuevoPremio * (1 - sumaRetirados / base));
  const nums =
    caballosNuevos.filter((c) => c.retirado).map((c) => c.numero).join(",") || "NO HUBO RETIROS";

  try {
    const { error } = await supabase
      .from("tablas_fijas")
      .update({
        caballos: caballosNuevos,
        retirados_oficiales: nums,
        premio_recalculado: nuevoPremio,
      })
      .eq("id", tabla.id);
    if (error) throw error;
    const reembolsos = retirado ? await reembolsarTicketsRetirado(tabla, ejemplar) : 0;
    return { ok: true, premio: nuevoPremio, reembolsos };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Reembolsa (best-effort) el saldo de tickets Pendientes de un ejemplar retirado. */
async function reembolsarTicketsRetirado(
  tabla: TablaFijaRow,
  ejemplar: { numero: number | string }
): Promise<number> {
  if (!supabase) return 0;
  try {
    const { data: tickets } = await supabase
      .from("tickets_apuestas")
      .select("id, cliente_juega_id, monto_jugado")
      .eq("hipodromo", tabla.hipodromo)
      .eq("carrera", tabla.carrera)
      .eq("ejemplar_numero", parseInt(String(ejemplar.numero), 10) || 0)
      .eq("estado", "Pendiente");
    if (!tickets || tickets.length === 0) return 0;
    let reembolsados = 0;
    for (const tk of tickets as Array<{ id: string; cliente_juega_id: string | null; monto_jugado: unknown }>) {
      const monto = parseNum(tk.monto_jugado);
      await supabase
        .from("tickets_apuestas")
        .update({
          estado: "Retirado",
          premio_pagar: 0,
          accion_aplicada: "REEMBOLSO",
          monto_resuelto: monto,
        })
        .eq("id", tk.id);
      if (monto > 0 && tk.cliente_juega_id) {
        const { data: cl } = await supabase
          .from("clientes")
          .select("saldo_actual")
          .eq("id", tk.cliente_juega_id)
          .maybeSingle();
        if (cl) {
          await supabase
            .from("clientes")
            .update({ saldo_actual: (parseNum(cl.saldo_actual) || 0) + monto })
            .eq("id", tk.cliente_juega_id);
        }
      }
      reembolsados += 1;
    }
    return reembolsados;
  } catch {
    return 0;
  }
}

/** Guarda la pizarra de resultados (RPC opcional del paquete SQL, si existe). */
export async function guardarPizarraCarrera(opts: {
  hipodromo?: string | null;
  carrera?: number | null;
  pizarra: Record<string, unknown>;
}): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { error } = await supabase.rpc("club_guardar_pizarra_carrera", {
      p_hipodromo: opts.hipodromo,
      p_carrera: opts.carrera,
      p_pizarra: opts.pizarra,
    });
    return !error;
  } catch {
    return false;
  }
}