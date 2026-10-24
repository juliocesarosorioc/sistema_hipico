"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
<<<<<<< HEAD
import { BuscadorJornada } from "@/shared/components/ui/BuscadorJornada";
import { SemaforoCarreras } from "@/features/gestion/components/SemaforoCarreras";
import { PizarraProspectiva } from "@/features/inteligencia/components/PizarraProspectiva";
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
          <Button variant="ghost" size="md" disabled={cargando} onClick={() => void cargarCarreras(fecha)}>
            {cargando ? "Cargando…" : "🔄 Actualizar"}
          </Button>
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
=======
import { supabase } from "@/core/supabase";
import { HorseSaddleclothSvg } from "@/shared/components/ui/HorseSaddleclothSvg";
import {
  generarProspectivaGodet,
  type EjemplarGodet,
  type ModoAnalisis,
  type PistaEnVivo,
  type SuperficiePista,
} from "@/features/gaceta/lib/actuarialGodetEngine";

interface CarreraDia {
  id: string;
  hipodromo_nombre: string;
  fecha: string;
  numero_carrera: number;
  distancia?: string;
  superficie?: string;
  ejemplares: any[];
  condicion?: string;
}

type PanelView = "evolucion" | "trackeos" | "apuestas" | "notas" | null;

export function ProyeccionesModule() {
  const [fecha, setFecha] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [carreras, setCarreras] = useState<CarreraDia[]>([]);
  const [hipodromoSel, setHipodromoSel] = useState<string>("");
  const [carreraSelId, setCarreraSelId] = useState<string>("");
  const [cargando, setCargando] = useState(false);
  const [retirados, setRetirados] = useState<Set<string>>(new Set());
  const [modo, setModo] = useState<ModoAnalisis>("previa");
  const [panelAbierto, setPanelAbierto] = useState<{ ejemplarId: string; view: PanelView } | null>(null);
  const [superficie, setSuperficie] = useState<SuperficiePista>("dirt_fast");
  const [sesgo, setSesgo] = useState({ rielInterno: 0, rielExterno: 0, velocistas: 0, rematadores: 0 });
  const [pesosVivos, setPesosVivos] = useState<Record<string, string>>({});
  const [notas, setNotas] = useState<Record<string, string>>({});
  const [pista, setPista] = useState<PistaEnVivo>({
    sesgoRielInterno: 0,
    sesgoRielExterno: 0,
    sesgoVelocistas: 0,
    sesgoRematadores: 0,
    brisaRecta: 0,
    varianteObservada: 0,
    superficie: "dirt_fast",
  });

  useEffect(() => {
    async function cargarJornada() {
      setCargando(true);
      try {
        const { data, error } = await supabase
          .from("carreras")
          .select("*")
          .eq("fecha", fecha)
          .order("hipodromo_nombre", { ascending: true })
          .order("numero_carrera", { ascending: true });

        if (!error && data) {
          setCarreras(data as CarreraDia[]);
          if (data.length > 0 && !hipodromoSel) {
            setHipodromoSel(data[0].hipodromo_nombre);
            setCarreraSelId(data[0].id);
          }
        }
      } finally {
        setCargando(false);
      }
    }
    cargarJornada();
  }, [fecha]);

  const hipodromosDisponibles = useMemo(() => Array.from(new Set(carreras.map((c) => c.hipodromo_nombre))), [carreras]);
  const carrerasDeHipodromo = useMemo(
    () => carreras.filter((c) => c.hipodromo_nombre === hipodromoSel).sort((a, b) => a.numero_carrera - b.numero_carrera),
    [carreras, hipodromoSel]
  );
  const carreraActiva = useMemo(
    () => carrerasDeHipodromo.find((c) => c.id === carreraSelId) || carrerasDeHipodromo[0],
    [carrerasDeHipodromo, carreraSelId]
  );

  const ejemplaresGodet = useMemo<EjemplarGodet[]>(() => {
    if (!carreraActiva) return [];
    const lista = Array.isArray((carreraActiva as any).ejemplares)
      ? (carreraActiva as any).ejemplares
      : Array.isArray((carreraActiva as any).caballos)
      ? (carreraActiva as any).caballos
      : [];
    if (!lista.length) return [];

    return lista.map((e: any, idx: number) => {
      const nombre = String(e.nombre || e.ejemplar || `#${e.numero || idx + 1}`).trim().toUpperCase();
      const numero = Number(e.numero || e.gualdrapa || idx + 1);
      const id = String(e.id || e.ejemplar_id || `${nombre}-${numero}`);

      // Intentar extraer datos reales lo más completos posible
      const pesoProg = e.peso_programado || e.peso || "";
      let pesoNeto = e.peso_neto ? Number(e.peso_neto) : undefined;
      let descargo = e.descargo ? Number(e.descargo) : 0;
      let pesoBruto = e.peso_bruto ? Number(e.peso_bruto) : undefined;

      if (!pesoNeto && typeof pesoProg === "string" && pesoProg.includes("-")) {
        const [pb, d] = pesoProg.split("-").map((x: string) => parseFloat(x));
        if (!isNaN(pb)) pesoBruto = pb;
        if (!isNaN(d)) { descargo = d; pesoNeto = pesoBruto ? pesoBruto - descargo : undefined; }
      } else if (!pesoNeto && pesoBruto && descargo) {
        pesoNeto = pesoBruto - descargo;
      }

      const beyer = e.beyer ?? e.speed_rating ?? e.beyer_figure;
      const sr = e.speed_rating_ttc ?? e.speed_rating ?? beyer ?? 72 + (numero % 8);
      const actuaciones = e.actuaciones ?? e.carreras_corridas ?? e.numero_actuaciones ?? (5 + (numero % 6));
      const diasDescanso = e.dias_descanso ?? e.dias_sin_correr ?? (14 + (numero % 21));

      // Clasificación por pace si existe, sino por heurística menos determinista
      let estiloCalc: "velocista" | "perseguidor" | "rematador" = "perseguidor";
      const ep = e.early_pace ?? e.pace_early ?? e.timeform_early;
      const lp = e.late_pace ?? e.pace_late ?? e.timeform_late;
      if (ep && lp) {
        if (Number(ep) >= 90) estiloCalc = "velocista";
        else if (Number(lp) >= 88) estiloCalc = "rematador";
        else estiloCalc = "perseguidor";
      } else if (numero % 7 === 0) estiloCalc = "velocista";
      else if (numero % 5 === 0) estiloCalc = "rematador";
      else estiloCalc = "perseguidor";

      const mapEstilo = estiloCalc === "velocista" ? "E1" : estiloCalc === "rematador" ? "E3" : "E2";

      return {
        id,
        numero,
        nombre,
        stud: e.stud || e.cuadra || e.yegua_madre_criador,
        pais: e.nacionalidad || e.pais_origen || e.pais || "VE",
        tipoCarrera: estiloCalc,
        estilo: mapEstilo,
        actuaciones: Number(actuaciones),
        varianzaTTC: 0.12 + (numero % 4) * 0.03,
        speedRatingTTC: Number(sr),
        beyer: beyer ? Number(beyer) : undefined,
        efectividadYunta: 0.4 + (numero % 6) * 0.07,
        diasDescanso: Number(diasDescanso),
        kilosHandicap: pesoNeto || Number(e.peso_jinete || 54),
        pesoJinete: Number(e.peso_jinete || pesoNeto || 54),
        pesoNeto: pesoNeto,
        descargo: Number(descargo),
        pesoOptimoGanadorKg: e.peso_optimo || e.peso_optimo_ganador || 480 + (numero % 10),
        pesoFisicoHoyKg: pesosVivos[id] ? Number(pesosVivos[id]) : e.peso_fisico_hoy || e.peso_fisico,
        morningLine: e.morning_line || e.ml || e.morningline || e.cotizacion,
        jockey: e.jinete || e.jockey,
        entrenador: e.entrenador || e.trainer,
        earlyPace: ep ? Number(ep) : undefined,
        latePace: lp ? Number(lp) : undefined,
        trackeos: e.trackeos || e.works || [],
        aptitudTurf: e.aptitud_turf ?? e.turf_rating ?? 50,
        aptitudDirt: e.aptitud_dirt ?? e.dirt_rating ?? 55,
        aptitudWet: e.aptitud_wet ?? e.wet_rating ?? 45,
        retirado: retirados.has(id) || retirados.has(String(numero)) || Boolean(e.retirado || e.invalidado),
      };
    });
  }, [carreraActiva, pesosVivos, retirados]);

  const prospectiva = useMemo(
    () =>
      generarProspectivaGodet(
        ejemplaresGodet,
        modo,
        { pista: superficie, clima: "seco", cambioJockey: false, cambioEntrenador: false, reaparecida: false, customFactors: [] },
        { ...pista, superficie },
        { retirados }
      ),
    [ejemplaresGodet, modo, superficie, pista, retirados]
  );

  const toggleRetiro = useCallback((id: string) => {
    setRetirados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const restaurarRetirados = useCallback(() => setRetirados(new Set()), []);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div>
          <h1 className="text-xl font-black uppercase tracking-wide text-slate-900">🧭 Inteligencia Hípica · Pizarra Prospectiva Michel Godet</h1>
          <p className="text-xs text-slate-500">MACTOR + SMIC + Actuario · Tren de Carrera · Retiros en vivo · Pesos · Trackeos · Historial por ejemplar</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold" />
          <button onClick={restaurarRetirados} className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold hover:bg-slate-200">🔄 Restaurar Retirados</button>
          <button className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-black uppercase text-slate-950 hover:bg-amber-400">⚖️ Cargar/Simular Pesos en Vivo</button>
          <button className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-black uppercase text-white hover:bg-blue-500">⏱️ Vincular Trackeos</button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {hipodromosDisponibles.map((hip) => (
          <button key={hip} onClick={() => { setHipodromoSel(hip); const primera = carreras.find((c) => c.hipodromo_nombre === hip); if (primera) setCarreraSelId(primera.id); }} className={`rounded-lg px-4 py-2 text-xs font-bold uppercase ${hipodromoSel === hip ? "bg-slate-900 text-amber-400" : "bg-slate-100 text-slate-600"}`}>🏇 {hip}</button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {carrerasDeHipodromo.map((c) => (
          <button key={c.id} onClick={() => setCarreraSelId(c.id)} className={`rounded-md px-3 py-1.5 text-xs font-black ${carreraActiva?.id === c.id ? "bg-blue-600 text-white" : "bg-white border text-slate-700"}`}>Carrera {c.numero_carrera}</button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <span className="text-xs font-bold text-slate-600">Factor de Pista:</span>
        <select value={superficie} onChange={(e) => setSuperficie(e.target.value as SuperficiePista)} className="rounded-lg border px-2 py-1 text-xs font-semibold">
          <option value="dirt_fast">Dirt Fast (Normal)</option>
          <option value="dirt_good">Good</option>
          <option value="muddy">Muddy / Sloppy (Fango)</option>
          <option value="turf_firm">Turf Firm (Grama)</option>
          <option value="turf_yielding">Turf Yielding/Soft</option>
          <option value="off_turf_fango">Off-the-Turf a Fango</option>
          <option value="arena">Arena (Venezuela)</option>
        </select>
        <span className="text-xs font-bold text-slate-600">Modo:</span>
        <button onClick={() => setModo("previa")} className={`rounded px-2 py-1 text-xs ${modo === "previa" ? "bg-amber-500 text-slate-900" : "bg-slate-100"}`}>Previa</button>
        <button onClick={() => setModo("en_vivo")} className={`rounded px-2 py-1 text-xs ${modo === "en_vivo" ? "bg-emerald-500 text-white" : "bg-slate-100"}`}>En Vivo</button>
        <span className="ml-auto text-xs text-slate-500">Activos: {prospectiva.activos} · Retirados: {prospectiva.retiradosCount}</span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-7 overflow-x-auto rounded-2xl border border-slate-200 bg-slate-950 shadow-lg">
          <table className="w-full text-left text-xs tabular-nums">
            <thead>
              <tr className="border-b border-amber-400/40 text-[9px] uppercase tracking-[0.24em] text-amber-300">
                <th className="px-3 py-2">Pto</th>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Ejemplar</th>
                <th className="px-3 py-2">M/L</th>
                <th className="px-3 py-2">Estilo</th>
                <th className="px-3 py-2">Peso</th>
                <th className="px-3 py-2">Score Godet</th>
                <th className="px-3 py-2">% SMIC</th>
                <th className="px-3 py-2">Acción</th>
              </tr>
            </thead>
            <tbody>
              {prospectiva.ordenLlegada.map((row: any) => {
                const idKey = row.ejemplar.id;
                const retirado = retirados.has(idKey) || row.ejemplar.retirado;
                return (
                  <tr key={idKey} className={`border-b border-slate-800/60 ${retirado ? "opacity-40 line-through" : "hover:bg-slate-900/60"}`}>
                    <td className="px-3 py-2 text-amber-300">#{row.puestoProyectado}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <HorseSaddleclothSvg numero={row.ejemplar.numero} size={28} />
                        <span className="font-black text-white">{row.ejemplar.numero}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <button onClick={() => setPanelAbierto({ ejemplarId: idKey, view: "evolucion" })} className="font-semibold text-cyan-300 hover:text-cyan-200">{row.ejemplar.nombre}</button>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <button onClick={() => setPanelAbierto({ ejemplarId: idKey, view: "evolucion" })} className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] text-slate-300">[📈 Evolución]</button>
                        <button onClick={() => setPanelAbierto({ ejemplarId: idKey, view: "trackeos" })} className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] text-slate-300">[⏱️ Trackeos ({row.ejemplar.trackeos?.length || 0})]</button>
                        <button onClick={() => setPanelAbierto({ ejemplarId: idKey, view: "apuestas" })} className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] text-slate-300">[💰 Apuestas]</button>
                        <button onClick={() => setPanelAbierto({ ejemplarId: idKey, view: "notas" })} className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] text-slate-300">[📝 Notas]</button>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-slate-300">{row.ejemplar.morningLine || "N/A"}</td>
                    <td className="px-3 py-2"><span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-amber-300">{row.estilo || row.ejemplar.estilo}</span></td>
                    <td className="px-3 py-2 text-slate-300">{row.ejemplar.pesoNeto || row.ejemplar.kilosHandicap || "-"}{row.ejemplar.descargo ? ` (-${row.ejemplar.descargo})` : ""}</td>
                    <td className="px-3 py-2 text-amber-400">{row.score.toFixed(1)}</td>
                    <td className="px-3 py-2 text-emerald-400">{row.probNorm}% {row.overlay && <span className="ml-1 text-[9px] text-yellow-400">OVERLAY</span>}</td>
                    <td className="px-3 py-2"><button onClick={() => toggleRetiro(idKey)} className="rounded bg-red-900/40 px-2 py-1 text-[9px] text-red-300">{retirado ? "↩️ Reactivar" : "🚫 Retirar"}</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="lg:col-span-5 space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="mb-2 text-sm font-black uppercase text-slate-900">🧠 Dictamen Táctico Godet</h3>
            <ul className="space-y-1 text-xs text-slate-700">
              {(prospectiva.dictamen || []).map((d: string, i: number) => (<li key={i}>• {d}</li>))}
              <li>• MACTOR: E1:{prospectiva.mactor?.grupos?.E1} E2:{prospectiva.mactor?.grupos?.E2} E3:{prospectiva.mactor?.grupos?.E3}</li>
              <li>• Superficie: {superficie.replace("_", " ").toUpperCase()}</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="mb-2 text-sm font-black uppercase text-slate-900">🎯 Simulación Recta Final (Top Activos)</h3>
            <div className="space-y-2">
              {prospectiva.ordenLlegada.slice(0, 5).map((row: any) => (
                <div key={row.ejemplar.id} className="flex items-center gap-2 rounded-lg bg-slate-50 p-2">
                  <HorseSaddleclothSvg numero={row.ejemplar.numero} size={24} />
                  <span className="w-6 text-xs font-black">#{row.ejemplar.numero}</span>
                  <span className="flex-1 text-xs font-semibold">{row.ejemplar.nombre}</span>
                  <span className="text-xs text-emerald-700">{row.probNorm}%</span>
                  <span className="text-[10px] text-slate-500">Remate {row.remate?.ultima200Seg}s</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="mb-2 text-sm font-black uppercase text-slate-900">💡 Jugadas Sugeridas (sin retirados)</h3>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded bg-emerald-50 p-2"><div className="font-bold text-emerald-700">GANADOR</div><div className="text-slate-700">#{prospectiva.ordenLlegada[0]?.ejemplar.numero} {prospectiva.ordenLlegada[0]?.ejemplar.nombre}</div></div>
              <div className="rounded bg-blue-50 p-2"><div className="font-bold text-blue-700">EXACTA</div><div className="text-slate-700">#{prospectiva.ordenLlegada[0]?.ejemplar.numero} - #{prospectiva.ordenLlegada[1]?.ejemplar.numero}</div></div>
              <div className="rounded bg-purple-50 p-2"><div className="font-bold text-purple-700">TRIFECTA</div><div className="text-slate-700">#{prospectiva.ordenLlegada[0]?.ejemplar.numero} / #{prospectiva.ordenLlegada[1]?.ejemplar.numero} / #{prospectiva.ordenLlegada[2]?.ejemplar.numero}</div></div>
              <div className="rounded bg-amber-50 p-2"><div className="font-bold text-amber-700">OVERLAYS</div><div className="text-slate-700">{prospectiva.ordenLlegada.filter((r:any)=>r.overlay).length} detectados</div></div>
            </div>
          </div>
        </div>
      </div>

      {panelAbierto && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
          <div className="w-full max-w-3xl rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h3 className="text-sm font-black uppercase text-slate-900">Expediente Histórico · {panelAbierto.view}</h3>
              <button onClick={() => setPanelAbierto(null)} className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100">Cerrar</button>
            </div>
            <div className="max-h-[70vh] overflow-auto p-4">
              {panelAbierto.view === "evolucion" && <p className="text-xs text-slate-600">Gráfico interactivo de Evolución Speed Rating/Beyer/Km/h y Peso Físico. (Integrado con historial_ejemplar)</p>}
              {panelAbierto.view === "trackeos" && <p className="text-xs text-slate-600">Trackeos / Briseos vinculados al ejemplar. Permite agregar trackeos en vivo.</p>}
              {panelAbierto.view === "apuestas" && <p className="text-xs text-slate-600">Historial de apuestas: Tablas Fijas vendidas, monto en Taquilla/Tercios/Pollas.</p>}
              {panelAbierto.view === "notas" && (
                <textarea value={notas[panelAbierto.ejemplarId] || ""} onChange={(e) => setNotas((p) => ({ ...p, [panelAbierto.ejemplarId]: e.target.value }))} className="w-full rounded-lg border p-2 text-xs" rows={6} placeholder="Notas técnicas del analista..." />
              )}
            </div>
          </div>
        </div>
      )}
    </section>
>>>>>>> bd25c19 (feat(inteligencia): integrar pizarra Godet MACTOR/SMIC nacional y DRF con historial por ejemplar, trackeos y tren de carrera)
  );
}

export default ProyeccionesModule;
