"use client";

import { useState } from "react";
import type { StoredTablaFija } from "@/store/useTablasFijasStore";
import { colorDeNumero, textoDeNumero, fmtMoney, FLAG, sumaBase, parseNum } from "@/lib/tablas/tipos";
import { Button } from "@/components/ui/Button";
import { CargaResultadosModal, type PizarraResultados } from "@/components/liquidacion/CargaResultadosModal";

export type VentaTablaItem = { tablaId: string | number; numero: string; nombre: string; monto: number };

type Props = {
  tablas: StoredTablaFija[];
  onVender?: (item: VentaTablaItem) => void;
  onLiquidar?: (tabla: StoredTablaFija, r: PizarraResultados) => void;
  onEditar?: (tabla: StoredTablaFija, patch: Record<string, unknown>) => void;
};

/**
 * Monitor de Tablas Publicadas — clon 1:1 de js/tablas.js (L823-857):
 * tarjeta con cabecera de color degradada diagonal (indigo→púrpura→fucsia),
 * chips de hipódromo/carrera/distancia/superficie/fecha, fila "Monto a Pagar /
 * Tabla", lista numerada de ejemplares y pie con suma. "Vender" manda el item
 * al Carrito flotante; "Liquidar" cierra la tabla (desaparece sin F5).
 */
export function MonitorTablas({ tablas, onVender, onLiquidar, onEditar }: Props) {
  const [vendiendo, setVendiendo] = useState<StoredTablaFija | null>(null);
  const [ejemplarVenta, setEjemplarVenta] = useState("");
  const [montoVenta, setMontoVenta] = useState("");
  const [liquidando, setLiquidando] = useState<StoredTablaFija | null>(null);
  const [editando, setEditando] = useState<StoredTablaFija | null>(null);
  const [patchEdicion, setPatchEdicion] = useState<Record<string, unknown>>({});
  const [aviso, setAviso] = useState("");

  const abiertas = tablas.filter((t) => !t.cerrada);

  const lanzarVenta = () => {
    if (!vendiendo || !ejemplarVenta.trim() || !montoVenta.trim()) {
      return setAviso("Selecciona un ejemplar e indica el monto jugado.");
    }
    onVender?.({
      tablaId: vendiendo.id,
      numero: ejemplarVenta,
      nombre: (vendiendo.caballos ?? []).find((c) => String(c.numero) === ejemplarVenta)?.nombre ?? "TABLA COMPLETA",
      monto: parseNum(montoVenta),
    });
    setVendiendo(null);
    setEjemplarVenta("");
    setMontoVenta("");
    setAviso("🛒 Agregado al carrito de venta (arriba a la derecha).");
  };

  const guardarEdicion = () => {
    if (editando) onEditar?.(editando, patchEdicion);
    setEditando(null);
    setPatchEdicion({});
    setAviso("✅ Tabla actualizada.");
  };

  return (
    <div className="space-y-4">
      {aviso && <p className="rounded-lg bg-success-500/10 px-3 py-2 text-xs font-semibold text-success-700 no-print">{aviso}</p>}

      {/* Vista en pantalla */}
      <div className="grid gap-4 print:hidden sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {abiertas.length === 0 && (
          <div className="col-span-full rounded-2xl border border-dashed border-line bg-surface p-10 text-center">
            <p className="text-sm font-semibold text-slate-500">No hay tablas publicadas abiertas.</p>
            <p className="mt-1 text-xs text-slate-400">Añade una carrera en “Parámetros de la próxima carrera” y publícala desde el Ensamblaje.</p>
          </div>
        )}
        {abiertas.map((t) => (
          <div key={String(t.id)} className="flex flex-col overflow-hidden rounded-xl border border-indigo-200 bg-white shadow-sm">
            {/* Cabecera color (legacy L825: linear-gradient(135deg,#4f46e5,#7c3aed,#9333ea)) */}
            <div className="px-1.5 py-px text-white" style={{ background: "linear-gradient(135deg,#4f46e5 0%,#7c3aed 60%,#9333ea 100%)" }}>
              <div className="flex items-center justify-between gap-1 leading-none">
                <span className="min-w-0 truncate rounded bg-white/20 px-1.5 py-px text-[11px] font-bold uppercase tracking-wider">
                  🏛️ {t.hipodromo || ""}
                </span>
                <span className="whitespace-nowrap text-xs font-black leading-none">
                  🏁 C{t.carrera ?? ""}
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[9px] font-bold leading-none">
                <span className="rounded bg-white/20 px-1 py-px">📏 {t.distancia_carrera ?? ""} m</span>
                <span className="rounded bg-white/20 px-1 py-px uppercase">{t.superficie || "ARENA"}</span>
                <span className="rounded bg-white/20 px-1 py-px">📅 {t.fecha ?? ""}</span>
              </div>
              <div className="mt-0.5 flex items-center justify-between rounded bg-white/20 px-1.5 py-px leading-none">
                <span className="text-[8px] font-black uppercase tracking-wider opacity-90">💰 Monto a Pagar / Tabla</span>
                <span className="whitespace-nowrap text-sm font-black">{fmtMoney(t.premio_recalculado ?? null, t.moneda)}</span>
              </div>
            </div>

            {/* Subetiqueta ejemplares */}
            <div className="flex items-center justify-between px-1.5 pb-0.5 pt-1 text-[9px] font-black uppercase tracking-wider text-slate-400 leading-none">
              <span>🐴 Ejemplares</span>
              <span className="rounded-full bg-slate-100 px-1.5 text-[9px] font-black text-slate-600">{(t.caballos ?? []).length}</span>
            </div>

            {/* Ejemplares numerados */}
            <div className="max-h-40 flex-1 overflow-y-auto px-1 py-0.5">
              {(t.caballos ?? []).length === 0 && (
                <p className="px-2 py-2 text-sm italic text-slate-400">Sin ejemplares registrados.</p>
              )}
              {(t.caballos ?? []).map((c, i) => {
                const valor = parseNum(c.valor_ejemplar);
                return (
                  <div
                    key={i}
                    className={`grid items-center gap-1 rounded px-1 py-px ${c.retirado ? "opacity-50" : ""}`}
                    style={{ gridTemplateColumns: "2rem 1fr 1.25rem 3rem" }}
                  >
                    <span
                      className="w-5 rounded py-px text-center text-[10px] font-black"
                      style={{ backgroundColor: colorDeNumero(c.numero), color: textoDeNumero(c.numero) }}
                    >
                      {c.numero}
                    </span>
                    <span className="min-w-0 truncate text-[10px] font-bold uppercase text-slate-800">{c.nombre || "Sin nombre"}</span>
                    <span className="text-center text-[10px] leading-none">{FLAG(c.nacionalidad)}</span>
                    <span className={`whitespace-nowrap text-right text-[11px] font-black ${c.retirado ? "text-red-500 line-through" : "text-blue-700"}`}>
                      {c.retirado ? "RET." : fmtMoney(valor, t.moneda)}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Pie: suma */}
            <div className="flex items-center justify-between gap-2 border-t border-slate-100 bg-white px-1.5 py-0.5">
              <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-slate-400 leading-none">
                🧮 Suma de la Tabla
              </span>
              <span className="text-xs font-black text-indigo-700">
                {fmtMoney(t.suma_base_tabla ?? sumaBase(t.caballos), t.moneda)}
              </span>
            </div>

            {/* Acciones */}
            <div className="flex items-center gap-1.5 border-t border-slate-100 bg-white px-2 py-1.5 no-print">
              <Button variant="ghost" size="sm" className="flex-1" onClick={() => { setEditando(t); setPatchEdicion({}); }}>
                ✏️ Editar
              </Button>
              <Button size="sm" className="flex-1" onClick={() => { setVendiendo(t); setEjemplarVenta(""); setMontoVenta(""); }}>
                🎟️ Vender
              </Button>
              <Button variant="danger" size="sm" className="flex-1" onClick={() => setLiquidando(t)}>
                🏁 Liquidar
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* Sección de impresión (solo tablas Abiertas): oculta en pantalla, visible al imprimir */}
      <div className="hidden print:block print:bg-white print:px-2 print:py-2">
        <h1 className="mb-3 border-b-2 border-black pb-1 text-center text-base font-black uppercase text-black">
          Tablas Fijas Publicadas
        </h1>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-black">
          {abiertas.map((t) => (
            <div key={String(t.id)} className="break-inside-avoid border border-black px-2 py-1.5 text-[10px] leading-tight">
              <p className="font-black uppercase">{t.hipodromo} — Carrera {t.carrera}</p>
              <p className="mb-1 font-semibold">
                Monto a Pagar: {fmtMoney(t.premio_recalculado ?? null, t.moneda)} · Suma:{" "}
                {fmtMoney(t.suma_base_tabla ?? sumaBase(t.caballos), t.moneda)}
              </p>
              <table className="w-full text-[9px]">
                <tbody>
                  {(t.caballos ?? []).map((c, i) => (
                    <tr key={i}>
                      <td className="w-6 font-bold">{c.numero}</td>
                      <td className="font-semibold uppercase">{c.nombre}{c.retirado ? " (RET.)" : ""}</td>
                      <td className="w-8 text-right font-bold">{fmtMoney(parseNum(c.valor_ejemplar), t.moneda)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>

      {/* Modal Venta → al carrito */}
      {vendiendo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 no-print">
          <div className="w-full max-w-sm rounded-2xl border border-line bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-line bg-slate-800 px-4 py-3 text-white">
              <h3 className="text-xs font-black uppercase">🛒 Venta — {vendiendo.hipodromo} C{vendiendo.carrera}</h3>
              <button type="button" onClick={() => setVendiendo(null)} className="text-slate-300 hover:text-white">✕</button>
            </div>
            <div className="space-y-3 p-4">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-slate-500">Ejemplar</label>
                <select
                  value={ejemplarVenta}
                  onChange={(e) => setEjemplarVenta(e.target.value)}
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-bold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                  <option value="">— Seleccionar —</option>
                  {(vendiendo.caballos ?? []).map((c, i) => (
                    <option key={i} value={String(c.numero)}>Nº {c.numero} · {c.nombre}</option>
                  ))}
                  <option value="TABLA">Tabla completa</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-slate-500">Monto jugado</label>
                <input
                  value={montoVenta}
                  onChange={(e) => setMontoVenta(e.target.value)}
                  inputMode="decimal"
                  placeholder="0,00"
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-black text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                />
              </div>
              <div className="flex items-center justify-between rounded-lg bg-success-500/10 px-3 py-2 text-xs font-semibold text-slate-700">
                <span>Pago potencial +{PremioVenta(vendiendo, ejemplarVenta, montoVenta)}</span>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-line bg-gray-50 px-4 py-3">
              <Button variant="ghost" size="sm" onClick={() => setVendiendo(null)}>Cancelar</Button>
              <Button variant="success" size="md" onClick={lanzarVenta}>Agregar al carrito</Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Liquidación → 8 posiciones + Dead Heat */}
      {liquidando && (
        <CargaResultadosModal
          abierto
          onCerrar={() => setLiquidando(null)}
          hipodromo={liquidando.hipodromo ?? ""}
          carrera={String(liquidando.carrera ?? "")}
          caballos={liquidando.caballos}
          onConfirmar={(r) => {
            setLiquidando(null);
            onLiquidar?.(liquidando, r);
          }}
        />
      )}

      {/* Modal Edición */}
      {editando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 no-print">
          <div className="w-full max-w-sm rounded-2xl border border-line bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-line bg-slate-800 px-4 py-3 text-white">
              <h3 className="text-xs font-black uppercase">✏️ Editar — {editando.hipodromo} C{editando.carrera}</h3>
              <button type="button" onClick={() => setEditando(null)} className="text-slate-300 hover:text-white">✕</button>
            </div>
            <div className="space-y-3 p-4">
              {([
                ["premio_original", "Premio Original"],
                ["premio_recalculado", "Premio Recalculado"],
                ["suma_base_tabla", "Suma Base de la Tabla"],
                ["limite_ventas", "Límite de Ventas"],
              ] as const).map(([key, label]) => (
                <div key={key}>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-slate-500">{label}</label>
                  <input
                    value={String(patchEdicion[key] ?? editando[key] ?? "")}
                    onChange={(e) => setPatchEdicion((p) => ({ ...p, [key]: parseNum(e.target.value) }))}
                    inputMode="decimal"
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-black text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 border-t border-line bg-gray-50 px-4 py-3">
              <Button variant="ghost" size="sm" onClick={() => setEditando(null)}>Cancelar</Button>
              <Button size="md" onClick={guardarEdicion}>💾 Guardar</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PremioVenta(t: StoredTablaFija, numero: string, monto: string): string {
  const m = parseNum(monto);
  if (!m || !numero) return "—";
  const premio = t.premio_recalculado ?? 0;
  return fmtMoney(numero === "TABLA" ? premio * m : (premio / (t.suma_base_tabla ?? 1)) * m, t.moneda);
}

export default MonitorTablas;