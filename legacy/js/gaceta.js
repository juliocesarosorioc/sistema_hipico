// ============================================================
//  gaceta.js — Interfaz (UI) del módulo Gaceta del Día.
//  Depende de la segmentación:
//    - js/gaceta_helpers.js  (window.clubGacetaHelpers)
//    - js/gaceta_ia.js       (window.clubGacetaIA)
//    - js/gaceta_padron.js   (window.clubGacetaPadron)
//  Esta capa solo maneja DOM, estado visual y flujo del operador.
// ============================================================
document.addEventListener('DOMContentLoaded', () => {

    const H = window.clubGacetaHelpers;
    const IA = window.clubGacetaIA;
    const PAD = window.clubGacetaPadron;

    const zonaDrop = document.getElementById('zonaDrop');
    const inputArchivo = document.getElementById('archivoGaceta');
    const btnTransformar = document.getElementById('btnTransformar');
    const btnGuardarClave = document.getElementById('btnGuardarClave');
    const claveOpenAI = document.getElementById('claveOpenAI');
    const estadoIA = document.getElementById('estadoIA');
    const maxPaginas = document.getElementById('maxPaginas');
    const miniaturas = document.getElementById('miniaturas');
    const lblSeleccionPaginas = document.getElementById('lblSeleccionPaginas');
    const previewGaceta = document.getElementById('previewGaceta');
    const resultadoGaceta = document.getElementById('resultadoGaceta');
    const carrerasGaceta = document.getElementById('carrerasGaceta');

    const CLAVE_KEY = 'club_gemini_key';
    const SUPERFICIES = H.SUPERFICIES;
    const FLAGS = H.FLAGS;

    let estado = { imagenes: [], paginas: [], carreras: [] };

    // ---------- TRAMPA DE ERRORES VISIBLES ----------
    // Cualquier error (aunque venga de una librería o de la red) se muestra en
    // la caja de estado/diagnóstico para que el operador NO vea un "error que
    // no conoce": siempre aparece el mensaje técnico en pantalla.
    function mostrarErrorVisible(msg) {
        try {
            const ue = document.getElementById('estadoIA');
            const diagEl = document.getElementById('diagGaceta');
            if (ue) ue.textContent = '⚠ ' + msg;
            if (diagEl) {
                diagEl.classList.remove('hidden');
                diagEl.textContent = 'ERROR: ' + msg;
            }
            console.error('[gaceta]', msg);
        } catch (e) { console.error('[gaceta] error oculto:', e, msg); }
    }
    window.addEventListener('error', (e) => mostrarErrorVisible((e.message || 'error') + ' (línea ' + e.lineno + ')'));
    window.addEventListener('unhandledrejection', (e) => mostrarErrorVisible('Promesa no controlada: ' + ((e.reason && e.reason.message) || e.reason)));

    function aNum(v) { return H.aNum(v); }

    // ---------- CLAVE ----------
    const guadarClaveAnt = localStorage.getItem(CLAVE_KEY) || '';
    if (guadarClaveAnt) claveOpenAI.value = guadarClaveAnt;

    btnGuardarClave.addEventListener('click', () => {
        const k = claveOpenAI.value.trim();
        if (!k) return clubUI.toast('Escriba una clave de Gemini.', 'warning');
        localStorage.setItem(CLAVE_KEY, k);
        clubUI.toast('Clave guardada en este navegador.', 'success');
        validarHabilitacion();
    });

    claveOpenAI.addEventListener('input', () => { localStorage.removeItem(CLAVE_KEY); validarHabilitacion(); });

    // Prueba rápida de la clave: valida en segundos si el problema es la clave,
    // la conexión o el PDF (sin gastar cuota en una extracción completa).
    document.getElementById('btnProbarClave')?.addEventListener('click', async () => {
        const k = claveOpenAI.value.trim();
        const diagEl = document.getElementById('diagGaceta');
        if (!k) return clubUI.toast('Escriba primero la clave.', 'warning');
        const btn = document.getElementById('btnProbarClave');
        btn.disabled = true;
        try {
            const lista = await IA.listaModelosFlash(k);
            if (!lista.length) {
                if (diagEl) { diagEl.classList.remove('hidden'); diagEl.textContent = 'clave: NO VÁLIDA o sin conexión (Google no devolvió modelos). Revisa la clave en aistudio.google.com/apikey.'; }
                clubUI.toast('La clave no responde. Revísala en aistudio.google.com/apikey.', 'error');
                btn.disabled = false;
                return;
            }
            let ok = false, detalle = '', codigo = 0, modeloOK = '';
            const saturados = [];
            const candidatos = lista.slice(0, 6);
            for (const m of candidatos) {
                try {
                    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': k },
                        body: JSON.stringify({ contents: [{ parts: [{ text: 'Responde solo con: OK' }] }] })
                    });
                    codigo = r.status;
                    if (r.ok) {
                        ok = true; modeloOK = m;
                        detalle = String((await r.json()).candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '').slice(0, 40);
                        break;
                    }
                    const txt = (await r.text()).slice(0, 160);
                    if (r.status === 503 || r.status === 404) { saturados.push(m + ':' + r.status); continue; }
                    detalle = `HTTP ${r.status}: ${txt}`; break;
                } catch (ePrueba) { detalle = ePrueba.message || 'red'; break; }
            }
            const todoSaturado = !ok && saturados.length === candidatos.length;
            if (diagEl) {
                diagEl.classList.remove('hidden');
                diagEl.textContent = `clave: ${ok ? 'VÁLIDA (responde ' + modeloOK + ')' : (todoSaturado ? 'VÁLIDA, pero Google saturado' : 'PROBLEMA')}\n` +
                    `modelos flash: ${lista.slice(0, 6).join(', ')}${lista.length > 6 ? '…' : ''}\n` +
                    `prueba mínima: ${ok ? 'OK (' + detalle + ')' : (todoSaturado ? 'todos saturados (503): ' + saturados.slice(0, 3).join(', ') + '… espera unos minutos y reintenta' : detalle)}`;
            }
            clubUI.toast(
                ok ? `Clave válida y conexión OK (responde ${modeloOK}). Si la extracción falla, es el PDF o saturación temporal.`
                    : (todoSaturado ? 'Tu clave es válida, pero Google está saturado ahora. Espera unos minutos y reintenta.' : `La prueba falló: ${detalle || ('HTTP ' + codigo)}.`),
                ok ? 'success' : (todoSaturado ? 'warning' : 'error'));
        } catch (e) {
            clubUI.toast('Sin conexión con Google IA: ' + (e.message || 'red'), 'error');
        }
        btn.disabled = false;
    });

    // ---------- PDF.JS ----------
    // pdf.js puede quedar bloqueado por el Edge (Tracking Prevention).
    // Si no está, se intenta cargar desde CDNs alternativos antes de usarlo.
    const PDFJS_URLS = [
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
        'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js'
    ];

    function inyectarScript(url) {
        return new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = url;
            s.onload = () => res(true);
            s.onerror = () => rej(new Error('no carga ' + url));
            document.head.appendChild(s);
        });
    }

    async function asegurarPdfJS() {
        if (typeof window.pdfjsLib !== 'undefined') return true;
        for (const u of PDFJS_URLS) {
            try { await inyectarScript(u); } catch (e) { console.warn(e.message); }
            if (typeof window.pdfjsLib !== 'undefined') break;
        }
        return typeof window.pdfjsLib !== 'undefined';
    }

    if (typeof window.pdfjsLib !== 'undefined') {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    }

    // Limpieza de claves antiguas (OpenAI quedó en desuso: ahora se usa Gemini gratis)
    if (localStorage.getItem('club_openai_key')) {
        localStorage.removeItem('club_openai_key');
        console.info('Clave OpenAI antigua eliminada del navegador.');
    }

    // ---------- CARGA DE ARCHIVO ----------
    zonaDrop.addEventListener('click', () => inputArchivo.click());
    inputArchivo.addEventListener('change', (e) => { if (e.target.files[0]) leerArchivo(e.target.files[0]); });
    ['dragover', 'drop'].forEach(ev => zonaDrop.addEventListener(ev, (e) => {
        e.preventDefault();
        if (ev === 'dragover') zonaDrop.classList.add('border-cyan-500', 'bg-cyan-50');
        else { zonaDrop.classList.remove('border-cyan-500', 'bg-cyan-50'); if (e.dataTransfer.files[0]) leerArchivo(e.dataTransfer.files[0]); }
    }));

    async function leerArchivo(file) {
        estado.imagenes = [];
        miniminiaturas();
        estadoIA.textContent = 'Procesando archivo...';
        window.clubIndicador?.accion('Leyendo el programa (PDF/imagen)…');
        try {
            if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
                if (!(await asegurarPdfJS())) {
                    estadoIA.textContent = 'No se pudo cargar el lector de PDF (bloqueado por tu navegador). Pruebe con una imagen (foto/captura del programa).';
                    return clubUI.toast('Permita cdn.jsdelivr.net/cdnjs en el bloqueo de rastreadores de Edge, o suba el programa como imagen.', 'error');
                }
                const buf = await file.arrayBuffer();
                const pdf = await window.pdfjsLib.getDocument({ data: buf, disableWorker: true }).promise;
                const capPaginas = parseInt(maxPaginas.value, 10);
                const paginas = (capPaginas > 0 ? Math.min(capPaginas, pdf.numPages) : pdf.numPages);
                for (let i = 1; i <= paginas; i++) {
                    const page = await pdf.getPage(i);
                    const vp = page.getViewport({ scale: 1.5 });
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.min(vp.width, 1500);
                    canvas.height = Math.round(canvas.width * (vp.height / vp.width));
                    const ctx = canvas.getContext('2d');
                    await page.render({ canvasContext: ctx, viewport: vp }).promise;
                    estado.paginas.push({ num: i, durl: canvas.toDataURL('image/jpeg', 0.6), incluida: true });
                    window.clubIndicador?.progreso(i / paginas)
                }
                estadoIA.textContent = `PDF: ${paginas} página(s) listas.`;
            } else {
                const durl = await H.dataURLImagen(file);
                estado.paginas.push({ num: 1, durl, incluida: true });
                estadoIA.textContent = 'Imagen lista.';
            }
            actualizarSeleccion();
            previewGaceta.classList.remove('hidden');
        } catch (e) {
            console.error(e);
            estadoIA.textContent = 'No se pudo leer el archivo. (¿PDF? ¿Imagen?).';
            clubUI.toast('No se pudo leer el archivo.', 'error');
        }
        window.clubIndicador?.fin();
        validarHabilitacion();
    }

    function renderMiniaturas() {
        miniaturas.innerHTML = '';
        estado.paginas.forEach(p => {
            const div = document.createElement('div');
            div.className = `relative group rounded border-2 p-0.5 cursor-pointer transition-all ${p.incluida ? 'border-emerald-400 hover:border-emerald-500' : 'border-slate-200 opacity-40 hover:opacity-70'}`;
            div.dataset.num = p.num;
            div.innerHTML = `
                <span class="absolute top-0.5 left-0.5 z-10 bg-slate-900 text-white text-[9px] font-bold px-1 rounded">${p.num}</span>
                <span class="absolute top-0.5 right-0.5 z-10 bg-cyan-600 text-white rounded-full text-[9px] w-5 h-5 flex items-center justify-center shadow" data-lupa="${p.num}" title="Ver la página en grande"><i class="fas fa-search"></i></span>
                <img src="${p.durl}" class="rounded h-16 object-cover w-full pointer-events-none">
                <span class="absolute bottom-0.5 right-0.5 w-4 h-4 rounded-full ${p.incluida ? 'bg-emerald-500' : 'bg-white border border-slate-300'} text-[9px] flex items-center justify-center z-10 pointer-events-none">
                    <i class="fas ${p.incluida ? 'fa-check text-white' : 'fa-circle text-slate-300'}"></i>
                </span>`;
            miniaturas.appendChild(div);
        });
    }

    function actualizarSeleccion() {
        estado.imagenes = estado.paginas.filter(p => p.incluida).map(p => p.durl);
        lblSeleccionPaginas.textContent = `Enviar ${estado.imagenes.length} de ${estado.paginas.length} página(s)`;
        renderMiniaturas();
        validarHabilitacion();
    }

    function miniminiaturas() {
        miniaturas.innerHTML = '';
        previewGaceta.classList.add('hidden');
        estado.paginas = [];
        if (lblSeleccionPaginas) lblSeleccionPaginas.textContent = '';
    }

    miniaturas.addEventListener('click', (e) => {
        const lupa = e.target.closest('[data-lupa]');
        if (lupa) {
            const idx = estado.paginas.findIndex(x => x.num == lupa.dataset.lupa);
            if (idx >= 0) abrirVistaPrevia(idx);
            return;
        }
        const t = e.target.closest('[data-num]');
        if (!t) return;
        const p = estado.paginas.find(x => x.num == t.dataset.num);
        if (p) {
            p.incluida = !p.incluida;
            actualizarSeleccion();
        }
    });

    // Vista previa de una página de la gaceta en grande
    let vistaActualPrevia = -1;
    const modalVistaPrevia = document.getElementById('modalVistaPrevia');
    const imgVistaPrevia = document.getElementById('imgVistaPrevia');
    const lblVistaPrevia = document.getElementById('lblVistaPrevia');

    function pintarVistaPrevia() {
        const p = estado.paginas[vistaActualPrevia];
        if (!p || !imgVistaPrevia) return;
        imgVistaPrevia.src = p.durl;
        lblVistaPrevia.textContent = `Página ${p.num} de ${estado.paginas.length}`;
    }

    function abrirVistaPrevia(idx) {
        vistaActualPrevia = idx;
        modalVistaPrevia.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        pintarVistaPrevia();
    }

    function cerrarVistaPrevia() {
        modalVistaPrevia.classList.add('hidden');
        document.body.style.overflow = '';
    }

    document.getElementById('btnCerrarVista').addEventListener('click', cerrarVistaPrevia);
    document.getElementById('btnPrevVista').addEventListener('click', () => {
        if (estado.paginas.length) abrirVistaPrevia((vistaActualPrevia - 1 + estado.paginas.length) % estado.paginas.length);
    });
    document.getElementById('btnNextVista').addEventListener('click', () => {
        if (estado.paginas.length) abrirVistaPrevia((vistaActualPrevia + 1) % estado.paginas.length);
    });
    modalVistaPrevia.addEventListener('click', (e) => { if (e.target === modalVistaPrevia) cerrarVistaPrevia(); });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modalVistaPrevia.classList.contains('hidden')) cerrarVistaPrevia();
    });

    document.getElementById('btnAplicarRango').addEventListener('click', () => {
        const rango = document.getElementById('rangoPaginas').value.trim();
        const set = H.parsearRangoPaginas(rango);
        if (!set.size) return clubUI.toast('Formato de páginas: 1-4,6,8', 'warning');
        estado.paginas.forEach(p => p.incluida = set.has(p.num));
        actualizarSeleccion();
    });

    document.getElementById('btnTodasPaginas').addEventListener('click', () => {
        estado.paginas.forEach(p => p.incluida = true);
        actualizarSeleccion();
    });

    document.getElementById('btnNingunaPagina').addEventListener('click', () => {
        estado.paginas.forEach(p => p.incluida = false);
        actualizarSeleccion();
    });

    function validarHabilitacion() {
        btnTransformar.disabled = !(claveOpenAI.value.trim() && estado.imagenes.length > 0);
    }

    // ---------- IA (motor delegado en gaceta_ia.js) ----------
    btnTransformar.addEventListener('click', async () => {
        const clave = claveOpenAI.value.trim();
        if (!clave) { clubUI.toast('Guarde primero una clave de IA.', 'warning'); return; }
        if (estado.imagenes.length === 0) { clubUI.toast('Suba primero la gaceta.', 'warning'); return; }

        estadoIA.textContent = 'Enviando a la IA (Gemini)... puede tardar 20–60 seg.';
        btnTransformar.disabled = true;
        window.clubIndicador?.accion('La IA está leyendo el programa…');

        try {
            const { carreras, cuotaTotal } = await IA.transformar({ clave, imagenes: estado.imagenes.slice() });
            estado.carreras = carreras || [];

            if (estado.carreras.length === 0) {
                if (cuotaTotal) {
                    estadoIA.textContent = 'Cuota DIARIA gratuita de Gemini agotada. Prueba otra vez mañana o consigue otra clave gratis (aistudio.google.com/apikey); así cambias al cupo de otra cuenta.';
                    clubUI.toast('Cuota diaria gratuita agotada: cambia de clave o reintenta mañana.', 'warning');
                } else {
                    estadoIA.textContent = 'No se extrajeron carreras. Revisa el diagnóstico (caja negra debajo del botón) y reintenta con menos páginas o con otra clave.';
                    clubUI.toast('La IA no devolvió carreras. Mira el diagnóstico para el motivo exacto.', 'error');
                }
            } else {
                // ---------- ENTREGA INMEDIATA ----------
                // El resultado de la IA SIEMPRE se muestra; el padrón se registra
                // por detrás y NO bloquea las cards.
                if (cuotaTotal) clubUI.toast(`Cuota agotada en parte de Gemini: se muestra el resultado PARCIAL extraído (${estado.carreras.length} carrera(s)).`, 'warning');
                estado.carreras.forEach(c => { c.enviada = false; c.aplicada = false; });
                H.persistirRegistro(estado);
                renderCarreras({ nuevos: 0, vinculados: 0 });
                resultadoGaceta.classList.remove('hidden');
                estadoIA.textContent = (cuotaTotal ? 'PARCIAL · ' : '') + `Listo: ${estado.carreras.length} carrera(s) transcritas. Vinculando padrón…`;
                window.clubIndicador?.listo(`${estado.carreras.length} carrera(s) extraídas`);
                if (window.clubDB?.logAccion) window.clubDB.logAccion('GACETA_IA', `transcrita: ${estado.carreras.length} carreras${cuotaTotal ? ' (parcial por cuota)' : ''}`);
                PAD.guardarHistorial(window.supabase, estado.carreras, window.clubAuth?.getSesion?.()?.nombre || 'desconocido')
                    .catch(e => {
                        console.warn('No se guardó el historial (gaceta_procesada):', e.message || e);
                        if (!sessionStorage.getItem('club_gaceta_sql_aviso')) {
                            sessionStorage.setItem('club_gaceta_sql_aviso', '1');
                            clubUI.toast('La gaceta se procesó bien, pero el historial no se pudo guardar (falta la tabla o permisos para "gaceta_procesada"). Ejecute el paquete SQL completo y recargue.', 'warning');
                        }
                    });
                PAD.registrar(window.supabase, estado.carreras)
                    .then(res => {
                        if (estadoIA.textContent.includes('Listo:')) {
                            estadoIA.textContent = (estadoIA.textContent.startsWith('PARCIAL') ? 'PARCIAL · ' : '') + `Listo: ${estado.carreras.length} carrera(s), ${res.nuevos} ejemplar(es) nuevos registrados.`;
                        }
                        actualizarVinculosPadron(res);
                        const parcial = estadoIA.textContent.startsWith('PARCIAL') ? 'Resultado PARCIAL · ' : '';
                        if (res.errorDb) {
                            clubUI.aviso('Transcripción lista (padrón sin conexión)',
                                `${parcial}${estado.carreras.length} carrera(s) transcritas por la IA.\n\nPero no se pudo vincular el padrón:\n${res.errorDb}\n\nEjecute sql/paquete_pendientes.sql en Supabase y luego use "Registrar ejemplares en el padrón"`,
                                'warning');
                        } else if (res.fallidos > (res.nuevos + res.vinculados) && res.nuevos === 0) {
                            clubUI.aviso('Transcripción lista (padrón incompleto)',
                                `${parcial}${estado.carreras.length} carrera(s) extraídas. ${res.fallidos} ejemplar(es) no pudieron vincularse.\n\nVerifique que ejecutó sql/paquete_pendientes.sql en Supabase.`,
                                'warning');
                        } else {
                            clubUI.aviso('Tarea completada',
                                `${parcial}${estado.carreras.length} carrera(s) transcritas e ingresadas por la IA.\n\n` +
                                `Padrón: ${res.nuevos} nuevo(s) · ${res.vinculados} vinculado(s).\n\n` +
                                `Revise abajo los datos, ajuste valores si desea y envíelas al Ensamblaje.`,
                                cuotaTotal ? 'warning' : 'success');
                        }
                    })
                    .catch(err => {
                        console.warn('Padrón en segundo plano falló por completo:', err.message || err);
                        actualizarVinculosPadron({ nuevos: 0, vinculados: 0 });
                        clubUI.aviso('Transcripción lista (padrón falló)',
                            `${estado.carreras.length} carrera(s) transcritas por la IA.\n\nVinculación al padrón falló por completo: ${err.message || err}\n\nIntente con "Registrar ejemplares en el padrón" o verifique sql/paquete_pendientes.sql`,
                            'warning');
                    });
            }
        } catch (e) {
            console.error(e);
            estadoIA.textContent = 'ERROR: ' + (e.message || e);
            clubUI.toast('Falló la transformación con IA.', 'error');
            try {
                const diagEl = document.getElementById('diagGaceta');
                if (diagEl) { diagEl.classList.remove('hidden'); diagEl.textContent = 'ERROR: ' + (e.message || e); }
            } catch (err2) { /* nada */ }
        }
        window.clubIndicador?.fin();
        validarHabilitacion();
    });

    // ---------- RENDER ----------
    function filaEjemplarGac(ej, hipo) {
        const num = ej?.numero ?? '';
        const colores = H.colorDeNumeroGac(num);
        const nac = H.nacEjemplar(ej, hipo);
        return `
            <div class="gac-fila-ejemplar flex gap-0.5 items-center bg-slate-50 border border-slate-200 rounded px-1 py-0.5">
                <input type="text" inputmode="numeric" title="Número del ejemplar" placeholder="Nº"
                    class="gac-num w-4 h-5 shrink-0 border rounded px-0 py-px text-center text-[8px] font-black outline-none focus:ring-1 focus:ring-indigo-400"
                    value="${num}" style="background-color:${colores.bg};color:${colores.fg};border-color:${colores.bg}">
                <input type="text" title="Nombre del ejemplar" placeholder="Ejemplar"
                    class="gac-nombre flex-1 min-w-0 max-w-[6.5rem] border border-slate-200 rounded px-1 py-px text-[10px] font-bold uppercase outline-none focus:ring-1 focus:ring-indigo-400"
                    value="${ej?.nombre || ''}">
                <span class="gac-nac bandera-nac w-4 shrink-0 inline-flex justify-center text-sm leading-none" title="${nac}" data-nac="${nac}">${FLAGS[nac] || '🏳️'}</span>
                <input type="text" inputmode="decimal" title="Valor / monta del ejemplar" placeholder="$"
                    class="gac-valor w-12 shrink-0 border border-slate-200 rounded px-0.5 py-px text-right text-[12px] font-black text-blue-700 outline-none focus:ring-1 focus:ring-indigo-400"
                    value="${ej?.valor ?? ej?.pts ?? ''}">
                <span class="gac-badge-padron w-4 shrink-0 text-center text-[9px] font-black ${ej?.ejemplar_id ? (ej?.nuevo ? 'text-emerald-600' : 'text-slate-400') : 'text-red-400'}" title="${ej?.ejemplar_id ? (ej?.nuevo ? 'Nuevo en el padrón' : 'Vinculado al padrón') : 'Sin padrón'}">${ej?.ejemplar_id ? (ej?.nuevo ? '★' : '✓') : '✗'}</span>
            </div>`;
    }

    // Las cards de las carreras extraídas se dibujan IGUAL que las del Ensamblaje
    // (cabecera índigo con hipódromo/carrera/distancia/superficie y "Monto a Pagar /
    // Tabla" por defecto $100, filas Nº/nombre/bandera/valor, y la "Suma de la Tabla").
    function renderCarreras(resPadron) {
        document.getElementById('resumenExtraccion').textContent = `(${estado.carreras.length} carreras · ${(resPadron.nuevos || 0)} nuevos / ${(resPadron.vinculados || 0)} vinculados al padrón)`;
        if (estado.carreras.length === 0) {
            carrerasGaceta.innerHTML = '<div class="col-span-full text-center p-8 text-slate-500 italic">No se detectaron carreras. Pruebe con más páginas del PDF o mejor resolución de imagen.</div>';
            return;
        }
        carrerasGaceta.innerHTML = estado.carreras.map((c, i) => {
            const numCarrera = c.carrera || i + 1;
            const ejemplares = Array.isArray(c.ejemplares) ? c.ejemplares : [];
            const suma = ejemplares.reduce((a, ej) => a + (H.aNum(ej?.valor) ?? H.aNum(ej?.pts) ?? 0), 0);
            return `
            <div class="card-gac bg-white rounded-xl shadow-sm border border-indigo-200 overflow-hidden flex flex-col" data-carrera="${i}" data-numero="${numCarrera}">
                <div class="bg-indigo-600 px-2 py-1" style="color:#fff">
                    <div class="flex items-center justify-between gap-1">
                        <input type="text" class="gac-hipodromo rounded px-1.5 py-px text-[9px] font-bold uppercase outline-none flex-1 min-w-0" style="background:rgba(255,255,255,.18);color:#fff" value="${c.hipodromo || ''}" placeholder="Hipódromo">
                        <span class="font-black text-[10px] whitespace-nowrap">
                            <i class="fas fa-flag-checkered mr-0.5"></i>C
                            <input type="number" class="gac-carrera w-7 rounded px-1 py-px text-center font-black outline-none" style="background:rgba(255,255,255,.18);color:#fff" value="${numCarrera}" placeholder="N°">
                        </span>
                        <input type="checkbox" class="gac-sel w-4 h-4 accent-indigo-500 shrink-0" checked title="Incluir al enviar al Ensamblaje">
                    </div>
                    <div class="flex flex-wrap gap-1 mt-0.5 text-[8px] font-bold items-center">
                        <span class="rounded px-1 py-px" style="background:rgba(255,255,255,.18)">Dist: <input type="number" class="gac-distancia w-11 outline-none text-center font-black" style="background:transparent;color:#fff" value="${c.distancia ?? ''}" placeholder="m"></span>
                        <select class="gac-superficie rounded px-0.5 py-px outline-none uppercase text-[8px] font-bold" style="background:rgba(255,255,255,.18)">
                            ${SUPERFICIES.map(s => `<option value="${s}" ${String(c.superficie || '').toUpperCase() === s ? 'selected' : ''}>${s}</option>`).join('')}
                        </select>
                        <input type="date" class="gac-fecha hidden" value="${c.fecha || ''}">
                    </div>
                    <div class="mt-1 flex items-center justify-between rounded px-2 py-1" style="background:rgba(255,255,255,.20)">
                        <span class="text-[9px] font-black uppercase tracking-wider opacity-90"><i class="fas fa-dollar-sign mr-0.5"></i> Monto a Pagar / Tabla</span>
                        <span class="flex items-center gap-0.5 font-black text-sm" style="color:#fff">$<input type="number" step="0.01" class="gac-premio w-14 bg-transparent outline-none text-right font-black" style="color:#fff;border-bottom:2px solid rgba(255,255,255,.5)" value="100"></span>
                    </div>
                </div>
                <div class="px-2 pt-1 pb-0.5 text-[8px] font-black uppercase tracking-wider text-slate-400 flex items-center justify-between">
                    <span><i class="fas fa-horse-head text-amber-500 mr-0.5"></i> Ejemplares</span>
                    <span class="gac-cont-caballos bg-slate-100 text-slate-600 px-1.5 rounded-full font-black">${ejemplares.length}</span>
                </div>
                <div class="px-1.5 py-0.5 space-y-0.5 flex-1">
                    ${ejemplares.map(ej => filaEjemplarGac(ej, c.hipodromo)).join('') || '<p class="text-[10px] text-slate-400 italic px-1 py-1">Sin ejemplares detectados.</p>'}
                </div>
                <div class="px-2 py-1 border-t border-slate-200 bg-white flex items-center justify-between">
                    <span class="inline-flex items-center gap-1 text-[8px] font-black uppercase tracking-wider text-slate-400">
                        <i class="fas fa-calculator text-indigo-400"></i> Suma de la Tabla
                    </span>
                    <span class="suma-tabla-card font-black text-[11px] text-indigo-700" title="Sumatoria de los valores de todos los ejemplares">$ ${clubUI.formatoNumero(suma, 2)}</span>
                </div>
                <div class="px-2 py-1.5 border-t border-slate-200 flex gap-2 bg-white">
                    <button type="button" class="btn-cargar-ensamblaje flex-1 bg-cyan-600 hover:bg-cyan-700 text-white text-[10px] font-black py-1.5 rounded-lg shadow transition-colors uppercase tracking-wide" data-acc="cargar" title="Lleva esta carrera al Ensamblaje para revisar sus VALORES y publicar">
                        <i class="fas fa-arrow-right mr-1"></i> Cargar en el Ensamblaje
                    </button>
                </div>
            </div>`;
        }).join('');
        actualizarBtnTodo();
    }

    // El padrón se registra EN SEGUNDO PLANO; cuando termina se actualizan las
    // insignias en pantalla SIN reconstruir las cards (no se pierde lo que el
    // operador esté editando).
    function actualizarVinculosPadron(res) {
        const resumen = document.getElementById('resumenExtraccion');
        if (resumen) resumen.textContent = `(${estado.carreras.length} carreras · ${res.nuevos} nuevos / ${res.vinculados} vinculados al padrón)`;
        document.querySelectorAll('.gac-fila-ejemplar').forEach(fila => {
            const nombre = (fila.querySelector('.gac-nombre')?.value || '').trim().toUpperCase();
            const nac = (fila.querySelector('.gac-nac')?.dataset.nac || 'VE').toUpperCase();
            if (!nombre) return;
            let info = null;
            for (const c of estado.carreras) {
                for (const ej of (c.ejemplares || [])) {
                    if (String(ej.nombre || '').trim().toUpperCase() === nombre && String(ej.nacionalidad || 'VE').toUpperCase() === nac) { info = ej; break; }
                }
                if (info) break;
            }
            if (!info) return;
            const span = fila.querySelector('.gac-badge-padron');
            if (!span) return;
            span.textContent = info.ejemplar_id ? (info.nuevo ? '★' : '✓') : '✗';
            span.title = info.ejemplar_id ? (info.nuevo ? 'Nuevo en el padrón' : 'Vinculado al padrón') : 'Sin padrón';
            span.className = 'gac-badge-padron w-4 shrink-0 text-center text-[9px] font-black' + (info.ejemplar_id ? (info.nuevo ? ' text-emerald-600' : ' text-slate-400') : ' text-red-400');
        });
    }

    // Lee UNA carrera desde su card (usa los valores editados en pantalla)
    function leerCarreraDeCard(card) {
        const caballos = [...card.querySelectorAll('.gac-fila-ejemplar')].map(f => ({
            numero: f.querySelector('.gac-num')?.value?.trim() || '',
            nombre: f.querySelector('.gac-nombre')?.value?.trim().toUpperCase() || '',
            nacionalidad: f.querySelector('.gac-nac')?.dataset.nac || 'VE',
            valor: H.aNum(f.querySelector('.gac-valor')?.value) ?? H.aNum(f.querySelector('.gac-pts')?.value) ?? 0
        })).filter(c => c.nombre);

        return {
            hipodromo: card.querySelector('.gac-hipodromo')?.value?.trim().toUpperCase() || '',
            fecha: card.querySelector('.gac-fecha')?.value || null,
            carrera: parseInt(card.dataset.numero) || null,
            distancia: parseInt(card.querySelector('.gac-distancia')?.value) || 0,
            superficie: card.querySelector('.gac-superficie')?.value || 'ARENA',
            premio: parseFloat(card.querySelector('.gac-premio')?.value) || 0,
            caballos
        };
    }

    // Acumula carreras en el Ensamblaje (varias por envío). Retorna el total.
    function acumularEnEnsamblaje(carreras) {
        const leerArr = () => {
            try { const x = JSON.parse(sessionStorage.getItem('ensamblaje_carreras')); if (Array.isArray(x)) return x; } catch (err) { /* nada */ }
            try { const x = JSON.parse(localStorage.getItem('ensamblaje_carreras')); if (Array.isArray(x)) return x; } catch (err) { /* nada */ }
            return [];
        };
        const arr = leerArr();
        carreras.forEach(c => arr.push(c));
        sessionStorage.setItem('ensamblaje_carreras', JSON.stringify(arr));
        localStorage.setItem('ensamblaje_carreras', JSON.stringify(arr));
        // Por compatibilidad se conserva también la última como carrera única
        const ultima = carreras[carreras.length - 1];
        sessionStorage.setItem('gaceta_prellenado', JSON.stringify(ultima));
        localStorage.setItem('gaceta_prellenado', JSON.stringify(ultima));
        return arr.length;
    }

    function actualizarBtnTodo() {
        const lbl = document.getElementById('lblEnviarTodo');
        if (!lbl) return;
        const cards = [...carrerasGaceta.querySelectorAll('.card-gac')];
        const sel = carrerasGaceta.querySelectorAll('.gac-sel:checked').length;
        lbl.textContent = sel === 0 ? 'Enviar al Ensamblaje (sin selección)'
            : (sel === cards.length ? `Enviar TODAS al Ensamblaje (${sel})` : `Enviar seleccionadas (${sel})`);
    }

    carrerasGaceta.addEventListener('change', (e) => {
        if (e.target.closest('.gac-sel')) actualizarBtnTodo();
    });

    // Navegación de teclado tipo planilla sobre el VALOR de los ejemplares:
    // Tab / Enter / Flecha abajo → valor del siguiente ejemplar;
    // Shift+Tab / Flecha arriba → valor del ejemplar anterior;
    // al terminar el último (o primero) continua en la siguie (o anterior) card.
    carrerasGaceta.addEventListener('keydown', (e) => {
        const esNavegacion = e.key === 'Enter' || e.key === 'Tab' || e.key === 'ArrowUp' || e.key === 'ArrowDown';
        if (!esNavegacion) return;
        const inp = e.target.closest('.gac-valor');
        if (!inp) return;
        e.preventDefault();
        let dir;
        if (e.key === 'Enter' || e.key === 'Tab') dir = e.shiftKey ? -1 : 1;
        else dir = e.key === 'ArrowDown' ? 1 : -1;
        const valores = [...carrerasGaceta.querySelectorAll('.gac-valor')];
        const i = valores.indexOf(inp);
        if (i === -1) return;
        const siguiente = valores[(i + dir + valores.length) % valores.length];
        siguiente.focus();
        siguiente.select();
    });

    // Mantiene al día la "Suma de la Tabla" de cada card mientras se editan valores.
    carrerasGaceta.addEventListener('input', (e) => {
        const inp = e.target.closest('.gac-valor');
        if (!inp) return;
        const card = inp.closest('.card-gac');
        if (!card) return;
        const total = [...card.querySelectorAll('.gac-valor')].reduce((a, x) => a + (H.aNum(x.value) || 0), 0);
        const el = card.querySelector('.suma-tabla-card');
        if (el) el.textContent = '$ ' + clubUI.formatoNumero(total, 2);
    });

    // ---------- LIMPIAR / RECUPERAR REGISTRO ----------
    function limpiarRegistro() {
        try { localStorage.removeItem(H.REGISTRO_KEY); } catch (e) { /* vacío */ }
        try { sessionStorage.removeItem(H.REGISTRO_KEY); } catch (e) { /* vacío */ }
        try { localStorage.removeItem('ensamblaje_carreras'); } catch (e) { /* vacío */ }
        try { sessionStorage.removeItem('ensamblaje_carreras'); } catch (e) { /* vacío */ }
        try { localStorage.removeItem('gaceta_prellenado'); } catch (e) { /* vacío */ }
        try { sessionStorage.removeItem('gaceta_prellenado'); } catch (e) { /* vacío */ }
        estado.carreras = [];
        renderCarreras({ nuevos: 0, vinculados: 0 });
        estadoIA.textContent = 'Registro limpiado. Cargue un nuevo documento para empezar.';
        actualizarBtnTodo();
    }

    // Si el operador volvió sin haber ensamblado todas, recupera las que
    // quedaron pendientes SIN re-transformar con la IA.
    async function cargarRegistroGuardado() {
        const arr = H.leerRegistro();
        if (!arr || !arr.length) return;
        const pendientes = arr.filter(c => !c.enviada);
        if (!pendientes.length) {
            estadoIA.textContent = `${arr.filter(c => c.enviada).length} carrera(s) ya se enviaron al Ensamblaje. Cargue un nuevo programa o use "Limpiar registro" para empezar de nuevo.`;
            return;
        }
        estado.carreras = pendientes.map(c => {
            const copia = Object.assign({}, c);
            delete copia.enviada;
            delete copia.aplicada;
            return copia;
        });
        window.clubIndicador?.accion('Recuperando las carreras guardadas…');
        const resPadron = await PAD.registrar(window.supabase, estado.carreras);
        H.persistirRegistro(estado);
        renderCarreras(resPadron);
        resultadoGaceta.classList.remove('hidden');
        const enviadas = arr.filter(c => c.enviada).length;
        estadoIA.textContent = `${pendientes.length} carrera(s) guardada(s) pendientes de ensamblar${enviadas ? ` · ${enviadas} ya enviada(s)` : ''}. Puede enviarlas al Ensamblaje sin volver a transformar.`;
        clubUI.toast(`${pendientes.length} carrera(s) pendientes recuperadas del registro (sin re-transformar).`, 'success');
        window.clubIndicador?.fin();
        actualizarBtnTodo();
    }

    // Envío MASIVO: todas las marcadas, de una vez, con una sola navegación
    document.getElementById('btnEnviarTodoEnsamblaje')?.addEventListener('click', () => {
        const cards = [...carrerasGaceta.querySelectorAll('.card-gac')]
            .filter(card => card.querySelector('.gac-sel')?.checked);
        if (cards.length === 0) return clubUI.toast('Marca con el ✓ al menos una carrera para enviar.', 'warning');
        const carreras = cards.map(leerCarreraDeCard).filter(c => c.caballos.length > 0);
        if (carreras.length === 0) return clubUI.toast('Las carreras marcadas no tienen ejemplares con nombre.', 'warning');
        H.marcarEnviadas(estado, carreras);
        const total = acumularEnEnsamblaje(carreras);
        clubUI.toast(`${carreras.length} carrera(s) enviada(s) al Ensamblaje (total en el envío: ${total}). Revise y publique.`, 'success');
        setTimeout(() => location.href = 'tablas.html', 600);
    });

    carrerasGaceta.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-acc="cargar"]');
        if (!btn) return;
        const card = btn.closest('.card-gac');
        const carrera = leerCarreraDeCard(card);
        if (carrera.caballos.length === 0) return clubUI.toast('Esta carrera no tiene ejemplares con nombre.', 'warning');

        H.marcarEnviadas(estado, [carrera]);
        const total = acumularEnEnsamblaje([carrera]);
        clubUI.toast(`Carrera C${carrera.carrera || '?'} enviada al Ensamblaje (total en el envío: ${total}). Revise y publique.`, 'success');
        setTimeout(() => location.href = 'tablas.html', 600);
    });

    document.getElementById('btnRegistrarPadron').addEventListener('click', async () => {
        const btn = document.getElementById('btnRegistrarPadron');
        const orig = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Registrando…';
        btn.disabled = true;
        try {
            const res = await PAD.registrar(window.supabase, estado.carreras);
            renderCarreras(res);
            if (res.errorDb) {
                const rls = /row-level security|permission denied|42501/i.test(String(res.errorDb));
                clubUI.aviso(rls ? 'SQL pendiente (RLS activo en "ejemplares")' : 'Padrón no disponible',
                    `No se pudo conectar con la tabla "ejemplares" para registrar los ejemplares (${res.fallidos}).\n\n` +
                    `ERROR: ${res.errorDb}\n\n` +
                    `Ejecute el paquete SQL completo en Supabase SQL Editor:\n` +
                    `  sql/paquete_pendientes.sql\n\n` +
                    `Después recargue esta página y vuelva a intentarlo.`,
                    'error');
            } else if (res.vinculados === 0 && res.nuevos === 0 && res.fallidos === 0) {
                clubUI.aviso('Sin ejemplares', 'No se encontraron ejemplares con nombre en las carreras extraídas para registrar en el Padrón.', 'info');
            } else if (res.fallidos > 0) {
                clubUI.aviso('Padrón actualizado (con errores)',
                    `${res.nuevos} nuevo(s) · ${res.vinculados} vinculado(s) · ${res.fallidos} con error.\n\nLos marcados en rojo quedan "sin padrón". Si no se guardó ninguno, verifique que ejecutó: sql/paquete_pendientes.sql`,
                    'warning');
            } else {
                clubUI.aviso('Padrón actualizado',
                    `${res.nuevos} ejemplar(es) nuevo(s) registrado(s) en el Padrón · ${res.vinculados} ya vinculado(s) con tablas previas.`,
                    'success');
            }
        } finally {
            btn.innerHTML = orig;
            btn.disabled = false;
        }
    });

    document.getElementById('btnRecargarGaceta').addEventListener('click', () => {
        miniminiaturas(); estado.imagenes = []; inputArchivo.value = '';
        claveOpenAI.value = localStorage.getItem(CLAVE_KEY) || '';
        validarHabilitacion();
    });

    document.getElementById('btnLimpiarRegistro')?.addEventListener('click', () => {
        const arr = H.leerRegistro();
        const pendientes = (arr || []).filter(c => !c.enviada).length;
        const mensaje = pendientes > 0
            ? `Hay ${pendientes} carrera(s) pendientes de ensamblar. `
            : 'El registro no tiene carreras pendientes. ';
        if (!confirm(`¿Limpiar el registro del día?\n\n${mensaje}Esta acción borra el registro guardado (no afecta las tablas ya publicadas).`)) return;
        limpiarRegistro();
        clubUI.toast('Registro del día limpiado.', 'success');
    });

    validarHabilitacion();
    cargarRegistroGuardado().catch(err => console.warn('Registro guardado corrupto en el arranque:', err.message || err));

    // Verifica que la tabla "ejemplares" (padrón) exista: si falta, es la causa
    // de que el Padrón quede vacío al transformar la gaceta.
    async function verificarSqlGaceta() {
        if (!window.supabase) return;
        try {
            const { error } = await window.supabase.from('ejemplares').select('id').limit(1);
            if (error && /does not exist|does not have a column|42703|42P01|permission|row-level security/i.test(String(error.message || ''))) {
                setTimeout(() => {
                    clubUI.aviso('SQL pendiente para el Padrón de ejemplares',
                        `La tabla "ejemplares" no está disponible en la base de datos. Por eso el Padrón se ve vacío al transformar la gaceta.\n\nEjecute en Supabase → SQL Editor:\n\nsql/paquete_pendientes.sql\n\nDespués recargue esta página y vuelva a transformar (o use "Registrar ejemplares en el padrón").`,
                        'error');
                }, 2500);
            }
        } catch (e) { /* ignorar errores de red */ }
    }
    verificarSqlGaceta();
});