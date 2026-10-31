"use client";
import { DateInput } from "@/shared/components/ui/DateInput";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listarGruposAdmin, type GrupoRow } from "@/features/grupos/lib/grupos";
import { listarClientes, type ClienteRow } from "@/features/clientes/lib/clientes";
import {
  construirReporteSemana,
  resumirReporte,
  type CarreraReporte,
  type DiaReporte,
  type FilaReporte,
  type HipodromoReporte,
  type PlanillaReporte,
  type ReporteSemana,
} from "@/features/liquidacion/lib/reportes";
import {
  categoriaJugadaAdelantada,
  colorDiscoNumero,
  esJugadaAdelantadaReporte,
} from "@/features/liquidacion/lib/reporte-carrera";
import { etiquetaDia } from "@/features/liquidacion/lib/semana";
import { hoyLocal } from "@/features/gaceta/lib/programa";
import { grupoActivoVigente } from "@/features/seguridad/lib/vigente";
import { ToastHost } from "@/shared/components/ui/ToastHost";
import { ModalPagoAGanadorYConciliacion } from "@/features/contabilidad/components/ModalPagoAGanadorYConciliacion";
import { ModalCobroYValidacionCliente } from "@/features/contabilidad/components/ModalCobroYValidacionCliente";
import { BotonIconoReporteSaldosVisual } from "@/features/saldos/components/ReporteSaldosVisual";
import { etiquetaJugada, caballoPareoLegible, rotuloPareo } from "@/features/taquilla/lib/nomenclatura";
import { redondearCentavos } from "@/shared/lib/dinero";

const fmtMonto = (n: number) =>
  n.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Signo({ v, vacio }: { v: number | null; vacio?: boolean }) {
  if (v === null || vacio) {
    return <span className="text-gray-400 font-medium">—</span>;
  }
  if (v === 0) {
    return <span className="text-gray-500 font-bold">0,00</span>;
  }
  const cls = v > 0 ? "text-green-600" : "text-red-600";
  return (
    <span className={`font-bold ${cls}`}>
      {v > 0 ? "+" : ""}
      {fmtMonto(v)}
    </span>
  );
}

function TotalBadge({ v, small }: { v: number; small?: boolean }) {
  const cls =
    v < 0 ? "bg-red-500 text-white" : v > 0 ? "bg-green-600 text-white" : "bg-gray-400 text-white";
  return (
    <span className={`rounded px-2 py-0.5 font-bold ${cls} ${small ? "text-[10px]" : "text-xs"}`}>
      {fmtMonto(v)} USD
    </span>
  );
}

export type VistaTablaDinamica =
  | "JERARQUIA"
  | "PIVOT_CARRERAS"
  | "PIVOT_CLIENTE_CARRERA"
  | "RESUMEN_4_COLUMNAS";
export type FiltroModalidadPivot =
  | "TODAS"
  | "EN_VIVO"
  | "ADELANTADAS"
  | "TERCIOS"
  | "MARCAS"
  | "TABLAS"
  | "REMATES"
  | "DUPLETAS";
export type FiltroResultadoPivot = "TODOS" | "GANADORES" | "PERDEDORES" | "PENDIENTES";

export type TipoJugadorSaldo = "aval" | "libre" | "pozo";
export type FiltroTipoJugadorSaldo = "TODOS" | "AVAL" | "LIBRE" | "POZO";

export function obtenerTipoJugador(cliente: { modo_juego?: string | null; libre?: boolean | null }): TipoJugadorSaldo {
  if (cliente.libre || String(cliente.modo_juego || "").toLowerCase().trim() === "libre") return "libre";
  if (String(cliente.modo_juego || "").toLowerCase().trim() === "pozo") return "pozo";
  return "aval";
}

export function infoTipoJugador(tipo: TipoJugadorSaldo) {
  switch (tipo) {
    case "libre":
      return {
        tipo: "libre" as const,
        icono: "🔓",
        etiqueta: "Jugador Libre",
        colorTexto: "text-sky-700",
        badgeCls: "bg-sky-100 text-sky-800 border-sky-300",
        descripcion: "Saldo actual positivo o negativo libre (sin tope de aval)",
      };
    case "pozo":
      return {
        tipo: "pozo" as const,
        icono: "💰",
        etiqueta: "Jugador con Pozo",
        colorTexto: "text-emerald-700",
        badgeCls: "bg-emerald-100 text-emerald-800 border-emerald-300",
        descripcion: "Saldo actual positivo de pozo",
      };
    case "aval":
    default:
      return {
        tipo: "aval" as const,
        icono: "💎",
        etiqueta: "Jugador Avalado",
        colorTexto: "text-amber-700",
        badgeCls: "bg-amber-100 text-amber-900 border-amber-300",
        descripcion: "Saldo actual positivo o negativo / aval",
      };
  }
}

function cumpleModalidadPivot(f: FilaReporte, filtro: FiltroModalidadPivot): boolean {
  if (filtro === "TODAS") return true;
  const esAdel = esJugadaAdelantadaReporte({
    jugo: f.jugada,
    esAdelantada: f.esAdelantada,
  });
  if (filtro === "EN_VIVO") return !esAdel;
  if (filtro === "ADELANTADAS") return esAdel;
  if (!esAdel) return false;
  const cat = categoriaJugadaAdelantada({
    jugo: f.jugada,
    esAdelantada: f.esAdelantada,
  });
  return cat.toUpperCase() === filtro;
}

function cumpleResultadoPivot(f: FilaReporte, filtro: FiltroResultadoPivot): boolean {
  if (filtro === "TODOS") return true;
  if (filtro === "GANADORES") return (f.resultado ?? 0) > 0;
  if (filtro === "PERDEDORES") return (f.resultado ?? 0) < 0;
  if (filtro === "PENDIENTES") return f.resultado === null;
  return true;
}

export function ReporteModule() {
  const [grupos, setGrupos] = useState<GrupoRow[]>([]);
  const [grupoId, setGrupoId] = useState<string>("");
  const [clientesGrupo, setClientesGrupo] = useState<ClienteRow[]>([]);
  const [fuenteSaldos4Col, setFuenteSaldos4Col] = useState<"JORNADA" | "CARTERA">("JORNADA");
  // Por defecto SIEMPRE el día de hoy (rango de un solo día), no la semana
  // fiscal completa: al abrir el monitor lo que interesa es la jornada en curso.
  const [desde, setDesde] = useState<string>(() => hoyLocal());
  const [hasta, setHasta] = useState<string>(() => hoyLocal());
  const [planilla, setPlanilla] = useState<PlanillaReporte | null>(null);
  const [cargando, setCargando] = useState(false);
  const [modalPagoGanadorAbierto, setModalPagoGanadorAbierto] = useState(false);
  const [clientePagoSeleccionadoId, setClientePagoSeleccionadoId] = useState<string | null>(null);
  const [pestanaModalPagos, setPestanaModalPagos] = useState<"PAGAR_GANADORES" | "CONCILIAR_PAGOS">("PAGAR_GANADORES");
  const [modalCobroAbierto, setModalCobroAbierto] = useState(false);
  const [clienteCobroSeleccionado, setClienteCobroSeleccionado] = useState<{ id?: string | number | null; nombre?: string | null; saldo?: number | null } | null>(null);
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  // Id de la última consulta: descarta respuestas viejas que llegan tarde
  const solicitud = useRef(0);

  // Estados del Filtro Tipo Tabla Dinámica de las Carreras
  const [vistaPivot, setVistaPivot] = useState<VistaTablaDinamica>("JERARQUIA");
  const [filtroDia, setFiltroDia] = useState<string>("TODOS");
  const [filtroHipodromo, setFiltroHipodromo] = useState<string>("TODOS");
  const [carrerasSeleccionadas, setCarrerasSeleccionadas] = useState<number[]>([]);
  // Carreras desplegadas en la vista jerárquica (por defecto: contraídas).
  const [carrerasAbiertas, setCarrerasAbiertas] = useState<Set<string>>(new Set());
  const [filtroCliente, setFiltroCliente] = useState<string>("");
  const [filtroRol, setFiltroRol] = useState<string>("TODOS");
  const [filtroModalidad, setFiltroModalidad] = useState<FiltroModalidadPivot>("TODAS");
  const [filtroResultado, setFiltroResultado] = useState<FiltroResultadoPivot>("TODOS");
  const [filtroTipoJugador, setFiltroTipoJugador] = useState<FiltroTipoJugadorSaldo>("TODOS");

  const alternar = useCallback((k: string) => {
    setAbiertos((prev) => {
      const s = new Set(prev);
      if (s.has(k)) s.delete(k);
      else s.add(k);
      return s;
    });
  }, []);

  const alternarCarreraPivot = useCallback((num: number) => {
    setCarrerasSeleccionadas((prev) =>
      prev.includes(num) ? prev.filter((x) => x !== num) : [...prev, num].sort((a, b) => a - b)
    );
  }, []);

  // Abre/cierra el detalle de una carrera en la vista jerárquica.
  const alternarCarreraDetalle = useCallback((clave: string) => {
    setCarrerasAbiertas((prev) => {
      const s = new Set(prev);
      if (s.has(clave)) s.delete(clave);
      else s.add(clave);
      return s;
    });
  }, []);

  const limpiarFiltrosPivot = useCallback(() => {
    setFiltroDia("TODOS");
    setFiltroHipodromo("TODOS");
    setCarrerasSeleccionadas([]);
    setFiltroCliente("");
    setFiltroRol("TODOS");
    setFiltroModalidad("TODAS");
    setFiltroResultado("TODOS");
    setFiltroTipoJugador("TODOS");
  }, []);

  useEffect(() => {
    listarGruposAdmin(true)
      .then((gs) => {
        setGrupos(gs);
        const activo = grupoActivoVigente();
        const elegido = (activo && gs.find((g) => String(g.id) === String(activo))) || null;
        const principal = elegido ?? gs.find((g) => g.es_principal) ?? gs[0];
        if (principal?.id != null) setGrupoId(String(principal.id));
      })
      .catch(() => setGrupos([]));
  }, []);

  useEffect(() => {
    if (!grupoId) return;
    listarClientes(true, grupoId)
      .then((cs) => setClientesGrupo(cs))
      .catch(() => setClientesGrupo([]));
  }, [grupoId]);

  const cargar = useCallback(async () => {
    const g = grupos.find((x) => String(x.id) === grupoId);
    if (!g) return;
    const id = ++solicitud.current;
    setCargando(true);
    const r = await construirReporteSemana(g, {
      desde: desde || undefined,
      hasta: hasta || undefined,
    });
    if (id !== solicitud.current) return;
    setPlanilla(r);
    // Nuevo reporte: las carreras vuelven a quedar contraídas.
    setCarrerasAbiertas(new Set());
    setCargando(false);
  }, [grupos, grupoId, desde, hasta]);

  useEffect(() => {
    if (grupoId) cargar();
  }, [grupoId, cargar]);

  const rptOriginal: ReporteSemana | null = planilla?.semanales ?? null;

  // Catálogos dinámicos extraídos del reporte cargado (para los segmentadores de la Tabla Dinámica)
  const opcionesPivot = useMemo(() => {
    const dias = new Set<string>();
    const hipos = new Set<string>();
    const numerosCarrera = new Set<number>();
    const clientes = new Set<string>();
    for (const d of rptOriginal?.dias ?? []) {
      dias.add(d.fecha);
      for (const h of d.hipodromos) {
        if (filtroDia !== "TODOS" && d.fecha !== filtroDia) continue;
        hipos.add(h.nombre);
        for (const c of h.carreras) {
          if (filtroHipodromo !== "TODOS" && h.nombre !== filtroHipodromo) continue;
          numerosCarrera.add(c.numero);
          for (const f of c.filas) {
            const cli = String(f.cliente ?? "").trim().toUpperCase();
            if (cli && cli !== "—") clientes.add(cli);
          }
        }
      }
    }
    return {
      dias: [...dias].sort(),
      hipodromos: [...hipos].sort((a, b) => a.localeCompare(b, "es")),
      carreras: [...numerosCarrera].sort((a, b) => a - b),
      clientes: [...clientes].sort((a, b) => a.localeCompare(b, "es")),
    };
  }, [rptOriginal, filtroDia, filtroHipodromo]);

  const hayFiltrosActivos =
    filtroDia !== "TODOS" ||
    filtroHipodromo !== "TODOS" ||
    carrerasSeleccionadas.length > 0 ||
    filtroCliente.trim() !== "" ||
    filtroRol !== "TODOS" ||
    filtroModalidad !== "TODAS" ||
    filtroResultado !== "TODOS" ||
    filtroTipoJugador !== "TODOS";

  const mapaInfoClientes = useMemo(() => {
    const map = new Map<string, { id: string; modo: TipoJugadorSaldo; libre: boolean; aval: number; saldoActual: number; icono: string; etiqueta: string }>();
    for (const c of clientesGrupo) {
      const key = String(c.nombre ?? c.seudonimo ?? c.id).trim().toUpperCase();
      const tipo = obtenerTipoJugador(c);
      const meta = infoTipoJugador(tipo);
      map.set(key, {
        id: String(c.id),
        modo: tipo,
        libre: Boolean(c.libre || tipo === "libre"),
        aval: Number(c.aval) || 0,
        saldoActual: redondearCentavos(Number(c.saldo_actual) || 0),
        icono: meta.icono,
        etiqueta: meta.etiqueta,
      });
    }
    return map;
  }, [clientesGrupo]);

  // Reporte filtrado dinámicamente según los segmentadores de la Tabla Dinámica
  const rpt: ReporteSemana | null = useMemo(() => {
    if (!rptOriginal) return null;
    if (!hayFiltrosActivos) return rptOriginal;

    const qCliente = filtroCliente.trim().toUpperCase();
    const diasFiltrados: DiaReporte[] = [];

    for (const d of rptOriginal.dias) {
      if (filtroDia !== "TODOS" && d.fecha !== filtroDia) continue;
      const hiposFiltrados: HipodromoReporte[] = [];

      for (const h of d.hipodromos) {
        if (filtroHipodromo !== "TODOS" && h.nombre !== filtroHipodromo) continue;
        const carrerasFiltradas: CarreraReporte[] = [];

        for (const c of h.carreras) {
          if (carrerasSeleccionadas.length > 0 && !carrerasSeleccionadas.includes(c.numero)) {
            continue;
          }
          const filasFiltradas = c.filas.filter((f) => {
            if (qCliente && !String(f.cliente ?? "").toUpperCase().includes(qCliente)) {
              return false;
            }
            if (filtroRol !== "TODOS" && f.rol !== filtroRol) {
              return false;
            }
            if (!cumpleModalidadPivot(f, filtroModalidad)) {
              return false;
            }
            if (!cumpleResultadoPivot(f, filtroResultado)) {
              return false;
            }
            if (filtroTipoJugador !== "TODOS") {
              const cliKey = String(f.cliente ?? "").trim().toUpperCase();
              const info = mapaInfoClientes.get(cliKey);
              const tipo = info?.modo ?? "aval";
              if (filtroTipoJugador === "AVAL" && tipo !== "aval") return false;
              if (filtroTipoJugador === "LIBRE" && tipo !== "libre") return false;
              if (filtroTipoJugador === "POZO") {
                if (tipo !== "pozo") return false;
                if ((info?.saldoActual ?? 0) <= 0.004) return false;
              }
            }
            return true;
          });

          if (filasFiltradas.length === 0) continue;

          const hayFiltrosDeFila =
            qCliente !== "" ||
            filtroRol !== "TODOS" ||
            filtroModalidad !== "TODAS" ||
            filtroResultado !== "TODOS";

          const subtotalCarrera = hayFiltrosDeFila
            ? redondearCentavos(
                filasFiltradas.reduce((acc, f) => acc + (f.resultado ?? 0), 0)
              )
            : c.subtotal;

          carrerasFiltradas.push({
            ...c,
            filas: filasFiltradas,
            subtotal: subtotalCarrera,
          });
        }

        if (carrerasFiltradas.length === 0) continue;
        const subtotalHipo = redondearCentavos(
          carrerasFiltradas.reduce((acc, c) => acc + c.subtotal, 0)
        );
        hiposFiltrados.push({
          ...h,
          carreras: carrerasFiltradas,
          subtotal: subtotalHipo,
        });
      }

      if (hiposFiltrados.length === 0) continue;
      const totalDia = redondearCentavos(
        hiposFiltrados.reduce((acc, h) => acc + h.subtotal, 0)
      );
      diasFiltrados.push({
        ...d,
        hipodromos: hiposFiltrados,
        totalDia,
      });
    }

    const totalSemana = redondearCentavos(
      diasFiltrados.reduce((acc, d) => acc + d.totalDia, 0)
    );

    return {
      ...rptOriginal,
      dias: diasFiltrados,
      totalSemana,
    };
  }, [
    rptOriginal,
    hayFiltrosActivos,
    filtroDia,
    filtroHipodromo,
    carrerasSeleccionadas,
    filtroCliente,
    filtroRol,
    filtroModalidad,
    filtroResultado,
  ]);

  // Datos pre-calculados para las vistas de Tabla Dinámica por Carrera y Cliente × Carrera
  const datosTablaDinamica = useMemo(() => {
    const filasCarreras: Array<{
      clave: string;
      fecha: string;
      hipodromo: string;
      numero: number;
      pizarra?: string;
      jugadasVisibles: number;
      enVivo: number;
      adelantadas: number;
      apostado: number;
      ganan: number;
      pierden: number;
      subtotal: number;
    }> = [];

    const clientesMap = new Map<string, Record<string, number>>();
    let comisionSemanaAcum = 0;

    for (const d of rpt?.dias ?? []) {
      for (const h of d.hipodromos) {
        for (const c of h.carreras) {
          const clave = `${d.fecha}::${h.nombre}::C${c.numero}`;
          let jugadasVisibles = 0;
          let enVivo = 0;
          let adelantadas = 0;
          let apostado = 0;
          let ganan = 0;
          let pierden = 0;
          let sumaResultadosCarrera = 0;

          for (const f of c.filas) {
            const cli = String(f.cliente ?? "").trim().toUpperCase();
            if (cli && cli !== "—" && f.resultado !== null) {
              const actual = clientesMap.get(cli) ?? {};
              actual[clave] = redondearCentavos((actual[clave] ?? 0) + f.resultado);
              clientesMap.set(cli, actual);
              sumaResultadosCarrera = redondearCentavos(sumaResultadosCarrera + f.resultado);
            }

            if (f.jugada === "Bono por Cruce de jugadas") continue;
            if (f.rol === "Juega") {
              jugadasVisibles++;
              apostado = redondearCentavos(apostado + (f.monto || 0));
              if (esJugadaAdelantadaReporte({ jugo: f.jugada, esAdelantada: f.esAdelantada })) {
                adelantadas++;
              } else {
                enVivo++;
              }
            }
            if ((f.resultado ?? 0) > 0) {
              ganan = redondearCentavos(ganan + (f.resultado ?? 0));
            } else if ((f.resultado ?? 0) < 0) {
              pierden = redondearCentavos(pierden + (f.resultado ?? 0));
            }
          }

          // En las jugadas liquidadas, la diferencia entre lo que pierden y lo que ganan los jugadores es la comisión retenida por la casa/grupo
          if (sumaResultadosCarrera < 0) {
            comisionSemanaAcum = redondearCentavos(comisionSemanaAcum + Math.abs(sumaResultadosCarrera));
          }

          filasCarreras.push({
            clave,
            fecha: d.fecha,
            hipodromo: h.nombre,
            numero: c.numero,
            pizarra: c.pizarra ?? undefined,
            jugadasVisibles,
            enVivo,
            adelantadas,
            apostado,
            ganan,
            pierden,
            subtotal: c.subtotal,
          });
        }
      }
    }

    let filasClientes = [...clientesMap.entries()]
      .map(([cliente, porCarrera]) => {
        const netoTotal = redondearCentavos(
          Object.values(porCarrera).reduce((acc, v) => acc + v, 0)
        );
        return { cliente, porCarrera, netoTotal };
      })
      .sort((a, b) => b.netoTotal - a.netoTotal || a.cliente.localeCompare(b.cliente, "es"));

    if (filtroTipoJugador !== "TODOS") {
      filasClientes = filasClientes.filter((fc) => {
        const info = mapaInfoClientes.get(fc.cliente);
        const tipo = info?.modo ?? "aval";
        if (filtroTipoJugador === "AVAL") return tipo === "aval";
        if (filtroTipoJugador === "LIBRE") return tipo === "libre";
        if (filtroTipoJugador === "POZO") return tipo === "pozo" && (fc.netoTotal > 0.004 || (info?.saldoActual ?? 0) > 0.004);
        return true;
      });
    }

    return { filasCarreras, filasClientes, comisionSemana: comisionSemanaAcum };
  }, [rpt]);

  // Resumen de 4 columnas: Nombre de Usuario (Saldos Positivos) | Saldo | Nombre de Usuario (Saldos Negativos) | Saldo
  const resumenCuatroColumnas = useMemo(() => {
    const usarCartera =
      fuenteSaldos4Col === "CARTERA" ||
      (datosTablaDinamica.filasClientes.length === 0 && clientesGrupo.length > 0);

    const base: Array<{
      id?: string;
      nombre: string;
      saldo: number;
      tipo: TipoJugadorSaldo;
      icono: string;
      etiqueta: string;
    }> = usarCartera
      ? clientesGrupo.map((c) => {
          const tipo = obtenerTipoJugador(c);
          const meta = infoTipoJugador(tipo);
          return {
            id: String(c.id),
            nombre: String(c.nombre ?? c.seudonimo ?? c.id).trim().toUpperCase(),
            saldo: redondearCentavos(Number(c.saldo_actual) || 0),
            tipo,
            icono: meta.icono,
            etiqueta: meta.etiqueta,
          };
        })
      : datosTablaDinamica.filasClientes.map((fc) => {
          const cliMeta = mapaInfoClientes.get(fc.cliente);
          const tipo = cliMeta?.modo ?? "aval";
          const meta = infoTipoJugador(tipo);
          return {
            id: cliMeta?.id,
            nombre: fc.cliente,
            saldo: fc.netoTotal,
            tipo,
            icono: meta.icono,
            etiqueta: meta.etiqueta,
          };
        });

    const baseFiltrada = base.filter((x) => {
      if (filtroTipoJugador === "TODOS") return true;
      if (filtroTipoJugador === "AVAL") return x.tipo === "aval";
      if (filtroTipoJugador === "LIBRE") return x.tipo === "libre";
      if (filtroTipoJugador === "POZO") return x.tipo === "pozo" && x.saldo > 0.004;
      return true;
    });

    const positivos = baseFiltrada
      .filter((x) => x.saldo > 0.004)
      .sort((a, b) => b.saldo - a.saldo || a.nombre.localeCompare(b.nombre, "es"));
    const negativos = baseFiltrada
      .filter((x) => x.saldo < -0.004)
      .sort((a, b) => a.saldo - b.saldo || a.nombre.localeCompare(b.nombre, "es"));

    const totalPagar = redondearCentavos(positivos.reduce((acc, x) => acc + x.saldo, 0));
    const totalCobrar = redondearCentavos(
      negativos.reduce((acc, x) => acc + Math.abs(x.saldo), 0)
    );
    const maxFilas = Math.max(positivos.length, negativos.length);
    const filasPareadas = Array.from({ length: maxFilas }, (_, idx) => ({
      pos: positivos[idx] ?? null,
      neg: negativos[idx] ?? null,
    }));

    return {
      positivos,
      negativos,
      filasPareadas,
      totalPagar,
      totalCobrar,
      comisionSemana: datosTablaDinamica.comisionSemana,
      usandoCartera: usarCartera,
      totalJugadores: base.length,
      totalFiltrados: baseFiltrada.length,
    };
  }, [fuenteSaldos4Col, datosTablaDinamica, clientesGrupo, filtroTipoJugador, mapaInfoClientes]);

  const resumen = resumirReporte(rpt);
  const hoy = hoyLocal();

  // Claves de todas las carreras del reporte, para el botón global de contraer/expandir.
  const clavesCarreras = useMemo(() => {
    const claves: string[] = [];
    for (const d of rpt?.dias ?? []) {
      for (const h of d.hipodromos) {
        for (const c of h.carreras) claves.push(`C-${d.fecha}-${h.nombre}-${c.numero}`);
      }
    }
    return claves;
  }, [rpt]);
  const todasCarrerasAbiertas =
    clavesCarreras.length > 0 && clavesCarreras.every((k) => carrerasAbiertas.has(k));

  return (
    <div className="p-4 max-w-6xl mx-auto min-h-screen bg-gray-100 font-sans text-sm">
      {/* CABECERA */}
      <div className="bg-blue-800 text-white p-3 rounded-t-lg shadow">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xl">📊</span>
          <h1 className="font-bold text-lg">Saldos Consolidados — Semana Fiscal</h1>
          {cargando && <span className="text-blue-200 text-xs animate-pulse">cargando…</span>}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <select
              value={grupoId}
              onChange={(e) => setGrupoId(e.target.value)}
              className="rounded border border-blue-700 bg-blue-900 px-2 py-1 text-sm text-white"
            >
              {grupos.map((g) => (
                <option key={String(g.id)} value={String(g.id)}>
                  {g.nombre ?? "Grupo"}
                </option>
              ))}
            </select>
            <DateInput
              value={desde}
              onFechaChange={(val) => setDesde(val)}
              placeholder="Desde"
              className="w-36 py-1 text-xs !text-black !bg-white border-slate-300"
            />
            <span className="text-blue-200">→</span>
            <DateInput
              value={hasta}
              onFechaChange={(val) => setHasta(val)}
              placeholder="Hasta"
              className="w-36 py-1 text-xs !text-black !bg-white border-slate-300"
            />
            <button
              onClick={cargar}
              disabled={cargando}
              className="rounded bg-emerald-500 px-3 py-1 text-sm font-bold hover:bg-emerald-400 disabled:opacity-50"
            >
              Generar
            </button>
            <BotonIconoReporteSaldosVisual
              etiqueta="Disponibilidad y Alerta"
              className="inline-flex items-center gap-1.5 rounded border border-amber-300/60 bg-amber-400/20 px-2.5 py-1 text-xs font-black text-amber-200 hover:bg-amber-400/30"
              grupo={grupos.find((g) => String(g.id) === String(grupoId))?.nombre ?? "Grupo Activo"}
              logoGrupo={(grupos.find((g) => String(g.id) === String(grupoId)) as { logo_url?: string | null } | undefined)?.logo_url ?? null}
              fecha={hasta || desde}
              clientes={clientesGrupo.map((c) => {
                const saldo = redondearCentavos(Number(c.saldo_actual) || 0);
                const aval = redondearCentavos(Math.max(0, Number(c.aval) || 0));
                const libre = Boolean(c.libre) || String(c.modo_juego || "").toLowerCase().trim() === "libre";
                return {
                  id: c.id,
                  nombre: String(c.nombre ?? c.seudonimo ?? c.id),
                  telefono: c.telefono ?? null,
                  saldoContable: saldo,
                  aval,
                  riesgoEnCurso: 0,
                  disponible: libre ? 999999 : redondearCentavos(saldo + aval),
                  libre,
                  modoJuego: obtenerTipoJugador(c),
                };
              })}
            />
          </div>
        </div>
        {planilla && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded bg-blue-900 border border-blue-700 px-2 py-0.5 font-mono">
              {planilla.desde} → {planilla.hasta}
            </span>
            <span className="text-blue-200">·</span>
            <span>
              Días: <b>{resumen.dias}</b>
            </span>
            <span>
              Hipódromos: <b>{resumen.hipodromos}</b>
            </span>
            <span>
              Carreras: <b>{resumen.carreras}</b>
            </span>
            <span>
              Tickets: <b>{resumen.tickets}</b>
            </span>
            {resumen.cruces > 0 && (
              <span>
                🔀 Cruces: <b>{resumen.cruces}</b>
              </span>
            )}
            <span className="rounded bg-amber-400/20 border border-amber-300/40 px-2 py-0.5 font-bold text-amber-200">
              💰 Comisión de la Semana: {fmtMonto(resumenCuatroColumnas.comisionSemana)} USD
            </span>
            {rpt && (
              <span className="ml-auto font-bold">
                Total filtrado: <TotalBadge v={rpt.totalSemana} />
              </span>
            )}
          </div>
        )}
      </div>

      {/* PANEL DE FILTROS TIPO TABLA DINÁMICA DE LAS CARRERAS */}
      <div className="bg-slate-900 text-slate-100 border-x border-b border-slate-700 p-3 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-black uppercase tracking-wider text-amber-300">
              🎛️ Filtro Tipo Tabla Dinámica de las Carreras
            </span>
            {hayFiltrosActivos && (
              <button
                type="button"
                onClick={limpiarFiltrosPivot}
                className="rounded bg-rose-600/90 px-2 py-0.5 text-[11px] font-bold text-white hover:bg-rose-500"
              >
                ✕ Limpiar filtros
              </button>
            )}
          </div>

          {/* Selector de Vista Dinámica */}
          <div
            role="group"
            aria-label="Modo de vista de la tabla dinámica"
            className="flex flex-wrap items-center overflow-hidden rounded-lg border border-slate-700 bg-slate-800 text-xs"
          >
            <button
              type="button"
              onClick={() => setVistaPivot("JERARQUIA")}
              className={`px-2.5 py-1 font-bold transition ${
                vistaPivot === "JERARQUIA"
                  ? "bg-amber-400 text-slate-950"
                  : "text-slate-300 hover:bg-slate-700"
              }`}
            >
              📋 Detalle por Carrera
            </button>
            <button
              type="button"
              onClick={() => setVistaPivot("RESUMEN_4_COLUMNAS")}
              className={`px-2.5 py-1 font-bold transition ${
                vistaPivot === "RESUMEN_4_COLUMNAS"
                  ? "bg-amber-400 text-slate-950"
                  : "text-slate-300 hover:bg-slate-700"
              }`}
            >
              📑 Resumen Saldos (4 Columnas)
            </button>
            <button
              type="button"
              onClick={() => setVistaPivot("PIVOT_CARRERAS")}
              className={`px-2.5 py-1 font-bold transition ${
                vistaPivot === "PIVOT_CARRERAS"
                  ? "bg-amber-400 text-slate-950"
                  : "text-slate-300 hover:bg-slate-700"
              }`}
            >
              📊 Tabla Dinámica (Carreras)
            </button>
            <button
              type="button"
              onClick={() => setVistaPivot("PIVOT_CLIENTE_CARRERA")}
              className={`px-2.5 py-1 font-bold transition ${
                vistaPivot === "PIVOT_CLIENTE_CARRERA"
                  ? "bg-amber-400 text-slate-950"
                  : "text-slate-300 hover:bg-slate-700"
              }`}
            >
              🧮 Matriz Cliente × Carrera
            </button>
          </div>

          {/* Contraer/expandir todas las carreras de la vista jerárquica */}
          {vistaPivot === "JERARQUIA" && clavesCarreras.length > 0 && (
            <button
              type="button"
              onClick={() =>
                setCarrerasAbiertas(todasCarrerasAbiertas ? new Set() : new Set(clavesCarreras))
              }
              className="rounded bg-slate-700 px-2 py-1 text-[11px] font-bold text-slate-100 hover:bg-slate-600"
              title={
                todasCarrerasAbiertas
                  ? "Contraer todas las carreras"
                  : "Desplegar todas las carreras"
              }
            >
              {todasCarrerasAbiertas ? "▾ Contraer carreras" : "▸ Expandir carreras"}
            </button>
          )}
        </div>

        {/* Controles de Segmentación Dinámica (Día, Hipódromo, Cliente, Rol, Modalidad, Resultado) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-2 text-xs">
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] font-bold uppercase text-slate-400">Día Fiscal</span>
            <select
              value={filtroDia}
              onChange={(e) => setFiltroDia(e.target.value)}
              className="rounded border border-slate-700 bg-slate-800 px-2 py-1 font-semibold text-white"
            >
              <option value="TODOS">Todos los días ({opcionesPivot.dias.length})</option>
              {opcionesPivot.dias.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] font-bold uppercase text-slate-400">Hipódromo</span>
            <select
              value={filtroHipodromo}
              onChange={(e) => setFiltroHipodromo(e.target.value)}
              className="rounded border border-slate-700 bg-slate-800 px-2 py-1 font-semibold text-white"
            >
              <option value="TODOS">Todos ({opcionesPivot.hipodromos.length})</option>
              {opcionesPivot.hipodromos.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] font-bold uppercase text-slate-400">Cliente / Jugador</span>
            <input
              type="text"
              list="lista-clientes-pivot-semana"
              value={filtroCliente}
              onChange={(e) => setFiltroCliente(e.target.value)}
              placeholder="Todos o escribir cliente…"
              className="rounded border border-slate-700 bg-slate-800 px-2 py-1 font-semibold text-white placeholder:text-slate-500"
            />
            <datalist id="lista-clientes-pivot-semana">
              {opcionesPivot.clientes.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>

          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] font-bold uppercase text-slate-400">Rol</span>
            <select
              value={filtroRol}
              onChange={(e) => setFiltroRol(e.target.value)}
              className="rounded border border-slate-700 bg-slate-800 px-2 py-1 font-semibold text-white"
            >
              <option value="TODOS">Todos los roles</option>
              <option value="Juega">Juega (Quien Juega)</option>
              <option value="Consigue">Consigue (Quien Da)</option>
              <option value="CRUCE">🔀 Cruce</option>
            </select>
          </label>

          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] font-bold uppercase text-slate-400">Modalidad / Sección</span>
            <select
              value={filtroModalidad}
              onChange={(e) => setFiltroModalidad(e.target.value as FiltroModalidadPivot)}
              className="rounded border border-slate-700 bg-slate-800 px-2 py-1 font-semibold text-white"
            >
              <option value="TODAS">Todas las jugadas</option>
              <option value="EN_VIVO">⚡ Solo Jugadas en Vivo</option>
              <option value="ADELANTADAS">⏳ Todas las Adelantadas</option>
              <option value="TERCIOS">⏳ Jugadas entre tercios</option>
              <option value="MARCAS">⏳ Marcas Adelantadas</option>
              <option value="TABLAS">⏳ Tablas Adelantadas</option>
              <option value="REMATES">⏳ Remates Adelantados</option>
              <option value="DUPLETAS">⏳ Dupletas Adelantadas</option>
            </select>
          </label>

          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] font-bold uppercase text-slate-400">Estado Resultado</span>
            <select
              value={filtroResultado}
              onChange={(e) => setFiltroResultado(e.target.value as FiltroResultadoPivot)}
              className="rounded border border-slate-700 bg-slate-800 px-2 py-1 font-semibold text-white"
            >
              <option value="TODOS">Todos (+ / - / Pend.)</option>
              <option value="GANADORES">🟢 Ganadores (+)</option>
              <option value="PERDEDORES">🔴 Perdedores (-)</option>
              <option value="PENDIENTES">⏳ Pendientes</option>
            </select>
          </label>

          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] font-bold uppercase text-slate-400">Tipo de Jugador / Saldo</span>
            <select
              value={filtroTipoJugador}
              onChange={(e) => setFiltroTipoJugador(e.target.value as FiltroTipoJugadorSaldo)}
              className="rounded border border-slate-700 bg-slate-800 px-2 py-1 font-semibold text-white"
            >
              <option value="TODOS">Todos los tipos</option>
              <option value="AVAL">💎 Jugadores Avalados (+/-)</option>
              <option value="LIBRE">🔓 Jugadores Libres (+/-)</option>
              <option value="POZO">💰 Jugadores con Pozo (+)</option>
            </select>
          </label>
        </div>

        {/* Segmentador (Slicer) multi-carrera tipo Tabla Dinámica */}
        {opcionesPivot.carreras.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-800">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 mr-1">
              🏇 Filtrar Carreras:
            </span>
            <button
              type="button"
              onClick={() => setCarrerasSeleccionadas([])}
              className={`rounded-md px-2 py-0.5 text-[11px] font-bold transition ${
                carrerasSeleccionadas.length === 0
                  ? "bg-emerald-500 text-slate-950"
                  : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              Todas ({opcionesPivot.carreras.length})
            </button>
            {opcionesPivot.carreras.map((num) => {
              const activa = carrerasSeleccionadas.includes(num);
              return (
                <button
                  key={num}
                  type="button"
                  onClick={() => alternarCarreraPivot(num)}
                  className={`rounded-md px-2 py-0.5 text-[11px] font-bold transition ${
                    activa
                      ? "bg-amber-400 text-slate-950 ring-1 ring-amber-200"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                  }`}
                  title={`Incluir o excluir Carrera ${num} en la tabla dinámica`}
                >
                  C{num}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* CONTENIDO */}
      <div className="bg-white border border-t-0 border-gray-300 rounded-b-lg shadow-sm">
        {planilla?.error && (
          <div className="mx-2 mt-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-red-700 text-xs">
            Error al generar el reporte: {planilla.error}
          </div>
        )}

        {/* REPORTE RESUMEN DE 4 COLUMNAS (SALDOS POSITIVOS / SALDOS NEGATIVOS + COMISIÓN DE LA SEMANA) */}
        {vistaPivot === "RESUMEN_4_COLUMNAS" && (
          <div className="m-3 rounded-xl border border-slate-300 bg-white shadow-sm overflow-hidden">
            {/* Parte superior: Comisión de la Semana */}
            <div className="bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 px-4 py-3 text-white flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-amber-300">
                  📑 Reporte Resumen de Saldos (4 Columnas)
                </div>
                <div className="text-base sm:text-lg font-black flex items-center gap-2 mt-0.5">
                  <span>💰 Comisión de la Semana:</span>
                  <span className="rounded-lg bg-amber-400 px-2.5 py-0.5 text-slate-950 font-mono">
                    ${fmtMonto(resumenCuatroColumnas.comisionSemana)} USD
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setClientePagoSeleccionadoId(null);
                    setPestanaModalPagos("PAGAR_GANADORES");
                    setModalPagoGanadorAbierto(true);
                  }}
                  className="rounded-md bg-emerald-500 px-2.5 py-1 font-black text-slate-950 hover:bg-emerald-400 transition shadow-sm"
                >
                  🏆 Pagar Ganadores
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPestanaModalPagos("CONCILIAR_PAGOS");
                    setModalPagoGanadorAbierto(true);
                  }}
                  className="rounded-md bg-amber-400 px-2.5 py-1 font-black text-slate-950 hover:bg-amber-300 transition shadow-sm"
                >
                  🔔 Conciliar Pagos
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setClienteCobroSeleccionado(null);
                    setModalCobroAbierto(true);
                  }}
                  className="rounded-md bg-blue-600 px-2.5 py-1 font-black text-white hover:bg-blue-500 transition shadow-sm"
                  title="Registrar cobro directo o validar reportes de pago de clientes"
                >
                  📥 Registrar Cobro / Validar Pagos
                </button>
                <button
                  type="button"
                  onClick={() => setFuenteSaldos4Col("JORNADA")}
                  className={`rounded-md px-2.5 py-1 font-bold transition ${
                    !resumenCuatroColumnas.usandoCartera
                      ? "bg-emerald-500 text-slate-950"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  Saldos del Rango ({datosTablaDinamica.filasClientes.length})
                </button>
                <button
                  type="button"
                  onClick={() => setFuenteSaldos4Col("CARTERA")}
                  className={`rounded-md px-2.5 py-1 font-bold transition ${
                    resumenCuatroColumnas.usandoCartera
                      ? "bg-emerald-500 text-slate-950"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  Cartera General ({clientesGrupo.length})
                </button>
              </div>

              {/* Filtros por modalidad de saldo / jugador */}
              <div className="flex flex-wrap items-center gap-1.5 text-xs pt-1 border-t border-slate-800">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 mr-1">
                  Filtrar modalidad:
                </span>
                <button
                  type="button"
                  onClick={() => setFiltroTipoJugador("TODOS")}
                  className={`rounded-md px-2 py-0.5 text-[11px] font-bold transition ${
                    filtroTipoJugador === "TODOS"
                      ? "bg-slate-200 text-slate-900 shadow-sm"
                      : "bg-slate-800 text-slate-400 hover:text-white"
                  }`}
                >
                  Todos ({resumenCuatroColumnas.totalJugadores})
                </button>
                <button
                  type="button"
                  onClick={() => setFiltroTipoJugador("AVAL")}
                  className={`rounded-md px-2 py-0.5 text-[11px] font-bold transition ${
                    filtroTipoJugador === "AVAL"
                      ? "bg-amber-400 text-slate-950 font-black shadow-sm"
                      : "bg-slate-800 text-amber-300 hover:bg-slate-700"
                  }`}
                  title="Se muestra el saldo actual sea positivo o negativo / aval"
                >
                  💎 Jugadores Avalados (+/-)
                </button>
                <button
                  type="button"
                  onClick={() => setFiltroTipoJugador("LIBRE")}
                  className={`rounded-md px-2 py-0.5 text-[11px] font-bold transition ${
                    filtroTipoJugador === "LIBRE"
                      ? "bg-sky-400 text-slate-950 font-black shadow-sm"
                      : "bg-slate-800 text-sky-300 hover:bg-slate-700"
                  }`}
                  title="Se muestra el saldo actual sea positivo o negativo libre"
                >
                  🔓 Jugadores Libres (+/-)
                </button>
                <button
                  type="button"
                  onClick={() => setFiltroTipoJugador("POZO")}
                  className={`rounded-md px-2 py-0.5 text-[11px] font-bold transition ${
                    filtroTipoJugador === "POZO"
                      ? "bg-emerald-400 text-slate-950 font-black shadow-sm"
                      : "bg-slate-800 text-emerald-300 hover:bg-slate-700"
                  }`}
                  title="Se muestra el saldo actual positivo de pozo"
                >
                  💰 Jugadores con Pozo (+)
                </button>
              </div>
            </div>

            {/* Tabla de 4 columnas */}
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 border-b-2 border-slate-300 text-[11px] font-black uppercase tracking-wide">
                    <th className="py-2.5 px-3 text-left text-emerald-900 bg-emerald-50/70 border-r border-slate-200">
                      Nombre de Usuario (Saldos Positivos)
                    </th>
                    <th className="py-2.5 px-3 text-right text-emerald-900 bg-emerald-50/70 border-r-2 border-slate-300 w-36">
                      Saldo (+)
                    </th>
                    <th className="py-2.5 px-3 text-left text-rose-900 bg-rose-50/70 border-r border-slate-200">
                      Nombre de Usuario (Saldos Negativos)
                    </th>
                    <th className="py-2.5 px-3 text-right text-rose-900 bg-rose-50/70 w-36">
                      Saldo (-)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {resumenCuatroColumnas.filasPareadas.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-slate-400 font-semibold">
                        Sin usuarios con saldos positivos o negativos en la selección actual.
                      </td>
                    </tr>
                  ) : (
                    resumenCuatroColumnas.filasPareadas.map((par, idx) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="py-1.5 px-3 font-bold text-slate-800 border-r border-slate-200">
                          {par.pos ? (
                            <div className="flex items-center justify-between gap-1.5">
                              <div className="flex items-center gap-1.5 truncate">
                                <span title={par.pos.etiqueta} className="text-sm shrink-0">
                                  {par.pos.icono}
                                </span>
                                <span className="truncate">{par.pos.nombre}</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setClientePagoSeleccionadoId(par.pos?.id || null);
                                  setPestanaModalPagos("PAGAR_GANADORES");
                                  setModalPagoGanadorAbierto(true);
                                }}
                                className="shrink-0 inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-black text-white hover:bg-emerald-700 transition shadow-xs"
                                title="Pagar ganancia con comprobante a este cliente"
                              >
                                💸 Pagar
                              </button>
                            </div>
                          ) : "—"}
                        </td>
                        <td className="py-1.5 px-3 text-right font-mono font-black text-emerald-700 border-r-2 border-slate-300">
                          {par.pos ? `+${fmtMonto(par.pos.saldo)}` : "—"}
                        </td>
                        <td className="py-1.5 px-3 font-bold text-slate-800 border-r border-slate-200">
                          {par.neg ? (
                            <div className="flex items-center justify-between gap-1.5">
                              <div className="flex items-center gap-1.5 truncate">
                                <span title={par.neg.etiqueta} className="text-sm shrink-0">
                                  {par.neg.icono}
                                </span>
                                <span className="truncate">{par.neg.nombre}</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setClienteCobroSeleccionado({
                                    id: par.neg?.id,
                                    nombre: par.neg?.nombre,
                                    saldo: par.neg?.saldo,
                                  });
                                  setModalCobroAbierto(true);
                                }}
                                className="shrink-0 inline-flex items-center gap-1 rounded bg-blue-600 px-2 py-0.5 text-[10px] font-black text-white hover:bg-blue-700 transition shadow-xs"
                                title="Cobrar saldo deudor o validar reporte de pago de este cliente"
                              >
                                📥 Cobrar
                              </button>
                            </div>
                          ) : "—"}
                        </td>
                        <td className="py-1.5 px-3 text-right font-mono font-black text-rose-600">
                          {par.neg ? fmtMonto(par.neg.saldo) : "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-400 bg-slate-900 text-white font-black text-xs sm:text-sm">
                    <td className="py-2.5 px-3 uppercase tracking-wide text-emerald-300 border-r border-slate-700">
                      Total a Pagar ({resumenCuatroColumnas.positivos.length} usuarios)
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-emerald-300 border-r-2 border-slate-600">
                      +${fmtMonto(resumenCuatroColumnas.totalPagar)}
                    </td>
                    <td className="py-2.5 px-3 uppercase tracking-wide text-rose-300 border-r border-slate-700">
                      Total a Cobrar ({resumenCuatroColumnas.negativos.length} usuarios)
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-rose-300">
                      -${fmtMonto(resumenCuatroColumnas.totalCobrar)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Leyenda de tipos de jugadores */}
            <div className="mt-3.5 rounded-xl border border-slate-700 bg-slate-900/90 p-3.5 text-xs text-slate-300">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-black uppercase tracking-wider text-amber-300">
                  📌 Leyenda de Modalidades de Jugadores en Reporte de Saldos:
                </span>
              </div>
              <div className="grid gap-2.5 sm:grid-cols-3">
                <div className="flex items-start gap-2 rounded-lg border border-sky-500/30 bg-sky-950/40 p-2.5">
                  <span className="text-lg shrink-0">🔓</span>
                  <div>
                    <div className="text-xs font-black text-sky-300 uppercase">Jugadores Libres</div>
                    <p className="text-[11px] text-sky-200/80 mt-0.5">
                      Saldo actual sea positivo o negativo libre (sin tope de aval).
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-950/40 p-2.5">
                  <span className="text-lg shrink-0">💎</span>
                  <div>
                    <div className="text-xs font-black text-amber-300 uppercase">Jugadores Avalados</div>
                    <p className="text-[11px] text-amber-200/80 mt-0.5">
                      Saldo actual sea positivo o negativo / aval asignado.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-950/40 p-2.5">
                  <span className="text-lg shrink-0">💰</span>
                  <div>
                    <div className="text-xs font-black text-emerald-300 uppercase">Jugadores con Pozo</div>
                    <p className="text-[11px] text-emerald-200/80 mt-0.5">
                      Saldo actual positivo de pozo acumulado.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {(!rpt || rpt.dias.length === 0) &&
          !planilla?.error &&
          vistaPivot !== "RESUMEN_4_COLUMNAS" && (
            <div className="p-8 text-center text-gray-400 text-sm">
              {cargando
                ? "Consultando saldos consolidados…"
                : hayFiltrosActivos
                  ? "No hay carreras ni jugadas que coincidan con el filtro de la tabla dinámica."
                  : "Sin actividad de tickets en el rango consultado."}
            </div>
          )}

        {/* VISTA 1: TABLA DINÁMICA RESUMEN POR CARRERAS */}
        {rpt && rpt.dias.length > 0 && vistaPivot === "PIVOT_CARRERAS" && (
          <div className="p-3 overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-800 text-white uppercase text-[10px]">
                  <th className="py-2 px-2.5">Fecha</th>
                  <th className="py-2 px-2.5">Hipódromo</th>
                  <th className="py-2 px-2.5 text-center">Carrera</th>
                  <th className="py-2 px-2.5">Pizarra</th>
                  <th className="py-2 px-2.5 text-right">Jugadas</th>
                  <th className="py-2 px-2.5 text-right">⚡ En Vivo</th>
                  <th className="py-2 px-2.5 text-right">⏳ Adelantadas</th>
                  <th className="py-2 px-2.5 text-right">Volumen Apostado</th>
                  <th className="py-2 px-2.5 text-right">🟢 Ganan (+)</th>
                  <th className="py-2 px-2.5 text-right">🔴 Pierden (-)</th>
                  <th className="py-2 px-2.5 text-right">Subtotal Casa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {datosTablaDinamica.filasCarreras.map((fc) => (
                  <tr key={fc.clave} className="hover:bg-blue-50/40">
                    <td className="py-1.5 px-2.5 font-mono font-semibold text-gray-700">{fc.fecha}</td>
                    <td className="py-1.5 px-2.5 font-bold text-blue-900">🏇 {fc.hipodromo}</td>
                    <td className="py-1.5 px-2.5 text-center font-black text-gray-900">C{fc.numero}</td>
                    <td className="py-1.5 px-2.5 font-mono text-gray-600">{fc.pizarra || "—"}</td>
                    <td className="py-1.5 px-2.5 text-right font-bold">{fc.jugadasVisibles}</td>
                    <td className="py-1.5 px-2.5 text-right text-emerald-700 font-semibold">{fc.enVivo}</td>
                    <td className="py-1.5 px-2.5 text-right text-amber-700 font-semibold">{fc.adelantadas}</td>
                    <td className="py-1.5 px-2.5 text-right font-mono">{fmtMonto(fc.apostado)}</td>
                    <td className="py-1.5 px-2.5 text-right font-mono text-green-700 font-bold">
                      +{fmtMonto(fc.ganan)}
                    </td>
                    <td className="py-1.5 px-2.5 text-right font-mono text-red-600 font-bold">
                      {fmtMonto(fc.pierden)}
                    </td>
                    <td className="py-1.5 px-2.5 text-right">
                      <TotalBadge v={fc.subtotal} small />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* VISTA 2: MATRIZ DINÁMICA CLIENTE × CARRERA */}
        {rpt && rpt.dias.length > 0 && vistaPivot === "PIVOT_CLIENTE_CARRERA" && (
          <div className="p-3 overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-800 text-white uppercase text-[10px]">
                  <th className="py-2 px-2.5 sticky left-0 bg-slate-800 z-10">Cliente / Jugador</th>
                  {datosTablaDinamica.filasCarreras.map((fc) => (
                    <th key={fc.clave} className="py-2 px-2 text-right whitespace-nowrap">
                      <div>{fc.hipodromo}</div>
                      <div className="text-amber-300 font-black">C{fc.numero}</div>
                    </th>
                  ))}
                  <th className="py-2 px-2.5 text-right bg-slate-900">Neto Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {datosTablaDinamica.filasClientes.map((row) => (
                  <tr key={row.cliente} className="hover:bg-blue-50/40">
                    <td className="py-1.5 px-2.5 font-black text-slate-800 sticky left-0 bg-white">
                      {(() => {
                        const meta = mapaInfoClientes.get(row.cliente);
                        return (
                          <div className="flex items-center gap-1.5">
                            <span title={meta?.etiqueta} className="text-sm shrink-0">
                              {meta?.icono ?? "💎"}
                            </span>
                            <span className="truncate">{row.cliente}</span>
                          </div>
                        );
                      })()}
                    </td>
                    {datosTablaDinamica.filasCarreras.map((fc) => {
                      const val = row.porCarrera[fc.clave] ?? null;
                      return (
                        <td key={fc.clave} className="py-1.5 px-2 text-right font-mono whitespace-nowrap">
                          <Signo v={val} />
                        </td>
                      );
                    })}
                    <td className="py-1.5 px-2.5 text-right font-mono bg-slate-50">
                      <Signo v={row.netoTotal} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-100 border-t-2 border-slate-300 font-bold">
                  <td className="py-2 px-2.5 uppercase text-[10px] text-slate-700 sticky left-0 bg-slate-100">
                    Subtotal Carrera
                  </td>
                  {datosTablaDinamica.filasCarreras.map((fc) => (
                    <td key={fc.clave} className="py-2 px-2 text-right whitespace-nowrap">
                      <TotalBadge v={fc.subtotal} small />
                    </td>
                  ))}
                  <td className="py-2 px-2.5 text-right whitespace-nowrap">
                    <TotalBadge v={rpt.totalSemana} small />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* VISTA 3: JERARQUÍA CLÁSICA (DÍA → HIPÓDROMO → CARRERA) FILTRADA */}
        {vistaPivot === "JERARQUIA" &&
          rpt?.dias.map((dia) => {
            const abiertoDia = !abiertos.has(`D-${dia.fecha}`);
            const fechaLegible = new Date(dia.fecha + "T12:00:00");
            const nombreDia = etiquetaDia(
              fechaLegible.getDay() === 0 ? 7 : fechaLegible.getDay()
            );
            const esHoy = dia.fecha === hoy;
            return (
              <div key={dia.fecha} className="pb-3">
                {/* CABECERA DEL DÍA */}
                <button
                  onClick={() => alternar(`D-${dia.fecha}`)}
                  className="w-full flex items-center justify-between bg-gray-800 text-white px-3 py-2 font-bold hover:bg-gray-700"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${
                        abiertoDia ? "bg-emerald-400" : "bg-gray-500"
                      }`}
                    />
                    {dia.fecha} · {nombreDia}
                    {esHoy && (
                      <span className="rounded bg-amber-400 text-black px-1.5 text-[10px] uppercase">
                        Hoy
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-2">
                    {dia.hipodromos.length} hipódromo(s) · <TotalBadge v={dia.totalDia} />
                  </span>
                </button>

                {abiertoDia &&
                  dia.hipodromos.map((hipo) => {
                    const abiertoHipo = !abiertos.has(`H-${dia.fecha}-${hipo.nombre}`);
                    return (
                      <div key={hipo.nombre} className="mx-2 mt-2">
                        {/* HIPÓDROMO */}
                        <button
                          onClick={() => alternar(`H-${dia.fecha}-${hipo.nombre}`)}
                          className="w-full flex items-center justify-between bg-blue-50 border border-blue-200 rounded px-3 py-1.5 text-sm font-bold text-blue-900 hover:bg-blue-100"
                        >
                          <span>🏇 {hipo.nombre}</span>
                          <span className="flex items-center gap-2">
                            {hipo.carreras.length} carrera(s) · <TotalBadge v={hipo.subtotal} small />
                          </span>
                        </button>

                        {abiertoHipo &&
                          hipo.carreras.map((carrera) => {
                            const filasVisibles = carrera.filas.filter(
                              (f) => f.jugada !== "Bono por Cruce de jugadas"
                            );
                            const claveCarrera = `C-${dia.fecha}-${hipo.nombre}-${carrera.numero}`;
                            const abiertaCarrera = carrerasAbiertas.has(claveCarrera);
                            return (
                              <div
                                key={carrera.numero}
                                className="mt-1.5 rounded border border-gray-300 overflow-hidden shadow-sm"
                              >
                                <button
                                  type="button"
                                  onClick={() => alternarCarreraDetalle(claveCarrera)}
                                  title={
                                    abiertaCarrera
                                      ? "Contraer las jugadas de esta carrera"
                                      : "Desplegar las jugadas de esta carrera"
                                  }
                                  className="w-full bg-blue-50 border-b border-gray-300 px-2.5 py-1.5 flex flex-wrap justify-between items-center gap-2 text-left text-gray-800 hover:bg-blue-100 transition-colors"
                                >
                                  <div className="flex flex-wrap items-center gap-2.5 font-bold">
                                    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded bg-blue-200 text-[10px] font-black text-blue-900">
                                      {abiertaCarrera ? "▾" : "▸"}
                                    </span>
                                    <span>🏁 Carrera {carrera.numero}</span>
                                    <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-500 border border-blue-200">
                                      {filasVisibles.length} jugada(s)
                                    </span>
                                    {carrera.pizarra ? (
                                      <span className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-0.5 text-[10px] font-black text-slate-700 border border-blue-200 shadow-sm">
                                        <span className="text-slate-400 uppercase mr-0.5">Pizarra:</span>
                                        {carrera.pizarra
                                          .split(/\s*·\s*/)
                                          .filter(Boolean)
                                          .map((num, idx) => (
                                            <span
                                              key={idx}
                                              className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-black shadow-sm border ${colorDiscoNumero(num)}`}
                                              title={`${idx + 1}º lugar: #${num}`}
                                            >
                                              {num}
                                            </span>
                                          ))}
                                        {carrera.retirados && carrera.retirados.length > 0 && (
                                          <span className="ml-1.5 inline-flex items-center gap-1 pl-1.5 border-l border-slate-200">
                                            <span className="text-rose-700 font-black">RET:</span>
                                            {carrera.retirados.map((numRet, idxR) => (
                                              <span
                                                key={`ret-${idxR}-${numRet}`}
                                                className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-black shadow-sm border ${colorDiscoNumero(numRet)}`}
                                              >
                                                {numRet}
                                              </span>
                                            ))}
                                          </span>
                                        )}
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 border border-amber-200">
                                        ⏳ Pizarra pendiente
                                      </span>
                                    )}
                                  </div>
                                  <TotalBadge v={carrera.subtotal} small />
                                </button>
                                {abiertaCarrera && (
                                  <table className="w-full text-left border-collapse">
                                    <thead>
                                      <tr className="border-b border-gray-200 bg-gray-50 text-gray-600 text-[11px] uppercase">
                                        <th className="py-0.5 px-2 w-16">Hora</th>
                                        <th className="py-0.5 px-2 w-24">Rol</th>
                                        <th className="py-0.5 px-2">Jugada</th>
                                        <th className="py-0.5 px-2 w-20 text-center">Caballo</th>
                                        <th className="py-0.5 px-2">Cliente</th>
                                        <th className="py-0.5 px-2 w-24 text-right">Monto</th>
                                        <th className="py-0.5 px-2 w-28 text-right">Resultado</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {filasVisibles.map((f) => (
                                        <tr
                                          key={f.id}
                                          className={`border-b border-gray-100 last:border-0 hover:bg-gray-50 ${
                                            f.rol === "CRUCE" ? "bg-amber-50" : ""
                                          }`}
                                        >
                                          <td className="py-0.5 px-2 font-mono text-[10px] font-bold text-slate-500 whitespace-nowrap">
                                            {f.horaCarga ? `🕒 ${f.horaCarga}` : "—"}
                                          </td>
                                          <td className="py-0.5 px-2">
                                            {f.rol === "CRUCE" ? (
                                              <span className="bg-amber-500 text-white text-[10px] uppercase font-bold px-2 py-0.5 rounded-full">
                                                🔀 {f.rol}
                                              </span>
                                            ) : (
                                              <span className="bg-gray-500 text-white text-[10px] uppercase font-bold px-2 py-0.5 rounded-full">
                                                {f.rol}
                                              </span>
                                            )}
                                          </td>
                                          <td className="py-0.5 px-2 font-medium text-gray-800">
                                            {etiquetaJugada(f.jugada)}
                                            {rotuloPareo(f.jugada, f.caballo) && (
                                              <span className="ml-1 rounded bg-blue-600 text-white text-[9px] font-bold px-1 py-0.5">
                                                {rotuloPareo(f.jugada, f.caballo)}
                                              </span>
                                            )}
                                          </td>
                                          <td className="py-0.5 px-2 text-center font-bold text-gray-700">
                                            {caballoPareoLegible(f.caballo) || "—"}
                                          </td>
                                          <td className="py-0.5 px-2 text-gray-500 text-xs">{f.cliente}</td>
                                          <td className="py-0.5 px-2 text-right text-gray-600">
                                            {f.monto > 0 ? fmtMonto(f.monto) : ""}
                                          </td>
                                          <td className="py-0.5 px-2 text-right">
                                            {f.resultado === 0 &&
                                            carrera.pizarra &&
                                            (f.tipoJugada === "MARCA" ||
                                              /^MARCAS?\b/i.test(String(f.jugada ?? ""))) ? (
                                              <span className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-black uppercase text-amber-800 border border-amber-300">
                                                SIN DECISIÓN
                                              </span>
                                            ) : (
                                              <Signo v={f.resultado} vacio={f.rol === "CRUCE"} />
                                            )}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                )}
                              </div>
                            );
                          })}
                      </div>
                    );
                  })}
              </div>
            );
          })}

        {/* TOTAL DEL DÍA SUMARIO + FOOTER */}
        {rpt && rpt.dias.length > 0 && (
          <>
            {rpt.dias.map((dia) => (
              <div
                key={dia.fecha}
                className="mx-2 mt-3 bg-red-100 border border-red-200 text-red-800 px-3 py-2 rounded flex justify-between font-bold items-center shadow-sm"
              >
                <span className="flex items-center">
                  📉 Total apuestas de <b className="ml-1 font-mono text-xs">{dia.fecha}</b>:
                </span>
                <span>{fmtMonto(dia.totalDia)} USD</span>
              </div>
            ))}
            <div
              className={`px-3 py-3 border-t flex justify-between font-bold text-sm ${
                rpt.totalSemana < 0 ? "bg-red-600 text-white" : "bg-green-700 text-white"
              }`}
            >
              <span>
                📊 TOTAL DE LA SEMANA ({rpt.inicio} → {rpt.fin})
              </span>
              <span>
                {rpt.totalSemana >= 0 ? "+" : ""}
                {fmtMonto(rpt.totalSemana)} USD
              </span>
            </div>
          </>
        )}

        {/* Leyenda general al final de la lista */}
        <div className="bg-slate-100 p-3 border-t border-slate-300 text-xs text-slate-700">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-black uppercase tracking-wider text-slate-800">
              📌 Leyenda:
            </span>
            <div className="flex flex-wrap items-center gap-4 text-[11px]">
              <span className="inline-flex items-center gap-1 font-semibold">
                <span>🔓</span> <b>Jugadores Libres:</b> Saldo actual (+/-) libre
              </span>
              <span className="inline-flex items-center gap-1 font-semibold">
                <span>💎</span> <b>Jugadores Avalados:</b> Saldo actual (+/-) / aval
              </span>
              <span className="inline-flex items-center gap-1 font-semibold">
                <span>💰</span> <b>Jugadores con Pozo:</b> Saldo actual (+) de pozo
              </span>
            </div>
          </div>
        </div>

        <div className="bg-gray-50 p-3 border-t border-gray-300 text-center text-[10px] text-gray-500">
          ✨ Reporte de saldos consolidados · motor oficial (NINI, PP, PAREO, TABLAS, CRUCE NETO) ·
          filtro tipo Tabla Dinámica habilitado
        </div>
      </div>

      {modalPagoGanadorAbierto && (
        <ModalPagoAGanadorYConciliacion
          grupoId={grupoId || null}
          abierto={modalPagoGanadorAbierto}
          onCerrar={() => {
            setModalPagoGanadorAbierto(false);
            setClientePagoSeleccionadoId(null);
          }}
          onPagoRealizado={() => {
            void cargar();
          }}
          clientePreseleccionadoId={clientePagoSeleccionadoId || undefined}
          pestanaInicial={pestanaModalPagos}
        />
      )}

      {modalCobroAbierto && (
        <ModalCobroYValidacionCliente
          abierto={modalCobroAbierto}
          onCerrar={() => {
            setModalCobroAbierto(false);
            setClienteCobroSeleccionado(null);
          }}
          grupoId={grupoId || null}
          clienteInicial={clienteCobroSeleccionado}
          onOperacionCompletada={() => {
            void cargar();
            if (grupoId) {
              void listarClientes(true, grupoId).then(setClientesGrupo).catch(() => {});
            }
          }}
        />
      )}

      <ToastHost />
    </div>
  );
}

export default ReporteModule;
