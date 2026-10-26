"use client";

/**
 * Tabla Dinámica Jerárquica + KPIs + pie del Reporte Diario y por Carrera.
 *
 * Estructura interactiva de 4 niveles (Tabla Dinámica):
 *   1. Día       → al abrir el día detalla los hipódromos.
 *   2. Hipódromo → al abrir el hipódromo abre las carreras.
 *   3. Carrera   → al abrir la carrera muestra cada jugada individual.
 *   4. Jugada    → muestra hora de carga, jugada/ejemplar, apostó, premio,
 *                  resultado neto, incentivo y la comisión devuelta en caso de que aplique.
 */
import { useEffect, useMemo, useState } from "react";
import {
  formatoDinero,
  type DiaPivotDiario,
  type FilaReporteDiario,
  type HipodromoPivotDiario,
  type ReporteDiario,
} from "@/features/reportes/lib/reporte-diario";

type Props = {
  datos: ReporteDiario;
  /** Moneda a mostrar (por defecto USD). */
  moneda?: string;
  perspectiva?: "casa" | "cliente";
};

/** Balance desde el punto de vista de quien mira el reporte. */
function balanceDe(
  fila: {
    totalJugado: number;
    totalPremios: number;
    devolucion: number;
    comisionDevuelta?: number;
    balance: number;
  },
  esCliente: boolean
): number {
  const comDev = fila.comisionDevuelta ?? 0;
  return esCliente
    ? fila.totalPremios + fila.devolucion + comDev - fila.totalJugado
    : fila.balance - comDev;
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

/** Construye el árbol de días de respaldo si `datos.dias` no vino precalculado (ej. desde RPC). */
function construirArbolDias(datos: ReporteDiario): DiaPivotDiario[] {
  if (datos.dias && datos.dias.length > 0) return datos.dias;
  if (!datos.filas.length) return [];

  const porDia = new Map<string, Map<string, FilaReporteDiario[]>>();
  for (const f of datos.filas) {
    const fecha = f.fecha || "JORNADA";
    if (!porDia.has(fecha)) porDia.set(fecha, new Map());
    const hMap = porDia.get(fecha)!;
    if (!hMap.has(f.hipodromo)) hMap.set(f.hipodromo, []);
    hMap.get(f.hipodromo)!.push(f);
  }

  return [...porDia.entries()].map(([fecha, hMap]) => {
    const hipodromos: HipodromoPivotDiario[] = [...hMap.entries()].map(([hipodromo, carreras]) => {
      const tickets = carreras.reduce((a, c) => a + c.tickets, 0);
      const totalJugado = carreras.reduce((a, c) => a + c.totalJugado, 0);
      const totalPremios = carreras.reduce((a, c) => a + c.totalPremios, 0);
      const devolucion = carreras.reduce((a, c) => a + c.devolucion, 0);
      const comisionDevuelta = carreras.reduce((a, c) => a + (c.comisionDevuelta ?? 0), 0);
      const balance = totalJugado - totalPremios - devolucion;
      return {
        hipodromo,
        carreras,
        tickets,
        totalJugado,
        totalPremios,
        devolucion,
        comisionDevuelta,
        balance,
      };
    });
    const tickets = hipodromos.reduce((a, h) => a + h.tickets, 0);
    const totalJugado = hipodromos.reduce((a, h) => a + h.totalJugado, 0);
    const totalPremios = hipodromos.reduce((a, h) => a + h.totalPremios, 0);
    const devolucion = hipodromos.reduce((a, h) => a + h.devolucion, 0);
    const comisionDevuelta = hipodromos.reduce((a, h) => a + h.comisionDevuelta, 0);
    const balance = totalJugado - totalPremios - devolucion;
    return {
      fecha,
      hipodromos,
      tickets,
      totalJugado,
      totalPremios,
      devolucion,
      comisionDevuelta,
      balance,
    };
  });
}

export function ReporteDiarioTabla({ datos, moneda = "USD", perspectiva = "casa" }: Props) {
  const esCliente = perspectiva === "cliente";
  const { filas, totales } = datos;
  const dinero = (v: number) => formatoDinero(v, moneda);

  const diasArbol = useMemo(() => construirArbolDias(datos), [datos]);

  // Estados de expansión de la Tabla Dinámica (Día → Hipódromo → Carrera)
  const [diasAbiertos, setDiasAbiertos] = useState<Set<string>>(new Set());
  const [hiposAbiertos, setHiposAbiertos] = useState<Set<string>>(new Set());
  const [carrerasAbiertas, setCarrerasAbiertas] = useState<Set<string>>(new Set());

  // Al cambiar los datos, abrimos por defecto el primer día y sus hipódromos
  useEffect(() => {
    if (diasArbol.length > 0) {
      const dSet = new Set<string>([diasArbol[0].fecha]);
      const hSet = new Set<string>();
      for (const h of diasArbol[0].hipodromos) {
        hSet.add(`${diasArbol[0].fecha}|${h.hipodromo}`);
      }
      setDiasAbiertos(dSet);
      setHiposAbiertos(hSet);
    } else {
      setDiasAbiertos(new Set());
      setHiposAbiertos(new Set());
      setCarrerasAbiertas(new Set());
    }
  }, [diasArbol]);

  const toggleDia = (fecha: string) => {
    setDiasAbiertos((prev) => {
      const next = new Set(prev);
      if (next.has(fecha)) next.delete(fecha);
      else next.add(fecha);
      return next;
    });
  };

  const toggleHipo = (key: string) => {
    setHiposAbiertos((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleCarrera = (key: string) => {
    setCarrerasAbiertas((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const expandirTodo = () => {
    const dSet = new Set<string>();
    const hSet = new Set<string>();
    const cSet = new Set<string>();
    for (const d of diasArbol) {
      dSet.add(d.fecha);
      for (const h of d.hipodromos) {
        const hk = `${d.fecha}|${h.hipodromo}`;
        hSet.add(hk);
        for (const c of h.carreras) {
          cSet.add(`${hk}|${c.carrera}`);
        }
      }
    }
    setDiasAbiertos(dSet);
    setHiposAbiertos(hSet);
    setCarrerasAbiertas(cSet);
  };

  const contraerTodo = () => {
    setDiasAbiertos(new Set());
    setHiposAbiertos(new Set());
    setCarrerasAbiertas(new Set());
  };

  const balanceTotal = balanceDe({ ...totales }, esCliente);
  const totalComisionDevuelta = totales.comisionDevuelta ?? 0;

  const kpis = esCliente
    ? [
        { etiqueta: "Total Jugado", valor: dinero(totales.totalJugado), acento: "text-indigo-700" },
        { etiqueta: "Total Premios", valor: dinero(totales.totalPremios), acento: "text-emerald-700" },
        {
          etiqueta:
            totalComisionDevuelta > 0
              ? "🎁 Devolución + Comisión Devuelta"
              : "🎁 Devolución / Incentivo a favor",
          valor: `+${dinero(totales.devolucion + totalComisionDevuelta)}`,
          acento: "text-emerald-700",
        },
        {
          etiqueta: "Balance a tu favor (+ Incentivo)",
          valor: dinero(balanceTotal),
          acento: balanceTotal >= 0 ? "text-emerald-700" : "text-red-600",
        },
      ]
    : [
        { etiqueta: "Total Jugado", valor: dinero(totales.totalJugado), acento: "text-indigo-700" },
        { etiqueta: "Total Premios", valor: dinero(totales.totalPremios), acento: "text-emerald-700" },
        {
          etiqueta:
            totalComisionDevuelta > 0
              ? "🎁 Devolución + Comisión Devuelta"
              : "🎁 Devolución / Incentivo a favor",
          valor: `+${dinero(totales.devolucion + totalComisionDevuelta)}`,
          acento: "text-emerald-700",
        },
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

      {/* Barra de controles de Tabla Dinámica */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
          <span>📊</span>
          <span>Tabla Dinámica:</span>
          <span className="rounded bg-indigo-100 px-2 py-0.5 text-[10px] font-black uppercase text-indigo-800">
            Día → Hipódromo → Carrera → Jugadas
          </span>
        </div>
        {diasArbol.length > 0 && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={expandirTodo}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-100"
            >
              📂 Expandir todo
            </button>
            <button
              type="button"
              onClick={contraerTodo}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-100"
            >
              📁 Contraer todo
            </button>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surfaceAlt text-left text-[10px] font-black uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2.5">Estructura (Día / Hipódromo / Carrera)</th>
                <th className="px-3 py-2.5 text-right">Jugadas</th>
                <th className="px-3 py-2.5 text-right">Total Jugado</th>
                <th className="px-3 py-2.5 text-right">Total Premios</th>
                <th className="px-3 py-2.5 text-right">Devolución</th>
                <th className="px-3 py-2.5 text-right">Comisión Devuelta</th>
                <th className="px-3 py-2.5 text-right">Balance Neto</th>
              </tr>
            </thead>
            <tbody>
              {diasArbol.map((dia) => {
                const diaAbierto = diasAbiertos.has(dia.fecha);
                const balDia = balanceDe(dia, esCliente);
                return (
                  <FragmentDia
                    key={dia.fecha}
                    dia={dia}
                    diaAbierto={diaAbierto}
                    hiposAbiertos={hiposAbiertos}
                    carrerasAbiertas={carrerasAbiertas}
                    esCliente={esCliente}
                    dinero={dinero}
                    balDia={balDia}
                    onToggleDia={() => toggleDia(dia.fecha)}
                    onToggleHipo={toggleHipo}
                    onToggleCarrera={toggleCarrera}
                  />
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
                  <td className="px-3 py-3 uppercase tracking-wide">Total del día</td>
                  <td className="px-3 py-3 text-right tabular-nums">{numero(totales.tickets)}</td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums">{dinero(totales.totalJugado)}</td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums text-emerald-700">
                    {dinero(totales.totalPremios)}
                  </td>
                  <td className="bg-emerald-100 px-3 py-3 text-right font-mono tabular-nums text-emerald-800">
                    +{dinero(totales.devolucion)}
                  </td>
                  <td className="bg-amber-50 px-3 py-3 text-right font-mono tabular-nums text-amber-800">
                    {totalComisionDevuelta > 0 ? `+${dinero(totalComisionDevuelta)}` : "—"}
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

function FragmentDia({
  dia,
  diaAbierto,
  hiposAbiertos,
  carrerasAbiertas,
  esCliente,
  dinero,
  balDia,
  onToggleDia,
  onToggleHipo,
  onToggleCarrera,
}: {
  dia: DiaPivotDiario;
  diaAbierto: boolean;
  hiposAbiertos: Set<string>;
  carrerasAbiertas: Set<string>;
  esCliente: boolean;
  dinero: (v: number) => string;
  balDia: number;
  onToggleDia: () => void;
  onToggleHipo: (k: string) => void;
  onToggleCarrera: (k: string) => void;
}) {
  return (
    <>
      {/* NIVEL 1: DÍA */}
      <tr
        onClick={onToggleDia}
        className="cursor-pointer border-t-2 border-slate-300 bg-slate-800 text-white hover:bg-slate-700 transition-colors"
      >
        <td className="px-3 py-2.5 font-black">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-white/15 text-xs">
              {diaAbierto ? "▾" : "▸"}
            </span>
            <span>📅 Día {dia.fecha}</span>
            <span className="rounded-full bg-indigo-500/30 px-2 py-0.5 text-[10px] font-bold text-indigo-100">
              {dia.hipodromos.length} hipódromo(s)
            </span>
          </div>
        </td>
        <td className="px-3 py-2.5 text-right font-bold tabular-nums">{numero(dia.tickets)}</td>
        <td className="px-3 py-2.5 text-right font-mono font-bold tabular-nums">{dinero(dia.totalJugado)}</td>
        <td className="px-3 py-2.5 text-right font-mono font-bold tabular-nums text-emerald-300">
          {dinero(dia.totalPremios)}
        </td>
        <td className="px-3 py-2.5 text-right font-mono font-bold tabular-nums text-emerald-300">
          +{dinero(dia.devolucion)}
        </td>
        <td className="px-3 py-2.5 text-right font-mono font-bold tabular-nums text-amber-300">
          {dia.comisionDevuelta > 0 ? `+${dinero(dia.comisionDevuelta)}` : "—"}
        </td>
        <td
          className={`px-3 py-2.5 text-right font-mono font-black tabular-nums ${
            balDia >= 0 ? "text-emerald-300" : "text-rose-300"
          }`}
        >
          {dinero(balDia)}
        </td>
      </tr>

      {/* NIVEL 2: HIPÓDROMOS DEL DÍA */}
      {diaAbierto &&
        dia.hipodromos.map((hipo) => {
          const hKey = `${dia.fecha}|${hipo.hipodromo}`;
          const hipoAbierto = hiposAbiertos.has(hKey);
          const balHipo = balanceDe(hipo, esCliente);
          return (
            <FragmentHipodromo
              key={hKey}
              fecha={dia.fecha}
              hipo={hipo}
              hipoAbierto={hipoAbierto}
              carrerasAbiertas={carrerasAbiertas}
              esCliente={esCliente}
              dinero={dinero}
              balHipo={balHipo}
              onToggleHipo={() => onToggleHipo(hKey)}
              onToggleCarrera={onToggleCarrera}
            />
          );
        })}
    </>
  );
}

function FragmentHipodromo({
  fecha,
  hipo,
  hipoAbierto,
  carrerasAbiertas,
  esCliente,
  dinero,
  balHipo,
  onToggleHipo,
  onToggleCarrera,
}: {
  fecha: string;
  hipo: HipodromoPivotDiario;
  hipoAbierto: boolean;
  carrerasAbiertas: Set<string>;
  esCliente: boolean;
  dinero: (v: number) => string;
  balHipo: number;
  onToggleHipo: () => void;
  onToggleCarrera: (k: string) => void;
}) {
  return (
    <>
      <tr
        onClick={onToggleHipo}
        className="cursor-pointer border-t border-indigo-200 bg-indigo-50/80 hover:bg-indigo-100/80 transition-colors"
      >
        <td className="pl-7 pr-3 py-2 font-black text-indigo-950">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-indigo-200 text-[10px] text-indigo-900">
              {hipoAbierto ? "▾" : "▸"}
            </span>
            <span>🏇 {hipo.hipodromo}</span>
            <span className="rounded bg-indigo-200/70 px-1.5 py-0.5 text-[10px] font-bold text-indigo-800">
              {hipo.carreras.length} carrera(s)
            </span>
          </div>
        </td>
        <td className="px-3 py-2 text-right font-bold tabular-nums text-indigo-900">{numero(hipo.tickets)}</td>
        <td className="px-3 py-2 text-right font-mono font-bold tabular-nums text-indigo-950">
          {dinero(hipo.totalJugado)}
        </td>
        <td className="px-3 py-2 text-right font-mono font-bold tabular-nums text-emerald-700">
          {dinero(hipo.totalPremios)}
        </td>
        <td className="px-3 py-2 text-right font-mono font-bold tabular-nums text-emerald-700">
          +{dinero(hipo.devolucion)}
        </td>
        <td className="px-3 py-2 text-right font-mono font-bold tabular-nums text-amber-700">
          {hipo.comisionDevuelta > 0 ? `+${dinero(hipo.comisionDevuelta)}` : "—"}
        </td>
        <td
          className={`px-3 py-2 text-right font-mono font-black tabular-nums ${
            balHipo >= 0 ? "text-emerald-700" : "text-red-600"
          }`}
        >
          {dinero(balHipo)}
        </td>
      </tr>

      {/* NIVEL 3: CARRERAS DEL HIPÓDROMO */}
      {hipoAbierto &&
        hipo.carreras.map((c) => {
          const cKey = `${fecha}|${hipo.hipodromo}|${c.carrera}`;
          const carreraAbierta = carrerasAbiertas.has(cKey);
          const balCarrera = balanceDe(c, esCliente);
          const detalles = c.jugadasDetalle ?? [];
          return (
            <FragmentCarrera
              key={cKey}
              carrera={c}
              carreraAbierta={carreraAbierta}
              esCliente={esCliente}
              dinero={dinero}
              balCarrera={balCarrera}
              detalles={detalles}
              onToggleCarrera={() => onToggleCarrera(cKey)}
            />
          );
        })}
    </>
  );
}

function FragmentCarrera({
  carrera,
  carreraAbierta,
  esCliente,
  dinero,
  balCarrera,
  detalles,
  onToggleCarrera,
}: {
  carrera: FilaReporteDiario;
  carreraAbierta: boolean;
  esCliente: boolean;
  dinero: (v: number) => string;
  balCarrera: number;
  detalles: NonNullable<FilaReporteDiario["jugadasDetalle"]>;
  onToggleCarrera: () => void;
}) {
  const comDev = carrera.comisionDevuelta ?? 0;
  return (
    <>
      <tr
        onClick={onToggleCarrera}
        className="cursor-pointer border-t border-line bg-white hover:bg-slate-50 transition-colors"
      >
        <td className="pl-12 pr-3 py-2 font-bold text-slate-800">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-slate-200 text-[10px] text-slate-700">
              {carreraAbierta ? "▾" : "▸"}
            </span>
            <span>🏁 Carrera #{carrera.carrera}</span>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 border border-slate-200">
              {carreraAbierta ? "Ocultar jugadas" : `Ver ${carrera.tickets} jugada(s)`}
            </span>
          </div>
        </td>
        <td className="px-3 py-2 text-right tabular-nums text-slate-600">{numero(carrera.tickets)}</td>
        <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-800">
          {dinero(carrera.totalJugado)}
        </td>
        <td className="px-3 py-2 text-right font-mono tabular-nums text-emerald-700">
          {dinero(carrera.totalPremios)}
        </td>
        <td className="bg-emerald-50/70 px-3 py-2 text-right font-mono tabular-nums font-bold text-emerald-700">
          +{dinero(carrera.devolucion)}
        </td>
        <td className="bg-amber-50/70 px-3 py-2 text-right font-mono tabular-nums font-bold text-amber-700">
          {comDev > 0 ? `+${dinero(comDev)}` : "—"}
        </td>
        <td
          className={`px-3 py-2 text-right font-mono tabular-nums font-bold ${
            balCarrera >= 0 ? "text-emerald-700" : "text-red-600"
          }`}
        >
          {dinero(balCarrera)}
        </td>
      </tr>

      {/* NIVEL 4: CADA JUGADA DE LA CARRERA CON RESULTADO Y COMISIÓN DEVUELTA */}
      {carreraAbierta && (
        <tr className="bg-slate-50/90 border-t border-slate-200">
          <td colSpan={7} className="pl-14 pr-4 py-2.5">
            {detalles.length > 0 ? (
              <div className="rounded-lg border border-slate-200 bg-white overflow-hidden shadow-sm">
                <div className="bg-slate-100 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-slate-600 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200">
                  <span>
                    🎟️ Detalle de Jugadas — {carrera.hipodromo} · Carrera #{carrera.carrera}
                  </span>
                  {comDev > 0 && (
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-800 border border-amber-300">
                      🔀 Comisión devuelta por cruce aplicada: +{dinero(comDev)}
                    </span>
                  )}
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-black uppercase text-slate-500">
                      <th className="px-2.5 py-1.5 text-left">Hora</th>
                      {!esCliente && <th className="px-2.5 py-1.5 text-left">Jugador</th>}
                      <th className="px-2.5 py-1.5 text-left">Jugada</th>
                      <th className="px-2.5 py-1.5 text-left">Ejemplar(es)</th>
                      <th className="px-2.5 py-1.5 text-right">Apostó</th>
                      <th className="px-2.5 py-1.5 text-right">Premio</th>
                      <th className="px-2.5 py-1.5 text-right">Resultado</th>
                      <th className="px-2.5 py-1.5 text-right">Incentivo</th>
                      <th className="px-2.5 py-1.5 text-right">Comisión Devuelta</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {detalles.map((d) => {
                      const esPend =
                        d.estado === "PENDIENTE" || (d.resultadoNeto === 0 && d.premio === 0);
                      return (
                        <tr key={d.id} className="hover:bg-indigo-50/30">
                          <td className="px-2.5 py-1.5 font-mono text-[11px] font-bold text-slate-500 whitespace-nowrap">
                            {d.horaCarga ? `🕒 ${d.horaCarga}` : "—"}
                          </td>
                          {!esCliente && (
                            <td className="px-2.5 py-1.5 font-bold text-slate-800">{d.cliente}</td>
                          )}
                          <td className="px-2.5 py-1.5 font-black text-indigo-900">{d.jugada}</td>
                          <td className="px-2.5 py-1.5 font-mono font-bold text-slate-700">
                            {d.caballo}
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-slate-700">
                            {dinero(d.montoJugado)}
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-emerald-700">
                            {d.premio > 0 ? dinero(d.premio) : "—"}
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-mono tabular-nums font-black">
                            {esPend ? (
                              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                                ⏳ Pendiente
                              </span>
                            ) : d.resultadoNeto > 0 ? (
                              <span className="text-emerald-700">+{dinero(d.resultadoNeto)}</span>
                            ) : (
                              <span className="text-red-600">{dinero(d.resultadoNeto)}</span>
                            )}
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-emerald-700">
                            {d.devolucion > 0 ? `+${dinero(d.devolucion)}` : "—"}
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-mono tabular-nums font-bold">
                            {d.comisionDevuelta > 0 ? (
                              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-900 border border-amber-300">
                                +{dinero(d.comisionDevuelta)}
                              </span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-xs italic text-slate-400 py-2">
                Resumen consolidado de {carrera.tickets} jugada(s) en esta carrera.
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
