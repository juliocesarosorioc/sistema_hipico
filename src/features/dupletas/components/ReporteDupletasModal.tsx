"use client";

/**
 * REPORTE DE DUPLETAS JUGADAS — el botón "📈 Reporte" de la matriz de Dupletas.
 *
 * Es una configuración del reporte genérico `ReporteVentasModal`: la vista
 * (filtros, KPIs, pivot, detalle, impresión) es la misma de Tablas Fijas y
 * Marcas; acá solo se eligen la fuente de datos (`cargarDupletasJugadas`, que
 * lee los tickets `DUPLETA …` del día) y los textos.
 *
 * Aporta a la vista genérica el producto `dupletas`, para que "Cobrado neto"
 * descuente el % de convenio que corresponde a la modalidad.
 */
import {
  ReporteVentasModal,
  type TemaReporteVentas,
} from "@/features/reportes/components/ReporteVentasModal";
import { cargarDupletasJugadas } from "@/features/dupletas/lib/reporte-dupletas";

const TEMA_DUPLETAS: TemaReporteVentas = {
  cabecera: "from-fuchsia-800 via-purple-700 to-indigo-700",
  activo: "bg-fuchsia-700 text-white",
  acento: "text-fuchsia-700",
  seleccion: "bg-fuchsia-50",
  hover: "hover:bg-fuchsia-50",
  borde: "border-fuchsia-200",
};

const ETIQUETAS_DUPLETAS = {
  conteo: "jugada(s)",
  sinDatos: "Sin dupletas jugadas.",
  detalle: "Detalle de dupletas jugadas",
};

/** Tablas propias de la modalidad que refrescan el reporte en vivo. */
const TABLAS_VIVO_DUPLETAS = ["dupletas"] as const;

export type ReporteDupletasModalProps = {
  abierto: boolean;
  onCerrar: () => void;
  /** Día que trae la matriz de Dupletas (se copia al abrir). */
  fechaInicial?: string;
  hipodromoInicial?: string;
  carreraInicial?: string;
};

export function ReporteDupletasModal(props: ReporteDupletasModalProps) {
  return (
    <ReporteVentasModal
      {...props}
      cargar={cargarDupletasJugadas}
      titulo="Reporte de Dupletas jugadas"
      icono="🎯"
      tema={TEMA_DUPLETAS}
      etiquetas={ETIQUETAS_DUPLETAS}
      producto="dupletas"
      tablasVivo={TABLAS_VIVO_DUPLETAS}
      textoVacio="No hay dupletas jugadas con los filtros actuales."
      textoCargando={(fecha) => `Cargando dupletas jugadas del ${fecha}…`}
      notaPie="Montos sin símbolo: la moneda la define el grupo (columna Mon. en el detalle). Balance = en riesgo − pagado − reembolsado. Una dupleta ganadora paga el premio; las demás dejan el monto en Cobrado neto."
      placeholderResumen="grupo / jugador / hipódromo…"
      placeholderDetalle="combinación / jugador / grupo…"
    />
  );
}

export default ReporteDupletasModal;
