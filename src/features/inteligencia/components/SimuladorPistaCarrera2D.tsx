"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import {
  type ResultadoCarreraV4,
  type FactorPista,
  type EstiloCarrera,
  COLORES_GUALDRAPA,
} from "@/features/inteligencia/lib/analista-venezuela-v4";
import {
  ANCHO_PISTA,
  CANT_GATERAS,
  ANCHO_GATERA,
  X_CENTRO_IZQ,
  X_CENTRO_DER,
  Y_CENTRO,
  LONG_RECTA,
  R_MEDIO,
  R_RIEL,
  R_EXTERIOR,
  LONG_SEMICIRCULO,
  X_META,
  DIST_SALIDA_CODO_A_META,
  X_MAX_CHUTE_ENFRENTE,
  X_MIN_CHUTE_RECTA_FINAL,
  obtenerHitoDistancia,
  calcularPosicionEnOvalo,
  calcularDinamicaSincronizadaCarrera,
  calcularCronometrajeYParcialesINH,
  obtenerHitosPistaCentral,
} from "@/features/inteligencia/lib/geometria-ovalo-rinconada";

// Re-exportamos para compatibilidad de tipos o utilidades si se requieren externamente
export {
  ANCHO_PISTA,
  CANT_GATERAS,
  ANCHO_GATERA,
  R_RIEL,
  R_EXTERIOR,
  LONG_SEMICIRCULO,
  X_META,
  DIST_SALIDA_CODO_A_META,
  obtenerHitoDistancia,
  calcularPosicionEnOvalo,
  calcularDinamicaSincronizadaCarrera,
  calcularCronometrajeYParcialesINH,
  obtenerHitosPistaCentral,
};

type Props = {
  resultado: ResultadoCarreraV4;
  factorPistaActual?: FactorPista;
  carrilActual?: "RIEL" | "CENTRO" | "AFUERA";
  estiloActual?: EstiloCarrera;
  tendenciaActiva?: boolean;
  className?: string;
};

type FaseCarrera = "PARTIDA" | "CODO" | "RECTA" | "META";

/**
 * ============================================================================
 * ÓVALO DE LA RINCONADA (CIRCUITO 1.800M)
 * CON PISTA CENTRAL DE NÚMEROS PERFECTAMENTE CENTRADA EN EL INFIELD
 * ============================================================================
 * 1. Chute de 1.600m (Enfrente, superior derecha):
 *    - Se extiende exactamente 50m más de la partida de 1.600m.
 *    - Salida de 1.600m y 1.400m en línea recta hacia el codo de 800m.
 *
 * 2. Chute de 800m (Recta Final, inferior izquierda):
 *    - Se extiende hacia la IZQUIERDA exactamente 50m más de la partida de 800m.
 *    - Salida de 800m en recta pura entrando por la izquierda hacia la sentencia.
 *
 * 3. Raya de Meta / Sentencia = Marca de 0m / 1.800m:
 *    - Ubicada en la recta final inferior en X = 720.
 *
 * 4. Pista Recta Central de Números en el Infield:
 *    - Perfectamente centrada horizontal y verticalmente en el centro del óvalo (X = 560, Y = 310).
 *    - Muestra ÚNICAMENTE los círculos/fichas con el NÚMERO (#1..#14) en su color oficial CLOTH.
 *    - Se mueven en riguroso simultáneo 1:1 con la distancia y avance de los caballos del óvalo.
 *
 * 5. Visualización del Óvalo Exterior:
 *    - Se removió toda la información superflua (sin punteros, sin textos de PP, etc.).
 *    - ÚNICAMENTE se ven los CÍRCULOS CONTENEDORES con su NÚMERO recorriendo la pista.
 * ============================================================================
 */

export const GATERAS_14 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] as const;

export function SimuladorPistaCarrera2D({
  resultado,
  className = "",
}: Props) {
  const [mostrarPista, setMostrarPista] = useState<boolean>(true);

  // Distancia oficial de la carrera
  const distanciaCarrera = useMemo(() => {
    const d = Number(resultado.distancia);
    return Number.isFinite(d) && d >= 800 && d <= 2400 ? d : 1400;
  }, [resultado.distancia]);

  const [progreso, setProgreso] = useState<number>(0);
  const [reproduciendo, setReproduciendo] = useState<boolean>(false);
  const [velocidad, setVelocidad] = useState<number>(1);
  const [caballoSeleccionado, setCaballoSeleccionado] = useState<number | null>(null);
  const [faseActiva, setFaseActiva] = useState<FaseCarrera>("PARTIDA");

  const requestRef = useRef<number | null>(null);
  const ultimoTiempoRef = useRef<number | null>(null);

  const ranking = useMemo(() => {
    return [...resultado.ranking].sort(
      (a, b) => a.ordenLlegadaProyectado - b.ordenLlegadaProyectado
    );
  }, [resultado.ranking]);

  useEffect(() => {
    if (caballoSeleccionado === null && ranking.length > 0) {
      setCaballoSeleccionado(ranking[0].ejemplar.numero);
    }
  }, [ranking, caballoSeleccionado]);

  useEffect(() => {
    setProgreso(0);
    setReproduciendo(false);
    setFaseActiva("PARTIDA");
  }, [resultado.carreraNumero, distanciaCarrera]);

  useEffect(() => {
    if (progreso < 15) setFaseActiva("PARTIDA");
    else if (progreso < 65) setFaseActiva("CODO");
    else if (progreso < 95) setFaseActiva("RECTA");
    else setFaseActiva("META");
  }, [progreso]);

  useEffect(() => {
    if (!reproduciendo) {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      ultimoTiempoRef.current = null;
      return;
    }

    const animar = (tiempoActual: number) => {
      if (ultimoTiempoRef.current === null) {
        ultimoTiempoRef.current = tiempoActual;
      }
      const deltaMs = tiempoActual - ultimoTiempoRef.current;
      ultimoTiempoRef.current = tiempoActual;

      setProgreso((prev) => {
        const incremento = (deltaMs / 1000) * (100 / 16) * velocidad;
        const nuevo = prev + incremento;
        if (nuevo >= 100) {
          setReproduciendo(false);
          return 100;
        }
        return nuevo;
      });

      requestRef.current = requestAnimationFrame(animar);
    };

    requestRef.current = requestAnimationFrame(animar);
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [reproduciendo, velocidad]);

  const saltarAFase = (fase: FaseCarrera) => {
    setReproduciendo(false);
    setFaseActiva(fase);
    if (fase === "PARTIDA") {
      setProgreso(0);
    } else if (fase === "CODO") {
      // Salto al codo (aprox 800m restantes de carrera)
      const progCodo = distanciaCarrera > 800 ? ((distanciaCarrera - 800) / distanciaCarrera) * 100 : 40;
      setProgreso(Math.max(15, Math.min(65, Number(progCodo.toFixed(1)))));
    } else if (fase === "RECTA") {
      // Salto a la recta final (aprox 300m restantes de carrera)
      const progRecta = distanciaCarrera > 300 ? ((distanciaCarrera - 300) / distanciaCarrera) * 100 : 80;
      setProgreso(Math.max(60, Math.min(90, Number(progRecta.toFixed(1)))));
    } else if (fase === "META") {
      setProgreso(100);
    }
  };

  const desfaseMetaPorEjemplar = useMemo(() => {
    return ranking.map((r, index) => {
      if (index === 0) return 0;
      return r.cuerposVentaja * 2.4; // 1 cuerpo ≈ 2.4 metros
    });
  }, [ranking]);

  // Posiciones calculadas en riguroso simultáneo 1:1 con sincronía total en distancias
  const posicionesCalculadas = useMemo(() => {
    const u = Math.max(0, Math.min(1, progreso / 100));

    // Dinámica sincronizada en tiempo real para todos los participantes
    const estadosDinamicos = calcularDinamicaSincronizadaCarrera(
      progreso,
      distanciaCarrera,
      ranking.map((r) => ({
        numero: r.ejemplar.numero,
        estilo: r.ejemplar.estilo,
        ordenLlegadaProyectado: r.ordenLlegadaProyectado,
        cuerposVentaja: r.cuerposVentaja,
      }))
    );

    const mapaEstados = new Map(estadosDinamicos.map((e) => [e.numero, e]));

    return ranking.map((item, index) => {
      const { ejemplar, ordenLlegadaProyectado, favorecidoTendenciaTarde } = item;
      const estilo = ejemplar.estilo;
      const puertaSalida = Math.max(
        1,
        Math.min(14, ejemplar.puestoPista || (ejemplar as unknown as { pp?: number }).pp || ejemplar.numero)
      );

      const lambdaPartida = (puertaSalida - 0.5) / 14;

      let lambdaObjetivoRiel = 0.16;
      if (estilo === "E1") lambdaObjetivoRiel = 0.14;
      else if (estilo === "E2") lambdaObjetivoRiel = 0.32;
      else lambdaObjetivoRiel = 0.52;

      let lambdaActual = lambdaPartida;
      if (u <= 0) {
        lambdaActual = lambdaPartida;
      } else if (u < 0.25) {
        const tCierre = u / 0.25;
        lambdaActual = lambdaPartida + tCierre * (lambdaObjetivoRiel - lambdaPartida);
      } else if (u < 0.75) {
        lambdaActual = lambdaObjetivoRiel;
      } else {
        const tMeta = (u - 0.75) / 0.25;
        const lambdaAbanicoMeta = 0.12 + (index / Math.max(1, ranking.length - 1)) * 0.76;
        lambdaActual = lambdaObjetivoRiel * (1 - tMeta) + lambdaAbanicoMeta * tMeta;
      }

      const estado = mapaEstados.get(ejemplar.numero)!;
      const pos = calcularPosicionEnOvalo(estado.distanciaRestante, lambdaActual, distanciaCarrera);

      return {
        item,
        puertaSalida,
        distanciaRestante: estado.distanciaRestante,
        distanciaRecorrida: estado.distanciaRecorrida,
        porcentajeAvanceCentral: estado.porcentajeAvanceCentral,
        posXCentral: estado.posXCentral,
        esLiderActual: estado.esLiderActual,
        x: pos.x,
        y: pos.y,
        anguloDeg: pos.anguloDeg,
        tramo: pos.tramo,
        carrilIndex: index,
        esGanador: ordenLlegadaProyectado === 1,
        esPlacero: ordenLlegadaProyectado <= 3,
        favorecidoTendenciaTarde,
      };
    });
  }, [ranking, progreso, distanciaCarrera]);

  // Ejemplar que actualmente va liderando la carrera en tiempo real (menor distancia restante a meta)
  const liderActual = useMemo(() => {
    return posicionesCalculadas.find((p) => p.esLiderActual) ?? posicionesCalculadas[0] ?? null;
  }, [posicionesCalculadas]);

  // Hitos métricos de distancia en la Pista Central (cada 100m, con parciales cada 400m)
  const hitosPistaCentral = useMemo(() => {
    return obtenerHitosPistaCentral(distanciaCarrera);
  }, [distanciaCarrera]);

  // Cronometraje y parciales oficiales simulados INH (cada 400m y remate final)
  const cronometrajeINH = useMemo(() => {
    const distLider = liderActual?.distanciaRecorrida ?? 0;
    const srGanador = ranking[0]?.ejemplar.speedRatingTTC ?? 85;
    return calcularCronometrajeYParcialesINH(distanciaCarrera, distLider, srGanador);
  }, [distanciaCarrera, liderActual?.distanciaRecorrida, ranking]);

  const partidorEnOvalo = useMemo(() => {
    return GATERAS_14.map((puerta) => {
      const lambdaGatera = (puerta - 0.5) / 14;
      const pos = calcularPosicionEnOvalo(distanciaCarrera, lambdaGatera, distanciaCarrera);
      return { puerta, lambdaGatera, ...pos };
    });
  }, [distanciaCarrera]);

  const extremosPartidor = useMemo(() => {
    const riel = calcularPosicionEnOvalo(distanciaCarrera, 0, distanciaCarrera);
    const exterior = calcularPosicionEnOvalo(distanciaCarrera, 1, distanciaCarrera);
    return { riel, exterior };
  }, [distanciaCarrera]);

  // Hitos cada 100 metros en el óvalo oficial (0m a 1.800m)
  // Las rayas que marcan las distancias son estrictamente rectas entre baranda interior y baranda exterior
  const hitosCada100m = useMemo(() => {
    const hitos: Array<{
      metro: number;
      posRiel: { x: number; y: number };
      posExt: { x: number; y: number };
      posLabel: { x: number; y: number };
      esHitoMayor: boolean;
    }> = [];
    for (let m = 0; m <= 1800; m += 100) {
      const hito = obtenerHitoDistancia(m);
      const esHitoMayor = m % 200 === 0;
      hitos.push({
        metro: m,
        posRiel: hito.posRiel,
        posExt: hito.posExt,
        posLabel: hito.posLabel,
        esHitoMayor,
      });
    }
    return hitos;
  }, []);

  const caballoActivo = ranking.find((r) => r.ejemplar.numero === caballoSeleccionado) ?? ranking[0];

  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3.5 ${className}`}>
      {/* 1. CABECERA CON ESTADO DE PISTA Y CONTROLES */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-tr from-amber-500 to-yellow-400 text-slate-950 font-black text-xl shadow-sm">
            🏟️
          </span>
          <div>
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 flex items-center gap-2">
              <span>Óvalo La Rinconada (1.800M) + Pista Central de Números</span>
              <span className="rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 px-2 py-0.2 text-[9px] font-black">
                HITOS 100M · CHUTES RECORTADOS +50M · {distanciaCarrera}M
              </span>
            </h3>
            <p className="text-[11px] text-slate-500">
              Circuito oficial de 1.800m con Chute de 1.600m (enfrente), Chute de 800m (izquierda), hitos cada 100m y pista recta central centrada en el infield.
            </p>
          </div>
        </div>

        {/* Controles de visualización y fases */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setMostrarPista(!mostrarPista)}
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 transition-colors"
          >
            {mostrarPista ? "👁️ Ocultar Pista" : "👁️ Mostrar Pista"}
          </button>

          {mostrarPista && (
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs font-bold border border-slate-200">
              <button
                type="button"
                onClick={() => setReproduciendo(!reproduciendo)}
                className={`px-3 py-1 rounded-lg text-white font-black transition-all flex items-center gap-1.5 ${
                  reproduciendo ? "bg-rose-600 hover:bg-rose-500" : "bg-emerald-600 hover:bg-emerald-500"
                }`}
              >
                <span>{reproduciendo ? "⏸️ Pausar" : "▶️ Iniciar Simulación"}</span>
              </button>

              <button
                type="button"
                onClick={() => saltarAFase("PARTIDA")}
                className={`px-2.5 py-1 rounded-lg transition-all ${
                  faseActiva === "PARTIDA" ? "bg-white text-indigo-900 shadow-xs" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                🚪 Partida
              </button>
              <button
                type="button"
                onClick={() => saltarAFase("CODO")}
                className={`px-2.5 py-1 rounded-lg transition-all ${
                  faseActiva === "CODO" ? "bg-white text-indigo-900 shadow-xs" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                🔄 Codo (800m)
              </button>
              <button
                type="button"
                onClick={() => saltarAFase("RECTA")}
                className={`px-2.5 py-1 rounded-lg transition-all ${
                  faseActiva === "RECTA" ? "bg-white text-indigo-900 shadow-xs" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                🔥 Recta (200m)
              </button>
              <button
                type="button"
                onClick={() => saltarAFase("META")}
                className={`px-2.5 py-1 rounded-lg transition-all ${
                  faseActiva === "META" ? "bg-emerald-600 text-white shadow-xs" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                🏆 Meta Fotofinish
              </button>

              {/* Velocidad */}
              <div className="ml-1 flex items-center gap-1 border-l border-slate-300 pl-1.5">
                {[1, 1.5, 2].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setVelocidad(v)}
                    className={`rounded px-1.5 py-0.5 text-[10px] font-mono font-bold ${
                      velocidad === v ? "bg-slate-800 text-amber-300" : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    {v}x
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 1.1 PANEL DE CRONOMETRAJE Y PARCIALES OFICIALES INH (CADA 400M + REMATE) */}
      {mostrarPista && (
        <div className="rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-white shadow-md">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            {/* Reloj Principal / Cronómetro Digital en Vivo */}
            <div className="flex items-center gap-2.5 bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-800 shadow-inner">
              <span className="text-base">⏱️</span>
              <div>
                <div className="text-[9px] uppercase tracking-wider font-bold text-slate-400">
                  Cronómetro en Vivo
                </div>
                <div className="font-mono text-base font-black text-amber-400 tracking-wider flex items-baseline gap-1">
                  <span>{cronometrajeINH.cronometroDigital}</span>
                  <span className="text-xs text-amber-300 font-bold">
                    ({cronometrajeINH.tiempoTranscurridoQuintos})
                  </span>
                </div>
              </div>
            </div>

            {/* Badges de Parciales cada 400 Metros */}
            <div className="flex flex-wrap items-center gap-1.5">
              {cronometrajeINH.parciales400m.map((parcial, idx) => (
                <div
                  key={parcial.id}
                  className={`flex flex-col items-center justify-center px-2.5 py-1 rounded-lg border font-mono transition-all ${
                    parcial.alcanzado
                      ? "bg-emerald-950/70 border-emerald-500/60 text-emerald-300 shadow-xs ring-1 ring-emerald-500/30"
                      : "bg-slate-900/60 border-slate-800 text-slate-500"
                  }`}
                >
                  <span className="text-[8.5px] uppercase font-bold text-slate-400">
                    {idx + 1}° P. ({parcial.etiquetaCorta})
                  </span>
                  <span className={`text-xs font-black ${parcial.alcanzado ? "text-emerald-300" : "text-slate-600"}`}>
                    {parcial.tiempoActualVisible}
                  </span>
                  <span className="text-[8px] text-slate-500">
                    {parcial.alcanzado ? parcial.tiempoDecimal : `${parcial.distanciaMetros}m`}
                  </span>
                </div>
              ))}

              {/* Remate de los últimos metros (Diferencia de metros) */}
              {cronometrajeINH.remateFinal && (
                <div
                  className={`flex flex-col items-center justify-center px-2.5 py-1 rounded-lg border font-mono transition-all ${
                    cronometrajeINH.remateFinal.alcanzado
                      ? "bg-amber-950/70 border-amber-500/70 text-amber-300 shadow-xs ring-1 ring-amber-500/30"
                      : "bg-slate-900/60 border-slate-800 text-slate-500"
                  }`}
                >
                  <span className="text-[8.5px] uppercase font-bold text-amber-400/90">
                    ⚡ Remate ({cronometrajeINH.remateFinal.metrosRemate}m)
                  </span>
                  <span
                    className={`text-xs font-black ${
                      cronometrajeINH.remateFinal.alcanzado ? "text-amber-300" : "text-slate-600"
                    }`}
                  >
                    {cronometrajeINH.remateFinal.alcanzado
                      ? cronometrajeINH.remateFinal.tiempoRemateQuintos
                      : '--"--'}
                  </span>
                  <span className="text-[8px] text-slate-500">
                    {cronometrajeINH.remateFinal.alcanzado
                      ? cronometrajeINH.remateFinal.tiempoRemateDecimal
                      : `Últimos ${cronometrajeINH.remateFinal.metrosRemate}m`}
                  </span>
                </div>
              )}

              {/* Tiempo Final Total (Meta) */}
              <div
                className={`flex flex-col items-center justify-center px-2.5 py-1 rounded-lg border font-mono transition-all ${
                  cronometrajeINH.carreraFinalizada
                    ? "bg-rose-950/70 border-rose-500/70 text-rose-200 shadow-xs ring-1 ring-rose-500/30"
                    : "bg-slate-900/60 border-slate-800 text-slate-500"
                }`}
              >
                <span className="text-[8.5px] uppercase font-bold text-rose-400">
                  🏁 Final ({distanciaCarrera}m)
                </span>
                <span
                  className={`text-xs font-black ${
                    cronometrajeINH.carreraFinalizada ? "text-rose-200" : "text-slate-600"
                  }`}
                >
                  {cronometrajeINH.carreraFinalizada ? cronometrajeINH.tiempoFinalTotalQuintos : '--"--'}
                </span>
                <span className="text-[8px] text-slate-500">
                  {cronometrajeINH.carreraFinalizada
                    ? `${cronometrajeINH.tiempoFinalTotalSegundos.toFixed(1)}s`
                    : "Oficial"}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. PISTA DE CARRERAS: ÓVALO + CHUTES RECORTADOS (+50M) + PISTA RECTA CENTRAL PERFECTAMENTE EN EL CENTRO */}
      {mostrarPista && (
        <div className="relative overflow-hidden rounded-2xl border-2 border-slate-700 bg-slate-950 p-2 shadow-inner select-none">
          <div className="relative w-full aspect-[16/7.5] max-h-[660px] rounded-xl overflow-hidden shadow-2xl bg-gradient-to-b from-emerald-950 via-slate-900 to-emerald-950">
            <svg
              viewBox="-160 0 1440 620"
              className="w-full h-full object-contain"
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                {/* Textura de Arena de La Rinconada */}
                <pattern id="arenaPatternLR3" width="36" height="36" patternUnits="userSpaceOnUse">
                  <rect width="36" height="36" fill="#854D0E" />
                  <circle cx="8" cy="8" r="2.2" fill="#A16207" opacity="0.8" />
                  <circle cx="26" cy="18" r="2.0" fill="#713F12" opacity="0.85" />
                  <circle cx="16" cy="30" r="1.5" fill="#EAB308" opacity="0.6" />
                </pattern>

                <filter id="circuloShadowLR3" x="-30%" y="-30%" width="160%" height="160%">
                  <feDropShadow dx="1" dy="4" stdDeviation="3" floodOpacity="0.8" floodColor="#000" />
                </filter>
              </defs>

              {/* FONDO EXTERIOR */}
              <rect x="-160" y="0" width="1440" height="620" fill="#14532D" />
              <rect x="-150" y="8" width="1420" height="604" rx="36" fill="#166534" stroke="#15803D" strokeWidth="2.5" />

              {/* TRIBUNA MONUMENTAL */}
              <rect x="460" y="565" width="520" height="26" rx="6" fill="#0F172A" stroke="#334155" strokeWidth="1.5" />
              <text x="720" y="582" textAnchor="middle" fill="#94A3B8" fontSize="10.5" fontWeight="900" letterSpacing="2">
                TRIBUNA MONUMENTAL · HIPÓDROMO LA RINCONADA
              </text>

              {/* ------------------------------------------------------------- */}
              {/* TRAZADO DE LA PISTA: ÓVALO DE ARENA DE 1.800M                 */}
              {/* ------------------------------------------------------------- */}
              <path
                d={`
                  M ${X_CENTRO_IZQ} ${Y_CENTRO - R_EXTERIOR}
                  L ${X_CENTRO_DER} ${Y_CENTRO - R_EXTERIOR}
                  A ${R_EXTERIOR} ${R_EXTERIOR} 0 0 1 ${X_CENTRO_DER} ${Y_CENTRO + R_EXTERIOR}
                  L ${X_CENTRO_IZQ} ${Y_CENTRO + R_EXTERIOR}
                  A ${R_EXTERIOR} ${R_EXTERIOR} 0 0 1 ${X_CENTRO_IZQ} ${Y_CENTRO - R_EXTERIOR}
                  Z
                `}
                fill="url(#arenaPatternLR3)"
                stroke="#B45309"
                strokeWidth="2.5"
              />

              {/* ------------------------------------------------------------- */}
              {/* CHUTE 1: EXTENSIÓN DE 1.600M RECORTADA A SOLO +50M DE SALIDA   */}
              {/* ------------------------------------------------------------- */}
              <rect
                x={X_CENTRO_DER}
                y={Y_CENTRO - R_EXTERIOR}
                width={X_MAX_CHUTE_ENFRENTE - X_CENTRO_DER}
                height={ANCHO_PISTA}
                fill="url(#arenaPatternLR3)"
                stroke="#B45309"
                strokeWidth="2.5"
              />
              <line
                x1={X_MAX_CHUTE_ENFRENTE}
                y1={Y_CENTRO - R_EXTERIOR}
                x2={X_MAX_CHUTE_ENFRENTE}
                y2={Y_CENTRO - R_RIEL}
                stroke="#FFFFFF"
                strokeWidth="4"
              />
              <line
                x1={X_CENTRO_DER}
                y1={Y_CENTRO - R_EXTERIOR}
                x2={X_MAX_CHUTE_ENFRENTE}
                y2={Y_CENTRO - R_EXTERIOR}
                stroke="#FFFFFF"
                strokeWidth="3.5"
              />
              <line
                x1={X_CENTRO_DER}
                y1={Y_CENTRO - R_RIEL}
                x2={X_MAX_CHUTE_ENFRENTE}
                y2={Y_CENTRO - R_RIEL}
                stroke="#FFFFFF"
                strokeWidth="3.5"
              />
              {/* Letrero Chute 1.600m */}
              <g>
                <rect x={X_CENTRO_DER + 30} y={Y_CENTRO - R_EXTERIOR - 24} width="320" height="18" rx="4" fill="#0F172A" stroke="#38BDF8" strokeWidth="1.2" />
                <text x={X_CENTRO_DER + 190} y={Y_CENTRO - R_EXTERIOR - 11} textAnchor="middle" fill="#38BDF8" fontSize="9" fontWeight="900" letterSpacing="0.8">
                  🚩 CHUTE DE ENFRENTE · SALIDA 1.400M & 1.600M
                </text>
              </g>

              {/* ------------------------------------------------------------- */}
              {/* CHUTE 2: EXTENSIÓN DE 800M RECORTADA A SOLO +50M (HACIA LA IZQ) */}
              {/* ------------------------------------------------------------- */}
              <rect
                x={X_MIN_CHUTE_RECTA_FINAL}
                y={Y_CENTRO + R_RIEL}
                width={X_CENTRO_IZQ - X_MIN_CHUTE_RECTA_FINAL}
                height={ANCHO_PISTA}
                fill="url(#arenaPatternLR3)"
                stroke="#B45309"
                strokeWidth="2.5"
              />
              <line
                x1={X_MIN_CHUTE_RECTA_FINAL}
                y1={Y_CENTRO + R_RIEL}
                x2={X_MIN_CHUTE_RECTA_FINAL}
                y2={Y_CENTRO + R_EXTERIOR}
                stroke="#FFFFFF"
                strokeWidth="4"
              />
              <line
                x1={X_MIN_CHUTE_RECTA_FINAL}
                y1={Y_CENTRO + R_RIEL}
                x2={X_CENTRO_IZQ}
                y2={Y_CENTRO + R_RIEL}
                stroke="#FFFFFF"
                strokeWidth="3.5"
              />
              <line
                x1={X_MIN_CHUTE_RECTA_FINAL}
                y1={Y_CENTRO + R_EXTERIOR}
                x2={X_CENTRO_IZQ}
                y2={Y_CENTRO + R_EXTERIOR}
                stroke="#FFFFFF"
                strokeWidth="3.5"
              />
              {/* Letrero Chute 800m a la izquierda */}
              <g>
                <rect x={X_MIN_CHUTE_RECTA_FINAL + 10} y={Y_CENTRO + R_EXTERIOR + 6} width="290" height="18" rx="4" fill="#0F172A" stroke="#F59E0B" strokeWidth="1.2" />
                <text x={X_MIN_CHUTE_RECTA_FINAL + 155} y={Y_CENTRO + R_EXTERIOR + 19} textAnchor="middle" fill="#F59E0B" fontSize="9" fontWeight="900" letterSpacing="0.8">
                  🚩 CHUTE RECTA FINAL (IZQ) · SALIDA 800M
                </text>
              </g>

              {/* BARANDA EXTERIOR DEL ÓVALO */}
              <path
                d={`
                  M ${X_CENTRO_IZQ} ${Y_CENTRO - R_EXTERIOR}
                  L ${X_CENTRO_DER} ${Y_CENTRO - R_EXTERIOR}
                  A ${R_EXTERIOR} ${R_EXTERIOR} 0 0 1 ${X_CENTRO_DER} ${Y_CENTRO + R_EXTERIOR}
                  L ${X_CENTRO_IZQ} ${Y_CENTRO + R_EXTERIOR}
                  A ${R_EXTERIOR} ${R_EXTERIOR} 0 0 1 ${X_CENTRO_IZQ} ${Y_CENTRO - R_EXTERIOR}
                `}
                fill="none"
                stroke="#FFFFFF"
                strokeWidth="3.5"
                opacity="0.95"
              />

              {/* LÍNEA GUÍA DE MEDIA PISTA */}
              <path
                d={`
                  M ${X_CENTRO_IZQ} ${Y_CENTRO - R_MEDIO}
                  L ${X_CENTRO_DER} ${Y_CENTRO - R_MEDIO}
                  A ${R_MEDIO} ${R_MEDIO} 0 0 1 ${X_CENTRO_DER} ${Y_CENTRO + R_MEDIO}
                  L ${X_CENTRO_IZQ} ${Y_CENTRO + R_MEDIO}
                  A ${R_MEDIO} ${R_MEDIO} 0 0 1 ${X_CENTRO_IZQ} ${Y_CENTRO - R_MEDIO}
                `}
                fill="none"
                stroke="#FFFFFF"
                strokeWidth="1.2"
                strokeDasharray="6 6"
                opacity="0.35"
              />

              {/* INFIELD / GRAMA CENTRAL */}
              <path
                d={`
                  M ${X_CENTRO_IZQ} ${Y_CENTRO - R_RIEL}
                  L ${X_CENTRO_DER} ${Y_CENTRO - R_RIEL}
                  A ${R_RIEL} ${R_RIEL} 0 0 1 ${X_CENTRO_DER} ${Y_CENTRO + R_RIEL}
                  L ${X_CENTRO_IZQ} ${Y_CENTRO + R_RIEL}
                  A ${R_RIEL} ${R_RIEL} 0 0 1 ${X_CENTRO_IZQ} ${Y_CENTRO - R_RIEL}
                  Z
                `}
                fill="#15803D"
              />

              {/* BARANDA INTERIOR (EL RIEL BLANCO) */}
              <path
                d={`
                  M ${X_CENTRO_IZQ} ${Y_CENTRO - R_RIEL}
                  L ${X_CENTRO_DER} ${Y_CENTRO - R_RIEL}
                  A ${R_RIEL} ${R_RIEL} 0 0 1 ${X_CENTRO_DER} ${Y_CENTRO + R_RIEL}
                  L ${X_CENTRO_IZQ} ${Y_CENTRO + R_RIEL}
                  A ${R_RIEL} ${R_RIEL} 0 0 1 ${X_CENTRO_IZQ} ${Y_CENTRO - R_RIEL}
                `}
                fill="none"
                stroke="#FFFFFF"
                strokeWidth="4"
              />

              {/* ------------------------------------------------------------- */}
              {/* HITOS CADA 100 METROS A LO LARGO DE TODO EL CIRCUITO (0 A 1800M) */}
              {/* RAYAS ESTRICTAMENTE RECTAS ENTRE BARANDA INTERIOR Y EXTERIOR   */}
              {/* ------------------------------------------------------------- */}
              {hitosCada100m.map(({ metro, posRiel, posExt, posLabel, esHitoMayor }) => {
                if (metro === 0 || metro === 1800) return null;
                return (
                  <g key={`hito-${metro}`} opacity={esHitoMayor ? 0.95 : 0.65}>
                    {/* Raya recta perpendicular entre baranda interior y baranda exterior */}
                    <line
                      x1={posRiel.x}
                      y1={posRiel.y}
                      x2={posExt.x}
                      y2={posExt.y}
                      stroke={esHitoMayor ? "#FACC15" : "#FFFFFF"}
                      strokeWidth={esHitoMayor ? 2.5 : 1.2}
                      strokeDasharray={esHitoMayor ? "none" : "3 3"}
                    />
                    {/* Puntos en ambas barandas para referencia milimétrica */}
                    <circle cx={posRiel.x} cy={posRiel.y} r={esHitoMayor ? 2.5 : 1.5} fill={esHitoMayor ? "#FACC15" : "#FFFFFF"} />
                    <circle cx={posExt.x} cy={posExt.y} r={esHitoMayor ? 3.5 : 2} fill={esHitoMayor ? "#FACC15" : "#FFFFFF"} />
                    {esHitoMayor && (
                      <text
                        x={posLabel.x}
                        y={posLabel.y}
                        textAnchor="middle"
                        fill="#FEF08A"
                        fontSize="9"
                        fontWeight="900"
                        className="font-mono"
                      >
                        {metro}m
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Hitos en el Chute de Enfrente (1400m y 1600m) - Rayas rectas entre barandas */}
              <g opacity="0.95">
                <line
                  x1={X_CENTRO_DER + 200}
                  y1={Y_CENTRO - R_RIEL}
                  x2={X_CENTRO_DER + 200}
                  y2={Y_CENTRO - R_EXTERIOR}
                  stroke="#FACC15"
                  strokeWidth="2.5"
                />
                <circle cx={X_CENTRO_DER + 200} cy={Y_CENTRO - R_RIEL} r="2.5" fill="#FACC15" />
                <circle cx={X_CENTRO_DER + 200} cy={Y_CENTRO - R_EXTERIOR} r="3.5" fill="#FACC15" />
                <text x={X_CENTRO_DER + 200} y={Y_CENTRO - R_EXTERIOR - 8} textAnchor="middle" fill="#FEF08A" fontSize="9.5" fontWeight="900">
                  1.400M (CHUTE)
                </text>

                <line
                  x1={X_CENTRO_DER + 400}
                  y1={Y_CENTRO - R_RIEL}
                  x2={X_CENTRO_DER + 400}
                  y2={Y_CENTRO - R_EXTERIOR}
                  stroke="#FACC15"
                  strokeWidth="2.5"
                />
                <circle cx={X_CENTRO_DER + 400} cy={Y_CENTRO - R_RIEL} r="2.5" fill="#FACC15" />
                <circle cx={X_CENTRO_DER + 400} cy={Y_CENTRO - R_EXTERIOR} r="3.5" fill="#FACC15" />
                <text x={X_CENTRO_DER + 400} y={Y_CENTRO - R_EXTERIOR - 8} textAnchor="middle" fill="#FEF08A" fontSize="9.5" fontWeight="900">
                  1.600M (CHUTE)
                </text>
              </g>

              {/* Hito de 800m en el Chute de Recta Final (Izquierda) - Raya recta entre barandas */}
              <g opacity="0.95">
                <line
                  x1={X_META - 800}
                  y1={Y_CENTRO + R_RIEL}
                  x2={X_META - 800}
                  y2={Y_CENTRO + R_EXTERIOR}
                  stroke="#FACC15"
                  strokeWidth="2.5"
                />
                <circle cx={X_META - 800} cy={Y_CENTRO + R_RIEL} r="2.5" fill="#FACC15" />
                <circle cx={X_META - 800} cy={Y_CENTRO + R_EXTERIOR} r="3.5" fill="#FACC15" />
                <text x={X_META - 800} y={Y_CENTRO + R_EXTERIOR + 16} textAnchor="middle" fill="#FEF08A" fontSize="9.5" fontWeight="900">
                  800M (CHUTE)
                </text>
              </g>

              {/* RAYA DE LLEGADA = SENTENCIA / MARCA DE 1.800M (RECTA FINAL X = 720) */}
              <g id="lineaMetaSentencia">
                <line
                  x1={X_META}
                  y1={Y_CENTRO + R_RIEL - 4}
                  x2={X_META}
                  y2={Y_CENTRO + R_EXTERIOR + 4}
                  stroke="#EF4444"
                  strokeWidth="5"
                />
                <line
                  x1={X_META}
                  y1={Y_CENTRO + R_RIEL - 4}
                  x2={X_META}
                  y2={Y_CENTRO + R_EXTERIOR + 4}
                  stroke="#FFFFFF"
                  strokeWidth="2.5"
                  strokeDasharray="6 6"
                />
                <rect x={X_META - 38} y={Y_CENTRO + R_EXTERIOR + 5} width="76" height="20" rx="4" fill="#DC2626" stroke="#FFFFFF" strokeWidth="1.5" />
                <text x={X_META} y={Y_CENTRO + R_EXTERIOR + 19} textAnchor="middle" fill="#FFFFFF" fontSize="9.5" fontWeight="900">
                  META · 1.800M 🏁
                </text>
              </g>

              {/* ============================================================== */}
              {/* 3. PISTA RECTA CENTRAL DE NÚMEROS PERFECTAMENTE EN EL CENTRO    */}
              {/* Centro exacto del óvalo: X = 560, Y = 310. Ancho = 560, Alto = 200 */}
              {/* translate(560 - 560/2, 310 - 200/2) = translate(280, 210)       */}
              {/* ============================================================== */}
              <g transform="translate(280, 210)">
                {/* Marco de la Pista Central de Números */}
                <rect
                  x="0"
                  y="0"
                  width="560"
                  height="200"
                  rx="14"
                  fill="#0B132B"
                  stroke="#1E293B"
                  strokeWidth="2"
                  className="filter drop-shadow-xl"
                />

                {/* Barra de título con Cronómetro Digital en el Infield */}
                <rect x="0" y="0" width="560" height="26" rx="14" fill="#0F172A" />
                <text x="14" y="17" fill="#FACC15" fontSize="9.5" fontWeight="900" letterSpacing="0.05em">
                  ⚡ PISTA RECTA CENTRAL
                </text>
                <text x="280" y="17" textAnchor="middle" fill="#38BDF8" fontSize="10" fontWeight="900" fontFamily="monospace">
                  ⏱️ {cronometrajeINH.cronometroDigital} ({cronometrajeINH.tiempoTranscurridoQuintos})
                </text>
                <text x="546" y="17" textAnchor="end" fill="#94A3B8" fontSize="8.5" fontWeight="bold">
                  {liderActual
                    ? `👑 #${liderActual.item.ejemplar.numero} · RESTAN: ${liderActual.distanciaRestante.toFixed(0)}M`
                    : `PP ${distanciaCarrera}M`}
                </text>

                {/* ------------------------------------------------------------- */}
                {/* HITOS DE DISTANCIA CADA 100M Y PARCIALES CADA 400M EN PISTA   */}
                {/* ------------------------------------------------------------- */}
                {/* Zona de Remate de los últimos metros (resaltada al fondo) */}
                {cronometrajeINH.remateFinal && (() => {
                  const xInicioRemate =
                    35 + ((distanciaCarrera - cronometrajeINH.remateFinal.metrosRemate) / distanciaCarrera) * 480;
                  const anchoRemate = 515 - xInicioRemate;
                  return (
                    <g key="zona-remate-bg" opacity="0.32">
                      <rect
                        x={xInicioRemate}
                        y="28"
                        width={anchoRemate}
                        height="167"
                        fill="#78350F"
                        stroke="#F59E0B"
                        strokeWidth="1.2"
                        strokeDasharray="4 2"
                      />
                      <text
                        x={xInicioRemate + anchoRemate / 2}
                        y="40"
                        textAnchor="middle"
                        fill="#FDE68A"
                        fontSize="7.5"
                        fontWeight="900"
                        letterSpacing="0.06em"
                      >
                        ⚡ REMATE {cronometrajeINH.remateFinal.metrosRemate}M
                      </text>
                    </g>
                  );
                })()}

                {/* Líneas verticales de hitos métricos a lo largo de toda la pista */}
                {hitosPistaCentral.map((h) => {
                  if (h.distanciaRestante === 0) {
                    // Disco de META
                    return (
                      <g key="hito-meta">
                        <line x1="515" y1="28" x2="515" y2="195" stroke="#EF4444" strokeWidth="2.5" />
                        <text x="515" y="193" textAnchor="middle" fill="#EF4444" fontSize="8.5" fontWeight="900">
                          🏁 META
                        </text>
                      </g>
                    );
                  }

                  if (h.distanciaRestante === distanciaCarrera) {
                    // Partida
                    return (
                      <g key="hito-partida">
                        <line x1="35" y1="28" x2="35" y2="195" stroke="#10B981" strokeWidth="2" strokeDasharray="3 3" />
                        <text x="35" y="193" textAnchor="middle" fill="#10B981" fontSize="8" fontWeight="bold">
                          🚪 PP ({distanciaCarrera}m)
                        </text>
                      </g>
                    );
                  }

                  if (h.esParcial400) {
                    // Parcial oficial cada 400 metros
                    const parcialAsociado = cronometrajeINH.parciales400m.find((p) => p.distanciaMetros === h.distanciaRecorrida);
                    return (
                      <g key={`hito-parcial-${h.distanciaRecorrida}`}>
                        <line
                          x1={h.x}
                          y1="28"
                          x2={h.x}
                          y2="195"
                          stroke={parcialAsociado?.alcanzado ? "#10B981" : "#F59E0B"}
                          strokeWidth="1.8"
                          strokeDasharray="4 2"
                        />
                        {/* Etiqueta superior de parcial */}
                        <rect x={h.x - 17} y="28" width="34" height="11" rx="2" fill="#0F172A" stroke="#F59E0B" strokeWidth="0.8" />
                        <text x={h.x} y="36.5" textAnchor="middle" fill="#FEF08A" fontSize="7" fontWeight="900">
                          {h.distanciaRecorrida}m
                        </text>
                        {/* Etiqueta inferior de metros restantes */}
                        <text x={h.x} y="193" textAnchor="middle" fill="#FEF08A" fontSize="7.5" fontWeight="bold">
                          {h.distanciaRestante}m
                        </text>
                      </g>
                    );
                  }

                  // Hito mayor (cada 200m)
                  if (h.esMayor) {
                    return (
                      <g key={`hito-mayor-${h.distanciaRestante}`} opacity="0.65">
                        <line x1={h.x} y1="28" x2={h.x} y2="195" stroke="#475569" strokeWidth="1" strokeDasharray="3 3" />
                        <text x={h.x} y="193" textAnchor="middle" fill="#94A3B8" fontSize="7" fontWeight="bold">
                          {h.distanciaRestante}m
                        </text>
                      </g>
                    );
                  }

                  // Hito menor (cada 100m)
                  return (
                    <line
                      key={`hito-menor-${h.distanciaRestante}`}
                      x1={h.x}
                      y1="28"
                      x2={h.x}
                      y2="195"
                      stroke="#1E293B"
                      strokeWidth="0.6"
                      strokeDasharray="2 3"
                    />
                  );
                })}

                {/* Micro-carriles horizontales independientes sincronizados en riguroso simultáneo 1:1 */}
                {posicionesCalculadas.map((p) => {
                  const cloth = COLORES_GUALDRAPA[p.item.ejemplar.numero] || { bg: "#3B82F6", text: "#FFF", border: "#1D4ED8" };
                  const maxCarriles = Math.max(8, posicionesCalculadas.length);
                  const pasoY = 145 / maxCarriles;
                  const yCarril = 34 + p.carrilIndex * pasoY;
                  const anchoCarrera = 480;
                  const posX = 35 + (p.porcentajeAvanceCentral / 100) * anchoCarrera;
                  const esLider = p.item.ejemplar.numero === liderActual?.item.ejemplar.numero;
                  const estaSeleccionado = caballoSeleccionado === p.item.ejemplar.numero;

                  return (
                    <g key={`recta-num-${p.item.ejemplar.numero}`}>
                      <line x1="30" y1={yCarril + 6} x2="525" y2={yCarril + 6} stroke="#1E293B" strokeWidth="0.7" />
                      <g
                        transform={`translate(${posX}, ${yCarril})`}
                        className={`cursor-pointer ${reproduciendo ? "" : "transition-transform duration-100"}`}
                        onClick={() => setCaballoSeleccionado(p.item.ejemplar.numero)}
                      >
                        {estaSeleccionado && (
                          <rect
                            x="-13"
                            y="-7"
                            width="26"
                            height="20"
                            rx="4.5"
                            fill="none"
                            stroke="#FACC15"
                            strokeWidth="2"
                            strokeDasharray="3 2"
                          />
                        )}
                        <rect
                          x="-10"
                          y="-5"
                          width="20"
                          height="16"
                          rx="3"
                          fill={cloth.bg}
                          stroke={estaSeleccionado ? "#FACC15" : cloth.border || "#0F172A"}
                          strokeWidth={esLider ? 2 : 1}
                        />
                        {esLider && (
                          <text x="0" y="-7" textAnchor="middle" fontSize="8">
                            👑
                          </text>
                        )}
                        <text
                          x="0"
                          y="7"
                          textAnchor="middle"
                          fill={cloth.text}
                          fontSize="9"
                          fontWeight="900"
                          fontFamily="monospace"
                        >
                          {p.item.ejemplar.numero}
                        </text>
                      </g>
                    </g>
                  );
                })}
              </g>

              {/* ------------------------------------------------------------- */}
              {/* APARATO DE PARTIDAS (14 GATERAS) EN EL POSTE OFICIAL          */}
              {/* ------------------------------------------------------------- */}
              <g id="aparatoPartidas14Gateras">
                <line
                  x1={extremosPartidor.riel.x}
                  y1={extremosPartidor.riel.y}
                  x2={extremosPartidor.exterior.x}
                  y2={extremosPartidor.exterior.y}
                  stroke="#1E293B"
                  strokeWidth="8"
                  strokeLinecap="round"
                />
                {partidorEnOvalo.map(({ puerta, x, y, anguloDeg }) => {
                  const gualdrapa = COLORES_GUALDRAPA[puerta] || { bg: "#3B82F6", text: "#FFF" };
                  const tieneCaballo = ranking.some(
                    (r) => (r.ejemplar.puestoPista || (r.ejemplar as unknown as { pp?: number }).pp || r.ejemplar.numero) === puerta
                  );
                  return (
                    <g key={puerta} transform={`translate(${x}, ${y}) rotate(${anguloDeg})`}>
                      <rect
                        x="-8"
                        y="-2.5"
                        width="16"
                        height="5"
                        rx="1"
                        fill={gualdrapa.bg}
                        stroke={tieneCaballo ? "#22C55E" : "#475569"}
                        strokeWidth={tieneCaballo ? "1.5" : "0.6"}
                      />
                      <text x="0" y="1.5" textAnchor="middle" fill={gualdrapa.text} fontSize="4.2" fontWeight="900" fontFamily="monospace">
                        {puerta}
                      </text>
                    </g>
                  );
                })}
              </g>

              {/* ------------------------------------------------------------- */}
              {/* ÓVALO: ÚNICAMENTE CÍRCULOS CONTENEDORES CON SU NÚMERO         */}
              {/* (Sin punteros, sin textos de PP, sin elementos distractores)  */}
              {/* ------------------------------------------------------------- */}
              {posicionesCalculadas.map(({ item, x, y }) => {
                const { ejemplar } = item;
                const gualdrapa = COLORES_GUALDRAPA[ejemplar.numero] || { bg: "#3B82F6", text: "#FFF", border: "#1D4ED8" };
                const estaSeleccionado = caballoSeleccionado === ejemplar.numero;
                const esLiderActual = ejemplar.numero === liderActual?.item.ejemplar.numero;

                return (
                  <g
                    key={ejemplar.numero}
                    className={`cursor-pointer ${reproduciendo ? "" : "transition-transform duration-100"}`}
                    onClick={() => setCaballoSeleccionado(ejemplar.numero)}
                  >
                    {/* CÍRCULO CONTENEDOR CON NÚMERO */}
                    <g transform={`translate(${x}, ${y})`} filter="url(#circuloShadowLR3)">
                      {/* Halo dorado si está seleccionado */}
                      {estaSeleccionado && (
                        <circle cx="0" cy="0" r="19" fill="none" stroke="#FACC15" strokeWidth="2.5" strokeDasharray="4 3" />
                      )}

                      {/* Corona de líder sobre el círculo si va ganando */}
                      {esLiderActual && (
                        <text x="0" y="-16" textAnchor="middle" fontSize="10">
                          👑
                        </text>
                      )}

                      {/* Círculo contenedor con color reglamentario de gualdrapa */}
                      <circle
                        cx="0"
                        cy="0"
                        r="14"
                        fill={gualdrapa.bg}
                        stroke={estaSeleccionado ? "#FACC15" : gualdrapa.border || "#0F172A"}
                        strokeWidth="2.5"
                      />

                      {/* Solo el número en el centro */}
                      <text
                        x="0"
                        y="5"
                        textAnchor="middle"
                        fill={gualdrapa.text}
                        fontSize="13"
                        fontWeight="900"
                        fontFamily="monospace"
                      >
                        {ejemplar.numero}
                      </text>
                    </g>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      )}

      {/* 3. FICHA RESUMEN DEL EJEMPLAR SELECCIONADO */}
      {caballoActivo && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center gap-3">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-lg font-mono text-base font-black shadow-sm"
              style={{
                backgroundColor: COLORES_GUALDRAPA[caballoActivo.ejemplar.numero]?.bg || "#3B82F6",
                color: COLORES_GUALDRAPA[caballoActivo.ejemplar.numero]?.text || "#FFFFFF",
              }}
            >
              #{caballoActivo.ejemplar.numero}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-black text-slate-900">{caballoActivo.ejemplar.nombre}</span>
                <span className="rounded bg-amber-100 text-amber-800 px-1.5 py-0.2 text-[10px] font-bold">
                  🚪 PP {caballoActivo.ejemplar.puestoPista || caballoActivo.ejemplar.numero}
                </span>
                <span className="rounded bg-slate-200 text-slate-700 px-1.5 py-0.2 text-[10px] font-mono font-bold">
                  {caballoActivo.ejemplar.estilo}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Jinete: {caballoActivo.ejemplar.jinete} ({caballoActivo.ejemplar.kilos}kg) · Ent: {caballoActivo.ejemplar.entrenador} · SR: {caballoActivo.ejemplar.speedRatingTTC}
              </p>
            </div>
          </div>
          <div className="text-right">
            <span className="text-xs font-black text-emerald-700 block">
              {caballoActivo.ordenLlegadaProyectado === 1 ? "1° LUGAR PROYECTADO" : `${caballoActivo.ordenLlegadaProyectado}° a ${caballoActivo.cuerposVentaja.toFixed(1)} cpos`}
            </span>
            <span className="text-[10px] font-bold text-slate-400">
              Probabilidad SMIC: {caballoActivo.probabilidadSMIC.toFixed(1)}%
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export default SimuladorPistaCarrera2D;
