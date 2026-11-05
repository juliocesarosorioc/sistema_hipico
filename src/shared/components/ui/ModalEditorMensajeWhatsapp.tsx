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
  const [copiandoImagen, setCopiandoImagen] = useState(false);

  useEffect(() => {
    if (abierto) {
      setTelefono(telefonoInicial);
      setCodigoPais(codigoPaisInicial || "+58");
      setMensaje(mensajeInicial);
      setCopiado(false);
      setCopiandoImagen(false);
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

  /**
   * Genera una tarjeta gráfica de alta resolución (PNG) con las credenciales
   * para compartir por WhatsApp como imagen sin ningún problema de codificación de emojis.
   */
  const generarTarjetaCredencialesBlob = (): Promise<Blob | null> => {
    return new Promise((resolve) => {
      try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(null);

        // Extraer campos del mensaje
        const mGrupo = mensaje.match(/(?:Grupo|GRUPO):\s*([^\n\r]+)/i);
        const grupo = mGrupo ? mGrupo[1].replace(/[*_#`]/g, "").trim() : "SISTEMA HÍPICO";

        const mUser = mensaje.match(/(?:Usuario|Móvil|Usuario\s*\/\s*Móvil):\s*`?([^`\n\r*]+)`?/i);
        const usuario = mUser ? mUser[1].trim() : destinatarioNombre || "operador";

        const mClave = mensaje.match(/(?:Contraseña|Clave):\s*`?([^`\n\r*]+)`?/i);
        const clave = mClave ? mClave[1].trim() : "OP****";

        const mUrl = mensaje.match(/https?:\/\/[^\s\n\r]+/i);
        const urlLogin = mUrl ? mUrl[0] : "http://www.administracionhipica.ia.ve/login/";

        const mOperador = mensaje.match(/(?:Operador):\s*([^\n\r]+)/i);
        const operador = mOperador ? mOperador[1].replace(/[*_#`]/g, "").trim() : destinatarioNombre || "";

        const mTel = mensaje.match(/(?:Móvil|Teléfono):\s*([^\n\r]+)/i);
        const telTexto = mTel ? mTel[1].replace(/[*_#`]/g, "").trim() : telefono ? `${codigoPais} ${telefono}` : "";

        // Dimensiones (DPI 2x)
        const w = 720;
        const h = 460;
        canvas.width = w * 2;
        canvas.height = h * 2;
        ctx.scale(2, 2);

        // Fondo degradado de lujo
        const grad = ctx.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, "#090d16");
        grad.addColorStop(0.5, "#0f172a");
        grad.addColorStop(1, "#1e293b");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);

        // Borde dorado de lujo
        ctx.strokeStyle = "#f59e0b";
        ctx.lineWidth = 3;
        ctx.strokeRect(12, 12, w - 24, h - 24);

        ctx.strokeStyle = "rgba(245, 158, 11, 0.3)";
        ctx.lineWidth = 1;
        ctx.strokeRect(18, 18, w - 36, h - 36);

        // Encabezado
        ctx.fillStyle = "#f59e0b";
        ctx.font = "bold 22px system-ui, Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("SISTEMA HÍPICO", w / 2, 52);

        ctx.fillStyle = "#38bdf8";
        ctx.font = "bold 13px system-ui, Arial, sans-serif";
        ctx.fillText("CREDENCIAL DE ACCESO — TAQUILLA MÓVIL", w / 2, 74);

        // Línea divisoria
        ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
        ctx.beginPath();
        ctx.moveTo(35, 90);
        ctx.lineTo(w - 35, 90);
        ctx.stroke();

        // Datos del Grupo
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 16px system-ui, Arial, sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(`GRUPO: ${grupo.toUpperCase()}`, 40, 120);

        if (operador || telTexto) {
          ctx.fillStyle = "#94a3b8";
          ctx.font = "13px system-ui, Arial, sans-serif";
          const opTxt = [operador ? `Operador: ${operador}` : "", telTexto ? `Móvil: ${telTexto}` : ""].filter(Boolean).join(" · ");
          ctx.fillText(opTxt, 40, 142);
        }

        // Cajas de Credenciales (Usuario y Clave)
        const boxY = 166;
        const boxW = (w - 100) / 2;
        const boxH = 88;

        // Caja 1: Usuario
        ctx.fillStyle = "#1e293b";
        ctx.fillRect(40, boxY, boxW, boxH);
        ctx.strokeStyle = "rgba(56, 189, 248, 0.5)";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(40, boxY, boxW, boxH);

        ctx.fillStyle = "#94a3b8";
        ctx.font = "bold 11px system-ui, Arial, sans-serif";
        ctx.fillText("USUARIO / MÓVIL", 55, boxY + 28);

        ctx.fillStyle = "#38bdf8";
        ctx.font = "bold 20px monospace, Courier, sans-serif";
        ctx.fillText(usuario, 55, boxY + 62);

        // Caja 2: Contraseña
        const box2X = 40 + boxW + 20;
        ctx.fillStyle = "#1e293b";
        ctx.fillRect(box2X, boxY, boxW, boxH);
        ctx.strokeStyle = "rgba(16, 185, 129, 0.5)";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(box2X, boxY, boxW, boxH);

        ctx.fillStyle = "#94a3b8";
        ctx.font = "bold 11px system-ui, Arial, sans-serif";
        ctx.fillText("CONTRASEÑA", box2X + 15, boxY + 28);

        ctx.fillStyle = "#10b981";
        ctx.font = "bold 22px monospace, Courier, sans-serif";
        ctx.fillText(clave, box2X + 15, boxY + 62);

        // Caja Enlace
        const linkY = 274;
        const linkW = w - 80;
        const linkH = 65;

        ctx.fillStyle = "#0f172a";
        ctx.fillRect(40, linkY, linkW, linkH);
        ctx.strokeStyle = "rgba(245, 158, 11, 0.4)";
        ctx.lineWidth = 1;
        ctx.strokeRect(40, linkY, linkW, linkH);

        ctx.fillStyle = "#f59e0b";
        ctx.font = "bold 11px system-ui, Arial, sans-serif";
        ctx.fillText("ENLACE DIRECTO DE INGRESO:", 55, linkY + 25);

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 14px monospace, Courier, sans-serif";
        ctx.fillText(urlLogin, 55, linkY + 48);

        // Instrucciones al pie
        ctx.fillStyle = "#94a3b8";
        ctx.font = "11px system-ui, Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("1. Abre el enlace en tu navegador móvil  ·  2. Ingresa tus datos  ·  3. ¡Listo para operar!", w / 2, 375);

        ctx.fillStyle = "#64748b";
        ctx.font = "italic 10px system-ui, Arial, sans-serif";
        ctx.fillText("Credencial oficial autorizada · Guarda esta tarjeta en tus fotos para acceder rápidamente", w / 2, 400);

        canvas.toBlob((blob) => resolve(blob), "image/png");
      } catch {
        resolve(null);
      }
    });
  };

  const handleCopiarImagen = async () => {
    setCopiandoImagen(true);
    try {
      const blob = await generarTarjetaCredencialesBlob();
      if (!blob) throw new Error("No se pudo generar la imagen");

      if (typeof window !== "undefined" && navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([
          new window.ClipboardItem({ "image/png": blob }),
        ]);
        toast("📸 ¡Tarjeta copiada como Imagen! Pégala (Ctrl+V) directo en WhatsApp.", "success");
      } else {
        // Fallback: descarga directa si el portapapeles de imágenes no está disponible
        descargarBlob(blob, `credenciales-${destinatarioNombre || "operador"}.png`);
        toast("⬇️ Tarjeta descargada en imagen PNG. Puedes adjuntarla en WhatsApp.", "success");
      }
    } catch {
      toast("No se pudo copiar la imagen al portapapeles. Intentando descarga...", "warning");
      try {
        const blob = await generarTarjetaCredencialesBlob();
        if (blob) descargarBlob(blob, `credenciales-${destinatarioNombre || "operador"}.png`);
      } catch {
        /* ignore */
      }
    } finally {
      setCopiandoImagen(false);
    }
  };

  const descargarBlob = (blob: Blob, nombre: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nombre;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
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
        <div className="bg-slate-50 px-4 sm:px-5 py-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopiar}
              className="flex items-center gap-1.5 text-xs font-bold border-slate-300"
            >
              <span>{copiado ? "✅" : "📋"}</span>
              <span>{copiado ? "¡Texto Copiado!" : "Copiar Texto"}</span>
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopiarImagen}
              disabled={copiandoImagen}
              className="flex items-center gap-1.5 text-xs font-bold border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100 shadow-2xs"
              title="Genera y copia una tarjeta gráfica oficial de alta resolución (PNG) para pegar directo en WhatsApp sin que los emojis se alteren"
            >
              <span>📸</span>
              <span>{copiandoImagen ? "Generando..." : "Copiar como Imagen"}</span>
            </Button>
          </div>

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
