// ============================================================
// REPORTE DE TABLAS FIJAS - seccion Reportes
// Columnas REALES verificadas: tickets_apuestas
//   monto_jugado | premio_por_tabla | cliente_juega_nombre | grupo
//   estado="SOLUCIONADO" -> monto_resuelto (= monto PAGADO)
// Generado por script verificado. Archivo NUEVO, no toca monolitos.
// ============================================================
window.clubReportes = window.clubReportes || {};

const COLS_REPORTE = `id, created_at, hipodromo, carrera, caballo, ejemplar_numero,
  cantidad_tablas, monto_jugado, premio_por_tabla, monto_resuelto,
  cliente_juega_nombre, cliente_juega_id, grupo, moneda, estado`;

async function cargarReporteTablasFijas({ dia = "", formato = "resumen" } = {}) {
  const sel = document.getElementById("contenedorReporteTablasFijas");
  if (!sel) return;
  if (clubUI?.toast) clubUI.toast("Generando reporte de tablas fijas...", "info");
  sel.innerHTML = `<div class="p-10 text-center text-slate-400"><i class="fas fa-spinner fa-spin text-2xl"></i><p class="mt-2 text-sm">Consultando tickets_apuestas...</p></div>`;
  try {
    let q = window.supabase.from("tickets_apuestas").select(COLS_REPORTE);
    if (dia) q = q.gte("created_at", new Date(dia + "T00:00:00.000Z").toISOString()).lte("created_at", new Date(dia + "T23:59:59.999Z").toISOString());
    const { data, error } = await q.order("created_at");
    if (error) throw error;
    if (!data || !data.length) {
      sel.innerHTML = `<div class="p-10 text-center text-slate-400"><i class="fas fa-inbox text-3xl mb-2"></i><p>No hay ventas de tablas fijas en el perAodo.</p></div>`;
      return;
    }
    // AGRUPAR por fecha|grupo|hipodromo|carrera|jugador
    const porClave = {};
    data.forEach(t => {
      const fecha = String(t.created_at || "").slice(0, 10);
      const clave = [fecha, t.grupo, String(t.hipodromo).trim().toUpperCase(), t.carrera, t.cliente_juega_nombre].join("|");
      if (!porClave[clave]) porClave[clave] = {
        fecha, grupo: t.grupo, hipodromo: String(t.hipodromo).trim().toUpperCase(),
        carrera: t.carrera, jugador: t.cliente_juega_nombre,
        montoJugado: 0, montoPagado: 0, tablas: 0,
      };
      const g = porClave[clave];
      g.montoJugado += parseFloat(t.monto_jugado) || 0;
      if (String(t.estado || "").trim().toUpperCase() === "SOLUCIONADO") g.montoPagado += parseFloat(t.monto_resuelto) || 0;
      g.tablas += parseInt(t.cantidad_tablas) || 0;
    });
    const filas = Object.values(porClave).sort((a, b) =>
      (a.fecha || "").localeCompare(b.fecha || "") ||
      String(a.grupo || "").localeCompare(String(b.grupo || "")) ||
      String(a.actor_id || "").localeCompare(String(b.actor_id || ""))
    );

    // TOTALES POR JUGADOR (cada nivel = registrar por jugador dentro de cada grupo)
    const totJugador = {};
    filas.forEach(f => {
      const jk = [f.grupo, f.jugador].join("|");
      if (!totJugador[jk]) totJugador[jk] = { grupo: f.grupo, jugador: f.jugador, montoJugado: 0, montoPagado: 0, tablas: 0 };
      totJugador[jk].montoJugado += f.montoJugado;
      totJugador[jk].montoPagado += f.montoPagado;
      totJugador[jk].tablas += f.tablas;
    });
    // y TOTALES POR GRUPO
    const totGrupo = {};
    Object.keys(totJugador).forEach(jk => {
      const j = totJugador[jk];
      if (!totGrupo[j.grupo]) totGrupo[j.grupo] = { montoJugado: 0, montoPagado: 0, tablas: 0 };
      totGrupo[j.grupo].montoJugado += j.montoJugado;
      totGrupo[j.grupo].montoPagado += j.montoPagado;
      totGrupo[j.grupo].tablas += j.tablas;
    });
    const fmt = (n) => new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2 }).format(n || 0);
    const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", """: "&quot;", "'": "&#39;"}[c]));
    let html = "";
    html += `<div class="text-xs mb-3"><strong>Tablas fijas publicadas</strong> - total venta ${fmt(data.reduce((a, t) => a + (parseFloat(t.monto_jugado) || 0), 0))}</div>`;
    html += `<table class="w-full text-left text-xs border border-slate-200 rounded-lg overflow-hidden">`;
    html += `<thead class="bg-slate-100 text-slate-600 sticky top-0"><tr>
      <th class="p-2 font-bold">Fecha</th><th class="p-2 font-bold">Grupo</th><th class="p-2 font-bold">Hipodromo</th><th class="p-2 font-bold">Carrera</th>
      <th class="p-2 font-bold">Jugador</th><th class="p-2 text-right font-bold">Monto Jugado</th><th class="p-2 text-right font-bold">Monto Pagado</th><th class="p-2 text-right font-bold">Tablas</th></tr></thead><tbody>`;
    filas.forEach(f => {
      html += `<tr class="border-t border-slate-100 hover:bg-slate-50">`;
      html += `<td class="p-2">${esc(f.fecha)}</td><td class="p-2 font-semibold">${esc(f.grupo)}</td><td class="p-2">${esc(f.hipodromo)}</td><td class="p-2">C${esc(f.carrera)}</td>`;
      html += `<td class="p-2 font-semibold">${esc(f.jugador)}</td><td class="p-2 text-right">${fmt(f.montoJugado)}</td><td class="p-2 text-right">${fmt(f.montoPagado)}</td><td class="p-2 text-right">${f.tablas}</td>`;
      html += `</tr>`;
    });
    html += `</tbody></table>`;
    // TOTALES POR JUGADOR (cada nivel)
    html += `<div class="mt-4"><p class="font-bold text-slate-700 mb-2"><i class="fas fa-user mr-1"></i> Totales por jugador (cada nivel)</p><table class="w-full text-left text-xs border border-slate-200 rounded-lg overflow-hidden"><thead class="bg-slate-100 text-slate-600"><tr><th class="p-2 font-bold">Grupo</th><th class="p-2 font-bold">Jugador</th><th class="p-2 text-right font-bold">Monto Jugado</th><th class="p-2 text-right font-bold">Monto Pagado</th><th class="p-2 text-right font-bold">Tablas</th></tr></thead><tbody>`;
    Object.keys(totJugador).sort().forEach(jk => {
      const j = totJugador[jk];
      html += `<tr class="border-t border-slate-100"><td class="p-2">${esc(j.grupo)}</td><td class="p-2">${esc(j.jugador)}</td><td class="p-2 text-right">${fmt(j.montoJugado)}</td><td class="p-2 text-right">${fmt(j.montoPagado)}</td><td class="p-2 text-right">${j.tablas}</td></tr>`;
    });
    html += `</tbody></table></div>`;
    // TOTALES POR GRUPO (nivel general)
    html += `<div class="mt-4"><p class="font-bold text-slate-700 mb-2"><i class="fas fa-layer-group mr-1"></i> Totales por grupo (nivel general)</p><table class="w-full text-left text-xs border border-slate-200 rounded-lg overflow-hidden"><thead class="bg-slate-100 text-slate-600"><tr><th class="p-2 font-bold">Grupo</th><th class="p-2 text-right font-bold">Monto Jugado</th><th class="p-2 text-right font-bold">Monto Pagado</th><th class="p-2 text-right font-bold">Tablas</th></tr></thead><tbody>`;
    Object.keys(totGrupo).sort().forEach(gk => {
      const g = totGrupo[gk];
      html += `<tr class="border-t border-slate-100"><td class="p-2 font-semibold">${esc(gk)}</td><td class="p-2 text-right">${fmt(g.montoJugado)}</td><td class="p-2 text-right">${fmt(g.montoPagado)}</td><td class="p-2 text-right">${g.tablas}</td></tr>`;
    });
    html += `</tbody></table></div>`;
    sel.innerHTML = html;
    if (clubUI?.toast) clubUI.toast("Reporte generado.", "success");
  } catch (err) {
    console.error("[reportes_tablas_fijas]", err);
    if (clubUI?.toast) clubUI.toast("Error al generar el reporte: " + (err.message || err), "error");
    sel.innerHTML = `<div class="p-10 text-center text-red-400"><i class="fas fa-exclamation-triangle mr-1"></i> Error: ${String(err?.message || err).slice(0, 120)}</div>`;
  }
}
window.clubReportes.cargarReporteTablasFijas = cargarReporteTablasFijas;

