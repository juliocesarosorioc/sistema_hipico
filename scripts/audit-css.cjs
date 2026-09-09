const fs = require('fs');
const path = require('path');

const css = fs.readFileSync('css/tailwind.css', 'utf8');
const tokens = new Set();

for (const f of fs.readdirSync('html').filter(f => f.endsWith('.html'))) {
    const src = fs.readFileSync(path.join('html', f), 'utf8');
    const re = /class="([^"]+)"/g;
    let m;
    while ((m = re.exec(src))) {
        for (const tok of m[1].split(/\s+/)) {
            if (!tok) continue;
            // Solo clases puras: sin caracteres HTML/JS, sin llaves, sin comillas
            if (/^[a-zA-Z0-9:_\[\]\.\/\\\-]+$/.test(tok)) tokens.add(tok);
        }
    }
}

const esc = (t) => t.replace(/([\.:\\\[\]\/])/g, '\\$1');
let miss = 0;
for (const t of [...tokens].sort()) {
    const sel = '.' + esc(t);
    if (!css.includes(sel)) {
        console.log('MISS ' + t);
        miss++;
    }
}
console.log('Clases en HTML: ' + tokens.size + ' | AUSENTES: ' + miss);