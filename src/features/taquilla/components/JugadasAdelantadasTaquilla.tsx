"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/core/supabase";
import {
  grupoActivoVigente,
  grupoVigente,
  veTodosLosGruposVigente,
} from "@/features/seguridad/lib/vigente";

type TicketAdelantadoRow = {
  id: string | number;
  hipodromo?: string | null;
  carrera?: number | null;
  fecha_carrera?: string | null;
  nombre_jugada?: string | null;
  caballo?: string | null;
  ejemplar_numero?: number | null;
  monto_jugado?: number | null;
  cliente_juega_nombre?: string | null;
  cliente_consigue_nombre?: string | null;
  estado?: string | null;
  fecha_registro?: string | null;
};

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** Lista de jugadas adelantadas (`es_adelantada = true`) visibles directamente en Taquilla. */
export function JugadasAdelantadasTaquilla() {
  const [filas, setFilas] = useState<TicketAdelantadoRow[]>([]);
  const [cargando, setCargando] = useState(false);

  const cargar = useCallback(async () => {
    if (!supabase) return;
    setCargando(true);
    try {
      const activo = veTodosLosGruposVigente()
        ? grupoActivoVigente() || grupoVigente()
        : grupoVigente() || grupoActivoVigente();

      let q = supabase
        .from("tickets_apuestas")
        .select(
          "id, hipodromo, carrera, fecha_carrera, nombre_jugada, caballo, ejemplar_numero, monto_jugado, cliente_juega_nombre, cliente_consigue_nombre, estado, fecha_registro"
        )
        .eq("es_adelantada", true)
        .or("anulada.is.null,anulada.eq.false")
        .order("fecha_registro", { ascending: false })
        .limit(100);

      if (activo) {
        q = q.eq("grupo_cobro_id", activo);
      }

      const { data, error } = await q;
      if (!error && Array.isArray(data)) {
        setFilas(data as TicketAdelantadoRow[]);
      }
    } catch {
      /* mantener estado actual si falla red */
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
    const onRefresh = () => void cargar();
    window.addEventListener("hipico_tickets_actualizados", onRefresh);
    window.addEventListener("hipico:saldos-actualizados", onRefresh);
    return () => {
      window.removeEventListener("hipico_tickets_actualizados", onRefresh);
      window.removeEventListener("hipico:saldos-actualizados", onRefresh);
    };
  }, [cargar]);

  const total = filas.reduce((acc, r) => acc + (Number(r.monto_jugado) || 0), 0);

  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50/40">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-900 px-4 py-2.5 text-amber-50 rounded-t-2xl">
        <div className="flex items-center gap-2">
          <h3 className="text-[11px] font-black uppercase tracking-wide">
            ⏳ Jugadas Adelantadas en Taquilla ({filas.length})
          </h3>
          {filas.length > 0 && (
            <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-200">
              Total: {USD.format(total)}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void cargar()}
          disabled={cargando}
          className="rounded-lg border border-amber-400/40 bg-amber-800/70 px-2.5 py-1 text-[10px] font-bold uppercase text-amber-100 hover:bg-amber-700 disabled:opacity-50"
        >
          {cargando ? "Cargando…" : "↻ Actualizar"}
        </button>
      </div>

      {filas.length === 0 ? (
        <div className="px-4 py-6 text-center text-[11px] italic text-slate-500">
          No hay jugadas adelantadas registradas para este grupo.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-amber-200 bg-amber-100/60 text-[10px] font-black uppercase text-amber-900">
              <tr>
                <th className="px-3 py-2">Hipódromo / C</th>
                <th className="px-3 py-2">Jugada</th>
                <th className="px-3 py-2">Ejemplar</th>
                <th className="px-3 py-2">Cliente 1</th>
                <th className="px-3 py-2">Cliente 2</th>
                <th className="px-3 py-2 text-right">Monto</th>
                <th className="px-3 py-2">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-amber-200/70 bg-white/80">
              {filas.map((r) => {
                const ej = r.caballo || (r.ejemplar_numero ? String(r.ejemplar_numero) : "—");
                return (
                  <tr key={String(r.id)} className="hover:bg-amber-50/70">
                    <td className="px-3 py-2 font-bold text-slate-800">
                      {r.hipodromo || "—"} · C{r.carrera ?? "?"}
                      {r.fecha_carrera ? (
                        <span className="ml-1 text-[10px] font-normal text-slate-400">
                          ({r.fecha_carrera})
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 font-mono font-bold text-slate-900">
                      {r.nombre_jugada || "—"}
                    </td>
                    <td className="px-3 py-2 font-semibold text-slate-700">{ej}</td>
                    <td className="px-3 py-2 font-semibold text-slate-800">
                      {r.cliente_juega_nombre || "—"}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {r.cliente_consigue_nombre || "BANCA"}
                    </td>
                    <td className="px-3 py-2 text-right font-extrabold text-emerald-700">
                      {USD.format(Number(r.monto_jugado) || 0)}
                    </td>
                    <td className="px-3 py-2">
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-black uppercase text-amber-800">
                        ⏳ {r.estado || "Pendiente"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
