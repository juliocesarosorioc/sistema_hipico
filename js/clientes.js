document.addEventListener('DOMContentLoaded', () => {

    const tbody = document.getElementById('cuerpoTablaClientes');
    const formNuevo = document.getElementById('formNuevoCliente');
    const formEditar = document.getElementById('formEditarCliente');
    const selectSocio = document.getElementById('socioCliente');
    
    // Modales y Botones
    const modalEditar = document.getElementById('modalEditarCliente');
    const modalDevoluciones = document.getElementById('modalDevoluciones');
    const buscador = document.getElementById('buscadorClientes');
    const btnRecargar = document.getElementById('btnRecargarClientes');
    const btnAbrirDev = document.getElementById('btnAbrirDevoluciones');
    const btnEjecutarDev = document.getElementById('btnEjecutarDevolucion');
    
    // Acordeón Socios
    const btnAcordeon = document.getElementById('btnAcordeonSocios');
    const panelSocios = document.getElementById('panelSocios');
    const iconoAcordeon = document.getElementById('iconoAcordeon');
    const btnCrearSocio = document.getElementById('btnCrearSocio');

    let clientesGlobales = [];
    let clientesFiltrados = [];

    // ==========================================
    // HELPERS: campos reales de la tabla y teléfono válido
    // (evita errores 400 al enviar columnas inexistentes o "" a columnas numéricas)
    // ==========================================
    const columnasReales = () => {
        const fila = clientesGlobales[0];
        return fila ? new Set(Object.keys(fila)) : null;
    };
    const soloColumnasExistentes = (payload) => {
        const cols = columnasReales();
        if (!cols) return payload;
        return Object.fromEntries(Object.entries(payload).filter(([k]) => cols.has(k)));
    };
    const telefonoValido = (t) => {
        const dig = String(t || '').replace(/\D/g, '');
        return dig ? dig : null;
    };
    const numeroValido = (v) => {
        const n = parseFloat(v);
        return isNaN(n) ? 0 : n;
    };

    // ==========================================
    // 0. SELECTS COMPARTIDOS Y DATOS DE PAGO
    // ==========================================
    const val = (id) => document.getElementById(id)?.value ?? '';
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v ?? ''; };

    document.getElementById('codigoPaisNuevo').innerHTML = clubUI.htmlOpcionesCodigoPais('+58');
    document.getElementById('editCodigoPais').innerHTML = clubUI.htmlOpcionesCodigoPais('+58');
    document.getElementById('metodoPagoCliente').innerHTML = '<option value="">— Seleccione —</option>' + clubUI.htmlOpcionesMetodos();
    document.getElementById('editMetodoPago').innerHTML = '<option value="">— Seleccione —</option>' + clubUI.htmlOpcionesMetodos();

    // Bloque dinámico según el método de pago elegido
    function renderBloqueDatosPago(pref, metodo, dp) {
        const cont = document.getElementById(pref === 'nuevo' ? 'bloqueDatosPagoNuevo' : 'bloqueDatosPagoEditar');
        if (!metodo) { cont.classList.add('hidden'); cont.innerHTML = ''; return; }

        const lbl = 'block text-[10px] font-bold text-slate-600 mb-1 uppercase tracking-wider';
        const inp = 'w-full border border-emerald-300 rounded-lg px-3 py-2 text-xs outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 bg-white';
        const dis = inp + ' bg-emerald-50 font-bold text-emerald-800 cursor-not-allowed';

        let html;
        if (clubUI.esBancoVzla(metodo)) {
            const [codigo, ...resto] = metodo.split(' · ');
            const nombre = resto.join(' · ');
            html = `
                <div>
                    <label class="${lbl}">Banco (predeterminado)</label>
                    <input id="${pref}BancoNombre" readonly value="${nombre}" class="${dis}">
                </div>
                <div>
                    <label class="${lbl}">Código SUDEBAN</label>
                    <input id="${pref}BancoCodigo" readonly value="${codigo}" class="${dis}">
                </div>
                <div>
                    <label class="${lbl}">Tipo de Cuenta</label>
                    <select id="${pref}TipoCuenta" class="${inp} font-bold">
                        <option>CORRIENTE</option><option>AHORRO</option>
                    </select>
                </div>
                <div>
                    <label class="${lbl}">Número de Cuenta</label>
                    <input id="${pref}NumeroCuenta" inputmode="numeric" placeholder="01020330445566778890" class="${inp} font-mono">
                </div>
                <div>
                    <label class="${lbl}">Titular (nombre en la cuenta)</label>
                    <input id="${pref}Titular" class="${inp} uppercase">
                </div>`;
        } else if (metodo === 'ZELLE' || metodo === 'BINANCE') {
            html = `
                <div>
                    <label class="${lbl}">Tipo de dato</label>
                    <select id="${pref}TipoContacto" class="${inp} font-bold">
                        <option value="correo">Correo electrónico</option>
                        <option value="telefono">Número de teléfono</option>
                    </select>
                </div>
                <div class="${pref === 'nuevo' ? 'md:col-span-2' : ''}">
                    <label class="${lbl}">Dato de ${metodo} (correo o teléfono)</label>
                    <input id="${pref}DatoContacto" placeholder="${metodo === 'ZELLE' ? 'ej. correo@mail.com o +1 555 123 4567' : 'ID o correo vinculado a Binance'}" class="${inp}">
                </div>
                ${metodo === 'BINANCE' ? `
                <div>
                    <label class="${lbl}">ID / UID de Binance (opcional)</label>
                    <input id="${pref}IdBinance" class="${inp}">
                </div>` : ''}`;
        } else {
            html = `<div class="${pref === 'nuevo' ? 'md:col-span-3' : 'col-span-2'} text-[11px] text-slate-500"><i class="fas fa-info-circle mr-1"></i>Para <b>${metodo}</b> no se requieren datos bancarios adicionales.</div>`;
        }

        cont.innerHTML = html;
        cont.classList.remove('hidden');

        if (dp && typeof dp === 'object') {
            set(`${pref}TipoCuenta`, dp.tipo_cuenta);
            set(`${pref}NumeroCuenta`, dp.numero_cuenta);
            set(`${pref}Titular`, dp.titular);
            set(`${pref}TipoContacto`, dp.tipo_contacto);
            set(`${pref}DatoContacto`, dp.dato);
            set(`${pref}IdBinance`, dp.id_binance);
        }
    }

    function leerDatosPago(pref, metodo) {
        if (!metodo) return null;
        if (clubUI.esBancoVzla(metodo)) {
            const [codigo, ...resto] = metodo.split(' · ');
            return {
                banco: resto.join(' · '), codigo,
                tipo_cuenta: val(`${pref}TipoCuenta`),
                numero_cuenta: val(`${pref}NumeroCuenta`),
                titular: val(`${pref}Titular`)
            };
        }
        if (metodo === 'ZELLE' || metodo === 'BINANCE') {
            const dp = { tipo_contacto: val(`${pref}TipoContacto`) || 'correo', dato: val(`${pref}DatoContacto`) };
            if (metodo === 'BINANCE') dp.id_binance = val(`${pref}IdBinance`) || null;
            return dp;
        }
        return {};
    }

    document.getElementById('metodoPagoCliente').addEventListener('change', (e) => renderBloqueDatosPago('nuevo', e.target.value, null));
    document.getElementById('editMetodoPago').addEventListener('change', (e) => renderBloqueDatosPago('editar', e.target.value, null));

    // ==========================================
    // 1. CARGA DE CLIENTES (DB REAL)
    // ==========================================
    async function cargarClientes() {
        tbody.innerHTML = '<tr><td colspan="12" class="p-6 text-center text-slate-500"><i class="fas fa-spinner fa-spin mr-2"></i>Cargando...</td></tr>';

        const { data, error } = await window.supabase.from('clientes').select('*').order('nombre');

        if (error) {
            tbody.innerHTML = '<tr><td colspan="12" class="p-6 text-center text-red-500">Error conectando a la BD.</td></tr>';
            return;
        }

        clientesGlobales = data || [];
        clientesFiltrados = [...clientesGlobales];
        actualizarSelectSocios();
        renderizarTabla(clientesFiltrados);
    }

    function actualizarSelectSocios() {
        const socios = clientesGlobales.filter(c => c.es_socio === true);
        const opciones = socios.map(s => `<option value="${s.nombre}">${s.nombre}</option>`).join('');
        if (selectSocio) selectSocio.innerHTML = '<option value="">— Ninguno (Directo) —</option>' + opciones;
        const editSocio = document.getElementById('editSocio');
        if (editSocio) editSocio.innerHTML = '<option value="">— Ninguno (Directo) —</option>' + opciones;
    }

    // ==========================================
    // 2. RENDERIZADO DE TABLA
    // ==========================================
    function renderizarTabla(lista) {
        tbody.innerHTML = '';
        if (lista.length === 0) {
            tbody.innerHTML = '<tr><td colspan="12" class="p-6 text-center text-slate-500">No hay registros.</td></tr>';
            document.getElementById('pag-cuerpoTablaClientes')?.remove();
            return;
        }

        const filasHtml = lista.map(c => {
            const badgeLibre = c.libre ? '<span class="text-emerald-600 font-bold">SÍ</span>' : '<span class="text-slate-400">NO</span>';
            const badgeMS = c.mostrar_saldo_socio ? '<i class="fas fa-eye text-blue-500" title="Visible al socio"></i>' : '<i class="fas fa-eye-slash text-slate-300" title="Oculto"></i>';
            const socioLabel = c.socio_asignado || '<span class="text-slate-400 italic">Directo</span>';

            const countAfiliados = clientesGlobales.filter(sub => sub.socio_asignado === c.nombre).length;
            const afiliadoLabel = c.es_socio
                ? `<span class="bg-amber-100 text-amber-800 px-2 rounded font-bold">Agencia (${countAfiliados})</span>`
                : `<span class="text-slate-400">-</span>`;

            const saldo = parseFloat(c.saldo_actual || 0);
            const aval = parseFloat(c.aval || 0);
            const dev = parseFloat(c.devolucion || 0);

            const colorS = saldo < 0 ? 'text-red-600' : 'text-emerald-600';

            const pagoResumen = window.clubUI.resumenDatosPago(c.datos_pago);
            const cuadreLabel = `
                <span class="text-[10px] font-bold">${c.dia_cuadre || '<span class="text-slate-400 italic">Sin día</span>'}</span>
                <span class="text-[9px] text-emerald-600 block">${c.metodo_pago || '—'}${pagoResumen ? ' · ' + pagoResumen : ''}${parseFloat(c.tasa_cuadre || 0) > 0 ? ' · Tasa ' + c.tasa_cuadre : ''}</span>
            `;

            const portalLabel = c.portal_habilitado
                ? `<button class="btn-portal bg-cyan-100 text-cyan-700 hover:bg-cyan-200 p-1.5 rounded transition-colors" data-id="${c.id}" title="Ver enlace del portal"><i class="fas fa-link"></i></button>`
                : `<button class="btn-portal bg-slate-200 text-slate-500 hover:bg-cyan-100 hover:text-cyan-700 p-1.5 rounded transition-colors" data-id="${c.id}" title="Generar enlace del portal"><i class="fas fa-link"></i></button>`;

            return `
                <tr class="hover:bg-blue-50 border-b border-slate-100">
                    <td class="p-2 font-bold text-slate-800">${c.nombre}</td>
                    <td class="p-2 text-slate-500 font-mono">${c.telefono || '-'}</td>
                    <td class="p-2 text-center">${badgeLibre}</td>
                    <td class="p-2 text-right font-mono font-bold ${colorS}">$${clubUI.formatoNumero(saldo, 2)}</td>
                    <td class="p-2 text-right font-mono text-amber-600" title="Límite de pérdida (no es saldo)">$${clubUI.formatoNumero(aval, 2)}</td>
                    <td class="p-2 text-right font-mono text-purple-600" title="Incentivo a buenos jugadores (cuenta individual)">${clubUI.formatoNumero(dev, 2)}%</td>
                    <td class="p-2 text-center">${badgeMS}</td>
                    <td class="p-2 font-medium text-slate-600">${socioLabel}</td>
                    <td class="p-2">${afiliadoLabel}</td>
                    <td class="p-2">${cuadreLabel}</td>
                    <td class="p-2 text-center">${portalLabel}</td>
                    <td class="p-2 text-center flex gap-1 justify-center">
                        <button class="btn-editar bg-slate-200 text-slate-600 hover:text-blue-600 hover:bg-blue-100 p-1.5 rounded transition-colors" data-id="${c.id}"><i class="fas fa-edit"></i></button>
                        <button class="btn-eliminar bg-slate-200 text-slate-600 hover:text-red-600 hover:bg-red-100 p-1.5 rounded transition-colors" data-id="${c.id}"><i class="fas fa-trash-alt"></i></button>
                    </td>
                </tr>
            `;
        });

        clubUI.paginar(tbody, filasHtml, 25, (paginaHtml) => {
            tbody.innerHTML = paginaHtml.join('');
            asignarEventosFila();
        });
    }

    // ==========================================
    // 3. EVENTOS UI (Acordeón, Buscador)
    // ==========================================
    btnAcordeon?.addEventListener('click', () => {
        panelSocios.classList.toggle('hidden');
        iconoAcordeon.classList.toggle('rotate-180');
    });

    buscador?.addEventListener('input', (e) => {
        const txt = e.target.value.toLowerCase();
        clientesFiltrados = clientesGlobales.filter(c => c.nombre.toLowerCase().includes(txt) || (c.telefono && c.telefono.includes(txt)));
        renderizarTabla(clientesFiltrados);
    });

    btnRecargar?.addEventListener('click', () => { buscador.value = ''; cargarClientes(); });

    // ==========================================
    // 4. CREAR SOCIO EXPRESS
    // ==========================================
    btnCrearSocio?.addEventListener('click', async () => {
        const inp = document.getElementById('nombreNuevoSocio');
        const nombre = inp.value.trim().toUpperCase();
        if(!nombre) return;
        
        btnCrearSocio.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        const existente = clientesGlobales.find(c => String(c.nombre).toUpperCase() === nombre);
        let error = null;

        if (existente) {
            // Ya existe: CONVERTIR al registro en Socio (no crear duplicado)
            ({ error } = await window.supabase.from('clientes')
                .update({ es_socio: true }).eq('id', existente.id));
        } else {
            // No existe: registra el nuevo Socio/Agencia
            ({ error } = await window.supabase.from('clientes')
                .insert([soloColumnasExistentes({ nombre: nombre, es_socio: true })]));
        }
        
        if(!error) { inp.value = ''; cargarClientes(); }
        else { clubUI.toast('Error al crear socio: ' + error.message, 'error'); }
        btnCrearSocio.innerHTML = 'Convertir a Socio';
        if (!error && window.clubDB?.logAccion) window.clubDB.logAccion('CLIENTES', `socio_convertido: ${nombre}`);
    });

    // ==========================================
    // 5. NUEVO CLIENTE Y EDICIÓN
    // ==========================================
    formNuevo?.addEventListener('submit', async function(e) {
        e.preventDefault();
        const btn = this.querySelector('button[type="submit"]');
        btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

        const nombre = document.getElementById('nombreCliente').value.trim().toUpperCase();
        if (clientesGlobales.some(c => String(c.nombre).toUpperCase() === nombre)) {
            clubUI.toast('Ya existe un cliente con ese nombre.', 'error');
            btn.innerHTML = 'Agregar'; btn.disabled = false;
            return;
        }

        const { error } = await window.supabase.from('clientes').insert([soloColumnasExistentes({
            nombre: nombre,
            telefono: clubUI.componerTelefono(document.getElementById('codigoPaisNuevo').value, document.getElementById('telefonoCliente').value) || null,
            codigo_pais: document.getElementById('codigoPaisNuevo').value,
            email: document.getElementById('emailCliente').value.trim() || null,
            cedula_rif: document.getElementById('cedulaRifCliente').value.trim().toUpperCase() || null,
            aval: numeroValido(document.getElementById('avalCliente').value),
            devolucion: numeroValido(document.getElementById('devolucionCliente').value),
            libre: document.getElementById('libreCliente').value === 'true',
            socio_asignado: document.getElementById('socioCliente').value || null,
            mostrar_saldo_socio: document.getElementById('checkMostrarS').checked,
            metodo_pago: document.getElementById('metodoPagoCliente').value || null,
            dia_cuadre: document.getElementById('diaCuadreCliente').value || null,
            forma_cuadre: document.getElementById('formaCuadreCliente').value || null,
            tasa_cuadre: numeroValido(document.getElementById('tasaCuadreCliente').value),
            datos_pago: leerDatosPago('nuevo', document.getElementById('metodoPagoCliente').value),
            es_socio: false
        })]);

        if (error) clubUI.toast('Error al registrar: ' + error.message, 'error');
        else { this.reset(); cargarClientes(); if (window.clubDB?.logAccion) window.clubDB.logAccion('CLIENTES', `creado: ${nombre}`); }
        btn.innerHTML = 'Agregar'; btn.disabled = false;
    });

    function asignarEventosFila() {
        document.querySelectorAll('.btn-editar').forEach(b => {
            b.addEventListener('click', function() {
                const c = clientesGlobales.find(x => x.id == this.dataset.id);
                if (c) {
                    const tel = clubUI.desglosarTelefono(c.telefono);
                    document.getElementById('editId').value = c.id;
                    document.getElementById('editNombre').value = c.nombre;
                    set('editCodigoPais', tel.codigo);
                    document.getElementById('editNumeroTelefono').value = tel.numero;
                    document.getElementById('editEmail').value = c.email || '';
                    document.getElementById('editCedulaRif').value = c.cedula_rif || '';
                    document.getElementById('editAval').value = c.aval;
                    document.getElementById('editDevolucion').value = c.devolucion;
                    document.getElementById('editLibre').value = c.libre ? 'true' : 'false';
                    document.getElementById('editSocio').value = c.socio_asignado || '';
                    document.getElementById('editMostrarS').value = c.mostrar_saldo_socio ? 'true' : 'false';
                    document.getElementById('editMetodoPago').value = c.metodo_pago || '';
                    renderBloqueDatosPago('editar', c.metodo_pago || '', c.datos_pago);
                    document.getElementById('editDiaCuadre').value = c.dia_cuadre || '';
                    document.getElementById('editFormaCuadre').value = c.forma_cuadre || '';
                    document.getElementById('editTasaCuadre').value = parseFloat(c.tasa_cuadre || 0);
                    modalEditar.classList.remove('hidden');
                }
            });
        });

        document.querySelectorAll('.btn-eliminar').forEach(b => {
            b.addEventListener('click', async function() {
                if(confirm("¿Eliminar definitivamente? Se perderán sus saldos.")) {
                    const { error } = await window.supabase.from('clientes').delete().eq('id', this.dataset.id);
                    if (error) return clubUI.toast('Error al eliminar: ' + error.message, 'error');
                    const c = clientesGlobales.find(x => x.id == this.dataset.id);
                    cargarClientes();
                    if (window.clubDB?.logAccion) window.clubDB.logAccion('CLIENTES', `eliminado: ${c?.nombre} (id=${this.dataset.id})`);
                }
            });
        });

        document.querySelectorAll('.btn-portal').forEach(b => {
            b.addEventListener('click', function() {
                abrirModalPortal(this.dataset.id);
            });
        });
    }

    formEditar?.addEventListener('submit', async function(e) {
        e.preventDefault();
        const id = document.getElementById('editId').value;
        const { error } = await window.supabase.from('clientes').update(soloColumnasExistentes({
            nombre: document.getElementById('editNombre').value.trim().toUpperCase(),
            telefono: clubUI.componerTelefono(document.getElementById('editCodigoPais').value, document.getElementById('editNumeroTelefono').value) || null,
            codigo_pais: document.getElementById('editCodigoPais').value,
            email: document.getElementById('editEmail').value.trim() || null,
            cedula_rif: document.getElementById('editCedulaRif').value.trim().toUpperCase() || null,
            aval: numeroValido(document.getElementById('editAval').value),
            devolucion: numeroValido(document.getElementById('editDevolucion').value),
            libre: document.getElementById('editLibre').value === 'true',
            socio_asignado: document.getElementById('editSocio').value || null,
            mostrar_saldo_socio: document.getElementById('editMostrarS').value === 'true',
            metodo_pago: document.getElementById('editMetodoPago').value || null,
            dia_cuadre: document.getElementById('editDiaCuadre').value || null,
            forma_cuadre: document.getElementById('editFormaCuadre').value || null,
            tasa_cuadre: numeroValido(document.getElementById('editTasaCuadre').value),
            datos_pago: leerDatosPago('editar', document.getElementById('editMetodoPago').value)
        })).eq('id', id);
        if (error) return clubUI.toast('Error al actualizar: ' + error.message, 'error');
        modalEditar.classList.add('hidden');
        cargarClientes();
        const c = clientesGlobales.find(x => x.id == id);
        if (window.clubDB?.logAccion) window.clubDB.logAccion('CLIENTES', `editado: ${c?.nombre} (id=${id})`);
    });

    // ==========================================
    // 6. PORTAL DE CONSULTA DEL CLIENTE
    // ==========================================
    const generarCodigo = (n = 6) => {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let s = '';
        for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
        return s;
    };

    const urlPortal = () => {
        const base = window.location.href.split('/html/')[0] + '/html/portal.html';
        return base;
    };

    function abrirModalPortal(id) {
        const c = clientesGlobales.find(x => x.id == id);
        if (!c) return;
        document.getElementById('portalClienteId').value = id;
        document.getElementById('portalClienteNombre').textContent = c.nombre;
        document.getElementById('portalHabilitado').checked = !!c.portal_habilitado;

        // Código y clave: si ya existen se conservan; si no, se generan nuevos
        const token = c.portal_token || generarCodigo(6);
        const clave = c.portal_clave || generarCodigo(4);
        document.getElementById('portalToken').value = token;
        document.getElementById('portalClave').value = clave;

        actualizarLinksPortal();
        document.getElementById('portalRecibidoMsg').textContent =
            c.portal_habilitado ? 'El cliente ya tiene acceso; puede regenerar el código y la contraseña.' : '';
        document.getElementById('modalPortalCliente').classList.remove('hidden');
    }

    function actualizarLinksPortal() {
        const id = document.getElementById('portalClienteId').value;
        const token = document.getElementById('portalToken').value;
        const clave = document.getElementById('portalClave').value;
        const larga = `${urlPortal()}?c=${id}&k=${encodeURIComponent(token)}`;
        document.getElementById('portalLinkLargo').value = larga;
        document.getElementById('portalLinkCorto').value = 'Generando enlace corto...';
        document.getElementById('portalLinkCorto').classList.add('text-cyan-700');

        // Intentar acortar con is.gd (fallback: mostrar el enlace completo)
        fetch('https://is.gd/create.php?format=simple&url=' + encodeURIComponent(larga))
            .then(r => r.ok ? r.text() : Promise.reject())
            .then(txt => {
                const limpio = String(txt).trim();
                if (limpio.startsWith('http')) document.getElementById('portalLinkCorto').value = limpio;
                else document.getElementById('portalLinkCorto').value = larga;
            })
            .catch(() => { document.getElementById('portalLinkCorto').value = larga; });
    }

    document.getElementById('btnRegenerarToken')?.addEventListener('click', () => {
        document.getElementById('portalToken').value = generarCodigo(6);
        actualizarLinksPortal();
    });
    document.getElementById('btnRegenerarClave')?.addEventListener('click', () => {
        document.getElementById('portalClave').value = generarCodigo(4);
        actualizarLinksPortal();
    });

    document.querySelectorAll('.btn-copiar-link')?.forEach(b => b.addEventListener('click', () => {
        const input = document.getElementById(b.dataset.input);
        const texto = input ? input.value : '';
        if (!texto) return;
        if (navigator.clipboard?.writeText) navigator.clipboard.writeText(texto);
        clubUI.toast('Enlace copiado al portapapeles.', 'success');
    }));

    document.getElementById('btnGuardarPortal')?.addEventListener('click', async () => {
        const id = document.getElementById('portalClienteId').value;
        const habilitado = document.getElementById('portalHabilitado').checked;
        const { error } = await window.supabase.from('clientes').update(soloColumnasExistentes({
            portal_habilitado: habilitado,
            portal_token: document.getElementById('portalToken').value,
            portal_clave: document.getElementById('portalClave').value
        })).eq('id', id);
        if (error) return clubUI.toast('Error al guardar el portal: ' + error.message, 'error');
        const c = clientesGlobales.find(x => x.id == id);
        if (window.clubDB?.logAccion) window.clubDB.logAccion('CLIENTES', `portal_${habilitado ? 'habilitado' : 'deshabilitado'}: ${c?.nombre} (id=${id})`);
        clubUI.toast('Portal guardado. Entregue el enlace y la contraseña al cliente.', 'success');
        document.getElementById('modalPortalCliente').classList.add('hidden');
        cargarClientes();
    });

    // ==========================================
    // 7. REPORTE DE CUADRE SEMANAL
    // ==========================================
    document.getElementById('btnGenerarReporteCuadre')?.addEventListener('click', () => {
        const dia = document.getElementById('filtroDiaCuadre').value;
        const cuerpo = document.getElementById('cuerpoReporteCuadre');
        const totalSpan = document.getElementById('totalCuadreReporte');

        const lista = clientesGlobales.filter(c => !dia || c.dia_cuadre === dia);

        if (lista.length === 0) {
            cuerpo.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-slate-500 italic">Ningún cliente cuadra ese día.</td></tr>';
            totalSpan.textContent = '';
            return;
        }

        cuerpo.innerHTML = lista.map(c => {
            const tasa = parseFloat(c.tasa_cuadre || 0);
            const saldo = parseFloat(c.saldo_actual || 0);
            const debeTasa = tasa > 0 ? saldo * tasa : 0;
            return `
                <tr class="hover:bg-emerald-50">
                    <td class="p-2.5 font-bold text-slate-800">${c.nombre}</td>
                    <td class="p-2.5 font-bold text-emerald-700">${c.dia_cuadre || '-'}</td>
                    <td class="p-2.5">${c.metodo_pago || '<span class="text-slate-400 italic">—</span>'}</td>
                    <td class="p-2.5">${c.forma_cuadre || '<span class="text-slate-400 italic">—</span>'}</td>
                    <td class="p-2.5 text-right font-mono font-bold">${tasa > 0 ? clubUI.formatoNumero(tasa, 2) : '-'}</td>
                    <td class="p-2.5 text-right font-mono font-bold ${saldo < 0 ? 'text-red-600' : 'text-emerald-600'}">$${clubUI.formatoNumero(saldo, 2)}</td>
                    <td class="p-2.5 text-right font-mono font-bold text-amber-600">${tasa > 0 ? 'Bs ' + clubUI.formatoNumero(debeTasa, 2) : '-'}</td>
                </tr>`;
        }).join('');

        totalSpan.textContent = `${lista.length} cliente(s)`;
        if (window.clubDB?.logAccion) window.clubDB.logAccion('CLIENTES', `reporte_cuadre: dia=${dia || 'todos'} clientes=${lista.length}`);
    });

    // ==========================================
    // 8. DEVOLUCIONES MASIVAS
    // ==========================================
    btnAbrirDev?.addEventListener('click', () => {
        document.getElementById('inputDevolucionMasiva').value = '';
        modalDevoluciones.classList.remove('hidden');
    });

    btnEjecutarDev?.addEventListener('click', async () => {
        const val = parseFloat(document.getElementById('inputDevolucionMasiva').value);
        if(isNaN(val)) return clubUI.toast("Ingrese un valor numérico.");
        
        if(!confirm(`¿Aplicar ${val}% de devolución a los ${clientesFiltrados.length} clientes en pantalla?`)) return;

        btnEjecutarDev.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        const ids = clientesFiltrados.map(c => c.id);
        
        const { error } = await window.supabase.from('clientes').update({ devolucion: val }).in('id', ids);
        modalDevoluciones.classList.add('hidden');
        if (error) return clubUI.toast('Error al aplicar devolución: ' + error.message, 'error');
        cargarClientes();
        btnEjecutarDev.innerHTML = 'Aplicar a Todos';
        if (window.clubDB?.logAccion) window.clubDB.logAccion('CLIENTES', `devolucion_masiva: ${val}% a ${ids.length} clientes`);
    });

    // ==========================================
    // 9. NOTIFICACIONES DEL PORTAL (ADMIN)
    // ==========================================
    let notificacionesGlobales = [];
    const cuerpoNotif = document.getElementById('cuerpoNotificaciones');
    const contadorNotif = document.getElementById('contadorNotif');

    function resumenNotificacion(n) {
        const d = n.datos || {};
        const partes = [];
        const etiqueta = (k) => ({ telefono: 'Tlf', email: 'Email', cedula_rif: 'Cédula/RIF', direccion: 'Dirección', metodo_pago: 'Método', codigo_pais: 'País' }[k] || k);
        [['telefono', 'email', 'cedula_rif', 'direccion', 'metodo_pago']].forEach(keys => keys.forEach(k => { if (d[k]) partes.push(`<b>${etiqueta(k)}:</b> ${d[k]}`); }));
        if (d.datos_pago && typeof d.datos_pago === 'object') {
            const r = clubUI.resumenDatosPago(d.datos_pago);
            if (r) partes.push(`<b>Detalle pago:</b> ${r}`);
        }
        if (partes.length === 0) partes.push(n.mensaje || 'Solicitud de actualización de datos.');
        return partes.join(' · ');
    }

    async function cargarNotificaciones() {
        const { data, error } = await window.supabase
            .from('notificaciones').select('*').order('created_at', { ascending: false }).limit(40);

        if (error) {
            cuerpoNotif.innerHTML = '<tr><td colspan="5" class="p-6 text-center text-slate-500 italic">Ejecute sql/pagos_vzla.sql para activar las notificaciones.</td></tr>';
            return;
        }
        notificacionesGlobales = data || [];

        const nuevas = notificacionesGlobales.filter(x => x.estado === 'Nueva').length;
        contadorNotif.classList.toggle('hidden', nuevas === 0);
        contadorNotif.textContent = nuevas;

        if (notificacionesGlobales.length === 0) {
            cuerpoNotif.innerHTML = '<tr><td colspan="5" class="p-6 text-center text-slate-500 italic">Sin notificaciones. Cuando un cliente pida cambios desde su portal, aparecerán aquí.</td></tr>';
            return;
        }

        const badges = { Nueva: 'bg-amber-100 text-amber-700', Aplicada: 'bg-emerald-100 text-emerald-700', Ignorada: 'bg-slate-200 text-slate-500' };

        cuerpoNotif.innerHTML = notificacionesGlobales.map(n => {
            const fecha = n.created_at ? new Date(n.created_at).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '—';
            const acciones = n.estado === 'Nueva'
                ? `<div class="flex gap-1 justify-center">
                        <button class="btn-aplicar-notif bg-emerald-600 text-white px-2 py-1 rounded text-[10px] font-black hover:bg-emerald-700" data-id="${n.id}" title="Aplicar los datos al cliente"><i class="fas fa-check"></i> Aplicar</button>
                        <button class="btn-ignorar-notif bg-slate-200 text-slate-600 px-2 py-1 rounded text-[10px] font-black hover:bg-slate-300" data-id="${n.id}" title="Ignorar la solicitud"><i class="fas fa-times"></i></button>
                    </div>`
                : `<span class="text-slate-300">—</span>`;
            return `
                <tr class="hover:bg-amber-50 ${n.estado === 'Nueva' ? 'bg-amber-50/40' : 'opacity-70'}">
                    <td class="p-2.5 text-slate-500 whitespace-nowrap">${fecha}</td>
                    <td class="p-2.5 font-bold text-slate-800">${n.cliente_nombre}</td>
                    <td class="p-2.5 text-[10px] text-slate-600 max-w-[420px]">${resumenNotificacion(n)}</td>
                    <td class="p-2.5 text-center"><span class="px-2 py-0.5 rounded text-[9px] font-black ${badges[n.estado]}">${n.estado}</span></td>
                    <td class="p-2.5 text-center">${acciones}</td>
                </tr>`;
        }).join('');

        document.querySelectorAll('.btn-aplicar-notif').forEach(b => b.addEventListener('click', () => aplicarNotificacion(b.dataset.id)));
        document.querySelectorAll('.btn-ignorar-notif').forEach(b => b.addEventListener('click', () => ignorarNotificacion(b.dataset.id)));
    }

    async function aplicarNotificacion(id) {
        const n = notificacionesGlobales.find(x => x.id == id);
        if (!n || n.estado !== 'Nueva') return;
        if (!confirm(`Aplicar los datos del portal al cliente ${n.cliente_nombre}? Esto actualizará su teléfono, email, cédula/RIF y método de pago.`)) return;

        const d = n.datos || {};
        const payload = {};
        if (d.telefono) payload.telefono = d.telefono;
        if (d.codigo_pais) payload.codigo_pais = d.codigo_pais;
        if (d.email) payload.email = d.email;
        if (d.cedula_rif) payload.cedula_rif = d.cedula_rif;
        if (d.direccion) payload.direccion = d.direccion;
        if (d.metodo_pago) payload.metodo_pago = d.metodo_pago;
        if (d.datos_pago) payload.datos_pago = d.datos_pago;

        const sesionS = window.clubAuth ? window.clubAuth.getSesion() : null;
        const { error } = await window.supabase.from('clientes').update(soloColumnasExistentes(payload)).eq('id', n.cliente_id);
        if (error) return clubUI.toast('Error al aplicar: ' + error.message, 'error');

        await window.supabase.from('notificaciones').update({
            estado: 'Aplicada', atendida_por: sesionS ? sesionS.nombre : 'Admin', atendida_at: new Date().toISOString()
        }).eq('id', id);

        clubUI.toast('Datos aplicados al cliente.', 'success');
        if (window.clubDB?.logAccion) window.clubDB.logAccion('CLIENTES', `notificacion_aplicada: ${n.cliente_nombre} (id=${id})`);
        cargarNotificaciones();
        cargarClientes();
    }

    async function ignorarNotificacion(id) {
        const n = notificacionesGlobales.find(x => x.id == id);
        if (!n) return;
        const sesionS = window.clubAuth ? window.clubAuth.getSesion() : null;
        await window.supabase.from('notificaciones').update({
            estado: 'Ignorada', atendida_por: sesionS ? sesionS.nombre : 'Admin', atendida_at: new Date().toISOString()
        }).eq('id', id);
        clubUI.toast('Solicitud ignorada.', 'warning');
        cargarNotificaciones();
    }

    document.getElementById('btnRecargarNotif')?.addEventListener('click', cargarNotificaciones);

    document.querySelectorAll('.cerrar-modal').forEach(b => {
        b.addEventListener('click', () => {
            modalEditar.classList.add('hidden');
            modalDevoluciones.classList.add('hidden');
            document.getElementById('modalPortalCliente').classList.add('hidden');
        });
    });

    cargarClientes();
    cargarNotificaciones();
});