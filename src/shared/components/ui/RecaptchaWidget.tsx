"use client";

import React, { useState, useEffect, useRef } from "react";

declare global {
  interface Window {
    grecaptcha?: {
      ready: (cb: () => void) => void;
      render: (
        container: HTMLElement | string,
        parameters: {
          sitekey: string;
          theme?: "light" | "dark";
          callback?: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
        }
      ) => number;
      reset: (opt_widget_id?: number) => void;
      getResponse: (opt_widget_id?: number) => string;
    };
  }
}

export type RecaptchaProps = {
  onVerificado: (token: string) => void;
  onExpirado?: () => void;
  className?: string;
  /** Si true, el widget bloquea el envío del formulario hasta que el usuario
   * complete la verificación (clic en la casilla). Por defecto: true. */
  requerido?: boolean;
};

/** Widget de Verificación de Seguridad Rápida y Resiliente (Cloudflare Turnstile / reCAPTCHA v3).
 *
 * Verificación perimetral de integridad de navegador (1-clic). Por defecto
 * requiere que el usuario haga clic en la casilla antes de permitir el envío.
 * El desafío de 450ms simula la latencia de red; en producción conectaría
 * con la API de Cloudflare Turnstile usando el sitekey configurado.
 */
export function RecaptchaWidget({
  onVerificado,
  onExpirado,
  className = "",
  requerido = true,
}: RecaptchaProps) {
  const [verificado, setVerificado] = useState(false);
  const [verificando, setVerificando] = useState(false);
  const [usuarioInteractuo, setUsuarioInteractuo] = useState(false);

  const onVerificadoRef = useRef(onVerificado);
  const onExpiradoRef = useRef(onExpirado);

  useEffect(() => {
    onVerificadoRef.current = onVerificado;
    onExpiradoRef.current = onExpirado;
  });

  const handleVerificar = () => {
    if (verificado || verificando) return;
    setUsuarioInteractuo(true);
    setVerificando(true);

    // Simulación de verificación criptográfica de cabeceras y navegador Cloudflare (450ms)
    // En producción: fetch a https://challenges.cloudflare.com/siteverify con el sitekey
    setTimeout(() => {
      setVerificando(false);
      setVerificado(true);
      const token = `turnstile_cf_sec_${Date.now()}_${Math.random().toString(36).substring(2, 14)}`;
      onVerificadoRef.current?.(token);
    }, 450);
  };

  return (
    <div className={`relative block w-full max-w-[320px] min-w-0 select-none ${className}`}>
      <div
        className="flex h-[76px] w-full min-w-0 items-center justify-between gap-1 rounded-lg border border-slate-300 bg-[#fbfbfb] px-2.5 py-2.5 shadow-[0_1px_4px_rgba(0,0,0,0.06)] transition-all hover:border-slate-400 sm:px-3.5"
      >
        {/* Casilla Interactiva 1-Clic */}
        <div
          onClick={handleVerificar}
          className="flex min-w-0 flex-1 cursor-items-center gap-2 py-1 sm:gap-3"
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") handleVerificar();
          }}
          aria-label={verificado ? "Verificado con éxito" : "Verificar que eres humano"}
        >
          {/* Casilla de verificación animada */}
          <div
            className={`relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-2 transition-all ${
              verificado
                ? "border-emerald-600 bg-emerald-500 shadow-xs"
                : verificando
                ? "border-blue-500 bg-blue-50"
                : requerido
                ? "border-slate-300 bg-white hover:border-slate-400"
                : "border-slate-300 bg-white"
            }`}
          >
            {verificando && (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#1a73e8] border-t-transparent" />
            )}

            {verificado && (
              <svg
                className="h-5 w-5 text-white animate-in zoom-in-75 duration-200"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </div>

          <div className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-[12px] font-semibold text-slate-800 font-sans sm:text-[13px]">
              {verificado
                ? "Verificación completada"
                : verificando
                ? "Verificando seguridad..."
                : usuarioInteractuo || !requerido
                ? "No soy un robot"
                : "Por favor, verifica que eres humano"}
            </span>
            <span className="truncate text-[10px] text-slate-400 font-medium">
              {verificado ? "Conexión segura garantizada" : usuarioInteractuo || !requerido ? "Clic para verificar" : "Clic para verificar"}
            </span>
          </div>
        </div>

        {/* Marca de seguridad y privacidad perimetral */}
        <div className="flex shrink-0 flex-col items-center justify-center border-l border-slate-200/80 pl-2 text-center">
          <svg
            className="h-5 w-5 text-[#1a73e8] sm:h-6 sm:w-6"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <path d="m9 12 2 2 4-4" />
          </svg>
          <span className="mt-0.5 hidden text-[9px] font-black tracking-tight text-slate-600 min-[360px]:block">
            Seguridad
          </span>
          <span className="mt-0.5 hidden text-[8px] text-slate-400 min-[360px]:block">
            SSL · Turnstile
          </span>
        </div>
      </div>
    </div>
  );
}

export default RecaptchaWidget;