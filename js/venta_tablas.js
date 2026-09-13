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
    const lblGananciaTotal = document.getElementById('lblGananciaTotal');
    const lblComisionPorc = document.getElementById('lblComisionPorc');
    const lblComisionGrupo = document.getElementById('lblComisionGrupo');
    const btnProcesarVenta = document.getElementById('btnProcesarVenta');

    const msgSeleccione = document.getElementById('msgSeleccioneTabla');
    const contenidoRiesgo = document.getElementById('contenidoRiesgo');
    const lblRiesgoMonto = document.getElementById('lblRiesgoMonto');
    const lblInventarioProgreso = document.getElementById('lblInventarioProgreso');
    const cuerpoEjemplares = document.getElementById('cuerpoEjemplaresTabla');
    const cuerpoReporteClientes = document.getElementById('cuerpoReporteClientes');

    let gruposDB = [];
    let tablasDisponiblesDB = [];
    let clientesDB = [];
    let miembrosExtraPorGrupo = {}; // { grupo_id: [cliente_id,...] } pertenencias adicionales (multi-grupo)
    let groupSeleccionado = null;
    let tablaSeleccionada = null;     // { id, premio_recalculado, caballos, hipodromo, carrera }
    let grupoTabla = null;            // tabla_grupos row (cupos, cantidad_vendida) del grupo actual
    let ejemplarSeleccionado = null;
    let tasaCambioGlobal = 1.0;

    function simboloDe(moneda) { return moneda === 'VES' ? 'Bs' : '$'; }

    async function inicializar() {
        const segura = (p) => p.catch(e => ({ data: null, error: e }));
        const [rGrupos, rTablas, rClientes, rMoneda, rMembresias] = await Promise.all([
            segura(window.supabase.from('grupos_venta').select('*').eq('activo', true).order('es_principal', { ascending: false })),
            segura(window.supabase.from('tablas_fijas').select('*, tabla_grupos(*)').eq('estado', 'Abierta')),
            segura(window.supabase.from('clientes').select('id, nombre, saldo_actual, aval, libre, modo_juego, grupo_id').order('nombre')),
            segura(window.supabase.from('monedas').select('tasa_cambio').limit(1).single()),
            segura(window.supabase.from('clientes_grupos').select('grupo_id, cliente_id'))
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

        if (rTablas.error) {
            clubUI.aviso('Error cargando tablas publicadas',
                `No se pudieron obtener las tablas fijas: ${rTablas.error.message || rTablas.error}\n\nVerifique que ejecutó el SQL completo (paquete_pendientes.sql) y que las carreras estén publicadas desde el Ensamblaje.`, 'error');
        } else if (tablasDisponiblesDB.length === 0 && !sessionStorage.getItem('venta_tablas_vacio_aviso')) {
            sessionStorage.setItem('venta_tablas_vacio_aviso', '1');
            clubUI.aviso('Sin tablas disponibles para vender',
                'No hay tablas fijas publicadas (estado "Abierta").\n\n' +
                'Vaya a Ensamblaje de Tablas Fijas → publice las carreras del día y luego regrese aquí para vender.', 'warning');
        }

        // Pertenencias adicionales (clientes_grupos) para listar miembros de un grupo
        if (rMembresias.data && rMembresias.data.length) {
            rMembresias.data.forEach(m => {
                (miembrosExtraPorGrupo[m.grupo_id] = miembrosExtraPorGrupo[m.grupo_id] || []).push(m.cliente_id);
            });
        }
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
        preseleccionarTablaPrograma(elegibles);
        selectTablaConfig.disabled = false;
    });

    // Programa del día compartido: si la carrera cargada por el Ensamblaje está
    // en venta para este grupo, la deja preseleccionada.
    function preseleccionarTablaPrograma(lista) {
        const prog = window.clubPrograma && window.clubPrograma.obtener();
        const primera = prog && prog.carreras && prog.carreras[0];
        if (!primera || !lista.length) return;
        const match = lista.find(t =>
            String(t.hipodromo || '').toUpperCase() === String(primera.hipodromo || '').toUpperCase() &&
            (primera.carrera ? String(t.carrera) === String(primera.carrera) : true)
        );
        if (match) {
            selectTablaConfig.value = match.id;
            selectTablaConfig.dispatchEvent(new Event('change'));
        }
    }

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
        caballos.forEach(c => selectEjemplar.innerHTML += `<option value="${c.numero}">${c.numero} - ${c.nombre} (Valor: ${c.valor_ejemplar ?? 0})</option>`);

        // Aviso de retirados de esta carrera
        const retirados = (t.caballos || []).filter(c => c.retirado).map(c => c.numero);
        const retirosEl = document.getElementById('ventaRetirosInfo');
        const retirosTexto = document.getElementById('ventaRetirosTexto');
        if (retirosEl && retirosTexto) {
            if (retirados.length > 0) {
                retirosTexto.textContent = 'Ejemplares retirados de esta carrera: ' + retirados.map(n => 'N° ' + n).join(', ') + '. Se descuentan del pago y el ganador no puede ser uno de ellos.';
                retirosEl.classList.remove('hidden');
            } else {
                retirosEl.classList.add('hidden');
            }
        }

        // Clientes del grupo (principales + pertenencia adicional multi-grupo)
        const extraIds = (miembrosExtraPorGrupo[groupSeleccionado.id] || []).filter(id => !clientesDB.find(c => c.id == id && c.grupo_id == groupSeleccionado.id));
        const delGrupo = clientesDB
            .filter(c => c.grupo_id == groupSeleccionado.id || extraIds.includes(c.id))
            .sort((a, b) => a.nombre.localeCompare(b.nombre));
        selectCliente.innerHTML = '<option value="">Seleccione apostador...</option>';
        delGrupo.forEach(c => selectCliente.innerHTML += `<option value="${c.id}">${c.nombre} (Saldo: $${clubUI.formatoNumero(parseFloat(c.saldo_actual), 2)})</option>`);
        if (delGrupo.length === 0) selectCliente.innerHTML += '<option value="" disabled>No hay clientes en este grupo</option>';

        renderizarPanelTabla();
    });

    selectEjemplar.addEventListener('change', () => {
        if (!tablaSeleccionada) return;
        ejemplarSeleccionado = (tablaSeleccionada.caballos || []).find(c => c.numero == selectEjemplar.value) || null;
        if (ejemplarSeleccionado) lblCostoUnit.textContent = 'Valor: ' + (ejemplarSeleccionado.valor_ejemplar ?? 0);
        actualizarTotales();
    });

    function renderizarPanelTabla() {
        if (!tablaSeleccionada || !grupoTabla) return;

        const simbolo = simboloDe(groupSeleccionado.moneda);
        const limite = grupoTabla.cupos || 0;
        const vendidas = grupoTabla.cantidad_vendida || 0;
        const disponibles = Math.max(0, limite - vendidas);
        const premio = parseFloat(tablaSeleccionada.premio_recalculado);

        lblPremioUnit.textContent = `${simbolo}${clubUI.formatoNumero(premio, 2)}`;
        lblDisponibles.textContent = disponibles;

        msgSeleccione.classList.add('hidden');
        contenidoRiesgo.classList.remove('hidden');
        contenidoRiesgo.classList.add('flex');
        panelCompra.classList.remove('hidden');

        lblRiesgoMonto.textContent = `${simbolo}${clubUI.formatoNumero((disponibles * premio), 2)}`;
        lblInventarioProgreso.textContent = `${vendidas} / ${limite}`;

        cuerpoEjemplares.innerHTML = '';
        tablaSeleccionada.caballos.forEach(c => {
            const retirado = c.retirado;
            cuerpoEjemplares.innerHTML += `
                <tr class="${retirado ? 'opacity-50' : ''}">
                    <td class="p-2 text-center font-bold">${c.numero}</td>
                    <td class="p-2 font-bold text-slate-700">${c.nombre}</td>
                    <td class="p-2 text-right font-bold text-blue-600">Valor: ${c.valor_ejemplar ?? 0}</td>
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
        const premio = parseFloat(tablaSeleccionada.premio_recalculado) || 0;
        const pts = ejemplarSeleccionado ? parseFloat(ejemplarSeleccionado.valor_ejemplar) : 0;
        const costoTotal = pts * cant;
        const premioTotal = premio * cant;
        const gananciaTotal = Math.max(0, premioTotal - costoTotal);
        const comisionPorc = parseFloat(tablaSeleccionada.comision_grupo || 2.5);
        const comisionEstimada = gananciaTotal * (comisionPorc / 100);

        lblCostoTotal.textContent = `${simbolo}${clubUI.formatoNumero(costoTotal, 2)}`;
        lblPremioTotal.textContent = `${simbolo}${clubUI.formatoNumero(premioTotal, 2)}`;
        lblGananciaTotal.textContent = `${simbolo}${clubUI.formatoNumero(gananciaTotal, 2)}`;
        lblComisionPorc.textContent = clubUI.formatoNumero(comisionPorc, 1);
        lblComisionGrupo.textContent = `${simbolo}${clubUI.formatoNumero(comisionEstimada, 2)}`;
        lblTotalPagar.textContent = `${simbolo}${clubUI.formatoNumero(costoTotal, 2)}`;
    }

    // ==========================================
    // REPORTE DE VENTAS (riesgo por venta y por grupo)
    // ==========================================
    async function cargarReporteVentas() {
        const { data } = await window.supabase
            .from('tickets_apuestas')
            .select('id, created_at, cliente_juega_nombre, grupo, hipodromo, carrera, caballo, cantidad_tablas, monto_jugado, premio_por_tabla, pts_ejemplar, premio_recalculado, comision_porcentaje, moneda')
            .order('created_at', { ascending: false })
            .limit(100);
        const cuerpo = document.getElementById('cuerpoReporteVentas');
        const consol = document.getElementById('cuerpoReporteConsolidado');
        const resumen = document.getElementById('resumenRiesgoGrupos');

        const tickets = data || [];

        if (tickets.length === 0) {
            cuerpo.innerHTML = '<tr><td colspan="12" class="p-4 text-center text-slate-500">Aún no hay ventas de tablas fijas.</td></tr>';
            consol.innerHTML = '<tr><td colspan="6" class="p-4 text-center text-slate-500">Sin ventas.</td></tr>';
            cuerpoReporteClientes.innerHTML = '<tr><td colspan="7" class="p-4 text-center text-slate-500">Sin ventas.</td></tr>';
            resumen.innerHTML = '<div class="text-slate-400 italic text-xs">Sin ventas.</div>';
            return;
        }

        const premioUnidad = (tk) => (tk.premio_por_tabla != null && !isNaN(parseFloat(tk.premio_por_tabla)))
            ? parseFloat(tk.premio_por_tabla)
            : (parseFloat(tk.premio_recalculado) || 0);

        // Resumen de riesgo por grupo
        const porGrupo = {};
        tickets.forEach(tk => {
            const riesgo = parseFloat(tk.cantidad_tablas) * premioUnidad(tk);
            const montoA = parseFloat(tk.cantidad_tablas) * (parseFloat(tk.pts_ejemplar || 0) || 0);
            const ganancia = Math.max(0, riesgo - montoA);
            const comision = ganancia * (parseFloat(tk.comision_porcentaje || 0) / 100);
            const clave = `${tk.grupo}`;
            if (!porGrupo[clave]) porGrupo[clave] = { riesgoLocal: 0, gananciaLocal: 0, comisionLocal: 0, usaVes: tk.moneda === 'VES', ventas: 0, tablas: 0, moneda: tk.moneda };
            porGrupo[clave].riesgoLocal += riesgo;
            porGrupo[clave].gananciaLocal += ganancia;
            porGrupo[clave].comisionLocal += comision;
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
                    <p class="text-lg font-black ${g.moneda === 'VES' ? 'text-amber-600' : 'text-emerald-600'} mt-1 font-mono">${simb}${clubUI.formatoNumero(g.riesgoLocal, 2)}</p>
                    <p class="text-[10px] text-slate-500 mt-1">${g.ventas} venta(s) · ${g.tablas} tablas · equiv. $ ${clubUI.formatoNumero(equivalenteUSD, 2)}</p>
                    <p class="text-[11px] font-bold mt-1 text-emerald-700">Ganancia: ${simb}${clubUI.formatoNumero(g.gananciaLocal, 2)}</p>
                    <p class="text-[11px] font-bold text-purple-700">Comisión Grupo: ${simb}${clubUI.formatoNumero(g.comisionLocal, 2)}</p>
                    <button class="btn-reporte-grupo mt-2 w-full px-2 py-1 rounded text-[10px] font-bold bg-slate-800 text-white hover:bg-slate-700" data-grupo="${nombre}">
                        <i class="fas fa-print"></i> Imprimir reporte del grupo
                    </button>
                </div>`;
        }).join('');

        document.querySelectorAll('.btn-reporte-grupo').forEach(b => b.addEventListener('click', () => imprimirReporteGrupo(b.dataset.grupo, tickets, premioUnidad)));

        // Reporte consolidado: grupo / carrera / ejemplar + monto arriesgado
        const porGCE = {};
        tickets.forEach(tk => {
            const clave = `${tk.grupo}|${tk.hipodromo}|C${tk.carrera}|${tk.caballo}`;
            if (!porGCE[clave]) porGCE[clave] = {
                grupo: tk.grupo, hipodromo: tk.hipodromo, carrera: tk.carrera, ejemplar: tk.caballo,
                tablas: 0, arriesgado: 0, premioPotencial: 0, simb: tk.moneda === 'VES' ? 'Bs ' : '$'
            };
            const n = parseInt(tk.cantidad_tablas) || 0;
            porGCE[clave].tablas += n;
            porGCE[clave].arriesgado += n * (parseFloat(tk.pts_ejemplar || 0) || 0);
            porGCE[clave].premioPotencial += n * premioUnidad(tk);
        });

        consol.innerHTML = Object.values(porGCE).map(g => `
            <tr class="hover:bg-emerald-50">
                <td class="p-3"><span class="px-1.5 py-0.5 rounded text-[9px] font-black bg-slate-200 text-slate-700">${g.grupo}</span></td>
                <td class="p-3 font-bold text-slate-800">${g.hipodromo} C${g.carrera}</td>
                <td class="p-3 font-bold text-slate-700">${g.ejemplar}</td>
                <td class="p-3 text-right font-black">${g.tablas}</td>
                <td class="p-3 text-right font-mono font-bold text-red-600">${g.simb}${clubUI.formatoNumero(g.arriesgado, 2)}</td>
                <td class="p-3 text-right font-mono font-bold text-emerald-600">${g.simb}${clubUI.formatoNumero(g.premioPotencial, 2)}</td>
            </tr>`).join('');

        // Detalle de ventas
        cuerpo.innerHTML = tickets.map(tk => {
            const premio = premioUnidad(tk);
            const riesgo = parseFloat(tk.cantidad_tablas) * premio;
            const montoArriesgado = parseFloat(tk.cantidad_tablas) * (parseFloat(tk.pts_ejemplar || 0) || 0);
            const ganancia = Math.max(0, riesgo - montoArriesgado);
            const comision = ganancia * (parseFloat(tk.comision_porcentaje || 0) / 100);
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
                    <td class="p-2 text-right text-blue-600 font-bold">${clubUI.formatoNumero(parseFloat(tk.pts_ejemplar || 0), 1)}</td>
                    <td class="p-2 text-right text-emerald-600 font-bold">${simb}${clubUI.formatoNumero(premio, 2)}</td>
                    <td class="p-2 text-right text-red-600 font-bold">${simb}${clubUI.formatoNumero(montoArriesgado, 2)}</td>
                    <td class="p-2 text-right text-orange-600 font-black">${simb}${clubUI.formatoNumero(riesgo, 2)}</td>
                    <td class="p-2 text-right text-emerald-700 font-bold">${simb}${clubUI.formatoNumero(ganancia, 2)}</td>
                    <td class="p-2 text-right text-purple-700 font-bold">${simb}${clubUI.formatoNumero(comision, 2)}</td>
                </tr>`;
        }).join('');

        // Resumen por cliente
        const porCliente = {};
        tickets.forEach(tk => {
            const premio = premioUnidad(tk);
            const n = parseInt(tk.cantidad_tablas) || 0;
            const montoA = n * (parseFloat(tk.pts_ejemplar || 0) || 0);
            const ganancia = Math.max(0, (n * premio) - montoA);
            const comision = ganancia * (parseFloat(tk.comision_porcentaje || 0) / 100);
            const nombre = tk.cliente_juega_nombre || 'Sin cliente';
            if (!porCliente[nombre]) porCliente[nombre] = { tablas: 0, monto: 0, premio: 0, ganancia: 0, comision: 0, ventas: 0, moneda: tk.moneda };
            porCliente[nombre].tablas += n;
            porCliente[nombre].monto += montoA;
            porCliente[nombre].premio += n * premio;
            porCliente[nombre].ganancia += ganancia;
            porCliente[nombre].comision += comision;
            porCliente[nombre].ventas += 1;
        });

        cuerpoReporteClientes.innerHTML = Object.entries(porCliente).map(([nombre, c]) => {
            const simb = c.moneda === 'VES' ? 'Bs ' : '$';
            return `
                <tr class="hover:bg-slate-50">
                    <td class="p-2 font-bold text-slate-800">${nombre}</td>
                    <td class="p-2 text-center">${c.ventas}</td>
                    <td class="p-2 text-right font-bold">${c.tablas}</td>
                    <td class="p-2 text-right font-bold text-red-600">${simb}${clubUI.formatoNumero(c.monto, 2)}</td>
                    <td class="p-2 text-right font-bold text-emerald-600">${simb}${clubUI.formatoNumero(c.premio, 2)}</td>
                    <td class="p-2 text-right font-bold text-emerald-700">${simb}${clubUI.formatoNumero(c.ganancia, 2)}</td>
                    <td class="p-2 text-right font-bold text-purple-700">${simb}${clubUI.formatoNumero(c.comision, 2)}</td>
                </tr>`;
        }).join('');
    }

    function imprimirReporteGrupo(nombreGrupo, tickets, premioUnidad) {
        const delGrupo = tickets.filter(tk => tk.grupo === nombreGrupo);
        if (!delGrupo.length) return clubUI.toast("Sin ventas para este grupo.");
        const simb = delGrupo[0].moneda === 'VES' ? 'Bs ' : '$';
        const filas = delGrupo.map((tk, i) => {
            const premio = premioUnidad(tk);
            const n = parseInt(tk.cantidad_tablas) || 0;
            const montoA = n * (parseFloat(tk.pts_ejemplar || 0) || 0);
            const riesgo = n * premio;
            const ganancia = Math.max(0, riesgo - montoA);
            const comision = ganancia * (parseFloat(tk.comision_porcentaje || 0) / 100);
            const fecha = tk.created_at ? new Date(tk.created_at).toLocaleString('es-VE', { dateStyle: 'short' }) : '—';
            return `<tr>
                <td>${i + 1}</td>
                <td>${fecha}</td>
                <td>${tk.cliente_juega_nombre}</td>
                <td>${tk.hipodromo} C${tk.carrera}</td>
                <td>${tk.caballo}</td>
                <td class="r b">${n}</td>
                <td class="r">${simb}${clubUI.formatoNumero(montoA, 2)}</td>
                <td class="r">${simb}${clubUI.formatoNumero(riesgo, 2)}</td>
                <td class="r b">${simb}${clubUI.formatoNumero(ganancia, 2)}</td>
                <td class="r b">${simb}${clubUI.formatoNumero(comision, 2)}</td>
            </tr>`;
        }).join('');

        const tot = delGrupo.reduce((a, tk) => {
            const premio = premioUnidad(tk);
            const n = parseInt(tk.cantidad_tablas) || 0;
            const montoA = n * (parseFloat(tk.pts_ejemplar || 0) || 0);
            const riesgo = n * premio;
            const ganancia = Math.max(0, riesgo - montoA);
            a.monto += montoA; a.riesgo += riesgo; a.ganancia += ganancia;
            a.comision += ganancia * (parseFloat(tk.comision_porcentaje || 0) / 100);
            a.tablas += n; return a;
        }, { monto: 0, riesgo: 0, ganancia: 0, comision: 0, tablas: 0 });

        const fechaGen = new Date().toLocaleString('es-VE', { dateStyle: 'long', timeStyle: 'short' });
        const html = `
            <h1>Reporte de Ventas — Tabla Fija</h1>
            <div class="sub">Grupo: <b>${nombreGrupo}</b> · Generado: ${fechaGen}</div>
            <table>
                <tr><th>#</th><th>Fecha</th><th>Cliente</th><th>Carrera</th><th>Ejemplar</th><th>Tablas</th><th>Monto</th><th>Premio</th><th>Ganancia</th><th>Comisión Grupo</th></tr>
                ${filas}
                <tr class="gran">
                    <td colspan="5">TOTALES (${delGrupo.length} ventas · ${tot.tablas} tablas)</td>
                    <td class="r b">${tot.tablas}</td>
                    <td class="r b">${simb}${clubUI.formatoNumero(tot.monto, 2)}</td>
                    <td class="r b">${simb}${clubUI.formatoNumero(tot.riesgo, 2)}</td>
                    <td class="r b">${simb}${clubUI.formatoNumero(tot.ganancia, 2)}</td>
                    <td class="r b">${simb}${clubUI.formatoNumero(tot.comision, 2)}</td>
                </tr>
            </table>
            <div class="aviso">La comisión se calcula sobre la ganancia (premio − monto jugado) si el ejemplar gana.</div>
        `;
        imprimirHTML(`Reporte — ${nombreGrupo}`, html);
    }

    // ==========================================
    // VENTA REUTILIZABLE (taquilla directa y aprobación de solicitudes)
    // Retorna { ok: bool, error: string }
    // ==========================================
    async function procesarVenta({ cliente, cantidad, ejemplar, tabla, tg, grupo, permitirSobregiro = false }) {
        if (!grupo) grupo = gruposDB.find(x => x.id == tg.grupo_id);
        if (!grupo) return { ok: false, error: "Grupo no encontrado." };

        const pts = parseFloat(ejemplar.valor_ejemplar);
        const costoTotal = pts * cantidad;
        const esVES = grupo.moneda === 'VES';
        const costoUSD = esVES ? costoTotal / (tasaCambioGlobal || 1) : costoTotal;

        if (!permitirSobregiro) {
            const modoJuega = cliente.modo_juego || (cliente.libre ? 'libre' : 'aval');
            if (modoJuega === 'pozo') {
                const disp = parseFloat(cliente.saldo_actual);
                if (disp < costoUSD) {
                    return { ok: false, error: `El cliente ${cliente.nombre} juega con Pozo y no tiene saldo disponible (tiene $${clubUI.formatoNumero(disp, 2)}). Debe abonar antes de comprar tablas.` };
                }
            } else if (!cliente.libre) {
                const limiteAval = parseFloat(cliente.aval || 0);
                if (parseFloat(cliente.saldo_actual) - costoUSD < -limiteAval) {
                    return { ok: false, error: `El cliente ${cliente.nombre} supera su límite de AVAL ($${clubUI.formatoNumero(limiteAval, 2)}). Debe abonar antes de comprar tablas.` };
                }
            }
            if (!esVES && parseFloat(cliente.saldo_actual) < costoTotal) {
                return { ok: false, error: `El cliente ${cliente.nombre} tiene saldo insuficiente ($${clubUI.formatoNumero(cliente.saldo_actual, 2)}).` };
            }
        }

        const vendidas = tg.cantidad_vendida || 0;
        const disponibles = (tg.cupos || 0) - vendidas;
        if (cantidad > disponibles) return { ok: false, error: `No hay suficientes tablas disponibles en el grupo. Solo quedan ${disponibles}.` };

        const premio = parseFloat(tabla.premio_recalculado) || 0;
        const premioTotal = premio * cantidad;
        const gananciaTotal = Math.max(0, premioTotal - costoTotal);
        const comisionPorc = parseFloat(tabla.comision_grupo || 2.5);
        const comisionEstimada = gananciaTotal * (comisionPorc / 100);

        const { error: errTk } = await window.supabase.from('tickets_apuestas').insert([{
            cliente_juega_id: cliente.id,
            cliente_juega_nombre: cliente.nombre,
            grupo: grupo.nombre,
            hipodromo: tabla.hipodromo,
            carrera: tabla.carrera,
            nombre_jugada: `TABLA FIJA (${tabla.hipodromo} C${tabla.carrera})`,
            caballo: ejemplar.nombre,
            cantidad_tablas: cantidad,
            monto_jugado: costoTotal,
            premio_por_tabla: premio,
            pts_ejemplar: pts,
            monto_decidido: gananciaTotal,
            comision_porcentaje: comisionPorc,
            moneda: grupo.moneda,
            tasa_cambio: tasaCambioGlobal,
            estado: 'Pendiente'
        }]);
        if (errTk) return { ok: false, error: 'Ticket: ' + (errTk.message || errTk.code) };

        const nuevoVendidas = vendidas + cantidad;
        const { error: errTg } = await window.supabase.from('tabla_grupos').update({
            cantidad_vendida: nuevoVendidas
        }).eq('id', tg.id);
        if (errTg) return { ok: false, error: 'Inventario: ' + (errTg.message || errTg.code) };

        const { error: errCl } = await window.supabase.from('clientes').update({
            saldo_actual: parseFloat(cliente.saldo_actual) - costoUSD
        }).eq('id', cliente.id);
        if (errCl) return { ok: false, error: 'Saldo: ' + (errCl.message || errCl.code) };

        return {
            ok: true, costoTotal, premioTotal, gananciaTotal,
            comisionEstimada, comisionPorc, premio, pts, cantidad, esVES
        };
    }

    // ==========================================
    // COMPROBANTE IMPRIMIBLE PARA EL CLIENTE
    // ==========================================
    function simboloMoneda(m) { return m === 'VES' ? 'Bs ' : '$'; }

    function imprimirHTML(titulo, html) {
        const w = window.open('', '_blank', 'width=460,height=680');
        if (!w) { alert('Permita ventanas emergentes para poder imprimir la recepción.'); return; }
        w.document.write(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${titulo}</title>
<style>
    body{font-family:'Segoe UI',Arial,sans-serif;color:#0f172a;margin:22px;font-size:13px}
    h1{font-size:16px;text-align:center;border-bottom:2px solid #10b981;padding-bottom:8px;margin:0 0 4px}
    .sub{text-align:center;color:#64748b;font-size:11px;margin-bottom:12px}
    table{width:100%;border-collapse:collapse;margin-top:8px}
    td,th{border:1px solid #cbd5e1;padding:5px 8px;text-align:left;font-size:12px}
    th{background:#f1f5f9}
    .r{text-align:right}.b{font-weight:700}
    .gran{border-top:3px double #0f172a;margin-top:6px;background:#ecfdf5;font-weight:700}
    .aviso{font-size:10px;color:#475569;margin-top:10px;text-align:center}
</style></head><body>${html}</body></html>`);
        w.document.close();
        w.focus();
        setTimeout(() => { w.print(); }, 350);
    }

    function generarComprobante({ cliente, ejemplar, tabla, grupo, cantidad, res }) {
        const simb = simboloMoneda(grupo.moneda);
        const fecha = new Date().toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' });
        const folio = `T-${tabla.hipodromo}-C${tabla.carrera}-N${ejemplar.numero || ejemplar.nombre}-${Date.now().toString().slice(-6)}`;
        const notas = [];
        const costoUSDComp = res.esVES ? res.costoTotal / (tasaCambioGlobal || 1) : res.costoTotal;
        const saldoPosterior = parseFloat(cliente.saldo_actual || 0) - costoUSDComp;
        if (saldoPosterior < 0) {
            notas.push(`Aviso: tras la venta, el cliente ${cliente.nombre} queda con saldo negativo de $${clubUI.formatoNumero(Math.abs(saldoPosterior), 2)} (aval activo).`);
        }
        const html = `
            <h1>Comprobante de Venta · Tabla Fija</h1>
            <div class="sub">Folio: ${folio} &nbsp;·&nbsp; ${fecha}</div>
            <table>
                <tr><th>Cliente</th><td class="b">${cliente.nombre}</td></tr>
                <tr><th>Grupo</th><td>${grupo.nombre}</td></tr>
                <tr><th>Carrera</th><td>${tabla.hipodromo} · C${tabla.carrera}</td></tr>
                <tr><th>Ejemplar</th><td>N° ${ejemplar.numero || '-'} — ${ejemplar.nombre}</td></tr>
                <tr><th>Cantidad de Tablas</th><td class="r b">${res.cantidad}</td></tr>
                <tr><th>Valor por Tabla</th><td class="r b">${simb}${clubUI.formatoNumero(res.pts, 2)}</td></tr>
                <tr><th>Premio por Tabla (tras retiros)</th><td class="r b">${simb}${clubUI.formatoNumero(res.premio, 2)}</td></tr>
                <tr><th>Total Pagado</th><td class="r b">${simb}${clubUI.formatoNumero(res.costoTotal, 2)}</td></tr>
                <tr><th>Premio a Cobrar (si gana)</th><td class="r b">${simb}${clubUI.formatoNumero(res.premioTotal, 2)}</td></tr>
                <tr><th>Ganancia (si gana)</th><td class="r b">${simb}${clubUI.formatoNumero(res.gananciaTotal, 2)}</td></tr>
                <tr class="gran"><th>Comisión del Grupo (${clubUI.formatoNumero(res.comisionPorc, 1)}% s/ganancia)</th><td class="r b">${simb}${clubUI.formatoNumero(res.comisionEstimada, 2)}</td></tr>
            </table>
            <div class="aviso">
                El premio indicado ya está ajustado por los retiros oficiales de la carrera.<br>
                La liquidación del premio se realiza al cierre de la carrera.
                ${notas.length ? '<br>' + notas.join('<br>') : ''}
            </div>
        `;
        imprimirHTML(`Comprobante — ${cliente.nombre}`, html);
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

        let permitirSobregiro = false;
        const modoJuega = cliente.modo_juego || (cliente.libre ? 'libre' : 'aval');
        if (modoJuega === 'pozo') {
            const disp = parseFloat(cliente.saldo_actual || 0);
            if (disp < costoUSD) {
                return clubUI.toast(`El cliente ${cliente.nombre} juega con Pozo y no tiene saldo disponible (tiene $${clubUI.formatoNumero(disp, 2)}). Debe abonar antes de comprar tablas.`);
            }
        } else if (!cliente.libre) {
            const limiteAval = parseFloat(cliente.aval || 0);
            if (parseFloat(cliente.saldo_actual) - costoUSD < -limiteAval) {
                return clubUI.toast(`El cliente ${cliente.nombre} supera su límite de AVAL ($${clubUI.formatoNumero(limiteAval, 2)}). Debe abonar antes de comprar tablas.`);
            }
        }
        if (!esVES && parseFloat(cliente.saldo_actual) < costoTotal) {
            if (!confirm(`El cliente ${cliente.nombre} tiene saldo insuficiente ($${cliente.saldo_actual}). ¿Desea proceder de todas formas?`)) return;
            permitirSobregiro = true;
        }

        btnProcesarVenta.disabled = true;
        btnProcesarVenta.textContent = "Procesando Venta...";

        const res = await procesarVenta({
            cliente, cantidad, ejemplar: ejemplarSeleccionado, tabla: tablaSeleccionada,
            tg: grupoTabla, grupo: groupSeleccionado, permitirSobregiro
        });

        if (!res.ok) {
            clubUI.toast(res.error, 'error');
            btnProcesarVenta.disabled = false;
            btnProcesarVenta.textContent = "Procesar Venta de Tablas";
            return;
        }

        clubUI.toast("¡Venta de tablas procesada con éxito! Inventario actualizado y saldo descontado.");
        if (window.clubDB?.logAccion) window.clubDB.logAccion('VENTA_TABLAS', `venta: ${cliente.nombre} ${cantidad} tablas ${groupSeleccionado.nombre} ($${clubUI.formatoNumero(res.costoTotal, 2)}) ${tablaSeleccionada.hipodromo} C${tablaSeleccionada.carrera}`);
        generarComprobante({
            cliente, ejemplar: ejemplarSeleccionado, tabla: tablaSeleccionada,
            grupo: groupSeleccionado, cantidad, res
        });
        window.location.reload();
    });

    // ==========================================
    // SOLICITUDES DEL PORTAL (VALIDACIÓN ADMIN)
    // ==========================================
    async function cargarSolicitudesAdmin() {
        const cuerpo = document.getElementById('cuerpoSolicitudesAdmin');
        const { data } = await window.supabase
            .from('solicitudes_tablas')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(50);

        if (!data || data.length === 0) {
            cuerpo.innerHTML = '<tr><td colspan="9" class="p-4 text-center text-slate-500">No hay solicitudes del portal.</td></tr>';
            return;
        }

        cuerpo.innerHTML = data.map(s => {
            const fecha = s.created_at ? new Date(s.created_at).toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' }) : '—';
            const simb = s.moneda === 'VES' ? 'Bs ' : '$';
            const badges = { Pendiente: 'bg-amber-100 text-amber-700', Aprobada: 'bg-emerald-100 text-emerald-700', Rechazada: 'bg-red-100 text-red-600' };
            const acciones = s.estado === 'Pendiente'
                ? `<div class="flex gap-1 justify-center">
                        <button class="btn-aprobar-sol bg-emerald-600 text-white px-2 py-1 rounded text-[10px] font-black hover:bg-emerald-700" data-id="${s.id}" title="Aprobar (emite ticket y recibo)"><i class="fas fa-check"></i> Aprobar</button>
                        <button class="btn-rechazar-sol bg-red-200 text-red-700 px-2 py-1 rounded text-[10px] font-black hover:bg-red-300" data-id="${s.id}" title="Rechazar"><i class="fas fa-times"></i></button>
                    </div>`
                : '<span class="text-slate-300">—</span>';
            return `
                <tr class="hover:bg-amber-50 ${s.estado === 'Pendiente' ? 'bg-amber-50/50' : 'opacity-70'}">
                    <td class="p-2.5 text-slate-500">${fecha}</td>
                    <td class="p-2.5 font-bold text-slate-800">${s.cliente_nombre}</td>
                    <td class="p-2.5">${s.grupo_nombre || '-'}</td>
                    <td class="p-2.5 font-bold">${s.hipodromo} C${s.carrera}</td>
                    <td class="p-2.5">${s.ejemplar_numero} - ${s.ejemplar_nombre}</td>
                    <td class="p-2.5 text-right font-black">${s.cantidad}</td>
                    <td class="p-2.5 text-right font-mono font-bold">${simb}${clubUI.formatoNumero(parseFloat(s.monto_total || 0), 2)}</td>
                    <td class="p-2.5 text-center"><span class="px-2 py-0.5 rounded text-[9px] font-black ${badges[s.estado]}">${s.estado}</span></td>
                    <td class="p-2.5 text-center">${acciones}</td>
                </tr>`;
        }).join('');

        document.querySelectorAll('.btn-aprobar-sol').forEach(b => b.addEventListener('click', () => aprobarSolicitud(b.dataset.id)));
        document.querySelectorAll('.btn-rechazar-sol').forEach(b => b.addEventListener('click', () => rechazarSolicitud(b.dataset.id)));
    }

    async function aprobarSolicitud(id) {
        const { data: sol } = await window.supabase.from('solicitudes_tablas').select('*').eq('id', id).single();
        if (!sol) return;
        if (sol.estado !== 'Pendiente') return clubUI.toast('Esa solicitud ya fue atendida.', 'warning');

        if (!confirm(`Aprobar compra de ${sol.cliente_nombre}: ${sol.cantidad} tabla(s) ${sol.hipodromo} C${sol.carrera} (${sol.ejemplar_numero} - ${sol.ejemplar_nombre}).\nSe descontará ${sol.moneda === 'VES' ? 'Bs ' : '$'}${clubUI.formatoNumero(parseFloat(sol.monto_total || 0), 2)} del saldo y se emitirá el recibo.`)) return;

        const [rTabla, rCliente, rGrupo] = await Promise.all([
            window.supabase.from('tablas_fijas').select('*, tabla_grupos(*)').eq('id', sol.tabla_id).single(),
            window.supabase.from('clientes').select('*').eq('id', sol.cliente_id).single(),
            sol.grupo_id ? window.supabase.from('grupos_venta').select('*').eq('id', sol.grupo_id).single() : null
        ]);
        if (rTabla.error || rCliente.error) return clubUI.toast("No se pudieron cargar los datos para aprobar.", 'error');

        const tabla = rTabla.data;
        const cliente = rCliente.data;
        const grupo = rGrupo && !rGrupo.error ? rGrupo.data : null;
        const tg = (tabla.tabla_grupos || []).find(x => x.grupo_id == sol.grupo_id);
        if (!tg) return clubUI.toast("El grupo ya no tiene inventario en esta tabla.", 'error');

        const ejemplar = { numero: sol.ejemplar_numero, nombre: sol.ejemplar_nombre, valor_ejemplar: parseFloat(sol.pts_ejemplar || 0) };

        const res = await procesarVenta({ cliente, cantidad: sol.cantidad, ejemplar, tabla, tg, grupo });
        if (!res.ok) return clubUI.toast(res.error, 'error');

        const sesionS = window.clubAuth ? window.clubAuth.getSesion() : null;
        const recibo = `T${tabla.hipodromo}-C${tabla.carrera}-${sol.ejemplar_numero}-${id.slice(0, 5).toUpperCase()}`;
        await window.supabase.from('solicitudes_tablas').update({
            estado: 'Aprobada', atendida_por: sesionS ? sesionS.nombre : 'Admin',
            atendida_at: new Date().toISOString(), recibo
        }).eq('id', id);

        clubUI.toast(`Solicitud aprobada. Recibo ${recibo} registrado para ${cliente.nombre}.`, 'success');
        if (window.clubDB?.logAccion) window.clubDB.logAccion('VENTA_TABLAS', `solicitud_aprobada: ${cliente.nombre} ${sol.cantidad} tablas ${sol.hipodromo} C${sol.carrera} recibo=${recibo}`);
        cargarSolicitudesAdmin();
        cargarReporteVentas();
    }

    async function rechazarSolicitud(id) {
        const { data: sol } = await window.supabase.from('solicitudes_tablas').select('*').eq('id', id).single();
        if (!sol || sol.estado !== 'Pendiente') return;
        if (!confirm(`Rechazar la solicitud de ${sol.cliente_nombre} (${sol.hipodromo} C${sol.carrera})?`)) return;
        const sesionS = window.clubAuth ? window.clubAuth.getSesion() : null;
        await window.supabase.from('solicitudes_tablas').update({
            estado: 'Rechazada', atendida_por: sesionS ? sesionS.nombre : 'Admin',
            atendida_at: new Date().toISOString()
        }).eq('id', id);
        clubUI.toast('Solicitud rechazada.', 'warning');
        if (window.clubDB?.logAccion) window.clubDB.logAccion('VENTA_TABLAS', `solicitud_rechazada: ${sol.cliente_nombre} (id=${id})`);
        cargarSolicitudesAdmin();
    }

    document.getElementById('btnActualizarReporte')?.addEventListener('click', cargarReporteVentas);
    document.getElementById('btnActualizarSolicitudes')?.addEventListener('click', cargarSolicitudesAdmin);

    inicializar();
    cargarSolicitudesAdmin();
    cargarReporteVentas();
});