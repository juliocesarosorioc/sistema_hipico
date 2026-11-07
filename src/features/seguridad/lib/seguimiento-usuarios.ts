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
 *   6. [NUEVO] Control de Sesión Única por usuario.
 *   7. [NUEVO] Detección y bloqueo ante cambio de IP durante sesión activa.
 *   8. [NUEVO] Registro de intentos fallidos de contraseña (Anti Brute-Force).
 */

import { supabase } from "@/core/supabase";
import { obtenerIpCliente } from "@/shared/lib/ip-detector";

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

/** Registro de intentos fallidos de contraseña por usuario/IP. */
export interface IntentoFallido {
  usuarioId: string;
  ip: string;
  intentos: number;
  primerIntento: string;
  bloqueadoHasta?: string;
}

const STORAGE_KEY_SESIONES = "hipico_track_sesiones_v1";
const STORAGE_KEY_ACTIVIDAD = "hipico_track_actividad_v1";
const STORAGE_KEY_SESION_ACTUAL = "hipico_track_sesion_id";
const STORAGE_KEY_INTENTOS = "hipico_login_intentos_v1";

const DIAS_RETENCION = 10;
const MS_RETENCION = DIAS_RETENCION * 24 * 60 * 60 * 1000;
const MS_TIMEOUT_ONLINE = 2 * 60 * 1000; // 2 minutos sin latido = desconectado

/** Máximo de intentos fallidos antes de bloqueo (Módulo 1). */
const MAX_INTENTOS_FALLIDOS = 3;
/** Duración del bloqueo en minutos (Módulo 1). */
const MINUTOS_BLOQUEO = 30;

// ----------------------------------------------------------------------------
// SESIÓN ÚNICA POR USUARIO (MÓDULO 1)
// ----------------------------------------------------------------------------

/**
 * Genera un ID de sesión criptográficamente seguro.
 */
export function generarSesionIdSeguro(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

let tablaSesionDisponible = true;

/**
 * Verifica si el usuario ya tiene una sesión activa (Sesión Única).
 * Retorna la sesión existente si está en línea (< 5 minutos de inactividad).
 */
export async function verificarSesionActivaExistente(usuarioId: string): Promise<{
  tieneSesionActiva: boolean;
  ipSesionActiva?: string;
  sesionActivaId?: string;
  ultimoLatido?: string;
} | null> {
  if (!supabase || !usuarioId || !tablaSesionDisponible) return null;
  try {
    const limiteInactivo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("usuario_sesion")
      .select("id, ip, ultimo_latido")
      .eq("usuario_id", usuarioId)
      .eq("activo", true)
      .gte("ultimo_latido", limiteInactivo)
      .order("ultimo_latido", { ascending: false })
      .limit(1);

    if (error) {
      if (
        error.code === "42P01" ||
        error.code === "PGRST204" ||
        error.code === "PGRST200" ||
        error.message?.includes("does not exist") ||
        (error as any).status === 400
      ) {
        tablaSesionDisponible = false;
      }
      return { tieneSesionActiva: false };
    }

    if (!data || data.length === 0) {
      return { tieneSesionActiva: false };
    }

    return {
      tieneSesionActiva: true,
      ipSesionActiva: data[0].ip as string | undefined,
      sesionActivaId: data[0].id as string,
      ultimoLatido: data[0].ultimo_latido as string,
    };
  } catch {
    return null;
  }
}

/**
 * Invalida TODAS las sesiones activas previas del usuario.
 * Se llama antes de crear la nueva sesión (garantía de Sesión Única).
 */
export async function invalidarSesionesPrevias(usuarioId: string): Promise<void> {
  if (!supabase || !usuarioId) return;
  try {
    await supabase
      .from("usuario_sesion")
      .update({ activo: false })
      .eq("usuario_id", usuarioId)
      .eq("activo", true);
  } catch {
    /* no bloquear el flujo de login */
  }
}

/**
 * Cierra la sesión actual en la tabla de presencia (marca como inactiva).
 */
export async function cerrarSesionPresencia(sesionId: string): Promise<void> {
  if (!supabase || !sesionId) return;
  try {
    await supabase
      .from("usuario_sesion")
      .update({ activo: false })
      .eq("id", sesionId);
  } catch {
    /* no bloquear */
  }
}

// ----------------------------------------------------------------------------
// ANTI BRUTE-FORCE: INTENTOS FALLIDOS (MÓDULO 1)
// ----------------------------------------------------------------------------

function leerIntentosLocal(): IntentoFallido[] {
  try {
    if (typeof window === "undefined") return [];
    const raw = localStorage.getItem(STORAGE_KEY_INTENTOS);
    if (!raw) return [];
    return JSON.parse(raw) as IntentoFallido[];
  } catch {
    return [];
  }
}

function guardarIntentosLocal(intentos: IntentoFallido[]): void {
  try {
    if (typeof window === "undefined") return;
    localStorage.setItem(STORAGE_KEY_INTENTOS, JSON.stringify(intentos));
  } catch {
    /* ignore */
  }
}

/**
 * Registra un intento fallido de contraseña.
 * Después de MAX_INTENTOS_FALLIDOS, bloquea por MINUTOS_BLOQUEO minutos.
 */
export function registrarIntentoFallido(usuarioId: string, ip: string): void {
  const ahora = new Date().toISOString();
  let intentos = leerIntentosLocal();

  // Limpiar registros expirados
  const limite = Date.now() - MINUTOS_BLOQUEO * 60 * 1000 * 2;
  intentos = intentos.filter((i) => new Date(i.primerIntento).getTime() > limite);

  const idx = intentos.findIndex(
    (i) => i.usuarioId === usuarioId || i.ip === ip
  );

  if (idx >= 0) {
    intentos[idx].intentos += 1;
    if (intentos[idx].intentos >= MAX_INTENTOS_FALLIDOS) {
      const bloqueadoHasta = new Date(
        Date.now() + MINUTOS_BLOQUEO * 60 * 1000
      ).toISOString();
      intentos[idx].bloqueadoHasta = bloqueadoHasta;
      // Registrar en Supabase para que el administrador vea la alerta
      void registrarEventoSeguridadDB({
        usuarioId,
        ip,
        tipo: "BLOQUEO_INTENTOS_FALLIDOS",
        detalle: `Bloqueado por ${MAX_INTENTOS_FALLIDOS} intentos fallidos. Bloqueado hasta ${bloqueadoHasta}`,
      });
    }
  } else {
    intentos.push({
      usuarioId,
      ip,
      intentos: 1,
      primerIntento: ahora,
    });
  }

  guardarIntentosLocal(intentos);
}

/**
 * Verifica si un usuario/IP está bloqueado por intentos fallidos.
 * Retorna { bloqueado: true, segundosRestantes } si está bloqueado.
 */
export function verificarBloqueoIntentos(
  usuarioId: string,
  ip: string
): { bloqueado: boolean; segundosRestantes?: number } {
  const intentos = leerIntentosLocal();
  const ahora = Date.now();

  const registro = intentos.find(
    (i) => i.usuarioId === usuarioId || i.ip === ip
  );

  if (!registro || !registro.bloqueadoHasta) {
    return { bloqueado: false };
  }

  const hasta = new Date(registro.bloqueadoHasta).getTime();
  if (hasta > ahora) {
    return {
      bloqueado: true,
      segundosRestantes: Math.ceil((hasta - ahora) / 1000),
    };
  }

  // El bloqueo expiró: limpiar
  const limpios = intentos.filter(
    (i) => !(i.usuarioId === usuarioId || i.ip === ip)
  );
  guardarIntentosLocal(limpios);
  return { bloqueado: false };
}

/**
 * Limpia los intentos fallidos de un usuario tras login exitoso.
 */
export function limpiarIntentosFallidos(usuarioId: string, ip: string): void {
  const limpios = leerIntentosLocal().filter(
    (i) => i.usuarioId !== usuarioId && i.ip !== ip
  );
  guardarIntentosLocal(limpios);
}

// ----------------------------------------------------------------------------
// REGISTRO DE EVENTOS DE SEGURIDAD EN BASE DE DATOS
// ----------------------------------------------------------------------------

async function registrarEventoSeguridadDB(opts: {
  usuarioId: string;
  ip: string;
  tipo: string;
  detalle: string;
}): Promise<void> {
  if (!supabase) return;
  try {
    // Registrar en la tabla de actividad como acción de seguridad
    await supabase.from("usuario_actividad").insert([
      {
        usuario_id: opts.usuarioId.slice(0, 80),
        tipo: "ACCION",
        accion: `⚠️ SEGURIDAD: ${opts.tipo}`,
        detalle: opts.detalle.slice(0, 2000),
        ip: opts.ip.slice(0, 45),
      },
    ]);
  } catch {
    /* best-effort */
  }
}

/**
 * Registra un evento de cambio de IP durante sesión activa.
 * Usado para auditoría y para disparar el cierre de sesión.
 */
export async function registrarCambioIpSesion(opts: {
  sesionId: string;
  usuarioId: string;
  ipOriginal: string;
  ipNueva: string;
}): Promise<void> {
  await registrarEventoSeguridadDB({
    usuarioId: opts.usuarioId,
    ip: opts.ipNueva,
    tipo: "CAMBIO_IP_DURANTE_SESION",
    detalle: `Sesión ${opts.sesionId}: IP original ${opts.ipOriginal} → IP nueva ${opts.ipNueva}. Sesión cerrada por seguridad.`,
  });
}

// ----------------------------------------------------------------------------
// ID DE SESIÓN LOCAL
// ----------------------------------------------------------------------------

/**
 * Obtiene o inicializa el ID de sesión del cliente actual.
 */
export function obtenerIdSesionActual(usuarioId?: string): string {
  if (typeof window === "undefined") return "ses_servidor";
  try {
    const clave = usuarioId
      ? `${STORAGE_KEY_SESION_ACTUAL}_${usuarioId}`
      : STORAGE_KEY_SESION_ACTUAL;
    let id = localStorage.getItem(clave);
    if (!id) {
      id = generarSesionIdSeguro();
      localStorage.setItem(clave, id);
    }
    return id;
  } catch {
    return `ses_fallback_${Date.now()}`;
  }
}

/**
 * Fuerza un nuevo ID de sesión para el usuario (p.ej. al hacer login).
 */
export function renovarIdSesion(usuarioId: string): string {
  if (typeof window === "undefined") return generarSesionIdSeguro();
  try {
    const clave = `${STORAGE_KEY_SESION_ACTUAL}_${usuarioId}`;
    const nuevoId = generarSesionIdSeguro();
    localStorage.setItem(clave, nuevoId);
    return nuevoId;
  } catch {
    return generarSesionIdSeguro();
  }
}

// ----------------------------------------------------------------------------
// FORMATEO
// ----------------------------------------------------------------------------

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

  if (supabase && tablaSesionDisponible) {
    try {
      const { data } = await supabase.rpc("club_purgar_actividad_10_dias");
      if (typeof data === "number") borrados += data;
    } catch {
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
  ip?: string;
}): Promise<void> {
  if (!params.usuarioId || typeof window === "undefined") return;

  const sesionId = obtenerIdSesionActual(params.usuarioId);
  const ahoraIso = new Date().toISOString();
  const { navegador, dispositivo } = obtenerInfoCliente();

  try {
    const raw = localStorage.getItem(STORAGE_KEY_SESIONES);
    let sesiones: UsuarioSesionInfo[] = raw ? JSON.parse(raw) : [];

    const fechaLimite = Date.now() - MS_RETENCION;
    sesiones = sesiones.filter(
      (s) => new Date(s.ultimoLatido).getTime() >= fechaLimite
    );

    const idx = sesiones.findIndex((s) => s.usuarioId === params.usuarioId);
    if (idx >= 0) {
      sesiones[idx] = {
        ...sesiones[idx],
        ultimoLatido: ahoraIso,
        activo: true,
        paginaActual:
          params.paginaActual || sesiones[idx].paginaActual,
        nombre: params.nombre || sesiones[idx].nombre,
        rol: params.rol || sesiones[idx].rol,
        grupoId: params.grupoId ?? sesiones[idx].grupoId,
        dispositivo,
        navegador,
        ip: params.ip || sesiones[idx].ip,
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
        ip: params.ip,
      });
    }
    localStorage.setItem(STORAGE_KEY_SESIONES, JSON.stringify(sesiones));
  } catch {
    /* ignore */
  }

  if (supabase && tablaSesionDisponible) {
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
            ip: params.ip || null,
          },
        ],
        { onConflict: "id" }
      );
    } catch {
      /* best-effort */
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
  const detalleStr =
    typeof params.detalle === "object"
      ? JSON.stringify(params.detalle)
      : params.detalle || null;

  const item: UsuarioActividadItem = {
    id: `${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    sesionId,
    usuarioId: params.usuarioId,
    tipo: params.tipo,
    ruta:
      params.ruta ||
      (params.tipo === "PAGINA" ? window.location.pathname : undefined),
    accion:
      params.accion ||
      (params.tipo === "PAGINA"
        ? `Visita a ${formatearNombreRuta(
            params.ruta || window.location.pathname
          )}`
        : undefined),
    detalle: detalleStr,
    fecha: ahoraIso,
  };

  try {
    const raw = localStorage.getItem(STORAGE_KEY_ACTIVIDAD);
    let arr: UsuarioActividadItem[] = raw ? JSON.parse(raw) : [];

    const fechaLimite = Date.now() - MS_RETENCION;
    arr = arr.filter((x) => new Date(x.fecha).getTime() >= fechaLimite);

    arr.unshift(item);
    if (arr.length > 1500) arr = arr.slice(0, 1500);

    localStorage.setItem(STORAGE_KEY_ACTIVIDAD, JSON.stringify(arr));
  } catch {
    /* ignore */
  }

  if (supabase && tablaSesionDisponible) {
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

  if (supabase && tablaSesionDisponible) {
    try {
      const { data, error } = await supabase
        .from("usuario_sesion")
        .select("*")
        .gte("ultimo_latido", new Date(limite10Dias).toISOString())
        .order("ultimo_latido", { ascending: false });

      if (!error && Array.isArray(data) && data.length > 0) {
        sesiones = (data as Record<string, unknown>[]).map((d) => {
          const tLatido = new Date(d.ultimo_latido as string).getTime();
          const tInicio = new Date(d.inicio_sesion as string).getTime();
          const online =
            !isNaN(tLatido) && ahora - tLatido < MS_TIMEOUT_ONLINE;
          const duracionMs = Math.max(
            0,
            !isNaN(tInicio) ? ahora - tInicio : 0
          );

          return {
            id: d.id as string,
            usuarioId: d.usuario_id as string,
            nombre: (d.nombre as string) || (d.usuario_id as string),
            rol: (d.rol as string) || "Operador",
            grupoId: (d.grupo_id as string) || null,
            inicioSesion: d.inicio_sesion as string,
            ultimoLatido: d.ultimo_latido as string,
            activo: Boolean(d.activo),
            online,
            tiempoConexionTexto: formatearDuracion(duracionMs),
            duracionSegundos: Math.floor(duracionMs / 1000),
            ip: d.ip as string | null,
            dispositivo: d.dispositivo as string | null,
            navegador: d.navegador as string | null,
            paginaActual: d.pagina_actual as string | null,
          };
        });
      }
    } catch {
      /* fallback a local */
    }
  }

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
          const duracionMs = Math.max(
            0,
            !isNaN(tInicio) ? ahora - tInicio : 0
          );

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

  return sesiones.sort((a, b) => {
    if (a.online && !b.online) return -1;
    if (!a.online && b.online) return 1;
    return (
      new Date(b.ultimoLatido).getTime() - new Date(a.ultimoLatido).getTime()
    );
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

  if (supabase && tablaSesionDisponible) {
    try {
      const { data, error } = await supabase
        .from("usuario_actividad")
        .select("*")
        .eq("usuario_id", usuarioId)
        .gte("fecha", limite10DiasIso)
        .order("fecha", { ascending: false })
        .limit(250);

      if (!error && Array.isArray(data) && data.length > 0) {
        actividades = (data as Record<string, unknown>[]).map((d) => ({
          id: d.id as string | number,
          sesionId: d.sesion_id as string,
          usuarioId: d.usuario_id as string,
          tipo: d.tipo as "PAGINA" | "ACCION",
          ruta: d.ruta as string | null,
          accion: d.accion as string | null,
          detalle: d.detalle as string | null,
          fecha: d.fecha as string,
          ip: d.ip as string | null,
        }));
      }
    } catch {
      /* fallback */
    }
  }

  if (typeof window !== "undefined") {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_ACTIVIDAD);
      if (raw) {
        const locales = JSON.parse(raw) as UsuarioActividadItem[];
        const usuarioLocales = locales.filter(
          (a) =>
            a.usuarioId === usuarioId &&
            new Date(a.fecha).getTime() >= Date.now() - MS_RETENCION
        );
        for (const loc of usuarioLocales) {
          if (
            !actividades.some(
              (a) =>
                a.id === loc.id ||
                (a.fecha === loc.fecha && a.accion === loc.accion)
            )
          ) {
            actividades.push(loc);
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  actividades.sort(
    (a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()
  );

  const paginas = actividades.filter((a) => a.tipo === "PAGINA");
  const acciones = actividades.filter((a) => a.tipo === "ACCION");

  return {
    paginas,
    acciones,
    totalPaginas: paginas.length,
    totalAcciones: acciones.length,
  };
}


// ----------------------------------------------------------------------------
// HEARTBEAT DE SESIÓN ACTIVA Y CONTROL DE IP ÚNICA (MÓDULO 1)
// ----------------------------------------------------------------------------

let _heartbeatTimer: ReturnType<typeof setInterval> | null = null;

export interface ParamsHeartbeatSesion {
  sesionId: string;
  usuarioId: string;
  nombre?: string;
  rol?: string;
  grupoId?: string | null;
  ipInicial: string;
  onCambioIp?: (nuevaIp: string) => void;
  onSesionInvalida?: () => void;
}

export function iniciarHeartbeatSesion(params: ParamsHeartbeatSesion): void {
  if (typeof window === "undefined") return;
  detenerHeartbeatSesion();

  void registrarLatidoPresencia({
    usuarioId: params.usuarioId,
    nombre: params.nombre,
    rol: params.rol,
    grupoId: params.grupoId,
    ip: params.ipInicial,
  });

  _heartbeatTimer = setInterval(async () => {
    try {
      const ipActual = await obtenerIpCliente();
      if (
        ipActual &&
        params.ipInicial &&
        ipActual !== params.ipInicial &&
        ipActual !== "127.0.0.1" &&
        params.ipInicial !== "127.0.0.1" &&
        ipActual !== "0.0.0.0" &&
        params.ipInicial !== "0.0.0.0"
      ) {
        detenerHeartbeatSesion();
        params.onCambioIp?.(ipActual);
        return;
      }

      await registrarLatidoPresencia({
        usuarioId: params.usuarioId,
        nombre: params.nombre,
        rol: params.rol,
        grupoId: params.grupoId,
        ip: ipActual || params.ipInicial,
      });
    } catch {
      /* ignore */
    }
  }, 20000);
}

export function detenerHeartbeatSesion(): void {
  if (_heartbeatTimer) {
    clearInterval(_heartbeatTimer);
    _heartbeatTimer = null;
  }
}
