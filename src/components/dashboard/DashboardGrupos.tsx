"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { listarGruposAdmin, actualizarGrupo, type GrupoRow } from "@/lib/grupos";
import { hoyLocal } from "@/lib/gaceta/programa";
import { cicloSemanalDe, rangoSemanaDeGrupo, DIAS_SEMANA, etiquetaDia } from "@/lib/liquidacion/semana";
import { Button } from "@/components/ui/Button";
import { ToastHost } from "@/components/ui/ToastHost";

type Acceso = { emoji: string; txt: string; href?: string };

/** Accesos Rápidos clonados del dashboard legacy de Grupos. Los que aún no
 *  tienen ruta en la SPA se marcan "En desarrollo" (ver PLANIFICACION.md). */
const ACCESOS: Acceso[] = [
  { emoji: "🎟️", txt: "Apuestas", href: "/gestion-jugadas" },
  { emoji: "🧾", txt: "Saldos / Reportes", href: "/saldos-reportes" },
  { emoji: "👥", txt: "Clientes", href: "/clientes" },
  { emoji: "🗺️", txt: "Hipódromos", href: "/hipodromos" },
  { emoji: "📥", txt: "Depósitos" },
  { emoji: "💵", txt: "Retiros" },
  { emoji: "🔄", txt: "Transferencias" },
  { emoji: "💱", txt: "Monedas" },
  { emoji: "🏦", txt: "Bancos" },
  { emoji: "🏇", txt: "Winner / Place / Show" },
  { emoji: "🏆", txt: "Pollas" },
  { emoji: "🔔", txt: "Remates" },
  { emoji: "🛡️", txt: "Auditoría" },
];

const formatearCab = (iso: string): string => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

/**
 * Dashboard de Grupos (migración 1:1 del legacy): widget "Semana Activa"
 * con días coloreados y edición del ciclo (dia_inicio/dia_fin), acciones de
 * cierre (Cierre del Día / Cerrar Semana / Semanas Anteriores) y la cuadrícula
 * de Accesos Rápidos. La lógica de consolidación de cierres está pendiente:
 * los botones de cierre emiten toast.info("En desarrollo").
 */
export function DashboardGrupos() {
  const [grupos, setGrupos] = useState<GrupoRow[]>([]);
  const [grupoId, setGrupoId] = useState<string>("");
  const [editandoCiclo, setEditandoCiclo] = useState(false);
  const [diaInicio, setDiaInicio] = useState<string>("1");
  const [diaFin, setDiaFin] = useState<string>("7");
  const [guardando, setGuardando] = useState(false);

  const hoy = hoyLocal();

  const toast = useCallback((msg: string, tipo: "success" | "warning" | "error" | "info" = "info") => {
    window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));
  }, []);

  const recargar = useCallback(async () => {
    const gs = await listarGruposAdmin(true);
    setGrupos(gs);
    setGrupoId((prev) => prev || (gs.find((g) => g.es_principal)?.id ?? gs[0]?.id)?.toString() || "");
  }, []);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  const grupo = useMemo(() => grupos.find((g) => String(g.id) === grupoId) ?? null, [grupos, grupoId]);

  /** Semana fiscal del grupo seleccionado (default Lunes→Domingo). */
  const semana = useMemo(() => {
    if (!grupo) return null;
    const ciclo = cicloSemanalDe(grupo);
    const { inicio, fin } = rangoSemanaDeGrupo(hoy, ciclo);
    const dias: { fecha: string; etiqueta: string; estado: "cerrado" | "hoy" | "sin_cerrar" | "pendiente" }[] = [];
    const [iY, iM, iD] = inicio.split("-").map(Number);
    const cursor = new Date(iY, iM - 1, iD);
    const [fY, fM, fD] = fin.split("-").map(Number);
    const finD = new Date(fY, fM - 1, fD);
    const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
    const loop = new Date(cursor);
    while (loop <= finD) {
      const iso = `${loop.getFullYear()}-${String(loop.getMonth() + 1).padStart(2, "0")}-${String(loop.getDate()).padStart(2, "0")}`;
      dias.push({
        fecha: iso,
        etiqueta: `${DIAS[loop.getDay()]} ${String(loop.getDate()).padStart(2, "0")}/${String(loop.getMonth() + 1).padStart(2, "0")}`,
        estado: iso === hoy ? "hoy" : iso < hoy ? "sin_cerrar" : "pendiente",
      });
      loop.setDate(loop.getDate() + 1);
    }
    return { ciclo, inicio, fin, dias };
  }, [grupo, hoy]);

  const grupoDiaInicio = grupo != null ? Number(grupo.dia_inicio_semana) || 1 : 1;
  const grupoDiaFin = grupo != null ? Number(grupo.dia_fin_semana) || 7 : 7;

  const abrirEditor = () => {
    setDiaInicio(String(grupoDiaInicio));
    setDiaFin(String(grupoDiaFin));
    setEditandoCiclo(true);
  };

  const guardarCiclo = async () => {
    if (!grupo) return;
    setGuardando(true);
    const r = await actualizarGrupo(grupo.id, {
      dia_inicio_semana: parseInt(diaInicio) || 1,
      dia_fin_semana: parseInt(diaFin) || 7,
    });
    setGuardando(false);
    if (!r.ok) return toast(r.error ?? "Error al actualizar el ciclo.", "error");
    toast(`Ciclo semanal actualizado: ${etiquetaDia(parseInt(diaInicio))} → ${etiquetaDia(parseInt(diaFin))}.`, "success");
    setEditandoCiclo(false);
    void recargar();
  };

  const enDesarrollo = (txt: string) => toast(`${txt} — En desarrollo (ver backlog en PLANIFICACION.md).`, "info");

  const COLOR_ESTADO: Record<string, string> = {
    cerrado: "border-emerald-300 bg-emerald-500/15 text-emerald-700",
    hoy: "border-blue-400 bg-blue-500 text-white shadow",
    sin_cerrar: "border-red-300 bg-red-500/10 text-red-600",
    pendiente: "border-line bg-gray-100 text-slate-400",
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-black text-slate-800">
          <i className="fas fa-chart-pie mr-2 text-amber-500"></i> Centro de Control del Grupo
        </h1>
        <select
          value={grupoId}
          onChange={(e) => setGrupoId(e.target.value)}
          className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-bold uppercase text-slate-700 outline-none"
          aria-label="Grupo de venta"
        >
          {grupos.map((g) => (
            <option key={String(g.id)} value={String(g.id)}>
              {g.nombre} {g.es_principal ? "· PRINCIPAL" : ""}
            </option>
          ))}
        </select>
      </div>

      {/* ---------- SEMANA ACTIVA ---------- */}
      <section className="rounded-2xl border border-line bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[11px] font-black uppercase tracking-wider text-slate-600">
            <i className="fas fa-calendar-week mr-1 text-indigo-500"></i> Semana Activa
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-emerald-500/15 px-3 py-0.5 text-[10px] font-black uppercase text-emerald-700 ring-1 ring-emerald-300">
              ABIERTA
            </span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black uppercase text-slate-500">
              Inicio {etiquetaDia(grupoDiaInicio)} · Corte {etiquetaDia(grupoDiaFin)}
            </span>
          </div>
        </div>

        {semana && grupo ? (
          <>
            <p className="text-xs font-bold text-slate-700">
              Rango: <span className="text-indigo-600">{formatearCab(semana.inicio)}</span> →{" "}
              <span className="text-indigo-600">{formatearCab(semana.fin)}</span>{" "}
              <span className="font-semibold text-slate-400">· {grupo.nombre.toUpperCase()}</span>
            </p>

            {/* Días de la semana fiscal (código de colores del legacy) */}
            <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-7">
              {semana.dias.map((d) => (
                <div
                  key={d.fecha}
                  title={`${d.fecha} — ${d.estado === "hoy" ? "Hoy" : d.estado === "sin_cerrar" ? "Sin cerrar" : d.estado === "cerrado" ? "Cerrado" : "Pendiente"}`}
                  className={`rounded-lg border-2 px-2 py-2 text-center ${COLOR_ESTADO[d.estado]}`}
                >
                  <p className="text-[10px] font-black uppercase tracking-wide">{d.etiqueta}</p>
                  <p className="mt-0.5 text-[9px] opacity-80">{d.estado === "hoy" ? "HOY" : d.estado === "sin_cerrar" ? "SIN CERRAR" : d.estado === "cerrado" ? "CERRADO" : "PENDIENTE"}</p>
                </div>
              ))}
            </div>

            {/* Leyenda */}
            <div className="mt-3 flex flex-wrap items-center gap-3 text-[10px] font-semibold text-slate-500">
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Cerrado</span>
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-blue-500" /> Hoy</span>
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-red-500" /> Sin cerrar</span>
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-gray-300" /> Pendiente</span>
            </div>

            {/* Edición del ciclo + acciones de cierre */}
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
              {editandoCiclo ? (
                <div className="flex flex-wrap items-end gap-2 rounded-xl border border-indigo-200 bg-indigo-50/60 p-2">
                  <label className="block">
                    <span className="mb-0.5 block text-[9px] font-black uppercase tracking-wider text-slate-500">Día Inicio</span>
                    <select value={diaInicio} onChange={(e) => setDiaInicio(e.target.value)} className="rounded-lg border border-line bg-white px-2 py-1 text-xs font-bold outline-none">
                      {DIAS_SEMANA.map((d) => (
                        <option key={d.valor} value={d.valor}>{d.nombre}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-0.5 block text-[9px] font-black uppercase tracking-wider text-slate-500">Día Corte</span>
                    <select value={diaFin} onChange={(e) => setDiaFin(e.target.value)} className="rounded-lg border border-line bg-white px-2 py-1 text-xs font-bold outline-none">
                      {DIAS_SEMANA.map((d) => (
                        <option key={d.valor} value={d.valor}>{d.nombre}</option>
                      ))}
                    </select>
                  </label>
                  <Button size="sm" onClick={() => void guardarCiclo()} disabled={guardando}>
                    {guardando ? <i className="fas fa-spinner fa-spin mr-1"></i> : <i className="fas fa-save mr-1"></i>} Guardar
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditandoCiclo(false)}>
                    Cancelar
                  </Button>
                </div>
              ) : (
                <>
                  <Button size="sm" variant="outline" onClick={abrirEditor} title="Cambiar los días de inicio y corte de la semana fiscal">
                    <i className="fas fa-pen mr-1"></i> Editar Fecha Inicio / Fin
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => enDesarrollo("Cierre del Día")} title="Cierre de caja del día (consolidación de saldos)">
                    <i className="fas fa-lock mr-1"></i> Cierre del Día
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => enDesarrollo("Cerrar Semana")} title="Consolida el balance semanal del grupo">
                    <i className="fas fa-flag-checkered mr-1"></i> Cerrar Semana
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => enDesarrollo("Semanas Anteriores")} title="Histórico de semanas cerradas">
                    <i className="fas fa-history mr-1"></i> Semanas Anteriores
                  </Button>
                </>
              )}
            </div>
          </>
        ) : (
          <p className="rounded-xl border border-dashed border-line bg-gray-50 px-3 py-4 text-center text-xs font-semibold text-slate-400">
            Sin grupos. Cree un grupo de venta en «Grupos y Convenios» para activar la Semana Activa.
          </p>
        )}
      </section>

      {/* ---------- ACCESOS RÁPIDOS ---------- */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
        {ACCESOS.map((a) => (
          <div
            key={a.txt}
            className="flex flex-col items-center justify-between gap-2 rounded-2xl border border-line bg-white p-4 text-center shadow-sm transition-shadow hover:shadow-md"
          >
            <span className="text-3xl">{a.emoji}</span>
            <span className="w-full text-xs font-black uppercase leading-tight tracking-wide text-slate-700">{a.txt}</span>
            {a.href ? (
              <Link
                href={a.href}
                className="w-full rounded-lg bg-indigo-600 py-1.5 text-center text-[10px] font-black uppercase tracking-widest text-white transition-colors hover:bg-indigo-700"
              >
                Abrir
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => enDesarrollo(a.txt)}
                className="w-full rounded-lg border border-line bg-slate-50 py-1.5 text-center text-[10px] font-black uppercase tracking-widest text-slate-400 transition-colors hover:bg-slate-100"
              >
                Pronto
              </button>
            )}
          </div>
        ))}
      </section>

      <ToastHost />
    </div>
  );
}

export default DashboardGrupos;