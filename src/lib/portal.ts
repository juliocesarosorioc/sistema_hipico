/**
 * Portal de Consulta del Cliente — clon moderno de js/portal.js (tarea 5).
 *
 *  - Entrada: por enlace largo (?c=<id>&k=<token>) o credenciales manuales
 *    (seudónimo/código + contraseña). Lee de `clientes` (portal_token / portal_clave).
 *  - Resumen/KPIs: Saldo (total decidido), Incentivo (devolución %) y Disponible.
 *  - Movimientos con acción "Reclamar" y "Reportar jugada faltante" (imagen a
 *    Supabase Storage, bucket `reclamos`; se inserta en tickets_jugadas).
 *  - Comprar Tablas Fijas → solicitudes_tablas (valida el admin).
 *  - Actualizar mis datos → notificaciones.tipo='portal_datos' (atendida por admin).
 */
import { supabase } from "@/lib/supabase";
import { construirEstadoCuenta, type ClienteRow, type NivelAcordeon, type NotificacionRow, type TicketApuesta } from "@/lib/clientes";

export type SesionPortal = {
  cliente: ClienteRow;
  resumen: { saldo: number; incentivo: number; disponible: number };
  arbolTickets: NivelAcordeon;
};

const CACHE_KEY = "portal.cliente";

const num = (v: number | string | null | undefined): number => {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};

/** Cliente guardado en sesión (persistencia entre recargas). */
export function sesionGuardada(): ClienteRow | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as ClienteRow) : null;
  } catch {
    return null;
  }
}

export function cerrarSesion(): void {
  if (typeof window !== "undefined") window.localStorage.removeItem(CACHE_KEY);
}

async function clientePorToken(id: string | number, token: string): Promise<ClienteRow | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.from("clientes").select("*").eq("id", id as never).eq("portal_token", token).limit(1).single();
    if (error) return null;
    const c = data as ClienteRow;
    return c.portal_habilitado ? c : null;
  } catch {
    return null;
  }
}

async function clientePorCredenciales(usuario: string, token: string, clave: string): Promise<ClienteRow | null> {
  if (!supabase) return null;
  try {
    const patron = usuario.trim().toUpperCase();
    const { data, error } = await supabase
      .from("clientes")
      .select("*")
      .ilike("seudonimo", `%${patron}%`)
      .limit(10);
    if (error) return null;
    const listado = (data ?? []) as ClienteRow[];
    const c = listado.find((x) => x.portal_habilitado && x.portal_token === token && x.portal_clave === clave);
    return c ?? null;
  } catch {
    return null;
  }
}

/**
 * Entra al portal. Si vienen los parámetros ?c= y ?k= del enlace corto, la clave
 * no se exige (equivalente legacy). Devuelve sesión con KPIs precargados.
 */
export async function entrarPortal(opts: {
  linkId?: string;
  linkToken?: string;
  usuario?: string;
  token?: string;
  clave?: string;
}): Promise<{ ok: boolean; error?: string; sesion?: SesionPortal }> {
  let cliente: ClienteRow | null = null;
  if (opts.linkId && opts.linkToken) {
    cliente = await clientePorToken(opts.linkId, opts.linkToken);
  } else if (opts.usuario && opts.token && opts.clave) {
    cliente = await clientePorCredenciales(opts.usuario, opts.token, opts.clave);
  }
  if (!cliente) {
    return { ok: false, error: "Credenciales inválidas o portal deshabilitado para el cliente." };
  }
  const sesion = await construirSesion(cliente);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(cliente));
  }
  return { ok: true, sesion };
}

/** Recupera la sesión desde el cliente guardado (refresh de KPIs). */
export async function reanudarSesion(): Promise<SesionPortal | null> {
  const c = sesionGuardada();
  if (!c) return null;
  return construirSesion(c);
}

async function construirSesion(cliente: ClienteRow): Promise<SesionPortal> {
  const tickets = await listarTicketsCliente(cliente.id);
  const pct = num(cliente.devolucion);
  const arbolTickets = construirEstadoCuenta(tickets, pct);
  return {
    cliente,
    resumen: { saldo: arbolTickets.monto, incentivo: arbolTickets.dec, disponible: arbolTickets.monto - arbolTickets.dec },
    arbolTickets,
  };
}

export async function listarTicketsCliente(clienteId: string | number): Promise<TicketApuesta[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("tickets_apuestas")
      .select(
        "id, created_at, hipodromo, carrera, nombre_jugada, caballo, cantidad_tablas, monto_jugado, monto_decidido, premio_pagar, premio_por_tabla, moneda, estado, grupo_cobro_nombre, grupo_cobro_id"
      )
      .eq("cliente_juega_id", clienteId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw error;
    return (data ?? []) as TicketApuesta[];
  } catch {
    return [];
  }
}

/** Lista los reclamos del cliente (para mostrar sus tickets de reclamo). */
export async function listarReclamosCliente(clienteId: string | number): Promise<NotificacionRow[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("notificaciones")
      .select("*")
      .eq("cliente_id", clienteId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return (data ?? []) as NotificacionRow[];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Reclamos con imagen (Supabase Storage)
// ---------------------------------------------------------------------------

/** Sube la imagen de soporte (cliente) al bucket `reclamos` y devuelve la URL pública. */
export async function guardarImagenReclamo(clienteId: string | number, archivo: File): Promise<{ url?: string; error?: string }> {
  if (!supabase) return { error: "Sin conexión a Supabase" };
  try {
    const ext = (archivo.name.split(".").pop() || "jpg").toLowerCase();
    const ruta = `${String(clienteId)}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("reclamos").upload(ruta, archivo, { contentType: archivo.type, upsert: false });
    if (error) return { error: error.message };
    const { data } = supabase.storage.from("reclamos").getPublicUrl(ruta);
    return { url: data.publicUrl };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export type ReporteJugadaFaltante = {
  cliente: ClienteRow;
  hipodromo: string;
  carrera: number;
  nombre_jugada: string;
  caballo: string;
  monto: number;
  motivo: string;
  image?: File | null;
};

/** Inserta el reclamo "jugada faltante" (estado EN_REVISION) con su imagen. */
export async function reportarJugadaFaltante(datos: ReporteJugadaFaltante): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    let imagen: string | null = null;
    if (datos.image) {
      const up = await guardarImagenReclamo(datos.cliente.id, datos.image);
      if (up.error) return { ok: false, error: `Imagen: ${up.error}` };
      imagen = up.url ?? null;
    }
    const { error } = await supabase.from("tickets_jugadas").insert([
      {
        cliente_id: datos.cliente.id,
        cliente_nombre: datos.cliente.nombre || datos.cliente.seudonimo,
        tipo_jugada: "REPORTE_FALTANTE",
        fecha_jugada: new Date().toISOString().slice(0, 10),
        hipodromo: datos.hipodromo,
        carrera: datos.carrera,
        monto: datos.monto || 0,
        motivo: datos.motivo,
        imagen_soporte: imagen,
        estado: "EN_REVISION",
        creado_por: "portal",
      },
    ]);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Marca un movimiento existente como reclamado (estado EN_REVISION en tickets_apuestas). */
export async function reclamarJugada(ticketId: string | number): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    const { error } = await supabase.from("tickets_apuestas").update({ estado: "EN_REVISION" }).eq("id", ticketId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export type DisputaJugada = {
  cliente: ClienteRow;
  /** Fila del movimiento que se disputa (tickets_apuestas). */
  jugada_id: string | number;
  jugada_origen?: string | null;
  hipodromo: string;
  carrera: number;
  monto: number;
  motivo: string;
  image?: File | null;
};

/**
 * "Disputar jugada" — crea un ticket de disputa (tipo DISPUTA) referenciando
 * el movimiento real (jugada_id) y adjuntando la imagen pegada con Ctrl+V
 * (subida al bucket `reclamos`). El admin lo atiende desde la consola Tickets.
 */
export async function disputarJugada(datos: DisputaJugada): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    let imagen: string | null = null;
    if (datos.image) {
      const up = await guardarImagenReclamo(datos.cliente.id, datos.image);
      if (up.error) return { ok: false, error: `Imagen: ${up.error}` };
      imagen = up.url ?? null;
    }
    const { error } = await supabase.from("tickets_jugadas").insert([
      {
        cliente_id: datos.cliente.id,
        cliente_nombre: datos.cliente.nombre || datos.cliente.seudonimo,
        tipo_jugada: "DISPUTA",
        jugada_id: String(datos.jugada_id),
        jugada_origen: datos.jugada_origen ?? null,
        fecha_jugada: new Date().toISOString().slice(0, 10),
        hipodromo: datos.hipodromo,
        carrera: datos.carrera || 0,
        monto: datos.monto || 0,
        motivo: datos.motivo,
        imagen_soporte: imagen,
        estado: "EN_REVISION",
        creado_por: "portal",
      },
    ]);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Solicitudes de compra de tablas fijas (el admin valida)
// ---------------------------------------------------------------------------

export type CompraTabla = {
  cliente: ClienteRow;
  tablaId: string | number;
  hipodromo: string;
  carrera: number;
  ejemplarNumero: string;
  ejemplarNombre: string;
  cantidad: number;
  premioPorTabla: number;
  ptsEjemplar?: number;
  moneda?: string;
  costoUsd?: number;
};

export async function solicitarCompraTabla(d: CompraTabla): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    const { error } = await supabase.from("solicitudes_tablas").insert([
      {
        cliente_id: d.cliente.id,
        cliente_nombre: d.cliente.nombre || d.cliente.seudonimo,
        tabla_id: d.tablaId,
        hipodromo: d.hipodromo,
        carrera: d.carrera,
        ejemplar_numero: d.ejemplarNumero,
        ejemplar_nombre: d.ejemplarNombre,
        cantidad: d.cantidad,
        pts_ejemplar: d.ptsEjemplar ?? null,
        premio_por_tabla: d.premioPorTabla,
        moneda: d.moneda ?? "USD",
        costo_usd: d.costoUsd ?? null,
        monto_total: d.costoUsd != null ? d.costoUsd * d.cantidad : null,
      },
    ]);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Actualización de datos (notifica al admin)
// ---------------------------------------------------------------------------

export async function actualizarDatosCliente(
  cliente: ClienteRow,
  datos: Partial<Pick<ClienteRow, "telefono" | "codigo_pais" | "email" | "cedula_rif" | "direccion" | "metodo_pago">>
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    const { error } = await supabase.from("notificaciones").insert([
      {
        tipo: "portal_datos",
        titulo: "El cliente actualizó sus datos",
        mensaje: `Solicitud de actualización enviada el ${new Date().toLocaleString("es-VE")}.`,
        cliente_id: cliente.id,
        cliente_nombre: cliente.nombre || cliente.seudonimo,
        datos: datos as unknown as Record<string, unknown>,
        estado: "Nueva",
      },
    ]);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}