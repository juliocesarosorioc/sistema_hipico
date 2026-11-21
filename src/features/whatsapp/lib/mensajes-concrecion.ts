import { formatearMontoRegional } from "@/shared/lib/dinero";

/** Prefijo visible del número de jugada, siempre en negritas (ej. *1.-*). */
export function prefijoNumeroJugada(numeroJugada?: number | string | null): string {
  const n = Number(numeroJugada);
  if (!Number.isFinite(n) || n <= 0) return "";
  return `*${Math.floor(n)}.-* `;
}

/** Único mensaje público de concreción con monto topado por saldo/pozo. */
export function mensajeJugaronPorSaldoParcial(params: {
  juega: string;
  da: string;
  monto: number;
  saldoDe: string;
  detalle?: string;
  telefonoLimitador?: string | null;
  numeroJugada?: number | string | null;
}): string {
  const saldoDe = String(params.saldoDe || "Jugador").trim();
  const monto = formatearMontoRegional(params.monto);
  const telefono = String(params.telefonoLimitador || "").replace(/\D/g, "");
  const referencia = telefono ? ` @${telefono}` : "";
  return `${prefijoNumeroJugada(params.numeroJugada)}✅ Aquí Jugaron ⚠️Solo ${monto} por pozo de "${saldoDe}${referencia}"`;
}
