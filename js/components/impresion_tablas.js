// ============================================================================
// IMPRESIÓN DE TABLAS FIJAS PUBLICADAS (compartido entre tablas.html y
// venta_tablas.html)
// - Muestra TODOS los caballos de cada carrera con número, precio y colores.
// - Fuente adaptativa: si una carrera tiene más de 16 ejemplares, reduce el
//   tamaño de letra para que todo quepa dentro de la tarjeta.
// - PDF real con jsPDF (no depende del diálogo "Guardar como PDF" del
//   navegador, que generaba archivos corruptos).
// - JPG/PNG con html2canvas a alta resolución.
// ============================================================================

window.clubImpresionTablas = (function () {

    // Paleta oficial de 14 colores de gualdrapa (se repite cada 14)
    const COLORES = [
        { bg: '#FF0000', fg: '#FFFFFF' },  // 1  Rojo / Blanco
        { bg: '#FFFFFF', fg: '#000000' },  // 2  Blanco / Negro
        { bg: '#0000FF', fg: '#FFFFFF' },  // 3  Azul / Blanco
        { bg: '#FFFF00', fg: '#000000' },  // 4  Amarillo / Negro
        { bg: '#008000', fg: '#FFFFFF' },  // 5  Verde / Blanco
        { bg: '#000000', fg: '#FFFF00' },  // 6  Negro / Amarillo
        { bg: '#FFA500', fg: '#000000' },  // 7  Naranja / Negro
        { bg: '#FFC0CB', fg: '#000000' },  // 8  Rosa / Negro
        { bg: '#40E0D0', fg: '#000000' },  // 9  Turquesa / Negro
        { bg: '#800080', fg: '#FFFFFF' },  // 10 Morado / Blanco
        { bg: '#808080', fg: '#FF0000' },  // 11 Gris / Rojo
        { bg: '#32CD32', fg: '#000000' },  // 12 Verde Lima / Negro
        { bg: '#8B4513', fg: '#FFFFFF' },  // 13 Marrón / Blanco
        { bg: '#800000', fg: '#FFFFFF' },  // 14 Granate / Blanco
    ];
    function colorDeNumero(n) {
        const x = parseInt(n, 10);
        if (!x) return '#94a3b8';
        return COLORES[((x - 1) % 14)].bg;
    }
    function textoDeNumero(n) {
        const x = parseInt(n, 10);
        if (!x) return '#FFFFFF';
        return COLORES[((x - 1) % 14)].fg;
    }
    const fmt = (v, d = 2) => window.clubUI?.formatoNumero
        ? window.clubUI.formatoNumero(Number(v) || 0, d)
        : (Number(v) || 0).toFixed(d);

    // Dimensiones de diseño (px). Proporción carta horizontal 11x8.5in.
    const ANCHO = 1400;
    const ALTO_HOJA = Math.round(ANCHO * 215.9 / 279.4); // ~1083px

    const ESTILOS = `
    * { box-sizing: border-box; }
    .imp-pages { position: fixed; left: -9999px; top: 0; width:${ANCHO}px; background:#fff; font-family:'Segoe UI',Arial,sans-serif; color:#0f172a; }
    .hoja { width:${ANCHO}px; height:${ALTO_HOJA}px; padding:26px 22px 22px; display:flex; flex-direction:column; gap:6px; break-after:always; page-break-after:always; background:#fff; }
    .hoja:last-child { break-after:auto; page-break-after:auto; }
    .cabecera-hoja { border-bottom:3px solid #1d4ed8; padding-bottom:6px; }
    .titulo-hoja { font-size:24px; font-weight:900; letter-spacing:1.5px; color:#1e3a8a; text-transform:uppercase; }
    .sub-hoja { font-size:12px; color:#64748b; font-weight:600; margin-top:2px; }
    .grilla-16 { flex:1; min-height:0; display:grid; grid-template-columns:repeat(4,1fr); grid-template-rows:repeat(4,1fr); gap:9px; }
    .tabla-imp { border:2px solid #334155; border-radius:10px; overflow:hidden; display:flex; flex-direction:column; background:#fff; box-shadow:0 2px 3px rgba(15,23,42,.10); min-height:0; }
    .hd-tabla { background:linear-gradient(135deg,#1e40af,#4338ca); color:#fff; display:flex; justify-content:space-between; align-items:center; padding:7px 11px; }
    .hd-hipo { font-size:14px; font-weight:900; text-transform:uppercase; letter-spacing:.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .hd-carrera { font-size:20px; font-weight:900; background:rgba(255,255,255,.18); border-radius:6px; padding:1px 9px; }
    .hd-meta { display:flex; gap:9px; font-size:10.5px; font-weight:700; color:#475569; padding:4px 11px; border-bottom:1px solid #e2e8f0; white-space:nowrap; overflow:hidden; }
    .hd-premio { display:flex; justify-content:space-between; align-items:center; font-size:11.5px; font-weight:800; color:#b45309; padding:4px 11px; background:#fffbeb; border-bottom:1px solid #f1f5f9; text-transform:uppercase; }
    .hd-premio .premio-val { font-size:17px; font-weight:900; color:#b45309; }
    .grilla-prin { flex:1; min-height:0; display:grid; align-content:start; gap:2px; padding:5px 6px; overflow:hidden; }
    .grilla-ej { display:grid; align-items:center; gap:5px; border-bottom:1px solid #f1f5f9; padding:1px 1px; }
    .grilla-ej.retirado { opacity:.40; }
    .nro-grilla { border-radius:4px; border:1px solid; display:flex; align-items:center; justify-content:center; font-weight:900; }
    .nombre-grilla { font-weight:700; text-transform:uppercase; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .valor-grilla { font-weight:800; color:#1d4ed8; text-align:right; white-space:nowrap; }
    .ft-tabla { display:flex; justify-content:space-between; align-items:center; font-size:10.5px; font-weight:800; color:#0f766e; padding:4px 11px; background:#f0fdfa; border-top:1px solid #ccfbf1; }
    .ft-total { background:#d1d5db; color:#334155; border-radius:999px; padding:0 8px; font-size:9.5px; }
    .sin-ej { grid-column:1/-1; font-size:11px; color:#94a3b8; font-style:italic; padding:12px; }
    .notas-hoja { display:flex; justify-content:space-between; gap:14px; font-size:10.5px; color:#78350f; background:#fffbeb; border:1px solid #fcd34d; border-radius:6px; padding:6px 10px; font-weight:700; }
    `;

    function limpiarValor(c) {
        const v = parseFloat(c.valor_ejemplar ?? c.valor ?? c.pts);
        return Number.isFinite(v) ? v : 0;
    }

    // Devuelve estilos inline de la tarjeta según la cantidad de ejemplares.
    // rows > 4 (más de 16 caballos) → reduce el tamaño de letra proporcionalmente.
    function tamanoTarjeta(n) {
        const cols = 4;
        const rows = Math.max(1, Math.ceil(n / cols));
        const k = rows <= 4 ? 1 : rows <= 6 ? 0.86 : rows <= 8 ? 0.74 : rows <= 10 ? 0.64 : rows <= 12 ? 0.56 : 0.48;
        return {
            cols, rows, k,
            nroW: Math.round(27 * k),
            nroH: Math.round(21 * k),
            fsNum: Math.round((13 * k) * 10) / 10,
            fsNom: Math.round((9.5 * k) * 10) / 10,
            gridCols: `repeat(${cols},1fr)`,
            rowH: `repeat(${rows}, minmax(0,1fr))`,
            box: `${Math.round(27 * k)}px ${Math.round(21 * k)}px`,
            fsVal: Math.round((10 * k) * 10) / 10,
            rowsPlantilla: rows
        };
    }

    function cardHTML(t) {
        const premio = parseFloat(t.premio_recalculado) || 0;
        const ejemplares = Array.isArray(t.caballos) ? t.caballos : [];
        const suma = ejemplares.reduce((acc, c) => acc + (c.retirado ? 0 : limpiarValor(c)), 0);
        const T = tamanoTarjeta(ejemplares.length);

        const grilla = ejemplares.map(c => {
            const bg = colorDeNumero(c.numero);
            const fg = textoDeNumero(c.numero);
            const ret = !!c.retirado;
            return `
                <div class="grilla-ej ${ret ? 'retirado' : ''}" style="grid-template-columns:${T.box} 1fr 1.6rem">
                    <div class="nro-grilla" style="background:${bg};color:${fg};border-color:${bg};width:${T.nroW}px;height:${T.nroH}px;font-size:${T.fsNum}px">${c.numero ?? ''}</div>
                    <div class="nombre-grilla" style="font-size:${T.fsNom}px">${c.nombre || ''}</div>
                    <div class="valor-grilla" style="font-size:${T.fsVal}px">${ret ? 'RET.' : fmt(limpiarValor(c), 0)}</div>
                </div>`;
        }).join('') || '<div class="sin-ej">Sin ejemplares registrados.</div>';

        return `
            <div class="tabla-imp">
                <div class="hd-tabla">
                    <div class="hd-hipo">${t.hipodromo || ''}</div>
                    <div class="hd-carrera">C${t.carrera ?? ''}</div>
                </div>
                <div class="hd-meta">
                    <span>Dist: ${t.distancia_carrera ?? ''} m</span>
                    <span>${t.superficie || 'ARENA'}</span>
                    <span>${t.fecha || ''}</span>
                </div>
                <div class="hd-premio">
                    <span>Monto a Pagar / Tabla</span>
                    <span class="premio-val">$${fmt(premio)}</span>
                </div>
                <div class="grilla-prin" style="grid-template-columns:${T.gridCols};grid-template-rows:${T.rowH}">${grilla}</div>
                <div class="ft-tabla">
                    <span>Suma: $${fmt(suma)}</span>
                    <span class="ft-total">${ejemplares.length} ej.</span>
                </div>
            </div>`;
    }

    function todoTablasHTML(tablas, paginas) {
        const fecha = new Date().toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' });
        const hojas = paginas.map((pag, pidx) => `
            <div class="hoja">
                <div class="cabecera-hoja">
                    <div class="titulo-hoja">TABLAS FIJAS PUBLICADAS</div>
                    <div class="sub-hoja">${fecha} · Hoja ${pidx + 1} de ${paginas.length} · Total ${tablas.length} carreras · última versión de valores</div>
                </div>
                <div class="grilla-16">
                    ${pag.map(cardHTML).join('')}
                </div>
                <div class="notas-hoja">
                    <span>⚠️ Monto a cobrar sujeto a ajuste por retiros de ejemplares.</span>
                    <span>⚖️ En caso de empates se divide el premio.</span>
                </div>
            </div>`).join('');

        const contenedor = document.createElement('div');
        contenedor.id = 'contenedorImagenTablas';
        contenedor.className = 'imp-pages';
        const estilos = document.createElement('style');
        estilos.innerHTML = ESTILOS;
        contenedor.appendChild(estilos);
        const envoltura = document.createElement('div');
        envoltura.innerHTML = hojas;
        contenedor.appendChild(envoltura);
        return contenedor;
    }

    async function renderCanvas(contenedor, scale) {
        if (typeof window.html2canvas !== 'function') {
            throw new Error('Falta la libreria html2canvas. Recargue la pagina.');
        }
        document.body.appendChild(contenedor);
        try {
            await new Promise(r => setTimeout(r, 150));
            if (document.fonts && document.fonts.ready) {
                try { await document.fonts.ready; } catch (e) { /* sin fuentes */ }
            }
            await new Promise(r => setTimeout(r, 60));
            const canvas = await window.html2canvas(contenedor, {
                scale: scale || 2,
                useCORS: true,
                backgroundColor: '#ffffff',
                logging: false
            });
            return canvas;
        } finally {
            contenedor.remove();
        }
    }

    async function generarPDF(canvas, nombreArchivo) {
        if (!window.jspdf || typeof window.jspdf.jsPDF !== 'function') {
            throw new Error('Falta la libreria jsPDF para generar el PDF. Recargue la pagina.');
        }
        const pdf = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' });
        const W_cm = 279.4, H_cm = 215.9;
        // Tamaño en px de cada hoja dentro del canvas (scale aplicado al render).
        const esc = canvas.width / ANCHO;
        const hHojaPx = Math.round(ALTO_HOJA * esc);
        const numHojas = Math.max(1, Math.round(canvas.height / hHojaPx));
        const imagenPorHoja = numHojas <= 1 ? canvas : null;

        if (imagenPorHoja) {
            pdf.addImage(imagenPorHoja.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, W_cm, H_cm);
        } else {
            const aux = document.createElement('canvas');
            aux.width = canvas.width;
            aux.height = hHojaPx;
            const ctx = aux.getContext('2d');
            for (let i = 0; i < numHojas; i++) {
                if (i > 0) pdf.addPage();
                const sy = Math.min(i * hHojaPx, canvas.height - hHojaPx);
                ctx.clearRect(0, 0, aux.width, aux.height);
                ctx.drawImage(canvas, 0, sy, canvas.width, hHojaPx, 0, 0, aux.width, hHojaPx);
                pdf.addImage(aux.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, W_cm, H_cm);
            }
        }
        pdf.save(nombreArchivo);
    }

    async function imprimirTablasPublicadas(hipoFiltro = '', diaFiltro = '', formato = 'pdf') {
        // SIEMPRE recarga la última versión de valores desde Supabase (sin caché)
        let tablas = [];
        try {
            const r = await window.supabase
                .from('tablas_fijas')
                .select('*, tabla_grupos(*)')
                .eq('estado', 'Abierta');
            if (r.error) throw r.error;
            tablas = r.data || [];
        } catch (e) {
            window.clubUI?.toast('No se pudieron actualizar los valores: ' + (e.message || e), 'error');
            return null;
        }

        if (hipoFiltro) {
            tablas = tablas.filter(t => String(t.hipodromo || '').trim().toLowerCase() === String(hipoFiltro).trim().toLowerCase());
        }
        if (diaFiltro) {
            tablas = tablas.filter(t => String(t.fecha || '').slice(0, 10) === String(diaFiltro).slice(0, 10));
        }
        if (tablas.length === 0) {
            window.clubUI?.toast('No hay tablas publicadas para imprimir (estado "Abierta").', 'warning');
            return null;
        }
        tablas.sort((a, b) => String(a.hipodromo || '').localeCompare(String(b.hipodromo || '')) || (Number(a.carrera) || 0) - (Number(b.carrera) || 0));

        const POR_HOJA = 16;
        const paginas = [];
        for (let i = 0; i < tablas.length; i += POR_HOJA) paginas.push(tablas.slice(i, i + POR_HOJA));

        const contenedor = todoTablasHTML(tablas, paginas);
        const prefijo = `tablas_fijas_${(diaFiltro || 'todas')}_${Date.now()}`;

        const esPDF = String(formato).toLowerCase() === 'pdf';
        const scale = esPDF ? 2.5 : 2;

        if (!esPDF) {
            // Formato imagen (JPG/PNG): html2canvas sobre un contenedor oculto.
            try {
                const canvas = await renderCanvas(contenedor, scale);
                const url = canvas.toDataURL(String(formato).toLowerCase() === 'png' ? 'image/png' : 'image/jpeg', String(formato).toLowerCase() === 'png' ? undefined : 0.94);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${prefijo}.${String(formato).toLowerCase()}`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.clubUI?.toast(`Imagen ${String(formato).toUpperCase()} generada correctamente.`, 'success');
                return true;
            } catch (err) {
                window.clubUI?.toast('Error generando la imagen: ' + (err.message || err), 'error');
                return null;
            }
        }

        // Formato PDF: jsPDF real (archivo válido, no depende del diálogo del navegador).
        try {
            const canvas = await renderCanvas(contenedor, scale);
            await generarPDF(canvas, `${prefijo}.pdf`);
            window.clubUI?.toast('PDF generado correctamente.', 'success');
            return true;
        } catch (err) {
            window.clubUI?.toast('Error generando el PDF: ' + (err.message || err), 'error');
            return null;
        }
    }

    return { imprimirTablasPublicadas };
})();