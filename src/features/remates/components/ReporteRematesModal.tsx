"use client";

/**
 * REPORTE DE REMATES — el botón "📈 Reporte" del detalle de un remate.
 *
 * Es una configuración del reporte genérico `ReporteVentasModal`. La diferencia
 * con las otras modalidades es contable: en un remate cada ticket es una VENTA,
 * no una apuesta. Por eso el loader (`cargarRematesVendidos`) normaliza los
 * tickets como `Perdedor`: no hay premio que pagar y todo lo vendido entra en
 * "Cobrado neto", descontando el % de convenio del grupo que publicó.
 *
 * Los filtros (día, grupo, jugador, caballo) y el pivot son los mismos de
 * Tablas, Marcas y Dupletas.
 */
import {
  ReporteVentasModal,
  type TemaReporteVentas,
} from "@/features/reportes/components/ReporteVentasModal";
import { cargarRematesVendidos } from "@/features/remates/lib/reporte-remates";

const TEMA_REMATES: TemaReporteVentas = {
  cabecera: "from-amber-700 via-orange-700 to-rose-700",
  activo: "bg-amber-600 text-white",
  acento: "text-amber-700",
  seleccion: "bg-amber-50",
  hover: "hover:bg-amber-50",
  borde: "border-amber-200",
};

const ETIQUETAS_REMATES = {
  conteo: "venta(s)",
  sinDatos: "Sin remates vendidos.",
  detalle: "Detalle de ejemplares rematados",
};

/** Tablas propias de la modalidad que refrescan el reporte en vivo. */
const TABLAS_VIVO_REMATES = ["remates", "remate_pujas"] as const;

export type ReporteRematesModalProps = {
  abierto: boolean;
  onCerrar: () => void;
  /** Día del remate abierto (se copia al abrir). */
  fechaInicial?: string;
  hipodromoInicial?: string;
  carreraInicial?: string;
};

export function ReporteRematesModal(props: ReporteRematesModalProps) {
  return (
    <ReporteVentasModal
      {...props}
      cargar={cargarRematesVendidos}
      titulo="Reporte de Remates vendidos"
      icono="🔨"
      tema={TEMA_REMATES}
      etiquetas={ETIQUETAS_REMATES}
      producto="remates"
      tablasVivo={TABLAS_VIVO_REMATES}
      textoVacio="No hay remates vendidos con los filtros actuales."
      textoCargando={(fecha) => `Cargando remates vendidos del ${fecha}…`}
      notaPie="Cada ticket de remate es una venta: no hay premio que pagar, así que todo el monto entra en Cobrado neto (descontado el % de convenio del grupo). Balance = vendido − reembolsado."
      placeholderResumen="grupo / comprador / hipódromo…"
      placeholderDetalle="ejemplar / comprador / grupo…"
    />
  );
}

export default ReporteRematesModal;
