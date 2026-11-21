/**
 * RESPUESTAS AUTOMÁTICAS DE CUENTA / DEVOLUCIONES Y RECARGAS POR WHATSAPP
 * ======================================================================
 * Contrato consumido por `parsearJugada.ts` (otro agente):
 *
 *   detectarIntencionCuenta(texto)
 *   construirRespuestaCuenta({ cliente, grupoId, intencion, fecha, respuesta, participantJid })
 *
 * Y, para el flujo de recargas dictadas al número del bot:
 *
 *   detectarComandoRecarga(texto)
 *   procesarComandoRecarga(params)
 *
 * Toda la lectura/escritura se hace con `supabaseAdmin`. Nunca se duplica la
 * lógica de saldo: CORTE reutiliza `construirResumenEstadoCuentaCliente`.
 */
import crypto from "node:crypto";
import { supabaseAdmin } from "@/core/supabase-admin";
import { formatearMontoRegional } from "@/shared/lib/dinero";
import { construirResumenEstadoCuentaCliente } from "@/features/whatsapp-sala/accionesAdmin";
import {
  validarSolicitudRecargaServidor,
  type SolicitudRecargaEntrada,
} from "@/features/sala-juegos/lib/recargas-server";
import type { IdentidadSala } from "@/features/sala-juegos/lib/sala-auth";

// ============================================================================
// DETECCIÓN DE INTENCIÓN DE CUENTA
// ============================================================================

export type IntencionCuenta = "CORTE" | "HOY" | "SEMANA" | "FECHA" | "DEVOLUCIONES";

export type DeteccionIntencionCuenta = {
  intencion: IntencionCuenta;
  fecha?: string;
  respuesta?: string;
};

const normalizar = (valor: unknown): string =>
  String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** "20/11/2026" o "20-11-2026" → "2026-11-20" (null si no es válida). */
export function parsearFechaTexto(texto: unknown): string | null {
  const m = /(\d{1,2})\s*[\/\-]\s*(\d{1,2})\s*[\/\-]\s*(\d{4})/.exec(String(texto ?? ""));
  if (!m) return null;
  const d = Number(m[1]);
  const mes = Number(m[2]);
  const anio = Number(m[3]);
  if (d < 1 || d > 31 || mes < 1 || mes > 12 || anio < 1900) return null;
  return `${anio}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** DD/MM/AAAA legible desde "YYYY-MM-DD". */
function fechaLegible(iso: string): string {
  const [y, m, d] = String(iso).split("-");
  return `${d}/${m}/${y}`;
}

export const PREGUNTA_DEVOLUCIONES_1 = "1) ¿De qué fecha? (DD/MM/AAAA)";

/**
 * Detecta frases de cuenta en el texto del jugador. `null` para un texto que no
 * corresponde (p. ej. un `cuenta`/`mi cuenta` genérico, que sigue manejando el
 * flujo histórico de `parsearJugada.ts`).
 */
export function detectarIntencionCuenta(texto: string): DeteccionIntencionCuenta | null {
  const t = normalizar(texto);
  if (!t) return null;

  // La fecha va primero: "cuenta del 20/11/2026" no debe caer en HOY/SEMANA.
  const mFecha = /\bcuenta\s+(?:del|de)\s+\d{1,2}\s*[\/\-]\s*\d{1,2}\s*[\/\-]\s*\d{4}\b/.exec(t);
  if (mFecha) {
    const fecha = parsearFechaTexto(mFecha[0]);
    if (fecha) return { intencion: "FECHA", fecha };
    return { intencion: "FECHA", respuesta: "La fecha no es válida. Use DD/MM/AAAA (ej. 20/11/2026)." };
  }

  if (/\bdevolucion(?:es)?\b/.test(t)) {
    return { intencion: "DEVOLUCIONES", respuesta: `📋 *Devoluciones*\n${PREGUNTA_DEVOLUCIONES_1}` };
  }

  if (/\bcorte\b/.test(t)) return { intencion: "CORTE" };
  if (/\bcuenta\s+(?:de\s+)?hoy\b|\bhoy\s+(?:la\s+)?cuenta\b/.test(t)) return { intencion: "HOY" };
  if (/\bcuenta\s+(?:de\s+)?(?:la\s+)?semana\b|\bresumen\s+semanal\b/.test(t)) {
    return { intencion: "SEMANA" };
  }

  return null;
}

// ============================================================================
// CONSULTAS COMPARTIDAS DE OPERACIONES
// ============================================================================

const LIMITE_TICKETS = 500;

function rangoDia(fechaIso: string): { desde: string; hasta: string } {
  const dia = String(fechaIso).slice(0, 10);
  const d = new Date(`${dia}T12:00:00Z`);
  const siguiente = new Date(d.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { desde: `${dia}T00:00:00.000Z`, hasta: `${siguiente}T00:00:00.000Z` };
}

async function ticketsDelCliente(
  grupoId: string,
  clienteId: string,
  desde: string,
  hasta?: string
): Promise<any[]> {
  let q = supabaseAdmin
    .from("chat_tickets_fifo")
    .select("*")
    .eq("grupo_id", grupoId)
    .or(`proponente_id.eq.${clienteId},aceptante_id.eq.${clienteId}`)
    .gte("created_at", desde)
    .order("created_at", { ascending: true })
    .limit(LIMITE_TICKETS);
  if (hasta) q = q.lt("created_at", hasta);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data || []) as any[];
}

async function carrerasPorIds(ids: string[]): Promise<Map<string, any>> {
  const mapa = new Map<string, any>();
  const unicos = Array.from(new Set(ids.filter(Boolean).map(String)));
  if (unicos.length === 0) return mapa;
  try {
    const { data } = await supabaseAdmin
      .from("carreras")
      .select("id, fecha, hipodromo, carrera")
      .in("id", unicos);
    for (const c of data || []) mapa.set(String(c.id), c);
  } catch {
    // La tabla `carreras` puede no estar disponible en una instalación vieja.
  }
  return mapa;
}

type ResultadoCarrera = { fecha: string; hipodromo: string; carrera: number | string; llegada: string };

async function resultadosDelDia(fechaIso: string): Promise<ResultadoCarrera[]> {
  try {
    const { data } = await supabaseAdmin
      .from("resultados_carreras")
      .select("fecha, hipodromo, carrera, ganadores, orden_llegada")
      .eq("fecha", String(fechaIso).slice(0, 10))
      .limit(500);
    return (data || []).map((r: any) => ({
      fecha: String(r.fecha ?? "").slice(0, 10),
      hipodromo: String(r.hipodromo || "").trim().toUpperCase(),
      carrera: r.carrera,
      llegada: llegadaDeResultado(r),
    }));
  } catch {
    return [];
  }
}

function llegadaDeResultado(r: any): string {
  if (Array.isArray(r?.ganadores) && r.ganadores.length > 0) {
    return r.ganadores.map((n: any) => String(n)).join("-");
  }
  if (Array.isArray(r?.orden_llegada)) {
    return [...r.orden_llegada]
      .sort((a: any, b: any) => Number(a?.puesto ?? 0) - Number(b?.puesto ?? 0))
      .map((x: any) => String(x?.numero ?? x?.ejemplar ?? "").trim())
      .filter(Boolean)
      .join("-");
  }
  return "";
}

function claveTicket(t: any, carreras: Map<string, any>) {
  const c = carreras.get(String(t?.carrera_id));
  return {
    fecha: String(c?.fecha || t?.fecha_carrera || String(t?.created_at || "").slice(0, 10)).slice(0, 10),
    hipodromo: String(c?.hipodromo || t?.hipodromo || "HIPÓDROMO").trim().toUpperCase(),
    carrera: String(c?.carrera ?? t?.numero_carrera ?? "—").trim(),
  };
}

function netoDelTicket(t: any, clienteId: string): number {
  const monto = Number(t?.monto_concretado || 0);
  const estado = String(t?.estado || "").toUpperCase();
  const esProponente = String(t?.proponente_id) === String(clienteId);
  if (estado === "GANADOR_PROPONENTE") return esProponente ? monto : -monto;
  if (estado === "GANADOR_ACEPTANTE") return esProponente ? -monto : monto;
  return 0;
}

function estadoDelTicket(t: any, clienteId: string): string {
  const n = netoDelTicket(t, clienteId);
  const estado = String(t?.estado || "").toUpperCase();
  if (n > 0) return "🟢 Ganada";
  if (n < 0) return "🔴 Perdida";
  if (estado === "EMPATE") return "🤝 Empate";
  return "⏳ Pendiente";
}

function descripcionJugada(t: any): string {
  const mod = String(t?.modalidad || "1P").trim().toUpperCase();
  const ejemplar = String(t?.ejemplar_numero || (Array.isArray(t?.caballos_bando_a) ? t.caballos_bando_a.join("-") : "") || "—").trim();
  const monto = formatearMontoRegional(Number(t?.monto_concretado || 0));
  const detalle = t?.es_match
    ? `${(t.caballos_bando_a || []).join("-")}x${(t.caballos_bando_b || []).join("-")}`
    : `${mod} #${ejemplar}`;
  return `${detalle} · $${monto}`;
}

/** Detalle agrupado por Día.Hipódromo.Carrera, con la llegada oficial si hay. */
async function detallePorCarreras(tickets: any[], clienteId: string, fecha: string): Promise<string[]> {
  const carreras = await carrerasPorIds(tickets.map((t) => t?.carrera_id).filter(Boolean).map(String));
  const resultados = await resultadosDelDia(fecha);
  const grupos = new Map<string, { fecha: string; hipodromo: string; carrera: string; filas: any[] }>();

  for (const t of tickets) {
    const meta = claveTicket(t, carreras);
    const key = `${meta.fecha}|${meta.hipodromo}|${meta.carrera}`;
    if (!grupos.has(key)) grupos.set(key, { ...meta, filas: [] });
    grupos.get(key)!.filas.push(t);
  }

  if (grupos.size === 0) return ["_Sin operaciones para la fecha consultada._"];

  return Array.from(grupos.values()).map((g) => {
    const res = resultados.find(
      (r) =>
        (!r.hipodromo || r.hipodromo === g.hipodromo) &&
        String(r.carrera) === String(g.carrera)
    );
    const llegada = res?.llegada ? `\n🏁 Llegada: ${res.llegada}` : "";
    const filas = g.filas
      .map((t, i) => `${i + 1}) ${descripcionJugada(t)} · ${estadoDelTicket(t, clienteId)}`)
      .join("\n");
    return `📅 ${g.fecha} · 🏇 ${g.hipodromo} · Carrera ${g.carrera}${llegada}\n${filas}`;
  });
}

function fechaHoraLegible(valor: unknown): string {
  const texto = String(valor ?? "");
  if (!texto) return new Date().toLocaleString("es-VE", { dateStyle: "short", timeStyle: "short" });
  const d = new Date(texto);
  if (Number.isNaN(d.getTime())) return texto;
  return d.toLocaleString("es-VE", { dateStyle: "short", timeStyle: "short" });
}

// ============================================================================
// FLUJO GUIADO DE DEVOLUCIONES (estado en memoria por JID)
// ============================================================================

type EstadoDevolucion = {
  paso: 1 | 2 | 3 | 4;
  fecha?: string;
  hipodromoCarrera?: string;
  jugador?: string;
  actualizado: number;
};

const estadosDevolucion = new Map<string, EstadoDevolucion>();
const TTL_DEVOLUCIONES_MS = 15 * 60 * 1000;

function claveEstado(grupoId: string, cliente: any, participantJid?: string): string {
  return String(participantJid || `${grupoId}:${cliente?.id || "anónimo"}`);
}

function obtenerEstado(clave: string): EstadoDevolucion | null {
  const estado = estadosDevolucion.get(clave);
  if (!estado) return null;
  if (Date.now() - estado.actualizado > TTL_DEVOLUCIONES_MS) {
    estadosDevolucion.delete(clave);
    return null;
  }
  return estado;
}

async function responderDevoluciones(params: {
  cliente: any;
  grupoId: string;
  respuesta?: string;
  participantJid?: string;
}): Promise<string> {
  const { cliente, grupoId, participantJid } = params;
  const clave = claveEstado(grupoId, cliente, participantJid);
  const texto = String(params.respuesta || "").trim();
  const estado = obtenerEstado(clave);

  if (!texto || !estado) {
    estadosDevolucion.set(clave, { paso: 1, actualizado: Date.now() });
    return `📋 *Devoluciones*\n${PREGUNTA_DEVOLUCIONES_1}`;
  }

  if (estado.paso === 1) {
    const fecha = parsearFechaTexto(texto);
    if (!fecha) return `⚠️ Fecha no válida. ${PREGUNTA_DEVOLUCIONES_1}`;
    estadosDevolucion.set(clave, { ...estado, fecha, paso: 2, actualizado: Date.now() });
    return "2) ¿Hipódromo/carrera?";
  }
  if (estado.paso === 2) {
    estadosDevolucion.set(clave, { ...estado, hipodromoCarrera: texto, paso: 3, actualizado: Date.now() });
    return "3) ¿Nombre del jugador?";
  }
  if (estado.paso === 3) {
    estadosDevolucion.set(clave, { ...estado, jugador: texto, paso: 4, actualizado: Date.now() });
    return "4) ¿Motivo? (anulada/retirado/error)";
  }

  const motivo = normalizar(texto).replace(/s$/, "");
  if (!["anulada", "anulado", "retirado", "error"].includes(motivo)) {
    return "⚠️ Motivo no reconocido. 4) ¿Motivo? (anulada/retirado/error)";
  }

  estadosDevolucion.delete(clave);
  return detalleDevoluciones({
    grupoId,
    fecha: estado.fecha || "",
    hipodromoCarrera: estado.hipodromoCarrera || "",
    jugador: estado.jugador || "",
    motivo,
  });
}

async function detalleDevoluciones(params: {
  grupoId: string;
  fecha: string;
  hipodromoCarrera: string;
  jugador: string;
  motivo: string;
}): Promise<string> {
  const { grupoId, fecha, jugador, motivo } = params;
  if (!fecha) return "⚠️ No pude identificar la fecha. Escriba *devoluciones* para empezar de nuevo.";

  const { desde, hasta } = rangoDia(fecha);
  const { data, error } = await supabaseAdmin
    .from("chat_tickets_fifo")
    .select("*")
    .eq("grupo_id", grupoId)
    .gte("created_at", desde)
    .lt("created_at", hasta)
    .order("created_at", { ascending: true })
    .limit(LIMITE_TICKETS);
  if (error) return `⚠️ No se pudo consultar las devoluciones (${error.message}).`;

  let tickets = (data || []) as any[];
  const hipoCarrera = normalizar(params.hipodromoCarrera);
  const numCarrera = /\d+/.exec(hipoCarrera)?.[0] || "";
  const hipoTexto = hipoCarrera.replace(/\d+/, "").trim();
  const carreras = await carrerasPorIds(tickets.map((t) => t?.carrera_id).filter(Boolean).map(String));
  tickets = tickets.filter((t) => {
    const meta = claveTicket(t, carreras);
    const pasaHipodromo = !hipoTexto || normalizar(meta.hipodromo).includes(hipoTexto);
    const pasaCarrera = !numCarrera || String(meta.carrera) === numCarrera;
    return pasaHipodromo && pasaCarrera;
  });

  const nomJugador = normalizar(jugador);
  if (nomJugador) {
    tickets = tickets.filter((t) =>
      [t?.proponente_nombre, t?.aceptante_nombre].some((n: any) => normalizar(n).includes(nomJugador))
    );
  }

  const estadoMotivo =
    motivo === "anulada" ? /anulad|cancel|revers/ : motivo === "retirado" ? /retirad|retiro/ : /error|correcc/;
  tickets = tickets.filter((t) =>
    estadoMotivo.test(normalizar(t?.estado || "")) || estadoMotivo.test(normalizar(t?.motivo || t?.observacion || ""))
  );

  if (tickets.length === 0) {
    return (
      `🔍 No hay datos de devoluciones para ${fechaLegible(fecha)}` +
      (params.hipodromoCarrera ? ` · ${params.hipodromoCarrera}` : "") +
      (jugador ? ` · ${jugador}` : "") +
      ` con motivo *${motivo}*.`
    );
  }

  const resultados = await resultadosDelDia(fecha);
  const lineas = tickets.map((t, i) => {
    const meta = claveTicket(t, carreras);
    const res = resultados.find(
      (r) => (!r.hipodromo || r.hipodromo === meta.hipodromo) && String(r.carrera) === String(meta.carrera)
    );
    return (
      `${i + 1}) 📅 ${meta.fecha} · 🏇 ${meta.hipodromo} · Carrera ${meta.carrera}\n` +
      `   ${t.proponente_nombre || "Jugador A"} ↔ ${t.aceptante_nombre || "Jugador B"} · ` +
      `${descripcionJugada(t)} · Estado: ${String(t.estado || "—")}${res?.llegada ? ` · Llegada: ${res.llegada}` : ""}`
    );
  });

  return `📋 *Devoluciones del ${fechaLegible(fecha)}* (${tickets.length})\nMotivo: *${motivo}*\n\n${lineas.join("\n\n")}`;
}

// ============================================================================
// CONSTRUCCIÓN DE LA RESPUESTA (contrato obligatorio)
// ============================================================================

export async function construirRespuestaCuenta(params: {
  cliente: any;
  grupoId: string;
  intencion: IntencionCuenta;
  fecha?: string;
  respuesta?: string;
  participantJid?: string;
}): Promise<string | null> {
  const { cliente, grupoId, intencion } = params;
  if (!cliente?.id) return null;
  const clienteId = String(cliente.id);

  try {
    if (intencion === "CORTE") {
      const resumen = await construirResumenEstadoCuentaCliente(cliente, grupoId);
      const fechaCorte =
        cliente.fecha_corte || cliente.ultimo_corte || cliente.corte_at || cliente.fecha_cierre || new Date().toISOString();
      return `${resumen}\n\n🕒 *Fecha/Hora del corte:* ${fechaHoraLegible(fechaCorte)}`;
    }

    if (intencion === "DEVOLUCIONES") {
      return responderDevoluciones({
        cliente,
        grupoId,
        respuesta: params.respuesta,
        participantJid: params.participantJid,
      });
    }

    let fecha = String(params.fecha || "").slice(0, 10);
    const hoy = new Date().toISOString().slice(0, 10);
    if (intencion === "HOY") fecha = hoy;
    if (intencion === "SEMANA") {
      // Lunes de la semana actual (hora local), hasta hoy inclusive.
      const ahora = new Date();
      const diaSemana = (ahora.getDay() + 6) % 7; // lunes = 0
      const lunes = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() - diaSemana);
      fecha = `${lunes.getFullYear()}-${String(lunes.getMonth() + 1).padStart(2, "0")}-${String(lunes.getDate()).padStart(2, "0")}`;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return "⚠️ No pude interpretar la fecha. Escriba por ejemplo *cuenta del 20/11/2026*.";
    }

    const { desde, hasta } = rangoDia(fecha);
    const ticketsHasta = intencion === "SEMANA" ? new Date().toISOString() : hasta;
    const tickets = await ticketsDelCliente(grupoId, clienteId, desde, ticketsHasta);

    if (intencion === "SEMANA") {
      const porDia = new Map<string, any[]>();
      for (const t of tickets) {
        const dia = String(t.created_at || "").slice(0, 10) || hoy;
        if (!porDia.has(dia)) porDia.set(dia, []);
        porDia.get(dia)!.push(t);
      }
      const lineas: string[] = [];
      const cursor = new Date(`${fecha}T12:00:00Z`);
      while (true) {
        const iso = cursor.toISOString().slice(0, 10);
        const filas = porDia.get(iso) || [];
        const neto = filas.reduce((acc, t) => acc + netoDelTicket(t, clienteId), 0);
        lineas.push(
          `📅 ${iso}: ${filas.length} jugada(s) · Neto ${neto >= 0 ? "+" : "-"}$${formatearMontoRegional(Math.abs(neto))}`
        );
        if (iso >= hoy) break;
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      return `📊 *Resumen semanal* (lunes ${fechaLegible(fecha)} a hoy)\n\n${lineas.join("\n")}`;
    }

    const titulo = intencion === "FECHA" ? `Cuenta del ${fechaLegible(fecha)}` : "Cuenta de hoy";
    const bloques = await detallePorCarreras(tickets, clienteId, fecha);
    const neto = tickets.reduce((acc, t) => acc + netoDelTicket(t, clienteId), 0);
    return (
      `📋 *${titulo}*\n` +
      `🎯 ${tickets.length} jugada(s) · Neto ${neto >= 0 ? "+" : "-"}$${formatearMontoRegional(Math.abs(neto))}\n\n` +
      bloques.join("\n\n")
    );
  } catch (err: any) {
    return `⚠️ No se pudo construir la respuesta de cuenta (${err?.message || "error inesperado"}).`;
  }
}

// ============================================================================
// RECARGAS DICTADAS AL NÚMERO DEL BOT
// ============================================================================

export type DatosSolicitudRecarga = {
  nombreUsuario: string;
  banco: string;
  referencia: string;
  monto: number;
  montoTexto: string;
};

export type DatosAprobacionRecarga = { referencia?: string };

export type ComandoRecarga =
  | { tipo: "SOLICITUD"; datos: DatosSolicitudRecarga }
  | { tipo: "APROBACION"; datos: DatosAprobacionRecarga };

/**
 * Parsea `*Recarga* Nombre de usuario, Banco, Número de referencia, Monto` y la
 * aprobación `Aprobada` (acepta `Aprobada <referencia>` para elegir cuál).
 */
export function detectarComandoRecarga(texto: string): ComandoRecarga | null {
  const crudo = String(texto ?? "").trim();
  const limpio = crudo.replace(/\*/g, "").replace(/\s+/g, " ").trim();
  const t = normalizar(limpio);

  if (/^aprobad[oa]\b/.test(t)) {
    const referencia = /^aprobad[oa]\s+(?:ref(?:erencia)?\s*)?([A-Za-z0-9._/-]{4,64})/i.exec(limpio)?.[1];
    return { tipo: "APROBACION", datos: { referencia } };
  }

  if (!/^recarga\b/.test(t)) return null;
  const partes = limpio
    .replace(/^recarga\b/i, "")
    .split(/[,;|]| - /)
    .map((p) => p.trim())
    .filter(Boolean);
  if (partes.length < 4) return null;

  const nombreUsuario = partes[0];
  const banco = partes[1];
  const referencia = partes[2].replace(/\s+/g, "");
  const montoTexto = partes[3];
  const monto = Number(montoTexto.replace(/[^\d.,]/g, "").replace(",", "."));
  if (!nombreUsuario || banco.length < 2 || referencia.length < 4 || !Number.isFinite(monto) || monto <= 0) {
    return null;
  }
  return { tipo: "SOLICITUD", datos: { nombreUsuario, banco, referencia, monto, montoTexto } };
}

function metodoDesdeBanco(banco: string): string {
  const b = normalizar(banco);
  if (/binance|usdt/.test(b)) return "BINANCE";
  if (/zelle/.test(b)) return "ZELLE";
  if (/pago\s*movil|pagomovil/.test(b)) return "PAGO_MOVIL";
  return "TRANSFERENCIA";
}

type RecargaPendiente = {
  clienteId: string;
  nombre: string;
  metodoPago: string;
  banco: string;
  referencia: string;
  monto: number;
  hash: string;
  jid?: string;
  creado: number;
};

const recargasPendientes = new Map<string, RecargaPendiente>();
const TTL_RECARGA_MS = 30 * 60 * 1000;
const MENSAJE_RECARGA =
  "Desea realizar una recarga. Envíe: La Palabra: *Recarga*, Banco, Número de Referencia, Monto, y gustosamente lo procesaremos.";

function limpiarRecargasPendientes(): void {
  const ahora = Date.now();
  for (const [clave, pending] of recargasPendientes) {
    if (ahora - pending.creado > TTL_RECARGA_MS) recargasPendientes.delete(clave);
  }
}

/** Hash determinista del texto de la solicitud: no hay imagen en el flujo DM. */
function hashComprobanteTextual(params: {
  grupoId: string;
  referencia: string;
  monto: number;
  banco: string;
  nombre: string;
}): string {
  const canonico = [
    params.grupoId,
    normalizar(params.referencia),
    params.monto.toFixed(2),
    normalizar(params.banco),
    normalizar(params.nombre),
  ].join("|");
  return crypto.createHash("sha256").update(canonico).digest("hex");
}

async function resolverClientePorNombre(grupoId: string, nombre: string): Promise<any | null> {
  const n = String(nombre || "").trim().replace(/[%_,]/g, "");
  if (!n) return null;
  const { data } = await supabaseAdmin
    .from("clientes")
    .select("id, nombre, seudonimo, grupo_id, activo")
    .eq("grupo_id", grupoId)
    .or(`seudonimo.ilike.%${n}%,nombre.ilike.%${n}%`)
    .limit(5);
  return (
    (data || []).find(
      (c: any) =>
        normalizar(c.seudonimo) === normalizar(n) ||
        normalizar(c.nombre) === normalizar(n)
    ) ||
    (data || [])[0] ||
    null
  );
}

/** Anti-replay: referencia, hash y (banco + monto) NO pueden repetirse en el grupo. */
async function verificarAntiReplay(params: {
  grupoId: string;
  metodoPago: string;
  banco: string;
  referencia: string;
  monto: number;
  hash: string;
}): Promise<string | null> {
  try {
    const base = supabaseAdmin.from("solicitudes_recarga_saldo").select("id, estado");
    const { data: porRef, error: errRef } = await base
      .eq("grupo_id", params.grupoId)
      .eq("metodo_pago", params.metodoPago)
      .eq("referencia_original", params.referencia)
      .limit(1);
    if (errRef) return `No se pudo verificar la referencia (${errRef.message}).`;
    if (porRef && porRef.length > 0) return " Esta referencia bancaria ya fue registrada en el grupo.";

    const { data: porHash, error: errHash } = await supabaseAdmin
      .from("solicitudes_recarga_saldo")
      .select("id, estado")
      .eq("hash_imagen_sha256", params.hash)
      .limit(1);
    if (errHash) return `No se pudo verificar el comprobante (${errHash.message}).`;
    if (porHash && porHash.length > 0) return " Este comprobante ya fue utilizado en una solicitud de recarga.";

    // Mismo monto + mismo banco en el grupo: se bloquea para evitar el replay
    // del mismo pago con otra referencia cosmética.
    const { data: porMonto, error: errMonto } = await supabaseAdmin
      .from("solicitudes_recarga_saldo")
      .select("id, estado")
      .eq("grupo_id", params.grupoId)
      .eq("banco_origen", params.banco.toUpperCase())
      .eq("monto_reportado", params.monto)
      .limit(1);
    if (errMonto) return `No se pudo verificar el monto (${errMonto.message}).`;
    if (porMonto && porMonto.length > 0) return " Ya existe una recarga con ese banco y monto en el grupo.";
  } catch (err: any) {
    return `No se pudo verificar anti-replay (${err?.message || "error inesperado"}).`;
  }
  return null;
}

export type ResultadoComandoRecarga = {
  ok: boolean;
  mensaje: string;
  referencia?: string;
  resultado?: Record<string, any>;
};

/**
 * Registra la solicitud (SOLICITUD) y la acredita cuando el número del bot
 * escribe `Aprobada` (APROBACION), reutilizando `validarSolicitudRecargaServidor`
 * con TODAS sus validaciones (método, banco, referencia, monto y SHA-256).
 */
export async function procesarComandoRecarga(params: {
  texto?: string;
  comando?: ComandoRecarga | null;
  grupoId?: string;
  cliente?: any;
  clienteId?: string;
  participantJid?: string;
  aprobadorJid?: string;
  aprobadorNombre?: string;
  esOperador?: boolean;
  esAdministrador?: boolean;
  moneda?: string;
  metodoPago?: string;
}): Promise<ResultadoComandoRecarga> {
  const comando = params.comando ?? detectarComandoRecarga(params.texto || "");
  if (!comando) return { ok: false, mensaje: `⚠️ Formato incorrecto. ${MENSAJE_RECARGA}` };

  const grupoId = String(params.grupoId || params.cliente?.grupo_id || "").trim();
  if (!grupoId) return { ok: false, mensaje: "⚠️ No se pudo identificar el grupo de la sala." };
  limpiarRecargasPendientes();

  if (comando.tipo === "SOLICITUD") {
    const { nombreUsuario, banco, referencia, monto } = comando.datos;
    const refLimpia = referencia.replace(/\s+/g, "").slice(0, 64);
    if (!/^[A-Za-z0-9._/-]{4,64}$/.test(refLimpia)) {
      return { ok: false, mensaje: "⚠️ Referencia inválida (4 a 64 caracteres alfanuméricos)." };
    }
    if (!Number.isFinite(monto) || monto <= 0 || monto > 1_000_000) {
      return { ok: false, mensaje: "⚠️ Monto inválido." };
    }

    const cliente =
      params.cliente ||
      (params.clienteId
        ? (
            await supabaseAdmin
              .from("clientes")
              .select("id, nombre, seudonimo, grupo_id, activo")
              .eq("id", params.clienteId)
              .maybeSingle()
          ).data
        : null) ||
      (await resolverClientePorNombre(grupoId, nombreUsuario));
    if (!cliente?.id || cliente.activo === false) {
      return { ok: false, mensaje: `⚠️ No encontré al jugador *${nombreUsuario}* en este grupo.` };
    }

    const metodoPago = normalizarMetodo(params.metodoPago || metodoDesdeBanco(banco));
    if (!["PAGO_MOVIL", "ZELLE", "TRANSFERENCIA", "BINANCE"].includes(metodoPago)) {
      return { ok: false, mensaje: "⚠️ Método de pago no permitido." };
    }
    const bancoUpper = String(banco).trim().toUpperCase().slice(0, 80);
    const hash = hashComprobanteTextual({
      grupoId,
      referencia: refLimpia,
      monto,
      banco: bancoUpper,
      nombre: String(cliente.seudonimo || cliente.nombre || nombreUsuario),
    });

    const motivoReplay = await verificarAntiReplay({
      grupoId,
      metodoPago,
      banco: bancoUpper,
      referencia: refLimpia,
      monto,
      hash,
    });
    if (motivoReplay) return { ok: false, mensaje: `⚠️${motivoReplay}` };

    const clave = `${grupoId}|${metodoPago}|${refLimpia}`;
    for (const pendiente of recargasPendientes.values()) {
      if (
        String(pendiente.clienteId) === String(cliente.id) &&
        Number(pendiente.monto) === Number(monto)
      ) {
        return { ok: false, mensaje: "⚠️ Ya existe una solicitud pendiente con ese mismo monto. Esperá su aprobación." };
      }
    }

    recargasPendientes.set(clave, {
      clienteId: String(cliente.id),
      nombre: String(cliente.seudonimo || cliente.nombre || nombreUsuario),
      metodoPago,
      banco: bancoUpper,
      referencia: refLimpia,
      monto,
      hash,
      jid: params.participantJid,
      creado: Date.now(),
    });

    return {
      ok: true,
      referencia: refLimpia,
      mensaje:
        `✅ *Solicitud de recarga recibida*\n` +
        `👤 ${cliente.seudonimo || cliente.nombre || nombreUsuario}\n` +
        `🏦 ${bancoUpper} · Ref. ${refLimpia}\n` +
        `💵 ${formatearMontoRegional(monto, { ocultarCerosEnteros: false })}\n\n` +
        `Queda pendiente de aprobación. Para acreditarla responda: *Aprobada ${refLimpia}*.`,
    };
  }

  // APROBACION: sólo desde el canal del número del bot (el llamador ya verificó
  // al operador); se rechaza explícitamente si el caller dice que no lo es.
  if (params.esOperador === false && params.esAdministrador !== true) {
    return { ok: false, mensaje: "⚠️ Sólo el operador puede aprobar recargas." };
  }
  const refAprobada = comando.datos.referencia ? String(comando.datos.referencia).toUpperCase() : "";
  const pendientes = Array.from(recargasPendientes.entries()).filter(
    ([clave]) => clave.startsWith(`${grupoId}|`) && (!refAprobada || clave.endsWith(`|${refAprobada}`))
  );
  if (pendientes.length === 0) {
    return { ok: false, mensaje: "⚠️ No hay una solicitud de recarga pendiente con esa referencia." };
  }
  if (pendientes.length > 1 && !refAprobada) {
    return { ok: false, mensaje: "⚠️ Hay varias solicitudes pendientes. Escriba *Aprobada <referencia>*." };
  }
  const [clave, pendiente] = pendientes[0];

  const motivoReplay = await verificarAntiReplay({
    grupoId,
    metodoPago: pendiente.metodoPago,
    banco: pendiente.banco,
    referencia: pendiente.referencia,
    monto: pendiente.monto,
    hash: pendiente.hash,
  });
  if (motivoReplay) {
    recargasPendientes.delete(clave);
    return { ok: false, mensaje: `⚠️${motivoReplay}` };
  }

  const identidad: IdentidadSala = {
    tipo: "STAFF",
    usuarioId: String(params.aprobadorJid || "BOT_OWNER"),
    nombre: String(params.aprobadorNombre || "Administrador"),
    grupoId,
    esAdmin: params.esAdministrador !== false,
    esOperador: params.esOperador !== false,
    permisos: [],
  };
  const entrada: SolicitudRecargaEntrada = {
    grupoId,
    clienteId: pendiente.clienteId,
    metodoPago: pendiente.metodoPago,
    bancoOrigen: pendiente.banco,
    referencia: pendiente.referencia,
    montoReportado: pendiente.monto,
    moneda: params.moneda || "USD",
    nombreArchivo: `recarga-whatsapp-${pendiente.referencia}.txt`,
    // No hay imagen en el canal de texto: la huella canónica de la solicitud
    // mantiene la validación SHA-256 y el anti-replay sin relajar la RPC.
    hashImagenSha256: pendiente.hash,
  };

  const validacion = await validarSolicitudRecargaServidor(identidad, entrada);
  if (!validacion.ok) {
    return { ok: false, mensaje: `⚠️ No se pudo acreditar la recarga: ${validacion.error}` };
  }

  recargasPendientes.delete(clave);
  return {
    ok: true,
    referencia: pendiente.referencia,
    resultado: validacion.resultado,
    mensaje:
      `✅ *Recarga aprobada*\n👤 ${pendiente.nombre}\n` +
      `💵 ${formatearMontoRegional(pendiente.monto, { ocultarCerosEnteros: false })} · Ref. ${pendiente.referencia}\n` +
      `El saldo ya fue actualizado.`,
  };
}

function normalizarMetodo(valor: unknown): string {
  const m = String(valor ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (m === "PAGOMOVIL" || m === "PAGO_MOVIL") return "PAGO_MOVIL";
  if (m === "TRANSFERENCIA" || m === "TRANSFERENCIA_BANCARIA") return "TRANSFERENCIA";
  return m;
}
