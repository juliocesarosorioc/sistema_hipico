"use client";

import { useState } from "react";
import type { StoredTablaFija } from "@/store/useTablasFijasStore";
import { colorDeNumero, textoDeNumero, fmtMoney, sumaBase, parseNum } from "@/lib/tablas/tipos";
import { hoyLocal } from "@/lib/gaceta/programa";
import { Flag } from "@/components/ui/BanderaPais";
import { Button } from "@/components/ui/Button";
import { Guard } from "@/components/ui/Guard";
import { CargaResultadosModal, type PizarraResultados } from "@/components/liquidacion/CargaResultadosModal";
import { EjemplarModal, type VentaRapidaItem } from "@/components/tablas/EjemplarModal";

export type VentaTablaItem = {
  tablaId: string | number;
  numero: string;
  nombre: string;
  monto: number;
  cantidad?: number;
  grupo?: { id: string | number; nombre: string } | null;
  jugador?: { id: string | number; nombre: string; saldo_actual?: number } | null;
};

type Props = {
  tablas: StoredTablaFija[];
  onVender?: (item: VentaTablaItem) => void;
  onLiquidar?: (tabla: StoredTablaFija, r: PizarraResultados) => void;
  onEditar?: (tabla: StoredTablaFija, patch: Record<string, unknown>) => void;
  onRetirar?: (tabla: StoredTablaFija, indice: number, retirado: boolean) => Promise<boolean>;
  onEliminar?: (tabla: StoredTablaFija) => void;
};

/** Día del evento de una tabla: Normaliza DD/MM/YYYY o YYYY-MM-DD para que el filtro no falle. */
function diaDeLaTabla(t: StoredTablaFija): string {
  const raw = String(t.fecha || t.fecha_creacion || "").trim();
  if (!raw) return "";
  
  // Si ya viene en formato correcto (Ej: 2026-09-24)
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return raw.slice(0, 10);
  }
  
  // Si la IA lo guardó como formato latino (Ej: 24/09/2026 o 24-09-2026)
  const partes = raw.split(/[-/]/);
  if (partes.length === 3 && partes[0].length <= 2) {
    // Lo volteamos a YYYY-MM-DD para que coincida con el input type="date"
    return `${partes[2]}-${partes[1].padStart(2, '0')}-${partes[0].padStart(2, '0')}`;
  }
  
  return raw.slice(0, 10);
}

/**
 * Monitor de Tablas Publicadas — clon 1:1 de js/tablas.js (L823-857):
 * tarjeta con cabecera de color degradada diagonal (indigo→púrpura→fucsia),
 * chips de hipódromo/carrera/distancia/superficie/fecha, fila "Monto a Pagar /
 * Tabla", lista numerada de ejemplares y pie con suma.
 *  · Clic sobre un ejemplar → modal interactivo (Retirar/Rehabilitar + Venta
 *    Rápida al carrito con grupo → jugador → cantidad), clon de modalEjemplar.
 *  · "Vender" manda el item al Carrito flotante; "Liquidar" abre el modal de
 *    8 posiciones + Dead Heat y cierra la tabla; la vista de impresión es una
 *    matriz compacta (cero-scroll) que también se puede previsualizar.
 */
export function MonitorTablas({ tablas, onVender, onLiquidar, onEditar, onRetirar, onEliminar }: Props) {
  const [vendiendo, setVendiendo] = useState<StoredTablaFija | null>(null);
  const [ejemplarVenta, setEjemplarVenta] = useState("");
  const [montoVenta, setMontoVenta] = useState("");
  const [liquidando, setLiquidando] = useState<StoredTablaFija | null>(null);
  const [editando, setEditando] = useState<StoredTablaFija | null>(null);
  const [patchEdicion, setPatchEdicion] = useState<Record<string, unknown>>({});
  const [aviso, setAviso] = useState("");
  const [confirmarEliminar, setConfirmarEliminar] = useState<StoredTablaFija | null>(null);
  const [ejemplarModal, setEjemplarModal] = useState<{ tabla: StoredTablaFija; indice: number } | null>(null);
  const [vistaImpresion, setVistaImpresion] = useState(false);
  const [fechaFiltro, setFechaFiltro] = useState<string>(() => hoyLocal());

  const filtradas = fechaFiltro
    ? tablas.filter((t) => diaDeLaTabla(t) === fechaFiltro)
    : tablas;
  const abiertas = filtradas.filter((t) => !t.cerrada);

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

  const ventaRapida = (tabla: StoredTablaFija, item: VentaRapidaItem) => {
    onVender?.({
      tablaId: tabla.id,
      numero: item.numero,
      nombre: item.nombre,
      monto: item.cantidad,
      cantidad: item.cantidad,
      grupo: item.grupo,
      jugador: item.jugador,
    });
    setAviso("🛒 Venta rápida agregada al carrito.");
  };

  const cerrarEjemplarRetiro = async (tabla: StoredTablaFija, indice: number, retirado: boolean): Promise<boolean> => {
    if (!onRetirar) return true;
    const ok = await onRetirar(tabla, indice, retirado);
    if (ok) setAviso(retirado ? "✅ Ejemplar retirado (premio recalculado)." : "✅ Ejemplar rehabilitado.");
    return ok;
  };

  const ejemplarActual = ejemplarModal
    ? { tabla: ejemplarModal.tabla, ejemplar: (ejemplarModal.tabla.caballos ?? [])[ejemplarModal.indice] }
    : null;

  return (
    <div className="space-y-4">
      {aviso && <p className="rounded-lg bg-success-500/10 px-3 py-2 text-xs font-semibold text-success-700 no-print">{aviso}</p>}

      {/* Barra de vista de impresión + filtro por fecha */}
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          {abiertas.length} tabla(s) abierta(s){fechaFiltro ? ` el ${fechaFiltro}` : ""}. Haz clic en cualquier ejemplar para venderlo o retirarlo.
        </p>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 rounded-lg border border-line bg-white px-2 py-1" title="Filtrar tablas por fecha de la carrera">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">📅 Fecha</span>
            <input
              type="date"
              value={fechaFiltro}
              onChange={(e) => setFechaFiltro(e.target.value || "")}
              className="bg-transparent text-xs font-bold text-slate-900 focus:outline-none"
            />
            {fechaFiltro && (
              <button
                type="button"
                onClick={() => setFechaFiltro("")}
                title="Quitar filtro de fecha"
                className="text-[10px] font-black uppercase text-red-500 hover:text-red-600"
              >
                ✕
              </button>
            )}
          </label>
          <button
            type="button"
            onClick={() => setVistaImpresion((v) => !v)}
            className="rounded-lg border border-line bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-slate-600 transition-colors hover:bg-surface"
          >
            🖨️ {vistaImpresion ? "Salir de vista de impresión" : "Vista de impresión"}
          </button>
        </div>
      </div>

      {/* Vista en pantalla (matriz compacta si vistaImpresion está activa) */}
      {vistaImpresion ? (
        <MatrizImpresion tablas={abiertas} />
      ) : (
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
                  <span className="flex items-center gap-1 whitespace-nowrap">
                    <span className="inline-flex items-center rounded-md border-4 border-white bg-indigo-900 px-4 py-2 text-xl font-black uppercase leading-none tracking-widest text-white shadow-lg md:text-2xl transform scale-110">
                    C{t.carrera ?? ""}
                  </span>
                    {onEliminar && (
                      <Guard permiso="eliminar_tabla">
                        <button
                          type="button"
                          onClick={() => setConfirmarEliminar(t)}
                          title="Eliminar tabla (solo la oferta de venta; preserva la carrera y el Padrón)"
                          className="rounded bg-red-600/70 px-1 py-0.5 text-[9px] font-black uppercase leading-none text-white transition-colors hover:bg-red-700"
                        >
                          🗑️
                        </button>
                      </Guard>
                    )}
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

              {/* Ejemplares numerados (clic → modal EJEMPLAR) — altura dinámica, sin scroll */}
              <div className="px-1 py-0.5">
                {(t.caballos ?? []).length === 0 && (
                  <p className="px-2 py-2 text-sm italic text-slate-400">Sin ejemplares registrados.</p>
                )}
                {(t.caballos ?? []).map((c, i) => {
                  const valor = parseNum(c.valor_ejemplar);
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setEjemplarModal({ tabla: t, indice: i })}
                      title={`N° ${c.numero} ${c.nombre} — clic para vender/retirar`}
                      className={`grid w-full items-center gap-1 rounded px-1 py-px text-left transition-colors hover:bg-indigo-50 ${c.retirado ? "opacity-50" : ""} cursor-pointer`}
                      style={{ gridTemplateColumns: "2rem 1fr 1.25rem 3rem" }}
                    >
                      <span
                        className="flex h-7 w-7 shrink-0 flex-none items-center justify-center rounded text-center text-[10px] font-bold"
                        style={{ backgroundColor: colorDeNumero(c.numero), color: textoDeNumero(c.numero) }}
                      >
                        {c.numero}
                      </span>
                      <span className="min-w-0 truncate text-[10px] font-bold uppercase text-slate-800">{c.nombre || "Sin nombre"}</span>
                      <span className="flex justify-center text-center leading-none"><Flag nac={c.nacionalidad} size={12} withName={false} /></span>
                      <span className={`whitespace-nowrap text-right text-[11px] font-black ${c.retirado ? "text-red-500 line-through" : "text-blue-700"}`}>
                        {c.retirado ? "RET." : fmtMoney(valor, t.moneda)}
                      </span>
                    </button>
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
                <Guard permiso="editar_tabla">
                  <Button variant="ghost" size="sm" className="flex-1" onClick={() => { setEditando(t); setPatchEdicion({}); }}>
                    ✏️ Editar
                  </Button>
                </Guard>
                <Guard permiso="vender_tabla">
                  <Button size="sm" className="flex-1" onClick={() => { setVendiendo(t); setEjemplarVenta(""); setMontoVenta(""); }}>
                    🎟️ Vender
                  </Button>
                </Guard>
                <Guard permiso="liquidar_carrera">
                  <Button variant="danger" size="sm" className="flex-1" onClick={() => setLiquidando(t)}>
                    🏁 Liquidar
                  </Button>
                </Guard>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Sección de impresión: matriz compacta (cero-scroll) — siempre al imprimir */}
      <div className="hidden print:block print:bg-white print:px-2 print:py-2">
        <h1 className="mb-3 border-b-2 border-black pb-1 text-center text-base font-black uppercase text-black">
          Tablas Fijas Publicadas
        </h1>
        <MatrizImpresion tablas={abiertas} />
      </div>

      {/* Modal Confirmación Eliminar tabla */}
      {confirmarEliminar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 no-print">
          <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-line bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-red-200 bg-red-50 px-4 py-3">
              <h3 className="text-xs font-black uppercase text-red-700">🗑️ Eliminar tabla</h3>
              <button type="button" onClick={() => setConfirmarEliminar(null)} className="text-red-400 hover:text-red-600">✕</button>
            </div>
            <div className="space-y-2 p-4">
              <p className="text-sm font-bold text-slate-800">
                ¿Eliminar la oferta de venta de {confirmarEliminar.hipodromo} — Carrera {confirmarEliminar.carrera}?
              </p>
              <p className="text-xs leading-relaxed text-slate-500">
                Se borrará ÚNICAMENTE el registro de la tabla fija (la oferta de venta). La carrera y los ejemplares
                del Padrón se conservan para que la Taquilla siga operando (resultados, pizarras, cobros y pagos).
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-line bg-gray-50 px-4 py-3">
              <Button variant="ghost" size="sm" onClick={() => setConfirmarEliminar(null)}>Cancelar</Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  const t = confirmarEliminar;
                  setConfirmarEliminar(null);
                  onEliminar?.(t);
                }}
              >
                🗑️ Eliminar
              </Button>
            </div>
          </div>
        </div>
      )}

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

      {/* Modal EJEMPLAR (clic sobre un ejemplar): retirar/rehabilitar + venta rápida */}
      {ejemplarModal && ejemplarActual && (
        <EjemplarModal
          abierto
          tabla={ejemplarActual.tabla}
          ejemplar={ejemplarActual.ejemplar}
          indice={ejemplarModal.indice}
          onCerrar={() => setEjemplarModal(null)}
          onRetirar={cerrarEjemplarRetiro}
          onVentaRapida={ventaRapida}
        />
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

// ============================================================================
// LÓGICA LEGACY RESTAURADA: Auto-ajuste de fuente para evitar desconfiguración
// ============================================================================
const MAX_N = 20, FS_BASE = 8.6, FS_MIN = 7.4, FS_MAX = 13.5;

function fsAuto(n: number) {
  const num = Math.min(Math.max(n || 1, 1), MAX_N);
  const p = (FS_BASE * MAX_N) / num;
  return Math.round(Math.min(FS_MAX, Math.max(FS_MIN, p)) * 10) / 10;
}

// ============================================================================
// LÓGICA LEGACY ESTRICTA: Motor original de Auto-ajuste de fuente y CSS nativo
// ============================================================================
const MAX_N = 20, FS_BASE = 8.6, FS_MIN = 7.4, FS_MAX = 13.5;

function fsAuto(n: number) {
  const num = Math.min(Math.max(n || 1, 1), MAX_N);
  const p = (FS_BASE * MAX_N) / num;
  return Math.floor(Math.min(FS_MAX, Math.max(FS_MIN, p)) * 10) / 10;
}

/** Matriz compacta: Replica exacta del HTML legacy para html2canvas */
function MatrizImpresion({ tablas }: { tablas: StoredTablaFija[] }) {
  if (tablas.length === 0) {
    return <p className="py-6 text-center text-sm italic text-slate-400">No hay tablas abiertas para imprimir.</p>;
  }

  return (
    <div className="legacy-impresion-container p-2">
      {/* INYECTAMOS TU CSS ORIGINAL PARA EVITAR INTERFERENCIA DE TAILWIND */}
      <style dangerouslySetInnerHTML={{ __html: `
        .legacy-impresion-container { font-family: system-ui, Arial, sans-serif; color: #0f172a; }
        .hoja-legacy { display: grid; grid-template-columns: repeat(1, 1fr); gap: 9px; }
        @media (min-width: 700px) { .hoja-legacy { grid-template-columns: repeat(2, 1fr); } }
        @media (min-width: 1100px) { .hoja-legacy { grid-template-columns: repeat(3, 1fr); } }
        @media print {
          .hoja-legacy { display: grid !important; grid-template-columns: repeat(5, 1fr) !important; gap: 2.2mm !important; }
          .tarjeta-legacy { break-inside: avoid; border-radius: 4px; }
        }
        .tarjeta-legacy { background: #fff; border: 1px solid #cbd5e1; border-radius: 10px; overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 1px 2px rgba(0,0,0,.04); }
        .enc-legacy { background: #0f172a; color: #fff; padding: 6px 8px; }
        .l1-legacy { display: flex; align-items: center; gap: 6px; justify-content: space-between; }
        .hip-legacy { font-size: 10px; font-weight: 800; letter-spacing: .4px; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 1; }
        .cc-legacy { background: rgba(255,255,255,.16); border-radius: 6px; font-size: 10px; font-weight: 900; padding: 1px 7px; white-space: nowrap; flex: none; }
        .l2-legacy { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-top: 3px; font-size: 8.5px; font-weight: 700; color: #cbd5e1; }
        .meta-legacy { display: flex; align-items: center; gap: 4px; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
        .fecha-legacy { margin-left: auto; white-space: nowrap; font-weight: 800; color: #7dd3fc; }
        .filas-legacy { flex: 1; display: flex; flex-direction: column; justify-content: space-evenly; padding: 5px 7px; min-height: 0; }
        .fila-legacy { display: flex; align-items: center; gap: 6px; line-height: 1.1; min-height: 0; margin: 1.5px 0; }
        .num-legacy { width: 1.4em; height: 1.4em; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 0.95em; flex: none; line-height: 1; }
        .cab-legacy { flex: 1; font-weight: 700; color: #334155; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 4px; }
        .cab-legacy.ret-legacy { color: #dc2626; text-decoration: line-through; }
        .mon-legacy { font-weight: 800; color: #475569; white-space: nowrap; font-size: 0.95em; }
        .mon-legacy.cero-legacy { color: #94a3b8; }
        .pie-legacy { display: flex; justify-content: space-between; align-items: center; gap: 6px; border-top: 1px solid #e2e8f0; background: #f8fafc; padding: 5px 8px; font-size: 8.5px; font-weight: 700; color: #475569; white-space: nowrap; }
        .pie-legacy b { color: #047857; font-size: 10px; }
      `}} />

      <div className="hoja-legacy">
        {tablas.map((t) => {
          const ejemplares = t.caballos ?? [];
          const numEjemplares = ejemplares.length || 1;
          const fs = fsAuto(numEjemplares);
          const suma = t.suma_base_tabla ?? sumaBase(t.caballos);

          return (
            <div key={String(t.id)} className="tarjeta-legacy">
              
              <div className="enc-legacy">
                <div className="l1-legacy">
                  <span className="hip-legacy" title={t.hipodromo}>{t.hipodromo}</span>
                  <span className="cc-legacy">C{t.carrera}</span>
                </div>
                <div className="l2-legacy">
                  <span className="meta-legacy"><b>DIST {t.distancia_carrera ?? ""} m</b> &middot; {t.superficie || "ARENA"}</span>
                  <span className="fecha-legacy">{t.fecha?.slice(0, 10) ?? ""}</span>
                </div>
              </div>

              <div className="filas-legacy" style={{ fontSize: `${fs}px` }}>
                {ejemplares.length === 0 && (
                  <div style={{ textAlign: "center", color: "#dc2626", fontWeight: "bold", padding: "10px 0" }}>⚠️ SIN APUESTAS</div>
                )}
                
                {ejemplares.map((c, i) => {
                  let nac = c.nacionalidad ? String(c.nacionalidad).toUpperCase() : "";
                  if (!nac) {
                    const esAmericano = /PARK|DOWNS|AQUEDUCT|SARATOGA|TAMPA|MEADOWS|WOODBINE|GOLDEN|SANTA ANITA|DEL MAR|OAKLAWN/i.test(t.hipodromo || "");
                    nac = esAmericano ? "US" : "VE";
                  }
                  const valor = parseNum(c.valor_ejemplar);

                  return (
                    <div key={i} className="fila-legacy">
                      <span 
                        className="num-legacy" 
                        style={{ backgroundColor: colorDeNumero(c.numero), color: textoDeNumero(c.numero) }}
                      >
                        {c.numero}
                      </span>
                      <span className={`cab-legacy ${c.retirado ? 'ret-legacy' : ''}`} title={c.nombre}>
                        {nac !== "VE" && (
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <Flag nac={nac} size={12} withName={false} />
                          </div>
                        )}
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.nombre}</span>
                      </span>
                      <span className={`mon-legacy ${valor === 0 ? 'cero-legacy' : ''}`}>
                        {valor === 0 ? "–" : `US $ ${fmtMoney(valor, "")}`}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="pie-legacy">
                <span>Σ SUMA <b>US $ {fmtMoney(suma, "")}</b></span>
                <span>PREMIO/TABLA <b>US $ {fmtMoney(t.premio_recalculado ?? 0, "")}</b></span>
              </div>

            </div>
          );
        })}
      </div>
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