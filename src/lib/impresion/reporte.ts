/**
 * IMPRESIÓN DEL REPORTE DE TABLAS (Resultado por Jugador / Grupo / Nivel)
 * ----------------------------------------------------------------------
 * Replica 1:1 del legacy `reporte_tablas.html` sobre la SPA:
 *  · Tabla RESUMEN jugador → grupo → nivel (tablas, jugado, pagado,
 *    diferencia, estado EN ORDEN / ⚠ ATENCIÓN) + tarjetas de DETALLE con
 *    las carreras y sus ejemplares (gualdrapa, nombre, jugado vs pagado).
 *  · Datos REALES: tickets_apuestas (monto jugado, monto decidido cuando
 *    SOLUCIONADO, cantidad de tablas, cliente_juega_nombre, grupo, moneda)
 *    + tablas_fijas (estado Abierta). Las tablas publicadas SIN venta se
 *    listan como "SIN APUESTAS".
 *  · Paginación A4 igual al legacy: resumen en la página 1 y tarjetas en
 *    grilla de 2 columnas hasta completar las páginas.
 */
import { supabase } from "@/lib/supabase";
import { parseNum } from "@/lib/tablas/tipos";
import { esc, fsAuto, col, fmt, monCode, fmtFecha, hoy, hipoKey, type Orientacion, DIM_PAGINA } from "@/lib/impresion/util";

export type EjemplarJugador = {
  numero: string;
  nombre: string;
  jugado: number;
  pagado: number;
  cantTablas: number;
};

export type CarreraJugador = {
  hipodromo: string;
  carrera: string;
  fecha: string;
  distancia: string;
  superficie: string;
  moneda: string;
  ejemplares: EjemplarJugador[];
};

export type JugadorReporte = {
  jugador: string;
  grupo: string;
  nivel: string;
  moneda: string;
  carreras: CarreraJugador[];
  montoJugado: number;
  montoPagado: number;
  tablas: number;
  ord: number;
};

export type ReporteJugadores = {
  jugadores: JugadorReporte[];
  fuente: "reales" | "local";
  error?: string;
};

type TicketCrudo = {
  fecha_registro?: unknown;
  hipodromo?: unknown;
  carrera?: unknown;
  ejemplar_numero?: unknown;
  caballo?: unknown;
  cantidad_tablas?: unknown;
  monto_jugado?: unknown;
  monto_decidido?: unknown;
  estado?: unknown;
  moneda?: unknown;
  grupo?: unknown;
  cliente_juega_nombre?: unknown;
};

type TablaMetaCruda = {
  hipodromo?: unknown;
  carrera?: unknown;
  fecha?: unknown;
  fecha_creacion?: unknown;
  distancia_carrera?: unknown;
  superficie?: unknown;
  moneda?: unknown;
  caballos?: Array<{ numero?: unknown; nombre?: unknown }> | null;
};

const un = (v: unknown): string => String(v ?? "").trim();

/** Carga tickets + metadatos de tablas y arma el árbol jugador→grupo→nivel. */
export async function cargarReporteJugadores(filtros?: { dia?: string; hipodromo?: string }): Promise<ReporteJugadores> {
  if (!supabase) return { jugadores: [], fuente: "local", error: "Sin conexión a Supabase" };

  const dia = filtros?.dia || "";
  const hipo = filtros?.hipodromo ? String(filtros.hipodromo).toUpperCase() : "";

  let tickets: TicketCrudo[] = [];
  try {
    let sel = supabase
      .from("tickets_apuestas")
      .select(
        "id,fecha_registro,hipodromo,carrera,ejemplar_numero,caballo,cantidad_tablas,monto_jugado,monto_decidido,cliente_juega_nombre,grupo,moneda,estado"
      )
      .order("fecha_registro");
    if (dia) sel = sel.like("fecha_registro", `${dia}%`);
    if (hipo) sel = sel.ilike("hipodromo", hipo);
    const { data, error } = await sel;
    if (!error) tickets = (data ?? []) as TicketCrudo[];
  } catch {
    tickets = [];
  }

  let tablas: TablaMetaCruda[] = [];
  try {
    let sel = supabase
      .from("tablas_fijas")
      .select("id,hipodromo,carrera,fecha,fecha_creacion,distancia_carrera,superficie,moneda,caballos")
      .ilike("estado", "abierta");
    if (dia) sel = sel.eq("fecha", dia);
    if (hipo) sel = sel.ilike("hipodromo", hipo);
    const { data, error } = await sel;
    if (!error) tablas = (data ?? []) as TablaMetaCruda[];
  } catch {
    tablas = [];
  }

  const idx = new Map<string, TablaMetaCruda>();
  for (const t of tablas) idx.set(`${hipoKey(un(t.hipodromo))}|${un(t.carrera).trim()}`, t);

  const jugadores = armarJugadores(tickets, idx);
  const tomadas = new Set<string>();
  for (const t of tickets) tomadas.add(`${hipoKey(un(t.hipodromo))}|${un(t.carrera).trim()}`);

  const sinApuestas: JugadorReporte[] = [];
  for (const t of tablas) {
    const ck = `${hipoKey(un(t.hipodromo))}|${un(t.carrera).trim()}`;
    if (tomadas.has(ck)) continue;
    const ejemplares = (t.caballos ?? [])
      .map((c) => ({ numero: String(c.numero ?? ""), nombre: String(c.nombre ?? ""), jugado: 0, pagado: 0, cantTablas: 0 }))
      .filter((e) => e.numero);
    if (!ejemplares.length) continue;
    sinApuestas.push({
      jugador: "SIN APUESTAS",
      grupo: "PUBLICADAS",
      nivel: "SIN VENTA",
      moneda: t.moneda ? String(t.moneda) : "USD",
      montoJugado: 0,
      montoPagado: 0,
      tablas: 0,
      ord: 0,
      carreras: [
        {
          hipodromo: String(t.hipodromo ?? "").trim().toUpperCase() || "—",
          carrera: String(t.carrera ?? ""),
          fecha: String(t.fecha || t.fecha_creacion || ""),
          distancia: t.distancia_carrera != null ? String(t.distancia_carrera) : "",
          superficie: t.superficie ? String(t.superficie) : "",
          moneda: t.moneda ? String(t.moneda) : "USD",
          ejemplares,
        },
      ],
    });
  }

  const todos = [...jugadores, ...sinApuestas];
  return {
    jugadores: todos.sort(
      (a, b) =>
        a.grupo.localeCompare(b.grupo, "es") ||
        a.ord - b.ord ||
        a.jugador.localeCompare(b.jugador, "es")
    ),
    fuente: "reales",
  };
}

function armarJugadores(tickets: TicketCrudo[], idx: Map<string, TablaMetaCruda>): JugadorReporte[] {
  const pj = new Map<string, JugadorReporte>();
  const ordG = new Map<string, number>();

  for (const t of tickets) {
    const jug = un(t.cliente_juega_nombre) || "SIN NOMBRE";
    const grp = un(t.grupo) || "SIN GRUPO";
    if (!pj.has(jug)) {
      ordG.set(grp, (ordG.get(grp) || 0) + 1);
      pj.set(jug, {
        jugador: jug,
        grupo: grp,
        nivel: `NIVEL ${ordG.get(grp)}`,
        moneda: t.moneda ? String(t.moneda) : "USD",
        carreras: [],
        montoJugado: 0,
        montoPagado: 0,
        tablas: 0,
        ord: ordG.get(grp) || 0,
      });
    }
    const p = pj.get(jug)!;
    const hipo = String(t.hipodromo ?? "").trim().toUpperCase();
    const cr = String(t.carrera ?? "");
    const ck = `${hipoKey(hipo)}|${cr.trim()}`;
    const meta = idx.get(ck);
    let c = p.carreras.find((x) => x.hipodromo === hipo && x.carrera === cr.trim());
    if (!c) {
      c = {
        hipodromo: hipo,
        carrera: cr.trim(),
        fecha: (meta && (un(meta.fecha) || un(meta.fecha_creacion))) || String(t.fecha_registro || "").slice(0, 10),
        distancia: meta && meta.distancia_carrera != null ? String(meta.distancia_carrera) : "",
        superficie: meta && meta.superficie ? String(meta.superficie) : "",
        moneda: t.moneda ? String(t.moneda) : p.moneda,
        ejemplares: [],
      };
      p.carreras.push(c);
    }
    const num = String(t.ejemplar_numero ?? "");
    let e = c.ejemplares.find((x) => x.numero === num);
    if (!e) {
      e = { numero: num, nombre: un(t.caballo), jugado: 0, pagado: 0, cantTablas: 0 };
      c.ejemplares.push(e);
    }
    const jugado = parseNum(t.monto_jugado);
    const cant = parseInt(String(t.cantidad_tablas) || "0", 10) || 0;
    e.jugado += jugado;
    e.cantTablas += cant;
    p.montoJugado += jugado;
    p.tablas += cant;
    if (un(t.estado).toUpperCase() === "SOLUCIONADO") {
      const pagado = parseNum(t.monto_decidido);
      e.pagado += pagado;
      p.montoPagado += pagado;
    }
  }

  return Array.from(pj.values())
    .map((p) => {
      p.carreras.sort(
        (a, b) =>
          a.hipodromo.localeCompare(b.hipodromo, "es") ||
          (parseInt(a.carrera, 10) || 0) - (parseInt(b.carrera, 10) || 0)
      );
      p.carreras.forEach((c) =>
        c.ejemplares.sort((a, b) => (parseInt(a.numero, 10) || 0) - (parseInt(b.numero, 10) || 0))
      );
      p.montoJugado = Math.round(p.montoJugado * 100) / 100;
      p.montoPagado = Math.round(p.montoPagado * 100) / 100;
      return p;
    })
    .sort(
      (a, b) => a.grupo.localeCompare(b.grupo, "es") || a.ord - b.ord || a.jugador.localeCompare(b.jugador, "es")
    );
}

/* ─────────────────────────── HTML DE PÁGINAS A4 ─────────────────────────── */

/** Alto estimado de una tarjeta (px @1240). Misma regla del legacy /2 por escala. */
function fsCanvas(n: number): number {
  const num = Math.min(Math.max(n || 1, 1), 20);
  const p = (28 * 20) / num;
  return Math.round(Math.min(42, Math.max(20, p)));
}
function rowH(ejemplares: number): number {
  const fsC = Math.round((fsCanvas(ejemplares) * 10) / 20) / 10;
  return Math.max(14, Math.round((fsC * 1.55 + 12) * 10) / 10) / 2;
}
export function estimarAltoCard(p: JugadorReporte): number {
  const CARDCAB = 52;
  const BLOCKH = 26;
  let h = CARDCAB;
  for (const c of p.carreras) h += BLOCKH + c.ejemplares.length * rowH(c.ejemplares.length) + 10;
  return h;
}

const ALTO_TABLA_RESUMEN = 92;

function resumenTableHTML(jugadores: JugadorReporte[]): string {
  let tj = 0;
  let tp = 0;
  let tt = 0;
  let h =
    '<table class="ir-tabla"><thead><tr><th>Jugador</th><th>Grupo</th><th>Nivel</th>' +
    '<th class="ir-derecha">Tablas</th><th class="ir-derecha">Jugado</th><th class="ir-derecha">Pagado</th>' +
    '<th class="ir-derecha">Diferencia</th><th>Estado</th></tr></thead><tbody>';
  for (const p of jugadores) {
    const d = p.montoJugado - p.montoPagado;
    const ok = p.montoPagado <= p.montoJugado;
    h +=
      "<tr>" +
      `<td><b>${esc(p.jugador)}</b></td>` +
      `<td><span class="ir-grp">${esc(p.grupo)}</span></td>` +
      `<td><span class="ir-niv">${esc(p.nivel)}</span></td>` +
      `<td class="ir-derecha">${p.tablas}</td>` +
      `<td class="ir-derecha">${fmt(p.montoJugado)}</td>` +
      `<td class="ir-derecha ir-verde">${fmt(p.montoPagado)}</td>` +
      `<td class="ir-derecha ${ok ? "ir-verde" : "ir-rojo"}">${fmt(Math.abs(d))}</td>` +
      `<td>${ok ? '<span class="ir-est ir-est-ok">&#10003; EN ORDEN</span>' : '<span class="ir-est ir-est-at">&#9888; ATENCION</span>'}</td>` +
      "</tr>";
    tj += p.montoJugado;
    tp += p.montoPagado;
    tt += p.tablas;
  }
  h +=
    `<tr class="ir-tot"><td><b>TOTAL</b></td><td></td><td></td>` +
    `<td class="ir-derecha">${tt}</td><td class="ir-derecha">${fmt(tj)}</td>` +
    `<td class="ir-derecha">${fmt(tp)}</td><td class="ir-derecha">${fmt(tj - tp)}</td><td></td></tr>`;
  h += "</tbody></table>";
  return h;
}

function cardReporteHTML(p: JugadorReporte): string {
  let h = '<div class="ir-card">';
  h +=
    '<div class="ir-enc"><span class="ir-cjug">' +
    esc(p.jugador) +
    '</span><span class="ir-badges"><span class="ir-grp">' +
    esc(p.grupo) +
    '</span><span class="ir-niv">' +
    esc(p.nivel) +
    '</span></span><span class="ir-ctot">J ' +
    fmt(p.montoJugado) +
    " &middot; P " +
    fmt(p.montoPagado) +
    " &middot; [" +
    monCode(p.moneda) +
    "]</span></div>";
  for (const c of p.carreras) {
    const n = c.ejemplares.length || 1;
    const fs = fsAuto(c.ejemplares.length || 1);
    const filas = c.ejemplares
      .map((e) => {
        const cc = col(e.numero);
        return (
          '<div class="ir-frac"><span class="ir-num" style="background:' +
          cc.bg +
          ";color:" +
          cc.fg +
          '">' +
          esc(e.numero) +
          '</span><span class="ir-cab">' +
          esc(e.nombre) +
          '</span><span class="ir-jj">' +
          fmt(e.jugado) +
          '</span><span class="ir-pp">' +
          fmt(e.pagado) +
          "</span></div>"
        );
      })
      .join("");
    h +=
      '<div class="ir-carr"><div class="ir-cl1"><span class="ir-hip" title="' +
      esc(c.hipodromo) +
      '">' +
      esc(c.hipodromo) +
      '</span><span class="ir-cc">C' +
      esc(c.carrera) +
      "</span></div>";
    h +=
      '<div class="ir-cl2"><span class="ir-meta"><b>DIST ' +
      (c.distancia !== "" && c.distancia != null ? esc(c.distancia) : "—") +
      " m</b> &middot; " +
      esc(c.superficie || "—") +
      '</span><span class="ir-fecha">' +
      fmtFecha(c.fecha) +
      "</span></div>";
    h += '<div class="ir-filas" style="font-size:' + fs + 'px">' + filas + "</div></div>";
  }
  h += "</div>";
  return h;
}

export const REPORTE_CSS = `
.imr-root{font-family:system-ui,-apple-system,sans-serif;color:#1e293b;background:#fff;}
.imr-ppagina{box-sizing:border-box;width:1240px;height:1754px;display:flex;flex-direction:column;
  background:#fff;padding:12px 14px;overflow:hidden;}
.imr-ph{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex:none;padding-bottom:10px;}
.imr-titulo{font-size:22px;font-weight:900;color:#0f172a;display:flex;align-items:center;gap:8px;}
.imr-titulo small{display:block;font-size:11px;font-weight:600;color:#64748b;}
.imr-hoy{font-size:15px;font-weight:800;color:#2563eb;white-space:nowrap;padding-top:6px;}
.imr-normas{font-size:9px;color:#64748b;line-height:1.55;text-align:justify;flex:none;
  border-top:1px solid #cbd5e1;padding-top:7px;margin-top:8px;font-weight:500;}
.imr-tabla{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;}
.imr-tabla th{background:#0f172a;color:#fff;font-size:10px;font-weight:700;text-transform:uppercase;
  letter-spacing:.3px;padding:8px 10px;text-align:left;vertical-align:middle;}
.imr-tabla td{font-size:12px;padding:8px 10px;border-bottom:1px solid #e2e8f0;vertical-align:middle;}
.imr-tabla tbody tr:nth-child(even) td{background:#f8fafc;}
.imr-derecha{text-align:right;}
.imr-verde{color:#047857;font-weight:800;}
.imr-rojo{color:#b91c1c;font-weight:800;}
.imr-est{display:inline-flex;align-items:center;gap:5px;font-size:9px;font-weight:800;border-radius:99px;padding:3px 9px;}
.imr-est-ok{color:#047857;background:#ecfdf5;border:1px solid #a7f3d0;}
.imr-est-at{color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;}
.imr-grp{display:inline-block;font-size:9px;font-weight:800;color:#6d28d9;background:#f5f3ff;
  border:1px solid #ddd6fe;border-radius:99px;padding:2px 8px;white-space:nowrap;}
.imr-niv{display:inline-block;font-size:9px;font-weight:800;color:#b91c1c;background:#fef2f2;
  border:1px solid #fecaca;border-radius:99px;padding:2px 8px;white-space:nowrap;}
.imr-tot td{background:#f0fdf4 !important;color:#065f46;font-weight:900;}
.imr-cuerpo{flex:1;min-height:0;overflow:hidden;}
.imr-sec{font-size:16px;font-weight:800;color:#0f172a;margin:14px 0 8px;display:flex;align-items:center;gap:7px;}
.imr-pcards{display:grid;grid-template-columns:1fr 1fr;gap:10px;align-content:start;}
.imr-card{background:#fff;border:1px solid #cbd5e1;border-radius:10px;overflow:hidden;
  display:flex;flex-direction:column;box-shadow:0 1px 3px rgba(0,0,0,.05);break-inside:avoid;}
.imr-enc{background:#0f172a;color:#fff;padding:7px 9px;display:flex;align-items:center;gap:6px;flex-wrap:nowrap;}
.imr-cjug{font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.3px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1;}
.imr-badges{display:flex;gap:4px;align-items:center;flex-wrap:nowrap;}
.imr-ctot{margin-left:auto;font-size:10px;font-weight:800;color:#a7f3d0;white-space:nowrap;}
.imr-carr{padding:6px 8px 0;border-top:1px solid #f1f5f9;min-width:0;}
.imr-cl1{display:flex;align-items:center;gap:6px;justify-content:space-between;}
.imr-hip{font-size:10px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1;}
.imr-cc{background:#eef2ff;color:#4338ca;border-radius:5px;font-size:10px;font-weight:900;padding:1px 7px;white-space:nowrap;flex:none;}
.imr-cl2{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:2px;font-size:9px;font-weight:700;color:#64748b;}
.imr-meta{display:flex;align-items:center;gap:4px;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}
.imr-fecha{margin-left:auto;white-space:nowrap;font-weight:800;color:#2563eb;}
.imr-filas{display:flex;flex-direction:column;justify-content:space-evenly;padding:4px 0 6px;min-height:0;
  font-size:10px;gap:2px;}
.imr-frac{display:flex;align-items:center;gap:6px;line-height:1.15;min-height:0;}
.imr-num{flex:none;width:1.55em;height:1.55em;border-radius:5px;margin:0;padding:0;
  display:flex;align-items:center;justify-content:center;font-weight:900;font-size:0.98em;
  line-height:1;overflow:hidden;text-align:center;box-sizing:border-box;}
.imr-cab{flex:1;min-width:0;font-weight:700;color:#334155;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.imr-jj{white-space:nowrap;font-weight:700;color:#475569;text-align:right;}
.imr-pp{white-space:nowrap;font-weight:800;color:#047857;min-width:96px;text-align:right;}
@media print{
  @page{size:A4 portrait;margin:3mm;}
  body *{visibility:hidden;}
  .imr-root,.imr-root *{visibility:visible;}
  .imr-root{position:absolute !important;left:0 !important;top:0 !important;width:100% !important;max-width:none !important;}
  .imr-ppagina{width:204mm;height:288mm;padding:2mm;break-after:page;border:none;}
  .imr-or-h .imr-ppagina{width:288mm;height:204mm;}
  .imr-pcards{grid-template-columns:repeat(2,1fr);}
  .imr-card{break-inside:avoid;}
}
`;

export type PaginaReporte = {
  /** Items a renderizar: { html, col(0|1) } por tarjeta. */
  cards: Array<{ html: string; col: number }>;
  resumen: boolean;
};

/** Reparte tarjetas en páginas A4 (2 columnas, sin cortar tarjetas). */
export function layoutPaginas(jugadores: JugadorReporte[], orientacion: Orientacion = "vertical"): PaginaReporte[] {
  if (jugadores.length === 0) return [];
  const dim = DIM_PAGINA[orientacion];
  // Portrait legacy: 1754 - 104 (hoja) - 120 (cabecera) - 92 (resumen) = 1438.
  // La misma regla escalada a la altura de la hoja elegida.
  const limite = dim.h - 104 - 120 - ALTO_TABLA_RESUMEN;
  const paginas: PaginaReporte[] = [];
  let pagina: PaginaReporte = { cards: [], resumen: true };
  let col = 0;
  let colH = 0;

  const cerrar = () => {
    if (pagina.cards.length || pagina.resumen) paginas.push(pagina);
    pagina = { cards: [], resumen: false };
    col = 0;
    colH = 0;
  };

  for (const p of jugadores) {
    const ah = estimarAltoCard(p);
    if (colH + ah > limite && colH > 0) {
      col += 1;
      colH = 0;
    }
    if (col >= 2) {
      cerrar();
      // re-evaluar columna tras crear página nueva
      col = 0;
      colH = 0;
      if (ah > limite) {
        // tarjeta gigante: aún así se coloca (no se corta)
      }
    }
    pagina.cards.push({ html: cardReporteHTML(p), col });
    colH += ah + 16;
  }
  cerrar();

  if (paginas.length === 0) paginas.push({ cards: [], resumen: true });
  return paginas;
}

/** Construye todas las páginas A4 del reporte (resumen + tarjetas). */
export function paginasReporteHTML(jugadores: JugadorReporte[], orientacion: Orientacion = "vertical"): string {
  const dim = DIM_PAGINA[orientacion];
  const pags = layoutPaginas(jugadores, orientacion);
  let h = "";
  pags.forEach((pg, i) => {
    h +=
      '<div class="imr-ppagina" style="width:' +
      dim.w +
      "px;height:" +
      dim.h +
      'px">' +
      '<div class="imr-ph">' +
      '<div class="imr-titulo"><span style="color:#7c3aed;">&#9632;</span> REPORTE DE TABLAS' +
      "<small>Resultado: monto jugado vs pagado, acumulado por jugador - grupo - nivel</small></div>" +
      '<span class="imr-hoy">Página ' +
      (i + 1) +
      " de " +
      pags.length +
      " &middot; " +
      hoy() +
      "</span></div>" +
      '<div class="imr-cuerpo">' +
      (pg.resumen ? '<div class="imr-sec"><span style="color:#7c3aed;">&#9632;</span> RESUMEN POR JUGADOR / GRUPO / NIVEL</div>' + resumenTableHTML(jugadores) : "") +
      (pg.resumen && pg.cards.length ? '<div class="imr-sec"><span style="color:#7c3aed;">&#9632;</span> DETALLE POR JUGADOR</div>' : "") +
      '<div class="imr-pcards">' +
      pg.cards
        .map(
          (c) =>
            '<div style="grid-column:' +
            (c.col + 1) +
            ';min-width:0">' +
            c.html +
            "</div>"
        )
        .join("") +
      "</div>" +
      "</div>" +
      '<div class="imr-normas">NORMAS: 1) Reporte de resultado por tablas fijas publicado y no reclamado. ' +
      "2) Los montos no muestran símbolo de moneda: la moneda (BS/USD) se estipula según el grupo que juega el usuario. 3) La diferencia jugado-pagado debe ser cero o positiva al cierre de carrera. " +
      "4) Cualquier atencion debe reportarse al operador de taquilla antes del cobro siguiente. 5) Este reporte es de control interno.</div>" +
      "</div>";
  });
  return h;
}

/* ─────────────────────────── FILTROS BIDIRECCIONALES ─────────────────────────── */

export type OpcionesReporte = {
  dias: string[];
  hipodromos: string[];
  diasDelHipodromo: (hipo: string) => string[];
  hipodromosDelDia: (dia: string) => string[];
};

export function opcionesReporte(jugadores: JugadorReporte[]): OpcionesReporte {
  const diasPorHipo = new Map<string, Set<string>>();
  const hiposPorDia = new Map<string, Set<string>>();
  for (const p of jugadores) {
    for (const c of p.carreras) {
      const d = String(c.fecha || "").slice(0, 10);
      const h = hipoKey(c.hipodromo);
      if (!h || !d) continue;
      if (!diasPorHipo.has(h)) diasPorHipo.set(h, new Set());
      if (!hiposPorDia.has(d)) hiposPorDia.set(d, new Set());
      diasPorHipo.get(h)!.add(d);
      hiposPorDia.get(d)!.add(h);
    }
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

function pasaIAS(c: CarreraJugador, dia?: string, hipo?: string): boolean {
  if (dia && String(c.fecha || "").slice(0, 10) !== dia) return false;
  if (hipo && hipoKey(c.hipodromo) !== hipoKey(hipo)) return false;
  return true;
}

/**
 * Aplica filtros hipódromo/día A NIVEL DE CARRERA (igual que el legacy):
 * conserva las carreras que pasan, recalcula los totales del jugador y
 * descarta los jugadores que quedan sin carreras.
 */
export function filtrarReporteJugadores(
  jugadores: JugadorReporte[],
  filtros: { dia?: string; hipodromo?: string }
): JugadorReporte[] {
  const dia = filtros.dia || "";
  const hipo = filtros.hipodromo || "";
  if (!dia && !hipo) return jugadores;
  return jugadores
    .map((p) => {
      const carreras = p.carreras.filter((c) => pasaIAS(c, dia, hipo));
      if (!carreras.length) return null;
      const montoJugado = Math.round(carreras.reduce((a, c) => a + c.ejemplares.reduce((x, e) => x + e.jugado, 0), 0) * 100) / 100;
      const montoPagado = Math.round(carreras.reduce((a, c) => a + c.ejemplares.reduce((x, e) => x + e.pagado, 0), 0) * 100) / 100;
      const tablas = carreras.reduce((a, c) => a + c.ejemplares.reduce((x, e) => x + e.cantTablas, 0), 0);
      return { ...p, carreras, montoJugado, montoPagado, tablas };
    })
    .filter((p): p is JugadorReporte => p !== null);
}

/** Resumen ligero para el aviso de la UI. */
export function resumirReporteJugadores(jugadores: JugadorReporte[]) {
  const conVentas = jugadores.filter((p) => p.tablas > 0 || p.montoJugado > 0);
  const sinApuestas = jugadores.filter((p) => p.jugador === "SIN APUESTAS");
  return { jugadores: jugadores.length, conVentas: conVentas.length, sinApuestas: sinApuestas.length };
}