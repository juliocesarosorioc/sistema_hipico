export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      {/* Línea 1 — carrera en vivo (se puebla desde store/APAC) */}
      <section
        aria-label="Resumen del día"
        className="rounded-2xl border border-line bg-surface p-4"
      >
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
          Hoy en el hipódromo
        </h2>
        <p className="mt-1 text-[13px] font-bold text-slate-700">
          Sigue cada carrera en “Taquilla” y agrega tus jugadas al boleto.
        </p>
      </section>

      {/* El Bet Slip panel lateral NO va aquí: vive en el layout raíz,
          por eso persiste entre rutas sin recarga (requisito de la SPA). */}
      {children}
    </div>
  );
}