document.addEventListener('DOMContentLoaded', () => {

    const contenedorTarjetas = document.getElementById('contenedorTarjetasMonedas');
    const cuerpoHistorico = document.getElementById('cuerpoTablaHistorico');
    const filtroMoneda = document.getElementById('filtroMoneda');
    const filtroFecha = document.getElementById('filtroFecha');

    // UI Pestañas
    const tabReporte = document.getElementById('tabReporte');
    const tabHistorico = document.getElementById('tabHistorico');
    const panelReporte = document.getElementById('panelReporte');
    const panelHistorico = document.getElementById('panelHistorico');

    // UI Reportes
    const inputFechaRep = document.getElementById('reporteFecha');
    const selectMonedaRep = document.getElementById('reporteMoneda');
    const vistaVacia = document.getElementById('vistaVacia');
    const vistaReporte = document.getElementById('vistaReporte');
    const cuerpoReporte = document.getElementById('cuerpoReporte');

    inputFechaRep.valueAsDate = new Date(); // Por defecto hoy
    let monedasGlobales = [];

    // ==========================================
    // 1. LÓGICA DE PESTAÑAS
    // ==========================================
    tabReporte.addEventListener('click', () => {
        tabReporte.className = 'px-6 py-2 text-sm font-bold rounded shadow bg-white text-indigo-600 border border-slate-200 transition-all';
        tabHistorico.className = 'px-6 py-2 text-sm font-bold rounded text-slate-500 hover:text-slate-700 transition-all';
        panelReporte.classList.remove('hidden');
        panelHistorico.classList.add('hidden');
    });

    tabHistorico.addEventListener('click', () => {
        tabHistorico.className = 'px-6 py-2 text-sm font-bold rounded shadow bg-white text-indigo-600 border border-slate-200 transition-all';
        tabReporte.className = 'px-6 py-2 text-sm font-bold rounded text-slate-500 hover:text-slate-700 transition-all';
        panelHistorico.classList.remove('hidden');
        panelReporte.classList.add('hidden');
    });

    // ==========================================
    // 2. RELOJ EN VIVO
    // ==========================================
    function actualizarRelojTasas() {
        const ahora = new Date();
        document.getElementById('relojTasas').textContent = ahora.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    }
    actualizarRelojTasas(); setInterval(actualizarRelojTasas, 1000);

    // ==========================================
    // 3. CARGA DE MONEDAS (READ)
    // ==========================================
    async function cargarModulo() {
        const { data: monedas } = await supabase.from('monedas').select('*').order('es_base', { ascending: false });
        
        if (monedas) {
            monedasGlobales = monedas;
            contenedorTarjetas.innerHTML = '';
            
            let optionsFiltro = '<option value="">Todas las Monedas</option>';
            let optionsReporte = '';

            for (let moneda of monedas) {
                optionsFiltro += `<option value="${moneda.id}">${moneda.nombre} (${moneda.codigo})</option>`;
                optionsReporte += `<option value="${moneda.id}">${moneda.nombre} (${moneda.codigo})</option>`;

                if (moneda.es_base) {
                    contenedorTarjetas.innerHTML += `
                        <div class="bg-slate-50 border border-slate-200 p-3 rounded-lg flex items-center justify-between shadow-sm">
                            <div class="flex items-center gap-3">
                                <div class="bg-emerald-100 text-emerald-700 rounded-full h-10 w-10 flex items-center justify-center font-bold text-lg">${moneda.simbolo}</div>
                                <div>
                                    <p class="font-bold text-slate-800">${moneda.nombre} (${moneda.codigo})</p>
                                    <p class="text-xs text-slate-500">Base del Sistema</p>
                                </div>
                            </div>
                            <div class="text-right">
                                <p class="font-mono font-bold text-lg text-slate-700">1.00</p>
                            </div>
                        </div>
                    `;
                } else {
                    const { data: ultimaTasa } = await supabase
                        .from('tasas_cambio')
                        .select('tasa')
                        .eq('moneda_id', moneda.id)
                        .order('fecha_registro', { ascending: false }).limit(1).single();

                    const valorTasa = ultimaTasa ? Number(ultimaTasa.tasa).toFixed(4) : '0.00';

                    contenedorTarjetas.innerHTML += `
                        <div class="bg-white border border-blue-200 p-3 rounded-lg flex items-center justify-between shadow-sm relative overflow-hidden">
                            <div class="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
                            <div class="flex items-center gap-3 pl-2">
                                <div class="bg-blue-100 text-blue-700 rounded-full h-10 w-10 flex items-center justify-center font-bold text-lg">${moneda.simbolo}</div>
                                <div>
                                    <p class="font-bold text-slate-800">${moneda.nombre} (${moneda.codigo})</p>
                                </div>
                            </div>
                            <div class="flex flex-col items-end gap-1">
                                <input type="number" step="0.0001" value="${valorTasa}" data-id="${moneda.id}" class="inp-tasa w-28 font-mono font-bold text-right border border-slate-300 rounded px-2 py-1 focus:border-blue-500 outline-none text-slate-800">
                                <button class="btn-actualizar-tasa text-xs bg-blue-50 text-blue-600 border border-blue-200 px-2 py-1 rounded hover:bg-blue-100 font-bold w-28 transition-colors">Actualizar</button>
                            </div>
                        </div>
                    `;
                }
            }

            filtroMoneda.innerHTML = optionsFiltro;
            selectMonedaRep.innerHTML = optionsReporte;
            asignarEventosActualizacion();
        }
        cargarHistoricoTasas();
    }

    // ==========================================
    // 4. CARGAR HISTÓRICO DE TASAS
    // ==========================================
    async function cargarHistoricoTasas() {
        cuerpoHistorico.innerHTML = '<tr><td colspan="4" class="p-6 text-center text-slate-500">Cargando histórico...</td></tr>';

        let query = supabase.from('tasas_cambio').select(`*, monedas(nombre, codigo)`).order('fecha_registro', { ascending: false });

        if (filtroMoneda.value !== "") query = query.eq('moneda_id', filtroMoneda.value);
        if (filtroFecha.value !== "") {
            const startDate = `${filtroFecha.value}T00:00:00`;
            const endDate = `${filtroFecha.value}T23:59:59`;
            query = query.gte('fecha_registro', startDate).lte('fecha_registro', endDate);
        }

        const { data: historico } = await query;

        if (!historico || historico.length === 0) {
            cuerpoHistorico.innerHTML = '<tr><td colspan="4" class="p-6 text-center text-slate-500">No hay registros.</td></tr>';
            return;
        }

        cuerpoHistorico.innerHTML = '';
        let monedasProcesadas = new Set();

        historico.forEach(t => {
            const fechaStr = new Date(t.fecha_registro).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
            const monedaStr = t.monedas ? `${t.monedas.nombre} (${t.monedas.codigo})` : 'Desconocida';
            
            let badgeEstado = '';
            let estiloFila = '';

            if (!monedasProcesadas.has(t.moneda_id) && filtroFecha.value === "") {
                monedasProcesadas.add(t.moneda_id);
                badgeEstado = '<span class="bg-emerald-100 text-emerald-700 px-2 py-1 rounded text-[10px] font-bold">VIGENTE AHORA</span>';
                estiloFila = 'hover:bg-slate-50';
            } else {
                badgeEstado = '<span class="bg-slate-200 text-slate-600 px-2 py-1 rounded text-[10px] font-bold">HISTÓRICO</span>';
                estiloFila = 'bg-slate-50 text-slate-500';
            }

            cuerpoHistorico.innerHTML += `
                <tr class="${estiloFila} border-b border-slate-100">
                    <td class="p-3 font-mono">${fechaStr}</td>
                    <td class="p-3 font-bold">${monedaStr}</td>
                    <td class="p-3 text-right font-mono font-bold ${estiloFila.includes('bg-slate-50') ? '' : 'text-blue-600'}">${Number(t.tasa).toFixed(4)}</td>
                    <td class="p-3 text-center">${badgeEstado}</td>
                </tr>
            `;
        });
    }

    // ==========================================
    // 5. ACTUALIZAR TASAS (INSERT INMUTABLE)
    // ==========================================
    function asignarEventosActualizacion() {
        document.querySelectorAll('.btn-actualizar-tasa').forEach(boton => {
            boton.addEventListener('click', async function() {
                const inputMonto = this.closest('div').querySelector('.inp-tasa');
                const nuevaTasa = parseFloat(inputMonto.value);
                const monedaId = inputMonto.getAttribute('data-id');
                
                if (isNaN(nuevaTasa) || nuevaTasa <= 0) return clubUI.toast("Ingrese un valor mayor a cero.");

                if (confirm(`¿Confirma el registro histórico de la tasa a: ${nuevaTasa}?`)) {
                    const txt = this.textContent;
                    this.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                    this.disabled = true;

                    const { error } = await supabase.from('tasas_cambio').insert([{ moneda_id: monedaId, tasa: nuevaTasa }]);

                    if (error) {
                        clubUI.toast("Error al actualizar la tasa.");
                        this.textContent = txt;
                    } else {
                        this.textContent = "¡Guardado!";
                        this.classList.replace('text-blue-600', 'text-emerald-600');
                        this.classList.replace('bg-blue-50', 'bg-emerald-50');
                        setTimeout(() => {
                            this.textContent = "Actualizar";
                            this.classList.replace('text-emerald-600', 'text-blue-600');
                            this.classList.replace('bg-emerald-50', 'bg-blue-50');
                            this.disabled = false;
                        }, 2000);
                        cargarHistoricoTasas();
                    }
                }
            });
        });
    }

    // ==========================================
    // 6. MOTOR DE REPORTE CONVERSIVO
    // ==========================================
    document.getElementById('btnGenerarReporte').addEventListener('click', async () => {
        const fecha = inputFechaRep.value;
        const monedaId = selectMonedaRep.value;

        if(!fecha || !monedaId) return clubUI.toast("Seleccione fecha y moneda.");

        const btn = document.getElementById('btnGenerarReporte');
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Calculando...';
        btn.disabled = true;

        try {
            // A. Tasa Aplicar: Buscar en el historial la tasa de ESA moneda en ESE día
            const monedaObj = monedasGlobales.find(m => m.id == monedaId);
            let tasaReporte = 1.0; 
            
            if(!monedaObj.es_base) {
                const endOfDay = `${fecha}T23:59:59`;
                const { data: tasaHist } = await supabase.from('tasas_cambio')
                    .select('tasa').eq('moneda_id', monedaId).lte('fecha_registro', endOfDay).order('fecha_registro', {ascending: false}).limit(1).single();
                
                if(tasaHist) tasaReporte = parseFloat(tasaHist.tasa);
            }

            // B. Buscar Tickets del Día
            const startDate = `${fecha}T00:00:00`;
            const endDate = `${fecha}T23:59:59`;
            
            const { data: tickets, error } = await supabase.from('tickets_apuestas')
                .select('*').gte('created_at', startDate).lte('created_at', endDate);

            if (error) throw error;

            if (tickets.length === 0) {
                vistaVacia.classList.remove('hidden');
                vistaReporte.classList.add('hidden');
            } else {
                vistaVacia.classList.add('hidden');
                vistaReporte.classList.remove('hidden');
                vistaReporte.classList.add('flex');

                document.getElementById('lblTasaAplicada').textContent = tasaReporte.toFixed(4);
                document.getElementById('lblSimboloAplicado').textContent = monedaObj.simbolo;

                let totalBaseUSD_Jugado = 0;
                let totalBaseUSD_Premios = 0;

                cuerpoReporte.innerHTML = '';

                // C. Convertir cada ticket a Dólares (Base), y luego multiplicarlo por la Tasa del Reporte
                tickets.forEach(tk => {
                    // tk.moneda dice en qué se vendió ('USD' o 'VES') y tk.tasa_cambio la tasa que tenía en ese momento exacto
                    let divisorParaLlevarAUSD = tk.moneda === 'VES' ? (parseFloat(tk.tasa_cambio) || 1) : 1;
                    
                    let jugadoUSD = parseFloat(tk.monto_jugado) / divisorParaLlevarAUSD;
                    let premioUSD = parseFloat(tk.premio_pagar || 0) / divisorParaLlevarAUSD;

                    totalBaseUSD_Jugado += jugadoUSD;
                    totalBaseUSD_Premios += premioUSD;

                    // Para la fila individual (convertida a la moneda seleccionada)
                    let jugadoFila = jugadoUSD * tasaReporte;
                    let premioFila = premioUSD * tasaReporte;

                    let badgeE = tk.estado === 'Ganador' ? '<span class="bg-emerald-100 text-emerald-700 px-2 rounded text-[10px] font-bold">GANÓ</span>' 
                                : (tk.estado === 'Perdedor' ? '<span class="bg-red-100 text-red-700 px-2 rounded text-[10px] font-bold">PERDIÓ</span>' 
                                : '<span class="bg-slate-200 text-slate-600 px-2 rounded text-[10px] font-bold">PENDIENTE</span>');

                    const hora = new Date(tk.created_at).toLocaleTimeString('es-ES', {hour: '2-digit', minute:'2-digit'});

                    cuerpoReporte.innerHTML += `
                        <tr class="hover:bg-slate-50">
                            <td class="p-2 border-b text-slate-500 font-bold">#${tk.id} <span class="text-[10px] font-normal block">${hora}</span></td>
                            <td class="p-2 border-b font-bold text-slate-700">${tk.nombre_jugada} <span class="text-[10px] font-normal block text-slate-500">${tk.cliente_juega_nombre}</span></td>
                            <td class="p-2 border-b text-center">${badgeE}</td>
                            <td class="p-2 border-b text-right font-bold text-blue-600">${monedaObj.simbolo}${jugadoFila.toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                            <td class="p-2 border-b text-right font-bold text-emerald-600">${monedaObj.simbolo}${premioFila.toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                        </tr>
                    `;
                });

                // Totales
                let repJugado = totalBaseUSD_Jugado * tasaReporte;
                let repPremios = totalBaseUSD_Premios * tasaReporte;
                let repUtilidad = repJugado - repPremios;

                document.getElementById('resCantidad').textContent = tickets.length;
                document.getElementById('resJugado').textContent = `${monedaObj.simbolo}${repJugado.toLocaleString(undefined, {minimumFractionDigits:2})}`;
                document.getElementById('resPremios').textContent = `${monedaObj.simbolo}${repPremios.toLocaleString(undefined, {minimumFractionDigits:2})}`;
                document.getElementById('resUtilidad').textContent = `${monedaObj.simbolo}${repUtilidad.toLocaleString(undefined, {minimumFractionDigits:2})}`;
                document.getElementById('resUtilidad').className = repUtilidad < 0 ? "text-xl font-black text-red-600" : "text-xl font-black text-emerald-600";
            }

        } catch (e) {
            console.error(e);
            clubUI.toast("Error consultando la base de datos.");
        }

        btn.innerHTML = '<i class="fas fa-calculator"></i> Calcular Cierre';
        btn.disabled = false;
    });

    // ==========================================
    // 7. CREACIÓN DE MONEDAS
    // ==========================================
    const modalNueva = document.getElementById('modalNuevaMoneda');
    document.getElementById('btnAbrirModalNuevaMoneda')?.addEventListener('click', () => modalNueva.classList.remove('hidden'));
    document.querySelectorAll('.cerrar-modal').forEach(b => b.addEventListener('click', () => modalNueva.classList.add('hidden')));

    document.getElementById('formNuevaMoneda')?.addEventListener('submit', async function(e) {
        e.preventDefault();
        const btn = this.querySelector('button[type="submit"]');
        const txt = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Guardando...'; btn.disabled = true;

        const payload = {
            nombre: document.getElementById('nuevaNombre').value.trim(),
            codigo: document.getElementById('nuevaCodigo').value.trim().toUpperCase(),
            simbolo: document.getElementById('nuevaSimbolo').value.trim(),
            es_base: false
        };
        const tasa = parseFloat(document.getElementById('nuevaTasa').value);

        const { data: monedaGenerada, error } = await supabase.from('monedas').insert([payload]).select('id').single();

        if (error) clubUI.toast("El código de moneda ya existe o hubo un error.");
        else {
            await supabase.from('tasas_cambio').insert([{ moneda_id: monedaGenerada.id, tasa: tasa }]);
            clubUI.toast(`Moneda registrada.`);
            this.reset();
            modalNueva.classList.add('hidden');
            cargarModulo();
        }
        btn.innerHTML = txt; btn.disabled = false;
    });

    // Filtros Histórico
    filtroMoneda.addEventListener('change', cargarHistoricoTasas);
    filtroFecha.addEventListener('change', cargarHistoricoTasas);
    document.getElementById('btnLimpiarFiltros').addEventListener('click', () => { filtroMoneda.value=""; filtroFecha.value=""; cargarHistoricoTasas(); });

    cargarModulo();
});