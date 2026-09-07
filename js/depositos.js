// Archivo: js/depositos.js
// Propósito: Conectar depósitos y avales con Supabase, generar reportes de WhatsApp.

document.addEventListener('DOMContentLoaded', () => {

    // Referencias al DOM
    const formDeposito = document.getElementById('formDeposito');
    const selectCliente = document.getElementById('clienteDeposito');
    const cuerpoHistorial = document.getElementById('cuerpoTablaHistorial');
    const cuerpoSaldos = document.getElementById('cuerpoTablaSaldos');
    
    // Configurar fecha de hoy en el Header y Filtro
    const hoy = new Date();
    document.getElementById('fechaHeader').textContent = hoy.toLocaleString('es-ES');
    const filtroFecha = document.getElementById('filtroFecha');
    if(filtroFecha) filtroFecha.value = hoy.toISOString().split('T')[0];

    // ==========================================
    // 1. SISTEMA DE PESTAÑAS (TABS) DE OPERACIÓN
    // ==========================================
    const tabs = document.querySelectorAll('.tab-operacion');
    let operacionSeleccionada = 'Normal'; // Valor por defecto

    tabs.forEach(tab => {
        tab.addEventListener('click', function() {
            // Reiniciar diseño
            tabs.forEach(t => {
                t.className = 'tab-operacion flex-1 py-2 text-slate-500 bg-white hover:bg-slate-50 border-b-2 border-transparent transition-colors';
            });

            // Activar diseño actual
            const tipo = this.getAttribute('data-tipo');
            operacionSeleccionada = tipo;

            if (tipo === 'Normal') {
                this.className = 'tab-operacion flex-1 py-2 text-emerald-700 bg-emerald-50 border-b-2 border-emerald-600 transition-colors';
            } else if (tipo === 'Otorgar Aval') {
                this.className = 'tab-operacion flex-1 py-2 text-amber-700 bg-amber-50 border-b-2 border-amber-500 transition-colors';
            } else if (tipo === 'Pagar Aval') {
                this.className = 'tab-operacion flex-1 py-2 text-blue-700 bg-blue-50 border-b-2 border-blue-500 transition-colors';
            }
        });
    });

    // ==========================================
    // 2. CARGAR DATOS DESDE SUPABASE (Read)
    // ==========================================
    async function cargarDatosGenerales() {
        // A. Cargar Clientes para el Select y Tabla de Saldos
        const { data: clientes, error: errClientes } = await supabase
            .from('clientes')
            .select('id, nombre, saldo_usd, aval_usd, libre')
            .order('nombre');

        if (!errClientes && clientes) {
            // Llenar Select
            selectCliente.innerHTML = '<option value="">— Seleccione Cliente —</option>';
            clientes.forEach(c => selectCliente.innerHTML += `<option value="${c.id}">${c.nombre}</option>`);

            // Llenar Tabla de Saldos
            cuerpoSaldos.innerHTML = '';
            clientes.forEach(c => {
                cuerpoSaldos.innerHTML += `
                    <tr class="hover:bg-slate-50">
                        <td class="p-2 border-r border-slate-200 font-bold">${c.nombre} ${c.libre ? '<span class="text-[9px] bg-slate-200 text-slate-500 px-1 rounded ml-1">L</span>' : ''}</td>
                        <td class="p-2 text-right border-r border-slate-200 text-emerald-700 font-bold">$${Number(c.saldo_usd).toFixed(2)}</td>
                        <td class="p-2 text-right text-amber-600 font-bold">$${Number(c.aval_usd).toFixed(2)}</td>
                    </tr>
                `;
            });
        }

        // B. Cargar Historial de Depósitos
        const { data: depositos, error: errDepositos } = await supabase
            .from('depositos')
            .select('monto_usd, referencia, fecha_registro, clientes(nombre)')
            .order('fecha_registro', { ascending: false })
            .limit(20);

        if (!errDepositos && depositos.length > 0) {
            cuerpoHistorial.innerHTML = '';
            depositos.forEach(dep => {
                const nombre = dep.clientes ? dep.clientes.nombre : '—';
                const fecha = new Date(dep.fecha_registro).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
                
                // Determinar el "Tipo" leyendo la referencia (si la inyectamos así al guardar)
                let tipoVisual = '<span class="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded text-[10px] font-bold">NORMAL</span>';
                let notaLimpia = dep.referencia || '—';

                if (notaLimpia.startsWith('[AVAL]')) {
                    tipoVisual = '<span class="bg-amber-100 text-amber-700 px-2 py-0.5 rounded text-[10px] font-bold">OTORGÓ AVAL</span>';
                    notaLimpia = notaLimpia.replace('[AVAL] ', '');
                } else if (notaLimpia.startsWith('[PAGO_AVAL]')) {
                    tipoVisual = '<span class="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-[10px] font-bold">PAGÓ AVAL</span>';
                    notaLimpia = notaLimpia.replace('[PAGO_AVAL] ', '');
                }

                cuerpoHistorial.innerHTML += `
                    <tr class="hover:bg-slate-50">
                        <td class="p-2.5 font-bold text-slate-800">${nombre}</td>
                        <td class="p-2.5">${tipoVisual}</td>
                        <td class="p-2.5 text-right font-bold text-slate-800">$${Number(dep.monto_usd).toFixed(2)}</td>
                        <td class="p-2.5 text-slate-500">${fecha}</td>
                        <td class="p-2.5 text-slate-600 truncate max-w-[150px]">${notaLimpia}</td>
                        <td class="p-2.5 text-center"><button class="text-slate-400 hover:text-red-500"><i class="fas fa-trash-alt"></i></button></td>
                    </tr>
                `;
            });
        } else {
            cuerpoHistorial.innerHTML = '<tr><td colspan="6" class="p-4 text-center text-slate-500 bg-slate-50">Sin historial reciente</td></tr>';
        }
    }

    // ==========================================
    // 3. PROCESAMIENTO DEL FORMULARIO (Backend)
    // ==========================================
    if (formDeposito) {
        formDeposito.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const btnSubmit = this.querySelector('button[type="submit"]');
            btnSubmit.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Procesando...';
            btnSubmit.disabled = true;

            const clienteId = selectCliente.value;
            const monto = parseFloat(document.getElementById('montoDeposito').value);
            let nota = document.getElementById('notaDeposito').value.trim();

            // Consultar saldos actuales del cliente
            const { data: cliente } = await supabase.from('clientes').select('saldo_usd, aval_usd').eq('id', clienteId).single();
            
            let updatePayload = {};
            
            // Lógica Matemática de la Operación
            if (operacionSeleccionada === 'Normal') {
                updatePayload = { saldo_usd: Number(cliente.saldo_usd) + monto };
            } 
            else if (operacionSeleccionada === 'Otorgar Aval') {
                updatePayload = { aval_usd: Number(cliente.aval_usd) + monto };
                nota = `[AVAL] ${nota}`; // Etiquetar para el historial
            } 
            else if (operacionSeleccionada === 'Pagar Aval') {
                // Al pagar un aval, disminuye la deuda de aval. (Permitimos que llegue a cero).
                updatePayload = { aval_usd: Math.max(0, Number(cliente.aval_usd) - monto) };
                nota = `[PAGO_AVAL] ${nota}`;
            }

            // 1. Actualizar saldos en la tabla clientes
            await supabase.from('clientes').update(updatePayload).eq('id', clienteId);

            // 2. Registrar el movimiento en la tabla depositos
            await supabase.from('depositos').insert([{
                cliente_id: clienteId,
                monto_usd: monto,
                monto_local: monto,
                tasa: 1,
                referencia: nota
            }]);

            // Reset y Recarga
            this.reset();
            btnSubmit.innerHTML = '<i class="fas fa-money-bag mr-1"></i> Registrar Depósito';
            btnSubmit.disabled = false;
            
            cargarDatosGenerales(); // Refrescar las tablas
        });
    }

    // ==========================================
    // 4. MODAL Y PORTAPAPELES (WHATSAPP DINÁMICO)
    // ==========================================
    const modalWhatsapp = document.getElementById('modalWhatsapp');
    const btnAbrirWhatsapp = document.getElementById('btnSaldosWhatsapp');
    const btnCopiarTexto = document.getElementById('btnCopiarTexto');
    const textoWhatsapp = document.getElementById('textoWhatsapp');

    if (btnAbrirWhatsapp) {
        btnAbrirWhatsapp.addEventListener('click', async function() {
            // Generar el texto consultando la BD
            const { data: clientes } = await supabase.from('clientes').select('nombre, saldo_usd, aval_usd').order('nombre');
            
            let texto = `*💰 SALDOS DE CLIENTES*\n🗓️ ${hoy.toLocaleDateString('es-ES')}\n---------------------------\n`;
            
            if (clientes) {
                clientes.forEach(c => {
                    const icono = c.saldo_usd >= 0 ? '✅' : '⚠️';
                    texto += `${icono} ${c.nombre}: *${Number(c.saldo_usd).toFixed(2)}*`;
                    if(c.aval_usd > 0) texto += ` (Aval: ${Number(c.aval_usd).toFixed(2)})`;
                    texto += '\n';
                });
            }

            textoWhatsapp.value = texto;
            modalWhatsapp.classList.remove('hidden');
            textoWhatsapp.select();
        });
    }

    // Botones Cerrar Modal
    document.querySelectorAll('.cerrar-modal').forEach(btn => {
        btn.addEventListener('click', () => modalWhatsapp.classList.add('hidden'));
    });

    // Copiar al Portapapeles
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

    // Inicializar Tablas
    cargarDatosGenerales();
});