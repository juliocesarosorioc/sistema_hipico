import type { Metadata } from "next";
import "./globals.css";
import { Topbar } from "@/components/layout/Topbar";
import { Sidebar } from "@/components/layout/Sidebar";
import { BetSlipPanel } from "@/components/betting/BetSlipPanel";
import { AuthBootstrap } from "@/components/auth/AuthBootstrap";

export const metadata: Metadata = {
  title: "Club del Dinero — Sistema Hípico",
  description: "Plataforma de apuestas hípicas: carreras, hipódromos y boleto de apuestas en tiempo real.",
};

/**
 * Arquitectura raíz de la SPA (App Router / Next.js) — 3 zonas (clon del legacy):
 *
 *   ┌──────────────┬──────────────────────────────────┬───────────────┐
 *   │  <Sidebar/>  │  <Topbar/>  (notificaciones +    │  <BetSlip/>   │
 *   │  menú 250px  │───────────── logout)             │  boleto der.  │
 *   │  oscuro      │  <main bg-gray-50>{children}     │  (persistente)│
 *   └──────────────┴──────────────────────────────────┴───────────────┘
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
        <div className="flex h-screen overflow-hidden">
          {/* Zona lateral izquierda: menú de navegación (persistente) */}
          <Sidebar />

          {/* Zona central: Topbar + contenido de la ruta (área clara) */}
          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar />
            <main className="flex-1 overflow-y-auto bg-gray-50">{children}</main>
          </div>

          {/* Zona lateral derecha (persistente): Bet Slip / Boleto */}
          <BetSlipPanel />
        </div>
      </body>
    </html>
  );
}