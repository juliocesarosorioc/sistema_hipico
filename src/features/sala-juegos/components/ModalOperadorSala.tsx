"use client";

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { salaApi } from "../lib/sala-api";
import { colorDeNumero, textoDeNumero } from "@/features/tablas/lib/tipos";
import { getHorseColor } from "@/shared/lib/horseColors";
import { supabase } from "@/core/supabase";

interface PropsModalOperador {
  sala: any;
  grupoId: string;
  grupoNombre: string;
  onCerrar: () => void;
  onActualizado: () => void;
  onAbrirPrejugadas: () => void;
  tabInicial?: "carrera" | "retirados" | "liquidacion" | "publicidad";
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
  tabInicial = "carrera",
}: PropsModalOperador) {
  const [tab, setTab] = useState<"carrera" | "retirados" | "liquidacion" | "publicidad">(tabInicial);

  useEffect(() => {
    if (tabInicial) {
      setTab(tabInicial);
    }
  }, [tabInicial]);
  const [cargando, setCargando] = useState(false);
  const [msgFeedback, setMsgFeedback] = useState<string | null>(null);

  // Detección de sala: VENEZUELA vs AMERICANAS (solo si el nombre de la sala lo especifica)
  const nombreSalaUpper = String(sala.nombre_sala || "").toUpperCase();
  const esVenezuela =
    nombreSalaUpper.includes("VENEZUELA") ||
    nombreSalaUpper.includes("RINCONADA");
  const esAmericanas =
    nombreSalaUpper.includes("AMERICANA") ||
    nombreSalaUpper.includes("USA");

  // Apertura / Cierre
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

  // Estado de la carrera activa en la sala
  const estadoCarreraActual = String(sala.estado_carrera || "cerrada").toLowerCase();
  const hipActivoSala = String(sala.hipodromo_activo || "").trim().toUpperCase();
  const numActivoSala = Number(sala.numero_carrera_activa || 0);

  const esMismaCarrera =
    hipActivoSala === hipodromo.trim().toUpperCase() &&
    numActivoSala === Number(numeroCarrera);

  const carreraEstaAbierta = esMismaCarrera && estadoCarreraActual === "abierta";
  const carreraEstaCerrada = esMismaCarrera && estadoCarreraActual === "cerrada";
  const carreraEstaLiquidada = esMismaCarrera && estadoCarreraActual === "liquidada";

  // Retirados
  const [ejemplarRetirado, setEjemplarRetirado] = useState("");

  // Liquidación dinámica
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

  // Navegación por teclado de la pizarra: Enter carga, ↑/Shift+Tab suben,
  // ↓/Tab bajan (y en la última fila agrega una nueva posición).
  const filasLlegadaRefs = useRef<Array<HTMLInputElement | null>>([]);

  // Publicidad
  const [pubTitulo, setPubTitulo] = useState("");
  const [pubContenido, setPubContenido] = useState("");
  const [pubEnlace, setPubEnlace] = useState("");
  const [pubFijado, setPubFijado] = useState(false);
  const [publicidades, setPublicidades] = useState<any[]>([]);
  const [cargandoPublicidad, setCargandoPublicidad] = useState(false);
  const [eliminandoPublicidadId, setEliminandoPublicidadId] = useState<string | null>(null);

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
        setMsgFeedback("✅ Operación completada.");
        onActualizado();
        // Cierre automático del modal para ver de inmediato el chat
        onCerrar();
      }
    } catch (err: any) {
      setMsgFeedback(`❌ Error de conexión: ${err?.message || err}`);
    } finally {
      setCargando(false);
    }
  };

  /** Carga/liquida la pizarra oficial (misma acción que el botón 🏁). */
  const liquidarPizarra = () => {
    if (cargando || estadoCarreraActual === "liquidada" || !validacionPizarra.ok) return;
    const ganadores = filasLlegada.map((f) => f.numero.trim()).filter(Boolean);
    const empates = filasLlegada
      .map((f, i) => (f.empate ? i + 1 : null))
      .filter((x): x is number => x !== null);

    void ejecutarAccion("liquidar", {
      pizarra: {
        primero: ganadores[0] || "",
        segundo: ganadores[1] || undefined,
        tercero: ganadores[2] || undefined,
        cuarto: ganadores[3] || undefined,
        quinto: ganadores[4] || undefined,
        ganadores,
        empates,
      },
    });
  };

  /** Enfoca y selecciona el dorsal de la posición `idx`. */
  const enfocarFilaLlegada = (idx: number) => {
    const el = filasLlegadaRefs.current[idx];
    if (!el) return;
    el.focus();
    el.select();
  };

  /** Enter carga la pizarra; ↑/Shift+Tab retroceden; ↓/Tab avanzan. */
  const teclaFilaLlegada = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      liquidarPizarra();
      return;
    }
    if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
      e.preventDefault();
      if (idx > 0) enfocarFilaLlegada(idx - 1);
      return;
    }
    if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
      e.preventDefault();
      if (idx + 1 < filasLlegada.length) {
        enfocarFilaLlegada(idx + 1);
      } else if (filasLlegada.length < 10) {
        setFilasLlegada((prev) => [...prev, { numero: "", empate: false }]);
        window.setTimeout(() => enfocarFilaLlegada(idx + 1), 0);
      }
    }
  };

  const aplicarPresetPublicidad = (modalidad: "tablas" | "remates" | "marcas" | "pollas") => {
    if (modalidad === "tablas") {
      setPubTitulo("📊 ¡Tablas Fijas Disponibles!");
      setPubContenido("Ingresa ahora a jugar las Tablas Fijas de la jornada. ¡Cupos limitados!");
      setPubEnlace("/tablas-fijas");
      setPubFijado(true);
    } else if (modalidad === "remates") {
      setPubTitulo("🔨 ¡Remates en Vivo!");
      setPubContenido("Participa ya en los Remates activos con adjudicación inmediata y excelentes dividendos.");
      setPubEnlace("/remates");
      setPubFijado(true);
    } else if (modalidad === "marcas") {
      setPubTitulo("⭐ ¡Marcas Oficiales!");
      setPubContenido("Revisa y juega las Marcas de la jornada con los ejemplares recomendados.");
      setPubEnlace("/marcas");
      setPubFijado(true);
    } else if (modalidad === "pollas") {
      setPubTitulo("🎟️ ¡Gran Polla Hípica!");
      setPubContenido("Arma tu combinación ganadora en la Polla Hípica y compite por el acumulado.");
      setPubEnlace("/pollas");
      setPubFijado(true);
    }
  };

  const cargarPublicidades = useCallback(async () => {
    setCargandoPublicidad(true);
    try {
      const res = await salaApi.getPublicidad(grupoId);
      setPublicidades(Array.isArray(res?.data?.publicidad) ? res.data.publicidad : []);
    } catch {
      setPublicidades([]);
    } finally {
      setCargandoPublicidad(false);
    }
  }, [grupoId]);

  useEffect(() => {
    if (tab === "publicidad") void cargarPublicidades();
  }, [tab, cargarPublicidades]);

  const eliminarPublicidad = async (publicidadId: string) => {
    if (!publicidadId) return;
    setEliminandoPublicidadId(publicidadId);
    setMsgFeedback(null);
    try {
      const res = await salaApi.accionOperador("publicidad-eliminar", {
        salaId: sala.id,
        grupoId,
        publicidadId,
      });
      if (!res.ok) {
        setMsgFeedback(`❌ No se pudo eliminar la promoción: ${res.error || "Operación fallida"}`);
        return;
      }
      setMsgFeedback("✅ Promoción eliminada correctamente.");
      await cargarPublicidades();
      onActualizado();
    } catch (err: any) {
      setMsgFeedback(`❌ Error de conexión: ${err?.message || err}`);
    } finally {
      setEliminandoPublicidadId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-200/70 backdrop-blur-xs p-2 sm:p-4">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[94vh]">
        {/* Header Compacto UX/UI */}
        <div className="px-3.5 py-2.5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div>
            <h3 className="text-sm font-black text-slate-900 flex items-center gap-1.5 leading-tight">
              <span>🛠️</span> Control de Operador
            </h3>
            <p className="text-[11px] text-slate-500 leading-none mt-0.5">
              Sala: <span className="text-slate-900 font-bold">{sala.nombre_sala}</span> | Grupo:{" "}
              <span className="text-emerald-700 font-semibold">{grupoNombre}</span>
            </p>
          </div>
          <button
            onClick={onCerrar}
            className="text-slate-500 hover:text-slate-900 px-2 py-1 text-sm rounded transition hover:bg-slate-100"
            title="Cerrar modal"
          >
            ✕
          </button>
        </div>

        {/* Tabs Compactas */}
        <div className="flex border-b border-slate-200 bg-white px-2 pt-1.5 gap-1 text-[11px] font-bold">
          <button
            onClick={() => setTab("carrera")}
            className={`px-2.5 py-1.5 rounded-t-lg transition flex items-center gap-1 ${
              tab === "carrera" ? "bg-white text-emerald-700 border-t-2 border-emerald-500" : "text-slate-500 hover:text-slate-900"
            }`}
          >
            <span>🏇</span>
            <span>Carrera</span>
          </button>
          <button
            onClick={() => setTab("retirados")}
            className={`px-2.5 py-1.5 rounded-t-lg transition flex items-center gap-1 ${
              tab === "retirados" ? "bg-white text-emerald-700 border-t-2 border-emerald-500" : "text-slate-500 hover:text-slate-900"
            }`}
          >
            <span>🚫</span>
            <span>Retirados</span>
          </button>
          <button
            onClick={() => setTab("liquidacion")}
            className={`px-2.5 py-1.5 rounded-t-lg transition flex items-center gap-1 ${
              tab === "liquidacion" ? "bg-white text-emerald-700 border-t-2 border-emerald-500" : "text-slate-500 hover:text-slate-900"
            }`}
          >
            <span>🏁</span>
            <span>Liquidación</span>
          </button>
          <button
            onClick={() => setTab("publicidad")}
            className={`px-2.5 py-1.5 rounded-t-lg transition flex items-center gap-1 ${
              tab === "publicidad" ? "bg-white text-emerald-700 border-t-2 border-emerald-500" : "text-slate-500 hover:text-slate-900"
            }`}
          >
            <span>📢</span>
            <span>Promoción</span>
          </button>
        </div>

        {/* Feedback message */}
        {msgFeedback && (
          <div className="mx-3 mt-2.5 p-2 bg-emerald-950/70 border border-emerald-700/60 rounded-lg text-[11px] font-mono text-emerald-700 whitespace-pre-wrap">
            {msgFeedback}
          </div>
        )}

        {/* Tab Content con scroll y altura optimizada */}
        <div className="p-3 sm:p-4 flex-1 overflow-y-auto text-xs space-y-3">
          {tab === "carrera" && (
            <div className="space-y-3">
              {/* Tarjeta de Estado Actual */}
              <div className="bg-white p-2.5 rounded-xl border border-slate-200 flex items-center justify-between">
                <div>
                  <span className="text-slate-500 text-[10px] uppercase font-bold block">Estado en Sala</span>
                  <span
                    className={`font-black text-xs uppercase flex items-center gap-1 ${
                      sala.estado_carrera === "abierta"
                        ? "text-emerald-700"
                        : sala.estado_carrera === "cerrada"
                        ? "text-amber-400"
                        : "text-blue-400"
                    }`}
                  >
                    <span>●</span>
                    <span>{sala.hipodromo_activo || hipodromo} C{sala.numero_carrera_activa || numeroCarrera} — {sala.estado_carrera || "CERRADA"}</span>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={onAbrirPrejugadas}
                  className="bg-slate-100 hover:bg-slate-200 border border-slate-300 text-amber-700 px-2.5 py-1 rounded-lg text-[11px] font-bold transition flex items-center gap-1 shadow-xs"
                >
                  <span>📋</span>
                  <span>Prejugadas (PNG)</span>
                </button>
              </div>

              {/* Selector de Hipódromo y Carrera (Sin campo de distancia, optimizado a 2 columnas) */}
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="block text-slate-600 font-bold text-[11px] mb-1">
                    Hipódromo {esVenezuela ? "(Venezuela)" : esAmericanas ? "(Americanas)" : ""}
                  </label>
                  {esVenezuela ? (
                    <select
                      value={hipodromo}
                      onChange={(e) => setHipodromo(e.target.value)}
                      className="w-full bg-white border border-emerald-500/80 rounded-lg px-2.5 py-2 text-slate-900 font-bold text-xs"
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
                        onChange={(e) => setHipodromo(e.target.value.toUpperCase())}
                        placeholder="GULFSTREAM PARK"
                        className="w-full bg-white border border-blue-500/80 rounded-lg px-2.5 py-2 text-slate-900 font-bold text-xs"
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
                      className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-2 text-slate-900 font-bold text-xs"
                    >
                    </input>
                  )}
                  <p className="mt-0.5 text-[9px] text-slate-500">
                    {esVenezuela
                      ? "🇻🇪 Solo La Rinconada o Valencia."
                      : esAmericanas
                      ? "🇺🇸 Solo hipódromos americanos."
                      : ""}
                  </p>
                </div>

                <div>
                  <label className="block text-slate-600 font-bold text-[11px] mb-1">Nº Carrera</label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={numeroCarrera}
                    onChange={(e) => setNumeroCarrera(parseInt(e.target.value, 10) || 1)}
                    className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-2 text-slate-900 font-bold text-xs text-center"
                  />
                </div>
              </div>

              {/* Botonera de Acción Dinámica */}
              <div className="pt-1.5 space-y-2">
                {carreraEstaAbierta ? (
                  // Caso 1: La carrera está ABIERTA -> El botón principal es CERRAR CARRERA
                  <div className="space-y-1.5">
                    <button
                      type="button"
                      disabled={cargando}
                      onClick={() => ejecutarAccion("cerrar-carrera")}
                      className="w-full bg-amber-500 hover:bg-amber-400 text-slate-900 font-black py-2.5 rounded-xl transition flex items-center justify-center gap-1.5 text-xs shadow-md"
                    >
                      <span>🔒</span>
                      <span>Cerrar Carrera</span>
                    </button>

                    <div className="flex justify-end">
                      <button
                        type="button"
                        disabled={cargando}
                        onClick={() => {
                          if (
                            confirm(
                              `¿Estás seguro de ANULAR la carrera activa (${hipodromo} C${numeroCarrera})?\n\nSe devolverá el saldo y se anularán las jugadas sin cobrar comisión.`
                            )
                          ) {
                            ejecutarAccion("anular-carrera");
                          }
                        }}
                        className="text-[10px] text-red-400 hover:text-red-300 border border-red-900/60 hover:bg-red-950/40 rounded px-2 py-1 transition flex items-center gap-1 font-bold"
                      >
                        <span>⚠️</span>
                        <span>Anular Carrera</span>
                      </button>
                    </div>
                  </div>
                ) : carreraEstaCerrada ? (
                  // Caso 2: La carrera está CERRADA -> El botón principal es REABRIR CARRERA
                  <button
                    type="button"
                    disabled={cargando}
                    onClick={() => ejecutarAccion("reabrir-carrera")}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black py-2.5 rounded-xl transition flex items-center justify-center gap-1.5 text-xs shadow-md"
                  >
                    <span>🔓</span>
                    <span>Reabrir Carrera</span>
                  </button>
                ) : carreraEstaLiquidada ? (
                  // Caso 3: La carrera está LIQUIDADA -> Bloqueado todo excepto Reversar Liquidación
                  <div className="space-y-2">
                    <div className="rounded-xl border border-blue-900/60 bg-blue-950/40 p-2.5 text-center space-y-1">
                      <span className="text-blue-700 font-bold text-xs block">
                        🏁 Esta carrera ya fue liquidada
                      </span>
                      <span className="text-slate-500 text-[10px] block leading-relaxed">
                        Todas las opciones para esta carrera están bloqueadas. Para modificarla debes reversar la liquidación o seleccionar otra carrera arriba.
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={cargando}
                      onClick={() => {
                        if (
                          confirm(
                            `¿Estás seguro de REVERSAR la liquidación de ${hipodromo} C${numeroCarrera}?\n\nSe restituirán los saldos y los tickets volverán al estado previo.`
                          )
                        ) {
                          ejecutarAccion("reversar-carrera");
                        }
                      }}
                      className="w-full bg-rose-600 hover:bg-rose-500 text-white font-black py-2.5 rounded-xl transition flex items-center justify-center gap-1.5 text-xs shadow-md"
                    >
                      <span>🔄</span>
                      <span>Reversar Liquidación</span>
                    </button>
                  </div>
                ) : (
                  // Caso 4: Nueva carrera seleccionada o carrera no abierta -> ABRIR CARRERA
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
                        distancia: 1200,
                      });
                    }}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black py-2.5 rounded-xl transition flex items-center justify-center gap-1.5 text-xs shadow-md"
                  >
                    <span>🟢</span>
                    <span>Abrir Carrera</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {tab === "retirados" && (
            <div className="space-y-3">
              <div className="bg-white p-2.5 rounded-xl border border-slate-200">
                <h4 className="font-bold text-slate-900 text-xs mb-0.5">Retirado Oficial en Vivo</h4>
                <p className="text-slate-500 text-[10px] leading-relaxed">
                  Al procesar un retirado se anulan automáticamente las jugadas comprometidas con ese ejemplar y se devuelve el saldo.
                </p>
              </div>

              {estadoCarreraActual === "liquidada" && (
                <div className="rounded-xl border border-rose-500/40 bg-rose-950/40 p-2.5 text-center text-[11px] font-bold text-rose-300">
                  🔒 Carrera liquidada: debes reversar la liquidación antes de procesar retirados.
                </div>
              )}

              <div>
                <label className="block text-slate-600 font-bold text-[11px] mb-1">Número de Ejemplar Retirado</label>
                <input
                  type="text"
                  disabled={estadoCarreraActual === "liquidada"}
                  value={ejemplarRetirado}
                  onChange={(e) => setEjemplarRetirado(e.target.value.toUpperCase())}
                  placeholder="Ej. 5"
                  className="w-full bg-white border border-slate-300 rounded-lg p-2 text-slate-900 font-bold text-sm text-center disabled:opacity-40 disabled:cursor-not-allowed"
                />
              </div>

              <button
                type="button"
                disabled={cargando || estadoCarreraActual === "liquidada" || !ejemplarRetirado.trim()}
                onClick={() => {
                  ejecutarAccion("retirado", { ejemplar: ejemplarRetirado.trim() });
                  setEjemplarRetirado("");
                }}
                className="w-full bg-red-600/30 hover:bg-red-600/40 border border-red-500/50 text-red-300 font-bold py-2.5 rounded-xl transition flex items-center justify-center gap-1.5 text-xs shadow disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span>🚫</span>
                <span>Procesar Retirado Oficial #{ejemplarRetirado || "?"}</span>
              </button>
            </div>
          )}

          {tab === "liquidacion" && (
            <div className="space-y-3">
              <div className="bg-white p-2.5 rounded-xl border border-slate-200 flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-slate-900 text-xs">Pizarra Oficial de Liquidación</h4>
                  <span className="text-[10px] text-slate-500">
                    Posiciones de llegada y empates (Dead Heat)
                  </span>
                </div>
                <span className="text-[10px] text-emerald-700 font-black uppercase">
                  {sala.hipodromo_activo || hipodromo} C{sala.numero_carrera_activa || numeroCarrera}
                </span>
              </div>

              {estadoCarreraActual === "liquidada" && (
                <div className="rounded-xl border border-rose-500/40 bg-rose-950/40 p-2.5 text-center text-[11px] font-bold text-rose-300">
                  🔒 Esta carrera ya está liquidada. Solo puedes reversar la liquidación.
                </div>
              )}

              {/* Botón: Tomar de Plataforma */}
              {plataformaResultado && estadoCarreraActual !== "liquidada" && (
                <div className="bg-emerald-950/40 border border-emerald-600/50 rounded-xl p-2.5 flex items-center justify-between gap-2">
                  <div className="truncate">
                    <span className="text-[9px] uppercase font-black text-emerald-700 block">
                      ✅ Pizarra oficial en plataforma
                    </span>
                    <span className="text-slate-900 font-mono text-[11px] font-bold truncate block">
                      Llegada: {plataformaResultado.ganadores.map((n) => `#${n}`).join(" - ")}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={tomarResultadoDePlataforma}
                    className="shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] px-2.5 py-1 rounded-lg transition shadow"
                  >
                    📥 Tomar
                  </button>
                </div>
              )}

              {/* Filas compactas de posiciones de llegada */}
              <div className="space-y-1.5 bg-white p-2.5 rounded-xl border border-slate-200">
                <div className="text-[10px] font-bold text-slate-500 pb-0.5 flex items-center justify-between">
                  <span>Posición y Ejemplar</span>
                  <span>Empate (Dead Heat)</span>
                </div>

                {filasLlegada.map((f, idx) => {
                  const numLimpio = f.numero.trim();
                  return (
                    <div
                      key={idx}
                      className="flex items-center justify-between gap-2 p-1 rounded-lg bg-white border border-slate-200"
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className="grid h-6 w-7 shrink-0 place-items-center rounded border text-[10px] font-black shadow-2xs"
                          style={{
                            backgroundColor: numLimpio ? colorDeNumero(numLimpio) : "#202c33",
                            color: numLimpio ? textoDeNumero(numLimpio) : "#8696a0",
                            borderColor: numLimpio ? getHorseColor(numLimpio).hex : "#374151",
                          }}
                        >
                          {numLimpio || idx + 1}
                        </span>

                        <span className="w-6 font-bold text-slate-600 text-[11px]">{idx + 1}º</span>

                        <input
                          ref={(el) => {
                            filasLlegadaRefs.current[idx] = el;
                          }}
                          type="text"
                          inputMode="numeric"
                          disabled={estadoCarreraActual === "liquidada"}
                          value={f.numero}
                          placeholder="#"
                          onChange={(e) => {
                            const val = e.target.value.replace(/[^0-9]/g, "");
                            setFilasLlegada((prev) =>
                              prev.map((row, i) => (i === idx ? { ...row, numero: val } : row))
                            );
                          }}
                          onKeyDown={(e) => teclaFilaLlegada(idx, e)}
                          title="Enter: cargar pizarra · ↑ / Shift+Tab: posición anterior · ↓ / Tab: siguiente posición"
                          className="w-14 h-7 bg-white border border-slate-300 focus:border-emerald-500 rounded p-1 text-center text-slate-900 font-bold text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                        />
                      </div>

                      <label className={`flex items-center gap-1 text-slate-600 font-medium text-[11px] ${estadoCarreraActual === "liquidada" ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}>
                        <input
                          type="checkbox"
                          disabled={estadoCarreraActual === "liquidada"}
                          checked={f.empate}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setFilasLlegada((prev) =>
                              prev.map((row, i) => (i === idx ? { ...row, empate: checked } : row))
                            );
                          }}
                          className="rounded text-emerald-500 accent-emerald-500 h-3.5 w-3.5 disabled:cursor-not-allowed"
                        />
                        <span>Empate</span>
                      </label>
                    </div>
                  );
                })}

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    disabled={estadoCarreraActual === "liquidada" || filasLlegada.length <= 1}
                    onClick={() => setFilasLlegada((prev) => prev.slice(0, -1))}
                    className="flex-1 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed text-slate-600 font-bold py-1 rounded text-[11px] transition"
                  >
                    − Quitar {filasLlegada.length}°
                  </button>

                  <button
                    type="button"
                    disabled={estadoCarreraActual === "liquidada" || filasLlegada.length >= 10}
                    onClick={() =>
                      setFilasLlegada((prev) => [...prev, { numero: "", empate: false }])
                    }
                    className="flex-1 bg-emerald-950/60 hover:bg-emerald-900/60 disabled:opacity-40 disabled:cursor-not-allowed border border-emerald-600/50 text-emerald-700 font-bold py-1 rounded text-[11px] transition"
                  >
                    ＋ Añadir {filasLlegada.length + 1}°
                  </button>
                </div>
              </div>

              {validacionPizarra.error && estadoCarreraActual !== "liquidada" && (
                <div className="p-2 rounded-lg bg-amber-950/50 border border-amber-600/50 text-amber-700 text-[11px]">
                  ⚠️ {validacionPizarra.error}
                </div>
              )}

              {estadoCarreraActual === "liquidada" ? (
                <button
                  type="button"
                  disabled={cargando}
                  onClick={() => {
                    if (
                      confirm(
                        `¿Estás seguro de REVERSAR la liquidación de ${sala.hipodromo_activo || hipodromo} C${sala.numero_carrera_activa || numeroCarrera}?\n\nSe restituirán los saldos y los tickets volverán al estado previo.`
                      )
                    ) {
                      ejecutarAccion("reversar-carrera");
                    }
                  }}
                  className="w-full bg-rose-600 hover:bg-rose-500 text-white font-black py-2.5 rounded-xl transition flex items-center justify-center gap-1.5 text-xs shadow-md"
                >
                  <span>🔄</span>
                  <span>Reversar Liquidación</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={cargando || !validacionPizarra.ok}
                  onClick={liquidarPizarra}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-black py-2.5 rounded-xl transition flex items-center justify-center gap-1.5 text-xs shadow-md"
                >
                  <span>🏁</span>
                  <span>Liquidar Carrera y Publicar</span>
                </button>
              )}
            </div>
          )}

          {tab === "publicidad" && (
            <div className="space-y-2.5">
              {/* Accesos Rápidos a Promociones de Modalidades */}
              <div>
                <label className="block text-slate-500 font-bold text-[10px] uppercase mb-1">
                  Promocionar Modalidad (Click directo en el Banner)
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  <button
                    type="button"
                    onClick={() => aplicarPresetPublicidad("tablas")}
                    className="bg-slate-100 hover:bg-slate-200 border border-emerald-500/40 text-emerald-700 font-bold py-1.5 px-2 rounded-lg text-[10px] transition flex items-center justify-center gap-1"
                  >
                    <span>📊</span>
                    <span>Tablas Fijas</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => aplicarPresetPublicidad("remates")}
                    className="bg-slate-100 hover:bg-slate-200 border border-amber-500/40 text-amber-700 font-bold py-1.5 px-2 rounded-lg text-[10px] transition flex items-center justify-center gap-1"
                  >
                    <span>🔨</span>
                    <span>Remates</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => aplicarPresetPublicidad("marcas")}
                    className="bg-slate-100 hover:bg-slate-200 border border-blue-500/40 text-blue-700 font-bold py-1.5 px-2 rounded-lg text-[10px] transition flex items-center justify-center gap-1"
                  >
                    <span>⭐</span>
                    <span>Marcas</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => aplicarPresetPublicidad("pollas")}
                    className="bg-slate-100 hover:bg-slate-200 border border-purple-500/40 text-purple-700 font-bold py-1.5 px-2 rounded-lg text-[10px] transition flex items-center justify-center gap-1"
                  >
                    <span>🎟️</span>
                    <span>Polla</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-slate-600 font-bold text-[11px] mb-0.5">Título del Anuncio</label>
                <input
                  type="text"
                  value={pubTitulo}
                  onChange={(e) => setPubTitulo(e.target.value)}
                  placeholder="Ej. ¡Tablas Fijas Activas!"
                  className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-slate-900 text-xs font-bold"
                />
              </div>

              <div>
                <label className="block text-slate-600 font-bold text-[11px] mb-0.5">Texto del Mensaje</label>
                <textarea
                  value={pubContenido}
                  onChange={(e) => setPubContenido(e.target.value)}
                  placeholder="Mensaje a transmitir en el banner..."
                  rows={2}
                  className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-slate-900 text-xs leading-tight"
                />
              </div>

              <div>
                <label className="block text-slate-600 font-bold text-[11px] mb-0.5">
                  Enlace al hacer click (Ruta interna ej. /tablas-fijas o URL)
                </label>
                <input
                  type="text"
                  value={pubEnlace}
                  onChange={(e) => setPubEnlace(e.target.value)}
                  placeholder="/tablas-fijas, /remates o https://..."
                  className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-slate-900 font-mono text-xs"
                />
              </div>

              <div className="flex items-center gap-2 pt-0.5">
                <input
                  type="checkbox"
                  id="pubFijado"
                  checked={pubFijado}
                  onChange={(e) => setPubFijado(e.target.checked)}
                  className="rounded text-emerald-500 accent-emerald-500 h-3.5 w-3.5"
                />
                <label htmlFor="pubFijado" className="text-slate-600 cursor-pointer text-[11px]">
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
                  void cargarPublicidades();
                  setPubTitulo("");
                  setPubContenido("");
                  setPubEnlace("");
                }}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black py-2.5 rounded-xl transition text-xs shadow-md"
              >
                📢 Publicar Promoción
              </button>

              <div className="mt-3 border-t border-slate-200 pt-2.5">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">
                    Promociones activas ({publicidades.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => void cargarPublicidades()}
                    disabled={cargandoPublicidad}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                  >
                    {cargandoPublicidad ? "⏳" : "🔄 Actualizar"}
                  </button>
                </div>

                {cargandoPublicidad && publicidades.length === 0 ? (
                  <p className="rounded-lg bg-slate-50 p-2 text-center text-[11px] text-slate-500">
                    Cargando promociones...
                  </p>
                ) : publicidades.length === 0 ? (
                  <p className="rounded-lg bg-slate-50 p-2 text-center text-[11px] text-slate-500">
                    No hay promociones activas en esta sala.
                  </p>
                ) : (
                  <ul className="max-h-40 space-y-1.5 overflow-y-auto pr-1">
                    {publicidades.map((p) => {
                      const id = String(p.id);
                      return (
                        <li
                          key={id}
                          className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[11px] font-black text-slate-900">
                              {p.titulo || "Sin título"}
                            </p>
                            <p className="truncate text-[10px] text-slate-600">
                              {p.contenido_texto || ""}
                            </p>
                            {p.fijado_en_tope && (
                              <span className="mt-0.5 inline-block rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-black text-emerald-700">
                                📌 Fijada
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            disabled={eliminandoPublicidadId === id}
                            onClick={() => void eliminarPublicidad(id)}
                            title="Eliminar promoción"
                            className="shrink-0 rounded-lg border border-rose-200 bg-white px-2 py-1 text-[10px] font-black text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {eliminandoPublicidadId === id ? "⏳" : "🗑️ Eliminar"}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
