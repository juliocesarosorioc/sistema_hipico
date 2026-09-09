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

            const cuadreLabel = `
                <span class="text-[10px] font-bold">${c.dia_cuadre || '<span class="text-slate-400 italic">Sin día</span>'}</span>
                <span class="text-[9px] text-emerald-600 block">${c.metodo_pago || ''}${parseFloat(c.tasa_cuadre || 0) > 0 ? ` · Tasa ${c.tasa_cuadre}` : ''}</span>
            `;

            const portalLabel = c.portal_habilitado
                ? `<button class="btn-portal bg-cyan-100 text-cyan-700 hover:bg-cyan-200 p-1.5 rounded transition-colors" data-id="${c.id}" title="Ver enlace del portal"><i class="fas fa-link"></i></button>`
                : `<button class="btn-portal bg-slate-200 text-slate-500 hover:bg-cyan-100 hover:text-cyan-700 p-1.5 rounded transition-colors" data-id="${c.id}" title="Generar enlace del portal"><i class="fas fa-link"></i></button>`;

            return `
                <tr class="hover:bg-blue-50 border-b border-slate-100">
                    <td class="p-2 font-bold text-slate-800">${c.nombre}</td>
                    <td class="p-2 text-slate-500 font-mono">${c.telefono || '-'}</td>
                    <td class="p-2 text-center">${badgeLibre}</td>
                    <td class="p-2 text-right font-mono font-bold ${colorS}">$${saldo.toFixed(2)}</td>
                    <td class="p-2 text-right font-mono text-amber-600" title="Límite de pérdida (no es saldo)">$${aval.toFixed(2)}</td>
                    <td class="p-2 text-right font-mono text-purple-600" title="Incentivo a buenos jugadores (cuenta individual)">${dev.toFixed(2)}%</td>
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
            telefono: telefonoValido(document.getElementById('telefonoCliente').value),
            aval: numeroValido(document.getElementById('avalCliente').value),
            devolucion: numeroValido(document.getElementById('devolucionCliente').value),
            libre: document.getElementById('libreCliente').value === 'true',
            socio_asignado: document.getElementById('socioCliente').value || null,
            mostrar_saldo_socio: document.getElementById('checkMostrarS').checked,
            metodo_pago: document.getElementById('metodoPagoCliente').value || null,
            dia_cuadre: document.getElementById('diaCuadreCliente').value || null,
            forma_cuadre: document.getElementById('formaCuadreCliente').value || null,
            tasa_cuadre: numeroValido(document.getElementById('tasaCuadreCliente').value),
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
                    document.getElementById('editId').value = c.id;
                    document.getElementById('editNombre').value = c.nombre;
                    document.getElementById('editTelefono').value = c.telefono || '';
                    document.getElementById('editAval').value = c.aval;
                    document.getElementById('editDevolucion').value = c.devolucion;
                    document.getElementById('editLibre').value = c.libre ? 'true' : 'false';
                    document.getElementById('editSocio').value = c.socio_asignado || '';
                    document.getElementById('editMostrarS').value = c.mostrar_saldo_socio ? 'true' : 'false';
                    document.getElementById('editMetodoPago').value = c.metodo_pago || '';
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
            telefono: telefonoValido(document.getElementById('editTelefono').value),
            aval: numeroValido(document.getElementById('editAval').value),
            devolucion: numeroValido(document.getElementById('editDevolucion').value),
            libre: document.getElementById('editLibre').value === 'true',
            socio_asignado: document.getElementById('editSocio').value || null,
            mostrar_saldo_socio: document.getElementById('editMostrarS').value === 'true',
            metodo_pago: document.getElementById('editMetodoPago').value || null,
            dia_cuadre: document.getElementById('editDiaCuadre').value || null,
            forma_cuadre: document.getElementById('editFormaCuadre').value || null,
            tasa_cuadre: numeroValido(document.getElementById('editTasaCuadre').value)
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
                    <td class="p-2.5 text-right font-mono font-bold">${tasa > 0 ? tasa.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '-'}</td>
                    <td class="p-2.5 text-right font-mono font-bold ${saldo < 0 ? 'text-red-600' : 'text-emerald-600'}">$${saldo.toFixed(2)}</td>
                    <td class="p-2.5 text-right font-mono font-bold text-amber-600">${tasa > 0 ? 'Bs ' + debeTasa.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '-'}</td>
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

    document.querySelectorAll('.cerrar-modal').forEach(b => {
        b.addEventListener('click', () => {
            modalEditar.classList.add('hidden');
            modalDevoluciones.classList.add('hidden');
            document.getElementById('modalPortalCliente').classList.add('hidden');
        });
    });

    cargarClientes();
});