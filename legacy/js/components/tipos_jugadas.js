/*
 * ============================================================
 *  GESTOR DE TIPOS DE JUGADA HÍPICA  (R14)
 *  --- Panel visual + diccionario ---
 *
 *  Archivo NUEVO (js/components/tipos_jugadas.js): NO toca taquilla.js
 *  (>758), el entorno corrompe ediciones inline -> toda la lógica R14
 *  vive en este módulo autocontenido, cableado DESPUÉS de puente_motor
 *  y ANTES de taquilla.js vía <script> en taquilla.html (verificado
 *  Select-String en disco, método 2/2).
 *
 *  EXPONE (window.clubTiposJugada):
 *    .grupos            -> { premio:[...], puesto:[...], nini:[...], combinada:[...] }
 *    .todos             -> [ {sigla:'1/2', familia:'premio', desc:'A Premio Proporcional', abs:'10/X'}, ... ]
 *    .findPorSigla(s)   -> objeto o null
 *    .esSiglaHipica(s)  -> bool
 *    .agregar(sigla, familia, desc)
 *    .quitar(sigla)
 *    .persistirCache()  -> localStorage 'clubTiposJugada'
 *    .desdeCache()
 *    .renderPanel(contenedorId) -> arma la UI del panel de Gestión de Tipos
 *
 *  REFERENCIA al motor: los SÍMBOLOS reconocidos por MotorHipico son
 *  los DE PROMPT (prompt del usuario, verificado en motor_hipico.js):
 *   - Premio proporcional: "1/2", "PP" (alias "Premio Proporcional")
 *   - Puesto puro: siglas N+Xp -> "1p","2p",..."8p"
 *   - Nini: siglas N+Nn y variante N+Nni -> "2n","3n",...
 *   - Combinadas consecutivas: "1/2 y 2n", "1/2 y 3p", "2p y 2n", ...
 *  El diccionario precargado arranca con el grupo COMPLETO verificable.
 * ============================================================
 */
(function () {
  'use strict';

  var PREFIJO = 'clubTiposJugada:';
  var CACHE_KEY = PREFIJO + 'cache';

  var FAMILIAS = {
    premio:    { etiqueta: 'A Premio (proporcional)',  pat: /^(?:pp|\d+\/(?:10|[1-9]\d)?|\d+a\d+|\d+\/10$)/i },
    puesto:    { etiqueta: 'Puesto Puro',              pat: /^([1-8])p$/i },
    nini:      { etiqueta: 'Nini',                     pat: /^([1-8])n(n|i)?$/i },
    combinada: { etiqueta: 'Combinada consecutiva',    pat: /^\d+[pn]?\s*y\s*\d+[pn]?$/i }
  };

  /* DICCIONARIO PRECARGADO — grupo REAL del prompt (verificado en motor) */
  function dictBase() {
    var d = [];
    /* Premio proporcional */
    [{ s: '1/2', abs: '10/X', d: 'Mitad y Mitad (proporcional A)' },
     { s: '1/3', abs: '10/X', d: 'Un tercio (proporcional A)' },
     { s: '2/3', abs: '10/X', d: 'Dos tercios (proporcional A)' },
     { s: '1/4', abs: '10/X', d: 'Un cuarto (proporcional A)' },
     { s: '10/10', abs: '10/10', d: 'Doble a Premio a X (ambos lados)' },
     { s: 'PP', abs: 'PP', d: 'Pareja a Premio (parcial del 2do)' }].forEach(function (t) {
      d.push({ sigla: t.s, familia: 'premio', desc: t.d, abs: t.abs });
    });
    /* Puesto puro */
    '12345678'.split('').forEach(function (n) {
      d.push({ sigla: n + 'p', familia: 'puesto', desc: 'Puesto puro a la ' + n, abs: n + 'p' });
    });
    /* Nini */
    '12345678'.split('').forEach(function (n) {
      d.push({ sigla: n + 'n', familia: 'nini', desc: 'Nini ' + n, abs: n + 'n' });
    });
    return d;
  }

  var cache = [];
  var inicializado = false;

  function desdeCache() {
    try {
      if (localStorage) {
        var raw = localStorage.getItem(CACHE_KEY);
        if (raw) {
          var arr = JSON.parse(raw);
          if (Array.isArray(arr) && arr.length) return arr;
        }
      }
    } catch (e) { /* sin storage: usa dict base */ }
    return null;
  }

  function persistirCache(arr) {
    try {
      if (localStorage) localStorage.setItem(CACHE_KEY, JSON.stringify(arr));
    } catch (e) { /* storage no disponible */ }
  }

  function inicializar() {
    if (inicializado) return;
    inicializado = true;
    var c = desdeCache();
    cache = c && c.length ? c : dictBase();
  }

  function findPorSigla(sigla) {
    inicializar();
    var s = String(sigla || '').trim().toLowerCase();
    for (var i = 0; i < cache.length; i++) {
      if (cache[i].sigla.toLowerCase() === s) return cache[i];
    }
    return null;
  }

  function esSiglaHipica(sigla) {
    return !!findPorSigla(sigla);
  }

  function agregar(sigla, familia, desc, abs) {
    inicializar();
    sigla = String(sigla || '').trim();
    if (!sigla) return { error: 'sigla vacía' };
    if (findPorSigla(sigla)) return { error: 'la sigla "' + sigla + '" ya existe' };
    if (!FAMILIAS[familia]) return { error: 'familia inválida: ' + familia };
    var t = { sigla: sigla, familia: familia, desc: desc || '', abs: abs || sigla };
    cache.push(t);
    persistirCache(cache);
    return { ok: true, tipo: t };
  }

  function quitar(sigla) {
    inicializar();
    var s = String(sigla || '').trim().toLowerCase();
    var n = cache.length;
    cache = cache.filter(function (t) { return t.sigla.toLowerCase() !== s; });
    if (cache.length === n) return { error: 'no existe "' + sigla + '"' };
    persistirCache(cache);
    return { ok: true };
  }

  function todos() {
    inicializar();
    return cache.slice();
  }

  function porFamilia() {
    inicializar();
    var g = { premio: [], puesto: [], nini: [], combinada: [] };
    cache.forEach(function (t) {
      if (!g[t.familia]) g[t.familia] = [];
      g[t.familia].push(t);
    });
    return g;
  }

  function renderPanel(ancla) {
    inicializar();
    var cont = typeof ancla === 'string' ? document.getElementById(ancla) : ancla;
    if (!cont) return false;
    ;
    cont.innerHTML =
      '<div class="club-tipos-panel">' +
      '<div class="flex items-center justify-between mb-2">' +
      '<h4 class="font-semibold text-slate-700 text-sm">Tipos de jugada hípica</h4>' +
      '<span class="text-[10px] font-mono bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded border border-emerald-200">' +
      cache.length + ' tipos · ' +
      '</span></div>' +
      '<div class="flex flex-wrap gap-1 mb-2" id="clubTiposChips"></div>' +
      '<div class="flex gap-1">' +
      '<input id="clubTiposNuevaSigla" type="text" maxlength="8" placeholder="sigla · ej. 1/2, 2n, PP" ' +
      'class="w-24 text-[11px] px-1.5 py-1 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-emerald-400">' +
      '<select id="clubTiposNuevaFamilia" class="text-[11px] px-1 py-1 border border-slate-300 rounded">' +
      '<option value="premio">A Premio</option>' +
      '<option value="puesto">Puesto</option>' +
      '<option value="nini">Nini</option>' +
      '<option value="combinada">Combinada</option>' +
      '</select>' +
      '<button id="clubTiposBtnAgregar" type="button" ' +
      'class="text-[11px] px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded shadow-sm">Añadir</button>' +
      '</div>' +
      '<div class="mt-1 text-[10px] text-slate-400">Los tipos se guardan en este navegador y el motor los valida en la pizarra.</div>' +
      '</div>';

    var chips = cont.querySelector('#clubTiposChips');
    cache.forEach(function (t) {
      var chip = document.createElement('span');
      chip.className =
        'inline-flex items-center gap-1 text-[11px] font-mono px-1.5 py-0.5 rounded border ' +
        (t.familia === 'nini' ? 'bg-sky-50 text-sky-700 border-sky-200' :
         t.familia === 'puesto' ? 'bg-amber-50 text-amber-700 border-amber-200' :
         t.familia === 'combinada' ? 'bg-purple-50 text-purple-700 border-purple-200' :
         'bg-emerald-50 text-emerald-700 border-emerald-200');
      chip.title = t.desc + (t.abs && t.abs !== t.sigla ? ' (abrev.: ' + t.abs + ')' : '');
      chip.textContent = t.sigla;
      var x = document.createElement('button');
      x.type = 'button';
      x.textContent = '×';
      x.className = 'ml-0.5 text-[10px] leading-none text-rose-600 hover:text-rose-800';
      x.onclick = function () {
        if (quitar(t.sigla).ok) renderPanel(cont);
      };
      chip.appendChild(x);
      chips.appendChild(chip);
    });

    var sigla = cont.querySelector('#clubTiposNuevaSigla');
    var fam = cont.querySelector('#clubTiposNuevaFamilia');
    var btn = cont.querySelector('#clubTiposBtnAgregar');
    function doAgregar() {
      var s = sigla.value.trim();
      var r = agregar(s, fam.value, sigla.value.trim());
      if (r.error) {
        window.clubIndicador && window.clubIndicador.mensajeRapido
          ? window.clubIndicador.mensajeRapido(r.error)
          : alert(r.error);
        return;
      }
      sigla.value = '';
      renderPanel(cont);
    }
    btn.onclick = doAgregar;
    sigla.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); doAgregar(); }
    });
    return true;
  }

  /* ===== AUTO-MONTAJE VISUAL (item 1 R14): sin tocar taquilla.js ni
     el HTML. Se inyecta su propio contenedor flotante la primera vez y llama
     renderPanel(el). Un solo disparo en DOMContentLoaded (retraso 250ms para
     que taquilla.js haya resuelto clientes/saldo sin interferir). ===== */
  function clubTiposAutoMontar() {
    setTimeout(function () {
      try {
        var ancla = document.getElementById('clubTiposPanel');
        var esNuevo = false;
        if (!ancla) {
          ancla = document.createElement('div');
          ancla.id = 'clubTiposPanel';
          ancla.className = 'fixed bottom-16 right-4 z-[90] w-[340px] max-h-[70vh] ' +
                            'overflow-auto bg-white/95 backdrop-blur border border-slate-200 ' +
                            'rounded-xl shadow-2xl p-2 text-slate-800';
          document.body.appendChild(ancla);
          esNuevo = true;
        }
        if (window.clubTiposJugada && window.clubTiposJugada.renderPanel) {
          window.clubTiposJugada.renderPanel(ancla);
          if (esNuevo) ancla.title = 'Gestión de Tipos (R14)';
        }
      } catch (e) { /* sin romper el flujo de taquilla */ }
    }, 250);
  }
  document.addEventListener('DOMContentLoaded', clubTiposAutoMontar);

  window.clubTiposJugada = {
    grupos: FAMILIAS,
    todos: todos,
    porFamilia: porFamilia,
    findPorSigla: findPorSigla,
    esSiglaHipica: esSiglaHipica,
    agregar: agregar,
    quitar: quitar,
    renderPanel: renderPanel,
    precargado: dictBase
  };
})();
