import { supabase } from "@/lib/supabase";
import type { TablaFijaRow } from "@/lib/tablas-fijas";
import { parseNum } from "@/lib/tablas/tipos";

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

/** Lista de hipódromos operativos (Solo Activos — Supabase si responde, si no, fallback local). */
export async function listarHipodromos(): Promise<OpcionHipodromo[]> {
  try {
    if (supabase) {
      const { data } = await supabase
        .from("hipodromos")
        .select("id, nombre")
        .eq("estado", "Activo")
        .order("nombre");
      if (data && data.length) {
        return data
          .map((h) => ({ value: String(h.nombre).toUpperCase(), label: String(h.nombre) }))
          .sort((a, b) => a.label.localeCompare(b.label));
      }
    }
  } catch {
    /* sin conexión → fallback local */
  }
  return FALLBACK_HIPODROMOS.map((n) => ({ value: n, label: n }));
}

const nombrarRpc = "club_listar_tablas_fijas_publicadas";

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
      estado: raw.estado ? String(raw.estado) : null,
      premio_original: raw.premio_original != null ? parseNum(raw.premio_original) : null,
      premio_recalculado: raw.premio_recalculado != null ? parseNum(raw.premio_recalculado) : null,
      suma_base_tabla: raw.suma_base_tabla != null ? parseNum(raw.suma_base_tabla) : null,
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

/** Payload SQL seguro para tablas_fijas (mismas columnas que js/tablas.js). */
function payloadDeTabla(t: TablaFijaRow): Record<string, unknown> {
  return {
    hipodromo: t.hipodromo,
    hipodromo_id: t.hipodromo_id ?? null,
    carrera: t.carrera,
    fecha: t.fecha,
    estado: "Abierta",
    premio: t.premio_original,
    premio_original: t.premio_original,
    premio_recalculado: t.premio_recalculado,
    suma_base_tabla: t.suma_base_tabla,
    limite_ventas: t.limite_ventas ?? 0,
    cantidad_vendida: t.cantidad_vendida ?? 0,
    moneda: t.moneda ?? "USD",
    distancia_carrera: t.distancia_carrera,
    superficie: t.superficie,
    retirados_oficiales: t.retirados_oficiales || "NO HUBO RETIROS",
    comision_grupo: t.comision_grupo ?? 0,
    grupo_venta: t.grupo_venta ?? null,
    tasa_cambio: t.tasa_cambio ?? null,
    caballos: t.caballos ?? [],
  };
}

/** Busca la fila existente por (hipodromo, carrera) para actualizar en vez de duplicar. */
async function idExistente(hipodromo?: string | null, carrera?: number | null): Promise<number | string | null> {
  if (!supabase || !hipodromo || !carrera) return null;
  const { data, error } = await supabase
    .from("tablas_fijas")
    .select("id")
    .ilike("hipodromo", hipodromo)
    .eq("carrera", carrera)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { id: number | string }).id;
}

/** Publica una tabla en Supabase (upsert por hipódromo+carrera). RLS off → anon OK. */
export async function publicarTabla(t: TablaFijaRow): Promise<{ ok: boolean; id?: string | number; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    const existente = await idExistente(t.hipodromo, t.carrera);
    if (existente != null) {
      const { error } = await supabase.from("tablas_fijas").update(payloadDeTabla(t)).eq("id", existente);
      if (error) throw error;
      return { ok: true, id: existente };
    }
    const { data, error } = await supabase.from("tablas_fijas").insert(payloadDeTabla(t)).select("id").single();
    if (error) throw error;
    return { ok: true, id: data?.id };
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
  const ids: Array<string | number> = [];
  const nuevos: TablaFijaRow[] = [];

  for (const t of tablas) {
    try {
      const id = await idExistente(t.hipodromo, t.carrera);
      if (id != null) {
        const { error } = await supabase.from("tablas_fijas").update(payloadDeTabla(t)).eq("id", id);
        if (error) throw error;
        ids.push(id);
      } else {
        nuevos.push(t);
      }
    } catch (e) {
      errores.push({ hipodromo: t.hipodromo ?? "", carrera: t.carrera ?? null, error: (e as Error).message });
    }
  }

  if (nuevos.length) {
    try {
      const { data, error } = await supabase
        .from("tablas_fijas")
        .insert(nuevos.map((t) => payloadDeTabla(t)))
        .select("id");
      if (error) throw error;
      (data ?? []).forEach((d) => {
        const id = (d as { id: string | number }).id;
        if (id != null) ids.push(id);
      });
    } catch (e) {
      const msg = (e as Error).message;
      nuevos.forEach((t) => errores.push({ hipodromo: t.hipodromo ?? "", carrera: t.carrera ?? null, error: msg }));
    }
  }

  return { ok: errores.length === 0, okCount: ids.length, errores };
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