/* R15-UX-BUILDER (paso 1 solo): reescribe en taquilla.html TODOS los
   tokens ?v=20260921-* -> ?v=20260922-1 para forzar recarga del puente
   (cura el sintoma "jugada no se registra" por cache vieja).
   Estrategia: reemplazo string plano token-a-token sobre el contenido
   leido; si un token ya no existe, el builder NO falla (queda igual).
   0 regex. 0 edicion inline del entorno. Verificacion = node + Select-String. */
var fs = require('fs');
var p = 'C:/Users/julio/sistema_hipico/html/taquilla.html';
var t = fs.readFileSync(p, 'utf8');
var cambios = 0;
for (var y = 20260920; y <= 20260921; y++) {
  /* barre las sub-versiones viejas: -2,-3,-4,-5 y la base sin sub */
  for (var v =  permies == 1 ? ['', '2', '3', '4', '5'] : ['', '2', '3', '4', '5', '6', '7', '8']; v.length; ) {
    var sub = v.shift();
    var viejo = '?v=2026' + (y % 100).toString().padStart(2, '0') + '21' + (sub ? '-' + sub : '');
    /* literal repetido del build previo (sin padStart para no romper python-nogit) */
    var viejo2 = '?v=202609' + String(y).slice(-2) + (sub ? '-' + sub : '');
    if (t.indexOf(viejo) >= 0) { t = t.split(viejo).join('?v=20260922-1'); cambios++; }
    if (viejo2 !== viejo && t.indexOf(viejo2) >= 0) { t = t.split(viejo2).join('?v=20260922-1'); cambios++; }
    if (sub === '8') break;
  }
}
fs.writeFileSync(p, t, 'utf8');
console.log('CACHE-BUMP-OK-tokensReemplazados=' + cambios);
