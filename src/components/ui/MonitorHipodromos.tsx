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
import { hoyLocal } from "@/lib/gaceta/programa";
import { useHipodromosActivos } from "@/store/useHipodromosStore";
import { nombrePropioHipodromo } from "@/lib/hipodromos/nombre";

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

/** Un color por estado. La fuente de verdad es el sufijo `mon-chip-*`. */
export function claseEstadoCarrera(estado?: string | null): string {
  const e = (estado ?? "").toLowerCase();
  if (e.includes("liquid")) return "mon-chip-liquidada";
  if (e.includes("resultado")) return "mon-chip-resultados";
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
  /** Texto del estado vacío. Por defecto nombra la fecha. */
  vacio?: string;
  /** Botones extra a la derecha de la cabecera (slot). */
  acciones?: ReactNode;
  className?: string;
};

export function MonitorHipodromos({
  grupos,
  filtro,
  onFiltro,
  fecha,
  onFecha,
  vacio,
  acciones,
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
            📅 Día
            <input
              type="date"
              value={fecha}
              onChange={(e) => onFecha(e.target.value || hoyLocal())}
              title="Selecciona el día de los Hipódromos"
              className="mon-input"
            />
          </label>
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
                        className={`mon-chip ${claseEstadoCarrera(c.estado)}`}
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
