/**
 * Reporte por Jugador / Grupo / Nivel — paridad con la ruta legacy
 * `reporte_tablas_publicadas.html` (tabla resumen + tarjetas de detalle).
 *
 * Client-side (sin backend de Next):
 *  · Lee `tickets_apuestas` + `tablas_fijas` (estado Abierta) para armar el
 *    reporte "monto jugado vs pagado" acumulado por jugador.
 *  · PDF  → html2canvas de la vista densa + jsPDF portrait.
 *  · JPG/PNG → html2canvas + descarga nativa <a download>.
 *
 * Diseño legacy: cabeceras azul marino oscuro, fondo blanco, alineación
 * compacta, chips de grupo/nivel moneda, y letra adaptativa por cantidad de
 * ejemplares (fsAuto) para que todo quepa sin scroll.
 */
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { supabase } from "@/lib/supabase";
import { colorDeNumero, textoDeNumero, fmtMoney } from "@/lib/tablas/tipos";
import type { FiltrosImpresion, FormatoImpresion, ResultadoImpresion } from "@/lib/impresion/tablas";

const PALETA14: Array<[string, string]> = [
  ["#e11d48", "#ffffff"],
  ["#ffffff", "#111827"],
  ["#1d4ed8", "#ffffff"],
  ["#facc15", "#111827"],
  ["#16a34a", "#ffffff"],
  ["#111827", "#facc15"],
  ["#f97316", "#111827"],
  ["#fbcfe8", "#111827"],
  ["#22d3ee", "#111827"],
  ["#7c3aed", "#ffffff"],
  ["#9caeff", "#111827"],
  ["#84cc16", "#111827"],
  ["#92400e", "#ffffff"],
  ["#7f1d1d", "#ffffff"],
];
function col(n: number | string) {
  const i = ((parseInt(String(n), 10) || 1) - 1) % 14;
  const p = PALETA14[i >= 0 ? i : 0] ?? PALETA14[0];
  return { bg: p[0], fg: p[1] };
}
function fsAuto(n: number): number {
  n = Math.min(Math.max(parseInt(String(n), 10) || 1, 1), 20);
  const p = (8.6 * 20) / n;
  return Math.round(Math.min(13.5, Math.max(7.4, p)) * 10) / 10;
}
function fmtFecha(d?: string | null): string {
  if (!d) return "—";
  const p = String(d).slice(0, 10).split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : String(d);
}
function esc(s: unknown): string {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type TicketRow = {
  id: unknown;
  hipodromo?: unknown;
  carrera?: unknown;
  ejemplar_numero?: unknown;
  caballo?: unknown;
  cantidad_tablas?: unknown;
  monto_jugado?: unknown;
  monto_decidido?: unknown;
  cliente_juega_nombre?: unknown;
  grupo?: unknown;
  moneda?: unknown;
  estado?: unknown;
  fecha_registro?: unknown;
};

type MetaCarrera = Record<string, string | number | unknown> & {
  caballos?: unknown;
};

async function leerTickets(): Promise<TicketRow[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("tickets_apuestas")
      .select(
        "id,fecha_registro,hipodromo,carrera,ejemplar_numero,caballo,cantidad_tablas,monto_jugado,monto_decidido,cliente_juega_nombre,grupo,moneda,estado"
      )
      .order("fecha_registro");
    if (error) throw error;
    return (data ?? []) as TicketRow[];
  } catch {
    return [];
  }
}

async function leerMetaCarreras(): Promise<Map<string, MetaCarrera>> {
  const idx = new Map<string, MetaCarrera>();
  if (!supabase) return idx;
  try {
    const { data, error } = await supabase
      .from("tablas_fijas")
      .select("hipodromo,carrera,fecha,fecha_creacion,distancia_carrera,superficie,premio_recalculado,suma_base_tabla,moneda,caballos")
      .ilike("estado", "abierta");
    if (error) throw error;
    for (const t of data as Array<Record<string, unknown>>) {
      const k = `${String(t.hipodromo || "").trim().toUpperCase()}|${String(t.carrera || "")}`;
      idx.set(k, {
        hipodromo: t.hipodromo ?? "",
        carrera: t.carrera ?? "",
        fecha: t.fecha ?? t.fecha_creacion ?? "",
        distancia_carrera: t.distancia_carrera ?? "",
        superficie: t.superficie ?? "",
        caballos: Array.isArray(t.caballos) ? t.caballos : [],
      });
    }
  } catch {
    /* sin conexión → solo tickets */
  }
  return idx;
}

type EjempReporte = { numero: string; nombre: string; jugado: number; pagado: number; cantTablas: number };
type CarreraReporte = {
  hipodromo: string;
  carrera: string;
  fecha?: string | null;
  distancia?: string | null;
  superficie?: string | null;
  moneda: string;
  ejemplares: EjempReporte[];
};
type JugadorReporte = {
  jugador: string;
  grupo: string;
  nivel: string;
  moneda: string;
  carreras: CarreraReporte[];
  montoJugado: number;
  montoPagado: number;
  tablas: number;
};

function armarDesdeTickets(tickets: TicketRow[]): JugadorReporte[] {
  const pj = new Map<string, JugadorReporte>();
  const ordG = new Map<string, number>();
  for (const t of tickets) {
    const jug = String(t.cliente_juega_nombre || "SIN NOMBRE");
    const grp = String(t.grupo || "SIN GRUPO");
    let p = pj.get(jug);
    if (!p) {
      const nivel = "NIVEL " + ((ordG.get(grp) ?? 0) + 1);
      ordG.set(grp, (ordG.get(grp) ?? 0) + 1);
      p = {
        jugador: jug,
        grupo: grp,
        nivel,
        moneda: String(t.moneda || "USD"),
        carreras: [],
        montoJugado: 0,
        montoPagado: 0,
        tablas: 0,
      };
      pj.set(jug, p);
    }
    const hipo = String(t.hipodromo || "")
      .trim()
      .toUpperCase();
    const cr = String(t.carrera || "");
    let carrera = p.carreras.find((c) => c.hipodromo === hipo && c.carrera === cr);
    if (!carrera) {
      carrera = {
        hipodromo: hipo,
        carrera: cr,
        fecha: String(t.fecha_registro || "").slice(0, 10),
        moneda: String(t.moneda || p.moneda),
        ejemplares: [],
      };
      p.carreras.push(carrera);
    }
    const k = String(t.ejemplar_numero ?? "");
    let e = carrera.ejemplares.find((x) => x.numero === k);
    if (!e) {
      e = { numero: k, nombre: String(t.caballo || ""), jugado: 0, pagado: 0, cantTablas: 0 };
      carrera.ejemplares.push(e);
    }
    const jugado = parseFloat(String(t.monto_jugado ?? "0")) || 0;
    e.jugado += jugado;
    e.cantTablas += parseInt(String(t.cantidad_tablas || "0"), 10) || 0;
    p.montoJugado += jugado;
    p.tablas += parseInt(String(t.cantidad_tablas || "0"), 10) || 0;
    if (String(t.estado || "").trim().toUpperCase() === "SOLUCIONADO") {
      const pagado = parseFloat(String(t.monto_decidido ?? "0")) || 0;
      e.pagado += pagado;
      p.montoPagado += pagado;
    }
  }
  return [...pj.values()].map((p) => {
    p.carreras = p.carreras.sort(
      (a, b) => a.hipodromo.localeCompare(b.hipodromo, "es") || (parseInt(a.carrera, 10) || 0) - (parseInt(b.carrera, 10) || 0)
    );
    p.montoJugado = +(p.montoJugado.toFixed(2));
    p.montoPagado = +(p.montoPagado.toFixed(2));
    return p;
  });
}

/** Anota la marca de carrera (distancia, superficie, día real) desde tablas_fijas. */
function anotarMeta(jugadores: JugadorReporte[], idx: Map<string, MetaCarrera>): void {
  for (const p of jugadores) {
    for (const c of p.carreras) {
      const meta = idx.get(`${c.hipodromo}|${c.carrera}`);
      if (!meta) continue;
      if (!c.fecha) c.fecha = String(meta.fecha || "");
      c.distancia = meta.distancia_carrera ? String(meta.distancia_carrera) : null;
      c.superficie = meta.superficie ? String(meta.superficie) : null;
    }
  }
}

const ESTILOS_REPORTE = `
* { box-sizing: border-box; }
.imp-rep { position: fixed; left: -9999px; top: 0; width:1000px; background:#fff; font-family:'Segoe UI',Arial,sans-serif; color:#1e293b; z-index:-1; }
.sec { font-size:13px; font-weight:800; color:#0f172a; margin:14px 0 8px; display:flex; align-items:center; gap:7px; }
table { width:100%; border-collapse:collapse; background:#fff; border-radius:10px; overflow:hidden; }
th { background:#0f172a; color:#fff; font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:.3px; padding:7px 9px; text-align:left; }
td { font-size:10px; padding:6px 9px; border-bottom:1px solid #e2e8f0; }
tbody tr:nth-child(even) td { background:#f8fafc; }
.derecha { text-align:right; }
.estado { font-size:8px; font-weight:800; border-radius:99px; padding:2px 8px; }
.est-ok { color:#047857; background:#ecfdf5; border:1px solid #a7f3d0; }
.est-at { color:#b91c1c; background:#fef2f2; border:1px solid #fecaca; }
.grp { display:inline-block; font-size:8px; font-weight:800; color:#6d28d9; background:#f5f3ff; border:1px solid #ddd6fe; border-radius:99px; padding:1px 7px; }
.niv { display:inline-block; font-size:8px; font-weight:800; color:#b91c1c; background:#fef2f2; border:1px solid #fecaca; border-radius:99px; padding:1px 7px; }
.verde { color:#047857; font-weight:800; } .rojo { color:#b91c1c; font-weight:800; }
.tot { background:#f0fdf4 !important; font-weight:900; } .tot td { color:#065f46; }
.cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(360px,1fr)); gap:9px; margin-top:4px; }
.cardrep { background:#fff; border:1px solid #cbd5e1; border-radius:10px; overflow:hidden; display:flex; flex-direction:column; box-shadow:0 1px 3px rgba(0,0,0,.05); }
.crep-enc { background:#0f172a; color:#fff; padding:6px 9px; display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
.cjug { font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:.3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; flex:1; }
.badges { display:flex; gap:4px; align-items:center; flex-wrap:wrap; }
.ctot { margin-left:auto; font-size:8px; font-weight:800; color:#a7f3d0; white-space:nowrap; }
.carr { padding:5px 8px 0; border-top:1px solid #f1f5f9; }
.carr+.carr { border-top-style:dashed; }
.cl1 { display:flex; align-items:center; gap:6px; justify-content:space-between; }
.hip { font-size:8px; font-weight:800; letter-spacing:.4px; text-transform:uppercase; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; flex:1; }
.cc { background:#eef2ff; color:#4338ca; border-radius:5px; font-size:8px; font-weight:900; padding:1px 7px; white-space:nowrap; flex:none; }
.cl2 { display:flex; align-items:center; justify-content:space-between; gap:6px; margin-top:2px; font-size:7.5px; font-weight:700; color:#64748b; }
.fecha { margin-left:auto; white-space:nowrap; font-weight:800; color:#2563eb; }
.filasrep { display:flex; flex-direction:column; justify-content:space-evenly; padding:3px 0 5px; min-height:0; font-size:var(--fs,10px); gap:2px; }
.frac { display:flex; align-items:center; gap:6px; line-height:1.1; }
.num { width:1.5em; height:1.5em; border-radius:4px; display:flex; align-items:center; justify-content:center; font-weight:900; font-size:0.95em; flex:none; line-height:1; }
.cab2 { flex:1; font-weight:700; color:#334155; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.jj { white-space:nowrap; font-weight:700; color:#475569; }
.pp { white-space:nowrap; font-weight:800; color:#047857; min-width:90px; text-align:right; }
.vacio { padding:30px 20px; text-align:center; color:#94a3b8; font-size:12px; font-weight:700; }
.notas { margin-top:12px; font-size:7.5px; color:#64748b; line-height:1.6; border-top:1px solid #cbd5e1; padding-top:6px; }
`;

function resumenHTML(jugadores: JugadorReporte[]): string {
  let h =
    '<table><thead><tr><th>Jugador</th><th>Grupo</th><th>Nivel</th><th class="derecha">Tablas</th><th class="derecha">Jugado</th><th class="derecha">Pagado</th><th class="derecha">Diferencia</th><th>Estado</th></tr></thead><tbody>';
  let tj = 0;
  let tp = 0;
  let tt = 0;
  for (const p of jugadores) {
    const d = p.montoJugado - p.montoPagado;
    const ok = p.montoPagado <= p.montoJugado;
    h += `<tr><td><b>${esc(p.jugador)}</b></td><td><span class="grp">${esc(p.grupo)}</span></td><td><span class="niv">${esc(p.nivel)}</span></td><td class="derecha">${p.tablas}</td><td class="derecha">${fmtMoney(p.montoJugado, p.moneda)}</td><td class="derecha verde">${fmtMoney(p.montoPagado, p.moneda)}</td><td class="derecha ${ok ? "verde" : "rojo"}">${fmtMoney(Math.abs(d), p.moneda)}</td><td>${ok ? '<span class="estado est-ok">✔ EN ORDEN</span>' : '<span class="estado est-at">⚠ ATENCION</span>'}</td></tr>`;
    tj += p.montoJugado;
    tp += p.montoPagado;
    tt += p.tablas;
  }
  h += `<tr class="tot"><td>TOTAL</td><td></td><td></td><td class="derecha">${tt}</td><td class="derecha">${fmtMoney(tj)}</td><td class="derecha">${fmtMoney(tp)}</td><td class="derecha">${fmtMoney(tj - tp)}</td><td></td></tr></tbody></table>`;
  return h;
}

function cardRepHTML(p: JugadorReporte): string {
  let h = `<div class="cardrep"><div class="crep-enc"><span class="cjug">${esc(p.jugador)}</span><span class="badges"><span class="grp">${esc(p.grupo)}</span><span class="niv">${esc(p.nivel)}</span></span><span class="ctot">J ${fmtMoney(p.montoJugado)} · P ${fmtMoney(p.montoPagado)}</span></div>`;
  for (const c of p.carreras) {
    const n = c.ejemplares.length;
    const fs = fsAuto(n);
    const filas = c.ejemplares
      .map((e) => {
        const cc = col(e.numero);
        return `<div class="frac"><span class="num" style="background:${cc.bg};color:${cc.fg}">${esc(e.numero)}</span><span class="cab2">${esc(e.nombre)}</span><span class="jj">${fmtMoney(e.jugado, c.moneda || p.moneda)}</span><span class="pp">${fmtMoney(e.pagado, c.moneda || p.moneda)}</span></div>`;
      })
      .join("");
    h += `<div class="carr"><div class="cl1"><span class="hip">${esc(c.hipodromo)}</span><span class="cc">C${esc(c.carrera)}</span></div>`;
    h += `<div class="cl2"><span><b>DIST ${c.distancia || "—"} m</b> · ${esc(c.superficie || "—")}</span><span class="fecha">${fmtFecha(c.fecha)}</span></div>`;
    h += `<div class="filasrep" style="--fs:${fs}px">${filas}</div></div>`;
  }
  return h + "</div>";
}

function todoReporteHTML(jugadores: JugadorReporte[]): HTMLElement {
  const contenedor = document.createElement("div");
  contenedor.className = "imp-rep";
  const estilos = document.createElement("style");
  estilos.innerHTML = ESTILOS_REPORTE;
  contenedor.appendChild(estilos);
  const fecha = new Date().toLocaleString("es-VE", { dateStyle: "short", timeStyle: "short" });
  const cuerpo = document.createElement("div");
  cuerpo.innerHTML = `
    <div class="sec">■ RESUMEN POR JUGADOR / GRUPO / NIVEL · ${fecha} · ${jugadores.length} entrada(s)</div>
    ${resumenHTML(jugadores)}
    <div class="sec">■ DETALLE POR JUGADOR</div>
    <div class="cards">${jugadores.map(cardRepHTML).join("")}</div>
    <div class="notas"><b>NORMAS:</b> 1) Reporte de resultado por tablas fijas publicado y no reclamado. 2) Los montos se expresan en la moneda de cada jugada (Bs o US$). 3) La diferencia jugado-pagado debe ser cero o positiva al cierre de carrera. 4) Cualquier atención debe reportarse al operador de taquilla antes del cobro siguiente. 5) Válido solo para las tablas fijas publicadas y no reclamadas. 6) Este reporte es de control interno.</div>`;
  contenedor.appendChild(cuerpo);
  return contenedor;
}

async function renderCanvasRep(contenedor: HTMLElement, scale: number): Promise<HTMLCanvasElement> {
  document.body.appendChild(contenedor);
  try {
    await new Promise((r) => setTimeout(r, 150));
    const canvas = await html2canvas(contenedor, {
      scale,
      useCORS: true,
      backgroundColor: "#fff",
      logging: false,
      scrollX: 0,
      scrollY: 0,
    });
    return canvas;
  } finally {
    contenedor.remove();
  }
}

/** Genera el reporte por jugador/grupo/nivel (PDF/JPG/PNG). */
export async function imprimirReportePorJugador(
  formato: FormatoImpresion,
  filtros: FiltrosImpresion = {}
): Promise<ResultadoImpresion> {
  const tickets = await leerTickets();
  let jugadores = armarDesdeTickets(tickets);
  const idx = await leerMetaCarreras();
  anotarMeta(jugadores, idx);

  // Filtros hipódromo/día sobre las carreras del jugador.
  if (filtros.hipodromo || filtros.dia) {
    const catHipo = filtros.hipodromo?.trim().toLowerCase();
    const catDia = filtros.dia?.slice(0, 10);
    const carrerasCumplen = (c: CarreraReporte) =>
      (!catHipo || c.hipodromo.toLowerCase() === catHipo) &&
      (!catDia || (c.fecha ?? "").slice(0, 10) === catDia);
    jugadores = jugadores
      .map((p) => ({ ...p, carreras: p.carreras.filter(carrerasCumplen) }))
      .filter((p) => p.carreras.length > 0);
  }
  if (jugadores.length === 0) {
    return { ok: false, error: "No hay ventas (tickets_apuestas) para generar el reporte por jugador." };
  }

  const contenedor = todoReporteHTML(jugadores);
  const prefijo = `reporte_tablas_${(filtros.dia || "todas").replace(/[^0-9-]/g, "")}_${Date.now()}`;
  const esPDF = String(formato).toUpperCase() === "PDF";
  const scale = esPDF ? 2 : 1.8;

  if (!esPDF) {
    try {
      const canvas = await renderCanvasRep(contenedor, scale);
      const ext = String(formato).toUpperCase() === "PNG" ? "png" : "jpg";
      const url = canvas.toDataURL(ext === "png" ? "image/png" : "image/jpeg", ext === "png" ? undefined : 0.94);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${prefijo}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      return { ok: true, archivo: `${prefijo}.${ext}`, tablas: jugadores.length };
    } catch (err) {
      return { ok: false, error: `Error generando la imagen del reporte: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  try {
    const canvas = await renderCanvasRep(contenedor, scale);
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
    const W = 215.9;
    const H = 279.4;
    const escPx = canvas.height / (canvas.width / W);
    const hHojaPx = H * (canvas.width / W) / escPx;
    const numHojas = Math.max(1, Math.round(canvas.height / hHojaPx));
    if (numHojas <= 1) {
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, W, H);
    } else {
      const aux = document.createElement("canvas");
      aux.width = canvas.width;
      aux.height = Math.round(hHojaPx);
      const ctx = aux.getContext("2d");
      if (!ctx) throw new Error("Canvas 2D no disponible.");
      for (let i = 0; i < numHojas; i++) {
        if (i > 0) pdf.addPage();
        const sy = Math.min(i * hHojaPx, canvas.height - hHojaPx);
        ctx.clearRect(0, 0, aux.width, aux.height);
        ctx.drawImage(canvas, 0, sy, canvas.width, hHojaPx, 0, 0, aux.width, hHojaPx);
        pdf.addImage(aux.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, W, H);
      }
    }
    pdf.save(`${prefijo}.pdf`);
    return { ok: true, archivo: `${prefijo}.pdf`, tablas: jugadores.length, paginas: numHojas };
  } catch (err) {
    return { ok: false, error: `Error generando el PDF del reporte: ${err instanceof Error ? err.message : String(err)}` };
  }
}