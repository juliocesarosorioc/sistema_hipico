const fs=require('fs');
const s=fs.readFileSync('C:/Users/julio/sistema_hipico/src/features/pollas/components/PollasModule.tsx','utf8');
const i=s.indexOf('HIPÓDROMO');
if(i>=0){
  const j=s.lastIndexOf('<div',i-150);
  const k=s.indexOf('</div>',i+500);
  console.log(s.slice(j,k+6));
}
