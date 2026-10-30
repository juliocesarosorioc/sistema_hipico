"use client";
import { DateInput } from "@/shared/components/ui/DateInput";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { calcularRiesgoCliente2, proyectarFila } from "@/features/taquilla/lib/validar";
import { clienteConSaldoDescontado, proyectarFilasEnOrden } from "@/features/taquilla/lib/saldosEnCurso";
import { normalizarLineaRapida, type ConfianzaCampo } from "@/features/taquilla/lib/normalizar";
import { etiquetaJugada, ladosDePareo, rotuloPareo } from "@/features/taquilla/lib/nomenclatura";
import { HorseBadge } from "@/shared/components/ui/HorseChips";
import {
  esMarca,
  esTablaFija,
  extraerNumeroTablaFija,
  extraerPareoMarca,
  formatearPrecioCorto,
} from "@/features/liquidacion/lib/etiquetas-reporte";
import { useTaquillaStore, type TicketTaquilla } from "@/shared/store/useTaquillaStore";
import { useAuthStore } from "@/shared/store/useAuthStore";
import { useTablasFijasStore } from "@/shared/store/useTablasFijasStore";
import { liquidarCarreraYCerrarTabla, liquidarPendientesDeCarrera, type ResLiquidarCarrera } from "@/features/liquidacion/lib/pagarYCerrar";
import {
  anularJugadaYRecalcular,
  corregirJugadaYRecalcular,
  recalcularCarreraCompleta,
} from "@/features/liquidacion/lib/recalcular";
import { reversarLiquidacionCarrera } from "@/features/liquidacion/lib/reversar";
import { aplicarLiquidacionSaldos } from "@/features/liquidacion/lib/saldos";
import { venderJugada, claveIdempotenciaJugada } from "@/features/taquilla/lib/venta";
import { dividendosDePizarra, pizarraDePosiciones, posicionesDePizarra, posicionesRayaDePizarra } from "@/features/liquidacion/lib/posiciones";
import { colorDiscoNumero, numerosDeCaballo } from "@/features/saldos/lib/discos";
import { PREFIJO_WPS, tipoWps } from "@/features/motores/lib/wps";
import { guardarPizarraCentral, pizarraDesdeResultadoOficial } from "@/features/liquidacion/lib/pizarraCentral";
import { SearchableSelect } from "@/shared/components/ui/SearchableSelect";
import { emitirToast } from "@/shared/lib/mensajeria";
import { useConfirmar } from "@/shared/store/useConfirmStore";
import { useHipodromosActivos } from "@/shared/store/useHipodromosStore";
import { nombrePropioHipodromo, nombreHipodromoParaMostrar } from "@/features/hipodromos/lib/nombre";
import { CargaResultadosModal, type PizarraResultados } from "@/features/liquidacion/components/CargaResultadosModal";
import { SemaforoCarreras } from "@/features/gestion/components/SemaforoCarreras";
import { Button } from "@/shared/components/ui/Button";
import { Guard } from "@/shared/components/ui/Guard";
import { fmtMoney, type EjemplarTabla } from "@/features/tablas/lib/tipos";
import { listarClientesVenta, listarGruposVenta, limpiarCacheClientesVenta, comisionJugadasDeGrupo, saldoDeCliente, avalDeCliente, esClienteLibre, limiteDeJugar, registrarAuditoria, telefonoMencionCliente, type ClienteVenta, type GrupoVenta } from "@/features/grupos/lib/grupos";
import { actualizarCliente } from "@/features/clientes/lib/clientes";
import { guardarCrucesCarrera, leerCrucesCarrera, type CrucesCarreraOverride } from "@/features/gestion/lib/cruces-carrera";
import type { ModalidadesCruce, OpcionesCrucesPuestos } from "@/features/motores/lib/puestos";
import { tieneCapacidad, usuarioVigente } from "@/features/seguridad/lib/vigente";
import { esUsuarioPrincipal } from "@/features/seguridad/lib/resolver";
import { listarCarrerasPorDia, asegurarHipodromo } from "@/features/tablas/lib/rpc";
import { registrarCarreraProgramada, leerResultadoOficial } from "@/features/carreras/lib/carreras-dia";
import { guardarCarreraCentral, numerosEjemplares } from "@/features/carreras/lib/central";
import { interpretarAudioCarrera, formatearDictadoJugadas } from "@/features/carreras/lib/audio-carrera";
import { BotonDictadoAudio } from "@/shared/components/ui/BotonDictadoAudio";
import { alternarRetiroCarrera, aplicarRetirosCarrera, parsearRetirados, jugadaInvolucraRetirado } from "@/features/carreras/lib/retiros";
import { claveHipodromo, numerosDeCarrera } from "@/features/carreras/lib/claves";
import { useRegistroCentralOpts } from "@/shared/store/useRegistroCentral";
import { hoyLocal } from "@/features/gaceta/lib/programa";
import { revisarCaballo, maximoDeLaCarrera, type RevisionCaballo } from "@/features/taquilla/lib/caballos";
import { mensajeResultadoDeCarrera, mensajePreliminarDeCarrera } from "@/features/taquilla/lib/mensajeResultado";
import { enviarAlGrupoWsp, listarGruposWsp } from "@/features/whatsapp/lib/whatsapp";
import PlanoPreliminar from "@/features/gestion/components/PlanoPreliminar";
import PreliminarResultados from "@/features/gestion/components/PreliminarResultados";
import HistorialReporte from "@/features/gestion/components/HistorialReporte";
import ReporteLiquidacionModal from "@/features/gestion/components/ReporteLiquidacionModal";
import ModalEditarJugadasCarrera from "@/features/gestion/components/ModalEditarJugadasCarrera";
import { expandirLineasDobleSplit, revisarCoherenciaLineas } from "@/features/taquilla/lib/expandirDobleSplit";
import { mensajePlanoDeCarrera } from "@/features/taquilla/lib/mensajeResultado";
import { corregirLineasConIA } from "@/features/taquilla/lib/corregirIA";
import {
  listarJugadasDeCarrera,
  NOTAS_PREDEFINIDAS_EDICION,
  MOTIVOS_ANULACION,
  componerNota,
  type JugadaAdmin,
} from "@/features/jugadas/lib/jugadas";
import { ToggleModalidadTiempo } from "@/features/jugadas/components/ToggleModalidadTiempo";
import { ModalGestionRapidaSaldo } from "@/features/contabilidad/components/ModalGestionRapidaSaldo";
import { ModalCreacionRapidaCliente } from "@/features/clientes/components/ModalCreacionRapidaCliente";
import { marcarTicketsAdelantados } from "@/features/jugadas/lib/marcar-adelantadas";
import { BarraCarrerasLiquidadas } from "@/features/gestion/components/BarraCarrerasLiquidadas";
import {
  notificarTareaEjecutadaOperador,
  solicitarConfirmacionOperador,
} from "@/shared/store/useInteraccionOperadorStore";
import {
  generarTextoPrejugadasWhatsapp,
  generarTextoSaldosWhatsapp,
  exportarReporteCarreraImagen,
  type FiltroSaldosWhatsapp,
} from "@/features/liquidacion/lib/reporte-imagen";
import {
  armarFilasPreview,
  resumenPreview,
  type FilaPreviewCarrera,
  type LadoResultado,
} from "@/features/gestion/lib/preview-carrera";
import { agruparAdelantadasPorSeccion } from "@/features/liquidacion/lib/reporte-carrera";
import ReporteCarrera, { type ObservacionOrdenExceso } from "@/features/saldos/components/ReporteCarrera";
import { BotonIconoReporteSaldosVisual } from "@/features/saldos/components/ReporteSaldosVisual";
import { ModalWpsApuestas } from "@/features/motores/components/ModalWpsApuestas";
import { parsearLineaWps, type ApuestaWpsParseada } from "@/features/motores/lib/wps-incentivos";
import {
  ejecutarComandoPizarra,
  construirMensajeResultadosAgente,
  MENSAJE_PIZARRA_ANULADA,
} from "@/features/liquidacion/lib/agente-pizarra";

type FilaCarga = {
  jugada: string;
  caballo: string;
  monto: string;
  cliente1: string;
  cliente2: string;
  /** Motivo si el parser universal marcó la línea como ilegible (fila roja ⚠️).
   *  El operador la corrige a mano y el flag se limpia al editarla. */
  error?: string;
};

const filaVacia = (): FilaCarga => ({
  jugada: "",
  caballo: "",
  monto: "",
  cliente1: "",
  cliente2: "",
});

/** Acción del panel de pre-visualización sobre una jugada ya cargada. */
type AccionPreview = {
  fila: FilaPreviewCarrera;
  modo: "editar" | "eliminar";
};

/** Campos editables de una jugada guardada (modal ✏️ del panel). */
type EdicionPreview = {
  jugador1: string;
  jugador2: string;
  carrera: string;
  esAdelantada: boolean;
  jugada: string;
  caballo: string;
  monto: string;
  notaPredefinida: string;
  motivoLibre: string;
};

/** Aviso visual (ToastHost global) para las acciones del panel. */
const toastPreview = (msg: string, tipo: "success" | "warning" | "error" | "info" = "info") =>
  emitirToast(msg, tipo);

const MONEDA = "VES";

/**
 * Botón de la barra flotante de Gestión de Jugadas. TODOS comparten alto,
 * padding, tipografía y `flex-1`: así la fila reparte el ancho en partes
 * iguales y se lee como un bloque, no como una escalera de botones de distinto
 * tamaño. `whitespace-nowrap` mantiene cada rótulo en UNA línea.
 */
const BTN_BARRA =
  "inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-lg px-1.5 text-[11px] font-bold disabled:cursor-not-allowed disabled:opacity-40";

function hipoKey(h: unknown): string {
  return String(h ?? "").toUpperCase().replace(/\s+/g, "");
}

/**
 * Gestión de Jugadas — Taquilla (clon del legacy):
 *  - Carga Individual con columnas # | X | JUGADA | CABALLO | MONTO |
 *    CLIENTE 1 | CLIENTE 2 (sin COBRO ni DISP, tipografía text-xs)
 *  - JUGADA solo nomenclatura pura (2x3 10/8 · 1p · 2n) + MONTO numérico aparte;
 *    el motor cruza la modalidad con el monto y proyecta el cobro por cliente
 *  - Saldo inline por cliente (registro de clientes): ✅ si alcanza el MONTO,
 *    ⚠️ "Max: X" si no; saldo azul (positivo) / rojo (negativo)
 *  - Auto-resolución del ejemplar: el número de CABALLO se cruza con la tabla
 *    publicada y bajo el input se muestra "N - NOMBRE" en gris
 *  - Alineación estricta: celdas h-12 + align-middle, mensajes inline con
 *    posición absolute para no descuadrar las filas
 *  - Pre-visualización de jugadas cargadas en sesión con acciones ✏️ (devuelve
 *    la jugada a la tabla para corregirla como inputs editables) y ✕
 *  - Modal Carga Rápida: textarea con bloque de texto (formato legacy) que el
 *    motor parsea línea por línea y puebla las filas automáticamente
 *  - Inputs: Retirados · COM % · Modalidad (Con Cruces) · Saldos Pozo/Traslado/Aval
 *  - Hipódromo buscable + Semáforo de carreras (gris/azul/amarillo/rojo)
 *  - Barra de comandos flotante con atajos: Ctrl+Q / Ctrl+Y / Ctrl+R / Ctrl+Shift+K
 *  - Liquidación con motor + posiciones dinámicas (5 por defecto, hasta 8)
 *    + Dead Heat (cero fraccionamiento)
 */
export function GestionJugadasModule() {
  const confirmar = useConfirmar();
  const [hipodromo, setHipodromo] = useState("");
  const hipodromos = useHipodromosActivos();
  const nombreHipodromo = nombrePropioHipodromo(hipodromo, hipodromos);
  /**
   * El filtro de hipódromo arranca EN BLANCO y la carga queda bloqueada hasta
   * que el operador elija el hipódromo y confirme la carrera en el semáforo.
   * Antes el módulo arrancaba en LA RINCONADA/N1 y una caja podía cargar
   * jugadas en el hipódromo equivocado sin darse cuenta.
   */
  const hipodromoElegido = claveHipodromo(hipodromo) !== "";
  const [carreraConfirmada, setCarreraConfirmada] = useState(false);
  /** Habilitado para cargar jugadas: hipódromo elegido + carrera confirmada. */
  const listoParaCargar = hipodromoElegido && carreraConfirmada;
  const [fecha, setFecha] = useState(() => hoyLocal());
  const [carrerasPorDia, setCarrerasPorDia] = useState<number[]>([]);
  const [carrera, setCarrera] = useState(1);
  const [modoManual, setModoManual] = useState(false);
  const [retirados, setRetirados] = useState("");
  /** Observaciones libres que se anexan al pie del preliminar de resultados. */
  const [observaciones, setObservaciones] = useState("");
  const [comision, setComision] = useState("5");
  const [conCruces, setConCruces] = useState(false);
  /** Ítem 1: re-apertura explícita de una carrera YA liquidada (para agregar jugadas). */
  const [reapertura, setReapertura] = useState(false);
  /** Modal para corregir/anular las jugadas YA GUARDADAS de la carrera (aunque esté cerrada). */
  const [modalEditarJugadas, setModalEditarJugadas] = useState(false);
  /** Ítem 1 (bloque 1): reversión de la liquidación de la carrera en curso. */
  const [modalReversar, setModalReversar] = useState(false);
  const [reversando, setReversando] = useState(false);
  const [filas, setFilas] = useState<FilaCarga[]>([filaVacia()]);
  const [jugadasPorCarrera, setJugadasPorCarrera] = useState<number[]>([]);
  const [clientes, setClientes] = useState<ClienteVenta[]>([]);
  const [aviso, setAviso] = useState("");
  /** Índice de la fila cuyo aviso de saldo se acaba de copiar (feedback ✅). */
  const [copiadoFila, setCopiadoFila] = useState<number | null>(null);
  /** Feedback del botón que copia TODOS los avisos de saldo. */
  const [copiadoAvisos, setCopiadoAvisos] = useState(false);
  /**
   * BLOQUE 2 — Pre-visualización PERMANENTE: jugadas ya guardadas en la base
   * para la carrera elegida. Se leen aparte del store para que sigan visibles
   * al recargar la página, cambiar de operador o después de liquidar.
   */
  const [jugadasGuardadas, setJugadasGuardadas] = useState<JugadaAdmin[]>([]);
  const [cargandoGuardadas, setCargandoGuardadas] = useState(false);
  /** Acción (✏️ editar / 🗑️ eliminar) sobre una fila del panel, con su modal. */
  const [accionPreview, setAccionPreview] = useState<AccionPreview | null>(null);
  const [motivoPreview, setMotivoPreview] = useState("");
  const [notaAnularPreview, setNotaAnularPreview] = useState<string>(MOTIVOS_ANULACION[0]);
  const [edicionPreview, setEdicionPreview] = useState<EdicionPreview | null>(null);
  const [ocupadoPreview, setOcupadoPreview] = useState(false);
  const [modalSaldoRapido, setModalSaldoRapido] = useState(false);
  const [modalCreacionRapidaCliente, setModalCreacionRapidaCliente] = useState(false);

  const { carreras: centralCarrerasDiaAllBase, carrerasDe, recargar: recargarRegistroCentral } =
    useRegistroCentralOpts(fecha);
  /**
   * LOS SEMÁFOROS Y LOS EJEMPLARES SALEN DE LA MISMA LISTA.
   *
   * Antes este módulo mantenía DOS copias del catálogo: `carrerasCentrales`
   * (una consulta propia filtrada por hipódromo) para los ejemplares, y el
   * registro central (`carrerasDe`) para los números del semáforo. Dos lecturas
   * del mismo catálogo con dos criterios distintos, así que una podía traer los
   * 8 ejemplares de la C1 y la otra ninguna, o traer los de otra jornada. El
   * síntoma era "en Carreras del Día salen estos 8 y en Gestión estos otros 8".
   *
   * Ahora hay una sola: `carrerasDelDia`, recortada del registro central con la
   * MISMA clave canónica `hipodromo|carrera` para ambos consumidores.
   */
  const carrerasDelDia = useMemo(
    () =>
      claveHipodromo(hipodromo)
        ? carrerasDe(hipodromo)
        : centralCarrerasDiaAllBase,
    [carrerasDe, hipodromo, centralCarrerasDiaAllBase]
  );
  const centralCarrerasDiaAll = centralCarrerasDiaAllBase;
  const tablas = useTablasFijasStore((s) => s.tablas);

  /** Editar jugadas guardadas: la capacidad de corregir/anular jugadas (principal = todo). */
  const puedeEditarJugadas =
    esUsuarioPrincipal(usuarioVigente()) ||
    tieneCapacidad("gestion_jugadas:btn_editar_jugada") ||
    tieneCapacidad("jugadas:fn_editar_jugada");

  // La re-apertura vale SOLO para la carrera en curso: al cambiar de carrera,
  // fecha o hipódromo se cierra sola, para no liquidar por error. Lo mismo la
  // pizarra cargada: si no se limpia, al cambiar de carrera el flujo unificado
  // finalizaría la carrera nueva con la llegada de la anterior.
  useEffect(() => {
    setReapertura(false);
    setUltimaPizarra(null);
    setPizarraCentral(null);
  }, [hipodromo, fecha, carrera]);

  /**
   * Cambiar de jornada o de hipódromo invalida la carrera confirmada: hay que
   * volver a elegirla en el semáforo antes de poder cargar jugadas. Es la otra
   * mitad del guard de arriba: el hipódromo no basta, la carrera se confirma.
   */
  useEffect(() => {
    setCarreraConfirmada(false);
    setJugadasPorCarrera([]);
  }, [hipodromo, fecha]);

  /** Opciones del Autocomplete CLIENTE 1/CLIENTE 2 (value = nombre real en BD). */
  const opcionesClientes = useMemo(
    () =>
      [...new Map(clientes.map((c) => [String(c.nombre).trim().toUpperCase(), c])).values()]
        .map((c) => ({ value: String(c.nombre), label: String(c.nombre) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [clientes]
  );

  // Registro de clientes con saldos (validación inline CLIENTE 1 / CLIENTE 2)
  const [gruposMapa, setGruposMapa] = useState<Record<string, boolean>>({});
  /** Grupos de venta completos: fuente de la comisión de las jugadas entre tercios. */
  const [gruposVenta, setGruposVenta] = useState<GrupoVenta[]>([]);
  const [crucesOverrideCarrera, setCrucesOverrideCarrera] = useState<CrucesCarreraOverride>({});
  const [cargandoCrucesCarrera, setCargandoCrucesCarrera] = useState(false);
  const [jugadorCruce, setJugadorCruce] = useState("");
  const [alcanceCruce, setAlcanceCruce] = useState<"carrera" | "permanente">("carrera");
  const [borradorCruceJugador, setBorradorCruceJugador] = useState<ModalidadesCruce>({
    mismoEjemplar: false,
    diferenteEjemplar: false,
  });
  const grupoActivo = useAuthStore((s) => s.grupoActivo);
  const veTodosLosGrupos = useAuthStore((s) => s.veTodosLosGrupos);
  const esPrincipal = useAuthStore((s) => s.esPrincipal);
  const usuarioSesion = useAuthStore((s) => s.usuario);
  const setGrupoActivo = useAuthStore((s) => s.setGrupoActivo);

  const modoOperador = useAuthStore((s) => s.modoOperador);
  const perfiles = useAuthStore((s) => s.perfiles);
  const esOperadorFijo =
    perfiles.length > 0 &&
    perfiles.every((p) => p.toLowerCase().includes("operador")) &&
    !perfiles.some((p) => p.toLowerCase().includes("admin"));

  const [modalControlCruces, setModalControlCruces] = useState(false);
  const [modalWps, setModalWps] = useState(false);

  const esUsuarioOAdminPrincipal = Boolean(
    esPrincipal || veTodosLosGrupos || esUsuarioPrincipal(usuarioSesion)
  );

  const grupoActivoValido =
    grupoActivo &&
    grupoActivo !== "null" &&
    grupoActivo !== "undefined" &&
    String(grupoActivo).trim() !== ""
      ? String(grupoActivo).trim()
      : null;

  /** El usuario/grupo Principal ("Todos los grupos") es solo de gestión y no puede registrar jugadas directamente. */
  const principalSinGrupoSeleccionado = Boolean(
    esUsuarioOAdminPrincipal && !grupoActivoValido
  );

  /**
   * Relee los saldos del catálogo. Es CLAVE refrescarlos después de cada venta y
   * de cada liquidación: la RPC revalida `saldo + aval` contra la base, así que
   * si el navegador se queda con los saldos viejos "autoriza" jugadas que la RPC
   * rechaza y la jugada NO se toma (el caso reportado: cargar más jugadas en una
   * carrera ya pagada, p. ej. Remington Park 7).
   */
  const recargarClientes = useCallback(async () => {
    try {
      limpiarCacheClientesVenta();
      const c = await listarClientesVenta();
      setClientes(c);
    } catch {
      /* sin conexión: se conserva el catálogo actual */
    }
  }, []);

  useEffect(() => {
    void recargarClientes();
  }, [grupoActivo, recargarClientes]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search);
      if (p.get("modal") === "wps") {
        setModalWps(true);
      }
    }
  }, []);

  useEffect(() => {
    let vivo = true;
    listarClientesVenta().then((c) => {
      if (vivo) setClientes(c);
    });
    // Jerarquía de cruces: switch general del GRUPO (default TRUE).
    listarGruposVenta().then((gs) => {
      const mapa: Record<string, boolean> = {};
      for (const g of gs) mapa[String(g.id)] = g.permite_cruces !== false;
      if (vivo) {
        setGruposMapa(mapa);
        setGruposVenta(gs);
      }
    });
    return () => {
      vivo = false;
    };
  }, []);

  /**
   * Semáforo: los números de carrera del día.
   *
   * El semáforo usa exclusivamente el catálogo central `carreras`. Que una
   * carrera no tenga ejemplares todavía no significa que no esté registrada.
   */
  useEffect(() => {
    let vivo = true;
    setCarrerasPorDia([]);
    const base = numerosDeCarrera(carrerasDelDia, hipodromo);
    if (base.length > 0) {
      setCarrerasPorDia(base);
      return () => {
        vivo = false;
      };
    }
    listarCarrerasPorDia(fecha, hipodromo)
      .then((c) => {
        if (!vivo) return;
        const base = [...new Set(c.map((n) => Number(n)).filter((n) => n > 0))].sort((a, b) => a - b);
        setCarrerasPorDia(base);
      })
      .catch(() => {
        /* sin conexión: el operador elige la carrera en el semáforo */
      });
    return () => {
      vivo = false;
    };
  }, [fecha, hipodromo, carrerasDelDia]);

  // El catálogo y sus ejemplares los aporta el REGISTRO CENTRAL (arriba). Este
  // módulo ya no mantiene una segunda consulta: dos copias del mismo catálogo
  // divergen y producían padrones distintos entre módulos.

  const [modalPreliminar, setModalPreliminar] = useState(false);
  const [mostrarPlanoPreliminar, setMostrarPlanoPreliminar] = useState(false);
  const [mostrarPreliminarResultado, setMostrarPreliminarResultado] = useState(false);
  const [mostrarHistorial, setMostrarHistorial] = useState(false);
  const [mostrarReporteLiquidacion, setMostrarReporteLiquidacion] = useState(false);
  const [modalResultados, setModalResultados] = useState(false);
  const [modalFinalizar, setModalFinalizar] = useState(false);
  /** Abre el Reporte de Liquidación recién al cerrar «Registrar y Finalizar». */
  const [reporteAlCerrarFinalizar, setReporteAlCerrarFinalizar] = useState(false);
  const [modalComandos, setModalComandos] = useState(false);
  const [modalCargaRapida, setModalCargaRapida] = useState(false);
  const [textoCargaRapida, setTextoCargaRapida] = useState("");
  const [iaCargando, setIaCargando] = useState(false);
  const [ultimaPizarra, setUltimaPizarra] = useState<PizarraResultados | null>(null);
  /**
   * Pizarra PAGADA en esta sesión (se conserva al cerrar) para poder volver a
   * editarla con el botón «✏️ Editar resultados» del modal de Finalizar.
   *
   * NUNCA se rellena desde el central: «Registrar y Finalizar» abre la Carga
   * de Resultados EN BLANCO aunque la carrera ya tenga resultados guardados
   * (`resultados_carreras`), porque precargarlos obligaba a borrar a mano una
   * llegada que el operador quería cargar de nuevo.
   */
  const [pizarraCentral, setPizarraCentral] = useState<PizarraResultados | null>(null);

  /**
   * Item 1: la carrera activa ya esta liquidada? El registro central de la
   * fecha lo dice (`estado` "Liquidada" o el resultado ya aplicado a tablas).
   */
  const carreraLiquidada = useMemo(() => {
    const c = carrerasDelDia.find((x) => Number(x.carrera) === carrera);
    if (!c) return false;
    const est = String(c.estado ?? "").toLowerCase();
    return est === "liquidada" || est === "cerrada" || c.aplicado_a_tablas === true || (c.ganadores?.length ?? 0) > 0;
  }, [carrerasDelDia, carrera]);

  const tieneResultadoCargado = carreraLiquidada || Boolean(pizarraCentral);

  // Precarga automática del resultado oficial de pizarra cuando la carrera ya está liquidada
  // o tiene resultados registrados en la base central (resultados_carreras).
  useEffect(() => {
    let activo = true;
    if (!hipodromo || !carrera || !fecha) return;
    void (async () => {
      try {
        const oficial = await leerResultadoOficial(hipodromo, carrera, fecha);
        if (!activo || !oficial) return;
        if (oficial.puestos && oficial.puestos.length > 0) {
          const piz = pizarraDesdeResultadoOficial(oficial);
          if (piz && activo) {
            setPizarraCentral(piz);
          }
        }
      } catch {
        /* sin resultado oficial legible */
      }
    })();
    return () => {
      activo = false;
    };
  }, [hipodromo, fecha, carrera, carreraLiquidada]);
  /** Ítem 1: sólo quien tenga la capacidad puede reabrir una liquidada. */
  const puedeReabrir = tieneCapacidad("gestion_jugadas:fn_reabrir_carrera");
  const [resumen, setResumen] = useState<ResLiquidarCarrera | null>(null);

  // Mensaje de WhatsApp de RESULTADOS: se genera al instante al cargar la
  // pizarra (Ctrl+Y) con la misma plantilla y el mismo motor de la liquidación.
  const [mensajeWhatsapp, setMensajeWhatsapp] = useState<string | null>(null);
  const [modalWhatsapp, setModalWhatsapp] = useState(false);
  const [enviandoWhatsapp, setEnviandoWhatsapp] = useState(false);
  const [copiadoWhatsapp, setCopiadoWhatsapp] = useState(false);
  const [grupoDestinoWhatsapp, setGrupoDestinoWhatsapp] = useState<string | null>(null);

  const tickets = useTaquillaStore((s) => s.tickets);
  const eliminarTicket = useTaquillaStore((s) => s.eliminarTicket);
  const agregarTicket = useTaquillaStore((s) => s.agregarTicket);
  const modalidadTiempo = useTaquillaStore((s) => s.modalidadTiempo);
  const setModalidadTiempo = useTaquillaStore((s) => s.setModalidadTiempo);
  const [visorWhatsappTipo, setVisorWhatsappTipo] = useState<"prejugadas" | "resultados" | "saldos" | null>(null);
  const [textoVisorWhatsapp, setTextoVisorWhatsapp] = useState("");
  const [filtroSaldosWsp, setFiltroSaldosWsp] = useState<FiltroSaldosWhatsapp>("todos");
  const [separarSaldosWsp, setSepararSaldosWsp] = useState(true);
  const [acuseReciboOperador, setAcuseReciboOperador] = useState(false);
  const [comandoPizarraInput, setComandoPizarraInput] = useState("");
  const [respuestaAgentePizarra, setRespuestaAgentePizarra] = useState<string | null>(null);
  const [copiadoReporteAgente, setCopiadoReporteAgente] = useState(false);

  /**
   * Hipódromos con carreras CARGADAS en el día elegido (se elige el día
   * primero): los que tienen tabla publicada o carrera en el registro central.
   * El catálogo completo queda disponible si el día aún no tiene nada.
   *
   * La data central viene del REGISTRO CENTRAL compartido con Marcas, Tablas y
   * Dupletas, no de un `useCarrerasCentrales` propio: con copias separadas, una
   * carrera recién registrada aparecía en Tablas y en Marcas pero el selector de
   * Gestión no la ofrecía, y era imposible venderla sin recargar a mano.
   */


const hipodromosDelDia = useMemo(() => {
    // `claveHipodromo` en los dos lados: con un `.toUpperCase()` propio que
    // dejaba el espacio ("LA RINCONADA" vs "LARINCONADA"), un hipódromo con
    // carrera no entraba en la lista y el usuario tenía que recargar a mano.
    const conCarreras = new Set<string>();
    for (const t of tablas) {
      const h = claveHipodromo(t.hipodromo);
      if (h && String(t.fecha || t.fecha_creacion || "").slice(0, 10) === fecha) conCarreras.add(h);
    }
    for (const c of centralCarrerasDiaAll) {
      const h = claveHipodromo(c.hipodromo);
      if (h) conCarreras.add(h);
    }
    if (!conCarreras.size) return hipodromos;
    const normalizado = new Map(hipodromos.map((h) => [claveHipodromo(h.value), h] as const));
    const dentro = [...conCarreras]
      .map((k) => normalizado.get(k) ?? { value: k, label: nombreHipodromoParaMostrar(k) })
      .sort((a, b) => String(a.label).localeCompare(String(b.label)));
    const dentroKeys = new Set(dentro.map((h) => claveHipodromo(h.value)));
    const fuera = hipodromos.filter((h) => !dentroKeys.has(claveHipodromo(h.value)));
    return [...dentro, ...fuera];
  }, [tablas, hipodromos, centralCarrerasDiaAll, fecha]);

  // Grupo vinculado para mostrar como "Grupo" en el modal WhatsApp
  useEffect(() => {
    void (async () => {
      try {
        const gs = await listarGruposWsp();
        if (gs && gs.length > 0) {
          const vinculado = gs.find((g) => g.vinculado);
          if (vinculado && vinculado.nombre) {
            setGrupoDestinoWhatsapp(vinculado.nombre);
            return;
          }
          if (gs[0].nombre) setGrupoDestinoWhatsapp(gs[0].nombre);
        }
      } catch {
        /* sinop */
      }
    })();
  }, []);

  /**
   * FLUJO UNIFICADO de «Resultados» y «Registrar y Finalizar».
   *
   * Antes eran dos acciones separadas: «Resultados» (Ctrl+Y) cargaba la pizarra
   * y «Registrar y Finalizar» (Ctrl+R) liquidaba; el operador tenía que hacer
   * las dos en secuencia y por eso se sentían redundantes. Ahora AMBOS botones y
   * AMBOS atajos llaman a este mismo flujo:
   *
   *   1. Si ya hay una pizarra confirmada en la sesión → va directo a Registrar
   *      y Finalizar (no hay nada que volver a cargar).
   *   2. Si no → abre la Carga de Resultados EN BLANCO. A propósito NO se trae
   *      la pizarra del central: una carrera que ya tenía resultados guardados
   *      se abría precargada y el operador tenía que borrar la llegada ajena a
   *      mano antes de cargar la suya.
   */
  const abrirResultados = useCallback(async () => {
    if (!listoParaCargar) return;
    // Con la Carga de Resultados ya abierta, no re-abrir: evita que un Ctrl+Y/R
    // accidental mientras se tipea reinicie el formulario.
    if (modalResultados) return;
    if (ultimaPizarra) {
      setModalFinalizar(true);
      return;
    }
    // SOLO se muestran llegadas si la carrera YA está LIQUIDADA: en ese caso se
    // precarga el resultado oficial para editarlo (y, si cambia algo, se pide el
    // motivo y se recalcula). Una carrera que todavía no liquidó abre EN BLANCO:
    // traer el resultado del central obligaba a borrar a mano una llegada que el
    // operador quería cargar de nuevo.
    if (carreraLiquidada) {
      try {
        const oficial = await leerResultadoOficial(hipodromo, carrera, fecha);
        const p = pizarraDePosiciones(oficial?.puestos ?? []);
        if (p) {
          const posiciones = (oficial?.puestos ?? []).map((n) => String(n).trim());
          // El central guarda los pools por caballo y la matriz W/P/S en un solo
          // blob (`dividendos`). Se separan acá porque el formulario los edita en
          // dos lugares distintos: si el `wps_` cayera en los pools, la firma de
          // comparación lo vería como un cambio y pediría un motivo inexistente.
          // La matriz conserva su prefijo `wps_` (así la espera `PizarraResultados`).
          const porCaballo: Record<string, number> = {};
          const matriz: Record<string, number> = {};
          for (const [k, v] of Object.entries(oficial?.dividendos ?? {})) {
            if (k.startsWith(PREFIJO_WPS)) matriz[k] = v;
            else porCaballo[k] = v;
          }
          setPizarraCentral({
            pizarra: p as PizarraResultados["pizarra"],
            empates: [],
            llenas: posiciones.length,
            dividendos: Object.keys(porCaballo).length ? porCaballo : null,
            matrizWps: Object.keys(matriz).length ? matriz : null,
          });
          setModalResultados(true);
          return;
        }
      } catch {
        /* sin resultado oficial legible: se abre en blanco */
      }
    }
    // Carrera sin liquidar (o sin resultado oficial): EN BLANCO.
    setPizarraCentral(null);
    setModalResultados(true);
  }, [listoParaCargar, modalResultados, ultimaPizarra, carreraLiquidada, hipodromo, carrera, fecha]);

  const [liquidandoCarrera, setLiquidandoCarrera] = useState(false);
  const [modoExclusivoReporte, setModoExclusivoReporte] = useState(false);
  const [adelantadasAbierto, setAdelantadasAbierto] = useState(false);
  const [modalAgentePizarra, setModalAgentePizarra] = useState(false);
  const bloqueoLiquidacionActivo = liquidandoCarrera || (mostrarReporteLiquidacion && modoExclusivoReporte);

  // Atajos de la Barra de Comandos (real keyboard events)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (bloqueoLiquidacionActivo) return;
      if (!e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (k === "q") {
        e.preventDefault();
        setMostrarPlanoPreliminar(true);
      } else if (k === "y" || k === "r") {
        // Ctrl+Y (Resultados) y Ctrl+R (Registrar y Finalizar) hacen lo MISMO:
        // el flujo unificado decide internamente si precargar o liquidar.
        e.preventDefault();
        void abrirResultados();
      } else if (k === "h") {
        e.preventDefault();
        setMostrarHistorial((v) => !v);
      } else if (k === "g") {
        e.preventDefault();
        setModoExclusivoReporte(false);
        setMostrarReporteLiquidacion(true);
      } else if (k === "k" && e.shiftKey) {
        e.preventDefault();
        setModalComandos(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [abrirResultados, bloqueoLiquidacionActivo]);

  const comisionNum = useMemo(() => {
    const n = parseFloat(comision.replace(",", "."));
    return Number.isFinite(n) && n >= 0 ? n : 5;
  }, [comision]);

  /**
   * Grupo de la caja: dueño de la comisión de las "jugadas entre tercios". Para
   * el super administrador es el grupo que está mirando; para el resto, el de
   * los clientes cargados (el RLS ya los acota a su grupo).
   */
  const grupoSesion = useMemo(() => {
    if (grupoActivo) return String(grupoActivo);
    const g = clientes.find((c) => c.grupo_id != null || c.grupos.length > 0);
    if (!g) return null;
    return g.grupo_id != null ? String(g.grupo_id) : String(g.grupos[0]);
  }, [grupoActivo, clientes]);

  const comisionGrupoSesion = comisionJugadasDeGrupo(gruposVenta, grupoSesion);
  const grupoReglasCruce = useMemo(() => {
    const grupo = gruposVenta.find((g) => String(g.id) === String(grupoSesion));
    return {
      mismoEjemplar: grupo?.cruce_mismo_ejemplar ?? grupo?.permite_cruces ?? false,
      diferenteEjemplar: grupo?.cruce_diferente_ejemplar ?? grupo?.permite_cruces ?? false,
    };
  }, [grupoSesion, gruposVenta]);
  const opcionesCrucesPuestos = useMemo<OpcionesCrucesPuestos>(() => {
    const porJugadorPermanente: NonNullable<OpcionesCrucesPuestos["porJugadorPermanente"]> = {};
    for (const cliente of clientes) {
      const reglas: Partial<ModalidadesCruce> = {};
      if (typeof cliente.cruce_mismo_ejemplar === "boolean") reglas.mismoEjemplar = cliente.cruce_mismo_ejemplar;
      if (typeof cliente.cruce_diferente_ejemplar === "boolean") reglas.diferenteEjemplar = cliente.cruce_diferente_ejemplar;
      if (Object.keys(reglas).length > 0) porJugadorPermanente[cliente.nombre.trim().toUpperCase()] = reglas;
    }
    return {
      grupo: grupoReglasCruce,
      porJugadorPermanente,
      carreraTodosOverride: crucesOverrideCarrera.todos,
      carreraPorJugadorOverride: crucesOverrideCarrera.porJugador,
    };
  }, [clientes, crucesOverrideCarrera, grupoReglasCruce]);

  useEffect(() => {
    let vivo = true;
    if (!grupoSesion || !hipodromo || !carrera || !fecha) {
      setCrucesOverrideCarrera({});
      setCargandoCrucesCarrera(false);
      return () => { vivo = false; };
    }
    setCargandoCrucesCarrera(true);
    void leerCrucesCarrera({ grupoId: grupoSesion, fecha, hipodromo, carrera }).then((r) => {
      if (!vivo) return;
      setCargandoCrucesCarrera(false);
      if (!r.ok) {
        setCrucesOverrideCarrera({});
        emitirToast(`No se pudieron cargar las excepciones de cruces: ${r.error ?? "error desconocido"}`, "error");
        return;
      }
      setCrucesOverrideCarrera(r.override);
    });
    return () => { vivo = false; };
  }, [carrera, fecha, grupoSesion, hipodromo]);

  useEffect(() => {
    if (!jugadorCruce) return;
    const clave = jugadorCruce.trim().toUpperCase();
    const cliente = clientes.find((c) => c.nombre.trim().toUpperCase() === clave);
    const porJugador = crucesOverrideCarrera.porJugador?.[clave];
    const todos = crucesOverrideCarrera.todos;
    const permanenteMismo = cliente
      ? cliente.cruce_mismo_ejemplar !== undefined ? cliente.cruce_mismo_ejemplar : cliente.permite_cruces
      : undefined;
    const permanenteDiferente = cliente
      ? cliente.cruce_diferente_ejemplar !== undefined ? cliente.cruce_diferente_ejemplar : cliente.permite_cruces
      : undefined;
    setBorradorCruceJugador({
      mismoEjemplar: alcanceCruce === "permanente"
        ? permanenteMismo ?? grupoReglasCruce.mismoEjemplar
        : porJugador?.mismoEjemplar ?? todos?.mismoEjemplar ?? permanenteMismo ?? grupoReglasCruce.mismoEjemplar,
      diferenteEjemplar: alcanceCruce === "permanente"
        ? permanenteDiferente ?? grupoReglasCruce.diferenteEjemplar
        : porJugador?.diferenteEjemplar ?? todos?.diferenteEjemplar ?? permanenteDiferente ?? grupoReglasCruce.diferenteEjemplar,
    });
  }, [alcanceCruce, crucesOverrideCarrera, grupoReglasCruce, jugadorCruce, clientes]);

  const guardarOverrideActual = useCallback(async (override: CrucesCarreraOverride) => {
    if (!grupoSesion) {
      emitirToast("No se puede guardar la excepción: falta el grupo activo.", "error");
      return false;
    }
    const r = await guardarCrucesCarrera({ grupoId: grupoSesion, fecha, hipodromo, carrera, override });
    if (!r.ok) {
      emitirToast(`No se pudo guardar la excepción de esta carrera: ${r.error ?? "error desconocido"}`, "error");
      return false;
    }
    setCrucesOverrideCarrera(override);
    return true;
  }, [carrera, fecha, grupoSesion, hipodromo]);

  const guardarReglasJugador = useCallback(async () => {
    const clave = jugadorCruce.trim().toUpperCase();
    if (!clave) return;
    if (alcanceCruce === "carrera") {
      await guardarOverrideActual({
        ...crucesOverrideCarrera,
        porJugador: {
          ...crucesOverrideCarrera.porJugador,
          [clave]: { ...borradorCruceJugador },
        },
      });
      return;
    }
    const cliente = clientes.find((c) => c.nombre.trim().toUpperCase() === clave);
    if (!cliente) {
      emitirToast("No se encontró el jugador para actualizar su ficha permanente.", "error");
      return;
    }
    const r = await actualizarCliente(cliente.id, {
      cruce_mismo_ejemplar: borradorCruceJugador.mismoEjemplar,
      cruce_diferente_ejemplar: borradorCruceJugador.diferenteEjemplar,
    }, cliente);
    if (!r.ok) {
      emitirToast(`No se pudo guardar la ficha del jugador: ${r.error ?? "error desconocido"}`, "error");
      return;
    }
    limpiarCacheClientesVenta();
    setClientes((prev) => prev.map((c) => String(c.id) === String(cliente.id)
      ? {
          ...c,
          cruce_mismo_ejemplar: borradorCruceJugador.mismoEjemplar,
          cruce_diferente_ejemplar: borradorCruceJugador.diferenteEjemplar,
        }
      : c));
    emitirToast(`Reglas permanentes actualizadas para ${clave}.`, "success");
  }, [alcanceCruce, borradorCruceJugador, clientes, crucesOverrideCarrera, guardarOverrideActual, jugadorCruce]);

  /**
   * Prellena COM % con la comisión GENERAL del grupo (comision_default): es la
   * ÚNICA comisión de las jugadas entre tercios y alimenta venta, liquidación y
   * reportes/WhatsApp. El operador puede ajustarla puntualmente (queda editable).
   */
  useEffect(() => {
    if (comisionGrupoSesion != null) setComision(String(comisionGrupoSesion));
  }, [comisionGrupoSesion]);

  /** Proyecta la fila. Si los clientes no están en el registro todavía, se
      calculan por prefijo para poder topar el monto igual (mismo criterio que
      `saldoCliente`, que corre un turno más tarde en el render). El `descontado`
      opcional es lo que YA arriesgó el cliente 1 en filas anteriores de esta
      carga (tope en orden; ver saldosEnCurso.ts). */
  const valida = (f: FilaCarga, descontado?: Map<string, number>) => {
    return proyectarFila({
      jugada: f.jugada,
      caballo: f.caballo.trim(),
      monto: f.monto,
      tasaComision: comisionNum,
      cliente1: clienteConSaldoDescontado(saldoCliente(f.cliente1), descontado ?? new Map()),
      cliente2: saldoCliente(f.cliente2),
    });
  };

  const tablaDeCarrera = useMemo(
    () =>
      tablas.find(
        (t) =>
          claveHipodromo(t.hipodromo) === claveHipodromo(hipodromo) &&
          Number(t.carrera) === Number(carrera) &&
          // La fecha es imprescindible: el store persiste tablas de jornadas
          // anteriores y sin este filtro el respaldo mostraba los ejemplares de
          // otro día cuando la carrera actual no tenía padrón en el registro
          // central ("trae ejemplares de días diferentes al seleccionado").
          String(t.fecha || t.fecha_creacion || "").slice(0, 10) === fecha
      ),
    [tablas, hipodromo, carrera, fecha]
  );

  /**
   * Carrera central (registro único) que corresponde a la vista actual. Se
   * busca por la clave canónica, no solo por número: con la copia anterior el
   * móduloonoraba la primera fila que coincidía en número, que podía ser de
   * otra jornada.
   */
  const centralDeCarrera = useMemo(
    () => carrerasDelDia.find((c) => Number(c.carrera) === Number(carrera)) ?? null,
    [carrerasDelDia, carrera]
  );

  /**
   * Ejemplares inscritos de la carrera en pantalla.
   *
   * ORDEN DE PREFERENCIA (importante): la matriz `carreras` —el registro único—
   * MANDA. La tabla fija publicada es el libro de VENTAS, no el padrón de
   * inscripción: su lista de caballos es la que había una venta, que puede venir
   * de otra jornada o de otra carga. Por eso antes se veían ocho NOMBRES
   * COMPLETAMENTE DISTINTOS a los de Carreras del Día: este módulo priorizaba
   * `tablaDeCarrera.caballos` y solo caía al catálogo central si la tabla no
   * tenía caballos.
   *
   * La tabla fija solo entra como respaldo cuando el catálogo central no tiene
   * ejemplares para esa carrera, y la lista CENTRAL de retiros se aplica sobre
   * las dos: un retiro registrado en cualquier módulo se ve al instante.
   */
  const caballosDeCarrera = useMemo<EjemplarTabla[]>(() => {
    const retiradosCentral = new Set(centralDeCarrera?.retirados ?? []);
    const marcar = (
      c: { numero: string | number; nombre?: string | null; nacionalidad?: string | null; retirado?: boolean },
      porDefecto: string
    ): EjemplarTabla => ({
      numero: String(c.numero),
      nombre: c.nombre ?? porDefecto,
      nacionalidad: c.nacionalidad ?? null,
      retirado: Boolean(c.retirado) || retiradosCentral.has(String(c.numero)),
    });
    const central = centralDeCarrera?.caballos ?? [];
    if (central.length > 0) return central.map((c) => marcar(c, ""));
    if (tablaDeCarrera?.caballos?.length) return tablaDeCarrera.caballos.map((c) => marcar(c, ""));
    return [];
  }, [tablaDeCarrera, centralDeCarrera]);

  const monedaFmt = (n: number): string =>
    fmtMoney(Number.isFinite(n) ? n : 0, MONEDA);

  /* ⚡ Normalizador difuso de Carga Rápida: contexto = catálogo de clientes +
     padrón de la carrera. La vista previa en vivo del modal y el poblar tabla
     usan exactamente el mismo resultado, para que "lo que se ve" es lo que se
     pega en la Carga Individual. */
  const contextoNormalizacion = useMemo(
    () => ({
      clientes,
      caballos: caballosDeCarrera.map((c) => ({ numero: c.numero, nombre: c.nombre })),
    }),
    [clientes, caballosDeCarrera]
  );

  const previewCargaRapida = useMemo(() => {
    const lineas = textoCargaRapida.split("\n");
    const expandidas: string[] = [];
    for (const l of lineas) {
      const t = l.trim();
      if (!t) { expandidas.push(l); continue; }
      /* Jugada compuesta con guion (1p-1y2, 2y3-3n): se parte en dos líneas
         con el monto repartido 50/50. La utilidad solo devuelve resultado
         cuando AMBAS piezas son jugadas coherentes; si no, la línea original
         se conserva y `revisarCoherenciaLineas` pide la corrección. */
      const res = expandirLineasDobleSplit([t]);
      if (res.length === 2) {
        for (const r of res) expandidas.push(r.linea);
        continue;
      }
      const resWps = parsearLineaWps(t);
      if (resWps.length > 1) {
        for (const w of resWps) {
          expandidas.push(`${w.jugador} ${w.modalidad.toLowerCase()} ${w.ejemplar} ${w.monto}`);
        }
        continue;
      }
      expandidas.push(l);
    }
    return expandidas
      .map((linea) => ({ linea, normalizada: normalizarLineaRapida(linea, contextoNormalizacion) }))
      .filter((x) => x.normalizada !== null);
  }, [textoCargaRapida, contextoNormalizacion]);

  /** Líneas cuya jugada quedó incoherente (sola sin número, guion no partible). */
  const incoherenciasCargaRapida = useMemo(
    () => revisarCoherenciaLineas(textoCargaRapida.split("\n")),
    [textoCargaRapida]
  );

  /**
   * Revision de la columna CABALLO contra los caballos de la carrera en
   * pantalla. Se recalcula una vez por carrera (no por fila): el topete de
   * apuntar un caballo que no corre es del modulo PURO `taquilla/caballos`.
   *
   * `maximoDeLaCarrera(caballosDeCarrera)` es 0 cuando la carrera no trae
   * ejemplares, y en ese caso manda el tope de 16 del modulo puro. Cuando si
   * trae, el conjunto de participantes es lo que manda (y una carrera de 18
   * caballos acepta el 18 sin tocar el tope).
   */
  const revisionCaballo = useMemo(
    () => (texto: string): RevisionCaballo =>
      revisarCaballo(texto, caballosDeCarrera, maximoDeLaCarrera(caballosDeCarrera)),
    [caballosDeCarrera]
  );

  /** Cliente del registro que coincide con el texto tipeado (exacto o único por prefijo). */
  const saldoCliente = (texto: string): ClienteVenta | null => {
    const t = texto.trim().toLowerCase();
    if (!t) return null;
    const exacto = clientes.find((c) => c.nombre.toLowerCase() === t);
    if (exacto) return exacto;
    const porPrefijo = clientes.filter((c) => c.nombre.toLowerCase().startsWith(t));
    return porPrefijo.length === 1 ? porPrefijo[0] : null;
  };

  /** Proyección de TODA la carga EN ORDEN: la fila 2 ya ve el saldo que dejó la
      fila 1 del mismo cliente. Alimenta la celda "Saldo/Max", el aviso de saldo
      y el color de recorte, para que la vista previa diga lo mismo que el cobro
      (que también descuenta en orden, ver saldosEnCurso.ts). */
  const proyeccionesCarga = useMemo(
    () => proyectarFilasEnOrden(filas, saldoCliente, comisionNum),
    // `saldoCliente` solo depende de `clientes`, que sí está en las deps.
    [filas, clientes, comisionNum]
  );

  /**
   * Indicador inline de la celda del cliente: ✅ si el disponible alcanza el
   * MONTO, ⚠️ "Max: X" si no, o "Saldo X" en azul/rojo según el signo.
   * Fallback: cobro proyectado cuando el cliente no está en el registro.
   *
   * "Disponible" = saldo + aval (misma regla que la RPC). Cuando el aval es lo
   * que topsa, se dice: si el caja ve "Max: 0" en un cliente con aval 500 y le
   * autoriza la jugada igual, la RPC la rechaza y pierde la venta; y al revés,
   * si le tapa el botón donde sí había aval, no se vende.
   */
  const infoCliente = (c: ClienteVenta | null, montoStr: string, cobroNeto: number): ReactNode => {
    if (!c) {
      if (cobroNeto > 0) {
        return <span className="truncate text-[9px] font-black text-emerald-600">Cobra {monedaFmt(cobroNeto)}</span>;
      }
      return null;
    }
    const saldo = saldoDeCliente(c);
    const aval = avalDeCliente(c);
    const libre = esClienteLibre(c);
    const disponible = limiteDeJugar(c);
    const monto = parseFloat(String(montoStr).replace(",", "."));
    const montoValido = Number.isFinite(monto) && monto > 0;
    const conAval = !libre && aval > 0;
    if (montoValido) {
      if (libre) {
        return <span className="truncate text-[9px] font-black text-emerald-600">✅ Libre · saldo {monedaFmt(saldo)}</span>;
      }
      if (disponible >= monto) {
        return conAval ? (
          <span className="truncate text-[9px] font-black text-emerald-600">
            ✅ Disp {monedaFmt(disponible)} · aval {monedaFmt(aval)}
          </span>
        ) : (
          <span className="truncate text-[9px] font-black text-emerald-600">✅ Saldo {monedaFmt(saldo)}</span>
        );
      }
      if (!libre && disponible <= 0) {
        return <span className="truncate text-[9px] font-black text-red-600">🟥 S/S · sin saldo</span>;
      }
      return (
        <span className="truncate text-[9px] font-black text-red-500">
          ⚠️ Max: {monedaFmt(disponible)}
          {conAval ? ` (${monedaFmt(saldo)} + ${monedaFmt(aval)})` : ""}
        </span>
      );
    }
    if (libre) {
      return <span className="truncate text-[9px] font-bold text-blue-600">Libre · saldo {monedaFmt(saldo)}</span>;
    }
    if (disponible <= 0) {
      return <span className="truncate text-[9px] font-bold text-red-600">🟥 S/S · sin saldo</span>;
    }
    const cls = saldo < 0 ? "text-red-600" : "text-blue-600";
    return conAval ? (
      <span className={`truncate text-[9px] font-bold ${cls}`}>
        Saldo {monedaFmt(saldo)} · aval {monedaFmt(aval)}
      </span>
    ) : (
      <span className={`truncate text-[9px] font-bold ${cls}`}>Saldo {monedaFmt(saldo)}</span>
    );
  };

  /**
   * Aviso resumido con menciones @número de Usuario 1 y Usuario 2 cuando un
   * jugador juega excedido de su saldo disponible.
   */
  const [observacionesExcesoCarrera, setObservacionesExcesoCarrera] = useState<ObservacionOrdenExceso[]>([]);

  const avisoSaldo = (f: FilaCarga, c1: ClienteVenta | null, c2: ClienteVenta | null): string | null => {
    const montoPedido = parseFloat(String(f.monto).replace(",", "."));
    if (!Number.isFinite(montoPedido) || montoPedido <= 0) return null;
    const disp1 = c1 ? (esClienteLibre(c1) ? Number.POSITIVE_INFINITY : Math.max(0, limiteDeJugar(c1))) : Number.POSITIVE_INFINITY;
    const disp2 = c2 ? (esClienteLibre(c2) ? Number.POSITIVE_INFINITY : Math.max(0, limiteDeJugar(c2))) : Number.POSITIVE_INFINITY;
    const excede1 = Boolean(c1 && !esClienteLibre(c1) && disp1 < montoPedido);
    const excede2 = Boolean(c2 && !esClienteLibre(c2) && disp2 < montoPedido);
    if (!excede1 && !excede2) return null;

    const nom1 = c1?.nombre ?? (f.cliente1.trim() || "Jugador 1");
    const nom2 = c2?.nombre ?? (f.cliente2.trim() || "Jugador 2");
    const tel1 = telefonoMencionCliente(c1);
    const tel2 = telefonoMencionCliente(c2);
    const menc1 = tel1 ? `@${tel1} (${nom1})` : `@${nom1}`;
    const menc2 = tel2 ? `@${tel2} (${nom2})` : `@${nom2}`;
    const montoAceptado = Math.max(0, Math.min(montoPedido, disp1, disp2));
    const quienExcede = excede1 && excede2 ? `${nom1} y ${nom2}` : excede1 ? nom1 : nom2;
    const jugada = [f.jugada.trim().toUpperCase(), f.caballo.trim() ? `(${f.caballo.trim()})` : ""]
      .filter(Boolean)
      .join(" ");
    return `${menc1} pidió ${monedaFmt(montoPedido)} con ${menc2} en ${jugada} → solo juegan ${monedaFmt(montoAceptado)} porque ${quienExcede} excede el saldo.`;
  };

  const copiarAvisoSaldo = async (i: number, texto: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiadoFila(i);
      setTimeout(() => setCopiadoFila((v) => (v === i ? null : v)), 1500);
    } catch {
      setAviso("⚠️ No se pudo copiar el aviso (permiso de portapapeles).");
    }
  };

  const copiarTodosAvisos = async (textos: string[]) => {
    if (!textos.length) return;
    try {
      await navigator.clipboard.writeText(textos.join("\n\n"));
      setCopiadoAvisos(true);
      setTimeout(() => setCopiadoAvisos(false), 1500);
    } catch {
      setAviso("⚠️ No se pudieron copiar los avisos (permiso de portapapeles).");
    }
  };

  /** Ejemplar que coincide con el número tipeado en CABALLO (tabla fija o central). */
  const ejemplarResuelto = useMemo(
    () => (texto: string) => {
      const t = texto.trim();
      if (!t || !caballosDeCarrera.length) return null;
      const n = t.replace(/[^0-9]/g, "");
      if (!n) return null;
      return caballosDeCarrera.find((c) => String(c.numero) === n) ?? null;
    },
    [caballosDeCarrera]
  );

  /** Convierte el comando de un ticket de vuelta a una fila editable (jugada + monto + caballo + clientes). */
  const desarmarTicket = (t: TicketTaquilla): FilaCarga => {
    const m = /^(\d+(?:[.,]\d+)?)\s+(.+)$/.exec(String(t.comando).trim());
    const base = filaVacia();
    if (m) return { ...base, monto: m[1].trim(), jugada: m[2].trim(), caballo: t.caballo ?? "", cliente1: t.cliente1 ?? "", cliente2: t.cliente2 ?? "" };
    return { ...base, jugada: String(t.comando).trim(), caballo: t.caballo ?? "", cliente1: t.cliente1 ?? "", cliente2: t.cliente2 ?? "" };
  };

  /** Ticket de la sesión que corresponde a una fila del panel (si existe). */
  const ticketSesionDeFila = (fila: FilaPreviewCarrera): TicketTaquilla | undefined =>
    ticketsDeCarrera.find(
      (t) =>
        (fila.ticketId != null && t.ticketId != null && String(t.ticketId) === fila.ticketId) ||
        (fila.soloSesion &&
          !fila.ticketId &&
          String(t.monto) === String(fila.monto) &&
          String(t.caballo ?? "").toUpperCase() === fila.caballo.toUpperCase() &&
          String(t.comando).replace(/^\d+(?:[.,]\d+)?\s+/, "").trim().toUpperCase() ===
            fila.jugada.toUpperCase())
    );

  /** Abre el modal propio de ✏️/🗑️ para una fila del panel (sin window.confirm). */
  const abrirAccionPreview = (fila: FilaPreviewCarrera, modo: "editar" | "eliminar") => {
    setAccionPreview({ fila, modo });
    setMotivoPreview("");
    setNotaAnularPreview(MOTIVOS_ANULACION[0]);
    setEdicionPreview(
      modo === "editar"
        ? {
            jugador1: fila.cliente1 || "",
            jugador2: fila.cliente2 || "",
            carrera: String(carrera),
            esAdelantada: Boolean(fila.esAdelantada),
            jugada: fila.jugada,
            caballo: fila.caballo,
            monto: fila.monto ? String(fila.monto) : "",
            notaPredefinida: NOTAS_PREDEFINIDAS_EDICION[0],
            motivoLibre: "",
          }
        : null
    );
  };

  const cerrarAccionPreview = () => {
    if (ocupadoPreview) return;
    setAccionPreview(null);
    setEdicionPreview(null);
    setMotivoPreview("");
  };

  /**
   * Confirma la acción del panel. Una jugada YA GUARDADA se corrige/anula con
   * el motor de recálculo (revierte la liquidación, aplica el cambio y vuelve a
   * liquidar). Una venta que solo vive en la sesión se saca del store.
   */
  const confirmarAccionPreview = async () => {
    const accion = accionPreview;
    if (!accion || ocupadoPreview) return;
    const fila = accion.fila;
    const motivo =
      accion.modo === "editar"
        ? componerNota(
            edicionPreview?.notaPredefinida === "OTRO" ? "" : edicionPreview?.notaPredefinida ?? "",
            edicionPreview?.motivoLibre || motivoPreview
          ) || "Corrección desde pre-visualización"
        : componerNota(
            notaAnularPreview === "OTRO" ? "" : notaAnularPreview,
            motivoPreview
          ) || "Anulación desde pre-visualización";
    const esPersistida = !!fila.ticketId;
    const ticketSesion = ticketSesionDeFila(fila);

    let campos: {
      cliente_juega_nombre?: string | null;
      cliente_consigue_nombre?: string | null;
      carrera?: number | null;
      es_adelantada?: boolean | null;
      nombre_jugada?: string | null;
      caballo?: string | null;
      ejemplar_numero?: number | null;
      monto_jugado?: number | null;
    } | null = null;
    if (accion.modo === "editar") {
      if (!edicionPreview) return;
      const jugador1 = edicionPreview.jugador1.trim().toUpperCase();
      if (!jugador1) {
        setAviso("⚠️ El Jugador 1 (Quien Juega) no puede quedar vacío.");
        return;
      }
      const nombre = edicionPreview.jugada.trim().toUpperCase();
      if (!nombre) {
        setAviso("⚠️ La jugada (nomenclatura) no puede quedar vacía.");
        return;
      }
      const caballo = edicionPreview.caballo.trim().toUpperCase();
      if (!caballo || !/\d/.test(caballo)) {
        setAviso("⚠️ Condición sine qua non: toda jugada debe tener ejemplar (número de caballo).");
        return;
      }
      const carreraNueva = Number(edicionPreview.carrera) || carrera;
      if (!Number.isFinite(carreraNueva) || carreraNueva < 1) {
        setAviso("⚠️ El número de carrera no es válido.");
        return;
      }
      const monto = Number(edicionPreview.monto.replace(",", "."));
      if (!Number.isFinite(monto) || monto <= 0) {
        setAviso("⚠️ El monto debe ser mayor a 0.");
        return;
      }
      const mCabNum = caballo.match(/\b(\d{1,2})\b/);
      campos = {
        cliente_juega_nombre: jugador1,
        cliente_consigue_nombre: edicionPreview.jugador2.trim() ? edicionPreview.jugador2.trim().toUpperCase() : null,
        carrera: carreraNueva,
        es_adelantada: edicionPreview.esAdelantada,
        nombre_jugada: nombre,
        caballo,
        ejemplar_numero: /^[0-9]+$/.test(caballo) ? Number(caballo) : mCabNum ? Number(mCabNum[1]) : null,
        monto_jugado: monto,
      };
    }

    setOcupadoPreview(true);
    try {
      if (!esPersistida) {
        // Solo sesión: no hay nada que anular en la base.
        if (ticketSesion) eliminarTicket(ticketSesion.id);
        if (accion.modo === "editar" && edicionPreview) {
          setFilas((f) => [
            {
              jugada: edicionPreview.jugada.trim().toUpperCase(),
              caballo: edicionPreview.caballo.trim().toUpperCase(),
              monto: edicionPreview.monto.trim(),
              cliente1: edicionPreview.jugador1.trim(),
              cliente2: edicionPreview.jugador2.trim(),
            },
            ...f,
          ]);
          setAviso(`✏️ Jugada devuelta a la tabla con los valores editados para cargarla.`);
        } else {
          setAviso(`🗑️ “${fila.jugada}” quitada de la sesión.`);
        }
        toastPreview(accion.modo === "editar" ? "Jugada devuelta a la tabla." : "Jugada quitada de la sesión.", "success");
        setAccionPreview(null);
        setEdicionPreview(null);
        setMotivoPreview("");
        return;
      }

      const usuario = usuarioVigente();
      const r =
        accion.modo === "editar"
          ? await corregirJugadaYRecalcular({
              id: fila.ticketId!,
              campos: campos!,
              motivo,
              usuario,
              hipodromo,
              carrera,
              fecha,
              tasaComision: comisionNum,
            })
          : await anularJugadaYRecalcular({
              id: fila.ticketId!,
              motivo,
              imagen: null,
              usuario,
              hipodromo,
              carrera,
              fecha,
              tasaComision: comisionNum,
            });

      if (!r.ok) {
        const texto = `❌ ${r.motivo}${r.errores.length ? ` · ${r.errores[0]}` : ""}`;
        setAviso(texto);
        toastPreview(texto, "error");
        return;
      }

      if (ticketSesion) eliminarTicket(ticketSesion.id);
      if (accion.modo === "eliminar") {
        setJugadasGuardadas((prev) =>
          prev.map((j) => (String(j.id) === String(fila.ticketId) ? { ...j, anulada: true } : j))
        );
      } else if (campos) {
        setJugadasGuardadas((prev) =>
          prev.map((j) =>
            String(j.id) === String(fila.ticketId)
              ? {
                  ...j,
                  cliente_juega_nombre: campos?.cliente_juega_nombre ?? j.cliente_juega_nombre,
                  cliente_consigue_nombre:
                    campos?.cliente_consigue_nombre !== undefined ? campos.cliente_consigue_nombre : j.cliente_consigue_nombre,
                  carrera: campos?.carrera ?? j.carrera,
                  es_adelantada: campos?.es_adelantada ?? j.es_adelantada,
                  nombre_jugada: campos?.nombre_jugada ?? j.nombre_jugada,
                  caballo: campos?.caballo ?? j.caballo,
                  ejemplar_numero: campos?.ejemplar_numero ?? j.ejemplar_numero,
                  monto_jugado: campos?.monto_jugado ?? j.monto_jugado,
                }
              : j
          )
        );
      }
      void recargarClientes();
      recargarRegistroCentral();
      await recargarJugadasGuardadas();
      const accionTexto = accion.modo === "editar" ? "Jugada corregida" : "Jugada anulada";
      const texto = `✅ ${accionTexto} y carrera recalculada · #${fila.ticketId} · Auditada.`;
      setAviso(texto);
      toastPreview(texto, "success");
      void registrarAuditoria(
        "GESTION_JUGADAS",
        accion.modo === "editar" ? "EDITAR_JUGADA_PREVIEW" : "ANULAR_JUGADA_PREVIEW",
        `${accionTexto} #${fila.ticketId} de ${nombreHipodromo} C${carrera} (${fecha}) por ${usuario}. Motivo: ${motivo}`
      );
      setAccionPreview(null);
      setEdicionPreview(null);
      setMotivoPreview("");
      void notificarTareaEjecutadaOperador({
        titulo: `${accionTexto} exitosamente`,
        mensaje: `El ticket #${fila.ticketId} de ${nombreHipodromo} C${carrera} (${fecha}) fue ${
          accion.modo === "editar" ? "corregido" : "anulado"
        } en la base de datos y los saldos disponibles se recalcularon al instante.`,
        detalles: [`Motivo registrado: ${motivo}`, `Estado de carrera y saldos actualizados en vivo`],
        variante: "success",
      });
    } finally {
      setOcupadoPreview(false);
    }
  };

  const ticketsDeCarrera = useMemo(
    () =>
      tickets.filter((t) => {
        if (t.carrera === undefined || Number(t.carrera) !== Number(carrera)) return false;
        if (!t.fecha || t.fecha !== fecha) return false;
        if (!t.hipodromo || hipoKey(t.hipodromo) !== hipoKey(hipodromo)) return false;
        return true;
      }),
    [tickets, carrera, fecha, hipodromo]
  );

  /**
   * BLOQUE 2 — Lee las jugadas YA guardadas de la carrera (aunque no estén en
   * la sesión). Es la fuente que mantiene el panel visible después de recargar
   * o liquidar; el store local solo completa la proyección de las Pendientes.
   */
  const recargarJugadasGuardadas = useCallback(async () => {
    if (!listoParaCargar) {
      setJugadasGuardadas([]);
      return;
    }
    setCargandoGuardadas(true);
    try {
      const r = await listarJugadasDeCarrera(hipodromo, carrera, fecha);
      setJugadasGuardadas(r.ok ? r.jugadas : []);
    } catch {
      setJugadasGuardadas([]);
    } finally {
      setCargandoGuardadas(false);
    }
  }, [listoParaCargar, hipodromo, carrera, fecha]);

  useEffect(() => {
    void recargarJugadasGuardadas();
  }, [recargarJugadasGuardadas]);

  /** Pizarra Oficial y Orden de Llegada (Raya) vigentes para la carrera actual. */
  const pizarraPuestosActual = useMemo<string[]>(() => {
    if (ultimaPizarra?.pizarra) {
      const pos = posicionesDePizarra(ultimaPizarra.pizarra);
      if (pos.length > 0) return pos;
    }
    if (centralDeCarrera?.ganadores && centralDeCarrera.ganadores.length > 0) {
      return centralDeCarrera.ganadores.map(String).filter(Boolean);
    }
    if (pizarraCentral?.pizarra) {
      return posicionesDePizarra(pizarraCentral.pizarra);
    }
    return [];
  }, [centralDeCarrera, ultimaPizarra, pizarraCentral]);

  const pizarraRayaActual = useMemo<string[]>(() => {
    if (ultimaPizarra?.pizarra) {
      const pos = posicionesRayaDePizarra(ultimaPizarra.pizarra);
      if (pos.length > 0) return pos;
    }
    if (centralDeCarrera?.orden_llegada_raya && centralDeCarrera.orden_llegada_raya.length > 0) {
      return centralDeCarrera.orden_llegada_raya.map(String).filter(Boolean);
    }
    if (pizarraCentral?.pizarra) {
      return posicionesRayaDePizarra(pizarraCentral.pizarra);
    }
    return pizarraPuestosActual;
  }, [centralDeCarrera, ultimaPizarra, pizarraCentral, pizarraPuestosActual]);

  const retiradosPizarraActual = useMemo<string[]>(() => {
    const enLlegada = new Set(
      [...pizarraPuestosActual, ...pizarraRayaActual].map((x) => String(x).trim()).filter(Boolean)
    );
    const deCentral = (centralDeCarrera?.retirados ?? []).map((x) => String(x).trim()).filter(Boolean);
    const deCaballos = caballosDeCarrera
      .filter((c) => c.retirado)
      .map((c) => String(c.numero).trim())
      .filter(Boolean);
    const deTablaOficial = parsearRetirados(String(tablaDeCarrera?.retirados_oficiales ?? ""));
    const deTablaCaballos = (tablaDeCarrera?.caballos ?? [])
      .filter((c) => c.retirado)
      .map((c) => String(c.numero).trim())
      .filter(Boolean);
    const deInput = parsearRetirados(retirados).map((x) => String(x).trim()).filter(Boolean);
    return parsearRetirados(
      [...deCentral, ...deCaballos, ...deTablaOficial, ...deTablaCaballos, ...deInput].join(",")
    ).filter((n) => !enLlegada.has(n));
  }, [centralDeCarrera, caballosDeCarrera, tablaDeCarrera, retirados, pizarraPuestosActual, pizarraRayaActual]);

  /** Filas del panel: persistidas (✅) + ventas de la sesión sin duplicar. */
  const filasPreview = useMemo(
    () => armarFilasPreview(jugadasGuardadas, ticketsDeCarrera, pizarraPuestosActual, retiradosPizarraActual),
    [jugadasGuardadas, ticketsDeCarrera, pizarraPuestosActual, retiradosPizarraActual]
  );
  const totalesPreview = useMemo(() => resumenPreview(filasPreview), [filasPreview]);
  const filasPreviewEnVivo = useMemo(() => filasPreview.filter((f) => !f.anulada && !f.esAdelantada), [filasPreview]);
  const filasPreviewAdelantadas = useMemo(() => filasPreview.filter((f) => !f.anulada && f.esAdelantada), [filasPreview]);

  useEffect(() => {
    if (cargandoGuardadas) return;
    const tieneActivas = filasPreview.some((f) => !f.anulada);
    setJugadasPorCarrera((prev) => {
      if (tieneActivas) {
        return prev.includes(carrera) ? prev : [...prev, carrera];
      }
      return prev.includes(carrera) ? prev.filter((c) => c !== carrera) : prev;
    });
  }, [filasPreview, carrera, cargandoGuardadas]);

  // Nombre del grupo "cabecera" de la relación: el grupo de WhatsApp vinculado
  // (p. ej. "MVP FUSION"), que es lo que la casa pone en el encabezado del
  // mensaje. Si todavía no hay grupo vinculado, cae al hipódromo. En el modal se
  // muestra además el grupo WhatsApp vinculado como "Grupo destino".
  const grupoCabecera = useMemo(
    () => grupoDestinoWhatsapp?.trim() || nombreHipodromo,
    [grupoDestinoWhatsapp, nombreHipodromo]
  );

  /**
   * Lista unificada de tickets (sesión + persistidas en BD, incluyendo jugadas
   * adelantadas: Tercios, Marcas, Tablas, Remates y Dupletas) para los reportes
   * preliminares (Ctrl+Q / Preliminar de Jugadas y Preliminar de Resultados).
   */
  const ticketsParaPreliminar = useMemo(() => {
    if (filasPreview.length > 0) {
      return filasPreview
        .filter((f) => !f.anulada)
        .map((f) => ({
          comando: `${f.monto} ${f.jugada}`,
          monto: f.monto,
          caballo: f.caballo,
          cliente1: f.cliente1,
          cliente2: f.cliente2 || null,
          esAdelantada: f.esAdelantada,
          precioTabla: f.precioTabla,
          cantidadTablas: f.cantidadTablas,
          premioPotencial: f.aposto2,
          ganador: f.estado === "Ganador" ? true : f.estado === "Perdedor" ? false : undefined,
        }));
    }
    return ticketsDeCarrera;
  }, [filasPreview, ticketsDeCarrera]);

  /** Plano de Jugadas (Ctrl+Q): formato TERCIOS con las jugadas en vivo y adelantadas. */
  const planoPreliminarTexto = useMemo(
    () =>
      mensajePlanoDeCarrera({
        hipodromo: nombreHipodromoParaMostrar(hipodromo),
        carrera,
        fecha,
        grupo: grupoCabecera,
        retirados: retirados.trim() || undefined,
        tickets: ticketsParaPreliminar,
      }),
    [carrera, fecha, grupoCabecera, hipodromo, retirados, ticketsParaPreliminar]
  );

  /**
   * Saldo ajustado (disponible = saldo + aval) por cliente, para el aviso del
   * preliminar: el mensaje lo imprime en *negrita* o como `S/S` si quedó en 0.
   * Se omiten los clientes LIBRES (sin tope): no tiene sentido marcarlos.
   */
  const saldosAjustados = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of clientes) {
      if (esClienteLibre(c)) continue;
      const d = limiteDeJugar(c);
      if (Number.isFinite(d)) m[c.nombre] = d;
    }
    return m;
  }, [clientes]);

  /** Preliminar de Resultados: texto con la pizarra cargada + veredicto GANA/
   *  PIERDE/PENDIENTE por jugada, SIN balance. Si todavía no se cargó la
   *  pizarra (Ctrl+Y) el texto queda vacío y la vista pide cargarla. */
  const preliminarResultadoTexto = useMemo(() => {
    const pizActiva = ultimaPizarra ?? pizarraCentral;
    return pizActiva
      ? mensajePreliminarDeCarrera({
          hipodromo: nombreHipodromoParaMostrar(hipodromo),
          carrera,
          fecha,
          grupo: grupoCabecera,
          retirados: retirados.trim() || undefined,
          pizarra: pizActiva.pizarra,
          dividendos: pizActiva.dividendos ?? null,
          tickets: ticketsParaPreliminar,
          tasaComision: comisionNum,
          saldos: saldosAjustados,
          observaciones: observaciones.trim() || undefined,
        })
      : "";
  }, [carrera, comisionNum, fecha, grupoCabecera, hipodromo, observaciones, retirados, saldosAjustados, ticketsParaPreliminar, ultimaPizarra, pizarraCentral]);

  const generarMensajeResultados = useCallback(
    (pizarra: PizarraResultados) => {
      const obsLimites = observacionesExcesoCarrera
        .map((o) => `${o.jugador} hasta ${Math.round(o.montoAceptado * 100) / 100}`)
        .filter(Boolean);
      const obsCombinadas = [...obsLimites, observaciones.trim()].filter(Boolean).join("\n") || undefined;
      const saldosFinales: Record<string, number> = {};
      for (const c of clientes) {
        saldosFinales[c.nombre] = saldoDeCliente(c);
      }
      const msg = construirMensajeResultadosAgente({
        hipodromo: nombreHipodromoParaMostrar(hipodromo),
        carrera,
        fecha,
        grupo: grupoCabecera,
        retirados: retirados.trim() || undefined,
        pizarra: pizarra.pizarra,
        dividendos: pizarra.dividendos ?? null,
        tickets: ticketsParaPreliminar,
        tasaComision: comisionNum,
        saldos: saldosAjustados,
        observaciones: obsCombinadas,
        saldosFinales,
      });
      setMensajeWhatsapp(msg);
      return msg;
    },
    [carrera, clientes, comisionNum, fecha, grupoCabecera, hipodromo, observaciones, observacionesExcesoCarrera, retirados, saldosAjustados, ticketsParaPreliminar]
  );

  const totalInvertidoSesion = useMemo(
    () => ticketsDeCarrera.reduce((a, t) => a + t.monto, 0),
    [ticketsDeCarrera]
  );

  /**
   * Jerarquía de cruces (Carrera → Cliente → Grupo):
   * el operador decide la carrera con el switch "Con Cruces"; aquí se resuelve
   * el cierre por (cliente, grupo). false ⇒ el cruce financiero SE FACTURA
   * normal (comisión por ticket, sin neteo) — ver pagarYCerrar.ts.
   */
  const permiteCrucesDe = useCallback(
    (nombre: string): boolean | undefined => {
      const clave = String(nombre ?? "").trim().toUpperCase();
      if (!clave) return undefined;
      const c = clientes.find((x) => String(x.nombre).trim().toUpperCase() === clave);
      if (c && c.permite_cruces === false) return false;
      if (c) {
        for (const gi of c.grupos) if (gruposMapa[String(gi)] === false) return false;
      }
      return true;
    },
    [clientes, gruposMapa]
  );

  const setFila = (i: number, patch: Partial<FilaCarga>) =>
    setFilas((f) => f.map((r, j) => (j === i ? { ...r, ...patch, error: undefined } : r)));

  /**
   * Modo Manual (bypass Gaceta IA): al cargar jugadas sobre una carrera vacía,
   *  · asegura el hipódromo tipeado en la BD (si no existe lo crea),
   *  · registra el número de carrera en resultados_carreras (Programada),
   *  · suma el número al semáforo local para que siga visible en la sesión.
   * Best-effort: un fallo de red no bloquea la carga local.
   */
  const consolidarManual = async () => {
    await asegurarHipodromo(hipodromo).catch(() => null);
  };

  /** Registra en 1 toque la cantidad de ejemplares de la carrera activa (ideal desde celular). */
  const registrarCantidadEjemplaresRapido = async (cant: number) => {
    if (!fecha || !hipodromo) return;
    const numC = carrera || 1;
    const r = await guardarCarreraCentral({
      fecha,
      hipodromo,
      carrera: numC,
      caballos: numerosEjemplares(cant),
      distancia: centralDeCarrera?.distancia ?? null,
      superficie: centralDeCarrera?.superficie ?? "ARENA",
      premio: centralDeCarrera?.premio ?? null,
      hora: centralDeCarrera?.hora ?? null,
    });
    if (r.ok) {
      if (!carrerasPorDia.includes(numC)) {
        setCarrerasPorDia((prev) => [...new Set([...prev, numC])].sort((a, b) => a - b));
      }
      recargarRegistroCentral();
      emitirToast(`🏇 C${numC} configurada con ${cant} ejemplares.`, "success");
    } else {
      emitirToast(r.error ?? "No se pudo registrar los ejemplares.", "error");
    }
  };

  /**
   * Interpreta dictado por voz / audio en Apuestas:
   * - Si dicta configuración de carrera/ejemplares/retirados ("carrera 3 con 12 ejemplares", "retirados 2 y 5"), lo aplica.
   * - Si dicta jugadas ("dos p del cinco cien pedro juan"), las normaliza y las agrega a Carga Individual.
   */
  const procesarDictadoAudioEnGestion = async (texto: string) => {
    const info = interpretarAudioCarrera(texto);
    const numDestino = info.carrera ? Number(info.carrera) : carrera;
    let hizoAccionCarrera = false;

    if (info.carrera && Number(info.carrera) !== carrera) {
      setCarrera(Number(info.carrera));
      setCarreraConfirmada(true);
      hizoAccionCarrera = true;
    }

    if (info.cantidadEjemplares || info.ejemplaresLista.length > 0) {
      const caballos =
        info.ejemplaresLista.length > 0
          ? info.ejemplaresLista.map((e) => ({ numero: e.numero, nombre: e.nombre }))
          : numerosEjemplares(info.cantidadEjemplares ?? 12);
      const r = await guardarCarreraCentral({
        fecha,
        hipodromo,
        carrera: numDestino,
        caballos,
        distancia: info.distancia ?? centralDeCarrera?.distancia ?? null,
        superficie: info.superficie ?? centralDeCarrera?.superficie ?? "ARENA",
        premio: info.premio ? Number(info.premio) : (centralDeCarrera?.premio ?? null),
        hora: info.hora ?? centralDeCarrera?.hora ?? null,
      });
      if (r.ok) {
        if (!carrerasPorDia.includes(numDestino)) {
          setCarrerasPorDia((prev) => [...new Set([...prev, numDestino])].sort((a, b) => a - b));
        }
        recargarRegistroCentral();
        emitirToast(`🎙️ C${numDestino} registrada por audio (${caballos.length} ejemplares).`, "success");
      }
      hizoAccionCarrera = true;
    }

    if (info.retirados) {
      setRetirados(info.retirados);
      const r = await aplicarRetirosCarrera({
        fecha,
        hipodromo,
        carrera: numDestino,
        numeros: parsearRetirados(info.retirados),
      });
      if (r.ok) {
        recargarRegistroCentral();
        void recargarJugadasGuardadas();
        emitirToast(`🎙️ Retirados aplicados en C${numDestino}: ${info.retirados}`, "info");
      }
      hizoAccionCarrera = true;
    }

    if (hizoAccionCarrera && !/\b(juega|da|pelo|pp|\d+\s*[pn]|\d+y\d+|\d+\/\d+|win|place|show)\b/i.test(info.textoNormalizado)) {
      return;
    }

    // Interpretar como línea(s) de jugada dictada por voz
    const bloque = formatearDictadoJugadas(texto);
    const nuevasFilas: FilaCarga[] = [];
    for (const lin of bloque.split(/\r?\n/)) {
      if (!lin.trim()) continue;
      const p = normalizarLineaRapida(lin, contextoNormalizacion);
      if (!p) continue;
      if (p.ok) {
        nuevasFilas.push({
          jugada: p.jugada,
          caballo: p.caballo,
          monto: p.monto,
          cliente1: p.cliente1,
          cliente2: p.cliente2,
        });
      } else {
        nuevasFilas.push({ ...filaVacia(), jugada: lin.trim(), error: p.motivo });
      }
    }

    if (nuevasFilas.length > 0) {
      setFilas((prev) => {
        const esSoloVacia =
          prev.length === 1 &&
          !prev[0].jugada &&
          !prev[0].caballo &&
          !prev[0].monto &&
          !prev[0].cliente1;
        return esSoloVacia ? nuevasFilas : [...prev, ...nuevasFilas];
      });
      emitirToast(`🎙️ ${nuevasFilas.length} jugada(s) interpretada(s) por voz.`, "success");
    }
  };

  /**
   * RETIROS DE LA CARRERA (data central). El campo "Retirados" ya no es un
   * texto decorativo: al aplicar, la lista pasa a `resultados_carreras` y desde
   * ahí el retiro incide en Tablas Fijas, Dupletas, Taquilla y el
   * Carreras del Día, reembolsa tickets pendientes y recalcula premios.
   */
  const aplicarRetiros = async () => {
    const lista = parsearRetirados(retirados);
    const r = await aplicarRetirosCarrera({ fecha, hipodromo, carrera, numeros: lista });
    if (!r.ok) {
      setAviso(`⚠️ No se pudieron centralizar los retiros: ${r.error ?? "sin conexión"}`);
      return;
    }
    setRetirados(lista.join(","));
    // Las jugadas sobre ejemplares retirados luego de cargarse NO se ocultan ni se eliminan de la sesión:
    // permanecen visibles como Empate (no se deciden) con resultado 0,00.
    // La lista de retiros se centralizó: se invalida el registro central y se
    // refrescan jugadas/clientes para reflejar anulaciones y reembolsos.
    recargarRegistroCentral();
    void recargarJugadasGuardadas();
    if (r.reembolsos > 0) void recargarClientes();
    setAviso(
      lista.length
        ? `⛔ Retirados C${carrera}: ${r.retirados.join(", ")} · ${r.tablasAfectadas} tabla(s) sincronizada(s)` +
            (r.reembolsos ? ` · ${r.reembolsos} jugada(s) anulada(s)/reembolsada(s)` : "") +
            (r.premios.length ? ` · premios recalculados: ${r.premios.length}` : "")
        : `✔ C${carrera}: ${r.texto}`
    );
  };

  /**
   * Presionar un ejemplar lo RETIRA (o lo rehabilita). El retiro pertenece a la
   * CARRERA: se escribe en la data central y desde ahí incide en Tablas Fijas,
   * Dupletas, Taquilla y Carreras del Día, reembolsa lo pendiente y
   * recalcula el premio de la tabla.
   */
  const alternarRetiroEjemplar = async (c: EjemplarTabla) => {
    const retirado = !c.retirado;
    const prevRetirados = retirados;
    const actuales = retiradosPizarraActual;
    const optimista = retirado
      ? parsearRetirados([...actuales, String(c.numero)].join(","))
      : actuales.filter((n) => n !== String(c.numero).trim());
    setRetirados(optimista.join(","));
    const r = await alternarRetiroCarrera({
      fecha,
      hipodromo,
      carrera,
      numero: c.numero,
      retirado,
      actuales,
    });
    if (!r.ok) {
      setRetirados(prevRetirados);
      setAviso(`⚠️ No se pudo centralizar el retiro de N°${c.numero}: ${r.error ?? "sin conexión"}`);
      return;
    }
    setRetirados(r.retirados.join(","));
    // Las jugadas sobre ejemplares retirados luego de cargarse permanecen visibles como Empate (no se deciden).
    recargarRegistroCentral();
    void recargarJugadasGuardadas();
    if (r.reembolsos > 0) void recargarClientes();
    setAviso(
      retirado
        ? `⛔ N°${c.numero} RETIRADO de C${carrera} · ${r.tablasAfectadas} tabla(s) sincronizada(s)` +
            (r.reembolsos ? ` · ${r.reembolsos} jugada(s) anulada(s)/reembolsada(s)` : "")
        : `↩ N°${c.numero} rehabilitado en C${carrera}.`
    );
  };

  /**
   * (3) Jugadas ADICIONALES / modificadas sobre una carrera que ya tiene jugadas
   * cargadas en la sesión: pide confirmación explícita. Sin este aviso, un Enter
   * mal tipeado agregaba ventas a una carrera que ya estaba armada.
   */
  const confirmarCargaAdicional = async (): Promise<boolean> => {
    if (ticketsDeCarrera.length === 0 && !jugadasPorCarrera.includes(carrera)) return true;
    const ok = await confirmar({
      titulo: "Carga adicional",
      mensaje: `⚠️ ${nombreHipodromo} C${carrera} ya tiene jugadas cargadas en esta sesión.\n\n¿Deseás cargar jugadas adicionales o modificar las existentes?`,
      tipo: "warning",
      textoConfirmar: "Cargar igual",
    });
    if (ok) return true;
    setAviso("Carga cancelada: no se modificó la carrera.");
    return false;
  };

  /**
   * Carga las filas válidas a la taquilla: cada una se VENDE de verdad contra
   * `club_vender_jugada` (ticket + descuento de saldo en una transacción). Solo
   * lo que se cobra queda en la sesión; una fila que no se puede cobrar queda en
   * rojo para corregir. El monto que se registra es el AUTORIZADO (topado por
   * saldo+aval), no el tipeado.
   */
  const cargarAtaquilla = async () => {
    if (principalSinGrupoSeleccionado) {
      setAviso(
        "⛔ El usuario/grupo Principal («Todos los grupos») es solo de gestión y no puede registrar jugadas. Seleccione primero un grupo activo en el selector superior."
      );
      emitirToast("Seleccione un grupo activo para registrar jugadas.", "warning");
      return;
    }
    if (!(await confirmarCargaAdicional())) return;
    let n = 0;
    const errores: string[] = [];
    const indicesError: number[] = [];
    const recortes: string[] = [];
    const descontado = new Map<string, number>();
    for (const f of filas) {
      if (!f.jugada.trim() && !f.monto.trim()) continue;
      if (!f.caballo.trim() || !/\d/.test(f.caballo)) {
        errores.push(`Fila ${filas.indexOf(f) + 1}: falta el ejemplar (condición sine qua non: toda jugada debe indicar caballo).`);
        indicesError.push(filas.indexOf(f));
        continue;
      }
      const rc = revisionCaballo(f.caballo);
      if (!rc.ok) {
        errores.push(`Fila ${filas.indexOf(f) + 1}: ${rc.motivo}`);
        indicesError.push(filas.indexOf(f));
        continue;
      }
      const v = valida(f, descontado);
      const c1 = saldoCliente(f.cliente1);
      const c2 = saldoCliente(f.cliente2);
      const montoPedidoFila = parseFloat(String(f.monto).replace(",", ".")) || 0;
      if (!v.ok) {
        if (c1 && montoPedidoFila > 0 && /S\/S|saldo/i.test(v.motivo)) {
          const tel1 = telefonoMencionCliente(c1);
          const tel2 = telefonoMencionCliente(c2);
          const nom1 = c1.nombre;
          const nom2 = c2?.nombre ?? (f.cliente2.trim() || "Banca");
          const menc1 = tel1 ? `@${tel1} (${nom1})` : `@${nom1}`;
          const menc2 = tel2 ? `@${tel2} (${nom2})` : `@${nom2}`;
          const jugEtiq = f.caballo.trim() ? `${f.jugada.trim().toUpperCase()} (${f.caballo.trim()})` : f.jugada.trim().toUpperCase();
          const resumenMencion = `${menc1} pidió ${monedaFmt(montoPedidoFila)} con ${menc2} en ${jugEtiq} → solo juegan 0 porque ${nom1} excede el saldo (S/S).`;
          recortes.push(resumenMencion);
          setObservacionesExcesoCarrera((prev) => [
            ...prev,
            {
              orden: prev.length + 1,
              jugador: nom1,
              contraparte: nom2,
              telefonoJugador: tel1 || null,
              telefonoContraparte: tel2 || null,
              jugada: jugEtiq,
              montoSolicitado: montoPedidoFila,
              montoAceptado: 0,
              montoExcedido: montoPedidoFila,
              disponibleAntes: 0,
              motivo: "Sin saldo disponible (S/S)",
              resumenMencion,
            },
          ]);
          setObservaciones((obsPrev) =>
            obsPrev.includes(resumenMencion) ? obsPrev : [obsPrev.trim(), resumenMencion].filter(Boolean).join(" · ")
          );
        }
        errores.push(`Fila ${filas.indexOf(f) + 1}: ${v.motivo}`);
        indicesError.push(filas.indexOf(f));
        continue;
      }
      if (!c1) {
        errores.push(`Fila ${filas.indexOf(f) + 1}: el CLIENTE 1 no está en el catálogo (no se puede cobrar).`);
        indicesError.push(filas.indexOf(f));
        continue;
      }
      const esWpsFila = v.modalidad === "AMERICANAS" || Boolean(tipoWps(v.tipo || f.jugada));
      if (!esWpsFila && !f.cliente2.trim()) {
        errores.push(`Fila ${filas.indexOf(f) + 1}: falta el CLIENTE 2 (dador). Las jugadas se cargan con DOS clientes.`);
        indicesError.push(filas.indexOf(f));
        continue;
      }
      if (!esWpsFila && !c2) {
        errores.push(`Fila ${filas.indexOf(f) + 1}: el CLIENTE 2 no está en el catálogo (se exigen dos clientes).`);
        indicesError.push(filas.indexOf(f));
        continue;
      }
      const grupoId =
        grupoActivo != null && String(grupoActivo).trim() !== ""
          ? String(grupoActivo)
          : c1.grupo_id != null
            ? String(c1.grupo_id)
            : c1.grupos[0] != null
              ? String(c1.grupos[0])
              : null;
      if (v.reparto?.recortado) {
        const tel1 = telefonoMencionCliente(c1);
        const tel2 = c2 ? telefonoMencionCliente(c2) : null;
        const nom1 = c1.nombre;
        const nom2 = c2 ? c2.nombre : "CASA";
        const menc1 = tel1 ? `@${tel1} (${nom1})` : `@${nom1}`;
        const menc2 = tel2 ? `@${tel2} (${nom2})` : `@${nom2}`;
        const jugEtiq = f.caballo.trim() ? `${v.tipo} (${f.caballo.trim()})` : v.tipo;
        const exc = Math.max(0, round2(v.montoPedido - v.monto));
        const resumenMencion = `${menc1} pidió ${monedaFmt(v.montoPedido)} con ${menc2} en ${jugEtiq} → solo juegan ${monedaFmt(v.monto)} porque ${nom1} excede el saldo.`;
        recortes.push(resumenMencion);
        setObservacionesExcesoCarrera((prev) => [
          ...prev,
          {
            orden: prev.length + 1,
            jugador: nom1,
            contraparte: nom2,
            telefonoJugador: tel1 || null,
            telefonoContraparte: tel2 || null,
            jugada: jugEtiq,
            montoSolicitado: v.montoPedido,
            montoAceptado: v.monto,
            montoExcedido: exc,
            disponibleAntes: v.monto,
            motivo: `Excedido ${monedaFmt(exc)}`,
            resumenMencion,
          },
        ]);
        setObservaciones((obsPrev) =>
          obsPrev.includes(resumenMencion) ? obsPrev : [obsPrev.trim(), resumenMencion].filter(Boolean).join(" · ")
        );
      }
      /* Venta transaccional: si falla (saldo, grupo, red), nada se descuenta y
         la fila queda en rojo; si gana, el ticket ya está en `tickets_apuestas`. */
      const venta = await venderJugada({
        hipodromo,
        fecha,
        carrera,
        jugada: v.tipo,
        caballo: f.caballo.trim(),
        monto: v.monto,
        clienteId: String(c1.id),
        grupoId,
        clienteDador: f.cliente2.trim() || c2?.nombre || (esWpsFila ? "CASA" : null),
        comision: comisionNum,
        // El banquero se negocia por modalidad: las americanas W/P/S van como
        // 'WPS' (el `origen` del ticket sigue siendo 'TAQUILLA').
        modalidad: v.modalidad === "AMERICANAS" ? "WPS" : v.modalidad,
        idempotencia: claveIdempotenciaJugada(),
      });
      if (!venta.ok) {
        errores.push(`Fila ${filas.indexOf(f) + 1}: ${venta.error ?? "no se pudo registrar la venta"}`);
        indicesError.push(filas.indexOf(f));
        continue;
      }
      const mejorCobre = Math.max(v.cliente1?.cobroNeto ?? 0, v.cliente2?.cobroNeto ?? 0);
      const comisionMejor =
        v.cliente1 && v.cliente2 && (v.cliente2?.cobroNeto ?? 0) > (v.cliente1?.cobroNeto ?? 0)
          ? v.cliente2.comision
          : (v.cliente1?.comision ?? 0);
      /* La venta se cobró: lo autorizado baja de inmediato el saldo de los clientes
         tanto en esta tanda como en el estado reactivo local y caché global. */
      const riesgoC2 = calcularRiesgoCliente2(v.monto, v.tipo);
      descontado.set(String(c1.id), (descontado.get(String(c1.id)) ?? 0) + v.monto);
      if (c2 && riesgoC2 > 0) {
        descontado.set(String(c2.id), (descontado.get(String(c2.id)) ?? 0) + riesgoC2);
      }
      setClientes((prev) =>
        prev.map((cli) => {
          if (String(cli.id) === String(c1.id)) {
            return { ...cli, saldo_actual: round2(saldoDeCliente(cli) - v.monto) };
          }
          if (c2 && riesgoC2 > 0 && String(cli.id) === String(c2.id)) {
            return { ...cli, saldo_actual: round2(saldoDeCliente(cli) - riesgoC2) };
          }
          return cli;
        })
      );
      limpiarCacheClientesVenta();
      agregarTicket({
        comando: `${v.monto} ${v.tipo}`,
        monto: v.monto,
        caballo: f.caballo.trim() || undefined,
        gananciaProyectada: round2(mejorCobre - v.monto),
        comision: comisionMejor,
        cliente1: c1.nombre,
        cliente2: f.cliente2.trim() || c2?.nombre || undefined,
        cobro1: v.cliente1?.cobroNeto,
        cobro2: v.cliente2?.cobroNeto,
        fecha,
        hipodromo,
        carrera,
        ticketId: venta.ticketId,
        cliente1Id: String(c1.id),
        cliente2Id: c2 ? String(c2.id) : undefined,
        grupoId: grupoId ?? undefined,
        es_adelantada: modalidadTiempo === "ADELANTADA",
      });
      if (modalidadTiempo === "ADELANTADA" && venta.ticketId) {
        void marcarTicketsAdelantados([venta.ticketId], true);
      }
      n += 1;
    }
    if (n === 0) {
      if (indicesError.length > 0) {
        setFilas((fs) => fs.map((r, i) => (indicesError.includes(i) ? { ...r, error: errores.find((e) => e.startsWith(`Fila ${i + 1}`)) } : r)));
      }
      return setAviso("Carga al menos una jugada válida (JUGADA + MONTO). " + (errores[0] ?? ""));
    }
    if (modoManual) void consolidarManual();
    if (!jugadasPorCarrera.includes(carrera)) setJugadasPorCarrera((j) => [...j, carrera]);
    setFilas((fs) => {
      // Las filas con error NO se pierden: quedan en rojo ⚠️ para corregir y reenviar.
      const conservar = fs
        .map((r, i) => ({ r, i }))
        .filter(({ i }) => indicesError.includes(i))
        .map(({ r, i }) => ({ ...r, error: r.error ?? errores.find((e) => e.startsWith(`Fila ${i + 1}`)) }));
      return [...conservar, filaVacia()];
    });
    setAviso(
      `✅ ${n} jugada(s) registrada(s) y cobrada(s) en la taquilla (C${carrera}).` +
        (errores.length ? ` ${errores.length} fila(s) con error quedaron en rojo para corregir.` : "") +
        (recortes.length ? ` ⚠️ ${recortes.length} recortada(s) por saldo: ${recortes.join(" · ")}` : "")
    );
    // Las ventas debitaron saldo en la base: refrescar el catálogo local para que
    // la próxima fila tope contra el saldo REAL (no el viejo).
    void recargarClientes();
    // Bloque 2: las ventas recién cobradas ya están en `tickets_apuestas`, así
    // que el panel persistente se refresca y las muestra con ✅ Cargada.
    await recargarJugadasGuardadas();
  };

  const poblarCargaRapida = () => {
    const filasNuevas: FilaCarga[] = [];
    let ok = 0;
    let corregidas = 0;
    let aRevisar = 0;
    for (const { linea, normalizada: p } of previewCargaRapida) {
      if (!p) continue;
      if (p.ok) {
        /* Regla de la casa: SIEMPRE hay 2 clientes (quién juega + quién da),
           así que Cliente 2 vacío también es motivo de revisión. Los campos en
           "sin" nunca se inventan: la fila queda en rojo para que el operador
           la confirme o la complete. Cuando el catálogo no está cargado se
           conserva el comportamiento legacy (no se marca todo en rojo). */
        const conCatalogo = clientes.length > 0;
        const necesitaRevision =
          p.confianza.jugada === "sin" ||
          p.confianza.monto === "sin" ||
          p.confianza.caballo === "sin" ||
          (conCatalogo && p.confianza.cliente1 === "sin") ||
          (!/^(?:WIN|PLACE|SHOW)$/i.test(p.jugada) && conCatalogo && !p.cliente2.trim());
        filasNuevas.push({
          jugada: p.jugada,
          caballo: p.caballo,
          monto: p.monto,
          cliente1: p.cliente1,
          cliente2: p.cliente2,
          error: necesitaRevision
            ? "⚠️ Revisar: algún campo no se reconoció con seguridad." +
              (p.correcciones.length ? ` (${p.correcciones.join(" · ")})` : "")
            : undefined,
        });
        if (p.correcciones.length > 0) corregidas += 1;
        if (necesitaRevision) aRevisar += 1;
        ok += 1;
      } else {
        // Línea ilegible: NO se descarta — se pinta en rojo ⚠️ para que el
        // operador la corrija manualmente en la tabla antes de enviar a la BD.
        filasNuevas.push({ ...filaVacia(), jugada: linea.trim(), error: p.motivo });
      }
    }
    const ilegibles = filasNuevas.filter((f) => f.error).length;
    /* Un caballo que no corre no se descarta como la linea ilegible (esa si es
       irrecuperable sin releerla): la fila se conserva y se marca en rojo, como
       el parser hace con las suyas, para que el operador corrija el numero. */
    const conCaballoMalo = filasNuevas.filter((f) => !f.error && !revisionCaballo(f.caballo).ok);
    if (filasNuevas.length > 0) {
      setFilas(filasNuevas);
      setTextoCargaRapida("");
      setModalCargaRapida(false);
      setAviso(
        ok > 0
          ? `⚡ ${ok} fila(s) poblada(s) desde el bloque de texto.` +
              (corregidas ? ` 🔧 ${corregidas} con el texto ordenado automáticamente.` : "") +
              (aRevisar ? ` ⚠️ ${aRevisar} con campos dudosos quedaron en rojo para confirmar.` : "") +
              (ilegibles ? ` ⚠️ ${ilegibles} línea(s) ilegible(s) quedaron en rojo para corregir.` : "") +
              (conCaballoMalo.length
                ? ` 🐴 ${conCaballoMalo.length} con caballo que no corre en esta carrera.`
                : "")
          : `⚠️ Ninguna línea fue legible. ${ilegibles} fila(s) quedaron en rojo — corregí jugada y monto, o escribí el bloque con "JUGADA CABALLO MONTO CLIENTE1 [CLIENTE2]".`
      );
    } else {
      setAviso("⚠️ Pegá al menos una línea con una jugada para poder poblarla.");
    }
  };

  /**
   * Capa 2 (OPCIONAL): manda el bloque a la Edge Function `normalizar-jugadas` y
   * reemplaza el texto con la versión corregida. Si la IA no está configurada,
   * no hay red o falla, NO se pierde nada: se avisa y queda el resultado del
   * normalizador difuso local (Capa 1), que es el que ya ordena el bloque.
   */
  const corregirConIA = async () => {
    if (iaCargando) return;
    const lineas = textoCargaRapida.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lineas.length === 0) {
      emitirToast("Pegá al menos una línea para corregir con IA.", "warning");
      return;
    }
    setIaCargando(true);
    const res = await corregirLineasConIA(lineas, {
      clientes: clientes.map((c) => c.nombre),
      caballos: caballosDeCarrera.map((c) => ({ numero: String(c.numero), nombre: c.nombre })),
    });
    setIaCargando(false);
    if (!res.ok || !res.lineas) {
      emitirToast(`✨ IA no disponible: ${res.error ?? "sin respuesta"}. Se mantiene el normalizador local.`, "warning");
      return;
    }
    setTextoCargaRapida(res.lineas.join("\n"));
    emitirToast("✨ Texto corregido con IA. Revisá la vista previa antes de poblar.", "success");
  };

  /**
   * REGISTRA Y FINALIZA la carrera (escribe el resultado central, liquida y
   * cierra la tabla).
   *
   * Recibe la pizarra como argumento cuando el cierre viene del propio
   * «Confirmar resultados»: ahí el estado `ultimaPizarra` todavía no se
   * re-renderizó y llegaría en null. Sin argumento usa la de la sesión (botón
   * del modal / Ctrl+R).
   */
  /**
   * 🔄 RECALCULAR / RELIQUIDAR CARRERA (manual, para auditar/cuadrar).
   *
   * Fuerza una corrida COMPLETA del motor maestro `recalcularCarreraCompleta`:
   * revierte la liquidación universal, la re-aplica contra el resultado vigente
   * y re-liquidas las RPCs de tablas fijas, marcas, dupletas y remates. Sirve
   * para cuadrar cualquier diferencia pendiente de una carrera ya LIQUIDADA sin
   * tener que cargar una jugada nueva.
   */
  const recalcularCompleta = async () => {
    if (!listoParaCargar) return setAviso("Elija hipódromo y carrera para recalcular.");
    const r = await recalcularCarreraCompleta({
      hipodromo,
      carrera,
      fecha,
      tasaComision: comisionNum,
      usuario: usuarioVigente(),
    });
    void registrarAuditoria(
      "GESTION_JUGADAS",
      "RECALCULAR_CARRERA",
      `Recálculo completo de ${nombreHipodromo} C${carrera} (${fecha}) por ${usuarioVigente()}: ${r.motivo}`
    );
    setAviso(r.ok ? `🔄 ${r.motivo}` : `❌ ${r.motivo}${r.errores.length ? ` · ${r.errores.join(" | ")}` : ""}`);
    // Los saldos y el cuaderno del cliente cambian: refrescar para que el
    // estado de cuenta refleje al instante los cobros/pagos del recálculo.
    void recargarClientes();
    void recargarJugadasGuardadas();
  };

  /**
   * BLOQUE 1 — REVERSAR la liquidación de la carrera en curso.
   *
   * Deja la carrera ABIERTA de nuevo: devuelve el dinero acreditado (taquilla,
   * tablas fijas, marcas, dupletas), reabre remates/pollas y borra el resultado
   * central. Exige `gestion_jugadas:fn_reabrir_carrera`. NUNCA usa
   * `window.confirm`: pide confirmación con el modal propio.
   */
  const ejecutarReversar = async (): Promise<{ ok: boolean; motivo: string }> => {
    if (reversando) return { ok: false, motivo: "Ya hay una reversión en curso." };
    setReversando(true);
    try {
      const r = await reversarLiquidacionCarrera({
        hipodromo,
        carrera,
        fecha,
        usuario: usuarioVigente(),
        tasaComision: comisionNum,
      });
      setAviso(r.ok ? `🔄 ${r.motivo}` : `❌ ${r.motivo}${r.errores.length ? ` · ${r.errores.join(" | ")}` : ""}`);
      // La carrera vuelve a "Programada" y los saldos cambian: refrescar el
      // registro central (semáforos) y el catálogo de clientes.
      setReapertura(false);
      setPizarraCentral(null);
      setUltimaPizarra(null);
      if (filasPreview.some((f) => !f.anulada) || r.tickets > 0) {
        setJugadasPorCarrera((prev) => (prev.includes(carrera) ? prev : [...prev, carrera]));
      } else {
        setJugadasPorCarrera((prev) => prev.filter((c) => c !== carrera));
      }
      recargarRegistroCentral();
      void recargarClientes();
      void recargarJugadasGuardadas();
      setModalReversar(false);
      if (r.ok) {
        void notificarTareaEjecutadaOperador({
          titulo: "Liquidación Reversada",
          mensaje: `La liquidación de ${nombreHipodromo} C${carrera} (${fecha}) fue reversada. La carrera volvió a estado ABIERTA y los saldos fueron restituidos.`,
          detalles: [r.motivo],
          variante: "warning",
        });
      }
      return { ok: r.ok, motivo: r.motivo };
    } finally {
      setReversando(false);
    }
  };

  const ejecutarFinalizar = async (
    pizarraConfirmada?: PizarraResultados | null,
    abrirReporte = true
  ): Promise<{ ok: boolean; motivo: string }> => {
    const piz = pizarraConfirmada ?? ultimaPizarra;
    if (!piz) {
      setModalFinalizar(false);
      setReporteAlCerrarFinalizar(false);
      void abrirResultados();
      const motivo = "Primero cargá los resultados (Ctrl+Y o Ctrl+R) para liquidar.";
      setAviso(motivo);
      return { ok: false, motivo };
    }
    const pizarraConRet = {
      ...piz.pizarra,
      retirados:
        piz.pizarra.retirados && piz.pizarra.retirados.length > 0
          ? piz.pizarra.retirados
          : retiradosPizarraActual,
    };
    // ÍTEM 1 — Re-apertura: liquida SÓLO las jugadas agregadas DESPUÉS de la
    // liquidación original. A propósito NO reescribe el resultado central ni
    // vuelve a cerrar la tabla, y los tickets ya decididos no se tocan
    // (`aplicarLiquidacionSaldos` es idempotente por estado). La re-apertura
    // queda registrada en la auditoría.
    if (reapertura) {
      const s = await liquidarPendientesDeCarrera({
        hipodromo,
        carrera,
        pizarra: pizarraConRet,
        dividendos: dividendosDePizarra(piz),
        tasaComision: comisionNum,
        fecha,
      });
      void registrarAuditoria(
        "GESTION_JUGADAS",
        "REABRIR_LIQUIDADA",
        `Re-apertura de ${nombreHipodromo} C${carrera} (${fecha}) por ${usuarioVigente()}: ${s.motivo}`
      );
      for (const t of ticketsDeCarrera) eliminarTicket(t.id);
      setUltimaPizarra(null);
      setJugadasPorCarrera((j: number[]) => j.filter((c) => c !== carrera));
      setReapertura(false);
      setModalFinalizar(false);
      // La re-apertura no paga la carrera completa: no corresponde el Reporte.
      setReporteAlCerrarFinalizar(false);
      setAviso(s.ok ? `✅ ${s.motivo}` : `❌ ${s.motivo}`);
      // La re-apertura pagó premios: refrescar saldos para cargar más jugadas
      // contra el saldo REAL (si no, la RPC rechaza y la jugada no se toma).
      void recargarClientes();
      void recargarJugadasGuardadas();
      return { ok: s.ok, motivo: s.motivo };
    }
    // AUNQUE no haya jugadas EN SESIÓN, la carrera se registra y se liquida: las
    // jugadas vendidas en OTROS módulos (tablas fijas, marcas, dupletas,
    // taquilla) tienen que pagarse igual al registrar el resultado. Antes este
    // `return` temprano dejaba la tabla fija SIN liquidar cuando la carrera se
    // finalizaba desde acá sin tickets en pantalla — el pago no aparecía en el
    // reporte.
    setLiquidandoCarrera(true);
    try {
      // Ejecución en paralelo de cierre de carrera/tablas/marcas y liquidación de saldos
      // para máxima velocidad de respuesta y apertura inmediata del reporte exclusivo.
      const [r, s] = await Promise.all([
        liquidarCarreraYCerrarTabla({
          hipodromo,
          carrera,
          pizarra: pizarraConRet,
          fecha,
          dividendos: dividendosDePizarra(piz),
          premio_oficial: tablaDeCarrera?.premio_original ?? null,
          premio_recalculado: tablaDeCarrera?.premio_recalculado ?? null,
          tickets: ticketsDeCarrera.map((t) => ({
            comando: t.comando,
            monto: t.monto,
            caballo: t.caballo,
            cliente1: t.cliente1,
            cliente2: t.cliente2,
            permiteCruces: conCruces ? permiteCrucesDe(t.cliente1 ?? "") : false,
          })),
          crucesPuestos: opcionesCrucesPuestos,
          tasaComision: comisionNum,
        }),
        aplicarLiquidacionSaldos({
          hipodromo,
          carrera,
          pizarra: pizarraConRet,
          dividendos: dividendosDePizarra(piz),
          premio_por_tabla:
            piz.premio_por_tabla ?? tablaDeCarrera?.premio_recalculado ?? tablaDeCarrera?.premio_original ?? null,
          tasaComision: comisionNum,
          crucesPuestos: opcionesCrucesPuestos,
          fecha,
        }),
      ]);
      setResumen(r);
      const avisoMarcas = !r.marcas
        ? ""
        : r.marcas.ok
          ? (r.marcas.liquidados ?? 0) > 0
            ? ` · 🏷️ Marcas: ${r.marcas.liquidados} jugada(s) liquidada(s)`
            : ""
          : ` · ⚠️ Marcas: ${r.marcas.error ?? "no se pudo liquidar"}`;
      if (r.ok) {
        for (const t of ticketsDeCarrera) eliminarTicket(t.id);
        setPizarraCentral(piz);
        setUltimaPizarra(null);
        setJugadasPorCarrera((j: number[]) => j.filter((c) => c !== carrera));
        setResumen(r);
        setModalFinalizar(false);
        if (abrirReporte) {
          setModoExclusivoReporte(true);
          setMostrarReporteLiquidacion(true);
        }
        void recargarClientes();
        void recargarJugadasGuardadas();
        recargarRegistroCentral();
        if (s.errores.length) {
          setAviso(`✅ ${r.motivo}${avisoMarcas} · ⚠️ aviso de saldos: ${s.errores[0]}`);
          return { ok: true, motivo: `${r.motivo} · aviso de saldos: ${s.errores[0]}` };
        }
        const pizarraTxt =
          [piz.pizarra.primero, piz.pizarra.segundo, piz.pizarra.tercero, piz.pizarra.cuarto, piz.pizarra.quinto]
            .filter(Boolean)
            .join("-") || "Oficial";
        void notificarTareaEjecutadaOperador({
          titulo: `Carrera C${carrera} Liquidada`,
          mensaje: `${nombreHipodromo} · Carrera ${carrera} (${fecha}) ha sido liquidada y movida a la barra de Carreras Liquidadas.`,
          detalles: [`Pizarra oficial: ${pizarraTxt}`, r.motivo],
          variante: "success",
        });
      } else {
        void recargarJugadasGuardadas();
        recargarRegistroCentral();
      }
      setAviso(r.ok ? `✅ ${r.motivo}${avisoMarcas}` : `❌ ${r.motivo}`);
      return { ok: r.ok, motivo: r.motivo };
    } finally {
      setLiquidandoCarrera(false);
    }
  };

  /**
   * Ciclo completo de Pizarra por Agente (Regla 3):
   *  - "Pizarra: 5 - 2 - 8 - 1 - 4" / "Llegada 5,2,8,1,4" → liquida y devuelve Reporte WhatsApp con *💰 SALDOS*.
   *  - "Anular pizarra por variación" / "Reversar pizarra" → revierte pagos/cobros y restituye saldos.
   *  - "Nueva pizarra: 2 - 5 - 8 - 1 - 4" → reliquida y entrega el nuevo Reporte WhatsApp rectificado.
   */
  const ejecutarComandoAgentePizarra = async (textoDirecto?: string) => {
    const cmdTexto = String(textoDirecto ?? comandoPizarraInput ?? "").trim();
    if (!cmdTexto) return;
    if (!listoParaCargar) {
      setAviso("⚠️ Seleccione hipódromo y carrera antes de procesar la pizarra.");
      return;
    }

    const estadoPizarraActual = {
      liquidada: carreraLiquidada,
      llegada: pizarraPuestosActual.length > 0 ? pizarraPuestosActual : null,
    };

    const res = await ejecutarComandoPizarra(
      cmdTexto,
      {
        liquidar: async (_llegada, piz) => {
          const pizResultados: PizarraResultados = {
            pizarra: piz,
            empates: [],
            llenas: Object.keys(piz).length,
            dividendos: ultimaPizarra?.dividendos ?? pizarraCentral?.dividendos ?? null,
            matrizWps: ultimaPizarra?.matrizWps ?? pizarraCentral?.matrizWps ?? null,
          };
          setUltimaPizarra(pizResultados);
          const fin = await ejecutarFinalizar(pizResultados, true);
          return { ok: fin.ok, error: fin.ok ? undefined : fin.motivo };
        },
        reversar: async () => {
          const rev = await ejecutarReversar();
          return { ok: rev.ok, error: rev.ok ? undefined : rev.motivo };
        },
        mensajeResultados: async (_llegada, piz) => {
          limpiarCacheClientesVenta();
          const clientesFrescos = await listarClientesVenta().catch(() => clientes);
          const obsLimites = observacionesExcesoCarrera
            .map((o) => `${o.jugador} hasta ${Math.round(o.montoAceptado * 100) / 100}`)
            .filter(Boolean);
          const obsCombinadas = [...obsLimites, observaciones.trim()].filter(Boolean).join("\n") || undefined;
          const saldosFinales: Record<string, number> = {};
          for (const c of clientesFrescos) {
            saldosFinales[c.nombre] = saldoDeCliente(c);
          }
          return construirMensajeResultadosAgente({
            hipodromo: nombreHipodromoParaMostrar(hipodromo),
            carrera,
            fecha,
            grupo: grupoCabecera,
            retirados: retirados.trim() || undefined,
            pizarra: piz,
            dividendos: ultimaPizarra?.dividendos ?? pizarraCentral?.dividendos ?? null,
            tickets: ticketsParaPreliminar,
            tasaComision: comisionNum,
            saldos: saldosAjustados,
            observaciones: obsCombinadas,
            saldosFinales,
          });
        },
      },
      estadoPizarraActual
    );

    const textoCompleto = res.mensajeWhatsapp ? `${res.respuesta}\n\n${res.mensajeWhatsapp}` : res.respuesta;
    setRespuestaAgentePizarra(textoCompleto);
    if (res.mensajeWhatsapp) {
      setMensajeWhatsapp(res.mensajeWhatsapp);
      setVisorWhatsappTipo("resultados");
      setTextoVisorWhatsapp(res.mensajeWhatsapp);
      setAcuseReciboOperador(true);
    }
    if (!textoDirecto) setComandoPizarraInput("");
    if (res.accion === "ANULADA") {
      emitirToast(MENSAJE_PIZARRA_ANULADA, "warning");
    } else if (res.ok) {
      emitirToast("🏁 Pizarra liquidada y reporte WhatsApp generado.", "success");
    } else {
      emitirToast(res.respuesta, "error");
    }
  };

  const cerrarFinalizar = () => {
    setModalFinalizar(false);
    setResumen(null);
    // El flujo nuevo cierra la carrera al CONFIRMAR los resultados, así que el
    // Reporte (con su opción de WhatsApp) se abre recién acá: apilarlo con el
    // modal de cierre dejaba el reporte tapado sin aviso.
    if (reporteAlCerrarFinalizar) {
      setReporteAlCerrarFinalizar(false);
      setMostrarReporteLiquidacion(true);
    }
  };

  /** Ítem 1: abre la re-apertura de la carrera liquidada (con autorización). */
  const abrirReapertura = () => {
    if (!puedeReabrir) {
      setAviso("No tenés la capacidad para reabrir una carrera liquidada.");
      return;
    }
    setReapertura(true);
    setAviso("🟠 Re-apertura: cargá las jugadas nuevas y luego «Liquidar jugadas agregadas» (Ctrl+R).");
    void registrarAuditoria(
      "GESTION_JUGADAS",
      "REABRIR_LIQUIDADA_INICIO",
      `Re-apertura de ${nombreHipodromo} C${carrera} (${fecha}) por ${usuarioVigente()}.`
    );
    emitirToast("🟠 Carrera reabierta: se liquidará SÓLO lo agregado.", "warning");
  };

  /**
   * Confirmación al seleccionar una carrera:
   * - Si la carrera seleccionada no ha sido abierta: "¿ABRIR CARRERA X ?"
   * - Si ya estás en una carrera y vas a otra: "¿IR A CARRERA X ?"
   */
  const seleccionarCarreraConConfirmacion = async (
    n: number,
    info?: { abierta: boolean; estado?: string }
  ) => {
    if (carreraConfirmada && n === carrera) return;
    const estaAbierta =
      info?.abierta !== undefined
        ? info.abierta
        : carrerasPorDia.includes(n) || jugadasPorCarrera.includes(n);

    if (!estaAbierta) {
      const ok = await confirmar({
        titulo: `¿ABRIR CARRERA ${n} ?`,
        mensaje: `La Carrera ${n} (${nombreHipodromo}) aún no ha sido abierta. ¿Confirmas abrir la Carrera ${n}?`,
        tipo: "info",
        textoConfirmar: "Confirmar",
        textoCancelar: "No",
      });
      if (!ok) return;
    } else if (carreraConfirmada && n !== carrera) {
      const ok = await confirmar({
        titulo: `¿IR A CARRERA ${n} ?`,
        mensaje: `Estás en la Carrera ${carrera}. ¿Confirmas ir a la Carrera ${n} (${nombreHipodromo})?`,
        tipo: "info",
        textoConfirmar: "Confirmar",
        textoCancelar: "No",
      });
      if (!ok) return;
    } else if (!carreraConfirmada) {
      const ok = await confirmar({
        titulo: `¿ABRIR CARRERA ${n} ?`,
        mensaje: `¿Confirmas abrir la Carrera ${n} (${nombreHipodromo})?`,
        tipo: "info",
        textoConfirmar: "Confirmar",
        textoCancelar: "No",
      });
      if (!ok) return;
    }

    setCarrera(n);
    setCarreraConfirmada(true);
    if (!carrerasPorDia.includes(n)) {
      setCarrerasPorDia((prev) => [...new Set([...prev, n])].sort((a, b) => a - b));
    }
  };

  /** Confirmación antes de liquidar la carrera activa: "¿LIQUIDAR CARRERA X ?" */
  const solicitarLiquidarCarrera = async () => {
    if (!listoParaCargar || bloqueoLiquidacionActivo) return;
    const ok = await confirmar({
      titulo: `¿LIQUIDAR CARRERA ${carrera} ?`,
      mensaje: `¿Confirmas que deseas liquidar la Carrera ${carrera} (${nombreHipodromo})?`,
      tipo: "warning",
      textoConfirmar: "Confirmar",
      textoCancelar: "No",
    });
    if (!ok) return;
    void abrirResultados();
  };

  /** Confirmación antes de abrir la creación de nuevo cliente: "¿CREAR NUEVO CLIENTE ?" */
  const solicitarCrearNuevoCliente = async () => {
    const ok = await confirmar({
      titulo: "¿CREAR NUEVO CLIENTE ?",
      mensaje: "¿Confirmas que deseas crear un nuevo cliente?",
      tipo: "info",
      textoConfirmar: "Confirmar",
      textoCancelar: "No",
    });
    if (!ok) return;
    setModalCreacionRapidaCliente(true);
  };

  /** Escucha de acciones disparadas directamente desde el 🤖 Agente de IA */
  useEffect(() => {
    const onAgenteAccion = (ev: Event) => {
      const d = ((ev as CustomEvent).detail ?? {}) as Record<string, unknown>;
      const tipo = String(d.accion ?? "").trim();
      if (!tipo) return;
      if (d.fecha) setFecha(String(d.fecha));
      if (d.hipodromo) setHipodromo(String(d.hipodromo));
      if (d.carrera) {
        setCarrera(Number(d.carrera));
        setCarreraConfirmada(true);
      }
      switch (tipo) {
        case "abrir_liquidar_carrera":
          void abrirResultados();
          break;
        case "abrir_reporte_liquidacion":
          setModoExclusivoReporte(Boolean(d.exclusivo));
          setMostrarReporteLiquidacion(true);
          break;
        case "abrir_historial":
          setMostrarHistorial(true);
          break;
        case "abrir_agente_pizarra":
          setModalAgentePizarra(true);
          if (d.comando) {
            setComandoPizarraInput(String(d.comando));
            void ejecutarComandoAgentePizarra(String(d.comando));
          }
          break;
        case "abrir_control_cruces":
          setModalControlCruces(true);
          break;
        case "abrir_nuevo_cliente":
          setModalCreacionRapidaCliente(true);
          break;
        case "abrir_saldo_rapido":
          setModalSaldoRapido(true);
          break;
        case "abrir_carga_rapida":
          if (d.texto) setTextoCargaRapida(String(d.texto));
          setModalCargaRapida(true);
          break;
        case "abrir_editar_jugadas":
          setModalEditarJugadas(true);
          break;
        case "abrir_reversar":
          setModalReversar(true);
          break;
        case "recalcular_carrera":
          void recalcularCompleta();
          break;
        case "reabrir_carrera":
          abrirReapertura();
          break;
        case "recargar_saldos":
          void recargarClientes();
          void recargarJugadasGuardadas();
          recargarRegistroCentral();
          break;
        case "abrir_plano_preliminar":
          setMostrarPlanoPreliminar(true);
          break;
        case "abrir_comandos":
          setModalComandos(true);
          break;
        default:
          break;
      }
    };
    window.addEventListener("agente-ia-accion", onAgenteAccion);
    return () => window.removeEventListener("agente-ia-accion", onAgenteAccion);
  });

  return (
    <div className="w-full max-w-full overflow-x-hidden space-y-2 pb-14">
      {bloqueoLiquidacionActivo && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/60 backdrop-blur-[1px]">
          <div className="rounded-2xl border border-amber-400/50 bg-slate-900 px-6 py-4 text-center text-white shadow-2xl">
            <div className="text-lg font-black text-amber-400">
              {liquidandoCarrera
                ? `⏳ Liquidando ${nombreHipodromo} · C${carrera}…`
                : `🔒 Reporte de Liquidación Abierto (${nombreHipodromo} · C${carrera})`}
            </div>
            <p className="mt-1 text-xs font-semibold text-slate-300">
              {liquidandoCarrera
                ? "Procesando pizarra oficial y saldos en paralelo. Acciones bloqueadas temporalmente."
                : "Todas las acciones permanecen bloqueadas hasta cerrar el reporte de la carrera liquidada."}
            </p>
          </div>
        </div>
      )}

      {principalSinGrupoSeleccionado && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-amber-400 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-950 shadow-md">
          <div className="flex items-center gap-2.5">
            <span className="text-2xl">⚠️</span>
            <div>
              <div className="text-sm font-black text-amber-950 uppercase tracking-tight">
                El usuario/grupo Principal («Todos los grupos») es solo de gestión y no puede registrar jugadas.
              </div>
              <div className="text-xs font-medium text-amber-800 mt-0.5">
                Seleccione un grupo activo para cargar jugadas y movimientos a ese grupo:
              </div>
            </div>
          </div>
          <select
            value={grupoActivoValido ?? ""}
            onChange={(e) => {
              const val = e.target.value.trim();
              setGrupoActivo(val ? val : null);
            }}
            className="rounded-lg border-2 border-amber-500 bg-white px-3 py-1.5 text-xs font-black uppercase text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
          >
            <option value="">— Seleccionar grupo de trabajo —</option>
            {gruposVenta.map((g) => (
              <option key={String(g.id)} value={String(g.id)}>
                {g.nombre}
              </option>
            ))}
          </select>
        </div>
      )}

      {modalSaldoRapido && (
        <ModalGestionRapidaSaldo
          abierto={modalSaldoRapido}
          onCerrar={() => setModalSaldoRapido(false)}
          onGuardado={() => {
            void recargarClientes();
          }}
        />
      )}

      {modalCreacionRapidaCliente && (
        <ModalCreacionRapidaCliente
          abierto={modalCreacionRapidaCliente}
          onClose={() => setModalCreacionRapidaCliente(false)}
          onClienteCreado={() => {
            void recargarClientes();
          }}
          grupoIdDefault={grupoSesion}
        />
      )}

      {/* Modal dedicado de Control de Cruces de esta Carrera */}
      {modalControlCruces && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
            onClick={(e) => { if (e.target === e.currentTarget) setModalControlCruces(false); }}
        >
          <div className="w-full max-w-3xl overflow-hidden rounded-2xl border border-amber-300/40 bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950 px-5 py-3.5">
              <div className="flex items-center gap-2">
                <span className="text-xl">⚡</span>
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wider text-amber-300">
                    Control de Cruces de esta Carrera
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Las excepciones quedan aisladas a <b>{nombreHipodromo} · Carrera {carrera}</b>.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setModalControlCruces(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white transition"
                aria-label="Cerrar modal de control de cruces"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="max-h-[80vh] overflow-y-auto p-5 text-slate-100 space-y-4">
              {/* Con Cruces (otros productos) incorporado al modal de control de cruces */}
              <div className="rounded-xl border border-amber-400/50 bg-slate-800/95 p-4 shadow-lg space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700/60 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">🔀</span>
                    <div>
                      <h4 className="text-xs font-black text-amber-300 uppercase tracking-wide">
                        Modalidad Con Cruces (Otros Productos)
                      </h4>
                      <p className="text-[11px] text-slate-300">
                        Reembolsa la comisión sobre el monto cruzado en el saldo del jugador al liquidar.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setConCruces(!conCruces)}
                    className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-1.5 text-xs font-black uppercase tracking-wider transition ${
                      conCruces
                        ? "border-emerald-400 bg-emerald-600 text-white shadow-md shadow-emerald-900/30"
                        : "border-slate-600 bg-slate-700 text-slate-300 hover:bg-slate-600"
                    }`}
                  >
                    <span className={`h-2.5 w-2.5 rounded-full ${conCruces ? "bg-white animate-pulse" : "bg-slate-400"}`} />
                    <span>{conCruces ? "CON CRUCES (ACTIVO)" : "SIN CRUCES (INACTIVO)"}</span>
                  </button>
                </div>
                <div className="text-[11px] text-slate-400 space-y-1">
                  <p>
                    • <b className="text-slate-200">CON CRUCES:</b> Si un cliente gana y pierde en la misma carrera con productos combinados o cruzados, la comisión se calcula sobre la ganancia neta o se reembolsa el monto cruzado (Cuenta PUC: <code className="text-amber-300 font-mono">5.1.01.001</code>).
                  </p>
                  <p>
                    • <b className="text-slate-200">SIN CRUCES:</b> Cada jugada ganadora aporta su comisión individual a la casa sin deducción por cruce.
                  </p>
                </div>
              </div>
              {Object.values(crucesOverrideCarrera.todos ?? {}).some((value) => typeof value === "boolean") && (
                <div className="rounded-lg bg-amber-400/15 border border-amber-400/30 px-3 py-2 text-xs font-black text-amber-300 flex items-center gap-2">
                  <span>⚠️</span>
                  <span>Excepción activa solo en Carrera {carrera} para todos</span>
                </div>
              )}

              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-xl border border-slate-700 bg-slate-800/80 p-3.5">
                  <p className="mb-2 text-[10px] font-black uppercase tracking-wider text-slate-400">
                    Cruces en esta carrera (todos) · Grupo: {grupoReglasCruce.mismoEjemplar ? "Mismo sí" : "Mismo no"} / {grupoReglasCruce.diferenteEjemplar ? "Diferente sí" : "Diferente no"}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {([
                      ["mismoEjemplar", "⚡ Mismo Ejemplar"],
                      ["diferenteEjemplar", "⚡ Dif. Ejemplar"],
                    ] as const).map(([modalidad, texto]) => {
                      const activo = crucesOverrideCarrera.todos?.[modalidad] ?? grupoReglasCruce[modalidad];
                      return (
                        <button
                          key={modalidad}
                          type="button"
                          disabled={!grupoSesion || cargandoCrucesCarrera}
                          aria-pressed={activo}
                          onClick={() => void guardarOverrideActual({
                            ...crucesOverrideCarrera,
                            todos: { ...crucesOverrideCarrera.todos, [modalidad]: !activo },
                          })}
                          className={`rounded-full border px-3 py-1.5 text-xs font-black transition disabled:opacity-50 ${
                            activo ? "border-amber-300 bg-amber-400 text-slate-950 shadow-md" : "border-slate-600 bg-slate-800 text-slate-300 hover:border-amber-300"
                          }`}
                        >
                          {texto} (Solo esta carrera)
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-700 bg-slate-800/80 p-3.5">
                  <p className="mb-2 text-[10px] font-black uppercase tracking-wider text-slate-400">
                    Cruzar a un jugador en esta carrera o guardar permanente
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={jugadorCruce}
                      onChange={(e) => setJugadorCruce(e.target.value)}
                      className="min-w-40 flex-1 rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-xs font-medium text-white outline-none focus:border-amber-400"
                      aria-label="Jugador para configurar cruces"
                    >
                      <option value="">Buscar jugador…</option>
                      {clientes.map((cliente) => (
                        <option key={cliente.id} value={cliente.nombre}>{cliente.nombre}</option>
                      ))}
                    </select>
                    <label className="flex items-center gap-1 text-[10px] font-bold text-slate-300 cursor-pointer">
                      <input type="radio" name="alcance-cruce" checked={alcanceCruce === "carrera"} onChange={() => setAlcanceCruce("carrera")} className="accent-amber-400" />
                      Solo Carrera {carrera}
                    </label>
                    <label className="flex items-center gap-1 text-[10px] font-bold text-slate-300 cursor-pointer">
                      <input type="radio" name="alcance-cruce" checked={alcanceCruce === "permanente"} onChange={() => setAlcanceCruce("permanente")} className="accent-amber-400" />
                      Ficha permanente
                    </label>
                  </div>
                  {jugadorCruce && (
                    <div className="mt-3 space-y-2 border-t border-slate-700/60 pt-3">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                        {([
                          ["mismoEjemplar", "Cruzar Mismo Ejemplar"],
                          ["diferenteEjemplar", "Cruzar Diferentes Ejemplares"],
                        ] as const).map(([modalidad, texto]) => (
                          <label key={modalidad} className="flex items-center gap-1.5 text-xs font-bold text-slate-200 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={borradorCruceJugador[modalidad]}
                              onChange={(e) => setBorradorCruceJugador((v) => ({ ...v, [modalidad]: e.target.checked }))}
                              className="accent-amber-400 h-4 w-4 rounded"
                            />
                            {texto}
                          </label>
                        ))}
                      </div>
                      <div className="flex justify-end pt-1">
                        <button
                          type="button"
                          onClick={() => void guardarReglasJugador()}
                          disabled={!grupoSesion && alcanceCruce === "carrera"}
                          className="rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-black text-slate-950 hover:bg-amber-300 shadow-sm disabled:opacity-50"
                        >
                          Guardar {alcanceCruce === "carrera" ? `solo Carrera ${carrera}` : "en ficha"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex justify-end border-t border-slate-800 bg-slate-950 px-5 py-3">
              <button
                type="button"
                onClick={() => setModalControlCruces(false)}
                className="rounded-lg bg-slate-800 hover:bg-slate-700 px-4 py-1.5 text-xs font-bold text-slate-200 transition"
              >
                Listo / Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inputs superiores */}
      <div className="grid gap-1.5 rounded-xl border border-line bg-surface p-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto_minmax(0,1.1fr)_auto_auto]">
        <div>
          <label className="mb-0.5 block text-[9px] font-bold uppercase leading-none tracking-wide text-slate-500">1 · Fecha 📅</label>
          <DateInput
            value={fecha}
            onFechaChange={(val) => setFecha(val || hoyLocal())}
            className="w-full text-xs font-bold"
          />
        </div>
        <div>
          <label className="mb-0.5 block text-[9px] font-bold uppercase leading-none tracking-wide text-slate-500">2 · Hipódromo</label>
          <SearchableSelect
            options={hipodromosDelDia}
            value={hipodromo}
            onChange={setHipodromo}
            placeholder="Buscar hipódromo…"
          />
        </div>
        <div>
          <label className="mb-0.5 block text-[9px] font-bold uppercase leading-none tracking-wide text-slate-500">
            Retirados · C{carrera}
          </label>
          <div className="flex items-center gap-1">
            <input
              value={retirados}
              onChange={(e) => setRetirados(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && listoParaCargar) void aplicarRetiros();
              }}
              disabled={!listoParaCargar}
              placeholder='ej. "2,5"'
              className="w-24 rounded-md border border-line bg-surface px-2 py-1 text-[13px] leading-tight text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-slate-400"
            />
            <Button
              size="sm"
              className="shrink-0 !bg-gradient-to-r !from-red-500 !to-rose-600 !text-white"
              onClick={() => void aplicarRetiros()}
              disabled={!listoParaCargar}
              title={
                listoParaCargar
                  ? "Centraliza los retiros de la carrera y los propaga a todos los módulos"
                  : "Elija hipódromo y carrera para aplicar retiros"
              }
            >
              ⛔ Aplicar
            </Button>
          </div>
        </div>
        <div>
          <label className="mb-0.5 block text-[9px] font-bold uppercase leading-none tracking-wide text-slate-500">
            📝 Observaciones (al pie)
          </label>
          <input
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            placeholder="Nota que se anexa al pie del Resultado Preliminar"
            className="w-full rounded-md border border-line bg-surface px-2 py-1 text-[13px] leading-tight text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          />
        </div>
        <div>
          <label className="mb-0.5 block text-[9px] font-bold uppercase leading-none tracking-wide text-slate-500">COM %</label>
          <input
            value={comision}
            onChange={(e) => setComision(e.target.value.replace(/[^0-9.,]/g, ""))}
            inputMode="decimal"
            className="w-16 rounded-md border border-line bg-surface px-2 py-1 text-[13px] leading-tight text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          />
        </div>
        <div className="flex items-end gap-1.5 pb-1 whitespace-nowrap">
          <button
            type="button"
            onClick={() => void solicitarCrearNuevoCliente()}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-indigo-400/70 bg-indigo-600 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-white shadow-2xs transition hover:bg-indigo-500"
            title="Registrar nuevo cliente rápido con teléfono, código de usuario y saldo autorizado"
          >
            <span>👤+</span> Nuevo Cliente
          </button>
          <label className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-cyan-200 bg-cyan-50/60 px-2 py-1 text-[10px] font-black uppercase text-cyan-700" title="Permite cargar jugadas y registrar carreras aunque la Gaceta IA no haya extraído nada (sin bloquear).">
            <input
              type="checkbox"
              checked={modoManual}
              onChange={(e) => setModoManual(e.target.checked)}
              className="h-3.5 w-3.5 accent-cyan-600"
            />
            ✍️ Modo Manual
          </label>
        </div>
      </div>

      {!hipodromoElegido ? (
        <div className="rounded-2xl border border-dashed border-cyan-300 bg-cyan-50/60 px-4 py-3 text-center text-xs font-bold text-cyan-800">
          ① Seleccione el <b>hipódromo</b> (paso 2) para habilitar la carga de jugadas.
        </div>
      ) : (
        <>
          {!carreraConfirmada && (
            <div className="rounded-2xl border border-dashed border-emerald-300 bg-emerald-50/60 px-4 py-3 text-center text-xs font-bold text-emerald-800">
              ② Seleccione la <b>carrera</b> en el semáforo para habilitar la carga de jugadas.
            </div>
          )}
          <SemaforoCarreras
            hipodromo={hipodromo}
            fecha={fecha}
            carreras={carrerasPorDia}
            activa={carreraConfirmada ? carrera : null}
            manual={modoManual}
            carrerasConJugadas={
              filasPreview.some((f) => !f.anulada) && !jugadasPorCarrera.includes(carrera)
                ? [...jugadasPorCarrera, carrera]
                : jugadasPorCarrera
            }
            onSeleccionar={(n, info) => {
              void seleccionarCarreraConConfirmacion(n, info);
            }}
            accionDerecha={
              <>
                <button
                  type="button"
                  onClick={() => void solicitarLiquidarCarrera()}
                  disabled={!listoParaCargar || bloqueoLiquidacionActivo}
                  title={listoParaCargar ? "Carga/edita los resultados y liquida (un solo flujo: Ctrl+Y o Ctrl+R)" : "Elija hipódromo y carrera para liquidar"}
                  className={`${BTN_BARRA} bg-gradient-to-r from-success-600 to-emerald-500 text-white shadow-sm hover:brightness-110 disabled:opacity-40`}
                >
                  🏆 Liquidar Carrera
                </button>
                <button
                  type="button"
                  onClick={() => setModalAgentePizarra(true)}
                  disabled={bloqueoLiquidacionActivo}
                  title="🤖 Agente de Pizarra Oficial (Cambio de Pizarra · Liquidación · Variación · Saldos)"
                  className={`${BTN_BARRA} bg-indigo-600 text-white shadow-sm hover:bg-indigo-500 disabled:opacity-40`}
                >
                  🤖 Cambio de Pizarra
                </button>
              </>
            }
          />
        </>
      )}

      {/* Tabla de Carga Individual (clon 1:1 del legacy) */}
      {!listoParaCargar ? (
        <div className="rounded-2xl border border-dashed border-line bg-surface px-4 py-6 text-center">
          <p className="text-sm font-black text-slate-700">
            {hipodromoElegido ? "② Seleccione la carrera para cargar jugadas" : "① Seleccione el hipódromo para cargar jugadas"}
          </p>
          <p className="mt-1 text-xs font-semibold text-slate-500">
            {hipodromoElegido
              ? "Elija la carrera en el semáforo de arriba (o active ✍️ Modo Manual para una carrera sin Gaceta)."
              : "La carga de jugadas queda bloqueada hasta elegir el hipódromo (paso 2)."}
          </p>
        </div>
      ) : (
      <div className="rounded-2xl border border-line bg-surface p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xs font-black uppercase tracking-wide text-slate-700">Carga Individual</h3>
            <ToggleModalidadTiempo valor={modalidadTiempo} onChange={setModalidadTiempo} />
            <BotonDictadoAudio
              compacto
              etiqueta="🎙️ Dictar Jugada / Carrera"
              modo="jugadas"
              onTextoReconocido={(txt) => void procesarDictadoAudioEnGestion(txt)}
            />
          </div>
          <span className="flex items-center gap-2">
            <span className="inline-flex min-w-[3.5rem] items-center justify-center rounded-full border-2 border-indigo-200 bg-white px-4 py-1.5 text-2xl font-black uppercase leading-none tracking-widest text-indigo-900 shadow-md md:text-3xl">
              C{carrera}
            </span>
            <span className="text-[10px] font-semibold text-slate-500">
              <span className="normal-case">{nombreHipodromo}</span> · Retirados: {retirados.trim() || "—"}
            </span>
          </span>
        </div>

        {/* Barra móvil rápida cuando la carrera aún no tiene ejemplares registrados */}
        {caballosDeCarrera.length === 0 && (
          <div className="mb-2 flex flex-wrap items-center justify-between gap-1.5 rounded-xl border border-cyan-200 bg-cyan-50/70 px-2.5 py-1.5 text-[10px]">
            <span className="font-black uppercase tracking-wide text-cyan-800">
              📱 Configurar Ejemplares C{carrera} (1 toque):
            </span>
            <div className="flex flex-wrap items-center gap-1">
              {[6, 8, 10, 12, 14, 16].map((cant) => (
                <button
                  key={cant}
                  type="button"
                  onClick={() => void registrarCantidadEjemplaresRapido(cant)}
                  className="rounded-md border border-cyan-300 bg-white px-2 py-0.5 text-[10px] font-black text-cyan-800 shadow-2xs hover:bg-cyan-100 active:scale-95"
                >
                  {cant} ej.
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Modal dedicado de W.P.S. (Win, Place, Show) */}
        <ModalWpsApuestas
          abierto={modalWps}
          onCerrar={() => setModalWps(false)}
          grupoId={grupoSesion}
          nombreGrupo={grupoCabecera}
          hipodromo={nombreHipodromo}
          carrera={carrera}
          gruposDisponibles={gruposVenta.map((g) => ({ id: g.id, nombre: g.nombre }))}
          onCargarApuestas={(apuestas: ApuestaWpsParseada[]) => {
            const nuevasFilas: FilaCarga[] = apuestas.map((ap) => ({
              jugada: ap.modalidad,
              caballo: ap.ejemplar,
              monto: String(ap.monto),
              cliente1: ap.jugador,
              cliente2: "",
            }));
            setFilas((prev) => {
              const esSoloVacia =
                prev.length === 1 &&
                !prev[0].jugada &&
                !prev[0].caballo &&
                !prev[0].monto &&
                !prev[0].cliente1;
              return esSoloVacia ? nuevasFilas : [...prev, ...nuevasFilas];
            });
            setAviso(`🏇 Se cargaron ${nuevasFilas.length} jugadas WPS a la tabla de carga.`);
          }}
        />


        {/* Panel lateral de ejemplares (tabla fija publicada o Carreras del Día) */}
        <div className={caballosDeCarrera.length ? "flex flex-col gap-2 lg:flex-row" : ""}>
          {caballosDeCarrera.length > 0 && (
            <aside className="shrink-0 rounded-xl border border-line bg-white p-1.5 shadow-sm lg:w-[20%]">
              <p className="px-1 pb-1 text-[9px] font-black uppercase leading-none tracking-wide text-slate-500">
                🐎 Ejemplares ({caballosDeCarrera.length})
              </p>
              <ul className="max-h-60 divide-y divide-line/60 overflow-y-auto">
                {caballosDeCarrera.map((c, ci) => (
                  <li key={ci}>
                    <button
                      type="button"
                      onClick={() => void alternarRetiroEjemplar(c)}
                      title={
                        c.retirado
                          ? `Quitar el retiro de N°${c.numero} (se propaga a todos los módulos)`
                          : `Retirar N°${c.numero} (se propaga a todos los módulos)`
                      }
                      className={`flex w-full cursor-pointer items-center gap-1 px-1 py-0 text-left leading-none hover:bg-amber-50 ${
                        c.retirado ? "bg-red-50/60" : ""
                      }`}
                    >
                      <HorseBadge num={c.numero} size="sm" retirado={c.retirado} />
                      <span
                        className={`min-w-0 flex-1 truncate text-[10px] font-bold uppercase leading-none ${
                          c.retirado ? "text-red-500 line-through" : "text-slate-700"
                        }`}
                      >
                        {c.nombre || <span className="text-slate-400">Nº {c.numero} (sin nombre)</span>}
                      </span>
                      {c.retirado ? (
                        <span className="shrink-0 rounded bg-red-100 px-1 text-[8px] font-black text-red-600">RET</span>
                      ) : (
                        <span className="shrink-0 text-[9px] font-black uppercase text-amber-600 opacity-0 transition-opacity hover:opacity-100 group-hover:opacity-100">
                          ⛔
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </aside>
          )}
          <div className={caballosDeCarrera.length ? "min-w-0 flex-1 overflow-x-auto" : "w-full overflow-x-auto"}>
            <table className="w-full min-w-[560px] sm:min-w-0 table-fixed border-collapse text-[11px]">
          <thead>
            <tr className="gj-cabecera text-white">
              <th className="w-[3%] border-r border-slate-700 px-1 py-0.5 text-left text-[9px] font-bold uppercase leading-none">#</th>
              <th className="w-[3%] border-r border-slate-700 px-1 py-0.5 text-center text-[9px] font-bold uppercase leading-none">X</th>
              <th className="w-[16%] border-r border-slate-700 px-1 py-0.5 text-left text-[9px] font-bold uppercase leading-none">Jugada</th>
              <th className="w-[10%] border-r border-slate-700 px-1 py-0.5 text-left text-[9px] font-bold uppercase leading-none">Caballo</th>
              <th className="w-[10%] border-r border-slate-700 px-1 py-0.5 text-right text-[9px] font-bold uppercase leading-none">Monto</th>
              <th className="w-[29%] border-r border-slate-700 px-1 py-0.5 text-left text-[9px] font-bold uppercase leading-none">Cliente 1</th>
              <th className="w-[29%] px-1 py-0.5 text-left text-[9px] font-bold uppercase leading-none">Cliente 2</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/70">
            {filas.map((f, i) => {
              const enCurso = proyeccionesCarga[i];
              const v = enCurso ? enCurso.proyeccion : valida(f);
              const ejemplar = ejemplarResuelto(f.caballo);
              const rc = revisionCaballo(f.caballo);
              const caballoInvalido = !rc.ok;
              const rep = v.ok ? v.reparto : null;
              const recortado = !!rep?.recortado;
              const aviso = avisoSaldo(f, enCurso?.cliente1 ?? null, enCurso?.cliente2 ?? null);
              return (
                <tr key={i} className={`align-middle ${f.error ? "bg-red-50" : ""}`} title={f.error ?? undefined}>
                  <td className="gj-celda px-1 py-0.5 text-xs text-slate-400">
                    <span className="block truncate">
                      {f.error ? (
                        <span className="inline-flex items-center gap-1 text-red-500">
                          ⚠️ <span className="hidden text-[9px] font-bold">{f.error}</span>
                        </span>
                      ) : (
                        i + 1
                      )}
                    </span>
                  </td>
                  <td className="gj-celda px-1 py-0.5 text-center">
                    <div className="flex flex-col items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => setFilas((fs) => fs.filter((_, j) => j !== i))}
                        disabled={filas.length <= 1}
                        aria-label="Eliminar fila"
                        className="text-xs text-slate-300 hover:text-red-500"
                      >
                        ✕
                      </button>
                      {aviso && (
                        <button
                          type="button"
                          onClick={() => void copiarAvisoSaldo(i, aviso)}
                          aria-label="Copiar aviso de saldo"
                          title={`Copiar aviso para informar al jugador («Por saldo de …»):\n\n${aviso}`}
                          className="text-xs text-amber-500 hover:text-amber-700"
                        >
                          {copiadoFila === i ? "✅" : "📋"}
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="gj-celda px-1 py-0.5">
                    <input
                      value={f.jugada}
                      onChange={(e) => setFila(i, { jugada: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void cargarAtaquilla();
                        }
                      }}
                      placeholder="10/8 · 1p · 2n"
                      className="w-full rounded border border-line bg-white px-1 py-0.5 text-[11px] font-bold leading-tight text-slate-900 placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    />
                  </td>
                  <td className={`gj-celda px-1 py-0.5 ${caballoInvalido ? "bg-red-50" : ""}`}>
                    <input
                      value={f.caballo}
                      onChange={(e) => setFila(i, { caballo: e.target.value })}
                      placeholder="1 · 1,2x3"
                      inputMode="numeric"
                      aria-invalid={caballoInvalido}
                      title={
                        caballoInvalido
                          ? rc.motivo
                          : rep
                            ? `C1 ${monedaFmt(rep.lado1.riesgo)}` +
                              (rep.lado2.riesgo > 0 ? ` · C2 ${monedaFmt(rep.lado2.riesgo)}` : " · C2 da") +
                              (rep.avisos.length ? `\n${rep.avisos.join("\n")}` : "")
                            : ejemplar
                              ? `${ejemplar.numero} - ${ejemplar.nombre}`
                              : ""
                      }
                      className={`w-full rounded border bg-white px-1 py-0.5 text-[11px] font-semibold leading-tight text-slate-900 placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
                        caballoInvalido ? "border-red-400" : "border-line"
                      }`}
                    />
                    {caballoInvalido ? (
                      <span className="mt-0.5 block truncate text-[9px] font-black uppercase leading-none text-red-600">
                        No corre
                      </span>
                    ) : (
                      ejemplar && (
                        <span
                          className={`mt-0.5 block truncate text-[9px] font-bold leading-none ${
                            ejemplar.retirado ? "text-red-500 line-through" : "text-gray-500"
                          }`}
                        >
                          {ejemplar.numero} - {ejemplar.nombre}
                          {ejemplar.retirado ? " (RET)" : ""}
                        </span>
                      )
                    )}
                  </td>
                  <td className="gj-celda px-1 py-0.5">
                    <input
                      value={f.monto}
                      onChange={(e) => setFila(i, { monto: e.target.value })}
                      placeholder="0"
                      inputMode="decimal"
                      title={recortado ? `Se autoriza ${monedaFmt(v.ok ? v.monto : 0)} por saldo disponible` : undefined}
                      className={`w-full rounded border bg-white px-1 py-0.5 text-right text-[11px] font-black leading-tight text-slate-900 placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
                        recortado ? "border-amber-400 bg-amber-50" : "border-line"
                      }`}
                    />
                    {recortado && (
                      <span className="mt-0.5 block truncate text-[9px] font-black leading-none text-amber-700">
                        → {monedaFmt(v.ok ? v.monto : 0)}
                      </span>
                    )}
                  </td>
                  <td className="gj-celda px-1 py-0.5 align-middle">
                    <div className="flex flex-col gap-0.5">
                      <span className="block truncate leading-none">
                        {infoCliente(enCurso?.cliente1 ?? null, f.monto, v.ok && v.cliente1 ? v.cliente1.cobroNeto : 0)}
                        {enCurso && enCurso.cliente1 && Number.isFinite(enCurso.queda) && (
                          <span className="ml-1 text-[9px] font-bold text-slate-500">
                            · Queda: {monedaFmt(enCurso.queda)}
                          </span>
                        )}
                        {enCurso?.observacionExceso && (
                          <span className="ml-1 rounded bg-rose-100 px-1 text-[8px] font-black text-rose-700">
                            {enCurso.observacionExceso}
                          </span>
                        )}
                      </span>
                      <SearchableSelect
                        options={opcionesClientes}
                        value={f.cliente1}
                        onChange={(v) => setFila(i, { cliente1: v })}
                        placeholder="Cliente 1…"
                        allowCustom={false}
                        displayValue={f.cliente1}
                        className=""
                        inputClassName="w-full rounded-md border border-line bg-white px-1 py-0.5 text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                      />
                    </div>
                  </td>
                  <td className="gj-celda px-1 py-0.5 align-middle">
                    <div className="flex flex-col gap-0.5">
                      <span className="block truncate leading-none">
                        {infoCliente(enCurso?.cliente2 ?? null, f.monto, v.ok && v.cliente2 ? v.cliente2.cobroNeto : 0)}
                      </span>
                      <SearchableSelect
                        options={opcionesClientes}
                        value={f.cliente2}
                        onChange={(v) => setFila(i, { cliente2: v })}
                        placeholder="Cliente 2 (obligatorio)…"
                        allowCustom={false}
                        displayValue={f.cliente2}
                        className=""
                        inputClassName={`w-full rounded-md border bg-white px-1 py-0.5 text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
                          (f.jugada.trim() || f.monto.trim()) && !f.cliente2.trim()
                            ? "border-red-400 bg-red-50"
                            : "border-line"
                        }`}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Guard permiso="gestion_jugadas:btn_carga_rapida">
            <Button
              size="md"
              onClick={() => setModalCargaRapida(true)}
              className="z-10 !border-2 !border-amber-400 !bg-gradient-to-r !from-amber-400 !via-amber-500 !to-orange-500 !px-4 !py-2 !text-sm !font-black !uppercase !tracking-wide !text-slate-950 shadow-lg shadow-amber-500/30 transition-all hover:scale-[1.02] hover:!brightness-105"
            >
              ⚡ Carga Rápida <span className="ml-1.5 rounded-md bg-slate-950 px-2 py-0.5 text-[10px] font-black text-amber-300">TEXTO</span>
            </Button>
          </Guard>
          <Button size="sm" onClick={() => setFilas((f) => [...f, filaVacia()])}>＋ Agregar fila</Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setModalSaldoRapido(true)}
            className="!border-emerald-400 !bg-emerald-50 !font-black !text-emerald-800 hover:!bg-emerald-100"
          >
            💵 Gestión Rápida de Saldos
          </Button>
          {(() => {
            const avisos = filas
              .map((f, i) => avisoSaldo(f, proyeccionesCarga[i]?.cliente1 ?? null, proyeccionesCarga[i]?.cliente2 ?? null))
              .filter((x): x is string => !!x);
            if (!avisos.length) return null;
            return (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void copiarTodosAvisos(avisos)}
                title="Copiar todos los avisos de saldo (una línea por jugada afectada)"
              >
                {copiadoAvisos ? "✅ Avisos copiados" : `📋 Copiar avisos de saldo (${avisos.length})`}
              </Button>
            );
          })()}
          <Button
            variant={principalSinGrupoSeleccionado ? "outline" : "success"}
            size="md"
            className="ml-auto"
            disabled={principalSinGrupoSeleccionado}
            title={
              principalSinGrupoSeleccionado
                ? "El usuario Principal debe seleccionar un grupo de trabajo antes de registrar jugadas"
                : "Cargar jugada(s) en la taquilla"
            }
            onClick={() => void cargarAtaquilla()}
          >
            {principalSinGrupoSeleccionado ? "🔒 Registro Bloqueado (Seleccione Grupo)" : "📥 Cargar jugada(s) en la taquilla"}
          </Button>
        </div>

        {/* Separación Estricta en 2 Tablas de 7 Columnas: En Vivo vs Jugadas Adelantadas (mismo ancho y altura de campos) */}
        {(() => {
          const renderBloqueFilas7Columnas = (
            listaFilas: FilaPreviewCarrera[],
            headerTheme: string
          ) => (
            <div className="w-full overflow-hidden rounded-lg border border-slate-200 bg-white">
              <table className="w-full table-fixed border-collapse text-[11px]">
                <colgroup>
                  <col className="w-[16%]" />
                  <col className="w-[9%]" />
                  <col className="w-[13%]" />
                  <col className="w-[18%]" />
                  <col className="w-[16%]" />
                  <col className="w-[9%]" />
                  <col className="w-[19%]" />
                </colgroup>
                <thead>
                  <tr className={`${headerTheme} h-8`}>
                    <th className="w-[16%] border-r border-slate-700 px-1.5 py-1 text-left text-[10px] font-bold uppercase truncate align-middle">
                      1. Quien Juega
                    </th>
                    <th className="w-[9%] border-r border-slate-700 px-1.5 py-1 text-right text-[10px] font-bold uppercase truncate align-middle">
                      2. Apostó
                    </th>
                    <th className="w-[13%] border-r border-slate-700 px-1.5 py-1 text-right text-[10px] font-bold uppercase truncate align-middle">
                      3. Resultado
                    </th>
                    <th className="w-[18%] border-r border-slate-700 px-1.5 py-1 text-center text-[10px] font-bold uppercase truncate align-middle">
                      4. Jugada
                    </th>
                    <th className="w-[16%] border-r border-slate-700 px-1.5 py-1 text-left text-[10px] font-bold uppercase truncate align-middle">
                      5. Quien Da
                    </th>
                    <th className="w-[9%] border-r border-slate-700 px-1.5 py-1 text-right text-[10px] font-bold uppercase truncate align-middle">
                      6. Apostó
                    </th>
                    <th className="w-[19%] px-1.5 py-1 text-right text-[10px] font-bold uppercase truncate align-middle">
                      7. Res. / Acc.
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {listaFilas.map((f, i) => {
                    const aposto1 = f.aposto1 ?? f.monto;
                    const aposto2 = f.aposto2 ?? f.monto;
                    const esFilaMarcaSinDecision =
                      (f.categoriaAdelantada === "marcas" || esMarca(f.jugada)) &&
                      (f.sinDecision || (f.lado1.estado === "RETIRADO" && f.estadoLiquidacion === "Liquidada"));
                    const res1Texto =
                      f.anulada
                        ? "ANULADA"
                        : esFilaMarcaSinDecision
                          ? "SIN DECISIÓN"
                          : f.lado1.estado === "RETIRADO"
                            ? f.esEmpateNini
                              ? `${monedaFmt(0)} (Empate)`
                              : "RETIRADO"
                            : f.lado1.estado === "GANO" && f.lado1.monto != null
                              ? `+${monedaFmt(Math.abs(f.lado1.monto))}`
                              : f.lado1.estado === "PERDIO"
                                ? `-${monedaFmt(Math.abs(f.lado1.monto ?? aposto1))}`
                                : `-${monedaFmt(aposto1)} (Pend.)`;
                    const res2Texto =
                      f.anulada
                        ? "ANULADA"
                        : esFilaMarcaSinDecision
                          ? "SIN DECISIÓN"
                          : f.lado2.estado === "RETIRADO"
                            ? f.esEmpateNini
                              ? `${monedaFmt(0)} (Empate)`
                              : "RETIRADO"
                            : f.lado2.estado === "GANO" && f.lado2.monto != null
                              ? `+${monedaFmt(Math.abs(f.lado2.monto))}`
                              : f.lado2.estado === "PERDIO"
                                ? `-${monedaFmt(Math.abs(f.lado2.monto ?? aposto2))}`
                                : `-${monedaFmt(aposto2)} (Pend.)`;

                    return (
                      <tr
                        key={f.clave}
                        className={`h-8 align-middle ${f.anulada ? "bg-amber-50/70 line-through opacity-75" : "bg-white hover:bg-slate-50"}`}
                      >
                        <td className="h-8 px-1.5 py-1 font-bold text-slate-800 truncate align-middle" title={f.cliente1}>
                          <span className="mr-1 text-[9px] font-normal text-slate-400">#{i + 1}</span>
                          {f.cliente1 || "—"}
                        </td>
                        <td className="h-8 px-1.5 py-1 text-right font-mono text-[11px] font-bold text-slate-800 truncate align-middle">
                          {monedaFmt(aposto1)}
                        </td>
                        <td className="h-8 px-1.5 py-1 text-right font-mono text-[10px] font-bold truncate align-middle" title={res1Texto}>
                          <span
                            className={
                              f.lado1.estado === "GANO"
                                ? "text-emerald-700"
                                : f.lado1.estado === "PERDIO"
                                  ? "text-rose-600"
                                  : f.lado1.estado === "RETIRADO"
                                    ? "text-slate-600"
                                    : "text-amber-700"
                            }
                          >
                            {res1Texto}
                          </span>
                        </td>
                        <td className="h-8 px-1.5 py-1 text-center font-mono text-[10px] font-black text-indigo-950 truncate align-middle" title={`${f.jugada} ${f.caballo ? `#${f.caballo}` : ""}`}>
                          {(() => {
                            const esFilaMarca = f.categoriaAdelantada === "marcas" || esMarca(f.jugada);
                            const esFilaTabla =
                              f.categoriaAdelantada === "tablas" ||
                              esTablaFija(f.jugada) ||
                              /^TABLA\b|^TF\b/i.test(f.jugada);

                            if (esFilaMarca) {
                              const pareoCab = extraerPareoMarca({
                                jugada: f.jugada,
                                caballo: f.caballo,
                              }).caballoPareo;
                              const lados = ladosDePareo(String(pareoCab || f.caballo || ""));
                              if (lados) {
                                const numsA = numerosDeCaballo(lados.juega);
                                const numsB = numerosDeCaballo(lados.da);
                                return (
                                  <span className="inline-flex items-center justify-center gap-0.5 align-middle">
                                    {numsA.map((n, idx) => (
                                      <span
                                        key={`ma-${n}-${idx}`}
                                        className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded border px-1 text-[10px] font-black leading-none shadow-2xs ${colorDiscoNumero(n)}`}
                                      >
                                        {n}
                                      </span>
                                    ))}
                                    <span className="mx-1 font-sans text-[10px] font-black text-slate-700">
                                      x
                                    </span>
                                    {numsB.map((n, idx) => (
                                      <span
                                        key={`mb-${n}-${idx}`}
                                        className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded border px-1 text-[10px] font-black leading-none shadow-2xs ${colorDiscoNumero(n)}`}
                                      >
                                        {n}
                                      </span>
                                    ))}
                                  </span>
                                );
                              }
                              const numsSolos = numerosDeCaballo(pareoCab || f.caballo);
                              return (
                                <span className="inline-flex items-center justify-center gap-0.5 align-middle">
                                  {numsSolos.map((n, idx) => (
                                    <span
                                      key={`ms-${n}-${idx}`}
                                      className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded border px-1 text-[10px] font-black leading-none shadow-2xs ${colorDiscoNumero(n)}`}
                                    >
                                      {n}
                                    </span>
                                  ))}
                                </span>
                              );
                            }

                            if (esFilaTabla) {
                              const numCab = extraerNumeroTablaFija({
                                jugada: f.jugada,
                                caballo: f.caballo,
                              });
                              const nums = numerosDeCaballo(numCab || f.caballo);
                              const precio =
                                f.precioTabla && f.precioTabla > 0
                                  ? f.precioTabla
                                  : f.aposto1 ?? f.monto;
                              return (
                                <span className="inline-flex items-center justify-center gap-1 align-middle">
                                  {nums.length > 0 ? (
                                    nums.map((n, idx) => (
                                      <span
                                        key={`tf-${n}-${idx}`}
                                        className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded border px-1 text-[10px] font-black leading-none shadow-2xs ${colorDiscoNumero(n)}`}
                                      >
                                        {n}
                                      </span>
                                    ))
                                  ) : (
                                    <span className="font-bold text-slate-800">{numCab || f.caballo}</span>
                                  )}
                                  <span className="font-sans text-[10px] font-black text-slate-800">
                                    a {formatearPrecioCorto(precio)}
                                  </span>
                                </span>
                              );
                            }

                            return (
                              <>
                                {etiquetaJugada(f.jugada)} {f.caballo ? `· #${f.caballo.toUpperCase()}` : ""}
                              </>
                            );
                          })()}
                        </td>
                        <td className="h-8 px-1.5 py-1 font-bold text-slate-800 truncate align-middle" title={f.cliente2}>
                          {f.cliente2 || "—"}
                        </td>
                        <td className="h-8 px-1.5 py-1 text-right font-mono text-[11px] font-bold text-slate-800 truncate align-middle">
                          {monedaFmt(aposto2)}
                        </td>
                        <td className="h-8 px-1.5 py-1 text-right truncate align-middle" title={res2Texto}>
                          <span
                            className={`mr-1 font-mono text-[10px] font-bold ${
                              f.lado2.estado === "GANO"
                                ? "text-emerald-700"
                                : f.lado2.estado === "PERDIO"
                                  ? "text-rose-600"
                                  : f.lado2.estado === "RETIRADO"
                                    ? "text-slate-600"
                                    : "text-amber-700"
                            }`}
                          >
                            {res2Texto}
                          </span>
                          <button
                            type="button"
                            onClick={() => abrirAccionPreview(f, "editar")}
                            aria-label="Editar jugada"
                            title="Editar la jugada y recalcular la carrera"
                            className="text-[11px] text-slate-400 hover:text-primary-600"
                          >
                            ✏️
                          </button>
                          <button
                            type="button"
                            onClick={() => abrirAccionPreview(f, "eliminar")}
                            aria-label="Eliminar jugada"
                            title="Anular la jugada y recalcular la carrera"
                            className="ml-0.5 text-[11px] text-slate-400 hover:text-red-500"
                          >
                            🗑️
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );

          const renderTabla7Columnas = (
            tituloSeccion: string,
            subtituloSeccion: string,
            listaFilas: FilaPreviewCarrera[],
            esTablaAdelantada: boolean
          ) => {
            const borderTheme = esTablaAdelantada
              ? "border-amber-300 bg-amber-50/40"
              : "border-emerald-300 bg-emerald-50/30";
            const headerTheme = esTablaAdelantada
              ? "bg-amber-900 text-amber-50"
              : "bg-slate-900 text-white";
            const seccionesAdelantadas = esTablaAdelantada
              ? agruparAdelantadasPorSeccion(listaFilas)
              : [];

            const carreraLiquidadaVista =
              centralDeCarrera?.estado === "liquidada" ||
              (centralDeCarrera?.ganadores?.length ?? 0) > 0 ||
              filasPreview.some((f) => f.estadoLiquidacion === "Liquidada");
            const mostrarPizarraEnVivo =
              !esTablaAdelantada && carreraLiquidadaVista && pizarraPuestosActual.length > 0;
            const hayDistanciamientoEnVivo =
              mostrarPizarraEnVivo &&
              pizarraRayaActual.length > 0 &&
              pizarraRayaActual.join(",") !== pizarraPuestosActual.join(",");

            return (
              <div className={`mt-3 rounded-xl border ${borderTheme} p-2.5 shadow-xs`}>
                <div
                  className={`mb-1.5 flex flex-wrap items-center justify-between gap-2 px-1 ${
                    esTablaAdelantada ? "cursor-pointer select-none rounded-lg py-1 hover:bg-amber-100/50" : ""
                  }`}
                  onClick={esTablaAdelantada ? () => setAdelantadasAbierto((v) => !v) : undefined}
                >
                  <p className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wide text-slate-800">
                    {esTablaAdelantada && (
                      <span
                        className={`inline-block text-[10px] text-amber-800 transition-transform ${
                          adelantadasAbierto ? "rotate-90" : ""
                        }`}
                      >
                        ▶
                      </span>
                    )}
                    <span>
                      {tituloSeccion} ({listaFilas.length}) ·{" "}
                      <span className="normal-case font-semibold text-slate-600">{subtituloSeccion}</span>
                    </span>
                  </p>
                  <span className="text-[10px] font-semibold text-slate-500">
                    {esTablaAdelantada
                      ? adelantadasAbierto
                        ? "▲ Ocultar acordeón · 7 Columnas Oficiales"
                        : "▼ Desplegar acordeón · 7 Columnas Oficiales"
                      : "7 Columnas Oficiales · ✏️ editar · 🗑️ anular"}
                  </span>
                </div>

                {(!esTablaAdelantada || adelantadasAbierto) && (
                  <>
                {mostrarPizarraEnVivo && (
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-gradient-to-r from-slate-50 via-white to-slate-50 px-3 py-2 shadow-2xs">
                    <div className="flex flex-wrap items-center gap-4">
                      {/* Pizarra Oficial (siempre visible cuando la carrera está liquidada) */}
                      <div className="flex items-center gap-2.5">
                        <div className="flex flex-col">
                          <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-blue-900">
                            <span>🏁</span> Pizarra Oficial
                          </span>
                          <span className="text-[8.5px] font-semibold uppercase tracking-wider text-slate-500">
                            {hayDistanciamientoEnVivo ? "Puestos · Marcas · WPS" : "Orden Oficial de Llegada"}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 border-l border-slate-200 pl-2.5">
                          {pizarraPuestosActual.map((num, idx) => (
                            <div key={`of-${idx}-${num}`} className="flex flex-col items-center">
                              <div
                                className={`flex h-7 w-7 items-center justify-center rounded-md border text-xs font-black shadow-2xs ${colorDiscoNumero(num)}`}
                                title={`Puesto Oficial ${idx + 1}º: Ejemplar #${num}`}
                              >
                                {num}
                              </div>
                              <span className="mt-0.5 text-[8.5px] font-black uppercase text-slate-600">
                                {idx + 1}º
                              </span>
                            </div>
                          ))}
                        </div>
                        {retiradosPizarraActual.length > 0 && (
                          <div className="flex items-center gap-1.5 border-l border-rose-200 pl-2.5">
                            <span className="text-[10px] font-black uppercase tracking-wider text-rose-700">
                              RET:
                            </span>
                            <div className="flex flex-wrap items-center gap-1">
                              {retiradosPizarraActual.map((num, idx) => (
                                <div
                                  key={`ret-of-${idx}-${num}`}
                                  className={`flex h-7 w-7 items-center justify-center rounded-md border text-xs font-black shadow-2xs ${colorDiscoNumero(num)}`}
                                  title={`Retirado: Ejemplar #${num}`}
                                >
                                  {num}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Orden de Llegada en Raya (solo cuando difiere de la Pizarra Oficial) */}
                      {hayDistanciamientoEnVivo && (
                        <div className="flex items-center gap-2.5 rounded-lg border border-amber-200 bg-amber-50/80 px-2.5 py-1">
                          <div className="flex flex-col">
                            <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-amber-900">
                              <span>🏇</span> Orden de Llegada (Raya)
                            </span>
                            <span className="text-[8.5px] font-bold uppercase tracking-wider text-amber-700">
                              ⚖️ Distanciamiento · Tablas Fijas / Remates
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 border-l border-amber-200 pl-2">
                            {pizarraRayaActual.map((num, idx) => (
                              <div key={`raya-${idx}-${num}`} className="flex flex-col items-center">
                                <div
                                  className={`flex h-6.5 w-6.5 items-center justify-center rounded-md border text-xs font-black shadow-2xs ${colorDiscoNumero(num)}`}
                                  title={`Cruza la Raya ${idx + 1}º: Ejemplar #${num}`}
                                >
                                  {num}
                                </div>
                                <span className="mt-0.5 text-[8px] font-black uppercase text-amber-800">
                                  {idx + 1}º
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {hayDistanciamientoEnVivo && (
                      <span className="rounded-md border border-amber-300 bg-amber-100 px-2 py-0.5 text-[9.5px] font-black text-amber-900">
                        ⚖️ Distanciamiento Oficial
                      </span>
                    )}
                  </div>
                )}
                {listaFilas.length === 0 ? (
                  <p className="rounded-lg bg-white/80 px-3 py-2 text-[11px] font-semibold text-slate-500">
                    {esTablaAdelantada
                      ? "Sin jugadas adelantadas (pre-jugadas) registradas en esta carrera."
                      : "Sin jugadas en vivo registradas en esta carrera."}
                  </p>
                ) : esTablaAdelantada ? (
                  <div className="space-y-2.5">
                    {seccionesAdelantadas.map((sec) => (
                      <div key={sec.categoria} className="space-y-1">
                        <div className="flex items-center justify-between rounded-md border border-amber-300/80 bg-amber-100/70 px-2.5 py-1">
                          <span className="text-[10px] font-black uppercase tracking-wider text-amber-950">
                            {sec.titulo}
                          </span>
                          <span className="text-[10px] font-bold text-amber-800">
                            {sec.filas.length} jugada(s)
                          </span>
                        </div>
                        {renderBloqueFilas7Columnas(sec.filas, headerTheme)}
                      </div>
                    ))}
                  </div>
                ) : (
                  renderBloqueFilas7Columnas(listaFilas, headerTheme)
                )}
                  </>
                )}
              </div>
            );
          };

          return (
            <>
              {renderTabla7Columnas(
                "⚡ JUGADAS EN VIVO (CARRERA ACTUAL)",
                `✅ ${totalesPreview.validadas} validada(s) · Modalidad: ${conCruces ? "CON CRUCES" : "SIN CRUCES"}`,
                filasPreviewEnVivo,
                false
              )}
              {renderTabla7Columnas(
                "⏳ JUGADAS ADELANTADAS (PRE-JUGADAS)",
                "Separadas estrictamente de las jugadas en vivo",
                filasPreviewAdelantadas,
                true
              )}
            </>
          );
        })()}

        {/* Visor Interactivo de Reportes WhatsApp (#reporteArea) + Acuse de Recibo */}
        <div id="reporteArea" className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const obsEnCurso: ObservacionOrdenExceso[] = proyeccionesCarga
                  .map((p, idx): ObservacionOrdenExceso | null => {
                    if (!p.observacionExceso || p.montoSolicitado <= 0) return null;
                    const nom1 = p.cliente1?.nombre ?? filas[idx]?.cliente1 ?? "Jugador 1";
                    const nom2 = p.cliente2?.nombre ?? filas[idx]?.cliente2 ?? "Banca";
                    const tel1 = telefonoMencionCliente(p.cliente1);
                    const tel2 = telefonoMencionCliente(p.cliente2);
                    const jug = filas[idx]?.caballo?.trim()
                      ? `${filas[idx].jugada.toUpperCase()} (${filas[idx].caballo.trim()})`
                      : (filas[idx]?.jugada ?? "").toUpperCase();
                    return {
                      orden: idx + 1,
                      jugador: nom1,
                      contraparte: nom2,
                      telefonoJugador: tel1 || null,
                      telefonoContraparte: tel2 || null,
                      jugada: jug,
                      montoSolicitado: p.montoSolicitado,
                      montoAceptado: p.montoAceptado,
                      montoExcedido: p.montoExcedido,
                      disponibleAntes: p.montoAceptado,
                      motivo: p.observacionExceso,
                      resumenMencion: p.observacionMencion ?? undefined,
                    };
                  })
                  .filter((x): x is ObservacionOrdenExceso => x !== null);
                const todasObs = [...observacionesExcesoCarrera, ...obsEnCurso];
                const txt = generarTextoPrejugadasWhatsapp({
                  grupo: grupoCabecera,
                  hipodromo: nombreHipodromo,
                  carrera,
                  fecha,
                  retirados: retirados.trim() || undefined,
                  jugadasEnVivo: filasPreviewEnVivo.map((f) => ({
                    juega: f.cliente1,
                    jugada: f.jugada,
                    caballo: f.caballo,
                    da: f.cliente2,
                    monto: f.monto,
                  })),
                  jugadasAdelantadas: filasPreviewAdelantadas.map((f) => ({
                    juega: f.cliente1,
                    jugada: f.jugada,
                    caballo: f.caballo,
                    precioTabla: f.precioTabla,
                    cantidadTablas: f.cantidadTablas,
                    da: f.cliente2,
                    monto: f.monto,
                  })),
                  observacionesExceso: todasObs,
                });
                setVisorWhatsappTipo("prejugadas");
                setTextoVisorWhatsapp(txt);
                setAcuseReciboOperador(false);
              }}
              className="rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-[11px] font-black text-indigo-800 hover:bg-indigo-100"
            >
              📋 Ver Reporte de Prejugadas (Preliminar WhatsApp + Imagen)
            </button>
            <button
              type="button"
              onClick={() => {
                const txt = preliminarResultadoTexto || planoPreliminarTexto;
                setVisorWhatsappTipo("resultados");
                setTextoVisorWhatsapp(txt);
                setAcuseReciboOperador(false);
              }}
              className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-[11px] font-black text-emerald-800 hover:bg-emerald-100"
            >
              🏁 Ver Preliminar de Resultados WhatsApp
            </button>
            <button
              type="button"
              onClick={() => {
                const txt = generarTextoSaldosWhatsapp({
                  grupo: grupoCabecera,
                  hipodromo: nombreHipodromo,
                  carrera,
                  fecha,
                  clientes: clientes.map((c) => ({
                    nombre: c.nombre,
                    saldoContable: saldoDeCliente(c),
                    aval: avalDeCliente(c),
                    riesgoEnCurso: 0,
                    disponible: limiteDeJugar(c),
                    libre: esClienteLibre(c),
                    modoJuego: (c as { modo_juego?: string }).modo_juego || (esClienteLibre(c) ? "libre" : "aval"),
                    tuvoMovimiento: true,
                  })),
                  filtro: filtroSaldosWsp,
                  separarPositivosNegativos: separarSaldosWsp,
                });
                setVisorWhatsappTipo("saldos");
                setTextoVisorWhatsapp(txt);
                setAcuseReciboOperador(false);
              }}
              className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-[11px] font-black text-amber-900 hover:bg-amber-100"
            >
              💰 Ver Reporte de Saldos Actualizados WhatsApp
            </button>
            <BotonIconoReporteSaldosVisual
              etiqueta="Reporte Visual de Disponibilidad y Alerta de Saldos"
              grupo={grupoCabecera}
              logoGrupo={(gruposVenta.find((g) => String(g.id) === String(grupoSesion)) as { logo_url?: string | null } | undefined)?.logo_url ?? null}
              hipodromo={nombreHipodromo}
              carrera={carrera}
              fecha={fecha}
              clientes={clientes.map((c) => ({
                id: c.id,
                nombre: c.nombre,
                telefono: telefonoMencionCliente(c) || null,
                saldoContable: saldoDeCliente(c),
                aval: avalDeCliente(c),
                riesgoEnCurso: 0,
                disponible: limiteDeJugar(c),
                libre: esClienteLibre(c),
                modoJuego: (c as { modo_juego?: string }).modo_juego || (esClienteLibre(c) ? "libre" : "aval"),
              }))}
            />
          </div>

          {visorWhatsappTipo && (
            <div className="mt-3 space-y-2 rounded-xl border border-slate-300 bg-white p-3">
              {visorWhatsappTipo === "saldos" && (
                <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 pb-2 text-xs">
                  <label className="flex items-center gap-1.5 font-bold text-slate-700">
                    Filtro de Saldos:
                    <select
                      value={filtroSaldosWsp}
                      onChange={(e) => {
                        const nuevo = e.target.value as FiltroSaldosWhatsapp;
                        setFiltroSaldosWsp(nuevo);
                        setTextoVisorWhatsapp(
                          generarTextoSaldosWhatsapp({
                            grupo: grupoCabecera,
                            hipodromo: nombreHipodromo,
                            carrera,
                            fecha,
                            clientes: clientes.map((c) => ({
                              nombre: c.nombre,
                              saldoContable: saldoDeCliente(c),
                              aval: avalDeCliente(c),
                              riesgoEnCurso: 0,
                              disponible: limiteDeJugar(c),
                              libre: esClienteLibre(c),
                              modoJuego: (c as { modo_juego?: string }).modo_juego || (esClienteLibre(c) ? "libre" : "aval"),
                              tuvoMovimiento: true,
                            })),
                            filtro: nuevo,
                            separarPositivosNegativos: separarSaldosWsp,
                          })
                        );
                      }}
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold"
                    >
                      <option value="todos">Mayores a 0 y menores a 0 (Ocultar los 0)</option>
                      <option value="positivos">Solo saldos &gt; 0 (Positivos · Ocultar 0)</option>
                      <option value="negativos">Solo saldos &lt; 0 (Negativos · Ocultar 0)</option>
                      <option value="min1">Saldos ≥ 1 (Ocultar 0)</option>
                      <option value="min1_libres">Saldos ≥ 1 + libres con movimiento</option>
                      <option value="min001_libres">Saldos ≥ 0,01 + libres con movimiento</option>
                    </select>
                  </label>
                  <label className="flex cursor-pointer items-center gap-1.5 font-bold text-slate-700">
                    <input
                      type="checkbox"
                      checked={separarSaldosWsp}
                      onChange={(e) => {
                        const sep = e.target.checked;
                        setSepararSaldosWsp(sep);
                        setTextoVisorWhatsapp(
                          generarTextoSaldosWhatsapp({
                            grupo: grupoCabecera,
                            hipodromo: nombreHipodromo,
                            carrera,
                            fecha,
                            clientes: clientes.map((c) => ({
                              nombre: c.nombre,
                              saldoContable: saldoDeCliente(c),
                              aval: avalDeCliente(c),
                              riesgoEnCurso: 0,
                              disponible: limiteDeJugar(c),
                              libre: esClienteLibre(c),
                              modoJuego: (c as { modo_juego?: string }).modo_juego || (esClienteLibre(c) ? "libre" : "aval"),
                              tuvoMovimiento: true,
                            })),
                            filtro: filtroSaldosWsp,
                            separarPositivosNegativos: sep,
                          })
                        );
                      }}
                    />
                    Separar 🟢 positivos / 🔴 negativos
                  </label>
                  <div className="ml-auto">
                    <BotonIconoReporteSaldosVisual
                      soloIcono
                      grupo={grupoCabecera}
                      logoGrupo={(gruposVenta.find((g) => String(g.id) === String(grupoSesion)) as { logo_url?: string | null } | undefined)?.logo_url ?? null}
                      hipodromo={nombreHipodromo}
                      carrera={carrera}
                      fecha={fecha}
                      clientes={clientes.map((c) => ({
                        id: c.id,
                        nombre: c.nombre,
                        telefono: telefonoMencionCliente(c) || null,
                        saldoContable: saldoDeCliente(c),
                        aval: avalDeCliente(c),
                        riesgoEnCurso: 0,
                        disponible: limiteDeJugar(c),
                        libre: esClienteLibre(c),
                        modoJuego: (c as { modo_juego?: string }).modo_juego || (esClienteLibre(c) ? "libre" : "aval"),
                      }))}
                    />
                  </div>
                </div>
              )}
              <textarea
                value={textoVisorWhatsapp}
                onChange={(e) => setTextoVisorWhatsapp(e.target.value)}
                rows={10}
                className="w-full rounded-lg border border-slate-300 bg-slate-50 p-2.5 font-mono text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-slate-700">
                  <input
                    type="checkbox"
                    checked={acuseReciboOperador}
                    onChange={(e) => setAcuseReciboOperador(e.target.checked)}
                    className="h-4 w-4 accent-emerald-600"
                  />
                  ✅ Acuse de Recibo: Confirmo lectura y verificación del reporte antes de enviar
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={!acuseReciboOperador}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(textoVisorWhatsapp);
                        emitirToast("📋 Reporte copiado al portapapeles para WhatsApp.", "success");
                      } catch {
                        emitirToast("No se pudo copiar al portapapeles.", "error");
                      }
                    }}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-black text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    📋 Copiar para WhatsApp
                  </button>
                  <button
                    type="button"
                    disabled={!acuseReciboOperador}
                    onClick={() => {
                      const url = `https://wa.me/?text=${encodeURIComponent(textoVisorWhatsapp)}`;
                      window.open(url, "_blank", "noopener,noreferrer");
                    }}
                    className="rounded-lg bg-green-700 px-3 py-1.5 text-xs font-black text-white hover:bg-green-600 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    📲 Abrir en WhatsApp
                  </button>
                  <button
                    type="button"
                    onClick={() => setVisorWhatsappTipo(null)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-black text-slate-600 hover:bg-slate-100"
                  >
                    ✕ Cerrar
                  </button>
                </div>
              </div>

              {/* Vista Gráfica Preliminar (misma línea gráfica que el reporte final con observaciones y menciones @número) */}
              {(visorWhatsappTipo === "prejugadas" || visorWhatsappTipo === "resultados") && (
                <div className="mt-4 space-y-2 border-t border-slate-200 pt-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50/70 px-3 py-2">
                    <span className="text-xs font-black text-blue-950">
                      🖼️ Reporte Visual Preliminar de Jugadas (En Vivo + Adelantadas + Observaciones @número)
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void exportarReporteCarreraImagen("PNG", `preliminar-${hipodromo}-c${carrera}-${fecha}`)}
                        className="rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-black text-white hover:bg-blue-600"
                      >
                        📸 Descargar Preliminar PNG
                      </button>
                      <button
                        type="button"
                        onClick={() => void exportarReporteCarreraImagen("JPG", `preliminar-${hipodromo}-c${carrera}-${fecha}`)}
                        className="rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs font-black text-blue-800 hover:bg-blue-100"
                      >
                        📸 JPG
                      </button>
                    </div>
                  </div>
                  <ReporteCarrera
                    datos={{
                      encabezado: {
                        grupo: grupoCabecera,
                        logoGrupo: (gruposVenta.find((g) => String(g.id) === String(grupoSesion)) as { logo_url?: string | null } | undefined)?.logo_url ?? null,
                        hipodromo: nombreHipodromo,
                        logoHipodromo: null,
                        carrera: `Carrera ${carrera}`,
                        fecha,
                        llegada: pizarraPuestosActual.map((puesto, idx) => ({
                          numero: puesto,
                          puesto: `${idx + 1}º`,
                          color: colorDiscoNumero(puesto),
                        })),
                        ...(pizarraRayaActual.length > 0 && pizarraRayaActual.join(",") !== pizarraPuestosActual.join(",")
                          ? {
                              llegadaRaya: pizarraRayaActual.map((puesto, idx) => ({
                                numero: puesto,
                                puesto: `${idx + 1}º`,
                                color: colorDiscoNumero(puesto),
                              })),
                            }
                          : {}),
                        retirados: retiradosPizarraActual,
                      },
                      liquidada: carreraLiquidada || tieneResultadoCargado || pizarraPuestosActual.length > 0,
                      jugadasVivo: [
                        ...filasPreviewEnVivo.map((f) => {
                          const estaLiquidada = carreraLiquidada || tieneResultadoCargado || pizarraPuestosActual.length > 0;
                          return {
                            juega: f.cliente1,
                            aposto: f.monto,
                            jugo: f.jugada,
                            caballo: f.caballo,
                            da: f.cliente2,
                            apostoDa: f.monto,
                            resultado: estaLiquidada
                              ? f.lado1.estado === "GANO"
                                ? f.lado1.monto
                                : f.lado1.estado === "PERDIO"
                                ? -f.lado1.monto
                                : f.lado1.estado === "RETIRADO" || f.lado1.estado === "ANULADA"
                                ? 0
                                : null
                              : null,
                            resultadoDa: estaLiquidada
                              ? f.lado2.estado === "GANO"
                                ? f.lado2.monto
                                : f.lado2.estado === "PERDIO"
                                ? -f.lado2.monto
                                : f.lado2.estado === "RETIRADO" || f.lado2.estado === "ANULADA"
                                ? 0
                                : null
                              : null,
                            esAdelantada: false,
                            esRetirado: f.lado1.estado === "RETIRADO" || f.lado2.estado === "RETIRADO" || f.esEmpateNini,
                            sinDecision: f.sinDecision,
                          };
                        }),
                        ...filasPreviewAdelantadas.map((f) => {
                          const estaLiquidada = carreraLiquidada || tieneResultadoCargado || pizarraPuestosActual.length > 0;
                          return {
                            juega: f.cliente1,
                            aposto: f.aposto1 ?? f.monto,
                            jugo: f.jugada,
                            caballo: f.caballo,
                            precioTabla: f.precioTabla,
                            da: f.cliente2,
                            apostoDa: f.aposto2 ?? f.monto,
                            resultado: estaLiquidada
                              ? f.lado1.estado === "GANO"
                                ? f.lado1.monto
                                : f.lado1.estado === "PERDIO"
                                ? -f.lado1.monto
                                : f.lado1.estado === "RETIRADO" || f.lado1.estado === "ANULADA"
                                ? 0
                                : null
                              : null,
                            resultadoDa: estaLiquidada
                              ? f.lado2.estado === "GANO"
                                ? f.lado2.monto
                                : f.lado2.estado === "PERDIO"
                                ? -f.lado2.monto
                                : f.lado2.estado === "RETIRADO" || f.lado2.estado === "ANULADA"
                                ? 0
                                : null
                              : null,
                            esAdelantada: true,
                            esRetirado: f.lado1.estado === "RETIRADO" || f.lado2.estado === "RETIRADO" || f.esEmpateNini,
                            sinDecision: f.sinDecision,
                          };
                        }),
                      ],
                      adelantadas: { tablas: [], marcas: [], tercios: [], otras: [] },
                      resumen: { ganan: [], pierden: [] },
                      observacionesOrdenExceso: [
                        ...observacionesExcesoCarrera,
                        ...proyeccionesCarga
                          .map((p, idx): ObservacionOrdenExceso | null => {
                            if (!p.observacionExceso || p.montoSolicitado <= 0) return null;
                            const nom1 = p.cliente1?.nombre ?? filas[idx]?.cliente1 ?? "Jugador 1";
                            const nom2 = p.cliente2?.nombre ?? filas[idx]?.cliente2 ?? "Banca";
                            const tel1 = telefonoMencionCliente(p.cliente1);
                            const tel2 = telefonoMencionCliente(p.cliente2);
                            const jug = filas[idx]?.caballo?.trim()
                              ? `${filas[idx].jugada.toUpperCase()} (${filas[idx].caballo.trim()})`
                              : (filas[idx]?.jugada ?? "").toUpperCase();
                            return {
                              orden: idx + 1,
                              jugador: nom1,
                              contraparte: nom2,
                              telefonoJugador: tel1 || null,
                              telefonoContraparte: tel2 || null,
                              jugada: jug,
                              montoSolicitado: p.montoSolicitado,
                              montoAceptado: p.montoAceptado,
                              montoExcedido: p.montoExcedido,
                              disponibleAntes: p.montoAceptado,
                              motivo: p.observacionExceso,
                              resumenMencion: p.observacionMencion ?? undefined,
                            };
                          })
                          .filter((x): x is ObservacionOrdenExceso => x !== null),
                      ],
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal propio ✏️/🗑️ de una jugada del panel (sin window.confirm) */}
        {accionPreview && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-4">
            <div className="w-full max-w-xl rounded-2xl border border-line bg-white p-4 shadow-2xl">
              <datalist id="clientes-preview-editar-datalist">
                {clientes.map((c) => (
                  <option key={c.id} value={c.nombre} />
                ))}
              </datalist>
              <p className="text-sm font-black text-slate-800">
                {accionPreview.modo === "editar" ? "✏️ Editar jugada cargada (todos los campos)" : "🗑️ Eliminar jugada cargada"}
              </p>
              <p className="mt-1 text-xs font-semibold text-slate-500">
                {nombreHipodromo} C{carrera} · {fecha} · Ticket #{accionPreview.fila.ticketId ?? "sesión"}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                La jugada se {accionPreview.modo === "editar" ? "corrige con todos los valores nuevos, ajusta los saldos de los jugadores" : "anula"} en la base y la carrera se recalcula
                automáticamente (revierte y vuelve a liquidar si estaba pagada).
              </p>

              {accionPreview.modo === "editar" && edicionPreview && (
                <div className="mt-3 space-y-2.5">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label className="block text-[10px] font-black uppercase text-slate-500">
                      Jugador 1 (Quien Juega)
                      <input
                        list="clientes-preview-editar-datalist"
                        value={edicionPreview.jugador1}
                        onChange={(e) => setEdicionPreview((v) => (v ? { ...v, jugador1: e.target.value.toUpperCase() } : v))}
                        className="mt-1 w-full rounded-md border border-line bg-white px-2 py-1 text-xs font-bold uppercase text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                      />
                    </label>
                    <label className="block text-[10px] font-black uppercase text-slate-500">
                      Jugador 2 (Quien Da / Contraparte)
                      <input
                        list="clientes-preview-editar-datalist"
                        value={edicionPreview.jugador2}
                        onChange={(e) => setEdicionPreview((v) => (v ? { ...v, jugador2: e.target.value.toUpperCase() } : v))}
                        placeholder="TAQUILLA"
                        className="mt-1 w-full rounded-md border border-line bg-white px-2 py-1 text-xs font-bold uppercase text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                      />
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    <label className="col-span-1 block text-[10px] font-black uppercase text-slate-500">
                      Carrera N°
                      <input
                        type="number"
                        min={1}
                        max={25}
                        value={edicionPreview.carrera}
                        onChange={(e) => setEdicionPreview((v) => (v ? { ...v, carrera: e.target.value.replace(/\D/g, "") } : v))}
                        className="mt-1 w-full rounded-md border border-line bg-white px-2 py-1 text-xs font-bold text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                      />
                    </label>
                    <label className="col-span-2 block text-[10px] font-black uppercase text-slate-500">
                      Jugada
                      <input
                        value={edicionPreview.jugada}
                        onChange={(e) => setEdicionPreview((v) => (v ? { ...v, jugada: e.target.value.toUpperCase() } : v))}
                        className="mt-1 w-full rounded-md border border-line bg-white px-2 py-1 text-xs font-bold uppercase text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                      />
                    </label>
                    <label className="col-span-1 block text-[10px] font-black uppercase text-slate-500">
                      Ejemplar *
                      <input
                        value={edicionPreview.caballo}
                        onChange={(e) => setEdicionPreview((v) => (v ? { ...v, caballo: e.target.value.toUpperCase() } : v))}
                        className="mt-1 w-full rounded-md border border-line bg-white px-2 py-1 text-xs font-bold uppercase text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                      />
                    </label>
                    <label className="col-span-1 block text-[10px] font-black uppercase text-slate-500">
                      Monto
                      <input
                        inputMode="decimal"
                        value={edicionPreview.monto}
                        onChange={(e) => setEdicionPreview((v) => (v ? { ...v, monto: e.target.value } : v))}
                        className="mt-1 w-full rounded-md border border-line bg-white px-2 py-1 text-xs font-bold text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                      />
                    </label>
                  </div>

                  <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-700">
                    <input
                      type="checkbox"
                      checked={edicionPreview.esAdelantada}
                      onChange={(e) => setEdicionPreview((v) => (v ? { ...v, esAdelantada: e.target.checked } : v))}
                    />
                    Modalidad Adelantada (Pre-jugada)
                  </label>

                  <label className="block text-[10px] font-black uppercase text-slate-500">
                    Motivo de modificación (listado predeterminado)
                    <select
                      value={edicionPreview.notaPredefinida}
                      onChange={(e) => setEdicionPreview((v) => (v ? { ...v, notaPredefinida: e.target.value } : v))}
                      className="mt-1 w-full rounded-md border border-line bg-white px-2 py-1 text-xs font-semibold text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    >
                      {NOTAS_PREDEFINIDAS_EDICION.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                      <option value="OTRO">✍️ Otro (introducir libremente)</option>
                    </select>
                  </label>

                  <label className="block text-[10px] font-black uppercase text-slate-500">
                    {edicionPreview.notaPredefinida === "OTRO"
                      ? "Introducir motivo libremente (obligatorio)"
                      : "Detalle adicional / observación libre (opcional)"}
                    <input
                      value={edicionPreview.motivoLibre}
                      onChange={(e) => setEdicionPreview((v) => (v ? { ...v, motivoLibre: e.target.value } : v))}
                      placeholder={
                        edicionPreview.notaPredefinida === "OTRO"
                          ? "Escriba el motivo de la modificación…"
                          : "Ej.: monto mal tipeado / cliente equivocado"
                      }
                      className="mt-1 w-full rounded-md border border-line bg-white px-2 py-1 text-xs font-semibold text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    />
                  </label>
                </div>
              )}

              {accionPreview.modo === "eliminar" && (
                <div className="mt-3 space-y-2">
                  <label className="block text-[10px] font-black uppercase text-slate-500">
                    Motivo de anulación (listado predeterminado)
                    <select
                      value={notaAnularPreview}
                      onChange={(e) => setNotaAnularPreview(e.target.value)}
                      className="mt-1 w-full rounded-md border border-line bg-white px-2 py-1 text-xs font-semibold text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    >
                      {MOTIVOS_ANULACION.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                      <option value="OTRO">✍️ Otro (introducir libremente)</option>
                    </select>
                  </label>
                  <label className="block text-[10px] font-black uppercase text-slate-500">
                    {notaAnularPreview === "OTRO" ? "Introducir motivo libremente (obligatorio)" : "Observación adicional (opcional)"}
                    <input
                      value={motivoPreview}
                      onChange={(e) => setMotivoPreview(e.target.value)}
                      placeholder="Detalle de la anulación…"
                      className="mt-1 w-full rounded-md border border-line bg-white px-2 py-1 text-xs font-semibold text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    />
                  </label>
                </div>
              )}

              <div className="mt-4 flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={cerrarAccionPreview} disabled={ocupadoPreview}>
                  Cancelar
                </Button>
                <Button
                  variant={accionPreview.modo === "editar" ? "success" : "danger"}
                  size="sm"
                  onClick={() => void confirmarAccionPreview()}
                  disabled={ocupadoPreview}
                >
                  {ocupadoPreview
                    ? "Procesando…"
                    : accionPreview.modo === "editar"
                      ? "Guardar y recalcular"
                      : "Anular y recalcular"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
      )}
      {aviso && <p className="mt-2 text-xs font-semibold text-slate-600">{aviso}</p>}

      {/* Sección inferior: Cabecera unificada de Apuestas (en una sola línea compacta) */}
      <div className="mt-2 flex flex-nowrap items-center justify-between gap-2 overflow-x-auto rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1 text-white shadow-sm whitespace-nowrap">
        <div className="flex min-w-0 items-center gap-1.5">
          <h1 className="shrink-0 text-xs font-black uppercase leading-none tracking-wider text-amber-400">
            🐎🎲 Apuestas
          </h1>
          <span className="truncate text-[10px] font-semibold leading-none text-slate-300">
            · Carga en vivo y adelantada · Motor de Cruces y Tapas · Liquidación transaccional
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-[10px] leading-none">
          {esUsuarioOAdminPrincipal && (
            <div className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/90 px-2 py-0.5 shadow-inner">
              <span className="text-[10px] font-black uppercase tracking-wider text-amber-300">Grupo:</span>
              <select
                value={grupoActivoValido ?? ""}
                onChange={(e) => {
                  const val = e.target.value.trim();
                  setGrupoActivo(val ? val : null);
                }}
                className="rounded border border-slate-600 bg-slate-900 px-1.5 py-0.5 text-[10px] font-bold text-slate-100 outline-none focus:border-amber-400"
                aria-label="Seleccionar grupo de trabajo"
              >
                <option value="">🌐 Principal («Todos los grupos»)</option>
                {gruposVenta.map((g) => (
                  <option key={String(g.id)} value={String(g.id)}>
                    {g.nombre}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            type="button"
            onClick={() => setModalControlCruces(true)}
            disabled={bloqueoLiquidacionActivo}
            className="inline-flex items-center gap-1 rounded-md border border-amber-400/50 bg-amber-500/20 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-amber-300 shadow-sm transition hover:bg-amber-500/30 disabled:opacity-40"
            title="Abrir panel de control de cruces de esta carrera"
          >
            <span>⚡</span> Control de Cruces
            {conCruces && (
              <span className="rounded-full bg-emerald-500/30 px-1.5 py-0.2 text-[9px] font-black text-emerald-300 border border-emerald-400/40">
                🔀 CON CRUCES
              </span>
            )}
            {Object.values(crucesOverrideCarrera.todos ?? {}).some((v) => typeof v === "boolean") && (
              <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" title="Excepción activa para esta carrera" />
            )}
          </button>

          {!modoOperador && !esOperadorFijo && (
            <button
              type="button"
              onClick={() => setModalSaldoRapido(true)}
              disabled={bloqueoLiquidacionActivo}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-400/50 bg-emerald-600 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white shadow-sm transition hover:bg-emerald-500 disabled:opacity-40"
              title="Incrementar o disminuir saldo de un cliente adjuntando capture de comprobante"
            >
              <span>💵</span> Gestión Rápida de Saldos
            </button>
          )}
          <span className="rounded-md bg-slate-800 px-2 py-0.5 font-bold text-slate-200">
            📅 {fecha}
          </span>
          {hipodromoElegido && (
            <span className="rounded-md bg-indigo-600/30 border border-indigo-400/40 px-2 py-0.5 font-black text-indigo-200">
              🏇 {nombreHipodromo} · C{carrera}
            </span>
          )}
        </div>
      </div>

      {/* Barra de comandos flotante (sticky bottom) */}
      <div className="no-print sticky bottom-0 z-30 rounded-xl border border-line bg-slate-900 px-3 py-2 shadow-[0_-8px_24px_rgba(0,0,0,0.18)]">
        {/* La re-apertura es un ESTADO, no un botón más: va en su propia franja
            para que la fila de acciones quede pareja y en una sola línea. */}
        {reapertura && (
          <div className="mb-1.5 flex items-center gap-2 rounded-lg border border-amber-500 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700">
            🟠 Re-apertura activa · {nombreHipodromo} C{carrera} — se liquidará SÓLO lo agregado
            <button
              type="button"
              onClick={() => setReapertura(false)}
              className="ml-1 text-amber-600 hover:text-amber-800"
              title="Cancelar la re-apertura"
            >
              ✕
            </button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={bloqueoLiquidacionActivo}
            onClick={() => {
              void recargarClientes().then(() => {
                setAviso("🔄 Saldos y aval del catálogo recargados contra la base.");
              });
            }}
            title="Relee los saldos y aval de los clientes desde la base (útil si la carga no se toma)"
            className={`${BTN_BARRA} bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-40`}
          >
            🔄 Saldos
          </button>
          <button
            type="button"
            disabled={bloqueoLiquidacionActivo}
            onClick={() => setMostrarHistorial(true)}
            title="Historial de resultados y liquidaciones (Ctrl+H)"
            className={`${BTN_BARRA} bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-40`}
          >
            📊 Historial
          </button>
          <button
            type="button"
            disabled={bloqueoLiquidacionActivo}
            onClick={() => {
              setModoExclusivoReporte(false);
              setMostrarReporteLiquidacion(true);
            }}
            title="Reporte de jugadas / liquidación de la carrera (Ctrl+G)"
            className={`${BTN_BARRA} bg-emerald-800 text-emerald-50 hover:bg-emerald-700 disabled:opacity-40`}
          >
            🧾 Reporte Final
          </button>
          {(carreraLiquidada || pizarraCentral) && !reapertura && (
            <button
              type="button"
              disabled={bloqueoLiquidacionActivo}
              onClick={abrirReapertura}
              title="Reabrir esta carrera liquidada para agregar jugadas nuevas"
              className={`${BTN_BARRA} bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-40`}
            >
              ➕ Agregar jugada
            </button>
          )}
          {puedeEditarJugadas && (
            <button
              type="button"
              onClick={() => setModalEditarJugadas(true)}
              disabled={!listoParaCargar || bloqueoLiquidacionActivo}
              title={
                listoParaCargar
                  ? "Corregir o anular las jugadas ya guardadas de esta carrera (aunque esté cerrada)"
                  : "Elija hipódromo y carrera para editar sus jugadas"
              }
              className={`${BTN_BARRA} bg-slate-700 text-white hover:bg-slate-600 disabled:opacity-40`}
            >
              ✏️ Editar jugadas
            </button>
          )}
          {carreraLiquidada && puedeReabrir ? (
            <button
              type="button"
              onClick={() => setModalReversar(true)}
              disabled={!listoParaCargar || bloqueoLiquidacionActivo}
              title={listoParaCargar ? "🔄 Reversa la liquidación de esta carrera: devuelve a los clientes el dinero acreditado y la deja ABIERTA para volver a cargar y liquidar" : "Elija hipódromo y carrera para reversar su liquidación"}
              className={`${BTN_BARRA} bg-gradient-to-r from-rose-600 to-red-500 text-white hover:brightness-110 disabled:opacity-40`}
            >
              🔄 Reversar Liquidación
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setModalAgentePizarra(true)}
            disabled={bloqueoLiquidacionActivo}
            title="🤖 Agente de Pizarra Oficial (Cambio de Pizarra · Liquidación · Variación · Saldos)"
            className={`${BTN_BARRA} bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40`}
          >
            🤖 Cambio de Pizarra
          </button>
          <button
            type="button"
            onClick={() => void recalcularCompleta()}
            disabled={!listoParaCargar || bloqueoLiquidacionActivo}
            title={listoParaCargar ? "🔄 Rehace toda la carrera contra el resultado vigente (revertir + re-liquidar tablas fijas, marcas, dupletas, remates y taquilla). Idempotente: no duplica cobros ni premios." : "Elija hipódromo y carrera para recalcular"}
            className={`${BTN_BARRA} bg-warning-600 text-white hover:bg-warning-500 disabled:opacity-40`}
          >
            🔄 Recalcular
          </button>
          <button
            type="button"
            disabled={bloqueoLiquidacionActivo}
            onClick={() => setModalComandos(true)}
            title="Ver los atajos de teclado de la taquilla (Ctrl+Shift+K)"
            className={`${BTN_BARRA} bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-40`}
          >
            ❓ Comando
          </button>
        </div>
      </div>

      {/* Modal 🤖 Agente de Pizarra Oficial (Liquidación · Variación · Saldos) */}
      {modalAgentePizarra && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setModalAgentePizarra(false);
          }}
        >
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-indigo-200 bg-white text-black shadow-2xl">
            <div className="flex items-center justify-between border-b border-indigo-200 bg-gradient-to-r from-indigo-900 to-slate-900 px-4 py-3 text-white">
              <div className="flex items-center gap-2">
                <span className="text-lg">🤖</span>
                <div>
                  <h3 className="text-xs font-black uppercase tracking-wider text-amber-300">
                    🤖 Cambio de Pizarra · Agente de Pizarra Oficial (Liquidación · Variación · Saldos)
                  </h3>
                  <p className="text-[10px] font-semibold text-slate-300">
                    {hipodromoElegido ? `${nombreHipodromo} · Carrera #${carrera} (${fecha})` : "Seleccione hipódromo y carrera"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setModalAgentePizarra(false)}
                className="rounded-lg border border-white/20 bg-white/10 px-2.5 py-1 text-xs font-bold text-white hover:bg-white/20"
              >
                ✕ Cerrar
              </button>
            </div>
            <div className="space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-bold text-slate-700">
                  Comandos rápidos: &quot;Pizarra: 5 - 2 - 8 - 1 - 4&quot; · &quot;Anular pizarra por variación&quot; · &quot;Nueva pizarra: 2 - 5 - 8 - 1 - 4&quot;
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {carreraLiquidada && puedeReabrir && (
                    <button
                      type="button"
                      onClick={() => void ejecutarComandoAgentePizarra("Anular pizarra por variación")}
                      disabled={reversando}
                      className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-2.5 py-1 text-[11px] font-black text-white shadow-2xs hover:bg-rose-500 disabled:opacity-50"
                      title="Anula la pizarra actual por variación de llegada, revierte pagos/cobros y restituye saldos"
                    >
                      🔄 Anular Pizarra por Variación
                    </button>
                  )}
                  {(mensajeWhatsapp || (respuestaAgentePizarra && respuestaAgentePizarra.includes("PIZARRA OFICIAL"))) && (
                    <button
                      type="button"
                      onClick={async () => {
                        const txt = mensajeWhatsapp || respuestaAgentePizarra || "";
                        if (!txt) return;
                        try {
                          await navigator.clipboard.writeText(txt);
                          setCopiadoReporteAgente(true);
                          setTimeout(() => setCopiadoReporteAgente(false), 2000);
                          emitirToast("📋 Reporte WhatsApp copiado al portapapeles.", "success");
                        } catch {
                          emitirToast("No se pudo copiar el reporte al portapapeles.", "error");
                        }
                      }}
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-black text-white shadow-2xs hover:bg-emerald-500"
                    >
                      {copiadoReporteAgente ? "✅ Reporte Copiado" : "📋 Copiar Reporte WhatsApp"}
                    </button>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={comandoPizarraInput}
                  onChange={(e) => setComandoPizarraInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void ejecutarComandoAgentePizarra();
                  }}
                  placeholder='Ej: "Pizarra: 5 - 2 - 8 - 1 - 4" · "Anular pizarra por variación"'
                  className="min-w-[240px] flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-black focus:border-indigo-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void ejecutarComandoAgentePizarra()}
                  disabled={!comandoPizarraInput.trim()}
                  className="rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-black text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  ⚡ Procesar Pizarra
                </button>
              </div>
              {respuestaAgentePizarra && (
                <div className="rounded-lg border border-slate-200 bg-slate-900 p-3 text-xs text-slate-100 overflow-x-hidden">
                  <pre className="max-h-64 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
                    {respuestaAgentePizarra}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal Preliminar de Carrera (Ctrl+Q) */}
      {mostrarPlanoPreliminar && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-[#f8fafc]">
          <div className="min-h-screen">
            <div className="flex justify-end bg-[#f8fafc] p-2">
              <button
                type="button"
                onClick={() => setMostrarPlanoPreliminar(false)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-bold text-red-500 border border-red-300 hover:bg-red-50 shadow-sm"
              >
                <span className="text-red-400 text-sm leading-none">✕</span> Cerrar Plano
              </button>
            </div>
            <PlanoPreliminar texto={planoPreliminarTexto} />
          </div>
        </div>
      )}

      {/* Vista separada: Resultado Preliminar (texto para copiar al grupo) */}
      {mostrarPreliminarResultado && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-[#f8fafc]">
          <div className="min-h-screen">
            <div className="flex justify-end bg-[#f8fafc] p-2">
              <button
                type="button"
                onClick={() => setMostrarPreliminarResultado(false)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-bold text-red-500 border border-red-300 hover:bg-red-50 shadow-sm"
              >
                <span className="text-red-400 text-sm leading-none">✕</span> Cerrar Resultado
              </button>
            </div>
            <PreliminarResultados texto={preliminarResultadoTexto} />
          </div>
        </div>
      )}

      {mostrarHistorial && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-[#eef2f7]">
          <div className="min-h-screen">
            <div className="flex justify-end bg-[#eef2f7] p-2">
              <button
                type="button"
                onClick={() => setMostrarHistorial(false)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-bold text-red-500 border border-red-300 hover:bg-red-50 shadow-sm"
              >
                <span className="text-red-400 text-sm leading-none">✕</span> Cerrar Historial
              </button>
            </div>
            <HistorialReporte />
          </div>
        </div>
      )}

      {/* Reporte de Liquidación (Ctrl+G) — motor de reporte filtrable + imagen */}
      <ReporteLiquidacionModal
        abierto={mostrarReporteLiquidacion}
        onCerrar={() => {
          setMostrarReporteLiquidacion(false);
          setModoExclusivoReporte(false);
        }}
        hipodromoInicial={hipodromo}
        carreraInicial={carrera}
        fechaInicial={fecha}
        modoExclusivoLiquidacion={modoExclusivoReporte}
      />

      {/* Carga de Resultados (Ctrl+Y) — posiciones dinámicas (5 + añadir hasta 8) + Dead Heat */}
      <CargaResultadosModal
        abierto={modalResultados}
        onCerrar={() => setModalResultados(false)}
        hipodromo={hipodromo}
        carrera={String(carrera)}
        caballos={caballosDeCarrera.length ? caballosDeCarrera : null}
        inicial={ultimaPizarra ?? pizarraCentral}
        editandoLiquidada={carreraLiquidada}
        onConfirmar={async (r, motivo) => {
          setModalResultados(false);
          try {
            // Deja el texto de resultados listo por si abren el mensaje del grupo.
            void generarMensajeResultados(r);
          } catch {
            /* noop */
          }

          // ── CAMBIO DE UN RESULTADO YA LIQUIDADO ────────────────────────────
          // La carrera ya pagó. Guardar la llegada nueva y correr de nuevo toda
          // la liquidación (el motor `recalcularCarreraCompleta` revierte y
          // re-liquida contra el resultado vigente). NUNCA se vuelve a
          // «liquidar y cerrar»: eso duplicaría el cierre y el pago. El motivo
          // viaja a la auditoría: sin él no hay forma de explicar una diferencia
          // de caja.
          if (motivo) {
            setAviso(`🔒 Resultado C${carrera} cambiado — recalculando toda la liquidación…`);
            try {
              const cen = await guardarPizarraCentral({
                hipodromo,
                carrera,
                fecha,
                cargado_por: "GESTION-JUGADAS",
                r,
                // El resultado central se reescribe; la plata la mueve el
                // recálculo completo de abajo, no este guardado.
                liquidar: false,
                tasaComision: comisionNum,
              });
              if (!cen.ok) {
                setAviso(`⚠️ Resultado C${carrera} local, pero no se centralizó: ${cen.error ?? "sin conexión"}`);
              }
            } catch {
              setAviso(`⚠️ Resultado C${carrera} local, pero no se centralizó.`);
            }
            void registrarAuditoria(
              "GESTION_JUGADAS",
              "CAMBIAR_RESULTADO_LIQUIDADA",
              `Cambio de resultado de ${nombreHipodromo} C${carrera} (${fecha}) por ${usuarioVigente()}: ${motivo}`
            );
            const rec = await recalcularCarreraCompleta({
              hipodromo,
              carrera,
              fecha,
              tasaComision: comisionNum,
              usuario: usuarioVigente(),
            });
            setAviso(
              rec.ok
                ? `🔄 Resultado cambiado · ${rec.motivo}`
                : `❌ Resultado guardado, pero el recálculo falló: ${rec.motivo}${rec.errores.length ? ` · ${rec.errores.join(" | ")}` : ""}`
            );
            // La pizarra pagada de la sesión queda como la vigente para volver a
            // editarla, y se refresca el catálogo porque el recálculo movió saldos.
            setPizarraCentral(r);
            void recargarClientes();
            void recargarJugadasGuardadas();
            recargarRegistroCentral();
            if (rec.ok) {
              setModoExclusivoReporte(true);
              setMostrarReporteLiquidacion(true);
            }
            return;
          }

          // ── PRIMERA LIQUIDACIÓN DE LA CARRERA ───────────────────────────────
          setUltimaPizarra(r);
          setAviso(`🏁 Resultados C${carrera} cargados (${r.llenas} posiciones${r.empates.length ? ` · ${r.empates.length} empate(s)` : ""}).`);
          // CONFIRMAR RESULTADOS = REGISTRAR Y FINALIZAR: la carrera se
          // registra (upsertResultadoCentral incluido dentro de
          // `liquidarCarreraYCerrarTabla`) y se cierra en ESTE mismo paso,
          // abriendo directamente el Reporte de la carrera liquidada sin
          // doble escritura ni pantallas intermedias.
          setReporteAlCerrarFinalizar(false);
          try {
            const resFin = await ejecutarFinalizar(r, true);
            if (!resFin.ok) {
              await guardarPizarraCentral({
                hipodromo,
                carrera,
                fecha,
                cargado_por: "GESTION-JUGADAS",
                r,
                liquidar: false,
                tasaComision: comisionNum,
              }).catch(() => {});
            }
          } catch (e) {
            setAviso(
              `❌ No se pudo cerrar la carrera ${nombreHipodromo} C${carrera}: ${e instanceof Error ? e.message : String(e)}`
            );
          }
        }}
      />

      {/* Registrar y Finalizar (Ctrl+R) */}
      {modalFinalizar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-line bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-line bg-slate-800 px-4 py-3 text-white">
              <h3 className="text-xs font-black uppercase">{reapertura ? "🟠 Liquidar jugadas agregadas" : "✅ Liquidar"} — <span className="normal-case">{nombreHipodromo}</span> C{carrera}</h3>
              <button type="button" onClick={cerrarFinalizar} className="text-slate-300 hover:text-white">✕</button>
            </div>
            <div className="max-h-[60vh] space-y-3 overflow-y-auto p-4">
              {reapertura && (
                <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-700">
                  🟠 Re-apertura: se liquidará SÓLO lo agregado. Los tickets ya decididos (Ganador/Perdedor/Retirado) no se
                  tocan y el resultado central no se reescribe.
                </p>
              )}
              {/* Con resumen ya no hay nada que precargar: la carrera se cerró
                  (o falló) y avisar "Todavía no cargaste los resultados" encima
                  del resumen hacía parecer que guardar no había hecho nada. */}
              {resumen ? null : !ultimaPizarra ? (
                <p className="rounded-lg bg-warning-500/10 px-3 py-2 text-xs font-semibold text-warning-700">
                  ⚠️ Todavía no cargaste los resultados. Usá Ctrl+Y o Ctrl+R (mismo flujo) para abrir la Carga de Resultados.
                </p>
              ) : (
                <div className="rounded-lg border border-line bg-gray-50 p-3">
                  <p className="mb-1 text-[10px] font-bold uppercase text-slate-400">Pizarra cargada ({ultimaPizarra.llenas} posiciones)</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(ultimaPizarra.pizarra)
                        .filter(([k, v]) => k !== "empates" && typeof v === "string" && v.trim() !== "")
                        .map(([k, v]) => (
                          <span key={k} className="rounded-md bg-slate-800 px-2 py-1 text-[10px] font-black uppercase text-white">
                            {k}: <b>{v}</b>
                          </span>
                        ))}
                      {ultimaPizarra.empates.length > 0 && (
                        <span className="rounded-md bg-warning-500 px-2 py-1 text-[10px] font-black uppercase text-white">
                          ⚡ Empates: {ultimaPizarra.empates.join(", ")} (cero fraccionamiento)
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        generarMensajeResultados(ultimaPizarra);
                        setModalWhatsapp(true);
                      }}
                      className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-slate-800 px-2 py-1 text-[10px] font-black uppercase text-white hover:bg-slate-700"
                      title="Genera el mensaje de resultados listo para pegar por WhatsApp"
                    >
                      🪄 WhatsApp
                    </button>
                  </div>
                </div>
              )}

              {resumen ? (
                <div className="rounded-2xl border border-line p-3">
                  <p className="text-xs font-black uppercase text-slate-700">
                    {resumen.ok
                      ? resumen.tablaCerrada?.ok
                        ? "✅ Carrera registrada y CERRADA"
                        : "⚠️ Liquidada · la tabla no se pudo cerrar en BD"
                      : "❌ Liquidación incompleta — la carrera NO se cerró"}
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg bg-gray-50 px-3 py-2">
                      <p className="text-[9px] font-bold uppercase text-slate-400">Invertido</p>
                      <p className="font-black text-slate-900">{monedaFmt(resumen.totalInvertido)}</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 px-3 py-2">
                      <p className="text-[9px] font-bold uppercase text-slate-400">A pagar (neto)</p>
                      <p className="font-black text-success-600">{monedaFmt(resumen.totalClienteNeto)}</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 px-3 py-2">
                      <p className="text-[9px] font-bold uppercase text-slate-400">Balance de la banca</p>
                      <p className="font-black text-slate-900">{monedaFmt(resumen.balanceBanca)}</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 px-3 py-2">
                      <p className="text-[9px] font-bold uppercase text-slate-400">Comisión de la casa</p>
                      <p className="font-black text-primary-700">{monedaFmt(resumen.gananciaCasa)}</p>
                    </div>
                  </div>
                  {resumen.procesados.filter((p) => p.resultado.motivo?.includes("⚡ Cruce")).map((p, i) => (
                    <div key={`${p.comando}-${i}`} className="mt-2 rounded-lg border border-amber-300/50 bg-slate-900 px-3 py-2 text-[10px] text-slate-200">
                      <span className="mr-2 inline-flex rounded-full bg-amber-400 px-2 py-0.5 font-black text-slate-950">
                        {p.resultado.motivo?.match(/⚡ Cruce (Mismo Ej\.|Dif\. Ej\.)/)?.[0] ?? "⚡ Cruce"}
                      </span>
                      <span className="font-mono text-slate-300">{p.comando}</span>
                      <p className="mt-1 text-amber-200">{p.resultado.motivo?.split("·").slice(-1)[0]?.trim()}</p>
                      <p className="mt-0.5 text-[9px] text-slate-400">{p.resultado.motivo?.match(/\((Grupo|Ficha Usuario|Solo Carrera #[^)]+)\)/)?.[1] ?? "Regla aplicada"}</p>
                    </div>
                  ))}
                  {resumen.tablasFijas && (resumen.tablasFijas.tablas > 0 || resumen.tablasFijas.error) ? (
                    <p className="mt-2 rounded-lg border border-line bg-gray-50 px-3 py-2 text-[11px] font-semibold text-slate-600">
                      {resumen.tablasFijas.tablas > 0 ? (
                        <>
                          🏁 <b>Tablas fijas:</b> {resumen.tablasFijas.tablas} tabla(s) liquidada(s) · a pagar{" "}
                          <b className="text-success-700">{monedaFmt(resumen.tablasFijas.pagado)}</b> · comisión{" "}
                          <b className="text-primary-700">{monedaFmt(resumen.tablasFijas.comision)}</b>
                        </>
                      ) : (
                        <>🏁 <b>Tablas fijas:</b> {resumen.tablasFijas.error ?? "no se pudieron liquidar."}</>
                      )}
                    </p>
                  ) : null}
                  <p className="mt-2 text-[10px] font-semibold text-slate-500">
                    {resumen.motivo}{" "}
                    {resumen.tablaCerrada?.ok
                      ? "· Tabla cerrada en BD ✔"
                      : `· No se pudo cerrar la tabla en BD${resumen.tablaCerrada?.error ? `: ${resumen.tablaCerrada.error}` : "."}`}
                  </p>
                </div>
              ) : (
                <div className="rounded-lg border border-line bg-gray-50 px-3 py-2 text-xs font-semibold text-slate-600">
                  {ticketsDeCarrera.length} ticket(s) en sesión · Invertido: <b>{monedaFmt(totalInvertidoSesion)}</b>. Al
                  confirmar, el motor liquida con la pizarra y cierra la carrera automáticamente.
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-line bg-gray-50 px-4 py-3">
              <Button variant="ghost" size="sm" onClick={cerrarFinalizar}>Cerrar</Button>
              {(ultimaPizarra || pizarraCentral) && (
                <Button size="sm" onClick={() => { setModalFinalizar(false); setModalResultados(true); }}>
                  ✏️ Editar resultados
                </Button>
              )}
              {!resumen && (
                <Button variant="success" size="md" onClick={() => void ejecutarFinalizar()}>
                  {reapertura ? "💾 Liquidar jugadas agregadas" : "💰 Liquidar"}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Editar jugadas guardadas de la carrera (aunque esté cerrada) */}
      {modalEditarJugadas && (
        <ModalEditarJugadasCarrera
          hipodromo={hipodromo}
          nombreHipodromo={nombreHipodromo}
          carrera={carrera}
          fecha={fecha}
          tasaComision={comisionNum}
          onCerrar={() => {
            setModalEditarJugadas(false);
            void recargarJugadasGuardadas();
            void recargarClientes();
            recargarRegistroCentral();
          }}
        />
      )}

      {/* Bloque 1 — Reversar Liquidación (confirmación propia, sin window.confirm) */}
      {modalReversar && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-line bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-line bg-rose-700 px-4 py-3 text-white">
              <h3 className="text-xs font-black uppercase">
                🔄 Reversar Liquidación — <span className="normal-case">{nombreHipodromo}</span> C{carrera}
              </h3>
              <button
                type="button"
                onClick={() => setModalReversar(false)}
                disabled={reversando}
                className="text-rose-100 hover:text-white disabled:opacity-50"
              >
                ✕
              </button>
            </div>
            <div className="space-y-3 p-4 text-sm text-slate-700">
              <p className="font-bold text-rose-700">
                Se va a DESHACER la liquidación de {nombreHipodromo} C{carrera} ({String(fecha).slice(0, 10)}).
              </p>
              <ul className="list-disc space-y-1 pl-5 text-xs">
                <li>Se devuelve a cada cliente el dinero que se le había acreditado.</li>
                <li>Todos los tickets decididos vuelven a <b>Pendiente</b> (taquilla, tablas fijas, marcas, dupletas).</li>
                <li>Se reabren los remates cerrados y las pollas liquidadas de la jornada.</li>
                <li>Se borra el resultado oficial: la carrera queda <b>ABIERTA</b> para volver a cargar y liquidar.</li>
              </ul>
              <p className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-[11px] font-semibold text-amber-800">
                ⚠️ Los saldos de los clientes cambian al instante. Hacelo sólo si necesitás rehacer la carrera completa.
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-line bg-gray-50 px-4 py-3">
              <Button size="sm" variant="ghost" onClick={() => setModalReversar(false)} disabled={reversando}>
                Cancelar
              </Button>
              <button
                type="button"
                onClick={() => void ejecutarReversar()}
                disabled={reversando}
                className="rounded-lg bg-gradient-to-r from-rose-600 to-red-500 px-3 py-1.5 text-xs font-black text-white hover:brightness-110 disabled:opacity-50"
              >
                {reversando ? "Reversando…" : "🔄 Sí, reversar liquidación"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Comandos (Ctrl+Shift+K) */}
      {modalComandos && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-line bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-line bg-slate-800 px-4 py-3 text-white">
              <h3 className="text-xs font-black uppercase">❓ Comandos de la Taquilla</h3>
              <button type="button" onClick={() => setModalComandos(false)} className="text-slate-300 hover:text-white">✕</button>
            </div>
            <div className="divide-y divide-line p-2">
              {[
                ["Ctrl+Q", "📋 Preliminar", "Muestra los ejemplares inscritos de la carrera activa."],
                ["Ctrl+Y", "🏁 Carga de Resultados", "Pizarra con 5 posiciones por defecto (+ puestos dinámicos hasta 8) + Empate (Dead Heat) por posición."],
                ["Ctrl+R", "✅ Liquidar", "Liquida los tickets con el motor y cierra la carrera (estado= Cerrada)."],
                ["Ctrl+H", "📊 Historial", "Historial de resultados y liquidaciones de la jornada."],
                ["Ctrl+G", "🧾 Reporte Final", "Reporte final de la carrera liquidada."],
                ["Ctrl+Shift+K", "❓ Comando", "Este listado de atajos."],
              ].map(([kbd, titulo, desc]) => (
                <div key={kbd} className="flex items-start gap-3 px-2 py-2.5">
                  <kbd className="mt-0.5 shrink-0 rounded-md bg-slate-800 px-2 py-1 text-[10px] font-black text-white">{kbd}</kbd>
                  <div>
                    <p className="text-xs font-bold text-slate-800">{titulo}</p>
                    <p className="text-[11px] text-slate-500">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end border-t border-line bg-gray-50 px-4 py-3">
              <Button size="sm" onClick={() => setModalComandos(false)}>Entendido</Button>
            </div>
          </div>
        </div>
      )}

      {/* Carga Rápida (texto libre) — pegar bloque y poblar tabla */}
      {modalCargaRapida && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-line bg-white shadow-2xl">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-slate-800 px-4 py-3 text-white">
              <h3 className="text-xs font-black uppercase">⚡ Carga Rápida — <span className="normal-case">{nombreHipodromo}</span> C{carrera}</h3>
              <div className="flex items-center gap-2">
                <BotonDictadoAudio
                  compacto
                  etiqueta="🎙️ Dictar Jugadas"
                  modo="jugadas"
                  onTextoReconocido={(txt) => {
                    const bloque = formatearDictadoJugadas(txt);
                    setTextoCargaRapida((prev) => (prev.trim() ? `${prev.trim()}\n${bloque}` : bloque));
                  }}
                />
                <button type="button" onClick={() => setModalCargaRapida(false)} className="text-slate-300 hover:text-white">✕</button>
              </div>
            </div>
            <div className="space-y-3 p-4">
              <textarea
                value={textoCargaRapida}
                onChange={(e) => setTextoCargaRapida(e.target.value)}
                rows={14}
                spellCheck={false}
                placeholder={"Pegá el bloque de jugadas (1 por línea, CUALQUIER orden):\n\n3y3 9 40 emy mar\n2p 1 100 Perrito molinas\nJuega Lolo 2p (1) con 300 da Mar\n1/2 y 2n 7 100 Eddie Manuel\n2x3 10/8 2 100 Juan Pedro\nWalcot 2y3-3n 4 astronauta 400"}
                className="w-full resize-y rounded-xl border border-line bg-white p-3 font-mono text-xs text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              />
              {incoherenciasCargaRapida.length > 0 && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-2">
                  <p className="pb-1 text-[9px] font-black uppercase tracking-wide text-red-500">
                    ✋ Jugadas sin coherencia → corregí antes de poblar
                  </p>
                  <div className="space-y-1">
                    {incoherenciasCargaRapida.map(({ linea, motivos }, i) => (
                      <div key={i} className="flex items-start gap-1.5 text-[10px] leading-tight">
                        <span className="mt-px font-black text-red-500">⚠️</span>
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-red-600">{linea}</p>
                          {motivos.map((mv, j) => (
                            <p key={j} className="text-red-400">· {mv}</p>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {previewCargaRapida.length > 0 && (
                <div className="max-h-40 overflow-y-auto rounded-xl border border-line bg-slate-50 p-2">
                  <p className="pb-1 text-[9px] font-black uppercase tracking-wide text-slate-400">
                    🔎 Así se va a pegar en la Carga Individual
                  </p>
                  <div className="space-y-1">
                    {previewCargaRapida.map(({ linea, normalizada: p }, i) => {
                      if (!p) return null;
                      if (!p.ok) {
                        return (
                          <div
                            key={i}
                            className="flex items-center gap-1.5 rounded-md bg-red-50 px-2 py-1 text-[10px] leading-tight text-red-600"
                          >
                            <span className="font-black">⚠️</span>
                            <span className="truncate font-semibold">{linea.trim()}</span>
                            <span className="ml-auto max-w-[45%] truncate text-red-400">{p.motivo}</span>
                          </div>
                        );
                      }
                      const celdas: Array<[string, string, ConfianzaCampo]> = [
                        ["Jugada", p.jugada, p.confianza.jugada],
                        ["Caballo", p.caballo, p.confianza.caballo],
                        ["Monto", p.monto, p.confianza.monto],
                        ["Cliente 1", p.cliente1, p.confianza.cliente1],
                        ["Cliente 2", p.cliente2 || "—", p.confianza.cliente2],
                      ];
                      return (
                        <div
                          key={i}
                          className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md bg-white px-2 py-1 text-[10px] leading-tight text-slate-600"
                        >
                          {rotuloPareo(p.jugada, p.caballo) && (
                            <span
                              className="rounded bg-blue-600 px-1 py-0.5 text-[9px] font-bold text-white"
                              title="Ítem 7: un MATCH sin fracción se juega PELO A PELO (10/10)"
                            >
                              {rotuloPareo(p.jugada, p.caballo)}
                            </span>
                          )}
                          {celdas.map(([k, v, conf]) => (
                            <span key={k} title={`${k}: ${v}`} className={cnConfianza(conf)}>
                              <b className="mr-0.5 font-black text-slate-400">{k}:</b> {v}
                            </span>
                          ))}
                          {p.correcciones.length > 0 && (
                            <span className="font-semibold text-amber-600">🔧 {p.correcciones.join(" · ")}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <p className="text-[10px] font-semibold text-slate-500">
                Motor heurístico por <b>tokens</b> + <b>normalizador difuso</b>: detecta{" "}
                <b>JUGADA · CABALLO · MONTO · CLIENTE 1 · CLIENTE 2</b> sin importar el orden, interpreta
                números y nomenclatura hablados (<i>"dos p"→2p · "a la par"→pp · "cien"→100</i>) y matchea
                los nombres contra el catálogo real de clientes y caballos. Lo que se ve arriba es lo que
                se pega; lo dudoso queda en <span className="font-black text-amber-600">ámbar</span> o{" "}
                <span className="font-black text-red-600">rojo ⚠️</span> para confirmar, sin romper el
                resto del bloque.
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-line bg-gray-50 px-4 py-3">
              <Button variant="ghost" size="sm" onClick={() => { setTextoCargaRapida(""); setModalCargaRapida(false); }}>
                Cancelar
              </Button>
              <Guard permiso="gestion_jugadas:btn_corregir_ia">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void corregirConIA()}
                  disabled={iaCargando || textoCargaRapida.trim().length === 0}
                  title="Refuerzo opcional con IA: reescribe el bloque dictado y lo deja en el formato canónico."
                >
                  {iaCargando ? "Corrigiendo…" : "✨ Corregir con IA"}
                </Button>
              </Guard>
              <Button variant="success" size="md" onClick={poblarCargaRapida}>📥 Poblar tabla</Button>
            </div>
          </div>
        </div>
      )}

      {/* Panel lateral derecho ocultable de Carreras Liquidadas (deduplicadas y orden cronológico inverso) */}
      <BarraCarrerasLiquidadas
        fecha={fecha}
        hipodromo={hipodromo}
        carreraActiva={carreraConfirmada ? carrera : null}
        refreshKey={jugadasGuardadas.length + (carreraLiquidada ? 1000 : 0)}
        onSeleccionarCarrera={(num) => {
          void seleccionarCarreraConConfirmacion(num, { abierta: true, estado: "cerrada" });
        }}
        onVerReporteCarrera={(num) => {
          setCarrera(num);
          setCarreraConfirmada(true);
          setMostrarReporteLiquidacion(true);
        }}
      />

      {/* Evento Enter en barras superiores no debe recargar */}
      <input type="hidden" />
    </div>
  );
}

/** Color del campo según la confianza del normalizador (vista previa del modal). */
function cnConfianza(c: ConfianzaCampo): string {
  return c === "exacto"
    ? "font-semibold text-slate-700"
    : c === "aproximado"
      ? "font-semibold text-amber-600"
      : "font-black text-red-500";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Símbolo y saldo de UN lado de la jugada (a la derecha del nombre del jugador).
 *
 *   · ✅  jugador que GANÓ, seguido de lo que gana (+).
 *   · ✖  jugador que PERDIÓ, seguido del saldo en contra (−).
 *   · 🩶  carrera NO liquidada: solo el MONTO EN RIESGO, en GRIS, sin símbolo.
 */
function SimboloLado({
  lado,
  money,
}: {
  lado: LadoResultado;
  money: (n: number) => string;
}) {
  if (lado.estado === "SIN_DATO") return null;
  if (lado.estado === "ANULADA" || lado.estado === "RETIRADO") {
    return <span className="shrink-0 text-[10px] font-bold text-slate-400">—</span>;
  }

  const gano = lado.estado === "GANO";
  const perdio = lado.estado === "PERDIO";
  const arriesga = lado.estado === "ARRIESGA";

  // Pendiente: solo el monto en riesgo, en GRIS y sin símbolo.
  if (arriesga) {
    return (
      <span
        className="shrink-0 whitespace-nowrap text-[10px] font-bold text-slate-400"
        title={`Monto en riesgo: ${money(lado.monto)} (la carrera aún no se liquida)`}
      >
        {money(lado.monto)}
      </span>
    );
  }

  return (
    <span
      className={`shrink-0 whitespace-nowrap text-[10px] font-black ${gano ? "text-emerald-600" : "text-red-600"}`}
      title={gano ? `Ganó ${money(lado.monto)}` : `Perdió ${money(lado.monto)}`}
    >
      {gano ? "✅" : "✖"} {gano ? `+${money(lado.monto)}` : `−${money(lado.monto)}`}
    </span>
  );
}

/** Color de casaca por número (paleta ligera para el preliminar). */


export default GestionJugadasModule;