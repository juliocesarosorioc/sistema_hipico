"use client";

import React, { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { SalaJuegosApp } from "@/features/sala-juegos/components/SalaJuegosApp";
import { SalaWhatsAppConectada } from "@/features/sala-juegos/components/SalaWhatsAppConectada";
import { useAuthStore } from "@/shared/store/useAuthStore";

class SalaErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; mensaje: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, mensaje: "" };
  }

  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      mensaje: error?.message || "Error inesperado al renderizar la Sala de Apuestas.",
    };
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center bg-white text-slate-900 p-6 text-center gap-3">
          <span className="text-4xl">🏇</span>
          <h2 className="text-base font-black text-[#008069]">No se pudo mostrar la Sala</h2>
          <p className="text-xs text-slate-600 max-w-md">{this.state.mensaje}</p>
          <div className="flex items-center gap-2 mt-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="bg-emerald-100 hover:bg-emerald-200 text-emerald-900 font-bold text-xs px-4 py-2 rounded-lg shadow-xs"
            >
              Recargar Sala
            </button>
            <a
              href="/inicio"
              className="bg-slate-200 hover:bg-slate-300 text-emerald-900 font-bold text-xs px-4 py-2 rounded-lg"
            >
              Volver al Inicio
            </a>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function SalaContenido() {
  const params = useSearchParams();
  const grupoStore = useAuthStore((s) => s.grupoId || s.grupoActivo);
  const grupoId = params.get("grupo") || params.get("grupoId") || grupoStore || undefined;
  const clienteId = params.get("clienteId") || params.get("cliente_id") || undefined;
  const portalToken = params.get("token") || params.get("portalToken") || params.get("portal_token") || undefined;
  const staffTokenParam = params.get("staffToken") || params.get("staff_token") || undefined;
  const staffTokenStored =
    typeof window !== "undefined"
      ? sessionStorage.getItem("sala_staff_token") || localStorage.getItem("sala_staff_token") || undefined
      : undefined;
  const staffToken = staffTokenParam || staffTokenStored;
  const ui = (params.get("ui") || params.get("vista") || "").toLowerCase();

  // El tablero WhatsApp conectado comparte exactamente la misma sesión real
  // (portal token o staff JWT/HMAC), el mismo bootstrap de perfil/salas y el
  // mismo Realtime. La app principal sigue siendo el valor por defecto.
  if (ui === "whatsapp" || ui === "legacy") {
    return (
      <SalaWhatsAppConectada
        grupoIdInicial={grupoId}
        clienteIdInicial={clienteId}
        portalTokenInicial={portalToken}
        staffTokenInicial={staffToken}
      />
    );
  }

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
    <main className="min-h-[100dvh] h-[100dvh] w-full max-w-full overflow-hidden bg-white">
      <SalaErrorBoundary>
        <Suspense
          fallback={
            <div className="flex h-full w-full flex-col items-center justify-center bg-white text-[#008069] gap-3 select-none">
              <div className="w-10 h-10 border-4 border-[#008069] border-t-transparent rounded-full animate-spin" />
              <span className="font-extrabold text-sm tracking-wide text-[#008069]">
                Conectando a la Sala de Juegos…
              </span>
            </div>
          }
        >
          <SalaContenido />
        </Suspense>
      </SalaErrorBoundary>
    </main>
  );
}
