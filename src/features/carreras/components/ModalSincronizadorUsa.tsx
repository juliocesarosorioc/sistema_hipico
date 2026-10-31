"use client";

import { useState, useId, useTransition } from "react";
import {
  HIPODROMOS_USA_DISPONIBLES,
  parsearTextoPegadoUsa,
  sincronizarCarrerasAmericanasDia,
  iniciarAutoActualizadorRetirados,
  detenerAutoActualizadorRetirados,
  type ResumenSincronizacionUsa,
} from "@/features/carreras/lib/sincronizar-usa-tvg-drf";
import { hoyLocal } from "@/core/utils/fechas";
import { emitirToast } from "@/shared/lib/mensajeria";

interface ModalSincronizadorUsaProps {
  abierto: boolean;
  onCerrar: () => void;
  fechaDefecto?: string;
  onActualizado?: () => void;
}

export function ModalSincronizadorUsa({
  abierto,
  onCerrar,
  fechaDefecto,
  onActualizado,
}: ModalSincronizadorUsaProps) {
  const switchId = useId();
  const [tab, setTab] = useState<"auto" | "pegar">("auto");
  const [fecha, setFecha] = useState<string>(() => fechaDefecto || hoyLocal());
  const [fuente, setFuente] = useState<"AUTO_TVG_DRF" | "DRF" | "TVG">("AUTO_TVG_DRF");
  const [seleccionTodos, setSeleccionTodos] = useState(true);
  const [seleccionados, setSeleccionados] = useState<string[]>([
    "Gulfstream Park",
    "Santa Anita",
    "Tampa Bay Downs",
    "Aqueduct",
  ]);
  const [autoRetiros, setAutoRetiros] = useState(false);

  // Tab Pegar
  const [hipodromoPegado, setHipodromoPegado] = useState<string>("Gulfstream Park");
  const [textoPegado, setTextoPegado] = useState<string>("");

  // Estado de ejecución
  const [cargando, setCargando] = useState(false);
  const [, startTransition] = useTransition();
  const [resumen, setResumen] = useState<ResumenSincronizacionUsa | null>(null);

  if (!abierto) return null;

  const toggleTrack = (nombre: string) => {
    if (seleccionTodos) setSeleccionTodos(false);
    setSeleccionados((prev) =>
      prev.includes(nombre) ? prev.filter((t) => t !== nombre) : [...prev, nombre]
    );
  };

  const seleccionarTodosLosTracks = () => {
    setSeleccionTodos(true);
    setSeleccionados(HIPODROMOS_USA_DISPONIBLES.map((t) => t.nombre));
  };

  const limpiarSeleccion = () => {
    setSeleccionTodos(false);
    setSeleccionados([]);
  };

  const alternarAutoRetiros = (activo: boolean) => {
    setAutoRetiros(activo);
    if (activo) {
      iniciarAutoActualizadorRetirados(15, (res: ResumenSincronizacionUsa) => {
        emitirToast(`🔄 Retirados USA actualizados: ${res.totalRetirados} cambios procesados.`, "info");
      });
      emitirToast("🔄 Vigilante de Retirados USA activado (cada 15 minutos).", "success");
    } else {
      detenerAutoActualizadorRetirados();
      emitirToast("⏹️ Vigilante de Retirados USA desactivado.", "info");
    }
  };

  const ejecutarSincronizacionAuto = async () => {
    setCargando(true);
    setResumen(null);

    const tracksFiltro = seleccionTodos ? undefined : seleccionados;
    try {
      const res = await sincronizarCarrerasAmericanasDia({
        fechaISO: fecha,
        tracksFiltro,
        fuentePreferida: fuente,
      });

      setResumen(res);
      if (res.ok) {
        emitirToast(
          `✅ Sincronizados ${res.tracksProcesados.length} hipódromos (${res.totalCarreras} carreras, ${res.totalEjemplares} ejemplares).`,
          "success"
        );
        startTransition(() => {
          onActualizado?.();
        });
      } else {
        emitirToast(`⚠️ Sincronización completada con advertencias: ${res.error ?? "Verificar log"}`, "warning");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      emitirToast(`❌ Error al sincronizar carreras USA: ${msg}`, "error");
    } finally {
      setCargando(false);
    }
  };

  const procesarTextoPegado = async () => {
    if (!textoPegado.trim()) {
      emitirToast("Pega primero el texto o HTML de la cartelera TVG/DRF.", "warning");
      return;
    }

    setCargando(true);
    try {
      const parseados = parsearTextoPegadoUsa(textoPegado, hipodromoPegado);
      if (parseados.length === 0) {
        emitirToast("No se detectaron carreras en el texto pegado. Verifica el formato.", "warning");
        setCargando(false);
        return;
      }

      const res = await sincronizarCarrerasAmericanasDia({
        fechaISO: fecha,
        tracksFiltro: [hipodromoPegado],
        htmlOTextoPegado: textoPegado,
        hipodromoPegado,
      });

      setResumen(res);
      if (res.ok) {
        emitirToast(
          `✅ Procesado con éxito: ${parseados.length} carrera(s) para ${hipodromoPegado}.`,
          "success"
        );
        setTextoPegado("");
        startTransition(() => {
          onActualizado?.();
        });
      } else {
        emitirToast(`⚠️ Falló el registro: ${res.error}`, "error");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      emitirToast(`❌ Error al procesar texto pegado: ${msg}`, "error");
    } finally {
      setCargando(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-sinc-usa-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-3 sm:p-4 backdrop-blur-sm"
    >
      <div className="relative flex max-h-[92vh] w-full max-w-3xl flex-col rounded-3xl border border-amber-500/30 bg-slate-900 text-slate-100 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Cabecera */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-gradient-to-r from-amber-600/30 via-slate-900 to-cyan-900/30 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500 to-amber-700 text-2xl shadow-lg shadow-amber-950/50">
              🇺🇸
            </div>
            <div>
              <h2 id="modal-sinc-usa-title" className="text-base font-black tracking-wide text-white uppercase sm:text-lg">
                Sincronizador USA · TVG & DRF
              </h2>
              <p className="text-xs font-semibold text-amber-200/80">
                Alimenta de forma universal Apuestas, Tablas, Marcas, Pollas, Remates y Portal.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            className="rounded-xl p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
            aria-label="Cerrar modal"
          >
            ✕
          </button>
        </div>

        {/* Guardia Jurisdiccional USA */}
        <div className="flex items-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-5 py-2 text-[11px] font-bold text-amber-200">
          <span>🛡️ Jurisdicción Exclusiva USA:</span>
          <span className="font-normal text-amber-100/90">
            Hipódromos venezolanos (<strong className="text-white">La Rinconada</strong> y{" "}
            <strong className="text-white">Valencia</strong>) quedan 100% blindados e inmunes a esta sincronización.
          </span>
        </div>

        {/* Pestañas */}
        <div className="flex border-b border-slate-800 bg-slate-950/50 px-5">
          <button
            type="button"
            onClick={() => setTab("auto")}
            className={`border-b-2 px-4 py-3 text-xs font-black uppercase tracking-wider transition-all ${
              tab === "auto"
                ? "border-amber-400 text-amber-300 bg-amber-500/10"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            🌐 Sincronización Automática TVG / DRF
          </button>
          <button
            type="button"
            onClick={() => setTab("pegar")}
            className={`border-b-2 px-4 py-3 text-xs font-black uppercase tracking-wider transition-all ${
              tab === "pegar"
                ? "border-amber-400 text-amber-300 bg-amber-500/10"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            📋 Pegar Rápido desde TVG / DRF
          </button>
        </div>

        {/* Cuerpo con Scroll */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Selector de Fecha y Fuente */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="fecha-sinc-usa" className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                📅 Fecha de Jornada (Hora Venezuela UTC-4)
              </label>
              <input
                id="fecha-sinc-usa"
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-bold text-white focus:border-amber-400 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="fuente-sinc-usa" className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                📡 Fuente de Programación
              </label>
              <select
                id="fuente-sinc-usa"
                value={fuente}
                onChange={(e) => setFuente(e.target.value as "AUTO_TVG_DRF" | "DRF" | "TVG")}
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-bold text-white focus:border-amber-400 focus:outline-none"
              >
                <option value="AUTO_TVG_DRF">⚡ TVG + DRF Combinado (Recomendado)</option>
                <option value="DRF">🎯 Daily Racing Form (DRF Entries)</option>
                <option value="TVG">📺 TVG Live Racecards</option>
              </select>
            </div>
          </div>

          {tab === "auto" ? (
            <>
              {/* Selector de Hipódromos */}
              <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-black uppercase tracking-wider text-slate-300">
                    🏇 Hipódromos Americanos a Sincronizar
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={seleccionarTodosLosTracks}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-black uppercase transition-all ${
                        seleccionTodos
                          ? "bg-amber-500 text-slate-950 font-black shadow"
                          : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                      }`}
                    >
                      ✓ Todos los de Hoy
                    </button>
                    <button
                      type="button"
                      onClick={limpiarSeleccion}
                      className="rounded-lg bg-slate-800 px-2.5 py-1 text-[11px] font-bold text-slate-400 hover:bg-slate-700 hover:text-white"
                    >
                      Deseleccionar
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                  {HIPODROMOS_USA_DISPONIBLES.map((t) => {
                    const esta = seleccionTodos || seleccionados.includes(t.nombre);
                    return (
                      <button
                        key={t.codigo}
                        type="button"
                        onClick={() => toggleTrack(t.nombre)}
                        className={`flex items-center justify-between rounded-xl border p-2 text-left transition-all ${
                          esta
                            ? "border-amber-500/50 bg-amber-500/10 text-white font-bold"
                            : "border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700"
                        }`}
                      >
                        <span className="truncate text-xs">{t.nombre}</span>
                        <span className="ml-1 rounded bg-slate-800 px-1 py-0.5 text-[9px] font-mono text-amber-300">
                          {t.codigo}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Interruptor de Auto-Actualizador de Retirados */}
              <div className="flex items-center justify-between rounded-2xl border border-cyan-500/20 bg-cyan-950/20 p-4">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-base">🔄</span>
                    <label htmlFor={switchId} className="cursor-pointer text-xs font-black uppercase tracking-wider text-cyan-200">
                      Auto-Actualizar Retirados (Scratches) cada 15 min
                    </label>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Vigila cambios en vivo y retira automáticamente ejemplares anulando tablas y recalculando marcas.
                  </p>
                </div>
                <label htmlFor={switchId} className="relative inline-flex cursor-pointer items-center">
                  <input
                    id={switchId}
                    type="checkbox"
                    checked={autoRetiros}
                    onChange={(e) => alternarAutoRetiros(e.target.checked)}
                    className="peer sr-only"
                  />
                  <div className="h-6 w-11 rounded-full bg-slate-700 peer-checked:bg-cyan-500 peer-focus:outline-none after:absolute after:top-[2px] after:left-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full"></div>
                </label>
              </div>
            </>
          ) : (
            /* Tab Pegar Rápido */
            <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 space-y-3">
              <div>
                <label htmlFor="hipodromo-pegado-select" className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Hipódromo Destino
                </label>
                <select
                  id="hipodromo-pegado-select"
                  value={hipodromoPegado}
                  onChange={(e) => setHipodromoPegado(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-bold text-white focus:border-amber-400 focus:outline-none"
                >
                  {HIPODROMOS_USA_DISPONIBLES.map((t) => (
                    <option key={t.codigo} value={t.nombre}>
                      {t.nombre} ({t.codigo})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between pb-1">
                  <label htmlFor="texto-pegado-textarea" className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Contenido Copiado de TVG o DRF (Entries / Scratches)
                  </label>
                  <button
                    type="button"
                    onClick={() => setTextoPegado("")}
                    className="text-[10px] text-slate-500 hover:text-white"
                  >
                    Limpiar
                  </button>
                </div>
                <textarea
                  id="texto-pegado-textarea"
                  rows={8}
                  placeholder={`Pega aquí la tabla o página copiada de TVG o DRF. Ejemplo:
Race 1 - 12:30 PM
1 Speightstown (Jockey: I. Ortiz Jr., Trainer: T. Pletcher, ML: 5/2)
2 Fierceness (SCRATCHED)
3 Gun Runner (Jockey: J. Rosario, ML: 3/1)

Race 2 - 1:02 PM
...`}
                  value={textoPegado}
                  onChange={(e) => setTextoPegado(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3 font-mono text-xs text-slate-200 placeholder:text-slate-600 focus:border-amber-400 focus:outline-none"
                />
              </div>
            </div>
          )}

          {/* Resumen de Sincronización */}
          {resumen && (
            <div className="rounded-2xl border border-emerald-500/40 bg-emerald-950/30 p-4 space-y-2 animate-in fade-in duration-200">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-xs font-black uppercase text-emerald-300">
                  <span>✅ Sincronización Exitosa</span>
                  <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-200">
                    Fuente: {fuente}
                  </span>
                </span>
                <span className="text-[11px] font-mono font-bold text-emerald-400">
                  {resumen.totalCarreras} carreras · {resumen.totalEjemplares} ejemplares · {resumen.totalRetirados} retirados
                </span>
              </div>

              <div className="grid grid-cols-1 gap-2 pt-2 sm:grid-cols-2">
                {resumen.detallesPorTrack.map((t) => (
                  <div
                    key={t.hipodromo}
                    className="flex items-center justify-between rounded-xl bg-slate-900/80 px-3 py-2 text-xs"
                  >
                    <span className="font-bold text-white">{t.hipodromo}</span>
                    <span className="text-[11px] text-slate-300">
                      C1–C{t.carreras} ({t.ejemplares} ej.{t.retirados > 0 ? ` · ⛔ ${t.retirados} ret` : ""})
                    </span>
                  </div>
                ))}
              </div>

              {/* Módulos Actualizados */}
              <div className="border-t border-emerald-500/20 pt-2">
                <p className="text-[10px] font-bold uppercase text-slate-400">
                  Universalmente disponible en tiempo real:
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] font-bold">
                  <span className="rounded-md bg-cyan-950 px-2 py-0.5 text-cyan-300 border border-cyan-800">
                    🐎🎲 Apuestas
                  </span>
                  <span className="rounded-md bg-blue-950 px-2 py-0.5 text-blue-300 border border-blue-800">
                    📋 Tablas Fijas
                  </span>
                  <span className="rounded-md bg-purple-950 px-2 py-0.5 text-purple-300 border border-purple-800">
                    🎯 Marcas / 5y6
                  </span>
                  <span className="rounded-md bg-amber-950 px-2 py-0.5 text-amber-300 border border-amber-800">
                    🏆 Pollas & Remates
                  </span>
                  <span className="rounded-md bg-emerald-950 px-2 py-0.5 text-emerald-300 border border-emerald-800">
                    🌐 Portal Clientes
                  </span>
                  <span className="rounded-md bg-rose-950 px-2 py-0.5 text-rose-300 border border-rose-800">
                    🧠 Proyecciones IA
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Pie de Acciones */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 bg-slate-950 px-5 py-3.5">
          <button
            type="button"
            onClick={onCerrar}
            className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-bold text-slate-300 hover:bg-slate-700 hover:text-white transition-all"
          >
            Cerrar
          </button>

          {tab === "auto" ? (
            <button
              type="button"
              disabled={cargando}
              onClick={() => void ejecutarSincronizacionAuto()}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 px-5 py-2.5 text-xs font-black uppercase text-slate-950 shadow-lg shadow-amber-950/40 hover:from-amber-400 hover:to-amber-500 active:scale-95 disabled:opacity-50 transition-all"
            >
              {cargando ? (
                <>
                  <span className="animate-spin">🔄</span>
                  <span>Sincronizando TVG / DRF…</span>
                </>
              ) : (
                <>
                  <span>🚀</span>
                  <span>Sincronizar Carreras USA</span>
                </>
              )}
            </button>
          ) : (
            <button
              type="button"
              disabled={cargando || !textoPegado.trim()}
              onClick={() => void procesarTextoPegado()}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-5 py-2.5 text-xs font-black uppercase text-slate-950 shadow-lg shadow-emerald-950/40 hover:from-emerald-400 hover:to-emerald-500 active:scale-95 disabled:opacity-50 transition-all"
            >
              {cargando ? (
                <>
                  <span className="animate-spin">🔄</span>
                  <span>Procesando Cartelera…</span>
                </>
              ) : (
                <>
                  <span>⚡</span>
                  <span>Procesar y Guardar en Plataforma</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
