"use client";

import type { ReactNode } from "react";
import { SearchableSelect, type OpcionSelect } from "@/shared/components/ui/SearchableSelect";
import { DateInput } from "@/shared/components/ui/DateInput";
import { ordenarHipodromosDeLaJornada } from "@/shared/lib/hipodromos-jornada";

/**
 * BUSCADOR DE JORNADA — la forma canónica de elegir fecha + hipódromo.
 *
 * Es la MISMA grilla compacta que usa Gestión de Jugadas:
 *
 *   `grid gap-1.5 rounded-xl border border-line bg-surface p-2 lg:grid-cols-N`
 *   `1 · Fecha 📅`   `2 · Hipódromo`   + los campos propios de cada módulo
 *
 * Nació para que Pollas e Inteligencia dejaran de tener cada una su propia
 * barra (un `<select>` suelto acá, un `SearchableSelect` allá) y el operador
 * encuentre los dos campos en el mismo lugar, con la misma tipografía y el
 * mismo ancho en todas las pantallas.
 *
 * REGLA DE ORDEN: los hipódromos con carreras cargadas ese día van primero
 * (`ordenarHipodromosDeLaJornada`); el catálogo completo sigue disponible
 * detrás para poder consultar uno sin jornada.
 */

const COLUMNAS: Record<number, string> = {
  4: "lg:grid-cols-4",
  5: "lg:grid-cols-5",
  6: "lg:grid-cols-6",
  7: "lg:grid-cols-7",
  8: "lg:grid-cols-8",
};

/**
 * Cuántas columnas ocupa el bloque de acciones. Se resuelve con un mapa fijo
 * (no con `lg:col-span-${n}`) porque Tailwind solo genera las clases que ve
 * escritas en el código: una interpolación dinámica no existiría en el CSS.
 */
const SPAN_ACCIONES: Record<number, string> = {
  4: "lg:col-span-2",
  5: "lg:col-span-3",
  6: "lg:col-span-4",
  7: "lg:col-span-5",
  8: "lg:col-span-6",
};

export type PropsBuscadorJornada = {
  fecha: string;
  onFecha: (fecha: string) => void;
  /** Valor elegido en el selector de hipódromo (id o nombre, según el módulo). */
  hipodromo: string;
  onHipodromo: (valor: string) => void;
  /** Catálogo del selector: `value` es lo que devuelve `onHipodromo`. */
  hipodromos: OpcionSelect[];
  /**
   * Claves (nombre canónico) de los hipódromos con carreras ese día. Se usan
   * solo para ORDENAR; nunca para recortar el catálogo.
   */
  delDia?: string[];
  /**
   * Nombre real de la opción, cuando su `value` es un id (Pollas filtra por
   * `hipodromo_id`). Sin esto se compara el `label`.
   */
  nombreDe?: (opcion: OpcionSelect) => string;
  /** Celdas extra dentro de la misma grilla (cada una ocupa una columna). */
  children?: ReactNode;
  /** Botones al final de la grilla. */
  acciones?: ReactNode;
  columnas?: 4 | 5 | 6 | 7 | 8;
  /** Deshabilita los dos campos mientras se recarga la jornada. */
  disabled?: boolean;
  /** Texto del placeholder del buscador de hipódromo. */
  placeholderHipodromo?: string;
  className?: string;
};

export function BuscadorJornada({
  fecha,
  onFecha,
  hipodromo,
  onHipodromo,
  hipodromos,
  delDia = [],
  nombreDe,
  children,
  acciones,
  columnas = 7,
  disabled = false,
  placeholderHipodromo = "Buscar hipódromo…",
  className = "",
}: PropsBuscadorJornada) {
  const opciones = ordenarHipodromosDeLaJornada(hipodromos ?? [], delDia, nombreDe);

  return (
    <div
      className={`grid gap-2 rounded-xl border border-line bg-surface p-2.5 ${COLUMNAS[columnas] ?? COLUMNAS[7]} ${className}`}
    >
      <div>
        <label className="mb-1 block h-3.5 text-[10px] font-bold uppercase leading-none tracking-wide text-slate-500">
          1 · Fecha 📅
        </label>
        <DateInput
          value={fecha}
          disabled={disabled}
          onFechaChange={onFecha}
          className="w-full h-9 text-xs font-bold"
        />
      </div>

      <div>
        <label className="mb-1 block h-3.5 text-[10px] font-bold uppercase leading-none tracking-wide text-slate-500">
          2 · Hipódromo
        </label>
        <SearchableSelect
          options={opciones}
          value={hipodromo}
          onChange={onHipodromo}
          placeholder={placeholderHipodromo}
          allowCustom={false}
          disabled={disabled}
          inputClassName="w-full h-9 rounded-lg border border-line bg-surface px-3 text-xs font-bold normal-case text-slate-900 placeholder:font-normal placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-slate-400"
        />
      </div>

      {children}

      {acciones && (
        <div
          className={`flex flex-wrap items-center justify-end gap-2 self-end min-h-[36px] ${SPAN_ACCIONES[columnas] ?? SPAN_ACCIONES[7]}`}
        >
          {acciones}
        </div>
      )}
    </div>
  );
}

export default BuscadorJornada;
