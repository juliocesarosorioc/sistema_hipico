/**
 * Aterrizaje del Dashboard (grupo (dashboard)).
 * Server Component puro — sin imports propios. El acceso a módulos usa
 * enlaces nativos <a>; el Bet Slip lateral persiste (layout raíz), por eso
 * no se agrega panel aquí.
 */
export default function DashboardHome() {
  return (
    <section className="flex flex-col gap-4 p-4">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
        <h1 className="text-lg font-extrabold text-slate-100">
          Sistema Hípico — Dashboard
        </h1>
        <p className="mt-1 text-xs text-slate-400">
          Selecciona un módulo. El Boleto de Apuestas permanece abierto a la
          derecha en toda la navegación.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <a
          href="/taquilla"
          className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-center transition-colors hover:border-slate-600 hover:bg-slate-800/80"
        >
          <span className="block text-3xl">🎟️</span>
          <span className="mt-2 block text-sm font-bold text-slate-200">
            Taquilla
          </span>
          <span className="mt-0.5 block text-[10px] text-slate-500">
            carreras y jugadas
          </span>
        </a>

        <a
          href="/boleto"
          className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-center transition-colors hover:border-slate-600 hover:bg-slate-800/80"
        >
          <span className="block text-3xl">🎟️</span>
          <span className="mt-2 block text-sm font-bold text-slate-200">
            Boleto
          </span>
          <span className="mt-0.5 block text-[10px] text-slate-500">
            historial de apuestas
          </span>
        </a>

        <a
          href="/carreras"
          className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-center transition-colors hover:border-slate-600 hover:bg-slate-800/80"
        >
          <span className="block text-3xl">🏇</span>
          <span className="mt-2 block text-sm font-bold text-slate-200">
            Carreras
          </span>
          <span className="mt-0.5 block text-[10px] text-slate-500">
            del día actual
          </span>
        </a>

        <a
          href="/ranking"
          className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-center transition-colors hover:border-slate-600 hover:bg-slate-800/80"
        >
          <span className="block text-3xl">🏆</span>
          <span className="mt-2 block text-sm font-bold text-slate-200">
            Ranking
          </span>
          <span className="mt-0.5 block text-[10px] text-slate-500">
            mejores jugadores
          </span>
        </a>

        <a
          href="/hipodromos"
          className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-center transition-colors hover:border-slate-600 hover:bg-slate-800/80"
        >
          <span className="block text-3xl">🗺️</span>
          <span className="mt-2 block text-sm font-bold text-slate-200">
            Hipódromos
          </span>
          <span className="mt-0.5 block text-[10px] text-slate-500">
            sedes y programa
          </span>
        </a>

        <a
          href="/caja"
          className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-center transition-colors hover:border-slate-600 hover:bg-slate-800/80"
        >
          <span className="block text-3xl">💵</span>
          <span className="mt-2 block text-sm font-bold text-slate-200">
            Caja
          </span>
          <span className="mt-0.5 block text-[10px] text-slate-500">
            saldo y movimientos
          </span>
        </a>
      </div>
    </section>
  );
}
