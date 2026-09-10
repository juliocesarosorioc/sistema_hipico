// Archivo: js/components/indicador_accion.js
// Propósito: Indicador GLOBAL de acción — un caballito corriendo — que se
// enciende con cualquier petición a Supabase o a la IA (Gemini) y muestra
// la acción exacta que la página está ejecutando. Además expone
// window.clubIndicador para que cualquier módulo anuncie su propia acción.
// Se instala al ejecutarse (no espera DOMContentLoaded) para capturar
// también las primeras cargas de cada módulo.

(function () {
    if (window.clubIndicador) return;

    var pill = null, txt = null, barra = null;
    var peticiones = 0, progreso = 0, timerBarra = null;
    var manualActivo = false, mensajeManual = '';

    var MENSAJES = [
        ['generativelanguage.googleapis.com', 'La IA está leyendo el programa…'],
        ['tickets_apuestas', 'Guardando boletos…'],
        ['tablas_fijas', 'Guardando la tabla…'],
        ['hipodromos', 'Cargando hipódromos…'],
        ['tipos_jugadas', 'Cargando reglas de jugadas…'],
        ['clientes', 'Buscando clientes…'],
        ['grupos_venta', 'Cargando grupos…'],
        ['ejemplares', 'Cargando ejemplares…'],
        ['saldos', 'Consultando liquidación…'],
        ['depositos', 'Registrando ingreso…'],
        ['caja', 'Actualizando caja…'],
        ['bancos', 'Consultando bancos…'],
        ['monedas', 'Cargando monedas…'],
        ['remates', 'Consultando remates…'],
        ['pollas', 'Cargando pollas…'],
        ['gaceta_procesada', 'Guardando la gaceta…'],
        ['auditoria', 'Cargando actividad…'],
        ['venta_tablas', 'Procesando venta…'],
        ['wps', 'Consultando W.P.S…'],
        ['operadores', 'Cargando operadores…'],
        ['portales', 'Consultando el portal…'],
        ['solicitud', 'Enviando solicitud…']
    ];

    function mensajeParaUrl(url) {
        var u = String(url || '').toLowerCase();
        for (var i = 0; i < MENSAJES.length; i++) {
            if (u.indexOf(MENSAJES[i][0]) !== -1) return MENSAJES[i][1];
        }
        return 'Procesando…';
    }

    function construir() {
        if (pill) return;

        var style = document.createElement('style');
        style.id = 'clubEstiloCaballo';
        style.textContent = '.caballo-corriendo{display:inline-flex;animation:galopar .45s ease-in-out infinite}' +
            '@keyframes galopar{0%,100%{transform:translateY(0) rotate(-6deg)}25%{transform:translateY(-2px) rotate(4deg)}50%{transform:translateY(0) rotate(-6deg)}75%{transform:translateY(-2px) rotate(4deg)}}' +
            '.lineas-carrera{display:inline-flex;gap:3px;align-items:center;height:14px;overflow:hidden}' +
            '.lineas-carrera i{width:4px;height:4px;border-radius:50%;background:rgba(16,255,160,.9);filter:blur(.5px);animation:correr-l .5s linear infinite}' +
            '.lineas-carrera i:nth-child(2){animation-delay:.16s}' +
            '.lineas-carrera i:nth-child(3){animation-delay:.32s}' +
            '@keyframes correr-l{0%{transform:translateX(8px);opacity:0}25%{opacity:1}100%{transform:translateX(-14px);opacity:0}}';
        document.head.appendChild(style);

        pill = document.createElement('div');
        pill.id = 'clubAccion';
        pill.className = 'hidden fixed bottom-20 right-4 z-[60] items-center gap-3 bg-slate-900/95 text-white text-xs font-bold rounded-full pl-2 pr-4 py-1.5 shadow-2xl border border-emerald-600/50 backdrop-blur-sm';
        pill.setAttribute('role', 'status');
        pill.setAttribute('aria-live', 'polite');
        pill.innerHTML = '<span class="caballo-corriendo"><i class="fas fa-horse text-emerald-400"></i></span>' +
            '<span class="lineas-carrera" aria-hidden="true"><i></i><i></i><i></i></span>' +
            '<span>Procesando…</span>';
        document.body.appendChild(pill);
        txt = pill.querySelector('span:last-child');

        barra = document.createElement('div');
        barra.id = 'barraProgreso';
        barra.className = 'fixed top-0 left-0 h-1 bg-gradient-to-r from-cyan-500 via-blue-500 to-emerald-500 z-[60] transition-all duration-200';
        barra.style.width = '0%';
        document.body.appendChild(barra);
    }

    function pintar(url) {
        if (peticiones > 0 || manualActivo) {
            if (pill) {
                if (txt) txt.textContent = mensajeManual || mensajeParaUrl(url);
                pill.classList.remove('hidden');
                pill.classList.add('flex');
            }
            if (!timerBarra) {
                timerBarra = setInterval(function () {
                    progreso = Math.min(93, progreso + 13);
                    if (barra) barra.style.width = progreso + '%';
                }, 150);
            }
        } else if (pill) {
            clearInterval(timerBarra);
            timerBarra = null;
            progreso = 100;
            if (barra) barra.style.width = '100%';
            setTimeout(function () {
                if (!peticiones && !manualActivo && barra) barra.style.width = '0%';
            }, 400);
            pill.classList.add('hidden');
            pill.classList.remove('flex');
        }
    }

    function esPeticionPlataforma(url) {
        return typeof url === 'string' &&
            (url.indexOf('supabase.co') !== -1 || url.indexOf('generativelanguage.googleapis.com') !== -1);
    }

    var fetchOriginal = window.fetch.bind(window);
    window.fetch = function (url, opts) {
        var cuenta = esPeticionPlataforma(url);
        if (cuenta) { peticiones++; pintar(url); }
        return fetchOriginal(url, opts).then(
            function (r) { if (cuenta) { peticiones--; pintar(); } return r; },
            function (e) { if (cuenta) { peticiones--; pintar(); } throw e; }
        );
    };

    // La barra arranca al 0 o donde quede; cada detención la resetea sola.
    function detener() {
        clearInterval(timerBarra);
        timerBarra = null;
        progreso = 0;
        if (barra) barra.style.width = '0%';
    }

    window.clubIndicador = {
        // Anuncia una acción del módulo (proceso largo, parseo, IA...).
        // Llame fin() cuando termine para ocultar el caballito.
        accion: function (texto) {
            mensajeManual = String(texto || '').trim();
            manualActivo = !!mensajeManual;
            if (manualActivo) pintar();
        },
        fin: function () {
            mensajeManual = '';
            manualActivo = false;
            pintar();
        },
        _detener: detener
    };

    construir();
})();