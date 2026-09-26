/**
 * Grupos de venta y clientes/jugadores para la Venta Rápida de Tablas Fijas.
 * Clon del legacy (js/tablas.js cargarGrupos / cargarClientesVenta):
 * SELECT directo con orden es_principal DESC y fallback a la RPC segura
 * club_listar_grupos cuando el RLS bloquea el acceso (misma cadena del legacy).
 */
import { supabase } from "@/lib/supabase";

export type GrupoVenta = {
  id: string | number;
  nombre: string;
  moneda?: string | null;
  cupo_tabla?: number | null;
  es_principal?: boolean | null;
  activo?: boolean | null;
  /** Jerarquía de cruces: switch general del grupo (default TRUE = permitido). */
  permite_cruces?: boolean | null;
  /** Ciclo de facturación semanal (1=Lunes … 7=Domingo). Default L→D. */
  dia_inicio_semana?: number | null;
  dia_fin_semana?: number | null;
};

export type ClienteVenta = {
  id: string | number;
  nombre: string;
  saldo_actual?: number | null;
  aval?: number | null;
  libre?: boolean | null;
  modo_juego?: string | null;
  grupo_id?: string | number | null;
  /** Jerarquía de cruces: override por cliente (default TRUE = permitido). */
  permite_cruces?: boolean | null;
  /** Unión de clientes_grupos + grupo_id por cliente (misma regla del legacy). */
  grupos: (string | number)[];
};

let cacheGrupos: GrupoVenta[] | null = null;
let cacheClientes: ClienteVenta[] | null = null;

/** Lista los grupos de venta ACTIVOS (SELECT directo + fallback RPC). */
export async function listarGruposVenta(): Promise<GrupoVenta[]> {
  if (cacheGrupos) return cacheGrupos;
  let grupos: GrupoVenta[] = [];
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("grupos_venta")
        .select("*")
        .order("es_principal", { ascending: false });
      if (error) throw error;
      grupos = (data ?? []) as GrupoVenta[];
    } catch {
      try {
        const { data, error } = await supabase.rpc("club_listar_grupos");
        if (!error && Array.isArray(data)) grupos = data as GrupoVenta[];
      } catch {
        /* sin RPC ni SELECT → vacío */
      }
    }
  }
  grupos = grupos.filter((g) => g.activo !== false);
  cacheGrupos = grupos;
  return grupos;
}

/** Lista clientes con sus saldos y grupos (clientes + clientes_grupos). */
export async function listarClientesVenta(): Promise<ClienteVenta[]> {
  if (cacheClientes) return cacheClientes;
  let clientes: ClienteVenta[] = [];
  if (supabase) {
    try {
      const { data: cli, error: e1 } = await supabase
        .from("clientes")
        .select("id, nombre, saldo_actual, aval, libre, modo_juego, grupo_id, permite_cruces");
      if (e1) throw e1;
      const { data: cg, error: e2 } = await supabase
        .from("clientes_grupos")
        .select("grupo_id, cliente_id");
      if (e2) throw e2;
      clientes = (cli ?? []).map((c) => ({
        id: String(c.id),
        nombre: String(c.nombre ?? ""),
        saldo_actual: c.saldo_actual != null ? Number(c.saldo_actual) : null,
        aval: c.aval != null ? Number(c.aval) : null,
        libre: Boolean(c.libre),
        modo_juego: c.modo_juego ? String(c.modo_juego) : null,
        grupo_id: c.grupo_id ?? null,
        permite_cruces: c.permite_cruces != null ? Boolean(c.permite_cruces) : null,
        grupos: [
          ...new Set([
            ...((cg ?? []).filter((x) => String(x.cliente_id) === String(c.id)).map((x) => String(x.grupo_id))),
            ...(c.grupo_id ? [String(c.grupo_id)] : []),
          ].filter(Boolean)),
        ],
      }));
    } catch {
      clientes = [];
    }
  }
  cacheClientes = clientes;
  return clientes;
}

/** Jugadores de un grupo (misma regla que poblarJugadoresDelGrupo del legacy). */
export async function jugadoresDeGrupo(grupoId: string | number): Promise<ClienteVenta[]> {
  const clientes = await listarClientesVenta();
  return clientes.filter((c) => (c.grupos || []).map(String).includes(String(grupoId)));
}

/** Saldo disponible del jugador (saldo_actual), 0 si no se encontró. */
export function saldoDeCliente(c: ClienteVenta | null | undefined): number {
  return c && c.saldo_actual != null ? c.saldo_actual : 0;
}

// ===========================================================================
// ADMINISTRACIÓN DE GRUPOS (clon de js/grupos.js) — datos reales de Supabase
// ===========================================================================

export type GrupoRow = {
  id: string | number;
  nombre: string;
  moneda?: string | null;
  moneda_cuadre?: string | null;
  cupo_tabla?: number | null;
  comision_default?: number | null;
  responsable?: string | null;
  cuenta_bancaria?: string | null;
  es_principal?: boolean | null;
  activo?: boolean | null;
  /** Jerarquía de cruces: switch general del grupo (default TRUE = permitido). */
  permite_cruces?: boolean | null;
  /** Ciclo de facturación semanal (1=Lunes … 7=Domingo). Default L→D. */
  dia_inicio_semana?: number | null;
  dia_fin_semana?: number | null;
  created_at?: string | null;
};

export type ClienteLigero = {
  id: string | number;
  nombre: string;
  grupo_id?: string | number | null;
};

export type MembresiaClienteGrupo = {
  id?: string | number;
  cliente_id: string | number;
  grupo_id: string | number;
  es_principal?: boolean | null;
  activo?: boolean | null;
};

export type ConvenioRow = {
  id?: string | number;
  tipo_jugada_id: string | number;
  grupo_id: string | number;
  comision?: string | number | null;
  comision_base?: string | number | null;
  comision_porcentaje?: number | null;
  permite_cruces?: boolean | null;
};

/** Lista TODOS los grupos (gestión); a diferencia de listarGruposVenta no filtra activos. */
export async function listarGruposAdmin(force = false): Promise<GrupoRow[]> {
  if (cacheGrupos && !force) return cacheGrupos as unknown as GrupoRow[];
  let grupos: GrupoRow[] = [];
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("grupos_venta")
        .select(
          "id, nombre, moneda, moneda_cuadre, cupo_tabla, comision_default, responsable, cuenta_bancaria, es_principal, activo, permite_cruces, dia_inicio_semana, dia_fin_semana, created_at"
        )
        .order("es_principal", { ascending: false });
      if (error) throw error;
      grupos = (data ?? []) as GrupoRow[];
    } catch {
      try {
        const { data, error } = await supabase.rpc("club_listar_grupos");
        if (!error && Array.isArray(data)) grupos = data as unknown as GrupoRow[];
      } catch {
        /* sin acceso → vacío */
      }
    }
  }
  cacheGrupos = grupos;
  return grupos;
}

export async function crearGrupo(datos: Partial<GrupoRow>): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  const filaOk = { ...datos, activo: true } as Record<string, unknown>;
  try {
    const { error } = await supabase.from("grupos_venta").insert([filaOk]);
    if (error) {
      // Fallback a la RPC del legacy (js/grupos.js): club_guardar_grupo.
      const rpc = await supabase.rpc("club_guardar_grupo", {
        p_nombre: String(datos.nombre ?? ""),
        p_moneda: datos.moneda ?? "USD",
        p_cupo_tabla: datos.cupo_tabla ?? 100,
        p_comision: datos.comision_default ?? 2.5,
        p_responsable: datos.responsable ?? null,
        p_cuenta: datos.cuenta_bancaria ?? null,
        p_principal: Boolean(datos.es_principal),
        p_activo: true,
      });
      if (rpc.error) return { ok: false, error: rpc.error.message };
    }
    cacheGrupos = null;
    void registrarAuditoria("GRUPO", "CREAR", datos.nombre ? `Grupo creado: ${datos.nombre}` : "Grupo creado");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function actualizarGrupo(
  id: string | number,
  patch: Record<string, unknown>
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    const { error } = await supabase.from("grupos_venta").update(patch).eq("id", id);
    if (error) {
      // Fallback a la RPC del legacy (js/grupos.js): club_actualizar_grupo.
      const rpc = await supabase.rpc("club_actualizar_grupo", {
        p_id: id,
        p_nombre: patch.nombre ?? null,
        p_moneda: patch.moneda ?? null,
        p_cupo_tabla: patch.cupo_tabla ?? null,
        p_comision: patch.comision_default ?? null,
        p_responsable: patch.responsable ?? null,
        p_cuenta: patch.cuenta_bancaria ?? null,
        p_principal: patch.es_principal ?? null,
        p_activo: patch.activo ?? null,
      });
      if (rpc.error) return { ok: false, error: rpc.error.message };
    }
    cacheGrupos = null;
    void registrarAuditoria("GRUPO", "ACTUALIZAR", `Grupo ${id} actualizado.`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Registro best-effort de operaciones en `auditoria` (misma tabla del legacy). */
export async function registrarAuditoria(
  modulo: string,
  accion: string,
  detalle: string
): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from("auditoria").insert([
      { modulo, accion, detalle: String(detalle).slice(0, 500), fecha: new Date().toISOString() },
    ] as Record<string, unknown>[]);
  } catch {
    /* la tabla o el RLS pueden impedirlo; no bloquea la operación */
  }
}

/** Activa/desactiva un grupo (la tarjeta se oculta en opciones de venta). */
export async function toggleGrupoActivo(id: string | number, activo: boolean): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    const { error } = await supabase.from("grupos_venta").update({ activo }).eq("id", id);
    if (error) {
      const rpc = await supabase.rpc("club_toggle_grupo", { p_id: id, p_activo: activo });
      if (rpc.error) return { ok: false, error: rpc.error.message };
    }
    cacheGrupos = null;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Garantiza UN solo grupo principal: desmarca los demás. */
export async function asignarPrincipalUnico(id: string | number): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    const { error } = await supabase.from("grupos_venta").update({ es_principal: false }).neq("id", id).eq("es_principal", true);
    if (error) return { ok: false, error: error.message };
    cacheGrupos = null;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Elimina un grupo (regla del legacy): re-mueve sus clientes al grupo
 * principal, limpia pertenencias de clientes_grupos y borra el registro.
 */
export async function eliminarGrupoRpc(id: string | number): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    const principal = (await listarGruposAdmin(true)).find((g) => g.es_principal);
    if (principal && String(principal.id) !== String(id)) {
      const { error: e1 } = await supabase.from("clientes").update({ grupo_id: principal.id }).eq("grupo_id", id);
      if (e1) return { ok: false, error: e1.message };
    }
    const { error: e2 } = await supabase.from("clientes_grupos").delete().eq("grupo_id", id);
    if (e2) return { ok: false, error: e2.message };
    const { error: e3 } = await supabase.from("grupos_venta").delete().eq("id", id);
    if (e3) {
      // Fallback a la RPC del legacy (js/grupos.js): club_eliminar_grupo.
      const rpc = await supabase.rpc("club_eliminar_grupo", { p_id: id });
      if (rpc.error) return { ok: false, error: rpc.error.message };
    }
    cacheGrupos = null;
    void registrarAuditoria("GRUPO", "ELIMINAR", `Grupo ${id} eliminado.`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Clientes por grupo (grupo_id principal + pertenencias adicionales)
// ---------------------------------------------------------------------------

export async function listarClientesLigeros(force = false): Promise<ClienteLigero[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase.from("clientes").select("id, nombre, grupo_id").order("nombre");
    if (error) throw error;
    return (data ?? []) as ClienteLigero[];
  } catch {
    return [];
  }
}

export async function listarMembresias(force = false): Promise<MembresiaClienteGrupo[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("clientes_grupos")
      .select("id, cliente_id, grupo_id, es_principal, activo");
    if (error) throw error;
    return (data ?? []) as MembresiaClienteGrupo[];
  } catch {
    return [];
  }
}

/** Agrega clientes como pertenencia ADICIONAL a un grupo (cliente_grupos).
 *  Regla del legacy: nunca duplica a los principales del destino ni a
 *  adicionales existentes, y excluye el propio grupo destino. */
export async function agregarClientesGrupo(
  clienteIds: (string | number)[],
  grupoId: string | number
): Promise<{ ok: boolean; agregados: number; error?: string; sinTabla?: boolean }> {
  if (!supabase) return { ok: false, agregados: 0, error: "Sin conexión a Supabase" };
  const idsSet = new Set(clienteIds.map((x) => String(x)));
  idsSet.delete(String(grupoId));
  if (!idsSet.size) return { ok: true, agregados: 0 };
  try {
    const filas = [...idsSet].map((cliente_id) => ({
      cliente_id,
      grupo_id: grupoId,
      es_principal: false,
      activo: true,
    }));
    let yaExisten = new Set<string>();
    let principalesDestino = new Set<string>();
    try {
      const [p, e] = await Promise.all([
        supabase.from("clientes").select("id").eq("grupo_id", String(grupoId) as never),
        (async () => {
          const { data, error } = await supabase.from("clientes_grupos").select("cliente_id").eq("grupo_id", String(grupoId) as never);
          return error ? null : data;
        })(),
      ]);
      if (p && !p.error && Array.isArray(p.data)) principalesDestino = new Set(p.data.map((x) => String(x.id)));
      if (e && Array.isArray(e)) yaExisten = new Set(e.map((x) => String(x.cliente_id)));
    } catch {
      /* tabla clientes_grupos posiblemente ausente → fallback directo */
    }
    const nuevas = filas.filter((f) => !yaExisten.has(String(f.cliente_id)) && !principalesDestino.has(String(f.cliente_id)));
    if (!nuevas.length) return { ok: true, agregados: 0 };
    const { error } = await supabase.from("clientes_grupos").insert(nuevas as Record<string, unknown>[]);
    if (error) {
      // Fallback sin tabla clientes_grupos (mismo comportamiento del legacy):
      // se mueve el grupo_id principal del cliente (schema sin multi-grupo).
      if (/relation .* does not exist|PGRST205/i.test(error.message)) {
        const { error: e2 } = await supabase.from("clientes").update({ grupo_id: grupoId }).in("id", [...idsSet]);
        if (e2) return { ok: false, agregados: 0, error: e2.message };
        cacheClientes = null;
        return { ok: true, agregados: nuevas.length, sinTabla: true };
      }
      return { ok: false, agregados: 0, error: error.message };
    }
    cacheClientes = null;
    return { ok: true, agregados: nuevas.length };
  } catch (e) {
    return { ok: false, agregados: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Quita pertenencias ADICIONALES del grupo (nunca el grupo_id principal del cliente). */
export async function quitarClientesGrupo(
  clienteIds: (string | number)[],
  grupoId: string | number
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    const { error } = await supabase
      .from("clientes_grupos")
      .delete()
      .eq("grupo_id", grupoId)
      .in("cliente_id", clienteIds);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Movimiento sin tabla clientes_grupos (fallback): asigna grupo_id principal. */
export async function moverClientesGrupo(
  clienteIds: (string | number)[],
  grupoId: string | number
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    const { error } = await supabase.from("clientes").update({ grupo_id: grupoId }).in("id", clienteIds);
    if (error) return { ok: false, error: error.message };
    cacheClientes = null;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Convenios por tipo de jugada y grupo (convenio_tipo_grupo)
// ---------------------------------------------------------------------------

export type TipoJugadaRow = {
  id: string | number;
  nombre: string;
  activo?: boolean | null;
  comision_porcentaje?: number | null;
  comision_base?: string | null;
  permite_cruces?: boolean | null;
};

export async function listarTiposJugadas(soloActivos = true): Promise<TipoJugadaRow[]> {
  if (!supabase) return [];
  try {
    const q = supabase.from("tipos_jugadas").select("*");
    const r = soloActivos ? await q.eq("activo", true).order("nombre") : await q.order("nombre");
    if (r.error) throw r.error;
    return (r.data ?? []) as TipoJugadaRow[];
  } catch {
    return [];
  }
}

export async function listarConveniosGrupo(grupoId: string | number): Promise<ConvenioRow[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase.from("convenio_tipo_grupo").select("*").eq("grupo_id", grupoId);
    if (error) throw error;
    return (data ?? []) as ConvenioRow[];
  } catch {
    return [];
  }
}

/** UPSERT de convenios (clave única tipo_jugada_id + grupo_id, como el legacy). */
export async function guardarConveniosGrupo(
  grupoId: string | number,
  filas: Array<{
    tipo_jugada_id: string | number;
    comision: number | null;
    comision_base: number | null;
    permite_cruces: boolean;
  }>
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    const payload = filas.map((f) => ({
      tipo_jugada_id: f.tipo_jugada_id,
      grupo_id: grupoId,
      comision: f.comision != null ? String(f.comision) : "5%",
      comision_base: f.comision_base != null ? String(f.comision_base) : "PREMIO",
      comision_porcentaje: f.comision ?? 0,
      permite_cruces: f.permite_cruces,
    }));
    const { error } = await supabase
      .from("convenio_tipo_grupo")
      .upsert(payload, { onConflict: "tipo_jugada_id,grupo_id" });
    if (error) return { ok: false, error: error.message };
    void registrarAuditoria("CONVENIO", "GUARDAR", `Convenios del grupo ${grupoId}: ${filas.length} tipo(s).`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// H1 · Cupos por grupo de una Tabla Fija (tabla_grupos)
// ---------------------------------------------------------------------------

export type CupoTablaGrupo = {
  id?: string | number;
  tabla_id: string | number;
  grupo_id: string | number;
  grupo_nombre?: string | null;
  cupos?: number | null;
  max?: number | null;
  cantidad_vendida?: number;
};

/** Cupos por grupo de una tabla (tabla_grupos, orden alfabético por grupo). */
export async function listarCuposTabla(tablaId: string | number): Promise<CupoTablaGrupo[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("tabla_grupos")
      .select("id, tabla_id, grupo_id, grupo_nombre, cupos, max, cantidad_vendida")
      .eq("tabla_id", String(tablaId));
    if (error) throw error;
    return (data ?? []) as CupoTablaGrupo[];
  } catch {
    return [];
  }
}

/** UPSERT de cupos por grupo de una tabla (clave única tabla_id+grupo_id). */
export async function guardarCuposTabla(
  tablaId: string | number,
  filas: Array<{ grupo_id: string | number; cupos: number | null; max: number | null }>
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  const payload = filas.map((f) => ({
    tabla_id: String(tablaId),
    grupo_id: f.grupo_id,
    cupos: f.cupos ?? 0,
    max: f.max,
  }));
  try {
    const { error } = await supabase
      .from("tabla_grupos")
      .upsert(payload, { onConflict: "tabla_id,grupo_id" });
    if (error) return { ok: false, error: error.message };
    void registrarAuditoria("TABLA_GRUPOS", "GUARDAR", `Cupos de la tabla ${tablaId}: ${filas.length} grupo(s).`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// H4 · CRUD de Tipos de Jugada (tipos_jugadas)
// ---------------------------------------------------------------------------

/** Crea un tipo de jugada (con activo=true). */
export async function crearTipoJugada(nombre: string): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    const { error } = await supabase
      .from("tipos_jugadas")
      .insert([{ nombre: String(nombre ?? "").trim().toUpperCase(), activo: true, comision_porcentaje: 0 }]);
    if (error) return { ok: false, error: error.message };
    void registrarAuditoria("TIPOS_JUGADAS", "CREAR", `Tipo de jugada creado: ${nombre}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Actualiza nombre / % por defecto de un tipo de jugada. */
export async function actualizarTipoJugada(
  id: string | number,
  patch: { nombre?: string; comision_porcentaje?: number | null; permite_cruces?: boolean | null }
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    const datos: Record<string, unknown> = {};
    if (patch.nombre != null) datos.nombre = String(patch.nombre).trim().toUpperCase();
    if (patch.comision_porcentaje != null) datos.comision_porcentaje = patch.comision_porcentaje;
    if (patch.permite_cruces != null) datos.permite_cruces = patch.permite_cruces;
    if (!Object.keys(datos).length) return { ok: true };
    const { error } = await supabase.from("tipos_jugadas").update(datos).eq("id", id);
    if (error) return { ok: false, error: error.message };
    void registrarAuditoria("TIPOS_JUGADAS", "ACTUALIZAR", `Tipo de jugada ${id} actualizado.`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Activa/desactiva un tipo de jugada (los inactivos no se listan en convenios). */
export async function toggleTipoJugadaActivo(id: string | number, activo: boolean): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    const { error } = await supabase.from("tipos_jugadas").update({ activo }).eq("id", id);
    if (error) return { ok: false, error: error.message };
    void registrarAuditoria("TIPOS_JUGADAS", "TOGGLE", `Tipo de jugada ${id} → ${activo ? "activo" : "inactivo"}.`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}