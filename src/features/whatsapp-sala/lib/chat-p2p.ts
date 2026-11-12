import { supabase } from "@/core/supabase";

export interface EstadoCarreraGrupo {
  id?: string;
  grupo_id: string;
  hipodromo: string;
  carrera: number;
  fecha: string;
  estado: "ABIERTA" | "CERRADA" | "LIQUIDADA";
  distancia?: string;
  superficie?: string;
  hora?: string;
  ejemplares?: Array<{
    numero: string | number;
    nombre: string;
    jockey?: string;
    peso?: number | string;
    ml?: string;
    retirado?: boolean;
  }>;
  updated_at?: string;
}

export interface MensajeSala {
  id: string;
  grupo_id: string;
  autor_id?: string | null;
  autor_nombre: string;
  autor_rol: "JUGADOR" | "OPERADOR" | "ADMIN" | "BOT";
  texto: string;
  tipo:
    | "TEXTO"
    | "PROPUESTA"
    | "CONCRECION"
    | "IMAGEN_CARRERA"
    | "ESTADO_CARRERA"
    | "PIZARRA"
    | "DM_PRIVADO";
  destinatario_privado_id?: string | null;
  reply_to_msg_id?: string | null;
  propuesta_id?: string | null;
  monto_propuesto?: number;
  monto_disponible?: number;
  datos_jugada?: {
    jugador: string;
    rol: "JUEGA" | "DA";
    monto: number;
    jugada: string;
    caballo: string;
    contraparte?: string | null;
    estado?: "ACTIVA" | "ANULADA" | string;
  };
  solo_borrable_operador?: boolean;
  imagen_url?: string | null;
  created_at: string;
  // Propiedades calculadas en cliente
  esMio?: boolean;
  esPrivadoParaMi?: boolean;
  desglose_jugaron?: Array<{ jugador: string; monto: number }>;
}

export interface TicketP2P {
  id: string;
  numero_ticket: number;
  grupo_id: string;
  propuesta_msg_id?: string;
  juega_id?: string;
  juega_nombre: string;
  da_id?: string;
  da_nombre: string;
  monto: number;
  jugada: string;
  caballo: string;
  carrera: number;
  hipodromo: string;
  fecha: string;
  estado: "PENDIENTE" | "GANADOR" | "PERDEDOR" | "EMPATE";
  premio: number;
  created_at: string;
}

export interface SaldoPrivado {
  ok: boolean;
  id?: string;
  nombre?: string;
  saldo_actual: number;
  aval: number;
  riesgo_en_curso: number;
  disponible: number;
  libre: boolean;
  error?: string;
}

export interface GrupoSala {
  id: string;
  nombre: string;
  descripcion?: string;
  esCanalBot?: boolean;
  activo?: boolean;
  noLeidos?: number;
}

// ============================================================================
// COLORES OFICIALES DE GUALDRAPAS (USA / VENEZUELA)
// ============================================================================
export interface ColorGualdrapa {
  bg: string;
  text: string;
  border: string;
  nombreColor: string;
}

const GUALDRAPAS_MAP: Record<number, ColorGualdrapa> = {
  1: { bg: "#dc2626", text: "#ffffff", border: "#991b1b", nombreColor: "Rojo" },
  2: { bg: "#ffffff", text: "#000000", border: "#64748b", nombreColor: "Blanco" },
  3: { bg: "#2563eb", text: "#ffffff", border: "#1d4ed8", nombreColor: "Azul" },
  4: { bg: "#facc15", text: "#000000", border: "#ca8a04", nombreColor: "Amarillo" },
  5: { bg: "#16a34a", text: "#ffffff", border: "#15803d", nombreColor: "Verde" },
  6: { bg: "#0f172a", text: "#fde047", border: "#334155", nombreColor: "Negro" },
  7: { bg: "#ea580c", text: "#ffffff", border: "#c2410c", nombreColor: "Naranja" },
  8: { bg: "#ec4899", text: "#ffffff", border: "#be185d", nombreColor: "Rosado" },
  9: { bg: "#06b6d4", text: "#000000", border: "#0e7490", nombreColor: "Turquesa" },
  10: { bg: "#9333ea", text: "#ffffff", border: "#7e22ce", nombreColor: "Morado" },
  11: { bg: "#94a3b8", text: "#dc2626", border: "#64748b", nombreColor: "Gris" },
  12: { bg: "#84cc16", text: "#000000", border: "#65a30d", nombreColor: "Lima" },
  13: { bg: "#78350f", text: "#ffffff", border: "#451a03", nombreColor: "Marrón" },
  14: { bg: "#831843", text: "#fde047", border: "#500724", nombreColor: "Granate" },
  15: { bg: "#d97706", text: "#ffffff", border: "#b45309", nombreColor: "Caqui" },
  16: { bg: "#b45309", text: "#ffffff", border: "#78350f", nombreColor: "Cobre" },
  17: { bg: "#1e3a8a", text: "#ffffff", border: "#172554", nombreColor: "Azul Marino" },
  18: { bg: "#064e3b", text: "#ffffff", border: "#022c22", nombreColor: "Verde Bosque" },
  19: { bg: "#9d174d", text: "#ffffff", border: "#831843", nombreColor: "Fucsia Oscuro" },
  20: { bg: "#d946ef", text: "#ffffff", border: "#a21caf", nombreColor: "Fucsia" },
};

export function obtenerColorGualdrapa(numero: number | string): ColorGualdrapa {
  const n = typeof numero === "number" ? numero : parseInt(String(numero).replace(/\D+/g, ""), 10) || 1;
  return GUALDRAPAS_MAP[n] || { bg: "#475569", text: "#ffffff", border: "#334155", nombreColor: "Estándar" };
}

// ============================================================================
// RPC: OBTENER MI SALDO PRIVADO
// ============================================================================
export async function obtenerMiSaldoPrivado(clienteId?: string): Promise<SaldoPrivado> {
  if (!supabase) {
    return { ok: false, saldo_actual: 0, aval: 0, riesgo_en_curso: 0, disponible: 0, libre: false, error: "Sin conexión a base de datos" };
  }

  try {
    const { data, error } = await supabase.rpc("obtener_mi_saldo_privado", {
      p_cliente_id: clienteId || null,
    });

    if (error) {
      console.warn("[chat-p2p] Error en obtener_mi_saldo_privado RPC:", error);
      // Fallback a clientes tabla si RPC da error de permisos
      if (clienteId) {
        const { data: cli } = await supabase
          .from("clientes")
          .select("id, nombre, saldo_actual, aval, libre, modo_juego")
          .eq("id", clienteId)
          .maybeSingle();

        if (cli) {
          const esLibre = Boolean(cli.libre || String(cli.modo_juego).toLowerCase() === "libre");
          const disp = esLibre ? 999999 : Number(cli.saldo_actual || 0) + Number(cli.aval || 0);
          return {
            ok: true,
            id: cli.id,
            nombre: cli.nombre,
            saldo_actual: Number(cli.saldo_actual || 0),
            aval: Number(cli.aval || 0),
            riesgo_en_curso: 0,
            disponible: disp,
            libre: esLibre,
          };
        }
      }
      return { ok: false, saldo_actual: 0, aval: 0, riesgo_en_curso: 0, disponible: 0, libre: false, error: error.message };
    }

    return {
      ok: true,
      id: data?.id,
      nombre: data?.nombre,
      saldo_actual: Number(data?.saldo_actual ?? 0),
      aval: Number(data?.aval ?? 0),
      riesgo_en_curso: Number(data?.riesgo_en_curso ?? 0),
      disponible: Number(data?.disponible ?? 0),
      libre: Boolean(data?.libre),
    };
  } catch (err: any) {
    return { ok: false, saldo_actual: 0, aval: 0, riesgo_en_curso: 0, disponible: 0, libre: false, error: err?.message };
  }
}

// ============================================================================
// RPC: PROCESAR RESPUESTA JUGADA FIFO
// ============================================================================
export async function procesarRespuestaJugadaFifo(params: {
  grupoId: string;
  propuestaMsgId: string;
  respondeUsuarioId?: string;
  respondeNombre: string;
  montoOComando: string;
}): Promise<{
  ok: boolean;
  numero_ticket?: number;
  monto_concretado?: number;
  monto_restante_propuesta?: number;
  parada_completa?: boolean;
  error?: string;
}> {
  if (!supabase) return { ok: false, error: "Sin conexión a base de datos" };

  try {
    const { data, error } = await supabase.rpc("procesar_respuesta_jugada_fifo", {
      p_grupo_id: params.grupoId,
      p_propuesta_msg_id: params.propuestaMsgId,
      p_responde_usuario_id: params.respondeUsuarioId || null,
      p_responde_nombre: params.respondeNombre,
      p_monto_o_comando: params.montoOComando,
    });

    if (error) {
      return { ok: false, error: error.message };
    }

    return data as any;
  } catch (err: any) {
    return { ok: false, error: err?.message || "Error procesando jugada FIFO" };
  }
}

// ============================================================================
// RPC: LIQUIDAR CARRERA CHAT P2P
// ============================================================================
export async function liquidarCarreraChatP2p(params: {
  grupoId: string;
  pizarra: string;
  operadorNombre?: string;
}): Promise<{
  ok: boolean;
  hipodromo?: string;
  carrera?: number;
  pizarra?: string;
  ganador?: string;
  total_tickets?: number;
  ganadores?: number;
  error?: string;
}> {
  if (!supabase) return { ok: false, error: "Sin conexión a base de datos" };

  try {
    const { data, error } = await supabase.rpc("liquidar_carrera_chat_p2p", {
      p_grupo_id: params.grupoId,
      p_pizarra: params.pizarra,
      p_operador_nombre: params.operadorNombre || "OPERADOR",
    });

    if (error) return { ok: false, error: error.message };
    return data as any;
  } catch (err: any) {
    return { ok: false, error: err?.message || "Error liquidando carrera" };
  }
}

// ============================================================================
// RPC: EDITAR CARRERA ADMIN
// ============================================================================
export async function editarCarreraAdmin(params: {
  fechaActual: string;
  hipodromoActual: string;
  carreraActual: number;
  nuevaFecha: string;
  nuevoHipodromo: string;
  nuevaCarrera: number;
  distancia?: string;
  superficie?: string;
  ejemplares?: any;
}): Promise<{ ok: boolean; mensaje?: string; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a base de datos" };

  try {
    const { data, error } = await supabase.rpc("editar_carrera_admin", {
      p_fecha_actual: params.fechaActual,
      p_hipodromo_actual: params.hipodromoActual,
      p_carrera_actual: params.carreraActual,
      p_nueva_fecha: params.nuevaFecha,
      p_nuevo_hipodromo: params.nuevoHipodromo,
      p_nueva_carrera: params.nuevaCarrera,
      p_distancia: params.distancia || null,
      p_superficie: params.superficie || null,
      p_ejemplares: params.ejemplares || null,
    });

    if (error) return { ok: false, error: error.message };
    return data as any;
  } catch (err: any) {
    return { ok: false, error: err?.message || "Error editando carrera" };
  }
}

// ============================================================================
// PARSER DE COMANDOS EXCLUSIVOS DE OPERADOR
// ============================================================================
export type ComandoOperadorDetectado =
  | { tipo: "ABRIR_CARRERA"; hipodromo: string; carrera: number }
  | { tipo: "CERRAR_CARRERA" }
  | { tipo: "PIZARRA"; pizarra: string }
  | null;

export function detectarComandoOperador(texto: string): ComandoOperadorDetectado {
  const t = texto.trim();

  // 1. Pizarra de llegada (ej. "Pizarra 9-8-6", "Pizarra: 9 8 6", "Pizarra 4-2-1")
  const mPizarra = /^pizarra\s*[:=\-]?\s*([0-9\s,\/\-]+)$/i.exec(t);
  if (mPizarra) {
    const piz = mPizarra[1].trim().replace(/\s+/g, "-").replace(/,/g, "-");
    return { tipo: "PIZARRA", pizarra: piz };
  }

  // 2. Cerrada
  if (/^cerrada$|^cierra\s+carrera$|^cerrar\s+carrera$/i.test(t)) {
    return { tipo: "CERRAR_CARRERA" };
  }

  // 3. Abierta (ej. "Abierta La Rinconada 1", "Abierta BEL 1", "Abierta AQU 4", "Abre La Rinconada 7")
  const mAbierta = /^(?:abierta|abre|abrir)\s+([a-zA-Z\s]+?)\s+(\d+)$/i.exec(t);
  if (mAbierta) {
    const hipoRaw = mAbierta[1].trim().toUpperCase();
    const cNum = parseInt(mAbierta[2], 10) || 1;
    return { tipo: "ABRIR_CARRERA", hipodromo: hipoRaw, carrera: cNum };
  }

  // 4. Variante corta "Abierta 5" (usa el hipódromo activo)
  const mAbiertaNum = /^(?:abierta|abre)\s+(\d+)$/i.exec(t);
  if (mAbiertaNum) {
    return { tipo: "ABRIR_CARRERA", hipodromo: "", carrera: parseInt(mAbiertaNum[1], 10) || 1 };
  }

  return null;
}

export const MAX_DURACION_PROPUESTA_MS = 3 * 60 * 1000; // 3 minutos de duración máxima

export function esPropuestaExpirada(createdAt: string): boolean {
  if (!createdAt) return false;
  const t = new Date(createdAt).getTime();
  if (isNaN(t)) return false;
  return Date.now() - t > MAX_DURACION_PROPUESTA_MS;
}

export function tiempoRestantePropuestaMs(createdAt: string): number {
  if (!createdAt) return 0;
  const t = new Date(createdAt).getTime();
  if (isNaN(t)) return 0;
  return Math.max(0, MAX_DURACION_PROPUESTA_MS - (Date.now() - t));
}

// Comandos de anulación del usuario que propone:
// "Se fue", "CF", "SF", "Sfue", "sefue", "cancelo", "ya no juego"
export function detectarAnulacionUsuario(texto: string): boolean {
  const t = texto.trim().toLowerCase();
  return /^(?:se\s*fue|cf|sf|sfue|sefue|cancelo|cancelar|anulo|anular|ya\s+no\s+juego|no\s+juego\s+mas)$/i.test(t);
}

// Comando de anulación administrativa: /anular [id] o citar y decir /anular
export function detectarComandoAnularAdmin(texto: string): { esAnularAdmin: boolean; propuestaId?: string } {
  const t = texto.trim();
  const m = /^(?:\/anular|anular\s+propuesta)(?:\s+([a-zA-Z0-9_\-]+))?$/i.exec(t);
  if (m) {
    return { esAnularAdmin: true, propuestaId: m[1] || undefined };
  }
  return { esAnularAdmin: false };
}


// ============================================================================
// PARSER DE PROPUESTAS DE JUGADAS (MÓDULO 3)
// ============================================================================
export interface PropuestaParseada {
  esPropuesta: boolean;
  rol: "JUEGA" | "DA";
  monto: number;
  jugada: string;
  caballo: string;
  contraparte?: string;
}

export const PATRON_PUESTOS_CHAT =
  /^(1p|2p|3p|4p|5p|6p|2n|3n|4n|5n|1y2n|2y3n|3y4n|4y5n|2ny2y2n|2y2|3y3|4y4|5y5|2\/2|3\/3|4\/4|5\/5|pp|10\/\d+(?:\.\d+)?|10a\d+(?:\.\d+)?|ganador|place)$/i;

export function parsearPropuestaChat(texto: string): PropuestaParseada | null {
  const t = texto.trim();

  // Las jugadas del chat son exclusivamente jugadas de puestos:
  // "Juego 1p 7 100" | "Juego 2n 1 50" | "50 2p al 7" | "100 al 5" | "100 al 5 con @SAM" | "250 10/6 1.3"
  const mCon = /con\s+@?([a-zA-Z0-9_\-\.]+)/i.exec(t);
  const contraparte = mCon ? mCon[1].trim().toUpperCase() : undefined;
  const tLimpio = t.replace(/\s+con\s+@?[a-zA-Z0-9_\-\.]+/i, "").trim();

  // 1. "Juego <jugada_puestos> <caballo> <monto>"
  const m1 = /^(?:juego|jugar)\s+([0-9a-z\/\.\-]+)\s+(?:al?\s+)?([0-9\.\,x\-]+)\s+(?:por|\$)?\s*(\d+(?:[\.,]\d+)?)$/i.exec(tLimpio);
  if (m1 && PATRON_PUESTOS_CHAT.test(m1[1])) {
    return {
      esPropuesta: true,
      rol: "JUEGA",
      jugada: m1[1].toUpperCase(),
      caballo: m1[2],
      monto: parseFloat(m1[3].replace(",", ".")),
      contraparte,
    };
  }

  // 2. "Juego 7 100" o "Juego al 7 100" (puestos 1P por defecto)
  const m1b = /^(?:juego|jugar)\s+(?:al?\s+)?([0-9]{1,2})\s+(?:por|\$)?\s*(\d+(?:[\.,]\d+)?)$/i.exec(tLimpio);
  if (m1b) {
    return {
      esPropuesta: true,
      rol: "JUEGA",
      jugada: "1P",
      caballo: m1b[1],
      monto: parseFloat(m1b[2].replace(",", ".")),
      contraparte,
    };
  }

  // 3. "<monto> <jugada_puestos> [al?] <caballo>" (ej. "50 2p 7", "50 2n al 1", "250 10/6 1.3")
  const m2 = /^(\d+(?:[\.,]\d+)?)\s+([0-9a-z\/\.\-]+)\s+(?:al?\s+)?([0-9\.\,x\-]+)$/i.exec(tLimpio);
  if (m2 && PATRON_PUESTOS_CHAT.test(m2[2])) {
    return {
      esPropuesta: true,
      rol: "JUEGA",
      jugada: m2[2].toUpperCase(),
      caballo: m2[3],
      monto: parseFloat(m2[1].replace(",", ".")),
      contraparte,
    };
  }

  // 4. "<monto> al <caballo>" (1P)
  const m3 = /^(\d+(?:[\.,]\d+)?)\s*(?:al|a)\s*([0-9]{1,2})$/i.exec(tLimpio);
  if (m3) {
    return {
      esPropuesta: true,
      rol: "JUEGA",
      jugada: "1P",
      caballo: m3[2],
      monto: parseFloat(m3[1].replace(",", ".")),
      contraparte,
    };
  }

  return null;
}

