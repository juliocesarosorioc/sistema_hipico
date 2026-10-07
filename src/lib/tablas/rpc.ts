import { supabase } from "@/lib/supabase";
import { exigirCapacidad } from "@/lib/seguridad/vigente";
import type { TablaFijaRow } from "@/lib/tablas-fijas";
import { parseNum } from "@/lib/tablas/tipos";
import { alternarRetiroCarrera } from "@/lib/carreras/retiros";
import { sincronizarCentralDesdeTabla } from "@/lib/carreras-dia";
import { normalizarFilas } from "@/lib/tablas/normalizar";

// Se reexporta para no romper a quien ya importaba la normalizacion desde aca.
export { normalizarFilas };

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

import { normalizarEstado } from "@/lib/hipodromos/tipos";

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

/**
 * Lista de hipódromos que el legacy daba por operativos.
 *
 * @deprecated NO la usa la app. Antes `listarHipodromos` filtraba por esta lista
 * y por eso cualquier hipódromo registrado fuera de VE+USA era INVISIBLE aunque
 * estuviera en la base. Hoy manda el `estado` de la fila (editable desde el CRUD
 * de Hipódromos) y la baja lógica `eliminado_en`. Se conserva el export por
 * compatibilidad con los scripts legacy.
 */
export const HIPODROMOS_MOSTRAR = [...HIPODROMOS_VE, ...HIPODROMOS_USA];

export type OpcionHipodromo = { value: string; label: string };

/**
 * Catálogo para los selectores de la plataforma.
 *
 * SIN WHITELIST: antes se filtraba por `HIPODROMOS_MOSTRAR` (VE + USA), así que
 * cualquier hipódromo registrado fuera de esa lista era invisible aunque
 * estuviera en la base. Ahora sale todo lo registrado y lo que se decide es el
 * ESTADO de la fila, que es un dato del negocio editable desde el CRUD:
 *
 *   - archivado (`eliminado_en`) → nunca se ofrece. Su historial queda.
 *   - 'Inactivo' / 'Suspendido' → tampoco se ofrece (eso es lo que significa),
 *     pero sigue en el catálogo del CRUD y se reactiva desde ahí.
 *   - 'Activo' → se ofrece.
 *
 * `incluirTodos: true` trae también los suspendidos/inactivos (lo necesita
 * Dupletas, que arma la matriz de todas las sedes conocidas).
 */
export async function listarHipodromos(opciones?: { incluirTodos?: boolean }): Promise<OpcionHipodromo[]> {
  const todos = Boolean(opciones?.incluirTodos);
  const mapear = (rows: unknown[]): OpcionHipodromo[] =>
    rows
      .map((r) => {
        const h = r as { nombre?: unknown; estado?: unknown; eliminado_en?: unknown };
        // Archivado: fuera de todo selector. Sin la columna (SQL sin aplicar)
        // `undefined` no es un valor de fecha, así que la fila pasa.
        if (String(h.eliminado_en ?? "").trim()) return null;
        if (!todos && normalizarEstado(h.estado) !== "Activo") return null;
        return { value: String(h.nombre ?? "").toUpperCase(), label: String(h.nombre ?? "") };
      })
      .filter((h): h is OpcionHipodromo => Boolean(h) && h!.label.trim().length > 0)
      .sort((a, b) => a.label.localeCompare(b.label));

  const sdb = supabase;
  if (!sdb) return mapear(FALLBACK_HIPODROMOS);

  const orquestar = async () => {
    // Intento 1 — SELECT plano con estado (mismo origen que js/hipodromos.js).
    const r1 = await sdb.from("hipodromos").select("id, nombre, estado, eliminado_en").order("nombre", { ascending: true });
    if (!r1.error) return r1.data as unknown[];
    // Intento 2 — el SQL de hipódromos todavía sin aplicar (sin la columna).
    const r2 = await sdb.from("hipodromos").select("id, nombre, estado").order("nombre", { ascending: true });
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
 * Lee SOLO la MATRIZ MAESTRA `carreras` (sql/carreras.sql): la carrera existe
 * desde que se guarda el programa, sin depender de Publicar ni de correr
 * resultados. Devuelve números únicos ordenados — alimenta el semáforo dinámico
 * de la Taquilla contextualizada por fecha.
 */
export async function listarCarrerasPorDia(fecha: string, hipodromo: string): Promise<number[]> {
  if (!fecha) return [];
  const clave = hipoKey(hipodromo);
  const { leerCarrerasMaestro } = await import("@/lib/carreras/maestro");
  const m = await leerCarrerasMaestro(fecha, "");
  if (!m.ok) return [];
  const set = new Set<number>();
  for (const fila of m.filas) {
    const n = Number(fila.carrera);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (clave && hipoKey(fila.hipodromo) !== clave) continue;
    set.add(n);
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

/** Saca el nombre de la columna que la BD reports como inexistente. */
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
    exigirCapacidad("tablas:btn_eliminar");
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
    exigirCapacidad("tablas:fn_publicar");
    const existente = await idExistente(t.hipodromo, t.carrera, t.fecha ?? t.fecha_creacion);
    const r = existente != null
      ? await persistirFila(payloadDeTabla(t), "update", existente)
      : await persistirFila(payloadDeTabla(t), "insert");
    if (r.error) return { ok: false, error: r.error };
    // La tabla ya está publicada (eso no falla), pero sin esto la carrera no
    // existe en el central y Marcas/Gestión/Dupletas no la ven. Se avisa, pero
    // no se tira la publicación abajo.
    const sync = await sincronizarCentralDesdeTabla(t).catch((e) => ({ ok: false, error: String(e) }));
    return { ok: true, id: r.id, error: sync.ok ? undefined : `publicada, pero no se registró en el central: ${sync.error}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export type ErrorPublicacionLote = {
  hipodromo: string;
  carrera: number | null;
  error: string;
  /**
   * `true` cuando la tabla SÍ se publicó pero el central no se pudo sincronizar.
   * Sin esto, el llamador no puede distinguir "no se publicó" (se reintenta, la
   * tarjeta queda en el Ensamblaje) de "se publicó y no se ve en Marcas" (ya está
   * vendiéndose; solo hay que avisar). Confundirlos deja carreras vendidas pero
   * invisibles, que es justo el incidente del 04-10-2026.
   */
  publicada?: boolean;
};

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
      exigirCapacidad("tablas:fn_publicar");
      const existente = await idExistente(t.hipodromo, t.carrera, t.fecha ?? t.fecha_creacion);
      const r = existente != null
        ? await persistirFila(payloadDeTabla(t), "update", existente)
        : await persistirFila(payloadDeTabla(t), "insert");
      if (r.error) throw new Error(r.error);
      okCount++;
      // Igual que en `publicarTabla`: la publicación no queda incompleta por
      // fallar el central, pero se avisa para que el operador sepa que esa
      // carrera aún no es visible en Marcas/Gestión/Dupletas.
      const sync = await sincronizarCentralDesdeTabla(t).catch((e) => ({ ok: false, error: String(e) }));
      if (!sync.ok) {
        // `publicada: true` porque la tabla ya quedó publicada; esto es un AVISO
        // (no se ve en Marcas/Gestión/Dupletas), no un fallo de publicación.
        errores.push({ hipodromo: t.hipodromo ?? "", carrera: t.carrera ?? null, error: `publicada, pero sin central: ${sync.error}`, publicada: true });
      }
    } catch (e) {
      errores.push({ hipodromo: t.hipodromo ?? "", carrera: t.carrera ?? null, error: (e as Error).message });
    }
  }

  // `ok` refleja la PUBLICACIÓN, no la sincronización: una tabla publicada con
  // el central caído sigue siendo `ok`. Los avisos de central van en `errores`
  // con `publicada: true` para que el llamador no los trate como fallos.
  return { ok: errores.every((e) => e.publicada === true), okCount, errores };
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
  try {
    exigirCapacidad("tablas:btn_editar");
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
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
    try {
      exigirCapacidad("tablas:btn_liquidar");
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
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
  try {
    exigirCapacidad("gestion_jugadas:btn_retirar_ejemplar");
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
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
