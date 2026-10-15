import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "default" | "outline" | "success" | "danger" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children?: ReactNode;
};

/** Variantes del Design System (paleta semántica tailwind.config). */
const VARIANT: Record<ButtonVariant, string> = {
  default: "bg-primary-600 text-white hover:bg-primary-500 focus-visible:ring-primary-500",
  outline: "bg-transparent text-slate-700 border border-line hover:bg-surfaceAlt focus-visible:ring-primary-500",
  success: "bg-success-600 text-white hover:bg-success-500 focus-visible:ring-success-500",
  danger: "bg-danger-600 text-white hover:bg-danger-500 focus-visible:ring-danger-500",
  ghost: "bg-transparent text-slate-600 hover:bg-surfaceAlt focus-visible:ring-primary-500",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "px-2.5 py-1 text-xs",
  md: "px-4 py-2 text-sm",
  lg: "px-5 py-2.5 text-base",
};

export function Button({
  variant = "default",
  size = "md",
  className = "",
  children,
  ...rest
}: Props) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors
        focus:outline-none focus-visible:ring-2 disabled:opacity-50 disabled:cursor-not-allowed
        ${VARIANT[variant]} ${SIZE[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export default Button;