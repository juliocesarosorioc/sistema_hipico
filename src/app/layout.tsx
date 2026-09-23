import type { Metadata } from "next";
import "./globals.css";
import { Navbar } from "@/components/layout/Navbar";
import { BetSlipPanel } from "@/components/betting/BetSlipPanel";

export const metadata: Metadata = {
  title: "Sistema Hípico — Taquilla",
  description: "Plataforma de apuestas hípicas: carreras, hipódromos y boleto de apuestas en tiempo real.",
};

/**
 * Arquitectura raíz de la SPA (App Router / Next.js 15).
 *
 * Estructura en 3 zonas que persisten entre rutas (nunca pierde el contexto de apuesta):
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  <Navbar/>        — barra superior fija (saldo + perfil)      │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │  <main>{children}</main>  — contenido de la ruta (dashboard,  │
 *   │                              taquilla, hipódromos, etc.)      │
 *   ├───────────────────────────────┬──────────────────────────────┤
 *   │   contenido                    │  <BetSlipPanel/>  lateral     │
 *   │                               │  fijo, parte del layout raíz  │
 *   └───────────────────────────────┴──────────────────────────────┘
 *
 * El Bet Slip vive AQUÍ (layout raíz) y NO en una página: por eso no
 * desaparece al cambiar de ruta — es sticky (lateral en md+, dock
 * inferior en móvil) y su estado vive en el store de Zustand.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">
        <div className="flex h-screen overflow-hidden">
          {/* Zona lateral izquierda: contenido de la ruta */}
          <div className="flex-1 flex flex-col min-w-0">
            <Navbar />
            <main className="flex-1 overflow-y-auto">{children}</main>
          </div>

          {/* Zona lateral derecha (persistente): Bet Slip */}
          <BetSlipPanel />
        </div>
      </body>
    </html>
  );
}
