"use client";

import React, { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { SalaJuegosApp } from "@/features/sala-juegos/components/SalaJuegosApp";

function SalaContenido() {
  const params = useSearchParams();
  const grupoId = params.get("grupo") || params.get("grupoId") || undefined;
  const clienteId = params.get("clienteId") || params.get("cliente_id") || undefined;
  const portalToken = params.get("token") || params.get("portalToken") || params.get("portal_token") || undefined;
  const staffToken = params.get("staffToken") || params.get("staff_token") || undefined;

  return (
    <SalaJuegosApp
      grupoIdInicial={grupoId}
      clienteIdInicial={clienteId}
      portalTokenInicial={portalToken}
      staffTokenInicial={staffToken}
    />
  );
}

/**
 * /sala — Sala de Juegos PWA con aislamiento estricto por grupo,
 * vista dual en escritorio, parser pedagógico y liquidación ACID con netting.
 */
export default function SalaJuegosPage() {
  return (
    <main className="h-[100dvh] w-screen overflow-hidden bg-[#0b141a]">
      <Suspense fallback={<div className="flex h-full w-full items-center justify-center text-emerald-400 font-bold text-sm">Cargando Sala de Juegos…</div>}>
        <SalaContenido />
      </Suspense>
    </main>
  );
}
