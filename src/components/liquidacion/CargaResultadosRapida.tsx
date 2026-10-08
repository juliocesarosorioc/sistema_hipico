"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { EjemplarTabla } from "@/lib/tablas/tipos";
import { guardarPizarraCentral } from "@/lib/liquidacion/pizarraCentral";
import { CargaResultadosModal, type PizarraResultados } from "./CargaResultadosModal";

const toast = (msg: string, tipo: "success" | "warning" | "error" | "info" = "info") =>
  window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));

export type OpcionCarreraPizarra = {
  carrera: number | string;
  caballos?: EjemplarTabla[] | null;
};

type Props = {
  /** Etiqueta que queda como `cargado_por` en resultados_carreras. */
  cargadoPor: string;
  fecha?: string;
  /** Si viene, la pizarra abre directo sin pedir datos (hipódromo conocido). */
  hipodromo?: string;
  /** Si viene (junto a `hipodromo`), la pizarra abre directo. */
  carrera?: number | string;
  /** Carreras disponibles para elegir la N° desde un listado (opcional). */
  carreras?: OpcionCarreraPizarra[];
  etiqueta?: string;
  /** Se llama después de guardar el resultado central, con la pizarra cargada. */
  onGuardado?: (r: PizarraResultados) => void | Promise<void>;
};

/**
 * Botón "🏁 Carga de Resultados" para cualquier módulo. Abre la MISMA pizarra
 * compacta de posiciones + Dead Heat (`CargaResultadosModal`) que usan Gestión
 * de Jugadas, Tablas Fijas y Taquilla, y centraliza el resultado en
 * `resultados_carreras` (`guardarPizarraCentral`) para que todos los módulos
 * apliquen la misma verdad.
 *
 * Si se le pasa `hipodromo` + `carrera`, el clic abre la pizarra directo; si
 * no, primero pide Hipódromo y N° de Carrera (con listado opcional de carreras).
 */
export function CargaResultadosRapida({
  cargadoPor,
  fecha,
  hipodromo,
  carrera,
  carreras,
  etiqueta = "🏁 Carga de Resultados",
  onGuardado,
}: Props) {
  const [pregunta, setPregunta] = useState(false);
  const [h, setH] = useState(String(hipodromo ?? ""));
  const [c, setC] = useState(String(carrera ?? ""));
  const [abierta, setAbierta] = useState(false);

  const caballos = useMemo(() => {
    if (!carreras?.length) return null;
    const op = carreras.find((o) => String(o.carrera) === c.trim());
    return op?.caballos ?? null;
  }, [carreras, c]);

  const abrir = () => {
    // Las props pueden cambiar entre renders (ej. el remate seleccionado): se
    // sincronizan con el estado local antes de decidir el camino.
    setH(String(hipodromo ?? h));
    setC(carrera !== undefined ? String(carrera) : c);
    if (hipodromo && carrera !== undefined) {
      setAbierta(true);
      return;
    }
    setPregunta(true);
  };

  const abrirConDatos = () => {
    if (!h.trim()) return toast("Indica el Hipódromo.", "warning");
    if (!c.trim()) return toast("Indica el N° de Carrera.", "warning");
    setPregunta(false);
    setAbierta(true);
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={abrir}>
        {etiqueta}
      </Button>

      {pregunta && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-line bg-white p-4 shadow-2xl">
            <h3 className="text-xs font-black uppercase tracking-wide text-slate-800">🏁 Carga de Resultados</h3>
            <p className="mt-1 text-xs text-slate-500">
              La pizarra es la misma de Gestión de Jugadas / Tablas Fijas y el resultado queda centralizado
              en Carreras del Día.
            </p>
            <div className="mt-3 space-y-3">
              <div>
                <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-600">
                  Hipódromo
                </label>
                <input
                  value={h}
                  onChange={(e) => setH(e.target.value)}
                  placeholder="LA RINCONADA"
                  autoFocus
                  className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-primary-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-600">
                  N° de Carrera
                </label>
                {carreras?.length ? (
                  <select
                    value={c}
                    onChange={(e) => setC(e.target.value)}
                    className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-primary-500"
                  >
                    <option value="">Carrera…</option>
                    {carreras.map((o) => (
                      <option key={String(o.carrera)} value={String(o.carrera)}>
                        C{o.carrera}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="number"
                    min={1}
                    value={c}
                    onChange={(e) => setC(e.target.value)}
                    placeholder="3"
                    className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-primary-500"
                  />
                )}
              </div>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setPregunta(false)}>
                  Cancelar
                </Button>
                <Button size="sm" onClick={abrirConDatos}>
                  Abrir pizarra
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <CargaResultadosModal
        abierto={abierta}
        onCerrar={() => {
          setAbierta(false);
          setPregunta(false);
        }}
        hipodromo={h}
        carrera={c}
        caballos={caballos}
        onConfirmar={async (r) => {
          const res = await guardarPizarraCentral({
            hipodromo: h,
            carrera: c,
            fecha,
            cargado_por: cargadoPor,
            r,
          });
          if (!res.ok) {
            toast(res.error ?? "No se pudo guardar el resultado.", "error");
            return;
          }
          toast(
            `🏁 Resultado ${h.trim().toUpperCase()} C${c} cargado (${cargadoPor}). Centralizado para todos los módulos.`,
            "success"
          );
          setAbierta(false);
          setPregunta(false);
          await onGuardado?.(r);
        }}
      />
    </>
  );
}