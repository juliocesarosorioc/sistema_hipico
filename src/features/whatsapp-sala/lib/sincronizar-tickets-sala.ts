import type { SupabaseClient } from "@supabase/supabase-js";

export interface SalaContextoTicket {
  id?: string;
  grupo_id?: string | null;
  hipodromo_activo?: string | null;
  numero_carrera_activa?: number | null;
  fecha_activa?: string | null;
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
  ejemplar_numero?: string | null;
  caballos_bando_a?: string[] | null;
  caballos_bando_b?: string[] | null;
  es_match?: boolean | null;
  monto_concretado: number;
}

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

function normalizarCaballoTicket(t: TicketFifoBasico): string {
  const bandoA = Array.isArray(t.caballos_bando_a) ? t.caballos_bando_a.filter(Boolean) : [];
  const bandoB = Array.isArray(t.caballos_bando_b) ? t.caballos_bando_b.filter(Boolean) : [];
  if (t.es_match || (bandoA.length > 0 && bandoB.length > 0)) {
    return `${bandoA.join(".") || t.ejemplar_numero || "1"}X${bandoB.join(".")}`;
  }
  return String(t.ejemplar_numero || bandoA[0] || "1").trim();
}

function proponenteEsQuienJuega(accionProponente?: string | null): boolean {
  const acc = String(accionProponente || "JUEGA").trim().toUpperCase();
  return acc !== "CONSIGO" && acc !== "DA";
}

/**
 * Inserta de forma idempotente el ticket espejo en `tickets_apuestas` para cada
 * concreción de la Sala (`chat_tickets_fifo`), permitiendo que todos los reportes
 * de la plataforma (Reporte de Carrera, Diario, Gestión, Semáforo) muestren
 * las jugadas de la Sala en tiempo real.
 */
export async function sincronizarTicketsPropuestaATaquilla(
  supabase: SupabaseClient,
  params: {
    propuestaMsgId: string;
    sala: SalaContextoTicket;
    grupoId: string;
    condicionProponente?: string | null;
    comisionPct?: number | null;
  }
): Promise<void> {
  try {
    const { data: tickets } = await supabase
      .from("chat_tickets_fifo")
      .select("*")
      .eq("propuesta_msg_id", params.propuestaMsgId)
      .neq("estado", "ANULADO");

    if (!tickets || tickets.length === 0) return;

    let comisionPct = Number(params.comisionPct);
    if (!Number.isFinite(comisionPct)) {
      const { data: grp } = await supabase
        .from("grupos_venta")
        .select("comision_default")
        .eq("id", params.grupoId)
        .maybeSingle();
      comisionPct = Number(grp?.comision_default ?? 5);
    }

    const fechaCarrera =
      params.sala.fecha_activa && /^\d{4}-\d{2}-\d{2}/.test(String(params.sala.fecha_activa))
        ? String(params.sala.fecha_activa).slice(0, 10)
        : hoyCaracas();
    const hipodromo = String(params.sala.hipodromo_activo || "HIPODROMO").trim().toUpperCase();
    const carrera = Number(params.sala.numero_carrera_activa || 1) || 1;

    for (const raw of tickets) {
      const t = raw as TicketFifoBasico;
      if (!t.codigo_ticket) continue;
      const marcador = `SALA_P2P:${t.codigo_ticket}`;

      const { data: existente } = await supabase
        .from("tickets_apuestas")
        .select("id")
        .eq("nota_auditoria", marcador)
        .limit(1)
        .maybeSingle();

      if (existente?.id) continue;

      const esJuegaProponente = proponenteEsQuienJuega(t.accion_proponente || params.condicionProponente);
      const clienteJuegaId = esJuegaProponente ? t.proponente_id : t.aceptante_id;
      const clienteJuegaNombre = esJuegaProponente
        ? t.proponente_nombre || "Jugador"
        : t.aceptante_nombre || "Jugador";
      const clienteConsigueId = esJuegaProponente ? t.aceptante_id : t.proponente_id;
      const clienteConsigueNombre = esJuegaProponente
        ? t.aceptante_nombre || "Jugador"
        : t.proponente_nombre || "Jugador";

      const esMatch = Boolean(t.es_match || (Array.isArray(t.caballos_bando_b) && t.caballos_bando_b.length > 0));
      const nombreJugada = esMatch ? "MATCH" : String(t.modalidad || "1P").trim().toUpperCase();
      const caballo = normalizarCaballoTicket(t);
      const monto = Number(t.monto_concretado || 0);

      await supabase.from("tickets_apuestas").insert([
        {
          fecha_registro: new Date().toISOString(),
          fecha_carrera: fechaCarrera,
          hipodromo,
          carrera,
          nombre_jugada: nombreJugada,
          caballo,
          cantidad_tablas: 1,
          monto_jugado: monto,
          monto_decidido: 0,
          premio_pagar: 0,
          cliente_juega_id: clienteJuegaId,
          cliente_juega_nombre: clienteJuegaNombre,
          cliente_consigue_id: clienteConsigueId,
          cliente_consigue_nombre: clienteConsigueNombre,
          grupo_cobro_id: params.grupoId,
          grupo_comision_id: params.grupoId,
          comision_porcentaje: comisionPct,
          comision_pagada: 0,
          estado: "Pendiente",
          anulada: false,
          es_adelantada: false,
          modalidad: esMatch ? "Match" : "Puestos",
          moneda: "USD",
          nota_auditoria: marcador,
        },
      ]);
    }
  } catch (err) {
    console.warn("[sincronizar-tickets-sala] Error insertando espejo en tickets_apuestas:", err);
  }
}

/**
 * Actualiza el ticket espejo en `tickets_apuestas` cuando la carrera se liquida desde la Sala.
 */
export async function actualizarTicketEspejoLiquidado(
  supabase: SupabaseClient,
  params: {
    codigoTicket: string;
    accionProponente?: string | null;
    factor: number;
    monto: number;
    porcentajeComision: number;
  }
): Promise<void> {
  if (!params.codigoTicket) return;
  try {
    const marcador = `SALA_P2P:${params.codigoTicket}`;
    const esJuegaProponente = proponenteEsQuienJuega(params.accionProponente);
    // `factor > 0` indica que ganó el proponente; `factor < 0` indica que ganó el aceptante.
    const ganoClienteJuega = esJuegaProponente ? params.factor > 0 : params.factor < 0;
    const esEmpate = params.factor === 0;

    const comision = Number((params.monto * params.porcentajeComision).toFixed(2));
    const estado = esEmpate ? "Empate" : ganoClienteJuega ? "Ganador" : "Perdedor";
    const premioPagar = esEmpate
      ? params.monto
      : ganoClienteJuega
      ? Number((params.monto * 2 - comision).toFixed(2))
      : 0;
    const montoDecidido = esEmpate ? 0 : ganoClienteJuega ? Number((params.monto * 2).toFixed(2)) : params.monto;
    const comisionPagada = esEmpate ? 0 : ganoClienteJuega ? comision : 0;

    await supabase
      .from("tickets_apuestas")
      .update({
        estado,
        premio_pagar: premioPagar,
        monto_decidido: montoDecidido,
        comision_pagada: comisionPagada,
      })
      .eq("nota_auditoria", marcador);
  } catch (err) {
    console.warn("[sincronizar-tickets-sala] Error actualizando ticket liquidado:", err);
  }
}

/**
 * Revierte los tickets espejo en `tickets_apuestas` a `Pendiente` al reversar desde la Sala.
 */
export async function revertirTicketsEspejoSala(
  supabase: SupabaseClient,
  codigosTicket: string[]
): Promise<void> {
  const marcadores = codigosTicket.filter(Boolean).map((c) => `SALA_P2P:${c}`);
  if (marcadores.length === 0) return;
  try {
    await supabase
      .from("tickets_apuestas")
      .update({
        estado: "Pendiente",
        premio_pagar: 0,
        monto_decidido: 0,
        comision_pagada: 0,
        anulada: false,
      })
      .in("nota_auditoria", marcadores);
  } catch (err) {
    console.warn("[sincronizar-tickets-sala] Error revirtiendo tickets espejo:", err);
  }
}

/**
 * Anula los tickets espejo en `tickets_apuestas` al anular la carrera desde la Sala.
 */
export async function anularTicketsEspejoSala(
  supabase: SupabaseClient,
  codigosTicket: string[]
): Promise<void> {
  const marcadores = codigosTicket.filter(Boolean).map((c) => `SALA_P2P:${c}`);
  if (marcadores.length === 0) return;
  try {
    await supabase
      .from("tickets_apuestas")
      .update({
        estado: "Anulada",
        anulada: true,
        premio_pagar: 0,
        monto_decidido: 0,
        comision_pagada: 0,
      })
      .in("nota_auditoria", marcadores);
  } catch (err) {
    console.warn("[sincronizar-tickets-sala] Error anulando tickets espejo:", err);
  }
}
