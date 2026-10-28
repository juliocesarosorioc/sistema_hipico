"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
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
 * GEOMETRÍA PARAMÉTRICA DE LA PISTA DE CARRERAS DE LA RINCONADA (1.800 METROS)
 * ============================================================================
 * 1. EXTENSIÓN ("CHUTE") DE LA RECTA DE ENFRENTE:
 *    - En La Rinconada, las carreras de 1.400m, 1.500m y 1.600m NO parten en la curva.
 *    - Parten desde la extensión en línea recta de la recta de enfrente (Chute Este).
 *    - Recorren toda la recta superior antes de tomar el codo de los 800m.
 *
 * 2. RAYA DE LLEGADA = MARCA OFICIAL DE 1.800 METROS:
 *    - En la recta final (inferior), la sentencia de meta es la cota 0m / 1.800m.
 *    - Las carreras de 1.800m parten en la misma raya de llegada y dan la vuelta completa.
 *
 * 3. ANCHO DE PISTA AMPLIADO +150%:
 *    - Ancho de calzada = 64 metros (4.57m por cada una de las 14 gateras).
 *
 * 4. INDICADORES DE ALTA VISIBILIDAD PARA NÚMEROS EN MOVIMIENTO:
 *    - Banderín/pin flotante con dorsal grande y color oficial de gualdrapa.
 *    - Distinción inmediata del puntero y ejemplares en contienda.
 * ============================================================================
 */

export const CANT_GATERAS = 14;
export const ANCHO_PISTA = 64.0; // Pista ampliada 150% (64 metros exactos)
export const ANCHO_GATERA = ANCHO_PISTA / CANT_GATERAS; // ~4.57m por cajón

// Coordenadas base del circuito (viewBox 0 0 1180 580)
const X_CENTRO_IZQ = 260;
const X_CENTRO_DER = 660;
const Y_CENTRO = 290;
const LONG_RECTA = 400; // de X=260 a X=660

// Radio medio para que los semicírculos midan exactamente 500m cada uno
const R_MEDIO = 500 / Math.PI; // ≈ 159.155m
export const R_RIEL = R_MEDIO - ANCHO_PISTA / 2;     // 127.155m (Baranda Interior - El Riel)
export const R_EXTERIOR = R_MEDIO + ANCHO_PISTA / 2; // 191.155m (Baranda Exterior)

// RAYA DE LLEGADA EN LA RECTA FINAL: X = 580
export const X_META = 580;
export const DISTANCIA_META_DESDE_SALIDA_CODO = X_META - X_CENTRO_IZQ; // 320m

// Longitud máxima de la extensión ("Chute") hacia el Este: llega hasta X = 1100 (440m de alargue)
const X_MAX_CHUTE = 1100;

/**
 * Calcula las coordenadas (x, y) y ángulo de avance considerando si la carrera
 * utiliza la extensión (chute) recta de enfrente (1.400m - 1.600m) o el óvalo clásico (1.800m).
 */
export function calcularPosicionEnOvalo(
  distanciaRestanteMetros: number,
  lambdaRiel: number = 0.15,
  distanciaOficialCarrera: number = 1400
): { x: number; y: number; anguloDeg: number; tramo: string } {
  const lambdaClamped = Math.max(0, Math.min(1, lambdaRiel));
  const rEfectivo = R_RIEL + lambdaClamped * ANCHO_PISTA;
  const longSemicirculo = Math.PI * rEfectivo;

  // CASO 1: Carreras que utilizan la EXTENSIÓN ("CHUTE") de la recta de enfrente (1.300m a 1.650m)
  const usaChute = distanciaOficialCarrera > 1200 && distanciaOficialCarrera <= 1650;

  if (usaChute && distanciaRestanteMetros > 1200) {
    // El ejemplar avanza por la extensión recta de Este a Oeste (hacia la izquierda, X disminuye)
    const dEnExtension = distanciaRestanteMetros - 1200;
    const x = X_CENTRO_DER + dEnExtension;
    const y = Y_CENTRO - rEfectivo;
    return { x, y, anguloDeg: 180, tramo: "CHUTE_EXTENSION" };
  }

  // CASO 2: Tramo de Recta Final (desde salida de codo final hasta la meta, 0m a 320m)
  if (distanciaRestanteMetros <= DISTANCIA_META_DESDE_SALIDA_CODO) {
    const x = X_META - distanciaRestanteMetros;
    const y = Y_CENTRO + rEfectivo;
    return { x, y, anguloDeg: 0, tramo: "RECTA_FINAL" };
  }

  // CASO 3: Codo Final (curva de los 800m a 400m, extremo izquierdo)
  const dEnCodoIzq = distanciaRestanteMetros - DISTANCIA_META_DESDE_SALIDA_CODO;
  if (dEnCodoIzq <= longSemicirculo) {
    const fraccion = dEnCodoIzq / longSemicirculo;
    const theta = Math.PI / 2 + fraccion * Math.PI;
    const x = X_CENTRO_IZQ + rEfectivo * Math.cos(theta);
    const y = Y_CENTRO + rEfectivo * Math.sin(theta);
    const anguloDeg = (theta - Math.PI / 2) * (180 / Math.PI);
    return { x, y, anguloDeg, tramo: "CODO_FINAL" };
  }

  // CASO 4: Recta de Enfrente / Opuesta (superior, de X=260 a X=660, 800m a 1.200m)
  const dEnRectaOpuesta = dEnCodoIzq - longSemicirculo;
  if (dEnRectaOpuesta <= LONG_RECTA) {
    const x = X_CENTRO_IZQ + dEnRectaOpuesta;
    const y = Y_CENTRO - rEfectivo;
    return { x, y, anguloDeg: 180, tramo: "RECTA_ENFRENTE" };
  }

  // CASO 5: Para carreras de 1.800m que dan la vuelta completa por el primer codo
  const dEnPrimerCodo = dEnRectaOpuesta - LONG_RECTA;
  if (dEnPrimerCodo <= longSemicirculo) {
    const fraccion = dEnPrimerCodo / longSemicirculo;
    const phi = -Math.PI / 2 + fraccion * Math.PI;
    const x = X_CENTRO_DER + rEfectivo * Math.cos(phi);
    const y = Y_CENTRO + rEfectivo * Math.sin(phi);
    const anguloDeg = (180 + (phi + Math.PI / 2) * (180 / Math.PI)) % 360;
    return { x, y, anguloDeg, tramo: "PRIMER_CODO" };
  }

  // Tramo de salida desde la meta en la recta final hacia el primer codo (para 1.800m)
  const dResto = dEnPrimerCodo - longSemicirculo;
  const x = X_CENTRO_DER - dResto;
  const y = Y_CENTRO + rEfectivo;
  return { x, y, anguloDeg: 0, tramo: "RECTA_FINAL_PRE_META" };
}

/** Puestos de partida oficiales del 1 al 14 */
export const GATERAS_14 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] as const;

export function SimuladorPistaCarrera2D({
  resultado,
  factorPistaActual = "NORMAL",
  carrilActual = "RIEL",
  estiloActual = "E1",
  tendenciaActiva = false,
  className = "",
}: Props) {
  const [mostrarPista, setMostrarPista] = useState<boolean>(true);

  // Distancia oficial de la carrera (ej: 1800m, 1600m, 1500m, 1400m, 1200m)
  const distanciaCarrera = useMemo(() => {
    const d = Number(resultado.distancia);
    return Number.isFinite(d) && d >= 800 && d <= 2400 ? d : 1400;
  }, [resultado.distancia]);

  // Si la carrera parte de la extensión recta de enfrente (1.300m - 1.650m)
  const usaExtensionChute = distanciaCarrera > 1200 && distanciaCarrera <= 1650;

  // Progreso de carrera: inicia en 0% (alineados en las 14 gateras de salida)
  const [progreso, setProgreso] = useState<number>(0);
  const [reproduciendo, setReproduciendo] = useState<boolean>(false);
  const [velocidad, setVelocidad] = useState<number>(1);
  const [caballoSeleccionado, setCaballoSeleccionado] = useState<number | null>(null);
  const [faseActiva, setFaseActiva] = useState<FaseCarrera>("PARTIDA");

  const requestRef = useRef<number | null>(null);
  const ultimoTiempoRef = useRef<number | null>(null);

  // Ranking actuarial ordenado por llegada proyectada
  const ranking = useMemo(() => {
    return [...resultado.ranking].sort(
      (a, b) => a.ordenLlegadaProyectado - b.ordenLlegadaProyectado
    );
  }, [resultado.ranking]);

  // Preselección del favorito
  useEffect(() => {
    if (caballoSeleccionado === null && ranking.length > 0) {
      setCaballoSeleccionado(ranking[0].ejemplar.numero);
    }
  }, [ranking, caballoSeleccionado]);

  // Reiniciar a la partida al cambiar de carrera o distancia
  useEffect(() => {
    setProgreso(0);
    setReproduciendo(false);
    setFaseActiva("PARTIDA");
  }, [resultado.carreraNumero, distanciaCarrera]);

  // Sincronizar fases hípicas según el progreso
  useEffect(() => {
    if (progreso < 12) setFaseActiva("PARTIDA");
    else if (progreso < 65) setFaseActiva("CODO");
    else if (progreso < 95) setFaseActiva("RECTA");
    else setFaseActiva("META");
  }, [progreso]);

  // Motor de animación a 60 FPS ultra-armónico
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
      const delta = Math.min((tiempoActual - ultimoTiempoRef.current) / 1000, 0.05);
      ultimoTiempoRef.current = tiempoActual;

      setProgreso((prev) => {
        const incremento = delta * 10 * velocidad;
        if (prev + incremento >= 100) {
          setReproduciendo(false);
          ultimoTiempoRef.current = null;
          return 100;
        }
        return prev + incremento;
      });

      requestRef.current = requestAnimationFrame(animar);
    };

    requestRef.current = requestAnimationFrame(animar);

    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      ultimoTiempoRef.current = null;
    };
  }, [reproduciendo, velocidad]);

  // Navegación rápida entre fases hípicas
  const saltarAFase = useCallback((fase: FaseCarrera) => {
    setReproduciendo(false);
    if (fase === "PARTIDA") setProgreso(0);
    if (fase === "CODO") setProgreso(45);
    if (fase === "RECTA") setProgreso(80);
    if (fase === "META") setProgreso(100);
  }, []);

  // Metros restantes y coordenadas de cada ejemplar a lo largo del circuito
  const posicionesCalculadas = useMemo(() => {
    let acumuladoMetrosAtras = 0;
    const desfaseMetaPorEjemplar: number[] = [];

    for (let i = 0; i < ranking.length; i++) {
      if (i === 0) {
        desfaseMetaPorEjemplar.push(0);
      } else {
        const cuerpos = Math.max(ranking[i].cuerposVentaja || 0.5, 0.25);
        acumuladoMetrosAtras += cuerpos * 2.5; // 1 cuerpo ≈ 2.5 metros
        desfaseMetaPorEjemplar.push(acumuladoMetrosAtras);
      }
    }

    const avanceFraccion = Math.max(0, Math.min(1, progreso / 100));

    return ranking.map((item, index) => {
      const { ejemplar, ordenLlegadaProyectado, favorecidoTendenciaTarde } = item;
      const estilo = ejemplar.estilo;

      const puertaSalida = Math.min(
        14,
        Math.max(1, ejemplar.puestoPista || (ejemplar as unknown as { pp?: number }).pp || ejemplar.numero || (index + 1))
      );

      const lambdaPartida = (puertaSalida - 0.5) / 14;

      // Tendencia de cierre hacia la baranda interior (el riel)
      let lambdaObjetivoRiel = 0.12;
      if (estilo === "E1") lambdaObjetivoRiel = 0.10;
      else if (estilo === "E2") lambdaObjetivoRiel = 0.25;
      else lambdaObjetivoRiel = 0.44;

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
        const lambdaAbanicoMeta = 0.08 + (index / Math.max(1, ranking.length - 1)) * 0.78;
        lambdaActual = lambdaObjetivoRiel * (1 - tMeta) + lambdaAbanicoMeta * tMeta;
      }

      let factorAvanceIndividual = avanceFraccion;
      if (estilo === "E1" && avanceFraccion < 0.6) {
        factorAvanceIndividual = Math.min(1, avanceFraccion * 1.08);
      } else if (estilo === "E3" && avanceFraccion < 0.5) {
        factorAvanceIndividual = avanceFraccion * 0.94;
      } else if (estilo === "E3" && avanceFraccion >= 0.7) {
        const tRemate = (avanceFraccion - 0.7) / 0.3;
        factorAvanceIndividual = 0.7 + tRemate * 0.3;
      }

      const metrosTotalesCarrera = distanciaCarrera;
      const desfaseFinal = desfaseMetaPorEjemplar[index];
      const distanciaRecorrida = factorAvanceIndividual * metrosTotalesCarrera;
      const distanciaRestante = Math.max(0, metrosTotalesCarrera - distanciaRecorrida + desfaseFinal * avanceFraccion);

      const pos = calcularPosicionEnOvalo(distanciaRestante, lambdaActual, distanciaCarrera);

      return {
        item,
        puertaSalida,
        distanciaRestante,
        x: pos.x,
        y: pos.y,
        anguloDeg: pos.anguloDeg,
        tramo: pos.tramo,
        esGanador: ordenLlegadaProyectado === 1,
        esPlacero: ordenLlegadaProyectado <= 3,
        favorecidoTendenciaTarde,
      };
    });
  }, [ranking, progreso, distanciaCarrera]);

  // Aparato de 14 Gateras en el poste de salida correspondiente:
  // Si distanciaCarrera es 1400m, 1500m o 1600m, se coloca en la EXTENSIÓN ("CHUTE") de la recta de enfrente
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

  // Marcadores de distancia alrededor del óvalo y de la extensión de enfrente
  const marcadoresOvalo = useMemo(() => {
    const metros = [1800, 1600, 1400, 1200, 1000, 800, 600, 400, 200, 0];
    return metros.map((m) => {
      const posRiel = calcularPosicionEnOvalo(m, 0, distanciaCarrera);
      const posExt = calcularPosicionEnOvalo(m, 1, distanciaCarrera);
      return { metro: m, posRiel, posExt };
    });
  }, [distanciaCarrera]);

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
              <span>Pista de Carreras Ovalada (La Rinconada · 1.800 Metros)</span>
              <span className="rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 px-2 py-0.2 text-[9px] font-black">
                PISTA AMPLIADA +150% · {distanciaCarrera}M · {usaExtensionChute ? "CHUTE EXTENSIÓN RECTA" : "CIRCUITO ÓVALO"}
              </span>
            </h3>
            <p className="text-[11px] text-slate-500">
              {usaExtensionChute
                ? `Partida en la EXTENSIÓN RECTA de enfrente (${distanciaCarrera}m sin doblar curva inicial), con llegada en la raya de 1.800m.`
                : `Circuito cerrado de 1.800m con partida y llegada en la sentencia oficial.`}
            </p>
          </div>
        </div>

        {/* Botón para Ocultar / Mostrar la Pista y Controles de Fase */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setMostrarPista(!mostrarPista)}
            className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 border shadow-xs ${
              mostrarPista
                ? "bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200"
                : "bg-indigo-600 text-white border-indigo-700 hover:bg-indigo-700"
            }`}
          >
            <span>{mostrarPista ? "👁️ Ocultar Pista" : "👁️ Mostrar Pista"}</span>
          </button>

          {mostrarPista && (
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-[11px] font-black">
              <button
                type="button"
                onClick={() => saltarAFase("PARTIDA")}
                className={`px-2.5 py-1 rounded-lg transition-all ${
                  faseActiva === "PARTIDA" ? "bg-white text-indigo-900 shadow-xs" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                🏁 Partida ({distanciaCarrera}m)
              </button>
              <button
                type="button"
                onClick={() => saltarAFase("CODO")}
                className={`px-2.5 py-1 rounded-lg transition-all ${
                  faseActiva === "CODO" ? "bg-white text-indigo-900 shadow-xs" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                ⚡ Codo (800m)
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
            </div>
          )}
        </div>
      </div>

      {/* 2. PISTA DE CARRERAS CON EXTENSIÓN DE RECTA DE ENFRENTE (CHUTE) */}
      {mostrarPista ? (
        <div className="relative overflow-hidden rounded-2xl border-2 border-slate-700 bg-slate-950 p-2 shadow-inner select-none">
          <div className="relative w-full aspect-[16/8.2] sm:aspect-[16/7.8] max-h-[610px] rounded-xl overflow-hidden shadow-2xl bg-gradient-to-b from-emerald-950 via-slate-900 to-emerald-950">
            <svg
              viewBox="0 0 1180 580"
              className="w-full h-full object-contain"
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                {/* Textura de Arena para la Pista */}
                <pattern id="arenaPatternV6" width="28" height="28" patternUnits="userSpaceOnUse">
                  <rect width="28" height="28" fill="#92400E" />
                  <circle cx="6" cy="6" r="1.8" fill="#B45309" opacity="0.8" />
                  <circle cx="20" cy="16" r="1.5" fill="#78350F" opacity="0.85" />
                  <circle cx="14" cy="24" r="1.2" fill="#F59E0B" opacity="0.6" />
                  <circle cx="24" cy="8" r="1.0" fill="#D97706" opacity="0.7" />
                </pattern>

                {/* Lago Interior Tradicional de La Rinconada */}
                <linearGradient id="lagoRinconadaV6" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#0284C7" stopOpacity="0.85" />
                  <stop offset="50%" stopColor="#0369A1" stopOpacity="0.9" />
                  <stop offset="100%" stopColor="#075985" stopOpacity="0.95" />
                </linearGradient>

                {/* Sombra de galope de purasangre */}
                <filter id="horseShadowV6" x="-35%" y="-35%" width="170%" height="170%">
                  <feDropShadow dx="2" dy="5" stdDeviation="3.5" floodOpacity="0.7" floodColor="#000" />
                </filter>
              </defs>

              {/* FONDO EXTERIOR: Grama e Instalaciones del Hipódromo */}
              <rect width="1180" height="580" fill="#14532D" />
              <rect x="8" y="8" width="1164" height="564" rx="36" fill="#166534" stroke="#15803D" strokeWidth="2.5" />

              {/* TRIBUNA MONUMENTAL Y PALCO DE HONOR (Sector Inferior Frente a la Meta) */}
              <rect x="340" y="525" width="480" height="26" rx="6" fill="#0F172A" stroke="#334155" strokeWidth="1.5" />
              <text x="580" y="542" textAnchor="middle" fill="#94A3B8" fontSize="10.5" fontWeight="900" letterSpacing="2">
                TRIBUNA MONUMENTAL · HIPÓDROMO LA RINCONADA
              </text>

              {/* ------------------------------------------------------------- */}
              {/* LA PISTA DE ARENA DEL ÓVALO + LA EXTENSIÓN (CHUTE) DE ENFRENTE */}
              {/* ------------------------------------------------------------- */}
              {/* Cuerpo del Óvalo Principal de Arena */}
              <path
                d={`
                  M 260 ${Y_CENTRO - R_EXTERIOR}
                  L 660 ${Y_CENTRO - R_EXTERIOR}
                  A ${R_EXTERIOR} ${R_EXTERIOR} 0 0 1 660 ${Y_CENTRO + R_EXTERIOR}
                  L 260 ${Y_CENTRO + R_EXTERIOR}
                  A ${R_EXTERIOR} ${R_EXTERIOR} 0 0 1 260 ${Y_CENTRO - R_EXTERIOR}
                  Z
                `}
                fill="url(#arenaPatternV6)"
                stroke="#B45309"
                strokeWidth="2.5"
              />

              {/* CUERPO DE LA EXTENSIÓN ("CHUTE") DE LA RECTA DE ENFRENTE */}
              {/* Se prolonga recto hacia la derecha desde X=660 hasta X=1080 */}
              <rect
                x={X_CENTRO_DER}
                y={Y_CENTRO - R_EXTERIOR}
                width={X_MAX_CHUTE - X_CENTRO_DER}
                height={ANCHO_PISTA}
                fill="url(#arenaPatternV6)"
                stroke="#B45309"
                strokeWidth="2"
              />

              {/* Remate del extremo del Chute (Gateras 1.600m) */}
              <line
                x1={X_MAX_CHUTE}
                y1={Y_CENTRO - R_EXTERIOR}
                x2={X_MAX_CHUTE}
                y2={Y_CENTRO - R_RIEL}
                stroke="#FFFFFF"
                strokeWidth="3.5"
              />

              {/* BARANDAS DE LA EXTENSIÓN ("CHUTE") */}
              {/* Baranda exterior del chute (arriba) */}
              <line
                x1={X_CENTRO_DER}
                y1={Y_CENTRO - R_EXTERIOR}
                x2={X_MAX_CHUTE}
                y2={Y_CENTRO - R_EXTERIOR}
                stroke="#FFFFFF"
                strokeWidth="3.5"
              />
              {/* Baranda interior del chute (abajo) */}
              <line
                x1={X_CENTRO_DER}
                y1={Y_CENTRO - R_RIEL}
                x2={X_MAX_CHUTE}
                y2={Y_CENTRO - R_RIEL}
                stroke="#FFFFFF"
                strokeWidth="4"
              />

              {/* Letrero del Chute de Enfrente */}
              <rect x={X_CENTRO_DER + 20} y={Y_CENTRO - R_EXTERIOR - 22} width="280" height="18" rx="4" fill="#0F172A" stroke="#38BDF8" strokeWidth="1.2" />
              <text x={X_CENTRO_DER + 160} y={Y_CENTRO - R_EXTERIOR - 10} textAnchor="middle" fill="#38BDF8" fontSize="8.5" fontWeight="900" letterSpacing="1">
                CHUTE RECTA DE ENFRENTE · PARTIDA 1.400M · 1.500M · 1.600M
              </text>

              {/* BARANDA EXTERIOR DEL ÓVALO (Línea perimetral blanca continua) */}
              <path
                d={`
                  M 260 ${Y_CENTRO - R_EXTERIOR}
                  L 660 ${Y_CENTRO - R_EXTERIOR}
                  A ${R_EXTERIOR} ${R_EXTERIOR} 0 0 1 660 ${Y_CENTRO + R_EXTERIOR}
                  L 260 ${Y_CENTRO + R_EXTERIOR}
                  A ${R_EXTERIOR} ${R_EXTERIOR} 0 0 1 260 ${Y_CENTRO - R_EXTERIOR}
                `}
                fill="none"
                stroke="#FFFFFF"
                strokeWidth="3.5"
                opacity="0.95"
              />

              {/* LÍNEA GUÍA DE MEDIA PISTA */}
              <path
                d={`
                  M 260 ${Y_CENTRO - R_MEDIO}
                  L 660 ${Y_CENTRO - R_MEDIO}
                  A ${R_MEDIO} ${R_MEDIO} 0 0 1 660 ${Y_CENTRO + R_MEDIO}
                  L 260 ${Y_CENTRO + R_MEDIO}
                  A ${R_MEDIO} ${R_MEDIO} 0 0 1 260 ${Y_CENTRO - R_MEDIO}
                `}
                fill="none"
                stroke="#FFFFFF"
                strokeWidth="1.2"
                strokeDasharray="8 8"
                opacity="0.35"
              />

              {/* ------------------------------------------------------------- */}
              {/* INFIELD / ZONA INTERIOR CON LAGO ARTIFICIAL Y GRAMA           */}
              {/* ------------------------------------------------------------- */}
              <path
                d={`
                  M 260 ${Y_CENTRO - R_RIEL}
                  L 660 ${Y_CENTRO - R_RIEL}
                  A ${R_RIEL} ${R_RIEL} 0 0 1 660 ${Y_CENTRO + R_RIEL}
                  L 260 ${Y_CENTRO + R_RIEL}
                  A ${R_RIEL} ${R_RIEL} 0 0 1 260 ${Y_CENTRO - R_RIEL}
                  Z
                `}
                fill="#15803D"
              />

              {/* Lago Artificial Central del Infield */}
              <ellipse cx="460" cy="290" rx="110" ry="42" fill="url(#lagoRinconadaV6)" stroke="#38BDF8" strokeWidth="2" />
              <text x="460" y="288" textAnchor="middle" fill="#E0F2FE" fontSize="9" fontWeight="900" opacity="0.9">
                LAGO ARTIFICIAL INH
              </text>
              <text x="460" y="301" textAnchor="middle" fill="#BAE6FD" fontSize="7.5" fontWeight="bold" opacity="0.8">
                CIRCUITO OFICIAL 1.800 METROS
              </text>

              {/* Tablero Electrónico Central de Progreso */}
              <rect x="385" y="210" width="150" height="26" rx="5" fill="#0F172A" stroke="#334155" strokeWidth="1.5" />
              <text x="460" y="227" textAnchor="middle" fill="#FACC15" fontSize="10.5" fontWeight="900" fontFamily="monospace">
                PROG: {progreso.toFixed(0)}% · {distanciaCarrera}M
              </text>

              {/* BARANDA INTERIOR (EL RIEL - BLANCA RESALTADA) */}
              <path
                d={`
                  M 260 ${Y_CENTRO - R_RIEL}
                  L 660 ${Y_CENTRO - R_RIEL}
                  A ${R_RIEL} ${R_RIEL} 0 0 1 660 ${Y_CENTRO + R_RIEL}
                  L 260 ${Y_CENTRO + R_RIEL}
                  A ${R_RIEL} ${R_RIEL} 0 0 1 260 ${Y_CENTRO - R_RIEL}
                `}
                fill="none"
                stroke="#FFFFFF"
                strokeWidth="4"
                className="drop-shadow-sm"
              />

              {/* ------------------------------------------------------------- */}
              {/* RAYA DE LLEGADA = MARCA DE 1.800 METROS (RECTA FINAL X=580)   */}
              {/* ------------------------------------------------------------- */}
              <g id="lineaMeta1800m">
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
                {/* Cartel de META · 1.800M */}
                <rect x={X_META - 34} y={Y_CENTRO + R_EXTERIOR + 6} width="68" height="20" rx="4" fill="#DC2626" stroke="#FFFFFF" strokeWidth="1.8" />
                <text x={X_META} y={Y_CENTRO + R_EXTERIOR + 20} textAnchor="middle" fill="#FFFFFF" fontSize="9.5" fontWeight="900">
                  META · 1.800M 🏁
                </text>
              </g>

              {/* Postes Oficiales de Distancia (1600m, 1400m en chute, 1200m, 800m, 400m, 200m) */}
              {marcadoresOvalo.map(({ metro, posRiel, posExt }) => {
                if (metro === 0 || metro === 1800) return null;
                return (
                  <g key={metro} opacity="0.88">
                    <line
                      x1={posRiel.x}
                      y1={posRiel.y}
                      x2={posExt.x}
                      y2={posExt.y}
                      stroke="#FACC15"
                      strokeWidth="1.5"
                      strokeDasharray="3 3"
                    />
                    <circle cx={posExt.x} cy={posExt.y} r="3.2" fill="#FACC15" />
                    <text
                      x={posExt.x}
                      y={posExt.y + (posExt.y > Y_CENTRO ? 13 : -9)}
                      textAnchor="middle"
                      fill="#FEF08A"
                      fontSize="9"
                      fontWeight="900"
                      className="font-mono"
                    >
                      {metro}m
                    </text>
                  </g>
                );
              })}

              {/* ------------------------------------------------------------- */}
              {/* APARATO DE PARTIDAS (14 GATERAS) EN EL POSTE OFICIAL          */}
              {/* ------------------------------------------------------------- */}
              <g id="aparatoPartidas14Gateras">
                {/* Viga estructural metálica transversal de baranda a baranda */}
                <line
                  x1={extremosPartidor.riel.x}
                  y1={extremosPartidor.riel.y}
                  x2={extremosPartidor.exterior.x}
                  y2={extremosPartidor.exterior.y}
                  stroke="#1E293B"
                  strokeWidth="8"
                  strokeLinecap="round"
                />

                {/* 14 Cajones Oficiales de Gateras */}
                {partidorEnOvalo.map(({ puerta, x, y, anguloDeg }) => {
                  const gualdrapa = COLORES_GUALDRAPA[puerta] || { bg: "#3B82F6", text: "#FFF" };
                  const tieneCaballo = ranking.some(
                    (r) => (r.ejemplar.puestoPista || (r.ejemplar as unknown as { pp?: number }).pp || r.ejemplar.numero) === puerta
                  );

                  return (
                    <g
                      key={puerta}
                      transform={`translate(${x}, ${y}) rotate(${anguloDeg})`}
                    >
                      <title>{`Gatera PP #${puerta} ${tieneCaballo ? "(Ejemplar asignado)" : "(Vacante)"}`}</title>
                      {/* Cajón de Salida */}
                      <rect
                        x="-7.5"
                        y="-2.2"
                        width="15"
                        height="4.4"
                        rx="1"
                        fill={gualdrapa.bg}
                        stroke={tieneCaballo ? "#22C55E" : "#475569"}
                        strokeWidth={tieneCaballo ? "1.4" : "0.6"}
                        className={tieneCaballo ? "filter drop-shadow-sm" : "opacity-75"}
                      />
                      {/* Número de Gatera */}
                      <text
                        x="0"
                        y="1.2"
                        textAnchor="middle"
                        fill={gualdrapa.text}
                        fontSize="3.6"
                        fontWeight="900"
                        fontFamily="monospace"
                      >
                        {puerta}
                      </text>
                    </g>
                  );
                })}

                {/* Letrero del Partidor en la Baranda Exterior */}
                {(() => {
                  const posLetrero = calcularPosicionEnOvalo(distanciaCarrera, 1.14, distanciaCarrera);
                  return (
                    <text
                      x={posLetrero.x}
                      y={posLetrero.y + (posLetrero.y > Y_CENTRO ? 17 : -12)}
                      textAnchor="middle"
                      fill="#34D399"
                      fontSize="10"
                      fontWeight="900"
                      letterSpacing="0.8"
                    >
                      PARTIDOR {distanciaCarrera}M {usaExtensionChute ? "(EN CHUTE RECTO)" : "(14 GATERAS)"}
                    </text>
                  );
                })()}
              </g>

              {/* ------------------------------------------------------------- */}
              {/* PURASANGRES AL GALOPE CON INDICADORES DE ALTA VISIBILIDAD     */}
              {/* ------------------------------------------------------------- */}
              {posicionesCalculadas.map(({ item, puertaSalida, x, y, anguloDeg }) => {
                const { ejemplar, ordenLlegadaProyectado } = item;
                const gualdrapa = COLORES_GUALDRAPA[ejemplar.numero] || { bg: "#3B82F6", text: "#FFF" };
                const estaSeleccionado = caballoSeleccionado === ejemplar.numero;
                const esLiderActual = ordenLlegadaProyectado === 1;

                return (
                  <g
                    key={ejemplar.numero}
                    transform={`translate(${x}, ${y}) rotate(${anguloDeg})`}
                    onClick={() => setCaballoSeleccionado(ejemplar.numero)}
                    className="cursor-pointer"
                    filter="url(#horseShadowV6)"
                  >
                    {/* Sombra de galope sobre la arena */}
                    <ellipse cx="-4" cy="2" rx="16" ry="6" fill="#000000" opacity="0.45" />

                    {/* Aura dorada si está seleccionado */}
                    {estaSeleccionado && (
                      <circle cx="0" cy="0" r="18" fill="none" stroke="#FACC15" strokeWidth="2.8" strokeDasharray="4 3" className="animate-spin" />
                    )}

                    {/* Silueta de Purasangre Estilizado */}
                    <g transform="scale(0.40) translate(-36, -26)">
                      {/* Cuerpo del Caballo */}
                      <path
                        d="M 10 40 L 30 20 L 58 20 L 76 35 L 68 48 L 20 48 Z"
                        fill="#78350F"
                        stroke="#451A03"
                        strokeWidth="2.5"
                      />
                      {/* Cuello y Cabeza hacia adelante */}
                      <path
                        d="M 58 20 L 74 6 L 86 8 L 84 18 L 70 30 Z"
                        fill="#854D0E"
                        stroke="#451A03"
                        strokeWidth="2.5"
                      />
                      {/* Gualdrapa Oficial con Número Grande y Nítido */}
                      <rect
                        x="28"
                        y="14"
                        width="30"
                        height="22"
                        rx="4"
                        fill={gualdrapa.bg}
                        stroke="#0F172A"
                        strokeWidth="2.5"
                      />
                      <text
                        x="43"
                        y="31"
                        textAnchor="middle"
                        fontSize="17"
                        fontWeight="900"
                        fill={gualdrapa.text}
                        fontFamily="monospace"
                      >
                        {ejemplar.numero}
                      </text>
                      {/* Casco del Jockey */}
                      <circle cx="48" cy="7" r="7" fill="#0F172A" stroke="#F8FAFC" strokeWidth="2" />
                    </g>

                    {/* ======================================================= */}
                    {/* INDICADOR DE ALTA VISIBILIDAD (PIN / BANDERA DE CARRERA) */}
                    {/* ======================================================= */}
                    {/* Mástil y banderín vertical que acompaña al ejemplar en todo momento */}
                    <g transform="translate(0, -22)">
                      {/* Triángulo/flecha indicadora hacia el caballo */}
                      <polygon points="-3,-1 3,-1 0,3" fill={gualdrapa.bg} />

                      {/* Caja del Indicador de Alta Visibilidad */}
                      <rect
                        x="-24"
                        y="-16"
                        width="48"
                        height="16"
                        rx="4"
                        fill="#0F172A"
                        stroke={estaSeleccionado ? "#FACC15" : gualdrapa.bg}
                        strokeWidth={estaSeleccionado ? "2.2" : "1.8"}
                        className="filter drop-shadow-md"
                      />

                      {/* Icono de corona si es el líder proyectado */}
                      {esLiderActual && (
                        <text x="-16" y="-5" fontSize="8" fill="#FACC15">
                          👑
                        </text>
                      )}

                      {/* Número Oficial del Ejemplar (#N) */}
                      <text
                        x={esLiderActual ? "-2" : "-8"}
                        y="-4.5"
                        textAnchor="middle"
                        fill={gualdrapa.bg === "#FFFFFF" ? "#38BDF8" : gualdrapa.bg}
                        fontSize="10"
                        fontWeight="900"
                        fontFamily="monospace"
                      >
                        #{ejemplar.numero}
                      </text>

                      {/* Puesto de Partida Oficial (PP) */}
                      <text
                        x={esLiderActual ? "13" : "11"}
                        y="-4.5"
                        textAnchor="middle"
                        fill="#FFFFFF"
                        fontSize="7.5"
                        fontWeight="800"
                        fontFamily="monospace"
                      >
                        PP{puertaSalida}
                      </text>
                    </g>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      ) : (
        /* VISTA COMPACTA CUANDO LA PISTA ESTÁ OCULTA */
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-center flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🏟️</span>
            <div className="text-left">
              <p className="text-xs font-black uppercase text-slate-800">
                Pista Ovalada de 1.800m Oculta
              </p>
              <p className="text-[11px] text-slate-500">
                Fase: <b>{faseActiva}</b> ({progreso.toFixed(0)}%) · Distancia: <b>{distanciaCarrera}m</b> {usaExtensionChute ? "(Chute Extensión)" : "(Óvalo)"} · Partidor de 14 gateras
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMostrarPista(true)}
            className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs shadow-xs"
          >
            👁️ Mostrar Pista de Carreras
          </button>
        </div>
      )}

      {/* 3. BARRA DE CONTROL DE LA SIMULACIÓN */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
        <div className="flex items-center gap-2">
          {/* Botón de Partida Rápida */}
          <button
            type="button"
            onClick={() => saltarAFase("PARTIDA")}
            className="px-3 py-1.5 rounded-xl font-bold text-xs bg-slate-200 hover:bg-slate-300 text-slate-800 transition-all"
            title={`Alinear ejemplares en el poste de ${distanciaCarrera}m`}
          >
            ⏮️ Partida ({distanciaCarrera}m)
          </button>

          {/* Botón Principal de Simulación */}
          <button
            type="button"
            onClick={() => {
              if (progreso >= 100) setProgreso(0);
              setReproduciendo(!reproduciendo);
            }}
            className={`px-4 py-2 rounded-xl font-black text-xs text-white shadow-md transition-all flex items-center gap-1.5 ${
              reproduciendo
                ? "bg-amber-600 hover:bg-amber-500 animate-pulse"
                : progreso >= 100
                ? "bg-slate-900 hover:bg-slate-800"
                : "bg-emerald-600 hover:bg-emerald-500"
            }`}
          >
            <span>{reproduciendo ? "⏸️" : "🏇"}</span>
            <span>
              {reproduciendo
                ? "Pausar Carrera"
                : progreso >= 100
                ? "🔁 Repetir Carrera"
                : "▶️ Simular Carrera"}
            </span>
          </button>

          {/* Selector de Velocidad */}
          <div className="flex items-center bg-white rounded-lg border border-slate-200 p-0.5 text-xs font-bold">
            {[1, 2, 4].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setVelocidad(v)}
                className={`px-2 py-0.5 rounded ${
                  velocidad === v ? "bg-slate-900 text-white font-black" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {v}x
              </button>
            ))}
          </div>
        </div>

        {/* Scrubber / Slider Deslizante de Progreso */}
        <div className="flex-1 min-w-[200px] flex items-center gap-3">
          <span className="text-[10px] font-black uppercase text-slate-500 font-mono">
            {progreso.toFixed(0)}%
          </span>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={progreso}
            onChange={(e) => {
              setReproduciendo(false);
              setProgreso(Number(e.target.value));
            }}
            className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-emerald-600"
          />
          <span className="text-[10px] font-black uppercase text-slate-700 font-mono">
            {progreso < 12
              ? `Partida ${distanciaCarrera}m ${usaExtensionChute ? "(Chute)" : ""}`
              : progreso < 65
              ? "Codo 800m (Riel Interior)"
              : progreso < 95
              ? "Recta Final (Tribunas)"
              : "Meta 🏁"}
          </span>
        </div>

        {/* Selector de Ejemplar Activo para Enfoque */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold text-slate-500">Ver Ejemplar:</span>
          <select
            value={caballoSeleccionado ?? ranking[0]?.ejemplar.numero}
            onChange={(e) => setCaballoSeleccionado(Number(e.target.value))}
            className="rounded-lg border border-slate-300 bg-white py-1 px-2 text-xs font-bold text-slate-800"
          >
            {ranking.map((r) => {
              const pp = r.ejemplar.puestoPista || (r.ejemplar as unknown as { pp?: number }).pp || r.ejemplar.numero;
              return (
                <option key={r.ejemplar.numero} value={r.ejemplar.numero}>
                  #{r.ejemplar.numero} - {r.ejemplar.nombre} (PP: {pp}) ({r.ordenLlegadaProyectado}°)
                </option>
              );
            })}
          </select>
        </div>
      </div>

      {/* 4. TARJETA DE DETALLE TÉCNICO Y DIVISA DEL EJEMPLAR EN EL ORDEN PROYECTADO */}
      {caballoActivo && (() => {
        const gualdrapaActiva = COLORES_GUALDRAPA[caballoActivo.ejemplar.numero] || {
          bg: "#3B82F6",
          text: "#FFFFFF",
          border: "#1D4ED8",
          nombreColor: "Azul",
        };
        const puertaPartidaActiva = Math.min(
          14,
          Math.max(1, caballoActivo.ejemplar.puestoPista || (caballoActivo.ejemplar as unknown as { pp?: number }).pp || caballoActivo.ejemplar.numero || 1)
        );

        return (
          <div className="rounded-xl border border-slate-200 bg-gradient-to-r from-slate-50 via-white to-emerald-50/30 p-3.5 shadow-xs flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span
                style={{
                  backgroundColor: gualdrapaActiva.bg,
                  color: gualdrapaActiva.text,
                  borderColor: gualdrapaActiva.border,
                }}
                className="inline-grid h-12 w-12 min-w-[48px] place-items-center rounded-xl font-mono font-black text-xl border-2 shadow-sm shrink-0"
                title={`Ejemplar #${caballoActivo.ejemplar.numero} (${gualdrapaActiva.nombreColor})`}
              >
                {caballoActivo.ejemplar.numero}
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <span className="rounded bg-slate-900 text-white font-mono px-1.5 py-0.2 text-[10px] font-black">
                    Llegada: {caballoActivo.ordenLlegadaProyectado}° Lugar
                  </span>
                  <span className="rounded bg-emerald-100 text-emerald-900 border border-emerald-300 font-mono px-1.5 py-0.2 text-[10px] font-bold">
                    🚪 Gatera PP: #{puertaPartidaActiva}
                  </span>
                  <h4 className="text-sm font-black uppercase text-slate-900">
                    #{caballoActivo.ejemplar.numero} {caballoActivo.ejemplar.nombre}
                  </h4>
                  {caballoActivo.favorecidoTendenciaTarde && (
                    <span className="rounded-full bg-amber-100 text-amber-900 border border-amber-300 px-2 py-0.2 text-[9px] font-black">
                      ⚡ Favorecido por Tendencia
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500">
                  Jinete: <b>{caballoActivo.ejemplar.jinete || "N/A"}</b> | Stud: <b>{caballoActivo.ejemplar.stud || "Tradicional"}</b> | Estilo: <b>{caballoActivo.ejemplar.estilo}</b> | Puerta de Partida: <b>PP {puertaPartidaActiva}</b>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 text-right">
              <div>
                <span className="text-[10px] font-black uppercase text-slate-400 block">
                  Probabilidad SMIC
                </span>
                <span className="text-base font-black text-indigo-700">
                  {caballoActivo.probabilidadSMIC.toFixed(1)}%
                </span>
              </div>
              <div className="border-l border-slate-200 pl-3">
                <span className="text-[10px] font-black uppercase text-slate-400 block">
                  Cuerpos Proyectados
                </span>
                <span className="text-base font-black text-slate-800">
                  {caballoActivo.ordenLlegadaProyectado === 1
                    ? "Ganador"
                    : `+${(caballoActivo.cuerposVentaja ?? 2.5).toFixed(1)} cpos`}
                </span>
              </div>
              <div className="border-l border-slate-200 pl-3">
                <span className="text-[10px] font-black uppercase text-slate-400 block">
                  Score Godet v4
                </span>
                <span className="text-base font-black text-emerald-700">
                  {caballoActivo.scoreGodetTotal.toFixed(1)} pts
                </span>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
