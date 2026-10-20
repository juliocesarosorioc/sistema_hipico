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
 *
 * LAYOUT (BLOQUE 6): el bloque es AUTOCONTENIDO para que nunca se salga de la
 * pantalla. El contenedor fija un techo (`max-h-[85vh]`) y reparte en tres
 * bandas: cabecera fija, cuerpo con scroll propio (`overflow-y-auto p-5`) y el
 * pie del modal que lo contiene (el botón "Guardar"), que queda siempre visible
 * porque el desbordamiento lo absorbe el cuerpo, no la página.
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
};

export function CamposComisionesConvenio({ valores, onCambio, ayuda }: Props) {
  return (
    <section className="w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden rounded-2xl border border-line bg-slate-50">
      <header className="shrink-0 border-b border-line bg-white px-5 py-3 text-[10px] font-black uppercase tracking-wider text-slate-600">
        <span className="mr-1 text-amber-500">💰</span> Comisión por convenio (paga el grupo principal)
      </header>

      {/* Cuerpo con scroll propio: el bloque crece hasta 85vh y de ahí en
          adelante rueda hacia adentro en vez de desbordar el modal/pantalla. */}
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

        <p className="mt-3 text-[10px] leading-snug text-slate-500">
          {ayuda ??
            "El % se paga sobre el MONTO DECIDIDO. Vacío = hereda la comisión de Entre Tercios."}
        </p>
      </div>
    </section>
  );
}
