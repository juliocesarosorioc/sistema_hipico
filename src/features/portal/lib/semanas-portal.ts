import {
  cicloSemanalDe,
  rangoSemanaDeGrupo,
  rangoSemanaDesde,
  semanaVigenteDe,
  type CicloSemanal,
} from "@/features/liquidacion/lib/semana";

export type OpcionSemanaPortal = {
  key: string;
  label: string;
  inicio: string;
  fin: string;
  esActual: boolean;
};

/** Formatea YYYY-MM-DD en DD/MM/AAAA */
export function formatoDmy(iso: string): string {
  const parts = String(iso ?? "").slice(0, 10).split("-");
  if (parts.length !== 3) return iso;
  const [y, m, d] = parts;
  return `${d}/${m}/${y}`;
}

/** Formatea YYYY-MM-DD en DD/MM corto */
export function formatoDm(iso: string): string {
  const parts = String(iso ?? "").slice(0, 10).split("-");
  if (parts.length !== 3) return iso;
  const [, m, d] = parts;
  return `${d}/${m}`;
}

/** Suma días a una fecha ISO sin desfase de zona horaria */
function sumarDiasIso(iso: string, dias: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const base = new Date(y, m - 1, d);
  base.setDate(base.getDate() + dias);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;
}

/**
 * Genera el listado de semanas (Semana actual en curso por defecto + semanas anteriores)
 * adaptado al ciclo fiscal del grupo del cliente.
 */
export function generarOpcionesSemanasPortal(
  hoyIso: string,
  grupoConfig?: {
    dia_inicio_semana?: number | null;
    dia_fin_semana?: number | null;
    semana_vigente_inicio?: string | null;
  } | null,
  cantidadSemanas = 12
): {
  semanaActual: OpcionSemanaPortal;
  semanas: OpcionSemanaPortal[];
} {
  const ciclo: CicloSemanal = cicloSemanalDe({
    dia_inicio_semana: grupoConfig?.dia_inicio_semana,
    dia_fin_semana: grupoConfig?.dia_fin_semana,
  });

  const rangoActual = semanaVigenteDe(
    hoyIso,
    ciclo,
    grupoConfig?.semana_vigente_inicio
  );

  const semanaActual: OpcionSemanaPortal = {
    key: `sem-${rangoActual.inicio}`,
    label: `Semana Actual · ${formatoDm(rangoActual.inicio)} al ${formatoDmy(rangoActual.fin)}`,
    inicio: rangoActual.inicio,
    fin: rangoActual.fin,
    esActual: true,
  };

  const semanas: OpcionSemanaPortal[] = [semanaActual];

  let cursorInicio = rangoActual.inicio;
  for (let i = 1; i < cantidadSemanas; i++) {
    // Retroceder 7 días para encontrar el inicio de la semana anterior
    cursorInicio = sumarDiasIso(cursorInicio, -7);
    const rangoAnt = rangoSemanaDesde(cursorInicio, ciclo);
    semanas.push({
      key: `sem-${rangoAnt.inicio}`,
      label: i === 1
        ? `Semana Anterior · ${formatoDm(rangoAnt.inicio)} al ${formatoDmy(rangoAnt.fin)}`
        : `Semana ${formatoDm(rangoAnt.inicio)} al ${formatoDmy(rangoAnt.fin)} (-${i} sem)`,
      inicio: rangoAnt.inicio,
      fin: rangoAnt.fin,
      esActual: false,
    });
  }

  return { semanaActual, semanas };
}

/**
 * Filtra una lista de elementos (jugadas o tickets) por rango de semana [inicio, fin].
 */
export function filtrarPorSemana<T extends { fecha?: string | null; fechaCarrera?: string | null; fecha_carrera?: string | null; fecha_registro?: string | null }>(
  items: T[],
  semana: { inicio: string; fin: string } | null
): T[] {
  if (!semana) return items;
  const { inicio, fin } = semana;
  return items.filter((it) => {
    const f = String(it.fechaCarrera ?? it.fecha_carrera ?? it.fecha ?? it.fecha_registro ?? "").slice(0, 10);
    if (!f) return false;
    return f >= inicio && f <= fin;
  });
}
