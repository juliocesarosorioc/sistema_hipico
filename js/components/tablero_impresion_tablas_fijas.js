// ============================================================
// TABLERO IMPRESION - TABLAS FIJAS PUBLICADAS (15 por hoja)
// Paleta REAL de 14 colores por numero de gualdrapa
// (misma del ensamblaje - venta_tablas_core.js)
// NO toca monolitos: archivo nuevo autocon+tenido.
window.clubTableroImpresion = window.clubTableroImpresion || {};

const PALETA14 = [
  { bg: "#e11d48", fg: "#ffffff" }, { bg: "#ffffff", fg: "#111827" },
  { bg: "#1d4ed8", fg: "#ffffff" }, { bg: "#facc15", fg: "#111827" },
  { bg: "#16a34a", fg: "#ffffff" }, { bg: "#111827", fg: "#facc15" },
  { bg: "#f97316", fg: "#111827" }, { bg: "#fbcfe8", fg: "#111827" },
  { bg: "#22d3ee", fg: "#111827" }, { bg: "#7c3aed", fg: "#ffffff" },
  { bg: "#9ca3af", fg: "#dc2626" }, { bg: "#84cc16", fg: "#111827" },
  { bg: "#92400e", fg: "#ffffff" }, { bg: "#7f1d1d", fg: "#ffffff" },
];

function colorNum(n) {
  const i = (parseInt(n, 10) - 1) % 14;
  return PALETA14[i >= 0 ? i : 0];
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function fmt(n) {
  const v = parseFloat(n) || 0;
  return v.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseCaballos(t) {
  const raw = t && t.caballos;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) {
    try { const a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  return [];
}

function fechaDia(t) {
  const d = t && (t.fecha || t.dia || t.created_at || "");
  if (!d) return "-";
  const s = String(d).slice(0, 10);
  const p = s.split("-");
  return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : s;
}

function tarjetaTabla(t, idx) {
  const cabs = parseCaballos(t);
  const totalValor = cabs.reduce((a, c) => a + (parseFloat(c.valor) || 0), 0);
  let ej = `<div class="tt-grid">`;
  cabs.slice(0, 20).forEach(c => {
    const col = colorNum(c.numero);
    ej += `<div class="tt-ej" style="background:${col.bg};color:${col.fg}">` +
      `<div class="tt-num">${esc(c.numero)}</div>` +
      `</div><div class="tt-cab">${esc(c.nombre || "")}</div>`;
  });
  ej += `</div>`;
  const montoPagar = (parseFloat(t.premio_recalculado) || parseFloat(t.premio) || 0);
  return `<div class="tt-tarjeta">` +
    `<div class="tt-cab1">${esc(t.hipodromo || "")} - CARRERA ${esc(t.carrera ?? "")}</div>` +
    `<div class="tt-fecha">${fechaDia(t)}</div>` +
    `<div class="tt-pagar">MONTO A PAGAR: ${fmt(montoPagar)}</div>` +
    ej +
    `<div class="tt-valor">VALOR: ${fmt(totalValor)}</div>` +
    `</div>`;
}

function renderTablero(tablas) {
  let h = `<div class="tt-hoja">`;
  tablas.forEach((t, i) => { h += tarjetaTabla(t, i); });
  h += `</div>`;
  h += `
<div class="tt-normas">` +
    `NORMAS TABLAS FIJAS:<br>` +
    `1) Las tablas fijas son apuestas cerradas con el hipodromo y carrera publicados.<br>` +
    `2) El premio es el monto recalculado oficial del programa del dia.<br>` +
    `3) En caso de retiros o empates se ajusta segun reglamento del hipodromo.<br>` +
    `4) La tabla es valida solo si el ganador corresponde al numero y color publicado.<br>` +
    `5) Presente este documento para el cobro del premio.` +
    `</div>`;
  return `<div class="tt-pagina" id="tableroImpresionListo">${h}</div>`
    + `<style id="tt-estilos">` +
    `.tt-pagina{background:#fff;padding:6mm;font-family:system-ui,-apple-system,sans-serif;color:#111}` +
    `.tt-hoja{display:grid;grid-template-columns:repeat(5,1fr);grid-auto-rows:auto;gap:3mm;}` +
    `.tt-tarjeta{border:0.4mm solid #334155;border-radius:1.5mm;padding:1.5mm;height:38mm;overflow:hidden;display:flex;flex-direction:column;}` +
    `.tt-cab1{font-weight:800;font-size:3.5mm;text-transform:uppercase;letter-spacing:0.2mm;line-height:1.1;}` +
    `.tt-fecha{font-size:2.6mm;color:#475569;margin-top:0.6mm;}` +
    `.tt-pagar{font-weight:700;font-size:3mm;color:#047857;margin-top:0.8mm;}` +
    `.tt-grid{display:grid;grid-template-columns:7mm 1fr;gap:0.5mm;margin-top:1mm;flex:1;align-content:start;}` +
    `.tt-ej{border-radius:1mm;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:3mm;width:7mm;height:6mm;}` +
    `.tt-num{line-height:1;}` +
    `.tt-cab{font-size:2.4mm;line-height:1.05;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;align-self:center;}` +
    `.tt-valor{font-weight:700;font-size:2.8mm;margin-top:auto;text-align:right;}` +
    `.tt-normas{font-size:2mm;color:#334155;margin-top:2mm;border-top:0.3mm solid #cbd5e1;padding-top:1mm;line-height:1.4;}` +
    `</style>`;
}

clubTableroImpresion.renderTablero = renderTablero;
clubTableroImpresion.tarjetaTabla = tarjetaTabla;

clubTableroImpresion.imprimir = async function (tablas, formato) {
  if (!tablas || !tablas.length) {
    if (window.clubUI?.toast) window.clubUI.toast("No hay tablas publicadas para imprimir.", "warning");
    return;
  }
  const cont = document.getElementById("zonaImpresionTablas");
  const pop = cont || document.createElement("div");
  if (!cont) { pop.id = "zonaImpresionTablas"; pop.style.position = "absolute"; pop.style.left = "-9999px"; document.body.appendChild(pop); }
  pop.innerHTML = renderTablero(tablas);
  const node = document.getElementById("tableroImpresionListo");
  let ready = true;
  ["#e11d48", "#ffffff", "#1d4ed8", "#facc15", "#16a34a", "#111827"].forEach(c => {
    if (!/background:#?w{3,6}/i.test(c) && false) ready = false;
  });
  if (!node || !ready) ready = false;
  if (window.clubImpresion && window.clubImpresion.generarArchivo) {
    try {
      const base = window.clubImpresion.generarArchivo(pop, { formato: formato || "PDF" });
      if (base && typeof base.then === "function") {
        await base;
        if (window.clubUI?.toast) window.clubUI.toast("Tablero exportado (" + (formato || "PDF") + ").", "success");
        return;
      }
    } catch (e) {
      console.error("[tablero] fallo export:", e);
    }
  }
  window.print();
};

clubTableroImpresion.cargarPublicadas = async function () {
  const r = await window.supabase
    .from("tablas_fijas")
    .select("id, hipodromo, carrera, fecha, dia, created_at, caballos, premio, premio_recalculado, estado")
    .or("estado.eq.Publicada,estado.eq.Abierta")
    .order("created_at");
  const rows = (r && r.data) || [];
  if (!rows.length && window.clubUI?.toast) {
    window.clubUI.toast("Sin tablas FIJAS publicadas en el momento.", "warning");
  }
  return rows;
};

clubTableroImpresion.generar = async function (tablasRaw, formato) {
  const tablas = Array.isArray(tablasRaw) && tablasRaw.length
    ? tablasRaw
    : await clubTableroImpresion.cargarPublicadas();
  await clubTableroImpresion.imprimir(tablas, formato || "PDF");
};
