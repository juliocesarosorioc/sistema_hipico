import type { Metadata, Viewport } from "next";
import React from "react";
import { IdleSessionTimer } from "@/features/auth/components/IdleSessionTimer";
import { GuardiaSesionNavegador } from "@/features/auth/components/GuardiaSesionNavegador";

export const dynamic = "force-dynamic";


export const metadata: Metadata = {
  title: "Sala de Juegos · Agente IA Oficial",
  description: "Sala de juegos oficial hípica P2P estilo WhatsApp con Agente IA Autónomo.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Sala de Juegos",
  },
};

export const viewport: Viewport = {
  themeColor: "#008069",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function SalaLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Helvetica, Arial, sans-serif',
      }}
      className="antialiased"
    >
      {children}
      <IdleSessionTimer timeoutMs={300000} warningMs={60000} />
      <GuardiaSesionNavegador />
    </div>
  );
}
