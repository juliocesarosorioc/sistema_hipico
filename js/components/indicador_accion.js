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
            pill.classList.remove('club-oculto');
            pill.classList.add('club-on');
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
            pill.classList.remove('club-on');
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
        style.textContent = '.club-pill{position:fixed;right:14px;bottom:92px;z-index:70;display:none;align-items:center;gap:9px;' +
            'background:linear-gradient(135deg,#059669 0%,#10b981 55%,#0d9488 100%);color:#fff;' +
            'font-size:13px;font-weight:800;letter-spacing:.02em;line-height:1;' +
            'border:2px solid #6ee7b7;border-radius:999px;padding:9px 11px;max-width:min(92vw,540px);' +
            'box-shadow:0 10px 30px rgba(16,185,129,.45),0 4px 14px rgba(0,0,0,.25);animation:club-pulso 1.4s ease-in-out infinite}' +
            '.club-pill.club-on{display:flex}' +
            '.club-pill.club-oculto{display:none!important}' +
            '@keyframes club-pulso{0%,100%{box-shadow:0 0 0 0 rgba(16,255,160,.55),0 10px 30px rgba(16,185,129,.45)}60%{box-shadow:0 0 0 10px rgba(16,255,160,0),0 10px 30px rgba(16,185,129,.45)}}' +
            '.club-pill .clb-icon{font-size:22px;color:#fff}' +
            '.club-pill .clb-txt{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
            '.club-pill .clb-pct{display:inline-flex;align-items:center;justify-content:center;min-width:52px;padding:4px 9px;border-radius:999px;' +
            'background:#fff;color:#047857;border:1px solid #10b981;font-size:12px;font-weight:900;font-variant-numeric:tabular-nums;flex:none}' +
            '.club-pill .clb-cerrar{display:inline-flex;align-items:center;justify-content:center;width:21px;height:21px;border-radius:999px;' +
            'background:rgba(0,0,0,.22);color:#fff;font-size:11px;font-weight:900;line-height:1;cursor:pointer;border:0;flex:none}' +
            '.club-pill .clb-cerrar:hover{background:rgba(0,0,0,.45)}' +
            '.club-pill .caballo-corriendo{display:inline-flex;flex:none;animation:galopar .45s ease-in-out infinite;filter:drop-shadow(0 0 6px rgba(255,255,255,.55))}' +
            '@keyframes galopar{0%,100%{transform:translateY(0) rotate(-7deg)}25%{transform:translateY(-2px) rotate(4deg)}50%{transform:translateY(0) rotate(-7deg)}75%{transform:translateY(-2px) rotate(4deg)}}' +
            '.lineas-carrera{display:inline-flex;gap:3px;align-items:center;height:14px;overflow:hidden;flex:none}' +
            '.lineas-carrera i{width:5px;height:5px;border-radius:50%;background:rgba(255,255,255,.95);filter:blur(.5px);animation:correr-l .5s linear infinite}' +
            '.lineas-carrera i:nth-child(2){animation-delay:.16s}' +
            '.lineas-carrera i:nth-child(3){animation-delay:.32s}' +
            '@keyframes correr-l{0%{transform:translateX(8px);opacity:0}25%{opacity:1}100%{transform:translateX(-14px);opacity:0}}' +
            '.club-barra{position:fixed;top:0;left:0;height:6px;width:0%;z-index:70;' +
            'background:linear-gradient(90deg,#34d399,#22c55e,#22d3ee);box-shadow:0 0 14px rgba(52,211,153,.95);transition:width .22s ease}';
        document.head.appendChild(style);

        pill = document.createElement('div');
        pill.id = 'clubAccion';
        pill.className = 'club-pill';
        pill.setAttribute('role', 'status');
        pill.setAttribute('aria-live', 'polite');
        pill.innerHTML = '<span class="caballo-corriendo"><i class="fas fa-horse clb-icon"></i></span>' +
            '<span class="lineas-carrera" aria-hidden="true"><i></i><i></i><i></i></span>' +
            '<span class="clb-txt">Procesando…</span>' +
            '<span class="clb-pct">0%</span>' +
            '<button type="button" class="clb-cerrar" title="Ocultar este aviso" aria-label="Ocultar"><i class="fas fa-xmark"></i></button>';
        document.body.appendChild(pill);
        txt = pill.querySelector('.clb-txt');
        lblProg = pill.querySelector('.clb-pct');
        pill.querySelector('.clb-cerrar').addEventListener('click', function (e) {
            e.stopPropagation();
            pill.classList.add('club-oculto');
        });

        barra = document.createElement('div');
        barra.id = 'barraProgreso';
        barra.className = 'club-barra';
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