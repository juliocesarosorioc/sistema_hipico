const ESTADOS: Record<string, string> = {
  pendiente: "border-amber-300 bg-amber-100 text-amber-800 hover:bg-amber-200",
  pending: "border-amber-300 bg-amber-100 text-amber-800 hover:bg-amber-200",
  abierta: "border-emerald-300 bg-emerald-100 text-emerald-800 hover:bg-emerald-200",
  open: "border-emerald-300 bg-emerald-100 text-emerald-800 hover:bg-emerald-200",
  cerrada: "border-red-300 bg-red-100 text-red-800 line-through hover:bg-red-200",
  closed: "border-red-300 bg-red-100 text-red-800 line-through hover:bg-red-200",
};

const BASE =
  "inline-flex flex-col items-center justify-center gap-0.5 rounded-lg border px-2 py-1 text-center select-none transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500";

/**
 * Botón de cuota de un caballo.
 * Verde = carrera abierta (apostable) · Ámbar = pendiente · Rojo/tachado = cerrada.
 */
export function OddsButton({
  cuota,
  label,
  estado = "pendiente",
  onClick,
  disabled = false,
  className = "",
}: {
  cuota: number;
  label?: string;
  estado?: string;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const cls = ESTADOS[estado] ?? ESTADOS.pendiente;
  const cerrada =
    disabled ||
    estado === "cerrada" ||
    estado === "closed" ||
    estado === "finalizada";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={cerrada}
      className={`${BASE} ${cls} ${className}`}
    >
      <span className="text-sm font-extrabold leading-none">{cuota.toFixed(2)}</span>
      {label ? (
        <span className="text-[9px] font-semibold uppercase opacity-70">{label}</span>
      ) : null}
    </button>
  );
}

export default OddsButton;
