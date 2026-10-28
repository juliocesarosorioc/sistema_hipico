"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/shared/components/ui/Button";
import { CLAVE_GEMINI_KEY } from "@/features/gaceta/lib/ia";
import {
  importarYExtraerGacetaPdf,
  convertirCarrerasExtraidasACatalogo,
  analizarCarrerasGacetaV4,
  type ProgresoExtraccion,
  type ResumenAnalisisGaceta,
} from "@/features/inteligencia/lib/importador-analizador-gaceta";
import type { CarreraCatalogo } from "@/features/carreras/lib/maestro-nucleo";
import type { CarreraExtraida } from "@/features/gaceta/lib/ia";
import { COLORES_GUALDRAPA } from "@/features/inteligencia/lib/analista-venezuela-v4";
import { DivisaStudSvg } from "@/features/inteligencia/components/DivisaStudSvg";
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
  const [fecha, setFecha] = useState(fechaDefault);
  const [hipodromo, setHipodromo] = useState(hipodromoDefault || "LA RINCONADA");
  const [claveGemini, setClaveGemini] = useState("");
  const [mostrarClave, setMostrarClave] = useState(false);
  const [topePaginas, setTopePaginas] = useState<string>("");
  const [archivo, setArchivo] = useState<File | null>(null);

  // Estados de proceso
  const [fase, setFase] = useState<"config" | "procesando" | "analisis">("config");
  const [progreso, setProgreso] = useState<ProgresoExtraccion>({
    fase: "leyendo",
    mensaje: "",
  });
  const [error, setError] = useState<string>("");
  const [aviso, setAviso] = useState<string>("");

  // Resultados
  const [carrerasExtraidas, setCarrerasExtraidas] = useState<CarreraExtraida[]>([]);
  const [carrerasCatalogo, setCarrerasCatalogo] = useState<CarreraCatalogo[]>([]);
  const [analisisV4, setAnalisisV4] = useState<ResumenAnalisisGaceta | null>(null);
  const [carreraSeleccionada, setCarreraSeleccionada] = useState<number>(1);
  const [guardandoEnBd, setGuardandoEnBd] = useState(false);

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
    setHipodromo(hipodromoDefault || "LA RINCONADA");
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setArchivo(f);
      setError("");
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setArchivo(e.dataTransfer.files[0]);
      setError("");
    }
  };

  const handleEjecutarExtraccion = async () => {
    if (!archivo) {
      setError("Por favor selecciona un archivo PDF o imagen de la Gaceta.");
      return;
    }
    if (!claveGemini.trim()) {
      setError("Se requiere la clave API de Gemini para procesar el documento.");
      return;
    }

    setFase("procesando");
    setError("");
    setAviso("");
    setProgreso({
      fase: "leyendo",
      mensaje: "Iniciando lectura del documento...",
    });

    try {
      const res = await importarYExtraerGacetaPdf({
        file: archivo,
        claveGemini: claveGemini.trim(),
        hipodromoDestino: hipodromo,
        fechaJornada: fecha,
        topePaginas: topePaginas ? parseInt(topePaginas, 10) : undefined,
        onProgreso: (p) => setProgreso(p),
      });

      if (!res.ok || !res.carreras.length) {
        throw new Error(res.error || "No se encontraron carreras legibles en el documento.");
      }

      setCarrerasExtraidas(res.carreras);
      if (res.aviso) setAviso(res.aviso);

      // Convertir a catálogo
      const catalogo = convertirCarrerasExtraidasACatalogo(res.carreras, fecha, hipodromo);
      setCarrerasCatalogo(catalogo);

      // Ejecutar análisis v4 automático
      setProgreso({
        fase: "analizando",
        mensaje: "Ejecutando Motor Analista Venezuela v4 (MACTOR + SMIC + Actuario)...",
      });

      const resAnalisis = analizarCarrerasGacetaV4({
        carreras: catalogo,
        fecha,
      });

      setAnalisisV4(resAnalisis);
      if (catalogo.length > 0) {
        setCarreraSeleccionada(Number(catalogo[0].carrera) || 1);
      }
      setFase("analisis");
      emitirToast(`Se extrajeron y analizaron ${catalogo.length} carreras exitosamente.`, "success");
    } catch (err) {
      setFase("config");
      setError(err instanceof Error ? err.message : String(err));
      emitirToast("Falló la extracción de la Gaceta.", "error");
    }
  };

  const handleInyectarALaboratorio = () => {
    if (!carrerasCatalogo.length) return;
    onCarrerasImportadas(carrerasCatalogo, fecha, hipodromo);
    emitirToast("Carreras inyectadas al Laboratorio de Proyecciones.", "success");
    onCerrar();
  };

  const handleSincronizarConBD = async () => {
    if (!carrerasCatalogo.length) return;
    setGuardandoEnBd(true);
    try {
      const loteParaSinc = carrerasCatalogo.map((c) => ({
        hipodromo: c.hipodromo,
        carrera: c.carrera,
        fecha: c.fecha,
        distancia: c.distancia,
        superficie: c.superficie,
        premio: c.premio,
        caballos: (c.caballos || []).map((cab) => ({
          numero: cab.numero,
          nombre: cab.nombre || "",
          jockey: cab.jockey || "",
          entrenador: cab.entrenador || "",
          peso: cab.peso || "",
          medicamento: cab.medicamento || "",
          implementos: cab.implementos || "",
        })),
      }));

      const res = await sincronizarCarrerasAlCentral(loteParaSinc, "gaceta-ia-pdf");
      if (res.ok) {
        emitirToast("Carreras guardadas en el Registro Central de la plataforma.", "success");
      } else {
        emitirToast(res.error || "Advertencia al guardar en la base de datos.", "warning");
      }
    } catch (e) {
      emitirToast(`Error al persistir en BD: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setGuardandoEnBd(false);
    }
  };

  const carreraActivaDetalle = analisisV4?.carrerasAnalizadas.find(
    (c) => c.carreraNumero === carreraSeleccionada
  );

  if (!abierto) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-4xl max-h-[92vh] overflow-y-auto p-6 bg-slate-900 border border-slate-700 text-white rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-amber-500 text-slate-950 font-black text-base shadow-sm">
              📄
            </span>
            <div>
              <h2 className="text-base font-black uppercase tracking-wider text-amber-400">
                Herramienta de Importación, Extracción y Análisis de Gaceta PDF
              </h2>
              <p className="text-[11px] text-slate-400 font-medium">
                Carga el programa oficial, procesa con IA Gemini y proyecta los 22 factores actuariales (La Rinconada / Valencia)
              </p>
            </div>
          </div>
          <button
            onClick={onCerrar}
            className="text-slate-400 hover:text-white text-lg font-bold p-1 rounded-lg hover:bg-slate-800"
          >
            ✕
          </button>
        </div>

        {/* ============================================================== */}
        {/* FASE 1: CONFIGURACIÓN Y SUBIDA DE ARCHIVO                      */}
        {/* ============================================================== */}
        {fase === "config" && (
          <div className="space-y-5 pt-3">
            {error && (
              <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs font-semibold">
                ⚠️ {error}
              </div>
            )}

            {/* Zona de Drop de archivo */}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-amber-500/40 hover:border-amber-400 bg-slate-800/60 hover:bg-slate-800/90 rounded-2xl p-8 text-center cursor-pointer transition-all space-y-2"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,image/*"
                onChange={handleFileChange}
                className="hidden"
              />
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-amber-500/10 text-3xl text-amber-400 border border-amber-500/20">
                📥
              </div>
              <div>
                <p className="text-sm font-black text-amber-300 uppercase tracking-wide">
                  {archivo ? archivo.name : "Arrastra aquí el PDF o la imagen de la Gaceta Hípica"}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {archivo
                    ? `Tamaño: ${(archivo.size / (1024 * 1024)).toFixed(2)} MB — Haz clic si deseas cambiarlo`
                    : "o haz clic para explorar tus archivos (Soporta PDF nativo, escaneado, JPG y PNG)"}
                </p>
              </div>
            </div>

            {/* Formulario de parámetros */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-slate-800/40 p-4 rounded-xl border border-slate-700/60">
              <div>
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1">
                  Hipódromo
                </label>
                <select
                  value={hipodromo}
                  onChange={(e) => setHipodromo(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-bold"
                >
                  <option value="LA RINCONADA">🇻🇪 La Rinconada</option>
                  <option value="VALENCIA">🇻🇪 Valencia</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1">
                  Fecha de la Jornada
                </label>
                <input
                  type="date"
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-bold"
                />
              </div>

              <div>
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1">
                  Páginas a procesar (Opcional)
                </label>
                <input
                  type="number"
                  placeholder="Todas (vacío)"
                  value={topePaginas}
                  onChange={(e) => setTopePaginas(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-bold placeholder:text-slate-600"
                />
              </div>
            </div>

            {/* Configuración de API Key Gemini */}
            <div className="bg-slate-800/40 p-4 rounded-xl border border-slate-700/60 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                  Clave API de Gemini
                </label>
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
                  placeholder="AIzaSy..."
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
              <p className="text-[10px] text-slate-500">
                La clave se conserva en este navegador de forma segura para futuras extracciones.
              </p>
            </div>

            {/* Botón de acción */}
            <div className="flex justify-end gap-3 pt-2">
              <Button
                variant="outline"
                onClick={onCerrar}
                className="text-xs border-slate-700 text-slate-300 hover:bg-slate-800"
              >
                Cancelar
              </Button>
              <Button
                onClick={handleEjecutarExtraccion}
                disabled={!archivo || !claveGemini.trim()}
                className="bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-slate-950 font-black text-xs shadow-md px-6 py-2"
              >
                🚀 Extraer y Analizar Gaceta con IA
              </Button>
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* FASE 2: PROCESAMIENTO ACTIVO                                   */}
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
                {progreso.fase === "leyendo" && "Fase 1: Leyendo y decodificando documento PDF..."}
                {progreso.fase === "extrayendo" && "Fase 2: Transcribiendo carreras con IA Gemini..."}
                {progreso.fase === "analizando" && "Fase 3: Computando matrices actuariales v4..."}
              </h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                {progreso.mensaje || "Por favor espera mientras el sistema extrae las carreras."}
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
                  Página {progreso.paginaActual || 1} de {progreso.totalPaginas}
                </p>
              </div>
            )}
          </div>
        )}

        {/* ============================================================== */}
        {/* FASE 3: RESULTADOS Y DASHBOARD ANALÍTICO                      */}
        {/* ============================================================== */}
        {fase === "analisis" && analisisV4 && (
          <div className="space-y-4 pt-2">
            {aviso && (
              <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-semibold">
                ℹ️ {aviso}
              </div>
            )}

            {/* Tarjetas de Métricas de la Gaceta */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
              <div className="rounded-xl bg-slate-800/80 border border-slate-700/80 p-3 text-center">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                  Total Carreras
                </span>
                <span className="text-xl font-black text-white">{analisisV4.totalCarreras}</span>
              </div>

              <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-center">
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300 block">
                  Válidas 5y6
                </span>
                <span className="text-xl font-black text-amber-400">
                  {analisisV4.carrerasValidas5y6.length}
                </span>
              </div>

              <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-3 text-center">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300 block">
                  Líneas Fijas
                </span>
                <span className="text-xl font-black text-emerald-400">
                  {analisisV4.lineasDetectadas.length}
                </span>
              </div>

              <div className="rounded-xl bg-blue-500/10 border border-blue-500/30 p-3 text-center">
                <span className="text-[10px] font-bold uppercase tracking-wider text-blue-300 block">
                  Morochas Clave
                </span>
                <span className="text-xl font-black text-blue-400">
                  {analisisV4.morochasDetectadas.length}
                </span>
              </div>

              <div className="rounded-xl bg-purple-500/10 border border-purple-500/30 p-3 text-center">
                <span className="text-[10px] font-bold uppercase tracking-wider text-purple-300 block">
                  Sorpresas
                </span>
                <span className="text-xl font-black text-purple-400">
                  {analisisV4.sorpresasDetectadas.length}
                </span>
              </div>
            </div>

            {/* Selector de Carreras Extraídas */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-slate-800">
              {analisisV4.carrerasAnalizadas.map((c) => {
                const esActiva = c.carreraNumero === carreraSeleccionada;
                return (
                  <button
                    key={c.carreraNumero}
                    type="button"
                    onClick={() => setCarreraSeleccionada(c.carreraNumero)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-black uppercase whitespace-nowrap transition-all ${
                      esActiva
                        ? "bg-amber-500 text-slate-950 shadow-sm"
                        : "bg-slate-800/80 text-slate-400 hover:text-white hover:bg-slate-700"
                    }`}
                  >
                    C{c.carreraNumero}
                    {c.esValida5y6 && (
                      <span className="ml-1 text-[9px] opacity-80">({c.numeroValida5y6}ªV)</span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Detalle de la Carrera Seleccionada */}
            {carreraActivaDetalle && (
              <div className="bg-slate-800/50 rounded-2xl border border-slate-700/60 p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-700/50 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black uppercase text-amber-400">
                      Carrera {carreraActivaDetalle.carreraNumero} — {carreraActivaDetalle.distancia}m
                    </span>
                    {carreraActivaDetalle.esValida5y6 && (
                      <span className="rounded-full bg-amber-500/20 border border-amber-400/40 text-amber-300 px-2 py-0.5 text-[10px] font-black">
                        {carreraActivaDetalle.numeroValida5y6}ª VÁLIDA 5Y6
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Escenario SMIC:{" "}
                    <span className="font-bold text-white">
                      {carreraActivaDetalle.escenarioDominanteSMIC.titulo}
                    </span>
                  </div>
                </div>

                {/* Tabla de Ranking de Ejemplares */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="text-[10px] font-black uppercase tracking-wider text-slate-400 border-b border-slate-700 h-9">
                        <th className="py-1.5 px-2.5 text-center whitespace-nowrap">Pos Llegada</th>
                        <th className="py-1.5 px-2.5 text-center whitespace-nowrap"># Carrera</th>
                        <th className="py-1.5 px-2.5">Divisa / Ejemplar</th>
                        <th className="py-1.5 px-2.5">Jinete / Entrenador</th>
                        <th className="py-1.5 px-2 text-center">Score Godet</th>
                        <th className="py-1.5 px-2 text-center">Prob %</th>
                        <th className="py-1.5 px-2 text-center">Speed Fig</th>
                        <th className="py-1.5 px-2 text-center">Ventaja</th>
                        <th className="py-1.5 px-2 text-right">Táctica</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {carreraActivaDetalle.ranking.map((ej) => {
                        const num = ej.ejemplar.numero;
                        const gualdrapa = COLORES_GUALDRAPA[num] || {
                          bg: "#3B82F6",
                          text: "#FFFFFF",
                          border: "#1D4ED8",
                        };

                        return (
                          <tr key={num} className="hover:bg-slate-700/30 h-14 min-h-[56px] transition-colors">
                            <td className="py-2.5 px-2.5 font-mono font-bold text-center text-slate-400 align-middle">
                              #{ej.ordenLlegadaProyectado}
                            </td>
                            <td className="py-2.5 px-2.5 text-center align-middle">
                              <span
                                style={{
                                  backgroundColor: gualdrapa.bg,
                                  color: gualdrapa.text,
                                  borderColor: gualdrapa.border,
                                }}
                                className="inline-grid h-7 w-7 min-w-[28px] place-items-center rounded-lg font-black text-xs sm:text-sm border shadow-sm"
                                title={`Número de ejemplar #${num} en esta carrera`}
                              >
                                {num}
                              </span>
                            </td>
                            <td className="py-2.5 px-2.5 align-middle">
                              <div className="flex items-center gap-2.5">
                                <DivisaStudSvg
                                  numero={num}
                                  divisaTexto={ej.ejemplar.divisaTexto || ej.ejemplar.stud}
                                  studNombre={ej.ejemplar.stud}
                                  className="h-7 w-7 shrink-0"
                                  mostrarGualdrapa={false}
                                />
                                <div>
                                  <span className="font-black text-white uppercase block leading-tight">
                                    {ej.ejemplar.nombre}
                                  </span>
                                  <span className="text-[10px] text-slate-400">
                                    {ej.ejemplar.estilo} · Kilos: {ej.ejemplar.kilos}kg
                                  </span>
                                </div>
                              </div>
                            </td>
                            <td className="py-2.5 px-2.5 text-slate-300 align-middle">
                              <span className="block leading-tight font-medium">
                                {ej.ejemplar.jinete || "—"}
                              </span>
                              <span className="text-[10px] text-slate-500">
                                {ej.ejemplar.entrenador || "—"}
                              </span>
                            </td>
                            <td className="py-2.5 px-2 text-center font-mono font-bold text-amber-400 align-middle">
                              {ej.scoreGodetTotal.toFixed(1)}
                            </td>
                            <td className="py-2.5 px-2 text-center font-mono font-bold text-white align-middle">
                              {ej.probabilidadSMIC.toFixed(1)}%
                            </td>
                            <td className="py-2.5 px-2 text-center font-mono text-slate-300 align-middle">
                              {ej.ejemplar.speedRatingTTC}
                            </td>
                            <td className="py-2.5 px-2 text-center font-mono text-slate-400 align-middle">
                              {ej.ordenLlegadaProyectado === 1
                                ? `+${ej.cuerposVentaja.toFixed(1)} cpos`
                                : `-${ej.cuerposVentaja.toFixed(1)} cpos`}
                            </td>
                            <td className="py-2.5 px-2.5 text-right align-middle">
                              {ej.esLinea5y6 && (
                                <span className="rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 px-1.5 py-0.5 text-[9px] font-black uppercase">
                                  Línea Fija
                                </span>
                              )}
                              {ej.esMorocha5y6 && !ej.esLinea5y6 && (
                                <span className="rounded-md bg-blue-500/20 text-blue-300 border border-blue-400/40 px-1.5 py-0.5 text-[9px] font-black uppercase">
                                  Morocha
                                </span>
                              )}
                              {ej.esSorpresaOverlay && (
                                <span className="rounded-md bg-purple-500/20 text-purple-300 border border-purple-400/40 px-1.5 py-0.5 text-[9px] font-black uppercase ml-1">
                                  Sorpresa
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Botones de Acción de Integración */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFase("config")}
                className="text-xs border-slate-700 text-slate-300 hover:bg-slate-800"
              >
                ← Cargar Otro Archivo
              </Button>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleSincronizarConBD}
                  disabled={guardandoEnBd}
                  className="text-xs border-slate-700 text-slate-200 hover:bg-slate-800 flex items-center gap-1.5"
                >
                  <span>💾</span>
                  <span>{guardandoEnBd ? "Guardando en BD..." : "Guardar en Catálogo Central"}</span>
                </Button>

                {onAbrirCuadro5y6 && (
                  <Button
                    size="sm"
                    onClick={() => {
                      onCarrerasImportadas(carrerasCatalogo, fecha, hipodromo);
                      onCerrar();
                      onAbrirCuadro5y6();
                    }}
                    className="bg-amber-600 hover:bg-amber-500 text-white font-black text-xs flex items-center gap-1.5"
                  >
                    <span>🎟️</span>
                    <span>Abrir Cuadro Maestro 5y6</span>
                  </Button>
                )}

                <Button
                  size="sm"
                  onClick={handleInyectarALaboratorio}
                  className="bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-black text-xs shadow-md flex items-center gap-1.5 px-4"
                >
                  <span>📥</span>
                  <span>Inyectar a Inteligencia Hípica</span>
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
