"use client";

import { useEffect, useState } from "react";
import {
  obtenerTemaActual,
  aplicarTemaAlDocumento,
  type TipoTema,
  TEMAS_DISPONIBLES,
  type InfoTema,
} from "@/shared/lib/temas";

export function useTema() {
  const [tema, setTemaState] = useState<TipoTema>("claro");
  const [montado, setMontado] = useState(false);

  useEffect(() => {
    const inicial = obtenerTemaActual();
    setTemaState(inicial);
    aplicarTemaAlDocumento(inicial);
    setMontado(true);

    const alCambiarTema = (e: Event) => {
      const customEvent = e as CustomEvent<{ tema: TipoTema }>;
      if (customEvent.detail?.tema) {
        setTemaState(customEvent.detail.tema);
      }
    };

    window.addEventListener("cambio_tema_visual", alCambiarTema);
    return () => window.removeEventListener("cambio_tema_visual", alCambiarTema);
  }, []);

  const cambiarTema = (nuevo: TipoTema) => {
    setTemaState(nuevo);
    aplicarTemaAlDocumento(nuevo);
  };

  const infoActual = TEMAS_DISPONIBLES.find((t) => t.id === tema) || TEMAS_DISPONIBLES[0];

  return {
    tema,
    cambiarTema,
    infoActual,
    temasDisponibles: TEMAS_DISPONIBLES,
    montado,
  };
}