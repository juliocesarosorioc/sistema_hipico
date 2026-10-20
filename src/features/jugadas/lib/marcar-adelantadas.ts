/**
 * ============================================================================
 * MARCAR JUGADAS COMO ADELANTADAS — escritura del flag `es_adelantada`
 * ============================================================================
 *
 * Las RPC de venta NO cambian de firma (un parámetro nuevo = un overload en
 * Postgres = ambigüedad en las llamadas existentes). La marca se aplica
 * DESPUÉS de la venta, desde el cliente, sobre el ticket recién creado:
 *
 *   · ids conocidos    → Taquilla/Puestos (`venderJugada` devuelve el ticketId),
 *                        Marcas y Dupletas (también devuelven id).
 *   · ventana de ids   → Tablas Fijas y Remates: sus RPC devuelven solo conteos,
 *                        así que se toma el `id` máximo ANTES de vender y se
 *                        marcan los tickets emitidos después para ese contexto
 *                        (cliente/tabla/remate). Ver `ultimoTicketId`.
 *   · Pollas           → `polla_ventas` es de solo lectura para authenticated,
 *                        se usa la RPC `club_marcar_adelantada_polla`
 *                        (sql/jugadas_adelantadas.sql).
 *
 * MEJOR ESFUERZO APROPIADO: esto corre DESPUÉS de que la venta quedó registrada.
 * Si la marca falla (columna sin migrar, RLS sin política de update) la venta NO
 * se revierte: se avisa con un toast de advertencia y listo.
 */
import { supabase } from "@/core/supabase";
import { notaAuditoriaDe } from "./modalidad-tiempo";

export type ResultadoMarca = {
  ok: boolean;
  /** Motivo legible cuando `ok === false`. */
  error?: string;
  /** Cuántos tickets quedaron marcados (0 también es un éxito válido). */
  marcados?: number;
};

const MENSAJE_SIN_CREDENCIALES =
  "Sin credenciales Supabase (.env.local): la venta quedó en local y sin la marca ⏳ adelantada.";

const MENSAJE_SIN_MIGRACION =
  "Falta la columna es_adelantada. Ejecuta sql/jugadas_adelantadas.sql en el SQL Editor de Supabase.";

const MENSAJE_SIN_RPC =
  "Falta la RPC club_marcar_adelantada_polla en Supabase. Ejecuta sql/jugadas_adelantadas.sql en el SQL Editor.";

function textoDeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/**
 * `id` del ticket más reciente de la base. Se toma ANTES de vender y sirve de
 * límite inferior para marcar "los tickets que se acaban de emitir" cuando la
 * RPC de venta no devuelve ids (Tablas Fijas, Remates).
 *
 * Devuelve 0 si no se pudo leer: en ese caso la ventana queda sin límite y el
 * llamador debe filtrar por cliente/tabla/remate para no marcar de más.
 */
export async function ultimoTicketId(): Promise<number> {
  if (!supabase) return 0;
  try {
    const { data, error } = await supabase
      .from("tickets_apuestas")
      .select("id")
      .order("id", { ascending: false })
      .limit(1);
    if (error || !data || !data.length) return 0;
    return Number((data[0] as { id: unknown }).id) || 0;
  } catch {
    return 0;
  }
}

/**
 * Marca tickets ya emitidos. `ids` vacíos no es error (no había nada que marcar).
 */
export async function marcarTicketsAdelantados(
  ids: Array<number | string | null | undefined>,
  adelantada = true
): Promise<ResultadoMarca> {
  const limpios = [...new Set(ids.map((i) => Number(i)).filter((n) => Number.isFinite(n) && n > 0))];
  if (!limpios.length) return { ok: true, marcados: 0 };
  if (!supabase) return { ok: false, error: MENSAJE_SIN_CREDENCIALES };

  try {
    const { data, error } = await supabase
      .from("tickets_apuestas")
      .update({ es_adelantada: adelantada })
      .in("id", limpios)
      .select("id");
    if (error) {
      const msg = error.message ?? textoDeError(error);
      return {
        ok: false,
        error: msg.includes("es_adelantada") ? MENSAJE_SIN_MIGRACION : msg,
      };
    }
    const marcados = data?.length ?? 0;
    if (marcados === 0) {
      return {
        ok: false,
        error:
          "El servidor no marcó ningún ticket: revisa la política de UPDATE de tickets_apuestas (jugadas_monitor.sql) y que se haya corrido sql/jugadas_adelantadas.sql.",
      };
    }
    return { ok: true, marcados };
  } catch (e) {
    return { ok: false, error: textoDeError(e) };
  }
}

/** Contexto para marcar por VENTANA (cuando la RPC de venta no devuelve ids). */
export type ContextoVenta = {
  /** `ultimoTicketId()` capturado ANTES de la venta. */
  desdeId?: number | null;
  /** Cliente que compró (filtra por `cliente_juega_id`). */
  clienteId?: string | null;
  /** Hipódromo de la carrera (comparación sin mayúsculas). */
  hipodromo?: string | null;
  /** Número de carrera (se compara como texto, para que sirva igual si la columna es int o text). */
  carrera?: number | string | null;
  /** `nota_auditoria.tabla_id` de los tickets de esa tabla fija. */
  tablaId?: number | string | null;
  /** `nota_auditoria.remate_id` de los tickets emitidos por ese remate. */
  remateId?: number | string | null;
  /** `nota_auditoria.remate_caballo_id`: acota a la venta suelta de UN ejemplar. */
  remateCaballoId?: number | string | null;
};

function coincideConContexto(
  fila: {
    hipodromo?: unknown;
    carrera?: unknown;
    cliente_juega_id?: unknown;
    nota_auditoria?: unknown;
  },
  ctx: ContextoVenta
): boolean {
  if (ctx.hipodromo && ctx.hipodromo !== "") {
    const h = String(fila.hipodromo ?? "").trim().toUpperCase();
    if (h !== String(ctx.hipodromo).trim().toUpperCase()) return false;
  }
  if (ctx.carrera !== null && ctx.carrera !== undefined && ctx.carrera !== "") {
    if (String(fila.carrera ?? "").trim() !== String(ctx.carrera).trim()) return false;
  }
  const nota = notaAuditoriaDe(fila.nota_auditoria);
  if (ctx.tablaId !== null && ctx.tablaId !== undefined && ctx.tablaId !== "") {
    if (!nota || String(nota.tabla_id ?? "") !== String(ctx.tablaId)) return false;
  }
  if (ctx.remateId !== null && ctx.remateId !== undefined && ctx.remateId !== "") {
    if (!nota || String(nota.remate_id ?? "") !== String(ctx.remateId)) return false;
  }
  if (
    ctx.remateCaballoId !== null &&
    ctx.remateCaballoId !== undefined &&
    ctx.remateCaballoId !== ""
  ) {
    if (!nota || String(nota.remate_caballo_id ?? "") !== String(ctx.remateCaballoId)) return false;
  }
  return true;
}

/**
 * Marca los tickets emitidos DESPUÉS de `desdeId` que cumplan el contexto.
 * Es la vía usada por Tablas Fijas y Remates (sus RPC no devuelven ids).
 */
export async function marcarTicketsRecientesDe(
  ctx: ContextoVenta,
  adelantada = true
): Promise<ResultadoMarca> {
  if (!supabase) return { ok: false, error: MENSAJE_SIN_CREDENCIALES };

  try {
    let q = supabase
      .from("tickets_apuestas")
      .select("id, hipodromo, carrera, cliente_juega_id, nota_auditoria");
    if (ctx.desdeId && ctx.desdeId > 0) q = q.gt("id", ctx.desdeId);
    if (ctx.clienteId) q = q.eq("cliente_juega_id", ctx.clienteId);

    const { data, error } = await q;
    if (error) {
      const msg = error.message ?? textoDeError(error);
      return { ok: false, error: msg.includes("es_adelantada") ? MENSAJE_SIN_MIGRACION : msg };
    }

    const ids = (data ?? [])
      .filter((f) => coincideConContexto(f as Record<string, unknown>, ctx))
      .map((f) => Number((f as { id: unknown }).id));
    if (!ids.length) return { ok: true, marcados: 0 };
    return marcarTicketsAdelantados(ids, adelantada);
  } catch (e) {
    return { ok: false, error: textoDeError(e) };
  }
}

/** Marca una venta de Polla vía RPC (la tabla no acepta UPDATE desde el cliente). */
export async function marcarVentaPollaAdelantada(
  ventaId: string | null | undefined,
  adelantada = true
): Promise<ResultadoMarca> {
  if (!ventaId) return { ok: true, marcados: 0 };
  if (!supabase) return { ok: false, error: MENSAJE_SIN_CREDENCIALES };

  try {
    const { error } = await supabase.rpc("club_marcar_adelantada_polla", {
      p_venta_id: ventaId,
      p_adelantada: adelantada,
    });
    if (error) {
      const msg = error.message ?? textoDeError(error);
      return { ok: false, error: msg.includes("club_marcar_adelantada_polla") ? MENSAJE_SIN_RPC : msg };
    }
    return { ok: true, marcados: 1 };
  } catch (e) {
    return { ok: false, error: textoDeError(e) };
  }
}

export type OperacionMarca =
  | { ids: Array<number | string | null | undefined>; contexto?: undefined; ventaPollaId?: undefined }
  | { ids?: undefined; contexto: ContextoVenta; ventaPollaId?: undefined }
  | { ids?: undefined; contexto?: undefined; ventaPollaId: string | null | undefined };

/**
 * Marca de la forma que corresponda y, si algo falla, avisa por `avisar`.
 * NUNCA tira: la venta ya está registrada y una marca fallida no la arruina
 * (es el "mejor esfuerzo" del diseño).
 */
export async function marcarAdelantadaTrasVenta(
  op: OperacionMarca,
  avisar?: (motivo: string) => void
): Promise<ResultadoMarca> {
  let r: ResultadoMarca;
  if (op.ventaPollaId !== undefined) {
    r = await marcarVentaPollaAdelantada(op.ventaPollaId);
  } else if (op.contexto) {
    r = await marcarTicketsRecientesDe(op.contexto);
  } else {
    r = await marcarTicketsAdelantados(op.ids ?? []);
  }
  if (!r.ok && avisar) avisar(r.error ?? "no se pudo escribir el flag es_adelantada");
  return r;
}
