"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { errorCargaGrupos, listarGruposAdmin, actualizarGrupo, type GrupoRow } from "@/lib/grupos";
import { hoyLocal } from "@/lib/gaceta/programa";
import { cicloSemanalDe, DIAS_SEMANA, etiquetaDia, rangoSemanaDesde } from "@/lib/liquidacion/semana";
import { fijarSemanaVigente, semanaVigente } from "@/lib/liquidacion/semana-vigente";
import { useAuthStore } from "@/store/useAuthStore";
import {
  balanceDeRango,
  cerrarRango,
  formatCierre,
  listarCierres,
  reabrirCierre,
  rangoACerrar,
  type CierreJornada,
  type DetalleCierre,
  type TipoCierre,
} from "@/lib/liquidacion/cierres";
import { Button } from "@/components/ui/Button";
import { ToastHost } from "@/components/ui/ToastHost";

type Acceso = { emoji: string; txt: string; href?: string };

/** Accesos Rápidos clonados del dashboard legacy de Grupos. Los cinco de
 *  Contabilidad seguían marcados "En desarrollo" aunque sus pantallas ya
 *  estaban migradas; los que de verdad no existen (WPS, Winner/Place/Show) se
 *  quedan sin href a propósito. Pollas y Remates ya tienen pantalla y rutas
 *  registradas en el maestro de seguridad, así que van con href: sin él el
 *  acceso queda marcado "pronto" al lado de una módulo que sí funciona. La
 *  auditoría ya no es un acceso aparte: vive dentro de "Seguridad y Accesos". */
const ACCESOS: Acceso[] = [
  { emoji: "🎟️", txt: "Apuestas", href: "/gestion-jugadas" },
  { emoji: "🧾", txt: "Saldos / Reportes", href: "/saldos-reportes" },
  { emoji: "👥", txt: "Clientes", href: "/clientes" },
  { emoji: "🗺️", txt: "Hipódromos", href: "/hipodromos" },
  { emoji: "📥", txt: "Depósitos", href: "/contabilidad/ingresos" },
  { emoji: "💵", txt: "Retiros", href: "/contabilidad/caja" },
  { emoji: "🔄", txt: "Transferencias", href: "/contabilidad/caja" },
  { emoji: "💱", txt: "Monedas", href: "/contabilidad/monedas" },
  { emoji: "🏦", txt: "Bancos", href: "/contabilidad/bancos" },
  { emoji: "🏇", txt: "Winner / Place / Show" },
  { emoji: "🏆", txt: "Pollas", href: "/pollas" },
  { emoji: "🔔", txt: "Remates", href: "/remates" },
  { emoji: "🛡️", txt: "Seguridad y Accesos", href: "/seguridad" },
];

const formatearCab = (iso: string): string => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

/** "3 días · 5 hipódromos · 12 carreras · 84 tickets" — la línea de detalle. */
const resumenDetalle = (d: DetalleCierre): string =>
  [
    `${d.dias} día${d.dias === 1 ? "" : "s"}`,
    `${d.hipodromos} hipódromo${d.hipodromos === 1 ? "" : "s"}`,
    `${d.carreras} carrera${d.carreras === 1 ? "" : "s"}`,
    `${d.tickets} ticket${d.tickets === 1 ? "" : "s"}`,
  ].join(" · ");

/** Cierre a la espera de confirmación, con el balance ya calculado. */
type CierrePendiente = {
  tipo: TipoCierre;
  inicio: string;
  fin: string;
  balance: number;
  detalle: DetalleCierre;
};

/**
 * Dashboard de Grupos (migración 1:1 del legacy): widget "Semana Activa"
 * con días coloreados y edición del ciclo (dia_inicio/dia_fin), acciones de
 * cierre (Cierre del Día / Cerrar Semana / Semanas Anteriores) y la cuadrícula
 * de Accesos Rápidos.
 *
 * Los tres botones de cierre consolidación REAL: leen el mismo reporte que
 * /saldos-reportes y registran la foto del balance en `cierres_jornada`
 * (sql/cierres_jornada.sql). El día con cierre pinta verde en la grilla.
 */
export function DashboardGrupos() {
  const [grupos, setGrupos] = useState<GrupoRow[]>([]);
  const [grupoId, setGrupoId] = useState<string>("");
  const [editandoCiclo, setEditandoCiclo] = useState(false);
  const [diaInicio, setDiaInicio] = useState<string>("1");
  const [diaFin, setDiaFin] = useState<string>("7");
  const [guardando, setGuardando] = useState(false);
  const [cierres, setCierres] = useState<CierreJornada[]>([]);
  const [calculando, setCalculando] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const [pendiente, setPendiente] = useState<CierrePendiente | null>(null);
  const [verHistorial, setVerHistorial] = useState(false);

  const hoy = hoyLocal();

  const toast = useCallback((msg: string, tipo: "success" | "warning" | "error" | "info" = "info") => {
    window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));
  }, []);

  const recargar = useCallback(async () => {
    const gs = await listarGruposAdmin(true);
    setGrupos(gs);
    setGrupoId((prev) => prev || (gs.find((g) => g.es_principal)?.id ?? gs[0]?.id)?.toString() || "");
    const err = errorCargaGrupos();
    if (err && !gs.length) toast(err, "error");
  }, [toast]);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  const grupo = useMemo(() => grupos.find((g) => String(g.id) === grupoId) ?? null, [grupos, grupoId]);

  /** Días con cierre de caja registrado. El filtro por rango se hace al pintar. */
  const cerrados = useMemo(() => {
    const s = new Set<string>();
    for (const c of cierres) if (c.tipo === "DIA") s.add(String(c.fecha_inicio).slice(0, 10));
    return s;
  }, [cierres]);

  /**
   * Semana fiscal del grupo seleccionado: la fijada si el dueño la fijó, la del
   * calendario si no. `fijada` sale para poder avisarlo en pantalla (ver
   * `semanaVigenteDe`).
   */
  const semana = useMemo(() => {
    if (!grupo) return null;
    const ciclo = cicloSemanalDe(grupo);
    const vigente = semanaVigente(hoy, ciclo, grupo.semana_vigente_inicio);
    const { inicio, fin } = vigente;
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
        // El cierre de caja PINTA el día, aunque sea hoy: es el dato que el
        // operador mira para saber si la jornada quedó consolidada.
        estado: cerrados.has(iso) ? "cerrado" : iso === hoy ? "hoy" : iso < hoy ? "sin_cerrar" : "pendiente",
      });
      loop.setDate(loop.getDate() + 1);
    }
    return { ciclo, inicio, fin, fijada: vigente.fijada, dias };
  }, [grupo, hoy, cerrados]);

  /**
   * ¿La semana que muestra la grilla ya fue consolidada?
   *
   * Compara contra el rango MOSTRADO, no contra la semana deducida de hoy: si
   * la semana vigente está fijada, el cierre que importa es el suyo.
   */
  const semanaCerrada = useMemo(() => {
    if (!semana) return false;
    return cierres.some(
      (c) => c.tipo === "SEMANA" && String(c.fecha_inicio).slice(0, 10) === semana.inicio && String(c.fecha_fin).slice(0, 10) === semana.fin
    );
  }, [semana, cierres]);

  const recargarCierres = useCallback(async () => {
    if (!grupoId) {
      setCierres([]);
      return;
    }
    const r = await listarCierres(grupoId);
    if (r.ok) setCierres(r.cierres);
  }, [grupoId]);

  useEffect(() => {
    void recargarCierres();
  }, [recargarCierres]);

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

  // ---------- SEMANA VIGENTE ----------------------------------------------------
  // Desplazar la semana cambia sobre qué rango se consolida el balance de la
  // casa, así que el botón es solo del usuario principal. La RPC vuelve a
  // comprobarlo; acá se evita que el resto de la operación vea un control que no
  // puede usar.
  const esPrincipal = useAuthStore((s) => s.esPrincipal);
  const [editandoVigente, setEditandoVigente] = useState(false);
  const [inicioVigente, setInicioVigente] = useState("");

  const abrirEditorVigente = () => {
    // Por defecto propone el lunes de la semana mostrada: es lo que casi siempre
    // se quiere y evita tener que buscar la fecha a mano.
    setInicioVigente(semana?.inicio ?? hoy);
    setEditandoVigente(true);
  };

  /** Desplaza la semana vigente al inicio indicado. */
  const aplicarVigente = async (inicio: string | null) => {
    if (!grupo) return;
    setGuardando(true);
    const r = await fijarSemanaVigente(grupo.id, inicio);
    setGuardando(false);
    setEditandoVigente(false);
    if (!r.ok) return toast(r.error ?? "No pude cambiar la semana vigente.", "error");
    toast(
      inicio
        ? `Semana vigente fijada en la del ${formatearCab(inicio.slice(0, 10))}.`
        : "Semana vigente liberada: se vuelve a la del calendario.",
      "success"
    );
    await recargar();
  };

  /** Etiqueta de un cierre: el día, o el rango de la semana. */
  const etiquetaCierre = (c: CierreJornada): string => {
    const ini = String(c.fecha_inicio).slice(0, 10);
    const fin = String(c.fecha_fin).slice(0, 10);
    return c.tipo === "DIA" ? formatearCab(ini) : `${formatearCab(ini)} → ${formatearCab(fin)}`;
  };

  /**
   * Calcula el balance del rango y PIDE CONFIRMACIÓN antes de registrarlo.
   *
   * Se calcula primero a propósito: consolidar es una foto, pero cerrar sin
   * mostrar la cifra es cómo se termina con un histórico que nadie reconoce.
   */
  const prepararCierre = async (tipo: TipoCierre) => {
    if (!grupo) return toast("Elegí un grupo de venta.", "warning");
    setCalculando(true);
    const rango = rangoACerrar(grupo, tipo);
    const b = await balanceDeRango(grupo, rango.inicio, rango.fin);
    setCalculando(false);
    if (!b.ok) return toast(b.error ?? "No se pudo calcular el balance.", "error");
    if (!b.detalle.carreras) {
      return toast(
        tipo === "DIA"
          ? `No hay carreras con movimiento el ${formatearCab(rango.inicio)}: no hay nada que consolidar.`
          : `La semana ${formatearCab(rango.inicio)} → ${formatearCab(rango.fin)} no tiene carreras con movimiento.`,
        "warning"
      );
    }
    setPendiente({ tipo, inicio: rango.inicio, fin: rango.fin, balance: b.balance, detalle: b.detalle });
  };

  const confirmarCierre = async () => {
    if (!pendiente || !grupo) return;
    setCerrando(true);
    const r = await cerrarRango({ grupoId: String(grupo.id), grupo, tipo: pendiente.tipo });
    setCerrando(false);
    if (!r.ok) return toast(r.error ?? "No se pudo registrar el cierre.", "error");
    const { tipo, inicio, fin, balance } = pendiente;
    setPendiente(null);
    toast(
      tipo === "DIA"
        ? `Cierre del ${formatearCab(inicio)} registrado · balance ${formatCierre(balance)}.`
        : `Semana ${formatearCab(inicio)} → ${formatearCab(fin)} consolidada · balance ${formatCierre(balance)}.`,
      "success"
    );
    await recargarCierres();
  };

  /** Reabrir = borrar la foto del cierre. Sirve para reconsolidar tras corregir. */
  const reabrir = async (c: CierreJornada) => {
    const r = await reabrirCierre(c.id);
    if (!r.ok) return toast(r.error ?? "No se pudo reabrir el cierre.", "error");
    toast(`Cierre de ${etiquetaCierre(c)} reabierto.`, "success");
    await recargarCierres();
  };

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
          <span className="mr-2 text-amber-500">🥧</span> Centro de Control del Grupo
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
            <span className="mr-1 text-indigo-500">🗓️</span> Semana Activa
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-3 py-0.5 text-[10px] font-black uppercase ring-1 ${
                semanaCerrada
                  ? "bg-red-500/15 text-red-700 ring-red-300"
                  : "bg-emerald-500/15 text-emerald-700 ring-emerald-300"
              }`}
            >
              {semanaCerrada ? "CERRADA" : "ABIERTA"}
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

            {/* Cuando la semana está fijada a mano y no es la del calendario, el
                operador tiene que saberlo: si ve "ABIERTA" un martes sobre la
                semana del lunes, sin este aviso parece un error del sistema. */}
            {semana.fijada ? (
              <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-800">
                ⏱️ Semana fijada a mano: se está consolidando esta semana, no la del calendario.
              </p>
            ) : null}

            {/* Días de la semana fiscal (código de colores del legacy) */}
            <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-7">
              {semana.dias.map((d) => (
                <div
                  key={d.fecha}
                  title={`${d.fecha} — ${d.estado === "hoy" ? "Hoy" : d.estado === "sin_cerrar" ? "Sin cerrar" : d.estado === "cerrado" ? "Cerrado" : "Pendiente"}`}
                  className={`rounded-lg border-2 px-2 py-2 text-center ${COLOR_ESTADO[d.estado]}`}
                >
                  <p className="text-[10px] font-black uppercase tracking-wide">{d.etiqueta}</p>
                  <p className="mt-0.5 text-[9px] opacity-80">
                    {d.estado === "cerrado" ? "CERRADO" : d.estado === "hoy" ? "HOY" : d.estado === "sin_cerrar" ? "SIN CERRAR" : "PENDIENTE"}
                  </p>
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
                    {guardando ? <span className="mr-1">⏳</span> : <span className="mr-1">💾</span>} Guardar
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditandoCiclo(false)}>
                    Cancelar
                  </Button>
                </div>
              ) : (
                <>
                  <Button size="sm" variant="outline" onClick={abrirEditor} title="Cambiar los días de inicio y corte de la semana fiscal">
                    <span className="mr-1">✏️</span> Editar Fecha Inicio / Fin
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={calculando || cerrando}
                    onClick={() => void prepararCierre("DIA")}
                    title="Consolida el balance de caja de hoy y deja el día marcado como CERRADO"
                  >
                    {calculando ? <span className="mr-1">⏳</span> : <span className="mr-1">🔒</span>} Cierre del Día
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={calculando || cerrando}
                    onClick={() => void prepararCierre("SEMANA")}
                    title="Consolida el balance de la semana fiscal del grupo"
                  >
                    {calculando ? <span className="mr-1">⏳</span> : <span className="mr-1">🏁</span>} Cerrar Semana
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setVerHistorial(true)}
                    title="Histórico de cierres de día y de semana"
                  >
                    <span className="mr-1">🕙</span> Semanas Anteriores
                  </Button>
                </>
              )}
            </div>

            {/* ---------- SEMANA VIGENTE ----------
                Solo el usuario principal. Sin este control, la semana siempre se
                deducía del calendario: cuando la casa sigue con la semana anterior
                porque la nueva no arrancó, el cierre de la que se terminó quedaba
                fuera de la vista. */}
            {esPrincipal ? (
              <div className="mt-2 border-t border-line pt-3">
                {editandoVigente ? (
                  <div className="flex flex-wrap items-end gap-2 rounded-xl border border-amber-300 bg-amber-50/70 p-2">
                    <label className="block">
                      <span className="mb-0.5 block text-[9px] font-black uppercase tracking-wider text-slate-600">
                        Semana que empieza el
                      </span>
                      <input
                        type="date"
                        value={inicioVigente}
                        onChange={(e) => setInicioVigente(e.target.value)}
                        className="rounded-lg border border-line bg-white px-2 py-1 text-xs font-bold outline-none"
                      />
                    </label>
                    <Button size="sm" onClick={() => void aplicarVigente(inicioVigente || null)} disabled={guardando}>
                      {guardando ? <span className="mr-1">⏳</span> : <span className="mr-1">📌</span>} Fijar
                    </Button>
                    {semana.fijada ? (
                      <Button size="sm" variant="outline" onClick={() => void aplicarVigente(null)} disabled={guardando}>
                        Liberar
                      </Button>
                    ) : null}
                    <Button size="sm" variant="outline" onClick={() => setEditandoVigente(false)}>
                      Cancelar
                    </Button>
                    <p className="w-full text-[10px] font-semibold text-slate-500">
                      La fecha debe caer en un día de apertura del ciclo ({etiquetaDia(grupoDiaInicio)}). Todo lo que se
                      consolide se aplica sobre esa semana.
                    </p>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={abrirEditorVigente}
                    title="Fijar qué semana se está operando, cuando no es la del calendario"
                  >
                    <span className="mr-1">{semana.fijada ? "📌" : "⏱️"}</span>
                    {semana.fijada ? "Cambiar semana vigente" : "Fijar semana vigente"}
                  </Button>
                )}
              </div>
            ) : null}
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

      {/* ---------- CONFIRMAR CIERRE ---------- */}
      {pendiente && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-line bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-indigo-200 bg-indigo-50 px-4 py-3">
              <h3 className="text-xs font-black uppercase text-indigo-800">
                {pendiente.tipo === "DIA" ? "🧾 Cierre del día" : "🏁 Cierre de semana"}
              </h3>
              <button type="button" onClick={() => setPendiente(null)} className="text-slate-400 hover:text-slate-700" aria-label="Cerrar">
                ✕
              </button>
            </div>

            <div className="space-y-3 p-4">
              <p className="text-xs text-slate-600">
                Rango{" "}
                <span className="font-black text-indigo-700">
                  {pendiente.tipo === "DIA"
                    ? formatearCab(pendiente.inicio)
                    : `${formatearCab(pendiente.inicio)} → ${formatearCab(pendiente.fin)}`}
                </span>{" "}
                · {grupo?.nombre.toUpperCase()}
              </p>

              <div className="rounded-xl border border-line bg-slate-50 px-3 py-2">
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Balance de la casa</p>
                <p className={`text-2xl font-black ${pendiente.balance < 0 ? "text-red-600" : "text-emerald-600"}`}>
                  {formatCierre(pendiente.balance)}
                </p>
                <p className="text-[10px] text-slate-500">{pendiente.balance < 0 ? "La casa pagó de más en el rango." : "La casa ganó en el rango."}</p>
              </div>

              <p className="text-[11px] text-slate-500">{resumenDetalle(pendiente.detalle)}</p>

              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800">
                El cierre es una foto del balance: no mueve saldos ni bloquea la operatoria. Si más adelante se corrige una
                liquidación, se vuelve a cerrar el mismo rango y la foto se actualiza.
              </p>
            </div>

            <div className="flex justify-end gap-2 border-t border-line bg-slate-50 px-4 py-3">
              <Button size="sm" variant="outline" onClick={() => setPendiente(null)} disabled={cerrando}>
                Cancelar
              </Button>
              <Button size="sm" onClick={() => void confirmarCierre()} disabled={cerrando}>
                {cerrando ? "Cerrando…" : "Confirmar cierre"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- SEMANAS ANTERIORES ---------- */}
      {verHistorial && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true">
          <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-line bg-slate-900 px-4 py-3">
              <h3 className="text-xs font-black uppercase text-white">
                📚 Cierres de caja{grupo ? ` · ${grupo.nombre}` : ""}
              </h3>
              <button type="button" onClick={() => setVerHistorial(false)} className="text-slate-300 hover:text-white" aria-label="Cerrar">
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {cierres.length ? (
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-line text-left text-[10px] font-black uppercase tracking-wider text-slate-500">
                      <th className="py-1.5 pr-2">Tipo</th>
                      <th className="py-1.5 pr-2">Rango</th>
                      <th className="py-1.5 pr-2 text-right">Balance</th>
                      <th className="py-1.5 pr-2">Detalle</th>
                      <th className="py-1.5 pr-2">Cerró</th>
                      <th className="py-1.5 text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cierres.map((c) => {
                      const det = (c.detalle ?? {}) as Partial<DetalleCierre>;
                      return (
                        <tr key={`${c.tipo}-${c.id}`} className="border-b border-slate-100 align-top">
                          <td className="py-2 pr-2">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase ${
                                c.tipo === "SEMANA" ? "bg-indigo-100 text-indigo-700" : "bg-emerald-100 text-emerald-700"
                              }`}
                            >
                              {c.tipo === "SEMANA" ? "Semana" : "Día"}
                            </span>
                          </td>
                          <td className="py-2 pr-2 font-bold text-slate-700">{etiquetaCierre(c)}</td>
                          <td className={`py-2 pr-2 text-right font-black ${Number(c.balance) < 0 ? "text-red-600" : "text-emerald-600"}`}>
                            {formatCierre(c.balance)}
                          </td>
                          <td className="py-2 pr-2 text-[10px] text-slate-500">
                            {det.carreras != null ? `${det.carreras} carreras · ${det.tickets ?? 0} tickets` : "—"}
                          </td>
                          <td className="py-2 pr-2 text-[10px] text-slate-500">
                            {c.cerrado_por ?? "—"}
                            <br />
                            <span className="text-slate-400">{String(c.created_at ?? "").slice(0, 10)}</span>
                          </td>
                          <td className="py-2 text-right">
                            <Button size="sm" variant="ghost" onClick={() => void reabrir(c)} title="Borra la foto del cierre para poder reconsolidar">
                              Reabrir
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <p className="rounded-xl border border-dashed border-line bg-gray-50 px-3 py-6 text-center text-xs font-semibold text-slate-400">
                  Todavía no hay cierres registrados para este grupo. Usá “Cierre del Día” o “Cerrar Semana”.
                </p>
              )}
            </div>

            <div className="flex justify-end border-t border-line bg-slate-50 px-4 py-3">
              <Button size="sm" variant="outline" onClick={() => setVerHistorial(false)}>
                Cerrar
              </Button>
            </div>
          </div>
        </div>
      )}

      <ToastHost />
    </div>
  );
}

export default DashboardGrupos;