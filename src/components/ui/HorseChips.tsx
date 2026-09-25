"use client";

import { chipsHorseColor, getHorseColor, type HorseColor } from "@/lib/horseColors";

/**
 * ChipField — input "transformado en tiempo real" a chips de colores hípicos.
 * El <input> conserva el caret y la edición completa (texto transparente),
 * mientras un overlay de chips <badges> refleja la interpretación del parser
 * tolerante (separadores / , ; - espacios). Sin bordes ni padding: pensado
 * para incrustarse en la grilla densa estilo Excel de Marcas (y reutilizable
 * en Taquilla).
 */
export function ChipField({
  value,
  onChange,
  placeholder,
  size = "xs",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  size?: "xs" | "sm";
}) {
  const chips = chipsHorseColor(value, size);
  const dim = size === "sm" ? "h-5 w-5 text-xs" : "h-4 w-4 text-[10px]";
  return (
    <div className="relative h-full min-h-[20px] w-full">
      {chips.length > 0 && (
        <div className="pointer-events-none absolute inset-0 flex flex-wrap items-center justify-center gap-0.5 overflow-hidden px-0.5">
          {chips.map(({ num, color, key }) => (
            <ChipNum key={key} num={num} color={color} dim={dim} />
          ))}
        </div>
      )}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={chips.length ? "" : placeholder}
        spellCheck={false}
        autoComplete="off"
        className="relative z-10 h-full w-full bg-transparent text-center text-transparent caret-slate-500 focus:outline-none placeholder:text-slate-300"
      />
    </div>
  );
}

function ChipNum({ num, color, dim }: { num: number; color: HorseColor; dim: string }) {
  return (
    <span
      title={color.label}
      className={`inline-flex ${dim} shrink-0 items-center justify-center rounded-sm border font-bold leading-none ${color.bg} ${color.text} ${color.border}`}
    >
      {num}
    </span>
  );
}

/** Badge ReadOnly: renderiza un solo número como chip (útil en listas impresas/lectura). */
export function HorseBadge({ num }: { num: number | string }) {
  const c = getHorseColor(num);
  return (
    <span
      title={c.label}
      className={`inline-flex h-4 w-4 items-center justify-center rounded-sm border text-[10px] font-bold leading-none ${c.bg} ${c.text} ${c.border}`}
    >
      {num}
    </span>
  );
}