"use client";

import { PortalModule } from "@/components/portal/PortalModule";

/**
 * /portal — Portal de Consulta del Cliente (vista externa standalone).
 * AppShell lo renderiza sin Sidebar/Topbar/BetSlip. Ver src/components/layout/AppShell.tsx
 */
export default function PortalPage() {
  return <PortalModule />;
}