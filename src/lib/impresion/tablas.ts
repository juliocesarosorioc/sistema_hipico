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
import { esc, fsAuto, col, mon, fmt, fmtFecha, hoy, hipoKey, diaDe, MAX_N } from "@/lib/impresion/util";

export type EjemplarImpresion = {
  numero: string;
  nombre: string;
  retirado: boolean;
  valor_ejemplar: number;
  jugado: number;
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
 */
export async function cargarMatrizImpresion(respaldo?: TablaRespaldo[]): Promise<MatrizImpresion> {
  let filas: TablaRespaldo[] = [];
  let error: string | undefined;

  if (supabase) {
    try {
      const rpc = await supabase.rpc("club_listar_tablas_fijas_publicadas");
      if (!rpc.error && Array.isArray(rpc.data)) filas = normalizarFilas(rpc.data);
    } catch {
      /* caer al SELECT */
    }
    if (filas.length === 0) {
      try {
        const sel = await supabase
          .from("tablas_fijas")
          .select("id,hipodromo,carrera,fecha,fecha_creacion,estado,premio_recalculado,suma_base_tabla,moneda,distancia_carrera,superficie,caballos")
          .ilike("estado", "abierta");
        if (!sel.error) filas = (sel.data ?? []) as TablaRespaldo[];
        else error = sel.error.message;
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
      const { data, error: eM } = await supabase
        .from("tickets_apuestas")
        .select("hipodromo,carrera,ejemplar_numero,monto_jugado");
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
    .sort(
      (a, b) =>
        String(a.fecha).localeCompare(String(b.fecha)) ||
        a.hipodromo.localeCompare(b.hipodromo, "es") ||
        (parseInt(a.carrera, 10) || 0) - (parseInt(b.carrera, 10) || 0)
    );

  return { carreras, fuente: filas.length ? "reales" : "local", error };
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
.im-hoja{flex:1;min-height:0;display:grid;grid-template-columns:repeat(5,1fr);grid-template-rows:repeat(3,1fr);gap:8px;}
.im-tarjeta{background:#fff;border:1px solid #cbd5e1;border-radius:10px;overflow:hidden;
  display:flex;flex-direction:column;min-height:0;position:relative;box-shadow:0 1px 2px rgba(0,0,0,.04);}
.im-enc{background:#0f172a;color:#fff;padding:6px 8px;flex:none;}
.im-l1{display:flex;align-items:center;gap:6px;justify-content:space-between;}
.im-hip{font-size:12px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1;}
.im-cc{background:rgba(255,255,255,.16);border-radius:6px;font-size:12px;font-weight:900;padding:1px 7px;white-space:nowrap;flex:none;}
.im-l2{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:3px;font-size:10px;font-weight:700;color:#cbd5e1;}
.im-meta{display:flex;align-items:center;gap:4px;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}
.im-fecha{margin-left:auto;white-space:nowrap;font-weight:800;color:#7dd3fc;}
.im-filas{flex:1;display:flex;flex-direction:column;justify-content:space-evenly;gap:1px;
  padding:4px 7px;min-height:0;overflow:hidden;font-size:10px;}
.im-fila{display:flex;align-items:center;gap:6px;line-height:1.15;min-height:0;}
.im-num{flex:none;width:1.55em;height:1.55em;border-radius:5px;margin:0;padding:0;
  display:flex;align-items:center;justify-content:center;
  font-weight:900;font-size:0.98em;line-height:1;overflow:hidden;text-align:center;
  box-sizing:border-box;}
.im-nom{flex:1;min-width:0;font-weight:700;color:#334155;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:5px;}
.im-nom.ret{color:#dc2626;text-decoration:line-through;}
.im-nom.ret b{text-decoration:line-through;}
.im-mon{font-weight:800;color:#475569;white-space:nowrap;font-size:0.95em;flex:none;}
.im-mon.cero{color:#94a3b8;}
.im-badge{position:absolute;top:5px;right:5px;z-index:3;padding:2px 7px;
  border:2px solid #fecaca;border-radius:6px;background:#fee2e2;color:#b91c1c;
  font-size:8px;font-weight:900;letter-spacing:.5px;white-space:nowrap;
  box-shadow:0 1px 2px rgba(0,0,0,.15);}
.im-pie{display:flex;justify-content:space-between;align-items:center;gap:6px;flex:none;
  border-top:1px solid #e2e8f0;background:#f8fafc;padding:5px 8px;
  font-size:10px;font-weight:700;color:#475569;white-space:nowrap;}
.im-pie b{color:#047857;font-size:12px;}
.im-normas{font-size:9px;color:#64748b;line-height:1.5;text-align:center;
  padding:10px 4px 0;flex:none;font-weight:600;}
@media print{
  @page{size:A4 portrait;margin:3mm;}
  body *{visibility:hidden;}
  .impe-root,.impe-root *{visibility:visible;}
  .impe-root{position:absolute !important;left:0 !important;top:0 !important;width:100% !important;max-width:none !important;}
  .im-pagina{width:204mm;height:288mm;padding:2mm;break-after:page;border:none;border-radius:0;}
  .im-hoja{grid-template-columns:repeat(5,1fr);grid-template-rows:repeat(3,1fr);gap:2.2mm;}
  .im-tarjeta{break-inside:avoid;border-radius:4px;}
}
`;

function tarjetaHTML(t: TablaImpresion): string {
  const n = t.ejemplares.length || 1;
  const fs = fsAuto(t.ejemplares.length || 1);
  const suma = t.ejemplares.reduce((a, e) => a + (e.retirado ? 0 : e.valor_ejemplar), 0);
  const jugadoTotal = t.ejemplares.reduce((a, e) => a + e.jugado, 0);
  const filas = t.ejemplares
    .map((e) => {
      const c = col(e.numero);
      const val = e.valor_ejemplar;
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
        '</span><span class="im-mon' +
        (val === 0 ? " cero" : "") +
        '">' +
        (val === 0 ? "–" : mon(val, t.moneda)) +
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
    '<div class="im-pie"><span>&Sigma; SUMA <b>' +
    mon(suma, t.moneda) +
    '</b></span><span>PREMIO/TABLA <b>' +
    mon(t.premio, t.moneda) +
    "</b></span></div>" +
    "</div>"
  );
}

/** Construye las páginas A4 (15 tarjetas = 3×5 por página). */
export function paginasMatrizHTML(carreras: TablaImpresion[]): string {
  if (carreras.length === 0) return "";
  const nPaginas = Math.max(1, Math.ceil(carreras.length / 15));
  let h = "";
  for (let p = 0; p < nPaginas; p++) {
    const chunk = carreras.slice(p * 15, p * 15 + 15);
    h +=
      '<div class="im-pagina">' +
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