const fs=require('fs');
const s=fs.readFileSync('C:/Users/julio/sistema_hipico/src/features/ejemplares/components/CarreraGacetaCard.tsx','utf8');
const i=s.indexOf('Cargar en el Ensamblaje');
if(i>=0) console.log(s.slice(i-120, i+80));
