document.addEventListener('DOMContentLoaded', () => {

    let todosGrupos = [];
    let clientesTodos = [];
    let miembrosPorGrupo = {};      // { grupo_id: [cliente_id,...] } para pertenencias adicionales
    let tablasMultiGrupo = false;   // true si clientes_grupos existe
    let tiposJugadasList = [];      // para convenios por tipo
    let conveniosGrupo = [];        // convenio_tipo_grupo del grupo seleccionado

    // ==========================================
    // SELECTOR UNIFORME DE BANCOS (catálogo BANCOS_VZLA)
    // ==========================================
    function poblarSelectoresBancos() {
        const opts = (clubUI.htmlOpcionesBancosVzla && clubUI.htmlOpcionesBancosVzla()) || '';
        ['bancoGrupo', 'editBancoGrupo'].forEach(id => {
            const sel = document.getElementById(id);
            if (sel) sel.innerHTML = '<option value="">Seleccione el banco...</option>' + opts;
        });
        ['numeroCuentaGrupo', 'editNumeroCuentaGrupo'].forEach(id => {
            const inp = document.getElementById(id);
            if (inp) {
                inp.setAttribute('maxlength', '20');
                inp.addEventListener('input', () => {
                    inp.value = clubUI.formatearCuenta(inp.value);
                });
            }
        });
    }

    // "0102 · BANCO DE VENEZUELA / N° 1234" -> { banco, numero }
    function desglosarCuenta(cuenta) {
        const t = String(cuenta || '').trim();
        if (!t) return { banco: '', numero: '' };
        const idx = t.indexOf('N°');
        const numero = idx === -1 ? '' : clubUI.formatearCuenta(t.slice(idx + 2));
        return { banco: idx === -1 ? t : t.slice(0, idx).replace(/\s*\/?\s*$/, ''), numero };
    }

    function componerCuenta(banco, numero) {
        const b = String(banco || '').trim();
        const n = clubUI.formatearCuenta(numero);
        if (!b) return null;
        return n ? `${b} / N° ${n}` : b;
    }

    function seleccionarBancoEn(sel, cuenta) {
        if (!sel) return;
        const { banco } = desglosarCuenta(cuenta);
        const value = Array.from(sel.options).some(o => o.value === banco) ? banco : (Array.from(sel.options).find(o => o.text === banco)?.value || '');
        sel.value = value || '';
    }

    // ==========================================
    // CARGA DE GRUPOS
    // ==========================================
    async function cargarGrupos() {
        let { data, error } = await window.supabase.from('grupos_venta').select('*').order('es_principal', { ascending: false });
        console.log('[grupos] SELECT grupos_venta ->', { data, error });
        const bloqueadoRLS = error && (error.status === 401 || /permission|row-level security/i.test(String(error.message || '')));
        if (bloqueadoRLS || (!error && data && data.length === 0)) {
            // RLS activo: el SELECT directo puede devolver [] SIN error (RLS filtra
            // filas silenciosamente) o rechazar con 401/permiso. En ambos casos la
            // RPC segura (security definer) lee los grupos aunque el anon no tenga
            // acceso directo a la tabla.
            const { data: viaRpc, error: errRpc } = await window.supabase.rpc('club_listar_grupos').catch(() => ({}));
            console.log('[grupos] Fallback club_listar_grupos ->', viaRpc, errRpc);
            if (Array.isArray(viaRpc) && viaRpc.length > 0) {
                data = viaRpc;
                error = null;
            } else {
                const rpcNoExiste = /Could not find the function|does not exist/i.test(String(errRpc?.message || ''));
                if (bloqueadoRLS || rpcNoExiste || (!error && data && data.length === 0)) {
                    return clubUI.aviso('Grupos no accesibles',
                        'El SELECT directo no devolvió datos y la RPC segura club_listar_grupos no está disponible.\n\n' +
                        'Ejecute el archivo SQL en Supabase (SQL Editor) y vuelva a entrar:\n' +
                        '1. Abra Diagnóstico → botón "Copiar SQL".\n' +
                        '2. Péguelo en el SQL Editor de https://supabase.com/dashboard.\n' +
                        '3. Ejecute y luego recargue esta página (F5).',
                        'error');
                }
            }
        } else if (error) {
            return clubUI.toast('Error cargando grupos: ' + error.message, 'error');
        }
        todosGrupos = data || [];
        renderEstadisticas();
        renderGruposGestion();
        renderSelectsGrupos();
        cargarClientesTodos();
        return todosGrupos;
    }

    function renderEstadisticas() {
        const total = document.getElementById('statTotalGrupos');
        const activos = document.getElementById('statActivos');
        if (total) total.textContent = todosGrupos.length;
        if (activos) activos.textContent = todosGrupos.filter(g => g.activo).length;
    }

    function renderSelectsGrupos() {
        const activos = todosGrupos.filter(g => g.activo);
        const opts = activos.map(g => `<option value="${g.id}">${g.nombre} (${g.moneda})</option>`).join('');
        document.getElementById('selectGrupoOrigen').innerHTML = '<option value="">Seleccione...</option>' + opts;
        document.getElementById('selectGrupoDestino').innerHTML = '<option value="">Seleccione...</option>' + opts;
        const selConvenio = document.getElementById('selectConvenioGrupo');
        if (selConvenio) {
            const selActual = selConvenio.value;
            selConvenio.innerHTML = '<option value="">Seleccione un grupo...</option>' + opts;
            if (selActual && todosGrupos.some(g => g.id == selActual)) selConvenio.value = selActual;
        }
    }

    function renderGruposGestion() {
        const cont = document.getElementById('listaGrupos');
        const filtro = (document.getElementById('buscarGrupo')?.value || '').trim().toUpperCase();
        const visibles = todosGrupos.filter(g => !filtro || g.nombre.toUpperCase().includes(filtro));
        if (visibles.length === 0) {
            cont.innerHTML = todosGrupos.length === 0
                ? '<p class="text-slate-400 italic text-xs">Sin grupos. Cree el primero.</p>'
                : '<p class="text-slate-400 italic text-xs">Ningún grupo coincide con la búsqueda.</p>';
            return;
        }
        cont.innerHTML = visibles.map(g => `
            <div class="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2" data-id="${g.id}">
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
        const btnGuardar = document.getElementById('btnGuardarGrupo');
        const textoBtn = btnGuardar.innerHTML;
        btnGuardar.disabled = true;
        btnGuardar.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Guardando...';
        try {
            const nombre = document.getElementById('nombreGrupo').value.trim().toUpperCase();
            if (!nombre) return clubUI.toast('Indique el nombre del grupo.', 'warning');
            const moneda = document.getElementById('monedaGrupo').value;
            const cupo = parseInt(document.getElementById('cupoGrupo').value) || 100;
            const comisionLeida = parseFloat(document.getElementById('comisionGrupo').value);
            const comision = isNaN(comisionLeida) ? 2.5 : comisionLeida;
            const principal = document.getElementById('esPrincipalGrupo').checked;
            const cuenta = componerCuenta(document.getElementById('bancoGrupo').value, document.getElementById('numeroCuentaGrupo').value);
            const datos = {
                nombre: nombre,
                moneda: moneda,
                moneda_cuadre: document.getElementById('monedaCuadreGrupo').value,
                es_principal: principal,
                cupo_tabla: cupo,
                comision_default: comision,
                responsable: document.getElementById('responsableGrupo').value.trim().toUpperCase() || null,
                cuenta_bancaria: cuenta
            };
            let error;
            const conTimeout = (p, ms = 20000) => Promise.race([
                p,
                new Promise((_, rej) => setTimeout(() => rej(new Error('La consulta a Supabase se quedó colgada (timeout 20s).')), ms))
            ]);
            try {
                ({ error: error } = await conTimeout(window.supabase.from('grupos_venta').insert([{ ...datos, activo: true }])));
            } catch (errConexion) {
                error = { message: errConexion.message || String(errConexion), code: 'TIMEOUT' };
            }
            if (error && (error.status === 401 || /permission|row-level security/i.test(String(error.message || '')))) {
                // RLS activo: la RPC segura crea el grupo como dueño de la tabla.
                try {
                    const rpcRes = await conTimeout(window.supabase.rpc('club_guardar_grupo', { p_datos: datos }));
                    error = rpcRes.error;
                    if (error && /Could not find the function/i.test(String(error.message || ''))) {
                        error = { status: 401, message: 'Permisos bloqueados (RLS) y la RPC club_guardar_grupo no existe. Ejecute el paquete_pendientes.sql completo en Supabase.' };
                    }
                } catch (errRpc) {
                    error = { message: errRpc.message || String(errRpc), code: 'TIMEOUT' };
                }
            }
            if (error) {
                if (error.status === 401 || /permission|row-level security/i.test(String(error.message || ''))) {
                    return clubUI.toast('Permisos bloqueados (RLS). Ejecute en SQL: alter table public.grupos_venta disable row level security;', 'error');
                }
                if (/número de cuenta inválido/i.test(String(error.message || ''))) {
                    return clubUI.toast(error.message, 'error');
                }
                return clubUI.toast(error.code === '23505' ? 'Ese grupo ya existe.' : 'Error al crear el grupo: ' + (error.message || error.details || error.code), 'error');
            }
            e.target.reset();
            document.getElementById('monedaGrupo').value = 'USD';
            document.getElementById('monedaCuadreGrupo').value = 'USD';
            document.getElementById('cupoGrupo').value = 100;
            document.getElementById('comisionGrupo').value = 2.5;
            document.getElementById('bancoGrupo').value = '';
            document.getElementById('numeroCuentaGrupo').value = '';
            await cargarGrupos();
            if (window.clubDB?.logAccion) window.clubDB.logAccion('GRUPOS', `creado: ${nombre} comision=${comision}`);
            // Resalta el grupo recién creado en la lista para confirmación visual.
            const tarjeta = [...document.querySelectorAll('#listaGrupos [data-id]')].find(el =>
                todosGrupos.find(g => String(g.id) === el.dataset.id)?.nombre === nombre);
            if (tarjeta) {
                tarjeta.classList.add('ring-2', 'ring-amber-400', 'bg-amber-50');
                tarjeta.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                setTimeout(() => tarjeta.classList.remove('ring-2', 'ring-amber-400', 'bg-amber-50'), 2500);
            }
            clubUI.aviso('Grupo creado',
                `Grupo "${nombre}" registrado y listo para vender.\n\n` +
                `· Moneda de venta: ${moneda}\n` +
                `· Cupos por tabla: ${cupo}\n` +
                `· Convenio tablas fijas: ${comision}%\n` +
                `${principal ? '· Marcado como PRINCIPAL' : ''}`,
                'success');
        } catch (errInesperado) {
            console.error('[grupos] Error inesperado creando grupo:', errInesperado);
            clubUI.toast('Error inesperado: ' + (errInesperado?.message || errInesperado), 'error');
        } finally {
            btnGuardar.disabled = false;
            btnGuardar.innerHTML = textoBtn;
        }
    });

    async function toggleGrupo(e) {
        const id = e.currentTarget.dataset.id;
        const nuevo = e.currentTarget.dataset.activo === 'false';
        let { error } = await window.supabase.from('grupos_venta').update({ activo: nuevo }).eq('id', id);
        if (error && (error.status === 401 || /permission|row-level security/i.test(String(error.message || '')))) {
            ({ error: error } = await window.supabase.rpc('club_toggle_grupo', { p_id: id, p_activo: nuevo }).catch(() => ({})));
        }
        if (error && (error.status === 401 || /permission|row-level security/i.test(String(error.message || '')))) {
            return clubUI.toast('Permisos bloqueados (RLS). Ejecute en SQL: alter table public.grupos_venta disable row level security;', 'error');
        }
        const g = todosGrupos.find(x => x.id == id);
        cargarGrupos();
        if (window.clubDB?.logAccion) window.clubDB.logAccion('GRUPOS', `grupo_${nuevo ? 'activado' : 'desactivado'}: ${g?.nombre}`);
        clubUI.aviso(`Grupo ${nuevo ? 'activado' : 'desactivado'}`,
            `El grupo "${g?.nombre}" ahora está ${nuevo ? 'ACTIVO y disponible para vender' : 'DESACTIVADO y oculto en las opciones de venta'}.`,
            nuevo ? 'success' : 'warning');
    }

    async function eliminarGrupo(e) {
        const id = e.currentTarget.dataset.id;
        const g = todosGrupos.find(x => x.id == id);
        if (!g) return;
        if (!confirm(`Eliminar el grupo "${g.nombre}"?\nSus clientes pasarán al grupo PRINCIPAL y se perderá su inventario de tablas.`)) return;
        const principal = todosGrupos.find(x => x.es_principal);
        let blocked = false;
        if (principal && principal.id != id) {
            let { error } = await window.supabase.from('clientes').update({ grupo_id: principal.id }).eq('grupo_id', id);
            if (error && (error.status === 401 || /permission|row-level security/i.test(String(error.message || '')))) blocked = true;
        }
        if (!blocked) {
            let { error } = await window.supabase.from('clientes_grupos').delete().eq('grupo_id', id);
            if (error && (error.status === 401 || /permission|row-level security/i.test(String(error.message || '')))) blocked = true;
        }
        if (!blocked) {
            let { error } = await window.supabase.from('grupos_venta').delete().eq('id', id);
            if (error && (error.status === 401 || /permission|row-level security/i.test(String(error.message || '')))) blocked = true;
        }
        if (blocked) {
            const { error: errRpc } = await window.supabase.rpc('club_eliminar_grupo', { p_id: id }).catch(() => ({}));
            if (errRpc && (errRpc.status === 401 || /permission|row-level security/i.test(String(errRpc.message || '')))) {
                return clubUI.toast('Permisos bloqueados (RLS). Ejecute en SQL: alter table public.grupos_venta disable row level security;', 'error');
            }
            if (errRpc) return clubUI.toast('Error al eliminar el grupo: ' + (errRpc.message || errRpc), 'error');
        }
        cargarGrupos();
        if (window.clubDB?.logAccion) window.clubDB.logAccion('GRUPOS', `eliminado: ${g.nombre} (id=${id})`);
        clubUI.aviso('Grupo eliminado', `El grupo "${g.nombre}" fue eliminado. Sus clientes fueron movidos al grupo principal.`, 'warning');
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
        const { banco, numero } = desglosarCuenta(g.cuenta_bancaria);
        seleccionarBancoEn(document.getElementById('editBancoGrupo'), banco);
        document.getElementById('editNumeroCuentaGrupo').value = numero || '';
        document.getElementById('editGrupoPrincipal').checked = !!g.es_principal;
        document.getElementById('modalEditarGrupo').classList.remove('hidden');
    }

    document.getElementById('btnGuardarGrupoEdit')?.addEventListener('click', async () => {
        const id = document.getElementById('editGrupoId').value;
        const g = todosGrupos.find(x => x.id == id);
        const nombre = document.getElementById('editGrupoNombre').value.trim().toUpperCase();
        const esPrincipal = document.getElementById('editGrupoPrincipal').checked;
        const comisionEditLeida = parseFloat(document.getElementById('editGrupoComision').value);
        const comisionEdit = isNaN(comisionEditLeida) ? 2.5 : comisionEditLeida;
        const cuenta = componerCuenta(document.getElementById('editBancoGrupo').value, document.getElementById('editNumeroCuentaGrupo').value);
        const datos = {
            nombre: nombre,
            moneda: document.getElementById('editGrupoMoneda').value,
            moneda_cuadre: document.getElementById('editGrupoMonedaCuadre').value,
            cupo_tabla: parseInt(document.getElementById('editGrupoCupo').value) || 100,
            comision_default: comisionEdit,
            responsable: document.getElementById('editGrupoResponsable').value.trim().toUpperCase() || null,
            cuenta_bancaria: cuenta,
            es_principal: esPrincipal
        };
        let { error } = await window.supabase.from('grupos_venta').update(datos).eq('id', id);
        if (error && (error.status === 401 || /permission|row-level security/i.test(String(error.message || '')))) {
            // RLS activo: la RPC segura actualiza como dueño de la tabla.
            ({ error: error } = await window.supabase.rpc('club_actualizar_grupo', { p_id: id, p_datos: datos }).catch(() => ({})));
        }
        if (error) {
            if (error.status === 401 || /permission|row-level security/i.test(String(error.message || ''))) {
                return clubUI.toast('Permisos bloqueados (RLS). Ejecute en SQL: alter table public.grupos_venta disable row level security;', 'error');
            }
            if (/número de cuenta inválido/i.test(String(error.message || ''))) {
                return clubUI.toast(error.message, 'error');
            }
            return clubUI.toast('Error al guardar el grupo: ' + error.message, 'error');
        }
        if (esPrincipal) {
            await window.supabase.from('grupos_venta').update({ es_principal: false }).neq('id', id).eq('es_principal', true);
        }
        document.getElementById('modalEditarGrupo').classList.add('hidden');
        cargarGrupos();
        if (window.clubDB?.logAccion) window.clubDB.logAccion('GRUPOS', `editado: ${g?.nombre} -> ${nombre} (id=${id})`);
        clubUI.aviso('Grupo actualizado',
            `Cambios guardados en "${nombre}".\n\n` +
            `· Moneda venta: ${document.getElementById('editGrupoMoneda').value}\n` +
            `· Cupos por tabla: ${document.getElementById('editGrupoCupo').value || 100}\n` +
            `· Convenio tablas fijas: ${comisionEdit}%\n` +
            `${esPrincipal ? '· Ahora es el PRINCIPAL del sistema' : ''}`,
            'success');
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
            const grupoDestino = todosGrupos.find(x => x.id == destino);
            clubUI.aviso('Clientes agregados', `${nuevas.length} cliente(s) fue(fueron) agregado(s) como pertenencia adicional al grupo "${grupoDestino?.nombre}".`, 'success');
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
            const grupoOrigen = todosGrupos.find(x => x.id == origen);
            clubUI.aviso('Clientes quitados', `${aQuitar.length} pertenencia(s) adicional(es) eliminada(s) del grupo "${grupoOrigen?.nombre}".`, 'success');
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

    // ==========================================
    // CONVENIOS POR TIPO DE JUGADA Y GRUPO
    // ==========================================
    async function cargarTiposJugadas() {
        try {
            const { data, error } = await window.supabase.from('tipos_jugadas').select('*').eq('activo', true).order('nombre');
            if (error) throw error;
            tiposJugadasList = data || [];
        } catch (e) {
            tiposJugadasList = [];
            clubUI.toast('No se pudieron cargar los tipos de jugada: ' + (e?.message || e), 'warning');
        }
    }

    async function cargarConvenios(grupoId) {
        const lista = document.getElementById('listaConvenios');
        if (!grupoId) {
            lista.innerHTML = '<p class="text-slate-400 italic text-xs">Seleccione un grupo para ver sus convenios.</p>';
            conveniosGrupo = [];
            return;
        }
        if (!tiposJugadasList.length) await cargarTiposJugadas();
        try {
            const { data, error } = await window.supabase.from('convenio_tipo_grupo').select('*').eq('grupo_id', grupoId);
            if (error) {
                if (error.code === 'PGRST205' || /relation .* does not exist/i.test(String(error.message || ''))) {
                    lista.innerHTML = '<p class="text-slate-400 italic text-xs">Falta la tabla <b>convenio_tipo_grupo</b>. Ejecute el nuevo SQL del paquete de pendientes.</p>';
                    conveniosGrupo = [];
                    return;
                }
                throw error;
            }
            conveniosGrupo = data || [];
        } catch (err) {
            conveniosGrupo = [];
            return clubUI.toast('Error al cargar convenios: ' + (err?.message || err), 'error');
        }
        renderConvenios(grupoId);
    }

    // res alta => marca LUGAR/RANKING (win/place/show); con multiplicador => WIN/PLACE/SHOW base
    const ETIQUETA_TIPO = (nombre) => {
        const n = String(nombre || '').toUpperCase();
        if (/TABLA/.test(n)) return 'comisión por tablas fijas';
        if (/WIN|GANADOR|GANANCIA/.test(n)) return 'win · ganador';
        if (/PLACE|LUGAR/.test(n)) return 'place · 1.º/2.º';
        if (/SHOW|MOSTRAR/.test(n)) return 'show · 1.º/2.º/3.º';
        if (/PUESTOS|EXACTA|PERFECTA/.test(n)) return 'puestos · exacta';
        if (/MARCAS|TRIFECTA/.test(n)) return 'marcas · trifecta';
        return 'comisión por ticket';
    };

    function renderConvenios(grupoId) {
        const lista = document.getElementById('listaConvenios');
        if (!tiposJugadasList.length) {
            lista.innerHTML = '<p class="text-slate-400 italic text-xs">No hay tipos de jugada activos.</p>';
            return;
        }
        lista.innerHTML = tiposJugadasList.map(t => {
            const c = conveniosGrupo.find(x => x.tipo_jugada_id === t.id) || {};
            const esTabla = /TABLA/i.test(t.nombre || '');
            const comision = c.comision != null ? c.comision : (esTabla ? '' : '');
            return `
                <div class="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-2 py-1.5" data-conv-tipo="${t.id}">
                    <div class="flex-1 min-w-0">
                        <span class="font-bold text-slate-700 text-xs uppercase">${t.nombre}</span>
                        <span class="block text-[9px] text-slate-400 truncate">${ETIQUETA_TIPO(t.nombre)}</span>
                    </div>
                    <div class="flex items-center gap-1 shrink-0">
                        <label class="text-[9px] font-black text-slate-500 uppercase">%</label>
                        <input type="number" step="0.01" min="0" class="conv-comision w-14 border border-slate-300 rounded px-1 py-0.5 text-right text-[11px] font-bold text-amber-700 outline-none focus:ring-1 focus:ring-amber-400" data-conv-tipo="${t.id}" value="${comision}" placeholder="${esTabla ? 'grupo' : '0'}">
                        <label class="text-[9px] font-black text-slate-500 uppercase ml-1">Base $</label>
                        <input type="number" step="0.01" min="0" class="conv-base w-14 border border-slate-300 rounded px-1 py-0.5 text-right text-[11px] font-bold text-slate-700 outline-none focus:ring-1 focus:ring-amber-400" data-conv-tipo="${t.id}" value="${c.comision_base ?? ''}" placeholder="0">
                        <label class="flex items-center gap-1 ml-1 cursor-pointer" title="Permite cruces / combinaciones en este tipo">
                            <input type="checkbox" class="conv-cruces" data-conv-tipo="${t.id}" ${c.permite_cruces === false ? '' : 'checked'}>
                            <span class="text-[9px] font-black text-slate-500 uppercase">Cruces</span>
                        </label>
                    </div>
                </div>`;
        }).join('');
    }

    document.getElementById('selectConvenioGrupo')?.addEventListener('change', (e) => {
        cargarConvenios(e.target.value);
    });

    document.getElementById('btnGuardarConvenios')?.addEventListener('click', async () => {
        const grupoId = document.getElementById('selectConvenioGrupo').value;
        if (!grupoId) return clubUI.toast('Seleccione el grupo para guardar sus convenios.', 'warning');
        if (!tiposJugadasList.length) return clubUI.toast('No hay tipos de jugada activos.', 'warning');
        const filas = tiposJugadasList.map(t => {
            const fila = { tipo_jugada_id: t.id, grupo_id: grupoId };
            const inpCom = document.querySelector(`.conv-comision[data-conv-tipo="${t.id}"]`);
            const inpBase = document.querySelector(`.conv-base[data-conv-tipo="${t.id}"]`);
            const chkCruces = document.querySelector(`.conv-cruces[data-conv-tipo="${t.id}"]`);
            const com = inpCom ? parseFloat(inpCom.value) : null;
            const base = inpBase ? parseFloat(inpBase.value) : null;
            fila.comision = (com && com > 0) ? com : 0;
            fila.comision_base = (base && base > 0) ? base : 0;
            fila.permite_cruces = chkCruces ? chkCruces.checked : true;
            return fila;
        });
        try {
            const { error } = await window.supabase.from('convenio_tipo_grupo').upsert(filas, { onConflict: 'tipo_jugada_id,grupo_id' });
            if (error) throw error;
            conveniosGrupo = filas;
            clubUI.aviso('Convenios guardados', `Se actualizaron ${filas.length} convenio(s) para el grupo seleccionado, con su % de comisión, base $ y permiso de cruces por tipo de jugada.`, 'success');
            if (window.clubDB?.logAccion) window.clubDB.logAccion('GRUPOS', `convenios_tipo_grupo: ${filas.length} filas (grupo=${grupoId})`);
        } catch (err) {
            if (err?.code === 'PGRST205' || /relation .* does not exist/i.test(String(err?.message || ''))) {
                return clubUI.toast('Falta la tabla convenio_tipo_grupo. Ejecute el nuevo SQL del paquete de pendientes.', 'error');
            }
            return clubUI.toast('Error al guardar convenios: ' + (err?.message || err), 'error');
        }
    });

    document.getElementById('btnRecargarGrupos')?.addEventListener('click', () => cargarGrupos());

    const buscarGrupo = document.getElementById('buscarGrupo');
    if (buscarGrupo) {
        buscarGrupo.addEventListener('input', () => renderGruposGestion());
    }

    // Arranque
    poblarSelectoresBancos();
    cargarTiposJugadas();
    cargarGrupos();
});