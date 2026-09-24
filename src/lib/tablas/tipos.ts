/**
 * Tipos del módulo Tablas Fijas (clon legacy) + constantes OK.
 * Paleta de gualdrapas, nacionalidades y superficies idénticas a js/tablas.js.
 */

export type EjemplarTabla = {
  numero: number | string;
  nombre: string;
  nacionalidad?: string | null;
  valor_ejemplar?: number | string | null;
  retirado?: boolean;
  ganador?: boolean;
  ejemplar_id?: string | number | null;
};

export type TablaGrupo = {
  id?: string | number;
  tabla_id?: string | number;
  grupo_id?: string | number;
  grupo_nombre?: string | null;
  cupos?: number | null;
  max?: number | null;
  cantidad_vendida?: number;
};

export type TablaFijaMonitoreable = {
  id: string | number;
  hipodromo?: string | null;
  hipodromo_id?: string | number | null;
  carrera?: number | null;
  fecha?: string | null;
  estado?: string | null;
  premio_original?: number | null;
  premio_recalculado?: number | null;
  suma_base_tabla?: number | null;
  limite_ventas?: number | null;
  cantidad_vendida?: number | null;
  moneda?: string | null;
  tasa_cambio?: number | null;
  distancia_carrera?: string | null;
  superficie?: string | null;
  retirados_oficiales?: string | null;
  comision_grupo?: number | null;
  grupo_venta?: string | null;
  caballos?: EjemplarTabla[] | null;
  tabla_grupos?: TablaGrupo[] | null;
  cerrada?: boolean;
};

export const SUPERFICIES = ["ARENA", "CESPED", "FANGO", "TAPETA", "OTRA"] as const;

export const OPCIONES_NACIONALIDAD = [
  "VE",
  "USA",
  "BR",
  "AR",
  "CL",
  "MX",
  "PA",
  "PE",
  "CO",
  "EC",
  "UY",
  "OTRA",
] as const;

export const NO_RETIROS = "NO HUBO RETIROS";

/** Paleta de 14 gualdrapas (js/tablas.js L29-44): [fondo, texto]. */
const PALETA_COLORES: Array<[string, string]> = [
  ["#FF0000", "#FFF"],
  ["#FFFFFF", "#000"],
  ["#0000FF", "#FFF"],
  ["#FFFF00", "#000"],
  ["#008000", "#FFF"],
  ["#000000", "#FFFF00"],
  ["#FFA500", "#000"],
  ["#FFC0CB", "#000"],
  ["#40E0D0", "#000"],
  ["#800080", "#FFF"],
  ["#808080", "#FF0000"],
  ["#32CD32", "#000"],
  ["#8B4513", "#FFF"],
  ["#800000", "#FFF"],
];

export function colorDeNumero(n: number | string): string {
  const i = ((Number(n) || 1) - 1) % 14;
  const v = PALETA_COLORES[i < 0 ? 0 : i];
  return v ? v[0] : "#94a3b8";
}

export function textoDeNumero(n: number | string): string {
  const i = ((Number(n) || 1) - 1) % 14;
  const v = PALETA_COLORES[i < 0 ? 0 : i];
  return v ? v[1] : "#000";
}

export const banderas: Record<string, string> = {
  VE: "🇻🇪",
  USA: "🇺🇸",
  BR: "🇧🇷",
  AR: "🇦🇷",
  CL: "🇨🇱",
  MX: "🇲🇽",
  PA: "🇵🇦",
  PE: "🇵🇪",
  CO: "🇨🇴",
  EC: "🇪🇨",
  UY: "🇺🇾",
  OTRA: "🌐",
};

export const FLAG = (nac?: string | null): string => banderas[(nac || "VE").toUpperCase()] ?? "🌐";

/** Formato de dinero con símbolo por moneda (Bs / $). */
export function fmtMoney(n: number | null | undefined, moneda?: string | null): string {
  const num = typeof n === "number" && isFinite(n) ? n : 0;
  const simb = moneda === "VES" ? "Bs " : "$";
  return (
    simb +
    num.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

/** Suma de la tabla SIN retirados (misma regla del legacy). */
export function sumaBase(caballos: EjemplarTabla[] | null | undefined): number {
  return (caballos ?? [])
    .filter((c) => !c.retirado)
    .reduce((a, c) => a + (parseNum(c.valor_ejemplar) || 0), 0);
}

/** Acepta coma decimal (misma aNum del legacy). */
export function parseNum(v: unknown): number {
  if (typeof v === "number") return v;
  const s = String(v ?? "").replace(",", ".").trim();
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}