// Archivo: js/remates.js
// Propósito: Motor financiero de subastas, SPA y gestión de BD Supabase para Remates.

document.addEventListener('DOMContentLoaded', () => {

    // Referencias de navegación SPA
    const vistaLista = document.getElementById('vistaLista');
    const vistaDetalle = document.getElementById('vistaDetalle');
    const btnVolverLista = document.getElementById('btnVolverLista');
    
    // Referencias de datos base
    let clientesGlobal = [];
    let hipodromosGlobal = [];
    let remateActivo = null; // Guardará el objeto del remate que estamos viendo
    let caballosDelRemate = []; // Lista de pujas actuales

    document.getElementById('remateFecha').value = new Date().toISOString().split('T')[0];

    // ==========================================
    // 1. CARGA INICIAL (Clientes e Hipódromos)
    // ==========================================
    async function inicializarModulo() {
        // Cargar Clientes
        const { data: clientes } = await supabase.from('clientes').select('id, nombre').order('nombre');
        if (clientes) {
            clientesGlobal = clientes;
            let options = '<option value="">— Seleccione Cliente —</option>';
            clientes.forEach(c => options += `<option value="${c.id}">${c.nombre}</option>`);
            document.getElementById('asigCliente').innerHTML = options;
        }

        // Cargar Hipódromos
        const { data: hipodromos } = await supabase.from('hipodromos').select('id, nombre').order('nombre');
        if (hipodromos) {
            hipodromosGlobal = hipodromos;
            let options = '<option value="">— Seleccione Hipódromo —</option>';
            hipodromos.forEach(h => options += `<option value="${h.id}">${h.nombre}</option>`);
            document.getElementById('remateHipodromo').innerHTML = options;
        }

        cargarListaRemates();
    }

    // ==========================================
    // 2. LISTAR REMATES
    // ==========================================
    async function cargarListaRemates() {
        const tbody = document.getElementById('listaRematesTbody');
        tbody.innerHTML = '<tr><td colspan="8" class="p-4 text-center">Cargando datos...</td></tr>';

        const { data: remates } = await supabase
            .from('remates')
            .select(`*, hipodromos(nombre)`)
            .order('fecha_registro', { ascending: false });

        if (!remates || remates.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="p-4 text-center text-slate-500">No hay remates registrados.</td></tr>';
            return;
        }

        tbody.innerHTML = '';
        remates.forEach(r => {
            const hipodromo = r.hipodromos ? r.hipodromos.nombre : '—';
            // Para calcular el subtotal real deberíamos sumar los caballos, pero lo dejaremos visual hasta abrir el detalle
            
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-slate-50';
            tr.innerHTML = `
                <td class="p-3 font-bold text-slate-800">${r.nombre}</td>
                <td class="p-3">${hipodromo}</td>
                <td class="p-3 text-center">${r.carrera || '—'}</td>
                <td class="p-3">${r.fecha || '—'}</td>
                <td class="p-3 text-center text-slate-400">Ver dentro</td>
                <td class="p-3 text-right font-medium text-slate-400">Calcular dentro</td>
                <td class="p-3 text-center"><span class="bg-emerald-600 text-white px-2 py-0.5 rounded text-[10px] font-bold uppercase">${r.estado}</span></td>
                <td class="p-3 text-center flex gap-1 justify-center">
                    <button class="btn-entrar-remate bg-cyan-500 text-white px-3 py-1 rounded text-[11px] font-bold shadow hover:bg-cyan-600 transition-colors" data-id="${r.id}"><i class="fas fa-chart-bar mr-1"></i> Ver</button>
                    <button class="btn-eliminar-remate bg-red-500 text-white px-3 py-1 rounded text-[11px] font-bold shadow hover:bg-red-600 transition-colors" data-id="${r.id}"><i class="fas fa-trash-alt"></i></button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        // Eventos SPA: Entrar a detalle
        document.querySelectorAll('.btn-entrar-remate').forEach(btn => {
            btn.addEventListener('click', function() {
                const id = this.getAttribute('data-id');
                abrirDetalleRemate(id);
            });
        });

        // Evento: Eliminar Remate
        document.querySelectorAll('.btn-eliminar-remate').forEach(btn => {
            btn.addEventListener('click', async function() {
                if(confirm("¿Seguro que desea eliminar TODO el remate y sus caballos asignados?")) {
                    await supabase.from('remates').delete().eq('id', this.getAttribute('data-id'));
                    cargarListaRemates();
                }
            });
        });
    }

    // ==========================================
    // 3. CREAR NUEVO REMATE
    // ==========================================
    document.getElementById('formNuevoRemate')?.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const btn = this.querySelector('button[type="submit"]');
        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creando...'; btn.disabled = true;

        const payload = {
            nombre: document.getElementById('remateNombre').value.trim().toUpperCase(),
            hipodromo_id: document.getElementById('remateHipodromo').value,
            carrera: document.getElementById('remateCarrera').value,
            fecha: document.getElementById('remateFecha').value,
            hora_cierre: document.getElementById('remateCierre').value,
            distancia: document.getElementById('remateDistancia').value,
            comision_pct: parseFloat(document.getElementById('remateComision').value) || 20,
            notas: document.getElementById('remateNotas').value
        };

        const { error } = await supabase.from('remates').insert([payload]);
        if (error) clubUI.toast("Error al crear remate.");
        else {
            this.reset();
            document.getElementById('modalNuevoRemate').classList.add('hidden');
            cargarListaRemates();
        }
        
        btn.innerHTML = originalText; btn.disabled = false;
    });

    // ==========================================
    // 4. SPA: ABRIR DETALLE DEL REMATE
    // ==========================================
    async function abrirDetalleRemate(id) {
        vistaLista.classList.add('vista-oculta');
        vistaDetalle.classList.remove('vista-oculta');
        document.getElementById('cuerpoCaballos').innerHTML = '<tr><td colspan="7" class="p-8 text-center text-slate-500">Cargando...</td></tr>';

        // 1. Cargar info del Remate
        const { data: remate } = await supabase.from('remates').select(`*, hipodromos(nombre)`).eq('id', id).single();
        remateActivo = remate;

        document.getElementById('detalleNombre').innerHTML = `<i class="fas fa-bell text-amber-500 mr-2"></i> ${remate.nombre}`;
        document.getElementById('infoHipodromo').textContent = remate.hipodromos ? remate.hipodromos.nombre : '—';
        document.getElementById('infoCarrera').textContent = remate.carrera;
        document.getElementById('infoFecha').textContent = remate.fecha;
        document.getElementById('infoCierre').textContent = remate.hora_cierre || '—';
        document.getElementById('infoDistancia').textContent = remate.distancia || '—';
        document.getElementById('infoNotas').textContent = remate.notas || 'Sin configuración especial.';
        document.getElementById('lblComision').textContent = `Comisión (${remate.comision_pct}%)`;
        document.getElementById('inputIncentivo').value = remate.incentivo;

        cargarCaballosDelRemate();
    }

    btnVolverLista?.addEventListener('click', () => {
        vistaDetalle.classList.add('vista-oculta');
        vistaLista.classList.remove('vista-oculta');
        remateActivo = null;
    });

    // ==========================================
    // 5. MOTOR FINANCIERO Y CARGA DE CABALLOS
    // ==========================================
    async function cargarCaballosDelRemate() {
        const tbody = document.getElementById('cuerpoCaballos');
        const { data: caballos } = await supabase
            .from('remate_caballos')
            .select(`*, clientes(nombre)`)
            .eq('remate_id', remateActivo.id)
            .order('numero', { ascending: true });

        caballosDelRemate = caballos || [];

        if (caballosDelRemate.length === 0) {
            tbody.innerHTML = '<tr id="filaVaciaCaballos"><td colspan="7" class="p-8 text-center text-slate-500 bg-slate-50">No hay caballos asignados aún.</td></tr>';
            recalcularFinanzas();
            return;
        }

        tbody.innerHTML = '';
        caballosDelRemate.forEach(c => {
            const clienteStr = c.clientes ? c.clientes.nombre : 'DESCONOCIDO';
            tbody.innerHTML += `
                <tr class="hover:bg-slate-50 bg-white">
                    <td class="p-3 text-center font-bold text-slate-500">${c.numero}</td>
                    <td class="p-3 font-bold text-slate-800">${c.nombre}</td>
                    <td class="p-3 text-blue-600 font-bold">${clienteStr}</td>
                    <td class="p-3 text-right font-bold text-emerald-700">$${Number(c.monto_usd).toFixed(2)}</td>
                    <td class="p-3 text-center font-mono text-xs">${Number(c.prob_porcentaje).toFixed(2)}%</td>
                    <td class="p-3 text-center font-mono text-xs">${Number(c.prob_implicita).toFixed(2)}</td>
                    <td class="p-3 text-center">
                        <button class="btn-eliminar-caballo text-slate-400 hover:text-red-500" data-id="${c.id}"><i class="fas fa-trash-alt"></i></button>
                    </td>
                </tr>
            `;
        });

        recalcularFinanzas();

        // Eliminar caballo
        document.querySelectorAll('.btn-eliminar-caballo').forEach(btn => {
            btn.addEventListener('click', async function() {
                await supabase.from('remate_caballos').delete().eq('id', this.getAttribute('data-id'));
                cargarCaballosDelRemate();
            });
        });
    }

    function recalcularFinanzas() {
        if (!remateActivo) return;

        // Sumar pujas
        const subtotal = caballosDelRemate.reduce((acc, obj) => acc + Number(obj.monto_usd), 0);
        const incentivo = parseFloat(document.getElementById('inputIncentivo').value) || 0;
        
        const totalBruto = subtotal + incentivo;
        const descuentoComision = totalBruto * (Number(remateActivo.comision_pct) / 100);
        const premioGanador = totalBruto - descuentoComision;

        document.getElementById('valCaballos').textContent = caballosDelRemate.length;
        document.getElementById('valSubtotal').textContent = `$${subtotal.toFixed(2)}`;
        document.getElementById('valIncentivo').textContent = `+$${incentivo.toFixed(2)}`;
        document.getElementById('valBruto').textContent = `$${totalBruto.toFixed(2)}`;
        document.getElementById('valComision').textContent = `-$${descuentoComision.toFixed(2)}`;
        document.getElementById('valPremio').textContent = `$${premioGanador.toFixed(2)}`;
    }

    // Guardar incentivo
    document.getElementById('btnGuardarIncentivo')?.addEventListener('click', async () => {
        const inc = parseFloat(document.getElementById('inputIncentivo').value) || 0;
        await supabase.from('remates').update({ incentivo: inc }).eq('id', remateActivo.id);
        remateActivo.incentivo = inc;
        recalcularFinanzas();
    });

    // ==========================================
    // 6. ASIGNAR CABALLOS (Individual y Masivo)
    // ==========================================
    // Individual
    document.getElementById('formAsignarCaballo')?.addEventListener('submit', async function(e) {
        e.preventDefault();
        const payload = {
            remate_id: remateActivo.id,
            numero: document.getElementById('asigNum').value,
            monto_usd: document.getElementById('asigMonto').value,
            nombre: document.getElementById('asigNombre').value.trim().toUpperCase(),
            cliente_id: document.getElementById('asigCliente').value
        };
        await supabase.from('remate_caballos').insert([payload]);
        
        this.reset();
        document.getElementById('modalAsignarCaballo').classList.add('hidden');
        cargarCaballosDelRemate();
    });

    // Modales comunes
    document.querySelectorAll('.cerrar-modal').forEach(boton => {
        boton.addEventListener('click', function() { this.closest('.fixed.z-50').classList.add('hidden'); });
    });

    document.getElementById('btnAbrirModalRemate')?.addEventListener('click', () => document.getElementById('modalNuevoRemate').classList.remove('hidden'));
    document.getElementById('btnAbrirAsignar')?.addEventListener('click', () => document.getElementById('modalAsignarCaballo').classList.remove('hidden'));
    
    // Generador Masivo
    const cuerpoGenerar = document.getElementById('cuerpoGenerarCaballos');
    
    function agregarFilaGenerador(numero) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="p-2 text-center font-bold text-slate-500">${numero}</td>
            <td class="p-2"><input type="text" class="w-full border border-slate-300 rounded px-2 py-1 outline-none text-sm uppercase input-nombre-gen"></td>
            <td class="p-2"><input type="number" step="0.01" value="0" class="w-full border border-slate-300 rounded px-2 py-1 outline-none text-sm text-right input-monto-gen"></td>
            <td class="p-2 text-center"><button class="text-red-500" onclick="this.closest('tr').remove()"><i class="fas fa-trash-alt"></i></button></td>
        `;
        cuerpoGenerar.appendChild(tr);
    }

    document.getElementById('btnAbrirGenerar')?.addEventListener('click', () => {
        cuerpoGenerar.innerHTML = '';
        const cant = parseInt(document.getElementById('genCantidad').value) || 8;
        for (let i = 1; i <= cant; i++) agregarFilaGenerador(i);
        document.getElementById('modalGenerarCaballos').classList.remove('hidden');
    });

    document.getElementById('btnCrearFilas')?.addEventListener('click', () => {
        cuerpoGenerar.innerHTML = '';
        const cant = parseInt(document.getElementById('genCantidad').value) || 8;
        for (let i = 1; i <= cant; i++) agregarFilaGenerador(i);
    });

    document.getElementById('btnAgregarFilaInd')?.addEventListener('click', () => {
        agregarFilaGenerador(cuerpoGenerar.querySelectorAll('tr').length + 1);
    });

    // Guardar Masivo en BD
    document.getElementById('btnProcesarGeneracion')?.addEventListener('click', async () => {
        // Buscar el cliente "REMATE" o tomar el primero
        let casaClient = clientesGlobal.find(c => c.nombre.toUpperCase() === 'REMATE');
        if (!casaClient) casaClient = clientesGlobal[0]; // Backup si no existe cliente REMATE

        const filas = cuerpoGenerar.querySelectorAll('tr');
        let payloads = [];

        filas.forEach((fila, index) => {
            const nombre = fila.querySelector('.input-nombre-gen').value.trim().toUpperCase();
            const monto = parseFloat(fila.querySelector('.input-monto-gen').value) || 0;
            if (nombre) {
                payloads.push({
                    remate_id: remateActivo.id,
                    numero: index + 1,
                    nombre: nombre,
                    monto_usd: monto,
                    cliente_id: casaClient.id
                });
            }
        });

        if (payloads.length > 0) {
            const btn = document.getElementById('btnProcesarGeneracion');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; btn.disabled = true;

            await supabase.from('remate_caballos').insert(payloads);
            
            btn.innerHTML = originalText; btn.disabled = false;
            document.getElementById('modalGenerarCaballos').classList.add('hidden');
            cargarCaballosDelRemate();
        }
    });

    // Arranque
    inicializarModulo();
});