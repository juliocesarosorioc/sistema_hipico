const fs = require('fs');
const p = 'C:/Users/julio/sistema_hipico/src/features/pollas/components/PollasModule.tsx';
let s = fs.readFileSync(p, 'utf8');
const marker = 'HIPÓDROMO. Estandarizado';
const idx = s.indexOf(marker);
if (idx < 0) { console.log('no'); process.exit(0); }
const start = s.lastIndexOf('        {/*', idx);
const end = s.indexOf('        {error}', idx);
if (start < 0 || end < 0) { console.log('bad'); process.exit(0); }
const neu = `        {/* ------------------------------------------------------------
            HIPÓDROMO. Estandarizado con SearchableSelect igual que Gestión de Jugadas.
         * ---------------------------------------------------------- */}
        <div className="mt-3">
          <div className="max-w-xs">
            <label className="mb-1 block text-[10px] font-black uppercase tracking-wide text-slate-500">Hipódromo</label>
            <SearchableSelect
              options={[
                { value: "", label: "Todos" },
                ...hipodromos.map((h) => ({ value: h.id, label: nombreHipodromoParaMostrar(h.nombre) })),
              ]}
              value={hipodromoId}
              onChange={setHipodromoId}
              placeholder="Buscar hipódromo..."
            />
          </div>
          <p className="mt-1.5 text-xs text-slate-500">
            {hipodromoId
              ? \`\${pollasFiltradas.length} polla(s) en \${nombreHipodromoParaMostrar(nombreHipodromo)} · \${fecha}\`
              : \`\${pollasFiltradas.length} polla(s) en todos los hipódromos · \${fecha}\`}. Creá una para empezar a vender.
          </p>
        </div>\n\n`;
s = s.slice(0, start) + neu + s.slice(end);
fs.writeFileSync(p, s);
console.log('ok');
