document.addEventListener('DOMContentLoaded', () => {

    const formDeposito = document.getElementById('formDeposito');
    const selectCliente = document.getElementById('clienteDeposito');
    const selectBanco = document.getElementById('bancoReceptor');
    const inputTipoOperacion = document.getElementById('tipoOperacion');
    const bloqueBanco = document.getElementById('contenedorBancoReceptor');
    const tbodySaldos = document.getElementById('cuerpoTablaSaldos');
    const tbodyHistorial = document.getElementById('cuerpoTablaHistorial');
    const inputBuscador = document.getElementById('buscarSaldo');
    const selectModalidad = document.getElementById('modalidadCliente');
    const selectMoneda = document.getElementById('monedaDeposito');
    const bloqueTasa = document.getElementById('bloqueTasaDepo');
    const inputTasa = document.getElementById('tasaDeposito');
    const inputMonto = document.getElementById('montoDeposito');
    const inputReferencia = document.getElementById('referenciaDeposito');
    const lblMontoDepo = document.getElementById('lblMontoDepo');
    const simbMontoDepo = document.getElementById('simbMontoDepo');
    const lblEquivDepo = document.getElementById('lblEquivDepo');
    
    let clientesGlobales = [];
    let bancosGlobales = [];
    let colsDep = null;

    const filtroDep = (obj) => { if (!colsDep) return obj; return Object.fromEntries(Object.entries(obj).filter(([k]) => colsDep.has(k))); };

    const montoUsdDep = () => {
        const m = parseFloat(inputMonto.value);
        if (isNaN(m) || m <= 0) return 0;
        if (selectMoneda.value === 'USD') return m;
        const t = parseFloat(inputTasa.value);
        return t > 0 ? m / t : 0;
    };

    function actualizarMonedaDepo() {
        const esBs = selectMoneda.value === 'VES';
        bloqueTasa.classList.toggle('hidden', !esBs);
        lblMontoDepo.textContent = esBs ? 'Monto Recibido (Bs):' : 'Monto Recibido (USD):';
        simbMontoDepo.textContent = esBs ? 'Bs' : '$';
        const usd = montoUsdDep();
        lblEquivDepo.textContent = esBs && usd > 0
            ? `Equivale a ≈ ${window.clubUI.formatoMoneda('USD', usd)}`
            : '';
        if (esBs && (!inputTasa.value || parseFloat(inputTasa.value) <= 0)) {
            window.clubTasas.globalVes().then(t => { if (t && t > 0) inputTasa.value = t.toFixed(4); });
        }
    }
    selectMoneda.addEventListener('change', actualizarMonedaDepo);
    inputMonto.addEventListener('input', actualizarMonedaDepo);
    inputTasa.addEventListener('input', actualizarMonedaDepo);

    // ==========================================
    // 1. INICIALIZACIÓN
    // ==========================================
    async function cargarDatos() {
        // Consultas en paralelo: clientes y bancos no dependen entre sí
        const segura = (promesa) => promesa.catch(e => ({ data: null, error: e }));
        const [rClientes, rBancos] = await Promise.all([
            segura(window.supabase.from('clientes').select('id, nombre, saldo_actual, aval').order('nombre')),
            segura(window.supabase.from('bancos').select('id, nombre, moneda_codigo').order('nombre'))
        ]);

        const cData = rClientes.data;
        if (cData) {
            clientesGlobales = cData;
            selectCliente.innerHTML = '<option value="">Seleccione cliente...</option>';
            cData.forEach(c => selectCliente.innerHTML += `<option value="${c.id}">${c.nombre}</option>`);
            renderizarSaldos(cData);
        }

        const bData = rBancos.data;
        if (bData) {
            bancosGlobales = bData;
            selectBanco.innerHTML = '<option value="">Seleccione banco receptor...</option>';
            bData.forEach(b => selectBanco.innerHTML += `<option value="${b.id}">${b.nombre} (${b.moneda_codigo})</option>`);
        }

        // Modalidades de pago del cliente (bancos Vzla + fijas)
        selectModalidad.innerHTML = '<option value="">Seleccione modalidad...</option>' + clubUI.listMetodosPago();

        // Esquema disponible de depositos (para no fallar si falta el SQL)
        const { data: filaDep } = await window.supabase.from('depositos').select('*').limit(1);
        colsDep = (filaDep && filaDep[0]) ? new Set(Object.keys(filaDep[0])) : null;

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
                    <td class="p-2 text-right font-mono font-bold ${color}">$${clubUI.formatoNumero(saldo, 2)}</td>
                    <td class="p-2 text-right font-mono text-amber-600">$${clubUI.formatoNumero(aval, 2)}</td>
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

            const modalidad = d.modalidad || (d.nota && d.nota.match(/Ingresado a ([^|]+)/)?.[1]) || '—';
            const moneda = d.moneda || 'USD';
            const esBs = moneda === 'VES' || moneda === 'Bs';
            const monto = d.monto_usd != null && !esBs ? d.monto_usd : d.monto;
            const ref = d.referencia || (d.nota && d.nota.split('|').pop().trim()) || '-';
            const tasaTxt = d.tasa_cambio && parseFloat(d.tasa_cambio) > 0 && esBs ? `Tasa ${d.tasa_cambio}` : '';

            tbodyHistorial.innerHTML += `
                <tr class="hover:bg-slate-50 border-b border-slate-50">
                    <td class="p-2 font-mono text-slate-500">${fecha}</td>
                    <td class="p-2 font-bold">${d.cliente_nombre}</td>
                    <td class="p-2">${badge}</td>
                    <td class="p-2 font-bold text-slate-600 text-[10px]">${modalidad.startsWith('BANCO') ? modalidad.replace('BANCO ', '') : modalidad}</td>
                    <td class="p-2 text-right font-mono font-bold text-emerald-700">$${clubUI.formatoNumero(parseFloat(monto), 2)}</td>
                    <td class="p-2 text-slate-500 truncate max-w-[160px] text-[10px]">${ref}${tasaTxt ? `<span class="block text-[9px] text-emerald-500">${tasaTxt}</span>` : ''}</td>
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
        if (!clienteId) { clubUI.toast('Seleccione el cliente a abonar.', 'warning'); btnSubmit.disabled = false; btnSubmit.innerHTML = 'APLICAR OPERACIÓN'; return; }
        const nombreCliente = selectCliente.options[selectCliente.selectedIndex].text;
        const monto = parseFloat(inputMonto.value);
        const tipoOp = inputTipoOperacion.value;
        const bancoId = selectBanco.value;
        const modalidad = selectModalidad.value;
        const esBs = selectMoneda.value === 'VES';
        const tasa = parseFloat(inputTasa.value);
        const referencia = inputReferencia.value.trim();

        if (isNaN(monto) || monto <= 0) { clubUI.toast('Indique un monto válido.', 'warning'); btnSubmit.disabled = false; btnSubmit.innerHTML = 'APLICAR OPERACIÓN'; return; }
        if (tipoOp !== 'Otorgar Aval') {
            if (!modalidad) { clubUI.toast('Seleccione la modalidad de pago del cliente.', 'warning'); btnSubmit.disabled = false; btnSubmit.innerHTML = 'APLICAR OPERACIÓN'; return; }
            if (!referencia) { clubUI.toast('La referencia es obligatoria en los ingresos.', 'warning'); btnSubmit.disabled = false; btnSubmit.innerHTML = 'APLICAR OPERACIÓN'; return; }
            if (esBs && (!tasa || tasa <= 0)) { clubUI.toast('Indique la tasa aplicada.', 'warning'); btnSubmit.disabled = false; btnSubmit.innerHTML = 'APLICAR OPERACIÓN'; return; }
        }
        const montoUsd = esBs ? (tasa > 0 ? monto / tasa : monto) : monto;

        let notaBase = document.getElementById('notaDeposito').value.trim();

        // 1. Obtener Saldo del Cliente
        const { data: cc } = await window.supabase.from('clientes').select('saldo_actual, aval').eq('id', clienteId).single();
        let nuevoSaldo = parseFloat(cc.saldo_actual || 0);
        let nuevoAval = parseFloat(cc.aval || 0);

        // Crédito a tesorería según moneda del banco receptor
        const creditarBanco = async (b) => {
            const { data: bk } = await window.supabase.from('bancos').select('saldo_local, moneda_codigo').eq('id', b.id).single();
            if (bk) {
                const montoCredito = bk.moneda_codigo === 'USD' ? montoUsd : monto;
                await window.supabase.from('bancos').update({ saldo_local: parseFloat(bk.saldo_local) + montoCredito }).eq('id', b.id);
            }
        };

        if (tipoOp === 'Normal') {
            nuevoSaldo += monto;
            const b = bancosGlobales.find(x => x.id == bancoId);
            notaBase = `Ingresado a ${b.nombre} | ${notaBase}`;
            await creditarBanco(b);
        } else if (tipoOp === 'Otorgar Aval') {
            nuevoSaldo += monto;
            nuevoAval += monto;
        } else if (tipoOp === 'Pagar Aval') {
            nuevoAval -= monto;
            if (nuevoAval < 0) nuevoAval = 0;
            const b = bancosGlobales.find(x => x.id == bancoId);
            notaBase = `Pago Deuda en ${b.nombre} | ${notaBase}`;
            await creditarBanco(b);
        }

        // Modalidad del cliente + banco receptor (tesorería)
        let bancoIdTes = null, bancoNomTes = null, bancoCodTes = null;
        if (bancoId) {
            const b = bancosGlobales.find(x => x.id == bancoId);
            if (b) { bancoIdTes = b.id; bancoNomTes = b.nombre; bancoCodTes = b.moneda_codigo; }
        }

        // 2. Insertar Historial y Actualizar Cliente
        await window.supabase.from('depositos').insert([filtroDep({
            cliente_id: clienteId, cliente_nombre: nombreCliente,
            tipo_operacion: tipoOp, monto: monto, nota: notaBase,
            modalidad: modalidad || null,
            banco_id: bancoIdTes, banco_nombre: bancoNomTes, banco_codigo: bancoCodTes,
            referencia: referencia || null,
            moneda: esBs ? 'VES' : 'USD', tasa_cambio: esBs ? tasa : 1,
            monto_usd: montoUsd
        })]);

        await window.supabase.from('clientes').update({ saldo_actual: nuevoSaldo, aval: nuevoAval }).eq('id', clienteId);

        if (window.clubDB?.logAccion) window.clubDB.logAccion('DEPOSITOS', `${tipoOp}: ${esBs ? 'Bs' : '$'}${monto} ${nombreCliente} via ${modalidad || 'n/a'} (ref ${referencia || '-'})`);

        formDeposito.reset();
        inputTasa.value = ''; lblEquivDepo.textContent = '';
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