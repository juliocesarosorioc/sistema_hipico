"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { listarClientesVenta, grupoDeVentaVigente, type ClienteVenta } from "@/features/grupos/lib/grupos";
import {
  CONCEPTO_RESUMEN_DUENO,
  registrarMovimientoSaldoOperador,
  type TipoMovimientoOperador,
} from "@/features/contabilidad/lib/movimientos-operador";
import { emitirToast } from "@/shared/lib/mensajeria";

type Props = {
  abierto: boolean;
  onCerrar: () => void;
  onRegistrado?: () => void;
  onGuardado?: () => void;
};

/** Comprime el archivo de imagen a JPEG DataURL para adjuntarlo de forma rápida y liviana. */
async function comprimirCaptureADataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      if (typeof window === "undefined") {
        resolve(dataUrl);
        return;
      }
      const img = new window.Image();
      img.onerror = () => resolve(dataUrl);
      img.onload = () => {
        try {
          const maxDim = 1100;
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            const ratio = Math.min(maxDim / width, maxDim / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve(dataUrl);
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", 0.78));
        } catch {
          resolve(dataUrl);
        }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

export function ModalGestionRapidaSaldo({ abierto, onCerrar, onRegistrado, onGuardado }: Props) {
  const [clientes, setClientes] = useState<ClienteVenta[]>([]);
  const [cargandoClientes, setCargandoClientes] = useState(false);
  const [busquedaCliente, setBusquedaCliente] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [mostrarSugerencias, setMostrarSugerencias] = useState(false);
  const [tipo, setTipo] = useState<TipoMovimientoOperador>("INGRESO");
  const [monto, setMonto] = useState("");
  const [captureDataUrl, setCaptureDataUrl] = useState("");
  const [nombreArchivo, setNombreArchivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!abierto) return;
    setError(null);
    setCargandoClientes(true);
    listarClientesVenta()
      .then((lista) => {
        setClientes(lista);
      })
      .catch(() => {
        setClientes([]);
      })
      .finally(() => {
        setCargandoClientes(false);
      });
  }, [abierto]);

  useEffect(() => {
    if (!abierto) return;
    const onPaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const f = item.getAsFile();
          if (f) {
            e.preventDefault();
            const url = await comprimirCaptureADataUrl(f);
            setCaptureDataUrl(url);
            setNombreArchivo(f.name || "capture-pegado.jpg");
            setError(null);
            emitirToast("📸 Capture de comprobante pegado desde el portapapeles.", "info");
            break;
          }
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [abierto]);

  const clienteSeleccionado = useMemo(
    () => clientes.find((c) => String(c.id) === String(clienteId)) ?? null,
    [clientes, clienteId]
  );

  const clientesFiltrados = useMemo(() => {
    const q = busquedaCliente.trim().toUpperCase();
    if (!q) return clientes.slice(0, 30);
    return clientes
      .filter((c) => String(c.nombre ?? "").toUpperCase().includes(q))
      .slice(0, 30);
  }, [clientes, busquedaCliente]);

  if (!abierto) return null;

  const manejarArchivo = async (f: File | null | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setError("⚠️ El archivo debe ser una imagen (capture de pantalla del comprobante).");
      return;
    }
    try {
      const url = await comprimirCaptureADataUrl(f);
      setCaptureDataUrl(url);
      setNombreArchivo(f.name);
      setError(null);
    } catch {
      setError("⚠️ No se pudo procesar la imagen del comprobante.");
    }
  };

  const limpiar = () => {
    setBusquedaCliente("");
    setClienteId("");
    setMonto("");
    setCaptureDataUrl("");
    setNombreArchivo("");
    setError(null);
    setTipo("INGRESO");
  };

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cli =
      clienteSeleccionado ??
      clientes.find((c) => c.nombre.trim().toUpperCase() === busquedaCliente.trim().toUpperCase()) ??
      null;

    if (!cli) {
      setError("⚠️ Seleccione un cliente de la lista.");
      return;
    }
    const montoNum = parseFloat(String(monto).replace(",", "."));
    if (!Number.isFinite(montoNum) || montoNum <= 0) {
      setError("⚠️ Ingrese un monto válido mayor a $0.");
      return;
    }
    if (!captureDataUrl) {
      setError("⚠️ Debe anexar el capture de pantalla (imagen) del comprobante.");
      return;
    }

    setGuardando(true);
    try {
      const res = await registrarMovimientoSaldoOperador({
        cliente_id: String(cli.id),
        cliente_nombre: cli.nombre,
        grupo_id: grupoDeVentaVigente() || (cli.grupo_id ? String(cli.grupo_id) : null),
        tipo,
        monto: montoNum,
        comprobante_imagen: captureDataUrl,
      });

      if (!res.ok) {
        setError(`❌ ${res.error ?? "No se pudo registrar el movimiento."}`);
        return;
      }

      emitirToast(
        `✅ ${tipo === "INGRESO" ? "Saldo incrementado" : "Saldo disminuido"} a ${cli.nombre}: $${
          res.saldo_anterior?.toFixed(2) ?? "0.00"
        } → $${res.saldo_nuevo?.toFixed(2) ?? "0.00"} (Reportado al administrador como pendiente por completar datos).`,
        "success"
      );
      limpiar();
      onRegistrado?.();
      onGuardado?.();
      onCerrar();
    } finally {
      setGuardando(false);
    }
  };

  const montoPreview = parseFloat(String(monto).replace(",", ".")) || 0;
  const saldoActualNum = Number(clienteSeleccionado?.saldo_actual ?? 0);
  const saldoProyectado =
    tipo === "INGRESO" ? saldoActualNum + montoPreview : saldoActualNum - montoPreview;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs"
      onClick={() => !guardando && onCerrar()}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera */}
        <div className="flex items-center justify-between bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 px-5 py-3.5 text-white">
          <div>
            <span className="inline-block rounded-full bg-amber-400/20 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-amber-300 ring-1 ring-amber-400/40">
              ⚡ Vista de Operador · Resumen Dueño del Grupo
            </span>
            <h3 className="mt-1 text-base font-black tracking-tight">
              💵 Gestión Rápida de Saldos de Clientes
            </h3>
          </div>
          <button
            type="button"
            disabled={guardando}
            onClick={onCerrar}
            className="rounded-lg bg-white/10 px-2.5 py-1 text-xs font-bold text-slate-200 hover:bg-white/20"
          >
            ✕
          </button>
        </div>

        <form onSubmit={guardar} className="space-y-4 p-5">
          <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-3.5 py-2.5 text-[11px] text-amber-950">
            <p className="font-black">📋 {CONCEPTO_RESUMEN_DUENO}</p>
            <p className="mt-0.5 text-amber-800">
              Cargue únicamente el <strong>saldo</strong> y anexe el <strong>capture de pantalla del comprobante</strong>. El movimiento se reporta automáticamente al administrador del grupo como <em>pendiente por registrar banco, referencia y día</em>.
            </p>
          </div>

          {/* 1. Acción: Incrementar o Disminuir */}
          <div>
            <label className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-slate-600">
              1. Operación sobre el Saldo
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setTipo("INGRESO")}
                className={`flex items-center justify-center gap-2 rounded-xl border-2 px-3 py-2.5 text-xs font-black transition ${
                  tipo === "INGRESO"
                    ? "border-emerald-600 bg-emerald-600 text-white shadow-md shadow-emerald-600/25"
                    : "border-slate-200 bg-slate-50 text-slate-700 hover:border-emerald-300 hover:bg-emerald-50"
                }`}
              >
                <span>➕</span> Incrementar Saldo (Ingreso)
              </button>
              <button
                type="button"
                onClick={() => setTipo("EGRESO")}
                className={`flex items-center justify-center gap-2 rounded-xl border-2 px-3 py-2.5 text-xs font-black transition ${
                  tipo === "EGRESO"
                    ? "border-rose-600 bg-rose-600 text-white shadow-md shadow-rose-600/25"
                    : "border-slate-200 bg-slate-50 text-slate-700 hover:border-rose-300 hover:bg-rose-50"
                }`}
              >
                <span>➖</span> Disminuir Saldo (Egreso)
              </button>
            </div>
          </div>

          {/* 2. Cliente (búsqueda al escribir) */}
          <div className="relative">
            <label className="mb-1 block text-[11px] font-black uppercase tracking-wider text-slate-600">
              2. Cliente {cargandoClientes ? "(Cargando...)" : ""}
            </label>
            <input
              type="text"
              value={busquedaCliente}
              onFocus={() => setMostrarSugerencias(true)}
              onChange={(e) => {
                setBusquedaCliente(e.target.value);
                setClienteId("");
                setMostrarSugerencias(true);
              }}
              placeholder="Escriba el nombre del cliente..."
              className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-500/20"
            />
            {mostrarSugerencias && clientesFiltrados.length > 0 && !clienteSeleccionado && (
              <div className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
                {clientesFiltrados.map((c) => {
                  const s = Number(c.saldo_actual ?? 0);
                  return (
                    <button
                      key={String(c.id)}
                      type="button"
                      onClick={() => {
                        setClienteId(String(c.id));
                        setBusquedaCliente(c.nombre);
                        setMostrarSugerencias(false);
                      }}
                      className="flex w-full items-center justify-between border-b border-slate-100 px-3.5 py-2 text-left text-xs font-bold hover:bg-indigo-50"
                    >
                      <span className="text-slate-900">{c.nombre}</span>
                      <span className={s >= 0 ? "text-emerald-700" : "text-rose-600"}>
                        Saldo: ${s.toFixed(2)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {clienteSeleccionado && (
              <div className="mt-1.5 flex items-center justify-between rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700">
                <span>
                  Cliente: <strong className="text-slate-900">{clienteSeleccionado.nombre}</strong>
                </span>
                <span>
                  Actual:{" "}
                  <strong className={saldoActualNum >= 0 ? "text-emerald-700" : "text-rose-600"}>
                    ${saldoActualNum.toFixed(2)}
                  </strong>
                  {montoPreview > 0 && (
                    <>
                      {" "}→ Nuevo:{" "}
                      <strong className={saldoProyectado >= 0 ? "text-indigo-700" : "text-rose-700"}>
                        ${saldoProyectado.toFixed(2)}
                      </strong>
                    </>
                  )}
                </span>
              </div>
            )}
          </div>

          {/* 3. Monto */}
          <div>
            <label className="mb-1 block text-[11px] font-black uppercase tracking-wider text-slate-600">
              3. Monto a {tipo === "INGRESO" ? "Incrementar (+)" : "Disminuir (-)"}
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              placeholder="Ej: 100.00"
              className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-base font-black text-slate-900 outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>

          {/* 4. Capture de pantalla del comprobante */}
          <div>
            <label className="mb-1 block text-[11px] font-black uppercase tracking-wider text-slate-600">
              4. Capture de Pantalla (Imagen del Comprobante) *
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => void manejarArchivo(e.target.files?.[0])}
            />
            {!captureDataUrl ? (
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  void manejarArchivo(e.dataTransfer.files?.[0]);
                }}
                className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-indigo-300 bg-indigo-50/40 px-4 py-5 text-center transition hover:border-indigo-500 hover:bg-indigo-50"
              >
                <span className="text-2xl">📸</span>
                <p className="mt-1 text-xs font-black text-indigo-950">
                  Haga clic para subir imagen, arrastre el capture o presione Ctrl+V
                </p>
                <p className="mt-0.5 text-[10px] font-semibold text-slate-500">
                  Único requisito de soporte para el administrador del grupo
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-emerald-300 bg-emerald-50/50 p-2.5">
                <div className="mb-2 flex items-center justify-between text-xs font-bold text-emerald-900">
                  <span className="truncate">✅ {nombreArchivo || "Capture adjunto"}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setCaptureDataUrl("");
                      setNombreArchivo("");
                    }}
                    className="rounded bg-rose-100 px-2 py-0.5 text-[10px] font-black text-rose-700 hover:bg-rose-200"
                  >
                    Cambiar imagen
                  </button>
                </div>
                <img
                  src={captureDataUrl}
                  alt="Capture de comprobante"
                  className="max-h-40 w-full rounded-lg border border-slate-200 bg-white object-contain"
                />
              </div>
            )}
          </div>

          {error && (
            <div className="rounded-xl border border-rose-300 bg-rose-50 px-3.5 py-2 text-xs font-bold text-rose-800">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2.5 border-t border-slate-100 pt-3">
            <button
              type="button"
              disabled={guardando}
              onClick={onCerrar}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={guardando}
              className={`rounded-xl px-5 py-2.5 text-xs font-black text-white shadow-md transition ${
                tipo === "INGRESO"
                  ? "bg-emerald-600 hover:bg-emerald-700"
                  : "bg-rose-600 hover:bg-rose-700"
              } disabled:opacity-50`}
            >
              {guardando
                ? "Procesando..."
                : tipo === "INGRESO"
                  ? "➕ Confirmar Incremento de Saldo"
                  : "➖ Confirmar Disminución de Saldo"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
export default ModalGestionRapidaSaldo;
