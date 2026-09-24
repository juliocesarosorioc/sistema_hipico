"use client";

import { RutaProtegida } from "@/components/ui/RutaProtegida";
import { ClientesModule } from "@/components/clientes/ClientesModule";

/**
 * Ruta Gestión de Clientes (Admin) — tarea 5:
 *  - Cartera + registro de clientes/socios
 *  - Modal "Portal de Consulta del Cliente" (token + clave + enlace corto)
 *  - Estado de cuenta dinámico (acordeón Grupo > Semana > Día > Hipódromo > Carrera > Jugada)
 *  - Notificaciones del Portal (solicitudes de datos + reclamos como alertas)
 */
export default function ClientesPage() {
  return (
    <RutaProtegida permiso="gestionar_clientes">
      <div className="p-4 lg:p-6">
        <ClientesModule />
      </div>
    </RutaProtegida>
  );
}