// Archivo: js/pollas.js
// Propósito: Gestionar la creación de pollas, listar eventos activos y conectarse a Supabase.

document.addEventListener('DOMContentLoaded', () => {

    const modalNuevaPolla = document.getElementById('modalNuevaPolla');
    const btnAbrirModal = document.getElementById('btnAbrirModalPolla');
    const inputFecha = document.getElementById('pollaFecha');
    const formNuevaPolla = document.getElementById('formNuevaPolla');
    const selectHipodromo = document.getElementById('pollaHipodromo');
    const tablaPollas = document.getElementById('tablaCuerpoPollas');
    
    // Asignar fecha actual por defecto
    const hoy = new Date().toISOString().split('T')[0];
    if (inputFecha) inputFecha.value = hoy;

    // ==========================================
    // 1. CARGA INICIAL (Hipódromos y Pollas)
    // ==========================================
    async function inicializarModulo() {
        // Cargar Catálogo de Hipódromos
        const { data: hipodromos } = await supabase.from('hipodromos').select('id, nombre').order('nombre');
        if (hipodromos) {
            let options = '<option value="">— Seleccione Hipódromo —</option>';
            hipodromos.forEach(h => options += `<option value="${h.id}">${h.nombre}</option>`);
            selectHipodromo.innerHTML = options;
        }

        cargarListaPollas();
    }

    // ==========================================
    // 2. LISTAR POLLAS REGISTRADAS
    // ==========================================
    async function cargarListaPollas() {
        tablaPollas.innerHTML = '<tr><td colspan="10" class="p-6 text-center text-slate-500 bg-white">Cargando...</td></tr>';

        const { data: pollas, error } = await supabase
            .from('pollas')
            .select(`*, hipodromos(nombre)`)
            .order('fecha_registro', { ascending: false });

        if (error || !pollas || pollas.length === 0) {
            tablaPollas.innerHTML = '<tr><td colspan="10" class="p-6 text-center text-slate-500 bg-white">No hay pollas registradas aún.</td></tr>';
            return;
        }

        tablaPollas.innerHTML = '';
        pollas.forEach(p => {
            const hip = p.hipodromos ? p.hipodromos.nombre : '—';
            // Por ahora marcamos Jugadores y Recaudado en 0 visualmente (se hará dinámico al armar los tickets de la polla)
            const jugadores = 0; 
            const recaudado = p.tipo === 'Paga' ? (jugadores * p.valor_usd) : 0;
            
            const badgeTipo = p.tipo === 'Paga' 
                ? '<span class="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded text-[10px] font-bold">PAGA</span>'
                : '<span class="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded text-[10px] font-bold">GRATIS</span>';

            const tr = document.createElement('tr');
            tr.className = 'hover:bg-slate-50';
            tr.innerHTML = `
                <td class="p-3 font-bold text-slate-800">${p.nombre}</td>
                <td class="p-3">${hip}</td>
                <td class="p-3">${p.fecha}</td>
                <td class="p-3 text-center">${badgeTipo}</td>
                <td class="p-3 text-right font-medium text-emerald-700">$${Number(p.valor_usd).toFixed(2)}</td>
                <td class="p-3 text-center font-bold text-slate-600">${p.carreras}</td>
                <td class="p-3 text-center font-bold text-slate-600">${jugadores}</td>
                <td class="p-3 text-right font-bold text-slate-800">$${recaudado.toFixed(2)}</td>
                <td class="p-3 text-center"><span class="bg-emerald-600 text-white px-2 py-0.5 rounded text-[10px] font-bold uppercase">${p.estado}</span></td>
                <td class="p-3 text-center">
                    <button class="btn-eliminar-polla bg-red-50 text-red-500 border border-red-200 px-2 py-1 rounded text-[11px] font-bold shadow-sm hover:bg-red-500 hover:text-white transition-colors" data-id="${p.id}"><i class="fas fa-trash-alt"></i></button>
                </td>
            `;
            tablaPollas.appendChild(tr);
        });

        // Lógica de Eliminación
        document.querySelectorAll('.btn-eliminar-polla').forEach(btn => {
            btn.addEventListener('click', async function() {
                if (confirm("¿Seguro que desea eliminar esta polla? Esta acción no se puede deshacer.")) {
                    const id = this.getAttribute('data-id');
                    await supabase.from('pollas').delete().eq('id', id);
                    cargarListaPollas();
                }
            });
        });
    }

    // ==========================================
    // 3. CREAR NUEVA POLLA
    // ==========================================
    if (formNuevaPolla) {
        formNuevaPolla.addEventListener('submit', async function(e) {
            e.preventDefault(); 
            
            const btnSubmit = this.querySelector('button[type="submit"]');
            const btnOriginal = btnSubmit.innerHTML;
            btnSubmit.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Creando...';
            btnSubmit.disabled = true;

            const payload = {
                nombre: document.getElementById('pollaNombre').value.trim().toUpperCase(),
                hipodromo_id: document.getElementById('pollaHipodromo').value,
                fecha: document.getElementById('pollaFecha').value,
                carreras: parseInt(document.getElementById('pollaCarreras').value) || 6,
                tipo: document.getElementById('pollaTipo').value,
                valor_usd: parseFloat(document.getElementById('pollaValor').value) || 0,
                incentivo: parseFloat(document.getElementById('pollaIncentivo').value) || 0,
                comision_pct: parseFloat(document.getElementById('pollaComision').value) || 20
            };

            const { error } = await supabase.from('pollas').insert([payload]);

            if (error) {
                clubUI.toast("Ocurrió un error al crear la Polla.");
                console.error(error);
            } else {
                modalNuevaPolla.classList.add('hidden');
                this.reset();
                inputFecha.value = hoy;
                cargarListaPollas(); // Refrescar vista
            }

            btnSubmit.innerHTML = btnOriginal;
            btnSubmit.disabled = false;
        });
    }

    // ==========================================
    // 4. GESTIÓN DEL MODAL (Apertura/Cierre)
    // ==========================================
    if (btnAbrirModal) btnAbrirModal.addEventListener('click', () => modalNuevaPolla.classList.remove('hidden'));

    document.querySelectorAll('.cerrar-modal').forEach(boton => {
        boton.addEventListener('click', () => modalNuevaPolla.classList.add('hidden'));
    });

    modalNuevaPolla.addEventListener('click', function(e) {
        if (e.target === modalNuevaPolla) modalNuevaPolla.classList.add('hidden');
    });

    // Arranque
    inicializarModulo();
});