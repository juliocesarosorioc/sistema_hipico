/**
 * IMPRESIÓN DE LA MATRIZ DE TABLAS FIJAS PUBLICADAS
 * -------------------------------------------------
 * Replica 1:1 del legacy `monitor_tablas_imprimir.html` sobre la SPA:
 *  · Tarjeta = CARRERA COMPLETA (hipódromo, C#, DIST/superficie/fecha,
 *    ejemplares con gualdrapa, nombre, valor + montos jugados, pie Σ SUMA y
 *    PREMIO/TABLA, badge ⚠ SIN APUESTAS).
 *  · 15 tarjetas por hoja, 3 filas × 5 columnas, encajadas en una sola página
 *    A4 portrait: los nombres se leen claros (auto-letra fsAuto) y los números
 *    van SIEMPRE dentro de su chip, centrados vertical y horizontalmente, sin
 *    márgenes internos.
 *  · Datos REALES: tablas_fijas (estado Abierta) + montos jugados de
 *    tickets_apuestas, con RLS tolerante (fallback cache/fuente local).
 */
import { supabase } from "@/lib/supabase";
import { normalizarFilas } from "@/lib/tablas/rpc";
import type { EjemplarTabla } from "@/lib/tablas/tipos";
import { parseNum } from "@/lib/tablas/tipos";
import { esc, fsAuto, col, monSinSimb, fmt, monCode, fmtFecha, hoy, hipoKey, diaDe, MAX_N, type Orientacion, DIM_PAGINA } from "@/lib/impresion/util";
import { normalizarNacionalidad } from "@/components/ui/BanderaPais";

export type EjemplarImpresion = {
  numero: string;
  nombre: string;
  retirado: boolean;
  valor_ejemplar: number;
  jugado: number;
  nacionalidad?: string | null;
};

export type TablaImpresion = {
  id: string | number;
  hipodromo: string;
  carrera: string;
  fecha: string;
  distancia: string;
  superficie: string;
  premio: number;
  moneda: string;
  ejemplares: EjemplarImpresion[];
};

export type MatrizImpresion = {
  carreras: TablaImpresion[];
  /** "reales" = tablas_fijas (BD); "local" = respaldo del store (sin BD). */
  fuente: "reales" | "local";
  error?: string;
};

/** Bandera SVG inline (sin red) para el HTML impreso, espejo de `Flag`. */
function rectSvg(x: number, y: number, w: number, h: number, fill: string): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
}
function estSvg(cx: number, cy: number, r: number, fill: string): string {
  const s = r;
  const p =
    `M ${cx} ${cy - s} ` +
    `L ${cx + s * 0.224} ${cy - s * 0.309} ` +
    `L ${cx + s} ${cy - s * 0.309} ` +
    `L ${cx + s * 0.363} ${cy + s * 0.118} ` +
    `L ${cx + s * 0.5} ${cy + s} ` +
    `L ${cx} ${cy + s * 0.382} ` +
    `L ${cx - s * 0.5} ${cy + s} ` +
    `L ${cx - s * 0.363} ${cy + s * 0.118} ` +
    `L ${cx - s} ${cy - s * 0.309} ` +
    `L ${cx - s * 0.224} ${cy - s * 0.309} Z`;
  return `<path d="${p}" fill="${fill}" stroke="none"/>`;
}
const ARCO_BANDERAS: Record<string, string> = {
  VE:
    rectSvg(0, 0, 24, 5.33, "#FCD116") +
    rectSvg(0, 5.33, 24, 5.33, "#003893") +
    rectSvg(0, 10.67, 24, 5.33, "#CE1126") +
    [3, 5, 7, 9, 11, 13, 15, 17].map((x) => estSvg(x, 8, 0.95, "#FFF")).join(""),
  USA:
    rectSvg(0, 0, 24, 16, "#B22234") +
    [0, 2, 4, 6, 8, 10, 12].map((y) => rectSvg(0, y, 24, 1.3, "#FFF")).join("") +
    rectSvg(0, 0, 10.6, 8, "#3C3B6E") +
    [1.1, 2.75, 4.4, 6.05]
      .map((y, row) =>
        [1.06, 2.65, 4.24, 5.83, 7.42]
          .map((x, col) => estSvg(col % 2 === 0 ? x : x + 0.8, y, 0.34, "#FFF"))
          .join("")
      )
      .join(""),
  BR:
    rectSvg(0, 0, 24, 16, "#009739") +
    '<path d="M 12 1.5 L 24 8 L 12 14.5 L 0 8 Z" fill="#FEDD00"/>' +
    '<circle cx="12" cy="8" r="4.4" fill="#012169"/>' +
    '<path d="M 12 5.05 L 13.55 7.13 L 16.2 7.7 L 14.4 9.6 L 14.85 12.3 L 12 10.85 L 9.15 12.3 L 9.6 9.6 L 7.8 7.7 L 10.45 7.13 Z" fill="#FFF"/>',
  AR:
    rectSvg(0, 0, 24, 5.33, "#74ACDF") +
    rectSvg(0, 5.33, 24, 5.33, "#FFF") +
    rectSvg(0, 10.67, 24, 5.33, "#74ACDF") +
    '<circle cx="12" cy="8" r="2.4" fill="#F6B40E"/>' +
    '<circle cx="12" cy="8" r="1.1" fill="#85340A"/>' +
    Array.from({ length: 14 })
      .map((_, i) => {
        const a = (i / 14) * Math.PI * 2;
        return `<line x1="${12 + Math.cos(a) * 1.1}" y1="${8 + Math.sin(a) * 1.1}" x2="${12 + Math.cos(a) * 2.3}" y2="${8 + Math.sin(a) * 2.3}" stroke="#F6B40E" stroke-width="0.5"/>`;
      })
      .join(""),
  CL:
    rectSvg(0, 0, 24, 5.33, "#FFF") +
    rectSvg(0, 0, 10, 6.4, "#0039A6") +
    estSvg(5, 3.2, 1.8, "#FFF") +
    rectSvg(0, 6.4, 24, 9.6, "#D52B1E"),
  MX:
    rectSvg(0, 0, 8, 16, "#006847") +
    rectSvg(8, 0, 8, 16, "#FFF") +
    rectSvg(16, 0, 8, 16, "#CE1126") +
    '<circle cx="12" cy="9" r="2.2" fill="#9B6A3C"/><circle cx="12" cy="7" r="0.8" fill="#5A3A1E"/>',
  PA:
    rectSvg(0, 0, 24, 16, "#FFF") +
    rectSvg(0, 0, 12, 8, "#005293") +
    rectSvg(12, 8, 12, 8, "#D21034") +
    estSvg(6, 4, 1.7, "#FFF") +
    estSvg(18, 12, 1.7, "#D21034"),
  PE:
    rectSvg(0, 0, 8, 16, "#D91023") +
    rectSvg(8, 0, 8, 16, "#FFF") +
    rectSvg(16, 0, 8, 16, "#D91023"),
  CO:
    rectSvg(0, 0, 24, 8, "#FCD116") +
    rectSvg(0, 8, 12, 8, "#003893") +
    rectSvg(12, 8, 12, 8, "#CE1126"),
  EC:
    rectSvg(0, 0, 24, 8, "#FFDD00") +
    rectSvg(0, 8, 12, 8, "#003893") +
    rectSvg(12, 8, 12, 8, "#EF3340") +
    '<circle cx="12" cy="7.4" r="2.6" fill="#603813"/><circle cx="12" cy="7.4" r="1.4" fill="#C9A063"/>',
  UY:
    [0, 1, 2, 3, 4].map((i) => rectSvg(0, i * 3.2, 24, 1.6, "#FFF")).join("") +
    [1, 2, 3, 4].map((i) => rectSvg(0, i * 3.2 + 1.6, 24, 1.6, "#0038A8")).join("") +
    rectSvg(0, 0, 9.2, 8, "#FFF") +
    '<circle cx="4.6" cy="3.8" r="2.2" fill="#F6B40E"/><circle cx="4.6" cy="3.8" r="1" fill="#7A4B0C"/>',
  OTRA: rectSvg(0, 0, 24, 16, "#64748b") + '<circle cx="12" cy="8" r="3" fill="#FFF"/>',
};

function banderaHtml(nac?: string | null, size = 12): string {
  const iso = normalizarNacionalidad(nac);
  const node = ARCO_BANDERAS[iso] ?? ARCO_BANDERAS.OTRA;
  const h = Math.round((size * 2 * 10) / 3) / 10;
  return (
    '<svg width="' +
    size +
    '" height="' +
    h +
    '" viewBox="0 0 24 16" style="display:inline-block;vertical-align:-1px;border-radius:2px;box-shadow:0 0 0 1px rgba(0,0,0,.15)">' +
    node +
    "</svg>"
  );
}

/** Hipódromo de pista americana (misma detección que el resto de la app). */
function esHipoAmericano(hipodromo: string): boolean {
  return /PARK|DOWNS|AQUEDUCT|SARATOGA|TAMPA|MEADOWS|WOODBINE|GOLDEN|SANTA ANITA|DEL MAR|OAKLAWN/i.test(
    hipodromo
  );
}

/** Fila mínima de respaldo (el Monitor ya las tiene cargadas del store). */
export type TablaRespaldo = {
  id?: string | number;
  hipodromo?: string | null;
  carrera?: number | string | null;
  fecha?: string | null;
  fecha_creacion?: string | null;
  premio_recalculado?: number | null;
  suma_base_tabla?: number | null;
  moneda?: string | null;
  distancia_carrera?: string | null;
  superficie?: string | null;
  caballos?: EjemplarTabla[] | null;
};

const unDiaDe = (f: { fecha?: string | null; fecha_creacion?: string | null }): string => diaDe(f.fecha, f.fecha_creacion);

/** Clave hipódromo|carrera para amarrar montos jugados. */
function claveHipoCarrera(h?: string | null, c?: number | string | null): string {
  return `${hipoKey(h)}|${String(c ?? "")}`;
}

function aTablaImpresion(r: TablaRespaldo, montos: Map<string, number>): TablaImpresion {
  const ejemplares = (r.caballos ?? [])
    .map((c) => ({
      numero: String(c.numero ?? ""),
      nombre: String(c.nombre ?? "").trim(),
      retirado: !!c.retirado,
      valor_ejemplar: parseNum(c.valor_ejemplar),
      jugado: montos.get(`${claveHipoCarrera(r.hipodromo, r.carrera)}|${String(c.numero)}`) || 0,
      nacionalidad: c.nacionalidad ?? null,
    }))
    .sort((a, b) => (parseInt(a.numero, 10) || 0) - (parseInt(b.numero, 10) || 0));
  return {
    id: r.id ?? "",
    hipodromo: String(r.hipodromo ?? "").trim().toUpperCase() || "—",
    carrera: String(r.carrera ?? ""),
    fecha: String(r.fecha || r.fecha_creacion || ""),
    distancia: r.distancia_carrera ? String(r.distancia_carrera) : "",
    superficie: String(r.superficie ?? "").toUpperCase() || "ARENA",
    premio: parseNum(r.premio_recalculado),
    moneda: r.moneda || "USD",
    ejemplares,
  };
}

/**
 * Lee las Tablas Fijas publicadas (Abierta) desde la BD con RLS tolerante:
 *  1) RPC del legacy `club_listar_tablas_fijas_publicadas`
 *  2) SELECT plano `estado ilike 'abierta'`
 *  3) respaldo del store (fuente "local").
 * Cruza además los montos jugados (tickets_apuestas) por
 * hipódromo|carrera|número para el badge ⚠ SIN APUESTAS.
 * `filtros` restringe el SELECT (y los montos) en la BD para que el modal de
 * impresión no traiga toda la data sin filtrar (evita el cuelgue).
 */
export async function cargarMatrizImpresion(
  respaldo?: TablaRespaldo[],
  filtros?: { dia?: string; hipodromo?: string }
): Promise<MatrizImpresion> {
  const dia = filtros?.dia || "";
  const hipoRaw = filtros?.hipodromo ? String(filtros.hipodromo) : "";
  const hipo = hipoKey(hipoRaw);
  let filas: TablaRespaldo[] = [];
  let error: string | undefined;

  // La RPC `club_listar_tablas_fijas_publicadas` es SECURITY DEFINER (pasa por
  // alto la RLS) y devuelve TODAS las publicadas en 'Abierta'. Se usa SIEMPRE
  // (también con filtros): el SELECT directo queda LOQUEADO por RLS → vacío sin
  // error, que era la causa del modal sin datos. El filtrado día/hipódromo se
  // aplica luego en memoria sobre el resultado real.
  if (supabase) {
    try {
      const rpc = await supabase.rpc("club_listar_tablas_fijas_publicadas");
      if (!rpc.error && Array.isArray(rpc.data)) filas = normalizarFilas(rpc.data);
      else error = rpc.error?.message;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    if (filas.length === 0) {
      try {
        let sel = supabase
          .from("tablas_fijas")
          .select("id,hipodromo,carrera,fecha,fecha_creacion,estado,premio_recalculado,suma_base_tabla,moneda,distancia_carrera,superficie,caballos")
          .ilike("estado", "abierta");
        if (hipoRaw) sel = sel.ilike("hipodromo", hipoRaw);
        const r = await sel;
        if (!r.error) filas = (r.data ?? []) as TablaRespaldo[];
        else error = r.error.message;
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
    }
  } else {
    error = "Sin conexión a Supabase";
  }

  if (filas.length === 0 && respaldo && respaldo.length > 0) filas = respaldo;

  const montos = new Map<string, number>();
  if (supabase) {
    try {
      let q = supabase.from("tickets_apuestas").select("hipodromo,carrera,ejemplar_numero,monto_jugado");
      if (hipoRaw) q = q.ilike("hipodromo", hipoRaw);
      const { data, error: eM } = await q;
      if (!eM) {
        for (const t of (data ?? []) as Array<{ hipodromo?: unknown; carrera?: unknown; ejemplar_numero?: unknown; monto_jugado?: unknown }>) {
          const k = `${claveHipoCarrera(String(t.hipodromo ?? ""), String(t.carrera ?? ""))}|${String(t.ejemplar_numero ?? "")}`;
          montos.set(k, (montos.get(k) || 0) + parseNum(t.monto_jugado));
        }
      }
    } catch {
      /* sin montos → badge solo por negativos */
    }
  }

  const carreras = filas
    .map((f) => aTablaImpresion(f, montos))
    .filter((c) => {
      if (dia && String(c.fecha).slice(0, 10) !== dia) return false;
      if (hipo && hipoKey(c.hipodromo) !== hipo) return false;
      return true;
    })
    .sort(
      (a, b) =>
        String(a.fecha).localeCompare(String(b.fecha)) ||
        a.hipodromo.localeCompare(b.hipodromo, "es") ||
        (parseInt(a.carrera, 10) || 0) - (parseInt(b.carrera, 10) || 0)
    );

  return { carreras, fuente: filas.length ? "reales" : "local", error };
}

/** Carrera mínima del resumen (sólo metadatos, sin caballos ni montos). */
export type ResumenCarrera = {
  id: string | number;
  hipodromo: string;
  carrera: string;
  fecha: string;
  hipoId?: string | number | null;
};

/**
 * Resumen LIGERO para el "modal previo" de impresión: SELECT de sólo
 * metadatos (id/histódromo/carrera/fecha) sobre tablas_fijas Abierta.
 * Rápido aunque haya miles de tablas: no arrastra caballos ni tickets.
 * Al pulsar "Generar / Imprimir" se hace la carga pesada YA filtrada.
 */
export async function cargarResumenImpresion(): Promise<{
  carreras: ResumenCarrera[];
  fuente: "reales" | "local";
  error?: string;
}> {
  let filas: TablaRespaldo[] = [];
  let error: string | undefined;
  // Misma regla que la carga pesada: la RPC SECURITY DEFINER pasa la RLS; el
  // SELECT directo queda LOQUEADO (vacío sin error) por las políticas del club.
  if (supabase) {
    try {
      const rpc = await supabase.rpc("club_listar_tablas_fijas_publicadas");
      if (!rpc.error && Array.isArray(rpc.data)) filas = normalizarFilas(rpc.data);
      else error = rpc.error?.message;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    if (filas.length === 0) {
      try {
        const { data, error: e } = await supabase
          .from("tablas_fijas")
          .select("id,hipodromo,carrera,fecha,fecha_creacion,hipodromo_id")
          .ilike("estado", "abierta");
        if (e) error = e.message;
        else filas = (data ?? []) as unknown as TablaRespaldo[];
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
    }
  } else {
    error = "Sin conexión a Supabase";
  }
  const carreras: ResumenCarrera[] = filas
    .map((r) => {
      const raw = r as unknown as Record<string, unknown>;
      return {
        id: String(r.id ?? ""),
        hipodromo: String(r.hipodromo ?? "").trim().toUpperCase() || "—",
        carrera: String(r.carrera ?? ""),
        fecha: String(r.fecha || r.fecha_creacion || ""),
        hipoId: raw.hipodromo_id != null ? (raw.hipodromo_id as string | number) : null,
      };
    })
    .sort(
      (a, b) =>
        String(a.fecha).localeCompare(String(b.fecha)) ||
        a.hipodromo.localeCompare(b.hipodromo, "es") ||
        (parseInt(a.carrera, 10) || 0) - (parseInt(b.carrera, 10) || 0)
    );
  return { carreras, fuente: carreras.length ? "reales" : "local", error };
}

/* ─────────────────────────── FILTROS BIDIRECCIONALES ─────────────────────────── */

export type OpcionesFiltro = {
  dias: string[];
  hipodromos: string[];
  diasDelHipodromo: (hipo: string) => string[];
  hipodromosDelDia: (dia: string) => string[];
};

export function opcionesFiltro(carreras: TablaImpresion[]): OpcionesFiltro {
  const diasPorHipo = new Map<string, Set<string>>();
  const hiposPorDia = new Map<string, Set<string>>();
  for (const c of carreras) {
    const d = unDiaDe(c);
    const h = hipoKey(c.hipodromo);
    if (!h || !d) continue;
    if (!diasPorHipo.has(h)) diasPorHipo.set(h, new Set());
    if (!hiposPorDia.has(d)) hiposPorDia.set(d, new Set());
    diasPorHipo.get(h)!.add(d);
    hiposPorDia.get(d)!.add(h);
  }
  const todosDias = Array.from(hiposPorDia.keys()).sort().reverse();
  const todosHipos = Array.from(diasPorHipo.keys()).sort((a, b) => a.localeCompare(b, "es"));
  return {
    dias: todosDias,
    hipodromos: todosHipos,
    diasDelHipodromo: (hipo) => Array.from(diasPorHipo.get(hipoKey(hipo)) ?? new Set<string>()).sort().reverse(),
    hipodromosDelDia: (dia) => Array.from(hiposPorDia.get(dia ?? "") ?? new Set<string>()).sort((a, b) => a.localeCompare(b, "es")),
  };
}

export function filtrarMatriz(
  carreras: TablaImpresion[],
  filtros: { dia?: string; hipodromo?: string }
): TablaImpresion[] {
  const d = filtros.dia || "";
  const h = hipoKey(filtros.hipodromo);
  return carreras.filter((c) => {
    if (d && unDiaDe(c) !== d) return false;
    if (h && hipoKey(c.hipodromo) !== h) return false;
    return true;
  });
}

/* ─────────────────────────── HTML DE PÁGINAS A4 (5×3) ─────────────────────────── */

export const MATRIZ_CSS = `
.impe-root{font-family:system-ui,Arial,sans-serif;color:#0f172a;}
.im-pagina{box-sizing:border-box;width:1240px;height:1754px;display:flex;flex-direction:column;
  background:#fff;padding:10px 10px 14px;overflow:hidden;}
.im-ph{display:flex;align-items:center;justify-content:space-between;gap:8px;
  font-size:13px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:.4px;padding:0 4px 8px;}
.im-ph b{color:#0f172a;font-size:15px;}
.im-hoja{flex:1;min-height:0;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));grid-template-rows:repeat(3,1fr);grid-auto-flow:row;grid-auto-rows:1fr;gap:9px;}
.im-tarjeta{background:#fff;border:1px solid #cbd5e1;border-radius:10px;overflow:hidden;
  display:flex;flex-direction:column;min-width:0;min-height:0;position:relative;box-shadow:0 1px 2px rgba(0,0,0,.04);}
.im-enc{background:#0f172a;color:#fff;padding:6px 8px;flex:none;}
.im-l1{display:flex;align-items:center;gap:6px;justify-content:space-between;}
.im-hip{font-size:15px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1;}
.im-cc{background:rgba(255,255,255,.16);border-radius:6px;font-size:16px;font-weight:900;padding:1px 7px;white-space:nowrap;flex:none;}
.im-l2{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:1.5px;font-size:12px;font-weight:700;color:#cbd5e1;}
.im-meta{display:flex;align-items:center;gap:4px;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}
.im-moneda-leg{flex:none;border-radius:5px;background:rgba(255,255,255,.18);padding:0 5px;font-weight:900;color:#fde68a;letter-spacing:.4px;}
.im-fecha{margin-left:auto;white-space:nowrap;font-weight:800;color:#7dd3fc;}
.im-filas{flex:1;display:flex;flex-direction:column;justify-content:space-evenly;gap:1px;
  padding:3px 6px;min-height:0;overflow:hidden;font-size:10px;}
.im-fila{display:flex;align-items:center;gap:4px;line-height:1;min-height:0;border-radius:3px;}
.im-fila:nth-child(odd){background:#eef2f7;}
.im-num{flex:none;width:1.55em;height:1.55em;border-radius:5px;margin:0;padding:0;
  display:flex;align-items:center;justify-content:center;
  font-weight:900;font-size:0.98em;line-height:1;overflow:hidden;text-align:center;
  box-sizing:border-box;}
.im-nom{flex:1;min-width:0;font-weight:700;color:#334155;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:5px;}
.im-band{flex:none;display:inline-flex;margin-left:2px;}
.im-nom.ret{color:#dc2626;text-decoration:line-through;}
.im-nom.ret b{text-decoration:line-through;}
.im-mon{font-weight:800;color:#475569;white-space:nowrap;font-size:0.95em;flex:none;}
.im-mon.cero{color:#94a3b8;}
.im-badge{position:absolute;top:5px;right:5px;z-index:3;padding:2px 7px;
  border:2px solid #fecaca;border-radius:6px;background:#fee2e2;color:#b91c1c;
  font-size:8px;font-weight:900;letter-spacing:.5px;white-space:nowrap;
  box-shadow:0 1px 2px rgba(0,0,0,.15);}
.im-pie{display:flex;justify-content:space-between;align-items:center;gap:6px;flex:none;
  border-top:1.5px solid #94a3b8;background:#f1f5f9;padding:5px 8px;
  font-size:10px;font-weight:700;color:#475569;white-space:nowrap;
  position:relative;z-index:2;}
.im-pie b{color:#047857;font-size:17px;}
.im-normas{font-size:9px;color:#64748b;line-height:1.5;text-align:center;
  padding:10px 4px 0;flex:none;font-weight:600;}
@media print{
  @page{size:A4 portrait;margin:3mm;}
  body *{visibility:hidden;}
  .impe-root,.impe-root *{visibility:visible;}
  .impe-root{position:absolute !important;left:0 !important;top:0 !important;width:100% !important;max-width:none !important;}
  .im-pagina{width:204mm;height:288mm;padding:2mm;break-after:page;border:none;border-radius:0;}
  .im-or-h .im-pagina{width:288mm;height:204mm;}
  .im-hoja{grid-template-columns:repeat(5,minmax(0,1fr));grid-template-rows:repeat(3,1fr);gap:2.2mm;}
  .im-tarjeta{break-inside:avoid;border-radius:4px;}
}
`;

function tarjetaHTML(t: TablaImpresion): string {
  const n = t.ejemplares.length || 1;
  const fs = fsAuto(t.ejemplares.length || 1);
  const jugadoTotal = t.ejemplares.reduce((a, e) => a + e.jugado, 0);
  const hipoAmericano = esHipoAmericano(t.hipodromo);
  const casa = hipoAmericano ? "USA" : "VE";
  const tamBand = Math.round(Math.max(8, Math.min(13, fs)));
  const filas = t.ejemplares
    .map((e) => {
      const c = col(e.numero);
      const val = e.valor_ejemplar;
      const nac = e.nacionalidad && String(e.nacionalidad).trim() ? normalizarNacionalidad(e.nacionalidad) : casa;
      const bandera = nac !== casa ? banderaHtml(nac, tamBand) : "";
      return (
        '<div class="im-fila"><span class="im-num" style="background:' +
        c.bg +
        ";color:" +
        c.fg +
        '">' +
        esc(e.numero) +
        '</span><span class="im-nom' +
        (e.retirado ? " ret" : "") +
        '" title="' +
        esc(e.nombre) +
        '">' +
        esc(e.nombre) +
        (bandera ? '<span class="im-band">' + bandera + "</span>" : "") +
        '</span><span class="im-mon' +
        (val === 0 ? " cero" : "") +
        '">' +
        (val === 0 ? "–" : monSinSimb(val)) +
        "</span></div>"
      );
    })
    .join("");
  return (
    '<div class="im-tarjeta">' +
    '<div class="im-enc">' +
    '<div class="im-l1"><span class="im-hip" title="' +
    esc(t.hipodromo) +
    '">' +
    esc(t.hipodromo) +
    '</span><span class="im-cc">C' +
    esc(t.carrera) +
    '</span></div>' +
    '<div class="im-l2"><span class="im-meta"><b>DIST ' +
    esc(t.distancia) +
    " m</b> &middot; " +
    esc(t.superficie) +
    '</span><span class="im-moneda-leg">' +
    monCode(t.moneda) +
    '</span><span class="im-fecha">' +
    fmtFecha(t.fecha) +
    "</span></div>" +
    "</div>" +
    (jugadoTotal === 0 ? '<div class="im-badge">&#9888; SIN APUESTAS</div>' : "") +
    '<div class="im-filas" style="font-size:' +
    fs +
    'px">' +
    (t.ejemplares.length === 0
      ? '<div style="color:#dc2626;font-weight:800;text-align:center;font-size:' +
        fs +
        'px">SIN APUESTAS</div>'
      : filas) +
    "</div>" +
    '<div class="im-pie"><span>PREMIO/TABLA</span><b>' +
    monSinSimb(t.premio) +
    "</b></div>" +
    "</div>"
  );
}

/** Construye las páginas A4 (15 tarjetas = 3×5 por página). */
export function paginasMatrizHTML(carreras: TablaImpresion[], orientacion: Orientacion = "vertical"): string {
  if (carreras.length === 0) return "";
  const dim = DIM_PAGINA[orientacion];
  const nPaginas = Math.max(1, Math.ceil(carreras.length / 15));
  let h = "";
  for (let p = 0; p < nPaginas; p++) {
    const chunk = carreras.slice(p * 15, p * 15 + 15);
    h +=
      '<div class="im-pagina" style="width:' +
      dim.w +
      "px;height:" +
      dim.h +
      'px">' +
      '<div class="im-ph"><span><b>TABLAS FIJAS PUBLICADAS</b></span><span>Página ' +
      (p + 1) +
      " de " +
      nPaginas +
      " &middot; " +
      hoy() +
      "</span></div>" +
      '<div class="im-hoja">' +
      chunk.map(tarjetaHTML).join("") +
      "</div>" +
      '<div class="im-normas">NORMAS TABLAS FIJAS: tabla válida solo para la carrera y el ejemplar indicados. ' +
      "El premio corresponde al valor publicado y vigente al momento del cobro. Presente este tablero en caja junto a su documento de identidad. " +
      "En caso de retiro o empate el pago se ajusta según el reglamento del hipódromo. " +
      "Cualquier alteración invalida la tabla.</div>" +
      "</div>";
  }
  return h;
}

/** Devuelve la máxima cantidad de ejemplares visibles (utilidad para el aviso). */
export function totalEjemplares(carreras: TablaImpresion[]): number {
  return carreras.reduce((a, c) => a + c.ejemplares.length, 0);
}

/** Número de celdas libres en la última página (para alinear la grilla). */
export const CELDAS_POR_PAGINA = 15;
export { MAX_N };