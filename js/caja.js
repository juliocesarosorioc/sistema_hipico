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
    const inputRef = document.getElementById('refOperacion');
    const selMonedaRetiro = document.getElementById('monedaRetiro');
    const inputTasaRetiro = document.getElementById('tasaRetiro');
    const lblRetiroUsd = document.getElementById('lblRetiroUsd');
    const lblMonto = document.getElementById('lblMonto');
    const simbMonto = document.getElementById('simbMonto');
    const btnProcesar = document.getElementById('btnProcesarOperacion');

    let modoOperacion = 'TRANSFERENCIA'; // 'TRANSFERENCIA' o 'RETIRO'
    let clientesDB = [];
    let bancosDB = [];
    let colsFin = null;

    const filtroFin = (obj) => { if (!colsFin) return obj; return Object.fromEntries(Object.entries(obj).filter(([k]) => colsFin.has(k))); };

    const totalEgresoUsd = () => {
        const m = parseFloat(inputMonto.value);
        if (isNaN(m) || m <= 0) return 0;
        if (selMonedaRetiro.value === 'USD') return m;
        const t = parseFloat(inputTasaRetiro.value);
        return t > 0 ? m / t : 0;
    };

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
        lblMonto.textContent = 'Monto (USD):';
        simbMonto.textContent = '$';
    });

    tabRetiro.addEventListener('click', () => {
        modoOperacion = 'RETIRO';
        tabRetiro.className = 'flex-1 py-1.5 text-xs font-bold rounded bg-white shadow text-orange-600 border border-slate-200';
        tabTransferencia.className = 'flex-1 py-1.5 text-xs font-bold rounded text-slate-500 hover:text-slate-700';
        bloqueDestino.classList.add('hidden');
        bloqueRetiro.classList.remove('hidden');
        textoNotificacion.innerHTML = '<strong>Egreso / Retiro de Fondos:</strong> La plataforma paga y queda registrado el banco, la referencia, la tasa y el beneficiario.';
        window.clubTasas.globalVes().then(t => { if (t && t > 0) inputTasaRetiro.value = t.toFixed(4); });
        actualizarLabelMoneda();
    });

    function actualizarLabelMoneda() {
        const esBs = selMonedaRetiro.value === 'VES';
        lblMonto.textContent = esBs ? 'Monto a pagar (Bs):' : 'Monto a pagar (USD):';
        simbMonto.textContent = esBs ? 'Bs' : '$';
        lblRetiroUsd.textContent = esBs
            ? `Equivale a ≈ ${window.clubUI.formatoMoneda('USD', totalEgresoUsd())}`
            : '';
    }

    selMonedaRetiro.addEventListener('change', () => {
        const esBs = selMonedaRetiro.value === 'VES';
        if (esBs && (!inputTasaRetiro.value || parseFloat(inputTasaRetiro.value) <= 0)) {
            window.clubTasas.globalVes().then(t => { if (t && t > 0) inputTasaRetiro.value = t.toFixed(4); });
        }
        actualizarLabelMoneda();
    });
    inputMonto.addEventListener('input', actualizarLabelMoneda);
    inputTasaRetiro.addEventListener('input', actualizarLabelMoneda);

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
                let text = `${c.nombre} (Saldo: $${clubUI.formatoNumero(parseFloat(c.saldo_actual), 2)})`;
                comboOrigen.innerHTML += `<option value="${c.id}">${text}</option>`;
                comboDestino.innerHTML += `<option value="${c.id}">${text}</option>`;
            });

            renderizarSaldosVivos();
        }

        // Tesorería y modalidades de salida (egreso)
        const { data: bancos } = await window.supabase.from('bancos').select('*').order('nombre');
        bancosDB = bancos || [];
        comboMetodo.innerHTML = '<option value="">Seleccione modalidad...</option>';
        if (bancosDB.length > 0) {
            comboMetodo.innerHTML += '<optgroup label="Cuentas de Tesorería (Bolívares/Dólares)"></optgroup>';
            bancosDB.forEach(b => {
                comboMetodo.innerHTML += `<option value="T:${b.id}">${b.nombre} (${b.moneda_codigo})</option>`;
            });
        }
        comboMetodo.insertAdjacentHTML('beforeend',
            '<optgroup label="Otras modalidades"></optgroup>' +
            ['ZELLE', 'BINANCE', 'EFECTIVO', 'DIVISA', 'PAGO MÓVIL', 'TRANSFERENCIA', 'OTRO']
            .map(m => `<option value="${m}">${m}</option>`).join(''));

        // Esquema disponible de transacciones (para no fallar si falta el SQL)
        const { data: filaFin } = await window.supabase.from('transacciones_financieras').select('*').limit(1);
        colsFin = (filaFin && filaFin[0]) ? new Set(Object.keys(filaFin[0])) : null;

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
                    <td class="p-2 text-right font-black ${color}">$${clubUI.formatoNumero(saldo, 2)}</td>
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
                : `<span class="font-bold text-slate-600"><i class="fas fa-university text-red-400 mr-1"></i>${t.modalidad || t.metodo_pago || '—'}</span>`;

            const esBsf = (t.moneda || 'USD') === 'VES' || t.moneda === 'Bs';
            const simb = esBsf ? 'Bs ' : '$ ';
            const montoMostrado = t.monto_usd != null && !esBsf ? t.monto_usd : t.monto;
            const tasaTxt = t.tasa_cambio && parseFloat(t.tasa_cambio) > 0 ? t.tasa_cambio : '';
            const ref = t.referencia || t.nota || '-';
            const refTasa = `${ref}${tasaTxt ? `<span class="text-[9px] text-slate-400 block">Tasa ${tasaTxt}</span>` : ''}`;

            tbody.innerHTML += `
                <tr class="hover:bg-slate-50 border-b border-slate-100">
                    <td class="p-2 text-center text-[10px] text-slate-500">${fecha}</td>
                    <td class="p-2">${badgeTipo}</td>
                    <td class="p-2 font-bold text-slate-800">${t.cliente_origen_nombre}</td>
                    <td class="p-2">${destinoCol}</td>
                    <td class="p-2 text-right font-black text-slate-800">${simb}${clubUI.formatoNumero(parseFloat(montoMostrado), 2)}</td>
                    <td class="p-2 text-[10px] text-slate-500 max-w-[150px] truncate">${refTasa}</td>
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
        const referencia = inputRef ? inputRef.value.trim() : '';

        if (!idOrigen) return clubUI.toast("Debe seleccionar un cliente origen.");
        if (isNaN(monto) || monto <= 0) return clubUI.toast("El monto debe ser un número mayor a cero.");

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
                await window.supabase.from('transacciones_financieras').insert([filtroFin({
                    tipo_operacion: 'TRANSFERENCIA',
                    cliente_origen_id: idOrigen, cliente_origen_nombre: clienteOrigen.nombre,
                    cliente_destino_id: idDestino, cliente_destino_nombre: clienteDestino.nombre,
                    monto: monto, nota: nota, referencia: referencia || null,
                    moneda: 'USD', tasa_cambio: 1, monto_usd: monto
                })]);

                clubUI.toast(`✅ Transferencia de $${monto} completada con éxito.`);
                if (window.clubDB?.logAccion) window.clubDB.logAccion('CAJA', `transferencia: $${monto} ${clienteOrigen.nombre} -> ${clienteDestino.nombre} (${nota || 'sin nota'})`);

            } else {
                // MODO RETIRO / EGRESO: la plataforma paga
                if (!comboMetodo.value) throw new Error("Seleccione la modalidad de salida (banco, Zelle, Binance...).");

                const esBs = selMonedaRetiro.value === 'VES';
                const tasa = parseFloat(inputTasaRetiro.value);
                if (esBs && (!tasa || tasa <= 0)) throw new Error("Indique la tasa aplicada al egreso en Bs.");
                const montoUsd = esBs ? monto / tasa : monto;

                // Modalidad: cuentas de tesorería "T:<id>" o texto libre
                const selVal = comboMetodo.value;
                const esTesoro = selVal.startsWith('T:');
                const bancoT = esTesoro ? bancosDB.find(b => b.id == selVal.slice(2)) : null;
                const modalidad = bancoT ? `BANCO ${bancoT.nombre}` : selVal;

                // Débito a tesorería si se paga desde una cuenta real de la empresa
                if (bancoT) {
                    const { data: bk } = await window.supabase.from('bancos').select('saldo_local, moneda_codigo').eq('id', bancoT.id).single();
                    if (bk) {
                        const esBancoUSD = bk.moneda_codigo === 'USD';
                        const nuevoSaldoBanco = parseFloat(bk.saldo_local) - (esBancoUSD ? montoUsd : monto);
                        await window.supabase.from('bancos').update({ saldo_local: nuevoSaldoBanco }).eq('id', bancoT.id);
                    }
                }

                // 1. Restar a Origen
                let saldoOrigenNuevo = parseFloat(clienteOrigen.saldo_actual) - monto;
                await window.supabase.from('clientes').update({ saldo_actual: saldoOrigenNuevo }).eq('id', idOrigen);

                // 2. Registrar en Historial con banco, referencia, tasa y beneficiario
                await window.supabase.from('transacciones_financieras').insert([filtroFin({
                    tipo_operacion: 'RETIRO',
                    cliente_origen_id: idOrigen, cliente_origen_nombre: clienteOrigen.nombre,
                    modalidad, banco_id: bancoT ? bancoT.id : null,
                    banco_nombre: bancoT ? bancoT.nombre : null,
                    banco_codigo: bancoT ? bancoT.moneda_codigo : null,
                    referencia, moneda: esBs ? 'VES' : 'USD',
                    tasa_cambio: esBs ? tasa : 1, monto_usd: montoUsd,
                    monto: monto, nota: nota,
                    numero_cuenta: (document.getElementById('numeroCuentaRetiro') || {}).value || null,
                    tipo_cuenta: (document.getElementById('tipoCuentaRetiro') || {}).value || null,
                    cedula_rif: (document.getElementById('cedulaRifRetiro') || {}).value || null,
                    nombre_beneficiario: (document.getElementById('nombreBeneficiario') || {}).value || null
                })]);

                clubUI.toast(`✅ Egreso de ${esBs ? 'Bs ' + clubUI.formatoNumero(monto, 2) : '$' + clubUI.formatoNumero(monto, 2)} por ${modalidad} registrado${referencia ? ' (Ref ' + referencia + ')' : ''}.`);
                if (window.clubDB?.logAccion) window.clubDB.logAccion('CAJA', `egreso: ${esBs ? 'Bs' : 'USD'} ${monto} ${clienteOrigen.nombre} via ${modalidad} (ref ${referencia || '-'})`);
            }

            // Limpiar y recargar
            inputMonto.value = '';
            inputNota.value = '';
            if (inputRef) inputRef.value = '';
            comboMetodo.value = '';
            document.getElementById('numeroCuentaRetiro').value = '';
            document.getElementById('cedulaRifRetiro').value = '';
            document.getElementById('nombreBeneficiario').value = '';
            inicializarCaja();

        } catch (error) {
            clubUI.toast(error.message || "Error procesando la transacción.");
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
                texto += `${icono} *${c.nombre}:* $${clubUI.formatoNumero(s, 2)}\n`;
                totalCaja += s;
            }
        });

        texto += `\n💰 *BALANCE GLOBAL (A favor clientes):* $${clubUI.formatoNumero(totalCaja, 2)}`;
        
        document.getElementById('textoWhatsapp').value = texto;
        document.getElementById('modalWhatsapp').classList.remove('hidden');
    });

    document.getElementById('btnCopiarTexto').addEventListener('click', () => {
        const txt = document.getElementById('textoWhatsapp');
        txt.select();
        document.execCommand('copy');
        clubUI.toast("¡Texto copiado al portapapeles!");
    });

    document.querySelectorAll('.cerrar-modal').forEach(b => {
        b.addEventListener('click', () => document.getElementById('modalWhatsapp').classList.add('hidden'));
    });

    // Arranque
    inicializarCaja();
});