const fs = require('fs');
const s = fs.readFileSync('C:/Users/julio/sistema_hipico/src/features/pollas/components/PollasModule.tsx', 'utf8');
console.log(s.includes('SearchableSelect'));
const m = s.match(/SearchableSelect/g);
console.log(m ? m.length : 0);
