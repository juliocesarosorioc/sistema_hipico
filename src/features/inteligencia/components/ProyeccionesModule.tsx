"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ModalAnalisisActuarialGodet } from "@/features/ejemplares/components/ModalAnalisisActuarialGodet";
import {
  leerCarrerasDeInteligencia,
  proyectarCarrera,
  type ProyeccionCarrera,
} from "@/features/inteligencia/lib/datos";
import { aEjemplarGodet } from "@/features/inteligencia/lib/proyecciones";
import type { CarreraCatalogo } from "@/features/carreras/lib/maestro-nucleo";
import { fechaJornadaCaracas } from "@/core/utils/fechas";
import { Button } from "@/shared/components/ui/Button";
import { ToastHost } from "@/shared/components/ui/ToastHost";
import { emitirToast } from "@/shared/lib/mensajeria";

/** Color de la barra de probabilidad, del mejor al peor. */
const colorProbabilidad = (p: number): string =>
  p >= 25 ? "bg-emerald-500" : p >= 15 ? "bg-amber-500" : p >= 8 ? "bg-sky-500" : "bg-slate-400";

export function ProyeccionesModule() {
  const [fecha, setFecha] = useState(() => fechaJornadaCaracas());
  const [hipodromo, setHipodromo] = useState("");
  const [carreras, setCarreras] = useState<CarreraCatalogo[]>([]);
  const [seleccion, setSeleccion] = useState("");
  const [proyeccion, setProyeccion] = useState<ProyeccionCarrera | null>(null);
  const [cargando, setCargando] = useState(false);
  const [proyectando, setProyectando] = useState(false);
  const [error, setError] = useState("");
  const [modalAbierto, setModalAbierto] = useState(false);

  const toast = useCallback((msg: string, tipo: "success" | "warning" | "error" | "info" = "info") => {
    emitirToast(msg, tipo);
  }, []);

  /** Carga las carreras del día (matriz `carreras`). */
  const cargarCarreras = useCallback(
    async (f: string) => {
      setCargando(true);
      setError("");
      const res = await leerCarrerasDeInteligencia(f, hipodromo || undefined);
      setCargando(false);
      if (!res.ok) {
        setCarreras([]);
        setError(
          res.error ?? "No se pudo leer la matriz de carreras. Aplique sql/carreras.sql para habilitarla."
        );
        return;
      }
      setCarreras(res.carreras);
      if (!res.carreras.length) {
        setProyeccion(null);
        setSeleccion("");
      }
    },
    [hipodromo]
  );

  useEffect(() => {
    void cargarCarreras(fecha);
  }, [cargarCarreras, fecha]);

  /** Hipódromos disponibles en la jornada (para el selector). */
  const hipodromos = useMemo(() => {
    const set = new Set<string>();
    for (const c of carreras) set.add(c.hipodromo);
    return [...set].sort();
  }, [carreras]);

  /** Proyecta la carrera seleccionada. */
  const proyectar = useCallback(
    async (clave: string) => {
      if (!clave) {
        setProyeccion(null);
        return;
      }
      const c = carreras.find((x) => `${x.hipodromo}|${x.carrera}` === clave);
      if (!c) return;
      setSeleccion(clave);
      setProyectando(true);
      setError("");
      const res = await proyectarCarrera(c, fecha);
      setProyectando(false);
      if (!res.ok || !res.datos) {
        setProyeccion(null);
        setError(res.error ?? "No se pudo proyectar la carrera.");
        toast(res.error ?? "No se pudo proyectar la carrera.", "error");
        return;
      }
      setProyeccion(res.datos);
      if (res.datos.aviso) toast(res.datos.aviso, "warning");
    },
    [carreras, fecha, toast]
  );

  /** Ejemplares que se le pasan a la pizarra Godet (con datos REALES). */
  const ejemplaresGodet = useMemo(() => {
    if (!proyeccion) return [];
    return proyeccion.ranking.map((f) => aEjemplarGodet(f));
  }, [proyeccion]);

  return (
    <div className="flex flex-col gap-4">
      {/* ---------- Encabezado ---------- */}
      <div className="rounded-2xl border border-line bg-surface p-5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600">
            <span>📅 Fecha de la jornada</span>
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value || fechaJornadaCaracas())}
              className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm font-bold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600">
            <span>🏟️ Hipódromo</span>
            <select
              value={hipodromo}
              onChange={(e) => {
                setHipodromo(e.target.value);
                setProyeccion(null);
                setSeleccion("");
              }}
              className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm font-bold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              <option value="">Todos</option>
              {hipodromos.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600">
            <span>🏁 Carrera</span>
            <select
              value={seleccion}
              onChange={(e) => void proyectar(e.target.value)}
              disabled={!carreras.length}
              className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm font-bold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-50"
            >
              <option value="">Seleccione…</option>
              {carreras.map((c) => (
                <option key={`${c.hipodromo}|${c.carrera}`} value={`${c.hipodromo}|${c.carrera}`}>
                  {c.hipodromo} · C{c.carrera}
                  {c.distancia ? ` · ${c.distancia}m` : ""}
                  {c.superficie ? ` · ${c.superficie}` : ""}
                </option>
              ))}
            </select>
          </label>
          <Button variant="ghost" size="md" disabled={cargando} onClick={() => void cargarCarreras(fecha)}>
            {cargando ? "Cargando…" : "🔄 Actualizar"}
          </Button>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
          Las carreras salen de la <b>matriz central</b> (la misma que leen Taquilla, Tablas y Liquidación). La memoria
          histórica de cada ejemplar se cruza por nombre: actuaciones, aciertos, Beyer/Speed Rating, jinete y entrenador
          habituales, y el <b>Índice de Consistencia Godet</b>.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          ⚠️ {error}
        </div>
      )}

      {!cargando && !carreras.length && !error && (
        <div className="rounded-2xl border border-line bg-surface p-8 text-center text-sm text-slate-500">
          No hay carreras registradas en la matriz para el {fecha}.
          <br />
          <span className="text-xs">
            Cargue el programa desde <b>Ejemplares → Gaceta IA</b> y la carrera aparecerá aquí.
          </span>
        </div>
      )}

      {/* ---------- Ranking ---------- */}
      {proyectando && (
        <div className="rounded-xl border border-primary-200 bg-primary-500/5 p-4 text-sm text-primary-700">
          Calculando la probabilidad actuarial…
        </div>
      )}

      {proyeccion && (
        <div className="rounded-2xl border border-line bg-surface p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-black uppercase tracking-wider text-slate-700">
                📈 Probabilidad Actuarial · {proyeccion.carrera.hipodromo} C{proyeccion.carrera.carrera}
              </h3>
              <p className="text-[11px] text-slate-500">
                {proyeccion.carrera.distancia ? `${proyeccion.carrera.distancia}m · ` : ""}
                {proyeccion.carrera.superficie || "ARENA"}
                {proyeccion.carrera.premio ? ` · premio $${proyeccion.carrera.premio}` : ""}
                {" · "}
                {proyeccion.ranking.length} ejemplar(es) con historial
              </p>
            </div>
            <Button
              variant="default"
              size="md"
              disabled={!ejemplaresGodet.length}
              onClick={() => setModalAbierto(true)}
              title="Abrir la pizarra prospectiva Godet & Actuarial con estos ejemplares"
            >
              🧭 Pizarra Godet & Actuarial
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead>
                <tr className="border-b border-line text-[10px] uppercase tracking-wider text-slate-500">
                  <th className="px-2 py-2">Puesto</th>
                  <th className="px-2 py-2">Nº</th>
                  <th className="px-2 py-2">Ejemplar</th>
                  <th className="px-2 py-2">Probabilidad</th>
                  <th className="px-2 py-2">Índ. Consistencia</th>
                  <th className="px-2 py-2">Speed Rating</th>
                  <th className="px-2 py-2">Actuaciones</th>
                  <th className="px-2 py-2">Top 3</th>
                  <th className="px-2 py-2">Credib.</th>
                  <th className="px-2 py-2">Riesgo</th>
                  <th className="px-2 py-2">Jinete</th>
                  <th className="px-2 py-2">Entrenador</th>
                  <th className="px-2 py-2">Notas</th>
                </tr>
              </thead>
              <tbody>
                {proyeccion.ranking.map((f) => (
                  <tr key={`${f.numero}-${f.nombre}`} className="border-b border-line/60 align-top">
                    <td className="px-2 py-2 font-black text-slate-700">#{f.puesto}</td>
                    <td className="px-2 py-2 font-black">{f.numero}</td>
                    <td className="px-2 py-2 font-semibold text-slate-800">{f.nombre}</td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-16 overflow-hidden rounded-full bg-slate-200">
                          <div
                            className={`h-full rounded-full ${colorProbabilidad(f.probabilidad)}`}
                            style={{ width: `${Math.min(100, f.probabilidad * 2.2)}%` }}
                          />
                        </div>
                        <span className="font-black tabular-nums">{f.probabilidad.toFixed(1)}%</span>
                      </div>
                    </td>
                    <td className="px-2 py-2 tabular-nums">
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-black ${
                          f.indiceConsistencia >= 60
                            ? "bg-emerald-100 text-emerald-700"
                            : f.indiceConsistencia >= 30
                              ? "bg-amber-100 text-amber-700"
                              : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {f.indiceConsistencia.toFixed(0)}
                      </span>
                    </td>
                    <td className="px-2 py-2 tabular-nums">{f.speedRating || "—"}</td>
                    <td className="px-2 py-2 tabular-nums">{f.actuaciones}</td>
                    <td className="px-2 py-2 tabular-nums">
                      {f.placements}
                      {f.actuaciones ? ` (${f.winRate.toFixed(0)}%)` : ""}
                    </td>
                    <td className="px-2 py-2 tabular-nums">Z={f.credibilidad.toFixed(2)}</td>
                    <td className="px-2 py-2">
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-black uppercase ${
                          f.riesgo === "alto"
                            ? "bg-red-100 text-red-700"
                            : f.riesgo === "medio"
                              ? "bg-amber-100 text-amber-700"
                              : "bg-emerald-100 text-emerald-700"
                        }`}
                      >
                        {f.riesgo}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-slate-600">{f.jineteHabitual || "—"}</td>
                    <td className="px-2 py-2 text-slate-600">{f.entrenadorHabitual || "—"}</td>
                    <td className="px-2 py-2 text-[10px] leading-snug text-slate-500">
                      {f.notas.length ? f.notas.join(" ") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-[10px] leading-relaxed text-slate-500">
            El modelo combina <b>forma</b> (speed rating ajustada por credibilidad Bühlmann-Straub),{" "}
            <b>consistencia</b> (índice Godet, ponderado por premio), <b>experiencia</b> y penaliza el{" "}
            <b>riesgo</b> (descanso corto, larga ausencia). Un ejemplar sin historial entra con la media de la población y
            no se inventa historial: el ranking lo dice.
          </p>
        </div>
      )}

      <ModalAnalisisActuarialGodet
        abierto={modalAbierto}
        onCerrar={() => setModalAbierto(false)}
        ejemplares={ejemplaresGodet}
      />

      <ToastHost />
    </div>
  );
}

export default ProyeccionesModule;
