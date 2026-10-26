export type ItemCarreraLiquidada = {
  carrera: number;
  hipodromo: string;
  pizarra: string;
  totalJugadas: number;
  liquidada: boolean;
};

/**
 * Ordena las carreras liquidadas en estricto orden numérico ascendente (`1ª, 2ª, 3ª...`).
 */
export function ordenarCarrerasLiquidadas(items: ItemCarreraLiquidada[]): ItemCarreraLiquidada[] {
  return [...items]
    .filter((i) => i && i.liquidada && Number.isFinite(Number(i.carrera)) && Number(i.carrera) > 0)
    .sort((a, b) => Number(a.carrera) - Number(b.carrera));
}

/**
 * Formatea el texto compacto de un ítem de carrera liquidada según especificación:
 * `✅ C[Número] · [Hipódromo] | Pizarra: [1°-2°-3°...] | Jugadas: [N]`
 */
export function formatearItemCarreraLiquidada(item: ItemCarreraLiquidada): string {
  const piz = String(item.pizarra || "—")
    .trim()
    .replace(/\s*·\s*/g, "-");
  return `✅ C${item.carrera} · ${item.hipodromo} | Pizarra: ${piz || "—"} | Jugadas: ${item.totalJugadas}`;
}
