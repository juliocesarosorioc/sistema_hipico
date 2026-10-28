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
 * GEOMETRÍA PARAMÉTRICA DE LA PISTA DE CARRERAS DE 1.800 METROS (LA RINCONADA)
 * ============================================================================
 * - Perímetro total de la pista = 1.800 metros.
 * - Sentido antihorario reglamentario (la baranda interior queda a la izquierda).
 * - Componentes del óvalo (viewBox 0 0 1000 560):
 *     1. Recta Final (inferior, Y = 455, avance de Oeste a Este): Meta en X = 650.
 *     2. Primer Codo (derecha, centro en X=700, Y=280).
 *     3. Recta de Enfrente / Opuesta (superior, Y = 105, avance de Este a Oeste).
 *     4. Codo Final / Curva de los 800m (izquierda, centro en X=300, Y=280).
 * ============================================================================
 */

// Dimensiones geométricas base en píxeles (1 unidad gráfica ≈ 1 metro real)
const X_CENTRO_IZQ = 300;
const X_CENTRO_DER = 700;
const Y_CENTRO = 280;
const LONG_RECTA = 400; // de X=300 a X=700 (400 metros de recta)

// Radios radiales de la pista
const R_RIEL = 135;       // Baranda interior (El Riel)
const R_EXTERIOR = 215;   // Baranda exterior
const ANCHO_PISTA = R_EXTERIOR - R_RIEL; // 80 metros de ancho
const R_MEDIO = (R_RIEL + R_EXTERIOR) / 2; // 175m

// Longitudes reales del óvalo de 1.800m:
// 2 rectas de 400m = 800m
// 2 semicírculos de radio 175m = 2 * PI * 175 ≈ 1.100m
// Perímetro gráfico ≈ 1.900m -> Factor de escala a exactamente 1.800 metros:
const PERIMETRO_PISTA_GRAFICO = 2 * LONG_RECTA + 2 * Math.PI * R_MEDIO;
const FACTOR_METRO = PERIMETRO_PISTA_GRAFICO / 1800;

// Ubicación de la Meta en la Recta Final: X = 630, Y = 455 (a 70m antes del primer codo)
const X_META = 630;
const DISTANCIA_META_DESDE_SALIDA_CODO = X_META - X_CENTRO_IZQ; // 330m

/**
 * Calcula las coordenadas (x, y) y ángulo de rotación (en grados) para cualquier
 * distancia que reste hasta la meta (distanciaRestante en metros) y posición transversal
 * (lambdaRiel: 0 = baranda interior, 1 = baranda exterior).
 */
export function calcularPosicionEnOvalo(
  distanciaRestanteMetros: number,
  lambdaRiel: number = 0.2 // Por defecto pegado a la baranda interior
): { x: number; y: number; anguloDeg: number; tramo: string } {
  // Ajuste de radio según la posición del ejemplar en la pista
  const rEfectivo = R_RIEL + Math.max(0.08, Math.min(0.92, lambdaRiel)) * ANCHO_PISTA;
  const longSemicirculo = Math.PI * rEfectivo;
  const perimetroTotal = 2 * LONG_RECTA + 2 * longSemicirculo;

  // Distancia gráfica recorrida hacia atrás desde la meta
  const dGrafica = Math.max(0, distanciaRestanteMetros) * FACTOR_METRO;
  const dMod = ((dGrafica % perimetroTotal) + perimetroTotal) % perimetroTotal;

  // Coordenadas locales de la meta:
  // La meta está en la recta final inferior a distancia D_meta desde el final del codo izquierdo
  const dMetaDesdeCodoIzq = DISTANCIA_META_DESDE_SALIDA_CODO;

  // Tramo 1: Recta Final (desde entrada a la recta hasta la meta)
  if (dMod <= dMetaDesdeCodoIzq) {
    const x = X_META - dMod;
    const y = Y_CENTRO + rEfectivo;
    return { x, y, anguloDeg: 0, tramo: "RECTA_FINAL" };
  }

  // Tramo 2: Codo Final (Curva de los 800m a 400m)
  const dEnCodoIzq = dMod - dMetaDesdeCodoIzq;
  if (dEnCodoIzq <= longSemicirculo) {
    const fraccion = dEnCodoIzq / longSemicirculo;
    // Ángulo desde pi/2 (abajo) hacia 3pi/2 (arriba) en sentido horario hacia atrás
    const angulo = Math.PI / 2 + fraccion * Math.PI;
    const x = X_CENTRO_IZQ + rEfectivo * Math.cos(angulo);
    const y = Y_CENTRO + rEfectivo * Math.sin(angulo);
    // Dirección tangente de avance: perpendicular en sentido antihorario
    const anguloDeg = (angulo - Math.PI / 2) * (180 / Math.PI);
    return { x, y, anguloDeg, tramo: "CODO_FINAL" };
  }

  // Tramo 3: Recta de Enfrente / Backstretch (de X=300 a X=700 en la parte superior)
  const dEnRectaOpuesta = dEnCodoIzq - longSemicirculo;
  if (dEnRectaOpuesta <= LONG_RECTA) {
    const x = X_CENTRO_IZQ + dEnRectaOpuesta;
    const y = Y_CENTRO - rEfectivo;
    return { x, y, anguloDeg: 180, tramo: "RECTA_ENFRENTE" };
  }

  // Tramo 4: Primer Codo (Curva después de la meta)
  const dEnPrimerCodo = dEnRectaOpuesta - LONG_RECTA;
  if (dEnPrimerCodo <= longSemicirculo) {
    const fraccion = dEnPrimerCodo / longSemicirculo;
    const angulo = (3 * Math.PI) / 2 + fraccion * Math.PI;
    const x = X_CENTRO_DER + rEfectivo * Math.cos(angulo);
    const y = Y_CENTRO + rEfectivo * Math.sin(angulo);
    const anguloDeg = (angulo - Math.PI / 2) * (180 / Math.PI);
    return { x, y, anguloDeg, tramo: "PRIMER_CODO" };
  }

  // Tramo 5: Tramo de Recta Final después del primer codo antes de la meta
  const dResto = dEnPrimerCodo - longSemicirculo;
  const x = X_CENTRO_DER - dResto;
  const y = Y_CENTRO + rEfectivo;
  return { x, y, anguloDeg: 0, tramo: "RECTA_FINAL" };
}

/** Puestos de partida oficiales (1 al 14) */
export const GATERAS_14 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] as const;

export function SimuladorPistaCarrera2D({
  resultado,
  factorPistaActual = "NORMAL",
  carrilActual = "RIEL",
  estiloActual = "E1",
  tendenciaActiva = false,
  className = "",
}: Props) {
  // Estado para ocultar/mostrar la pista según preferencia del usuario
  const [mostrarPista, setMostrarPista] = useState<boolean>(true);

  // Distancia oficial de la carrera (ej: 1200m, 1400m, 1600m, 1800m)
  const distanciaCarrera = useMemo(() => {
    const d = Number(resultado.distancia);
    return Number.isFinite(d) && d >= 800 && d <= 2400 ? d : 1400;
  }, [resultado.distancia]);

  // Progreso de carrera: 0% (alineados en las 14 gateras) a 100% (sentencia en la meta)
  const [progreso, setProgreso] = useState<number>(100);
  const [reproduciendo, setReproduciendo] = useState<boolean>(false);
  const [velocidad, setVelocidad] = useState<number>(1);
  const [caballoSeleccionado, setCaballoSeleccionado] = useState<number | null>(null);
  const [faseActiva, setFaseActiva] = useState<FaseCarrera>("META");
  const requestRef = useRef<number | null>(null);
  const ultimoTiempoRef = useRef<number | null>(null);

  // Ordenar el ranking actuarial por orden proyectado de llegada
  const ranking = useMemo(() => {
    return [...resultado.ranking].sort(
      (a, b) => a.ordenLlegadaProyectado - b.ordenLlegadaProyectado
    );
  }, [resultado.ranking]);

  // Selección inicial del favorito
  useEffect(() => {
    if (caballoSeleccionado === null && ranking.length > 0) {
      setCaballoSeleccionado(ranking[0].ejemplar.numero);
    }
  }, [ranking, caballoSeleccionado]);

  // Sincronizar fases hípicas según el porcentaje de avance
  useEffect(() => {
    if (progreso < 15) setFaseActiva("PARTIDA");
    else if (progreso < 65) setFaseActiva("CODO");
    else if (progreso < 95) setFaseActiva("RECTA");
    else setFaseActiva("META");
  }, [progreso]);

  // Motor de animación a 60 FPS ULTRA-ARMÓNICO:
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
        // Velocidad suave: ~10 segundos de simulación a 1x para recorrer el óvalo
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

  // Navegación rápida entre fases oficiales
  const saltarAFase = useCallback((fase: FaseCarrera) => {
    setReproduciendo(false);
    if (fase === "PARTIDA") setProgreso(0);
    if (fase === "CODO") setProgreso(45);
    if (fase === "RECTA") setProgreso(78);
    if (fase === "META") setProgreso(100);
  }, []);

  // Metros restantes para cada ejemplar a lo largo del óvalo de 1.800m
  const posicionesCalculadas = useMemo(() => {
    // Desfase en metros en la sentencia de meta para cada ejemplar (1 cuerpo ≈ 2.5 metros)
    let acumuladoMetrosAtras = 0;
    const desfaseMetaPorEjemplar: number[] = [];

    for (let i = 0; i < ranking.length; i++) {
      if (i === 0) {
        desfaseMetaPorEjemplar.push(0);
      } else {
        const cuerpos = Math.max(ranking[i].cuerposVentaja || 0.5, 0.25);
        acumuladoMetrosAtras += cuerpos * 2.5;
        desfaseMetaPorEjemplar.push(acumuladoMetrosAtras);
      }
    }

    const avanceFraccion = Math.max(0, Math.min(1, progreso / 100));

    return ranking.map((item, index) => {
      const { ejemplar, ordenLlegadaProyectado, favorecidoTendenciaTarde } = item;
      const estilo = ejemplar.estilo;

      // Puerta oficial asignada por la columna PP (1 al 14)
      const puertaSalida = Math.min(
        14,
        Math.max(1, ejemplar.puestoPista || (ejemplar as unknown as { pp?: number }).pp || ejemplar.numero || (index + 1))
      );

      // Posición transversal en la gatera al partir:
      // Puerta 1 en la baranda interior (lambda = 0.12); Puerta 14 en la baranda exterior (lambda = 0.88)
      const lambdaPartida = 0.12 + ((puertaSalida - 1) / 13) * 0.76;

      // =======================================================================
      // REGLA FUNDAMENTAL DE PISTA:
      // "Los caballos en la pista de carreras tienden a acercarse a la baranda interior para correr"
      // =======================================================================
      // Al salir de las gateras, todos los ejemplares convergen hacia la baranda interior (riel).
      // Punteros E1: pegados al riel (lambda = 0.12 a 0.16)
      // Colocados E2: segunda línea (lambda = 0.22 a 0.28)
      // Rematadores E3: tercera línea (lambda = 0.34 a 0.40)
      let lambdaObjetivoRiel = 0.14;
      if (estilo === "E1") lambdaObjetivoRiel = 0.14;
      else if (estilo === "E2") lambdaObjetivoRiel = 0.24;
      else lambdaObjetivoRiel = 0.35;

      // En la recta final (últimos metros hacia la meta), los rematadores se abren
      let lambdaActual = lambdaPartida;
      if (avanceFraccion <= 0) {
        lambdaActual = lambdaPartida;
      } else if (avanceFraccion < 0.30) {
        // Fase de cierre hacia la baranda interior
        const tCierre = avanceFraccion / 0.30;
        lambdaActual = lambdaPartida + tCierre * (lambdaObjetivoRiel - lambdaPartida);
      } else if (avanceFraccion < 0.75) {
        // Corriendo pegados a la baranda interior por el codo y recta opuesta
        lambdaActual = lambdaObjetivoRiel;
      } else {
        // En la recta final, abanico de llegada para fotofinish claro
        const tMeta = (avanceFraccion - 0.75) / 0.25;
        const lambdaAndarivelMeta = 0.12 + (index / Math.max(1, ranking.length - 1)) * 0.70;
        lambdaActual = lambdaObjetivoRiel * (1 - tMeta) + lambdaAndarivelMeta * tMeta;
      }

      // Distancia recorrida por este ejemplar según su proyección actuarial
      const metrosTotalesCarrera = distanciaCarrera;
      const desfaseFinal = desfaseMetaPorEjemplar[index];
      
      // Dinámica de carrera por estilos tácticos:
      // E1 lidera en la primera mitad; E3 remata en el tramo final
      let factorAvanceIndividual = avanceFraccion;
      if (estilo === "E1" && avanceFraccion < 0.6) {
        factorAvanceIndividual = Math.min(1, avanceFraccion * 1.08);
      } else if (estilo === "E3" && avanceFraccion < 0.5) {
        factorAvanceIndividual = avanceFraccion * 0.94;
      } else if (estilo === "E3" && avanceFraccion >= 0.7) {
        const tRemate = (avanceFraccion - 0.7) / 0.3;
        factorAvanceIndividual = 0.7 + tRemate * 0.3;
      }

      const distanciaRecorrida = factorAvanceIndividual * metrosTotalesCarrera;
      // Metros restantes hasta la meta:
      const distanciaRestante = Math.max(0, metrosTotalesCarrera - distanciaRecorrida + desfaseFinal * (avanceFraccion));

      // Mapeo a coordenadas exactas del óvalo de 1.800m
      const pos = calcularPosicionEnOvalo(distanciaRestante, lambdaActual);

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

  // Coordenadas del aparato de 14 gateras en el óvalo según la distancia de la carrera
  const partidorEnOvalo = useMemo(() => {
    return GATERAS_14.map((puerta) => {
      const lambdaGatera = 0.12 + ((puerta - 1) / 13) * 0.76;
      const pos = calcularPosicionEnOvalo(distanciaCarrera, lambdaGatera);
      return { puerta, ...pos };
    });
  }, [distanciaCarrera]);

  // Marcadores de distancia alrededor del óvalo de 1.800m
  const marcadoresOvalo = useMemo(() => {
    const metros = [1800, 1600, 1400, 1200, 1000, 800, 600, 400, 200, 0];
    return metros.map((m) => {
      const posRiel = calcularPosicionEnOvalo(m, 0.02);
      const posExt = calcularPosicionEnOvalo(m, 0.98);
      return { metro: m, posRiel, posExt };
    });
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
              <span>Pista de Carreras Ovalada (Circuito Oficial 1.800 Metros)</span>
              <span className="rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 px-2 py-0.2 text-[9px] font-black">
                DISTANCIA: {distanciaCarrera}M · ÓVALO LA RINCONADA
              </span>
            </h3>
            <p className="text-[11px] text-slate-500">
              Circuito cerrado de 1.800m con baranda interior (riel), codos reglamentarios y gateras en el poste de {distanciaCarrera}m.
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

      {/* 2. PISTA DE CARRERAS TIPO ÓVALO DE 1.800 METROS */}
      {mostrarPista ? (
        <div className="relative overflow-hidden rounded-2xl border-2 border-slate-700 bg-slate-950 p-2 shadow-inner select-none">
          <div className="relative w-full aspect-[16/9] sm:aspect-[16/8.5] max-h-[580px] rounded-xl overflow-hidden shadow-2xl bg-gradient-to-b from-emerald-950 via-slate-900 to-emerald-950">
            <svg
              viewBox="0 0 1000 560"
              className="w-full h-full object-contain"
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                {/* Textura de Arena para la Pista */}
                <pattern id="arenaPattern" width="20" height="20" patternUnits="userSpaceOnUse">
                  <rect width="20" height="20" fill="#92400E" />
                  <circle cx="4" cy="4" r="1.2" fill="#B45309" opacity="0.6" />
                  <circle cx="14" cy="12" r="1" fill="#78350F" opacity="0.8" />
                  <circle cx="10" cy="18" r="0.8" fill="#F59E0B" opacity="0.4" />
                </pattern>

                {/* Gradiente para el Espejo de Agua central de La Rinconada */}
                <linearGradient id="lagoRinconada" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#0284C7" stopOpacity="0.85" />
                  <stop offset="50%" stopColor="#0369A1" stopOpacity="0.9" />
                  <stop offset="100%" stopColor="#075985" stopOpacity="0.95" />
                </linearGradient>

                {/* Sombra suave para los purasangres */}
                <filter id="horseShadow" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="2" dy="4" stdDeviation="3" floodOpacity="0.6" floodColor="#000" />
                </filter>
              </defs>

              {/* FONDO EXTERIOR: Grama/Instalaciones del Hipódromo */}
              <rect width="1000" height="560" fill="#14532D" />
              <rect x="10" y="10" width="980" height="540" rx="40" fill="#166534" stroke="#15803D" strokeWidth="2" />

              {/* TRIBUNA PRINCIPAL Y PALCO DE HONOR (Sector Inferior) */}
              <rect x="420" y="525" width="400" height="25" rx="5" fill="#1E293B" stroke="#475569" strokeWidth="1.5" />
              <text x="620" y="542" textAnchor="middle" fill="#94A3B8" fontSize="10" fontWeight="900" letterSpacing="2">
                TRIBUNA MONUMENTAL · LA RINCONADA
              </text>

              {/* ------------------------------------------------------------- */}
              {/* LA PISTA DE ARENA DEL ÓVALO (TRAZADO CONTINUO DE 1.800M)     */}
              {/* ------------------------------------------------------------- */}
              {/* Cuerpo de Arena de la Pista (Espacio entre baranda exterior e interior) */}
              <path
                d={`
                  M 300 ${Y_CENTRO - R_EXTERIOR}
                  L 700 ${Y_CENTRO - R_EXTERIOR}
                  A ${R_EXTERIOR} ${R_EXTERIOR} 0 0 1 700 ${Y_CENTRO + R_EXTERIOR}
                  L 300 ${Y_CENTRO + R_EXTERIOR}
                  A ${R_EXTERIOR} ${R_EXTERIOR} 0 0 1 300 ${Y_CENTRO - R_EXTERIOR}
                  Z
                `}
                fill="url(#arenaPattern)"
                stroke="#B45309"
                strokeWidth="2"
              />

              {/* Carril de Media Pista (Línea Discontinua Blanca) */}
              <path
                d={`
                  M 300 ${Y_CENTRO - R_MEDIO}
                  L 700 ${Y_CENTRO - R_MEDIO}
                  A ${R_MEDIO} ${R_MEDIO} 0 0 1 700 ${Y_CENTRO + R_MEDIO}
                  L 300 ${Y_CENTRO + R_MEDIO}
                  A ${R_MEDIO} ${R_MEDIO} 0 0 1 300 ${Y_CENTRO - R_MEDIO}
                `}
                fill="none"
                stroke="#FFFFFF"
                strokeWidth="1.5"
                strokeDasharray="8 8"
                opacity="0.35"
              />

              {/* BARANDA EXTERIOR (Línea blanca continua perimetral) */}
              <path
                d={`
                  M 300 ${Y_CENTRO - R_EXTERIOR}
                  L 700 ${Y_CENTRO - R_EXTERIOR}
                  A ${R_EXTERIOR} ${R_EXTERIOR} 0 0 1 700 ${Y_CENTRO + R_EXTERIOR}
                  L 300 ${Y_CENTRO + R_EXTERIOR}
                  A ${R_EXTERIOR} ${R_EXTERIOR} 0 0 1 300 ${Y_CENTRO - R_EXTERIOR}
                `}
                fill="none"
                stroke="#FFFFFF"
                strokeWidth="3.5"
              />

              {/* ------------------------------------------------------------- */}
              {/* ZONA INTERIOR DEL ÓVALO (INFIELD / ESPOJO DE AGUA / GRAMA)    */}
              {/* ------------------------------------------------------------- */}
              {/* Recorte del Infield Interior */}
              <path
                d={`
                  M 300 ${Y_CENTRO - R_RIEL}
                  L 700 ${Y_CENTRO - R_RIEL}
                  A ${R_RIEL} ${R_RIEL} 0 0 1 700 ${Y_CENTRO + R_RIEL}
                  L 300 ${Y_CENTRO + R_RIEL}
                  A ${R_RIEL} ${R_RIEL} 0 0 1 300 ${Y_CENTRO - R_RIEL}
                  Z
                `}
                fill="#15803D"
              />

              {/* Espejo de Agua Central (Lago Tradicional del Hipódromo) */}
              <ellipse cx="500" cy="280" rx="130" ry="55" fill="url(#lagoRinconada)" stroke="#38BDF8" strokeWidth="2" />
              <text x="500" y="278" textAnchor="middle" fill="#E0F2FE" fontSize="9" fontWeight="900" opacity="0.85">
                LAGO ARTIFICIAL INH
              </text>
              <text x="500" y="292" textAnchor="middle" fill="#BAE6FD" fontSize="8" fontWeight="bold" opacity="0.75">
                CIRCUITO 1.800 METROS
              </text>

              {/* Pizarra Electrónica Central de Tiempos y Parciales */}
              <rect x="440" y="200" width="120" height="24" rx="4" fill="#0F172A" stroke="#334155" strokeWidth="1.5" />
              <text x="500" y="215" textAnchor="middle" fill="#FACC15" fontSize="9" fontWeight="900" fontFamily="monospace">
                PROG: {progreso.toFixed(0)}% · {distanciaCarrera}M
              </text>

              {/* BARANDA INTERIOR (EL RIEL - BLANCA RESALTADA) */}
              <path
                d={`
                  M 300 ${Y_CENTRO - R_RIEL}
                  L 700 ${Y_CENTRO - R_RIEL}
                  A ${R_RIEL} ${R_RIEL} 0 0 1 700 ${Y_CENTRO + R_RIEL}
                  L 300 ${Y_CENTRO + R_RIEL}
                  A ${R_RIEL} ${R_RIEL} 0 0 1 300 ${Y_CENTRO - R_RIEL}
                `}
                fill="none"
                stroke="#FFFFFF"
                strokeWidth="4"
                className="drop-shadow-sm"
              />

              {/* ------------------------------------------------------------- */}
              {/* SEÑALIZACIONES OFICIALES Y METROS ALREDEDOR DEL ÓVALO         */}
              {/* ------------------------------------------------------------- */}
              {/* Línea de META / SENTENCIA (en la Recta Final en X=630) */}
              <g id="lineaMeta">
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
                  strokeWidth="2"
                  strokeDasharray="4 4"
                />
                {/* Cartel de META */}
                <rect x={X_META - 22} y={Y_CENTRO + R_EXTERIOR + 8} width="44" height="18" rx="4" fill="#DC2626" stroke="#FFFFFF" strokeWidth="1.5" />
                <text x={X_META} y={Y_CENTRO + R_EXTERIOR + 20} textAnchor="middle" fill="#FFFFFF" fontSize="9" fontWeight="900">
                  META 🏁
                </text>
              </g>

              {/* Postes Oficiales de Distancia (800m, 400m, 200m, 1200m, 1400m) */}
              {marcadoresOvalo.map(({ metro, posRiel, posExt }) => {
                if (metro === 0 || metro === 1800) return null;
                return (
                  <g key={metro} opacity="0.85">
                    <line
                      x1={posRiel.x}
                      y1={posRiel.y}
                      x2={posExt.x}
                      y2={posExt.y}
                      stroke="#FACC15"
                      strokeWidth="1.5"
                      strokeDasharray="3 3"
                    />
                    <circle cx={posExt.x} cy={posExt.y} r="3" fill="#FACC15" />
                    <text
                      x={posExt.x}
                      y={posExt.y + (posExt.y > Y_CENTRO ? 12 : -8)}
                      textAnchor="middle"
                      fill="#FEF08A"
                      fontSize="8"
                      fontWeight="900"
                      className="font-mono"
                    >
                      {metro}m
                    </text>
                  </g>
                );
              })}

              {/* ------------------------------------------------------------- */}
              {/* APARATO DE PARTIDAS (14 GATERAS) UBICADO EN LA DISTANCIA      */}
              {/* ------------------------------------------------------------- */}
              <g id="aparatoPartidas14Gateras">
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
                      <title>{`Gatera PP #${puerta}`}</title>
                      {/* Cajón de Salida con Número de Gatera */}
                      <rect
                        x="-7"
                        y="-6"
                        width="14"
                        height="12"
                        rx="2"
                        fill={gualdrapa.bg}
                        stroke={tieneCaballo ? "#10B981" : "#1E293B"}
                        strokeWidth={tieneCaballo ? "1.8" : "1"}
                        className={tieneCaballo ? "filter drop-shadow-sm" : "opacity-60"}
                      />
                      <text
                        x="0"
                        y="3"
                        textAnchor="middle"
                        fill={gualdrapa.text}
                        fontSize="7"
                        fontWeight="900"
                        fontFamily="monospace"
                      >
                        {puerta}
                      </text>
                    </g>
                  );
                })}

                {/* Letrero del Partidor */}
                {(() => {
                  const posLetrero = calcularPosicionEnOvalo(distanciaCarrera, 1.06);
                  return (
                    <text
                      x={posLetrero.x}
                      y={posLetrero.y + (posLetrero.y > Y_CENTRO ? 14 : -10)}
                      textAnchor="middle"
                      fill="#34D399"
                      fontSize="9"
                      fontWeight="900"
                      letterSpacing="1"
                    >
                      PARTIDA {distanciaCarrera}M (14 GATERAS PP)
                    </text>
                  );
                })()}
              </g>

              {/* ------------------------------------------------------------- */}
              {/* PURASANGRES CORRIENDO EN EL ÓVALO (MOVIMIENTO FLUIDO Y SUAVE) */}
              {/* ------------------------------------------------------------- */}
              {posicionesCalculadas.map(({ item, puertaSalida, x, y, anguloDeg }) => {
                const { ejemplar, ordenLlegadaProyectado } = item;
                const gualdrapa = COLORES_GUALDRAPA[ejemplar.numero] || { bg: "#3B82F6", text: "#FFF" };
                const estaSeleccionado = caballoSeleccionado === ejemplar.numero;

                return (
                  <g
                    key={ejemplar.numero}
                    transform={`translate(${x}, ${y}) rotate(${anguloDeg})`}
                    onClick={() => setCaballoSeleccionado(ejemplar.numero)}
                    className="cursor-pointer"
                    filter="url(#horseShadow)"
                  >
                    {/* Sombra de Galope sobre la Arena */}
                    <ellipse cx="-4" cy="3" rx="14" ry="5" fill="#000000" opacity="0.4" />

                    {/* Aura de selección dorada si está seleccionado */}
                    {estaSeleccionado && (
                      <circle cx="0" cy="0" r="16" fill="none" stroke="#FACC15" strokeWidth="2.5" strokeDasharray="3 2" className="animate-spin" />
                    )}

                    {/* Miniatura del Purasangre estilizado con dirección de avance */}
                    <g transform="scale(0.38) translate(-40, -30)">
                      {/* Cuerpo del Caballo */}
                      <path
                        d="M 15 45 L 35 25 L 65 25 L 85 40 L 75 55 L 25 55 Z"
                        fill="#78350F"
                        stroke="#451A03"
                        strokeWidth="2"
                      />
                      {/* Cuello y Cabeza hacia adelante */}
                      <path
                        d="M 65 25 L 82 10 L 95 12 L 92 22 L 78 35 Z"
                        fill="#854D0E"
                        stroke="#451A03"
                        strokeWidth="2"
                      />
                      {/* Gualdrapa Oficial con Número */}
                      <rect
                        x="36"
                        y="20"
                        width="26"
                        height="20"
                        rx="4"
                        fill={gualdrapa.bg}
                        stroke="#0F172A"
                        strokeWidth="2.5"
                      />
                      <text
                        x="49"
                        y="35"
                        textAnchor="middle"
                        fontSize="15"
                        fontWeight="900"
                        fill={gualdrapa.text}
                        fontFamily="monospace"
                      >
                        {ejemplar.numero}
                      </text>
                      {/* Casco del Jockey */}
                      <circle cx="56" cy="12" r="7" fill="#1E293B" stroke="#F8FAFC" strokeWidth="1.5" />
                    </g>

                    {/* Chapa flotante con Puesto de Partida PP y Número */}
                    <g transform="translate(0, -18)">
                      <rect
                        x="-18"
                        y="-7"
                        width="36"
                        height="13"
                        rx="3"
                        fill="#0F172A"
                        stroke={estaSeleccionado ? "#FACC15" : "#334155"}
                        strokeWidth="1.2"
                      />
                      <text
                        x="0"
                        y="2.5"
                        textAnchor="middle"
                        fill="#FFFFFF"
                        fontSize="7"
                        fontWeight="900"
                        fontFamily="monospace"
                      >
                        #{ejemplar.numero} · PP{puertaSalida}
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
                Fase actual: <b>{faseActiva}</b> ({progreso.toFixed(0)}%) · Distancia: <b>{distanciaCarrera}m</b> · {ranking.length} ejemplares en competencia
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

          {/* Botón Play/Pause */}
          <button
            type="button"
            onClick={() => {
              if (progreso >= 100) setProgreso(0);
              setReproduciendo(!reproduciendo);
            }}
            className={`px-4 py-1.5 rounded-xl font-black text-xs text-white shadow-sm transition-all flex items-center gap-1.5 ${
              reproduciendo
                ? "bg-amber-600 hover:bg-amber-500"
                : "bg-indigo-600 hover:bg-indigo-500"
            }`}
          >
            <span>{reproduciendo ? "⏸️" : "▶️"}</span>
            <span>{reproduciendo ? "Pausar" : progreso >= 100 ? "Repetir Recorrido" : "Simular Carrera"}</span>
          </button>

          {/* Velocidades */}
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
            className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
          />
          <span className="text-[10px] font-black uppercase text-slate-700 font-mono">
            {progreso < 15
              ? `Partida ${distanciaCarrera}m`
              : progreso < 65
              ? "Codo 800m (Riel Interior)"
              : progreso < 95
              ? "Recta Final (Tribunas)"
              : "Meta 🏁"}
          </span>
        </div>

        {/* Selector de Ejemplar Activo para Zoom */}
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
          <div className="rounded-xl border border-slate-200 bg-gradient-to-r from-slate-50 via-white to-indigo-50/40 p-3.5 shadow-xs flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {/* Contenedor de Gualdrapa Oficial con Número */}
              <span
                style={{
                  backgroundColor: gualdrapaActiva.bg,
                  color: gualdrapaActiva.text,
                  borderColor: gualdrapaActiva.border,
                }}
                className="inline-grid h-11 w-11 min-w-[44px] place-items-center rounded-xl font-mono font-black text-lg border-2 shadow-sm shrink-0"
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
