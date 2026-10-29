/**
 * Control de Bloqueo / Desbloqueo de Venta de Jugadas en el Portal de Clientes
 * ----------------------------------------------------------------------------
 * Permite al Administrador bloquear o habilitar en tiempo real la venta de:
 *   - Marcas (`marcas`)
 *   - Tablas Fijas (`tablas_fijas`)
 *   - Puestos (`puestos`)
 *   - Remates (`remates`)
 *   - Dupletas (`dupletas`)
 *   - Pollas (`pollas`)
 *
 * Y permite al jugador solicitar el desbloqueo cuando una modalidad está
 * bloqueada, enviando una notificación inmediata al panel del Administrador.
 */
import { supabase } from "@/core/supabase";
import type { ClienteRow } from "@/features/clientes/lib/clientes";
import { crearTicketIncidencia } from "@/features/soporte/lib/ticketsStorage";

export type ModalidadPortalJugada =
  | "marcas"
  | "tablas_fijas"
  | "puestos"
  | "remates"
  | "dupletas"
  | "pollas";

export type EstadoBloqueoJugadas = Record<ModalidadPortalJugada, boolean>;

export const MODALIDADES_PORTAL_META: ReadonlyArray<{
  id: ModalidadPortalJugada;
  etiqueta: string;
  icono: string;
  descripcion: string;
}> = [
  {
    id: "marcas",
    etiqueta: "Marcas",
    icono: "⚔️",
    descripcion: "Pareos por jerarquía en proporción múltiplo de 6",
  },
  {
    id: "tablas_fijas",
    etiqueta: "Tablas Fijas",
    icono: "🏁",
    descripcion: "Compra de tablas por cada caballo de la carrera",
  },
  {
    id: "puestos",
    etiqueta: "Puestos",
    icono: "🥇",
    descripcion: "Jugadas a ganador, puestos (1P, 2P, 3P) y proporciones",
  },
  {
    id: "remates",
    etiqueta: "Remates",
    icono: "🔨",
    descripcion: "Pujas y compra de ejemplares en cuadros de remate",
  },
  {
    id: "dupletas",
    etiqueta: "Dupletas",
    icono: "🔀",
    descripcion: "Combinaciones de 1ª y 2ª pata entre dos carreras",
  },
  {
    id: "pollas",
    etiqueta: "Pollas",
    icono: "🎯",
    descripcion: "Selección de ejemplares en las 6 carreras válidas",
  },
];

export const BLOQUEO_POR_DEFECTO: EstadoBloqueoJugadas = {
  marcas: false,
  tablas_fijas: false,
  puestos: false,
  remates: false,
  dupletas: false,
  pollas: false,
};

const STORAGE_KEY = "sistema_hipico.bloqueo_jugadas_portal.v1";

/**
 * Ajusta cualquier monto ingresado por el jugador en Marcas al múltiplo de 6
 * más cercano (mínimo 6).
 */
export function ajustarMontoMultiploDe6(valor: number | string): {
  original: number;
  ajustado: number;
  fueAjustado: boolean;
} {
  const num = typeof valor === "number" ? valor : parseFloat(String(valor ?? "").replace(",", "."));
  const limpio = Number.isFinite(num) && num > 0 ? num : 6;
  const ajustado = Math.max(6, Math.round(limpio / 6) * 6);
  return {
    original: limpio,
    ajustado,
    fueAjustado: Math.abs(limpio - ajustado) > 0.001,
  };
}

function normalizarMapaBloqueo(raw: unknown): EstadoBloqueoJugadas {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    marcas: Boolean(obj.marcas),
    tablas_fijas: Boolean(obj.tablas_fijas),
    puestos: Boolean(obj.puestos),
    remates: Boolean(obj.remates),
    dupletas: Boolean(obj.dupletas),
    pollas: Boolean(obj.pollas),
  };
}

export function leerBloqueosJugadasCache(): EstadoBloqueoJugadas {
  if (typeof window === "undefined") return { ...BLOQUEO_POR_DEFECTO };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...BLOQUEO_POR_DEFECTO };
    return normalizarMapaBloqueo(JSON.parse(raw));
  } catch {
    return { ...BLOQUEO_POR_DEFECTO };
  }
}

function guardarBloqueosCache(estado: EstadoBloqueoJugadas): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(estado));
    window.dispatchEvent(new CustomEvent("bloqueos-jugadas-actualizados", { detail: estado }));
  } catch {
    // ignore
  }
}

/**
 * Lee el estado actual de bloqueo/desbloqueo de las 6 modalidades desde Supabase
 * (registro de configuración en `notificaciones` con `tipo = 'config_bloqueo_jugadas'`)
 * con respaldo instantáneo en `localStorage`.
 */
export async function leerBloqueosJugadas(): Promise<EstadoBloqueoJugadas> {
  const local = leerBloqueosJugadasCache();
  if (!supabase) return local;
  try {
    const { data, error } = await supabase
      .from("notificaciones")
      .select("datos, created_at")
      .eq("tipo", "config_bloqueo_jugadas")
      .order("created_at", { ascending: false })
      .limit(1);
    if (!error && data && data.length > 0 && data[0]?.datos) {
      const remoto = normalizarMapaBloqueo(data[0].datos);
      guardarBloqueosCache(remoto);
      return remoto;
    }
  } catch {
    // fallback a cache
  }
  return local;
}

/**
 * Guarda el estado de bloqueo/desbloqueo de las modalidades (acción del Administrador).
 */
export async function guardarBloqueosJugadas(
  nuevoEstado: EstadoBloqueoJugadas
): Promise<{ ok: boolean; error?: string }> {
  const normalizado = normalizarMapaBloqueo(nuevoEstado);
  guardarBloqueosCache(normalizado);
  if (!supabase) return { ok: true };
  try {
    // Limpiar configuraciones previas y dejar el estado vigente
    await supabase
      .from("notificaciones")
      .delete()
      .eq("tipo", "config_bloqueo_jugadas")
      .then(() => undefined, () => undefined);

    const bloqueadas = MODALIDADES_PORTAL_META.filter((m) => normalizado[m.id]).map((m) => m.etiqueta);
    const { error } = await supabase.from("notificaciones").insert([
      {
        tipo: "config_bloqueo_jugadas",
        titulo: "Configuración de bloqueo de jugadas del Portal",
        mensaje:
          bloqueadas.length > 0
            ? `Modalidades bloqueadas: ${bloqueadas.join(", ")}`
            : "Todas las modalidades están desbloqueadas para la venta.",
        cliente_nombre: "ADMINISTRADOR",
        datos: normalizado,
        estado: "Atendida",
      },
    ]);
    if (error) return { ok: true };
    return { ok: true };
  } catch (e) {
    return { ok: true, error: (e as Error).message };
  }
}

/**
 * Permite al jugador solicitar al Administrador el desbloqueo de una modalidad
 * cuando intenta comprar y se encuentra bloqueada.
 */
export async function solicitarDesbloqueoJugada(opts: {
  cliente: ClienteRow;
  modalidad: ModalidadPortalJugada;
  hipodromo?: string;
  carrera?: number | string;
  nota?: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  const meta = MODALIDADES_PORTAL_META.find((m) => m.id === opts.modalidad);
  const etiqueta = meta?.etiqueta ?? opts.modalidad.toUpperCase();
  const nombreCliente = String(opts.cliente.seudonimo || opts.cliente.nombre || "Cliente").trim();
  const contexto = [
    opts.hipodromo ? String(opts.hipodromo).toUpperCase() : "",
    opts.carrera ? `Carrera #${opts.carrera}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  try {
    // 1. Guardar en notificaciones para auditoría y persistencia multi-dispositivo
    const { error } = await supabase.from("notificaciones").insert([
      {
        tipo: "solicitud_desbloqueo",
        titulo: `🔓 Solicitud de desbloqueo: ${etiqueta}`,
        mensaje: `El jugador ${nombreCliente} solicita desbloquear la venta de ${etiqueta}${
          contexto ? ` (${contexto})` : ""
        }.${opts.nota ? ` Nota: ${opts.nota}` : ""}`,
        cliente_id: opts.cliente.id,
        cliente_nombre: nombreCliente,
        datos: {
          modalidad: opts.modalidad,
          etiqueta,
          hipodromo: opts.hipodromo ?? null,
          carrera: opts.carrera ?? null,
          nota: opts.nota ?? null,
          solicitado_en: new Date().toISOString(),
        },
        estado: "Nueva",
      },
    ]);

    // 2. Crear inmediatamente el Ticket de Incidencia Oficial para la barra de Tickets Pendientes
    try {
      crearTicketIncidencia({
        titulo: `🔓 Solicitud de desbloqueo: ${etiqueta}`,
        descripcion: `El jugador ${nombreCliente} solicita desbloquear la modalidad ${etiqueta}${
          contexto ? ` (${contexto})` : ""
        }.${opts.nota ? ` Nota del jugador: ${opts.nota}` : ""}`,
        categoria: "desbloqueo",
        prioridad: "alta",
        emisor: {
          id: String(opts.cliente.id),
          nombre: nombreCliente,
          rol: "cliente",
          grupoId: opts.cliente.grupo_id ? String(opts.cliente.grupo_id) : null,
          grupoNombre: null,
          telefono: opts.cliente.telefono || undefined,
        },
        destinatario: "admin",
      });
    } catch {
      // Ignorar si el storage local falla, la notificación en BD ya fue creada
    }

    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
