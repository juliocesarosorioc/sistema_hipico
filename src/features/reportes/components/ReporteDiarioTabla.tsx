"use client";

/**
 * Tabla + KPIs + pie del Reporte Diario y por Carrera.
 *
 * Es solo presentación: los números llegan ya calculados por
 * `armarReporteDiario()` (ver `src/features/reportes/lib/reporte-diario.ts`).
 * Se reusa tal cual desde el módulo del personal (`/reporte-diario`) y desde el
 * Portal del Cliente, cambiando únicamente la "perspectiva":
 *
 *   - "casa"    → Balance = Jugado − Premios − Devolución (lo que queda).
 *   - "cliente" → Balance = Premios + Devolución − Jugado (lo que recibe él).
 *
 * El signo del balance NO cambia: verde si queda a favor de quien mira (>= 0),
 * rojo si no. Cambian las etiquetas y qué suma cada lado.
 */
import {
  formatoDinero,
  type FilaReporteDiario,
  type ReporteDiario,
} from "@/features/reportes/lib/reporte-diario";

type Props = {
  datos: ReporteDiario;
  /** Moneda a mostrar (por defecto USD). */
  moneda?: string;
  perspectiva?: "casa" | "cliente";
};

/** Balance desde el punto de vista de quien mira el reporte. */
function balanceDe(fila: FilaReporteDiario, esCliente: boolean): number {
  return esCliente ? fila.totalPremios + fila.devolucion - fila.totalJugado : fila.balance;
}

const numero = (n: number): string => n.toLocaleString("en-US");

function Kpi({ etiqueta, valor, acento }: { etiqueta: string; valor: string; acento: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3 shadow-sm">
      <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">{etiqueta}</div>
      <div className={`mt-1 text-xl font-black tabular-nums ${acento}`}>{valor}</div>
    </div>
  );
}

export function ReporteDiarioTabla({ datos, moneda = "USD", perspectiva = "casa" }: Props) {
  const esCliente = perspectiva === "cliente";
  const { filas, totales } = datos;
  const dinero = (v: number) => formatoDinero(v, moneda);

  const balanceTotal = balanceDe({ ...totales, hipodromo: "", carrera: 0 }, esCliente);

  const kpis = esCliente
    ? [
        { etiqueta: "Total Jugado", valor: dinero(totales.totalJugado), acento: "text-indigo-700" },
        { etiqueta: "Total Premios", valor: dinero(totales.totalPremios), acento: "text-emerald-700" },
        { etiqueta: "Total Devolución / Incentivo", valor: dinero(totales.devolucion), acento: "text-amber-700" },
        {
          etiqueta: "Balance a tu favor",
          valor: dinero(balanceTotal),
          acento: balanceTotal >= 0 ? "text-emerald-700" : "text-red-600",
        },
      ]
    : [
        { etiqueta: "Total Jugado", valor: dinero(totales.totalJugado), acento: "text-indigo-700" },
        { etiqueta: "Total Premios", valor: dinero(totales.totalPremios), acento: "text-emerald-700" },
        { etiqueta: "Total Devolución Diaria", valor: dinero(totales.devolucion), acento: "text-amber-700" },
        {
          etiqueta: "Balance Neto del Día",
          valor: dinero(balanceTotal),
          acento: balanceTotal >= 0 ? "text-emerald-700" : "text-red-600",
        },
      ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <Kpi key={k.etiqueta} etiqueta={k.etiqueta} valor={k.valor} acento={k.acento} />
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surfaceAlt text-left text-[10px] font-black uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2.5">Hipódromo</th>
                <th className="px-3 py-2.5">Carrera</th>
                <th className="px-3 py-2.5 text-right">Tickets</th>
                <th className="px-3 py-2.5 text-right">Total Jugado</th>
                <th className="px-3 py-2.5 text-right">Total Premios</th>
                <th className="px-3 py-2.5 text-right">Devolución por Carrera</th>
                <th className="px-3 py-2.5 text-right">Balance Neto</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => {
                const balance = balanceDe(f, esCliente);
                return (
                  <tr
                    key={`${f.hipodromo}|${f.carrera}`}
                    className="border-t border-line hover:bg-surfaceAlt/60"
                  >
                    <td className="px-3 py-2 font-semibold text-slate-700">{f.hipodromo}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-500">#{f.carrera}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{numero(f.tickets)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-800">
                      {dinero(f.totalJugado)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-emerald-700">
                      {dinero(f.totalPremios)}
                    </td>
                    <td className="bg-amber-50 px-3 py-2 text-right font-mono tabular-nums font-bold text-amber-700">
                      {dinero(f.devolucion)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono tabular-nums font-bold ${
                        balance >= 0 ? "text-emerald-700" : "text-red-600"
                      }`}
                    >
                      {dinero(balance)}
                    </td>
                  </tr>
                );
              })}

              {filas.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-12 text-center text-slate-400">
                    No hay carreras con jugadas para los filtros elegidos.
                  </td>
                </tr>
              ) : null}
            </tbody>

            {filas.length > 0 ? (
              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-slate-100 text-sm font-black text-slate-800">
                  <td className="px-3 py-3 uppercase tracking-wide" colSpan={2}>
                    Total del día
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{numero(totales.tickets)}</td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums">{dinero(totales.totalJugado)}</td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums text-emerald-700">
                    {dinero(totales.totalPremios)}
                  </td>
                  <td className="bg-amber-100 px-3 py-3 text-right font-mono tabular-nums text-amber-800">
                    {dinero(totales.devolucion)}
                  </td>
                  <td
                    className={`px-3 py-3 text-right font-mono tabular-nums ${
                      balanceTotal >= 0 ? "text-emerald-700" : "text-red-600"
                    }`}
                  >
                    {dinero(balanceTotal)}
                  </td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </div>
    </div>
  );
}
