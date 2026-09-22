/* R16-UX-MONITOR-FIX (1 write): enlaza panel_monitor_ux.css en taquilla.html
   SI NO ESTA (idempotente). Ancla simple unica: el tag </head>. Insertar
   el <link> justo antes. Luego bump ?v=20260921-1 -> ?v=20260922-2 en
   todo taquilla.html (cache de navegador limpio para ver el nuevo CSS).
   Sin regex, sin inline editor: write completo + node + Select-String. */
var fs = require('fs');
var p = 'C:/Users/julio/sistema_hipico/html/taquilla.html';
var t = fs.readFileSync(p, 'utf8');
if (t.indexOf('panel_monitor_ux.css') >= 0) {
  console.log('LINK-CSS-YA-ENLZADO-IDEMPOTENTE-NO-DUPLICAR');
  process.exit(0);
}
var ancla = '</head>';
var i = t.indexOf(ancla);
if (i < 0) { console.log('ANCLA-HEAD-NO-ENCONTRADA-ABORTO'); process.exit(901); }
var link = '    <link rel="stylesheet" href="../js/components/panel_monitor_ux.css?v=20260922-2">\n';
t = t.slice(0, i) + link + t.slice(i);
t = t.split('?v=20260921-1').join('?v=20260922-2');
t = t.split('?v=20260920-1').join('?v=20260922-2');
t = t.split('?v=20260921-5').join('?v=20260922-2');
fs.writeFileSync(p, t, 'utf8');
console.log('LINK-PANEL-MONITOR-UX-CSS-INSERTADO-ANTES-DE-</head>+BUMP-20260922-2');
