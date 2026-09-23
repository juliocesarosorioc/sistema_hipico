"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/taquilla", label: "Taquilla" },
  { href: "/boletos", label: "Boletos" },
  { href: "/hipodromos", label: "Hipódromos" },
];

/**
 * Barra superior fija de la SPA.
 * Reservada (estilo casino): saldo del usuario a la derecha + perfil.
 * No desaparece al cambiar de ruta porque vive en el layout raíz.
 */
export function Navbar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-slate-800 bg-slate-950/90 px-4 backdrop-blur">
      <div className="flex items-center gap-1.5 text-sm font-bold text-cyan-400">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-cyan-500/15 text-base">
          🏇
        </span>
        <span className="hidden sm:inline">Sistema Hípico</span>
      </div>

      <nav className="flex items-center gap-1 text-sm">
        {LINKS.map((l) => {
          const activo =
            l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded-lg px-3 py-1.5 transition-colors ${
                activo
                  ? "bg-slate-800 font-semibold text-white"
                  : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
              }`}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex items-center gap-2">
        {/* Saldo del usuario (wired al store de sesión en fases siguientes) */}
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-400">
          $ 0.00
        </span>
        <span className="grid h-8 w-8 place-items-center rounded-full bg-slate-800 text-sm font-bold text-slate-300">
          U
        </span>
      </div>
    </header>
  );
}
