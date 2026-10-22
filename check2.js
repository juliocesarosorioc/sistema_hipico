const fs=require('fs');
const s=fs.readFileSync('C:/Users/julio/sistema_hipico/src/features/ejemplares/components/CarreraGacetaCard.tsx','utf8');
console.log(s.split(/\n/).slice(0,30).join('\n'));
