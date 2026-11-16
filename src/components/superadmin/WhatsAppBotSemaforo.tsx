"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";

const CONTABO_IP = "80.190.77.210";
const BOT_SERVER_URL = process.env.NEXT_PUBLIC_BOT_URL || `http://${CONTABO_IP}:3005`;

export interface WhatsAppBotSemaforoProps {
  grupo_id: string;
  onStatusChange?: (status: "connected" | "qr" | "disconnected") => void;
  className?: string;
}

export type BotSemaforoStatus = "connected" | "qr" | "disconnected" | "loading";

export default function WhatsAppBotSemaforo({
  grupo_id,
  onStatusChange,
  className = "",
}: WhatsAppBotSemaforoProps) {
  const [status, setStatus] = useState<BotSemaforoStatus>("loading");
  const [numero, setNumero] = useState<string | null>(null);
  const isMounted = useRef<boolean>(true);

  // Polling cada 5 segundos a http://80.190.77.210:3005/api/whatsapp/status?session_id={grupo_id}
  const consultarSemaforo = useCallback(async () => {
    if (!grupo_id) return;
    try {
      let res: Response | null = null;
      try {
        res = await fetch(`${BOT_SERVER_URL}/api/whatsapp/status?session_id=${encodeURIComponent(grupo_id)}`, {
          cache: "no-store",
        });
      } catch {
        // Fallback al proxy Next.js si la IP directa es inaccesible desde el navegador cliente
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

        let nuevoEstado: BotSemaforoStatus = "disconnected";
        if (conectado) {
          nuevoEstado = "connected";
        } else if (rawStatus === "qr" || qrRaw) {
          nuevoEstado = "qr";
        } else {
          nuevoEstado = "disconnected";
        }

        setStatus(nuevoEstado);
        setNumero(data?.numero || data?.numeroVinculado || null);
        onStatusChange?.(nuevoEstado);
      } else {
        if (!isMounted.current) return;
        setStatus("disconnected");
        onStatusChange?.("disconnected");
      }
    } catch {
      if (!isMounted.current) return;
      setStatus("disconnected");
      onStatusChange?.("disconnected");
    }
  }, [grupo_id, onStatusChange]);

  useEffect(() => {
    isMounted.current = true;
    void consultarSemaforo();

    const interval = setInterval(() => {
      void consultarSemaforo();
    }, 5000);

    return () => {
      isMounted.current = false;
      clearInterval(interval);
    };
  }, [consultarSemaforo]);

  return (
    <div className={`flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/60 p-2.5 ${className}`}>
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-400 font-medium">Bot WA:</span>
        {status === "loading" && (
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-400 font-bold">
            <span className="h-2 w-2 rounded-full bg-slate-500 animate-ping" />
            <span>Consultando…</span>
          </span>
        )}

        {/* 🟢 Conectado */}
        {status === "connected" && (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs font-black text-emerald-300">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse shadow-sm shadow-emerald-400" />
            <span>🟢 Conectado</span>
          </span>
        )}

        {/* 🟡 Escaneando */}
        {status === "qr" && (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-black text-amber-300">
            <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse shadow-sm shadow-amber-400" />
            <span>🟡 Escaneando QR</span>
          </span>
        )}

        {/* 🔴 Desconectado */}
        {status === "disconnected" && (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-xs font-black text-rose-300">
            <span className="h-2 w-2 rounded-full bg-rose-500" />
            <span>🔴 Desconectado</span>
          </span>
        )}
      </div>

      {numero && status === "connected" && (
        <span className="font-mono text-[10px] text-slate-400">
          +{numero}
        </span>
      )}
    </div>
  );
}
