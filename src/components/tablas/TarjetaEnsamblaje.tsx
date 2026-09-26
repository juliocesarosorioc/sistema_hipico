"use client";

import { useState } from "react";
import { colorDeNumero, textoDeNumero, parseNum, OPCIONES_NACIONALIDAD, SUPERFICIES, type DraftCarrera, type EjemplarTabla } from "@/lib/tablas/tipos";
import { Flag } from "@/components/ui/BanderaPais"; // Inyectamos la bandera
import { EditorCaballos } from "@/components/tablas/EditorCaballos";

type Props = {
  draft: DraftCarrera;
  onChange: (d: DraftCarrera) => void;
  onPublicar: (d: DraftCarrera) => void;
  onQuitar: (uid: string) => void;
};

export function TarjetaEnsamblaje({ draft, onChange, onPublicar, onQuitar }: Props) {
  const [nuevoNum, setNuevoNum] = useState("");
  const [nuevoNom, setNuevoNom] = useState("");
  const [nuevaNac, setNuevaNac] = useState("VE");
  const [nuevoValor, setNuevoValor] = useState("");
  const [corrigiendo, setCorrigiendo] = useState<DraftCarrera | null>(null);

  const aplicarCorreccion = (nd: DraftCarrera) => setCorrigiendo({ ...nd, caballos: nd.caballos.map((c) => ({ ...c })) });
  const guardarCorreccion = () => {
    if (corrigiendo) onChange(corrigiendo);
    setCorrigiendo(null);
    window.dispatchEvent(new CustomEvent("toast", { detail: { msg: "✅ Borrador corregido.", tipo: "success" } }));
  };

  const suma = draft.caballos.reduce((a, c) => a + (parseNum(c.valor_ejemplar) || 0), 0);

  const set = (patch: Partial<DraftCarrera>) => onChange({ ...draft, ...patch });

  const setCaballo = (i: number, patch: Partial<EjemplarTabla>) =>
    set({ caballos: draft.caballos.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  const quitarCaballo = (i: number) => set({ caballos: draft.caballos.filter((_, j) => j !== i) });

  const agregarEjemplar = () => {
    const nombre = nuevoNom.trim().toUpperCase();
    if (!nombre) {
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: "Escriba el nombre del ejemplar para añadirlo.", tipo: "warning" } }));
      return;
    }
    set({ caballos: [...draft.caballos, { numero: nuevoNum.trim(), nombre, nacionalidad: nuevaNac, valor_ejemplar: nuevoValor.trim() }] });
    setNuevoNum("");
    setNuevoNom("");
    setNuevoValor("");
  };

  // =========================================================================
  // BOTÓN MÁGICO MORNING LINE (ML) - 1.60
  // =========================================================================
  const calcularMorningLine = () => {
    if (draft.caballos.length === 0) return;

    // 1. Asumimos que los caballos vienen con su dividendo gringo (Ej. "5/2" o "3.50") 
    // en el campo valor_ejemplar desde el OCR. Extraemos ese valor a un array numérico.
    // Si viene como texto "5/2", tú deberás ajustar parseNum para que divida 5/2 = 2.5
    // Asumiremos que ya están como números flotantes:
    const caballosActivos = draft.caballos.filter(c => !c.retirado);
    
    // Regla de Negocio: Se estima que la suma de valores a asignar DEBE acercarse a 1.60
    // Como las tablas se calculan para pagar la suma total, esto distribuye los $1.60 
    // proporcionalmente (invertido: al que paga menos en gringo se le pone más valor aquí).
    
    let sumatoriaInversa = 0;
    const dividendos = caballosActivos.map(c => {
      const ml = parseNum(c.valor_ejemplar) || 1; // Previene division por cero
      const inv = 1 / ml;
      sumatoriaInversa += inv;
      return { id: c.numero, ml, inv };
    });

    const NUEVO_TOPE = 1.60;
    
    const nuevosCaballos = draft.caballos.map(c => {
      if (c.retirado) return c; // Se queda igual
      const divData = dividendos.find(d => d.id === c.numero);
      if (!divData) return c;

      // Calculamos el peso ponderado sobre 1.60 y redondeamos a 2 decimales
      const peso = divData.inv / sumatoriaInversa;
      const nuevoValorAsignado = (peso * NUEVO_TOPE).toFixed(2);

      return { ...c, valor_ejemplar: nuevoValorAsignado };
    });

    set({ caballos: nuevosCaballos });
    window.dispatchEvent(new CustomEvent("toast", { detail: { msg: "✅ Morning Line ajustado a $1.60", tipo: "success" } }));
  };

  const chipCls = "rounded px-1 py-px text-[12px] font-bold leading-none";
  const inpHeader = "rounded px-1 py-px font-bold outline-none bg-white/20 text-white placeholder:text-white/50";

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-indigo-200 bg-white shadow-sm">
      {/* Cabecera color */}
      <div className="bg-indigo-600 px-1.5 py-px text-white">
        <div className="flex items-center justify-between gap-1 leading-none">
          <input
            type="text"
            value={draft.hipodromo}
            onChange={(e) => set({ hipodromo: e.target.value.toUpperCase() })}
            placeholder="Hipódromo"
            className={`${inpHeader} min-w-0 flex-1 text-[16px] uppercase`}
          />
          <span className="flex items-center gap-1 whitespace-nowrap">
            <span className="flex items-center rounded-full border-2 border-indigo-200 bg-white px-2 py-px text-[11px] font-black uppercase leading-none tracking-widest text-indigo-900 shadow-md md:text-[13px]">
              <span className="mr-1 text-indigo-400">C</span>
              <input
                type="number"
                value={draft.carrera}
                onChange={(e) => set({ carrera: e.target.value })}
                placeholder="N°"
                className="w-8 bg-transparent text-center font-black leading-none outline-none placeholder:text-indigo-300"
              />
            </span>
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1 leading-none">
          <span className={`${chipCls} inline-flex items-center bg-white/20`}>
            📏 <input type="number" value={draft.distancia} onChange={(e) => set({ distancia: e.target.value })} placeholder="m" className="ml-1 w-10 rounded bg-transparent text-center font-black outline-none text-white placeholder:text-white/40" />
            m
          </span>
          <select
            value={draft.superficie}
            onChange={(e) => set({ superficie: e.target.value })}
            className={`${chipCls} bg-white/20 uppercase text-white outline-none`}
          >
            {["ARENA", "CESPED", "FANGO", "TAPETA", "OTRA"].map((s) => (
              <option key={s} value={s} className="text-black">
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-0.5 flex items-center justify-between rounded px-1.5 py-px leading-none bg-white/20">
          <span className="text-[11px] font-black uppercase tracking-wider opacity-90">💰 MONTO A PAGAR TABLA</span>
          <span className="flex items-center gap-0.5 text-sm font-black leading-none">
            <input type="number" step="0.01" value={draft.premio} onChange={(e) => set({ premio: e.target.value })} className="w-14 rounded bg-transparent text-right font-black outline-none text-white placeholder:text-white/40" />
          </span>
        </div>
      </div>

      {/* Subetiqueta ejemplares + BOTON ML */}
      <div className="flex items-center justify-between px-1.5 pb-0.5 pt-1 text-[9px] font-black uppercase tracking-wider text-slate-400 leading-none bg-slate-50 border-b border-slate-100">
        <span>🐴 Ejemplares</span>
        <div className="flex items-center gap-2">
          {/* BOTÓN CORREGIR TABLA */}
          <button
            type="button"
            onClick={() => aplicarCorreccion(draft)}
            title="Corregir la tabla (ejemplares, montos, distancia, superficie…)"
            className="bg-indigo-600 text-white px-2 py-0.5 rounded-sm font-black shadow-sm hover:bg-indigo-700"
          >
            ✏️ Corregir
          </button>
          {/* BOTÓN ML */}
          <button 
            type="button" 
            onClick={calcularMorningLine}
            title="Auto-calcular distribución a Tope $1.60"
            className="bg-yellow-400 text-yellow-900 px-2 py-0.5 rounded-sm font-bold shadow-sm hover:bg-yellow-500"
          >
            📊 Calc. ML (1.60)
          </button>
          <span className="rounded-full bg-slate-200 px-1.5 text-[9px] font-black text-slate-600">{draft.caballos.length}</span>
        </div>
      </div>

      {/* Lista de ejemplares CON BANDERA */}
      <div className="flex-1 space-y-px px-1 py-px">
        {draft.caballos.length === 0 && (
          <p className="px-1 py-1 text-[11px] italic text-slate-400">Sin ejemplares registrados.</p>
        )}
        {draft.caballos.map((c, i) => {
          // Detectamos bandera si no la trae
          let nac = c.nacionalidad ? String(c.nacionalidad).toUpperCase() : "";
          if (!nac) {
            const esAmericano = /PARK|DOWNS|AQUEDUCT|SARATOGA|TAMPA|MEADOWS|WOODBINE|GOLDEN|SANTA ANITA|DEL MAR|OAKLAWN/i.test(draft.hipodromo);
            nac = esAmericano ? "US" : "VE";
          }
          return (
            <div key={i} className={`grid items-center rounded border border-slate-200 px-1 py-px transition-colors ${i % 2 === 1 ? "bg-slate-100" : "bg-white"} hover:bg-indigo-200`} style={{ gridTemplateColumns: "1.5rem 1fr auto 3.25rem auto" }}>
              <span
                className="flex h-6 w-6 shrink-0 flex-none items-center justify-center text-center text-[10px] font-bold leading-none"
                style={{ backgroundColor: colorDeNumero(c.numero), color: textoDeNumero(c.numero) }}
              >
                {c.numero}
              </span>
              <span className="min-w-0 truncate px-1 text-[15px] font-bold uppercase leading-none text-slate-800 flex items-center gap-1">
                {c.nombre}
              </span>
              <span className="flex items-center justify-center px-1"><Flag nac={nac} size={10} withName={false} /></span>
              <input
                type="text"
                inputMode="decimal"
                value={String(c.valor_ejemplar ?? "")}
                onChange={(e) => setCaballo(i, { valor_ejemplar: e.target.value })}
                placeholder={nac === "VE" ? "valor" : "M/L"}
                className="w-14 rounded border border-slate-300 px-1 py-px text-right text-[17px] font-black text-blue-700 outline-none"
              />
              <button type="button" onClick={() => quitarCaballo(i)} className="px-1 text-red-400 hover:text-red-600" title="Quitar ejemplar">
                🗑️
              </button>
            </div>
          );
        })}
      </div>

      {/* Añadir ejemplar */}
      <div className="space-y-1 border-t border-slate-200 bg-slate-50 px-2 py-1.5">
        <div className="flex items-center gap-1">
          <input type="text" inputMode="numeric" value={nuevoNum} onChange={(e) => setNuevoNum(e.target.value)} placeholder="Nº" className="w-9 shrink-0 rounded-md border border-slate-300 py-1 text-center text-[14px] font-black outline-none" />
          <input type="text" value={nuevoNom} onChange={(e) => setNuevoNom(e.target.value)} onKeyDown={(e) => e.key === "Enter" && agregarEjemplar()} placeholder="Ejemplar nuevo" className="min-w-0 flex-1 rounded border border-slate-300 px-1.5 py-1 text-sm font-bold uppercase outline-none" />
          <select value={nuevaNac} onChange={(e) => setNuevaNac(e.target.value)} className="shrink-0 rounded border border-slate-300 px-1 py-1 text-xs font-bold uppercase outline-none">
            {OPCIONES_NACIONALIDAD.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <input type="text" inputMode="decimal" value={nuevoValor} onChange={(e) => setNuevoValor(e.target.value)} placeholder="—" className="w-14 shrink-0 rounded border border-slate-300 px-1 py-1 text-right text-sm font-black text-blue-700 outline-none" />
          <button type="button" onClick={agregarEjemplar} className="shrink-0 rounded-md bg-indigo-600 px-2 py-1 text-xs text-white hover:bg-indigo-700" title="Añadir ejemplar">
            ＋
          </button>
        </div>
      </div>

      {/* Suma de la tabla (sin símbolo: la moneda se estipula por el grupo) */}
      <div className="flex items-center justify-between border-t border-slate-200 bg-white px-1.5 py-0.5">
        <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 leading-none">🧮 Suma de la Tabla</span>
        <span className="text-xs font-black text-indigo-700">{suma.toLocaleString("es-VE", { maximumFractionDigits: 2 })}</span>
      </div>

      {/* Acciones */}
      <div className="flex gap-2 border-t border-slate-200 bg-white px-3 py-2">
        <button type="button" onClick={() => onPublicar(draft)} className="flex-1 rounded-lg bg-emerald-600 py-2 text-xs font-black uppercase tracking-wide text-white shadow transition-colors hover:bg-emerald-700">
          💾 Publicar
        </button>
        <button type="button" onClick={() => onQuitar(draft.uid)} className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-600 transition-colors hover:bg-red-100" title="Quitar esta carrera del ensamblaje">
          ✕
        </button>
      </div>

      {/* MODAL CORREGIR TABLA (borrador) */}
      {corrigiendo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 no-print">
          <div className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-line bg-slate-800 px-4 py-3 text-white">
              <h3 className="text-xs font-black uppercase">✏️ Corregir borrador — {corrigiendo.hipodromo || "Sin hipódromo"} C{corrigiendo.carrera}</h3>
              <button type="button" onClick={() => setCorrigiendo(null)} className="text-slate-300 hover:text-white">✕</button>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
              <fieldset className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
                <legend className="px-1 text-[9px] font-black uppercase tracking-wider text-slate-400">🏁 Carrera</legend>
                <label className="block">
                  <span className="mb-0.5 block text-[9px] font-black uppercase text-slate-500">Hipódromo</span>
                  <input value={corrigiendo.hipodromo} onChange={(e) => aplicarCorreccion({ ...corrigiendo, hipodromo: e.target.value.toUpperCase() })} className="w-full rounded border border-line bg-white px-2 py-1 text-sm font-bold uppercase text-slate-900 focus:outline-none" />
                </label>
                <label className="block">
                  <span className="mb-0.5 block text-[9px] font-black uppercase text-slate-500">Carrera Nº</span>
                  <input value={corrigiendo.carrera} onChange={(e) => aplicarCorreccion({ ...corrigiendo, carrera: e.target.value })} className="w-full rounded border border-line bg-white px-2 py-1 text-sm font-black text-slate-900 focus:outline-none" />
                </label>
                <label className="block">
                  <span className="mb-0.5 block text-[9px] font-black uppercase text-slate-500">Fecha (AAAA-MM-DD)</span>
                  <input value={String(corrigiendo.fecha ?? "")} onChange={(e) => aplicarCorreccion({ ...corrigiendo, fecha: e.target.value })} placeholder="2026-09-26" className="w-full rounded border border-line bg-white px-2 py-1 text-sm font-bold text-slate-900 focus:outline-none" />
                </label>
                <label className="block">
                  <span className="mb-0.5 block text-[9px] font-black uppercase text-slate-500">Superficie</span>
                  <select value={corrigiendo.superficie} onChange={(e) => aplicarCorreccion({ ...corrigiendo, superficie: e.target.value })} className="w-full rounded border border-line bg-white px-2 py-1 text-sm font-black uppercase text-slate-900 focus:outline-none">
                    {SUPERFICIES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-0.5 block text-[9px] font-black uppercase text-slate-500">Distancia (m)</span>
                  <input value={corrigiendo.distancia} onChange={(e) => aplicarCorreccion({ ...corrigiendo, distancia: e.target.value })} className="w-full rounded border border-line bg-white px-2 py-1 text-sm font-bold text-slate-900 focus:outline-none" />
                </label>
                <label className="block">
                  <span className="mb-0.5 block text-[9px] font-black uppercase text-slate-500">Monto a Pagar / Tabla</span>
                  <input value={corrigiendo.premio} onChange={(e) => aplicarCorreccion({ ...corrigiendo, premio: e.target.value })} inputMode="decimal" className="w-full rounded border border-line bg-white px-2 py-1 text-sm font-black text-slate-900 focus:outline-none" />
                </label>
              </fieldset>
              <fieldset className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                <legend className="px-1 text-[9px] font-black uppercase tracking-wider text-slate-400">🐴 Ejemplares</legend>
                <EditorCaballos
                  caballos={corrigiendo.caballos}
                  onChange={(i, patch) => aplicarCorreccion({ ...corrigiendo, caballos: corrigiendo.caballos.map((c, j) => (j === i ? { ...c, ...patch } : c)) })}
                  onQuitar={(i) => aplicarCorreccion({ ...corrigiendo, caballos: corrigiendo.caballos.filter((_, j) => j !== i) })}
                  onAgregar={(c) => aplicarCorreccion({ ...corrigiendo, caballos: [...corrigiendo.caballos, c] })}
                />
              </fieldset>
            </div>
            <div className="flex justify-end gap-2 border-t border-line bg-gray-50 px-4 py-3">
              <button type="button" onClick={() => setCorrigiendo(null)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[10px] font-black uppercase text-slate-600 hover:bg-slate-100">
                Cancelar
              </button>
              <button type="button" onClick={guardarCorreccion} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[10px] font-black uppercase text-white hover:bg-emerald-700">
                💾 Guardar corrección
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default TarjetaEnsamblaje;