const fs=require('fs');
const s=fs.readFileSync('C:/Users/julio/sistema_hipico/src/features/pollas/components/PollasModule.tsx','utf8');
const idx=s.indexOf('HIPÓDROMO');
console.log('idx',idx);
if(idx>=0){
  const j=s.lastIndexOf('<div',idx-200);
  const k=s.indexOf('</div>',idx+600);
  console.log(s.slice(j,k+6));
}
