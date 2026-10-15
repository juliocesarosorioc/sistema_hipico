/* R20-RBAC-DASHBOARD-BUILDER: inserta el boton Accesos DEBAJO del header de
   dashboard.html usando solo String.replace sobre la ancla unica '</header>'
   (unico <header> en el archivo, cierra en L39, lo verifica con indexOf y
   exige que aparezca 1 sola vez antes de escribir). Lee el fragmento desde
   disco (write puro previo), asi NO hay secuencias de escape fragiles:
   cero comillas embebidas en este builder. Respaldo PRE ya verificado 1/1
   en html/_respaldos/_respaldo_dashboard_preAccesos_20260922-000227.html.

   Verificacion post (Select-String -SimpleMatch palabra unica 2/2):
     + 'btnAccesosDashboard'  -> el boton
     + 'clubAccesosPanelDash' -> el ancla del panel
   ============================================================ */
'use strict';
var fs = require('fs');
var base = 'C:/Users/julio/sistema_hipico/';
var rutaHtml = base + 'html/dashboard.html';
var rutaFrag = base + 'js/_fragments/frag_boton_accesos_dashboard.html';

var html = fs.readFileSync(rutaHtml, 'utf8');
var frag = fs.readFileSync(rutaFrag, 'utf8');

var ancla = '</header>';
var apariciones = html.split(ancla).length - 1; /* cuantas veces aparece */

if (apariciones !== 1) {
  console.log('ANCLA-HEADER-NO-UNICA-apariciones=' + apariciones.toString() + '-ABORTO-SIN-ESCRIBIR');
  process.exit(2);
}

var resultado = html.replace(ancla, ancla + '\n' + frag);
fs.writeFileSync(rutaHtml, resultado, 'utf8');

console.log('R20-RBAC-DASHBOARD-INTEGRADO-ok');
console.log('BYTES-PRE=' + Buffer.byteLength(html, 'utf8').toString());
console.log('BYTES-POST=' + Buffer.byteLength(resultado, 'utf8').toString());
console.log('ANCLA-HEADER-UNICA-1/1-condicion-cumplida-antes-de-escribir');
