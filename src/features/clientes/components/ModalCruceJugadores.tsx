"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { Button } from "@/shared/components/ui/Button";
import {
  registrarCruceJugadores,
  type CruceJugadoresResultado,
} from "@/features/contabilidad/lib/cruces-jugadores";
import { esSinTope } from "@/features/taquilla/lib/reparto";

export type ClienteRefCruce = {
  id: string | number;
  nombre?: string | null;
  seudonimo?: string | null;
  saldo_actual?: number | string | null;
  aval?: number | string | null;
  libre?: boolean | null;
  modo_juego?: string | null;
};

type Props = {
  abierto: boolean;
  onCerrar: () => void;
  clientes: ClienteRefCruce[];
  clienteEmisorInicialId?: string | number | null;
  onCruceExitoso?: (res: CruceJugadoresResultado) => void;
};

const toast = (msg: string, tipo: "success" | "warning" | "error" | "info" = "info") => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));
  }
};

/**
 * Comprime la imagen del capture a JPEG 0.78 para optimizar almacenamiento y velocidad.
 */
function comprimirCapture(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer la imagen"));
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const img = new Image();
      img.onerror = () => resolve(dataUrl);
      img.onload = () => {
        try {
          const maxDim = 1200;
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) return resolve(dataUrl);
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

/**
 * Modal compacto para realizar cruces de saldo entre jugadores con partida doble
 * y comprobante obligatorio de capture de pantalla.
 */
export function ModalCruceJugadores({
  abierto,
  onCerrar,
  clientes,
  clienteEmisorInicialId,
  onCruceExitoso,
}: Props) {
  const [emisorId, setEmisorId] = useState<string>("");
  const [receptorId, setReceptorId] = useState<string>("");
  const [monto, setMonto] = useState<string>("");
  const [nota, setNota] = useState<string>("");
  const [captureDataUrl, setCaptureDataUrl] = useState<string>("");
  const [nombreArchivo, setNombreArchivo] = useState<string>("");
  const [guardando, setGuardando] = useState(false);
  const [busquedaEmisor, setBusquedaEmisor] = useState("");
  const [busquedaReceptor, setBusquedaReceptor] = useState("");
  const [desplegarEmisor, setDesplegarEmisor] = useState(false);
  const [desplegarReceptor, setDesplegarReceptor] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Inicializar o resetear campos
  useEffect(() => {
    if (abierto) {
      setEmisorId(clienteEmisorInicialId ? String(clienteEmisorInicialId) : "");
      setReceptorId("");
      setMonto("");
      setNota("");
      setCaptureDataUrl("");
      setNombreArchivo("");
      setBusquedaEmisor("");
      setBusquedaReceptor("");
      setDesplegarEmisor(false);
      setDesplegarReceptor(false);
      setGuardando(false);
    }
  }, [abierto, clienteEmisorInicialId]);

  // Soporte para pegar capturas directamente con Ctrl+V
  useEffect(() => {
    if (!abierto) return;
    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith("image/")) {
          const file = items[i].getAsFile();
          if (file) {
            try {
              const b64 = await comprimirCapture(file);
              setCaptureDataUrl(b64);
              setNombreArchivo("capture-pegado.jpg");
              toast("Capture de pantalla pegado desde el portapapeles.", "success");
            } catch {
              toast("No se pudo procesar la imagen pegada.", "error");
            }
          }
          break;
        }
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [abierto]);

  const emisorSel = useMemo(
    () => clientes.find((c) => String(c.id) === String(emisorId)),
    [clientes, emisorId]
  );
  const receptorSel = useMemo(
    () => clientes.find((c) => String(c.id) === String(receptorId)),
    [clientes, receptorId]
  );

  const saldoEmisor = Number(emisorSel?.saldo_actual ?? 0);
  const avalEmisor = Number(emisorSel?.aval ?? 0);
  const esLibreEmisor = esSinTope(emisorSel);
  const disponibleEmisor = esLibreEmisor ? Number.POSITIVE_INFINITY : saldoEmisor + avalEmisor;

  const saldoReceptor = Number(receptorSel?.saldo_actual ?? 0);

  const montoNum = Number(monto) || 0;
  const montoInvalido = !(montoNum > 0);
  const saldoInsuficiente = !esLibreEmisor && montoNum > disponibleEmisor;

  const handleArchivoSeleccionado = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast("El archivo debe ser una imagen (PNG, JPG, WEBP).", "warning");
      return;
    }
    try {
      const b64 = await comprimirCapture(file);
      setCaptureDataUrl(b64);
      setNombreArchivo(file.name);
      toast("Capture cargado correctamente.", "success");
    } catch {
      toast("Error al leer el archivo de imagen.", "error");
    }
  };

  const handleIntercambiar = () => {
    const temp = emisorId;
    setEmisorId(receptorId);
    setReceptorId(temp);
  };

  const handleConfirmar = async () => {
    if (!emisorId) return toast("Selecciona el jugador que emite (transfiere).", "warning");
    if (!receptorId) return toast("Selecciona el jugador que recibe.", "warning");
    if (emisorId === receptorId) return toast("No puedes transferir al mismo jugador.", "warning");
    if (montoInvalido) return toast("Ingresa un monto válido mayor a $0.", "warning");
    if (saldoInsuficiente) {
      return toast(
        `Saldo insuficiente. El jugador emisor solo tiene $${disponibleEmisor.toFixed(2)} disponible.`,
        "error"
      );
    }
    if (!captureDataUrl) {
      return toast("Debes adjuntar el capture del mensaje que autoriza el cruce.", "warning");
    }

    setGuardando(true);
    const nombreEmisor = emisorSel?.seudonimo?.trim() || emisorSel?.nombre?.trim() || "Emisor";
    const nombreReceptor = receptorSel?.seudonimo?.trim() || receptorSel?.nombre?.trim() || "Receptor";

    const res = await registrarCruceJugadores({
      emisorId,
      emisorNombre: nombreEmisor,
      receptorId,
      receptorNombre: nombreReceptor,
      monto: montoNum,
      captureSoporte: captureDataUrl,
      nota,
    });

    setGuardando(false);
    if (!res.ok) {
      toast(res.error || "No se pudo realizar el cruce.", "error");
      return;
    }

    toast(
      `✅ Cruce exitoso: $${montoNum.toFixed(2)} transferidos de ${nombreEmisor} a ${nombreReceptor}.`,
      "success"
    );
    if (onCruceExitoso) onCruceExitoso(res);
    onCerrar();
  };

  if (!abierto) return null;

  const clientesFiltradosEmisor = clientes.filter((c) => {
    if (!busquedaEmisor.trim()) return true;
    const term = busquedaEmisor.toLowerCase();
    const nom = (c.nombre ?? "").toLowerCase();
    const seu = (c.seudonimo ?? "").toLowerCase();
    return nom.includes(term) || seu.includes(term);
  });

  const clientesFiltradosReceptor = clientes.filter((c) => {
    if (String(c.id) === String(emisorId)) return false;
    if (!busquedaReceptor.trim()) return true;
    const term = busquedaReceptor.toLowerCase();
    const nom = (c.nombre ?? "").toLowerCase();
    const seu = (c.seudonimo ?? "").toLowerCase();
    return nom.includes(term) || seu.includes(term);
  });

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-3 sm:p-4 backdrop-blur-xs animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && !guardando) onCerrar();
      }}
    >
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden border border-slate-200 flex flex-col max-h-[95vh]">
        {/* Cabecera */}
        <div className="bg-amber-600 px-5 py-3.5 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xl">🔀</span>
            <div>
              <h2 className="text-sm font-black uppercase tracking-wide leading-none">
                Cruce entre Jugadores
              </h2>
              <p className="text-[11px] text-amber-100 font-semibold mt-1">
                Transferencia P2P · Partida y contrapartida contable
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            disabled={guardando}
            className="text-amber-200 hover:text-white rounded-lg p-1 text-sm font-black transition-colors"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        {/* Cuerpo */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 text-slate-800 text-xs">
          {/* SECCIÓN JUGADORES (EMISOR Y RECEPTOR) */}
          <div className="space-y-3">
            {/* Jugador Emisor */}
            <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-3 relative">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[10px] font-black uppercase tracking-wider text-rose-900 flex items-center gap-1">
                  <span>📤</span> Jugador que Emite (Debita saldo)
                </label>
                {emisorSel && (
                  <span className="font-mono text-[10px] font-black text-rose-800">
                    {esLibreEmisor
                      ? "⚡ Libre (Sin tope)"
                      : `Disponible: $${disponibleEmisor.toFixed(2)} USD`}
                  </span>
                )}
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setDesplegarEmisor(!desplegarEmisor);
                    setDesplegarReceptor(false);
                  }}
                  className="w-full text-left bg-white border border-rose-300 rounded-lg px-3 py-2 text-xs font-bold text-slate-900 flex items-center justify-between shadow-inner"
                >
                  <span>
                    {emisorSel
                      ? `${emisorSel.seudonimo ? `[${emisorSel.seudonimo}] ` : ""}${emisorSel.nombre}`
                      : "— Seleccionar Jugador Emisor —"}
                  </span>
                  <span className="text-slate-400 text-[10px]">▼</span>
                </button>

                {desplegarEmisor && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-300 rounded-xl shadow-xl z-20 max-h-48 overflow-y-auto p-1.5">
                    <input
                      type="text"
                      value={busquedaEmisor}
                      onChange={(e) => setBusquedaEmisor(e.target.value)}
                      placeholder="Buscar por seudónimo o nombre..."
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs outline-none mb-1 font-semibold"
                      autoFocus
                    />
                    {clientesFiltradosEmisor.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setEmisorId(String(c.id));
                          setDesplegarEmisor(false);
                          if (String(c.id) === receptorId) setReceptorId("");
                        }}
                        className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs flex items-center justify-between hover:bg-rose-50 ${
                          String(c.id) === emisorId ? "bg-rose-100 font-bold" : ""
                        }`}
                      >
                        <span className="truncate">
                          {c.seudonimo ? `[${c.seudonimo}] ` : ""}
                          {c.nombre}
                        </span>
                        <span className="text-[10px] font-mono text-slate-500 shrink-0 ml-2">
                          ${Number(c.saldo_actual ?? 0).toFixed(2)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Botón central para intercambiar */}
            <div className="flex justify-center -my-1">
              <button
                type="button"
                onClick={handleIntercambiar}
                className="bg-white border border-slate-300 rounded-full p-1.5 shadow-sm text-slate-600 hover:text-amber-700 hover:border-amber-400 transition-colors text-xs"
                title="Intercambiar emisor y receptor"
              >
                🔄 Intercambiar
              </button>
            </div>

            {/* Jugador Receptor */}
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 relative">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[10px] font-black uppercase tracking-wider text-emerald-900 flex items-center gap-1">
                  <span>📥</span> Jugador que Recibe (Acredita saldo)
                </label>
                {receptorSel && (
                  <span className="font-mono text-[10px] font-black text-emerald-800">
                    Saldo actual: ${saldoReceptor.toFixed(2)} USD
                  </span>
                )}
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setDesplegarReceptor(!desplegarReceptor);
                    setDesplegarEmisor(false);
                  }}
                  className="w-full text-left bg-white border border-emerald-300 rounded-lg px-3 py-2 text-xs font-bold text-slate-900 flex items-center justify-between shadow-inner"
                >
                  <span>
                    {receptorSel
                      ? `${receptorSel.seudonimo ? `[${receptorSel.seudonimo}] ` : ""}${receptorSel.nombre}`
                      : "— Seleccionar Jugador Receptor —"}
                  </span>
                  <span className="text-slate-400 text-[10px]">▼</span>
                </button>

                {desplegarReceptor && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-300 rounded-xl shadow-xl z-20 max-h-48 overflow-y-auto p-1.5">
                    <input
                      type="text"
                      value={busquedaReceptor}
                      onChange={(e) => setBusquedaReceptor(e.target.value)}
                      placeholder="Buscar por seudónimo o nombre..."
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs outline-none mb-1 font-semibold"
                      autoFocus
                    />
                    {clientesFiltradosReceptor.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setReceptorId(String(c.id));
                          setDesplegarReceptor(false);
                        }}
                        className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs flex items-center justify-between hover:bg-emerald-50 ${
                          String(c.id) === receptorId ? "bg-emerald-100 font-bold" : ""
                        }`}
                      >
                        <span className="truncate">
                          {c.seudonimo ? `[${c.seudonimo}] ` : ""}
                          {c.nombre}
                        </span>
                        <span className="text-[10px] font-mono text-slate-500 shrink-0 ml-2">
                          ${Number(c.saldo_actual ?? 0).toFixed(2)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* MONTO A TRANSFERIR */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-700">
                Monto a Transferir ($ USD)
              </label>
              {emisorSel && !esLibreEmisor && saldoEmisor > 0 && (
                <button
                  type="button"
                  onClick={() => setMonto(String(saldoEmisor))}
                  className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800"
                >
                  Todo el saldo (${saldoEmisor.toFixed(2)})
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-400 text-base">$</span>
              <input
                type="number"
                step="any"
                min="0.01"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                placeholder="0.00"
                className={`w-full rounded-lg border px-3 py-2 font-mono text-base font-black text-slate-900 bg-white outline-none ${
                  saldoInsuficiente ? "border-rose-500 bg-rose-50" : "border-slate-300 focus:border-amber-500"
                }`}
              />
            </div>

            {/* Atajos rápidos de monto */}
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              {[10, 20, 50, 100, 200, 500].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setMonto(String(v))}
                  className="rounded bg-white border border-slate-200 px-2 py-0.5 text-[10px] font-mono font-bold text-slate-700 hover:bg-amber-50 hover:border-amber-300"
                >
                  +${v}
                </button>
              ))}
            </div>

            {saldoInsuficiente && (
              <p className="mt-1.5 text-[10.5px] font-bold text-rose-600">
                ⚠️ El monto supera el disponible del jugador emisor (${disponibleEmisor.toFixed(2)} USD).
              </p>
            )}
          </div>

          {/* SOPORTE / CAPTURE DE PANTALLA (OBLIGATORIO) */}
          <div className="rounded-xl border border-amber-300 bg-amber-50/50 p-3">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] font-black uppercase tracking-wider text-amber-950 flex items-center gap-1">
                <span>📸</span> Capture del Mensaje / Soporte (Obligatorio)
              </label>
              <span className="text-[9.5px] font-bold text-amber-800">
                Sube o pega con Ctrl+V
              </span>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleArchivoSeleccionado}
            />

            {!captureDataUrl ? (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-amber-300 hover:border-amber-500 rounded-xl p-4 text-center cursor-pointer bg-white transition-colors flex flex-col items-center justify-center gap-1.5"
              >
                <span className="text-2xl">📱</span>
                <span className="text-xs font-bold text-amber-900">
                  Haz clic para subir el capture del mensaje
                </span>
                <span className="text-[10px] text-slate-400">
                  o haz una captura en tu celular y pulsa Ctrl+V aquí
                </span>
              </div>
            ) : (
              <div className="relative rounded-xl border border-amber-300 bg-white p-2 flex items-center gap-3">
                <img
                  src={captureDataUrl}
                  alt="Soporte cruce"
                  className="h-16 w-16 object-cover rounded-lg border border-slate-200 shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-slate-800 truncate">
                    {nombreArchivo || "Comprobante cargado"}
                  </p>
                  <p className="text-[10px] text-emerald-600 font-semibold mt-0.5">
                    ✓ Imagen verificada y lista para registro
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setCaptureDataUrl("");
                    setNombreArchivo("");
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                  className="text-slate-400 hover:text-rose-600 p-1 text-sm font-bold"
                  title="Eliminar capture"
                >
                  ✕
                </button>
              </div>
            )}
          </div>

          {/* NOTA OPCIONAL */}
          <div>
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 block mb-1">
              Nota o Referencia (Opcional)
            </label>
            <input
              type="text"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Ej. Autorización de pase de saldo por WhatsApp..."
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-medium text-slate-800 outline-none focus:border-amber-500"
            />
          </div>

          {/* RESUMEN CONTABLE (PARTIDA Y CONTRAPARTIDA) */}
          {montoNum > 0 && emisorSel && receptorSel && (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-3 space-y-1.5 text-[11px]">
              <div className="flex items-center justify-between font-black text-indigo-950 uppercase text-[10px]">
                <span>⚖️ Asiento de Partida Doble</span>
                <span className="text-emerald-700">Cuadrado (0.00)</span>
              </div>
              <div className="flex justify-between items-center font-mono">
                <span className="text-rose-700">
                  DEBE: {emisorSel.seudonimo || emisorSel.nombre}
                </span>
                <span className="font-bold text-rose-700">-${montoNum.toFixed(2)} USD</span>
              </div>
              <div className="flex justify-between items-center font-mono">
                <span className="text-emerald-700">
                  HABER: {receptorSel.seudonimo || receptorSel.nombre}
                </span>
                <span className="font-bold text-emerald-700">+${montoNum.toFixed(2)} USD</span>
              </div>
            </div>
          )}
        </div>

        {/* Barra de Acciones */}
        <div className="bg-slate-50 px-5 py-3.5 border-t border-slate-200 flex items-center justify-end gap-2 shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCerrar}
            disabled={guardando}
            className="text-xs"
          >
            Cancelar
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={handleConfirmar}
            disabled={
              guardando ||
              !emisorId ||
              !receptorId ||
              montoInvalido ||
              saldoInsuficiente ||
              !captureDataUrl
            }
            className="bg-amber-600 hover:bg-amber-500 text-white font-black text-xs px-4 py-2 flex items-center gap-1.5 shadow-md disabled:opacity-50"
          >
            <span>{guardando ? "⏳" : "🔀"}</span>
            <span>{guardando ? "Registrando Cruce..." : "Confirmar Cruce de Saldo"}</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
