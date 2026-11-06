"use client";

import React, { useState } from "react";
import type { CarreraRegistro } from "@/features/gaceta/lib/ui";
import type { DiagnosticoCarrera } from "@/features/gaceta/lib/validador";
import { generarMensajeParaAgenteIA } from "@/features/gaceta/lib/validador";
import { nombrePropioHipodromo } from "@/features/hipodromos/lib/nombre";
import type { OpcionHipodromo } from "@/features/tablas/lib/rpc";
import { copiarAlPortapapelesUniversal } from "@/shared/lib/portapapeles";
import { emitirToast } from "@/shared/lib/mensajeria";

export type ModalDiscrepanciasCarreraProps = {
  abierto: boolean;
  onCerrar: () => void;
  carrera: CarreraRegistro;
  numCarrera: string | number;
  diagnostico: DiagnosticoCarrera;
  onOrdenar: () => void;
  onAgregarCaballo: () => void;
  onReverificar?: () => void;
  reverificando?: boolean;
  hipodromos?: OpcionHipodromo[];
};

export function ModalDiscrepanciasCarrera({
  abierto,
  onCerrar,
  carrera,
  numCarrera,
  diagnostico,
  onOrdenar,
  onAgregarCaballo,
  onReverificar,
  reverificando,
  hipodromos,
}: ModalDiscrepanciasCarreraProps) {
  const [copiado, setCopiado] = useState(false);

  if (!abierto) return null;

  const hipo = String(carrera.hipodromo || "").trim().toUpperCase();
  const nombreHipo = nombrePropioHipodromo(hipo, hipodromos ?? []);
  const ejemplares = Array.isArray(carrera.ejemplares) ? carrera.ejemplares : [];
  const dist = String(carrera.distancia ?? "");
  const esCompleta = diagnostico.nivel === "completa";

  const handleCopiar = async () => {
    const texto = generarMensajeParaAgenteIA(carrera, diagnostico, carrera.fecha || "");
    const ok = await copiarAlPortapapelesUniversal(texto);
    if (ok) {
      setCopiado(true);
      emitirToast(`📋 Reporte de discrepancia copiado para la Carrera ${numCarrera}.`, "success");
      setTimeout(() => setCopiado(false), 2500);
    } else {
      emitirToast("No se pudo copiar automáticamente. Puedes seleccionar el texto manualmente.", "warning");
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/65 p-3 sm:p-4 backdrop-blur-xs animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative w-full max-w-xl max-h-[92vh] flex flex-col overflow-hidden rounded-2xl bg-white shadow-2xl border border-slate-300 animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Encabezado */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-900 px-4 py-3 text-white shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xl">🔍</span>
            <div>
              <h2 className="text-sm sm:text-base font-black tracking-tight leading-tight">
                Auditoría de Discrepancias · Carrera #{numCarrera}
              </h2>
              <p className="text-[11px] text-slate-300 leading-none mt-0.5">
                {nombreHipo || hipo || "Hipódromo"} {carrera.fecha ? `· ${carrera.fecha}` : ""}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-white/10 hover:text-white transition-colors text-base font-bold"
            aria-label="Cerrar modal"
            title="Cerrar"
          >
            ✕
          </button>
        </div>

        {/* Contenido desplazable */}
        <div className="p-4 overflow-y-auto space-y-3.5 text-xs text-slate-800">
          {/* Explicación didáctica: ¿Qué es una discrepancia? */}
          <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-3 text-blue-950">
            <h3 className="font-bold text-[11px] uppercase tracking-wide flex items-center gap-1.5 text-blue-900">
              <span>💡</span> ¿Qué es una discrepancia en carga de carreras?
            </h3>
            <p className="mt-1 text-[11px] leading-relaxed text-blue-900/90">
              Una <b>discrepancia</b> es cualquier incoherencia, error o dato faltante detectado
              automáticamente entre la gaceta extraída y las reglas de la carrera (por ejemplo: caballos sin
              nombre, números de caballo repetidos o ausentes en la secuencia, o distancia en 0 metros).
            </p>
          </div>

          {/* Estado de Integridad */}
          {esCompleta ? (
            <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3.5 text-emerald-950">
              <div className="flex items-start gap-2.5">
                <span className="text-2xl leading-none">✅</span>
                <div>
                  <h4 className="font-black text-sm text-emerald-900">
                    Carrera 100% Verificada y Completa
                  </h4>
                  <p className="mt-1 text-xs text-emerald-800 leading-relaxed">
                    Esta carrera no presenta discrepancias ni datos omitidos. Los {ejemplares.length} ejemplares
                    tienen nombres válidos, números correlativos correctos, y la carrera cuenta con hipódromo y
                    distancia ({dist || "1200"} m).
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-amber-950">
              <div className="flex items-start gap-2.5">
                <span className="text-2xl leading-none">⚠️</span>
                <div className="flex-1">
                  <h4 className="font-black text-sm text-amber-900">
                    Se detectaron {diagnostico.incidencias.length} observación(es) en esta carrera
                  </h4>
                  <p className="mt-0.5 text-[11px] text-amber-800">
                    Revisa las incidencias detalladas a continuación y corrígelas antes de enviar al ensamblaje:
                  </p>
                  <ul className="mt-2 space-y-1 pl-2">
                    {diagnostico.incidencias.map((inc, k) => (
                      <li
                        key={k}
                        className={`flex items-start gap-1.5 text-xs ${
                          inc.tipo === "error" ? "font-bold text-red-700" : "font-semibold text-amber-900"
                        }`}
                      >
                        <span className="text-sm leading-none shrink-0">
                          {inc.tipo === "error" ? "❌" : "🔸"}
                        </span>
                        <span>{inc.mensaje}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Desglose de Parámetros de la Carrera */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <h4 className="text-[11px] font-black uppercase tracking-wider text-slate-600 mb-2">
              📊 Parámetros Verificados:
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
              <div className="rounded-lg border border-slate-200 bg-white p-2">
                <span className="text-slate-400 block font-bold text-[10px] uppercase">Hipódromo</span>
                <span className="font-bold text-slate-800">
                  {hipo || "⚠️ No detectado"}
                </span>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-2">
                <span className="text-slate-400 block font-bold text-[10px] uppercase">Distancia</span>
                <span className="font-bold text-slate-800">
                  {dist ? `${dist} m` : "⚠️ 0 m"}
                </span>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-2">
                <span className="text-slate-400 block font-bold text-[10px] uppercase">Ejemplares</span>
                <span className="font-bold text-slate-800">
                  {ejemplares.length} participantes
                </span>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-2">
                <span className="text-slate-400 block font-bold text-[10px] uppercase">Números ausentes</span>
                <span className={`font-bold ${diagnostico.caballosFaltantes.length > 0 ? "text-amber-700" : "text-emerald-700"}`}>
                  {diagnostico.caballosFaltantes.length > 0
                    ? `#${diagnostico.caballosFaltantes.join(", #")}`
                    : "Ninguno (completo)"}
                </span>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-2">
                <span className="text-slate-400 block font-bold text-[10px] uppercase">Números duplicados</span>
                <span className={`font-bold ${diagnostico.numerosDuplicados.length > 0 ? "text-red-700" : "text-emerald-700"}`}>
                  {diagnostico.numerosDuplicados.length > 0
                    ? `#${[...new Set(diagnostico.numerosDuplicados)].join(", #")}`
                    : "Ninguno"}
                </span>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-2">
                <span className="text-slate-400 block font-bold text-[10px] uppercase">Sin Nombre</span>
                <span className={`font-bold ${diagnostico.caballosSinNombre.length > 0 ? "text-red-700" : "text-emerald-700"}`}>
                  {diagnostico.caballosSinNombre.length > 0
                    ? `#${diagnostico.caballosSinNombre.join(", #")}`
                    : "Todos con nombre"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Pie con Acciones de Corrección Rápida */}
        <div className="border-t border-slate-200 bg-slate-100 p-3 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                onOrdenar();
                emitirToast("🔢 Ejemplares reordenados de menor a mayor (1..N).", "info");
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-black text-slate-700 hover:bg-slate-200 transition-colors shadow-2xs"
              title="Reordena los ejemplares por número correlativo"
            >
              <span>🔢</span> Ordenar (1..N)
            </button>

            <button
              type="button"
              onClick={() => {
                onAgregarCaballo();
                emitirToast("➕ Ejemplar agregado a la carrera.", "info");
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-black text-indigo-700 hover:bg-indigo-100 transition-colors shadow-2xs"
              title="Añade un ejemplar faltante a la lista"
            >
              <span>➕</span> Agregar Caballo
            </button>

            {onReverificar && (
              <button
                type="button"
                onClick={onReverificar}
                disabled={reverificando}
                className="inline-flex items-center gap-1 rounded-lg border border-purple-200 bg-purple-50 px-2.5 py-1.5 text-xs font-black text-purple-700 hover:bg-purple-100 disabled:opacity-50 transition-colors shadow-2xs"
                title="Vuelve a analizar esta carrera con el Agente IA"
              >
                <span>🤖</span> {reverificando ? "Re-verificando…" : "Re-verificar IA"}
              </button>
            )}

            <button
              type="button"
              onClick={() => void handleCopiar()}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-black text-slate-700 hover:bg-slate-200 transition-colors shadow-2xs"
              title="Copia el informe de discrepancias para WhatsApp o soporte"
            >
              <span>{copiado ? "✓" : "📋"}</span> {copiado ? "¡Copiado!" : "Copiar Reporte"}
            </button>
          </div>

          <button
            type="button"
            onClick={onCerrar}
            className="rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            Entendido / Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

export default ModalDiscrepanciasCarrera;
