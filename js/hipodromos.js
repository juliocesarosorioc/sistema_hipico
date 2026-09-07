// Archivo: js/hipodromos.js
// Propósito: Gestión de altas, filtrado en memoria y eliminación de hipódromos en Supabase.

document.addEventListener('DOMContentLoaded', () => {

    const formHipodromo = document.getElementById('formHipodromo');
    const inputNombre = document.getElementById('nombreHipodromo');
    const buscador = document.getElementById('buscadorHipodromos');
    const cuerpoTabla = document.getElementById('cuerpoTablaHipodromos');

    let hipodromosData = []; // Caché para búsquedas rápidas

    // ==========================================
    // 1. CARGAR DATOS DESDE SUPABASE (Read)
    // ==========================================
    async function cargarHipodromos() {
        cuerpoTabla.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-slate-500">Cargando catálogo...</td></tr>';
        
        const { data, error } = await supabase
            .from('hipodromos')
            .select('*')
            .order('nombre', { ascending: true });

        if (error) {
            cuerpoTabla.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-red-500">Error de conexión.</td></tr>';
            return;
        }

        hipodromosData = data;
        renderizarTabla(hipodromosData);
    }

    // ==========================================
    // 2. RENDERIZAR TABLA EN PANTALLA
    // ==========================================
    function renderizarTabla(datos) {
        if (datos.length === 0) {
            cuerpoTabla.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-slate-500 bg-slate-50">No hay hipódromos registrados en el catálogo.</td></tr>';
            return;
        }

        cuerpoTabla.innerHTML = '';
        
        datos.forEach(h => {
            const fecha = new Date(h.fecha_creacion).toLocaleString('es-ES');
            const estadoBadge = h.estado === 'Activo' 
                ? '<span class="bg-emerald-600 text-white px-2 py-1 rounded font-bold text-[10px] uppercase">Activo</span>'
                : `<span class="bg-slate-500 text-white px-2 py-1 rounded font-bold text-[10px] uppercase">${h.estado}</span>`;

            cuerpoTabla.innerHTML += `
                <tr class="hover:bg-slate-50 transition-colors">
                    <td class="p-3 font-bold text-slate-800">${h.nombre}</td>
                    <td class="p-3 text-slate-600 text-xs">${fecha}</td>
                    <td class="p-3 text-center">${estadoBadge}</td>
                    <td class="p-3 text-center">
                        <button class="btn-eliminar border border-red-300 text-red-500 hover:bg-red-50 hover:text-red-700 px-3 py-1 rounded text-xs transition-colors shadow-sm" data-id="${h.id}" data-nombre="${h.nombre}">
                            <i class="fas fa-trash-alt mr-1"></i> Eliminar
                        </button>
                    </td>
                </tr>
            `;
        });
    }

    // ==========================================
    // 3. REGISTRO DE NUEVO HIPÓDROMO (Create)
    // ==========================================
    if (formHipodromo) {
        formHipodromo.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const nombre = inputNombre.value.trim().toUpperCase();
            if (nombre === "") return;

            const btn = this.querySelector('button[type="submit"]');
            const btnOriginal = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Guardando...';
            btn.disabled = true;

            const { error } = await supabase.from('hipodromos').insert([{ nombre: nombre }]);

            if (error) {
                if (error.code === '23505') { // Error de valor único (UNIQUE)
                    alert(`El hipódromo "${nombre}" ya existe en el catálogo.`);
                } else {
                    alert("Ocurrió un error al registrar el hipódromo.");
                }
            } else {
                this.reset();
                cargarHipodromos(); // Recargar para mostrar el nuevo
            }

            btn.innerHTML = btnOriginal;
            btn.disabled = false;
        });
    }

    // ==========================================
    // 4. LÓGICA DE ELIMINACIÓN (Delete)
    // ==========================================
    if (cuerpoTabla) {
        cuerpoTabla.addEventListener('click', async function(e) {
            const btnEliminar = e.target.closest('.btn-eliminar');
            
            if (btnEliminar) {
                const id = btnEliminar.getAttribute('data-id');
                const nombre = btnEliminar.getAttribute('data-nombre');
                
                if (confirm(`⚠️ ATENCIÓN:\n\n¿Está seguro que desea eliminar el hipódromo "${nombre}"?\nEsta acción no se puede deshacer.`)) {
                    
                    btnEliminar.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                    btnEliminar.disabled = true;

                    const { error } = await supabase.from('hipodromos').delete().eq('id', id);

                    if (error) {
                        alert("Error al eliminar. Es posible que existan jugadas asociadas a este hipódromo.");
                        btnEliminar.innerHTML = '<i class="fas fa-trash-alt mr-1"></i> Eliminar';
                        btnEliminar.disabled = false;
                    } else {
                        cargarHipodromos(); // Recargar tabla
                    }
                }
            }
        });
    }

    // ==========================================
    // 5. BUSCADOR EN TIEMPO REAL (Filtro local)
    // ==========================================
    if (buscador) {
        buscador.addEventListener('keyup', function() {
            const texto = this.value.toLowerCase();
            const filtrados = hipodromosData.filter(h => h.nombre.toLowerCase().includes(texto));
            renderizarTabla(filtrados);
        });
    }

    // Inicializar
    cargarHipodromos();
});