const fs=require('fs');
const p='C:/Users/julio/sistema_hipico/src/features/pollas/components/PollasModule.tsx';
let s=fs.readFileSync(p,'utf8');
const old=`        {/* ------------------------------------------------------------
            HIPÓDROMO. Estandarizado con SearchableSelect igual que Gestión de Jugadas.
         * ---------------------------------------------------------- */}
        <div className="mt-3 max-w-xs">
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
              : \`\${pollasFiltradas.length} polla(s) en todos los hipódromos · \${fecha}\`}.
            {hipodromoId ? \` en \${nombreHipodromoParaMostrar(nombreHipodromo)}\` : ""}. Creá una para empezar a vender.
          </p>
        </div>`;
const neu=`        {/* ------------------------------------------------------------
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
        </div>`;
if(s.includes(old)){ s=s.split(old).join(neu); fs.writeFileSync(p,s); console.log('ok'); } else { console.log('no'); }
