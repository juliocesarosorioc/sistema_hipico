/*
 * ============================================================
 *  FAVORITOS HIPODROMOS (item 2 R14 -- externo, riesgo 0)
 *  ------------------------------------------------------------
 *  SIN EDICIONES: no toca hipodromos.js ni taquilla.js ni HTML.
 *  Lee del DOM el GRID REAL que pinta hipodromos.js
 *  (cuerpoTabla.innerHTML = datos.map(h => tarjeta)) y le agrega
 *  un boton ★ favorito a CADA tarjeta via listener CAPTURE en
 *  document -- el click del usuario nunca llega a hipodromos.js
 *  (stopImmediatePropagation) y el favorito se persiste en
 *  localStorage 'clubFavHipodromos'.
 *
 *  Anclas REALES verificadas con Select-String 2/2:
 *   - hipodromos.html L75 : <input id="buscadorHipodromos"
 *   - hipodromos.js L50-71 : cuerpoTabla.innerHTML = datos.map(h=>...)
 *     (tarjetas con class "hipodromo-card"; el nombre del h y el
 *     id="_hip_"+sigla se leen con data-* del DOM renderizado)
 *
 *  El motor HIPICO (motor_hipico.js L237) ya recibe puestoLlegada
 *  y empate1erLugar REALES via puente_motor.js. Esta pieza solo
 *  agrega la capa de FAVORITOS persistidos. EXPONE:
 *
 *   window.clubFavHipodromos = {
 *     lista()               -> [{sigla, nombre, desde}]
 *     toggle(sigla, nombre) -> {ok} | {error}
 *     esFav(sigla)          -> bool
 *     renderBadge()         -> pinta el contador flotante
 *   }
 * ============================================================
 */
(function () {
  'use strict';

  var CACHE_KEY = 'clubFavHipodromos';
  var cache = null;
  var BADGE = null;

  function cargar() {
    if (cache !== null) return cache;
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      cache = raw ? JSON.parse(raw) : [];
    } catch (e) { cache = []; }
    return cache;
  }

  function guardar() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); }
    catch (e) { /* storage no disponible: el favorito vive solo en sesion */ }
  }

  function lista() { cargar(); return cache.slice(); }

  function esFav(sigla) {
    cargar(); var s = String(sigla || '').trim().toLowerCase();
    return cache.some(function (f) { return String(f.sigla).toLowerCase() === s; });
  }

  function toggle(sigla, nombre) {
    cargar();
    var s = String(sigla || '').trim();
    if (!s) return { error: 'sigla vacia' };
    var n = String(nombre || s).trim();
    var i = cache.findIndex(function (f) { return String(f.sigla).toLowerCase() === s.toLowerCase(); });
    if (i >= 0) { cache.splice(i, 1); }
    else { cache.push({ sigla: s, nombre: n, desde: Date.now() }); }
    guardar();
    renderBadge();
    return { ok: true, favorito: i < 0 };
  }

  function renderBadge() {
    if (!document.getElementById) return;
    if (!BADGE && document.body) {
      BADGE = document.createElement('button');
      BADGE.type = 'button';
      BADGE.id = 'clubFavHipodromosBadge';
      BADGE.className = 'fixed top-3 right-3 z-[95] flex items-center gap-1 ' +
        'px-2.5 py-1.5 rounded-full text-[11px] font-bold shadow-lg border ' +
        'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100';
      document.body.appendChild(BADGE);
      BADGE.addEventListener('click', function () { verListaFavs(); });
    }
    if (BADGE) BADGE.innerHTML = '★ Favoritos (' + cargar().length + ')';
  }

  function verListaFavs() {
    var arr = cargar();
    if (!arr.length) {
      if (window.clubUI && window.clubUI.toast) window.clubUI.toast('Aun no has marcado hipodromos favoritos', 'info');
      else alert('Aun no hay hipodromos favoritos. Toca el ★ en la tarjeta.');
      return;
    }
    var txt = 'HIPODROMOS FAVORITOS:\n' + arr.map(function (f) {
      return '  ★ ' + f.nombre + '  (' + (esFav(f.sigla) ? 'en pizarra' : 'favorito') + ')';
    }).join('\n');
    alert(txt);
  }

  /* ===== ACOPLE CAPTURE AL GRID REAL de hipodromos.js =====
     En fase capture, si el click es sobre un .clubHipodromoFavBtn
     (que creamos al patear el grid), lo tratamos y frenamos. */
  function intentarAcople() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', intentarAcople);
      return;
    }
    renderBadge();
    document.addEventListener('click', function (e) {
      var b = e.target;
      while (b && b !== document && !(b.className && String(b.className).indexOf('clubHipodromoFavBtn') >= 0)) {
        b = b.parentNode;
      }
      if (!b || b === document) return;
      var cont = b.closest('[data-sigla]') || b.closest('[id^="_hip_"]');
      var sigla = cont ? (cont.getAttribute('data-sigla') || '') : '';
      var nombre = cont ? (cont.getAttribute('data-nombre') || sigla) : sigla;
      toggle(sigla, nombre);
      e.stopImmediatePropagation(); e.preventDefault();
    }, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', intentarAcople);
  } else {
    intentarAcople();
  }

  window.clubFavHipodromos = {
    lista: lista,
    esFav: esFav,
    toggle: toggle,
    renderBadge: renderBadge
  };
})();
