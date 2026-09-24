"use client";

import { useTablasFijasStore } from "@/store/useTablasFijasStore";
import { useTaquillaStore } from "@/store/useTaquillaStore";

type Props = {
  hipodromo: string;
  fecha: string;
  /** Números de carrera existentes para [fecha + hipódromo] (fuente: BD). */
  carreras: number[];
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

function hipoKey(h: unknown): string {
  return String(h ?? "").toUpperCase().replace(/\s+/g, "");
}

/**
 * Semáforo de carreras contextualizado por fecha (clon dinámico del legacy):
 *  - Se alimenta de `carreras` (consulta a la BD para [fecha + hipódromo]).
 *  - SOLO se habilitan los botones de las carreras que existen ese día.
 *  - Sin carreras registradas → semáforo vacío/inactivo con aviso.
 *  - gris = sin registro · verde = Abierta · amarillo = Con jugadas · rojo = Cerrada.
 */
export function SemaforoCarreras({ hipodromo, fecha, carreras, activa, onSeleccionar }: Props) {
  const tablas = useTablasFijasStore((s) => s.tablas);
  const tickets = useTaquillaStore((s) => s.tickets);
  const hipo = hipoKey(hipodromo);

  const porCarrera = (n: number): { estado: EstadoCarrera; tieneVentas: boolean } => {
    const tabla = tablas.find(
      (t) => hipoKey(t.hipodromo) === hipo && t.carrera === n
    );
    const conVentas = tickets.some(
      (tk) =>
        tk.carrera === n &&
        (!tk.hipodromo || hipoKey(tk.hipodromo) === hipo) &&
        (!tk.fecha || tk.fecha === fecha)
    );
    if (!tabla) return conVentas ? { estado: "abierta", tieneVentas: conVentas } : { estado: "inactiva", tieneVentas: false };
    if (tabla.cerrada || String(tabla.estado ?? "").toLowerCase() === "cerrada")
      return { estado: "cerrada", tieneVentas: conVentas };
    return conVentas ? { estado: "con_jugadas", tieneVentas: true } : { estado: "abierta", tieneVentas: false };
  };

  const maxCarrera = carreras.length ? Math.max(...carreras) : 0;
  const total = maxCarrera;
  const vacio = maxCarrera === 0;

  return (
    <div className="rounded-2xl border border-line bg-surface p-3">
      <div className="mb-2 flex flex-wrap items-center gap-3 text-[10px] font-semibold text-slate-500">
        <span className="font-black uppercase tracking-wide">Semáforo — {hipodromo.toUpperCase()} · {fecha}</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full border border-line bg-surface" /> Inactiva</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-success-500" /> Abierta</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-warning-500" /> Con jugadas</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-danger-500" /> Cerrada</span>
      </div>
      {vacio ? (
        <p className="rounded-xl border border-dashed border-line bg-gray-50 px-3 py-2 text-center text-[11px] font-semibold text-slate-400">
          Sin carreras registradas para {fecha} · {hipodromo.toUpperCase()} — el semáforo queda inactivo.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: total }, (_, i) => i + 1).map((n) => {
            const existe = carreras.includes(n);
            const { estado } = porCarrera(n);
            const c = COLORES[estado];
            const activaEsta = n === activa;
            return (
              <button
                key={n}
                type="button"
                onClick={() => existe && onSeleccionar(n)}
                disabled={!existe}
                title={existe ? c.label : `C${n} sin registro para ${fecha}`}
                className={`grid h-9 w-9 place-items-center rounded-lg border-2 text-xs font-black transition-transform ${
                  existe ? `hover:scale-105 ${c.chip}` : "cursor-not-allowed border-dashed border-line bg-gray-50 text-slate-300"
                } ${activaEsta ? "ring-2 ring-primary-500 ring-offset-2" : ""}`}
              >
                {n}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default SemaforoCarreras;