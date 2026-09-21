/*
 * ============================================================
 *  MOTOR HÍPICO — Liquidación financiera de la Pizarra
 *  Sistema "Club del Dinero" — Taquilla (Gestión de Jugadas)
 * ============================================================
 *  CONTRATO DEL MOTOR (común con taquilla.js):
 *    MotorHipico.procesarComando(comandoTexto, puestoLlegada, empate1erLugar)
 *      -> SI el puesto aun no llega (puestoLlegada === null):
 *           { error:null, esRegistro:true, tipoReconocido, montoParseado }
 *           → el ticket se inserta en Supabase con estado PENDIENTE.
 *      -> SI llega el resultado (puestoLlegada !== null):
 *           { error:null, tipoReconocido, montoParseado, estadoFINAL,
 *             totalClienteNeto, balanceBanca, comisionCasa }
 *
 *  REGLAS FINANCIERAS DE LA CASA (100% fieles al pedido):
 *    A) Suma cero: lo que el jugador pierde lo gana el banquero al 100%
 *       (balanceBanca = -totalClienteBruto en jugadas perdidas) y lo que
 *       gana lo paga el banquero (balanceBanca negativo por esa ganancia).
 *    B) Comisión de la Casa = 10% SOBRE LA GANANCIA NETA del jugador
 *       (clienteBruto - montoInvertido), dejando el CAPITAL invertido
 *       INTACTO. Si no hay ganancia neta → comisión 0.
 *
 *  SINTÁXIS DE LA PIZARRA (los tipos reales que reconoce):
 *    [Monto] [Jugada]  — monto primero, sin signo de dólar, separado por espacio.
 *    Jugada a PREMIO:   "10/2.5", "10/10", "10a3", "PP", "10/1" ...
 *    Jugada NINI UNICO: "2n", "3nn", "4n" ...
 *    Jugada PUESTO:     "1p", "2p", "3p" ...
 *    Combinada CONSECUTIVA: "1 y 2p", "1/2", "2 y 3n", "2n y 3p" ...
 *       REGLA ESTRICTA DE PIZARRA: la 2ª parte debe ser igual a la 1ª
 *       o su inmediato superior (P2 = P1 o P1+1). SI HAY SALTO → la
 *       jugada QUEDA BLOQUEADA (error) y NO se registra en la banca.
 *
 *  EJEMPLOS REALES DE TAQUILLA:
 *    "100 1/2"        -> Combinada 1° y 2°, monto 100
 *    "50 PP"          -> A Premio (10/10), monto 50
 *    "100 2n"         -> Nini único 2n, monto 100
 *    "50 2 y 3p"      -> Combinada 2p y 3p consecutivas, monto 50
 *    "100 10/2.5"     -> A Premio proporción 10:2.5, monto 100
 * ============================================================
 */
(function () {
  'use strict';

  var TASA_COMISION = 10; // % sobre ganancia neta del jugador

  /* ---------- Utilidad de construcción de respuesta ---------- */
  function buildRegistroValido(tipo, monto) {
    return { error: null, esRegistro: true, tipoReconocido: tipo, montoParseado: monto };
  }

  function buildResultado(tipo, montoInv, estado, detalle, clienteBruto, balanceBanca) {
    var gananciaBruta = clienteBruto - montoInv;
    var comision = 0;
    var clienteNeto = clienteBruto;

    // Comisión SOLO sobre la ganancia neta; el capital queda intacto.
    if (gananciaBruta > 0) {
      comision = gananciaBruta * (TASA_COMISION / 100);
      clienteNeto = parseFloat((clienteBruto - comision).toFixed(2));
    }

    return {
      error: null,
      esRegistro: false,
      tipoReconocido: tipo,
      montoParseado: montoInv,
      estadoFinal: estado,
      detalleExplicativo: detalle,
      totalClienteNeto: parseFloat(clienteNeto.toFixed(2)),
      balanceBanca: parseFloat(balanceBanca.toFixed(2)),
      comisionCasa: parseFloat(comision.toFixed(2))
    };
  }

  /* ---------- 1. Jugada a PREMIO (10/X y PP) ---------- */
  /* Gana SOLO si el ejemplar llega 1° en solitario; empate en 1° → anulada
     (devuelve capital). Pago proporcional: monto * (X / 10). */
  function liquidarPremio(monto, jugada, puesto, empate1erLugar) {
    if (puesto === null) return buildRegistroValido('A PREMIO (' + jugada.toUpperCase() + ')', monto);

    if (empate1erLugar) {
      return buildResultado('A PREMIO (' + jugada.toUpperCase() + ')', monto, 'ANULADA',
        'Empate en 1er lugar: se devuelve el capital.', monto, 0);
    }

    var proporcion = 10;
    var m = jugada.match(/^(?:10\/|10a|10\/10|PP)([0-9]*\.?[0-9]+)?$/i);
    if (m && m[1]) proporcion = parseFloat(m[1]);

    if (puesto !== 1) {
      return buildResultado('A PREMIO (' + jugada.toUpperCase() + ')', monto, 'PERDIDO',
        'No llegó 1° en solitario.', 0, monto);
    }

    var premio = monto * (proporcion / 10); // ganancia del jugador
    return buildResultado('A PREMIO (' + jugada.toUpperCase() + ')', monto, 'GANADORA',
      'Acierto 1° en solitario · paga ' + proporcion + ':10.', monto + premio, -premio);
  }

  /* ---------- 2. PUESTO puro (1p, 2p, 3p...) ---------- */
  /* Gana si llega <= N. La jugada 1p se anula si hay empate en el 1er lugar. */
  function liquidarPuestoUnico(monto, lim, sufijo, puesto, empate1erLugar) {
    if (puesto === null) return buildRegistroValido('PUESTO ' + lim + sufijo, monto);

    var sufi = (sufijo || 'p').toLowerCase();
    if (sufi === 'n') {
      // Nini único (2n): EMPATA (devuelve capital) si llega exactamente en N;
      // gana si llega < N; pierde si llega > N.
      if (puesto === lim) {
        return buildResultado('PUESTO ' + lim + 'n', monto, 'EMPATA',
          'Llegó exactamente ' + lim + '°. Se devuelve el capital.', monto, 0);
      }
      if (puesto < lim) {
        return buildResultado('PUESTO ' + lim + 'n', monto, 'GANADORA',
          'Llegó antes de ' + lim + '° (' + puesto + '°).', monto * 2, -monto);
      }
      return buildResultado('PUESTO ' + lim + 'n', monto, 'PERDIDO',
        'Llegó ' + puesto + '° (mayor que ' + lim + '°).', 0, monto);
    }

    // Puesto puro (1p puro): anula si empate en el 1er lugar.
    if (lim === 1 && empate1erLugar) {
      return buildResultado('PUESTO 1p', monto, 'ANULADA',
        'Empate en 1er lugar: se devuelve el capital.', monto, 0);
    }

    if (puesto <= lim) {
      return buildResultado('PUESTO ' + lim + 'p', monto, 'GANADORA',
        'Llegó ' + puesto + '° (dentro de ' + lim + '°).', monto * 2, -monto);
    }
    return buildResultado('PUESTO ' + lim + 'p', monto, 'PERDIDO',
      'Llegó ' + puesto + '° (mayor que ' + lim + '°).', 0, monto);
  }

  /* ---------- 3. COMBINADA consecutiva (1/2, 2 y 3p, 2n y 3p...) ---------- */
  /* Divide el monto 50/50 entre ambos tramos.
     REGLA ESTRICTA DE PIZARRA: P2 debe ser P1 o P1+1. Salto → BLOQUEADA. */
  function liquidarCombinada(monto, p1, sufijo1, p2, sufijo2, puesto, empate1erLugar) {
    var s1 = (sufijo1 || 'p').toLowerCase();
    var s2 = (sufijo2 || 'p').toLowerCase();

    // BLOQUEO DE PIZARRA: puestos deben ser consecutivos (P2 = P1 o P1+1).
    if (p2 !== p1 && p2 !== p1 + 1) {
      return { error: 'BLOQUEO DE PIZARRA: los puestos ' + p1 + ' y ' + p2 +
        ' no son consecutivos (deben ser iguales o P2 = P1+1). La jugada no se registra.' };
    }

    if (puesto === null) {
      return buildRegistroValido('COMBINADA (' + p1 + s1 + ' y ' + p2 + s2 + ')', monto);
    }

    var mitad = monto / 2;
    var clienteBruto = 0;
    var balanceBanca = 0;

    /* Tramo 1 (mitad) */
    if (p1 === 1 && empate1erLugar) {
      clienteBruto += mitad; // anulada por empate → devuelve este tramo
    } else if (puesto <= p1) {
      clienteBruto += mitad * 2;
      balanceBanca -= mitad;
    } else {
      balanceBanca += mitad/prima;
    }

    /* Tramo 2 (mitad) */
    if (s2 === 'n') {
      if (puesto === p2) {
        clienteBruto += mitad; // empate en posición → devuelve capital de este tramo
      } else if (puesto < p2) {
        clienteBruto += mitad * 2;
        balanceBanca -= mitad;
      } else {
        balanceBanca += mitad;
      }
    } else {
      if (puesto <= p2) {
        clienteBruto += mitad * 2;
        balanceBanca -= mitad;
      } else {
        balanceBanca += mitad;
      }
    }

    var estado = clienteBruto > monto ? 'GANADORA' : (clienteBruto === monto ? 'EMPATA' : 'PERDIDO');
    return buildResultado('COMBINADA (' + p1 + s1 + ' y ' + p2 + s2 + ')', monto, estado,
      'Liquidación 50/50 por tramo.', clienteBruto, balanceBanca);
  }

  /* ---------- PARSER de la jugada (monto primero) ---------- */
  function parsearComandoMotor(comandoRaw, puestoLlegada, empate1erLugar) {
    var texto = String(comandoRaw || '').trim();

    // Primer token = monto (ej: "100 1/2", "50 PP", "100 2 y 3p")
    var matchMonto = texto.match(/^(\d+(?:\.\d+)?)\s+(.*)$/);
    if (!matchMonto) {
      return { error: "Inicie con el monto (ej: '100 1/2', '50 PP', '100 2n')." };
    }

    var monto = parseFloat(matchMonto[1]);
    if (!(monto > 0)) {
      return { error: 'Monto inválido: debe ser mayor a cero.' };
    }
    var jugada = matchMonto[2].trim().toLowerCase();

    /* 1) Combinada consecutiva: "N y M[suf]", "N/M[suf]", "Nsuf y Msuf" */
    var mComb = jugada.match(/^([1-8])([pn]?)\s*(?:y|\/)\s*([1-8])([pn]?)$/);
    if (mComb) {
      var p1 = parseInt(mComb[1], 10);
      var p2 = parseInt(mComb[3], 10);
      return liquidarCombinada(monto, p1, mComb[2], p2, mComb[4], puestoLlegada, empate1erLugar);
    }

    /* 2) A PREMIO: "10/x", "10aX", "10/10", "PP" */
    var mPremio = jugada.match(/^(?:10\/|10a|pp|10\/10)([0-9]*\.?[0-9]+)?$/i);
    if (mPremio) return liquidarPremio(monto, mPremio[0], puestoLlegada, empate1erLugar);

    /* 3) Nini único: "2n", "3nn" */
    var mNini = jugada.match(/^([1-8])([n]+)$/);
    if (mNini) {
      return liquidarPuestoUnico(monto, parseInt(mNini[1], 10), 'n', puestoLlegada, empate1erLugar);
    }

    /* 4) Puesto único: "1p", "2p" */
    var mPuesto = jugada.match(/^([1-8])p$/);
    if (mPuesto) {
      return liquidarPuestoUnico(monto, parseInt(mPuesto[1], 10), 'p', puestoLlegada, empate1erLugar);
    }

    return { error: 'Sintaxis de jugada no reconocida: "' + jugada +
      '". Use 10/X, PP, Np, Nn, o combinada consecutiva (N y M).' };
  }

  window.MotorHipico = {
    TASA_COMISION: TASA_COMISION,

    procesarComando: function (comandoTexto, puestoLlegada, empate1erLugar) {
      return parsearComandoMotor(comandoTexto, puestoLlegada || null, !!empate1erLugar);
    }
  };
})();
