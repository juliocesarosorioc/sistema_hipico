"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import {
  listarGacetasRepositorio,
  guardarGacetaEnRepositorio,
  alternarPublicacionGaceta,
  eliminarGacetaRepositorio,
  descargarArchivoGaceta,
  type GacetaAlmacenada,
} from "@/features/gaceta/lib/repositorio-gacetas";
import { type OpcionHipodromo } from "@/features/tablas/lib/rpc";
import { Button } from "@/shared/components/ui/Button";
import { DateInput } from "@/shared/components/ui/DateInput";
import { hoyLocal } from "@/features/gaceta/lib/programa";

interface Props {
  abierto: boolean;
  onCerrar: () => void;
  hipodromos: OpcionHipodromo[];
  hipodromoSugerido?: string;
  fechaSugerida?: string;
  archivoPrecargado?: {
    nombre: string;
    dataUrl: string;
    tamanoBytes: number;
    tipoMime: string;
  };
}

export function ModalAlmacenarGacetas({
  abierto,
  onCerrar,
  hipodromos,
  hipodromoSugerido,
  fechaSugerida,
  archivoPrecargado,
}: Props) {
  const [gacetas, setGacetas] = useState<GacetaAlmacenada[]>([]);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [filtroHipo, setFiltroHipo] = useState("");

  // Formulario de nueva gaceta
  const [titulo, setTitulo] = useState("");
  const [hipo, setHipo] = useState(hipodromoSugerido || "LA RINCONADA");
  const [fecha, setFecha] = useState(fechaSugerida || hoyLocal());
  const [publicarPortal, setPublicarPortal] = useState(true);
  const [archivoSeleccionado, setArchivoSeleccionado] = useState<{
    nombre: string;
    dataUrl: string;
    tamanoBytes: number;
    tipoMime: string;
  } | null>(archivoPrecargado || null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const refrescar = useCallback(async () => {
    setCargando(true);
    try {
      const lista = await listarGacetasRepositorio();
      setGacetas(lista);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    if (abierto) {
      void refrescar();
      if (archivoPrecargado) {
        setArchivoSeleccionado(archivoPrecargado);
        setTitulo(`Gaceta Oficial ${hipodromoSugerido || "Hípica"} - ${archivoPrecargado.nombre}`);
      }
    }
  }, [abierto, refrescar, archivoPrecargado, hipodromoSugerido]);

  if (!abierto) return null;

  const handleSeleccionarArchivo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const fr = new FileReader();
    fr.onload = () => {
      const dataUrl = String(fr.result || "");
      setArchivoSeleccionado({
        nombre: f.name,
        dataUrl,
        tamanoBytes: f.size,
        tipoMime: f.type || "application/pdf",
      });
      if (!titulo.trim()) {
        const sinExt = f.name.replace(/\.[^/.]+$/, "");
        setTitulo(`Gaceta ${hipo || ""} - ${sinExt}`.trim());
      }
    };
    fr.readAsDataURL(f);
  };

  const handleGuardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!archivoSeleccionado) {
      alert("Por favor selecciona un archivo PDF o imagen de gaceta.");
      return;
    }
    setGuardando(true);
    try {
      await guardarGacetaEnRepositorio({
        titulo: titulo.trim() || `Gaceta ${hipo} ${fecha}`,
        hipodromo: hipo,
        fecha,
        nombreArchivo: archivoSeleccionado.nombre,
        tamanoBytes: archivoSeleccionado.tamanoBytes,
        tipoMime: archivoSeleccionado.tipoMime,
        urlArchivo: archivoSeleccionado.dataUrl,
        publicadaEnPortal: publicarPortal,
      });
      setTitulo("");
      setArchivoSeleccionado(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await refrescar();
    } catch (err) {
      alert(`Error al guardar gaceta: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setGuardando(false);
    }
  };

  const handleTogglePortal = async (g: GacetaAlmacenada) => {
    const nuevo = !g.publicadaEnPortal;
    await alternarPublicacionGaceta(g.id, nuevo);
    setGacetas((prev) =>
      prev.map((item) => (item.id === g.id ? { ...item, publicadaEnPortal: nuevo } : item))
    );
  };

  const handleEliminar = async (id: string) => {
    if (!confirm("¿Deseas eliminar esta gaceta del repositorio?")) return;
    await eliminarGacetaRepositorio(id);
    setGacetas((prev) => prev.filter((item) => item.id !== id));
  };

  const gacetasFiltradas = filtroHipo
    ? gacetas.filter((g) => g.hipodromo.toUpperCase().includes(filtroHipo.toUpperCase()))
    : gacetas;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-xs p-3 sm:p-5 overflow-y-auto animate-in fade-in">
      <div className="relative w-full max-w-4xl rounded-3xl border border-line bg-surface text-slate-800 shadow-2xl flex flex-col max-h-[90vh] overflow-hidden my-auto">
        {/* Encabezado */}
        <div className="flex items-center justify-between border-b border-line bg-surfaceAlt/60 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-indigo-600/15 text-indigo-700 font-black text-lg border border-indigo-500/20">
              📚
            </span>
            <div>
              <h2 className="text-base font-black uppercase tracking-wide text-slate-900">
                Almacén y Repositorio de Gacetas Hípicas
              </h2>
              <p className="text-[11px] font-semibold text-slate-500">
                Almacena gacetas oficiales y ponlas a disposición para consulta y descarga de tus jugadores en el Portal.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200 hover:text-slate-800 transition"
          >
            ✕
          </button>
        </div>

        {/* Contenido dividido en 2 paneles: Subir nueva + Lista existente */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {/* Formulario de subida rápida */}
          <form
            onSubmit={handleGuardar}
            className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-4 sm:p-5 shadow-xs space-y-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-black uppercase tracking-wide text-indigo-900 flex items-center gap-1.5">
                <span>📤</span> Subir y Almacenar Nueva Gaceta
              </span>
              <span className="text-[11px] font-semibold text-indigo-700">
                Archivos PDF o imágenes (JPG, PNG)
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">
                  1 · Hipódromo
                </label>
                <select
                  value={hipo}
                  onChange={(e) => setHipo(e.target.value)}
                  className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {hipodromos.map((h) => (
                    <option key={h.value} value={h.value}>
                      {h.label}
                    </option>
                  ))}
                  {hipodromos.length === 0 && (
                    <>
                      <option value="LA RINCONADA">LA RINCONADA</option>
                      <option value="VALENCIA">VALENCIA</option>
                      <option value="GULFSTREAM PARK">GULFSTREAM PARK</option>
                    </>
                  )}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">
                  2 · Fecha de la Jornada
                </label>
                <DateInput
                  value={fecha}
                  onFechaChange={(f) => setFecha(f || hoyLocal())}
                  className="w-full text-xs font-bold"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">
                  3 · Título / Descripción
                </label>
                <input
                  type="text"
                  placeholder="ej. Gaceta Oficial Reunión 42"
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-xs font-medium text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            {/* Selección de Archivo */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-indigo-100">
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,image/*"
                  onChange={handleSeleccionarArchivo}
                  className="hidden"
                  id="input-archivo-gaceta"
                />
                <label
                  htmlFor="input-archivo-gaceta"
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-indigo-300 bg-white px-3 py-1.5 text-xs font-bold text-indigo-700 shadow-2xs hover:bg-indigo-50 transition"
                >
                  <span>📎</span> {archivoSeleccionado ? "Cambiar Archivo" : "Seleccionar PDF / Imagen"}
                </label>
                {archivoSeleccionado && (
                  <span className="text-xs font-semibold text-slate-700 truncate max-w-xs">
                    📄 {archivoSeleccionado.nombre} ({(archivoSeleccionado.tamanoBytes / 1024 / 1024).toFixed(2)} MB)
                  </span>
                )}
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1.5 text-xs font-bold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={publicarPortal}
                    onChange={(e) => setPublicarPortal(e.target.checked)}
                    className="h-4 w-4 rounded accent-indigo-600 cursor-pointer"
                  />
                  <span>🌐 Publicar en Portal de Jugadores</span>
                </label>

                <Button
                  type="submit"
                  size="sm"
                  disabled={guardando || !archivoSeleccionado}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs shadow-sm"
                >
                  {guardando ? "Guardando..." : "💾 Almacenar y Publicar"}
                </Button>
              </div>
            </div>
          </form>

          {/* Listado de Gacetas Almacenadas */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
              <h3 className="text-xs font-black uppercase tracking-wide text-slate-700 flex items-center gap-1.5">
                <span>📁</span> Gacetas en Repositorio ({gacetasFiltradas.length})
              </h3>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Filtrar por hipódromo..."
                  value={filtroHipo}
                  onChange={(e) => setFiltroHipo(e.target.value)}
                  className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs text-slate-700 outline-none placeholder:text-slate-400"
                />
                <button
                  type="button"
                  onClick={() => void refrescar()}
                  disabled={cargando}
                  className="text-xs font-bold text-slate-500 hover:text-indigo-600 px-1.5 py-1"
                >
                  🔄
                </button>
              </div>
            </div>

            {cargando ? (
              <p className="text-center py-6 text-xs text-slate-400 font-semibold animate-pulse">
                Cargando gacetas almacenadas...
              </p>
            ) : gacetasFiltradas.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-line p-6 text-center text-xs text-slate-400">
                No hay gacetas almacenadas en el repositorio {filtroHipo ? `para ${filtroHipo}` : ""}.
                Sube una arriba para comenzar.
              </div>
            ) : (
              <div className="grid gap-2.5 sm:grid-cols-2">
                {gacetasFiltradas.map((g) => (
                  <div
                    key={g.id}
                    className="flex flex-col justify-between rounded-2xl border border-line bg-surfaceAlt/30 p-3.5 shadow-2xs hover:border-indigo-200 transition"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <span className="rounded-md bg-indigo-100 px-2 py-0.5 text-[10px] font-black uppercase text-indigo-800">
                          {g.hipodromo}
                        </span>
                        <span className="text-[10px] font-mono font-bold text-slate-500">
                          📅 {g.fecha}
                        </span>
                      </div>

                      <h4 className="mt-2 text-xs font-bold text-slate-900 line-clamp-1">
                        {g.titulo}
                      </h4>
                      <p className="text-[10px] text-slate-500 truncate mt-0.5">
                        📎 {g.nombreArchivo} · {(g.tamanoBytes / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>

                    <div className="mt-3 pt-2.5 border-t border-line flex items-center justify-between gap-2">
                      {/* Switch de visibilidad en Portal */}
                      <button
                        type="button"
                        onClick={() => void handleTogglePortal(g)}
                        title={
                          g.publicadaEnPortal
                            ? "Visible para jugadores en el Portal. Clic para ocultar."
                            : "Oculta en el Portal. Clic para hacerla visible a los jugadores."
                        }
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold transition ${
                          g.publicadaEnPortal
                            ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                            : "bg-slate-200 text-slate-600 hover:bg-slate-300"
                        }`}
                      >
                        <span>{g.publicadaEnPortal ? "🌐 En Portal" : "🔒 Oculta"}</span>
                      </button>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => descargarArchivoGaceta(g)}
                          title="Descargar Gaceta (PDF)"
                          className="rounded-lg bg-white border border-line px-2 py-1 text-[11px] font-bold text-indigo-700 hover:bg-indigo-50 shadow-2xs transition"
                        >
                          ⬇️ Descargar
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleEliminar(g.id)}
                          title="Eliminar Gaceta"
                          className="rounded-lg bg-white border border-rose-200 px-1.5 py-1 text-[11px] font-bold text-rose-600 hover:bg-rose-50 transition"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Pie */}
        <div className="border-t border-line bg-surfaceAlt/60 px-5 py-3 flex justify-between items-center">
          <p className="text-[11px] text-slate-500">
            💡 Las gacetas marcadas con <b>🌐 En Portal</b> aparecen automáticamente en la sección <b>📰 Gacetas y Retrospectos</b> de la cuenta de tus jugadores.
          </p>
          <Button size="sm" variant="outline" onClick={onCerrar} className="text-xs">
            Cerrar
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ModalAlmacenarGacetas;
