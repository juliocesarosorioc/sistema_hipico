"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/shared/components/ui/Button";
import {
  subirComprobantePago,
  registrarPagoComprobante,
  type RegistroPagoInput,
} from "@/features/contabilidad/lib/pagos-comprobantes";
import { redondearCentavos, formatearMontoSinMoneda } from "@/shared/lib/dinero";
import { BANCOS_VZLA } from "@/shared/lib/vzla";

interface ModalReportarPagoClienteProps {
  abierto: boolean;
  onCerrar: () => void;
  clienteId: string;
  clienteNombre: string;
  grupoId?: string | null;
  tasaCambioDefault?: number;
  saldoActual?: number;
  onPagoReportado?: () => void;
}

const METODOS_PAGO = [
  { id: "PAGO_MOVIL", label: "📱 Pago Móvil (Bs.)", moneda: "VES" },
  { id: "TRANSFERENCIA", label: "🏦 Transferencia Bancaria (Bs.)", moneda: "VES" },
  { id: "ZELLE", label: "💵 Zelle (USD)", moneda: "USD" },
  { id: "BINANCE", label: "🟡 Binance Pay / USDT", moneda: "USDT" },
  { id: "EFECTIVO", label: "💵 Efectivo Divisas", moneda: "USD" },
  { id: "OTRO", label: "🔄 Otro Método", moneda: "VES" },
];

export function ModalReportarPagoCliente({
  abierto,
  onCerrar,
  clienteId,
  clienteNombre,
  grupoId,
  tasaCambioDefault = 1,
  saldoActual = 0,
  onPagoReportado,
}: ModalReportarPagoClienteProps) {
  const [metodo, setMetodo] = useState("PAGO_MOVIL");
  const [montoMoneda, setMontoMoneda] = useState("");
  const [tasa, setTasa] = useState<number>(tasaCambioDefault > 0 ? tasaCambioDefault : 1);
  const [bancoOrigen, setBancoOrigen] = useState("");
  const [bancoDestino, setBancoDestino] = useState("");
  const [referencia, setReferencia] = useState("");
  const [notas, setNotas] = useState("");

  const [archivo, setArchivo] = useState<File | Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [nombreArchivo, setNombreArchivo] = useState<string>("");
  const [pesoArchivo, setPesoArchivo] = useState<number>(0);

  const [enviando, setEnviando] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [exitoMsg, setExitoMsg] = useState<string>("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropAreaRef = useRef<HTMLDivElement>(null);

  const metodoObj = METODOS_PAGO.find((m) => m.id === metodo) || METODOS_PAGO[0];
  const esMonedaLocal = metodoObj.moneda === "VES";

  // Ajuste automático de tasa según método
  useEffect(() => {
    if (metodoObj.moneda === "USD" || metodoObj.moneda === "USDT") {
      setTasa(1);
    } else if (tasaCambioDefault > 1) {
      setTasa(tasaCambioDefault);
    }
  }, [metodo, metodoObj.moneda, tasaCambioDefault]);

  // Cálculo de monto equivalente base en tiempo real
  const montoNum = parseFloat(montoMoneda) || 0;
  const tasaNum = tasa > 0 ? tasa : 1;
  const montoEquivalente = redondearCentavos(montoNum / tasaNum);

  // Manejo de pegado desde el portapapeles (Ctrl+V)
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
            cargarArchivoSeleccionado(blob, `captura_${Date.now()}.png`);
            break;
          }
        }
      }
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [abierto]);

  const cargarArchivoSeleccionado = (f: File | Blob, customName?: string) => {
    setErrorMsg("");
    setArchivo(f);
    setNombreArchivo(customName || (f instanceof File ? f.name : "comprobante.jpg"));
    setPesoArchivo(f.size);

    if (f.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (e) => setPreviewUrl(String(e.target?.result || ""));
      reader.readAsDataURL(f);
    } else {
      setPreviewUrl("");
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) cargarArchivoSeleccionado(f);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const f = e.dataTransfer.files?.[0];
    if (f) cargarArchivoSeleccionado(f);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const limpiarFormulario = () => {
    setMontoMoneda("");
    setReferencia("");
    setBancoOrigen("");
    setBancoDestino("");
    setNotas("");
    setArchivo(null);
    setPreviewUrl("");
    setNombreArchivo("");
    setPesoArchivo(0);
    setErrorMsg("");
    setExitoMsg("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setExitoMsg("");

    if (!montoNum || montoNum <= 0) {
      setErrorMsg("Ingresa un monto válido mayor a 0.");
      return;
    }
    if (!referencia.trim()) {
      setErrorMsg("El número de referencia de la transferencia/pago es obligatorio.");
      return;
    }
    if (!archivo) {
      setErrorMsg("Adjunta la captura o comprobante de pago (puedes seleccionarlo, arrastrarlo o pegarlo con Ctrl+V).");
      return;
    }

    setEnviando(true);
    try {
      // 1. Subida del comprobante
      const subida = await subirComprobantePago(archivo, {
        nombreArchivo,
        clienteId,
        grupoId: grupoId || undefined,
      });

      // 2. Registro del pago
      const payload: RegistroPagoInput = {
        grupoId,
        clienteId,
        clienteNombre,
        direccionFlujo: "PAGO_DE_CLIENTE",
        metodoPago: metodo,
        bancoOrigen: bancoOrigen || undefined,
        bancoDestino: bancoDestino || undefined,
        referenciaBancaria: referencia.trim(),
        montoMonedaOrigen: montoNum,
        monedaOrigen: metodoObj.moneda,
        tasaCambio: tasaNum,
        comprobanteUrl: subida.url,
        comprobanteNombre: subida.nombre,
        comprobanteTipo: subida.tipo,
        comprobantePeso: subida.peso,
        notas: notas.trim() || undefined,
        registradoPor: "CLIENTE_PORTAL",
      };

      const res = await registrarPagoComprobante(payload);
      if (!res.ok) {
        setErrorMsg(res.error || "No se pudo registrar el comprobante de pago.");
        return;
      }

      setExitoMsg(
        `Tu comprobante de pago Ref. #${referencia} por ${formatearMontoSinMoneda(montoNum)} (${formatearMontoSinMoneda(montoEquivalente)} a favor) fue enviado con éxito y está en revisión por el operador.`
      );
      limpiarFormulario();
      onPagoReportado?.();
    } catch (err) {
      setErrorMsg((err as Error).message || "Ocurrió un error inesperado al procesar el pago.");
    } finally {
      setEnviando(false);
    }
  };

  if (!abierto) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden my-6">
        {/* Cabecera */}
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 px-6 py-4 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="text-2xl">💳</span>
            <div>
              <h3 className="text-base font-black tracking-wide">Reportar Pago / Subir Comprobante</h3>
              <p className="text-xs text-slate-300">
                {clienteNombre} · Saldo Actual:{" "}
                <span className={`font-mono font-bold ${saldoActual < 0 ? "text-rose-400" : "text-emerald-400"}`}>
                  {formatearMontoSinMoneda(saldoActual)}
                </span>
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

        {/* Mensajes de éxito o error */}
        {exitoMsg ? (
          <div className="p-6 text-center space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-600">
              ✓
            </div>
            <h4 className="text-base font-bold text-slate-900">¡Comprobante Enviado!</h4>
            <p className="text-xs text-slate-600 leading-relaxed">{exitoMsg}</p>
            <div className="pt-2">
              <Button
                variant="primary"
                onClick={() => {
                  setExitoMsg("");
                  onCerrar();
                }}
                className="w-full justify-center"
              >
                Entendido / Cerrar
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
            {errorMsg && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-rose-800 flex items-start gap-2">
                <span className="text-base shrink-0">⚠️</span>
                <span className="leading-snug">{errorMsg}</span>
              </div>
            )}

            {/* Método de Pago */}
            <div>
              <label className="block font-black text-slate-700 uppercase tracking-wider text-[10px] mb-1">
                Método de Pago
              </label>
              <select
                value={metodo}
                onChange={(e) => setMetodo(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-medium text-slate-800 focus:border-indigo-500 focus:outline-none"
              >
                {METODOS_PAGO.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Monto y Tasa de Cambio */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-black text-slate-700 uppercase tracking-wider text-[10px] mb-1">
                  Monto Pagado ({metodoObj.moneda})
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  placeholder="0.00"
                  value={montoMoneda}
                  onChange={(e) => setMontoMoneda(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono font-bold text-slate-900 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-black text-slate-700 uppercase tracking-wider text-[10px] mb-1">
                  {esMonedaLocal ? "Tasa de Cambio" : "Tasa (1.00)"}
                </label>
                <input
                  type="number"
                  step="0.0001"
                  min="0.0001"
                  disabled={!esMonedaLocal}
                  value={tasa}
                  onChange={(e) => setTasa(parseFloat(e.target.value) || 1)}
                  className={`w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-slate-800 ${
                    !esMonedaLocal ? "bg-slate-100 text-slate-400" : "bg-white"
                  }`}
                />
              </div>
            </div>

            {/* Resumen de Equivalencia a Abonar */}
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/70 p-3 flex items-center justify-between">
              <span className="font-medium text-indigo-950">Monto equivalente a abonar:</span>
              <span className="font-mono text-base font-black text-indigo-700">
                {formatearMontoSinMoneda(montoEquivalente)}
              </span>
            </div>

            {/* Bancos y Referencia */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-black text-slate-700 uppercase tracking-wider text-[10px] mb-1">
                  Banco Emisor (Tuyo)
                </label>
                <input
                  type="text"
                  placeholder="Ej: Banesco, Mercantil..."
                  value={bancoOrigen}
                  onChange={(e) => setBancoOrigen(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-800 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-black text-slate-700 uppercase tracking-wider text-[10px] mb-1">
                  Nº Referencia (Obligatorio)
                </label>
                <input
                  type="text"
                  required
                  placeholder="Últimos 4 a 8 dígitos"
                  value={referencia}
                  onChange={(e) => setReferencia(e.target.value.replace(/[^a-zA-Z0-9]/g, ""))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono font-bold text-slate-900 focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Zona de Arrastrar, Soltar y Pegar Captura (Ctrl+V) */}
            <div>
              <label className="block font-black text-slate-700 uppercase tracking-wider text-[10px] mb-1">
                Comprobante de Pago (Foto / Captura / PDF) *
              </label>
              <div
                ref={dropAreaRef}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onClick={() => fileInputRef.current?.click()}
                className={`group relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-4 text-center cursor-pointer transition ${
                  archivo ? "border-emerald-400 bg-emerald-50/30" : "border-slate-300 bg-slate-50 hover:bg-slate-100/70"
                }`}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept="image/png,image/jpeg,image/webp,application/pdf"
                  className="hidden"
                />

                {previewUrl ? (
                  <div className="space-y-2">
                    <img
                      src={previewUrl}
                      alt="Vista previa"
                      className="mx-auto max-h-36 rounded-lg object-contain shadow-sm border border-slate-200"
                    />
                    <div className="flex items-center justify-center gap-2">
                      <span className="text-[11px] font-medium text-emerald-800 font-mono">
                        {nombreArchivo} ({(pesoArchivo / 1024).toFixed(0)} KB)
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setArchivo(null);
                          setPreviewUrl("");
                          setNombreArchivo("");
                        }}
                        className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 hover:bg-rose-200"
                      >
                        Cambiar
                      </button>
                    </div>
                  </div>
                ) : archivo ? (
                  <div className="space-y-1">
                    <span className="text-3xl">📄</span>
                    <p className="font-bold text-slate-800">{nombreArchivo}</p>
                    <p className="text-[10px] text-slate-500">{(pesoArchivo / 1024).toFixed(0)} KB</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <span className="text-3xl transition-transform group-hover:scale-110">📸</span>
                    <p className="font-bold text-slate-800">
                      Toca para elegir foto, arrastra aquí o presiona <span className="rounded bg-slate-200 px-1 font-mono text-[10px]">Ctrl+V</span>
                    </p>
                    <p className="text-[10px] text-slate-500">Formatos soportados: JPG, PNG, WEBP o PDF (Max 10MB)</p>
                  </div>
                )}
              </div>
            </div>

            {/* Observación Opcional */}
            <div>
              <label className="block font-black text-slate-700 uppercase tracking-wider text-[10px] mb-1">
                Nota u Observación (Opcional)
              </label>
              <input
                type="text"
                placeholder="Ej: Pago de cuota semanal, saldo recarga..."
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-slate-800 focus:border-indigo-500 focus:outline-none"
              />
            </div>

            {/* Botones de Acción */}
            <div className="pt-2 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={onCerrar}
                disabled={enviando}
                className="rounded-lg border border-slate-300 px-4 py-2 font-bold text-slate-700 hover:bg-slate-100 transition"
              >
                Cancelar
              </button>
              <Button
                type="submit"
                variant="primary"
                disabled={enviando || !montoNum || !referencia.trim() || !archivo}
                className="px-5 py-2 font-black tracking-wide"
              >
                {enviando ? "Subiendo Comprobante..." : "Enviar Comprobante"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
