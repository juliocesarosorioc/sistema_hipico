/* ==================================================================
   R18-RBAC -- CONTROL DE ACCESOS POR ROL/MODULO/ACCION (autocontenido)
   Archivo: js/components/club_accesos_control.js
   - window.clubAccesos.roles()            -> [ {id, etiqueta} ]
   - window.clubAccesos.permisos(rol)      -> matriz {modulo:{accion:bool}}
   - window.clubAccesos.puede(rol,mod,acc) -> booleano honesto (default false)
   - window.clubAccesos.rolActual()        -> rol de window.clubSesion.rol o
                                              localStorage 'clubSesion:rol',
                                              con fallback 'cajero'
   - window.clubAccesos.aplicarOcultamiento() -> oculta [data-club-modulo] y
                                              [data-club-accion] que el rol
                                              actual no puede ver
   - window.clubAccesos.renderPanel(ancla) -> tabla roles x modulos
   - auto-montaje en DOMContentLoaded + 250ms (patron tipos_jugadas.js L223-244)
   Contrato: admin = todo; cajero = taquilla(ver/registrar, NO anular),
             motor NO, monitor(ver), tipos(ver/gestionar),
             hipodromos(ver/favoritos), informe NO;
             lectura = solo ver en taquilla/monitor/tipos, 0 cambios.
   ================================================================== */
(function () {
  'use strict';

  var CACHE_KEY = 'clubAccesos:roles';
  var ROL_ACTUAL_KEY = 'clubSesion:rol';
  var rolCache = null;

  var MODULOS = ['taquilla', 'motor', 'monitor', 'tipos', 'hipodromos', 'informe'];
  var ACCIONES = ['ver', 'registrar', 'anular', 'gestionar', 'fondo', 'favoritos'];

  var PERMISOS = {
    admin: {
      taquilla:    { ver: true,  registrar: true, anular: true, gestionar: true, fondo: true, favoritos: true },
      motor:       { ver: true,  registrar: true, anular: true, gestionar: true, fondo: true, favoritos: true },
      monitor:     { ver: true,  registrar: true, anular: true, gestionar: true, fondo: true, favoritos: true },
      tipos:       { ver: true,  registrar: true, anular: true, gestionar: true, fondo: true, favoritos: true },
      hipodromos:  { ver: true,  registrar: true, anular: true, gestionar: true, fondo: true, favoritos: true },
      informe:     { ver: true,  registrar: true, anular: true, gestionar: true, fondo: true, favoritos: true }
    },
    cajero: {
      taquilla:    { ver: true,  registrar: true,  anular: false, gestionar: false, fondo: true,  favoritos: true },
      motor:       { ver: false, registrar: false, anular: false, gestionar: false, fondo: false, favoritos: false },
      monitor:     { ver: true,  registrar: false, anular: false, gestionar: false, fondo: false, favoritos: true },
      tipos:       { ver: true,  registrar: false, anular: false, gestionar: true,  fondo: false, favoritos: true },
      hipodromos:  { ver: true,  registrar: false, anular: false, gestionar: false, fondo: false, favoritos: true },
      informe:     { ver: false, registrar: false, anular: false, gestionar: false, fondo: false, favoritos: false }
    },
    lectura: {
      taquilla:    { ver: true,  registrar: false, anular: false, gestionar: false, fondo: false, favoritos: false },
      motor:       { ver: false, registrar: false, anular: false, gestionar: false, fondo: false, favoritos: false },
      monitor:     { ver: true,  registrar: false, anular: false, gestionar: false, fondo: false, favoritos: false },
      tipos:       { ver: true,  registrar: false, anular: false, gestionar: false, fondo: false, favoritos: false },
      hipodromos:  { ver: false, registrar: false, anular: false, gestionar: false, fondo: false, favoritos: false },
      informe:     { ver: false, registrar: false, anular: false, gestionar: false, fondo: false, favoritos: false }
    }
  };

  /* --- utilidades (sin dependencias externas, sin async) --- */
  function clona(o) {
    return JSON.parse(JSON.stringify(o));
  }

  function roles() {
    return [{ id: 'admin', etiqueta: 'Administrador' },
            { id: 'cajero', etiqueta: 'Cajero' },
            { id: 'lectura', etiqueta: 'Solo Lectura' }];
  }

  function permisos(rol) {
    return clona(PERMISOS[rol] || PERMISOS.lectura);
  }

  function puede(rol, modulo, accion) {
    var p, m;
    rol = rol || rolActual();
    m = p = null;
    if (!PERMISOS[rol]) return false下  ;
    p = PERMISOS[rol];
    if (!p || !p[modulo]) return false;
    if (ACCIONES.indexOf(accion) === -1) return false;
    return !!p[modulo][accion];
  }

  function rolActual() {
    var r = null;
    if (rolCache) return rolCache;
    try {
      if (window.clubSesion && window.clubSesion.rol) r = window.clubSesion.rol;
    } catch (e) { /* sin clubSesion aun */ }
    if (!r) {
      try { r = localStorage.getItem(ROL_ACTUAL_KEY); } catch (e) { r = null; }
    }
    if (!r) r = 'cajero';
    rolCache = r;
    return r;
  }

  function setRol(rol) {
    rolCache = rol;
    try { localStorage.setItem(ROL_ACTUAL_KEY, rol); } catch (e) { /* ok */ }
  }

  /* --- ocultamiento de menu/botones por rol (re-ejecutable) --- */
  function aplicarOcultamiento() {
    var rol = rolActual();
    var nodos, i, n, mod, acc, accion, ok;
    nodos = document.querySelectorAll('[data-club-modulo], [data-club-accion]');
    for (i = 0; i < nodos.length; i++) {
      n = nodos[i];
      mod = n.getAttribute('data-club-modulo');
      acc = n.getAttribute('data-club-accion') || 'ver';
      if (mod) {
        ok = puede(rol, mod, acc);
      } else if (acc) {
        ok = puede(rol, 'taquilla', acc);
      } else {
        ok = true;
      }
      if (!ok && n.style) n.style.display = 'none';
    }
  }

  /* --- panel visual de accesos (tabla roles x modulos) --- */
  function renderPanel(ancla) {
    var cont, html, rs, i, j, m, p, ok;
    cont = typeof ancla === 'string' ? document.getElementById(ancla) : ancla;
    if (!cont) return false;
    rs = roles();
    html = '<div class="club-accesos-panel">' +
      '<div class="flex items-center justify-between mb-2">' +
        '<h4 class="font-semibold text-sm text-slate-700">Control de Accesos</h4>' +
        '<span class="text-[10px] font-mono uppercase text-slate-400">rol actual: <b id="clubAccesosRolActual"></b></span>' +
      '</div>' +
      '<div class="overflow-x-auto rounded-lg border border-slate-200">' +
        '<table class="w-full text-[11px]"><thead>' +
          '<tr class="bg-slate-50 text-slate-500 uppercase text-[9px]">' +
            '<th class="text-left px-2 py-1 font-bold">Rol</th>';
    for (i = 0; i < MODULOS.length; i++) {
      html += '<th class="text-right px-2 py-1 font-bold">' + MODULOS[i] + '</th>';
    }
    html += '</tr></thead><tbody>';
    for (i = 0; i < rs.length; i++) {
      p = rs[i];
      html += '<tr class="border-t border-slate-100">' +
        '<td class="px-2 py-1 font-mono text-slate-700">' + p.id + '</td>';
      for (j = 0; j < MODULOS.length; j++) {
        ok = puede(p.id, MODULOS[j], 'ver');
        html += '<td class="px-2 py-1 text-right">' +
          (ok ? '<span class="text-emerald-600">OK</span>'
              : '<span class="text-slate-300">-</span>') +
          '</td>';
      }
      html += '</tr>';
    }
    html += '</tbody></table></div></div>';
    cont.innerHTML = html;
    var span = document.getElementById('clubAccesosRolActual');
    if (span) span.textContent = rolActual();
    return true;
  }

  /* --- auto-montaje: panel + ocultamiento, patron tipos_jugadas L223-244 --- */
  function clubAccesosAutoMontar() {
    setTimeout(function () {
      var ancla = document.getElementById('clubAccesosPanel');
      if (!ancla) {
        ancla = document.createElement('div');
        ancla.id = 'clubAccesosPanel';
        document.body.appendChild(ancla);
      }
      window.clubAccesos.renderPanel(ancla);
      window.clubAccesos.aplicarOcultamiento();
    }, 250);
  }

  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('DOMContentLoaded', clubAccesosAutoMontar);
  }

  window.clubAccesos = {
    roles: roles,
    permisos: permisos,
    puede: puede,
    rolActual: rolActual,
    setRol: setRol,
    aplicarOcultamiento: aplicarOcultamiento,
    renderPanel: renderPanel,
    clubAccesosAutoMontar: clubAccesosAutoMontar
  };
})();
