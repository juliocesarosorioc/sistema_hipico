"use client";

import React, { useState } from "react";
import type { EjemplarAnalisisV4 } from "@/features/inteligencia/lib/analista-venezuela-v4";
import type { TraqueoDetalladoExtraido } from "@/features/inteligencia/lib/extractor-traqueos-venezuela";
import { COLORES_GUALDRAPA } from "@/features/inteligencia/lib/analista-venezuela-v4";
import { CamisaJockeySvg } from "@/features/inteligencia/components/CamisaJockeySvg";

interface Props {
  ejemplar: EjemplarAnalisisV4;
  distanciaCarrera: number;
  traqueosHistoricos?: TraqueoDetalladoExtraido[];
  onCerrar?: () => void;
}

export function FichaExpedienteEjemplar({
  ejemplar,
  distanciaCarrera,
  traqueosHistoricos = [],
  onCerrar,
}: Props) {
  const [tab, setTab] = useState<"general" | "pp" | "traqueos" | "retrospecto">("general");
  const colorCloth = COLORES_GUALDRAPA[ejemplar.numero] || COLORES_GUALDRAPA[1];

  // Zona de aparato
  const zonaAparato =
    ejemplar.puestoPista <= 4 ? "Interior (PP 1-4)" : ejemplar.puestoPista <= 9 ? "Medio (PP 5-9)" : "Exterior (PP 10-14)";

  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl overflow-hidden max-w-3xl w-full">
      {/* Cabecera del Expediente */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-950 p-4">
        <div className="flex items-center gap-3">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-xl font-mono text-xl font-black shadow-md border"
            style={{
              backgroundColor: colorCloth.bg,
              color: colorCloth.text,
              borderColor: colorCloth.border,
            }}
          >
            #{ejemplar.numero}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-black text-white">{ejemplar.nombre}</h2>
              <span className="rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 text-xs font-black">
                🚪 PP {ejemplar.puestoPista}
              </span>
              <span className="rounded bg-slate-800 px-2 py-0.5 text-xs font-mono font-bold text-slate-300">
                {ejemplar.estilo}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {ejemplar.stud ? `Stud ${ejemplar.stud} · ` : ""}
              Jinete {ejemplar.jinete} ({ejemplar.kilos} kg) · Ent. {ejemplar.entrenador}
            </p>
          </div>
        </div>

        {onCerrar && (
          <button
            onClick={onCerrar}
            className="rounded-lg bg-slate-800 p-2 text-slate-400 hover:text-white hover:bg-slate-700"
          >
            ✕
          </button>
        )}
      </div>

      {/* Selector de pestañas */}
      <div className="flex border-b border-slate-800 bg-slate-950/60 px-4 pt-2 gap-2 text-xs font-bold">
        <button
          onClick={() => setTab("general")}
          className={`pb-2 px-3 border-b-2 transition-all ${
            tab === "general" ? "border-amber-400 text-amber-300" : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          📋 Expediente General
        </button>
        <button
          onClick={() => setTab("pp")}
          className={`pb-2 px-3 border-b-2 transition-all ${
            tab === "pp" ? "border-amber-400 text-amber-300" : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          🚪 Puesto de Partida (PP)
        </button>
        <button
          onClick={() => setTab("traqueos")}
          className={`pb-2 px-3 border-b-2 transition-all flex items-center gap-1.5 ${
            tab === "traqueos" ? "border-amber-400 text-amber-300" : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <span>⏱️ Traqueos y Tomatiempos</span>
          <span className="rounded-full bg-amber-500/20 text-amber-300 px-1.5 py-0.2 text-[10px]">
            {traqueosHistoricos.length || (ejemplar.ultimoTraqueo ? 1 : 0)}
          </span>
        </button>
      </div>

      {/* Contenido según pestaña */}
      <div className="p-4 space-y-4">
        {tab === "general" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 space-y-2">
              <h4 className="text-xs font-black uppercase text-amber-400">Datos Físicos y Registro</h4>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-slate-400 block text-[10px]">Peso Óptimo Ganador:</span>
                  <span className="font-bold text-white">{ejemplar.pesoOptimoKg} kg</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">Peso Hoy en Balanza:</span>
                  <span className="font-bold text-amber-300">{ejemplar.pesoHoyKg ? `${ejemplar.pesoHoyKg} kg` : "Pendiente"}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">Implementos:</span>
                  <span className="font-bold text-white">{ejemplar.implementos || "Sin implementar"}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">Días sin Correr:</span>
                  <span className="font-bold text-white">{ejemplar.diasSinCorrer} días</span>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 space-y-2">
              <h4 className="text-xs font-black uppercase text-amber-400">Divisa Oficial del Stud</h4>
              <div className="flex items-center gap-3">
                <CamisaJockeySvg
                  divisaTexto={ejemplar.divisaTexto}
                  numero={ejemplar.numero}
                  size={48}
                />
                <p className="text-xs text-slate-300 italic">{ejemplar.divisaTexto || "Divisa estándar del Stud"}</p>
              </div>
            </div>
          </div>
        )}

        {tab === "pp" && (
          <div className="space-y-3">
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-black uppercase text-amber-300">
                    Puesto de Partida Actual: Gualdrapa #{ejemplar.numero} · Puerta {ejemplar.puestoPista}
                  </h4>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Ubicación en el partidor: <b className="text-white">{zonaAparato}</b> para tiro de {distanciaCarrera}m.
                  </p>
                </div>
                <span className="text-2xl">🚪</span>
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 space-y-2">
              <h5 className="text-xs font-bold text-slate-300">Análisis Biomecánico del Aparato:</h5>
              <ul className="text-xs text-slate-400 space-y-1 list-disc list-inside">
                {distanciaCarrera >= 1600 && ejemplar.puestoPista <= 4 && (
                  <li className="text-emerald-400 font-bold">
                    Favorecido por riel interno en tiro de codos: ahorra terreno al encarar el primer giro.
                  </li>
                )}
                {distanciaCarrera <= 1200 && ejemplar.puestoPista >= 6 && (
                  <li className="text-emerald-400 font-bold">
                    Puesto externo limpio: evita tráfico en la arrancada rápida de los primeros 400m.
                  </li>
                )}
                {ejemplar.puestoPistaAnterior && (
                  <li>
                    Carrera anterior: partió por el <b>PP {ejemplar.puestoPistaAnterior}</b>
                    {ejemplar.tropiezosAnteriores?.length ? ` (Tropiezos: ${ejemplar.tropiezosAnteriores.join(", ")})` : ""}.
                  </li>
                )}
              </ul>
            </div>
          </div>
        )}

        {tab === "traqueos" && (
          <div className="space-y-3">
            {ejemplar.ultimoTraqueo && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-black uppercase text-emerald-400 tracking-wider">
                      Último Briseo / Ejercicio Oficial INH
                    </span>
                    <h4 className="text-sm font-black text-white">
                      {ejemplar.ultimoTraqueo.distancia}m en {ejemplar.ultimoTraqueo.tiempo}
                      {ejemplar.ultimoTraqueo.remate ? ` (${ejemplar.ultimoTraqueo.remate})` : ""}
                    </h4>
                    <p className="text-xs text-slate-300 mt-0.5 italic">
                      «{ejemplar.ultimoTraqueo.observacion || "Cómodo en silla"}»
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="rounded-lg bg-emerald-500 text-slate-950 font-black px-2 py-1 text-xs">
                      {ejemplar.ultimoTraqueo.calificacion}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {traqueosHistoricos.length > 0 ? (
              <div className="space-y-2">
                <h5 className="text-xs font-bold text-slate-300">Historial de Trabajos en La Rinconada:</h5>
                {traqueosHistoricos.map((tr, i) => (
                  <div key={i} className="rounded-lg border border-slate-800 bg-slate-950/60 p-2 text-xs flex justify-between items-center">
                    <div>
                      <span className="font-mono font-bold text-amber-300">{tr.distanciaMetros}m en {tr.tiempoTexto}</span>
                      {tr.remateTexto && <span className="text-slate-400 ml-1">({tr.remateTexto})</span>}
                      {tr.segundaVuelta && <span className="ml-1.5 text-[10px] text-sky-400 font-bold">(2V)</span>}
                      <p className="text-[11px] text-slate-400 mt-0.5">{tr.comentario}</p>
                    </div>
                    <div className="text-right">
                      <span className="font-mono font-bold text-emerald-400">{tr.indiceCalidadWorkout}/10</span>
                      <span className="block text-[10px] text-slate-500">{tr.calificacion}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              !ejemplar.ultimoTraqueo && (
                <p className="text-xs text-slate-500 py-4 text-center">
                  Sin ejercicios cronometrados registrados en el expediente para esta jornada.
                </p>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}
export default FichaExpedienteEjemplar;
