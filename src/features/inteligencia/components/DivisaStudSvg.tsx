"use client";

import { interpretarDivisaCMG } from "@/features/inteligencia/lib/analista-venezuela-v4";
import { CamisaJockeySvg } from "@/features/inteligencia/components/CamisaJockeySvg";

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
  return (
    <CamisaJockeySvg
      numero={numero}
      divisaTexto={divisaTexto}
      studNombre={studNombre}
      className={className}
      mostrarGualdrapa={mostrarGualdrapa}
      permitirEdicionIa={true}
    />
  );
}
