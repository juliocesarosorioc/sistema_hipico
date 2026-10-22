const fs=require('fs');
const s=fs.readFileSync('C:/Users/julio/sistema_hipico/src/features/ejemplares/components/CarreraGacetaCard.tsx','utf8');
console.log(s.includes('ModalAnalisisActuarialGodet'));
console.log(s.includes('abrirGodet'));
