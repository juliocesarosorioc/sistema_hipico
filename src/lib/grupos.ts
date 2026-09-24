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
};

export type ClienteVenta = {
  id: string | number;
  nombre: string;
  saldo_actual?: number | null;
  aval?: number | null;
  libre?: boolean | null;
  modo_juego?: string | null;
  grupo_id?: string | number | null;
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
        .select("id, nombre, saldo_actual, aval, libre, modo_juego, grupo_id");
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