document.addEventListener('DOMContentLoaded', () => {

    const contenedorCaballos = document.getElementById('contenedorCaballos');
    const btnAgregarCaballo = document.getElementById('btnAgregarCaballo');
    const lblSumaBase = document.getElementById('totalSumaBase');
    const lblPremioPts = document.getElementById('lblPremioPts');
    const btnGuardarTabla = document.getElementById('btnGuardarTabla');
    const tbodyMonitor = document.getElementById('cuerpoMonitorTablas');
    const premioTabla = document.getElementById('premioTabla');
    const lblRiesgoBs = document.getElementById('lblRiesgoBs');
    const lblRiesgoUsd = document.getElementById('lblRiesgoUsd');
    const maxRiesgoUsd = document.getElementById('maxRiesgoUsd');
    const lblExcesoRiesgo = document.getElementById('lblExcesoRiesgo');

    // Gestión de grupos
    const btnAcordeonGrupos = document.getElementById('btnAcordeonGrupos');
    const panelGrupos = document.getElementById('panelGrupos');
    const iconoAcordeonGrupos = document.getElementById('iconoAcordeonGrupos');

    let tasaCambioGlobal = 1.0;
    let datosTablaCompleta = [];
    let gruposActivos = [];
    let todosGrupos = [];
    let clientesTodos = [];

    // ==========================================
    // TASA GLOBAL Y HIPÓDROMOS VINCULADOS
    // ==========================================
    async function cargarTasaGlobal() {
        try {
            const { data } = await window.supabase.from('monedas').select('tasa_cambio').limit(1).single();
            if (data && data.tasa_cambio) {
                tasaCambioGlobal = parseFloat(data.tasa_cambio);
                document.getElementById('lblTasaGlobal').textContent = tasaCambioGlobal.toLocaleString();
                const lblTasaRiesgo = document.getElementById('lblTasaRiesgo');
                if (lblTasaRiesgo) lblTasaRiesgo.value = 'Bs ' + tasaCambioGlobal.toLocaleString() + ' / $';
            }
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
    // GRUPOS DE VENTA
    // ==========================================
    async function cargarGrupos() {
        const { data, error } = await window.supabase.from('grupos_venta').select('*').order('es_principal', { ascending: false });
        if (error) return;
        todosGrupos = data || [];
        gruposActivos = todosGrupos.filter(g => g.activo);
        renderGruposGestion();
        renderSelectsGrupos();
        renderCuposGrupos();
        renderGruposDup();
        cargarClientesTodos();
    }

    function renderSelectsGrupos() {
        const opts = gruposActivos.map(g => `<option value="${g.id}">${g.nombre} (${g.moneda})</option>`).join('');
        document.getElementById('selectGrupoOrigen').innerHTML = '<option value="">Seleccione...</option>' + opts;
        document.getElementById('selectGrupoDestino').innerHTML = '<option value="">Seleccione...</option>' + opts;
    }

    function renderGruposGestion() {
        const cont = document.getElementById('listaGrupos');
        if (todosGrupos.length === 0) {
            cont.innerHTML = '<p class="text-slate-400 italic text-xs">Sin grupos. Cree el primero.</p>';
            return;
        }
        cont.innerHTML = todosGrupos.map(g => `
            <div class="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                <div class="flex-1 min-w-0">
                    <span class="font-bold text-slate-800 text-sm">${g.nombre}</span>
                    <span class="ml-2 px-1.5 py-0.5 rounded text-[9px] font-black ${g.moneda === 'VES' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}">${g.moneda}</span>
                    <span class="ml-1 px-1.5 py-0.5 rounded text-[9px] font-black bg-slate-200 text-slate-700" title="Moneda de cuadre">Cuadre: ${g.moneda_cuadre || g.moneda}</span>
                    ${g.es_principal ? '<span class="ml-1 text-[9px] font-black bg-slate-800 text-white px-1.5 py-0.5 rounded">PRINCIPAL</span>' : ''}
                    <div class="text-[10px] text-slate-500 mt-0.5 truncate">
                        ${g.responsable ? `<i class="fas fa-user-tie mr-0.5 text-slate-400"></i><b>${g.responsable}</b>` : '<span class="italic">Sin responsable</span>'}
                        ${g.cuenta_bancaria ? ` · <i class="fas fa-university mr-0.5 text-slate-400"></i>${g.cuenta_bancaria}` : ''}
                    </div>
                    <span class="text-[10px] text-slate-500">Cupos/tabla: <b>${g.cupo_tabla}</b> · Comisión: <b>${parseFloat(g.comision_default || 2.5)}%</b> · Clientes: <b id="cntgrupo_${g.id}">?</b></span>
                </div>
                <button class="btn-editar-grupo px-2 py-1 rounded text-xs font-bold bg-slate-200 text-slate-700 hover:bg-slate-300" data-id="${g.id}" title="Editar grupo"><i class="fas fa-edit"></i></button>
                <button class="btn-toggle-grupo px-2 py-1 rounded text-xs font-bold ${g.activo ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-red-100 text-red-600 hover:bg-red-200'}" data-id="${g.id}" data-activo="${g.activo}">
                    <i class="fas ${g.activo ? 'fa-toggle-on' : 'fa-toggle-off'}"></i>
                </button>
                ${g.es_principal ? '' : `<button class="btn-del-grupo px-2 py-1 rounded text-xs bg-red-50 text-red-600 hover:bg-red-100" data-id="${g.id}" title="Eliminar"><i class="fas fa-trash-alt"></i></button>`}
            </div>
        `).join('');

        document.querySelectorAll('.btn-del-grupo').forEach(b => b.addEventListener('click', eliminarGrupo));
        document.querySelectorAll('.btn-toggle-grupo').forEach(b => b.addEventListener('click', toggleGrupo));
        document.querySelectorAll('.btn-editar-grupo').forEach(b => b.addEventListener('click', abrirModalEditarGrupo));

        // Contadores por grupo
        document.querySelectorAll('#gruposSeleccion').forEach(() => {});
    }

    document.getElementById('formGrupo')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const nombre = document.getElementById('nombreGrupo').value.trim().toUpperCase();
        if (!nombre) return;
        const { error } = await window.supabase.from('grupos_venta').insert([{
            nombre: nombre,
            moneda: document.getElementById('monedaGrupo').value,
            moneda_cuadre: document.getElementById('monedaCuadreGrupo').value,
            es_principal: document.getElementById('esPrincipalGrupo').checked,
            cupo_tabla: parseInt(document.getElementById('cupoGrupo').value) || 100,
            responsable: document.getElementById('responsableGrupo').value.trim().toUpperCase() || null,
            cuenta_bancaria: document.getElementById('cuentaGrupo').value.trim().toUpperCase() || null,
            comision_default: 2.5
        }]);
        if (error) return clubUI.toast(error.code === '23505' ? 'Ese grupo ya existe.' : 'Error al crear el grupo.');
        e.target.reset();
        document.getElementById('monedaGrupo').value = 'USD';
        document.getElementById('monedaCuadreGrupo').value = 'USD';
        document.getElementById('cupoGrupo').value = 100;
        cargarGrupos();
        if (window.clubDB?.logAccion) window.clubDB.logAccion('TABLAS', `grupo_creado: ${nombre}`);
    });

    async function toggleGrupo(e) {
        const id = e.currentTarget.dataset.id;
        const nuevo = e.currentTarget.dataset.activo === 'false';
        await window.supabase.from('grupos_venta').update({ activo: nuevo }).eq('id', id);
        cargarGrupos();
        const g = todosGrupos.find(x => x.id == id);
        if (window.clubDB?.logAccion) window.clubDB.logAccion('TABLAS', `grupo_${nuevo ? 'activado' : 'desactivado'}: ${g?.nombre}`);
    }

    async function eliminarGrupo(e) {
        const id = e.currentTarget.dataset.id;
        const g = todosGrupos.find(x => x.id == id);
        if (!g) return;
        if (!confirm(`Eliminar el grupo "${g.nombre}"?\nSus clientes pasarán al grupo PRINCIPAL y se perderá su inventario de tablas.`)) return;
        const principal = todosGrupos.find(x => x.es_principal);
        if (principal && principal.id != id) {
            await window.supabase.from('clientes').update({ grupo_id: principal.id }).eq('grupo_id', id);
        }
        await window.supabase.from('grupos_venta').delete().eq('id', id);
        cargarGrupos();
        if (window.clubDB?.logAccion) window.clubDB.logAccion('TABLAS', `grupo_eliminado: ${g.nombre} (id=${id})`);
    }

    function abrirModalEditarGrupo(e) {
        const g = todosGrupos.find(x => x.id == e.currentTarget.dataset.id);
        if (!g) return;
        document.getElementById('editGrupoId').value = g.id;
        document.getElementById('editGrupoNombre').value = g.nombre;
        document.getElementById('editGrupoMoneda').value = g.moneda || 'USD';
        document.getElementById('editGrupoMonedaCuadre').value = g.moneda_cuadre || 'USD';
        document.getElementById('editGrupoCupo').value = g.cupo_tabla || 100;
        document.getElementById('editGrupoResponsable').value = g.responsable || '';
        document.getElementById('editGrupoCuenta').value = g.cuenta_bancaria || '';
        document.getElementById('editGrupoComision').value = parseFloat(g.comision_default || 2.5);
        document.getElementById('modalEditarGrupo').classList.remove('hidden');
    }

    document.getElementById('btnGuardarGrupoEdit')?.addEventListener('click', async () => {
        const id = document.getElementById('editGrupoId').value;
        const g = todosGrupos.find(x => x.id == id);
        const nombre = document.getElementById('editGrupoNombre').value.trim().toUpperCase();
        const { error } = await window.supabase.from('grupos_venta').update({
            nombre: nombre,
            moneda: document.getElementById('editGrupoMoneda').value,
            moneda_cuadre: document.getElementById('editGrupoMonedaCuadre').value,
            cupo_tabla: parseInt(document.getElementById('editGrupoCupo').value) || 100,
            responsable: document.getElementById('editGrupoResponsable').value.trim().toUpperCase() || null,
            cuenta_bancaria: document.getElementById('editGrupoCuenta').value.trim().toUpperCase() || null,
            comision_default: parseFloat(document.getElementById('editGrupoComision').value) || 2.5
        }).eq('id', id);
        if (error) return clubUI.toast('Error al guardar el grupo: ' + error.message, 'error');
        document.getElementById('modalEditarGrupo').classList.add('hidden');
        cargarGrupos();
        if (window.clubDB?.logAccion) window.clubDB.logAccion('TABLAS', `grupo_editado: ${g?.nombre} -> ${nombre} (id=${id})`);
    });

    btnAcordeonGrupos?.addEventListener('click', () => {
        panelGrupos.classList.toggle('hidden');
        iconoAcordeonGrupos.classList.toggle('rotate-180');
    });

    // ==========================================
    // ASIGNACIÓN DE CLIENTES A GRUPOS
    // ==========================================
    async function cargarClientesTodos() {
        const { data } = await window.supabase.from('clientes').select('id, nombre, grupo_id').order('nombre');
        clientesTodos = data || [];
        todosGrupos.forEach(g => {
            const cnt = document.getElementById('cntgrupo_' + g.id);
            if (cnt) cnt.textContent = clientesTodos.filter(c => c.grupo_id === g.id).length;
        });
        renderClientesGrupo();
    }

    function renderClientesGrupo() {
        const origen = document.getElementById('selectGrupoOrigen').value;
        const cont = document.getElementById('listaClientesGrupo');
        const resumen = document.getElementById('resumenClientesGrupo');
        if (!origen) {
            cont.innerHTML = '<p class="text-slate-400 italic text-xs">Seleccione un grupo origen.</p>';
            resumen.textContent = '0';
            return;
        }
        const lista = clientesTodos.filter(c => c.grupo_id === origen);
        resumen.textContent = lista.length;
        if (lista.length === 0) {
            cont.innerHTML = '<p class="text-slate-400 italic text-xs">No hay clientes en este grupo.</p>';
            return;
        }
        cont.innerHTML = lista.map(c => `
            <label class="flex items-center gap-2 bg-white border border-slate-200 rounded px-2 py-1.5 cursor-pointer text-sm">
                <input type="checkbox" value="${c.id}" class="chk-cliente rounded">
                <span class="font-semibold text-slate-700">${c.nombre}</span>
            </label>
        `).join('');
    }

    ['selectGrupoOrigen', 'selectGrupoDestino'].forEach(id => {
        document.getElementById(id).addEventListener('change', renderClientesGrupo);
    });

    async function moverClientes(ids) {
        const destino = document.getElementById('selectGrupoDestino').value;
        const origen = document.getElementById('selectGrupoOrigen').value;
        if (!destino || !origen || ids.length === 0) return clubUI.toast("Seleccione origen, destino y clientes.");
        if (origen === destino) return clubUI.toast("Origen y destino son el mismo.");
        const { error } = await window.supabase.from('clientes').update({ grupo_id: destino }).in('id', ids);
        if (error) return clubUI.toast('Error al mover clientes: ' + error.message);
        cargarClientesTodos();
        if (window.clubDB?.logAccion) window.clubDB.logAccion('TABLAS', `clientes_movidos: ${ids.length} de grupo ${origen} a ${destino}`);
    }

    document.getElementById('btnMoverClientes').addEventListener('click', () => {
        const ids = [...document.querySelectorAll('.chk-cliente:checked')].map(c => c.value);
        moverClientes(ids);
    });

    document.getElementById('btnMoverTodos').addEventListener('click', () => {
        const origen = document.getElementById('selectGrupoOrigen').value;
        const ids = clientesTodos.filter(c => c.grupo_id === origen).map(c => c.id);
        moverClientes(ids);
    });

    // ==========================================
    // CUPOS POR GRUPO (ensamblaje)
    // ==========================================
    function renderCuposGrupos() {
        const cont = document.getElementById('contenedorCuposGrupos');
        if (gruposActivos.length === 0) {
            cont.innerHTML = '<p class="text-slate-400 italic text-xs">No hay grupos activos. Créelos en "Gestión de Grupos y Clientes".</p>';
            return;
        }
        cont.innerHTML = gruposActivos.map(g => `
            <div class="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2" data-grupo="${g.id}">
                <div class="flex-1">
                    <span class="font-bold text-slate-800 text-sm">${g.nombre}</span>
                    <span class="ml-2 px-1.5 py-0.5 rounded text-[9px] font-black ${g.moneda === 'VES' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}">${g.moneda}</span>
                    <span class="ml-2 text-[10px] text-slate-500">Riesgo: <span class="riesgo-grupo text-red-600 font-bold">0.00</span></span>
                </div>
                <input type="number" min="0" value="${g.cupo_tabla}" data-grupo="${g.id}"
                    class="in-cupo-grupo w-24 border border-slate-300 rounded-lg px-2 py-1.5 text-sm font-black text-center outline-none focus:ring-2 focus:ring-indigo-500">
            </div>
        `).join('');
        document.querySelectorAll('.in-cupo-grupo').forEach(inp => inp.addEventListener('input', actualizarRiesgo));
        actualizarRiesgo();
    }

    // ==========================================
    // CÁLCULOS EN VIVO (Ejemplares + Riesgo)
    // ==========================================
    function crearFilaCaballo(numSugerido = '', nomSugerido = '', valorSugerido = '') {
        const div = document.createElement('div');
        div.className = 'flex gap-2 items-center fila-caballo-config';
        div.innerHTML = `
            <input type="text" class="input-tbl w-16 text-center in-num-cab font-bold" value="${numSugerido}" placeholder="N°">
            <input type="text" class="input-tbl flex-1 in-nom-cab" value="${nomSugerido}" placeholder="Ejemplar">
            <input type="number" step="0.1" class="input-tbl w-24 text-center text-blue-700 font-bold in-valor-ej" value="${valorSugerido}" placeholder="Pts">
            <button type="button" class="text-red-400 hover:text-red-600 px-1 btn-quitar-cab"><i class="fas fa-trash-alt"></i></button>
        `;
        contenedorCaballos.appendChild(div);
        div.querySelector('.btn-quitar-cab').addEventListener('click', () => { div.remove(); calcularSumaBaseTotal(); });
        div.querySelector('.in-valor-ej').addEventListener('input', calcularSumaBaseTotal);
    }

    function calcularSumaBaseTotal() {
        let suma = 0;
        document.querySelectorAll('.in-valor-ej').forEach(input => { suma += parseFloat(input.value) || 0; });
        lblSumaBase.textContent = suma.toFixed(1);
        actualizarRiesgo();
    }

    function actualizarRiesgo() {
        const prem = parseFloat(premioTabla.value) || 0;
        let bs = 0, usd = 0;

        document.querySelectorAll('.in-cupo-grupo').forEach(inp => {
            const c = parseInt(inp.value) || 0;
            const g = gruposActivos.find(x => x.id == inp.dataset.grupo);
            const mon = g ? g.moneda : 'USD';
            const monto = c * prem;
            if (mon === 'VES') { bs += monto; usd += monto / (tasaCambioGlobal || 1); }
            else { usd += monto; bs += monto * (tasaCambioGlobal || 1); }
            const rg = inp.closest('[data-grupo]')?.querySelector('.riesgo-grupo');
            if (rg) rg.textContent = monto.toLocaleString(undefined, { minimumFractionDigits: 2 });
        });

        if (lblRiesgoBs) lblRiesgoBs.value = 'Bs ' + bs.toLocaleString(undefined, { minimumFractionDigits: 2 });
        if (lblRiesgoUsd) lblRiesgoUsd.value = '$ ' + usd.toLocaleString(undefined, { minimumFractionDigits: 2 });
        lblPremioPts.textContent = '$' + prem.toLocaleString(undefined, { minimumFractionDigits: 2 });

        const maxUsd = parseFloat(maxRiesgoUsd.value) || 0;
        const excede = maxUsd > 0 && usd > maxUsd;
        if (lblExcesoRiesgo) lblExcesoRiesgo.classList.toggle('hidden', !excede);
    }

    premioTabla.addEventListener('input', actualizarRiesgo);
    maxRiesgoUsd.addEventListener('input', actualizarRiesgo);
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
        const comisionGrupo = parseFloat(document.getElementById('comisionTabla').value) || 0;
        const sumaBaseTabla = parseFloat(lblSumaBase.textContent);

        if (!hipodromo || isNaN(carrera) || isNaN(premio) || premio <= 0 || sumaBaseTabla <= 0) {
            return clubUI.toast("Faltan campos obligatorios o la base de ponderación es cero.");
        }

        const cuposPorGrupo = [...document.querySelectorAll('.in-cupo-grupo')]
            .map(inp => ({ grupo_id: inp.dataset.grupo, cupos: parseInt(inp.value) || 0 }))
            .filter(x => x.cupos > 0);
        if (cuposPorGrupo.length === 0) return clubUI.toast("Asigne cupos a al menos un grupo.");

        // ===== TOPE ÚNICO A RIESGO (en $ o su equivalente en Bs vía tasa) =====
        const maxUsd = parseFloat(maxRiesgoUsd.value) || 0;
        if (maxUsd > 0) {
            let rUsd = 0;
            cuposPorGrupo.forEach(x => {
                const g = gruposActivos.find(gp => gp.id == x.grupo_id);
                const mon = g ? g.moneda : 'USD';
                const monto = x.cupos * premio;
                if (mon === 'VES') rUsd += monto / (tasaCambioGlobal || 1);
                else rUsd += monto;
            });
            if (rUsd > maxUsd) {
                return clubUI.toast(`Riesgo supera el tope único ($ ${rUsd.toLocaleString(undefined, {minimumFractionDigits:2})} equivalente). Ajuste cupos o premio.`);
            }
        }

        let caballosArr = [];
        document.querySelectorAll('.fila-caballo-config').forEach(fila => {
            const numero = fila.querySelector('.in-num-cab').value.trim();
            const nombre = fila.querySelector('.in-nom-cab').value.trim().toUpperCase();
            const valor = parseFloat(fila.querySelector('.in-valor-ej').value);
            if (numero && nombre && !isNaN(valor)) {
                caballosArr.push({ numero, nombre, valor_ejemplar: valor, retirado: false });
            }
        });
        if (caballosArr.length < 2) return clubUI.toast("Ingrese al menos 2 ejemplares.");

        const limiteTotal = cuposPorGrupo.reduce((a, b) => a + b.cupos, 0);
        const btnOrigText = btnGuardarTabla.innerHTML;
        btnGuardarTabla.innerHTML = 'Guardando...'; btnGuardarTabla.disabled = true;

        const { data: nueva, error } = await window.supabase.from('tablas_fijas').insert([{
            hipodromo, carrera, grupo_venta: 'GRUPOS', moneda: 'USD', tasa_cambio: tasaCambioGlobal,
            suma_base_tabla: sumaBaseTabla, limite_ventas: limiteTotal, cantidad_vendida: 0,
            premio_original: premio, premio_recalculado: premio,
            comision_grupo: comisionGrupo, caballos: caballosArr, estado: 'Abierta'
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
            calcularSumaBaseTotal(); cargarTablas();
            if (window.clubDB?.logAccion) window.clubDB.logAccion('TABLAS', `publicada: ${hipodromo} C${carrera} premio=$${premio} cupos=${limiteTotal} (id=${nueva.id})`);
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
                        <td class="p-2 font-bold">${t.hipodromo}<br><span class="text-blue-600">C${t.carrera}</span></td>
                        <td class="p-2">${chipsGrupos}</td>
                        <td class="p-2 text-right"><span class="text-blue-700 font-bold">$${parseFloat(t.premio_recalculado).toLocaleString()}</span></td>
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
        if (!confirm(`⚠️ ELIMINAR TABLA\n\n${t.hipodromo} C${t.carrera} — $${parseFloat(t.premio_recalculado).toLocaleString()}\n\nSe borrarán también sus cupos por grupo. Esta acción NO se puede deshacer.`)) return;

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

        const maxUsd = parseFloat(maxRiesgoUsd.value) || 0;
        if (maxUsd > 0) {
            let rUsd = 0;
            cuposInputs.forEach(inp => {
                if (inp.eliminar) return;
                const g = gruposActivos.find(gp => gp.id == inp.ngId);
                const mon = g ? g.moneda : 'USD';
                const monto = inp.cupo * premio;
                if (mon === 'VES') rUsd += monto / (tasaCambioGlobal || 1);
                else rUsd += monto;
            });
            if (rUsd > maxUsd) {
                return clubUI.toast(`La edición supera el tope único de riesgo ($ ${rUsd.toLocaleString(undefined, {minimumFractionDigits:2})} equivalente).`);
            }
        }

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
        document.getElementById('lblPremioRecalculado').textContent = Math.max(0, p).toFixed(2);
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
        document.getElementById('modalEditarGrupo').classList.add('hidden');
    }));

    document.getElementById('btnRecargarTablas').addEventListener('click', () => {
        cargarTasaGlobal(); cargarHipodromos(); cargarGrupos(); cargarTablas();
    });

    // Arranque
    cargarTasaGlobal();
    cargarHipodromos();
    cargarGrupos();
    cargarTablas();
    actualizarRiesgo();
});