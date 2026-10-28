"use client";

import { useState, useMemo, useEffect } from "react";
import { Button } from "@/shared/components/ui/Button";
import { Card } from "@/shared/components/ui/Card";
import { DivisaStudSvg } from "@/features/inteligencia/components/DivisaStudSvg";
import {
  generarCuadroMaestro5y6,
  ESTRATEGIAS_META,
  type Estrategia5y6,
  type CuadroMaestro5y6Resultado,
} from "@/features/inteligencia/lib/optimizador-5y6";
import { ResultadoCarreraV4 } from "@/features/inteligencia/lib/analista-venezuela-v4";
import { generarInformeCuadro5y6IA, type InformeCuadro5y6IA } from "@/features/inteligencia/lib/ia-analista-experto";
import { useInteligenciaHipicaStore } from "@/features/inteligencia/store/useInteligenciaHipicaStore";

type Props = {
  abierto: boolean;
  onCerrar: () => void;
  fecha: string;
  hipodromo: string;
  carrerasValidas: ResultadoCarreraV4[];
};

export function ModalCuadroMaestro5y6({
  abierto,
  onCerrar,
  fecha,
  hipodromo,
  carrerasValidas,
}: Props) {
  const factorStore = useInteligenciaHipicaStore((s) => s.factorMultiplicador5y6);
  const setFactorStore = useInteligenciaHipicaStore((s) => s.setFactorMultiplicador5y6);
  const estrategiaStore = useInteligenciaHipicaStore((s) => s.estrategia5y6);
  const setEstrategiaStore = useInteligenciaHipicaStore((s) => s.setEstrategia5y6);
  const presupuestoStore = useInteligenciaHipicaStore((s) => s.presupuestoMaximo5y6);
  const setPresupuestoStore = useInteligenciaHipicaStore((s) => s.setPresupuestoMaximo5y6);
  const seleccionStore = useInteligenciaHipicaStore((s) => s.seleccionValidas5y6);
  const alternarStore = useInteligenciaHipicaStore((s) => s.alternarEjemplarEnValida5y6);
  const reiniciarStore = useInteligenciaHipicaStore((s) => s.reiniciarCuadro5y6);

  const [copiado, setCopiado] = useState(false);
  const [informeIA, setInformeIA] = useState<InformeCuadro5y6IA | null>(null);
  const [generandoIA, setGenerandoIA] = useState(false);

  // Generar el resultado del cuadro optimizado
  const cuadro = useMemo<CuadroMaestro5y6Resultado>(() => {
    return generarCuadroMaestro5y6({
      fecha,
      hipodromo,
      carrerasValidas,
      factorMultiplicador: factorStore,
      estrategia: estrategiaStore,
      presupuestoMaximo: presupuestoStore,
      seleccionManual: Object.keys(seleccionStore).length > 0 ? seleccionStore : undefined,
    });
  }, [fecha, hipodromo, carrerasValidas, factorStore, estrategiaStore, presupuestoStore, seleccionStore]);

  // Generar informe de IA cuando cambia el cuadro
  useEffect(() => {
    if (!abierto) return;
    let cancel = false;
    setGenerandoIA(true);
    generarInformeCuadro5y6IA(cuadro)
      .then((inf) => {
        if (!cancel) setInformeIA(inf);
      })
      .finally(() => {
        if (!cancel) setGenerandoIA(false);
      });
    return () => {
      cancel = true;
    };
  }, [cuadro, abierto]);

  if (!abierto) return null;

  const copiarWhatsApp = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(cuadro.resumenTextoWhatsApp).then(() => {
        setCopiado(true);
        setTimeout(() => setCopiado(false), 3000);
      });
    } else {
      prompt("Copia el texto del Cuadro 5y6:", cuadro.resumenTextoWhatsApp);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-2 sm:p-4 backdrop-blur-xs overflow-y-auto"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex w-full max-w-6xl max-h-[92vh] flex-col overflow-hidden rounded-2xl bg-slate-900 border border-amber-500/40 text-slate-100 shadow-2xl">
        {/* CABECERA */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-800 bg-slate-950 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-amber-500 text-lg text-slate-950 font-black shadow-sm">
              🎟️
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-black uppercase tracking-wider text-amber-400">
                  Cuadro Maestro 5y6 Nacional (Válidas 1ª a 6ª)
                </h2>
                <span className="rounded-full bg-amber-400/20 border border-amber-400/40 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                  {hipodromo.toUpperCase()} · {fecha}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Optimización actuarial multivariante con exclusión automática de retirados y maximización de probabilidad conjunta.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        {/* BARRA DE PARÁMETROS Y RESUMEN FINANCIERO */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5 border-b border-slate-800 bg-slate-900/90 p-4 text-xs">
          {/* Estrategia */}
          <div className="col-span-2">
            <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">
              Estrategia del Cuadro
            </label>
            <select
              value={estrategiaStore}
              onChange={(e) => setEstrategiaStore(e.target.value as Estrategia5y6)}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 font-bold text-white focus:border-amber-400 focus:outline-none"
            >
              {Object.entries(ESTRATEGIAS_META).map(([clave, meta]) => (
                <option key={clave} value={clave}>
                  {meta.titulo}
                </option>
              ))}
            </select>
          </div>

          {/* Factor Multiplicador */}
          <div>
            <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">
              Factor 5y6 (Bs.)
            </label>
            <input
              type="number"
              step="1"
              min="1"
              value={factorStore}
              onChange={(e) => setFactorStore(parseFloat(e.target.value) || 35.0)}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 font-mono font-bold text-amber-400 focus:border-amber-400 focus:outline-none"
            />
          </div>

          {/* Combinaciones */}
          <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-2 text-center flex flex-col justify-center">
            <span className="text-[9.5px] font-black uppercase tracking-wider text-slate-400">
              Combinaciones
            </span>
            <span className="font-mono text-base font-black text-amber-400">
              {cuadro.combinacionesTotales.toLocaleString("es-VE")}
            </span>
          </div>

          {/* Costo Total */}
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-2 text-center flex flex-col justify-center">
            <span className="text-[9.5px] font-black uppercase tracking-wider text-amber-300">
              Costo Total Cuadro
            </span>
            <span className="font-mono text-base font-black text-white">
              Bs. {cuadro.costoTotalBs.toLocaleString("es-VE", { minimumFractionDigits: 2 })}
            </span>
          </div>

          {/* Cobertura Estimada */}
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2 text-center flex flex-col justify-center">
            <span className="text-[9.5px] font-black uppercase tracking-wider text-emerald-300">
              Probabilidad (6 de 6)
            </span>
            <span className="font-mono text-base font-black text-emerald-400">
              {cuadro.probabilidadCoberturaPct}%
            </span>
          </div>
        </div>

        {/* CONTENIDO SCROLLEABLE: 6 COLUMNAS DE VÁLIDAS */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            {cuadro.validas.map((valida) => {
              const cantSeleccionados = valida.seleccionados.length;
              const badgeTipo =
                cantSeleccionados === 1
                  ? "bg-amber-500 text-slate-950 font-black border-amber-400"
                  : cantSeleccionados === 2
                  ? "bg-indigo-600 text-white font-bold border-indigo-500"
                  : "bg-slate-700 text-slate-200 border-slate-600";

              return (
                <div
                  key={valida.numeroValida}
                  className="flex flex-col rounded-xl border border-slate-800 bg-slate-950/80 overflow-hidden shadow-sm"
                >
                  {/* CABECERA DE LA VÁLIDA */}
                  <div className="border-b border-slate-800 bg-slate-900 px-3 py-2 text-center">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black uppercase tracking-wider text-amber-400">
                        {valida.numeroValida}ª Válida
                      </span>
                      <span className="text-[10px] font-bold text-slate-400">
                        C{valida.carreraNumero} · {valida.distancia}m
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[10px]">
                      <span className={`rounded px-1.5 py-0.2 text-[9.5px] uppercase border ${badgeTipo}`}>
                        {cantSeleccionados === 1 ? "🔒 LÍNEA" : cantSeleccionados === 2 ? "⚔️ MOROCHA" : `🛡️ ${cantSeleccionados} EJS`}
                      </span>
                      <span className="text-slate-400 font-mono">
                        {cantSeleccionados} elegido{cantSeleccionados === 1 ? "" : "s"}
                      </span>
                    </div>
                  </div>

                  {/* LISTA DE EJEMPLARES DE ESTA VÁLIDA */}
                  <div className="flex-1 p-2 space-y-1.5 max-h-[380px] overflow-y-auto">
                    {valida.carrera.ranking.map((item) => {
                      const num = item.ejemplar.numero;
                      const seleccionado = valida.seleccionados.includes(num);
                      const retirado = Boolean(item.ejemplar.retirado);

                      return (
                        <div
                          key={num}
                          onClick={() => !retirado && alternarStore(valida.numeroValida, num)}
                          className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all border text-xs ${
                            retirado
                              ? "opacity-40 bg-slate-900 border-slate-800 cursor-not-allowed line-through"
                              : seleccionado
                              ? "bg-amber-500/15 border-amber-400/80 shadow-xs"
                              : "bg-slate-900/60 border-slate-800/80 hover:bg-slate-800 hover:border-slate-700"
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <input
                              type="checkbox"
                              disabled={retirado}
                              checked={seleccionado}
                              onChange={() => !retirado && alternarStore(valida.numeroValida, num)}
                              className="rounded accent-amber-500"
                            />
                            <DivisaStudSvg
                              numero={num}
                              divisaTexto={item.ejemplar.divisaTexto}
                              studNombre={item.ejemplar.stud}
                              className="h-6 w-6"
                              mostrarGualdrapa={false}
                            />
                            <div className="truncate">
                              <div className="flex items-center gap-1 font-bold text-white truncate text-[11px]">
                                <span>#{num}</span>
                                <span className="truncate">{item.ejemplar.nombre}</span>
                              </div>
                              <div className="text-[9.5px] text-slate-400 truncate">
                                {item.ejemplar.jinete} · {item.ejemplar.kilos}k
                              </div>
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <div className="font-mono text-[11px] font-black text-amber-400">
                              {item.probabilidadSMIC}%
                            </div>
                            {item.esLinea5y6 && (
                              <span className="text-[8.5px] font-black uppercase text-amber-300">
                                Línea
                              </span>
                            )}
                            {item.esSorpresaOverlay && (
                              <span className="text-[8.5px] font-black uppercase text-emerald-400">
                                Lance
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* INFORME ANALÍTICO DE INTELIGENCIA HÍPICA */}
          {informeIA && (
            <Card className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-3">
              <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
                <span className="text-base">🤖</span>
                <h4 className="text-xs font-black uppercase tracking-wider text-amber-400">
                  Justificación Analítica del Cuadro Maestro (Motor Actuarial)
                </h4>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-slate-300">
                <div>
                  <b className="text-white block mb-0.5">Estrategia de Inversión:</b>
                  <p className="text-[11px] leading-relaxed text-slate-400">
                    {informeIA.resumenEstrategico}
                  </p>
                </div>
                <div>
                  <b className="text-amber-400 block mb-0.5">Fundamentación de Líneas Fijas:</b>
                  <p className="text-[11px] leading-relaxed text-slate-400">
                    {informeIA.justificacionLineas}
                  </p>
                </div>
              </div>
            </Card>
          )}
        </div>

        {/* PIE CON ACCIONES */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 bg-slate-950 p-4">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={reiniciarStore}
              className="text-slate-400 border-slate-700 hover:text-white"
            >
              🔄 Restablecer Cuadro
            </Button>
            <span className="text-xs text-slate-400 hidden sm:inline">
              Haz clic en cualquier ejemplar para sumarlo o quitarlo del cuadro.
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={copiarWhatsApp}
              className="bg-emerald-600 hover:bg-emerald-500 font-black text-white text-xs flex items-center gap-1.5 shadow-sm"
            >
              <span>{copiado ? "✅" : "📋"}</span>
              <span>{copiado ? "¡Copiado al Portapapeles!" : "Copiar Cuadro para WhatsApp / Impresión"}</span>
            </Button>
            <Button
              size="sm"
              onClick={onCerrar}
              className="bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs"
            >
              Cerrar
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
