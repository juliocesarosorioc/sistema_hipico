/**
 * HOJA DE MARCAS — HTML imprimible + texto de WhatsApp.
 *
 * Genera las mismas columnas que la tabla resumen de PanelMarcas (Carrera,
 * Marca, NV, No valen, Deb.) en hojas A4 de 1240×1754 px @150dpi con la clase
 * `.im-pagina`, que es la que `exportarPaginas` captura a PNG / JPG / PDF
 * (misma cadena que la matriz de Tablas Fijas).
 *
 * Todo el CSS viaja DENTRO del HTML de exportación (como MATRIZ_CSS en
 * ConfigImpresionModal): así la captura de html2canvas no depende de que el
 * Tailwind del módulo esté cargado, y el `line-height` va siempre en `em` (nunca
 * en número suelto) para que las letras no salgan cortadas.
 */
import { getHorseColor } from "@/lib/horseColors";
import { CLUB_NOMBRE, fechaHoy, plantillaPorId, reemplazarVarsTablas, waLink } from "@/lib/whatsapp";

export type FilaMarcas = {
  carrera: number | string;
  marcas: string[];
  nv: string[];
  deb: string[];
  /** Los debutantes cuentan (true) o no valen (false) en esta carrera. */
  debValen: boolean;
  estado: string;
  /** Motivo del problema de configuración, si lo hay. */
  problema?: string;
};

export type BloqueMarcas = { hipodromo: string; carreras: FilaMarcas[] };

/** Filas por hoja A4 vertical: con encabezados de hipódromo y el pie, 42 es
 *  lo que entra sin apretar ni dejar media hoja en blanco. */
const FILAS_POR_PAGINA = 42;

const esc = (v: unknown): string =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Pastilla numerada con el color oficial de la gualdrapa. */
function chip(n: string, extra = ""): string {
  const c = getHorseColor(parseInt(String(n), 10));
  return `<span class="mk-n" style="background:${c.hex};color:${c.hexText}">${esc(n)}</span>${extra}`;
}

function chips(lista: string[]): string {
  if (!lista.length) return `<i class="mk-vacio">—</i>`;
  return lista.map((n) => chip(n)).join("");
}

function filaHTML(f: FilaMarcas): string {
  const deb = f.deb.length
    ? f.debValen
      ? `<span class="mk-ok">VALEN</span> <span class="mk-deb">${esc(f.deb.join(" "))}</span>`
      : `<span class="mk-no">NV DEB.</span> <span class="mk-deb">${esc(f.deb.join(" "))}</span>`
    : `<i class="mk-vacio">—</i>`;
  return (
    `<tr>` +
    `<td class="mk-c">${esc(f.carrera)}${f.problema ? `<b class="mk-aviso" title="${esc(f.problema)}">!</b>` : ""}</td>` +
    `<td>${chips(f.marcas)}</td>` +
    `<td>${f.nv.length ? chips(f.nv) : `<i class="mk-vacio">—</i>`}</td>` +
    `<td>${deb}</td>` +
    `<td class="mk-e">${f.estado ? esc(f.estado) : `<i class="mk-vacio">—</i>`}</td>` +
    `</tr>`
  );
}

function bloqueHTML(hipo: string, filas: FilaMarcas[]): string {
  const conMarcas = filas.filter((f) => f.marcas.length).length;
  return (
    `<div class="mk-blq"><span>🏟 ${esc(hipo)}</span>` +
    `<span>${filas.length} carrera${filas.length === 1 ? "" : "s"} · ${conMarcas} con marcas</span></div>` +
    `<table class="mk-t"><thead><tr>` +
    `<th>Carrera</th><th>Marca</th><th>NV</th><th>No valen</th><th>Deb. / Estado</th>` +
    `</tr></thead><tbody>${filas.map(filaHTML).join("")}</tbody></table>`
  );
}

/**
 * CSS de la hoja. Se inyecta junto al HTML de exportación (fuera de pantalla),
 * igual que MATRIZ_CSS. OJO: usa el nombre de clase `.im-pagina` porque es el
 * selector que busca `exportarPaginas`; el layout es propio de esta hoja.
 */
export const MARCAS_CSS = `
.mk-pagina{box-sizing:border-box;width:1240px;height:1754px;display:flex;flex-direction:column;
  background:#fff;padding:34px 38px 26px;overflow:hidden;font-family:Inter,system-ui,Arial,sans-serif;color:#0f172a;}
.mk-h{display:flex;align-items:baseline;justify-content:space-between;gap:10px;
  border-bottom:3px solid #f59e0b;padding-bottom:8px;margin-bottom:14px;}
.mk-h b{font-size:26px;font-weight:900;letter-spacing:.5px;text-transform:uppercase;color:#0f172a;}
.mk-h span{font-size:15px;font-weight:800;color:#475569;text-transform:uppercase;}
.mk-blq{display:flex;align-items:center;justify-content:space-between;gap:8px;
  background:#f59e0b;color:#fff;border-radius:6px 6px 0 0;padding:5px 10px;margin:14px 0 0;}
.mk-blq span:first-child{font-size:15px;font-weight:900;text-transform:uppercase;letter-spacing:.5px;}
.mk-blq span:last-child{font-size:12px;font-weight:700;opacity:.95;}
.mk-t{width:100%;border-collapse:collapse;table-layout:fixed;}
.mk-t th{background:#fff2d9;color:#92400e;font-size:12px;font-weight:900;text-transform:uppercase;
  letter-spacing:.6px;text-align:left;padding:5px 8px;border-bottom:1px solid #e2e8f0;}
.mk-t th:first-child{width:96px;}
.mk-t th:nth-child(2){width:auto;}
.mk-t th:nth-child(3){width:150px;}
.mk-t th:nth-child(4){width:190px;}
.mk-t th:nth-child(5){width:190px;}
.mk-t td{font-size:16px;font-weight:700;padding:5px 8px;border-bottom:1px solid #e2e8f0;
  line-height:1.45em;vertical-align:middle;}
.mk-t tr:nth-child(even) td{background:#f8fafc;}
.mk-c{font-size:19px;font-weight:900;font-variant-numeric:tabular-nums;text-align:center;}
.mk-e{font-size:13px !important;font-weight:800;text-transform:uppercase;color:#047857;}
.mk-n{display:inline-flex;align-items:center;justify-content:center;min-width:26px;height:24px;
  padding:0 5px;margin-right:3px;border:1px solid rgba(15,23,42,.25);border-radius:4px;
  font-size:15px;font-weight:900;font-variant-numeric:tabular-nums;line-height:1.4em;overflow:visible;}
.mk-ok{display:inline-block;background:#d1fae5;color:#047857;border-radius:4px;padding:1px 5px;
  font-size:12px;font-weight:900;margin-right:4px;}
.mk-no{display:inline-block;background:#fee2e2;color:#b91c1c;border-radius:4px;padding:1px 5px;
  font-size:12px;font-weight:900;margin-right:4px;}
.mk-deb{font-size:13px;font-weight:800;color:#6d28d9;}
.mk-vacio{color:#94a3b8;font-style:normal;font-weight:700;}
.mk-aviso{color:#d97706;font-size:15px;margin-left:2px;}
.mk-pie{margin-top:auto;padding-top:10px;border-top:1px solid #e2e8f0;display:flex;
  justify-content:space-between;font-size:12px;font-weight:700;color:#94a3b8;text-transform:uppercase;}
`;

type Pagina = { hipo: string | null; filas: FilaMarcas[] };

/** Reparte los bloques en páginas de a FILAS_POR_PAGINA filas, sin cortar un
 *  hipódromo en dos salvo que pase el tope. */
function paginar(bloques: BloqueMarcas[]): Pagina[] {
  const paginas: Pagina[] = [];
  let actual: Pagina = { hipo: null, filas: [] };
  const cerrar = () => {
    if (actual.filas.length) paginas.push(actual);
    actual = { hipo: null, filas: [] };
  };
  for (const b of bloques) {
    if (!b.carreras.length) continue;
    for (const f of b.carreras) {
      if (actual.filas.length >= FILAS_POR_PAGINA) cerrar();
      // Cambia de hipódromo: se cierra la página para que el rótulo no quede
      // huérfano arriba de filas de otro cuadro.
      if (actual.filas.length && actual.hipo !== b.hipodromo) cerrar();
      actual.hipo = b.hipodromo;
      actual.filas.push(f);
    }
  }
  cerrar();
  return paginas;
}

/**
 * HTML de las hojas de marcas. Devuelve el string completo (CSS + páginas)
 * listo para `dangerouslySetInnerHTML` sobre la raíz de exportación.
 */
export function paginasMarcasHTML(
  bloques: BloqueMarcas[],
  meta: { fecha: string; filtro?: string }
): string {
  const paginas = paginar(bloques);
  if (!paginas.length) return "";
  const titulo = `MARCAS DEL DÍA`;
  const sub = [meta.fecha, meta.filtro ? meta.filtro : ""].filter(Boolean).join(" · ");
  const cuerpo = paginas
    .map((p, i) => {
      // Cada página lleva UN solo hipódromo: `paginar` la cierra justo donde
      // cambia el rótulo, así el cuadro nunca queda cortado a la mitad.
      return (
        `<div class="im-pagina mk-pagina">` +
        `<div class="mk-h"><b>${titulo}</b><span>${esc(sub)}</span></div>` +
        bloqueHTML(p.hipo ?? "SIN HIPODROMO", p.filas) +
        `<div class="mk-pie"><span>${esc(CLUB_NOMBRE)}</span>` +
        `<span>Página ${i + 1} de ${paginas.length}</span></div>` +
        `</div>`
      );
    })
    .join("");
  return `<style>${MARCAS_CSS}</style>${cuerpo}`;
}

/** Una línea de texto por carrera, para el mensaje de WhatsApp. */
function lineasWhatsApp(bloques: BloqueMarcas[]): string {
  const out: string[] = [];
  for (const b of bloques) {
    if (!b.carreras.length) continue;
    out.push(`🏟 *${b.hipodromo}*`);
    for (const f of b.carreras) {
      const partes = [`C${f.carrera} · MARCAS ${f.marcas.length ? f.marcas.join(" ") : "—"}`];
      if (f.nv.length) partes.push(`NV ${f.nv.join(" ")}`);
      if (f.deb.length) partes.push(`DEB ${f.deb.join(" ")}${f.debValen ? "" : " (NO VALEN)"}`);
      out.push(partes.join(" · "));
    }
    out.push("");
  }
  return out.join("\n").trim();
}

/**
 * Texto WhatsApp de la hoja de marcas, con la plantilla editable
 * `marcas_hoja` del Centro de WhatsApp ({fecha} {hipodromo} {lineas} {totales}).
 * Abre wa.me y devuelve el texto (mismo contrato que textoWhatsAppMatriz).
 */
export function textoWhatsAppMarcas(
  bloques: BloqueMarcas[],
  fecha: string,
  telefono = "584141234567"
): string {
  const conMarcas = bloques.reduce((a, b) => a + b.carreras.filter((f) => f.marcas.length).length, 0);
  const totales = String(bloques.reduce((a, b) => a + b.carreras.length, 0));
  const lineas = lineasWhatsApp(bloques);
  let plantilla = plantillaPorId("marcas_hoja");
  if (!plantilla.trim()) {
    plantilla =
      "🏇 *MARCAS DEL DÍA* 📅 {fecha}\n\n{lineas}\n\n🧮 *CARRERAS:* {totales} · CON MARCAS: {marcas}\n\n📌 Válidas solo para el día indicado. Presente en caja.";
  }
  const texto = reemplazarVarsTablas(plantilla, {
    fecha: fecha || fechaHoy(),
    hipodromo: bloques.map((b) => b.hipodromo).filter(Boolean).join(" · "),
    lineas,
    totales,
    marcas: String(conMarcas),
  });
  window.open(waLink(telefono, texto), "_blank");
  return texto;
}

/** Resumen corto (una línea) del bloque, para toasts y encabezados. */
export function resumenMarcas(bloques: BloqueMarcas[]): { carreras: number; conMarcas: number } {
  return bloques.reduce(
    (a, b) => ({
      carreras: a.carreras + b.carreras.length,
      conMarcas: a.conMarcas + b.carreras.filter((f) => f.marcas.length).length,
    }),
    { carreras: 0, conMarcas: 0 }
  );
}
