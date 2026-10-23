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
import { supabase } from "@/core/supabase";
import { resumenDatosPago, type DatosPago } from "@/shared/lib/vzla";
import { exigirCapacidad, esPrincipalVigente, grupoActivoVigente, grupoVigente } from "@/features/seguridad/lib/vigente";
import { resumenFormasPago, type FormaPago } from "@/features/clientes/lib/formasPago";
// Múltiples formas de pago (PROMPT #7). Se re-exportan desde acá para que el
// CRUD de clientes sea el único punto de entrada de "cómo se paga un cliente";
// la implementación pura vive en `formasPago.ts` (sin Supabase, testeable).
export {
  formasPagoDe,
  formaPagoPrincipal,
  normalizarFormasPago,
  nuevaFormaPago,
  resumenFormaPago,
  resumenFormasPago,
  MONEDAS_PAGO,
  type FormaPago,
} from "@/features/clientes/lib/formasPago";

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
  /**
   * UNA o MÁS formas de pago (PROMPT #7). Arreglo jsonb
   * `[{ metodo, moneda, principal, datos }]` (sql/formas_pago_clientes.sql).
   * Puede venir null o vacío en clientes previos a la migración: en ese caso
   * manda el par legacy `metodo_pago` + `datos_pago` (ver `formasPagoDe`).
   */
  formas_pago?: unknown;
  grupo_id?: string | number | null;
  portal_habilitado?: boolean | null;
  portal_token?: string | null;
  portal_clave?: string | null;
  /** Override tri-estado por modalidad: null = hereda la configuración del grupo. */
  cruce_mismo_ejemplar?: boolean | null;
  cruce_diferente_ejemplar?: boolean | null;
  /** Campo legado; se conserva para leer clientes anteriores a la migración. */
  permite_cruces?: boolean | null;
  /** Comisión propia del cliente; si es null/absente usa la del grupo. */
  comision?: number | string | null;
  comision_personalizada?: boolean | null;
};

/** Socio que puede asignarse a un cliente. */
export type SocioRef = {
  id: string | number;
  nombre?: string | null;
  seudonimo?: string | null;
};

/**
 * Modos de juego. `cuadre` lo escribe la RPC `club_registrar_cliente_grupo`
 * (paquete_pendientes.sql:1191) y el legacy; si no está en esta lista, esos
 * clientes se muestran como "Aval" y guardar desde el modal les cambia el modo.
 */
export const MODO_JUEGO_OPCIONES = [
  { value: "aval", label: "Con Aval" },
  { value: "libre", label: "Libre" },
  { value: "pozo", label: "Pozo" },
  { value: "cuadre", label: "Cuadre" },
] as const;

/** Etiqueta legible de un modo de juego, con fallback al valor guardado. */
export function etiquetaModoJuego(modo: string | null | undefined): string {
  const v = String(modo ?? "").trim();
  return MODO_JUEGO_OPCIONES.find((m) => m.value === v)?.label ?? (v || "Aval");
}

/**
 * Valor canónico a guardar en `clientes.socio_asignado`: el ID del socio.
 *
 * Históricamente este campo guardaba el NOMBRE (modal de edición) o el
 * PSEUDÓNIMO (alta), según el formulario. Ese descuadre hacía que el `<select>`
 * no mostrara el valor ya guardado y que, al guardar, se persistiera `null`
 * borrando la relación en silencio. Ahora se guarda siempre el id, y
 * `resolverSocio` sigue aceptando los valores legacy para no perderlos.
 */
export function valorSocioAsignado(socio: SocioRef | null | undefined): string | null {
  if (!socio) return null;
  return String(socio.id);
}

/**
 * Resuelve el valor guardado en `socio_asignado` al socio correspondiente.
 * Acepta el id canónico y los valores legacy (nombre o seudónimo, con o sin
 * tildes y sin distinguir mayúsculas) para que editar no desasigne al socio.
 */
export function resolverSocio(
  valor: string | null | undefined,
  socios: SocioRef[]
): SocioRef | null {
  const v = String(valor ?? "").trim();
  if (!v) return null;
  const igual = (a: string | null | undefined) =>
    String(a ?? "").trim().toUpperCase() === v.toUpperCase();
  return (
    socios.find((s) => String(s.id) === v) ??
    socios.find((s) => igual(s.nombre)) ??
    socios.find((s) => igual(s.seudonimo)) ??
    null
  );
}

export type TicketApuesta = {
  id: string | number;
  /**
   * Timestamp real del ticket. La tabla `tickets_apuestas` no tiene
   * `created_at`, asi que el agrupamiento por semana/dia del estado de cuenta
   * debe leer esta columna.
   */
  fecha_registro?: string | null;
  /**
   * Fecha de la CARRERA (columna `fecha_carrera`). Es la que usan el monitor y
   * los reportes; `fecha_registro` es el momento de la venta. Puede venir null
   * en filas heredadas, por eso los reportes caen a `fecha_registro`.
   */
  fecha_carrera?: string | null;
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
  /** Bandera de auditoría: `true` si la jugada fue anulada (capital devuelto). */
  anulada?: boolean | null;
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
  /**
   * Fecha de creación del reclamo. En `tickets_jugadas` la columna se llama
   * `creado_at` (no `created_at`); se dejan las dos por compatibilidad de lectura.
   */
  creado_at?: string | null;
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
  /** Ejemplar(es) de la solicitud de "jugada no relacionada". */
  ejemplares?: string | null;
  /** Explicación que escribió el jugador (solicitud de jugada no relacionada). */
  explicacion?: string | null;
  imagen_soporte?: string | null;
  estado?: string | null;
  respuesta_casa?: string | null;
  accion_aplicada?: string | null;
  monto_resuelto?: number | string | null;
  aprobado_por?: string | null;
  aprobado_at?: string | null;
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
let cacheClientesGrupo: string | null | undefined = undefined;
let ultimoErrorClientes: string | null = null;

/** Último error al leer la cartera, para distinguir "vacío" de "sin permisos". */
export function errorClientes(): string | null {
  return ultimoErrorClientes;
}

/**
 * Grupo que se está mirando para la cartera. Para un usuario normal es null
 * (el aislamiento lo hace el RLS de la base). Para el super administrador es el
 * grupo elegido en el selector, o null = "todos".
 */
function grupoParaFiltrar(): string | null {
  return grupoActivoVigente();
}

export async function listarClientes(force = false, grupoIdOverride?: string | null): Promise<ClienteRow[]> {
  const activoBase = grupoParaFiltrar();
  const activo = grupoIdOverride != null && grupoIdOverride !== "" ? grupoIdOverride : activoBase;
  // La caché se invalida sola cuando cambia el grupo que se está mirando: si no,
  // elegir "ARGENTINA" después de "todos" mostraría la lista vieja.
  if (cacheClientes && !force && cacheClientesGrupo === activo) return cacheClientes;
  let lista: ClienteRow[] = [];
  ultimoErrorClientes = null;
  if (supabase) {
    try {
      let q = supabase.from("clientes").select("*").order("nombre");
      if (activo) q = q.eq("grupo_id", activo);
      const { data, error } = await q;
      if (error) throw error;
      lista = (data ?? []) as ClienteRow[];
    } catch (e) {
      // Antes se devolvía [] en silencio y la cartera aparentaba estar vacía
      // cuando en realidad era un fallo de permisos o de red.
      ultimoErrorClientes = e instanceof Error ? e.message : String(e);
      lista = [];
    }
  } else {
    ultimoErrorClientes = "Sin conexión a Supabase";
  }
  cacheClientes = lista;
  cacheClientesGrupo = activo;
  return lista;
}

export function limpiarCacheClientes(): void {
  cacheClientes = null;
  cacheClientesGrupo = undefined;
}

export async function crearCliente(payload: Partial<ClienteRow>): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    exigirCapacidad("clientes:fn_guardar_cliente");
    // Mismo filtro que en la edición: sin ser principal no se crea a nadie
    // dentro de un grupo de venta, aunque el parche lo pida.
    const { error } = await supabase
      .from("clientes")
      .insert([sinCamposDelPrincipal(payload as Record<string, unknown>) as Partial<ClienteRow>]);
    if (error) {
      const pideCruces = "cruce_mismo_ejemplar" in payload || "cruce_diferente_ejemplar" in payload;
      return {
        ok: false,
        error: pideCruces && /column|PGRST204|42703/i.test(error.message)
          ? `${error.message} Aplique sql/permite_cruces_jerarquia.sql en Supabase.`
          : error.message,
      };
    }
    limpiarCacheClientes();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Saca del parche los campos que solo puede mover el usuario principal.
 *
 * `grupo_id` es la excepción: no es una capacidad del RBAC sino una atribución
 * del dueño. El filtro va AQUÍ, no solo en el formulario, porque estas funciones
 * se llaman con la llave del navegador y cualquiera puede armar el parche a mano
 * desde la consola. Un operador que no puede ver el selector igual podría
 * mandar `grupo_id: null` y sacar al cliente del grupo de un tercero.
 */
export function sinCamposDelPrincipal(
  patch: Record<string, unknown>,
  esPrincipal = esPrincipalVigente()
): Record<string, unknown> {
  if (esPrincipal) return patch;
  // Un usuario CON grupo no puede elegir a qué grupo va el cliente: siempre es
  // el suyo. Esto no es solo cosmético: la policy de `clientes` exige que la
  // fila quede en el grupo del usuario (sql/rls_por_grupo.sql), así que mandar
  // otro `grupo_id` (o ninguno) haría rebotar el alta en la base.
  const yo = grupoVigente();
  if (yo) return { ...patch, grupo_id: yo };
  // Sin grupo asignado (ve todo): no se le deja inventar uno.
  const { grupo_id: _omitido, ...resto } = patch;
  return resto;
}

import { limpiarCacheClientesVenta } from "@/features/grupos/lib/grupos";

function limpiarCachéClientesTodo(): void {
  limpiarCacheClientes();
  try { limpiarCacheClientesVenta(); } catch {}
}

export async function actualizarCliente(
  id: string | number,
  patch: Record<string, unknown>,
  fila?: ClienteRow | null
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    exigirCapacidad("clientes:fn_guardar_cliente");
    const crucesPedidas = ["cruce_mismo_ejemplar", "cruce_diferente_ejemplar"]
      .filter((campo) => campo in patch);
    if (fila && crucesPedidas.some((campo) => !(campo in fila))) {
      return {
        ok: false,
        error: "No se pueden guardar reglas de cruce: aplique sql/permite_cruces_jerarquia.sql en Supabase y vuelva a cargar el cliente.",
      };
    }
    const seguro = soloColumnasExistentes(sinCamposDelPrincipal(patch), fila);
    if (seguro && Object.keys(seguro).length === 0) {
      return { ok: false, error: "No hay campos a guardar (revisa los permisos o el cliente editado)." };
    }
    const { data, error } = await supabase.from("clientes").update(seguro).eq("id", id).select("id");
    if (error) return { ok: false, error: error.message };
    if (!data || data.length === 0) {
      return { ok: false, error: "No se actualizó ninguna fila. Posible: otro grupo, permisos insuficientes o RLS bloqueando." };
    }
    limpiarCachéClientesTodo();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function eliminarCliente(id: string | number): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    exigirCapacidad("clientes:fn_eliminar_cliente");
    const { data, error } = await supabase.from("clientes").delete().eq("id", id).select("id");
    if (error) return { ok: false, error: error.message };
    if (!data || data.length === 0) {
      return { ok: false, error: "No se eliminó ninguna fila. Posible: otro grupo, permisos insuficientes o RLS bloqueando." };
    }
    limpiarCachéClientesTodo();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Devoluciones masivas: aplica un % a la lista dada de ids. */
export async function aplicarDevolucionMasiva(ids: (string | number)[], pct: number): Promise<{ ok: boolean; error?: string; afectados?: number }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    exigirCapacidad("clientes:modal_reclamos");
    if (!ids.length) return { ok: false, error: "Sin clientes seleccionados." };
    if (Number.isNaN(pct) || pct < 0 || pct > 100) return { ok: false, error: "El porcentaje debe estar entre 0 y 100." };
    const { data, error } = await supabase.from("clientes").update({ devolucion: pct }).in("id", ids).select("id");
    if (error) return { ok: false, error: error.message };
    if (!data || data.length === 0) {
      return { ok: false, error: "No se actualizó ninguna fila (ver permisos, grupo o RLS)." };
    }
    limpiarCachéClientesTodo();
    return { ok: true, afectados: data.length };
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
      // Sin seudónimo el socio quedaba con "—" y no aparecía en la venta de
      // tablas, que identifica al jugador por seudónimo.
      const { error } = await supabase
        .from("clientes")
        .insert([{ nombre, seudonimo: nombre, es_socio: true, modo_juego: "aval" }]);
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

/**
 * Prefijo bajo el que está desplegada la app (`/sistema_hipico` en GitHub Pages,
 * `""` en dev o en la raíz). Next NO expone el `basePath` como variable de
 * entorno del cliente, así que se DEDUCE de la ruta actual: la página del portal
 * siempre termina en `/portal`, y todo lo anterior es el prefijo. Si la ruta no
 * termina en `/portal` (por ejemplo se llama desde otra pantalla), se cae al
 * `basePath` heredado del documento o, en último caso, a raíz.
 */
export function basePathActual(): string {
  if (typeof window === "undefined") return "";
  const p = window.location.pathname.replace(/\/+$/, "");
  const i = p.lastIndexOf("/portal");
  if (i >= 0) return p.slice(0, i);
  return "";
}

/** Ruta del portal en la SPA (se conserva `?c=&k=` para compat con el legacy). */
export function urlPortal(): string {
  if (typeof window === "undefined") return "/portal";
  return `${window.location.origin}${basePathActual()}/portal`;
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
      exigirCapacidad("clientes:fn_guardar_cliente");
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
  // El portal puede mandar varias formas de pago a la vez (PROMPT #7): se
  // listan completas, con la ⭐ principal primero.
  if (Array.isArray(d.formas_pago)) {
    const r = resumenFormasPago(d.formas_pago as FormaPago[]);
    if (r) partes.push(`<b>Formas de pago:</b> ${r}`);
  }
  return partes.length ? partes.join(" · ") : n.mensaje || "Solicitud de actualización de datos.";
}

/** Aplica los datos de la notificación al cliente y la marca como Aplicada. */
export async function aplicarNotificacion(n: NotificacionRow, atendidaPor: string): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    exigirCapacidad("clientes:modal_reclamos");
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const d = (n.datos ?? {}) as Record<string, unknown>;
  const payload: Record<string, unknown> = {};
  if (d.telefono) payload.telefono = d.telefono;
  if (d.codigo_pais) payload.codigo_pais = d.codigo_pais;
  if (d.email) payload.email = d.email;
  if (d.cedula_rif) payload.cedula_rif = d.cedula_rif;
  if (d.direccion) payload.direccion = d.direccion;
  if (d.metodo_pago) payload.metodo_pago = d.metodo_pago;
  if (d.datos_pago) payload.datos_pago = d.datos_pago;
  // Arreglo completo de formas de pago (PROMPT #7): al aplicar la solicitud
  // quedan las que el cliente pidió y la ⭐ principal sigue emparejando el par
  // legacy `metodo_pago`/`datos_pago` para los lectores de una sola forma.
  if (Array.isArray(d.formas_pago)) payload.formas_pago = d.formas_pago;
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
    // OJO: la tabla tickets_jugadas tiene `creado_at`, NO `created_at`
    // (verificado en sql/paquete_pendientes.sql). Pedir `created_at` hacía
    // fallar el order y la bandeja salía SIEMPRE vacía, aunque hubiera reclamos.
    const { data, error } = await supabase
      .from("tickets_jugadas")
      .select("*")
      .order("creado_at", { ascending: false })
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

/**
 * Aprueba una solicitud de "jugada no relacionada" (tipo SOLICITUD_JUGADA):
 * inserta la jugada real como ticket y marca el reclamo como APROBADO.
 *
 * Reutiliza las RPC de venta (las mismas de la taquilla) con `p_cliente_id` y
 * `p_grupo_id` del jugador. Si la "jugada" es solo informativa (no hay tabla ni
 * polla que vender), el admin puede dejar el ticket en estado Pendiente con el
 * monto y la descripción: se registra un ticket de tipo MANUAL.
 */
export async function aprobarSolicitudJugada(
  r: ReclamoRow,
  opts: { grupoId: string; usuario: string; ajustarMonto?: number | null }
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    exigirCapacidad("clientes:modal_reclamos");
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const monto = Math.max(0, opts.ajustarMonto != null ? opts.ajustarMonto : num(r.monto));
  const tipo = (r.tipo_jugada ?? "").toUpperCase();
  try {
    // Tablas, Marcas y Dupletas tienen RPC de venta con cliente+grupo explícitos;
    // la solicitud del portal no siempre trae el `tabla_id`, así que cuando no se
    // puede vender por RPC se registra el ticket directo (flujo del admin).
    const { error } = await supabase.from("tickets_apuestas").insert([
      {
        fecha_registro: new Date().toISOString(),
        fecha_carrera: r.fecha_jugada ?? null,
        hipodromo: String(r.hipodromo ?? "").toUpperCase(),
        carrera: num(r.carrera) || null,
        nombre_jugada: `${tipo || "JUGADA"} ${r.ejemplares ?? ""}`.trim(),
        caballo: r.ejemplares ?? null,
        cantidad_tablas: 1,
        monto_jugado: monto,
        monto_decidido: 0,
        premio_pagar: 0,
        cliente_juega_id: r.cliente_id ?? null,
        cliente_juega_nombre: r.cliente_nombre ?? null,
        grupo: null,
        grupo_cobro_id: opts.grupoId,
        grupo_comision_id: opts.grupoId,
        comision_porcentaje: 0,
        comision_pagada: 0,
        estado: "Pendiente",
        moneda: "USD",
      },
    ]);
    if (error) return { ok: false, error: error.message };

    const out = await supabase
      .from("tickets_jugadas")
      .update({
        estado: "APROBADO",
        accion_aplicada: "AJUSTE",
        monto_resuelto: monto,
        aprobado_por: opts.usuario,
        aprobado_at: new Date().toISOString(),
        respondido_por: opts.usuario,
        respondido_at: new Date().toISOString(),
      })
      .eq("id", r.id);
    if (out.error) return { ok: false, error: out.error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** ¿El reclamo es una solicitud de "jugada no relacionada"? */
export function esSolicitudJugada(r: ReclamoRow): boolean {
  return String(r.tipo_jugada ?? "").toUpperCase() === "SOLICITUD_JUGADA";
}

/**
 * Grupo del cliente dueño del reclamo. La solicitud trae `cliente_id`, pero no
 * el grupo; se lee de la fila del cliente para poder atribuir la jugada que se
 * inserte al aprobar. Devuelve "" si el cliente no está asignado a un grupo
 * (el admin puede elegir el grupo activo entonces).
 */
export async function grupoDeCliente(clienteId: string | number | null | undefined): Promise<string> {
  if (!supabase || clienteId == null) return "";
  try {
    const { data, error } = await supabase
      .from("clientes")
      .select("grupo_id")
      .eq("id", clienteId)
      .maybeSingle();
    if (error) return "";
    const g = (data as { grupo_id?: string | null } | null)?.grupo_id;
    return g ? String(g) : "";
  } catch {
    return "";
  }
}

/**
 * Rechaza una solicitud de "jugada no relacionada": deja la respuesta al jugador
 * y marca el reclamo como RECHAZADO. No toca la jugada (justamente porque no se
 * incluye).
 */
export async function rechazarSolicitudJugada(
  r: ReclamoRow,
  respuesta: string,
  usuario: string
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    exigirCapacidad("clientes:modal_reclamos");
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const { error } = await supabase
    .from("tickets_jugadas")
    .update({
      estado: "RECHAZADO",
      accion_aplicada: "RECHAZO",
      respuesta_casa: respuesta || null,
      respondido_por: usuario,
      respondido_at: new Date().toISOString(),
    })
    .eq("id", r.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
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
  /** Fecha de la carrera (YYYY-MM-DD), para el reporte diario. */
  fechaCarrera: string | null;
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
    // Una jugada ANULADA se devolvió: no suma ni resta en el estado de cuenta.
    // Se listan igual (con su estado) pero su base y su devolución van en 0.
    const anulada = t.anulada === true;
    const baseVigente = anulada ? 0 : base;
    const dec = baseVigente * (devolucionPct / 100);
    const moneda = (t.moneda ?? "USD").toUpperCase();
    const grupo = t.grupo_cobro_nombre || "Directo";
    const semana = claveSemana(t.fecha_registro);
    const dia = t.fecha_registro ? new Date(t.fecha_registro).toLocaleDateString("es-VE", { dateStyle: "short" }) : "—";
    const hipodromo = String(t.hipodromo ?? "—").toUpperCase();
    const carrera = num(t.carrera) || 0;

    const jugada: JugadaItem = {
      id: String(t.id),
      fecha: t.fecha_registro ?? null,
      fechaTexto: fmtFechaHora(t.fecha_registro),
      fechaCarrera: t.fecha_carrera ?? null,
      hipodromo,
      carrera,
      grupo,
      semana,
      dia,
      caballo: t.caballo ?? "—",
      jugada: t.nombre_jugada ?? "Jugada",
      montoJugado: num(t.monto_jugado),
      montoDecidido: baseVigente,
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

    acumular(g, baseVigente, dec, jugada);
    acumular(s, baseVigente, dec, jugada);
    acumular(d, baseVigente, dec, jugada);
    acumular(h, baseVigente, dec, jugada);
    acumular(c, baseVigente, dec, jugada);
    raiz.monto += baseVigente;
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
    // OJO: se ordena por fecha_registro, no por created_at. La tabla
    // tickets_apuestas NO tiene created_at (verificado en vivo), asi que pedirla
    // hacia fallar la consulta entera y el catch devolvia [] en silencio: el
    // estado de cuenta salia vacio sin avisar nada.
    const { data, error } = await supabase
      .from("tickets_apuestas")
      .select(
        "id, fecha_registro, hipodromo, carrera, nombre_jugada, caballo, cantidad_tablas, monto_jugado, monto_decidido, premio_pagar, premio_por_tabla, moneda, estado, anulada, grupo_cobro_nombre, grupo_cobro_id"
      )
      .eq("cliente_juega_id", clienteId)
      .order("fecha_registro", { ascending: false })
      .limit(500);
    if (error) throw error;
    return (data ?? []) as TicketApuesta[];
  } catch {
    return [];
  }
}