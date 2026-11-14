"use client";

import React, { useState } from "react";
import { generarHashArchivoSHA256 } from "../lib/seguridad-crypto";
import { salaApi } from "../lib/sala-api";
import { esGrupoBolivares, formatearMontoRegional, prefijoMonedaGrupo } from "@/shared/lib/dinero";

interface PropsModalRecarga {
  grupoId: string;
  clienteId?: string;
  moneda?: string | null;
  onCerrar: () => void;
  onExito: (nuevoSaldo?: number) => void;
}

export function ModalRecargaBlindada({ grupoId, clienteId, moneda, onCerrar, onExito }: PropsModalRecarga) {
  const prefijo = prefijoMonedaGrupo(moneda);
  const monedaCodigo = esGrupoBolivares(moneda) ? "VES" : "USD";
  const [metodo, setMetodo] = useState("PAGO_MOVIL");
  const [banco, setBanco] = useState("BANESCO");
  const [referencia, setReferencia] = useState("");
  const [monto, setMonto] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [hashArchivo, setHashArchivo] = useState<string>("");
  const [procesando, setProcesando] = useState(false);
  const [estadoMsg, setEstadoMsg] = useState<{ tipo: "info" | "exito" | "error"; texto: string } | null>(null);
  const [intentosFallidos, setIntentosFallidos] = useState(0);

  const manejarCambioArchivo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setArchivo(file);
      try {
        const hash = await generarHashArchivoSHA256(file);
        setHashArchivo(hash);
      } catch {
        setHashArchivo("");
      }
    }
  };

  const enviarRecarga = async (e: React.FormEvent) => {
    e.preventDefault();
    if (intentosFallidos >= 3) {
      setEstadoMsg({
        tipo: "error",
        texto: "🚫 Has alcanzado el límite de 3 intentos fallidos. Tu cuenta ha sido protegida. Contacta al soporte u operador.",
      });
      return;
    }

    if (!referencia || !monto || !archivo || !hashArchivo) {
      setEstadoMsg({ tipo: "error", texto: "Completa todos los campos y adjunta el comprobante original." });
      return;
    }

    setProcesando(true);
    setEstadoMsg({
      tipo: "info",
      texto: `🔒 Procesando 5 Candados: Huella SHA-256 (${hashArchivo.slice(0, 10)}...), análisis OCR IA y conciliación ACID...`,
    });

    try {
      const res = await salaApi.validarRecarga({
        grupoId,
        clienteId,
        metodoPago: metodo,
        bancoOrigen: banco,
        referencia: referencia.trim(),
        montoReportado: parseFloat(monto),
        moneda: monedaCodigo,
        nombreArchivo: archivo.name,
        hashImagenSha256: hashArchivo,
      });

      if (!res.ok) {
        setIntentosFallidos((prev) => prev + 1);
        setEstadoMsg({
          tipo: "error",
          texto: `❌ Error en conciliación: ${res.error || "Datos no coinciden con la bóveda bancaria"}. Intento ${intentosFallidos + 1}/3.`,
        });
      } else {
        const data = res.data?.resultado || {};
        if (data.auto_aprobado) {
          setEstadoMsg({
            tipo: "exito",
            texto: `✅ ¡Recarga Exitosa Auto-Aprobada! Nuevo saldo disponible: ${prefijo}${formatearMontoRegional(data.nuevo_saldo_disponible || monto)}`,
          });
          setTimeout(() => {
            onExito(data.nuevo_saldo_disponible);
            onCerrar();
          }, 2000);
        } else {
          setEstadoMsg({
            tipo: "info",
            texto: data.mensaje || "⏳ Solicitud recibida y en cola de confirmación bancaria.",
          });
          setTimeout(() => {
            onExito();
            onCerrar();
          }, 2500);
        }
      }
    } catch (err: any) {
      setIntentosFallidos((prev) => prev + 1);
      setEstadoMsg({ tipo: "error", texto: "Error de conexión: " + (err?.message || err) });
    } finally {
      setProcesando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
      <div className="bg-[#111b21] border border-[#202c33] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col">
        {/* Cabecera */}
        <div className="px-5 py-4 border-b border-[#202c33] flex items-center justify-between bg-[#202c33]/40">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <span>💳</span> Recarga Blindada (5 Candados)
            </h3>
            <p className="text-[11px] text-emerald-400 font-mono">Conciliación ACID Instantánea</p>
          </div>
          <button onClick={onCerrar} className="text-gray-400 hover:text-white px-2 py-1 text-sm rounded">
            ✕
          </button>
        </div>

        {/* Formulario */}
        <form onSubmit={enviarRecarga} className="p-5 space-y-3.5 text-xs">
          <div>
            <label className="block text-gray-300 font-medium mb-1">Método de Pago</label>
            <select
              value={metodo}
              onChange={(e) => setMetodo(e.target.value)}
              className="w-full bg-[#0b141a] border border-gray-700 rounded-lg p-2.5 text-white focus:border-emerald-500 outline-none"
            >
              <option value="PAGO_MOVIL">Pago Móvil (Bs / Tasa Oficial)</option>
              <option value="ZELLE">Zelle (USD)</option>
              <option value="TRANSFERENCIA">Transferencia Bancaria</option>
              <option value="BINANCE">Binance USDT (Pay)</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-gray-300 font-medium mb-1">Banco Origen</label>
              <input
                type="text"
                value={banco}
                onChange={(e) => setBanco(e.target.value.toUpperCase())}
                placeholder="Ej. Banesco, Mercantil"
                className="w-full bg-[#0b141a] border border-gray-700 rounded-lg p-2.5 text-white focus:border-emerald-500 outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-gray-300 font-medium mb-1">Referencia (Últimos 6-8)</label>
              <input
                type="text"
                value={referencia}
                onChange={(e) => setReferencia(e.target.value)}
                placeholder="Ej. 123456"
                className="w-full bg-[#0b141a] border border-gray-700 rounded-lg p-2.5 text-white focus:border-emerald-500 outline-none font-mono"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-gray-300 font-medium mb-1">Monto ({prefijo.trim()})</label>
            <input
              type="number"
              step="any"
              min="1"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              placeholder="Ej. 50"
              className="w-full bg-[#0b141a] border border-gray-700 rounded-lg p-2.5 text-white focus:border-emerald-500 outline-none font-mono"
              required
            />
          </div>

          <div>
            <label className="block text-gray-300 font-medium mb-1">
              Comprobante de Pago (Imagen con Huella SHA-256)
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={manejarCambioArchivo}
              className="w-full text-xs text-gray-400 file:mr-2 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-[#202c33] file:text-emerald-400 hover:file:bg-[#2a3942] cursor-pointer"
              required
            />
            {hashArchivo && (
              <p className="mt-1 text-[10px] text-gray-400 font-mono truncate">
                SHA-256: <span className="text-emerald-400">{hashArchivo}</span>
              </p>
            )}
          </div>

          {estadoMsg && (
            <div
              className={`p-3 rounded-lg text-xs leading-relaxed font-mono ${
                estadoMsg.tipo === "exito"
                  ? "bg-emerald-950/60 border border-emerald-700 text-emerald-300"
                  : estadoMsg.tipo === "error"
                  ? "bg-red-950/60 border border-red-700 text-red-300"
                  : "bg-blue-950/60 border border-blue-700 text-blue-300"
              }`}
            >
              {estadoMsg.texto}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onCerrar}
              className="flex-1 bg-[#202c33] hover:bg-[#2a3942] text-gray-300 font-bold py-2.5 rounded-lg transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={procesando || intentosFallidos >= 3}
              className="flex-1 bg-[#00a884] hover:bg-emerald-500 disabled:opacity-50 text-black font-bold py-2.5 rounded-lg transition flex items-center justify-center gap-2"
            >
              {procesando ? (
                <>
                  <span className="animate-spin">⏳</span>
                  <span>Verificando...</span>
                </>
              ) : (
                "Validar y Recargar"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
