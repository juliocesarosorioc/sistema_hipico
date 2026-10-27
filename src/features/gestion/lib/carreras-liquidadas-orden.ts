export type ItemCarreraLiquidada = {
  id?: string | number;
  fecha?: string;
  carrera: number;
  hipodromo: string;
  pizarra: string;
  totalJugadas?: number;
  jugadas?: number;
  liquidada?: boolean;
  liquidada_at?: string | number | null;
  updated_at?: string | number | null;
  created_at?: string | number | null;
};

export function normalizarHipodromoClave(h: unknown): string {
  return String(h ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_");
}

/**
 * Clave única canónica `${fecha}::${hipodromoNormalizado}::${numeroCarrera}`
 * para deduplicar carreras liquidadas sin permitir jamás duplicados.
 */
export function claveCanonicaCarreraLiquidada(item: {
  fecha?: string | null;
  hipodromo?: string | null;
  carrera: number | string;
}): string {
  const f = String(item.fecha ?? "").trim().slice(0, 10) || "SIN_FECHA";
  const h = normalizarHipodromoClave(item.hipodromo) || "HIPODROMO";
  const c = Number(item.carrera) || 0;
  return `${f}::${h}::${c}`;
}

export function timestampLiquidacionMs(item: Partial<ItemCarreraLiquidada>): number {
  const raw = item.liquidada_at ?? item.updated_at ?? item.created_at;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) {
    const ms = Date.parse(raw.trim());
    if (Number.isFinite(ms)) return ms;
  }
  return 0;
}

/**
 * Deduplica estrictamente por `${fecha}::${hipodromoNormalizado}::${numeroCarrera}`
 * y ordena las carreras liquidadas de la MÁS NUEVA (arriba) a la MÁS VIEJA (abajo)
 * según `liquidada_at` / `updated_at` / `created_at` (y ante empate o ausencia de
 * timestamp, por número de carrera descendente).
 */
export function deduplicarYOrdenarCarrerasLiquidadas(
  items: ItemCarreraLiquidada[]
): ItemCarreraLiquidada[] {
  const mapa = new Map<string, ItemCarreraLiquidada>();

  for (const raw of items) {
    if (!raw) continue;
    if (raw.liquidada === false) continue;
    const num = Number(raw.carrera);
    if (!Number.isFinite(num) || num <= 0) continue;

    const clave = claveCanonicaCarreraLiquidada({
      fecha: raw.fecha,
      hipodromo: raw.hipodromo,
      carrera: num,
    });
    const existente = mapa.get(clave);
    const jugadasNuevas = Math.max(Number(raw.totalJugadas ?? 0), Number(raw.jugadas ?? 0));
    const jugadasPrev = existente
      ? Math.max(Number(existente.totalJugadas ?? 0), Number(existente.jugadas ?? 0))
      : 0;
    const tsNuevo = timestampLiquidacionMs(raw);
    const tsPrev = existente ? timestampLiquidacionMs(existente) : 0;

    const pizarraLim = String(raw.pizarra ?? "").trim();
    const pizarraPrev = String(existente?.pizarra ?? "").trim();
    const elegirPizarra =
      pizarraLim && !["Oficial", "Liquidada", "Cerrada", "—"].includes(pizarraLim)
        ? pizarraLim
        : pizarraPrev || pizarraLim || "Oficial";

    const maxJugadas = Math.max(jugadasNuevas, jugadasPrev);
    const mejorTs = tsNuevo >= tsPrev ? raw : existente!;

    mapa.set(clave, {
      ...existente,
      ...raw,
      carrera: num,
      hipodromo: String(raw.hipodromo || existente?.hipodromo || "HIPÓDROMO").trim(),
      fecha: raw.fecha || existente?.fecha,
      pizarra: elegirPizarra,
      jugadas: maxJugadas,
      totalJugadas: maxJugadas,
      liquidada: true,
      liquidada_at: mejorTs?.liquidada_at ?? raw.liquidada_at ?? existente?.liquidada_at ?? null,
      updated_at: mejorTs?.updated_at ?? raw.updated_at ?? existente?.updated_at ?? null,
      created_at: mejorTs?.created_at ?? raw.created_at ?? existente?.created_at ?? null,
    });
  }

  return [...mapa.values()].sort((a, b) => {
    const fA = String(a.fecha ?? "");
    const fB = String(b.fecha ?? "");
    if (fB !== fA) return fB.localeCompare(fA);
    const hA = normalizarHipodromoClave(a.hipodromo);
    const hB = normalizarHipodromoClave(b.hipodromo);
    if (hA !== hB) return hA.localeCompare(hB, "es");
    return Number(a.carrera) - Number(b.carrera);
  });
}

/**
 * Alias principal usado en componentes y suites de auditoría.
 */
export function ordenarCarrerasLiquidadas(items: ItemCarreraLiquidada[]): ItemCarreraLiquidada[] {
  return deduplicarYOrdenarCarrerasLiquidadas(items);
}

/**
 * Formatea el texto compacto de un ítem de carrera liquidada:
 * `✅ C[Número] · [Hipódromo] | Pizarra: [1°-2°-3°...] | Jugadas: [N]`
 */
export function formatearItemCarreraLiquidada(item: ItemCarreraLiquidada): string {
  const piz = String(item.pizarra || "—")
    .trim()
    .replace(/\s*·\s*/g, "-");
  const total = item.totalJugadas ?? item.jugadas ?? 0;
  return `✅ C${item.carrera} · ${item.hipodromo} | Pizarra: ${piz || "—"} | Jugadas: ${total}`;
}
