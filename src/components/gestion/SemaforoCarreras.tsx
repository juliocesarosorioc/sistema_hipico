"use client";

import { useTablasFijasStore } from "@/store/useTablasFijasStore";
import { useTaquillaStore } from "@/store/useTaquillaStore";

type Props = {
  hipodromo: string;
  activa: number;
  onSeleccionar: (carrera: number) => void;
};

export type EstadoCarrera = "inactiva" | "abierta" | "con_jugadas" | "cerrada";

const COLORES: Record<EstadoCarrera, { chip: string; label: string; txt: string }> = {
  inactiva: { chip: "border-line bg-surface text-slate-400", label: "Sin registro", txt: "text-slate-400" },
  abierta: { chip: "border-success-500/60 bg-success-500/15 text-success-700", label: "Abierta", txt: "text-success-700" },
  con_jugadas: { chip: "border-warning-500/70 bg-warning-500/20 text-warning-700", label: "Con jugadas", txt: "text-warning-700" },
  cerrada: { chip: "border-danger-500/70 bg-danger-500/15 text-danger-600", label: "Cerrada", txt: "text-danger-600" },
};

/**
 * Semáforo de carreras C1..C12 (clon del legacy):
 *  - gris    = sin registro (tabla no existe)
 *  - verde   = Abierta / sin jugadas cargadas
 *  - amarillo= Abierta con jugadas cargadas en la taquilla
 *  - rojo    = Cerrada (resultado cargado y carrera liquidada)
 * Se sincroniza en vivo con useTablasFijasStore y useTaquillaStore.
 */
export function SemaforoCarreras({ hipodromo, activa, onSeleccionar }: Props) {
  const tablas = useTablasFijasStore((s) => s.tablas);
  const tickets = useTaquillaStore((s) => s.tickets);
  const hipo = hipodromo.toUpperCase().trim();

  const porCarrera = (n: number): { estado: EstadoCarrera; tieneVentas: boolean } => {
    const tabla = tablas.find(
      (t) => (t.hipodromo ?? "").toUpperCase().replace(/\s+/g, "") === hipo.replace(/\s+/g, "") && t.carrera === n
    );
    const conVentas = tickets.some((tk) => tk.comando.startsWith(`TABLA ${hipo} C${n}`));
    if (!tabla) return conVentas ? { estado: "abierta", tieneVentas: conVentas } : { estado: "inactiva", tieneVentas: false };
    if (tabla.cerrada || String(tabla.estado ?? "").toLowerCase() === "cerrada")
      return { estado: "cerrada", tieneVentas: conVentas };
    return conVentas ? { estado: "con_jugadas", tieneVentas: true } : { estado: "abierta", tieneVentas: false };
  };

  const total = Math.min(Math.max(12, ...tablas.filter((t) => (t.hipodromo ?? "") === hipo).map((t) => t.carrera ?? 1)), 24);

  return (
    <div className="rounded-2xl border border-line bg-surface p-3">
      <div className="mb-2 flex flex-wrap items-center gap-3 text-[10px] font-semibold text-slate-500">
        <span className="font-black uppercase tracking-wide">Semáforo — {hipo}</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full border border-line bg-surface" /> Inactiva</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-success-500" /> Abierta</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-warning-500" /> Con jugadas</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-danger-500" /> Cerrada</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: total }, (_, i) => i + 1).map((n) => {
          const { estado } = porCarrera(n);
          const c = COLORES[estado];
          const activaEsta = n === activa;
          return (
            <button
              key={n}
              type="button"
              onClick={() => onSeleccionar(n)}
              title={c.label}
              className={`grid h-9 w-9 place-items-center rounded-lg border-2 text-xs font-black transition-transform hover:scale-105 ${c.chip} ${
                activaEsta ? "ring-2 ring-primary-500 ring-offset-2" : ""
              }`}
            >
              {n}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default SemaforoCarreras;