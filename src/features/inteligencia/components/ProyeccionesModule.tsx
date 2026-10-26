"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BuscadorJornada } from "@/shared/components/ui/BuscadorJornada";
import { SemaforoCarreras } from "@/features/gestion/components/SemaforoCarreras";
import { PizarraProspectiva } from "@/features/inteligencia/components/PizarraProspectiva";
import { ModalAnalisisActuarialGodet } from "@/features/ejemplares/components/ModalAnalisisActuarialGodet";
import {
  leerCarrerasDeInteligencia,
  proyectarCarrera,
  type ProyeccionCarrera,
} from "@/features/inteligencia/lib/datos";
import { aplicarRetirosCarrera } from "@/features/carreras/lib/retiros";
import { claveHipodromo } from "@/features/carreras/lib/claves";
import type { CarreraCatalogo } from "@/features/carreras/lib/maestro-nucleo";
import { fechaJornadaCaracas } from "@/core/utils/fechas";
import { Button } from "@/shared/components/ui/Button";
import { ToastHost } from "@/shared/components/ui/ToastHost";
import { emitirToast } from "@/shared/lib/mensajeria";
import { useHipodromosActivos } from "@/shared/store/useHipodromosStore";
import { useRegistroCentralOpts } from "@/shared/store/useRegistroCentral";
import { nombrePropioHipodromo } from "@/features/hipodromos/lib/nombre";

/** Color de la barra de probabilidad, del mejor al peor. */
const colorProbabilidad = (p: number): string =>
  p >= 25 ? "bg-emerald-500" : p >= 15 ? "bg-amber-500" : p >= 8 ? "bg-sky-500" : "bg-slate-400";

/**
 * INTELIGENCIA HÍPICA — Proyecciones + Pizarra Prospectiva.
 *
 * La pantalla tiene la MISMA forma que Gestión de Jugadas:
 *
 *   1. `BuscadorJornada` (fecha + hipódromo, la grilla compacta de 7 columnas).
 *   2. `SemaforoCarreras` para elegir la carrera del día.
 *   3. La pizarra MACTOR/SMIC/actuarial (pesos, retiros, recta final, tickets).
 *   4. La tabla del ranking actuarial, que sigue siendo la fuente fría del
 *      modelo y la que se compara contra la pizarra.
 *
 * La pizarra NO escribe retiros sin confirmación: el tablero simula y recién
 * «Aplicar retiros oficiales» llama al servicio central de retiros (el mismo
 * de Gestión de Jugadas), que propaga a Taquilla, Tablas, Marcas y Liquidación.
 */
export function ProyeccionesModule() {
  const [fecha, setFecha] = useState(() => fechaJornadaCaracas());
  const [hipodromo, setHipodromo] = useState("");
  const [carreras, setCarreras] = useState<CarreraCatalogo[]>([]);
  const [carreraActiva, setCarreraActiva] = useState<number | null>(null);
  const [proyeccion, setProyeccion] = useState<ProyeccionCarrera | null>(null);
  const [cargando, setCargando] = useState(false);
  const [proyectando, setProyectando] = useState(false);
  const [aplicandoRetiros, setAplicandoRetiros] = useState(false);
  const [error, setError] = useState("");
  const [abrirGodetModal, setAbrirGodetModal] = useState(false);

  const activos = useHipodromosActivos();
  const { hipodromosDelDia } = useRegistroCentralOpts(fecha);

  const toast = useCallback(
    (msg: string, tipo: "success" | "warning" | "error" | "info" = "info") => {
      emitirToast(msg, tipo);
    },
    []
  );

  /** Carga TODAS las carreras del día; el filtro por hipódromo es local. */
  const cargarCarreras = useCallback(async (f: string) => {
    setCargando(true);
    setError("");
    const res = await leerCarrerasDeInteligencia(f);
    setCargando(false);
    if (!res.ok) {
      setCarreras([]);
      setProyeccion(null);
      setError(
        res.error ??
          "No se pudo leer la matriz de carreras. Aplique sql/carreras.sql para habilitarla."
      );
      return;
    }
    setCarreras(res.carreras);
  }, []);

  useEffect(() => {
    void cargarCarreras(fecha);
  }, [cargarCarreras, fecha]);

  const opcionesHipodromo = useMemo(
    () => activos.map((h) => ({ value: h.value, label: h.label })),
    [activos]
  );

  /** Carreras del hipódromo elegido (comparación por clave canónica). */
  const carrerasDelHipodromo = useMemo(() => {
    if (!hipodromo) return [];
    const clave = claveHipodromo(hipodromo);
    return carreras
      .filter((c) => claveHipodromo(c.hipodromo) === clave)
      .sort((a, b) => Number(a.carrera) - Number(b.carrera));
  }, [carreras, hipodromo]);

  /** Si cambia el hipódromo (o desaparece la carrera elegida), reencuadra. */
  useEffect(() => {
    if (!hipodromo) {
      setCarreraActiva(null);
      setProyeccion(null);
      return;
    }
    const sigue = carrerasDelHipodromo.some((c) => Number(c.carrera) === carreraActiva);
    if (!sigue) {
      setCarreraActiva(
        carrerasDelHipodromo.length ? Number(carrerasDelHipodromo[0].carrera) : null
      );
      setProyeccion(null);
    }
  }, [hipodromo, carrerasDelHipodromo, carreraActiva]);

  /** Proyecta la carrera activa (y la vuelve a proyectar al recargar la matriz). */
  useEffect(() => {
    if (!hipodromo || carreraActiva == null) {
      setProyeccion(null);
      return;
    }
    const carrera = carrerasDelHipodromo.find((c) => Number(c.carrera) === carreraActiva);
    if (!carrera) return;

    let vivo = true;
    setProyectando(true);
    setError("");
    void (async () => {
      const res = await proyectarCarrera(carrera, fecha);
      if (!vivo) return;
      setProyectando(false);
      if (!res.ok || !res.datos) {
        setProyeccion(null);
        setError(res.error ?? "No se pudo proyectar la carrera.");
        return;
      }
      setProyeccion(res.datos);
      if (res.datos.aviso) toast(res.datos.aviso, "warning");
    })();
    return () => {
      vivo = false;
    };
  }, [hipodromo, carreraActiva, carrerasDelHipodromo, fecha, toast]);

  /**
   * Aplica la lista COMPLETA de retiros de la pizarra al servicio central.
   * El hipódromo se toma de la CARRERA (no del catálogo) para escribir en la
   * misma fila que ya usan Taquilla y Liquidación.
   */
  const aplicarRetiros = useCallback(
    async (numeros: number[]): Promise<boolean> => {
      if (carreraActiva == null) return false;
      const h = proyeccion?.carrera.hipodromo || hipodromo;
      if (!h) return false;

      setAplicandoRetiros(true);
      const res = await aplicarRetirosCarrera({
        fecha,
        hipodromo: h,
        carrera: carreraActiva,
        numeros,
      });
      setAplicandoRetiros(false);

      if (!res.ok) {
        toast(res.error ?? "No se pudieron aplicar los retiros.", "error");
        return false;
      }

      const avisos = res.errores?.length ? ` Avisos: ${res.errores.join(" ")}` : "";
      toast(
        `Retiros aplicados a C${carreraActiva}: ${res.texto}. Tablas sincronizadas: ${res.tablasAfectadas} · Reembolsos: ${res.reembolsos}.${avisos}`,
        res.errores?.length ? "warning" : "success"
      );

      // Releer la matriz: trae los retirados oficiales ya reflejados y dispara
      // una nueva proyección con el lote actualizado.
      await cargarCarreras(fecha);
      return true;
    },
    [carreraActiva, fecha, hipodromo, proyeccion, cargarCarreras, toast]
  );

  const carreraSel = useMemo(
    () => carrerasDelHipodromo.find((c) => Number(c.carrera) === carreraActiva) ?? null,
    [carrerasDelHipodromo, carreraActiva]
  );

  return (
    <div className="flex flex-col gap-3 pb-6">
      {/* Banner oficial: Motor IA Godet v3 en modo En Construcción */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-400/50 bg-slate-900 px-4 py-3 text-white shadow-sm">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-400/15 text-xl">
            🧭
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xs font-black uppercase tracking-wider text-amber-400">
                🧭 Motor IA Godet v3 (MACTOR + SMIC + Actuario v4)
              </h2>
              <span className="rounded-full border border-amber-400/60 bg-amber-500/20 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-amber-300">
                🚧 Módulo en Construcción — Próximamente activo
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-slate-300">
              Análisis prospectivo de alianzas y conflictos (MACTOR), impactos cruzados (SMIC) y credibilidad actuarial Bühlmann-Straub exclusivo de Inteligencia Hípica.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setAbrirGodetModal(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/50 bg-amber-500/10 px-3 py-1.5 text-[11px] font-black uppercase tracking-wider text-amber-300 hover:bg-amber-500/20"
        >
          🚧 Vista Previa en Construcción
        </button>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* BUSCADOR DE JORNADA — misma grilla que Gestión de Jugadas        */}
      {/* ---------------------------------------------------------------- */}
      <BuscadorJornada
        fecha={fecha}
        onFecha={(f) => {
          setFecha(f || fechaJornadaCaracas());
          setCarreraActiva(null);
          setProyeccion(null);
        }}
        hipodromo={hipodromo}
        onHipodromo={(h) => {
          setHipodromo(h);
          setCarreraActiva(null);
          setProyeccion(null);
        }}
        hipodromos={opcionesHipodromo}
        delDia={hipodromosDelDia}
        columnas={5}
        disabled={cargando}
        acciones={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="md" disabled={cargando} onClick={() => void cargarCarreras(fecha)}>
              {cargando ? "Cargando…" : "🔄 Actualizar"}
            </Button>
          </div>
        }
      >
        <div>
          <span className="mb-0.5 block text-[9px] font-bold uppercase leading-none tracking-wide text-slate-500">
            3 · Carrera
          </span>
          <div className="flex h-[26px] items-center truncate rounded-md border border-line bg-gray-50 px-2 text-[13px] font-bold leading-tight text-slate-800">
            {carreraSel ? (
              <>
                C{carreraSel.carrera}
                {carreraSel.distancia ? ` · ${carreraSel.distancia} m` : ""}
                {carreraSel.superficie ? ` · ${carreraSel.superficie}` : ""}
              </>
            ) : (
              <span className="font-normal text-slate-400">Elegí una carrera en el semáforo</span>
            )}
          </div>
        </div>
      </BuscadorJornada>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
          ⚠️ {error}
        </div>
      )}

      {!hipodromo && (
        <div className="rounded-2xl border border-line bg-surface p-8 text-center text-sm text-slate-500">
          Elegí un <b>hipódromo</b> para ver sus carreras del día y abrir la pizarra.
          <br />
          <span className="text-xs">
            Los hipódromos con carreras cargadas aparecen primero en el buscador.
          </span>
        </div>
      )}

      {hipodromo && carrerasDelHipodromo.length > 0 && (
        <SemaforoCarreras
          hipodromo={hipodromo}
          fecha={fecha}
          carreras={carrerasDelHipodromo.map((c) => Number(c.carrera))}
          activa={carreraActiva}
          onSeleccionar={(n) => setCarreraActiva(n)}
        />
      )}

      {hipodromo && !cargando && !carrerasDelHipodromo.length && !error && (
        <div className="rounded-2xl border border-line bg-surface p-8 text-center text-sm text-slate-500">
          No hay carreras registradas en la matriz para {nombrePropioHipodromo(hipodromo, activos)} el {fecha}.
          <br />
          <span className="text-xs">
            Cargue el programa desde <b>Ejemplares → Gaceta IA</b> y la carrera aparecerá aquí.
          </span>
        </div>
      )}

      {proyectando && (
        <div className="rounded-xl border border-primary-200 bg-primary-500/5 p-3 text-sm font-semibold text-primary-700">
          Cruzando memoria histórica, pesos declarados y tren de carrera…
        </div>
      )}

      {proyeccion && !proyectando && (
        <PizarraProspectiva
          proyeccion={proyeccion}
          fecha={fecha}
          onAplicarRetiros={aplicarRetiros}
          aplicandoRetiros={aplicandoRetiros}
        />
      )}

      {proyeccion && !proyectando && (
        <TablaActuarial proyeccion={proyeccion} />
      )}

      <ModalAnalisisActuarialGodet abierto={abrirGodetModal} onCerrar={() => setAbrirGodetModal(false)} hipodromo={hipodromo || undefined} carrera={carreraSel?.carrera} fecha={fecha} ejemplares={proyeccion?.ranking.map((r) => ({ numero: r.numero, nombre: r.nombre, jinete: r.jineteHabitual, entrenador: r.entrenadorHabitual, speedRating: r.speedRating })) ?? []} />
      <ToastHost />
    </div>
  );
}

/**
 * Tabla fría del ranking: la probabilidad del modelo actuarial sin los ajustes
 * del día. Es la referencia contra la que se lee la pizarra (que sí los aplica),
 * y permite auditar por qué un ejemplar subió o bajó.
 */
function TablaActuarial({ proyeccion }: { proyeccion: ProyeccionCarrera }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
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
        <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
          Sin ajustes del día · fuente fría
        </span>
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
        <b>riesgo</b> (descanso corto, larga ausencia). Un ejemplar sin historial entra con la media de
        la población y no se inventa historial: el ranking lo dice. La <b>pizarra</b> de arriba sí aplica
        los ajustes del día (tren, peso, pista y retiros) sobre esta misma base.
      </p>
    </div>
  );
}

export default ProyeccionesModule;
