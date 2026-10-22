const fs = require('fs');
const p = 'C:/Users/julio/sistema_hipico/src/features/pollas/components/PollasModule.tsx';
let s = fs.readFileSync(p, 'utf8');
const re = /import\s+\{\s*SearchableSelect\s*\}\s+from\s+["']@\/shared\/ui\/SearchableSelect["'];?\s*/g;
s = s.replace(re, '');
fs.writeFileSync(p, s);
console.log('done');
