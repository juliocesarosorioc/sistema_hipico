import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "success" | "danger" | "ghost" | "outline";
export type ButtonSize = "sm" | "md" | "lg";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children?: ReactNode;
};

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-blue-600 text-white hover:bg-blue-500 focus-visible:ring-blue-500",
  success: "bg-emerald-600 text-white hover:bg-emerald-500 focus-visible:ring-emerald-500",
  danger: "bg-red-600 text-white hover:bg-red-500 focus-visible:ring-red-500",
  ghost: "bg-transparent text-slate-300 hover:bg-slate-800 focus-visible:ring-slate-400",
  outline: "bg-transparent text-slate-200 border border-slate-600 hover:bg-slate-800 focus-visible:ring-slate-400",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "px-2.5 py-1 text-xs",
  md: "px-4 py-2 text-sm",
  lg: "px-5 py-2.5 text-base",
};

export function Button({
  variant = "primary",
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
