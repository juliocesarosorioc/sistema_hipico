// Archivo: js/saldos.js
// Propósito: Panel de auditoría, ajustes manuales, cargas masivas desde texto y puesta en cero de saldos.

document.addEventListener('DOMContentLoaded', () => {

    let clientesGlobal = [];
    let bancosGlobal = [];

    // ==========================================
    // 1. CARGA INICIAL DE DATOS (READ)
    // ==========================================
    async function inicializarTablas() {
        // Cargar Clientes
        const { data: clientes } = await supabase.from('clientes').select('id, nombre, saldo_usd, aval_usd').order('nombre');
        const tbodyClientes = document.getElementById('cuerpoTablaClientes');
        
        if (clientes) {
            clientesGlobal = clientes;
            tbodyClientes.innerHTML = '';
            clientes.forEach(c => {
                const tr = document.createElement('tr');
                tr.className = 'hover:bg-slate-50 transition-colors';
                tr.innerHTML = `
                    <td class="p-3 border-r border-slate-200">${c.nombre}</td>
                    <td class="p-3 text-right border-r border-slate-200 ${c.saldo_usd < 0 ? 'text-red-500' : 'text-emerald-700'}">$${Number(c.saldo_usd).toFixed(2)}</td>
                    <td class="p-3 text-right border-r border-slate-200 text-amber-600">$${Number(c.aval_usd).toFixed(2)}</td>
                    <td class="p-3 text-center flex gap-1 justify-center">
                        <button class="btn-editar-saldo bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1 rounded text-[11px] font-bold shadow-sm transition-colors" data-id="${c.id}" data-nombre="${c.nombre}" data-tipo="saldo" data-valor="${c.saldo_usd}"><i class="fas fa-pen mr-1"></i> Saldo</button>
                        <button class="btn-editar-saldo bg-amber-500 hover:bg-amber-600 text-white px-2.5 py-1 rounded text-[11px] font-bold shadow-sm transition-colors" data-id="${c.id}" data-nombre="${c.nombre}" data-tipo="aval" data-valor="${c.aval_usd}"><i class="fas fa-pen mr-1"></i> Aval</button>
                    </td>
                `;
                tbodyClientes.appendChild(tr);
            });
            asignarEventosEditar();
        }

        // Cargar Bancos
        const { data: bancos } = await supabase.from('bancos').select('*').order('nombre');
        const tbodyBancos = document.getElementById('cuerpoTablaBancos');
        const selectBancoAjuste = document.getElementById('selectBancoAjuste');
        const selectBancoMasiva = document.getElementById('selectBancoMasiva');
        
        if (bancos) {
            bancosGlobal = bancos;
            tbodyBancos.innerHTML = '';
            let optionsBancos = '<option value="">— Selecciona banco —</option>';
            
            bancos.forEach(b => {
                optionsBancos += `<option value="${b.id}">${b.nombre}</option>`;
                tbodyBancos.innerHTML += `
                    <tr class="hover:bg-slate-50">
                        <td class="p-3 border-r border-slate-200 text-slate-800">${b.nombre}</td>
                        <td class="p-3 border-r border-slate-200 text-slate-500">${b.moneda_codigo}</td>
                        <td class="p-3 text-right border-r border-slate-200 text-blue-700">$${Number(b.saldo_sistema).toFixed(2)}</td>
                        <td class="p-3 text-center">
                            <button class="bg-slate-200 text-slate-600 px-3 py-1 rounded text-[11px] font-bold hover:bg-slate-300 transition-colors">Ajustar Banco</button>
                        </td>
                    </tr>
                `;
            });

            selectBancoAjuste.innerHTML = optionsBancos;
            selectBancoMasiva.innerHTML = optionsBancos;
        }
    }

    // ==========================================
    // 2. AJUSTE MANUAL INDIVIDUAL
    // ==========================================
    let clienteEditando = null;
    let tipoEdicion = null; // 'saldo' o 'aval'

    function asignarEventosEditar() {
        document.querySelectorAll('.btn-editar-saldo').forEach(btn => {
            btn.addEventListener('click', function() {
                clienteEditando = {
                    id: this.getAttribute('data-id'),
                    nombre: this.getAttribute('data-nombre'),
                    valorActual: parseFloat(this.getAttribute('data-valor'))
                };
                tipoEdicion = this.getAttribute('data-tipo');
                
                // Configurar Modal
                document.getElementById('modalTitulo').innerHTML = `<i class="fas fa-pencil-alt mr-2"></i> Editar ${tipoEdicion.toUpperCase()} — ${clienteEditando.nombre}`;
                document.getElementById('lblSaldoActual').textContent = `$${clienteEditando.valorActual.toFixed(2)}`;
                document.getElementById('inputNuevoSaldo').value = clienteEditando.valorActual.toFixed(2);
                
                // Color temático
                const bg = document.getElementById('modalHeaderBg');
                if(tipoEdicion === 'saldo') { bg.classList.replace('bg-amber-500', 'bg-emerald-600'); }
                else { bg.classList.replace('bg-emerald-600', 'bg-amber-500'); }

                document.getElementById('modalEditarSaldo').classList.remove('hidden');
            });
        });
    }

    document.getElementById('btnGuardarAjuste').addEventListener('click', async function() {
        const nuevoValor = parseFloat(document.getElementById('inputNuevoSaldo').value);
        const bancoId = document.getElementById('selectBancoAjuste').value;
        const nota = document.getElementById('inputNotaAjuste').value.trim() || 'Ajuste Manual en Auditoría';

        if (isNaN(nuevoValor)) { alert("Ingrese un monto válido."); return; }
        if (!bancoId) { alert("Debe seleccionar un banco para el cuadre."); return; }

        this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Ejecutando...';
        this.disabled = true;

        const diferencia = nuevoValor - clienteEditando.valorActual;
        
        // 1. Actualizar Cliente
        let payloadCliente = {};
        if(tipoEdicion === 'saldo') payloadCliente.saldo_usd = nuevoValor;
        else payloadCliente.aval_usd = nuevoValor;
        
        await supabase.from('clientes').update(payloadCliente).eq('id', clienteEditando.id);

        // 2. Registrar Transacción (Si hay diferencia)
        if (diferencia !== 0) {
            const montoAbsoluto = Math.abs(diferencia);
            const notaFinal = `[AJUSTE ${tipoEdicion.toUpperCase()}] ${nota}`;
            
            if (diferencia > 0) { // Si subió el saldo, es como si hubiera depositado
                await supabase.from('depositos').insert([{ cliente_id: clienteEditando.id, banco_id: bancoId, monto_usd: montoAbsoluto, monto_local: montoAbsoluto, tasa: 1, referencia: notaFinal }]);
            } else { // Si bajó, es como un retiro
                await supabase.from('retiros').insert([{ cliente_id: clienteEditando.id, banco_id: bancoId, monto_usd: montoAbsoluto, referencia: notaFinal }]);
            }

            // 3. Actualizar Banco
            const banco = bancosGlobal.find(b => b.id === bancoId);
            const nuevoSaldoBanco = Number(banco.saldo_sistema) + diferencia;
            await supabase.from('bancos').update({ saldo_sistema: nuevoSaldoBanco }).eq('id', bancoId);
        }

        alert("Ajuste procesado y cuadrado correctamente.");
        document.getElementById('modalEditarSaldo').classList.add('hidden');
        document.getElementById('inputNotaAjuste').value = '';
        this.innerHTML = '<i class="fas fa-save mr-1"></i> Ejecutar Ajuste';
        this.disabled = false;
        
        inicializarTablas();
    });

    // ==========================================
    // 3. SALDOS EN CERO (RESET SEMANAL)
    // ==========================================
    document.getElementById('btnAbrirCero').addEventListener('click', () => {
        document.getElementById('inputConfirmarCero').value = '';
        document.getElementById('modalCero').classList.remove('hidden');
    });

    document.getElementById('btnEjecutarCero').addEventListener('click', async function() {
        const confirmacion = document.getElementById('inputConfirmarCero').value;
        if (confirmacion !== 'CONFIRMAR') {
            alert("Debe escribir la palabra CONFIRMAR (en mayúsculas) para ejecutar el borrado.");
            return;
        }

        this.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Reseteando...';
        this.disabled = true;

        // Resetear todos los clientes
        const ids = clientesGlobal.map(c => c.id);
        if (ids.length > 0) {
            await supabase.from('clientes').update({ saldo_usd: 0, aval_usd: 0 }).in('id', ids);
        }
        
        // Resetear todos los bancos
        const bIds = bancosGlobal.map(b => b.id);
        if (bIds.length > 0) {
            await supabase.from('bancos').update({ saldo_sistema: 0 }).in('id', bIds);
        }

        alert("Los saldos de clientes, avales y bancos han vuelto a cero.");
        document.getElementById('modalCero').classList.add('hidden');
        this.innerHTML = '<i class="fas fa-trash-alt mr-1"></i> Poner en cero';
        this.disabled = false;
        
        inicializarTablas();
    });

    // ==========================================
    // 4. CARGA MASIVA PARSEADA
    // ==========================================
    document.getElementById('btnAbrirMasiva').addEventListener('click', () => {
        document.getElementById('textoCargaMasiva').value = '';
        document.getElementById('modalMasiva').classList.remove('hidden');
    });

    document.getElementById('btnProcesarMasiva').addEventListener('click', async function() {
        const texto = document.getElementById('textoCargaMasiva').value.trim();
        const bancoId = document.getElementById('selectBancoMasiva').value;
        const nota = document.getElementById('notaMasiva').value.trim() || 'Carga Masiva';

        if (!texto) return;
        if (!bancoId) { alert("Seleccione un banco para asentar la carga."); return; }

        const lineas = texto.split('\n');
        let operaciones = 0;
        let errores = [];

        this.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        this.disabled = true;

        const banco = bancosGlobal.find(b => b.id === bancoId);
        let acumuladoBanco = Number(banco.saldo_sistema);

        for (let linea of lineas) {
            linea = linea.trim();
            if (linea === "") continue;

            // Dividir por el último espacio para separar nombre de monto
            const lastSpaceIndex = linea.lastIndexOf(' ');
            if (lastSpaceIndex === -1) continue;

            const nombreStr = linea.substring(0, lastSpaceIndex).trim().toUpperCase();
            const montoStr = linea.substring(lastSpaceIndex + 1).trim();
            const monto = parseFloat(montoStr);

            if (isNaN(monto)) continue;

            const cliente = clientesGlobal.find(c => c.nombre.toUpperCase() === nombreStr);
            if (!cliente) {
                errores.push(`Cliente no encontrado: ${nombreStr}`);
                continue;
            }

            const montoAbsoluto = Math.abs(monto);
            const nuevoSaldoCliente = Number(cliente.saldo_usd) + monto;
            
            // Actualizar Cliente
            await supabase.from('clientes').update({ saldo_usd: nuevoSaldoCliente }).eq('id', cliente.id);
            cliente.saldo_usd = nuevoSaldoCliente; // Update caché local

            // Asentar Transacción y Banco
            acumuladoBanco += monto;
            if (monto > 0) {
                await supabase.from('depositos').insert([{ cliente_id: cliente.id, banco_id: bancoId, monto_usd: montoAbsoluto, monto_local: montoAbsoluto, tasa: 1, referencia: nota }]);
            } else if (monto < 0) {
                await supabase.from('retiros').insert([{ cliente_id: cliente.id, banco_id: bancoId, monto_usd: montoAbsoluto, referencia: nota }]);
            }

            operaciones++;
        }

        // Guardar saldo consolidado en banco
        await supabase.from('bancos').update({ saldo_sistema: acumuladoBanco }).eq('id', bancoId);

        let msj = `Proceso finalizado. ${operaciones} operaciones ejecutadas en la nube.`;
        if (errores.length > 0) msj += `\n\nHubo líneas ignoradas:\n` + errores.join('\n');
        alert(msj);

        document.getElementById('modalMasiva').classList.add('hidden');
        this.innerHTML = '<i class="fas fa-bolt mr-1"></i> Ejecutar Carga Masiva';
        this.disabled = false;
        
        inicializarTablas();
    });

    // ==========================================
    // 5. REPORTE WHATSAPP
    // ==========================================
    document.getElementById('btnReporteWhatsapp').addEventListener('click', () => {
        let txt = `*💰 ESTADO DE CUENTAS*\n🗓️ ${new Date().toLocaleDateString('es-ES')}\n---------------------------\n`;
        
        clientesGlobal.forEach(c => {
            const icono = c.saldo_usd >= 0 ? '✅' : '⚠️';
            txt += `${icono} ${c.nombre}: *${Number(c.saldo_usd).toFixed(2)}*\n`;
        });

        document.getElementById('textoWhatsapp').value = txt;
        document.getElementById('modalWhatsapp').classList.remove('hidden');
        document.getElementById('textoWhatsapp').select();
    });

    document.getElementById('btnCopiarTexto').addEventListener('click', function() {
        const textarea = document.getElementById('textoWhatsapp');
        textarea.select();
        navigator.clipboard.writeText(textarea.value).then(() => {
            const original = this.innerHTML;
            this.innerHTML = '<i class="fas fa-check"></i> Copiado';
            setTimeout(() => this.innerHTML = original, 2000);
        });
    });

    // Modales genéricos
    document.querySelectorAll('.cerrar-modal').forEach(b => {
        b.addEventListener('click', function() { this.closest('.fixed.z-50').classList.add('hidden'); });
    });

    // Arranque
    inicializarTablas();
});