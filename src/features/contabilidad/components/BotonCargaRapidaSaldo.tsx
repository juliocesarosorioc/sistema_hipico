"use client";

import { useEffect, useState } from "react";
import { contarTareasPendientes } from "@/features/contabilidad/lib/cargas-rapidas-saldo";
import { ModalCargaRapidaSaldoYAval } from "@/features/contabilidad/components/ModalCargaRapidaSaldoYAval";

export function BotonCargaRapidaSaldo({
  clienteInicialId,
  compacto = false,
  className = "",
}: {
  clienteInicialId?: string;
  compacto?: boolean;
  className?: string;
}) {
  const [modalAbierto, setModalAbierto] = useState(false);
  const [pendientes, setPendientes] = useState(0);

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

  return (
    <>
      <button
        type="button"
        onClick={() => setModalAbierto(true)}
        title="Carga Rápida de Saldo o Aval (Colocar/Sumar Aval, Colocar/Sumar Pozo) sin comprobante inmediato. Queda como tarea pendiente de soporte y verificación."
        className={`group relative inline-flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-gradient-to-r from-amber-500/20 via-amber-500/10 to-amber-600/20 px-2.5 sm:px-3 py-1.5 text-xs font-black text-amber-300 shadow-sm hover:border-amber-400 hover:bg-amber-500/30 hover:text-white transition-all active:scale-95 shrink-0 ${className}`}
      >
        <span className="text-sm font-black text-amber-400 group-hover:scale-110 transition-transform">
          ⚡
        </span>
        {!compacto && (
          <span className="hidden sm:inline tracking-tight">
            Carga Rápida
          </span>
        )}
        <span className="sm:hidden font-bold">Saldo</span>

        {/* Badge de Tareas Pendientes */}
        {pendientes > 0 && (
          <span
            className="flex items-center justify-center rounded-full bg-amber-400 px-1.5 py-0.2 text-[9px] font-black text-slate-950 shadow-xs animate-pulse"
            title={`${pendientes} carga(s) rápida(s) pendiente(s) de soporte o verificación`}
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
