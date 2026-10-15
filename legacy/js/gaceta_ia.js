// ============================================================
//  gaceta_ia.js — Motor de extracción de carreras con Gemini.
//  Encapsula el envío por LOTES, reintentos por saturación/cuota,
//  cambio de modelo y fusión de resultados. No pinta cards: devuelve
//  las carreras extraídas y gaceta.js (UI) se encarga de mostrarlas.
//  Requiere: window.clubGacetaHelpers (gaceta_helpers.js)
// ============================================================
window.clubGacetaIA = (() => {

    const H = window.clubGacetaHelpers;
    const MODELOS_GEMINI = H.MODELOS_GEMINI;
    const esperar = (ms) => new Promise(r => setTimeout(r, ms));

    // Modelos Flash de respaldo (la app primero consulta a la API cuáles existen hoy)
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
  - ejemplares: lista con numero (puesto/orden del ejemplar), nombre (MAYÚSCULAS, EXACTO como aparece), nacionalidad (país si se indica: VE, USA, BR, AR, CL, MX, PA, PE, CO, EC, UY; si NO se indica: USA si el hipódromo es de Estados Unidos, si no VE), valor (monta del ejemplar: SOLO número si aparece, si no 0)
REGLAS: NO inventes nombres ni datos; transcribe exactamente lo que lees. REGISTRA TODOS los ejemplares de cada carrera sin omitir ninguno (todos los números de participante que aparezcan). Si un ejemplar aparece repetido entre páginas, mantenlo tal cual. Si el documento no tiene carreras, devuelve {"carreras":[]}.
`;

    function fusionarCarreras(carreras, nuevas) {
        for (const c of (Array.isArray(nuevas) ? nuevas : [])) {
            if (!c || typeof c !== 'object') continue;
            c.ejemplares = Array.isArray(c.ejemplares) ? c.ejemplares : [];
            c.ejemplares.forEach(ej => { ej.nacionalidad = H.nacEjemplar(ej, c.hipodromo); ej.nombre = String(ej.nombre || '').trim().toUpperCase(); });
            const key = `${String(c.hipodromo || '').toUpperCase()}|${c.carrera ?? ''}`;
            const ex = (key === '|') ? null : carreras.find(x => `${String(x.hipodromo || '').toUpperCase()}|${x.carrera ?? ''}` === key);
            if (!ex) { carreras.push(c); continue; }
            const nums = new Set((ex.ejemplares || []).map(e => String(e.numero)));
            c.ejemplares.forEach(e => { if (!nums.has(String(e.numero))) { ex.ejemplares.push(e); nums.add(String(e.numero)); } });
        }
    }

    // ---------- Motor de extracción por LOTES ----------
    // Cada lote (3 páginas) es liviano: evita el HTTP 400 por petición
    // gigante y no quema la cuota gratuita de un solo golpe.
    async function transformar({ clave, imagenes }) {
        const estadoIA = document.getElementById('estadoIA');
        const diagEl = document.getElementById('diagGaceta');
        const clubUI = window.clubUI;
        const indicador = window.clubIndicador;

        const carreras = [];
        const diag = { respondio: '', ultimoError: '' };
        const pesoKB = (durls) => Math.round(durls.reduce((a, d) => a + (((d.split(',')[1]) || '').length * 3 / 4), 0) / 1024);
        function pintarDiag(extra) {
            if (!diagEl) return;
            diagEl.classList.remove('hidden');
            diagEl.textContent =
                `clave: ${clave ? clave.slice(0, 4) + '…' + clave.slice(-3) + ' (' + clave.length + ' car.)' : 'AUSENTE'}\n` +
                `páginas elegidas: ${imagenes.length} · peso aprox: ${(pesoKB(imagenes) / 1024).toFixed(1)} MB\n` +
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
                let lotesCarreras = [];
                if (r.ok) {
                    lotesCarreras = H.parsearJSON(r.texto);
                    if (lotesCarreras.length === 0) {
                        if (estadoIA) estadoIA.textContent = `${etiqueta}: sin carreras, segundo intento (JSON estricto)…`;
                        const r2 = await llamarModelo(model, durls, true);
                        if (r2.ok) { r = r2; lotesCarreras = H.parsearJSON(r2.texto); }
                        else { r = r2; }
                    }
                    if (r.ok && lotesCarreras.length > 0) { diag.respondio = model; return lotesCarreras; }
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
                        if (estadoIA) estadoIA.textContent = `${etiqueta}: límite por minuto de ${model}, esperando 65s y reintentando…`;
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
                    if (estadoIA) estadoIA.textContent = `${etiqueta}: ${model} saturado, esperando 20s y reintentando…`;
                    pintarDiag(`${etiqueta}: esperando 20s por saturación de ${model}…`);
                    await esperar(20000);
                    i--;
                    continue;
                }
                if (r.tipo === 'grande' && durls.length > 1) {
                    const mitad = Math.ceil(durls.length / 2);
                    if (estadoIA) estadoIA.textContent = `${etiqueta}: lote muy pesado, dividiendo en 2…`;
                    const a = await extraerLote(nombresPag.slice(0, mitad), durls.slice(0, mitad), etiqueta + 'a');
                    const b = await extraerLote(nombresPag.slice(mitad), durls.slice(mitad), etiqueta + 'b');
                    return a.concat(b);
                }
                diag.ultimoError = `${etiqueta}: ${r.msg}`;
                pintarDiag();
            }
            throw new Error(diag.ultimoError + ' Se probaron los modelos Flash disponibles para este lote.');
        }

        const incluidas = (imagenes || []).map((durl, i) => ({ num: i + 1, durl }));
        const TAM_LOTE = 3;
        const lotes = [];
        for (let i = 0; i < incluidas.length; i += TAM_LOTE) lotes.push(incluidas.slice(i, i + TAM_LOTE));
        pintarDiag('modelos a probar por lote: ' + modelos.join(', '));

        let loteN = 0;
        let ciclo = 1;
        let cuotaTotal = false; // ninguna familia de Gemini respondió por cuota
        while (true) {
            for (const lote of lotes) {
                loteN++;
                const etiqueta = `Lote ${loteN}/${lotes.length} (pág. ${lote.map(p => p.num).join(',')})`;
                if (!cuotaTotal) {
                    if (estadoIA) estadoIA.textContent = `${etiqueta}: enviando a la IA…`;
                    indicador?.accion(`La IA lee el programa: lote ${loteN} de ${lotes.length}…`);
                    indicador?.progreso(loteN / lotes.length);
                    pintarDiag(etiqueta + ' en curso…');
                }
                try {
                    const nuevas = await extraerLote(lote.map(p => p.num), lote.map(p => p.durl), etiqueta);
                    fusionarCarreras(carreras, nuevas);
                    if (estadoIA) estadoIA.textContent = `${etiqueta}: ${nuevas.length} carrera(s). Total acumulado: ${carreras.length}.`;
                    pintarDiag();
                } catch (errLote) {
                    if (/clave|API key/i.test(errLote.message || '')) throw errLote;
                    diag.ultimoError = `${etiqueta}: ${errLote.message}`;
                    pintarDiag();
                    clubUI?.toast(`${etiqueta} falló (${errLote.message}).`, /CUOTA DIARIA/i.test(errLote.message || '') ? 'warning' : 'error');
                    if (/CUOTA DIARIA/i.test(errLote.message || '')) { cuotaTotal = true; break; }
                }
            }
            // ¿Resultado aunque sea parcial? Se entrega AHORA.
            if (carreras.length > 0) break;
            // Cuota diaria agotada en TODAS las familias: esperar es inútil.
            if (cuotaTotal) break;
            // Sin resultados por fallo/saturación: se rehace el ciclo completo
            // automáticamente (máx 3) antes de declarar fracaso.
            if (ciclo >= 3 || !diag.ultimoError) break;
            ciclo++;
            if (estadoIA) estadoIA.textContent = `Sin carreras aún: ${diag.ultimoError}. Reintentando el ciclo completo (${ciclo}/3) en 30 seg…`;
            pintarDiag(`reintento del ciclo completo #${ciclo} tras 30s (saturación/fallo)…`);
            indicador?.accion(`Reintento de extracción (ciclo ${ciclo}/3)…`);
            await esperar(30000);
            loteN = 0;
        }

        return { carreras, cuotaTotal };
    }

    return { listaModelosFlash, transformar };
})();