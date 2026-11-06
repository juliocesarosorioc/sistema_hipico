"use client";

import { useEffect, useState } from "react";
import { useTema } from "@/shared/hooks/useTema";
import { contarTareasPendientes } from "@/features/contabilidad/lib/cargas-rapidas-saldo";
import { ModalCargaRapidaSaldoYAval } from "@/features/contabilidad/components/ModalCargaRapidaSaldoYAval";

export function BotonCargaRapidaSaldo({
  clienteInicialId,
  compacto = false,
  className = "",
  texto,
}: {
  clienteInicialId?: string;
  compacto?: boolean;
  className?: string;
  texto?: string;
}) {
  const { tema } = useTema();
  const [modalAbierto, setModalAbierto] = useState(false);
  const [pendientes, setPendientes] = useState(0);

  const esClaro = tema === "claro";
  const esAstigmatismo = tema === "astigmatismo";
  const esRojo = tema === "rojo";
  const esVerde = tema === "verde";
  const esAzul = tema === "azul";

  const actualizarConteo = async () => {
    try {
      const c = await contarTareasPendientes();
      setPendientes(c);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    void actualizarConteo();
    const handler = () => void actualizarConteo();
    window.addEventListener("hipico:cargas-rapidas-actualizadas", handler);
    return () => window.removeEventListener("hipico:cargas-rapidas-actualizadas", handler);
  }, []);

  // Estilos visuales adaptativos según el tema activo y fondo de barra
  let botonClase = "";
  let badgeClase = "";

  if (esClaro) {
    botonClase = "border-blue-500/50 bg-blue-50/90 text-blue-900 hover:bg-blue-100 hover:border-blue-600 shadow-xs";
    badgeClase = "bg-blue-600 text-white";
  } else if (esAstigmatismo) {
    botonClase = "border-[#d4a373]/60 bg-[#26211a] text-[#d4a373] hover:bg-[#332c23] hover:border-[#e0b589] shadow-xs";
    badgeClase = "bg-[#d4a373] text-[#1c1813]";
  } else if (esRojo) {
    botonClase = "border-red-500/50 bg-red-950/40 text-red-200 hover:bg-red-900/60 hover:border-red-400 shadow-xs";
    badgeClase = "bg-red-500 text-white";
  } else if (esVerde) {
    botonClase = "border-emerald-500/50 bg-emerald-950/40 text-emerald-200 hover:bg-emerald-900/60 hover:border-emerald-400 shadow-xs";
    badgeClase = "bg-emerald-500 text-white";
  } else if (esAzul) {
    botonClase = "border-blue-500/50 bg-blue-950/40 text-blue-200 hover:bg-blue-900/60 hover:border-blue-400 shadow-xs";
    badgeClase = "bg-blue-500 text-white";
  } else {
    // Oscuro tradicional: En topbar con fondo claro o neutro, contraste garantizado
    botonClase = "border-amber-500/50 bg-amber-500/15 text-amber-900 hover:bg-amber-500/25 hover:border-amber-600 dark:text-amber-300 dark:hover:text-white shadow-xs";
    badgeClase = "bg-amber-500 text-slate-950";
  }

  const textoBoton = texto || "Saldos";

  return (
    <>
      <button
        type="button"
        onClick={() => setModalAbierto(true)}
        title="Saldos: Acreditar saldo, disminuir saldo, avales y cruces entre jugadores de inmediato."
        className={`group relative inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 sm:px-3 text-xs font-black transition-all active:scale-95 shrink-0 cursor-pointer ${botonClase} ${className}`}
      >
        <span className="text-sm font-black transition-transform group-hover:scale-110">
          ⚡
        </span>
        {!compacto && (
          <span className="tracking-tight font-black">
            {textoBoton}
          </span>
        )}

        {/* Badge de Tareas Pendientes */}
        {pendientes > 0 && (
          <span
            className={`flex items-center justify-center rounded-full px-1.5 py-0.2 text-[9px] font-black shadow-xs animate-pulse ${badgeClase}`}
            title={`${pendientes} operación(es) pendiente(s) de soporte o verificación`}
          >
            {pendientes}
          </span>
        )}
      </button>

      <ModalCargaRapidaSaldoYAval
        abierto={modalAbierto}
        onCerrar={() => setModalAbierto(false)}
        clienteInicialId={clienteInicialId}
        onCompletado={() => void actualizarConteo()}
      />
    </>
  );
}

// Alias con el nuevo nombre unificado
export const BotonSaldos = BotonCargaRapidaSaldo;
