// Archivo: js/components/layout.js
// Propósito: Inyectar el Menú Lateral (Sidebar) y manejar la sesión globalmente.

document.addEventListener('DOMContentLoaded', () => {
    
    // 1. Evitar que se inyecte en la pantalla de Login (index.html)
    const paginaActual = window.location.pathname.split('/').pop() || 'index.html';
    if (paginaActual === 'index.html') return;

    // 2. Validar sesión de seguridad globalmente
    const sesionStr = localStorage.getItem('club_sesion_activa');
    if (!sesionStr) {
        window.location.href = 'index.html';
        return;
    }

    const sesion = JSON.parse(sesionStr);

    // 3. Plantilla HTML del Menú Lateral
    const sidebarHTML = `
    <aside class="w-64 bg-slate-900 text-slate-300 flex flex-col h-full shadow-xl z-20 shrink-0" id="sidebarGlobal">
        <div class="sidebar-header border-b border-slate-700 p-5">
            <h1 class="text-2xl font-bold text-white tracking-wide"><i class="fas fa-coins text-emerald-400 mr-2"></i>Club del Dinero</h1>
            <p class="text-xs text-slate-400 mt-2 font-bold tracking-widest uppercase flex items-center">
                <i class="fas fa-circle text-emerald-500 text-[8px] mr-1"></i> ${sesion.rol}
            </p>
            <p class="text-sm text-white font-bold mt-1">${sesion.nombre}</p>
        </div>

        <nav class="flex-1 overflow-y-auto py-2">
            <ul class="text-sm font-medium space-y-1">
                <li><a href="dashboard.html" class="nav-link flex items-center px-6 py-3 hover:text-white hover:bg-slate-800 transition-colors"><i class="fas fa-home w-6"></i> Inicio / Dashboard</a></li>
                
                <li class="px-6 mt-6 mb-2 text-[10px] text-slate-500 uppercase tracking-widest font-bold">Módulo Hípico</li>
                <li><a href="taquilla.html" class="nav-link flex items-center px-6 py-2.5 hover:text-white hover:bg-slate-800 transition-colors"><i class="fas fa-receipt w-6 text-blue-400"></i> Taquilla</a></li>
                <li><a href="tablas.html" class="nav-link flex items-center px-6 py-2.5 hover:text-white hover:bg-slate-800 transition-colors"><i class="fas fa-table w-6 text-indigo-400"></i> Tablas Fijas</a></li>
                <li><a href="venta_tablas.html" class="nav-link flex items-center px-6 py-2.5 hover:text-white hover:bg-slate-800 transition-colors"><i class="fas fa-cash-register w-6 text-emerald-400"></i> Venta de Tablas</a></li>
                <li><a href="wps.html" class="nav-link flex items-center px-6 py-2.5 hover:text-white hover:bg-slate-800 transition-colors"><i class="fas fa-horse w-6 text-teal-400"></i> W.P.S.</a></li>
                <li><a href="remates.html" class="nav-link flex items-center px-6 py-2.5 hover:text-white hover:bg-slate-800 transition-colors"><i class="fas fa-bell w-6 text-orange-400"></i> Remates</a></li>
                <li><a href="pollas.html" class="nav-link flex items-center px-6 py-2.5 hover:text-white hover:bg-slate-800 transition-colors"><i class="fas fa-trophy w-6 text-indigo-400"></i> Pollas</a></li>
                <li><a href="hipodromos.html" class="nav-link flex items-center px-6 py-2.5 hover:text-white hover:bg-slate-800 transition-colors"><i class="fas fa-horse-head w-6 text-purple-400"></i> Hipódromos</a></li>

                <li class="px-6 mt-6 mb-2 text-[10px] text-slate-500 uppercase tracking-widest font-bold">Contabilidad</li>
                <li><a href="depositos.html" class="nav-link flex items-center px-6 py-2.5 hover:text-white hover:bg-slate-800 transition-colors"><i class="fas fa-arrow-down w-6 text-emerald-400"></i> Ingresos / Avales</a></li>
                <li><a href="retiros.html" class="nav-link flex items-center px-6 py-2.5 hover:text-white hover:bg-slate-800 transition-colors"><i class="fas fa-arrow-up w-6 text-red-400"></i> Retiros</a></li>
                <li><a href="caja.html" class="nav-link flex items-center px-6 py-2.5 hover:text-white hover:bg-slate-800 transition-colors"><i class="fas fa-exchange-alt w-6 text-orange-400"></i> Caja Unificada</a></li>
                <li><a href="bancos.html" class="nav-link flex items-center px-6 py-2.5 hover:text-white hover:bg-slate-800 transition-colors"><i class="fas fa-university w-6 text-blue-400"></i> Bancos Reales</a></li>
                <li><a href="saldos.html" class="nav-link flex items-center px-6 py-2.5 hover:text-white hover:bg-slate-800 transition-colors"><i class="fas fa-check-double w-6 text-emerald-400"></i> Liquidación</a></li>
                <li><a href="monedas.html" class="nav-link flex items-center px-6 py-2.5 hover:text-white hover:bg-slate-800 transition-colors"><i class="fas fa-coins w-6 text-yellow-400"></i> Monedas y Tasas</a></li>

                <li class="px-6 mt-6 mb-2 text-[10px] text-slate-500 uppercase tracking-widest font-bold">Configuración</li>
                <li><a href="clientes.html" class="nav-link flex items-center px-6 py-2.5 hover:text-white hover:bg-slate-800 transition-colors"><i class="fas fa-users w-6 text-cyan-400"></i> Clientes/Socios</a></li>
                <li><a href="tipos_jugadas.html" class="nav-link flex items-center px-6 py-2.5 hover:text-white hover:bg-slate-800 transition-colors"><i class="fas fa-cogs w-6 text-slate-400"></i> Reglas de Jugadas</a></li>
                
                ${sesion.rol.includes('Administrador') ? `
                <li><a href="operadores.html" class="nav-link flex items-center px-6 py-2.5 hover:text-white hover:bg-slate-800 transition-colors border-t border-slate-800 mt-2"><i class="fas fa-user-shield w-6 text-blue-400"></i> Operadores</a></li>
                ` : ''}
            </ul>
        </nav>

        <div class="p-4 border-t border-slate-700 bg-slate-900">
            <button id="btnCerrarSesionGlobal" class="flex items-center text-red-400 hover:text-red-300 transition-colors font-bold text-sm w-full text-left">
                <i class="fas fa-power-off w-6"></i> Cerrar Sistema
            </button>
        </div>
    </aside>
    `;

    // 4. Inyectar el menú al principio del body
    document.body.insertAdjacentHTML('afterbegin', sidebarHTML);

    // 5. Resaltar visualmente la pestaña activa
    document.querySelectorAll('.nav-link').forEach(link => {
        if (link.getAttribute('href') === paginaActual) {
            link.classList.remove('hover:bg-slate-800', 'text-slate-300');
            link.classList.add('bg-blue-600', 'text-white', 'border-l-4', 'border-blue-400');
        }
    });

    // 6. Asignar funcionalidad de cerrar sesión
    document.getElementById('btnCerrarSesionGlobal').addEventListener('click', () => {
        localStorage.removeItem('club_sesion_activa');
        window.location.href = 'index.html';
    });
});