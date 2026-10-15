var fs = require('fs');
var file = 'C:/Users/julio/sistema_hipico/html/taquilla.html';
var html = fs.readFileSync(file, 'utf8');
var nuevo = html.replace(
  'class="flex flex-wrap gap-1.5 mt-2"',
  'class="flex flex-nowrap gap-1.5 mt-2 overflow-x-auto pb-1"'
);
fs.writeFileSync(file, nuevo, 'utf8');
console.log('CAMBIADO A flex-nowrap overflow-x-auto');