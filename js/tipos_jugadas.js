document.addEventListener('DOMContentLoaded', () => {
    const formJugada = document.getElementById('formJugada');
    const tbody = document.getElementById('tablaJugadas');

    async function cargarJugadas() {
        const { data, error } = await window.supabase
            .from('tipos_jugadas')
            .select('*')
            .order('id', { ascending: true });

        if (error) {
            tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-red-500">Error al cargar reglas.</td></tr>';
            return;
        }

        tbody.innerHTML = '';
        data.forEach(j => {
            const badgeEstado = j.activo 
                ? '<span class="bg-green-100 text-green-700 px-2 py-1 rounded font-bold">Activo</span>'
                : '<span class="bg-red-100 text-red-700 px-2 py-1 rounded font-bold">Inactivo</span>';

            tbody.innerHTML += `
                <tr class="hover:bg-slate-50">
                    <td class="p-3 font-bold text-slate-900">${j.nombre}</td>
                    <td class="p-3 text-center font-medium text-purple-700">${j.base_comision}</td>
                    <td class="p-3 text-center font-medium text-blue-700">${j.modalidad_pago}</td>
                    <td class="p-3 text-center">${badgeEstado}</td>
                    <td class="p-3 text-center">
                        <button class="btn-toggle text-slate-500 hover:text-slate-800 transition-colors" data-id="${j.id}" data-activo="${j.activo}">
                            <i class="fas fa-power-off"></i>
                        </button>
                    </td>
                </tr>
            `;
        });

        document.querySelectorAll('.btn-toggle').forEach(btn => {
            btn.addEventListener('click', async function() {
                const id = this.getAttribute('data-id');
                const nuevoEstado = this.getAttribute('data-activo') === 'false';
                await window.supabase.from('tipos_jugadas').update({ activo: nuevoEstado }).eq('id', id);
                cargarJugadas();
            });
        });
    }

    formJugada.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
            nombre: document.getElementById('nombreJugada').value.trim().toUpperCase(),
            base_comision: document.getElementById('baseComision').value,
            modalidad_pago: document.getElementById('modPago').value,
            activo: true
        };

        const { error } = await window.supabase.from('tipos_jugadas').insert([payload]);
        
        if (error) {
            clubUI.toast(error.code === '23505' ? 'Esta modalidad ya existe.' : 'Error al guardar.');
        } else {
            formJugada.reset();
            cargarJugadas();
        }
    });

    cargarJugadas();
});