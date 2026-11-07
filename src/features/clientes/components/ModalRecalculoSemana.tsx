"use client";

import { useState } from "react";
import {
  recalcularDevolucionesEIncentivosSemana,
  obtenerRangoSemanaFiscalActual,
  type ResultadoRecalculoSemana,
} from "../lib/recalculo-semanal";
import { emitirToast } from "@/shared/lib/mensajeria";
import { Button } from "@/shared/components/ui/Button";

interface Props {
  abierto: boolean;
  onCerrar: () => void;
  onRecalculoCompletado?: () => void;
  grupoId?: string | null;
}

export function ModalRecalculoSemana({
  abierto,
  onCerrar,
  onRecalculoCompletado,
  grupoId,
}: Props) {
  const rangoInicial = obtenerRangoSemanaFiscalActual();
  const [fechaDesde, setFechaDesde] = useState(rangoInicial.desde);
  const [fechaHasta, setFechaHasta] = useState(rangoInicial.hasta);
  const [procesando, setProcesando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoRecalculoSemana | null>(null);

  if (!abierto) return null;

  const handleEjecutar = async (dryRun: boolean) => {
    setProcesando(true);
    try {
      const res = await recalcularDevolucionesEIncentivosSemana({
        fechaDesde,
        fechaHasta,
        grupoId,
        dryRun,
        usuario: "OPERADOR_CLIENTES",
      });
      setResultado(res);

      if (res.ok) {
        if (!dryRun) {
          emitirToast(
            `✅ Recálculo completado: ${res.totalClientesAjustados} cliente(s) ajustados (+$${res.granTotalDelta.toFixed(2)} acreditados).`,
            "success"
          );
          onRecalculoCompletado?.();
        } else {
          emitirToast("🔍 Simulación calculada. Revise los importes antes de aplicar.", "info");
        }
      } else {
        emitirToast(`⚠️ Error en recálculo: ${res.error}`, "error");
      }
    } catch (e: any) {
      emitirToast(`Error: ${e?.message || "Fallo inesperado"}`, "error");
    } finally {
      setProcesando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl border border-indigo-200 bg-white shadow-2xl overflow-hidden">
        {/* Cabecera */}
        <div className="flex items-center justify-between border-b border-indigo-100 bg-gradient-to-r from-indigo-900 via-slate-900 to-purple-900 px-6 py-4 text-white">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🔄</span>
            <div>
              <h3 className="text-base font-black uppercase tracking-wider text-white">
                Recálculo Semanal de Devoluciones e Incentivos
              </h3>
              <p className="text-xs font-semibold text-indigo-200">
                Ajusta retroactivamente las devoluciones y comisiones según los nuevos porcentajes cargados
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Contenido */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Parámetros de Fechas */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-700 mb-2">
              📅 Ciclo Semanal a Evaluar
            </h4>
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <div className="flex items-center gap-2">
                <label className="font-bold text-slate-600">Desde (Apertura):</label>
                <input
                  type="date"
                  value={fechaDesde}
                  onChange={(e) => setFechaDesde(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-bold text-slate-800 shadow-sm outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="font-bold text-slate-600">Hasta (Cierre):</label>
                <input
                  type="date"
                  value={fechaHasta}
                  onChange={(e) => setFechaHasta(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-bold text-slate-800 shadow-sm outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  const r = obtenerRangoSemanaFiscalActual();
                  setFechaDesde(r.desde);
                  setFechaHasta(r.hasta);
                }}
                className="text-xs font-bold text-indigo-700 hover:underline"
              >
                (Restablecer a semana en curso)
              </button>
            </div>
          </div>

          {/* Información Explicativa */}
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/70 p-3.5 text-xs text-indigo-900 space-y-1">
            <p className="font-bold">💡 ¿Cómo opera el recálculo retroactivo?</p>
            <p className="text-[11px] text-indigo-800">
              Evalúa todas las jugadas decididas de puestos en el período para cada cliente con devolución o comisiones de socio. 
              Determina el <span className="font-bold">Total Debido</span> y le descuenta lo <span className="font-bold">Ya Acreditado</span> previamente en la semana, 
              imputando únicamente el <span className="font-bold">Delta</span> exacto en <code className="bg-white/80 px-1 py-0.5 rounded font-mono">clientes.saldo_actual</code> y 
              registrando el asiento NIIF oficial. Es 100% idempotente (no duplica saldos).
            </p>
          </div>

          {/* Resultados de la Ejecución */}
          {resultado && (
            <div className="space-y-4">
              {/* Tarjetas métricas */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">Evaluados</span>
                  <span className="text-lg font-black text-slate-800">{resultado.totalClientesEvaluados}</span>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">Ajustados</span>
                  <span className="text-lg font-black text-indigo-700">{resultado.totalClientesAjustados}</span>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">Total Debido</span>
                  <span className="text-lg font-mono font-black text-slate-800">
                    ${resultado.granTotalDebido.toFixed(2)}
                  </span>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 shadow-sm">
                  <span className="text-[10px] font-bold uppercase text-emerald-600 block">Delta Acreditado</span>
                  <span className="text-lg font-mono font-black text-emerald-700">
                    +${resultado.granTotalDelta.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Detalle por Cliente */}
              <div className="rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                <div className="bg-slate-100 px-3 py-2 border-b border-slate-200 text-xs font-black uppercase text-slate-700">
                  📋 Desglose de Recálculo por Jugador / Socio
                </div>
                <div className="max-h-60 overflow-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-[10px] uppercase font-bold text-slate-500 border-b border-slate-200 sticky top-0">
                      <tr>
                        <th className="px-3 py-2">Cliente / Socio</th>
                        <th className="px-3 py-2 text-right">% Propio</th>
                        <th className="px-3 py-2 text-right">Debido</th>
                        <th className="px-3 py-2 text-right">Acreditado Previo</th>
                        <th className="px-3 py-2 text-right">Delta</th>
                        <th className="px-3 py-2 text-right">Saldo Final</th>
                        <th className="px-3 py-2 text-center">Estado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {resultado.detalles.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                            No se encontraron jugadas o clientes con devolución para el rango seleccionado.
                          </td>
                        </tr>
                      ) : (
                        resultado.detalles.map((d) => (
                          <tr key={String(d.clienteId)} className="hover:bg-slate-50">
                            <td className="px-3 py-2 font-bold text-slate-800">{d.nombre}</td>
                            <td className="px-3 py-2 text-right font-mono">{d.devolucionPropiaPct.toFixed(2)}%</td>
                            <td className="px-3 py-2 text-right font-mono font-bold text-slate-700">
                              ${d.totalDebido.toFixed(2)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-slate-500">
                              ${d.totalYaAcreditado.toFixed(2)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono font-black text-emerald-600">
                              {d.delta > 0 ? `+$${d.delta.toFixed(2)}` : `$${d.delta.toFixed(2)}`}
                            </td>
                            <td className="px-3 py-2 text-right font-mono font-bold text-indigo-700">
                              ${d.saldoNuevo.toFixed(2)}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <span
                                className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-black ${
                                  d.delta > 0
                                    ? "bg-emerald-100 text-emerald-800"
                                    : "bg-slate-100 text-slate-600"
                                }`}
                              >
                                {d.motivo}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Barra de Acciones */}
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-3.5">
          <Button variant="outline" size="sm" onClick={onCerrar} disabled={procesando}>
            Cerrar
          </Button>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={procesando}
              onClick={() => void handleEjecutar(true)}
              className="border-indigo-300 text-indigo-700 hover:bg-indigo-50 font-bold"
            >
              <span>🔍</span> Simular Recálculo
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={procesando}
              onClick={() => void handleEjecutar(false)}
              className="bg-purple-700 hover:bg-purple-800 text-white font-black shadow-md"
            >
              <span>{procesando ? "⏳ Procesando…" : "⚡ Aplicar a Saldos"}</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
