document.addEventListener('DOMContentLoaded', () => {

    const tbody = document.getElementById('cuerpoTaquilla');
    const btnAgregarLineas = document.getElementById('btnAgregarLineas');
    const btnRegistrarCarrera = document.getElementById('btnRegistrarCarrera'); 
    const datalistClientes = document.getElementById('listaClientesDB');
    const datalistJugadas = document.getElementById('listaJugadasDB');
    const modalProcesando = document.getElementById('modalProcesando');
    
    document.getElementById('fechaCarrera').valueAsDate = new Date();

    let clientesList = [];
    let jugadasList = [];
    let tablasConfigList = [];
    let tasaCambioGlobal = 1.0;

    async function inicializarDatos() {
        const { data: clientes } = await window.supabase.from('clientes').select('id, nombre, saldo_actual').order('nombre');
        if (clientes) {
            clientesList = clientes;
            clientes.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.nombre;
                datalistClientes.appendChild(opt);
            });
        }

        const { data: jugadas } = await window.supabase.from('tipos_jugadas').select('*').eq('activo', true);
        if (jugadas) {
            jugadasList = jugadas;
            jugadas.forEach(j => {
                const opt = document.createElement('option');
                opt.value = j.nombre;
                datalistJugadas.appendChild(opt);
            });
        }

        const { data: tablas } = await window.supabase.from('tablas_fijas').select('*').eq('estado', 'Abierta');
        if (tablas) {
            tablasConfigList = tablas;
        }

        const { data: monedaData } = await window.supabase.from('monedas').select('tasa_cambio').limit(1).single();
        if (monedaData && monedaData.tasa_cambio) {
            tasaCambioGlobal = parseFloat(monedaData.tasa_cambio);
        }

        for(let i=1; i<=10; i++) agregarFila(i);
    }

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

    function asignarEventosFila(tr) {
        tr.querySelector('.btn-borrar').addEventListener('click', () => {
            tr.querySelectorAll('.input-tbl').forEach(i => i.value = '');
            tr.querySelector('.out-disp1').textContent = '-';
            tr.querySelector('.out-disp2').textContent = '-';
        });

        tr.querySelector('.in-juega').addEventListener('blur', function() {
            const cliente = clientesList.find(c => c.nombre === this.value.trim().toUpperCase());
            const celda = tr.querySelector('.out-disp1');
            if(cliente) {
                celda.textContent = parseFloat(cliente.saldo_actual).toLocaleString(undefined, {minimumFractionDigits: 2});
                celda.className = `p-1 border-r border-slate-200 text-center font-bold text-[11px] out-disp1 ${cliente.saldo_actual < 0 ? 'text-red-500' : 'text-slate-800'}`;
            } else { celda.textContent = '-'; }
        });

        tr.querySelector('.in-consigue').addEventListener('blur', function() {
            const cliente = clientesList.find(c => c.nombre === this.value.trim().toUpperCase());
            const celda = tr.querySelector('.out-disp2');
            if(cliente) {
                celda.textContent = parseFloat(cliente.saldo_actual).toLocaleString(undefined, {minimumFractionDigits: 2});
                celda.className = `p-1 text-center font-bold text-[11px] out-disp2 ${cliente.saldo_actual < 0 ? 'text-red-500' : 'text-slate-800'}`;
            } else { celda.textContent = '-'; }
        });
    }

    btnAgregarLineas.addEventListener('click', () => {
        for(let i=0; i<3; i++) agregarFila();
    });

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

            const cJuega = clientesList.find(c => c.nombre === clienteJuegaNombre);
            const cConsigue = clienteConsigueNombre ? clientesList.find(c => c.nombre === clienteConsigueNombre) : null;
            const jugadaRegla = jugadasList.find(j => j.nombre === jugada);

            if (!cJuega) {
                errores.push(`Línea ${index + 1}: El cliente que juega "${clienteJuegaNombre}" no existe.`);
                return;
            }

            let grupoVenta = 'GENERAL';
            let monedaTicket = 'USD';
            let comisionAplicada = comisionGlobalInput;
            let cantidadTablasVal = 1;

            if (jugada.includes('TABLA')) {
                const tablaAsociada = tablasConfigList.find(t => t.hipodromo.toUpperCase() === hipodromo.toUpperCase() && t.carrera == carrera);
                if (tablaAsociada) {
                    grupoVenta = tablaAsociada.grupo_venta;
                    monedaTicket = tablaAsociada.moneda;
                    comisionAplicada = tablaAsociada.comision_grupo;
                    cantidadTablasVal = tablaAsociada.cantidad_tablas;
                }
            }

            if(errores.length === 0) {
                ticketsValidos.push({
                    hipodromo, 
                    carrera, 
                    tipo_jugada_id: jugadaRegla ? jugadaRegla.id : null, 
                    nombre_jugada: jugada,
                    caballo, 
                    monto_jugado: monto, 
                    monto_decidido: monto, 
                    cliente_juega_id: cJuega.id, 
                    cliente_juega_nombre: cJuega.nombre,
                    cliente_consigue_id: cConsigue ? cConsigue.id : null, 
                    cliente_consigue_nombre: cConsigue ? cConsigue.nombre : null,
                    grupo: grupoVenta,
                    moneda: monedaTicket,
                    tasa_cambio: tasaCambioGlobal,
                    cantidad_tablas: cantidadTablasVal,
                    comision_porcentaje: comisionAplicada,
                    estado: 'Pendiente'
                });
            }
        });

        if (errores.length > 0) return alert("CORRIJA LOS SIGUIENTES ERRORES:\n\n" + errores.join('\n'));
        if (ticketsValidos.length === 0) return alert("No hay tickets ingresados.");

        modalProcesando.classList.remove('hidden');

        try {
            const { error: errTickets } = await window.supabase.from('tickets_apuestas').insert(ticketsValidos);
            if (errTickets) throw errTickets;

            for (const t of ticketsValidos) {
                const cJuega = clientesList.find(c => c.id === t.cliente_juega_id);
                const nuevoSaldo = parseFloat(cJuega.saldo_actual) - parseFloat(t.monto_jugado);
                await window.supabase.from('clientes').update({ saldo_actual: nuevoSaldo }).eq('id', t.cliente_juega_id);
                cJuega.saldo_actual = nuevoSaldo; 
            }

            alert(`✅ ¡ÉXITO! Se registraron ${ticketsValidos.length} apuestas.`);
            document.querySelectorAll('.btn-borrar').forEach(b => b.click());

        } catch (err) {
            console.error(err);
            alert("Error al guardar en la base de datos.");
        } finally {
            modalProcesando.classList.add('hidden');
        }
    });

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