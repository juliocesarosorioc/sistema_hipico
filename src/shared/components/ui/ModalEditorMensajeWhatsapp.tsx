"use client";

import React, { useState, useEffect } from "react";
import { Button } from "./Button";

const toast = (msg: string, tipo: "success" | "warning" | "error" | "info" = "info") => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));
  }
};

export type ModalEditorMensajeWhatsappProps = {
  abierto: boolean;
  onCerrar: () => void;
  titulo?: string;
  destinatarioNombre?: string;
  telefonoInicial?: string;
  codigoPaisInicial?: string;
  mensajeInicial: string;
  onEnviado?: (mensaje: string, telefono: string) => void;
};

/**
 * Modal universal para previsualizar, editar y enviar mensajes a WhatsApp.
 * Garantiza codificación UTF-8 limpia (sin rombos ni caracteres corruptos).
 */
export function ModalEditorMensajeWhatsapp({
  abierto,
  onCerrar,
  titulo = "Ver y Editar Mensaje para WhatsApp",
  destinatarioNombre,
  telefonoInicial = "",
  codigoPaisInicial = "+58",
  mensajeInicial = "",
  onEnviado,
}: ModalEditorMensajeWhatsappProps) {
  const [telefono, setTelefono] = useState(telefonoInicial);
  const [codigoPais, setCodigoPais] = useState(codigoPaisInicial);
  const [mensaje, setMensaje] = useState(mensajeInicial);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    if (abierto) {
      setTelefono(telefonoInicial);
      setCodigoPais(codigoPaisInicial || "+58");
      setMensaje(mensajeInicial);
      setCopiado(false);
    }
  }, [abierto, telefonoInicial, codigoPaisInicial, mensajeInicial]);

  if (!abierto) return null;

  const normalizarNumero = (tel: string, cod: string) => {
    const digitosTel = String(tel || "").replace(/\D/g, "");
    const digitosCod = String(cod || "").replace(/\D/g, "");
    if (!digitosTel) return "";
    if (digitosTel.startsWith(digitosCod) && digitosTel.length >= 10) {
      return digitosTel;
    }
    return `${digitosCod}${digitosTel}`;
  };

  const handleAbrirWhatsapp = () => {
    const textoLimpio = mensaje.trim();
    if (!textoLimpio) {
      toast("El mensaje no puede estar vacío.", "warning");
      return;
    }

    const telFinal = normalizarNumero(telefono, codigoPais);
    // wa.me acepta url con o sin número
    const urlWa = telFinal
      ? `https://wa.me/${telFinal}?text=${encodeURIComponent(textoLimpio)}`
      : `https://wa.me/?text=${encodeURIComponent(textoLimpio)}`;

    window.open(urlWa, "_blank", "noopener,noreferrer");
    toast("WhatsApp abierto con el mensaje.", "success");
    if (onEnviado) onEnviado(textoLimpio, telFinal);
    onCerrar();
  };

  const handleCopiar = async () => {
    try {
      await navigator.clipboard.writeText(mensaje);
      setCopiado(true);
      toast("Mensaje copiado al portapapeles.", "success");
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      toast("No se pudo copiar el texto.", "error");
    }
  };

  const handleRestaurar = () => {
    setMensaje(mensajeInicial);
    toast("Mensaje restaurado a su versión original.", "info");
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
    >
      <div className="w-full max-w-xl rounded-2xl bg-white shadow-2xl overflow-hidden border border-slate-200 flex flex-col max-h-[92vh]">
        {/* Cabecera estilo WhatsApp */}
        <div className="bg-emerald-700 px-5 py-3.5 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">💬</span>
            <div>
              <h2 className="text-sm font-black uppercase tracking-wide leading-none">{titulo}</h2>
              {destinatarioNombre && (
                <p className="text-[11px] text-emerald-100 font-semibold mt-1">
                  Destinatario: <span className="font-bold text-white">{destinatarioNombre}</span>
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            className="text-emerald-200 hover:text-white rounded-lg p-1 text-sm font-black transition-colors"
            onClick={onCerrar}
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        {/* Cuerpo del Editor */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1 text-slate-800">
          {/* Fila de Teléfono */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <label className="block text-[10px] font-black uppercase tracking-wider text-slate-600 mb-1.5">
              Número de Teléfono WhatsApp (opcional para envío directo)
            </label>
            <div className="flex items-center gap-2">
              <select
                value={codigoPais}
                onChange={(e) => setCodigoPais(e.target.value)}
                className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="+58">🇻🇪 +58</option>
                <option value="+54">🇦🇷 +54</option>
                <option value="+57">🇨🇴 +57</option>
                <option value="+56">🇨🇱 +56</option>
                <option value="+1">🇺🇸 +1</option>
                <option value="+34">🇪🇸 +34</option>
                <option value="+591">🇧🇴 +591</option>
                <option value="+593">🇪🇨 +593</option>
                <option value="+595">🇵🇾 +595</option>
                <option value="+598">🇺🇾 +598</option>
              </select>
              <input
                type="tel"
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                placeholder="4121234567"
                className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <p className="mt-1 text-[10px] text-slate-400">
              Si dejas el número en blanco o incompleto, WhatsApp se abrirá para que elijas el chat o grupo manualmente.
            </p>
          </div>

          {/* Área de Edición del Mensaje */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-black uppercase tracking-wider text-slate-700">
                Texto del Mensaje (Puedes editarlo libremente)
              </label>
              <button
                type="button"
                onClick={handleRestaurar}
                className="text-[10px] font-bold text-slate-500 hover:text-emerald-700 transition-colors"
                title="Restaurar al texto original generado por el sistema"
              >
                🔄 Restaurar original
              </button>
            </div>
            <textarea
              value={mensaje}
              onChange={(e) => setMensaje(e.target.value)}
              rows={10}
              className="w-full rounded-xl border border-slate-300 bg-white p-3 font-mono text-xs text-slate-900 leading-relaxed outline-none focus:ring-2 focus:ring-emerald-500 resize-y shadow-inner"
              placeholder="Escribe el mensaje..."
            />
            <div className="flex items-center justify-between mt-1 text-[10px] text-slate-400">
              <span>{mensaje.length} caracteres · Formato WhatsApp (*negrita*, _cursiva_, `código`)</span>
              <span className="text-emerald-700 font-semibold">✓ Compatible UTF-8 sin errores gráficos</span>
            </div>
          </div>
        </div>

        {/* Barra de Acciones */}
        <div className="bg-slate-50 px-5 py-3.5 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCopiar}
            className="flex items-center gap-1.5 text-xs font-bold border-slate-300"
          >
            <span>{copiado ? "✅" : "📋"}</span>
            <span>{copiado ? "¡Copiado!" : "Copiar Texto"}</span>
          </Button>

          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onCerrar} className="text-xs">
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleAbrirWhatsapp}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs px-4 py-2 flex items-center gap-1.5 shadow-md transition-transform active:scale-95"
            >
              <span>💬</span>
              <span>Abrir en WhatsApp</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
