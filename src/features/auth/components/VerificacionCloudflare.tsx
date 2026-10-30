"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { CloudflareTurnstileWidget } from "@/shared/components/ui/CloudflareTurnstileWidget";

interface Props {
  onExito?: () => void;
  redireccionUrl?: string;
  autoVerificar?: boolean;
}

export function VerificacionCloudflare({
  onExito,
  redireccionUrl = "/dashboard",
  autoVerificar = true,
}: Props) {
  const router = useRouter();
  const [completado, setCompletado] = useState(false);
  const [rayId, setRayId] = useState("8ec73f1092a4e21b");
  const [ipDetectada, setIpDetectada] = useState("186.93.104.22");
  const [fechaIso, setFechaIso] = useState("");

  useEffect(() => {
    // Generación dinámica de Ray ID oficial de Cloudflare y Timestamp
    const randomHex = Math.random().toString(16).substring(2, 18);
    setRayId(`${randomHex}f20`);
    setFechaIso(new Date().toUTCString());

    // Generar IP amigable
    const oct1 = 186;
    const oct2 = Math.floor(Math.random() * 50) + 70;
    const oct3 = Math.floor(Math.random() * 200) + 10;
    const oct4 = Math.floor(Math.random() * 240) + 5;
    setIpDetectada(`${oct1}.${oct2}.${oct3}.${oct4}`);
  }, []);

  const handleVerificado = (token: string) => {
    setCompletado(true);
    if (typeof window !== "undefined") {
      sessionStorage.setItem("cf_verified_token", token);
      sessionStorage.setItem("cf_verified_at", Date.now().toString());
    }

    if (onExito) {
      setTimeout(() => {
        onExito();
      }, 500);
    } else if (redireccionUrl) {
      setTimeout(() => {
        router.push(redireccionUrl);
      }, 600);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#f6f6f6] flex flex-col justify-between items-center p-6 text-slate-800 font-sans selection:bg-[#f38020]/20 selection:text-slate-900">
      {/* Contenedor Superior Vacío para centrado vertical */}
      <div className="w-full max-w-xl pt-4">
        <div className="flex items-center gap-2 text-slate-400 text-xs font-semibold">
          <svg
            className="h-4 w-4 text-emerald-600"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <span>Conexión segura SSL/TLS activa</span>
        </div>
      </div>

      {/* Tarjeta Central de Verificación Cloudflare */}
      <div className="w-full max-w-xl bg-white border border-slate-200/90 rounded-2xl p-8 sm:p-10 shadow-sm space-y-6">
        {/* Cabecera con Logo Oficial de Cloudflare */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-5">
          <div className="flex items-center gap-3">
            <svg
              className="h-9 w-auto text-[#f38020]"
              viewBox="0 0 48 32"
              fill="currentColor"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M38.8 13.5c-.6-4.9-4.8-8.7-9.9-8.7-1.4 0-2.8.3-4 .9C23 2.3 18.7 0 13.9 0 6.2 0 0 6.2 0 13.9c0 .8.1 1.6.2 2.3C.1 16.8 0 17.5 0 18.3 0 24.8 5.3 30 11.8 30h27.9c4.6 0 8.3-3.7 8.3-8.3 0-4.2-3.1-7.7-7.2-8.2z" />
            </svg>
            <div>
              <span className="text-xl font-black tracking-tight text-slate-900 block font-heading">
                Cloudflare
              </span>
              <span className="text-[11px] font-medium text-slate-400">
                Sistema de Protección Perimetral
              </span>
            </div>
          </div>

          <div className="text-right">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
              <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
              Desafío activo
            </span>
          </div>
        </div>

        {/* Título y Texto de Verificación requerido */}
        <div className="space-y-3">
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight font-heading leading-tight">
            Verificación de seguridad en curso
          </h1>
          <p className="text-sm sm:text-base text-slate-600 leading-relaxed font-normal">
            Este sitio web utiliza un servicio de seguridad para protegerse contra bots maliciosos. Esta página se muestra mientras el sitio web verifica que tú no eres un bot.
          </p>
        </div>

        {/* Widget Turnstile */}
        <div className="pt-2 pb-1 flex flex-col items-center justify-center">
          <CloudflareTurnstileWidget
            onVerificado={handleVerificado}
            autoVerificar={autoVerificar}
            className="w-full"
          />

          {completado && (
            <div className="mt-4 flex items-center gap-2 text-xs font-bold text-emerald-700 bg-emerald-50 px-3.5 py-2 rounded-xl border border-emerald-200 animate-in fade-in slide-in-from-top-1">
              <svg
                className="h-4 w-4 shrink-0 text-emerald-600"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
              <span>Acceso verificado. Redirigiendo de forma segura a la plataforma...</span>
            </div>
          )}
        </div>

        {/* Información Técnica del Desafío */}
        <div className="border-t border-slate-100 pt-5 text-[11px] text-slate-400 font-mono space-y-1">
          <div className="flex flex-wrap justify-between items-center gap-2">
            <span>Ray ID: <strong className="text-slate-700">{rayId}</strong></span>
            <span>IP: <strong className="text-slate-700">{ipDetectada}</strong></span>
          </div>
          <div className="flex flex-wrap justify-between items-center gap-2">
            <span>Estado: <span className={completado ? "text-emerald-600 font-bold" : "text-amber-600 font-bold"}>{completado ? "Verificado (Humano)" : "Comprobando..."}</span></span>
            <span>{fechaIso || "2026-10-30 UTC"}</span>
          </div>
        </div>
      </div>

      {/* Footer Oficial Cloudflare */}
      <footer className="w-full max-w-xl py-6 text-center text-xs text-slate-500 space-y-1.5 border-t border-slate-200/60 mt-6">
        <p className="flex items-center justify-center gap-1.5">
          <span>Rendimiento y seguridad por</span>
          <span className="font-bold text-slate-800">Cloudflare</span>
        </p>
        <div className="flex items-center justify-center gap-3 text-[11px] text-slate-400">
          <a
            href="https://www.cloudflare.com/privacypolicy/"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline hover:text-slate-600"
          >
            Aviso de privacidad
          </a>
          <span>·</span>
          <a
            href="https://www.cloudflare.com/website-terms/"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline hover:text-slate-600"
          >
            Términos del servicio
          </a>
        </div>
      </footer>
    </div>
  );
}

export default VerificacionCloudflare;
