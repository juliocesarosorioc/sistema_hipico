"use client";

/**
 * ============================================================================
 * CamposComisionesConvenio — bloque de comisión por convenio de producto
 * ============================================================================
 * Se usa IGUAL en la creación de grupos (asistente y modal) y en la edición:
 * una sola fuente para el rótulo, el orden y la semántica ("vacío = hereda la
 * comisión de Entre Tercios").
 *
 * El % se paga sobre el MONTO DECIDIDO del ticket: el grupo PRINCIPAL coloca la
 * jugada habilitada para los jugadores de todos los grupos y le paga al grupo
 * cuyo cliente compró ese porcentaje.
 *
 * La conversión formulario ⇄ columnas es PURA y vive en el núcleo
 * (`comisiones-convenio.ts`) para poder blindarla con pruebas sin navegador.
 */
import {
  CONCEPTOS_CONVENIO,
  type ProductoConvenio,
  type ValoresConvenio,
} from "@/features/grupos/lib/comisiones-convenio";

type Props = {
  valores: ValoresConvenio;
  onCambio: (clave: ProductoConvenio, valor: string) => void;
  ayuda?: string;
  /** Columnas del sub-grid en pantallas anchas. */
  columnas?: 2 | 3 | 4 | 5 | 6;
};

export function CamposComisionesConvenio({ valores, onCambio, ayuda, columnas = 4 }: Props) {
  const cols =
    columnas === 2 ? "sm:grid-cols-2" :
    columnas === 3 ? "sm:grid-cols-3" :
    columnas === 5 ? "sm:grid-cols-5" :
    columnas === 6 ? "sm:grid-cols-6" :
    "sm:grid-cols-4";
  return (
    <div className="rounded-xl border border-line bg-slate-50 p-3">
      <p className="mb-2 text-[10px] font-black uppercase tracking-wider text-slate-600">
        <span className="mr-1 text-amber-500">💰</span> Comisión por convenio (paga el grupo principal)
      </p>
      <div className={`grid grid-cols-2 ${cols} gap-2`}>
        {CONCEPTOS_CONVENIO.map((c) => (
          <label key={c.clave} className="block">
            <span className="mb-1 block truncate text-[10px] font-bold uppercase tracking-wider text-slate-600">
              {c.emoji} {c.etiqueta} %
            </span>
            <input
              type="number"
              step="0.01"
              min={0}
              inputMode="decimal"
              max={100}
              value={valores[c.clave] ?? ""}
              onChange={(e) => onCambio(c.clave, e.target.value)}
              placeholder={c.propio ? "hereda" : "2.5"}
              className="w-full rounded-lg border border-line bg-surface px-2 py-2 text-right text-xs font-bold outline-none focus:ring-1 focus:ring-primary-500"
            />
          </label>
        ))}
      </div>
      <p className="mt-2 text-[10px] leading-snug text-slate-500">
        {ayuda ??
          "El % se paga sobre el MONTO DECIDIDO. Vacío = hereda la comisión de Entre Tercios."}
      </p>
    </div>
  );
}
