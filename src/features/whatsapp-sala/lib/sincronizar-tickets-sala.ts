import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cargarContextoEstructuraSala,
  estructuraDesdeTicketSala,
  proyectarCargaSala,
  resolverClienteSala,
} from "@/features/whatsapp-sala/lib/estructurar-carga-sala";

export interface SalaContextoTicket {
  id?: string;
  grupo_id?: string | null;
  hipodromo_activo?: string | null;
  numero_carrera_activa?: number | null;
  fecha_activa?: string | null;
  estado_carrera?: string | null;
  carrera_activa_id?: string | null;
  retirados?: unknown;
}

export interface TicketFifoBasico {
  id?: string;
  codigo_ticket: string;
  proponente_id: string;
  proponente_nombre?: string | null;
  aceptante_id: string;
  aceptante_nombre?: string | null;
  accion_proponente?: string | null;
  modalidad?: string | null;
  proporcion_premio?: string | null;
  ejemplar_numero?: string | null;
  caballos_bando_a?: string[] | null;
  caballos_bando_b?: string[] | null;
  es_match?: boolean | null;
  monto_concretado: number;
}

export type ResultadoSincronizacionSala = {
  registrados: Array<{ codigoTicket: string; ticketId: number; clienteJuegaId: string; monto: number }>;
  /** Clientes a los que la RPC de Taquilla ya les debitó el saldo: no retener de nuevo. */
  clientesJuegaCompensados: Set<string>;
};

function hoyCaracas(): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Caracas",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/** Fecha real de la carrera activa: `salas_juego` no guarda fecha propia. */
async function resolverFechaCarreraSala(
  supabase: SupabaseClient,
  sala: SalaContextoTicket,
  hipodromo: string,
  carrera: number
): Promise<string> {
  const declarada = String((sala as any).fecha_activa || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(declarada)) return declarada.slice(0, 10);

  const carreraId = String((sala as any).carrera_activa_id || "").trim();
  if (carreraId) {
    try {
      const { data } = await supabase
        .from("carreras")
        .select("fecha")
        .eq("id", carreraId)
        .maybeSingle();
      const f = String((data as any)?.fecha || "").slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(f)) return f;
    } catch {
      /* sigue con la búsqueda por clave */
    }
  }

  try {
    const hoy = hoyCaracas();
    const porClave = supabase
      .from("carreras")
      .select("fecha")
      .ilike("hipodromo", hipodromo)
      .eq("carrera", carrera);
    const { data: futura } = await porClave
      .gte("fecha", hoy)
      .order("fecha", { ascending: false })
      .limit(1)
      .maybeSingle();
    const f = String((futura as any)?.fecha || "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(f)) return f;

    const { data: ultima } = await supabase
      .from("carreras")
      .select("fecha")
      .ilike("hipodromo", hipodromo)
      .eq("carrera", carrera)
      .order("fecha", { ascending: false })
      .limit(1)
      .maybeSingle();
    const fu = String((ultima as any)?.fecha || "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(fu)) return fu;
  } catch {
    /* fecha de hoy como respaldo */
  }
  return hoyCaracas();
}

function normalizarCaballoTicket(t: TicketFifoBasico): string {
  const bandoA = Array.isArray(t.caballos_bando_a) ? t.caballos_bando_a.filter(Boolean) : [];
  const bandoB = Array.isArray(t.caballos_bando_b) ? t.caballos_bando_b.filter(Boolean) : [];
  if (t.es_match || (bandoA.length > 0 && bandoB.length > 0)) {
    return `${bandoA.join("-") || t.ejemplar_numero || "1"}X${bandoB.join("-")}`;
  }
  return String(t.ejemplar_numero || bandoA[0] || "1").trim();
}

function proponenteEsQuienJuega(accionProponente?: string | null): boolean {
  const acc = String(accionProponente || "JUEGA").trim().toUpperCase();
  return acc !== "CONSIGO" && acc !== "CONSIGUE" && acc !== "DA" && acc !== "DOY" && acc !== "PIDE";
}

function notaAuditoriaTaquilla(codigoTicket: string, fechaCarrera: string): Record<string, string> {
  return {
    origen: "TAQUILLA",
    codigo_ticket: String(codigoTicket || ""),
    idempotencia: String(codigoTicket || ""),
    fecha_carrera: fechaCarrera,
  };
}

/** Legacy: tickets insertados antes de esta versión. Se siguen reconociendo. */
function notaAuditoriaSala(codigoTicket: string): Record<string, string> {
  return {
    origen: "SALA_P2P",
    codigo_ticket: String(codigoTicket || ""),
  };
}

/** PostgREST devuelve `json` como texto: se lee con tolerancia a objeto/string. */
function leerNotaSala(nota: unknown): {
  origen?: string;
  codigo_ticket?: string;
  idempotencia?: string;
} {
  let valor: unknown = nota;
  if (typeof valor === "string") {
    const raw = valor.trim();
    if (raw.startsWith("SALA_P2P:")) {
      return { origen: "SALA_P2P", codigo_ticket: raw.slice("SALA_P2P:".length).trim() };
    }
    try {
      valor = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!valor || typeof valor !== "object") return {};
  const obj = valor as Record<string, unknown>;
  return {
    origen: String(obj.origen ?? "").toUpperCase(),
    codigo_ticket: String(obj.codigo_ticket ?? "").trim(),
    idempotencia: String(obj.idempotencia ?? "").trim(),
  };
}

function notaPerteneceACodigo(nota: unknown, codigo: string): boolean {
  const parsed = leerNotaSala(nota);
  const origen = parsed.origen ?? "";
  if (origen !== "TAQUILLA" && origen !== "SALA_P2P") return false;
  return parsed.codigo_ticket === codigo || parsed.idempotencia === codigo;
}

async function idsTicketsSala(supabase: SupabaseClient, codigos: Set<string>): Promise<string[]> {
  const { data } = await supabase
    .from("tickets_apuestas")
    .select("id, nota_auditoria")
    .limit(500);
  return ((data ?? []) as Array<Record<string, unknown>>)
    .filter((c) => {
      const nota = leerNotaSala(c?.nota_auditoria);
      const codigo = String(nota.codigo_ticket || nota.idempotencia || "").trim();
      return Boolean(codigo) && codigos.has(codigo) && ["TAQUILLA", "SALA_P2P"].includes(nota.origen ?? "");
    })
    .map((c) => String(c.id))
    .filter(Boolean);
}

/** Riesgo P2P de quien JUEGA, con la misma regla de `calcularRiesgoReal`. */
function riesgoDeQuienJuega(monto: number, proporcion?: string | null): number {
  const m = Number(monto) || 0;
  const prop = String(proporcion || "1x1").replace(",", ".").trim();
  const match = /^10\/(\d+(?:\.\d+)?)$/i.exec(prop);
  if (!match) return Math.round(m * 100) / 100;
  return Math.round(m * 100) / 100;
}

function nombreJugadaTaquilla(t: TicketFifoBasico): string {
  const propRaw = String(t.proporcion_premio || "").trim();
  const tieneProp10 = /^10\s*[\/aAª@\-]\s*\d+(?:[.,]\d+)?$/i.test(propRaw) && !/^10\s*[\/aAª@\-]\s*10$/i.test(propRaw);
  const propCanon = tieneProp10
    ? propRaw.toUpperCase().replace(/\s+/g, "").replace(/[aAª@\-]/g, "/").replace(",", ".")
    : "";
  const modBase = String(t.modalidad || "1P").trim().toUpperCase();
  const esMatch = Boolean(t.es_match || (Array.isArray(t.caballos_bando_b) && t.caballos_bando_b.length > 0));
  if (esMatch) return propCanon || "PP";
  if (modBase === "A_PREMIO" || modBase === "MATCH" || (modBase === "1P" && propCanon)) {
    return propCanon || (esMatch ? "PP" : "1P");
  }
  return propCanon && !modBase.includes(propCanon) ? propCanon : modBase;
}

/**
 * Registra cada concreción de la Sala en `tickets_apuestas` con las CONDICIONES
 * DE TAQUILLA: pasa por `venderJugada` (RPC `club_vender_jugada`), con el
 * cliente inyectado (service role), idempotencia por `codigo_ticket`, comisión
 * y moneda del grupo, jugada/caballo/dador ya estructurados y saldo validado
 * por `proyectarFilasEnOrden`. Solo la carrera abierta admite registros.
 */
export async function sincronizarTicketsPropuestaATaquilla(
  supabase: SupabaseClient,
  params: {
    propuestaMsgId: string;
    sala: SalaContextoTicket;
    grupoId: string;
    condicionProponente?: string | null;
    comisionPct?: number | null;
    carreraAbierta?: boolean | null;
    /** Monto que se está concretando ahora (ampliaciones). */
    montoAConcretar?: number | null;
  }
): Promise<ResultadoSincronizacionSala> {
  const vacio: ResultadoSincronizacionSala = { registrados: [], clientesJuegaCompensados: new Set() };
  try {
    const carreraAbierta =
      params.carreraAbierta !== undefined && params.carreraAbierta !== null
        ? Boolean(params.carreraAbierta)
        : String((params.sala as any)?.estado_carrera || "").toLowerCase() === "abierta";
    if (!carreraAbierta) {
      console.warn("[sincronizar-tickets-sala] Carrera cerrada: no se registran jugadas.");
      return vacio;
    }

    const { data: tickets } = await supabase
      .from("chat_tickets_fifo")
      .select("*")
      .eq("propuesta_msg_id", params.propuestaMsgId)
      .neq("estado", "ANULADO");

    if (!tickets || tickets.length === 0) return vacio;

    let comisionPct = Number(params.comisionPct);
    let monedaGrupo = "USD";
    let nombreGrupo = "PRINCIPAL";
    const { data: grp } = await supabase
      .from("grupos_venta")
      .select("nombre, comision_default, moneda")
      .eq("id", params.grupoId)
      .maybeSingle();
    if (!Number.isFinite(comisionPct)) {
      comisionPct = Number(grp?.comision_default ?? 5);
    }
    if (grp?.moneda) {
      monedaGrupo = String(grp.moneda).trim().toUpperCase() || "USD";
    }
    if (grp?.nombre) {
      nombreGrupo = String(grp.nombre).trim().toUpperCase() || "PRINCIPAL";
    }

    const hipodromo = String(params.sala.hipodromo_activo || "HIPODROMO").trim().toUpperCase();
    const carrera = Number(params.sala.numero_carrera_activa || 1) || 1;
    const fechaCarrera = await resolverFechaCarreraSala(supabase, params.sala, hipodromo, carrera);

    for (const raw of tickets) {
      const t = raw as TicketFifoBasico & { estado?: string };
      if (!t.codigo_ticket) continue;
      const montoTicket = Number(t.monto_concretado || 0);
      const estadoTk = String(t.estado || "").toUpperCase();
      if (estadoTk === "EN_COLA" || estadoTk === "ANULADO" || montoTicket <= 0) continue;
      const idsExistentes = await idsTicketsSala(supabase, new Set([t.codigo_ticket]));
      if (idsExistentes.length > 0) {
        const { data: exRow } = await supabase
          .from("tickets_apuestas")
          .select("id, monto_jugado")
          .eq("id", idsExistentes[0])
          .maybeSingle();
        if (exRow?.id && Number(exRow.monto_jugado || 0) !== montoTicket) {
          await supabase
            .from("tickets_apuestas")
            .update({ monto_jugado: montoTicket })
            .eq("id", exRow.id);
        }
        continue;
      }

      const esJuegaProponente = proponenteEsQuienJuega(t.accion_proponente || params.condicionProponente);
      const clienteJuegaId = esJuegaProponente ? t.proponente_id : t.aceptante_id;
      const clienteJuegaNombre = esJuegaProponente
        ? t.proponente_nombre || "Jugador"
        : t.aceptante_nombre || "Jugador";
      const clienteDaId = esJuegaProponente ? t.aceptante_id : t.proponente_id;
      const clienteDaNombre = esJuegaProponente
        ? t.aceptante_nombre || "CASA"
        : t.proponente_nombre || "CASA";

      const esMatch = Boolean(t.es_match || (Array.isArray(t.caballos_bando_b) && t.caballos_bando_b.length > 0));
      const propRaw = String(t.proporcion_premio || "").trim();
      const tieneProp10 = /^10\s*[\/aAª@\-]\s*\d+(?:[.,]\d+)?$/i.test(propRaw) && !/^10\s*[\/aAª@\-]\s*10$/i.test(propRaw);
      const propCanon = tieneProp10 ? propRaw.toUpperCase().replace(/\s+/g, "").replace(/[aAª@\-]/g, "/").replace(",", ".") : "";
      const modBase = String(t.modalidad || "1P").trim().toUpperCase();
      // En transcripción a Taquilla: un enfrentamiento sin proporción es siempre "PP" (nunca "MATCH")
      const nombreJugada = esMatch
        ? propCanon || "PP"
        : modBase === "A_PREMIO" || modBase === "MATCH" || (modBase === "1P" && propCanon)
          ? propCanon || (esMatch ? "PP" : "1P")
          : propCanon && !modBase.includes(propCanon)
            ? propCanon
            : modBase;
      const caballo = normalizarCaballoTicket(t);
      const ejNumParsed = !esMatch && /^\d+$/.test(caballo) ? parseInt(caballo, 10) : null;

      const { error: errInsTaq } = await supabase.from("tickets_apuestas").insert([
        {
          fecha_registro: new Date().toISOString(),
          fecha_carrera: fechaCarrera,
          hipodromo,
          carrera,
          nombre_jugada: nombreJugada,
          caballo,
          ejemplar_numero: ejNumParsed,
          cantidad_tablas: 1,
          monto_jugado: montoTicket,
          monto_decidido: 0,
          premio_pagar: 0,
          cliente_juega_id: clienteJuegaId,
          cliente_juega_nombre: clienteJuegaNombre,
          cliente_consigue_id: clienteDaId,
          cliente_consigue_nombre: clienteDaNombre,
          grupo: nombreGrupo,
          grupo_cobro_id: params.grupoId,
          grupo_cobro_nombre: nombreGrupo,
          grupo_comision_id: params.grupoId,
          grupo_comision_nombre: nombreGrupo,
          comision_porcentaje: comisionPct,
          comision_pagada: 0,
          estado: "Pendiente",
          anulada: false,
          es_adelantada: false,
          moneda: monedaGrupo,
          nota_auditoria: {
            ...notaAuditoriaSala(t.codigo_ticket),
            sala_id: params.sala?.id || null,
            fecha_carrera: fechaCarrera,
          },
        },
      ]);
      if (errInsTaq) {
        console.error("[sincronizar-tickets-sala] Error insertando en tickets_apuestas:", errInsTaq);
      }
    }
    return vacio;
  } catch (err) {
    console.warn("[sincronizar-tickets-sala] Error sincronizando con Taquilla:", err);
    return vacio;
  }
}

/** Conserva campos de auditoría já presentes (fecha_carrera inyectada por la DB). */
function leerNotaNotaCompleta(nota: unknown): Record<string, unknown> {
  let valor: unknown = nota;
  if (typeof valor === "string") {
    try {
      valor = JSON.parse(valor);
    } catch {
      return {};
    }
  }
  return valor && typeof valor === "object" ? (valor as Record<string, unknown>) : {};
}

/**
 * Actualiza el ticket de Taquilla cuando la carrera se liquida desde la Sala.
 * Reconoce tanto el registro nuevo (`TAQUILLA`) como el espejo legacy (`SALA_P2P`).
 */
export async function actualizarTicketEspejoLiquidado(
  supabase: SupabaseClient,
  params: {
    codigoTicket: string;
    accionProponente?: string | null;
    factor: number;
    monto: number;
    porcentajeComision: number;
    netoClienteJuega?: number;
    comisionTotal?: number;
    estadoTicket?: "Ganador" | "Perdedor" | "Empate";
  }
): Promise<void> {
  if (!params.codigoTicket) return;
  try {
    const esJuegaProponente = proponenteEsQuienJuega(params.accionProponente);
    const factorClienteJuega = esJuegaProponente ? params.factor : -params.factor;
    const ganoClienteJuega =
      params.netoClienteJuega !== undefined ? params.netoClienteJuega > 0 : factorClienteJuega > 0;
    const esEmpate =
      params.netoClienteJuega !== undefined ? params.netoClienteJuega === 0 : factorClienteJuega === 0;

    const absF = Math.min(1, Math.abs(factorClienteJuega) || 0);
    const comision =
      params.comisionTotal !== undefined
        ? Number(params.comisionTotal.toFixed(2))
        : Number((params.monto * absF * params.porcentajeComision).toFixed(2));
    const estado = params.estadoTicket || (esEmpate ? "Empate" : ganoClienteJuega ? "Ganador" : "Perdedor");
    const premioPagar =
      params.netoClienteJuega !== undefined
        ? esEmpate
          ? params.monto
          : ganoClienteJuega
          ? Number((params.monto + params.netoClienteJuega).toFixed(2))
          : Number(Math.max(0, params.monto + params.netoClienteJuega).toFixed(2))
        : esEmpate
        ? params.monto
        : ganoClienteJuega
        ? Number((params.monto * (1 + absF) - comision).toFixed(2))
        : Number(Math.max(0, params.monto * (1 - absF)).toFixed(2));
    const montoDecidido = esEmpate
      ? 0
      : ganoClienteJuega
      ? Number((params.monto * (1 + absF)).toFixed(2))
      : Number((params.monto * absF).toFixed(2));
    const comisionPagada = esEmpate ? 0 : comision;

    const ids = await idsTicketsSala(supabase, new Set([params.codigoTicket]));
    if (!ids.length) return;

    await supabase
      .from("tickets_apuestas")
      .update({
        estado,
        premio_pagar: premioPagar,
        monto_decidido: montoDecidido,
        comision_pagada: comisionPagada,
      })
      .in("id", ids as never);
  } catch (err) {
    console.warn("[sincronizar-tickets-sala] Error actualizando ticket liquidado:", err);
  }
}

/** Revierte los tickets de Taquilla/espejo a `Pendiente` al reversar desde la Sala. */
export async function revertirTicketsEspejoSala(
  supabase: SupabaseClient,
  codigosTicket: string[]
): Promise<void> {
  const codigos = new Set(codigosTicket.filter(Boolean).map((c) => String(c)));
  if (codigos.size === 0) return;
  try {
    const ids = await idsTicketsSala(supabase, codigos);
    if (!ids.length) return;
    await supabase
      .from("tickets_apuestas")
      .update({
        estado: "Pendiente",
        premio_pagar: 0,
        monto_decidido: 0,
        comision_pagada: 0,
        anulada: false,
      })
      .in("id", ids as never);
  } catch (err) {
    console.warn("[sincronizar-tickets-sala] Error revirtiendo tickets:", err);
  }
}

/** Anula los tickets de Taquilla/espejo al anular la carrera desde la Sala. */
export async function anularTicketsEspejoSala(
  supabase: SupabaseClient,
  codigosTicket: string[]
): Promise<void> {
  const codigos = new Set(codigosTicket.filter(Boolean).map((c) => String(c)));
  if (codigos.size === 0) return;
  try {
    const ids = await idsTicketsSala(supabase, codigos);
    if (!ids.length) return;
    await supabase
      .from("tickets_apuestas")
      .update({
        estado: "Anulada",
        anulada: true,
        premio_pagar: 0,
        monto_decidido: 0,
        comision_pagada: 0,
      })
      .in("id", ids as never);
  } catch (err) {
    console.warn("[sincronizar-tickets-sala] Error anulando tickets:", err);
  }
}

export { notaAuditoriaSala, leerNotaSala };
