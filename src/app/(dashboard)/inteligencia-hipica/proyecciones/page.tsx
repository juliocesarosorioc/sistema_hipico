"use client";

<<<<<<< HEAD
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/core/supabase";
import { ModalAnalisisActuarialGodet } from "@/features/ejemplares/components/ModalAnalisisActuarialGodet";

interface EjemplarConMemoria {
  numero: number;
  nombre: string;
  jinete?: string;
  entrenador?: string;
  morningLine?: string;
  retirado?: boolean;
  speedPromedio: number;
  speedMaximo: number;
  indiceGodet: number;
  probabilidadActuarial: number;
  ultimasActuaciones: Array<{
    fecha: string;
    hipodromo: string;
    carrera: number;
    distancia?: number;
    posicion?: number;
    beyer?: number;
    tiempo?: number;
    comentario?: string;
  }>;
}

interface CarreraDia {
  id: string;
  hipodromo_nombre: string;
  fecha: string;
  numero_carrera: number;
  distancia?: string;
  ejemplares: any[];
}

export default function ProyeccionesInteligenciaPage() {
  const [fecha, setFecha] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [carreras, setCarreras] = useState<CarreraDia[]>([]);
  const [hipodromoSel, setHipodromoSel] = useState<string>("");
  const [carreraSelId, setCarreraSelId] = useState<string>("");
  const [ejemplaresAnalizados, setEjemplaresAnalizados] = useState<EjemplarConMemoria[]>([]);
  const [cargando, setCargando] = useState(false);
  const [modalAbierto, setModalAbierto] = useState(false);

  // 1. Cargar todas las carreras registradas para la fecha seleccionada
  useEffect(() => {
    async function cargarJornada() {
      setCargando(true);
      try {
        const { data, error } = await supabase
          .from("carreras")
          .select("*")
          .eq("fecha", fecha)
          .order("hipodromo_nombre", { ascending: true })
          .order("numero_carrera", { ascending: true });

        if (!error && data) {
          setCarreras(data as CarreraDia[]);
          if (data.length > 0 && !hipodromoSel) {
            setHipodromoSel(data[0].hipodromo_nombre);
            setCarreraSelId(data[0].id);
          }
        }
      } finally {
        setCargando(false);
      }
    }
    cargarJornada();
  }, [fecha]);

  const hipodromosDisponibles = useMemo(() => {
    return Array.from(new Set(carreras.map((c) => c.hipodromo_nombre)));
  }, [carreras]);

  const carrerasDeHipodromo = useMemo(() => {
    return carreras
      .filter((c) => c.hipodromo_nombre === hipodromoSel)
      .sort((a, b) => a.numero_carrera - b.numero_carrera);
  }, [carreras, hipodromoSel]);

  const carreraActiva = useMemo(() => {
    return carrerasDeHipodromo.find((c) => c.id === carreraSelId) || carrerasDeHipodromo[0];
  }, [carrerasDeHipodromo, carreraSelId]);

  // 2. Cruzar automáticamente los caballos de la carrera con su Memoria Histórica en BD
  useEffect(() => {
    async function enriquecerConMemoriaHistorica() {
      if (!carreraActiva || !Array.isArray(carreraActiva.ejemplares)) {
        setEjemplaresAnalizados([]);
        return;
      }

      const listaCruda = carreraActiva.ejemplares;
      const nombres = listaCruda.map((e: any) => String(e.nombre || e.ejemplar || "").trim()).filter(Boolean);

      let mapaMemoria = new Map<string, any>();
      if (nombres.length > 0) {
        const { data: memoriaDB } = await supabase.rpc("rpc_obtener_memoria_historica_caballos", {
          p_nombres: nombres,
        });
        if (Array.isArray(memoriaDB)) {
          for (const item of memoriaDB) {
            mapaMemoria.set(item.nombre_normalizado, item);
          }
        }
      }

      // Calcular score actuarial combinando datos del día + memoria histórica
      const preliminares = listaCruda.map((e: any, idx: number) => {
        const nombreLimpio = String(e.nombre || e.ejemplar || `Ejemplar #${e.numero || idx + 1}`).trim();
        const claveNorm = nombreLimpio.toUpperCase().replace(/[^A-Z0-9ÁÉÍÓÚÑ ]/g, "");
        const hist = mapaMemoria.get(claveNorm);

        const actuaciones = Array.isArray(hist?.ultimas_actuaciones) ? hist.ultimas_actuaciones : [];
        const speedProm = Number(hist?.speed_rating_promedio || e.speed_rating || 75);
        const speedMax = Number(hist?.speed_rating_maximo || e.speed_max || speedProm + 5);
        const consistencia = Number(hist?.indice_consistencia_godet || 60);

        // Peso compuesto: 45% Speed Promedio, 30% Speed Máximo, 25% Consistencia Godet
        const scoreBruto = e.retirado ? 0 : speedProm * 0.45 + speedMax * 0.3 + consistencia * 0.25;

        return {
          numero: Number(e.numero || idx + 1),
          nombre: nombreLimpio,
          jinete: e.jinete || hist?.jinete_habitual || "Por asignar",
          entrenador: e.entrenador || hist?.entrenador_actual || "Por asignar",
          morningLine: e.morning_line || e.ml || "N/A",
          retirado: Boolean(e.retirado || e.invalidado),
          speedPromedio: speedProm,
          speedMaximo: speedMax,
          indiceGodet: consistencia,
          scoreBruto,
          ultimasActuaciones: actuaciones,
        };
      });

      const sumaScores = preliminares.reduce((acc, item) => acc + item.scoreBruto, 0) || 1;
      const enriquecidos: EjemplarConMemoria[] = preliminares
        .map((item) => ({
          ...item,
          probabilidadActuarial: Number(((item.scoreBruto / sumaScores) * 100).toFixed(2)),
        }))
        .sort((a, b) => b.probabilidadActuarial - a.probabilidadActuarial);

      setEjemplaresAnalizados(enriquecidos);
    }

    enriquecerConMemoriaHistorica();
  }, [carreraActiva]);

  return (
    <section className="flex flex-col gap-6 p-4">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div>
          <h1 className="text-xl font-black uppercase tracking-wide text-slate-900">
            🧭 Inteligencia Hípica · Proyecciones Godet & Actuarial
          </h1>
          <p className="text-xs text-slate-500">
            Cruce automático en tiempo real entre el programa del día y la base de datos histórica de actuaciones por ejemplar.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800"
          />
          <button
            type="button"
            onClick={() => setModalAbierto(true)}
            className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-black uppercase tracking-wider text-slate-950 shadow hover:bg-amber-400"
          >
            ⚡ Abrir Simulador Godet & Actuarial Completo
          </button>
        </div>
      </div>

      {/* Selector de Hipódromo y Carrera */}
      <div className="flex flex-wrap items-center gap-3">
        {hipodromosDisponibles.map((hip) => (
          <button
            key={hip}
            type="button"
            onClick={() => {
              setHipodromoSel(hip);
              const primera = carreras.find((c) => c.hipodromo_nombre === hip);
              if (primera) setCarreraSelId(primera.id);
            }}
            className={`rounded-lg px-4 py-2 text-xs font-bold uppercase transition-colors ${
              hipodromoSel === hip
                ? "bg-slate-900 text-amber-400 shadow"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            🏇 {hip}
          </button>
        ))}
      </div>

      {carrerasDeHipodromo.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3">
          {carrerasDeHipodromo.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCarreraSelId(c.id)}
              className={`rounded-md px-3 py-1.5 text-xs font-black transition-all ${
                carreraActiva?.id === c.id
                  ? "bg-blue-600 text-white shadow-sm"
                  : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50"
              }`}
            >
              Carrera {c.numero_carrera}
            </button>
          ))}
        </div>
      )}

      {/* Tabla de Proyección Actuarial con Historial Precargado */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-900 text-[11px] font-bold uppercase tracking-wider text-slate-200">
            <tr>
              <th className="px-4 py-3">#</th>
              <th className="px-4 py-3">Ejemplar</th>
              <th className="px-4 py-3">Jinete / Entrenador</th>
              <th className="px-4 py-3 text-center">Speed Prom / Máx</th>
              <th className="px-4 py-3 text-center">Índice Godet</th>
              <th className="px-4 py-3 text-center">Probabilidad Actuarial</th>
              <th className="px-4 py-3">Memoria Histórica (Últimas Actuaciones en BD)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {cargando ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-slate-400">
                  Consultando motor actuarial y memoria histórica...
                </td>
              </tr>
            ) : ejemplaresAnalizados.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-slate-400">
                  Selecciona una carrera con ejemplares cargados o abre el Simulador Godet & Actuarial.
                </td>
              </tr>
            ) : (
              ejemplaresAnalizados.map((ej, idx) => (
                <tr
                  key={ej.numero}
                  className={
                    ej.retirado
                      ? "bg-red-50/60 line-through opacity-60"
                      : idx === 0
                      ? "bg-amber-50/50 font-semibold"
                      : "hover:bg-slate-50"
                  }
                >
                  <td className="px-4 py-3 font-black text-slate-900">{ej.numero}</td>
                  <td className="px-4 py-3">
                    <div className="font-bold text-slate-900">{ej.nombre}</div>
                    <div className="text-[11px] text-slate-500">ML: {ej.morningLine}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-700">
                    <div>🏇 {ej.jinete}</div>
                    <div className="text-slate-500">🎓 {ej.entrenador}</div>
                  </td>
                  <td className="px-4 py-3 text-center font-mono text-xs">
                    <span className="font-bold text-blue-700">{ej.speedPromedio}</span> /{" "}
                    <span className="text-emerald-700">{ej.speedMaximo}</span>
                  </td>
                  <td className="px-4 py-3 text-center font-mono text-xs font-bold text-purple-700">
                    {ej.indiceGodet}%
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="inline-block rounded-full bg-emerald-100 px-3 py-1 font-mono text-xs font-black text-emerald-800">
                      {ej.probabilidadActuarial}%
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {ej.ultimasActuaciones.length === 0 ? (
                      <span className="italic text-slate-400">
                        Debutante en BD (se guardará al procesar esta jornada)
                      </span>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {ej.ultimasActuaciones.slice(0, 3).map((act, i) => (
                          <div key={i} className="rounded bg-slate-100 px-2 py-1 text-[11px] text-slate-700">
                            <span className="font-bold">{act.fecha}</span> · {act.hipodromo} (C{act.carrera}) ·{" "}
                            <span className="font-bold text-blue-700">Llegó: {act.posicion ?? "-"}°</span> · Beyer:{" "}
                            <span className="font-mono font-bold">{act.beyer ?? "-"}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {modalAbierto && (
        <ModalAnalisisActuarialGodet onClose={() => setModalAbierto(false)} />
      )}
    </section>
=======
import { RutaProtegida } from "@/shared/components/ui/RutaProtegida";
import { ProyeccionesModule } from "@/features/inteligencia/components/ProyeccionesModule";

/**
 * INTELIGENCIA HÍPICA · PROYECCIONES
 *
 * La pantalla operativa que cruza la matriz de carreras del día con la
 * memoria histórica de cada ejemplar y calcula el RANKING DE PROBABILIDAD
 * ACTUARIAL. Desde ahí se abre la pizarra prospectiva Godet & Actuarial con
 * los datos reales de la carrera (no con los valores de ejemplo del modo
 * "previa").
 *
 * La ruta la declara el REGISTRO MAESTRO de capacidades
 * (`inteligencia_hipica:ruta_proyecciones`), así que el middleware y esta
 * misma página deciden con la MISMA fuente.
 */
export default function ProyeccionesPage() {
  return (
    <RutaProtegida>
      <div className="flex h-full w-full flex-col">
        <div className="border-b border-slate-200 bg-white px-6 py-4">
          <h1 className="text-xl font-black text-slate-900">Inteligencia Hípica · Proyecciones</h1>
          <p className="text-sm text-slate-500">
            Probabilidad actuarial por ejemplar: memoria histórica, Índice de Consistencia Godet, Beyer/Speed Rating,
            jinete y entrenador habituales · MICMAC/MACTOR, Bühlmann-Straub, Cox y Kelly Fraccional
          </p>
        </div>
        <div className="flex-1 overflow-auto bg-slate-50 p-6">
          <ProyeccionesModule />
        </div>
      </div>
    </RutaProtegida>
>>>>>>> c0aa4bfb0e0030e9dd95ad4d639ec42acd3ebfc3
  );
}