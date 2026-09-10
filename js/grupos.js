document.addEventListener('DOMContentLoaded', () => {

    let todosGrupos = [];
    let clientesTodos = [];
    let miembrosPorGrupo = {};      // { grupo_id: [cliente_id,...] } para pertenencias adicionales
    let tablasMultiGrupo = false;   // true si clientes_grupos existe

    // ==========================================
    // CARGA DE GRUPOS
    // ==========================================
    async function cargarGrupos() {
        const { data, error } = await window.supabase.from('grupos_venta').select('*').order('es_principal', { ascending: false });
        if (error) {
            if (error.status === 401 || /permission|row-level security/i.test(String(error.message || ''))) {
                return clubUI.toast('Permisos bloqueados (RLS). Ejecute en SQL: alter table public.grupos_venta disable row level security;', 'error');
            }
            return clubUI.toast('Error cargando grupos: ' + error.message, 'error');
        }
        todosGrupos = data || [];
        renderGruposGestion();
        renderSelectsGrupos();
        cargarClientesTodos();
    }

    function renderSelectsGrupos() {
        const activos = todosGrupos.filter(g => g.activo);
        const opts = activos.map(g => `<option value="${g.id}">${g.nombre} (${g.moneda})</option>`).join('');
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
                    <span class="text-[10px] text-slate-500">Cupos/tabla: <b>${g.cupo_tabla}</b> · Convenio Tablas Fijas: <b class="text-amber-600">${parseFloat(g.comision_default || 2.5)}%</b> · Clientes: <b id="cntgrupo_${g.id}">?</b></span>
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
    }

    // ==========================================
    // CREAR GRUPO (convenio de comisión)
    // ==========================================
    document.getElementById('formGrupo')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const nombre = document.getElementById('nombreGrupo').value.trim().toUpperCase();
        if (!nombre) return clubUI.toast('Indique el nombre del grupo.', 'warning');
        const { error } = await window.supabase.from('grupos_venta').insert([{
            nombre: nombre,
            moneda: document.getElementById('monedaGrupo').value,
            moneda_cuadre: document.getElementById('monedaCuadreGrupo').value,
            es_principal: document.getElementById('esPrincipalGrupo').checked,
            cupo_tabla: parseInt(document.getElementById('cupoGrupo').value) || 100,
            comision_default: parseFloat(document.getElementById('comisionGrupo').value) || 2.5,
            responsable: document.getElementById('responsableGrupo').value.trim().toUpperCase() || null,
            cuenta_bancaria: document.getElementById('cuentaGrupo').value.trim().toUpperCase() || null
        }]);
        if (error) {
            if (error.status === 401 || /permission|row-level security/i.test(String(error.message || ''))) {
                return clubUI.toast('Permisos bloqueados (RLS). Ejecute en SQL: alter table public.grupos_venta disable row level security;', 'error');
            }
            return clubUI.toast(error.code === '23505' ? 'Ese grupo ya existe.' : 'Error al crear el grupo.', 'error');
        }
        e.target.reset();
        document.getElementById('monedaGrupo').value = 'USD';
        document.getElementById('monedaCuadreGrupo').value = 'USD';
        document.getElementById('cupoGrupo').value = 100;
        document.getElementById('comisionGrupo').value = 2.5;
        cargarGrupos();
        if (window.clubDB?.logAccion) window.clubDB.logAccion('GRUPOS', `creado: ${nombre} comision=${document.getElementById('comisionGrupo').value || 2.5}`);
    });

    async function toggleGrupo(e) {
        const id = e.currentTarget.dataset.id;
        const nuevo = e.currentTarget.dataset.activo === 'false';
        await window.supabase.from('grupos_venta').update({ activo: nuevo }).eq('id', id);
        cargarGrupos();
        const g = todosGrupos.find(x => x.id == id);
        if (window.clubDB?.logAccion) window.clubDB.logAccion('GRUPOS', `grupo_${nuevo ? 'activado' : 'desactivado'}: ${g?.nombre}`);
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
        await window.supabase.from('clientes_grupos').delete().eq('grupo_id', id);
        await window.supabase.from('grupos_venta').delete().eq('id', id);
        cargarGrupos();
        if (window.clubDB?.logAccion) window.clubDB.logAccion('GRUPOS', `eliminado: ${g.nombre} (id=${id})`);
    }

    // ==========================================
    // EDITAR GRUPO
    // ==========================================
    function abrirModalEditarGrupo(e) {
        const g = todosGrupos.find(x => x.id == e.currentTarget.dataset.id);
        if (!g) return;
        document.getElementById('editGrupoId').value = g.id;
        document.getElementById('editGrupoNombre').value = g.nombre;
        document.getElementById('editGrupoMoneda').value = g.moneda || 'USD';
        document.getElementById('editGrupoMonedaCuadre').value = g.moneda_cuadre || 'USD';
        document.getElementById('editGrupoCupo').value = g.cupo_tabla || 100;
        document.getElementById('editGrupoComision').value = parseFloat(g.comision_default || 2.5);
        document.getElementById('editGrupoResponsable').value = g.responsable || '';
        document.getElementById('editGrupoCuenta').value = g.cuenta_bancaria || '';
        document.getElementById('editGrupoPrincipal').checked = !!g.es_principal;
        document.getElementById('modalEditarGrupo').classList.remove('hidden');
    }

    document.getElementById('btnGuardarGrupoEdit')?.addEventListener('click', async () => {
        const id = document.getElementById('editGrupoId').value;
        const g = todosGrupos.find(x => x.id == id);
        const nombre = document.getElementById('editGrupoNombre').value.trim().toUpperCase();
        const esPrincipal = document.getElementById('editGrupoPrincipal').checked;
        const { error } = await window.supabase.from('grupos_venta').update({
            nombre: nombre,
            moneda: document.getElementById('editGrupoMoneda').value,
            moneda_cuadre: document.getElementById('editGrupoMonedaCuadre').value,
            cupo_tabla: parseInt(document.getElementById('editGrupoCupo').value) || 100,
            comision_default: parseFloat(document.getElementById('editGrupoComision').value) || 2.5,
            responsable: document.getElementById('editGrupoResponsable').value.trim().toUpperCase() || null,
            cuenta_bancaria: document.getElementById('editGrupoCuenta').value.trim().toUpperCase() || null,
            es_principal: esPrincipal
        }).eq('id', id);
        if (error) return clubUI.toast('Error al guardar el grupo: ' + error.message, 'error');
        if (esPrincipal) {
            await window.supabase.from('grupos_venta').update({ es_principal: false }).neq('id', id).eq('es_principal', true);
        }
        document.getElementById('modalEditarGrupo').classList.add('hidden');
        cargarGrupos();
        if (window.clubDB?.logAccion) window.clubDB.logAccion('GRUPOS', `editado: ${g?.nombre} -> ${nombre} (id=${id})`);
    });

    document.querySelectorAll('.cerrar-modal').forEach(b => b.addEventListener('click', () => {
        document.getElementById('modalEditarGrupo').classList.add('hidden');
    }));

    // ==========================================
    // ASIGNACIÓN DE CLIENTES A GRUPOS
    // ==========================================
    async function cargarClientesTodos() {
        const { data } = await window.supabase.from('clientes').select('id, nombre, grupo_id').order('nombre');
        clientesTodos = data || [];
        miembrosPorGrupo = {};
        try {
            const { data: mem } = await window.supabase.from('clientes_grupos').select('grupo_id, cliente_id');
            if (!mem) { tablasMultiGrupo = false; }
            else {
                tablasMultiGrupo = true;
                mem.forEach(m => {
                    (miembrosPorGrupo[m.grupo_id] = miembrosPorGrupo[m.grupo_id] || []).push(m.cliente_id);
                });
            }
        } catch (err) {
            tablasMultiGrupo = false;
        }
        todosGrupos.forEach(g => {
            const cnt = document.getElementById('cntgrupo_' + g.id);
            if (cnt) {
                const principales = clientesTodos.filter(c => c.grupo_id === g.id);
                const extra = (miembrosPorGrupo[g.id] || []).filter(id => !principales.find(c => c.id === id));
                cnt.textContent = [...new Set(principales.map(c => c.id).concat(extra))].length;
            }
        });
        renderClientesGrupo();
    }

    function renderClientesGrupo() {
        const origen = document.getElementById('selectGrupoOrigen').value;
        const lnk = document.getElementById('quitarGpoDetalle');
        const cont = document.getElementById('listaClientesGrupo');
        const resumen = document.getElementById('resumenClientesGrupo');
        if (!origen) {
            cont.innerHTML = '<p class="text-slate-400 italic text-xs">Seleccione un grupo origen.</p>';
            resumen.textContent = '0';
            return;
        }
        const principales = clientesTodos.filter(c => c.grupo_id === origen);
        const extraIds = (miembrosPorGrupo[origen] || []).filter(id => !principales.find(c => c.id === id));
        const listaIds = [...new Set(principales.map(c => c.id).concat(extraIds))];
        resumen.textContent = listaIds.length;
        if (listaIds.length === 0) {
            cont.innerHTML = '<p class="text-slate-400 italic text-xs">No hay clientes en este grupo.</p>';
            return;
        }
        cont.innerHTML = listaIds.map(id => {
            const c = clientesTodos.find(x => x.id === id);
            const nombre = c ? c.nombre : 'Cliente';
            const principal = !!(c && c.grupo_id === origen);
            const etiqueta = tablasMultiGrupo && !principal ? ' <span class="text-[9px] font-black bg-cyan-100 text-cyan-700 px-1 py-0.5 rounded">adicional</span>' : ' <span class="text-[9px] font-black bg-slate-200 text-slate-700 px-1 py-0.5 rounded">principal</span>';
            return `
                <label class="flex items-center gap-2 bg-white border border-slate-200 rounded px-2 py-1.5 cursor-pointer text-sm">
                    <input type="checkbox" value="${id}" class="chk-cliente rounded">
                    <span class="font-semibold text-slate-700">${nombre}</span>${etiqueta}
                </label>`;
        }).join('');
    }

    ['selectGrupoOrigen', 'selectGrupoDestino'].forEach(id => {
        document.getElementById(id).addEventListener('change', renderClientesGrupo);
    });

    async function agregarClientesGrupo(ids, todos = false) {
        const destino = document.getElementById('selectGrupoDestino').value;
        const origen = document.getElementById('selectGrupoOrigen').value;
        let idsFinal = ids;
        if (todos) {
            idsFinal = clientesTodos.filter(c => c.grupo_id === origen).map(c => c.id)
                .concat(miembrosPorGrupo[origen] || []);
        }
        idsFinal = [...new Set(idsFinal)].filter(id => id != destino);
        if (!destino) return clubUI.toast("Seleccione el grupo destino.");
        if (idsFinal.length === 0) return clubUI.toast("No hay clientes marcados (o ya están en el destino).");

        if (tablasMultiGrupo) {
            const filas = idsFinal.map(id => ({
                cliente_id: id,
                grupo_id: destino,
                es_principal: false,
                activo: true
            }));
            // No duplicar pertenencias existentes (ni principales ni adicionales del destino)
            const principalesDestino = new Set(clientesTodos.filter(c => c.grupo_id === destino).map(c => c.id));
            const { data: existentes } = await window.supabase.from('clientes_grupos').select('cliente_id').eq('grupo_id', destino);
            const yaExisten = new Set((existentes || []).map(x => x.cliente_id));
            const nuevas = filas.filter(f => !yaExisten.has(f.cliente_id) && !principalesDestino.has(f.cliente_id));
            if (nuevas.length === 0) return clubUI.toast("Los marcados ya pertenecen al grupo destino.", 'warning');
            const { error } = await window.supabase.from('clientes_grupos').insert(nuevas);
            if (error) return clubUI.toast('Error al agregar: ' + error.message, 'error');
            if (window.clubDB?.logAccion) window.clubDB.logAccion('GRUPOS', `clientes_agregados: ${nuevas.length} al grupo ${destino}`);
        } else {
            // Fallback (sin clientes_grupos): se mueven como antes
            const { error } = await window.supabase.from('clientes').update({ grupo_id: destino }).in('id', idsFinal);
            if (error) return clubUI.toast('Error al mover clientes: ' + error.message, 'error');
            if (window.clubDB?.logAccion) window.clubDB.logAccion('GRUPOS', `clientes_movidos: ${idsFinal.length} al grupo ${destino} (fallback)`);
        }
        cargarClientesTodos();
        clubUI.toast(tablasMultiGrupo ? 'Clientes agregados al grupo destino como pertenencia adicional.' : 'Clientes movidos al grupo destino.', 'success');
    }

    async function quitarClientesGrupo(ids) {
        const origen = document.getElementById('selectGrupoOrigen').value;
        if (!origen || ids.length === 0) return clubUI.toast("Seleccione un grupo y clientes Marcados.");
        if (!tablasMultiGrupo) return clubUI.toast("No hay pertenencias adicionales en este esquema.", 'warning');
        try {
            const { data: mem } = await window.supabase.from('clientes_grupos').select('cliente_id').eq('grupo_id', origen);
            const extra = (mem || []).map(x => x.cliente_id);
            const aQuitar = ids.filter(id => extra.includes(id)); // solo pertenencias adicionales, nunca el principal
            if (aQuitar.length === 0) return clubUI.toast("Los marcados son clientes PRINCIPALES del grupo (no se quitan por aquí).", 'warning');
            const { error } = await window.supabase.from('clientes_grupos').delete().eq('grupo_id', origen).in('cliente_id', aQuitar);
            if (error) return clubUI.toast('Error al quitar: ' + error.message, 'error');
            if (window.clubDB?.logAccion) window.clubDB.logAccion('GRUPOS', `clientes_quitados: ${aQuitar.length} del grupo ${origen}`);
            cargarClientesTodos();
            clubUI.toast('Pertenencia adicional eliminada.', 'success');
        } catch (err) {
            return clubUI.toast('Tabla clientes_grupos no disponible.', 'warning');
        }
    }

    document.getElementById('btnMoverClientes').addEventListener('click', () => {
        const ids = [...document.querySelectorAll('.chk-cliente:checked')].map(c => c.value);
        agregarClientesGrupo(ids);
    });

    document.getElementById('btnMoverTodos').addEventListener('click', () => {
        agregarClientesGrupo([], true);
    });

    document.getElementById('btnQuitarClientesGrupo').addEventListener('click', () => {
        const ids = [...document.querySelectorAll('.chk-cliente:checked')].map(c => c.value);
        quitarClientesGrupo(ids);
    });

    document.getElementById('btnRecargarGrupos')?.addEventListener('click', () => cargarGrupos());

    // Arranque
    cargarGrupos();
});