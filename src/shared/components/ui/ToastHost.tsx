"use client";

import { useEffect, useState } from "react";
import {
  CLASE_MENSAJE,
  ICONO_MENSAJE,
  normalizarTipo,
  type TipoMensaje,
} from "@/shared/lib/mensajeria";

type Toast = { id: number; msg: string; tipo: TipoMensaje };

/**
 * Host global de toasts: escucha el CustomEvent "toast" ({msg, tipo}).
 * Se monta una vez por pantalla (Tablas, Hipódromos, Grupos, ...).
 *
 * El estilo NO vive acá: sale de las clases centralizadas `.msg` + `.msg-*`
 * de globals.css, así que un toast de éxito se ve idéntico en TODA la
 * plataforma. El ícono también es el mismo por tipo.
 */
export function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent<{ msg?: string; tipo?: string }>).detail;
      const msg = detail?.msg ?? "";
      if (!msg) return;
      const id = Date.now() + Math.random();
      setToasts((t) => [...t, { id, msg, tipo: normalizarTipo(detail?.tipo) }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
    };
    window.addEventListener("toast", onToast);
    return () => window.removeEventListener("toast", onToast);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      className="no-print fixed bottom-4 left-1/2 z-50 flex w-full max-w-sm -translate-x-1/2 flex-col items-center gap-2 px-4"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div key={t.id} className={`msg w-full ${CLASE_MENSAJE[t.tipo]}`}>
          <span className="msg-icono" aria-hidden="true">
            {ICONO_MENSAJE[t.tipo]}
          </span>
          <span className="msg-texto">{t.msg}</span>
        </div>
      ))}
    </div>
  );
}

export default ToastHost;
