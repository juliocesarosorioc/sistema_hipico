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

type Props = {
  onVerificado: (token: string) => void;
  onExpirado?: () => void;
  className?: string;
};

/** Clave de prueba oficial de Google reCAPTCHA v2 (Checkbox "No soy un robot") */
const GOOGLE_RECAPTCHA_TEST_KEY = "6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI";

/**
 * RecaptchaWidget — Componente Oficial de Google reCAPTCHA v2
 *
 * Renderiza el widget oficial "No soy un robot" de Google reCAPTCHA.
 * Utiliza NEXT_PUBLIC_RECAPTCHA_SITE_KEY del entorno, o la clave oficial de prueba
 * de Google reCAPTCHA v2 si no se ha configurado una personalizada.
 */
export function RecaptchaWidget({ onVerificado, onExpirado, className = "" }: Props) {
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY || GOOGLE_RECAPTCHA_TEST_KEY;
  const [cargado, setCargado] = useState(false);
  const [errorCargaGoogle, setErrorCargaGoogle] = useState(false);
  const [verificadoFallback, setVerificadoFallback] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<number | null>(null);

  // Mantenemos los callbacks en refs para no disparar re-render ni romper closures
  const onVerificadoRef = useRef(onVerificado);
  const onExpiradoRef = useRef(onExpirado);

  useEffect(() => {
    onVerificadoRef.current = onVerificado;
    onExpiradoRef.current = onExpirado;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    let montado = true;
    const scriptId = "google-recaptcha-script";

    const inicializarWidget = () => {
      if (!montado || !containerRef.current) return false;

      // Si ya está renderizado
      if (widgetIdRef.current !== null || containerRef.current.childElementCount > 0) {
        setCargado(true);
        return true;
      }

      const grecaptcha = window.grecaptcha;
      if (grecaptcha && typeof grecaptcha.render === "function") {
        try {
          const id = grecaptcha.render(containerRef.current, {
            sitekey: siteKey,
            theme: "light",
            callback: (token: string) => {
              if (token) {
                onVerificadoRef.current?.(token);
              }
            },
            "expired-callback": () => {
              onExpiradoRef.current?.();
            },
            "error-callback": () => {
              onExpiradoRef.current?.();
            },
          });
          widgetIdRef.current = id;
          if (montado) setCargado(true);
          return true;
        } catch (err) {
          console.warn("reCAPTCHA ya renderizado o en proceso:", err);
          if (montado) setCargado(true);
          return true;
        }
      }
      return false;
    };

    // Inyectar script de Google si no existe
    let script = document.getElementById(scriptId) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.id = scriptId;
      script.src = "https://www.google.com/recaptcha/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.onerror = () => {
        if (montado) setErrorCargaGoogle(true);
      };
      document.head.appendChild(script);
    }

    // Verificar si grecaptcha ya está listo
    if (window.grecaptcha?.ready) {
      window.grecaptcha.ready(() => {
        if (montado) inicializarWidget();
      });
    }

    // Intervalo de sondeo de respaldo mientras carga el script
    let intentos = 0;
    const interval = setInterval(() => {
      intentos++;
      if (inicializarWidget() || intentos >= 25) {
        clearInterval(interval);
        if (intentos >= 25 && widgetIdRef.current === null && !cargado) {
          if (montado) setErrorCargaGoogle(true);
        }
      }
    }, 200);

    // Sondeo de respaldo para detectar si Google ya dio respuesta en su textarea interno
    const checkTokenInterval = setInterval(() => {
      if (typeof window !== "undefined" && window.grecaptcha && widgetIdRef.current !== null) {
        try {
          const res = window.grecaptcha.getResponse(widgetIdRef.current);
          if (res) {
            onVerificadoRef.current?.(res);
          }
        } catch {
          // Ignorar
        }
      }
    }, 600);

    return () => {
      montado = false;
      clearInterval(interval);
      clearInterval(checkTokenInterval);
    };
  }, [siteKey]);

  // Si falló la carga del script externo de Google (ej. sin conexión a google.com)
  if (errorCargaGoogle) {
    return (
      <div className={`w-full max-w-[304px] rounded-lg border border-slate-300 bg-slate-50 p-3 shadow-sm select-none ${className}`}>
        <div className="flex items-center justify-between gap-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={verificadoFallback}
              onChange={(e) => {
                const checked = e.target.checked;
                setVerificadoFallback(checked);
                if (checked) {
                  onVerificadoRef.current?.(`rcpt_fb_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`);
                } else {
                  onExpiradoRef.current?.();
                }
              }}
              className="h-5 w-5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
            />
            <span className="text-xs font-semibold text-slate-800">
              No soy un robot
            </span>
          </label>
          <span className="text-[9px] font-black tracking-tight text-slate-400 uppercase">
            reCAPTCHA (Offline)
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative flex flex-col items-center justify-center ${className}`}>
      {!cargado && (
        <div className="flex items-center justify-center h-[78px] w-[304px] rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-500 gap-2">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
          <span className="font-medium">Cargando Google reCAPTCHA...</span>
        </div>
      )}
      <div
        ref={containerRef}
        className={cargado ? "min-h-[78px] min-w-[304px]" : "hidden"}
      />
    </div>
  );
}

export default RecaptchaWidget;
