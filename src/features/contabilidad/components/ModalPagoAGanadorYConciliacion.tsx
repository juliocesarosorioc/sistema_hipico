"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/shared/components/ui/Button";
import {
  listarGanadoresPorPagar,
  listarPagosPendientesConciliacion,
  aprobarPagoCliente,
  rechazarPagoCliente,
  registrarPagoComprobante,
  subirComprobantePago,
  formatearReciboWhatsappGanador,
  type GanadorPorPagarItem,
  type PagoComprobanteRow,
} from "@/features/contabilidad/lib/pagos-comprobantes";
import { redondearCentavos, formatearMontoSinMoneda, restarDinero } from "@/shared/lib/dinero";
import { resumenFormaPago } from "@/features/clientes/lib/formasPago";

interface ModalPagoAGanadorYConciliacionProps {
  abierto: boolean;
  onCerrar: () => void;
  grupoId?: string | null;
  clientePreseleccionadoId?: string | null;
  vistaInicial?: "pagar_ganadores" | "conciliacion" | "PAGAR_GANADORES" | "CONCILIAR_PAGOS";
  pestanaInicial?: "pagar_ganadores" | "conciliacion" | "PAGAR_GANADORES" | "CONCILIAR_PAGOS";
  onPagoCompletado?: () => void;
  onPagoRealizado?: () => void;
}

export function ModalPagoAGanadorYConciliacion({
  abierto,
  onCerrar,
  grupoId,
  clientePreseleccionadoId,
  vistaInicial = "pagar_ganadores",
  pestanaInicial,
  onPagoCompletado,
  onPagoRealizado,
}: ModalPagoAGanadorYConciliacionProps) {
  const notificarExito = () => {
    onPagoCompletado?.();
    onPagoRealizado?.();
  };
  const inicial = pestanaInicial || vistaInicial || "pagar_ganadores";
  const inicialNorm = String(inicial).toLowerCase().includes("concili") ? "conciliacion" : "pagar_ganadores";
  const [tab, setTab] = useState<"pagar_ganadores" | "conciliacion">(inicialNorm);

  // Lista de ganadores con saldo a favor
  const [ganadores, setGanadores] = useState<GanadorPorPagarItem[]>([]);
  const [cargandoGanadores, setCargandoGanadores] = useState(false);
  const [ganadorSeleccionado, setGanadorSeleccionado] = useState<GanadorPorPagarItem | null>(null);

  // Formulario de pago a ganador
  const [montoPagar, setMontoPagar] = useState("");
  const [metodoPago, setMetodoPago] = useState("PAGO_MOVIL");
  const [bancoEmisorCasa, setBancoEmisorCasa] = useState("Banco Pozo Principal Operativo");
  const [referenciaPago, setReferenciaPago] = useState("");
  const [notasPago, setNotasPago] = useState("");
  const [archivoComprobante, setArchivoComprobante] = useState<File | Blob | null>(null);
  const [previewComprobante, setPreviewComprobante] = useState<string>("");
  const [procesandoPago, setProcesandoPago] = useState(false);
  const [errorPago, setErrorPago] = useState<string>("");

  // Visor de Recibo WhatsApp tras registrar pago
  const [reciboWhatsapp, setReciboWhatsapp] = useState<string | null>(null);
  const [copiadoWsp, setCopiadoWsp] = useState(false);

  // Bandeja de conciliación
  const [pendientes, setPendientes] = useState<PagoComprobanteRow[]>([]);
  const [cargandoPendientes, setCargandoPendientes] = useState(false);
  const [comprobanteZoomUrl, setComprobanteZoomUrl] = useState<string | null>(null);
  const [procesandoAccionId, setProcesandoAccionId] = useState<string | null>(null);
  const [motivoRechazoInput, setMotivoRechazoInput] = useState<{ id: string; abierto: boolean; motivo: string }>({
    id: "",
    abierto: false,
    motivo: "",
  });

  const [copiadoDatosCliente, setCopiadoDatosCliente] = useState(false);

  // Cargar datos
  const cargarDatos = useCallback(async () => {
    setCargandoGanadores(true);
    setCargandoPendientes(true);
    try {
      const [listaG, listaP] = await Promise.all([
        listarGanadoresPorPagar(grupoId),
        listarPagosPendientesConciliacion(grupoId),
      ]);
      setGanadores(listaG);
      setPendientes(listaP);

      // Si viene cliente preseleccionado
      if (clientePreseleccionadoId) {
        const found = listaG.find((g) => g.clienteId === clientePreseleccionadoId);
        if (found) {
          seleccionarGanador(found);
          setTab("pagar_ganadores");
        }
      }
    } finally {
      setCargandoGanadores(false);
      setCargandoPendientes(false);
    }
  }, [grupoId, clientePreseleccionadoId]);

  useEffect(() => {
    if (abierto) {
      void cargarDatos();
    }
  }, [abierto, cargarDatos]);

  // Manejo de paste (Ctrl+V) de la captura de transferencia
  useEffect(() => {
    if (!abierto || !ganadorSeleccionado) return;

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
  }, [abierto, ganadorSeleccionado]);

  const seleccionarGanador = (g: GanadorPorPagarItem) => {
    setGanadorSeleccionado(g);
    setMontoPagar(String(g.saldoDisponible));
    setReferenciaPago("");
    setNotasPago("");
    setArchivoComprobante(null);
    setPreviewComprobante("");
    setErrorPago("");
    setReciboWhatsapp(null);
  };

  const copiarDatosBancarios = (g: GanadorPorPagarItem) => {
    const lineas: string[] = [`👤 Beneficiario: ${g.nombre}`];
    if (g.telefono) lineas.push(`📱 Teléfono: ${g.telefono}`);
    if (g.formasPago.length > 0) {
      lineas.push("🏦 Cuentas Registradas:");
      g.formasPago.forEach((f) => lineas.push(` • ${resumenFormaPago(f)}`));
    } else {
      lineas.push("⚠️ Sin formas de pago registradas en ficha");
    }

    navigator.clipboard.writeText(lineas.join("\n"));
    setCopiadoDatosCliente(true);
    setTimeout(() => setCopiadoDatosCliente(false), 2500);
  };

  const handleRegistrarPagoGanador = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ganadorSeleccionado) return;
    setErrorPago("");

    const montoNum = parseFloat(montoPagar) || 0;
    if (montoNum <= 0) {
      setErrorPago("Ingresa un monto a pagar mayor a 0.");
      return;
    }
    if (montoNum > ganadorSeleccionado.saldoDisponible + 0.001) {
      setErrorPago("El monto no puede superar el saldo positivo disponible del cliente.");
      return;
    }
    if (!referenciaPago.trim()) {
      setErrorPago("El número de referencia bancaria es obligatorio.");
      return;
    }
    if (!archivoComprobante) {
      setErrorPago("Adjunta o pega (Ctrl+V) la captura del comprobante de transferencia bancaria enviado.");
      return;
    }

    setProcesandoPago(true);
    try {
      // 1. Subir comprobante
      const subida = await subirComprobantePago(archivoComprobante, {
        nombreArchivo: `pago_ganador_${ganadorSeleccionado.clienteId}.jpg`,
        clienteId: ganadorSeleccionado.clienteId,
        grupoId: grupoId || undefined,
      });

      // 2. Registrar pago y descontar saldo
      const res = await registrarPagoComprobante({
        grupoId: grupoId || ganadorSeleccionado.grupoId,
        clienteId: ganadorSeleccionado.clienteId,
        clienteNombre: ganadorSeleccionado.nombre,
        direccionFlujo: "PAGO_A_GANADOR",
        metodoPago,
        bancoOrigen: bancoEmisorCasa,
        bancoDestino: ganadorSeleccionado.formaPrincipal?.datos?.banco || ganadorSeleccionado.formaPrincipal?.metodo || "Cuenta Cliente",
        referenciaBancaria: referenciaPago.trim(),
        montoMonedaOrigen: montoNum,
        monedaOrigen: "USD",
        tasaCambio: 1,
        comprobanteUrl: subida.url,
        comprobanteNombre: subida.nombre,
        comprobanteTipo: subida.tipo,
        comprobantePeso: subida.peso,
        notas: notasPago.trim() || undefined,
        operador: "Administrador",
      });

      if (!res.ok) {
        setErrorPago(res.error || "No se pudo registrar el pago al ganador.");
        return;
      }

      const nuevoSaldo = Math.max(0, restarDinero(ganadorSeleccionado.saldoDisponible, montoNum));

      // 3. Generar mensaje de WhatsApp
      const textoWsp = formatearReciboWhatsappGanador({
        clienteNombre: ganadorSeleccionado.nombre,
        metodo: metodoPago,
        banco: bancoEmisorCasa,
        referencia: referenciaPago.trim(),
        montoPagado: montoNum,
        nuevoSaldo,
      });

      setReciboWhatsapp(textoWsp);
      notificarExito();
      void cargarDatos();
    } catch (err) {
      setErrorPago((err as Error).message || "Error procesando el pago.");
    } finally {
      setProcesandoPago(false);
    }
  };

  const handleAprobarPago = async (pago: PagoComprobanteRow) => {
    if (!confirm(`¿Aprobar pago de ${pago.cliente_nombre} por ${formatearMontoSinMoneda(pago.monto_equivalente_base)} y acreditarlo a su saldo?`)) {
      return;
    }

    setProcesandoAccionId(pago.id);
    try {
      const res = await aprobarPagoCliente(pago.id, "Administrador");
      if (res.ok) {
        void cargarDatos();
        notificarExito();
      } else {
        alert(res.error || "Error al aprobar pago.");
      }
    } finally {
      setProcesandoAccionId(null);
    }
  };

  const handleConfirmarRechazo = async () => {
    const { id, motivo } = motivoRechazoInput;
    if (!id || !motivo.trim()) return;

    setProcesandoAccionId(id);
    try {
      const res = await rechazarPagoCliente(id, motivo.trim(), "Administrador");
      if (res.ok) {
        setMotivoRechazoInput({ id: "", abierto: false, motivo: "" });
        void cargarDatos();
        notificarExito();
      } else {
        alert(res.error || "Error al rechazar pago.");
      }
    } finally {
      setProcesandoAccionId(null);
    }
  };

  if (!abierto) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-4xl rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden my-6">
        {/* Barra Superior */}
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 px-6 py-4 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">💸</span>
            <div>
              <h3 className="text-base font-black tracking-wide">
                Gestión Financiera de Pagos y Comprobantes
              </h3>
              <p className="text-xs text-slate-300">
                Liquidación a ganadores y conciliación de depósitos con Partida Doble
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            className="rounded-full p-1.5 text-slate-300 hover:bg-white/10 hover:text-white transition"
          >
            ✕
          </button>
        </div>

        {/* Pestañas de Navegación */}
        <div className="flex border-b border-slate-200 bg-slate-50 px-6 text-xs font-bold">
          <button
            type="button"
            onClick={() => {
              setTab("pagar_ganadores");
              setReciboWhatsapp(null);
            }}
            className={`py-3 px-4 flex items-center gap-2 border-b-2 transition ${
              tab === "pagar_ganadores"
                ? "border-emerald-600 text-emerald-800 bg-white"
                : "border-transparent text-slate-500 hover:text-slate-900"
            }`}
          >
            <span>🏆 Pagar a Ganadores ({ganadores.length})</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setTab("conciliacion");
              setReciboWhatsapp(null);
            }}
            className={`py-3 px-4 flex items-center gap-2 border-b-2 transition ${
              tab === "conciliacion"
                ? "border-indigo-600 text-indigo-800 bg-white"
                : "border-transparent text-slate-500 hover:text-slate-900"
            }`}
          >
            <span>🔔 Conciliar Pagos de Clientes</span>
            {pendientes.length > 0 && (
              <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-black text-white">
                {pendientes.length}
              </span>
            )}
          </button>
        </div>

        {/* Contenido Modal */}
        <div className="p-6">
          {tab === "pagar_ganadores" ? (
            reciboWhatsapp ? (
              /* Visor Previo de WhatsApp para enviar el recibo */
              <div className="space-y-4 max-w-lg mx-auto py-4">
                <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-900">
                  <div className="flex items-center gap-2 font-bold mb-2 text-sm">
                    <span>✅ Pago Procesado y Descontado Exitosamente</span>
                  </div>
                  <p className="text-xs text-emerald-800 leading-relaxed">
                    El saldo a favor del cliente fue actualizado en la base de datos y se generó el asiento contable de salida de fondos.
                  </p>
                </div>

                <div className="rounded-xl border border-slate-300 bg-slate-900 p-4 text-slate-100 font-mono text-xs whitespace-pre-wrap leading-relaxed shadow-inner">
                  {reciboWhatsapp}
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <Button
                    variant="primary"
                    onClick={() => {
                      navigator.clipboard.writeText(reciboWhatsapp);
                      setCopiadoWsp(true);
                      setTimeout(() => setCopiadoWsp(false), 2500);
                    }}
                    className="flex-1 justify-center bg-emerald-700 hover:bg-emerald-800"
                  >
                    {copiadoWsp ? "✓ ¡Copiado al Portapapeles!" : "📋 Copiar Recibo para WhatsApp"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setReciboWhatsapp(null);
                      setGanadorSeleccionado(null);
                    }}
                  >
                    Volver a Ganadores
                  </Button>
                </div>
              </div>
            ) : ganadorSeleccionado ? (
              /* Formulario para liquidar a ganador seleccionado */
              <form onSubmit={handleRegistrarPagoGanador} className="space-y-4 text-xs">
                <div className="flex items-center justify-between rounded-xl bg-slate-50 border border-slate-200 p-3">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      Liquidando Saldo a Favor a:
                    </span>
                    <h4 className="text-sm font-black text-slate-900">{ganadorSeleccionado.nombre}</h4>
                    <p className="text-[11px] text-slate-600">
                      Saldo disponible a pagar:{" "}
                      <span className="font-mono font-bold text-emerald-700">
                        {formatearMontoSinMoneda(ganadorSeleccionado.saldoDisponible)}
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => copiarDatosBancarios(ganadorSeleccionado)}
                      className="rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-bold text-indigo-700 hover:bg-indigo-100 transition"
                    >
                      {copiadoDatosCliente ? "✓ Copiados" : "📋 Copiar Datos del Cliente"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setGanadorSeleccionado(null)}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
                    >
                      Cambiar
                    </button>
                  </div>
                </div>

                {errorPago && (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-rose-800">
                    ⚠️ {errorPago}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  {/* Monto a Pagar */}
                  <div>
                    <label className="block font-black text-slate-700 uppercase tracking-wider text-[10px] mb-1">
                      Monto a Pagar (Equivalente)
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        max={ganadorSeleccionado.saldoDisponible}
                        required
                        value={montoPagar}
                        onChange={(e) => setMontoPagar(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono font-black text-slate-900 focus:border-emerald-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setMontoPagar(String(ganadorSeleccionado.saldoDisponible))}
                        className="rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-2 text-[10px] font-black text-emerald-800 shrink-0 hover:bg-emerald-100"
                      >
                        100% Saldo
                      </button>
                    </div>
                  </div>

                  {/* Método */}
                  <div>
                    <label className="block font-black text-slate-700 uppercase tracking-wider text-[10px] mb-1">
                      Método de Pago Realizado
                    </label>
                    <select
                      value={metodoPago}
                      onChange={(e) => setMetodoPago(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-800 bg-white focus:outline-none"
                    >
                      <option value="PAGO_MOVIL">Pago Móvil</option>
                      <option value="TRANSFERENCIA">Transferencia Bancaria</option>
                      <option value="ZELLE">Zelle</option>
                      <option value="BINANCE">Binance Pay / USDT</option>
                      <option value="EFECTIVO">Efectivo Divisas</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* Caja / Banco Emisor */}
                  <div>
                    <label className="block font-black text-slate-700 uppercase tracking-wider text-[10px] mb-1">
                      Banco / Caja Emisora de la Casa
                    </label>
                    <input
                      type="text"
                      required
                      value={bancoEmisorCasa}
                      onChange={(e) => setBancoEmisorCasa(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-slate-800"
                    />
                  </div>

                  {/* Referencia Bancaria */}
                  <div>
                    <label className="block font-black text-slate-700 uppercase tracking-wider text-[10px] mb-1">
                      Nº Referencia de la Transferencia *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Dígitos de la transacción"
                      value={referenciaPago}
                      onChange={(e) => setReferenciaPago(e.target.value.replace(/[^a-zA-Z0-9]/g, ""))}
                      className="w-full rounded-lg border border-slate-300 px-3 py-1.5 font-mono font-bold text-slate-900"
                    />
                  </div>
                </div>

                {/* Adjuntar o Pegar (Ctrl+V) Comprobante */}
                <div>
                  <label className="block font-black text-slate-700 uppercase tracking-wider text-[10px] mb-1">
                    Comprobante de Transferencia (Adjuntar o Pegar con Ctrl+V) *
                  </label>
                  <div
                    onClick={() => {
                      const input = document.getElementById("file-comprobante-ganador") as HTMLInputElement;
                      input?.click();
                    }}
                    className={`border-2 border-dashed rounded-xl p-3 text-center cursor-pointer transition ${
                      archivoComprobante ? "border-emerald-500 bg-emerald-50/30" : "border-slate-300 bg-slate-50 hover:bg-slate-100"
                    }`}
                  >
                    <input
                      id="file-comprobante-ganador"
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) {
                          setArchivoComprobante(f);
                          const r = new FileReader();
                          r.onload = (ev) => setPreviewComprobante(String(ev.target?.result || ""));
                          r.readAsDataURL(f);
                        }
                      }}
                      className="hidden"
                    />

                    {previewComprobante ? (
                      <div className="flex items-center justify-center gap-3">
                        <img
                          src={previewComprobante}
                          alt="Comprobante"
                          className="h-16 w-16 rounded object-cover border border-slate-200"
                        />
                        <div className="text-left">
                          <p className="font-bold text-emerald-800">✓ Comprobante listo para registrar</p>
                          <p className="text-[10px] text-slate-500">Toca para reemplazar</p>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <span className="text-xl">📸</span>
                        <p className="font-bold text-slate-700">
                          Selecciona captura o pega directamente con <span className="rounded bg-slate-200 px-1 font-mono">Ctrl+V</span>
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Botones de Envío */}
                <div className="flex items-center justify-end gap-2.5 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setGanadorSeleccionado(null)}
                    disabled={procesandoPago}
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={procesandoPago || !montoPagar || !referenciaPago.trim() || !archivoComprobante}
                    className="bg-emerald-600 hover:bg-emerald-700 font-black tracking-wide"
                  >
                    {procesandoPago ? "Registrando y Descontando Saldo..." : "✅ Registrar Pago al Ganador"}
                  </Button>
                </div>
              </form>
            ) : (
              /* Lista de ganadores */
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800 text-xs">
                    Clientes con Saldo a Favor ({ganadores.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => void cargarDatos()}
                    className="text-[11px] font-bold text-indigo-700 hover:underline"
                  >
                    🔄 Actualizar Lista
                  </button>
                </div>

                {cargandoGanadores ? (
                  <div className="p-8 text-center text-slate-400 text-xs">Cargando ganadores...</div>
                ) : ganadores.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500 text-xs">
                    No hay clientes con saldo positivo a favor en este momento.
                  </div>
                ) : (
                  <div className="max-h-96 overflow-y-auto rounded-xl border border-slate-200">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-100 text-[10px] font-black uppercase text-slate-600 border-b border-slate-200">
                        <tr>
                          <th className="py-2 px-3">Cliente</th>
                          <th className="py-2 px-3">Formas de Cobro Registradas</th>
                          <th className="py-2 px-3 text-right">Saldo a Favor</th>
                          <th className="py-2 px-3 text-center">Acción</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {ganadores.map((g) => (
                          <tr key={g.clienteId} className="hover:bg-emerald-50/40 transition">
                            <td className="py-2.5 px-3 font-bold text-slate-900">
                              {g.nombre}
                              {g.telefono && <span className="block text-[10px] text-slate-400">{g.telefono}</span>}
                            </td>
                            <td className="py-2.5 px-3 text-[11px] text-slate-600">
                              {g.formasPago.length > 0 ? (
                                <span className="font-mono">{resumenFormaPago(g.formasPago[0])}</span>
                              ) : (
                                <span className="text-slate-400 italic">Sin datos de cobro</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-black text-emerald-700">
                              {formatearMontoSinMoneda(g.saldoDisponible)}
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <Button
                                size="sm"
                                variant="primary"
                                onClick={() => seleccionarGanador(g)}
                                className="bg-emerald-600 hover:bg-emerald-700 font-black text-[11px] px-3 py-1"
                              >
                                💸 Pagar Ganancia
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          ) : (
            /* Bandeja de conciliación de pagos de clientes */
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-800 text-xs">
                  Pagos Reportados por Clientes Pendientes de Revisión ({pendientes.length})
                </span>
                <button
                  type="button"
                  onClick={() => void cargarDatos()}
                  className="text-[11px] font-bold text-indigo-700 hover:underline"
                >
                  🔄 Actualizar Bandeja
                </button>
              </div>

              {cargandoPendientes ? (
                <div className="p-8 text-center text-slate-400 text-xs">Cargando bandeja de pagos...</div>
              ) : pendientes.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500 text-xs">
                  ✓ No hay pagos pendientes por conciliar. Todos los pagos están al día.
                </div>
              ) : (
                <div className="max-h-96 overflow-y-auto rounded-xl border border-slate-200">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 text-[10px] font-black uppercase text-slate-600 border-b border-slate-200">
                      <tr>
                        <th className="py-2 px-3">Fecha</th>
                        <th className="py-2 px-3">Cliente</th>
                        <th className="py-2 px-3">Método / Ref</th>
                        <th className="py-2 px-3 text-right">Monto Origen</th>
                        <th className="py-2 px-3 text-right">Abono Base</th>
                        <th className="py-2 px-3 text-center">Comprobante</th>
                        <th className="py-2 px-3 text-center">Decisión</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {pendientes.map((p) => (
                        <tr key={p.id} className="hover:bg-slate-50">
                          <td className="py-2.5 px-3 text-slate-500 whitespace-nowrap text-[10px]">
                            {new Date(p.created_at).toLocaleDateString("es-VE")}
                          </td>
                          <td className="py-2.5 px-3 font-bold text-slate-900">{p.cliente_nombre}</td>
                          <td className="py-2.5 px-3">
                            <span className="font-medium text-slate-800">{p.metodo_pago}</span>
                            <span className="block font-mono text-[10px] text-slate-500">Ref: #{p.referencia_bancaria}</span>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                            {formatearMontoSinMoneda(p.monto_moneda_origen)} {p.moneda_origen}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-black text-emerald-700">
                            {formatearMontoSinMoneda(p.monto_equivalente_base)}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <button
                              type="button"
                              onClick={() => setComprobanteZoomUrl(p.comprobante_url)}
                              className="rounded bg-indigo-50 px-2 py-1 text-[11px] font-bold text-indigo-700 hover:bg-indigo-100"
                            >
                              🖼️ Ver
                            </button>
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                type="button"
                                disabled={procesandoAccionId === p.id}
                                onClick={() => void handleAprobarPago(p)}
                                className="rounded bg-emerald-600 px-2.5 py-1 text-[10px] font-bold text-white hover:bg-emerald-700"
                              >
                                {procesandoAccionId === p.id ? "..." : "✓ Aprobar"}
                              </button>
                              <button
                                type="button"
                                disabled={procesandoAccionId === p.id}
                                onClick={() =>
                                  setMotivoRechazoInput({
                                    id: p.id,
                                    abierto: true,
                                    motivo: "",
                                  })
                                }
                                className="rounded bg-rose-50 px-2 py-1 text-[10px] font-bold text-rose-700 hover:bg-rose-100"
                              >
                                ✕
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal de Zoom para Comprobante */}
        {comprobanteZoomUrl && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
            onClick={() => setComprobanteZoomUrl(null)}
          >
            <div className="relative max-w-2xl max-h-[90vh] overflow-hidden rounded-xl bg-white p-2" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => setComprobanteZoomUrl(null)}
                className="absolute top-3 right-3 rounded-full bg-slate-900/80 p-1.5 text-white hover:bg-slate-900"
              >
                ✕
              </button>
              {comprobanteZoomUrl.startsWith("data:application/pdf") ? (
                <iframe src={comprobanteZoomUrl} className="w-full h-96 rounded" title="Comprobante PDF" />
              ) : (
                <img
                  src={comprobanteZoomUrl}
                  alt="Comprobante Zoom"
                  className="max-h-[85vh] w-auto mx-auto object-contain rounded"
                />
              )}
            </div>
          </div>
        )}

        {/* Modal Rechazo con Motivo */}
        {motivoRechazoInput.abierto && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-sm rounded-xl bg-white p-4 space-y-3">
              <h4 className="font-bold text-slate-900 text-xs">Motivo de Rechazo del Pago</h4>
              <textarea
                rows={3}
                required
                placeholder="Indica al cliente por qué no procede (referencia incorrecta, no aparece en cuenta, etc.)"
                value={motivoRechazoInput.motivo}
                onChange={(e) =>
                  setMotivoRechazoInput((prev) => ({ ...prev, motivo: e.target.value }))
                }
                className="w-full rounded border border-slate-300 p-2 text-xs text-slate-800"
              />
              <div className="flex justify-end gap-2 text-xs">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setMotivoRechazoInput({ id: "", abierto: false, motivo: "" })}
                >
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  className="bg-rose-600 hover:bg-rose-700"
                  onClick={() => void handleConfirmarRechazo()}
                  disabled={!motivoRechazoInput.motivo.trim()}
                >
                  Confirmar Rechazo
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
