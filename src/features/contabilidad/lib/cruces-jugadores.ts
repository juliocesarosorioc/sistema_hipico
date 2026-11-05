/**
 * Cruces y Transferencias de Saldo entre Jugadores.
 *
 * Permite que un jugador le pase su saldo a otro generando partida y contrapartida
 * contable estricta (Debe === Haber), actualizando ambos saldos en tiempo real
 * y registrando el capture de pantalla del mensaje como soporte de auditoría.
 */
import { supabase } from "@/core/supabase";
import { usuarioVigente, grupoActivoVigente, grupoVigente } from "@/features/seguridad/lib/vigente";
import { esSinTope } from "@/features/taquilla/lib/reparto";

export type CruceJugadoresInput = {
  emisorId: string;
  emisorNombre: string;
  receptorId: string;
  receptorNombre: string;
  monto: number;
  captureSoporte: string; // Base64 Data URL o URL
  nota?: string;
  grupoId?: string | null;
  usuario?: string | null;
};

export type CruceJugadoresResultado = {
  ok: boolean;
  error?: string;
  saldoAnteriorEmisor?: number;
  saldoNuevoEmisor?: number;
  saldoAnteriorReceptor?: number;
  saldoNuevoReceptor?: number;
  transaccionId?: number | string;
};

function redondear(num: number): number {
  return Math.round((Number(num) + Number.EPSILON) * 100) / 100;
}

/**
 * Ejecuta el cruce de saldo entre dos jugadores con partida doble contable.
 */
export async function registrarCruceJugadores(
  params: CruceJugadoresInput
): Promise<CruceJugadoresResultado> {
  const emisorId = String(params.emisorId ?? "").trim();
  const receptorId = String(params.receptorId ?? "").trim();
  const monto = redondear(params.monto);
  const capture = String(params.captureSoporte ?? "").trim();

  // Validaciones básicas
  if (!emisorId || !receptorId) {
    return { ok: false, error: "Debe seleccionar tanto el jugador que emite como el que recibe." };
  }
  if (emisorId === receptorId) {
    return { ok: false, error: "El jugador emisor y el receptor no pueden ser la misma persona." };
  }
  if (!(monto > 0)) {
    return { ok: false, error: "El monto a transferir debe ser mayor a $0." };
  }
  if (!capture) {
    return { ok: false, error: "Es obligatorio adjuntar el capture de pantalla del mensaje como soporte." };
  }
  if (!supabase) {
    return { ok: false, error: "Sin conexión a la base de datos (Supabase)." };
  }

  const operador = params.usuario || usuarioVigente() || "operador";
  const grupoId = params.grupoId || grupoActivoVigente() || grupoVigente() || null;

  try {
    // 1. Consultar saldos y condiciones de ambos clientes
    const [resEmisor, resReceptor] = await Promise.all([
      supabase
        .from("clientes")
        .select("id, nombre, seudonimo, saldo_actual, aval, libre, modo_juego, grupo_id")
        .eq("id", emisorId)
        .single(),
      supabase
        .from("clientes")
        .select("id, nombre, seudonimo, saldo_actual, aval, libre, modo_juego, grupo_id")
        .eq("id", receptorId)
        .single(),
    ]);

    if (resEmisor.error || !resEmisor.data) {
      return { ok: false, error: "No se encontró el jugador que emite en la base de datos." };
    }
    if (resReceptor.error || !resReceptor.data) {
      return { ok: false, error: "No se encontró el jugador que recibe en la base de datos." };
    }

    const cEmisor = resEmisor.data;
    const cReceptor = resReceptor.data;

    const saldoAntEmisor = redondear(Number(cEmisor.saldo_actual ?? 0));
    const avalEmisor = redondear(Number(cEmisor.aval ?? 0));
    const disponibleEmisor = saldoAntEmisor + avalEmisor;

    // Verificar si el emisor tiene fondos o crédito disponible para transferir
    const esLibre = esSinTope(cEmisor);
    if (!esLibre && monto > disponibleEmisor) {
      return {
        ok: false,
        error: `Saldo insuficiente en el emisor. ${cEmisor.nombre} tiene disponible $${disponibleEmisor.toFixed(
          2
        )} USD (Saldo: $${saldoAntEmisor.toFixed(2)} + Aval: $${avalEmisor.toFixed(2)}) y desea transferir $${monto.toFixed(
          2
        )} USD.`,
      };
    }

    const saldoAntReceptor = redondear(Number(cReceptor.saldo_actual ?? 0));
    const saldoNuevoEmisor = redondear(saldoAntEmisor - monto);
    const saldoNuevoReceptor = redondear(saldoAntReceptor + monto);

    // 2. Actualizar saldo del emisor (débito)
    const { error: errUpdEmisor } = await supabase
      .from("clientes")
      .update({ saldo_actual: saldoNuevoEmisor })
      .eq("id", emisorId);

    if (errUpdEmisor) {
      return { ok: false, error: `Error al debitar saldo del emisor: ${errUpdEmisor.message}` };
    }

    // 3. Actualizar saldo del receptor (crédito)
    const { error: errUpdReceptor } = await supabase
      .from("clientes")
      .update({ saldo_actual: saldoNuevoReceptor })
      .eq("id", receptorId);

    if (errUpdReceptor) {
      // Revertir débito por consistencia
      await supabase.from("clientes").update({ saldo_actual: saldoAntEmisor }).eq("id", emisorId);
      return { ok: false, error: `Error al acreditar saldo al receptor: ${errUpdReceptor.message}` };
    }

    const fechaHoyIso = new Date().toISOString();
    const hoyStr = fechaHoyIso.slice(0, 10);
    const nombreEmisorFinal = cEmisor.seudonimo || cEmisor.nombre || params.emisorNombre;
    const nombreReceptorFinal = cReceptor.seudonimo || cReceptor.nombre || params.receptorNombre;
    const notaCruce =
      params.nota?.trim() ||
      `Cruce de saldo autorizado por capture de mensaje: ${nombreEmisorFinal} traslada $${monto.toFixed(
        2
      )} a favor de ${nombreReceptorFinal} (Operador: ${operador})`;

    let trxId: number | string = `CRUCE-${Date.now()}`;

    // 4. Registrar en transacciones_financieras
    try {
      const { data: trxIns } = await supabase
        .from("transacciones_financieras")
        .insert({
          fecha: fechaHoyIso,
          cliente_origen_id: emisorId,
          cliente_origen_nombre: nombreEmisorFinal,
          cliente_destino_id: receptorId,
          cliente_destino_nombre: nombreReceptorFinal,
          tipo_operacion: "CRUCE_JUGADORES",
          monto,
          monto_usd: monto,
          moneda: "USD",
          tasa_cambio: 1,
          modalidad: "CRUCE ENTRE JUGADORES",
          nota: notaCruce,
          banco_nombre: "CRUCE P2P INTER-CLIENTE",
          referencia: `CRUCE-${Date.now().toString(36).toUpperCase()}`,
        })
        .select("id")
        .maybeSingle();

      if (trxIns && (trxIns as { id?: unknown }).id != null) {
        trxId = (trxIns as { id?: unknown }).id as number;
      }
    } catch {
      /* best-effort si la tabla tiene RLS estricta */
    }

    // 5. Generar Partida y Contrapartida Contable NIIF (Debe === Haber = $monto)
    try {
      const claveAsiento = `CRUCE:${emisorId}:${receptorId}:${Date.now()}`;
      await supabase.rpc("club_registrar_asiento_niif", {
        p_clave: claveAsiento,
        p_fecha: hoyStr,
        p_concepto: `Cruce de Saldo: ${nombreEmisorFinal} (-$${monto}) -> ${nombreReceptorFinal} (+$${monto})`,
        p_moneda_operacion: "USD",
        p_moneda_presentacion: "USD",
        p_tasa_cambio: 1,
        p_usuario: operador,
        p_lineas: [
          {
            cuenta: "2.1.01.001",
            nombre_cuenta: `Cuentas por Pagar a Clientes · Débito ${nombreEmisorFinal}`,
            debe: monto,
            haber: 0,
          },
          {
            cuenta: "2.1.01.001",
            nombre_cuenta: `Cuentas por Pagar a Clientes · Crédito ${nombreReceptorFinal}`,
            debe: 0,
            haber: monto,
          },
        ],
      });
    } catch {
      /* best effort si la RPC no está instalada */
    }

    // 6. Notificación / Bitácora de Auditoría con soporte
    try {
      await supabase.from("notificaciones").insert([
        {
          tipo: "cruce_jugadores",
          titulo: `🔀 Cruce: ${nombreEmisorFinal} ➔ ${nombreReceptorFinal} ($${monto} USD)`,
          mensaje: notaCruce,
          datos: {
            tipo: "CRUCE_JUGADORES",
            emisor_id: emisorId,
            emisor_nombre: nombreEmisorFinal,
            receptor_id: receptorId,
            receptor_nombre: nombreReceptorFinal,
            monto,
            operador,
            grupo_id: grupoId,
            comprobante_imagen: capture,
            fecha: fechaHoyIso,
          },
        },
      ]);
    } catch {
      /* notificaciones opcional */
    }

    // 7. Notificar a la UI para actualización reactiva de saldos
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("actualizar_clientes"));
      window.dispatchEvent(new CustomEvent("actualizar_saldos"));
      window.dispatchEvent(new CustomEvent("actualizar_contabilidad"));
    }

    return {
      ok: true,
      saldoAnteriorEmisor: saldoAntEmisor,
      saldoNuevoEmisor,
      saldoAnteriorReceptor: saldoAntReceptor,
      saldoNuevoReceptor,
      transaccionId: trxId,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Error inesperado al procesar el cruce entre jugadores.",
    };
  }
}
