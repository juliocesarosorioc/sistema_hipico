"use client";

/**
 * REPORTE DE TABLAS FIJAS VENDIDAS — el ícono del Monitor de Tablas Publicadas.
 *
 * Una vista única, tipo tabla dinámica, con:
 *   · filtros por Grupo, Hipódromo, Carrera y Jugador (misma familia del Monitor);
 *   · KPIs (monto EN RIESGO, ganadores/pagado, comisión del grupo, retiros, balance);
 *   · pivot configurable por dimensión, con desplegable al detalle por fila;
 *   · "quienes ganaron / quienes perdieron" (badges por ticket) y, si hubo
 *     retiros, el reembolso correspondiente.
 *
 * La data se lee por día (reporte-tablas.ts) y se filtra/agrupa en memoria
 * (reporte-tablas-nucleo.ts). Todo el contenido clave entra en una pantalla y,
 * si no entra, se imprime paginando la tabla con el mismo formato.
 */
import { useEffect, useMemo, useState } from "react";
import { hoyLocal } from "@/features/gaceta/lib/programa";
import { nombreHipodromoParaMostrar } from "@/features/hipodromos/lib/nombre";
import { SearchableSelect } from "@/shared/components/ui/SearchableSelect";
import { colorDeNumero, textoDeNumero } from "@/features/tablas/lib/tipos";
import {
  agruparPor,
  claveDe,
  estadoNormalizado,
  filtrarVentas,
  opcionesDe,
  ordenarFilas,
  totalesDe,
  type DimensionReporte,
  type FilaReporte,
  type FiltrosVenta,
  type OpcionReporte,
  type TotalesReporte,
  type VentaTablaReporte,
} from "@/features/tablas/lib/reporte-tablas-nucleo";
import { cargarVentasTablasFijas } from "@/features/tablas/lib/reporte-tablas";

type Props = {
  abierto: boolean;
  onCerrar: () => void;
  /** Día/filtros que trae el Monitor (se copian al abrir). */
  fechaInicial?: string;
  hipodromoInicial?: string;
  carreraInicial?: string;
};

type Orden = { key: keyof TotalesReporte; dir: "asc" | "desc" };

const DIM_LABEL: Record<DimensionReporte, string> = {
  grupo: "Grupo",
  hipodromo: "Hipódromo",
  carrera: "Carrera",
  jugador: "Jugador",
};

const DIMENSIONES: DimensionReporte[] = ["grupo", "hipodromo", "carrera", "jugador"];

/** Número es-VE para el reporte. */
function fmt(n: number, dec = 2): string {
  const v = Number.isFinite(n) ? n : 0;
  return v.toLocaleString("es-VE", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

/** Celda de dinero: "–" apagado cuando es cero, para que la tabla se lea sola. */
function Money({ v, tono = "" }: { v: number; tono?: string }) {
  if (!v) return <span className="text-slate-300">–</span>;
  return <span className={`tabular-nums ${tono}`}>{fmt(v)}</span>;
}

function BadgeEstado({ estado }: { estado: string }) {
  const e = estadoNormalizado(estado);
  const cls =
    e === "Ganador"
      ? "bg-emerald-100 text-emerald-700 ring-emerald-300"
      : e === "Perdedor"
        ? "bg-rose-100 text-rose-700 ring-rose-300"
        : e === "Retirado"
          ? "bg-amber-100 text-amber-700 ring-amber-300"
          : e === "Pendiente"
            ? "bg-slate-100 text-slate-600 ring-slate-300"
            : "bg-slate-100 text-slate-400 ring-slate-200";
  return (
    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide ring-1 ${cls}`}>
      {e}
    </span>
  );
}

function Discos({ numero, caballo }: { numero: string; caballo: string }) {
  if (!numero) return <span className="text-slate-400">{caballo || "—"}</span>;
  return (
    <span className="flex items-center gap-1">
      <span
        className="inline-flex h-4 min-w-4 items-center justify-center rounded px-0.5 text-[9px] font-black"
        style={{ background: colorDeNumero(numero), color: textoDeNumero(numero) }}
      >
        {numero}
      </span>
      <span className="truncate text-slate-600">{caballo}</span>
    </span>
  );
}

/** Selector de filtro con botón de limpiar (busca y muestra el nombre, no el id). */
function FiltroSelect({
  icono,
  etiqueta,
  options,
  value,
  onChange,
}: {
  icono: string;
  etiqueta: string;
  options: OpcionReporte[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2 py-1 shadow-sm">
      <span className="whitespace-nowrap text-[10px] font-black uppercase tracking-wider text-slate-500">
        {icono} {etiqueta}
      </span>
      <div className="relative w-36">
        <SearchableSelect
          options={options}
          value={value}
          onChange={onChange}
          allowCustom={false}
          placeholder="TODOS"
          inputClassName="w-full bg-transparent pr-4 text-xs font-bold normal-case text-slate-900 placeholder:font-bold placeholder:text-slate-400 focus:outline-none"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            title="Quitar filtro"
            className="absolute -right-0.5 top-1/2 -translate-y-1/2 text-[11px] text-slate-400 hover:text-rose-500"
          >
            ✕
          </button>
        )}
      </div>
    </label>
  );
}

function Kpi({
  titulo,
  valor,
  sub,
  acento = "text-slate-900",
}: {
  titulo: string;
  valor: string;
  sub?: string;
  acento?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm">
      <p className="text-[9px] font-black uppercase tracking-wider text-slate-500">{titulo}</p>
      <p className={`mt-0.5 text-lg font-black leading-tight tabular-nums ${acento}`}>{valor}</p>
      {sub && <p className="text-[10px] font-semibold text-slate-400">{sub}</p>}
    </div>
  );
}

function ThOrden({
  label,
  k,
  orden,
  onOrdenar,
}: {
  label: string;
  k: keyof TotalesReporte;
  orden: Orden;
  onOrdenar: (k: keyof TotalesReporte) => void;
}) {
  const activo = orden.key === k;
  return (
    <th
      onClick={() => onOrdenar(k)}
      title={`Ordenar por ${label}`}
      className={`cursor-pointer select-none whitespace-nowrap px-2 py-1.5 text-right text-[9px] font-black uppercase tracking-wide transition-colors hover:bg-indigo-50 ${
        activo ? "text-indigo-700" : "text-slate-500"
      }`}
    >
      {label}
      {activo && <span className="ml-0.5">{orden.dir === "desc" ? "▼" : "▲"}</span>}
    </th>
  );
}

/** Detalle plano de tickets: quién jugó, qué caballo, cuánto y cómo terminó. */
function DetalleTabla({ filas }: { filas: VentaTablaReporte[] }) {
  if (filas.length === 0) {
    return <p className="px-3 py-4 text-center text-[11px] font-semibold text-slate-400">Sin tickets.</p>;
  }
  const ordenadas = [...filas].sort((a, b) => {
    if (a.hipodromo !== b.hipodromo) return a.hipodromo.localeCompare(b.hipodromo, "es");
    if (a.carrera !== b.carrera) return a.carrera - b.carrera;
    const na = parseInt(a.numero, 10) || 0;
    const nb = parseInt(b.numero, 10) || 0;
    if (na !== nb) return na - nb;
    return a.jugador.localeCompare(b.jugador, "es");
  });
  return (
    <table className="w-full border-collapse text-[11px]">
      <thead>
        <tr className="bg-slate-100 text-[9px] font-black uppercase tracking-wide text-slate-500">
          <th className="px-2 py-1 text-left">Fecha</th>
          <th className="px-2 py-1 text-left">Hipódromo</th>
          <th className="px-2 py-1 text-right">C</th>
          <th className="px-2 py-1 text-left">Ejemplar</th>
          <th className="px-2 py-1 text-left">Jugador</th>
          <th className="px-2 py-1 text-left">Grupo</th>
          <th className="px-2 py-1 text-right">Monto</th>
          <th className="px-2 py-1 text-center">Estado</th>
          <th className="px-2 py-1 text-right">Pagado</th>
          <th className="px-2 py-1 text-right">Comisión</th>
          <th className="px-2 py-1 text-center">Mon.</th>
        </tr>
      </thead>
      <tbody>
        {ordenadas.map((v, i) => (
          <tr key={v.id || `${v.hipodromo}-${v.carrera}-${v.numero}-${i}`} className="border-b border-slate-100 hover:bg-indigo-50/40">
            <td className="whitespace-nowrap px-2 py-1 text-slate-500">{v.fecha || "—"}</td>
            <td className="whitespace-nowrap px-2 py-1 font-semibold text-slate-700">
              {nombreHipodromoParaMostrar(v.hipodromo)}
            </td>
            <td className="px-2 py-1 text-right font-bold text-slate-600">{v.carrera}</td>
            <td className="px-2 py-1 font-semibold text-slate-800">
              <Discos numero={v.numero} caballo={v.caballo} />
            </td>
            <td className="px-2 py-1 text-slate-700">{v.jugador || "—"}</td>
            <td className="px-2 py-1 text-slate-500">{v.grupo || "—"}</td>
            <td className="px-2 py-1 text-right font-bold tabular-nums text-slate-800">{fmt(v.monto)}</td>
            <td className="px-2 py-1 text-center">
              <BadgeEstado estado={v.estado} />
            </td>
            <td className="px-2 py-1 text-right tabular-nums">
              <Money v={v.pagado} tono="font-bold text-emerald-700" />
            </td>
            <td className="px-2 py-1 text-right tabular-nums">
              <Money v={v.comision} tono="font-bold text-violet-700" />
            </td>
            <td className="px-2 py-1 text-center text-[9px] font-bold text-slate-400">{v.moneda}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ReporteTablasFijasModal({
  abierto,
  onCerrar,
  fechaInicial,
  hipodromoInicial,
  carreraInicial,
}: Props) {
  const [fecha, setFecha] = useState(() => fechaInicial || hoyLocal());
  const [filtros, setFiltros] = useState<FiltrosVenta>({});
  const [dimension, setDimension] = useState<DimensionReporte>("grupo");
  const [modo, setModo] = useState<"resumen" | "detalle">("resumen");
  const [busqueda, setBusqueda] = useState("");
  const [orden, setOrden] = useState<Orden>({ key: "enRiesgo", dir: "desc" });
  const [filaAbierta, setFilaAbierta] = useState<string | null>(null);
  const [data, setData] = useState<VentaTablaReporte[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");

  // Al abrir: copia los filtros del Monitor y vuelve al estado limpio.
  useEffect(() => {
    if (!abierto) return;
    setFecha(fechaInicial || hoyLocal());
    setFiltros({
      hipodromo: hipodromoInicial || "",
      carrera: carreraInicial || "",
      grupo: "",
      jugador: "",
    });
    setDimension("grupo");
    setModo("resumen");
    setBusqueda("");
    setFilaAbierta(null);
    setOrden({ key: "enRiesgo", dir: "desc" });
    // Solo al abrir, para no pisar lo que el operador está mirando.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto]);

  // Carga del día elegido.
  useEffect(() => {
    if (!abierto) return;
    let vivo = true;
    setCargando(true);
    setError("");
    void cargarVentasTablasFijas(fecha)
      .then((r) => {
        if (!vivo) return;
        setData(r.ventas);
        setFilaAbierta(null);
        if (!r.ok) setError(r.error ?? "No se pudo cargar el reporte.");
      })
      .finally(() => {
        if (vivo) setCargando(false);
      });
    return () => {
      vivo = false;
    };
  }, [abierto, fecha]);

  useEffect(() => {
    if (!abierto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCerrar();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [abierto, onCerrar]);

  const filtradas = useMemo(() => filtrarVentas(data, filtros), [data, filtros]);
  const total = useMemo(() => totalesDe(filtradas), [filtradas]);

  const opcionesGrupo = useMemo(() => opcionesDe(data, "grupo"), [data]);
  const opcionesHipo = useMemo(() => opcionesDe(data, "hipodromo", nombreHipodromoParaMostrar), [data]);
  const opcionesJugador = useMemo(() => opcionesDe(data, "jugador"), [data]);
  const opcionesCarrera = useMemo(() => {
    const base = filtros.hipodromo ? filtrarVentas(data, { hipodromo: filtros.hipodromo }) : data;
    return opcionesDe(base, "carrera", nombreHipodromoParaMostrar);
  }, [data, filtros.hipodromo]);

  const filas = useMemo(() => {
    const base = agruparPor(filtradas, dimension, nombreHipodromoParaMostrar);
    const q = busqueda.trim().toLowerCase();
    const buscadas = q ? base.filter((f) => f.etiqueta.toLowerCase().includes(q)) : base;
    return ordenarFilas(buscadas, orden.key, orden.dir);
  }, [filtradas, dimension, busqueda, orden]);

  /** Totales de las filas VISIBLES del pivot (la búsqueda también los ajusta). */
  const visible = useMemo(() => {
    const claves = new Set(filas.map((f) => f.clave));
    return totalesDe(filtradas.filter((v) => claves.has(claveDe(v, dimension))));
  }, [filtradas, filas, dimension]);

  const detalle = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return filtradas;
    return filtradas.filter((v) =>
      [v.caballo, v.jugador, v.grupo, v.hipodromo, String(v.carrera), v.numero].some((s) =>
        s.toLowerCase().includes(q)
      )
    );
  }, [filtradas, busqueda]);

  const hayFiltro = Boolean(filtros.grupo || filtros.hipodromo || filtros.carrera || filtros.jugador);

  const onOrdenar = (k: keyof TotalesReporte) =>
    setOrden((o) => (o.key === k ? { key: k, dir: o.dir === "desc" ? "asc" : "desc" } : { key: k, dir: "desc" }));

  if (!abierto) return null;

  const balanceTono = total.balance > 0 ? "text-emerald-700" : total.balance < 0 ? "text-rose-700" : "text-slate-700";

  return (
    <div
      className="rt-overlay fixed inset-0 z-[80] flex items-stretch justify-center bg-slate-950/70 p-2 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
    >
      {/* Reglas de impresión: imprime SOLO este reporte, paginando la tabla. */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @media print {
              body * { visibility: hidden !important; }
              .rt-overlay { position: static !important; display: block !important; background: #fff !important; padding: 0 !important; }
              .rt-imprimible, .rt-imprimible * { visibility: visible !important; }
              .rt-imprimible { position: static !important; max-height: none !important; max-width: none !important; box-shadow: none !important; border: 0 !important; border-radius: 0 !important; overflow: visible !important; width: 100% !important; }
              .rt-scroll { overflow: visible !important; max-height: none !important; background: #fff !important; padding: 0 !important; }
              .rt-no-print { display: none !important; }
              thead { display: table-header-group; }
              tfoot { display: table-footer-group; }
              tr { break-inside: avoid; }
              @page { size: A4 landscape; margin: 8mm; }
            }
          `,
        }}
      />

      <div className="rt-imprimible flex max-h-[97vh] w-full max-w-[1500px] flex-col overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-2xl">
        {/* Cabecera */}
        <div className="rt-no-print flex items-center justify-between gap-3 border-b border-indigo-900/40 bg-gradient-to-r from-indigo-700 via-violet-700 to-fuchsia-700 px-4 py-2.5 text-white">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-lg leading-none">📈</span>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-black uppercase tracking-wide">Reporte de Tablas Fijas vendidas</h2>
              <p className="truncate text-[10px] font-semibold text-indigo-100">
                {fecha} · {total.tickets} ticket(s) · {total.jugadores} jugador(es)
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-lg border border-white/30 bg-white/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-wide transition-colors hover:bg-white/20"
            >
              🖨️ Imprimir
            </button>
            <button
              type="button"
              onClick={onCerrar}
              title="Cerrar (Esc)"
              className="rounded-lg border border-white/30 bg-white/10 px-2.5 py-1.5 text-sm font-black leading-none transition-colors hover:bg-white/20"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Filtros */}
        <div className="rt-no-print flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
          <label className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2 py-1 shadow-sm">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">📅 Fecha</span>
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value || hoyLocal())}
              className="bg-transparent text-xs font-bold text-slate-900 focus:outline-none"
            />
          </label>
          <FiltroSelect
            icono="👥"
            etiqueta="Grupo"
            options={opcionesGrupo}
            value={filtros.grupo ?? ""}
            onChange={(v) => setFiltros((f) => ({ ...f, grupo: v }))}
          />
          <FiltroSelect
            icono="🏛️"
            etiqueta="Hipódromo"
            options={opcionesHipo}
            value={filtros.hipodromo ?? ""}
            onChange={(v) => setFiltros((f) => ({ ...f, hipodromo: v, carrera: "" }))}
          />
          <FiltroSelect
            icono="🏁"
            etiqueta="Carrera"
            options={opcionesCarrera}
            value={filtros.carrera ?? ""}
            onChange={(v) => setFiltros((f) => ({ ...f, carrera: v }))}
          />
          <FiltroSelect
            icono="🎯"
            etiqueta="Jugador"
            options={opcionesJugador}
            value={filtros.jugador ?? ""}
            onChange={(v) => setFiltros((f) => ({ ...f, jugador: v }))}
          />
          {hayFiltro && (
            <button
              type="button"
              onClick={() => setFiltros({})}
              className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-black uppercase text-red-500 hover:text-red-600"
            >
              ✕ Limpiar
            </button>
          )}
          <div className="ml-auto flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1 shadow-sm">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">🧩 Agrupar por</span>
            {DIMENSIONES.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => {
                  setDimension(d);
                  setFilaAbierta(null);
                }}
                className={`rounded px-1.5 py-0.5 text-[10px] font-black uppercase transition-colors ${
                  dimension === d ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-100"
                }`}
              >
                {DIM_LABEL[d]}
              </button>
            ))}
          </div>
        </div>

        {/* Sub-barra: modo + búsqueda */}
        <div className="rt-no-print flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-1.5">
          <div className="flex items-center gap-1">
            {(["resumen", "detalle"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setModo(m)}
                className={`rounded-lg px-2.5 py-1 text-[10px] font-black uppercase tracking-wide transition-colors ${
                  modo === m
                    ? "bg-slate-900 text-white"
                    : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
                }`}
              >
                {m === "resumen" ? "📊 Resumen dinámico" : "🧾 Detalle de tickets"}
              </button>
            ))}
          </div>
          <label className="ml-auto flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2 py-1 shadow-sm">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">🔎 Buscar</span>
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder={modo === "resumen" ? "grupo / jugador / hipódromo…" : "caballo / jugador / grupo…"}
              className="w-56 bg-transparent text-xs font-semibold normal-case text-slate-900 placeholder:text-slate-400 focus:outline-none"
            />
            {busqueda && (
              <button type="button" onClick={() => setBusqueda("")} className="text-[11px] text-slate-400 hover:text-rose-500">
                ✕
              </button>
            )}
          </label>
        </div>

        {/* Cuerpo */}
        <div className="rt-scroll min-h-0 flex-1 overflow-auto bg-slate-100 p-3">
          {error && (
            <p className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600">
              ⚠️ {error}
            </p>
          )}

          {/* Título solo para impresión */}
          <div className="mb-2 hidden print:block">
            <h1 className="text-center text-base font-black uppercase text-black">
              Reporte de Tablas Fijas vendidas — {fecha}
            </h1>
            <p className="text-center text-[10px] font-semibold text-slate-600">
              {hayFiltro ? "Con filtros aplicados · " : ""}
              {total.tickets} ticket(s) · en riesgo {fmt(total.enRiesgo)} · balance {fmt(total.balance)}
            </p>
          </div>

          {/* KPIs */}
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
            <Kpi titulo="🎯 En riesgo" valor={fmt(total.enRiesgo)} sub={`${total.tickets} ticket(s)`} />
            <Kpi titulo="🧑 Jugadores" valor={String(total.jugadores)} sub={`${filas.length} fila(s)`} />
            <Kpi
              titulo="🏆 Ganadores"
              valor={String(total.ganadores)}
              sub={`pagado ${fmt(total.pagado)}`}
              acento="text-emerald-700"
            />
            <Kpi titulo="❌ Perdidos" valor={String(total.perdidos)} acento="text-rose-700" />
            <Kpi titulo="💰 Comisión grupo" valor={fmt(total.comision)} acento="text-violet-700" />
            <Kpi
              titulo="🔄 Retiros"
              valor={String(total.retirados)}
              sub={`reemb. ${fmt(total.reembolsado)}`}
              acento={total.retirados ? "text-amber-700" : "text-slate-900"}
            />
            <Kpi titulo="📊 Balance (grupo)" valor={fmt(total.balance)} sub="vendido − pagado − reemb." acento={balanceTono} />
          </div>

          {cargando ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
              <p className="text-sm font-semibold text-slate-500">Cargando tablas vendidas del {fecha}…</p>
            </div>
          ) : filtradas.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
              <p className="text-sm font-semibold text-slate-500">No hay tablas fijas vendidas con los filtros actuales.</p>
              <p className="mt-1 text-xs text-slate-400">Probá otro día, o quitá filtros.</p>
            </div>
          ) : modo === "detalle" ? (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <DetalleTabla filas={detalle} />
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-100">
                    <th className="px-2 py-1.5 text-left text-[9px] font-black uppercase tracking-wide text-slate-500">
                      {DIM_LABEL[dimension]}
                    </th>
                    <ThOrden label="En riesgo" k="enRiesgo" orden={orden} onOrdenar={onOrdenar} />
                    <ThOrden label="Tickets" k="tickets" orden={orden} onOrdenar={onOrdenar} />
                    <ThOrden label="Jugad." k="jugadores" orden={orden} onOrdenar={onOrdenar} />
                    <ThOrden label="Ganad." k="ganadores" orden={orden} onOrdenar={onOrdenar} />
                    <ThOrden label="Perd." k="perdidos" orden={orden} onOrdenar={onOrdenar} />
                    <ThOrden label="Pend." k="pendientes" orden={orden} onOrdenar={onOrdenar} />
                    <ThOrden label="Retir." k="retirados" orden={orden} onOrdenar={onOrdenar} />
                    <ThOrden label="Pagado" k="pagado" orden={orden} onOrdenar={onOrdenar} />
                    <ThOrden label="Comisión" k="comision" orden={orden} onOrdenar={onOrdenar} />
                    <ThOrden label="Reemb." k="reembolsado" orden={orden} onOrdenar={onOrdenar} />
                    <ThOrden label="Balance" k="balance" orden={orden} onOrdenar={onOrdenar} />
                  </tr>
                </thead>
                <tbody>
                  {filas.length === 0 && (
                    <tr>
                      <td colSpan={12} className="px-3 py-6 text-center text-[11px] font-semibold text-slate-400">
                        Sin coincidencias para la búsqueda.
                      </td>
                    </tr>
                  )}
                  {filas.map((f: FilaReporte) => {
                    const abierta = filaAbierta === f.clave;
                    return (
                      <FragmentFila
                        key={f.clave}
                        fila={f}
                        abierta={abierta}
                        onToggle={() => setFilaAbierta(abierta ? null : f.clave)}
                        tickets={filtradas.filter((v) => claveDe(v, dimension) === f.clave)}
                      />
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-300 bg-slate-50 text-[11px] font-black text-slate-800">
                    <td className="px-2 py-1.5 uppercase tracking-wide">TOTAL ({filas.length})</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmt(visible.enRiesgo)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{visible.tickets}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{visible.jugadores}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-emerald-700">{visible.ganadores}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-rose-700">{visible.perdidos}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{visible.pendientes}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-amber-700">{visible.retirados}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-emerald-700">{fmt(visible.pagado)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-violet-700">{fmt(visible.comision)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-amber-700">{fmt(visible.reembolsado)}</td>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${balanceTono}`}>{fmt(visible.balance)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <p className="mt-2 text-[10px] font-semibold text-slate-400">
            Montos sin símbolo: la moneda la define el grupo (columna Mon. en el detalle). Balance = en riesgo − pagado −
            reembolsado. La comisión es la del grupo sobre la ganancia de los aciertos.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Fila del pivot + su fila de detalle desplegable. */
function FragmentFila({
  fila,
  abierta,
  onToggle,
  tickets,
}: {
  fila: FilaReporte;
  abierta: boolean;
  onToggle: () => void;
  tickets: VentaTablaReporte[];
}) {
  const balanceTono = fila.balance > 0 ? "text-emerald-700" : fila.balance < 0 ? "text-rose-700" : "text-slate-400";
  return (
    <>
      <tr
        onClick={onToggle}
        className={`cursor-pointer border-b border-slate-100 transition-colors ${
          abierta ? "bg-indigo-50" : "hover:bg-indigo-50/50"
        }`}
      >
        <td className="max-w-[22rem] px-2 py-1 font-bold text-slate-800">
          <span className="mr-1 text-slate-400">{abierta ? "▾" : "▸"}</span>
          <span className="truncate">{fila.etiqueta}</span>
        </td>
        <td className="px-2 py-1 text-right font-bold tabular-nums text-slate-800">{fmt(fila.enRiesgo)}</td>
        <td className="px-2 py-1 text-right tabular-nums text-slate-600">{fila.tickets}</td>
        <td className="px-2 py-1 text-right tabular-nums text-slate-600">{fila.jugadores}</td>
        <td className="px-2 py-1 text-right tabular-nums text-emerald-700">{fila.ganadores || "–"}</td>
        <td className="px-2 py-1 text-right tabular-nums text-rose-700">{fila.perdidos || "–"}</td>
        <td className="px-2 py-1 text-right tabular-nums text-slate-500">{fila.pendientes || "–"}</td>
        <td className="px-2 py-1 text-right tabular-nums">
          {fila.retirados ? <span className="font-bold text-amber-700">{fila.retirados}</span> : "–"}
        </td>
        <td className="px-2 py-1 text-right tabular-nums">
          <Money v={fila.pagado} tono="font-bold text-emerald-700" />
        </td>
        <td className="px-2 py-1 text-right tabular-nums">
          <Money v={fila.comision} tono="font-bold text-violet-700" />
        </td>
        <td className="px-2 py-1 text-right tabular-nums">
          <Money v={fila.reembolsado} tono="font-bold text-amber-700" />
        </td>
        <td className={`px-2 py-1 text-right font-black tabular-nums ${balanceTono}`}>
          {fila.balance === 0 ? "–" : fmt(fila.balance)}
        </td>
      </tr>
      {abierta && (
        <tr className="bg-white">
          <td colSpan={12} className="p-0">
            <div className="border-y-2 border-indigo-200 bg-white px-2 py-2">
              <DetalleTabla filas={tickets} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default ReporteTablasFijasModal;
