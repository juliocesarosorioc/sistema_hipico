import { supabase } from "@/core/supabase";

export type RolSolicitado = "JUGADOR" | "BANQUERO" | "OPERADOR" | "SOCIO_AGENCIA";

export type EstadoSolicitud = "PENDIENTE_APROBACION" | "APROBADO" | "RECHAZADO";

export type SolicitudRegistro = {
  id?: string;
  nombre: string;
  usuario: string;
  telefono: string;
  correo: string;
  rol_solicitado: RolSolicitado;
  grupo_id?: string | null;
  grupo_nombre?: string | null;
  prueba_gratuita?: boolean;
  nombre_grupo_nuevo?: string | null;
  mensaje?: string | null;
  estado?: EstadoSolicitud;
  revisado_por?: string | null;
  fecha_revision?: string | null;
  notas_admin?: string | null;
  ip_origen?: string | null;
  created_at?: string;
  updated_at?: string;
};

export const ETIQUETAS_ROL: Record<RolSolicitado, { titulo: string; emoji: string; desc: string }> = {
  JUGADOR: {
    titulo: "Jugador / Apostador",
    emoji: "🐎",
    desc: "Para realizar jugadas, recargar saldo, consultar estado de cuenta y cobrar premios.",
  },
  BANQUERO: {
    titulo: "Banquero Comercial",
    emoji: "👔",
    desc: "Para tomar el lado contrario de las jugadas en espejo y recibir comisiones.",
  },
  OPERADOR: {
    titulo: "Operador de Taquilla / Agente",
    emoji: "🖥️",
    desc: "Para registrar jugadas, vender tickets por taquilla y cuadre diario.",
  },
  SOCIO_AGENCIA: {
    titulo: "Socio / Administrador de Grupo",
    emoji: "👑",
    desc: "Para administrar una sucursal, cartera de clientes y liquidación de grupo.",
  },
};

const CLAVE_STORAGE_SOLICITUDES = "sistema_hipico:solicitudes_registro_offline";

function obtenerSolicitudesLocales(): SolicitudRegistro[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CLAVE_STORAGE_SOLICITUDES);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function guardarSolicitudesLocales(lista: SolicitudRegistro[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CLAVE_STORAGE_SOLICITUDES, JSON.stringify(lista));
  } catch {
    /* ignore */
  }
}

/**
 * Registra una nueva solicitud de usuario en la base de datos con respaldo local.
 */
export async function registrarNuevaSolicitud(datos: {
  nombre: string;
  usuario: string;
  telefono: string;
  correo: string;
  rol_solicitado: RolSolicitado;
  grupo_id?: string | null;
  grupo_nombre?: string | null;
  prueba_gratuita?: boolean;
  nombre_grupo_nuevo?: string | null;
  mensaje?: string | null;
  clave_deseada?: string;
  ip_origen?: string | null;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const nombre = datos.nombre.trim();
  const usuario = datos.usuario.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
  const telefono = datos.telefono.trim();
  const correo = datos.correo.trim().toLowerCase();

  if (!nombre) return { ok: false, error: "Indique su nombre y apellido." };
  if (!usuario) return { ok: false, error: "Indique un nombre de usuario válido." };
  if (!telefono) return { ok: false, error: "Indique su número de WhatsApp para contacto." };

  const fila: SolicitudRegistro = {
    id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `sol-${Date.now()}`,
    nombre,
    usuario,
    telefono,
    correo,
    rol_solicitado: datos.rol_solicitado,
    grupo_id: datos.grupo_id || null,
    grupo_nombre: datos.grupo_nombre || null,
    prueba_gratuita: Boolean(datos.prueba_gratuita),
    nombre_grupo_nuevo: datos.nombre_grupo_nuevo?.trim() || null,
    mensaje: datos.mensaje?.trim() || null,
    estado: "PENDIENTE_APROBACION",
    ip_origen: datos.ip_origen || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // 1. Guardar en Supabase si está disponible
  let guardadoEnDb = false;
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("solicitudes_registro")
        .insert([fila])
        .select("id")
        .maybeSingle();

      if (!error && data?.id) {
        fila.id = String(data.id);
        guardadoEnDb = true;
      }
    } catch {
      /* fallback */
    }
  }

  // 2. Respaldo local para asegurar que la solicitud nunca se pierda
  const locales = obtenerSolicitudesLocales();
  locales.unshift(fila);
  guardarSolicitudesLocales(locales.slice(0, 50));

  return { ok: true, id: fila.id };
}

/**
 * Genera el texto formal y enlace de WhatsApp para que el solicitante
 * notifique al Administrador para aprobar su ingreso de forma inmediata.
 */
export function generarMensajeWhatsAppAprobacion(solicitud: {
  nombre: string;
  usuario: string;
  telefono: string;
  correo: string;
  rol_solicitado: RolSolicitado;
  grupo_nombre?: string | null;
  prueba_gratuita?: boolean;
  nombre_grupo_nuevo?: string | null;
  mensaje?: string | null;
}, telefonoAdmin = ""): { texto: string; url: string } {
  const rolEtiqueta = ETIQUETAS_ROL[solicitud.rol_solicitado]?.titulo || solicitud.rol_solicitado;
  const fechaStr = new Date().toLocaleString("es-VE", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const lineas: string[] = [
    "🏇 *SOLICITUD DE REGISTRO EN SISTEMA HÍPICO*",
    "━━━━━━━━━━━━━━━━━━━━━━━━━",
    `👤 *Nombre:* ${solicitud.nombre}`,
    `🆔 *Usuario:* ${solicitud.usuario}`,
    `📱 *WhatsApp:* ${solicitud.telefono}`,
    solicitud.correo ? `✉️ *Correo:* ${solicitud.correo}` : "",
    `🎯 *Rol Solicitado:* ${rolEtiqueta}`,
    solicitud.prueba_gratuita ? "🎁 *Plan Solicitado:* PRUEBA GRATUITA POR 2 SEMANAS (14 DÍAS)" : "",
    solicitud.nombre_grupo_nuevo ? `🏢 *Grupo / Centro Hípico a Registrar:* ${solicitud.nombre_grupo_nuevo}` : "",
    !solicitud.nombre_grupo_nuevo && solicitud.grupo_nombre ? `🏢 *Grupo:* ${solicitud.grupo_nombre}` : "",
    solicitud.mensaje ? `💬 *Nota:* "${solicitud.mensaje}"` : "",
    `📅 *Fecha de Solicitud:* ${fechaStr}`,
    "━━━━━━━━━━━━━━━━━━━━━━━━━",
    solicitud.prueba_gratuita
      ? "🔔 *Estimado Administrador:* He completado mi solicitud de *prueba gratuita por 2 semanas* para mi grupo. Solicito la aprobación y activación para iniciar. ¡Muchas gracias!"
      : "🔔 *Estimado Administrador:* He completado mi registro en la plataforma y solicito la *aprobación y activación* de mi cuenta para ingresar. ¡Muchas gracias!",
  ].filter(Boolean);

  const texto = lineas.join("\n");
  const telLimpio = telefonoAdmin.replace(/\D/g, "");
  const base = telLimpio ? `https://wa.me/${telLimpio}` : "https://api.whatsapp.com/send";
  const url = `${base}?text=${encodeURIComponent(texto)}`;

  return { texto, url };
}

/**
 * Lista las solicitudes registradas (para panel del administrador).
 */
export async function listarSolicitudesRegistro(filtroEstado?: EstadoSolicitud): Promise<SolicitudRegistro[]> {
  if (supabase) {
    try {
      let q = supabase
        .from("solicitudes_registro")
        .select("*")
        .order("created_at", { ascending: false });

      if (filtroEstado) {
        q = q.eq("estado", filtroEstado);
      }

      const { data, error } = await q.limit(100);
      if (!error && Array.isArray(data)) {
        return data as SolicitudRegistro[];
      }
    } catch {
      /* fallback */
    }
  }

  // Fallback local
  const locales = obtenerSolicitudesLocales();
  if (filtroEstado) {
    return locales.filter((s) => s.estado === filtroEstado);
  }
  return locales;
}

/**
 * Aprueba una solicitud de registro.
 */
export async function aprobarSolicitud(id: string, adminNombre = "ADMIN"): Promise<{ ok: boolean; error?: string }> {
  if (supabase) {
    try {
      const { error } = await supabase
        .from("solicitudes_registro")
        .update({
          estado: "APROBADO",
          revisado_por: adminNombre,
          fecha_revision: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);

      if (error) return { ok: false, error: error.message };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  // Actualizar en storage local
  const locales = obtenerSolicitudesLocales();
  const actualizados = locales.map((s) =>
    s.id === id
      ? { ...s, estado: "APROBADO" as EstadoSolicitud, revisado_por: adminNombre, fecha_revision: new Date().toISOString() }
      : s
  );
  guardarSolicitudesLocales(actualizados);

  return { ok: true };
}

/**
 * Rechaza una solicitud de registro.
 */
export async function rechazarSolicitud(id: string, adminNombre = "ADMIN", motivo = ""): Promise<{ ok: boolean; error?: string }> {
  if (supabase) {
    try {
      const { error } = await supabase
        .from("solicitudes_registro")
        .update({
          estado: "RECHAZADO",
          revisado_por: adminNombre,
          notas_admin: motivo,
          fecha_revision: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);

      if (error) return { ok: false, error: error.message };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  const locales = obtenerSolicitudesLocales();
  const actualizados = locales.map((s) =>
    s.id === id
      ? { ...s, estado: "RECHAZADO" as EstadoSolicitud, revisado_por: adminNombre, notas_admin: motivo, fecha_revision: new Date().toISOString() }
      : s
  );
  guardarSolicitudesLocales(actualizados);

  return { ok: true };
}
