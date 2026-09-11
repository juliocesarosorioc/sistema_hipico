document.addEventListener('DOMContentLoaded', () => {

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
    const SUPERFICIES = ['ARENA', 'CESPED', 'FANGO', 'TAPETA', 'OTRA'];
    const NACIONALIDADES = ['VE', 'USA', 'BR', 'AR', 'CL', 'MX', 'PA', 'PE', 'CO', 'EC', 'UY', 'OTRA'];

    // Modelos Flash de respaldo (la app primero consulta a la API cuáles existen hoy)
    const MODELOS_GEMINI = ['gemini-3.6-flash', 'gemini-3-flash', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];

    async function listaModelosFlash(clave) {
        try {
            const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(clave)}`);
            if (!r.ok) return [];
            const datos = await r.json();
            const flash = (datos.models || [])
                .map(m => m.name.replace('models/', ''))
                .filter(n => /flash/i.test(n));
            if (!flash.length) return [];
            const ver = n => { const m = n.match(/gemini-([\d.]+)/); return m ? parseFloat(m[1]) : 0; };
            const lite = n => /-lite/i.test(n);
            flash.sort((a, b) => (ver(b) - ver(a)) || ((lite(a) ? 1 : 0) - (lite(b) ? 1 : 0)));
            return flash;
        } catch (e) {
            return [];
        }
    }

    let estado = { imagenes: [], paginas: [], carreras: [] };

    // ---------- TRAMPA DE ERRORES VISIBLES ----------
    // Cualquier error (aunque venga de una librería o de la red) se muestra en
    // la caja de estado/ diagnóstico para que el operador NO vea un "error que
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

    // ---------- REGISTRO PERSISTENTE ----------
    // Las carreras del día quedan guardadas hasta que se cargue un nuevo
    // documento o el operador presione "Limpiar registro".
    const REGISTRO_KEY = 'gaceta_registro';

    function leerRegistro() {
        try { const a = JSON.parse(localStorage.getItem(REGISTRO_KEY)); if (Array.isArray(a)) return a; } catch (e) { /* vacío */ }
        try { const a = JSON.parse(sessionStorage.getItem(REGISTRO_KEY)); if (Array.isArray(a)) return a; } catch (e) { /* vacío */ }
        return null;
    }
    function escribirRegistro(arr) {
        try { localStorage.setItem(REGISTRO_KEY, JSON.stringify(arr)); } catch (e) { /* vacío */ }
        try { sessionStorage.setItem(REGISTRO_KEY, JSON.stringify(arr)); } catch (e) { /* vacío */ }
    }
    function persistirRegistro() {
        escribirRegistro(estado.carreras.map(c => Object.assign({}, c, { enviada: !!c.enviada, aplicada: !!c.aplicada })));
    }
    function marcarEnviadas(carreras) {
        // Coincidencia robusta: hipódromo+carrera, si no sólo hipódromo, si no
        // una pendiente con hipódromo vacío, y como última vía el primero sin
        // marcar (funciona aunque la IA no haya dado el número de carrera).
        const porMarcar = estado.carreras.filter(c => !c.enviada);
        carreras.forEach(ce => {
            const hipo = String(ce.hipodromo || '').trim().toUpperCase();
            let idx = porMarcar.findIndex(c => String(c.hipodromo || '').trim().toUpperCase() === hipo && String(c.carrera ?? '') === String(ce.carrera ?? ''));
            if (idx === -1 && hipo) idx = porMarcar.findIndex(c => String(c.hipodromo || '').trim().toUpperCase() === hipo);
            if (idx === -1) idx = porMarcar.findIndex(c => !String(c.hipodromo || '').trim());
            if (idx === -1) idx = 0;
            const objetivo = porMarcar.splice(idx, 1)[0];
            if (objetivo) { objetivo.enviada = true; objetivo.aplicada = false; }
        });
        persistirRegistro();
    }

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
            const lista = await listaModelosFlash(k);
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

    // ---------- CARGA DE ARCHIVO ----------
    zonaDrop.addEventListener('click', () => inputArchivo.click());
    inputArchivo.addEventListener('change', (e) => { if (e.target.files[0]) leerArchivo(e.target.files[0]); });
    ['dragover', 'drop'].forEach(ev => zonaDrop.addEventListener(ev, (e) => {
        e.preventDefault();
        if (ev === 'dragover') zonaDrop.classList.add('border-cyan-500', 'bg-cyan-50');
        else { zonaDrop.classList.remove('border-cyan-500', 'bg-cyan-50'); if (e.dataTransfer.files[0]) leerArchivo(e.dataTransfer.files[0]); }
    }));

    function dataURLImagen(file) {
        return new Promise((resolve, reject) => {
            const rd = new FileReader();
            rd.onload = () => resolve(rd.result);
            rd.onerror = reject;
            rd.readAsDataURL(file);
        });
    }

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
                const durl = await dataURLImagen(file);
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

    function parsearRangoPaginas(txt) {
        const set = new Set();
        (txt || '').split(',').forEach(part => {
            part = part.trim();
            if (!part) return;
            const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
            if (m) {
                const a = Math.min(+m[1], +m[2]);
                const b = Math.max(+m[1], +m[2]);
                for (let i = a; i <= b; i++) set.add(i);
            } else if (/^\d+$/.test(part)) {
                set.add(+part);
            }
        });
        return set;
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
        const set = parsearRangoPaginas(rango);
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

    // ---------- IA ----------
    btnTransformar.addEventListener('click', async () => {
        const clave = claveOpenAI.value.trim();
        if (!clave) { clubUI.toast('Guarde primero una clave de IA.', 'warning'); return; }
        if (estado.imagenes.length === 0) { clubUI.toast('Suba primero la gaceta.', 'warning'); return; }

        estadoIA.textContent = 'Enviando a la IA (Gemini)... puede tardar 20–60 seg.';
        btnTransformar.disabled = true;
        window.clubIndicador?.accion('La IA está leyendo el programa…');

        const SYS = `
Eres el transcriptor de la gaceta hípica venezolana. Recibes páginas/imágenes del programa oficial de carreras.
Extrae TODAS las carreras visibles y sus ejemplares participantes.
Para cada carrera devuelve:
  - carrera: número de la carrera (entero)
  - hipodromo: nombre del hipódromo (MAYÚSCULAS; ej: LA RINCONADA, SANTA RITA). Si no se lee usa "".
  - fecha: fecha de la jornada en formato YYYY-MM-DD si aparece, si no null
  - distancia: distancia de la carrera en metros (entero) si se lee, si no 0
  - superficie: una de ARENA, CESPED, FANGO, TAPETA u otra si se lee explícita; si no ARENA
  - premio: número si se lee (ej: 15000), si no 0
  - ejemplares: lista con numero (puesto/orden del ejemplar), nombre (MAYÚSCULAS, EXACTO como aparece), nacionalidad (país si se indica: VE, USA, BR, AR, CL, MX, PA, PE, CO, EC, UY; si no se indica usa VE), valor (monta del ejemplar: SOLO número si aparece, si no 0)
REGLAS: NO inventes nombres ni datos; transcribe exactamente lo que lees. REGISTRA TODOS los ejemplares de cada carrera sin omitir ninguno (todos los números de participante que aparezcan). Si un ejemplar aparece repetido entre páginas, mantenlo tal cual. Si el documento no tiene carreras, devuelve {"carreras":[]}.
`;

        try {
            // ---------- Motor de extracción por LOTES ----------
            // Cada lote (3 páginas) es liviano: evita el HTTP 400 por petición
            // gigante y no quema la cuota gratuita de un solo golpe.
            const esperar = (ms) => new Promise(r => setTimeout(r, ms));
            const diagEl = document.getElementById('diagGaceta');
            const diag = { respondio: '', ultimoError: '' };
            const pesoKB = (durls) => Math.round(durls.reduce((a, d) => a + (((d.split(',')[1]) || '').length * 3 / 4), 0) / 1024);
            function pintarDiag(extra) {
                if (!diagEl) return;
                diagEl.classList.remove('hidden');
                diagEl.textContent =
                    `clave: ${clave ? clave.slice(0, 4) + '…' + clave.slice(-3) + ' (' + clave.length + ' car.)' : 'AUSENTE'}\n` +
                    `páginas elegidas: ${estado.imagenes.length} · peso aprox: ${(pesoKB(estado.imagenes) / 1024).toFixed(1)} MB\n` +
                    (diag.respondio ? `respondió: ${diag.respondio}\n` : '') +
                    (diag.ultimoError ? `último error: ${diag.ultimoError}\n` : '') +
                    (extra || '');
            }

            const descubiertos = await listaModelosFlash(clave);
            // Cada familia de Flash tiene SU PROPIA cuota gratuita diaria. Se ordenan
            // primero por familia vieja (la que casi siempre conserva cuota) y
            // luego por versión dentro de la familia.
            const elegirModelos = () => {
                const unicos = [...new Set(descubiertos.concat(MODELOS_GEMINI))]
                    .filter(m => !/image|preview|tuned|babbage/i.test(m));
                const porFamilia = {};
                for (const m of unicos) {
                    const v = (m.match(/gemini[_-]?(\d+)/i) || [])[1] || '0';
                    const fam = v.slice(0, 1); // '1','2','3'
                    (porFamilia[fam] = porFamilia[fam] || []).push(m);
                }
                const orden = ['1', '2', '3'];
                const out = [];
                for (const fam of orden) {
                    const ms = (porFamilia[fam] || []).sort((a, b) => {
                        const va = parseFloat((a.match(/gemini[_-]?([\d.]+)/i) || [])[1] || '0');
                        const vb = parseFloat((b.match(/gemini[_-]?([\d.]+)/i) || [])[1] || '0');
                        return vb - va;
                    });
                    out.push(...ms);
                }
                for (const fam of Object.keys(porFamilia).sort()) if (!orden.includes(fam)) out.push(...porFamilia[fam]);
                return out.slice(0, 10);
            };
            const modelos = elegirModelos();
            if (!modelos.length) throw new Error('Tu clave no devolvió modelos Flash. Verifica la clave en aistudio.google.com/apikey y tu conexión.');

            function armarBody(durls, estricto) {
                const imgs = durls.map(d => {
                    const [, meta] = d.split(',');
                    const mime = d.split(';')[0].replace('data:', '');
                    return { inline_data: { mime_type: mime, data: meta } };
                });
                const parteTexto = estricto
                    ? 'Gaceta adjunta. Extrae las carreras y responde ÚNICAMENTE con JSON válido con el formato {"carreras":[...]}, sin markdown, sin decoraciones ni explicaciones.'
                    : 'Gaceta adjunta. Extrae las carreras y sus ejemplares.';
                return {
                    contents: [{ parts: [{ text: parteTexto }, ...imgs] }],
                    systemInstruction: { parts: [{ text: SYS }] },
                    generationConfig: {
                        temperature: estricto ? 0.2 : 0,
                        maxOutputTokens: 8192,
                        responseMimeType: 'application/json'
                    }
                };
            }

            async function postIA(url, body, ms) {
                const ctl = new AbortController();
                const t = setTimeout(() => ctl.abort(), ms || 120000);
                try {
                    return await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': clave },
                        body: JSON.stringify(body), signal: ctl.signal
                    });
                } finally { clearTimeout(t); }
            }

            async function llamarModelo(model, durls, estricto) {
                let resp;
                try {
                    resp = await postIA(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, armarBody(durls, estricto));
                } catch (errNet) {
                    return { ok: false, tipo: 'salto', msg: `Sin conexión al probar ${model} (${errNet.name === 'AbortError' ? 'tiempo agotado (120s)' : (errNet.message || 'red')}).` };
                }
                if (resp.status === 429) {
                    const txt429 = await resp.text().catch(() => '');
                    const esDiaria = /RESOURCE_EXHAUSTED|quota|per day|daily|rpd/i.test(txt429);
                    return { ok: false, tipo: esDiaria ? 'cuotaDia' : 'cuotaRpm', msg: `${esDiaria ? 'CUOTA DIARIA' : 'LÍMITE POR MINUTO'} en ${model} (HTTP 429).` };
                }
                if (resp.status === 503) return { ok: false, tipo: 'salto503', msg: `Modelo ${model} saturado (HTTP 503, alta demanda temporal).` };
                if (resp.status === 404) return { ok: false, tipo: 'salto', msg: `Modelo ${model} no disponible (HTTP 404).` };
                if (!resp.ok) {
                    const txtErr = await resp.text().catch(() => '');
                    let msg = `Error de IA (HTTP ${resp.status}).`;
                    try { msg = 'IA: ' + (JSON.parse(txtErr).error?.message || msg); } catch (e) { if (txtErr) msg = txtErr.slice(0, 220); }
                    if (/API_KEY_INVALID|API key not valid|API_KEY_NOT_FOUND|PERMISSION_DENIED/i.test(msg)) {
                        return { ok: false, tipo: 'clave', msg };
                    }
                    if (resp.status === 400 && durls.length > 1 && /large|tokens|size|payload|maximum|invalid argument/i.test(msg)) {
                        return { ok: false, tipo: 'grande', msg };
                    }
                    return { ok: false, tipo: 'duro', msg };
                }
                let datos;
                try { datos = await resp.json(); }
                catch (e) { return { ok: false, tipo: 'salto', msg: `Modelo ${model} devolvió respuesta ilegible.` }; }
                const texto = (datos.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '').trim();
                if (!texto) {
                    const fr = datos.candidates?.[0]?.finishReason || datos.promptFeedback?.blockReason || 'vacío';
                    return { ok: false, tipo: 'salto', msg: `Modelo ${model} respondió vacío (${fr}).` };
                }
                return { ok: true, texto };
            }

            async function extraerLote(nombresPag, durls, etiqueta) {
                let reintento503 = false;
                let reintentoRpm = false;
                for (let i = 0; i < modelos.length; i++) {
                    const model = modelos[i];
                    if (i > 0) await esperar(1200);
                    let r = await llamarModelo(model, durls, false);
                    let carreras = [];
                    if (r.ok) {
                        carreras = parsearJSON(r.texto);
                        if (carreras.length === 0) {
                            estadoIA.textContent = `${etiqueta}: sin carreras, segundo intento (JSON estricto)…`;
                            const r2 = await llamarModelo(model, durls, true);
                            if (r2.ok) { r = r2; carreras = parsearJSON(r2.texto); }
                            else { r = r2; }
                        }
                        if (r.ok && carreras.length > 0) { diag.respondio = model; return carreras; }
                        if (r.ok) { diag.ultimoError = `${etiqueta}: ${model} devolvió 0 carreras.`; pintarDiag(); continue; }
                    }
                    if (r.tipo === 'clave') throw new Error(r.msg + ' Revisa la clave en aistudio.google.com/apikey y guárdala de nuevo.');
                    if (r.tipo === 'cuotaDia') {
                        // Cuota DIARIA de esta familia agotada: NUNCA se espera en
                        // vano. Se salta al siguiente modelo (otra familia tiene su
                        // propia cuota gratis). Si ninguna responde, el ciclo lo dirá.
                        diag.ultimoError = `${etiqueta}: ${r.msg}`;
                        pintarDiag();
                        continue;
                    }
                    if (r.tipo === 'cuotaRpm') {
                        // Límite por MINUTO (transitorio): una sola espera larga y
                        // se reintenta; si vuelve a chocar se cambia de modelo.
                        if (!reintentoRpm) {
                            reintentoRpm = true;
                            estadoIA.textContent = `${etiqueta}: límite por minuto de ${model}, esperando 65s y reintentando…`;
                            pintarDiag(`${etiqueta}: esperando 65s por límite por minuto…`);
                            await esperar(65000);
                            i--;
                            continue;
                        }
                        diag.ultimoError = `${etiqueta}: ${r.msg}`;
                        pintarDiag();
                        continue;
                    }
                    if (r.tipo === 'salto503' && !reintento503) {
                        // Pico temporal de demanda: Google pide reintentar más tarde.
                        // Se espera 20s y se reintenta el MISMO modelo una vez.
                        reintento503 = true;
                        estadoIA.textContent = `${etiqueta}: ${model} saturado, esperando 20s y reintentando…`;
                        pintarDiag(`${etiqueta}: esperando 20s por saturación de ${model}…`);
                        await esperar(20000);
                        i--;
                        continue;
                    }
                    if (r.tipo === 'grande' && durls.length > 1) {
                        const mitad = Math.ceil(durls.length / 2);
                        estadoIA.textContent = `${etiqueta}: lote muy pesado, dividiendo en 2…`;
                        const a = await extraerLote(nombresPag.slice(0, mitad), durls.slice(0, mitad), etiqueta + 'a');
                        const b = await extraerLote(nombresPag.slice(mitad), durls.slice(mitad), etiqueta + 'b');
                        return a.concat(b);
                    }
                    diag.ultimoError = `${etiqueta}: ${r.msg}`;
                    pintarDiag();
                }
                throw new Error(diag.ultimoError + ' Se probaron los modelos Flash disponibles para este lote.');
            }

            function fusionarCarreras(nuevas) {
                for (const c of (Array.isArray(nuevas) ? nuevas : [])) {
                    if (!c || typeof c !== 'object') continue;
                    c.ejemplares = Array.isArray(c.ejemplares) ? c.ejemplares : [];
                    const key = `${String(c.hipodromo || '').toUpperCase()}|${c.carrera ?? ''}`;
                    const ex = (key === '|') ? null : estado.carreras.find(x => `${String(x.hipodromo || '').toUpperCase()}|${x.carrera ?? ''}` === key);
                    if (!ex) { estado.carreras.push(c); continue; }
                    const nums = new Set((ex.ejemplares || []).map(e => String(e.numero)));
                    c.ejemplares.forEach(e => { if (!nums.has(String(e.numero))) { ex.ejemplares.push(e); nums.add(String(e.numero)); } });
                }
            }

            const incluidas = estado.paginas.filter(p => p.incluida);
            const TAM_LOTE = 3;
            const lotes = [];
            for (let i = 0; i < incluidas.length; i += TAM_LOTE) lotes.push(incluidas.slice(i, i + TAM_LOTE));
            pintarDiag('modelos a probar por lote: ' + modelos.join(', '));

            estado.carreras = [];
            let loteN = 0;
            let ciclo = 1;
            let cuotaTotal = false; // ninguna familia de Gemini respondió por cuota
            while (true) {
                for (const lote of lotes) {
                    loteN++;
                    const etiqueta = `Lote ${loteN}/${lotes.length} (pág. ${lote.map(p => p.num).join(',')})`;
                    if (!cuotaTotal) {
                        estadoIA.textContent = `${etiqueta}: enviando a la IA…`;
                        window.clubIndicador?.accion(`La IA lee el programa: lote ${loteN} de ${lotes.length}…`);
                        window.clubIndicador?.progreso(loteN / lotes.length);
                        pintarDiag(etiqueta + ' en curso…');
                    }
                    try {
                        const carreras = await extraerLote(lote.map(p => p.num), lote.map(p => p.durl), etiqueta);
                        fusionarCarreras(carreras);
                        estadoIA.textContent = `${etiqueta}: ${carreras.length} carrera(s). Total acumulado: ${estado.carreras.length}.`;
                        pintarDiag();
                    } catch (errLote) {
                        if (/clave|API key/i.test(errLote.message || '')) throw errLote;
                        diag.ultimoError = `${etiqueta}: ${errLote.message}`;
                        pintarDiag();
                        clubUI.toast(`${etiqueta} falló (${errLote.message}).`, /CUOTA DIARIA/i.test(errLote.message || '') ? 'warning' : 'error');
                        if (/CUOTA DIARIA/i.test(errLote.message || '')) { cuotaTotal = true; break; }
                    }
                }
                // ¿Resultado aunque sea parcial? Se entrega AHORA.
                if (estado.carreras.length > 0) break;
                // Cuota diaria agotada en TODAS las familias: esperar es inútil.
                if (cuotaTotal) break;
                // Sin resultados por fallo/saturación: se rehace el ciclo completo
                // automáticamente (máx 3) antes de declarar fracaso.
                if (ciclo >= 3 || !diag.ultimoError) break;
                ciclo++;
                estadoIA.textContent = `Sin carreras aún: ${diag.ultimoError}. Reintentando el ciclo completo (${ciclo}/3) en 30 seg…`;
                pintarDiag(`reintento del ciclo completo #${ciclo} tras 30s (saturación/fallo)…`);
                window.clubIndicador?.accion(`Reintento de extracción (ciclo ${ciclo}/3)…`);
                await esperar(30000);
                loteN = 0;
            }

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
                // por detrás y NO bloquea las cards (antes, si la tabla 'ejemplares'
                // faltaba o tardaba, el resultado jamás aparecía).
                if (cuotaTotal) clubUI.toast(`Cuota agotada en parte de Gemini: se muestra el resultado PARCIAL extraído (${estado.carreras.length} carrera(s)).`, 'warning');
                estado.carreras.forEach(c => { c.enviada = false; c.aplicada = false; });
                persistirRegistro();
                renderCarreras({ nuevos: 0, vinculados: 0 });
                resultadoGaceta.classList.remove('hidden');
                estadoIA.textContent = (cuotaTotal ? 'PARCIAL · ' : '') + `Listo: ${estado.carreras.length} carrera(s) transcritas. Vinculando padrón…`;
                window.clubIndicador?.listo(`${estado.carreras.length} carrera(s) extraídas`);
                guardarHistorial();
                if (window.clubDB?.logAccion) window.clubDB.logAccion('GACETA_IA', `transcrita: ${estado.carreras.length} carreras${cuotaTotal ? ' (parcial por cuota)' : ''}`);
                registrarPadron()
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

    function coaccionarCarreras(v) {
        if (Array.isArray(v)) return v;
        if (v && typeof v === 'object') {
            if (Array.isArray(v.carrera)) return v.carrera;
            const vals = Object.values(v);
            if (vals.length && typeof vals[0] === 'object') return vals;
        }
        return [];
    }

    function parsearJSON(texto) {
        let t = (texto || '').trim();
        const cercos = t.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (cercos) t = cercos[1].trim();
        const intentos = [];
        try { intentos.push(JSON.parse(t)); } catch (e) { /* sigue */ }
        const ini = t.indexOf('{');
        const fin = t.lastIndexOf('}');
        if (ini >= 0 && fin > ini) {
            try { intentos.push(JSON.parse(t.slice(ini, fin + 1))); } catch (e2) { /* sigue */ }
        }
        const iniArr = t.indexOf('[');
        const finArr = t.lastIndexOf(']');
        if (iniArr >= 0 && finArr > iniArr) {
            try { intentos.push(JSON.parse(t.slice(iniArr, finArr + 1))); } catch (e3) { /* sigue */ }
        }
        for (const obj of intentos) {
            if (Array.isArray(obj)) return obj;
            if (obj && typeof obj === 'object') {
                const c = coaccionarCarreras(obj.carreras);
                if (c.length) return c;
                const c2 = coaccionarCarreras(obj.carrera);
                if (c2.length) return c2;
            }
        }
        return [];
    }

    async function registrarPadron() {
        const totales = { nuevos: 0, vinculados: 0, fallidos: 0, errorDb: null };
        if (!window.supabase) return totales;
        if (!Array.isArray(estado.carreras)) estado.carreras = [];

        let mapa = new Map();
        try {
            const { data, error } = await window.supabase.from('ejemplares').select('id, nombre, nacionalidad');
            if (error) throw error;
            (data || []).forEach(e => {
                const clave = `${String(e.nombre || '').trim().toUpperCase()}|${String(e.nacionalidad || 'VE').trim().toUpperCase() || 'VE'}`;
                mapa.set(clave, e.id);
            });
        } catch (e) {
            const n = estado.carreras.reduce((a, c) => a + (Array.isArray(c.ejemplares) ? c.ejemplares.length : 0), 0);
            totales.fallidos = n;
            totales.errorDb = e.message || String(e);
            return totales;
        }

        for (const c of estado.carreras) {
            c.ejemplares = Array.isArray(c.ejemplares) ? c.ejemplares : [];
            for (const ej of c.ejemplares) {
                const nombre = String(ej.nombre || '').trim().toUpperCase();
                const nac = (String(ej.nacionalidad || 'VE').trim().toUpperCase() || 'VE');
                ej.nombre = nombre;
                ej.nacionalidad = nac;
                if (!nombre) { ej.ejemplar_id = null; continue; }
                const clave = `${nombre}|${nac}`;
                if (mapa.has(clave)) {
                    ej.ejemplar_id = mapa.get(clave);
                    ej.nuevo = false;
                    totales.vinculados++;
                    continue;
                }
                try {
                    const { data, error } = await window.supabase.from('ejemplares').insert({ nombre, nacionalidad: nac }).select('id').single();
                    if (error) {
                        if (error.code === '23505') {
                            const { data: existente } = await window.supabase.from('ejemplares').select('id').eq('nombre', nombre).eq('nacionalidad', nac).limit(1).single();
                            if (existente) { ej.ejemplar_id = existente.id; ej.nuevo = false; totales.vinculados++; continue; }
                        }
                        ej.ejemplar_id = null; ej.nuevo = false; totales.fallidos++; continue;
                    }
                    if (data?.id) {
                        ej.ejemplar_id = data.id; ej.nuevo = true; totales.nuevos++;
                        mapa.set(clave, data.id);
                    } else {
                        ej.ejemplar_id = null; ej.nuevo = false; totales.fallidos++;
                    }
                } catch (e2) {
                    ej.ejemplar_id = null; ej.nuevo = false; totales.fallidos++;
                }
            }
        }
        return totales;
    }

    async function guardarHistorial() {
        try {
            const carreras = estado.carreras;
            const fecha = carreras.find(c => c.fecha)?.fecha || null;
            const { error } = await window.supabase.from('gaceta_procesada').insert({
                fecha_gaceta: fecha || null,
                num_carreras: carreras.length,
                contenido: carreras,
                creado_por: window.clubAuth?.getSesion?.()?.nombre || 'desconocido'
            });
            if (error) throw error;
        } catch (e) {
            console.warn('No se guardó el historial (gaceta_procesada):', e.message || e);
            if (!sessionStorage.getItem('club_gaceta_sql_aviso')) {
                sessionStorage.setItem('club_gaceta_sql_aviso', '1');
                clubUI.toast('La gaceta se procesó bien, pero el historial no se pudo guardar (falta la tabla o permisos para "gaceta_procesada"). Ejecute el paquete SQL completo y recargue.', 'warning');
            }
        }
    }

    // ---------- RENDER ----------
    function renderCarreras(resPadron) {
        document.getElementById('resumenExtraccion').textContent = `(${estado.carreras.length} carreras · ${resPadron.nuevos} nuevos / ${resPadron.vinculados} vinculados al padrón)`;
        if (estado.carreras.length === 0) {
            carrerasGaceta.innerHTML = '<div class="col-span-full text-center p-8 text-slate-500 italic">No se detectaron carreras. Pruebe con más páginas del PDF o mejor resolución de imagen.</div>';
            return;
        }
        carrerasGaceta.innerHTML = estado.carreras.map((c, i) => `
            <div class="bg-white rounded-xl shadow-sm border border-slate-200 p-4" data-carrera="${i}" data-numero="${c.carrera || i + 1}">
                <div class="flex justify-between items-center mb-2">
                    <span class="font-black text-cyan-700 uppercase flex items-center gap-2"><input type="checkbox" class="gac-sel w-4 h-4 accent-cyan-600" checked title="Incluir al enviar todo al Ensamblaje"><i class="fas fa-flag-checkered mr-1"></i> Carrera ${c.carrera || i + 1}</span>
                    <input class="gac-hipodromo text-right text-[11px] font-bold uppercase text-slate-500 bg-transparent border-b border-dotted border-slate-300 outline-none w-40" value="${c.hipodromo || ''}" placeholder="Hipódromo">
                </div>
                <div class="grid grid-cols-4 gap-2 mb-2">
                    <div>
                        <label class="block text-[9px] font-bold text-slate-500 uppercase">Distancia (m)</label>
                        <input type="number" class="gac-distancia w-full border border-slate-300 rounded px-2 py-1 text-xs font-bold text-center outline-none" value="${c.distancia || ''}" placeholder="m">
                    </div>
                    <div>
                        <label class="block text-[9px] font-bold text-slate-500 uppercase">Superficie</label>
                        <select class="gac-superficie w-full border border-slate-300 rounded px-1 py-1 text-xs font-bold outline-none bg-slate-50 uppercase">
                            ${SUPERFICIES.map(s => `<option value="${s}" ${String(c.superficie || '').toUpperCase() === s ? 'selected' : ''}>${s}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label class="block text-[9px] font-bold text-slate-500 uppercase">Premio ($)</label>
                        <input type="number" class="gac-premio w-full border border-slate-300 rounded px-2 py-1 text-xs font-bold text-center outline-none" value="${c.premio || ''}" placeholder="$">
                    </div>
                    <div>
                        <label class="block text-[9px] font-bold text-slate-500 uppercase">Fecha</label>
                        <input type="date" class="gac-fecha w-full border border-slate-300 rounded px-1 py-1 text-xs font-bold outline-none" value="${c.fecha || ''}">
                    </div>
                </div>
                <div class="border border-slate-200 rounded-lg overflow-hidden mb-2">
                    <table class="w-full text-xs">
                        <thead class="bg-slate-100 text-slate-600">
                            <tr>
                                <th class="p-1.5 text-center font-bold w-10">N°</th>
                                <th class="p-1.5 text-left font-bold">Ejemplar</th>
                                <th class="p-1.5 text-center font-bold w-20">Nac.</th>
                                <th class="p-1.5 text-right font-bold w-20">Valor</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${(Array.isArray(c.ejemplares) ? c.ejemplares : []).map(ej => `
                                <tr class="gac-fila-ejemplar border-t border-slate-100">
                                    <td class="p-1 text-center"><input class="gac-num w-10 border border-slate-200 rounded px-1 py-0.5 text-center text-xs font-bold outline-none" value="${ej.numero ?? ''}"></td>
                                    <td class="p-1"><input class="gac-nombre w-full border border-slate-200 rounded px-1 py-0.5 text-xs font-bold uppercase outline-none" value="${ej.nombre || ''}">
                                        ${ej.ejemplar_id ? `<span class="gac-badge-padron text-[9px] font-black ${ej.nuevo ? 'text-emerald-600' : 'text-slate-400'}">${ej.nuevo ? '★ nuevo' : '✓ vinculado'}</span>` : '<span class="gac-badge-padron text-[9px] text-red-500 font-bold">sin padrón</span>'}
                                    </td>
                                    <td class="p-1 text-center">
                                        <select class="gac-nac w-full border border-slate-200 rounded px-0.5 py-0.5 text-[10px] font-bold outline-none uppercase">
                                            ${NACIONALIDADES.map(n => `<option value="${n}" ${(ej.nacionalidad || 'VE') === n ? 'selected' : ''}>${n}</option>`).join('')}
                                        </select>
                                    </td>
                                    <td class="p-1 text-right"><input type="number" step="0.1" class="gac-valor w-16 border border-slate-200 rounded px-1 py-0.5 text-right text-xs font-bold text-blue-700 outline-none" value="${ej.valor ?? ej.pts ?? ''}"></td>
                                </tr>
                            `).join('') || '<tr><td colspan="4" class="p-3 text-center text-slate-400 italic">Sin ejemplares detectados</td></tr>'}
                        </tbody>
                    </table>
                </div>
                <button class="btn-cargar-ensamblaje w-full bg-cyan-600 text-white font-bold py-2 rounded-lg shadow hover:bg-cyan-700 transition-colors text-xs uppercase tracking-wide" data-acc="cargar" title="Lleva esta carrera al Ensamblaje para revisar sus VALORES y publicar">
                    <i class="fas fa-arrow-right mr-1"></i> Cargar en el Ensamblaje
                </button>
            </div>
        `).join('');
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
            const nac = (fila.querySelector('.gac-nac')?.value || 'VE').toUpperCase();
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
            span.textContent = info.ejemplar_id ? (info.nuevo ? '★ nuevo' : '✓ vinculado') : 'sin padrón';
            span.className = 'gac-badge-padron text-[9px] font-black' + (info.ejemplar_id ? (info.nuevo ? ' text-emerald-600' : ' text-slate-400') : ' text-red-500 font-bold');
        });
    }

    // Lee UNA carrera desde su card (usa los valores editados en pantalla)
    function leerCarreraDeCard(card) {
        const caballos = [...card.querySelectorAll('.gac-fila-ejemplar')].map(f => ({
            numero: f.querySelector('.gac-num')?.value?.trim() || '',
            nombre: f.querySelector('.gac-nombre')?.value?.trim().toUpperCase() || '',
            nacionalidad: f.querySelector('.gac-nac')?.value || 'VE',
            valor: parseFloat(f.querySelector('.gac-valor')?.value) || parseFloat(f.querySelector('.gac-pts')?.value) || 0
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
        const cards = [...carrerasGaceta.querySelectorAll('.bg-white')];
        const sel = carrerasGaceta.querySelectorAll('.gac-sel:checked').length;
        lbl.textContent = sel === 0 ? 'Enviar al Ensamblaje (sin selección)'
            : (sel === cards.length ? `Enviar TODAS al Ensamblaje (${sel})` : `Enviar seleccionadas (${sel})`);
    }

    carrerasGaceta.addEventListener('change', (e) => {
        if (e.target.closest('.gac-sel')) actualizarBtnTodo();
    });

    // Con Tab (o Enter) sobre el VALOR de un ejemplar salta directo al valor
    // del siguiente ejemplar, para no pasar por número/nombre/nacionalidad.
    carrerasGaceta.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== 'Tab') return;
        const inp = e.target.closest('.gac-valor');
        if (!inp) return;
        e.preventDefault();
        const valores = [...carrerasGaceta.querySelectorAll('.gac-valor')];
        const i = valores.indexOf(inp);
        if (i === -1) return;
        const siguiente = valores[(i + 1) % valores.length];
        siguiente.focus();
        siguiente.select();
    });

    // ---------- LIMPIAR / RECUPERAR REGISTRO ----------
    function limpiarRegistro() {
        try { localStorage.removeItem(REGISTRO_KEY); } catch (e) { /* vacío */ }
        try { sessionStorage.removeItem(REGISTRO_KEY); } catch (e) { /* vacío */ }
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
        const arr = leerRegistro();
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
        const resPadron = await registrarPadron();
        persistirRegistro();
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
        const cards = [...carrerasGaceta.querySelectorAll('.bg-white')]
            .filter(card => card.querySelector('.gac-sel')?.checked);
        if (cards.length === 0) return clubUI.toast('Marca con el ✓ al menos una carrera para enviar.', 'warning');
        const carreras = cards.map(leerCarreraDeCard).filter(c => c.caballos.length > 0);
        if (carreras.length === 0) return clubUI.toast('Las carreras marcadas no tienen ejemplares con nombre.', 'warning');
        marcarEnviadas(carreras);
        const total = acumularEnEnsamblaje(carreras);
        clubUI.toast(`${carreras.length} carrera(s) enviada(s) al Ensamblaje (total en el envío: ${total}). Revise y publique.`, 'success');
        setTimeout(() => location.href = 'tablas.html', 600);
    });

    carrerasGaceta.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-acc="cargar"]');
        if (!btn) return;
        const card = btn.closest('.bg-white');
        const carrera = leerCarreraDeCard(card);
        if (carrera.caballos.length === 0) return clubUI.toast('Esta carrera no tiene ejemplares con nombre.', 'warning');

        marcarEnviadas([carrera]);
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
            const res = await registrarPadron();
            renderCarreras(res);
            if (res.errorDb) {
                clubUI.aviso('Padrón no disponible',
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
        const arr = leerRegistro();
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