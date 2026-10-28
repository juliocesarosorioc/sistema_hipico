"use client";

import { useId, useMemo, useState } from "react";
import {
  interpretarDivisaAvanzada,
  disenarCamisaConGeminiIa,
  type DisenoCamisaCompleto,
  type PatronCuerpo,
  type PatronMangas,
} from "@/features/inteligencia/lib/disenador-camisas-ia";
import { COLORES_GUALDRAPA } from "@/features/inteligencia/lib/analista-venezuela-v4";

type Props = {
  numero: number;
  divisaTexto?: string;
  studNombre?: string;
  className?: string;
  size?: number;
  mostrarGualdrapa?: boolean;
  permitirEdicionIa?: boolean;
};

export function CamisaJockeySvg({
  numero,
  divisaTexto,
  studNombre,
  className = "",
  size = 40,
  mostrarGualdrapa = true,
  permitirEdicionIa = false,
}: Props) {
  const uid = useId().replace(/:/g, "_");
  const [modalAbierto, setModalAbierto] = useState(false);
  const [disenoIaPersonalizado, setDisenoIaPersonalizado] = useState<DisenoCamisaCompleto | null>(null);
  const [cargandoIa, setCargandoIa] = useState(false);

  // Obtener gualdrapa reglamentaria
  const gualdrapa = COLORES_GUALDRAPA[numero] || {
    bg: "#3B82F6",
    text: "#FFFFFF",
    nombreColor: "Azul",
    border: "#1D4ED8",
  };

  // Diseño base obtenido del analizador sintáctico o de Gemini
  const diseno = useMemo(() => {
    if (disenoIaPersonalizado) return disenoIaPersonalizado;
    return interpretarDivisaAvanzada(divisaTexto, studNombre);
  }, [divisaTexto, studNombre, disenoIaPersonalizado]);

  const handleConsultarGemini = async () => {
    const texto = divisaTexto || studNombre || "";
    if (!texto) return;
    setCargandoIa(true);
    try {
      const res = await disenarCamisaConGeminiIa(texto, studNombre);
      if (res) {
        setDisenoIaPersonalizado(res);
      }
    } finally {
      setCargandoIa(false);
    }
  };

  const clipId = `torso-clip-${uid}`;

  return (
    <>
      <div
        className={`relative inline-flex items-center gap-1.5 cursor-pointer select-none group ${className}`}
        onClick={() => {
          if (permitirEdicionIa) setModalAbierto(true);
        }}
        title={
          divisaTexto ||
          studNombre ||
          `Ejemplar #${numero} - Patrón: ${diseno.patronCuerpo} (${diseno.colorCuerpoPrincipal}/${diseno.colorCuerpoSecundario})`
        }
      >
        {/* Camisa Vectorial de Alta Definición */}
        <svg
          width={size}
          height={Math.round(size * 0.92)}
          viewBox="0 0 100 92"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="transition-transform duration-200 group-hover:scale-110 drop-shadow-sm shrink-0"
        >
          <defs>
            {/* Máscara del torso para que los patrones queden contenidos */}
            <clipPath id={clipId}>
              <path d="M 28 22 L 72 22 L 67 85 L 33 85 Z" />
            </clipPath>

            {/* Gradiente de brillo de seda para realismo tridimensional */}
            <linearGradient id={`silk-shimmer-${uid}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.25" />
              <stop offset="50%" stopColor="#FFFFFF" stopOpacity="0.0" />
              <stop offset="100%" stopColor="#000000" stopOpacity="0.2" />
            </linearGradient>
          </defs>

          {/* 1. MANGAS (Se dibujan detrás del torso) */}
          {/* Manga Izquierda */}
          <g>
            <path
              d="M 28 24 L 6 46 L 18 58 L 33 38 Z"
              fill={diseno.colorMangasPrincipal}
              stroke="#0F172A"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            {/* Patrón en Manga Izquierda */}
            {diseno.patronMangas === "AROS_ANILLOS" && (
              <>
                <path d="M 20 33 L 13 40 L 17 44 L 24 37 Z" fill={diseno.colorMangasSecundario} />
                <path d="M 14 39 L 8 45 L 12 49 L 18 43 Z" fill={diseno.colorMangasSecundario} />
              </>
            )}
            {diseno.patronMangas === "RAYAS" && (
              <path d="M 26 26 L 10 44 L 14 48 L 30 30 Z" fill={diseno.colorMangasSecundario} opacity="0.8" />
            )}
            {/* Puño de manga izquierda */}
            <path d="M 6 46 L 18 58" stroke={diseno.colorCuello} strokeWidth="2.5" />
          </g>

          {/* Manga Derecha */}
          <g>
            <path
              d="M 72 24 L 94 46 L 82 58 L 67 38 Z"
              fill={diseno.colorMangasPrincipal}
              stroke="#0F172A"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            {/* Patrón en Manga Derecha */}
            {diseno.patronMangas === "AROS_ANILLOS" && (
              <>
                <path d="M 80 33 L 87 40 L 83 44 L 76 37 Z" fill={diseno.colorMangasSecundario} />
                <path d="M 86 39 L 92 45 L 88 49 L 82 43 Z" fill={diseno.colorMangasSecundario} />
              </>
            )}
            {diseno.patronMangas === "RAYAS" && (
              <path d="M 74 26 L 90 44 L 86 48 L 70 30 Z" fill={diseno.colorMangasSecundario} opacity="0.8" />
            )}
            {/* Puño de manga derecha */}
            <path d="M 94 46 L 82 58" stroke={diseno.colorCuello} strokeWidth="2.5" />
          </g>

          {/* 2. TORSO / CUERPO BASE */}
          <path
            d="M 28 22 L 72 22 L 67 85 L 33 85 Z"
            fill={diseno.colorCuerpoPrincipal}
            stroke="#0F172A"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />

          {/* 3. PATRÓN GEOMÉTRICO DEL CUERPO (Con clip-path para que no desborde) */}
          <g clipPath={`url(#${clipId})`}>
            {/* Banda Diagonal (Sash) */}
            {diseno.patronCuerpo === "BANDA_DIAGONAL" && (
              <polygon
                points="24,18 42,18 76,88 58,88"
                fill={diseno.colorCuerpoSecundario}
                stroke="#0F172A"
                strokeWidth="1"
              />
            )}

            {/* Franja Horizontal (Hoops) */}
            {diseno.patronCuerpo === "FRANJA_HORIZONTAL" && (
              <>
                <rect
                  x="20"
                  y="40"
                  width="60"
                  height="16"
                  fill={diseno.colorCuerpoSecundario}
                  stroke="#0F172A"
                  strokeWidth="1"
                />
                <rect
                  x="20"
                  y="62"
                  width="60"
                  height="10"
                  fill={diseno.colorCuerpoSecundario}
                  stroke="#0F172A"
                  strokeWidth="1"
                />
              </>
            )}

            {/* Rayas Verticales (Stripes) */}
            {diseno.patronCuerpo === "RAYAS_VERTICALES" && (
              <>
                <rect x="37" y="20" width="8" height="66" fill={diseno.colorCuerpoSecundario} />
                <rect x="55" y="20" width="8" height="66" fill={diseno.colorCuerpoSecundario} />
              </>
            )}

            {/* Chevron en V */}
            {diseno.patronCuerpo === "CHEVRON_V" && (
              <polygon
                points="28,22 50,56 72,22 62,22 50,42 38,22"
                fill={diseno.colorCuerpoSecundario}
                stroke="#0F172A"
                strokeWidth="1"
              />
            )}

            {/* Estrellas en el Pecho */}
            {diseno.patronCuerpo === "ESTRELLAS" && (
              <g fill={diseno.colorCuerpoSecundario} stroke="#0F172A" strokeWidth="0.8">
                {/* Estrella Central */}
                <polygon points="50,38 53,46 62,46 55,51 57,59 50,54 43,59 45,51 38,46 47,46" />
                {/* Estrella Superior Izquierda */}
                <polygon points="38,26 40,31 45,31 41,34 42,39 38,36 34,39 35,34 31,31 36,31" />
                {/* Estrella Superior Derecha */}
                <polygon points="62,26 64,31 69,31 65,34 66,39 62,36 58,39 59,34 55,31 60,31" />
                {/* Estrella Inferior */}
                <polygon points="50,65 52,70 57,70 53,73 54,78 50,75 46,78 47,73 43,70 48,70" />
              </g>
            )}

            {/* Cuadros / Damero */}
            {diseno.patronCuerpo === "CUADROS" && (
              <g fill={diseno.colorCuerpoSecundario}>
                <rect x="28" y="22" width="22" height="16" />
                <rect x="50" y="38" width="22" height="16" />
                <rect x="28" y="54" width="22" height="16" />
                <rect x="50" y="70" width="22" height="16" />
              </g>
            )}

            {/* Rombos / Diamantes */}
            {diseno.patronCuerpo === "ROMBOS" && (
              <g fill={diseno.colorCuerpoSecundario} stroke="#0F172A" strokeWidth="0.8">
                <polygon points="50,26 60,40 50,54 40,40" />
                <polygon points="50,54 60,68 50,82 40,68" />
                <polygon points="36,44 44,56 36,68 28,56" />
                <polygon points="64,44 72,56 64,68 56,56" />
              </g>
            )}

            {/* Lunares / Círculos */}
            {diseno.patronCuerpo === "LUNARES" && (
              <g fill={diseno.colorCuerpoSecundario} stroke="#0F172A" strokeWidth="0.6">
                <circle cx="50" cy="40" r="5" />
                <circle cx="38" cy="30" r="4" />
                <circle cx="62" cy="30" r="4" />
                <circle cx="40" cy="56" r="4.5" />
                <circle cx="60" cy="56" r="4.5" />
                <circle cx="50" cy="72" r="5" />
              </g>
            )}

            {/* Mitad y Mitad */}
            {diseno.patronCuerpo === "MITAD_MITAD" && (
              <rect x="50" y="20" width="25" height="66" fill={diseno.colorCuerpoSecundario} />
            )}

            {/* Cruz en el Pecho */}
            {diseno.patronCuerpo === "CRUZ" && (
              <g fill={diseno.colorCuerpoSecundario} stroke="#0F172A" strokeWidth="0.8">
                <rect x="44" y="26" width="12" height="46" />
                <rect x="32" y="40" width="36" height="12" />
              </g>
            )}

            {/* Brillo Satinado de Seda */}
            <rect x="28" y="22" width="44" height="63" fill={`url(#silk-shimmer-${uid})`} />
          </g>

          {/* 4. CUELLO Y BOTONADURA */}
          {/* Cuello redondo / V */}
          <path
            d="M 38 22 C 38 30 62 30 62 22 Z"
            fill={diseno.colorCuello}
            stroke="#0F172A"
            strokeWidth="2"
          />

          {/* 5. CASCO / GORRO DE JOCKEY */}
          {/* Cuerpo del casco */}
          <path
            d="M 39 18 C 39 6 61 6 61 18 Z"
            fill={diseno.colorGorro}
            stroke="#0F172A"
            strokeWidth="2"
          />
          {/* Visera del Casco */}
          <path
            d="M 36 18 C 36 18 50 20 64 18"
            stroke={diseno.colorVisera}
            strokeWidth="3.5"
            strokeLinecap="round"
          />
          {/* Antiparras / Goggles en la frente */}
          <rect
            x="42"
            y="11"
            width="7"
            height="4"
            rx="1.5"
            fill="#38BDF8"
            stroke="#0F172A"
            strokeWidth="1"
            opacity="0.9"
          />
          <rect
            x="51"
            y="11"
            width="7"
            height="4"
            rx="1.5"
            fill="#38BDF8"
            stroke="#0F172A"
            strokeWidth="1"
            opacity="0.9"
          />
          <line x1="49" y1="13" x2="51" y2="13" stroke="#0F172A" strokeWidth="1" />
        </svg>

        {/* Gualdrapa Oficial con Número (#1 al #16) */}
        {mostrarGualdrapa && (
          <div
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md font-mono text-xs font-black shadow-xs border transition-transform group-hover:scale-105"
            style={{
              backgroundColor: gualdrapa.bg,
              color: gualdrapa.text,
              borderColor: gualdrapa.border,
            }}
            title={`Gualdrapa #${numero} (${gualdrapa.nombreColor})`}
          >
            {numero}
          </div>
        )}
      </div>

      {/* MODAL DETALLADO DE ESTUDIO DE DISEÑO DE DIVISA CON IA */}
      {modalAbierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">🎨</span>
                <div>
                  <h4 className="text-sm font-black uppercase text-slate-900">
                    Estudio de Divisa IA — Ejemplar #{numero}
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Diseño vectorial generado según especificaciones de la Gaceta Hípica
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setModalAbierto(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            {/* Vista Previa en Gran Tamaño */}
            <div className="flex flex-col items-center justify-center py-4 bg-gradient-to-b from-slate-50 to-slate-100/60 rounded-xl border border-slate-200/80">
              <div className="scale-150 transform mb-3">
                <CamisaJockeySvg
                  numero={numero}
                  divisaTexto={divisaTexto}
                  studNombre={studNombre}
                  size={70}
                  mostrarGualdrapa={true}
                  permitirEdicionIa={false}
                />
              </div>
              <span className="text-xs font-black text-slate-800 mt-2">
                Patrón: {diseno.patronCuerpo} | Mangas: {diseno.patronMangas}
              </span>
              <span className="text-[10px] text-slate-500">
                Gualdrapa #{numero} Oficial: {gualdrapa.nombreColor}
              </span>
            </div>

            {/* Detalles del Stud y Descripción de la Gaceta */}
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs space-y-1.5">
              <div className="flex justify-between items-center text-[11px]">
                <b className="text-slate-700">Texto Gaceta / Stud:</b>
                <span className="font-mono text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-200">
                  {divisaTexto || studNombre || `Ejemplar #${numero}`}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1 text-[11px]">
                <div className="flex items-center gap-1.5">
                  <div className="h-3.5 w-3.5 rounded border" style={{ backgroundColor: diseno.colorCuerpoPrincipal }} />
                  <span className="text-slate-600">Cuerpo: {diseno.colorCuerpoPrincipal}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-3.5 w-3.5 rounded border" style={{ backgroundColor: diseno.colorCuerpoSecundario }} />
                  <span className="text-slate-600">Detalle: {diseno.colorCuerpoSecundario}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-3.5 w-3.5 rounded border" style={{ backgroundColor: diseno.colorMangasPrincipal }} />
                  <span className="text-slate-600">Mangas: {diseno.colorMangasPrincipal}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-3.5 w-3.5 rounded border" style={{ backgroundColor: diseno.colorGorro }} />
                  <span className="text-slate-600">Gorro: {diseno.colorGorro}</span>
                </div>
              </div>
            </div>

            {/* Botón para llamar a Gemini IA */}
            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={handleConsultarGemini}
                disabled={cargandoIa}
                className="flex-1 py-2 px-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-black text-xs shadow-md transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <span>✨</span>
                <span>{cargandoIa ? "Diseñando con Gemini IA..." : "Rediseñar con Gemini IA"}</span>
              </button>
              <button
                type="button"
                onClick={() => setModalAbierto(false)}
                className="py-2 px-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
