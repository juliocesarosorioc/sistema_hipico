"use client";

import { useMemo } from "react";
import {
  COLORES_GUALDRAPA,
  interpretarDivisaCMG,
} from "@/features/inteligencia/lib/analista-venezuela-v4";

export { interpretarDivisaCMG };

type Props = {
  numero: number;
  divisaTexto?: string;
  studNombre?: string;
  className?: string;
  mostrarGualdrapa?: boolean;
};

export function DivisaStudSvg({
  numero,
  divisaTexto,
  studNombre,
  className = "h-10 w-10",
  mostrarGualdrapa = true,
}: Props) {
  const gualdrapa = COLORES_GUALDRAPA[numero] || {
    bg: "#3B82F6",
    text: "#FFFFFF",
    nombreColor: "Azul",
    border: "#1D4ED8",
  };

  const { colorCamisa, colorMangas, colorGorro } = useMemo(
    () => interpretarDivisaCMG(divisaTexto),
    [divisaTexto]
  );

  return (
    <div className={`relative inline-flex items-center gap-1.5 ${className}`} title={divisaTexto || studNombre || `Ejemplar #${numero}`}>
      {/* Camiseta vectorial del Stud */}
      <svg
        viewBox="0 0 100 90"
        className="h-full w-auto drop-shadow-sm transition-transform hover:scale-105"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Mangas (M) */}
        {/* Manga Izquierda */}
        <path
          d="M 22 28 L 3 48 L 16 58 L 29 40 Z"
          fill={colorMangas}
          stroke="#1E293B"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        {/* Manga Derecha */}
        <path
          d="M 78 28 L 97 48 L 84 58 L 71 40 Z"
          fill={colorMangas}
          stroke="#1E293B"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />

        {/* Camisa / Cuerpo (C) */}
        <path
          d="M 28 22 L 72 22 L 68 85 L 32 85 Z"
          fill={colorCamisa}
          stroke="#1E293B"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />

        {/* Cuello */}
        <path
          d="M 39 22 C 39 30 61 30 61 22 Z"
          fill="#F8FAFC"
          stroke="#1E293B"
          strokeWidth="2"
        />

        {/* Gorro / Casco (G) */}
        <path
          d="M 40 18 C 40 8 60 8 60 18 Z"
          fill={colorGorro}
          stroke="#1E293B"
          strokeWidth="2"
        />
        {/* Visera del Gorro */}
        <path
          d="M 37 18 L 63 18"
          stroke="#0F172A"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>

      {/* Gualdrapa reglamentaria #1 al #16 */}
      {mostrarGualdrapa && (
        <div
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md font-mono text-xs font-black shadow-xs border"
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
  );
}
