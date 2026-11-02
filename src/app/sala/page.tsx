"use client";

import React, { useEffect, useState } from "react";
import Head from "next/head";
import { SalaWhatsAppApp } from "@/features/whatsapp-sala/components/SalaWhatsAppApp";

/**
 * /sala — Sala de Jugadas Móvil PWA con Interfaz WhatsApp y Agente IA Autónomo.
 * Totalmente aislada del dashboard para no interferir con las pantallas existentes.
 */
export default function SalaWhatsAppPage() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#111b21] text-white font-sans">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#00a884] border-t-transparent" />
          <span className="text-sm font-medium tracking-wide text-[#8696a0]">Cargando Sala WhatsApp...</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Sala WhatsApp · Agente IA Oficial</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
        <meta name="theme-color" content="#008069" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </Head>
      <main className="h-screen w-screen overflow-hidden bg-[#efeae2]">
        <SalaWhatsAppApp />
      </main>
    </>
  );
}
