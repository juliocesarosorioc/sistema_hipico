// Relativa a proposito: este modulo se compila a CommonJS para las pruebas en
// node (pruebas/tsconfig.json) y node no resuelve el alias `@/`. `horseColors`
// es logica pura, asi que sigue siendo seguro importarlo desde un test.
import { getHorseColor } from "../horseColors";

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

/**
 * @deprecated La paleta vive en "@/lib/horseColors" (canónica, compartida por
 * TODOS los módulos). Este shim se mantiene para no romper las llamadas
 * existentes con estilos inline; antes maintainía una 4ª copia de la paleta
 * que difiere de la canónica (6 con texto amarillo, 11 con texto rojo, y los
 * >=14 con módulo 14 en vez del maroon de respaldo).
 */
export function colorDeNumero(n: number | string): string {
  return getHorseColor(n).hex;
}

export function textoDeNumero(n: number | string): string {
  return getHorseColor(n).hexText;
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

/** Carrera en el Ensamblaje (drag local — igual que el legacy: no se persiste
    hasta presionar "Publicar", que la manda a tablas_fijas con estado Abierta). */
export type DraftCarrera = {
  uid: string;
  hipodromo: string;
  carrera: string;
  distancia: string;
  superficie: string;
  premio: string;
  caballos: EjemplarTabla[];
  /** Fecha del evento (ISO YYYY-MM-DD) heredada de la Gaceta IA. */
  fecha?: string | null;
};

export const draftVacio = (): DraftCarrera => ({
  uid: "",
  hipodromo: "",
  carrera: "",
  distancia: "1100",
  superficie: "ARENA",
  premio: "100",
  caballos: [],
  fecha: null,
});

/** Item del carrito de venta flotante (arriba a la derecha). */
export type ItemCarritoVenta = {
  id: string;
  tablaId: string | number;
  hipodromo: string;
  carrera: number | null;
  premio: number;
  moneda?: string | null;
  numero: string;
  nombre: string;
  monto: number;
  /** Cantidad de tablas vendidas (Venta Rápida del modal EJEMPLAR). */
  cantidad?: number;
  /** Grupo de venta cobrado (centralización "Carreras del Día"). */
  grupo?: { id: string | number; nombre: string } | null;
  /** Jugador/Cliente comprador de la Venta Rápida. */
  jugador?: { id: string | number; nombre: string; saldo_actual?: number } | null;
};

/** Acepta coma decimal (misma aNum del legacy). */
export function parseNum(v: unknown): number {
  if (typeof v === "number") return v;
  const s = String(v ?? "").replace(",", ".").trim();
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}