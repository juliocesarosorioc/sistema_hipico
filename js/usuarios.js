// Archivo: js/usuarios.js

document.addEventListener('DOMContentLoaded', function() {
    
    // ==========================================
    // 1. FUNCIONES DEL MODAL (Agregar Usuario)
    // ==========================================
    const modal = document.getElementById('modalAgregarUsuario');
    const btnAbrir = document.getElementById('btnAbrirModal');
    const botonesCerrar = document.querySelectorAll('.btn-cerrar-modal'); 
    const formulario = document.getElementById('formularioNuevoUsuario');

    if (btnAbrir) {
        btnAbrir.addEventListener('click', () => modal.classList.remove('hidden'));
    }

    botonesCerrar.forEach(boton => {
        boton.addEventListener('click', () => {
            modal.classList.add('hidden');
            formulario.reset(); 
        });
    });

    if (formulario) {
        formulario.addEventListener('submit', function(e) {
            e.preventDefault(); 
            const nombre = document.getElementById('nuevoUsuario').value;
            const rol = document.getElementById('nuevoRol').value;
            alert(`[BACKEND SIMULADO] Insertando en base de datos...\nUsuario: ${nombre}\nRol: ${rol}`);
            modal.classList.add('hidden');
            formulario.reset();
        });
    }

    // ==========================================
    // 2. FUNCIONES DE LA TABLA DE USUARIOS
    // ==========================================

    // Botón Editar
    document.querySelectorAll('.btn-editar').forEach(boton => {
        boton.addEventListener('click', function() {
            const id = this.getAttribute('data-id');
            const usuario = this.getAttribute('data-usuario');
            // Aquí en el futuro abriremos un modal precargado con los datos del ID seleccionado
            alert(`[BACKEND] Solicitando datos del usuario ${usuario} (ID: ${id}) para edición.`);
        });
    });

    // Botón Reset (Restablecer configuración o intentos)
    document.querySelectorAll('.btn-reset').forEach(boton => {
        boton.addEventListener('click', function() {
            const usuario = this.getAttribute('data-usuario');
            if(confirm(`¿Desea resetear los parámetros de seguridad para ${usuario}?`)) {
                alert(`[BACKEND] Parámetros reseteados para ${usuario}.`);
            }
        });
    });

    // Botón Clave (Forzar cambio de contraseña)
    document.querySelectorAll('.btn-clave').forEach(boton => {
        boton.addEventListener('click', function() {
            const usuario = this.getAttribute('data-usuario');
            if(confirm(`¿Generar enlace de recuperación de contraseña para ${usuario}?`)) {
                alert(`[BACKEND] Correo de recuperación enviado a ${usuario}.`);
            }
        });
    });

    // Botón Eliminar (Eliminación visual y de base de datos)
    document.querySelectorAll('.btn-eliminar').forEach(boton => {
        boton.addEventListener('click', function() {
            const id = this.getAttribute('data-id');
            const usuario = this.getAttribute('data-usuario');
            
            if (confirm(`ALERTA CRÍTICA: ¿Eliminar permanentemente a ${usuario} (ID: ${id})?`)) {
                // Elimina la fila (tr) más cercana al botón presionado de la interfaz gráfica
                const fila = this.closest('tr');
                fila.remove();
                alert(`[BACKEND] Instrucción DELETE ejecutada en base de datos para el ID: ${id}`);
            }
        });
    });

    // Botón Expulsar (Cerrar sesión activa remotamente)
    document.querySelectorAll('.btn-expulsar').forEach(boton => {
        boton.addEventListener('click', function() {
            const usuario = this.getAttribute('data-usuario');
            if (confirm(`¿Forzar el cierre de sesión de ${usuario} inmediatamente?`)) {
                // Cambiamos visualmente el badge de estado
                const fila = this.closest('tr');
                const celdaSesion = fila.cells[4]; // La columna 5 (índice 4) es la sesión
                celdaSesion.innerHTML = '<span class="bg-slate-400 text-white text-xs px-2 py-1 rounded-full"><i class="fas fa-circle text-[8px] mr-1"></i>Sin sesión</span>';
                
                // Ocultamos el botón de expulsar ya que la sesión se cerró
                this.style.display = 'none';
                alert(`[BACKEND] Token de sesión revocado para ${usuario}.`);
            }
        });
    });

    // ==========================================
    // 3. FUNCIONES DE MAPA Y MONITOREO IP
    // ==========================================

    // Botón Ver Mapa (Geolocalización)
    document.querySelectorAll('.btn-mapa').forEach(boton => {
        boton.addEventListener('click', function() {
            const ip = this.getAttribute('data-ip');
            // En el futuro, esto consultará una API como ip-api.com
            alert(`[API GEOLOCALIZACIÓN] Buscando coordenadas para la IP: ${ip}...`);
        });
    });

    // Botón Limpiar IP (Tabla de Intentos Fallidos)
    document.querySelectorAll('.btn-limpiar').forEach(boton => {
        boton.addEventListener('click', function() {
            const ip = this.getAttribute('data-ip');
            
            if (confirm(`¿Limpiar la IP ${ip} de la lista negra de seguridad?`)) {
                // Removemos la fila de la tabla de monitoreo
                const fila = this.closest('tr');
                fila.remove();
                alert(`[BACKEND] IP ${ip} removida del registro de intentos fallidos.`);
                
                // Lógica pedagógica: Actualizar el contador de IPs rojas
                const contadorElemento = document.querySelector('.bg-white.text-red-600.rounded');
                if (contadorElemento) {
                    let ipsRestantes = document.querySelectorAll('.btn-limpiar').length;
                    contadorElemento.textContent = `${ipsRestantes} IPs`;
                }
            }
        });
    });

});