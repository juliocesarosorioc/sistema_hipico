const fs = require('fs');
const css = fs.readFileSync('css/tailwind.css', 'utf8');
const checks = [
    'bg-slate-100',
    'text-\\[10px\\]',
    'text-\\[8px\\]',
    'md\\:grid-cols',
    'hover\\:bg-slate-50',
    'max-w-\\[200px\\]',
    'animate-spin',
    'flex-1',
    'divide-y',
    'text-emerald-600',
    'bg-slate-900',
    'z-50',
    '.hidden',
    '.flex-col'
];
let miss = 0;
for (const c of checks) {
    const ok = css.includes(c);
    if (!ok) miss++;
    console.log((ok ? 'OK  ' : 'MISS') + ' ' + c);
}
console.log(miss === 0 ? 'TODAS PRESENTES' : miss + ' AUSENTES');