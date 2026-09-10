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

    const htmlSelectNac = (val = 'VE') =>
        `<select class="in-cab-nac w-14 border border-slate-200 rounded px-0.5 py-0.5 text-[9px] font-bold uppercase outline-none bg-white">
            ${OPCIONES_NACIONALIDAD.map(n => `<option value="${n}" ${n === (val || 'VE') ? 'selected' : ''}>${n}</option>`).join('')}
        </select>`;

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
        if (contenedorCarreras.querySelector('.empty-ensamblaje')) {
            contenedorCarreras.querySelector('.empty-ensamblaje').classList.toggle('hidden', carrerasBol.length > 0);
        }
    }

    function filaCaballoCard(c) {
        const vacio = (c && c.nombre) ? '' : 'opacity-70';
        return `
            <div class="fila-caballo-card flex gap-1 items-center bg-slate-50 border border-slate-200 rounded p-1 ${vacio}">
                <input type="text" class="in-cab-num w-10 border border-slate-200 rounded px-0.5 py-0.5 text-center text-xs font-bold outline-none focus:ring-1 focus:ring-indigo-400" value="${c?.numero ?? ''}" placeholder="N°">
                <input type="text" class="in-cab-nom flex-1 border border-slate-200 rounded px-1 py-0.5 text-xs font-bold uppercase outline-none focus:ring-1 focus:ring-indigo-400" value="${c?.nombre ?? ''}" placeholder="Ejemplar">
                ${htmlSelectNac(c?.nacionalidad)}
                <input type="number" step="0.1" class="in-cab-valor w-14 border border-slate-200 rounded px-0.5 py-0.5 text-right text-xs font-bold text-blue-700 outline-none focus:ring-1 focus:ring-indigo-400" value="${c?.valor ?? c?.pts ?? ''}" placeholder="Valor">
                <button type="button" class="btn-del-cab-card text-red-400 hover:text-red-600 px-0.5" title="Quitar ejemplar"><i class="fas fa-trash-alt"></i></button>
            </div>`;
    }

    function crearCardCarrera(opts) {
        const uid = 'car-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const card = document.createElement('div');
        card.className = 'card-carrera bg-white rounded-xl shadow-sm border border-indigo-200 overflow-hidden flex flex-col';
        card.dataset.uid = uid;
        card.innerHTML = `
            <div class="bg-indigo-600 text-white px-3 py-2">
                <div class="flex items-center justify-between gap-2">
                    <span class="font-black text-sm whitespace-nowrap"><i class="fas fa-flag-checkered mr-1"></i> Carrera
                        <input type="number" class="in-carrera-card w-14 bg-white/20 rounded px-1 py-0.5 text-center font-black outline-none text-white" value="${opts?.carrera ?? ''}" placeholder="N°">
                    </span>
                    <input type="text" class="in-hipo-card bg-white/20 rounded px-2 py-0.5 text-[10px] font-bold uppercase outline-none w-32 text-right placeholder-white/50" value="${opts?.hipodromo ?? ''}" placeholder="Hipódromo">
                </div>
                <div class="flex flex-wrap gap-1 mt-1.5 text-[9px] font-bold">
                    <span class="bg-white/20 rounded px-1.5 py-0.5">Dist: <input type="number" class="in-dist-card w-14 bg-transparent outline-none text-center font-black placeholder-white/50" value="${opts?.distancia ?? ''}" placeholder="m"></span>
                    <select class="in-sup-card bg-white/20 rounded px-1 py-0.5 outline-none uppercase text-[9px] font-bold">
                        ${SUPERFICIES.map(s => `<option value="${s}" ${(opts?.superficie || '').toUpperCase() === s ? 'selected' : ''}>${s}</option>`).join('')}
                    </select>
                    <span class="bg-white/20 rounded px-1.5 py-0.5">Premio $ <input type="number" step="0.01" class="in-premio-card w-20 bg-transparent outline-none text-right font-black placeholder-white/50" value="${opts?.premio ?? premioTabla.value ?? 100}"></span>
                </div>
            </div>
            <div class="px-3 pt-1.5 pb-0.5 text-[9px] font-black uppercase tracking-wider text-slate-400 flex items-center justify-between">
                <span><i class="fas fa-horse-head text-amber-500 mr-1"></i> Ejemplares</span>
                <span class="cont-caballos-card bg-slate-100 text-slate-600 px-1.5 rounded-full font-black">0</span>
            </div>
            <div class="lista-caballos-card px-2 py-1 space-y-1 overflow-y-auto max-h-56 flex-1"></div>
            <div class="add-caballo-card border-t border-slate-200 p-2 space-y-1 bg-slate-50">
                <div class="flex gap-1 items-center">
                    <input type="text" class="nuevo-num w-10 border border-slate-300 rounded px-0.5 py-1 text-xs font-bold text-center outline-none focus:ring-1 focus:ring-indigo-400" placeholder="N°">
                    <input type="text" class="nuevo-nom flex-1 border border-slate-300 rounded px-1 py-1 text-xs font-bold uppercase outline-none focus:ring-1 focus:ring-indigo-400" placeholder="Ejemplar nuevo">
                    <select class="nuevo-nac w-14 border border-slate-300 rounded px-0.5 py-1 text-[9px] font-bold uppercase outline-none bg-white">
                        ${OPCIONES_NACIONALIDAD.map(n => `<option value="${n}">${n}</option>`).join('')}
                    </select>
                    <input type="number" step="0.1" class="nuevo-valor w-14 border border-slate-300 rounded px-0.5 py-1 text-right text-xs font-bold text-blue-700 outline-none focus:ring-1 focus:ring-indigo-400" placeholder="Valor">
                    <button type="button" class="btn-add-caballo-card bg-indigo-600 hover:bg-indigo-700 text-white rounded px-2 py-1" title="Añadir ejemplar"><i class="fas fa-plus"></i></button>
                </div>
            </div>
            <div class="px-2 py-2 border-t border-slate-200 flex gap-2 bg-white">
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
            carrerasBol = carrerasBol.filter(u => u !== card.dataset.uid);
            card.remove();
            contarCarreras();
            return;
        }

        const btnPub = e.target.closest('.btn-publicar-card');
        if (btnPub) await publicarCard(btnPub.closest('.card-carrera'));
    });

    // ==========================================
    // PUBLICAR UNA CARRERA DEL ENSAMBLAJE
    // ==========================================
    async function publicarCard(card) {
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
            const nacionalidad = fila.querySelector('.in-cab-nac').value;
            const valor = parseFloat(fila.querySelector('.in-cab-valor').value);
            if (!numero && !nombre) return;
            if (numero && nombre && !isNaN(valor)) {
                const clave = nombre + '|' + nacionalidad;
                if (clavesNombreNac.has(clave)) { caballosArr.push(null); return; }
                clavesNombreNac.add(clave);
                sumaBaseTabla += valor;
                caballosArr.push({ numero, nombre, nacionalidad, valor_ejemplar: valor, retirado: false, ganador: false, ejemplar_id: null });
            }
        });

        if (caballosArr.some(c => c === null)) return clubUI.toast("Un ejemplar (nombre + nacionalidad) está repetido en la misma tabla.");
        if (caballosArr.length < 2) return clubUI.toast("Ingrese al menos 2 ejemplares.");
        if (!hipodromo || isNaN(carrera) || isNaN(premio) || premio <= 0 || sumaBaseTabla <= 0) {
            return clubUI.toast("Faltan campos obligatorios o la base de ponderación es cero.");
        }
        if (!superficie) return clubUI.toast("Seleccione la superficie de la pista.");
        if (isNaN(distancia) || distancia <= 0) return clubUI.toast("Indique la distancia de la carrera en metros.");

        const cuposPorGrupo = [...document.querySelectorAll('.in-cupo-grupo')]
            .map(inp => ({ grupo_id: inp.dataset.grupo, cupos: parseInt(inp.value) || 0 }))
            .filter(x => x.cupos > 0);
        if (cuposPorGrupo.length === 0) return clubUI.toast("Asigne cupos a al menos un grupo.");

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

        const { data: nueva, error } = await window.supabase.from('tablas_fijas').insert([{
            hipodromo, carrera, grupo_venta: 'GRUPOS', moneda: 'USD', tasa_cambio: tasaCambioGlobal,
            suma_base_tabla: sumaBaseTabla, limite_ventas: limiteTotal, cantidad_vendida: 0,
            premio_original: premio, premio_recalculado: premio,
            comision_grupo: comisionGrupo, caballos: caballosArr, estado: 'Abierta',
            distancia_carrera: distancia, superficie, retirados_oficiales: NO_RETIROS
        }]).select('id').single();

        btn.innerHTML = orig;
        btn.disabled = false;

        if (error) {
            console.error("Error BD:", error.message || error);
            return clubUI.toast("Error al registrar en la base de datos.");
        }

        const filasGrupos = cuposPorGrupo.map(x => ({ tabla_id: nueva.id, grupo_id: x.grupo_id, cupos: x.cupos, cantidad_vendida: 0 }));
        const { error: errG } = await window.supabase.from('tabla_grupos').insert(filasGrupos);
        if (errG) console.error("Error cupos:", errG.message);

        carrerasBol = carrerasBol.filter(u => u !== card.dataset.uid);
        card.remove();
        contarCarreras();
        cargarTablas(); cargarEjemplares();
        clubUI.toast(`Carrera C${carrera} (${hipodromo}) publicada con ${caballosArr.length} ejemplares (valor total calculado: privado).`, 'success');
        if (window.clubDB?.logAccion) window.clubDB.logAccion('TABLAS', `publicada: ${hipodromo} C${carrera} ${distancia}m ${superficie} premio=$${premio} cupos=${limiteTotal} ejemplares=${caballosArr.length} (id=${nueva.id})`);
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
                        ${t.estado === 'Abierta' ? `<button class="btn-auditar bg-amber-400 text-slate-900 px-2 py-1 rounded hover:bg-amber-500 font-bold" data-id="${t.id}">Auditar</button>` : `<button class="btn-auditar bg-blue-100 text-blue-700 px-2 py-1 rounded hover:bg-blue-200 font-bold" data-id="${t.id}">Resultado</button>`}
                        <button class="btn-eliminar bg-red-100 text-red-600 px-2 py-1 rounded hover:bg-red-200" data-id="${t.id}" title="Eliminar"><i class="fas fa-trash-alt"></i></button>
                    </div>
                `;

                tbodyMonitor.innerHTML += `
                    <tr class="hover:bg-slate-50 border-b border-slate-100">
                        <td class="p-2 font-bold">${t.hipodromo}<br><span class="text-blue-600">C${t.carrera}</span> ${t.distancia_carrera ? `<span class="text-slate-400 font-normal"> · ${t.distancia_carrera}m</span>` : ''} ${t.superficie ? `<span class="inline-block ml-1 text-[9px] border border-slate-300 rounded px-1 font-bold text-slate-600 uppercase">${t.superficie}</span>` : ''}
                            <div class="mt-1">${chipsGrupos}</div></td>
                        <td class="p-2 text-right"><span class="text-blue-700 font-bold">$${clubUI.formatoNumero(parseFloat(t.premio_recalculado), 2)}</span></td>
                        <td class="p-2 text-center">${badgeRetiros(t)}${chipGanador(t)}</td>
                        <td class="p-2 text-center text-[10px]">${badgeEstado}</td>
                        <td class="p-2 text-center">${btnAcciones}</td>
                    </tr>
                `;
            });

            document.querySelectorAll('.btn-editar').forEach(b => b.addEventListener('click', (e) => abrirModalEditar(e.currentTarget.dataset.id)));
            document.querySelectorAll('.btn-clonar').forEach(b => b.addEventListener('click', (e) => abrirModalClonar(e.currentTarget.dataset.id)));
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
        document.getElementById('editPremio').value = tabla.premio_recalculado;
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
        const premio = parseFloat(document.getElementById('editPremio').value);
        if (isNaN(premio) || premio <= 0) return clubUI.toast("Premio inválido.");
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
            premio_original: premio, premio_recalculado: premio, limite_ventas: cuposSuma
        }).eq('id', id);

        if (!error) { document.getElementById('modalEditar').classList.add('hidden'); cargarTablas(); }
        else { clubUI.toast("Error al editar."); }
        const tEdit = datosTablaCompleta.find(t => t.id == id);
        if (window.clubDB?.logAccion) window.clubDB.logAccion('TABLAS', `editada: ${tEdit?.hipodromo} C${tEdit?.carrera} premio=$${premio} cupos=${cuposSuma} (id=${id})`);
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

        const { data: nueva, error } = await window.supabase.from('tablas_fijas').insert([{
            hipodromo: tablaRef.hipodromo, carrera: tablaRef.carrera,
            grupo_venta: 'GRUPOS', moneda: tablaRef.moneda, tasa_cambio: tablaRef.tasa_cambio,
            suma_base_tabla: tablaRef.suma_base_tabla, limite_ventas: cuposTotales, cantidad_vendida: 0,
            premio_original: tablaRef.premio_original, premio_recalculado: tablaRef.premio_recalculado,
            comision_grupo: tablaRef.comision_grupo, caballos: tablaRef.caballos, estado: 'Abierta',
            distancia_carrera: tablaRef.distancia_carrera, superficie: tablaRef.superficie,
            retirados_oficiales: NO_RETIROS
        }]).select('id').single();

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
    // ==========================================
    let premioOrigTemp = 0, sumaBaseTemp = 0, caballosModalTemp = [];

    function abrirModalAuditoria(id) {
        const t = datosTablaCompleta.find(x => x.id == id);
        if (!t) return;
        document.getElementById('auditoriaTablaId').value = id;
        premioOrigTemp = parseFloat(t.premio_original) || 0;
        sumaBaseTemp = parseFloat(t.suma_base_tabla) || 0;
        caballosModalTemp = [...(t.caballos || [])].map(c => ({ ...c }));

        document.getElementById('lblSumaBase').textContent = clubUI.formatoNumero(sumaBaseTemp, 1);

        const contGanador = document.getElementById('listaGanadorAuditoria');
        contGanador.innerHTML = caballosModalTemp.map((c, i) => `
            <label class="flex items-center gap-2 bg-white border border-slate-200 p-2 rounded cursor-pointer text-xs">
                <input type="radio" name="ganador-carrera" class="rdo-ganador" data-index="${i}" ${c.ganador ? 'checked' : ''}>
                <span class="font-bold text-slate-700">${c.numero} - ${c.nombre} ${c.retirado ? '<span class="text-red-500 text-[9px] font-black">(RETIRADO)</span>' : ''}</span>
            </label>
        `).join('') || '<p class="text-xs text-slate-400 italic">Sin ejemplares.</p>';

        const contRetiros = document.getElementById('listaCaballosAuditoria');
        contRetiros.innerHTML = caballosModalTemp.map((c, i) => `
            <label class="flex items-center gap-2 bg-white border border-slate-200 p-2 rounded cursor-pointer text-xs">
                <input type="checkbox" class="chk-retiro" data-index="${i}" data-valor="${c.valor_ejemplar}" ${c.retirado ? 'checked' : ''}>
                <span class="font-bold text-slate-700">${c.numero} - ${c.nombre} (Valor: ${clubUI.formatoNumero(parseFloat(c.valor_ejemplar) || 0, 1)})</span>
            </label>
        `).join('') || '<p class="text-xs text-slate-400 italic">Sin ejemplares.</p>';

        document.getElementById('lblPremioRecalculado').textContent = clubUI.formatoNumero(parseFloat(t.premio_recalculado) || premioOrigTemp, 2);
        document.querySelectorAll('.chk-retiro').forEach(chk => chk.addEventListener('change', () => {
            actualizarCalculoRecalculado();
            // Un retirado no puede ser ganador: quitar la selección si estaba marcado
            const idx = parseInt(chk.dataset.index);
            if (chk.checked) {
                caballosModalTemp[idx].retirado = true;
                const rdo = contGanador.querySelector(`.rdo-ganador[data-index="${idx}"]`);
                if (rdo && rdo.checked) rdo.checked = false;
            } else {
                caballosModalTemp[idx].retirado = false;
            }
        }));
        document.getElementById('modalAuditoria').classList.remove('hidden');
    }

    function actualizarCalculoRecalculado() {
        let valRet = 0;
        document.querySelectorAll('.chk-retiro:checked').forEach(c => valRet += parseFloat(c.dataset.valor));
        let p = premioOrigTemp;
        if (sumaBaseTemp > 0 && valRet > 0) p = premioOrigTemp * (1 - (valRet / sumaBaseTemp));
        document.getElementById('lblPremioRecalculado').textContent = clubUI.formatoNumero(Math.max(0, p), 2);
    }

    document.getElementById('btnProcesarAuditoria').addEventListener('click', async () => {
        const id = document.getElementById('auditoriaTablaId').value;
        const np = parseFloat(document.getElementById('lblPremioRecalculado').textContent);
        let ret = [];
        document.querySelectorAll('.chk-retiro').forEach(c => {
            const idx = c.dataset.index;
            caballosModalTemp[idx].retirado = c.checked;
            if (c.checked) ret.push(caballosModalTemp[idx].numero);
        });
        const rdoGanador = document.querySelector('.rdo-ganador:checked');
        if (rdoGanador) {
            const idxG = parseInt(rdoGanador.dataset.index);
            caballosModalTemp.forEach((c, i) => { c.ganador = (i === idxG); });
        }
        const { error } = await window.supabase.from('tablas_fijas').update({
            premio_recalculado: np,
            caballos: caballosModalTemp,
            estado: 'Auditada',
            retirados_oficiales: ret.length > 0 ? ret.join(',') : NO_RETIROS
        }).eq('id', id);
        if (!error) { document.getElementById('modalAuditoria').classList.add('hidden'); cargarTablas(); }
        const tAud = datosTablaCompleta.find(x => x.id == id);
        if (window.clubDB?.logAccion) window.clubDB.logAccion('TABLAS', `auditada: ${tAud?.hipodromo} C${tAud?.carrera} premio_recalculado=$${np} retirados=[${ret.length ? ret.join(',') : NO_RETIROS}] (id=${id})`);
    });

    document.querySelectorAll('.cerrar-modal').forEach(b => b.addEventListener('click', () => {
        document.getElementById('modalAuditoria').classList.add('hidden');
        document.getElementById('modalDuplicar').classList.add('hidden');
        document.getElementById('modalEditar').classList.add('hidden');
    }));

    document.getElementById('btnRecargarTablas').addEventListener('click', () => {
        cargarTasaGlobal(); cargarHipodromos(); cargarGrupos(); cargarEjemplares(); cargarTablas();
    });

    // El catálogo se espera UNA vez y se reutiliza para el prellenado.
    const catalogoListo = Promise.all([cargarHipodromos(), cargarGrupos(), cargarEjemplares()]);

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
    // PRELLENADO DESDE GACETA (una o varias carreras)
    // ==========================================
    async function aplicarPrellenadoGaceta() {
        const leer = (k) => localStorage.getItem(k) || sessionStorage.getItem(k);
        const limpiar = (k) => { localStorage.removeItem(k); sessionStorage.removeItem(k); };

        let carreras = [];
        const arr = leer('ensamblaje_carreras');
        if (arr) {
            try {
                const parsed = JSON.parse(arr);
                if (Array.isArray(parsed) && parsed.length) carreras = parsed;
            } catch (e) { /* nada */ }
        }
        if (carreras.length === 0) {
            const solo = leer('gaceta_prellenado');
            if (solo) {
                try {
                    const p = JSON.parse(solo);
                    if (p && p.hipodromo) carreras = [p];
                } catch (e) { /* nada */ }
            }
        }
        limpiar('ensamblaje_carreras');
        limpiar('gaceta_prellenado');
        if (carreras.length === 0) return;

        await catalogoListo;

        carreras.forEach(pre => {
            const caballos = (pre.caballos || []).map(c => ({
                numero: c.numero, nombre: c.nombre, nacionalidad: c.nacionalidad || 'VE',
                valor: c.valor ?? c.pts ?? null
            })).filter(c => c.nombre);
            const card = crearCardCarrera({
                hipodromo: pre.hipodromo || '',
                carrera: pre.carrera || '',
                distancia: pre.distancia || '',
                superficie: pre.superficie || '',
                premio: pre.premio || premioTabla.value || 100,
                caballos
            });
            if (pre.hipodromo) {
                // Asegurar que el hipódromo quede en el catálogo (los propios de la gaceta)
                const selHipo = document.getElementById('hipodromoTabla');
                if (![...selHipo.options].some(o => o.value.toUpperCase() === pre.hipodromo.toUpperCase())) {
                    asegurarHipodromoEnDB(pre.hipodromo);
                }
            }
            void card;
        });

        clubUI.toast(`${carreras.length} carrera(s) cargada(s) desde la gaceta. Revise los VALORES y publique.`, 'success');
        contenedorCarreras.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // ==========================================
    // ARRANQUE
    // ==========================================
    llenarSuperficies();
    cargarTasaGlobal();
    cargarTablas();
    aplicarPrellenadoGaceta();
});