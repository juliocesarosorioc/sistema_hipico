const fs = require('fs');
const css = fs.readFileSync('css/tailwind.css', 'utf8');
const k = ['lg\\:static', 'lg\\:translate-x-0', 'fixed', 'top-2', 'left-2', 'shrink-0'];
let miss = 0;
for (const c of k) {
    const ok = css.includes(c);
    if (!ok) miss++;
    console.log((ok ? 'OK  ' : 'MISS') + ' ' + c);
}
console.log(miss === 0 ? 'TODAS OK' : miss + ' AUSENTES');