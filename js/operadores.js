// Archivo: js/operadores.js
// Propósito: CRUD completo de operadores del sistema conectados a Supabase.

document.addEventListener('DOMContentLoaded', () => {

    const tabla = document.getElementById('tablaOperadores');
    const modal = document.getElementById('modalOperador');
    const form = document.getElementById('formOperador');
    const btnAbrir = document.getElementById('btnAbrirModalOperador');

    // ==========================================
    // 1. CARGAR LISTA DE OPERADORES
    // ==========================================
    async function cargarOperadores() {
        if(!tabla) return; // Si la tabla no existe en la vista, salir.

        tabla.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-slate-500">Cargando operadores...</td></tr>';
        
        // Uso estricto de window.supabase
        const { data, error } = await window.supabase.from('operadores').select('*').order('id', { ascending: true });

        if (error || !data || data.length === 0) {
            tabla.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-slate-500">No hay operadores registrados.</td></tr>';
            return;
        }

        tabla.innerHTML = '';
        data.forEach(op => {
            const fecha = op.fecha_registro ? new Date(op.fecha_registro).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : 'N/A';
            const badgeEstado = op.activo 
                ? '<span class="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded text-[10px] font-bold">ACTIVO</span>'
                : '<span class="bg-red-100 text-red-700 px-2 py-0.5 rounded text-[10px] font-bold">INACTIVO</span>';
            
            // Distintivo visual de administrador
            const badgeRol = op.rol.includes('Administrador') 
                ? `<span class="text-blue-600 font-bold"><i class="fas fa-crown text-[10px] mr-1"></i>${op.rol}</span>` 
                : `<span class="text-slate-600">${op.rol}</span>`;

            const btnEstadoTexto = op.activo ? 'Desactivar' : 'Activar';
            const btnEstadoClase = op.activo ? 'bg-amber-50 text-amber-600 border-amber-200 hover:bg-amber-500 hover:text-white' : 'bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-600 hover:text-white';

            tabla.innerHTML += `
                <tr class="hover:bg-slate-50 transition-colors">
                    <td class="p-3 font-bold text-slate-800">${op.nombre_completo}</td>
                    <td class="p-3 font-mono text-slate-600">@${op.usuario}</td>
                    <td class="p-3">${badgeRol}</td>
                    <td class="p-3 text-center">${badgeEstado}</td>
                    <td class="p-3 text-slate-500">${fecha}</td>
                    <td class="p-3 text-center flex gap-1 justify-center">
                        <button class="btn-toggle border px-2 py-1 rounded text-[11px] font-bold transition-colors ${btnEstadoClase}" data-id="${op.id}" data-estado="${op.activo}">${btnEstadoTexto}</button>
                        <button class="btn-eliminar border border-red-200 bg-red-50 text-red-600 hover:bg-red-600 hover:text-white px-2 py-1 rounded text-[11px] font-bold transition-colors" data-id="${op.id}"><i class="fas fa-trash-alt"></i></button>
                    </td>
                </tr>
            `;
        });

        asignarEventosAcciones();
    }

    // ==========================================
    // 2. CREAR / ACTUALIZAR OPERADOR
    // ==========================================
    if (form) {
        form.addEventListener('submit', async function(e) {
            e.preventDefault();

            const id = document.getElementById('opId').value;
            const payload = {
                nombre_completo: document.getElementById('opNombre').value.trim(),
                usuario: document.getElementById('opUsuario').value.trim(), // Se remueve toLowerCase() para respetar el nombre ingresado
                password: document.getElementById('opPassword').value.trim(),
                rol: document.getElementById('opRol').value
            };

            const btn = this.querySelector('button[type="submit"]');
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';
            btn.disabled = true;

            let error;
            if (id) {
                // Actualizar
                const res = await window.supabase.from('operadores').update(payload).eq('id', id);
                error = res.error;
            } else {
                // Insertar nuevo asegurando que por defecto nace activo
                payload.activo = true; 
                const res = await window.supabase.from('operadores').insert([payload]);
                error = res.error;
            }

            if (error) {
                alert(error.code === '23505' ? "El nombre de usuario ya existe. Elija otro." : "Error al guardar el operador.");
            } else {
                modal.classList.add('hidden');
                this.reset();
                document.getElementById('opId').value = '';
                cargarOperadores();
            }

            btn.innerHTML = '<i class="fas fa-save mr-1"></i> Guardar Operador';
            btn.disabled = false;
        });
    }

    // ==========================================
    // 3. ACCIONES DE FILA (Desactivar / Eliminar)
    // ==========================================
    function asignarEventosAcciones() {
        // Cambiar Estado (Activo / Inactivo)
        document.querySelectorAll('.btn-toggle').forEach(btn => {
            btn.addEventListener('click', async function() {
                const id = this.getAttribute('data-id');
                const estadoActual = this.getAttribute('data-estado') === 'true';
                
                await window.supabase.from('operadores').update({ activo: !estadoActual }).eq('id', id);
                cargarOperadores();
            });
        });

        // Eliminar Operador
        document.querySelectorAll('.btn-eliminar').forEach(btn => {
            btn.addEventListener('click', async function() {
                if (confirm("¿Está seguro que desea eliminar permanentemente este operador?")) {
                    const id = this.getAttribute('data-id');
                    await window.supabase.from('operadores').delete().eq('id', id);
                    cargarOperadores();
                }
            });
        });
    }

    // ==========================================
    // 4. CONTROL DE MODAL
    // ==========================================
    btnAbrir?.addEventListener('click', () => {
        form.reset();
        document.getElementById('opId').value = '';
        document.getElementById('modalTitulo').innerHTML = '<i class="fas fa-user-plus mr-2"></i> Registrar Nuevo Operador';
        modal.classList.remove('hidden');
    });

    document.querySelectorAll('.cerrar-modal').forEach(b => {
        b.addEventListener('click', () => modal.classList.add('hidden'));
    });

    // Arranque
    cargarOperadores();
});