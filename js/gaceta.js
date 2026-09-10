document.addEventListener('DOMContentLoaded', () => {

    const zonaDrop = document.getElementById('zonaDrop');
    const inputArchivo = document.getElementById('archivoGaceta');
    const btnTransformar = document.getElementById('btnTransformar');
    const btnGuardarClave = document.getElementById('btnGuardarClave');
    const claveOpenAI = document.getElementById('claveOpenAI');
    const estadoIA = document.getElementById('estadoIA');
    const maxPaginas = document.getElementById('maxPaginas');
    const miniaturas = document.getElementById('miniaturas');
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

    let estado = { imagenes: [], carreras: [] };

    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

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
        try {
            if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
                const buf = await file.arrayBuffer();
                const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
                const paginas = Math.min(parseInt(maxPaginas.value) || 8, pdf.numPages);
                for (let i = 1; i <= paginas; i++) {
                    const page = await pdf.getPage(i);
                    const vp = page.getViewport({ scale: 1.6 });
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.min(vp.width, 1500);
                    canvas.height = Math.round(canvas.width * (vp.height / vp.width));
                    const ctx = canvas.getContext('2d');
                    await page.render({ canvasContext: ctx, viewport: vp }).promise;
                    estado.imagenes.push(canvas.toDataURL('image/jpeg', 0.85));
                    agregarMiniatura(estado.imagenes[estado.imagenes.length - 1]);
                }
                estadoIA.textContent = `PDF: ${paginas} página(s) listas.`;
            } else {
                const durl = await dataURLImagen(file);
                estado.imagenes.push(durl);
                agregarMiniatura(durl);
                estadoIA.textContent = 'Imagen lista.';
            }
            previewGaceta.classList.remove('hidden');
        } catch (e) {
            console.error(e);
            estadoIA.textContent = 'No se pudo leer el archivo. (¿PDF? ¿Imagen?).';
            clubUI.toast('No se pudo leer el archivo.', 'error');
        }
        validarHabilitacion();
    }

    function agregarMiniatura(durl) {
        const img = document.createElement('img');
        img.src = durl;
        img.className = 'rounded border border-slate-200 h-16 object-cover w-full';
        miniaturas.appendChild(img);
    }

    function miniminiaturas() { miniaturas.innerHTML = ''; previewGaceta.classList.add('hidden'); }

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
  - ejemplares: lista con numero (puesto/orden del ejemplar), nombre (MAYÚSCULAS, EXACTO como aparece), nacionalidad (país si se indica: VE, USA, BR, AR, CL, MX, PA, PE, CO, EC, UY; si no se indica usa VE), pts (valor/bolígrafo numérico si aparece; si no 0)
REGLAS: NO inventes nombres ni datos; transcribe exactamente lo que lees. Si un ejemplar aparece repetido entre páginas, mantenlo tal cual. Si el documento no tiene carreras, devuelve {"carreras":[]}.
`;

        try {
            const imgs = estado.imagenes.map(d => {
                const [, meta] = d.split(',');
                const mime = d.split(';')[0].replace('data:', '');
                return { inline_data: { mime_type: mime, data: meta } };
            });

            const body = {
                contents: [{ parts: [{ text: 'Gaceta adjunta. Extrae las carreras y sus ejemplares.' }, ...imgs] }],
                systemInstruction: { parts: [{ text: SYS }] },
                generationConfig: {
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
                                                    pts: { type: 'NUMBER' }
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

            let texto = '';
            let ultimoError = null;
            const descubiertos = await listaModelosFlash(clave);
            const modelos = [...new Set(descubiertos.concat(MODELOS_GEMINI))];
            for (const model of modelos) {
                const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': clave },
                    body: JSON.stringify(body)
                });

                if (resp.status === 404 || resp.status === 503) {
                    ultimoError = `Modelo ${model} no disponible o saturado, probando otro...`;
                    continue;
                }
                if (!resp.ok) {
                    const txtErr = await resp.text();
                    let msg = `Error de IA (HTTP ${resp.status}).`;
                    try { msg = 'IA: ' + (JSON.parse(txtErr).error?.message || msg); } catch (e) { msg = txtErr.slice(0, 180); }
                    if (resp.status === 429) msg = 'IA agotó la cuota gratuita por ahora. Espera unos minutos y reintenta, o usa otra cuenta de Google.';
                    throw new Error(msg);
                }

                const datos = await resp.json();
                texto = (datos.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '').trim();
                if (!texto) {
                    ultimoError = `Modelo ${model} respondió vacío, probando otro...`;
                    continue;
                }
                break;
            }

            if (ultimoError && !texto) throw new Error(ultimoError);

            estado.carreras = parsearJSON(texto);

            const resPadron = await registrarPadron();
            guardarHistorial();
            renderCarreras(resPadron);

            resultadoGaceta.classList.remove('hidden');
            estadoIA.textContent = `Listo: ${estado.carreras.length} carrera(s), ${resPadron.nuevos} ejemplar(es) nuevos registrados.`;
            if (window.clubDB?.logAccion) window.clubDB.logAccion('GACETA_IA', `transcrita: ${estado.carreras.length} carreras, ${resPadron.nuevos} ejemplares nuevos`);
        } catch (e) {
            console.error(e);
            estadoIA.textContent = 'ERROR: ' + (e.message || e);
            clubUI.toast('Falló la transformación con IA.', 'error');
        }
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
            await window.supabase.from('gaceta_procesada').insert({
                fecha_gaceta: fecha || null,
                num_carreras: carreras.length,
                contenido: carreras,
                creado_por: window.clubAuth?.getSesion?.()?.nombre || 'desconocido'
            });
        } catch (e) { console.warn('No se guardó el historial:', e); }
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
                                <th class="p-1.5 text-right font-bold w-20">Puntos</th>
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
                                    <td class="p-1 text-right"><input type="number" step="0.1" class="gac-pts w-16 border border-slate-200 rounded px-1 py-0.5 text-right text-xs font-bold text-blue-700 outline-none" value="${ej.pts ?? ''}"></td>
                                </tr>
                            `).join('') || '<tr><td colspan="4" class="p-3 text-center text-slate-400 italic">Sin ejemplares detectados</td></tr>'}
                        </tbody>
                    </table>
                </div>
                <button class="btn-cargar-ensamblaje w-full bg-cyan-600 text-white font-bold py-2 rounded-lg shadow hover:bg-cyan-700 transition-colors text-xs uppercase tracking-wide" data-acc="cargar" title="Lleva esta carrera al Ensamblaje para revisar PTS y publicar">
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
            pts: parseFloat(f.querySelector('.gac-pts')?.value) || 0
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
        sessionStorage.setItem('gaceta_prellenado', JSON.stringify(carrera));
        clubUI.toast('Carrera enviada al Ensamblaje. Revise y publique.', 'success');
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