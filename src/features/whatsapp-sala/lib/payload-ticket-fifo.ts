/**
 * Columnas obligatorias (NOT NULL sin DEFAULT) de `public.chat_tickets_fifo`
 * en producción. El RPC `concretar_jugada_fifo_atomica` quedó desfasado y no
 * envía `orden_fifo`, por eso sus INSERT terminan en 23502.
 */
export type DatosTicketFifo = {
  grupoId: string;
  salaId?: string | null;
  carreraId?: string | null;
  propuestaMsgId: string;
  respuestaMsgId?: string | null;
  ordenFifo?: number | null;
  proponenteId?: string | null;
  proponenteNombre?: string | null;
  aceptanteId?: string | null;
  aceptanteNombre?: string | null;
  accionProponente?: string | null;
  esMatch?: boolean | null;
  modalidad?: string | null;
  ejemplarNumero?: string | null;
  caballosBandoA?: string[] | null;
  caballosBandoB?: string[] | null;
  proporcionPremio?: string | null;
  montoSolicitado: number;
  montoConcretado: number;
  montoPendienteAmpliacion?: number;
  fueAjusteParcial?: boolean;
  riesgoProponente?: number;
  riesgoAceptante?: number;
  estado?: string;
  whatsappConcrecionMsgId?: string | null;
  codigoTicket?: string;
  firmaSha256?: string | null;
};

export const COLUMNAS_OBLIGATORIAS_TICKET_FIFO = [
  "id",
  "codigo_ticket",
  "grupo_id",
  "propuesta_msg_id",
  "orden_fifo",
  "proponente_nombre",
  "aceptante_nombre",
  "modalidad",
  "ejemplar_numero",
  "monto_solicitado",
  "monto_concretado",
] as const;

function texto(valor: unknown, fallback: string): string {
  const s = String(valor ?? "").trim();
  return s || fallback;
}

function numero(valor: unknown): number {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
}

/** Constructor puro: permite verificar las columnas NOT NULL sin tocar la BD. */
export function construirPayloadTicketFifo(datos: DatosTicketFifo, ordenFifo: number): Record<string, unknown> {
  return {
    grupo_id: datos.grupoId,
    sala_id: datos.salaId || null,
    carrera_id: datos.carreraId || null,
    propuesta_msg_id: datos.propuestaMsgId,
    respuesta_msg_id: datos.respuestaMsgId || null,
    orden_fifo: Number.isFinite(Number(ordenFifo)) && Number(ordenFifo) > 0 ? Math.trunc(Number(ordenFifo)) : 1,
    proponente_id: datos.proponenteId || null,
    proponente_nombre: texto(datos.proponenteNombre, "Proponente"),
    aceptante_id: datos.aceptanteId || null,
    aceptante_nombre: texto(datos.aceptanteNombre, "Jugador"),
    accion_proponente: texto(datos.accionProponente, "JUEGA").toUpperCase(),
    es_match: Boolean(datos.esMatch),
    modalidad: texto(datos.modalidad, "1P"),
    ejemplar_numero: texto(datos.ejemplarNumero, "1"),
    caballos_bando_a: Array.isArray(datos.caballosBandoA) ? datos.caballosBandoA : [],
    caballos_bando_b: Array.isArray(datos.caballosBandoB) ? datos.caballosBandoB : [],
    proporcion_premio: texto(datos.proporcionPremio, "1x1"),
    monto_solicitado: numero(datos.montoSolicitado),
    monto_concretado: numero(datos.montoConcretado),
    monto_pendiente_ampliacion: numero(datos.montoPendienteAmpliacion),
    fue_ajuste_parcial: Boolean(datos.fueAjusteParcial),
    riesgo_proponente: numero(datos.riesgoProponente),
    riesgo_aceptante: numero(datos.riesgoAceptante),
    estado: texto(datos.estado, "ACTIVO").toUpperCase(),
    whatsapp_concrecion_msg_id: datos.whatsappConcrecionMsgId || null,
    ...(datos.firmaSha256 ? { firma_sha256: datos.firmaSha256 } : {}),
  };
}
