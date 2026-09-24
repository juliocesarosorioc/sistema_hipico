/**
 * Gestión de Clientes (admin) — clon del legacy js/clientes.js + js/portal.js.
 *
 * Contiene:
 *  - CRUD de cartera con `soloColumnasExistentes` (evita errores 400).
 *  - Generación de token/clave del Portal y enlace corto (is.gd con fallback).
 *  - Notificaciones del portal (solicitudes de datos + reclamos como alertas).
 *  - Estado de cuenta dinámico: jerarquía Grupo > Semana > Día > Hipódromo > Carrera > Jugada,
 *    con la línea destacada "Devolución / Incentivo" basada en el monto decidido/jugado.
 */
import { supabase } from "@/lib/supabase";
import { resumenDatosPago, type DatosPago } from "@/lib/vzla";

export type ClienteRow = {
  id: string | number;
  nombre?: string | null;
  seudonimo?: string | null;
  apellido?: string | null;
  telefono?: string | null;
  codigo_pais?: string | null;
  email?: string | null;
  cedula_rif?: string | null;
  direccion?: string | null;
  modo_juego?: string | null;
  libre?: boolean | null;
  es_socio?: boolean | null;
  aval?: number | string | null;
  saldo_actual?: number | string | null;
  devolucion?: number | string | null;
  socio_asignado?: string | null;
  mostrar_saldo_socio?: boolean | null;
  metodo_pago?: string | null;
  dia_cuadre?: string | null;
  forma_cuadre?: string | null;
  tasa_cuadre?: number | string | null;
  datos_pago?: DatosPago | null;
  grupo_id?: string | number | null;
  portal_habilitado?: boolean | null;
  portal_token?: string | null;
  portal_clave?: string | null;
};

export type TicketApuesta = {
  id: string | number;
  created_at?: string | null;
  hipodromo?: string | null;
  carrera?: number | string | null;
  nombre_jugada?: string | null;
  caballo?: string | null;
  cantidad_tablas?: number | string | null;
  monto_jugado?: number | string | null;
  monto_decidido?: number | string | null;
  premio_pagar?: number | string | null;
  premio_por_tabla?: number | string | null;
  moneda?: string | null;
  estado?: string | null;
  grupo_cobro_nombre?: string | null;
  grupo_cobro_id?: string | number | null;
};

export type NotificacionRow = {
  id: string | number;
  created_at?: string | null;
  tipo?: string | null;
  titulo?: string | null;
  mensaje?: string | null;
  cliente_id?: string | number | null;
  cliente_nombre?: string | null;
  datos?: unknown;
  estado?: string | null;
  atendida_por?: string | null;
  atendida_at?: string | null;
};

/** Reclamos del portal (tickets_jugadas) que se muestran como alertas en admin. */
export type ReclamoRow = {
  id: string | number;
  created_at?: string | null;
  numero_ticket?: number | string | null;
  cliente_id?: string | number | null;
  cliente_nombre?: string | null;
  jugada_origen?: string | null;
  jugada_id?: string | null;
  tipo_jugada?: string | null;
  fecha_jugada?: string | null;
  hipodromo?: string | null;
  carrera?: number | string | null;
  monto?: number | string | null;
  motivo?: string | null;
  imagen_soporte?: string | null;
  estado?: string | null;
  respuesta_casa?: string | null;
  accion_aplicada?: string | null;
  monto_resuelto?: number | string | null;
  creado_por?: string | null;
};

// ---------------------------------------------------------------------------
// Helpers locales
// ---------------------------------------------------------------------------

const num = (v: number | string | null | undefined): number => {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};

/** Filtra el payload a las columnas que existen realmente en la fila (evita 400). */
export function soloColumnasExistentes(payload: Record<string, unknown>, fila?: ClienteRow | null): Record<string, unknown> {
  if (!fila) return payload;
  const cols = new Set(Object.keys(fila));
  return Object.fromEntries(Object.entries(payload).filter(([k]) => cols.has(k)));
}

export function generarCodigo(n = 6): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let s = "";
  for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/** Fecha/hora legible (es-VE). */
export function fmtFechaHora(fecha?: string | null): string {
  if (!fecha) return "—";
  const d = new Date(fecha);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("es-VE", { dateStyle: "short", timeStyle: "short" });
}

export function fmtFecha(fecha?: string | null): string {
  if (!fecha) return "—";
  const d = new Date(fecha);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("es-VE", { dateStyle: "short" });
}

// ---------------------------------------------------------------------------
// Cartera de clientes (CRUD)
// ---------------------------------------------------------------------------

let cacheClientes: ClienteRow[] | null = null;

export async function listarClientes(force = false): Promise<ClienteRow[]> {
  if (cacheClientes && !force) return cacheClientes;
  let lista: ClienteRow[] = [];
  if (supabase) {
    try {
      const { data, error } = await supabase.from("clientes").select("*").order("nombre");
      if (error) throw error;
      lista = (data ?? []) as ClienteRow[];
    } catch {
      lista = [];
    }
  }
  cacheClientes = lista;
  return lista;
}

export function limpiarCacheClientes(): void {
  cacheClientes = null;
}

export async function crearCliente(payload: Partial<ClienteRow>): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    const { error } = await supabase.from("clientes").insert([payload as Record<string, unknown>]);
    if (error) return { ok: false, error: error.message };
    limpiarCacheClientes();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function actualizarCliente(
  id: string | number,
  patch: Record<string, unknown>,
  fila?: ClienteRow | null
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    const { error } = await supabase.from("clientes").update(soloColumnasExistentes(patch, fila)).eq("id", id);
    if (error) return { ok: false, error: error.message };
    limpiarCacheClientes();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function eliminarCliente(id: string | number): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    const { error } = await supabase.from("clientes").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    limpiarCacheClientes();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Devoluciones masivas: aplica un % a la lista dada de ids. */
export async function aplicarDevolucionMasiva(ids: (string | number)[], pct: number): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    const { error } = await supabase.from("clientes").update({ devolucion: pct }).in("id", ids);
    if (error) return { ok: false, error: error.message };
    limpiarCacheClientes();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Convierte/crea un socio (misma regla del legacy: si existe, solo marca es_socio). */
export async function convertirSocio(nombre: string): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    const existente = await listarClientes(true);
    const ya = existente.find((c) => String(c.nombre).toUpperCase() === nombre);
    if (ya) {
      const { error } = await supabase.from("clientes").update({ es_socio: true }).eq("id", ya.id);
      if (error) return { ok: false, error: error.message };
    } else {
      const { error } = await supabase.from("clientes").insert([{ nombre, es_socio: true }]);
      if (error) return { ok: false, error: error.message };
    }
    limpiarCacheClientes();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Portal de consulta del cliente (token + clave + enlace)
// ---------------------------------------------------------------------------

/** Ruta del portal en la SPA (se conserva `?c=&k=` para compat con el legacy). */
export function urlPortal(): string {
  if (typeof window === "undefined") return "/portal";
  return `${window.location.origin}/portal`;
}

/** Enlace largo del portal para un cliente. */
export function enlacePortalLargo(id: string | number, token: string): string {
  return `${urlPortal()}?c=${encodeURIComponent(String(id))}&k=${encodeURIComponent(token)}`;
}

/** Acorta un enlace con is.gd; si falla devuelve el enlace largo. */
export async function acortarEnlace(larga: string): Promise<string> {
  try {
    const r = await fetch("https://is.gd/create.php?format=simple&url=" + encodeURIComponent(larga));
    if (!r.ok) return larga;
    const txt = (await r.text()).trim();
    return txt.startsWith("http") ? txt : larga;
  } catch {
    return larga;
  }
}

/** Guarda (o regenera) token/clave/habilitado del portal de un cliente. */
export async function guardarPortal(
  id: string | number,
  datos: { portal_habilitado: boolean; portal_token: string; portal_clave: string },
  fila?: ClienteRow | null
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  const payload = soloColumnasExistentes(datos as unknown as Record<string, unknown>, fila);
  const faltan = Object.keys(datos).filter((k) => !(k in payload));
  if (datos.portal_habilitado && faltan.length) {
    return { ok: false, error: `Faltan columnas del portal (${faltan.join(", ")}). Ejecute sql/portal_cuadre.sql.` };
  }
  try {
    const { error } = await supabase.from("clientes").update(payload).eq("id", id);
    if (error) return { ok: false, error: error.message };
    limpiarCacheClientes();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Notificaciones del portal (solicitudes de actualización de datos)
// ---------------------------------------------------------------------------

export async function listarNotificaciones(limite = 40): Promise<NotificacionRow[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("notificaciones")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limite);
    if (error) throw error;
    return (data ?? []) as NotificacionRow[];
  } catch {
    return [];
  }
}

/** Resumen de una notificación de datos (teléfono, email, método, etc.). */
export function resumenNotificacion(n: NotificacionRow): string {
  const d = (n.datos ?? {}) as Record<string, unknown>;
  const partes: string[] = [];
  const etiqueta = (k: string): string =>
    ({ telefono: "Tlf", email: "Email", cedula_rif: "Cédula/RIF", direccion: "Dirección", metodo_pago: "Método", codigo_pais: "País" })[k] ?? k;
  (["telefono", "email", "cedula_rif", "direccion", "metodo_pago"] as const).forEach((k) => {
    if (d[k]) partes.push(`<b>${etiqueta(k)}:</b> ${String(d[k])}`);
  });
  if (d.datos_pago && typeof d.datos_pago === "object") {
    const r = resumenDatosPago(d.datos_pago as DatosPago);
    if (r) partes.push(`<b>Detalle pago:</b> ${r}`);
  }
  return partes.length ? partes.join(" · ") : n.mensaje || "Solicitud de actualización de datos.";
}

/** Aplica los datos de la notificación al cliente y la marca como Aplicada. */
export async function aplicarNotificacion(n: NotificacionRow, atendidaPor: string): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  const d = (n.datos ?? {}) as Record<string, unknown>;
  const payload: Record<string, unknown> = {};
  if (d.telefono) payload.telefono = d.telefono;
  if (d.codigo_pais) payload.codigo_pais = d.codigo_pais;
  if (d.email) payload.email = d.email;
  if (d.cedula_rif) payload.cedula_rif = d.cedula_rif;
  if (d.direccion) payload.direccion = d.direccion;
  if (d.metodo_pago) payload.metodo_pago = d.metodo_pago;
  if (d.datos_pago) payload.datos_pago = d.datos_pago;
  try {
    const fila = (await listarClientes(true)).find((c) => String(c.id) === String(n.cliente_id)) ?? null;
    const { error } = await supabase
      .from("clientes")
      .update(soloColumnasExistentes(payload, fila))
      .eq("id", n.cliente_id as string);
    if (error) return { ok: false, error: error.message };
    await supabase
      .from("notificaciones")
      .update({ estado: "Aplicada", atendida_por: atendidaPor, atendida_at: new Date().toISOString() })
      .eq("id", n.id as string);
    limpiarCacheClientes();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Marca la notificación como Ignorada. */
export async function ignorarNotificacion(n: NotificacionRow, atendidaPor: string): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    const { error } = await supabase
      .from("notificaciones")
      .update({ estado: "Ignorada", atendida_por: atendidaPor, atendida_at: new Date().toISOString() })
      .eq("id", n.id as string);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Reclamos del portal (tickets_jugadas) — alertas en admin
// ---------------------------------------------------------------------------

export async function listarReclamos(limite = 40): Promise<ReclamoRow[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("tickets_jugadas")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limite);
    if (error) throw error;
    return (data ?? []) as ReclamoRow[];
  } catch {
    return [];
  }
}

/** Responde a un reclamo y cambia su estado (EN_REVISION / SOLUCIONADO / RECHAZADO). */
export async function responderReclamo(
  id: string | number,
  patch: { estado: string; respuesta_casa?: string | null; accion_aplicada?: string | null; monto_resuelto?: number | null }
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    const { error } = await supabase
      .from("tickets_jugadas")
      .update({ ...patch, respondido_por: "Administrador", respondido_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Estado de cuenta dinámico (Admin) — acordeón jerárquico
// ---------------------------------------------------------------------------

/** Devuelve la clave de semana ISO (ej. "2026-W39") de una fecha. */
function claveSemana(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return "Sin fecha";
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dia = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dia);
  const inicio = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const semana = Math.ceil(((t.getTime() - inicio.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(semana).padStart(2, "0")}`;
}

export type JugadaItem = {
  id: string;
  fecha: string | null;
  fechaTexto: string;
  hipodromo: string;
  carrera: number;
  grupo: string;
  semana: string;
  dia: string;
  caballo: string;
  jugada: string;
  montoJugado: number;
  montoDecidido: number;
  premio: number;
  moneda: string;
  estado: string;
  /** Devolución / Incentivo calculado sobre el monto decidido/jugado. */
  devolucion: number;
};

export type NivelAcordeon = { titulo: string; subtitulo?: string; monto: number; dec: number; hijos: NivelAcordeon[]; jugadas: JugadaItem[] };

/**
 * Construye la jerarquía Grupo > Semana > Día > Hipódromo > Carrera > Jugada
 * para el estado de cuenta dinámico del cliente.
 * El "monto decidido" (monto_decidido ?? monto_jugado) es la base del cálculo.
 */
export function construirEstadoCuenta(tickets: TicketApuesta[], devolucionPct: number): NivelAcordeon {
  const raiz: NivelAcordeon = { titulo: "Total", monto: 0, dec: 0, hijos: [], jugadas: [] };

  const nodo = (titulo: string, subtitulo?: string): NivelAcordeon => ({
    titulo,
    subtitulo,
    monto: 0,
    dec: 0,
    hijos: [],
    jugadas: [],
  });

  const construir: {
    grupos: Map<string, NivelAcordeon>;
    semanas: Map<string, NivelAcordeon>;
    dias: Map<string, NivelAcordeon>;
    hipodromos: Map<string, NivelAcordeon>;
    carreras: Map<string, NivelAcordeon>;
  } = {
    grupos: new Map(),
    semanas: new Map(),
    dias: new Map(),
    hipodromos: new Map(),
    carreras: new Map(),
  };

  const acumular = (n: NivelAcordeon, base: number, dec: number, jugada: JugadaItem) => {
    n.monto += base;
    n.dec += dec;
    n.jugadas.push(jugada);
  };

  for (const t of tickets) {
    const base = t.monto_decidido != null ? num(t.monto_decidido) : num(t.monto_jugado);
    const dec = base * (devolucionPct / 100);
    const moneda = (t.moneda ?? "USD").toUpperCase();
    const grupo = t.grupo_cobro_nombre || "Directo";
    const semana = claveSemana(t.created_at);
    const dia = t.created_at ? new Date(t.created_at).toLocaleDateString("es-VE", { dateStyle: "short" }) : "—";
    const hipodromo = String(t.hipodromo ?? "—").toUpperCase();
    const carrera = num(t.carrera) || 0;

    const jugada: JugadaItem = {
      id: String(t.id),
      fecha: t.created_at ?? null,
      fechaTexto: fmtFechaHora(t.created_at),
      hipodromo,
      carrera,
      grupo,
      semana,
      dia,
      caballo: t.caballo ?? "—",
      jugada: t.nombre_jugada ?? "Jugada",
      montoJugado: num(t.monto_jugado),
      montoDecidido: base,
      premio: t.premio_pagar != null ? num(t.premio_pagar) : num(t.premio_por_tabla),
      moneda,
      estado: t.estado ?? "—",
      devolucion: dec,
    };

    // Grupo (si aplica) > Semana > Día > Hipódromo > Carrera > Jugada
    const get = (cache: Map<string, NivelAcordeon>, k: string, titulo: string, subtitulo?: string): NivelAcordeon => {
      let n = cache.get(k);
      if (!n) {
        n = nodo(titulo, subtitulo);
        cache.set(k, n);
      }
      return n;
    };

    const g = get(construir.grupos, grupo, grupo);
    const s = get(construir.semanas, `${grupo}|${semana}`, semana, "Semana");
    const d = get(construir.dias, `${grupo}|${semana}|${dia}`, dia, "Día");
    const h = get(construir.hipodromos, `${grupo}|${semana}|${dia}|${hipodromo}`, hipodromo);
    const c = get(construir.carreras, `${grupo}|${semana}|${dia}|${hipodromo}|${carrera}`, `Carrera ${carrera}`, hipodromo);

    // Enlazar solo la primera vez para evitar duplicados.
    if (g.jugadas.length === 0 && !g.hijos.some((x) => x.titulo === s.titulo && x.subtitulo === s.subtitulo)) g.hijos.push(s);
    if (!s.hijos.some((x) => x.titulo === d.titulo && x.subtitulo === d.subtitulo)) s.hijos.push(d);
    if (!d.hijos.some((x) => x.titulo === h.titulo && !x.subtitulo)) d.hijos.push(h);
    if (!h.hijos.some((x) => x.titulo === c.titulo)) h.hijos.push(c);

    acumular(g, base, dec, jugada);
    acumular(s, base, dec, jugada);
    acumular(d, base, dec, jugada);
    acumular(h, base, dec, jugada);
    acumular(c, base, dec, jugada);
    raiz.monto += base;
    raiz.dec += dec;
    raiz.jugadas.push(jugada);
  }

  raiz.hijos = [...construir.grupos.values()];
  return raiz;
}

/** Trae los tickets de apuestas de un cliente para el estado de cuenta. */
export async function cargarTicketsCliente(clienteId: string | number): Promise<TicketApuesta[]> {
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