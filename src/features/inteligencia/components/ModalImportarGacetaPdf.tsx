"use client";

import { useState, useEffect, useRef } from "react";
import { DateInput } from "@/shared/components/ui/DateInput";
import { Button } from "@/shared/components/ui/Button";
import { CLAVE_GEMINI_KEY, PROMPT_EXTRACTOR_AUDITOR_HIPICO } from "@/features/gaceta/lib/ia";
import { PROMPT_RINCONADA } from "@/features/gaceta/lib/prompts/prompt-rinconada";
import { PROMPT_AMERICANAS } from "@/features/gaceta/lib/prompts/prompt-americanas";
import { ingestarGacetaProfunda, type PayloadGacetaProfunda } from "@/features/gaceta/lib/ingestar-profunda";
import {
  importarLoteGacetasPdf,
  convertirCarrerasExtraidasACatalogo,
  analizarCarrerasGacetaV4,
  type ProgresoExtraccion,
  type ResumenAnalisisGaceta,
} from "@/features/inteligencia/lib/importador-analizador-gaceta";
import type { CarreraCatalogo, EjemplarCarreraCentral } from "@/features/carreras/lib/maestro-nucleo";
import type { CarreraExtraida } from "@/features/gaceta/lib/ia";
import { COLORES_GUALDRAPA } from "@/features/inteligencia/lib/analista-venezuela-v4";
import { sincronizarCarrerasAlCentral } from "@/features/carreras/lib/sincronizar";
import { emitirToast } from "@/shared/lib/mensajeria";

type Props = {
  abierto: boolean;
  onCerrar: () => void;
  fechaDefault: string;
  hipodromoDefault: string;
  onCarrerasImportadas: (carreras: CarreraCatalogo[], fecha: string, hipodromo: string) => void;
  onAbrirCuadro5y6?: () => void;
};

export function ModalImportarGacetaPdf({
  abierto,
  onCerrar,
  fechaDefault,
  hipodromoDefault,
  onCarrerasImportadas,
  onAbrirCuadro5y6,
}: Props) {
  // Configuración
  const [subPestana, setSubPestana] = useState<"rinconada" | "americanas">(
    hipodromoDefault?.toUpperCase().includes("RINCONADA") || hipodromoDefault?.toUpperCase().includes("VALENCIA")
      ? "rinconada"
      : "americanas"
  );
  const [fecha, setFecha] = useState(fechaDefault);
  const [usarFechaOverride, setUsarFechaOverride] = useState(false);
  const [fechaOverride, setFechaOverride] = useState(fechaDefault);
  const [hipodromo, setHipodromo] = useState(hipodromoDefault || "CHURCHILL DOWNS");
  const [claveGemini, setClaveGemini] = useState("");
  const [mostrarClave, setMostrarClave] = useState(false);
  const [mostrarPromptAuditor, setMostrarPromptAuditor] = useState(false);
  const [archivos, setArchivos] = useState<File[]>([]);

  // Estados de proceso
  const [fase, setFase] = useState<"config" | "procesando" | "edicion" | "analisis">("config");
  const [progreso, setProgreso] = useState<ProgresoExtraccion>({
    fase: "leyendo",
    mensaje: "",
  });
  const [error, setError] = useState<string>("");
  const [aviso, setAviso] = useState<string>("");

  // Resultados y Edición Previa
  const [carrerasExtraidas, setCarrerasExtraidas] = useState<CarreraExtraida[]>([]);
  const [carrerasCatalogo, setCarrerasCatalogo] = useState<CarreraCatalogo[]>([]);
  const [analisisV4, setAnalisisV4] = useState<ResumenAnalisisGaceta | null>(null);
  const [carreraSeleccionada, setCarreraSeleccionada] = useState<number>(1);
  const [guardandoEnBd, setGuardandoEnBd] = useState(false);

  // Estados de edición puntual de ejemplar/carrera
  const [nuevoNombreCaballo, setNuevoNombreCaballo] = useState("");
  const [nuevoNumCaballo, setNuevoNumCaballo] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Cargar clave guardada en localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      const k = localStorage.getItem(CLAVE_GEMINI_KEY) || "";
      setClaveGemini(k);
    }
  }, [abierto]);

  useEffect(() => {
    setFecha(fechaDefault);
    setFechaOverride(fechaDefault);
    if (hipodromoDefault) setHipodromo(hipodromoDefault);
  }, [fechaDefault, hipodromoDefault]);

  const handleGuardarClave = () => {
    if (!claveGemini.trim()) return;
    try {
      localStorage.setItem(CLAVE_GEMINI_KEY, claveGemini.trim());
      emitirToast("Clave de Gemini guardada correctamente.", "success");
    } catch {
      emitirToast("No se pudo guardar la clave en almacenamiento local.", "warning");
    }
  };

  const handleProbarClave = async () => {
    if (!claveGemini.trim()) {
      emitirToast("Introduce primero la clave API.", "warning");
      return;
    }
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(
          claveGemini.trim()
        )}`
      );
      if (r.ok) {
        emitirToast("Conexión exitosa con la API de Gemini.", "success");
        handleGuardarClave();
      } else {
        emitirToast(`Error al validar clave: HTTP ${r.status}`, "error");
      }
    } catch {
      emitirToast("Error de red al intentar conectar con Gemini.", "error");
    }
  };

  const agregarArchivos = (nuevos: FileList | File[]) => {
    const list = Array.from(nuevos).filter(
      (f) => /\.pdf$/i.test(f.name) || f.type.startsWith("image/")
    );
    if (!list.length) {
      emitirToast("Solo se admiten documentos PDF o imágenes de gaceta.", "warning");
      return;
    }
    setArchivos((prev) => {
      const nombres = new Set(prev.map((a) => a.name));
      const agregables = list.filter((a) => !nombres.has(a.name));
      return [...prev, ...agregables];
    });
    setError("");
  };

  const removerArchivo = (idx: number) => {
    setArchivos((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      agregarArchivos(e.dataTransfer.files);
    }
  };

  const handleEjecutarExtraccionLote = async () => {
    if (!archivos.length) {
      setError("Por favor selecciona al menos un archivo PDF o imagen de gaceta.");
      return;
    }

    setFase("procesando");
    setError("");
    setAviso("");
    setProgreso({
      fase: "leyendo",
      mensaje: `Iniciando cola de procesamiento no bloqueante (${archivos.length} archivo(s))...`,
    });

    try {
      const fechaEfectiva = usarFechaOverride && fechaOverride ? fechaOverride : undefined;
      const res = await importarLoteGacetasPdf({
        files: archivos,
        claveGemini: claveGemini.trim(),
        fechaOverride: fechaEfectiva,
        tipoExtractor: subPestana,
        onProgresoLote: (p) => {
          setProgreso({
            fase: "extrayendo",
            mensaje: `[Archivo ${p.archivoActual}/${p.totalArchivos}] ${p.nombreArchivo}: ${p.mensaje}`,
            paginaActual: p.archivoActual,
            totalPaginas: p.totalArchivos,
          });
        },
      });

      if (!res.todasLasCarreras.length) {
        throw new Error(
          res.fallidas.map((f) => `${f.nombreArchivo}: ${f.error}`).join(" | ") ||
            "No se pudieron extraer carreras válidas de los documentos."
        );
      }

      setCarrerasExtraidas(res.todasLasCarreras);
      if (res.fallidas.length > 0) {
        setAviso(
          `Se procesaron ${res.exitosas.length} archivo(s) correctamente, pero ${res.fallidas.length} fallaron: ${res.fallidas
            .map((f) => f.nombreArchivo)
            .join(", ")}`
        );
      }

      // Convertir a catálogo
      const fechaBase = fechaEfectiva || fecha;
      const catalogo = convertirCarrerasExtraidasACatalogo(res.todasLasCarreras, fechaBase, hipodromo);
      setCarrerasCatalogo(catalogo);

      if (catalogo.length > 0) {
        setCarreraSeleccionada(Number(catalogo[0].carrera) || 1);
      }

      // Ir a la fase de Previsualización y Edición Manual antes de guardar
      setFase("edicion");
      emitirToast(
        `Se extrajeron ${catalogo.length} carrera(s) listas para previsualización y edición manual.`,
        "success"
      );
    } catch (err) {
      setFase("config");
      setError(err instanceof Error ? err.message : String(err));
      emitirToast("Falló la extracción del lote de gacetas.", "error");
    }
  };

  // Modificación puntual de carrera
  const modificarCarreraActual = (patch: Partial<CarreraCatalogo>) => {
    setCarrerasCatalogo((prev) =>
      prev.map((c) => (Number(c.carrera) === carreraSeleccionada ? { ...c, ...patch } : c))
    );
  };

  // Modificar un ejemplar específico de la carrera actual
  const modificarEjemplarActual = (numEjemplar: string, patch: Partial<EjemplarCarreraCentral>) => {
    setCarrerasCatalogo((prev) =>
      prev.map((c) => {
        if (Number(c.carrera) !== carreraSeleccionada) return c;
        const ejs = (c.caballos || []).map((cb) =>
          cb.numero === numEjemplar ? { ...cb, ...patch } : cb
        );
        return { ...c, caballos: ejs };
      })
    );
  };

  // Agregar ejemplar a la carrera actual
  const agregarEjemplarActual = () => {
    if (!nuevoNombreCaballo.trim()) return;
    const carr = carrerasCatalogo.find((c) => Number(c.carrera) === carreraSeleccionada);
    if (!carr) return;

    const numSugerido =
      nuevoNumCaballo.trim() ||
      String(
        (carr.caballos || []).length
          ? Math.max(...(carr.caballos || []).map((cb) => parseInt(cb.numero, 10) || 0)) + 1
          : 1
      );

    const nuevoCab: EjemplarCarreraCentral = {
      numero: numSugerido,
      nombre: nuevoNombreCaballo.trim().toUpperCase(),
      nacionalidad: "USA",
      pp: parseInt(numSugerido, 10) || null,
      puestoPista: parseInt(numSugerido, 10) || null,
      retirado: false,
    };

    setCarrerasCatalogo((prev) =>
      prev.map((c) => {
        if (Number(c.carrera) !== carreraSeleccionada) return c;
        const ejs = [...(c.caballos || []), nuevoCab];
        return { ...c, caballos: ejs };
      })
    );

    setNuevoNombreCaballo("");
    setNuevoNumCaballo("");
    emitirToast(`Ejemplar ${nuevoCab.numero} ${nuevoCab.nombre} agregado a C${carreraSeleccionada}.`, "success");
  };

  // Alternar retirado de ejemplar
  const alternarRetiradoEjemplar = (numEjemplar: string) => {
    setCarrerasCatalogo((prev) =>
      prev.map((c) => {
        if (Number(c.carrera) !== carreraSeleccionada) return c;
        const ejs = (c.caballos || []).map((cb) =>
          cb.numero === numEjemplar ? { ...cb, retirado: !cb.retirado } : cb
        );
        const rets = ejs.filter((cb) => cb.retirado).map((cb) => cb.numero);
        return { ...c, caballos: ejs, retirados: rets };
      })
    );
  };

  // Eliminar ejemplar de la carrera
  const eliminarEjemplar = (numEjemplar: string) => {
    setCarrerasCatalogo((prev) =>
      prev.map((c) => {
        if (Number(c.carrera) !== carreraSeleccionada) return c;
        const ejs = (c.caballos || []).filter((cb) => cb.numero !== numEjemplar);
        const rets = ejs.filter((cb) => cb.retirado).map((cb) => cb.numero);
        return { ...c, caballos: ejs, retirados: rets };
      })
    );
  };

  // Guardado Masivo Ultra-Rápido en 1 Sola Transacción RPC
  const handleGuardarLoteEnBD = async () => {
    if (!carrerasCatalogo.length) return;
    setGuardandoEnBd(true);
    try {
      const loteParaSinc = carrerasCatalogo.map((c) => ({
        hipodromo: c.hipodromo,
        carrera: c.carrera,
        fecha: c.fecha,
        hora: c.hora || null,
        distancia: c.distancia,
        superficie: c.superficie,
        premio: c.premio,
        caballos: (c.caballos || []).map((cab) => ({
          numero: cab.numero,
          nombre: cab.nombre || "",
          jockey: cab.jockey || "",
          entrenador: cab.entrenador || "",
          peso: cab.peso || "",
          pp: cab.pp || null,
          ml: cab.ml || "",
          retirado: Boolean(cab.retirado),
          medicamento: cab.medicamento || "",
          implementos: cab.implementos || "",
        })),
      }));

      // Ingesta profunda a base de datos interna mediante RPC ingestar_gaceta_profunda
      try {
        const payloadProfundo: PayloadGacetaProfunda = {
          carreras: carrerasCatalogo.map((c) => {
            const orig = carrerasExtraidas.find((ce) => Number(ce.carrera) === Number(c.carrera));
            return {
              hipodromo: c.hipodromo || hipodromo,
              codigo_hipodromo: orig?.superficie || null,
              fecha: c.fecha || fecha,
              hora: c.hora || null,
              numero_carrera: Number(c.carrera),
              codigo_anual: orig?.codigoAnual || null,
              valida_5y6: orig?.valida5y6 || null,
              distancia_m: parseInt(String(c.distancia || "1200"), 10) || 1200,
              superficie: c.superficie || "ARENA",
              raza: orig?.raza || (subPestana === "americanas" ? "THOROUGHBRED" : null),
              bolsa_usd: Number(c.premio) || null,
              condicion_lote: orig?.condicionLote || null,
              condicion_lote_completa: null,
              record_pista: null,
              favoritos_gaceta: orig?.favoritosGaceta || [],
              orden_rating_gaceta: [],
              ejemplares: (c.caballos || []).map((cab) => {
                const origEj = orig?.ejemplares?.find((oe) => String(oe.numero) === String(cab.numero));
                return {
                  numero_programa: String(cab.numero),
                  puesto_partida: cab.pp ? Number(cab.pp) : null,
                  nombre: String(cab.nombre || "").trim().toUpperCase(),
                  pais_origen: cab.nacionalidad || (subPestana === "rinconada" ? "VEN" : "USA"),
                  fecha_nacimiento: null,
                  anio_nacimiento: null,
                  stud: cab.stud || null,
                  sexo: null,
                  pelaje: null,
                  padre: null,
                  madre: null,
                  abuelo_materno: null,
                  haras_criador: null,
                  dias_sin_correr: null,
                  ganancias_usd: null,
                  jinete: cab.jockey || null,
                  entrenador: cab.entrenador || null,
                  peso_kg: cab.peso ? Number(cab.peso) : null,
                  implementos: cab.implementos || null,
                  campana_resumen: null,
                  comentario: null,
                  morning_line: cab.ml || null,
                  es_elegible: Boolean(origEj?.esElegible),
                  retirado: Boolean(cab.retirado),
                  carreras_previas: [],
                  trabajos: [],
                };
              }),
            };
          }),
        };
        await ingestarGacetaProfunda(payloadProfundo);
      } catch (errProf) {
        console.warn("Aviso en ingestarGacetaProfunda:", errProf);
      }

      const res = await sincronizarCarrerasAlCentral(loteParaSinc, "gaceta-lote-pdf", {
        forzarReemplazo: true,
      });

      if (res.ok) {
        emitirToast(
          `¡Éxito! ${carrerasCatalogo.length} carrera(s) guardadas en BD en 1 sola transacción.`,
          "success"
        );
        onCarrerasImportadas(carrerasCatalogo, fecha, hipodromo);
        onCerrar();
      } else {
        emitirToast(res.error || "Aviso durante el guardado de carreras en BD.", "warning");
      }
    } catch (e) {
      emitirToast(`Error al persistir en BD: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setGuardandoEnBd(false);
    }
  };

  // Ejecutar análisis actuarial v4 opcional
  const handleEjecutarAnalisisV4 = () => {
    if (!carrerasCatalogo.length) return;
    const resAnalisis = analizarCarrerasGacetaV4({
      carreras: carrerasCatalogo,
      fecha,
    });
    setAnalisisV4(resAnalisis);
    setFase("analisis");
    emitirToast("Análisis prospectivo v4 computado.", "success");
  };

  const carreraActual = carrerasCatalogo.find((c) => Number(c.carrera) === carreraSeleccionada);

  if (!abierto) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-5xl max-h-[94vh] overflow-y-auto p-6 bg-slate-900 border border-slate-700 text-white rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-amber-500 text-slate-950 font-black text-base shadow-sm">
              📑
            </span>
            <div>
              <h2 className="text-base font-black uppercase tracking-wider text-amber-400">
                Importador de Gacetas PDF Ultra-Rápido (Multi-Archivo / Lote)
              </h2>
              <p className="text-[11px] text-slate-400 font-medium">
                Extracción con Motor Auditor y Extractor Quirúrgico (USA + Venezuela), soporte multi-hipódromo, previsualización editable y guardado masivo en 1 transacción.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMostrarPromptAuditor((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-950/80 border border-indigo-500/40 text-indigo-300 text-xs font-bold hover:bg-indigo-900/90 transition-all shadow-sm"
              title="Ver o copiar el Prompt Oficial del Motor Auditor y Extractor Quirúrgico IA"
            >
              <span>🤖</span>
              <span>{mostrarPromptAuditor ? "Ocultar Prompt Auditor" : "Ver Prompt Auditor IA"}</span>
            </button>
            <button
              onClick={onCerrar}
              className="text-slate-400 hover:text-white text-lg font-bold p-1 rounded-lg hover:bg-slate-800"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Sub-Pestañas Independientes: Extractor La Rinconada vs Extractor Americanas */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-3 pt-3">
          <button
            type="button"
            onClick={() => {
              setSubPestana("rinconada");
              if (hipodromo !== "LA RINCONADA" && hipodromo !== "VALENCIA") {
                setHipodromo("LA RINCONADA");
              }
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-sm ${
              subPestana === "rinconada"
                ? "bg-amber-500 text-slate-950 ring-2 ring-amber-400/50 shadow-amber-500/20"
                : "bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700"
            }`}
          >
            <span>🇻🇪</span>
            <span>Extractor La Rinconada</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setSubPestana("americanas");
              if (hipodromo === "LA RINCONADA" || hipodromo === "VALENCIA") {
                setHipodromo("GULFSTREAM PARK");
              }
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-sm ${
              subPestana === "americanas"
                ? "bg-indigo-600 text-white ring-2 ring-indigo-400/50 shadow-indigo-500/20"
                : "bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700"
            }`}
          >
            <span>🇺🇸</span>
            <span>Extractor Americanas</span>
          </button>

          <div className="ml-auto text-[11px] text-slate-400 font-medium">
            {subPestana === "rinconada" ? (
              <span className="text-amber-400">Modalidad: Gaceta Hípica (Venezuela · N° vs PP 1600m)</span>
            ) : (
              <span className="text-indigo-400">Modalidad: Retrospectos USA (Filtro marca de agua + Espacial Y,X)</span>
            )}
          </div>
        </div>

        {/* Modal / Card Desplegable del Prompt Auditor */}
        {mostrarPromptAuditor && (
          <div className="my-3 p-4 rounded-xl bg-slate-950 border border-indigo-500/40 text-xs space-y-2.5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-indigo-900/60 pb-2">
              <div className="flex items-center gap-2">
                <span className="text-base">{subPestana === "rinconada" ? "🇻🇪" : "🇺🇸"}</span>
                <span className="font-black text-indigo-300 uppercase tracking-wide">
                  {subPestana === "rinconada"
                    ? "Prompt Profundo Oficial: La Rinconada (Venezuela)"
                    : "Prompt Profundo Oficial: Retrospectos Americanas (EE. UU.)"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (typeof navigator !== "undefined" && navigator.clipboard) {
                    const promptACopiar = subPestana === "rinconada" ? PROMPT_RINCONADA : PROMPT_AMERICANAS;
                    void navigator.clipboard.writeText(promptACopiar);
                    emitirToast("Prompt copiado al portapapeles.", "success");
                  }
                }}
                className="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[11px] transition-all flex items-center gap-1 shadow-sm"
              >
                <span>📋</span>
                <span>Copiar Prompt</span>
              </button>
            </div>
            <p className="text-[11px] text-slate-400">
              {subPestana === "rinconada"
                ? "Prompt activo para Gaceta Hípica de Venezuela (N° programa oficial en 1600m, traqueos, pedigrí e historial profundo):"
                : "Prompt activo para retrospectos de Estados Unidos (ordenamiento espacial Y,X, eliminación de marca de agua 'RETRO HIPICO', M/L y briseos):"}
            </p>
            <pre className="max-h-60 overflow-y-auto p-3 bg-slate-900/95 rounded-lg border border-slate-800 text-[11px] text-slate-300 whitespace-pre-wrap font-mono select-all">
              {subPestana === "rinconada" ? PROMPT_RINCONADA : PROMPT_AMERICANAS}
            </pre>
          </div>
        )}

        {/* ============================================================== */}
        {/* FASE 1: CONFIGURACIÓN Y SUBIDA MULTI-ARCHIVO                   */}
        {/* ============================================================== */}
        {fase === "config" && (
          <div className="space-y-5 pt-3">
            {error && (
              <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs font-semibold">
                ⚠️ {error}
              </div>
            )}

            {/* Zona de Drop Multi-Archivo */}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-amber-500/40 hover:border-amber-400 bg-slate-800/60 hover:bg-slate-800/90 rounded-2xl p-8 text-center cursor-pointer transition-all space-y-2"
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,image/*"
                onChange={(e) => e.target.files && agregarArchivos(e.target.files)}
                className="hidden"
              />
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-amber-500/10 text-3xl text-amber-400 border border-amber-500/20">
                📥
              </div>
              <div>
                <p className="text-sm font-black text-amber-300 uppercase tracking-wide">
                  {archivos.length > 0
                    ? `${archivos.length} archivo(s) PDF seleccionados en lote`
                    : "Arrastra aquí uno o múltiples PDFs de Gacetas (Multi-Hipódromo)"}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  Haz clic para explorar o arrastra múltiples gacetas a la vez (procesamiento con concurrencia controlada sin congelar la pantalla).
                </p>
              </div>
            </div>

            {/* Lista de archivos seleccionados */}
            {archivos.length > 0 && (
              <div className="bg-slate-800/40 p-3 rounded-xl border border-slate-700/60 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-slate-300">
                  <span>Archivos en Cola ({archivos.length}):</span>
                  <button
                    type="button"
                    onClick={() => setArchivos([])}
                    className="text-rose-400 hover:underline text-[11px]"
                  >
                    Limpiar lista
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-36 overflow-y-auto pr-1">
                  {archivos.map((a, idx) => (
                    <div
                      key={`${a.name}-${idx}`}
                      className="flex items-center justify-between gap-1.5 bg-slate-900 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs"
                    >
                      <span className="truncate text-amber-300 font-semibold" title={a.name}>
                        📄 {a.name}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removerArchivo(idx);
                        }}
                        className="text-slate-500 hover:text-rose-400 font-bold px-1"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Parámetros de Extracción */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-slate-800/40 p-4 rounded-xl border border-slate-700/60">
              <div>
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1">
                  Hipódromo Sugerido (si no viene en PDF)
                </label>
                <select
                  value={hipodromo}
                  onChange={(e) => setHipodromo(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-bold"
                >
                  <optgroup label="🇺🇸 Estados Unidos">
                    <option value="CHURCHILL DOWNS">Churchill Downs (CD)</option>
                    <option value="CHARLES TOWN">Charles Town (CT)</option>
                    <option value="DELTA DOWNS">Delta Downs (DED)</option>
                    <option value="EVANGELINE DOWNS">Evangeline Downs (EVD)</option>
                    <option value="FINGER LAKES">Finger Lakes (FL)</option>
                    <option value="HORSESHOE INDIANAPOLIS">Horseshoe Indianapolis (IND)</option>
                    <option value="MOUNTAINEER">Mountaineer (MNR)</option>
                    <option value="MAHONING VALLEY">Mahoning Valley (MVR)</option>
                    <option value="PARX RACING">Parx Racing (PRX)</option>
                    <option value="GULFSTREAM PARK">Gulfstream Park (GP)</option>
                    <option value="TAMPA BAY DOWNS">Tampa Bay Downs (TAM)</option>
                    <option value="AQUEDUCT">Aqueduct (AQU)</option>
                    <option value="BELMONT PARK">Belmont Park (BEL)</option>
                    <option value="SARATOGA">Saratoga (SAR)</option>
                    <option value="KEENELAND">Keeneland (KEE)</option>
                    <option value="DEL MAR">Del Mar (DMR)</option>
                    <option value="SANTA ANITA">Santa Anita (SA)</option>
                  </optgroup>
                  <optgroup label="🇻🇪 Venezuela">
                    <option value="LA RINCONADA">La Rinconada</option>
                    <option value="VALENCIA">Valencia</option>
                  </optgroup>
                </select>
              </div>

              <div>
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1">
                  Fecha por Defecto
                </label>
                <DateInput
                  value={fecha}
                  onFechaChange={(val) => setFecha(val)}
                  className="w-full bg-slate-900 border-slate-700 text-xs text-white font-bold py-1.5"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] font-black uppercase tracking-wider text-amber-300">
                    Importar para cualquier fecha
                  </label>
                  <input
                    type="checkbox"
                    checked={usarFechaOverride}
                    onChange={(e) => setUsarFechaOverride(e.target.checked)}
                    className="h-3.5 w-3.5 accent-amber-500 rounded cursor-pointer"
                  />
                </div>
                <input
                  type="date"
                  disabled={!usarFechaOverride}
                  value={fechaOverride}
                  onChange={(e) => setFechaOverride(e.target.value)}
                  className={`w-full bg-slate-900 border rounded-lg px-2.5 py-1.5 text-xs font-bold text-white ${
                    usarFechaOverride ? "border-amber-500" : "border-slate-700 opacity-50"
                  }`}
                  title="Sobrescribir la fecha para todas las carreras del lote"
                />
              </div>
            </div>

            {/* Clave Gemini (Opcional para Fallback IA) */}
            <div className="bg-slate-800/40 p-4 rounded-xl border border-slate-700/60 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                    Clave Gemini (Solo requerida para fallback si el PDF no tiene texto nativo)
                  </label>
                </div>
                <button
                  type="button"
                  onClick={() => setMostrarClave(!mostrarClave)}
                  className="text-[10px] font-bold text-amber-400 hover:underline"
                >
                  {mostrarClave ? "Ocultar" : "Mostrar"}
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  type={mostrarClave ? "text" : "password"}
                  placeholder="AIzaSy... (Opcional para motor nativo)"
                  value={claveGemini}
                  onChange={(e) => setClaveGemini(e.target.value)}
                  className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white font-mono placeholder:text-slate-600"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleProbarClave}
                  className="text-xs border-slate-700 hover:bg-slate-800 text-slate-300"
                >
                  Probar
                </Button>
                <Button
                  size="sm"
                  onClick={handleGuardarClave}
                  className="text-xs bg-slate-800 hover:bg-slate-700 text-amber-400 border border-slate-700"
                >
                  Guardar
                </Button>
              </div>
            </div>

            {/* Botones de acción */}
            <div className="flex justify-end gap-3 pt-2">
              <Button
                variant="outline"
                onClick={onCerrar}
                className="text-xs border-slate-700 text-slate-300 hover:bg-slate-800"
              >
                Cancelar
              </Button>
              <Button
                onClick={handleEjecutarExtraccionLote}
                disabled={!archivos.length}
                className="bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-slate-950 font-black text-xs shadow-md px-6 py-2"
              >
                🚀 Iniciar Extracción Rápida ({archivos.length} PDFs)
              </Button>
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* FASE 2: PROCESAMIENTO NO BLOQUEANTE                           */}
        {/* ============================================================== */}
        {fase === "procesando" && (
          <div className="py-14 text-center space-y-6">
            <div className="mx-auto relative w-20 h-20">
              <div className="absolute inset-0 rounded-full border-4 border-amber-500/20 border-t-amber-500 animate-spin" />
              <div className="absolute inset-2 rounded-full border-4 border-indigo-500/20 border-b-indigo-400 animate-spin-reverse" />
              <div className="grid place-items-center h-full text-2xl">⚡</div>
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-black uppercase tracking-wider text-amber-400">
                Extrayendo Gacetas de Forma No Bloqueante
              </h3>
              <p className="text-xs text-slate-400 max-w-lg mx-auto">
                {progreso.mensaje || "Procesando páginas con el motor determinístico..."}
              </p>
            </div>

            {progreso.totalPaginas && progreso.totalPaginas > 0 && (
              <div className="max-w-xs mx-auto">
                <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-amber-500 to-yellow-400 transition-all duration-300"
                    style={{
                      width: `${Math.round(
                        ((progreso.paginaActual || 1) / progreso.totalPaginas) * 100
                      )}%`,
                    }}
                  />
                </div>
                <p className="text-[10px] text-slate-500 mt-1 font-mono">
                  Elemento {progreso.paginaActual || 1} de {progreso.totalPaginas}
                </p>
              </div>
            )}
          </div>
        )}

        {/* ============================================================== */}
        {/* FASE 3: PREVISUALIZACIÓN Y EDICIÓN MANUAL DE CARRERAS         */}
        {/* ============================================================== */}
        {fase === "edicion" && (
          <div className="space-y-4 pt-2">
            {aviso && (
              <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-semibold">
                ℹ️ {aviso}
              </div>
            )}

            {/* Selector horizontal de carreras extraídas */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-slate-800">
              {carrerasCatalogo.map((c) => {
                const esActiva = Number(c.carrera) === carreraSeleccionada;
                const totEj = c.caballos?.length ?? 0;
                return (
                  <button
                    key={`${c.hipodromo}-${c.carrera}`}
                    type="button"
                    onClick={() => setCarreraSeleccionada(Number(c.carrera))}
                    className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-black uppercase transition-all ${
                      esActiva
                        ? "bg-amber-500 text-slate-950 shadow"
                        : "bg-slate-800/80 text-slate-300 hover:bg-slate-800 border border-slate-700/60"
                    }`}
                  >
                    <span>C{c.carrera}</span>
                    <span className="text-[9px] opacity-75 ml-1">({c.hipodromo.slice(0, 4)})</span>
                    <span className="text-[9px] opacity-75 ml-1">[{totEj}]</span>
                  </button>
                );
              })}
            </div>

            {/* Editor de la Carrera Seleccionada */}
            {carreraActual && (
              <div className="space-y-3 bg-slate-800/40 p-4 rounded-xl border border-slate-700/60">
                <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
                  <div>
                    <label className="text-[9px] font-black uppercase text-slate-400 block mb-0.5">
                      Nº Carrera
                    </label>
                    <input
                      type="number"
                      value={carreraActual.carrera}
                      onChange={(e) => {
                        const nuevoNum = parseInt(e.target.value, 10) || 1;
                        modificarCarreraActual({ carrera: nuevoNum });
                        setCarreraSeleccionada(nuevoNum);
                      }}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white font-bold"
                    />
                  </div>

                  <div>
                    <label className="text-[9px] font-black uppercase text-slate-400 block mb-0.5">
                      Hipódromo
                    </label>
                    <input
                      type="text"
                      value={carreraActual.hipodromo}
                      onChange={(e) => modificarCarreraActual({ hipodromo: e.target.value.toUpperCase() })}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white font-bold"
                    />
                  </div>

                  <div>
                    <label className="text-[9px] font-black uppercase text-slate-400 block mb-0.5">
                      Fecha
                    </label>
                    <input
                      type="date"
                      value={carreraActual.fecha}
                      onChange={(e) => modificarCarreraActual({ fecha: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white font-bold"
                    />
                  </div>

                  <div>
                    <label className="text-[9px] font-black uppercase text-slate-400 block mb-0.5">
                      Hora Partida
                    </label>
                    <input
                      type="text"
                      placeholder="Ej. 1:00 PM"
                      value={carreraActual.hora || ""}
                      onChange={(e) => modificarCarreraActual({ hora: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white font-bold"
                    />
                  </div>

                  <div>
                    <label className="text-[9px] font-black uppercase text-slate-400 block mb-0.5">
                      Distancia (m)
                    </label>
                    <input
                      type="number"
                      value={carreraActual.distancia ?? ""}
                      onChange={(e) => modificarCarreraActual({ distancia: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white font-bold"
                    />
                  </div>

                  <div>
                    <label className="text-[9px] font-black uppercase text-slate-400 block mb-0.5">
                      Superficie
                    </label>
                    <select
                      value={carreraActual.superficie ?? "ARENA"}
                      onChange={(e) => modificarCarreraActual({ superficie: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white font-bold"
                    >
                      <option value="ARENA">Arena</option>
                      <option value="GRAMA">Grama</option>
                      <option value="CESPED">Césped</option>
                      <option value="TAPETA">Tapeta</option>
                    </select>
                  </div>
                </div>

                {/* Tabla de Ejemplares de la Carrera Actual */}
                <div className="border border-slate-700/80 rounded-xl overflow-hidden mt-3">
                  <div className="flex items-center justify-between bg-slate-900/90 px-3 py-2 border-b border-slate-700 text-xs font-bold text-amber-300">
                    <span>Participantes ({carreraActual.caballos?.length ?? 0}):</span>
                    <span className="text-[10px] text-slate-400">
                      Haz clic en ⛔ para retirar / habilitar
                    </span>
                  </div>
                  <div className="max-h-56 overflow-y-auto">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-slate-950 text-[10px] text-slate-400 uppercase">
                        <tr>
                          <th className="py-1.5 px-3">Nº / Gualdrapa</th>
                          <th className="py-1.5 px-3">Ejemplar</th>
                          <th className="py-1.5 px-3">Jinete</th>
                          <th className="py-1.5 px-3">Entrenador</th>
                          <th className="py-1.5 px-3">Peso</th>
                          <th className="py-1.5 px-3">M/L</th>
                          <th className="py-1.5 px-3 text-right">Acciones</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {(carreraActual.caballos || []).map((ej) => {
                          const num = parseInt(ej.numero, 10);
                          const gualdrapa = COLORES_GUALDRAPA[num] || {
                            bg: "#1e293b",
                            text: "#ffffff",
                          };
                          return (
                            <tr
                              key={`${ej.numero}-${ej.nombre}`}
                              className={ej.retirado ? "bg-rose-950/20 opacity-50" : "hover:bg-slate-800/40"}
                            >
                              <td className="py-2 px-2 align-middle w-14">
                                <span
                                  className="inline-grid h-6 w-6 place-items-center rounded font-black text-[11px]"
                                  style={{ backgroundColor: gualdrapa.bg, color: gualdrapa.text }}
                                >
                                  {ej.numero}
                                </span>
                              </td>
                              <td className="py-2 px-2 align-middle">
                                <input
                                  type="text"
                                  value={ej.nombre || ""}
                                  onChange={(e) =>
                                    modificarEjemplarActual(ej.numero, {
                                      nombre: e.target.value.toUpperCase(),
                                    })
                                  }
                                  placeholder="Nombre del Caballo..."
                                  className={`w-full bg-slate-900 border rounded px-2 py-1 text-xs font-bold text-white ${
                                    ej.retirado ? "line-through text-slate-400 border-rose-900" : "border-slate-700 focus:border-amber-400"
                                  }`}
                                />
                              </td>
                              <td className="py-2 px-2 align-middle">
                                <input
                                  type="text"
                                  value={ej.jockey || ""}
                                  onChange={(e) =>
                                    modificarEjemplarActual(ej.numero, {
                                      jockey: e.target.value,
                                    })
                                  }
                                  placeholder="Jinete..."
                                  className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:border-amber-400"
                                />
                              </td>
                              <td className="py-2 px-2 align-middle">
                                <input
                                  type="text"
                                  value={ej.entrenador || ""}
                                  onChange={(e) =>
                                    modificarEjemplarActual(ej.numero, {
                                      entrenador: e.target.value,
                                    })
                                  }
                                  placeholder="Entrenador..."
                                  className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 focus:border-amber-400"
                                />
                              </td>
                              <td className="py-2 px-1 align-middle w-16">
                                <input
                                  type="text"
                                  value={ej.peso != null ? String(ej.peso) : ""}
                                  onChange={(e) =>
                                    modificarEjemplarActual(ej.numero, {
                                      peso: e.target.value,
                                    })
                                  }
                                  placeholder="Peso"
                                  className="w-full bg-slate-900 border border-slate-700 rounded px-1 py-1 text-xs text-center font-mono text-slate-200 focus:border-amber-400"
                                />
                              </td>
                              <td className="py-2 px-1 align-middle w-16">
                                <input
                                  type="text"
                                  value={ej.ml || ""}
                                  onChange={(e) =>
                                    modificarEjemplarActual(ej.numero, {
                                      ml: e.target.value,
                                    })
                                  }
                                  placeholder="M/L"
                                  className="w-full bg-slate-900 border border-slate-700 rounded px-1 py-1 text-xs text-center font-mono text-amber-300 font-bold focus:border-amber-400"
                                />
                              </td>
                              <td className="py-2 px-2 align-middle text-right space-x-1.5 whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={() => alternarRetiradoEjemplar(ej.numero)}
                                  className={`text-[10px] font-bold px-2 py-1 rounded transition-colors ${
                                    ej.retirado
                                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30"
                                      : "bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30"
                                  }`}
                                  title={ej.retirado ? "Habilitar ejemplar" : "Retirar ejemplar"}
                                >
                                  {ej.retirado ? "Habilitar" : "⛔ Retirar"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => eliminarEjemplar(ej.numero)}
                                  className="text-slate-500 hover:text-rose-400 text-xs font-bold p-1"
                                  title="Eliminar de la carrera"
                                >
                                  ✕
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Fila rápida para agregar ejemplar */}
                  <div className="flex items-center gap-2 p-2 bg-slate-900 border-t border-slate-800">
                    <input
                      type="text"
                      placeholder="Nº"
                      value={nuevoNumCaballo}
                      onChange={(e) => setNuevoNumCaballo(e.target.value)}
                      className="w-14 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-white font-bold"
                    />
                    <input
                      type="text"
                      placeholder="Nombre del Ejemplar..."
                      value={nuevoNombreCaballo}
                      onChange={(e) => setNuevoNombreCaballo(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && agregarEjemplarActual()}
                      className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-white font-bold"
                    />
                    <Button
                      size="sm"
                      onClick={agregarEjemplarActual}
                      disabled={!nuevoNombreCaballo.trim()}
                      className="bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black px-3"
                    >
                      ➕ Añadir
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Barra de Guardado Masivo y Acciones */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFase("config")}
                className="text-xs border-slate-700 text-slate-300 hover:bg-slate-800"
              >
                ← Cargar Otro Lote
              </Button>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleEjecutarAnalisisV4}
                  className="text-xs border-indigo-500/40 text-indigo-300 hover:bg-indigo-950/40"
                >
                  ⚡ Proyectar Factores v4
                </Button>

                <Button
                  size="sm"
                  onClick={handleGuardarLoteEnBD}
                  disabled={guardandoEnBd || !carrerasCatalogo.length}
                  className="bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-black text-xs shadow-md px-5"
                >
                  {guardandoEnBd ? "💾 Guardando..." : `💾 Guardar Lote en BD (${carrerasCatalogo.length} Carreras)`}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* FASE 4: ANÁLISIS PROSPECTIVO V4                                */}
        {/* ============================================================== */}
        {fase === "analisis" && analisisV4 && (
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
              <div className="rounded-xl bg-slate-800/80 border border-slate-700/80 p-3 text-center">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Total</span>
                <span className="text-xl font-black text-white">{analisisV4.totalCarreras}</span>
              </div>
              <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-center">
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300 block">5y6</span>
                <span className="text-xl font-black text-amber-400">{analisisV4.carrerasValidas5y6.length}</span>
              </div>
              <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-3 text-center">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300 block">Líneas</span>
                <span className="text-xl font-black text-emerald-400">{analisisV4.lineasDetectadas.length}</span>
              </div>
              <div className="rounded-xl bg-blue-500/10 border border-blue-500/30 p-3 text-center">
                <span className="text-[10px] font-bold uppercase tracking-wider text-blue-300 block">Morochas</span>
                <span className="text-xl font-black text-blue-400">{analisisV4.morochasDetectadas.length}</span>
              </div>
              <div className="rounded-xl bg-purple-500/10 border border-purple-500/30 p-3 text-center">
                <span className="text-[10px] font-bold uppercase tracking-wider text-purple-300 block">Sorpresas</span>
                <span className="text-xl font-black text-purple-400">{analisisV4.sorpresasDetectadas.length}</span>
              </div>
            </div>

            <div className="flex justify-between items-center pt-3 border-t border-slate-800">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFase("edicion")}
                className="text-xs border-slate-700 text-slate-300"
              >
                ← Volver a Previsualización / Edición
              </Button>
              <Button
                size="sm"
                onClick={handleGuardarLoteEnBD}
                disabled={guardandoEnBd}
                className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs px-5"
              >
                💾 Guardar en Base de Datos
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
