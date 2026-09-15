// ============================================================
//  venta_tablas.js — Venta de Tablas Fijas (UI estilo Gaceta/
//  Ensamblaje). Render de tarjetas por carrera + modal de venta
//  con jugador, grupo que cobra y grupo que recibe comisión.
//  La transacción siempre delega en VentaTablasCore.venderTabla
//  (congela premio_por_tabla y pts_ejemplar en el ticket).
// ============================================================
document.addEventListener('DOMContentLoaded', () => {

    const filtroGrupo = document.getElementById('filtroGrupo');
    const filtroHipodromo = document.getElementById('filtroHipodromo');
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

    const menuEjemplarFlotante = document.getElementById('menuEjemplarFlotante');
    const mefTitulo = document.getElementById('mefTitulo');
    const mefCerrar = document.getElementById('mefCerrar');
    const mefCarrera = document.getElementById('mefCarrera');
    const mefEjemplar = document.getElementById('mefEjemplar');
    const mefValor = document.getElementById('mefValor');
    const mefDisponibles = document.getElementById('mefDisponibles');
    const mefCantidad = document.getElementById('mefCantidad');
    const mefMenos = document.getElementById('mefMenos');
    const mefMas = document.getElementById('mefMas');
    const mefGrupo = document.getElementById('mefGrupo');
    const mefAgregar = document.getElementById('mefAgregar');

    const barraCarrito = document.getElementById('barraCarrito');
    const carritoMini = document.getElementById('carritoMini');
    const carritoMiniResumen = document.getElementById('carritoMiniResumen');
    const carritoMiniTotal = document.getElementById('carritoMiniTotal');
    const carritoMiniBadge = document.getElementById('carritoMiniBadge');
    const carritoChevron = document.getElementById('carritoChevron');
    const carritoDetalle = document.getElementById('carritoDetalle');
    const carritoLista = document.getElementById('carritoLista');
    const carritoTotTablas = document.getElementById('carritoTotTablas');
    const carritoTotCosto = document.getElementById('carritoTotCosto');
    const carritoTotPremio = document.getElementById('carritoTotPremio');
    const carritoVender = document.getElementById('carritoVender');
    const carritoVaciar = document.getElementById('carritoVaciar');

    const mvResumenCarrito = document.getElementById('mvResumenCarrito');
    const mvResumenCarritoItems = document.getElementById('mvResumenCarritoItems');

    let gruposDB = [];
    let tablasDB = [];
    let clientesDB = [];
    let miembrosExtraPorGrupo = {}; // { grupo_id: [cliente_id,...] } pertenencias adicionales
    let grupoSeleccionado = null;
    let tasaCambioGlobal = 1.0;
    let aportadoPorCliente = false;
    let ventaCtx = null; // { tabla, ejemplar, tg } — contexto de la venta actual
    let carrito = []; // [{ tabla, ejemplar, tg, cantidad }] escaneos pendientes de confirmar

    const simboloDe = (m) => m === 'VES' ? 'Bs ' : '$';
    const fmt = (v, d = 2) => window.clubUI?.formatoNumero ? window.clubUI.formatoNumero(Number(v) || 0, d) : (Number(v) || 0).toFixed(d);

    // Paleta oficial de 14 colores de gualdrapa (idéntica al Ensamblaje)
    const COLORES_NUMEROS = [
        { bg: '#FF0000', fg: '#FFFFFF' }, { bg: '#FFFFFF', fg: '#000000' }, { bg: '#0000FF', fg: '#FFFFFF' },
        { bg: '#FFFF00', fg: '#000000' }, { bg: '#008000', fg: '#FFFFFF' }, { bg: '#000000', fg: '#FFFF00' },
        { bg: '#FFA500', fg: '#000000' }, { bg: '#FFC0CB', fg: '#000000' }, { bg: '#40E0D0', fg: '#000000' },
        { bg: '#800080', fg: '#FFFFFF' }, { bg: '#808080', fg: '#FF0000' }, { bg: '#32CD32', fg: '#000000' },
        { bg: '#8B4513', fg: '#FFFFFF' }, { bg: '#800000', fg: '#FFFFFF' },
    ];
    const colorDeNumero = (n) => {
        const x = parseInt(n, 10);
        return x ? COLORES_NUMEROS[((x - 1) % 14)].bg : '#94a3b8';
    };
    const textoDeNumero = (n) => {
        const x = parseInt(n, 10);
        return x ? COLORES_NUMEROS[((x - 1) % 14)].fg : '#FFFFFF';
    };
    const FLAGS_NAC = { VE: '🇻🇪', USA: '🇺🇸', BR: '🇧🇷', AR: '🇦🇷', CL: '🇨🇱', MX: '🇲🇽', PA: '🇵🇦', PE: '🇵🇪', CO: '🇨🇴', EC: '🇪🇨', UY: '🇺🇾', OTRA: '🏳️' };
    const htmlBanderaNac = (nac) => {
        const n = (nac || 'VE').trim().toUpperCase();
        return window.clubUI?.bandera
            ? `<span class="bandera-nac w-4 shrink-0 inline-flex justify-center items-center" title="${n}">${window.clubUI.bandera(n, 16)}</span>`
            : `<span class="bandera-nac w-4 shrink-0 inline-flex justify-center text-sm leading-none" title="${n}">${n}</span>`;
    };

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

        // Poblar el monitor por hipódromo: abre todas las carreras
        // publicadas del hipódromo (mismo UX que gaceta/ensamblaje).
        poblarFiltroHipodromo();

        // Preselección por URL (?hipodromo=... desde el monitor "Vender")
        const qs = new URLSearchParams(window.location.search);
        const hipoQs = (qs.get('hipodromo') || '').trim();
        if (hipoQs) {
            const opt = [...filtroHipodromo.options].find(o => o.value.toLowerCase() === hipoQs.toLowerCase());
            if (opt) filtroHipodromo.value = opt.value;
            else filtroHipodromo.value = hipoQs;
        }

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
        poblarFiltroTablas();
        render();
    }

    function poblarFiltroClientes() {
        filtroCliente.innerHTML = '<option value="">Todos...</option>';
        clientesDB.forEach(c => filtroCliente.innerHTML += `<option value="${c.id}">${c.nombre}</option>`);
    }

    // ==========================================
    // RENDER DE TARJETAS (mismo estilo gaceta/ensamblaje)
    // Monitor por HIPÓDROMO: abre todas las carreras del
    // hipódromo con su inventario por grupo, sin depender de
    // haber elegido primero un grupo. El grupo de venta se
    // elige por caballo (menú flotante) o queda fijado por la
    // cabecera si se seleccionó.
    // ==========================================
    function gruposInventarioDe(t) {
        return (t.tabla_grupos || [])
            .filter(x => ((x.cupos || 0) - (x.cantidad_vendida || 0)) > 0)
            .map(x => {
                const gr = gruposDB.find(g => g.id == x.grupo_id);
                return { tg: x, grupo: gr };
            })
            .filter(x => x.grupo);
    }

    function render() {
        const hipo = filtroHipodromo.value;
        const filtroTablaId = filtroTabla.value;
        const filtroClienteId = filtroCliente.value;

        let tablas = tablasDB.filter(t => {
            if (hipo && String(t.hipodromo || '').trim().toLowerCase() !== hipo.toLowerCase()) return false;
            if (filtroTablaId && t.id != filtroTablaId) return false;
            const tgs = gruposInventarioDe(t);
            // Si hay grupo fijado en cabecera, restringe al inventario de ese grupo.
            if (grupoSeleccionado) return tgs.some(x => x.grupo.id == grupoSeleccionado.id);
            return tgs.length > 0;
        });

        const clienteFiltro = filtroClienteId ? clientesDB.find(c => c.id == filtroClienteId) : null;
        if (clienteFiltro) {
            const clienteGrupos = new Set([clienteFiltro.grupo_id, ...(miembrosExtraPorGrupo[clienteFiltro.grupo_id]?.includes(clienteFiltro.id) ? [grupoSeleccionado?.id] : [])].filter(Boolean));
            tablas = tablas.filter(t => (t.tabla_grupos || []).some(tg => clienteGrupos.has(tg.grupo_id)));
            if (clienteFiltro.grupo_id && tablas.length === 0) {
                tablas = tablasDB.filter(t => {
                    if (hipo && String(t.hipodromo || '').trim().toLowerCase() !== hipo.toLowerCase()) return false;
                    return (t.tabla_grupos || []).some(tg => tg.grupo_id == clienteFiltro.grupo_id && ((tg.cupos || 0) - (tg.cantidad_vendida || 0)) > 0);
                });
            }
        }

        if (tablas.length === 0) {
            carrerasVenta.innerHTML = '';
            msgSinCarreras.classList.remove('hidden');
            msgSinCarreras.querySelector('p').textContent = filtroTablaId || hipo || clienteFiltro
                ? 'Ninguna carrera coincide con los filtros. Ajuste los filtros o pulse "Actualizar".'
                : 'No hay tablas fijas publicadas (estado "Abierta") con inventario disponible. Publique carreras desde el Ensamblaje.';
            return;
        }

msgSinCarreras.classList.add('hidden');
        carrerasVenta.innerHTML = tablas.map(t => {
            const gs = gruposInventarioDe(t);
            const g = grupoSeleccionado && gs.find(x => x.grupo.id == grupoSeleccionado.id)
                ? gs.find(x => x.grupo.id == grupoSeleccionado.id)
                : gs[0];
            const tg = g ? g.tg : null;
            const cupos = tg?.cupos || 0;
            const vendidas = tg?.cantidad_vendida || 0;
            const disponibles = Math.max(0, cupos - vendidas);
            const premio = parseFloat(t.premio_recalculado) || 0;
            const ejemplares = Array.isArray(t.caballos) ? t.caballos : [];
            const suma = ejemplares.reduce((acc, c) => acc + (parseFloat(c.valor_ejemplar ?? c.valor ?? c.pts) || 0), 0);
            const simb = g ? simboloDe(g.grupo.moneda) : '$';

            const chips = gs.map(x => {
                const disp = (x.tg.cupos || 0) - (x.tg.cantidad_vendida || 0);
                const activo = g && g.grupo.id == x.grupo.id;
                return `<span class="inline-flex items-center gap-1 rounded px-1.5 py-px text-[8px] font-black ${activo ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}" title="Disponibles en ${x.grupo.nombre}">${x.grupo.nombre}: <b>${disp}</b></span>`;
            }).join(' ') || '<span class="text-[9px] text-slate-400 italic">Sin inventario</span>';

            return `
            <div class="card-carrera bg-white rounded-xl shadow-sm border border-indigo-200 overflow-hidden flex flex-col" data-tabla="${t.id}">
                <div class="bg-indigo-600 px-2 py-1" style="color:#fff">
                    <div class="flex items-center justify-between gap-1">
                        <span class="rounded px-1.5 py-px text-[9px] font-bold uppercase tracking-wider truncate" style="background:rgba(255,255,255,.18);color:#fff">${t.hipodromo || ''}</span>
                        <span class="font-black text-[10px] whitespace-nowrap"><i class="fas fa-flag-checkered mr-0.5"></i>C${t.carrera ?? ''}</span>
                    </div>
                    <div class="flex flex-wrap gap-1 mt-0.5 text-[8px] font-bold items-center">
                        <span class="rounded px-1 py-px" style="background:rgba(255,255,255,.18)">Dist: ${t.distancia_carrera ?? ''} m</span>
                        <span class="rounded px-1 py-px uppercase" style="background:rgba(255,255,255,.18)">${t.superficie || 'ARENA'}</span>
                        <span class="rounded px-1 py-px" style="background:rgba(255,255,255,.18)">${t.fecha || ''}</span>
                    </div>
                    <div class="mt-1 flex items-center justify-between rounded px-2 py-1" style="background:rgba(255,255,255,.20)">
                        <span class="text-[9px] font-black uppercase tracking-wider opacity-90"><i class="fas fa-dollar-sign mr-0.5"></i> Monto a Pagar / Tabla</span>
                        <span class="font-black text-sm" style="color:#fff">${simb}${fmt(premio)}</span>
                    </div>
                </div>

                <div class="px-2 pt-1 pb-0.5 text-[8px] font-black uppercase tracking-wider text-slate-400 flex items-center justify-between">
                    <span><i class="fas fa-horse-head text-amber-500 mr-0.5"></i> Ejemplares · toca para vender</span>
                    <span class="bg-slate-100 text-slate-600 px-1.5 rounded-full font-black">${ejemplares.length}</span>
                </div>

                <div class="px-1.5 py-0.5 space-y-0.5 flex-1">
                    ${ejemplares.map(c => {
                        const bg = colorDeNumero(c.numero);
                        const fg = textoDeNumero(c.numero);
                        const retirado = !!c.retirado;
                        const valor = parseFloat(c.valor_ejemplar ?? c.valor ?? c.pts) || 0;
                        return `
                        <button type="button" class="js-ejemplar-venta flex gap-0.5 items-center w-full text-left bg-slate-50 border border-slate-200 rounded px-1 py-0.5 ${retirado ? 'opacity-40 pointer-events-none' : 'hover:border-indigo-400 hover:bg-indigo-50 cursor-pointer'}"
                            data-tabla="${t.id}" data-numero="${c.numero}" ${retirado ? 'disabled' : ''} title="${retirado ? 'Retirado de la carrera' : 'Comprar tablas de ' + (c.nombre || '')}">
                            <span class="w-4 h-5 shrink-0 rounded px-0 py-px text-center text-[8px] font-black border" style="background-color:${bg};color:${fg};border-color:${bg}">${c.numero ?? ''}</span>
                            <span class="flex-1 min-w-0 truncate text-[10px] font-bold uppercase text-slate-800">${c.nombre || 'Sin nombre'}</span>
                            ${htmlBanderaNac(c.nacionalidad)}
                            <span class="shrink-0 w-11 text-right text-[11px] font-black ${retirado ? 'text-red-500 line-through' : 'text-blue-700'}">${retirado ? 'RET.' : fmt(valor, 1)}</span>
                            <span class="shrink-0 w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 text-[9px] flex items-center justify-center"><i class="fas fa-cart-plus"></i></span>
                        </button>`;
                    }).join('') || '<p class="text-[10px] text-slate-400 italic px-1 py-1">Sin ejemplares registrados.</p>'}
                </div>

                <div class="px-2 py-1 border-t border-slate-200 bg-white flex items-center justify-between">
                    <span class="inline-flex items-center gap-1 text-[8px] font-black uppercase tracking-wider text-slate-400">
                        <i class="fas fa-calculator text-indigo-400"></i> Suma de la Tabla
                    </span>
                    <span class="font-black text-[11px] text-indigo-700" title="Sumatoria de los valores de todos los ejemplares">${simb}${fmt(suma)}</span>
                </div>
                <div class="px-2 py-1 border-t border-slate-100 bg-indigo-50 flex items-center justify-between gap-1">
                    <span class="text-[8px] font-black uppercase tracking-wider text-slate-500 shrink-0"><i class="fas fa-boxes text-indigo-400 mr-1"></i> Disponibles</span>
                    <span class="flex flex-wrap justify-end gap-0.5">${chips}</span>
                </div>
            </div>`;
        }).join('');

        // Delegación de eventos: tocar un ejemplar abre el menú flotante de compra
        // (agregar al carrito). Si ya está en el carrito se avisa y no se reabre.
        carrerasVenta.querySelectorAll('.js-ejemplar-venta').forEach(btn => {
            btn.addEventListener('click', () => {
                const tabla = tablasDB.find(t => t.id == btn.dataset.tabla);
                const ejemplar = (tabla?.caballos || []).find(c => c.numero == btn.dataset.numero);
                if (!tabla || !ejemplar) return clubUI.toast('No se pudo preparar la venta (ejemplar no encontrado).', 'error');
                const gs = gruposInventarioDe(tabla);
                if (gs.length === 0) return clubUI.toast('No hay inventario disponible en ningún grupo para esta carrera.', 'warning');
                const tgPre = (grupoSeleccionado && gs.find(x => x.grupo.id == grupoSeleccionado.id))
                    ? gs.find(x => x.grupo.id == grupoSeleccionado.id).tg
                    : gs[0].tg;
                const ya = carrito.find(c => c.tabla.id == tabla.id && String(c.ejemplar.numero) === String(ejemplar.numero));
                if (ya) return clubUI.toast(`${ejemplar.nombre} ya está en el carrito (${ya.cantidad} tabla(s)). Puede ajustar desde la barra del carrito.`, 'info');
                abrirMenuEjemplar(btn, { tabla, ejemplar, tg: tgPre });
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

    // ==========================================
    // CARRITO MÚLTIPLE DE VENTA
    // ==========================================
    const dispDe = (tg) => Math.max(0, (tg.cupos || 0) - (tg.cantidad_vendida || 0));

    function abrirMenuEjemplar(btn, ctx) {
        ventaCtx = ctx;
        const { tabla, ejemplar, tg } = ctx;
        const pts = parseFloat(ejemplar.valor_ejemplar ?? ejemplar.valor ?? ejemplar.pts) || 0;

        // Grupos con inventario disponible para ESTA carrera (el grupo de venta
        // se elige por caballo, igual que en la taquilla). El grupo de cabecera
        // (si se eligió) queda preseleccionado.
        const gs = gruposInventarioDe(tabla);
        const pre = (grupoSeleccionado && gs.find(x => x.grupo.id == grupoSeleccionado.id))
            ? gs.find(x => x.grupo.id == grupoSeleccionado.id)
            : (gs.find(x => x.tg.id == tg.id) || gs[0]);
        const g = pre ? pre.grupo : null;

        mefGrupo.innerHTML = gs.map(x =>
            `<option value="${x.tg.id}" data-grupo-id="${x.grupo.id}">${x.grupo.nombre} (${simboloDe(x.grupo.moneda)})</option>`
        ).join('') || '<option value="">Sin inventario</option>';
        mefGrupo.disabled = gs.length === 0;
        if (g) mefGrupo.value = String(pre.tg.id);
        ventaCtx.tg = gs.find(x => String(x.tg.id) === String(mefGrupo.value))?.tg || tg;
        atualizarMenuGrupo();

        mefCarrera.textContent = `${tabla.hipodromo} · C${tabla.carrera}`;
        mefEjemplar.textContent = `N° ${ejemplar.numero ?? ''} — ${ejemplar.nombre}`;
        mefCantidad.value = Math.min(1, dispDe(ventaCtx.tg) || 1);
        atualizarMenuGrupo();

        const r = btn ? btn.getBoundingClientRect() : null;
        const w = menuEjemplarFlotante.offsetWidth || 288;
        const h = menuEjemplarFlotante.offsetHeight || 280;
        let left = r ? r.left : 12;
        let top = r ? r.bottom + 8 : 220;
        left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
        if (top + h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - h - 8);
        menuEjemplarFlotante.style.left = left + 'px';
        menuEjemplarFlotante.style.top = top + 'px';
        menuEjemplarFlotante.classList.remove('hidden');
        requestAnimationFrame(() => mefCantidad.focus());
    }

    function atualizarMenuGrupo() {
        if (!ventaCtx) return;
        const { ejemplar } = ventaCtx;
        const pendItem = gruposInventarioDe(ventaCtx.tabla).find(x => String(x.tg.id) === String(mefGrupo.value));
        const g = pendItem ? pendItem.grupo : (grupoSeleccionado || null);
        if (pendItem) ventaCtx.tg = pendItem.tg;
        const pts = parseFloat(ejemplar.valor_ejemplar ?? ejemplar.valor ?? ejemplar.pts) || 0;
        mefValor.textContent = `${g ? simboloDe(g.moneda) : '$'}${fmt(pts)}`;
        mefDisponibles.textContent = `${dispDe(ventaCtx.tg)} tabla(s)`;
        const cant = parseInt(mefCantidad.value) || 1;
        mefCantidad.value = Math.min(cant, dispDe(ventaCtx.tg) || 1);
    }

    mefGrupo.addEventListener('change', atualizarMenuGrupo);

    function cerrarMenuEjemplar() {
        menuEjemplarFlotante.classList.add('hidden');
        ventaCtx = null;
    }

    mefCerrar.addEventListener('click', cerrarMenuEjemplar);
    mefMenos.addEventListener('click', () => {
        mefCantidad.value = Math.max(1, (parseInt(mefCantidad.value) || 1) - 1);
    });
    mefMas.addEventListener('click', () => {
        const disp = ventaCtx ? dispDe(ventaCtx.tg) : 999;
        mefCantidad.value = Math.min(disp || 999, (parseInt(mefCantidad.value) || 1) + 1);
    });
    mefCantidad.addEventListener('input', () => {
        if (!ventaCtx) return;
        const disp = dispDe(ventaCtx.tg);
        const v = parseInt(mefCantidad.value) || 1;
        if (v > disp) mefCantidad.value = disp || 1;
        if (v < 1) mefCantidad.value = 1;
    });
    mefAgregar.addEventListener('click', () => {
        if (!ventaCtx) return;
        const { tabla, ejemplar, tg } = ventaCtx;
        const cantidad = Math.max(1, parseInt(mefCantidad.value) || 1);
        const disp = dispDe(tg);
        if (cantidad > disp) return clubUI.toast(`Solo quedan ${disp} tabla(s) de ${ejemplar.nombre}.`, 'warning');

        const existente = carrito.find(c => c.tabla.id == tabla.id && String(c.ejemplar.numero) === String(ejemplar.numero));
        if (existente) {
            return clubUI.toast(`${ejemplar.nombre} ya está en el carrito (${existente.cantidad} tabla(s)).`);
        }
        carrito.push({ tabla, ejemplar, tg, cantidad });
        cerrarMenuEjemplar();
        renderCarrito();
        render();
        clubUI.toast(`${cantidad} tabla(s) de ${ejemplar.nombre} agregadas al carrito.`, 'success');
    });

    function renderCarrito() {
        const totalItems = carrito.length;
        const totalTablas = carrito.reduce((a, c) => a + c.cantidad, 0);
        const g = grupoSeleccionado || gruposDB.find(x => x.id == (carrito[0]?.tg.grupo_id)) || null;
        const simb = g ? simboloDe(g.moneda) : '$';
        const totalCosto = carrito.reduce((a, c) => a + (parseFloat(c.ejemplar.valor_ejemplar ?? c.ejemplar.valor ?? c.ejemplar.pts) || 0) * c.cantidad, 0);
        const totalPremio = carrito.reduce((a, c) => a + (parseFloat(c.tabla.premio_recalculado) || 0) * c.cantidad, 0);

        if (carrito.length === 0) {
            barraCarrito.classList.add('hidden');
            return;
        }
        barraCarrito.classList.remove('hidden');
        carritoMiniResumen.textContent = `${totalItems} ejemplar(es) · ${totalTablas} tabla(s)`;
        carritoMiniTotal.textContent = `${simb}${fmt(totalCosto)}`;
        carritoMiniBadge.textContent = totalTablas;
        carritoMiniBadge.classList.remove('hidden');
        carritoTotTablas.textContent = totalTablas;
        carritoTotCosto.textContent = `${simb}${fmt(totalCosto)}`;
        carritoTotPremio.textContent = `${simb}${fmt(totalPremio)}`;

        carritoLista.innerHTML = carrito.map((c, i) => {
            const bg = colorDeNumero(c.ejemplar.numero);
            return `
            <div class="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5">
                <span class="w-4 h-5 shrink-0 rounded px-0 py-px text-center text-[8px] font-black border" style="background-color:${bg};color:${textoDeNumero(c.ejemplar.numero)};border-color:${bg}">${c.ejemplar.numero ?? ''}</span>
                <div class="flex-1 min-w-0">
                    <div class="text-[10px] font-bold uppercase truncate text-slate-800">${c.ejemplar.nombre || ''}</div>
                    <div class="text-[8px] text-slate-500 uppercase">${c.tabla.hipodromo} C${c.tabla.carrera}</div>
                </div>
                <div class="flex items-center gap-1 shrink-0">
                    <button type="button" data-act="menos" data-i="${i}" class="w-6 h-6 rounded bg-slate-200 hover:bg-slate-300 font-black text-sm leading-none">−</button>
                    <span class="w-8 text-center text-[11px] font-black text-slate-800">${c.cantidad}</span>
                    <button type="button" data-act="mas" data-i="${i}" class="w-6 h-6 rounded bg-slate-200 hover:bg-slate-300 font-black text-sm leading-none">+</button>
                </div>
                <span class="w-16 shrink-0 text-right text-[10px] font-black text-blue-700">${simb}${fmt((parseFloat(c.ejemplar.valor_ejemplar ?? c.ejemplar.valor ?? c.ejemplar.pts) || 0) * c.cantidad)}</span>
                <button type="button" data-act="quitar" data-i="${i}" class="w-6 h-6 shrink-0 rounded text-red-400 hover:text-red-600 hover:bg-red-50"><i class="fas fa-trash-alt text-[10px]"></i></button>
            </div>`;
        }).join('');

        carritoLista.querySelectorAll('button[data-act]').forEach(btn => {
            btn.addEventListener('click', () => {
                const i = parseInt(btn.dataset.i, 10);
                const item = carrito[i];
                if (!item) return;
                if (btn.dataset.act === 'mas') {
                    const disp = dispDe(item.tg);
                    if (item.cantidad + 1 > disp) { clubUI.toast(`Solo quedan ${disp} tabla(s) de ${item.ejemplar.nombre}.`, 'warning'); return; }
                    item.cantidad += 1;
                } else if (btn.dataset.act === 'menos') {
                    item.cantidad -= 1;
                    if (item.cantidad <= 0) item.cantidad = 1;
                } else {
                    carrito.splice(i, 1);
                }
                renderCarrito();
                render();
            });
        });
    }

    carritoMini.addEventListener('click', () => {
        const abierto = !carritoDetalle.classList.contains('hidden');
        carritoDetalle.classList.toggle('hidden');
        carritoChevron.className = 'fas fa-chevron-' + (abierto ? 'up' : 'down') + ' text-slate-400 text-[10px] shrink-0';
    });
    carritoVaciar.addEventListener('click', () => {
        carrito = [];
        renderCarrito();
        render();
        clubUI.toast('Carrito vaciado.', 'info');
    });
    carritoVender.addEventListener('click', () => {
        if (carrito.length === 0) return clubUI.toast('El carrito está vacío.', 'warning');
        abrirModalVentaCarrito();
    });

    function abrirModalVentaCarrito() {
        if (carrito.length === 0) return;
        // Los grupos pueden variar por item (cada caballo eligió su grupo de
        // venta). El grupo que COBRA del primer item define moneda y clientes
        // a mostrar; los demás items conservan su propio tg al confirmar.
        const primerGrupo = gruposDB.find(x => x.id == carrito[0].tg.grupo_id) || grupoSeleccionado;
        if (!primerGrupo) return clubUI.toast('Grupo de venta no encontrado para el carrito.', 'error');
        const g = primerGrupo;
        const simb = simboloDe(g.moneda);
        const { tabla, ejemplar, tg } = carrito[0];

        ventaCtx = null;
        const premio = parseFloat(tabla.premio_recalculado) || 0;
        const pts = parseFloat(ejemplar.valor_ejemplar ?? ejemplar.valor ?? ejemplar.pts) || 0;

        mvCarrera.textContent = `${tabla.hipodromo} · C${tabla.carrera} (+${carrito.length - 1} más)`;
        mvEjemplar.textContent = `N° ${ejemplar.numero ?? ''} — ${ejemplar.nombre}`;
        mvValor.textContent = `${simb}${fmt(pts)}`;
        mvPremio.textContent = `${simb}${fmt(premio)}`;

        mvResumenCarrito.classList.remove('hidden');
        document.getElementById('mvResumenCarritoTitulo').textContent = `Venta múltiple — ${carrito.length} ejemplar(es) · ${carrito.reduce((a, c) => a + c.cantidad, 0)} tabla(s)`;
        mvResumenCarritoItems.innerHTML = carrito.map(c => {
            const grIt = gruposDB.find(x => x.id == c.tg.grupo_id);
            const sIt = grIt ? simboloDe(grIt.moneda) : simb;
            return `
            <div class="flex justify-between gap-2"><span class="truncate">${grIt ? grIt.nombre + ' · ' : ''}N° ${c.ejemplar.numero ?? ''} — ${c.ejemplar.nombre} (${c.tabla.hipodromo} C${c.tabla.carrera})</span><strong class="shrink-0">${c.cantidad} × ${sIt}${fmt(parseFloat(c.ejemplar.valor_ejemplar ?? c.ejemplar.valor ?? c.ejemplar.pts) || 0)}</strong></div>`;
        }).join('');

        // Grupo que COBRA: se lista el del primer item; si todos comparten grupo se
        // fija; si hay varios, el cobro se aplica por item (cada uno con su grupo).
        const gruposUnicos = [...new Set(carrito.map(c => c.tg.grupo_id))];
        if (gruposUnicos.length === 1) {
            mvGrupoCobro.innerHTML = `<option value="${g.id}">${g.nombre} (${g.moneda})</option>`;
            mvGrupoCobro.disabled = true;
        } else {
            mvGrupoCobro.disabled = true;
            mvGrupoCobro.innerHTML = `<option value="${g.id}">${g.nombre} (${g.moneda}) — grupo del 1er item (los demás cobran en su propio grupo)</option>`;
        }

        const extraIds = (miembrosExtraPorGrupo[g.id] || []).filter(id => !clientesDB.find(c => c.id == id && c.grupo_id == g.id));
        const delGrupo = clientesDB
            .filter(c => c.grupo_id == g.id || !c.grupo_id || extraIds.includes(c.id))
            .sort((a, b) => a.nombre.localeCompare(b.nombre));
        mvCliente.innerHTML = '<option value="">Seleccione apostador...</option>';
        delGrupo.forEach(c => mvCliente.innerHTML += `<option value="${c.id}">${c.nombre} (Saldo: $${fmt(parseFloat(c.saldo_actual) || 0)})</option>`);
        mvCliente.disabled = delGrupo.length === 0;
        if (delGrupo.length === 0) mvCliente.innerHTML += '<option value="" disabled>No hay clientes en este grupo</option>';

        mvGrupoComision.innerHTML = '';
        gruposDB.filter(x => x.activo).forEach(x => mvGrupoComision.innerHTML += `<option value="${x.id}">${x.nombre} (comisión ${fmt(parseFloat(x.comision_default ?? 2.5), 1)}%)</option>`);
        mvGrupoComision.value = g.id.toString();

        mvCantidad.value = 1;
        actualizarTotalesModal();
        modalVenta.classList.remove('hidden');
        modalVenta.classList.add('flex');
        document.body.style.overflow = 'hidden';
        requestAnimationFrame(() => mvCliente.focus());
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
        if (e.key === 'Escape' && !menuEjemplarFlotante.classList.contains('hidden')) cerrarMenuEjemplar();
    });
    document.addEventListener('click', (e) => {
        if (menuEjemplarFlotante.classList.contains('hidden')) return;
        if (!menuEjemplarFlotante.contains(e.target) && !e.target.closest('.js-ejemplar-venta')) {
            cerrarMenuEjemplar();
        }
    });

    function comisionPorcActual() {
        const gCom = gruposDB.find(x => x.id == mvGrupoComision.value);
        if (carrito.length) {
            const deTabla = parseFloat(carrito[0].tabla.comision_grupo);
            if (!isNaN(deTabla)) return deTabla;
            return parseFloat(gCom?.comision_default ?? 2.5);
        }
        const deTabla = parseFloat(ventaCtx?.tabla?.comision_grupo);
        if (!isNaN(deTabla)) return deTabla;
        return parseFloat(gCom?.comision_default ?? 2.5);
    }

    function itemsVenta() {
        return carrito.length ? carrito : (ventaCtx ? [{ tabla: ventaCtx.tabla, ejemplar: ventaCtx.ejemplar, tg: ventaCtx.tg, cantidad: Math.max(1, parseInt(mvCantidad.value) || 1) }] : []);
    }

    function actualizarTotalesModal() {
        const items = itemsVenta();
        if (items.length === 0) return;
        const g = grupoSeleccionado || gruposDB.find(x => x.id == items[0].tg.grupo_id) || null;
        const simb = g ? simboloDe(g.moneda) : '$';
        const ptsTotalRaw = items.reduce((a, it) => a + (parseFloat(it.ejemplar.valor_ejemplar ?? it.ejemplar.valor ?? it.ejemplar.pts) || 0) * it.cantidad, 0);
        const premioTotalRaw = items.reduce((a, it) => a + (parseFloat(it.tabla.premio_recalculado) || 0) * it.cantidad, 0);
        const cantTotal = items.reduce((a, it) => a + it.cantidad, 0);
        const comisionPorc = comisionPorcActual();
        const ganancia = Math.max(0, premioTotalRaw - ptsTotalRaw);
        const comision = ganancia * (comisionPorc / 100);

        mvCostoUnit.textContent = `${simb}${fmt(cantTotal ? ptsTotalRaw / cantTotal : 0)}`;
        mvCostoTotal.textContent = `${simb}${fmt(ptsTotalRaw)}`;
        mvPremioTotal.textContent = `${simb}${fmt(premioTotalRaw)}`;
        mvComisionEst.textContent = `${simb}${fmt(comision)} (${fmt(comisionPorc, 1)}%)`;
        mvGanancia.textContent = `${simb}${fmt(ganancia)}`;
        let disponibleMin = Infinity;
        items.forEach(it => { disponibleMin = Math.min(disponibleMin, dispDe(it.tg)); });
        if (!Number.isFinite(disponibleMin)) disponibleMin = 0;
        mvDisponibles.textContent = carrito.length
            ? `Venta múltiple de ${items.length} ejemplar(es) · ${cantTotal} tabla(s) · disponible mínimo: ${disponibleMin}`
            : `Disponibles en ${g ? g.nombre : 'grupo'}: ${disponibleMin} tabla(s)`;
    }

    mvConfirmar.addEventListener('click', async () => {
        const items = itemsVenta();
        if (items.length === 0) return;
        const clienteId = mvCliente.value;
        if (!clienteId) return clubUI.toast('Seleccione el jugador que compra.', 'warning');

        // Pre-validación de disponibilidad combinada
        for (const it of items) {
            const cant = Math.max(1, parseInt(it.cantidad) || 1);
            if (cant > dispDe(it.tg)) return clubUI.toast(`No hay suficientes tablas de ${it.ejemplar.nombre} (${it.tabla.hipodromo} C${it.tabla.carrera}). Solo quedan ${dispDe(it.tg)}.`, 'warning');
            it.cantidad = cant;
        }

        const cliente = clientesDB.find(c => c.id == clienteId);
        if (!cliente) return clubUI.toast('Cliente no encontrado.', 'error');

        // Valida la pertenencia por cada grupo involucrado en el carrito
        // (cada item conserva su propio grupo de venta/inventario).
        const gruposItems = [...new Set(items.map(it => it.tg.grupo_id))];
        for (const gid of gruposItems) {
            const gi = gruposDB.find(x => x.id == gid);
            if (!gi) continue;
            const esMiembro = cliente.grupo_id == gi.id || !cliente.grupo_id || (miembrosExtraPorGrupo[gi.id]?.includes(cliente.id));
            if (!esMiembro) return clubUI.toast(`El jugador no pertenece al grupo ${gi.nombre} (inventario del carrito).`, 'warning');
        }

        const grupoComision = gruposDB.find(x => x.id == mvGrupoComision.value) || gruposDB.find(x => x.id == gruposItems[0]) || null;
        const cobroGrupo = gruposDB.find(x => x.id == mvGrupoCobro.value) || gruposDB.find(x => x.id == gruposItems[0]) || null;

        // Conversión global del costo para validaciones de saldo (USD). Cada
        // item se convierte en la moneda de SU grupo.
        let costoTotalUSD = 0;
        for (const it of items) {
            const gIt = gruposDB.find(x => x.id == it.tg.grupo_id) || cobroGrupo;
            const ptsItem = (parseFloat(it.ejemplar.valor_ejemplar ?? it.ejemplar.valor ?? it.ejemplar.pts) || 0) * it.cantidad;
            costoTotalUSD += (gIt?.moneda === 'VES') ? ptsItem / (tasaCambioGlobal || 1) : ptsItem;
        }

        // Validaciones de saldo combinadas (reglas por modo de juego)
        const modoJuega = cliente.modo_juego || (cliente.libre ? 'libre' : 'aval');
        let permitirSobregiro = false;
        if (modoJuega === 'pozo') {
            const disp = parseFloat(cliente.saldo_actual || 0);
            if (disp < costoTotalUSD) return clubUI.toast(`El jugador ${cliente.nombre} juega con Pozo y no tiene saldo disponible (tiene $${fmt(disp)}). Debe abonar antes de comprar.`, 'warning');
        } else if (!cliente.libre) {
            const limiteAval = parseFloat(cliente.aval || 0);
            if ((parseFloat(cliente.saldo_actual) || 0) - costoTotalUSD < -limiteAval) {
                return clubUI.toast(`El jugador ${cliente.nombre} supera su límite de AVAL ($${fmt(limiteAval)}). Debe abonar antes de comprar.`, 'warning');
            }
        }
        const esVESGlobal = gruposDB.find(x => x.id == gruposItems[0])?.moneda === 'VES';
        if (!esVESGlobal && parseFloat(cliente.saldo_actual) < costoTotalUSD) {
            if (!confirm(`El jugador ${cliente.nombre} tiene saldo insuficiente ($${fmt(cliente.saldo_actual)}). ¿Desea proceder de todas formas?`)) return;
            permitirSobregiro = true;
        }

        mvConfirmar.disabled = true;
        const orig = mvConfirmar.innerHTML;
        mvConfirmar.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Procesando...';

        // Vende cada item del carrito con SU grupo (el dueño del inventario/tg),
        // congelando premio/valor y descontando inventario por item.
        const resultados = [];
        let fallo = null;
        for (const it of items) {
            const gIt = gruposDB.find(x => x.id == it.tg.grupo_id) || cobroGrupo;
            if (!gIt) { fallo = 'Grupo de venta no encontrado.'; break; }
            const res = await window.VentaTablasCore.venderTabla({
                cliente, cantidad: it.cantidad, ejemplar: it.ejemplar, tabla: it.tabla, tg: it.tg,
                grupo: gIt, grupoComision,
                tasaCambio: tasaCambioGlobal, permitirSobregiro
            });
            if (!res.ok) { fallo = res.error; break; }
            resultados.push({ it, res });
        }

        if (fallo) {
            clubUI.toast('Venta interrumpida: ' + fallo, 'error');
            if (window.clubDB?.logAccion) window.clubDB.logAccion('VENTA_TABLAS', `venta_multi_fallida: ${cliente.nombre} items_ok=${resultados.length} error=${fallo}`);
        } else {
            const totalCosto = resultados.reduce((a, r) => a + r.res.costoTotal, 0);
            const totalPremio = resultados.reduce((a, r) => a + r.res.premioTotal, 0);
            const totalGanancia = resultados.reduce((a, r) => a + r.res.gananciaTotal, 0);
            const totalComision = resultados.reduce((a, r) => a + r.res.comisionEstimada, 0);
            clubUI.toast(`¡Venta procesada! ${resultados.length} item(s) · ${cobroGrupo?.nombre || 'grupos'}, comisión a ${grupoComision?.nombre || 'grupos'}.`, 'success');
            if (window.clubDB?.logAccion) window.clubDB.logAccion('VENTA_TABLAS', `venta: ${cliente.nombre} ${resultados.length} items ($${fmt(costoTotalUSD)}) comision=${grupoComision?.nombre || ''}`);

            const saldoPosterior = (parseFloat(cliente.saldo_actual || 0)) - costoTotalUSD;
            const htmlComp = comprobanteMultiHTML({ cliente, resultados, grupo: cobroGrupo, grupoComision, totalCosto, totalPremio, totalGanancia, totalComision, saldoPosterior, esVES: esVESGlobal });
            window.VentaTablasCore.printHTML(`Comprobante — ${cliente.nombre} (${resultados.length} items)`, htmlComp);
        }

        mvConfirmar.disabled = false;
        mvConfirmar.innerHTML = orig;
        cerrarModalVenta();
        if (!fallo) {
            carrito = [];
            renderCarrito();
        }
        await cargarReporteVentas();
        await cargarSolicitudesAdmin();
        await inicializarDatosUtiles();
        render();
    });

    function comprobanteMultiHTML({ cliente, resultados, grupo, grupoComision, totalCosto, totalPremio, totalGanancia, totalComision, saldoPosterior, esVES }) {
        const primerGrupo = resultados[0]?.it.tg ? (gruposDB.find(x => x.id == resultados[0].it.tg.grupo_id) || grupo) : grupo;
        const simb = (primerGrupo?.moneda || esVES ? 'VES' : 'USD') === 'VES' ? 'Bs ' : '$';
        const fecha = new Date().toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' });
        const folio = `T-MULTI-${Date.now().toString().slice(-8)}`;
        const filas = resultados.map(r => `
            <tr>
                <td>${r.it.tabla.hipodromo} · C${r.it.tabla.carrera}</td>
                <td>N° ${r.it.ejemplar.numero || '-'} — ${r.it.ejemplar.nombre}</td>
                <td class="r">${r.it.cantidad}</td>
                <td class="r">${simb}${fmt(r.res.pts)}</td>
                <td class="r">${simb}${fmt(r.res.premio)}</td>
                <td class="r b">${simb}${fmt(r.res.costoTotal)}</td>
                <td class="r b">${simb}${fmt(r.res.premioTotal)}</td>
            </tr>`).join('');
        const notas = [];
        if (parseFloat(saldoPosterior) < 0) notas.push(`Aviso: tras la venta, el cliente ${cliente.nombre} queda con saldo negativo de $${fmt(Math.abs(saldoPosterior))} (aval activo).`);
        const comP = resultados[0]?.res.comisionPorc ?? 0;
        return `
            <h1>Comprobante de Venta · Tabla Fija (Múltiple)</h1>
            <div class="sub">Folio: ${folio} &nbsp;·&nbsp; ${fecha}</div>
            <table>
                <tr><th>Cliente</th><td class="b">${cliente.nombre}</td></tr>
                <tr><th>Grupo que cobra</th><td>${grupo?.nombre || primerGrupo?.nombre || '—'}</td></tr>
                <tr><th>Grupo comisión</th><td>${grupoComision?.nombre || '—'}</td></tr>
            </table>
            <table>
                <tr><th>Carrera</th><th>Ejemplar</th><th>Tablas</th><th>Pts c/u</th><th>Premio c/u</th><th class="r">Costo</th><th class="r">Premio total</th></tr>
                ${filas}
            </table>
            <table>
                <tr class="gran"><th>Total Pagado</th><td class="r b">${simb}${fmt(totalCosto)}</td></tr>
                <tr><th>Premio a Cobrar (si gana)</th><td class="r b">${simb}${fmt(totalPremio)}</td></tr>
                <tr><th>Ganancia (si gana)</th><td class="r b">${simb}${fmt(totalGanancia)}</td></tr>
                <tr class="gran"><th>Comisión del Grupo (${fmt(comP, 1)}% s/ganancia)</th><td class="r b">${simb}${fmt(totalComision)}</td></tr>
            </table>
            <div class="aviso">
                Premios ajustados por retiros oficiales de cada carrera. Liquidación al cierre de la carrera.<br>
                ${notas.length ? notas.join('<br>') : ''}
            </div>`;
    }

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
        poblarFiltroHipodromo();
        poblarFiltroTablas();
    }

    // ==========================================
    // FILTROS
    // ==========================================
    function poblarFiltroHipodromo() {
        const actual = filtroHipodromo.value;
        const hipos = [...new Map(tablasDB.filter(t => t.hipodromo).map(t => [String(t.hipodromo).trim().toLowerCase(), String(t.hipodromo).trim()])).values()].sort((a, b) => a.localeCompare(b));
        filtroHipodromo.innerHTML = '<option value="">Todos los Hipódromos...</option>';
        hipos.forEach(h => filtroHipodromo.innerHTML += `<option value="${h}">${h}</option>`);
        if (actual && hipos.includes(actual)) filtroHipodromo.value = actual;
    }

    function poblarFiltroTablas() {
        const hipo = filtroHipodromo.value;
        let lista = tablasDB;
        if (hipo) {
            const h = hipo.toLowerCase();
            lista = lista.filter(t => String(t.hipodromo || '').trim().toLowerCase() === h);
        }
        filtroTabla.innerHTML = '<option value="">Todas las carreras de este filtro...</option>';
        filtroTabla.disabled = lista.length === 0;
        lista.forEach(t => filtroTabla.innerHTML += `<option value="${t.id}">${t.hipodromo} - C${t.carrera}${grupoSeleccionado ? ' (' + grupoSeleccionado.moneda + ')' : ''}</option>`);
    }

    filtroHipodromo.addEventListener('change', () => {
        poblarFiltroTablas();
        render();
    });

    filtroGrupo.addEventListener('change', () => {
        grupoSeleccionado = gruposDB.find(g => g.id == filtroGrupo.value) || null;
        filtroCliente.disabled = false;
        filtroCliente.value = '';
        aportadoPorCliente = false;
        if (carrito.length) {
            carrito = [];
            renderCarrito();
            clubUI.toast('Se cambió el grupo. Carrito vaciado.', 'info');
        }
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
        }
        poblarFiltroHipodromo();
        poblarFiltroTablas();
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