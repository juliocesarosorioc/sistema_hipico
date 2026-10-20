"use client";

/**
 * REPORTE DE MARCAS JUGADAS — el ícono de reporte del modal de Marcas.
 *
 * Es una configuración del reporte genérico `ReporteVentasModal`: la vista
 * (filtros, KPIs, pivot, detalle, impresión) es la MISMA del Reporte de Tablas
 * Fijas vendidas; acá solo se eligen la fuente de datos (`cargarMarcasJugadas`,
 * que lee los tickets de marcas del día de la carrera) y los textos.
 */
import {
  ReporteVentasModal,
  type TemaReporteVentas,
} from "@/features/reportes/components/ReporteVentasModal";
import { cargarMarcasJugadas } from "@/features/marcas/lib/reporte-marcas";

const TEMA_MARCAS: TemaReporteVentas = {
  cabecera: "from-cyan-800 via-teal-700 to-emerald-700",
  activo: "bg-cyan-700 text-white",
  acento: "text-cyan-700",
  seleccion: "bg-cyan-50",
  hover: "hover:bg-cyan-50",
  borde: "border-cyan-200",
};

const ETIQUETAS_MARCAS = {
  conteo: "jugada(s)",
  sinDatos: "Sin marcas jugadas.",
  detalle: "Detalle de marcas jugadas",
};

export type ReporteMarcasJugadasModalProps = {
  abierto: boolean;
  onCerrar: () => void;
  /** Día/filtros que trae el modal de Marcas (se copian al abrir). */
  fechaInicial?: string;
  hipodromoInicial?: string;
  carreraInicial?: string;
};

export function ReporteMarcasJugadasModal(props: ReporteMarcasJugadasModalProps) {
  return (
    <ReporteVentasModal
      {...props}
      cargar={cargarMarcasJugadas}
      titulo="Reporte de Marcas jugadas"
      icono="🏷️"
      producto="marcas"
      tema={TEMA_MARCAS}
      etiquetas={ETIQUETAS_MARCAS}
      textoVacio="No hay marcas jugadas con los filtros actuales."
      textoCargando={(fecha) => `Cargando marcas jugadas del ${fecha}…`}
      notaPie="Montos sin símbolo: la moneda la define el grupo (columna Mon. en el detalle). Balance = en riesgo − pagado − reembolsado. La marca que acierta paga el premio; la que falla deja el monto en Cobrado neto, descontando la comisión por convenio del grupo."
      placeholderResumen="grupo / jugador / hipódromo…"
      placeholderDetalle="marca / jugador / grupo…"
    />
  );
}

export default ReporteMarcasJugadasModal;