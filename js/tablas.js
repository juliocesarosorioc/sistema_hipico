document.addEventListener('DOMContentLoaded', () => {

    const contenedorCaballos = document.getElementById('contenedorCaballos');
    const btnAgregarCaballo = document.getElementById('btnAgregarCaballo');
    const lblSumaBase = document.getElementById('totalSumaBase');
    const lblPremioPts = document.getElementById('lblPremioPts');
    const btnGuardarTabla = document.getElementById('btnGuardarTabla');
    const tbodyMonitor = document.getElementById('cuerpoMonitorTablas');
    const premioTabla = document.getElementById('premioTabla');

    let tasaCambioGlobal = 1.0;
    let datosTablaCompleta = [];
    let gruposActivos = [];
    let todosGrupos = [];
    let padronEjemplares = [];

    const OPCIONES_NACIONALIDAD = ['VE', 'USA', 'BR', 'AR', 'CL', 'MX', 'PA', 'PE', 'CO', 'EC', 'UY', 'OTRA'];
    const SUPERFICIES = ['ARENA', 'CESPED', 'FANGO', 'TAPETA', 'OTRA'];

    // ==========================================
    // TASA GLOBAL (interna: solo se guarda en el registro para el cuadre)
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
        if (error) return;
        todosGrupos = data || [];
        gruposActivos = todosGrupos.filter(g => g.activo);
        renderCuposGrupos();
        renderGruposDup();
    }

    // ==========================================
    // CUPOS POR GRUPO (ensamblaje; la gestión vive en Grupos y Convenios)
    // ==========================================
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

    // ==========================================
    // PADRÓN DE EJEMPLARES (base de estadísticas)
    // ==========================================
    async function cargarEjemplares() {
        const { data } = await window.supabase.from('ejemplares').select('id, nombre, nacionalidad').order('nombre');
        padronEjemplares = data || [];
    }

    function llenarSuperficies() {
        const sel = document.getElementById('superficieTabla');
        sel.innerHTML = '<option value="">Seleccione superficie...</option>' + SUPERFICIES.map(s => `<option value="${s}">${s}</option>`).join('');
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
    // CÁLCULOS EN VIVO (Ejemplares)
    // ==========================================
    function revisarEjemplarFila(div) {
        const nombre = (div.querySelector('.in-nom-cab').value || '').trim().toUpperCase();
        const nac = div.querySelector('.in-nac-cab').value;
        const pista = div.querySelector('.pista-ejemplar');
        if (!nombre) { pista.classList.add('hidden'); pista.textContent = ''; return; }
        const mismos = padronEjemplares.filter(e => e.nombre.toUpperCase() === nombre);
        let msg, cls;
        if (mismos.length === 0) {
            msg = 'Nuevo ejemplar: se registrará en el padrón.';
            cls = 'text-emerald-600';
        } else if (mismos.some(e => e.nacionalidad.toUpperCase() === nac)) {
            msg = `Ya registrado (${nac}): se vinculará automáticamente al padrón.`;
            cls = 'text-amber-600';
        } else {
            msg = `Nombre existente en ${mismos.map(e => e.nacionalidad).join('/')}: quedará como nuevo ejemplar (${nac}).`;
            cls = 'text-rose-600';
        }
        pista.classList.remove('hidden');
        pista.textContent = msg;
        pista.className = `pista-ejemplar mt-1 text-[10px] font-bold ${cls}`;
    }

    function crearFilaCaballo(numSugerido = '', nomSugerido = '', valorSugerido = '', nacSugerido = 'VE') {
        const div = document.createElement('div');
        div.className = 'fila-caballo-config bg-slate-50 border border-slate-200 rounded-lg p-1.5 space-y-1';
        div.innerHTML = `
            <div class="flex gap-2 items-center">
                <input type="text" class="input-tbl w-14 text-center in-num-cab font-bold" value="${numSugerido}" placeholder="N°">
                <input type="text" class="input-tbl flex-1 in-nom-cab uppercase" value="${nomSugerido}" placeholder="Ejemplar">
                <select class="input-tbl w-24 in-nac-cab text-xs font-bold uppercase">
                    ${OPCIONES_NACIONALIDAD.map(n => `<option value="${n}" ${n === nacSugerido ? 'selected' : ''}>${n}</option>`).join('')}
                </select>
                <input type="number" step="0.1" class="input-tbl w-20 text-center text-blue-700 font-bold in-valor-ej" value="${valorSugerido}" placeholder="Pts">
                <button type="button" class="text-red-400 hover:text-red-600 px-1 btn-quitar-cab" title="Quitar"><i class="fas fa-trash-alt"></i></button>
            </div>
            <p class="pista-ejemplar text-[10px] font-bold hidden"></p>
        `;
        contenedorCaballos.appendChild(div);
        div.querySelector('.btn-quitar-cab').addEventListener('click', () => { div.remove(); calcularSumaBaseTotal(); });
        div.querySelector('.in-valor-ej').addEventListener('input', calcularSumaBaseTotal);
        div.querySelector('.in-nom-cab').addEventListener('input', () => revisarEjemplarFila(div));
        div.querySelector('.in-nac-cab').addEventListener('change', () => revisarEjemplarFila(div));
        revisarEjemplarFila(div);
    }

    function calcularSumaBaseTotal() {
        let suma = 0;
        document.querySelectorAll('.in-valor-ej').forEach(input => { suma += parseFloat(input.value) || 0; });
        lblSumaBase.textContent = clubUI.formatoNumero(suma, 1);
    }

    function actualizarPremio() {
        const prem = parseFloat(premioTabla.value) || 0;
        if (lblPremioPts) lblPremioPts.textContent = '$' + clubUI.formatoNumero(prem, 2);
    }

    premioTabla.addEventListener('input', actualizarPremio);
    btnAgregarCaballo.addEventListener('click', () => crearFilaCaballo());
    crearFilaCaballo('1', 'Ejemplar A', '50');
    crearFilaCaballo('2', 'Ejemplar B', '60');
    crearFilaCaballo('3', 'Ejemplar C', '50');
    calcularSumaBaseTotal();

    // ==========================================
    // ENSAMBLAR Y PUBLICAR
    // ==========================================
    btnGuardarTabla.addEventListener('click', async () => {
        const hipodromo = document.getElementById('hipodromoTabla').value.trim().toUpperCase();
        const carrera = parseInt(document.getElementById('carreraTabla').value);
        const premio = parseFloat(premioTabla.value);
        const sumaBaseTabla = parseFloat(lblSumaBase.textContent);
        const distancia = parseFloat(document.getElementById('distanciaTabla').value);
        const superficie = document.getElementById('superficieTabla').value;

        if (!hipodromo || isNaN(carrera) || isNaN(premio) || premio <= 0 || sumaBaseTabla <= 0) {
            return clubUI.toast("Faltan campos obligatorios o la base de ponderación es cero.");
        }
        if (!superficie) return clubUI.toast("Seleccione la superficie de la pista (arena, césped, fango, tapeta...).");
        if (isNaN(distancia) || distancia <= 0) return clubUI.toast("Indique la distancia de la carrera en metros.");

        const cuposPorGrupo = [...document.querySelectorAll('.in-cupo-grupo')]
            .map(inp => ({ grupo_id: inp.dataset.grupo, cupos: parseInt(inp.value) || 0 }))
            .filter(x => x.cupos > 0);
        if (cuposPorGrupo.length === 0) return clubUI.toast("Asigne cupos a al menos un grupo.");

        // Comisión: proviene del convenio del grupo (sección Grupos y Convenios), no se pide aquí.
        const grupoPrimario = gruposActivos.find(g => g.es_principal) || gruposActivos[0];
        const comisionGrupo = parseFloat(grupoPrimario && grupoPrimario.comision_default) || 2.5;

        let caballosArr = [];
        const clavesNombreNac = new Set();
        document.querySelectorAll('.fila-caballo-config').forEach(fila => {
            const numero = fila.querySelector('.in-num-cab').value.trim();
            const nombre = fila.querySelector('.in-nom-cab').value.trim().toUpperCase();
            const nacionalidad = fila.querySelector('.in-nac-cab').value;
            const valor = parseFloat(fila.querySelector('.in-valor-ej').value);
            if (numero && nombre && !isNaN(valor)) {
                const clave = nombre + '|' + nacionalidad;
                if (clavesNombreNac.has(clave)) {
                    caballosArr.push(null);
                    return;
                }
                clavesNombreNac.add(clave);
                caballosArr.push({ numero, nombre, nacionalidad, valor_ejemplar: valor, retirado: false, ejemplar_id: null });
            }
        });
        if (caballosArr.some(c => c === null)) return clubUI.toast("Un ejemplar (nombre + nacionalidad) está repetido en la misma tabla.");
        if (caballosArr.length < 2) return clubUI.toast("Ingrese al menos 2 ejemplares.");

        const limiteTotal = cuposPorGrupo.reduce((a, b) => a + b.cupos, 0);
        const btnOrigText = btnGuardarTabla.innerHTML;
        btnGuardarTabla.innerHTML = 'Guardando...'; btnGuardarTabla.disabled = true;

        for (const c of caballosArr) {
            c.ejemplar_id = await resolverEjemplar(c.nombre, c.nacionalidad);
        }

        const { data: nueva, error } = await window.supabase.from('tablas_fijas').insert([{
            hipodromo, carrera, grupo_venta: 'GRUPOS', moneda: 'USD', tasa_cambio: tasaCambioGlobal,
            suma_base_tabla: sumaBaseTabla, limite_ventas: limiteTotal, cantidad_vendida: 0,
            premio_original: premio, premio_recalculado: premio,
            comision_grupo: comisionGrupo, caballos: caballosArr, estado: 'Abierta',
            distancia_carrera: distancia, superficie
        }]).select('id').single();

        if (error) {
            console.error("Error BD:", error.message || error);
            clubUI.toast("Error al registrar en la base de datos.");
        } else {
            const filasGrupos = cuposPorGrupo.map(x => ({ tabla_id: nueva.id, grupo_id: x.grupo_id, cupos: x.cupos, cantidad_vendida: 0 }));
            const { error: errG } = await window.supabase.from('tabla_grupos').insert(filasGrupos);
            if (errG) console.error("Error cupos:", errG.message);
            contenedorCaballos.innerHTML = '';
            crearFilaCaballo(); crearFilaCaballo();
            calcularSumaBaseTotal(); cargarTablas(); cargarEjemplares();
            if (window.clubDB?.logAccion) window.clubDB.logAccion('TABLAS', `publicada: ${hipodromo} C${carrera} ${distancia}m ${superficie} premio=$${premio} cupos=${limiteTotal} (id=${nueva.id})`);
        }
        btnGuardarTabla.innerHTML = btnOrigText; btnGuardarTabla.disabled = false;
    });

    // ==========================================
    // MONITOR
    // ==========================================
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

                let chipsGrupos = (t.tabla_grupos || []).map(tg => {
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

                let btnAcciones = `
                    <div class="flex flex-wrap gap-1 justify-center">
                        <button class="btn-editar bg-slate-200 text-slate-700 px-2 py-1 rounded hover:bg-slate-300" data-id="${t.id}" title="Editar"><i class="fas fa-edit"></i></button>
                        <button class="btn-clonar bg-indigo-100 text-indigo-700 px-2 py-1 rounded hover:bg-indigo-200" data-id="${t.id}" title="Clonar"><i class="fas fa-copy"></i></button>
                        ${t.estado === 'Abierta' ? `<button class="btn-auditar bg-amber-400 text-slate-900 px-2 py-1 rounded hover:bg-amber-500 font-bold" data-id="${t.id}">Auditar</button>` : ''}
                        <button class="btn-eliminar bg-red-100 text-red-600 px-2 py-1 rounded hover:bg-red-200" data-id="${t.id}" title="Eliminar"><i class="fas fa-trash-alt"></i></button>
                    </div>
                `;

                tbodyMonitor.innerHTML += `
                    <tr class="hover:bg-slate-50 border-b border-slate-100">
                        <td class="p-2 font-bold">${t.hipodromo}<br><span class="text-blue-600">C${t.carrera}</span> ${t.distancia_carrera ? `<span class="text-slate-400 font-normal"> · ${t.distancia_carrera}m</span>` : ''} ${t.superficie ? `<span class="inline-block ml-1 text-[9px] border border-slate-300 rounded px-1 font-bold text-slate-600 uppercase">${t.superficie}</span>` : ''}</td>
                        <td class="p-2">${chipsGrupos}</td>
                        <td class="p-2 text-right"><span class="text-blue-700 font-bold">$${clubUI.formatoNumero(parseFloat(t.premio_recalculado), 2)}</span></td>
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
    // ELIMINAR TABLA (con liquidaciones pendientes)
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

        // Selector para reasignar a un grupo nuevo
        const selecNuevo = document.getElementById('nuevoGrupoEditar');
        const opciones = gruposActivos
            .filter(g => !yaAsignados.includes(g.id))
            .map(g => `<option value="${g.id}">${g.nombre} (${g.moneda})</option>`)
            .join('');
        selecNuevo.innerHTML = '<option value="">Grupo a agregar...</option>' + opciones;
        if (!opciones) selecNuevo.innerHTML = '<option value="" disabled>Todos los grupos ya están asignados</option>';
        document.getElementById('nuevoCupoEditar').value = 50;

        // Quitar grupo (solo suma si el boton existe)
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
    // CLONACIÓN (duplicar en mismos grupos)
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
            comision_grupo: tablaRef.comision_grupo, caballos: tablaRef.caballos, estado: 'Abierta'
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
    // AUDITORÍA (Retiros y Descuento Proporcional)
    // ==========================================
    let premioOrigTemp = 0, sumaBaseTemp = 0, caballosModalTemp = [];

    function abrirModalAuditoria(id) {
        const t = datosTablaCompleta.find(x => x.id == id);
        document.getElementById('auditoriaTablaId').value = id;
        premioOrigTemp = t.premio_original; sumaBaseTemp = t.suma_base_tabla;
        caballosModalTemp = t.caballos;

        document.getElementById('lblSumaBase').textContent = sumaBaseTemp;
        const ctn = document.getElementById('listaCaballosAuditoria'); ctn.innerHTML = '';
        caballosModalTemp.forEach((c, i) => {
            ctn.innerHTML += `<label class="flex items-center gap-2 bg-white border border-slate-200 p-2 rounded cursor-pointer text-xs">
                <input type="checkbox" class="chk-retiro" data-index="${i}" data-valor="${c.valor_ejemplar}">
                <span class="font-bold text-slate-700">${c.numero} - ${c.nombre} (Valor: ${c.valor_ejemplar})</span>
            </label>`;
        });
        document.getElementById('lblPremioRecalculado').textContent = premioOrigTemp;
        document.querySelectorAll('.chk-retiro').forEach(chk => chk.addEventListener('change', actualizarCalculoRecalculado));
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
        const { error } = await window.supabase.from('tablas_fijas').update({
            premio_recalculado: np, caballos: caballosModalTemp, estado: 'Auditada', retirados_oficiales: ret.length > 0 ? ret.join(',') : 'Ninguno'
        }).eq('id', id);
        if (!error) { document.getElementById('modalAuditoria').classList.add('hidden'); cargarTablas(); }
        const tAud = datosTablaCompleta.find(x => x.id == id);
        if (window.clubDB?.logAccion) window.clubDB.logAccion('TABLAS', `auditada: ${tAud?.hipodromo} C${tAud?.carrera} premio_recalculado=$${np} retirados=[${ret}] (id=${id})`);
    });

    document.querySelectorAll('.cerrar-modal').forEach(b => b.addEventListener('click', () => {
        document.getElementById('modalAuditoria').classList.add('hidden');
        document.getElementById('modalDuplicar').classList.add('hidden');
        document.getElementById('modalEditar').classList.add('hidden');
    }));

    document.getElementById('btnRecargarTablas').addEventListener('click', () => {
        cargarTasaGlobal(); cargarHipodromos(); cargarGrupos(); cargarEjemplares(); cargarTablas();
    });

    // Arranque
    llenarSuperficies();
    cargarTasaGlobal();
    cargarHipodromos();
    cargarGrupos();
    cargarEjemplares();
    cargarTablas();
    actualizarPremio();
    aplicarPrellenadoGaceta();
});

    // ==========================================
    // PRELLENADO DESDE GACETA (cuando el usuario la envía desde Gaceta → Tablas)
    // ==========================================
    function aplicarPrellenadoGaceta() {
        const raw = sessionStorage.getItem('gaceta_prellenado');
        if (!raw) return;
        sessionStorage.removeItem('gaceta_prellenado');
        let pre;
        try { pre = JSON.parse(raw); } catch (e) { return; }
        if (!pre || !pre.hipodromo) return;

        const selHipo = document.getElementById('hipodromoTabla');
        const selSup = document.getElementById('superficieTabla');

        if (pre.hipodromo && selHipo) {
            const op = [...selHipo.options].find(o => o.value.toUpperCase() === pre.hipodromo.toUpperCase());
            if (op) selHipo.value = op.value;
            else {
                const nueva = document.createElement('option');
                nueva.value = pre.hipodromo; nueva.textContent = pre.hipodromo;
                selHipo.appendChild(nueva); selHipo.value = pre.hipodromo;
            }
        }
        if (pre.carrera) document.getElementById('carreraTabla').value = pre.carrera;
        if (pre.distancia) document.getElementById('distanciaTabla').value = pre.distancia;
        if (pre.superficie && selSup) {
            const opS = [...selSup.options].find(o => o.value === pre.superficie.toUpperCase());
            if (opS) selSup.value = opS.value;
        }
        if (pre.premio) { premioTabla.value = pre.premio; actualizarPremio(); }

        if (pre.caballos && pre.caballos.length >= 2) {
            Promise.all([cargarHipodromos(), cargarGrupos(), cargarEjemplares()]).then(() => {
                contenedorCaballos.innerHTML = '';
                pre.caballos.forEach(c => crearFilaCaballo(c.numero, c.nombre, c.pts, c.nacionalidad || 'VE'));
                calcularSumaBaseTotal();
            });
        }
        clubUI.toast(`Carrera C${pre.carrera || '?'} (${pre.hipodromo}) cargada desde la gaceta. Revise PTS y publique.`, 'success');
    }