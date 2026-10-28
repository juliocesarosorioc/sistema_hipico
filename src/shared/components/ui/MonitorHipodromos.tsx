"use client";

/**
 * Monitor de Hipódromos del Día — panel reutilizable.
 *
 * Muestra una tarjeta por hipódromo con un chip por cada carrera registrada en
 * la fecha, y filtra por hipódromo al hacer clic en la tarjeta. El estilo NO
 * vive aquí: todas las clases salen del bloque centralizado `@layer components`
 * de `src/app/globals.css` (prefijo `mon-`), para que el próximo módulo que
 * necesite el mismo panel solo tenga que pasarle los datos.
 *
 * Lo usan hoy Tablas Fijas (Monitor de Tablas Publicadas) y Carreras del Día.
 */
import type { ReactNode } from "react";
import { DateInput } from "@/shared/components/ui/DateInput";
import { hoyLocal } from "@/features/gaceta/lib/programa";
import { useHipodromosActivos } from "@/shared/store/useHipodromosStore";
import { nombrePropioHipodromo } from "@/features/hipodromos/lib/nombre";

export type CarreraMonitor = {
  id?: string | number;
  carrera: number | string;
  estado?: string | null;
  ventas?: number;
  /** Ejemplares retirados de la carrera, si el módulo los conoce. */
  retirados?: string[];
};

export type GrupoHipodromo = {
  hipodromo: string;
  carreras: CarreraMonitor[];
};

/** Un color por estado (4 colores oficiales del semáforo de carreras). */
export function claseEstadoCarrera(estado?: string | null, ventas?: number): string {
  const e = (estado ?? "").toLowerCase();
  if (e.includes("liquid") || e.includes("cerrad")) return "mon-chip-liquidada";
  if (e.includes("jugada") || e.includes("resultado") || (ventas != null && ventas > 0)) return "mon-chip-resultados";
  if (e.includes("sin") || e.includes("inactiv") || e.includes("no_registrad")) return "mon-chip-sin-registro";
  if (e.includes("retira")) return "mon-chip-retirada";
  return "mon-chip-programada";
}

type Props = {
  grupos: GrupoHipodromo[];
  /** Hipódromo activo; "" = sin filtro. */
  filtro: string;
  onFiltro: (hipodromo: string) => void;
  fecha: string;
  onFecha: (fecha: string) => void;
  /** Permite dejar la fecha VACÍA = "todos los días". Tablas Fijas lo usa para
   *  listar todas las tablas publicadas; Carreras del Día lo deja apagado
   *  (siempre trabaja sobre un día concreto). */
  permitirTodos?: boolean;
  /** Texto del estado vacío. Por defecto nombra la fecha. */
  vacio?: string;
  /** Botones extra a la derecha de la cabecera (slot). */
  acciones?: ReactNode;
  /** Eje del día mostrado: rotula el campo de fecha ("🏇 Carrera" / "🧾 Venta"). */
  ejeFecha?: "carrera" | "venta";
  className?: string;
};

export function MonitorHipodromos({
  grupos,
  filtro,
  onFiltro,
  fecha,
  onFecha,
  permitirTodos = false,
  vacio,
  acciones,
  ejeFecha,
  className,
}: Props) {
  const activos = useHipodromosActivos();
  const nombre = (h: string) => nombrePropioHipodromo(h, activos);
  return (
    <div className={`no-print ${className ?? ""}`}>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <span className="mon-titulo">
          🏇 Hipódromos del Día
          <span className="mon-contador">{grupos.length}</span>
        </span>
        <div className="flex items-center gap-2">
          <label className="mon-control">
            {ejeFecha === "venta" ? "🧾 Venta" : ejeFecha === "carrera" ? "🏇 Carrera" : "📅 Día"}
            <DateInput
              value={fecha}
              onFechaChange={(val) => onFecha(permitirTodos ? val : val || hoyLocal())}
              title={
                ejeFecha === "venta"
                  ? "Selecciona el día de VENTA de los Hipódromos"
                  : "Selecciona el día de CARRERA de los Hipódromos"
              }
              className="mon-input py-0.5 px-1.5 text-[12px]"
            />
          </label>
          {permitirTodos && (
            fecha ? (
              <button
                type="button"
                onClick={() => onFecha("")}
                className="mon-limpiar"
                title="Ver todos los días"
              >
                🗓️ Todos los días
              </button>
            ) : (
              <span className="mon-contador" title="Mostrando todas las fechas">
                🗓️ Todos los días
              </span>
            )
          )}
          {filtro && (
            <button type="button" onClick={() => onFiltro("")} className="mon-limpiar">
              ✕ Limpiar filtro: {nombre(filtro)}
            </button>
          )}
          {acciones}
        </div>
      </div>

      {grupos.length === 0 ? (
        <p className="mon-vacio">{vacio ?? `Sin hipódromos registrados para la fecha ${fecha}.`}</p>
      ) : (
        <div className="mon-grid">
{grupos.map(({ hipodromo, carreras }) => {
            const activo = filtro === hipodromo;
            const nombreHipo = nombre(hipodromo);
            return (
              <button
                key={hipodromo}
                type="button"
                onClick={() => onFiltro(activo ? "" : hipodromo)}
                title={
                  activo
                    ? `Quitar filtro de ${nombreHipo}`
                    : `Filtrar el monitor por ${nombreHipo} (${carreras.length} carrera(s))`
                }
                className={`mon-tarjeta ${activo ? "mon-tarjeta-activa" : ""}`}
              >
                <span className="mon-hipo">🏛️ {nombreHipo}</span>
                <span className="mon-hipo-sub">{carreras.length} carrera(s) en el día</span>
                <span className="mon-chips">
                  {carreras
                    .slice()
                    .sort((a, b) => Number(a.carrera || 0) - Number(b.carrera || 0))
                    .map((c) => (
                      <span
                        key={String(c.id ?? c.carrera)}
                        className={`mon-chip ${claseEstadoCarrera(c.estado, c.ventas)}`}
                        title={`${nombreHipo} C${c.carrera} · ${c.estado ?? "Programada"} · ${c.ventas ?? 0} venta(s)`}
                      >
                        C{c.carrera}
                      </span>
                    ))}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default MonitorHipodromos;
