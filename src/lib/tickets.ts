/**
 * Tickets / Reclamos (Tickets por solucionar) — módulo del flujo de disputas.
 *
 *  - Consola de la casa: CREADO → EN_REVISION → SOLUCIONADO (responder con
 *    acción y monto ajustado).
 *  - Portal del cliente: "Mis tickets" + encuesta de satisfacción 1-5.
 *  - Tabla: `tickets_jugadas` (runbook_estabilizacion.sql la crea si no existe).
 */
import { supabase } from "@/lib/supabase";
import { exigirCapacidad, exigirPermiso } from "@/lib/seguridad/vigente";

export type EstadoTicket = "CREADO" | "EN_REVISION" | "SOLUCIONADO";
export type AccionTicket = "ABONO" | "REEMBOLSO" | "AJUSTE" | "RECHAZO";

export type TicketDisputa = {
  id: string | number;
  numero_ticket?: number | null;
  cliente_id?: string | number | null;
  cliente_nombre?: string | null;
  jugada_origen?: string | null;
  jugada_id?: string | null;
  tipo_jugada?: string | null;
  fecha_jugada?: string | null;
  hipodromo?: string | null;
  carrera?: number | null;
  monto?: number | null;
  premio_recalculado?: number | null;
  motivo?: string | null;
  imagen_soporte?: string | null;
  estado?: EstadoTicket | null;
  respuesta_casa?: string | null;
  accion_aplicada?: AccionTicket | null;
  monto_resuelto?: number | null;
  respondido_por?: string | null;
  respondido_at?: string | null;
  encuesta_satisfaccion?: number | null;
  encuesta_comentario?: string | null;
  encuesta_at?: string | null;
  creado_por?: string | null;
  creado_at?: string | null;
  updated_at?: string | null;
};

const SEL =
  "id, numero_ticket, cliente_id, cliente_nombre, jugada_origen, jugada_id, tipo_jugada, fecha_jugada, hipodromo, carrera, monto, premio_recalculado, motivo, imagen_soporte, estado, respuesta_casa, accion_aplicada, monto_resuelto, respondido_por, respondido_at, encuesta_satisfaccion, encuesta_comentario, encuesta_at, creado_por, creado_at, updated_at";

/** Todos los tickets para la consola de la casa (más recientes primero). */
export async function listarTicketsAdmin(): Promise<TicketDisputa[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("tickets_jugadas")
      .select(SEL)
      .order("creado_at", { ascending: false })
      .limit(300);
    if (error) throw error;
    return (data ?? []) as TicketDisputa[];
  } catch {
    return [];
  }
}

/** "Mis tickets" — reclamos/disputas de un cliente (Portal). */
export async function listarMisTickets(clienteId: string | number): Promise<TicketDisputa[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("tickets_jugadas")
      .select(SEL)
      .eq("cliente_id", clienteId)
      .order("creado_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return (data ?? []) as TicketDisputa[];
  } catch {
    return [];
  }
}

/** Casa: pasa un ticket de CREADO a EN_REVISION. */
export async function pasarARevision(id: string | number): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    exigirCapacidad("tickets:btn_tomar");
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  // Un ticket ya solucionado no vuelve a EN_REVISION. La transición va en el
  // `where`, no solo en el `if` de JavaScript.
  const { data, error } = await supabase
    .from("tickets_jugadas")
    .update({ estado: "EN_REVISION", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("estado", "CREADO")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "Ese ticket no está en CREADO. No se puede pasar a revisión." };
  return { ok: true };
}

export type ResolverTicket = {
  respuesta: string;
  accion: AccionTicket;
  monto: number | null;
  por: string;
};

/** Casa: resuelve el ticket (SOLUCIONADO) con acción + monto ajustado. */
export async function resolverTicket(id: string | number, d: ResolverTicket): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };

  // El estado se lee ANTES de decidir. Es lo que cambia el resultado: la
  // capacidad `tickets:fn_anular_ticket` la tiene el admin y también el
  // operador, pero resolver un ticket ya cerrado no lo puede hacer ninguno de
  // los dos. Sin leer el estado, la regla no se puede evaluar y el `update`
  // se ejecutaría igual.
  const { data: actual, error: eLeer } = await supabase
    .from("tickets_jugadas")
    .select("estado")
    .eq("id", id)
    .maybeSingle();
  if (eLeer) return { ok: false, error: eLeer.message };
  if (!actual) return { ok: false, error: "El ticket no existe." };

  try {
    exigirPermiso("tickets:fn_anular_ticket", {
      estado: actual.estado,
      accion: d.accion,
      monto: d.monto,
    });
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  // El `.in("estado", ...)` no es redundante con el ABAC: es la condición en la
  // propia escritura. Si dos ventanas del admin resuelven el mismo ticket, la
  // segunda escribe `where estado in ('CREADO','EN_REVISION')` y la base la
  // rechaza. El guard de arriba es para darle el mensaje al operador; esto es
  // lo que realmente lo impide.
  const { error } = await supabase
    .from("tickets_jugadas")
    .update({
      estado: "SOLUCIONADO",
      respuesta_casa: d.respuesta.trim().toUpperCase(),
      accion_aplicada: d.accion,
      monto_resuelto: d.monto ?? null,
      respondido_por: d.por || "ADMIN",
      respondido_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .in("estado", ["CREADO", "EN_REVISION"]);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Portal: encuesta de satisfacción 1-5 sobre el ticket resuelto. */
export async function encuestarTicket(id: string | number, puntuacion: number, comentario: string): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    const { error } = await supabase
      .from("tickets_jugadas")
      .update({
        encuesta_satisfaccion: puntuacion,
        encuesta_comentario: comentario.trim().toUpperCase() || null,
        encuesta_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Teléfono del cliente (para el enlace wa.me de notificación). */
export async function telefonoDeCliente(clienteId: string | number): Promise<{ telefono?: string; codigo_pais?: string } | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("clientes")
      .select("telefono, codigo_pais")
      .eq("id", clienteId as never)
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return { telefono: data.telefono ? String(data.telefono) : undefined, codigo_pais: data.codigo_pais ? String(data.codigo_pais) : undefined };
  } catch {
    return null;
  }
}

/** Enlace wa.me para notificar al cliente la resolución de su ticket. */
export async function enlaceWhatsAppTicket(t: TicketDisputa): Promise<string | null> {
  if (!t.cliente_id) return null;
  const tel = await telefonoDeCliente(t.cliente_id);
  if (!tel?.telefono) return null;
  const codigo = tel.codigo_pais || "+58";
  const numeroInt = String(codigo).replace(/\D/g, "") + String(tel.telefono).replace(/\D/g, "");
  const mensaje = `Hola ${t.cliente_nombre ?? "cliente"} 👋\n\n*Club del Dinero*\n\nTu ticket T-${t.numero_ticket ?? String(t.id).slice(0, 6)} fue resuelto:\n• Acción: ${t.accion_aplicada ?? "Atendido"}${t.monto_resuelto != null && Number(t.monto_resuelto) > 0 ? ` ($${Number(t.monto_resuelto).toFixed(2)})` : ""}\n• Respuesta: ${t.respuesta_casa ?? ""}\n\n¡Gracias por tu confianza!`;
  return `https://wa.me/${numeroInt}?text=${encodeURIComponent(mensaje)}`;
}
/**
 * Abre el comprobante de un ticket.
 *
 * `tickets_jugadas.imagen_soporte` guarda el path dentro del bucket `reclamos`,
 * que es privado. La firma de la URL la pide la Edge Function `portal-auth`,
 * que distingue los dos caminos: si llega el JWT del staff la firma sin
 * restricciones; si llega un token de portal, solo para la carpeta del cliente
 * que resolvió ese token.
 *
 * No se puede seguir poniendo el valor de la columna en un `href`: con el
 * bucket privado eso da 404, y con el bucket público —como estaba antes— daba
 * acceso de lectura a cualquiera que conociera el path.
 */
export async function abrirImagenTicket(ruta: string): Promise<string | null> {
  if (!supabase) return null;
  if (/^https?:\/\//i.test(ruta)) return ruta; // ticket viejo, con URL absoluta
  try {
    const { data, error } = await supabase.functions.invoke("portal-auth", {
      body: { accion: "leer-imagen", ruta },
    });
    if (error) return null;
    const r = data as { ok?: boolean; url?: string } | null;
    return r?.ok ? r.url ?? null : null;
  } catch {
    return null;
  }
}
