// Archivo: js/components/layout.js
// Propósito: Inyectar el Menú Lateral (Sidebar) colapsable, manejar la sesión globalmente
// y aplicar las mejores prácticas de UI/UX: drawer móvil con overlay, persistencia
// de estado, accesibilidad (ARIA / teclado) y colapso a solo iconos en escritorio.

document.addEventListener('DOMContentLoaded', () => {

    // 1. Evitar que se inyecte en la pantalla de Login (index.html)
    const paginaActual = window.location.pathname.split('/').pop() || 'index.html';
    if (paginaActual === 'index.html') return;

    // 2. Validar sesión de seguridad globalmente
    const sesion = window.clubAuth.requireAuth();
    if (!sesion) return;

    // 3. Datos del menú (un solo lugar para editar y fácil de colapsar)
    const GRUPOS = [
        {
            titulo: 'Módulo Hípico',
            items: [
                { href: 'taquilla.html', icon: 'fa-receipt',      txt: 'Taquilla',            color: 'text-blue-400' },
                { href: 'tablas.html',   icon: 'fa-table',        txt: 'Tablas Fijas',         color: 'text-indigo-400' },
                { href: 'venta_tablas.html', icon: 'fa-cash-register', txt: 'Venta de Tablas', color: 'text-emerald-400' },
                { href: 'wps.html',      icon: 'fa-horse',        txt: 'W.P.S.',              color: 'text-teal-400' },
                { href: 'remates.html',  icon: 'fa-bell',         txt: 'Remates',             color: 'text-orange-400' },
                { href: 'pollas.html',   icon: 'fa-trophy',       txt: 'Pollas',              color: 'text-indigo-400' },
                { href: 'hipodromos.html', icon: 'fa-horse-head',  txt: 'Hipódromos',          color: 'text-purple-400' }
            ]
        },
        {
            titulo: 'Contabilidad',
            items: [
                { href: 'depositos.html', icon: 'fa-arrow-down',  txt: 'Ingresos / Avales',   color: 'text-emerald-400' },
                { href: 'retiros.html',  icon: 'fa-arrow-up',     txt: 'Retiros',             color: 'text-red-400' },
                { href: 'caja.html',     icon: 'fa-exchange-alt', txt: 'Caja Unificada',      color: 'text-orange-400' },
                { href: 'bancos.html',   icon: 'fa-university',   txt: 'Bancos Reales',       color: 'text-blue-400' },
                { href: 'saldos.html',   icon: 'fa-check-double', txt: 'Liquidación',         color: 'text-emerald-400' },
                { href: 'monedas.html',  icon: 'fa-coins',        txt: 'Monedas y Tasas',     color: 'text-yellow-400' }
            ]
        },
        {
            titulo: 'Configuración',
            items: [
                { href: 'clientes.html', icon: 'fa-users',        txt: 'Clientes/Socios',     color: 'text-cyan-400' },
                { href: 'tipos_jugadas.html', icon: 'fa-cogs',    txt: 'Reglas de Jugadas',   color: 'text-slate-400' }
            ]
        }
    ];

    const ES_ADMIN = sesion.rol.includes('Administrador');
    if (ES_ADMIN) {
        GRUPOS.push({
            titulo: 'Administración',
            items: [
                { href: 'operadores.html', icon: 'fa-user-shield', txt: 'Operadores',         color: 'text-blue-400' }
            ]
        });
    }

    const esActivo = (href) => href === paginaActual;

    const renderItems = () => GRUPOS.map(g => {
        const enlaces = g.items.map(it => {
            const activo = esActivo(it.href);
            return `
                <li>
                    <a href="${it.href}" class="nav-link flex items-center px-6 py-2.5 hover:text-white hover:bg-slate-800 transition-colors ${activo ? 'bg-blue-600 text-white border-l-4 border-blue-400' : ''}">
                        <i class="fas ${it.icon} ${it.color} w-6"></i>
                        <span class="txt-nav">${it.txt}</span>
                    </a>
                </li>`;
        }).join('');

        const marcaActiva = g.items.some(it => esActivo(it.href));

        return `
            <li class="s-grupo px-6 mt-6 mb-2 text-[10px] text-slate-500 uppercase tracking-widest font-bold ${marcaActiva ? 'text-blue-400' : ''}">${g.titulo}</li>
            ${enlaces}`;
    }).join('');

    // 4. Plantilla HTML del Menú Lateral
    const sidebarHTML = `
    <aside id="sidebarGlobal" class="fixed lg:static inset-y-0 left-0 w-64 bg-slate-900 text-slate-300 flex flex-col h-full shadow-xl z-40 shrink-0">
        <div class="sidebar-header border-b border-slate-700 p-5">
            <h1 class="text-2xl font-bold text-white tracking-wide"><i class="fas fa-coins text-emerald-400 mr-2"></i><span class="logo-txt">Club del Dinero</span></h1>
            <p class="text-xs text-slate-400 mt-2 font-bold tracking-widest uppercase flex items-center">
                <i class="fas fa-circle text-emerald-500 text-[8px] mr-1"></i> ${sesion.rol}
            </p>
            <p class="text-sm text-white font-bold mt-1">${sesion.nombre}</p>
        </div>

        <nav class="flex-1 overflow-y-auto py-2" aria-label="Menú principal">
            <ul class="text-sm font-medium space-y-1">
                <li><a href="dashboard.html" class="nav-link flex items-center px-6 py-3 hover:text-white hover:bg-slate-800 transition-colors ${esActivo('dashboard.html') ? 'bg-blue-600 text-white border-l-4 border-blue-400' : ''}"><i class="fas fa-home text-blue-400 w-6"></i><span class="txt-nav">Inicio / Dashboard</span></a></li>
                ${renderItems()}
            </ul>
        </nav>

        <div class="p-4 border-t border-slate-700 bg-slate-900">
            <button id="btnCerrarSesionGlobal" class="btn-cerrar flex items-center text-red-400 hover:text-red-300 transition-colors font-bold text-sm w-full text-left">
                <i class="fas fa-power-off text-red-400 w-6"></i><span class="cerrar-sesion-txt">Cerrar Sistema</span>
            </button>
        </div>
    </aside>
    `;

    // 5. Botón de alternar + overlay (drawer móvil)
    const botonHTML = `
    <button id="btnToggleSidebar" aria-controls="sidebarGlobal" aria-expanded="true" aria-label="Alternar menú"
            class="fixed top-2 left-2 z-50 flex items-center justify-center w-10 h-10 rounded-md bg-slate-900/80 text-slate-200 hover:text-white backdrop-blur-sm border border-slate-700/60 shadow-lg transition-colors">
        <i class="fas fa-times" aria-hidden="true"></i>
    </button>`;
    const overlayHTML = `
    <div id="overlaySidebar" class="fixed inset-0 bg-black/50 z-30 lg:hidden hidden" aria-hidden="true"></div>`;

    document.body.insertAdjacentHTML('afterbegin', sidebarHTML + botonHTML + overlayHTML);

    const sidebar = document.getElementById('sidebarGlobal');
    const btnToggle = document.getElementById('btnToggleSidebar');
    const overlay = document.getElementById('overlaySidebar');
    const iconoToggle = btnToggle.querySelector('i');
    const mqDesktop = window.matchMedia('(min-width: 1024px)');

    const ESTADO_KEY = 'club_sidebar_estado';
    let compacto = localStorage.getItem(ESTADO_KEY) === 'compacto'; // solo aplica en escritorio
    let drawerAbierto = false; // solo aplica en móvil/tablet

    function esEscritorio() { return mqDesktop.matches; }

    function setAria() {
        const visible = esEscritorio() ? !compacto : drawerAbierto;
        btnToggle.setAttribute('aria-expanded', String(visible));
        sidebar.setAttribute('aria-hidden', String(!visible));
    }

    function aplicar() {
        sidebar.classList.remove('lg:w-16', 'lg:w-64', 'w-16', 'w-64');

        if (esEscritorio()) {
            // Modo escritorio: colapsa a solo iconos o expande
            sidebar.classList.add(compacto ? 'lg:w-16' : 'lg:w-64');
            sidebar.classList.toggle('colapsado', compacto);
            sidebar.classList.remove('-translate-x-full', 'translate-x-0');
            sidebar.classList.add('lg:translate-x-0');
            overlay.classList.add('hidden');
            iconoToggle.className = 'fas ' + (compacto ? 'fa-bars' : 'fa-times');
        } else {
            // Modo móvil: drawer con overlay
            sidebar.classList.add('w-64');
            sidebar.classList.remove('colapsado');
            sidebar.classList.toggle('translate-x-0', drawerAbierto);
            sidebar.classList.toggle('-translate-x-full', !drawerAbierto);
            iconoToggle.className = 'fas ' + (drawerAbierto ? 'fa-times' : 'fa-bars');
            overlay.classList.toggle('hidden', !drawerAbierto);
        }
        setAria();
    }

    // 6. Alternar según breakpoint
    btnToggle.addEventListener('click', () => {
        if (esEscritorio()) {
            compacto = !compacto;
            localStorage.setItem(ESTADO_KEY, compacto ? 'compacto' : 'abierto');
        } else {
            drawerAbierto = !drawerAbierto;
        }
        aplicar();
        if (esEscritorio()) {
            // devolver el foco al enlace activo o al primer elemento al expandir
            if (!compacto) {
                const activo = sidebar.querySelector('.nav-link.bg-blue-600');
                (activo || sidebar.querySelector('.nav-link'))?.focus?.();
            }
        } else if (drawerAbierto) {
            btnToggle.focus();
        }
    });

    // 7. Cerrar drawer con ESC o tocando el overlay
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !esEscritorio() && drawerAbierto) {
            drawerAbierto = false;
            aplicar();
            btnToggle.focus();
        }
    });

    overlay.addEventListener('click', () => {
        if (!esEscritorio() && drawerAbierto) {
            drawerAbierto = false;
            aplicar();
            btnToggle.focus();
        }
    });

    // 8. Al cambiar de tamaño, reorganizar el modo
    mqDesktop.addEventListener('change', () => {
        drawerAbierto = false;
        aplicar();
    });

    // 9. Tooltips cuando está colapsado (accesibilidad)
    document.querySelectorAll('.nav-link').forEach(link => {
        const txt = link.querySelector('.txt-nav');
        if (txt) link.setAttribute('title', txt.textContent.trim());
    });

    // 10. Resaltar la pestaña activa (los ítems ya traen su clase, redundante por claridad)
    document.querySelectorAll('.nav-link').forEach(link => {
        if (link.getAttribute('href') === paginaActual) {
            link.classList.add('bg-blue-600', 'text-white', 'border-l-4', 'border-blue-400');
        }
    });

    // 11. Asignar funcionalidad de cerrar sesión
    document.getElementById('btnCerrarSesionGlobal').addEventListener('click', () => {
        window.clubAuth.cerrarSesion();
    });

    aplicar();
});