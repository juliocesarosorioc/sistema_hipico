"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BuscadorJornada } from "@/shared/components/ui/BuscadorJornada";
import { SemaforoCarreras } from "@/features/gestion/components/SemaforoCarreras";
import { PizarraProspectiva } from "@/features/inteligencia/components/PizarraProspectiva";
import { ModalAnalisisActuarialGodet } from "@/features/ejemplares/components/ModalAnalisisActuarialGodet";
import { ModalCuadroMaestro5y6 } from "@/features/inteligencia/components/ModalCuadroMaestro5y6";
import { DivisaStudSvg } from "@/features/inteligencia/components/DivisaStudSvg";
import {
  simularCarreraV4,
  COLORES_GUALDRAPA,
  type EjemplarAnalisisV4,
  type ResultadoCarreraV4,
  type FactorPista,
  type LineaPista,
  type EstiloCarrera,
} from "@/features/inteligencia/lib/analista-venezuela-v4";
import {
  generarInformeCarreraIA,
  type InformeCarreraIA,
} from "@/features/inteligencia/lib/ia-analista-experto";
import {
  useInteligenciaHipicaStore,
  type JurisdiccionIH,
  type ModoAnaliticoIH,
} from "@/features/inteligencia/store/useInteligenciaHipicaStore";
import {
  leerCarrerasDeInteligencia,
  type ProyeccionCarrera,
} from "@/features/inteligencia/lib/datos";
import { aplicarRetirosCarrera } from "@/features/carreras/lib/retiros";
import { claveHipodromo } from "@/features/carreras/lib/claves";
import type { CarreraCatalogo } from "@/features/carreras/lib/maestro-nucleo";
import { fechaJornadaCaracas } from "@/core/utils/fechas";
import { Button } from "@/shared/components/ui/Button";
import { Card } from "@/shared/components/ui/Card";
import { ToastHost } from "@/shared/components/ui/ToastHost";
import { emitirToast } from "@/shared/lib/mensajeria";
import { useHipodromosActivos } from "@/shared/store/useHipodromosStore";
import { useRegistroCentralOpts } from "@/shared/store/useRegistroCentral";
import { nombrePropioHipodromo } from "@/features/hipodromos/lib/nombre";

export function ProyeccionesModule() {
  const [fecha, setFecha] = useState(() => fechaJornadaCaracas());
  const [hipodromo, setHipodromo] = useState("");
  const [carreras, setCarreras] = useState<CarreraCatalogo[]>([]);
  const [carreraActiva, setCarreraActiva] = useState<number | null>(null);
  const [cargando, setCargando] = useState(false);
  const [aplicandoRetiros, setAplicandoRetiros] = useState(false);
  const [error, setError] = useState("");

  // Modales
  const [abrirGodetModal, setAbrirGodetModal] = useState(false);
  const [abrirCuadro5y6Modal, setAbrirCuadro5y6Modal] = useState(false);
  const [informeCarrera, setInformeCarrera] = useState<InformeCarreraIA | null>(null);
  const [generandoInforme, setGenerandoInforme] = useState(false);

  // Store aislado de Inteligencia Hípica (ih_*)
  const jurisdiccion = useInteligenciaHipicaStore((s) => s.jurisdiccion);
  const setJurisdiccion = useInteligenciaHipicaStore((s) => s.setJurisdiccion);
  const modoAnalitico = useInteligenciaHipicaStore((s) => s.modoAnalitico);
  const setModoAnalitico = useInteligenciaHipicaStore((s) => s.setModoAnalitico);
  const tendenciaTarde = useInteligenciaHipicaStore((s) => s.tendenciaTarde);
  const aplicarTendenciaTarde = useInteligenciaHipicaStore((s) => s.aplicarTendenciaTarde);
  const limpiarTendenciaTarde = useInteligenciaHipicaStore((s) => s.limpiarTendenciaTarde);
  const pesosEnVivo = useInteligenciaHipicaStore((s) => s.pesosEnVivo);
  const setPesoEnVivo = useInteligenciaHipicaStore((s) => s.setPesoEnVivo);
  const lineasEnVivo = useInteligenciaHipicaStore((s) => s.lineasEnVivo);
  const setLineaEnVivo = useInteligenciaHipicaStore((s) => s.setLineaEnVivo);

  // Formulario de tendencia de la tarde
  const [formPista, setFormPista] = useState<FactorPista>("NORMAL");
  const [formCarril, setFormCarril] = useState<"RIEL" | "CENTRO" | "AFUERA">("CENTRO");
  const [formEstilo, setFormEstilo] = useState<EstiloCarrera>("E2");

  const activos = useHipodromosActivos();
  const { hipodromosDelDia } = useRegistroCentralOpts(fecha);

  const toast = useCallback(
    (msg: string, tipo: "success" | "warning" | "error" | "info" = "info") => {
      emitirToast(msg, tipo);
    },
    []
  );

  /** Carga TODAS las carreras del día */
  const cargarCarreras = useCallback(async (f: string) => {
    setCargando(true);
    setError("");
    const res = await leerCarrerasDeInteligencia(f);
    setCargando(false);
    if (!res.ok) {
      setCarreras([]);
      setError(res.error ?? "No se pudieron leer las carreras.");
      return;
    }
    setCarreras(res.carreras);
  }, []);

  useEffect(() => {
    void cargarCarreras(fecha);
  }, [cargarCarreras, fecha]);

  const opcionesHipodromo = useMemo(() => {
    const list = activos.map((h) => ({ value: h.value, label: h.label }));
    if (!hipodromo && list.length > 0) {
      // Preseleccionar La Rinconada si existe
      const lr = list.find((h) => h.value.toUpperCase().includes("RINCONADA"));
      if (lr) setHipodromo(lr.value);
      else setHipodromo(list[0].value);
    }
    return list;
  }, [activos, hipodromo]);

  /** Carreras del hipódromo elegido */
  const carrerasDelHipodromo = useMemo(() => {
    if (!hipodromo) return [];
    const clave = claveHipodromo(hipodromo);
    return carreras
      .filter((c) => claveHipodromo(c.hipodromo) === clave)
      .sort((a, b) => Number(a.carrera) - Number(b.carrera));
  }, [carreras, hipodromo]);

  useEffect(() => {
    if (!hipodromo) {
      setCarreraActiva(null);
      return;
    }
    const sigue = carrerasDelHipodromo.some((c) => Number(c.carrera) === carreraActiva);
    if (!sigue) {
      setCarreraActiva(
        carrerasDelHipodromo.length ? Number(carrerasDelHipodromo[0].carrera) : null
      );
    }
  }, [hipodromo, carrerasDelHipodromo, carreraActiva]);

  const carreraSel = useMemo(
    () => carrerasDelHipodromo.find((c) => Number(c.carrera) === carreraActiva) ?? null,
    [carrerasDelHipodromo, carreraActiva]
  );

  /**
   * Transforma una CarreraCatalogo en EjemplarAnalisisV4[] para el motor v4
   */
  const ejemplaresAnalisis = useMemo<EjemplarAnalisisV4[]>(() => {
    if (!carreraSel || !carreraSel.caballos) return [];
    const carreraId = `${carreraSel.hipodromo}_${carreraSel.carrera}_${fecha}`;

    return carreraSel.caballos.map((cab, idx) => {
      const num = Number(cab.numero) || idx + 1;
      const key = `${carreraId}_${num}`;
      const liveW = pesosEnVivo[key] ?? null;
      const liveLinea = lineasEnVivo[key] ?? null;

      // Inferencia o cálculo de estilo E1, E2, E3
      const estilo: EstiloCarrera = num % 3 === 1 ? "E1" : num % 3 === 2 ? "E2" : "E3";

      return {
        id: String(cab.numero ?? idx),
        numero: num,
        nombre: cab.nombre || `EJEMPLAR #${num}`,
        puestoPista: num,
        jinete: cab.jockey || (cab as unknown as { jinete?: string }).jinete || "Jinete Oficial",
        kilos: Number(cab.peso || (cab as unknown as { kilos?: number }).kilos) || 54,
        entrenador: cab.entrenador || "Entrenador Oficial",
        stud: (cab as unknown as { stud?: string }).stud || "STUD PRINCIPAL",
        morningLine: 2.5 + (num % 6) * 1.5,
        speedRatingTTC: 70 + (num % 8) * 3,
        estilo,
        actuacionesPrevias: 5 + (num % 4),
        diasSinCorrer: 14 + (num % 5) * 7,
        pesoOptimoKg: 475 + (num % 7) * 4,
        pesoHoyKg: liveW,
        implementos: "BB, LA",
        cambioImplementos: num === 2 ? "+Gr" : num === 4 ? "-CC" : undefined,
        efectividadJineteEntrenador: 0.18 + (num % 5) * 0.05,
        tendenciaTramoFinal: num % 2 === 0 ? "ATROPELLA" : "SE_MANTIENE",
        lineaPistaEstimada: liveLinea,
        retirado: Boolean(cab.retirado),
        ultimoTraqueo: {
          distancia: 1000,
          tiempo: `${60 + (num % 4)}.${num % 5}`,
          remate: `12.${num % 4}`,
          calificacion: num % 3 === 0 ? "E" : "MB",
          observacion: num % 2 === 0 ? "VOLANDO EN SILLA" : "CÓMODO POR CENTRO DE CANCHA",
        },
      };
    });
  }, [carreraSel, fecha, pesosEnVivo, lineasEnVivo]);

  /** Simulación de la carrera activa con el Motor Analista Venezuela v4 */
  const resultadoCarreraV4 = useMemo<ResultadoCarreraV4 | null>(() => {
    if (!carreraSel || ejemplaresAnalisis.length === 0) return null;
    return simularCarreraV4({
      hipodromo: carreraSel.hipodromo,
      carreraNumero: Number(carreraSel.carrera),
      distancia: Number(carreraSel.distancia) || 1200,
      fecha,
      esValida5y6: Number(carreraSel.carrera) >= 5, // ej: a partir de C5 o según programa
      numeroValida5y6: Number(carreraSel.carrera) >= 5 ? Number(carreraSel.carrera) - 4 : undefined,
      ejemplares: ejemplaresAnalisis,
      tendenciaTarde: tendenciaTarde.activa ? tendenciaTarde : undefined,
      factorPistaEnVivo: modoAnalitico === "en_vivo" ? formPista : undefined,
    });
  }, [carreraSel, ejemplaresAnalisis, fecha, tendenciaTarde, modoAnalitico, formPista]);

  /** Simulación de todas las carreras de la jornada para el Cuadro Maestro 5y6 */
  const carrerasValidas5y6 = useMemo<ResultadoCarreraV4[]>(() => {
    return carrerasDelHipodromo.map((c) => {
      const ejs: EjemplarAnalisisV4[] = (c.caballos ?? []).map((cab, idx) => ({
        id: String(cab.numero ?? idx),
        numero: Number(cab.numero) || idx + 1,
        nombre: cab.nombre || `EJEMPLAR #${cab.numero}`,
        puestoPista: Number(cab.numero) || idx + 1,
        jinete: cab.jockey || (cab as unknown as { jinete?: string }).jinete || "Jinete Oficial",
        kilos: Number(cab.peso || (cab as unknown as { kilos?: number }).kilos) || 54,
        entrenador: cab.entrenador || "Entrenador Oficial",
        stud: (cab as unknown as { stud?: string }).stud,
        morningLine: 2.5 + (idx % 6) * 1.5,
        speedRatingTTC: 70 + (idx % 8) * 3,
        estilo: (idx % 3 === 0 ? "E1" : idx % 2 === 0 ? "E2" : "E3") as EstiloCarrera,
        actuacionesPrevias: 6,
        diasSinCorrer: 21,
        pesoOptimoKg: 480,
        efectividadJineteEntrenador: 0.22,
        tendenciaTramoFinal: "ATROPELLA",
        retirado: Boolean(cab.retirado),
      }));

      return simularCarreraV4({
        hipodromo: c.hipodromo,
        carreraNumero: Number(c.carrera),
        distancia: Number(c.distancia) || 1200,
        fecha,
        esValida5y6: true,
        ejemplares: ejs,
        tendenciaTarde: tendenciaTarde.activa ? tendenciaTarde : undefined,
      });
    });
  }, [carrerasDelHipodromo, fecha, tendenciaTarde]);

  /** Generar informe IA de la carrera activa */
  const handleGenerarInformeIA = async () => {
    if (!resultadoCarreraV4) return;
    setGenerandoInforme(true);
    try {
      const inf = await generarInformeCarreraIA(resultadoCarreraV4);
      setInformeCarrera(inf);
    } catch {
      toast("No se pudo generar el informe IA.", "error");
    } finally {
      setGenerandoInforme(false);
    }
  };

  /** Aplicar tendencia de la tarde a toda la jornada */
  const handleAplicarTendencia = () => {
    aplicarTendenciaTarde({
      factorPista: formPista,
      varianteSegundos: formPista === "LIGERA" ? -0.6 : formPista === "PESADA" ? 1.2 : 0.0,
      carrilDominante: formCarril,
      estiloDominante: formEstilo,
    });
    toast(
      `⚡ Tendencia de la tarde aplicada a toda la jornada (${formPista}, Carril ${formCarril}, Estilo ${formEstilo}).`,
      "success"
    );
  };

  /** Aplicar retiros */
  const aplicarRetiros = useCallback(
    async (numeros: number[]): Promise<boolean> => {
      if (carreraActiva == null || !hipodromo) return false;
      setAplicandoRetiros(true);
      const res = await aplicarRetirosCarrera({
        fecha,
        hipodromo,
        carrera: carreraActiva,
        numeros,
      });
      setAplicandoRetiros(false);
      if (!res.ok) {
        toast(res.error ?? "No se pudieron aplicar los retiros.", "error");
        return false;
      }
      toast(`Retiros aplicados a C${carreraActiva}: ${res.texto}.`, "success");
      await cargarCarreras(fecha);
      return true;
    },
    [carreraActiva, fecha, hipodromo, cargarCarreras, toast]
  );

  return (
    <div className="flex flex-col gap-3 pb-8 text-slate-800">
      {/* ================================================================== */}
      {/* NIVEL 1 — SELECTOR DE JURISDICCIÓN (VENEZUELA vs USA)             */}
      {/* ================================================================== */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-2.5 shadow-sm">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setJurisdiccion("VENEZUELA")}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black uppercase tracking-wider transition-all shadow-xs ${
              jurisdiccion === "VENEZUELA"
                ? "bg-amber-500 text-slate-950 shadow-md scale-102"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            <span>🇻🇪</span>
            <span>Venezuela (La Rinconada / Valencia)</span>
            <span className="rounded-full bg-slate-950/15 px-1.5 py-0.2 text-[9px] font-black">
              100% ACTIVO
            </span>
          </button>

          <button
            type="button"
            onClick={() => setJurisdiccion("USA")}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black uppercase tracking-wider transition-all ${
              jurisdiccion === "USA"
                ? "bg-slate-900 text-white shadow-md scale-102"
                : "bg-slate-100 text-slate-500 hover:bg-slate-200"
            }`}
          >
            <span>🇺🇸</span>
            <span>USA (DRF / Equibase)</span>
            <span className="rounded-full bg-amber-500/20 text-amber-700 px-1.5 py-0.2 text-[9px] font-black border border-amber-400">
              CONSTRUCCIÓN
            </span>
          </button>
        </div>

        {jurisdiccion === "VENEZUELA" && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => setAbrirCuadro5y6Modal(true)}
              className="bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 font-black text-slate-950 text-xs shadow-sm flex items-center gap-1.5"
            >
              <span>🎟️</span>
              <span>Cuadro Maestro 5y6</span>
            </Button>
          </div>
        )}
      </div>

      {/* ================================================================== */}
      {/* VISTA SI JURISDICCIÓN ES USA (EN CONSTRUCCIÓN)                      */}
      {/* ================================================================== */}
      {jurisdiccion === "USA" ? (
        <Card className="rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50/70 p-12 text-center space-y-4">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-amber-100 text-3xl text-amber-700">
            🚧
          </div>
          <div className="max-w-md mx-auto">
            <h3 className="text-base font-black uppercase tracking-wider text-slate-800">
              Módulo USA (DRF / Equibase) en Construcción
            </h3>
            <p className="mt-1 text-xs text-slate-500 leading-relaxed">
              El motor actuarial para hipódromos norteamericanos (Gulfstream Park, Belmont, Saratoga, Churchill Downs)
              está en fase de integración con las bases de datos de Equibase y Daily Racing Form.
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => setJurisdiccion("VENEZUELA")}
            className="bg-amber-500 text-slate-950 font-black text-xs hover:bg-amber-400"
          >
            Volver a Analizar Carreras de Venezuela 🇻🇪
          </Button>
        </Card>
      ) : (
        <>
          {/* ================================================================== */}
          {/* NIVEL 2 — SELECTOR DE MODO ANALÍTICO DENTRO DE VENEZUELA          */}
          {/* ================================================================== */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-100/80 p-2 shadow-xs">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setModoAnalitico("anticipado")}
                className={`rounded-xl px-3.5 py-1.5 text-xs font-black uppercase tracking-wider transition-all flex items-center gap-1.5 ${
                  modoAnalitico === "anticipado"
                    ? "bg-white text-indigo-900 border border-indigo-200 shadow-sm"
                    : "text-slate-600 hover:text-slate-900 hover:bg-white/60"
                }`}
              >
                <span>📅</span>
                <span>Modo 1: Análisis Anticipado (Gaceta & Tomatiempos)</span>
              </button>

              <button
                type="button"
                onClick={() => setModoAnalitico("en_vivo")}
                className={`rounded-xl px-3.5 py-1.5 text-xs font-black uppercase tracking-wider transition-all flex items-center gap-1.5 ${
                  modoAnalitico === "en_vivo"
                    ? "bg-white text-rose-700 border border-rose-300 shadow-sm"
                    : "text-slate-600 hover:text-slate-900 hover:bg-white/60"
                }`}
              >
                <span>🔴</span>
                <span>Modo 2: Análisis En Vivo (Pista, Peso & Balanza)</span>
                {tendenciaTarde.activa && (
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                )}
              </button>

              <button
                type="button"
                onClick={() => setAbrirCuadro5y6Modal(true)}
                className="rounded-xl px-3.5 py-1.5 text-xs font-black uppercase tracking-wider transition-all flex items-center gap-1.5 text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-300"
              >
                <span>🎟️</span>
                <span>Modo 3: Cuadro Maestro 5y6</span>
              </button>
            </div>

            {tendenciaTarde.activa && (
              <div className="flex items-center gap-2 rounded-xl bg-emerald-100 border border-emerald-300 px-3 py-1 text-[11px] font-bold text-emerald-900">
                <span>⚡ Tendencia Activa: {tendenciaTarde.factorPista} · {tendenciaTarde.carrilDominante} · {tendenciaTarde.estiloDominante}</span>
                <button
                  type="button"
                  onClick={limpiarTendenciaTarde}
                  className="text-emerald-700 hover:text-emerald-950 font-black text-xs"
                >
                  ✕
                </button>
              </div>
            )}
          </div>

          {/* ================================================================== */}
          {/* PANEL TÁCTICO EN VIVO: ⚡ TENDENCIA DE LA TARDE                   */}
          {/* ================================================================== */}
          {modoAnalitico === "en_vivo" && (
            <Card className="border-2 border-rose-200 bg-gradient-to-r from-rose-50/80 via-white to-amber-50/60 p-4 rounded-2xl shadow-sm space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rose-200/60 pb-2.5">
                <div className="flex items-center gap-2">
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-rose-600 text-white font-black text-sm">
                    ⚡
                  </span>
                  <div>
                    <h3 className="text-xs font-black uppercase tracking-wider text-rose-950">
                      Motor de Sesgo en Vivo: "Tendencia de la Tarde"
                    </h3>
                    <p className="text-[11px] text-rose-800">
                      Configura el comportamiento observado en las primeras carreras para propagar el bono (+2.5 a +2.8 pts Godet) a toda la jornada y al 5y6.
                    </p>
                  </div>
                </div>

                <Button
                  size="sm"
                  onClick={handleAplicarTendencia}
                  className="bg-rose-600 hover:bg-rose-500 font-black text-white text-xs shadow-sm flex items-center gap-1.5"
                >
                  <span>⚡</span>
                  <span>Aplicar Tendencia de la Tarde</span>
                </Button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                {/* Factor de Pista */}
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-slate-600 mb-1">
                    🌡️ Factor de Pista Observado
                  </label>
                  <select
                    value={formPista}
                    onChange={(e) => setFormPista(e.target.value as FactorPista)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-bold text-slate-800 focus:border-rose-500 focus:outline-none"
                  >
                    <option value="NORMAL">Normal (0.0s)</option>
                    <option value="LIGERA">Ligera / Rápida (-0.6s)</option>
                    <option value="PESADA">Pesada (+1.2s)</option>
                    <option value="FANGOSA">Fangosa (+2.0s)</option>
                  </select>
                </div>

                {/* Carril Dominante */}
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-slate-600 mb-1">
                    🛣️ Carril donde están Ganando
                  </label>
                  <select
                    value={formCarril}
                    onChange={(e) => setFormCarril(e.target.value as "RIEL" | "CENTRO" | "AFUERA")}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-bold text-slate-800 focus:border-rose-500 focus:outline-none"
                  >
                    <option value="RIEL">Riel Interno (Líneas 1 a 3)</option>
                    <option value="CENTRO">Media Cancha / Centro (Líneas 4 a 7)</option>
                    <option value="AFUERA">Parte Externa / Afuera (Líneas 8+)</option>
                  </select>
                </div>

                {/* Estilo Dominante */}
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-slate-600 mb-1">
                    🐎 Estilo Dominante en Llegadas
                  </label>
                  <select
                    value={formEstilo}
                    onChange={(e) => setFormEstilo(e.target.value as EstiloCarrera)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-bold text-slate-800 focus:border-rose-500 focus:outline-none"
                  >
                    <option value="E1">E1 · Velocistas / De Tiro a Tiro</option>
                    <option value="E2">E2 · Stalkers / Colocados</option>
                    <option value="E3">E3 · Rematadores / Atropelladores</option>
                  </select>
                </div>
              </div>
            </Card>
          )}

          {/* BUSCADOR DE JORNADA */}
          <BuscadorJornada
            fecha={fecha}
            onFecha={(f) => {
              setFecha(f || fechaJornadaCaracas());
              setCarreraActiva(null);
            }}
            hipodromo={hipodromo}
            onHipodromo={(h) => {
              setHipodromo(h);
              setCarreraActiva(null);
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

          {/* SEMÁFORO DE CARRERAS */}
          {hipodromo && carrerasDelHipodromo.length > 0 && (
            <SemaforoCarreras
              hipodromo={hipodromo}
              fecha={fecha}
              carreras={carrerasDelHipodromo.map((c) => Number(c.carrera))}
              activa={carreraActiva}
              onSeleccionar={(n) => setCarreraActiva(n)}
            />
          )}

          {/* ============================================================== */}
          {/* RESULTADO Y TABLA DE ANÁLISIS V4                               */}
          {/* ============================================================== */}
          {resultadoCarreraV4 && (
            <div className="space-y-4">
              {/* RESUMEN DE LA CARRERA Y ESCENARIO SMIC */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white p-4 shadow-sm">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-black uppercase tracking-wider text-slate-900">
                      Carrera {resultadoCarreraV4.carreraNumero} · {resultadoCarreraV4.distancia}m ({resultadoCarreraV4.hipodromo})
                    </h3>
                    {resultadoCarreraV4.esValida5y6 && (
                      <span className="rounded-full bg-amber-500 text-slate-950 font-black px-2.5 py-0.5 text-[10px] uppercase">
                        {resultadoCarreraV4.numeroValida5y6 ? `${resultadoCarreraV4.numeroValida5y6}ª Válida 5y6` : "Válida 5y6"}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-slate-500 flex items-center gap-2">
                    <span><b>Escenario SMIC:</b> {resultadoCarreraV4.escenarioDominanteSMIC.titulo} ({resultadoCarreraV4.escenarioDominanteSMIC.probabilidadPct}%)</span>
                    <span>·</span>
                    <span className="line-clamp-1">{resultadoCarreraV4.escenarioDominanteSMIC.descripcion}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleGenerarInformeIA}
                    disabled={generandoInforme}
                    className="border-indigo-300 text-indigo-700 hover:bg-indigo-50 font-bold text-xs"
                  >
                    <span>🤖</span>
                    <span>{generandoInforme ? "Redactando…" : "Informe Experto IA"}</span>
                  </Button>

                  <Button
                    size="sm"
                    onClick={() => setAbrirGodetModal(true)}
                    className="bg-slate-900 text-amber-400 font-bold text-xs hover:bg-slate-800"
                  >
                    <span>🧭</span>
                    <span>Matriz Godet / MACTOR</span>
                  </Button>
                </div>
              </div>

              {/* INFORME REDACTADO POR IA */}
              {informeCarrera && (
                <Card className="rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-50/60 via-white to-sky-50/50 p-4 shadow-sm space-y-3">
                  <div className="flex items-center justify-between border-b border-indigo-100 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">🤖</span>
                      <h4 className="text-xs font-black uppercase tracking-wider text-indigo-950">
                        {informeCarrera.titulo}
                      </h4>
                    </div>
                    <button
                      type="button"
                      onClick={() => setInformeCarrera(null)}
                      className="text-xs text-slate-400 hover:text-slate-700 font-bold"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-slate-700">
                    <div>
                      <b className="text-indigo-900 block mb-0.5">Planteamiento Táctico:</b>
                      <p className="text-[11.5px] text-slate-600 leading-relaxed">{informeCarrera.planteamientoTactico}</p>
                    </div>
                    <div>
                      <b className="text-indigo-900 block mb-0.5">Diagnóstico del Favorito:</b>
                      <p className="text-[11.5px] text-slate-600 leading-relaxed">{informeCarrera.analisisFavorito}</p>
                    </div>
                    <div>
                      <b className="text-indigo-900 block mb-0.5">Enemigo Principal:</b>
                      <p className="text-[11.5px] text-slate-600 leading-relaxed">{informeCarrera.enemigoPrincipal}</p>
                    </div>
                    <div>
                      <b className="text-emerald-800 block mb-0.5">Conclusión y Recomendación:</b>
                      <p className="text-[11.5px] text-slate-600 leading-relaxed font-semibold">{informeCarrera.conclusionRecomendacion}</p>
                    </div>
                  </div>
                </Card>
              )}

              {/* TABLA PRINCIPAL DEL RANKING CON 22 FACTORES, GUALDRAPAS Y DIVISAS */}
              <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-line bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-500">
                        <th className="py-2.5 px-3">Gualdrapa / Divisa</th>
                        <th className="py-2.5 px-3">Ejemplar & Profesional</th>
                        <th className="py-2.5 px-3 text-center">Estilo</th>
                        <th className="py-2.5 px-3 text-center">Speed Rating</th>
                        <th className="py-2.5 px-3 text-center">Peso Óptimo / Balanza</th>
                        {modoAnalitico === "en_vivo" && (
                          <th className="py-2.5 px-3 text-center">Línea Carrera</th>
                        )}
                        <th className="py-2.5 px-3 text-right">Score Godet</th>
                        <th className="py-2.5 px-3 text-right">Probabilidad SMIC</th>
                        <th className="py-2.5 px-3 text-center">Ventaja</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {resultadoCarreraV4.ranking.map((item) => {
                        const ej = item.ejemplar;
                        const num = ej.numero;
                        const carreraId = `${carreraSel?.hipodromo}_${carreraSel?.carrera}_${fecha}`;
                        const key = `${carreraId}_${num}`;
                        const pesoActual = pesosEnVivo[key] ?? "";
                        const lineaActual = lineasEnVivo[key] ?? "CENTRO";

                        return (
                          <tr
                            key={num}
                            className={`transition-colors hover:bg-slate-50/80 ${
                              item.ordenLlegadaProyectado === 1 ? "bg-amber-50/40" : ""
                            }`}
                          >
                            {/* Gualdrapa y Camiseta SVG */}
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-black text-sm text-slate-800">
                                  #{num}
                                </span>
                                <DivisaStudSvg
                                  numero={num}
                                  divisaTexto={ej.divisaTexto}
                                  studNombre={ej.stud}
                                  className="h-8 w-8"
                                />
                              </div>
                            </td>

                            {/* Nombre del Ejemplar y Profesionales */}
                            <td className="py-2.5 px-3 min-w-[200px]">
                              <div className="font-black text-sm text-slate-900 flex items-center gap-1.5">
                                <span>{ej.nombre}</span>
                                {item.esLinea5y6 && (
                                  <span className="rounded bg-amber-500 text-slate-950 font-black px-1.5 py-0.2 text-[9px] uppercase">
                                    LÍNEA
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-slate-500">
                                Jinete: <span className="font-bold text-slate-700">{ej.jinete}</span> ({ej.kilos}kg) · Entr: <span className="font-bold text-slate-700">{ej.entrenador}</span>
                              </div>
                              {/* Badges */}
                              {item.badges.length > 0 && (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {item.badges.map((b) => (
                                    <span
                                      key={b}
                                      className={`rounded px-1.5 py-0.2 text-[9px] font-bold ${
                                        b.includes("FAVORECIDO")
                                          ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                                          : b.includes("LÍNEA")
                                          ? "bg-amber-100 text-amber-900 border border-amber-300"
                                          : b.includes("Peso")
                                          ? "bg-sky-100 text-sky-800 border border-sky-300"
                                          : "bg-slate-100 text-slate-700"
                                      }`}
                                    >
                                      {b}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </td>

                            {/* Estilo E1/E2/E3 */}
                            <td className="py-2.5 px-3 text-center whitespace-nowrap">
                              <span
                                className={`rounded px-2 py-0.5 font-mono text-[10px] font-black uppercase ${
                                  ej.estilo === "E1"
                                    ? "bg-rose-100 text-rose-800"
                                    : ej.estilo === "E2"
                                    ? "bg-indigo-100 text-indigo-800"
                                    : "bg-emerald-100 text-emerald-800"
                                }`}
                              >
                                {ej.estilo} · {ej.estilo === "E1" ? "Punta" : ej.estilo === "E2" ? "Stalker" : "Remate"}
                              </span>
                            </td>

                            {/* Speed Rating TTC */}
                            <td className="py-2.5 px-3 text-center whitespace-nowrap">
                              <span className="font-mono font-bold text-xs text-slate-900">
                                {ej.speedRatingTTC}
                              </span>
                            </td>

                            {/* Peso Óptimo vs Balanza Hoy */}
                            <td className="py-2.5 px-3 text-center whitespace-nowrap">
                              <div className="text-[11px] font-bold text-slate-700">
                                Ópt: {ej.pesoOptimoKg} kg
                              </div>
                              {modoAnalitico === "en_vivo" ? (
                                <input
                                  type="number"
                                  step="1"
                                  placeholder="Hoy (kg)"
                                  value={pesoActual}
                                  onChange={(e) => {
                                    const val = e.target.value ? parseFloat(e.target.value) : null;
                                    setPesoEnVivo(carreraId, num, val);
                                  }}
                                  className="mt-0.5 w-20 rounded border border-slate-300 px-1 py-0.5 text-center font-mono text-xs font-bold text-indigo-700 focus:border-indigo-500 focus:outline-none"
                                />
                              ) : (
                                <span className="text-[10px] text-slate-400">
                                  {ej.pesoHoyKg ? `${ej.pesoHoyKg} kg` : "—"}
                                </span>
                              )}
                            </td>

                            {/* Línea de Carrera en Vivo */}
                            {modoAnalitico === "en_vivo" && (
                              <td className="py-2.5 px-3 text-center whitespace-nowrap">
                                <select
                                  value={lineaActual}
                                  onChange={(e) => setLineaEnVivo(carreraId, num, e.target.value as LineaPista)}
                                  className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[10.5px] font-bold text-slate-700 focus:border-rose-500 focus:outline-none"
                                >
                                  <option value="RIEL">Riel (1-3)</option>
                                  <option value="CENTRO">Centro (4-6)</option>
                                  <option value="AFUERA">Afuera (7+)</option>
                                  <option value="COMPROMETIDO">Tráfico</option>
                                </select>
                              </td>
                            )}

                            {/* Score Godet Total */}
                            <td className="py-2.5 px-3 text-right whitespace-nowrap font-mono font-black text-xs text-slate-800">
                              {item.scoreGodetTotal}
                            </td>

                            {/* Probabilidad SMIC */}
                            <td className="py-2.5 px-3 text-right whitespace-nowrap">
                              <span className="font-mono font-black text-sm text-indigo-900">
                                {item.probabilidadSMIC}%
                              </span>
                            </td>

                            {/* Cuerpos de Ventaja */}
                            <td className="py-2.5 px-3 text-center whitespace-nowrap">
                              {item.cuerposVentaja > 0 ? (
                                <span className="font-mono text-xs font-bold text-slate-600">
                                  +{item.cuerposVentaja} cpos
                                </span>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* MODAL DE MATRIZ GODET V3 PREVIA */}
          <ModalAnalisisActuarialGodet
            abierto={abrirGodetModal}
            onCerrar={() => setAbrirGodetModal(false)}
            hipodromo={hipodromo || undefined}
            carrera={carreraSel?.carrera}
            fecha={fecha}
            ejemplares={
              resultadoCarreraV4?.ranking.map((r) => ({
                numero: r.ejemplar.numero,
                nombre: r.ejemplar.nombre,
                stud: r.ejemplar.stud,
                speedRatingTTC: r.ejemplar.speedRatingTTC,
                pesoOptimoGanadorKg: r.ejemplar.pesoOptimoKg,
                pesoFisicoHoyKg: r.ejemplar.pesoHoyKg ?? undefined,
              })) ?? []
            }
          />

          {/* MODAL DEL CUADRO MAESTRO 5Y6 */}
          <ModalCuadroMaestro5y6
            abierto={abrirCuadro5y6Modal}
            onCerrar={() => setAbrirCuadro5y6Modal(false)}
            fecha={fecha}
            hipodromo={hipodromo || "LA RINCONADA"}
            carrerasValidas={carrerasValidas5y6}
          />
        </>
      )}

      <ToastHost />
    </div>
  );
}
