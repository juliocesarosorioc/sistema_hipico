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
  proporcion_premio?: string | null;
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
    return `${bandoA.join("-") || t.ejemplar_numero || "1"}X${bandoB.join("-")}`;
  }
  return String(t.ejemplar_numero || bandoA[0] || "1").trim();
}

function proponenteEsQuienJuega(accionProponente?: string | null): boolean {
  const acc = String(accionProponente || "JUEGA").trim().toUpperCase();
  return acc !== "CONSIGO" && acc !== "CONSIGUE" && acc !== "DA" && acc !== "DOY" && acc !== "PIDE";
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

    const fechaCarrera =
      params.sala.fecha_activa && /^\d{4}-\d{2}-\d{2}/.test(String(params.sala.fecha_activa))
        ? String(params.sala.fecha_activa).slice(0, 10)
        : hoyCaracas();
    const hipodromo = String(params.sala.hipodromo_activo || "HIPODROMO").trim().toUpperCase();
    const carrera = Number(params.sala.numero_carrera_activa || 1) || 1;

    for (const raw of tickets) {
      const t = raw as TicketFifoBasico & { estado?: string };
      if (!t.codigo_ticket) continue;
      const monto = Number(t.monto_concretado || 0);
      const estadoTk = String(t.estado || "").toUpperCase();
      if (estadoTk === "EN_COLA" || estadoTk === "ANULADO" || monto <= 0) continue;
      const marcador = `SALA_P2P:${t.codigo_ticket}`;

      const { data: existente } = await supabase
        .from("tickets_apuestas")
        .select("id, monto_jugado")
        .eq("nota_auditoria", marcador)
        .limit(1)
        .maybeSingle();

      if (existente?.id) {
        if (Number(existente.monto_jugado || 0) !== monto) {
          await supabase
            .from("tickets_apuestas")
            .update({ monto_jugado: monto })
            .eq("id", existente.id);
        }
        continue;
      }

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
          monto_jugado: monto,
          monto_decidido: 0,
          premio_pagar: 0,
          cliente_juega_id: clienteJuegaId,
          cliente_juega_nombre: clienteJuegaNombre,
          cliente_consigue_id: clienteConsigueId,
          cliente_consigue_nombre: clienteConsigueNombre,
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
          nota_auditoria: marcador,
        },
      ]);
      if (errInsTaq) {
        console.error("[sincronizar-tickets-sala] Error insertando en tickets_apuestas:", errInsTaq);
      }
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
    netoClienteJuega?: number;
    comisionTotal?: number;
    estadoTicket?: "Ganador" | "Perdedor" | "Empate";
  }
): Promise<void> {
  if (!params.codigoTicket) return;
  try {
    const marcador = `SALA_P2P:${params.codigoTicket}`;
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
