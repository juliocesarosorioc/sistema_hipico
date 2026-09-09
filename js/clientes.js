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
        tbody.innerHTML = '<tr><td colspan="11" class="p-6 text-center text-slate-500"><i class="fas fa-spinner fa-spin mr-2"></i>Cargando...</td></tr>';
        
        const { data, error } = await window.supabase.from('clientes').select('*').order('nombre');

        if (error) {
            tbody.innerHTML = '<tr><td colspan="11" class="p-6 text-center text-red-500">Error conectando a la BD.</td></tr>';
            return;
        }

        clientesGlobales = data || [];
        clientesFiltrados = [...clientesGlobales];
        actualizarSelectSocios();
        renderizarTabla(clientesFiltrados);
    }

    function actualizarSelectSocios() {
        const socios = clientesGlobales.filter(c => c.es_socio === true);
        selectSocio.innerHTML = '<option value="">— Ninguno (Directo) —</option>';
        socios.forEach(s => {
            selectSocio.innerHTML += `<option value="${s.nombre}">${s.nombre}</option>`;
        });
    }

    // ==========================================
    // 2. RENDERIZADO DE TABLA
    // ==========================================
    function renderizarTabla(lista) {
        tbody.innerHTML = '';
        if (lista.length === 0) {
            tbody.innerHTML = '<tr><td colspan="11" class="p-6 text-center text-slate-500">No hay registros.</td></tr>';
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

            return `
                <tr class="hover:bg-blue-50 border-b border-slate-100">
                    <td class="p-2 font-bold text-slate-800">${c.nombre}</td>
                    <td class="p-2 text-slate-500 font-mono">${c.telefono || '-'}</td>
                    <td class="p-2 text-center">${badgeLibre}</td>
                    <td class="p-2 text-center font-bold">${parseFloat(c.comision || 0)}%</td>
                    <td class="p-2 text-right font-mono font-bold ${colorS}">$${saldo.toFixed(2)}</td>
                    <td class="p-2 text-right font-mono text-amber-600">$${aval.toFixed(2)}</td>
                    <td class="p-2 text-right font-mono text-purple-600">${dev.toFixed(2)}%</td>
                    <td class="p-2 text-center">${badgeMS}</td>
                    <td class="p-2 font-medium text-slate-600">${socioLabel}</td>
                    <td class="p-2">${afiliadoLabel}</td>
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
            comision: numeroValido(document.getElementById('comisionCliente').value),
            libre: document.getElementById('libreCliente').value === 'true',
            socio_asignado: document.getElementById('socioCliente').value || null,
            mostrar_saldo_socio: document.getElementById('checkMostrarS').checked,
            es_socio: false
        })]);

        if (error) clubUI.toast('Error al registrar: ' + error.message, 'error');
        else { this.reset(); cargarClientes(); }
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
                    document.getElementById('editComision').value = c.comision;
                    document.getElementById('editLibre').value = c.libre ? 'true' : 'false';
                    document.getElementById('editMostrarS').value = c.mostrar_saldo_socio ? 'true' : 'false';
                    modalEditar.classList.remove('hidden');
                }
            });
        });

        document.querySelectorAll('.btn-eliminar').forEach(b => {
            b.addEventListener('click', async function() {
                if(confirm("¿Eliminar definitivamente? Se perderán sus saldos.")) {
                    const { error } = await window.supabase.from('clientes').delete().eq('id', this.dataset.id);
                    if (error) return clubUI.toast('Error al eliminar: ' + error.message, 'error');
                    cargarClientes();
                }
            });
        });
    }

    formEditar?.addEventListener('submit', async function(e) {
        e.preventDefault();
        const id = document.getElementById('editId').value;
        const { error } = await window.supabase.from('clientes').update(soloColumnasExistentes({
            nombre: document.getElementById('editNombre').value.trim().toUpperCase(),
            telefono: telefonoValido(document.getElementById('editTelefono').value),
            comision: numeroValido(document.getElementById('editComision').value),
            libre: document.getElementById('editLibre').value === 'true',
            mostrar_saldo_socio: document.getElementById('editMostrarS').value === 'true'
        })).eq('id', id);
        if (error) return clubUI.toast('Error al actualizar: ' + error.message, 'error');
        modalEditar.classList.add('hidden');
        cargarClientes();
    });

    // ==========================================
    // 6. DEVOLUCIONES MASIVAS
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
    });

    document.querySelectorAll('.cerrar-modal').forEach(b => {
        b.addEventListener('click', () => {
            modalEditar.classList.add('hidden');
            modalDevoluciones.classList.add('hidden');
        });
    });

    cargarClientes();
});