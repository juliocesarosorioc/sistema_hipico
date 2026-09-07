// Archivo: js/retiros.js
// Propósito: Controlar el formulario de retiros, el vaciado de cuentas (En cero), UI de pestañas y conexión con Supabase.

document.addEventListener('DOMContentLoaded', function() {

    const formRetiro = document.getElementById('formRetiro');
    const selectorCliente = document.getElementById('clienteRetiro');
    const inputMonto = document.getElementById('montoRetiro');
    const checkEnCero = document.getElementById('checkEnCero');
    const cuerpoHistorial = document.getElementById('cuerpoTablaHistorial');
    const cuerpoSaldos = document.getElementById('cuerpoTablaSaldos');
    
    // Configurar fechas
    const hoy = new Date();
    document.getElementById('fechaHeader').textContent = hoy.toLocaleString('es-ES');
    document.getElementById('filtroFecha').value = hoy.toISOString().split('T')[0];

    // ==========================================
    // 1. SISTEMA DE PESTAÑAS (TABS) DE OPERACIÓN
    // ==========================================
    const tabs = document.querySelectorAll('.tab-operacion');
    let operacionSeleccionada = 'Retiro Normal';

    tabs.forEach(tab => {
        tab.addEventListener('click', function() {
            // Reiniciar pestañas
            tabs.forEach(t => {
                t.className = 'tab-operacion flex-1 py-2 text-slate-500 bg-white hover:bg-slate-50 border-b-2 border-transparent transition-colors';
            });

            // Activar pestaña clicada
            const tipo = this.getAttribute('data-tipo');
            operacionSeleccionada = tipo;

            if (tipo === 'Retiro Normal') {
                this.className = 'tab-operacion flex-1 py-2 text-white bg-red-600 border-b-2 border-red-700 shadow-inner transition-colors';
            } else if (tipo === 'Retirar Aval') {
                this.className = 'tab-operacion flex-1 py-2 text-cyan-700 bg-cyan-50 border-b-2 border-cyan-500 transition-colors';
            }

            // Si está marcado "En cero", recalcular con la nueva pestaña seleccionada
            if (checkEnCero.checked) aplicarSaldoCero();
        });
    });

    // ==========================================
    // 2. CARGAR DATOS DESDE SUPABASE (Read)
    // ==========================================
    async function cargarDatosGenerales() {
        // A. Clientes y Saldos
        const { data: clientes } = await supabase.from('clientes').select('id, nombre, saldo_usd, aval_usd').order('nombre');
        
        if (clientes) {
            selectorCliente.innerHTML = '<option value="">— Seleccione Cliente —</option>';
            cuerpoSaldos.innerHTML = '';

            clientes.forEach(c => {
                // Inyectamos data-saldo y data-aval para que la función "En Cero" los lea fácilmente
                selectorCliente.innerHTML += `<option value="${c.id}" data-saldo="${c.saldo_usd}" data-aval="${c.aval_usd}">${c.nombre} - Saldo: $${Number(c.saldo_usd).toFixed(2)} | Aval: $${Number(c.aval_usd).toFixed(2)}</option>`;
                
                cuerpoSaldos.innerHTML += `
                    <tr class="hover:bg-slate-50">
                        <td class="p-2 border-r border-slate-200 font-bold">${c.nombre}</td>
                        <td class="p-2 text-right border-r border-slate-200 text-emerald-700 font-bold">$${Number(c.saldo_usd).toFixed(2)}</td>
                        <td class="p-2 text-right text-amber-600 font-bold">$${Number(c.aval_usd).toFixed(2)}</td>
                    </tr>
                `;
            });
        }

        // B. Historial de Retiros
        const { data: retiros } = await supabase
            .from('retiros')
            .select('monto_usd, referencia, fecha_registro, clientes(nombre)')
            .order('fecha_registro', { ascending: false })
            .limit(20);

        if (retiros && retiros.length > 0) {
            cuerpoHistorial.innerHTML = '';
            retiros.forEach(ret => {
                const nombre = ret.clientes ? ret.clientes.nombre : '—';
                const fecha = new Date(ret.fecha_registro).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
                
                let tipoVisual = '<span class="bg-red-100 text-red-700 px-2 py-0.5 rounded text-[10px] font-bold">RETIRO NORMAL</span>';
                let nota = ret.referencia || '—';

                if (nota.startsWith('[AVAL]')) {
                    tipoVisual = '<span class="bg-cyan-100 text-cyan-700 px-2 py-0.5 rounded text-[10px] font-bold">RETIRO AVAL</span>';
                    nota = nota.replace('[AVAL] ', '');
                }

                cuerpoHistorial.innerHTML += `
                    <tr class="hover:bg-slate-50">
                        <td class="p-2.5 font-bold text-slate-800">${nombre}</td>
                        <td class="p-2.5">${tipoVisual}</td>
                        <td class="p-2.5 text-right font-bold text-red-600">-$${Number(ret.monto_usd).toFixed(2)}</td>
                        <td class="p-2.5 text-slate-500">${fecha}</td>
                        <td class="p-2.5 text-slate-600 truncate max-w-[150px]">${nota}</td>
                        <td class="p-2.5 text-center"><button class="text-slate-400 hover:text-red-500"><i class="fas fa-trash-alt"></i></button></td>
                    </tr>
                `;
            });
        } else {
            cuerpoHistorial.innerHTML = '<tr><td colspan="6" class="p-4 text-center text-slate-500 bg-slate-50 border-b border-slate-200">Ningún dato disponible en esta tabla</td></tr>';
        }
    }

    // ==========================================
    // 3. LÓGICA DE "EN CERO" (Vaciado de saldo real)
    // ==========================================
    function aplicarSaldoCero() {
        if (checkEnCero.checked) {
            const opcionSeleccionada = selectorCliente.options[selectorCliente.selectedIndex];
            
            // Decidir de qué billetera vaciamos dependiendo de la pestaña activa
            const saldoDisponible = operacionSeleccionada === 'Retiro Normal' 
                                    ? opcionSeleccionada.getAttribute('data-saldo') 
                                    : opcionSeleccionada.getAttribute('data-aval');

            if (saldoDisponible && saldoDisponible !== "") {
                inputMonto.value = saldoDisponible;
                inputMonto.setAttribute('readonly', true);
                inputMonto.classList.add('bg-red-100', 'text-red-800', 'font-bold');
            } else {
                alert("Por favor, seleccione un cliente válido primero.");
                checkEnCero.checked = false;
            }
        } else {
            inputMonto.removeAttribute('readonly');
            inputMonto.classList.remove('bg-red-100', 'text-red-800', 'font-bold');
            inputMonto.value = '';
        }
    }

    if (checkEnCero) checkEnCero.addEventListener('change', aplicarSaldoCero);
    if (selectorCliente) selectorCliente.addEventListener('change', function() {
        if (checkEnCero.checked) aplicarSaldoCero();
    });

    // ==========================================
    // 4. PROCESAMIENTO DEL FORMULARIO (Backend)
    // ==========================================
    if (formRetiro) {
        formRetiro.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const btnSubmit = this.querySelector('button[type="submit"]');
            const clienteId = selectorCliente.value;
            const monto = parseFloat(inputMonto.value);
            let nota = document.getElementById('notaRetiro').value.trim();
            
            if (!clienteId) {
                alert("Debe seleccionar un cliente.");
                return;
            }

            // Consultar base de datos para asegurar el saldo antes de restar
            const { data: clienteActual } = await supabase.from('clientes').select('saldo_usd, aval_usd').eq('id', clienteId).single();
            
            let payloadActualizacion = {};
            
            if (operacionSeleccionada === 'Retiro Normal') {
                if (monto > clienteActual.saldo_usd) {
                    if (!confirm(`ATENCIÓN: El monto a retirar ($${monto}) es MAYOR al saldo disponible ($${clienteActual.saldo_usd}).\n¿Forzar operación y dejar cuenta en negativo?`)) return;
                }
                payloadActualizacion = { saldo_usd: Number(clienteActual.saldo_usd) - monto };
            } else {
                if (monto > clienteActual.aval_usd) {
                    if (!confirm(`ATENCIÓN: El retiro de Aval ($${monto}) es MAYOR al aval disponible ($${clienteActual.aval_usd}).\n¿Forzar operación?`)) return;
                }
                payloadActualizacion = { aval_usd: Number(clienteActual.aval_usd) - monto };
                nota = `[AVAL] ${nota}`;
            }

            btnSubmit.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Procesando...';
            btnSubmit.disabled = true;

            // 1. Descontar Saldo
            await supabase.from('clientes').update(payloadActualizacion).eq('id', clienteId);
            
            // 2. Registrar Retiro
            await supabase.from('retiros').insert([{
                cliente_id: clienteId,
                monto_usd: monto,
                referencia: nota
            }]);

            // Finalizar
            this.reset();
            inputMonto.removeAttribute('readonly');
            inputMonto.classList.remove('bg-red-100', 'text-red-800', 'font-bold');
            btnSubmit.innerHTML = '<i class="fas fa-money-check-alt mr-1"></i> Registrar Retiro';
            btnSubmit.disabled = false;
            
            alert(`Operación exitosa: -$${monto.toFixed(2)} descontados del cliente.`);
            cargarDatosGenerales();
        });
    }

    // ==========================================
    // 5. MODAL Y PORTAPAPELES (WHATSAPP DINÁMICO)
    // ==========================================
    const modalWhatsapp = document.getElementById('modalWhatsapp');
    const btnAbrirWhatsapp = document.getElementById('btnSaldosWhatsapp');
    const btnCopiarTexto = document.getElementById('btnCopiarTexto');
    const textoWhatsapp = document.getElementById('textoWhatsapp');

    if (btnAbrirWhatsapp) {
        btnAbrirWhatsapp.addEventListener('click', async function() {
            // Consultar BD real al presionar el botón
            const { data: clientes } = await supabase.from('clientes').select('nombre, saldo_usd').order('nombre');
            
            let texto = `*💰 SALDOS DE CLIENTES*\n🗓️ ${hoy.toLocaleDateString('es-ES')}\n---------------------------\n`;
            if (clientes) {
                clientes.forEach(c => {
                    const icono = c.saldo_usd >= 0 ? '✅' : '⚠️';
                    texto += `${icono} ${c.nombre}: *${Number(c.saldo_usd).toFixed(2)}*\n`;
                });
            }

            textoWhatsapp.value = texto;
            modalWhatsapp.classList.remove('hidden');
            textoWhatsapp.select();
        });
    }

    document.querySelectorAll('.cerrar-modal').forEach(boton => {
        boton.addEventListener('click', () => modalWhatsapp.classList.add('hidden'));
    });

    if (btnCopiarTexto) {
        btnCopiarTexto.addEventListener('click', function() {
            textoWhatsapp.select();
            textoWhatsapp.setSelectionRange(0, 99999);
            navigator.clipboard.writeText(textoWhatsapp.value).then(() => {
                const textoOriginal = this.innerHTML;
                this.innerHTML = '<i class="fas fa-check mr-1"></i> ¡Copiado!';
                this.classList.replace('bg-emerald-700', 'bg-blue-600');
                setTimeout(() => {
                    this.innerHTML = textoOriginal;
                    this.classList.replace('bg-blue-600', 'bg-emerald-700');
                }, 2000);
            });
        });
    }

    // Inicializar todo
    cargarDatosGenerales();
});