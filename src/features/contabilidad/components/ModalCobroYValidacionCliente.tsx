"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { Button } from "@/shared/components/ui/Button";
import {
  listarPagosPendientesConciliacion,
  aprobarPagoCliente,
  rechazarPagoCliente,
  registrarCobroDirectoACliente,
  subirComprobantePago,
  type PagoComprobanteRow,
} from "@/features/contabilidad/lib/pagos-comprobantes";
import { listarClientes, type ClienteRow } from "@/features/clientes/lib/clientes";
import { formatoMoneda } from "@/shared/lib/vzla";
import { formatearMontoSinMoneda } from "@/shared/lib/dinero";

const METODOS_COBRO = [
  { id: "PAGO_MOVIL", label: "📱 Pago Móvil" },
  { id: "ZELLE", label: "🇺🇸 Zelle (USD)" },
  { id: "TRANSFERENCIA", label: "🏦 Transferencia Bancaria" },
  { id: "EFECTIVO_USD", label: "💵 Efectivo USD" },
  { id: "EFECTIVO_BS", label: "💵 Efectivo Bs" },
  { id: "USDT", label: "🪙 USDT / Cripto" },
];

interface ModalCobroYValidacionClienteProps {
  abierto: boolean;
  onCerrar: () => void;
  grupoId?: string | null;
  clienteInicial?: { id?: string | number | null; nombre?: string | null; saldo?: number | null } | null;
  onOperacionCompletada?: () => void;
}

export function ModalCobroYValidacionCliente({
  abierto,
  onCerrar,
  grupoId,
  clienteInicial,
  onOperacionCompletada,
}: ModalCobroYValidacionClienteProps) {
  const [tab, setTab] = useState<"REGISTRAR_COBRO" | "VALIDAR_REPORTADOS">("REGISTRAR_COBRO");

  // Clientes con saldo negativo
  const [clientesDeudores, setClientesDeudores] = useState<ClienteRow[]>([]);
  const [cargandoClientes, setCargandoClientes] = useState(false);
  const [clienteSelId, setClienteSelId] = useState<string>("");

  // Formulario de cobro directo
  const [montoCobro, setMontoCobro] = useState<string>("");
  const [metodoCobro, setMetodoCobro] = useState<string>("PAGO_MOVIL");
  const [bancoCasa, setBancoCasa] = useState<string>("Banco Operativo Principal");
  const [referenciaCobro, setReferenciaCobro] = useState<string>("");
  const [notasCobro, setNotasCobro] = useState<string>("");
  const [archivoComprobante, setArchivoComprobante] = useState<File | Blob | null>(null);
  const [previewComprobante, setPreviewComprobante] = useState<string>("");
  const [guardandoCobro, setGuardandoCobro] = useState(false);
  const [errorCobro, setErrorCobro] = useState<string>("");

  // Pagos reportados por clientes
  const [pagosReportados, setPagosReportados] = useState<PagoComprobanteRow[]>([]);
  const [cargandoReportados, setCargandoReportados] = useState(false);
  const [comprobanteZoom, setComprobanteZoom] = useState<string | null>(null);
  const [procesandoAccionId, setProcesandoAccionId] = useState<string | null>(null);

  // Cargar clientes y pagos reportados
  const recargar = useCallback(async () => {
    setCargandoClientes(true);
    setCargandoReportados(true);
    try {
      const [todosClientes, reportados] = await Promise.all([
        listarClientes(true, grupoId),
        listarPagosPendientesConciliacion(grupoId),
      ]);
      const deudores = todosClientes.filter((c) => Number(c.saldo_actual ?? 0) < -0.001);
      setClientesDeudores(deudores);
      setPagosReportados(reportados);

      // Si viene cliente inicial
      if (clienteInicial?.id) {
        setClienteSelId(String(clienteInicial.id));
        const saldoAbs = Math.abs(Number(clienteInicial.saldo ?? 0));
        if (saldoAbs > 0) setMontoCobro(String(saldoAbs));

        // Si el cliente ya tiene un pago reportado pendiente, abrir pestaña de validación
        const tienePendiente = reportados.some(
          (p) => String(p.cliente_id) === String(clienteInicial.id)
        );
        if (tienePendiente) {
          setTab("VALIDAR_REPORTADOS");
        }
      } else if (deudores.length > 0 && !clienteSelId) {
        setClienteSelId(String(deudores[0].id));
        setMontoCobro(String(Math.abs(Number(deudores[0].saldo_actual ?? 0))));
      }
    } finally {
      setCargandoClientes(false);
      setCargandoReportados(false);
    }
  }, [grupoId, clienteInicial]);

  useEffect(() => {
    if (abierto) {
      void recargar();
      setErrorCobro("");
      setReferenciaCobro("");
      setNotasCobro("");
      setArchivoComprobante(null);
      setPreviewComprobante("");
    }
  }, [abierto, recargar]);

  const clienteSeleccionado = useMemo(() => {
    if (!clienteSelId) return null;
    return clientesDeudores.find((c) => String(c.id) === clienteSelId) ?? null;
  }, [clienteSelId, clientesDeudores]);

  // Manejo de pegado de captura
  useEffect(() => {
    if (!abierto) return;
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith("image/")) {
          const blob = items[i].getAsFile();
          if (blob) {
            e.preventDefault();
            setArchivoComprobante(blob);
            const r = new FileReader();
            r.onload = (ev) => setPreviewComprobante(String(ev.target?.result || ""));
            r.readAsDataURL(blob);
            break;
          }
        }
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [abierto]);

  const handleRegistrarCobro = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorCobro("");

    if (!clienteSelId && !clienteInicial?.id) {
      setErrorCobro("Selecciona el cliente al que se le aplicará el cobro.");
      return;
    }
    const montoNum = parseFloat(montoCobro) || 0;
    if (montoNum <= 0) {
      setErrorCobro("Ingresa un monto cobrado mayor a 0.");
      return;
    }
    if (!referenciaCobro.trim()) {
      setErrorCobro("El número de referencia bancaria o identificación del cobro es obligatorio.");
      return;
    }

    setGuardandoCobro(true);
    try {
      let urlSubida = "";
      if (archivoComprobante) {
        const subida = await subirComprobantePago(archivoComprobante, {
          nombreArchivo: `cobro_directo_${clienteSelId}.jpg`,
          clienteId: clienteSelId,
          grupoId: grupoId || undefined,
        });
        urlSubida = subida.url;
      }

      const res = await registrarCobroDirectoACliente({
        grupoId: grupoId || (clienteSeleccionado?.grupo_id ? String(clienteSeleccionado.grupo_id) : null),
        clienteId: clienteSelId || String(clienteInicial?.id),
        clienteNombre: clienteSeleccionado?.nombre || clienteSeleccionado?.seudonimo || clienteInicial?.nombre || "Cliente",
        metodoPago: metodoCobro,
        bancoDestinoCasa: bancoCasa,
        referenciaBancaria: referenciaCobro.trim(),
        montoCobrado: montoNum,
        moneda: "USD",
        comprobanteUrl: urlSubida,
        notas: notasCobro.trim() || undefined,
        operador: "Administrador",
      });

      if (!res.ok) {
        setErrorCobro(res.error || "Error al registrar el cobro.");
        return;
      }

      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: {
            msg: `✅ Cobro de $${formatearMontoSinMoneda(montoNum)} registrado. Se notificó al usuario para que valide la recepción.`,
            tipo: "success",
          },
        })
      );
      onOperacionCompletada?.();
      onCerrar();
    } finally {
      setGuardandoCobro(false);
    }
  };

  const handleAprobarReportado = async (pago: PagoComprobanteRow) => {
    setProcesandoAccionId(pago.id);
    try {
      const res = await aprobarPagoCliente(pago.id, "Administrador");
      if (!res.ok) {
        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: { msg: `❌ No se pudo validar el pago: ${res.error}`, tipo: "error" },
          })
        );
        return;
      }
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: {
            msg: `✔️ Pago de $${formatearMontoSinMoneda(pago.monto_equivalente_base)} aprobado y abonado al cliente ${pago.cliente_nombre}.`,
            tipo: "success",
          },
        })
      );
      await recargar();
      onOperacionCompletada?.();
    } finally {
      setProcesandoAccionId(null);
    }
  };

  const handleRechazarReportado = async (pago: PagoComprobanteRow) => {
    const motivo = window.prompt("Indica el motivo de rechazo del pago:", "Comprobante no coincide con el saldo / cuenta");
    if (!motivo) return;
    setProcesandoAccionId(pago.id);
    try {
      const res = await rechazarPagoCliente(pago.id, motivo, "Administrador");
      if (!res.ok) {
        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: { msg: `❌ Error al rechazar: ${res.error}`, tipo: "error" },
          })
        );
        return;
      }
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: { msg: `🚫 Pago rechazado y notificado al cliente.`, tipo: "warning" },
        })
      );
      await recargar();
      onOperacionCompletada?.();
    } finally {
      setProcesandoAccionId(null);
    }
  };

  if (!abierto) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 backdrop-blur-xs">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 text-white shadow-2xl">
        {/* Cabecera */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-800 bg-slate-950 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/20 text-lg border border-blue-500/40">
              📥
            </span>
            <div>
              <h3 className="text-sm font-black text-white">
                Gestión de Cobro y Validación de Pagos
              </h3>
              <p className="text-[11px] text-slate-400">
                Registra cobros directos con validación al usuario o valida pagos reportados
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition"
          >
            ✕
          </button>
        </div>

        {/* Pestañas */}
        <div className="flex border-b border-slate-800 bg-slate-950/70 px-5 pt-2 gap-2 text-xs font-bold">
          <button
            type="button"
            onClick={() => setTab("REGISTRAR_COBRO")}
            className={`border-b-2 px-3 py-2 transition ${
              tab === "REGISTRAR_COBRO"
                ? "border-blue-500 text-blue-400 font-black"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            📥 Cobro Directo (Admin / Operador)
          </button>
          <button
            type="button"
            onClick={() => setTab("VALIDAR_REPORTADOS")}
            className={`border-b-2 px-3 py-2 transition flex items-center gap-1.5 ${
              tab === "VALIDAR_REPORTADOS"
                ? "border-amber-400 text-amber-300 font-black"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <span>🔔 Pagos Reportados por Clientes</span>
            {pagosReportados.length > 0 && (
              <span className="rounded-full bg-amber-400 px-1.5 py-0.2 text-[10px] font-black text-slate-950">
                {pagosReportados.length}
              </span>
            )}
          </button>
        </div>

        {/* Contenido scrolleable */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {tab === "REGISTRAR_COBRO" ? (
            <form onSubmit={handleRegistrarCobro} className="space-y-4">
              {errorCobro && (
                <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs font-bold text-red-300">
                  {errorCobro}
                </div>
              )}

              {/* Selección de cliente con saldo en contra */}
              <div>
                <label className="block text-[11px] font-black uppercase tracking-wider text-slate-400 mb-1">
                  Cliente con Saldo Negativo (Deudor)
                </label>
                {clienteInicial?.nombre ? (
                  <div className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-800/80 px-3.5 py-2.5">
                    <div>
                      <div className="text-sm font-black text-white">{clienteInicial.nombre}</div>
                      <div className="text-xs text-rose-400 font-mono font-bold">
                        Deuda actual: {formatoMoneda("USD", Math.abs(Number(clienteInicial.saldo ?? 0)))}
                      </div>
                    </div>
                    <span className="rounded-full bg-rose-500/20 border border-rose-500/40 px-2 py-0.5 text-[10px] font-black text-rose-300">
                      Saldo Deudor
                    </span>
                  </div>
                ) : (
                  <select
                    value={clienteSelId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setClienteSelId(id);
                      const c = clientesDeudores.find((x) => String(x.id) === id);
                      if (c) setMontoCobro(String(Math.abs(Number(c.saldo_actual ?? 0))));
                    }}
                    className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-bold text-white outline-none focus:border-blue-500"
                  >
                    {cargandoClientes ? (
                      <option value="">Cargando clientes deudores...</option>
                    ) : clientesDeudores.length === 0 ? (
                      <option value="">No hay clientes con saldo deudor en este momento</option>
                    ) : (
                      clientesDeudores.map((c) => (
                        <option key={String(c.id)} value={String(c.id)}>
                          {c.seudonimo || c.nombre} · Deuda: {formatoMoneda("USD", Math.abs(Number(c.saldo_actual ?? 0)))}
                        </option>
                      ))
                    )}
                  </select>
                )}
              </div>

              {/* Monto y Método */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-black uppercase tracking-wider text-slate-400 mb-1">
                    Monto a Cobrar (USD) *
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-mono font-bold">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      required
                      value={montoCobro}
                      onChange={(e) => setMontoCobro(e.target.value)}
                      placeholder="0.00"
                      className="w-full rounded-xl border border-slate-700 bg-slate-800 py-2 pl-7 pr-3 text-xs font-mono font-black text-emerald-400 outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-black uppercase tracking-wider text-slate-400 mb-1">
                    Método de Cobro *
                  </label>
                  <select
                    value={metodoCobro}
                    onChange={(e) => setMetodoCobro(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-bold text-white outline-none focus:border-blue-500"
                  >
                    {METODOS_COBRO.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Banco Receptor y Referencia */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-black uppercase tracking-wider text-slate-400 mb-1">
                    Banco Receptor (Casa)
                  </label>
                  <input
                    type="text"
                    value={bancoCasa}
                    onChange={(e) => setBancoCasa(e.target.value)}
                    placeholder="Banco receptor..."
                    className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-bold text-white outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-black uppercase tracking-wider text-slate-400 mb-1">
                    N° de Referencia Bancaria *
                  </label>
                  <input
                    type="text"
                    required
                    value={referenciaCobro}
                    onChange={(e) => setReferenciaCobro(e.target.value)}
                    placeholder="Últimos dígitos o ref completa..."
                    className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-mono font-bold text-white outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Notas y Comprobante */}
              <div>
                <label className="block text-[11px] font-black uppercase tracking-wider text-slate-400 mb-1">
                  Notas / Observación del Cobro
                </label>
                <input
                  type="text"
                  value={notasCobro}
                  onChange={(e) => setNotasCobro(e.target.value)}
                  placeholder="Ej: Cobrado en taquilla / Transferencia confirmada..."
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 outline-none focus:border-blue-500"
                />
              </div>

              {/* Comprobante opcional (pegar con Ctrl+V) */}
              <div>
                <label className="block text-[11px] font-black uppercase tracking-wider text-slate-400 mb-1">
                  Comprobante de Pago (Opcional · Pega con Ctrl+V)
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        setArchivoComprobante(f);
                        const r = new FileReader();
                        r.onload = (ev) => setPreviewComprobante(String(ev.target?.result || ""));
                        r.readAsDataURL(f);
                      }
                    }}
                    className="text-xs text-slate-400 file:mr-2.5 file:rounded-lg file:border-0 file:bg-slate-800 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-slate-200 hover:file:bg-slate-700"
                  />
                  {previewComprobante && (
                    <div className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={previewComprobante}
                        alt="Comprobante"
                        className="h-12 w-12 rounded-lg object-cover border border-slate-700 shadow-sm"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setArchivoComprobante(null);
                          setPreviewComprobante("");
                        }}
                        className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-red-600 text-[10px] text-white flex items-center justify-center font-bold"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Banner informativo del requerimiento */}
              <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-3 text-xs text-blue-200 flex items-start gap-2">
                <span className="text-base shrink-0">ℹ️</span>
                <div>
                  <span className="font-bold">Notificación y Validación Automática al Usuario:</span> Al registrar los datos de este cobro, el saldo se abonará de inmediato y <span className="font-bold underline">le llegará la información al usuario en su portal</span> para que valide que lo recibió satisfactoriamente.
                </div>
              </div>

              {/* Botón de acción */}
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <Button variant="ghost" size="sm" type="button" onClick={onCerrar} disabled={guardandoCobro}>
                  Cancelar
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  type="submit"
                  disabled={guardandoCobro || (!clienteSelId && !clienteInicial?.id)}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-black"
                >
                  {guardandoCobro ? "Procesando cobro..." : "📥 Registrar Cobro y Notificar al Usuario"}
                </Button>
              </div>
            </form>
          ) : (
            <div className="space-y-3">
              <div className="text-xs text-slate-300">
                A continuación se listan los pagos que los clientes han reportado desde su portal. Valida la información del comprobante y aprueba para descontar su deuda.
              </div>

              {cargandoReportados ? (
                <div className="py-8 text-center text-xs text-slate-400">
                  Cargando reportes de pago...
                </div>
              ) : pagosReportados.length === 0 ? (
                <div className="py-10 text-center rounded-xl border border-slate-800 bg-slate-950/40 p-6">
                  <span className="text-2xl">🎉</span>
                  <div className="text-xs font-bold text-slate-300 mt-2">
                    No hay reportes de pagos pendientes de validación en este momento.
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    Puedes registrar un cobro directo en la pestaña anterior.
                  </div>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {pagosReportados.map((p) => {
                    const esDelCliente = clienteInicial?.id && String(p.cliente_id) === String(clienteInicial.id);
                    return (
                      <div
                        key={p.id}
                        className={`rounded-xl border p-3.5 transition ${
                          esDelCliente
                            ? "border-amber-400/60 bg-amber-500/10 shadow-sm"
                            : "border-slate-800 bg-slate-850 hover:border-slate-700"
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-black text-white">{p.cliente_nombre}</span>
                              {esDelCliente && (
                                <span className="rounded-full bg-amber-400 px-2 py-0.2 text-[9px] font-black text-slate-950">
                                  Cliente seleccionado
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-400 mt-0.5">
                              Método: <span className="font-bold text-slate-200">{p.metodo_pago}</span> · Ref: <span className="font-mono font-bold text-white">#{p.referencia_bancaria}</span>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-mono font-black text-emerald-400">
                              +${formatearMontoSinMoneda(p.monto_equivalente_base)} USD
                            </div>
                            <div className="text-[10px] text-slate-500">
                              {p.created_at ? new Date(p.created_at).toLocaleString("es-VE", { dateStyle: "short", timeStyle: "short" }) : "—"}
                            </div>
                          </div>
                        </div>

                        {/* Comprobante y botones */}
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                          {p.comprobante_url ? (
                            <button
                              type="button"
                              onClick={() => setComprobanteZoom(p.comprobante_url || null)}
                              className="inline-flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 font-bold"
                            >
                              <span>📎 Ver Comprobante</span>
                            </button>
                          ) : (
                            <span className="text-xs text-slate-500 italic">Sin imagen adjunta</span>
                          )}

                          <div className="flex items-center gap-1.5 ml-auto">
                            <Button
                              variant="outline"
                              size="sm"
                              type="button"
                              disabled={procesandoAccionId === p.id}
                              onClick={() => handleRechazarReportado(p)}
                              className="border-rose-500/40 text-rose-300 hover:bg-rose-500/10 text-xs font-bold"
                            >
                              ✕ Rechazar
                            </Button>
                            <Button
                              variant="default"
                              size="sm"
                              type="button"
                              disabled={procesandoAccionId === p.id}
                              onClick={() => handleAprobarReportado(p)}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs"
                            >
                              {procesandoAccionId === p.id ? "Validando..." : "✔️ Validar y Aprobar Pago"}
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal de zoom de comprobante */}
        {comprobanteZoom && (
          <div
            className="fixed inset-0 z-60 flex items-center justify-center bg-black/80 p-4"
            onClick={() => setComprobanteZoom(null)}
          >
            <div className="relative max-h-[90vh] max-w-2xl overflow-hidden rounded-xl bg-slate-900 p-2 shadow-2xl">
              <button
                type="button"
                onClick={() => setComprobanteZoom(null)}
                className="absolute top-3 right-3 grid h-8 w-8 place-items-center rounded-full bg-slate-800 text-white font-black"
              >
                ✕
              </button>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={comprobanteZoom}
                alt="Comprobante completo"
                className="max-h-[82vh] w-auto rounded-lg object-contain"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
