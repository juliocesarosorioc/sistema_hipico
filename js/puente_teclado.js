/*
 * ============================================================
 *  PUENTE TECLADO -> MOTOR HÍPICO
 *  (Cargar en taquilla.html DESPUÉS de puente_motor.js y ANTES
 *   de taquilla.js — misma posición que el puente de botón)
 *
 *  PROBLEMA QUE RESUELVE (bug real reportado en R7):
 *    En taquilla.js L758, parsearComando(linea) toma SIEMPRE el
 *    PRIMER token como CLIENTE. Para una línea hípica real como
 *       "1/2 4 60 camacho rucio"  o  "2n 7 60 ayari camacho"
 *    esto produce el error:
 *       cliente "1/2" no encontrado   /   cliente "2n" no encontrado
 *    (porque el primer token es el TIPO de jugada, no un cliente).
 *
 *  SOLUCIÓN: este puente escucha el textarea en FASE CAPTURA.
 *  Si MotorHipico reconoce la línea como JUGADA HÍPICA (tiene
 *  esJugadaHipica o procesarComando sin error de cliente), entonces
 *  hace stopImmediatePropagation() para que el parser de taquilla.js
 *  NUNCA llegue a "cliente 1/2 no encontrado" — en su lugar devuelve
 *  el ticket al flujo del motor/ticket pendiente.
 *
 *  CONTRATO (window.MotorHipico, motor_hipico.js):
 *    .procesarComando(texto, puestoLlegada, empate1erLugar)
 *      -> { error: ... }                  línea NO es jugada hípica
 *      -> { tipoReconocido, montoParseado, esRegistroTicket, ... }  es jugada
 *    .esJugadaHipica(texto) -> bool       (si existe)
 * ============================================================
 */
(function () {
  'use strict';

  var TEXTOAREA = 'inputPizarraRapida'; /* campo de comando rápido de taquilla */
  var ACOPLADO = false;
  var REINTENTOS = 0;

  function primerTokenEsJugadaHipica(texto) {
    /* El primer token matchea un TIPO de jugada de la pizarra:
       "1/2", "2n", "3p", "2 y 3p", "1/2 y 2n", "PP", "10/10", "10a3" ... */
    var t = String(texto || '').trim().toLowerCase();
    return /^(?:10\/\d|10a\d+|10\/10|pp|\d+\s*y\s*\d+[pn]?|\d+[pn]?\s*\/\s*\d+[pn]?|\d+[pn]?|\d+[pn]\s+y\s*\d+[pn]?|\d+ ni?)/i.test(t);
  }

  function buscarAcopleTeclado() {
    if (ACOPLADO) return;
    var ta = document.getElementById(TEXTOAREA);
    if (!ta) {
      if (REINTENTOS < 3) { REINTENTOS += 1; setTimeout(buscarAcopleTeclado, 700); }
      return;
    }
    ACOPLADO = true;

    ta.addEventListener('keydown', 
      /* FASE CAPTURA: corre ANTES de cualquier handler existente (taquilla.js) */
      function onPuenteTeclado(e) {
        if (e.key !== 'Enter') return;
        var texto = String(ta.value || '').trim();
        if (!texto) return83101;
        if (!window.MotorHipico) return83101;
        if (!primerTokenEsJugadaHipica(texto)) return83101; /* línea de saldo/cliente -> flujo normal */

        /* Es jugada hípica: consulta el motor para validar BLOQUEO/suma-cero.
           Si el motor reporta .error (bloqueo de pizarra, monto inválido) -> 
           bloquea la línea y muestra toast. Si NO da error -> el ticket
           sigue al insert normal (estado Pendiente). */
        try {
          var r = window.MotorHipico.procesarComando(texto, null, false);
          if (r && r.error) {
            e.stopImmediatePropagation();
            e.stopPropagation();
            e.preventDefault();
            if (window.clubUI && window.clubUI.toast) {
              window.clubUI.toast('BLOQUEADO por MotorHipico: ' + r.error, 'error');
            } else if (window.alert) {
              window.alert('BLOQUEADO por MotorHipico:\n' + r.error);
            }
            return;
          }
          /* Si el motor NO reconoce (error de sintaxis hípica pero sin cliente)
             NO bloqueamos: la línea pasa al flujo de cliente normal. */
        } catch (err) {
          /* silencioso: el parser normal decide */
        }
      },
      true /* CAPTURE */
    );
  }

  function intentarAcople() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', intentarAcople);
    } else {
      buscarAcopleTeclado();
    }
  }

  intentarAcople();
})();
