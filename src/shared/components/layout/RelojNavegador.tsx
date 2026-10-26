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
      className="ml-auto hidden min-w-[235px] shrink-0 items-center justify-end gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-right md:flex"
    >
      <span className="text-xs leading-none" aria-hidden="true">
        🕒
      </span>
      <div className="flex flex-col items-end leading-tight">
        <span className="truncate text-[10px] font-bold text-slate-600">
          {reloj ? reloj.fechaTexto : "Cargando fecha…"}
        </span>
        <span className="font-mono text-[11px] font-black tabular-nums tracking-tight text-slate-900">
          {reloj ? reloj.horaTexto : "--:--:--"}
        </span>
      </div>
    </div>
  );
}

export default RelojNavegador;
