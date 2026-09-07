// Archivo: js/clientes.js
// Propósito: Conexión real con Supabase para Crear y Leer clientes.

document.addEventListener('DOMContentLoaded', () => {
    
    // 1. Referencias al DOM
    const formCliente = document.getElementById('formNuevoCliente');
    const cuerpoTabla = document.getElementById('cuerpoTablaClientes');

    // ==========================================
    // FUNCIÓN 1: OBTENER Y MOSTRAR CLIENTES (READ)
    // ==========================================
    async function cargarClientes() {
        // Mostrar un mensaje de carga temporal
        cuerpoTabla.innerHTML = '<tr><td colspan="7" class="p-4 text-center text-slate-500">Cargando clientes desde Supabase...</td></tr>';

        // Consulta a Supabase
        const { data: clientes, error } = await supabase
            .from('clientes')
            .select('*')
            .order('fecha_creacion', { ascending: false });

        if (error) {
            console.error("Error al cargar clientes:", error);
            cuerpoTabla.innerHTML = '<tr><td colspan="7" class="p-4 text-center text-red-500">Error de conexión al cargar datos.</td></tr>';
            return;
        }

        if (clientes.length === 0) {
            cuerpoTabla.innerHTML = '<tr><td colspan="7" class="p-4 text-center text-slate-500 bg-slate-50">No hay clientes registrados aún.</td></tr>';
            return;
        }

        // Limpiar la tabla y llenarla con datos reales
        cuerpoTabla.innerHTML = '';
        
        clientes.forEach(cliente => {
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-slate-50 border-b border-slate-200';
            
            // Lógica visual para la etiqueta "Libre"
            const badgeLibre = cliente.libre 
                ? '<span class="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-[10px] font-bold">SÍ</span>' 
                : '<span class="bg-slate-100 text-slate-500 px-2 py-0.5 rounded text-[10px] font-bold">NO</span>';

            tr.innerHTML = `
                <td class="p-3 font-bold text-slate-800">${cliente.nombre}</td>
                <td class="p-3 text-slate-600">${cliente.telefono || '—'}</td>
                <td class="p-3 text-center">${cliente.comision_porcentaje}%</td>
                <td class="p-3 text-center">${badgeLibre}</td>
                <td class="p-3 text-right font-medium text-emerald-700">$${cliente.saldo_usd.toFixed(2)}</td>
                <td class="p-3 text-right font-medium text-amber-600">$${cliente.aval_usd.toFixed(2)}</td>
                <td class="p-3 text-center">
                    <button class="text-blue-500 hover:text-blue-700 mx-1 transition-colors"><i class="fas fa-edit"></i></button>
                    <button class="text-slate-400 hover:text-red-500 mx-1 transition-colors"><i class="fas fa-trash-alt"></i></button>
                </td>
            `;
            cuerpoTabla.appendChild(tr);
        });
    }

    // ==========================================
    // FUNCIÓN 2: REGISTRAR NUEVO CLIENTE (CREATE)
    // ==========================================
    if (formCliente) {
        formCliente.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            // Cambiar estado del botón mientras guarda
            const btnSubmit = this.querySelector('button[type="submit"]');
            const textoOriginal = btnSubmit.innerHTML;
            btnSubmit.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Guardando...';
            btnSubmit.disabled = true;

            // Recolectar datos del formulario
            const nombre = document.getElementById('nombreCliente').value.trim().toUpperCase();
            const telefono = document.getElementById('telefonoCliente').value.trim();
            const comision = parseFloat(document.getElementById('comisionCliente').value) || 0;
            const libre = document.getElementById('libreCliente').checked;

            // Inserción en Supabase
            const { data, error } = await supabase
                .from('clientes')
                .insert([
                    { 
                        nombre: nombre, 
                        telefono: telefono, 
                        comision_porcentaje: comision, 
                        libre: libre,
                        saldo_usd: 0.00, // Nacen con saldo 0
                        aval_usd: 0.00   // Nacen con aval 0
                    }
                ]);

            // Restaurar botón
            btnSubmit.innerHTML = textoOriginal;
            btnSubmit.disabled = false;

            if (error) {
                console.error("Error al guardar:", error);
                if (error.code === '23505') { // Código SQL para violación de UNIQUE
                    alert("Error: Ya existe un cliente con ese nombre en el sistema.");
                } else {
                    alert("Hubo un error al registrar el cliente. Revisa la consola.");
                }
                return;
            }

            // Éxito
            formCliente.reset();
            cargarClientes(); // Recargar la tabla inmediatamente para ver el nuevo registro
        });
    }

    // Ejecutar la lectura de clientes al cargar la página
    cargarClientes();
});