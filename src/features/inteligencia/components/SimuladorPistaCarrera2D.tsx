"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import {
  type ResultadoCarreraV4,
  type FactorPista,
  type EstiloCarrera,
  COLORES_GUALDRAPA,
} from "@/features/inteligencia/lib/analista-venezuela-v4";

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
 * ÓVALO DE LA RINCONADA (CIRCUITO 1.800M) CON PISTA CENTRAL DE NÚMEROS EN EL INFIELD
 * ============================================================================
 * 1. Chute de Enfrente (1.600m):
 *    - Prolongación superior hacia la derecha (Este).
 *    - Salida de 1.400m y 1.600m en línea recta hacia el codo de 800m.
 *
 * 2. Chute de la Recta Final (800m):
 *    - Prolongación inferior HACIA LA IZQUIERDA (Oeste).
 *    - Salida de 800m en recta pura entrando por la izquierda hacia la sentencia.
 *
 * 3. Raya de Meta / Sentencia = Marca de 0m / 1.800m:
 *    - Ubicada en la recta final inferior en X = 720.
 *
 * 4. Pista Recta Central de Números en el Infield:
 *    - Ubicada en el centro del óvalo (sustituyendo el lago o integrándose limpiamente).
 *    - Muestra ÚNICAMENTE las fichas con los números (#1..#14) en su color oficial CLOTH.
 *    - Cada número corre en su propio micro-carril libre de colisiones.
 *    - Sincronizada 1:1 con el avance en el óvalo.
 * ============================================================================
 */

export const CANT_GATERAS = 14;
export const ANCHO_PISTA = 70.0;
export const ANCHO_GATERA = ANCHO_PISTA / CANT_GATERAS;

// Coordenadas base (viewBox 0 0 1440 620)
const X_CENTRO_IZQ = 360;
const X_CENTRO_DER = 760;
const Y_CENTRO = 310;
const LONG_RECTA = 400; // Recta de X=360 a X=760

// Radio medio (semicírculos de 500m cada uno en eje medio)
const R_MEDIO = 500 / Math.PI; // ≈ 159.155m
export const R_RIEL = R_MEDIO - ANCHO_PISTA / 2;     // ≈ 124.15m (Riel interior)
export const R_EXTERIOR = R_MEDIO + ANCHO_PISTA / 2; // ≈ 194.15m (Baranda exterior)

// SENTENCIA DE LLEGADA / META: En la recta final inferior en X = 720
// Desde la salida del codo izquierdo (X = 360) hasta la meta (X = 720) hay 360 metros.
// En total el circuito cerrado mide exactamente 400 + 500 + 400 + 500 = 1.800 metros.
export const X_META = 720;
export const DIST_SALIDA_CODO_A_META = X_META - X_CENTRO_IZQ; // 360m

// Longitud del Chute de 1.600m (Enfrente, superior derecha): desde X=760 hacia la derecha hasta X=1240 (480m)
const X_MAX_CHUTE_ENFRENTE = 1240;

// Longitud del Chute de 800m (Recta Final, inferior izquierda):
// Se extiende desde la salida del codo izquierdo (X = 360) hacia la IZQUIERDA hasta X = -80 (440m de extensión)
// Así la distancia en recta hacia la meta en X = 720 es: (720 - (-80)) = 800 metros.
const X_MIN_CHUTE_RECTA_FINAL = -80;

/**
 * Calcula posición (x, y) y ángulo en metros restantes hacia la meta.
 */
export function calcularPosicionEnOvalo(
  distanciaRestanteMetros: number,
  lambdaRiel: number = 0.2,
  distanciaOficialCarrera: number = 1400
): { x: number; y: number; anguloDeg: number; tramo: string } {
  const lambdaClamped = Math.max(0, Math.min(1, lambdaRiel));
  const rEfectivo = R_RIEL + lambdaClamped * ANCHO_PISTA;
  const longSemicirculo = Math.PI * rEfectivo;

  // CASO A: Chute de 800m (Recta Final inferior hacia la izquierda)
  // Viene corriendo de izquierda a derecha (hacia X_META = 720)
  if (distanciaOficialCarrera <= 850) {
    const x = X_META - distanciaRestanteMetros;
    const y = Y_CENTRO + rEfectivo;
    return { x, y, anguloDeg: 0, tramo: "CHUTE_800M" };
  }

  // CASO B: Chute de Enfrente (1.300m a 1.650m, ej: 1.400m y 1.600m en recta superior derecha)
  const usaChuteEnfrente = distanciaOficialCarrera > 1200 && distanciaOficialCarrera <= 1650;
  if (usaChuteEnfrente && distanciaRestanteMetros > 1200) {
    const dEnChute = distanciaRestanteMetros - 1200;
    const x = X_CENTRO_DER + dEnChute;
    const y = Y_CENTRO - rEfectivo;
    return { x, y, anguloDeg: 180, tramo: "CHUTE_1600M" };
  }

  // CASO C: Recta Final hacia la Meta (0m a 360m de distancia restante)
  if (distanciaRestanteMetros <= DIST_SALIDA_CODO_A_META) {
    const x = X_META - distanciaRestanteMetros;
    const y = Y_CENTRO + rEfectivo;
    return { x, y, anguloDeg: 0, tramo: "RECTA_FINAL" };
  }

  // CASO D: Codo de la Rinconada (extremo izquierdo, 360m a ~860m)
  const dEnCodoIzq = distanciaRestanteMetros - DIST_SALIDA_CODO_A_META;
  if (dEnCodoIzq <= longSemicirculo) {
    const fraccion = dEnCodoIzq / longSemicirculo;
    const theta = Math.PI / 2 + fraccion * Math.PI;
    const x = X_CENTRO_IZQ + rEfectivo * Math.cos(theta);
    const y = Y_CENTRO + rEfectivo * Math.sin(theta);
    const anguloDeg = (theta - Math.PI / 2) * (180 / Math.PI);
    return { x, y, anguloDeg, tramo: "CODO_IZQ" };
  }

  // CASO E: Recta de Enfrente (860m a 1.260m)
  const dEnRectaOpuesta = dEnCodoIzq - longSemicirculo;
  if (dEnRectaOpuesta <= LONG_RECTA) {
    const x = X_CENTRO_IZQ + dEnRectaOpuesta;
    const y = Y_CENTRO - rEfectivo;
    return { x, y, anguloDeg: 180, tramo: "RECTA_ENFRENTE" };
  }

  // CASO F: Primer Codo / Codo de Caballerizas (1.260m a 1.760m para carreras de 1.800m)
  const dEnPrimerCodo = dEnRectaOpuesta - LONG_RECTA;
  if (dEnPrimerCodo <= longSemicirculo) {
    const fraccion = dEnPrimerCodo / longSemicirculo;
    const phi = -Math.PI / 2 + fraccion * Math.PI;
    const x = X_CENTRO_DER + rEfectivo * Math.cos(phi);
    const y = Y_CENTRO + rEfectivo * Math.sin(phi);
    const anguloDeg = (180 + (phi + Math.PI / 2) * (180 / Math.PI)) % 360;
    return { x, y, anguloDeg, tramo: "PRIMER_CODO" };
  }

  // CASO G: Tramo de 1.760m a 1.800m (partida en la recta de tribunas hacia el primer codo)
  const dResto = dEnPrimerCodo - longSemicirculo;
  const x = X_CENTRO_DER - dResto;
  const y = Y_CENTRO + rEfectivo;
  return { x, y, anguloDeg: 0, tramo: "SALIDA_1800M" };
}

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
    if (fase === "PARTIDA") setProgreso(0);
    else if (fase === "CODO") setProgreso(40);
    else if (fase === "RECTA") setProgreso(80);
    else if (fase === "META") setProgreso(100);
  };

  const desfaseMetaPorEjemplar = useMemo(() => {
    return ranking.map((r, index) => {
      if (index === 0) return 0;
      return r.cuerposVentaja * 2.4; // 1 cuerpo ≈ 2.4 metros
    });
  }, [ranking]);

  // Posiciones calculadas en el óvalo y en la recta central del infield
  const posicionesCalculadas = useMemo(() => {
    const avanceFraccion = Math.max(0, Math.min(1, progreso / 100));

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
      if (avanceFraccion <= 0) {
        lambdaActual = lambdaPartida;
      } else if (avanceFraccion < 0.25) {
        const tCierre = avanceFraccion / 0.25;
        lambdaActual = lambdaPartida + tCierre * (lambdaObjetivoRiel - lambdaPartida);
      } else if (avanceFraccion < 0.75) {
        lambdaActual = lambdaObjetivoRiel;
      } else {
        const tMeta = (avanceFraccion - 0.75) / 0.25;
        const lambdaAbanicoMeta = 0.12 + (index / Math.max(1, ranking.length - 1)) * 0.76;
        lambdaActual = lambdaObjetivoRiel * (1 - tMeta) + lambdaAbanicoMeta * tMeta;
      }

      let factorAvanceIndividual = avanceFraccion;
      if (estilo === "E1" && avanceFraccion < 0.6) {
        factorAvanceIndividual = Math.min(1, avanceFraccion * 1.07);
      } else if (estilo === "E3" && avanceFraccion < 0.5) {
        factorAvanceIndividual = avanceFraccion * 0.94;
      } else if (estilo === "E3" && avanceFraccion >= 0.7) {
        const tRemate = (avanceFraccion - 0.7) / 0.3;
        factorAvanceIndividual = 0.7 + tRemate * 0.3;
      }

      const metrosTotales = distanciaCarrera;
      const desfaseFinal = desfaseMetaPorEjemplar[index];
      const distanciaRecorrida = factorAvanceIndividual * metrosTotales;
      const distanciaRestante = Math.max(0, metrosTotales - distanciaRecorrida + desfaseFinal * avanceFraccion);

      const pos = calcularPosicionEnOvalo(distanciaRestante, lambdaActual, distanciaCarrera);

      // Posición porcentual en la pista recta central (0% a 100%)
      const porcentajeAvanceCentral = Math.max(
        0,
        Math.min(100, (1 - distanciaRestante / metrosTotales) * 100)
      );

      return {
        item,
        puertaSalida,
        distanciaRestante,
        x: pos.x,
        y: pos.y,
        anguloDeg: pos.anguloDeg,
        tramo: pos.tramo,
        porcentajeAvanceCentral,
        carrilIndex: index,
        esGanador: ordenLlegadaProyectado === 1,
        esPlacero: ordenLlegadaProyectado <= 3,
        favorecidoTendenciaTarde,
      };
    });
  }, [ranking, progreso, distanciaCarrera, desfaseMetaPorEjemplar]);

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
  const hitosCada100m = useMemo(() => {
    const hitos: Array<{ metro: number; posRiel: { x: number; y: number }; posExt: { x: number; y: number }; esHitoMayor: boolean }> = [];
    for (let m = 0; m <= 1800; m += 100) {
      const posRiel = calcularPosicionEnOvalo(m, 0, 1800);
      const posExt = calcularPosicionEnOvalo(m, 1, 1800);
      const esHitoMayor = m % 200 === 0;
      hitos.push({ metro: m, posRiel, posExt, esHitoMayor });
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
                HITOS CADA 100M · CHUTE 1.600M · CHUTE 800M IZQ · {distanciaCarrera}M
              </span>
            </h3>
            <p className="text-[11px] text-slate-500">
              Circuito oficial de 1.800 metros con Chute de Enfrente (1.600m), Chute Recta Final (800m hacia la izquierda) y Pista Central de Números en el Infield.
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

      {/* 2. PISTA DE CARRERAS: ÓVALO + CHUTES + PISTA RECTA CENTRAL EN EL INFIELD */}
      {mostrarPista && (
        <div className="relative overflow-hidden rounded-2xl border-2 border-slate-700 bg-slate-950 p-2 shadow-inner select-none">
          <div className="relative w-full aspect-[16/7.5] max-h-[660px] rounded-xl overflow-hidden shadow-2xl bg-gradient-to-b from-emerald-950 via-slate-900 to-emerald-950">
            <svg
              viewBox="-120 0 1440 620"
              className="w-full h-full object-contain"
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                {/* Textura de Arena de La Rinconada */}
                <pattern id="arenaPatternLR2" width="36" height="36" patternUnits="userSpaceOnUse">
                  <rect width="36" height="36" fill="#854D0E" />
                  <circle cx="8" cy="8" r="2.2" fill="#A16207" opacity="0.8" />
                  <circle cx="26" cy="18" r="2.0" fill="#713F12" opacity="0.85" />
                  <circle cx="16" cy="30" r="1.5" fill="#EAB308" opacity="0.6" />
                </pattern>

                <filter id="circuloShadowLR2" x="-30%" y="-30%" width="160%" height="160%">
                  <feDropShadow dx="1" dy="4" stdDeviation="3" floodOpacity="0.8" floodColor="#000" />
                </filter>
              </defs>

              {/* FONDO EXTERIOR */}
              <rect x="-120" y="0" width="1440" height="620" fill="#14532D" />
              <rect x="-110" y="8" width="1420" height="604" rx="36" fill="#166534" stroke="#15803D" strokeWidth="2.5" />

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
                fill="url(#arenaPatternLR2)"
                stroke="#B45309"
                strokeWidth="2.5"
              />

              {/* ------------------------------------------------------------- */}
              {/* CHUTE 1: EXTENSIÓN DE 1.600M EN LA RECTA DE ENFRENTE (DERECHA) */}
              {/* ------------------------------------------------------------- */}
              <rect
                x={X_CENTRO_DER}
                y={Y_CENTRO - R_EXTERIOR}
                width={X_MAX_CHUTE_ENFRENTE - X_CENTRO_DER}
                height={ANCHO_PISTA}
                fill="url(#arenaPatternLR2)"
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
              {/* CHUTE 2: EXTENSIÓN DE 800M EN LA RECTA FINAL (HACIA LA IZQUIERDA) */}
              {/* ------------------------------------------------------------- */}
              <rect
                x={X_MIN_CHUTE_RECTA_FINAL}
                y={Y_CENTRO + R_RIEL}
                width={X_CENTRO_IZQ - X_MIN_CHUTE_RECTA_FINAL}
                height={ANCHO_PISTA}
                fill="url(#arenaPatternLR2)"
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
                <rect x={X_MIN_CHUTE_RECTA_FINAL + 10} y={Y_CENTRO + R_EXTERIOR + 6} width="300" height="18" rx="4" fill="#0F172A" stroke="#F59E0B" strokeWidth="1.2" />
                <text x={X_MIN_CHUTE_RECTA_FINAL + 160} y={Y_CENTRO + R_EXTERIOR + 19} textAnchor="middle" fill="#F59E0B" fontSize="9" fontWeight="900" letterSpacing="0.8">
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
              {/* ------------------------------------------------------------- */}
              {hitosCada100m.map(({ metro, posRiel, posExt, esHitoMayor }) => {
                if (metro === 0 || metro === 1800) return null;
                return (
                  <g key={`hito-${metro}`} opacity={esHitoMayor ? 0.95 : 0.65}>
                    <line
                      x1={posRiel.x}
                      y1={posRiel.y}
                      x2={posExt.x}
                      y2={posExt.y}
                      stroke={esHitoMayor ? "#FACC15" : "#FFFFFF"}
                      strokeWidth={esHitoMayor ? 2 : 1}
                      strokeDasharray={esHitoMayor ? "none" : "3 3"}
                    />
                    <circle cx={posExt.x} cy={posExt.y} r={esHitoMayor ? 3.5 : 2} fill={esHitoMayor ? "#FACC15" : "#FFFFFF"} />
                    {esHitoMayor && (
                      <text
                        x={posExt.x}
                        y={posExt.y + (posExt.y > Y_CENTRO ? 13 : -7)}
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

              {/* Hitos en el Chute de Enfrente (1400m y 1600m) */}
              <g opacity="0.95">
                <line
                  x1={X_CENTRO_DER + 200}
                  y1={Y_CENTRO - R_EXTERIOR}
                  x2={X_CENTRO_DER + 200}
                  y2={Y_CENTRO - R_RIEL}
                  stroke="#FACC15"
                  strokeWidth="2.2"
                />
                <text x={X_CENTRO_DER + 200} y={Y_CENTRO - R_EXTERIOR - 7} textAnchor="middle" fill="#FEF08A" fontSize="9.5" fontWeight="900">
                  1.400M (CHUTE)
                </text>

                <line
                  x1={X_CENTRO_DER + 400}
                  y1={Y_CENTRO - R_EXTERIOR}
                  x2={X_CENTRO_DER + 400}
                  y2={Y_CENTRO - R_RIEL}
                  stroke="#FACC15"
                  strokeWidth="2.2"
                />
                <text x={X_CENTRO_DER + 400} y={Y_CENTRO - R_EXTERIOR - 7} textAnchor="middle" fill="#FEF08A" fontSize="9.5" fontWeight="900">
                  1.600M (CHUTE)
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
              {/* 3. PISTA RECTA CENTRAL DE NÚMEROS EN EL MEDIO DEL ÓVALO (INFIELD) */}
              {/* ============================================================== */}
              <g transform={`translate(${X_CENTRO_IZQ - 40}, ${Y_CENTRO - 100})`}>
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

                {/* Barra de título */}
                <rect x="0" y="0" width="560" height="26" rx="14" fill="#0F172A" />
                <text x="14" y="17" fill="#FACC15" fontSize="10" fontWeight="900" letterSpacing="0.05em">
                  ⚡ PISTA RECTA CENTRAL (INFIELD) · SOLO NÚMEROS SIN COLISIÓN
                </text>
                <text x="546" y="17" textAnchor="end" fill="#94A3B8" fontSize="8.5" fontWeight="bold">
                  PROGRESO: {progreso.toFixed(0)}%
                </text>

                {/* Tramos verticales: Salida, 1000m, 300m y Meta */}
                {/* 1. Salida PP (X = 35) */}
                <line x1="35" y1="28" x2="35" y2="195" stroke="#334155" strokeWidth="1" strokeDasharray="3 3" />
                <text x="35" y="192" textAnchor="middle" fill="#64748B" fontSize="8" fontWeight="bold">
                  🚪 PP
                </text>

                {/* 2. 1000m (X = 195) */}
                <line x1="195" y1="28" x2="195" y2="195" stroke="#334155" strokeWidth="1" strokeDasharray="3 3" />
                <text x="195" y="192" textAnchor="middle" fill="#64748B" fontSize="8" fontWeight="bold">
                  ⚡ 1000m
                </text>

                {/* 3. 300m (X = 385) */}
                <line x1="385" y1="28" x2="385" y2="195" stroke="#334155" strokeWidth="1" strokeDasharray="3 3" />
                <text x="385" y="192" textAnchor="middle" fill="#64748B" fontSize="8" fontWeight="bold">
                  🔄 300m
                </text>

                {/* 4. META (X = 515) */}
                <line x1="515" y1="28" x2="515" y2="195" stroke="#EF4444" strokeWidth="2.5" />
                <text x="515" y="192" textAnchor="middle" fill="#EF4444" fontSize="9" fontWeight="900">
                  🏁 META
                </text>

                {/* Micro-carriles horizontales independientes con los números de gualdrapa */}
                {posicionesCalculadas.map((p) => {
                  const cloth = COLORES_GUALDRAPA[p.item.ejemplar.numero] || { bg: "#3B82F6", text: "#FFF", border: "#1D4ED8" };
                  const maxCarriles = Math.max(8, posicionesCalculadas.length);
                  const pasoY = 145 / maxCarriles;
                  const yCarril = 34 + p.carrilIndex * pasoY;
                  const anchoCarrera = 480;
                  const posX = 35 + (p.porcentajeAvanceCentral / 100) * anchoCarrera;
                  const esLider = p.item.ordenLlegadaProyectado === 1;

                  return (
                    <g key={`recta-num-${p.item.ejemplar.numero}`}>
                      <line x1="30" y1={yCarril + 6} x2="525" y2={yCarril + 6} stroke="#1E293B" strokeWidth="0.7" />
                      <g
                        transform={`translate(${posX}, ${yCarril})`}
                        className="cursor-pointer transition-transform duration-75"
                        onClick={() => setCaballoSeleccionado(p.item.ejemplar.numero)}
                      >
                        <rect
                          x="-10"
                          y="-5"
                          width="20"
                          height="16"
                          rx="3"
                          fill={cloth.bg}
                          stroke={cloth.border || "#0F172A"}
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
              {/* CÍRCULOS CONTENEDORES CON NÚMEROS Y PUNTEROS FLOTANTES       */}
              {/* ------------------------------------------------------------- */}
              {posicionesCalculadas.map(({ item, puertaSalida, x, y }) => {
                const { ejemplar, ordenLlegadaProyectado } = item;
                const gualdrapa = COLORES_GUALDRAPA[ejemplar.numero] || { bg: "#3B82F6", text: "#FFF", border: "#1D4ED8" };
                const estaSeleccionado = caballoSeleccionado === ejemplar.numero;
                const esLiderActual = ordenLlegadaProyectado === 1;

                return (
                  <g
                    key={ejemplar.numero}
                    className="cursor-pointer transition-transform duration-75"
                    onClick={() => setCaballoSeleccionado(ejemplar.numero)}
                  >
                    {/* CÍRCULO CONTENEDOR CON NÚMERO RECORRIENDO LA PISTA */}
                    <g transform={`translate(${x}, ${y})`} filter="url(#circuloShadowLR2)">
                      {estaSeleccionado && (
                        <circle cx="0" cy="0" r="18" fill="none" stroke="#FACC15" strokeWidth="2.5" strokeDasharray="4 3" />
                      )}

                      <circle
                        cx="0"
                        cy="0"
                        r="13"
                        fill={gualdrapa.bg}
                        stroke={estaSeleccionado ? "#FACC15" : gualdrapa.border || "#0F172A"}
                        strokeWidth="2.2"
                      />

                      <text
                        x="0"
                        y="4.5"
                        textAnchor="middle"
                        fill={gualdrapa.text}
                        fontSize="12"
                        fontWeight="900"
                        fontFamily="monospace"
                      >
                        {ejemplar.numero}
                      </text>
                    </g>

                    {/* PUNTERO VERTICAL FLOTANTE (NO ROTA, SIEMPRE DERECHO) */}
                    <g transform={`translate(${x}, ${y - 24})`}>
                      <polygon points="-3,-1 3,-1 0,3" fill={gualdrapa.bg} />
                      <rect
                        x="-20"
                        y="-15"
                        width="40"
                        height="14"
                        rx="3.5"
                        fill="#0F172A"
                        stroke={estaSeleccionado ? "#FACC15" : gualdrapa.bg}
                        strokeWidth="1.5"
                      />
                      {esLiderActual && (
                        <text x="-13" y="-4.5" fontSize="7.5" fill="#FACC15">
                          👑
                        </text>
                      )}
                      <text
                        x={esLiderActual ? "-3" : "-8"}
                        y="-4.5"
                        textAnchor="middle"
                        fill={gualdrapa.bg === "#FFFFFF" ? "#38BDF8" : gualdrapa.bg}
                        fontSize="9"
                        fontWeight="900"
                        fontFamily="monospace"
                      >
                        #{ejemplar.numero}
                      </text>
                      <text
                        x={esLiderActual ? "10" : "8"}
                        y="-4.5"
                        textAnchor="middle"
                        fill="#FFFFFF"
                        fontSize="7"
                        fontWeight="900"
                        fontFamily="monospace"
                      >
                        P{puertaSalida}
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
