"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { Button } from "@/shared/components/ui/Button";
import { supabase } from "@/core/supabase";
import { hoyLocal } from "@/features/gaceta/lib/programa";
import { normalizarFechaIso, type CarreraRegistro } from "@/features/gaceta/lib/ui";
import { listarCarrerasCentrales, type CarreraCentral } from "@/features/carreras/lib/central";
import { publicarTablasLote } from "@/features/tablas/lib/rpc";
import type { TablaFijaRow } from "@/features/tablas/lib/tablas-fijas";
import { guardarConfigMarcas, listarConfigMarcas, type GuardarConfigMarcas, type ConfigMarcas } from "@/features/marcas/lib/marcas";
import { claveHipodromo } from "@/features/carreras/lib/claves";
import { emitirToast } from "@/shared/lib/mensajeria";
import { useRouter } from "next/navigation";

import {
  listarJornadasEnBD,
  generarTablasDesdeCarrerasCentrales,
  generarConfigMarcasPorDefecto,
  carreraCentralACarreraRegistro,
  type JornadaRegistrada,
} from "@/features/ejemplares/lib/tablas-marcas-desde-bd";

export {
  listarJornadasEnBD,
  generarTablasDesdeCarrerasCentrales,
  generarConfigMarcasPorDefecto,
  carreraCentralACarreraRegistro,
  type JornadaRegistrada,
};

export interface ModalGenerarTablasYMarcasProps {
  abierto: boolean;
  onCerrar: () => void;
  fechaInicial?: string;
  hipodromoInicial?: string;
  onCargarAlEditor?: (carreras: CarreraRegistro[]) => void;
}

export function ModalGenerarTablasYMarcas({
  abierto,
  onCerrar,
  fechaInicial,
  hipodromoInicial,
  onCargarAlEditor,
}: ModalGenerarTablasYMarcasProps) {
  const router = useRouter();

  const [fecha, setFecha] = useState<string>(() => fechaInicial || hoyLocal());
  const [hipodromoFiltro, setHipodromoFiltro] = useState<string>(() => hipodromoInicial || "");
  const [jornadasBD, setJornadasBD] = useState<JornadaRegistrada[]>([]);
  const [cargandoJornadas, setCargandoJornadas] = useState(false);

  const [carreras, setCarreras] = useState<CarreraCentral[]>([]);
  const [cargandoCarreras, setCargandoCarreras] = useState(false);
  const [seleccionadas, setSeleccionadas] = useState<Set<number>>(new Set());

  // Configuraciones editables por carrera para Marcas
  const [marcasConfig, setMarcasConfig] = useState<Record<number, { marcas: string; nv: string; estado: string }>>({});

  // Tablas existentes y Marcas existentes en la BD
  const [tablasExistentes, setTablasExistentes] = useState<Set<number>>(new Set());
  const [marcasExistentes, setMarcasExistentes] = useState<Map<number, ConfigMarcas>>(new Map());

  // Estado de procesamiento
  const [procesando, setProcesando] = useState(false);
  const [resultadoOperacion, setResultadoOperacion] = useState<{
    tablasOk: number;
    marcasOk: number;
    errores: string[];
  } | null>(null);

  // Cargar lista de jornadas disponibles en la BD al abrir
  useEffect(() => {
    if (!abierto) return;
    setCargandoJornadas(true);
    void listarJornadasEnBD()
      .then((items) => {
        setJornadasBD(items);
        if (items.length > 0 && !fechaInicial) {
          setFecha(items[0].fecha);
          if (!hipodromoInicial) setHipodromoFiltro(items[0].hipodromo);
        }
      })
      .finally(() => setCargandoJornadas(false));
  }, [abierto, fechaInicial, hipodromoInicial]);

  // Cargar carreras para la fecha e hipódromo seleccionados
  const consultarCarreras = useCallback(async (f = fecha, hip = hipodromoFiltro) => {
    if (!f) return;
    setCargandoCarreras(true);
    setResultadoOperacion(null);
    try {
      const res = await listarCarrerasCentrales(f, hip);
      const lista = res.ok && res.datos ? res.datos : [];
      setCarreras(lista);

      // Por defecto seleccionar todas las carreras
      const sel = new Set<number>();
      const configs: Record<number, { marcas: string; nv: string; estado: string }> = {};

      lista.forEach((c) => {
        sel.add(c.carrera);
        const cfgDefecto = generarConfigMarcasPorDefecto(c);
        configs[c.carrera] = {
          marcas: cfgDefecto.marcas,
          nv: cfgDefecto.nv,
          estado: cfgDefecto.estado || "Abierta",
        };
      });

      setSeleccionadas(sel);
      setMarcasConfig(configs);

      // Consultar qué carreras ya tienen marcas en marcas_carrera
      const configsGuardadas = await listarConfigMarcas({ dia: f, hipodromo: hip || undefined });
      const mapaMarcas = new Map<number, ConfigMarcas>();
      configsGuardadas.forEach((mc) => {
        mapaMarcas.set(mc.carrera, mc);
        // Si ya tenía marcas guardadas, reflejar lo guardado en el editor
        if (configs[mc.carrera]) {
          configs[mc.carrera] = {
            marcas: mc.marcas,
            nv: mc.nv,
            estado: mc.estado,
          };
        }
      });
      setMarcasExistentes(mapaMarcas);

      // Consultar qué carreras ya tienen tablas_fijas publicadas
      if (supabase) {
        let q = supabase.from("tablas_fijas").select("carrera").eq("fecha", f);
        if (hip) q = q.ilike("hipodromo", hip);
        const { data: tablasData } = await q;
        const setT = new Set<number>();
        (tablasData ?? []).forEach((t: { carrera?: unknown }) => {
          if (t.carrera != null) setT.add(Number(t.carrera));
        });
        setTablasExistentes(setT);
      }
    } catch (e) {
      console.warn("Error consultando carreras en BD:", e);
      emitirToast(`Error consultando carreras: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setCargandoCarreras(false);
    }
  }, [fecha, hipodromoFiltro]);

  // Ejecutar consulta inicial cuando cambia fecha o hipódromo
  useEffect(() => {
    if (abierto && fecha) {
      void consultarCarreras(fecha, hipodromoFiltro);
    }
  }, [abierto, fecha, hipodromoFiltro, consultarCarreras]);

  const toggleSeleccion = (carreraNum: number) => {
    setSeleccionadas((prev) => {
      const next = new Set(prev);
      if (next.has(carreraNum)) next.delete(carreraNum);
      else next.add(carreraNum);
      return next;
    });
  };

  const seleccionarTodas = () => {
    setSeleccionadas(new Set(carreras.map((c) => c.carrera)));
  };

  const deseleccionarTodas = () => {
    setSeleccionadas(new Set());
  };

  // Acción Principal: Crear / Publicar Tablas Fijas y Marcas
  const handleCrearTablasYMarcas = async () => {
    if (seleccionadas.size === 0) {
      emitirToast("Selecciona al menos una carrera para generar Tablas Fijas y Marcas.", "warning");
      return;
    }

    setProcesando(true);
    setResultadoOperacion(null);
    const errores: string[] = [];

    const carrerasFiltradas = carreras.filter((c) => seleccionadas.has(c.carrera));

    // 1. Generar y Publicar Tablas Fijas
    let tablasOk = 0;
    try {
      const tablasLote = generarTablasDesdeCarrerasCentrales(carrerasFiltradas, fecha);
      const resTablas = await publicarTablasLote(tablasLote);
      tablasOk = resTablas.okCount;
      if (resTablas.errores && resTablas.errores.length > 0) {
        resTablas.errores
          .filter((err) => !err.publicada)
          .forEach((err) => errores.push(`C${err.carrera} Tablas: ${err.error}`));
      }
    } catch (e) {
      errores.push(`Tablas: ${e instanceof Error ? e.message : String(e)}`);
    }

    // 2. Guardar y Activar Marcas
    let marcasOk = 0;
    for (const c of carrerasFiltradas) {
      const cfgUser = marcasConfig[c.carrera] || { marcas: "", nv: "", estado: "Abierta" };
      const configParaGuardar = generarConfigMarcasPorDefecto(
        c,
        cfgUser.marcas,
        cfgUser.nv,
        cfgUser.estado
      );

      try {
        const resMarca = await guardarConfigMarcas(configParaGuardar);
        if (resMarca.ok) {
          marcasOk++;
        } else {
          errores.push(`C${c.carrera} Marcas: ${resMarca.error ?? "No se pudo guardar"}`);
        }
      } catch (eMarca) {
        errores.push(`C${c.carrera} Marcas: ${eMarca instanceof Error ? eMarca.message : String(eMarca)}`);
      }
    }

    setProcesando(false);
    setResultadoOperacion({
      tablasOk,
      marcasOk,
      errores,
    });

    if (tablasOk > 0 || marcasOk > 0) {
      emitirToast(
        `✅ Publicadas ${tablasOk} Tablas Fijas y configuradas ${marcasOk} carreras en Marcas para el día ${fecha}.`,
        "success"
      );
      // Refrescar indicadores
      void consultarCarreras(fecha, hipodromoFiltro);
    } else {
      emitirToast(`No se pudo completar la publicación: ${errores.join(", ")}`, "error");
    }
  };

  // Cargar directamente las carreras seleccionadas al editor de Gaceta
  const handleCargarAlEditor = () => {
    if (seleccionadas.size === 0) {
      emitirToast("Selecciona al menos una carrera para cargar al editor.", "warning");
      return;
    }
    const seleccion = carreras
      .filter((c) => seleccionadas.has(c.carrera))
      .map(carreraCentralACarreraRegistro);

    if (onCargarAlEditor) {
      onCargarAlEditor(seleccion);
      emitirToast(`📥 Se cargaron ${seleccion.length} carreras al editor de Gaceta.`, "success");
      onCerrar();
    }
  };

  if (!abierto) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 sm:p-5 backdrop-blur-xs animate-in fade-in duration-150"
    >
      <div className="flex flex-col w-full max-w-4xl max-h-[92vh] overflow-hidden rounded-2xl border border-indigo-500/40 bg-white shadow-2xl">
        {/* ENCABEZADO */}
        <div className="flex items-center justify-between border-b border-indigo-100 bg-gradient-to-r from-indigo-900 via-indigo-800 to-slate-900 px-5 py-4 text-white">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-2xl shadow-inner">
              🎯
            </span>
            <div>
              <h2 className="text-base font-black uppercase tracking-wide">
                Generador de Tablas Fijas y Marcas desde BD
              </h2>
              <p className="text-xs text-indigo-200">
                Selecciona carreras ya cargadas en el sistema para publicar sus Tablas de apuestas y habilitar sus Marcas al instante.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            className="rounded-lg p-1.5 text-indigo-200 hover:bg-white/10 hover:text-white transition-colors"
            title="Cerrar ventana"
          >
            ✕
          </button>
        </div>

        {/* BARRA DE JORNADAS DETECTADAS EN BD */}
        <div className="border-b border-slate-200 bg-slate-50 px-5 py-2.5">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              📅 Jornadas detectadas con carreras en Base de Datos:
            </span>
            {cargandoJornadas && (
              <span className="text-[10px] text-indigo-600 animate-pulse font-semibold">
                Consultando jornadas…
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 max-h-20 overflow-y-auto">
            {jornadasBD.length === 0 && !cargandoJornadas && (
              <span className="text-xs text-slate-400 italic">No hay jornadas registradas aún.</span>
            )}
            {jornadasBD.slice(0, 10).map((j, idx) => {
              const activa = j.fecha === fecha && (hipodromoFiltro === "" || claveHipodromo(j.hipodromo) === claveHipodromo(hipodromoFiltro));
              return (
                <button
                  key={`${j.fecha}-${j.hipodromo}-${idx}`}
                  type="button"
                  onClick={() => {
                    setFecha(j.fecha);
                    setHipodromoFiltro(j.hipodromo);
                  }}
                  className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
                    activa
                      ? "bg-indigo-600 text-white shadow-xs ring-2 ring-indigo-400"
                      : "bg-white text-slate-700 border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50"
                  }`}
                >
                  🏇 {j.hipodromo} · <span className="font-mono">{j.fecha}</span> ({j.totalCarreras} carrs)
                </button>
              );
            })}
          </div>
        </div>

        {/* FILTRO MANUAL DE FECHA E HIPÓDROMO */}
        <div className="border-b border-slate-200 bg-white px-5 py-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Fecha de la Carrera / Jornada
            </label>
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Hipódromo (Opcional)
            </label>
            <input
              type="text"
              placeholder="Ej: LA RINCONADA, VALENCIA"
              value={hipodromoFiltro}
              onChange={(e) => setHipodromoFiltro(e.target.value.toUpperCase())}
              className="w-48 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold uppercase text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <Button
            variant="default"
            size="sm"
            onClick={() => void consultarCarreras(fecha, hipodromoFiltro)}
            disabled={cargandoCarreras || !fecha}
            className="bg-indigo-600 hover:bg-indigo-700"
          >
            {cargandoCarreras ? "Consultando…" : "🔍 Consultar Carreras"}
          </Button>

          {carreras.length > 0 && (
            <div className="ml-auto flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={seleccionarTodas}>
                Seleccionar Todas ({carreras.length})
              </Button>
              <Button variant="ghost" size="sm" onClick={deseleccionarTodas}>
                Ninguna
              </Button>
            </div>
          )}
        </div>

        {/* RESULTADO DE LA ÚLTIMA OPERACIÓN */}
        {resultadoOperacion && (
          <div
            className={`border-b px-5 py-3 text-xs ${
              resultadoOperacion.errores.length === 0
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-amber-200 bg-amber-50 text-amber-900"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">
                  {resultadoOperacion.errores.length === 0 ? "🎉" : "⚠️"}
                </span>
                <div>
                  <p className="font-bold">
                    Operación Completada: {resultadoOperacion.tablasOk} Tablas Fijas Publicadas · {resultadoOperacion.marcasOk} Carreras con Marcas Activas
                  </p>
                  {resultadoOperacion.errores.length > 0 && (
                    <p className="text-[11px] text-red-700 mt-0.5">
                      Avisos: {resultadoOperacion.errores.join(" | ")}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => router.push("/tablas-fijas")}
                  className="bg-white border-emerald-300 text-emerald-800 hover:bg-emerald-100"
                >
                  📋 Ver Tablas Fijas
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => router.push("/marcas")}
                  className="bg-indigo-600 text-white hover:bg-indigo-700"
                >
                  🎯 Ir a Marcas
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* LISTADO DE CARRERAS Y EJEMPLARES */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3 bg-slate-50/50">
          {cargandoCarreras ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-500">
              <span className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600 mb-3" />
              <p className="text-sm font-bold">Consultando carreras y ejemplares en la Base de Datos…</p>
            </div>
          ) : carreras.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
              <span className="text-4xl">📭</span>
              <p className="mt-2 text-sm font-black text-slate-700">
                No se encontraron carreras guardadas para la fecha {fecha} {hipodromoFiltro ? `(${hipodromoFiltro})` : ""}
              </p>
              <p className="mt-1 text-xs text-slate-500 max-w-md mx-auto">
                Verifica la fecha seleccionada o pulsa una de las jornadas detectadas arriba. También puedes subir la gaceta en el módulo principal para cargar las carreras.
              </p>
            </div>
          ) : (
            carreras.map((c) => {
              const num = Number(c.carrera);
              const sel = seleccionadas.has(num);
              const tieneTabla = tablasExistentes.has(num);
              const tieneMarca = marcasExistentes.has(num);
              const cfgMarca = marcasConfig[num] || { marcas: "", nv: "", estado: "Abierta" };
              const caballos = c.caballos || [];

              return (
                <div
                  key={`${c.hipodromo}-${c.fecha}-${num}`}
                  className={`rounded-xl border transition-all ${
                    sel
                      ? "border-indigo-400 bg-white shadow-sm ring-1 ring-indigo-300"
                      : "border-slate-200 bg-slate-100/70 opacity-75"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between border-b border-slate-100 bg-slate-50/80 px-4 py-2.5 gap-2">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={sel}
                        onChange={() => toggleSeleccion(num)}
                        className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                      />
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-700 text-xs font-black text-white">
                        {num}
                      </span>
                      <div>
                        <span className="text-xs font-black uppercase text-slate-800">
                          Carrera {num} · {c.hipodromo}
                        </span>
                        <div className="flex items-center gap-2 text-[10px] text-slate-500">
                          {c.distancia ? <span>📏 {c.distancia}m</span> : null}
                          {c.superficie ? <span>🏜️ {c.superficie}</span> : null}
                          {c.premio ? <span>💰 ${c.premio}</span> : null}
                          <span>🐴 {caballos.length} ejemplares</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          tieneTabla
                            ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                            : "bg-slate-100 text-slate-600 border border-slate-200"
                        }`}
                        title={tieneTabla ? "Tabla Fija ya publicada en BD" : "Sin Tabla Fija publicada"}
                      >
                        {tieneTabla ? "✓ Tabla Fija en BD" : "Pendiente Tabla"}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          tieneMarca
                            ? "bg-indigo-100 text-indigo-800 border border-indigo-300"
                            : "bg-slate-100 text-slate-600 border border-slate-200"
                        }`}
                        title={tieneMarca ? "Marcas ya configuradas en BD" : "Sin configuración de Marcas"}
                      >
                        {tieneMarca ? "✓ Marcas en BD" : "Pendiente Marcas"}
                      </span>
                    </div>
                  </div>

                  {/* EJEMPLARES DE LA CARRERA */}
                  <div className="px-4 py-2.5">
                    <div className="mb-2 flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                      {caballos.map((cb) => (
                        <span
                          key={cb.numero}
                          className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-mono border ${
                            cb.retirado
                              ? "border-red-200 bg-red-50 text-red-700 line-through"
                              : "border-slate-200 bg-slate-50 text-slate-800"
                          }`}
                        >
                          <b className="font-black text-indigo-700">{cb.numero}</b>
                          <span className="font-sans text-[10px] uppercase">{cb.nombre || "EJEMPLAR"}</span>
                          {cb.jockey && <span className="text-[9px] text-slate-400">({cb.jockey})</span>}
                        </span>
                      ))}
                    </div>

                    {/* CONFIGURACIÓN DE MARCAS PARA ESTA CARRERA */}
                    {sel && (
                      <div className="mt-2.5 grid grid-cols-1 md:grid-cols-3 gap-2.5 rounded-lg border border-indigo-100 bg-indigo-50/40 p-2.5">
                        <div>
                          <label className="block text-[10px] font-bold uppercase text-indigo-900 mb-0.5">
                            🎯 Marcas (Favoritos en orden, separados por /)
                          </label>
                          <input
                            type="text"
                            value={cfgMarca.marcas}
                            onChange={(e) =>
                              setMarcasConfig((prev) => ({
                                ...prev,
                                [num]: { ...cfgMarca, marcas: e.target.value },
                              }))
                            }
                            placeholder="Ej: 1/2/3/4"
                            className="w-full rounded border border-indigo-300 bg-white px-2 py-1 text-xs font-mono font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] font-bold uppercase text-indigo-900 mb-0.5">
                            🚫 NV (No Válidos / Retirados)
                          </label>
                          <input
                            type="text"
                            value={cfgMarca.nv}
                            onChange={(e) =>
                              setMarcasConfig((prev) => ({
                                ...prev,
                                [num]: { ...cfgMarca, nv: e.target.value },
                              }))
                            }
                            placeholder="Ej: 5/9"
                            className="w-full rounded border border-indigo-300 bg-white px-2 py-1 text-xs font-mono font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] font-bold uppercase text-indigo-900 mb-0.5">
                            Estado Comercial Marcas
                          </label>
                          <select
                            value={cfgMarca.estado}
                            onChange={(e) =>
                              setMarcasConfig((prev) => ({
                                ...prev,
                                [num]: { ...cfgMarca, estado: e.target.value },
                              }))
                            }
                            className="w-full rounded border border-indigo-300 bg-white px-2 py-1 text-xs font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          >
                            <option value="Abierta">Abierta (Disponible para jugar)</option>
                            <option value="Cerrada">Cerrada</option>
                          </select>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* PIE DE ACCIONES */}
        <div className="flex flex-wrap items-center justify-between border-t border-slate-200 bg-slate-50 px-5 py-3.5 gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-700">
              {seleccionadas.size} de {carreras.length} carrera(s) seleccionada(s)
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={onCerrar}>
              Cerrar
            </Button>

            {onCargarAlEditor && carreras.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleCargarAlEditor}
                disabled={procesando || seleccionadas.size === 0}
                className="border-slate-300 text-slate-700 hover:bg-slate-100 font-bold"
                title="Carga las carreras seleccionadas en la pantalla del Editor de Gaceta para revisarlas"
              >
                📥 Cargar al Editor de Gaceta
              </Button>
            )}

            <Button
              variant="default"
              size="sm"
              onClick={() => void handleCrearTablasYMarcas()}
              disabled={procesando || seleccionadas.size === 0}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-black shadow-sm"
              title="Crea y publica las tablas fijas en Supabase y guarda las configuraciones en marcas_carrera"
            >
              {procesando ? (
                <>
                  <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Publicando…
                </>
              ) : (
                `🚀 Publicar Tablas Fijas y Marcas (${seleccionadas.size})`
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ModalGenerarTablasYMarcas;
