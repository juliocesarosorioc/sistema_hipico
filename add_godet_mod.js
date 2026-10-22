const fs=require('fs');
const p='C:/Users/julio/sistema_hipico/src/features/ejemplares/components/EjemplaresModule.tsx';
let s=fs.readFileSync(p,'utf8');
if(!s.includes('abrirGodet')){
  s=s.replace('export function EjemplaresModule() {','export function EjemplaresModule() {\n  const [abrirGodet, setAbrirGodet] = useState(false);');
}
if(!s.includes('Abrir Pizarra Prospectiva Godet')){
  s=s.replace('</section>',"        <div className=\"flex justify-end\"><button type=\"button\" onClick={() => setAbrirGodet(true)} className=\"rounded-lg bg-gradient-to-r from-amber-500 to-yellow-400 px-4 py-2 text-sm font-black text-slate-900\">🧭 Abrir Pizarra Prospectiva Godet & Actuarial</button></div>\n      </section>\n      <ModalAnalisisActuarialGodet abierto={abrirGodet} onCerrar={() => setAbrirGodet(false)} ejemplares={[]} />");
}
fs.writeFileSync(p,s);
console.log('ok');
