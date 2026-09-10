document.addEventListener('DOMContentLoaded', () => {

    const tbody = document.getElementById('cuerpoTaquilla');
    const btnAgregarLineas = document.getElementById('btnAgregarLineas');
    const btnRegistrarCarrera = document.getElementById('btnRegistrarCarrera');
    const btnModalidadCruces = document.getElementById('btnModalidadCruces');
    const datalistClientes = document.getElementById('listaClientesDB');
    const datalistJugadas = document.getElementById('listaJugadasDB');
    const modalProcesando = document.getElementById('modalProcesando');
    const calc = window.clubCalculo;

    document.getElementById('fechaCarrera').valueAsDate = new Date();

    let clientesList = [];
    let jugadasList = [];
    let tablasConfigList = [];
    let tasaCambioGlobal = 1.0;
    let crucesActivo = true;

    // ------------------------------------------------------------------
    // CARGAS (robustas: no rompe si falta el SQL de columnas)
    // ------------------------------------------------------------------
    async function inicializarDatos() {
        window.clubIndicador?.accion('Cargando clientes, saldos y jugadas…');
        const segura = (promesa) => promesa.catch(e => ({ data: null, error: e }));
        const [rClientes, rJugadas, rTablas, rMoneda, rHipodromos] = await Promise.all([
            segura(window.supabase.from('clientes').select('*').order('nombre')),
            segura(window.supabase.from('tipos_jugadas').select('*').eq('activo', true).order('nombre')),
            segura(window.supabase.from('tablas_fijas').select('*').eq('estado', 'Abierta')),
            segura(window.supabase.from('monedas').select('tasa_cambio').limit(1).single()),
            segura(window.supabase.from('hipodromos').select('nombre').order('nombre'))
        ]);

        const clientes = rClientes.data;
        const jugadas = rJugadas.data;
        const tablas = rTablas.data;
        const monedaData = rMoneda.data;
        const hipodromosDB = rHipodromos.data;

        if (rClientes.error) {
            clubUI.toast('No se pudieron cargar los clientes. Ejecute el paquete SQL (secciones 0 y 7) y recargue.', 'error');
        }
        if (rJugadas.error) {
            clubUI.toast('No se pudieron cargar las jugadas. Revisa la tabla tipos_jugadas.', 'error');
        }

        if (hipodromosDB && hipodromosDB.length) {
            const selectHip = document.getElementById('selectHipodromo');
            if (selectHip) {
                selectHip.innerHTML = hipodromosDB
                    .map(h => `<option value="${h.nombre}">${h.nombre}</option>`)
                    .join('');
            }
        }

        if (clientes) {
            clientesList = clientes;
            datalistClientes.innerHTML = '';
            clientes.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.seudonimo || c.nombre;
                datalistClientes.appendChild(opt);
            });
        }

        if (jugadas) {
            jugadasList = jugadas;
            datalistJugadas.innerHTML = '';
            jugadas.forEach(j => {
                const opt = document.createElement('option');
                opt.value = j.nombre;
                datalistJugadas.appendChild(opt);
            });
        }

        if (tablas) tablasConfigList = tablas;
        if (monedaData && monedaData.tasa_cambio) tasaCambioGlobal = parseFloat(monedaData.tasa_cambio);

        for (let i = 1; i <= 10; i++) agregarFila(i);
        window.clubIndicador?.fin();
    }

    // Busca por nombre, seudónimo o apellido (insensible a mayúsculas)
    function buscarCliente(txt) {
        const t = String(txt || '').trim().toUpperCase();
        if (!t) return null;
        return clientesList.find(c =>
            c.nombre === t ||
            (c.seudonimo || '').toUpperCase() === t ||
            (c.apellido || '').toUpperCase() === t
        ) || null;
    }

    // ------------------------------------------------------------------
    // FILAS DE TAQUILLA
    // ------------------------------------------------------------------
    function agregarFila(indice = null) {
        const tr = document.createElement('tr');
        tr.className = 'border-b border-slate-200 fila-ticket hover:bg-slate-50 transition-colors';
        const numLinea = indice || document.querySelectorAll('.fila-ticket').length + 1;

        tr.innerHTML = `
            <td class="p-1 border-r border-slate-200 text-center font-bold text-slate-700 bg-slate-100 w-8">${numLinea}</td>
            <td class="p-1 border-r border-slate-200 text-center w-16">
                <button type="button" class="text-red-500 border border-red-200 rounded px-1.5 py-0.5 hover:bg-red-50 text-[10px] btn-borrar"><i class="fas fa-times"></i></button>
            </td>
            <td class="p-1 border-r border-slate-200">
                <input type="text" list="listaJugadasDB" class="input-tbl in-jugada" placeholder="ESCRIBA...">
            </td>
            <td class="p-1 border-r border-slate-200">
                <input type="text" class="input-tbl in-caballo" placeholder="Ej: 5 o 2x3 o 4*8">
            </td>
            <td class="p-1 border-r border-slate-200">
                <input type="number" step="0.01" class="input-tbl in-monto text-right font-bold text-emerald-700" placeholder="0.00">
            </td>
            <td class="p-1 border-r border-slate-200 text-center">
                <span class="out-cobro text-slate-400 font-mono text-[10px] font-bold">-</span>
            </td>
            <td class="p-1 border-r border-slate-200">
                <input type="text" list="listaClientesDB" class="input-tbl in-juega" placeholder="Buscar Cliente...">
            </td>
            <td class="p-1 border-r border-slate-200">
                <input type="text" list="listaClientesDB" class="input-tbl in-consigue" placeholder="Buscar Cliente...">
            </td>
            <td class="p-1 border-r border-slate-200 text-center text-slate-500 font-bold text-[11px] out-disp1">-</td>
            <td class="p-1 text-center text-slate-500 font-bold text-[11px] out-disp2">-</td>
        `;

        tbody.appendChild(tr);
        asignarEventosFila(tr);
    }

    function recalcularCobro(tr) {
        const monto = parseFloat(tr.querySelector('.in-monto').value);
        const caballo = tr.querySelector('.in-caballo').value.trim();
        const outCobro = tr.querySelector('.out-cobro');
        if (isNaN(monto) || monto <= 0 || !caballo) { outCobro.textContent = '-'; return; }
        const n = crucesActivo ? (calc.numeroDeCruces(caballo) || 1) : 1;
        const total = calc.costoDeLinea(monto, n);
        outCobro.textContent = n > 1 ? `${n}× $${clubUI.formatoNumero(total, 2)}` : `$${clubUI.formatoNumero(total, 2)}`;
        outCobro.className = `out-cobro font-mono text-[10px] font-bold ${n > 1 ? 'text-orange-600' : 'text-slate-500'}`;
    }

    function asignarEventosFila(tr) {
        tr.querySelector('.btn-borrar').addEventListener('click', () => {
            tr.querySelectorAll('.input-tbl').forEach(i => i.value = '');
            tr.querySelector('.out-disp1').textContent = '-';
            tr.querySelector('.out-disp2').textContent = '-';
            tr.querySelector('.out-cobro').textContent = '-';
            tr.querySelector('.out-cobro').className = 'out-cobro text-slate-400 font-mono text-[10px] font-bold';
        });

        ['in-caballo', 'in-monto', 'in-jugada'].forEach(sel => {
            tr.querySelector('.' + sel).addEventListener('input', () => recalcularCobro(tr));
        });

        tr.querySelector('.in-juega').addEventListener('blur', function() {
            const cliente = buscarCliente(this.value);
            const celda = tr.querySelector('.out-disp1');
            if (cliente) {
                celda.textContent = clubUI.formatoNumero(parseFloat(cliente.saldo_actual || 0), 2);
                celda.className = `p-1 border-r border-slate-200 text-center font-bold text-[11px] out-disp1 ${cliente.saldo_actual < 0 ? 'text-red-500' : 'text-slate-800'}`;
            } else { celda.textContent = '-'; }
        });

        tr.querySelector('.in-consigue').addEventListener('blur', function() {
            const cliente = buscarCliente(this.value);
            const celda = tr.querySelector('.out-disp2');
            if (cliente) {
                celda.textContent = clubUI.formatoNumero(parseFloat(cliente.saldo_actual || 0), 2);
                celda.className = `p-1 text-center font-bold text-[11px] out-disp2 ${cliente.saldo_actual < 0 ? 'text-red-500' : 'text-slate-800'}`;
            } else { celda.textContent = '-'; }
        });
    }

    btnAgregarLineas.addEventListener('click', () => {
        for (let i = 0; i < 3; i++) agregarFila();
    });

    // Toggle de cruces
    btnModalidadCruces?.addEventListener('click', () => {
        crucesActivo = !crucesActivo;
        btnModalidadCruces.innerHTML = crucesActivo
            ? '<i class="fas fa-random text-blue-500 mr-1"></i> Modalidad: CON CRUCES'
            : '<i class="fas fa-minus-circle text-slate-400 mr-1"></i> Modalidad: SIN CRUCES (un número por línea)';
        btnModalidadCruces.className = crucesActivo
            ? 'w-full bg-slate-100 border border-slate-300 rounded p-1.5 text-slate-700 font-bold hover:bg-slate-200 transition-colors text-xs'
            : 'w-full bg-white border border-slate-200 rounded p-1.5 text-slate-500 font-bold hover:bg-slate-50 transition-colors text-xs';
        document.querySelectorAll('.fila-ticket').forEach(recalcularCobro);
    });

    // ------------------------------------------------------------------
    // REGISTRO DE CARRERA (cobro + pago quedan estructurados)
    // ------------------------------------------------------------------
    btnRegistrarCarrera.addEventListener('click', async () => {
        const hipodromo = document.getElementById('selectHipodromo').value.trim();
        const carrera = document.getElementById('selectCarrera').value;
        const comisionGlobalInput = parseFloat(document.getElementById('inputComision')?.value) || 5;

        let ticketsValidos = [];
        let errores = [];

        document.querySelectorAll('.fila-ticket').forEach((tr, index) => {
            const jugada = tr.querySelector('.in-jugada').value.trim().toUpperCase();
            const caballo = tr.querySelector('.in-caballo').value.trim().toUpperCase();
            const monto = parseFloat(tr.querySelector('.in-monto').value);
            const clienteJuegaNombre = tr.querySelector('.in-juega').value.trim().toUpperCase();
            const clienteConsigueNombre = tr.querySelector('.in-consigue').value.trim().toUpperCase();

            if (!jugada && !caballo && isNaN(monto)) return;
            if (!jugada || !caballo || isNaN(monto) || monto <= 0 || !clienteJuegaNombre) {
                errores.push(`Línea ${index + 1}: Faltan datos obligatorios (Jugada, Caballo, Monto, Juega).`);
                return;
            }

            const cJuega = buscarCliente(clienteJuegaNombre);
            const cConsigue = clienteConsigueNombre ? buscarCliente(clienteConsigueNombre) : null;
            const jugadaRegla = jugadasList.find(j => j.nombre === jugada);

            if (!cJuega) {
                errores.push(`Línea ${index + 1}: El cliente "${clienteJuegaNombre}" no existe.`);
                return;
            }

            // Cruces y COBRO total de la línea
            const cruces = crucesActivo ? calc.numeroDeCruces(caballo) : 1;
            if (!cruces) {
                errores.push(`Línea ${index + 1}: Caballo inválido ("${caballo}"). Use un número (5) o cruce (2x3).`);
                return;
            }
            if (cruces === 1 && !/^\d+$/.test(caballo)) {
                errores.push(`Línea ${index + 1}: El caballo "${caballo}" no parece un número válido.`);
                return;
            }
            const costoLinea = calc.costoDeLinea(monto, cruces);

            // REGLA DE NEGOCIO (AVAL): límite de pérdida nunca supera -AVAL
            const modoJuega = cJuega.modo_juego || (cJuega.libre ? 'libre' : 'aval');
            const saldoJuega = parseFloat(cJuega.saldo_actual || 0);
            if (modoJuega === 'pozo') {
                if (saldoJuega < costoLinea) {
                    errores.push(`Línea ${index + 1}: ${cJuega.nombre} juega con Pozo y solo tiene $${clubUI.formatoNumero(saldoJuega, 2)} (cuesta $${clubUI.formatoNumero(costoLinea, 2)}). Debe abonar antes de jugar.`);
                    return;
                }
            } else if (!cJuega.libre && modoJuega !== 'libre') {
                const limiteAval = parseFloat(cJuega.aval || 0);
                if ((saldoJuega - costoLinea) < -limiteAval) {
                    errores.push(`Línea ${index + 1}: ${cJuega.nombre} superaría su límite de AVAL ($${clubUI.formatoNumero(limiteAval, 2)}). Debe abonar antes de jugar.`);
                    return;
                }
            }

            // Jugada por tabla (fija/pizarra) o por unidad
            const esTabla = calc.esPorTabla(jugadaRegla, jugada);
            let tablaAsociada = null;
            if (esTabla) {
                tablaAsociada = tablasConfigList.find(t =>
                    String(t.hipodromo || '').toUpperCase() === hipodromo.toUpperCase() && t.carrera == carrera
                );
                if (!tablaAsociada) {
                    errores.push(`Línea ${index + 1}: No hay tabla "Abierta" para ${hipodromo} C${carrera}.`);
                    return;
                }
            }

            const premio = calc.premioPorTicket(monto, jugadaRegla, tablaAsociada);
            const comision = (premio.comision_porcentaje != null)
                ? premio.comision_porcentaje
                : (jugadaRegla && !isNaN(parseFloat(jugadaRegla.comision_porcentaje))
                    ? parseFloat(jugadaRegla.comision_porcentaje)
                    : comisionGlobalInput);

            // Uno o varios tickets: uno POR CADA EJEMPLAR del cruce (así se paga por ganador)
            const ejemplares = crucesActivo ? calc.parsearCaballos(caballo) : [caballo];

            ejemplares.forEach(ej => {
                ticketsValidos.push({
                    hipodromo,
                    carrera,
                    tipo_jugada_id: jugadaRegla ? jugadaRegla.id : null,
                    nombre_jugada: jugada,
                    caballo: ej,
                    monto_jugado: monto,
                    monto_decidido: monto,
                    cliente_juega_id: cJuega.id,
                    cliente_juega_nombre: cJuega.nombre,
                    cliente_consigue_id: cConsigue ? cConsigue.id : null,
                    cliente_consigue_nombre: cConsigue ? cConsigue.nombre : null,
                    grupo: premio.grupo,
                    moneda: premio.moneda,
                    tasa_cambio: tasaCambioGlobal,
                    cantidad_tablas: premio.cantidad_tablas,
                    premio_por_tabla: premio.premio_por_tabla,
                    comision_porcentaje: comision,
                    estado: 'Pendiente'
                });
            });
        });

        if (errores.length > 0) return clubUI.toast("CORRIJA LOS SIGUIENTES ERRORES:\n\n" + errores.join('\n'));
        if (ticketsValidos.length === 0) return clubUI.toast("No hay tickets ingresados.");

        modalProcesando.classList.remove('hidden');
        window.clubIndicador?.accion('Guardando boletos y saldos…');

        try {
            const { error: errTickets } = await window.supabase.from('tickets_apuestas').insert(ticketsValidos);
            if (errTickets) throw errTickets;

            // Descuento solo para modo POZO (el monto de cada ticket)
            for (const t of ticketsValidos) {
                const cJuega = clientesList.find(c => c.id === t.cliente_juega_id);
                const modo = cJuega.modo_juego || (cJuega.libre ? 'libre' : 'aval');
                if (modo !== 'pozo') continue;
                const nuevoSaldo = parseFloat(cJuega.saldo_actual || 0) - parseFloat(t.monto_jugado);
                await window.supabase.from('clientes').update({ saldo_actual: nuevoSaldo }).eq('id', t.cliente_juega_id);
                cJuega.saldo_actual = nuevoSaldo;
            }

            const uni = [...new Set(ticketsValidos.map(t => `${t.hipodromo} C${t.carrera}`))].join(', ') || '-';
            clubUI.toast(`⏺ ¡ÉXITO! ${ticketsValidos.length} boleto(s) registrados (${[...new Set(ticketsValidos.map(t => t.caballo))].join(',')}) en ${uni}.`);
            if (window.clubDB?.logAccion) window.clubDB.logAccion('TAQUILLA', `apuestas_registradas: ${ticketsValidos.length} boletos, ${[...new Set(ticketsValidos.map(t => t.hipodromo + ' C' + t.carrera))].join(', ') || '-'}`);
            document.querySelectorAll('.btn-borrar').forEach(b => b.click());

        } catch (err) {
            console.error(err);
            clubUI.toast("Error al guardar en la base de datos.", 'error');
        } finally {
            modalProcesando.classList.add('hidden');
            window.clubIndicador?.fin();
        }
    });

    // ------------------------------------------------------------------
    // VENTANA FLOTANTE (pasiva; los comandos se procesarán en taquilla.js)
    // ------------------------------------------------------------------
    const ventana = document.getElementById('ventanaTransacciones');
    const cabecera = document.getElementById('cabeceraTransacciones');
    let isDragging = false, offsetX, offsetY;

    cabecera.addEventListener('mousedown', (e) => {
        isDragging = true;
        offsetX = e.clientX - ventana.getBoundingClientRect().left;
        offsetY = e.clientY - ventana.getBoundingClientRect().top;
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        ventana.style.left = `${e.clientX - offsetX}px`;
        ventana.style.top = `${e.clientY - offsetY}px`;
        ventana.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => isDragging = false);

    inicializarDatos();
});