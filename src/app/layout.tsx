import type { Metadata } from "next";
import "./globals.css";
import { AuthBootstrap } from "@/features/auth/components/AuthBootstrap";
import { AppShell } from "@/shared/components/layout/AppShell";
import { AvisoSinCredenciales } from "@/shared/components/layout/AvisoSinCredenciales";

// Fuente principal de la plataforma: Inter (pila de sistema definida en globals.css,
// sin depender de descarga externa de Google Fonts en builds sin red).
const inter = {
  variable: "font-sans",
};

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
        {/* Si faltan las credenciales de Supabase, la app entera entra en
            "modo local" y parece no abrir. Este banner dice POR QUÉ, en
            cualquier pantalla. Ver AvisoSinCredenciales. */}
        <AvisoSinCredenciales />
        <AuthBootstrap />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}