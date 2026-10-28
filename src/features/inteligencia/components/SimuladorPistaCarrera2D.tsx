"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import {
  type ResultadoCarreraV4,
  type ResultadoEjemplarV4,
  type FactorPista,
  type EstiloCarrera,
  COLORES_GUALDRAPA,
} from "@/features/inteligencia/lib/analista-venezuela-v4";
import { CamisaJockeySvg } from "@/features/inteligencia/components/CamisaJockeySvg";

type Props = {
  resultado: ResultadoCarreraV4;
  factorPistaActual?: FactorPista;
  carrilActual?: "RIEL" | "CENTRO" | "AFUERA";
  estiloActual?: EstiloCarrera;
  tendenciaActiva?: boolean;
  className?: string;
};

type FaseCarrera = "PARTIDA" | "CODO" | "RECTA" | "META";

export function SimuladorPistaCarrera2D({
  resultado,
  factorPistaActual = "NORMAL",
  carrilActual = "RIEL",
  estiloActual = "E1",
  tendenciaActiva = false,
  className = "",
}: Props) {
  // Progreso de la carrera: 0 (partida) a 100 (meta)
  const [progreso, setProgreso] = useState<number>(100);
  const [reproduciendo, setReproduciendo] = useState<boolean>(false);
  const [velocidad, setVelocidad] = useState<number>(1);
  const [caballoSeleccionado, setCaballoSeleccionado] = useState<number | null>(null);
  const [faseActiva, setFaseActiva] = useState<FaseCarrera>("META");
  const requestRef = useRef<number | null>(null);

  // Ordenar el ranking por llegada proyectada
  const ranking = useMemo(() => {
    return [...resultado.ranking].sort(
      (a, b) => a.ordenLlegadaProyectado - b.ordenLlegadaProyectado
    );
  }, [resultado.ranking]);

  // Selección por defecto del ganador proyectado
  useEffect(() => {
    if (caballoSeleccionado === null && ranking.length > 0) {
      setCaballoSeleccionado(ranking[0].ejemplar.numero);
    }
  }, [ranking, caballoSeleccionado]);

  // Sincronizar fase con el progreso
  useEffect(() => {
    if (progreso < 25) setFaseActiva("PARTIDA");
    else if (progreso < 65) setFaseActiva("CODO");
    else if (progreso < 95) setFaseActiva("RECTA");
    else setFaseActiva("META");
  }, [progreso]);

  // Bucle de animación suave (60 FPS)
  useEffect(() => {
    if (!reproduciendo) {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      return;
    }

    let ultimoTiempo = performance.now();

    const animar = (tiempoActual: number) => {
      const delta = (tiempoActual - ultimoTiempo) / 1000;
      ultimoTiempo = tiempoActual;

      setProgreso((prev) => {
        const incremento = delta * 15 * velocidad; // ~6.6 segundos de carrera a 1x
        if (prev + incremento >= 100) {
          setReproduciendo(false);
          return 100;
        }
        return prev + incremento;
      });

      requestRef.current = requestAnimationFrame(animar);
    };

    requestRef.current = requestAnimationFrame(animar);

    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [reproduciendo, velocidad]);

  // Ir a una fase fija
  const saltarAFase = (fase: FaseCarrera) => {
    setReproduciendo(false);
    if (fase === "PARTIDA") setProgreso(0);
    if (fase === "CODO") setProgreso(40);
    if (fase === "RECTA") setProgreso(75);
    if (fase === "META") setProgreso(100);
  };

  // Calcular la posición X (0% a 92%) y el carril Y de cada caballo según la fase y el tren de carrera
  const posicionesCalculadas = useMemo(() => {
    return ranking.map((item, index) => {
      const { ejemplar, ordenLlegadaProyectado, cuerposVentaja, favorecidoTendenciaTarde } = item;
      const estilo = ejemplar.estilo;

      // 1. Posición Teórica Inicial (Planteamiento del Tren de Carrera a la Partida)
      // Velocistas (E1) adelante, Colocados (E2) en medio, Rematadores (E3) atrás
      let offsetInicial = 0;
      if (estilo === "E1") {
        offsetInicial = 25 - (ejemplar.numero % 3) * 3; // En la delantera
      } else if (estilo === "E2") {
        offsetInicial = 14 - (ejemplar.numero % 3) * 3; // En persecución
      } else {
        offsetInicial = 3 - (ejemplar.numero % 3) * 2;  // Al fondo del lote
      }

      // 2. Posición Teórica Final (Orden de Llegada en la Meta)
      // El 1° cruza la meta (90%), los demás quedan rezagados según sus cuerpos de ventaja
      const cuerpos = cuerposVentaja ?? index * 1.5;
      const offsetLlegada = Math.max(90 - cuerpos * 2.8, 15);

      // 3. Posición X Interpolada según el progreso
      let posX = 0;
      if (progreso < 30) {
        // Fase de Partida / Acomodo inicial
        const t = progreso / 30;
        posX = (offsetInicial * 0.4) + t * (offsetInicial * 0.6 + 15);
      } else if (progreso < 80) {
        // Fase de Codo y Curva: se produce el agrupamiento y aceleración
        const t = (progreso - 30) / 50;
        const posMedia = offsetInicial + (offsetLlegada - offsetInicial) * 0.5;
        posX = offsetInicial * 0.6 + 15 + t * (posMedia);
      } else {
        // Fase de Recta Final y Fotofinish
        const t = (progreso - 80) / 20;
        const posEntradaRecta = offsetInicial + (offsetLlegada - offsetInicial) * 0.7;
        posX = posEntradaRecta + t * (offsetLlegada - posEntradaRecta);
      }

      // Asegurar límites dentro de la pista (5% a 92%)
      posX = Math.min(Math.max(posX, 4), 92);

      // 4. Carril Y (Línea de Carrera / Carril de Pista)
      // Carril 1 (Riel): 24% | Carril 2 (Centro): 50% | Carril 3 (Afuera): 76%
      let carrilYBase = 50;
      if (ejemplar.lineaPistaEstimada === "RIEL" || ejemplar.puestoPista <= 3) {
        carrilYBase = 24;
      } else if (ejemplar.lineaPistaEstimada === "AFUERA" || ejemplar.puestoPista >= 7) {
        carrilYBase = 76;
      } else {
        carrilYBase = 50;
      }

      // Añadir una pequeña dispersión para que los caballos no se superpongan exactamente
      const dispersion = ((index % 3) - 1) * 7;
      const posY = Math.min(Math.max(carrilYBase + dispersion, 16), 84);

      return {
        item,
        posX,
        posY,
        esGanador: ordenLlegadaProyectado === 1,
        esPlacero: ordenLlegadaProyectado <= 3,
        favorecidoTendenciaTarde,
      };
    });
  }, [ranking, progreso]);

  // Colores de la Pista según Factor
  const estiloPista = useMemo(() => {
    if (factorPistaActual === "LIGERA") {
      return {
        arenaBg: "bg-gradient-to-r from-amber-700 via-amber-600 to-amber-700",
        arenaBorder: "border-amber-400",
        sueloEstilo: "radial-gradient(ellipse at 50% 50%, rgba(251, 191, 36, 0.25), transparent 70%)",
        etiquetaPista: "⚡ Pista Ligera / Rápida (-0.6s) — Favorece la Velocidad en Punta",
      };
    }
    if (factorPistaActual === "PESADA" || factorPistaActual === "FANGOSA") {
      return {
        arenaBg: "bg-gradient-to-r from-amber-950 via-stone-900 to-amber-950",
        arenaBorder: "border-rose-900",
        sueloEstilo: "radial-gradient(ellipse at 50% 50%, rgba(136, 19, 55, 0.35), transparent 70%)",
        etiquetaPista: "🌧️ Pista Pesada / Fangosa (+1.2s) — Exige Resistencia y Fuerza",
      };
    }
    return {
      arenaBg: "bg-gradient-to-r from-amber-800 via-amber-700 to-amber-800",
      arenaBorder: "border-amber-600",
      sueloEstilo: "radial-gradient(ellipse at 50% 50%, rgba(245, 158, 11, 0.15), transparent 70%)",
      etiquetaPista: "☀️ Pista Normal (0.0s) — Comportamiento Estándar",
    };
  }, [factorPistaActual]);

  const caballoActivo = ranking.find((r) => r.ejemplar.numero === caballoSeleccionado) ?? ranking[0];

  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3.5 ${className}`}>
      {/* 1. CABECERA Y SELECTOR DE FASE */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-tr from-amber-500 to-yellow-400 text-slate-950 font-black text-lg shadow-sm">
            🏇
          </span>
          <div>
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 flex items-center gap-2">
              <span>Simulación Dinámica de Carrera en Pista (La Rinconada / Valencia)</span>
              <span className="rounded-full bg-indigo-100 text-indigo-800 border border-indigo-300 px-2 py-0.2 text-[9px] font-black">
                MOTOR GODET v4 + SMIC
              </span>
            </h3>
            <p className="text-[11px] text-slate-500">
              {estiloPista.etiquetaPista}
            </p>
          </div>
        </div>

        {/* Fases Rápidas */}
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-[11px] font-black">
          <button
            type="button"
            onClick={() => saltarAFase("PARTIDA")}
            className={`px-2.5 py-1 rounded-lg transition-all ${
              faseActiva === "PARTIDA" ? "bg-white text-indigo-900 shadow-xs" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            🏁 Partida
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
            🏆 Llegada Fotofinish
          </button>
        </div>
      </div>

      {/* 2. LA PISTA DE CARRERAS ISOMÉTRICA CON CABALLITOS ANIMADOS */}
      <div className="relative overflow-hidden rounded-2xl border-2 border-slate-700 bg-slate-950 p-2 shadow-inner select-none">
        {/* Contenedor SVG/CSS de la Pista */}
        <div className={`relative h-72 sm:h-80 w-full rounded-xl ${estiloPista.arenaBg} shadow-2xl overflow-hidden`}>
          {/* Suelo y Textura de Arena Batida */}
          <div
            className="absolute inset-0 opacity-40 mix-blend-overlay"
            style={{ backgroundImage: estiloPista.sueloEstilo }}
          />

          {/* Baranda Exterior (Tope Superior) */}
          <div className="absolute top-0 left-0 right-0 h-4 border-b-2 border-white/80 bg-white/30 flex items-center justify-around">
            <span className="text-[9px] font-black uppercase text-white/90 tracking-widest">
              BARANDA EXTERIOR — LÍNEAS 7+
            </span>
          </div>

          {/* Líneas Divisorias de Carril Discontinuas */}
          {/* Carril 3: Abierto (entre 66% y 100%) */}
          <div className="absolute top-[33%] left-0 right-0 h-[2px] border-b border-dashed border-white/35" />
          {/* Carril 2: Media Cancha / Centro (entre 33% y 66%) */}
          <div className="absolute top-[66%] left-0 right-0 h-[2px] border-b border-dashed border-white/35" />

          {/* Baranda Interior / Riel (Tope Inferior) */}
          <div className="absolute bottom-0 left-0 right-0 h-4 border-t-2 border-white/80 bg-white/30 flex items-center justify-around">
            <span className="text-[9px] font-black uppercase text-white/90 tracking-widest">
              BARANDA INTERIOR / EL RIEL — LÍNEAS 1-3
            </span>
          </div>

          {/* Postes de Distancia Verticales */}
          {/* Gateras de Partida (Extremo Izquierdo) */}
          <div className="absolute top-4 bottom-4 left-3 w-8 border-r-2 border-emerald-400/80 bg-emerald-950/40 flex flex-col justify-around items-center">
            <span className="text-[9px] font-black text-emerald-300 transform -rotate-90">
              GATERAS
            </span>
          </div>

          {/* Poste 800m (35%) */}
          <div className="absolute top-4 bottom-4 left-[35%] w-px border-r border-dotted border-white/40 flex flex-col justify-between">
            <span className="bg-amber-400 text-slate-950 text-[8px] font-black px-1 rounded shadow-xs">
              800m
            </span>
            <span className="bg-amber-400 text-slate-950 text-[8px] font-black px-1 rounded shadow-xs">
              800m
            </span>
          </div>

          {/* Poste 400m / Entrada a la Recta (65%) */}
          <div className="absolute top-4 bottom-4 left-[65%] w-px border-r border-dashed border-yellow-400/70 flex flex-col justify-between">
            <span className="bg-yellow-400 text-slate-950 text-[8px] font-black px-1 rounded shadow-xs">
              400m (Recta)
            </span>
            <span className="bg-yellow-400 text-slate-950 text-[8px] font-black px-1 rounded shadow-xs">
              400m
            </span>
          </div>

          {/* Línea de Llegada / Meta con Fotofinish (Extremo Derecho 91%) */}
          <div className="absolute top-4 bottom-4 left-[91%] w-2 bg-gradient-to-r from-red-600 via-white to-red-600 shadow-md flex flex-col justify-between items-center z-10">
            <span className="bg-red-600 text-white text-[9px] font-black px-1.5 py-0.5 rounded-sm shadow-md animate-pulse">
              META
            </span>
            <span className="bg-red-600 text-white text-[9px] font-black px-1.5 py-0.5 rounded-sm shadow-md">
              🏁
            </span>
          </div>

          {/* Torre de Llegada / Espejo */}
          <div className="absolute top-2 right-2 bg-slate-900/90 text-white border border-slate-700 px-2 py-1 rounded-md text-[9px] font-black flex items-center gap-1 shadow-lg z-20">
            <span className="h-2 w-2 rounded-full bg-red-500 animate-ping" />
            <span>FOTOFINISH ACTIVO</span>
          </div>

          {/* CABALLITOS CORRIENDO EN LA PISTA */}
          {posicionesCalculadas.map(({ item, posX, posY, favorecidoTendenciaTarde }) => {
            const { ejemplar, ordenLlegadaProyectado } = item;
            const gualdrapa = COLORES_GUALDRAPA[ejemplar.numero] || { bg: "#3B82F6", text: "#FFF" };
            const estaSeleccionado = caballoSeleccionado === ejemplar.numero;

            return (
              <div
                key={ejemplar.numero}
                onClick={() => setCaballoSeleccionado(ejemplar.numero)}
                title={`#${ejemplar.numero} ${ejemplar.nombre} (${ordenLlegadaProyectado}° lugar)`}
                className={`absolute cursor-pointer transition-all duration-300 ease-out transform -translate-x-1/2 -translate-y-1/2 group z-10 ${
                  estaSeleccionado ? "z-30 scale-120 drop-shadow-[0_0_8px_rgba(250,204,21,0.8)]" : "hover:z-20 hover:scale-108"
                }`}
                style={{
                  left: `${posX}%`,
                  top: `${posY}%`,
                }}
              >
                {/* Sombra de Galope sobre la Arena */}
                <div className="absolute -bottom-1 left-2 h-2.5 w-12 bg-black/45 rounded-full blur-[2px] transform group-hover:scale-110 transition-transform" />

                {/* SPRITE VECTORIAL DEL PURASANGRE EN PLENO GALOPE CON COLOR DE CONTENEDOR */}
                <div className="relative flex items-center">
                  <svg
                    width="76"
                    height="56"
                    viewBox="0 0 110 82"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    className={`drop-shadow-lg transition-transform ${reproduciendo ? "animate-bounce" : ""}`}
                    style={{ animationDuration: "0.42s" }}
                  >
                    {/* Patas Traseras en Impulso Atlético */}
                    <path
                      d="M 12 65 L 24 46 L 36 42 L 24 70 L 14 74 Z"
                      fill="#78350F"
                      stroke="#451A03"
                      strokeWidth="1.5"
                    />
                    <path
                      d="M 24 58 L 30 46 L 40 44 L 28 62 Z"
                      fill="#92400E"
                    />
                    {/* Cola Larga al Viento */}
                    <path
                      d="M 20 36 C 8 32 3 40 1 52 C 8 47 16 42 22 40 Z"
                      fill="#451A03"
                    />
                    {/* Torso / Lomo Muscular del Purasangre */}
                    <path
                      d="M 26 38 C 40 30 60 30 74 34 C 82 38 86 46 82 54 C 74 60 50 60 32 54 C 24 50 22 42 26 38 Z"
                      fill="#854D0E"
                      stroke="#451A03"
                      strokeWidth="1.6"
                    />
                    {/* Cuello Potente y Cabeza Noble en Extensión de Galope */}
                    <path
                      d="M 72 34 L 88 22 L 98 20 L 105 26 L 98 31 L 82 42 Z"
                      fill="#854D0E"
                      stroke="#451A03"
                      strokeWidth="1.6"
                    />
                    {/* Crin y Mechones */}
                    <path
                      d="M 76 30 L 84 24 L 88 21 L 85 27 L 80 32 Z"
                      fill="#451A03"
                    />
                    {/* Bocado, Brida y Riendas */}
                    <path
                      d="M 98 24 L 103 28 L 96 30"
                      stroke="#FACC15"
                      strokeWidth="1.2"
                    />
                    <line x1="96" y1="28" x2="68" y2="38" stroke="#451A03" strokeWidth="1.2" />

                    {/* Patas Delanteras en Máxima Zancada hacia la Meta */}
                    <path
                      d="M 70 52 L 84 63 L 98 66 L 94 61 L 80 52 Z"
                      fill="#78350F"
                      stroke="#451A03"
                      strokeWidth="1.5"
                    />
                    <path
                      d="M 64 54 L 76 65 L 86 68 L 82 61 L 70 52 Z"
                      fill="#92400E"
                    />

                    {/* Cascos Reforzados */}
                    <polygon points="12,72 16,74 12,76" fill="#0F172A" />
                    <polygon points="94,64 99,66 95,68" fill="#0F172A" />

                    {/* Gualdrapa Oficial (#1 al #16) en el lomo - CONTENEDOR AGRANDADO */}
                    <rect
                      x="40"
                      y="35"
                      width="23"
                      height="15"
                      rx="3"
                      fill={gualdrapa.bg}
                      stroke="#0F172A"
                      strokeWidth="1.4"
                    />
                    <text
                      x="51.5"
                      y="46.5"
                      textAnchor="middle"
                      fontSize="11"
                      fontWeight="900"
                      fill={gualdrapa.text}
                      fontFamily="monospace"
                    >
                      {ejemplar.numero}
                    </text>

                    {/* JOCKEY / JINETE EN POSTURA AERODINÁMICA */}
                    {/* Pierna del Jockey con estribo */}
                    <path
                      d="M 50 37 L 45 46 L 52 48 L 54 39 Z"
                      fill="#F8FAFC"
                      stroke="#0F172A"
                      strokeWidth="1.1"
                    />
                    {/* Bota del Jockey */}
                    <path d="M 50 46 L 54 48 L 52 51 Z" fill="#0F172A" />

                    {/* Torso del Jockey (Inclinado hacia adelante en zancada) */}
                    <g transform="translate(42, 17) rotate(12) scale(0.44)">
                      <CamisaJockeySvg
                        numero={ejemplar.numero}
                        divisaTexto={ejemplar.divisaTexto}
                        studNombre={ejemplar.stud}
                        size={52}
                        mostrarGualdrapa={false}
                        permitirEdicionIa={false}
                      />
                    </g>
                  </svg>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. BARRA DE CONTROL DE LA SIMULACIÓN Y CRONOGRAMA */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
        <div className="flex items-center gap-2">
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
            <span>{reproduciendo ? "Pausar" : progreso >= 100 ? "Repetir Carrera" : "Simular Carrera"}</span>
          </button>

          {/* Velocidad */}
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
          <span className="text-[10px] font-black uppercase text-slate-500">
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
            {progreso < 25 ? "Partida" : progreso < 65 ? "Codo 800m" : progreso < 95 ? "Recta Final" : "Meta 🏁"}
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
            {ranking.map((r) => (
              <option key={r.ejemplar.numero} value={r.ejemplar.numero}>
                #{r.ejemplar.numero} - {r.ejemplar.nombre} ({r.ordenLlegadaProyectado}°)
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 4. TARJETA DE DETALLE TÉCNICO Y DIVISA DEL EJEMPLAR EN EL ORDEN PROYECTADO */}
      {caballoActivo && (
        <div className="rounded-xl border border-slate-200 bg-gradient-to-r from-slate-50 via-white to-indigo-50/40 p-3.5 shadow-xs flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {/* Camisa y Gualdrapa con el Diseñador IA */}
            <div className="scale-110">
              <CamisaJockeySvg
                numero={caballoActivo.ejemplar.numero}
                divisaTexto={caballoActivo.ejemplar.divisaTexto}
                studNombre={caballoActivo.ejemplar.stud}
                size={44}
                mostrarGualdrapa={true}
                permitirEdicionIa={true}
              />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded bg-slate-900 text-white font-mono px-1.5 py-0.2 text-[10px] font-black">
                  Llegada: {caballoActivo.ordenLlegadaProyectado}° Lugar
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
                Jinete: <b>{caballoActivo.ejemplar.jinete || "N/A"}</b> | Stud: <b>{caballoActivo.ejemplar.stud || "Tradicional"}</b> | Estilo: <b>{caballoActivo.ejemplar.estilo}</b>
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
      )}
    </div>
  );
}
