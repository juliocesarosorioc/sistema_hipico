"use client";

import React from "react";
import { SalaWhatsAppApp } from "@/features/whatsapp-sala/components/SalaWhatsAppApp";

/**
 * /sala — Sala de Jugadas Móvil PWA con Interfaz WhatsApp y Agente IA Autónomo.
 * Totalmente aislada del dashboard para no interferir con las pantallas administrativas.
 */
export default function SalaWhatsAppPage() {
  return (
    <main className="h-[100dvh] w-screen overflow-hidden bg-[#111b21]">
      <SalaWhatsAppApp />
    </main>
  );
}
