"use client";

import { getHorseColor, PALETA_GUALDRAPAS_OFICIAL } from "@/shared/lib/horseColors";

type Props = {
  numero: number | string;
  studColor?: string;
  className?: string;
  size?: number;
};

export function HorseSaddleclothSvg({ numero, studColor = "#f59e0b", className = "", size = 42 }: Props) {
  const n = Number(numero);
  const color = getHorseColor(n);
  const oficial = PALETA_GUALDRAPAS_OFICIAL[n as keyof typeof PALETA_GUALDRAPAS_OFICIAL];
  const gualdrapa = oficial?.hex || color.hex;
  const textColor = oficial?.textHex || color.hexText;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label={`Caballo número ${n || ""}`}
    >
      <g>
        <ellipse cx="38" cy="44" rx="12" ry="6" fill="#1f2937" opacity="0.25" />
        <path d="M18 38 L22 24 L30 18 L38 18 L44 24 L48 34 L46 42 L38 46 L28 44 L20 42 Z" fill="#8d7358" />
        <path d="M22 26 L28 22 L36 22 L42 26 L44 34 L40 38 L32 40 L24 38 L22 30 Z" fill="#a08963" />
        <path d="M20 40 L16 46 L18 52 L24 50 L26 44 Z" fill="#8d7358" />
        <path d="M40 40 L44 46 L42 52 L36 50 L34 44 Z" fill="#8d7358" />
        <path d="M26 18 L28 14 L34 12 L38 14 L36 18 Z" fill="#7c6747" />
        <ellipse cx="32" cy="16" rx="4" ry="3" fill="#8d7358" />
        <circle cx="31" cy="15" r="0.8" fill="#111827" />
        <path d="M36 16 L38 16 L38 18 L36 18 Z" fill="#111827" />
        <rect x="24" y="28" width="16" height="10" rx="3" fill={gualdrapa} stroke="#0f172a" strokeWidth="1" />
        <text x="32" y="35" textAnchor="middle" fontSize="9" fontWeight="800" fill={textColor} style={{ fontFamily: "JetBrains Mono, monospace" }}>
          {n || ""}
        </text>
        <rect x="28" y="38" width="8" height="4" rx="2" fill={studColor} opacity="0.9" />
        <circle cx="32" cy="40" r="1.2" fill="#f8fafc" opacity="0.9" />
      </g>
    </svg>
  );
}

export default HorseSaddleclothSvg;
