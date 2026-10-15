document.addEventListener('DOMContentLoaded', () => {
    const formJugada = document.getElementById('formJugada');
    const tbody = document.getElementById('tablaJugadas');
    const btnCancelar = document.getElementById('btnCancelarEdicion');
    const tituloForm = document.getElementById('tituloFormJugada');
    let idEditando = null;

    async function cargarJugadas() {
        const { data, error } = await window.supabase
            .from('tipos_jugadas')
            .select('*')
            .order('nombre', { ascending: true });

        if (error) {
            tbody.innerHTML = '<tr><td colspan="7" class="p-4 text-center text-red-500">Error al cargar reglas: ' + error.message + '</td></tr>';
            return;
        }

        tbody.innerHTML = '';
        (data || []).forEach(j => {
            const badgeEstado = j.activo
                ? '<span class="bg-green-100 text-green-700 px-2 py-1 rounded font-bold">Activo</span>'
                : '<span class="bg-red-100 text-red-700 px-2 py-1 rounded font-bold">Inactivo</span>';
            const comision = (j.comision_porcentaje != null) ? `${j.comision_porcentaje}%` : (j.base_comision || '—');
            const calculo = (j.tipo_calculo || 'POR_UNIDAD') === 'POR_TABLA' ? 'Por Tabla' : 'Por Unidad';
            const premio = (j.premio_a_pagar != null) ? `${j.premio_a_pagar}×` : '—';
            const cruces = (j.permite_cruces === false) ? '<span class="text-slate-400">No</span>' : '<span class="text-blue-600 font-bold">Sí</span>';

            tbody.innerHTML += `
                <tr class="hover:bg-slate-50">
                    <td class="p-3 font-bold text-slate-900 uppercase">${j.nombre}</td>
                    <td class="p-3 text-center font-bold text-purple-700">${comision}</td>
                    <td class="p-3 text-center text-slate-600">${calculo}</td>
                    <td class="p-3 text-center font-bold text-emerald-600">${premio}</td>
                    <td class="p-3 text-center">${cruces}</td>
                    <td class="p-3 text-center">${badgeEstado}</td>
                    <td class="p-3 text-center whitespace-nowrap">
                        <button class="btn-editar text-blue-500 hover:text-blue-700 px-2 py-1 transition-colors" data-id="${j.id}"><i class="fas fa-pen"></i></button>
                        <button class="btn-toggle text-slate-400 hover:text-emerald-500 transition-colors px-2 py-1" data-id="${j.id}" data-nombre="${j.nombre}" data-activo="${j.activo}" title="Activar/Desactivar"><i class="fas fa-power-off"></i></button>
                        <button class="btn-eliminar text-red-400 hover:text-red-600 transition-colors px-2 py-1" data-id="${j.id}" data-nombre="${j.nombre}" title="Eliminar"><i class="fas fa-trash-alt"></i></button>
                    </td>
                </tr>
            `;
        });

        tbody.querySelectorAll('.btn-toggle').forEach(btn => {
            btn.addEventListener('click', async function() {
                const id = this.getAttribute('data-id');
                const nombre = this.getAttribute('data-nombre') || '?';
                const nuevoEstado = this.getAttribute('data-activo') === 'false';
                await window.supabase.from('tipos_jugadas').update({ activo: nuevoEstado }).eq('id', id);
                cargarJugadas();
                if (window.clubDB?.logAccion) window.clubDB.logAccion('TIPOS_JUGADAS', `jugada_${nuevoEstado ? 'activada' : 'desactivada'}: ${nombre} (id=${id})`);
            });
        });

        tbody.querySelectorAll('.btn-editar').forEach(btn => {
            btn.addEventListener('click', async function() {
                const { data: j } = await window.supabase.from('tipos_jugadas').select('*').eq('id', this.getAttribute('data-id')).single();
                if (!j) return;
                idEditando = j.id;
                tituloForm.textContent = `Editando: ${j.nombre}`;
                document.getElementById('jugadaId').value = j.id;
                document.getElementById('nombreJugada').value = j.nombre || '';
                document.getElementById('baseComisionPct').value = (j.comision_porcentaje != null) ? j.comision_porcentaje : (parseFloat(String(j.base_comision || '0').replace(/[^0-9.]/g, '')) || 5);
                document.getElementById('comisionBase').value = (j.comision_base || 'PREMIO');
                document.getElementById('tipoCalculo').value = (j.tipo_calculo || 'POR_UNIDAD');
                document.getElementById('premioPagar').value = (j.premio_a_pagar != null) ? j.premio_a_pagar : 1;
                document.getElementById('permiteCruces').checked = j.permite_cruces !== false;
                document.getElementById('jugadaActiva').checked = j.activo !== false;
                btnCancelar.classList.remove('hidden');
            });
        });

        tbody.querySelectorAll('.btn-eliminar').forEach(btn => {
            btn.addEventListener('click', async function() {
                const id = this.getAttribute('data-id');
                const nombre = this.getAttribute('data-nombre');
                if (!confirm(`Eliminar la jugada "${nombre}"?\nSi hay tickets usándola, la eliminación puede fallar.`)) return;
                const { error } = await window.supabase.from('tipos_jugadas').delete().eq('id', id);
                if (error) clubUI.toast('No se pudo eliminar: puede estar en uso.', 'error');
                else {
                    cargarJugadas();
                    if (window.clubDB?.logAccion) window.clubDB.logAccion('TIPOS_JUGADAS', `eliminada: ${nombre} (id=${id})`);
                }
            });
        });
    }

    formJugada.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
            nombre: document.getElementById('nombreJugada').value.trim().toUpperCase(),
            comision_porcentaje: parseFloat(document.getElementById('baseComisionPct').value) || 5,
            comision_base: document.getElementById('comisionBase').value,
            tipo_calculo: document.getElementById('tipoCalculo').value,
            premio_a_pagar: parseFloat(document.getElementById('premioPagar').value) || 1,
            permite_cruces: document.getElementById('permiteCruces').checked,
            activo: document.getElementById('jugadaActiva').checked
        };

        let error;
        if (idEditando) {
            ({ error } = await window.supabase.from('tipos_jugadas').update(payload).eq('id', idEditando));
        } else {
            // Conserva compatibilidad con la columna base_comision legada (texto)
            payload.base_comision = `${payload.comision_porcentaje}%`;
            ({ error } = await window.supabase.from('tipos_jugadas').insert([payload]));
        }

        if (error) {
            clubUI.toast(error.code === '23505' ? 'Esta jugada ya existe.' : 'Error al guardar.', 'error');
        } else {
            resetFormulario();
            cargarJugadas();
            if (window.clubDB?.logAccion) window.clubDB.logAccion('TIPOS_JUGADAS', `${idEditando ? 'editada' : 'creada'}: ${payload.nombre} com=${payload.comision_porcentaje}% calc=${payload.tipo_calculo} pago=${payload.premio_a_pagar}x cruces=${payload.permite_cruces}`);
        }
    });

    function resetFormulario() {
        idEditando = null;
        document.getElementById('jugadaId').value = '';
        formJugada.reset();
        document.getElementById('baseComisionPct').value = 5;
        document.getElementById('premioPagar').value = 1;
        document.getElementById('permiteCruces').checked = true;
        document.getElementById('jugadaActiva').checked = true;
        tituloForm.textContent = 'Registrar Jugada';
        btnCancelar.classList.add('hidden');
    }

    btnCancelar.addEventListener('click', resetFormulario);

    cargarJugadas();
});