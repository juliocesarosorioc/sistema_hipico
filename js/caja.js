document.addEventListener('DOMContentLoaded', () => {

    const tabTransferencia = document.getElementById('tabTransferencia');
    const tabRetiro = document.getElementById('tabRetiro');
    const bloqueDestino = document.getElementById('bloqueDestino');
    const bloqueRetiro = document.getElementById('bloqueRetiro');
    const textoNotificacion = document.getElementById('textoNotificacion');
    
    const comboOrigen = document.getElementById('clienteOrigen');
    const comboDestino = document.getElementById('clienteDestino');
    const comboMetodo = document.getElementById('metodoPago');
    const inputMonto = document.getElementById('montoOperacion');
    const inputNota = document.getElementById('notaOperacion');
    const btnProcesar = document.getElementById('btnProcesarOperacion');

    let modoOperacion = 'TRANSFERENCIA'; // 'TRANSFERENCIA' o 'RETIRO'
    let clientesDB = [];

    // ==========================================
    // 1. LÓGICA DE UI (CAMBIO DE PESTAÑAS)
    // ==========================================
    tabTransferencia.addEventListener('click', () => {
        modoOperacion = 'TRANSFERENCIA';
        tabTransferencia.className = 'flex-1 py-1.5 text-xs font-bold rounded bg-white shadow text-orange-600 border border-slate-200';
        tabRetiro.className = 'flex-1 py-1.5 text-xs font-bold rounded text-slate-500 hover:text-slate-700';
        bloqueDestino.classList.remove('hidden');
        bloqueRetiro.classList.add('hidden');
        textoNotificacion.innerHTML = '<strong>Traslado Interno:</strong> Mueve saldo entre dos clientes de la plataforma.';
    });

    tabRetiro.addEventListener('click', () => {
        modoOperacion = 'RETIRO';
        tabRetiro.className = 'flex-1 py-1.5 text-xs font-bold rounded bg-white shadow text-orange-600 border border-slate-200';
        tabTransferencia.className = 'flex-1 py-1.5 text-xs font-bold rounded text-slate-500 hover:text-slate-700';
        bloqueDestino.classList.add('hidden');
        bloqueRetiro.classList.remove('hidden');
        textoNotificacion.innerHTML = '<strong>Retiro de Fondos:</strong> Extrae dinero del sistema hacia un banco real.';
    });

    // ==========================================
    // 2. CARGA DE DATOS
    // ==========================================
    async function inicializarCaja() {
        // Cargar Clientes
        const { data: clientes } = await window.supabase.from('clientes').select('*').order('nombre');
        if (clientes) {
            clientesDB = clientes;
            comboOrigen.innerHTML = '<option value="">Seleccione origen...</option>';
            comboDestino.innerHTML = '<option value="">Seleccione destino...</option>';
            
            clientes.forEach(c => {
                let text = `${c.nombre} (Saldo: $${parseFloat(c.saldo_actual).toFixed(2)})`;
                comboOrigen.innerHTML += `<option value="${c.id}">${text}</option>`;
                comboDestino.innerHTML += `<option value="${c.id}">${text}</option>`;
            });

            renderizarSaldosVivos();
        }
        cargarHistorial();
    }

    function renderizarSaldosVivos() {
        const tbodySaldos = document.getElementById('cuerpoTablaSaldos');
        tbodySaldos.innerHTML = '';
        clientesDB.forEach(c => {
            const saldo = parseFloat(c.saldo_actual);
            const color = saldo < 0 ? 'text-red-600' : (saldo > 0 ? 'text-emerald-600' : 'text-slate-600');
            tbodySaldos.innerHTML += `
                <tr class="hover:bg-slate-50">
                    <td class="p-2 font-bold text-slate-700 text-xs">${c.nombre}</td>
                    <td class="p-2 text-right font-black ${color}">$${saldo.toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                </tr>
            `;
        });
    }

    async function cargarHistorial() {
        const { data, error } = await window.supabase.from('transacciones_financieras')
            .select('*').order('id', { ascending: false }).limit(50);
        
        const tbody = document.getElementById('cuerpoTablaHistorial');
        tbody.innerHTML = '';

        if (!data || data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="p-4 text-center text-slate-500">No hay movimientos recientes.</td></tr>';
            return;
        }

        data.forEach(t => {
            const fecha = new Date(t.fecha).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
            let badgeTipo = t.tipo_operacion === 'TRANSFERENCIA' 
                ? '<span class="bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-bold text-[10px]">TRASLADO</span>'
                : '<span class="bg-red-100 text-red-700 px-2 py-0.5 rounded font-bold text-[10px]">RETIRO</span>';
            
            let destinoCol = t.tipo_operacion === 'TRANSFERENCIA' 
                ? `<span class="font-bold text-slate-700"><i class="fas fa-user text-blue-400 mr-1"></i>${t.cliente_destino_nombre}</span>`
                : `<span class="font-bold text-slate-600"><i class="fas fa-university text-red-400 mr-1"></i>${t.metodo_pago}</span>`;

            tbody.innerHTML += `
                <tr class="hover:bg-slate-50 border-b border-slate-100">
                    <td class="p-2">${badgeTipo}</td>
                    <td class="p-2 font-bold text-slate-800">${t.cliente_origen_nombre}</td>
                    <td class="p-2">${destinoCol}</td>
                    <td class="p-2 text-right font-black text-slate-800">$${parseFloat(t.monto).toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                    <td class="p-2 text-center text-[10px] text-slate-500">${fecha}</td>
                    <td class="p-2 text-[10px] text-slate-500 max-w-[150px] truncate">${t.nota || '-'}</td>
                </tr>
            `;
        });
    }

    // ==========================================
    // 3. PROCESAR OPERACIÓN MATEMÁTICA
    // ==========================================
    btnProcesar.addEventListener('click', async () => {
        const idOrigen = comboOrigen.value;
        const idDestino = comboDestino.value;
        const monto = parseFloat(inputMonto.value);
        const nota = inputNota.value.trim();
        const metodo = comboMetodo.value;

        if (!idOrigen) return alert("Debe seleccionar un cliente origen.");
        if (isNaN(monto) || monto <= 0) return alert("El monto debe ser un número mayor a cero.");

        const clienteOrigen = clientesDB.find(c => c.id == idOrigen);
        
        // Validación de fondos (Opcional, pero recomendada)
        if (parseFloat(clienteOrigen.saldo_actual) < monto) {
            const confirmar = confirm(`El cliente ${clienteOrigen.nombre} tiene saldo insuficiente ($${clienteOrigen.saldo_actual}). ¿Forzar operación de todas formas y dejar su cuenta en negativo?`);
            if (!confirmar) return;
        }

        btnProcesar.disabled = true;
        btnProcesar.innerHTML = '<i class="fas fa-spinner fa-spin"></i> PROCESANDO...';

        try {
            if (modoOperacion === 'TRANSFERENCIA') {
                if (!idDestino) throw new Error("Seleccione un cliente destino.");
                if (idOrigen === idDestino) throw new Error("No puede transferir a sí mismo.");

                const clienteDestino = clientesDB.find(c => c.id == idDestino);

                // 1. Restar Origen, Sumar Destino
                let saldoOrigenNuevo = parseFloat(clienteOrigen.saldo_actual) - monto;
                let saldoDestinoNuevo = parseFloat(clienteDestino.saldo_actual) + monto;

                await window.supabase.from('clientes').update({ saldo_actual: saldoOrigenNuevo }).eq('id', idOrigen);
                await window.supabase.from('clientes').update({ saldo_actual: saldoDestinoNuevo }).eq('id', idDestino);

                // 2. Registrar en Historial
                await window.supabase.from('transacciones_financieras').insert([{
                    tipo_operacion: 'TRANSFERENCIA',
                    cliente_origen_id: idOrigen, cliente_origen_nombre: clienteOrigen.nombre,
                    cliente_destino_id: idDestino, cliente_destino_nombre: clienteDestino.nombre,
                    monto: monto, nota: nota
                }]);

                alert(`✅ Transferencia de $${monto} completada con éxito.`);

            } else {
                // MODO RETIRO
                // 1. Restar a Origen
                let saldoOrigenNuevo = parseFloat(clienteOrigen.saldo_actual) - monto;
                await window.supabase.from('clientes').update({ saldo_actual: saldoOrigenNuevo }).eq('id', idOrigen);

                // 2. Registrar en Historial
                await window.supabase.from('transacciones_financieras').insert([{
                    tipo_operacion: 'RETIRO',
                    cliente_origen_id: idOrigen, cliente_origen_nombre: clienteOrigen.nombre,
                    metodo_pago: metodo,
                    monto: monto, nota: nota
                }]);

                alert(`✅ Retiro de $${monto} por ${metodo} registrado.`);
            }

            // Limpiar y recargar
            inputMonto.value = '';
            inputNota.value = '';
            inicializarCaja();

        } catch (error) {
            alert(error.message || "Error procesando la transacción.");
        }

        btnProcesar.disabled = false;
        btnProcesar.innerHTML = 'PROCESAR OPERACIÓN';
    });

    document.getElementById('btnRecargarHistorial').addEventListener('click', cargarHistorial);

    // ==========================================
    // 4. LÓGICA DEL MODAL WHATSAPP
    // ==========================================
    document.getElementById('btnSaldosWhatsapp').addEventListener('click', () => {
        let texto = "📊 *REPORTE DE SALDOS - CLUB DEL DINERO*\n";
        texto += `📅 Fecha: ${new Date().toLocaleDateString('es-ES')}\n\n`;
        
        let totalCaja = 0;
        clientesDB.forEach(c => {
            const s = parseFloat(c.saldo_actual);
            if(s !== 0) { // Omitir los que están en cero exacto
                let icono = s > 0 ? '🟢' : '🔴';
                texto += `${icono} *${c.nombre}:* $${s.toFixed(2)}\n`;
                totalCaja += s;
            }
        });

        texto += `\n💰 *BALANCE GLOBAL (A favor clientes):* $${totalCaja.toFixed(2)}`;
        
        document.getElementById('textoWhatsapp').value = texto;
        document.getElementById('modalWhatsapp').classList.remove('hidden');
    });

    document.getElementById('btnCopiarTexto').addEventListener('click', () => {
        const txt = document.getElementById('textoWhatsapp');
        txt.select();
        document.execCommand('copy');
        alert("¡Texto copiado al portapapeles!");
    });

    document.querySelectorAll('.cerrar-modal').forEach(b => {
        b.addEventListener('click', () => document.getElementById('modalWhatsapp').classList.add('hidden'));
    });

    // Arranque
    inicializarCaja();
});