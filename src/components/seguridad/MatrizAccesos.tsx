"use client";

import { useMemo } from "react";
import type { Permiso } from "@/lib/seguridad/tipos";
import { ToggleAcceso } from "@/components/seguridad/ToggleAcceso";

type Props = {
  permisos: Permiso[];
  vigentes: Set<string>;
  enCambio: (clave: string, activo: boolean) => void;
};

const ICONOS_MODULO: Record<string, string> = {
  general: "🏠",
  taquilla: "🎟️",
  tablas: "📋",
  gestion: "🎯",
  ejemplares: "🐴",
  contabilidad: "💵",
  seguridad: "🛡️",
};

/**
 * Matriz tipo grid (módulo × permiso) con toggles por acción. Reutilizable
 * para perfiles y para usuarios individuales.
 */
export function MatrizAccesos({ permisos, vigentes, enCambio }: Props) {
  const grupos = useMemo(() => {
    const map = new Map<string, Permiso[]>();
    for (const p of permisos) {
      const lista = map.get(p.modulo) ?? [];
      lista.push(p);
      map.set(p.modulo, lista);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [permisos]);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {grupos.map(([modulo, lista]) => (
        <div key={modulo} className="border-b border-slate-100 last:border-b-0">
          <div className="flex items-center justify-between bg-slate-50 px-4 py-2">
            <p className="text-[11px] font-black uppercase tracking-wider text-slate-600">
              {ICONOS_MODULO[modulo] ?? "🧩"} {modulo}
            </p>
            <span className="text-[10px] font-bold text-slate-400">
              {lista.filter((p) => vigentes.has(p.clave)).length}/{lista.length}
            </span>
          </div>
          <ul className="divide-y divide-slate-100">
            {lista.map((p) => {
              const activo = vigentes.has(p.clave);
              return (
                <li key={p.clave} className="flex items-center gap-3 px-4 py-2.5">
                  <ToggleAcceso activo={activo} onChange={(v) => enCambio(p.clave, v)} label={p.clave} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-slate-800">
                      <code className="text-[12px] text-indigo-600">{p.clave}</code>
                    </p>
                    {p.descripcion && <p className="truncate text-[11px] text-slate-500">{p.descripcion}</p>}
                  </div>
                  <span className={`hidden shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black uppercase sm:inline ${activo ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>
                    {activo ? "Permitido" : "Denegado"}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

export default MatrizAccesos;