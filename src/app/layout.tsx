import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthBootstrap } from "@/features/auth/components/AuthBootstrap";
import { AppShell } from "@/shared/components/layout/AppShell";

// Fuente principal de la plataforma: Inter (mejor legibilidad en interfaces
// densas con números y tablas). Se sirve autoalojada por next/font; si no hay
// red en el build, cae a la pila de sistema definida en globals.css.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

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
    <html lang="es" className={inter.variable}>
      <body>
        <AuthBootstrap />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}