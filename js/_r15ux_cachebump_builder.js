/* R15-UX:#1 cache bump de taquilla.html — reescribe SOLO los tokens
   ?v=2026092?-* -> ?v=20260922-1 usando split/join literal (vía fiable 4/4).
   var t declaradas al inicio, sin caracteres no-ASCII, sin clausulas huerfanas. */
var fs = require('fs');
var p = 'C:/Users/julio/sistema_hipico/html/taquilla.html';
var t = fs.readFileSync(p, 'utf8');
var n = 0;
var pares = [];
pares.push(['?v=20260921-', '?v=20260922-1']);
pares.push(['?v=20260920-', '?v=20260922-1']);
pares.push(['?v=20260919-', '?v=20260922-1']);
pares.push(['?v=20260918-', '?v=20260922-1']);
for (var i = 0; i < pares.length; i++) {
  var viejo = pares[i][0], nuevo = pares[i][1];
  var trozos = t.split(viejo);
  if (trozos.length > 1) { t = trozos.join(nuevo); n = n + trozos.length - 1; }
}
if (n === 0) {
  console.log('SIN-TOKENS-QUE-BUMPEAR-ya-estan-20260922-1-o-version-mayor');
  process.exit(0);
}
fs.writeFileSync(p, t, 'utf8');
console.log('CACHEBUMP-OK-tokens-remplazados=' + n.toString());
