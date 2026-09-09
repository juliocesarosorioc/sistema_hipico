document.addEventListener('DOMContentLoaded', () => {

    const filtroGrupo = document.getElementById('filtroGrupo');
    const selectTablaConfig = document.getElementById('selectTablaConfig');
    const selectEjemplar = document.getElementById('selectEjemplar');
    const panelCompra = document.getElementById('panelCompra');
    const selectCliente = document.getElementById('selectCliente');
    const inputCantidad = document.getElementById('cantidadComprar');

    const lblCostoUnit = document.getElementById('lblCostoUnit');
    const lblPremioUnit = document.getElementById('lblPremioUnit');
    const lblCostoTotal = document.getElementById('lblCostoTotal');
    const lblPremioTotal = document.getElementById('lblPremioTotal');
    const lblDisponibles = document.getElementById('lblDisponibles');
    const lblTotalPagar = document.getElementById('lblTotalPagar');
    const btnProcesarVenta = document.getElementById('btnProcesarVenta');

    const msgSeleccione = document.getElementById('msgSeleccioneTabla');
    const contenidoRiesgo = document.getElementById('contenidoRiesgo');
    const lblRiesgoMonto = document.getElementById('lblRiesgoMonto');
    const lblInventarioProgreso = document.getElementById('lblInventarioProgreso');
    const cuerpoEjemplares = document.getElementById('cuerpoEjemplaresTabla');

    let gruposDB = [];
    let tablasDisponiblesDB = [];
    let clientesDB = [];
    let groupSeleccionado = null;
    let tablaSeleccionada = null;     // { id, premio_recalculado, caballos, hipodromo, carrera }
    let grupoTabla = null;            // tabla_grupos row (cupos, cantidad_vendida) del grupo actual
    let ejemplarSeleccionado = null;
    let tasaCambioGlobal = 1.0;

    function simboloDe(moneda) { return moneda === 'VES' ? 'Bs' : '$'; }

    async function inicializar() {
        const segura = (p) => p.catch(e => ({ data: null, error: e }));
        const [rGrupos, rTablas, rClientes, rMoneda] = await Promise.all([
            segura(window.supabase.from('grupos_venta').select('*').eq('activo', true).order('es_principal', { ascending: false })),
            segura(window.supabase.from('tablas_fijas').select('*, tabla_grupos(*)').eq('estado', 'Abierta')),
            segura(window.supabase.from('clientes').select('id, nombre, saldo_actual, aval, libre, grupo_id').order('nombre')),
            segura(window.supabase.from('monedas').select('tasa_cambio').limit(1).single())
        ]);

        if (rMoneda.data && rMoneda.data.tasa_cambio) tasaCambioGlobal = parseFloat(rMoneda.data.tasa_cambio);

        if (rGrupos.data) {
            gruposDB = rGrupos.data;
            filtroGrupo.innerHTML = '<option value="">Seleccione Grupo...</option>';
            gruposDB.forEach(g => filtroGrupo.innerHTML += `<option value="${g.id}">${g.nombre} (${g.moneda})</option>`);
            if (gruposDB.length === 0) filtroGrupo.innerHTML = '<option value="" disabled>Sin grupos activos (créelos en Tablas Fijas)</option>';
        }

        if (rTablas.data) tablasDisponiblesDB = rTablas.data;
        if (rClientes.data) clientesDB = rClientes.data;
    }

    filtroGrupo.addEventListener('change', () => {
        const id = filtroGrupo.value;
        const g = gruposDB.find(x => x.id == id);
        selectTablaConfig.innerHTML = '<option value="">Seleccione Hipódromo y Carrera...</option>';
        panelCompra.classList.add('hidden');
        msgSeleccione.classList.remove('hidden');
        contenidoRiesgo.classList.add('hidden');

        if (!g) { selectTablaConfig.disabled = true; return; }

        groupSeleccionado = g;
        const elegibles = tablasDisponiblesDB.filter(t => {
            const tg = (t.tabla_grupos || []).find(x => x.grupo_id == g.id);
            return tg && (tg.cupos - (tg.cantidad_vendida || 0)) > 0;
        });

        elegibles.forEach(t => {
            selectTablaConfig.innerHTML += `<option value="${t.id}">${t.hipodromo} - Carrera ${t.carrera} (${g.moneda})</option>`;
        });
        selectTablaConfig.disabled = false;
    });

    selectTablaConfig.addEventListener('change', () => {
        const id = selectTablaConfig.value;
        if (!id) {
            panelCompra.classList.add('hidden');
            msgSeleccione.classList.remove('hidden');
            contenidoRiesgo.classList.add('hidden');
            return;
        }

        const t = tablasDisponiblesDB.find(x => x.id == id);
        const tg = (t.tabla_grupos || []).find(x => x.grupo_id == groupSeleccionado.id);
        tablaSeleccionada = t;
        grupoTabla = tg;

        // Ejemplares disponibles (no retirados)
        const caballos = (t.caballos || []).filter(c => !c.retirado);
        selectEjemplar.innerHTML = '<option value="">Seleccione ejemplar...</option>';
        caballos.forEach(c => selectEjemplar.innerHTML += `<option value="${c.numero}">${c.numero} - ${c.nombre} (${c.valor_ejemplar} pts)</option>`);

        // Clientes del grupo
        const delGrupo = clientesDB.filter(c => c.grupo_id == groupSeleccionado.id);
        selectCliente.innerHTML = '<option value="">Seleccione apostador...</option>';
        delGrupo.forEach(c => selectCliente.innerHTML += `<option value="${c.id}">${c.nombre} (Saldo: $${parseFloat(c.saldo_actual).toFixed(2)})</option>`);
        if (delGrupo.length === 0) selectCliente.innerHTML += '<option value="" disabled>No hay clientes en este grupo</option>';

        renderizarPanelTabla();
    });

    selectEjemplar.addEventListener('change', () => {
        if (!tablaSeleccionada) return;
        ejemplarSeleccionado = (tablaSeleccionada.caballos || []).find(c => c.numero == selectEjemplar.value) || null;
        if (ejemplarSeleccionado) lblCostoUnit.textContent = ejemplarSeleccionado.valor_ejemplar + ' pts';
        actualizarTotales();
    });

    function renderizarPanelTabla() {
        if (!tablaSeleccionada || !grupoTabla) return;

        const simbolo = simboloDe(groupSeleccionado.moneda);
        const limite = grupoTabla.cupos || 0;
        const vendidas = grupoTabla.cantidad_vendida || 0;
        const disponibles = Math.max(0, limite - vendidas);
        const premio = parseFloat(tablaSeleccionada.premio_recalculado);

        lblPremioUnit.textContent = `${simbolo}${premio.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
        lblDisponibles.textContent = disponibles;

        msgSeleccione.classList.add('hidden');
        contenidoRiesgo.classList.remove('hidden');
        contenidoRiesgo.classList.add('flex');
        panelCompra.classList.remove('hidden');

        lblRiesgoMonto.textContent = `${simbolo}${(disponibles * premio).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
        lblInventarioProgreso.textContent = `${vendidas} / ${limite}`;

        cuerpoEjemplares.innerHTML = '';
        tablaSeleccionada.caballos.forEach(c => {
            const retirado = c.retirado;
            cuerpoEjemplares.innerHTML += `
                <tr class="${retirado ? 'opacity-50' : ''}">
                    <td class="p-2 text-center font-bold">${c.numero}</td>
                    <td class="p-2 font-bold text-slate-700">${c.nombre}</td>
                    <td class="p-2 text-right font-bold text-blue-600">${c.valor_ejemplar} pts</td>
                    <td class="p-2 text-center">${retirado ? '<span class="text-[9px] font-black bg-red-100 text-red-600 px-1.5 py-0.5 rounded">RETIRADO</span>' : '<span class="text-[9px] font-black bg-emerald-100 text-emerald-600 px-1.5 py-0.5 rounded">ACTIVO</span>'}</td>
                </tr>
            `;
        });

        actualizarTotales();
    }

    inputCantidad.addEventListener('input', actualizarTotales);

    function actualizarTotales() {
        if (!tablaSeleccionada) return;
        const cant = Math.max(1, parseInt(inputCantidad.value) || 1);
        const simbolo = simboloDe(groupSeleccionado.moneda);
        const premio = parseFloat(tablaSeleccionada.premio_recalculado);
        const pts = ejemplarSeleccionado ? parseFloat(ejemplarSeleccionado.valor_ejemplar) : 0;

        lblCostoTotal.textContent = `${simbolo}${(pts * cant).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
        lblPremioTotal.textContent = `${simbolo}${(premio * cant).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
        lblTotalPagar.textContent = `${simbolo}${(pts * cant).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
    }

    // ==========================================
    // REPORTE DE VENTAS (riesgo por venta y por grupo)
    // ==========================================
    async function cargarReporteVentas() {
        const { data } = await window.supabase
            .from('tickets_apuestas')
            .select('id, created_at, cliente_juega_nombre, grupo, hipodromo, carrera, caballo, cantidad_tablas, monto_jugado, premio_por_tabla, pts_ejemplar, premio_recalculado, moneda')
            .order('created_at', { ascending: false })
            .limit(100);
        const cuerpo = document.getElementById('cuerpoReporteVentas');
        const resumen = document.getElementById('resumenRiesgoGrupos');

        const tickets = data || [];

        if (tickets.length === 0) {
            cuerpo.innerHTML = '<tr><td colspan="9" class="p-4 text-center text-slate-500">Aún no hay ventas de tablas fijas.</td></tr>';
            resumen.innerHTML = '<div class="text-slate-400 italic text-xs">Sin ventas.</div>';
            return;
        }

        // Resumen de riesgo por grupo
        const porGrupo = {};
        tickets.forEach(tk => {
            const premioUnidad = (tk.premio_por_tabla != null && !isNaN(parseFloat(tk.premio_por_tabla)))
                ? parseFloat(tk.premio_por_tabla)
                : (parseFloat(tk.premio_recalculado) || 0);
            const riesgo = parseFloat(tk.cantidad_tablas) * premioUnidad;
            const clave = `${tk.grupo}`;
            if (!porGrupo[clave]) porGrupo[clave] = { riesgoLocal: 0, usaVes: tk.moneda === 'VES', ventas: 0, tablas: 0, moneda: tk.moneda };
            porGrupo[clave].riesgoLocal += riesgo;
            porGrupo[clave].ventas += 1;
            porGrupo[clave].tablas += parseInt(tk.cantidad_tablas) || 0;
        });

        resumen.innerHTML = Object.entries(porGrupo).map(([nombre, g]) => {
            const simb = g.moneda === 'VES' ? 'Bs ' : '$';
            const equivalenteUSD = g.moneda === 'VES' ? (g.riesgoLocal / (tasaCambioGlobal || 1)) : g.riesgoLocal;
            return `
                <div class="bg-slate-50 border border-slate-200 rounded-lg p-3">
                    <div class="flex items-center justify-between">
                        <span class="font-bold text-slate-800 text-sm">${nombre}</span>
                        <span class="px-1.5 py-0.5 rounded text-[9px] font-black ${g.moneda === 'VES' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}">${g.moneda}</span>
                    </div>
                    <p class="text-lg font-black ${g.moneda === 'VES' ? 'text-amber-600' : 'text-emerald-600'} mt-1 font-mono">${simb}${g.riesgoLocal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                    <p class="text-[10px] text-slate-500 mt-1">${g.ventas} venta(s) · ${g.tablas} tablas · equiv. $ ${equivalenteUSD.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                </div>`;
        }).join('');

        // Detalle de ventas
        cuerpo.innerHTML = tickets.map(tk => {
            const premioUnidad = (tk.premio_por_tabla != null && !isNaN(parseFloat(tk.premio_por_tabla)))
                ? parseFloat(tk.premio_por_tabla)
                : (parseFloat(tk.premio_recalculado) || 0);
            const riesgo = parseFloat(tk.cantidad_tablas) * premioUnidad;
            const fecha = tk.created_at ? new Date(tk.created_at).toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' }) : '—';
            const simb = tk.moneda === 'VES' ? 'Bs ' : '$';
            return `
                <tr class="hover:bg-slate-50">
                    <td class="p-2 text-slate-500">${fecha}</td>
                    <td class="p-2 font-bold text-slate-800">${tk.cliente_juega_nombre}</td>
                    <td class="p-2"><span class="px-1.5 py-0.5 rounded text-[9px] font-black bg-slate-200 text-slate-700">${tk.grupo}</span></td>
                    <td class="p-2">${tk.hipodromo} C${tk.carrera}</td>
                    <td class="p-2">${tk.caballo}</td>
                    <td class="p-2 text-right font-bold">${tk.cantidad_tablas}</td>
                    <td class="p-2 text-right text-blue-600 font-bold">${parseFloat(tk.pts_ejemplar || 0).toFixed(1)}</td>
                    <td class="p-2 text-right text-emerald-600 font-bold">${simb}${premioUnidad.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    <td class="p-2 text-right text-red-600 font-black">${simb}${riesgo.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                </tr>`;
        }).join('');
    }

    btnProcesarVenta.addEventListener('click', async () => {
        if (!tablaSeleccionada || !grupoTabla) return clubUI.toast("Seleccione primero grupo y carrera.");
        if (!ejemplarSeleccionado) return clubUI.toast("Seleccione el ejemplar (Posada Ganadora).");

        const clienteId = selectCliente.value;
        const cantidad = parseInt(inputCantidad.value);
        if (!clienteId) return clubUI.toast("Seleccione un cliente comprador.");
        if (isNaN(cantidad) || cantidad <= 0) return clubUI.toast("Cantidad inválida.");

        const limite = grupoTabla.cupos || 0;
        const vendidas = grupoTabla.cantidad_vendida || 0;
        const disponibles = limite - vendidas;
        if (cantidad > disponibles) return clubUI.toast(`No hay suficientes tablas disponibles en el grupo. Solo quedan ${disponibles}.`);

        const cliente = clientesDB.find(c => c.id == clienteId);
        if (!cliente) return clubUI.toast("Cliente no encontrado.");
        if (cliente.grupo_id != groupSeleccionado.id) return clubUI.toast("El cliente no pertenece al grupo seleccionado.");

        const pts = parseFloat(ejemplarSeleccionado.valor_ejemplar);
        const costoTotal = pts * cantidad;
        const esVES = groupSeleccionado.moneda === 'VES';
        const costoUSD = esVES ? costoTotal / (tasaCambioGlobal || 1) : costoTotal;

        if (!cliente.libre) {
            const limiteAval = parseFloat(cliente.aval || 0);
            if (parseFloat(cliente.saldo_actual) - costoUSD < -limiteAval) {
                return clubUI.toast(`El cliente ${cliente.nombre} supera su límite de AVAL ($${limiteAval.toFixed(2)}). Debe abonar antes de comprar tablas.`);
            }
        }

        if (!esVES && parseFloat(cliente.saldo_actual) < costoTotal) {
            if (!confirm(`El cliente ${cliente.nombre} tiene saldo insuficiente ($${cliente.saldo_actual}). ¿Desea proceder de todas formas?`)) return;
        }

        btnProcesarVenta.disabled = true;
        btnProcesarVenta.textContent = "Procesando Venta...";

        try {
            const nombreGrupo = groupSeleccionado.nombre;
            const { error: errTk } = await window.supabase.from('tickets_apuestas').insert([{
                cliente_juega_id: clienteId,
                cliente_juega_nombre: cliente.nombre,
                grupo: nombreGrupo,
                hipodromo: tablaSeleccionada.hipodromo,
                carrera: tablaSeleccionada.carrera,
                nombre_jugada: `TABLA FIJA (${tablaSeleccionada.hipodromo} C${tablaSeleccionada.carrera})`,
                caballo: ejemplarSeleccionado.nombre,
                cantidad_tablas: cantidad,
                monto_jugado: costoTotal,
                premio_por_tabla: parseFloat(tablaSeleccionada.premio_recalculado) || 0,
                pts_ejemplar: pts,
                comision_porcentaje: tablaSeleccionada.comision_grupo || 0,
                moneda: groupSeleccionado.moneda,
                tasa_cambio: tasaCambioGlobal,
                estado: 'Pendiente'
            }]);
            if (errTk) throw errTk;

            const nuevoVendidas = vendidas + cantidad;
            const { error: errTg } = await window.supabase.from('tabla_grupos').update({
                cantidad_vendida: nuevoVendidas
            }).eq('id', grupoTabla.id);
            if (errTg) throw errTg;

            await window.supabase.from('clientes').update({
                saldo_actual: parseFloat(cliente.saldo_actual) - costoUSD
            }).eq('id', clienteId);

            clubUI.toast("¡Venta de tablas procesada con éxito! Inventario actualizado y saldo descontado.");
            window.location.reload();
        } catch (e) {
            console.error(e);
            clubUI.toast("Ocurrió un error al procesar la venta en la base de datos.");
            btnProcesarVenta.disabled = false;
            btnProcesarVenta.textContent = "Procesar Venta de Tablas";
        }
    });

    document.getElementById('btnActualizarReporte')?.addEventListener('click', cargarReporteVentas);

    inicializar();
    cargarReporteVentas();
});