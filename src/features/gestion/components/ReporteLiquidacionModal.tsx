"use client";

import { useEffect, useMemo, useState } from "react";
import { hoyLocal } from "@/features/gaceta/lib/programa";
import { cargarCarrerasDelDia } from "@/features/carreras/lib/carreras-dia";
import type { CarreraDelDia } from "@/shared/store/useCarrerasDiaStore";
import {
  carreraReporteDetalle,
  type CarreraReporte,
} from "@/features/liquidacion/lib/reportes";
import { armarReporteCarrera } from "@/features/liquidacion/lib/reporte-carrera";
import { lookupDisponible } from "@/features/taquilla/lib/reparto";
import { listarClientes, type ClienteRow } from "@/features/clientes/lib/clientes";
import { exportarReporteCarreraImagen } from "@/features/liquidacion/lib/reporte-imagen";
import { listarGruposAdmin, type GrupoRow } from "@/features/grupos/lib/grupos";
import { logosFrescosDeCarrera } from "@/features/liquidacion/lib/logos-reporte";
import { conCacheBust } from "@/shared/lib/logos";
import { useVersionLogos } from "@/shared/store/useHipodromosStore";
import { grupoActivoVigente } from "@/features/seguridad/lib/vigente";
import { nombreHipodromoParaMostrar } from "@/features/hipodromos/lib/nombre";
import { claveHipodromo } from "@/features/carreras/lib/claves";
import { listarHipodromos } from "@/features/hipodromos/lib/servicio";
import type { Hipodromo } from "@/features/hipodromos/lib/tipos";
import { EmptyState } from "@/shared/components/ui/EmptyState";
import { DateInput } from "@/shared/components/ui/DateInput";
import ReporteCarrera, { type ReporteCarreraDatos } from "@/features/saldos/components/ReporteCarrera";
import ManualLiquidacion from "@/features/gestion/components/ManualLiquidacion";
import WhatsappReporteCarrera from "@/features/liquidacion/components/WhatsappReporteCarrera";
import {
  BarraCarrerasLiquidadas,
  type ItemCarreraLiquidada,
} from "@/features/gestion/components/BarraCarrerasLiquidadas";
import {
  OPCIONES_FILTRO,
  type FiltroModalidadTiempo,
} from "@/features/jugadas/lib/modalidad-tiempo";

const toast = (msg: string, tipo: "success" | "warning" | "error" | "info" = "info") =>
  window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));

type Props = {
  abierto: boolean;
  onCerrar: () => void;
  /** Hipódromo ya elegido en Gestión de Jugadas (se conserva al abrir). */
  hipodromoInicial?: string;
  /** Carrera ya elegida en Gestión de Jugadas. */
  carreraInicial?: number;
  /** Fecha de la jornada en curso. */
  fechaInicial?: string;
  /** Cuando viene directo de liquidar una carrera, muestra exclusivamente esa carrera liquidada. */
  modoExclusivoLiquidacion?: boolean;
};

/** Fecha de ayer (ISO local) para el atajo «Ayer». */
function ayer(fecha: string): string {
  const [y, m, d] = fecha.split("-").map(Number);
  if (!y || !m || !d) return fecha;
  const f = new Date(y, m - 1, d);
  f.setDate(f.getDate() - 1);
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}-${String(f.getDate()).padStart(2, "0")}`;
}

/**
 * REPORTE DE LIQUIDACIÓN — motor de reporte filtrable y descargable.
 *
 * Es la cara visible del motor de liquidación dentro de Gestión de Jugadas:
 * filtra en cascada por fecha (recientes o pasados), hipódromo (ubicación) y
 * carrera, arma la plantilla `ReporteCarrera` con los datos REALES de la
 * liquidación y permite mostrar / descargar la imagen (PNG/JPG) o imprimirla.
 *
 * Toda jugada de posición se muestra bajo la etiqueta universal
 * "Jugadas de Puestos" (nunca "fijas", "fraccionadas", "con nini" o "de bloques").
 */
export default function ReporteLiquidacionModal({
  abierto,
  onCerrar,
  hipodromoInicial,
  carreraInicial,
  fechaInicial,
  modoExclusivoLiquidacion = false,
}: Props) {
  const [fecha, setFecha] = useState(fechaInicial || hoyLocal());
  const [grupos, setGrupos] = useState<GrupoRow[]>([]);
  const [grupoId, setGrupoId] = useState(() => String(grupoActivoVigente() || ""));
  const [carrerasDia, setCarrerasDia] = useState<CarreraDelDia[]>([]);
  const [hipodromo, setHipodromo] = useState(hipodromoInicial ? hipodromoInicial.trim().toUpperCase() : "");
  const [carrera, setCarrera] = useState<number>(carreraInicial ?? 0);
  const [datos, setDatos] = useState<ReporteCarreraDatos | null>(null);
  /**
   * Filtro segmentado de MODALIDAD DE TIEMPO del reporte (PROMPT #4):
   * `TODAS` = el reporte completo como siempre; `EN_VIVO` / `ADELANTADA` dejan
   * solo una porción de las jugadas y RECALCULAN filas y subtotales (va al
   * motor en `armarReporteCarrera`, no se filtra en el render). Se resetea al
   * abrir para que cada apertura arranque con el reporte completo.
   */
  const [filtroModalidad, setFiltroModalidad] = useState<FiltroModalidadTiempo>("TODAS");
  const [cargandoDia, setCargandoDia] = useState(false);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [manualAbierto, setManualAbierto] = useState(false);
  const [clientes, setClientes] = useState<ClienteRow[]>([]);
  /** Catálogo con `logo_url` para la cabecera del reporte. */
  const [catalogoHipodromos, setCatalogoHipodromos] = useState<Hipodromo[]>([]);
  // Versión global de logos: cambia cuando alguien carga/actualiza un logo.
  const versionLogos = useVersionLogos();

  // Logos de los hipódromos: la cabecera azul los pinta desde acá. Se relee
  // CADA VEZ que se abre el modal Y cada vez que se actualiza un logo, para que
  // un logo incorporado mientras el reporte está abierto aparezca sin recargar.
  useEffect(() => {
    if (!abierto) return;
    let vivo = true;
    listarHipodromos()
      .then((r) => vivo && setCatalogoHipodromos(r.data))
      .catch(() => vivo && setCatalogoHipodromos([]));
    return () => {
      vivo = false;
    };
  }, [abierto, versionLogos]);

  // Ítem 10: cartera de clientes para saber el disponible (saldo + aval) y
  // marcar con asterisco a quien arriesgó más de lo que dispone.
  useEffect(() => {
    let vivo = true;
    listarClientes(true, grupoId || null)
      .then((cs) => vivo && setClientes(cs))
      .catch(() => vivo && setClientes([]));
    return () => {
      vivo = false;
    };
  }, [grupoId]);

  const disponibleDe = useMemo(() => lookupDisponible(clientes), [clientes]);
  const crucesSnapshot = useMemo(
    () =>
      carrerasDia.find(
        (c) =>
          String(c.hipodromo).trim().toUpperCase() === hipodromo.trim().toUpperCase() &&
          Number(c.carrera) === Number(carrera)
      )?.cruces_carrera_override,
    [carrera, carrerasDia, hipodromo]
  );

  // Al abrir: arrancar desde la jornada/carrera en curso.
  useEffect(() => {
    if (!abierto) return;
    setFecha(fechaInicial || hoyLocal());
    setHipodromo(hipodromoInicial ? hipodromoInicial.trim().toUpperCase() : "");
    setCarrera(carreraInicial ? Number(carreraInicial) : 0);
    setFiltroModalidad("TODAS");
    setDatos(null);
  }, [abierto, fechaInicial, hipodromoInicial, carreraInicial]);

  // Grupos hípicos (para el encabezado del reporte). Se releen al ABRIR y se
  // fuerza el salto del caché (`true`), porque el caché de grupos quedaba viejo
  // tras incorporar/editar el logo del grupo.
  useEffect(() => {
    if (!abierto) return;
    let vivo = true;
    listarGruposAdmin(true)
      .then((gs) => {
        if (!vivo) return;
        setGrupos(gs);
        const activo = grupoActivoVigente();
        const elegido = (activo && gs.find((g) => String(g.id) === String(activo))) || null;
        const principal = elegido ?? gs.find((g) => g.es_principal) ?? gs[0];
        if (principal?.id != null) setGrupoId(String(principal.id));
      })
      .catch(() => vivo && setGrupos([]));
    return () => {
      vivo = false;
    };
  }, [abierto, versionLogos]);

  // Carreras de la fecha (liquidadas o en curso con pre-jugadas).
  useEffect(() => {
    if (!abierto) return;
    if (modoExclusivoLiquidacion && hipodromoInicial && carreraInicial) {
      setCarrerasDia([
        {
          fecha: fechaInicial || fecha,
          hipodromo: hipodromoInicial.trim().toUpperCase(),
          carrera: Number(carreraInicial),
          estado: "Liquidada",
          aplicado_a_tablas: true,
          ventas: [],
          ganadores: [],
        },
      ]);
      setCargandoDia(false);
      return;
    }
    let vivo = true;
    setCargandoDia(true);
    cargarCarrerasDelDia(fecha)
      .then((cs) => {
        if (!vivo) return;
        const delDia = cs.filter((c) => c.fecha === fecha);
        if (
          hipodromoInicial &&
          carreraInicial &&
          (!fechaInicial || fecha === fechaInicial) &&
          !delDia.some(
            (c) =>
              claveHipodromo(c.hipodromo) === claveHipodromo(hipodromoInicial) &&
              Number(c.carrera) === Number(carreraInicial)
          )
        ) {
          delDia.push({
            fecha,
            hipodromo: hipodromoInicial.trim().toUpperCase(),
            carrera: Number(carreraInicial),
            estado: "Liquidada",
            aplicado_a_tablas: true,
            ventas: [],
            ganadores: [],
          });
        }
        setCarrerasDia(delDia);
      })
      .catch(() => vivo && setCarrerasDia([]))
      .finally(() => vivo && setCargandoDia(false));
    return () => {
      vivo = false;
    };
  }, [abierto, fecha, hipodromoInicial, carreraInicial, fechaInicial, modoExclusivoLiquidacion]);

  const hipodromosDisp = useMemo(() => {
    const set = new Set<string>();
    for (const c of carrerasDia) {
      const h = String(c.hipodromo || "").trim().toUpperCase();
      if (h) set.add(h);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "es"));
  }, [carrerasDia]);

  // Cascada fecha → hipódromo.
  useEffect(() => {
    if (modoExclusivoLiquidacion && hipodromoInicial) {
      setHipodromo(hipodromoInicial.trim().toUpperCase());
      return;
    }
    if (!hipodromosDisp.length) {
      if (!cargandoDia && !hipodromoInicial) {
        setHipodromo("");
        setCarrera(0);
        setDetalle(null);
        setDatos(null);
      }
      return;
    }
    setHipodromo((prev) => {
      const objetivo = prev || (hipodromoInicial ? hipodromoInicial.trim().toUpperCase() : "");
      if (objetivo) {
        if (hipodromosDisp.includes(objetivo)) return objetivo;
        const porClave = hipodromosDisp.find((h) => claveHipodromo(h) === claveHipodromo(objetivo));
        if (porClave) return porClave;
      }
      return hipodromosDisp[0];
    });
  }, [hipodromosDisp, cargandoDia, hipodromoInicial, modoExclusivoLiquidacion]);

  const carrerasDisp = useMemo(
    () =>
      carrerasDia
        .filter((c) => claveHipodromo(c.hipodromo) === claveHipodromo(hipodromo))
        .map((c) => Number(c.carrera))
        .filter((n) => n > 0)
        .sort((a, b) => a - b),
    [carrerasDia, hipodromo]
  );

  // Cascada hipódromo → carrera.
  useEffect(() => {
    if (modoExclusivoLiquidacion && carreraInicial) {
      setCarrera(Number(carreraInicial));
      return;
    }
    if (!carrerasDisp.length) {
      if (!cargandoDia && !carreraInicial) {
        setCarrera(0);
        setDetalle(null);
        setDatos(null);
      }
      return;
    }
    setCarrera((prev) => {
      const inicialMismoHipo =
        carreraInicial &&
        hipodromoInicial &&
        claveHipodromo(hipodromo) === claveHipodromo(hipodromoInicial)
          ? Number(carreraInicial)
          : 0;
      if (inicialMismoHipo && carrerasDisp.includes(inicialMismoHipo)) return inicialMismoHipo;
      if (prev && carrerasDisp.includes(prev)) return prev;
      return carrerasDisp[0];
    });
  }, [carrerasDisp, cargandoDia, carreraInicial, hipodromoInicial, hipodromo, modoExclusivoLiquidacion]);

  const nombreGrupo = useMemo(
    () => grupos.find((g) => String(g.id) === grupoId)?.nombre ?? "Grupo Hípico",
    [grupos, grupoId]
  );

  const logoGrupo = useMemo(
    () => conCacheBust(grupos.find((g) => String(g.id) === grupoId)?.logo_url ?? null, versionLogos),
    [grupos, grupoId, versionLogos]
  );

  const logoHipodromo = useMemo(() => {
    const buscado = hipodromo.trim().toUpperCase();
    if (!buscado) return null;
    const url =
      catalogoHipodromos.find((h) => h.nombre.trim().toUpperCase() === buscado)?.logo_url ?? null;
    return conCacheBust(url, versionLogos);
  }, [catalogoHipodromos, hipodromo, versionLogos]);

  /**
   * Solo una carrera pagada/liquidada muestra pizarra, resultados y resumen.
   * En `carrerasDia` el estado central (`aplicado_a_tablas`) es la verdad.
   */
  const liquidada = useMemo(() => {
    if (modoExclusivoLiquidacion) return true;
    const c = carrerasDia.find(
      (x) =>
        String(x.hipodromo || "").trim().toUpperCase() === hipodromo &&
        Number(x.carrera) === Number(carrera)
    );
    if (!c) return false;
    return (
      c.aplicado_a_tablas === true ||
      String(c.estado ?? "").toLowerCase() === "liquidada" ||
      (Array.isArray(c.ganadores) && c.ganadores.length > 0)
    );
  }, [carrerasDia, hipodromo, carrera, modoExclusivoLiquidacion]);

  // Motor: trae la carrera liquidada y los logos FRESCOS en paralelo con el
  // detalle. Se hace UNA sola vez por carrera elegida: el filtro de modalidad de
  // tiempo (⏳ adelantadas / ⚡ en vivo) recalcula la plantilla EN MEMORIA y no
  // vuelve a tocar la base, así el cambio de filtro es instantáneo.
  const [detalle, setDetalle] = useState<{
    reporte: CarreraReporte;
    frescos: { logoHipodromo: string | null; logoGrupo: string | null };
  } | null>(null);

  useEffect(() => {
    const fechaActiva = modoExclusivoLiquidacion && fechaInicial ? fechaInicial : fecha;
    const hipoActivo =
      modoExclusivoLiquidacion && hipodromoInicial
        ? hipodromoInicial.trim().toUpperCase()
        : hipodromo;
    const carrActiva =
      modoExclusivoLiquidacion && carreraInicial ? Number(carreraInicial) : carrera;

    if (!abierto || !hipoActivo || !carrActiva) {
      setDetalle(null);
      return;
    }
    let vivo = true;
    setCargandoDetalle(true);
    // Logos FRESCOS en el momento de armar el reporte: no dependemos de que el
    // catálogo cargado al abrir ya tenga el logo recién incorporado. Se
    // resuelven contra la base en paralelo con el detalle de la carrera.
    const logoGrupoId = grupoId || grupoActivoVigente() || undefined;
    Promise.all([
      carreraReporteDetalle(fechaActiva, hipoActivo, carrActiva),
      logosFrescosDeCarrera({ hipodromo: hipoActivo, grupoId: logoGrupoId }),
    ])
      .then(([c, frescos]) => {
        if (!vivo) return;
        if (!c) return setDetalle(null);
        setDetalle({ reporte: c, frescos });
      })
      .catch(() => vivo && setDetalle(null))
      .finally(() => vivo && setCargandoDetalle(false));
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, fecha, hipodromo, carrera, modoExclusivoLiquidacion, fechaInicial, hipodromoInicial, carreraInicial]);

  // Armado de la plantilla: corre por cada detalle nuevo Y por cada cambio del
  // filtro segmentado de modalidad de tiempo (recalcula filas y subtotales).
  useEffect(() => {
    if (!detalle) {
      setDatos(null);
      return;
    }
    setDatos(
      armarReporteCarrera(detalle.reporte, nombreGrupo, disponibleDe, {
        liquidada: liquidada || Boolean(detalle.reporte.pizarra),
        // El fresco manda; si no se pudo leer, cae al catálogo en memoria.
        logoHipodromo: detalle.frescos.logoHipodromo ?? logoHipodromo,
        logoGrupo: detalle.frescos.logoGrupo ?? logoGrupo,
        filtroModalidad,
      })
    );
  }, [detalle, nombreGrupo, disponibleDe, liquidada, logoHipodromo, logoGrupo, filtroModalidad]);

  const itemsLiquidadasExtra = useMemo<ItemCarreraLiquidada[]>(() => {
    return carrerasDia
      .filter(
        (c) =>
          (c.ganadores && c.ganadores.length > 0) ||
          c.aplicado_a_tablas === true ||
          String(c.estado ?? "").toLowerCase() === "liquidada"
      )
      .map((c) => {
        const cAny = c as unknown as Record<string, unknown>;
        return {
          fecha: c.fecha,
          carrera: Number(c.carrera),
          hipodromo: String(c.hipodromo || "").trim().toUpperCase(),
          pizarra:
            Array.isArray(c.ganadores) && c.ganadores.length > 0
              ? c.ganadores.slice(0, 5).join("-")
              : "Oficial",
          jugadas: 0,
          totalJugadas: 0,
          liquidada: true,
          liquidada_at: (cAny.liquidada_at ?? cAny.updated_at ?? null) as string | null,
        };
      });
  }, [carrerasDia]);

  if (!abierto) return null;

  const nombreArchivo = `reporte_liquidacion_${String(hipodromo || "carrera").replace(/[^a-z0-9]+/gi, "_")}_C${carrera || ""}`;

  const descargar = (formato: "PNG" | "JPG") =>
    void exportarReporteCarreraImagen(formato, nombreArchivo).then((ok) =>
      ok
        ? toast(`Imagen ${formato} del reporte generada.`, "success")
        : toast("No se pudo capturar el reporte como imagen.", "error")
    );

  const hayCarreras = carrerasDia.length > 0;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#eef2f7]">
      <div className="min-h-screen">
        {/* Barra superior */}
        <div className="sticky top-0 z-10 border-b border-slate-300 bg-slate-900 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-black text-white">🧾 Reporte de Liquidación</span>

            {modoExclusivoLiquidacion ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/50 bg-amber-400/15 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-amber-300">
                <span>🏆</span>
                <span>
                  {nombreHipodromoParaMostrar(hipodromo)} · Carrera #{carrera} · 📅 {fecha}
                </span>
              </span>
            ) : (
              <>
                <div className="ml-1 flex items-center gap-1.5 font-bold text-slate-300">
                  <span>Fecha</span>
                  <DateInput
                    value={fecha}
                    onFechaChange={(val) => setFecha(val || hoyLocal())}
                    className="w-32 py-1 px-2 text-[11px] font-bold !bg-white !text-black border-slate-300"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setFecha(hoyLocal())}
                  className="rounded border border-slate-600 px-2 py-1 font-bold text-slate-200 hover:bg-slate-700"
                >
                  Hoy
                </button>
                <button
                  type="button"
                  onClick={() => setFecha((f) => ayer(f))}
                  className="rounded border border-slate-600 px-2 py-1 font-bold text-slate-200 hover:bg-slate-700"
                >
                  Ayer
                </button>

                <label className="flex items-center gap-1 font-bold text-slate-300">
                  Grupo
                  <select
                    value={grupoId}
                    onChange={(e) => setGrupoId(e.target.value)}
                    className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-[11px] font-bold text-white"
                  >
                    {grupos.length === 0 && <option value="">— sin grupos —</option>}
                    {grupos.map((g) => (
                      <option key={String(g.id)} value={String(g.id)}>
                        {g.nombre}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex items-center gap-1 font-bold text-slate-300">
                  Hipódromo
                  <select
                    value={hipodromo}
                    onChange={(e) => setHipodromo(e.target.value)}
                    className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-[11px] font-bold text-white"
                  >
                    {hipodromosDisp.length === 0 && <option value="">—</option>}
                    {hipodromosDisp.map((h) => (
                      <option key={h} value={h}>
                        {nombreHipodromoParaMostrar(h)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex items-center gap-1 font-bold text-slate-300">
                  Carrera
                  <select
                    value={String(carrera)}
                    onChange={(e) => setCarrera(Number(e.target.value))}
                    className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-[11px] font-bold text-white"
                  >
                    {carrerasDisp.length === 0 && <option value="">—</option>}
                    {carrerasDisp.map((n) => (
                      <option key={n} value={String(n)}>
                        C{n}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}

            {/* FILTRO SEGMENTADO DE MODALIDAD DE TIEMPO (PROMPT #4)
                Toca el MOTOR (armarReporteCarrera), no el render: al elegir una
                opción se rearma la plantilla con las filas visibles y los
                subtotales (Ganan/Pierden, riesgo, Parada Adelantadas) ya
                recalculados. `Todas` es el reporte completo, como siempre. */}
            <div
              role="group"
              aria-label="Filtro de modalidad de tiempo de las jugadas"
              className="flex items-center overflow-hidden rounded-md border border-slate-600 bg-slate-800"
            >
              {OPCIONES_FILTRO.map((op) => {
                const activo = filtroModalidad === op.id;
                return (
                  <button
                    key={op.id}
                    type="button"
                    aria-pressed={activo}
                    onClick={() => setFiltroModalidad(op.id)}
                    title={
                      op.id === "TODAS"
                        ? "Ver todas las jugadas de la carrera"
                        : op.id === "EN_VIVO"
                          ? "Ver solo las jugadas ⚡ en vivo (cargadas durante la carrera)"
                          : "Ver solo las jugadas ⏳ adelantadas (cargadas antes de la carrera)"
                    }
                    className={`px-2 py-1 text-[11px] font-bold transition ${
                      activo ? "bg-amber-400 text-slate-950" : "text-slate-300 hover:bg-slate-700"
                    }`}
                  >
                    {op.etiqueta}
                  </button>
                );
              })}
            </div>

            <div className="ml-auto flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setManualAbierto(true)}
                className="rounded-lg bg-emerald-700 px-2.5 py-1.5 font-bold text-white hover:bg-emerald-600"
              >
                📖 Manual
              </button>
              <WhatsappReporteCarrera
                fecha={fecha}
                hipodromo={hipodromo}
                carrera={carrera}
                grupo={nombreGrupo}
              />
              <button
                type="button"
                onClick={() => descargar("PNG")}
                className="rounded-lg bg-slate-700 px-2.5 py-1.5 font-bold text-white hover:bg-slate-600"
              >
                🖼️ PNG
              </button>
              <button
                type="button"
                onClick={() => descargar("JPG")}
                className="rounded-lg bg-slate-700 px-2.5 py-1.5 font-bold text-white hover:bg-slate-600"
              >
                🖼️ JPG
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="rounded-lg bg-slate-700 px-2.5 py-1.5 font-bold text-white hover:bg-slate-600"
              >
                🖨️ Imprimir
              </button>
              <button
                type="button"
                onClick={onCerrar}
                className="rounded-lg border border-red-400 bg-white px-2.5 py-1.5 font-bold text-red-500 hover:bg-red-50"
              >
                ✕ Cerrar
              </button>
            </div>
          </div>
        </div>

        {/* Menú lateral derecho de carreras liquidadas (oculto en modo exclusivo tras liquidar) */}
        {!modoExclusivoLiquidacion && (
          <BarraCarrerasLiquidadas
            fecha={fecha}
            hipodromo={hipodromo}
            nombreHipodromo={hipodromo ? nombreHipodromoParaMostrar(hipodromo) : undefined}
            carreraActiva={carrera}
            itemsExtra={itemsLiquidadasExtra}
            onSeleccionarCarrera={(n) => setCarrera(n)}
            onVerReporteCarrera={(n) => setCarrera(n)}
            onSeleccionarItem={(it) => {
              if (it.hipodromo) setHipodromo(String(it.hipodromo).trim().toUpperCase());
              setCarrera(it.carrera);
            }}
          />
        )}

        {/* Cuerpo del reporte */}
        <div className="p-4">
          {cargandoDetalle ? (
            <div className="mx-auto max-w-5xl rounded border border-slate-200 bg-white px-3 py-8 text-center text-xs font-bold text-slate-400">
              Generando reporte…
            </div>
          ) : datos ? (
            <>
              {crucesSnapshot && (
                <div className="mx-auto mb-3 flex max-w-5xl flex-wrap items-center gap-1.5 rounded-lg border border-amber-300/50 bg-slate-900 px-3 py-2">
                  <span className="mr-1 text-[9px] font-black uppercase text-amber-300">
                    ⚡ Excepciones conservadas · C{carrera}
                  </span>
                  {Object.entries(crucesSnapshot.todos ?? {})
                    .filter(([, activo]) => activo)
                    .map(([modalidad]) => (
                      <span
                        key={`todos-${modalidad}`}
                        className="rounded-full bg-amber-400 px-2 py-0.5 text-[9px] font-black text-slate-950"
                      >
                        ⚡ Cruce {modalidad === "mismoEjemplar" ? "Mismo Ej." : "Dif. Ej."} (Solo
                        Carrera #{carrera} - Todos)
                      </span>
                    ))}
                  {Object.entries(crucesSnapshot.porJugador ?? {}).flatMap(([jugador, reglas]) =>
                    Object.entries(reglas)
                      .filter(([, activo]) => activo)
                      .map(([modalidad]) => (
                        <span
                          key={`${jugador}-${modalidad}`}
                          className="rounded-full bg-cyan-400/15 px-2 py-0.5 text-[9px] font-black text-cyan-200"
                        >
                          ⚡ Cruce {modalidad === "mismoEjemplar" ? "Mismo Ej." : "Dif. Ej."} (Solo
                          Carrera #{carrera} - Jugador · {jugador})
                        </span>
                      ))
                  )}
                </div>
              )}
              <ReporteCarrera datos={datos} />
            </>
          ) : (
            <EmptyState
              icono="🧾"
              titulo={hayCarreras ? "Elegí una carrera" : "Sin resultados cargados en esta fecha"}
              descripcion={
                hayCarreras
                  ? "Seleccioná una carrera en el menú de la derecha (🏁 Liquidadas) o en el selector superior para armar su reporte de liquidación."
                  : "Cambiá la fecha para ver resultados recientes o pasados, o cargá los resultados de una carrera en Gestión de Jugadas."
              }
            />
          )}
        </div>
      </div>

      {/* Manual de liquidación (overlay) */}
      {manualAbierto && (
        <div className="fixed inset-0 z-[60] overflow-y-auto bg-slate-950/70 p-4">
          <div className="mx-auto max-w-4xl">
            <div className="mb-2 flex justify-end">
              <button
                type="button"
                onClick={() => setManualAbierto(false)}
                className="rounded-lg border border-red-300 bg-white px-3 py-2 text-xs font-bold text-red-500 shadow-sm hover:bg-red-50"
              >
                ✕ Cerrar Manual
              </button>
            </div>
            <ManualLiquidacion />
          </div>
        </div>
      )}
    </div>
  );
}
