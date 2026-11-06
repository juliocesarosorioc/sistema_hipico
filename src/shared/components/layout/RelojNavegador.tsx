"use client";

import { useEffect, useState } from "react";

/**
 * Formatea una fecha/hora con la fecha completa en español y la hora exacta
 * con minutos y segundos (`HH:mm:ss`).
 */
export function formatearRelojNavegador(ahora: Date = new Date()): {
  fechaTexto: string;
  horaTexto: string;
} {
  try {
    const fechaRaw = new Intl.DateTimeFormat("es-VE", {
      timeZone: "America/Caracas",
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(ahora);
    const fechaTexto = fechaRaw.charAt(0).toUpperCase() + fechaRaw.slice(1);

    const horaTexto = new Intl.DateTimeFormat("es-VE", {
      timeZone: "America/Caracas",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }).format(ahora);

    return { fechaTexto, horaTexto };
  } catch {
    const pad = (n: number) => String(n).padStart(2, "0");
    return {
      fechaTexto: ahora.toLocaleDateString("es-ES"),
      horaTexto: `${pad(ahora.getHours())}:${pad(ahora.getMinutes())}:${pad(ahora.getSeconds())}`,
    };
  }
}

/**
 * Reloj en vivo segundo a segundo (`setInterval(..., 1000)`) ubicado en la parte
 * superior derecha del navegador (`Topbar`), con ancho fijo y `tabular-nums`
 * para evitar saltos o reflujos del layout.
 */
export function RelojNavegador() {
  const [reloj, setReloj] = useState<{ fechaTexto: string; horaTexto: string } | null>(null);

  useEffect(() => {
    setReloj(formatearRelojNavegador(new Date()));
    const timer = window.setInterval(() => {
      setReloj(formatearRelojNavegador(new Date()));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div
      aria-label="Fecha y hora actual del sistema"
      className="ml-auto hidden shrink-0 items-center justify-end rounded-lg border border-line bg-surfaceAlt px-2 py-1 text-right xl:flex"
    >
      {/* Vista Compacta (Hora únicamente) para pantallas medianas / con sidebar abierto */}
      <div className="flex 2xl:hidden items-center gap-1.5 font-mono text-[11px] font-black tabular-nums tracking-tight text-[var(--app-text)]">
        <span className="text-xs leading-none" aria-hidden="true">🕒</span>
        <span>{reloj ? reloj.horaTexto : "--:--:--"}</span>
      </div>

      {/* Vista Completa (Fecha completa + Hora) en pantallas grandes 2xl (>1536px) */}
      <div className="hidden 2xl:flex items-center gap-2 min-w-[210px] justify-end">
        <span className="text-xs leading-none" aria-hidden="true">
          🕒
        </span>
        <div className="flex flex-col items-end leading-tight">
          <span className="truncate text-[10px] font-bold text-[var(--app-text-muted)]">
            {reloj ? reloj.fechaTexto : "Cargando fecha…"}
          </span>
          <span className="font-mono text-[11px] font-black tabular-nums tracking-tight text-[var(--app-text)]">
            {reloj ? reloj.horaTexto : "--:--:--"}
          </span>
        </div>
      </div>
    </div>
  );
}

export default RelojNavegador;
