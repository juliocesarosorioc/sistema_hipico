document.addEventListener('DOMContentLoaded', () => {

    const btnAgregarCarrera = document.getElementById('btnAgregarCarrera');
    const contenedorCarreras = document.getElementById('carrerasEnsamblaje');
    const lblTotalCarreras = document.getElementById('lblTotalCarreras');
    const tbodyMonitor = document.getElementById('cuerpoMonitorTablas');
    const premioTabla = document.getElementById('premioTabla');

    let tasaCambioGlobal = 1.0;
    let datosTablaCompleta = [];
    let gruposActivos = [];
    let todosGrupos = [];
    let padronEjemplares = [];
    let carrerasBol = [];        // uids de las carreras armadas (sin publicar)

    const OPCIONES_NACIONALIDAD = ['VE', 'USA', 'BR', 'AR', 'CL', 'MX', 'PA', 'PE', 'CO', 'EC', 'UY', 'OTRA'];
    const SUPERFICIES = ['ARENA', 'CESPED', 'FANGO', 'TAPETA', 'OTRA'];
    const NO_RETIROS = 'NO HUBO RETIROS';

    // Acepta "3,5" y "3.5" (decimal con coma típico en Vzla)
    const aNum = (v) => {
        if (v === null || v === undefined) return null;
        const s = String(v).trim();
        if (!s) return null;
        const n = parseFloat(s.replace(/,/g, '.'));
        return Number.isFinite(n) ? n : null;
    };

    // Paleta oficial de 14 colores de gualdrapa (se repite cada 14)
    const COLORES_NUMEROS = [
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
    const colorDeNumero = (n) => {
        const x = parseInt(n, 10);
        if (!x) return '#94a3b8';
        return COLORES_NUMEROS[((x - 1) % 14)].bg;
    };
    const textoDeNumero = (n) => {
        const x = parseInt(n, 10);
        if (!x) return '#FFFFFF';
        return COLORES_NUMEROS[((x - 1) % 14)].fg;
    };

    const htmlSelectNac = (val = 'VE') => {
        const nac = (val || 'VE').trim().toUpperCase();
        const FLAGS = { VE: '🇻🇪', USA: '🇺🇸', BR: '🇧🇷', AR: '🇦🇷', CL: '🇨🇱', MX: '🇲🇽', PA: '🇵🇦', PE: '🇵🇪', CO: '🇨🇴', EC: '🇪🇨', UY: '🇺🇾', OTRA: '🏳️' };
        return `<span class="bandera-nac w-4 shrink-0 inline-flex justify-center text-sm leading-none" title="${nac}" data-nac="${nac}">${FLAGS[nac] || '🏳️'}</span>`;
    };

    // ==========================================
    // TASA GLOBAL (interna: solo se guarda para el cuadre)
    // ==========================================
    async function cargarTasaGlobal() {
        try {
            const { data } = await window.supabase.from('monedas').select('tasa_cambio').limit(1).single();
            if (data && data.tasa_cambio) tasaCambioGlobal = parseFloat(data.tasa_cambio);
        } catch (e) { console.warn("Fallo al cargar tasa global, usando 1.0"); }
    }

    async function cargarHipodromos() {
        const { data } = await window.supabase.from('hipodromos').select('nombre').order('nombre');
        const sel = document.getElementById('hipodromoTabla');
        if (data && data.length) {
            sel.innerHTML = '<option value="">Seleccione hipódromo...</option>'
                + data.map(h => `<option value="${h.nombre}">${h.nombre}</option>`).join('');
        } else {
            sel.innerHTML = '<option value="" disabled>Sin hipódromos registrados (revise Hipódromos)</option>';
        }
    }

    // ==========================================
    // GRUPOS (solo carga: la gestión vive en Grupos y Convenios)
    // ==========================================
    async function cargarGrupos() {
        const { data, error } = await window.supabase.from('grupos_venta').select('*').order('es_principal', { ascending: false });
        if (error) {
            if (error.status === 401 || /permission|row-level security/i.test(String(error.message || ''))) {
                clubUI.toast('Permisos bloqueados (RLS). Ejecute en SQL: alter table public.grupos_venta disable row level security;', 'error');
            }
            return;
        }
        todosGrupos = data || [];
        gruposActivos = todosGrupos.filter(g => g.activo);
        renderCuposGrupos();
        renderGruposDup();
    }

    function renderCuposGrupos() {
        const cont = document.getElementById('contenedorCuposGrupos');
        if (gruposActivos.length === 0) {
            cont.innerHTML = '<p class="text-slate-400 italic text-xs">No hay grupos activos. Créelos en "Grupos y Convenios".</p>';
            return;
        }
        cont.innerHTML = gruposActivos.map(g => `
            <div class="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2" data-grupo="${g.id}">
                <div class="flex-1">
                    <span class="font-bold text-slate-800 text-sm">${g.nombre}</span>
                    <span class="ml-2 px-1.5 py-0.5 rounded text-[9px] font-black ${g.moneda === 'VES' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}">${g.moneda}</span>
                </div>
                <input type="number" min="0" value="${g.cupo_tabla}" data-grupo="${g.id}"
                    class="in-cupo-grupo w-24 border border-slate-300 rounded-lg px-2 py-1.5 text-sm font-black text-center outline-none focus:ring-2 focus:ring-indigo-500">
            </div>
        `).join('');
    }

    async function cargarEjemplares() {
        const { data } = await window.supabase.from('ejemplares').select('id, nombre, nacionalidad').order('nombre');
        padronEjemplares = data || [];
    }

    function llenarSuperficies() {
        const sel = document.getElementById('superficieTabla');
        sel.innerHTML = '<option value="">Seleccione...</option>' + SUPERFICIES.map(s => `<option value="${s}">${s}</option>`).join('');
    }

    async function resolverEjemplar(nombre, nacionalidad) {
        const norm = (nombre || '').trim().toUpperCase();
        const nac = (nacionalidad || 'VE').trim().toUpperCase();
        const existe = padronEjemplares.find(e => e.nombre.toUpperCase() === norm && e.nacionalidad.toUpperCase() === nac);
        if (existe) return existe.id;
        const { data, error } = await window.supabase.from('ejemplares').insert([{ nombre: norm, nacionalidad: nac }]).select('id').single();
        if (error) return null;
        padronEjemplares.push({ id: data.id, nombre: norm, nacionalidad: nac });
        return data.id;
    }

    // ==========================================
    // CARRERAS EN EL ENSAMBLAJE (grilla 4 columnas)
    // ==========================================
    function contarCarreras() {
        if (lblTotalCarreras) lblTotalCarreras.textContent = carrerasBol.length;
        const empty = contenedorCarreras.querySelector('.empty-ensamblaje');
        if (empty) empty.classList.toggle('hidden', carrerasBol.length > 0);
        const btnTodas = document.getElementById('btnPublicarTodas');
        if (btnTodas) btnTodas.disabled = carrerasBol.length === 0;
    }

    function filaCaballoCard(c) {
        const vacio = (c && c.nombre) ? '' : 'opacity-70';
        const numColor = colorDeNumero(c?.numero);
        return `
            <div class="fila-caballo-card flex gap-px items-center bg-slate-50 border border-slate-200 rounded px-0.5 py-0.5 ${vacio}">
                <input type="text" inputmode="numeric" class="in-cab-num w-4 h-5 shrink-0 border rounded px-0 py-px text-center text-[8px] font-black outline-none focus:ring-1 focus:ring-indigo-400" value="${c?.numero ?? ''}" placeholder="Nº" title="Número del ejemplar" style="background-color:${numColor};color:${textoDeNumero(c?.numero)};border-color:${numColor}">
                <input type="text" class="in-cab-nom flex-1 min-w-[4.5rem] border border-slate-200 rounded px-1 py-px text-[11px] font-bold uppercase outline-none focus:ring-1 focus:ring-indigo-400" value="${c?.nombre ?? ''}" placeholder="Ejemplar" title="Nombre del ejemplar">
                ${htmlSelectNac(c?.nacionalidad)}
                <input type="text" inputmode="decimal" class="in-cab-valor w-9 shrink-0 border border-slate-200 rounded px-0.5 py-px text-right text-[10px] font-bold text-blue-700 outline-none focus:ring-1 focus:ring-indigo-400" value="${c?.valor ?? c?.pts ?? ''}" placeholder="Valor" title="Valor / monta del ejemplar">
                <button type="button" tabindex="-1" class="btn-del-cab-card shrink-0 text-red-400 hover:text-red-600 px-0.5 leading-none -ml-0.5" title="Quitar ejemplar"><i class="fas fa-trash-alt"></i></button>
            </div>`;
    }

    function crearCardCarrera(opts) {
        const uid = 'car-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const card = document.createElement('div');
        card.className = 'card-carrera bg-white rounded-xl shadow-sm border border-indigo-200 overflow-hidden flex flex-col';
        card.dataset.uid = uid;
        card.innerHTML = `
            <div class="bg-indigo-600 px-2 py-1" style="color:#fff">
                <div class="flex items-center justify-between gap-2">
                    <span class="font-black text-[10px] whitespace-nowrap"><i class="fas fa-flag-checkered mr-1"></i> Carrera
                        <input type="number" class="in-carrera-card w-11 rounded px-1 py-px text-center font-black outline-none" style="background:rgba(255,255,255,.18);color:#fff" value="${opts?.carrera ?? ''}" placeholder="N°">
                    </span>
                    <input type="text" class="in-hipo-card rounded px-1.5 py-px text-[9px] font-bold uppercase outline-none w-28 text-right" style="background:rgba(255,255,255,.18);color:#fff" value="${opts?.hipodromo ?? ''}" placeholder="Hipódromo">
                </div>
                <div class="flex flex-wrap gap-1 mt-0.5 text-[8px] font-bold">
                    <span class="rounded px-1.5 py-px" style="background:rgba(255,255,255,.18)">Dist: <input type="number" class="in-dist-card w-12 outline-none text-center font-black" style="background:transparent;color:#fff" value="${opts?.distancia ?? ''}" placeholder="m"></span>
                    <select class="in-sup-card rounded px-0.5 py-px outline-none uppercase text-[8px] font-bold" style="background:rgba(255,255,255,.18)">
                        ${SUPERFICIES.map(s => `<option value="${s}" ${(opts?.superficie || '').toUpperCase() === s ? 'selected' : ''}>${s}</option>`).join('')}
                    </select>
                    <span class="rounded px-1.5 py-px" style="background:rgba(255,255,255,.18)">Premio $ <input type="number" step="0.01" class="in-premio-card w-16 outline-none text-right font-black" style="background:transparent;color:#fff" value="${opts?.premio ?? premioTabla.value ?? 100}"></span>
                </div>
            </div>
            <div class="px-2 pt-1 pb-0.5 text-[8px] font-black uppercase tracking-wider text-slate-400 flex items-center justify-between">
                <span><i class="fas fa-horse-head text-amber-500 mr-0.5"></i> Ejemplares</span>
                <span class="cont-caballos-card bg-slate-100 text-slate-600 px-1.5 rounded-full font-black">0</span>
            </div>
            <div class="lista-caballos-card px-1.5 py-0.5 space-y-0.5 flex-1"></div>
            <div class="add-caballo-card border-t border-slate-200 px-1.5 py-1 space-y-0.5 bg-slate-50">
                <div class="flex gap-1 items-center">
                    <input type="text" inputmode="numeric" class="nuevo-num w-4 h-5 shrink-0 border border-slate-300 rounded px-0 py-px text-[8px] font-black text-center outline-none focus:ring-1 focus:ring-indigo-400" placeholder="Nº" style="background-color:#fff;color:#94a3b8;border-color:#cbd5e1">
                    <input type="text" class="nuevo-nom flex-1 min-w-[4.5rem] border border-slate-300 rounded px-1 py-px text-[11px] font-bold uppercase outline-none focus:ring-1 focus:ring-indigo-400" placeholder="Ejemplar nuevo">
                    <select class="nuevo-nac w-auto shrink-0 border border-slate-300 rounded px-0.5 py-px text-[8px] font-bold uppercase outline-none bg-white">
                        ${OPCIONES_NACIONALIDAD.map(n => `<option value="${n}">${n}</option>`).join('')}
                    </select>
                    <input type="text" inputmode="decimal" class="nuevo-valor w-12 shrink-0 border border-slate-300 rounded px-0.5 py-px text-right text-[10px] font-bold text-blue-700 outline-none focus:ring-1 focus:ring-indigo-400" placeholder="Valor">
                    <button type="button" tabindex="-1" class="btn-add-caballo-card bg-indigo-600 hover:bg-indigo-700 text-white rounded px-1.5 py-px text-[10px]" title="Añadir ejemplar"><i class="fas fa-plus"></i></button>
                </div>
            </div>
            <div class="px-2 py-1.5 border-t border-slate-200 flex gap-2 bg-white">
                <button type="button" class="btn-publicar-card flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-black py-1.5 rounded-lg shadow transition-colors uppercase tracking-wide">
                    <i class="fas fa-save mr-1"></i> Publicar
                </button>
                <button type="button" class="btn-quitar-card bg-red-50 hover:bg-red-100 text-red-600 px-2 py-1.5 rounded-lg text-[10px] font-bold transition-colors" title="Quitar esta carrera del ensamblaje">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;

        (opts?.caballos || []).forEach(c => {
            card.querySelector('.lista-caballos-card').insertAdjacentHTML('beforeend', filaCaballoCard(c));
        });
        actualizarContCaballos(card);

        contenedorCarreras.appendChild(card);
        carrerasBol.push(uid);
        contarCarreras();
        return card;
    }

    function actualizarContCaballos(card) {
        const n = card.querySelectorAll('.fila-caballo-card .in-cab-nom').length;
        const cont = card.querySelector('.cont-caballos-card');
        if (cont) cont.textContent = n;
    }

    // Delegación de eventos sobre la grilla de carreras
    contenedorCarreras.addEventListener('click', async (e) => {
        const btnAdd = e.target.closest('.btn-add-caballo-card');
        if (btnAdd) {
            const card = btnAdd.closest('.card-carrera');
            const nombre = card.querySelector('.nuevo-nom').value.trim().toUpperCase();
            if (!nombre) return clubUI.toast('Escriba el nombre del ejemplar para añadirlo.', 'warning');
            card.querySelector('.lista-caballos-card').insertAdjacentHTML('beforeend', filaCaballoCard({
                numero: card.querySelector('.nuevo-num').value.trim(),
                nombre,
                nacionalidad: card.querySelector('.nuevo-nac').value,
                valor: card.querySelector('.nuevo-valor').value
            }));
            card.querySelector('.nuevo-num').value = '';
            card.querySelector('.nuevo-nom').value = '';
            card.querySelector('.nuevo-valor').value = '';
            actualizarContCaballos(card);
            return;
        }

        const btnDel = e.target.closest('.btn-del-cab-card');
        if (btnDel) {
            const card = btnDel.closest('.card-carrera');
            btnDel.closest('.fila-caballo-card').remove();
            actualizarContCaballos(card);
            return;
        }

        const btnQuitar = e.target.closest('.btn-quitar-card');
        if (btnQuitar) {
            const card = btnQuitar.closest('.card-carrera');
            if (!confirm('¿Quitar esta carrera del ensamblaje? (no se ha publicado)')) return;
            const hipoQ = (card.querySelector('.in-hipo-card').value || '').trim();
            const carQ = (card.querySelector('.in-carrera-card').value || '').trim();
            carrerasBol = carrerasBol.filter(u => u !== card.dataset.uid);
            card.remove();
            eliminarDelRegistroGaceta(hipoQ, carQ);
            contarCarreras();
            return;
        }

        const btnPub = e.target.closest('.btn-publicar-card');
        if (btnPub) await publicarCard(btnPub.closest('.card-carrera'));
    });

    // Navegación de teclado entre celdas del ensamblaje:
    // Tab avanza Nº → Nombre → Valor (y a la siguiente fila/card);
    // Shift+Tab vuelve a la celda anterior (retrocede).
    contenedorCarreras.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab') return;
        const actual = e.target;
        if (!(actual instanceof HTMLInputElement)) return;
        if (!actual.matches('.in-cab-num, .in-cab-nom, .in-cab-valor')) return;
        const celdas = Array.from(contenedorCarreras.querySelectorAll('.in-cab-num, .in-cab-nom, .in-cab-valor'));
        const i = celdas.indexOf(actual);
        if (i === -1 || celdas.length < 2) return;
        e.preventDefault();
        const delta = e.shiftKey ? -1 : 1;
        const next = celdas[(i + delta + celdas.length) % celdas.length];
        next.focus();
        next.select?.();
    });

    contenedorCarreras.addEventListener('input', (e) => {
        const t = e.target;
        if (!t || !t.classList) return;
        if (t.classList.contains('in-cab-num') || t.classList.contains('nuevo-num')) {
            if (t.value) {
                const c = colorDeNumero(t.value);
                t.style.backgroundColor = c;
                t.style.color = textoDeNumero(t.value);
                t.style.borderColor = c;
            } else {
                t.style.backgroundColor = '#fff';
                t.style.color = '#94a3b8';
                t.style.borderColor = '#cbd5e1';
            }
        }
    });

    // ==========================================
    // PUBLICAR UNA CARRERA DEL ENSAMBLAJE
    // ==========================================
    // Inserta en tablas_fijas y, si la BD exige columnas legacy (p. ej.
    // "monto_tabla"), las completa automáticamente tras detectar el error
    // de Postgres, sin abortar la publicación.
    async function insertarTablaFija(payload) {
        const LEGACY = {
            monto_tabla: (p) => parseFloat(p.premio_recalculado) || 0
        };
        const extras = {};
        for (let i = 0; i < 6; i++) {
            const body = Object.assign({}, payload, extras);
            const { data, error } = await window.supabase.from('tablas_fijas').insert([body]).select('id').single();
            if (!error) return { data, error };
            const msg = String(error.message || '');
            const nullM = /null value in column "([^"]+)"/.exec(msg);
            if (nullM) {
                const col = nullM[1];
                if (extras[col] !== undefined) return { data, error };
                extras[col] = LEGACY[col] ? LEGACY[col](payload) : 0;
                continue;
            }
            const tipoM = /column "([^"]+)" is of type (?:text|character varying|boolean)/i.exec(msg);
            if (tipoM) {
                const col = tipoM[1];
                if (extras[col] !== undefined) return { data, error };
                extras[col] = /boolean/i.test(tipoM[2]) ? false : '';
                continue;
            }
            return { data, error };
        }
        return { data: null, error: { message: 'No se pudo completar la inserción (columnas requeridas faltantes en la BD).' } };
    }
    async function publicarCard(card, silencio) {
        const hipodromo = (card.querySelector('.in-hipo-card').value || '').trim().toUpperCase();
        const carrera = parseInt(card.querySelector('.in-carrera-card').value);
        const premio = parseFloat(card.querySelector('.in-premio-card').value);
        const distancia = parseFloat(card.querySelector('.in-dist-card').value);
        const superficie = card.querySelector('.in-sup-card').value;

        let sumaBaseTabla = 0;
        const caballosArr = [];
        const clavesNombreNac = new Set();
        card.querySelectorAll('.fila-caballo-card').forEach(fila => {
            const numero = fila.querySelector('.in-cab-num').value.trim();
            const nombre = fila.querySelector('.in-cab-nom').value.trim().toUpperCase();
            const nacionalidad = fila.querySelector('.bandera-nac')?.dataset?.nac || 'VE';
            // Valor en blanco se toma como 0: NO se descarta el ejemplar
            const valor = aNum(fila.querySelector('.in-cab-valor').value) || 0;
            if (!numero && !nombre) return;
            if (numero && nombre) {
                const clave = nombre + '|' + nacionalidad;
                if (clavesNombreNac.has(clave)) { caballosArr.push(null); return; }
                clavesNombreNac.add(clave);
                sumaBaseTabla += valor;
                caballosArr.push({ numero, nombre, nacionalidad, valor_ejemplar: valor, retirado: false, ganador: false, ejemplar_id: null });
            }
        });

        const fallo = msg => { if (silencio) return { ok: false, msg }; clubUI.toast(msg); return { ok: false, msg }; };

        if (caballosArr.some(c => c === null)) return fallo("Un ejemplar (nombre + nacionalidad) está repetido en la misma tabla.");
        if (caballosArr.length < 2) return fallo("Ingrese al menos 2 ejemplares.");
        if (!hipodromo || isNaN(carrera) || isNaN(premio) || premio <= 0 || sumaBaseTabla <= 0) {
            return fallo("Faltan campos obligatorios o la base de ponderación es cero.");
        }
        if (!superficie) return fallo("Seleccione la superficie de la pista.");
        if (isNaN(distancia) || distancia <= 0) return fallo("Indique la distancia de la carrera en metros.");

        const cuposPorGrupo = [...document.querySelectorAll('.in-cupo-grupo')]
            .map(inp => ({ grupo_id: inp.dataset.grupo, cupos: parseInt(inp.value) || 0 }))
            .filter(x => x.cupos > 0);
        if (cuposPorGrupo.length === 0) return fallo("Asigne cupos a al menos un grupo.");

        const grupoPrimario = gruposActivos.find(g => g.es_principal) || gruposActivos[0];
        const comisionGrupo = parseFloat(grupoPrimario && grupoPrimario.comision_default) || 2.5;
        const limiteTotal = cuposPorGrupo.reduce((a, b) => a + b.cupos, 0);

        const btn = card.querySelector('.btn-publicar-card');
        const orig = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Guardando...';
        btn.disabled = true;

        for (const c of caballosArr) {
            c.ejemplar_id = await resolverEjemplar(c.nombre, c.nacionalidad);
        }

        const { data: nueva, error } = await insertarTablaFija({
            hipodromo, carrera, grupo_venta: 'GRUPOS', moneda: 'USD', tasa_cambio: tasaCambioGlobal,
            suma_base_tabla: sumaBaseTabla, limite_ventas: limiteTotal, cantidad_vendida: 0,
            premio_original: premio, premio_recalculado: premio,
            comision_grupo: comisionGrupo, caballos: caballosArr, estado: 'Abierta',
            distancia_carrera: distancia, superficie, retirados_oficiales: NO_RETIROS
        });

        btn.innerHTML = orig;
        btn.disabled = false;

        if (error) {
            console.error("Error BD:", error.message || error);
            return fallo(`Error al guardar la carrera: ${error.message || 'verifique la conexión'}`);
        }

        const filasGrupos = cuposPorGrupo.map(x => ({ tabla_id: nueva.id, grupo_id: x.grupo_id, cupos: x.cupos, cantidad_vendida: 0 }));
        const { error: errG } = await window.supabase.from('tabla_grupos').insert(filasGrupos);
        if (errG) console.error("Error cupos:", errG.message);

        carrerasBol = carrerasBol.filter(u => u !== card.dataset.uid);
        card.remove();
        eliminarDelRegistroGaceta(hipodromo, carrera);
        contarCarreras();
        cargarTablas(); cargarEjemplares();
        if (window.clubDB?.logAccion) window.clubDB.logAccion('TABLAS', `publicada: ${hipodromo} C${carrera} ${distancia}m ${superficie} premio=$${premio} cupos=${limiteTotal} ejemplares=${caballosArr.length} (id=${nueva.id})`);
        // Publicó una carrera del día: la deja disponible para los demás módulos
        window.clubPrograma?.agregarCarrera({
            hipodromo, carrera, distancia, superficie, premio,
            caballos: caballosArr.map(c => ({ numero: c.numero, nombre: c.nombre, nacionalidad: c.nacionalidad, valor: c.valor_ejemplar }))
        })?.catch?.(() => {});
        if (silencio) return { ok: true, msg: `C${carrera} ${hipodromo}: ${caballosArr.length} ej. (id=${nueva.id})` };
        clubUI.toast(`Carrera C${carrera} (${hipodromo}) publicada con ${caballosArr.length} ejemplares (valor total calculado: privado).`, 'success');
    }

    // ==========================================
    // PUBLICAR TODAS LAS CARRERAS DEL ENSAMBLAJE
    // ==========================================
    async function publicarTodas() {
        const cards = [...document.querySelectorAll('.card-carrera')];
        if (cards.length === 0) return clubUI.toast('No hay carreras en el ensamblaje para publicar.', 'warning');
        const total = cards.length;
        const btn = document.getElementById('btnPublicarTodas');
        const orig = btn ? btn.innerHTML : '';
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Publicando…'; }

        window.clubIndicador?.accion(`Publicando ${total} carrera(s)…`);
        const ok = [], fail = [];
        for (let i = 0; i < total; i++) {
            const card = document.querySelector(`.card-carrera[data-uid="${cards[i].dataset.uid}"]`);
            if (!card) continue;
            window.clubIndicador?.progreso(i / total);
            let r;
            try { r = await publicarCard(card, true); } catch (e) { r = { ok: false, msg: e && e.message ? e.message : String(e) }; }
            if (r && r.ok) ok.push(r.msg);
            else {
                fail.push(r && r.msg ? r.msg : 'error inesperado');
                card.classList.add('ring-2', 'ring-red-400');
            }
        }
        if (btn) { btn.disabled = false; btn.innerHTML = orig; }
        contarCarreras();
        if (fail.length === 0) {
            window.clubIndicador?.listo(`${total} carrera(s) publicada(s)`);
            clubUI.aviso('Publicar todas · Completado',
                `${total}/${total} tablas fijas publicadas correctamente.\n\nLas ${total} carrera(s) quedaron disponibles para taquilla, venta y saldos. Puede verificar en la sección "Venta de Tablas" o "Taquilla".`,
                'success');
        } else {
            window.clubIndicador?.fin();
            clubUI.aviso('Publicar todas · Con errores',
                `${ok.length} publicada(s) correctamente · ${fail.length} con error.\n\nRevise las tarjetas marcadas en rojo en el Ensamblaje.\n\nPrimer error: ${fail[0] || 'desconocido'}`,
                'error');
        }
    }

    // ==========================================
    // MONITOR
    // ==========================================
    function badgeRetiros(t) {
        const r = (t.retirados_oficiales || '').trim().toUpperCase();
        if (!r || r === 'NO HUBO RETIROS' || r === 'NINGUNO' || r === '') {
            return '<span class="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-2 py-0.5 text-[10px] font-black"><i class="fas fa-check-circle"></i> No hubo retiros</span>';
        }
        return `<span class="inline-flex items-center gap-1 bg-red-50 text-red-600 border border-red-200 rounded-full px-2 py-0.5 text-[10px] font-black"><i class="fas fa-user-slash"></i> Retirados: ${r}</span>`;
    }

    function chipGanador(t) {
        const ganador = (t.caballos || []).find(c => c.ganador);
        if (!ganador) return '';
        return `<span class="inline-flex items-center gap-1 bg-amber-100 text-amber-700 border border-amber-300 rounded-full px-2 py-0.5 text-[10px] font-black mt-1"><i class="fas fa-trophy"></i> Ganador #${ganador.numero} ${ganador.nombre}</span>`;
    }

    async function cargarTablas() {
        try {
            const { data, error } = await window.supabase
                .from('tablas_fijas')
                .select('*, tabla_grupos(*, grupos_venta(nombre, moneda))')
                .order('id', { ascending: false });
            if (error) throw error;

            datosTablaCompleta = data || [];
            tbodyMonitor.innerHTML = '';
            const lblMonitor = document.getElementById('lblTotalMonitor');
            if (lblMonitor) lblMonitor.textContent = String(datosTablaCompleta.length);
            if (datosTablaCompleta.length === 0) {
                tbodyMonitor.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-slate-500">No hay tablas registradas.</td></tr>';
                return;
            }

            datosTablaCompleta.forEach(t => {
                const badgeEstado = t.estado === 'Abierta' ? '<span class="text-green-600 font-bold">ABIERTA</span>' : '<span class="text-blue-600 font-bold">AUDITADA</span>';

                const chipsGrupos = (t.tabla_grupos || []).map(tg => {
                    const nombre = tg.grupos_venta ? tg.grupos_venta.nombre : '?';
                    const moneda = tg.grupos_venta ? tg.grupos_venta.moneda : '';
                    const disp = (tg.cupos || 0) - (tg.cantidad_vendida || 0);
                    const color = disp < 10 ? 'text-red-600' : 'text-slate-700';
                    return `<span class="inline-flex items-center gap-1 bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5 text-[10px]">
                        <span class="font-black">${nombre}</span>
                        <span class="font-bold ${color}">${tg.cantidad_vendida || 0}/${tg.cupos}</span>
                        <span class="text-slate-400">${moneda}</span>
                    </span>`;
                }).join(' ') || '<span class="text-slate-400 italic text-[10px]">Sin cupos</span>';

                const btnAcciones = `
                    <div class="flex flex-wrap gap-1 justify-center">
                        <button class="btn-editar bg-slate-200 text-slate-700 px-2 py-1 rounded hover:bg-slate-300" data-id="${t.id}" title="Editar"><i class="fas fa-edit"></i></button>
                        <button class="btn-clonar bg-indigo-100 text-indigo-700 px-2 py-1 rounded hover:bg-indigo-200" data-id="${t.id}" title="Clonar"><i class="fas fa-copy"></i></button>
                        ${t.estado === 'Abierta' ? `<button class="btn-vender bg-emerald-500 text-white px-2 py-1 rounded hover:bg-emerald-600 font-bold" data-id="${t.id}">Vender</button><button class="btn-auditar bg-amber-400 text-slate-900 px-2 py-1 rounded hover:bg-amber-500 font-bold" data-id="${t.id}">Actualizar</button>` : `<button class="btn-auditar bg-blue-100 text-blue-700 px-2 py-1 rounded hover:bg-blue-200 font-bold" data-id="${t.id}">Resultado</button>`}
                        <button class="btn-eliminar bg-red-100 text-red-600 px-2 py-1 rounded hover:bg-red-200" data-id="${t.id}" title="Eliminar"><i class="fas fa-trash-alt"></i></button>
                    </div>
                `;

                tbodyMonitor.innerHTML += `
                    <tr class="hover:bg-slate-50 border-b border-slate-100">
                        <td class="p-2 font-bold">${t.hipodromo}<br><span class="text-blue-600">C${t.carrera}</span> ${t.distancia_carrera ? `<span class="text-slate-400 font-normal"> · ${t.distancia_carrera}m</span>` : ''} ${t.superficie ? `<span class="inline-block ml-1 text-[9px] border border-slate-300 rounded px-1 font-bold text-slate-600 uppercase">${t.superficie}</span>` : ''}
                            <div class="mt-1">${chipsGrupos}</div></td>
                        <td class="p-2 text-right"><span class="text-blue-700 font-bold">${t.moneda === 'VES' ? 'Bs ' : '$'}${clubUI.formatoNumero(parseFloat(t.premio_recalculado), 2)}</span></td>
                        <td class="p-2 text-center">${badgeRetiros(t)}${chipGanador(t)}</td>
                        <td class="p-2 text-center text-[10px]">${badgeEstado}</td>
                        <td class="p-2 text-center">${btnAcciones}</td>
                    </tr>
                `;
            });

            document.querySelectorAll('.btn-editar').forEach(b => b.addEventListener('click', (e) => abrirModalEditar(e.currentTarget.dataset.id)));
            document.querySelectorAll('.btn-clonar').forEach(b => b.addEventListener('click', (e) => abrirModalClonar(e.currentTarget.dataset.id)));
            document.querySelectorAll('.btn-vender').forEach(b => b.addEventListener('click', (e) => abrirModalVenta(e.currentTarget.dataset.id)));
            document.querySelectorAll('.btn-auditar').forEach(b => b.addEventListener('click', (e) => abrirModalAuditoria(e.currentTarget.dataset.id)));
            document.querySelectorAll('.btn-eliminar').forEach(b => b.addEventListener('click', (e) => eliminarTabla(e.currentTarget.dataset.id)));
        } catch (e) {
            console.error(e);
            tbodyMonitor.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-red-500">Error cargando tablas.</td></tr>';
        }
    }

    // ==========================================
    // ELIMINAR TABLA
    // ==========================================
    async function eliminarTabla(id) {
        const t = datosTablaCompleta.find(x => x.id == id);
        if (!t) return;
        if (!confirm(`⚠️ ELIMINAR TABLA\n\n${t.hipodromo} C${t.carrera} — $${clubUI.formatoNumero(parseFloat(t.premio_recalculado), 2)}\n\nSe borrarán también sus cupos por grupo. Esta acción NO se puede deshacer.`)) return;

        const { error } = await window.supabase.from('tablas_fijas').delete().eq('id', id);
        if (error) {
            clubUI.toast('Error al eliminar. Verifique que no tenga liquidaciones (saldos) asociadas.');
        } else {
            clubUI.toast(`Tabla ${t.hipodromo} C${t.carrera} eliminada.`, 'success');
            if (window.clubDB?.logAccion) window.clubDB.logAccion('TABLAS', `eliminada: ${t.hipodromo} C${t.carrera} (id=${id})`);
            cargarTablas();
        }
    }

    // ==========================================
    // EDICIÓN (premio + cupos por grupo)
    // ==========================================
    function abrirModalEditar(id) {
        const tabla = datosTablaCompleta.find(t => t.id == id);
        if (!tabla) return;
        document.getElementById('editId').value = id;
        document.getElementById('editPremio').value = (tabla.premio_recalculado ?? 100);
        document.getElementById('editPremioOrig').value = (tabla.premio_original ?? tabla.premio_recalculado ?? 100);
        document.getElementById('editSumaBase').value = (tabla.suma_base_tabla ?? 160);
        document.getElementById('editComision').value = (tabla.comision_grupo ?? '');
        const contCab = document.getElementById('editCaballos');
        contCab.innerHTML = (tabla.caballos || []).map((c, i) => `
            <label class="flex items-center gap-2 bg-white border border-slate-200 rounded px-2 py-1 text-xs">
                <span class="w-5 h-5 flex items-center justify-center rounded-full text-[9px] font-black shrink-0" style="background:${colorDeNumero(c.numero)};color:${textoDeNumero(c.numero)}">${c.numero}</span>
                <span class="flex-1 font-bold text-slate-700 truncate" title="${c.nombre}">${c.nombre} ${c.retirado ? '<span class="text-red-500 text-[9px] font-black">(RETIRADO)</span>' : ''}</span>
                <input type="text" inputmode="decimal" class="edit-valor-cab w-20 text-right border border-slate-300 rounded px-1 py-0.5 text-[11px] font-bold outline-none focus:ring-2 focus:ring-indigo-500" data-index="${i}" value="${clubUI.formatoNumero(parseFloat(c.valor_ejemplar) || 0, 1)}" title="Valor del ejemplar (afecta solo próximas ventas)">
            </label>
        `).join('') || '<p class="text-slate-400 italic text-xs">Sin ejemplares.</p>';
        const ctn = document.getElementById('editCuposGrupos');
        const yaAsignados = (tabla.tabla_grupos || []).map(tg => tg.grupo_id);

        ctn.innerHTML = (tabla.tabla_grupos || []).map(tg => {
            const vendidas = tg.cantidad_vendida || 0;
            const botonEliminar = vendidas === 0
                ? `<button type="button" class="btn-quitar-grupo-edit text-red-500 hover:text-red-700 px-1" data-tablagrupo="${tg.id}" title="Quitar grupo de esta tabla"><i class="fas fa-times-circle"></i></button>`
                : `<span class="text-[9px] text-slate-400 font-bold" title="Tiene ${vendidas} venta(s), no se puede quitar">${vendidas} vend.</span>`;
            return `
            <div class="fila-cupo-editar flex items-center gap-2 bg-white border border-slate-200 rounded px-2 py-1.5" data-tablagrupo="${tg.id}" data-grupo="${tg.grupo_id}">
                <span class="flex-1 text-sm font-bold text-slate-700">${tg.grupos_venta ? tg.grupos_venta.nombre : '?'}</span>
                <span class="text-[10px] text-slate-500">${vendidas} vendidas</span>
                <input type="number" min="0" value="${tg.cupos}" data-id="${tg.id}" data-grupo="${tg.grupo_id}" class="edit-cupo w-20 border border-slate-300 rounded-lg px-2 py-1 text-sm font-bold text-center outline-none focus:ring-2 focus:ring-indigo-500">
                ${botonEliminar}
            </div>`;
        }).join('') || '<p class="text-slate-400 italic text-xs">Esta tabla no tiene grupos asignados.</p>';

        const selecNuevo = document.getElementById('nuevoGrupoEditar');
        const opciones = gruposActivos
            .filter(g => !yaAsignados.includes(g.id))
            .map(g => `<option value="${g.id}">${g.nombre} (${g.moneda})</option>`)
            .join('');
        selecNuevo.innerHTML = '<option value="">Grupo a agregar...</option>' + opciones;
        if (!opciones) selecNuevo.innerHTML = '<option value="" disabled>Todos los grupos ya están asignados</option>';
        document.getElementById('nuevoCupoEditar').value = 50;

        ctn.querySelectorAll('.btn-quitar-grupo-edit').forEach(b => b.addEventListener('click', (e) => {
            const fila = e.currentTarget.closest('.fila-cupo-editar');
            const nombre = fila.querySelector('span').textContent;
            if (confirm(`Quitar el grupo "${nombre}" de esta carrera?`)) {
                fila.dataset.pendienteEliminar = '1';
                fila.classList.add('opacity-40', 'pointer-events-none');
                e.currentTarget.disabled = true;
            }
        }));

        document.getElementById('modalEditar').classList.remove('hidden');
    }

    document.getElementById('btnAgregarGrupoEditar')?.addEventListener('click', () => {
        const gid = document.getElementById('nuevoGrupoEditar').value;
        const cupo = parseInt(document.getElementById('nuevoCupoEditar').value) || 0;
        if (!gid) return clubUI.toast("Seleccione un grupo para reasignar.");
        if (cupo <= 0) return clubUI.toast("El cupo debe ser mayor que 0.");
        const g = gruposActivos.find(x => x.id == gid);
        if (!g) return;
        const ctn = document.getElementById('editCuposGrupos');
        if (ctn.querySelector(`.edit-cupo[data-grupo="${gid}"]`)) return clubUI.toast("Ese grupo ya está asignado.");
        ctn.insertAdjacentHTML('beforeend', `
            <div class="fila-cupo-editar flex items-center gap-2 bg-indigo-50 border border-indigo-200 rounded px-2 py-1.5" data-grupo="${gid}">
                <span class="flex-1 text-sm font-bold text-indigo-700">${g.nombre} <span class="text-[9px]">(nuevo)</span></span>
                <span class="text-[10px] text-slate-500">0 vendidas</span>
                <input type="number" min="0" value="${cupo}" data-grupo="${gid}" data-nuevo="1" class="edit-cupo w-20 border border-slate-300 rounded-lg px-2 py-1 text-sm font-bold text-center outline-none focus:ring-2 focus:ring-indigo-500">
            </div>`);
        document.getElementById('nuevoGrupoEditar').value = '';
    });

    document.getElementById('btnProcesarEdicion').addEventListener('click', async () => {
        const id = document.getElementById('editId').value;
        const premio = aNum(document.getElementById('editPremio').value);
        if (premio === null || premio <= 0) return clubUI.toast("Premio inválido.");
        const premioOrig = aNum(document.getElementById('editPremioOrig').value) || premio;
        const sumaBase = aNum(document.getElementById('editSumaBase').value) || 0;
        const comision = aNum(document.getElementById('editComision').value) || 0;
        const tEdit = datosTablaCompleta.find(t => t.id == id);
        const caballosNuevos = [...(tEdit?.caballos || [])];
        [...document.querySelectorAll('#editCaballos .edit-valor-cab')].forEach(inp => {
            const i = parseInt(inp.dataset.index);
            const v = aNum(inp.value) || 0;
            if (caballosNuevos[i]) caballosNuevos[i] = { ...caballosNuevos[i], valor_ejemplar: v };
        });
        const filas = [...document.querySelectorAll('.fila-cupo-editar')];
        const cuposInputs = filas.map(f => ({
            ngId: f.querySelector('.edit-cupo').dataset.grupo,
            tgId: f.querySelector('.edit-cupo').dataset.id || null,
            cupo: parseInt(f.querySelector('.edit-cupo').value) || 0,
            eliminar: f.dataset.pendienteEliminar === '1'
        }));

        if (filas.length === 0) return clubUI.toast("Asigne al menos un grupo.");

        let cuposSuma = 0;
        for (const inp of cuposInputs) {
            const tgId = inp.tgId;
            if (inp.eliminar) {
                if (tgId) await window.supabase.from('tabla_grupos').delete().eq('id', tgId);
                continue;
            }
            cuposSuma += inp.cupo;
            if (tgId) {
                const tg = datosTablaCompleta.find(t => t.id == id)?.tabla_grupos?.find(x => x.id == tgId);
                if (tg && inp.cupo < (tg.cantidad_vendida || 0)) {
                    return clubUI.toast(`No puede reducir a ${inp.cupo}: ya se vendieron ${tg.cantidad_vendida} tablas en ese grupo.`);
                }
                await window.supabase.from('tabla_grupos').update({ cupos: inp.cupo }).eq('id', tgId);
            } else {
                await window.supabase.from('tabla_grupos').insert([{
                    tabla_id: id, grupo_id: inp.ngId, cupos: inp.cupo, cantidad_vendida: 0
                }]);
            }
        }
const { error } = await window.supabase.from('tablas_fijas').update({
            premio_original: premioOrig, premio_recalculado: premio, suma_base_tabla: sumaBase,
            comision_grupo: comision, limite_ventas: cuposSuma, caballos: caballosNuevos
        }).eq('id', id);

        if (!error) { document.getElementById('modalEditar').classList.add('hidden'); cargarTablas(); }
        else { clubUI.toast("Error al editar."); }
        if (window.clubDB?.logAccion) window.clubDB.logAccion('TABLAS', `editada: ${tEdit?.hipodromo} C${tEdit?.carrera} premio=$${premio} premOriginal=$${premioOrig} comision=${comision}% cupos=${cuposSuma} (id=${id})`);
    });

    // ==========================================
    // CLONACIÓN
    // ==========================================
    function renderGruposDup() {
        const cont = document.getElementById('listaGruposDup');
        if (todosGrupos.length === 0) { cont.innerHTML = '<p class="text-slate-400 italic text-xs">Sin grupos.</p>'; return; }
        cont.innerHTML = todosGrupos.map(g => `
            <label class="flex items-center gap-2 bg-white border border-slate-200 rounded px-2 py-1.5 cursor-pointer text-sm">
                <input type="checkbox" value="${g.id}" class="chk-grupo-dup rounded">
                <span class="font-bold text-slate-700">${g.nombre}</span>
                <span class="ml-auto text-[10px] text-slate-500 ${g.moneda === 'VES' ? 'text-amber-600' : 'text-emerald-600'}">${g.moneda}</span>
            </label>
        `).join('');
    }

    function abrirModalClonar(id) {
        document.getElementById('dupId').value = id;
        document.getElementById('modalDuplicar').classList.remove('hidden');
    }

    document.getElementById('btnProcesarDuplicado').addEventListener('click', async () => {
        const idOriginal = document.getElementById('dupId').value;
        const grupoIds = [...document.querySelectorAll('.chk-grupo-dup:checked')].map(c => c.value);
        if (grupoIds.length === 0) return clubUI.toast("Marque al menos un grupo destino.");

        const tablaRef = datosTablaCompleta.find(t => t.id == idOriginal);
        if (!tablaRef) return;

        const btn = document.getElementById('btnProcesarDuplicado');
        const cuposTotales = grupoIds.reduce((a, gid) => a + (todosGrupos.find(g => g.id == gid)?.cupo_tabla || 0), 0);

        btn.textContent = "Clonando..."; btn.disabled = true;

        const { data: nueva, error } = await insertarTablaFija({
            hipodromo: tablaRef.hipodromo, carrera: tablaRef.carrera,
            grupo_venta: 'GRUPOS', moneda: tablaRef.moneda, tasa_cambio: tablaRef.tasa_cambio,
            suma_base_tabla: tablaRef.suma_base_tabla, limite_ventas: cuposTotales, cantidad_vendida: 0,
            premio_original: tablaRef.premio_original, premio_recalculado: tablaRef.premio_recalculado,
            comision_grupo: tablaRef.comision_grupo, caballos: tablaRef.caballos, estado: 'Abierta',
            distancia_carrera: tablaRef.distancia_carrera, superficie: tablaRef.superficie,
            retirados_oficiales: NO_RETIROS
        });

        if (!error) {
            const filas = grupoIds.map(gid => ({ tabla_id: nueva.id, grupo_id: gid, cupos: todosGrupos.find(g => g.id == gid)?.cupo_tabla || 100, cantidad_vendida: 0 }));
            await window.supabase.from('tabla_grupos').insert(filas);
            document.getElementById('modalDuplicar').classList.add('hidden');
            cargarTablas();
            if (window.clubDB?.logAccion) window.clubDB.logAccion('TABLAS', `clonada: ${tablaRef.hipodromo} C${tablaRef.carrera} (id=${nueva.id}) desde id=${idOriginal}`);
        } else { clubUI.toast("Error al clonar."); }

        btn.textContent = "Ejecutar Clonación"; btn.disabled = false;
    });

    // ==========================================
    // AUDITORÍA / RESULTADO (ganador + retiros + premio por modalidad)
    // Los valores editables quedan REGISTRADOS en la tabla para las próximas jugadas
    // ==========================================
    let premioOrigTemp = 0, sumaBaseTemp = 0, caballosModalTemp = [], premioManual = false;

    function inpValAud(id) { return document.getElementById(id); }

    function actualizarDesglosePremio(premioMostrado, valRet) {
        const el = inpValAud('lblDesglosePremio');
        const campo = inpValAud('inpPremioRecalculado').value;
        if (!el) return;
        if (premioManual) {
            el.textContent = `Ajuste manual: el premio que se publicará será ${clubUI.formatoNumero(aNum(campo) || 0, 2)} por tabla.`;
            return;
        }
        if (valRet > 0 && sumaBaseTemp > 0) {
            const pct = (valRet / sumaBaseTemp) * 100;
            el.textContent = `Premio original ${clubUI.formatoNumero(premioOrigTemp, 2)} − retiros ${clubUI.formatoNumero(valRet, 1)} (${clubUI.formatoNumero(pct, 1)}%) = ${clubUI.formatoNumero(premioMostrado, 2)}`;
        } else {
            el.textContent = `Premio oficial ${clubUI.formatoNumero(premioOrigTemp, 2)} por tabla — sin descuento por retiros`;
        }
    }

    function refrescarPremioAuditoria() {
        if (premioManual) return;
        let valRet = 0;
        caballosModalTemp.forEach(c => { if (c.retirado) valRet += parseFloat(c.valor_ejemplar) || 0; });
        let p = premioOrigTemp;
        if (sumaBaseTemp > 0 && valRet > 0) p = premioOrigTemp * (1 - (valRet / sumaBaseTemp));
        p = Math.max(0, p);
        inpValAud('inpPremioRecalculado').value = clubUI.formatoNumero(p, 2);
        inpValAud('lblPremioRecalculadoBig').textContent = clubUI.formatoNumero(p, 2);
        actualizarDesglosePremio(p, valRet);
    }

    function syncAuditoriaDesdeDOM() {
        document.querySelectorAll('.inp-valor-aud').forEach(inp => {
            const idx = parseInt(inp.dataset.index);
            const v = aNum(inp.value);
            if (caballosModalTemp[idx]) caballosModalTemp[idx].valor_ejemplar = (v === null || v === undefined) ? 0 : v;
        });
        document.querySelectorAll('.chk-retiro').forEach(chk => {
            const idx = parseInt(chk.dataset.index);
            if (caballosModalTemp[idx]) caballosModalTemp[idx].retirado = chk.checked;
        });
        const rdoGanador = document.querySelector('.rdo-ganador:checked');
        if (rdoGanador) {
            const idxG = parseInt(rdoGanador.dataset.index);
            caballosModalTemp.forEach((c, i) => { c.ganador = (i === idxG); });
            if (caballosModalTemp[idxG]) caballosModalTemp[idxG].retirado = false;
        }
    }

    function abrirModalAuditoria(id) {
        const t = datosTablaCompleta.find(x => x.id == id);
        if (!t) return;
        inpValAud('auditoriaTablaId').value = id;
        premioOrigTemp = parseFloat(t.premio_original) || 100;
        sumaBaseTemp = parseFloat(t.suma_base_tabla) || 160;
        caballosModalTemp = [...(t.caballos || [])].map(c => ({ ...c }));
        premioManual = false;

        inpValAud('auditoriaInfoCabecera').textContent = `${t.hipodromo || '-'} · Carrera ${t.carrera ?? '-'} · ${t.distancia_carrera || '-'} m · Superficie: ${t.superficie || '-'} · Moneda: ${t.moneda || '-'} · Estado: ${t.estado || '-'}`;
        inpValAud('inpPremioOriginal').value = clubUI.formatoNumero(premioOrigTemp, 2);
        inpValAud('inpSumaBase').value = clubUI.formatoNumero(sumaBaseTemp, 1);
        inpValAud('inpComisionGrupo').value = clubUI.formatoNumero(parseFloat(t.comision_grupo) || 0, 2);
        const premioInicial = parseFloat(t.premio_recalculado) || premioOrigTemp;
        inpValAud('lblPremioRecalculadoBig').textContent = clubUI.formatoNumero(premioInicial, 2);
        inpValAud('inpPremioRecalculado').value = clubUI.formatoNumero(premioInicial, 2);

        const cont = inpValAud('listaEjemplaresAuditoria');
        cont.innerHTML = caballosModalTemp.map((c, i) => {
            const badgeRetirado = c.retirado ? ' <span class="text-red-500 text-[9px] font-black">(RETIRADO)</span>' : '';
            return `
                <label class="flex items-center gap-2 bg-white border border-slate-200 p-2 rounded cursor-pointer text-xs ${c.retirado ? 'opacity-60' : ''}">
                    <input type="radio" name="ganador-carrera" class="rdo-ganador" data-index="${i}" ${c.ganador ? 'checked' : ''} title="Ganador de la carrera">
                    <input type="checkbox" class="chk-retiro" data-index="${i}" ${c.retirado ? 'checked' : ''} title="Marcar como retirado">
                    <span class="w-5 h-5 flex items-center justify-center rounded-full text-[9px] font-black shrink-0" style="background:${colorDeNumero(c.numero)};color:${textoDeNumero(c.numero)}">${c.numero}</span>
                    <span class="flex-1 font-bold text-slate-700 truncate" title="${c.nombre}">${c.nombre}${badgeRetirado}</span>
                    <input type="text" inputmode="decimal" class="inp-valor-aud w-20 text-right border border-slate-300 rounded px-1 py-0.5 text-[11px] font-bold outline-none focus:ring-2 focus:ring-amber-500 ${c.retirado ? 'bg-slate-100 text-slate-400' : 'bg-white'}" data-index="${i}" value="${clubUI.formatoNumero(parseFloat(c.valor_ejemplar) || 0, 1)}" title="Valor del ejemplar en la tabla">
                </label>`;
        }).join('') || '<p class="text-xs text-slate-400 italic text-center py-2">Sin ejemplares.</p>';

        cont.querySelectorAll('.inp-valor-aud').forEach(inp => inp.addEventListener('input', () => {
            const idx = parseInt(inp.dataset.index);
            const v = aNum(inp.value);
            if (caballosModalTemp[idx]) caballosModalTemp[idx].valor_ejemplar = (v === null || v === undefined) ? 0 : v;
            refrescarPremioAuditoria();
        }));

        cont.querySelectorAll('.chk-retiro').forEach(chk => chk.addEventListener('change', () => {
            const idx = parseInt(chk.dataset.index);
            if (!caballosModalTemp[idx]) return;
            caballosModalTemp[idx].retirado = chk.checked;
            const label = chk.closest('label');
            const inpV = label.querySelector('.inp-valor-aud');
            const txtNom = label.querySelector('.flex-1');
            if (chk.checked) {
                label.classList.add('opacity-60');
                inpV.classList.remove('bg-white'); inpV.classList.add('bg-slate-100', 'text-slate-400');
                const rdo = cont.querySelector(`.rdo-ganador[data-index="${idx}"]`);
                if (rdo && rdo.checked) rdo.checked = false;
                if (!txtNom.querySelector('.text-red-500')) txtNom.insertAdjacentHTML('beforeend', ' <span class="text-red-500 text-[9px] font-black">(RETIRADO)</span>');
            } else {
                label.classList.remove('opacity-60');
                inpV.classList.add('bg-white'); inpV.classList.remove('bg-slate-100', 'text-slate-400');
                const badge = txtNom.querySelector('.text-red-500');
                if (badge) badge.remove();
            }
            refrescarPremioAuditoria();
        }));

        cont.querySelectorAll('.rdo-ganador').forEach(rdo => rdo.addEventListener('change', () => {
            if (!rdo.checked) return;
            const idx = parseInt(rdo.dataset.index);
            const label = rdo.closest('label');
            const chk = label.querySelector('.chk-retiro');
            const inpV = label.querySelector('.inp-valor-aud');
            if (chk && chk.checked) {
                chk.checked = false;
                if (caballosModalTemp[idx]) {
                    caballosModalTemp[idx].retirado = false;
                    caballosModalTemp[idx].ganador = true;
                }
                label.classList.remove('opacity-60');
                inpV.classList.remove('bg-slate-100', 'text-slate-400');
                inpV.classList.add('bg-white');
                const badge = label.querySelector('.flex-1 .text-red-500');
                if (badge) badge.remove();
                refrescarPremioAuditoria();
            } else if (caballosModalTemp[idx]) {
                caballosModalTemp[idx].ganador = true;
            }
        }));

        inpValAud('modalAuditoria').classList.remove('hidden');

        const valRetAbierto = caballosModalTemp.reduce((acc, c) => acc + (c.retirado ? (parseFloat(c.valor_ejemplar) || 0) : 0), 0);
        const pFormula = sumaBaseTemp > 0 && valRetAbierto > 0 ? premioOrigTemp * (1 - (valRetAbierto / sumaBaseTemp)) : premioOrigTemp;
        const elDesg = inpValAud('lblDesglosePremio');
        if (Math.abs(pFormula - premioInicial) > 0.001) {
            elDesg.textContent = `Fórmula: ${clubUI.formatoNumero(premioOrigTemp, 2)} − retiros ${clubUI.formatoNumero(valRetAbierto, 1)} = ${clubUI.formatoNumero(Math.max(0, pFormula), 2)} · publicado: ${clubUI.formatoNumero(premioInicial, 2)} (ajuste manual)`;
        } else {
            actualizarDesglosePremio(premioInicial, valRetAbierto);
        }
    }

    inpValAud('inpPremioOriginal').addEventListener('input', () => {
        premioOrigTemp = aNum(inpValAud('inpPremioOriginal').value) || 0;
        premioManual = false;
        refrescarPremioAuditoria();
    });
    inpValAud('inpSumaBase').addEventListener('input', () => {
        sumaBaseTemp = aNum(inpValAud('inpSumaBase').value) || 0;
        premioManual = false;
        refrescarPremioAuditoria();
    });
    inpValAud('inpPremioRecalculado').addEventListener('input', () => {
        premioManual = true;
        inpValAud('lblPremioRecalculadoBig').textContent = clubUI.formatoNumero(aNum(inpValAud('inpPremioRecalculado').value) || 0, 2);
        actualizarDesglosePremio(0, 0);
    });
    inpValAud('btnRecalcularPremio').addEventListener('click', () => { premioManual = false; refrescarPremioAuditoria(); });

    // Enter / Tab: navegar DE VALOR EN VALOR dentro del modal de auditoría
    inpValAud('modalAuditoria').addEventListener('keydown', (e) => {
        if (!['Enter', 'Tab'].includes(e.key)) return;
        const t = e.target;
        const esValor = t.tagName === 'INPUT' && (t.classList.contains('inp-valor-aud')
            || ['inpPremioOriginal', 'inpSumaBase', 'inpComisionGrupo', 'inpPremioRecalculado'].includes(t.id));
        if (!esValor) return;
        e.preventDefault();
        const campos = [
            ...['inpPremioOriginal', 'inpSumaBase', 'inpComisionGrupo', 'inpPremioRecalculado'].map(id => inpValAud(id)).filter(Boolean),
            ...[...inpValAud('listaEjemplaresAuditoria').querySelectorAll('.inp-valor-aud')]
        ].filter(el => !el.disabled);
        const idx = campos.indexOf(t);
        const dir = (e.key === 'Tab' && e.shiftKey) ? -1 : 1;
        const sig = campos[(idx + dir + campos.length) % campos.length];
        if (sig) { sig.focus(); if (sig.select) sig.select(); }
    });

    inpValAud('btnProcesarAuditoria').addEventListener('click', async () => {
        const id = inpValAud('auditoriaTablaId').value;
        const np = aNum(inpValAud('inpPremioRecalculado').value);
        if (np === null || np === undefined) return clubUI.toast('El premio recalculado es inválido.', 'error');
        premioOrigTemp = aNum(inpValAud('inpPremioOriginal').value) || 0;
        sumaBaseTemp = aNum(inpValAud('inpSumaBase').value) || 0;
        const comision = aNum(inpValAud('inpComisionGrupo').value) || 0;

        syncAuditoriaDesdeDOM();

        const ret = caballosModalTemp.filter(c => c.retirado).map(c => c.numero);
        const tAud = datosTablaCompleta.find(x => x.id == id);

        // Registro de la modificación (diferencias con los valores previos)
        const cambios = [];
        if (tAud) {
            if ((parseFloat(tAud.premio_original) || 0) !== premioOrigTemp) cambios.push(`Premio Original ${clubUI.formatoNumero(parseFloat(tAud.premio_original) || 0, 2)} → ${clubUI.formatoNumero(premioOrigTemp, 2)}`);
            if ((parseFloat(tAud.suma_base_tabla) || 0) !== sumaBaseTemp) cambios.push(`Suma Base ${tAud.suma_base_tabla} → ${sumaBaseTemp}`);
            if ((parseFloat(tAud.comision_grupo) || 0) !== comision) cambios.push(`Comisión ${tAud.comision_grupo}% → ${comision}%`);
            if ((parseFloat(tAud.premio_recalculado) || 0) !== np) cambios.push(`Premio Recalculado ${clubUI.formatoNumero(parseFloat(tAud.premio_recalculado) || 0, 2)} → ${clubUI.formatoNumero(np, 2)}`);
            (tAud.caballos || []).forEach((o, i) => {
                const c = caballosModalTemp[i];
                if (c && (parseFloat(o.valor_ejemplar) || 0) !== (parseFloat(c.valor_ejemplar) || 0)) {
                    cambios.push(`Valor N°${c.numero} ${clubUI.formatoNumero(parseFloat(o.valor_ejemplar) || 0, 1)} → ${clubUI.formatoNumero(parseFloat(c.valor_ejemplar) || 0, 1)}`);
                }
            });
        }

        const { error } = await window.supabase.from('tablas_fijas').update({
            premio_original: premioOrigTemp,
            suma_base_tabla: sumaBaseTemp,
            comision_grupo: comision,
            premio_recalculado: np,
            caballos: caballosModalTemp,
            estado: 'Auditada',
            retirados_oficiales: ret.length > 0 ? ret.join(',') : NO_RETIROS
        }).eq('id', id);

        if (error) return clubUI.toast('Error al registrar: ' + (error.message || error.code), 'error');

        inpValAud('modalAuditoria').classList.add('hidden');
        cargarTablas();
        const resumenCambios = cambios.length > 0 ? 'Cambios registrados:<br>• ' + cambios.join('<br>• ') : 'Resultado registrado sin cambios de valores.';
        clubUI.aviso('Auditoría registrada', `${resumenCambios}<br><br>Los valores quedan vigentes para las próximas jugadas.`, 'success');
        if (window.clubDB?.logAccion) window.clubDB.logAccion('TABLAS', `auditada: ${tAud?.hipodromo} C${tAud?.carrera} premio=${np} retirados=[${ret.length ? ret.join(',') : NO_RETIROS}] cambios=[${cambios.join(' | ') || 'ninguno'}] (id=${id})`);
    });

    // ==========================================
    // VENTA DE TABLAS FIJAS DESDE EL MONITOR
    // ==========================================
    let clientesVentaCache = [];
    let ventaModalAbierta = false;

    function gruposDeCliente(cliId) {
        const c = clientesVentaCache.find(x => String(x.id) === String(cliId));
        return c ? (c.grupos || []) : [];
    }

    async function cargarClientesVenta() {
        const sel = document.getElementById('selectClienteVenta');
        if (!sel) return;
        try {
            const { data: cli, error: e1 } = await window.supabase.from('clientes').select('id, nombre, saldo_actual, aval, libre, modo_juego, grupo_id');
            if (e1) throw e1;
            const { data: cg, error: e2 } = await window.supabase.from('clientes_grupos').select('grupo_id, cliente_id');
            if (e2) throw e2;
            clientesVentaCache = (cli || []).map(c => ({
                ...c,
                grupos: [...new Set([...((cg || []).filter(x => x.cliente_id == c.id).map(x => x.grupo_id)), c.grupo_id].filter(Boolean))]
            }));
            if (ventaModalAbierta) poblarClientesVenta();
        } catch (e) { console.error(e); }
    }

    function poblarClientesVenta() {
        const sel = document.getElementById('selectClienteVenta');
        sel.innerHTML = '<option value="">Seleccione el jugador...</option>' + clientesVentaCache.map(c => {
            const etiqueta = (c.grupos || []).map(gid => {
                const g = gruposActivos.find(x => x.id == gid);
                return g ? g.nombre : '';
            }).filter(Boolean).join(', ');
            return `<option value="${c.id}" data-saldo="${c.saldo_actual ?? 0}">${c.nombre}${etiqueta ? ` — [${etiqueta}]` : ''}</option>`;
        }).join('');
        actualizarResumenVenta();
    }

    function ticksGrupoVenta(t) {
        return (t && t.tabla_grupos ? t.tabla_grupos : []).map(tg => {
            const g = gruposActivos.find(x => x.id == tg.grupo_id);
            const disp = (tg.cupos || 0) - (tg.cantidad_vendida || 0);
            return `<option value="${tg.id}" data-groupid="${tg.grupo_id}">${g ? g.nombre : 'Grupo #' + tg.grupo_id} (${disp} disp)</option>`;
        }).join('');
    }

    async function abrirModalVenta(id) {
        ventaModalAbierta = true;
        const t = datosTablaCompleta.find(x => x.id == id);
        if (!t) return clubUI.toast('Tabla no encontrada. Recargue el monitor.', 'error');

        document.getElementById('selectCarreraVenta').innerHTML = '<option value="">Seleccione la carrera...</option>' + datosTablaCompleta.filter(x => x.estado === 'Abierta').map(x => `
            <option value="${x.id}" ${x.id == id ? 'selected' : ''}>${x.hipodromo} C${x.carrera} — ${x.moneda === 'VES' ? 'Bs ' : '$'}${clubUI.formatoNumero(parseFloat(x.premio_recalculado) || 0, 2)}</option>
        `).join('');
        document.getElementById('selectGrupoVenta').innerHTML = ticksGrupoVenta(t);
        document.getElementById('selectEjemplarVenta').innerHTML = (t.caballos || []).map((c, i) => `
            <option value="${i}">N° ${c.numero} — ${c.nombre} (${c.valor_ejemplar})</option>
        `).join('') || '<option value="">Sin ejemplares</option>';
        document.getElementById('cantidadVenta').value = 1;
        document.getElementById('modalVenta').classList.remove('hidden');
        await cargarClientesVenta();
        actualizarResumenVenta();
    }

    function actualizarResumenVenta() {
        const idCar = document.getElementById('selectCarreraVenta').value;
        const idTg = document.getElementById('selectGrupoVenta').value;
        const idxEje = document.getElementById('selectEjemplarVenta').value;
        const idCli = document.getElementById('selectClienteVenta').value;
        const cantidad = Math.max(1, parseInt(document.getElementById('cantidadVenta').value) || 1);
        const t = datosTablaCompleta.find(x => x.id == idCar);
        const monedaS = t?.moneda === 'VES' ? 'Bs ' : '$';
        const tg = (t?.tabla_grupos || []).find(x => String(x.id) === String(idTg));
        const ej = tg && idxEje !== '' ? (t.caballos || [])[parseInt(idxEje)] : null;

        const publDisp = document.getElementById('lblDispGrupoVenta');
        document.getElementById('lblValorUnitVenta').textContent = '0.00';
        document.getElementById('lblCostoVenta').textContent = '0.00';
        document.getElementById('lblPremioUnitVenta').textContent = '0.00';
        document.getElementById('lblPremioTotalVenta').textContent = '0.00';
        document.getElementById('lblGananciaVenta').textContent = '0.00';
        document.getElementById('lblComisionVenta').textContent = '0.00';
        document.getElementById('lblSaldoClienteVenta').textContent = '$0.00';
        publiLasTxt(document.getElementById('lblGrupoClienteVenta'), '');
        if (!t || !tg || !ej) { publDisp.textContent = '0'; return; }

        const disp = (tg.cupos || 0) - (tg.cantidad_vendida || 0);
        publDisp.textContent = disp;
        publDisp.className = disp >= cantidad ? 'text-emerald-600' : 'text-red-600';

        const pts = parseFloat(ej.valor_ejemplar) || 0;
        const premio = parseFloat(t.premio_recalculado) || 0;
        const costoTotal = pts * cantidad;
        const premioTotal = premio * cantidad;
        const ganancia = Math.max(0, premioTotal - costoTotal);
        const comPorc = parseFloat(t.comision_grupo || 2.5);
        document.getElementById('lblValorUnitVenta').textContent = monedaS + clubUI.formatoNumero(pts, 2);
        document.getElementById('lblCostoVenta').textContent = monedaS + clubUI.formatoNumero(costoTotal, 2);
        document.getElementById('lblPremioUnitVenta').textContent = monedaS + clubUI.formatoNumero(premio, 2);
        document.getElementById('lblPremioTotalVenta').textContent = monedaS + clubUI.formatoNumero(premioTotal, 2);
        document.getElementById('lblGananciaVenta').textContent = monedaS + clubUI.formatoNumero(ganancia, 2);
        document.getElementById('lblComisionPorcVenta').textContent = clubUI.formatoNumero(comPorc, 1);
        document.getElementById('lblComisionVenta').textContent = monedaS + clubUI.formatoNumero(ganancia * comPorc / 100, 2);

        if (idCli) {
            const cli = clientesVentaCache.find(c => String(c.id) === String(idCli));
            if (cli) {
                document.getElementById('lblSaldoClienteVenta').textContent = '$' + clubUI.formatoNumero(parseFloat(cli.saldo_actual) || 0, 2);
                const grpCliV = (cli.grupos || [])
                    .map(gid => gruposActivos.find(g => g.id == gid))
                    .filter(Boolean);
                const grpCarrera = (t.tabla_grupos || []).map(x => String(x.grupo_id));
                const enCarrera = grpCliV.filter(g => grpCarrera.includes(String(g.id)));
                const nombreGrupo = gruposActivos.find(g => g.id == tg.grupo_id)?.nombre || '';
                if (grpCliV.length === 0) {
                    publiLasTxt(document.getElementById('lblGrupoClienteVenta'), 'Jugador sin grupo asignado.', true);
                } else if (enCarrera.length === 0) {
                    publiLasTxt(document.getElementById('lblGrupoClienteVenta'), `Grupo(s): ${grpCliV.map(g => g.nombre).join(', ')} — no pertenece a "${nombreGrupo}" de esta carrera.`, true);
                } else {
                    publiLasTxt(document.getElementById('lblGrupoClienteVenta'), `Grupo(s): ${grpCliV.map(g => g.nombre).join(', ')}`);
                }
            }
        }
    }

    function publiLasTxt(el, txt, peligro = false) {
        el.innerHTML = txt;
        el.classList.toggle('text-red-600', peligro);
        el.classList.toggle('text-slate-500', !peligro);
    }

    ['selectCarreraVenta', 'selectGrupoVenta', 'selectEjemplarVenta', 'selectClienteVenta'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', () => {
            if (id === 'selectCarreraVenta') {
                const t = datosTablaCompleta.find(x => x.id == document.getElementById(id).value);
                document.getElementById('selectGrupoVenta').innerHTML = ticksGrupoVenta(t);
                document.getElementById('selectEjemplarVenta').innerHTML = (t && t.caballos ? t.caballos : []).map((c, i) => `
                    <option value="${i}">N° ${c.numero} — ${c.nombre} (${c.valor_ejemplar})</option>
                `).join('') || '<option value="">Sin ejemplares</option>';
            }
            if (id === 'selectClienteVenta') {
                const gidsCli = gruposDeCliente(document.getElementById(id).value);
                if (gidsCli.length === 1) {
                    const opt = [...document.getElementById('selectGrupoVenta').options].find(o => o.dataset.groupid == gidsCli[0]);
                    if (opt) document.getElementById('selectGrupoVenta').value = opt.value;
                }
            }
            actualizarResumenVenta();
        });
    });
    document.getElementById('cantidadVenta')?.addEventListener('input', actualizarResumenVenta);

    document.getElementById('btnProcesarVentaModal').addEventListener('click', async () => {
        const idCar = document.getElementById('selectCarreraVenta').value;
        const idTg = document.getElementById('selectGrupoVenta').value;
        const idxEje = document.getElementById('selectEjemplarVenta').value;
        const idCli = document.getElementById('selectClienteVenta').value;
        if (!idCar || !idTg || idxEje === '' || !idCli) return clubUI.toast('Complete todos los campos de la venta.', 'warning');
        const cantidad = parseInt(document.getElementById('cantidadVenta').value) || 0;
        if (cantidad <= 0) return clubUI.toast('Cantidad inválida.', 'warning');

        const t = datosTablaCompleta.find(x => x.id == idCar);
        const tg = (t?.tabla_grupos || []).find(x => String(x.id) === String(idTg));
        const ej = (t?.caballos || [])[parseInt(idxEje)];
        const cli = clientesVentaCache.find(c => String(c.id) === String(idCli));
        const grupo = gruposActivos.find(g => g.id == tg?.grupo_id);
        if (!t || !tg || !ej || !cli) return clubUI.toast('Datos de venta inconsistentes. Recargue las tablas.', 'error');
        if (!grupo) return clubUI.toast('Grupo no encontrado.', 'error');
        const gruposCli = cli.grupos || [];
        if (gruposCli.length > 0 && !gruposCli.includes(grupo.id)) {
            return clubUI.toast(`El jugador ${cli.nombre} no pertenece al grupo "${grupo.nombre}" de esta carrera.`, 'error');
        }

        const btnP = document.getElementById('btnProcesarVentaModal');
        btnP.disabled = true;
        try {
            const res = await VentaTablasCore.venderTabla({ cliente: cli, cantidad, ejemplar: ej, tabla: t, tg, grupo, tasaCambio: tasaCambioGlobal });
            if (!res.ok) { clubUI.toast(res.error || 'No se pudo procesar la venta.', 'error'); return; }
            const saldoPosterior = (parseFloat(cli.saldo_actual) || 0) - (grupo.moneda === 'VES' ? res.costoTotal / (tasaCambioGlobal || 1) : res.costoTotal);
            VentaTablasCore.printHTML('Comprobante de Venta', VentaTablasCore.comprobanteHTML({ cliente: cli, ejemplar: ej, tabla: t, grupo, cantidad, res, tasaCambio: tasaCambioGlobal, saldoPosterior }));
            document.getElementById('modalVenta').classList.add('hidden');
            ventaModalAbierta = false;
            if (window.clubDB?.logAccion) window.clubDB.logAccion('TABLAS', `Venta modal: ${cli.nombre} x${cantidad} ${ej.nombre} ${VentaTablasCore.simboloMoneda(grupo.moneda)}${res.costoTotal} (idTabla=${t.id} grupo=${grupo.nombre})`);
            cargarTablas(); cargarClientesVenta();
            clubUI.aviso('Venta registrada', `Ticket de ${cantidad} Tabla(s) para <strong>${cli.nombre}</strong> (${grupo.nombre}).<br>Premio si gana: ${VentaTablasCore.simboloMoneda(grupo.moneda)}${clubUI.formatoNumero(res.premioTotal, 2)}`, 'success');
        } finally { btnP.disabled = false; }
    });

    document.querySelectorAll('.cerrar-modal').forEach(b => b.addEventListener('click', () => {
        document.getElementById('modalAuditoria').classList.add('hidden');
        document.getElementById('modalDuplicar').classList.add('hidden');
        document.getElementById('modalEditar').classList.add('hidden');
        document.getElementById('modalVenta').classList.add('hidden');
        ventaModalAbierta = false;
    }));

    document.getElementById('btnRecargarTablas').addEventListener('click', () => {
        cargarTasaGlobal(); cargarHipodromos(); cargarGrupos(); cargarEjemplares(); cargarTablas(); cargarClientesVenta();
    });

    const btnPublicarTodas = document.getElementById('btnPublicarTodas');
    if (btnPublicarTodas) btnPublicarTodas.addEventListener('click', publicarTodas);

    // ==========================================
    // AÑADIR CARRERA DESDE LOS PARÁMETROS
    // ==========================================
    btnAgregarCarrera.addEventListener('click', () => {
        const hipodromo = document.getElementById('hipodromoTabla').value;
        const carrera = document.getElementById('carreraTabla').value;
        const distancia = document.getElementById('distanciaTabla').value;
        const superficie = document.getElementById('superficieTabla').value;
        const premio = premioTabla.value;
        if (!hipodromo) return clubUI.toast('Seleccione el hipódromo.', 'warning');
        if (!carrera) return clubUI.toast('Indique el número de carrera.', 'warning');
        if (hipodromo && ![ ...document.getElementById('hipodromoTabla').options].some(o => o.value === hipodromo)) {
            asegurarHipodromoEnDB(hipodromo);
        }
        crearCardCarrera({ hipodromo, carrera, distancia, superficie, premio, caballos: [] });
        clubUI.toast(`Carrera C${carrera} (${hipodromo}) añadida al Ensamblaje. Agregue sus ejemplares.`, 'success');
    });

    // ==========================================
    // HIPÓDROMOS NO LISTADOS -> se registran
    // ==========================================
    const HIPODROMOS_USA = ['aqueduct', 'belmont park', 'charles town', 'churchill downs', 'del mar', 'fair grounds',
        'finger lakes', 'golden gate fields', 'gulfstream park', 'keeneland', 'laurel park', 'los alamitos',
        'monmouth park', 'oaklawn park', 'pimlico', 'santa anita', 'saratoga', 'tampa bay downs'];
    function adivinarPaisHipodromo(nombre) {
        const n = (nombre || '').toLowerCase();
        if (HIPODROMOS_USA.some(h => n.includes(h) || h.includes(n))) return 'USA';
        if (n.includes('rinconada') || n.includes('valencia') || n.includes('santa rita') || n.includes('pomona')) return 'VE';
        return 'OTRO';
    }
    async function asegurarHipodromoEnDB(nombre) {
        try {
            const { data } = await window.supabase.from('hipodromos').select('id').eq('nombre', nombre).maybeSingle();
            if (data) return;
            const { error } = await window.supabase.from('hipodromos').insert({ nombre, pais: adivinarPaisHipodromo(nombre) });
            if (error) console.warn('No se pudo registrar el hipódromo automáticamente:', error);
            else clubUI.toast(`Hipódromo "${nombre}" registrado en el catálogo.`, 'success');
        } catch (e) {
            console.warn('No se pudo registrar el hipódromo automáticamente:', e);
        }
    }

    // ==========================================
    // PRELLENADO DESDE GACETA (registro persistente del día)
    // ==========================================
    // La Gaceta guarda en 'gaceta_registro' las carreras del día con las
    // marcas enviada/aplicada. Aquí sólo se vuelven a pegar las que aún no
    // se aplicaron, sin re-transformar y sin duplicar cards.
    function leerGacetaRegistro() {
        try { const a = JSON.parse(localStorage.getItem('gaceta_registro')); if (Array.isArray(a)) return a; } catch (e) { /* nada */ }
        try { const a = JSON.parse(sessionStorage.getItem('gaceta_registro')); if (Array.isArray(a)) return a; } catch (e) { /* nada */ }
        return [];
    }
    function escribirGacetaRegistro(arr) {
        // Escritura SIMPLE: el array se guarda como llega. Aquí también se
        // limpia el "buzón" de envío para que el siguiente envío no duplique.
        try { localStorage.setItem('gaceta_registro', JSON.stringify(arr)); } catch (e) { /* nada */ }
        try { sessionStorage.setItem('gaceta_registro', JSON.stringify(arr)); } catch (e) { /* nada */ }
        ['ensamblaje_carreras', 'gaceta_prellenado'].forEach(k => {
            try { localStorage.removeItem(k); } catch (e) { /* nada */ }
            try { sessionStorage.removeItem(k); } catch (e) { /* nada */ }
        });
    }
    // Al publicar (o quitar) una carrera del Ensamblaje, se quita del registro:
    // así al volver a entrar la página no reaparece una carrera ya publicada.
    function eliminarDelRegistroGaceta(hipodromo, carrera) {
        const reg = leerGacetaRegistro();
        if (!reg.length) return;
        const h = String(hipodromo || '').trim().toUpperCase();
        const c = String(carrera ?? '');
        const filtrados = reg.filter(item =>
            String(item.hipodromo || '').trim().toUpperCase() !== h
            || String(item.carrera ?? '') !== c
        );
        if (filtrados.length !== reg.length) escribirGacetaRegistro(filtrados);
    }
    function migrarLegacy() {
        // Compatibilidad con el flujo previo (antes del registro persistente):
        // se convierte una única vez y se borran las claves viejas.
        const leer = (k) => localStorage.getItem(k) || sessionStorage.getItem(k);
        let migradas = [];
        try {
            const arr = JSON.parse(leer('ensamblaje_carreras'));
            if (Array.isArray(arr)) migradas = migradas.concat(arr.map(c => Object.assign({}, c, { enviada: false })));
        } catch (e) { /* nada */ }
        try {
            const p = JSON.parse(leer('gaceta_prellenado'));
            if (p && p.hipodromo) migradas.push(Object.assign({}, p, { enviada: false }));
        } catch (e) { /* nada */ }
        return migradas;
    }

    // El registro guarda la lista como "ejemplares"; el buzón (entrega directa)
    // la guarda como "caballos". Se aceptan ambos.
    function listaHors(p) {
        if (Array.isArray(p.caballos) && p.caballos.length) return p.caballos;
        if (Array.isArray(p.ejemplares)) return p.ejemplares;
        return [];
    }

    function construirCardsGaceta(pendientes) {
        // Las cards se dibujan INMEDIATAMENTE, sin esperar catálogos.
        // Los catálogos (hipódromos/grupos/padrón) se cargan por detrás;
        // si fallan no bloquean el ensamblaje.
        let montadas = 0;
        try {
            pendientes.forEach(pre => {
                const caballos = listaHors(pre).map(c => ({
                    numero: c.numero, nombre: c.nombre, nacionalidad: c.nacionalidad || 'VE',
                    valor: aNum(c.valor) ?? aNum(c.pts) ?? null
                })).filter(c => c.nombre);
                crearCardCarrera({
                    hipodromo: pre.hipodromo || '',
                    carrera: pre.carrera || '',
                    distancia: pre.distancia || '',
                    superficie: pre.superficie || '',
                    premio: pre.premio || premioTabla.value || 100,
                    caballos
                });
                montadas++;
                // El programa del día queda grabado para los demás módulos
                window.clubPrograma?.agregarCarrera({
                    hipodromo: pre.hipodromo || '',
                    carrera: pre.carrera || null,
                    distancia: pre.distancia || null,
                    superficie: pre.superficie || '',
                    premio: pre.premio || 0,
                    caballos
                })?.catch?.(() => {});
                if (pre.hipodromo) {
                    // Asegurar que el hipódromo quede en el catálogo (los propios de la gaceta)
                    const selHipo = document.getElementById('hipodromoTabla');
                    if (![...selHipo.options].some(o => o.value.toUpperCase() === pre.hipodromo.toUpperCase())) {
                        asegurarHipodromoEnDB(pre.hipodromo);
                    }
                }
            });
        } catch (err) {
            console.error('Error al montar cards del ensamblaje:', err);
        }
        return montadas;
    }

    function pegarPendientesGaceta({ silencio = false, forzar = false } = {}) {
        // Las carreras del día se montan en CADA entrada a la página (primera vez,
        // segunda vez o pestaña nueva). Dentro de la misma visita, si ya se montaron
        // cards, no se vuelven a crear (evita duplicar con el botón manual).
        if (!forzar && carrerasBol.length > 0) {
            if (!silencio) clubUI.toast('Las carreras del día ya están montadas en esta pestaña.', 'warning');
            return 0;
        }
        // 1) Buzón legacy + registro completo del día.
        let pendientes = migrarLegacy();
        const registro = leerGacetaRegistro();
        for (const c of registro) pendientes.push(c);

        // 2) Dedupe por hipódromo + carrera + nombres.
        const vistos = new Set();
        const unicos = [];
        for (const p of pendientes) {
            if (!p || typeof p !== 'object') continue;
            const hipo = String(p.hipodromo || '').trim().toUpperCase();
            const num = String(p.carrera ?? '');
            const cab = listaHors(p).map(c => String(c.nombre || '')).join('|').toUpperCase();
            const clave = `${hipo}#${num}#${cab}`;
            if (vistos.has(clave)) continue;
            vistos.add(clave);
            unicos.push(p);
        }
        if (unicos.length === 0) {
            if (!silencio) clubUI.toast('No hay carreras del día en el registro para mostrar.', 'warning');
            return 0;
        }
        const montadas = construirCardsGaceta(unicos);
        // 3) Actualizar el registro guardado.
        const finales = [...registro];
        for (const p of unicos) {
            if (!finales.some(item =>
                String(item.hipodromo || '').trim().toUpperCase() === String(p.hipodromo || '').trim().toUpperCase()
                && String(item.carrera ?? '') === String(p.carrera ?? '')
            )) finales.push(Object.assign({}, p));
        }
        escribirGacetaRegistro(finales);
        // 4) Catálogos en segundo plano.
        Promise.all([cargarHipodromos(), cargarGrupos(), cargarEjemplares()].map(p => p.catch(() => {})))
            .catch(() => { /* silencioso */ });
        contarCarreras();
        if (!silencio) {
            clubUI.toast(`${montadas} carrera(s) con ${unicos.reduce((a, p) => a + listaHors(p).length, 0)} ejemplares montada(s) en el Ensamblaje. Revise y publique.`, 'success');
            contenedorCarreras.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        return montadas;
    }

    // Pegado manual (rescate): vuelve a pegar lo que la gaceta dejó pendiente.
    const btnPegarGaceta = document.getElementById('btnPegarGaceta');
    if (btnPegarGaceta) {
        btnPegarGaceta.addEventListener('click', () => {
            const leer = (k) => localStorage.getItem(k) || sessionStorage.getItem(k);
            const sinNada = !leer('gaceta_registro') && !leer('ensamblaje_carreras') && !leer('gaceta_prellenado');
            if (sinNada) return clubUI.toast('El navegador no tiene carreras guardadas de la gaceta.', 'warning');
            pegarPendientesGaceta();
        });
    }

    // ==========================================
    // SOLO NÚMEROS en los campos Valor (tablas y gaceta): se bloquean letras y
    // se limpia lo que venga de un pegado.
    // ==========================================
    const INPUTS_VALOR = '.in-cab-valor, .nuevo-valor, .gac-valor, .in-premio-card';
    document.addEventListener('keydown', (e) => {
        const t = e.target;
        if (!t || !t.matches || !t.matches(INPUTS_VALOR)) return;
        if (e.key === 'Tab' || e.key === 'Enter' || e.key === 'Backspace' || e.key === 'Delete' ||
            e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End' ||
            e.ctrlKey || e.metaKey || /^[0-9.,eE+-]$/.test(e.key)) return;
        e.preventDefault();
    });
    document.addEventListener('input', (e) => {
        const t = e.target;
        if (!t || !t.matches || !t.matches(INPUTS_VALOR)) return;
        const limpio = String(t.value || '').replace(/[^0-9.,eE+-]/g, '');
        if (limpio !== t.value) t.value = limpio;
    });

    // ==========================================
    // ARRANQUE
    // ==========================================
    llenarSuperficies();
    cargarTasaGlobal();
    cargarTablas();
    cargarClientesVenta();
    // Catálogos: cargan siempre, pero nunca bloquean el ensamblaje si fallan
    [cargarHipodromos(), cargarGrupos(), cargarEjemplares()].forEach(p => p && p.catch && p.catch(() => {}));
    pegarPendientesGaceta({ silencio: true });

    async function verificarSqlPendiente() {
        if (!window.supabase) return;
        try {
            const [rEj, rCol] = await Promise.all([
                window.supabase.from('ejemplares').select('id').limit(1),
                window.supabase.from('tablas_fijas').select('distancia_carrera').limit(1)
            ]);
            const msg = [rEj.error?.message, rCol.error?.message].filter(Boolean).join(' | ');
            if (msg && (/does not exist|does not have a column|42703|42P01|permission|row-level security/i.test(msg))) {
                clubUI.aviso('SQL pendiente de ejecutar',
                    `Faltan objetos en la base de datos (tabla ejemplares o columnas distancia_carrera / superficie).\n\nEjecute en Supabase → SQL Editor:\n\nsql/paquete_pendientes.sql\n\nDespués recargue esta página.\n\nErrores detectados: ${msg}`,
                    'error');
            }
        } catch (e) { /* ignorar errores de red */ }
    }
    verificarSqlPendiente();

    // Monitor de publicadas: plegable para que la pantalla no haga scroll
    const btnToggleMonitor = document.getElementById('btnToggleMonitor');
    const cuerpoMonitor = document.getElementById('cuerpoMonitor');
    if (btnToggleMonitor && cuerpoMonitor) {
        btnToggleMonitor.addEventListener('click', () => {
            cuerpoMonitor.classList.toggle('hidden');
            const icono = btnToggleMonitor.querySelector('i.fa-chevron-down, i.fa-chevron-up');
            if (icono) icono.className = cuerpoMonitor.classList.contains('hidden') ? 'fas fa-chevron-down' : 'fas fa-chevron-up';
        });
    }
});