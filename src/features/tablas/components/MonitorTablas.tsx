"use client";

import { useState, useMemo, useEffect } from "react";
import type { StoredTablaFija } from "@/shared/store/useTablasFijasStore";
import { colorDeNumero, textoDeNumero, fmtMoney, sumaBase, parseNum, SUPERFICIES, type EjemplarTabla } from "@/features/tablas/lib/tipos";
import { pagoPotencialEjemplar } from "@/features/tablas/lib/tablas-fijas";
import { alternarCaballoInvalidadoTablaFija } from "@/features/tablas/lib/rpc";
import { hoyLocal } from "@/features/gaceta/lib/programa";
import { Flag, normalizarNacionalidad } from "@/shared/components/ui/BanderaPais";
import { Button } from "@/shared/components/ui/Button";
import { Guard } from "@/shared/components/ui/Guard";
import { SearchableSelect } from "@/shared/components/ui/SearchableSelect";
import { TicketVentaPreview, type TicketVentaModel } from "@/features/tickets/components/TicketVentaPreview";
import { CargaResultadosModal, type PizarraResultados } from "@/features/liquidacion/components/CargaResultadosModal";
import { EjemplarModal, type VentaRapidaItem } from "@/features/tablas/components/EjemplarModal";
import { EditorCaballos } from "@/features/tablas/components/EditorCaballos";
import { CuadroModal } from "@/features/tablas/components/CuadroModal";
import { ReporteTablasFijasModal } from "@/features/tablas/components/ReporteTablasFijasModal";
import { ControlRiesgoTablasModal } from "@/features/tablas/components/ControlRiesgoTablasModal";
import { listarCuposTabla, guardarCuposTabla, listarGruposVenta, listarClientesVenta, esClienteLibre, grupoDeVentaVigente, type CupoTablaGrupo, type GrupoVenta, type ClienteVenta } from "@/features/grupos/lib/grupos";
import { listarBanquerosGrupo } from "@/features/liquidacion/lib/banqueros";
import { useCarrerasCentrales } from "@/features/carreras/lib/useCarrerasCentrales";
import { aplicarRetirosCarrera } from "@/features/carreras/lib/retiros";
import { guardarCarreraCentral } from "@/features/carreras/lib/central";
import { esFechaIso } from "@/core/utils/fechas";
import { DateInput } from "@/shared/components/ui/DateInput";
import { nombreHipodromoParaMostrar } from "@/features/hipodromos/lib/nombre";
import { diaDeCarrera, normalizarDia, type EjeFecha } from "@/features/carreras/lib/agruparHipodromos";
import { claveHipodromo, numeroCarrera } from "@/features/carreras/lib/claves";
import {
  esTablaActivaEnPortal,
  alternarTablaActivaPortal,
} from "@/features/portal/lib/control-activas-portal";

/** Monedas permitidas al corregir una tabla (el símbolo nunca se muestra). */
const OPCIONES_MONEDA = ["USD", "VES", "BS", "EUR"];

/**
 * Forma ÚNICA de los botones de acción de la cabecera: cuadrado, sin texto, del
 * mismo tamaño para las cuatro acciones. El color lo pone quien lo usa
 * (`bg-amber-500`, `bg-indigo-600`, `bg-emerald-600`, `bg-rose-600`).
 * Un solo lugar para la forma = si mañana se agrandan, se agrandan las cuatro.
 */
const BTN_CRUDA =
  "inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-[13px] leading-none shadow-sm ring-1 ring-white/30 transition hover:scale-105 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-white";

export type VentaTablaItem = {
  tablaId: string | number;
  numero: string;
  nombre: string;
  monto: number;
  cantidad?: number;
  grupo?: { id: string | number; nombre: string } | null;
  jugador?: {
    id: string | number;
    nombre: string;
    saldo_actual?: number;
    aval?: number;
    libre?: boolean;
  } | null;
};

type Props = {
  tablas: StoredTablaFija[];
  onVender?: (item: VentaTablaItem) => Promise<{ ok: boolean; error?: string }>;
  onLiquidar?: (tabla: StoredTablaFija, r: PizarraResultados) => void;
  onEditar?: (tabla: StoredTablaFija, patch: Record<string, unknown>) => void;
  onRetirar?: (tabla: StoredTablaFija, indice: number, retirado: boolean) => Promise<boolean>;
  onEliminar?: (tabla: StoredTablaFija) => void;
  /**
   * Filtro de hipódromo controlado por el padre (ej. las columnas de
   * "Hipódromos del Día"). Si se omite, el filtro opera interno.
   */
  hipodromoFiltro?: string;
  onHipodromoFiltro?: (h: string) => void;
  /**
   * Filtro de día controlado por el padre ("Hipódromos del Día"). Por defecto
   * el Monitor muestra SOLO las tablas del día indicado; si se omite, la fecha
   * opera interna (TODAS a menos que el usuario filtre).
   */
  fechaDia?: string;
  onFechaDia?: (d: string) => void;
  /**
   * Eje del día: fecha de CARRERA (default) o de VENTA. Cambia contra cuál
   * fecha se filtra/agrupa y qué días ofrece el selector. El padre puede
   * controlarlo (Tablas Fijas lo comparte con su panel de Hipódromos); si no,
   * opera interno.
   */
  ejeFecha?: EjeFecha;
  onEjeFecha?: (e: EjeFecha) => void;
  onImprimirTablas?: () => void;
};

  /** Número es-VE SIN símbolo de moneda (la moneda se estipula por el grupo). */
  function fmtValor(n: number | null | undefined): string {
    const num = typeof n === "number" && isFinite(n) ? n : 0;
    // El premio de la tabla no lleva decimales para que sea más legible.
    return num.toLocaleString("es-VE", { maximumFractionDigits: 0 });
  }

  /**
   * PUNTOS de un ejemplar: sin decimales, igual que la impresion.
   *
   * El valor de cada caballo y la SUMA son los dos lados de la division
     * `premio * (valor / suma_base_tabla)`, asi que mostrarlos con decimales
     * solo ensucia la grilla. Se redondea unicamente para mostrar: el valor de
   * `suma_base_tabla` se siguen guardando y sumando con todos sus decimales,
   * porque el formateo es una capa de vista y no toca el dato.
   */
  function fmtPts(n: number | null | undefined): string {
    const num = typeof n === "number" && isFinite(n) ? n : 0;
    return num.toLocaleString("es-VE", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

/** Saldo en 2 decimales, para el previsualizado del descuento en la venta. */
function fmtSaldo(n: number | null | undefined): string {
  return fmtValor(n);
}

/**
 * Día (ISO) de una tabla según el eje pedido.
 *
 *   · "carrera" (default): cuándo CORRE (`fecha`), con respaldo en
 *     `fecha_creacion` para las filas legacy que no traen evento.
 *   · "venta": cuándo se VENDIÓ/publicó (`fecha_creacion`, en hora local), con
 *     respaldo en la fecha del evento.
 *
 * Delega en `diaDeCarrera` (agruparHipodromos) para que el Monitor y el panel
 * de Hipódromos NUNCA discrepen sobre el día de una tabla.
 */
export function diaDeLaTabla(t: StoredTablaFija, eje: EjeFecha = "carrera"): string {
  return diaDeCarrera(t, "", eje);
}

export function MonitorTablas({
  tablas,
  onVender,
  onLiquidar,
  onEditar,
  onRetirar,
  onEliminar,
  hipodromoFiltro: hipodromoFiltroProp,
  onHipodromoFiltro,
  fechaDia: fechaDiaProp,
  onFechaDia,
  ejeFecha: ejeFechaProp,
  onEjeFecha,
  onImprimirTablas,
}: Props) {
  const [vendiendo, setVendiendo] = useState<StoredTablaFija | null>(null);
  const [ejemplarVenta, setEjemplarVenta] = useState("");
  const [montoVenta, setMontoVenta] = useState("");
  const [clienteVenta, setClienteVenta] = useState("");
  const [grupoVenta, setGrupoVenta] = useState("");
  const [vendiendoCargando, setVendiendoCargando] = useState(false);
  const [previewVenta, setPreviewVenta] = useState<{ item: VentaTablaItem; ticket: TicketVentaModel } | null>(null);
  const [previewConfirmando, setPreviewConfirmando] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [liquidando, setLiquidando] = useState<StoredTablaFija | null>(null);
  const [editando, setEditando] = useState<StoredTablaFija | null>(null);
  const [patchEdicion, setPatchEdicion] = useState<Record<string, unknown>>({});
  const [patchCaballos, setPatchCaballos] = useState<EjemplarTabla[]>([]);
  const [patchCupos, setPatchCupos] = useState<CupoTablaGrupo[]>([]);
  /**
   * Cuadro en edicion sobre la tarjeta. `indice === null` significa ALTA (no
   * existe todavia el cuadro), y es lo que distingue "crear" de "editar" sin
   * needing un segundo modal.
   */
  const [cuadroEnEdicion, setCuadroEnEdicion] = useState<{
    tabla: StoredTablaFija;
    indice: number | null;
  } | null>(null);
  const [cuadroBorrando, setCuadroBorrando] = useState<{
    tabla: StoredTablaFija;
    indice: number;
  } | null>(null);
  const [cuadroGuardando, setCuadroGuardando] = useState(false);

  /** Carga los cupos por grupo de la tabla (o construye filas desde grupos_venta). */
  const cargarCupos = async (t: StoredTablaFija) => {
    if (Array.isArray(t.tabla_grupos) && t.tabla_grupos.length > 0) {
      setPatchCupos(
        t.tabla_grupos.map((g) => ({
          id: g.id,
          tabla_id: t.id,
          grupo_id: g.grupo_id ?? "",
          grupo_nombre: g.grupo_nombre ?? null,
          cupos: g.cupos ?? null,
          max: g.max ?? null,
          cantidad_vendida: g.cantidad_vendida ?? 0,
        }))
      );
      return;
    }
    const filas = await listarCuposTabla(t.id).catch(() => []);
    if (filas.length > 0) {
      setPatchCupos(filas);
      return;
    }
    const grupos = await listarGruposVenta().catch(() => []);
    setPatchCupos(
      grupos.map((g) => {
        const esBs =
          String(g.moneda ?? t.moneda ?? "").toUpperCase().includes("VES") ||
          String(g.moneda ?? "").toUpperCase().includes("BS");
        return {
          tabla_id: t.id,
          grupo_id: g.id,
          grupo_nombre: g.nombre,
          cupos: g.cupo_tabla ?? (esBs ? 3000 : 3),
          max: esBs ? 1000 : 3,
        };
      })
    );
  };
  const [aviso, setAviso] = useState("");
  const [confirmarEliminar, setConfirmarEliminar] = useState<StoredTablaFija | null>(null);
  const [ejemplarModal, setEjemplarModal] = useState<{ tabla: StoredTablaFija; indice: number } | null>(null);
  const [tablaControlRiesgo, setTablaControlRiesgo] = useState<StoredTablaFija | null>(null);
  const [activasVersion, setActivasVersion] = useState(0);

  useEffect(() => {
    const handler = () => setActivasVersion((v) => v + 1);
    window.addEventListener("config-activas-portal-cambio", handler);
    return () => window.removeEventListener("config-activas-portal-cambio", handler);
  }, []);

  const toggleActivaPortal = async (tablaId: string | number) => {
    await alternarTablaActivaPortal(tablaId);
    setActivasVersion((v) => v + 1);
  };
  const [opcionesVenta, setOpcionesVenta] = useState<{ grupos: GrupoVenta[]; clientes: ClienteVenta[] }>({
    grupos: [],
    clientes: [],
  });

  /**
   * Grupo con el que VENDE esta sesión (ver `grupoDeVentaVigente`):
   *   · Usuario de un grupo → SU grupo.
   *   · Administrador principal → el grupo elegido en el filtro superior "🗂️ Grupo".
   * Vacío = el principal está mirando "Todos los grupos": ahí sí se pide a mano.
   */
  const grupoSesion = grupoDeVentaVigente();
  /** Nombre del grupo de sesión, para mostrarlo fijo en vez de un <select>. */
  const nombreGrupoSesion =
    opcionesVenta.grupos.find((g) => String(g.id) === grupoSesion)?.nombre ?? "";
  /**
   * Jugadores del buscador: se elige escribiendo el NOMBRE, no recorriendo una
   * lista desplegable (con grupos grandes el <select> era inmanejable).
   */
  const opcionesJugador = useMemo(
    () => opcionesVenta.clientes.map((c) => ({ value: String(c.id), label: String(c.nombre ?? "") })),
    [opcionesVenta.clientes]
  );

  /**
   * Abre el modal de venta trayendo los grupos y clientes de lectura.
   *
   * El GRUPO de la venta ya no se elige "a mano": lo trae la sesión
   * (`grupoDeVentaVigente`), que es el grupo del usuario logueado o, para el
   * administrador principal, el del filtro superior "🗂️ Grupo". Solo cuando el
   * principal mira "Todos los grupos" el `<select>` de grupo queda habilitado.
   */
  const abrirVenta = async (t: StoredTablaFija) => {
    setVendiendo(t);
    setEjemplarVenta("");
    setMontoVenta("");
    setClienteVenta("");
    setGrupoVenta(grupoSesion);
    setVendiendoCargando(true);
    const [grupos, clientes] = await Promise.all([
      listarGruposVenta().catch(() => [] as GrupoVenta[]),
      listarClientesVenta().catch(() => [] as ClienteVenta[]),
    ]);
    setOpcionesVenta({ grupos, clientes });
    setVendiendoCargando(false);
  };

  /**
   * Al elegir jugador se fija el jugador. El GRUPO ya no lo decide el jugador:
   * lo trae la sesión (`grupoSesion`). Solo el principal en "Todos los grupos"
   * no tiene grupo determinado y ahí se propone el del jugador para poder cambiarlo.
   */
  const elegirClienteVenta = (clienteId: string) => {
    setClienteVenta(clienteId);
    if (grupoSesion) return;
    const c = opcionesVenta.clientes.find((x) => String(x.id) === clienteId);
    const g = c?.grupo_id ?? c?.grupos?.[0] ?? "";
    setGrupoVenta(g != null && g !== "" ? String(g) : "");
  };

  const [vistaImpresion, setVistaImpresion] = useState(false);
  /** Reporte de tablas fijas VENDIDAS (ícono en la barra de filtros). */
  const [reporteAbierto, setReporteAbierto] = useState(false);

  // Estados de los filtros
  /** Día por defecto: si el padre controla la fecha, su valor manda (Tablas
   *  Fijas arranca en HOY); si queda interno, también arranca en hoy. */
  const [fechaInterna, setFechaInterna] = useState<string>(() => hoyLocal());
  const [hipodromoLocal, setHipodromoLocal] = useState<string>("");
  /** Carrera filtrada (vacío = todas) y progreso del Excel de la pantalla. */
  const [carreraFiltro, setCarreraFiltro] = useState<string>("");
  const [exportandoExcel, setExportandoExcel] = useState(false);

  /** Densidad visual de las tarjetas: cómoda (default, espaciosa) vs compacta (alta densidad). */
  const [densidadVista, setDensidadVista] = useState<"comoda" | "compacta">(() => {
    if (typeof window !== "undefined") {
      const salvada = localStorage.getItem("hipico_tablas_densidad");
      if (salvada === "compacta" || salvada === "comoda") return salvada;
    }
    return "compacta";
  });

  const alternarDensidad = (d: "comoda" | "compacta") => {
    setDensidadVista(d);
    if (typeof window !== "undefined") {
      localStorage.setItem("hipico_tablas_densidad", d);
    }
  };

  /** Filtro de estado: abiertas para venta o todas (incluye cerradas y liquidadas). */
  const [filtroEstado, setFiltroEstado] = useState<"abiertas" | "todas">("abiertas");
  /** Buscador rápido en tiempo real por caballo, número o carrera. */
  const [busquedaTexto, setBusquedaTexto] = useState("");

  /** Hipódromo filtrado: si el padre controla el filtro (Hipódromos del Día),
   *  lo gobierna desde arriba; si no, opera interno. */
  const hipodromoControlado = onHipodromoFiltro !== undefined;
  const hipodromoFiltro = hipodromoControlado ? hipodromoFiltroProp ?? "" : hipodromoLocal;
  const setHipodromoFiltro = (v: string) =>
    hipodromoControlado ? onHipodromoFiltro?.(v) : setHipodromoLocal(v);

  /** Día filtrado: si el padre controla la fecha (Hipódromos del Día) lo
   *  gobierna desde arriba (hoy por defecto); si no, opera interno (TODAS). */
  const fechaControlada = onFechaDia !== undefined;
  const fechaFiltro = fechaControlada ? fechaDiaProp ?? "" : fechaInterna;
  const setFechaFiltro = (v: string) =>
    fechaControlada ? onFechaDia?.(v) : setFechaInterna(v);

  /** Eje del día: CARRERA (default) o VENTA. Si el padre lo controla (Tablas
   *  Fijas lo comparte con su panel), manda su valor; si no, opera interno. */
  const [ejeInterno, setEjeInterno] = useState<EjeFecha>("carrera");
  const ejeControlado = onEjeFecha !== undefined;
  const ejeFecha = ejeControlado ? ejeFechaProp ?? "carrera" : ejeInterno;
  const setEjeFecha = (v: EjeFecha) =>
    ejeControlado ? onEjeFecha?.(v) : setEjeInterno(v);
  /** Las carreras del registro central no tienen fecha de venta: solo
   *  alimentan los filtros en el eje de CARRERA. */
  const centralEnFiltro = ejeFecha === "carrera";

  // Data base según filtro de estado: abiertas para venta o todas
  const baseTablas = useMemo(() => {
    return filtroEstado === "abiertas" ? tablas.filter((t) => !t.cerrada) : tablas;
  }, [tablas, filtroEstado]);

  // Conteo de tablas por hipódromo para las píldoras de navegación rápida
  const conteoPorHipodromo = useMemo(() => {
    const counts: Record<string, number> = {};
    const fNorm = normalizarDia(fechaFiltro);
    baseTablas.forEach((t) => {
      if (fNorm && normalizarDia(diaDeLaTabla(t, ejeFecha)) !== fNorm) return;
      const hipoKey = t.hipodromo ? claveHipodromo(t.hipodromo) : "";
      if (hipoKey) {
        counts[hipoKey] = (counts[hipoKey] || 0) + 1;
      }
    });
    return counts;
  }, [baseTablas, fechaFiltro, ejeFecha]);

  const abiertas = useMemo(() => tablas.filter((t) => !t.cerrada), [tablas]);

  // DATA CENTRAL: días e hipódromos con carreras registradas en Carreras del
  // Día, aunque todavía no tengan tabla fija publicada, para que el filtro en
  // cascada ofrezca la jornada completa.
  const { centrales: centralCarreras } = useCarrerasCentrales();

  // FILTROS EN CASCADA BIDIRECCIONALES
  const fechasDisponibles = useMemo(() => {
    const setFechas = new Set<string>();
    const hipoKey = claveHipodromo(hipodromoFiltro);
    baseTablas.forEach((t) => {
      if (!hipoKey || claveHipodromo(t.hipodromo) === hipoKey) {
        const d = normalizarDia(diaDeLaTabla(t, ejeFecha));
        if (d) setFechas.add(d);
      }
    });
    if (centralEnFiltro) {
      centralCarreras.forEach((c) => {
        if (!hipoKey || claveHipodromo(c.hipodromo) === hipoKey) {
          const d = normalizarDia(c.fecha);
          if (d) setFechas.add(d);
        }
      });
    }
    // El día elegido se ofrece siempre para que no se resetee
    if (fechaFiltro) {
      const fn = normalizarDia(fechaFiltro);
      if (fn) setFechas.add(fn);
    }
    return Array.from(setFechas).sort().reverse();
  }, [baseTablas, hipodromoFiltro, centralCarreras, fechaFiltro, ejeFecha, centralEnFiltro]);

  const hipodromosDisponibles = useMemo(() => {
    const mapHips = new Map<string, string>();
    const fNorm = normalizarDia(fechaFiltro);
    baseTablas.forEach((t) => {
      if (!fNorm || normalizarDia(diaDeLaTabla(t, ejeFecha)) === fNorm) {
        if (t.hipodromo) {
          const k = claveHipodromo(t.hipodromo);
          if (!mapHips.has(k)) mapHips.set(k, t.hipodromo);
        }
      }
    });
    if (centralEnFiltro) {
      centralCarreras.forEach((c) => {
        if (!fNorm || normalizarDia(c.fecha) === fNorm) {
          if (c.hipodromo) {
            const k = claveHipodromo(c.hipodromo);
            if (!mapHips.has(k)) mapHips.set(k, c.hipodromo);
          }
        }
      });
    }
    return Array.from(mapHips.values()).sort((a, b) =>
      nombreHipodromoParaMostrar(a).localeCompare(nombreHipodromoParaMostrar(b))
    );
  }, [baseTablas, fechaFiltro, centralCarreras, ejeFecha, centralEnFiltro]);

  /** Números de carrera disponibles dentro del día + hipódromo filtrados. */
  const carrerasDisponibles = useMemo(() => {
    const nums = new Set<string>();
    const fNorm = normalizarDia(fechaFiltro);
    const hipoKey = claveHipodromo(hipodromoFiltro);
    baseTablas.forEach((t) => {
      if (fNorm && normalizarDia(diaDeLaTabla(t, ejeFecha)) !== fNorm) return;
      if (hipoKey && claveHipodromo(t.hipodromo) !== hipoKey) return;
      const num = numeroCarrera(t.carrera);
      if (num > 0) nums.add(String(num));
    });
    if (centralEnFiltro) {
      centralCarreras.forEach((c) => {
        if (fNorm && normalizarDia(c.fecha) !== fNorm) return;
        if (hipoKey && claveHipodromo(c.hipodromo) !== hipoKey) return;
        const num = numeroCarrera(c.carrera);
        if (num > 0) nums.add(String(num));
      });
    }
    return Array.from(nums).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0));
  }, [baseTablas, centralCarreras, fechaFiltro, hipodromoFiltro, ejeFecha, centralEnFiltro]);

  // La carrera elegida se descarta sola si cambia el día o el hipódromo, para
  // que el filtro nunca quede huérfano (mostrando "0 tablas" sin motivo).
  useEffect(() => {
    if (carreraFiltro && !carrerasDisponibles.includes(carreraFiltro)) setCarreraFiltro("");
  }, [carrerasDisponibles, carreraFiltro]);

  // El día filtrado SIEMPRE está en `fechasDisponibles` (se agrega arriba), así
  // que el filtro jamás queda huérfano ni se resetea a "todas las fechas".

  useEffect(() => {
    if (hipodromoControlado) return; // el padre gobierna el filtro de hipódromo
    const hipoKey = claveHipodromo(hipodromoFiltro);
    if (hipoKey && !hipodromosDisponibles.some((h) => claveHipodromo(h) === hipoKey)) {
      setHipodromoLocal("");
    }
  }, [hipodromosDisponibles, hipodromoFiltro, hipodromoControlado]);

  // Aplicación del filtro final con orden numérico y búsqueda instantánea
  const filtradas = useMemo(() => {
    const q = busquedaTexto.trim().toLowerCase();
    const fNorm = normalizarDia(fechaFiltro);
    const hipoKey = claveHipodromo(hipodromoFiltro);
    const carNum = numeroCarrera(carreraFiltro);

    return baseTablas
      .filter((t) => {
        if (fNorm && normalizarDia(diaDeLaTabla(t, ejeFecha)) !== fNorm) return false;
        if (hipoKey && claveHipodromo(t.hipodromo) !== hipoKey) return false;
        if (carNum > 0 && numeroCarrera(t.carrera) !== carNum) return false;
        if (q) {
          const hipoNombre = (t.hipodromo ?? "").toLowerCase();
          const hipoMostrar = nombreHipodromoParaMostrar(t.hipodromo).toLowerCase();
          const carreraStr = String(t.carrera ?? "").toLowerCase();
          const matchHipo = hipoNombre.includes(q) || hipoMostrar.includes(q);
          const matchCarrera =
            carreraStr === q ||
            `c${carreraStr}` === q ||
            `carrera ${carreraStr}`.includes(q);
          const matchCaballos = (t.caballos ?? []).some((c) => {
            const num = String(c.numero ?? "").toLowerCase();
            const nom = (c.nombre ?? "").toLowerCase();
            return num === q || `n${num}` === q || `#${num}` === q || nom.includes(q);
          });
          if (!matchHipo && !matchCarrera && !matchCaballos) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const hipo = (a.hipodromo ?? "").localeCompare(b.hipodromo ?? "", "es");
        if (hipo !== 0) return hipo;
        const ca = Number(a.carrera);
        const cb = Number(b.carrera);
        const va = Number.isFinite(ca) && ca > 0 ? ca : Number.POSITIVE_INFINITY;
        const vb = Number.isFinite(cb) && cb > 0 ? cb : Number.POSITIVE_INFINITY;
        if (va !== vb) return va - vb;
        return diaDeLaTabla(a, ejeFecha).localeCompare(diaDeLaTabla(b, ejeFecha));
      });
  }, [baseTablas, fechaFiltro, hipodromoFiltro, carreraFiltro, ejeFecha, busquedaTexto]);

  /**
   * Excel de lo que se está mirando: se arma la matriz con las MISMAS filas
   * del Monitor y los MISMOS tres filtros (día + hipódromo + carrera), así el
   * `.xls` nunca trae más carreras que la pantalla.
   */
  const exportarExcel = async () => {
    if (exportandoExcel) return;
    if (filtradas.length === 0) {
      setAviso("No hay tablas publicadas con los filtros actuales para exportar.");
      return;
    }
    setExportandoExcel(true);
    setAviso("");
    try {
      const [{ matrizDesdeFilas }, { exportarExcelTablas }] = await Promise.all([
        import("@/features/impresion/lib/tablas"),
        import("@/features/impresion/lib/excel"),
      ]);
      const m = await matrizDesdeFilas(filtradas, {
        // `filtradas` YA trae aplicado el día en el eje que el usuario eligió
        // (carrera o venta). Volver a filtrar aquí por `String(c.fecha)` —que es
        // SIEMPRE la fecha de carrera— rompería la exportación en modo VENTA.
        // Se pasa vacío a propósito: la lista en pantalla es la fuente de verdad.
        dia: "",
        hipodromo: hipodromoFiltro,
        carrera: carreraFiltro,
      });
      if (m.carreras.length === 0) {
        setAviso("No se pudieron armar las filas del Excel con los filtros actuales.");
        return;
      }
      const sufijo = [
        ejeFecha === "venta" ? "VENTA" : "",
        fechaFiltro,
        hipodromoFiltro,
        carreraFiltro ? `C${carreraFiltro}` : "",
      ]
        .filter(Boolean)
        .join("_");
      const ok = exportarExcelTablas(m.carreras, `TABLAS-PUBLICADAS-${sufijo || "jornada"}`);
      if (ok) setAviso(`Excel generado con ${m.carreras.length} carrera(s).`);
      else setAviso("No se pudo generar el archivo Excel.");
    } catch (e) {
      setAviso(`No se pudo generar el Excel: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExportandoExcel(false);
    }
  };

  const lanzarVenta = async () => {
    if (!vendiendo || !ejemplarVenta.trim() || !montoVenta.trim()) {
      return setAviso("Selecciona un ejemplar e indica el monto jugado.");
    }
    if (!clienteVenta) {
      return setAviso("Selecciona el jugador: la venta se descuenta de su saldo.");
    }
    /* El grupo de la SESIÓN manda. Solo cuando el principal mira "Todos los
       grupos" (`grupoSesion === ""`) se usa el que se eligió en el <select>. */
    const grupoEfectivo = grupoSesion || grupoVenta;
    if (!grupoEfectivo) {
      return setAviso("Selecciona el grupo: define la moneda y el convenio de comisión.");
    }
    const monto = parseNum(montoVenta);
    if (!(monto > 0)) {
      return setAviso("El monto debe ser un número mayor a cero.");
    }
    const cliente = opcionesVenta.clientes.find((x) => String(x.id) === clienteVenta);
    const grupo = opcionesVenta.grupos.find((x) => String(x.id) === grupoEfectivo);
    const cObj = (vendiendo.caballos ?? []).find((c) => String(c.numero) === ejemplarVenta);
    const nombreCab = cObj?.nombre ?? "TABLA COMPLETA";
    const valorUnitario = parseNum(cObj?.valor_ejemplar);
    const cantidadCalculada =
      ejemplarVenta === "TABLA"
        ? Math.max(1, Math.round(monto))
        : valorUnitario > 0
          ? Math.max(1, Math.round(monto / valorUnitario))
          : 1;
    const item: VentaTablaItem = {
      tablaId: vendiendo.id,
      numero: ejemplarVenta,
      nombre: nombreCab,
      monto,
      cantidad: cantidadCalculada,
      grupo: grupo
        ? { id: grupo.id, nombre: grupo.nombre }
        : grupoEfectivo
          ? { id: grupoEfectivo, nombre: nombreGrupoSesion || `Grupo ${grupoEfectivo}` }
          : null,
      jugador: cliente
        ? {
            id: cliente.id,
            nombre: cliente.nombre,
            saldo_actual: Number(cliente.saldo_actual ?? 0),
            aval: Number(cliente.aval ?? 0) || 0,
            libre: esClienteLibre(cliente),
          }
        : null,
    };
    const saldo = Number(cliente?.saldo_actual ?? 0);
    const bq = (await listarBanquerosGrupo(grupoEfectivo)).find(
      (b) => b.modalidad === "TABLAS" && b.activo !== false && b.banquero_cliente_id
    );
    setAviso("");
    setPreviewError(null);
    setPreviewVenta({
      item,
      ticket: {
        modalidad: "TABLA FIJA",
        hipodromo: vendiendo.hipodromo ?? "",
        fecha: diaDeLaTabla(vendiendo),
        carrera: vendiendo.carrera ?? "",
        titulo: `TABLA ${nombreHipodromoParaMostrar(vendiendo.hipodromo)} C${vendiendo.carrera} · ${ejemplarVenta === "TABLA" ? "COMPLETA" : `Nº ${ejemplarVenta}`}`,
        detalle: `${nombreCab}${cantidadCalculada > 1 ? ` × ${cantidadCalculada} tablas` : ""}`,
        jugador: cliente?.nombre ?? "",
        grupo: grupo?.nombre ?? (grupoEfectivo ? nombreGrupoSesion || null : null),
        monto,
        moneda: grupo?.moneda ?? vendiendo.moneda,
        pago: pagoPotencialNumerico(vendiendo, ejemplarVenta, monto, cantidadCalculada),
        saldoAntes: saldo,
        saldoDespues: saldo - monto,
        banquero: "TF",
        banqueroCobra: bq?.cobra_comision ?? false,
        banqueroComision: bq?.comision_porcentaje ?? null,
        banqueroBase: bq?.comision_base ?? null,
      },
    });
  };

  const confirmarVentaPreview = async () => {
    if (!previewVenta || !onVender) return;
    setPreviewConfirmando(true);
    setPreviewError(null);
    const r = await onVender(previewVenta.item);
    setPreviewConfirmando(false);
    if (!r.ok) {
      setPreviewError(r.error ?? "No se pudo registrar la venta.");
      return;
    }
    setPreviewVenta(null);
    setVendiendo(null);
    setEjemplarVenta("");
    setMontoVenta("");
    setClienteVenta("");
    setGrupoVenta("");
    setAviso("🛒 Venta registrada: se descontó del saldo y se creó el ticket.");
  };

  /**
   * Persiste la lista de cuadros de una tabla y la propaga a la data central.
   *
   * Los cuadros viven en el array JSONB `caballos` y no tienen columna propia,
   * asi que cualquier cambio (alta, edicion o baja de un cuadro suelto) se
   * guarda reescribiendo el array entero mas el recalculo de
   * `suma_base_tabla`. La suma se toma de `sumaBase`, que EXCLUYE los retirados:
   * es la misma funcion con la que se siembra la tabla al publicarla, y la que
   * usa el pie "Suma" de la tarjeta. Antes `guardarEdicion` hacia la suma a mano
   * sumando tambien los retirados, y por eso el pie podia no cuadrar con lo que
   * acababa de guardar el mismo operador.
   */
  const persistirCaballos = async (
    tabla: StoredTablaFija,
    caballos: EjemplarTabla[],
    patchAdicional?: Record<string, unknown>
  ): Promise<boolean> => {
    const suma = sumaBase(caballos);

    // La tabla y la carrera son el mismo dato. Se corrigen juntas, respetando
    // los retiros vigentes.
    const fecha = String(patchAdicional?.fecha ?? tabla.fecha ?? "");
    const dia = fecha ? diaDeLaTabla({ ...tabla, fecha } as StoredTablaFija) : "";
    if (dia) {
      const hip = String(patchAdicional?.hipodromo ?? tabla.hipodromo ?? "").trim().toUpperCase();
      const car = parseNum(patchAdicional?.carrera ?? tabla.carrera ?? "") || 0;
      const guardo = await guardarCarreraCentral({
        fecha: dia,
        hipodromo: hip,
        carrera: car,
        caballos: caballos.map((c) => ({
          numero: String(c.numero),
          nombre: String(c.nombre ?? ""),
          retirado: Boolean(c.retirado),
        })),
        distancia: String(patchAdicional?.distancia_carrera ?? tabla.distancia_carrera ?? ""),
        superficie: String(patchAdicional?.superficie ?? tabla.superficie ?? ""),
      });
      if (!guardo.ok) {
        setAviso(`⚠️ Tabla guardada, pero la carrera central no se actualizó: ${guardo.error ?? "sin conexión"}`);
      } else {
        const ret = await aplicarRetirosCarrera({
          fecha: dia,
          hipodromo: hip,
          carrera: car,
          numeros: caballos.filter((c) => c.retirado).map((c) => String(c.numero)),
        });
        if (!ret.ok) {
          setAviso(`⚠️ Tabla y carrera guardadas, pero los retiros no se propagaron: ${ret.error ?? "sin conexión"}`);
        }
      }
    }

    onEditar?.(tabla, { ...(patchAdicional ?? {}), caballos, suma_base_tabla: suma });
    return true;
  };

  const guardarEdicion = async () => {
    if (editando) {
      const rC = await guardarCuposTabla(
        editando.id,
        patchCupos.map((g) => ({ grupo_id: g.grupo_id, cupos: g.cupos ?? 0, max: g.max ?? null }))
      );
      if (!rC.ok) setAviso(`⚠️ Cupos: ${rC.error ?? "no guardados (revise la tabla " + String(editando.id) + ")."}`);

      await persistirCaballos(editando, patchCaballos, patchEdicion);
    }
    setEditando(null);
    setPatchEdicion({});
    setPatchCaballos([]);
    setPatchCupos([]);
    setAviso("✅ Tabla corregida y guardada.");
  };

  /**
   * Aplica el resultado del CRUD de un cuadro sobre el array `caballos` de la
   * tabla y lo persiste. Centraliza el alta, la edicion y la baja para que las
   * tres rutas hagan exactamente lo mismo (misma suma, misma sincronizacion con
   * la carrera central, mismo aviso).
   */
  const aplicarCuadro = async (
    tabla: StoredTablaFija,
    indice: number | null,
    cuadro: EjemplarTabla | null
  ) => {
    const actuales = (tabla.caballos ?? []).map((c) => ({ ...c }));
    const nuevos =
      cuadro === null
        ? actuales.filter((_, i) => i !== indice)
        : indice === null
          ? [...actuales, cuadro]
          : actuales.map((c, i) => (i === indice ? { ...c, ...cuadro } : c));
    await persistirCaballos(tabla, nuevos);
  };

  const guardarCuadro = async (cuadro: EjemplarTabla) => {
    if (!cuadroEnEdicion) return;
    setCuadroGuardando(true);
    try {
      await aplicarCuadro(cuadroEnEdicion.tabla, cuadroEnEdicion.indice, cuadro);
      setAviso(
        cuadroEnEdicion.indice === null
          ? "✅ Cuadro añadido a la tabla."
          : "✅ Cuadro actualizado."
      );
      setCuadroEnEdicion(null);
    } finally {
      setCuadroGuardando(false);
    }
  };

  const borrarCuadro = async () => {
    if (!cuadroBorrando) return;
    setCuadroGuardando(true);
    try {
      const t = cuadroBorrando.tabla;
      const i = cuadroBorrando.indice;
      const nombre = String(t.caballos?.[i]?.nombre ?? "");
      await aplicarCuadro(t, i, null);
      setCuadroBorrando(null);
      setCuadroEnEdicion(null);
      setAviso(`🗑️ Cuadro ${nombre || i + 1} quitado de la tabla.`);
    } finally {
      setCuadroGuardando(false);
    }
  };

  const ventaRapida = async (tabla: StoredTablaFija, item: VentaRapidaItem) => {
    const venta: VentaTablaItem = {
      tablaId: tabla.id,
      numero: item.numero,
      nombre: item.nombre,
      monto: item.monto,
      cantidad: item.cantidad,
      grupo: item.grupo,
      jugador: item.jugador,
    };
    const saldo = Number(item.jugador?.saldo_actual ?? 0);
    const bq = item.grupo?.id
      ? (await listarBanquerosGrupo(item.grupo.id)).find(
          (b) => b.modalidad === "TABLAS" && b.activo !== false && b.banquero_cliente_id
        )
      : undefined;
    setAviso("");
    setPreviewError(null);
    setPreviewVenta({
      item: venta,
      ticket: {
        modalidad: "TABLA FIJA",
        hipodromo: tabla.hipodromo ?? "",
        fecha: diaDeLaTabla(tabla),
        carrera: tabla.carrera ?? "",
        titulo: `TABLA ${nombreHipodromoParaMostrar(tabla.hipodromo)} C${tabla.carrera} · Nº ${item.numero}`,
        detalle: `${item.nombre}${item.cantidad > 1 ? ` × ${item.cantidad} tablas` : ""}`,
        jugador: item.jugador?.nombre ?? "",
        grupo: item.grupo?.nombre ?? null,
        monto: item.monto,
        moneda: tabla.moneda,
        pago: pagoPotencialNumerico(tabla, item.numero, item.monto, item.cantidad),
        saldoAntes: saldo,
        saldoDespues: saldo - item.monto,
        banquero: "TF",
        banqueroCobra: bq?.cobra_comision ?? false,
        banqueroComision: bq?.comision_porcentaje ?? null,
        banqueroBase: bq?.comision_base ?? null,
      },
    });
  };

  const cerrarEjemplarRetiro = async (tabla: StoredTablaFija, indice: number, retirado: boolean): Promise<boolean> => {
    if (!onRetirar) return true;
    const ok = await onRetirar(tabla, indice, retirado);
    if (ok) setAviso(retirado ? "✅ Ejemplar retirado (premio recalculado)." : "✅ Ejemplar rehabilitado.");
    return ok;
  };

  /**
   * Marca (o habilita) un ejemplar como INVALIDADO en la tabla publicada.
   *
   * El botón del grid ya deja el parche en el editor (por eso se siente
   * inmediato), pero la escritura va por la RPC: es la que valida la
   * capacidad del operador en el servidor y la que guarda el motivo. Si la
   * RPC todavía no está instalada, el cambio queda solo en el parche local y se
   * guarda al presionar "Corregir y guardar" (con el aviso del operador).
   */
  const alternarInvalidado = async (indice: number, invalidado: boolean) => {
    const c = patchCaballos[indice];
    if (!editando || !c) return;
    const r = await alternarCaballoInvalidadoTablaFija({
      tablaId: editando.id,
      numero: c.numero,
      invalidado,
      motivo: invalidado ? "Invalidado en Tabla Fija" : null,
      // Refresco del estado local: la fila vuelve del servidor y el editor
      // queda mostrando lo que quedo guardado (no lo que se quiso).
      alActualizar: (fila) =>
        setPatchCaballos((cs) =>
          cs.map((x, j) =>
            j === indice
              ? { ...x, invalidado: fila.invalidado, motivo_invalidacion: fila.motivo_invalidacion ?? undefined }
              : x
          )
        ),
    });
    if (!r.ok) {
      setAviso(`⚠️ No se pudo registrar el invalidamiento: ${r.error ?? "sin conexión"}`);
      return;
    }
    setAviso(
      r.data?.invalidado
        ? `🚫 Ejemplar ${String(c.numero ?? "")} INVALIDADO: no puede ganar ni ser pagado como ganador.`
        : `✔ Ejemplar ${String(c.numero ?? "")} habilitado: vuelve a poder ganar.`
    );
  };

  const ejemplarActual = ejemplarModal
    ? { tabla: ejemplarModal.tabla, ejemplar: (ejemplarModal.tabla.caballos ?? [])[ejemplarModal.indice] }
    : null;

  return (
    <div className="space-y-4">
      {aviso && <p className="rounded-lg bg-success-500/10 px-3 py-2 text-xs font-semibold text-success-700 no-print">{aviso}</p>}

      {/* BARRA DE FILTROS, BUSCADOR Y HERRAMIENTAS */}
      <div className="no-print space-y-2 rounded-xl border border-slate-200 bg-slate-50/90 p-2.5 shadow-xs">
        {/* FILTROS Y ACCIONES EN UNA SOLA LÍNEA UNIFICADA */}
        <div className="flex flex-wrap items-center gap-2">
        {/* Conteo de Tablas */}
        <span className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-indigo-200/60 bg-indigo-100/80 px-2.5 text-xs font-black text-indigo-900 shadow-2xs">
          📊 {filtradas.length} {filtradas.length === 1 ? "tabla" : "tablas"}
        </span>

        {/* Selector de Estado: Abiertas vs Todas */}
        <div className="inline-flex h-9 shrink-0 items-center rounded-lg border border-slate-300 bg-white p-0.5 shadow-2xs">
          <button
            type="button"
            onClick={() => setFiltroEstado("abiertas")}
            className={`inline-flex h-8 items-center rounded-md px-2.5 text-[11px] font-black uppercase tracking-wide transition ${
              filtroEstado === "abiertas"
                ? "bg-emerald-600 text-white shadow-2xs"
                : "text-slate-600 hover:bg-slate-100"
            }`}
            title="Mostrar únicamente tablas abiertas para venta"
          >
            🟢 Abiertas
          </button>
          <button
            type="button"
            onClick={() => setFiltroEstado("todas")}
            className={`inline-flex h-8 items-center rounded-md px-2.5 text-[11px] font-black uppercase tracking-wide transition ${
              filtroEstado === "todas"
                ? "bg-slate-800 text-white shadow-2xs"
                : "text-slate-600 hover:bg-slate-100"
            }`}
            title="Mostrar todas las tablas, incluidas cerradas y liquidadas"
          >
            🏁 Todas
          </button>
        </div>

        {/* Selector de Densidad: Cómoda vs Compacta */}
        <div className="inline-flex h-9 shrink-0 items-center rounded-lg border border-slate-300 bg-white p-0.5 shadow-2xs">
          <button
            type="button"
            onClick={() => alternarDensidad("comoda")}
            className={`inline-flex h-8 items-center rounded-md px-2.5 text-[11px] font-black uppercase tracking-wide transition ${
              densidadVista === "comoda"
                ? "bg-indigo-600 text-white shadow-2xs"
                : "text-slate-600 hover:bg-slate-100"
            }`}
            title="Modo Cómodo: tarjetas amplias, texto legible para pantallas móviles y táctiles"
          >
            📱 Cómoda
          </button>
          <button
            type="button"
            onClick={() => alternarDensidad("compacta")}
            className={`inline-flex h-8 items-center rounded-md px-2.5 text-[11px] font-black uppercase tracking-wide transition ${
              densidadVista === "compacta"
                ? "bg-indigo-600 text-white shadow-2xs"
                : "text-slate-600 hover:bg-slate-100"
            }`}
            title="Modo Compacto: cuadrícula densa para ver muchas tablas a la vez en taquillas y pantallas grandes"
          >
            🖥️ Compacta
          </button>
        </div>

        {/* Buscador Rápido */}
        <div className="relative h-9 min-w-[180px] max-w-xs flex-1">
          <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2.5 text-xs text-slate-400">
            🔍
          </span>
          <input
            type="text"
            value={busquedaTexto}
            onChange={(e) => setBusquedaTexto(e.target.value)}
            placeholder="Buscar caballo, Nº o carrera..."
            className="h-9 w-full rounded-lg border border-slate-300 bg-white py-1 pl-8 pr-7 text-xs font-bold text-slate-800 placeholder-slate-400 shadow-2xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          {busquedaTexto ? (
            <button
              type="button"
              onClick={() => setBusquedaTexto("")}
              className="absolute inset-y-0 right-0 flex items-center pr-2 text-xs font-bold text-slate-400 hover:text-slate-700"
              title="Limpiar búsqueda"
            >
              ✕
            </button>
          ) : null}
        </div>

        {/* Eje del día */}
        <div className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg border border-slate-300 bg-white p-0.5 shadow-2xs">
          <span className="px-1 text-[10px] font-black uppercase tracking-wider text-slate-500">🧭 Eje</span>
          <button
            type="button"
            onClick={() => setEjeFecha("carrera")}
            title="Agrupar y filtrar por la fecha en que CORRE la carrera"
            className={`inline-flex h-8 items-center rounded px-2 text-[10px] font-black uppercase tracking-wide transition ${
              ejeFecha === "carrera" ? "bg-indigo-600 text-white shadow-2xs" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            🏇 Carrera
          </button>
          <button
            type="button"
            onClick={() => setEjeFecha("venta")}
            title="Agrupar y filtrar por la fecha en que se VENDIÓ/publicó la tabla"
            className={`inline-flex h-8 items-center rounded px-2 text-[10px] font-black uppercase tracking-wide transition ${
              ejeFecha === "venta" ? "bg-emerald-600 text-white shadow-2xs" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            🧾 Venta
          </button>
        </div>

        {/* Filtro Fecha */}
        <div className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2 shadow-2xs">
          <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
            {ejeFecha === "venta" ? "🧾 Venta" : "📅 Carrera"}
          </span>
          <DateInput
            value={fechaFiltro}
            onFechaChange={(val) => setFechaFiltro(val)}
            placeholder="TODAS"
            className="h-8 border-0 bg-transparent py-0 px-1 text-xs font-bold text-slate-900 shadow-none focus:ring-0 w-28"
          />
          {fechaFiltro ? (
            <button
              type="button"
              onClick={() => setFechaFiltro("")}
              title="Ver todas las fechas"
              className="px-1 text-[10px] font-bold text-slate-400 hover:text-slate-700"
            >
              ✕
            </button>
          ) : null}
        </div>

        {/* Filtro Carrera */}
        <label className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 shadow-2xs">
          <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">🏇 Carrera</span>
          <select
            value={carreraFiltro}
            onChange={(e) => setCarreraFiltro(e.target.value)}
            disabled={carrerasDisponibles.length === 0}
            className="h-8 bg-transparent text-xs font-bold text-slate-900 focus:outline-none"
          >
            <option value="">TODAS</option>
            {carrerasDisponibles.map((c) => (
              <option key={c} value={c}>
                C{c}
              </option>
            ))}
          </select>
        </label>

        {/* Limpiar filtros */}
        {(fechaFiltro !== "" || hipodromoFiltro !== "" || carreraFiltro !== "" || busquedaTexto !== "") && (
          <button
            type="button"
            onClick={() => {
              setFechaFiltro("");
              setHipodromoFiltro("");
              setCarreraFiltro("");
              setBusquedaTexto("");
            }}
            className="inline-flex h-9 shrink-0 items-center rounded-lg border border-red-200 bg-red-50 px-2.5 text-[10px] font-black uppercase text-red-600 transition hover:bg-red-100 hover:text-red-700 shadow-2xs"
          >
            ✕ Limpiar filtros
          </button>
        )}

        {/* Botones de acción al final */}
        <div className="flex flex-wrap items-center gap-1.5 ml-auto">
          <button
            type="button"
            onClick={() => setVistaImpresion((v) => !v)}
            className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 text-[10px] font-black uppercase tracking-wide text-indigo-700 shadow-2xs transition-colors hover:bg-indigo-50"
          >
            🖨️ {vistaImpresion ? "Volver a Edición" : "Vista de impresión"}
          </button>

          {onImprimirTablas && (
            <Guard permiso="tablas:btn_imprimir">
              <button
                type="button"
                onClick={onImprimirTablas}
                className="inline-flex h-9 items-center gap-1 rounded-lg bg-emerald-600 px-2.5 text-[10px] font-black uppercase tracking-wide text-white shadow-2xs transition-colors hover:bg-emerald-700"
                title="Imprimir / exportar tablas publicadas (matriz 15 por hoja o reporte por jugador)"
              >
                🖨️ Imprimir Tablas
              </button>
            </Guard>
          )}

          <button
            type="button"
            onClick={() => void exportarExcel()}
            disabled={exportandoExcel || filtradas.length === 0}
            title="Descargar como Excel (.xls) lo que muestran los filtros actuales"
            className="inline-flex h-9 items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 text-[10px] font-black uppercase tracking-wide text-emerald-700 shadow-2xs transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {exportandoExcel ? "⏳ Generando…" : "📊 Excel"}
          </button>

          <button
            type="button"
            onClick={() => setReporteAbierto(true)}
            title="Reporte de tablas fijas vendidas (riesgo, ganadores, comisiones, pagos y retiros)"
            aria-label="Reporte de tablas fijas vendidas"
            className="inline-flex h-9 items-center gap-1 rounded-lg border border-indigo-300 bg-gradient-to-r from-indigo-600 to-violet-600 px-2.5 text-[10px] font-black uppercase tracking-wide text-white shadow-2xs transition hover:brightness-110"
          >
            📈 Reporte
          </button>

          <button
            type="button"
            onClick={() => {
              const primera = filtradas[0] ?? tablas[0] ?? null;
              if (primera) setTablaControlRiesgo(primera);
            }}
            disabled={filtradas.length === 0 && tablas.length === 0}
            title="Herramienta de Control de Riesgo, Cupos y Pérdida Máxima por Carrera y Ejemplar"
            aria-label="Control de Riesgo y Cupos"
            className="inline-flex h-9 items-center gap-1 rounded-lg border border-purple-300 bg-gradient-to-r from-purple-700 to-indigo-700 px-2.5 text-[10px] font-black uppercase tracking-wide text-white shadow-2xs transition hover:brightness-110 disabled:opacity-50"
          >
            🛡️ Control de Riesgo y Cupos
          </button>
        </div>
      </div>

        {/* PÍLDORAS INTERACTIVAS DE HIPÓDROMOS */}
        {hipodromosDisponibles.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-0.5 no-scrollbar">
            <span className="shrink-0 text-[10px] font-black uppercase tracking-wider text-slate-400 pr-1">
              🏛️ Hipódromos:
            </span>
            <button
              type="button"
              onClick={() => setHipodromoFiltro("")}
              className={`shrink-0 cursor-pointer rounded-lg px-2.5 py-1 text-xs font-black transition-all ${
                !hipodromoFiltro
                  ? "bg-slate-900 text-white shadow-sm ring-1 ring-slate-950"
                  : "border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-100"
              }`}
            >
              TODOS ({baseTablas.length})
            </button>
            {hipodromosDisponibles.map((h) => {
              const k = claveHipodromo(h);
              const activo = claveHipodromo(hipodromoFiltro) === k;
              const count = conteoPorHipodromo[k] || 0;
              const esAmericano = /PARK|DOWNS|AQUEDUCT|SARATOGA|TAMPA|MEADOWS|WOODBINE|GOLDEN|SANTA ANITA|DEL MAR|OAKLAWN|CHARLES|DELTA|REMINGTON|MOUNTAINEER|FINGER|MAHONING|PENN|HORSESHOE|KEENELAND|CHURCHILL/i.test(h);
              const bandera = esAmericano ? "US" : "VE";
              return (
                <button
                  key={h}
                  type="button"
                  onClick={() => setHipodromoFiltro(activo ? "" : h)}
                  className={`shrink-0 inline-flex items-center gap-1.5 cursor-pointer rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
                    activo
                      ? "bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-black shadow-md ring-2 ring-indigo-400/50"
                      : "border border-slate-200 bg-white text-slate-800 hover:border-indigo-300 hover:bg-indigo-50/50"
                  }`}
                >
                  <Flag nac={bandera} size={12} withName={false} />
                  <span>{nombreHipodromoParaMostrar(h)}</span>
                  <span
                    className={`rounded-full px-1.5 py-0.2 text-[10px] font-black leading-none ${
                      activo ? "bg-white/25 text-white" : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* VISTA PANTALLA (ESTILO MATRIZ DE IMPRESIÓN CON MENÚS Y OPERACIONES) */}
      {vistaImpresion ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
          <div className="mb-2 flex items-center justify-between border-b border-slate-200 pb-2 px-2">
            <span className="text-xs font-black uppercase tracking-wider text-slate-700">🖨️ Vista de Impresión Pura (Solo Lectura)</span>
            <button
              type="button"
              onClick={() => setVistaImpresion(false)}
              className="rounded bg-indigo-600 px-2.5 py-1 text-[11px] font-black uppercase text-white hover:bg-indigo-700 shadow-xs transition"
            >
              ← Volver a Vista de Tablas con Menús
            </button>
          </div>
          <MatrizImpresion tablas={filtradas} />
        </div>
      ) : (
        <div className="legacy-impresion-container rounded-2xl bg-[#eef2f7] p-2.5 sm:p-3 border border-slate-300/80 shadow-xs">
          {filtradas.length === 0 ? (
            <div className="col-span-full rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center shadow-xs">
              <span className="text-3xl">🏇</span>
              <p className="mt-2 text-sm font-bold text-slate-700">No hay tablas que coincidan con los filtros seleccionados.</p>
              <p className="text-xs text-slate-500 mt-1">Prueba cambiando el día, hipódromo o limpiando la búsqueda.</p>
              {(fechaFiltro || hipodromoFiltro || carreraFiltro || busquedaTexto) && (
                <button
                  type="button"
                  onClick={() => { setFechaFiltro(""); setHipodromoFiltro(""); setCarreraFiltro(""); setBusquedaTexto(""); }}
                  className="mt-3 inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-black text-white shadow-sm hover:bg-indigo-500 transition"
                >
                  ✕ Restablecer todos los filtros
                </button>
              )}
            </div>
          ) : (
            <div
              className={
                densidadVista === "compacta"
                  ? "grid gap-2.5 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-5"
                  : "grid gap-3.5 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-4"
              }
            >
              {filtradas.map((t) => {
                const ejemplares = t.caballos ?? [];
                const estaCerrada = Boolean(t.cerrada);
                const sumaPts = t.suma_base_tabla ?? sumaBase(t.caballos);
                const premioMonto = t.premio_recalculado ?? t.premio_original ?? t.monto_tabla ?? 100;
                const tieneRiesgo = Array.isArray(t.caballos) && t.caballos.some((c) => (c.max_tablas ?? 0) > 0);

                return (
                  <div
                    key={String(t.id)}
                    className={`tarjeta-legacy group/card relative flex flex-col overflow-hidden rounded-lg border bg-white shadow-xs transition-all duration-150 hover:shadow-md ${
                      estaCerrada
                        ? "border-slate-300 opacity-85"
                        : "border-slate-300 hover:border-indigo-400"
                    }`}
                  >
                    {/* CABECERA ESTILO IMPRESIÓN (DARK #0f172a) CON MENÚS */}
                    <div className="enc-legacy bg-[#0f172a] text-white px-2 py-1.5 select-none">
                      {/* LÍNEA 1: HIPÓDROMO, CARRERA Y MENÚS */}
                      <div className="l1-legacy flex items-center justify-between gap-1 leading-none">
                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                          <span
                            className="hip-legacy text-[11px] font-black tracking-wide uppercase text-white truncate"
                            title={nombreHipodromoParaMostrar(t.hipodromo)}
                          >
                            {nombreHipodromoParaMostrar(t.hipodromo)}
                          </span>
                          <span className="cc-legacy shrink-0 bg-white/20 text-white rounded px-1.5 py-0.5 text-[11px] font-black leading-none">
                            C{t.carrera ?? ""}
                          </span>
                        </div>

                        {/* MENÚS DE ACCIONES (Compactos, elegantes, alto contraste) */}
                        <div className="no-print flex items-center gap-0.5 shrink-0">
                          <Guard permiso="tablas:btn_editar">
                            <button
                              type="button"
                              onClick={() => {
                                setEditando(t);
                                setPatchEdicion({});
                                setPatchCaballos((t.caballos ?? []).map((c) => ({ ...c })));
                                void cargarCupos(t);
                              }}
                              title="Editar tabla y carrera"
                              className="inline-flex h-5 w-5 items-center justify-center rounded bg-amber-500 hover:bg-amber-400 text-slate-950 text-[10px] font-bold shadow-2xs transition hover:scale-105 active:scale-95"
                            >
                              ✏️
                            </button>
                          </Guard>
                          <Guard permiso="tablas:btn_vender">
                            <button
                              type="button"
                              onClick={() => void abrirVenta(t)}
                              title="Vender esta tabla"
                              className="inline-flex h-5 w-5 items-center justify-center rounded bg-indigo-500 hover:bg-indigo-400 text-white text-[10px] font-bold shadow-2xs transition hover:scale-105 active:scale-95"
                            >
                              🎟️
                            </button>
                          </Guard>
                          <Guard permiso="tablas:btn_liquidar">
                            <button
                              type="button"
                              onClick={() => setLiquidando(t)}
                              title="Liquidar la carrera"
                              className="inline-flex h-5 w-5 items-center justify-center rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold shadow-2xs transition hover:scale-105 active:scale-95"
                            >
                              🏁
                            </button>
                          </Guard>
                          <Guard algunaDe={["tablas:btn_control_riesgo", "tablas:btn_editar"]}>
                            <button
                              type="button"
                              onClick={() => setTablaControlRiesgo(t)}
                              title="Control de riesgo y cupos por grupo"
                              className="inline-flex h-5 w-5 items-center justify-center rounded bg-purple-600 hover:bg-purple-500 text-white text-[10px] font-bold shadow-2xs transition hover:scale-105 active:scale-95"
                            >
                              🛡️
                            </button>
                          </Guard>
                          <button
                            type="button"
                            onClick={() => void toggleActivaPortal(t.id)}
                            title={
                              esTablaActivaEnPortal(t.id)
                                ? "Visible en Portal de Clientes (clic para ocultar)"
                                : "Oculta en Portal de Clientes (clic para activar)"
                            }
                            className={`inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold shadow-2xs transition hover:scale-105 active:scale-95 ${
                              esTablaActivaEnPortal(t.id)
                                ? "bg-teal-600 hover:bg-teal-500 text-white"
                                : "bg-slate-700 hover:bg-slate-600 text-slate-300 opacity-70"
                            }`}
                          >
                            {esTablaActivaEnPortal(t.id) ? "👁️" : "🙈"}
                          </button>
                          {onEliminar && (
                            <Guard permiso="tablas:btn_eliminar">
                              <button
                                type="button"
                                onClick={() => setConfirmarEliminar(t)}
                                title="Eliminar tabla"
                                className="inline-flex h-5 w-5 items-center justify-center rounded bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-bold shadow-2xs transition hover:scale-105 active:scale-95"
                              >
                                🗑️
                              </button>
                            </Guard>
                          )}
                        </div>
                      </div>

                      {/* LÍNEA 2: DISTANCIA, SUPERFICIE, FECHA Y ESTADO */}
                      <div className="l2-legacy flex items-center justify-between gap-1 text-[8.5px] font-bold text-slate-300 mt-1 leading-none">
                        <span className="meta-legacy truncate">
                          <b>DIST {t.distancia_carrera ?? ""} m</b> · {t.superficie || "ARENA"}
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                          {estaCerrada ? (
                            <span className="rounded bg-rose-600/90 text-white px-1 py-0.2 text-[8px] font-black uppercase tracking-wider">
                              🔒 CERRADA
                            </span>
                          ) : null}
                          {tieneRiesgo ? (
                            <span
                              onClick={() => setTablaControlRiesgo(t)}
                              className="rounded bg-purple-500/80 hover:bg-purple-500 text-white px-1 py-0.2 text-[8px] font-black uppercase tracking-wider cursor-pointer"
                              title="Límites de riesgo y cupos activos"
                            >
                              🛡️ Cupos
                            </span>
                          ) : null}
                          <span
                            className="fecha-legacy font-black text-sky-300"
                            title={`Fecha de carrera: ${diaDeLaTabla(t, "carrera") || t.fecha?.slice(0, 10) || "—"}`}
                          >
                            {diaDeLaTabla(t, "carrera") || t.fecha?.slice(0, 10) || ""}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* FILAS DE EJEMPLARES (ZEBRA STRIPING, NÚMEROS A COLOR, PUNTOS ALINEADOS) */}
                    <div className="filas-legacy flex-1 flex flex-col gap-0.5 p-1 bg-white">
                      {ejemplares.length === 0 ? (
                        <div className="text-center text-rose-600 font-bold py-3 text-xs">
                          ⚠️ SIN EJEMPLARES
                        </div>
                      ) : null}
                      {ejemplares.map((c, i) => {
                        const hipoAmericano = /PARK|DOWNS|AQUEDUCT|SARATOGA|TAMPA|MEADOWS|WOODBINE|GOLDEN|SANTA ANITA|DEL MAR|OAKLAWN/i.test(
                          t.hipodromo || ""
                        );
                        const casa = hipoAmericano ? "USA" : "VE";
                        const nacRaw = c.nacionalidad ? String(c.nacionalidad) : "";
                        const nac = nacRaw.trim() ? normalizarNacionalidad(nacRaw) : casa;
                        const valor = parseNum(c.valor_ejemplar);

                        return (
                          <div
                            key={i}
                            className={`fila-legacy group/row relative flex items-center justify-between gap-1.5 rounded px-1.5 py-0.5 text-xs transition-colors hover:bg-indigo-50/90 ${
                              c.invalidado
                                ? "bg-purple-50/90"
                                : i % 2 === 1
                                  ? "bg-[#eef2f7]"
                                  : "bg-white"
                            } ${c.retirado ? "opacity-60" : ""}`}
                          >
                            {/* Botón principal de fila: retira/rehab o vende directo */}
                            <button
                              type="button"
                              onClick={() => setEjemplarModal({ tabla: t, indice: i })}
                              title="Clic para retirar, rehabilitar o vender este ejemplar"
                              className="flex items-center gap-1.5 min-w-0 flex-1 text-left cursor-pointer"
                            >
                              {/* Número con color oficial de gualdrapa */}
                              <span
                                className="num-legacy flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded font-black text-[9.5px] leading-none shadow-2xs"
                                style={{
                                  backgroundColor: colorDeNumero(c.numero),
                                  color: textoDeNumero(c.numero),
                                }}
                              >
                                {c.numero}
                              </span>

                              {/* Nombre del caballo */}
                              <span
                                className={`cab-legacy truncate font-bold text-slate-800 text-[11px] leading-tight ${
                                  c.retirado ? "line-through text-rose-600" : ""
                                }`}
                              >
                                {c.nombre || "Sin nombre"}
                              </span>

                              {/* Bandera si es foráneo */}
                              {nac !== casa && (
                                <span className="band-legacy shrink-0">
                                  <Flag nac={nac} size={10} withName={false} />
                                </span>
                              )}

                              {/* Badge invalidado */}
                              {c.invalidado ? (
                                <span className="shrink-0 rounded bg-purple-600 px-1 py-px text-[7.5px] font-black uppercase text-white">
                                  INV.
                                </span>
                              ) : null}
                            </button>

                            {/* Puntos / Valor del ejemplar */}
                            <div className="flex items-center gap-1 shrink-0">
                              <span
                                onClick={() => setEjemplarModal({ tabla: t, indice: i })}
                                title="Valor en puntos"
                                className={`mon-legacy font-mono font-black text-[11.5px] whitespace-nowrap cursor-pointer select-none ${
                                  c.retirado
                                    ? "text-rose-600 line-through"
                                    : valor === 0
                                      ? "text-slate-400 font-normal"
                                      : "text-slate-700"
                                }`}
                              >
                                {c.retirado ? "RET." : valor === 0 ? "–" : fmtPts(valor)}
                              </span>

                              {/* Menú hover en fila de caballo: editar o borrar cuadro */}
                              <span className="no-print hidden group-hover/row:flex items-center gap-0.5 ml-0.5">
                                <Guard permiso="tablas:btn_editar_cuadro">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setCuadroEnEdicion({ tabla: t, indice: i });
                                    }}
                                    title={`Editar ${c.nombre || `cuadro ${i + 1}`}`}
                                    className="rounded p-0.5 text-[10px] text-indigo-600 hover:bg-indigo-100 transition"
                                  >
                                    ✏️
                                  </button>
                                </Guard>
                                <Guard permiso="tablas:btn_quitar_cuadro">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setCuadroBorrando({ tabla: t, indice: i });
                                    }}
                                    title={`Quitar ${c.nombre || `cuadro ${i + 1}`}`}
                                    className="rounded p-0.5 text-[10px] text-rose-600 hover:bg-rose-100 transition"
                                  >
                                    🗑️
                                  </button>
                                </Guard>
                              </span>
                            </div>
                          </div>
                        );
                      })}

                      {/* Botón rápido Añadir Cuadro */}
                      <Guard permiso="tablas:btn_agregar_cuadro">
                        <button
                          type="button"
                          onClick={() => setCuadroEnEdicion({ tabla: t, indice: null })}
                          className="no-print mt-0.5 flex w-full items-center justify-center gap-1 rounded border border-dashed border-slate-300 py-0.5 text-[9.5px] font-bold text-slate-500 hover:text-indigo-600 hover:border-indigo-400 hover:bg-indigo-50/50 transition cursor-pointer"
                        >
                          ＋ Añadir cuadro
                        </button>
                      </Guard>
                    </div>

                    {/* PIE ESTILO IMPRESIÓN CON PREMIO Y BOTÓN DE VENTA */}
                    <div className="pie-legacy flex items-center justify-between px-2 py-1 bg-[#f1f5f9] border-t border-slate-300 text-[10px] select-none">
                      <div className="flex items-center gap-1 text-slate-600 font-bold uppercase text-[8.5px] tracking-wider">
                        <span>PREMIO/TABLA</span>
                        <span className="text-slate-400 font-normal">
                          (Suma: {fmtPts(sumaPts)})
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <b className="font-mono text-emerald-700 text-[12px] font-black">
                          {fmtValor(premioMonto)}
                        </b>
                        <button
                          type="button"
                          onClick={() => void abrirVenta(t)}
                          title="Vender jugadas en esta tabla"
                          className="no-print inline-flex items-center rounded bg-indigo-600 px-1.5 py-0.5 text-[9px] font-black uppercase text-white hover:bg-indigo-500 transition shadow-2xs hover:scale-105 active:scale-95"
                        >
                          🎟️ Vender
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* BLOQUES DE MODALES (Mantenidos igual) */}
      {confirmarEliminar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 no-print">
          <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-line bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-red-200 bg-red-50 px-4 py-3">
              <h3 className="text-xs font-black uppercase text-red-700">🗑️ Eliminar tabla</h3>
              <button type="button" onClick={() => setConfirmarEliminar(null)} className="text-red-400 hover:text-red-600">✕</button>
            </div>
            <div className="space-y-2 p-4">
              <p className="text-sm font-bold text-slate-800">¿Eliminar la oferta de venta de {nombreHipodromoParaMostrar(confirmarEliminar.hipodromo)} — Carrera {confirmarEliminar.carrera}?</p>
            </div>
            <div className="flex justify-end gap-2 border-t border-line bg-gray-50 px-4 py-3">
              <Button variant="ghost" size="sm" onClick={() => setConfirmarEliminar(null)}>Cancelar</Button>
              <Button variant="danger" size="sm" onClick={() => { const t = confirmarEliminar; setConfirmarEliminar(null); onEliminar?.(t); }}>🗑️ Eliminar</Button>
            </div>
          </div>
        </div>
      )}

      {vendiendo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 no-print">
          <div className="w-full max-w-sm rounded-2xl border border-line bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-line bg-slate-800 px-4 py-3 text-white">
              <h3 className="text-xs font-black uppercase">🛒 Venta — <span className="normal-case">{nombreHipodromoParaMostrar(vendiendo.hipodromo)}</span> C{vendiendo.carrera}</h3>
              <button type="button" onClick={() => setVendiendo(null)} className="text-slate-300 hover:text-white">✕</button>
            </div>
            <div className="space-y-3 p-4">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-slate-500">Jugador</label>
                {/* Buscador por nombre: en grupos grandes el <select> obligaba a
                    recorrer la lista entera; escribir el nombre es directo. */}
                <SearchableSelect
                  options={opcionesJugador}
                  value={clienteVenta}
                  onChange={elegirClienteVenta}
                  allowCustom={false}
                  disabled={vendiendoCargando}
                  placeholder={vendiendoCargando ? "Cargando…" : "— Buscar jugador por nombre —"}
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-slate-500">
                  Grupo (moneda y convenio)
                </label>
                {grupoSesion ? (
                  <div
                    className="flex items-center justify-between rounded-lg border border-line bg-surface px-3 py-2 text-sm font-bold text-slate-900"
                    title="El grupo lo define la sesión (para el administrador principal, el filtro superior)"
                  >
                    <span className="min-w-0 truncate">{nombreGrupoSesion || `Grupo ${grupoSesion}`}</span>
                    <span className="ml-2 shrink-0 text-[10px] font-black uppercase tracking-wide text-slate-400">
                      de la sesión
                    </span>
                  </div>
                ) : opcionesVenta.grupos.length === 0 && !vendiendoCargando ? (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-900">
                    No hay grupos de venta activos, y sin grupo la venta no puede registrarse
                    (el ticket necesita el grupo para la moneda y el convenio de comisión).
                    Crea al menos un grupo en <strong>Grupos</strong> antes de vender.
                  </p>
                ) : (
                  <>
                    <select
                      value={grupoVenta}
                      onChange={(e) => setGrupoVenta(e.target.value)}
                      disabled={vendiendoCargando}
                      className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-bold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    >
                      <option value="">— Seleccionar grupo —</option>
                      {opcionesVenta.grupos.map((g) => (
                        <option key={String(g.id)} value={String(g.id)}>
                          {g.nombre} · {g.moneda ?? "USD"}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-[10px] leading-tight text-slate-500">
                      La tabla fija no cobra comisión al jugador. La del grupo se calcula sobre el
                      monto decidido.
                    </p>
                  </>
                )}
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-slate-500">Ejemplar</label>
                <select value={ejemplarVenta} onChange={(e) => setEjemplarVenta(e.target.value)} className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-bold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
                  <option value="">— Seleccionar —</option>
                  {(vendiendo.caballos ?? []).map((c, i) => (
                    <option key={i} value={String(c.numero)}>Nº {c.numero} · {c.nombre}
                      {c.invalidado ? " (INVALIDADO: no puede ganar)" : ""}
                    </option>
                  ))}
                  <option value="TABLA">Tabla completa (un ticket por ejemplar)</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-slate-500">Monto jugado</label>
                <input value={montoVenta} onChange={(e) => setMontoVenta(e.target.value)} inputMode="decimal" placeholder="0,00" className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-black text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500" />
              </div>
              <div className="flex items-center justify-between rounded-lg bg-success-500/10 px-3 py-2 text-xs font-semibold text-slate-700">
                <span>Pago potencial +{PremioVenta(vendiendo, ejemplarVenta, montoVenta)}</span>
              </div>
              {(() => {
                const c = opcionesVenta.clientes.find((x) => String(x.id) === clienteVenta);
                if (!c) return null;
                const saldo = Number(c.saldo_actual ?? 0);
                const aval = Number(c.aval ?? 0) || 0;
                const libre = esClienteLibre(c);
                const monto = parseNum(montoVenta);
                const queda = saldo - monto;
                const disponible = libre ? Number.POSITIVE_INFINITY : saldo + aval;
                /* El rojo aqui es "el saldo queda en negativo", no "no alcanza":
                   con aval eso es LEGAL y es justo lo que el banco garantizo. Lo
                   que no debe pasar es quedarse sin disponible, y ahi se avisa. */
                const insuficiente = !libre && disponible < monto;
                const usaAval = !libre && aval > 0 && queda < 0;
                return (
                  <>
                    <div
                      className={
                        "flex items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold " +
                        (insuficiente
                          ? "bg-danger-500/10 text-danger-700"
                          : usaAval
                            ? "bg-warning-500/10 text-warning-700"
                            : "bg-slate-100 text-slate-700")
                      }
                    >
                      <span>Saldo {c.nombre}</span>
                      <span className="font-black">
                        {fmtSaldo(saldo)} → {fmtSaldo(queda)}
                      </span>
                    </div>
                    {!libre && (usaAval || insuficiente) ? (
                      <div
                        className={
                          "flex items-center justify-between rounded-lg px-3 py-2 text-[11px] font-bold " +
                          (insuficiente ? "bg-danger-500/10 text-danger-700" : "bg-warning-500/10 text-warning-700")
                        }
                      >
                        <span>{insuficiente ? "No alcanza" : "Usa aval"}</span>
                        <span className="font-black">
                          {saldo} + aval {aval} = {fmtSaldo(disponible)}
                        </span>
                      </div>
                    ) : null}
                  </>
                );
              })()}
            </div>
            <div className="flex justify-end gap-2 border-t border-line bg-gray-50 px-4 py-3">
              <Button variant="ghost" size="sm" onClick={() => setVendiendo(null)}>Cancelar</Button>
              <Button variant="success" size="md" onClick={lanzarVenta} disabled={vendiendoCargando}>
                Vender
              </Button>
            </div>
          </div>
        </div>
      )}

      <TicketVentaPreview
        abierto={previewVenta !== null}
        ticket={previewVenta?.ticket ?? null}
        confirmando={previewConfirmando}
        error={previewError}
        onCorregir={() => {
          setPreviewVenta(null);
          setPreviewError(null);
        }}
        onConfirmar={() => void confirmarVentaPreview()}
      />

      {ejemplarModal && ejemplarActual && (
        <EjemplarModal abierto tabla={ejemplarActual.tabla} ejemplar={ejemplarActual.ejemplar} indice={ejemplarModal.indice} onCerrar={() => setEjemplarModal(null)} onRetirar={cerrarEjemplarRetiro} onVentaRapida={ventaRapida} />
      )}

      {/*
        CRUD de cuadro suelto. El modal de edicion tiene prioridad sobre el de
        borrado: cuando se confirma "Quitar" desde el propio modal de edicion se
        pasa `indice` a null, asi que no pueden quedar los dos abiertos a la vez.
      */}
      {cuadroEnEdicion && (
        <CuadroModal
          cuadro={
            cuadroEnEdicion.indice === null
              ? null
              : (cuadroEnEdicion.tabla.caballos?.[cuadroEnEdicion.indice] ?? null)
          }
          indice={cuadroEnEdicion.indice}
          numerosUsados={(cuadroEnEdicion.tabla.caballos ?? []).map((c) => String(c.numero ?? ""))}
          guardando={cuadroGuardando}
          onCancelar={() => setCuadroEnEdicion(null)}
          onGuardar={(c) => void guardarCuadro(c)}
          onBorrar={
            cuadroEnEdicion.indice === null
              ? undefined
              : () => {
                  // El borrado pide confirmacion propia. Se cierra el modal de
                  // edicion y se abre el de confirmar, con el mismo indice.
                  setCuadroBorrando({
                    tabla: cuadroEnEdicion.tabla,
                    indice: cuadroEnEdicion.indice as number,
                  });
                  setCuadroEnEdicion(null);
                }
          }
        />
      )}

      {cuadroBorrando && (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/50 p-4 no-print" onClick={() => setCuadroBorrando(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xs overflow-hidden rounded-xl border border-red-200 bg-white shadow-2xl"
          >
            <div className="bg-red-600 px-3 py-2 text-white">
              <h3 className="text-sm font-black uppercase tracking-wider">🗑️ Quitar cuadro</h3>
            </div>
            <div className="space-y-2 p-3">
              <p className="text-sm font-bold text-slate-800">
                {String(cuadroBorrando.tabla.caballos?.[cuadroBorrando.indice]?.nombre ?? "Este ejemplar")} ·{" "}
                {nombreHipodromoParaMostrar(cuadroBorrando.tabla.hipodromo)} C{cuadroBorrando.tabla.carrera}
              </p>
              <p className="text-[11px] leading-relaxed text-slate-600">
                Se quita de la lista de ejemplares de la tabla y se actualiza la base.{" "}
                {(() => {
                  const vendidos = parseNum(cuadroBorrando.tabla.cantidad_vendida) || 0;
                  const i = cuadroBorrando.indice;
                  // Se estima si el ejemplar tiene tickets emitidos. Es una
                  // advertencia, no un bloqueo: la venta no se borra sola, pero
                  // el operador tiene que saber que esta tocando datos ya
                  // usados antes de confirmar.
                    return vendidos > 0 && i < vendidos
                      ? "⚠️ La tabla ya tiene ventas registradas y este ejemplar puede tener tickets emitidos. Revisa la liquidación antes de continuar."
                      : "La suma de la tabla se recalcula al guardar.";
                })()}
              </p>
            </div>
            <div className="flex items-center gap-1.5 border-t border-slate-100 px-3 py-2">
              <span className="flex-1" />
              <Button variant="ghost" size="sm" onClick={() => setCuadroBorrando(null)} disabled={cuadroGuardando}>
                Cancelar
              </Button>
              <Button variant="danger" size="sm" onClick={() => void borrarCuadro()} disabled={cuadroGuardando}>
                {cuadroGuardando ? "Quitando…" : "🗑️ Quitar"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {liquidando && (
        <CargaResultadosModal abierto onCerrar={() => setLiquidando(null)} hipodromo={liquidando.hipodromo ?? ""} carrera={String(liquidando.carrera ?? "")} caballos={liquidando.caballos} onConfirmar={(r) => { setLiquidando(null); onLiquidar?.(liquidando, r); }} />
      )}

      {editando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 no-print">
          <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-line bg-slate-800 px-4 py-3 text-white">
              <h3 className="text-xs font-black uppercase">✏️ Corregir — <span className="normal-case">{nombreHipodromoParaMostrar(editando.hipodromo)}</span> C{editando.carrera}</h3>
              <button type="button" onClick={() => setEditando(null)} className="text-slate-300 hover:text-white">✕</button>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
              {/* Datos de la carrera */}
              <fieldset className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
                <legend className="px-1 text-[9px] font-black uppercase tracking-wider text-slate-400">🏁 Carrera</legend>
                <label className="block">
                  <span className="mb-0.5 block text-[9px] font-black uppercase text-slate-500">Hipódromo</span>
                  <input value={String(patchEdicion.hipodromo ?? editando.hipodromo ?? "")} onChange={(e) => setPatchEdicion((p) => ({ ...p, hipodromo: e.target.value.toUpperCase() }))} className="w-full rounded border border-line bg-white px-2 py-1 text-sm font-bold uppercase text-slate-900 focus:outline-none" />
                </label>
                <label className="block">
                  <span className="mb-0.5 block text-[9px] font-black uppercase text-slate-500">Carrera Nº</span>
                  <input value={String(patchEdicion.carrera ?? editando.carrera ?? "")} onChange={(e) => setPatchEdicion((p) => ({ ...p, carrera: parseNum(e.target.value) }))} inputMode="numeric" className="w-full rounded border border-line bg-white px-2 py-1 text-sm font-black text-slate-900 focus:outline-none" />
                </label>
                <label className="block">
                  <span className="mb-0.5 block text-[9px] font-black uppercase text-slate-500">Fecha (AAAA-MM-DD)</span>
                  {/* Calendario, no texto: aquí se cambia el DÍA de una tabla ya
                      publicada, y escribir "04-10-2026" en un campo libre hacía
                      que Postgres lo guardara como 2026-04-10 (lo leía MM-DD).
                      Mover una tabla de día parte la jornada: la carrera queda
                      con ventas en un día y la oferta en otro. */}
                  <DateInput
                    value={esFechaIso(String(patchEdicion.fecha ?? editando.fecha ?? "").slice(0, 10)) ? String(patchEdicion.fecha ?? editando.fecha ?? "").slice(0, 10) : ""}
                    onFechaChange={(val) => setPatchEdicion((p) => ({ ...p, fecha: val }))}
                    placeholder="DD/MM/AAAA"
                    className="w-full rounded border border-line bg-white px-2 py-1 text-sm font-bold text-slate-900 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-0.5 block text-[9px] font-black uppercase text-slate-500">Superficie</span>
                  <select value={String(patchEdicion.superficie ?? editando.superficie ?? "ARENA")} onChange={(e) => setPatchEdicion((p) => ({ ...p, superficie: e.target.value }))} className="w-full rounded border border-line bg-white px-2 py-1 text-sm font-black uppercase text-slate-900 focus:outline-none">
                    {SUPERFICIES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-0.5 block text-[9px] font-black uppercase text-slate-500">Distancia (m)</span>
                  <input value={String(patchEdicion.distancia_carrera ?? editando.distancia_carrera ?? "")} onChange={(e) => setPatchEdicion((p) => ({ ...p, distancia_carrera: e.target.value }))} className="w-full rounded border border-line bg-white px-2 py-1 text-sm font-bold text-slate-900 focus:outline-none" />
                </label>
                <label className="block">
                  <span className="mb-0.5 block text-[9px] font-black uppercase text-slate-500">Moneda (grupo)</span>
                  <select value={String(patchEdicion.moneda ?? editando.moneda ?? "USD")} onChange={(e) => setPatchEdicion((p) => ({ ...p, moneda: e.target.value }))} className="w-full rounded border border-line bg-white px-2 py-1 text-sm font-black uppercase text-slate-900 focus:outline-none">
                    {OPCIONES_MONEDA.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </label>
              </fieldset>

              {/* Montos (sin símbolo: la moneda la define el grupo) */}
              <fieldset className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
                <legend className="px-1 text-[9px] font-black uppercase tracking-wider text-slate-400">💰 Montos (sin símbolo)</legend>
                {([
                  ["premio_original", "Premio Original"],
                  ["premio_recalculado", "Premio Recalculado"],
                  ["limite_ventas", "Límite de Ventas"],
                  ["cantidad_vendida", "Cantidad Vendida"],
                ] as const).map(([key, label]) => (
                  <label key={key} className="block">
                    <span className="mb-0.5 block text-[9px] font-black uppercase text-slate-500">{label}</span>
                    <input value={String(patchEdicion[key] ?? editando[key] ?? "")} onChange={(e) => setPatchEdicion((p) => ({ ...p, [key]: parseNum(e.target.value) }))} inputMode="decimal" className="w-full rounded border border-line bg-white px-2 py-1 text-sm font-black text-slate-900 focus:outline-none" />
                  </label>
                ))}
                <p className="col-span-2 text-[9px] font-semibold text-slate-500">
                  La Suma Base se recalcula automáticamente al guardar (suma de los valores de los ejemplares).
                </p>
              </fieldset>

              {/* Ejemplares */}
              <fieldset className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                <legend className="px-1 text-[9px] font-black uppercase tracking-wider text-slate-400">🐴 Ejemplares (corregir)</legend>
                <EditorCaballos
                  caballos={patchCaballos}
                  onChange={(i, patch) => setPatchCaballos((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)))}
                  onQuitar={(i) => setPatchCaballos((cs) => cs.filter((_, j) => j !== i))}
                  onAgregar={(c) => setPatchCaballos((cs) => [...cs, c])}
                  onAlternarInvalidado={(i, invalidado) => void alternarInvalidado(i, invalidado)}
                />
              </fieldset>

              {/* Cupos por grupo (tabla_grupos) */}
              <fieldset className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                <legend className="px-1 text-[9px] font-black uppercase tracking-wider text-slate-400">🎟️ Cupos por Grupo (tabla_grupos)</legend>
                {patchCupos.length === 0 ? (
                  <p className="rounded border border-dashed border-slate-300 bg-white p-2 text-center text-[10px] font-semibold text-slate-400">
                    Sin grupos activos. Los cupos se asignan al crear grupos de venta.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {patchCupos.map((g, i) => (
                      <div key={String(g.grupo_id)} className="grid grid-cols-[1fr_5rem_5rem] items-center gap-1">
                        <span className="min-w-0 truncate text-[11px] font-bold uppercase text-slate-700">{g.grupo_nombre || "Grupo"}</span>
                        <input
                          type="number"
                          min={0}
                          value={g.cupos ?? ""}
                          onChange={(e) => setPatchCupos((gs) => gs.map((x, j) => (j === i ? { ...x, cupos: parseNum(e.target.value) } : x)))}
                          className="w-full rounded border border-line bg-white px-1.5 py-1 text-right text-[11px] font-black text-slate-900 outline-none"
                          title="Cupos de tablas asignados a este grupo"
                        />
                        <input
                          type="number"
                          min={0}
                          value={g.max ?? ""}
                          onChange={(e) => setPatchCupos((gs) => gs.map((x, j) => (j === i ? { ...x, max: parseNum(e.target.value) || null } : x)))}
                          className="w-full rounded border border-line bg-white px-1.5 py-1 text-right text-[11px] font-black text-slate-900 outline-none"
                          title="Máximo de tablas por jugador del grupo (vacío = sin tope)"
                          placeholder="máx"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </fieldset>
            </div>
            <div className="flex justify-end gap-2 border-t border-line bg-gray-50 px-4 py-3">
              <Button variant="ghost" size="sm" onClick={() => setEditando(null)}>Cancelar</Button>
              <Button size="md" onClick={guardarEdicion}>💾 Corregir y guardar</Button>
            </div>
          </div>
        </div>
      )}

      {/* Sección impresión forzada a bloque si se lanza desde el navegador */}
      <div className="hidden print:block print:bg-white print:px-2 print:py-2">
        <h1 className="mb-3 border-b-2 border-black pb-1 text-center text-base font-black uppercase text-black">Tablas Fijas Publicadas</h1>
        <MatrizImpresion tablas={filtradas} />
      </div>

      <ReporteTablasFijasModal
        abierto={reporteAbierto}
        onCerrar={() => setReporteAbierto(false)}
        fechaInicial={fechaFiltro}
        hipodromoInicial={hipodromoFiltro}
        carreraInicial={carreraFiltro}
      />

      <ControlRiesgoTablasModal
        abierto={tablaControlRiesgo !== null}
        tabla={tablaControlRiesgo}
        onCerrar={() => setTablaControlRiesgo(null)}
        onActualizado={(caballosActualizados) => {
          if (!tablaControlRiesgo) return;
          if (caballosActualizados && onEditar) {
            onEditar(tablaControlRiesgo, { caballos: caballosActualizados });
          }
          if (caballosActualizados) {
            setTablaControlRiesgo((prev) => (prev ? { ...prev, caballos: caballosActualizados } : null));
          }
        }}
      />
    </div>
  );
}

// ============================================================================
// LÓGICA LEGACY ESTRICTA: Motor original de Auto-ajuste de fuente y CSS nativo
// ============================================================================
const MAX_N = 20, FS_BASE = 6.9, FS_MIN = 5.9, FS_MAX = 10.8;

function fsAuto(n: number) {
  const num = Math.min(Math.max(n || 1, 1), MAX_N);
  const p = (FS_BASE * MAX_N) / num;
  return Math.floor(Math.min(FS_MAX, Math.max(FS_MIN, p)) * 10) / 10;
}

/** Matriz compacta: Replica exacta del HTML legacy para html2canvas */
function MatrizImpresion({ tablas }: { tablas: StoredTablaFija[] }) {
  if (tablas.length === 0) return null;

  return (
    <div className="legacy-impresion-container p-2">
      <div className="hoja-legacy">
        {tablas.map((t) => {
          const ejemplares = t.caballos ?? [];
          const fs = fsAuto(ejemplares.length || 1);

          return (
            <div key={String(t.id)} className="tarjeta-legacy">
              <div className="enc-legacy">
                <div className="l1-legacy">
                  <span className="hip-legacy">{nombreHipodromoParaMostrar(t.hipodromo)}</span>
                  <span className="cc-legacy">C{t.carrera}</span>
                </div>
                <div className="l2-legacy">
                  <span className="meta-legacy"><b>DIST {t.distancia_carrera ?? ""} m</b> &middot; {t.superficie || "ARENA"}</span>
                  <span className="fecha-legacy">{t.fecha?.slice(0, 10) ?? ""}</span>
                </div>
              </div>

              <div className="filas-legacy" style={{ fontSize: `${fs}px` }}>
                {ejemplares.length === 0 && (
                  <div style={{ textAlign: "center", color: "#dc2626", fontWeight: "bold", padding: "10px 0" }}>⚠️ SIN APUESTAS</div>
                )}
                {ejemplares.map((c, i) => {
                  const hipoAmericano = /PARK|DOWNS|AQUEDUCT|SARATOGA|TAMPA|MEADOWS|WOODBINE|GOLDEN|SANTA ANITA|DEL MAR|OAKLAWN/i.test(t.hipodromo || "");
                  const casa = hipoAmericano ? "USA" : "VE";
                  const nacRaw = c.nacionalidad ? String(c.nacionalidad) : "";
                  const nac = nacRaw.trim() ? normalizarNacionalidad(nacRaw) : casa;
                  const valor = parseNum(c.valor_ejemplar);

                  return (
                    <div key={i} className="fila-legacy">
                      <span className="num-legacy" style={{ backgroundColor: colorDeNumero(c.numero), color: textoDeNumero(c.numero) }}>
                        {c.numero}
                      </span>
                      <span className={`cab-legacy ${c.retirado ? 'ret-legacy' : ''}`}>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.nombre}</span>
                        {nac !== casa && (
                          <span className="band-legacy">
                            <Flag nac={nac} size={10} withName={false} />
                          </span>
                        )}
                      </span>
                      <span className={`mon-legacy ${valor === 0 ? 'cero-legacy' : ''}`}>
                        {valor === 0 ? "–" : `${fmtPts(valor)}`}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="pie-legacy">
                <span>PREMIO/TABLA</span><b>{fmtValor(t.premio_recalculado ?? 0)}</b>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function pagoPotencialNumerico(
  t: StoredTablaFija,
  numero: string,
  monto: number,
  cantidad?: number
): number {
  if (!monto || !numero) return 0;
  const premio = Number(t.premio_recalculado ?? t.premio_original ?? t.monto_tabla ?? 100);
  if (numero === "TABLA") return premio * (cantidad ?? monto);
  const c = (t.caballos ?? []).find((x) => String(x.numero) === numero);
  if (c?.invalidado || c?.retirado) return 0;

  if (cantidad && cantidad > 0) {
    return premio * cantidad;
  }

  const valorUnitario = parseNum(c?.valor_ejemplar);
  const cantCalculada = valorUnitario > 0 ? Math.max(1, Math.round(monto / valorUnitario)) : 1;
  return premio * cantCalculada;
}

function PremioVenta(t: StoredTablaFija, numero: string, monto: string): string {
  const m = parseNum(monto);
  if (!m || !numero) return "—";
  // Misma regla que el cálculo numérico (un INVALIDADO vale 0).
  return fmtMoney(pagoPotencialNumerico(t, numero, m), t.moneda);
}

export default MonitorTablas;