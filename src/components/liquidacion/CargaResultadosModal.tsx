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
  /** Dividendos oficiales por $1 — POR CABALLO (claves "win:7", "place:7",
   *  "show:7"), solo para los pools que paga cada caballo según su lugar
   *  (1°→W+P+S · 2°→P+S · 3°→S). */
  dividendos?: Record<string, number> | null;
  /** Premio por tabla: NO se carga aquí — se calcula automáticamente con lo que
   *  paga la tabla × la cantidad jugada (los retiros ajustan en el motor). */
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

type Pool = "win" | "place" | "show";

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
 * Módulo de Liquidación — Carga de Resultados compacta, con posiciones de
 * llegada SIN tope (mínimo 1) y checkbox de Empate (Dead Heat) por posición.
 * El WIN/PLACE/SHOW es POR CABALLO: cada ejemplar muestra los pools que paga
 * según su lugar (1°→W+P+S, 2°→P+S, 3°→S) y los caballos empatados comparten
 * su pool. Solo se cargan dividendos por caballo (opcional).
 *
 * MARCAS se pagan por el orden final de la pizarra (sin casilla). TABLAS y
 * REMATES pagan al caballo que CRUZÓ LA RAYA primero (por defecto el 1º
 * oficial); si un ganador es bajado/descalificado se puede estipular su número.
 * El premio por tabla se calcula automáticamente (valor que paga × cantidad).
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
  const [mismoRaya, setMismoRaya] = useState(true);
  const [rayaNumero, setRayaNumero] = useState("");

  useEffect(() => {
    if (!abierto) return;
    setUsoDividendos(false);
    setDividendos({});
    setMismoRaya(true);
    setRayaNumero("");
    const base = Array.from({ length: minLugares }, (_, i) => {
      const n = (caballos ?? [])[i];
      return { numero: n ? String(n.numero) : "", empate: false };
    });
    setFilas(base);
  }, [abierto, caballos, minLugares]);

  /** Pools que paga cada caballo según su lugar de llegada, uniendo las
   *  posiciones que comparten Empate (Dead Heat): un empate en la posición P
   *  une P con P+1 en el mismo lugar, así los caballos empatados comparten
   *  exactamente los puestos que corresponden a ese lugar. */
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

    // Dividendos POR CABALLO, solo de los pools que paga cada lugar.
    const divFinal: Record<string, number> = {};
    if (usoDividendos) {
      const write = (pool: Pool, numero: string) => {
        const v = parseFloat(dividendos[`${pool}:${numero}`] ?? "");
        if (Number.isFinite(v) && v > 0) divFinal[`${pool}:${numero}`] = v;
      };
      filas.forEach((r, i) => {
        const n = r.numero.trim();
        if (!n) return;
        const pools = poolsPorFila[i];
        if (pools.win) write("win", n);
        if (pools.place) write("place", n);
        if (pools.show) write("show", n);
      });
    }
    onConfirmar({
      pizarra: { ...pizarra, empates: empates.length ? empates : undefined } as PizarraCarrera,
      empates,
      llenas: nLlenas,
      dividendos: usoDividendos && Object.keys(divFinal).length ? divFinal : null,
    });
  };

  const PoolInput = ({ pool, numero }: { pool: Pool; numero: string }) => (
    <label
      title={`Dividendo ${pool === "win" ? "WIN" : pool === "place" ? "PLACE" : "SHOW"} del ${
        pool === "win" ? "1º" : pool === "place" ? "2º" : "3º"
      } (${numero}) por $1`}
      className="flex items-center gap-0.5 rounded border border-indigo-100 bg-indigo-50/60 px-1 py-0.5"
    >
      <span className="text-[8px] font-black uppercase leading-none text-indigo-400">{pool.slice(0, 1)}</span>
      <input
        value={dividendos[`${pool}:${numero}`] ?? ""}
        onChange={(e) => setDiv(`${pool}:${numero}`, e.target.value)}
        inputMode="decimal"
        placeholder="0.00"
        className="w-12 rounded bg-white px-1 py-0.5 text-center font-mono text-[11px] font-black text-slate-900 placeholder:text-slate-300 outline-none focus:ring-1 focus:ring-indigo-400"
      />
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 print:hidden">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-line bg-slate-800 px-3 py-2.5 text-white">
          <h3 className="text-[11px] font-black uppercase tracking-wider">
            🏁 Carga de Resultados — {hipodromo} C{carrera}
          </h3>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="text-slate-300 hover:text-white">
            ✕
          </button>
        </div>

        <div className="flex items-center gap-1.5 border-b border-line bg-warning-500/10 px-3 py-1.5 text-[9px] font-semibold text-warning-700">
          ⚠️ Empate (Dead Heat): los caballos empatados comparten su pool (1°→W+P+S · 2°→P+S · 3°→S · CERO fraccionamiento).
        </div>

        {/* Cruzó la raya primero — TABLAS y REMATES pagan a ese caballo */}
        <div className="border-b border-line bg-cyan-50/70 px-3 py-2">
          <label className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-cyan-800">
            <input
              type="checkbox"
              checked={mismoRaya}
              onChange={(e) => setMismoRaya(e.target.checked)}
              className="h-3.5 w-3.5 accent-cyan-600"
            />
            El orden de llegada = cruce de la raya (TABLAS/REMATES pagan al 1º)
          </label>
          {mismoRaya ? (
            <p className="mt-0.5 text-[9px] italic text-slate-500">
              Si el ganador fue “bajado”/descalificado y cambia el orden oficial, desmarcá y estipulá su número para que
              TABLAS y REMATES sigan pagándole.
            </p>
          ) : (
            <div className="mt-1.5 flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-0.5 text-[8px] font-bold uppercase text-slate-500">
                Nº del caballo que cruzó la raya primero
                <input
                  value={rayaNumero}
                  onChange={(e) => setRayaNumero(e.target.value.replace(/[^0-9]/g, ""))}
                  inputMode="numeric"
                  placeholder={primerNumero || "Nº"}
                  className="w-20 rounded-lg border border-cyan-300 bg-white px-1.5 py-1 font-mono text-xs font-black text-slate-900 placeholder:text-slate-300 outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </label>
              <p className="max-w-[220px] text-[9px] italic text-slate-500">
                Este caballo cobra TABLAS y REMATES; los puestos (WIN/PLACE/SHOW) y MARCAS pagan por el orden de llegada oficial.
              </p>
            </div>
          )}
        </div>

        <div className="divide-y divide-line px-3">
          {llenas < minLugares && (
            <p className="flex items-center gap-1.5 bg-amber-500/10 px-2 py-1 text-[9px] font-semibold text-amber-700">
              ℹ️ Para calcular jugadas de puestos se recomienda cargar al menos {minLugares} lugares (tenés {llenas}).
            </p>
          )}
          {filas.map((r, i) => {
            const pools = poolsPorFila[i];
            return (
              <div key={i} className="py-1.5">
                <div className="flex items-center gap-2">
                  <span
                    className="grid h-6 w-8 shrink-0 place-items-center rounded-md text-[11px] font-black"
                    style={{
                      backgroundColor: r.numero ? colorDeNumero(r.numero) : "#e2e8f0",
                      color: r.numero ? textoDeNumero(r.numero) : "#94a3b8",
                    }}
                  >
                    {r.numero || i + 1}
                  </span>
                  <span className="w-8 shrink-0 text-[10px] font-bold text-slate-600">{i + 1}°</span>
                  <input
                    value={r.numero}
                    onChange={(e) => setNumero(i, e.target.value)}
                    inputMode="numeric"
                    placeholder={caballos?.[i] ? String(caballos[i].numero) : "Nº"}
                    className="w-16 rounded-lg border border-line bg-surface px-1.5 py-1 text-center text-xs font-black text-slate-900 placeholder:text-slate-400 outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                  />
                  <span className="flex flex-wrap gap-0.5">
                    {r.numero.trim() && pools.win && (
                      <span className="rounded bg-emerald-100 px-1 py-0.5 text-[8px] font-black uppercase text-emerald-700">W</span>
                    )}
                    {r.numero.trim() && pools.place && (
                      <span className="rounded bg-sky-100 px-1 py-0.5 text-[8px] font-black uppercase text-sky-700">P</span>
                    )}
                    {r.numero.trim() && pools.show && (
                      <span className="rounded bg-amber-100 px-1 py-0.5 text-[8px] font-black uppercase text-amber-700">S</span>
                    )}
                  </span>
                  <label className="ml-auto flex items-center gap-1 text-[10px] font-semibold text-slate-600">
                    <input type="checkbox" checked={r.empate} onChange={() => toggleEmpate(i)} className="h-3.5 w-3.5 accent-amber-500" />
                    Empate
                  </label>
                </div>
                {r.numero.trim() && usoDividendos && (
                  <div className="mt-1 flex flex-wrap items-center gap-1 pl-10">
                    {pools.win && <PoolInput pool="win" numero={r.numero.trim()} />}
                    {pools.place && <PoolInput pool="place" numero={r.numero.trim()} />}
                    {pools.show && <PoolInput pool="show" numero={r.numero.trim()} />}
                  </div>
                )}
              </div>
            );
          })}

          <div className="flex gap-1.5 py-1.5">
            <button
              type="button"
              onClick={() => setFilas((f) => f.slice(0, -1))}
              disabled={filas.length <= LUGARES_MIN}
              className="flex-1 rounded-lg border border-dashed border-slate-300 px-2 py-1.5 text-[10px] font-black uppercase tracking-wide text-slate-500 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              − Quitar {filas.length}° lugar
            </button>
            <button
              type="button"
              onClick={() =>
                setFilas((f) => [...f, { numero: String((caballos ?? [])[f.length]?.numero ?? ""), empate: false }])
              }
              className="flex-1 rounded-lg border border-dashed border-primary-400 bg-primary-500/5 px-2 py-1.5 text-[10px] font-black uppercase tracking-wide text-primary-600 transition-colors hover:bg-primary-500/10"
            >
              ＋ Añadir {filas.length + 1}° lugar
            </button>
          </div>
        </div>

        {/* Dividendos POR CABALLO (opcional) — WIN/PLACE/SHOW */}
        <div className="border-t border-line bg-indigo-50/50 px-3 py-2">
          <label className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-indigo-700">
            <input
              type="checkbox"
              checked={usoDividendos}
              onChange={(e) => setUsoDividendos(e.target.checked)}
              className="h-3.5 w-3.5 accent-indigo-600"
            />
            Cargar dividendos por caballo (opcional) · comisión 5% sobre premio bruto
          </label>
          {usoDividendos && (
            <p className="mt-1 text-[9px] italic text-slate-500">
              Cada caballo carga solo el dividendo de los pools que paga según su lugar: 1°→W+P+S · 2°→P+S · 3°→S. Los
              empatados del 1º comparten todo el pool WPS.
            </p>
          )}
        </div>

        <div className="border-t border-line bg-gray-50 px-3 py-2">
          <p className="mb-1.5 text-[9px] italic text-slate-500">
            Puestos (WIN/PLACE/SHOW) y MARCAS pagan por el orden de llegada oficial. TABLAS y REMATES pagan al que cruzó la
            raya primero; el premio de la tabla se calcula automáticamente (lo que paga × cantidad, con ajuste proporcional por
            retiros).
          </p>
          <div className="flex items-center justify-end gap-1.5">
            <Button variant="ghost" size="sm" onClick={onCerrar}>
              Cancelar
            </Button>
            <Button variant="success" size="sm" onClick={confirmar}>
              💾 Confirmar Resultados
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CargaResultadosModal;