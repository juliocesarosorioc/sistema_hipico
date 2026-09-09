document.addEventListener('DOMContentLoaded', () => {

    const filtroGrupo = document.getElementById('filtroGrupo');
    const selectTablaConfig = document.getElementById('selectTablaConfig');
    const panelCompra = document.getElementById('panelCompra');
    const selectCliente = document.getElementById('selectCliente');
    const inputCantidad = document.getElementById('cantidadComprar');
    
    // UI Resumen
    const lblCostoUnit = document.getElementById('lblCostoUnit');
    const lblPremioUnit = document.getElementById('lblPremioUnit');
    const lblDisponibles = document.getElementById('lblDisponibles');
    const lblTotalPagar = document.getElementById('lblTotalPagar');
    const btnProcesarVenta = document.getElementById('btnProcesarVenta');

    // UI Riesgo
    const msgSeleccione = document.getElementById('msgSeleccioneTabla');
    const contenidoRiesgo = document.getElementById('contenidoRiesgo');
    const lblRiesgoMonto = document.getElementById('lblRiesgoMonto');
    const lblInventarioProgreso = document.getElementById('lblInventarioProgreso');
    const cuerpoEjemplares = document.getElementById('cuerpoEjemplaresTabla');

    let tablasDisponiblesDB = [];
    let tablaSeleccionada = null;
    let clientesDB = [];

    async function inicializar() {
        // Consultas en paralelo: clientes y tablas no dependen entre sí
        const segura = (promesa) => promesa.catch(e => ({ data: null, error: e }));
        const [rClientes, rTablas] = await Promise.all([
            segura(window.supabase.from('clientes').select('id, nombre, saldo_actual, aval, libre').order('nombre')),
            segura(window.supabase.from('tablas_fijas').select('*').eq('estado', 'Abierta'))
        ]);

        const clientes = rClientes.data;
        if(clientes) {
            clientesDB = clientes;
            selectCliente.innerHTML = '<option value="">Seleccione apostador...</option>';
            clientes.forEach(c => selectCliente.innerHTML += `<option value="${c.id}">${c.nombre} (Saldo: $${parseFloat(c.saldo_actual).toFixed(2)})</option>`);
        }

        const tablas = rTablas.data;
        if(tablas) {
            tablasDisponiblesDB = tablas;
            let gruposUnicos = [...new Set(tablas.map(t => t.grupo_venta))];

            filtroGrupo.innerHTML = '<option value="">Seleccione Grupo...</option>';
            gruposUnicos.forEach(g => filtroGrupo.innerHTML += `<option value="${g}">${g}</option>`);
        }
    }

    // Filtrar carreras al cambiar grupo
    filtroGrupo.addEventListener('change', () => {
        const grupo = filtroGrupo.value;
        selectTablaConfig.innerHTML = '<option value="">Seleccione Hipódromo y Carrera...</option>';
        
        if(!grupo) {
            selectTablaConfig.disabled = true;
            panelCompra.classList.add('hidden');
            msgSeleccione.classList.remove('hidden');
            contenidoRiesgo.classList.add('hidden');
            return;
        }

        const filtradas = tablasDisponiblesDB.filter(t => t.grupo_venta === grupo);
        filtradas.forEach(t => {
            selectTablaConfig.innerHTML += `<option value="${t.id}">${t.hipodromo} - Carrera ${t.carrera} (${t.moneda})</option>`;
        });
        selectTablaConfig.disabled = false;
    });

    // Al seleccionar una tabla específica
    selectTablaConfig.addEventListener('change', () => {
        const id = selectTablaConfig.value;
        if(!id) {
            panelCompra.classList.add('hidden');
            msgSeleccione.classList.remove('hidden');
            contenidoRiesgo.classList.add('hidden');
            return;
        }

        tablaSeleccionada = tablasDisponiblesDB.find(t => t.id == id);
        renderizarPanelTabla();
    });

    function renderizarPanelTabla() {
        if(!tablaSeleccionada) return;

        let simbolo = tablaSeleccionada.moneda === 'VES' ? 'Bs' : '$';
        let limite = tablaSeleccionada.limite_ventas || 100;
        let vendidas = tablaSeleccionada.cantidad_vendida || 0;
        let disponibles = limite - vendidas;

        lblCostoUnit.textContent = `${simbolo}${tablaSeleccionada.monto_tabla}`;
        lblPremioUnit.textContent = `${simbolo}${parseFloat(tablaSeleccionada.premio_recalculado).toLocaleString()}`;
        lblDisponibles.textContent = disponibles;

        // Actualizar totales de compra
        actualizarTotalPagar();

        // Mostrar Panel de Riesgo
        msgSeleccione.classList.add('hidden');
        contenidoRiesgo.classList.remove('hidden');
        contenidoRiesgo.classList.add('flex');
        panelCompra.classList.remove('hidden');

        // Métricas de riesgo
        let riesgoActual = disponibles * tablaSeleccionada.premio_recalculado;
        lblRiesgoMonto.textContent = `${simbolo}${riesgoActual.toLocaleString(undefined, {minimumFractionDigits:2})}`;
        lblInventarioProgreso.textContent = `${vendidas} / ${limite}`;

        // Tabla de ejemplares
        cuerpoEjemplares.innerHTML = '';
        tablaSeleccionada.caballos.forEach(c => {
            cuerpoEjemplares.innerHTML += `
                <tr>
                    <td class="p-2 text-center font-bold">${c.numero}</td>
                    <td class="p-2 font-bold text-slate-700">${c.nombre}</td>
                    <td class="p-2 text-right font-bold text-blue-600">${c.valor_ejemplar} pts</td>
                </tr>
            `;
        });
    }

    inputCantidad.addEventListener('input', actualizarTotalPagar);

    function actualizarTotalPagar() {
        if(!tablaSeleccionada) return;
        let cant = parseInt(inputCantidad.value) || 1;
        let total = cant * tablaSeleccionada.monto_tabla;
        let simbolo = tablaSeleccionada.moneda === 'VES' ? 'Bs' : '$';
        lblTotalPagar.textContent = `${simbolo}${total.toLocaleString(undefined, {minimumFractionDigits:2})}`;
    }

    // PROCESAR VENTA Y DESCONTAR SALDO
    btnProcesarVenta.addEventListener('click', async () => {
        const clienteId = selectCliente.value;
        const cantidad = parseInt(inputCantidad.value);

        if(!clienteId) return clubUI.toast("Seleccione un cliente comprador.");
        if(isNaN(cantidad) || cantidad <= 0) return clubUI.toast("Cantidad inválida.");

        let limite = tablaSeleccionada.limite_ventas || 100;
        let vendidas = tablaSeleccionada.cantidad_vendida || 0;
        let disponibles = limite - vendidas;

        if(cantidad > disponibles) {
            return clubUI.toast(`No hay suficientes tablas disponibles. Solo quedan ${disponibles} cupos.`);
        }

        const cliente = clientesDB.find(c => c.id == clienteId);
        let costoTotal = cantidad * tablaSeleccionada.monto_tabla;

        // REGLA DE NEGOCIO (AVAL): límite de pérdida, no es saldo. Si no juega libre,
        // su saldo puede quedar negativo pero nunca pasar de -AVAL.
        if (!cliente.libre) {
            const limiteAval = parseFloat(cliente.aval || 0);
            if (parseFloat(cliente.saldo_actual) - costoTotal < -limiteAval) {
                return clubUI.toast(`El cliente ${cliente.nombre} supera su límite de AVAL ($${limiteAval.toFixed(2)}). Debe abonar antes de comprar tablas.`);
            }
        }

        // Validar saldo del cliente (si opera en la misma moneda)
        if(tablaSeleccionada.moneda === 'USD' && parseFloat(cliente.saldo_actual) < costoTotal) {
            if(!confirm(`El cliente ${cliente.nombre} tiene saldo insuficiente ($${cliente.saldo_actual}). ¿Desea proceder de todas formas?`)) return;
        }

        btnProcesarVenta.disabled = true;
        btnProcesarVenta.textContent = "Procesando Venta...";

        try {
            // 1. Registrar Ticket de Apuesta para el Módulo de Liquidación (saldos.js)
            const { error: errTk } = await window.supabase.from('tickets_apuestas').insert([{
                cliente_juega_id: clienteId,
                cliente_juega_nombre: cliente.nombre,
                grupo: tablaSeleccionada.grupo_venta,
                hipodromo: tablaSeleccionada.hipodromo,
                carrera: tablaSeleccionada.carrera,
                nombre_jugada: `TABLA FIJA (${tablaSeleccionada.hipodromo} C${tablaSeleccionada.carrera})`,
                caballo: 'LOTE COMPLETO',
                cantidad_tablas: cantidad,
                monto_jugado: costoTotal,
                comision_porcentaje: tablaSeleccionada.comision_grupo,
                moneda: tablaSeleccionada.moneda,
                tasa_cambio: tablaSeleccionada.tasa_cambio,
                estado: 'Pendiente'
            }]);
            if(errTk) throw errTk;

            // 2. Actualizar inventario de la tabla (aumentar cantidad vendida)
            let nuevoVendidas = vendidas + cantidad;
            const { error: errTb } = await window.supabase.from('tablas_fijas').update({
                cantidad_vendida: nuevoVendidas
            }).eq('id', tablaSeleccionada.id);
            if(errTb) throw errTb;

            // 3. Descontar saldo del cliente
            let nuevoSaldoCliente = parseFloat(cliente.saldo_actual) - costoTotal;
            await window.supabase.from('clientes').update({
                saldo_actual: nuevoSaldoCliente
            }).eq('id', clienteId);

            clubUI.toast("✅ ¡Venta de tablas procesada con éxito! Inventario actualizado y saldo descontado.");
            window.location.reload();

        } catch (e) {
            console.error(e);
            clubUI.toast("Ocurrió un error al procesar la venta en la base de datos.");
            btnProcesarVenta.disabled = false;
            btnProcesarVenta.textContent = "Procesar Venta de Tablas";
        }
    });

    inicializar();
});