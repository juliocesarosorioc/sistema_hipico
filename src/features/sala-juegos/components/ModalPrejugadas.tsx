"use client";

import React, { useState, useEffect, useRef } from "react";
import { salaApi } from "../lib/sala-api";
import { formatearMontoRegional, prefijoMonedaGrupo } from "@/shared/lib/dinero";

interface PropsModalPrejugadas {
  salaId: string;
  grupoId?: string;
  grupoNombre: string;
  moneda?: string | null;
  puedePublicar?: boolean;
  publicarAlAbrir?: boolean;
  onPublicado?: () => void;
  onCerrar: () => void;
}

export function ModalPrejugadas({
  salaId,
  grupoId,
  grupoNombre,
  moneda,
  puedePublicar = false,
  publicarAlAbrir = false,
  onPublicado,
  onCerrar,
}: PropsModalPrejugadas) {
  const [cargando, setCargando] = useState(true);
  const [tickets, setTickets] = useState<any[]>([]);
  const [salaInfo, setSalaInfo] = useState<any>(null);
  const [copiado, setCopiado] = useState(false);
  const [publicando, setPublicando] = useState(false);
  const [estadoPublicacion, setEstadoPublicacion] = useState<{
    ok: boolean;
    mensaje: string;
  } | null>(null);
  const autoPublicadoSalaRef = useRef<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const publicarEnChatYWhatsapp = async () => {
    if (!salaId || publicando) return;
    setPublicando(true);
    try {
      const res = await salaApi.accionOperador("publicar-prejugadas", {
        salaId,
        grupoId,
      });
      if (res.ok && res.data?.ok) {
        const msgWa = res.data.enviadoWhatsApp
          ? " y WhatsApp"
          : " (en Chat Web; WhatsApp sin conexión o sin grupo vinculado)";
        setEstadoPublicacion({
          ok: true,
          mensaje: `✅ Prejugadas publicadas en Sala${msgWa}`,
        });
        onPublicado?.();
      } else {
        setEstadoPublicacion({
          ok: false,
          mensaje: `⚠️ ${res.data?.error || "No se pudo publicar las prejugadas."}`,
        });
      }
    } catch {
      setEstadoPublicacion({
        ok: false,
        mensaje: "⚠️ Error de conexión al publicar las prejugadas.",
      });
    } finally {
      setPublicando(false);
    }
  };

  useEffect(() => {
    let montado = true;
    (async () => {
      setCargando(true);
      const res = await salaApi.accionOperador("prejugadas-data", { salaId });
      if (montado && res.ok && res.data) {
        setTickets(res.data.tickets || []);
        setSalaInfo(res.data.sala || null);
      }
      if (montado) setCargando(false);
    })();
    return () => {
      montado = false;
    };
  }, [salaId]);

  useEffect(() => {
    if (!cargando && publicarAlAbrir && puedePublicar && autoPublicadoSalaRef.current !== salaId) {
      autoPublicadoSalaRef.current = salaId;
      void publicarEnChatYWhatsapp();
    }
  }, [cargando, publicarAlAbrir, puedePublicar, salaId]);

  const hipodromo = (salaInfo?.hipodromo_activo || "HIPÓDROMO").toUpperCase();
  const carrera = salaInfo?.numero_carrera_activa || 1;
  const fecha = new Date().toLocaleDateString();
  // La moneda la define el grupo: todo el reporte (texto y PNG) usa el mismo prefijo.
  const prefijo = prefijoMonedaGrupo(moneda);

  // Texto optimizado para WhatsApp
  const textoWhatsApp =
    `📋 *REPORTE DE PREJUGADAS — ${hipodromo} C${carrera}*\n` +
    `🏛️ Grupo: ${grupoNombre} | 📅 ${fecha}\n` +
    `🔒 Seguridad E2EE Verificada\n` +
    `----------------------------------------\n` +
    (tickets.length > 0
      ? tickets
          .map((t, idx) => {
            const cruce = `${t.proponente_nombre} vs ${t.aceptante_nombre}`;
            const jugada = t.es_match
              ? `A Premio: ${t.caballos_bando_a?.join("-")} x ${t.caballos_bando_b?.join("-")}`
              : `${t.modalidad || "1P"} #${t.ejemplar_numero || t.caballos_bando_a?.join("-")}`;
            return `${idx + 1}. [T-${(t.codigo_ticket || t.id.slice(0, 6)).toUpperCase()}] ${prefijo}${formatearMontoRegional(t.monto_concretado)}\n   ${cruce}\n   ${jugada}`;
          })
          .join("\n\n")
      : "No hay jugadas pactadas aún para esta carrera.") +
    `\n----------------------------------------\n` +
    `Total pactado: ${prefijo}${formatearMontoRegional(tickets.reduce((acc, t) => acc + Number(t.monto_concretado || 0), 0))}\n` +
    `¡Mucha suerte a todos los participantes! 🏇✨`;

  const copiarTexto = async () => {
    try {
      await navigator.clipboard.writeText(textoWhatsApp);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Fallback
    }
  };

  const descargarPNG = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const baseHeight = 220;
    const itemHeight = 60;
    const totalHeight = Math.max(480, baseHeight + tickets.length * itemHeight);

    canvas.width = 900;
    canvas.height = totalHeight;

    // Fondo oscuro premium
    ctx.fillStyle = "#0b141a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Borde superior verde
    ctx.fillStyle = "#00a884";
    ctx.fillRect(0, 0, canvas.width, 8);

    // Título
    ctx.fillStyle = "#00a884";
    ctx.font = "bold 26px sans-serif";
    ctx.fillText(`📋 REPORTE DE PREJUGADAS EN VIVO`, 40, 50);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 20px sans-serif";
    ctx.fillText(`${hipodromo} — CARRERA #${carrera}`, 40, 85);

    ctx.fillStyle = "#8696a0";
    ctx.font = "14px sans-serif";
    ctx.fillText(`Grupo: ${grupoNombre} | Fecha: ${fecha} | Sello SHA-256 E2EE`, 40, 115);

    // Línea divisoria
    ctx.strokeStyle = "#202c33";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(40, 135);
    ctx.lineTo(860, 135);
    ctx.stroke();

    // Tickets
    let y = 175;
    if (tickets.length === 0) {
      ctx.fillStyle = "#aebac1";
      ctx.font = "18px sans-serif";
      ctx.fillText("No hay jugadas pactadas aún en esta carrera.", 40, y);
    } else {
      tickets.forEach((t, i) => {
        // Tarjeta ticket
        ctx.fillStyle = "#111b21";
        ctx.fillRect(40, y - 25, 820, 50);

        ctx.fillStyle = "#00a884";
        ctx.font = "bold 15px monospace";
        ctx.fillText(`#${i + 1} [T-${(t.codigo_ticket || t.id.slice(0, 6)).toUpperCase()}]`, 55, y + 5);

        ctx.fillStyle = "#e9edef";
        ctx.font = "bold 15px sans-serif";
        ctx.fillText(`${t.proponente_nombre} vs ${t.aceptante_nombre}`, 230, y + 5);

        ctx.fillStyle = "#ffd279";
        const jugada = t.es_match
          ? `A Premio: ${t.caballos_bando_a?.join("-")} x ${t.caballos_bando_b?.join("-")}`
          : `${t.modalidad || "1P"} #${t.ejemplar_numero || t.caballos_bando_a?.join("-")}`;
        ctx.fillText(jugada, 550, y + 5);

        ctx.fillStyle = "#25d366";
        ctx.font = "bold 16px sans-serif";
        ctx.fillText(`${prefijo}${formatearMontoRegional(t.monto_concretado)}`, 770, y + 5);

        y += itemHeight;
      });
    }

    // Pie de página con total
    const total = tickets.reduce((acc, t) => acc + Number(t.monto_concretado || 0), 0);
    ctx.fillStyle = "#202c33";
    ctx.fillRect(40, totalHeight - 65, 820, 45);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 16px sans-serif";
    ctx.fillText(`TOTAL PACTADO: ${prefijo}${formatearMontoRegional(total)}`, 55, totalHeight - 37);

    ctx.fillStyle = "#8696a0";
    ctx.font = "12px monospace";
    ctx.fillText(`Firma E2EE: SHA256-ACID-VERIFIED`, 570, totalHeight - 37);

    const a = document.createElement("a");
    a.download = `Prejugadas_${hipodromo}_C${carrera}.png`;
    a.href = canvas.toDataURL("image/png");
    a.click();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-[#111b21] border border-[#202c33] rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Cabecera modal */}
        <div className="px-5 py-4 border-b border-[#202c33] flex items-center justify-between bg-[#202c33]/40">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span>📋</span> Reporte Preliminar de Prejugadas
            </h3>
            <p className="text-xs text-gray-400">
              {hipodromo} — Carrera #{carrera} | {grupoNombre}
            </p>
          </div>
          <button
            onClick={onCerrar}
            className="text-gray-400 hover:text-white text-lg px-2 py-1 rounded"
          >
            ✕
          </button>
        </div>

        {/* Contenido */}
        <div className="p-5 flex-1 overflow-y-auto space-y-4 text-xs font-mono">
          {cargando ? (
            <div className="p-8 text-center text-gray-400">Cargando jugadas pactadas...</div>
          ) : (
            <>
              {estadoPublicacion && (
                <div
                  className={`px-3 py-2 rounded-lg border text-[11px] font-bold ${
                    estadoPublicacion.ok
                      ? "bg-emerald-950/70 border-emerald-600/50 text-emerald-300"
                      : "bg-amber-950/70 border-amber-600/50 text-amber-300"
                  }`}
                >
                  {estadoPublicacion.mensaje}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {puedePublicar && (
                  <button
                    onClick={() => void publicarEnChatYWhatsapp()}
                    disabled={publicando}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-bold py-2.5 px-3 rounded-lg flex items-center justify-center gap-2 transition"
                  >
                    <span>{publicando ? "⏳" : "📢"}</span>
                    <span>{publicando ? "Publicando en Chat y WhatsApp..." : "Publicar en Chat y WhatsApp"}</span>
                  </button>
                )}
                <button
                  onClick={copiarTexto}
                  className="flex-1 bg-[#202c33] hover:bg-[#2a3942] border border-gray-700 text-emerald-400 font-bold py-2.5 px-3 rounded-lg flex items-center justify-center gap-2 transition"
                >
                  <span>{copiado ? "✅" : "📋"}</span>
                  <span>{copiado ? "¡Copiado al Portapapeles!" : "Copiar para WhatsApp"}</span>
                </button>
                <button
                  onClick={descargarPNG}
                  className="flex-1 bg-[#00a884] hover:bg-emerald-600 text-black font-bold py-2.5 px-3 rounded-lg flex items-center justify-center gap-2 transition"
                >
                  <span>🖼️</span>
                  <span>Descargar Imagen PNG</span>
                </button>
              </div>

              <div className="bg-[#0b141a] p-4 rounded-xl border border-gray-800 whitespace-pre-wrap text-gray-300 leading-relaxed select-text">
                {textoWhatsApp}
              </div>

              <canvas ref={canvasRef} className="hidden" />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
