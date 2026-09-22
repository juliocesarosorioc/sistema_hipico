/* R19-RBAC-INTEGRADOR-EN-taquilla.html
   VIA SEGURA 8/8: lee los fragmentos YA ESCRITOS EN DISCO (write puro, sin
   escapes embebidos) y los inserta por String.replace sobre ANCLAS UNICAS
   SIN COMILLAS EMBEBIDAS:
     + boton : 'Reportes de Cierres</button>'   (aparece 1 sola vez)
     + cierre: '</body>'                        (aparece 1 sola vez, final)
   Trabaja sobre COPIA: primero respaldo 1/1 (ya existe), luego lee taquilla,
   reemplaza, escribe. Despues node --check no aplica (HTML) -> verifico por
   Select-String post 2/2 anclas: btnClubAccesos + club_accesos_control.js.
   NOTA: los fragmentos NO llevan comilla simple interna que rompa — se leen
   como archivo, no como literal de comilla simple. */
var fs = require('fs');
var base = 'C:/Users/julio/sistema_hipico/';
var rutaHTML = base + 'html/taquilla.html';
var rutaFragBoton = base + 'js/_fragments/frag_menu_boton_accesos.html';
var rutaFragCierre = base + 'js/_fragments/frag_cierre_accesos.html';

var html = fs.readFileSync(rutaHTML, 'utf8');
var fragBoton = fs.readFileSync(rutaFragBoton, 'utf8');
var fragCierre = fs.readFileSync(rutaFragCierre, 'utf8');

var anclaBoton = 'Reportes de Cierres</button>';
var anclaCierre = '</body>';

var iB = html.indexOf(anclaBoton);
var iC = html.lastIndexOf(anclaCierre);

if (iB === -1) { console.log('ANCLA-BOTON-NO-ENCONTRADA-FALLO'); process.exit(2); }
if (iC === -1) { console.log('ANCLA-CIERRE-NO-ENCONTRADA-FALLO'); process.exit(2); }
if (iC <= iB) { console.log('ORDEN-ANCLAS-INCOHERENTE-FALLO'); process.exit(2); }

/* inserciones: boton justo despues del ancla; cierre justo antes de </body> */
var nuevo =
  html.slice(0, iB + anclaBoton.length) +
  fragBoton +
  html.slice(iB + anclaBoton.length, iC) +
  fragCierre +
  html.slice(iC);

fs.writeFileSync(rutaHTML, nuevo, 'utf8');
console.log('R19-INTEGRACION-OK-en=' + rutaHTML);
console.log('BYTES-PRE=' + Buffer.byteLength(html, 'utf8'));
console.log('BYTES-POST=' + Buffer.byteLength(nuevo, 'utf8'));
