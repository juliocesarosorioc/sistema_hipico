"use client";

/**
 * REPORTE DE VENTAS — vista reusable de tickets vendidos.
 *
 * Nació como el "Reporte de Tablas Fijas vendidas" del Monitor de Tablas
 * Publicadas y hoy lo comparten las cuatro modalidades que venden tickets en
 * `tickets_apuestas` (Tablas Fijas, Marcas, Dupletas y Remates). La Polla tiene
 * su propio ranking en `PollasModule`, pero usa la misma regla contable. Todas
 * quieren la MISMA vista, tipo tabla dinámica, con:
 *   · filtros por Grupo, Hipódromo, Carrera y Jugador (misma familia del Monitor);
 *   · KPIs (EN RIESGO, ganadores/pagado, cobrado neto, comisión, retiros, balance);
 *   · pivot configurable por dimensión, con desplegable al detalle por fila;
 *   · "quienes ganaron / quienes perdieron" (badges por ticket) y, si hubo
 *     retiros, el reembolso correspondiente.
 *
 * Regla contable del dueño:
 *   · cliente GANÓ  → el monto va a PAGADO (premio);
 *   · cliente PERDIÓ → el monto va a COBRADO, menos el % de convenio del grupo
 *     que publicó la jugada (columna "Cobrado neto").
 *
 * Lo único que cambia entre una modalidad y otra se pasa por props: de dónde
 * salen las filas (`cargar`), los textos (`titulo`, `etiquetas`, `textoVacio`…),
 * la paleta (`tema`) y el producto de convenio (`producto`). El modelo de fila
 * (`VentaTablaReporte`) y la agregación viven en `reporte-tablas-nucleo.ts`, que
 * es lógica pura y ya es genérica: una venta es un ticket con grupo, jugador,
 * ejemplar, monto, estado, pagado y comisión, sirva para una tabla fija, una
 * marca, una dupleta o un ejemplar de remate.
 *
 * La data se lee por día (el `cargar` de cada modalidad) y se filtra/agrupa en
 * memoria. Todo el contenido clave entra en una pantalla y, si no entra, se
 * imprime paginando la tabla con el mismo formato.
 */
import { useEffect, useMemo, useState } from "react";
import { hoyLocal } from "@/features/gaceta/lib/programa";
import { nombreHipodromoParaMostrar } from "@/features/hipodromos/lib/nombre";
import { SearchableSelect } from "@/shared/components/ui/SearchableSelect";
import { colorDeNumero, textoDeNumero } from "@/features/tablas/lib/tipos";
import { ETIQUETA_ADELANTADA, ETIQUETA_EN_VIVO } from "@/features/jugadas/lib/modalidad-tiempo";
import { puedeEditarDesdeReporte } from "@/features/reportes/lib/edicion-reporte";
import {
  ModalAccionJugadaReporte,
  type ModoAccionJugada,
} from "@/features/reportes/components/ModalAccionJugadaReporte";
import {
  agruparPor,
  claveDe,
  cobradoDeVenta,
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
import {
  conConvenio,
  indiceConvenio,
  type GrupoComisiones,
  type ProductoConvenio,
} from "@/features/reportes/lib/cobrado-convenio-nucleo";
import { cargarGruposConvenio } from "@/features/reportes/lib/grupos-convenio";
import { useReporteEnVivo } from "@/features/reportes/lib/useReporteEnVivo";

/** Tablas que, además de resultados/carreras, refrescan este reporte. */
const TABLAS_VIVO_REPORTE = ["tickets_apuestas"] as const;

/** Carga las ventas de un día ya normalizadas al modelo del reporte. */
export type CargarVentasReporte = (fecha: string) => Promise<{
  ok: boolean;
  ventas: VentaTablaReporte[];
  error?: string;
}>;

/** Paleta del reporte, para que cada modalidad conserve su identidad. */
export type TemaReporteVentas = {
  /** Gradiente de la cabecera, sin el `bg-gradient-to-r`. */
  cabecera: string;
  /** Fondo del botón/dimensión activa. */
  activo: string;
  /** Color del encabezado de columna activo. */
  acento: string;
  /** Fondo de la fila abierta del pivot. */
  seleccion: string;
  /** Hover suave de las filas. */
  hover: string;
  /** Borde del panel de detalle desplegado. */
  borde: string;
};

/** Textos que cambian entre modalidades (ticket vs jugada). */
export type EtiquetasReporteVentas = {
  /** Sustantivo del conteo: "ticket(s)", "jugada(s)". */
  conteo: string;
  /** Texto del detalle sin filas. */
  sinDatos: string;
  /** Etiqueta del botón del modo detalle. */
  detalle: string;
};

const TEMA_TABLAS: TemaReporteVentas = {
  cabecera: "from-indigo-700 via-violet-700 to-fuchsia-700",
  activo: "bg-indigo-600 text-white",
  acento: "text-indigo-700",
  seleccion: "bg-indigo-50",
  hover: "hover:bg-indigo-50",
  borde: "border-indigo-200",
};

const ETIQUETAS_TABLAS: EtiquetasReporteVentas = {
  conteo: "ticket(s)",
  sinDatos: "Sin tickets.",
  detalle: "Detalle de tickets",
};

export type ReporteVentasModalProps = {
  abierto: boolean;
  onCerrar: () => void;
  /** Carga las ventas del día (lo que cambia entre modalidades). */
  cargar: CargarVentasReporte;
  /** Título del reporte (cabecera e impresión). */
  titulo: string;
  icono?: string;
  tema?: TemaReporteVentas;
  etiquetas?: EtiquetasReporteVentas;
  /** Mensaje del vacío "sin filas con los filtros actuales". */
  textoVacio?: string;
  /** Marcador de carga (recibe el día). */
  textoCargando?: (fecha: string) => string;
  /** Nota al pie. */
  notaPie?: string;
  /** Placeholders de la búsqueda según el modo. */
  placeholderResumen?: string;
  placeholderDetalle?: string;
  /** Día/filtros que trae el módulo (se copian al abrir). */
  fechaInicial?: string;
  hipodromoInicial?: string;
  carreraInicial?: string;
  /**
   * Producto de convenio de la modalidad: elige la tasa del grupo que se
   * descuenta en "Cobrado neto" (`comision_tablas`, `comision_marcas`…).
   */
  producto?: ProductoConvenio;
  /** Tablas extra a escuchar en tiempo real (además de resultados y carreras). */
  tablasVivo?: readonly string[];
};

type Orden = { key: keyof TotalesReporte | "etiqueta"; dir: "asc" | "desc" };

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
          : e === "Sin Decisión"
            ? "bg-amber-100 text-amber-800 ring-amber-300"
            : e === "Pendiente"
            ? "bg-slate-100 text-slate-600 ring-slate-300"
            : "bg-slate-100 text-slate-400 ring-slate-200";
  return (
    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide ring-1 ${cls}`}>
      {e === "Sin Decisión" ? "SIN DECISIÓN" : e}
    </span>
  );
}

/**
 * Símbolo COMPACTO de la modalidad de tiempo de la jugada: un punto de color
 * (verde = ⚡ en vivo, ámbar = ⏳ adelantada). El texto completo va en el
 * `title` para no ensuciar la tabla. Es una columna de una sola celda angosta.
 */
function PuntoModalidad({ adelantada }: { adelantada: boolean }) {
  const etiqueta = adelantada ? ETIQUETA_ADELANTADA : ETIQUETA_EN_VIVO;
  const punto = adelantada ? "bg-amber-500" : "bg-emerald-500";
  return (
    <span
      title={etiqueta}
      aria-label={etiqueta}
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${punto}`}
    />
  );
}

function Discos({ numero, caballo }: { numero: string; caballo: string }) {
  if (!numero) return <span className="text-slate-400">{caballo || "—"}</span>;
  // Marcas: "MARCA 3 vs 6" o "MARCA 3 vs 6·7" — mostrar cada número con su círculo, una sola vez, separados por "x".
  if (caballo && /^MARCA\s+/i.test(caballo)) {
    const m = caballo.match(/^MARCA\s+(\S+)\s+(?:vs|x)\s+(.+)$/i);
    if (m) {
      const marca = m[1];
      const rivales = m[2]
        .split(/[·,\s]+/)
        .map((r) => r.trim())
        .filter(Boolean);
      return (
        <span className="flex items-center gap-1">
          <span
            className="inline-flex h-4 min-w-4 items-center justify-center rounded px-0.5 text-[9px] font-black"
            style={{ background: colorDeNumero(marca), color: textoDeNumero(marca) }}
            title={marca}
          >
            {marca}
          </span>
          {rivales.map((r, i) => (
            <span key={`${r}-${i}`} className="flex items-center gap-1">
              <span className="text-[9px] font-bold text-slate-400">x</span>
              <span
                className="inline-flex h-4 min-w-4 items-center justify-center rounded px-0.5 text-[9px] font-black"
                style={{ background: colorDeNumero(r), color: textoDeNumero(r) }}
                title={r}
              >
                {r}
              </span>
            </span>
          ))}
        </span>
      );
    }
  }
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
  tema,
}: {
  label: string;
  k: keyof TotalesReporte;
  orden: Orden;
  onOrdenar: (k: keyof TotalesReporte) => void;
  tema: TemaReporteVentas;
}) {
  const activo = orden.key === k;
  return (
    <th
      onClick={() => onOrdenar(k)}
      title={`Ordenar por ${label}`}
      className={`cursor-pointer select-none whitespace-nowrap px-2 py-1.5 text-right text-[9px] font-black uppercase tracking-wide transition-colors ${tema.hover} ${
        activo ? tema.acento : "text-slate-500"
      }`}
    >
      {label}
      {activo && <span className="ml-0.5">{orden.dir === "desc" ? "▼" : "▲"}</span>}
    </th>
  );
}

/** Detalle plano de tickets: quién jugó, qué caballo, cuánto y cómo terminó. */
function DetalleTabla({
  filas,
  etiquetas,
  tema,
  acciones,
  producto = "tablas",
}: {
  filas: VentaTablaReporte[];
  etiquetas: EtiquetasReporteVentas;
  tema: TemaReporteVentas;
  /** Si viene, la tabla trae la columna de acciones (perfil Administrador Principal). */
  acciones?: { onAccion: (v: VentaTablaReporte, modo: ModoAccionJugada) => void };
  producto?: string;
}) {
  if (filas.length === 0) {
    return <p className="px-3 py-4 text-center text-[11px] font-semibold text-slate-400">{etiquetas.sinDatos}</p>;
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
          <th className="px-2 py-1 text-left">Venta</th>
          <th className="px-1 py-1 text-center" title="Modalidad: verde ⚡ en vivo · ámbar ⏳ adelantada">
            T
          </th>
          <th className="px-2 py-1 text-left">Hipódromo</th>
          <th className="px-2 py-1 text-right">C</th>
          <th className="px-2 py-1 text-left">Ejemplar</th>
          <th className="px-2 py-1 text-left">Jugador</th>
          <th className="px-2 py-1 text-left">Grupo</th>
          <th className="px-2 py-1 text-right">Monto</th>
          <th className="px-2 py-1 text-center">Estado</th>
          <th className="px-2 py-1 text-right">Pagado</th>
          <th className="px-2 py-1 text-right" title="Monto perdido × (1 − % convenio del grupo)">
            Cobrado
          </th>
          <th className="px-2 py-1 text-right">Comisión</th>
          <th className="px-2 py-1 text-center">Mon.</th>
          {acciones && <th className="px-2 py-1 text-center">Acc.</th>}
        </tr>
      </thead>
      <tbody>
        {ordenadas.map((v, i) => {
          const esTablas = producto === "tablas";
          const montoUnitario = esTablas && v.cantidad && v.cantidad > 0 ? v.monto / v.cantidad : v.monto;
          return (
          <tr key={v.id || `${v.hipodromo}-${v.carrera}-${v.numero}-${i}`} className={`border-b border-slate-100 ${tema.hover}`}>
            <td className="whitespace-nowrap px-2 py-1 text-slate-500">{v.fecha || "—"}</td>
            <td className="whitespace-nowrap px-2 py-1 text-slate-400">{v.fechaVenta || "—"}</td>
            <td className="px-1 py-1 text-center">
              <PuntoModalidad adelantada={v.adelantada} />
            </td>
            <td className="whitespace-nowrap px-2 py-1 font-semibold text-slate-700">
              {nombreHipodromoParaMostrar(v.hipodromo)}
            </td>
            <td className="px-2 py-1 text-right font-bold text-slate-600">{v.carrera}</td>
            <td className="px-2 py-1 font-semibold text-slate-800">
              <Discos numero={v.numero} caballo={v.caballo} />
            </td>
            <td className="px-2 py-1 text-slate-700">{v.jugador || "—"}</td>
            <td className="px-2 py-1 text-slate-500">{v.grupo || "—"}</td>
            {esTablas ? (
              <td className="px-2 py-1 text-right tabular-nums text-slate-800">
                <div className="font-bold">{fmt(v.monto)}</div>
                <div className="text-[9px] text-slate-500">
                  {v.cantidad || 1} x {fmt(montoUnitario)}{v.premioPorTabla ? ` · paga ${fmt(v.premioPorTabla)}` : ""}
                </div>
              </td>
            ) : (
            <td className="px-2 py-1 text-right font-bold tabular-nums text-slate-800">{fmt(v.monto)}</td>
            )}
            <td className="px-2 py-1 text-center">
              {v.anulada ? (
                <span className="inline-flex items-center rounded-full bg-rose-600 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-white">
                  Anulada
                </span>
              ) : (
                <BadgeEstado estado={v.estado} />
              )}
            </td>
            <td className="px-2 py-1 text-right tabular-nums">
              <Money v={v.pagado} tono="font-bold text-emerald-700" />
            </td>
            <td className="px-2 py-1 text-right tabular-nums">
              <Money v={cobradoDeVenta(v)} tono="font-bold text-sky-700" />
            </td>
            <td className="px-2 py-1 text-right tabular-nums">
              <Money v={v.comision} tono="font-bold text-violet-700" />
            </td>
            <td className="px-2 py-1 text-center text-[9px] font-bold text-slate-400">{v.moneda}</td>
            {acciones && (
              <td className="px-2 py-1 text-center">
                <div className="flex items-center justify-center gap-1">
                  {v.anulada ? (
                    <button
                      type="button"
                      onClick={() => acciones.onAccion(v, "restaurar")}
                      title="Restaurar jugada"
                      className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-black text-emerald-700 hover:bg-emerald-100"
                    >
                      ♻️
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => acciones.onAccion(v, "editar")}
                        title="Corregir jugada"
                        className="rounded border border-sky-200 bg-sky-50 px-1 py-0.5 text-[10px] font-black text-sky-700 hover:bg-sky-100"
                      >
                        ✏️
                      </button>
                      <button
                        type="button"
                        onClick={() => acciones.onAccion(v, "anular")}
                        title="Anular jugada"
                        className="rounded border border-rose-200 bg-rose-50 px-1 py-0.5 text-[10px] font-black text-rose-700 hover:bg-rose-100"
                      >
                        🚫
                      </button>
                    </>
                  )}
                </div>
              </td>
            )}
          </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function ReporteVentasModal({
  abierto,
  onCerrar,
  cargar,
  titulo,
  icono = "📈",
  tema = TEMA_TABLAS,
  etiquetas = ETIQUETAS_TABLAS,
  textoVacio = "No hay ventas con los filtros actuales.",
  textoCargando = (dia: string) => `Cargando las ventas del ${dia}…`,
  notaPie = "Montos sin símbolo: la moneda la define el grupo (columna Mon. en el detalle). Balance = en riesgo − pagado − reembolsado. La comisión es la del grupo sobre la ganancia de los aciertos.",
  placeholderResumen = "grupo / jugador / hipódromo…",
  placeholderDetalle = "caballo / jugador / grupo…",
  fechaInicial,
  hipodromoInicial,
  carreraInicial,
  producto = "tablas",
  tablasVivo = TABLAS_VIVO_REPORTE,
}: ReporteVentasModalProps) {
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
  /** Perfil Administrador Principal: habilita editar/anular/restaurar desde acá. */
  const [puedeEditar, setPuedeEditar] = useState(false);
  const [accion, setAccion] = useState<{ venta: VentaTablaReporte; modo: ModoAccionJugada } | null>(null);
  const [aviso, setAviso] = useState("");
  /** Fuerza recargar el día después de editar/anular/restaurar o por un pago. */
  const [recarga, setRecarga] = useState(0);
  /** Grupos con su % de convenio, para descontar en "Cobrado neto". */
  const [gruposConvenio, setGruposConvenio] = useState<GrupoComisiones[]>([]);
  /** Mostrar/ocultar jugadas anuladas en todo el reporte. */
  const [mostrarAnuladas, setMostrarAnuladas] = useState(true);

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
    setAviso("");
    setAccion(null);
    // El perfil se resuelve al abrir: el store ya publicó los accesos vigentes.
    setPuedeEditar(puedeEditarDesdeReporte());
    // Solo al abrir, para no pisar lo que el operador está mirando.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto]);

  // Carga del día elegido (y recarga tras una edición/anulación/restauración).
  useEffect(() => {
    if (!abierto) return;
    let vivo = true;
    setCargando(true);
    setError("");
    void cargar(fecha)
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
  }, [abierto, fecha, cargar, recarga]);

  // Tasas de convenio del grupo que publica cada jugada (tablas, marcas,
  // dupletas, remates…). Se leen al abrir y no dependen del día.
  useEffect(() => {
    if (!abierto) return;
    let vivo = true;
    void cargarGruposConvenio().then((grupos) => {
      if (vivo) setGruposConvenio(grupos);
    });
    return () => {
      vivo = false;
    };
  }, [abierto]);

  // Tiempo real: cada resultado oficial cargado/corregido o cada ticket pagado
  // vuelve a leer el día. El hook agrupa las ráfagas para no recargar de más.
  const enVivo = useReporteEnVivo({
    habilitado: abierto,
    fecha,
    tablas: tablasVivo,
    onCambio: () => setRecarga((n) => n + 1),
  });

  useEffect(() => {
    if (!abierto) return;
    const onKey = (e: KeyboardEvent) => {
      // Con el modal de acción abierto, Escape cierra ESE modal (lo maneja él).
      if (e.key === "Escape" && !accion) onCerrar();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [abierto, onCerrar, accion]);

  // Cada venta se cruza con el % de convenio de su grupo. La data cruda queda
  // intacta: el enriquecido es una copia que se rehace si cambian los grupos.
  const indiceGrupos = useMemo(() => indiceConvenio(gruposConvenio), [gruposConvenio]);
  const conPct = useMemo(
    () => conConvenio(data, indiceGrupos, producto),
    [data, indiceGrupos, producto]
  );

  const sinAnuladas = useMemo(
    () => (mostrarAnuladas ? conPct : conPct.filter((v) => !v.anulada)),
    [conPct, mostrarAnuladas]
  );
  const filtradas = useMemo(() => filtrarVentas(sinAnuladas, filtros), [sinAnuladas, filtros]);
  const total = useMemo(() => totalesDe(filtradas), [filtradas]);

  const opcionesGrupo = useMemo(() => opcionesDe(sinAnuladas, "grupo"), [sinAnuladas]);
  const opcionesHipo = useMemo(() => opcionesDe(sinAnuladas, "hipodromo", nombreHipodromoParaMostrar), [sinAnuladas]);
  const opcionesJugador = useMemo(() => opcionesDe(sinAnuladas, "jugador"), [sinAnuladas]);
  const opcionesCarrera = useMemo(() => {
    const base = filtros.hipodromo ? filtrarVentas(sinAnuladas, { hipodromo: filtros.hipodromo }) : sinAnuladas;
    return opcionesDe(base, "carrera", nombreHipodromoParaMostrar);
  }, [sinAnuladas, filtros.hipodromo]);

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
      [v.caballo, v.jugador, v.grupo, v.hipodromo, String(v.carrera), v.numero, v.fecha, v.fechaVenta].some((s) =>
        s.toLowerCase().includes(q)
      )
    );
  }, [filtradas, busqueda]);

  const hayFiltro = Boolean(filtros.grupo || filtros.hipodromo || filtros.carrera || filtros.jugador);

  /**
   * Acciones del detalle (corregir/anular/restaurar). Solo existen para el perfil
   * Administrador Principal: si no, la tabla se pinta sin la columna.
   */
  const accionesDetalle = useMemo(
    () =>
      puedeEditar
        ? { onAccion: (v: VentaTablaReporte, m: ModoAccionJugada) => setAccion({ venta: v, modo: m }) }
        : undefined,
    [puedeEditar]
  );

  const alAplicar = (mensaje: string) => {
    setAviso(mensaje);
    setAccion(null);
    setRecarga((n) => n + 1);
  };

  const onOrdenar = (k: keyof TotalesReporte | "etiqueta") =>
    setOrden((o) => (o.key === k ? { key: k, dir: o.dir === "desc" ? "asc" : "desc" } : { key: k, dir: k === "etiqueta" ? "asc" : "desc" }));

  if (!abierto) return null;

  const balanceTono = total.balance > 0 ? "text-emerald-700" : total.balance < 0 ? "text-rose-700" : "text-slate-700";

  return (
    <div
      className="rt-overlay fixed inset-0 z-[80] flex items-stretch justify-center bg-slate-950/70 p-2 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
    >
      {accion && (
        <ModalAccionJugadaReporte
          key={`${accion.venta.id}-${accion.modo}`}
          venta={accion.venta}
          modo={accion.modo}
          onCancelar={() => setAccion(null)}
          onHecho={alAplicar}
        />
      )}

      <div className="rt-imprimible flex max-h-[97vh] w-full max-w-[1500px] flex-col overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-2xl">
        {/* Cabecera */}
        <div className={`rt-no-print flex items-center justify-between gap-3 border-b border-black/20 bg-gradient-to-r ${tema.cabecera} px-4 py-2.5 text-white`}>
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-lg leading-none">{icono}</span>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-black uppercase tracking-wide">{titulo}</h2>
              <p className="truncate text-[10px] font-semibold text-white/80">
                {fecha} · {total.tickets} {etiquetas.conteo} · {total.jugadores} jugador(es)
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`hidden items-center gap-1 rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-wide sm:inline-flex ${
                enVivo
                  ? "border-emerald-300 bg-emerald-400/25 text-emerald-50"
                  : "border-white/25 bg-white/10 text-white/60"
              }`}
              title={
                enVivo
                  ? "Conectado: los resultados oficiales actualizan el reporte solos."
                  : "Sin canal en tiempo real. Usá 🔄 para releer los resultados."
              }
            >
              <span className={enVivo ? "animate-pulse" : ""}>●</span>
              {enVivo ? "En vivo" : "Sin vivo"}
            </span>
            <button
              type="button"
              onClick={() => setRecarga((n) => n + 1)}
              title="Volver a leer los resultados oficiales y las ventas del día"
              className="rounded-lg border border-white/30 bg-white/10 px-2 py-1.5 text-xs font-black leading-none transition-colors hover:bg-white/20"
            >
              🔄
            </button>
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
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">📅 Día carrera</span>
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
                  if (d === "carrera") setOrden({ key: "etiqueta", dir: "asc" });
                }}
                className={`rounded px-1.5 py-0.5 text-[10px] font-black uppercase transition-colors ${
                  dimension === d ? tema.activo : "text-slate-500 hover:bg-slate-100"
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
                {m === "resumen" ? "📊 Resumen dinámico" : `🧾 ${etiquetas.detalle}`}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setMostrarAnuladas((v) => !v)}
            title={mostrarAnuladas ? "Ocultar jugadas anuladas en todos los reportes" : "Mostrar jugadas anuladas en todos los reportes"}
            className={`rounded-lg border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide transition-colors ${
              mostrarAnuladas
                ? "border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100"
                : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
            }`}
          >
            {mostrarAnuladas ? "🚫 Ocultar anuladas" : "✅ Mostrar anuladas"}
          </button>
          <label className="ml-auto flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2 py-1 shadow-sm">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">🔎 Buscar</span>
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder={modo === "resumen" ? placeholderResumen : placeholderDetalle}
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

          {aviso && (
            <p className="rt-no-print mb-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
              ✅ {aviso}
            </p>
          )}

          {/* Título solo para impresión */}
          <div className="mb-2 hidden print:block">
            <h1 className="text-center text-base font-black uppercase text-black">
              {titulo} — {fecha}
            </h1>
            <p className="text-center text-[10px] font-semibold text-slate-600">
              {hayFiltro ? "Con filtros aplicados · " : ""}
              {total.tickets} {etiquetas.conteo} · en riesgo {fmt(total.enRiesgo)} · balance {fmt(total.balance)}
            </p>
          </div>

          {/* KPIs */}
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
            <Kpi titulo="🎯 En riesgo" valor={fmt(total.enRiesgo)} sub={`${total.tickets} ${etiquetas.conteo}`} />
            <Kpi titulo="🧑 Jugadores" valor={String(total.jugadores)} sub={`${filas.length} fila(s)`} />
            <Kpi
              titulo="🏆 Ganadores"
              valor={String(total.ganadores)}
              sub={`pagado ${fmt(total.pagado)}`}
              acento="text-emerald-700"
            />
            <Kpi titulo="❌ Perdidos" valor={String(total.perdidos)} acento="text-rose-700" />
            <Kpi
              titulo="🧾 Cobrado neto"
              valor={fmt(total.cobrado)}
              sub="perdido − convenio"
              acento="text-sky-700"
            />
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
              <p className="text-sm font-semibold text-slate-500">{textoCargando(fecha)}</p>
            </div>
          ) : filtradas.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
              <p className="text-sm font-semibold text-slate-500">{textoVacio}</p>
              <p className="mt-1 text-xs text-slate-400">Probá otro día, o quitá filtros.</p>
            </div>
          ) : modo === "detalle" ? (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="overflow-auto">
                <DetalleTabla filas={detalle} etiquetas={etiquetas} tema={tema} acciones={accionesDetalle} producto={producto} />
              </div>
              {producto === "tablas" && filtradas.length > 0 && (() => {
                const retiros = filtradas.filter((v) => !v.anulada && estadoNormalizado(v.estado) === "Retirado");
                const reemb = retiros.reduce((a, v) => a + v.monto, 0);
                if (retiros.length === 0) return null;
                return (
                  <div className="border-t border-amber-200 bg-amber-50/60 px-3 py-2 text-[10px] text-amber-800">
                    <div className="font-black uppercase">Retiros en este filtro</div>
                    <div className="mt-0.5">
                      {retiros.length} tabla(s) retirada(s) · Reembolso: {fmt(reemb)} · Cálculo: se reembolsa el monto jugado (v.monto) al retirado.
                    </div>
                  </div>
                );
              })()}
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-100">
                    <th
                      onClick={() => onOrdenar("etiqueta")}
                      title={`Ordenar por ${DIM_LABEL[dimension]}`}
                      className={`cursor-pointer select-none px-2 py-1.5 text-left text-[9px] font-black uppercase tracking-wide transition-colors ${tema.hover} ${orden.key === "etiqueta" ? tema.acento : "text-slate-500"}`}
                    >
                      {DIM_LABEL[dimension]}
                      {orden.key === "etiqueta" && <span className="ml-0.5">{orden.dir === "desc" ? "▼" : "▲"}</span>}
                    </th>
                    <ThOrden label="En riesgo" k="enRiesgo" orden={orden} onOrdenar={onOrdenar} tema={tema} />
                    <ThOrden label="Tickets" k="tickets" orden={orden} onOrdenar={onOrdenar} tema={tema} />
                    <ThOrden label="Jugad." k="jugadores" orden={orden} onOrdenar={onOrdenar} tema={tema} />
                    <ThOrden label="Ganad." k="ganadores" orden={orden} onOrdenar={onOrdenar} tema={tema} />
                    <ThOrden label="Perd." k="perdidos" orden={orden} onOrdenar={onOrdenar} tema={tema} />
                    <ThOrden label="Pend." k="pendientes" orden={orden} onOrdenar={onOrdenar} tema={tema} />
                    <ThOrden label="Retir." k="retirados" orden={orden} onOrdenar={onOrdenar} tema={tema} />
                    <ThOrden label="Pagado" k="pagado" orden={orden} onOrdenar={onOrdenar} tema={tema} />
                    <ThOrden label="Cobrado" k="cobrado" orden={orden} onOrdenar={onOrdenar} tema={tema} />
                    <ThOrden label="Comisión" k="comision" orden={orden} onOrdenar={onOrdenar} tema={tema} />
                    <ThOrden label="Reemb." k="reembolsado" orden={orden} onOrdenar={onOrdenar} tema={tema} />
                    <ThOrden label="Balance" k="balance" orden={orden} onOrdenar={onOrdenar} tema={tema} />
                  </tr>
                </thead>
                <tbody>
                  {filas.length === 0 && (
                    <tr>
                      <td colSpan={13} className="px-3 py-6 text-center text-[11px] font-semibold text-slate-400">
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
                        etiquetas={etiquetas}
                        tema={tema}
                        acciones={accionesDetalle}
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
                    <td className="px-2 py-1.5 text-right tabular-nums text-sky-700">{fmt(visible.cobrado)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-violet-700">{fmt(visible.comision)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-amber-700">{fmt(visible.reembolsado)}</td>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${balanceTono}`}>{fmt(visible.balance)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <p className="mt-2 text-[10px] font-semibold text-slate-400">{notaPie}</p>
          <p className="mt-1 text-[10px] font-semibold text-slate-500">
            🧾 <b>Cobrado neto</b> = monto perdido × (1 − % de comisión por convenio del grupo que
            publica la jugada). Si el cliente ganó, el monto va a <b>Pagado</b>.
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
  etiquetas,
  tema,
  acciones,
}: {
  fila: FilaReporte;
  abierta: boolean;
  onToggle: () => void;
  tickets: VentaTablaReporte[];
  etiquetas: EtiquetasReporteVentas;
  tema: TemaReporteVentas;
  acciones?: { onAccion: (v: VentaTablaReporte, modo: ModoAccionJugada) => void };
}) {
  const balanceTono = fila.balance > 0 ? "text-emerald-700" : fila.balance < 0 ? "text-rose-700" : "text-slate-400";
  return (
    <>
      <tr
        onClick={onToggle}
        className={`cursor-pointer border-b border-slate-100 transition-colors ${
          abierta ? tema.seleccion : tema.hover
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
          <Money v={fila.cobrado} tono="font-bold text-sky-700" />
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
          <td colSpan={13} className="p-0">
            <div className={`border-y-2 ${tema.borde} bg-white px-2 py-2`}>
              <DetalleTabla filas={tickets} etiquetas={etiquetas} tema={tema} acciones={acciones} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default ReporteVentasModal;
