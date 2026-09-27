import { supabase } from "@/lib/supabase";
import type { TablaFijaRow } from "@/lib/tablas-fijas";
import { parseNum } from "@/lib/tablas/tipos";
import { leerProgramaPorFecha } from "@/lib/gaceta/programa";
import { alternarRetiroCarrera } from "@/lib/carreras/retiros";

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

/** Hipódromos venezolanos que se muestran operativos. */
export const HIPODROMOS_VE = ["SANTA RITA", "VALENCIA", "RANCHO ALEGRE", "LA RINCONADA"];

/** Hipódromos de Estados Unidos que se muestran operativos. */
export const HIPODROMOS_USA = [
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

/** Únicos hipódromos que se muestran operativos (decisión del negocio). */
export const HIPODROMOS_MOSTRAR = [...HIPODROMOS_VE, ...HIPODROMOS_USA];

export type OpcionHipodromo = { value: string; label: string };

/**
 * Lista de hipódromos operativos (misma fuente que el legacy: `hipodromos`
 * con SELECT plano ordenado — sin filtros de columna inventados).
 * La data sale SIEMPRE de la tabla real cuando hay conexión; el respaldo
 * local solo aparece si la tabla/RLS impide la lectura.
 *
 * `incluirTodos: true` omite la whitelist VE+USA y devuelve TODOS los
 * hipódromos registrados (lo necesita Dupletas); por defecto se mantiene la
 * whitelist para no alterar el resto de módulos.
 */
export async function listarHipodromos(opciones?: { incluirTodos?: boolean }): Promise<OpcionHipodromo[]> {
  const todos = Boolean(opciones?.incluirTodos);
  const mapear = (rows: unknown[]): OpcionHipodromo[] =>
    rows
      .map((r) => {
        const h = r as { nombre?: unknown };
        return { value: String(h.nombre ?? "").toUpperCase(), label: String(h.nombre ?? "") };
      })
      .filter((h) => h.label.trim().length)
      .filter((h) => todos || HIPODROMOS_MOSTRAR.includes(h.value))
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

/**
 * Orden de presentación: primero por hipódromo (A-Z) y dentro de cada uno por
 * número de carrera ASCENDENTE. Sin esto el orden es el que devuelva la
 * consulta (arbitrario) y las carreras se ven desordenadas: 3, 11, 2, 1.
 * Se compara numéricamente, no como texto, para que C2 vaya antes que C10.
 */
function compararParaMostrar(a: TablaFijaRow, b: TablaFijaRow): number {
  const hipo = (a.hipodromo ?? "").localeCompare(b.hipodromo ?? "", "es");
  if (hipo !== 0) return hipo;
  const ca = Number(a.carrera);
  const cb = Number(b.carrera);
  // Las carreras sin número válido se van al final, no al principio.
  const va = Number.isFinite(ca) && ca > 0 ? ca : Number.POSITIVE_INFINITY;
  const vb = Number.isFinite(cb) && cb > 0 ? cb : Number.POSITIVE_INFINITY;
  if (va !== vb) return va - vb;
  return (a.fecha ?? "").localeCompare(b.fecha ?? "");
}

/** Normaliza filas crudas (número/string) al contrato de la SPA. */
export function normalizarFilas(data: unknown[]): TablaFijaRow[] {
  return data
    .map((r) => {
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
  })
    .sort(compararParaMostrar);
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

/**
 * Busca la fila existente para actualizar en vez de duplicar.
 *
 * La clave real de una tabla es (fecha, hipodromo, carrera). Buscar solo por
 * hipodromo+carrera hacia que la C4 de hoy pisara la C4 de ayer del mismo
 * hipodromo: se perdia la tabla del dia anterior y sus ventas quedaban
 * apuntando a una tabla cambiada. Por eso la fecha va incluida.
 */
const ORDENES_ID = ["fecha_creacion", "id"] as const;

async function idExistente(
  hipodromo?: string | null,
  carrera?: number | null,
  fecha?: string | null
): Promise<number | string | null> {
  if (!supabase || !hipodromo || !carrera) return null;
  // Sin fecha no se puede desambiguar: la misma carrera se disputa en dias
  // distintos, asi que en ese caso no se reusa ninguna fila.
  if (!fecha) return null;
  const dia = fecha.slice(0, 10);
  for (const col of ORDENES_ID) {
    try {
      const { data, error } = await supabase
        .from("tablas_fijas")
        .select("id")
        .ilike("hipodromo", hipodromo)
        .eq("carrera", carrera)
        .eq("fecha", dia)
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
    const existente = await idExistente(t.hipodromo, t.carrera, t.fecha ?? t.fecha_creacion);
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
    const existente = await idExistente(t.hipodromo, t.carrera, t.fecha ?? t.fecha_creacion);
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
  "hipodromo",
  "carrera",
  "fecha",
  "premio_original",
  "premio_recalculado",
  "suma_base_tabla",
  "limite_ventas",
  "cantidad_vendida",
  "distancia_carrera",
  "superficie",
  "retirados_oficiales",
  "moneda",
  "grupo_venta",
  "monto_tabla",
  "comision_grupo",
  "caballos",
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

const MENSAJE_SIN_RPC =
  "Falta instalar sql/tablas_venta.sql en Supabase. La venta de tabla fija exige la RPC transaccional (ticket + saldo + contador); no se hacen escrituras parciales.";

/** Detecta si la RPC no existe (lo normal si el SQL aun no se aplico). */
function esRpcAusente(error: { message: string } | null): boolean {
  if (!error) return false;
  const m = error.message.toLowerCase();
  return m.includes("does not exist") || m.includes("no existe") || m.includes("not found") || m.includes("404");
}

export type VentaTablaFijaResultado = {
  ok: boolean;
  error?: string;
  /** Tickets creados: uno por ejemplar vendido. */
  tickets?: number;
  cantidad?: number;
  saldoNuevo?: number;
  premioPorTabla?: number;
  comisionGrupoPorcentaje?: number;
  moneda?: string;
};

/**
 * Venta de tabla fija por RPC (sql/tablas_venta.sql).
 *
 * Hace las tres cosas que no pueden quedar a medias: crea un ticket por cada
 * ejemplar (con `premio_por_tabla` y `pts_ejemplar` congelados), debita el
 * saldo del cliente y suma al contador de tablas vendidas.
 *
 * El congelado es lo que hace segura la edicion de tablas: si manana se corrige
 * la tabla o entra un retiro, lo ya vendido sigue liquidando contra los valores
 * con los que se compro.
 *
 * COMISION: la tabla fija no le cobra nada al jugador, asi que el debito es
 * `p_monto` exacto. Lo que se congela en el ticket es la tasa del GRUPO, que
 * el liquidador aplicara despues sobre el monto decidido.
 */
export async function venderTablaFija(params: {
  tablaId: string | number;
  clienteId: string;
  grupoId: string;
  monto: number;
  cantidad?: number;
  /** null/vacio = TABLA COMPLETA (un ticket por cada ejemplar). */
  ejemplarNumero?: string | null;
  comisionPorcentaje?: number | null;
  tasa?: number | null;
  usuario?: string | null;
}): Promise<VentaTablaFijaResultado> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  const { data, error } = await supabase.rpc("club_vender_tabla_fija", {
    p_tabla_id: params.tablaId,
    p_cliente_id: params.clienteId,
    p_grupo_id: params.grupoId,
    p_monto: params.monto,
    p_cantidad: params.cantidad ?? 1,
    p_ejemplar_numero: params.ejemplarNumero ?? null,
    p_comision_porcentaje: params.comisionPorcentaje ?? null,
    p_tasa: params.tasa ?? null,
    p_usuario: params.usuario ?? null,
  });
  if (error) {
    return { ok: false, error: esRpcAusente(error) ? MENSAJE_SIN_RPC : error.message };
  }
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    tickets: Number(d.tickets ?? 0),
    cantidad: Number(d.cantidad ?? 0),
    saldoNuevo: d.saldo_nuevo != null ? Number(d.saldo_nuevo) : undefined,
    premioPorTabla: d.premio_por_tabla != null ? Number(d.premio_por_tabla) : undefined,
    comisionGrupoPorcentaje: d.comision_grupo_porcentaje != null ? Number(d.comision_grupo_porcentaje) : undefined,
    moneda: d.moneda != null ? String(d.moneda) : undefined,
  };
}

/**
 * Cierra la tabla y resuelve sus tickets (sql/tablas_venta.sql).
 *
 * El pago sale del `premio_por_tabla` y `pts_ejemplar` CONGELADOS en el ticket,
 * no de los valores actuales de la tabla: por eso editar la tabla o un retiro
 * posterior no alteran lo ya vendido.
 *
 * Comisión (regla de js/saldos.js:144-165): sobre la ganancia y solo si gana.
 * El jugador recibe el premio entero; lo que se lleva el grupo sale de la
 * ganancia, nunca de su pago. Pierde → comisión 0.
 *
 * Sin ganadores no liquida: con dead heat la tabla queda pendiente a decisión
 * manual, en vez de pagar a un ganador arbitrario.
 */
export async function liquidarTablaFija(params: {
  tablaId: string | number;
  /** Ejemplares ganadores separados por coma: '1,3,4'. */
  ganadores: string;
  usuario?: string | null;
}): Promise<{ ok: boolean; error?: string; ticketsResueltos?: number; pagos?: number }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  const { data, error } = await supabase.rpc("club_liquidar_tabla_fija", {
    p_tabla_id: params.tablaId,
    p_ganadores: params.ganadores,
    p_usuario: params.usuario ?? null,
  });
  if (error) {
    return { ok: false, error: esRpcAusente(error) ? MENSAJE_SIN_RPC : error.message };
  }
  const d = (data ?? {}) as Record<string, unknown>;
  if (d.ok === false) return { ok: false, error: String(d.error ?? "No se pudo liquidar.") };
  return {
    ok: true,
    ticketsResueltos: Number(d.tickets_resueltos ?? 0),
    pagos: Number(d.pagos ?? 0),
  };
}

// NOTA: el contador de tablas vendidas ya no se toca desde aqui. Antes esta
// funcion hacia un leer-modificar-escribir que sumando el MONTO en vez de la
// CANTIDAD de tablas, y dos cajas vendiendo a la vez se pisaban. Ahora lo
// hace club_vender_tabla_fija, que ademas toma un lock for update sobre la
// tabla. No reponer un update suelto del contador: rompe las dos cosas.

/**
 * Retira (o rehabilita) un ejemplar. Delega al servicio CENTRAL de retiros
 * (@/lib/carreras/retiros): la lista se guarda en la carrera (resultados_carreras)
 * y se propaga a TODAS las tablas fijas de esa misma carrera, recalculando el
 * premio con baja proporcional (fórmula del legacy js/tablas.js):
 *   nuevoPremio = premio_original * (1 − sumaRetirados / suma_base_tabla)
 * Reembolsa (best-effort) los tickets pendientes del ejemplar. El cambio se
 * propaga con realtime → refresh.
 */
export async function retirarEjemplarTabla(
  tabla: TablaFijaRow,
  idx: number,
  retirado: boolean
): Promise<{ ok: boolean; error?: string; premio?: number; reembolsos?: number }> {
  const caballos = Array.isArray(tabla.caballos) ? tabla.caballos : [];
  if (idx < 0 || idx >= caballos.length) return { ok: false, error: "Ejemplar no encontrado." };
  const ejemplar = caballos[idx];
  const fecha = String(tabla.fecha || tabla.fecha_creacion || "").slice(0, 10);
  if (!fecha) return { ok: false, error: "La tabla no tiene fecha de evento: no se puede centralizar el retiro." };
  const r = await alternarRetiroCarrera({
    fecha,
    hipodromo: String(tabla.hipodromo ?? ""),
    carrera: tabla.carrera ?? 0,
    numero: ejemplar.numero,
    retirado,
  });
  if (!r.ok) return { ok: false, error: r.error ?? "No se pudo registrar el retiro." };
  const premio = r.premios.find((p) => p.tabla === String(tabla.id))?.premio;
  return { ok: true, premio, reembolsos: r.reembolsos };
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