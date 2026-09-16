document.addEventListener('DOMContentLoaded', () => {

    const btnAgregarCarrera = document.getElementById('btnAgregarCarrera');
    const contenedorCarreras = document.getElementById('carrerasEnsamblaje');
    const lblTotalCarreras = document.getElementById('lblTotalCarreras');
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
        const img = window.clubUI?.bandera ? window.clubUI.bandera(nac, 22) : '';
        if (img) {
            return `<span class="bandera-nac w-7 h-6 shrink-0 inline-flex justify-center items-center" title="${nac}" data-nac="${nac}">${img}</span>`;
        }
        return `<span class="bandera-nac w-7 h-6 shrink-0 inline-flex justify-center items-center text-[11px] font-black leading-none text-slate-500" title="${nac}" data-nac="${nac}">${nac}</span>`;
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
        let { data, error } = await window.supabase.from('grupos_venta').select('*').order('es_principal', { ascending: false });
        if (error) {
            if (error.status === 401 || /permission|row-level security/i.test(String(error.message || ''))) {
                clubUI.toast('Permisos bloqueados (RLS). Ejecute en SQL: alter table public.grupos_venta disable row level security;', 'error');
            }
            return;
        }
        if (!data || data.length === 0) {
            // Garantiza siempre el grupo PRINCIPAL (Administrador/Sistema) para publicar.
            // Primero intenta la RPC segura (security definer: funciona aunque el RLS
            // de grupos_venta esté activo); si la RPC no existe aún, cae al INSERT.
            await window.supabase.rpc('club_garantizar_grupo_principal').catch(() => {});
            const re = await window.supabase.from('grupos_venta').select('*').order('es_principal', { ascending: false }).catch(() => null);
            if (re) {
                data = re.data || [];
            } else {
                const { error: errSeed } = await window.supabase
                    .from('grupos_venta')
                    .insert([{ nombre: 'PRINCIPAL', moneda: 'USD', es_principal: true, cupo_tabla: 100, activo: true }]);
                const re2 = await window.supabase.from('grupos_venta').select('*').order('es_principal', { ascending: false }).catch(() => null);
                data = re2?.data || [];
                if (errSeed && (!re2?.data || !re2.data.length)) {
                    clubUI.toast('No hay grupos y no se pudo crear el principal: ' + (errSeed.message || errSeed.code), 'error');
                }
            }
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
                    <span class="ml-2 px-1.5 py-0.5 rounded text-[11px] font-black ${g.moneda === 'VES' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}">${g.moneda}</span>
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
        // REGLA ANTI-DUPLICADO: el nombre es la clave perceptible del padrón.
        // Aunque exista un ejemplar con el MISMO NOMBRE y OTRA nacionalidad
        // (p. ej. BROTHER WILL/VE y BROTHER WILL/USA), NO se crea un segundo:
        // se reutiliza el existente y se avisa al usuario.
        const porNombre = padronEjemplares.find(e => e.nombre.toUpperCase() === norm);
        if (porNombre) {
            if (porNombre.nacionalidad.toUpperCase() !== nac) {
                clubUI.toast(`El ejemplar "${norm}" ya está registrado como ${porNombre.nacionalidad.toUpperCase()}. No se crea otro.`, 'warning');
            }
            return porNombre.id;
        }
        const existe = padronEjemplares.find(e => e.nombre.toUpperCase() === norm && e.nacionalidad.toUpperCase() === nac);
        if (existe) return existe.id;
        // RPC segura (security definer): funciona aunque el RLS de ejemplares
        // esté activo; si la RPC no existe aún, cae al INSERT directo.
        const rpcId = await window.supabase
            .rpc('club_asegurar_ejemplar', { v_nombre: norm, v_nacionalidad: nac })
            .then(r => r.error ? null : r.data)
            .catch(() => null);
        if (rpcId) {
            padronEjemplares.push({ id: rpcId, nombre: norm, nacionalidad: nac });
            return rpcId;
        }
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
        const nac = (c?.nacionalidad || 'VE').trim().toUpperCase();
        return `
            <div class="fila-caballo-card bg-slate-50 border border-slate-200 rounded px-1 py-px ${vacio}" style="display:grid;grid-template-columns:2.25rem 1fr 2rem auto auto;column-gap:0.375rem;align-items:center">
                <input type="text" inputmode="numeric" title="Número del ejemplar" placeholder="Nº"
                    class="in-cab-num gac-num w-4 h-5 shrink-0 border rounded px-0 py-px text-center text-[10px] font-black outline-none focus:ring-1 focus:ring-indigo-400"
                    value="${c?.numero ?? ''}" style="background-color:${numColor};color:${textoDeNumero(c?.numero)};border-color:${numColor}">
                <input type="text" class="in-cab-nom w-full min-w-0 border border-slate-200 rounded px-1 py-px text-[10px] font-bold uppercase outline-none focus:ring-1 focus:ring-indigo-400" value="${c?.nombre ?? ''}" placeholder="Ejemplar" title="Nombre del ejemplar">
                <span style="display:flex;justify-content:center">${nac === 'VE' ? '' : htmlSelectNac(c?.nacionalidad)}</span>
                <input type="text" inputmode="decimal" class="in-cab-valor w-full shrink-0 border border-slate-200 rounded px-1 py-px text-right text-[11px] font-black text-blue-700 outline-none focus:ring-1 focus:ring-indigo-400" value="${c?.valor ?? c?.pts ?? ''}" placeholder="$" title="Valor / monta del ejemplar">
                <button type="button" tabindex="-1" class="btn-del-cab-card shrink-0 text-red-400 hover:text-red-600 px-1 leading-none" title="Quitar ejemplar"><i class="fas fa-trash-alt"></i></button>
            </div>`;
    }

    function crearCardCarrera(opts) {
        const uid = 'car-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const card = document.createElement('div');
        card.className = 'card-carrera bg-white rounded-xl shadow-sm border border-indigo-200 overflow-hidden flex flex-col';
        card.dataset.uid = uid;
        card.innerHTML = `
            <div class="bg-indigo-600 px-1.5 py-px" style="color:#fff">
                <div class="flex items-center justify-between gap-1 leading-none">
                    <input type="text" class="in-hipo-card rounded px-1.5 py-px text-[11px] font-bold uppercase outline-none flex-1 min-w-0" style="background:rgba(255,255,255,.18);color:#fff" value="${opts?.hipodromo ?? ''}" placeholder="Hipódromo">
                    <span class="font-black text-xs whitespace-nowrap leading-none"><i class="fas fa-flag-checkered mr-1"></i>C
                        <input type="number" class="in-carrera-card w-7 rounded px-1 py-px text-center font-black outline-none" style="background:rgba(255,255,255,.18);color:#fff" value="${opts?.carrera ?? ''}" placeholder="N°">
                    </span>
                </div>
                <div class="flex flex-wrap gap-1 mt-0.5 text-[9px] font-bold items-center leading-none">
                    <span class="rounded px-1 py-px" style="background:rgba(255,255,255,.18)">Dist: <input type="number" class="in-dist-card w-10 outline-none text-center font-black" style="background:transparent;color:#fff" value="${opts?.distancia ?? ''}" placeholder="m"></span>
                    <select class="in-sup-card rounded px-1 py-px outline-none uppercase text-[9px] font-bold" style="background:rgba(255,255,255,.18)">
                        ${SUPERFICIES.map(s => `<option value="${s}" ${(opts?.superficie || '').toUpperCase() === s ? 'selected' : ''}>${s}</option>`).join('')}
                    </select>
                </div>
                <div class="mt-0.5 flex items-center justify-between rounded px-1.5 py-px leading-none" style="background:rgba(255,255,255,.20)">
                    <span class="text-[8px] font-black uppercase tracking-wider opacity-90"><i class="fas fa-dollar-sign mr-1"></i> Monto a Pagar / Tabla</span>
                    <span class="flex items-center gap-0.5 font-black text-sm leading-none" style="color:#fff">$<input type="number" step="0.01" class="in-premio-card w-14 bg-transparent outline-none text-right font-black" style="color:#fff;border-bottom:1px solid rgba(255,255,255,.5)" value="${opts?.premio ?? premioTabla.value ?? 100}"></span>
                </div>
            </div>
            <div class="px-1.5 pt-1 pb-0.5 text-[9px] font-black uppercase tracking-wider text-slate-400 flex items-center justify-between leading-none">
                <span><i class="fas fa-horse-head text-amber-500 mr-1"></i> Ejemplares</span>
                <span class="cont-caballos-card bg-slate-100 text-slate-600 px-1.5 rounded-full font-black text-[9px]">0</span>
            </div>
            <div class="lista-caballos-card px-1.5 py-1 space-y-1 flex-1"></div>
            <div class="add-caballo-card border-t border-slate-200 px-2 py-1.5 space-y-1 bg-slate-50">
                <div class="flex gap-1 items-center">
                    <input type="text" inputmode="numeric" class="nuevo-num w-10 h-10 shrink-0 border border-slate-300 rounded-md px-0 py-px text-[21px] font-black text-center outline-none focus:ring-1 focus:ring-indigo-400" placeholder="Nº" style="background-color:#fff;color:#94a3b8;border-color:#cbd5e1">
                    <input type="text" class="nuevo-nom flex-1 min-w-0 border border-slate-300 rounded px-1.5 py-1 text-sm font-bold uppercase outline-none focus:ring-1 focus:ring-indigo-400" placeholder="Ejemplar nuevo">
                    <select class="nuevo-nac w-auto shrink-0 border border-slate-300 rounded px-1 py-1 text-xs font-bold uppercase outline-none bg-white">
                        ${OPCIONES_NACIONALIDAD.map(n => `<option value="${n}">${n}</option>`).join('')}
                    </select>
                    <input type="text" inputmode="decimal" class="nuevo-valor w-12 shrink-0 border border-slate-300 rounded px-1 py-1 text-right text-lg font-black text-blue-700 outline-none focus:ring-1 focus:ring-indigo-400" placeholder="$">
                    <button type="button" tabindex="-1" class="btn-add-caballo-card bg-indigo-600 hover:bg-indigo-700 text-white rounded-md px-2 py-1 text-xs" title="Añadir ejemplar"><i class="fas fa-plus"></i></button>
                </div>
            </div>
            <div class="px-1.5 py-0.5 border-t border-slate-200 bg-white flex items-center justify-between">
                <span class="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-slate-400 leading-none">
                    <i class="fas fa-calculator text-indigo-400"></i> Suma de la Tabla
                </span>
                <span class="suma-tabla-card font-black text-xs text-indigo-700" title="Sumatoria de los valores de todos los ejemplares">$ 0</span>
            </div>
            <div class="px-3 py-2 border-t border-slate-200 flex gap-2 bg-white">
                <button type="button" class="btn-publicar-card flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black py-2 rounded-lg shadow transition-colors uppercase tracking-wide">
                    <i class="fas fa-save mr-1"></i> Publicar
                </button>
                <button type="button" class="btn-quitar-card bg-red-50 hover:bg-red-100 text-red-600 px-3 py-2 rounded-lg text-xs font-bold transition-colors" title="Quitar esta carrera del ensamblaje">
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
        actualizarSumaValores(card);
    }

    function actualizarSumaValores(card) {
        const total = Array.from(card.querySelectorAll('.fila-caballo-card .in-cab-valor'))
            .reduce((acc, inp) => acc + (aNum(inp.value) || 0), 0);
        const el = card.querySelector('.suma-tabla-card');
        if (el) el.textContent = '$ ' + clubUI.formatoNumero(total, 2);
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

    // Navegación de teclado tipo planilla en el ensamblaje:
    // Tab / Enter / Flecha abajo → siguiente fila (misma columna);
    // Shift+Tab / Flecha arriba → fila anterior (misma columna);
    // al terminar la columna de una card salta a la misma columna de la card siguiente.
    contenedorCarreras.addEventListener('keydown', (e) => {
        const TIPOS = ['.in-cab-num', '.in-cab-nom', '.in-cab-valor'];
        const esNavegacion = e.key === 'Enter' || e.key === 'Tab' || e.key === 'ArrowUp' || e.key === 'ArrowDown';
        if (!esNavegacion) return;
        const actual = e.target;
        if (!(actual instanceof HTMLInputElement)) return;
        const cls = TIPOS.find(c => actual.matches(c));
        if (!cls) return;
        e.preventDefault();
        let dir;
        if (e.key === 'Enter' || e.key === 'Tab') dir = e.shiftKey ? -1 : 1;
        else dir = e.key === 'ArrowDown' ? 1 : -1;
        const cards = Array.from(contenedorCarreras.querySelectorAll('.card-carrera'));
        const cardActual = actual.closest('.card-carrera');
        const columnas = Array.from(cardActual.querySelectorAll(cls));
        const idx = columnas.indexOf(actual);
        if (idx === -1) return;
        const sigIdx = idx + dir;
        let destino = null;
        if (sigIdx >= 0 && sigIdx < columnas.length) {
            destino = columnas[sigIdx];
        } else {
            const ci = cards.indexOf(cardActual);
            const prox = cards[(ci + dir + cards.length) % cards.length];
            const colProx = prox.querySelectorAll(cls);
            if (colProx.length) destino = colProx[dir > 0 ? 0 : colProx.length - 1];
        }
        if (destino) { destino.focus(); destino.select?.(); }
    });

    contenedorCarreras.addEventListener('input', (e) => {
        const t = e.target;
        if (!t || !t.classList) return;
        if (t.classList.contains('in-cab-valor') || t.classList.contains('nuevo-valor')) {
            const card = t.closest('.card-carrera');
            if (card) actualizarSumaValores(card);
            return;
        }
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
    async function buscarTablaDelDia(hipodromo, carrera) {
        const hoy = new Date();
        const inicio = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).toISOString();
        const fin = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 1).toISOString();
        const { data } = await window.supabase
            .from('tablas_fijas')
            .select('id, estado')
            .eq('hipodromo', hipodromo)
            .eq('carrera', carrera)
            .gte('created_at', inicio)
            .lt('created_at', fin)
            .limit(1)
            .maybeSingle();
        return data || null;
    }

    // Upsert de cupos por grupo: actualiza sin perder lo ya vendido en cada grupo.
    async function guardarCuposGrupos(tablaId, cuposPorGrupo) {
        const { data: actuales } = await window.supabase
            .from('tabla_grupos')
            .select('id, grupo_id, cantidad_vendida')
            .eq('tabla_id', tablaId);
        const mapActual = new Map((actuales || []).map(tg => [tg.grupo_id, tg]));
        const incluidos = new Set(cuposPorGrupo.map(x => x.grupo_id));
        for (const x of cuposPorGrupo) {
            const actual = mapActual.get(x.grupo_id);
            if (actual) {
                await window.supabase.from('tabla_grupos')
                    .update({ cupos: x.cupos })
                    .eq('id', actual.id);
            } else {
                await window.supabase.from('tabla_grupos')
                    .insert([{ tabla_id: tablaId, grupo_id: x.grupo_id, cupos: x.cupos, cantidad_vendida: 0 }]);
            }
        }
        const sobrantes = (actuales || []).filter(tg => !incluidos.has(tg.grupo_id));
        if (sobrantes.length) {
            await window.supabase.from('tabla_grupos')
                .delete()
                .in('id', sobrantes.map(s => s.id));
        }
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

        let cuposPorGrupo = [...document.querySelectorAll('.in-cupo-grupo')]
            .map(inp => ({ grupo_id: inp.dataset.grupo, cupos: parseInt(inp.value) || 0 }))
            .filter(x => x.cupos > 0);
        if (cuposPorGrupo.length === 0 && gruposActivos.length === 0) {
            await cargarGrupos();
        }
        let grupoPrimario = gruposActivos.find(g => g.es_principal) || gruposActivos[0];
        if (!grupoPrimario) grupoPrimario = todosGrupos.find(g => g.es_principal) || todosGrupos[0];
        if (cuposPorGrupo.length === 0 && grupoPrimario) {
            // Publica por defecto en el grupo principal (Administrador del sistema)
            const cuposDefault = parseInt(grupoPrimario.cupo_tabla) || 100;
            cuposPorGrupo = [{ grupo_id: grupoPrimario.id, cupos: cuposDefault }];
        }
        if (cuposPorGrupo.length === 0) return fallo("Asigne cupos a al menos un grupo.");

        const comisionGrupo = parseFloat(grupoPrimario && grupoPrimario.comision_default) || 2.5;
        const limiteTotal = cuposPorGrupo.reduce((a, b) => a + b.cupos, 0);

        const btn = card.querySelector('.btn-publicar-card');
        const orig = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Guardando...';
        btn.disabled = true;

        for (const c of caballosArr) {
            c.ejemplar_id = await resolverEjemplar(c.nombre, c.nacionalidad);
        }

        const existente = await buscarTablaDelDia(hipodromo, carrera);

        const datosTabla = {
            hipodromo, carrera, grupo_venta: 'GRUPOS', moneda: 'USD', tasa_cambio: tasaCambioGlobal,
            suma_base_tabla: sumaBaseTabla, limite_ventas: limiteTotal,
            premio_original: premio, premio_recalculado: premio,
            comision_grupo: comisionGrupo, caballos: caballosArr,
            distancia_carrera: distancia, superficie
        };

        let tablaId;
        let esActualizacion = !!existente;

        if (existente) {
            const { error: errUpd } = await window.supabase
                .from('tablas_fijas')
                .update(datosTabla)
                .eq('id', existente.id);
            if (errUpd) {
                btn.innerHTML = orig;
                btn.disabled = false;
                console.error("Error BD:", errUpd.message || errUpd);
                return fallo(`Error al actualizar la carrera: ${errUpd.message || 'verifique la conexión'}`);
            }
            tablaId = existente.id;
        } else {
            const { data: nueva, error } = await insertarTablaFija({ ...datosTabla, cantidad_vendida: 0, estado: 'Abierta', retirados_oficiales: NO_RETIROS });
            btn.innerHTML = orig;
            btn.disabled = false;
            if (error) {
                console.error("Error BD:", error.message || error);
                return fallo(`Error al guardar la carrera: ${error.message || 'verifique la conexión'}`);
            }
            tablaId = nueva.id;
        }

        await guardarCuposGrupos(tablaId, cuposPorGrupo);

        carrerasBol = carrerasBol.filter(u => u !== card.dataset.uid);
        card.remove();
        eliminarDelRegistroGaceta(hipodromo, carrera);
        contarCarreras();
        cargarTablas(); cargarEjemplares();
        if (window.clubDB?.logAccion) window.clubDB.logAccion('TABLAS', `${esActualizacion ? 'actualizada' : 'publicada'}: ${hipodromo} C${carrera} ${distancia}m ${superficie} premio=$${premio} cupos=${limiteTotal} ejemplares=${caballosArr.length} (id=${tablaId})`);
        // Publicó una carrera del día: la deja disponible para los demás módulos
        window.clubPrograma?.agregarCarrera({
            hipodromo, carrera, distancia, superficie, premio,
            caballos: caballosArr.map(c => ({ numero: c.numero, nombre: c.nombre, nacionalidad: c.nacionalidad, valor: c.valor_ejemplar }))
        })?.catch?.(() => {});
        if (silencio) {
            return esActualizacion
                ? { ok: true, msg: `C${carrera} ${hipodromo}: valores actualizados.` }
                : { ok: true, msg: `C${carrera} ${hipodromo}: ${caballosArr.length} ej. (id=${tablaId})` };
        }
        if (esActualizacion) {
            clubUI.toast(`C${carrera} (${hipodromo}) YA existía: se actualizaron sus valores. Los nuevos montos aplican desde ahora; los tickets vendidos conservan su valor.`, 'info');
        } else {
            clubUI.toast(`Carrera C${carrera} (${hipodromo}) publicada con ${caballosArr.length} ejemplares (valor total calculado: privado).`, 'success');
        }
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
    const contenedorMon = document.getElementById('cuerpoMonitorGrid');

    async function cargarTablas() {
        try {
            const { data, error } = await window.supabase
                .from('tablas_fijas')
                .select('*, tabla_grupos(*, grupos_venta(nombre, moneda))')
                .order('id', { ascending: false });
            if (error) throw error;

            datosTablaCompleta = data || [];
            const lblMonitor = document.getElementById('lblTotalMonitor');
            if (lblMonitor) lblMonitor.textContent = String(datosTablaCompleta.length);
            const msgVacio = document.getElementById('msgMonitorVacio');
            if (msgVacio) msgVacio.classList.toggle('hidden', datosTablaCompleta.length > 0);
            if (datosTablaCompleta.length === 0) {
                contenedorMon.innerHTML = '';
                return;
            }

            contenedorMon.innerHTML = datosTablaCompleta.map(t => {
                const ejemplares = Array.isArray(t.caballos) ? t.caballos : [];
                const suma = ejemplares.reduce((acc, c) => acc + (c.retirado ? 0 : (parseFloat(c.valor_ejemplar ?? c.valor ?? c.pts) || 0)), 0);
                const simb = t.moneda === 'VES' ? 'Bs ' : '$';

                const filasSala = ejemplares.length
                    ? `<div class="space-y-px">${ejemplares.map((c, idx) => {
                        const bg = colorDeNumero(c.numero);
                        const fg = textoDeNumero(c.numero);
                        const retirado = !!c.retirado;
                        const valor = parseFloat(c.valor_ejemplar ?? c.valor ?? c.pts) || 0;
                        return `
                        <div class="bg-slate-50 border border-slate-200 rounded px-1 py-px cursor-pointer hover:border-indigo-300 hover:bg-indigo-50 transition-colors ${retirado ? 'opacity-40' : ''}" data-tabla-id="${t.id}" data-ejemplar-idx="${idx}" style="display:grid;grid-template-columns:2.25rem 1fr 2rem auto;column-gap:0.375rem;align-items:center">
                            <input type="text" inputmode="numeric" title="Número del ejemplar" placeholder="Nº"
                                class="gac-num w-4 h-5 shrink-0 border rounded px-0 py-px text-center text-[10px] font-black outline-none focus:ring-1 focus:ring-indigo-400"
                                value="${c.numero ?? ''}" style="background-color:${bg};color:${fg};border-color:${bg}">
                            <span class="min-w-0 truncate text-[10px] font-bold uppercase text-slate-800">${c.nombre || 'Sin nombre'}</span>
<span style="display:flex;justify-content:center">${((c.nacionalidad || 'VE').trim().toUpperCase() === 'VE') ? '' : htmlSelectNac(c.nacionalidad)}</span>
                            <span class="text-right text-[11px] font-black whitespace-nowrap ${c.retirado ? 'text-red-500 line-through' : 'text-blue-700'}">${c.retirado ? 'RET.' : clubUI.formatoNumero(valor, 0)}</span>
                        </div>`;
                    }).join('')}</div>`
                    : '<p class="text-sm text-slate-400 italic px-2 py-2">Sin ejemplares registrados.</p>';

                return `
                <div class="card-monitor bg-white rounded-xl shadow-sm border border-indigo-200 overflow-hidden flex flex-col" data-tabla="${t.id}">
                    <div class="bg-indigo-600 px-1.5 py-px" style="color:#fff">
                        <div class="flex items-center justify-between gap-1 leading-none">
                            <span class="rounded px-1.5 py-px text-[11px] font-bold uppercase tracking-wider truncate" style="background:rgba(255,255,255,.18);color:#fff">${t.hipodromo || ''}</span>
                            <span class="font-black text-xs whitespace-nowrap leading-none"><i class="fas fa-flag-checkered mr-1"></i>C${t.carrera ?? ''}</span>
                        </div>
                        <div class="flex flex-wrap gap-1 mt-0.5 text-[9px] font-bold items-center leading-none">
                            <span class="rounded px-1 py-px" style="background:rgba(255,255,255,.18)">Dist: ${t.distancia_carrera ?? ''} m</span>
                            <span class="rounded px-1 py-px uppercase" style="background:rgba(255,255,255,.18)">${t.superficie || 'ARENA'}</span>
                            <span class="rounded px-1 py-px tracking-tight" style="background:rgba(255,255,255,.18)">${t.fecha || ''}</span>
                        </div>
                        <div class="mt-0.5 flex items-center justify-between rounded px-1.5 py-px leading-none" style="background:rgba(255,255,255,.20)">
                            <span class="text-[8px] font-black uppercase tracking-wider opacity-90"><i class="fas fa-dollar-sign mr-1"></i> Monto a Pagar / Tabla</span>
                            <span class="font-black text-sm whitespace-nowrap" style="color:#fff">${simb}${clubUI.formatoNumero(parseFloat(t.premio_recalculado), 0)}</span>
                        </div>
                    </div>

                    <div class="px-1.5 pt-1 pb-0.5 text-[9px] font-black uppercase tracking-wider text-slate-400 flex items-center justify-between leading-none">
                        <span><i class="fas fa-horse-head text-amber-500 mr-1"></i> Ejemplares</span>
                        <span class="bg-slate-100 text-slate-600 px-1.5 rounded-full font-black text-[9px]">${ejemplares.length}</span>
                    </div>

                    <div class="px-1 py-0.5 border-y border-slate-100 bg-white flex-1 min-h-0 overflow-hidden">
                        ${filasSala}
                    </div>

                    <div class="px-1.5 py-0.5 border-t border-slate-100 bg-white flex items-center justify-between gap-2">
                        <span class="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-slate-400 leading-none">
                            <button type="button" class="btn-editar-mon inline-flex items-center justify-center w-5 h-5 bg-indigo-100 hover:bg-indigo-200 text-indigo-600 rounded-md text-[9px] transition-colors" data-id="${t.id}" title="Editar premio, valores y cupos"><i class="fas fa-edit"></i></button>
                            <i class="fas fa-calculator text-indigo-300"></i> Suma de la Tabla
                        </span>
                        <span class="text-[10px] font-semibold text-indigo-200" title="Sumatoria de la tabla">$ ${clubUI.formatoNumero(suma, 0)}</span>
                    </div>
                </div>`;
            }).join('');

            contenedorMon.querySelectorAll('.btn-editar-mon').forEach(b => b.addEventListener('click', () => abrirModalEditar(b.dataset.id)));
            contenedorMon.querySelectorAll('[data-ejemplar-idx]').forEach(f => {
                f.addEventListener('click', () => {
                    const tablaId = f.dataset.tablaId;
                    const idx = parseInt(f.dataset.ejemplarIdx, 10);
                    abrirModalEjemplar(tablaId, idx);
                });
            });
        } catch (e) {
            console.error(e);
            contenedorMon.innerHTML = '<p class="p-4 text-center text-red-500 text-sm">Error cargando tablas.</p>';
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
        const simb = tabla.moneda === 'VES' ? 'Bs ' : '$';
        document.getElementById('editTablaHipo').textContent = tabla.hipodromo || '-';
        document.getElementById('editTablaCarrera').textContent = tabla.carrera ?? '-';
        document.getElementById('editTablaDist').textContent = tabla.distancia_carrera ?? '-';
        document.getElementById('editTablaSup').textContent = (tabla.superficie || 'ARENA').toUpperCase();
        const montoEl = document.getElementById('editTablaMonto');
        montoEl.dataset.simb = simb;
        montoEl.textContent = `${simb}${clubUI.formatoNumero(parseFloat(tabla.premio_recalculado) || 0, 0)}`;
        document.getElementById('editId').value = id;
        document.getElementById('editPremio').value = (tabla.premio_recalculado ?? 100);
        document.getElementById('editPremioOrig').value = (tabla.premio_original ?? tabla.premio_recalculado ?? 100);
        document.getElementById('editSumaBase').value = (tabla.suma_base_tabla ?? 160);
        const contCab = document.getElementById('editCaballos');
        contCab.innerHTML = (tabla.caballos || []).map((c, i) => `
            <label class="flex items-center gap-1.5 bg-white border border-slate-200 rounded px-1.5 py-0.5 text-[10px]">
                <input type="text" inputmode="numeric" title="Número del ejemplar" placeholder="Nº"
                    class="gac-num w-4 h-5 shrink-0 border rounded px-0 py-px text-center text-[10px] font-black outline-none focus:ring-1 focus:ring-indigo-400"
                    value="${c.numero ?? ''}" style="background-color:${colorDeNumero(c.numero)};color:${textoDeNumero(c.numero)};border-color:${colorDeNumero(c.numero)}">
                <span class="flex-1 font-bold text-slate-700 truncate" title="${c.nombre}">${c.nombre} ${c.retirado ? '<span class="text-red-500 text-[8px] font-black">(RET.)</span>' : ''}</span>
                <input type="text" inputmode="decimal" class="edit-valor-cab w-16 text-right border border-slate-300 rounded px-1 py-0.5 text-[10px] font-bold outline-none focus:ring-2 focus:ring-indigo-500" data-index="${i}" value="${clubUI.formatoNumero(parseFloat(c.valor_ejemplar) || 0, 1)}" title="Valor del ejemplar (afecta solo próximas ventas)">
            </label>
        `).join('') || '<p class="text-slate-400 italic text-[10px]">Sin ejemplares.</p>';
        const ctn = document.getElementById('editCuposGrupos');
        const yaAsignados = (tabla.tabla_grupos || []).map(tg => tg.grupo_id);

        ctn.innerHTML = (tabla.tabla_grupos || []).map(tg => {
            const vendidas = tg.cantidad_vendida || 0;
            const botonEliminar = vendidas === 0
                ? `<button type="button" class="btn-quitar-grupo-edit text-red-500 hover:text-red-700 px-1" data-tablagrupo="${tg.id}" title="Quitar grupo de esta tabla"><i class="fas fa-times-circle"></i></button>`
                : `<span class="text-[9px] text-slate-400 font-bold" title="Tiene ${vendidas} venta(s), no se puede quitar">${vendidas} vend.</span>`;
            return `
            <div class="fila-cupo-editar flex items-center gap-2 bg-white border border-slate-200 rounded px-1.5 py-1" data-tablagrupo="${tg.id}" data-grupo="${tg.grupo_id}">
                <span class="flex-1 text-[11px] font-bold text-slate-700">${tg.grupos_venta ? tg.grupos_venta.nombre : '?'}</span>
                <span class="text-[9px] text-slate-500">${vendidas} vendidas</span>
                <input type="number" min="0" value="${tg.cupos}" data-id="${tg.id}" data-grupo="${tg.grupo_id}" class="edit-cupo w-16 border border-slate-300 rounded-md px-1 py-0.5 text-[11px] font-bold text-center outline-none focus:ring-2 focus:ring-indigo-500">
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

    document.getElementById('editPremio')?.addEventListener('input', () => {
        const montoEl = document.getElementById('editTablaMonto');
        if (!montoEl) return;
        const v = aNum(document.getElementById('editPremio').value);
        montoEl.textContent = `${montoEl.dataset.simb || '$'}${clubUI.formatoNumero(v || 0, 0)}`;
    });

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
            <div class="fila-cupo-editar flex items-center gap-2 bg-indigo-50 border border-indigo-200 rounded px-1.5 py-1" data-grupo="${gid}">
                <span class="flex-1 text-[11px] font-bold text-indigo-700">${g.nombre} <span class="text-[8px]">(nuevo)</span></span>
                <span class="text-[9px] text-slate-500">0 vendidas</span>
                <input type="number" min="0" value="${cupo}" data-grupo="${gid}" data-nuevo="1" class="edit-cupo w-16 border border-slate-300 rounded-md px-1 py-0.5 text-[11px] font-bold text-center outline-none focus:ring-2 focus:ring-indigo-500">
            </div>`);
        document.getElementById('nuevoGrupoEditar').value = '';
    });

    document.getElementById('btnProcesarEdicion').addEventListener('click', async () => {
        const id = document.getElementById('editId').value;
        const premio = aNum(document.getElementById('editPremio').value);
        if (premio === null || premio <= 0) return clubUI.toast("Premio inválido.");
        const premioOrig = aNum(document.getElementById('editPremioOrig').value) || premio;
        const sumaBase = aNum(document.getElementById('editSumaBase').value) || 0;
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
            limite_ventas: cuposSuma, caballos: caballosNuevos
        }).eq('id', id);

        if (!error) { document.getElementById('modalEditar').classList.add('hidden'); cargarTablas(); }
        else { clubUI.toast("Error al editar."); }
        if (window.clubDB?.logAccion) window.clubDB.logAccion('TABLAS', `editada: ${tEdit?.hipodromo} C${tEdit?.carrera} premio=$${premio} premOriginal=$${premioOrig} cupos=${cuposSuma} (id=${id})`);
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
    // MODAL DE EJEMPLAR: RETIRAR / REHABILITAR / VENTA RAPIDA AL CARRITO
    // ==========================================
    let modalEjemplarCtx = { t: null, idx: -1 };

    function asegurarModalEjemplar() {
        let m = document.getElementById('modalEjemplar');
        if (m) return m;
        m = document.createElement('div');
        m.id = 'modalEjemplar';
        m.className = 'hidden fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm overflow-y-auto p-4';
        m.innerHTML = `
            <div class="flex min-h-full items-center justify-center">
                <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md my-auto overflow-hidden flex flex-col max-h-[94vh]">
                    <div class="bg-indigo-600 p-4 text-white font-bold flex justify-between items-center text-sm uppercase shrink-0">
                        <span><i class="fas fa-horse-head mr-2"></i> Ejemplar</span>
                        <button class="cerrar-modal-ejemplar text-indigo-200 hover:text-white" aria-label="Cerrar"><i class="fas fa-times"></i></button>
                    </div>
                    <div id="cuerpoModalEjemplar" class="p-4 space-y-4 overflow-y-auto flex-1"></div>
                    <div class="p-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3 shrink-0">
                        <button type="button" class="cerrar-modal-ejemplar bg-slate-300 hover:bg-slate-400 text-slate-700 px-5 py-2.5 rounded-xl text-sm font-bold transition-colors">Cancelar</button>
                        <button type="button" id="btnEnviarCarritoEjemplar" class="hidden bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2.5 rounded-xl text-sm font-black shadow-md transition-colors">
                            <i class="fas fa-cart-plus mr-1"></i> Enviar al carrito
                        </button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(m);
        m.querySelectorAll('.cerrar-modal-ejemplar').forEach(b => b.addEventListener('click', cerrarModalEjemplar));
        document.getElementById('btnEnviarCarritoEjemplar').addEventListener('click', enviarCarritoEjemplar);
        return m;
    }

    function cerrarModalEjemplar() {
        const m = document.getElementById('modalEjemplar');
        if (m) m.classList.add('hidden');
        modalEjemplarCtx = { t: null, idx: -1 };
    }

    function abrirModalEjemplar(tablaId, idx) {
        const t = datosTablaCompleta.find(x => String(x.id) === String(tablaId));
        if (!t) return clubUI.toast('Tabla no encontrada.', 'error');
        const c = (Array.isArray(t.caballos) ? t.caballos : [])[idx];
        if (!c) return clubUI.toast('Ejemplar no encontrado.', 'error');
        modalEjemplarCtx = { t, idx, c };
        const m = asegurarModalEjemplar();
        const cuerpo = document.getElementById('cuerpoModalEjemplar');
        const bg = colorDeNumero(c.numero);
        const fg = textoDeNumero(c.numero);
        const retirado = !!c.retirado;
        const valor = parseFloat(c.valor_ejemplar ?? c.valor ?? c.pts) || 0;
        const simb = t.moneda === 'VES' ? 'Bs ' : '$';
        const hayGrupos = (t.tabla_grupos || []).length > 0;
        const puedoVender = t.estado === 'Abierta' && !retirado && hayGrupos;

        cuerpo.innerHTML = `
            <div class="flex items-center gap-3">
                <span class="w-12 h-12 rounded-xl flex items-center justify-center text-xl font-black border-2 shrink-0" style="background:${bg};color:${fg};border-color:${bg}">${c.numero ?? ''}</span>
                <div class="min-w-0 flex-1">
                    <span class="block text-base font-black uppercase text-slate-800 truncate">${c.nombre || 'Sin nombre'}</span>
                    <span class="block text-xs font-bold text-slate-500">${htmlSelectNac(c.nacionalidad)} N° ${c.numero ?? '-'}</span>
                </div>
                <span class="${retirado ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-700'} inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-black uppercase shrink-0">
                    <i class="fas ${retirado ? 'fa-user-slash' : 'fa-circle-check'}"></i> ${retirado ? 'Retirado' : 'Activo'}
                </span>
            </div>

            <div class="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                <span class="block text-[10px] font-black uppercase tracking-wider text-slate-400">Valor por Tabla</span>
                <span class="block text-lg font-black ${retirado ? 'text-red-500 line-through' : 'text-blue-700'}">${retirado ? 'RET.' : simb + clubUI.formatoNumero(valor, 0)}</span>
            </div>

            ${retirado ? `
            <button type="button" id="btnRehabilitarEjemplar" class="w-full bg-amber-500 hover:bg-amber-600 text-white text-xs font-black uppercase py-2.5 rounded-xl transition-colors shadow-sm">
                <i class="fas fa-rotate-left mr-1"></i> Rehabilitar ejemplar
            </button>` : `
            <button type="button" id="btnRetirarEjemplar" class="w-full bg-red-600 hover:bg-red-700 text-white text-xs font-black uppercase py-2.5 rounded-xl transition-colors shadow-sm">
                <i class="fas fa-user-slash mr-1"></i> Retirar ejemplar
            </button>`}

            <div class="border-t border-slate-100 pt-3">
                <span class="block text-xs font-black uppercase tracking-wider text-slate-500 mb-2"><i class="fas fa-cash-register text-emerald-500 mr-1"></i> Venta rápida (al carrito)</span>
                ${puedoVender ? `
                <div class="space-y-2">
                    <div>
                        <label for="selectClienteModalEj" class="block text-[10px] font-bold text-slate-500 mb-0.5 uppercase">Jugador / Cliente</label>
                        <select id="selectClienteModalEj" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm font-bold bg-white outline-none focus:ring-2 focus:ring-emerald-500"><option value="">Seleccione el jugador...</option></select>
                    </div>
                    <div>
                        <label for="selectGrupoModalEj" class="block text-[10px] font-bold text-slate-500 mb-0.5 uppercase">Grupo de venta</label>
                        <select id="selectGrupoModalEj" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm font-bold bg-white outline-none focus:ring-2 focus:ring-emerald-500"></select>
                    </div>
                    <div>
                        <label for="cantidadModalEj" class="block text-[10px] font-bold text-slate-500 mb-0.5 uppercase">Cantidad de Tablas</label>
                        <input type="number" id="cantidadModalEj" min="1" value="1" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm font-bold text-center outline-none focus:ring-2 focus:ring-emerald-500">
                    </div>
                </div>` : `<p class="text-xs text-slate-400 italic">${retirado ? 'Ejemplar retirado: no puede venderse.' : t.estado !== 'Abierta' ? 'Tabla no disponible para venta (estado ' + (t.estado || '?') + ').' : 'Sin grupos/cupos asignados para vender.'}</p>`}
            </div>
        `;

        const btnEnviar = document.getElementById('btnEnviarCarritoEjemplar');
        if (btnEnviar) btnEnviar.classList.toggle('hidden', !puedoVender);

        const rein = cuerpo.querySelector('#btnRehabilitarEjemplar');
        if (rein) rein.addEventListener('click', rehabilitarEjemplar);
        const ret = cuerpo.querySelector('#btnRetirarEjemplar');
        if (ret) ret.addEventListener('click', retirarEjemplar);

        if (puedoVender) {
            const selGrp = cuerpo.querySelector('#selectGrupoModalEj');
            selGrp.innerHTML = (t.tabla_grupos || []).map(tg => {
                const g = gruposActivos.find(x => x.id == tg.grupo_id);
                const disp = Math.max(0, (tg.cupos || 0) - (tg.cantidad_vendida || 0));
                return `<option value="${tg.id}" data-groupid="${tg.grupo_id}" data-disp="${disp}">${g ? g.nombre : 'Grupo #' + tg.grupo_id} (${disp} disp)</option>`;
            }).join('') || '<option value="" disabled>Sin grupos</option>';
            const selCli = cuerpo.querySelector('#selectClienteModalEj');
            if (clientesVentaCache.length === 0) {
                cargarClientesVenta().then(() => poblarClientesModalEj(selCli));
            } else {
                poblarClientesModalEj(selCli);
            }
        }
        m.classList.remove('hidden');
    }

    function poblarClientesModalEj(sel) {
        sel.innerHTML = '<option value="">Seleccione el jugador...</option>' + clientesVentaCache.map(c =>
            `<option value="${c.id}" data-saldo="${c.saldo_actual ?? 0}">${c.nombre}</option>`
        ).join('');
    }

    async function reembolsarTicketsRetirado(t, c) {
        try {
            const { data: tickets } = await window.supabase.from('tickets_apuestas')
                .select('id, cliente_juega_id, monto_jugado, moneda')
                .eq('hipodromo', t.hipodromo)
                .eq('carrera', t.carrera)
                .eq('ejemplar_numero', parseInt(c.numero, 10))
                .eq('estado', 'Pendiente');
            if (!tickets || tickets.length === 0) return 0;
            for (const tk of tickets) {
                const monto = parseFloat(tk.monto_jugado) || 0;
                await window.supabase.from('tickets_apuestas').update({
                    estado: 'Retirado',
                    premio_pagar: 0,
                    accion_aplicada: 'REEMBOLSO',
                    monto_resuelto: monto
                }).eq('id', tk.id);
                if (monto > 0 && tk.cliente_juega_id) {
                    const { data: cl } = await window.supabase.from('clientes').select('saldo_actual').eq('id', tk.cliente_juega_id).maybeSingle();
                    if (cl) {
                        await window.supabase.from('clientes').update({
                            saldo_actual: (parseFloat(cl.saldo_actual) || 0) + monto
                        }).eq('id', tk.cliente_juega_id);
                    }
                }
            }
            return tickets.length;
        } catch (e) {
            console.error('[tablas] reembolso error:', e);
            return 0;
        }
    }

    async function retirarEjemplar() {
        const ctx = modalEjemplarCtx;
        const t = ctx.t, idx = ctx.idx;
        const c = (Array.isArray(t.caballos) ? t.caballos : [])[idx];
        if (!c) return;
        if (!confirm(`Retirar el ejemplar N°${c.numero} ${c.nombre}?\n\nSe marcará como RETIRADO:\n - No podrá venderse\n - Se recalculará el premio (baja proporcional)\n - Se reembolsará el saldo de los tickets pendientes\n\n¿Continuar?`)) return;
        const btn = document.getElementById('btnRetirarEjemplar');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Retirando...'; }
        try {
            const caballosNuevos = (Array.isArray(t.caballos) ? t.caballos : []).map((x, i) => i === idx ? { ...x, retirado: true, ganador: false } : x);
            const base = parseFloat(t.suma_base_tabla) || 0;
            const sumaRetirados = caballosNuevos.filter(x => x.retirado).reduce((a, x) => a + (parseFloat(x.valor_ejemplar) || 0), 0);
            let nuevoPremio = parseFloat(t.premio_original ?? t.premio_recalculado ?? 0) || 0;
            if (base > 0) nuevoPremio = Math.max(0, nuevoPremio * (1 - (sumaRetirados / base)));
            const nums = caballosNuevos.filter(x => x.retirado).map(x => x.numero).join(',') || 'NO HUBO RETIROS';
            const { error } = await window.supabase.from('tablas_fijas').update({
                caballos: caballosNuevos,
                retirados_oficiales: nums,
                premio_recalculado: nuevoPremio
            }).eq('id', t.id);
            if (error) throw error;
            const reembolsados = await reembolsarTicketsRetirado(t, c);
            if (window.clubDB?.logAccion) window.clubDB.logAccion('TABLAS', `retirado_ejemplar: ${t.hipodromo} C${t.carrera} N°${c.numero} ${c.nombre} premio_nuevo=$${nuevoPremio} reembolsos=${reembolsados}`);
            clubUI.toast(`Ejemplar N°${c.numero} retirado. Premio recalculado a $${clubUI.formatoNumero(nuevoPremio, 2)}${reembolsados ? ` (${reembolsados} reembolso(s))` : ''}.`, 'success');
            cerrarModalEjemplar();
            cargarTablas();
        } catch (e) {
            console.error(e);
            clubUI.toast('Error retirando el ejemplar: ' + (e.message || e.code), 'error');
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-user-slash mr-1"></i> Retirar ejemplar'; }
        }
    }

    async function rehabilitarEjemplar() {
        const ctx = modalEjemplarCtx;
        const t = ctx.t, idx = ctx.idx;
        const c = (Array.isArray(t.caballos) ? t.caballos : [])[idx];
        if (!c) return;
        if (!confirm(`Rehabilitar el ejemplar N°${c.numero} ${c.nombre}?\n\nSe restaurará como activo y se recalculará el premio nuevamente.`)) return;
        const btn = document.getElementById('btnRehabilitarEjemplar');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Rehabilitando...'; }
        try {
            const caballosNuevos = (Array.isArray(t.caballos) ? t.caballos : []).map((x, i) => i === idx ? { ...x, retirado: false } : x);
            const base = parseFloat(t.suma_base_tabla) || 0;
            const sumaRetirados = caballosNuevos.filter(x => x.retirado).reduce((a, x) => a + (parseFloat(x.valor_ejemplar) || 0), 0);
            let nuevoPremio = parseFloat(t.premio_original ?? t.premio_recalculado ?? 0) || 0;
            if (base > 0) nuevoPremio = Math.max(0, nuevoPremio * (1 - (sumaRetirados / base)));
            const nums = caballosNuevos.filter(x => x.retirado).map(x => x.numero).join(',') || 'NO HUBO RETIROS';
            const { error } = await window.supabase.from('tablas_fijas').update({
                caballos: caballosNuevos,
                retirados_oficiales: nums,
                premio_recalculado: nuevoPremio
            }).eq('id', t.id);
            if (error) throw error;
            if (window.clubDB?.logAccion) window.clubDB.logAccion('TABLAS', `rehabilitado_ejemplar: ${t.hipodromo} C${t.carrera} N°${c.numero} ${c.nombre} premio_nuevo=$${nuevoPremio}`);
            clubUI.toast(`Ejemplar N°${c.numero} rehabilitado. Premio recalculado a $${clubUI.formatoNumero(nuevoPremio, 2)}.`, 'success');
            cerrarModalEjemplar();
            cargarTablas();
        } catch (e) {
            console.error(e);
            clubUI.toast('Error rehabilitando el ejemplar: ' + (e.message || e.code), 'error');
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-rotate-left mr-1"></i> Rehabilitar ejemplar'; }
        }
    }

    async function enviarCarritoEjemplar() {
        const ctx = modalEjemplarCtx;
        const t = ctx.t, c = ctx.c;
        const idCli = document.getElementById('selectClienteModalEj')?.value;
        if (!idCli) return clubUI.toast('Seleccione el jugador que compra.', 'warning');
        const selGrp = document.getElementById('selectGrupoModalEj');
        const tgId = selGrp ? selGrp.value : '';
        const tg = (t.tabla_grupos || []).find(x => String(x.id) === String(tgId));
        if (!tg) return clubUI.toast('Seleccione el grupo de venta.', 'warning');
        const cant = parseInt(document.getElementById('cantidadModalEj').value) || 1;
        if (cant <= 0) return clubUI.toast('Cantidad inválida.', 'warning');
        const disp = Math.max(0, (tg.cupos || 0) - (tg.cantidad_vendida || 0));
        if (cant > disp) return clubUI.toast(`No quedan tablas disponibles (quedan ${disp}).`, 'warning');
        const cli = clientesVentaCache.find(x => String(x.id) === String(idCli));
        if (!cli) return clubUI.toast('Cliente no encontrado.', 'error');
        const grupo = gruposActivos.find(x => x.id == tg.grupo_id);
        if (!grupo) return clubUI.toast('Grupo de venta no encontrado.', 'error');
        const btn = document.getElementById('btnEnviarCarritoEjemplar');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Enviando...'; }
        try {
            const res = await VentaTablasCore.venderTabla({ cliente: cli, cantidad: cant, ejemplar: c, tabla: t, tg, grupo, tasaCambio: tasaCambioGlobal });
            if (!res.ok) { clubUI.toast('No se pudo enviar: ' + res.error, 'error'); if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-cart-plus mr-1"></i> Enviar al carrito'; } return; }
            const monedaSim = t.moneda === 'VES' ? 'Bs ' : '$';
            clubUI.toast(`Venta enviada al carrito: ${cli.nombre} - N°${c.numero} ${c.nombre} x${cant} (${monedaSim}${clubUI.formatoNumero(res.costoTotal, 2)})`, 'success');
            if (window.clubDB?.logAccion) window.clubDB.logAccion('VENTA_TABLAS', `venta_rapida_ejemplar: ${cli.nombre} N°${c.numero} ${c.nombre} x${cant} (${monedaSim}${clubUI.formatoNumero(res.costoTotal, 2)})`);
            cerrarModalEjemplar();
            cargarTablas();
        } catch (e) {
            console.error(e);
            clubUI.toast('Error al enviar al carrito.', 'error');
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-cart-plus mr-1"></i> Enviar al carrito'; }
        }
    }

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
        } catch (e) {
            console.error('[tablas] cargarClientesVenta error:', e);
            if (sel) sel.innerHTML = '<option value="" disabled>Error cargando jugadores. Ver consola (F12).</option>';
        }
    }

    function poblarClientesVenta() {
        const sel = document.getElementById('selectClienteVenta');
        if (!sel) return;
        sel.innerHTML = '<option value="">Seleccione el jugador...</option>' + clientesVentaCache.map(c => {
            const etiqueta = (c.grupos || []).map(gid => {
                const g = gruposActivos.find(x => x.id == gid);
                return g ? g.nombre : '';
            }).filter(Boolean).join(', ');
            return `<option value="${c.id}" data-saldo="${c.saldo_actual ?? 0}">${c.nombre}${etiqueta ? ` — [${etiqueta}]` : ''}</option>`;
        }).join('');
        renderVenta();
    }

    // Estados de la venta desde el monitor
    let ventaTablaCtx = null;       // tabla seleccionada
    let ventaCarrito = [];          // [{ ejemplar, cantidad, tg }]

    function ventaTg() {
        const sel = document.getElementById('selectGrupoVenta');
        const gid = sel ? sel.value : '';
        return (ventaTablaCtx?.tabla_grupos || []).find(tg => String(tg.id) === String(gid)) || null;
    }

    function ventaDisp(tg) {
        return tg ? Math.max(0, (tg.cupos || 0) - (tg.cantidad_vendida || 0)) : 0;
    }

    function ventaSimb() {
        return ventaTablaCtx?.moneda === 'VES' ? 'Bs ' : '$';
    }

    // Vista "solo lectura" de la tabla seleccionada (visual similar al monitor)
    function vistaTablaVenderHTML() {
        const t = ventaTablaCtx;
        if (!t) return '';
        const ejemplares = Array.isArray(t.caballos) ? t.caballos : [];
        const simb = ventaSimb();
        return `
            <div class="bg-indigo-600" style="color:#fff">
                <div class="px-3 py-2 flex items-center justify-between gap-2">
                    <span class="rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wider truncate" style="background:rgba(255,255,255,.18);color:#fff">${t.hipodromo || ''}</span>
                    <span class="font-black text-sm whitespace-nowrap"><i class="fas fa-flag-checkered mr-1"></i>C${t.carrera ?? ''}</span>
                </div>
                <div class="px-1.5 flex flex-wrap gap-1 pb-1 text-[11px] font-bold items-center">
                    <span class="rounded px-1.5 py-0.5" style="background:rgba(255,255,255,.18)">Dist: ${t.distancia_carrera ?? ''} m</span>
                    <span class="rounded px-1.5 py-0.5 uppercase" style="background:rgba(255,255,255,.18)">${t.superficie || 'ARENA'}</span>
                    <span class="rounded px-1.5 py-0.5" style="background:rgba(255,255,255,.18)">${t.fecha || ''}</span>
                </div>
                <div class="mx-2 mb-2 flex items-center justify-between rounded-lg px-3 py-2" style="background:rgba(255,255,255,.20)">
                    <span class="text-xs font-black uppercase tracking-wider opacity-90"><i class="fas fa-dollar-sign mr-1"></i> Monto a Pagar / Tabla</span>
                    <span class="font-black text-xl" style="color:#fff">${simb}${clubUI.formatoNumero(parseFloat(t.premio_recalculado), 0)}</span>
                </div>
            </div>
            <div class="px-2.5 py-1.5 text-[11px] font-black uppercase tracking-wider text-slate-400 flex items-center justify-between border-b border-slate-100">
                <span><i class="fas fa-horse-head text-amber-500 mr-1"></i> Ejemplares</span>
                <span class="bg-slate-100 text-slate-600 px-2 rounded-full font-black">${ejemplares.length}</span>
            </div>
            <div id="vistaResumenCaballos" class="px-1.5 py-1 space-y-0.5"></div>`;
    }

    function renderCaballosVista() {
        const el = document.getElementById('vistaResumenCaballos');
        if (!el) return;
        const t = ventaTablaCtx;
        const ejemplares = Array.isArray(t?.caballos) ? t.caballos : [];
        el.innerHTML = ejemplares.map(c => {
            const bg = colorDeNumero(c.numero);
            const fg = textoDeNumero(c.numero);
            const retirado = !!c.retirado;
            const valor = parseFloat(c.valor_ejemplar ?? c.valor ?? c.pts) || 0;
            return `
            <div class="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 ${retirado ? 'opacity-40' : ''}" style="display:grid;grid-template-columns:2.5rem 1fr 2.5rem auto;column-gap:0.625rem;align-items:center">
                <span class="justify-self-center w-9 h-9 rounded-lg flex items-center justify-center text-base font-black border" style="background-color:${bg};color:${fg};border-color:${bg}">${c.numero ?? ''}</span>
                <span class="min-w-0 truncate text-sm font-bold uppercase text-slate-800">${c.nombre || 'Sin nombre'}</span>
                <span style="display:flex;justify-content:center">${htmlSelectNac(c.nacionalidad)}</span>
                <span class="text-right text-lg font-black whitespace-nowrap ${retirado ? 'text-red-500 line-through' : 'text-blue-700'}">${retirado ? 'RET.' : clubUI.formatoNumero(valor, 0)}</span>
            </div>`;
        }).join('');
    }

    // Lista de ejemplares con botón "Enviar al carrito"
    function renderCaballosVenta() {
        const el = document.getElementById('listaVentaCaballos');
        if (!el) return;
        const t = ventaTablaCtx;
        const ejemplares = Array.isArray(t?.caballos) ? t.caballos : [];
        if (!ejemplares.length) {
            el.innerHTML = '<p class="text-sm text-slate-400 italic px-1 py-2">Sin ejemplares registrados.</p>';
            return;
        }
        el.innerHTML = ejemplares.map(c => {
            const bg = colorDeNumero(c.numero);
            const fg = textoDeNumero(c.numero);
            const retirado = !!c.retirado;
            const valor = parseFloat(c.valor_ejemplar ?? c.valor ?? c.pts) || 0;
            const enCarrito = ventaCarrito.find(i => String(i.ejemplar.numero) === String(c.numero));
            const cant = enCarrito ? enCarrito.cantidad : 0;
            const yaCant = enCarrito ? `<div class="flex items-center gap-1">
                <button class="btn-carrito-menos bg-slate-200 hover:bg-slate-300 w-7 h-7 rounded font-black" data-num="${c.numero}">−</button>
                <span class="w-6 text-center font-black text-emerald-700">${cant}</span>
                <button class="btn-carrito-mas bg-emerald-100 hover:bg-emerald-200 text-emerald-700 w-7 h-7 rounded font-black" data-num="${c.numero}">+</button>
            </div>` : '';
            return `
            <div class="bg-white border rounded-lg px-2 py-1.5 ${retirado ? 'opacity-40' : ''}" style="display:grid;grid-template-columns:2.5rem 1fr 2.5rem auto auto;column-gap:0.625rem;align-items:center">
                <span class="justify-self-center w-9 h-9 rounded-lg flex items-center justify-center text-base font-black border" style="background-color:${bg};color:${fg};border-color:${bg}">${c.numero ?? ''}</span>
                <span class="min-w-0 truncate text-sm font-bold uppercase text-slate-800">${c.nombre || 'Sin nombre'}</span>
                <span style="display:flex;justify-content:center">${htmlSelectNac(c.nacionalidad)}</span>
                <span class="text-right text-lg font-black whitespace-nowrap ${retirado ? 'text-red-500 line-through' : 'text-blue-700'}">${retirado ? 'RET.' : clubUI.formatoNumero(valor, 0)}</span>
                ${retirado ? '<span class="text-[10px] font-black uppercase text-red-400 bg-red-50 rounded px-1.5 py-1">No vendible</span>'
                    : (yaCant || `<button class="btn-venta-agregar bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase px-3 py-1.5 rounded-lg transition-colors shrink-0" data-num="${c.numero}">
                    <i class="fas fa-cart-plus mr-1"></i> Enviar al carrito
                </button>`)}
            </div>`;
        }).join('');
    }

    function renderVenta() {
        renderCaballosVista();
        renderCaballosVenta();
        renderCarrito();
        pushEventosVenta();
    }

    // Vuelve a asociar eventos luego de cada render
    function pushEventosVenta() {
        document.querySelectorAll('.btn-venta-agregar').forEach(b => b.addEventListener('click', () => {
            const t = ventaTablaCtx;
            const num = b.dataset.num;
            const ej = (t?.caballos || []).find(c => String(c.numero) === String(num));
            const tg = ventaTg();
            if (!ej || !tg) return clubUI.toast('Seleccione el grupo de venta primero.', 'warning');
            if (!t || t.estado !== 'Abierta') return clubUI.toast('La tabla no está en estado Abierta.', 'warning');
            if (ej.retirado) return clubUI.toast('El ejemplar está retirado y no puede venderse.', 'warning');
            const cant = 1;
            if (cant > ventaDisp(tg)) return clubUI.toast(`No quedan tablas disponibles en el grupo (quedan ${ventaDisp(tg)}).`, 'warning');
            const exist = ventaCarrito.find(i => String(i.ejemplar.numero) === String(num));
            if (exist) exist.cantidad += 1;
            else ventaCarrito.push({ ejemplar: ej, cantidad: cant, tg });
            renderVenta();
        }));
        document.querySelectorAll('.btn-carrito-mas').forEach(b => b.addEventListener('click', () => {
            const num = b.dataset.num;
            const item = ventaCarrito.find(i => String(i.ejemplar.numero) === String(num));
            if (!item) return;
            if (item.cantidad + 1 > ventaDisp(item.tg)) return clubUI.toast(`No quedan tablas disponibles (quedan ${ventaDisp(item.tg)}).`, 'warning');
            item.cantidad += 1;
            renderVenta();
        }));
        document.querySelectorAll('.btn-carrito-menos').forEach(b => b.addEventListener('click', () => {
            const num = b.dataset.num;
            const i = ventaCarrito.findIndex(x => String(x.ejemplar.numero) === String(num));
            if (i === -1) return;
            ventaCarrito[i].cantidad -= 1;
            if (ventaCarrito[i].cantidad <= 0) ventaCarrito.splice(i, 1);
            renderVenta();
        }));
        document.querySelectorAll('.btn-carrito-quitar').forEach(b => b.addEventListener('click', () => {
            ventaCarrito = ventaCarrito.filter((_, i) => i != b.dataset.i);
            renderVenta();
        }));
    }

    function renderCarrito() {
        const box = document.getElementById('ventaCarritoBox');
        const items = document.getElementById('ventaCarritoItems');
        if (!box || !items) return;
        box.classList.toggle('hidden', ventaCarrito.length === 0);
        items.innerHTML = ventaCarrito.map((it, i) => {
            const c = it.ejemplar;
            const bg = colorDeNumero(c.numero);
            const fg = textoDeNumero(c.numero);
            const valor = parseFloat(c.valor_ejemplar ?? c.valor ?? c.pts) || 0;
            const subtotal = valor * it.cantidad;
            return `
            <div class="bg-white border border-slate-200 rounded-lg px-2 py-1.5" style="display:grid;grid-template-columns:2.5rem 1fr auto auto auto;column-gap:0.5rem;align-items:center">
                <span class="justify-self-center w-9 h-9 rounded-lg flex items-center justify-center text-base font-black border" style="background-color:${bg};color:${fg};border-color:${bg}">${c.numero ?? ''}</span>
                <span class="min-w-0 truncate text-xs font-bold uppercase text-slate-700">${c.nombre || 'Sin nombre'}</span>
                <span class="text-xs font-black text-slate-500">x${it.cantidad}</span>
                <span class="text-base font-black text-blue-700">${ventaSimb()}${clubUI.formatoNumero(valor, 0)}</span>
                <button class="btn-carrito-quitar text-red-400 hover:text-red-600 text-xs px-1" data-i="${i}" title="Quitar"><i class="fas fa-times"></i></button>
            </div>`;
        }).join('');
        const totTablas = ventaCarrito.reduce((a, it) => a + it.cantidad, 0);
        const totCosto = ventaCarrito.reduce((a, it) => a + (parseFloat(it.ejemplar.valor_ejemplar ?? it.ejemplar.valor ?? it.ejemplar.pts) || 0) * it.cantidad, 0);
        document.getElementById('ventaCarritoTablas').textContent = totTablas;
        document.getElementById('ventaCarritoTotal').textContent = `${ventaSimb()}${clubUI.formatoNumero(totCosto, 0)}`;
        const btnCerrar = document.getElementById('btnProcesarVentaModal');
        if (btnCerrar) btnCerrar.disabled = ventaCarrito.length === 0;
    }

    function cerrarModalVentaMon() {
        document.getElementById('modalVenta').classList.add('hidden');
        ventaModalAbierta = false;
        ventaTablaCtx = null;
        ventaCarrito = [];
    }

    async function abrirModalVenta(id) {
        ventaModalAbierta = true;
        const t = datosTablaCompleta.find(x => x.id == id);
        if (!t) return clubUI.toast('Tabla no encontrada. Recargue el monitor.', 'error');

        if (gruposActivos.length === 0) await cargarGrupos();

        if (!t.tabla_grupos || t.tabla_grupos.length === 0) {
            const { data: tgRows } = await window.supabase.from('tabla_grupos').select('*').eq('tabla_id', t.id);
            if (tgRows && tgRows.length) t.tabla_grupos = tgRows;
        }

        ventaTablaCtx = t;
        ventaCarrito = [];

        document.getElementById('vistaTablaVender').innerHTML = vistaTablaVenderHTML();
        document.getElementById('listaVentaCaballos').innerHTML = '';
        document.getElementById('ventaCarritoItems').innerHTML = '';
        document.getElementById('ventaCarritoTablas').textContent = '0';
        document.getElementById('ventaCarritoTotal').textContent = '$ 0.00';
        document.getElementById('btnProcesarVentaModal').disabled = true;

        const selGrupo = document.getElementById('selectGrupoVenta');
        const tgOpts = (t.tabla_grupos || []).map(tg => {
            const g = gruposActivos.find(x => x.id == tg.grupo_id);
            const disp = ventaDisp(tg);
            return `<option value="${tg.id}" data-groupid="${tg.grupo_id}">${g ? g.nombre : 'Grupo #' + tg.grupo_id} (${disp} disp)</option>`;
        }).join('');
        selGrupo.innerHTML = tgOpts || '<option value="" disabled>Sin cupos asignados a grupos</option>';

        document.getElementById('selectClienteVenta').innerHTML = '<option value="">Seleccione el jugador...</option>';
        document.getElementById('modalVenta').classList.remove('hidden');
        await cargarClientesVenta();
        renderVenta();
    }

    // Botón "Cerrar venta": procesa todos los items del carrito, muestra recibo y opción WhatsApp
    async function cerrarVenta() {
        const items = ventaCarrito;
        if (!items.length) return clubUI.toast('El carrito está vacío.', 'warning');
        const idCli = document.getElementById('selectClienteVenta').value;
        if (!idCli) return clubUI.toast('Seleccione el jugador que compra.', 'warning');
        const t = ventaTablaCtx;
        if (!t) return clubUI.toast('Tabla no encontrada. Recargue el monitor.', 'error');

        const cli = clientesVentaCache.find(c => String(c.id) === String(idCli));
        if (!cli) return clubUI.toast('Cliente no encontrado.', 'error');

        // Pre-validación de disponibilidad
        for (const it of items) {
            if (it.cantidad > ventaDisp(it.tg)) return clubUI.toast(`No hay suficientes tablas de ${it.ejemplar.nombre}. Solo quedan ${ventaDisp(it.tg)}.`, 'warning');
        }

        const gruposItems = [...new Set(items.map(it => it.tg.grupo_id))];
        for (const gid of gruposItems) {
            const gi = gruposActivos.find(x => x.id == gid);
            if (!gi) continue;
            const esMiembro = cli.grupo_id == gi.id || !cli.grupo_id || ((clientesVentaCache.find(c => c.id == cli.id)?.grupos || []).includes(gi.id));
            if (!esMiembro) return clubUI.toast(`El jugador no pertenece al grupo ${gi.nombre} (inventario del carrito).`, 'warning');
        }

        const btnC = document.getElementById('btnProcesarVentaModal');
        btnC.disabled = true;
        const orig = btnC.innerHTML;
        btnC.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Procesando...';

        const resultados = [];
        let fallo = null;
        for (const it of items) {
            const grupo = gruposActivos.find(x => x.id == it.tg.grupo_id);
            if (!grupo) { fallo = 'Grupo de venta no encontrado.'; break; }
            const res = await VentaTablasCore.venderTabla({
                cliente: cli, cantidad: it.cantidad, ejemplar: it.ejemplar, tabla: t, tg: it.tg,
                grupo, tasaCambio: tasaCambioGlobal
            });
            if (!res.ok) { fallo = res.error; break; }
            resultados.push({ it, res, grupo });
        }

        if (fallo) {
            clubUI.toast('Venta interrumpida: ' + fallo, 'error');
            if (window.clubDB?.logAccion) window.clubDB.logAccion('VENTA_TABLAS', `venta_monitor_fallida: ${cli.nombre} error=${fallo}`);
        } else {
            const totalCosto = resultados.reduce((a, r) => a + r.res.costoTotal, 0);
            const totalPremio = resultados.reduce((a, r) => a + r.res.premioTotal, 0);
            const monedaSim = t.moneda === 'VES' ? 'Bs ' : '$';
            clubUI.toast(`¡Venta cerrada! ${resultados.length} ejemplar(es) · ${monedaSim}${clubUI.formatoNumero(totalCosto, 2)}`, 'success');
            if (window.clubDB?.logAccion) window.clubDB.logAccion('VENTA_TABLAS', `venta_monitor: ${cli.nombre} ${resultados.length} items (${monedaSim}${clubUI.formatoNumero(totalCosto, 2)})`);

            mostrarRecibo({ cliente: cli, resultados, totalCosto, totalPremio, monedaSim });
            cerrarModalVentaMon();
            cargarTablas();
        }

        btnC.disabled = false;
        btnC.innerHTML = orig;
    }

    function mostrarRecibo({ cliente, resultados, totalCosto, totalPremio, monedaSim }) {
        const fecha = new Date().toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' });
        const folio = `T-MONITOR-${Date.now().toString().slice(-8)}`;
        const filas = resultados.map(r => `
            <span class="block">N° ${r.it.ejemplar.numero || '-'} — ${r.it.ejemplar.nombre} · ${r.it.cantidad} tabla(s) a ${monedaSim}${clubUI.formatoNumero(r.res.pts, 1)}</span>`).join('');

        const resumen = document.getElementById('resumenReciboVenta');
        resumen.innerHTML = `
            <span class="font-black text-slate-800">${cliente.nombre}</span>
            <span class="block text-slate-500">Folio: ${folio} · ${fecha}</span>
            <span class="block text-slate-500">${resultados[0]?.grupo?.nombre || 'Grupo'}</span>
            <span class="block text-slate-500">${ventaTablaCtx?.hipodromo || ''} · C${ventaTablaCtx?.carrera ?? ''} · Dist. ${ventaTablaCtx?.distancia_carrera ?? ''} m</span>
            ${filas}
            <span class="block pt-1 border-t border-slate-200 mt-1 font-black text-emerald-700">Total Pagado: ${monedaSim}${clubUI.formatoNumero(totalCosto, 0)}</span>
            <span class="block font-black text-blue-700">Premio a cobrar (si gana): ${monedaSim}${clubUI.formatoNumero(totalPremio, 0)}</span>`;

        const texto = `🎫 *RECIBO DE VENTA — TABLA FIJA*\n` +
            `🧑 *Jugador:* ${cliente.nombre}\n` +
            `🏇 *Carrera:* ${ventaTablaCtx?.hipodromo || ''} · C${ventaTablaCtx?.carrera ?? ''} (Dist. ${ventaTablaCtx?.distancia_carrera ?? ''} m)\n` +
            `👥 *Grupo:* ${resultados[0]?.grupo?.nombre || ''}\n\n` +
            `📋 *Ejemplares:*\n` +
            resultados.map(r => `  N° ${r.it.ejemplar.numero || '-'} ${r.it.ejemplar.nombre} — ${r.it.cantidad} tabla(s) a ${monedaSim}${clubUI.formatoNumero(r.res.pts, 1)}\n`).join('') +
            `\n✅ *Total Pagado:* ${monedaSim}${clubUI.formatoNumero(totalCosto, 2)}\n` +
            `🏆 *Premio si gana:* ${monedaSim}${clubUI.formatoNumero(totalPremio, 2)}\n\n` +
            `📅 ${fecha}\nFolio: ${folio}`;

        document.getElementById('textoReciboVenta').value = texto;
        document.getElementById('modalReciboVenta').classList.remove('hidden');
    }

    // Recibo: WhatsApp y copiar
    document.getElementById('btnAbrirWhatsappRecibo').addEventListener('click', () => {
        const txt = document.getElementById('textoReciboVenta').value.trim();
        if (!txt) return clubUI.toast('Primero genera el recibo.', 'warning');
        window.open('https://wa.me/?text=' + encodeURIComponent(txt), '_blank');
    });
    document.getElementById('btnCopiarWhatsappRecibo').addEventListener('click', () => {
        const tx = document.getElementById('textoReciboVenta');
        tx.select();
        document.execCommand('copy');
        clubUI.toast('¡Recibo copiado al portapapeles!');
    });

    document.getElementById('btnVaciarCarritoVenta').addEventListener('click', () => {
        ventaCarrito = [];
        renderVenta();
    });

    document.getElementById('btnProcesarVentaModal').addEventListener('click', cerrarVenta);
    document.getElementById('selectClienteVenta').addEventListener('change', () => {
        const gidsCli = gruposDeCliente(document.getElementById('selectClienteVenta').value);
        if (gidsCli.length === 1) {
            const opt = [...document.getElementById('selectGrupoVenta').options].find(o => o.dataset.groupid == gidsCli[0]);
            if (opt) document.getElementById('selectGrupoVenta').value = opt.value;
        }
        renderVenta();
    });
    document.getElementById('selectGrupoVenta').addEventListener('change', renderVenta);

    document.querySelectorAll('.cerrar-modal').forEach(b => b.addEventListener('click', () => {
        document.getElementById('modalDuplicar').classList.add('hidden');
        document.getElementById('modalEditar').classList.add('hidden');
        document.getElementById('modalVenta').classList.add('hidden');
        document.getElementById('modalReciboVenta').classList.add('hidden');
        ventaModalAbierta = false;
        ventaTablaCtx = null;
        ventaCarrito = [];
    }));
    document.querySelectorAll('.cerrar-modal-reciibo').forEach(b => b.addEventListener('click', () => {
        document.getElementById('modalReciboVenta').classList.add('hidden');
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
                    premio: premioTabla.value || 100,
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

    function pegarPendientesGaceta({ silencio = false, forzar = false, soloPendientes = false } = {}) {
        // Las carreras del día se montan en CADA entrada a la página (primera vez,
        // segunda vez o pestaña nueva). Dentro de la misma visita, si ya se montaron
        // cards, no se vuelven a crear (evita duplicar con el botón manual).
        if (!forzar && carrerasBol.length > 0) {
            if (!silencio) clubUI.toast('Las carreras del día ya están montadas en esta pestaña.', 'warning');
            return 0;
        }
        // 1) Buzón legacy + registro del día.
        // ARRANQUE (soloPendientes=false): sólo se montan las carreras ENVIADAS
        // explícitamente por la Gaceta (enviada=true). Las pendientes NO se envían
        // solas: que queden en la gaceta no las lleva al Ensamblaje.
        // Botón manual "Pegar desde Gaceta" (soloPendientes=true): trae SOLO las
        // que faltan por enviar.
        let pendientes = soloPendientes ? [] : migrarLegacy();
        const registro = leerGacetaRegistro();
        for (const c of registro) {
            if (soloPendientes ? !c.enviada : !!c.enviada) pendientes.push(c);
        }

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
            if (!silencio) clubUI.toast(soloPendientes ? 'No hay carreras pendientes por enviar al Ensamblaje.' : 'No hay carreras enviadas desde la Gaceta para mostrar.', 'warning');
            return 0;
        }
        const montadas = construirCardsGaceta(unicos);
        // 3) Actualizar el registro guardado.
        const finales = [...registro];
        for (const p of unicos) {
            if (!finales.some(item =>
                String(item.hipodromo || '').trim().toUpperCase() === String(p.hipodromo || '').trim().toUpperCase()
                && String(item.carrera ?? '') === String(p.carrera ?? '')
            )) {
                // Legacy del buzón: al montarlas en el arranque se marcan como
                // enviadas para que no se re-monten solas en la próxima visita.
                // El pegado manual (soloPendientes) conserva la marca pendiente.
                const copia = Object.assign({}, p);
                if (!soloPendientes) copia.enviada = true;
                finales.push(copia);
            }
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
            // Solo trae las carreras que el operador NO ha enviado (las enviadas
            // ya aparecen solas en el Ensamblaje).
            pegarPendientesGaceta({ forzar: true, soloPendientes: true });
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