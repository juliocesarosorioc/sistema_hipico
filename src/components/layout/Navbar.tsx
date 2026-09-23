"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/taquilla", label: "Taquilla" },
  { href: "/ejemplares", label: "Ejemplares" },
  { href: "/boletos", label: "Boletos" },
  { href: "/hipodromos", label: "Hipódromos" },
];

/**
 * Barra superior fija de la SPA (Organismo).
 * Muestra el saldo del usuario; vive en el layout raíz para no perderse al navegar.
 */
export function Navbar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-line bg-background/90 px-4 backdrop-blur">
      <div className="flex items-center gap-1.5 text-sm font-bold text-primary-400">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary-500/15 text-base">
          🏇
        </span>
        <span className="hidden sm:inline">Sistema Hípico</span>
      </div>

      <nav className="flex items-center gap-1 text-sm">
        {LINKS.map((l) => {
          const activo =
            l.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded-lg px-3 py-1.5 transition-colors ${
                activo
                  ? "bg-surfaceAlt font-semibold text-slate-100"
                  : "text-slate-400 hover:bg-surfaceAlt/60 hover:text-slate-200"
              }`}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex items-center gap-2">
        {/* Saldo del usuario (se cablea al store de sesión en fases siguientes) */}
        <span className="inline-flex items-center gap-1 rounded-full bg-success-500/10 px-3 py-1 text-xs font-bold text-success-400">
          $ 0.00
        </span>
        <span className="grid h-8 w-8 place-items-center rounded-full bg-surfaceAlt text-sm font-bold text-slate-300">
          U
        </span>
      </div>
    </header>
  );
}

export default Navbar;