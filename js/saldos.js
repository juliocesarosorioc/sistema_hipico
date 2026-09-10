document.addEventListener('DOMContentLoaded', () => {

    const comboHipodromo = document.getElementById('filtroHipodromo');
    const comboCarrera = document.getElementById('filtroCarrera');
    const btnCargarCarrera = document.getElementById('btnCargarCarrera');
    const btnLiquidar = document.getElementById('btnLiquidar');
    
    const cuerpoTickets = document.getElementById('cuerpoTickets');
    const cuerpoComisionesGrupos = document.getElementById('cuerpoComisionesGrupos');

    // Resúmenes UI
    const resMontoJugado = document.getElementById('resMontoJugado');
    const resPremiosPagar = document.getElementById('resPremiosPagar');
    const resComisiones = document.getElementById('resComisiones');
    const resUtilidadNeta = document.getElementById('resUtilidadNeta');

    let ticketsActuales = [];
    let tablasReferencia = [];

    // ==========================================
    // 1. CARGA INICIAL DE FILTROS
    // ==========================================
    async function inicializarFiltros() {
        // Buscar hipódromos únicos en tickets pendientes
        const { data, error } = await window.supabase.from('tickets_apuestas')
                                      .select('hipodromo, carrera')
                                      .eq('estado', 'Pendiente');
        
        if (data && !error) {
            let hipodromosUnicos = [...new Set(data.map(t => t.hipodromo))];
            comboHipodromo.innerHTML = '<option value="">Seleccione...</option>';
            hipodromosUnicos.forEach(h => {
                comboHipodromo.innerHTML += `<option value="${h}">${h}</option>`;
            });

            // + Hipódromos del programa del día (compartido con el Ensamblaje)
            window.clubPrograma?.cargar().then(prog => {
                if (!prog) return;
                const ya = new Set(hipodromosUnicos.map(h => String(h).toUpperCase()));
                (prog.hipodromos || []).forEach(h => {
                    if (h && !ya.has(String(h).toUpperCase())) {
                        comboHipodromo.innerHTML += `<option value="${h}">${h}</option>`;
                        ya.add(String(h).toUpperCase());
                    }
                });
            }).catch(() => {});

            // Lógica para llenar carreras al seleccionar hipódromo
            comboHipodromo.addEventListener('change', () => {
                const hipSeleccionado = comboHipodromo.value;
                const deTickets = data.filter(t => t.hipodromo === hipSeleccionado).map(t => t.carrera);
                const delPrograma = ((window.clubPrograma && window.clubPrograma.obtener().carreras) || [])
                    .filter(c => String(c.hipodromo || '').toUpperCase() === String(hipSeleccionado).toUpperCase())
                    .map(c => c.carrera)
                    .filter(c => c != null);
                const carreras = [...new Set([...deTickets, ...delPrograma])];
                comboCarrera.innerHTML = '<option value="">---</option>';
                carreras.sort((a,b)=>a-b).forEach(c => {
                    comboCarrera.innerHTML += `<option value="${c}">${c}</option>`;
                });
            });
        }
    }

    // ==========================================
    // 2. CARGAR Y EVALUAR TICKETS
    // ==========================================
    btnCargarCarrera.addEventListener('click', async () => {
        const hipodromo = comboHipodromo.value;
        const carrera = comboCarrera.value;

        if(!hipodromo || !carrera) return clubUI.toast("Seleccione Hipódromo y Carrera.");

        cuerpoTickets.innerHTML = '<tr><td colspan="7" class="p-4 text-center"><i class="fas fa-spinner fa-spin text-blue-500"></i> Cargando...</td></tr>';

        // A+B. Traer tickets pendientes y tablas fijas de la carrera en paralelo
        const segura = (promesa) => promesa.catch(e => ({ data: null, error: e }));
        const [rTickets, rTablas] = await Promise.all([
            segura(window.supabase.from('tickets_apuestas')
                .select('*')
                .eq('hipodromo', hipodromo)
                .eq('carrera', carrera)
                .eq('estado', 'Pendiente')),
            segura(window.supabase.from('tablas_fijas')
                .select('*')
                .eq('hipodromo', hipodromo)
                .eq('carrera', carrera))
        ]);

        const tickets = rTickets.data;
        const errT = rTickets.error;
        const tablas = rTablas.data;
        const errTb = rTablas.error;

        if (errT || errTb) return clubUI.toast("Error al cargar datos desde la base.");

        if (tickets.length === 0) {
            cuerpoTickets.innerHTML = '<tr><td colspan="7" class="p-4 text-center text-slate-500">No hay tickets pendientes para esta carrera.</td></tr>';
            btnLiquidar.classList.add('hidden');
            return;
        }

        tablasReferencia = tablas || [];
        
        // C. Procesar cada ticket y agregar variables dinámicas para evaluación
        ticketsActuales = tickets.map(tk => {
            tk.resultado_temp = 'PERDEDOR'; // Por defecto todos pierden hasta que el admin marque al ganador
            
            // Buscar si es tabla fija para saber su premio real (descontando retiros)
            let premioBaseUnidad = 0;
            if (tk.nombre_jugada.includes('TABLA')) {
                // El premio queda CONGELADO al momento de la venta (premio_por_tabla).
                // Si el ticket es viejo (sin congelar), se toma el premio actual de la tabla.
                if (tk.premio_por_tabla != null && !isNaN(parseFloat(tk.premio_por_tabla))) {
                    premioBaseUnidad = parseFloat(tk.premio_por_tabla);
                } else {
                    const tablaMatch = tablasReferencia.find(tb => tb.hipodromo === tk.hipodromo && tb.carrera === tk.carrera);
                    if(tablaMatch) premioBaseUnidad = tablaMatch.premio_recalculado; // Toma el premio ya auditado (proporcional)
                }
            }

            // Premio Total potencial (Si Gana) = Cantidad de tablas jugadas * Premio recalculado de la tabla
            tk.premio_potencial = parseFloat(tk.cantidad_tablas) * parseFloat(premioBaseUnidad);
            tk.comision_porcentaje = parseFloat(tk.comision_porcentaje) || 0;
            
            return tk;
        });

        renderizarTickets();
        btnLiquidar.classList.remove('hidden');
    });

    // ==========================================
    // 3. RENDERIZADO Y CÁLCULOS DINÁMICOS
    // ==========================================
    function renderizarTickets() {
        cuerpoTickets.innerHTML = '';
        
        ticketsActuales.forEach((tk, index) => {
            const esGanador = tk.resultado_temp === 'GANADOR';
            const simbolo = tk.moneda === 'VES' ? 'Bs ' : '$';

            // REGLA DE NEGOCIO (COMISIONES DUALES):
            // Si Gana: Comisión basada en el PREMIO
            // Si Pierde: Comisión basada en el MONTO JUGADO
            let comisionDinámica = 0;
            let premioMostrar = 0;

            if (esGanador) {
                premioMostrar = tk.premio_potencial;
                comisionDinámica = tk.premio_potencial * (tk.comision_porcentaje / 100);
            } else {
                premioMostrar = 0;
                comisionDinámica = parseFloat(tk.monto_jugado) * (tk.comision_porcentaje / 100);
            }

            // Guardar para el cálculo global
            tk.comision_calculada = comisionDinámica;
            tk.premio_a_pagar = premioMostrar;

            const bgRow = esGanador ? 'bg-emerald-50' : 'hover:bg-slate-50';
            
            cuerpoTickets.innerHTML += `
                <tr class="${bgRow} border-b border-slate-100 transition-colors">
                    <td class="p-2 text-center font-bold text-slate-500">${tk.id}</td>
                    <td class="p-2">
                        <span class="font-bold text-slate-800">${tk.cliente_juega_nombre}</span><br>
                        <span class="text-[9px] bg-slate-200 text-slate-700 px-1 rounded uppercase">${tk.grupo}</span>
                    </td>
                    <td class="p-2">
                        <span class="font-bold text-slate-700">${tk.nombre_jugada}</span><br>
                        <span class="text-[10px] text-blue-600">Ejemplar: ${tk.caballo} (${tk.cantidad_tablas} Tablas)</span>
                    </td>
                    <td class="p-2 text-right font-bold text-slate-700">
                        ${simbolo}${clubUI.formatoNumero(parseFloat(tk.monto_jugado), 2)}
                    </td>
                    <td class="p-2 text-right font-bold ${esGanador ? 'text-emerald-700' : 'text-slate-400'} bg-blue-50/30">
                        ${simbolo}${clubUI.formatoNumero(premioMostrar, 2)}
                    </td>
                    <td class="p-2 text-right font-bold text-purple-700 bg-purple-50/30">
                        ${simbolo}${comisionDináclubUI.formatoNumero(mica, 2)}
                        <div class="text-[9px] text-slate-500 font-normal">(${tk.comision_porcentaje}%)</div>
                    </td>
                    <td class="p-2 text-center">
                        <div class="flex justify-center gap-1">
                            <button class="btn-perdedor px-2 py-1 rounded text-[10px] font-bold ${!esGanador ? 'bg-red-500 text-white shadow-inner' : 'bg-slate-200 text-slate-500 hover:bg-red-200'}" data-index="${index}">
                                <i class="fas fa-times"></i> PIERDE
                            </button>
                            <button class="btn-ganador px-2 py-1 rounded text-[10px] font-bold ${esGanador ? 'bg-emerald-500 text-white shadow-inner' : 'bg-slate-200 text-slate-500 hover:bg-emerald-200'}" data-index="${index}">
                                <i class="fas fa-check"></i> GANA
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        });

        asignarEventosResultados();
        actualizarCuadreGlobal();
    }

    function asignarEventosResultados() {
        document.querySelectorAll('.btn-ganador').forEach(b => {
            b.addEventListener('click', (e) => {
                ticketsActuales[e.currentTarget.dataset.index].resultado_temp = 'GANADOR';
                renderizarTickets();
            });
        });
        document.querySelectorAll('.btn-perdedor').forEach(b => {
            b.addEventListener('click', (e) => {
                ticketsActuales[e.currentTarget.dataset.index].resultado_temp = 'PERDEDOR';
                renderizarTickets();
            });
        });
    }

    function actualizarCuadreGlobal() {
        let totalJugado = 0;
        let totalPremios = 0;
        let gruposResumen = {}; // Agrupación de comisiones

        ticketsActuales.forEach(tk => {
            // Unificamos todo en base 1 para los cálculos visuales, o asumimos que todo es multi-moneda por separado.
            // Simplificación contable: Mostraremos los totales netos. 
            // Si vendiste en Bs, debes hacer la conversión. Por ahora asumimos todo en USD para el global neto.
            let tasa = parseFloat(tk.tasa_cambio) || 1;
            let mult = tk.moneda === 'VES' ? (1 / tasa) : 1; 

            totalJugado += parseFloat(tk.monto_jugado) * mult;
            totalPremios += tk.premio_a_pagar * mult;

            let comisionNormalizada = tk.comision_calculada * mult;
            const llaveGrupo = `${tk.grupo} (${tk.moneda})`;
            
            if(!gruposResumen[llaveGrupo]) gruposResumen[llaveGrupo] = 0;
            gruposResumen[llaveGrupo] += tk.comision_calculada; // Guardamos en la moneda original para la tabla chica
        });

        let totalComisionesDolares = 0;
        cuerpoComisionesGrupos.innerHTML = '';
        for (const [nombre, monto] of Object.entries(gruposResumen)) {
            let simboloLocal = nombre.includes('VES') ? 'Bs ' : '$';
            let valorDolares = nombre.includes('VES') ? (monto / tasaCambioGlobal) : monto;
            totalComisionesDolares += valorDolares;

            cuerpoComisionesGrupos.innerHTML += `
                <tr>
                    <td class="p-2 border-b border-slate-100 font-bold text-slate-700 text-[10px]">${nombre}</td>
                    <td class="p-2 border-b border-slate-100 text-right font-bold text-purple-700">${simboloLocal}${clubUI.formatoNumero(monto, 2)}</td>
                </tr>
            `;
        }
        
        let utilidad = totalJugado - totalPremios - totalComisionesDolares;

        resMontoJugado.textContent = `$${clubUI.formatoNumero(totalJugado, 2)}`;
        resPremiosPagar.textContent = `$${clubUI.formatoNumero(totalPremios, 2)}`;
        resComisiones.textContent = `$${clubUI.formatoNumero(totalComisionesDolares, 2)}`;
        
        resUtilidadNeta.textContent = `$${clubUI.formatoNumero(utilidad, 2)}`;
        resUtilidadNeta.className = utilidad < 0 ? "text-lg font-black text-red-600" : "text-lg font-black text-emerald-600";
    }

    // ==========================================
    // 4. EJECUTAR LIQUIDACIÓN FINAL
    // ==========================================
    btnLiquidar.addEventListener('click', async () => {
        if(!confirm("¿Está seguro de Liquidar la carrera? Se pagarán los premios a los saldos de los clientes y los tickets se cerrarán definitivamente.")) return;

        btnLiquidar.innerHTML = '<i class="fas fa-spinner fa-spin"></i> PROCESANDO...';
        btnLiquidar.disabled = true;

        try {
            // 1. Obtener todos los clientes actuales para actualizar su saldo
            const { data: clientesData, error: errC } = await window.supabase.from('clientes').select('id, saldo_actual');
            if (errC) throw errC;

            // Procesar cada ticket de forma asíncrona
            for (let tk of ticketsActuales) {
                let nuevoEstado = tk.resultado_temp === 'GANADOR' ? 'Ganador' : 'Perdedor';
                
                // Actualizar DB Ticket (Guardando premio a pagar y comisión exacta calculada)
                await window.supabase.from('tickets_apuestas').update({
                    estado: nuevoEstado,
                    premio_pagar: tk.premio_a_pagar,
                    comision_pagada: tk.comision_calculada
                }).eq('id', tk.id);

                // Si es GANADOR, sumarle el premio al saldo del cliente
                if (nuevoEstado === 'Ganador' && tk.premio_a_pagar > 0) {
                    let cliente = clientesData.find(c => c.id === tk.cliente_juega_id);
                    if (cliente) {
                        // OJO: Asume que el cliente y el premio están en la misma moneda. 
                        // Si el cliente maneja un saldo universal (USD), debes aplicar la tasa si el premio es en VES.
                        let abono = tk.premio_a_pagar;
                        if(tk.moneda === 'VES') {
                            abono = tk.premio_a_pagar / parseFloat(tk.tasa_cambio); // Convertir premio VES a USD para la billetera del cliente
                        }

                        let nuevoSaldo = parseFloat(cliente.saldo_actual) + parseFloat(abono);
                        await window.supabase.from('clientes').update({ saldo_actual: nuevoSaldo }).eq('id', tk.cliente_juega_id);
                        cliente.saldo_actual = nuevoSaldo; // actualizar en memoria por si el cliente ganó varios tickets
                    }
                }
            }

            clubUI.toast("✅ ¡CARRERA LIQUIDADA CON ÉXITO! Los saldos fueron abonados a los ganadores.");
            if (window.clubDB?.logAccion) {
                const ganadores = ticketsActuales.filter(t => t.resultado_temp === 'GANADOR').length;
                const hipodromoCarreras = [...new Set(ticketsActuales.map(t => `${t.hipodromo} C${t.carrera}`))].join(', ') || '-';
                window.clubDB.logAccion('SALDOS', `liquidada: ${hipodromoCarreras} ganadores=${ganadores} total=${ticketsActuales.length} tickets`);
            }
            window.location.reload();

        } catch (error) {
            console.error(error);
            clubUI.toast("Ocurrió un error en la liquidación en la base de datos.");
            btnLiquidar.innerHTML = '<i class="fas fa-check-double mr-1"></i> Confirmar Cierre y Pagar Premios';
            btnLiquidar.disabled = false;
        }
    });

    inicializarFiltros();
});