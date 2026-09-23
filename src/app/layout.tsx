import type { Metadata } from "next";
import "./globals.css";
import { Navbar } from "@/components/layout/Navbar";
import { Sidebar } from "@/components/layout/Sidebar";

export const metadata: Metadata = {
  title: "Sistema Hípico — Taquilla",
  description: "Plataforma de apuestas hípicas: carreras, hipódromos y boleto de apuestas en tiempo real.",
};

/**
 * Arquitectura raíz de la SPA (App Router / Next.js).
 * Esqueleto de Organismos que persisten entre rutas:
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  <Navbar/>        — barra superior fija (saldo + perfil)      │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │  <main>{children}</main>  — contenido de la ruta (dashboard,  │
 *   │                              taquilla, hipódromos, etc.)      │
 *   ├───────────────────────────────┬──────────────────────────────┤
 *   │   contenido                    │  <Sidebar/>  panel lateral   │
 *   │                               │  derecho fijo (Bet Slip)      │
 *   └───────────────────────────────┴──────────────────────────────┘
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>
        <div className="flex h-screen overflow-hidden">
          {/* Zona lateral izquierda: contenido de la ruta */}
          <div className="flex-1 flex flex-col min-w-0">
            <Navbar />
            <main className="flex-1 overflow-y-auto">{children}</main>
          </div>

          {/* Zona lateral derecha (persistente): Bet Slip */}
          <Sidebar />
        </div>
      </body>
    </html>
  );
}