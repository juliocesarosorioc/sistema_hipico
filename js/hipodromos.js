// Archivo: js/hipodromos.js
// GestiÃ³n de hipÃ³dromos: CREATE/READ/UPDATE/DELETE ordenados alfabÃ©ticamente,
// con paÃ­s y estado. Los hipÃ³dromos de VE y USA vienen sembrados por el SQL (secciÃ³n 8).
// Incluye validaciÃ³n fuzzy (Levenshtein) para evitar cuasi-duplicados.

function toTitleCase(t){return String(t||"").trim().replace(/\s+/g," ").toLowerCase().replace(/\b[a-zÃ¡Ã©Ã­Ã³ÃºÃ±]|\b\d+\b/g,function(m){return m.toUpperCase();}).replace(/\b(al|del|de|la|los|las|y|en|a|o|u|por|para)\b/gi,function(w){return w.toLowerCase();});}

// Distancia de Levenshtein normalizada (0 = igual, 1 = totalmente distinto)
function levenshteinNorm(a, b) {
    if (!a || !b) return 1;
    a = a.toUpperCase().replace(/\s+/g, '');
    b = b.toUpperCase().replace(/\s+/g, '');
    if (a === b) return 0;
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, (_, i) => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1,      // deletion
                dp[i][j - 1] + 1,      // insertion
                dp[i - 1][j - 1] + cost // substitution
            );
        }
    }
    return dp[m][n] / Math.max(m, n);
}

document.addEventListener('DOMContentLoaded', () => {

    const formHipodromo = document.getElementById('formHipodromo');
    const inputNombre = document.getElementById('nombreHipodromo');
    const selectPais = document.getElementById('paisHipodromo');
    const buscador = document.getElementById('buscadorHipodromos');
    const cuerpoTabla = document.getElementById('gridHipodromos');
    const modal = document.getElementById('modalHipodromo');
    const btnGuardarModal = document.getElementById('btnGuardarHipodromo');

    let hipodromosData = [];

    const PAIS_LABEL = {
        VE: 'ðŸ‡»ðŸ‡ª VE', USA: 'ðŸ‡ºðŸ‡¸ USA', PA: 'ðŸ‡µðŸ‡¦ PA', MX: 'ðŸ‡²ðŸ‡½ MX', AR: 'ðŸ‡¦ðŸ‡· AR',
        BR: 'ðŸ‡§ðŸ‡· BR', CL: 'ðŸ‡¨ðŸ‡± CL', PE: 'ðŸ‡µðŸ‡ª PE', CO: 'ðŸ‡¨ðŸ‡´ CO', EC: 'ðŸ‡ªðŸ‡¨ EC',
        UY: 'ðŸ‡ºðŸ‡¾ UY', OTRO: 'ðŸŒŽ OTRO'
    };

    async function cargarHipodromos() {
        cuerpoTabla.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-slate-500">Cargando catÃ¡logo...</td></tr>';

        const { data, error } = await window.supabase
            .from('hipodromos')
            .select('*')
            .order('nombre', { ascending: true });

        if (error) {
            cuerpoTabla.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-red-500">Error al cargar el catÃ¡logo: ' + error.message + '</td></tr>';
            return;
        }

        hipodromosData = data || [];
        renderizarTabla(hipodromosData);
    }

    function renderizarTabla(datos) {
        if (!datos.length) {
            cuerpoTabla.innerHTML = '<div class="col-span-full p-6 text-center text-slate-500 italic text-sm">No hay hipódromos registrados todavía.</div>';
            return;
        }
        cuerpoTabla.innerHTML = datos.map(h => {
            const fecha = h.fecha_creacion ? new Date(h.fecha_creacion).toLocaleDateString('es-ES') : '—';
            const activo = (h.estado || 'Activo') === 'Activo';
            const pais = (h.pais || 'OTRO').toUpperCase();
            const nombre = (h.nombre || '').toUpperCase();
            const est = activo
                ? '<span class="shrink-0 bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-black text-[9px] uppercase leading-none">Activo</span>'
                : '<span class="shrink-0 bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded-full font-black text-[9px] uppercase leading-none">Inactivo</span>';
            return `
                <div class="relative bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-purple-300 transition-all p-3 flex flex-col gap-1.5 min-w-0">
                    <div class="flex items-start justify-between gap-2">
                        <div class="min-w-0">
                            <div class="flex items-center gap-1.5 leading-tight">
                                <i class="fas fa-house-circle-check text-purple-500 text-xs"></i>
                                <h3 class="font-black text-slate-800 uppercase text-[13px] leading-tight truncate">${nombre}</h3>
                            </div>
                            <div class="flex items-center gap-2 mt-0.5 text-[10px] tracking-wide">
                                <span class="font-bold text-slate-400 uppercase">· ${pais}</span>
                                <span class="text-slate-300">·</span>
                                <span class="text-slate-500">${fecha}</span>
                            </div>
                        </div>
                        ${est}
                    </div>
                    <div class="flex items-center gap-2 mt-auto pt-1 border-t border-slate-100">
                        <button class="btn-editar flex-1 inline-flex items-center justify-center gap-1 border border-blue-300 text-blue-600 hover:bg-blue-50 hover:text-blue-700 px-2 py-1 rounded-md text-[11px] font-bold transition-colors" data-id="${h.id}" data-nombre="${h.nombre}" data-pais="${pais}" data-estado="${h.estado || 'Activo'}"><i class="fas fa-pen text-[9px]"></i> Editar</button>
                        <button class="btn-eliminar w-8 h-7 inline-flex items-center justify-center border border-red-300 text-red-500 hover:bg-red-50 hover:text-red-700 rounded-md text-[11px] transition-colors" data-id="${h.id}" data-nombre="${h.nombre}"><i class="fas fa-trash-alt text-[10px]"></i></button>
                    </div>
                </div>
            `;
        }).join('');
    }
    if (formHipodromo) {
        formHipodromo.addEventListener('submit', async function(e) {
            e.preventDefault();

            const nombre = toTitleCase(inputNombre.value);
            if (!nombre) return;
            const pais = selectPais.value;

            // ValidaciÃ³n fuzzy: busca coincidencias cercanas en la lista local
            const dup = hipodromosData.find(h => 
                h.pais === pais && levenshteinNorm(h.nombre, nombre) < 0.15
            );
            if (dup) {
                clubUI.toast(`Ya existe un hipÃ³dromo muy similar: "${dup.nombre}" (${dup.pais}). No se permite duplicados.`, 'warning');
                return;
            }

            const btn = this.querySelector('button[type="submit"]');
            const btnOriginal = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Guardando...';
            btn.disabled = true;

            const { error } = await window.supabase.from('hipodromos').insert([{ nombre, pais }]);

            if (error) {
                if (error.code === '23505') clubUI.toast(`El hipÃ³dromo "${nombre}" ya existe en el catÃ¡logo.`, 'warning');
                else clubUI.toast('OcurriÃ³ un error al registrar el hipÃ³dromo.', 'error');
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
        const nombre = toTitleCase(document.getElementById('editarHipodromoNombre').value);
        const pais = document.getElementById('editarHipodromoPais').value;
        const estado = document.getElementById('editarHipodromoEstado').value;
        if (!id || !nombre) return;

        btnGuardarModal.disabled = true;
        const { error } = await window.supabase.from('hipodromos')
            .update({ nombre, pais, estado })
            .eq('id', id);
        btnGuardarModal.disabled = false;

        if (error) {
            clubUI.toast(error.code === '23505' ? 'Ya existe un hipÃ³dromo con ese nombre.' : 'Error al editar.', 'error');
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

                if (confirm(`Â¿Eliminar el hipÃ³dromo "${nombre}"?\nEsta acciÃ³n no se puede deshacer.`)) {
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