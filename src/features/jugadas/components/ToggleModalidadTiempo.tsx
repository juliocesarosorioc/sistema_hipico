"use client";

/**
 * ============================================================================
 * TOGGLE DE MODALIDAD DE TIEMPO — ⚡ En Vivo vs ⏳ Jugada Adelantada
 * ============================================================================
 *
 * Control segmentado (dos mitades de la misma píldora, sin botones redondos
 * sueltos) que aparece en la "barra de carga de jugadas" de cada módulo:
 * Taquilla, Marcas, Tablas Fijas, Dupletas, Remates y Pollas.
 *
 * ⚡ En Vivo = comportamiento de siempre: la jugada se carga mientras la carrera
 *              corre. Es el valor por defecto, así que nadie que no toque nada
 *              cambia de comportamiento.
 * ⏳ Jugada Adelantada = se cargó ANTES de que corra la carrera; el ticket se
 *              escribe con `es_adelantada = true` y el reporte de liquidación
 *              lo puede separar con su filtro segmentado.
 *
 * La marca se aplica DESPUÉS de la venta (ver lib/marcar-adelantadas.ts): este
 * componente no toca la base, solo dice qué quiere el operador.
 */
import {
  ETIQUETA_ADELANTADA,
  ETIQUETA_EN_VIVO,
  TITULO_TOGGLE,
  claseBotonToggle,
  type ModalidadTiempo,
} from "../lib/modalidad-tiempo";

type Props = {
  valor: ModalidadTiempo;
  onChange: (m: ModalidadTiempo) => void;
  /** Clases extra para acomodarlo a la barra que lo contiene. */
  className?: string;
};

export function ToggleModalidadTiempo({ valor, onChange, className = "" }: Props) {
  const enVivo = valor !== "ADELANTADA";
  return (
    <div
      role="group"
      aria-label={TITULO_TOGGLE}
      className={`inline-flex items-center rounded-md border border-slate-700 bg-slate-950/70 p-0.5 ${className}`}
    >
      <button
        type="button"
        onClick={() => onChange("EN_VIVO")}
        aria-pressed={enVivo}
        title="En Vivo: la jugada se carga mientras la carrera corre (comportamiento habitual)."
        className={`rounded ${claseBotonToggle(enVivo)}`}
      >
        {ETIQUETA_EN_VIVO}
      </button>
      <button
        type="button"
        onClick={() => onChange("ADELANTADA")}
        aria-pressed={!enVivo}
        title="Adelantada: la jugada se cargó ANTES de que corra la carrera."
        className={`rounded ${claseBotonToggle(!enVivo)}`}
      >
        {ETIQUETA_ADELANTADA}
      </button>
    </div>
  );
}

/**
 * Badge distintivo ⏳ ADELANTADA junto a la jugada (reporte, preview y tickets).
 */
export function BadgeAdelantada({ className = "" }: { className?: string }) {
  return (
    <span
      title="Jugada adelantada: cargada antes de que corra la carrera."
      className={`inline-block rounded bg-amber-400/15 px-1 py-px text-[9px] font-black uppercase leading-tight tracking-wide text-amber-500 ring-1 ring-amber-400/40 ${className}`}
    >
      ⏳ ADELANTADA
    </span>
  );
}
