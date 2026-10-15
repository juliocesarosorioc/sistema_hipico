// Archivo: js/operadores.js
// Propósito: CRUD real de operadores sobre la tabla `operadores` de Supabase.
// Requiere rol Administrador.

document.addEventListener('DOMContentLoaded', () => {
    if (!window.clubAuth || !window.clubAuth.requiereRol(['Administrador'])) return;

    const tbody = document.getElementById('tablaOperadores');
    const modal = document.getElementById('modalOperador');
    const modalTitulo = document.getElementById('modalTitulo');
    const form = document.getElementById('formOperador');
    const btnNuevo = document.getElementById('btnAbrirModalOperador');
    const btnCerrar = document.querySelectorAll('.cerrar-modal');

    const opId = document.getElementById('opId');
    const opNombre = document.getElementById('opNombre');
    const opUsuario = document.getElementById('opUsuario');
    const opPassword = document.getElementById('opPassword');
    const opRol = document.getElementById('opRol');

    let operadores = [];

    // ==========================================
    // CARGA Y RENDERIZADO
    // ==========================================
    async function cargarOperadores() {
        tbody.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-slate-500">Cargando operadores...</td></tr>';
        const { data, error } = await window.supabase
            .from('operadores')
            .select('*')
            .order('nombre_completo');

        if (error) {
            clubUI.toast('Error al cargar operadores: ' + error.message, 'error');
            return;
        }
        operadores = data || [];
        render();
    }

    function formatoFecha(valor) {
        if (!valor) return '—';
        const d = new Date(valor);
        return isNaN(d) ? '—' : d.toLocaleDateString('es-ES');
    }

    function render() {
        if (!operadores.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-slate-400 font-bold">Sin operadores registrados.</td></tr>';
            return;
        }

        tbody.innerHTML = operadores.map(op => `
            <tr class="hover:bg-slate-50 transition-colors">
                <td class="p-3 font-bold text-slate-800">${escapeHtml(op.nombre_completo || '')}</td>
                <td class="p-3">${escapeHtml(op.usuario || '')}</td>
                <td class="p-3">${escapeHtml(op.rol || '')}</td>
                <td class="p-3 text-center">
                    ${op.activo
                        ? '<span class="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full text-[10px] font-bold">ACTIVO</span>'
                        : '<span class="bg-red-100 text-red-600 px-2 py-0.5 rounded-full text-[10px] font-bold">INACTIVO</span>'}
                </td>
                <td class="p-3 text-slate-500">${formatoFecha(op.fecha_registro || op.created_at)}</td>
                <td class="p-3">
                    <div class="flex flex-wrap gap-1 justify-center">
                        <button class="btn-editar-op bg-blue-500 text-white px-2 py-1 rounded text-[10px] font-bold hover:bg-blue-600 shadow-sm"
                                data-id="${op.id}"><i class="fas fa-user-edit mr-1"></i>Editar</button>
                        <button class="btn-toggle-op ${op.activo ? 'bg-amber-500' : 'bg-emerald-500'} text-white px-2 py-1 rounded text-[10px] font-bold hover:opacity-80 shadow-sm"
                                data-id="${op.id}"><i class="fas ${op.activo ? 'fa-pause' : 'fa-play'} mr-1"></i>${op.activo ? 'Desactivar' : 'Activar'}</button>
                        <button class="btn-del-op bg-red-500 text-white px-2 py-1 rounded text-[10px] font-bold hover:bg-red-600 shadow-sm"
                                data-id="${op.id}"><i class="fas fa-trash mr-1"></i>Eliminar</button>
                    </div>
                </td>
            </tr>`).join('');
    }

    function escapeHtml(texto) {
        return String(texto).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    // ==========================================
    // MODAL NUEVO / EDITAR
    // ==========================================
    btnNuevo.addEventListener('click', () => {
        opId.value = '';
        form.reset();
        modalTitulo.innerHTML = '<i class="fas fa-user-plus mr-2"></i> Registrar Nuevo Operador';
        opPassword.required = true;
        opUsuario.disabled = false;
        modal.classList.remove('hidden');
    });

    btnCerrar.forEach(btn => btn.addEventListener('click', () => modal.classList.add('hidden')));

    tbody.addEventListener('click', (e) => {
        const btnEditar = e.target.closest('.btn-editar-op');
        const btnToggle = e.target.closest('.btn-toggle-op');
        const btnDel = e.target.closest('.btn-del-op');

        if (btnEditar) return abrirEditar(Number(btnEditar.dataset.id));
        if (btnToggle) return toggleActivo(Number(btnToggle.dataset.id));
        if (btnDel) return eliminarOperador(Number(btnDel.dataset.id));
    });

    function abrirEditar(id) {
        const op = operadores.find(o => o.id === id);
        if (!op) return;
        opId.value = op.id;
        opNombre.value = op.nombre_completo || '';
        opUsuario.value = op.usuario || '';
        opPassword.value = '';
        opRol.value = op.rol || 'Operador';
        opPassword.placeholder = 'Dejar en blanco para no cambiar';
        opPassword.required = false;
        opUsuario.disabled = true;
        modalTitulo.innerHTML = '<i class="fas fa-user-edit mr-2"></i> Editar Operador';
        modal.classList.remove('hidden');
    }

    // ==========================================
    // GUARDAR (INSERT / UPDATE)
    // ==========================================
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const nombre = opNombre.value.trim();
        const usuario = opUsuario.value.trim();
        const password = opPassword.value;
        const rol = opRol.value;
        const id = opId.value;

        if (id) {
            const updates = { nombre_completo: nombre, rol };
            if (password) updates.password = password;
            const { error } = await window.supabase.from('operadores').update(updates).eq('id', id);
            if (error) return clubUI.toast('Error al actualizar: ' + error.message, 'error');
            clubUI.toast('Operador actualizado correctamente.', 'success');
            window.clubDB?.logAccion('OPERADORES', `operador_actualizado: id=${id} usuario=${usuario}`);
        } else {
            if (!password) return clubUI.toast('La contraseña es obligatoria.', 'error');
            const { data, error } = await window.supabase.from('operadores').insert({
                nombre_completo: nombre,
                usuario,
                password,
                rol,
                activo: true,
                fecha_registro: new Date().toISOString()
            }).select().single();
            if (error) return clubUI.toast('Error al registrar: ' + error.message, 'error');
            clubUI.toast('Operador registrado correctamente.', 'success');
            window.clubDB?.logAccion('OPERADORES', `operador_creado: id=${data.id} usuario=${usuario}`);
        }

        modal.classList.add('hidden');
        cargarOperadores();
    });

    // ==========================================
    // ACTIVAR / DESACTIVAR
    // ==========================================
    async function toggleActivo(id) {
        const op = operadores.find(o => o.id === id);
        if (!op) return;
        if (!confirm(`¿${op.activo ? 'Desactivar' : 'Activar'} a ${op.usuario}?`)) return;
        const { error } = await window.supabase.from('operadores').update({ activo: !op.activo }).eq('id', id);
        if (error) return clubUI.toast('Error: ' + error.message, 'error');
        clubUI.toast(`Operador ${op.activo ? 'desactivado' : 'activado'}.`, 'success');
        window.clubDB?.logAccion('OPERADORES', `operador_${op.activo ? 'desactivado' : 'activado'}: id=${id}`);
        cargarOperadores();
    }

    // ==========================================
    // ELIMINAR
    // ==========================================
    async function eliminarOperador(id) {
        const op = operadores.find(o => o.id === id);
        if (!op) return;
        if (!confirm(`¿Eliminar permanentemente al operador "${op.usuario}"? No se puede deshacer.`)) return;
        const { error } = await window.supabase.from('operadores').delete().eq('id', id);
        if (error) return clubUI.toast('Error al eliminar: ' + error.message, 'error');
        clubUI.toast('Operador eliminado.', 'success');
        window.clubDB?.logAccion('OPERADORES', `operador_eliminado: id=${id} usuario=${op.usuario}`);
        cargarOperadores();
    }

    cargarOperadores();
});