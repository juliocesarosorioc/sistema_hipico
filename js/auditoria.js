// Archivo: js/auditoria.js
// Propósito: Controlar los filtros de fecha, búsqueda múltiple y renderizado del log de seguridad.

document.addEventListener('DOMContentLoaded', function() {

    const formFiltros = document.getElementById('formFiltrosAuditoria');
    const btnLimpiar = document.getElementById('btnLimpiarFiltros');
    const inputDesde = document.getElementById('filtroDesde');
    const inputHasta = document.getElementById('filtroHasta');

    // ==========================================
    // 1. PROCESAMIENTO DEL FILTRO
    // ==========================================
    if (formFiltros) {
        formFiltros.addEventListener('submit', function(e) {
            e.preventDefault();
            
            // Recolectar valores
            const filtros = {
                desde: inputDesde.value,
                hasta: inputHasta.value,
                modulo: document.getElementById('filtroModulo').value,
                usuario: document.getElementById('filtroUsuario').value,
                accion: document.getElementById('filtroAccion').value,
                ip: document.getElementById('filtroIP').value
            };

            // Simulación de consulta a Supabase
            console.log("Aplicando filtros de auditoría:", filtros);
            alert(`[BACKEND SIMULADO]\nConsultando a la base de datos registros desde ${filtros.desde} hasta ${filtros.hasta}...`);
        });
    }

    // ==========================================
    // 2. BOTONES DE FECHA RÁPIDA
    // ==========================================
    document.querySelectorAll('.btn-fecha-rapida').forEach(boton => {
        boton.addEventListener('click', function() {
            const rango = this.getAttribute('data-rango');
            const hoy = new Date();
            
            // Función auxiliar para formato YYYY-MM-DD
            const formatearFecha = (fecha) => fecha.toISOString().split('T')[0];

            if (rango === 'hoy') {
                inputDesde.value = formatearFecha(hoy);
                inputHasta.value = formatearFecha(hoy);
            } 
            else if (rango === '7dias') {
                const hace7Dias = new Date(hoy);
                hace7Dias.setDate(hoy.getDate() - 7);
                inputDesde.value = formatearFecha(hace7Dias);
                inputHasta.value = formatearFecha(hoy);
            } 
            else if (rango === 'mes') {
                const primerDiaMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
                inputDesde.value = formatearFecha(primerDiaMes);
                inputHasta.value = formatearFecha(hoy);
            }
            
            // Ejecutar el submit automáticamente al pulsar un botón rápido
            formFiltros.dispatchEvent(new Event('submit'));
        });
    });

    // ==========================================
    // 3. LIMPIAR FILTROS
    // ==========================================
    if (btnLimpiar) {
        btnLimpiar.addEventListener('click', function() {
            formFiltros.reset();
            
            // Devolver las fechas al estado actual por defecto
            const hoyFormat = new Date().toISOString().split('T')[0];
            inputDesde.value = hoyFormat;
            inputHasta.value = hoyFormat;
            
            // Ejecutar búsqueda limpia
            formFiltros.dispatchEvent(new Event('submit'));
        });
    }

});