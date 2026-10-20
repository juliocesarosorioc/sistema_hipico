"use client";

import { conCacheBust } from "@/shared/lib/logos";
import { useVersionLogos } from "@/shared/store/useHipodromosStore";

type Props = {
  /** Data URL o URL del logo (`logo_url`). */
  src?: string | null;
  /** Texto alternativo (nombre del hipódromo o del grupo). */
  alt: string;
  /** Tamaño del marco en px (cuadrado). */
  tamano?: number;
  /** Ícono de respaldo cuando no hay logo. */
  respaldo?: string;
  /** Clase extra del marco. */
  className?: string;
};

/**
 * ============================================================================
 * LOGO DISPLAY — el marco donde se muestra el logo de un Hipódromo o un Grupo
 * ============================================================================
 *
 * Un logo puede ser horizontal, vertical o cuadrado, y el operador lo sube tal
 * cual (hasta 256 px por lado). Antes cada pantalla envolvía `<img
 * className="object-contain">` a mano, con marcos de distinto tamaño y fondo,
 * así que un logo horizontal largo se veía apretado en unos lados y bien en
 * otros.
 *
 * Acá el marco es UNO solo para toda la plataforma:
 *
 *   · fondo neutro suave (blanco/`surfaceAlt`) con borde interior sutil;
 *   · `object-contain w-full h-full p-1` → NUNCA recorta ni deforma: la imagen
 *     se ajusta completa dentro del cuadro, sin importar su proporción;
 *   · se repinta al instante cuando se carga un logo (versión de logos global
 *     + cache-busting del `src`), sin recargar la página.
 */
export function LogoDisplay({
  src,
  alt,
  tamano = 56,
  respaldo = "🏇",
  className = "",
}: Props) {
  const versionLogos = useVersionLogos();

  const url = conCacheBust(src, versionLogos);

  return (
    <div
      className={[
        "flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 shadow-inner",
        className,
      ].join(" ")}
      style={{ width: tamano, height: tamano }}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={alt}
          crossOrigin="anonymous"
          referrerPolicy="no-referrer"
          className="h-full w-full object-contain p-1"
        />
      ) : (
        <span className="leading-none text-slate-300" style={{ fontSize: Math.round(tamano * 0.42) }} aria-hidden="true">
          {respaldo}
        </span>
      )}
    </div>
  );
}

export default LogoDisplay;
