const fs=require('fs');
const s=fs.readFileSync('C:/Users/julio/sistema_hipico/src/features/ejemplares/components/CarreraGacetaCard.tsx','utf8');
const i=s.indexOf('export function CarreraGacetaCard');
if(i>=0) console.log(s.slice(i, i+180));
