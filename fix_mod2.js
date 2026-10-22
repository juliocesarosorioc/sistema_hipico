const fs=require('fs');
const p='C:/Users/julio/sistema_hipico/src/features/ejemplares/components/EjemplaresModule.tsx';
let s=fs.readFileSync(p,'utf8');
s=s.replace("        <div className=\"flex justify-end\"><button type=\"button\" onClick={() => setAbrirGodet(true)} className=\"rounded-lg bg-gradient-to-r from-amber-500 to-yellow-400 px-4 py-2 text-sm font-black text-slate-900\">🧭 Abrir Pizarra Prospectiva Godet & Actuarial</button></div>\n      </section>\n      <ModalAnalisisActuarialGodet abierto={abrirGodet} onCerrar={() => setAbrirGodet(false)} ejemplares={[]} />",
  "<>\n        <section>...</section>\n      </>\n");
fs.writeFileSync(p,s);
console.log('ok');
