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
import { redondearCentavos } from "@/shared/lib/dinero";
import {
  sincronizarSaldosRealesClientes,
  esJugadaPuestosParaIncentivo,
  calcularIncentivoCarreraCliente,
  calcularResultadoLiquidacionClienteCarrera,
  type ResultadoLiquidacionClienteCarrera,
} from "@/features/saldos/lib/contabilidad-central";

export {
  calcularIncentivoCarreraCliente,
  calcularResultadoLiquidacionClienteCarrera,
  type ResultadoLiquidacionClienteCarrera,
};
import { resolverContraparteModalidad } from "@/features/liquidacion/lib/etiquetas-reporte";
import { extraerFechaCarreraTicket } from "@/features/liquidacion/lib/fecha";
import {
  buscarPizarraEnMapa,
  desglosarTicketEnFilasUnificadas,
  leerPizarrasPorFechas,
  type PizarraCarrera,
} from "@/features/liquidacion/lib/reportes";
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

export type Cliente = ClienteRow;

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
  /** Resultado neto acumulado de jugadas en carrera con devolución incluida */
  resultado?: number | string | null;
  resultado_acumulado?: number | string | null;
  /** Saldo disponible total para jugar considerando aval */
  disponible?: number | string | null;
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
  cliente_juega_id?: string | number | null;
  cliente_juega_nombre?: string | null;
  cliente_consigue_id?: string | number | null;
  cliente_consigue_nombre?: string | null;
  banquero_cliente_id?: string | number | null;
  banquero_nombre?: string | null;
  comision_porcentaje?: number | string | null;
  comision_pagada?: number | string | null;
  nota_auditoria?: unknown;
  ejemplar_numero?: number | string | null;
  es_adelantada?: boolean | null;
  _pizarra?: PizarraCarrera | null;
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
 * Grupo que se está mirando para la cartera.
 * Para un usuario de grupo: estrictamente su propio grupo.
 * Para el super administrador: estrictamente el grupo seleccionado.
 */
function grupoParaFiltrar(): string | null {
  if (!esPrincipalVigente()) {
    return grupoVigente() || null;
  }
  return grupoActivoVigente();
}

export function credencialesPortalPorDefecto(c: Pick<ClienteRow, "id" | "portal_habilitado" | "portal_token" | "portal_clave">): {
  portal_habilitado: boolean;
  portal_token: string;
  portal_clave: string;
} {
  const idClean = String(c.id ?? "0").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 6) || "0001";
  const token = String(c.portal_token ?? "").trim() || `TK${idClean}`;
  const clave = String(c.portal_clave ?? "").trim() || `CL${idClean}`;
  return {
    portal_habilitado: c.portal_habilitado !== false,
    portal_token: token,
    portal_clave: clave,
  };
}

export async function listarClientes(force = false, grupoIdOverride?: string | null): Promise<ClienteRow[]> {
  let activo = grupoIdOverride != null && grupoIdOverride !== "" ? grupoIdOverride : grupoParaFiltrar();

  // AISLAMIENTO ESTRICTO:
  // 1. Un grupo no puede ver los usuarios/clientes de otro.
  if (!esPrincipalVigente()) {
    const miGrupo = grupoVigente();
    if (miGrupo) activo = miGrupo;
    if (!activo) return [];
  }

  // 2. El principal SOLO puede ver los usuarios/clientes del grupo seleccionado.
  if (esPrincipalVigente() && !activo && supabase) {
    try {
      const { data: gData } = await supabase
        .from("grupos_venta")
        .select("id")
        .eq("activo", true)
        .order("es_principal", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (gData?.id) {
        activo = String(gData.id);
      }
    } catch {
      /* ignore */
    }
  }

  // Si aún no hay grupo seleccionado o asignado, no mostrar clientes de otros grupos
  if (!activo) return [];

  // La caché se invalida sola cuando cambia el grupo que se está mirando
  if (cacheClientes && !force && cacheClientesGrupo === activo) return cacheClientes;
  let lista: ClienteRow[] = [];
  ultimoErrorClientes = null;
  if (supabase) {
    try {
      // Filtrar SIEMPRE por el grupo_id activo
      const q = supabase.from("clientes").select("*").eq("grupo_id", activo).order("nombre");
      const { data, error } = await q;
      if (error) throw error;
      lista = (await sincronizarSaldosRealesClientes(
        ((data ?? []) as ClienteRow[]).map((c) => {
          const creds = credencialesPortalPorDefecto(c);
          return {
            ...c,
            saldo_actual: c.saldo_actual != null ? redondearCentavos(c.saldo_actual) : 0,
            aval: c.aval != null ? redondearCentavos(c.aval) : 0,
            portal_habilitado: creds.portal_habilitado,
            portal_token: creds.portal_token,
            portal_clave: creds.portal_clave,
          };
        }),
        activo
      )) as ClienteRow[];
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

export async function crearCliente(payload: Partial<ClienteRow>): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    exigirCapacidad("clientes:fn_guardar_cliente");
    const procesado = sinCamposDelPrincipal(payload as Record<string, unknown>) as Partial<ClienteRow>;
    const nombreNorm = String(procesado.nombre ?? "").trim().toUpperCase();
    if (!nombreNorm) {
      return { ok: false, error: "El nombre del cliente es obligatorio." };
    }
    const grupoDestino = procesado.grupo_id != null ? String(procesado.grupo_id) : (grupoActivoVigente() || grupoVigente() || null);
    const existentes = await listarClientes(true, grupoDestino);
    const duplicado = existentes.find((c) => {
      const mismoGrupo = !grupoDestino || !c.grupo_id || String(c.grupo_id) === String(grupoDestino);
      if (!mismoGrupo) return false;
      return String(c.nombre ?? "").trim().toUpperCase() === nombreNorm;
    });
    if (duplicado) {
      return {
        ok: false,
        error: `⚠️ Ya existe el cliente "${nombreNorm}" en este grupo. No puede haber dos clientes iguales en el mismo grupo.`,
      };
    }
    const { data, error } = await supabase
      .from("clientes")
      .insert([{ ...procesado, nombre: nombreNorm }])
      .select("id")
      .maybeSingle();
    if (error) {
      const pideCruces = "cruce_mismo_ejemplar" in payload || "cruce_diferente_ejemplar" in payload;
      return {
        ok: false,
        error: pideCruces && /column|PGRST204|42703/i.test(error.message)
          ? `${error.message} Aplique sql/permite_cruces_jerarquia.sql en Supabase.`
          : error.message,
      };
    }
    limpiarCachéClientesTodo();
    return { ok: true, id: data?.id != null ? String(data.id) : undefined };
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
  const grupoSeleccionado = grupoActivoVigente() || grupoVigente();
  if (esPrincipal) {
    if (!patch.grupo_id && grupoSeleccionado) {
      return { ...patch, grupo_id: grupoSeleccionado };
    }
    return patch;
  }
  // Aislamiento estricto: un operador NUNCA puede asignar un cliente a un grupo ajeno
  const miGrupo = grupoVigente() || grupoActivoVigente();
  if (miGrupo) return { ...patch, grupo_id: miGrupo };
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
    if ("nombre" in seguro && seguro.nombre) {
      const nombreNorm = String(seguro.nombre).trim().toUpperCase();
      const grupoDestino =
        (seguro.grupo_id != null ? String(seguro.grupo_id) : null) ||
        (fila?.grupo_id != null ? String(fila.grupo_id) : null) ||
        grupoActivoVigente() ||
        grupoVigente() ||
        null;
      const existentes = await listarClientes(true, grupoDestino);
      const duplicado = existentes.find((c) => {
        if (String(c.id) === String(id)) return false;
        const mismoGrupo = !grupoDestino || !c.grupo_id || String(c.grupo_id) === String(grupoDestino);
        if (!mismoGrupo) return false;
        return String(c.nombre ?? "").trim().toUpperCase() === nombreNorm;
      });
      if (duplicado) {
        return {
          ok: false,
          error: `⚠️ Ya existe el cliente "${nombreNorm}" en este grupo. No puede haber dos clientes iguales en el mismo grupo.`,
        };
      }
      seguro.nombre = nombreNorm;
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
    limpiarCachéClientesTodo();
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
  const envBase = (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_BASE_PATH) || "";
  if (envBase) return envBase.replace(/\/+$/, "");
  if (typeof window === "undefined") return "";
  const p = window.location.pathname.replace(/\/+$/, "");
  const rutasApp = [
    "/portal",
    "/clientes",
    "/taquilla",
    "/login",
    "/saldos",
    "/liquidacion",
    "/programas",
    "/jugadas",
    "/grupos",
    "/socios",
    "/roles",
    "/auditoria",
    "/transcripcion",
    "/reportes",
    "/conciliacion",
    "/tickets",
    "/configuracion",
  ];
  for (const r of rutasApp) {
    const idx = p.indexOf(r);
    if (idx > 0) return p.slice(0, idx);
    if (idx === 0) break;
  }
  if (typeof document !== "undefined") {
    const script = document.querySelector<HTMLScriptElement>('script[src*="/_next/"]');
    if (script?.src) {
      try {
        const u = new URL(script.src, window.location.origin);
        const m = u.pathname.indexOf("/_next/");
        if (m > 0) return u.pathname.slice(0, m);
      } catch {
        // ignore
      }
    }
  }
  if (window.location.hostname.endsWith(".github.io")) {
    const seg = p.split("/").filter(Boolean)[0];
    if (seg && !rutasApp.includes(`/${seg}`)) return `/${seg}`;
    return "/sistema_hipico";
  }
  return "";
}

/** Ruta del portal en la SPA (se conserva `?c=&k=` para compat con el legacy). */
export function urlPortal(): string {
  if (typeof window === "undefined") return "/portal";
  const base = basePathActual();
  const slashFinal = Boolean(base) || window.location.hostname.endsWith(".github.io");
  return `${window.location.origin}${base}/portal${slashFinal ? "/" : ""}`;
}

/** Enlace largo del portal para un cliente. */
export function enlacePortalLargo(id: string | number, token: string): string {
  return `${urlPortal()}?c=${encodeURIComponent(String(id))}&k=${encodeURIComponent(token)}`;
}

/** Enlace compacto directo del portal (usa prefijo corto del ID + código). */
export function enlacePortalCompacto(id: string | number, token: string): string {
  const idCorto = String(id ?? "").trim().slice(0, 8);
  return `${urlPortal()}?c=${encodeURIComponent(idCorto)}&k=${encodeURIComponent(token)}`;
}

/** Acorta un enlace con is.gd vía JSONP; si falla o bloquea CSP devuelve el enlace compacto directo. */
export async function acortarEnlace(larga: string, id?: string | number, token?: string): Promise<string> {
  const fallback = id != null && token ? enlacePortalCompacto(id, token) : larga;
  if (typeof window === "undefined" || typeof document === "undefined") return fallback;
  return new Promise<string>((resolve) => {
    let resuelto = false;
    const cbName = `__isgd_cb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const script = document.createElement("script");
    const timer = window.setTimeout(() => {
      if (resuelto) return;
      resuelto = true;
      limpiar();
      resolve(fallback);
    }, 2200);

    const limpiar = () => {
      window.clearTimeout(timer);
      try {
        delete (window as unknown as Record<string, unknown>)[cbName];
      } catch {
        (window as unknown as Record<string, unknown>)[cbName] = undefined;
      }
      if (script.parentNode) script.parentNode.removeChild(script);
    };

    (window as unknown as Record<string, unknown>)[cbName] = (resp: { shorturl?: string } | null) => {
      if (resuelto) return;
      resuelto = true;
      limpiar();
      const url = String(resp?.shorturl ?? "").trim();
      resolve(url.startsWith("http") ? url : fallback);
    };

    script.onerror = () => {
      if (resuelto) return;
      resuelto = true;
      limpiar();
      resolve(fallback);
    };

    script.src = `https://is.gd/create.php?format=json&callback=${encodeURIComponent(cbName)}&url=${encodeURIComponent(larga)}`;
    document.head.appendChild(script);
  });
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
    limpiarCachéClientesTodo();
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

  if (n.tipo === "alerta_cupo_agotado") {
    const hipo = d.hipodromo ? String(d.hipodromo) : "";
    const carr = d.carrera ? String(d.carrera) : "";
    const cab = d.caballo_nombre ? `#${d.caballo_numero} ${d.caballo_nombre}` : `#${d.caballo_numero}`;
    let res = `<span class="font-bold text-red-600">🚨 CUPO AGOTADO:</span> ${cab} en ${hipo} C${carr}`;
    if (Array.isArray(d.compradores) && d.compradores.length > 0) {
      const lista = d.compradores
        .map((c: any) => `${c.jugador_nombre || c.cliente_nombre || "Jugador"} (${c.cantidad || 1} tab)`)
        .join(", ");
      res += `<div class="mt-1 text-xs text-slate-600"><b>Compradores:</b> ${lista}</div>`;
    }
    return res;
  }

  if (n.tipo === "alerta_cupo_marca_agotado") {
    const hipo = d.hipodromo ? String(d.hipodromo) : "";
    const carr = d.carrera ? String(d.carrera) : "";
    const cab = `#${d.caballo_numero}`;
    const limDesc = d.tipo_limite === "GRUPO" ? "Límite de Grupo" : "Tope General de Plataforma";
    let res = `<span class="font-bold text-red-600">🚨 MARCA AL TOPE (${limDesc}):</span> Marca ${cab} en ${hipo} C${carr}`;
    if (d.total_acumulado) {
      res += ` (Acumulado: $${d.total_acumulado})`;
    }
    if (Array.isArray(d.compradores) && d.compradores.length > 0) {
      const lista = d.compradores
        .map((c: any) => `${c.jugador || "Jugador"} (${c.grupo || "Grupo"}, $${c.monto})`)
        .slice(0, 4)
        .join(", ");
      res += `<div class="mt-1 text-xs text-slate-600"><b>Jugadores:</b> ${lista}</div>`;
    }
    return res;
  }

  if (n.tipo === "portal_pago") {
    const met = d.metodo_pago ? String(d.metodo_pago) : "PAGO";
    const ref = d.referencia ? ` Ref: <b>${d.referencia}</b>` : "";
    const mto = d.monto ? ` Monto: <b>${d.monto}</b>` : "";
    return `<span class="font-bold text-amber-600">💳 REPORTE DE PAGO:</span> ${met}${ref}${mto} — ${n.mensaje || "Pendiente de conciliación."}`;
  }

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
    limpiarCachéClientesTodo();
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
  /** Hora de carga de la jugada (HH:mm). */
  horaCarga?: string | null;
  /** Rol del jugador en la jugada ("Juega" o "Consigue"). */
  rol?: "Juega" | "Consigue";
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
  /** Resultado neto calculado con el motor oficial de `reportes.ts` (perspectiva del cliente). */
  resultadoNeto?: number;
  moneda: string;
  estado: string;
  /** Devolución / Incentivo calculado sobre el monto decidido/jugado. */
  devolucion: number;
};

export type NivelAcordeon = { titulo: string; subtitulo?: string; monto: number; dec: number; hijos: NivelAcordeon[]; jugadas: JugadaItem[] };

/**
 * Construye la jerarquía Grupo > Semana > Día > Hipódromo > Carrera > Jugada
 * para el estado de cuenta dinámico del cliente y el Portal de Usuario,
 * usando el MISMO motor unificado (`desglosarTicketEnFilasUnificadas`) que
 * los Reportes Finales de Carreras (`reportes.ts`).
 */
export function construirEstadoCuenta(
  tickets: TicketApuesta[],
  devolucionPct: number,
  clienteActual?: {
    id?: string | number | null;
    nombre?: string | null;
    seudonimo?: string | null;
    comision?: number | string | null;
  } | null,
  pizarrasMap?: Map<string, PizarraCarrera>
): NivelAcordeon {
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

  const get = (cache: Map<string, NivelAcordeon>, k: string, titulo: string, subtitulo?: string): NivelAcordeon => {
    let n = cache.get(k);
    if (!n) {
      n = nodo(titulo, subtitulo);
      cache.set(k, n);
    }
    return n;
  };

  const cliId = clienteActual?.id != null ? String(clienteActual.id).trim() : "";
  const cliNombres = new Set(
    [
      clienteActual?.nombre,
      clienteActual?.seudonimo,
      cliId.startsWith("sys-") ? cliId.slice(4) : "",
    ]
      .map((s) => String(s ?? "").trim().toUpperCase())
      .filter(Boolean)
  );
  const tieneIdentidadCliente = Boolean((cliId && !cliId.startsWith("sys-")) || cliNombres.size > 0);
  const tasaComisionCliente =
    clienteActual?.comision != null && String(clienteActual.comision).trim() !== ""
      ? num(clienteActual.comision)
      : null;

  const coincideLado = (ladoId: string, ladoNombre: string): boolean => {
    if (cliId && !cliId.startsWith("sys-") && ladoId && ladoId === cliId) return true;
    const nomNorm = String(ladoNombre ?? "").trim().toUpperCase();
    return Boolean(nomNorm && cliNombres.has(nomNorm));
  };

  for (const t of tickets) {
    const rec = t as unknown as Record<string, unknown>;
    const base = t.monto_decidido != null ? num(t.monto_decidido) : num(t.monto_jugado);
    const anulada = t.anulada === true;
    const baseVigente = anulada ? 0 : base;
    const estUpper = String(t.estado ?? "").trim().toUpperCase();
    const esDecidido =
      estUpper === "GANADOR" ||
      estUpper === "GANO" ||
      estUpper === "SOLUCIONADO" ||
      estUpper === "PERDEDOR" ||
      estUpper === "PERDIO";
    const aplicaIncentivo =
      !anulada &&
      esDecidido &&
      esJugadaPuestosParaIncentivo(
        t.nombre_jugada,
        (t as Record<string, unknown>).modalidad as string,
        (t as Record<string, unknown>).origen as string
      );
    const dec = aplicaIncentivo ? baseVigente * (devolucionPct / 100) : 0;
    const moneda = (t.moneda ?? "USD").toUpperCase();
    const grupo = t.grupo_cobro_nombre || "Directo";
    // Imputación estricta al DÍA DE LA CARRERA (`fecha_carrera`), sin importar cuándo fue registrada.
    const isoExtraida = extraerFechaCarreraTicket(rec);
    const isoCarrera = isoExtraida || (t.fecha_carrera ? String(t.fecha_carrera).slice(0, 10) : null);
    const refFecha = isoCarrera ? `${isoCarrera}T12:00:00` : t.fecha_registro;
    const semana = claveSemana(refFecha);
    const dia = refFecha ? new Date(refFecha).toLocaleDateString("es-VE", { dateStyle: "short" }) : "—";
    const hipodromo = String(t.hipodromo ?? "—").toUpperCase();
    const carrera = num(t.carrera) || 0;

    const pizarra =
      t._pizarra ??
      buscarPizarraEnMapa(
        pizarrasMap,
        isoCarrera ?? String(t.fecha_registro ?? "").slice(0, 10),
        hipodromo,
        carrera
      );

    const { juega, consigue } = desglosarTicketEnFilasUnificadas(rec, pizarra, tasaComisionCliente);

    let lados: Array<typeof juega> = [];
    if (tieneIdentidadCliente) {
      const esJ = coincideLado(juega.clienteId, juega.clienteNombre);
      const esC = Boolean(consigue && coincideLado(consigue.clienteId, consigue.clienteNombre));
      if (esJ) lados.push(juega);
      if (esC && consigue) lados.push(consigue);
      if (lados.length === 0) {
        // Si el ticket llegó filtrado para este cliente pero sin match literal, determinar lado por ID/nombre
        if (consigue && cliId && String(t.cliente_consigue_id ?? "") === cliId) {
          lados.push(consigue);
        } else {
          lados.push(juega);
        }
      }
    } else {
      lados = [juega];
    }

    for (const fila of lados) {
      const idJugada = lados.length > 1 ? `${t.id}-${fila.rol === "Consigue" ? "c" : "j"}` : String(t.id);
      const decFila = fila.rol === "Juega" ? dec : 0;
      const resultadoNetoFila = fila.resultado ?? 0;
      const jugada: JugadaItem = {
        id: idJugada,
        fecha: t.fecha_registro ?? isoCarrera ?? null,
        fechaTexto: isoCarrera ? fmtFecha(`${isoCarrera}T12:00:00`) : fmtFechaHora(t.fecha_registro),
        horaCarga: fila.horaCarga,
        rol: fila.rol,
        fechaCarrera: isoCarrera ?? (t.fecha_registro ? String(t.fecha_registro).slice(0, 10) : null),
        hipodromo,
        carrera,
        grupo,
        semana,
        dia,
        caballo: fila.caballo || t.caballo || "—",
        jugada: fila.jugada || t.nombre_jugada || "Jugada",
        montoJugado: fila.monto,
        montoDecidido: baseVigente,
        premio: fila.premio,
        resultadoNeto: resultadoNetoFila,
        moneda,
        estado: fila.estado,
        devolucion: decFila,
      };

      const g = get(construir.grupos, grupo, grupo);
      const s = get(construir.semanas, `${grupo}|${semana}`, semana, "Semana");
      const d = get(construir.dias, `${grupo}|${semana}|${dia}`, dia, "Día");
      const h = get(construir.hipodromos, `${grupo}|${semana}|${dia}|${hipodromo}`, hipodromo);
      const c = get(
        construir.carreras,
        `${grupo}|${semana}|${dia}|${hipodromo}|${carrera}`,
        `Carrera ${carrera}`,
        hipodromo
      );

      if (g.jugadas.length === 0 && !g.hijos.some((x) => x.titulo === s.titulo && x.subtitulo === s.subtitulo)) g.hijos.push(s);
      if (!s.hijos.some((x) => x.titulo === d.titulo && x.subtitulo === d.subtitulo)) s.hijos.push(d);
      if (!d.hijos.some((x) => x.titulo === h.titulo && !x.subtitulo)) d.hijos.push(h);
      if (!h.hijos.some((x) => x.titulo === c.titulo)) h.hijos.push(c);

      acumular(g, resultadoNetoFila, decFila, jugada);
      acumular(s, resultadoNetoFila, decFila, jugada);
      acumular(d, resultadoNetoFila, decFila, jugada);
      acumular(h, resultadoNetoFila, decFila, jugada);
      acumular(c, resultadoNetoFila, decFila, jugada);
      raiz.monto += resultadoNetoFila;
      raiz.dec += decFila;
      raiz.jugadas.push(jugada);
    }
  }

  const numCarreraDeTitulo = (t: string): number =>
    Number(String(t ?? "").replace(/\D+/g, "")) || 0;
  const compararJugadaPorCarrera = (a: JugadaItem, b: JugadaItem): number => {
    const fA = String(a.fechaCarrera || a.fecha || "").slice(0, 10);
    const fB = String(b.fechaCarrera || b.fecha || "").slice(0, 10);
    if (fB !== fA) return fB.localeCompare(fA);
    const hCmp = String(a.hipodromo ?? "").localeCompare(String(b.hipodromo ?? ""), "es");
    if (hCmp !== 0) return hCmp;
    return (Number(a.carrera) || 0) - (Number(b.carrera) || 0);
  };

  for (const h of construir.hipodromos.values()) {
    h.hijos.sort((a, b) => numCarreraDeTitulo(a.titulo) - numCarreraDeTitulo(b.titulo));
    h.jugadas.sort(compararJugadaPorCarrera);
  }
  for (const d of construir.dias.values()) {
    d.hijos.sort((a, b) => a.titulo.localeCompare(b.titulo, "es"));
    d.jugadas.sort(compararJugadaPorCarrera);
  }
  for (const s of construir.semanas.values()) {
    s.jugadas.sort(compararJugadaPorCarrera);
  }
  for (const g of construir.grupos.values()) {
    g.jugadas.sort(compararJugadaPorCarrera);
  }
  raiz.jugadas.sort(compararJugadaPorCarrera);

  raiz.hijos = [...construir.grupos.values()];
  return raiz;
}

/** Trae los tickets de apuestas de un cliente para el estado de cuenta (tanto donde juega como donde da / se le imputa la modalidad), incluyendo sus pizarras oficiales. */
export async function cargarTicketsCliente(
  clienteId: string | number,
  clienteInfo?: { nombre?: string | null; seudonimo?: string | null; grupo_id?: string | number | null } | null
): Promise<TicketApuesta[]> {
  if (!supabase) return [];
  try {
    const idStr = String(clienteId ?? "").trim();
    const clienteMem = cacheClientes?.find((c) => String(c.id) === idStr);
    const grupoCliente = clienteInfo?.grupo_id ?? clienteMem?.grupo_id ?? null;
    const nombresCliente = new Set(
      [
        clienteInfo?.nombre,
        clienteInfo?.seudonimo,
        clienteMem?.nombre,
        clienteMem?.seudonimo,
        idStr.startsWith("sys-") ? idStr.slice(4) : "",
      ]
        .map((x) => String(x ?? "").trim().toUpperCase())
        .filter(Boolean)
    );

    const { data, error } = await supabase
      .from("tickets_apuestas")
      .select("*")
      .order("fecha_registro", { ascending: false })
      .limit(10000);
    if (error) throw error;
    const filas = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      ...(r as unknown as TicketApuesta),
      fecha_carrera: extraerFechaCarreraTicket(r) || (r.fecha_carrera as string | null) || null,
    }));
    const filtrados = filas.filter((t) => {
      // Si el cliente pertenece a un grupo específico, no mezclar con tickets de otros grupos
      if (grupoCliente) {
        const gEsperado = String(grupoCliente).trim();
        const tGrupo = String(
          (t as unknown as { grupo_cobro_id?: string | number; grupo_id?: string | number }).grupo_cobro_id ??
          (t as unknown as { grupo_id?: string | number }).grupo_id ??
          ""
        ).trim();
        if (tGrupo && tGrupo !== gEsperado) {
          return false;
        }
      }

      const jId = t.cliente_juega_id != null ? String(t.cliente_juega_id).trim() : "";
      const cId =
        t.cliente_consigue_id != null
          ? String(t.cliente_consigue_id).trim()
          : t.banquero_cliente_id != null
            ? String(t.banquero_cliente_id).trim()
            : "";
      if (idStr && !idStr.startsWith("sys-") && (jId === idStr || cId === idStr)) return true;
      if (nombresCliente.size === 0) return false;
      const jNom = String(t.cliente_juega_nombre ?? "").trim().toUpperCase();
      const cRaw = String(t.banquero_nombre ?? t.cliente_consigue_nombre ?? "").trim();
      const cNom = resolverContraparteModalidad(t.nombre_jugada, cRaw).trim().toUpperCase();
      return nombresCliente.has(jNom) || nombresCliente.has(cNom) || nombresCliente.has(cRaw.toUpperCase());
    });

    const fechas = [
      ...new Set(
        filtrados
          .map((t) => String(t.fecha_carrera ?? t.fecha_registro ?? "").slice(0, 10))
          .filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f))
      ),
    ];
    const pizarras = await leerPizarrasPorFechas(fechas);
    return filtrados.map((t) => {
      const f = String(t.fecha_carrera ?? t.fecha_registro ?? "").slice(0, 10);
      const h = String(t.hipodromo ?? "");
      const c = Number(t.carrera) || 0;
      return {
        ...t,
        _pizarra: buscarPizarraEnMapa(pizarras, f, h, c),
      };
    });
  } catch {
    return [];
  }
}