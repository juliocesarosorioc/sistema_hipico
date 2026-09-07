// Archivo: js/monedas.js
// Propósito: Lectura de monedas, actualización inmutable de tasas (auditoría contable) y creación de divisas.

document.addEventListener('DOMContentLoaded', () => {

    const contenedorTarjetas = document.getElementById('contenedorTarjetasMonedas');
    const cuerpoHistorico = document.getElementById('cuerpoTablaHistorico');
    const filtroMoneda = document.getElementById('filtroMoneda');
    const filtroFecha = document.getElementById('filtroFecha');

    // ==========================================
    // 1. RELOJ EN VIVO
    // ==========================================
    function actualizarRelojTasas() {
        const ahora = new Date();
        document.getElementById('relojTasas').textContent = ahora.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    }
    actualizarRelojTasas();
    setInterval(actualizarRelojTasas, 1000);

    // ==========================================
    // 2. CARGAR DATOS PRINCIPALES (Read)
    // ==========================================
    async function cargarModulo() {
        // A. Cargar Monedas Base y Secundarias
        const { data: monedas } = await supabase.from('monedas').select('*').order('es_base', { ascending: false });
        
        if (monedas) {
            contenedorTarjetas.innerHTML = '';
            
            // Llenar selector de filtros
            let optionsFiltro = '<option value="">Todas las Monedas</option>';

            for (let moneda of monedas) {
                optionsFiltro += `<option value="${moneda.id}">${moneda.nombre} (${moneda.codigo})</option>`;

                if (moneda.es_base) {
                    // Tarjeta estática para el USD
                    contenedorTarjetas.innerHTML += `
                        <div class="bg-slate-50 border border-slate-200 p-3 rounded-lg flex items-center justify-between shadow-sm">
                            <div class="flex items-center gap-3">
                                <div class="bg-emerald-100 text-emerald-700 rounded-full h-10 w-10 flex items-center justify-center font-bold text-lg">${moneda.simbolo}</div>
                                <div>
                                    <p class="font-bold text-slate-800">${moneda.nombre} (${moneda.codigo})</p>
                                    <p class="text-xs text-slate-500">Moneda Base del Sistema</p>
                                </div>
                            </div>
                            <div class="text-right">
                                <p class="font-mono font-bold text-lg text-slate-700">1.00</p>
                                <span class="bg-slate-200 text-slate-600 text-[10px] px-2 py-0.5 rounded font-bold">FIJA</span>
                            </div>
                        </div>
                    `;
                } else {
                    // Buscar la ÚLTIMA tasa registrada para esta moneda
                    const { data: ultimaTasa } = await supabase
                        .from('tasas_cambio')
                        .select('tasa')
                        .eq('moneda_id', moneda.id)
                        .order('fecha_registro', { ascending: false })
                        .limit(1)
                        .single();

                    const valorTasa = ultimaTasa ? Number(ultimaTasa.tasa).toFixed(2) : '0.00';

                    contenedorTarjetas.innerHTML += `
                        <div class="bg-white border border-blue-200 p-3 rounded-lg flex items-center justify-between shadow-sm relative overflow-hidden">
                            <div class="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
                            <div class="flex items-center gap-3 pl-2">
                                <div class="bg-blue-100 text-blue-700 rounded-full h-10 w-10 flex items-center justify-center font-bold text-lg">${moneda.simbolo}</div>
                                <div>
                                    <p class="font-bold text-slate-800">${moneda.nombre} (${moneda.codigo})</p>
                                    <p class="text-[10px] text-slate-400">Actualice si varió en el mercado</p>
                                </div>
                            </div>
                            <div class="flex flex-col items-end gap-1">
                                <input type="number" step="0.01" value="${valorTasa}" data-id="${moneda.id}" class="inp-tasa w-24 font-mono font-bold text-right border border-slate-300 rounded px-2 py-1 focus:border-blue-500 outline-none text-slate-800">
                                <button class="btn-actualizar-tasa text-xs bg-blue-50 text-blue-600 border border-blue-200 px-2 py-1 rounded hover:bg-blue-100 font-bold w-24 transition-colors">Actualizar</button>
                            </div>
                        </div>
                    `;
                }
            }

            filtroMoneda.innerHTML = optionsFiltro;
            asignarEventosActualizacion();
        }

        cargarHistoricoTasas();
    }

    // ==========================================
    // 3. CARGAR LIBRO MAYOR (HISTÓRICO INMUTABLE)
    // ==========================================
    async function cargarHistoricoTasas() {
        cuerpoHistorico.innerHTML = '<tr><td colspan="5" class="p-6 text-center text-slate-500">Cargando histórico...</td></tr>';

        let query = supabase
            .from('tasas_cambio')
            .select(`*, monedas(nombre, codigo)`)
            .order('fecha_registro', { ascending: false });

        // Aplicar filtros si existen
        if (filtroMoneda.value !== "") query = query.eq('moneda_id', filtroMoneda.value);
        if (filtroFecha.value !== "") {
            const startDate = `${filtroFecha.value}T00:00:00`;
            const endDate = `${filtroFecha.value}T23:59:59`;
            query = query.gte('fecha_registro', startDate).lte('fecha_registro', endDate);
        }

        const { data: historico } = await query;

        if (!historico || historico.length === 0) {
            cuerpoHistorico.innerHTML = '<tr><td colspan="5" class="p-6 text-center text-slate-500">No hay registros para mostrar.</td></tr>';
            return;
        }

        cuerpoHistorico.innerHTML = '';
        
        // El primer registro de cada moneda es el "VIGENTE HOY", el resto es histórico
        let monedasProcesadas = new Set();

        historico.forEach(t => {
            const fechaStr = new Date(t.fecha_registro).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
            const monedaStr = t.monedas ? `${t.monedas.nombre} (${t.monedas.codigo})` : 'Desconocida';
            
            let badgeEstado = '';
            let estiloFila = '';

            // Si es el registro más reciente de esa moneda, lo marcamos como Vigente
            if (!monedasProcesadas.has(t.moneda_id) && filtroFecha.value === "") {
                monedasProcesadas.add(t.moneda_id);
                badgeEstado = '<span class="bg-emerald-100 text-emerald-700 px-2 py-1 rounded text-[10px] font-bold shadow-sm">VIGENTE AHORA</span>';
                estiloFila = 'hover:bg-slate-50';
            } else {
                badgeEstado = '<span class="bg-slate-200 text-slate-600 px-2 py-1 rounded text-[10px] font-bold">HISTÓRICO</span>';
                estiloFila = 'bg-slate-50 text-slate-500';
            }

            cuerpoHistorico.innerHTML += `
                <tr class="${estiloFila} border-b border-slate-100">
                    <td class="p-3 font-mono">${fechaStr}</td>
                    <td class="p-3 font-bold text-slate-700">${monedaStr}</td>
                    <td class="p-3 text-right font-mono font-bold ${estiloFila.includes('bg-slate-50') ? '' : 'text-blue-600'}">${Number(t.tasa).toFixed(4)}</td>
                    <td class="p-3 text-center">${t.operador}</td>
                    <td class="p-3 text-center">${badgeEstado}</td>
                </tr>
            `;
        });
    }

    // ==========================================
    // 4. ACTUALIZACIÓN DE TASA (INSERTAR HISTÓRICO)
    // ==========================================
    function asignarEventosActualizacion() {
        const botonesActualizar = document.querySelectorAll('.btn-actualizar-tasa');

        botonesActualizar.forEach(boton => {
            boton.addEventListener('click', async function() {
                const inputMonto = this.closest('div').querySelector('.inp-tasa');
                const nuevaTasa = parseFloat(inputMonto.value);
                const monedaId = inputMonto.getAttribute('data-id');
                
                if (isNaN(nuevaTasa) || nuevaTasa <= 0) {
                    alert("Error: Ingrese un valor numérico válido mayor a cero.");
                    return;
                }

                if (confirm(
                    `ALERTA CONTABLE:\n\n` +
                    `Está a punto de establecer la nueva tasa a: ${nuevaTasa}\n\n` +
                    `• Las operaciones futuras usarán esta tasa.\n` +
                    `• Las operaciones del pasado no serán alteradas.\n\n` +
                    `¿Confirma el registro?`
                )) {
                    const textoOriginal = this.textContent;
                    this.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                    this.disabled = true;

                    // INSERCIÓN DEL REGISTRO INMUTABLE
                    const { error } = await supabase.from('tasas_cambio').insert([
                        { moneda_id: monedaId, tasa: nuevaTasa }
                    ]);

                    if (error) {
                        alert("Error al actualizar la tasa.");
                        this.textContent = textoOriginal;
                        this.disabled = false;
                    } else {
                        // Efecto visual
                        this.textContent = "¡Guardado!";
                        this.classList.replace('text-blue-600', 'text-emerald-600');
                        this.classList.replace('bg-blue-50', 'bg-emerald-50');
                        this.classList.replace('border-blue-200', 'border-emerald-200');
                        
                        setTimeout(() => {
                            this.textContent = "Actualizar";
                            this.classList.replace('text-emerald-600', 'text-blue-600');
                            this.classList.replace('bg-emerald-50', 'bg-blue-50');
                            this.classList.replace('border-emerald-200', 'border-blue-200');
                            this.disabled = false;
                        }, 2000);

                        cargarHistoricoTasas(); // Refrescar el libro mayor inferior
                    }
                }
            });
        });
    }

    // ==========================================
    // 5. CREACIÓN DE NUEVA MONEDA
    // ==========================================
    const modalNuevaMoneda = document.getElementById('modalNuevaMoneda');
    
    document.getElementById('btnAbrirModalNuevaMoneda')?.addEventListener('click', () => {
        modalNuevaMoneda.classList.remove('hidden');
    });

    document.querySelectorAll('.cerrar-modal').forEach(b => {
        b.addEventListener('click', () => modalNuevaMoneda.classList.add('hidden'));
    });

    document.getElementById('formNuevaMoneda')?.addEventListener('submit', async function(e) {
        e.preventDefault();

        const btn = this.querySelector('button[type="submit"]');
        const txt = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Creando...';
        btn.disabled = true;

        const payloadMoneda = {
            nombre: document.getElementById('nuevaNombre').value.trim(),
            codigo: document.getElementById('nuevaCodigo').value.trim().toUpperCase(),
            simbolo: document.getElementById('nuevaSimbolo').value.trim(),
            es_base: false
        };

        const tasaInicial = parseFloat(document.getElementById('nuevaTasa').value);

        // 1. Insertar Moneda
        const { data: monedaGenerada, error: errM } = await supabase.from('monedas').insert([payloadMoneda]).select('id').single();

        if (errM) {
            alert(errM.code === '23505' ? "El código de moneda ya existe." : "Error al guardar la moneda.");
        } else {
            // 2. Insertar su primera tasa histórica
            await supabase.from('tasas_cambio').insert([{ moneda_id: monedaGenerada.id, tasa: tasaInicial }]);
            
            alert(`Moneda ${payloadMoneda.codigo} registrada correctamente.`);
            this.reset();
            modalNuevaMoneda.classList.add('hidden');
            cargarModulo(); // Recargar todo para mostrar la nueva tarjeta
        }

        btn.innerHTML = txt;
        btn.disabled = false;
    });

    // Filtros
    filtroMoneda.addEventListener('change', cargarHistoricoTasas);
    filtroFecha.addEventListener('change', cargarHistoricoTasas);
    document.getElementById('btnLimpiarFiltros').addEventListener('click', () => {
        filtroMoneda.value = ""; filtroFecha.value = ""; cargarHistoricoTasas();
    });

    // Arranque
    cargarModulo();
});