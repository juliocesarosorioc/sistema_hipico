// Archivo: js/hipodromos.js
// Gestión de hipódromos: CREATE/READ/UPDATE/DELETE ordenados alfabéticamente,
// con país y estado. Los hipódromos de VE y USA vienen sembrados por el SQL (sección 8).

document.addEventListener('DOMContentLoaded', () => {

    const formHipodromo = document.getElementById('formHipodromo');
    const inputNombre = document.getElementById('nombreHipodromo');
    const selectPais = document.getElementById('paisHipodromo');
    const buscador = document.getElementById('buscadorHipodromos');
    const cuerpoTabla = document.getElementById('cuerpoTablaHipodromos');
    const modal = document.getElementById('modalHipodromo');
    const btnGuardarModal = document.getElementById('btnGuardarHipodromo');

    let hipodromosData = [];

    const PAIS_LABEL = {
        VE: '🇻🇪 VE', USA: '🇺🇸 USA', PA: '🇵🇦 PA', MX: '🇲🇽 MX', AR: '🇦🇷 AR',
        BR: '🇧🇷 BR', CL: '🇨🇱 CL', PE: '🇵🇪 PE', CO: '🇨🇴 CO', EC: '🇪🇨 EC',
        UY: '🇺🇾 UY', OTRO: '🌎 OTRO'
    };

    async function cargarHipodromos() {
        cuerpoTabla.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-slate-500">Cargando catálogo...</td></tr>';

        const { data, error } = await window.supabase
            .from('hipodromos')
            .select('*')
            .order('nombre', { ascending: true });

        if (error) {
            cuerpoTabla.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-red-500">Error al cargar el catálogo: ' + error.message + '</td></tr>';
            return;
        }

        hipodromosData = data || [];
        renderizarTabla(hipodromosData);
    }

    function renderizarTabla(datos) {
        if (datos.length === 0) {
            cuerpoTabla.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-slate-500 bg-slate-50">No hay hipódromos registrados todavía.</td></tr>';
            return;
        }

        cuerpoTabla.innerHTML = datos.map(h => {
            const fecha = h.fecha_creacion ? new Date(h.fecha_creacion).toLocaleDateString('es-ES') : '—';
            const estadoBadge = (h.estado || 'Activo') === 'Activo'
                ? '<span class="bg-emerald-600 text-white px-2 py-1 rounded font-bold text-[10px] uppercase">Activo</span>'
                : '<span class="bg-slate-500 text-white px-2 py-1 rounded font-bold text-[10px] uppercase">Inactivo</span>';
            const pais = (h.pais || 'OTRO').toUpperCase();
            return `
                <tr class="hover:bg-purple-50/40 transition-colors">
                    <td class="p-3 font-bold text-slate-800 uppercase">${h.nombre}</td>
                    <td class="p-3 text-center font-bold text-[11px]">${PAIS_LABEL[pais] || h.pais}</td>
                    <td class="p-3 text-slate-500 text-xs">${fecha}</td>
                    <td class="p-3 text-center">${estadoBadge}</td>
                    <td class="p-3 text-center whitespace-nowrap">
                        <button class="btn-editar border border-blue-300 text-blue-500 hover:bg-blue-50 hover:text-blue-700 px-3 py-1 rounded text-xs transition-colors shadow-sm mr-1" data-id="${h.id}" data-nombre="${h.nombre}" data-pais="${pais}" data-estado="${h.estado || 'Activo'}">
                            <i class="fas fa-pen mr-1"></i> Editar
                        </button>
                        <button class="btn-eliminar border border-red-300 text-red-500 hover:bg-red-50 hover:text-red-700 px-3 py-1 rounded text-xs transition-colors shadow-sm" data-id="${h.id}" data-nombre="${h.nombre}">
                            <i class="fas fa-trash-alt mr-1"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    if (formHipodromo) {
        formHipodromo.addEventListener('submit', async function(e) {
            e.preventDefault();

            const nombre = inputNombre.value.trim().toUpperCase();
            if (!nombre) return;
            const pais = selectPais.value;

            const btn = this.querySelector('button[type="submit"]');
            const btnOriginal = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Guardando...';
            btn.disabled = true;

            const { error } = await window.supabase.from('hipodromos').insert([{ nombre, pais }]);

            if (error) {
                if (error.code === '23505') clubUI.toast(`El hipódromo "${nombre}" ya existe en el catálogo.`, 'warning');
                else clubUI.toast('Ocurrió un error al registrar el hipódromo.', 'error');
            } else {
                this.reset();
                cargarHipodromos();
                if (window.clubDB?.logAccion) window.clubDB.logAccion('HIPODROMOS', `creado: ${nombre} (${pais})`);
            }

            btn.innerHTML = btnOriginal;
            btn.disabled = false;
        });
    }

    function abrirModal(h = {}) {
        document.getElementById('editarHipodromoId').value = h.id || '';
        document.getElementById('editarHipodromoNombre').value = h.nombre || '';
        document.getElementById('editarHipodromoPais').value = (h.pais || 'OTRO').toUpperCase();
        document.getElementById('editarHipodromoEstado').value = h.estado || 'Activo';
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }

    function cerrarModal() {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }

    document.querySelector('.btn-cerrar-modal')?.addEventListener('click', cerrarModal);
    modal?.addEventListener('click', (e) => { if (e.target === modal) cerrarModal(); });

    btnGuardarModal?.addEventListener('click', async () => {
        const id = document.getElementById('editarHipodromoId').value;
        const nombre = document.getElementById('editarHipodromoNombre').value.trim().toUpperCase();
        const pais = document.getElementById('editarHipodromoPais').value;
        const estado = document.getElementById('editarHipodromoEstado').value;
        if (!id || !nombre) return;

        btnGuardarModal.disabled = true;
        const { error } = await window.supabase.from('hipodromos')
            .update({ nombre, pais, estado })
            .eq('id', id);
        btnGuardarModal.disabled = false;

        if (error) {
            clubUI.toast(error.code === '23505' ? 'Ya existe un hipódromo con ese nombre.' : 'Error al editar.', 'error');
            return;
        }
        cargarHipodromos();
        cerrarModal();
        if (window.clubDB?.logAccion) window.clubDB.logAccion('HIPODROMOS', `editado: ${nombre} (${pais}/${estado}) id=${id}`);
    });

    if (cuerpoTabla) {
        cuerpoTabla.addEventListener('click', async function(e) {
            const btnEliminar = e.target.closest('.btn-eliminar');
            const btnEditar = e.target.closest('.btn-editar');

            if (btnEditar) {
                abrirModal({
                    id: btnEditar.getAttribute('data-id'),
                    nombre: btnEditar.getAttribute('data-nombre'),
                    pais: btnEditar.getAttribute('data-pais'),
                    estado: btnEditar.getAttribute('data-estado')
                });
                return;
            }

            if (btnEliminar) {
                const id = btnEliminar.getAttribute('data-id');
                const nombre = btnEliminar.getAttribute('data-nombre');

                if (confirm(`¿Eliminar el hipódromo "${nombre}"?\nEsta acción no se puede deshacer.`)) {
                    btnEliminar.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                    btnEliminar.disabled = true;

                    const { error } = await window.supabase.from('hipodromos').delete().eq('id', id);

                    if (error) {
                        clubUI.toast('Error al eliminar. Puede haber tablas o tickets asociados.', 'error');
                        btnEliminar.innerHTML = '<i class="fas fa-trash-alt mr-1"></i>';
                        btnEliminar.disabled = false;
                    } else {
                        cargarHipodromos();
                        if (window.clubDB?.logAccion) window.clubDB.logAccion('HIPODROMOS', `eliminado: ${nombre} (id=${id})`);
                    }
                }
            }
        });
    }

    if (buscador) {
        buscador.addEventListener('input', function() {
            const texto = this.value.toLowerCase();
            const filtrados = hipodromosData.filter(h => h.nombre.toLowerCase().includes(texto));
            renderizarTabla(filtrados);
        });
    }

    cargarHipodromos();
});