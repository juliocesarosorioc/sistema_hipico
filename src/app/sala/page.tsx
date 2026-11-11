"use client";

import React from "react";
import { SalaJuegosApp } from "@/features/sala-juegos/components/SalaJuegosApp";

/**
 * /sala — Sala de Juegos PWA con aislamiento estricto por grupo,
 * vista dual en escritorio, parser pedagógico y liquidación ACID con netting.
 */
export default function SalaJuegosPage() {
  return (
    <main className="h-[100dvh] w-screen overflow-hidden bg-[#0b141a]">
      <SalaJuegosApp />
    </main>
  );
}
