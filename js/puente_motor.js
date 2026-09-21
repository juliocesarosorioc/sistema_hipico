/*
 * ============================================================
 *  PUENTE MOTOR HÍPICO -> FORMULARIO DE TAQUILLA
 *  (Cargar en taquilla.html ANTES de taquilla.js)
 *
 *  CÓMO FUNCIONA: escucha en FASE CAPTURA el clic de
 *  btnRegistrarCarrera (el handler real del form está en
 *  taquilla.js L223). ANTES de que taquilla.js construya los
 *  tickets (L304-326) y los inserte (L335), este puente:
 *
 *    1) Recorre los tickets que el form VA a insertar.
 *    2) Para cada uno cuyo TIPO es jugada hípica, corre
 *       MotorHipico.procesarComando(monto+tipo, puestoLlegada,
 *       empate1erLugar).
 *    3) Si el motor devuelve un ERROR de pizarra (bloqueo
 *       consecutivo, salto de pizarra, empate 1°, sintaxis no
 *       reconocida) -> stopImmediatePropagation() para que el
 *       handler de taquilla.js NO registre el ticket, y muestra
 *       el toast del error.
 *    4) Si el motor NO reconoce el tipo como jugada hípica
 *       (ej: 'abono', 'retiro', 'aval') -> NO interfiere:
 *       el ticket pasa al flujo normal de taquilla.
 *
 *  CONTRATO (MotorHipico, js/motor_hipico.js):
 *    MotorHipico.procesarComando(comando, puesto, empate1erLugar)
 *      -> { error }                       si BLOQUEADO/no reconocido
 *      -> { esRegistro:true, montoParseado, tipoReconocido }
 *      -> { tipo, monto, estado, detalle, ... } si liquida
 * ============================================================
 */
(function () {
  'use strict';

  /* ---------- Reconocer si un tipo es jugada de pizarra (no saldo) ---------- */
  var TIPOS_HIPICOS = /(?:^| )(\d+(?:\/\d+(?:\.\d+)?)?|pp|10a10|\d+n+|\d+p|\d+(?:[pni])?(?:\s+y\s+|\/)\d+[pni]?)/i;
  /* ej: "100 1/2", "50 PP", "100 2n", "50 2p", "100 1 y 2n", "100 10/2.5" */

  function separarTipo(linea) {
    var t = String(linea || '').trim();
    var m = t.match(/^(\d+(?:\.\d+)?)\s+(.+)$/);
    if (!m) return { monto: null, tipo: t, linea: t };
    return { monto: m[1], tipo: m[2], linea: t };
  }

  function esComandoDeSaldo(linea) {
    return /^(abono|retiro|retirar|otorgar[_\s]?aval|pagar[_\s]?aval|traslado|trasladar|aval|libre)\b/i.test(String(linea || '').trim());
  }

  /* ---------- Validación del lote completo ---------- */
  function validarLoteTickets(tickets) {
    if (!window.MotorHipico) return null;
    if (!tickets || !tickets.length) return null     ;

    for (var i = 0; i < tickets.length; i++) {
      var tk = tickets[i];
      var linea = (String(tk.nombre_jugada || '') + ' ' + String(tk.caballo || '') + ' ' + String(tk.monto_jugado || '')).trim();

      /* Si es comando de saldo -> fuera de dominio del motor. */
      if (esComandoDeSaldo(linea)) continue;
      /* Si no parece jugada hípica -> fuera de dominio. */
      if (!TIPOS_HIPICOS.test(linea)) continue;

      var puesto = (typeof window.clubPuestoLlegada !== 'undefined') ? window.clubPuestoLlegada : null;
      var empate = (typeof window.clubEmpate1erLugar !== 'undefined') ? !!window.clubEmpate1erLugar : false;
      try {
        var a = window.MotorHipico.procesarComando(linea, puesto, empate);
        if (a && a.error) return { error: a.error, ticket: tk, linea: linea };
      } catch (e) {
        return { error: 'MotorHipico: ' + (e && e.message ? e.message : String(e)), ticket: tk, linea: linea };
      }
    }
    return null;
  }

  /* ---------- Interceptor en FASE CAPTURA ---------- */
  var ID = 'btnRegistrarCarrera';
  var btnRegistrar = null;
  var CONTROLADOR_ACTIVO = false;

  function intentarAcoplar() {
    if (CONTROLADOR_ACTIVO) return;
    var btn = document.getElementById(ID);
    if (!btn) return;

    CONTROLADOR_ACTIVO = true;
    btn.addEventListener('click', function (e) {
      /* Recoger tickets del form (misma lectura que taquilla.js L302-326). */
      var filas = document.querySelectorAll('.fila-ticket');
      if (!filas.length) return;

      var tickets = [];
      filas.forEach(function (tr) {
        var jugada = tr.querySelector('.in-jugada')?.value?.trim() || '';
        var caballo = tr.querySelector('.in-caballo')?.value?.trim() || '';
        var monto = parseFloat(tr.querySelector('.in-monto')?.value) || 0;
        var nombre = tr.querySelector('.in-juega')?.value?.trim() || '';
        if (jugada && caballo && monto > 0 && nombre) {
          tickets.push({ nombre_jugada: jugada, caballo: caballo, monto_jugado: monto, cliente: nombre });
        }
      });

      var fallo = validarLoteTickets(tickets);
      if (fallo) {
        e.stopImmediatePropagation();
        e.preventDefault();
        e.stopPropagation();
        if (window.clubUI && window.clubUI.toast) {
          window.clubUI.toast('BLOQUEADO por MotorHipico: ' + fallo.error, 'error');
        } else if (window.alert) {
          window.alert('BLOQUEADO por MotorHipico:\n' + fallo.error);
        }
        return;
      }
    }, true /* CAPTURE: corre ANTES del handler de taquilla.js */);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', intentarAcoplar);
  } else {
    intentarAcoplar();
  }
  /* Reintento defensivo: si el DOM llegó con el botón aún por renderizar. */
  setTimeout(intentarAcoplar, 800);
})();
