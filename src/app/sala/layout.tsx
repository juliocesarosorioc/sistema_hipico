import type { Metadata, Viewport } from "next";
import React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sala WhatsApp · Agente IA Oficial",
  description: "Sala de jugadas oficial hípica P2P estilo WhatsApp con Agente IA Autónomo.",
};

export const viewport: Viewport = {
  themeColor: "#008069",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function SalaLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
