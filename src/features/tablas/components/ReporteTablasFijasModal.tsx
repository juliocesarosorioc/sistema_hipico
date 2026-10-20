"use client";

/**
 * REPORTE DE TABLAS FIJAS VENDIDAS — el ícono del Monitor de Tablas Publicadas.
 *
 * Es una configuración del reporte genérico `ReporteVentasModal`: la vista vive
 * en `@/features/reportes/components/ReporteVentasModal` y acá solo se eligen la
 * fuente de datos (`cargarVentasTablasFijas`, que lee `tickets_apuestas` del día)
 * y los textos que hablan de "tablas fijas". El modelo de fila y la agregación
 * son los de `reporte-tablas-nucleo` (compartidos con el reporte de Marcas).
 */
import { ReporteVentasModal } from "@/features/reportes/components/ReporteVentasModal";
import { cargarVentasTablasFijas } from "@/features/tablas/lib/reporte-tablas";

export type ReporteTablasFijasModalProps = {
  abierto: boolean;
  onCerrar: () => void;
  /** Día/filtros que trae el Monitor (se copian al abrir). */
  fechaInicial?: string;
  hipodromoInicial?: string;
  carreraInicial?: string;
};

export function ReporteTablasFijasModal(props: ReporteTablasFijasModalProps) {
  return (
    <ReporteVentasModal
      {...props}
      cargar={cargarVentasTablasFijas}
      titulo="Reporte de Tablas Fijas vendidas"
      icono="📈"
      producto="tablas"
      textoVacio="No hay tablas fijas vendidas con los filtros actuales."
      textoCargando={(fecha) => `Cargando tablas vendidas del ${fecha}…`}
      placeholderResumen="grupo / jugador / hipódromo…"
      placeholderDetalle="caballo / jugador / grupo…"
    />
  );
}

export default ReporteTablasFijasModal;