"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import type { ResultadoCarreraV4, ResultadoEjemplarV4 } from "@/features/inteligencia/lib/analista-venezuela-v4";
import { COLORES_GUALDRAPA } from "@/features/inteligencia/lib/analista-venezuela-v4";
import { Button } from "@/shared/components/ui/Button";

interface Props {
  resultado: ResultadoCarreraV4;
  distancia: number; // 1100, 1200, 1400, 1800, etc.
  hipodromo?: string;
  onSeleccionarEjemplar?: (ejemplar: ResultadoEjemplarV4) => void;
}

export type FaseSimulacion = "SALIDA" | "P1000" | "P300" | "META";

/**
 * SimuladorPistaDesarrollo
 *
 * Arquitectura de Doble Pista Sincronizada:
 * 1. ÓVALO EXTERIOR (Vista Geométrica del Hipódromo con arena, barandas y caballos galopando).
 * 2. PISTA RECTA CENTRAL EN EL MEDIO DEL ÓVALO (Infield Linear Race Bar):
 *    - Se ubica en el centro (infield) dentro del óvalo.
 *    - ÚNICAMENTE muestra las fichas con el NÚMERO DE GUALDRAPA (#1..#14) con su color CLOTH oficial.
 *    - Sin siluetas ni textos largos que tapen el avance.
 *    - Cada número corre en su propio micro-carril horizontal libre de colisiones.
 *    - Se desplaza sincronizadamente de izquierda a derecha hacia la bandera de META.
 */
export function SimuladorPistaDesarrollo({
  resultado,
  distancia = 1200,
  hipodromo = "LA RINCONADA",
  onSeleccionarEjemplar,
}: Props) {
  const [fase, setFase] = useState<FaseSimulacion>("META");
  const [progreso, setProgreso] = useState<number>(1.0); // 0.0 a 1.0
  const [reproduciendo, setReproduciendo] = useState<boolean>(false);
  const [velocidad, setVelocidad] = useState<number>(1.0);
  const [ejemplarHover, setEjemplarHover] = useState<ResultadoEjemplarV4 | null>(null);

  const requestRef = useRef<number | null>(null);
  const prevTimeRef = useRef<number | null>(null);

  // Ejemplares ordenados por llegada oficial
  const ranking = useMemo(() => {
    return [...resultado.ranking].filter((r) => !r.ejemplar.retirado);
  }, [resultado.ranking]);

  // Sincronizar fases fijas
  const seleccionarFase = (f: FaseSimulacion) => {
    setReproduciendo(false);
    setFase(f);
    if (f === "SALIDA") setProgreso(0.0);
    else if (f === "P1000") setProgreso(0.35);
    else if (f === "P300") setProgreso(0.75);
    else if (f === "META") setProgreso(1.0);
  };

  // Loop de reproducción animada continua
  useEffect(() => {
    if (!reproduciendo) {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      prevTimeRef.current = null;
      return;
    }

    const animate = (time: number) => {
      if (prevTimeRef.current !== null) {
        const delta = (time - prevTimeRef.current) / 1000;
        setProgreso((prev) => {
          // Recorrido total en 12 segundos base / velocidad
          const avance = delta * (0.08 * velocidad);
          const next = prev + avance;
          if (next >= 1.0) {
            setReproduciendo(false);
            setFase("META");
            return 1.0;
          }
          if (next < 0.35) setFase("SALIDA");
          else if (next < 0.75) setFase("P1000");
          else setFase("P300");
          return next;
        });
      }
      prevTimeRef.current = time;
      requestRef.current = requestAnimationFrame(animate);
    };

    requestRef.current = requestAnimationFrame(animate);
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [reproduciendo, velocidad]);

  // Cálculo de avance relativo de cada ejemplar en el progreso actual:
  // - Early pace en la salida (velocistas E1 salen disparados)
  // - Transición en el codo de 800m
  // - Late pace / Remate en los 300m (atropelladores E3 descuentan ventaja)
  const posicionesEjemplares = useMemo(() => {
    return ranking.map((r, i) => {
      const estilo = r.ejemplar.estilo; // E1, E2, E3
      const puestoLlegada = r.ordenLlegadaProyectado; // 1, 2, 3...
      const cuerposLlegada = r.cuerposVentaja; // 0, 1.2, 3.5...

      // Factor de Early Pace
      let ventajaInicial = 0;
      if (estilo === "E1") ventajaInicial = 0.08;
      else if (estilo === "E2") ventajaInicial = 0.03;
      else ventajaInicial = -0.05;

      // Descuento progresivo hacia la llegada
      const factorDescuento = progreso; // 0 a 1
      // En progreso=1.0 la diferencia en % equivale a los cuerpos de llegada
      const retrasoFinal = (cuerposLlegada * 0.015); // Cada cuerpo ~1.5%

      // Posición relativa 0% a 100%
      let posRelativa = progreso * 100 + (ventajaInicial * (1 - factorDescuento) * 100) - (retrasoFinal * factorDescuento * 100);
      posRelativa = Math.max(0, Math.min(100, posRelativa));

      // Asignar carril en el infield para que ningún número se monte sobre otro
      return {
        resultado: r,
        numero: r.ejemplar.numero,
        puestoPista: r.ejemplar.puestoPista,
        nombre: r.ejemplar.nombre,
        estilo,
        puestoLlegada,
        cuerposLlegada,
        posicionPct: posRelativa,
        carrilIndex: i, // Cada caballo en su propia hilera/micro-carril
      };
    });
  }, [ranking, progreso]);

  // Dimensiones del Óvalo SVG
  const anchoSvg = 920;
  const altoSvg = 480;
  const centroX = anchoSvg / 2;
  const centroY = altoSvg / 2;
  const radioX = 390;
  const radioY = 190;
  const grosorPista = 55;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-700 bg-slate-950 p-4 text-slate-100 shadow-2xl">
      {/* Barra de Control y Fases */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10 text-xl border border-amber-500/30">
            🏇
          </div>
          <div>
            <h3 className="text-sm font-black text-white uppercase tracking-wider">
              Simulador de Óvalo & Pista Recta Central · {hipodromo}
            </h3>
            <p className="text-[11px] text-slate-400">
              Distancia {distancia}m · Doble pista sincronizada con micro-carriles numéricos en el Infield
            </p>
          </div>
        </div>

        {/* Botones de fase y reproducción */}
        <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-xl p-1">
          <Button
            size="sm"
            onClick={() => setReproduciendo(!reproduciendo)}
            className={`font-black text-xs px-3 py-1 flex items-center gap-1 ${
              reproduciendo
                ? "bg-rose-600 hover:bg-rose-500 text-white"
                : "bg-emerald-600 hover:bg-emerald-500 text-white"
            }`}
          >
            <span>{reproduciendo ? "⏸️ Pausar" : "▶️ Reproducir"}</span>
          </Button>

          <button
            onClick={() => seleccionarFase("SALIDA")}
            className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
              fase === "SALIDA" ? "bg-amber-500 text-slate-950" : "text-slate-400 hover:text-white"
            }`}
          >
            🚪 Salida (PP)
          </button>
          <button
            onClick={() => seleccionarFase("P1000")}
            className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
              fase === "P1000" ? "bg-amber-500 text-slate-950" : "text-slate-400 hover:text-white"
            }`}
          >
            ⚡ 1000m
          </button>
          <button
            onClick={() => seleccionarFase("P300")}
            className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
              fase === "P300" ? "bg-amber-500 text-slate-950" : "text-slate-400 hover:text-white"
            }`}
          >
            🔄 300m
          </button>
          <button
            onClick={() => seleccionarFase("META")}
            className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
              fase === "META" ? "bg-amber-500 text-slate-950" : "text-slate-400 hover:text-white"
            }`}
          >
            🏁 META
          </button>

          {/* Velocidad */}
          <div className="ml-2 flex items-center gap-1 border-l border-slate-700 pl-2">
            {[1, 1.5, 2].map((v) => (
              <button
                key={v}
                onClick={() => setVelocidad(v)}
                className={`rounded px-1.5 py-0.5 text-[10px] font-mono font-bold ${
                  velocidad === v ? "bg-slate-700 text-amber-300" : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {v}x
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Badge Flotante Interactivo cuando se posa sobre un número */}
      {ejemplarHover && (
        <div className="rounded-xl border border-amber-500/40 bg-slate-900/90 px-3 py-1.5 text-xs flex items-center justify-between shadow-lg animate-fadeIn">
          <div className="flex items-center gap-2">
            <span
              className="flex h-5 w-5 items-center justify-center rounded font-mono text-xs font-black"
              style={{
                backgroundColor: COLORES_GUALDRAPA[ejemplarHover.ejemplar.numero]?.bg || "#FFF",
                color: COLORES_GUALDRAPA[ejemplarHover.ejemplar.numero]?.text || "#000",
              }}
            >
              {ejemplarHover.ejemplar.numero}
            </span>
            <span className="font-black text-white">{ejemplarHover.ejemplar.nombre}</span>
            <span className="text-amber-300 font-bold">🚪 PP {ejemplarHover.ejemplar.puestoPista}</span>
            <span className="text-slate-400">· {ejemplarHover.ejemplar.estilo}</span>
            <span className="text-emerald-400 font-bold">· {ejemplarHover.probabilidadSMIC.toFixed(1)}% SMIC</span>
          </div>
          <span className="font-mono text-amber-400 font-bold">
            {ejemplarHover.ordenLlegadaProyectado === 1 ? "LÍDER PROYECTADO" : `${ejemplarHover.cuerposVentaja.toFixed(1)} cpos`}
          </span>
        </div>
      )}

      {/* ==================================================================== */}
      {/* VISTA GEOMÉTRICA DUAL: ÓVALO EXTERIOR + RECTA CENTRAL EN EL INFIELD  */}
      {/* ==================================================================== */}
      <div className="relative w-full overflow-hidden rounded-xl bg-slate-900 border border-slate-800">
        <svg
          viewBox={`0 0 ${anchoSvg} ${altoSvg}`}
          className="w-full h-auto select-none"
          style={{ maxHeight: "560px" }}
        >
          <defs>
            {/* Patrón de arena de La Rinconada */}
            <linearGradient id="arenaPista" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#3d2817" />
              <stop offset="100%" stopColor="#2c1d11" />
            </linearGradient>

            {/* Infield césped interior */}
            <radialGradient id="cespedInfield" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#064e3b" />
              <stop offset="100%" stopColor="#022c22" />
            </radialGradient>

            {/* Sombra para números */}
            <filter id="sombraNumero" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="2" stdDeviation="2" floodOpacity="0.6" />
            </filter>
          </defs>

          {/* 1. ANILLO EXTERIOR DEL ÓVALO (CANCHA DE ARENA) */}
          <ellipse
            cx={centroX}
            cy={centroY}
            rx={radioX}
            ry={radioY}
            fill="none"
            stroke="url(#arenaPista)"
            strokeWidth={grosorPista}
          />

          {/* Baranda Exterior */}
          <ellipse
            cx={centroX}
            cy={centroY}
            rx={radioX + grosorPista / 2}
            ry={radioY + grosorPista / 2}
            fill="none"
            stroke="#64748b"
            strokeWidth={2}
            strokeDasharray="6 3"
          />

          {/* Baranda Interior (Blanca y Roja) */}
          <ellipse
            cx={centroX}
            cy={centroY}
            rx={radioX - grosorPista / 2}
            ry={radioY - grosorPista / 2}
            fill="url(#cespedInfield)"
            stroke="#ef4444"
            strokeWidth={3}
          />

          {/* Línea de META en la recta final (Inferior) */}
          <line
            x1={centroX + 70}
            y1={centroY + radioY - grosorPista / 2 - 2}
            x2={centroX + 70}
            y2={centroY + radioY + grosorPista / 2 + 2}
            stroke="#FFFFFF"
            strokeWidth={4}
          />
          <text
            x={centroX + 70}
            y={centroY + radioY + grosorPista / 2 + 16}
            textAnchor="middle"
            fill="#FFFFFF"
            fontSize="10"
            fontWeight="900"
          >
            🏁 META
          </text>

          {/* Chute de salida para distancias clásicas */}
          <text
            x={centroX - 280}
            y={centroY - radioY - grosorPista / 2 - 8}
            fill="#F59E0B"
            fontSize="9"
            fontWeight="bold"
          >
            🚩 Salida {distancia}m
          </text>

          {/* Puntos en el óvalo de los ejemplares (Siluetas en miniatura perimetrales) */}
          {posicionesEjemplares.map((p) => {
            // Posición angular en el óvalo (0 a 2*PI)
            const angulo = Math.PI + (p.posicionPct / 100) * (2 * Math.PI);
            // Franja de carril en el óvalo
            const offsetCarril = ((p.puestoPista - 7.5) / 14) * (grosorPista * 0.7);
            const posX = centroX + (radioX + offsetCarril) * Math.cos(angulo);
            const posY = centroY + (radioY + offsetCarril) * Math.sin(angulo);
            const cloth = COLORES_GUALDRAPA[p.numero] || COLORES_GUALDRAPA[1];

            return (
              <g
                key={`oval-${p.numero}`}
                transform={`translate(${posX}, ${posY})`}
                className="cursor-pointer transition-all duration-300"
                onMouseEnter={() => setEjemplarHover(p.resultado)}
                onMouseLeave={() => setEjemplarHover(null)}
                onClick={() => onSeleccionarEjemplar && onSeleccionarEjemplar(p.resultado)}
              >
                <circle r={9} fill={cloth.bg} stroke={cloth.border} strokeWidth={1.5} />
                <text
                  textAnchor="middle"
                  dy="3.5"
                  fill={cloth.text}
                  fontSize="8"
                  fontWeight="900"
                  fontFamily="monospace"
                >
                  {p.numero}
                </text>
              </g>
            );
          })}

          {/* ================================================================== */}
          {/* 2. PISTA RECTA CENTRAL EN EL MEDIO DEL ÓVALO (INFIELD LINEAR BAR)  */}
          {/* SOLO SE MUESTRAN NÚMEROS DE GUALDRAPA MOVIÉNDOSE A LA META        */}
          {/* ================================================================== */}
          <g transform={`translate(${centroX - 280}, ${centroY - 100})`}>
            {/* Fondo de la Pista Recta Central */}
            <rect
              x={0}
              y={0}
              width={560}
              height={200}
              rx={16}
              fill="#090d16"
              stroke="#1e293b"
              strokeWidth={2}
            />

            {/* Cabecera de la Recta Central */}
            <rect x={0} y={0} width={560} height={26} rx={16} fill="#0f172a" />
            <text x={14} y={17} fill="#fbbf24" fontSize="10" fontWeight="900" letterSpacing="0.05em">
              ⚡ PISTA RECTA CENTRAL DE NÚMEROS (INFIELD DESARROLLO)
            </text>
            <text x={546} y={17} textAnchor="end" fill="#94a3b8" fontSize="9" fontWeight="bold">
              SIN COLISIÓN · CARRIL INDEPENDIENTE
            </text>

            {/* Marcas de los 4 tramos */}
            {/* 1. Salida PP (0m) */}
            <line x1={40} y1={28} x2={40} y2={195} stroke="#334155" strokeWidth={1} strokeDasharray="3 3" />
            <text x={40} y={192} textAnchor="middle" fill="#64748b" fontSize="8" fontWeight="bold">
              🚪 PP
            </text>

            {/* 2. Parcial 1000m (35%) */}
            <line x1={205} y1={28} x2={205} y2={195} stroke="#334155" strokeWidth={1} strokeDasharray="3 3" />
            <text x={205} y={192} textAnchor="middle" fill="#64748b" fontSize="8" fontWeight="bold">
              ⚡ 1000m
            </text>

            {/* 3. Últimos 300m (75%) */}
            <line x1={395} y1={28} x2={395} y2={195} stroke="#334155" strokeWidth={1} strokeDasharray="3 3" />
            <text x={395} y={192} textAnchor="middle" fill="#64748b" fontSize="8" fontWeight="bold">
              🔄 300m
            </text>

            {/* 4. META (100%) */}
            <line x1={515} y1={28} x2={515} y2={195} stroke="#ef4444" strokeWidth={2} />
            <rect x={513} y={28} width={4} height={165} fill="#ffffff" opacity={0.3} />
            <text x={515} y={192} textAnchor="middle" fill="#ef4444" fontSize="9" fontWeight="900">
              🏁 META
            </text>

            {/* Micro-carriles horizontales y Números desplazándose */}
            {posicionesEjemplares.map((p) => {
              const cloth = COLORES_GUALDRAPA[p.numero] || COLORES_GUALDRAPA[1];
              // Espaciado vertical por micro-carril
              const maxCarriles = Math.max(8, posicionesEjemplares.length);
              const pasoY = 145 / maxCarriles;
              const yCarril = 34 + p.carrilIndex * pasoY;

              // Posición horizontal X dentro del tramo de carrera (40px a 515px)
              const anchoCarrera = 475;
              const posX = 40 + (p.posicionPct / 100) * anchoCarrera;

              const esLider = p.puestoLlegada === 1;

              return (
                <g key={`recta-${p.numero}`}>
                  {/* Línea sutil de carril */}
                  <line
                    x1={35}
                    y1={yCarril + 6}
                    x2={525}
                    y2={yCarril + 6}
                    stroke="#1e293b"
                    strokeWidth={0.7}
                  />

                  {/* FICHA CUADRADA/REDONDEADA DEL NÚMERO (SOLO NÚMERO CON COLOR CLOTH) */}
                  <g
                    transform={`translate(${posX}, ${yCarril})`}
                    className="cursor-pointer transition-all duration-150"
                    filter="url(#sombraNumero)"
                    onMouseEnter={() => setEjemplarHover(p.resultado)}
                    onMouseLeave={() => setEjemplarHover(null)}
                    onClick={() => onSeleccionarEjemplar && onSeleccionarEjemplar(p.resultado)}
                  >
                    {/* Caja de Número */}
                    <rect
                      x={-10}
                      y={-5}
                      width={20}
                      height={16}
                      rx={3}
                      fill={cloth.bg}
                      stroke={cloth.border}
                      strokeWidth={esLider ? 2 : 1}
                    />

                    {/* Corona sutil si va ganando */}
                    {esLider && (
                      <text x={0} y={-7} textAnchor="middle" fontSize="8">
                        👑
                      </text>
                    )}

                    {/* DÍGITO DEL NÚMERO */}
                    <text
                      x={0}
                      y={7}
                      textAnchor="middle"
                      fill={cloth.text}
                      fontSize="9"
                      fontWeight="900"
                      fontFamily="monospace"
                    >
                      {p.numero}
                    </text>
                  </g>
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {/* Leyenda y Tabla Resumen de Llegada */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-2 text-[11px] text-slate-400">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded bg-sky-500" /> E1 Velocista
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded bg-emerald-500" /> E2 Colocado
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded bg-violet-500" /> E3 Atropellador
          </span>
        </div>
        <p className="text-slate-500">
          * Pasa el ratón sobre cualquier número en el centro para ver su split de tiempo y factor PP.
        </p>
      </div>
    </div>
  );
}

export default SimuladorPistaDesarrollo;
