"use client";

import { useEffect, useState } from "react";

type Toast = { id: number; msg: string; tipo: "success" | "warning" | "error" | "info" };

const COLORES: Record<Toast["tipo"], string> = {
  success: "border-emerald-300 bg-emerald-50 text-emerald-800",
  warning: "border-amber-300 bg-amber-50 text-amber-800",
  error: "border-red-300 bg-red-50 text-red-800",
  info: "border-indigo-300 bg-indigo-50 text-indigo-800",
};

/**
 * Host global de toasts: escucha el CustomEvent "toast" ({msg, tipo}).
 * Se monta una vez en el módulo Tablas Fijas.
 */
export function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent<{ msg?: string; tipo?: Toast["tipo"] }>).detail;
      const msg = detail?.msg ?? "";
      if (!msg) return;
      const id = Date.now() + Math.random();
      setToasts((t) => [...t, { id, msg, tipo: detail?.tipo ?? "info" }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2800);
    };
    window.addEventListener("toast", onToast);
    return () => window.removeEventListener("toast", onToast);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="no-print fixed bottom-4 left-1/2 z-50 flex w-full max-w-sm -translate-x-1/2 flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <div key={t.id} className={`w-full rounded-xl border px-4 py-2.5 text-xs font-bold shadow-lg ${COLORES[t.tipo]}`}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}

export default ToastHost;