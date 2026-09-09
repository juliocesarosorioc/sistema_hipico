document.addEventListener('DOMContentLoaded', () => {

    const formBanco = document.getElementById('formBanco');
    const selectMoneda = document.getElementById('monedaBanco');
    const cuerpoTabla = document.getElementById('cuerpoTablaBancos');
    const buscador = document.getElementById('buscadorBancos');
    const lblGranTotal = document.getElementById('granTotalUSD');
    const btnGuardarBanco = document.getElementById('btnGuardarBanco');

    let diccionarioMonedas = {}; // Para conversiones rápidas
    let bancosDB = [];

    // ==========================================
    // 1. CARGAR DEPENDENCIAS Y BANCOS
    // ==========================================
    async function inicializarBancos() {
        // A. Cargar Monedas del sistema para el selector
        const { data: monedas } = await window.supabase.from('monedas_sistema').select('*');
        if (monedas) {
            selectMoneda.innerHTML = '<option value="">Seleccione moneda...</option>';
            monedas.forEach(m => {
                diccionarioMonedas[m.codigo] = { tasa: m.tasa_actual, simbolo: m.simbolo };
                selectMoneda.innerHTML += `<option value="${m.codigo}">${m.codigo} - ${m.nombre}</option>`;
            });
        }

        cargarBancosDB();
    }

    async function cargarBancosDB() {
        const { data: bancos, error } = await window.supabase.from('bancos').select('*').order('nombre');
        
        if (error || !bancos) {
            cuerpoTabla.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-red-500">Error al cargar datos.</td></tr>';
            return;
        }

        bancosDB = bancos;
        cuerpoTabla.innerHTML = '';
        let granTotalUSD = 0;

        if (bancos.length === 0) {
            cuerpoTabla.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-slate-500">No hay cuentas bancarias registradas.</td></tr>';
            lblGranTotal.textContent = '$0.00';
            return;
        }

        bancos.forEach(b => {
            let datosMoneda = diccionarioMonedas[b.moneda_codigo] || { tasa: 1, simbolo: '$' };
            let tasaAplicada = parseFloat(datosMoneda.tasa);
            let saldoLocal = parseFloat(b.saldo_local);
            
            // Si la moneda no es USD, dividimos entre la tasa para saber cuántos dólares representa
            let equivalenteUSD = b.moneda_codigo === 'USD' ? saldoLocal : (saldoLocal / tasaAplicada);
            granTotalUSD += equivalenteUSD;

            cuerpoTabla.innerHTML += `
                <tr class="hover:bg-slate-50 border-b border-slate-100 fila-banco">
                    <td class="p-3 font-bold text-slate-800 nombre-td uppercase">${b.nombre}</td>
                    <td class="p-3 font-bold text-slate-500 moneda-td">${b.moneda_codigo}</td>
                    <td class="p-3 text-right font-bold text-slate-700">${datosMoneda.simbolo}${saldoLocal.toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                    <td class="p-3 text-right text-slate-400 font-mono text-[10px]">${tasaAplicada.toFixed(4)}</td>
                    <td class="p-3 text-right font-black text-emerald-600 bg-emerald-50/30">$${equivalenteUSD.toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                    <td class="p-3 text-center">
                        <button class="btn-eliminar border border-red-300 text-red-500 hover:bg-red-50 px-2 py-1 rounded text-[10px] font-bold transition-colors" data-id="${b.id}" data-nombre="${b.nombre}">Eliminar</button>
                    </td>
                </tr>
            `;
        });

        lblGranTotal.textContent = `$${granTotalUSD.toLocaleString(undefined, {minimumFractionDigits:2})}`;
        asignarEventosEliminar();
    }

    // ==========================================
    // 2. REGISTRAR NUEVO BANCO
    // ==========================================
    formBanco.addEventListener('submit', async function(e) {
        e.preventDefault();
        const nombre = document.getElementById('nombreBanco').value.trim().toUpperCase();
        const moneda = document.getElementById('monedaBanco').value;
        const saldo = parseFloat(document.getElementById('saldoInicial').value);

        if(!nombre || !moneda || isNaN(saldo)) return alert("Complete todos los campos correctamente.");

        btnGuardarBanco.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';
        btnGuardarBanco.disabled = true;

        const { error } = await window.supabase.from('bancos').insert([{
            nombre: nombre,
            moneda_codigo: moneda,
            saldo_local: saldo
        }]);

        if (error) alert("Error al registrar banco en la base de datos.");
        else {
            formBanco.reset();
            document.getElementById('saldoInicial').value = "0.00";
            cargarBancosDB();
        }

        btnGuardarBanco.innerHTML = 'Añadir Banco';
        btnGuardarBanco.disabled = false;
    });

    // ==========================================
    // 3. BUSCADOR EN TIEMPO REAL
    // ==========================================
    buscador.addEventListener('keyup', function() {
        const texto = this.value.toLowerCase();
        document.querySelectorAll('.fila-banco').forEach(fila => {
            const nombre = fila.querySelector('.nombre-td').textContent.toLowerCase();
            const moneda = fila.querySelector('.moneda-td').textContent.toLowerCase();
            fila.style.display = (nombre.includes(texto) || moneda.includes(texto)) ? '' : 'none';
        });
    });

    // ==========================================
    // 4. LÓGICA DE ELIMINACIÓN
    // ==========================================
    function asignarEventosEliminar() {
        document.querySelectorAll('.btn-eliminar').forEach(boton => {
            boton.addEventListener('click', async function() {
                const id = this.dataset.id;
                const nombre = this.dataset.nombre;
                
                if (confirm(`¿Eliminar la cuenta "${nombre}" del directorio?`)) {
                    await window.supabase.from('bancos').delete().eq('id', id);
                    cargarBancosDB();
                }
            });
        });
    }

    document.getElementById('btnEliminarTodos').addEventListener('click', async function() {
        if (bancosDB.length === 0) return alert("No hay bancos para eliminar.");

        if (confirm(`⚠️ ALERTA CONTABLE CRÍTICA ⚠️\n\n¿Desea ELIMINAR TODOS los bancos de tesorería? Esta acción borrará los registros de liquidez real.`)) {
            // Un truco seguro para borrar todo: borrar donde id sea mayor a 0
            await window.supabase.from('bancos').delete().gt('id', 0);
            cargarBancosDB();
        }
    });

    // Arranque
    inicializarBancos();
});