"use client";

import { useEffect, useState } from "react";
import type { StoredTablaFija } from "@/store/useTablasFijasStore";
import { colorDeNumero, textoDeNumero, fmtMoney, parseNum, FLAG, type EjemplarTabla } from "@/lib/tablas/tipos";
import { listarGruposVenta, jugadoresDeGrupo, type GrupoVenta, type ClienteVenta } from "@/lib/grupos";
import { Button } from "@/components/ui/Button";

export type VentaRapidaItem = {
  numero: string;
  nombre: string;
  cantidad: number;
  grupo?: { id: string | number; nombre: string } | null;
  jugador?: { id: string | number; nombre: string; saldo_actual?: number } | null;
};

type Props = {
  abierto: boolean;
  tabla: StoredTablaFija | null;
  ejemplar?: EjemplarTabla | null;
  indice?: number;
  onCerrar: () => void;
  onRetirar?: (tabla: StoredTablaFija, indice: number, retirado: boolean) => Promise<boolean>;
  onVentaRapida?: (tabla: StoredTablaFija, item: VentaRapidaItem) => void;
};

/**
 * Modal del EJEMPLAR — clon de js/tablas.js L1092+ (modalEjemplar):
 * cabecera índigo, badge del estado (Activo/Retirado), valor por tabla,
 * RETIRAR/REHABILITAR con recálculo proporcional y Venta Rápida al carrito
 * (GRUPO DE VENTA → JUGADOR DE ESE GRUPO → CANTIDAD DE TABLAS).
 */
export function EjemplarModal({ abierto, tabla, ejemplar, indice = 0, onCerrar, onRetirar, onVentaRapida }: Props) {
  const [grupos, setGrupos] = useState<GrupoVenta[]>([]);
  const [grupoId, setGrupoId] = useState("");
  const [jugadores, setJugadores] = useState<ClienteVenta[]>([]);
  const [jugadorId, setJugadorId] = useState("");
  const [cantidad, setCantidad] = useState("1");
  const [trabajando, setTrabajando] = useState(false);
  const [aviso, setAviso] = useState("");

  useEffect(() => {
    if (!abierto) return;
    setGrupos([]);
    setGrupoId("");
    setJugadores([]);
    setJugadorId("");
    setCantidad("1");
    setAviso("");
    void listarGruposVenta().then((gs) => setGrupos(gs));
  }, [abierto, tabla, ejemplar]);

  if (!abierto || !tabla || !ejemplar) return null;

  const retirado = Boolean(ejemplar.retirado);
  const valor = parseNum(ejemplar.valor_ejemplar);
  const num = String(ejemplar.numero ?? "");

  const seleccionarGrupo = (gid: string) => {
    setGrupoId(gid);
    setJugadorId("");
    if (!gid) return setJugadores([]);
    void jugadoresDeGrupo(gid).then((js) => setJugadores(js));
  };

  const retirar = async () => {
    if (trabajando) return;
    const accion = retirado ? "Rehabilitar" : "Retirar";
    const okConfirm = window.confirm(
      `${accion} el ejemplar N°${num} ${ejemplar.nombre ?? ""}?\n\n${
        retirado
          ? "Se restaurará como activo y se recalculará el premio."
          : "Se marcará como RETIRADO:\n - No podrá venderse\n - Se recalculará el premio (baja proporcional)\n - Se reembolsará el saldo de los tickets pendientes"
      }\n\n¿Continuar?`
    );
    if (!okConfirm) return;
    setTrabajando(true);
    setAviso("");
    const ok = onRetirar ? await onRetirar(tabla, indice, !retirado) : true;
    setTrabajando(false);
    if (ok) {
      setAviso(retirado ? "✅ Ejemplar rehabilitado." : "✅ Ejemplar retirado.");
      onCerrar();
    } else {
      setAviso("No se pudo aplicar el cambio. Reintente.");
    }
  };

  const enviarCarrito = () => {
    const cant = Number.parseInt(cantidad, 10) || 1;
    if (!grupoId) return setAviso("Seleccione el grupo de venta.");
    if (!jugadorId) return setAviso("Seleccione el jugador que compra.");
    if (cant <= 0) return setAviso("Cantidad inválida.");
    const grupo = grupos.find((g) => String(g.id) === String(grupoId));
    const jugador = jugadores.find((j) => String(j.id) === String(jugadorId));
    if (!jugador) return setAviso("Jugador no encontrado.");
    onVentaRapida?.(tabla, {
      numero: num,
      nombre: String(ejemplar.nombre ?? "TABLA COMPLETA"),
      cantidad: cant,
      grupo: grupo ? { id: grupo.id, nombre: grupo.nombre } : null,
      jugador: { id: jugador.id, nombre: jugador.nombre, saldo_actual: jugador.saldo_actual ?? undefined },
    });
    setAviso("");
    onCerrar();
  };

  const puedeVender = !tabla.cerrada && tabla.estado === "Abierta" && !retirado;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 no-print">
      <div className="flex max-h-[94vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Cabecera índigo (legacy L1105) */}
        <div className="flex shrink-0 items-center justify-between bg-indigo-600 px-4 py-3 text-sm font-bold uppercase tracking-wide text-white">
          <span>🐎 Ejemplar</span>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="text-indigo-200 hover:text-white">
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {aviso && (
            <p className="rounded-lg bg-warning-500/10 px-3 py-2 text-xs font-semibold text-warning-700">{aviso}</p>
          )}

          {/* Identidad del ejemplar */}
          <div className="flex items-center gap-3">
            <span
              className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border-2 text-xl font-black"
              style={{ backgroundColor: colorDeNumero(num), color: textoDeNumero(num), borderColor: colorDeNumero(num) }}
            >
              {num}
            </span>
            <div className="min-w-0 flex-1">
              <span className="block truncate text-base font-black uppercase text-slate-800">{ejemplar.nombre || "Sin nombre"}</span>
              <span className="block text-xs font-bold text-slate-500">
                {FLAG(ejemplar.nacionalidad)} N° {num || "‑"}
              </span>
            </div>
            <span
              className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-black uppercase ${
                retirado ? "bg-red-100 text-red-600" : "bg-emerald-100 text-emerald-700"
              }`}
            >
              {retirado ? "Retirado" : "Activo"}
            </span>
          </div>

          {/* Valor por tabla */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <span className="block text-[10px] font-black uppercase tracking-wider text-slate-400">Valor por Tabla</span>
            <span className={`block text-lg font-black ${retirado ? "text-red-500 line-through" : "text-blue-700"}`}>
              {retirado ? "RET." : fmtMoney(valor, tabla.moneda)}
            </span>
          </div>

          {/* Retirar / Rehabilitar */}
          <button
            type="button"
            onClick={() => void retirar()}
            disabled={trabajando}
            className={`w-full rounded-xl py-2.5 text-xs font-black uppercase text-white shadow-sm transition-colors ${
              retirado ? "bg-amber-500 hover:bg-amber-600" : "bg-red-600 hover:bg-red-700"
            }`}
          >
            {trabajando ? "Procesando…" : retirado ? "↩ Rehabilitar ejemplar" : "⛔ Retirar ejemplar"}
          </button>

          {/* Venta rápida */}
          <div className="border-t border-slate-100 pt-3">
            <span className="mb-2 block text-xs font-black uppercase tracking-wider text-slate-500">
              💵 Venta rápida (al carrito)
            </span>
            {puedeVender ? (
              <div className="space-y-2">
                <div>
                  <label className="mb-0.5 block text-[10px] font-bold uppercase text-slate-500">Grupo de venta</label>
                  <select
                    value={grupoId}
                    onChange={(e) => seleccionarGrupo(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">Seleccione el grupo…</option>
                    {grupos.map((g) => (
                      <option key={String(g.id)} value={String(g.id)}>
                        {g.nombre} ({g.moneda ?? "USD"})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-0.5 block text-[10px] font-bold uppercase text-slate-500">Jugador de ese grupo</label>
                  <select
                    value={jugadorId}
                    onChange={(e) => setJugadorId(e.target.value)}
                    disabled={!grupoId}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-slate-50 disabled:text-slate-400"
                  >
                    <option value="">{grupoId ? "Seleccione el jugador…" : "Primero el grupo"}</option>
                    {jugadores.map((j) => {
                      const saldo = j.saldo_actual ?? 0;
                      return (
                        <option key={String(j.id)} value={String(j.id)}>
                          {j.nombre} · Saldo ${saldo.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div>
                  <label className="mb-0.5 block text-[10px] font-bold uppercase text-slate-500">Cantidad de Tablas</label>
                  <input
                    type="number"
                    min={1}
                    value={cantidad}
                    onChange={(e) => setCantidad(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-center text-sm font-bold text-slate-900 outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <p className="text-[10px] font-semibold text-slate-500">
                  Total a cargar: <b className="text-emerald-700">{fmtMoney(valor * (Number.parseInt(cantidad, 10) || 1), tabla.moneda)}</b>
                </p>
              </div>
            ) : (
              <p className="text-xs italic text-slate-400">
                {retirado
                  ? "Ejemplar retirado: no puede venderse."
                  : "Tabla no disponible para venta (estado " + (tabla.estado || "?") + ")."}
              </p>
            )}
          </div>
        </div>

        {/* Pie */}
        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3">
          <button
            type="button"
            onClick={onCerrar}
            className="rounded-xl bg-slate-300 px-5 py-2.5 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-400"
          >
            Cancelar
          </button>
          <Button variant="success" size="md" disabled={!puedeVender} onClick={enviarCarrito}>
            🛒 Enviar al carrito
          </Button>
        </div>
      </div>
    </div>
  );
}

export default EjemplarModal;