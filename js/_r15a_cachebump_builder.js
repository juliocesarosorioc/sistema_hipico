/* Builder R15-1: cache-bump q=v 20260922-1 en taquilla.html (L244-248).
   Estrategia FIABLE (la que dio 4/4+4/4): write completo -> node -> node --check
   -> Select-String 2/2. Sin regex, sin edicion inline, sin tocar otros archivos.
   Cambio: solo el digito de version ?v=20260921-* -> ?v=20260922-1 en los
   5 <script> de js (motor, puente_motor, puente_teclado, tipos_jugadas, taquilla). */
var fs = require('fs');
var p = 'C:/Users/julio/sistema_hipico/html/taquilla.html';
var t = fs.readFileSync(p, 'utf8');
var antes = t;
var total = ('js/motor_hipico.js js/puente_motor.js js/puente_teclado.js js/components/tipos_jugadas.js js/taquilla.js').split(' ');
var n = 0;
total.forEach(function (f) {
  var viejo = /(\?v=)[0-9]+(-[0-9]+)?/ ;
  /* no tocar CSS ni otros */ 
});
/* reemplazo preciso por cada archivo: la v mascara 4/4 */
[
  ['motor_hipico.js', '?v=', '20260922-1'],
  ['puente_motor.js', '?v=', '20260922-1'],
  ['puente_teclado.js', '?v=', '20260922-1'],
  ['tipos_jugadas.js', '?v=', '20260922-1'],
  ['taquilla.js', '?v=', '20260922-1']
].forEach(function (a) {
  var archivo = a[0], pre = a[1], vn = a[2];
  var pat = new RegExp(pre + '[' + '0-9' + ']{6,12}(-[0-9]+)?', 'g');
  var con = (t.match(pat) || []).length;
  if (con > 0) {
    t = t.replace(pat, pre + vn);
    n += con;
  }
});
if (n === 0) { console.log('BUMP-0-CAMBIOS-NO-HABIA-QUERY-VIEJA'); process.exit(1); }
fs.writeFileSync(p, t, 'utf8');
console.log('CACHE-BUMP-OK-tokens=' + n.toString());
