document.addEventListener('DOMContentLoaded', () => {

    const KEY = 'club_portal_sesion';

    const pantallaAcceso = document.getElementById('pantallaAcceso');
    const vistaPortal = document.getElementById('vistaPortal');
    const inputToken = document.getElementById('inputPortalToken');
    const inputClave = document.getElementById('inputPortalClave');
    const btnEntrar = document.getElementById('btnEntrarPortal');
    const btnCerrar = document.getElementById('btnCerrarPortal');

    const selectTabla = document.getElementById('portalSelectTabla');
    const selectEjemplar = document.getElementById('portalSelectEjemplar');
    const inputCantidad = document.getElementById('portalCantidad');
    const lblTotalPagar = document.getElementById('portalTotalPagar');
    const btnSolicitar = document.getElementById('btnEnviarSolicitud');
    const msgCompra = document.getElementById('portalMsgCompra');

    let sesion = null;
    let clienteDatos = null;
    let grupoDatos = null;
    let tablasDisponibles = [];
    let tablaSeleccionada = null;
    let tasaGlobal = 1.0;

    const sesionGuardada = () => {
        try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { return null; }
    };
    const guardarSesion = (s) => localStorage.setItem(KEY, JSON.stringify(s));
    const cerrarSesion = () => { localStorage.removeItem(KEY); window.location.reload(); };

    // Prellenar el código desde el enlace (portal.html?c=..&k=..)
    const params = new URLSearchParams(window.location.search);
    const tkUrl = params.get('k');
    if (tkUrl) inputToken.value = tkUrl;

    // ==========================================
    // ACTUALIZAR MIS DATOS (prellenado + solicitud)
    // ==========================================
    const cpPortal = document.getElementById('cpPortal');
    const tfPortal = document.getElementById('tfPortal');
    const metodoPortal = document.getElementById('metodoPortal');
    const bloqueDatosPortal = document.getElementById('bloqueDatosPagoPortal');
    const val = (id) => document.getElementById(id)?.value ?? '';
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v ?? ''; };

    cpPortal.innerHTML = clubUI.htmlOpcionesCodigoPais('+58');
    metodoPortal.innerHTML = '<option value="">— Seleccione —</option>' + clubUI.htmlOpcionesMetodos();

    function renderBloqueDatosPortal(metodo, dp) {
        if (!metodo) { bloqueDatosPortal.classList.add('hidden'); bloqueDatosPortal.innerHTML = ''; return; }
        const lbl = 'block text-[10px] font-bold text-slate-600 mb-1 uppercase tracking-wider';
        const inp = 'w-full border border-cyan-300 rounded-lg px-3 py-2 text-xs outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 bg-white';
        const dis = inp + ' bg-cyan-50 font-bold text-cyan-800 cursor-not-allowed';
        let html;
        if (clubUI.esBancoVzla(metodo)) {
            const [codigo, ...resto] = metodo.split(' · ');
            const nombre = resto.join(' · ');
            const esSudeban = codigo === '0157';
            const hint = esSudeban
                ? `<p class="md:col-span-3 mt-1 text-[9px] font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded p-2">💡 <b>SUDEBAN:</b> coloca los <u>16 dígitos</u> que van después del código ${codigo}.</p>`
                : '';
            html = `
                <div class="md:col-span-2"><label class="${lbl}">Banco (predeterminado)</label><input readonly value="${nombre}" class="${dis}"></div>
                <div><label class="${lbl}">Código SUDEBAN</label><input readonly value="${codigo}" class="${dis}"></div>
                <div><label class="${lbl}">Tipo de Cuenta</label><select id="pvTipoCuenta" class="${inp} font-bold"><option>CORRIENTE</option><option>AHORRO</option></select></div>
                <div><label class="${lbl}">Número de Cuenta <span class="text-[9px] font-bold text-cyan-600">(16 dígitos)</span></label><input id="pvNumeroCuenta" inputmode="numeric" maxlength="16" placeholder="${esSudeban ? 'SOLO los 16 dígitos (sin ' + codigo + ')' : '16 dígitos (sin el código ' + codigo + ')'}" class="${inp} font-mono"></div>
                <div><label class="${lbl}">Titular (nombre en la cuenta)</label><input id="pvTitular" class="${inp} uppercase"></div>
                ${hint}`;
        } else if (metodo === 'PAGO MÓVIL') {
            html = `
                <div><label class="${lbl}">Banco (pago móvil)</label><select id="pvBancoMovil" class="${inp} font-bold">${clubUI.htmlOpcionesBancosVzla()}</select></div>
                <div><label class="${lbl}">Teléfono vinculado</label><input id="pvTlfMovil" inputmode="numeric" placeholder="0412 123 4567" class="${inp} font-mono"></div>
                <div><label class="${lbl}">Titular (opcional)</label><input id="pvTitularMovil" class="${inp} uppercase"></div>
                <div><label class="${lbl}">Cédula / RIF (opcional)</label><input id="pvCedulaMovil" class="${inp} font-mono uppercase" placeholder="V-12.345.678"></div>`;
        } else if (metodo === 'ZELLE' || metodo === 'BINANCE') {
            html = `
                <div><label class="${lbl}">Tipo de dato</label><select id="pvTipoContacto" class="${inp} font-bold"><option value="correo">Correo electrónico</option><option value="telefono">Número de teléfono</option></select></div>
                <div class="md:col-span-2"><label class="${lbl}">Dato de ${metodo} (correo o teléfono)</label><input id="pvDatoContacto" class="${inp}"></div>
                ${metodo === 'BINANCE' ? `<div><label class="${lbl}">ID / UID Binance (opcional)</label><input id="pvIdBinance" class="${inp}"></div>` : ''}`;
        } else {
            html = `<div class="md:col-span-3 text-[11px] text-slate-500"><i class="fas fa-info-circle mr-1"></i>Para <b>${metodo}</b> no se requieren datos bancarios adicionales.</div>`;
        }
        bloqueDatosPortal.innerHTML = html;
        bloqueDatosPortal.classList.remove('hidden');
        if (dp && typeof dp === 'object') {
            if (metodo === 'PAGO MÓVIL') {
                set('pvBancoMovil', (dp.codigo && dp.banco) ? dp.codigo + ' · ' + dp.banco : (dp.banco || ''));
                set('pvTlfMovil', dp.telefono || dp.dato || '');
                set('pvTitularMovil', dp.titular || '');
                set('pvCedulaMovil', dp.cedula_rif || '');
            } else {
                set('pvTipoCuenta', dp.tipo_cuenta);
                set('pvNumeroCuenta', dp.numero_cuenta ? (dp.codigo ? String(dp.numero_cuenta).replace(dp.codigo, '') : dp.numero_cuenta) : dp.numero_cuenta);
                set('pvTitular', dp.titular);
                set('pvTipoContacto', dp.tipo_contacto);
                set('pvDatoContacto', dp.dato);
                set('pvIdBinance', dp.id_binance);
            }
        }
    }

    function leerDatosPortal() {
        const metodo = metodoPortal.value;
        if (!metodo) return null;
        if (metodo === 'PAGO MÓVIL') {
            const [codigo, ...resto] = val('pvBancoMovil').split(' · ');
            return {
                banco: resto.join(' · '), codigo, tipo_cuenta: 'PAGO MÓVIL',
                telefono: val('pvTlfMovil'), titular: val('pvTitularMovil'), cedula_rif: val('pvCedulaMovil')
            };
        }
        if (clubUI.esBancoVzla(metodo)) {
            const [codigo, ...resto] = metodo.split(' · ');
            const numero = val('pvNumeroCuenta');
            return {
                banco: resto.join(' · '), codigo,
                tipo_cuenta: val('pvTipoCuenta'),
                numero_cuenta: (numero && codigo === '0157') ? codigo + numero : numero,
                titular: val('pvTitular')
            };
        }
        if (metodo === 'ZELLE' || metodo === 'BINANCE') {
            const d = { tipo_contacto: val('pvTipoContacto') || 'correo', dato: val('pvDatoContacto') };
            if (metodo === 'BINANCE') d.id_binance = val('pvIdBinance') || null;
            return d;
        }
        return {};
    }

    metodoPortal.addEventListener('change', () => renderBloqueDatosPortal(metodoPortal.value, null));

    let perfilSembrado = false;
    function sembrarPerfil(data) {
        if (perfilSembrado) return;
        perfilSembrado = true;
        const tel = clubUI.desglosarTelefono(data.telefono);
        cpPortal.value = data.codigo_pais || tel.codigo || '+58';
        tfPortal.value = tel.numero;
        set('emailPortal', data.email || '');
        set('cedulaPortal', data.cedula_rif || '');
        set('direccionPortal', data.direccion || '');
        metodoPortal.value = data.metodo_pago || '';
        renderBloqueDatosPortal(metodoPortal.value, data.datos_pago);
    }

    document.getElementById('btnActualizarDatos').addEventListener('click', async () => {
        const nuevoMetodo = metodoPortal.value;
        if (!nuevoMetodo) return clubUI.toast('Seleccione su método de pago.', 'warning');
        if ((nuevoMetodo === 'ZELLE' || nuevoMetodo === 'BINANCE') && !val('pvDatoContacto')) return clubUI.toast('Indique el correo o teléfono para ' + nuevoMetodo + '.', 'warning');
        if (clubUI.esBancoVzla(nuevoMetodo) && !val('pvNumeroCuenta')) return clubUI.toast('Indique el número de cuenta.', 'warning');
        if (nuevoMetodo === 'PAGO MÓVIL') {
            if (!val('pvBancoMovil')) return clubUI.toast('Seleccione el banco del pago móvil.', 'warning');
            if (!val('pvTlfMovil')) return clubUI.toast('Indique el teléfono vinculado al pago móvil.', 'warning');
        }

        const datos = {
            telefono: clubUI.componerTelefono(cpPortal.value, tfPortal.value) || null,
            codigo_pais: cpPortal.value,
            email: val('emailPortal').trim() || null,
            cedula_rif: val('cedulaPortal').trim().toUpperCase() || null,
            direccion: val('direccionPortal').trim() || null,
            metodo_pago: nuevoMetodo,
            datos_pago: leerDatosPortal()
        };

        const btn = document.getElementById('btnActualizarDatos');
        btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Enviando...';

        const { error } = await window.supabase.from('notificaciones').insert([{
            tipo: 'portal_datos',
            titulo: 'Actualización de datos desde el portal',
            mensaje: `${sesion.nombre} solicitó actualizar sus datos (teléfono/email/método de pago).`,
            cliente_id: sesion.id,
            cliente_nombre: sesion.nombre,
            datos: datos,
            estado: 'Nueva'
        }]);

        btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane mr-2"></i> Solicitar Actualización';

        if (error) return clubUI.toast('Error al enviar la solicitud: ' + (error.message || 'BD'), 'error');

        document.getElementById('portalMsgDatos').classList.remove('hidden');
        clubUI.toast('Solicitud enviada. El administrador la revisará y aplicará.', 'success');
    });

    // ==========================================
    // ARRANQUE
    // ==========================================
    const arranque = sesionGuardada();
    if (arranque && arranque.id) {
        sesion = arranque;
        entrarAlPortal();
    }

    btnEntrar.addEventListener('click', async () => {
        const token = inputToken.value.trim().toUpperCase();
        const clave = inputClave.value.trim();
        if (!token || !clave) return clubUI.toast("Ingrese su código y contraseña.", 'warning');

        const { data, error } = await window.supabase
            .from('clientes')
            .select('id, nombre, seudonimo, grupo_id')
            .eq('portal_token', token)
            .eq('portal_clave', clave)
            .eq('portal_habilitado', true)
            .maybeSingle();

        if (error || !data) {
            return clubUI.toast("Código, contraseña o acceso inválido. Solicite su enlace al administrador.", 'error');
        }
        sesion = { id: data.id, nombre: data.nombre, seudonimo: data.seudonimo, grupo_id: data.grupo_id };
        guardarSesion(sesion);
        entrarAlPortal();
    });

    btnCerrar.addEventListener('click', cerrarSesion);

    // ==========================================
    // ENTRAR AL PORTAL
    // ==========================================
    async function entrarAlPortal() {
        pantallaAcceso.classList.add('hidden');
        vistaPortal.classList.remove('hidden');
        document.getElementById('portalNombre').textContent = sesion.seudonimo || sesion.nombre;
        await refrescarCompleto();
        setInterval(refrescarAutomatico, 30000);
    }

    async function refrescarCompleto() {
        await Promise.all([
            cargarCliente(),
            cargarMovimientos(),
            cargarSolicitudes()
        ]);
    }

    async function refrescarAutomatico() {
        if (!sesion) return;
        await cargarCliente();
        await cargarMovimientos();
        await cargarSolicitudes();
        cargarTablasDisponibles(true);
    }

    // ==========================================
    // CLIENTE Y KPIs
    // ==========================================
    async function cargarCliente() {
        const { data, error } = await window.supabase
            .from('clientes')
            .select('*')
            .eq('id', sesion.id)
            .single();
        if (error || !data) return;
        clienteDatos = data;
        sembrarPerfil(data);

        // Tasa global para el equivalente en Bs
        try {
            const { data: m } = await window.supabase.from('monedas').select('tasa_cambio').limit(1).single();
            if (m && m.tasa_cambio) tasaGlobal = parseFloat(m.tasa_cambio);
        } catch (e) { /* nada */ }

        const saldo = parseFloat(data.saldo_actual || 0);
        const aval = parseFloat(data.aval || 0);
        const modo = data.modo_juego || (data.libre ? 'libre' : 'aval');
        document.getElementById('kpiSaldo').textContent = '$' + clubUI.formatoNumero(saldo, 2);
        document.getElementById('kpiIncentivo').textContent = clubUI.formatoNumero(parseFloat(data.devolucion || 0), 2) + '%';
        const msjModo = modo === 'pozo'
            ? 'Cuenta de pozo: recarga antes de jugar'
            : modo === 'libre'
                ? 'Juega libre'
                : 'Juega con modalidad de cuenta';
        document.getElementById('kpiLibre').textContent = msjModo;
        document.getElementById('kpiDisponible').textContent = '$' + clubUI.formatoNumero((saldo + aval), 2);

        // Saldo equivalente a la tasa de cuadre del cliente (o tasa global)
        const tasaCuadre = parseFloat(data.tasa_cuadre || 0) || tasaGlobal;
        document.getElementById('kpiSaldoEquiv').textContent = '≈ Bs ' + clubUI.formatoNumero((saldo * tasaCuadre), 2);

        // Grupo
        const { data: g } = await window.supabase.from('grupos_venta').select('nombre, moneda, moneda_cuadre').eq('id', data.grupo_id).maybeSingle();
        if (g) {
            grupoDatos = g;
            document.getElementById('portalGrupo').textContent = g.nombre;
            document.getElementById('portalMonedaCuadre').textContent = g.moneda_cuadre || g.moneda || 'USD';
        }
    }

    // ==========================================
    // MOVIMIENTOS
    // ==========================================
    async function cargarMovimientos() {
        const { data } = await window.supabase
            .from('tickets_apuestas')
            .select('created_at, nombre_jugada, caballo, cantidad_tablas, monto_jugado, premio_pagar, premio_por_tabla, moneda, estado')
            .eq('cliente_juega_id', sesion.id)
            .order('created_at', { ascending: false })
            .limit(30);

        const cuerpo = document.getElementById('cuerpoMovimientos');
        if (!data || data.length === 0) {
            cuerpo.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-slate-500 italic">Aún no tiene movimientos.</td></tr>';
            return;
        }

        cuerpo.innerHTML = data.map(tk => {
            const fecha = tk.created_at ? new Date(tk.created_at).toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' }) : '—';
            const simp = tk.moneda === 'VES' ? 'Bs ' : '$';
            const badge = {
                Ganador: 'bg-emerald-100 text-emerald-700',
                Perdedor: 'bg-slate-100 text-slate-500',
                Pendiente: 'bg-amber-100 text-amber-700'
            }[tk.estado] || 'bg-slate-100 text-slate-500';
            const premio = tk.premio_pagar != null && tk.premio_por_tabla == null
                ? parseFloat(tk.premio_pagar)
                : (tk.premio_pagar != null ? parseFloat(tk.premio_pagar) : 0);
            return `
                <tr class="hover:bg-cyan-50">
                    <td class="p-3 text-slate-500">${fecha}</td>
                    <td class="p-3 font-bold text-slate-700">${tk.nombre_jugada || 'Jugada'}</td>
                    <td class="p-3">${tk.caballo || '-'}${tk.cantidad_tablas ? ` (${tk.cantidad_tablas} tablas)` : ''}</td>
                    <td class="p-3 text-right font-mono font-bold">${simp}${clubUI.formatoNumero(parseFloat(tk.monto_jugado || 0), 2)}</td>
                    <td class="p-3 text-right font-mono font-bold text-emerald-600">${simp}${clubUI.formatoNumero(premio, 2)}</td>
                    <td class="p-3 text-center"><span class="px-2 py-0.5 rounded text-[9px] font-black ${badge}">${tk.estado}</span></td>
                </tr>`;
        }).join('');
    }

    // ==========================================
    // TABLAS DISPONIBLES PARA SU GRUPO
    // ==========================================
    async function cargarTablasDisponibles(soloSiVacio = false) {
        if (soloSiVacio && selectTabla.value) return;
        const { data } = await window.supabase
            .from('tablas_fijas')
            .select('*, tabla_grupos(*)')
            .eq('estado', 'Abierta')
            .order('id', { ascending: false });

        tablasDisponibles = (data || []).filter(t => {
            const tg = (t.tabla_grupos || []).find(x => x.grupo_id == sesion.grupo_id);
            return tg && (tg.cupos - (tg.cantidad_vendida || 0)) > 0;
        });

        selectTabla.innerHTML = tablasDisponibles.length === 0
            ? '<option value="">No hay carreras disponibles ahora</option>'
            : '<option value="">Seleccione hipódromo / carrera...</option>';

        tablasDisponibles.forEach(t => {
            const tg = (t.tabla_grupos || []).find(x => x.grupo_id == sesion.grupo_id);
            const disp = (tg.cupos || 0) - (tg.cantidad_vendida || 0);
            selectTabla.innerHTML += `<option value="${t.id}">${t.hipodromo} - Carrera ${t.carrera} (disponibles: ${disp})</option>`;
        });
    }

    selectTabla.addEventListener('change', () => {
        const t = tablasDisponibles.find(x => x.id == selectTabla.value);
        tablaSeleccionada = t || null;
        selectEjemplar.innerHTML = '<option value="">Seleccione ejemplar...</option>';
        if (!t) return;
        (t.caballos || []).filter(c => !c.retirado).forEach(c => {
            selectEjemplar.innerHTML += `<option value="${c.numero}">${c.numero} - ${c.nombre} (${c.valor_ejemplar} pts)</option>`;
        });
        actualizarTotalPagar();
    });

    selectEjemplar.addEventListener('change', actualizarTotalPagar);
    inputCantidad.addEventListener('input', actualizarTotalPagar);

    function actualizarTotalPagar() {
        if (!tablaSeleccionada || !selectEjemplar.value) { lblTotalPagar.textContent = '$0.00'; return; }
        const ej = (tablaSeleccionada.caballos || []).find(c => c.numero == selectEjemplar.value);
        const cant = parseInt(inputCantidad.value) || 1;
        const grupo = grupoDatos || { moneda: 'USD' };
        const simb = grupo.moneda === 'VES' ? 'Bs ' : '$';
        const total = (parseFloat(ej.valor_ejemplar) || 0) * cant;
        lblTotalPagar.textContent = simb + clubUI.formatoNumero(total, 2);
    }

    // ==========================================
    // ENVIAR SOLICITUD DE COMPRA
    // ==========================================
    btnSolicitar.addEventListener('click', async () => {
        if (!tablaSeleccionada) return clubUI.toast("Seleccione la carrera que desea comprar.", 'warning');
        if (!selectEjemplar.value) return clubUI.toast("Seleccione el ejemplar.", 'warning');

        const tg = (tablaSeleccionada.tabla_grupos || []).find(x => x.grupo_id == sesion.grupo_id);
        const cant = parseInt(inputCantidad.value) || 0;
        const disponibles = (tg.cupos || 0) - (tg.cantidad_vendida || 0);
        if (cant <= 0) return clubUI.toast("Cantidad inválida.", 'warning');
        if (cant > disponibles) return clubUI.toast(`Solo quedan ${disponibles} tablas disponibles en su grupo.`, 'warning');

        const ej = (tablaSeleccionada.caballos || []).find(c => c.numero == selectEjemplar.value);
        const pts = parseFloat(ej.valor_ejemplar) || 0;
        const moneda = (grupoDatos && grupoDatos.moneda) || 'USD';
        const montoTotal = pts * cant;
        const costoUsd = moneda === 'VES' ? montoTotal / (tasaGlobal || 1) : montoTotal;
        const premio = parseFloat(tablaSeleccionada.premio_recalculado) || 0;

        btnSolicitar.disabled = true;
        btnSolicitar.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Enviando...';

        const vida = clienteDatos || (await (await window.supabase.from('clientes').select('*').eq('id', sesion.id).single())).data || {};

        const { error } = await window.supabase.from('solicitudes_tablas').insert([{
            cliente_id: sesion.id,
            cliente_nombre: sesion.nombre,
            grupo_id: sesion.grupo_id,
            grupo_nombre: grupoDatos ? grupoDatos.nombre : null,
            tabla_id: tablaSeleccionada.id,
            hipodromo: tablaSeleccionada.hipodromo,
            carrera: tablaSeleccionada.carrera,
            ejemplar_numero: ej.numero,
            ejemplar_nombre: ej.nombre,
            cantidad: cant,
            pts_ejemplar: pts,
            premio_por_tabla: premio,
            comision_porcentaje: parseFloat(tablaSeleccionada.comision_grupo || 2.5),
            moneda: moneda,
            tasa_cambio: tasaGlobal,
            monto_total: montoTotal,
            costo_usd: costoUsd,
            estado: 'Pendiente',
            recibo: `SOL-${tablaSeleccionada.hipodromo}-C${tablaSeleccionada.carrera}-${ej.numero}-${Date.now().toString(36).toUpperCase()}`
        }]);

        btnSolicitar.disabled = false;
        btnSolicitar.innerHTML = '<i class="fas fa-paper-plane mr-2"></i> Solicitar Compra';

        if (error) return clubUI.toast('Error al enviar la solicitud: ' + (error.message || 'BD'), 'error');

        msgCompra.classList.remove('hidden');
        clubUI.toast('Solicitud enviada. Será validada por el administrador y se le enviará el recibo.', 'success');
        inputCantidad.value = 1;
        selectEjemplar.innerHTML = '<option value="">Primero seleccione la carrera</option>';
        selectEjemplar.value = '';
        tablaSeleccionada = null;
        selectTabla.value = '';
        cargarSolicitudes();
    });

    // ==========================================
    // MIS SOLICITUDES
    // ==========================================
    async function cargarSolicitudes() {
        const { data } = await window.supabase
            .from('solicitudes_tablas')
            .select('*')
            .eq('cliente_id', sesion.id)
            .order('created_at', { ascending: false })
            .limit(20);

        const cuerpo = document.getElementById('cuerpoSolicitudes');
        if (!data || data.length === 0) {
            cuerpo.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-slate-500 italic">No tiene solicitudes pendientes.</td></tr>';
            return;
        }

        const badges = {
            Pendiente: 'bg-amber-100 text-amber-700',
            Aprobada: 'bg-emerald-100 text-emerald-700',
            Rechazada: 'bg-red-100 text-red-600'
        };

        cuerpo.innerHTML = data.map(s => {
            const fecha = s.created_at ? new Date(s.created_at).toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' }) : '—';
            const simp = s.moneda === 'VES' ? 'Bs ' : '$';
            const badge = badges[s.estado] || 'bg-slate-100 text-slate-500';
            const ext = s.estado === 'Aprobada' && s.recibo ? ` · <span class="text-[9px]">Recibo: ${s.recibo}</span>` : '';
            return `
                <tr class="hover:bg-amber-50">
                    <td class="p-3 text-slate-500">${fecha}</td>
                    <td class="p-3 font-bold text-slate-700">${s.hipodromo} C${s.carrera}</td>
                    <td class="p-3">${s.ejemplar_numero} - ${s.ejemplar_nombre}</td>
                    <td class="p-3 text-right font-bold">${s.cantidad}</td>
                    <td class="p-3 text-right font-mono font-bold">${simp}${clubUI.formatoNumero(parseFloat(s.monto_total || 0), 2)}</td>
                    <td class="p-3 text-center"><span class="px-2 py-0.5 rounded text-[9px] font-black ${badge}">${s.estado}</span>${ext}</td>
                </tr>`;
        }).join('');
    }

    // Inicial
    cargarTablasDisponibles();
});