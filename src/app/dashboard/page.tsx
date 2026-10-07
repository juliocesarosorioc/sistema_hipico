"use client";

import Link from "next/link";
import { Guard } from "@/components/ui/Guard";
import { RutaProtegida } from "@/components/ui/RutaProtegida";
import { capacidadesDeRuta } from "@/lib/seguridad/capacidades";

/**
 * Aterrizaje del Dashboard — ruta real `/dashboard` (fuera del grupo `(dashboard)`,
 * porque los grupos NO aportan segmento de URL: `(dashboard)/page.tsx` sería `/`).
 * Enlaces con <Link> (naveación de App Router); el Bet Slip lateral persiste
 * (layout raíz).
 *
 * Cada acceso se dibuja solo si el usuario tiene la capacidad de esa ruta, y
 * esa capacidad sale del registro maestro: el tablero no decide permisos.
 */
const ATAJOS: Array<{ href: string; emoji: string; titulo: string; detalle: string }> = [
  { href: "/gestion-jugadas", emoji: "🎟️", titulo: "Gestión de Jugadas", detalle: "cargar, editar y liquidar" },
  { href: "/tablas-fijas", emoji: "📋", titulo: "Tablas Fijas", detalle: "ensamblaje y publicación" },
  { href: "/taquilla", emoji: "🎫", titulo: "Taquilla", detalle: "carreras y jugadas" },
  { href: "/ejemplares", emoji: "🏇", titulo: "Ejemplares", detalle: "padrón, gaceta y carreras" },
  { href: "/tickets", emoji: "🛟", titulo: "Tickets", detalle: "reclamos y anulaciones" },
  { href: "/hipodromos", emoji: "🗺️", titulo: "Hipódromos", detalle: "sedes y programa" },
  { href: "/clientes", emoji: "👥", titulo: "Clientes", detalle: "cartera y saldos" },
  { href: "/contabilidad/caja", emoji: "💵", titulo: "Caja", detalle: "saldo y movimientos" },
  { href: "/contabilidad/bancos", emoji: "🏦", titulo: "Bancos", detalle: "depósitos y retiros" },
  { href: "/saldos-reportes", emoji: "📊", titulo: "Liquidación", detalle: "saldos y reportes" },
  { href: "/seguridad", emoji: "🛡️", titulo: "Seguridad", detalle: "módulo maestro" },
];

export default function DashboardHome() {
  return (
    <RutaProtegida>
      <section className="flex flex-col gap-4 p-4">
        <div className="rounded-2xl border border-line bg-surface p-4">
          <h1 className="text-lg font-extrabold text-slate-900">
            Sistema Hípico — Dashboard
          </h1>
          <p className="mt-1 text-xs text-slate-600">
            Ves únicamente los módulos a los que tu tipo de usuario tiene acceso.
            El Boleto de Apuestas permanece abierto a la derecha en toda la
            navegación.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {ATAJOS.map((a) => {
            // Sin puerta registrada, el atajo no se muestra: nunca se ofrece
            // un enlace que el maestro no conoce.
            const cap = capacidadesDeRuta(a.href)[0];
            if (!cap) return null;
            return (
              <Guard key={a.href} permiso={cap}>
                <Link
                  href={a.href}
                  className="rounded-2xl border border-line bg-surface p-4 text-center transition-colors hover:border-primary-500/60 hover:bg-surfaceAlt/80"
                >
                  <span className="block text-3xl">{a.emoji}</span>
                  <span className="mt-2 block text-sm font-bold text-slate-700">
                    {a.titulo}
                  </span>
                  <span className="mt-0.5 block text-[10px] text-slate-500">
                    {a.detalle}
                  </span>
                </Link>
              </Guard>
            );
          })}
        </div>
      </section>
    </RutaProtegida>
  );
}
