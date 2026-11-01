import { supabase } from "@/core/supabase";
import { redondearCentavos } from "@/shared/lib/dinero";
import { calcularDeltaMovimientoSaldo } from "@/features/saldos/lib/saldo-semanal";

const TAMANO_PAGINA = 1000;

type FilaDeposito = {
  cliente_id?: string | null;
  tipo_operacion?: string | null;
  monto?: number | string | null;
  monto_usd?: number | string | null;
  moneda?: string | null;
  tasa_cambio?: number | string | null;
};

type FilaTransaccion = {
  tipo_operacion?: string | null;
  cliente_origen_id?: string | null;
  cliente_destino_id?: string | null;
  monto?: number | string | null;
  monto_usd?: number | string | null;
  moneda?: string | null;
  tasa_cambio?: number | string | null;
};

type FilaPago = {
  cliente_id?: string | null;
  direccion_flujo?: string | null;
  monto_equivalente_base?: number | string | null;
  estado?: string | null;
  created_at?: string | null;
  atendido_at?: string | null;
  aprobado_at?: string | null;
};

type ErrorConsulta = { code?: string; message?: string } | null;

async function cargarTodasLasPaginas<T>(
  cargarPagina: (desde: number, hasta: number) => Promise<{ data: unknown[] | null; error: ErrorConsulta }>
): Promise<T[]> {
  const filas: T[] = [];
  for (let desde = 0; ; desde += TAMANO_PAGINA) {
    const { data, error } = await cargarPagina(desde, desde + TAMANO_PAGINA - 1);
    if (error) {
      throw new Error(`No se pudieron cargar movimientos para el saldo semanal: ${error.message ?? "error desconocido"}`);
    }
    const pagina = (data ?? []) as T[];
    filas.push(...pagina);
    if (pagina.length < TAMANO_PAGINA) return filas;
  }
}

function montoEnUsd(monto: unknown, montoUsd: unknown, moneda: unknown, tasa: unknown): number {
  if (montoUsd != null && String(montoUsd).trim() !== "") {
    const usd = Number(montoUsd);
    if (Number.isFinite(usd)) return redondearCentavos(usd);
    throw new Error("Un movimiento de caja tiene un monto USD no numérico.");
  }
  if (monto == null || String(monto).trim() === "") {
    throw new Error("Un movimiento de caja no tiene monto registrado.");
  }
  const valor = Number(monto);
  if (!Number.isFinite(valor)) throw new Error("Un movimiento de caja tiene un monto no numérico.");
  if (String(moneda ?? "USD").trim().toUpperCase() !== "VES") return redondearCentavos(valor);
  const cambio = Number(tasa);
  if (!Number.isFinite(cambio) || cambio <= 0) {
    throw new Error("Un movimiento en VES no tiene una tasa de cambio válida.");
  }
  return redondearCentavos(valor / cambio);
}

function enRango(fecha: string | null | undefined, desde: string, hasta: string): boolean {
  if (!fecha) return false;
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(fecha)
    ? fecha
    : (() => {
        const instante = new Date(fecha);
        if (!Number.isFinite(instante.getTime())) return "";
        return `${instante.getFullYear()}-${String(instante.getMonth() + 1).padStart(2, "0")}-${String(instante.getDate()).padStart(2, "0")}`;
      })();
  return dia >= desde && dia <= hasta;
}

/**
 * Devuelve el efecto neto de caja por cliente dentro del rango, sin modificar
 * `clientes.saldo_actual`. Los avales otorgados no son efectivo y se excluyen.
 */
export async function cargarMovimientosSaldoSemanal(
  clienteIds: Array<string | number>,
  desde: string,
  hasta: string
): Promise<{ porCliente: Map<string, number>; advertencias: string[] }> {
  const porCliente = new Map<string, number>();
  const advertencias: string[] = [];
  const ids = [...new Set(clienteIds.map(String).filter(Boolean))];
  if (!ids.length) return { porCliente, advertencias };
  if (!supabase) throw new Error("No hay conexión a la base para previsualizar los movimientos semanales.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta) || desde > hasta) {
    throw new Error("El rango de fechas para el saldo semanal no es válido.");
  }

  const inicioLocal = new Date(`${desde}T00:00:00`);
  const finExclusivo = new Date(`${hasta}T00:00:00`);
  if (!Number.isFinite(inicioLocal.getTime()) || !Number.isFinite(finExclusivo.getTime())) {
    throw new Error("El rango de fechas para el saldo semanal no es válido.");
  }
  finExclusivo.setDate(finExclusivo.getDate() + 1);
  const hastaExclusivo = `${finExclusivo.getFullYear()}-${String(finExclusivo.getMonth() + 1).padStart(2, "0")}-${String(finExclusivo.getDate()).padStart(2, "0")}`;
  const desdeIso = inicioLocal.toISOString();
  const hastaIso = finExclusivo.toISOString();

  const depositos = await cargarTodasLasPaginas<FilaDeposito>(async (inicio, fin) =>
    await supabase!
      .from("depositos")
      .select("cliente_id, tipo_operacion, monto, monto_usd, moneda, tasa_cambio")
      .in("cliente_id", ids)
      .gte("fecha", desde)
      .lt("fecha", hastaExclusivo)
      .range(inicio, fin)
  );
  for (const fila of depositos) {
    const id = String(fila.cliente_id ?? "");
    const tipo = String(fila.tipo_operacion ?? "").trim().toUpperCase();
    if (!id || tipo === "OTORGAR AVAL") continue;
    if (tipo === "PAGAR AVAL") {
      advertencias.push(
        "Hay pagos de aval en el rango; se excluyeron porque el registro no distingue cuánto redujo deuda de saldo y cuánto amortizó aval."
      );
      continue;
    }
    const monto = montoEnUsd(fila.monto, fila.monto_usd, fila.moneda, fila.tasa_cambio);
    if (tipo !== "NORMAL") {
      advertencias.push(`Se excluyó un depósito con tipo de operación no reconocido: ${tipo || "vacío"}.`);
      continue;
    }
    porCliente.set(
      id,
      redondearCentavos((porCliente.get(id) ?? 0) + calcularDeltaMovimientoSaldo("DEPOSITO", monto))
    );
  }

  const transacciones = await cargarTodasLasPaginas<FilaTransaccion>(async (inicio, fin) =>
    await supabase!
      .from("transacciones_financieras")
      .select("tipo_operacion, cliente_origen_id, cliente_destino_id, monto, monto_usd, moneda, tasa_cambio")
      .or(`cliente_origen_id.in.(${ids.join(",")}),cliente_destino_id.in.(${ids.join(",")})`)
      .gte("fecha", desdeIso)
      .lt("fecha", hastaIso)
      .range(inicio, fin)
  );
  for (const fila of transacciones) {
    const tipo = String(fila.tipo_operacion ?? "").trim().toUpperCase();
    const origen = String(fila.cliente_origen_id ?? "");
    const destino = String(fila.cliente_destino_id ?? "");
    if (tipo === "RETIRO" && origen) {
      const monto = montoEnUsd(fila.monto, fila.monto_usd, fila.moneda, fila.tasa_cambio);
      porCliente.set(
        origen,
        redondearCentavos((porCliente.get(origen) ?? 0) + calcularDeltaMovimientoSaldo("RETIRO", monto))
      );
    } else if (tipo === "RETIRO") {
      advertencias.push("Hay un retiro sin cliente de origen; no pudo asignarse a un saldo.");
    } else if (tipo === "TRANSFERENCIA") {
      const monto = montoEnUsd(fila.monto, fila.monto_usd, fila.moneda, fila.tasa_cambio);
      if (origen) {
        porCliente.set(
          origen,
          redondearCentavos(
            (porCliente.get(origen) ?? 0) + calcularDeltaMovimientoSaldo("TRANSFERENCIA_SALIDA", monto)
          )
        );
      }
      if (destino) {
        porCliente.set(
          destino,
          redondearCentavos(
            (porCliente.get(destino) ?? 0) + calcularDeltaMovimientoSaldo("TRANSFERENCIA_ENTRADA", monto)
          )
        );
      }
      if (!origen || !destino) {
        advertencias.push("Hay una transferencia sin cliente de origen o destino; se revisó solo la parte identificable.");
      }
    } else {
      advertencias.push(`Se excluyó una transacción con tipo de operación no reconocido: ${tipo || "vacío"}.`);
    }
  }

  const pagos = await cargarTodasLasPaginas<FilaPago>(async (inicio, fin) =>
    await supabase!
      .from("pagos_comprobantes")
      .select("cliente_id, direccion_flujo, monto_equivalente_base, estado, created_at, atendido_at, aprobado_at")
      .in("cliente_id", ids)
      .range(inicio, fin)
  );
  for (const pago of pagos) {
    const id = String(pago.cliente_id ?? "");
    const estado = String(pago.estado ?? "").trim().toUpperCase();
    const fecha = pago.aprobado_at ?? pago.atendido_at ?? pago.created_at;
    if (estado !== "APROBADO") continue;
    if (!fecha) {
      advertencias.push("Hay un pago aprobado sin fecha de aplicación; no pudo ubicarse en una semana.");
      continue;
    }
    if (!enRango(fecha, desde, hasta)) continue;
    if (!id) {
      advertencias.push("Hay un pago aprobado sin cliente; no pudo asignarse a un saldo.");
      continue;
    }
    const monto = Number(pago.monto_equivalente_base);
    if (!Number.isFinite(monto)) {
      advertencias.push("Hay un pago aprobado con monto no numérico; no pudo incluirse.");
      continue;
    }
    const flujo = String(pago.direccion_flujo ?? "").trim().toUpperCase();
    if (flujo !== "PAGO_DE_CLIENTE" && flujo !== "PAGO_A_GANADOR") {
      advertencias.push(`Hay un pago aprobado con dirección de flujo no reconocida: ${flujo || "vacía"}.`);
      continue;
    }
    const delta = flujo === "PAGO_DE_CLIENTE" ? monto : flujo === "PAGO_A_GANADOR" ? -monto : 0;
    const tipoMovimiento = flujo === "PAGO_DE_CLIENTE" ? "COBRO_CLIENTE" : "PAGO_A_GANADOR";
    porCliente.set(
      id,
      redondearCentavos(
        (porCliente.get(id) ?? 0) + calcularDeltaMovimientoSaldo(tipoMovimiento, delta)
      )
    );
  }

  return { porCliente, advertencias: [...new Set(advertencias)] };
}
