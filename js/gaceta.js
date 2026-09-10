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
    const MODELOS_GEMINI = ['gemini-3.6-flash', 'gemini-3-flash', 'gemini-2.5-flash', 'gemini-2.0-flash'];

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
                    const vp = page.getViewport({ scale: 2.0 });
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.min(vp.width, 2000);
                    canvas.height = Math.round(canvas.width * (vp.height / vp.width));
                    const ctx = canvas.getContext('2d');
                    await page.render({ canvasContext: ctx, viewport: vp }).promise;
                    estado.paginas.push({ num: i, durl: canvas.toDataURL('image/jpeg', 0.9), incluida: true });
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
  - ejemplares: lista con numero (puesto/orden del ejemplar), nombre (MAYÚSCULAS, EXACTO como aparece), nacionalidad (país si se indica: VE, USA, BR, AR, CL, MX, PA, PE, CO, EC, UY; si no se indica usa VE), valor (monta/valor del ejemplar: número si aparece, si no 0. Acepta también la clave pts con el mismo significado)
REGLAS: NO inventes nombres ni datos; transcribe exactamente lo que lees. Si un ejemplar aparece repetido entre páginas, mantenlo tal cual. Si el documento no tiene carreras, devuelve {"carreras":[]}.
`;

        const intentos = estado.imagenes.length > 8
            ? [estado.imagenes, estado.imagenes.slice(0, 8)]
            : [estado.imagenes];

        try {
            async function pedirIA(durls, estricto) {
                const imgs = durls.map(d => {
                    const [, meta] = d.split(',');
                    const mime = d.split(';')[0].replace('data:', '');
                    return { inline_data: { mime_type: mime, data: meta } };
                });

                const parteTexto = estricto
                    ? 'Gaceta adjunta. Extrae las carreras y responde ÚNICAMENTE con JSON válido con el formato {"carreras":[...]}, sin markdown, sin comillas decorativas ni explicaciones.'
                    : 'Gaceta adjunta. Extrae las carreras y sus ejemplares.';

                const body = {
                    contents: [{ parts: [{ text: parteTexto }, ...imgs] }],
                    systemInstruction: { parts: [{ text: SYS }] },
                    generationConfig: estricto
                        ? { temperature: 0.2, maxOutputTokens: 8192, responseMimeType: 'application/json' }
                        : {
                            temperature: 0,
                            maxOutputTokens: 8192,
                            responseMimeType: 'application/json',
                            responseSchema: {
                                type: 'OBJECT',
                                properties: {
                                    carreras: {
                                        type: 'ARRAY',
                                        items: {
                                            type: 'OBJECT',
                                            properties: {
                                                carrera: { type: 'INTEGER' },
                                                hipodromo: { type: 'STRING' },
                                                fecha: { type: 'STRING' },
                                                distancia: { type: 'INTEGER' },
                                                superficie: { type: 'STRING' },
                                                premio: { type: 'NUMBER' },
                                                ejemplares: {
                                                    type: 'ARRAY',
                                                    items: {
                                                        type: 'OBJECT',
                                                        properties: {
                                                            numero: { type: 'INTEGER' },
                                                            nombre: { type: 'STRING' },
                                                            nacionalidad: { type: 'STRING' },
                                                            valor: { type: 'NUMBER' }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                };

                let ultimoError = null;
                const esperar = (ms) => new Promise(r => setTimeout(r, ms));
                const descubiertos = await listaModelosFlash(clave);
                const modelos = [...new Set(descubiertos.concat(MODELOS_GEMINI))].slice(0, 12);
                for (let i = 0; i < modelos.length; i++) {
                    const model = modelos[i];
                    if (i > 0) await esperar(1000);
                    let resp;
                    try {
                        resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': clave },
                            body: JSON.stringify(body)
                        });
                    } catch (errNet) {
                        ultimoError = `Sin conexión al probar ${model} (${errNet.message || 'red'}).`;
                        continue;
                    }

                    if (resp.status === 429) {
                        throw new Error('La cuota gratuita de IA está agotada en este momento. Espera unos minutos y reintenta, o usa otra clave de IA.');
                    }
                    if (resp.status === 404 || resp.status === 503) {
                        ultimoError = `Modelo ${model} no disponible o saturado (HTTP ${resp.status}), probando el siguiente...`;
                        continue;
                    }
                    if (!resp.ok) {
                        const txtErr = await resp.text();
                        let msg = `Error de IA (HTTP ${resp.status}).`;
                        try { msg = 'IA: ' + (JSON.parse(txtErr).error?.message || msg); } catch (e) { msg = txtErr.slice(0, 180); }
                        throw new Error(msg);
                    }

                    const datos = await resp.json();
                    const texto = (datos.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '').trim();
                    if (!texto) {
                        ultimoError = `Modelo ${model} respondió vacío, probando el siguiente...`;
                        continue;
                    }
                    return texto;
                }
                throw new Error(ultimoError + ' El sistema ya probó todos los modelos Flash disponibles. Espera 1–2 min y reintenta; si persiste, usa otra clave de IA (aistudio.google.com/apikey).');
            }

            let ultimoTexto = '';
            for (const durls of intentos) {
                ultimoTexto = await pedirIA(durls);
                estado.carreras = parsearJSON(ultimoTexto);
                if (estado.carreras.length > 0) break;
                if (durls.length > 8) {
                    estadoIA.textContent = 'No se detectaron carreras con todas las páginas; reintentando con las primeras 8…';
                    clubUI.toast('Sin carreras con todas las páginas; reintentando con las primeras 8.', 'warning');
                } else {
                    estadoIA.textContent = 'La IA no devolvió carreras; haciendo un segundo intento (JSON estricto)…';
                }
            }

            if (estado.carreras.length === 0) {
                ultimoTexto = await pedirIA(intentos[intentos.length - 1], true);
                estado.carreras = parsearJSON(ultimoTexto);
                if (estado.carreras.length === 0) {
                    console.warn('[gaceta] La IA respondió sin carreras. Texto recibido:\n', ultimoTexto);
                    estadoIA.textContent = 'No se extrajeron carreras. Respuesta de la IA: "' + (ultimoTexto || '').slice(0, 220) + '"';
                }
            }

            const resPadron = await registrarPadron();
            guardarHistorial();
            renderCarreras(resPadron);

            resultadoGaceta.classList.remove('hidden');
            estadoIA.textContent = `Listo: ${estado.carreras.length} carrera(s), ${resPadron.nuevos} ejemplar(es) nuevos registrados.`;
            if (window.clubDB?.logAccion) window.clubDB.logAccion('GACETA_IA', `transcrita: ${estado.carreras.length} carreras, ${resPadron.nuevos} ejemplares nuevos`);
            if (estado.carreras.length > 0) window.clubIndicador?.listo(`${estado.carreras.length} carrera(s) extraídas`);
        } catch (e) {
            console.error(e);
            estadoIA.textContent = 'ERROR: ' + (e.message || e);
            clubUI.toast('Falló la transformación con IA.', 'error');
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
        let nuevos = 0, vinculados = 0;
        if (!Array.isArray(estado.carreras)) estado.carreras = [];
        for (const c of estado.carreras) {
            c.ejemplares = c.ejemplares || [];
            for (const ej of c.ejemplares) {
                const nombre = String(ej.nombre || '').trim().toUpperCase();
                const nac = String(ej.nacionalidad || 'VE').trim().toUpperCase() || 'VE';
                ej.nombre = nombre;
                ej.nacionalidad = nac;
                if (!nombre) { ej.ejemplar_id = null; continue; }
                const existe = await window.supabase.from('ejemplares').select('id').eq('nombre', nombre).eq('nacionalidad', nac).maybeSingle();
                if (existe?.data) {
                    ej.ejemplar_id = existe.data.id; ej.nuevo = false; vinculados++;
                } else {
                    const insertado = await window.supabase.from('ejemplares').insert({ nombre, nacionalidad: nac }).select('id').single();
                    if (!insertado.error) { ej.ejemplar_id = insertado.data.id; ej.nuevo = true; nuevos++; }
                    else { ej.ejemplar_id = null; console.warn('No se pudo registrar ejemplar:', insertado.error); }
                }
            }
        }
        return { nuevos, vinculados };
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
                    <span class="font-black text-cyan-700 uppercase"><i class="fas fa-flag-checkered mr-1"></i> Carrera ${c.carrera || i + 1}</span>
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
                            ${SUPERFICIES.map(s => `<option value="${s}" ${(c.superficie || '').toUpperCase() === s ? 'selected' : ''}>${s}</option>`).join('')}
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
                            ${(c.ejemplares || []).map(ej => `
                                <tr class="gac-fila-ejemplar border-t border-slate-100">
                                    <td class="p-1 text-center"><input class="gac-num w-10 border border-slate-200 rounded px-1 py-0.5 text-center text-xs font-bold outline-none" value="${ej.numero ?? ''}"></td>
                                    <td class="p-1"><input class="gac-nombre w-full border border-slate-200 rounded px-1 py-0.5 text-xs font-bold uppercase outline-none" value="${ej.nombre || ''}">
                                        ${ej.ejemplar_id ? `<span class="text-[9px] font-black ${ej.nuevo ? 'text-emerald-600' : 'text-slate-400'}">${ej.nuevo ? '★ nuevo' : '✓ vinculado'}</span>` : '<span class="text-[9px] text-red-500 font-bold">sin padrón</span>'}
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
    }

    carrerasGaceta.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-acc="cargar"]');
        if (!btn) return;
        const card = btn.closest('.bg-white');
        const caballos = [...card.querySelectorAll('.gac-fila-ejemplar')].map(f => ({
            numero: f.querySelector('.gac-num')?.value?.trim() || '',
            nombre: f.querySelector('.gac-nombre')?.value?.trim().toUpperCase() || '',
            nacionalidad: f.querySelector('.gac-nac')?.value || 'VE',
            valor: parseFloat(f.querySelector('.gac-valor')?.value) || parseFloat(f.querySelector('.gac-pts')?.value) || 0
        })).filter(c => c.nombre);

        const carrera = {
            hipodromo: card.querySelector('.gac-hipodromo')?.value?.trim().toUpperCase() || '',
            fecha: card.querySelector('.gac-fecha')?.value || null,
            carrera: parseInt(card.dataset.numero) || null,
            distancia: parseInt(card.querySelector('.gac-distancia')?.value) || 0,
            superficie: card.querySelector('.gac-superficie')?.value || 'ARENA',
            premio: parseFloat(card.querySelector('.gac-premio')?.value) || 0,
            caballos
        };

        // Acumula la carrera en el Ensamblaje (varias carreras por envío)
        const leerArr = () => {
            try { const x = JSON.parse(sessionStorage.getItem('ensamblaje_carreras')); if (Array.isArray(x)) return x; } catch (err) { /* nada */ }
            try { const x = JSON.parse(localStorage.getItem('ensamblaje_carreras')); if (Array.isArray(x)) return x; } catch (err) { /* nada */ }
            return [];
        };
        const arr = leerArr();
        arr.push(carrera);
        sessionStorage.setItem('ensamblaje_carreras', JSON.stringify(arr));
        localStorage.setItem('ensamblaje_carreras', JSON.stringify(arr));
        // Por compatibilidad se conserva también la carrera única
        sessionStorage.setItem('gaceta_prellenado', JSON.stringify(carrera));
        localStorage.setItem('gaceta_prellenado', JSON.stringify(carrera));

        clubUI.toast(`Carrera C${carrera.carrera || '?'} enviada al Ensamblaje (total en el envío: ${arr.length}). Revise y publique.`, 'success');
        setTimeout(() => location.href = 'tablas.html', 600);
    });

    document.getElementById('btnRegistrarPadron').addEventListener('click', async () => {
        const res = await registrarPadron();
        clubUI.toast(`Padrón actualizado: ${res.nuevos} nuevos, ${res.vinculados} ya vinculados.`, 'success');
        renderCarreras(res);
    });

    document.getElementById('btnRecargarGaceta').addEventListener('click', () => {
        miniminiaturas(); estado.imagenes = []; inputArchivo.value = '';
        claveOpenAI.value = localStorage.getItem(CLAVE_KEY) || '';
        validarHabilitacion();
    });

    validarHabilitacion();
});