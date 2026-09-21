/*
 * HIPODROMOS � FAVORITOS (R14 item 2)
 * -----------------------------------
 * COMPONENTE EXTERNO, riesgo 0: NO toca hipodromos.js ni el HTML.
 * Lee el grid REAL que pinta hipodromos.js (L71):
 *   cuerpoTabla.innerHTML = datos.map(h => tarjeta)
 * y agrega a CADA tarjeta un boton � (capture, stopImmediatePropagation ->
 * no llega al click original de hipodromos.js). Favoritos se persisten en
 * localStorage (clubFavHipodromos) y el badge flotante "� N" vive abajo-
 * derecha. Confirmacion via toast ra-ida (clubIndicador) si existe.
 *
 * EXPONE (window.clubFavHipodromos):
 *   .lista()            -> [{sigla,nombre}]
 *   .toggle(sigla,nombre)-> {ok:true,fav:bool} | {error}
 *   .esFav(sigla)       -> bool
 *   .renderBadge()      -> actualiza el contador flotante
 * ============================================================
 */
(function () {
  'use strict';
  var CACHE_KEY = 'clubFavHipodromos';
  var cache = null;
  var BADGE = null;
  var CONTADOR = 0;

  function cargar() {
    if (cache !== null) return cache;
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      cache = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(cache)) cache = [];
    } catch (e) { cache = []; }
    return cache;
  }
  function guardar() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch (e) {}
  }
  function lista() { return cargar().slice(); }
  function esFav(sigla) {
    var s = String(sigla || '').trim().toLowerCase();
    return cargar().some(function (f) { return String(f.sigla).toLowerCase() === s; });
  }
  function toggle(sigla, nombre) {
    var s = String(sigla || '').trim();
    if (!s) return { error: 'sigla vacia' };
    var i = cargar().findIndex(function (f) { return String(f.sigla).toLowerCase() === s.toLowerCase(); });
    if (i >= 0) { cache.splice(i, 1); } else { cache.push({ sigla: s, nombre: String(nombre || s) }); }
    guardar();
    renderBadge();
    return { ok: true, fav: i < 0, total: cache.length };
  }
  function renderBadge() {
    if (BADGE) {
      BADGE.textContent = '� ' + cargar().length;
      BADGE.style.display = cargar().length ? 'inline-flex' : 'none';
    }
  }
  function crearBadge() {
    if (BADGE || !document.body) return;
    BADGE = document.createElement('button');
    BADGE.type = 'button';
    BADGE.id = 'clubFavHipodromosBadge';
    BADGE.className = 'fixed bottom-4 right-4 z-[90] inline-flex items-center gap-1 ' +
      'px-2.5 py-1 rounded-full text-[11px] font-bold text-white bg-amber-500 ' +
      'hover:bg-amber-600 shadow-lg';
    BADGE.title = 'Hipodromos favoritos: clic para ver';
    BADGE.onclick = verLista;
    document.body.appendChild(BADGE);
    renderBadge();
  }
  function verLista() {
    var arr = cargar();
    if (!arr.length) { notificar('Aun no tienes hipodromos favoritos'); return; }
    notificar('Favoritos: ' + arr.map(function (f) { return f.nombre || f.sigla; }).join(' | '));
  }
  function notificar(msg) {
    if (window.clubIndicador && window.clubIndicador.mensajeRapido) { window.clubIndicador.mensajeRapido(msg); }
    else if (window.clubUI && window.clubUI.toast) { window.clubUI.toast(msg); }
    else if (window.alert) { window.alert(msg); }
  }
  function marcarTarjetas() {
    crearBadge();
    var cont = document.getElementById('cuerpoTabla');
    if (!cont || !cont.children) return;
    var nodos = Array.prototype.slice.call(cont.children).filter(function (n) {
      return n && n.nodeType === 1 && n.className && String(n.className).indexOf('hipo') >= 0;
    });
    if (!nodos.length) {
      /* grid generado por L71 datos.map(h => ...) — esperar re-render */
      setTimeout(marcarTarjetas, 700);
      return;
    }
    nodos.forEach(function (n) { if (!n.getAttribute('data-fav-montado')) montarFav(n); });
  }
  function montarFav(tarjeta) {
    tarjeta.setAttribute('data-fav-montado', '1');
    var sigla = tarjeta.getAttribute('data-sigla') || '';
    var nombre = tarjeta.getAttribute('data-nombre') || sigla;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'ml-auto text-[13px] leading-none ' + (esFav(sigla) ? 'text-amber-500' : 'text-slate-300 hover:text-amber-500');
    b.title = (esFav(sigla) ? 'Quitar de favoritos' : 'Agregar a favoritos');
    b.textContent = '�';
    b.addEventListener('click', function (e) {
      e.stopImmediatePropagation();
      e.preventDefault();
      var r = toggle(sigla, nombre);
      b.textContent = '�';
      b.className = 'ml-auto text-[13px] leading-none ' + (r.fav ? 'text-amber-500' : 'text-slate-300 hover:text-amber-500');
      b.title = (r.fav ? 'Quitar de favoritos' : 'Agregar a favoritos');
      notificar(r.fav ? ('� ' + (nombre || sigla) + ' guardado') : ('� ' + (nombre || sigla) + ' quitado'));
    });
    var enc = tarjeta.querySelector('.flex.items-center');
    if (enc) enc.appendChild(b); else tarjeta.appendChild(b);
  }
  function buscarAcople() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', buscarAcople);
      return;
    }
    marcarTarjetas();
    /* re-anclar si hipodromos.js re-renderiza por busqueda cada 2s */
    setInterval(marcarTarjetas, 2000);
  }
  window.clubFavHipodromos = { lista: lista, toggle: toggle, esFav: esFav, renderBadge: renderBadge };
  buscarAcople();
})();
