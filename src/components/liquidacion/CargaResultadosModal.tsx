"use client";

import { useEffect, useMemo, useState } from "react";
import type { PizarraCarrera } from "@/lib/liquidacion";
import type { EjemplarTabla } from "@/lib/tablas/tipos";
import { colorDeNumero, textoDeNumero } from "@/lib/tablas/tipos";
import { Button } from "@/components/ui/Button";

export type PizarraResultados = {
  pizarra: PizarraCarrera;
  empates: number[];
  llenas: number; // cuántas posiciones de llegada se cargaron
  /** Dividendos oficiales por $1 (win/place/show/marcas/tabla/remate). */
  dividendos?: Record<string, number> | null;
  /** Premio por tabla fija (se usa como bruto por tabla cuando el 1º gana). */
  premio_por_tabla?: number | null;
};

const ORDENES = [
  { orden: 1, nombre: "primero" },
  { orden: 2, nombre: "segundo" },
  { orden: 3, nombre: "tercero" },
  { orden: 4, nombre: "cuarto" },
  { orden: 5, nombre: "quinto" },
  { orden: 6, nombre: "sexto" },
  { orden: 7, nombre: "septimo" },
  { orden: 8, nombre: "octavo" },
] as const;

/**
 * Mínimo absoluto de lugares de llegada en la pizarra. La cantidad NO está
 * limitada por arriba ni obligada a un número fijo: el `minLugares` es solo la
 * cantidad recomendada para poder calcular las jugadas de puestos (Venezuela 5,
 * Americanas/WPS 4) y nunca bloquea la confirmación.
 */
const LUGARES_MIN = 1;

/** Cantidad de puestos por defecto en la pizarra (Venezuela). */
export const PUESTOS_MIN = 5;

type Fila = { numero: string; empate: boolean };

type Props = {
  abierto: boolean;
  onCerrar: () => void;
  hipodromo: string;
  carrera: string;
  /** Ejemplares de la tabla (opcional): prefija los números 1..N en orden. */
  caballos?: EjemplarTabla[] | null;
  /**
   * Lugares de llegada recomendados para calcular las jugadas de puestos
   * (Venezuela: 5 · Americanas/WPS: 4). Solo muestra advertencia si se cargan
   * menos; el mínimo real de la pizarra es 1.
   */
  minLugares?: number;
  onConfirmar: (r: PizarraResultados) => void;
};

/**
 * Módulo de Liquidación — Carga de Resultados con posiciones de llegada SIN
 * tope (mínimo 1, sin máximo) y checkbox de Empate (Dead Heat) por posición.
 * Cada caballo habilita automáticamente los pools que paga según su lugar de
 * llegada: 1° → WIN+PLACE+SHOW, 2° → PLACE+SHOW, 3° → SHOW; los caballos
 * empatados comparten el pool de su posición. El motor matemático aplica CERO
 * fraccionamiento (A PREMIO con 1° empatado = ANULADA).
 *
 * TABLAS y REMATES pagan al caballo que CRUZÓ LA RAYA primero (por defecto el
 * 1º oficial); si un ganador es bajado/descalificado se puede estipular su
 * número para que esos dos pagos sigan yendo a quien cruzó primero.
 */
export function CargaResultadosModal({
  abierto,
  onCerrar,
  hipodromo,
  carrera,
  caballos,
  minLugares = PUESTOS_MIN,
  onConfirmar,
}: Props) {
  const [filas, setFilas] = useState<Fila[]>([]);
  const [usoDividendos, setUsoDividendos] = useState(false);
  const [dividendos, setDividendos] = useState<Record<string, string>>({});
  const [premioTabla, setPremioTabla] = useState("");
  const [mismoRaya, setMismoRaya] = useState(true);
  const [rayaNumero, setRayaNumero] = useState("");

  useEffect(() => {
    if (!abierto) return;
    setUsoDividendos(false);
    setDividendos({});
    setPremioTabla("");
    setMismoRaya(true);
    setRayaNumero("");
    const base = Array.from({ length: minLugares }, (_, i) => {
      const n = (caballos ?? [])[i];
      return { numero: n ? String(n.numero) : "", empate: false };
    });
    setFilas(base);
  }, [abierto, caballos, minLugares]);

  /** Pools (WIN/PLACE/SHOW) que paga cada caballo según su lugar de llegada,
   *  uniendo las posiciones que comparten Empate (Dead Heat): un empate en la
   *  posición P une P con P+1 en el mismo lugar, así los caballos empatados
   *  comparten exactamente los puestos que corresponden a ese lugar. */
  const poolsPorFila = useMemo(() => {
    const n = filas.length;
    const padre = Array.from({ length: n }, (_, i) => i);
    const find = (x: number): number => {
      while (padre[x] !== x) {
        padre[x] = padre[padre[x]];
        x = padre[x];
      }
      return x;
    };
    filas.forEach((r, i) => {
      if (!r.empate || i + 1 >= n) return;
      const a = find(i);
      const b = find(i + 1);
      if (a !== b) padre[b] = a;
    });
    return filas.map((_, i) => {
      let menor = i;
      for (let j = 0; j < n; j++) if (find(j) === find(i)) menor = Math.min(menor, j);
      const lugar = menor + 1;
      return { win: lugar <= 1, place: lugar <= 2, show: lugar <= 3 };
    });
  }, [filas]);

  if (!abierto) return null;

  const llenas = filas.filter((r) => r.numero.trim()).length;
  const primerNumero = filas.find((r) => r.numero.trim())?.numero ?? "";

  const setNumero = (i: number, v: string) =>
    setFilas((f) => f.map((r, j) => (j === i ? { ...r, numero: v.replace(/[^0-9]/g, "") } : r)));
  const toggleEmpate = (i: number) =>
    setFilas((f) => f.map((r, j) => (j === i ? { ...r, empate: !r.empate } : r)));
  const setDiv = (k: string, v: string) => setDividendos((d) => ({ ...d, [k]: v.replace(/[^\d.]/g, "") }));

  const confirmar = () => {
    const ordenNombres = new Map<number, string>(ORDENES.map((o) => [o.orden, o.nombre]));
    const pizarra = {} as Record<string, string>;
    const empates: number[] = [];
    let nLlenas = 0;
    filas.forEach((r, i) => {
      if (!r.numero.trim()) return;
      nLlenas += 1;
      const nombre = ordenNombres.get(i + 1);
      if (nombre) pizarra[nombre] = r.numero.trim();
      if (r.empate) empates.push(i + 1);
    });
    if (!pizarra.primero) return;
    if (!mismoRaya && rayaNumero.trim()) pizarra.primero_raya = rayaNumero.trim();
    const divFinal: Record<string, number> = {};
    if (usoDividendos) {
      for (const [k, v] of Object.entries(dividendos)) {
        const n = parseFloat(v);
        if (Number.isFinite(n) && n > 0) divFinal[k] = n;
      }
    }
    onConfirmar({
      pizarra: { ...pizarra, empates: empates.length ? empates : undefined } as PizarraCarrera,
      empates,
      llenas: nLlenas,
      dividendos: usoDividendos && Object.keys(divFinal).length ? divFinal : null,
      premio_por_tabla: premioTabla ? parseFloat(premioTabla) || null : null,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 print:hidden">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-line bg-slate-800 px-4 py-3 text-white">
          <h3 className="text-xs font-black uppercase tracking-wider">
            🏁 Carga de Resultados — {hipodromo} C{carrera}
          </h3>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="text-slate-300 hover:text-white">
            ✕
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-line bg-warning-500/10 px-4 py-2 text-[10px] font-semibold text-warning-700">
          ⚠️ Marcá “Empate” (Dead Heat) donde hubo empate: los caballos empatados comparten su pool (1°→WIN+PLACE+SHOW · 2°→PLACE+SHOW · 3°→SHOW) y el motor aplica CERO fraccionamiento.
        </div>

        {/* Cruzó la raya primero — TABLAS y REMATES pagan a ese caballo, aunque después sea bajado/descalificado */}
        <div className="border-b border-line bg-cyan-50/70 px-4 py-3">
          <label className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wider text-cyan-800">
            <input
              type="checkbox"
              checked={mismoRaya}
              onChange={(e) => setMismoRaya(e.target.checked)}
              className="h-4 w-4 accent-cyan-600"
            />
            El orden de llegada = cruce de la raya (TABLAS y REMATES pagan al 1º)
          </label>
          {mismoRaya ? (
            <p className="mt-1 text-[10px] italic text-slate-500">
              Si el ganador oficial fue “bajado”/descalificado y cambia el orden de llegada, desmarcá esta opción y estipulá el
              número del caballo que cruzó la raya primero para que TABLAS y REMATES sigan pagándole.
            </p>
          ) : (
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-0.5 text-[9px] font-bold uppercase text-slate-500">
                Nº del caballo que cruzó la raya primero
                <input
                  value={rayaNumero}
                  onChange={(e) => setRayaNumero(e.target.value.replace(/[^0-9]/g, ""))}
                  inputMode="numeric"
                  placeholder={primerNumero || "Nº"}
                  className="w-24 rounded-lg border border-cyan-300 bg-white px-2 py-1.5 font-mono text-sm font-black text-slate-900 placeholder:text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
                />
              </label>
              <p className="max-w-[260px] text-[10px] italic text-slate-500">
                Este caballo recibe TABLAS y REMATES; PUESTOS (WIN/PLACE/SHOW) y MARCAS siguen pagando por el orden de llegada oficial.
              </p>
            </div>
          )}
        </div>

        <div className="divide-y divide-line px-4">
          {llenas < minLugares && (
            <p className="flex items-center gap-1.5 bg-amber-500/10 px-2 py-1.5 text-[10px] font-semibold text-amber-700">
              ℹ️ Para calcular las jugadas de puestos se recomienda cargar al menos {minLugares} lugares de llegada (tenés {llenas} con número).
            </p>
          )}
          {filas.map((r, i) => {
            const pools = poolsPorFila[i];
            return (
              <div key={i} className="py-2">
                <div className="flex items-center gap-3">
                  <span
                    className="grid h-7 w-9 shrink-0 place-items-center rounded-md text-xs font-black"
                    style={{
                      backgroundColor: r.numero ? colorDeNumero(r.numero) : "#e2e8f0",
                      color: r.numero ? textoDeNumero(r.numero) : "#94a3b8",
                    }}
                  >
                    {r.numero || i + 1}
                  </span>
                  <span className="w-12 shrink-0 text-[11px] font-bold text-slate-600">{i + 1}°</span>
                  <input
                    value={r.numero}
                    onChange={(e) => setNumero(i, e.target.value)}
                    inputMode="numeric"
                    placeholder={caballos?.[i] ? String(caballos[i].numero) : "Nº"}
                    className="w-20 rounded-lg border border-line bg-surface px-2 py-1.5 text-center text-sm font-black text-slate-900 placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                  />
                  <label className="ml-auto flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
                    <input
                      type="checkbox"
                      checked={r.empate}
                      onChange={() => toggleEmpate(i)}
                      className="h-4 w-4 accent-amber-500"
                    />
                    Empate
                  </label>
                </div>
                {r.numero.trim() && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1 pl-[76px]">
                    <span className="text-[8px] font-black uppercase tracking-wider text-slate-400">Puestos:</span>
                    {pools.win && (
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[8px] font-black uppercase text-emerald-700">WIN</span>
                    )}
                    {pools.place && (
                      <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[8px] font-black uppercase text-sky-700">PLACE</span>
                    )}
                    {pools.show && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[8px] font-black uppercase text-amber-700">SHOW</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          <div className="flex gap-2 py-2">
            <button
              type="button"
              onClick={() => setFilas((f) => f.slice(0, -1))}
              disabled={filas.length <= LUGARES_MIN}
              className="flex-1 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-[11px] font-black uppercase tracking-wide text-slate-500 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              − Quitar {filas.length}° lugar
            </button>
            <button
              type="button"
              onClick={() =>
                setFilas((f) => [...f, { numero: String((caballos ?? [])[f.length]?.numero ?? ""), empate: false }])
              }
              className="flex-1 rounded-lg border border-dashed border-primary-400 bg-primary-500/5 px-3 py-2 text-[11px] font-black uppercase tracking-wide text-primary-600 transition-colors hover:bg-primary-500/10"
            >
              ＋ Añadir {filas.length + 1}° lugar
            </button>
          </div>
        </div>

        {/* Dividendos oficiales (Liquidación Universal) */}
        <div className="border-t border-line bg-indigo-50/50 px-4 py-3">
          <label className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wider text-indigo-700">
            <input
              type="checkbox"
              checked={usoDividendos}
              onChange={(e) => setUsoDividendos(e.target.checked)}
              className="h-4 w-4 accent-indigo-600"
            />
            Cargar dividendos oficiales (pago por $1) · comisión 5% sobre premio bruto
          </label>
          {usoDividendos && (
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(["win", "place", "show", "marcas", "tabla", "remate"] as const).map((k) => (
                <label key={k} className="flex flex-col gap-0.5 text-[9px] font-bold uppercase text-slate-500">
                  {k}
                  <input
                    value={dividendos[k] ?? ""}
                    onChange={(e) => setDiv(k, e.target.value)}
                    inputMode="decimal"
                    placeholder="2.00"
                    className="w-full rounded-lg border border-line bg-white px-2 py-1.5 font-mono text-sm font-black text-slate-900 placeholder:text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  />
                </label>
              ))}
              <label className="col-span-2 flex flex-col gap-0.5 text-[9px] font-bold uppercase text-slate-500">
                Premio por tabla (bruto × tablas)
                <input
                  value={premioTabla}
                  onChange={(e) => setPremioTabla(e.target.value.replace(/[^\d.]/g, ""))}
                  inputMode="decimal"
                  placeholder="ej. 2.50"
                  className="w-full rounded-lg border border-line bg-white px-2 py-1.5 font-mono text-sm font-black text-slate-900 placeholder:text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                />
              </label>
            </div>
          )}
        </div>

        <div className="border-t border-line bg-gray-50 px-4 py-3">
          <p className="mb-2 text-[10px] italic text-slate-500">
            Puestos (WIN/PLACE/SHOW) y MARCAS pagan por el orden de llegada oficial. TABLAS y REMATES pagan al caballo que cruzó
            la raya primero. Cero fraccionamiento: empate en 1° anula las A Premio (devuelve capital).
          </p>
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onCerrar}>
              Cancelar
            </Button>
            <Button variant="success" size="md" onClick={confirmar}>
              💾 Confirmar Resultados
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CargaResultadosModal;