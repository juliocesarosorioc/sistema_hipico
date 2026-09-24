"use client";

import { useMemo, useState } from "react";
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
 * Monitor de Tablas Publicadas (clon 1:1 de js/tablas.js).
 * Tarjeta por carrera con cabecera degradada, pestañas de datos, lista de
 * ejemplares y acciones: Editar / Vender / Liquidar. La sección de impresión
 * va en `hidden print:block` (15 tablas/hoja del legacy).
 */
export function MonitorTablas({ tablas, onVender, onLiquidar, onEditar }: Props) {
  const [vendiendo, setVendiendo] = useState<StoredTablaFija | null>(null);
  const [ejemplarVenta, setEjemplarVenta] = useState("");
  const [montoVenta, setMontoVenta] = useState("");
  const [liquidando, setLiquidando] = useState<StoredTablaFija | null>(null);
  const [editando, setEditando] = useState<StoredTablaFija | null>(null);
  const [patchEdicion, setPatchEdicion] = useState<Record<string, unknown>>({});
  const [aviso, setAviso] = useState("");

  const abiertas = useMemo(() => tablas.filter((t) => !t.cerrada), [tablas]);
  const cerradas = tablas.length - abiertas.length;

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
    setAviso("✅ Jugada enviada a la taquilla.");
  };

  const guardarEdicion = () => {
    if (editando) onEditar?.(editando, patchEdicion);
    setEditando(null);
    setPatchEdicion({});
    setAviso("✅ Tabla actualizada.");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 no-print">
        <div>
          <h2 className="text-base font-black uppercase text-slate-900">📊 Monitor de Tablas Publicadas</h2>
          <p className="text-xs text-slate-500">
            {abiertas.length} abiertas · {cerradas} cerradas · sincronizado con Supabase.
          </p>
        </div>
        <Button size="sm" onClick={() => window.print()}>🖨️ Imprimir Tablas</Button>
      </div>

      {aviso && <p className="rounded-lg bg-success-500/10 px-3 py-2 text-xs font-semibold text-success-700 no-print">{aviso}</p>}

      {/* Vista en pantalla */}
      <div className="grid gap-4 print:hidden xl:grid-cols-2">
        {abiertas.length === 0 && (
          <div className="col-span-full rounded-2xl border border-dashed border-line bg-surface p-10 text-center">
            <p className="text-sm font-semibold text-slate-500">No hay tablas publicadas abiertas.</p>
            <p className="mt-1 text-xs text-slate-400">Usa la pestaña “Ensamblaje” para publicar una tabla fija.</p>
          </div>
        )}
        {abiertas.map((t) => (
          <div key={String(t.id)} className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
            <div className="flex items-center justify-between bg-gradient-to-r from-indigo-600 via-purple-600 to-fuchsia-600 px-4 py-3 text-white">
              <div>
                <h3 className="text-sm font-black uppercase leading-tight">{t.hipodromo}</h3>
                <p className="text-[10px] font-semibold uppercase tracking-widest opacity-80">
                  Carrera {t.carrera} · {t.fecha}
                </p>
              </div>
              <div className="text-right">
                <span className="rounded-full bg-green-400/20 px-2.5 py-0.5 text-[10px] font-black uppercase">Abierta</span>
                <p className="mt-1 text-[10px] font-semibold opacity-80">
                  {t.distancia_carrera ?? "—"}m · {t.superficie ?? "—"}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 divide-x divide-line border-b border-line bg-gray-50 text-center">
              <div className="px-2 py-2">
                <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Monto a Pagar / Tabla</p>
                <p className="text-sm font-black text-slate-900">{fmtMoney(t.premio_recalculado ?? null, t.moneda)}</p>
              </div>
              <div className="px-2 py-2">
                <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Suma de la Tabla</p>
                <p className="text-sm font-black text-slate-900">{fmtMoney(t.suma_base_tabla ?? sumaBase(t.caballos), t.moneda)}</p>
              </div>
              <div className="px-2 py-2">
                <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Ventas / Límite</p>
                <p className="text-sm font-black text-slate-900">
                  {fmtMoney(t.cantidad_vendida ?? 0, t.moneda)} / {fmtMoney(t.limite_ventas ?? 0, t.moneda)}
                </p>
              </div>
            </div>

            <div className="max-h-56 overflow-y-auto px-2 py-1.5">
              <table className="w-full text-xs">
                <tbody className="divide-y divide-line/60">
                  {(t.caballos ?? []).map((c, i) => (
                    <tr key={i} className={c.retirado ? "opacity-50" : ""}>
                      <td className="w-9 py-1 pr-2">
                        <span
                          className="grid h-6 w-8 place-items-center rounded text-[10px] font-black"
                          style={{ backgroundColor: colorDeNumero(c.numero), color: textoDeNumero(c.numero) }}
                        >
                          {c.numero}
                        </span>
                      </td>
                      <td className="py-1 pr-2 font-bold uppercase text-slate-800">
                        {c.nombre}
                        {c.retirado && <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[9px] font-black text-red-600">RET.</span>}
                      </td>
                      <td className="w-10 py-1 pr-2 text-center">{FLAG(c.nacionalidad)}</td>
                      <td className="w-20 py-1 pr-2 text-right font-black text-slate-900">
                        {c.retirado ? <span className="text-red-500 line-through">{fmtMoney(parseNum(c.valor_ejemplar), t.moneda)}</span> : fmtMoney(parseNum(c.valor_ejemplar), t.moneda)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-line bg-gray-50 px-3 py-2.5">
              <p className="text-[10px] font-semibold text-slate-500">
                {t.retirados_oficiales ? `Retirados: ${t.retirados_oficiales}` : "Sin retirados oficiales"}
              </p>
              <div className="flex flex-wrap items-center gap-1.5 no-print">
                <Button variant="ghost" size="sm" onClick={() => { setEditando(t); setPatchEdicion({}); }}>✏️ Editar</Button>
                <Button size="sm" onClick={() => { setVendiendo(t); setEjemplarVenta(""); setMontoVenta(""); }}>🎟️ Vender</Button>
                <Button variant="danger" size="sm" onClick={() => setLiquidando(t)}>🏁 Liquidar</Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Sección de impresión: se oculta en pantalla, se muestra al imprimir */}
      <div className="hidden print:block print:bg-white print:px-2 print:py-2">
        <h1 className="mb-3 border-b-2 border-black pb-1 text-center text-base font-black uppercase text-black">
          Tablas Fijas Publicadas
        </h1>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-black">
          {tablas.map((t) => (
            <div key={String(t.id)} className="break-inside-avoid border border-black px-2 py-1.5 text-[10px] leading-tight">
              <p className="font-black uppercase">{t.hipodromo} — Carrera {t.carrera}</p>
              <p className="mb-1 font-semibold">
                Monto a Pagar: {fmtMoney(t.premio_recalculado ?? null, t.moneda)} · Suma:{" "}
                {fmtMoney(t.suma_base_tabla ?? sumaBase(t.caballos), t.moneda)} · Estado: {t.estado}
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

      {/* Modal Venta */}
      {vendiendo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 no-print">
          <div className="w-full max-w-sm rounded-2xl border border-line bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-line bg-slate-800 px-4 py-3 text-white">
              <h3 className="text-xs font-black uppercase">🎟️ Venta — {vendiendo.hipodromo} C{vendiendo.carrera}</h3>
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
              <Button variant="success" size="md" onClick={lanzarVenta}>Enviar a la taquilla</Button>
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