// Archivo: js/bancos.js
// Propósito: Gestionar la creación de bancos, filtrado en tiempo real y validación de eliminación.

document.addEventListener('DOMContentLoaded', function() {

    // ==========================================
    // 1. REGISTRO DE NUEVO BANCO
    // ==========================================
    const formBanco = document.getElementById('formBanco');
    
    if (formBanco) {
        formBanco.addEventListener('submit', function(e) {
            e.preventDefault();
            
            const nombre = document.getElementById('nombreBanco').value;
            const monedaUSD = document.getElementById('monedaUSD').checked;
            
            if (!monedaUSD) {
                alert("Debe seleccionar al menos una moneda para este banco.");
                return;
            }

            // Simulación de guardado en base de datos
            alert(`[BACKEND SIMULADO]\nBanco '${nombre}' registrado exitosamente vinculado a la moneda USD.`);
            this.reset();
        });
    }

    // ==========================================
    // 2. BUSCADOR EN TIEMPO REAL
    // ==========================================
    const buscador = document.getElementById('buscadorBancos');
    const filas = document.querySelectorAll('.fila-banco');

    if (buscador) {
        buscador.addEventListener('keyup', function() {
            const textoBusqueda = this.value.toLowerCase();

            filas.forEach(fila => {
                const nombreBanco = fila.querySelector('.nombre-td').textContent.toLowerCase();
                const monedaBanco = fila.querySelector('.moneda-td').textContent.toLowerCase();
                
                // Mostrar la fila si el texto coincide con el nombre del banco o la moneda
                if (nombreBanco.includes(textoBusqueda) || monedaBanco.includes(textoBusqueda)) {
                    fila.style.display = '';
                } else {
                    fila.style.display = 'none';
                }
            });
        });
    }

    // ==========================================
    // 3. LÓGICA DE ELIMINACIÓN (Individual y Masiva)
    // ==========================================
    
    // Eliminar banco individual
    const botonesEliminar = document.querySelectorAll('.btn-eliminar');
    
    botonesEliminar.forEach(boton => {
        boton.addEventListener('click', function() {
            const fila = this.closest('tr');
            const nombreBanco = fila.querySelector('.nombre-td').textContent;
            
            if (confirm(`¿Está seguro de que desea eliminar el banco "${nombreBanco}"?\n\nEsta acción no se puede deshacer y podría afectar el historial de transacciones asociadas.`)) {
                // Simulación de DELETE en Supabase
                fila.remove();
                alert(`El banco ${nombreBanco} ha sido eliminado.`);
            }
        });
    });

    // Eliminar todos los bancos
    const btnEliminarTodos = document.getElementById('btnEliminarTodos');
    
    if (btnEliminarTodos) {
        btnEliminarTodos.addEventListener('click', function() {
            const conteoBancos = document.querySelectorAll('.fila-banco').length;
            
            if (conteoBancos === 0) {
                alert("No hay bancos registrados para eliminar.");
                return;
            }

            const dobleConfirmacion = confirm(`⚠️ ADVERTENCIA CRÍTICA ⚠️\n\nEstá a punto de ELIMINAR TODOS LOS BANCOS registrados.\nEsto desvinculará todos los saldos operativos del sistema.\n\n¿Desea proceder con el borrado masivo?`);
            
            if (dobleConfirmacion) {
                // Eliminación visual del DOM
                document.querySelectorAll('.fila-banco').forEach(fila => fila.remove());
                alert("[BACKEND SIMULADO] Se ha ejecutado el borrado masivo de la tabla de bancos.");
            }
        });
    }

});