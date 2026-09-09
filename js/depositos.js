document.addEventListener('DOMContentLoaded', () => {

    const formDeposito = document.getElementById('formDeposito');
    const selectCliente = document.getElementById('clienteDeposito');
    const selectBanco = document.getElementById('bancoReceptor');
    const inputTipoOperacion = document.getElementById('tipoOperacion');
    const bloqueBanco = document.getElementById('contenedorBancoReceptor');
    const tbodySaldos = document.getElementById('cuerpoTablaSaldos');
    const tbodyHistorial = document.getElementById('cuerpoTablaHistorial');
    const inputBuscador = document.getElementById('buscarSaldo');
    
    let clientesGlobales = [];
    let bancosGlobales = [];

    // ==========================================
    // 1. INICIALIZACIÓN
    // ==========================================
    async function cargarDatos() {
        // Cargar Clientes
        const { data: cData } = await window.supabase.from('clientes').select('id, nombre, saldo_actual, aval').order('nombre');
        if (cData) {
            clientesGlobales = cData;
            selectCliente.innerHTML = '<option value="">Seleccione cliente...</option>';
            cData.forEach(c => selectCliente.innerHTML += `<option value="${c.id}">${c.nombre}</option>`);
            renderizarSaldos(cData);
        }

        // Cargar Bancos de Tesorería Real
        const { data: bData } = await window.supabase.from('bancos').select('id, nombre, moneda_codigo').order('nombre');
        if (bData) {
            bancosGlobales = bData;
            selectBanco.innerHTML = '<option value="">Seleccione banco receptor...</option>';
            bData.forEach(b => selectBanco.innerHTML += `<option value="${b.id}">${b.nombre} (${b.moneda_codigo})</option>`);
        }

        cargarHistorial();
    }

    function renderizarSaldos(lista) {
        tbodySaldos.innerHTML = '';
        lista.forEach(c => {
            const saldo = parseFloat(c.saldo_actual || 0);
            const aval = parseFloat(c.aval || 0);
            const color = saldo < 0 ? 'text-red-600' : 'text-emerald-600';
            tbodySaldos.innerHTML += `
                <tr class="hover:bg-slate-50">
                    <td class="p-2 font-bold">${c.nombre}</td>
                    <td class="p-2 text-right font-mono font-bold ${color}">$${saldo.toFixed(2)}</td>
                    <td class="p-2 text-right font-mono text-amber-600">$${aval.toFixed(2)}</td>
                </tr>
            `;
        });
    }

    async function cargarHistorial() {
        const { data } = await window.supabase.from('depositos').select('*').order('fecha', { ascending: false }).limit(50);
        tbodyHistorial.innerHTML = '';
        if(!data || data.length===0) return tbodyHistorial.innerHTML = '<tr><td colspan="5" class="p-4 text-center">No hay registros.</td></tr>';

        data.forEach(d => {
            const fecha = new Date(d.fecha).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
            let badge = '';
            if (d.tipo_operacion === 'Normal') badge = '<span class="bg-emerald-100 text-emerald-800 px-2 rounded font-bold text-[10px]">NORMAL</span>';
            else if (d.tipo_operacion === 'Otorgar Aval') badge = '<span class="bg-amber-100 text-amber-800 px-2 rounded font-bold text-[10px]">AVAL +</span>';
            else badge = '<span class="bg-blue-100 text-blue-800 px-2 rounded font-bold text-[10px]">PAGO AVAL</span>';

            tbodyHistorial.innerHTML += `
                <tr class="hover:bg-slate-50 border-b border-slate-50">
                    <td class="p-2 font-mono text-slate-500">${fecha}</td>
                    <td class="p-2 font-bold">${d.cliente_nombre}</td>
                    <td class="p-2">${badge}</td>
                    <td class="p-2 text-right font-mono font-bold text-emerald-700">$${parseFloat(d.monto).toFixed(2)}</td>
                    <td class="p-2 text-slate-500 truncate max-w-[150px]">${d.nota || '-'}</td>
                </tr>
            `;
        });
    }

    // ==========================================
    // 2. UI PESTAÑAS (AVAL vs FISICO)
    // ==========================================
    document.querySelectorAll('.tab-operacion').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.tab-operacion').forEach(b => {
                b.classList.remove('text-emerald-700', 'bg-emerald-50', 'border-emerald-600');
                b.classList.add('text-slate-500', 'bg-white', 'border-transparent');
            });
            this.classList.remove('text-slate-500', 'bg-white', 'border-transparent');
            this.classList.add('text-emerald-700', 'bg-emerald-50', 'border-emerald-600');
            
            const tipo = this.getAttribute('data-tipo');
            inputTipoOperacion.value = tipo;

            // Si es otorgar Aval, no entra dinero físico al banco.
            if(tipo === 'Otorgar Aval') {
                bloqueBanco.classList.add('hidden');
                selectBanco.removeAttribute('required');
            } else {
                bloqueBanco.classList.remove('hidden');
                selectBanco.setAttribute('required', 'true');
            }
        });
    });

    // ==========================================
    // 3. PROCESAR TRANSACCIÓN Y BANCOS
    // ==========================================
    formDeposito.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btnSubmit = formDeposito.querySelector('button[type="submit"]');
        btnSubmit.disabled = true; btnSubmit.innerHTML = '<i class="fas fa-spinner fa-spin"></i> PROCESANDO...';

        const clienteId = selectCliente.value;
        const nombreCliente = selectCliente.options[selectCliente.selectedIndex].text;
        const monto = parseFloat(document.getElementById('montoDeposito').value);
        const tipoOp = inputTipoOperacion.value;
        const bancoId = selectBanco.value;
        
        let notaBase = document.getElementById('notaDeposito').value.trim();

        // 1. Obtener Saldo del Cliente
        const { data: cc } = await window.supabase.from('clientes').select('saldo_actual, aval').eq('id', clienteId).single();
        let nuevoSaldo = parseFloat(cc.saldo_actual || 0);
        let nuevoAval = parseFloat(cc.aval || 0);

        if (tipoOp === 'Normal') {
            nuevoSaldo += monto;
            const b = bancosGlobales.find(x => x.id == bancoId);
            notaBase = `Ingresado a ${b.nombre} | ${notaBase}`;
            
            // SUMAR AL BANCO DE LA EMPRESA (TESORERÍA)
            // Traemos el saldo actual del banco para sumarle
            const { data: bk } = await window.supabase.from('bancos').select('saldo_local').eq('id', bancoId).single();
            await window.supabase.from('bancos').update({ saldo_local: parseFloat(bk.saldo_local) + monto }).eq('id', bancoId);

        } else if (tipoOp === 'Otorgar Aval') {
            nuevoSaldo += monto;
            nuevoAval += monto;
        } else if (tipoOp === 'Pagar Aval') {
            nuevoAval -= monto;
            if (nuevoAval < 0) nuevoAval = 0;
            
            const b = bancosGlobales.find(x => x.id == bancoId);
            notaBase = `Pago Deuda en ${b.nombre} | ${notaBase}`;
            
            // SUMAR AL BANCO DE LA EMPRESA (El cliente pagó el aval con dinero real)
            const { data: bk } = await window.supabase.from('bancos').select('saldo_local').eq('id', bancoId).single();
            await window.supabase.from('bancos').update({ saldo_local: parseFloat(bk.saldo_local) + monto }).eq('id', bancoId);
        }

        // 2. Insertar Historial y Actualizar Cliente
        await window.supabase.from('depositos').insert([{
            cliente_id: clienteId, cliente_nombre: nombreCliente,
            tipo_operacion: tipoOp, monto: monto, nota: notaBase
        }]);

        await window.supabase.from('clientes').update({ saldo_actual: nuevoSaldo, aval: nuevoAval }).eq('id', clienteId);

        formDeposito.reset();
        document.querySelector('.tab-operacion[data-tipo="Normal"]').click();
        cargarDatos();
        
        btnSubmit.disabled = false; btnSubmit.innerHTML = 'APLICAR OPERACIÓN';
    });

    inputBuscador?.addEventListener('input', (e) => {
        const text = e.target.value.toLowerCase();
        renderizarSaldos(clientesGlobales.filter(c => c.nombre.toLowerCase().includes(text)));
    });

    cargarDatos();
});