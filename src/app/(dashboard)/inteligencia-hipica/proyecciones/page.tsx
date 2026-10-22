"use client";

import { useState } from "react";
import { ModalAnalisisActuarialGodet } from "@/features/ejemplares/components/ModalAnalisisActuarialGodet";

export default function ProyeccionesPage() {
  const [abierto, setAbierto] = useState(true);

  return (
    <div className="flex h-full w-full flex-col">
      <div className="border-b border-slate-200 bg-white px-6 py-4">
        <h1 className="text-xl font-black text-slate-900">Inteligencia Hípica · Proyecciones</h1>
        <p className="text-sm text-slate-500">
          Pizarra Prospectiva Michel Godet & Actuarial con parciales 400m, MICMAC/MACTOR, Bühlmann-Straub, Cox y Kelly Fraccional
        </p>
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-yellow-400 px-4 py-2 text-sm font-black text-slate-900 shadow-sm transition-colors hover:from-amber-400 hover:to-yellow-300"
        >
          🧭 Abrir Pizarra Prospectiva Godet & Actuarial
        </button>
      </div>
      <div className="flex-1 bg-slate-50 p-6">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-600">
            Selecciona carreras desde <strong>Ejemplares / Gaceta IA</strong> para cargar sus ejemplares directamente en la pizarra, o usa este acceso
            desde el menú para abrir la pizarra prospectiva con el estilo de la aplicación.
          </p>
        </div>
      </div>
      <ModalAnalisisActuarialGodet abierto={abierto} onCerrar={() => setAbierto(false)} ejemplares={[]} />
    </div>
  );
}
