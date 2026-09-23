"use client";

import type { ValidacionComando } from "@/lib/taquilla/validar";

const COP = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

function fila(label: string, valor: string, clase = "text-slate-200") {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[11px] font-semibold text-slate-400">{label}</span>
      <span className={`text-[13px] font-bold ${clase}`}>{valor}</span>
    </div>
  );
}

/** Desglose proyectado del ticket (monto, ganancia, comisión) o error de regla. */
export function DesgloseProyectado({ validacion }: { validacion: ValidacionComando | null }) {
  if (!validacion) {
    return (
      <div className="rounded-xl border border-line bg-surfaceAlt/40 p-3 text-center text-[11px] text-slate-500">
        Escribe una jugada para ver el desglose proyectado.
      </div>
    );
  }

  if (!validacion.ok) {
    return (
      <div className="rounded-xl border-2 border-danger-500/50 bg-danger-500/10 p-3">
        <p className="text-[11px] font-black uppercase tracking-wide text-danger-500">⛔ Jugada rechazada</p>
        <p className="mt-1 text-[11px] leading-relaxed text-danger-600">{validacion.motivo}</p>
      </div>
    );
  }

  const p = validacion.proyeccion;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Desglose proyectado</p>
        <span className="rounded-full bg-success-500/10 px-2 py-0.5 text-[10px] font-bold text-success-500">
          ✓ Jugada válida
        </span>
      </div>
      <div className="divide-y divide-line rounded-xl border border-line bg-surfaceAlt/40 px-3 py-1">
        {fila("Monto invertido", COP.format(p.monto))}
        {fila("Resultado simulado", p.escenario, "text-slate-400 text-[10px]")}
        {fila("Ganancia proyectada", COP.format(Math.max(p.gananciaProyectada, 0)), "text-success-500")}
        {fila("Comisión de la casa", COP.format(p.comision), "text-warning-500")}
        {fila("Total a recibir (neto)", COP.format(p.totalClienteNeto), "text-primary-400 text-sm")}
      </div>
    </div>
  );
}

export default DesgloseProyectado;