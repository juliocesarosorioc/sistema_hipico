"use client";

import { useState, useId, useTransition } from "react";
import {
  HIPODROMOS_USA_DISPONIBLES,
  parsearTextoPegadoUsa,
  sincronizarCarrerasAmericanasDia,
  iniciarAutoActualizadorRetirados,
  detenerAutoActualizadorRetirados,
  extraerFechaDeTexto,
  extraerHipodromoDeTexto,
  type ResumenSincronizacionUsa,
  type FuenteSincronizacionUsa,
  generarReporteTextoWhatsApp,
} from "@/features/carreras/lib/sincronizar-usa-tvg-drf";
import { useCarrerasDiaStore } from "@/shared/store/useCarrerasDiaStore";
import { hoyLocal } from "@/core/utils/fechas";
import { emitirToast } from "@/shared/lib/mensajeria";

interface ModalSincronizadorUsaProps {
  abierto: boolean;
  onCerrar: () => void;
  fechaDefecto?: string;
  onActualizado?: () => void;
}

function calcularFechaFutura(dias: number): string {
  const base = new Date();
  base.setDate(base.getDate() + dias);
  return base.toISOString().slice(0, 10);
}

function calcularProximoDiaSemana(diaObjetivo: number): string {
  // 0 = domingo, 6 = sábado
  const base = new Date();
  const diaActual = base.getDay();
  let diff = diaObjetivo - diaActual;
  if (diff <= 0) diff += 7;
  base.setDate(base.getDate() + diff);
  return base.toISOString().slice(0, 10);
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
  const [fuente, setFuente] = useState<FuenteSincronizacionUsa>("AUTO_TVG_DRF");
  const [seleccionTodos, setSeleccionTodos] = useState(true);
  const [seleccionados, setSeleccionados] = useState<string[]>([
    "Gulfstream Park",
    "Santa Anita",
    "Tampa Bay Downs",
    "Aqueduct",
    "Charles Town",
  ]);
  const [mostrarInformeModal, setMostrarInformeModal] = useState(false);
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
        setMostrarInformeModal(true);
        useCarrerasDiaStore.getState().setFecha(res.fecha || fecha);
        emitirToast(
          `✅ Sincronizados ${res.tracksProcesados.length} hipódromos (${res.totalCarreras} carreras, ${res.totalEjemplares} ejemplares) para ${res.fecha || fecha}.`,
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
      const parseados = parsearTextoPegadoUsa(textoPegado, hipodromoPegado, fecha);
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
        fuentePreferida: fuente,
      });

      setResumen(res);
      if (res.ok) {
        useCarrerasDiaStore.getState().setFecha(res.fecha || fecha);
        emitirToast(
          `✅ Procesado con éxito: ${parseados.length} carrera(s) para ${hipodromoPegado} (${res.fecha || fecha}).`,
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

  const handleCambioTextoPegado = (valor: string) => {
    setTextoPegado(valor);
    const f = extraerFechaDeTexto(valor);
    if (f && f !== fecha) {
      setFecha(f);
      emitirToast(`📅 Detectada fecha del programa: ${f}`, "info");
    }
    const h = extraerHipodromoDeTexto(valor);
    if (h && h !== hipodromoPegado) {
      setHipodromoPegado(h);
      emitirToast(`🏇 Detectado hipódromo: ${h}`, "info");
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
                Sincronizador USA · TVG, DRF, Equibase y Más
              </h2>
              <p className="text-xs font-semibold text-amber-200/80">
                Alimenta de forma universal Apuestas, Tablas, Marcas, Pollas, Remates y Portal para hoy o días futuros.
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
            🌐 Sincronización Automática TVG / DRF, Equibase y Otras
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
            📋 Pegar Rápido desde TVG / DRF, Equibase y Otras
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
              {/* Botones de navegación rápida para hoy y días futuros */}
              <div className="mt-2 flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  onClick={() => setFecha(hoyLocal())}
                  className={`rounded-lg px-2 py-0.5 text-[10px] font-black uppercase transition-all ${
                    fecha === hoyLocal()
                      ? "bg-amber-400 text-slate-950 shadow"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  Hoy
                </button>
                <button
                  type="button"
                  onClick={() => setFecha(calcularFechaFutura(1))}
                  className={`rounded-lg px-2 py-0.5 text-[10px] font-black uppercase transition-all ${
                    fecha === calcularFechaFutura(1)
                      ? "bg-amber-400 text-slate-950 shadow"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  Mañana (+1d)
                </button>
                <button
                  type="button"
                  onClick={() => setFecha(calcularFechaFutura(2))}
                  className={`rounded-lg px-2 py-0.5 text-[10px] font-black uppercase transition-all ${
                    fecha === calcularFechaFutura(2)
                      ? "bg-amber-400 text-slate-950 shadow"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  +2 Días
                </button>
                <button
                  type="button"
                  onClick={() => setFecha(calcularFechaFutura(3))}
                  className={`rounded-lg px-2 py-0.5 text-[10px] font-black uppercase transition-all ${
                    fecha === calcularFechaFutura(3)
                      ? "bg-amber-400 text-slate-950 shadow"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  +3 Días
                </button>
                <button
                  type="button"
                  onClick={() => setFecha(calcularProximoDiaSemana(6))}
                  className={`rounded-lg px-2 py-0.5 text-[10px] font-black uppercase transition-all ${
                    fecha === calcularProximoDiaSemana(6)
                      ? "bg-amber-400 text-slate-950 shadow"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  Sábado
                </button>
                <button
                  type="button"
                  onClick={() => setFecha(calcularProximoDiaSemana(0))}
                  className={`rounded-lg px-2 py-0.5 text-[10px] font-black uppercase transition-all ${
                    fecha === calcularProximoDiaSemana(0)
                      ? "bg-amber-400 text-slate-950 shadow"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  Domingo
                </button>
              </div>
            </div>
            <div>
              <label htmlFor="fuente-sinc-usa" className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                📡 Fuente de Programación
              </label>
              <select
                id="fuente-sinc-usa"
                value={fuente}
                onChange={(e) => setFuente(e.target.value as FuenteSincronizacionUsa)}
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-bold text-white focus:border-amber-400 focus:outline-none"
              >
                <option value="AUTO_TVG_DRF">⚡ Multi-Fuente: DRF + TVG + Equibase (Recomendado)</option>
                <option value="DRF">🎯 Daily Racing Form (DRF Entries)</option>
                <option value="EQUIBASE">🏇 Equibase (Entries & Fast Entries)</option>
                <option value="TVG">📺 TVG / FanDuel Racing</option>
                <option value="OTRAS">🌐 TwinSpires / Brisnet / Otras Páginas</option>
              </select>
            </div>
          </div>

                    {/* Alerta de Jornada Futura */}
          {fecha > hoyLocal() && (
            <div className="flex items-center gap-2.5 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs font-semibold text-amber-200">
              <span className="text-xl">🗓️</span>
              <div>
                <span className="font-black text-white uppercase tracking-wider">
                  Programación para Jornada Futura: {fecha}
                </span>
                <p className="text-[11px] text-amber-100/90 font-normal">
                  Las carreras importadas para este día venidero quedarán registradas en el catálogo central y disponibles al instante en Apuestas, Tablas, Marcas y Reportes de esa fecha.
                </p>
              </div>
            </div>
          )}

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
                      ✓ Todos los de la Jornada
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
                  placeholder={`Pega aquí la cartelera o entries copiado de Equibase, DRF, TVG, TwinSpires, Brisnet, etc.
Soporta programaciones de HOY y DÍAS FUTUROS. Detecta automáticamente fecha, hipódromo, distancias, PP, dividendos ML y ejemplares retirados.

Ejemplo Equibase (Fast Entries):
Gulfstream Park - Saturday, October 31, 2026
Race 1 - 12:30 PM - 6 1/2 Furlongs
1 (1) Fierceness (KY) 124 J. Velazquez T. Pletcher 8-5
2 (2) Sierra Leone (KY) 124 T. Gaffalione C. Brown 3-1
3 (3) Dornoch (SCRATCHED)

Ejemplo DRF / TVG:
Race 1 - 12:35 PM
1 Speightstown (PP: 1, ML: 5/2, Jockey: I. Ortiz Jr., Trainer: T. Pletcher)
2 Dornoch (SCRATCHED)`}
                  value={textoPegado}
                  onChange={(e) => handleCambioTextoPegado(e.target.value)}
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
        {/* Modal de Informe de Resultado */}
        {mostrarInformeModal && resumen && (
          <ModalInformeResultadoSincronizacion
            resumen={resumen}
            fuente={fuente}
            onCerrar={() => setMostrarInformeModal(false)}
          />
        )}
      </div>
    </div>
  );
}


interface ModalInformeResultadoProps {
  resumen: ResumenSincronizacionUsa;
  fuente: string;
  onCerrar: () => void;
}

function ModalInformeResultadoSincronizacion({
  resumen,
  fuente,
  onCerrar,
}: ModalInformeResultadoProps) {
  const [copiado, setCopiado] = useState(false);

  const handleCopiar = () => {
    const texto = generarReporteTextoWhatsApp(resumen);
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(texto);
      setCopiado(true);
      emitirToast("📋 ¡Informe copiado al portapapeles listo para WhatsApp!", "success");
      setTimeout(() => setCopiado(false), 3000);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-3 sm:p-4 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div className="relative flex max-h-[90vh] w-full max-w-xl flex-col rounded-3xl border border-emerald-500/50 bg-slate-900 text-slate-100 shadow-2xl overflow-hidden">
        {/* Cabecera */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-gradient-to-r from-emerald-950 via-slate-900 to-teal-950 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-2xl shadow-lg shadow-emerald-950/50">
              📋
            </div>
            <div>
              <h3 className="text-base font-black uppercase tracking-wide text-white">
                Informe de Sincronización de Carreras
              </h3>
              <p className="text-xs font-semibold text-emerald-300">
                Programación consolidada para {resumen.fecha} · Fuente: {fuente}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Cuerpo */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Métricas destacadas */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-3 text-center">
              <span className="text-[10px] font-bold uppercase text-slate-400 block">Hipódromos</span>
              <span className="text-xl font-black text-amber-400">{resumen.tracksProcesados.length}</span>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-3 text-center">
              <span className="text-[10px] font-bold uppercase text-slate-400 block">Carreras</span>
              <span className="text-xl font-black text-cyan-400">{resumen.totalCarreras}</span>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-3 text-center">
              <span className="text-[10px] font-bold uppercase text-slate-400 block">Ejemplares</span>
              <span className="text-xl font-black text-emerald-400">{resumen.totalEjemplares}</span>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-3 text-center">
              <span className="text-[10px] font-bold uppercase text-slate-400 block">Retirados</span>
              <span className={`text-xl font-black ${resumen.totalRetirados > 0 ? "text-rose-400" : "text-slate-400"}`}>
                {resumen.totalRetirados}
              </span>
            </div>
          </div>

          {/* Desglose por Hipódromo */}
          <div className="space-y-2">
            <h4 className="text-[11px] font-black uppercase tracking-wider text-slate-400">
              Detalle por Hipódromo Procesado:
            </h4>
            <div className="space-y-2">
              {resumen.detallesPorTrack.map((t) => (
                <div
                  key={t.hipodromo}
                  className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3.5 space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-black text-white">{t.hipodromo}</span>
                      <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                        C1–C{t.carreras}
                      </span>
                    </div>
                    <span className="text-xs font-mono font-bold text-slate-300">
                      {t.ejemplares} ejemplares
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 flex items-center justify-between">
                    <span>
                      {t.retirados > 0
                        ? `⛔ ${t.retirados} retirado(s) detectados: #${t.listaRetirados.join(", #")}`
                        : "✅ Pista completa sin retirados"}
                    </span>
                    <span className="text-emerald-400 font-bold">● Activo en sistema</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Módulos confirmados */}
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-3.5 space-y-2">
            <span className="text-[11px] font-black uppercase text-emerald-300 block">
              ✅ Disponibilidad Inmediata Confirmada:
            </span>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex items-center gap-2 text-slate-200">
                <span className="text-emerald-400">✓</span> Apuestas & Taquilla
              </div>
              <div className="flex items-center gap-2 text-slate-200">
                <span className="text-emerald-400">✓</span> Tablas Fijas
              </div>
              <div className="flex items-center gap-2 text-slate-200">
                <span className="text-emerald-400">✓</span> Marcas & 5y6
              </div>
              <div className="flex items-center gap-2 text-slate-200">
                <span className="text-emerald-400">✓</span> Pollas & Remates
              </div>
              <div className="flex items-center gap-2 text-slate-200">
                <span className="text-emerald-400">✓</span> Portal de Clientes
              </div>
              <div className="flex items-center gap-2 text-slate-200">
                <span className="text-emerald-400">✓</span> Hora Caracas (UTC-4)
              </div>
            </div>
          </div>
        </div>

        {/* Pie con botón para WhatsApp */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-slate-800 bg-slate-950 px-5 py-3.5">
          <button
            type="button"
            onClick={handleCopiar}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black uppercase text-white shadow-lg shadow-emerald-950/40 hover:bg-emerald-500 active:scale-95 transition-all"
          >
            <span>{copiado ? "✅" : "📋"}</span>
            <span>{copiado ? "¡Copiado!" : "Copiar Informe para WhatsApp"}</span>
          </button>
          <button
            type="button"
            onClick={onCerrar}
            className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-bold text-slate-300 hover:bg-slate-700 hover:text-white transition-all"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}

