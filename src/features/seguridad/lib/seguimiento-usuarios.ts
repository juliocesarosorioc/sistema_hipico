/**
 * ============================================================================
 * SERVICIO DE SEGUIMIENTO DE USUARIOS, CONEXIONES Y ACTIVIDAD EN VIVO
 * ============================================================================
 * Registra y monitorea en tiempo real:
 *   1. Usuarios conectados y estado en línea.
 *   2. Tiempo de conexión (duración activa y latidos).
 *   3. Páginas que visita cada usuario (historial cronológico de rutas).
 *   4. Acciones operativas que ejecuta (ventas, consultas, ediciones, reportes).
 *   5. Purga / limpieza automática estricta cada 10 días.
 */

import { supabase } from "@/core/supabase";

export interface UsuarioSesionInfo {
  id: string;
  usuarioId: string;
  nombre: string;
  rol: string;
  grupoId: string | null;
  inicioSesion: string;
  ultimoLatido: string;
  activo: boolean;
  online: boolean;
  tiempoConexionTexto: string;
  duracionSegundos: number;
  ip?: string | null;
  dispositivo?: string | null;
  navegador?: string | null;
  paginaActual?: string | null;
}

export interface UsuarioActividadItem {
  id: string | number;
  sesionId?: string;
  usuarioId: string;
  tipo: "PAGINA" | "ACCION";
  ruta?: string | null;
  accion?: string | null;
  detalle?: string | null;
  fecha: string;
  ip?: string | null;
}

const STORAGE_KEY_SESIONES = "hipico_track_sesiones_v1";
const STORAGE_KEY_ACTIVIDAD = "hipico_track_actividad_v1";
const STORAGE_KEY_SESION_ACTUAL = "hipico_track_sesion_id";

const DIAS_RETENCION = 10;
const MS_RETENCION = DIAS_RETENCION * 24 * 60 * 60 * 1000;
const MS_TIMEOUT_ONLINE = 2 * 60 * 1000; // 2 minutos sin latido = desconectado

/**
 * Obtiene o inicializa el ID de sesión del cliente actual.
 */
export function obtenerIdSesionActual(usuarioId?: string): string {
  if (typeof window === "undefined") return "ses_servidor";
  try {
    const clave = usuarioId ? `${STORAGE_KEY_SESION_ACTUAL}_${usuarioId}` : STORAGE_KEY_SESION_ACTUAL;
    let id = localStorage.getItem(clave);
    if (!id) {
      id = `ses_${usuarioId ? usuarioId + '_' : ''}${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      localStorage.setItem(clave, id);
    }
    return id;
  } catch {
    return `ses_fallback_${Date.now()}`;
  }
}

/**
 * Normaliza nombres amigables de rutas del sistema.
 */
export function formatearNombreRuta(ruta: string | null | undefined): string {
  if (!ruta) return "Inicio";
  const r = ruta.split("?")[0].replace(/\/$/, "");
  if (r === "" || r === "/") return "🏠 Inicio / Dashboard";
  if (r.includes("/tablas")) return "📋 Tablas Fijas";
  if (r.includes("/carreras")) return "🏁 Carreras del Día";
  if (r.includes("/remates")) return "🔨 Remates Hípicos";
  if (r.includes("/dupletas")) return "🎲 Dupletas";
  if (r.includes("/marcas")) return "🎯 Marcas / Cuadros";
  if (r.includes("/reportes") || r.includes("/saldos")) return "📊 Reportes y Saldos";
  if (r.includes("/clientes")) return "👥 Clientes y Jugadores";
  if (r.includes("/grupos")) return "🏢 Grupos de Venta";
  if (r.includes("/seguridad")) return "🛡️ Matriz de Seguridad";
  if (r.includes("/impresion")) return "🖨️ Impresión / Tickets";
  if (r.includes("/ejemplares") || r.includes("/gaceta")) return "🐴 Ejemplares y Gaceta";
  if (r.includes("/login")) return "🔑 Inicio de Sesión";
  return `📄 ${ruta}`;
}

/**
 * Formatea duración en texto legible (ej. "1h 45m", "12m", "30s").
 */
export function formatearDuracion(ms: number): string {
  if (ms <= 0) return "1s";
  const segs = Math.floor(ms / 1000);
  const mins = Math.floor(segs / 60);
  const horas = Math.floor(mins / 60);
  const dias = Math.floor(horas / 24);

  if (dias > 0) return `${dias}d ${horas % 24}h`;
  if (horas > 0) return `${horas}h ${mins % 60}m`;
  if (mins > 0) return `${mins}m ${segs % 60}s`;
  return `${segs}s`;
}

/**
 * Obtiene el dispositivo y navegador del agente de usuario.
 */
function obtenerInfoCliente(): { navegador: string; dispositivo: string } {
  if (typeof window === "undefined" || !window.navigator) {
    return { navegador: "Servidor", dispositivo: "Desconocido" };
  }
  const ua = window.navigator.userAgent || "";
  let dispositivo = "Escritorio (PC)";
  if (/android/i.test(ua)) dispositivo = "Móvil Android";
  else if (/iphone|ipad|ipod/i.test(ua)) dispositivo = "Móvil iOS (iPhone/iPad)";
  else if (/mobile/i.test(ua)) dispositivo = "Móvil";

  let navegador = "Navegador Web";
  if (/chrome|crios/i.test(ua) && !/edge|edg/i.test(ua)) navegador = "Chrome";
  else if (/firefox|fxios/i.test(ua)) navegador = "Firefox";
  else if (/safari/i.test(ua) && !/chrome/i.test(ua)) navegador = "Safari";
  else if (/edge|edg/i.test(ua)) navegador = "Edge";

  return { navegador, dispositivo };
}

// ----------------------------------------------------------------------------
// LIMPIEZA AUTOMÁTICA CADA 10 DÍAS
// ----------------------------------------------------------------------------
export async function purgarActividadAntigua10Dias(): Promise<number> {
  let borrados = 0;
  const fechaLimite = Date.now() - MS_RETENCION;

  // 1. Purga en almacenamiento local
  try {
    if (typeof window !== "undefined") {
      const rawAct = localStorage.getItem(STORAGE_KEY_ACTIVIDAD);
      if (rawAct) {
        const arr = JSON.parse(rawAct) as UsuarioActividadItem[];
        const filtrados = arr.filter((item) => {
          const t = new Date(item.fecha).getTime();
          return !isNaN(t) && t >= fechaLimite;
        });
        borrados += arr.length - filtrados.length;
        localStorage.setItem(STORAGE_KEY_ACTIVIDAD, JSON.stringify(filtrados));
      }

      const rawSes = localStorage.getItem(STORAGE_KEY_SESIONES);
      if (rawSes) {
        const arr = JSON.parse(rawSes) as UsuarioSesionInfo[];
        const filtrados = arr.filter((item) => {
          const t = new Date(item.ultimoLatido).getTime();
          return !isNaN(t) && t >= fechaLimite;
        });
        localStorage.setItem(STORAGE_KEY_SESIONES, JSON.stringify(filtrados));
      }
    }
  } catch {
    /* ignore */
  }

  // 2. Purga en base de datos Supabase
  if (supabase) {
    try {
      const { data } = await supabase.rpc("club_purgar_actividad_10_dias");
      if (typeof data === "number") borrados += data;
    } catch {
      // Fallback si no está la RPC: delete directo
      try {
        const isoLimite = new Date(fechaLimite).toISOString();
        await supabase.from("usuario_actividad").delete().lt("fecha", isoLimite);
        await supabase.from("usuario_sesion").delete().lt("ultimo_latido", isoLimite);
      } catch {
        /* best-effort */
      }
    }
  }

  return borrados;
}

// ----------------------------------------------------------------------------
// REGISTRO DE LATIDO / PRESENCIA EN VIVO
// ----------------------------------------------------------------------------
export async function registrarLatidoPresencia(params: {
  usuarioId: string;
  nombre?: string;
  rol?: string;
  grupoId?: string | null;
  paginaActual?: string;
}): Promise<void> {
  if (!params.usuarioId || typeof window === "undefined") return;

  const sesionId = obtenerIdSesionActual(params.usuarioId);
  const ahoraIso = new Date().toISOString();
  const { navegador, dispositivo } = obtenerInfoCliente();

  // Guardar en cache local para disponibilidad instantánea
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SESIONES);
    let sesiones: UsuarioSesionInfo[] = raw ? JSON.parse(raw) : [];
    
    // Purgar de paso registros antiguos locales
    const fechaLimite = Date.now() - MS_RETENCION;
    sesiones = sesiones.filter((s) => new Date(s.ultimoLatido).getTime() >= fechaLimite);

    const idx = sesiones.findIndex((s) => s.usuarioId === params.usuarioId);
    if (idx >= 0) {
      sesiones[idx] = {
        ...sesiones[idx],
        ultimoLatido: ahoraIso,
        activo: true,
        paginaActual: params.paginaActual || sesiones[idx].paginaActual,
        nombre: params.nombre || sesiones[idx].nombre,
        rol: params.rol || sesiones[idx].rol,
        grupoId: params.grupoId ?? sesiones[idx].grupoId,
        dispositivo,
        navegador,
      };
    } else {
      sesiones.unshift({
        id: sesionId,
        usuarioId: params.usuarioId,
        nombre: params.nombre || params.usuarioId,
        rol: params.rol || "Operador",
        grupoId: params.grupoId || null,
        inicioSesion: ahoraIso,
        ultimoLatido: ahoraIso,
        activo: true,
        online: true,
        tiempoConexionTexto: "1m",
        duracionSegundos: 1,
        dispositivo,
        navegador,
        paginaActual: params.paginaActual || window.location.pathname,
      });
    }
    localStorage.setItem(STORAGE_KEY_SESIONES, JSON.stringify(sesiones));
  } catch {
    /* ignore */
  }

  // Notificar al servidor Supabase
  if (supabase) {
    try {
      await supabase.rpc("club_registrar_latido_sesion", {
        p_sesion_id: sesionId,
        p_usuario_id: params.usuarioId,
        p_nombre: params.nombre || params.usuarioId,
        p_rol: params.rol || "Operador",
        p_grupo_id: params.grupoId ? String(params.grupoId) : null,
        p_pagina: params.paginaActual || window.location.pathname,
        p_ip: null,
        p_navegador: navegador,
        p_dispositivo: dispositivo,
      });
    } catch {
      /* fallback con tabla directa */
      try {
        await supabase.from("usuario_sesion").upsert(
          [
            {
              id: sesionId,
              usuario_id: params.usuarioId,
              nombre: params.nombre || params.usuarioId,
              rol: params.rol || "Operador",
              grupo_id: params.grupoId ? String(params.grupoId) : null,
              ultimo_latido: ahoraIso,
              activo: true,
              dispositivo,
              navegador,
              pagina_actual: params.paginaActual || window.location.pathname,
            },
          ],
          { onConflict: "id" }
        );
      } catch {
        /* best-effort */
      }
    }
  }
}

// ----------------------------------------------------------------------------
// REGISTRO DE ACTIVIDAD (PÁGINA O ACCIÓN)
// ----------------------------------------------------------------------------
export async function registrarActividad(params: {
  usuarioId: string;
  tipo: "PAGINA" | "ACCION";
  ruta?: string;
  accion?: string;
  detalle?: string | Record<string, unknown>;
}): Promise<void> {
  if (!params.usuarioId || typeof window === "undefined") return;

  const sesionId = obtenerIdSesionActual(params.usuarioId);
  const ahoraIso = new Date().toISOString();
  const detalleStr = typeof params.detalle === "object" ? JSON.stringify(params.detalle) : params.detalle || null;

  const item: UsuarioActividadItem = {
    id: `${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    sesionId,
    usuarioId: params.usuarioId,
    tipo: params.tipo,
    ruta: params.ruta || (params.tipo === "PAGINA" ? window.location.pathname : undefined),
    accion: params.accion || (params.tipo === "PAGINA" ? `Visita a ${formatearNombreRuta(params.ruta || window.location.pathname)}` : undefined),
    detalle: detalleStr,
    fecha: ahoraIso,
  };

  // 1. Guardar en cache local (con purga estricta de 10 días)
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ACTIVIDAD);
    let arr: UsuarioActividadItem[] = raw ? JSON.parse(raw) : [];
    
    // Purga de más de 10 días
    const fechaLimite = Date.now() - MS_RETENCION;
    arr = arr.filter((x) => new Date(x.fecha).getTime() >= fechaLimite);

    arr.unshift(item);
    // Limitar tamaño de array local a 1500 items para no saturar localStorage
    if (arr.length > 1500) arr = arr.slice(0, 1500);

    localStorage.setItem(STORAGE_KEY_ACTIVIDAD, JSON.stringify(arr));
  } catch {
    /* ignore */
  }

  // 2. Guardar en Supabase
  if (supabase) {
    try {
      await supabase.rpc("club_registrar_actividad_usuario", {
        p_sesion_id: sesionId,
        p_usuario_id: params.usuarioId,
        p_tipo: params.tipo,
        p_ruta: item.ruta,
        p_accion: item.accion,
        p_detalle: item.detalle,
        p_ip: null,
      });
    } catch {
      try {
        await supabase.from("usuario_actividad").insert([
          {
            sesion_id: sesionId,
            usuario_id: params.usuarioId,
            tipo: params.tipo,
            ruta: item.ruta,
            accion: item.accion,
            detalle: item.detalle,
            fecha: ahoraIso,
          },
        ]);
      } catch {
        /* best-effort */
      }
    }
  }
}

/**
 * Atajo para registrar una acción operativa de usuario.
 */
export function registrarAccionUsuario(
  usuarioId: string,
  accion: string,
  detalle?: string | Record<string, unknown>
): void {
  void registrarActividad({
    usuarioId,
    tipo: "ACCION",
    accion,
    detalle,
  });
}

/**
 * Atajo para registrar una visita a página.
 */
export function registrarVisitaPagina(usuarioId: string, ruta: string): void {
  void registrarActividad({
    usuarioId,
    tipo: "PAGINA",
    ruta,
  });
}

// ----------------------------------------------------------------------------
// CONSULTAS PARA LA MATRIZ DE SEGURIDAD
// ----------------------------------------------------------------------------
export async function consultarUsuariosConectados(): Promise<UsuarioSesionInfo[]> {
  const ahora = Date.now();
  const limite10Dias = ahora - MS_RETENCION;
  let sesiones: UsuarioSesionInfo[] = [];

  // 1. Intentar leer de Supabase
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("usuario_sesion")
        .select("*")
        .gte("ultimo_latido", new Date(limite10Dias).toISOString())
        .order("ultimo_latido", { ascending: false });

      if (!error && Array.isArray(data) && data.length > 0) {
        sesiones = data.map((d: any) => {
          const tLatido = new Date(d.ultimo_latido).getTime();
          const tInicio = new Date(d.inicio_sesion).getTime();
          const online = !isNaN(tLatido) && ahora - tLatido < MS_TIMEOUT_ONLINE;
          const duracionMs = Math.max(0, (!isNaN(tInicio) ? ahora - tInicio : 0));

          return {
            id: d.id,
            usuarioId: d.usuario_id,
            nombre: d.nombre || d.usuario_id,
            rol: d.rol || "Operador",
            grupoId: d.grupo_id || null,
            inicioSesion: d.inicio_sesion,
            ultimoLatido: d.ultimo_latido,
            activo: Boolean(d.activo),
            online,
            tiempoConexionTexto: formatearDuracion(duracionMs),
            duracionSegundos: Math.floor(duracionMs / 1000),
            ip: d.ip,
            dispositivo: d.dispositivo,
            navegador: d.navegador,
            paginaActual: d.pagina_actual,
          };
        });
      }
    } catch {
      /* fallback a local */
    }
  }

  // 2. Fusionar con datos locales para resiliencia total
  if (typeof window !== "undefined") {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_SESIONES);
      if (raw) {
        const locales = JSON.parse(raw) as UsuarioSesionInfo[];
        for (const loc of locales) {
          const tLatido = new Date(loc.ultimoLatido).getTime();
          const tInicio = new Date(loc.inicioSesion).getTime();
          if (isNaN(tLatido) || tLatido < limite10Dias) continue;

          const online = ahora - tLatido < MS_TIMEOUT_ONLINE;
          const duracionMs = Math.max(0, (!isNaN(tInicio) ? ahora - tInicio : 0));

          const existe = sesiones.find((s) => s.usuarioId === loc.usuarioId);
          if (!existe) {
            sesiones.push({
              ...loc,
              online,
              tiempoConexionTexto: formatearDuracion(duracionMs),
              duracionSegundos: Math.floor(duracionMs / 1000),
            });
          } else if (online && !existe.online) {
            existe.online = true;
            existe.ultimoLatido = loc.ultimoLatido;
            existe.paginaActual = loc.paginaActual || existe.paginaActual;
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  // Ordenar: primero los online en tiempo real, luego los de actividad más reciente
  return sesiones.sort((a, b) => {
    if (a.online && !b.online) return -1;
    if (!a.online && b.online) return 1;
    return new Date(b.ultimoLatido).getTime() - new Date(a.ultimoLatido).getTime();
  });
}

/**
 * Consulta el historial de páginas y acciones de un usuario específico.
 */
export async function consultarActividadUsuario(usuarioId: string): Promise<{
  paginas: UsuarioActividadItem[];
  acciones: UsuarioActividadItem[];
  totalPaginas: number;
  totalAcciones: number;
}> {
  if (!usuarioId) {
    return { paginas: [], acciones: [], totalPaginas: 0, totalAcciones: 0 };
  }

  const limite10DiasIso = new Date(Date.now() - MS_RETENCION).toISOString();
  let actividades: UsuarioActividadItem[] = [];

  // 1. Consultar en Supabase
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("usuario_actividad")
        .select("*")
        .eq("usuario_id", usuarioId)
        .gte("fecha", limite10DiasIso)
        .order("fecha", { ascending: false })
        .limit(250);

      if (!error && Array.isArray(data) && data.length > 0) {
        actividades = data.map((d: any) => ({
          id: d.id,
          sesionId: d.sesion_id,
          usuarioId: d.usuario_id,
          tipo: d.tipo as "PAGINA" | "ACCION",
          ruta: d.ruta,
          accion: d.accion,
          detalle: d.detalle,
          fecha: d.fecha,
          ip: d.ip,
        }));
      }
    } catch {
      /* fallback */
    }
  }

  // 2. Fusionar con eventos locales recientes
  if (typeof window !== "undefined") {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_ACTIVIDAD);
      if (raw) {
        const locales = JSON.parse(raw) as UsuarioActividadItem[];
        const usuarioLocales = locales.filter(
          (a) => a.usuarioId === usuarioId && new Date(a.fecha).getTime() >= Date.now() - MS_RETENCION
        );
        for (const loc of usuarioLocales) {
          if (!actividades.some((a) => a.id === loc.id || (a.fecha === loc.fecha && a.accion === loc.accion))) {
            actividades.push(loc);
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  // Ordenar cronológicamente descendente
  actividades.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());

  const paginas = actividades.filter((a) => a.tipo === "PAGINA");
  const acciones = actividades.filter((a) => a.tipo === "ACCION");

  return {
    paginas,
    acciones,
    totalPaginas: paginas.length,
    totalAcciones: acciones.length,
  };
}
