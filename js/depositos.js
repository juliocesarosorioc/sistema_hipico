document.addEventListener('DOMContentLoaded', () => {

    const formDeposito = document.getElementById('formDeposito');
    const selectCliente = document.getElementById('clienteDeposito');
    const inputTipoOperacion = document.getElementById('tipoOperacion');
    const tbodySaldos = document.getElementById('cuerpoTablaSaldos');
    const tbodyHistorial = document.getElementById('cuerpoTablaHistorial');
    const modalWhatsapp = document.getElementById('modalWhatsapp');
    
    // Variables globales
    let clientesGlobales = [];
    let historialGlobal = [];

    // ==========================================
    // 1. INICIALIZACIÓN DE DATOS CRUZADOS
    // ==========================================
    async function cargarDatos() {
        await cargarClientes();
        await cargarHistorial();
    }

    async function cargarClientes() {
        const { data, error } = await window.supabase
            .from('clientes')
            .select('id, nombre, saldo_actual, aval, libre')
            .order('nombre', { ascending: true });

        if (!error && data) {
            clientesGlobales = data;
            
            // Llenar Select de Formulario
            selectCliente.innerHTML = '<option value="">— Seleccione un Cliente —</option>';
            data.forEach(c => {
                selectCliente.innerHTML += `<option value="${c.id}">${c.nombre}</option>`;
            });

            // Llenar Tabla de Saldos
            tbodySaldos.innerHTML = '';
            data.forEach(c => {
                const saldo = parseFloat(c.saldo_actual || 0);
                const aval = parseFloat(c.aval || 0);
                const colorSaldo = saldo < 0 ? 'text-red-600' : 'text-emerald-600';
                const icono = saldo > 0 ? '✅' : (saldo < 0 ? '⚠️' : '🔹');

                tbodySaldos.innerHTML += `
                    <tr class="hover:bg-cyan-50 transition-colors">
                        <td class="p-2 border-b border-slate-100 font-bold text-slate-800">${icono} ${c.nombre} ${c.libre ? '<span class="text-[9px] bg-green-100 text-green-700 px-1 rounded ml-1">L</span>' : ''}</td>
                        <td class="p-2 border-b border-slate-100 text-right font-mono font-bold ${colorSaldo}">$${saldo.toFixed(2)}</td>
                        <td class="p-2 border-b border-slate-100 text-right font-mono text-amber-600">$${aval.toFixed(2)}</td>
                    </tr>
                `;
            });
        }
    }

    async function cargarHistorial() {
        const { data, error } = await window.supabase
            .from('depositos')
            .select('*')
            .order('fecha', { ascending: false })
            .limit(100);

        if (!error && data) {
            historialGlobal = data;
            renderizarHistorial(data);
        }
    }

    function renderizarHistorial(datos) {
        tbodyHistorial.innerHTML = '';
        if (datos.length === 0) {
            tbodyHistorial.innerHTML = '<tr><td colspan="6" class="p-4 text-center text-slate-500">No hay depósitos registrados.</td></tr>';
            return;
        }

        datos.forEach(d => {
            const fecha = new Date(d.fecha).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
            
            let badgeOperacion = '';
            if (d.tipo_operacion === 'Normal') badgeOperacion = '<span class="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-bold text-[10px]">NORMAL</span>';
            else if (d.tipo_operacion === 'Otorgar Aval') badgeOperacion = '<span class="bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-bold text-[10px]">AVAL +</span>';
            else badgeOperacion = '<span class="bg-blue-100 text-blue-800 px-2 py-0.5 rounded font-bold text-[10px]">PAGO AVAL</span>';

            tbodyHistorial.innerHTML += `
                <tr class="hover:bg-slate-50 border-b border-slate-100 transition-colors">
                    <td class="p-2 text-slate-500">${fecha}</td>
                    <td class="p-2 font-bold text-slate-800">${d.cliente_nombre}</td>
                    <td class="p-2">${badgeOperacion}</td>
                    <td class="p-2 text-right font-mono font-bold text-emerald-700">$${parseFloat(d.monto).toFixed(2)}</td>
                    <td class="p-2 text-slate-600 truncate max-w-[150px]" title="${d.nota || ''}">${d.nota || '-'}</td>
                    <td class="p-2 text-center">
                        <button class="btn-eliminar-historial text-red-500 hover:text-red-700 hover:bg-red-50 p-1 rounded transition-colors" data-id="${d.id}" data-monto="${d.monto}" data-tipo="${d.tipo_operacion}" data-cliente="${d.cliente_id}">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                    </td>
                </tr>
            `;
        });
        asignarBotonEliminar();
    }

    // ==========================================
    // 2. LÓGICA DE INTERFAZ (Pestañas)
    // ==========================================
    document.querySelectorAll('.tab-operacion').forEach(btn => {
        btn.addEventListener('click', function() {
            // Resetear estilos de todos
            document.querySelectorAll('.tab-operacion').forEach(b => {
                b.classList.remove('text-emerald-700', 'bg-emerald-50', 'border-emerald-600');
                b.classList.add('text-slate-500', 'bg-white', 'border-transparent');
            });
            // Aplicar estilo al seleccionado
            this.classList.remove('text-slate-500', 'bg-white', 'border-transparent');
            this.classList.add('text-emerald-700', 'bg-emerald-50', 'border-emerald-600');
            
            // Actualizar input oculto
            inputTipoOperacion.value = this.getAttribute('data-tipo');
        });
    });

    // ==========================================
    // 3. PROCESAMIENTO MATEMÁTICO DE TRANSACCIONES
    // ==========================================
    formDeposito.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const btnSubmit = formDeposito.querySelector('button[type="submit"]');
        btnSubmit.disabled = true;
        btnSubmit.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Procesando...';

        const clienteId = selectCliente.value;
        const nombreCliente = selectCliente.options[selectCliente.selectedIndex].text;
        const monto = parseFloat(document.getElementById('montoDeposito').value);
        const nota = document.getElementById('notaDeposito').value.trim();
        const tipoOp = inputTipoOperacion.value;

        if (!clienteId || isNaN(monto) || monto <= 0) {
            alert("Monto inválido.");
            btnSubmit.disabled = false; btnSubmit.innerHTML = 'PROCESAR OPERACIÓN';
            return;
        }

        // Obtener saldos actuales directamente de la BD por seguridad
        const { data: currentClient } = await window.supabase.from('clientes').select('saldo_actual, aval').eq('id', clienteId).single();
        
        let nuevoSaldo = parseFloat(currentClient.saldo_actual || 0);
        let nuevoAval = parseFloat(currentClient.aval || 0);

        // LÓGICA DE NEGOCIO:
        // Normal: Sube saldo jugable.
        // Otorgar Aval: Sube saldo jugable y sube deuda de aval.
        // Pagar Aval: Baja deuda de aval (el dinero no va al saldo jugable, va a cubrir el crédito).
        if (tipoOp === 'Normal') {
            nuevoSaldo += monto;
        } else if (tipoOp === 'Otorgar Aval') {
            nuevoSaldo += monto;
            nuevoAval += monto;
        } else if (tipoOp === 'Pagar Aval') {
            nuevoAval -= monto;
            if (nuevoAval < 0) nuevoAval = 0; // Evitar avales negativos
        }

        // 1. Registrar Historial
        const { error: errDep } = await window.supabase.from('depositos').insert([{
            cliente_id: clienteId,
            cliente_nombre: nombreCliente,
            tipo_operacion: tipoOp,
            monto: monto,
            nota: nota
        }]);

        // 2. Actualizar Tabla Clientes
        const { error: errUpd } = await window.supabase.from('clientes').update({
            saldo_actual: nuevoSaldo,
            aval: nuevoAval
        }).eq('id', clienteId);

        if (!errDep && !errUpd) {
            formDeposito.reset();
            document.querySelector('.tab-operacion[data-tipo="Normal"]').click(); // Volver a normal
            cargarDatos();
        } else {
            alert("Error al procesar la operación.");
        }

        btnSubmit.disabled = false;
        btnSubmit.innerHTML = 'PROCESAR OPERACIÓN';
    });

    // ==========================================
    // 4. ELIMINAR REGISTRO (REVERSO)
    // ==========================================
    function asignarBotonEliminar() {
        document.querySelectorAll('.btn-eliminar-historial').forEach(btn => {
            btn.addEventListener('click', async function() {
                if(!confirm("¿Borrar registro? Esta acción NO reversa el saldo automáticamente en esta versión de seguridad. Deberás ajustar el saldo del cliente manualmente haciendo un retiro equivalente.")) return;
                
                const idTransaccion = this.getAttribute('data-id');
                await window.supabase.from('depositos').delete().eq('id', idTransaccion);
                cargarHistorial();
            });
        });
    }

    // ==========================================
    // 5. EXPORTAR A WHATSAPP
    // ==========================================
    document.getElementById('btnSaldosWhatsapp')?.addEventListener('click', () => {
        let texto = "*💰 REPORTE DE ESTADO DE CUENTAS - CLUB DEL DINERO*\n";
        texto += `*Fecha de Corte:* ${new Date().toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' })}\n`;
        texto += "----------------------------------------\n\n";
        
        let totalCajaPositiva = 0;

        clientesGlobales.forEach(c => {
            const saldo = parseFloat(c.saldo_actual || 0);
            const aval = parseFloat(c.aval || 0);
            
            if (saldo > 0) {
               texto += `✅ *${c.nombre}:* $${saldo.toFixed(2)}\n`;
               totalCajaPositiva += saldo;
            } else if (saldo < 0) {
               texto += `⚠️ *${c.nombre}:* -$${Math.abs(saldo).toFixed(2)}\n`;
            } else {
               texto += `🔹 *${c.nombre}:* $0.00\n`;
            }
            if (aval > 0) {
                texto += `   ↳ _Deuda Aval:_ $${aval.toFixed(2)}\n`;
            }
        });

        texto += "\n----------------------------------------\n";
        texto += `*Fondo Flotante Total Jugable:* $${totalCajaPositiva.toFixed(2)}\n`;

        document.getElementById('textoWhatsapp').value = texto;
        modalWhatsapp.classList.remove('hidden');
    });

    document.getElementById('btnCopiarTexto')?.addEventListener('click', function() {
        const text = document.getElementById('textoWhatsapp');
        text.select();
        document.execCommand('copy');
        this.innerHTML = '<i class="fas fa-check mr-1"></i> ¡Copiado!';
        setTimeout(() => this.innerHTML = '<i class="fas fa-copy mr-1"></i> Copiar al Portapapeles', 2000);
    });

    document.querySelectorAll('.cerrar-modal').forEach(b => {
        b.addEventListener('click', () => modalWhatsapp.classList.add('hidden'));
    });

    // ==========================================
    // FILTROS DE FECHA
    // ==========================================
    document.getElementById('btnFiltrarFecha')?.addEventListener('click', () => {
        const f = document.getElementById('filtroFecha').value;
        if(f) {
            const filtrados = historialGlobal.filter(d => d.fecha.startsWith(f));
            renderizarHistorial(filtrados);
        }
    });

    document.getElementById('btnLimpiarFiltro')?.addEventListener('click', () => {
        document.getElementById('filtroFecha').value = '';
        renderizarHistorial(historialGlobal);
    });

    cargarDatos();
});