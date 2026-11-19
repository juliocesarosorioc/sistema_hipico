import { formatearMontoRegional } from "@/shared/lib/dinero";

/** Bot de concreción con saldo parcial (mensaje público exacto de la sala). */
export function mensajeJugaronPorSaldoParcial(params: {
  juega: string;
  da: string;
  monto: number;
  saldoDe: string;
  detalle?: string;
}): string {
  const juega = String(params.juega || "Jugador A").trim().toUpperCase();
  const da = String(params.da || "Jugador B").trim().toUpperCase();
  const saldoDe = String(params.saldoDe || `${juega} o ${da}`).trim().toUpperCase();
  const monto = formatearMontoRegional(params.monto);

  const base =
    `(Check) Aquí Jugaron "${juega}" y "${da}" "${monto}" ` +
    `por saldo de "${saldoDe}"`;
  const detalle = String(params.detalle || "").trim();
  return detalle ? `${base} · ${detalle}` : base;
}
