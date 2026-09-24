"use client";

import { useState } from "react";
import { fmtMoney, type ItemCarritoVenta } from "@/lib/tablas/tipos";

type Props = {
  items: ItemCarritoVenta[];
  onQuitarItem: (id: string) => void;
  onVaciar: () => void;
  onCerrarVenta: () => void;
};

/**
 * Carrito de venta flotante arriba a la derecha (clon de #ventaCarritoMin):
 * botón fijo top-16 con icono 🛒 + contador "N · $ Total"; al abrir despliega
 * el listado de tablas en venta y el botón verde "Cerrar Venta".
 */
export function CarritoVentas({ items, onQuitarItem, onVaciar, onCerrarVenta }: Props) {
  const [abierto, setAbierto] = useState(false);
  const total = items.reduce((a, i) => a + (i.monto || 0), 0);

  return (
    <div className="no-print fixed top-16 right-4 z-40 md:right-96">
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        aria-expanded={abierto}
        className="flex items-center gap-2 rounded-full bg-slate-800 py-2 pl-2 pr-4 text-xs font-black uppercase tracking-wide text-white shadow-xl transition-colors hover:bg-slate-700"
      >
        <span className="grid h-8 w-8 place-items-center rounded-full bg-emerald-500 text-base text-white shadow-inner">🛒</span>
        <span>Carrito</span>
        <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-black tabular-nums">
          {items.length} · {fmtMoney(total)}
        </span>
      </button>

      {abierto && (
        <div className="absolute left-0 right-0 top-full mt-2 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-800 px-3 py-2 text-white">
            <h4 className="text-[11px] font-black uppercase">🛒 Venta en curso</h4>
            <div className="flex items-center gap-2">
              {items.length > 0 && (
                <button type="button" onClick={onVaciar} className="text-[10px] font-bold uppercase text-slate-300 hover:text-red-300">
                  Vaciar
                </button>
              )}
              <button type="button" onClick={() => setAbierto(false)} className="text-slate-300 hover:text-white">
                ✕
              </button>
            </div>
          </div>

          {items.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs italic text-slate-400">Carrito vacío. Vende una tabla en el Monitor.</p>
          ) : (
            <ul className="max-h-64 overflow-y-auto divide-y divide-slate-100">
              {items.map((it) => (
                <li key={it.id} className="flex items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate text-[11px] font-black uppercase text-slate-800">
                      {it.hipodromo} C{it.carrera} · N{it.numero} {it.nombre === "TABLA COMPLETA" ? "" : it.nombre}
                    </span>
                    <span className="block text-[10px] font-semibold text-slate-500">
                      {it.nombre === "TABLA COMPLETA" ? "Tabla completa" : `Ejemplar Nº ${it.numero}`}
                      {it.cantidad != null && it.cantidad > 1 ? ` · ${it.cantidad} tabla(s)` : ""}
                      {it.jugador ? ` · 👤 ${it.jugador.nombre}` : ""}
                    </span>
                  </span>
                  <span className="whitespace-nowrap text-[11px] font-black text-slate-900">{fmtMoney(it.monto, it.moneda)}</span>
                  <button
                    type="button"
                    onClick={() => onQuitarItem(it.id)}
                    className="px-1 text-red-400 hover:text-red-600"
                    title="Quitar del carrito"
                  >
                    🗑️
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-3 py-2">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
              Total a pagar · {items.length} tabla{items.length === 1 ? "" : "s"}
            </span>
            <span className="text-sm font-black text-slate-900">{fmtMoney(total)}</span>
          </div>
          <div className="border-t border-slate-200 p-2">
            <button
              type="button"
              disabled={items.length === 0}
              onClick={() => {
                onCerrarVenta();
                setAbierto(false);
              }}
              className="w-full rounded-xl bg-emerald-600 py-2.5 text-xs font-black uppercase tracking-wide text-white shadow-md transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              ✅ Cerrar Venta
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default CarritoVentas;