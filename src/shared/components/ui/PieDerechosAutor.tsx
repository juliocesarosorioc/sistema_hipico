"use client";

import React from "react";

export type PieDerechosAutorProps = {
  variante?: "claro" | "oscuro" | "compacto";
  className?: string;
};

/**
 * Pie institucional con todos los parámetros de Derechos de Autor y protección
 * de Propiedad Intelectual de Inversiones Club Sensación, C.A.
 */
export function PieDerechosAutor({
  variante = "claro",
  className = "",
}: PieDerechosAutorProps) {
  const anio = new Date().getFullYear();

  if (variante === "compacto") {
    return (
      <footer
        className={`border-t border-slate-200/80 bg-white/90 px-4 py-2 text-center text-[10px] font-semibold text-slate-600 ${className}`}
      >
        <span>
          © {anio} <strong className="font-black text-slate-900">Inversiones Club Sensación, C.A.</strong> — Todos los derechos reservados · Propiedad Intelectual y Software Protegidos · Prohibida su reproducción, distribución o ingeniería inversa total o parcial sin autorización escrita.
        </span>
      </footer>
    );
  }

  const esOscuro = variante === "oscuro";

  return (
    <footer
      className={`border-t px-4 py-3 text-center text-[11px] leading-relaxed ${
        esOscuro
          ? "border-slate-800 bg-slate-950/90 text-slate-400"
          : "border-slate-200 bg-slate-900 text-slate-300"
      } ${className}`}
    >
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-1 sm:flex-row">
        <p className="font-bold text-white">
          © {anio} <span className="text-amber-400 font-black">Inversiones Club Sensación, C.A.</span> · Todos los derechos reservados.
        </p>
        <p className="text-[10px] text-slate-400">
          🔒 Propiedad Intelectual, Marca, Algoritmos de Liquidación y Diseño Gráfico Protegidos por las Leyes de Propiedad Industrial y Derecho de Autor · Prohibida su copia, cesión o reproducción total o parcial sin autorización expresa.
        </p>
      </div>
    </footer>
  );
}

export default PieDerechosAutor;
