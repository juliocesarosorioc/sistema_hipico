import type { CSSProperties, ReactNode } from "react";

/**
 * Banderas vectoriales (SVG inline, sin red) de las nacionalidades del Padrón.
 * Reemplaza los emojis (que en Windows se ven como letras "VE", "US", …) por una
 * miniatura real de la bandera. Mismo aspecto 3:2 que las banderas oficiales.
 */

type Props = {
  nac?: string | null;
  size?: number;
  className?: string;
  withName?: boolean;
};

const VISTA = 24;

function Rect({ x, y, w, h, fill }: { x: number; y: number; w: number; h: number; fill: string }) {
  return <rect x={x} y={y} width={w} height={h} fill={fill} />;
}

function Estrella({ cx, cy, r, fill }: { cx: number; cy: number; r: number; fill: string }) {
  const s = r;
  const p =
    `M ${cx} ${cy - s} ` +
    `L ${cx + s * 0.224} ${cy - s * 0.309} ` +
    `L ${cx + s} ${cy - s * 0.309} ` +
    `L ${cx + s * 0.363} ${cy + s * 0.118} ` +
    `L ${cx + s * 0.5} ${cy + s} ` +
    `L ${cx} ${cy + s * 0.382} ` +
    `L ${cx - s * 0.5} ${cy + s} ` +
    `L ${cx - s * 0.363} ${cy + s * 0.118} ` +
    `L ${cx - s} ${cy - s * 0.309} ` +
    `L ${cx - s * 0.224} ${cy - s * 0.309} Z`;
  return <path d={p} fill={fill} stroke="none" />;
}

const FLAGS: Record<string, ReactNode> = {
  VE: (
    <>
      <Rect x={0} y={0} w={24} h={5.33} fill="#FCD116" />
      <Rect x={0} y={5.33} w={24} h={5.33} fill="#003893" />
      <Rect x={0} y={10.67} w={24} h={5.33} fill="#CE1126" />
      {[3, 5, 7, 9, 11, 13, 15, 17].map((x, i) => (
        <Estrella key={i} cx={x} cy={i % 2 === 0 ? 8 : 8} r={0.95} fill="#FFF" />
      ))}
    </>
  ),
  USA: (
    <>
      <Rect x={0} y={0} w={24} h={16} fill="#B22234" />
      {[0, 2, 4, 6, 8, 10, 12].map((y) => (
        <Rect key={y} x={0} y={y} w={24} h={1.3} fill="#FFF" />
      ))}
      <rect x={0} y={0} width={10.6} height={8} fill="#3C3B6E" />
      {[1.1, 2.75, 4.4, 6.05].map((y, row) =>
        [1.06, 2.65, 4.24, 5.83, 7.42].map((x, col) => (
          <Estrella key={`${row}-${col}`} cx={col % 2 === 0 ? x : x + 0.8} cy={y} r={0.34} fill="#FFF" />
        ))
      )}
    </>
  ),
  BR: (
    <>
      <Rect x={0} y={0} w={24} h={16} fill="#009739" />
      <path d="M 12 1.5 L 24 8 L 12 14.5 L 0 8 Z" fill="#FEDD00" />
      <circle cx={12} cy={8} r={4.4} fill="#012169" />
      <path d="M 12 5.05 L 13.55 7.13 L 16.2 7.7 L 14.4 9.6 L 14.85 12.3 L 12 10.85 L 9.15 12.3 L 9.6 9.6 L 7.8 7.7 L 10.45 7.13 Z" fill="#FFF" />
    </>
  ),
  AR: (
    <>
      <Rect x={0} y={0} w={24} h={5.33} fill="#74ACDF" />
      <Rect x={0} y={5.33} w={24} h={5.33} fill="#FFF" />
      <Rect x={0} y={10.67} w={24} h={5.33} fill="#74ACDF" />
      <circle cx={12} cy={8} r={2.4} fill="#F6B40E" />
      <circle cx={12} cy={8} r={1.1} fill="#85340A" />
      {Array.from({ length: 14 }).map((_, i) => {
        const a = (i / 14) * Math.PI * 2;
        return (
          <line
            key={i}
            x1={12 + Math.cos(a) * 1.1}
            y1={8 + Math.sin(a) * 1.1}
            x2={12 + Math.cos(a) * 2.3}
            y2={8 + Math.sin(a) * 2.3}
            stroke="#F6B40E"
            strokeWidth={0.5}
          />
        );
      })}
    </>
  ),
  CL: (
    <>
      <Rect x={0} y={0} w={24} h={5.33} fill="#FFF" />
      <rect x={0} y={0} width={10} height={6.4} fill="#0039A6" />
      <Estrella cx={5} cy={3.2} r={1.8} fill="#FFF" />
      <Rect x={0} y={6.4} w={24} h={9.6} fill="#D52B1E" />
    </>
  ),
  MX: (
    <>
      <Rect x={0} y={0} w={8} h={16} fill="#006847" />
      <Rect x={8} y={0} w={8} h={16} fill="#FFF" />
      <Rect x={16} y={0} w={8} h={16} fill="#CE1126" />
      <circle cx={12} cy={9} r={2.2} fill="#9B6A3C" />
      <circle cx={12} cy={7} r={0.8} fill="#5A3A1E" />
    </>
  ),
  PA: (
    <>
      <Rect x={0} y={0} w={24} h={16} fill="#FFF" />
      <rect x={0} y={0} width={12} height={8} fill="#005293" />
      <rect x={12} y={8} width={12} height={8} fill="#D21034" />
      <Estrella cx={6} cy={4} r={1.7} fill="#FFF" />
      <Estrella cx={18} cy={12} r={1.7} fill="#D21034" />
    </>
  ),
  PE: (
    <>
      <Rect x={0} y={0} w={8} h={16} fill="#D91023" />
      <Rect x={8} y={0} w={8} h={16} fill="#FFF" />
      <Rect x={16} y={0} w={8} h={16} fill="#D91023" />
    </>
  ),
  CO: (
    <>
      <Rect x={0} y={0} w={24} h={8} fill="#FCD116" />
      <Rect x={0} y={8} w={12} h={8} fill="#003893" />
      <Rect x={12} y={8} w={12} h={8} fill="#CE1126" />
    </>
  ),
  EC: (
    <>
      <Rect x={0} y={0} w={24} h={8} fill="#FFDD00" />
      <Rect x={0} y={8} w={12} h={8} fill="#003893" />
      <Rect x={12} y={8} w={12} h={8} fill="#EF3340" />
      <circle cx={12} cy={7.4} r={2.6} fill="#603813" />
      <circle cx={12} cy={7.4} r={1.4} fill="#C9A063" />
    </>
  ),
  UY: (
    <>
      {[0, 1, 2, 3, 4].map((i) => (
        <Rect key={i} x={0} y={i * 3.2} w={24} h={1.6} fill="#FFF" />
      ))}
      {[1, 2, 3, 4].map((i) => (
        <Rect key={i} x={0} y={i * 3.2 + 1.6} w={24} h={1.6} fill="#0038A8" />
      ))}
      <rect x={0} y={0} width={9.2} height={8} fill="#FFF" />
      <circle cx={4.6} cy={3.8} r={2.2} fill="#F6B40E" />
      <circle cx={4.6} cy={3.8} r={1} fill="#7A4B0C" />
      {Array.from({ length: 10 }).map((_, i) => {
        const a = (i / 10) * Math.PI * 2;
        return (
          <line
            key={i}
            x1={4.6 + Math.cos(a) * 1}
            y1={3.8 + Math.sin(a) * 1}
            x2={4.6 + Math.cos(a) * 2.1}
            y2={3.8 + Math.sin(a) * 2.1}
            stroke="#F6B40E"
            strokeWidth={0.45}
          />
        );
      })}
    </>
  ),
  OTRA: (
    <>
      <Rect x={0} y={0} w={24} h={16} fill="#64748b" />
      <circle cx={12} cy={8} r={3} fill="#FFF" />
    </>
  ),
};

/** Nombre del país (paridad con `nombrePais` del padrón, sin dependencias de red). */
export const NOMBRES_PAIS_BANDERA: Record<string, string> = {
  VE: "Venezuela",
  USA: "Estados Unidos",
  BR: "Brasil",
  AR: "Argentina",
  CL: "Chile",
  MX: "México",
  PA: "Panamá",
  PE: "Perú",
  CO: "Colombia",
  EC: "Ecuador",
  UY: "Uruguay",
  OTRA: "Otro país",
};

/** Normaliza el código: "venezuela", "usa", "BRASIL" → "VE" / "USA" / "BR". */
export function normalizarNacionalidad(raw?: string | null): string {
  const v = (raw ?? "").trim().toUpperCase();
  if (!v) return "VE";
  const sin = new Map<string, string>([
    ["VE", "VE"], ["VEN", "VE"], ["VENEZUELA", "VE"],
    ["USA", "USA"], ["US", "USA"], ["EUA", "USA"], ["EEUU", "USA"], ["ESTADOS UNIDOS", "USA"],
    ["BR", "BR"], ["BRA", "BR"], ["BRASIL", "BR"], ["BRAZIL", "BR"],
    ["AR", "AR"], ["ARG", "AR"], ["ARGENTINA", "AR"],
    ["CL", "CL"], ["CHILE", "CL"],
    ["MX", "MX"], ["MEX", "MX"], ["MEXICO", "MX"],
    ["PA", "PA"], ["PAN", "PA"], ["PANAMA", "PA"], ["PANAMÁ", "PA"],
    ["PE", "PE"], ["PER", "PE"], ["PERU", "PE"], ["PERÚ", "PE"],
    ["CO", "CO"], ["COL", "CO"], ["COLOMBIA", "CO"],
    ["EC", "EC"], ["ECU", "EC"], ["ECUADOR", "EC"],
    ["UY", "UY"], ["URU", "UY"], ["URUGUAY", "UY"],
  ]);
  return sin.get(v) ?? "OTRA";
}

/** Ícono listo para usar en cualquier listado/buscador: miniatura de bandera nítida. */
export function Flag({
  nac,
  size = 16,
  className = "",
  withName = true,
}: {
  nac?: string | null;
  size?: number;
  className?: string;
  withName?: boolean;
}) {
  const iso = normalizarNacionalidad(nac);
  const node = FLAGS[iso] ?? FLAGS.OTRA;
  const nombre = NOMBRES_PAIS_BANDERA[iso] ?? iso;
  const svg = (
    <svg
      width={size}
      height={(size * 2) / 3}
      viewBox={`0 0 ${VISTA} 16`}
      className={`inline-block shrink-0 rounded-[2px] align-[-1px] shadow-[0_0_0_1px_rgba(0,0,0,0.15)] ${className}`}
      role="img"
      aria-label={nombre}
    >
      {node}
    </svg>
  );
  if (!withName) return svg;
  return (
    <span className="inline-flex items-center gap-1" title={nombre}>
      {svg}
    </span>
  );
}