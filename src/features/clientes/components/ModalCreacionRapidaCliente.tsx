"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/shared/components/ui/Button";
import { codigosPaisUnicos, componerTelefono } from "@/shared/lib/vzla";
import { supabase } from "@/core/supabase";
import { emitirToast } from "@/shared/lib/mensajeria";
import { grupoDeVentaVigente, limpiarCacheClientesVenta } from "@/features/grupos/lib/grupos";
import { grupoActivoVigente, grupoVigente, usuarioVigente } from "@/features/seguridad/lib/vigente";
import { registrarMovimientoSaldoOperador } from "@/features/contabilidad/lib/movimientos-operador";
import { limpiarCacheClientes, listarClientes, type ClienteRow } from "@/features/clientes/lib/clientes";
import { redondearCentavos, formatearMontoSinMoneda } from "@/shared/lib/dinero";

interface Props {
  abierto: boolean;
  onClose: () => void;
  onClienteCreado?: (cliente: Partial<ClienteRow>) => void;
  grupoIdDefault?: string | null;
}

/** Comprime una captura de pantalla pegada o seleccionada a JPEG DataURL */
async function comprimirCapture(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer la imagen"));
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
          const maxDim = 1200;
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
          resolve(canvas.toDataURL("image/jpeg", 0.82));
        } catch {
          resolve(dataUrl);
        }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

export function ModalCreacionRapidaCliente({
  abierto,
  onClose,
  onClienteCreado,
  grupoIdDefault,
}: Props) {
  const [usuarioCodigo, setUsuarioCodigo] = useState("");
  const [codigoPais, setCodigoPais] = useState("+58");
  const [telefono, setTelefono] = useState("");
  const [saldoInicial, setSaldoInicial] = useState("");
  const [modoJuego, setModoJuego] = useState<"libre" | "aval">("libre");
  const [mensajeAutorizacion, setMensajeAutorizacion] = useState("");
  const [captureDataUrl, setCaptureDataUrl] = useState("");
  const [nombreArchivo, setNombreArchivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const inputUsuarioRef = useRef<HTMLInputElement | null>(null);

  // Auto-foco en el input de usuario al abrir
  useEffect(() => {
    if (abierto) {
      setTimeout(() => {
        inputUsuarioRef.current?.focus();
      }, 80);
    }
  }, [abierto]);

  // Listener para pegar capturas de pantalla de WhatsApp con Ctrl+V
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
            try {
              const url = await comprimirCapture(f);
              setCaptureDataUrl(url);
              setNombreArchivo(f.name || "captura-whatsapp.jpg");
              setError(null);
              emitirToast("📸 Captura de mensaje/autorización pegada del portapapeles.", "info");
            } catch {
              /* ignore */
            }
            break;
          }
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [abierto]);

  if (!abierto) return null;

  const handleArchivoSeleccionado = async (f: File | null | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setError("El comprobante o captura debe ser una imagen válida (PNG, JPG, WEBP).");
      return;
    }
    try {
      const url = await comprimirCapture(f);
      setCaptureDataUrl(url);
      setNombreArchivo(f.name);
      setError(null);
    } catch {
      setError("No se pudo procesar la imagen seleccionada.");
    }
  };

  const limpiarFormulario = () => {
    setUsuarioCodigo("");
    setCodigoPais("+58");
    setTelefono("");
    setSaldoInicial("");
    setModoJuego("libre");
    setMensajeAutorizacion("");
    setCaptureDataUrl("");
    setNombreArchivo("");
    setError(null);
  };

  const handleGuardar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const normUsuario = usuarioCodigo.trim().toUpperCase();
    if (!normUsuario) {
      setError("El usuario o código del cliente es obligatorio.");
      return;
    }

    const tlfLimpio = telefono.replace(/[^0-9]/g, "");
    if (!tlfLimpio) {
      setError("El número de teléfono móvil del cliente es obligatorio.");
      return;
    }

    const montoNum = parseFloat(saldoInicial.replace(",", ".")) || 0;
    if (montoNum < 0) {
      setError("El saldo a acreditar no puede ser negativo.");
      return;
    }

    // Si se acredita saldo inicial > 0, es obligatorio anexar el mensaje o comprobante de autorización
    if (montoNum > 0 && !mensajeAutorizacion.trim() && !captureDataUrl) {
      setError("Para acreditar saldo inicial debe incluir el mensaje o adjuntar la captura que lo autoriza.");
      return;
    }

    setGuardando(true);
    try {
      const grupoDestino =
        grupoIdDefault ||
        grupoDeVentaVigente() ||
        grupoActivoVigente() ||
        grupoVigente() ||
        null;

      // 1. Validar duplicados en el grupo
      const existentes = await listarClientes(true, grupoDestino);
      const existe = existentes.some((c) => {
        const mismoGrupo = !grupoDestino || !c.grupo_id || String(c.grupo_id) === String(grupoDestino);
        return mismoGrupo && String(c.nombre ?? "").trim().toUpperCase() === normUsuario;
      });

      if (existe) {
        setError(`⚠️ Ya existe un cliente con el código/usuario "${normUsuario}" en este grupo.`);
        setGuardando(false);
        return;
      }

      const tlfCompleto = componerTelefono(codigoPais, tlfLimpio);
      const operadorNombre = usuarioVigente() || "Operador";

      // 2. Crear cliente en la tabla clientes
      const clientePayload = {
        nombre: normUsuario,
        seudonimo: normUsuario,
        telefono: tlfCompleto,
        codigo_pais: codigoPais,
        saldo_actual: montoNum,
        saldo: montoNum,
        modo_juego: modoJuego,
        libre: modoJuego === "libre",
        grupo_id: grupoDestino,
      };

      if (!supabase) {
        setError("Sin conexión a la base de datos.");
        setGuardando(false);
        return;
      }

      const { data: nuevoCli, error: errInsert } = await supabase
        .from("clientes")
        .insert([clientePayload])
        .select("id, nombre, saldo_actual, grupo_id")
        .maybeSingle();

      if (errInsert || !nuevoCli) {
        setError(`Error al registrar el cliente: ${errInsert?.message || "No se pudo insertar"}`);
        setGuardando(false);
        return;
      }

      const clienteIdGenerado = String(nuevoCli.id);

      // 3. Si se acreditó saldo inicial > 0, registrar trazabilidad y movimiento de operador
      if (montoNum > 0) {
        if (captureDataUrl) {
          try {
            await registrarMovimientoSaldoOperador({
              cliente_id: clienteIdGenerado,
              cliente_nombre: normUsuario,
              grupo_id: grupoDestino,
              tipo: "INGRESO",
              monto: montoNum,
              comprobante_imagen: captureDataUrl,
            });
          } catch {
            /* ignore fallback */
          }
        }

        // Crear notificación formal para el Administrador
        try {
          await supabase.from("notificaciones").insert([
            {
              tipo: "alta_cliente_rapido",
              titulo: `👤 Alta rápida de cliente: ${normUsuario}`,
              mensaje: `El operador ${operadorNombre} dio de alta a ${normUsuario} (${tlfCompleto}) con saldo inicial de ${formatearMontoSinMoneda(montoNum)} USD. Autorización: "${mensajeAutorizacion.trim() || 'Comprobante adjunto'}"`,
              cliente_id: clienteIdGenerado,
              cliente_nombre: normUsuario,
              datos: {
                monto: montoNum,
                telefono: tlfCompleto,
                codigo_pais: codigoPais,
                autorizacion: mensajeAutorizacion.trim() || null,
                capture_url: captureDataUrl || null,
                operador: operadorNombre,
              },
              estado: "Pendiente",
            },
          ]);
        } catch {
          /* ignore */
        }
      }

      // Limpiar cachés para que aparezca inmediatamente en Apuestas y Clientes
      try {
        limpiarCacheClientes();
        limpiarCacheClientesVenta();
      } catch {
        /* ignore */
      }

      emitirToast(
        `✅ Cliente "${normUsuario}" creado exitosamente.${montoNum > 0 ? ` Saldo inicial: ${formatearMontoSinMoneda(montoNum)} USD.` : ""}`,
        "success"
      );

      onClienteCreado?.({
        id: clienteIdGenerado,
        nombre: normUsuario,
        seudonimo: normUsuario,
        telefono: tlfCompleto,
        saldo_actual: montoNum,
      });

      limpiarFormulario();
      onClose();
    } catch (err) {
      setError((err as Error).message || "Ocurrió un error inesperado.");
    } finally {
      setGuardando(false);
    }
  };

  const montoNumPreview = parseFloat(saldoInicial.replace(",", ".")) || 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !guardando) onClose();
      }}
    >
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-indigo-500/40 bg-slate-900 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        {/* Cabecera */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600/30 border border-indigo-400/40 text-indigo-300 text-lg">
              👤+
            </span>
            <div>
              <h3 className="text-sm font-black uppercase tracking-wider text-white">
                Creación Rápida de Cliente
              </h3>
              <p className="text-[11px] text-slate-400">
                Acceso del operador · Registro rápido de jugador y saldo autorizado
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={guardando}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white transition"
          >
            ✕
          </button>
        </div>

        {/* Formulario */}
        <form onSubmit={handleGuardar} className="p-5 space-y-4 max-h-[85vh] overflow-y-auto">
          {error && (
            <div className="rounded-xl border border-red-500/40 bg-red-950/40 p-3 text-xs text-red-300 flex items-start gap-2">
              <span className="text-base shrink-0">⚠️</span>
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {/* Usuario / Código */}
            <div>
              <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">
                Usuario / Código *
              </label>
              <input
                ref={inputUsuarioRef}
                type="text"
                required
                value={usuarioCodigo}
                onChange={(e) => setUsuarioCodigo(e.target.value.toUpperCase())}
                placeholder="EJ. LOLO, JUGADOR01"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-black uppercase text-amber-300 placeholder:text-slate-600 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
              />
              <span className="text-[9px] text-slate-500 mt-0.5 block">Identificador para jugadas</span>
            </div>

            {/* Modalidad de Juego */}
            <div>
              <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">
                Modalidad de Juego
              </label>
              <div className="flex gap-1.5 pt-0.5">
                <button
                  type="button"
                  onClick={() => setModoJuego("libre")}
                  className={`flex-1 rounded-lg border py-2 text-xs font-black transition ${
                    modoJuego === "libre"
                      ? "border-sky-400 bg-sky-600/30 text-sky-200"
                      : "border-slate-700 bg-slate-950 text-slate-400 hover:text-white"
                  }`}
                >
                  🔓 Libre
                </button>
                <button
                  type="button"
                  onClick={() => setModoJuego("aval")}
                  className={`flex-1 rounded-lg border py-2 text-xs font-black transition ${
                    modoJuego === "aval"
                      ? "border-amber-400 bg-amber-600/30 text-amber-200"
                      : "border-slate-700 bg-slate-950 text-slate-400 hover:text-white"
                  }`}
                >
                  🛡️ Aval
                </button>
              </div>
            </div>
          </div>

          {/* Teléfono WhatsApp */}
          <div>
            <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">
              Teléfono Móvil (WhatsApp) *
            </label>
            <div className="flex gap-2">
              <select
                value={codigoPais}
                onChange={(e) => setCodigoPais(e.target.value)}
                className="w-28 shrink-0 rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs font-bold text-slate-200 outline-none focus:border-indigo-400"
              >
                {codigosPaisUnicos().map((p) => (
                  <option key={p.codigo} value={p.codigo}>
                    {p.codigo} ({p.pais})
                  </option>
                ))}
              </select>
              <input
                type="tel"
                required
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                placeholder="412 123 4567"
                className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-bold text-white placeholder:text-slate-600 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
              />
            </div>
            <span className="text-[9px] text-slate-500 mt-0.5 block">Para envío de tickets y saldos por WhatsApp</span>
          </div>

          {/* Acreditación de Saldo Inicial */}
          <div className="rounded-xl border border-indigo-500/30 bg-indigo-950/30 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-black uppercase tracking-wider text-indigo-300">
                💰 Acreditación de Saldo Inicial (USD)
              </label>
              {montoNumPreview > 0 && (
                <span className="rounded-full bg-emerald-500/20 border border-emerald-400/40 px-2 py-0.5 text-[10px] font-black text-emerald-300">
                  +{formatearMontoSinMoneda(montoNumPreview)} a favor
                </span>
              )}
            </div>
            <input
              type="text"
              inputMode="decimal"
              value={saldoInicial}
              onChange={(e) => setSaldoInicial(e.target.value.replace(/[^0-9.,]/g, ""))}
              placeholder="0.00"
              className="w-full rounded-lg border border-indigo-400/40 bg-slate-950 px-3 py-2 font-mono text-base font-black text-emerald-400 placeholder:text-slate-600 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400"
            />
            <p className="text-[10px] text-slate-400">
              Coloque 0 si solo crea la cuenta sin saldo inicial.
            </p>
          </div>

          {/* Mensaje de autorización o solicitud */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                📝 Mensaje que lo autoriza o solicita {montoNumPreview > 0 ? "*" : "(Opcional)"}
              </label>
              <span className="text-[9px] text-slate-500">
                {montoNumPreview > 0 ? "Obligatorio para auditar saldo" : "Opcional"}
              </span>
            </div>
            <textarea
              rows={3}
              value={mensajeAutorizacion}
              onChange={(e) => setMensajeAutorizacion(e.target.value)}
              placeholder="Pegue aquí el mensaje de WhatsApp del cliente o banquero autorizando la creación y abono de saldo…"
              className="w-full resize-none rounded-lg border border-slate-700 bg-slate-950 p-2.5 text-xs text-slate-200 placeholder:text-slate-600 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 font-sans"
            />
          </div>

          {/* Anexar captura de pantalla (Archivo o Pegado con Ctrl+V) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                📸 Captura de WhatsApp / Comprobante (Ctrl+V)
              </span>
              {captureDataUrl && (
                <button
                  type="button"
                  onClick={() => {
                    setCaptureDataUrl("");
                    setNombreArchivo("");
                  }}
                  className="text-[10px] font-bold text-red-400 hover:underline"
                >
                  Quitar captura
                </button>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleArchivoSeleccionado(e.target.files?.[0])}
            />

            {!captureDataUrl ? (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-700 bg-slate-950/60 p-4 text-center transition hover:border-indigo-400 hover:bg-slate-950"
              >
                <span className="text-2xl mb-1">📋</span>
                <p className="text-xs font-bold text-slate-300">
                  Presiona <kbd className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-amber-300 font-mono">Ctrl+V</kbd> para pegar captura
                </p>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  o haz clic aquí para seleccionar una imagen desde tu equipo
                </p>
              </div>
            ) : (
              <div className="relative rounded-xl border border-emerald-500/40 bg-slate-950 p-2.5 flex items-center gap-3">
                <img
                  src={captureDataUrl}
                  alt="Comprobante"
                  className="h-14 w-14 rounded-lg object-cover border border-slate-700 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-xs font-black text-emerald-400">
                    <span>✅</span>
                    <span className="truncate">{nombreArchivo || "Captura pegada"}</span>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    Captura optimizada y lista para adjuntar al expediente.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Botones de acción */}
          <div className="flex items-center justify-end gap-2 border-t border-slate-800 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={guardando}
              className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-bold text-slate-300 hover:bg-slate-700 transition disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={guardando}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2 text-xs font-black uppercase tracking-wider text-white hover:bg-indigo-500 transition shadow-lg shadow-indigo-600/30 disabled:opacity-50"
            >
              {guardando ? (
                <>
                  <span className="animate-spin">⏳</span> Guardando…
                </>
              ) : (
                <>
                  <span>👤+</span> Crear y Acreditar Cliente
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
