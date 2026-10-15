var fs = require('fs');
var file = 'C:/Users/julio/sistema_hipico/html/taquilla.html';
var html = fs.readFileSync(file, 'utf8');

/* anchor: exact span after selectHipodromo */
var anchor = '<span id="clubProgramaResumen" class="hidden block mt-1 text-[9px] font-bold text-cyan-700 bg-cyan-50 border border-cyan-200 rounded px-2 py-0.5"></span>';

/* insertion after the span */
var insert = '<div id="carrerasDeHoy" class="flex flex-wrap gap-1.5 mt-2"></div>\n' +
    '<p class="text-[9px] text-slate-400 italic mt-1">Carreras de hoy \u2014 clic para cargar la jugada de esa carrera.</p>';

if (!html.includes(anchor)) {
    console.log('ANCHOR-NOT-FOUND');
    process.exit(1);
}

var nuevo = html.replace(anchor, anchor + '\n                        ' + insert);
fs.writeFileSync(file, nuevo, 'utf8');
console.log('INSERTADO-OK');