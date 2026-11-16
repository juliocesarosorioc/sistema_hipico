"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import QRCode from "react-qr-code";

export interface WhatsAppOperatorPanelProps {
  grupo_id: string;
  className?: string;
}

type BotStatus = "connected" | "qr" | "disconnected" | "loading";

const CONTABO_IP = "80.190.77.210";
const BOT_SERVER_URL = process.env.NEXT_PUBLIC_BOT_URL || `http://${CONTABO_IP}:3005`;

export default function WhatsAppOperatorPanel({ grupo_id, className = "" }: WhatsAppOperatorPanelProps) {
  const [status, setStatus] = useState<BotStatus>("loading");
  const [qrValue, setQrValue] = useState<string | null>(null);
  const [numero, setNumero] = useState<string | null>(null);
  const [procesando, setProcesando] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const isMounted = useRef<boolean>(true);

  // Consulta de estado con polling cada 3 segundos a http://80.190.77.210:3005/api/whatsapp/status?session_id={grupo_id}
  const consultarEstado = useCallback(async () => {
    if (!grupo_id) return;
    try {
      let res: Response | null = null;
      // Intento directo a http://80.190.77.210:3005/api/whatsapp/status?session_id={grupo_id}
      try {
        res = await fetch(`${BOT_SERVER_URL}/api/whatsapp/status?session_id=${encodeURIComponent(grupo_id)}`, {
          cache: "no-store",
        });
      } catch {
        // Fallback al proxy Next.js /api/whatsapp/status
        res = await fetch(`/api/whatsapp/status?session_id=${encodeURIComponent(grupo_id)}`, {
          cache: "no-store",
        });
      }

      if (!isMounted.current) return;

      if (res && res.ok) {
        const data = await res.json();
        const rawStatus = String(data?.status || "").toLowerCase();
        const conectado = Boolean(data?.conectado || rawStatus === "connected" || rawStatus === "open");
        const qrRaw = data?.qr || data?.qrDataUrl || null;

        if (conectado) {
          setStatus("connected");
          setQrValue(null);
        } else if (rawStatus === "qr" || qrRaw) {
          setStatus("qr");
          setQrValue(qrRaw);
        } else {
          setStatus("disconnected");
          setQrValue(null);
        }

        setNumero(data?.numero || data?.numeroVinculado || null);
        setErrorMsg(null);
      } else {
        if (!isMounted.current) return;
        setStatus("disconnected");
      }
    } catch (err: any) {
      if (!isMounted.current) return;
      // No bloquear la interfaz si hay micro-cortes
      setErrorMsg(err?.message || "Error al consultar estado");
    }
  }, [grupo_id]);

  useEffect(() => {
    isMounted.current = true;
    void consultarEstado();

    const interval = setInterval(() => {
      void consultarEstado();
    }, 3000);

    return () => {
      isMounted.current = false;
      clearInterval(interval);
    };
  }, [consultarEstado]);

  // Conectar bot: POST a http://80.190.77.210:3005/api/whatsapp/connect con { session_id: grupo_id }
  const conectarBot = async () => {
    setProcesando(true);
    setErrorMsg(null);
    try {
      let res: Response | null = null;
      try {
        res = await fetch(`${BOT_SERVER_URL}/api/whatsapp/connect`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: grupo_id }),
        });
      } catch {
        res = await fetch("/api/whatsapp/connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: grupo_id }),
        });
      }

      if (res && res.ok) {
        const data = await res.json();
        if (data?.status === "connected") {
          setStatus("connected");
        } else if (data?.status === "qr" || data?.qr) {
          setStatus("qr");
          setQrValue(data.qr);
        } else {
          setStatus("loading");
        }
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "No se pudo iniciar el bot");
    } finally {
      setProcesando(false);
      void consultarEstado();
    }
  };

  // Desconectar: POST a /disconnect
  const desconectarBot = async () => {
    setProcesando(true);
    setErrorMsg(null);
    try {
      let res: Response | null = null;
      try {
        res = await fetch("/disconnect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: grupo_id }),
        });
      } catch {
        res = await fetch(`${BOT_SERVER_URL}/disconnect`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: grupo_id }),
        });
      }

      if (res && res.ok) {
        setStatus("disconnected");
        setQrValue(null);
        setNumero(null);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "No se pudo desconectar");
    } finally {
      setProcesando(false);
      void consultarEstado();
    }
  };

  return (
    <div className={`rounded-3xl border border-slate-800 bg-slate-950 p-5 text-white shadow-xl ${className}`}>
      {/* Cabecera del Panel */}
      <div className="mb-4 flex items-center justify-between border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">💬</span>
          <div>
            <h2 className="text-xs font-black uppercase tracking-[0.14em] text-emerald-400">
              Conexión WhatsApp del Operador
            </h2>
            <p className="text-[10px] text-slate-400">
              Sesión ID: <span className="font-mono text-emerald-300">{grupo_id || "Sin ID"}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              status === "connected"
                ? "bg-emerald-400 shadow-md shadow-emerald-500/50"
                : status === "qr"
                ? "bg-amber-400 animate-pulse"
                : "bg-slate-600"
            }`}
          />
          <span className="text-[11px] font-bold capitalize text-slate-300">
            {status === "loading"
              ? "Cargando…"
              : status === "connected"
              ? "En línea"
              : status === "qr"
              ? "Esperando QR"
              : "Desconectado"}
          </span>
        </div>
      </div>

      {/* Alerta de error si ocurre */}
      {errorMsg && (
        <div className="mb-3 rounded-xl border border-rose-500/30 bg-rose-950/40 px-3 py-2 text-[11px] text-rose-300">
          ⚠️ {errorMsg}
        </div>
      )}

      {/* Cuerpo según el Estado */}
      <div className="flex flex-col items-center justify-center py-2">
        {/* ESTADO 1: Cargando */}
        {status === "loading" && (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-slate-400">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
            <p className="text-xs">Sincronizando estado con el bot…</p>
          </div>
        )}

        {/* ESTADO 2: CONNECTED -> Muestra Check Verde */}
        {status === "connected" && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            {/* Check verde grande */}
            <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-emerald-400/80 bg-emerald-500/15 text-emerald-400 ring-4 ring-emerald-500/20 shadow-lg shadow-emerald-950/60">
              <svg
                className="h-10 w-10 text-emerald-400 stroke-current"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth="2.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 13l4 4L19 7" />
              </svg>
            </div>

            <div className="space-y-1">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 border border-emerald-400/40 px-3 py-0.5 text-xs font-black text-emerald-300">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>Online</span>
              </div>
              <p className="mt-1 text-sm font-black text-emerald-400">
                ✅ Bot de WhatsApp Conectado
              </p>
              {numero && (
                <p className="mt-1 font-mono text-xs font-bold text-slate-200">
                  +{numero}
                </p>
              )}
              <p className="mt-1 max-w-xs text-[11px] leading-relaxed text-slate-400">
                Tu bot se encuentra activo y listo para publicar y procesar jugadas.
              </p>
            </div>

            {/* Botón Desconectar */}
            <div className="mt-2 pt-2 border-t border-slate-800/80 w-full flex justify-center">
              <button
                type="button"
                onClick={desconectarBot}
                disabled={procesando}
                className="inline-flex items-center gap-2 rounded-xl border border-rose-500/50 bg-rose-950/60 px-4 py-2 text-[11px] font-black text-rose-200 shadow transition hover:bg-rose-900/70 disabled:opacity-40"
              >
                {procesando ? "Desconectando…" : "🔌 Desconectar"}
              </button>
            </div>
          </div>
        )}

        {/* ESTADO 3: QR -> Muestra Código QR con react-qr-code */}
        {status === "qr" && qrValue && (
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <div className="rounded-2xl bg-white p-3.5 shadow-2xl">
              <QRCode
                value={qrValue}
                size={220}
                style={{ height: "auto", maxWidth: "100%", width: "100%" }}
                viewBox="0 0 256 256"
              />
            </div>

            <div className="max-w-xs text-center space-y-1">
              <p className="text-xs font-black text-slate-200">
                Escanea el código QR con tu WhatsApp
              </p>
              <ol className="rounded-xl border border-slate-800 bg-slate-900/60 p-2.5 text-left text-[10px] leading-relaxed text-slate-400 space-y-0.5">
                <li>1. Abre WhatsApp en tu dispositivo.</li>
                <li>2. Toca <strong>Menú</strong> o <strong>Configuración</strong> &gt; <strong>Dispositivos vinculados</strong>.</li>
                <li>3. Toca <strong>Vincular un dispositivo</strong> y apunta tu cámara aquí.</li>
              </ol>
            </div>

            {/* Botón Desconectar / Cancelar */}
            <div className="mt-1 pt-2 border-t border-slate-800/80 w-full flex justify-center">
              <button
                type="button"
                onClick={desconectarBot}
                disabled={procesando}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-1.5 text-[11px] font-bold text-slate-300 transition hover:bg-slate-800 disabled:opacity-40"
              >
                {procesando ? "Cancelando…" : "Cancelar / Reiniciar QR"}
              </button>
            </div>
          </div>
        )}

        {/* ESTADO 4: DISCONNECTED -> Muestra Botón "Conectar Mi Bot" */}
        {status === "disconnected" && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-dashed border-slate-700 bg-slate-900 text-2xl text-slate-400">
              📱
            </div>

            <div>
              <p className="text-xs font-black text-slate-200">
                Bot Desconectado
              </p>
              <p className="mt-1 max-w-xs text-[11px] leading-relaxed text-slate-400">
                Presiona el botón para solicitar un nuevo código QR y conectar tu bot a WhatsApp.
              </p>
            </div>

            <button
              type="button"
              onClick={conectarBot}
              disabled={procesando || !grupo_id}
              className="mt-2 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-black text-white shadow-lg shadow-emerald-900/40 transition hover:bg-emerald-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {procesando ? (
                <>
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  <span>Conectando…</span>
                </>
              ) : (
                <>
                  <span>🚀</span>
                  <span>Conectar Mi Bot</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
