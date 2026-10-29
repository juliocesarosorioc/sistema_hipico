"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  type ConfiguracionIncentivosWps,
  type ApuestaWpsParseada,
  CONFIG_WPS_DEFECTO,
  parsearBloqueWps,
  calcularPagoWps,
  resolverDividendoVenezuela,
  TABLA_VENEZUELA_FRACCIONES,
} from "@/features/motores/lib/wps-incentivos";
import {
  leerConfiguracionWps,
  guardarConfiguracionWps,
  puedeEditarConfigWps,
} from "@/features/motores/lib/wps-storage";
import { esUsuarioPrincipal } from "@/features/seguridad/lib/resolver";
import { usuarioVigente } from "@/features/seguridad/lib/vigente";
import { emitirToast } from "@/shared/lib/mensajeria";
import { useAuthStore } from "@/shared/store/useAuthStore";

export type ModalWpsApuestasProps = {
  abierto: boolean;
  onCerrar: () => void;
  grupoId?: string | number | null;
  nombreGrupo?: string;
  hipodromo?: string;
  carrera?: number | string;
  gruposDisponibles?: Array<{ id: string | number; nombre: string }>;
  onCargarApuestas?: (apuestas: ApuestaWpsParseada[]) => void;
};

export function ModalWpsApuestas({
  abierto,
  onCerrar,
  grupoId,
  nombreGrupo = "Grupo Activo",
  hipodromo,
  carrera,
  gruposDisponibles = [],
  onCargarApuestas,
}: ModalWpsApuestasProps) {
  const [pestana, setPestana] = useState<"apuestas" | "config" | "tabla_ve">("apuestas");
  const [grupoConfigId, setGrupoConfigId] = useState<string>(grupoId ? String(grupoId) : "global");

  // Estado de apuestas
  const [textoApuestas, setTextoApuestas] = useState("");
  const [cargandoGuardar, setCargandoGuardar] = useState(false);

  // Estado de configuracion
  const [config, setConfig] = useState<ConfiguracionIncentivosWps>(CONFIG_WPS_DEFECTO);
  const [configCargando, setConfigCargando] = useState(true);

  // Simulador interactivo
  const [simDividendoBase, setSimDividendoBase] = useState("2.20");
  const [simMonto, setSimMonto] = useState("100");
  const [simModalidad, setSimModalidad] = useState<"W" | "P" | "S">("W");

  // Filtro para la tabla de Venezuela
  const [filtroTablaVe, setFiltroTablaVe] = useState("");

  const esPrincipalStore = useAuthStore((s) => s.esPrincipal);
  const usuarioSesion = useAuthStore((s) => s.usuario);
  const esAdmin = Boolean(esPrincipalStore || esUsuarioPrincipal(usuarioSesion));
  const tienePermisoEditar = useMemo(() => {
    return puedeEditarConfigWps(grupoConfigId);
  }, [grupoConfigId]);

  // Cargar configuracion al abrir o cambiar de grupo seleccionado
  useEffect(() => {
    if (!abierto) return;
    let activo = true;
    setConfigCargando(true);
    leerConfiguracionWps(grupoConfigId).then((c) => {
      if (activo) {
        setConfig(c);
        setConfigCargando(false);
      }
    });
    return () => {
      activo = false;
    };
  }, [abierto, grupoConfigId]);

  // Parseo en vivo del texto de apuestas
  const parseoEnVivo = useMemo(() => {
    return parsearBloqueWps(textoApuestas);
  }, [textoApuestas]);

  // Calculo de la simulacion
  const simulacionResultado = useMemo(() => {
    // Si viene en formato fraccional venezolano o monto en Bs, lo resuelve primero
    const resVe = resolverDividendoVenezuela(simDividendoBase);
    const baseNum = resVe ? resVe.factorDecimal : parseFloat(simDividendoBase.replace(",", ".")) || 2.0;
    const montoNum = parseFloat(simMonto.replace(",", ".")) || 0;
    return calcularPagoWps(montoNum, baseNum, config, simModalidad);
  }, [simDividendoBase, simMonto, simModalidad, config]);

  if (!abierto) return null;

  const handleGuardarConfig = async () => {
    if (!tienePermisoEditar) {
      emitirToast("No tiene permisos para modificar la configuración de este grupo.", "warning");
      return;
    }
    setCargandoGuardar(true);
    try {
      const res = await guardarConfiguracionWps(grupoConfigId, config);
      if (res.ok) {
        emitirToast("✅ Configuración de incentivos WPS guardada exitosamente.", "success");
      } else {
        emitirToast(`Error: ${res.error ?? "No se pudo guardar"}`, "error");
      }
    } finally {
      setCargandoGuardar(false);
    }
  };

  const handleCargarApuestas = () => {
    if (parseoEnVivo.apuestas.length === 0) {
      emitirToast("No hay apuestas válidas para cargar. Escriba las jugadas con formato: Jugador win/place/show/WPS Ejemplar Monto", "warning");
      return;
    }
    if (onCargarApuestas) {
      onCargarApuestas(parseoEnVivo.apuestas);
      emitirToast(`🏇 Se cargaron ${parseoEnVivo.apuestas.length} apuestas WPS a la carrera.`, "success");
      setTextoApuestas("");
      onCerrar();
    } else {
      emitirToast(`✅ ${parseoEnVivo.apuestas.length} apuestas procesadas correctamente.`, "success");
    }
  };

  const agregarRango = () => {
    const nuevo = {
      id: "r_" + Date.now(),
      min: 2.1,
      max: 2.5,
      llevarA: 2.5,
    };
    setConfig((prev) => ({
      ...prev,
      rangos: [...prev.rangos, nuevo],
    }));
  };

  const eliminarRango = (idx: number) => {
    setConfig((prev) => ({
      ...prev,
      rangos: prev.rangos.filter((_, i) => i !== idx),
    }));
  };

  const actualizarRango = (idx: number, campo: "min" | "max" | "llevarA" | "sumar", val: number) => {
    setConfig((prev) => {
      const copia = [...prev.rangos];
      copia[idx] = { ...copia[idx], [campo]: val };
      return { ...prev, rangos: copia };
    });
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/80 p-3 sm:p-5 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="flex h-full max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
        {/* Cabecera */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950 px-5 py-3 text-white">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/20 text-2xl border border-amber-400/40">
              🏇
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-black uppercase tracking-wider text-amber-400">
                  Módulo W.P.S. · Win, Place & Show
                </h2>
                <span className="rounded-full bg-emerald-500/20 border border-emerald-400/40 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                  Activo
                </span>
              </div>
              <p className="text-xs text-slate-400">
                {nombreGrupo}
                {hipodromo ? ` · 🏇 ${hipodromo}` : ""}
                {carrera ? ` · C${carrera}` : ""}
                {" · "}Incentivos a dividendos y Tabla Oficial INH Venezuela
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCerrar}
              className="rounded-lg bg-slate-800 p-2 text-slate-400 hover:bg-slate-700 hover:text-white transition"
              aria-label="Cerrar modal"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Barra de pestañas */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-950/90 px-5 py-2">
          <button
            type="button"
            onClick={() => setPestana("apuestas")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-black transition ${
              pestana === "apuestas"
                ? "bg-amber-500 text-slate-950 shadow-md"
                : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            }`}
          >
            <span>📝</span> Carga de Apuestas WPS
            {parseoEnVivo.apuestas.length > 0 && (
              <span className="rounded-full bg-slate-950 px-1.5 py-0.2 text-[10px] font-black text-amber-400">
                {parseoEnVivo.apuestas.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setPestana("config")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-black transition ${
              pestana === "config"
                ? "bg-indigo-600 text-white shadow-md"
                : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            }`}
          >
            <span>⚙️</span> Incentivos y Rango de Precios
          </button>

          <button
            type="button"
            onClick={() => setPestana("tabla_ve")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-black transition ${
              pestana === "tabla_ve"
                ? "bg-sky-600 text-white shadow-md"
                : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            }`}
          >
            <span>🇻🇪</span> Tabla Venezuela (Boleto 100 Bs)
          </button>
        </div>

        {/* Cuerpo del modal */}
        <div className="flex-1 overflow-y-auto p-5 text-slate-200">
          {/* PESTAÑA 1: CARGA DE APUESTAS WPS */}
          {pestana === "apuestas" && (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
              <div className="space-y-3 lg:col-span-5">
                <div className="rounded-xl border border-slate-800 bg-slate-950 p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-black uppercase text-amber-300">
                      Entrada Rápida de Jugadas WPS
                    </label>
                    <span className="text-[10px] text-slate-400 font-mono">1 jugada por línea</span>
                  </div>

                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Sintaxis directa requerida:
                    <br />
                    <code className="text-amber-300 font-bold">Jugador win Ejemplar Monto</code>
                    <br />
                    <code className="text-sky-300 font-bold">Jugador place Ejemplar Monto</code>
                    <br />
                    <code className="text-emerald-300 font-bold">Jugador show Ejemplar Monto</code>
                    <br />
                    <code className="text-purple-300 font-bold">Jugador WPS Ejemplar Monto</code>{" "}
                    <span className="text-[10px] text-purple-200">(genera Win, Place y Show por el monto)</span>
                  </p>

                  <textarea
                    value={textoApuestas}
                    onChange={(e) => setTextoApuestas(e.target.value)}
                    rows={10}
                    placeholder={`Ejemplo:\nCarlos win 4 100\nMaria place 7 50\nPedro show 2 80\nAlana WPS 5 100`}
                    className="w-full resize-y rounded-lg border border-slate-700 bg-slate-900 p-3 font-mono text-xs text-slate-100 placeholder-slate-600 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
                  />

                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      onClick={() => setTextoApuestas("Carlos win 4 100\nMaria place 7 50\nPedro show 2 80\nAlana WPS 5 100")}
                      className="text-[11px] font-bold text-amber-400 hover:underline"
                    >
                      Cargar texto de ejemplo
                    </button>
                    <button
                      type="button"
                      onClick={() => setTextoApuestas("")}
                      className="text-[11px] font-bold text-slate-400 hover:text-rose-400"
                    >
                      Limpiar
                    </button>
                  </div>
                </div>

                {parseoEnVivo.lineasRechazadas.length > 0 && (
                  <div className="rounded-xl border border-rose-500/40 bg-rose-950/20 p-3">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-rose-300">
                      <span>⚠️</span> Líneas que no coinciden con la sintaxis ({parseoEnVivo.lineasRechazadas.length})
                    </div>
                    <ul className="mt-1 list-disc pl-4 text-[10px] text-rose-200 space-y-0.5">
                      {parseoEnVivo.lineasRechazadas.map((l, i) => (
                        <li key={i} className="font-mono">{l}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Previsualización en vivo */}
              <div className="space-y-3 lg:col-span-7">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-300">
                    Previsualización de Apuestas ({parseoEnVivo.apuestas.length})
                  </h3>
                  {config.activo && (
                    <span className="inline-flex items-center gap-1 rounded bg-indigo-900/60 border border-indigo-500/40 px-2 py-0.5 text-[10px] font-bold text-indigo-200">
                      ⚡ Incentivos de {nombreGrupo} activos
                    </span>
                  )}
                </div>

                {parseoEnVivo.apuestas.length === 0 ? (
                  <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-dashed border-slate-800 bg-slate-950/50 p-6 text-center text-slate-500">
                    <span className="text-4xl mb-2">📋</span>
                    <p className="text-xs font-bold text-slate-400">Sin jugadas detectadas todavía</p>
                    <p className="text-[11px] text-slate-500 mt-1 max-w-sm">
                      Escriba o pegue jugadas en el panel izquierdo siguiendo el formato <br />
                      <strong className="text-slate-400">"Jugador win/place/show/WPS Ejemplar Monto"</strong>
                    </p>
                  </div>
                ) : (
                  <div className="max-h-96 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950">
                    <table className="w-full text-left text-xs">
                      <thead className="sticky top-0 bg-slate-800/90 text-[10px] font-black uppercase text-slate-400">
                        <tr>
                          <th className="px-3 py-2">#</th>
                          <th className="px-3 py-2">Jugador</th>
                          <th className="px-3 py-2">Modalidad</th>
                          <th className="px-3 py-2 text-center">Ejemplar</th>
                          <th className="px-3 py-2 text-right">Monto</th>
                          <th className="px-3 py-2">Origen / Nota</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {parseoEnVivo.apuestas.map((ap, idx) => {
                          const badgeCls =
                            ap.modalidad === "WIN"
                              ? "bg-amber-500/20 text-amber-300 border-amber-500/30"
                              : ap.modalidad === "PLACE"
                              ? "bg-sky-500/20 text-sky-300 border-sky-500/30"
                              : "bg-emerald-500/20 text-emerald-300 border-emerald-500/30";

                          return (
                            <tr key={idx} className="hover:bg-slate-900/60 transition">
                              <td className="px-3 py-2 font-mono text-[10px] text-slate-500">{idx + 1}</td>
                              <td className="px-3 py-2 font-bold text-slate-100">{ap.jugador}</td>
                              <td className="px-3 py-2">
                                <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-black ${badgeCls}`}>
                                  {ap.modalidad === "WIN" && "🥇 WIN"}
                                  {ap.modalidad === "PLACE" && "🥈 PLACE"}
                                  {ap.modalidad === "SHOW" && "🥉 SHOW"}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-center font-black text-amber-400 font-mono">
                                #{ap.ejemplar}
                              </td>
                              <td className="px-3 py-2 text-right font-mono font-bold text-emerald-400">
                                ${ap.monto.toFixed(2)}
                              </td>
                              <td className="px-3 py-2 text-[10px] text-slate-400">
                                {ap.esWpsCombo ? (
                                  <span className="rounded bg-purple-950 border border-purple-800/40 px-1.5 py-0.5 font-bold text-purple-300">
                                    Desglose WPS
                                  </span>
                                ) : (
                                  "Simple"
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                  <div className="text-xs text-slate-400">
                    Total apuestas a generar:{" "}
                    <strong className="text-amber-400 font-mono">{parseoEnVivo.apuestas.length}</strong> · Monto en juego:{" "}
                    <strong className="text-emerald-400 font-mono">
                      ${parseoEnVivo.apuestas.reduce((acc, a) => acc + a.monto, 0).toFixed(2)}
                    </strong>
                  </div>

                  <button
                    type="button"
                    onClick={handleCargarApuestas}
                    disabled={parseoEnVivo.apuestas.length === 0}
                    className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 px-4 py-2 text-xs font-black text-slate-950 shadow-md hover:from-amber-400 hover:to-amber-500 disabled:opacity-50 transition cursor-pointer"
                  >
                    <span>📥</span> Cargar Apuestas WPS a la Carrera
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* PESTAÑA 2: CONFIGURACION DE INCENTIVOS Y RANGOS DE PRECIOS */}
          {pestana === "config" && (
            <div className="space-y-6">
              {/* Selector de Grupo / Permisos */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950 p-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black uppercase tracking-wider text-amber-300">
                      Ámbito de Configuración
                    </span>
                    {!tienePermisoEditar && (
                      <span className="rounded bg-rose-950/80 border border-rose-500/40 px-2 py-0.5 text-[10px] font-bold text-rose-300">
                        🔒 Solo lectura (acceso restringido al dueño o admin principal)
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400">
                    {esAdmin
                      ? "Como Administrador Principal, puede configurar parámetros generales para todos los grupos o personalizarlo para un grupo particular."
                      : "Como dueño del grupo, puede personalizar los incentivos y rangos para su grupo."}
                  </p>
                </div>

                {esAdmin && gruposDisponibles.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-300">Grupo:</span>
                    <select
                      value={grupoConfigId}
                      onChange={(e) => setGrupoConfigId(e.target.value)}
                      className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-bold text-amber-300 outline-none focus:border-amber-400"
                    >
                      <option value="global">🌐 General / Mínimo para Todos los Grupos</option>
                      {gruposDisponibles.map((g) => (
                        <option key={String(g.id)} value={String(g.id)}>
                          🏢 {g.nombre}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {configCargando ? (
                <div className="p-8 text-center text-xs text-slate-400">Cargando configuración...</div>
              ) : (
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                  {/* Columna Izquierda: Opciones de Incentivos */}
                  <div className="space-y-5 lg:col-span-7">
                    {/* Switch general y Tabla Venezuela */}
                    <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-xs font-black uppercase text-slate-200">
                            Activar Incentivos a los Dividendos
                          </h4>
                          <p className="text-[11px] text-slate-400">
                            Suma incentivos por escalón de precio o monto fijo al dividendo final de Win, Place o Show.
                          </p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={config.activo}
                            disabled={!tienePermisoEditar}
                            onChange={(e) => setConfig((p) => ({ ...p, activo: e.target.checked }))}
                            className="sr-only peer"
                          />
                          <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
                        </label>
                      </div>

                      <div className="border-t border-slate-800/80 pt-3 flex items-center justify-between">
                        <div>
                          <h4 className="text-xs font-black uppercase text-sky-300">
                            Aplicar Tabla Oficial Venezuela (Boleto 100,00 Bs)
                          </h4>
                          <p className="text-[11px] text-slate-400">
                            Permite leer dividendos en formato tradicional INH (1-9, 3-2, 5-2, enteros N a 1, Bs. 250).
                          </p>
                        </div>
                        <input
                          type="checkbox"
                          checked={config.aplicarTablaVenezuela}
                          disabled={!tienePermisoEditar}
                          onChange={(e) => setConfig((p) => ({ ...p, aplicarTablaVenezuela: e.target.checked }))}
                          className="h-5 w-5 rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-sky-400 cursor-pointer"
                        />
                      </div>
                    </div>

                    {/* Suma fija adicional */}
                    <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-3">
                      <h4 className="text-xs font-black uppercase text-amber-300">
                        Incentivo de Suma Fija por Modalidad
                      </h4>
                      <p className="text-[11px] text-slate-400">
                        Monto fijo que se suma directamente al dividendo calculado (ej: +0.20 o +0.50).
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="rounded-lg border border-slate-800 bg-slate-900 p-2.5">
                          <label className="text-[10px] font-black uppercase text-amber-400 block mb-1">
                            🥇 Win (+X)
                          </label>
                          <input
                            type="number"
                            step="0.05"
                            min="0"
                            value={config.sumaFijaWin}
                            disabled={!tienePermisoEditar}
                            onChange={(e) =>
                              setConfig((p) => ({ ...p, sumaFijaWin: parseFloat(e.target.value) || 0 }))
                            }
                            className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs font-bold text-white focus:border-amber-400 focus:outline-none"
                          />
                        </div>

                        <div className="rounded-lg border border-slate-800 bg-slate-900 p-2.5">
                          <label className="text-[10px] font-black uppercase text-sky-400 block mb-1">
                            🥈 Place (+X)
                          </label>
                          <input
                            type="number"
                            step="0.05"
                            min="0"
                            value={config.sumaFijaPlace}
                            disabled={!tienePermisoEditar}
                            onChange={(e) =>
                              setConfig((p) => ({ ...p, sumaFijaPlace: parseFloat(e.target.value) || 0 }))
                            }
                            className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs font-bold text-white focus:border-sky-400 focus:outline-none"
                          />
                        </div>

                        <div className="rounded-lg border border-slate-800 bg-slate-900 p-2.5">
                          <label className="text-[10px] font-black uppercase text-emerald-400 block mb-1">
                            🥉 Show (+X)
                          </label>
                          <input
                            type="number"
                            step="0.05"
                            min="0"
                            value={config.sumaFijaShow}
                            disabled={!tienePermisoEditar}
                            onChange={(e) =>
                              setConfig((p) => ({ ...p, sumaFijaShow: parseFloat(e.target.value) || 0 }))
                            }
                            className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs font-bold text-white focus:border-emerald-400 focus:outline-none"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Rangos de precios de incentivos (Escalones / Llévalo a) */}
                    <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-xs font-black uppercase text-indigo-300">
                            Rangos de Precios de Incentivos (Escalones)
                          </h4>
                          <p className="text-[11px] text-slate-400">
                            Ejemplo: de 2,10 a 2,50 llévalo a 2,50 · de 2,51 a 3,00 llévalo a 3,00 · de 3,01 a 3,50 llévalo a 3,50.
                          </p>
                        </div>
                        {tienePermisoEditar && (
                          <button
                            type="button"
                            onClick={agregarRango}
                            className="inline-flex items-center gap-1 rounded-lg bg-indigo-600/30 border border-indigo-400/40 px-2.5 py-1 text-xs font-bold text-indigo-200 hover:bg-indigo-600/50"
                          >
                            <span>+</span> Agregar Rango
                          </button>
                        )}
                      </div>

                      <div className="space-y-2">
                        {config.rangos.map((r, i) => (
                          <div
                            key={r.id || i}
                            className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 p-2 text-xs"
                          >
                            <span className="text-[10px] font-bold text-slate-500 font-mono w-4">{i + 1}.</span>
                            <span className="text-slate-400 text-[11px]">De</span>
                            <input
                              type="number"
                              step="0.01"
                              value={r.min}
                              disabled={!tienePermisoEditar}
                              onChange={(e) => actualizarRango(i, "min", parseFloat(e.target.value) || 0)}
                              className="w-16 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-mono text-xs font-bold text-white"
                            />
                            <span className="text-slate-400 text-[11px]">a</span>
                            <input
                              type="number"
                              step="0.01"
                              value={r.max}
                              disabled={!tienePermisoEditar}
                              onChange={(e) => actualizarRango(i, "max", parseFloat(e.target.value) || 0)}
                              className="w-16 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-mono text-xs font-bold text-white"
                            />
                            <span className="text-amber-400 font-bold text-[11px]">→ Llévalo a:</span>
                            <input
                              type="number"
                              step="0.01"
                              value={r.llevarA ?? r.max}
                              disabled={!tienePermisoEditar}
                              onChange={(e) => actualizarRango(i, "llevarA", parseFloat(e.target.value) || 0)}
                              className="w-16 rounded border border-amber-500/50 bg-slate-950 px-1.5 py-0.5 font-mono text-xs font-black text-amber-300"
                            />

                            {tienePermisoEditar && (
                              <button
                                type="button"
                                onClick={() => eliminarRango(i)}
                                className="ml-auto text-xs text-slate-500 hover:text-rose-400 p-1"
                                title="Eliminar rango"
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Boton guardar */}
                    {tienePermisoEditar && (
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={handleGuardarConfig}
                          disabled={cargandoGuardar}
                          className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2 text-xs font-black text-white shadow-lg hover:bg-indigo-500 disabled:opacity-50 transition"
                        >
                          {cargandoGuardar ? "Guardando..." : "💾 Guardar Configuración de Incentivos"}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Columna Derecha: Calculadora / Simulador en Tiempo Real */}
                  <div className="space-y-4 lg:col-span-5">
                    <div className="rounded-xl border border-indigo-500/30 bg-gradient-to-b from-indigo-950/40 to-slate-950 p-4 space-y-4 shadow-xl">
                      <div className="flex items-center gap-2 border-b border-indigo-800/40 pb-2">
                        <span className="text-lg">🧮</span>
                        <h4 className="text-xs font-black uppercase tracking-wider text-amber-400">
                          Calculadora de Pago con Incentivos
                        </h4>
                      </div>

                      <div className="space-y-3">
                        <div>
                          <label className="text-[10px] font-black uppercase text-slate-300 block mb-1">
                            Dividendo Base (decimal, fracción "3-2" o "Bs. 250")
                          </label>
                          <input
                            type="text"
                            value={simDividendoBase}
                            onChange={(e) => setSimDividendoBase(e.target.value)}
                            placeholder="ej. 2.20 ó 3-2 ó 250"
                            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 font-mono text-xs font-bold text-amber-300 focus:border-indigo-400 focus:outline-none"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-[10px] font-black uppercase text-slate-300 block mb-1">
                              Monto en Riesgo ($)
                            </label>
                            <input
                              type="number"
                              min="1"
                              value={simMonto}
                              onChange={(e) => setSimMonto(e.target.value)}
                              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 font-mono text-xs font-bold text-white focus:border-indigo-400 focus:outline-none"
                            />
                          </div>

                          <div>
                            <label className="text-[10px] font-black uppercase text-slate-300 block mb-1">
                              Modalidad
                            </label>
                            <select
                              value={simModalidad}
                              onChange={(e) => setSimModalidad(e.target.value as "W" | "P" | "S")}
                              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 font-bold text-xs text-white"
                            >
                              <option value="W">🥇 Win (Ganador)</option>
                              <option value="P">🥈 Place (Segundo)</option>
                              <option value="S">🥉 Show (Tercero)</option>
                            </select>
                          </div>
                        </div>

                        {/* Desglose del resultado simulado */}
                        <div className="rounded-lg border border-slate-800 bg-slate-900/90 p-3 space-y-2 text-xs">
                          <div className="flex justify-between items-center text-slate-400">
                            <span>Dividendo Base Oficial:</span>
                            <span className="font-mono font-bold text-slate-200">
                              {simulacionResultado.dividendoBase.toFixed(2)}x
                            </span>
                          </div>

                          <div className="flex justify-between items-center text-indigo-300">
                            <span>Incentivo del Grupo (+):</span>
                            <span className="font-mono font-black text-amber-400">
                              +{simulacionResultado.incentivoTotal.toFixed(2)}
                            </span>
                          </div>

                          <div className="flex justify-between items-center text-slate-200 border-t border-slate-800 pt-1.5">
                            <span className="font-bold">Dividendo Final Aplicado:</span>
                            <span className="font-mono text-sm font-black text-emerald-400">
                              {simulacionResultado.dividendoFinal.toFixed(2)}x
                            </span>
                          </div>

                          <div className="rounded bg-indigo-950/60 p-2 text-[10px] text-indigo-200 font-mono">
                            📌 Regla: {simulacionResultado.reglaAplicada}
                          </div>

                          <div className="border-t border-slate-800 pt-2 space-y-1">
                            <div className="flex justify-between items-center">
                              <span className="text-[11px] font-bold text-slate-300">Total Pago al Jugador:</span>
                              <span className="font-mono text-base font-black text-amber-400">
                                ${simulacionResultado.pagoTotal.toFixed(2)}
                              </span>
                            </div>
                            <div className="flex justify-between items-center text-[10px] text-emerald-400">
                              <span>Ganancia neta:</span>
                              <span className="font-mono font-bold">+${simulacionResultado.gananciaNeta.toFixed(2)}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* PESTAÑA 3: TABLA VENEZUELA (BOLETO 100 BS) */}
          {pestana === "tabla_ve" && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-gradient-to-r from-sky-900 via-blue-900 to-indigo-900 p-4 text-white shadow-lg">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">🇻🇪</span>
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-wide text-sky-200">
                      ¿Cuánto paga su ejemplar?
                    </h3>
                    <h2 className="text-lg font-extrabold text-white">
                      VALOR DEL BOLETO 100,00 BS. (Tabla Oficial INH)
                    </h2>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={filtroTablaVe}
                    onChange={(e) => setFiltroTablaVe(e.target.value)}
                    placeholder="Buscar: 3-2, 5-2, 25, 250..."
                    className="rounded-lg border border-sky-400/40 bg-slate-900/80 px-3 py-1.5 text-xs text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-400"
                  />
                </div>
              </div>

              {/* Grid representativo de la imagen */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                {/* Columna 1: Fracciones */}
                <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 space-y-1.5">
                  <div className="bg-sky-900/40 text-sky-300 font-black text-[10px] uppercase tracking-wider p-1 rounded text-center">
                    Fracciones INH
                  </div>
                  <div className="divide-y divide-slate-800">
                    {TABLA_VENEZUELA_FRACCIONES.filter(
                      (f) =>
                        !filtroTablaVe ||
                        f.clave.includes(filtroTablaVe) ||
                        String(f.montoBs).includes(filtroTablaVe)
                    ).map((f) => (
                      <div key={f.clave} className="flex justify-between py-1 px-1 font-mono hover:bg-slate-900">
                        <span className="font-bold text-amber-300">{f.clave}</span>
                        <span className="text-slate-300">Bs. {f.montoBs.toFixed(2)}</span>
                        <span className="font-bold text-emerald-400">{f.factorDecimal.toFixed(2)}x</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Columna 2: Proporciones 1 a 24 */}
                <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 space-y-1.5">
                  <div className="bg-sky-900/40 text-sky-300 font-black text-[10px] uppercase tracking-wider p-1 rounded text-center">
                    Proporciones 1 a 24
                  </div>
                  <div className="divide-y divide-slate-800 max-h-80 overflow-y-auto">
                    {Array.from({ length: 24 }, (_, i) => i + 1)
                      .filter(
                        (n) =>
                          !filtroTablaVe ||
                          String(n).includes(filtroTablaVe) ||
                          String((n + 1) * 100).includes(filtroTablaVe)
                      )
                      .map((n) => (
                        <div key={n} className="flex justify-between py-1 px-1 font-mono hover:bg-slate-900">
                          <span className="font-bold text-slate-300">{n}</span>
                          <span className="text-slate-400">Bs. {((n + 1) * 100).toFixed(2)}</span>
                          <span className="font-bold text-emerald-400">{(n + 1).toFixed(2)}x</span>
                        </div>
                      ))}
                  </div>
                </div>

                {/* Columna 3: Proporciones 25 a 43 */}
                <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 space-y-1.5">
                  <div className="bg-sky-900/40 text-sky-300 font-black text-[10px] uppercase tracking-wider p-1 rounded text-center">
                    Proporciones 25 a 43
                  </div>
                  <div className="divide-y divide-slate-800 max-h-80 overflow-y-auto">
                    {Array.from({ length: 19 }, (_, i) => i + 25)
                      .filter(
                        (n) =>
                          !filtroTablaVe ||
                          String(n).includes(filtroTablaVe) ||
                          String((n + 1) * 100).includes(filtroTablaVe)
                      )
                      .map((n) => (
                        <div key={n} className="flex justify-between py-1 px-1 font-mono hover:bg-slate-900">
                          <span className="font-bold text-slate-300">{n}</span>
                          <span className="text-slate-400">Bs. {((n + 1) * 100).toFixed(2)}</span>
                          <span className="font-bold text-emerald-400">{(n + 1).toFixed(2)}x</span>
                        </div>
                      ))}
                  </div>
                </div>

                {/* Columna 4: Proporciones 44 a 99 */}
                <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 space-y-1.5">
                  <div className="bg-sky-900/40 text-sky-300 font-black text-[10px] uppercase tracking-wider p-1 rounded text-center">
                    Proporciones 44 a 99
                  </div>
                  <div className="divide-y divide-slate-800 max-h-80 overflow-y-auto">
                    {[44, 45, 46, 47, 48, 49, 50, 59, 60, 69, 70, 79, 80, 89, 90, 94, 99]
                      .filter(
                        (n) =>
                          !filtroTablaVe ||
                          String(n).includes(filtroTablaVe) ||
                          String((n + 1) * 100).includes(filtroTablaVe)
                      )
                      .map((n) => (
                        <div key={n} className="flex justify-between py-1 px-1 font-mono hover:bg-slate-900">
                          <span className="font-bold text-slate-300">{n}</span>
                          <span className="text-slate-400">Bs. {((n + 1) * 100).toFixed(2)}</span>
                          <span className="font-bold text-emerald-400">{(n + 1).toFixed(2)}x</span>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Pie del modal */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 bg-slate-950 px-5 py-3 text-xs text-slate-400">
          <div>
            Modalidad <strong className="text-amber-400">WPS (Win · Place · Show)</strong> · Liquidación matemática unificada con incentivos
          </div>
          <button
            type="button"
            onClick={onCerrar}
            className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-700 hover:text-white"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

export default ModalWpsApuestas;
