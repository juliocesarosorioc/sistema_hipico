const fs=require('fs');
const s=fs.readFileSync('C:/Users/julio/sistema_hipico/src/features/pollas/components/PollasModule.tsx','utf8');
const i=s.indexOf('hipodromoId ?');
if(i>=0){
  console.log(s.slice(Math.max(0,i-80), i+200));
}
