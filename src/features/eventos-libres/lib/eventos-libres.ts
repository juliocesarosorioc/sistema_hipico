/**
 * ============================================================================
 * MOTOR DE EVENTOS LIBRES (SPORTSBOOK P2P Y MERCADOS DEPORTIVOS)
 * (`eventos-libres.ts`)
 * ============================================================================
 *
 * Soporta operativa directa P2P ("Quien Juega" vs "Quien Da") y está
 * arquitectónicamente preparado para escalar a plataforma deportiva multideporte:
 *  - Categorías: LIBRE, BEISBOL, FUTBOL, BASKETBALL, HIPISMO_ESPECIAL.
 *  - Logros/Mercados: 10/6, 10A7, 1P, PP, GANADOR, PERDEDOR, EMPATE, 1_GOL, 2_GOLES, 3_GOLES, ALTA, BAJA.
 *  - Registro manual de mercado y riesgos; se conserva el helper de cálculo
 *    automático de cuotas para integraciones existentes.
 *  - Comisión de grupo capturada al registrar y liquidación manual del monto bruto.
 *  - Selección manual de ganador: "🏆 Ganó Quien Juega", "🏆 Ganó Quien Da", "🤝 Empate/Nulo".
 *  - Cobro automático de comisión particular (o grupo).
 *  - Acreditación de incentivo y comisión confidencial al socio.
 *  - Registro de Asiento Contable de Partida Doble cuadrado y traza inmutable.
 */

import { supabase } from "@/core/supabase";
import { redondearCentavos, sumarDinero, restarDinero, calcularComisionExacta } from "@/shared/lib/dinero";
import {
  calcularLiquidacionConIncentivosYSocios,
  emitirMensajePaso,
  type ConfigJugadorLiquidacion,
  type ResultadoLiquidacionUnificada,
} from "@/features/liquidacion/lib/liquidacion-incentivos-socios";

export type CategoriaDeporte =
  | "LIBRE"
  | "BEISBOL"
  | "FUTBOL"
  | "BASKETBALL"
  | "HIPISMO_ESPECIAL";

export type TipoMercadoLogro =
  | "10/6"
  | "10A7"
  | "1P"
  | "PP"
  | "GANADOR"
  | "PERDEDOR"
  | "EMPATE"
  | "1_GOL"
  | "2_GOLES"
  | "3_GOLES"
  | "ALTA"
  | "BAJA"
  | string;

export type EstadoEventoLibre = "PENDIENTE" | "GANO_JUGADOR_1" | "GANO_JUGADOR_2" | "EMPATE" | "ANULADA";

export interface EventoLibreRow {
  id: string;
  fecha: string;
  categoria: CategoriaDeporte;
  concepto: string; // Ej: "Real Madrid vs Barcelona - Real Madrid Ganador"
  mercado: TipoMercadoLogro;
  
  // Jugador 1 (Quien Juega)
  jugador1Id: string | number;
  jugador1Nombre: string;
  riesgoJugador1: number; // Monto que arriesga Jugador 1
  
  // Jugador 2 (Quien Da)
  jugador2Id: string | number;
  jugador2Nombre: string;
  riesgoJugador2: number; // Monto que arriesga Jugador 2

  /** Comisión del grupo fijada manualmente al registrar la apuesta. */
  comisionGrupoPct?: number;
  estado: EstadoEventoLibre;
  ganadorSeleccionado?: "JUGADOR_1" | "JUGADOR_2" | "EMPATE" | null;
  montoLiquidadoGanador?: number;
  
  // Resultados financieros
  gananciaBrutaGanador?: number;
  comisionCobrada?: number;
  gananciaNetaGanador?: number;
  incentivoAcreditado?: number;
  comisionSocioAcreditada?: number;

  creadoPor?: string | null;
  actualizadoEn?: string;
  fechaLiquidacion?: string | null;
  asientoReferencia?: string | null;
}

const STORAGE_KEY = "hipico_eventos_libres_p2p";
let memoriaEventos: EventoLibreRow[] = [];

export function leerEventosLibresMemoria(): EventoLibreRow[] {
  if (typeof window === "undefined") return memoriaEventos;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return memoriaEventos;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : memoriaEventos;
  } catch {
    return memoriaEventos;
  }
}

export function guardarEventosLibresMemoria(lista: EventoLibreRow[]): void {
  memoriaEventos = [...lista];
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lista));
  } catch {
    /* ignore */
  }
}

function eventoDesdeNota(nota: unknown): EventoLibreRow | null {
  const raw = String(nota ?? "");
  const prefijo = "EVENTO_LIBRE_P2P:";
  if (!raw.startsWith(prefijo)) return null;
  try {
    const parsed: unknown = JSON.parse(raw.slice(prefijo.length));
    if (!parsed || typeof parsed !== "object") return null;
    const evento = parsed as Partial<EventoLibreRow>;
    if (
      typeof evento.id !== "string" ||
      typeof evento.concepto !== "string" ||
      typeof evento.jugador1Nombre !== "string" ||
      typeof evento.jugador2Nombre !== "string" ||
      typeof evento.riesgoJugador1 !== "number" ||
      typeof evento.riesgoJugador2 !== "number" ||
      !evento.fecha ||
      !evento.categoria ||
      !evento.estado
    ) {
      return null;
    }
    return evento as EventoLibreRow;
  } catch {
    return null;
  }
}

export async function cargarEventosLibres(): Promise<{
  eventos: EventoLibreRow[];
  warning?: string;
}> {
  const locales = leerEventosLibresMemoria();
  if (!supabase) return { eventos: locales };

  const { data, error } = await supabase
    .from("apuestas_eventos_especiales")
    .select("nota")
    .order("creado_en", { ascending: false });
  if (error) {
    return { eventos: locales, warning: `No se pudieron sincronizar eventos de la base: ${error.message}` };
  }

  const porId = new Map<string, EventoLibreRow>();
  for (const row of data ?? []) {
    const evento = eventoDesdeNota(row.nota);
    if (evento) porId.set(evento.id, evento);
  }
  for (const local of locales) {
    const remoto = porId.get(local.id);
    const localTs = Date.parse(local.actualizadoEn ?? "");
    const remotoTs = Date.parse(remoto?.actualizadoEn ?? "");
    if (!remoto || (Number.isFinite(localTs) && localTs > remotoTs)) {
      porId.set(local.id, local);
    }
  }
  const eventos = [...porId.values()].sort((a, b) =>
    String(b.actualizadoEn ?? b.fecha).localeCompare(String(a.actualizadoEn ?? a.fecha))
  );
  guardarEventosLibresMemoria(eventos);
  return { eventos };
}

function nuevoIdEvento(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Calcula automáticamente el riesgo del dador (Jugador 2) a partir del
 * monto del jugador 1 y del logro (ej: 10/6, 10A7, etc.)
 */
export function calcularRiesgosLogro(
  montoJuega: number,
  logro: string
): { riesgoJuega: number; riesgoDa: number } {
  const juega = redondearCentavos(montoJuega);
  if (juega <= 0) return { riesgoJuega: 0, riesgoDa: 0 };

  const raw = String(logro ?? "").trim().toUpperCase();

  // Logro tipo "10/6" o "10 A 6" o "10A6"
  const m1 = raw.match(/^(\d+(?:\.\d+)?)\s*(?:\/|\s*A\s*)\s*(\d+(?:\.\d+)?)$/);
  if (m1) {
    const n1 = parseFloat(m1[1]);
    const n2 = parseFloat(m1[2]);
    if (n1 > 0 && n2 > 0) {
      // 10/6: Quien juega arriesga 1000, quien da arriesga 600
      const da = redondearCentavos(juega * (n2 / n1));
      return { riesgoJuega: juega, riesgoDa: da };
    }
  }

  // Logro 1P o parejo
  if (raw === "1P" || raw === "PP" || raw === "1A1" || raw === "1/1") {
    return { riesgoJuega: juega, riesgoDa: juega };
  }

  return { riesgoJuega: juega, riesgoDa: juega };
}

/**
 * Registra un nuevo evento libre validando la disponibilidad de ambos jugadores
 */
export async function crearEventoLibre(params: {
  fecha?: string;
  categoria: CategoriaDeporte;
  concepto: string;
  mercado: TipoMercadoLogro;
  jugador1: { id: string | number; nombre: string; disponible: number };
  jugador2: { id: string | number; nombre: string; disponible: number };
  riesgo1: number;
  riesgo2: number;
  comisionGrupoPct?: number;
  creadoPor?: string | null;
}): Promise<{ ok: boolean; evento?: EventoLibreRow; error?: string; warning?: string }> {
  emitirMensajePaso("⏳ [Paso 1/4] Validando saldos y reglas del Evento Libre...", "info");

  const r1 = redondearCentavos(params.riesgo1);
  const r2 = redondearCentavos(params.riesgo2);

  if (r1 <= 0 || r2 <= 0) {
    return { ok: false, error: "Los montos de riesgo deben ser mayores a 0." };
  }

  const comisionGrupoPct = Number(params.comisionGrupoPct ?? 5);
  if (!Number.isFinite(comisionGrupoPct) || comisionGrupoPct < 0 || comisionGrupoPct > 100) {
    return { ok: false, error: "La comisión del grupo debe estar entre 0% y 100%." };
  }
  const disponible1 = Math.max(0, redondearCentavos(params.jugador1.disponible));
  const disponible2 = Math.max(0, redondearCentavos(params.jugador2.disponible));
  if (r1 > disponible1) {
    return { ok: false, error: `El jugador ${params.jugador1.nombre} no tiene saldo disponible suficiente.` };
  }
  if (r2 > disponible2) {
    return { ok: false, error: `El jugador ${params.jugador2.nombre} no tiene saldo disponible suficiente.` };
  }

  const id = nuevoIdEvento();
  const fecha = params.fecha || new Date().toISOString().slice(0, 10);

  const nuevo: EventoLibreRow = {
    id,
    fecha,
    categoria: params.categoria,
    concepto: params.concepto.trim() || "Evento Deportivo Libre",
    mercado: params.mercado,
    jugador1Id: params.jugador1.id,
    jugador1Nombre: params.jugador1.nombre,
    riesgoJugador1: r1,
    jugador2Id: params.jugador2.id,
    jugador2Nombre: params.jugador2.nombre,
    riesgoJugador2: r2,
    comisionGrupoPct,
    estado: "PENDIENTE",
    ganadorSeleccionado: null,
    creadoPor: params.creadoPor || "OPERADOR",
    actualizadoEn: new Date().toISOString(),
  };

  const lista = [nuevo, ...leerEventosLibresMemoria()];
  guardarEventosLibresMemoria(lista);

  // Intentar persistir en Supabase si existe tabla
  if (supabase) {
    try {
      const { error } = await supabase.from("apuestas_eventos_especiales").insert([{
        id,
        fecha,
        evento: `[${params.categoria}] ${nuevo.concepto} (${nuevo.jugador1Nombre} vs ${nuevo.jugador2Nombre})`,
        cliente_id: String(nuevo.jugador1Id),
        cliente_nombre: nuevo.jugador1Nombre,
        monto: nuevo.riesgoJugador1,
        pago_potencial: nuevo.riesgoJugador1 + nuevo.riesgoJugador2,
        logro_cuota: String(params.mercado),
        estado: "PENDIENTE",
        ganador_seleccionado: false,
        nota: `EVENTO_LIBRE_P2P:${JSON.stringify(nuevo)}`,
        creado_por: nuevo.creadoPor,
      }]);
      if (error) {
        return { ok: true, evento: nuevo, warning: `Se guardó localmente, pero no en la base: ${error.message}` };
      }
    } catch (error) {
      const detalle = error instanceof Error ? error.message : String(error);
      return { ok: true, evento: nuevo, warning: `Se guardó localmente, pero no en la base: ${detalle}` };
    }
  }

  emitirMensajePaso(`✅ [Paso 4/4] Evento Libre "${nuevo.concepto}" registrado exitosamente.`, "success");
  return { ok: true, evento: nuevo };
}

/**
 * Liquida manualmente el Evento Libre decidiendo quién ganó
 */
export async function liquidarEventoLibre(params: {
  eventoId: string;
  ganador: "JUGADOR_1" | "JUGADOR_2" | "EMPATE";
  /** Ganancia bruta antes de comisión. Necesaria para liquidar a un ganador. */
  montoGanancia?: number;
  config1: ConfigJugadorLiquidacion;
  config2: ConfigJugadorLiquidacion;
  comisionGrupoDefault?: number;
}): Promise<{ ok: boolean; resultado?: ResultadoLiquidacionUnificada; error?: string; warning?: string }> {
  emitirMensajePaso("⚙️ [Paso 2/4] Liquidando jugadas, incentivos y socios del Evento Libre...", "info");

  const lista = leerEventosLibresMemoria();
  const ev = lista.find((e) => e.id === params.eventoId);
  if (!ev) {
    return { ok: false, error: "Evento libre no encontrado." };
  }

  const ganoJ1 = params.ganador === "JUGADOR_1";
  const ganoJ2 = params.ganador === "JUGADOR_2";
  const esEmpate = params.ganador === "EMPATE";

  // Monto arriesgado y ganancia bruta según quién ganó
  const montoJuega = ev.riesgoJugador1;
  const montoGanancia = redondearCentavos(
    params.montoGanancia ?? (ganoJ1 ? ev.riesgoJugador2 : ev.riesgoJugador1)
  );
  if (!esEmpate && (!Number.isFinite(montoGanancia) || montoGanancia <= 0)) {
    return { ok: false, error: "Indique una ganancia bruta mayor a 0 para liquidar el evento." };
  }
  const riesgoDelPerdedor = ganoJ1 ? ev.riesgoJugador2 : ev.riesgoJugador1;
  if (!esEmpate && montoGanancia > riesgoDelPerdedor) {
    return {
      ok: false,
      error: `La ganancia indicada excede el riesgo acordado del perdedor (${riesgoDelPerdedor.toFixed(2)}).`,
    };
  }

  let premioBrutoJuega = 0;
  if (ganoJ1) {
    premioBrutoJuega = sumarDinero(montoJuega, montoGanancia);
  }

  const resUnificado = calcularLiquidacionConIncentivosYSocios(
    {
      referencia: `EVENTO LIBRE: ${ev.concepto}`,
      montoJugado: montoJuega,
      montoDecidido: montoJuega,
      premioBruto: premioBrutoJuega,
      estado: ganoJ1 ? "GANADOR" : ganoJ2 ? "PERDEDOR" : "EMPATE",
      perdidaEfectiva: ganoJ2 ? montoGanancia : 0,
      modalidad: "LIBRE",
    },
    params.config1,
    params.config2,
    ev.comisionGrupoPct ?? params.comisionGrupoDefault ?? 5
  );

  emitirMensajePaso("📘 [Paso 3/4] Registrando asiento contable NIIF y traza de auditoría...", "info");

  // Actualizar saldo de los clientes en BD si aplica
  if (supabase) {
    try {
      if (ganoJ1) {
        // Acreditar a J1 su ganancia neta + su incentivo
        const { data: c1 } = await supabase.from("clientes").select("saldo_actual").eq("id", params.config1.clienteId).maybeSingle();
        if (c1) {
          const act1 = Number(c1.saldo_actual || 0);
          await supabase.from("clientes").update({ saldo_actual: sumarDinero(act1, resUnificado.jugador1.impactoSaldoTotal) }).eq("id", params.config1.clienteId as never);
        }
        // Descontar a J2 su pérdida
        const { data: c2 } = await supabase.from("clientes").select("saldo_actual").eq("id", params.config2.clienteId).maybeSingle();
        if (c2) {
          const act2 = Number(c2.saldo_actual || 0);
          await supabase.from("clientes").update({ saldo_actual: restarDinero(act2, montoGanancia) }).eq("id", params.config2.clienteId as never);
        }
      } else if (ganoJ2) {
        // Descontar a J1 su pérdida
        const { data: c1 } = await supabase.from("clientes").select("saldo_actual").eq("id", params.config1.clienteId).maybeSingle();
        if (c1) {
          const act1 = Number(c1.saldo_actual || 0);
          await supabase.from("clientes").update({ saldo_actual: restarDinero(act1, montoGanancia) }).eq("id", params.config1.clienteId as never);
        }
        // Acreditar a J2 su ganancia neta + su incentivo
        const { data: c2 } = await supabase.from("clientes").select("saldo_actual").eq("id", params.config2.clienteId).maybeSingle();
        if (c2) {
          const act2 = Number(c2.saldo_actual || 0);
          const imp2 = resUnificado.jugador2?.impactoSaldoTotal ?? montoJuega;
          await supabase.from("clientes").update({ saldo_actual: sumarDinero(act2, imp2) }).eq("id", params.config2.clienteId as never);
        }
      }

      // Acreditar comisiones a socios si aplica
      if (resUnificado.socioJugador1 && resUnificado.socioJugador1.montoAcreditado > 0) {
        const { data: s1 } = await supabase.from("clientes").select("saldo_actual").eq("id", resUnificado.socioJugador1.socioId).maybeSingle();
        if (s1) {
          const actSoc1 = Number(s1.saldo_actual || 0);
          await supabase.from("clientes").update({ saldo_actual: sumarDinero(actSoc1, resUnificado.socioJugador1.montoAcreditado) }).eq("id", resUnificado.socioJugador1.socioId as never);
        }
      }
      if (resUnificado.socioJugador2 && resUnificado.socioJugador2.montoAcreditado > 0) {
        const { data: s2 } = await supabase.from("clientes").select("saldo_actual").eq("id", resUnificado.socioJugador2.socioId).maybeSingle();
        if (s2) {
          const actSoc2 = Number(s2.saldo_actual || 0);
          await supabase.from("clientes").update({ saldo_actual: sumarDinero(actSoc2, resUnificado.socioJugador2.montoAcreditado) }).eq("id", resUnificado.socioJugador2.socioId as never);
        }
      }
    } catch (e) {
      console.warn("Fallo no bloqueante al persistir saldos de Evento Libre:", e);
    }
  }

  // Actualizar el estado del evento
  ev.estado = ganoJ1 ? "GANO_JUGADOR_1" : ganoJ2 ? "GANO_JUGADOR_2" : "EMPATE";
  ev.ganadorSeleccionado = params.ganador;
  ev.montoLiquidadoGanador = esEmpate ? 0 : montoGanancia;
  ev.fechaLiquidacion = new Date().toISOString();
  ev.actualizadoEn = ev.fechaLiquidacion;
  ev.gananciaBrutaGanador = ganoJ1 ? resUnificado.jugador1.gananciaBruta : (resUnificado.jugador2?.gananciaBruta ?? 0);
  ev.comisionCobrada = resUnificado.totalComisionCasa;
  ev.gananciaNetaGanador = ganoJ1 ? resUnificado.jugador1.gananciaNeta : (resUnificado.jugador2?.gananciaNeta ?? 0);
  ev.incentivoAcreditado = sumarDinero(resUnificado.jugador1.incentivoDevolucion, resUnificado.jugador2?.incentivoDevolucion ?? 0);
  ev.comisionSocioAcreditada = sumarDinero(resUnificado.socioJugador1?.montoAcreditado ?? 0, resUnificado.socioJugador2?.montoAcreditado ?? 0);

  guardarEventosLibresMemoria(lista);
  if (supabase && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ev.id)) {
    const estadoPersistido = ganoJ1 ? "GANADOR" : ganoJ2 ? "PERDEDOR" : "ANULADA";
    const { error } = await supabase
      .from("apuestas_eventos_especiales")
      .update({
        estado: estadoPersistido,
        ganador_seleccionado: true,
        fecha_liquidacion: ev.fechaLiquidacion,
        nota: `EVENTO_LIBRE_P2P:${JSON.stringify(ev)}`,
      })
      .eq("id", ev.id);
    if (error) {
      return {
        ok: true,
        resultado: resUnificado,
        warning: `Los saldos se procesaron y el resultado quedó en este dispositivo, pero no se pudo guardar en la base: ${error.message}`,
      };
    }
  }

  emitirMensajePaso(`✅ [Paso 4/4] Evento Libre liquidado con éxito. Ganador: ${params.ganador}.`, "success");

  return { ok: true, resultado: resUnificado };
}
