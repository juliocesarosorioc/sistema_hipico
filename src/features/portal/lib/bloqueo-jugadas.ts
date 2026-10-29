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

// ============================================================================
// CONTROL DE ESTADO DE CARRERAS (BLOQUEO ESTRICTO POST-CIERRE / PARTIDA)
// ============================================================================

export const MENSAJE_CARRERA_CERRADA =
  "⛔ Esta carrera ya se encuentra cerrada. No se permiten más jugadas ni propuestas.";

export type EstadoOperativoCarrera =
  | "ABIERTA"
  | "CERRADA"
  | "LIQUIDADA"
  | "PARTIDA"
  | "EN_CURSO"
  | "FINALIZADA"
  | string;

export interface DatosEstadoCarrera {
  hipodromo?: string | null;
  carrera?: number | string | null;
  fecha?: string | null;
  estado?: EstadoOperativoCarrera | null;
  estatus?: EstadoOperativoCarrera | null;
  cerrada?: boolean | null;
  liquidada?: boolean | null;
  horaPartida?: string | Date | number | null;
  ahora?: Date | number | null;
}

const estadoCarrerasEnMemoria = new Map<
  string,
  { estado: string; cerrada: boolean; horaPartida?: string | null; actualizadoEn: string }
>();

function claveCarreraEstado(
  hipodromo?: string | null,
  carrera?: number | string | null,
  fecha?: string | null
): string {
  const hip = String(hipodromo ?? "GENERAL").trim().toUpperCase() || "GENERAL";
  const car = String(carrera ?? "0").trim().replace(/^C/i, "");
  const fec = String(fecha ?? "").trim().slice(0, 10);
  return fec ? `${hip}::${car}::${fec}` : `${hip}::${car}`;
}

export function esEstadoCarreraCerrada(estado?: string | null): boolean {
  if (!estado) return false;
  const norm = String(estado).trim().toUpperCase();
  return /\b(CERRAD[AO]S?|LIQUIDAD[AO]S?|FINALIZAD[AO]S?|PARTIDA|EN[_\s-]*CURSO|CORRIENDO|OFICIAL|TERMINAD[AO]S?|BLOQUEAD[AO]S?)\b/.test(
    norm
  );
}

export function yaDioLaPartidaPorHora(
  horaPartida?: string | Date | number | null,
  ahoraInput?: Date | number | null,
  fechaCarrera?: string | null
): boolean {
  if (horaPartida === null || horaPartida === undefined || horaPartida === "") return false;
  const ahoraDate =
    ahoraInput instanceof Date
      ? ahoraInput
      : typeof ahoraInput === "number"
        ? new Date(ahoraInput)
        : new Date();
  const ahoraMs = ahoraDate.getTime();
  if (!Number.isFinite(ahoraMs)) return false;

  if (horaPartida instanceof Date) {
    return Number.isFinite(horaPartida.getTime()) && ahoraMs >= horaPartida.getTime();
  }
  if (typeof horaPartida === "number") {
    return Number.isFinite(horaPartida) && ahoraMs >= horaPartida;
  }

  const raw = String(horaPartida).trim();
  if (!raw) return false;

  // Si es sólo hora tipo "14:30", "14:30:00" o "2:30 PM"
  const mHora = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|A\.M\.|P\.M\.)?$/i.exec(raw);
  if (mHora) {
    let hh = Number(mHora[1]);
    const mm = Number(mHora[2]);
    const ss = mHora[3] ? Number(mHora[3]) : 0;
    const ampm = mHora[4] ? mHora[4].toUpperCase().replace(/\./g, "") : "";
    if (ampm === "PM" && hh < 12) hh += 12;
    if (ampm === "AM" && hh === 12) hh = 0;

    const baseDate = new Date(ahoraMs);
    if (fechaCarrera && /^\d{4}-\d{2}-\d{2}$/.test(fechaCarrera.trim())) {
      const [y, m, d] = fechaCarrera.trim().split("-").map(Number);
      baseDate.setFullYear(y, m - 1, d);
    }
    baseDate.setHours(hh, mm, ss, 0);
    return ahoraMs >= baseDate.getTime();
  }

  const parsedMs = Date.parse(raw);
  if (Number.isFinite(parsedMs)) {
    return ahoraMs >= parsedMs;
  }
  return false;
}

export function marcarEstadoCarreraEnMemoria(opts: {
  hipodromo?: string | null;
  carrera: number | string;
  fecha?: string | null;
  estado: EstadoOperativoCarrera;
  horaPartida?: string | null;
}): void {
  const est = String(opts.estado ?? "ABIERTA").trim().toUpperCase();
  const cerrada = esEstadoCarreraCerrada(est);
  const entrada = {
    estado: est,
    cerrada,
    horaPartida: opts.horaPartida ?? null,
    actualizadoEn: new Date().toISOString(),
  };
  estadoCarrerasEnMemoria.set(claveCarreraEstado(opts.hipodromo, opts.carrera, opts.fecha), entrada);
  // También indexar sin fecha para consultas rápidas por (hipodromo, carrera)
  if (opts.fecha) {
    estadoCarrerasEnMemoria.set(claveCarreraEstado(opts.hipodromo, opts.carrera, null), entrada);
  }
}

export function obtenerEstadoCarreraEnMemoria(opts: {
  hipodromo?: string | null;
  carrera: number | string;
  fecha?: string | null;
}): { estado: string; cerrada: boolean; horaPartida?: string | null } | undefined {
  if (opts.fecha) {
    const conFecha = estadoCarrerasEnMemoria.get(
      claveCarreraEstado(opts.hipodromo, opts.carrera, opts.fecha)
    );
    if (conFecha) return conFecha;
  }
  return (
    estadoCarrerasEnMemoria.get(claveCarreraEstado(opts.hipodromo, opts.carrera, null)) ??
    estadoCarrerasEnMemoria.get(claveCarreraEstado("GENERAL", opts.carrera, null))
  );
}

export function limpiarEstadosCarreraEnMemoria(): void {
  estadoCarrerasEnMemoria.clear();
}

/**
 * Verificación pura e inmediata de si una carrera está cerrada, liquidada o ya dio la partida.
 */
export function esCarreraCerradaOEnPartida(
  info?: DatosEstadoCarrera | string | boolean | null
): boolean {
  if (info === null || info === undefined) return false;
  if (typeof info === "boolean") return info;
  if (typeof info === "string") return esEstadoCarreraCerrada(info);

  if (info.cerrada === true || info.liquidada === true) return true;
  if (esEstadoCarreraCerrada(info.estado) || esEstadoCarreraCerrada(info.estatus)) return true;
  if (yaDioLaPartidaPorHora(info.horaPartida, info.ahora, info.fecha)) return true;

  if (info.carrera !== null && info.carrera !== undefined) {
    const enMem = obtenerEstadoCarreraEnMemoria({
      hipodromo: info.hipodromo,
      carrera: info.carrera,
      fecha: info.fecha,
    });
    if (enMem) {
      if (enMem.cerrada) return true;
      if (yaDioLaPartidaPorHora(enMem.horaPartida, info.ahora, info.fecha)) return true;
    }
  }
  return false;
}

/**
 * Verifica el estado de una carrera consultando primero el contexto en memoria / parámetros
 * y luego (si hay conexión y no se determinó el cierre aún) las tablas `ih_carreras_programa`,
 * `carreras` y `resultados_carreras` en Supabase.
 */
export async function verificarEstadoCarreraParaJugada(
  info?: DatosEstadoCarrera | string | boolean | null
): Promise<{
  permitida: boolean;
  cerrada: boolean;
  estado: string;
  mensaje?: string;
}> {
  if (esCarreraCerradaOEnPartida(info)) {
    const estTexto =
      typeof info === "string"
        ? info.trim().toUpperCase()
        : typeof info === "object" && info !== null && (info.estado || info.estatus)
          ? String(info.estado || info.estatus).trim().toUpperCase()
          : "CERRADA";
    return {
      permitida: false,
      cerrada: true,
      estado: estTexto,
      mensaje: MENSAJE_CARRERA_CERRADA,
    };
  }

  if (info && typeof info === "object" && info.carrera != null && supabase) {
    const numCarrera = Number(String(info.carrera).replace(/\D+/g, ""));
    const hipNorm = info.hipodromo ? String(info.hipodromo).trim() : "";
    const fechaNorm = info.fecha ? String(info.fecha).slice(0, 10) : "";

    if (Number.isFinite(numCarrera) && numCarrera > 0) {
      // 1. Consultar `ih_carreras_programa`
      try {
        let qProg = supabase
          .from("ih_carreras_programa")
          .select("estado, estatus, hora_partida, post_time, cerrada")
          .eq("numero_carrera", numCarrera)
          .limit(5);
        if (fechaNorm) qProg = qProg.eq("fecha", fechaNorm);
        const { data: filasProg } = await qProg;
        if (Array.isArray(filasProg)) {
          for (const fila of filasProg as Array<Record<string, unknown>>) {
            const est = String(fila.estado ?? fila.estatus ?? "");
            const hp = (fila.hora_partida ?? fila.post_time ?? null) as string | null;
            if (
              Boolean(fila.cerrada) ||
              esEstadoCarreraCerrada(est) ||
              yaDioLaPartidaPorHora(hp, info.ahora, fechaNorm)
            ) {
              return {
                permitida: false,
                cerrada: true,
                estado: est ? est.toUpperCase() : "CERRADA",
                mensaje: MENSAJE_CARRERA_CERRADA,
              };
            }
          }
        }
      } catch {
        /* tabla opcional */
      }

      // 2. Consultar `carreras`
      try {
        let qCarr = supabase
          .from("carreras")
          .select("estado, estatus, hora_partida, cerrada")
          .eq("numero", numCarrera)
          .limit(5);
        if (fechaNorm) qCarr = qCarr.eq("fecha", fechaNorm);
        if (hipNorm) qCarr = qCarr.ilike("hipodromo", `%${hipNorm}%`);
        const { data: filasCarr } = await qCarr;
        if (Array.isArray(filasCarr)) {
          for (const fila of filasCarr as Array<Record<string, unknown>>) {
            const est = String(fila.estado ?? fila.estatus ?? "");
            const hp = (fila.hora_partida ?? null) as string | null;
            if (
              Boolean(fila.cerrada) ||
              esEstadoCarreraCerrada(est) ||
              yaDioLaPartidaPorHora(hp, info.ahora, fechaNorm)
            ) {
              return {
                permitida: false,
                cerrada: true,
                estado: est ? est.toUpperCase() : "CERRADA",
                mensaje: MENSAJE_CARRERA_CERRADA,
              };
            }
          }
        }
      } catch {
        /* tabla opcional */
      }

      // 3. Consultar `resultados_carreras` (si ya tiene resultado oficial → LIQUIDADA)
      if (hipNorm) {
        try {
          let qRes = supabase
            .from("resultados_carreras")
            .select("primero, orden_llegada")
            .eq("carrera", numCarrera)
            .ilike("hipodromo", hipNorm.toUpperCase())
            .limit(1);
          if (fechaNorm) qRes = qRes.eq("fecha", fechaNorm);
          const { data: filasRes } = await qRes;
          if (Array.isArray(filasRes) && filasRes.length > 0) {
            const r0 = filasRes[0] as Record<string, unknown>;
            const tieneOrden =
              Boolean(r0.primero) ||
              (Array.isArray(r0.orden_llegada) && r0.orden_llegada.length > 0);
            if (tieneOrden) {
              return {
                permitida: false,
                cerrada: true,
                estado: "LIQUIDADA",
                mensaje: MENSAJE_CARRERA_CERRADA,
              };
            }
          }
        } catch {
          /* tabla opcional */
        }
      }
    }
  }

  return {
    permitida: true,
    cerrada: false,
    estado: "ABIERTA",
  };
}

