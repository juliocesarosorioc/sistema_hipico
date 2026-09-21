/* Builder R14-UX: inyecta toast de confirmacion "Boleto registrado" en
   puente_teclado.js, en la rama DONDE el motor ACEPTA la jugada.
   Estrategia deterministica: ancla = la cadena del toast BLOQUEADO (unica en
   disco, verificada L72). A partir de su indice busca el primer 'return;' y
   luego el '}' que lo cierra => inserta el bloque UX justo despues.
   Sin regex, sin escrituras parciales: un solo writeFileSync al final.
   Presupuesto de esta pasada: 1 write builder + 1 node + 1 node --check
   + 1 Select-String (-SimpleMatch) = vía fiable 4/4. */
var fs = require('fs');
var p = 'C:/Users/julio/sistema_hipico/js/puente_teclado.js';
var t = fs.readFileSync(p, 'utf8');
var ancla = "clubUI.toast('BLOQUEADO por MotorHipico: ' + r.error, 'error');";
var i = t.indexOf(ancla);
if (i < 0) { console.log('ANCLA-NO-ENCONTRADA-ABORTO:' + ancla); process.exit(9); }
var j = t.indexOf('return;', i);
if (j < 0) { console.log('NO-HAY-return-TRAS-ANCLA-ABORTO'); process.exit(9); }
var k = t.indexOf('}', j);
if (k < 0) { console.log('NO-HAY-} -TRAS-return-ABORTO'); process.exit(9); }
var bloc =
  '\n          /* R14-UX: el motor ACEPTÓ -> confirmación visual visible.\n' +
  '             Sin esto, el Enter se consume y el usuario cree que NO se\n' +
  '             registró. El insert real del ticket lo hace taquilla.js\n' +
  '             registraTickets; aquí solo damos el feedback que faltaba. */\n' +
  '          if (r && !r.error && r.esRegistro) {\n' +
  '            if (window.clubUI && window.clubUI.toast) {\n' +
  '              var _mn = r.montoParseado;\n' +
  '              if (_mn && window.clubUI.formatoNumero) _mn = window.clubUI.formatoNumero(_mn, 0);\n' +
  "              window.clubUI.toast('Boleto registrado: ' + (r.tipoReconocido || r.tipo || 'jugada') +\n" +
  "                (_mn ? ' · $' + _mn : ''), 'ok');\n" +
  '            }\n' +
  '          }\n';
var nuevo = t.slice(0, k + 1) + bloc + t.slice(k + 1);
fs.writeFileSync(p, nuevo, 'utf8');
console.log('INYECTADO-OK-INSERT-POS=' + (k + 1));
