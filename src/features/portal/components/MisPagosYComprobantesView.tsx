"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/shared/components/ui/Button";
import {
  listarPagosCliente,
  type PagoComprobanteRow,
} from "@/features/contabilidad/lib/pagos-comprobantes";
import { formatearMontoSinMoneda } from "@/shared/lib/dinero";

interface MisPagosYComprobantesViewProps {
  cliente: {
    id: string | number;
    nombre?: string | null;
    saldo_actual?: number | string | null;
    saldo?: number | string | null;
    grupo_id?: string | number | null;
  };
  onAbrirReportarPago: () => void;
}

export function MisPagosYComprobantesView({
  cliente,
  onAbrirReportarPago,
}: MisPagosYComprobantesViewProps) {
  const [pagos, setPagos] = useState<PagoComprobanteRow[]>([]);
  const [cargando, setCargando] = useState(true);
  const [filtroEnviados, setFiltroEnviados] = useState<"todos" | "PENDIENTE" | "APROBADO" | "RECHAZADO">("todos");
  const [comprobanteZoom, setComprobanteZoom] = useState<string | null>(null);

  const saldo = Number(cliente.saldo_actual ?? cliente.saldo ?? 0);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await listarPagosCliente(String(cliente.id));
      setPagos(res);
    } finally {
      setCargando(false);
    }
  }, [cliente.id]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Separación en dos sub-bloques
  const pagosEnviados = pagos.filter((p) => p.direccion_flujo === "PAGO_DE_CLIENTE");
  const pagosRecibidos = pagos.filter((p) => p.direccion_flujo === "PAGO_A_GANADOR");

  const pagosEnviadosFiltrados = pagosEnviados.filter((p) => {
    if (filtroEnviados === "todos") return true;
    return p.estado === filtroEnviados;
  });

  return (
    <div className="space-y-6">
      {/* Banner Principal con Botón Destacado */}
      <div className="rounded-2xl border border-indigo-200 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-6 text-white shadow-xl flex flex-col md:flex-row items-center justify-between gap-4">
        <div>
          <span className="text-[10px] font-black uppercase tracking-widest text-indigo-300">
            Módulo de Pagos y Comprobantes
          </span>
          <h2 className="text-xl font-black tracking-tight text-white mt-0.5">
            🧾 Mis Pagos y Comprobantes de Premios
          </h2>
          <p className="text-xs text-slate-300 mt-1">
            Consulta el estado de tus abonos y descarga los comprobantes de premios pagados por la casa.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-slate-300">Tu Saldo Contable:</span>
            <span
              className={`font-mono text-sm font-black px-2.5 py-0.5 rounded-lg border ${
                saldo < 0
                  ? "bg-rose-500/20 text-rose-300 border-rose-500/30"
                  : saldo > 0
                  ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                  : "bg-slate-700 text-slate-300 border-slate-600"
              }`}
            >
              {saldo > 0 ? "+" : ""}
              {formatearMontoSinMoneda(saldo)}
            </span>
          </div>
        </div>

        <Button
          variant="primary"
          onClick={onAbrirReportarPago}
          className="bg-emerald-600 hover:bg-emerald-500 text-white font-black text-sm px-5 py-3 rounded-xl shadow-lg flex items-center gap-2 shrink-0 transition-transform hover:scale-105"
        >
          <span>💳</span>
          <span>Reportar Pago / Subir Comprobante</span>
        </Button>
      </div>

      {/* Sub-bloque A: Pagos Enviados por Mí */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">📤</span>
            <div>
              <h3 className="text-sm font-black text-slate-900">
                Pagos Enviados por Mí ({pagosEnviados.length})
              </h3>
              <p className="text-[11px] text-slate-500">
                Depósitos y abonos reportados para recargar saldo o pagar deuda
              </p>
            </div>
          </div>

          {/* Filtros de estado */}
          <div className="flex items-center gap-1 text-[11px] font-bold">
            <button
              type="button"
              onClick={() => setFiltroEnviados("todos")}
              className={`rounded-lg px-2.5 py-1 transition ${
                filtroEnviados === "todos"
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              Todos ({pagosEnviados.length})
            </button>
            <button
              type="button"
              onClick={() => setFiltroEnviados("PENDIENTE")}
              className={`rounded-lg px-2.5 py-1 transition ${
                filtroEnviados === "PENDIENTE"
                  ? "bg-amber-600 text-white"
                  : "bg-amber-50 text-amber-700 hover:bg-amber-100"
              }`}
            >
              ⏳ En Revisión
            </button>
            <button
              type="button"
              onClick={() => setFiltroEnviados("APROBADO")}
              className={`rounded-lg px-2.5 py-1 transition ${
                filtroEnviados === "APROBADO"
                  ? "bg-emerald-600 text-white"
                  : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
              }`}
            >
              ✅ Aprobados
            </button>
            <button
              type="button"
              onClick={() => setFiltroEnviados("RECHAZADO")}
              className={`rounded-lg px-2.5 py-1 transition ${
                filtroEnviados === "RECHAZADO"
                  ? "bg-rose-600 text-white"
                  : "bg-rose-50 text-rose-700 hover:bg-rose-100"
              }`}
            >
              ❌ Rechazados
            </button>
          </div>
        </div>

        {cargando ? (
          <div className="p-8 text-center text-xs text-slate-400">Cargando tus pagos...</div>
        ) : pagosEnviadosFiltrados.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-slate-500 text-xs">
            No tienes pagos en esta categoría. Puedes reportar uno nuevo con el botón superior.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[10px] font-black uppercase text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-3">Fecha</th>
                  <th className="py-2.5 px-3">Método / Banco</th>
                  <th className="py-2.5 px-3 font-mono">Referencia</th>
                  <th className="py-2.5 px-3 text-right">Monto Pagado</th>
                  <th className="py-2.5 px-3 text-right">Abono Equivalente</th>
                  <th className="py-2.5 px-3 text-center">Estado</th>
                  <th className="py-2.5 px-3 text-center">Comprobante</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pagosEnviadosFiltrados.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-3 text-slate-500 whitespace-nowrap text-[11px]">
                      {new Date(p.created_at).toLocaleDateString("es-VE")}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="font-bold text-slate-800">{p.metodo_pago}</span>
                      {p.banco_origen && (
                        <span className="block text-[10px] text-slate-500">{p.banco_origen}</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 font-mono font-bold text-slate-700">
                      #{p.referencia_bancaria}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                      {formatearMontoSinMoneda(p.monto_moneda_origen)} {p.moneda_origen}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-black text-emerald-700">
                      +{formatearMontoSinMoneda(p.monto_equivalente_base)}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-black ${
                          p.estado === "APROBADO"
                            ? "bg-emerald-100 text-emerald-800"
                            : p.estado === "RECHAZADO"
                            ? "bg-rose-100 text-rose-800"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {p.estado === "APROBADO"
                          ? "✅ Aprobado"
                          : p.estado === "RECHAZADO"
                          ? "❌ Rechazado"
                          : "⏳ En Revisión"}
                      </span>
                      {p.motivo_rechazo && (
                        <span className="block text-[9px] text-rose-600 italic mt-0.5">
                          {p.motivo_rechazo}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <button
                        type="button"
                        onClick={() => setComprobanteZoom(p.comprobante_url)}
                        className="rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] font-bold text-indigo-700 hover:bg-indigo-100 transition"
                      >
                        🖼️ Ver Mi Comprobante
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Sub-bloque B: Pagos de Ganancias Recibidos de la Casa */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
          <span className="text-xl">🏆</span>
          <div>
            <h3 className="text-sm font-black text-slate-900">
              Pagos de Ganancias Recibidos de la Casa ({pagosRecibidos.length})
            </h3>
            <p className="text-[11px] text-slate-500">
              Premios y retiros pagados por la administración con constancia visual de transferencia
            </p>
          </div>
        </div>

        {cargando ? (
          <div className="p-8 text-center text-xs text-slate-400">Cargando pagos recibidos...</div>
        ) : pagosRecibidos.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-slate-500 text-xs">
            Aún no tienes registros de cobro de ganancias liquidadas.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[10px] font-black uppercase text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-3">Fecha y Hora</th>
                  <th className="py-2.5 px-3">Método / Emisor Casa</th>
                  <th className="py-2.5 px-3 font-mono">Nº Referencia</th>
                  <th className="py-2.5 px-3 text-right">Monto Recibido</th>
                  <th className="py-2.5 px-3 text-center">Constancia de Pago</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pagosRecibidos.map((p) => (
                  <tr key={p.id} className="hover:bg-emerald-50/40">
                    <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap text-[11px]">
                      {new Date(p.created_at).toLocaleString("es-VE", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="font-bold text-slate-800">{p.metodo_pago}</span>
                      {p.banco_origen && (
                        <span className="block text-[10px] text-slate-500">Desde: {p.banco_origen}</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 font-mono font-bold text-slate-700">
                      #{p.referencia_bancaria}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-black text-emerald-700 text-sm">
                      {formatearMontoSinMoneda(p.monto_equivalente_base)}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <button
                        type="button"
                        onClick={() => setComprobanteZoom(p.comprobante_url)}
                        className="rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-800 hover:bg-emerald-100 transition"
                      >
                        📥 Ver / Descargar Comprobante
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Visor Modal de Comprobante */}
      {comprobanteZoom && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setComprobanteZoom(null)}
        >
          <div
            className="relative max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl bg-white p-3 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 mb-2">
              <span className="text-xs font-bold text-slate-800">Comprobante de Pago</span>
              <button
                type="button"
                onClick={() => setComprobanteZoom(null)}
                className="rounded-full bg-slate-100 p-1 text-slate-600 hover:bg-slate-200"
              >
                ✕
              </button>
            </div>
            {comprobanteZoom.startsWith("data:application/pdf") ? (
              <iframe src={comprobanteZoom} className="w-full h-96 rounded" title="Comprobante PDF" />
            ) : (
              <img
                src={comprobanteZoom}
                alt="Comprobante"
                className="max-h-[80vh] w-auto mx-auto object-contain rounded-xl"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
