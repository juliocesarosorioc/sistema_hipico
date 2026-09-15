// ============================================================
//  venta_tablas.js — Venta de Tablas Fijas (UI estilo Gaceta/
//  Ensamblaje). Render de tarjetas por carrera + modal de venta
//  con jugador, grupo que cobra y grupo que recibe comisión.
//  La transacción siempre delega en VentaTablasCore.venderTabla
//  (congela premio_por_tabla y pts_ejemplar en el ticket).
// ============================================================
document.addEventListener('DOMContentLoaded', () => {

    const filtroGrupo = document.getElementById('filtroGrupo');
    const filtroTabla = document.getElementById('filtroTabla');
    const filtroCliente = document.getElementById('filtroCliente');
    const btnActualizarVista = document.getElementById('btnActualizarVista');
    const msgSinCarreras = document.getElementById('msgSinCarreras');
    const carrerasVenta = document.getElementById('carrerasVenta');

    const btnToggleReportes = document.getElementById('btnToggleReportes');
    const cuerpoReportes = document.getElementById('cuerpoReportes');
    const resumenRiesgoGrupos = document.getElementById('resumenRiesgoGrupos');
    const cuerpoReporteConsolidado = document.getElementById('cuerpoReporteConsolidado');
    const cuerpoReporteVentas = document.getElementById('cuerpoReporteVentas');

    const modalVenta = document.getElementById('modalVenta');
    const mvCarrera = document.getElementById('mvCarrera');
    const mvEjemplar = document.getElementById('mvEjemplar');
    const mvValor = document.getElementById('mvValor');
    const mvPremio = document.getElementById('mvPremio');
    const mvCliente = document.getElementById('mvCliente');
    const mvGrupoCobro = document.getElementById('mvGrupoCobro');
    const mvGrupoComision = document.getElementById('mvGrupoComision');
    const mvCantidad = document.getElementById('mvCantidad');
    const mvCostoUnit = document.getElementById('mvCostoUnit');
    const mvCostoTotal = document.getElementById('mvCostoTotal');
    const mvPremioTotal = document.getElementById('mvPremioTotal');
    const mvComisionEst = document.getElementById('mvComisionEst');
    const mvGanancia = document.getElementById('mvGanancia');
    const mvDisponibles = document.getElementById('mvDisponibles');
    const mvConfirmar = document.getElementById('mvConfirmar');

    let gruposDB = [];
    let tablasDB = [];
    let clientesDB = [];
    let miembrosExtraPorGrupo = {}; // { grupo_id: [cliente_id,...] } pertenencias adicionales
    let grupoSeleccionado = null;
    let tasaCambioGlobal = 1.0;
    let aportadoPorCliente = false;
    let ventaCtx = null; // { tabla, ejemplar, tg }

    const simboloDe = (m) => m === 'VES' ? 'Bs ' : '$';
    const fmt = (v, d = 2) => window.clubUI?.formatoNumero ? window.clubUI.formatoNumero(Number(v) || 0, d) : (Number(v) || 0).toFixed(d);

    function colorNumero(n) {
        const pal = [
            ['#1d4ed8', '#fff'], ['#b91c1c', '#fff'], ['#047857', '#fff'], ['#a16207', '#fff'],
            ['#be123c', '#fff'], ['#7c3aed', '#fff'], ['#0e7490', '#fff'], ['#15803d', '#fff'],
            ['#b45309', '#fff'], ['#334155', '#fff']
        ];
        return pal[(parseInt(n, 10) || 1) % pal.length];
    }

    // ==========================================
    // CARGA INICIAL
    // ==========================================
    async function inicializar() {
        const logErr = (ctx, e) => console.error(`[venta_tablas] ${ctx}:`, e?.message || e || 'error desconocido');
        const safe = (p) => p.catch(e => { console.error('[venta_tablas] query failed:', e); return { data: null, error: e }; });

        const [rGrupos, rTablasRaw, rClientes, rMoneda, rMembresias] = await Promise.all([
            safe(window.supabase.from('grupos_venta').select('*').eq('activo', true).order('es_principal', { ascending: false })),
            safe(window.supabase.from('tablas_fijas').select('*, tabla_grupos(*)').eq('estado', 'Abierta')),
            safe(window.supabase.from('clientes').select('id, nombre, saldo_actual, aval, libre, modo_juego, grupo_id').order('nombre')),
            safe(window.supabase.from('monedas').select('tasa_cambio').limit(1).single()),
            safe(window.supabase.from('clientes_grupos').select('grupo_id, cliente_id'))
        ]);

        if (rGrupos.error) logErr('grupos_venta', rGrupos.error);
        if (rTablasRaw.error) logErr('tablas_fijas', rTablasRaw.error);
        if (rClientes.error) logErr('clientes', rClientes.error);
        if (rMoneda.data?.tasa_cambio) tasaCambioGlobal = parseFloat(rMoneda.data.tasa_cambio);

        if ((!rGrupos.data || rGrupos.data.length === 0)) {
            // Sin grupos activos: intenta asegurar el PRINCIPAL vía RPC segura
            // (no depende del RLS) antes de dar por vacío el listado.
            await window.supabase.rpc('club_garantizar_grupo_principal').catch(() => {});
            const reG = await safe(window.supabase.from('grupos_venta').select('*').eq('activo', true).order('es_principal', { ascending: false }));
            if (reG.data) rGrupos = reG;
        }

        if (rGrupos.data) {
            gruposDB = rGrupos.data;
            filtroGrupo.innerHTML = '<option value="">Grupo de Venta...</option>';
            gruposDB.forEach(g => filtroGrupo.innerHTML += `<option value="${g.id}">${g.nombre} (${g.moneda})</option>`);
        } else if (rGrupos.error) {
            filtroGrupo.innerHTML = '<option value="" disabled>Error cargando grupos: ' + (rGrupos.error.message || rGrupos.error) + '</option>';
        }

        tablasDB = rTablasRaw.data || [];
        if (rClientes.data) clientesDB = rClientes.data;

        // Fallback: si el join tabla_grupos(*) vino vacío, cargarlo por separado
        const joinFallo = tablasDB.some(t => !t.tabla_grupos || t.tabla_grupos.length === 0);
        if (tablasDB.length > 0 && joinFallo) {
            const { data: tgRows, error: tgErr } = await safe(window.supabase.from('tabla_grupos').select('*'));
            if (tgErr) logErr('tabla_grupos (fallback)', tgErr);
            if (tgRows?.length) {
                const tgMap = {};
                tgRows.forEach(r => (tgMap[r.tabla_id] = tgMap[r.tabla_id] || []).push(r));
                tablasDB.forEach(t => { t.tabla_grupos = tgMap[t.id] || []; });
            }
        }

        if (rTablasRaw.error) {
            clubUI.aviso('Error cargando tablas publicadas',
                `No se pudieron obtener las tablas fijas: ${rTablasRaw.error.message || rTablasRaw.error}\n\nVerifique que ejecutó el SQL completo (paquete_pendientes.sql) y que las carreras estén publicadas desde el Ensamblaje.`, 'error');
        } else if (tablasDB.length === 0 && !sessionStorage.getItem('venta_tablas_vacio_aviso')) {
            sessionStorage.setItem('venta_tablas_vacio_aviso', '1');
            clubUI.aviso('Sin tablas disponibles para vender',
                'No hay tablas fijas publicadas (estado "Abierta").\n\nVaya a Ensamblaje de Tablas Fijas → publique las carreras del día y luego regrese aquí para vender.', 'warning');
        }

        if (rMembresias.data?.length) {
            rMembresias.data.forEach(m => (miembrosExtraPorGrupo[m.grupo_id] = miembrosExtraPorGrupo[m.grupo_id] || []).push(m.cliente_id));
        }

        poblarFiltroClientes();
    }

    function poblarFiltroClientes() {
        filtroCliente.innerHTML = '<option value="">Todos...</option>';
        clientesDB.forEach(c => filtroCliente.innerHTML += `<option value="${c.id}">${c.nombre}</option>`);
    }

    // ==========================================
    // RENDER DE TARJETAS (mismo estilo gaceta/ensamblaje)
    // ==========================================
    function render() {
        if (!grupoSeleccionado) {
            carrerasVenta.innerHTML = '';
            msgSinCarreras.classList.remove('hidden');
            return;
        }

        const filtroTablaId = filtroTabla.value;
        const filtroClienteId = filtroCliente.value;
        const g = grupoSeleccionado;

        let tablas = tablasDB.filter(t => {
            const tg = (t.tabla_grupos || []).find(x => x.grupo_id == g.id);
            if (!tg) return false;
            if (filtroTablaId && t.id != filtroTablaId) return false;
            return (tg.cupos || 0) - (tg.cantidad_vendida || 0) > 0;
        });

        const clienteFiltro = filtroClienteId ? clientesDB.find(c => c.id == filtroClienteId) : null;
        if (clienteFiltro) {
            const clienteGrupos = new Set([clienteFiltro.grupo_id, ...(miembrosExtraPorGrupo[clienteFiltro.grupo_id]?.includes(clienteFiltro.id) ? [g.id] : [])].filter(Boolean));
            tablas = tablas.filter(t => (t.tabla_grupos || []).some(tg => clienteGrupos.has(tg.grupo_id)));
            if (!tablas.length && clienteFiltro.grupo_id == g.id) {
                tablas = tablasDB.filter(t => {
                    const tg = (t.tabla_grupos || []).find(x => x.grupo_id == g.id);
                    return tg && (tg.cupos || 0) - (tg.cantidad_vendida || 0) > 0;
                });
            }
        }

        if (tablas.length === 0) {
            carrerasVenta.innerHTML = '';
            msgSinCarreras.classList.remove('hidden');
            msgSinCarreras.querySelector('p').textContent = filtroTablaId || clienteFiltro
                ? 'Ninguna carrera coincide con los filtros. Ajuste los filtros o pulse "Actualizar".'
                : `El grupo ${g.nombre} no tiene tablas publicadas con inventario disponible. Publique cupos desde el Ensamblaje.`;
            return;
        }

        msgSinCarreras.classList.add('hidden');
        carrerasVenta.innerHTML = tablas.map(t => {
            const tg = (t.tabla_grupos || []).find(x => x.grupo_id == g.id);
            const cupos = tg.cupos || 0;
            const vendidas = tg.cantidad_vendida || 0;
            const disponibles = Math.max(0, cupos - vendidas);
            const premio = parseFloat(t.premio_recalculado) || 0;
            const ejemplares = Array.isArray(t.caballos) ? t.caballos : [];
            const suma = ejemplares.reduce((a, c) => a + (parseFloat(c.valor_ejemplar ?? c.valor ?? c.pts) || 0), 0);

            return `
            <div class="card-venta bg-white rounded-xl shadow-sm border border-emerald-200 overflow-hidden flex flex-col" data-tabla="${t.id}">
                <div class="bg-emerald-600 px-2 py-1 text-white">
                    <div class="flex items-center justify-between gap-1">
                        <span class="text-[9px] font-bold uppercase tracking-wider flex-1 min-w-0 truncate">${t.hipodromo || 'Hipódromo'}</span>
                        <span class="font-black text-[10px] whitespace-nowrap"><i class="fas fa-flag-checkered mr-0.5"></i>C${t.carrera ?? ''}</span>
                    </div>
                    <div class="flex flex-wrap gap-1 mt-0.5 text-[8px] font-bold items-center">
                        <span class="rounded px-1 py-px" style="background:rgba(255,255,255,.18)">Dist: ${t.distancia_carrera ?? ''} m</span>
                        <span class="rounded px-1 py-px uppercase" style="background:rgba(255,255,255,.18)">${t.superficie || 'ARENA'}</span>
                        <span class="rounded px-1 py-px" style="background:rgba(255,255,255,.18)">${t.fecha || ''}</span>
                    </div>
                    <div class="mt-1 flex items-center justify-between rounded px-2 py-1" style="background:rgba(255,255,255,.20)">
                        <span class="text-[9px] font-black uppercase tracking-wider opacity-90"><i class="fas fa-dollar-sign mr-0.5"></i> Premio / Tabla</span>
                        <span class="font-black text-sm">${simboloDe(g.moneda)}${fmt(premio)}</span>
                    </div>
                </div>

                <div class="px-2 pt-1 pb-0.5 text-[8px] font-black uppercase tracking-wider text-slate-400 flex items-center justify-between">
                    <span><i class="fas fa-horse-head text-amber-500 mr-0.5"></i> Ejemplares · toca para vender</span>
                    <span class="bg-slate-100 text-slate-600 px-1.5 rounded-full font-black">${ejemplares.length}</span>
                </div>

                <div class="px-1.5 py-0.5 space-y-0.5 flex-1">
                    ${ejemplares.map(c => {
                        const [bg, fg] = colorNumero(c.numero);
                        const retirado = !!c.retirado;
                        const valor = parseFloat(c.valor_ejemplar ?? c.valor ?? c.pts) || 0;
                        return `
                        <button type="button" class="ej-btn w-full flex gap-1 items-center bg-slate-50 border border-slate-200 rounded px-1 py-0.5 text-left transition-colors ${retirado ? 'opacity-40 pointer-events-none' : 'hover:border-emerald-400 hover:bg-emerald-50 cursor-pointer'}"
                            data-tabla="${t.id}" data-numero="${c.numero}" ${retirado ? 'disabled' : ''} title="${retirado ? 'Retirado de la carrera' : 'Vender tablas de ' + (c.nombre || '')}">
                            <span class="w-4 h-5 shrink-0 rounded px-0 text-center text-[8px] font-black border" style="background-color:${bg};color:${fg};border-color:${bg}">${c.numero ?? ''}</span>
                            <span class="flex-1 min-w-0 truncate text-[10px] font-bold uppercase text-slate-800">${c.nombre || 'Sin nombre'}</span>
                            <span class="shrink-0 text-[9px] font-black ${retirado ? 'text-red-500' : 'text-amber-600'}">${retirado ? 'RETIRADO' : 'Valor: ' + fmt(valor, 1)}</span>
                            <span class="shrink-0 w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 text-[9px] flex items-center justify-center"><i class="fas fa-cart-plus"></i></span>
                        </button>`;
                    }).join('') || '<p class="text-[10px] text-slate-400 italic px-1 py-1">Sin ejemplares registrados.</p>'}
                </div>

                <div class="px-2 py-1 border-t border-slate-200 bg-white flex items-center justify-between">
                    <span class="inline-flex items-center gap-1 text-[8px] font-black uppercase tracking-wider text-slate-400">
                        <i class="fas fa-boxes text-emerald-500"></i> Disponibles grupo
                    </span>
                    <span class="font-black text-[11px] text-emerald-700">${disponibles} / ${cupos}</span>
                </div>
                <div class="px-2 py-1 border-t border-slate-100 bg-emerald-50 flex items-center justify-between">
                    <span class="text-[8px] font-black uppercase tracking-wider text-slate-400"><i class="fas fa-calculator text-indigo-400 mr-1"></i> Suma de la Tabla</span>
                    <span class="font-black text-[11px] text-indigo-700">${simboloDe(g.moneda)}${fmt(suma)}</span>
                </div>
            </div>`;
        }).join('');

        carrerasVenta.querySelectorAll('.ej-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tabla = tablasDB.find(t => t.id == btn.dataset.tabla);
                const ejemplar = (tabla?.caballos || []).find(c => c.numero == btn.dataset.numero);
                const tg = (tabla?.tabla_grupos || []).find(x => x.grupo_id == g.id);
                if (!tabla || !ejemplar || !tg) return clubUI.toast('No se pudo preparar la venta (falta inventario del grupo).', 'error');
                abrirModalVenta({ tabla, ejemplar, tg });
            });
        });
    }

    // ==========================================
    // MODAL DE VENTA
    // ==========================================
    function abrirModalVenta(ctx) {
        ventaCtx = ctx;
        const { tabla, ejemplar, tg } = ctx;
        const g = grupoSeleccionado;
        const premio = parseFloat(tabla.premio_recalculado) || 0;
        const pts = parseFloat(ejemplar.valor_ejemplar ?? ejemplar.valor ?? ejemplar.pts) || 0;

        mvCarrera.textContent = `${tabla.hipodromo} · C${tabla.carrera}`;
        mvEjemplar.textContent = `N° ${ejemplar.numero ?? ''} — ${ejemplar.nombre}`;
        mvValor.textContent = `${simboloDe(g.moneda)}${fmt(pts)}`;
        mvPremio.textContent = `${simboloDe(g.moneda)}${fmt(premio)}`;

        // Grupo que COBRA = el grupo de venta seleccionado (donde juega el cliente)
        mvGrupoCobro.innerHTML = `<option value="${g.id}">${g.nombre} (${g.moneda})</option>`;

        // Clientes del grupo (principales + pertenencia adicional + sin grupo asignado)
        const extraIds = (miembrosExtraPorGrupo[g.id] || []).filter(id => !clientesDB.find(c => c.id == id && c.grupo_id == g.id));
        const delGrupo = clientesDB
            .filter(c => c.grupo_id == g.id || !c.grupo_id || extraIds.includes(c.id))
            .sort((a, b) => a.nombre.localeCompare(b.nombre));
        mvCliente.innerHTML = '<option value="">Seleccione apostador...</option>';
        delGrupo.forEach(c => mvCliente.innerHTML += `<option value="${c.id}">${c.nombre} (Saldo: $${fmt(parseFloat(c.saldo_actual) || 0)})</option>`);
        mvCliente.disabled = delGrupo.length === 0;
        if (delGrupo.length === 0) mvCliente.innerHTML += '<option value="" disabled>No hay clientes en este grupo</option>';

        // Grupo que recibe la COMISIÓN (default: mismo que cobra)
        mvGrupoComision.innerHTML = '';
        gruposDB.filter(x => x.activo).forEach(x => mvGrupoComision.innerHTML += `<option value="${x.id}">${x.nombre} (comisión ${fmt(parseFloat(x.comision_default ?? 2.5), 1)}%)</option>`);
        mvGrupoComision.value = g.id.toString();

        mvCantidad.value = 1;
        const clientePreseleccionado = document.getElementById('filtroCliente').value;
        if (clientePreseleccionado) {
            mvCliente.value = clientePreseleccionado;
            aportadoPorCliente = true;
        }
        actualizarTotalesModal();
        modalVenta.classList.remove('hidden');
        modalVenta.classList.add('flex');
        document.body.style.overflow = 'hidden';
        requestAnimationFrame(() => mvCantidad.focus());
    }

    function cerrarModalVenta() {
        modalVenta.classList.add('hidden');
        modalVenta.classList.remove('flex');
        document.body.style.overflow = '';
        ventaCtx = null;
        aportadoPorCliente = false;
    }

    // El grupo que COBRA es siempre el grupo que vende (donde juega el cliente
    // en esta operación), así el inventario (tg), la moneda y el descuento
    // quedan consistentes aunque el cliente tenga pertenencia multi-grupo.
    mvCliente.addEventListener('change', () => {
        if (ventaCtx) document.getElementById('mvGrupoCobro').disabled = true;
        actualizarTotalesModal();
    });

    mvGrupoComision.addEventListener('change', actualizarTotalesModal);
    mvCantidad.addEventListener('input', actualizarTotalesModal);
    document.getElementById('cerrarModalVenta').addEventListener('click', cerrarModalVenta);
    document.getElementById('mvCancelar').addEventListener('click', cerrarModalVenta);
    modalVenta.addEventListener('click', (e) => { if (e.target === modalVenta) cerrarModalVenta(); });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modalVenta.classList.contains('hidden')) cerrarModalVenta();
    });

    function comisionPorcActual() {
        const gCom = gruposDB.find(x => x.id == mvGrupoComision.value);
        const deTabla = parseFloat(ventaCtx?.tabla?.comision_grupo);
        if (!isNaN(deTabla)) return deTabla;
        return parseFloat(gCom?.comision_default ?? 2.5);
    }

    function actualizarTotalesModal() {
        if (!ventaCtx) return;
        const { tg } = ventaCtx;
        const pts = parseFloat(ventaCtx.ejemplar.valor_ejemplar ?? ventaCtx.ejemplar.valor ?? ventaCtx.ejemplar.pts) || 0;
        const premio = parseFloat(ventaCtx.tabla.premio_recalculado) || 0;
        const cant = Math.max(1, parseInt(mvCantidad.value) || 1);
        const g = grupoSeleccionado;
        const simb = simboloDe(g.moneda);

        const costoTotal = pts * cant;
        const premioTotal = premio * cant;
        const ganancia = Math.max(0, premioTotal - costoTotal);
        const comisionPorc = comisionPorcActual();
        const comision = ganancia * (comisionPorc / 100);

        mvCostoUnit.textContent = `${simb}${fmt(pts)}`;
        mvCostoTotal.textContent = `${simb}${fmt(costoTotal)}`;
        mvPremioTotal.textContent = `${simb}${fmt(premioTotal)}`;
        mvComisionEst.textContent = `${simb}${fmt(comision)} (${fmt(comisionPorc, 1)}%)`;
        mvGanancia.textContent = `${simb}${fmt(ganancia)}`;
        const dispon = (tg.cupos || 0) - (tg.cantidad_vendida || 0);
        mvDisponibles.textContent = `Disponibles en ${grupoSeleccionado.nombre}: ${dispon} tabla(s)`;
    }

    mvConfirmar.addEventListener('click', async () => {
        if (!ventaCtx || !grupoSeleccionado) return;
        const { tabla, ejemplar, tg } = ventaCtx;
        const clienteId = mvCliente.value;
        const cantidad = parseInt(mvCantidad.value);
        const g = grupoSeleccionado;

        if (!clienteId) return clubUI.toast('Seleccione el jugador que compra.', 'warning');
        if (isNaN(cantidad) || cantidad <= 0) return clubUI.toast('Cantidad inválida.', 'warning');

        const dispon = (tg.cupos || 0) - (tg.cantidad_vendida || 0);
        if (cantidad > dispon) return clubUI.toast(`No hay suficientes tablas en el grupo. Solo quedan ${dispon}.`, 'warning');

        const cliente = clientesDB.find(c => c.id == clienteId);
        if (!cliente) return clubUI.toast('Cliente no encontrado.', 'error');

        const esMiembro = cliente.grupo_id == g.id || !cliente.grupo_id || (miembrosExtraPorGrupo[g.id]?.includes(cliente.id));
        if (!esMiembro) return clubUI.toast('El jugador no pertenece al grupo de venta seleccionado.', 'warning');

        const grupoComision = gruposDB.find(x => x.id == mvGrupoComision.value) || g;
        const cobroGrupo = gruposDB.find(x => x.id == mvGrupoCobro.value) || g;

        const pts = parseFloat(ejemplar.valor_ejemplar ?? ejemplar.valor ?? ejemplar.pts) || 0;
        const costoTotal = pts * cantidad;
        const esVES = g.moneda === 'VES';
        const costoUSD = esVES ? costoTotal / (tasaCambioGlobal || 1) : costoTotal;

        // Validaciones de saldo (mismas reglas que el core)
        const modoJuega = cliente.modo_juego || (cliente.libre ? 'libre' : 'aval');
        let permitirSobregiro = false;
        if (modoJuega === 'pozo') {
            const disp = parseFloat(cliente.saldo_actual || 0);
            if (disp < costoUSD) return clubUI.toast(`El jugador ${cliente.nombre} juega con Pozo y no tiene saldo disponible (tiene $${fmt(disp)}). Debe abonar antes de comprar.`, 'warning');
        } else if (!cliente.libre) {
            const limiteAval = parseFloat(cliente.aval || 0);
            if ((parseFloat(cliente.saldo_actual) || 0) - costoUSD < -limiteAval) {
                return clubUI.toast(`El jugador ${cliente.nombre} supera su límite de AVAL ($${fmt(limiteAval)}). Debe abonar antes de comprar.`, 'warning');
            }
        }
        if (!esVES && parseFloat(cliente.saldo_actual) < costoTotal) {
            if (!confirm(`El jugador ${cliente.nombre} tiene saldo insuficiente ($${fmt(cliente.saldo_actual)}). ¿Desea proceder de todas formas?`)) return;
            permitirSobregiro = true;
        }

        mvConfirmar.disabled = true;
        const orig = mvConfirmar.innerHTML;
        mvConfirmar.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Procesando...';

        const res = await window.VentaTablasCore.venderTabla({
            cliente, cantidad, ejemplar, tabla, tg,
            grupo: cobroGrupo, grupoComision,
            tasaCambio: tasaCambioGlobal, permitirSobregiro
        });

        if (!res.ok) {
            clubUI.toast(res.error, 'error');
            mvConfirmar.disabled = false;
            mvConfirmar.innerHTML = orig;
            return;
        }

        clubUI.toast(`¡Venta procesada! ${cobroGrupo.nombre} cobra, ${grupoComision.nombre} recibe comisión.`, 'success');
        if (window.clubDB?.logAccion) window.clubDB.logAccion('VENTA_TABLAS', `venta: ${cliente.nombre} ${cantidad} tablas ${cobroGrupo.nombre} ($${fmt(res.costoTotal)}) ${tabla.hipodromo} C${tabla.carrera} comision=${grupoComision.nombre}`);

        const saldoPosterior = (parseFloat(cliente.saldo_actual || 0)) - (esVES ? res.costoTotal / (tasaCambioGlobal || 1) : res.costoTotal);
        const htmlComp = window.VentaTablasCore.comprobanteHTML({
            cliente, ejemplar, tabla, grupo: cobroGrupo, cantidad, res,
            tasaCambio: tasaCambioGlobal, saldoPosterior
        });
        window.VentaTablasCore.printHTML(`Comprobante — ${cliente.nombre}`, htmlComp);

        cerrarModalVenta();
        await cargarReporteVentas();
        await cargarSolicitudesAdmin();
        await inicializarDatosUtiles();
        render();
    });

    // Recarga liviana de datos (sin reiniciar la página)
    let recargando = false;
    async function inicializarDatosUtiles() {
        const safe = (p) => p.catch(e => ({ data: null, error: e }));
        const [rTablas, rClientes] = await Promise.all([
            safe(window.supabase.from('tablas_fijas').select('*, tabla_grupos(*)').eq('estado', 'Abierta')),
            safe(window.supabase.from('clientes').select('id, nombre, saldo_actual, aval, libre, modo_juego, grupo_id').order('nombre'))
        ]);
        if (rTablas.data) tablasDB = rTablas.data;
        if (rClientes.data) clientesDB = rClientes.data;
    }

    // ==========================================
    // FILTROS
    // ==========================================
    function poblarFiltroTablas() {
        filtroTabla.innerHTML = '<option value="">Todas las carreras de este grupo...</option>';
        filtroTabla.disabled = !grupoSeleccionado;
        if (!grupoSeleccionado) return;
        const g = grupoSeleccionado;
        tablasDB.filter(t => (t.tabla_grupos || []).some(x => x.grupo_id == g.id)).forEach(t => {
            filtroTabla.innerHTML += `<option value="${t.id}">${t.hipodromo} - C${t.carrera} (${g.moneda})</option>`;
        });
    }

    filtroGrupo.addEventListener('change', () => {
        grupoSeleccionado = gruposDB.find(g => g.id == filtroGrupo.value) || null;
        filtroCliente.disabled = !grupoSeleccionado;
        filtroCliente.value = '';
        aportadoPorCliente = false;
        poblarFiltroTablas();
        render();
    });
    filtroTabla.addEventListener('change', render);
    filtroCliente.addEventListener('change', render);
    btnActualizarVista.addEventListener('click', async () => {
        btnActualizarVista.disabled = true;
        await inicializar();
        if (grupoSeleccionado) {
            filtroGrupo.value = grupoSeleccionado.id;
            poblarFiltroTablas();
        }
        render();
        btnActualizarVista.disabled = false;
        clubUI.toast('Datos actualizados.', 'success');
    });

    // ==========================================
    // REPORTES
    // ==========================================
    btnToggleReportes.addEventListener('click', () => {
        const abierto = cuerpoReportes.classList.contains('hidden');
        cuerpoReportes.classList.toggle('hidden');
        btnToggleReportes.querySelector('i').className = 'fas fa-chevron-' + (abierto ? 'up' : 'down');
    });

    const premioUnidad = (tk) => (tk.premio_por_tabla != null && !isNaN(parseFloat(tk.premio_por_tabla)))
        ? parseFloat(tk.premio_por_tabla)
        : (parseFloat(tk.premio_recalculado) || 0);

    async function cargarReporteVentas() {
        const { data } = await window.supabase
            .from('tickets_apuestas')
            .select('id, created_at, cliente_juega_nombre, grupo, grupo_comision_nombre, grupo_cobro_nombre, hipodromo, carrera, caballo, cantidad_tablas, monto_jugado, premio_por_tabla, pts_ejemplar, premio_recalculado, comision_porcentaje, moneda')
            .order('created_at', { ascending: false })
            .limit(100);

        const tickets = data || [];

        if (tickets.length === 0) {
            cuerpoReporteVentas.innerHTML = '<tr><td colspan="13" class="p-4 text-center text-slate-500">Aún no hay ventas de tablas fijas.</td></tr>';
            cuerpoReporteConsolidado.innerHTML = '<tr><td colspan="6" class="p-4 text-center text-slate-500">Sin ventas.</td></tr>';
            resumenRiesgoGrupos.innerHTML = '<div class="text-slate-400 italic text-xs">Sin ventas.</div>';
            return;
        }

        // Riesgo por grupo (quien cobra)
        const porGrupo = {};
        tickets.forEach(tk => {
            const n = parseInt(tk.cantidad_tablas) || 0;
            const premio = premioUnidad(tk);
            const riesgo = n * premio;
            const montoA = n * (parseFloat(tk.pts_ejemplar || 0) || 0);
            const ganancia = Math.max(0, riesgo - montoA);
            const comision = ganancia * (parseFloat(tk.comision_porcentaje || 0) / 100);
            const clave = tk.grupo_cobro_nombre || tk.grupo;
            if (!porGrupo[clave]) porGrupo[clave] = { riesgoLocal: 0, gananciaLocal: 0, comisionLocal: 0, ventas: 0, tablas: 0, moneda: tk.moneda };
            porGrupo[clave].riesgoLocal += riesgo;
            porGrupo[clave].gananciaLocal += ganancia;
            porGrupo[clave].comisionLocal += comision;
            porGrupo[clave].ventas += 1;
            porGrupo[clave].tablas += n;
        });

        resumenRiesgoGrupos.innerHTML = Object.entries(porGrupo).map(([nombre, g]) => {
            const simb = g.moneda === 'VES' ? 'Bs ' : '$';
            const equivalenteUSD = g.moneda === 'VES' ? (g.riesgoLocal / (tasaCambioGlobal || 1)) : g.riesgoLocal;
            return `
                <div class="bg-slate-50 border border-slate-200 rounded-lg p-3">
                    <div class="flex items-center justify-between">
                        <span class="font-bold text-slate-800 text-sm">${nombre}</span>
                        <span class="px-1.5 py-0.5 rounded text-[9px] font-black ${g.moneda === 'VES' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}">${g.moneda}</span>
                    </div>
                    <p class="text-lg font-black ${g.moneda === 'VES' ? 'text-amber-600' : 'text-emerald-600'} mt-1 font-mono">${simb}${fmt(g.riesgoLocal)}</p>
                    <p class="text-[10px] text-slate-500 mt-1">${g.ventas} venta(s) · ${g.tablas} tabla(s) · equiv. $ ${fmt(equivalenteUSD)}</p>
                    <p class="text-[11px] font-bold mt-1 text-emerald-700">Ganancia: ${simb}${fmt(g.gananciaLocal)}</p>
                    <p class="text-[11px] font-bold text-purple-700">Comisión Grupo: ${simb}${fmt(g.comisionLocal)}</p>
                    <button class="btn-reporte-grupo mt-2 w-full px-2 py-1 rounded text-[10px] font-bold bg-slate-800 text-white hover:bg-slate-700" data-grupo="${nombre}">
                        <i class="fas fa-print"></i> Imprimir reporte del grupo
                    </button>
                </div>`;
        }).join('');

        document.querySelectorAll('.btn-reporte-grupo').forEach(b => b.addEventListener('click', () => imprimirReporteGrupo(b.dataset.grupo, tickets)));

        // Consolidado: quién cobra / carrera / ejemplar
        const porGCE = {};
        tickets.forEach(tk => {
            const clave = `${tk.grupo_cobro_nombre || tk.grupo}|${tk.hipodromo}|C${tk.carrera}|${tk.caballo}`;
            if (!porGCE[clave]) porGCE[clave] = {
                grupo: tk.grupo_cobro_nombre || tk.grupo, hipodromo: tk.hipodromo, carrera: tk.carrera, ejemplar: tk.caballo,
                tablas: 0, arriesgado: 0, premioPotencial: 0, simb: tk.moneda === 'VES' ? 'Bs ' : '$'
            };
            const n = parseInt(tk.cantidad_tablas) || 0;
            porGCE[clave].tablas += n;
            porGCE[clave].arriesgado += n * (parseFloat(tk.pts_ejemplar || 0) || 0);
            porGCE[clave].premioPotencial += n * premioUnidad(tk);
        });

        cuerpoReporteConsolidado.innerHTML = Object.values(porGCE).map(g => `
            <tr class="hover:bg-emerald-50">
                <td class="p-3"><span class="px-1.5 py-0.5 rounded text-[9px] font-black bg-slate-200 text-slate-700">${g.grupo}</span></td>
                <td class="p-3 font-bold text-slate-800">${g.hipodromo} C${g.carrera}</td>
                <td class="p-3 font-bold text-slate-700">${g.ejemplar}</td>
                <td class="p-3 text-right font-black">${g.tablas}</td>
                <td class="p-3 text-right font-mono font-bold text-red-600">${g.simb}${fmt(g.arriesgado)}</td>
                <td class="p-3 text-right font-mono font-bold text-emerald-600">${g.simb}${fmt(g.premioPotencial)}</td>
            </tr>`).join('');

        // Detalle completo de ventas (Grupo Cobro / Grupo Comisión)
        cuerpoReporteVentas.innerHTML = tickets.map(tk => {
            const premio = premioUnidad(tk);
            const n = parseInt(tk.cantidad_tablas) || 0;
            const riesgo = n * premio;
            const montoArriesgado = n * (parseFloat(tk.pts_ejemplar || 0) || 0);
            const ganancia = Math.max(0, riesgo - montoArriesgado);
            const comision = ganancia * (parseFloat(tk.comision_porcentaje || 0) / 100);
            const fecha = tk.created_at ? new Date(tk.created_at).toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' }) : '—';
            const simb = tk.moneda === 'VES' ? 'Bs ' : '$';
            return `
                <tr class="hover:bg-slate-50">
                    <td class="p-2 text-slate-500">${fecha}</td>
                    <td class="p-2 font-bold text-slate-800">${tk.cliente_juega_nombre}</td>
                    <td class="p-2"><span class="px-1.5 py-0.5 rounded text-[9px] font-black bg-slate-200 text-slate-700">${tk.grupo_cobro_nombre || tk.grupo}</span></td>
                    <td class="p-2"><span class="px-1.5 py-0.5 rounded text-[9px] font-black bg-purple-100 text-purple-700">${tk.grupo_comision_nombre || tk.grupo}</span></td>
                    <td class="p-2">${tk.hipodromo} C${tk.carrera}</td>
                    <td class="p-2">${tk.caballo}</td>
                    <td class="p-2 text-right font-bold">${n}</td>
                    <td class="p-2 text-right text-blue-600 font-bold">${fmt(parseFloat(tk.pts_ejemplar || 0), 1)}</td>
                    <td class="p-2 text-right text-emerald-600 font-bold">${simb}${fmt(premio)}</td>
                    <td class="p-2 text-right text-red-600 font-bold">${simb}${fmt(montoArriesgado)}</td>
                    <td class="p-2 text-right text-orange-600 font-black">${simb}${fmt(riesgo)}</td>
                    <td class="p-2 text-right text-emerald-700 font-bold">${simb}${fmt(ganancia)}</td>
                    <td class="p-2 text-right text-purple-700 font-bold">${simb}${fmt(comision)}</td>
                </tr>`;
        }).join('');
    }

    function imprimirReporteGrupo(nombreGrupo, tickets) {
        const delGrupo = tickets.filter(tk => (tk.grupo_cobro_nombre || tk.grupo) === nombreGrupo);
        if (!delGrupo.length) return clubUI.toast('Sin ventas para este grupo.');
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
                <td class="r">${simb}${fmt(montoA)}</td>
                <td class="r">${simb}${fmt(riesgo)}</td>
                <td class="r b">${simb}${fmt(ganancia)}</td>
                <td class="r b">${simb}${fmt(comision)}</td>
                <td class="r">${tk.grupo_comision_nombre || tk.grupo}</td>
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
            <div class="sub">Grupo que cobra: <b>${nombreGrupo}</b> · Generado: ${fechaGen}</div>
            <table>
                <tr><th>#</th><th>Fecha</th><th>Cliente</th><th>Carrera</th><th>Ejemplar</th><th>Tablas</th><th>Monto</th><th>Premio</th><th>Ganancia</th><th>Comisión</th><th>Grupo Comisión</th></tr>
                ${filas}
                <tr class="gran">
                    <td colspan="5">TOTALES (${delGrupo.length} ventas · ${tot.tablas} tablas)</td>
                    <td class="r b">${tot.tablas}</td>
                    <td class="r b">${simb}${fmt(tot.monto)}</td>
                    <td class="r b">${simb}${fmt(tot.riesgo)}</td>
                    <td class="r b">${simb}${fmt(tot.ganancia)}</td>
                    <td class="r b">${simb}${fmt(tot.comision)}</td>
                    <td></td>
                </tr>
            </table>
            <div class="aviso">La comisión se calcula sobre la ganancia (premio − monto jugado) si el ejemplar gana.</div>`;
        window.VentaTablasCore.printHTML(`Reporte — ${nombreGrupo}`, html);
    }

    // ==========================================
    // SOLICITUDES DEL PORTAL
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
                    <td class="p-2.5 text-right font-mono font-bold">${simb}${fmt(parseFloat(s.monto_total || 0))}</td>
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

        if (!confirm(`Aprobar compra de ${sol.cliente_nombre}: ${sol.cantidad} tabla(s) ${sol.hipodromo} C${sol.carrera} (${sol.ejemplar_numero} - ${sol.ejemplar_nombre}).\nSe descontará ${sol.moneda === 'VES' ? 'Bs ' : '$'}${fmt(parseFloat(sol.monto_total || 0))} del saldo y se emitirá el recibo.`)) return;

        const [rTabla, rCliente, rGrupo] = await Promise.all([
            window.supabase.from('tablas_fijas').select('*, tabla_grupos(*)').eq('id', sol.tabla_id).single(),
            window.supabase.from('clientes').select('*').eq('id', sol.cliente_id).single(),
            sol.grupo_id ? window.supabase.from('grupos_venta').select('*').eq('id', sol.grupo_id).single() : null
        ]);
        if (rTabla.error || rCliente.error) return clubUI.toast('No se pudieron cargar los datos para aprobar.', 'error');

        const tabla = rTabla.data;
        const cliente = rCliente.data;
        const grupo = rGrupo?.data || gruposDB.find(x => x.id == sol.grupo_id) || grupoSeleccionado;
        const tg = (tabla.tabla_grupos || []).find(x => x.grupo_id == grupo?.id);
        if (!tg) return clubUI.toast('El grupo ya no tiene inventario en esta tabla.', 'error');

        const ejemplar = { numero: sol.ejemplar_numero, nombre: sol.ejemplar_nombre, valor_ejemplar: parseFloat(sol.pts_ejemplar || 0) };

        const res = await window.VentaTablasCore.venderTabla({
            cliente, cantidad: sol.cantidad, ejemplar, tabla, tg,
            grupo, grupoComision: grupo,
            tasaCambio: tasaCambioGlobal, permitirSobregiro: true
        });
        if (!res.ok) return clubUI.toast(res.error, 'error');

        const sesionS = window.clubAuth ? window.clubAuth.getSesion() : null;
        const recibo = `T${tabla.hipodromo}-C${tabla.carrera}-${sol.ejemplar_numero}-${id.slice(0, 5).toUpperCase()}`;
        await window.supabase.from('solicitudes_tablas').update({
            estado: 'Aprobada', atendida_por: sesionS ? sesionS.nombre : 'Admin',
            atendida_at: new Date().toISOString(), recibo
        }).eq('id', id);

        clubUI.toast(`Solicitud aprobada. Recibo ${recibo} registrado para ${cliente.nombre}.`, 'success');
        if (window.clubDB?.logAccion) window.clubDB.logAccion('VENTA_TABLAS', `solicitud_aprobada: ${cliente.nombre} ${sol.cantidad} tablas ${sol.hipodromo} C${sol.carrera} recibo=${recibo}`);
        await cargarSolicitudesAdmin();
        await cargarReporteVentas();
        await inicializarDatosUtiles();
        render();
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
        await cargarSolicitudesAdmin();
    }

    document.getElementById('btnActualizarSolicitudes').addEventListener('click', cargarSolicitudesAdmin);

    // ==========================================
    // RESUMEN DE VENTAS POR WHATSAPP
    // Mensaje por día: hipódromo, carrera, número de
    // ejemplar, nombre y valor, que quepa en un WhatsApp.
    // ==========================================
    const modalWsp = document.getElementById('modalWhatsappVentas');
    const textWsp = document.getElementById('textoWhatsappVentas');
    const fechaWsp = document.getElementById('fechaReporteWhatsapp');
    fechaWsp.valueAsDate = new Date();

    function abrirModalWsp() {
        modalWsp.classList.remove('hidden');
        setTimeout(() => generarWhatsappVentas(), 0);
    }

    function cerrarModalWsp() {
        modalWsp.classList.add('hidden');
    }

    async function generarWhatsappVentas() {
        const dia = fechaWsp.value;
        if (!dia) return clubUI.toast('Seleccione la fecha del reporte.', 'warning');

        const fechaFin = new Date(dia + 'T23:59:59.999Z').toISOString();
        const fechaIni = new Date(dia + 'T00:00:00.000Z').toISOString();
        textWsp.value = 'Consultando ventas del día…';

        const { data } = await window.supabase
            .from('tickets_apuestas')
            .select('id, created_at, hipodromo, carrera, caballo, ejemplar_numero, cantidad_tablas, pts_ejemplar, monto_jugado, premio_por_tabla, moneda')
            .gte('created_at', fechaIni)
            .lte('created_at', fechaFin)
            .limit(5000);

        const tickets = (data || []).filter(t => t.hipodromo && t.carrera);
        if (!tickets.length) {
            textWsp.value = `No hay ventas registradas el día ${new Date(dia + 'T12:00:00').toLocaleDateString('es-VE')}.`;
            clubUI.toast('Sin ventas en esa fecha.', 'warning');
            return;
        }

        const simb = (moneda) => moneda === 'VES' ? 'Bs ' : '$';
        const porHipoCarrera = {};
        tickets.forEach(tk => {
            const clave = `${String(tk.hipodromo).toUpperCase().trim()}|C${tk.carrera}`;
            if (!porHipoCarrera[clave]) porHipoCarrera[clave] = { hipodromo: String(tk.hipodromo).toUpperCase().trim(), carrera: tk.carrera, ejemplares: {} };
            const num = tk.ejemplar_numero ? `N° ${tk.ejemplar_numero}` : `#${String(tk.caballo || '').slice(0, 1).toUpperCase() || '·'}`;
            const pad = porHipoCarrera[clave].ejemplares;
            if (!pad[num]) pad[num] = { nombre: tk.caballo || '', tablas: 0, valor: parseFloat(tk.pts_ejemplar || 0) || 0, moneda: tk.moneda };
            pad[num].tablas += parseInt(tk.cantidad_tablas) || 0;
            pad[num].valor = parseFloat(tk.pts_ejemplar || 0) || 0;
        });

        let texto = `🐎 *VENTA DE TABLAS FIJAS*\n`;
        texto += `📅 ${new Date(dia + 'T12:00:00').toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}\n\n`;

        let totalTablas = 0;
        let totalMonto = 0;
        Object.values(porHipoCarrera).forEach(hc => {
            texto += `🏇 ${hc.hipodromo} · Carrera ${hc.carrera}\n`;
            Object.entries(hc.ejemplares).forEach(([num, e]) => {
                const monto = e.tablas * e.valor;
                totalTablas += e.tablas;
                totalMonto += monto;
                texto += `  ${num} ${e.nombre} — ${e.tablas} tabla(s) a ${simb(e.moneda)}${fmt(e.valor, 1)}\n`;
            });
        });

        texto += `\n✅ *Total: ${totalTablas} tabla(s) · ${simb(tickets[0].moneda)}${fmt(totalMonto)}*`;

        textWsp.value = texto;
        clubUI.toast(`Resumen de ${tickets.length} venta(s) del día.`);
        if (window.clubDB?.logAccion) window.clubDB.logAccion('VENTA_TABLAS', `whatsapp_ventas: dia=${dia} ventas=${tickets.length} tablas=${totalTablas}`);
    }

    document.getElementById('btnAbrirWhatsappVentasResumen').addEventListener('click', abrirModalWsp);
    document.getElementById('btnGenerarWhatsappVentas').addEventListener('click', generarWhatsappVentas);
    document.getElementById('cerrarModalWhatsappVentas').addEventListener('click', cerrarModalWsp);
    document.querySelectorAll('.cerrar-modal-wsp').forEach(b => b.addEventListener('click', cerrarModalWsp));

    document.getElementById('btnAbrirWhatsappVentas').addEventListener('click', () => {
        const txt = textWsp.value.trim();
        if (!txt) return clubUI.toast('Primero genera el texto para enviar.', 'warning');
        const url = 'https://wa.me/?text=' + encodeURIComponent(txt);
        window.open(url, '_blank');
    });

    document.getElementById('btnCopiarWhatsappVentas').addEventListener('click', () => {
        textWsp.select();
        document.execCommand('copy');
        clubUI.toast('¡Texto copiado al portapapeles!');
    });

    // ==========================================
    // ARRANQUE
    // ==========================================
    inicializar();
    cargarSolicitudesAdmin();
    cargarReporteVentas();
});