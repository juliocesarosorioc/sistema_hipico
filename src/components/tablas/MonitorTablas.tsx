"use client";

import { useState, useMemo, useEffect } from "react";
import type { StoredTablaFija } from "@/store/useTablasFijasStore";
import { colorDeNumero, textoDeNumero, fmtMoney, sumaBase, parseNum, SUPERFICIES, type EjemplarTabla } from "@/lib/tablas/tipos";
import { hoyLocal } from "@/lib/gaceta/programa";
import { Flag, normalizarNacionalidad } from "@/components/ui/BanderaPais";
import { Button } from "@/components/ui/Button";
import { Guard } from "@/components/ui/Guard";
import { TicketVentaPreview, type TicketVentaModel } from "@/components/tickets/TicketVentaPreview";
import { CargaResultadosModal, type PizarraResultados } from "@/components/liquidacion/CargaResultadosModal";
import { EjemplarModal, type VentaRapidaItem } from "@/components/tablas/EjemplarModal";
import { EditorCaballos } from "@/components/tablas/EditorCaballos";
import { CuadroModal } from "@/components/tablas/CuadroModal";
import { listarCuposTabla, guardarCuposTabla, listarGruposVenta, listarClientesVenta, esClienteLibre, type CupoTablaGrupo, type GrupoVenta, type ClienteVenta } from "@/lib/grupos";
import { listarBanquerosGrupo } from "@/lib/banqueros";
import { useCarrerasCentrales } from "@/lib/carreras/useCarrerasCentrales";
import { aplicarRetirosCarrera } from "@/lib/carreras/retiros";
import { guardarCarreraCentral } from "@/lib/carreras/central";
import { esFechaIso } from "@/lib/fechas";

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

/** Normaliza fechas para el filtro */
function diaDeLaTabla(t: StoredTablaFija): string {
  const raw = String(t.fecha || t.fecha_creacion || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const partes = raw.split(/[-/]/);
  if (partes.length === 3 && partes[0].length <= 2) {
    return `${partes[2]}-${partes[1].padStart(2, '0')}-${partes[0].padStart(2, '0')}`;
  }
  return raw.slice(0, 10);
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
      grupos.map((g) => ({
        tabla_id: t.id,
        grupo_id: g.id,
        grupo_nombre: g.nombre,
        cupos: g.cupo_tabla ?? 100,
        max: null,
      }))
    );
  };
  const [aviso, setAviso] = useState("");
  const [confirmarEliminar, setConfirmarEliminar] = useState<StoredTablaFija | null>(null);
  const [ejemplarModal, setEjemplarModal] = useState<{ tabla: StoredTablaFija; indice: number } | null>(null);
  const [opcionesVenta, setOpcionesVenta] = useState<{ grupos: GrupoVenta[]; clientes: ClienteVenta[] }>({
    grupos: [],
    clientes: [],
  });

  /**
   * Abre el modal de venta trayendo los grupos y clientes de lectura.
   *
   * El grupo se deduce del cliente: `clientes.grupo_id` mas la lista
   * `grupos` (clientes_grupos), que es la misma regla del legacy. Asi el
   * convenio y la moneda que se aplican son los del grupo del jugador y no
   * una eleccion suelta de la caja.
   */
  const abrirVenta = async (t: StoredTablaFija) => {
    setVendiendo(t);
    setEjemplarVenta("");
    setMontoVenta("");
    setClienteVenta("");
    setGrupoVenta("");
    setVendiendoCargando(true);
    const [grupos, clientes] = await Promise.all([
      listarGruposVenta().catch(() => [] as GrupoVenta[]),
      listarClientesVenta().catch(() => [] as ClienteVenta[]),
    ]);
    setOpcionesVenta({ grupos, clientes });
    setVendiendoCargando(false);
  };

  /** Al elegir cliente, propone su grupo; el usuario puede cambiarlo. */
  const elegirClienteVenta = (clienteId: string) => {
    setClienteVenta(clienteId);
    const c = opcionesVenta.clientes.find((x) => String(x.id) === clienteId);
    const g = c?.grupo_id ?? c?.grupos?.[0] ?? "";
    setGrupoVenta(g != null && g !== "" ? String(g) : "");
  };

  const [vistaImpresion, setVistaImpresion] = useState(false);

  // Estados de los filtros
  const [fechaInterna, setFechaInterna] = useState<string>("");
  const [hipodromoLocal, setHipodromoLocal] = useState<string>("");

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

  const abiertas = tablas.filter((t) => !t.cerrada);

  // DATA CENTRAL: días e hipódromos con carreras registradas en Carreras del
  // Día, aunque todavía no tengan tabla fija publicada, para que el filtro en
  // cascada ofrezca la jornada completa.
  const { centrales: centralCarreras } = useCarrerasCentrales();

  // FILTROS EN CASCADA BIDIRECCIONALES
  const fechasDisponibles = useMemo(() => {
    const setFechas = new Set<string>();
    abiertas.forEach(t => {
      if (!hipodromoFiltro || t.hipodromo === hipodromoFiltro) {
        const d = diaDeLaTabla(t);
        if (d) setFechas.add(d);
      }
    });
    centralCarreras.forEach(c => {
      if (!hipodromoFiltro || c.hipodromo === hipodromoFiltro) setFechas.add(c.fecha);
    });
    return Array.from(setFechas).sort().reverse();
  }, [abiertas, hipodromoFiltro, centralCarreras]);

  const hipodromosDisponibles = useMemo(() => {
    const setHips = new Set<string>();
    abiertas.forEach(t => {
      if (!fechaFiltro || diaDeLaTabla(t) === fechaFiltro) {
        if (t.hipodromo) setHips.add(t.hipodromo);
      }
    });
    centralCarreras.forEach(c => {
      if (!fechaFiltro || c.fecha === fechaFiltro) setHips.add(c.hipodromo);
    });
    return Array.from(setHips).sort();
  }, [abiertas, fechaFiltro, centralCarreras]);

  // Limpiar filtros si quedan huérfanos por la cascada (solo si el padre
  // no gobierna la fecha: en controlado el valor decide el filtro del día).
  useEffect(() => {
    if (fechaControlada) return;
    if (fechaFiltro && !fechasDisponibles.includes(fechaFiltro)) setFechaFiltro("");
  }, [fechasDisponibles, fechaFiltro, fechaControlada]);

  useEffect(() => {
    if (hipodromoControlado) return; // el padre gobierna el filtro de hipódromo
    if (hipodromoFiltro && !hipodromosDisponibles.includes(hipodromoFiltro)) setHipodromoLocal("");
  }, [hipodromosDisponibles, hipodromoFiltro, hipodromoControlado]);

  // Aplicación del filtro final. Se ordena por hipódromo y luego por número de
  // carrera ASCENDENTE (comparación numérica: C2 va antes que C10). El store
  // también se muta en local (publicar/cerrar), así que el orden se reaplica
  // aquí y no se confía solo en el de la carga inicial.
  const filtradas = abiertas
    .filter(t => {
      if (fechaFiltro && diaDeLaTabla(t) !== fechaFiltro) return false;
      if (hipodromoFiltro && t.hipodromo !== hipodromoFiltro) return false;
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
      return diaDeLaTabla(a).localeCompare(diaDeLaTabla(b));
    });

  const lanzarVenta = async () => {
    if (!vendiendo || !ejemplarVenta.trim() || !montoVenta.trim()) {
      return setAviso("Selecciona un ejemplar e indica el monto jugado.");
    }
    if (!clienteVenta) {
      return setAviso("Selecciona el jugador: la venta se descuenta de su saldo.");
    }
    if (!grupoVenta) {
      return setAviso("Selecciona el grupo: define la moneda y el convenio de comisión.");
    }
    const monto = parseNum(montoVenta);
    if (!(monto > 0)) {
      return setAviso("El monto debe ser un número mayor a cero.");
    }
    const cliente = opcionesVenta.clientes.find((x) => String(x.id) === clienteVenta);
    const grupo = opcionesVenta.grupos.find((x) => String(x.id) === grupoVenta);
    const nombreCab =
      (vendiendo.caballos ?? []).find((c) => String(c.numero) === ejemplarVenta)?.nombre ?? "TABLA COMPLETA";
    const item: VentaTablaItem = {
      tablaId: vendiendo.id,
      numero: ejemplarVenta,
      nombre: nombreCab,
      monto,
      grupo: grupo ? { id: grupo.id, nombre: grupo.nombre } : null,
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
    const bq = (await listarBanquerosGrupo(grupoVenta)).find(
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
        titulo: `TABLA ${vendiendo.hipodromo} C${vendiendo.carrera} · ${ejemplarVenta === "TABLA" ? "COMPLETA" : `Nº ${ejemplarVenta}`}`,
        detalle: nombreCab,
        jugador: cliente?.nombre ?? "",
        grupo: grupo?.nombre ?? null,
        monto,
        moneda: grupo?.moneda ?? vendiendo.moneda,
        pago: pagoPotencialNumerico(vendiendo, ejemplarVenta, monto),
        saldoAntes: saldo,
        saldoDespues: saldo - monto,
        banquero: bq?.banquero_nombre ?? null,
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
        titulo: `TABLA ${tabla.hipodromo} C${tabla.carrera} · Nº ${item.numero}`,
        detalle: `${item.nombre}${item.cantidad > 1 ? ` × ${item.cantidad} tablas` : ""}`,
        jugador: item.jugador?.nombre ?? "",
        grupo: item.grupo?.nombre ?? null,
        monto: item.monto,
        moneda: tabla.moneda,
        pago: pagoPotencialNumerico(tabla, item.numero, item.monto),
        saldoAntes: saldo,
        saldoDespues: saldo - item.monto,
        banquero: bq?.banquero_nombre ?? null,
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

  const ejemplarActual = ejemplarModal
    ? { tabla: ejemplarModal.tabla, ejemplar: (ejemplarModal.tabla.caballos ?? [])[ejemplarModal.indice] }
    : null;

  return (
    <div className="space-y-4">
      {aviso && <p className="rounded-lg bg-success-500/10 px-3 py-2 text-xs font-semibold text-success-700 no-print">{aviso}</p>}

      {/* FILTROS EN CASCADA Y VISTA IMPRESIÓN */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-3 rounded-lg border border-slate-200">
        <p className="text-xs font-bold text-slate-600">
          {filtradas.length} tabla(s) filtrada(s)
        </p>
        <div className="flex flex-wrap items-center gap-3">
          
          {/* Filtro Hipódromo */}
          <label className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2 py-1 shadow-sm">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">🏛️ Hipódromo</span>
            <select
              value={hipodromoFiltro}
              onChange={(e) => setHipodromoFiltro(e.target.value)}
              className="bg-transparent text-xs font-bold text-slate-900 focus:outline-none uppercase"
            >
              <option value="">TODOS</option>
              {hipodromosDisponibles.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          </label>

          {/* Filtro Fecha */}
          <label className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2 py-1 shadow-sm">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">📅 Fecha</span>
            <select
              value={fechaFiltro}
              onChange={(e) => setFechaFiltro(e.target.value)}
              className="bg-transparent text-xs font-bold text-slate-900 focus:outline-none"
            >
              <option value="">TODAS</option>
              {fechasDisponibles.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>

          {(fechaFiltro || hipodromoFiltro) && (
            <button
              type="button"
              onClick={() => { setFechaFiltro(""); setHipodromoFiltro(""); }}
              className="text-[10px] font-black uppercase text-red-500 hover:text-red-600 border border-red-200 bg-red-50 px-2 py-1 rounded"
            >
              ✕ Limpiar
            </button>
          )}

          <button
            type="button"
            onClick={() => setVistaImpresion((v) => !v)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-indigo-700 shadow-sm transition-colors hover:bg-indigo-50 ml-2"
          >
            🖨️ {vistaImpresion ? "Volver a Edición" : "Vista de impresión"}
          </button>
        </div>
      </div>

      {/* VISTA PANTALLA O IMPRESIÓN */}
      {vistaImpresion ? (
        <MatrizImpresion tablas={filtradas} />
      ) : (
        <div className="grid gap-4 print:hidden sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {filtradas.length === 0 && (
            <div className="col-span-full rounded-2xl border border-dashed border-line bg-surface p-10 text-center">
              <p className="text-sm font-semibold text-slate-500">No hay tablas que coincidan con los filtros.</p>
            </div>
          )}
          {filtradas.map((t) => (
            <div key={String(t.id)} className="flex flex-col overflow-hidden rounded-xl border border-indigo-200 bg-white shadow-sm">
              <div className="px-1.5 py-px text-white" style={{ background: "linear-gradient(135deg,#4f46e5 0%,#7c3aed 60%,#9333ea 100%)" }}>
                <div className="flex items-center justify-between gap-1 leading-none">
                  <span className="min-w-0 truncate rounded bg-white/20 px-1.5 py-px text-[16px] font-bold uppercase tracking-wider">
                    🏛️ {t.hipodromo || ""}
                  </span>
                  <span className="flex items-center gap-1 whitespace-nowrap">
                    <span className="inline-flex items-center rounded-md border-4 border-white bg-indigo-900 px-4 py-1 text-[15px] font-black uppercase leading-none tracking-widest text-white shadow-lg md:text-[19px]">
                      C{t.carrera ?? ""}
                    </span>
                    {/*
                      Acciones CRUD de la tabla, en la cabecera y al lado de la
                      carrera. Antes vivían en una fila al pie de la tarjeta, con
                      cuatro botones de texto de ancho elástico: ocupaban una
                      banda entera, se veían distintos entre sí (el de eliminar
                      era más chico que los otros) y competían con la información
                      del cuadro. Arriba, cuadrados y del mismo tamaño, la
                      lectura es "esta tabla, estas acciones" de un vistazo y la
                      tarjeta recupera el pie para la Suma.

                      El color sí codifica la acción (editar=ámbar, vender=índigo,
                      liquidar=esmeralda, eliminar=rojo), pero la FORMA es idéntica
                      en las cuatro: sin texto, con `title` para el emergente.
                    */}
                    <span className="no-print ml-1 flex items-center gap-1">
                      <Guard permiso="tablas:btn_editar">
                        <button
                          type="button"
                          onClick={() => { setEditando(t); setPatchEdicion({}); setPatchCaballos((t.caballos ?? []).map((c) => ({ ...c }))); void cargarCupos(t); }}
                          title="Editar la tabla y la carrera"
                          aria-label="Editar la tabla y la carrera"
                          className={BTN_CRUDA + " bg-amber-500 hover:bg-amber-400"}
                        >
                          ✏️
                        </button>
                      </Guard>
                      <Guard permiso="tablas:btn_vender">
                        <button
                          type="button"
                          onClick={() => void abrirVenta(t)}
                          title="Vender esta tabla"
                          aria-label="Vender esta tabla"
                          className={BTN_CRUDA + " bg-indigo-500 hover:bg-indigo-400"}
                        >
                          🎟️
                        </button>
                      </Guard>
                      <Guard permiso="tablas:btn_liquidar">
                        <button
                          type="button"
                          onClick={() => setLiquidando(t)}
                          title="Liquidar: cobrar los premios de la carrera"
                          aria-label="Liquidar la tabla"
                          className={BTN_CRUDA + " bg-emerald-600 hover:bg-emerald-500"}
                        >
                          🏁
                        </button>
                      </Guard>
                      {onEliminar && (
                        <Guard permiso="tablas:btn_eliminar">
                          <button
                            type="button"
                            onClick={() => setConfirmarEliminar(t)}
                            title="Eliminar la tabla"
                            aria-label="Eliminar la tabla"
                            className={BTN_CRUDA + " bg-rose-600 hover:bg-rose-500"}
                          >
                            🗑️
                          </button>
                        </Guard>
                      )}
                    </span>
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] font-bold leading-none">
                  <span className="rounded bg-white/20 px-1 py-px">📏 {t.distancia_carrera ?? ""} m</span>
                  <span className="rounded bg-white/20 px-1 py-px uppercase">{t.superficie || "ARENA"}</span>
                  <span className="rounded bg-white/20 px-1 py-px">📅 {t.fecha?.slice(0,10) ?? ""}</span>
                </div>
                <div className="mt-0.5 flex items-center justify-between rounded bg-white/20 px-1.5 py-px leading-none">
                  <span className="text-[11px] font-black uppercase tracking-wider opacity-90">💰 MONTO A PAGAR TABLA</span>
                  <span className="whitespace-nowrap text-sm font-black">{fmtValor(t.premio_recalculado ?? null)}</span>
                </div>
              </div>

              <div className="flex items-center justify-between px-1.5 pb-0.5 pt-1 text-[9px] font-black uppercase tracking-wider text-slate-400 leading-none">
                <span>🐴 Ejemplares</span>
                <span className="rounded-full bg-slate-100 px-1.5 text-[9px] font-black text-slate-600">{(t.caballos ?? []).length}</span>
              </div>

              <div className="flex-1 px-1 py-0">
                {(t.caballos ?? []).map((c, i) => {
                  let nac = c.nacionalidad ? String(c.nacionalidad).toUpperCase() : "";
                  if (!nac) {
                    const esAmericano = /PARK|DOWNS|AQUEDUCT|SARATOGA|TAMPA|MEADOWS|WOODBINE|GOLDEN|SANTA ANITA|DEL MAR|OAKLAWN/i.test(t.hipodromo || "");
                    nac = esAmericano ? "US" : "VE";
                  }
                  const valor = parseNum(c.valor_ejemplar);
                  return (
                    <div
                      key={i}
                      className={`group grid w-full items-center rounded px-1 py-0 text-left transition-colors ${i % 2 === 1 ? "bg-slate-100" : "bg-white"} hover:bg-indigo-200 ${c.retirado ? "opacity-50" : ""}`}
                      style={{ gridTemplateColumns: "1.75rem 1fr 1.25rem 4rem 3.25rem" }}
                    >
                      <button
                        type="button"
                        onClick={() => setEjemplarModal({ tabla: t, indice: i })}
                        title="Retirar, rehabilitar o vender este ejemplar"
                        className={`col-span-4 grid w-full items-center text-left ${c.retirado ? "cursor-pointer" : "cursor-pointer"}`}
                        style={{ gridTemplateColumns: "1.75rem 1fr 1.25rem 4rem" }}
                      >
                        <span
                          className="flex h-6 w-6 shrink-0 flex-none items-center justify-center rounded text-center text-[10px] font-bold leading-none"
                          style={{ backgroundColor: colorDeNumero(c.numero), color: textoDeNumero(c.numero) }}
                        >
                          {c.numero}
                        </span>
                        <span className="min-w-0 truncate px-1 text-[14px] font-bold uppercase leading-none text-slate-800">{c.nombre || "Sin nombre"}</span>
                        <span className="flex justify-center text-center leading-none">
                          {nac !== "VE" && <Flag nac={nac} size={12} withName={false} />}
                        </span>
                        <span className={`whitespace-nowrap text-right text-[17px] font-black leading-none ${c.retirado ? "text-red-500 line-through" : "text-blue-700"}`}>
                            {c.retirado ? "RET." : `${fmtPts(valor)}`}
                        </span>
                      </button>
                      {/*
                        Columna de acciones del cuadro. Solo aparece al pasar el
                        mouse y va en `no-print`: en la hoja impresa no puede
                        quedar un boton. El click sigue corriendo por el boton
                        de la izquierda, que cubre las 4 columnas del dato.
                      */}
                      <span className="no-print col-start-5 flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        <Guard permiso="tablas:btn_editar_cuadro">
                          <button
                            type="button"
                            onClick={() => setCuadroEnEdicion({ tabla: t, indice: i })}
                            title={`Editar ${c.nombre || `cuadro ${i + 1}`}`}
                            className="rounded px-1 text-[11px] text-indigo-500 transition-colors hover:bg-indigo-100 hover:text-indigo-700"
                          >
                            ✏️
                          </button>
                        </Guard>
                        <Guard permiso="tablas:btn_quitar_cuadro">
                          <button
                            type="button"
                            onClick={() => setCuadroBorrando({ tabla: t, indice: i })}
                            title={`Quitar ${c.nombre || `cuadro ${i + 1}`}`}
                            className="rounded px-1 text-[11px] text-red-400 transition-colors hover:bg-red-100 hover:text-red-600"
                          >
                            🗑️
                          </button>
                        </Guard>
                      </span>
                    </div>
                  );
                })}
                <Guard permiso="tablas:btn_agregar_cuadro">
                  <button
                    type="button"
                    onClick={() => setCuadroEnEdicion({ tabla: t, indice: null })}
                    className="no-print mt-0.5 flex w-full items-center justify-center gap-1 rounded border border-dashed border-indigo-300 py-0.5 text-[10px] font-black uppercase tracking-wider text-indigo-500 transition-colors hover:border-indigo-500 hover:bg-indigo-50"
                  >
                    ＋ Añadir cuadro
                  </button>
                </Guard>
              </div>

              {/*
                Pie de la tarjeta. Usa el mismo `gridTemplateColumns` que cada
                cuadro para que el total caiga exactamente bajo la columna del
                valor y no flotando a la derecha. Antes era un
                `flex justify-between`, que dejaba el numero desalineado
                respecto de la columna de 4rem.
                `flex-1` en el bloque de cuadros (arriba) es lo que empuja este
                pie hacia abajo cuando la tabla tiene pocos ejemplares: sin
                eso el pie queda pegado a los cuadros y no al fondo de la caja.
                Se mantiene `py-0.5` para no alargar la tarjeta: aquí ya no queda
                la fila de acciones, que viven en la cabecera.
              */}
              <div
                className="grid items-center border-t border-slate-100 bg-white px-1 py-0.5"
                style={{ gridTemplateColumns: "1.75rem 1fr 1.25rem 4rem" }}
              >
                <span />
                <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-500 leading-none">
                  🧮 Suma
                  <span className="font-semibold normal-case tracking-normal text-slate-400">
                    ({(t.caballos ?? []).filter((c) => !c.retirado).length} activos)
                  </span>
                </span>
                <span />
                <span
                  className="whitespace-nowrap text-right text-[17px] font-black leading-none"
                  style={{ color: "#74ACDF" }}
                >
                  {fmtPts(t.suma_base_tabla ?? sumaBase(t.caballos))}
                </span>
              </div>
            </div>
          ))}
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
              <p className="text-sm font-bold text-slate-800">¿Eliminar la oferta de venta de {confirmarEliminar.hipodromo} — Carrera {confirmarEliminar.carrera}?</p>
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
              <h3 className="text-xs font-black uppercase">🛒 Venta — {vendiendo.hipodromo} C{vendiendo.carrera}</h3>
              <button type="button" onClick={() => setVendiendo(null)} className="text-slate-300 hover:text-white">✕</button>
            </div>
            <div className="space-y-3 p-4">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-slate-500">Jugador</label>
                <select
                  value={clienteVenta}
                  onChange={(e) => elegirClienteVenta(e.target.value)}
                  disabled={vendiendoCargando}
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-bold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                  <option value="">{vendiendoCargando ? "Cargando…" : "— Seleccionar jugador —"}</option>
                  {opcionesVenta.clientes.map((c) => (
                    <option key={String(c.id)} value={String(c.id)}>
                      {c.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-slate-500">
                  Grupo (moneda y convenio)
                </label>
                {opcionesVenta.grupos.length === 0 && !vendiendoCargando ? (
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
                    <option key={i} value={String(c.numero)}>Nº {c.numero} · {c.nombre}</option>
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
                {cuadroBorrando.tabla.hipodromo} C{cuadroBorrando.tabla.carrera}
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
              <h3 className="text-xs font-black uppercase">✏️ Corregir — {editando.hipodromo} C{editando.carrera}</h3>
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
                  <input
                    type="date"
                    value={esFechaIso(String(patchEdicion.fecha ?? editando.fecha ?? "").slice(0, 10)) ? String(patchEdicion.fecha ?? editando.fecha ?? "").slice(0, 10) : ""}
                    onChange={(e) => setPatchEdicion((p) => ({ ...p, fecha: e.target.value }))}
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
      <style dangerouslySetInnerHTML={{ __html: `
        .legacy-impresion-container { font-family: system-ui, Arial, sans-serif; color: #0f172a; background: #eef2f7; padding: 14px;}
        .hoja-legacy { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 7px; background: #fff; padding: 8px; border-radius: 10px; }
        @media print {
          .hoja-legacy { display: grid !important; grid-template-columns: repeat(5, minmax(0, 1fr)) !important; gap: 1.8mm !important; padding: 1.6mm !important; box-shadow: none !important; border-radius: 0 !important; }
          .tarjeta-legacy { break-inside: avoid; border-radius: 4px; }
        }
        .tarjeta-legacy { background: #fff; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 1px 2px rgba(0,0,0,.04); }
        .enc-legacy { background: #0f172a; color: #fff; padding: 4px 6px; }
        .l1-legacy { display: flex; align-items: center; gap: 5px; justify-content: space-between; }
        .hip-legacy { font-size: 10.4px; font-weight: 800; letter-spacing: .32px; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 1; }
        .cc-legacy { background: rgba(255,255,255,.16); border-radius: 5px; font-size: 11.2px; font-weight: 900; padding: 1px 5px; white-space: nowrap; flex: none; }
        .l2-legacy { display: flex; align-items: center; justify-content: space-between; gap: 5px; margin-top: 1.5px; font-size: 8.4px; font-weight: 700; color: #cbd5e1; }
        .meta-legacy { display: flex; align-items: center; gap: 3px; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
        .fecha-legacy { margin-left: auto; white-space: nowrap; font-weight: 800; color: #7dd3fc; }
        .filas-legacy { flex: 1; display: flex; flex-direction: column; justify-content: space-evenly; gap: 1px; padding: 2px 4px; min-height: 0; overflow: hidden; }
        .fila-legacy { display: flex; align-items: center; gap: 3px; line-height: 1.25em; min-height: 0; border-radius: 3px; }
        .fila-legacy:nth-of-type(odd) { background: #eef2f7; }
        /* line-height en UNIDAD, nunca en número: html2canvas calcula la línea
           base como parseFloat(getComputedStyle().lineHeight)*0.8 y con "1" el
           texto se dibuja pegado al borde superior (se ve cortado en el PDF). */
        .num-legacy { width: 1.4em; height: 1.4em; border-radius: 3px; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 0.95em; flex: none; line-height: 1.4em; overflow: visible; }
        .cab-legacy { flex: 1; font-weight: 700; color: #334155; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 3px; }
        .cab-legacy.ret-legacy { color: #dc2626; text-decoration: line-through; }
        .band-legacy { flex: none; display: inline-flex; margin-left: 2px; }
        .mon-legacy { font-weight: 800; color: #475569; white-space: nowrap; font-size: 0.95em; }
        .mon-legacy.cero-legacy { color: #94a3b8; }
        .pie-legacy { display: flex; justify-content: space-between; align-items: center; gap: 5px; border-top: 1.5px solid #94a3b8; background: #f1f5f9; padding: 3px 6px; font-size: 6.8px; font-weight: 700; color: #475569; white-space: nowrap; position: relative; z-index: 2; }
        .pie-legacy b { color: #047857; font-size: 12px; }
      `}} />

      <div className="hoja-legacy">
        {tablas.map((t) => {
          const ejemplares = t.caballos ?? [];
          const fs = fsAuto(ejemplares.length || 1);

          return (
            <div key={String(t.id)} className="tarjeta-legacy">
              <div className="enc-legacy">
                <div className="l1-legacy">
                  <span className="hip-legacy">{t.hipodromo}</span>
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

function pagoPotencialNumerico(t: StoredTablaFija, numero: string, monto: number): number {
  if (!monto || !numero) return 0;
  const premio = t.premio_recalculado ?? 0;
  return numero === "TABLA" ? premio * monto : (premio / (t.suma_base_tabla ?? 1)) * monto;
}

function PremioVenta(t: StoredTablaFija, numero: string, monto: string): string {
  const m = parseNum(monto);
  if (!m || !numero) return "—";
  const premio = t.premio_recalculado ?? 0;
  return fmtMoney(numero === "TABLA" ? premio * m : (premio / (t.suma_base_tabla ?? 1)) * m, t.moneda);
}

export default MonitorTablas;