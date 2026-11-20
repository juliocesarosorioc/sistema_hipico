import { supabase } from "@/core/supabase";
import { filtroDiaJornada } from "@/features/liquidacion/lib/fecha";
import {
  grupoActivoVigente,
  grupoVigente,
  veTodosLosGruposVigente,
} from "@/features/seguridad/lib/vigente";
import { esVentaDeRemate } from "@/features/impresion/lib/reportGenerator";

export type TicketCarreraRow = {
  id: string | number;
  nombre_jugada?: string | null;
  caballo?: string | null;
  ejemplar_numero?: number | string | null;
  monto_jugado?: number | string | null;
  premio_pagar?: number | string | null;
  premio_por_tabla?: number | string | null;
  pts_ejemplar?: number | string | null;
  comision_porcentaje?: number | string | null;
  comision_pagada?: number | string | null;
  estado?: string | null;
  anulada?: boolean | null;
  anulada_at?: string | null;
  anulada_motivo?: string | null;
  cliente_juega_id?: string | number | null;
  cliente_juega_nombre?: string | null;
  cliente_consigue_id?: string | number | null;
  cliente_consigue_nombre?: string | null;
  nota_auditoria?: unknown;
  es_adelantada?: boolean | null;
  fecha_carrera?: string | null;
  fecha_registro?: string | null;
  hipodromo?: string | null;
  carrera?: number | string | null;
  grupo_cobro_id?: string | number | null;
  moneda?: string | null;
};

function grupoCobroActivo(): string {
  return String(
    (veTodosLosGruposVigente()
      ? grupoActivoVigente() || grupoVigente()
      : grupoVigente() || grupoActivoVigente()) ?? ""
  ).trim();
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function normalizarHipodromoCarrera(hipodromo: unknown): string {
  return String(hipodromo ?? "").trim().toUpperCase();
}

export type FiltroTicketsCarrera = {
  fecha: string;
  hipodromo: string;
  carrera: number | string;
  grupoId?: string | null;
  /** Si se omite, se resuelve el grupo activo vigente (igual que reportGenerator). */
  resolverGrupo?: boolean;
};

/**
 * Carga los tickets vigentes de una carrera desde `tickets_apuestas` (misma
 * fuente que la Relación/Reporte). Incluye jugadas concretadas/sincronizadas
 * desde Sala siempre que tengan fecha/hipódromo/carrera/grupo compatibles.
 */
export async function cargarTicketsDeCarreraBD(
  filtro: FiltroTicketsCarrera
): Promise<TicketCarreraRow[]> {
  const sb = supabase;
  if (!sb) return [];
  const hip = normalizarHipodromoCarrera(filtro.hipodromo);
  const car = num(filtro.carrera);
  const fecha = String(filtro.fecha ?? "").slice(0, 10);
  if (!hip || !car) return [];

  const activo = String(
    filtro.grupoId ?? (filtro.resolverGrupo === false ? "" : grupoCobroActivo())
  ).trim();

  const colsExtendidas =
    "id, nombre_jugada, caballo, ejemplar_numero, monto_jugado, premio_pagar, premio_por_tabla, pts_ejemplar, comision_porcentaje, comision_pagada, estado, anulada, cliente_juega_id, cliente_juega_nombre, cliente_consigue_id, cliente_consigue_nombre, nota_auditoria, es_adelantada, fecha_carrera, fecha_registro, hipodromo, carrera, grupo_cobro_id, moneda";
  const colsBase =
    "id, nombre_jugada, caballo, ejemplar_numero, monto_jugado, premio_pagar, premio_por_tabla, comision_porcentaje, estado, anulada, cliente_juega_nombre, cliente_consigue_nombre, nota_auditoria, es_adelantada, fecha_carrera, fecha_registro, hipodromo, carrera, grupo_cobro_id";

  const consultar = (cols: string) => {
    let q = sb
      .from("tickets_apuestas")
      .select(cols)
      .ilike("hipodromo", `%${hip}%`)
      .eq("carrera", car)
      .order("fecha_registro", { ascending: true });
    if (/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      q = q.or(filtroDiaJornada(fecha));
    }
    if (activo) {
      q = q.eq("grupo_cobro_id", activo);
    }
    return q;
  };

  try {
    let { data, error } = await consultar(colsExtendidas);
    if (error) {
      const r2 = await consultar(colsBase);
      data = r2.data;
      error = r2.error;
    }
    if (error) throw error;

    const filas = ((data ?? []) as unknown as Array<Record<string, unknown>>).filter((rec) => {
      const anuladaAdmin =
        rec.anulada === true || Boolean(rec.anulada_at) || Boolean(rec.anulada_motivo);
      if (anuladaAdmin) return false;
      if (esVentaDeRemate(rec.nombre_jugada)) return false;
      return true;
    });

    const vistos = new Set<string>();
    const unicas: TicketCarreraRow[] = [];
    for (const r of filas) {
      const id = String(r.id ?? "").trim();
      if (id && vistos.has(id)) continue;
      if (id) vistos.add(id);
      unicas.push(r as unknown as TicketCarreraRow);
    }
    return unicas;
  } catch {
    return [];
  }
}

/** Dedupe/merge por id estable de `tickets_apuestas`. */
export function dedupeTicketsPorId<T extends { id?: string | number | null }>(items: T[]): T[] {
  const vistos = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const id = String(it?.id ?? "").trim();
    if (!id) {
      out.push(it);
      continue;
    }
    if (vistos.has(id)) continue;
    vistos.add(id);
    out.push(it);
  }
  return out;
}

export function ticketPerteneceACarrera(
  row: TicketCarreraRow,
  filtro: { fecha: string; hipodromo: string; carrera: number | string }
): boolean {
  const hip = normalizarHipodromoCarrera(filtro.hipodromo);
  const car = num(filtro.carrera);
  const fecha = String(filtro.fecha ?? "").slice(0, 10);
  if (!hip || !car) return false;
  const rowHip = normalizarHipodromoCarrera(row.hipodromo);
  if (rowHip !== hip && !rowHip.includes(hip) && !hip.includes(rowHip)) return false;
  if (num(row.carrera) !== car) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    const fc = String(row.fecha_carrera ?? "").slice(0, 10);
    const fr = String(row.fecha_registro ?? "").slice(0, 10);
    if (fc !== fecha && fr !== fecha) return false;
  }
  return true;
}
