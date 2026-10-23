export function cn(...clases: Array<string | false | null | undefined>): string {
  return clases.filter(Boolean).join(" ");
}

/** Da formato de moneda local (COP o USD según config legacy). */
export function formatMoney(n: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}
// Agregar al final de: src/shared/lib/utils.ts

/**
 * Redondeo financiero exacto a 2 decimales (evita errores IEEE 754 de coma flotante en JS)
 */
export function monedaExacta(valor: number | string | null | undefined): number {
  const num = Number(valor || 0);
  if (!Number.isFinite(num)) return 0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

/**
 * Calcula comisión exacta en centavos sin pérdida de precisión
 */
export function calcularComisionExacta(montoBruto: number, porcentaje: number): {
  comision: number;
  neto: number;
} {
  const brutoCentavos = Math.round(monedaExacta(montoBruto) * 100);
  const comisionCentavos = Math.round((brutoCentavos * Number(porcentaje || 0)) / 100);
  const netoCentavos = brutoCentavos - comisionCentavos;
  return {
    comision: comisionCentavos / 100,
    neto: netoCentavos / 100,
  };
}