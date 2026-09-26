"use client";

import { RutaProtegida } from "@/components/ui/RutaProtegida";
import { DashboardGrupos } from "@/components/dashboard/DashboardGrupos";

/**
 * Vista inicial de los Grupos al iniciar sesión (migración 1:1 del legacy):
 *  - Widget "Semana Activa": estado ABIERTA/CERRADA, rango de fechas, días de
 *    la semana fiscal coloreados (verde/azul/rojo/gris) y edición del ciclo
 *    (dia_inicio_semana / dia_fin_semana).
 *  - Acciones de cierre (Cierre del Día / Cerrar Semana / Semanas Anteriores).
 *  - Cuadrícula de Accesos Rápidos a los módulos.
 */
export default function InicioPage() {
  return (
    <RutaProtegida permiso="acceso_dashboard">
      <DashboardGrupos />
    </RutaProtegida>
  );
}