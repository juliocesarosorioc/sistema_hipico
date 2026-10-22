const fs=require('fs');
const lines=fs.readFileSync('C:/Users/julio/sistema_hipico/src/features/reportes/components/ReporteVentasModal.tsx','utf8').split(/\n/);
for(let i=850;i<1086;i++){
  const l=lines[i];
  if(/detalle|tabla|cantidad|retiro|ajuste|pago.*tabla|Compra|Venta.*tabla/.test(l)) console.log((i+1)+': '+l);
}
