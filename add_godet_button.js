const fs = require('fs');
const p = 'C:/Users/julio/sistema_hipico/src/features/ejemplares/components/CarreraGacetaCard.tsx';
let s = fs.readFileSync(p, 'utf8');
if (!s.includes('Abrir Pizarra Prospectiva Godet')) {
  s = s.replace("</article>", 
    "      <div className=\"flex items-center justify-between border-t border-slate-200 bg-white px-2 py-1\">\n        <button type=\"button\" onClick={() => setAbrirGodet(true)} className=\"inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-yellow-400 px-2.5 py-1 text-[11px] font-black text-slate-900\">🧭 Abrir Pizarra Prospectiva Godet & Actuarial</button>\n      </div>\n      <ModalAnalisisActuarialGodet abierto={abrirGodet} onCerrar={() => setAbrirGodet(false)} ejemplares={(ejemplares||[]).map((e)=>({numero:Number(e.numero)||0,nombre:e.nombre||'',stud:''}))} />\n    </article>");
}
fs.writeFileSync(p,s);
console.log('done');
