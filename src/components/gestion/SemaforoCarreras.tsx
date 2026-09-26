"use client";

import { useTablasFijasStore } from "@/store/useTablasFijasStore";
import { useTaquillaStore } from "@/store/useTaquillaStore";
import { useCarrerasDiaStore, type CarreraDelDia } from "@/store/useCarrerasDiaStore";

type Props = {
  hipodromo: string;
  fecha: string;
  /** Números de carrera existentes para [fecha + hipódromo] (fuente: BD). */
  carreras: number[];
  activa: number;
  onSeleccionar: (carrera: number) => void;
  /** Modo Manual (bypass Gaceta): habilita elegir carreras no registradas. */
  manual?: boolean;
};

export type EstadoCarrera = "inactiva" | "abierta" | "con_jugadas" | "cerrada";

const COLORES: Record<EstadoCarrera, { chip: string; label: string; txt: string }> = {
  inactiva: { chip: "border-line bg-surface text-slate-400", label: "Sin registro", txt: "text-slate-400" },
  abierta: { chip: "border-success-500/60 bg-success-500/15 text-success-700", label: "Registrada", txt: "text-success-700" },
  con_jugadas: { chip: "border-warning-500/70 bg-warning-500/20 text-warning-700", label: "Con jugadas", txt: "text-warning-700" },
  cerrada: { chip: "border-danger-500/70 bg-danger-500/15 text-danger-600", label: "Liquidada", txt: "text-danger-600" },
};

function hipoKey(h: unknown): string {
  return String(h ?? "").toUpperCase().replace(/\s+/g, "");
}

/** Ancho del semáforo en modo manual: 12 carreras por defecto (siempre clicables). */
const MANUAL_TOTAL = 12;

/**
 * Semáforo de carreras contextualizado por fecha (clon dinámico del legacy):
 *  - Se alimenta de `carreras` (consulta a la BD para [fecha + hipódromo]).
 *  - SOLO se habilitan los botones de las carreras que existen ese día.
 *  - Modo Manual (manual=true): TODAS las carreras quedan habilitadas para
 *    registrar jugadas en una carrera vacía sin depender de la Gaceta IA.
 *  - Sin carreras registradas → semáforo vacío/inactivo con aviso.
 *  - gris = sin registro · verde = Registrada (abierta por gacetas) ·
 *    amarillo = Con jugadas · rojo = Liquidada.
 */
export function SemaforoCarreras({ hipodromo, fecha, carreras, activa, onSeleccionar, manual }: Props) {
  const tablas = useTablasFijasStore((s) => s.tablas);
  const tickets = useTaquillaStore((s) => s.tickets);
  const carrerasDia = useCarrerasDiaStore((s) => s.carreras);
  const hipo = hipoKey(hipodromo);

  const porCarrera = (n: number): { estado: EstadoCarrera; tieneVentas: boolean } => {
    const tabla = tablas.find(
      (t) => hipoKey(t.hipodromo) === hipo && t.carrera === n
    );
    const registro = carrerasDia.find(
      (c: CarreraDelDia) => hipoKey(c.hipodromo) === hipo && c.carrera === n
    );
    const registrada = carreras.includes(n);
    const liquidada =
      Boolean(tabla?.cerrada) ||
      String(tabla?.estado ?? "").toLowerCase() === "cerrada" ||
      String(registro?.estado ?? "").toLowerCase() === "liquidada";
    const conVentas = tickets.some(
      (tk) =>
        tk.carrera === n &&
        (!tk.hipodromo || hipoKey(tk.hipodromo) === hipo) &&
        (!tk.fecha || tk.fecha === fecha)
    );
    if (liquidada) return { estado: "cerrada", tieneVentas: conVentas };
    if (conVentas) return { estado: "con_jugadas", tieneVentas: true };
    if (registrada || tabla) return { estado: "abierta", tieneVentas: false };
    return { estado: "inactiva", tieneVentas: false };
  };

  const maxCarrera = carreras.length ? Math.max(...carreras) : 0;
  const total = manual ? Math.max(MANUAL_TOTAL, maxCarrera, activa) : maxCarrera;
  const vacio = !manual && maxCarrera === 0;

  return (
    <div className="rounded-2xl border border-line bg-surface p-3">
      <div className="mb-2 flex flex-wrap items-center gap-3 text-[10px] font-semibold text-slate-500">
        <span className="font-black uppercase tracking-wide">{hipodromo.toUpperCase()} · CARRERAS DEL {fecha}</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full border border-line bg-surface" /> Sin registro</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-success-500" /> Registrada</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-warning-500" /> Con jugadas</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-danger-500" /> Liquidada</span>
        {manual && (
          <span className="rounded-full bg-cyan-500/15 px-2 py-0.5 font-black uppercase text-cyan-700">
            ✍️ Modo Manual — carreras sin Gaceta habilitadas
          </span>
        )}
      </div>
      {vacio ? (
        <p className="rounded-xl border border-dashed border-line bg-gray-50 px-3 py-2 text-center text-[11px] font-semibold text-slate-400">
          Sin carreras registradas para {fecha} · {hipodromo.toUpperCase()} — el semáforo queda inactivo.
          {manual && " En Modo Manual la carrera activa queda habilitada para cargar jugadas."}
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: total }, (_, i) => i + 1).map((n) => {
            const existe = manual || carreras.includes(n);
            const { estado } = porCarrera(n);
            const c = COLORES[estado];
            const activaEsta = n === activa;
            return (
              <button
                key={n}
                type="button"
                onClick={() => existe && onSeleccionar(n)}
                disabled={!existe}
                title={existe ? (manual && !carreras.includes(n) ? `C${n} (manual — sin registro en BD)` : c.label) : `C${n} sin registro para ${fecha}`}
                className={`grid h-9 w-9 place-items-center rounded-lg border-2 text-xs font-black transition-transform ${
                  existe ? `hover:scale-105 ${manual && !carreras.includes(n) ? "border-dashed border-cyan-400 bg-cyan-50 text-cyan-700" : c.chip}` : "cursor-not-allowed border-dashed border-line bg-gray-50 text-slate-300"
                } ${activaEsta ? "ring-4 ring-indigo-500 ring-offset-2" : ""}`}
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