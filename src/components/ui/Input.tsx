import type { InputHTMLAttributes } from "react";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  hint?: string;
};

/** Input limpio del Design System (paleta semántica tailwind.config). */
export function Input({ label, hint, id, className = "", ...rest }: Props) {
  const inputId = id ?? (label ? label.toLowerCase().replace(/[^a-z0-9]+/g, "-") : undefined);
  return (
    <label htmlFor={inputId} className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600">
      {label ? <span>{label}</span> : null}
      <input
        id={inputId}
        className={`rounded-lg border border-line bg-surface px-3 py-2 text-sm text-slate-900
          placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500
          ${className}`}
        {...rest}
      />
      {hint ? <span className="text-[10px] font-normal text-slate-500">{hint}</span> : null}
    </label>
  );
}

export default Input;