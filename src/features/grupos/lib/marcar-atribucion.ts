/**
 * ============================================================================
 * ATRIBUIR CUENTA ENTRE GRUPOS — escritura de la "Regla de Oro Contable"
 * ============================================================================
 * Cuando un usuario de un Grupo Secundario (B) juega sobre la cartelera del
 * Grupo Principal, el ticket debe quedar con:
 *
 *   grupo_publicador_id = Principal
 *   grupo_cuenta_id     = B
 *
 * Las RPC de venta NO cambian de firma (igual criterio que `es_adelantada` en
 * `marcar-adelantadas.ts`): la atribución se escribe DESPUÉS de la venta, desde
 * el cliente, sobre el ticket recién creado:
 *
 *   · ids conocidos  → Taquilla (`venderJugada`), Marcas (`venderMarca`) y
 *                      Dupletas (`venderDupleta`) devuelven el id del ticket.
 *   · ventana de ids → Tablas Fijas y Remates (sus RPC devuelven conteos):
 *                      se toma el `id` máximo ANTES de vender y se atribuyen los
 *                      tickets emitidos después para ese contexto.
 *
 * MEJOR ESFUERZO: si la migración `sql/grupos_visibilidad_principal.sql` no está
 * aplicada (columnas ausentes) o el RLS no deja el UPDATE, la venta NO se
 * revierte: se avisa por `avisar` y se sigue. Sin esto el enrutamiento contable
 * sería un punto de fallo para cobrar, que es lo que el diseño evita.
 */
import { supabase } from "@/core/supabase";
import { notaAuditoriaDe } from "@/features/jugadas/lib/modalidad-tiempo";
import type { AtribucionJugada } from "@/features/grupos/lib/atribucion-grupo";
import { columnasAtribucion } from "@/features/grupos/lib/atribucion-grupo";

export type ResultadoAtribucion = {
  ok: boolean;
  error?: string;
  /** Cuántos tickets quedaron atribuidos (0 también es un éxito válido). */
  marcados?: number;
};

const MENSAJE_SIN_CREDENCIALES =
  "Sin credenciales Supabase (.env.local): la venta quedó en local y sin la atribución de cuenta al grupo.";

const MENSAJE_SIN_MIGRACION =
  "Faltan las columnas grupo_publicador_id / grupo_cuenta_id. Ejecuta sql/grupos_visibilidad_principal.sql en el SQL Editor de Supabase.";

function textoDeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/** ¿La migración de atribución está aplicada? (columnas presentes en la tabla). */
async function columnasPresentes(): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { error } = await supabase
      .from("tickets_apuestas")
      .select("id, grupo_publicador_id, grupo_cuenta_id")
      .limit(1);
    return !error;
  } catch {
    return false;
  }
}

/**
 * Escribe la atribución en tickets ya emitidos. `ids` vacíos no es error.
 * Cuando NO hay cruce (publicador == cuenta) se marca solo `grupo_cuenta_id`
 * (el publicador queda NULL para no duplicar `grupo_cobro_id`).
 */
export async function atribuirTickets(
  ids: Array<number | string | null | undefined>,
  atribucion: AtribucionJugada
): Promise<ResultadoAtribucion> {
  const limpios = [...new Set(ids.map((i) => Number(i)).filter((n) => Number.isFinite(n) && n > 0))];
  if (!limpios.length) return { ok: true, marcados: 0 };
  if (!supabase) return { ok: false, error: MENSAJE_SIN_CREDENCIALES };

  const cols = columnasAtribucion(atribucion) as Record<string, unknown>;
  if (Object.keys(cols).length === 0) return { ok: true, marcados: 0 };

  try {
    const { data, error } = await supabase
      .from("tickets_apuestas")
      .update(cols)
      .in("id", limpios)
      .select("id");
    if (error) {
      const msg = error.message ?? textoDeError(error);
      const sinCol = /grupo_(publicador|cuenta)_id/.test(msg);
      return { ok: false, error: sinCol ? MENSAJE_SIN_MIGRACION : msg };
    }
    const marcados = data?.length ?? 0;
    if (marcados === 0) {
      return {
        ok: false,
        error:
          "El servidor no atribuyó ningún ticket: revisa la política de UPDATE de tickets_apuestas y que se haya corrido sql/grupos_visibilidad_principal.sql.",
      };
    }
    return { ok: true, marcados };
  } catch (e) {
    return { ok: false, error: textoDeError(e) };
  }
}

/** Contexto para atribuir por VENTANA (cuando la RPC de venta no devuelve ids). */
export type ContextoAtribucion = {
  /** `ultimoTicketId()` capturado ANTES de la venta. */
  desdeId?: number | null;
  /** Cliente que compró (filtra por `cliente_juega_id`). */
  clienteId?: string | null;
  /** Hipódromo de la carrera (comparación sin mayúsculas). */
  hipodromo?: string | null;
  /** Número de carrera (comparación como texto). */
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
    nota_auditoria?: unknown;
  },
  ctx: ContextoAtribucion
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
 * Atribuye los tickets emitidos DESPUÉS de `desdeId` que cumplan el contexto.
 * Es la vía usada por Tablas Fijas y Remates (sus RPC no devuelven ids).
 */
export async function atribuirTicketsRecientesDe(
  ctx: ContextoAtribucion,
  atribucion: AtribucionJugada
): Promise<ResultadoAtribucion> {
  if (!supabase) return { ok: false, error: MENSAJE_SIN_CREDENCIALES };

  try {
    let q = supabase
      .from("tickets_apuestas")
      .select("id, hipodromo, carrera, nota_auditoria");
    if (ctx.desdeId && ctx.desdeId > 0) q = q.gt("id", ctx.desdeId);
    if (ctx.clienteId) q = q.eq("cliente_juega_id", ctx.clienteId);

    const { data, error } = await q;
    if (error) {
      const msg = error.message ?? textoDeError(error);
      const sinCol = /grupo_(publicador|cuenta)_id/.test(msg);
      return { ok: false, error: sinCol ? MENSAJE_SIN_MIGRACION : msg };
    }

    const ids = (data ?? [])
      .filter((f) => coincideConContexto(f as Record<string, unknown>, ctx))
      .map((f) => Number((f as { id: unknown }).id));
    if (!ids.length) return { ok: true, marcados: 0 };
    return atribuirTickets(ids, atribucion);
  } catch (e) {
    return { ok: false, error: textoDeError(e) };
  }
}

export type OperacionAtribucion =
  | { ids: Array<number | string | null | undefined>; contexto?: undefined }
  | { ids?: undefined; contexto: ContextoAtribucion };

/**
 * Atribuye de la forma que corresponda y, si algo falla, avisa por `avisar`.
 * NUNCA tira: la venta ya está registrada y una atribución fallida no la arruina.
 *
 * Si no hay cruce real (grupo del usuario == grupo publicador) NO escribe nada:
 * el comportamiento histórico (`grupo_cobro_id`) ya representa a quién se le da
 * cuenta. Evita escrituras inútiles y ruido de errores con la migración ausente.
 */
export async function atribuirTrasVenta(
  op: OperacionAtribucion,
  atribucion: AtribucionJugada | null | undefined,
  avisar?: (motivo: string) => void
): Promise<ResultadoAtribucion> {
  if (!atribucion) return { ok: true, marcados: 0 };
  // Sin cruce real no hay nada que enrutar: el modelo histórico
  // (`grupo_cobro_id`) ya dice a quién se le da cuenta. Evita escrituras
  // inútiles y ruido de errores cuando la migración no está aplicada.
  if (!atribucion.cruzada) {
    return { ok: true, marcados: 0 };
  }
  // Sin migración no tiene sentido intentar (evita un error por cada venta).
  if (!(await columnasPresentes())) {
    const r: ResultadoAtribucion = { ok: false, error: MENSAJE_SIN_MIGRACION };
    if (avisar) avisar(r.error ?? "faltan las columnas de atribución");
    return r;
  }

  let r: ResultadoAtribucion;
  if (op.contexto) {
    r = await atribuirTicketsRecientesDe(op.contexto, atribucion);
  } else {
    r = await atribuirTickets(op.ids ?? [], atribucion);
  }
  if (!r.ok && avisar) avisar(r.error ?? "no se pudo escribir la atribución de cuenta");
  return r;
}
