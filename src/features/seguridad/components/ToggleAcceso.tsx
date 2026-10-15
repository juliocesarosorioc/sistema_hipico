"use client";

type Props = {
  activo: boolean;
  onChange: (activo: boolean) => void;
  label: string;
};

/** Toggle switch (checkbox estilizado) para la matriz de accesos. */
export function ToggleAcceso({ activo, onChange, label }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={activo}
      aria-label={label}
      onClick={() => onChange(!activo)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
        activo ? "bg-emerald-500" : "bg-slate-300"
      }`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
          activo ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

export default ToggleAcceso;