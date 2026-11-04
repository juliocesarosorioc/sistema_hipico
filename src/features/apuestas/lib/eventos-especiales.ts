/**
 * ============================================================================
 * SERVICIO: Apuestas de Eventos Especiales / Libres
 * ============================================================================
 * Permite registrar y consultar apuestas sobre cualquier evento libre
 * (ej. "10/6 Milwaukee Brewers campeon serie mundial", eventos deportivos, etc.),
 * y seleccionar al ganador directamente desde su reporte integrado.
 */

import { supabase } from "@/core/supabase";
import { hoyLocal } from "@/core/utils/fechas";
import { generarAsientoPartidaDoble } from "@/features/contabilidad/lib/plan-cuentas";
import { sumarDinero, restarDinero } from "@/shared/lib/dinero";

export type EstadoApuestaEspecial = "PENDIENTE" | "GANADOR" | "PERDEDOR" | "ANULADA";

export interface ApuestaEventoEspecial {
  id: string;
  fecha: string;
  evento: string;
  cliente_id?: string;
  cliente_nombre: string;
  monto: number;
  logro_cuota?: string;
  pago_potencial: number;
  estado: EstadoApuestaEspecial;
  ganador_seleccionado: boolean;
  fecha_liquidacion?: string | null;
  nota?: string | null;
  creado_por?: string | null;
  creado_en: string;
  actualizado_en?: string;
}

const LOCAL_STORAGE_KEY = "hipico_apuestas_eventos_especiales";
let memoriaCache: ApuestaEventoEspecial[] = [];

function leerLocal(): ApuestaEventoEspecial[] {
  if (typeof window === "undefined") return memoriaCache;
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return memoriaCache;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : memoriaCache;
  } catch {
    return memoriaCache;
  }
}

function guardarLocal(lista: ApuestaEventoEspecial[]): void {
  memoriaCache = [...lista];
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(lista));
  } catch {
    /* ignore */
  }
}

/**
 * Calcula el pago potencial estimado según monto y formato de logro/cuota
 * Admite:
 * - Fracciones estilo americano (ej: "10/6", "5/2", "9/5")
 * - Decimales (ej: "1.65", "2.50")
 * - Americanos moneylines (ej: "+150", "-110")
 */
export function calcularPagoPotencial(monto: number, logroCuota?: string): number {
  if (monto <= 0) return 0;
  if (!logroCuota || !logroCuota.trim()) return monto;

  const raw = logroCuota.trim();

  // Fracción tipo "10/6" o "5/2"
  const mFrac = raw.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (mFrac) {
    const num = parseFloat(mFrac[1]);
    const den = parseFloat(mFrac[2]);
    if (den > 0) {
      // Ganancia = monto * (num / den), Pago total = monto + ganancia
      const ganancia = monto * (num / den);
      return Math.round((monto + ganancia) * 100) / 100;
    }
  }

  // Moneyline tipo "+150" o "-120"
  if (raw.startsWith("+")) {
    const ml = parseFloat(raw.slice(1));
    if (!Number.isNaN(ml)) {
      const ganancia = (monto * ml) / 100;
      return Math.round((monto + ganancia) * 100) / 100;
    }
  } else if (raw.startsWith("-")) {
    const ml = parseFloat(raw.slice(1));
    if (!Number.isNaN(ml) && ml > 0) {
      const ganancia = (monto * 100) / ml;
      return Math.round((monto + ganancia) * 100) / 100;
    }
  }

  // Cuota Decimal (ej: "2.50", "1.67")
  const mDec = parseFloat(raw);
  if (!Number.isNaN(mDec) && mDec > 0) {
    // Si la cuota es >= 1.05 se toma como factor multiplicador total
    if (mDec >= 1.05) {
      return Math.round(monto * mDec * 100) / 100;
    }
  }

  return monto;
}

/**
 * Lista las apuestas de eventos especiales registradas
 */
export async function listarApuestasEventosEspeciales(filtroFecha?: string): Promise<ApuestaEventoEspecial[]> {
  const locales = leerLocal();

  if (supabase) {
    try {
      let query = supabase
        .from("apuestas_eventos_especiales")
        .select("*")
        .order("creado_en", { ascending: false });

      if (filtroFecha) {
        query = query.eq("fecha", filtroFecha);
      }

      const { data, error } = await query;
      if (!error && Array.isArray(data)) {
        // Mezclar con locales si hubiese desincronización
        const mapPorId = new Map<string, ApuestaEventoEspecial>();
        for (const loc of locales) mapPorId.set(loc.id, loc);
        for (const rem of data) {
          mapPorId.set(rem.id, {
            id: String(rem.id),
            fecha: String(rem.fecha),
            evento: String(rem.evento),
            cliente_id: rem.cliente_id ? String(rem.cliente_id) : undefined,
            cliente_nombre: String(rem.cliente_nombre),
            monto: Number(rem.monto) || 0,
            logro_cuota: rem.logro_cuota ? String(rem.logro_cuota) : undefined,
            pago_potencial: Number(rem.pago_potencial) || 0,
            estado: rem.estado as EstadoApuestaEspecial,
            ganador_seleccionado: Boolean(rem.ganador_seleccionado),
            fecha_liquidacion: rem.fecha_liquidacion,
            nota: rem.nota,
            creado_por: rem.creado_por,
            creado_en: rem.creado_en,
            actualizado_en: rem.actualizado_en,
          });
        }
        const combinados = Array.from(mapPorId.values()).sort(
          (a, b) => new Date(b.creado_en).getTime() - new Date(a.creado_en).getTime()
        );
        guardarLocal(combinados);
        return filtroFecha ? combinados.filter((c) => c.fecha === filtroFecha) : combinados;
      }
    } catch {
      /* fallback a local */
    }
  }

  return filtroFecha ? locales.filter((c) => c.fecha === filtroFecha) : locales;
}

/**
 * Registra una nueva apuesta de evento especial
 */
export async function registrarApuestaEventoEspecial(datos: {
  fecha?: string;
  evento: string;
  cliente_id?: string;
  cliente_nombre: string;
  monto: number;
  logro_cuota?: string;
  pago_potencial?: number;
  nota?: string;
  creado_por?: string;
}): Promise<{ ok: boolean; apuesta?: ApuestaEventoEspecial; error?: string }> {
  const eventoLimpio = datos.evento.trim();
  const clienteLimpio = datos.cliente_nombre.trim();

  if (!eventoLimpio) {
    return { ok: false, error: "Debe indicar el nombre o descripción del evento." };
  }
  if (!clienteLimpio) {
    return { ok: false, error: "Debe seleccionar o indicar el nombre del cliente." };
  }
  if (!Number.isFinite(datos.monto) || datos.monto <= 0) {
    return { ok: false, error: "El monto de la apuesta debe ser mayor a 0." };
  }

  // Validación de saldo disponible y aval en tiempo real
  if (datos.cliente_id && supabase) {
    try {
      const { data: cli } = await supabase
        .from("clientes")
        .select("id, nombre, saldo_actual, aval")
        .eq("id", datos.cliente_id as never)
        .maybeSingle();
      if (cli) {
        const disponible = (Number(cli.saldo_actual) || 0) + (Number(cli.aval) || 0);
        if (datos.monto > disponible) {
          return {
            ok: false,
            error: `Saldo insuficiente para ${cli.nombre}. Disponible: $${disponible.toFixed(2)} (Saldo: $${Number(cli.saldo_actual).toFixed(2)}, Aval: $${Number(cli.aval).toFixed(2)}).`,
          };
        }
      }
    } catch {
      /* ignore */
    }
  }

  const fechaEfectiva = datos.fecha || hoyLocal();
  const pagoEstimado =
    datos.pago_potencial !== undefined && datos.pago_potencial > 0
      ? datos.pago_potencial
      : calcularPagoPotencial(datos.monto, datos.logro_cuota);

  const nueva: ApuestaEventoEspecial = {
    id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `esp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    fecha: fechaEfectiva,
    evento: eventoLimpio,
    cliente_id: datos.cliente_id,
    cliente_nombre: clienteLimpio,
    monto: Math.round(datos.monto * 100) / 100,
    logro_cuota: datos.logro_cuota ? datos.logro_cuota.trim() : undefined,
    pago_potencial: Math.round(pagoEstimado * 100) / 100,
    estado: "PENDIENTE",
    ganador_seleccionado: false,
    nota: datos.nota?.trim() || null,
    creado_por: datos.creado_por || "Taquilla",
    creado_en: new Date().toISOString(),
  };

  // Guardar en local primero para respuesta inmediata
  const actuales = leerLocal();
  actuales.unshift(nueva);
  guardarLocal(actuales);

  // Replicar en Supabase si está disponible
  if (supabase) {
    try {
      await supabase.from("apuestas_eventos_especiales").insert([
        {
          id: nueva.id,
          fecha: nueva.fecha,
          evento: nueva.evento,
          cliente_id: nueva.cliente_id || null,
          cliente_nombre: nueva.cliente_nombre,
          monto: nueva.monto,
          logro_cuota: nueva.logro_cuota || null,
          pago_potencial: nueva.pago_potencial,
          estado: nueva.estado,
          ganador_seleccionado: nueva.ganador_seleccionado,
          nota: nueva.nota,
          creado_por: nueva.creado_por,
          creado_en: nueva.creado_en,
        },
      ]);
    } catch {
      /* ignore */
    }
  }

  return { ok: true, apuesta: nueva };
}

/**
 * Selecciona o actualiza el estado de una apuesta (Ganador / Perdedor / Pendiente / Anulada)
 * Ejecuta liquidación exacta o reversión atómica de saldos y asientos contables NIIF de partida doble.
 */
export async function actualizarEstadoEventoEspecial(
  id: string,
  nuevoEstado: EstadoApuestaEspecial,
  motivo?: string
): Promise<{ ok: boolean; error?: string }> {
  const actuales = leerLocal();
  const idx = actuales.findIndex((a) => a.id === id);
  if (idx === -1) {
    return { ok: false, error: "Apuesta no encontrada." };
  }

  const apuesta = actuales[idx];
  const estadoAnterior = apuesta.estado;
  const ahora = new Date().toISOString();

  actuales[idx].estado = nuevoEstado;
  actuales[idx].ganador_seleccionado = nuevoEstado === "GANADOR";
  actuales[idx].fecha_liquidacion = nuevoEstado !== "PENDIENTE" ? ahora : null;
  actuales[idx].actualizado_en = ahora;

  guardarLocal(actuales);

  if (supabase) {
    try {
      await supabase
        .from("apuestas_eventos_especiales")
        .update({
          estado: nuevoEstado,
          ganador_seleccionado: nuevoEstado === "GANADOR",
          fecha_liquidacion: nuevoEstado !== "PENDIENTE" ? ahora : null,
          actualizado_en: ahora,
          nota: motivo ? `${apuesta.nota ? apuesta.nota + " | " : ""}${motivo}` : apuesta.nota,
        })
        .eq("id", id);

      // Impacto en saldo del cliente y registro contable NIIF de partida doble
      if (apuesta.cliente_id) {
        const cId = apuesta.cliente_id;
        const { data: cli } = await supabase
          .from("clientes")
          .select("saldo_actual, nombre")
          .eq("id", cId as never)
          .maybeSingle();

        if (cli) {
          const saldoPrevio = Number(cli.saldo_actual || 0);

          if (nuevoEstado === "GANADOR" && estadoAnterior !== "GANADOR") {
            const gananciaNeta = Math.max(0, apuesta.pago_potencial - apuesta.monto);
            await supabase
              .from("clientes")
              .update({ saldo_actual: sumarDinero(saldoPrevio, gananciaNeta) })
              .eq("id", cId as never);

            await generarAsientoPartidaDoble({
              fecha_contable: apuesta.fecha,
              tipo_evento: "PREMIO_EVENTO_ESPECIAL",
              referencia_id: `ESP:${apuesta.id}`,
              clave_idempotencia: `ESP:GAN:${apuesta.id}`,
              descripcion: `Premio Evento Especial: ${apuesta.evento} (${apuesta.cliente_nombre})`,
              lineas: [
                {
                  cuenta_codigo: "5.1.01.001",
                  debe: gananciaNeta,
                  haber: 0,
                  concepto: `Gasto Premio Ganador Evento Especial - ${apuesta.evento}`,
                },
                {
                  cuenta_codigo: "2.1.01.001",
                  cliente_id: apuesta.cliente_id,
                  cliente_nombre: apuesta.cliente_nombre,
                  debe: 0,
                  haber: gananciaNeta,
                  concepto: `Premio acreditado - ${apuesta.cliente_nombre}`,
                },
              ],
            });
          } else if (nuevoEstado === "PERDEDOR" && estadoAnterior !== "PERDEDOR") {
            await supabase
              .from("clientes")
              .update({ saldo_actual: restarDinero(saldoPrevio, apuesta.monto) })
              .eq("id", cId as never);

            await generarAsientoPartidaDoble({
              fecha_contable: apuesta.fecha,
              tipo_evento: "PERDIDA_EVENTO_ESPECIAL",
              referencia_id: `ESP:${apuesta.id}`,
              clave_idempotencia: `ESP:PERD:${apuesta.id}`,
              descripcion: `Cobro apuesta perdida Evento Especial: ${apuesta.evento} (${apuesta.cliente_nombre})`,
              lineas: [
                {
                  cuenta_codigo: "1.2.02.001",
                  cliente_id: apuesta.cliente_id,
                  cliente_nombre: apuesta.cliente_nombre,
                  debe: apuesta.monto,
                  haber: 0,
                  concepto: `Cobro apuesta perdida Evento Especial - ${apuesta.cliente_nombre}`,
                },
                {
                  cuenta_codigo: "4.1.01.001",
                  debe: 0,
                  haber: apuesta.monto,
                  concepto: `Ingreso apuestas deportivas/especiales - ${apuesta.evento}`,
                },
              ],
            });
          } else if (nuevoEstado === "ANULADA" || nuevoEstado === "PENDIENTE") {
            // Reversar estado anterior si estaba liquidado
            if (estadoAnterior === "GANADOR") {
              const gananciaNeta = Math.max(0, apuesta.pago_potencial - apuesta.monto);
              await supabase
                .from("clientes")
                .update({ saldo_actual: restarDinero(saldoPrevio, gananciaNeta) })
                .eq("id", cId as never);
            } else if (estadoAnterior === "PERDEDOR") {
              await supabase
                .from("clientes")
                .update({ saldo_actual: sumarDinero(saldoPrevio, apuesta.monto) })
                .eq("id", cId as never);
            }

            await generarAsientoPartidaDoble({
              fecha_contable: apuesta.fecha,
              tipo_evento: "REVERSION_EVENTO_ESPECIAL",
              referencia_id: `REV:ESP:${apuesta.id}`,
              clave_idempotencia: `ESP:REV:${apuesta.id}`,
              descripcion: `Reversión / Anulación Evento Especial: ${apuesta.evento} (${apuesta.cliente_nombre})`,
              lineas: [
                {
                  cuenta_codigo: "2.1.01.001",
                  cliente_id: apuesta.cliente_id,
                  cliente_nombre: apuesta.cliente_nombre,
                  debe: apuesta.monto,
                  haber: 0,
                  concepto: `Reversión contable saldo cliente - ${apuesta.cliente_nombre}`,
                },
                {
                  cuenta_codigo: "4.1.01.001",
                  debe: 0,
                  haber: apuesta.monto,
                  concepto: `Reversión contable ingreso casa - ${apuesta.evento}`,
                },
              ],
            });
          }
        }
      }
    } catch (err) {
      console.warn("Fallo sincronizando estado/contabilidad de evento especial:", err);
    }
  }

  return { ok: true };
}

/**
 * Elimina una apuesta de evento especial
 */
export async function eliminarApuestaEventoEspecial(id: string): Promise<{ ok: boolean }> {
  const actuales = leerLocal().filter((a) => a.id !== id);
  guardarLocal(actuales);

  if (supabase) {
    try {
      await supabase.from("apuestas_eventos_especiales").delete().eq("id", id);
    } catch {
      /* ignore */
    }
  }

  return { ok: true };
}
