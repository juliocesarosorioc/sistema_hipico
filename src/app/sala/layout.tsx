import type { Metadata, Viewport } from "next";
import React from "react";


export const metadata: Metadata = {
  title: "Sala de Juegos · Agente IA Oficial",
  description: "Sala de juegos oficial hípica P2P estilo WhatsApp con Agente IA Autónomo.",
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
    </div>
  );
}
