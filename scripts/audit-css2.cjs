const fs = require('fs');

const css = fs.readFileSync('css/tailwind.css', 'utf8');
const source = fs.readdirSync('html')
    .filter(f => f.endsWith('.html'))
    .map(f => fs.readFileSync('html/' + f, 'utf8'))
    .join('\n');

const cands = [];
const re = /class="([^"]+)"/g;
let m;
while ((m = re.exec(source))) {
    m[1].split(/\s+/).forEach(t => {
        if (t && /[\[\/\.]/.test(t)) cands.push(t);
    });
}
const uniq = [...new Set(cands)];
const esc = (t) => t.replace(/([\.:\\\[\]\/])/g, '\\$1');
let miss = 0;
for (const t of uniq.sort()) {
    const sel = '.' + esc(t);
    if (!css.includes(sel)) {
        console.log('MISS ' + t);
        miss++;
    } else {
        console.log('OK   ' + t);
    }
}
console.log('Total: ' + uniq.length + ' | AUSENTES: ' + miss);