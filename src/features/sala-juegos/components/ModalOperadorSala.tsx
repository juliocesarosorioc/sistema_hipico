"use client";

import React, { useState, useEffect, useMemo } from "react";
import { salaApi } from "../lib/sala-api";
import { colorDeNumero, textoDeNumero } from "@/features/tablas/lib/tipos";
import { supabase } from "@/core/supabase";

interface PropsModalOperador {
  sala: any;
  grupoId: string;
  grupoNombre: string;
  onCerrar: () => void;
  onActualizado: () => void;
  onAbrirPrejugadas: () => void;
}

const HIPODROMOS_AMERICANOS_COMUNES = [
  "GULFSTREAM PARK",
  "TAMPA BAY DOWNS",
  "AQUEDUCT",
  "BELMONT PARK",
  "SARATOGA",
  "CHURCHILL DOWNS",
  "KEENELAND",
  "DEL MAR",
  "SANTA ANITA",
  "CHARLES TOWN",
  "MOUNTAINEER",
  "PARX RACING",
  "MAHONING VALLEY",
  "TURFWAY PARK",
  "PENN NATIONAL",
  "DELTA DOWNS",
  "REMINGTON PARK",
  "OAKLAWN PARK",
  "HAWTHORNE",
  "FAIR GROUNDS",
  "GOLDEN GATE FIELDS",
];

type FilaLlegada = { numero: string; empate: boolean };

export function ModalOperadorSala({
  sala,
  grupoId,
  grupoNombre,
  onCerrar,
  onActualizado,
  onAbrirPrejugadas,
}: PropsModalOperador) {
  const [tab, setTab] = useState<"carrera" | "retirados" | "liquidacion" | "publicidad">("carrera");
  const [cargando, setCargando] = useState(false);
  const [msgFeedback, setMsgFeedback] = useState<string | null>(null);

  // Detección de sala: VENEZUELA vs AMERICANAS
  const nombreSalaUpper = String(sala.nombre_sala || "").toUpperCase();
  const esVenezuela =
    nombreSalaUpper.includes("VENEZUELA") ||
    nombreSalaUpper.includes("RINCONADA") ||
    sala.orden_sala === 1;
  const esAmericanas =
    nombreSalaUpper.includes("AMERICANA") ||
    nombreSalaUpper.includes("USA") ||
    sala.orden_sala === 2;

  // Apertura
  const [hipodromo, setHipodromo] = useState<string>(() => {
    if (esVenezuela) {
      return sala.hipodromo_activo === "VALENCIA" ? "VALENCIA" : "LA RINCONADA";
    }
    if (esAmericanas) {
      const act = sala.hipodromo_activo;
      if (act && act !== "LA RINCONADA" && act !== "VALENCIA") return act;
      return "GULFSTREAM PARK";
    }
    return sala.hipodromo_activo || "LA RINCONADA";
  });
  const [numeroCarrera, setNumeroCarrera] = useState(sala.numero_carrera_activa || 1);
  const [distancia, setDistancia] = useState(sala.distancia_activa || 1200);

  // Retirados
  const [ejemplarRetirado, setEjemplarRetirado] = useState("");

  // Liquidación dinámica (como en la plataforma: posiciones, empates Dead Heat y adición de ejemplares)
  const [filasLlegada, setFilasLlegada] = useState<FilaLlegada[]>([
    { numero: "", empate: false },
    { numero: "", empate: false },
    { numero: "", empate: false },
    { numero: "", empate: false },
    { numero: "", empate: false },
  ]);
  const [plataformaResultado, setPlataformaResultado] = useState<{
    ganadores: string[];
    empates?: number[];
  } | null>(null);
  const [cargandoPlataforma, setCargandoPlataforma] = useState(false);

  // Publicidad
  const [pubTitulo, setPubTitulo] = useState("");
  const [pubContenido, setPubContenido] = useState("");
  const [pubEnlace, setPubEnlace] = useState("");
  const [pubFijado, setPubFijado] = useState(false);

  // Consultar si la plataforma ya tiene resultado cargado para esta carrera
  useEffect(() => {
    let activo = true;
    async function verificarResultadoPlataforma() {
      if (!supabase) return;
      const hip = String(sala.hipodromo_activo || hipodromo).trim();
      const num = Number(sala.numero_carrera_activa || numeroCarrera);
      const hoy = new Date().toISOString().slice(0, 10);
      if (!hip || !num) return;

      setCargandoPlataforma(true);
      try {
        const { data } = await supabase
          .from("resultados_carreras")
          .select("ganadores, orden_llegada, dividendos")
          .eq("fecha", hoy)
          .ilike("hipodromo", `%${hip}%`)
          .eq("carrera", num)
          .maybeSingle();

        if (activo && data && Array.isArray(data.ganadores) && data.ganadores.length > 0) {
          setPlataformaResultado({
            ganadores: data.ganadores.map(String),
          });
        } else if (activo) {
          setPlataformaResultado(null);
        }
      } catch {
        /* ignore */
      } finally {
        if (activo) setCargandoPlataforma(false);
      }
    }

    void verificarResultadoPlataforma();
    return () => {
      activo = false;
    };
  }, [sala.hipodromo_activo, sala.numero_carrera_activa, hipodromo, numeroCarrera]);

  // Tomar resultado directamente de la plataforma
  const tomarResultadoDePlataforma = () => {
    if (!plataformaResultado || !plataformaResultado.ganadores?.length) return;
    const g = plataformaResultado.ganadores;
    const minLength = Math.max(5, g.length);
    const nuevasFilas: FilaLlegada[] = Array.from({ length: minLength }, (_, idx) => ({
      numero: g[idx] ? String(g[idx]).trim() : "",
      empate: Boolean(plataformaResultado.empates?.includes(idx + 1)),
    }));
    setFilasLlegada(nuevasFilas);
    setMsgFeedback(`📥 Pizarra tomada de la plataforma: #${g.join(" - #")}`);
  };

  // Validaciones de duplicados en la pizarra
  const validacionPizarra = useMemo(() => {
    const llenas = filasLlegada.map((f) => f.numero.trim()).filter(Boolean);
    if (llenas.length === 0) return { ok: false, error: "Ingresa al menos el 1° lugar" };
    const vistos = new Set<string>();
    for (let i = 0; i < filasLlegada.length; i++) {
      const num = filasLlegada[i].numero.trim();
      if (!num) continue;
      if (vistos.has(num) && !filasLlegada[i].empate && !filasLlegada[i - 1]?.empate) {
        return { ok: false, error: `El ejemplar #${num} está duplicado en la llegada` };
      }
      vistos.add(num);
    }
    return { ok: true, error: null };
  }, [filasLlegada]);

  const ejecutarAccion = async (subaccion: string, extraPayload: Record<string, any> = {}) => {
    setCargando(true);
    setMsgFeedback(null);
    try {
      const res = await salaApi.accionOperador(subaccion, {
        salaId: sala.id,
        grupoId,
        ...extraPayload,
      });

      if (!res.ok) {
        setMsgFeedback(`❌ Error: ${res.error || "Operación fallida"}`);
      } else {
        setMsgFeedback("✅ Operación completada con éxito.");
        onActualizado();
        if (subaccion === "liquidar" && res.data?.preguntaOperador) {
          setMsgFeedback(`✅ Liquidación completada.\n${res.data.preguntaOperador}`);
        }
      }
    } catch (err: any) {
      setMsgFeedback(`❌ Error de conexión: ${err?.message || err}`);
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
      <div className="bg-[#111b21] border border-[#202c33] rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#202c33] flex items-center justify-between bg-[#202c33]/40">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span>🛠️</span> Panel de Control del Operador
            </h3>
            <p className="text-xs text-gray-400">
              Sala: <span className="text-white font-bold">{sala.nombre_sala}</span> | Grupo:{" "}
              <span className="text-emerald-400 font-semibold">{grupoNombre}</span>
            </p>
          </div>
          <button onClick={onCerrar} className="text-gray-400 hover:text-white px-2 py-1 text-sm rounded">
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[#202c33] bg-[#0b141a] px-3 pt-2 gap-1 text-xs font-semibold">
          <button
            onClick={() => setTab("carrera")}
            className={`px-3 py-2 rounded-t-lg transition ${
              tab === "carrera" ? "bg-[#111b21] text-emerald-400 border-t-2 border-emerald-500" : "text-gray-400 hover:text-white"
            }`}
          >
            🏇 Apertura / Cierre
          </button>
          <button
            onClick={() => setTab("retirados")}
            className={`px-3 py-2 rounded-t-lg transition ${
              tab === "retirados" ? "bg-[#111b21] text-emerald-400 border-t-2 border-emerald-500" : "text-gray-400 hover:text-white"
            }`}
          >
            🚫 Retirados
          </button>
          <button
            onClick={() => setTab("liquidacion")}
            className={`px-3 py-2 rounded-t-lg transition ${
              tab === "liquidacion" ? "bg-[#111b21] text-emerald-400 border-t-2 border-emerald-500" : "text-gray-400 hover:text-white"
            }`}
          >
            🏁 Liquidación
          </button>
          <button
            onClick={() => setTab("publicidad")}
            className={`px-3 py-2 rounded-t-lg transition ${
              tab === "publicidad" ? "bg-[#111b21] text-emerald-400 border-t-2 border-emerald-500" : "text-gray-400 hover:text-white"
            }`}
          >
            📢 Publicidad
          </button>
        </div>

        {/* Feedback message */}
        {msgFeedback && (
          <div className="mx-5 mt-4 p-3 bg-emerald-950/60 border border-emerald-700/60 rounded-xl text-xs font-mono text-emerald-300 whitespace-pre-wrap">
            {msgFeedback}
          </div>
        )}

        {/* Tab Content */}
        <div className="p-5 flex-1 overflow-y-auto text-xs space-y-4">
          {tab === "carrera" && (
            <div className="space-y-4">
              <div className="bg-[#0b141a] p-3.5 rounded-xl border border-gray-800 flex items-center justify-between">
                <div>
                  <span className="text-gray-400 text-[11px] block">Estado Actual de la Sala</span>
                  <span
                    className={`font-bold text-sm uppercase ${
                      sala.estado_carrera === "abierta"
                        ? "text-emerald-400"
                        : sala.estado_carrera === "cerrada"
                        ? "text-amber-400"
                        : "text-blue-400"
                    }`}
                  >
                    ● {sala.estado_carrera || "CERRADA"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={onAbrirPrejugadas}
                  className="bg-[#202c33] hover:bg-[#2a3942] border border-gray-700 text-amber-300 px-3 py-2 rounded-lg font-bold transition flex items-center gap-1.5"
                >
                  <span>📋</span>
                  <span>Reporte Prejugadas (PNG)</span>
                </button>
              </div>

              {/* Selector de Hipódromo con restricción por sala */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-gray-300 font-medium mb-1">
                    Hipódromo {esVenezuela ? "(Venezuela)" : esAmericanas ? "(Americanas)" : ""}
                  </label>
                  {esVenezuela ? (
                    <select
                      value={hipodromo}
                      onChange={(e) => setHipodromo(e.target.value)}
                      className="w-full bg-[#0b141a] border border-emerald-500/80 rounded-lg p-2.5 text-white font-bold"
                    >
                      <option value="LA RINCONADA">LA RINCONADA</option>
                      <option value="VALENCIA">VALENCIA</option>
                    </select>
                  ) : esAmericanas ? (
                    <div>
                      <input
                        list="hipodromos-americanos-list"
                        type="text"
                        value={hipodromo}
                        onChange={(e) => {
                          const v = e.target.value.toUpperCase();
                          setHipodromo(v);
                        }}
                        placeholder="GULFSTREAM PARK"
                        className="w-full bg-[#0b141a] border border-blue-500/80 rounded-lg p-2.5 text-white font-bold"
                      />
                      <datalist id="hipodromos-americanos-list">
                        {HIPODROMOS_AMERICANOS_COMUNES.map((h) => (
                          <option key={h} value={h} />
                        ))}
                      </datalist>
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={hipodromo}
                      onChange={(e) => setHipodromo(e.target.value.toUpperCase())}
                      placeholder="HIPÓDROMO"
                      className="w-full bg-[#0b141a] border border-gray-700 rounded-lg p-2.5 text-white font-bold"
                    />
                  )}
                  <p className="mt-1 text-[10px] text-gray-400">
                    {esVenezuela
                      ? "🇻🇪 En esta sala solo se permiten La Rinconada o Valencia."
                      : esAmericanas
                      ? "🇺🇸 En esta sala solo se permiten hipódromos americanos."
                      : ""}
                  </p>
                </div>

                <div>
                  <label className="block text-gray-300 font-medium mb-1">Nº Carrera</label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={numeroCarrera}
                    onChange={(e) => setNumeroCarrera(parseInt(e.target.value, 10) || 1)}
                    className="w-full bg-[#0b141a] border border-gray-700 rounded-lg p-2.5 text-white font-bold"
                  />
                </div>

                <div>
                  <label className="block text-gray-300 font-medium mb-1">Distancia (m)</label>
                  <input
                    type="number"
                    step="50"
                    value={distancia}
                    onChange={(e) => setDistancia(parseInt(e.target.value, 10) || 1200)}
                    className="w-full bg-[#0b141a] border border-gray-700 rounded-lg p-2.5 text-white font-bold"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2 pt-2">
                <button
                  type="button"
                  disabled={cargando}
                  onClick={() => {
                    const hipLimpio = hipodromo.trim().toUpperCase();
                    if (esVenezuela && hipLimpio !== "LA RINCONADA" && hipLimpio !== "VALENCIA") {
                      setMsgFeedback("❌ En el chat de VENEZUELA solo pueden abrirse carreras de LA RINCONADA o VALENCIA.");
                      return;
                    }
                    if (esAmericanas && (hipLimpio.includes("RINCONADA") || hipLimpio.includes("VALENCIA"))) {
                      setMsgFeedback("❌ En el chat de AMERICANAS solo pueden abrirse hipódromos americanos.");
                      return;
                    }
                    ejecutarAccion("abrir-carrera", {
                      hipodromo: hipLimpio,
                      numeroCarrera,
                      distancia,
                    });
                  }}
                  className="bg-[#00a884] hover:bg-emerald-500 text-black font-bold py-3 rounded-xl transition flex items-center justify-center gap-2"
                >
                  <span>🏇</span>
                  <span>Abrir Carrera (Doble Vista + Destacado Oficial)</span>
                </button>

                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={cargando}
                    onClick={() => ejecutarAccion("cerrar-carrera")}
                    className="flex-1 bg-amber-600/30 hover:bg-amber-600/40 border border-amber-500/50 text-amber-300 font-bold py-2.5 rounded-lg transition"
                  >
                    🔒 Cerrar Carrera
                  </button>
                  <button
                    type="button"
                    disabled={cargando}
                    onClick={() => ejecutarAccion("reabrir-carrera")}
                    className="flex-1 bg-[#202c33] hover:bg-[#2a3942] text-gray-300 font-bold py-2.5 rounded-lg transition"
                  >
                    🔓 Reabrir
                  </button>
                </div>
              </div>
            </div>
          )}

          {tab === "retirados" && (
            <div className="space-y-4">
              <div className="bg-[#0b141a] p-4 rounded-xl border border-gray-800">
                <h4 className="font-bold text-white mb-1">Retirado Oficial en Vivo</h4>
                <p className="text-gray-400 text-[11px] leading-relaxed">
                  Al procesar un retirado, el sistema bloquea inmediatamente nuevas jugadas con ese ejemplar, anula las
                  pactadas existentes y reintegra los saldos en el libro mayor.
                </p>
              </div>

              <div>
                <label className="block text-gray-300 font-medium mb-1">Número de Ejemplar Retirado</label>
                <input
                  type="text"
                  value={ejemplarRetirado}
                  onChange={(e) => setEjemplarRetirado(e.target.value.toUpperCase())}
                  placeholder="Ej. 5 o 5A"
                  className="w-full bg-[#0b141a] border border-gray-700 rounded-lg p-3 text-white font-bold text-base"
                />
              </div>

              <button
                type="button"
                disabled={cargando || !ejemplarRetirado.trim()}
                onClick={() => {
                  ejecutarAccion("retirado", { ejemplar: ejemplarRetirado.trim() });
                  setEjemplarRetirado("");
                }}
                className="w-full bg-red-600/30 hover:bg-red-600/40 border border-red-500/50 text-red-300 font-bold py-3 rounded-xl transition flex items-center justify-center gap-2"
              >
                <span>🚫</span>
                <span>Procesar Retirado Oficial #{ejemplarRetirado || "?"}</span>
              </button>
            </div>
          )}

          {tab === "liquidacion" && (
            <div className="space-y-4">
              <div className="bg-[#0b141a] p-3.5 rounded-xl border border-gray-800">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-white">Liquidación de Carrera (Pizarra Oficial)</h4>
                  <span className="text-[10px] text-emerald-400 font-bold uppercase">
                    {sala.hipodromo_activo || hipodromo} C{sala.numero_carrera_activa || numeroCarrera}
                  </span>
                </div>
                <p className="text-gray-400 text-[11px] mt-1 leading-relaxed">
                  Carga la llegada con soporte para <b>Empates (Dead Heat)</b> y añade tantas posiciones como sea necesario.
                  La sala puede tomar directamente la llegada oficial de la plataforma.
                </p>
              </div>

              {/* Botón / Banner: Tomar de la plataforma */}
              {plataformaResultado && (
                <div className="bg-emerald-950/40 border border-emerald-600/50 rounded-xl p-3 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-emerald-400 block">
                      ✅ Pizarra oficial en plataforma detectada
                    </span>
                    <span className="text-white font-mono text-xs font-bold">
                      Llegada: {plataformaResultado.ganadores.map((n) => `#${n}`).join(" - ")}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={tomarResultadoDePlataforma}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-3 py-1.5 rounded-lg transition shadow"
                  >
                    📥 Tomar de Plataforma
                  </button>
                </div>
              )}

              {/* Filas dinámicas de posiciones de llegada */}
              <div className="space-y-2 bg-[#0b141a] p-3.5 rounded-xl border border-gray-800">
                <div className="text-[11px] font-bold text-gray-400 pb-1 flex items-center justify-between">
                  <span>Posición y Ejemplar</span>
                  <span>Empate (Dead Heat)</span>
                </div>

                {filasLlegada.map((f, idx) => {
                  const numLimpio = f.numero.trim();
                  return (
                    <div
                      key={idx}
                      className="flex items-center justify-between gap-3 p-1.5 rounded-lg bg-[#111b21] border border-gray-800"
                    >
                      <div className="flex items-center gap-2">
                        {/* Insignia / Gualdrapa con número y color oficial */}
                        <span
                          className="grid h-7 w-8 shrink-0 place-items-center rounded-md text-[11px] font-black"
                          style={{
                            backgroundColor: numLimpio ? colorDeNumero(numLimpio) : "#202c33",
                            color: numLimpio ? textoDeNumero(numLimpio) : "#8696a0",
                          }}
                        >
                          {numLimpio || idx + 1}
                        </span>

                        <span className="w-8 font-bold text-gray-300 text-xs">{idx + 1}º</span>

                        <input
                          type="text"
                          inputMode="numeric"
                          value={f.numero}
                          placeholder="#"
                          onChange={(e) => {
                            const val = e.target.value.replace(/[^0-9]/g, "");
                            setFilasLlegada((prev) =>
                              prev.map((row, i) => (i === idx ? { ...row, numero: val } : row))
                            );
                          }}
                          className="w-16 bg-[#0b141a] border border-gray-700 focus:border-emerald-500 rounded-lg p-1.5 text-center text-white font-bold text-sm"
                        />
                      </div>

                      <label className="flex items-center gap-1.5 cursor-pointer text-gray-300 font-medium">
                        <input
                          type="checkbox"
                          checked={f.empate}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setFilasLlegada((prev) =>
                              prev.map((row, i) => (i === idx ? { ...row, empate: checked } : row))
                            );
                          }}
                          className="rounded text-emerald-500 accent-emerald-500 h-4 w-4"
                        />
                        <span className="text-[11px]">Empate</span>
                      </label>
                    </div>
                  );
                })}

                {/* Controles de adición / supresión de posiciones */}
                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    disabled={filasLlegada.length <= 1}
                    onClick={() => setFilasLlegada((prev) => prev.slice(0, -1))}
                    className="flex-1 bg-[#202c33] hover:bg-[#2a3942] disabled:opacity-40 text-gray-300 font-bold py-1.5 rounded-lg text-xs transition"
                  >
                    − Quitar {filasLlegada.length}° lugar
                  </button>

                  <button
                    type="button"
                    disabled={filasLlegada.length >= 10}
                    onClick={() =>
                      setFilasLlegada((prev) => [...prev, { numero: "", empate: false }])
                    }
                    className="flex-1 bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-600/50 text-emerald-300 font-bold py-1.5 rounded-lg text-xs transition"
                  >
                    ＋ Añadir {filasLlegada.length + 1}° lugar
                  </button>
                </div>
              </div>

              {validacionPizarra.error && (
                <div className="p-2.5 rounded-lg bg-amber-950/50 border border-amber-600/50 text-amber-300 text-xs">
                  ⚠️ {validacionPizarra.error}
                </div>
              )}

              <button
                type="button"
                disabled={cargando || !validacionPizarra.ok}
                onClick={() => {
                  const ganadores = filasLlegada.map((f) => f.numero.trim()).filter(Boolean);
                  const empates = filasLlegada
                    .map((f, i) => (f.empate ? i + 1 : null))
                    .filter((x): x is number => x !== null);

                  ejecutarAccion("liquidar", {
                    pizarra: {
                      primero: ganadores[0] || "",
                      segundo: ganadores[1] || undefined,
                      tercero: ganadores[2] || undefined,
                      cuarto: ganadores[3] || undefined,
                      quinto: ganadores[4] || undefined,
                      sexto: ganadores[5] || undefined,
                      septimo: ganadores[6] || undefined,
                      octavo: ganadores[7] || undefined,
                      ganadores,
                      empates,
                    },
                  });
                }}
                className="w-full bg-[#00a884] hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-400 text-black font-bold py-3 rounded-xl transition flex items-center justify-center gap-2 text-sm shadow-lg"
              >
                <span>🏁</span>
                <span>Liquidar Carrera y Publicar Resultados</span>
              </button>

              {/* Acciones Críticas de Operador / Administrador */}
              <div className="pt-3 border-t border-gray-800 space-y-2.5">
                <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                  <span>⚠️</span> Acciones Especiales de Corrección
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={cargando}
                    onClick={() => {
                      if (
                        confirm(
                          "¿Estás seguro de REVERSAR la liquidación de esta carrera?\n\nSe restablecerán los saldos, se descontarán premios acreditados y los tickets volverán a estado previo."
                        )
                      ) {
                        ejecutarAccion("reversar-carrera");
                      }
                    }}
                    className="bg-amber-950/60 hover:bg-amber-900/60 border border-amber-600/50 text-amber-300 font-bold py-2.5 px-3 rounded-xl transition flex items-center justify-center gap-1.5 text-xs"
                  >
                    <span>🔄</span>
                    <span>Reversar Liquidación</span>
                  </button>

                  <button
                    type="button"
                    disabled={cargando}
                    onClick={() => {
                      if (
                        confirm(
                          "¿Estás seguro de ANULAR la carrera por completo?\n\nSe devolverá el 100% del dinero comprometido a todos los participantes y todos los tickets quedarán anulados sin cobrar comisión."
                        )
                      ) {
                        ejecutarAccion("anular-carrera");
                      }
                    }}
                    className="bg-red-950/60 hover:bg-red-900/60 border border-red-600/50 text-red-300 font-bold py-2.5 px-3 rounded-xl transition flex items-center justify-center gap-1.5 text-xs"
                  >
                    <span>🚫</span>
                    <span>Anular Carrera (100%)</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {tab === "publicidad" && (
            <div className="space-y-3.5">
              <div>
                <label className="block text-gray-300 font-medium mb-1">Título de la Publicidad</label>
                <input
                  type="text"
                  value={pubTitulo}
                  onChange={(e) => setPubTitulo(e.target.value)}
                  placeholder="Ej. Promoción de Recargas o Super Match"
                  className="w-full bg-[#0b141a] border border-gray-700 rounded-lg p-2.5 text-white"
                />
              </div>

              <div>
                <label className="block text-gray-300 font-medium mb-1">Texto del Mensaje</label>
                <textarea
                  value={pubContenido}
                  onChange={(e) => setPubContenido(e.target.value)}
                  placeholder="Mensaje a transmitir en tiempo real en la sala..."
                  rows={3}
                  className="w-full bg-[#0b141a] border border-gray-700 rounded-lg p-2.5 text-white"
                />
              </div>

              <div>
                <label className="block text-gray-300 font-medium mb-1">Enlace / Botón de Acción (Opcional)</label>
                <input
                  type="url"
                  value={pubEnlace}
                  onChange={(e) => setPubEnlace(e.target.value)}
                  placeholder="https://..."
                  className="w-full bg-[#0b141a] border border-gray-700 rounded-lg p-2.5 text-white font-mono"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="pubFijado"
                  checked={pubFijado}
                  onChange={(e) => setPubFijado(e.target.checked)}
                  className="rounded text-emerald-500"
                />
                <label htmlFor="pubFijado" className="text-gray-300 cursor-pointer">
                  Fijar en el tope de la sala (Banner destacado permanente)
                </label>
              </div>

              <button
                type="button"
                disabled={cargando || !pubTitulo.trim() || !pubContenido.trim()}
                onClick={() => {
                  ejecutarAccion("publicidad", {
                    titulo: pubTitulo.trim(),
                    contenido: pubContenido.trim(),
                    enlace: pubEnlace.trim() || null,
                    fijado: pubFijado,
                  });
                  setPubTitulo("");
                  setPubContenido("");
                  setPubEnlace("");
                }}
                className="w-full bg-[#00a884] hover:bg-emerald-500 text-black font-bold py-2.5 rounded-lg transition"
              >
                Publicar en Tiempo Real
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
