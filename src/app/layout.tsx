import type { Metadata } from "next";
import "./globals.css";
import { AuthBootstrap } from "@/components/auth/AuthBootstrap";
import { AppShell } from "@/components/layout/AppShell";

export const metadata: Metadata = {
  title: "Club del Dinero — Sistema Hípico",
  description: "Plataforma de apuestas hípicas: carreras, hipódromos y boleto de apuestas en tiempo real.",
};

/**
 * Arquitectura raíz de la SPA (App Router / Next.js):
 * - /portal → vista externa standalone (rol Cliente), sin shell administrativo.
 * - resto   → zona de 3 columnas (copia del legacy): Sidebar + Topbar + Bet Slip.
 *   (Ver AppShell, que decide según la ruta.)
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>
        <AuthBootstrap />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}