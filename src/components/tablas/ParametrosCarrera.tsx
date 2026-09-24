"use client";

import { useEffect, useState } from "react";
import { SearchableSelect, type OpcionSelect } from "@/components/ui/SearchableSelect";
import { SUPERFICIES, draftVacio, type DraftCarrera } from "@/lib/tablas/tipos";

type Props = {
  onAgregar: (draft: DraftCarrera) => void;
};

/**
 * Bloque "Parámetros de la próxima carrera" (clon del legacy en html/tablas.html):
 * Hipódromo + Carrera + Distancia + Superficie + Monto a Pagar e "Añadir carrera",
 * que crea una tarjeta editable dentro de "Carreras en el Ensamblaje".
 */
export function ParametrosCarrera({ onAgregar }: Props) {
  const [hipodromos, setHipodromos] = useState<OpcionSelect[]>([]);
  const [f, setF] = useState<DraftCarrera>(() => ({ ...draftVacio(), uid: "" }));

  useEffect(() => {
    (async () => {
      const { listarHipodromos } = await import("@/lib/tablas/rpc");
      const hipos = await listarHipodromos();
      setHipodromos(hipos);
    })();
  }, []);

  const camposValidos = f.hipodromo.trim() && f.carrera.trim() && f.premio.trim();

  const agregar = () => {
    if (!camposValidos) {
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: "Complete hipódromo, carrera y monto para añadir la carrera.", tipo: "warning" } }));
      return;
    }
    onAgregar({
      ...f,
      uid: "car-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      distancia: f.distancia.trim() || "1100",
      superficie: (f.superficie || "ARENA").toUpperCase(),
    });
    setF({ ...draftVacio(), hipodromo: f.hipodromo });
  };

  const inputCls =
    "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-bold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500";

  return (
    <div className="space-y-3 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">🏛️ Hipódromo</label>
          <SearchableSelect
            options={hipodromos}
            value={f.hipodromo}
            onChange={(v) => setF((p) => ({ ...p, hipodromo: v }))}
            placeholder="Buscar hipódromo…"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">🏁 Carrera N°</label>
          <input
            type="number"
            value={f.carrera}
            onChange={(e) => setF((p) => ({ ...p, carrera: e.target.value }))}
            placeholder="1"
            className={inputCls}
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">📏 Distancia (m)</label>
          <input
            type="number"
            value={f.distancia}
            onChange={(e) => setF((p) => ({ ...p, distancia: e.target.value }))}
            placeholder="1100"
            className={inputCls}
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">🧪 Superficie</label>
          <select
            value={f.superficie}
            onChange={(e) => setF((p) => ({ ...p, superficie: e.target.value }))}
            className={inputCls}
          >
            {SUPERFICIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">💰 Monto a Pagar / Tabla (US$)</label>
          <input
            type="number"
            step="0.01"
            value={f.premio}
            onChange={(e) => setF((p) => ({ ...p, premio: e.target.value }))}
            placeholder="100"
            className={inputCls}
          />
        </div>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={agregar}
          className="rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-black uppercase tracking-wide text-white shadow-md transition-colors hover:bg-indigo-700"
        >
          ＋ Añadir carrera
        </button>
      </div>
    </div>
  );
}

export default ParametrosCarrera;