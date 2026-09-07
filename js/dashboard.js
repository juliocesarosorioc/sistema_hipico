// Archivo: js/dashboard.js
// Propósito: Controlar la interactividad del Panel Principal (Cierre de caja, semanas activas)

document.addEventListener('DOMContentLoaded', function() {
    
    // 1. CAPTURAMOS ELEMENTOS
    const modalCierre = document.getElementById('modalCierreDia');
    const btnAbrirCierre = document.getElementById('btnAbrirCierre');
    const btnCancelar = document.getElementById('btnCancelarCierre');
    const btnVerCierre = document.getElementById('btnVerCierre');
    const btnConfirmar = document.getElementById('btnConfirmarCierre');
    const inputFecha = document.getElementById('fechaCierre');

    // 2. FUNCIÓN ABRIR MODAL
    if (btnAbrirCierre) {
        btnAbrirCierre.addEventListener('click', function() {
            modalCierre.classList.remove('hidden'); // Mostramos la ventana
            
            // Lógica para autocompletar la fecha de hoy
            // El formato estándar interno de HTML para type="date" siempre es YYYY-MM-DD
            const hoy = new Date();
            const anio = hoy.getFullYear();
            // Los meses en JavaScript van de 0 a 11, sumamos 1. padStart agrega un '0' si es menor a 10.
            const mes = String(hoy.getMonth() + 1).padStart(2, '0');
            const dia = String(hoy.getDate()).padStart(2, '0');
            
            inputFecha.value = `${anio}-${mes}-${dia}`;
        });
    }

    // 3. FUNCIÓN CANCELAR
    if (btnCancelar) {
        btnCancelar.addEventListener('click', function() {
            modalCierre.classList.add('hidden'); // Ocultamos la ventana sin hacer nada
        });
    }

    // 4. FUNCIÓN VER CIERRE (Pre-visualización de auditoría)
    if (btnVerCierre) {
        btnVerCierre.addEventListener('click', function() {
            const fecha = inputFecha.value;
            // En un futuro, esto redirigirá al módulo "Saldos/Reportes" filtrando por esta fecha
            alert(`[MÓDULO REPORTES]\nAbriendo hoja de cuadre preliminar y balances para el día: ${fecha}`);
        });
    }

    // 5. FUNCIÓN CONFIRMAR CIERRE (El evento crítico)
    if (btnConfirmar) {
        btnConfirmar.addEventListener('click', function() {
            const fecha = inputFecha.value;
            
            // Capa de seguridad adicional para eventos críticos financieros
            const confirmar = confirm(`ALERTA OPERATIVA:\n¿Confirma el cierre contable y de taquilla para el día ${fecha}?\n\nEsta acción bloqueará la carga de nuevas apuestas en el sistema para esta fecha específica.`);
            
            if (confirmar) {
                // Aquí en el futuro Supabase cerrará las tablas y ejecutará los procedimientos almacenados
                alert(`[BACKEND] Sistema de cierre ejecutado con éxito:\n\n✔️ Taquilla bloqueada.\n✔️ Jugadas consolidadas.\n✔️ El día ${fecha} ha sido cerrado.`);
                modalCierre.classList.add('hidden'); // Cerramos la ventana al terminar
            }
        });
    }
});