import type { HTMLAttributes, ReactNode } from "react";

type Props = HTMLAttributes<HTMLDivElement> & {
  children?: ReactNode;
};

/** Tarjeta base del Design System (paleta semántica tailwind.config). */
export function Card({ children, className = "", ...rest }: Props) {
  return (
    <div
      className={`rounded-2xl border border-line bg-surface ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

export default Card;