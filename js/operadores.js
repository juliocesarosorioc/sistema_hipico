<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Gestión de Operadores - Club del Dinero</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <!-- Estilos CSS Colectivos Centralizados -->
    <link rel="stylesheet" href="style.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body class="bg-slate-100 flex h-screen overflow-hidden font-sans">

    <!-- MENÚ LATERAL (SIDEBAR) -->
    <aside class="w-64 bg-slate-900 text-slate-300 flex flex-col h-full shadow-xl z-20">
        <div class="sidebar-header border-b border-slate-700">
            <h1 class="text-2xl font-bold text-white tracking-wide">Club del Dinero</h1>
            <p class="text-xs text-slate-400 mt-1 flex items-center">
                <i class="fas fa-circle text-emerald-500 text-[8px] mr-1"></i> 
                <span id="sidebarUserRole">Cargando...</span>
            </p>
            <p class="text-xs text-white font-bold mt-1" id="sidebarUserName"></p>
        </div>
        <nav class="flex-1 overflow-y-auto py-4">
            <ul class="space-y-1 text-sm">
                <li>
                    <a href="dashboard.html" class="flex items-center px-5 py-3 hover:bg-slate-800 hover:text-white transition-colors">
                        <i class="fas fa-home w-6 text-blue-400"></i>
                        <span class="ml-2">Inicio</span>
                    </a>
                </li>
                <li>
                    <a href="clientes.html" class="flex items-center px-5 py-3 hover:bg-slate-800 hover:text-white transition-colors">
                        <i class="fas fa-users w-6 text-cyan-400"></i>
                        <span class="ml-2">Clientes</span>
                    </a>
                </li>
                <li>
                    <a href="depositos.html" class="flex items-center px-5 py-3 hover:bg-slate-800 hover:text-white transition-colors">
                        <i class="fas fa-arrow-down w-6 text-emerald-400"></i>
                        <span class="ml-2">Depósitos</span>
                    </a>
                </li>
                <li>
                    <a href="retiros.html" class="flex items-center px-5 py-3 hover:bg-slate-800 hover:text-white transition-colors">
                        <i class="fas fa-arrow-up w-6 text-red-400"></i>
                        <span class="ml-2">Retiros</span>
                    </a>
                </li>
                <li>
                    <a href="transferencias.html" class="flex items-center px-5 py-3 hover:bg-slate-800 hover:text-white transition-colors">
                        <i class="fas fa-exchange-alt w-6 text-amber-400"></i>
                        <span class="ml-2">Transferencias</span>
                    </a>
                </li>
                <li>
                    <a href="taquilla.html" class="flex items-center px-5 py-3 hover:bg-slate-800 hover:text-white transition-colors">
                        <i class="fas fa-receipt w-6 text-blue-400"></i>
                        <span class="ml-2">Taquilla (Planos)</span>
                    </a>
                </li>
                <li>
                    <a href="wps.html" class="flex items-center px-5 py-3 hover:bg-slate-800 hover:text-white transition-colors">
                        <i class="fas fa-horse w-6 text-teal-400"></i>
                        <span class="ml-2">W.P.S.</span>
                    </a>
                </li>
                <li>
                    <a href="remates.html" class="flex items-center px-5 py-3 hover:bg-slate-800 hover:text-white transition-colors">
                        <i class="fas fa-bell w-6 text-orange-400"></i>
                        <span class="ml-2">Remates</span>
                    </a>
                </li>
                <li>
                    <a href="pollas.html" class="flex items-center px-5 py-3 hover:bg-slate-800 hover:text-white transition-colors">
                        <i class="fas fa-trophy w-6 text-indigo-400"></i>
                        <span class="ml-2">Pollas</span>
                    </a>
                </li>
                <li>
                    <a href="saldos.html" class="flex items-center px-5 py-3 hover:bg-slate-800 hover:text-white transition-colors">
                        <i class="fas fa-balance-scale w-6 text-slate-400"></i>
                        <span class="ml-2">Saldos/Reportes</span>
                    </a>
                </li>
                <li>
                    <a href="hipodromos.html" class="flex items-center px-5 py-3 hover:bg-slate-800 hover:text-white transition-colors">
                        <i class="fas fa-horse-head w-6 text-purple-400"></i>
                        <span class="ml-2">Hipódromos</span>
                    </a>
                </li>
                <li>
                    <a href="monedas.html" class="flex items-center px-5 py-3 hover:bg-slate-800 hover:text-white transition-colors">
                        <i class="fas fa-coins w-6 text-yellow-400"></i>
                        <span class="ml-2">Monedas y Tasas</span>
                    </a>
                </li>
                <!-- Operadores ubicado al final del menú -->
                <li>
                    <a href="operadores.html" class="flex items-center px-5 py-3 bg-blue-600 text-white border-l-4 border-blue-400 border-t border-slate-800 mt-2">
                        <i class="fas fa-user-shield w-6"></i>
                        <span class="ml-2 font-medium">Operadores</span>
                    </a>
                </li>
            </ul>
        </nav>
        <div class="p-4 border-t border-slate-700">
            <a href="#" id="btnCerrarSesion" class="flex items-center text-red-400 hover:text-red-300 transition-colors">
                <i class="fas fa-sign-out-alt w-6"></i>
                <span class="ml-2 font-medium">Cerrar Sesión</span>
            </a>
        </div>
    </aside>

    <!-- ÁREA CENTRAL DE CONTENIDO -->
    <main class="flex-1 flex flex-col h-full relative overflow-y-auto p-8">
        
        <!-- Cabecera -->
        <div class="flex justify-between items-center mb-6">
            <h1 class="text-2xl font-bold text-slate-800"><i class="fas fa-user-shield text-slate-700 mr-2"></i> Gestión de Operadores y Accesos</h1>
            <button id="btnAbrirModalOperador" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-xs font-bold shadow transition-colors flex items-center">
                <i class="fas fa-user-plus mr-1"></i> Nuevo Operador
            </button>
        </div>

        <!-- Tabla de Operadores -->
        <div class="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
            <div class="bg-slate-900 text-white p-3 font-bold text-sm">
                <i class="fas fa-list-ul mr-2"></i> Operadores Autorizados
            </div>
            <div class="overflow-x-auto">
                <table class="w-full text-xs text-left">
                    <thead class="bg-slate-100 text-slate-700 border-b border-slate-200">
                        <tr>
                            <th class="p-3">Nombre Completo</th>
                            <th class="p-3">Usuario</th>
                            <th class="p-3">Rol</th>
                            <th class="p-3 text-center">Estado</th>
                            <th class="p-3">Fecha Registro</th>
                            <th class="p-3 text-center">Acciones</th>
                        </tr>
                    </thead>
                    <tbody id="tablaOperadores" class="divide-y divide-slate-200 text-slate-800">
                        <tr><td colspan="6" class="p-6 text-center text-slate-500">Cargando operadores...</td></tr>
                    </tbody>
                </table>
            </div>
        </div>

    </main>

    <!-- MODAL NUEVO / EDITAR OPERADOR -->
    <div id="modalOperador" class="hidden modal-overlay">
        <div class="modal-container">
            <div class="bg-blue-600 p-4 text-white font-bold flex justify-between items-center">
                <span id="modalTitulo"><i class="fas fa-user-plus mr-2"></i> Registrar Nuevo Operador</span>
                <button class="cerrar-modal hover:text-slate-200"><i class="fas fa-times text-lg"></i></button>
            </div>
            <div class="p-6">
                <form id="formOperador" class="space-y-4">
                    <input type="hidden" id="opId">
                    <div>
                        <label class="block text-xs font-bold text-slate-700 mb-1">Nombre Completo</label>
                        <input type="text" id="opNombre" placeholder="Ej: Carlos Pérez" class="w-full border border-slate-300 rounded px-3 py-2 text-sm outline-none focus:border-blue-500" required>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-slate-700 mb-1">Usuario de Acceso</label>
                        <input type="text" id="opUsuario" placeholder="Ej: cperez" class="w-full border border-slate-300 rounded px-3 py-2 text-sm outline-none focus:border-blue-500" required>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-slate-700 mb-1">Contraseña</label>
                        <input type="text" id="opPassword" placeholder="Contraseña segura" class="w-full border border-slate-300 rounded px-3 py-2 text-sm outline-none focus:border-blue-500" required>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-slate-700 mb-1">Rol en el Sistema</label>
                        <select id="opRol" class="w-full border border-slate-300 rounded px-3 py-2 text-sm outline-none bg-white">
                            <option value="Administrador Principal">Administrador Principal</option>
                            <option value="Operador">Operador Estándar</option>
                        </select>
                    </div>
                </form>
            </div>
            <div class="p-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-2 text-xs">
                <button type="button" class="cerrar-modal bg-slate-500 text-white px-4 py-2 rounded font-medium hover:bg-slate-600">Cancelar</button>
                <button type="submit" form="formOperador" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded font-bold shadow-sm">
                    <i class="fas fa-save mr-1"></i> Guardar Operador
                </button>
            </div>
        </div>
    </div>

    <!-- SCRIPTS -->
    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
    <script src="js/conexion.js"></script>
    <script src="js/operadores.js"></script>
    <script>
        // Validación de seguridad por sesión y rol
        const sesionStr = localStorage.getItem('club_sesion_activa');
        if (!sesionStr) {
            window.location.href = 'index.html';
        } else {
            const sesion = JSON.parse(sesionStr);
            if(!sesion.rol.includes('Administrador')) {
                alert("Acceso denegado: No tienes permisos para gestionar operadores.");
                window.location.href = 'dashboard.html';
            }
            document.getElementById('sidebarUserName').textContent = sesion.nombre;
            document.getElementById('sidebarUserRole').textContent = sesion.rol;
        }

        // Lógica de Cerrar Sesión
        document.getElementById('btnCerrarSesion')?.addEventListener('click', (e) => {
            e.preventDefault();
            localStorage.removeItem('club_sesion_activa');
            window.location.href = 'index.html';
        });
    </script>
</body>
</html>