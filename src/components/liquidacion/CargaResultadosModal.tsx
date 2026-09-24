"use client";

import { useEffect, useState } from "react";
import type { PizarraCarrera } from "@/lib/liquidacion";
import type { EjemplarTabla } from "@/lib/tablas/tipos";
import { colorDeNumero, textoDeNumero } from "@/lib/tablas/tipos";
import { Button } from "@/components/ui/Button";

export type PizarraResultados = {
  pizarra: PizarraCarrera;
  empates: number[];
  llenas: number; // cuántas posiciones de llegada se cargaron
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

type Fila = { numero: string; empate: boolean };

type Props = {
  abierto: boolean;
  onCerrar: () => void;
  hipodromo: string;
  carrera: string;
  /** Ejemplares de la tabla (opcional): prefija los números 1..8 en orden. */
  caballos?: EjemplarTabla[] | null;
  onConfirmar: (r: PizarraResultados) => void;
};

/**
 * Módulo de Liquidación — Carga de Resultados con 8 posiciones de llegada
 * (clon del legacy mejorado) y checkbox de Empate (Dead Heat) por posición.
 * El motor matemático aplica la regla de CERO fraccionamiento (A PREMIO con
 * 1° empatado = ANULADA). Ejemplo incluido para el operador.
 */
export function CargaResultadosModal({ abierto, onCerrar, hipodromo, carrera, caballos, onConfirmar }: Props) {
  const [filas, setFilas] = useState<Fila[]>([]);

  useEffect(() => {
    if (!abierto) return;
    const base = Array.from({ length: 8 }, (_, i) => {
      const n = (caballos ?? [])[i];
      return { numero: n ? String(n.numero) : "", empate: false };
    });
    setFilas(base);
  }, [abierto, caballos]);

  if (!abierto) return null;

  const setNumero = (i: number, v: string) =>
    setFilas((f) => f.map((r, j) => (j === i ? { ...r, numero: v.replace(/[^0-9]/g, "") } : r)));
  const toggleEmpate = (i: number) =>
    setFilas((f) => f.map((r, j) => (j === i ? { ...r, empate: !r.empate } : r)));

  const confirmar = () => {
    const ordenNombres = new Map<number, string>(ORDENES.map((o) => [o.orden, o.nombre]));
    const pizarra = {} as Record<string, string>;
    const empates: number[] = [];
    let llenas = 0;
    filas.forEach((r, i) => {
      if (!r.numero.trim()) return;
      llenas += 1;
      const nombre = ordenNombres.get(i + 1);
      if (nombre) pizarra[nombre] = r.numero.trim();
      if (r.empate) empates.push(i + 1);
    });
    if (!pizarra.primero) return;
    onConfirmar({ pizarra: { ...pizarra, empates: empates.length ? empates : undefined } as PizarraCarrera, empates, llenas });
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
          ⚠️ Marcá “Empate” (Dead Heat) donde hubo empate: el motor aplica la regla de CERO fraccionamiento.
        </div>

        <div className="divide-y divide-line px-4">
          {filas.map((r, i) => (
            <div key={i} className="flex items-center gap-3 py-2">
              <span
                className="grid h-7 w-9 shrink-0 place-items-center rounded-md text-xs font-black"
                style={{
                  backgroundColor: r.numero ? colorDeNumero(r.numero) : "#e2e8f0",
                  color: r.numero ? textoDeNumero(r.numero) : "#94a3b8",
                }}
              >
                {r.numero || i + 1}
              </span>
              <span className="w-14 text-[11px] font-bold text-slate-600">{i + 1}° lugar</span>
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
          ))}
        </div>

        <div className="border-t border-line bg-gray-50 px-4 py-3">
          <p className="mb-2 text-[10px] italic text-slate-500">
            La pizarra se envía al motor con {ORDENES.length} posiciones. Cero fraccionamiento: empate en 1° anula las
            A Premio (devuelve capital).
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