const fs=require('fs');
const s=fs.readFileSync('C:/Users/julio/sistema_hipico/src/features/pollas/components/PollasModule.tsx','utf8');
const idx=s.indexOf('max-w-xs');
if(idx>=0) console.log(s.slice(idx, idx+200));
