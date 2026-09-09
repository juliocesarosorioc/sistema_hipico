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
    let clientesFiltrados = []; // Necesario para devoluciones masivas

    // ==========================================
    // 1. CARGAR LISTA DE CLIENTES Y SOCIOS
    // ==========================================
    async function cargarClientes() {
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="11" class="p-6 text-center text-slate-500"><i class="fas fa-spinner fa-spin mr-2"></i>Cargando datos...</td></tr>';
        
        const { data, error } = await window.supabase
            .from('clientes')
            .select('*')
            .order('nombre', { ascending: true });

        if (error) {
            console.error("Error BD:", error);
            tbody.innerHTML = '<tr><td colspan="11" class="p-6 text-center text-red-500">Error de conexión.</td></tr>';
            return;
        }

        clientesGlobales = data || [];
        clientesFiltrados = [...clientesGlobales];
        actualizarSelectSocios();
        renderizarTabla(clientesFiltrados);
    }

    // Llena el <select> del formulario con los clientes que son Socios
    function actualizarSelectSocios() {
        const socios = clientesGlobales.filter(c => c.es_socio === true);
        selectSocio.innerHTML = '<option value="">— Ninguno (Directo) —</option>';
        socios.forEach(s => {
            selectSocio.innerHTML += `<option value="${s.nombre}">${s.nombre}</option>`;
        });
    }

    // ==========================================
    // 2. DIBUJAR LA TABLA DE CLIENTES
    // ==========================================
    function renderizarTabla(lista) {
        tbody.innerHTML = '';
        if (lista.length === 0) {
            tbody.innerHTML = '<tr><td colspan="11" class="p-6 text-center text-slate-500">No hay clientes.</td></tr>';
            return;
        }

        lista.forEach(c => {
            const badgeLibre = c.libre ? '<span class="text-green-600 font-bold">SÍ</span>' : '<span class="text-slate-400">NO</span>';
            const badgeMS = c.mostrar_saldo_socio ? '<i class="fas fa-eye text-blue-500" title="Visible"></i>' : '<i class="fas fa-eye-slash text-slate-300" title="Oculto"></i>';
            const socioLabel = c.socio_asignado || '<span class="text-slate-400 italic">Directo</span>';
            
            // Lógica de Afiliado (Si el cliente es socio, muestra cuántos afiliados tiene debajo)
            const countAfiliados = clientesGlobales.filter(sub => sub.socio_asignado === c.nombre).length;
            const afiliadoLabel = c.es_socio 
                ? `<span class="bg-amber-100 text-amber-700 px-2 py-0.5 rounded font-bold" title="Socio Agencia">Socio (${countAfiliados})</span>`
                : `<span class="text-slate-400">-</span>`;

            // Saldos
            const saldo = parseFloat(c.saldo_actual || 0).toFixed(2);
            const aval = parseFloat(c.aval || 0).toFixed(2);
            const devolucion = parseFloat(c.devolucion || 0).toFixed(2);
            const saldoColor = saldo < 0 ? 'text-red-600' : 'text-emerald-600';

            tbody.innerHTML += `
                <tr class="hover:bg-blue-50 transition-colors border-b border-slate-100">
                    <td class="p-2 font-bold text-slate-800">${c.nombre}</td>
                    <td class="p-2 font-mono text-slate-500">${c.telefono || '-'}</td>
                    <td class="p-2 text-center">${badgeLibre}</td>
                    <td class="p-2 text-center font-mono">${parseFloat(c.comision || 0).toFixed(2)}%</td>
                    <td class="p-2 text-right font-mono font-bold ${saldoColor}">${saldo}</td>
                    <td class="p-2 text-right font-mono text-slate-500">${aval}</td>
                    <td class="p-2 text-right font-mono text-purple-600 font-bold">${devolucion}</td>
                    <td class="p-2 text-center">${badgeMS}</td>
                    <td class="p-2 text-slate-600">${socioLabel}</td>
                    <td class="p-2">${afiliadoLabel}</td>
                    <td class="p-2 text-center flex gap-1 justify-center">
                        <button class="btn-editar text-blue-600 hover:bg-blue-200 px-2 py-1 rounded" data-id="${c.id}"><i class="fas fa-edit"></i></button>
                        <button class="btn-eliminar text-red-600 hover:bg-red-200 px-2 py-1 rounded" data-id="${c.id}"><i class="fas fa-trash-alt"></i></button>
                    </td>
                </tr>
            `;
        });
        asignarEventosFila();
    }

    // ==========================================
    // 3. EVENTOS: ACORDEÓN, BUSCADOR Y RECARGA
    // ==========================================
    btnAcordeon?.addEventListener('click', () => {
        panelSocios.classList.toggle('hidden');
        iconoAcordeon.classList.toggle('rotate-180');
    });

    buscador?.addEventListener('input', (e) => {
        const texto = e.target.value.toLowerCase();
        clientesFiltrados = clientesGlobales.filter(c => 
            c.nombre.toLowerCase().includes(texto) || (c.telefono && c.telefono.includes(texto))
        );
        renderizarTabla(clientesFiltrados);
    });

    btnRecargar?.addEventListener('click', () => { buscador.value = ''; cargarClientes(); });

    // ==========================================
    // 4. CREAR SOCIO EXPRESS
    // ==========================================
    btnCrearSocio?.addEventListener('click', async () => {
        const nombreInput = document.getElementById('nombreNuevoSocio');
        const nombre = nombreInput.value.trim().toUpperCase();
        if(!nombre) return;
        
        btnCrearSocio.disabled = true;
        
        // Creamos al socio como un cliente especial (es_socio = true)
        const payload = { nombre: nombre, es_socio: true, libre: false, comision: 0, saldo_actual: 0 };
        const { error } = await window.supabase.from('clientes').insert([payload]);

        if(!error) {
            document.getElementById('msgSocio').classList.remove('hidden');
            setTimeout(() => document.getElementById('msgSocio').classList.add('hidden'), 3000);
            nombreInput.value = '';
            cargarClientes();
        } else {
            alert("Error al crear socio o nombre duplicado.");
        }
        btnCrearSocio.disabled = false;
    });

    // ==========================================
    // 5. REGISTRAR NUEVO CLIENTE (CON SOCIO)
    // ==========================================
    formNuevo?.addEventListener('submit', async function(e) {
        e.preventDefault();
        const btn = this.querySelector('button[type="submit"]');
        btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

        const payload = {
            nombre: document.getElementById('nombreCliente').value.trim().toUpperCase(),
            telefono: document.getElementById('telefonoCliente').value.trim(),
            comision: parseFloat(document.getElementById('comisionCliente').value || 0),
            libre: document.getElementById('libreCliente').value === 'true',
            socio_asignado: document.getElementById('socioCliente').value || null,
            mostrar_saldo_socio: document.getElementById('checkMostrarS').checked,
            es_socio: false, // Por defecto es cliente final
            saldo_actual: 0, aval: 0, devolucion: 0
        };

        const { error } = await window.supabase.from('clientes').insert([payload]);

        if (error) alert(error.code === '23505' ? "Cliente ya existe." : "Error al registrar.");
        else { this.reset(); cargarClientes(); }

        btn.innerHTML = 'Agregar'; btn.disabled = false;
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
        if(isNaN(val)) return alert("Ingrese un porcentaje válido.");
        
        if(!confirm(`¿Aplicar ${val}% de devolución a los ${clientesFiltrados.length} clientes mostrados en la tabla?`)) return;

        btnEjecutarDev.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Procesando...';
        btnEjecutarDev.disabled = true;

        // Extraer los IDs de los clientes que están en pantalla
        const ids = clientesFiltrados.map(c => c.id);
        
        // Supabase requiere hacer un UPDATE masivo usando "in"
        const { error } = await window.supabase
            .from('clientes')
            .update({ devolucion: val })
            .in('id', ids);

        if(error) {
            alert("Error al aplicar devoluciones masivas: " + error.message);
        } else {
            modalDevoluciones.classList.add('hidden');
            cargarClientes();
        }
        
        btnEjecutarDev.innerHTML = 'Aplicar a Todos';
        btnEjecutarDev.disabled = false;
    });

    // ==========================================
    // 7. EDITAR Y ELIMINAR 
    // ==========================================
    function asignarEventosFila() {
        document.querySelectorAll('.btn-editar').forEach(btn => {
            btn.addEventListener('click', function() {
                const id = this.getAttribute('data-id');
                const c = clientesGlobales.find(x => x.id == id);
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

        document.querySelectorAll('.btn-eliminar').forEach(btn => {
            btn.addEventListener('click', async function() {
                if (confirm("¿Eliminar definitivamente a este cliente?")) {
                    await window.supabase.from('clientes').delete().eq('id', this.getAttribute('data-id'));
                    cargarClientes();
                }
            });
        });
    }

    formEditar?.addEventListener('submit', async function(e) {
        e.preventDefault();
        const id = document.getElementById('editId').value;
        const payload = {
            nombre: document.getElementById('editNombre').value.trim().toUpperCase(),
            telefono: document.getElementById('editTelefono').value.trim(),
            comision: parseFloat(document.getElementById('editComision').value || 0),
            libre: document.getElementById('editLibre').value === 'true',
            mostrar_saldo_socio: document.getElementById('editMostrarS').value === 'true'
        };

        await window.supabase.from('clientes').update(payload).eq('id', id);
        modalEditar.classList.add('hidden');
        cargarClientes();
    });

    document.querySelectorAll('.cerrar-modal').forEach(b => {
        b.addEventListener('click', () => {
            modalEditar.classList.add('hidden');
            modalDevoluciones.classList.add('hidden');
        });
    });

    cargarClientes();
});