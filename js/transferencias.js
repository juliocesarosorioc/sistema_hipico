// Archivo: js/transferencias.js
// Propósito: Validar saldos, ejecutar transferencias de fondos entre clientes en Supabase y gestionar reportes.

document.addEventListener('DOMContentLoaded', () => {

    const formTransferencia = document.getElementById('formTransferencia');
    const selectOrigen = document.getElementById('clienteOrigen');
    const selectDestino = document.getElementById('clienteDestino');
    const inputMonto = document.getElementById('montoTransferencia');
    const cuerpoSaldos = document.getElementById('cuerpoTablaSaldos');
    const cuerpoHistorial = document.getElementById('cuerpoTablaHistorial');
    let clientesData = []; // Caché para validaciones rápidas
    
    // Configurar fechas
    const hoy = new Date();
    document.getElementById('fechaHeader').textContent = hoy.toLocaleString('es-ES');
    document.getElementById('filtroFecha').value = hoy.toISOString().split('T')[0];

    // ==========================================
    // 1. CARGAR DATOS DESDE SUPABASE (Read)
    // ==========================================
    async function cargarDatosGenerales() {
        // A. Clientes y Saldos
        const { data: clientes } = await supabase.from('clientes').select('id, nombre, saldo_usd').order('nombre');
        
        if (clientes) {
            clientesData = clientes;
            selectOrigen.innerHTML = '<option value="">— Seleccione Origen —</option>';
            selectDestino.innerHTML = '<option value="">— Seleccione Destino —</option>';
            cuerpoSaldos.innerHTML = '';

            clientes.forEach(c => {
                selectOrigen.innerHTML += `<option value="${c.id}" data-saldo="${c.saldo_usd}">${c.nombre} - Disp: $${Number(c.saldo_usd).toFixed(2)}</option>`;
                selectDestino.innerHTML += `<option value="${c.id}">${c.nombre}</option>`;
                
                cuerpoSaldos.innerHTML += `
                    <tr class="hover:bg-slate-50">
                        <td class="p-2 border-r border-slate-200 font-bold">${c.nombre}</td>
                        <td class="p-2 text-right text-slate-800 font-bold ${c.saldo_usd < 0 ? 'text-red-500' : ''}">$${Number(c.saldo_usd).toFixed(2)}</td>
                    </tr>
                `;
            });
        }

        // B. Historial de Transferencias (Solo buscamos depósitos/retiros etiquetados)
        // Por simplicidad en este paso inicial, mostraremos retiros con etiqueta [TRANSFERENCIA]
        const { data: transferencias } = await supabase
            .from('retiros')
            .select('monto_usd, referencia, fecha_registro, clientes(nombre)')
            .ilike('referencia', '%[TRANSFERENCIA]%')
            .order('fecha_registro', { ascending: false })
            .limit(20);

        if (transferencias && transferencias.length > 0) {
            cuerpoHistorial.innerHTML = '';
            transferencias.forEach(t => {
                const origen = t.clientes ? t.clientes.nombre : '—';
                const fecha = new Date(t.fecha_registro).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
                
                // Extraer el destinatario y la nota real de la cadena de referencia
                // Formato esperado: "[TRANSFERENCIA] Para: DESTINO | Nota: texto"
                let destino = "—";
                let notaLimpia = t.referencia;
                
                if (notaLimpia.includes('Para:')) {
                    destino = notaLimpia.split('|')[0].replace('[TRANSFERENCIA] Para: ', '').trim();
                    notaLimpia = notaLimpia.split('|')[1].replace('Nota: ', '').trim();
                }

                cuerpoHistorial.innerHTML += `
                    <tr class="hover:bg-slate-50">
                        <td class="p-2.5 font-bold text-red-600">${origen}</td>
                        <td class="p-2.5 font-bold text-emerald-600">${destino}</td>
                        <td class="p-2.5 text-right font-bold text-slate-800">$${Number(t.monto_usd).toFixed(2)}</td>
                        <td class="p-2.5 text-slate-500">${fecha}</td>
                        <td class="p-2.5 text-slate-600 truncate max-w-[150px]">${notaLimpia}</td>
                        <td class="p-2.5 text-center"><button class="text-slate-400 hover:text-red-500"><i class="fas fa-trash-alt"></i></button></td>
                    </tr>
                `;
            });
        } else {
            cuerpoHistorial.innerHTML = '<tr><td colspan="6" class="p-4 text-center text-slate-500 bg-slate-50 border-b border-slate-200">No hay transferencias recientes</td></tr>';
        }
    }

    // ==========================================
    // 2. PROCESAMIENTO DEL FORMULARIO (Backend)
    // ==========================================
    if (formTransferencia) {
        formTransferencia.addEventListener('submit', async function(e) {
            e.preventDefault(); 
            
            const btnSubmit = this.querySelector('button[type="submit"]');
            const origenId = selectOrigen.value;
            const destinoId = selectDestino.value;
            const monto = parseFloat(inputMonto.value);
            const notaOriginal = document.getElementById('notaTransferencia').value.trim() || 'Sin nota';

            // 2.1 Validación básica
            if (!origenId || !destinoId) {
                alert("Error: Debe seleccionar tanto un Cliente Origen como un Cliente Destino.");
                return;
            }

            if (origenId === destinoId) {
                alert("Operación denegada: El cliente origen y destino no pueden ser el mismo.");
                selectDestino.focus();
                return;
            }

            // 2.2 Validación Matemática de Saldo
            const clienteOrigen = clientesData.find(c => c.id === origenId);
            const clienteDestino = clientesData.find(c => c.id === destinoId);

            if (monto > clienteOrigen.saldo_usd) {
                if (!confirm(`El cliente ${clienteOrigen.nombre} solo tiene $${Number(clienteOrigen.saldo_usd).toFixed(2)} disponible.\n¿Forzar transferencia y dejarlo en negativo?`)) return;
            } else {
                const confirmacion = confirm(`¿Confirma transferir $${monto.toFixed(2)} desde ${clienteOrigen.nombre} hacia ${clienteDestino.nombre}?`);
                if (!confirmacion) return;
            }

            btnSubmit.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Transfiriendo...';
            btnSubmit.disabled = true;

            // 2.3 Cálculo de nuevos saldos
            const nuevoSaldoOrigen = Number(clienteOrigen.saldo_usd) - monto;
            const nuevoSaldoDestino = Number(clienteDestino.saldo_usd) + monto;

            // 2.4 Actualizar saldos en Supabase
            await supabase.from('clientes').update({ saldo_usd: nuevoSaldoOrigen }).eq('id', origenId);
            await supabase.from('clientes').update({ saldo_usd: nuevoSaldoDestino }).eq('id', destinoId);

            // 2.5 Registrar Movimientos (Retiro para el origen, Depósito para el destino)
            // Se etiqueta para que el historial lo identifique como transferencia
            const refOrigen = `[TRANSFERENCIA] Para: ${clienteDestino.nombre} | Nota: ${notaOriginal}`;
            const refDestino = `[TRANSFERENCIA] De: ${clienteOrigen.nombre} | Nota: ${notaOriginal}`;

            await supabase.from('retiros').insert([{ cliente_id: origenId, monto_usd: monto, referencia: refOrigen }]);
            await supabase.from('depositos').insert([{ cliente_id: destinoId, monto_usd: monto, monto_local: monto, tasa: 1, referencia: refDestino }]);

            // Éxito
            alert(`Transferencia Exitosa.\n- $${monto.toFixed(2)} descontado de ${clienteOrigen.nombre}.\n+ $${monto.toFixed(2)} acreditado a ${clienteDestino.nombre}.`);
            
            this.reset();
            btnSubmit.innerHTML = '<i class="fas fa-share-square mr-1"></i> Registrar Transferencia';
            btnSubmit.disabled = false;

            cargarDatosGenerales(); // Refrescar las tablas
        });
    }

    // ==========================================
    // 3. MODAL Y PORTAPAPELES (WHATSAPP DINÁMICO)
    // ==========================================
    const modalWhatsapp = document.getElementById('modalWhatsapp');
    const btnAbrirWhatsapp = document.getElementById('btnSaldosWhatsapp');
    const btnCopiarTexto = document.getElementById('btnCopiarTexto');
    const textoWhatsapp = document.getElementById('textoWhatsapp');

    if (btnAbrirWhatsapp) {
        btnAbrirWhatsapp.addEventListener('click', async function() {
            // Consultar saldos reales desde BD
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