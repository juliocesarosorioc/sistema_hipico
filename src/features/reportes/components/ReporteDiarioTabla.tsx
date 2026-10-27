"use client";

/**
 * Tabla Dinámica Jerárquica + KPIs + Pizarra por Carrera + Contenedores de Ejemplares
 * + Gráficos de Resultados por Hipódromo y por Día.
 *
 * Estructura interactiva de 4 niveles (Tabla Dinámica):
 *   1. Día       → al abrir el día detalla los hipódromos.
 *   2. Hipódromo → al abrir el hipódromo abre las carreras.
 *   3. Carrera   → muestra la Pizarra Oficial con contenedores de caballos y al abrir muestra cada jugada.
 *   4. Jugada    → muestra hora de carga, jugada, contenedores coloreados de ejemplares, apostó, premio y resultado.
 *                  En vista de cliente, oculta las columnas de Incentivo y Comisión Devuelta si están en 0.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/core/supabase";
import { colorDiscoNumero, numerosDeCaballo } from "@/features/saldos/lib/discos";
import { ladosDePareo } from "@/features/taquilla/lib/nomenclatura";
import { puestosDesdeOrdenLlegada } from "@/features/motores/lib/oficiales";
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
  /** Mapa opcional de pizarras por clave `${fecha}|${hipodromo}|${carrera}` o `${hipodromo}|${carrera}`. */
  pizarras?: Record<string, string[]>;
  /** Si es false, la tabla ocupa todo el ancho y no dibuja el panel de gráficos. */
  mostrarGraficos?: boolean;
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
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
      <div className="text-[9px] font-black uppercase tracking-wider text-slate-600">{etiqueta}</div>
      <div className={`mt-0.5 text-lg sm:text-xl font-black tabular-nums tracking-tight ${acento}`}>{valor}</div>
    </div>
  );
}

/** Renderiza los números de los ejemplares dentro de contenedores/discos oficiales coloreados. */
function ContenedoresEjemplares({ caballo }: { caballo?: string | null }) {
  const raw = String(caballo ?? "").trim();
  if (!raw || raw === "—") return <span className="text-slate-400">—</span>;

  const pareo = ladosDePareo(raw);
  const pintarDisco = (num: string, k: string) => (
    <span
      key={k}
      className={`inline-flex h-5 min-w-[1.25rem] shrink-0 px-1 rounded items-center justify-center text-[10px] font-black shadow-xs border ${colorDiscoNumero(num)}`}
      title={`Ejemplar #${num}`}
    >
      #{num}
    </span>
  );

  if (pareo) {
    const izq = numerosDeCaballo(pareo.juega);
    const der = numerosDeCaballo(pareo.da);
    if (izq.length && der.length) {
      return (
        <span className="inline-flex flex-nowrap items-center gap-1 whitespace-nowrap">
          {izq.map((n, i) => pintarDisco(n, `i-${i}`))}
          <span className="text-[9px] font-black text-slate-500 px-0.5">vs</span>
          {der.map((n, i) => pintarDisco(n, `d-${i}`))}
        </span>
      );
    }
  }

  const nums = numerosDeCaballo(raw);
  if (nums.length > 0) {
    return (
      <span className="inline-flex flex-nowrap items-center gap-1 whitespace-nowrap">
        {nums.map((n, i) => pintarDisco(n, `n-${i}`))}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-800">
      {raw}
    </span>
  );
}

/** Renderiza la pizarra de llegada de una carrera con contenedores de números de caballos. */
function PizarraCarreraBadges({ puestos }: { puestos: string[] }) {
  if (!puestos || puestos.length === 0) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[9px] font-bold text-amber-800">
        ⏳ Pizarra pendiente
      </span>
    );
  }
  return (
    <div className="inline-flex shrink-0 flex-nowrap items-center gap-1 whitespace-nowrap rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5">
      <span className="mr-0.5 text-[8.5px] font-black uppercase tracking-wider text-slate-500">
        🏁 Pizarra:
      </span>
      {puestos.slice(0, 5).map((numCab, idx) => (
        <span key={`${numCab}-${idx}`} className="inline-flex items-center gap-0.5">
          <span className="text-[8.5px] font-black leading-none text-slate-500">{idx + 1}º</span>
          <span
            className={`inline-flex h-4 min-w-[1.1rem] items-center justify-center rounded border px-0.5 text-[9px] font-black leading-none shadow-2xs ${colorDiscoNumero(numCab)}`}
            title={`${idx + 1}º lugar: Ejemplar #${numCab}`}
          >
            {numCab}
          </span>
        </span>
      ))}
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

export function ReporteDiarioTabla({
  datos,
  moneda = "USD",
  perspectiva = "casa",
  pizarras,
  mostrarGraficos = true,
}: Props) {
  const esCliente = perspectiva === "cliente";
  const { filas, totales } = datos;
  const dinero = (v: number) => formatoDinero(v, moneda);

  const diasArbol = useMemo(() => construirArbolDias(datos), [datos]);

  // Carga automática de pizarras desde `resultados_carreras` para las fechas del reporte
  const [pizarrasBd, setPizarrasBd] = useState<Record<string, string[]>>({});
  useEffect(() => {
    let vivo = true;
    const fechas = [...new Set(diasArbol.map((d) => d.fecha).filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f)))];
    if (!supabase || fechas.length === 0) return;
    Promise.resolve(
      supabase
        .from("resultados_carreras")
        .select("fecha, hipodromo, carrera, ganadores, orden_llegada")
        .in("fecha", fechas)
    )
      .then(({ data }) => {
        if (!vivo || !data) return;
        const mapa: Record<string, string[]> = {};
        for (const r of data as Array<Record<string, unknown>>) {
          const f = String(r.fecha ?? "").slice(0, 10);
          const h = String(r.hipodromo ?? "").trim().toUpperCase();
          const c = String(r.carrera ?? "").trim();
          let puestos = puestosDesdeOrdenLlegada(r.orden_llegada);
          if (!puestos.length && Array.isArray(r.ganadores)) {
            puestos = (r.ganadores as unknown[]).map((x) => String(x ?? "").trim()).filter(Boolean);
          }
          if (puestos.length > 0) {
            mapa[`${f}|${h}|${c}`] = puestos;
            mapa[`${h}|${c}`] = puestos;
          }
        }
        setPizarrasBd(mapa);
      })
      .catch(() => null);
    return () => {
      vivo = false;
    };
  }, [diasArbol]);

  const obtenerPizarra = (fecha: string, hipodromo: string, carrera: number): string[] => {
    const h = hipodromo.trim().toUpperCase();
    const k1 = `${fecha}|${h}|${carrera}`;
    const k2 = `${h}|${carrera}`;
    return pizarras?.[k1] ?? pizarras?.[k2] ?? pizarrasBd[k1] ?? pizarrasBd[k2] ?? [];
  };

  // Estados de expansión de la Tabla Dinámica (Día → Hipódromo → Carrera)
  const [diasAbiertos, setDiasAbiertos] = useState<Set<string>>(new Set());
  const [hiposAbiertos, setHiposAbiertos] = useState<Set<string>>(new Set());
  const [carrerasAbiertas, setCarrerasAbiertas] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (diasArbol.length > 0) {
      const dSet = new Set<string>([diasArbol[0].fecha]);
      const hSet = new Set<string>();
      const cSet = new Set<string>();
      for (const h of diasArbol[0].hipodromos) {
        const hk = `${diasArbol[0].fecha}|${h.hipodromo}`;
        hSet.add(hk);
        for (const c of h.carreras) {
          cSet.add(`${hk}|${c.carrera}`);
        }
      }
      setDiasAbiertos(dSet);
      setHiposAbiertos(hSet);
      setCarrerasAbiertas(cSet);
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

  // Regla del Portal Jugador: si el jugador no tiene incentivo ni comisión devuelta, no ve esa columna
  const mostrarDevolucion = !esCliente || totales.devolucion > 0;
  const mostrarComisionDevuelta = !esCliente || totalComisionDevuelta > 0;
  const totalCols = 5 + (mostrarDevolucion ? 1 : 0) + (mostrarComisionDevuelta ? 1 : 0);

  const kpis = esCliente
    ? [
        { etiqueta: "Total Jugado", valor: dinero(totales.totalJugado), acento: "text-indigo-700" },
        { etiqueta: "Total Premios", valor: dinero(totales.totalPremios), acento: "text-emerald-700" },
        ...(mostrarDevolucion || mostrarComisionDevuelta
          ? [
              {
                etiqueta:
                  totalComisionDevuelta > 0
                    ? "🎁 Incentivo + Comisión Devuelta"
                    : "🎁 Incentivo a favor",
                valor: `+${dinero(totales.devolucion + totalComisionDevuelta)}`,
                acento: "text-emerald-700",
              },
            ]
          : []),
        {
          etiqueta: "Balance Neto del Día",
          valor: `${balanceTotal > 0 ? "+" : ""}${dinero(balanceTotal)}`,
          acento: balanceTotal >= 0 ? "text-emerald-700" : "text-rose-600",
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
          acento: balanceTotal >= 0 ? "text-emerald-700" : "text-rose-600",
        },
      ];

  return (
    <div className="space-y-4">
      <div className={`grid grid-cols-1 gap-2 sm:grid-cols-2 ${kpis.length >= 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
        {kpis.map((k) => (
          <Kpi key={k.etiqueta} etiqueta={k.etiqueta} valor={k.valor} acento={k.acento} />
        ))}
      </div>

      {/* Barra de controles de Tabla Dinámica */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5">
        <div className="flex items-center gap-2 text-[11px] font-bold text-slate-800">
          <span>📊</span>
          <span>Tabla Dinámica:</span>
          <span className="rounded bg-indigo-100 px-2 py-0.5 text-[9px] font-black uppercase text-indigo-900">
            Día → Hipódromo → Carrera (con Pizarra) → Jugadas
          </span>
        </div>
        {diasArbol.length > 0 && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={expandirTodo}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[10px] font-bold text-slate-700 hover:bg-slate-100"
            >
              📂 Expandir todo
            </button>
            <button
              type="button"
              onClick={contraerTodo}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[10px] font-bold text-slate-700 hover:bg-slate-100"
            >
              📁 Contraer todo
            </button>
          </div>
        )}
      </div>

      {/* Layout Principal: Tabla Dinámica (a todo el ancho si no hay gráficos) */}
      <div className={`grid grid-cols-1 gap-4 ${mostrarGraficos ? "xl:grid-cols-12" : ""}`}>
        <div
          className={`overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm ${
            mostrarGraficos ? "xl:col-span-8" : ""
          }`}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-100 text-left text-[9px] font-black uppercase tracking-wider text-slate-600">
                  <th className="whitespace-nowrap px-2 py-1">Día / Hipódromo / Carrera</th>
                  <th className="whitespace-nowrap px-2 py-1 text-right">Jugadas</th>
                  <th className="whitespace-nowrap px-2 py-1 text-right">Total Jugado</th>
                  <th className="whitespace-nowrap px-2 py-1 text-right">Total Premios</th>
                  {mostrarDevolucion && <th className="whitespace-nowrap px-2 py-1 text-right">Incentivo</th>}
                  {mostrarComisionDevuelta && <th className="whitespace-nowrap px-2 py-1 text-right">Comisión Devuelta</th>}
                  <th className="whitespace-nowrap px-2 py-1 text-right">Balance Neto</th>
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
                      mostrarDevolucion={mostrarDevolucion}
                      mostrarComisionDevuelta={mostrarComisionDevuelta}
                      totalCols={totalCols}
                      dinero={dinero}
                      balDia={balDia}
                      obtenerPizarra={obtenerPizarra}
                      onToggleDia={() => toggleDia(dia.fecha)}
                      onToggleHipo={toggleHipo}
                      onToggleCarrera={toggleCarrera}
                    />
                  );
                })}

                {filas.length === 0 ? (
                  <tr>
                    <td colSpan={totalCols} className="px-3 py-12 text-center font-semibold text-slate-400">
                      No hay carreras con jugadas para los filtros elegidos.
                    </td>
                  </tr>
                ) : null}
              </tbody>

              {filas.length > 0 ? (
                <tfoot>
                  <tr className="border-t-2 border-slate-300 bg-slate-100 text-xs font-black text-slate-900">
                    <td className="whitespace-nowrap px-2 py-1 uppercase tracking-wide">Total consolidado</td>
                    <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums text-xs">{numero(totales.tickets)}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-right font-mono tabular-nums text-xs">{dinero(totales.totalJugado)}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-right font-mono tabular-nums text-xs text-emerald-700">
                      {dinero(totales.totalPremios)}
                    </td>
                    {mostrarDevolucion && (
                      <td className="whitespace-nowrap bg-emerald-100 px-2 py-1 text-right font-mono tabular-nums text-emerald-800">
                        +{dinero(totales.devolucion)}
                      </td>
                    )}
                    {mostrarComisionDevuelta && (
                      <td className="whitespace-nowrap bg-amber-50 px-2 py-1 text-right font-mono tabular-nums text-amber-800">
                        {totalComisionDevuelta > 0 ? `+${dinero(totalComisionDevuelta)}` : "—"}
                      </td>
                    )}
                    <td
                      className={`whitespace-nowrap px-2 py-1 text-right font-mono tabular-nums text-xs ${
                        balanceTotal >= 0 ? "text-emerald-700" : "text-rose-600"
                      }`}
                    >
                      {balanceTotal > 0 ? `+${dinero(balanceTotal)}` : dinero(balanceTotal)}
                    </td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        </div>

        {mostrarGraficos ? (
          <div className="xl:col-span-4">
            <GraficosReporteDiario datos={datos} moneda={moneda} perspectiva={perspectiva} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Gráficos del reporte (por Hipódromo y por Día). Se exportan aparte para que
 * el Portal pueda colocarlos en su propia columna (donde antes estaban los QR)
 * y la tabla quede a todo el ancho.
 */
export function GraficosReporteDiario({
  datos,
  moneda = "USD",
  perspectiva = "casa",
}: {
  datos: ReporteDiario;
  moneda?: string;
  perspectiva?: "casa" | "cliente";
}) {
  const esCliente = perspectiva === "cliente";
  const dinero = (v: number) => formatoDinero(v, moneda);
  const diasArbol = useMemo(() => construirArbolDias(datos), [datos]);

  // Datos agregados para los gráficos (por Hipódromo y por Día)
  const resumenPorHipodromo = useMemo(() => {
    const mapa = new Map<string, { hipodromo: string; jugado: number; premios: number; neto: number; tickets: number }>();
    for (const d of diasArbol) {
      for (const h of d.hipodromos) {
        const prev = mapa.get(h.hipodromo) ?? { hipodromo: h.hipodromo, jugado: 0, premios: 0, neto: 0, tickets: 0 };
        prev.jugado += h.totalJugado;
        prev.premios += h.totalPremios;
        prev.neto += balanceDe(h, esCliente);
        prev.tickets += h.tickets;
        mapa.set(h.hipodromo, prev);
      }
    }
    return [...mapa.values()].sort((a, b) => Math.abs(b.neto) - Math.abs(a.neto) || b.jugado - a.jugado);
  }, [diasArbol, esCliente]);

  const resumenPorDia = useMemo(() => {
    return diasArbol.map((d) => ({
      fecha: d.fecha,
      jugado: d.totalJugado,
      premios: d.totalPremios,
      neto: balanceDe(d, esCliente),
      tickets: d.tickets,
    }));
  }, [diasArbol, esCliente]);

  return (
    <div className="space-y-4">
      {/* GRÁFICO 1: RESULTADOS POR HIPÓDROMO */}
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950 p-3 text-white shadow-md">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h4 className="text-xs font-black uppercase tracking-wider text-amber-400">
              🏇 Resultados por Hipódromo
            </h4>
            <p className="text-[10px] font-semibold text-slate-300">
              Rendimiento neto y volumen jugado por circuito
            </p>
          </div>
          <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[10px] font-black text-indigo-200">
            {resumenPorHipodromo.length} circuito(s)
          </span>
        </div>

        {resumenPorHipodromo.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-6 text-center text-xs text-slate-400">
            Sin actividad por hipódromo en este rango.
          </div>
        ) : (
          <div className="space-y-2">
            {(() => {
              const maxAbs = Math.max(...resumenPorHipodromo.map((h) => Math.max(Math.abs(h.neto), h.jugado, 1)));
              return resumenPorHipodromo.map((h) => {
                const pctJugado = Math.max(8, Math.round((h.jugado / maxAbs) * 100));
                const pctNeto = Math.max(8, Math.round((Math.abs(h.neto) / maxAbs) * 100));
                const positivo = h.neto >= 0;
                return (
                  <div key={h.hipodromo} className="rounded-xl border border-white/10 bg-white/5 p-2">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate font-black text-white">🏇 {h.hipodromo}</span>
                      <span
                        className={`font-mono text-xs font-black tabular-nums ${
                          positivo ? "text-emerald-400" : "text-rose-400"
                        }`}
                      >
                        {h.neto > 0 ? `+${dinero(h.neto)}` : dinero(h.neto)}
                      </span>
                    </div>
                    <div className="mt-1.5 space-y-1">
                      <div className="flex items-center gap-2 text-[10px] text-slate-300">
                        <span className="w-14 shrink-0">Jugado</span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
                          <div
                            className="h-full rounded-full bg-indigo-400 transition-all"
                            style={{ width: `${pctJugado}%` }}
                          />
                        </div>
                        <span className="w-16 text-right font-mono font-bold">{dinero(h.jugado)}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-slate-300">
                        <span className="w-14 shrink-0">{positivo ? "Ganancia" : "Pérdida"}</span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
                          <div
                            className={`h-full rounded-full transition-all ${
                              positivo ? "bg-emerald-400" : "bg-rose-500"
                            }`}
                            style={{ width: `${pctNeto}%` }}
                          />
                        </div>
                        <span className="w-16 text-right font-mono font-bold">{h.tickets} jug.</span>
                      </div>
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        )}
      </div>

      {/* GRÁFICO 2: RESULTADOS POR DÍA */}
      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-md">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-900">
              📅 Resultados por Día
            </h4>
            <p className="text-[10px] font-semibold text-slate-500">
              Evolución diaria de ganancias y jugadas
            </p>
          </div>
          <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-[10px] font-black text-indigo-800">
            {resumenPorDia.length} día(s)
          </span>
        </div>

        {resumenPorDia.length === 0 ? (
          <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-6 text-center text-xs text-slate-400">
            Sin jornadas registradas para graficar.
          </div>
        ) : (
          <div className="space-y-2.5">
            {(() => {
              const maxDia = Math.max(...resumenPorDia.map((d) => Math.max(Math.abs(d.neto), d.jugado, 1)));
              return resumenPorDia.map((d) => {
                const pct = Math.max(10, Math.round((Math.abs(d.neto) / maxDia) * 100));
                const pos = d.neto >= 0;
                return (
                  <div key={d.fecha} className="rounded-xl border border-slate-200 bg-slate-50/70 p-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-black text-slate-800">📅 {d.fecha}</span>
                      <span
                        className={`font-mono text-xs font-black tabular-nums ${
                          pos ? "text-emerald-700" : "text-rose-600"
                        }`}
                      >
                        {d.neto > 0 ? `+${dinero(d.neto)}` : dinero(d.neto)}
                      </span>
                    </div>
                    <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
                      <div
                        className={`h-full rounded-full ${
                          pos
                            ? "bg-gradient-to-r from-emerald-500 to-teal-400"
                            : "bg-gradient-to-r from-rose-600 to-orange-500"
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[10px] font-bold text-slate-500">
                      <span>Apostado: {dinero(d.jugado)}</span>
                      <span>Premios: {dinero(d.premios)}</span>
                      <span>{d.tickets} ticket(s)</span>
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        )}
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
  mostrarDevolucion,
  mostrarComisionDevuelta,
  totalCols,
  dinero,
  balDia,
  obtenerPizarra,
  onToggleDia,
  onToggleHipo,
  onToggleCarrera,
}: {
  dia: DiaPivotDiario;
  diaAbierto: boolean;
  hiposAbiertos: Set<string>;
  carrerasAbiertas: Set<string>;
  esCliente: boolean;
  mostrarDevolucion: boolean;
  mostrarComisionDevuelta: boolean;
  totalCols: number;
  dinero: (v: number) => string;
  balDia: number;
  obtenerPizarra: (fecha: string, hipodromo: string, carrera: number) => string[];
  onToggleDia: () => void;
  onToggleHipo: (k: string) => void;
  onToggleCarrera: (k: string) => void;
}) {
  return (
    <>
      {/* NIVEL 1: DÍA */}
      <tr
        onClick={onToggleDia}
        className="cursor-pointer border-t-2 border-slate-300 bg-slate-900 text-white hover:bg-slate-800 transition-colors"
      >
        <td className="whitespace-nowrap px-2 py-1 font-black">
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
        <td className="whitespace-nowrap px-2 py-1 text-right font-bold tabular-nums">{numero(dia.tickets)}</td>
        <td className="whitespace-nowrap px-2 py-1 text-right font-mono font-bold tabular-nums">{dinero(dia.totalJugado)}</td>
        <td className="whitespace-nowrap px-2 py-1 text-right font-mono font-bold tabular-nums text-emerald-300">
          {dinero(dia.totalPremios)}
        </td>
        {mostrarDevolucion && (
          <td className="whitespace-nowrap px-2 py-1 text-right font-mono font-bold tabular-nums text-emerald-300">
            +{dinero(dia.devolucion)}
          </td>
        )}
        {mostrarComisionDevuelta && (
          <td className="whitespace-nowrap px-2 py-1 text-right font-mono font-bold tabular-nums text-amber-300">
            {dia.comisionDevuelta > 0 ? `+${dinero(dia.comisionDevuelta)}` : "—"}
          </td>
        )}
        <td
          className={`whitespace-nowrap px-2 py-1 text-right font-mono font-black tabular-nums ${
            balDia >= 0 ? "text-emerald-300" : "text-rose-300"
          }`}
        >
          {balDia > 0 ? `+${dinero(balDia)}` : dinero(balDia)}
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
              mostrarDevolucion={mostrarDevolucion}
              mostrarComisionDevuelta={mostrarComisionDevuelta}
              totalCols={totalCols}
              dinero={dinero}
              balHipo={balHipo}
              obtenerPizarra={obtenerPizarra}
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
  mostrarDevolucion,
  mostrarComisionDevuelta,
  totalCols,
  dinero,
  balHipo,
  obtenerPizarra,
  onToggleHipo,
  onToggleCarrera,
}: {
  fecha: string;
  hipo: HipodromoPivotDiario;
  hipoAbierto: boolean;
  carrerasAbiertas: Set<string>;
  esCliente: boolean;
  mostrarDevolucion: boolean;
  mostrarComisionDevuelta: boolean;
  totalCols: number;
  dinero: (v: number) => string;
  balHipo: number;
  obtenerPizarra: (fecha: string, hipodromo: string, carrera: number) => string[];
  onToggleHipo: () => void;
  onToggleCarrera: (k: string) => void;
}) {
  return (
    <>
      <tr
        onClick={onToggleHipo}
        className="cursor-pointer border-t border-indigo-200 bg-indigo-50/80 hover:bg-indigo-100/80 transition-colors"
      >
        <td className="whitespace-nowrap pl-4 pr-2 py-1 font-black text-indigo-950">
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
        <td className="whitespace-nowrap px-2 py-1 text-right font-bold tabular-nums text-indigo-900">{numero(hipo.tickets)}</td>
        <td className="whitespace-nowrap px-2 py-1 text-right font-mono font-bold tabular-nums text-indigo-950">
          {dinero(hipo.totalJugado)}
        </td>
        <td className="whitespace-nowrap px-2 py-1 text-right font-mono font-bold tabular-nums text-emerald-700">
          {dinero(hipo.totalPremios)}
        </td>
        {mostrarDevolucion && (
          <td className="whitespace-nowrap px-2 py-1 text-right font-mono font-bold tabular-nums text-emerald-700">
            +{dinero(hipo.devolucion)}
          </td>
        )}
        {mostrarComisionDevuelta && (
          <td className="whitespace-nowrap px-2 py-1 text-right font-mono font-bold tabular-nums text-amber-700">
            {hipo.comisionDevuelta > 0 ? `+${dinero(hipo.comisionDevuelta)}` : "—"}
          </td>
        )}
        <td
          className={`whitespace-nowrap px-2 py-1 text-right font-mono font-black tabular-nums ${
            balHipo >= 0 ? "text-emerald-700" : "text-rose-600"
          }`}
        >
          {balHipo > 0 ? `+${dinero(balHipo)}` : dinero(balHipo)}
        </td>
      </tr>

      {/* NIVEL 3: CARRERAS DEL HIPÓDROMO */}
      {hipoAbierto &&
        hipo.carreras.map((c) => {
          const cKey = `${fecha}|${hipo.hipodromo}|${c.carrera}`;
          const carreraAbierta = carrerasAbiertas.has(cKey);
          const balCarrera = balanceDe(c, esCliente);
          const detalles = c.jugadasDetalle ?? [];
          const puestosPizarra = obtenerPizarra(fecha, hipo.hipodromo, c.carrera);
          return (
            <FragmentCarrera
              key={cKey}
              carrera={c}
              puestosPizarra={puestosPizarra}
              carreraAbierta={carreraAbierta}
              esCliente={esCliente}
              mostrarDevolucion={mostrarDevolucion}
              mostrarComisionDevuelta={mostrarComisionDevuelta}
              totalCols={totalCols}
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
  puestosPizarra,
  carreraAbierta,
  esCliente,
  mostrarDevolucion,
  mostrarComisionDevuelta,
  totalCols,
  dinero,
  balCarrera,
  detalles,
  onToggleCarrera,
}: {
  carrera: FilaReporteDiario;
  puestosPizarra: string[];
  carreraAbierta: boolean;
  esCliente: boolean;
  mostrarDevolucion: boolean;
  mostrarComisionDevuelta: boolean;
  totalCols: number;
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
        className="cursor-pointer border-t border-slate-200 bg-white hover:bg-slate-50 transition-colors"
      >
        <td className="whitespace-nowrap pl-8 pr-2 py-1 font-bold text-slate-900">
          <div className="flex flex-nowrap items-center gap-2">
            <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-slate-200 text-[10px] text-slate-700">
              {carreraAbierta ? "▾" : "▸"}
            </span>
            <span className="font-black text-indigo-950">🏁 Carrera #{carrera.carrera}</span>
            <PizarraCarreraBadges puestos={puestosPizarra} />
          </div>
        </td>
        <td className="whitespace-nowrap px-2 py-1 text-right font-bold tabular-nums text-slate-700">{numero(carrera.tickets)}</td>
        <td className="whitespace-nowrap px-2 py-1 text-right font-mono font-bold tabular-nums text-slate-900">
          {dinero(carrera.totalJugado)}
        </td>
        <td className="whitespace-nowrap px-2 py-1 text-right font-mono font-bold tabular-nums text-emerald-700">
          {dinero(carrera.totalPremios)}
        </td>
        {mostrarDevolucion && (
          <td className="bg-emerald-50/70 px-3 py-1.5 text-right font-mono tabular-nums font-bold text-emerald-700">
            +{dinero(carrera.devolucion)}
          </td>
        )}
        {mostrarComisionDevuelta && (
          <td className="bg-amber-50/70 px-3 py-1.5 text-right font-mono tabular-nums font-bold text-amber-700">
            {comDev > 0 ? `+${dinero(comDev)}` : "—"}
          </td>
        )}
        <td
          className={`whitespace-nowrap px-2 py-1 text-right font-mono tabular-nums font-black ${
            balCarrera >= 0 ? "text-emerald-700" : "text-rose-600"
          }`}
        >
          {balCarrera > 0 ? `+${dinero(balCarrera)}` : dinero(balCarrera)}
        </td>
      </tr>

      {/* NIVEL 4: CADA JUGADA DE LA CARRERA CON CONTENEDORES DE CABALLOS */}
      {carreraAbierta && (
        <tr className="bg-slate-50/90 border-t border-slate-200">
          <td colSpan={totalCols} className="whitespace-nowrap pl-8 pr-2 py-1">
            {detalles.length > 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
                <div className="bg-slate-100 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-slate-700 flex flex-nowrap items-center justify-between gap-2 border-b border-slate-200">
                  <span>
                    🎟️ Detalle de Jugadas — {carrera.hipodromo} · Carrera #{carrera.carrera}
                  </span>
                  {mostrarComisionDevuelta && comDev > 0 && (
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-800 border border-amber-300">
                      🔀 Comisión devuelta por cruce aplicada: +{dinero(comDev)}
                    </span>
                  )}
                </div>
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-[9px] font-black uppercase text-slate-600">
                      <th className="whitespace-nowrap px-2 py-1 text-left">Hora</th>
                      {!esCliente && <th className="whitespace-nowrap px-2 py-1 text-left">Jugador</th>}
                      <th className="whitespace-nowrap px-2 py-1 text-left">Jugada</th>
                      <th className="whitespace-nowrap px-2 py-1 text-left">Ejemplares</th>
                      <th className="whitespace-nowrap px-2 py-1 text-right">Apostó</th>
                      <th className="whitespace-nowrap px-2 py-1 text-right">Premio</th>
                      <th className="whitespace-nowrap px-2 py-1 text-right">Resultado</th>
                      {mostrarDevolucion && <th className="whitespace-nowrap px-2 py-1 text-right">Incentivo</th>}
                      {mostrarComisionDevuelta && <th className="whitespace-nowrap px-2 py-1 text-right">Comisión Devuelta</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {detalles.map((d) => {
                      const esPend =
                        d.estado === "PENDIENTE" || (d.resultadoNeto === 0 && d.premio === 0);
                      return (
                        <tr key={d.id} className="hover:bg-indigo-50/30">
                          <td className="whitespace-nowrap px-2 py-1 font-mono text-[10px] font-bold text-slate-600">
                            {d.horaCarga ? `🕒 ${d.horaCarga}` : "—"}
                          </td>
                          {!esCliente && (
                            <td className="whitespace-nowrap px-2 py-1 font-bold text-slate-800">{d.cliente}</td>
                          )}
                          <td className="whitespace-nowrap px-2 py-1 font-black text-indigo-950">{d.jugada}</td>
                          <td className="whitespace-nowrap px-2 py-1">
                            <ContenedoresEjemplares caballo={d.caballo} />
                          </td>
                          <td className="whitespace-nowrap px-2 py-1 text-right font-mono font-bold tabular-nums text-slate-800">
                            {dinero(d.montoJugado)}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1 text-right font-mono font-bold tabular-nums text-emerald-700">
                            {d.premio > 0 ? dinero(d.premio) : "—"}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1 text-right font-mono tabular-nums font-black">
                            {esPend ? (
                              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                                ⏳ Pendiente
                              </span>
                            ) : d.resultadoNeto > 0 ? (
                              <span className="text-emerald-700">+{dinero(d.resultadoNeto)}</span>
                            ) : (
                              <span className="text-rose-600">{dinero(d.resultadoNeto)}</span>
                            )}
                          </td>
                          {mostrarDevolucion && (
                            <td className="whitespace-nowrap px-2 py-1 text-right font-mono tabular-nums text-emerald-700">
                              {d.devolucion > 0 ? `+${dinero(d.devolucion)}` : "—"}
                            </td>
                          )}
                          {mostrarComisionDevuelta && (
                            <td className="whitespace-nowrap px-2 py-1 text-right font-mono tabular-nums font-bold">
                              {d.comisionDevuelta > 0 ? (
                                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-900 border border-amber-300">
                                  +{dinero(d.comisionDevuelta)}
                                </span>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-xs italic text-slate-400 py-1.5">
                Resumen consolidado de {carrera.tickets} jugada(s) en esta carrera.
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
