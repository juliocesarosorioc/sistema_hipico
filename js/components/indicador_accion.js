// Archivo: js/components/indicador_accion.js
// Propósito: Indicador GLOBAL de acción — un caballito corriendo — que se
// enciende con cualquier petición a Supabase o a la IA (Gemini) y muestra
// la acción exacta que la página está ejecutando + el PORCENTAJE DE AVANCE.
// Expone window.clubIndicador para que cualquier módulo anuncie su acción
// o reporte un progreso real (0 a 1).
// Se instala al ejecutarse (no espera DOMContentLoaded) y ANTES de crear el
// cliente de Supabase (db.js lo carga primero), así toda consulta cuenta.

(function () {
    if (window.clubIndicador) return;

    var pill = null, txt = null, lblProg = null, barra = null;
    var peticiones = 0, timerBarra = null;
    var progreso = 0, activo = false, usaReal = false;
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

    function pintarProgreso() {
        if (barra) barra.style.width = progreso + '%';
        if (lblProg) lblProg.textContent = progreso + '%';
    }

    function tick() {
        if (usaReal) return;
        progreso = Math.min(93, progreso + 13);
        pintarProgreso();
    }

    function activar(url) {
        if (!activo) {
            activo = true;
            usaReal = false;
            progreso = 0;
            pintarProgreso();
        }
        if (pill) {
            if (txt) txt.textContent = mensajeManual || mensajeParaUrl(url);
            pill.classList.remove('hidden');
            pill.classList.add('flex', 'club-accion-on');
        }
        if (!timerBarra) {
            timerBarra = setInterval(tick, 150);
        }
    }

    function desactivar() {
        clearInterval(timerBarra);
        timerBarra = null;
        progreso = 100;
        pintarProgreso();
        if (pill) {
            pill.classList.add('hidden');
            pill.classList.remove('flex', 'club-accion-on');
        }
        var fin = function () {
            if (!activo && !peticiones && !manualActivo) {
                progreso = 0;
                pintarProgreso();
            }
        };
        setTimeout(fin, 500);
    }

    function pintar(url) {
        if (peticiones > 0 || manualActivo) activar(url);
        else if (activo) { activo = false; desactivar(); }
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

    function construir() {
        if (pill) return;

        var style = document.createElement('style');
        style.id = 'clubEstiloCaballo';
        style.textContent = '.caballo-corriendo{display:inline-flex;animation:galopar .45s ease-in-out infinite;filter:drop-shadow(0 0 6px rgba(255,255,255,.55))}' +
            '@keyframes galopar{0%,100%{transform:translateY(0) rotate(-7deg)}25%{transform:translateY(-2px) rotate(4deg)}50%{transform:translateY(0) rotate(-7deg)}75%{transform:translateY(-2px) rotate(4deg)}}' +
            '.lineas-carrera{display:inline-flex;gap:3px;align-items:center;height:14px;overflow:hidden}' +
            '.lineas-carrera i{width:5px;height:5px;border-radius:50%;background:rgba(255,255,255,.95);filter:blur(.5px);animation:correr-l .5s linear infinite}' +
            '.lineas-carrera i:nth-child(2){animation-delay:.16s}' +
            '.lineas-carrera i:nth-child(3){animation-delay:.32s}' +
            '@keyframes correr-l{0%{transform:translateX(8px);opacity:0}25%{opacity:1}100%{transform:translateX(-14px);opacity:0}}' +
            '.club-accion-on{animation:club-pulso 1.2s ease-in-out infinite}' +
            '@keyframes club-pulso{0%,100%{box-shadow:0 0 0 0 rgba(16,255,160,.6)}60%{box-shadow:0 0 0 12px rgba(16,255,160,0)}}';
        document.head.appendChild(style);

        pill = document.createElement('div');
        pill.id = 'clubAccion';
        pill.className = 'hidden fixed bottom-24 right-4 z-[70] items-center gap-2.5 rounded-full pl-3 pr-3 py-2 bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-500 text-white text-sm font-black uppercase tracking-wide border-2 border-emerald-300 shadow-[0_10px_35px_rgba(16,255,160,.5)]';
        pill.setAttribute('role', 'status');
        pill.setAttribute('aria-live', 'polite');
        pill.innerHTML = '<span class="caballo-corriendo"><i class="fas fa-horse text-3xl text-white"></i></span>' +
            '<span class="lineas-carrera" aria-hidden="true"><i></i><i></i><i></i></span>' +
            '<span>Procesando…</span>' +
            '<span class="inline-flex items-center justify-center min-w-[52px] px-2 py-1 rounded-full bg-white text-emerald-700 border border-emerald-400 font-black text-xs tabular-nums">0%</span>';
        document.body.appendChild(pill);
        txt = pill.children[2];
        lblProg = pill.querySelector('span:last-child');

        barra = document.createElement('div');
        barra.id = 'barraProgreso';
        barra.className = 'fixed top-0 left-0 h-1.5 bg-gradient-to-r from-emerald-400 via-green-500 to-cyan-400 z-[70] transition-all duration-200 shadow-[0_0_14px_rgba(52,211,153,.9)]';
        barra.style.width = '0%';
        document.body.appendChild(barra);
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
        // Reporta progreso real (0 a 1). Con cualquier valor >0 detiene la
        // barra animada (fake) y muestra el porcentaje real del módulo.
        progreso: function (frac) {
            var v = parseFloat(frac);
            if (isNaN(v) || v <= 0) return;
            if (!activo) activar();
            usaReal = true;
            progreso = Math.round(Math.min(1, v) * 100);
            pintarProgreso();
        }
    };

    construir();
})();