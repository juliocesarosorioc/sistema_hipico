/**
 * ============================================================================
 * POLLAS — SERVICIO (acceso a datos)
 * ============================================================================
 *
 * Un juego de aciertos por puntos sobre el programa del día. La casa configura
 * qué carreras entran, cuántos puntos da cada puesto, a qué precio se vende cada
 * combinación y qué premios hay. Cada jugador compra combinaciones (una por
 * línea de papel) y gana quien más puntos suma.
 *
 * DÓNDE ESTÁ CADA COSA
 * -------------------
 *   - Las carreras y el resultado salen SIEMPRE de la matriz central
 *     (`carreras` + `resultados_carreras`). Este módulo no guarda ni una copia:
 *     guardar el resultado acá haría que dos verdades se contradijeran si alguien
 *     corrige la pizarra después de liquidar.
 *   - Los retiros y los INV de Pollas salen de la misma matriz. Ojo: el INV de
 *     Remates es de otro juego y NO bloquea acá (ver `carrerasDePolla`).
 *   - La lógica pura vive en `@/lib/pollas/core` y se re-exporta acá.
 *   - El esquema y las RPC están en `sql/pollas.sql` (manual, SQL Editor).
 *
 * ESCRITURAS
 * ----------
 * Todas van por RPC `security definer`: el navegador solo tiene SELECT. No es
 * capricho — `club_pagar_acumulado_polla` es la que impide que el acumulado se
 * pague dos veces, y esa guarda vive adentro de la función.
 */
import { supabase } from "@/lib/supabase";
import { exigirCapacidad } from "@/lib/seguridad/vigente";
import { leerCarrerasMaestro, aCarreraCentral } from "@/lib/carreras/maestro";
import type { FilaCarreraMaestro } from "@/lib/carreras/maestro-nucleo";
import { hoyLocal } from "@/lib/gaceta/programa";
import {
  configPorDefecto,
  META_ACUMULADO_POR_DEFECTO,
  PUNTOS_POR_DEFECTO,
  type CarreraPolla,
  type ConfigPolla,
  type Combinacion,
  type ResultadoCarrera,
} from "@/lib/pollas/core";

export * from "@/lib/pollas/core";

// ============================================================================
// TIPOS
// ============================================================================

export type Res<T> = { ok: boolean; datos?: T; error?: string };
export type ResSimple = { ok: boolean; error?: string };

/** Una Polla tal como vive en la base. */
export type Polla = {
  id: string;
  nombre: string;
  fecha: string;
  hipodromo_id: string | null;
  grupo_id: string | null;
  carreras: CarreraPolla[];
  puntos: { primero: number; segundo: number; tercero: number };
  precioUnitario: number;
  comisionPct: number;
  acumuladoPct: number;
  metaPuntos: number;
  premios: {
    primero: number | null;
    segundo: number | null;
    tercero: number | null;
  };
  /** Texto del premio cuando no es dinero ("una caja de ron"). */
  premiosTexto: { primero: string | null; segundo: string | null; tercero: string | null };
  estado: "Abierta" | "Cerrada" | "Liquidada";
  notas: string | null;
  fechaRegistro: string | null;
};

export type VentaPolla = {
  id: string;
  polla_id: string;
  cliente_id: string | null;
  clienteNombre: string | null;
  numero_ticket: string | null;
  combinaciones: number;
  precio_unitario: number;
  pagado: number;
  texto_original: string | null;
  estado: string;
  fecha_registro: string | null;
};

export type CombinacionGuardada = {
  id: string;
  venta_id: string;
  polla_id: string;
  posiciones: { claveCarrera: string; numero: string }[];
  puntos: number | null;
  anulada: boolean;
  motivo_anula: string | null;
};

export type AcumuladoPolla = {
  id: string;
  polla_id: string;
  fecha: string;
  disponible: number;
  meta_puntos: number;
  pagado_a: string | null;
  pagado_at: string | null;
  observaciones: string | null;
};

/** Lo que se manda al crear/editar una Polla. */
export type DatosPolla = {
  nombre: string;
  fecha: string;
  hipodromo_id?: string | null;
  grupo_id?: string | null;
  carreras: CarreraPolla[];
  puntos?: { primero?: number; segundo?: number; tercero?: number };
  precioUnitario?: number;
  comisionPct?: number;
  acumuladoPct?: number;
  metaPuntos?: number;
  premios?: { primero?: number | null; segundo?: number | null; tercero?: number | null };
  premiosTexto?: { primero?: string | null; segundo?: string | null; tercero?: string | null };
  estado?: string;
  notas?: string | null;
};

/** Las RPC no están aplicadas todavía. */
const MENSAJE_SIN_RPC =
  "No se encontraron las funciones de Pollas. Aplicalas con sql/pollas.sql en el SQL Editor.";

/**
 * Traduce el error de PostgREST cuando la RPC todavía no está aplicada
 * (PGRST202 / "not found" / caché desactualizada) a un mensaje accionable.
 * Deja pasar el resto tal cual: un "Solapamiento" tiene que llegar al operador.
 */
function mensajeErrorRpc(texto: string | undefined, fallback: string): string {
  const t = texto ?? "";
  return /club_.*_polla|not found|404|PGRST202|schema cache/i.test(t)
    ? fallback
    : t || fallback;
}

// ============================================================================
// CARRERAS DE LA POLLA
// ============================================================================

/**
 * Convierte una fila de la matriz en la carrera que espera el core.
 *
 * Lo bloqueante es la unión de RETIRADOS e INV de Pollas, y son dos listas
 * distintas a propósito: el retiro saca al ejemplar de todos los módulos (Tablas,
 * Marcas, Taquilla, Remates y Polla), y el INV de Pollas solo de acá. Por eso NO
 * se suma `invalidados` (que es el de Remates): un ejemplar invalidado en una
 * subasta sigue siendo jugable en una Polla.
 */
export function aCarreraDePolla(m: FilaCarreraMaestro): CarreraPolla {
  const c = aCarreraCentral(m);
  const bloqueantes = new Set<string>([
    ...(c.retirados ?? []).map((x) => String(x).trim()),
    ...(c.invalidadosPolla ?? []).map((x) => String(x).trim()),
  ]);
  return {
    clave: claveDeCarrera(c.fecha, c.hipodromo, c.carrera),
    fecha: c.fecha,
    hipodromo: c.hipodromo,
    carrera: c.carrera,
    ejemplares: (c.caballos ?? [])
      .filter((x) => !bloqueantes.has(String(x.numero).trim()))
      .map((x) => ({ numero: String(x.numero).trim(), nombre: x.nombre ?? null })),
    invalidados: [...bloqueantes],
  };
}

/** La clave con la que se guarda cada elección: `fecha|hipodromo|carrera`. */
export function claveDeCarrera(fecha: string, hipodromo: string, carrera: number | string): string {
  return `${String(fecha).slice(0, 10)}|${String(hipodromo).trim().toUpperCase()}|${Number(carrera) || 0}`;
}

/**
 * Trae del maestro, en orden, las carreras que la casa puede meter en una Polla.
 *
 * Sin orden explícito el jugador contesta por posición, así que el orden del
 * maestro ES el orden de las preguntas: no se puede reordenar al azar.
 */
export async function listarCarrerasParaPolla(fecha?: string): Promise<Res<CarreraPolla[]>> {
  const leido = await leerProgramaDePolla(fecha);
  return leido.ok ? { ok: true, datos: leido.datos?.carreras } : { ok: false, error: leido.error };
}

/** El programa del día con las dos cosas que necesita el módulo. */
export type ProgramaDePolla = {
  /** Carreras ofrecidas, con sus ejemplares ya filtrados por retiro e INV. */
  carreras: CarreraPolla[];
  /** Pizarra de cada carrera, en orden de llegada. Vacía si aún no corrió. */
  resultados: ResultadoCarrera[];
};

/**
 * Lee el programa y la pizarra del día, en la misma pasada.
 *
 * Van juntos a propósito: el puntaje lee el resultado de la MISMA fila que trae
 * la oferta. Si fueran dos consultas, la Polla podría puntuar contra una pizarra
 * de otra versión del programa y dar un ganador que no existe.
 */
export async function leerProgramaDePolla(fecha?: string): Promise<Res<ProgramaDePolla>> {
  const leido = await leerCarrerasMaestro(fecha ?? hoyLocal());
  if (!leido.ok) {
    return { ok: false, error: leido.error ?? "No pude leer el programa del día." };
  }
  const carreras = leido.filas.map(aCarreraDePolla);
  const resultados: ResultadoCarrera[] = leido.filas.map((m) => {
    const c = aCarreraCentral(m);
    return {
      clave: claveDeCarrera(c.fecha, c.hipodromo, c.carrera),
      ganadores: (c.ganadores ?? []).map((g) => String(g).trim()).filter(Boolean),
    };
  });
  return { ok: true, datos: { carreras, resultados } };
}

// ============================================================================
// NORMALIZACIÓN DE LO QUE VIENE DE LA BASE
// ============================================================================

/**
 * Reconstruye la `ConfigPolla` desde una fila.
 *
 * Las carreras se guardan ya normalizadas (con sus inválidos resueltos), así que
 * al leer no se vuelve a ir al maestro: la Polla tiene que seguir liquidando
 * igual aunque al día siguiente la carrera haya cambiado en la matriz. Lo que se
 * congeló al vender es lo que se puntúa.
 */
function normalizarPolla(raw: Record<string, unknown>): Polla {
  const carreras = Array.isArray(raw.carreras) ? (raw.carreras as CarreraPolla[]) : [];
  const n = (v: unknown, d: number | null = null) => (v == null || v === "" ? d : Number(v));
  return {
    id: String(raw.id ?? ""),
    nombre: String(raw.nombre ?? "Polla"),
    fecha: String(raw.fecha ?? "").slice(0, 10),
    hipodromo_id: raw.hipodromo_id != null ? String(raw.hipodromo_id) : null,
    grupo_id: raw.grupo_id != null ? String(raw.grupo_id) : null,
    carreras,
    puntos: {
      primero: n(raw.puntos_1o, PUNTOS_POR_DEFECTO.primero) ?? PUNTOS_POR_DEFECTO.primero,
      segundo: n(raw.puntos_2o, PUNTOS_POR_DEFECTO.segundo) ?? PUNTOS_POR_DEFECTO.segundo,
      tercero: n(raw.puntos_3o, PUNTOS_POR_DEFECTO.tercero) ?? PUNTOS_POR_DEFECTO.tercero,
    },
    precioUnitario: n(raw.precio_unitario, 0) ?? 0,
    comisionPct: n(raw.comision_pct, 0) ?? 0,
    acumuladoPct: n(raw.acumulado_pct, 0) ?? 0,
    metaPuntos: n(raw.meta_puntos, META_ACUMULADO_POR_DEFECTO) ?? META_ACUMULADO_POR_DEFECTO,
    premios: {
      primero: n(raw.premio_1o),
      segundo: n(raw.premio_2o),
      tercero: n(raw.premio_3o),
    },
    premiosTexto: {
      primero: raw.premio_1o_txt != null ? String(raw.premio_1o_txt) : null,
      segundo: raw.premio_2o_txt != null ? String(raw.premio_2o_txt) : null,
      tercero: raw.premio_3o_txt != null ? String(raw.premio_3o_txt) : null,
    },
    estado: (raw.estado != null ? String(raw.estado) : "Abierta") as Polla["estado"],
    notas: raw.notas != null ? String(raw.notas) : null,
    fechaRegistro: raw.fecha_registro != null ? String(raw.fecha_registro) : null,
  };
}

/** La configuración que el core necesita, desde una Polla de la base. */
export function configDePolla(p: Polla): ConfigPolla {
  return {
    ...configPorDefecto(p.carreras, p.precioUnitario),
    puntos: { ...p.puntos },
    comisionPct: p.comisionPct,
    acumuladoPct: p.acumuladoPct,
    metaPuntos: p.metaPuntos,
    premios: { ...p.premios },
  };
}

// ============================================================================
// POLLAS
// ============================================================================

export async function listarPollas(fecha?: string): Promise<Res<Polla[]>> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  try {
    let q = supabase.from("pollas").select("*");
    if (fecha) q = q.eq("fecha", fecha);
    const { data, error } = await q.order("fecha", { ascending: false });
    if (error) return { ok: false, error: mensajeErrorRpc(error.message, MENSAJE_SIN_RPC) };
    return { ok: true, datos: (data ?? []).map((r) => normalizarPolla(r as Record<string, unknown>)) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Crea o edita una Polla. El guardado va por RPC: la base normaliza y valida. */
export async function guardarPolla(id: string | null, datos: DatosPolla): Promise<ResSimple & { id?: string }> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  try {
    exigirCapacidad("pollas:fn_guardar_polla");
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const nombre = String(datos.nombre ?? "").trim();
  if (!nombre) return { ok: false, error: "La Polla necesita un nombre." };
  if (!datos.fecha) return { ok: false, error: "Elegí la fecha de la Polla." };
  if (!Array.isArray(datos.carreras) || datos.carreras.length === 0) {
    return { ok: false, error: "Elegí al menos una carrera." };
  }

  try {
    const { data, error } = await supabase.rpc("club_guardar_polla", {
      p_id: id || null,
      p_datos: {
        nombre,
        fecha: datos.fecha,
        hipodromo_id: datos.hipodromo_id ?? null,
        grupo_id: datos.grupo_id ?? null,
        carreras: datos.carreras,
        puntos_1o: datos.puntos?.primero ?? PUNTOS_POR_DEFECTO.primero,
        puntos_2o: datos.puntos?.segundo ?? PUNTOS_POR_DEFECTO.segundo,
        puntos_3o: datos.puntos?.tercero ?? PUNTOS_POR_DEFECTO.tercero,
        precio_unitario: datos.precioUnitario ?? 0,
        comision_pct: datos.comisionPct ?? 0,
        acumulado_pct: datos.acumuladoPct ?? 0,
        meta_puntos: datos.metaPuntos ?? META_ACUMULADO_POR_DEFECTO,
        premio_1o: datos.premios?.primero ?? null,
        premio_2o: datos.premios?.segundo ?? null,
        premio_3o: datos.premios?.tercero ?? null,
        premio_1o_txt: datos.premiosTexto?.primero ?? null,
        premio_2o_txt: datos.premiosTexto?.segundo ?? null,
        premio_3o_txt: datos.premiosTexto?.tercero ?? null,
        estado: datos.estado ?? "Abierta",
        notas: datos.notas ?? null,
      },
    });
    if (error) return { ok: false, error: mensajeErrorRpc(error.message, MENSAJE_SIN_RPC) };
    return { ok: true, id: data != null ? String(data) : undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function cambiarEstadoPolla(id: string, estado: string): Promise<ResSimple> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  try {
    exigirCapacidad("pollas:fn_guardar_polla");
    const { error } = await supabase.rpc("club_cambiar_estado_polla", {
      p_id: id,
      p_estado: estado,
    });
    if (error) return { ok: false, error: mensajeErrorRpc(error.message, MENSAJE_SIN_RPC) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ============================================================================
// VENTAS
// ============================================================================

export async function listarVentas(pollaId: string): Promise<Res<VentaPolla[]>> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  try {
    const { data, error } = await supabase
      .from("polla_ventas")
      .select("*, clientes(nombre)")
      .eq("polla_id", pollaId)
      .order("fecha_registro", { ascending: true });
    if (error) return { ok: false, error: mensajeErrorRpc(error.message, MENSAJE_SIN_RPC) };
    return {
      ok: true,
      datos: (data ?? []).map((v) => {
        const raw = v as Record<string, unknown>;
        const cli = raw.clientes as { nombre?: unknown } | null;
        return {
          id: String(raw.id ?? ""),
          polla_id: String(raw.polla_id ?? ""),
          cliente_id: raw.cliente_id != null ? String(raw.cliente_id) : null,
          clienteNombre: cli?.nombre != null ? String(cli.nombre) : null,
          numero_ticket: raw.numero_ticket != null ? String(raw.numero_ticket) : null,
          combinaciones: Number(raw.combinaciones ?? 0),
          precio_unitario: Number(raw.precio_unitario ?? 0),
          pagado: Number(raw.pagado ?? 0),
          texto_original: raw.texto_original != null ? String(raw.texto_original) : null,
          estado: String(raw.estado ?? "Pagada"),
          fecha_registro: raw.fecha_registro != null ? String(raw.fecha_registro) : null,
        };
      }),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Registra una venta con TODAS sus combinaciones.
 *
 * Se manda una sola vez y no venta por venta + combinación por combinación
 * porque el
 * cobro tiene que ser atómico: si se guarda la venta y falla el detalle, queda
 * una venta de 40 combinaciones pagadas que no existen. La RPC lo envuelve en una
 * transacción y calcula el total con el precio VIGENTE de la Polla, no con el que
 * traiga el cliente.
 */
export async function registrarVentaPolla(input: {
  pollaId: string;
  clienteId?: string | null;
  numeroTicket?: string | null;
  combinaciones: Combinacion[];
  textoOriginal?: string | null;
}): Promise<ResSimple & { id?: string }> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  try {
    exigirCapacidad("pollas:fn_registrar_venta");
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  if (!input.pollaId) return { ok: false, error: "Falta la Polla." };
  if (!Array.isArray(input.combinaciones) || input.combinaciones.length === 0) {
    return { ok: false, error: "La venta no tiene combinaciones." };
  }

  try {
    const { data, error } = await supabase.rpc("club_registrar_venta_polla", {
      p_polla_id: input.pollaId,
      p_cliente_id: input.clienteId ?? null,
      p_numero_ticket: input.numeroTicket ?? null,
      p_combinaciones: input.combinaciones.map((c) => ({ combinacion: c })),
      p_texto_original: input.textoOriginal ?? null,
    });
    if (error) return { ok: false, error: mensajeErrorRpc(error.message, MENSAJE_SIN_RPC) };
    return { ok: true, id: data != null ? String(data) : undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function listarCombinaciones(pollaId: string): Promise<Res<CombinacionGuardada[]>> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  try {
    const { data, error } = await supabase
      .from("polla_combinaciones")
      .select("*")
      .eq("polla_id", pollaId);
    if (error) return { ok: false, error: mensajeErrorRpc(error.message, MENSAJE_SIN_RPC) };
    return {
      ok: true,
      datos: (data ?? []).map((c) => {
        const raw = c as Record<string, unknown>;
        return {
          id: String(raw.id ?? ""),
          venta_id: String(raw.venta_id ?? ""),
          polla_id: String(raw.polla_id ?? ""),
          posiciones: Array.isArray(raw.posiciones)
            ? (raw.posiciones as { claveCarrera: string; numero: string }[])
            : [],
          puntos: raw.puntos != null ? Number(raw.puntos) : null,
          anulada: raw.anulada === true,
          motivo_anula: raw.motivo_anula != null ? String(raw.motivo_anula) : null,
        };
      }),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ============================================================================
// ACUMULADO
// ============================================================================

export async function listarAcumulados(pollaId: string): Promise<Res<AcumuladoPolla[]>> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  try {
    const { data, error } = await supabase
      .from("polla_acumulado")
      .select("*")
      .eq("polla_id", pollaId)
      .order("fecha", { ascending: false });
    if (error) return { ok: false, error: mensajeErrorRpc(error.message, MENSAJE_SIN_RPC) };
    return {
      ok: true,
      datos: (data ?? []).map((a) => {
        const raw = a as Record<string, unknown>;
        return {
          id: String(raw.id ?? ""),
          polla_id: String(raw.polla_id ?? ""),
          fecha: String(raw.fecha ?? "").slice(0, 10),
          disponible: Number(raw.disponible ?? 0),
          meta_puntos: Number(raw.meta_puntos ?? META_ACUMULADO_POR_DEFECTO),
          pagado_a: raw.pagado_a != null ? String(raw.pagado_a) : null,
          pagado_at: raw.pagado_at != null ? String(raw.pagado_at) : null,
          observaciones: raw.observaciones != null ? String(raw.observaciones) : null,
        };
      }),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Aparta un aporte al acumulado.
 *
 * El saldo lo suma la RPC con `disponible = disponible + p_monto`. Es
 * deliberado: si el saldo se leyera y se escribiera desde el cliente, dos
 * liquidaciones simultáneas leerían el mismo número y la segunda pisaría a la
 * primera, perdiendo plata del acumulado sin que nadie lo viera.
 */
export async function aportarAcumulado(
  pollaId: string,
  monto: number,
  fecha?: string
): Promise<ResSimple & { saldo?: number }> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  try {
    exigirCapacidad("pollas:fn_liquidar_polla");
    const { data, error } = await supabase.rpc("club_aportar_acumulado_polla", {
      p_polla_id: pollaId,
      p_monto: Number(monto),
      p_fecha: fecha ?? null,
    });
    if (error) return { ok: false, error: mensajeErrorRpc(error.message, MENSAJE_SIN_RPC) };
    return { ok: true, saldo: data != null ? Number(data) : undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Paga el acumulado a un cliente.
 *
 * La RPC es la que pone `pagado_at` con la condición `pagado_at is null`: si dos
 * personas aprietan el botón a la vez, una gana y la otra recibe el error de la
 * base. Hacer esta marca desde el cliente sería una carrera y se pagaría dos
 * veces.
 */
export async function pagarAcumulado(
  pollaId: string,
  clienteId: string,
  fecha?: string
): Promise<ResSimple & { monto?: number }> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  try {
    exigirCapacidad("pollas:fn_liquidar_polla");
    if (!clienteId) return { ok: false, error: "Elegí quién cobra el acumulado." };
    const { data, error } = await supabase.rpc("club_pagar_acumulado_polla", {
      p_polla_id: pollaId,
      p_cliente_id: clienteId,
      p_fecha: fecha ?? null,
    });
    if (error) return { ok: false, error: mensajeErrorRpc(error.message, MENSAJE_SIN_RPC) };
    return { ok: true, monto: data != null ? Number(data) : undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ============================================================================
// ANULAR COMBINACIONES
// ============================================================================

/**
 * Anula una combinación porque su ejemplar se invalidó DESPUÉS de la venta.
 *
 * Sin esto, un ejemplar retirado a las 4 de la tarde seguía sumando puntos a las
 * 6, y el ganador resultaba de una combinación que nunca debió contar.
 */
export async function anularCombinacion(
  combinacionId: string,
  motivo: string
): Promise<ResSimple> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  try {
    exigirCapacidad("pollas:fn_liquidar_polla");
    const { error } = await supabase.rpc("club_anular_combinacion_polla", {
      p_combinacion_id: combinacionId,
      p_motivo: motivo ?? "",
    });
    if (error) return { ok: false, error: mensajeErrorRpc(error.message, MENSAJE_SIN_RPC) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}