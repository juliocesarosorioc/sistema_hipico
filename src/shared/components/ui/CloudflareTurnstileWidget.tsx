"use client";

import React, { useState, useEffect, useRef } from "react";

type Props = {
  onVerificado: (token: string) => void;
  onExpirado?: () => void;
  className?: string;
  autoVerificar?: boolean;
};

export function CloudflareTurnstileWidget({
  onVerificado,
  onExpirado,
  className = "",
  autoVerificar = false,
}: Props) {
  const [verificado, setVerificado] = useState(false);
  const [verificando, setVerificando] = useState(false);
  const onVerificadoRef = useRef(onVerificado);
  const onExpiradoRef = useRef(onExpirado);

  useEffect(() => {
    onVerificadoRef.current = onVerificado;
    onExpiradoRef.current = onExpirado;
  });

  const ejecutarVerificacion = () => {
    if (verificado || verificando) return;
    setVerificando(true);
    // Simulación de verificación criptográfica de cabeceras y navegador Cloudflare (450ms)
    setTimeout(() => {
      setVerificando(false);
      setVerificado(true);
      const rayId = Math.random().toString(16).substring(2, 18);
      const token = `cf_turnstile_${Date.now()}_${rayId}`;
      onVerificadoRef.current?.(token);
    }, 450);
  };

  useEffect(() => {
    if (autoVerificar && !verificado && !verificando) {
      const timer = setTimeout(() => {
        ejecutarVerificacion();
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [autoVerificar]);

  return (
    <div
      className={`relative flex h-[68px] w-full max-w-[320px] items-center justify-between rounded-md border border-[#d6d6d6] bg-[#fafafa] px-3.5 py-2 shadow-xs transition-all hover:border-[#b8b8b8] select-none ${className}`}
    >
      {/* Checkbox y Texto interactivo de verificación humana */}
      <div
        onClick={ejecutarVerificacion}
        className="flex items-center gap-3.5 cursor-pointer py-1 flex-1"
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") ejecutarVerificacion();
        }}
      >
        <div className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border-2 border-[#b5b5b5] bg-white transition-all hover:border-[#f38020]">
          {verificando && (
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#f38020] border-t-transparent" />
          )}

          {verificado && (
            <svg
              className="h-6 w-6 text-[#10b981] animate-in zoom-in-75 duration-200"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </div>

        <span className="text-[13px] font-medium text-slate-800 font-sans leading-tight">
          {verificado ? "Verificación completada" : "Verifica que eres humano"}
        </span>
      </div>

      {/* Cloudflare Branding oficial a la derecha */}
      <div className="flex flex-col items-center justify-center pl-3 border-l border-slate-200 shrink-0">
        <svg
          className="h-6 w-7 text-[#f38020]"
          viewBox="0 0 24 24"
          fill="currentColor"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M19.4 11.5c-.3-2.5-2.4-4.5-5-4.5-.7 0-1.4.2-2 .5C11.5 5.2 9.4 4 7 4c-3.3 0-6 2.7-6 6 0 .4 0 .7.1 1.1C.4 11.7 0 12.8 0 14c0 2.2 1.8 4 4 4h15c2.8 0 5-2.2 5-5 0-2.3-1.6-4.2-3.8-4.7-.2-.6-.5-1.2-.8-1.8z" />
        </svg>
        <span className="text-[9px] font-black tracking-tight text-slate-700">
          Cloudflare
        </span>
        <div className="flex gap-1 text-[7px] text-slate-400">
          <span className="hover:underline">Privacidad</span>
          <span>·</span>
          <span className="hover:underline">Términos</span>
        </div>
      </div>
    </div>
  );
}

export default CloudflareTurnstileWidget;
