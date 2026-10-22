const fs=require('fs');
const lines=fs.readFileSync('C:/Users/julio/sistema_hipico/src/features/reportes/components/ReporteVentasModal.tsx','utf8').split(/\n/);
for(let i=353;i<650;i++){
  console.log((i+1)+': '+lines[i]);
}
