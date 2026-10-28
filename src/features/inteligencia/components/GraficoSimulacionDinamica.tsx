"use client";

import { useState, useMemo } from "react";
import {
  type ResultadoCarreraV4,
  type ResultadoEjemplarV4,
  type FactorPista,
  type EstiloCarrera,
  COLORES_GUALDRAPA,
} from "@/features/inteligencia/lib/analista-venezuela-v4";
import { DivisaStudSvg } from "@/features/inteligencia/components/DivisaStudSvg";
import { CamisaJockeySvg } from "@/features/inteligencia/components/CamisaJockeySvg";
import { SimuladorPistaCarrera2D } from "@/features/inteligencia/components/SimuladorPistaCarrera2D";

type Props = {
  resultado: ResultadoCarreraV4;
  factorPistaActual: FactorPista;
  onCambiarPista: (pista: FactorPista) => void;
  carrilActual: "RIEL" | "CENTRO" | "AFUERA";
  onCambiarCarril: (carril: "RIEL" | "CENTRO" | "AFUERA") => void;
  estiloActual: EstiloCarrera;
  onCambiarEstilo: (estilo: EstiloCarrera) => void;
  tendenciaActiva: boolean;
  onAplicarTendencia: () => void;
  onLimpiarTendencia: () => void;
};

export function GraficoSimulacionDinamica({
  resultado,
  factorPistaActual,
  onCambiarPista,
  carrilActual,
  onCambiarCarril,
  estiloActual,
  onCambiarEstilo,
  tendenciaActiva,
  onAplicarTendencia,
  onLimpiarTendencia,
}: Props) {
  const [ejemplarSeleccionado, setEjemplarSeleccionado] = useState<number>(() => {
    return resultado.ranking[0]?.ejemplar.numero ?? 1;
  });

  const [vistaGrafico, setVistaGrafico] = useState<"pista" | "probabilidad" | "radar" | "cuerpos">("pista");

  // Ordenar para el gráfico de barras por orden proyectado
  const ranking = useMemo(() => {
    return [...resultado.ranking].sort(
      (a, b) => a.ordenLlegadaProyectado - b.ordenLlegadaProyectado
    );
  }, [resultado.ranking]);

  const maxProb = useMemo(() => {
    return Math.max(...ranking.map((r) => r.probabilidadSMIC), 1);
  }, [ranking]);

  const maxScore = useMemo(() => {
    return Math.max(...ranking.map((r) => r.scoreGodetTotal), 1);
  }, [ranking]);

  const detalleEjemplar = useMemo(() => {
    return (
      ranking.find((r) => r.ejemplar.numero === ejemplarSeleccionado) ?? ranking[0]
    );
  }, [ranking, ejemplarSeleccionado]);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
      {/* Cabecera del Panel Gráfico */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-tr from-amber-500 to-yellow-400 text-slate-950 font-black text-sm shadow-xs">
            📊
          </span>
          <div>
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 flex items-center gap-2">
              <span>Simulación Prospectiva Dinámica en Vivo</span>
              <span className="rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 px-2 py-0.2 text-[9px] font-black animate-pulse">
                TIEMPO REAL
              </span>
            </h3>
            <p className="text-[11px] text-slate-500">
              Modifica las variables de pista y sesgo para observar la reacción inmediata de la curva SMIC y cuerpos de ventaja
            </p>
          </div>
        </div>

        {/* Pestañas de Vista Gráfica */}
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs font-bold">
          <button
            type="button"
            onClick={() => setVistaGrafico("pista")}
            className={`rounded-lg px-2.5 py-1 transition-all flex items-center gap-1.5 ${
              vistaGrafico === "pista"
                ? "bg-emerald-600 text-white shadow-xs font-black"
                : "text-slate-700 hover:text-slate-900 font-bold"
            }`}
          >
            <span>🏇</span>
            <span>Simulación en Pista</span>
          </button>
          <button
            type="button"
            onClick={() => setVistaGrafico("probabilidad")}
            className={`rounded-lg px-2.5 py-1 transition-all ${
              vistaGrafico === "probabilidad"
                ? "bg-white text-indigo-900 shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            📈 Probabilidad SMIC
          </button>
          <button
            type="button"
            onClick={() => setVistaGrafico("cuerpos")}
            className={`rounded-lg px-2.5 py-1 transition-all ${
              vistaGrafico === "cuerpos"
                ? "bg-white text-indigo-900 shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            🏁 Cuerpos & Ventaja
          </button>
          <button
            type="button"
            onClick={() => setVistaGrafico("radar")}
            className={`rounded-lg px-2.5 py-1 transition-all ${
              vistaGrafico === "radar"
                ? "bg-white text-indigo-900 shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            🎯 Radar de 22 Factores
          </button>
        </div>
      </div>

      {/* Barra de Ajuste de Variables Tácticas en Vivo */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 bg-slate-50/80 p-3 rounded-xl border border-slate-200/80 text-xs">
        {/* Factor de Pista */}
        <div>
          <label className="text-[10px] font-black uppercase text-slate-500 block mb-1">
            🌡️ Factor de Pista
          </label>
          <div className="flex gap-1">
            {(["NORMAL", "LIGERA", "PESADA"] as FactorPista[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => onCambiarPista(p)}
                className={`flex-1 py-1 rounded-lg text-[10px] font-black uppercase transition-all ${
                  factorPistaActual === p
                    ? p === "LIGERA"
                      ? "bg-amber-500 text-slate-950 font-black shadow-xs"
                      : p === "PESADA"
                      ? "bg-rose-600 text-white shadow-xs"
                      : "bg-slate-800 text-white shadow-xs"
                    : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-100"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Carril Dominante */}
        <div>
          <label className="text-[10px] font-black uppercase text-slate-500 block mb-1">
            🛣️ Carril de Carrera
          </label>
          <div className="flex gap-1">
            {(["RIEL", "CENTRO", "AFUERA"] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onCambiarCarril(c)}
                className={`flex-1 py-1 rounded-lg text-[10px] font-black uppercase transition-all ${
                  carrilActual === c
                    ? "bg-indigo-600 text-white shadow-xs"
                    : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-100"
                }`}
              >
                {c === "RIEL" ? "Riel 1-3" : c === "CENTRO" ? "Centro 4-6" : "Fuera 7+"}
              </button>
            ))}
          </div>
        </div>

        {/* Estilo Dominante */}
        <div>
          <label className="text-[10px] font-black uppercase text-slate-500 block mb-1">
            ⚡ Estilo Dominante
          </label>
          <div className="flex gap-1">
            {(["E1", "E2", "E3"] as EstiloCarrera[]).map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => onCambiarEstilo(e)}
                className={`flex-1 py-1 rounded-lg text-[10px] font-black uppercase transition-all ${
                  estiloActual === e
                    ? e === "E1"
                      ? "bg-rose-500 text-white shadow-xs"
                      : e === "E2"
                      ? "bg-blue-600 text-white shadow-xs"
                      : "bg-emerald-600 text-white shadow-xs"
                    : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-100"
                }`}
              >
                {e === "E1" ? "E1 Punta" : e === "E2" ? "E2 Stalker" : "E3 Cierre"}
              </button>
            ))}
          </div>
        </div>

        {/* Botón Tendencia de la Tarde */}
        <div className="flex items-end">
          {tendenciaActiva ? (
            <button
              type="button"
              onClick={onLimpiarTendencia}
              className="w-full py-1.5 px-2 rounded-lg bg-emerald-100 border border-emerald-300 text-emerald-900 font-black text-xs hover:bg-emerald-200 transition-all flex items-center justify-center gap-1.5"
            >
              <span>⚡ Tendencia Activa</span>
              <span className="text-[10px] text-emerald-700">✕ Quitar</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onAplicarTendencia}
              className="w-full py-1.5 px-2 rounded-lg bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 text-white font-black text-xs shadow-xs transition-all flex items-center justify-center gap-1"
            >
              <span>⚡ Aplicar Tendencia</span>
            </button>
          )}
        </div>
      </div>

      {/* ============================================================== */}
      {/* VISTA 0: SIMULACIÓN EN PISTA ISOMÉTRICA CON CABALLITO Y CAMISA */}
      {/* ============================================================== */}
      {vistaGrafico === "pista" && (
        <SimuladorPistaCarrera2D
          resultado={resultado}
          factorPistaActual={factorPistaActual}
          carrilActual={carrilActual}
          estiloActual={estiloActual}
          tendenciaActiva={tendenciaActiva}
        />
      )}

      {/* ============================================================== */}
      {/* VISTA 1: BARRAS DINÁMICAS DE PROBABILIDAD SMIC                  */}
      {/* ============================================================== */}
      {vistaGrafico === "probabilidad" && (
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between text-[11px] text-slate-500 font-bold px-1">
            <span>Ejemplar & Gualdrapa</span>
            <span>Probabilidad de Victoria SMIC (%) · Score Actuarial Godet</span>
          </div>

          <div className="space-y-2">
            {ranking.map((r) => {
              const num = r.ejemplar.numero;
              const gualdrapa = COLORES_GUALDRAPA[num] || {
                bg: "#3B82F6",
                text: "#FFFFFF",
                border: "#1D4ED8",
              };
              const porcentajeBarra = Math.min(100, (r.probabilidadSMIC / maxProb) * 100);
              const esFavorito = r.ordenLlegadaProyectado === 1;

              return (
                <div
                  key={num}
                  onClick={() => setEjemplarSeleccionado(num)}
                  className={`group relative rounded-xl border p-2.5 transition-all cursor-pointer ${
                    ejemplarSeleccionado === num
                      ? "border-amber-400 bg-amber-50/40 shadow-xs"
                      : "border-slate-200/80 bg-white hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3 text-xs">
                    {/* Ejemplar info */}
                    <div className="flex items-center gap-2.5 min-w-[180px]">
                      <span className="font-mono font-bold text-slate-400 text-xs w-4">
                        #{r.ordenLlegadaProyectado}
                      </span>
                      <span
                        style={{
                          backgroundColor: gualdrapa.bg,
                          color: gualdrapa.text,
                          borderColor: gualdrapa.border,
                        }}
                        className="inline-grid h-6 w-6 place-items-center rounded-md font-black text-xs border shadow-xs"
                      >
                        {num}
                      </span>
                      <DivisaStudSvg
                        numero={num}
                        divisaTexto={r.ejemplar.divisaTexto}
                        studNombre={r.ejemplar.stud}
                        className="h-6 w-6"
                      />
                      <div>
                        <span className="font-black text-slate-900 block uppercase leading-tight group-hover:text-amber-600 transition-colors">
                          {r.ejemplar.nombre}
                        </span>
                        <span className="text-[10px] text-slate-500">
                          {r.ejemplar.estilo} · {r.ejemplar.jinete}
                        </span>
                      </div>
                    </div>

                    {/* Badges especiales */}
                    <div className="hidden sm:flex items-center gap-1">
                      {r.esLinea5y6 && (
                        <span className="rounded bg-amber-500 text-slate-950 px-1.5 py-0.2 text-[9px] font-black uppercase">
                          👑 Línea Fija
                        </span>
                      )}
                      {r.esMorocha5y6 && !r.esLinea5y6 && (
                        <span className="rounded bg-blue-100 text-blue-900 border border-blue-300 px-1.5 py-0.2 text-[9px] font-black uppercase">
                          Morocha
                        </span>
                      )}
                      {r.favorecidoTendenciaTarde && (
                        <span className="rounded bg-emerald-100 text-emerald-800 border border-emerald-300 px-1.5 py-0.2 text-[9px] font-black uppercase">
                          ⚡ Tendencia
                        </span>
                      )}
                    </div>

                    {/* Números de Probabilidad y Score */}
                    <div className="flex items-center gap-3 font-mono text-right">
                      <span className="text-slate-500 text-[11px]">
                        Godet: <b className="text-slate-800">{r.scoreGodetTotal.toFixed(1)}</b>
                      </span>
                      <span className="text-sm font-black text-indigo-950 w-14 text-right">
                        {r.probabilidadSMIC.toFixed(1)}%
                      </span>
                    </div>
                  </div>

                  {/* Barra animada de Probabilidad */}
                  <div className="mt-2 h-2.5 w-full rounded-full bg-slate-100 overflow-hidden relative">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        esFavorito
                          ? "bg-gradient-to-r from-amber-500 to-yellow-400"
                          : r.esMorocha5y6
                          ? "bg-gradient-to-r from-blue-500 to-cyan-400"
                          : "bg-gradient-to-r from-slate-400 to-indigo-400"
                      }`}
                      style={{ width: `${Math.max(5, porcentajeBarra)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* VISTA 2: CUERPOS DE VENTAJA Y TREN DE CARRERA TEÓRICO           */}
      {/* ============================================================== */}
      {vistaGrafico === "cuerpos" && (
        <div className="space-y-3 pt-1">
          <div className="bg-slate-900 text-white p-4 rounded-xl space-y-3">
            <div className="flex items-center justify-between text-xs border-b border-slate-800 pb-2">
              <span className="font-black uppercase tracking-wider text-amber-400">
                🏁 Línea de Llegada Teórica y Separación en Cuerpos
              </span>
              <span className="text-[11px] text-slate-400">
                Distancia: <b>{resultado.distancia}m</b> · Hipódromo: <b>{resultado.hipodromo}</b>
              </span>
            </div>

            {/* Pista gráfica con caballos ubicados por cuerpos */}
            <div className="relative py-6 px-2 border-b border-slate-800/80">
              <div className="absolute right-0 top-0 bottom-0 w-1 bg-amber-400/80 dashed" />
              <div className="absolute right-2 top-1 text-[9px] font-black uppercase text-amber-400">
                Meta
              </div>

              <div className="space-y-3">
                {ranking.map((r, idx) => {
                  const num = r.ejemplar.numero;
                  const gualdrapa = COLORES_GUALDRAPA[num] || {
                    bg: "#3B82F6",
                    text: "#FFFFFF",
                    border: "#1D4ED8",
                  };
                  // Cuerpos de distancia desde el líder (0 a ~15 cuerpos)
                  const desfaseCuerpos = idx === 0 ? 0 : r.cuerposVentaja;
                  const margenDerecha = Math.min(85, desfaseCuerpos * 5.5);

                  return (
                    <div key={num} className="flex items-center justify-end relative h-7">
                      <div
                        className="absolute flex items-center gap-1.5 transition-all duration-500"
                        style={{ right: `${margenDerecha}%` }}
                      >
                        <span
                          style={{
                            backgroundColor: gualdrapa.bg,
                            color: gualdrapa.text,
                            borderColor: gualdrapa.border,
                          }}
                          className="grid h-6 w-6 place-items-center rounded-md font-black text-xs border shadow-xs"
                        >
                          {num}
                        </span>
                        <span className="text-[11px] font-bold text-white whitespace-nowrap bg-slate-800/90 px-1.5 py-0.5 rounded border border-slate-700">
                          {r.ejemplar.nombre} ({idx === 0 ? "PUNTA" : `-${r.cuerposVentaja.toFixed(1)} cpos`})
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <p className="text-[10px] text-slate-400 italic text-center">
              * La escala representa la separación teórica en cuerpos de ventaja (1 cuerpo ≈ 0.20s en 1200m).
            </p>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* VISTA 3: RADAR Y DESGLOSE DE 22 FACTORES POR EJEMPLAR          */}
      {/* ============================================================== */}
      {vistaGrafico === "radar" && detalleEjemplar && (
        <div className="space-y-3 pt-1">
          {/* Selector rápido del ejemplar para ver su radar */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {ranking.map((r) => {
              const num = r.ejemplar.numero;
              const gualdrapa = COLORES_GUALDRAPA[num] || { bg: "#3B82F6", text: "#FFFFFF" };
              const esActivo = ejemplarSeleccionado === num;
              return (
                <button
                  key={num}
                  type="button"
                  onClick={() => setEjemplarSeleccionado(num)}
                  style={{
                    backgroundColor: esActivo ? gualdrapa.bg : "#F1F5F9",
                    color: esActivo ? gualdrapa.text : "#334155",
                  }}
                  className={`px-3 py-1 rounded-lg text-xs font-black transition-all flex items-center gap-1.5 ${
                    esActivo ? "shadow-sm scale-102" : "hover:bg-slate-200"
                  }`}
                >
                  <span>#{num}</span>
                  <span className="truncate max-w-[100px]">{r.ejemplar.nombre}</span>
                </button>
              );
            })}
          </div>

          {/* Ficha Analítica del Ejemplar con los 5 Pilares Estructurales */}
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
              <div className="flex items-center gap-2">
                <DivisaStudSvg
                  numero={detalleEjemplar.ejemplar.numero}
                  divisaTexto={detalleEjemplar.ejemplar.divisaTexto}
                  studNombre={detalleEjemplar.ejemplar.stud}
                  className="h-8 w-8"
                />
                <div>
                  <h4 className="text-xs font-black uppercase text-slate-900">
                    {detalleEjemplar.ejemplar.nombre} (Puesto #{detalleEjemplar.ejemplar.numero})
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Jinete: <b>{detalleEjemplar.ejemplar.jinete}</b> ({detalleEjemplar.ejemplar.kilos}kg) · Entrenador: <b>{detalleEjemplar.ejemplar.entrenador}</b> · Stud: <b>{detalleEjemplar.ejemplar.stud || "—"}</b>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="rounded-lg bg-amber-500 text-slate-950 font-black px-2.5 py-1 text-xs font-mono">
                  Score Godet: {detalleEjemplar.scoreGodetTotal.toFixed(1)} pts
                </span>
                <span className="rounded-lg bg-indigo-950 text-white font-black px-2.5 py-1 text-xs font-mono">
                  SMIC: {detalleEjemplar.probabilidadSMIC.toFixed(1)}%
                </span>
              </div>
            </div>

            {/* Barras de los 5 Pilares de Fuerza */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              {/* Pilar 1: Velocidad y Speed Rating */}
              <div className="bg-white p-3 rounded-lg border border-slate-200 space-y-1.5">
                <div className="flex justify-between font-bold text-slate-700">
                  <span>🚀 1. Velocidad & Speed Rating TTC</span>
                  <span className="font-mono text-indigo-700">{detalleEjemplar.ejemplar.speedRatingTTC} / 100</span>
                </div>
                <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-600 rounded-full"
                    style={{ width: `${detalleEjemplar.ejemplar.speedRatingTTC}%` }}
                  />
                </div>
                <p className="text-[10px] text-slate-500">
                  Basado en tiempos tomatiempos INH y proyección de parciales en {resultado.distancia}m.
                </p>
              </div>

              {/* Pilar 2: Sinergia Jinete-Entrenador */}
              <div className="bg-white p-3 rounded-lg border border-slate-200 space-y-1.5">
                <div className="flex justify-between font-bold text-slate-700">
                  <span>🏇 2. Sinergia Jinete & Entrenador</span>
                  <span className="font-mono text-emerald-700">
                    {Math.round(detalleEjemplar.ejemplar.efectividadJineteEntrenador * 100)}% Efic.
                  </span>
                </div>
                <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-600 rounded-full"
                    style={{
                      width: `${Math.min(100, detalleEjemplar.ejemplar.efectividadJineteEntrenador * 250)}%`,
                    }}
                  />
                </div>
                <p className="text-[10px] text-slate-500">
                  Efectividad histórica de la yunta en pruebas de lote similar.
                </p>
              </div>

              {/* Pilar 3: Físico y Peso de Balanza */}
              <div className="bg-white p-3 rounded-lg border border-slate-200 space-y-1.5">
                <div className="flex justify-between font-bold text-slate-700">
                  <span>⚖️ 3. Físico & Balanza Óptima</span>
                  <span className="font-mono text-amber-700">
                    {detalleEjemplar.deltaPesoKg != null
                      ? `Δ ${detalleEjemplar.deltaPesoKg > 0 ? "+" : ""}${detalleEjemplar.deltaPesoKg} kg`
                      : "Sin Balanza en Vivo"}
                  </span>
                </div>
                <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      detalleEjemplar.bonoPesoOptimo
                        ? "bg-emerald-500"
                        : detalleEjemplar.alertaPeso
                        ? "bg-rose-500"
                        : "bg-amber-500"
                    }`}
                    style={{ width: "85%" }}
                  />
                </div>
                <p className="text-[10px] text-slate-500">
                  Peso óptimo ganador histórico: <b>{detalleEjemplar.ejemplar.pesoOptimoKg} kg</b>.
                </p>
              </div>

              {/* Pilar 4: Desempeño Táctico & Tramo Final */}
              <div className="bg-white p-3 rounded-lg border border-slate-200 space-y-1.5">
                <div className="flex justify-between font-bold text-slate-700">
                  <span>🏁 4. Remate & Tramo Final</span>
                  <span className="font-mono text-purple-700">
                    {detalleEjemplar.ejemplar.tendenciaTramoFinal}
                  </span>
                </div>
                <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-purple-600 rounded-full"
                    style={{
                      width:
                        detalleEjemplar.ejemplar.tendenciaTramoFinal === "ATROPELLA"
                          ? "90%"
                          : detalleEjemplar.ejemplar.tendenciaTramoFinal === "SE_MANTIENE"
                          ? "75%"
                          : "45%",
                    }}
                  />
                </div>
                <p className="text-[10px] text-slate-500">
                  Estilo: <b>{detalleEjemplar.ejemplar.estilo}</b> · Traqueo reciente: <b>{detalleEjemplar.ejemplar.ultimoTraqueo?.tiempo} ({detalleEjemplar.ejemplar.ultimoTraqueo?.remate})</b>.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
