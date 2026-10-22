const fs = require('fs');
const p = 'C:/Users/julio/sistema_hipico/src/features/pollas/components/PollasModule.tsx';
let s = fs.readFileSync(p, 'utf8');
const start = s.indexOf('        {/* ------------------------------------------------------------\n            HIPÓDROMO. Estandarizado');
if (start < 0) { console.log('no1'); process.exit(0); }
const end = s.indexOf('\n        {error}', start);
if (end < 0) { console.log('no2'); process.exit(0); }
const neu = [
  '        {/* ------------------------------------------------------------',
  '            HIPÓDROMO. Estandarizado con SearchableSelect igual que Gestión de Jugadas.',
  '         * ---------------------------------------------------------- */}',
  '        <div className="mt-3">',
  '          <div className="max-w-xs">',
  '            <label className="mb-1 block text-[10px] font-black uppercase tracking-wide text-slate-500">Hipódromo</label>',
  '            <SearchableSelect',
  '              options={[',
  '                { value: "", label: "Todos" },',
  '                ...hipodromos.map((h) => ({ value: h.id, label: nombreHipodromoParaMostrar(h.nombre) })),',
  '              ]}',
  '              value={hipodromoId}',
  '              onChange={setHipodromoId}',
  '              placeholder="Buscar hipódromo..."',
  '            />',
  '          </div>',
  '          <p className="mt-1.5 text-xs text-slate-500">',
  '            {hipodromoId',
  '              ? `${pollasFiltradas.length} polla(s) en ${nombreHipodromoParaMostrar(nombreHipodromo)} · ${fecha}`',
  '              : `${pollasFiltradas.length} polla(s) en todos los hipódromos · ${fecha}`}. Creá una para empezar a vender.',
  '          </p>',
  '        </div>',
].join('\n');
s = s.slice(0, start) + neu + s.slice(end);
fs.writeFileSync(p, s);
console.log('ok');
