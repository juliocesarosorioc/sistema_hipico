import { redondearCentavos } from "@/shared/lib/dinero";

export type TipoMovimientoSaldoSemanal =
  | "DEPOSITO"
  | "RETIRO"
  | "TRANSFERENCIA_SALIDA"
  | "TRANSFERENCIA_ENTRADA"
  | "COBRO_CLIENTE"
  | "PAGO_A_GANADOR";

export function calcularDeltaMovimientoSaldo(
  tipo: TipoMovimientoSaldoSemanal,
  monto: number
): number {
  const importe = redondearCentavos(Math.abs(monto));
  return tipo === "RETIRO" || tipo === "TRANSFERENCIA_SALIDA" || tipo === "PAGO_A_GANADOR"
    ? -importe
    : importe;
}

/** El saldo de la semana inicia en cero; nunca recibe el cierre de otra semana. */
export function calcularSaldoSemana(
  netoJugadas: number,
  devolucionIncentivo: number,
  movimientosCaja: number
): number {
  return redondearCentavos(netoJugadas + devolucionIncentivo + movimientosCaja);
}
