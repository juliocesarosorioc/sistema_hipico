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
import { grupoActivoVigente } from "@/features/seguridad/lib/vigente";
import { nombreHipodromoParaMostrar } from "@/features/hipodromos/lib/nombre";
import { EmptyState } from "@/shared/components/ui/EmptyState";
import ReporteCarrera, { type ReporteCarreraDatos } from "@/features/saldos/components/ReporteCarrera";
import ManualLiquidacion from "@/features/gestion/components/ManualLiquidacion";
import WhatsappReporteCarrera from "@/features/liquidacion/components/WhatsappReporteCarrera";

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
}: Props) {
  const [fecha, setFecha] = useState(fechaInicial || hoyLocal());
  const [grupos, setGrupos] = useState<GrupoRow[]>([]);
  const [grupoId, setGrupoId] = useState("");
  const [carrerasDia, setCarrerasDia] = useState<CarreraDelDia[]>([]);
  const [hipodromo, setHipodromo] = useState(hipodromoInicial || "");
  const [carrera, setCarrera] = useState<number>(carreraInicial ?? 0);
  const [datos, setDatos] = useState<ReporteCarreraDatos | null>(null);
  const [cargandoDia, setCargandoDia] = useState(false);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [manualAbierto, setManualAbierto] = useState(false);
  const [clientes, setClientes] = useState<ClienteRow[]>([]);

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

  // Al abrir: arrancar desde la jornada/carrera en curso.
  useEffect(() => {
    if (!abierto) return;
    setFecha(fechaInicial || hoyLocal());
    setHipodromo(hipodromoInicial || "");
    setCarrera(carreraInicial ?? 0);
    setDatos(null);
  }, [abierto, fechaInicial, hipodromoInicial, carreraInicial]);

  // Grupos hípicos (para el encabezado del reporte).
  useEffect(() => {
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
  }, []);

  // Carreras con resultado cargado de la fecha (recientes o pasadas).
  useEffect(() => {
    if (!abierto) return;
    let vivo = true;
    setCargandoDia(true);
    cargarCarrerasDelDia(fecha)
      .then((cs) => {
        if (!vivo) return;
        const conResultado = cs.filter(
          (c) =>
            c.fecha === fecha &&
            ((c.ganadores && c.ganadores.length > 0) || c.estado !== "Programada")
        );
        setCarrerasDia(conResultado);
      })
      .catch(() => vivo && setCarrerasDia([]))
      .finally(() => vivo && setCargandoDia(false));
    return () => {
      vivo = false;
    };
  }, [abierto, fecha]);

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
    if (!hipodromosDisp.length) return;
    setHipodromo((prev) => (prev && hipodromosDisp.includes(prev) ? prev : hipodromosDisp[0]));
  }, [hipodromosDisp]);

  const carrerasDisp = useMemo(
    () =>
      carrerasDia
        .filter((c) => String(c.hipodromo || "").trim().toUpperCase() === hipodromo)
        .map((c) => Number(c.carrera))
        .filter((n) => n > 0)
        .sort((a, b) => a - b),
    [carrerasDia, hipodromo]
  );

  // Cascada hipódromo → carrera.
  useEffect(() => {
    if (!carrerasDisp.length) return;
    setCarrera((prev) => (prev && carrerasDisp.includes(prev) ? prev : carrerasDisp[0]));
  }, [carrerasDisp]);

  const nombreGrupo = useMemo(
    () => grupos.find((g) => String(g.id) === grupoId)?.nombre ?? "Grupo Hípico",
    [grupos, grupoId]
  );

  // Motor: trae la carrera liquidada y arma la plantilla.
  useEffect(() => {
    if (!abierto || !hipodromo || !carrera) {
      setDatos(null);
      return;
    }
    let vivo = true;
    setCargandoDetalle(true);
    carreraReporteDetalle(fecha, hipodromo, carrera)
      .then((c: CarreraReporte | null) => {
        if (!vivo) return;
        setDatos(c ? armarReporteCarrera(c, nombreGrupo, disponibleDe) : null);
      })
      .catch(() => vivo && setDatos(null))
      .finally(() => vivo && setCargandoDetalle(false));
    return () => {
      vivo = false;
    };
  }, [abierto, fecha, hipodromo, carrera, nombreGrupo, disponibleDe]);

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

            <label className="ml-1 flex items-center gap-1 font-bold text-slate-300">
              Fecha
              <input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value || hoyLocal())}
                className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-[11px] font-bold text-white"
              />
            </label>
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

            <div className="ml-auto flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setManualAbierto(true)}
                className="rounded-lg bg-emerald-700 px-2.5 py-1.5 font-bold text-white hover:bg-emerald-600"
              >
                📖 Manual
              </button>
              <WhatsappReporteCarrera fecha={fecha} hipodromo={hipodromo} carrera={carrera} grupo={nombreGrupo} />
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

          {/* Carreras con resultado cargado (recientes / pasadas) */}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
              {cargandoDia ? "cargando…" : `${carrerasDia.length} resultado(s) cargado(s)`}
            </span>
            {carrerasDia.map((c) => {
              const h = String(c.hipodromo || "").trim().toUpperCase();
              const activa = h === hipodromo && Number(c.carrera) === carrera;
              return (
                <button
                  key={`${h}-${c.carrera}`}
                  type="button"
                  onClick={() => {
                    setHipodromo(h);
                    setCarrera(Number(c.carrera));
                  }}
                  title={`${nombreHipodromoParaMostrar(h)} · C${c.carrera} · ${c.estado}`}
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-bold transition-colors ${
                    activa
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : "border-slate-300 bg-white text-slate-600 hover:border-emerald-400 hover:text-emerald-600"
                  }`}
                >
                  🏇 {nombreHipodromoParaMostrar(h)} · C{c.carrera}
                </button>
              );
            })}
          </div>
        </div>

        {/* Cuerpo del reporte */}
        <div className="p-4">
          {cargandoDetalle ? (
            <div className="mx-auto max-w-5xl rounded border border-slate-200 bg-white px-3 py-8 text-center text-xs font-bold text-slate-400">
              Generando reporte…
            </div>
          ) : datos ? (
            <ReporteCarrera datos={datos} />
          ) : (
            <EmptyState
              icono="🧾"
              titulo={hayCarreras ? "Elegí una carrera" : "Sin resultados cargados en esta fecha"}
              descripcion={
                hayCarreras
                  ? "Seleccioná una carrera de la lista de arriba para armar su reporte de liquidación con las jugadas reales, la pizarra de llegada y el resumen Ganan/Pierden."
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
