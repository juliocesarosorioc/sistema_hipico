"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Carreras del Día se fusionó con el módulo de Ejemplares y Gaceta: es la misma
 * data (resultados_carreras) editada en una sola pantalla. Esta ruta queda solo
 * como alias para los enlaces y marcadores anteriores.
 *
 * La redirección es en cliente a propósito: la app se exporta de forma estática
 * (output: "export") y un redirect() de servidor no se puede validar con tsc.
 */
export default function CarrerasPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/ejemplares?tab=carreras");
  }, [router]);

  return (
    <div className="p-4 text-center text-sm font-semibold text-slate-500 lg:p-6">
      Carreras del Día se fusionó con Ejemplares y Gaceta. Redirigiendo…
    </div>
  );
}
