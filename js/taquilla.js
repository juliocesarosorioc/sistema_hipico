// Archivo: js/taquilla.js
// Propósito: Conexión de apuestas a BD, conservación de probabilidades y Parser IA para ventana flotante.

document.addEventListener('DOMContentLoaded', () => {

    const cuerpoTaquilla = document.getElementById('cuerpoTaquilla');
    const btnAgregarLineas = document.getElementById('btnAgregarLineas');
    const selectHipodromo = document.getElementById('selectHipodromo');
    const datalistClientes = document.getElementById('listaClientesDB');
    const btnRegistrarCarrera = document.getElementById('btnRegistrarCarrera');
    
    document.getElementById('fechaCarrera').value = new Date().toISOString().split('T')[0];

    let clientesGlobal = []; // Caché para validaciones rápidas
    let contadorLineas = 0;

    // ==========================================
    // 1. CARGAR DATOS BASE (Hipódromos y Clientes)
    // ==========================================
    async function cargarDatosBase() {
        // Hipódromos
        const { data: hipodromos } = await supabase.from('hipodromos').select('id, nombre').order('nombre');
        if (hipodromos && hipodromos.length > 0) {
            selectHipodromo.innerHTML = '';
            hipodromos.forEach(h => selectHipodromo.innerHTML += `<option value="${h.id}">${h.nombre}</option>`);
        } else {
            selectHipodromo.innerHTML = '<option value="">Sin hipódromos - Configurar en catálogos</option>';
        }

        // Clientes para el Autocompletado (Datalist)
        const { data: clientes } = await supabase.from('clientes').select('id, nombre, saldo_usd, aval_usd');
        if (clientes) {
            clientesGlobal = clientes;
            datalistClientes.innerHTML = '';
            clientes.forEach(c => {
                datalistClientes.innerHTML += `<option value="${c.nombre}">`;
            });
        }
    }

    // ==========================================
    // 2. GENERADOR DINÁMICO DE TAQUILLA
    // ==========================================
    function crearLineaApuesta() {
        contadorLineas++;
        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50 transition-colors fila-apuesta";
        
        tr.innerHTML = `
            <td class="p-2 text-center font-bold text-slate-500">${contadorLineas}</td>
            <td class="p-2 text-center">
                <button class="text-red-500 hover:text-red-700 px-1 border border-red-200 rounded mr-1 btn-eliminar-fila" onclick="this.closest('tr').remove()"><i class="fas fa-times"></i></button>
            </td>
            <td class="p-1"><input type="text" class="inp-jugada w-full border border-slate-300 rounded p-1 text-xs outline-none focus:border-blue-500 uppercase" placeholder="Ej: W, P, S..."></td>
            <td class="p-1"><input type="text" class="inp-caballo w-full border border-slate-300 rounded p-1 text-xs outline-none focus:border-blue-500" placeholder="Ej: 5 o 2x3"></td>
            
            <!-- CAMPOS CRÍTICOS DE PROBABILIDAD (Conservados según directiva del usuario) -->
            <td class="p-1 flex gap-1 bg-indigo-50">
                <input type="number" step="0.01" class="inp-prob-pct w-1/2 border border-slate-300 rounded p-1 text-xs text-center font-mono outline-none focus:border-indigo-500" placeholder="%">
                <input type="number" step="0.01" class="inp-prob-imp w-1/2 border border-slate-300 rounded p-1 text-xs text-center font-mono outline-none focus:border-indigo-500" placeholder="Imp.">
            </td>
            
            <td class="p-1"><input type="number" step="0.01" class="inp-monto w-full border border-slate-300 rounded p-1 text-xs text-right font-bold outline-none focus:border-blue-500" placeholder="0.00"></td>
            <td class="p-1"><input type="text" list="listaClientesDB" class="inp-cliente1 w-full border border-slate-300 rounded p-1 text-xs outline-none focus:border-blue-500 uppercase" placeholder="Buscar Cliente..."></td>
            <td class="p-1"><input type="text" list="listaClientesDB" class="inp-cliente2 w-full border border-slate-300 rounded p-1 text-xs outline-none focus:border-blue-500 uppercase" placeholder="Buscar Cliente..."></td>
        `;
        cuerpoTaquilla.appendChild(tr);
    }

    // Generar 10 iniciales
    for (let i = 0; i < 10; i++) crearLineaApuesta();
    btnAgregarLineas.addEventListener('click', () => { for (let i = 0; i < 5; i++) crearLineaApuesta(); });

    // ==========================================
    // 3. REGISTRAR CARRERA Y DESCONTAR SALDOS
    // ==========================================
    btnRegistrarCarrera.addEventListener('click', async function() {
        const hipodromoId = selectHipodromo.value;
        const carrera = document.getElementById('selectCarrera').value;

        if (!hipodromoId) {
            alert("Seleccione un hipódromo válido antes de registrar.");
            return;
        }

        const filas = document.querySelectorAll('.fila-apuesta');
        let ticketsAInsertar = [];
        let errores = [];

        // Extraer y validar datos de la tabla
        filas.forEach((fila, index) => {
            const monto = parseFloat(fila.querySelector('.inp-monto').value);
            const nombreCli1 = fila.querySelector('.inp-cliente1').value.trim().toUpperCase();
            
            if (monto > 0 && nombreCli1 !== "") {
                const clienteObj = clientesGlobal.find(c => c.nombre === nombreCli1);
                const nombreCli2 = fila.querySelector('.inp-cliente2').value.trim().toUpperCase();
                const clienteObj2 = clientesGlobal.find(c => c.nombre === nombreCli2); // Puede ser undefined

                if (!clienteObj) {
                    errores.push(`Fila ${index + 1}: El cliente '${nombreCli1}' no existe en la base de datos.`);
                } else if (clienteObj.saldo_usd < monto) {
                    errores.push(`Fila ${index + 1}: ${clienteObj.nombre} no tiene saldo suficiente (Saldo: $${clienteObj.saldo_usd}).`);
                } else {
                    // Preparamos el ticket conservando las probabilidades
                    ticketsAInsertar.push({
                        cliente_obj: clienteObj,
                        ticket_data: {
                            hipodromo_id: hipodromoId,
                            carrera: carrera,
                            jugada: fila.querySelector('.inp-jugada').value.toUpperCase(),
                            caballo: fila.querySelector('.inp-caballo').value,
                            prob_porcentaje: parseFloat(fila.querySelector('.inp-prob-pct').value) || 0.00,
                            prob_implicita: parseFloat(fila.querySelector('.inp-prob-imp').value) || 0.00,
                            monto_usd: monto,
                            cliente_juega_id: clienteObj.id,
                            cliente_consigue_id: clienteObj2 ? clienteObj2.id : null
                        }
                    });
                }
            }
        });

        if (errores.length > 0) {
            alert("NO SE PUEDE PROCESAR LA CARRERA. Corrija los siguientes errores:\n\n" + errores.join("\n"));
            return;
        }

        if (ticketsAInsertar.length === 0) {
            alert("No hay jugadas válidas con monto y cliente asignado.");
            return;
        }

        if (confirm(`¿Confirma el registro de ${ticketsAInsertar.length} jugadas en la base de datos y el descuento de saldos?`)) {
            const textoOriginal = this.innerHTML;
            this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Registrando...';
            this.disabled = true;

            try {
                for (let item of ticketsAInsertar) {
                    // 1. Descontar saldo del cliente 1
                    const nuevoSaldo = Number(item.cliente_obj.saldo_usd) - item.ticket_data.monto_usd;
                    await supabase.from('clientes').update({ saldo_usd: nuevoSaldo }).eq('id', item.cliente_obj.id);
                    
                    // 2. Insertar ticket
                    await supabase.from('taquilla_tickets').insert([item.ticket_data]);
                    
                    // Actualizar caché local para no recargar todo
                    item.cliente_obj.saldo_usd = nuevoSaldo; 
                }
                
                alert("✅ Carrera procesada exitosamente. Tickets guardados y saldos descontados.");
                
                // Limpiar tabla
                cuerpoTaquilla.innerHTML = '';
                contadorLineas = 0;
                for (let i = 0; i < 10; i++) crearLineaApuesta();

            } catch (error) {
                console.error(error);
                alert("Ocurrió un error al procesar la base de datos.");
            }

            this.innerHTML = textoOriginal;
            this.disabled = false;
        }
    });

    // ==========================================
    // 4. IA / PARSER DE TRANSACCIONES RÁPIDAS
    // ==========================================
    const btnProcesar = document.getElementById('btnProcesarTransacciones');
    const cajaTexto = document.getElementById('textoTransacciones');
    document.getElementById('btnLimpiarTransacciones').addEventListener('click', () => cajaTexto.value = '');

    btnProcesar.addEventListener('click', async function() {
        const textoBruto = cajaTexto.value.trim().split('\n');
        let operacionesEjecutadas = 0;

        if (textoBruto.length === 0 || textoBruto[0] === "") return;

        this.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        
        for (let linea of textoBruto) {
            if (linea.trim() === '') continue;
            
            const partes = linea.trim().split(' ').map(p => p.toUpperCase());
            
            if (partes.length >= 2) {
                const nombreCli1 = partes[0];
                const cliente1 = clientesGlobal.find(c => c.nombre === nombreCli1);
                
                if (!cliente1) {
                    console.log(`Fallo Parseo: Cliente ${nombreCli1} no encontrado.`);
                    continue;
                }

                // Extraer el número matemático
                const strNumero = partes.find(p => p.includes('+') || p.includes('-') || !isNaN(p));
                const montoOriginal = parseFloat(strNumero);
                const montoAbsoluto = Math.abs(montoOriginal);

                // Evaluar la intención según la semántica
                if (linea.toLowerCase().includes('aval')) {
                    const nuevoAval = montoOriginal > 0 ? Number(cliente1.aval_usd) + montoAbsoluto : Math.max(0, Number(cliente1.aval_usd) - montoAbsoluto);
                    await supabase.from('clientes').update({ aval_usd: nuevoAval }).eq('id', cliente1.id);
                    cliente1.aval_usd = nuevoAval; // actualizar caché
                    operacionesEjecutadas++;
                } 
                else if (partes.length >= 3 && !isNaN(partes[1])) {
                    // Formato TRASLADO: FRANK 100 LUIS (Frank envía a Luis)
                    const nombreCli2 = partes[2];
                    const cliente2 = clientesGlobal.find(c => c.nombre === nombreCli2);
                    
                    if (cliente2 && montoAbsoluto > 0) {
                        await supabase.from('clientes').update({ saldo_usd: Number(cliente1.saldo_usd) - montoAbsoluto }).eq('id', cliente1.id);
                        await supabase.from('clientes').update({ saldo_usd: Number(cliente2.saldo_usd) + montoAbsoluto }).eq('id', cliente2.id);
                        await supabase.from('retiros').insert([{ cliente_id: cliente1.id, monto_usd: montoAbsoluto, referencia: `Traslado a ${cliente2.nombre} (Ventanilla Flotante)` }]);
                        await supabase.from('depositos').insert([{ cliente_id: cliente2.id, monto_usd: montoAbsoluto, monto_local: montoAbsoluto, tasa: 1, referencia: `Traslado de ${cliente1.nombre} (Ventanilla Flotante)` }]);
                        
                        cliente1.saldo_usd -= montoAbsoluto; cliente2.saldo_usd += montoAbsoluto;
                        operacionesEjecutadas++;
                    }
                }
                else if (montoOriginal > 0) {
                    // Formato DEPÓSITO: LUIS +100
                    await supabase.from('clientes').update({ saldo_usd: Number(cliente1.saldo_usd) + montoAbsoluto }).eq('id', cliente1.id);
                    await supabase.from('depositos').insert([{ cliente_id: cliente1.id, monto_usd: montoAbsoluto, monto_local: montoAbsoluto, tasa: 1, referencia: 'Depósito Rápido (Ventanilla Flotante)' }]);
                    cliente1.saldo_usd += montoAbsoluto;
                    operacionesEjecutadas++;
                }
                else if (montoOriginal < 0) {
                    // Formato RETIRO: JUAN -100
                    await supabase.from('clientes').update({ saldo_usd: Number(cliente1.saldo_usd) - montoAbsoluto }).eq('id', cliente1.id);
                    await supabase.from('retiros').insert([{ cliente_id: cliente1.id, monto_usd: montoAbsoluto, referencia: 'Retiro Rápido (Ventanilla Flotante)' }]);
                    cliente1.saldo_usd -= montoAbsoluto;
                    operacionesEjecutadas++;
                }
            }
        }

        this.innerHTML = `<span><i class="fas fa-check-square text-emerald-400 mr-1"></i> Procesar</span><span class="text-[9px] text-slate-400 mt-1">Ctrl+Shift+L</span>`;
        alert(`Comandos procesados. ${operacionesEjecutadas} transacciones financieras ejecutadas en la nube.`);
        cajaTexto.value = '';
    });

    // Atajos de teclado (Parser)
    document.addEventListener('keydown', function(e) {
        if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'l') {
            e.preventDefault();
            btnProcesar.click();
        }
    });

    // ==========================================
    // 5. FÍSICA DE VENTANA FLOTANTE (DRAG & DROP)
    // ==========================================
    const ventana = document.getElementById('ventanaTransacciones');
    const cabecera = document.getElementById('cabeceraTransacciones');
    let isDragging = false, startX, startY, initialX, initialY;

    cabecera.addEventListener('mousedown', function(e) {
        isDragging = true;
        startX = e.clientX; startY = e.clientY;
        const rect = ventana.getBoundingClientRect();
        initialX = rect.left; initialY = rect.top;
        ventana.style.right = 'auto'; ventana.style.bottom = 'auto';
        ventana.style.left = initialX + 'px'; ventana.style.top = initialY + 'px';
    });

    document.addEventListener('mousemove', function(e) {
        if (!isDragging) return;
        e.preventDefault();
        ventana.style.left = (initialX + (e.clientX - startX)) + 'px';
        ventana.style.top = (initialY + (e.clientY - startY)) + 'px';
    });

    document.addEventListener('mouseup', () => isDragging = false);

    // Inicializar
    cargarDatosBase();
});