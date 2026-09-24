"use client";

import {
  aNum,
  colorDeNumeroGac,
  FLAGS,
  nacEjemplar,
  SUPERFICIES,
  type CarreraRegistro,
  type EjemplarEditable,
} from "@/lib/gaceta/ui";

type Props = {
  index: number;
  carrera: CarreraRegistro;
  onChange: (c: CarreraRegistro) => void;
  onEnviar: (i: number) => void;
};

/**
 * Card de una carrera extraída por la Gaceta — clon 1:1 del legacy
 * js/gaceta.js renderCarreras()/filaEjemplarGac():
 *  cabecera índigo (Hipódromo · C N° · selección), Dist/Superficie/Fecha,
 *  "Monto a Pagar / Tabla" (por defecto $100), filas Nº/nombre/bandera/valor
 *  con insignia del padrón (✗ sin padrón, ✓ vinculado, ★ nuevo), pie con la
 *  "Suma de la Tabla" en vivo y el botón "Cargar en el Ensamblaje".
 */
export function CarreraGacetaCard({ index, carrera, onChange, onEnviar }: Props) {
  const numCarrera = carrera.carrera || index + 1;
  const ejemplares = Array.isArray(carrera.ejemplares) ? carrera.ejemplares : [];
  const suma = ejemplares.reduce((a, ej) => a + (aNum(ej.valor) ?? aNum(ej.pts) ?? 0), 0);

  const set = (patch: Partial<CarreraRegistro>) => onChange({ ...carrera, ...patch });

  const setEj = (j: number, patch: Partial<EjemplarEditable>) =>
    set({ ejemplares: ejemplares.map((e, k) => (k === j ? { ...e, ...patch } : e)) });

  const hipo = String(carrera.hipodromo || "").trim().toUpperCase();
  const dist = String(carrera.distancia ?? "");
  const superficie = String(carrera.superficie || "ARENA").toUpperCase();
  const premio = String(carrera.premio ?? 100);

  const inpIndigo =
    "rounded px-1 py-px text-[9px] font-black outline-none placeholder:text-white/40 focus:ring-1 focus:ring-indigo-300";
  const inpClaro = `bg-white/25 text-white ${inpIndigo}`;
  const inpEdit = "border border-slate-300 bg-white text-slate-700 " + inpIndigo;

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-indigo-200 bg-white shadow-sm" data-carrera={index}>
      {/* Cabecera índigo (morada) */}
      <div className="bg-indigo-600 px-2 py-1 text-white">
        <div className="flex items-center justify-between gap-1">
          <input
            type="text"
            value={hipo}
            onChange={(e) => set({ hipodromo: e.target.value.toUpperCase() })}
            placeholder="Hipódromo"
            title="Hipódromo"
            className={`${inpClaro} min-w-0 flex-1 uppercase`}
          />
          <span className="flex items-center gap-0.5 whitespace-nowrap text-[10px] font-black">
            🏁 C
            <input
              type="number"
              value={numCarrera}
              onChange={(e) => set({ carrera: e.target.value ? Number(e.target.value) : null })}
              placeholder="N°"
              title="Número de la carrera"
              className={`${inpClaro} w-7 text-center`}
            />
          </span>
          <input
            type="checkbox"
            checked={!!carrera.seleccionada}
            onChange={(e) => set({ seleccionada: e.target.checked })}
            title="Incluir al enviar al Ensamblaje"
            className="h-3.5 w-3.5 shrink-0 accent-indigo-500"
          />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1 text-[8px] font-bold">
          <span className={`${inpClaro} inline-flex items-center gap-0.5 rounded px-1 py-px`}>
            Dist:
            <input
              type="number"
              value={dist}
              onChange={(e) => set({ distancia: e.target.value })}
              placeholder="m"
              title="Distancia"
              className="w-11 bg-transparent text-center font-black text-white outline-none placeholder:text-white/40"
            />
            m
          </span>
          <select
            value={superficie}
            onChange={(e) => set({ superficie: e.target.value })}
            aria-label="Superficie"
            className="rounded bg-white/25 px-0.5 py-px text-[8px] font-bold uppercase text-white outline-none"
          >
            {SUPERFICIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input type="date" value={carrera.fecha || ""} onChange={(e) => set({ fecha: e.target.value || null })} className="hidden" aria-hidden tabIndex={-1} />
        </div>
        <div className="mt-1 flex items-center justify-between rounded bg-white/25 px-2 py-1">
          <span className="text-[9px] font-black uppercase tracking-wider opacity-95">💰 Monto a Pagar / Tabla</span>
          <span className="flex items-center gap-0.5 text-sm font-black text-white">
            $
            <input
              type="number"
              step="0.01"
              value={premio}
              onChange={(e) => set({ premio: e.target.value ? Number(e.target.value) : 0 })}
              title="Monto a pagar de la tabla"
              className="w-14 border-b-2 border-white/50 bg-transparent text-right font-black text-white outline-none"
            />
          </span>
        </div>
      </div>

      {/* Subetiqueta ejemplares */}
      <div className="flex items-center justify-between px-2 pb-0.5 pt-1 text-[8px] font-black uppercase tracking-wider text-slate-400">
        <span>🐴 Ejemplares</span>
        <span className="rounded-full bg-slate-100 px-1.5 font-black text-slate-600">{ejemplares.length}</span>
      </div>

      {/* Lista de ejemplares */}
      <div className="flex-1 space-y-0.5 px-1.5 py-0.5">
        {ejemplares.length === 0 && (
          <p className="px-1 py-1 text-[10px] italic text-slate-400">Sin ejemplares detectados.</p>
        )}
        {ejemplares.map((ej, j) => {
          const nac = nacEjemplar(ej, hipo);
          const color = colorDeNumeroGac(ej.numero);
          const badge = ej.ejemplar_id ? (ej.nuevo ? "★" : "✓") : "✗";
          const badgeTxt = ej.ejemplar_id ? (ej.nuevo ? "Nuevo en el padrón" : "Vinculado al padrón") : "Sin padrón";
          return (
            <div
              key={`${ej.nombre}-${j}`}
              className="flex items-center gap-0.5 rounded border border-slate-200 bg-slate-50 px-1 py-0.5"
              title={`${ej.nombre} · ${nac}`}
            >
              <input
                type="text"
                inputMode="numeric"
                value={String(ej.numero ?? "")}
                onChange={(e) => setEj(j, { numero: e.target.value })}
                placeholder="Nº"
                title="Número del ejemplar"
                className={`w-4 shrink-0 rounded px-0 py-px text-center text-[8px] font-black outline-none focus:ring-1 focus:ring-indigo-400 ${inpEdit}`}
                style={{ backgroundColor: color.bg, color: color.fg, borderColor: color.bg }}
              />
              <input
                type="text"
                value={String(ej.nombre ?? "")}
                onChange={(e) => setEj(j, { nombre: e.target.value.toUpperCase() })}
                placeholder="Ejemplar"
                title="Nombre del ejemplar"
                className={`min-w-0 max-w-[6.5rem] flex-1 rounded border border-slate-200 px-1 py-px text-[10px] font-bold uppercase text-slate-800 outline-none focus:ring-1 focus:ring-indigo-400`}
              />
              <span className="inline-flex w-4 shrink-0 justify-center text-sm leading-none" title={nac}>
                {FLAGS[nac] || "🏳️"}
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={ej.valor ?? ej.pts ?? ""}
                onChange={(e) => setEj(j, { valor: e.target.value })}
                placeholder="$"
                title="Valor / monta del ejemplar"
                data-gac-valor
                className="w-12 shrink-0 rounded border border-slate-200 px-0.5 py-px text-right text-[12px] font-black text-blue-700 outline-none focus:ring-1 focus:ring-indigo-400"
              />
              <span
                className={`w-4 shrink-0 text-center text-[9px] font-black ${
                  ej.ejemplar_id ? (ej.nuevo ? "text-emerald-600" : "text-slate-400") : "text-red-400"
                }`}
                title={badgeTxt}
              >
                {badge}
              </span>
            </div>
          );
        })}
      </div>

      {/* Suma de la Tabla */}
      <div className="flex items-center justify-between border-t border-slate-200 bg-white px-2 py-1">
        <span className="text-[8px] font-black uppercase tracking-wider text-slate-400">🧮 Suma de la Tabla</span>
        <span className="text-[11px] font-black text-indigo-700" title="Sumatoria de los valores de todos los ejemplares">
          $ {suma.toLocaleString("es-VE", { maximumFractionDigits: 2 })}
        </span>
      </div>

      {/* Acción */}
      <div className="flex gap-2 border-t border-slate-200 bg-white px-2 py-1.5">
        <button
          type="button"
          onClick={() => onEnviar(index)}
          className="flex-1 rounded-lg bg-cyan-600 py-1.5 text-[10px] font-black uppercase tracking-wide text-white shadow transition-colors hover:bg-cyan-700"
          title="Lleva esta carrera al Ensamblaje para revisar sus VALORES y publicar"
        >
          ➡ Cargar en el Ensamblaje
        </button>
      </div>
    </div>
  );
}

export default CarreraGacetaCard;