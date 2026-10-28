"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { getHorseColor } from "@/shared/lib/horseColors";
import { nombreHipodromoParaMostrar } from "@/features/hipodromos/lib/nombre";
import { hoyLocal } from "@/features/gaceta/lib/programa";
import type { SesionPortal } from "@/features/portal/lib/portal";
import {
  listarConfigMarcas,
  PROPORCION,
  separarNumeros,
  type ConfigMarcas,
} from "@/features/marcas/lib/marcas";
import { ModalCompraMarcasCliente } from "@/features/portal/components/ModalCompraMarcasCliente";
import { esMarcaActivaEnPortal } from "@/features/portal/lib/control-activas-portal";
import { useRegistroCentralOpts } from "@/shared/store/useRegistroCentral";
import { type CarreraCentral } from "@/features/carreras/lib/central";

type Props = {
  sesion: SesionPortal;
  bloqueada?: boolean;
  onPedirDesbloqueo?: (hipodromo?: string, carrera?: number) => Promise<void>;
  onRealizada?: () => Promise<void> | void;
};

const chipCls =
  "inline-flex h-[19px] shrink-0 items-center justify-center rounded-[3px] border px-[5px] text-[13px] font-bold leading-none tabular-nums";
const sepCls = "border-l border-line";

export function MonitorMarcasCliente({
  sesion,
  bloqueada,
  onPedirDesbloqueo,
  onRealizada,
}: Props) {
  const [fecha, setFecha] = useState(() => hoyLocal());
  const [configs, setConfigs] = useState<ConfigMarcas[]>([]);
  const [cargando, setCargando] = useState(false);
  const [hipodromoFiltro, setHipodromoFiltro] = useState<string>("TODOS");

  // Modal de compra de marcas
  const [carreraCompra, setCarreraCompra] = useState<{
    hipodromo: string;
    carrera: number;
    fecha: string;
    cfg: ConfigMarcas;
    caballos?: Array<{ numero: number | string; nombre: string; retirado?: boolean }>;
  } | null>(null);

  // Obtener carreras del central para traer nombres de caballos
  const { carreras: carrerasCentrales } = useRegistroCentralOpts(fecha);

  const cargarConfigs = useCallback(async () => {
    setCargando(true);
    try {
      const data = await listarConfigMarcas({ dia: fecha });
      setConfigs(data);
    } catch (e) {
      console.error("Error al listar configuraciones de marcas:", e);
    } finally {
      setCargando(false);
    }
  }, [fecha]);

  useEffect(() => {
    void cargarConfigs();
  }, [cargarConfigs]);

  // Lista de hipódromos únicos
  const hipodromosDisponibles = useMemo(() => {
    const set = new Set<string>();
    configs.forEach((c) => set.add(c.hipodromo));
    return Array.from(set).sort();
  }, [configs]);

  // Filtrar configuraciones
  const filtradas = useMemo(() => {
    return configs.filter((c) => {
      if (!esMarcaActivaEnPortal(c.hipodromo, c.carrera, c.fecha)) return false;
      if (hipodromoFiltro !== "TODOS" && c.hipodromo !== hipodromoFiltro) return false;
      return true;
    });
  }, [configs, hipodromoFiltro]);

  // Agrupar por hipódromo (igual que en PanelMarcas)
  const bloques = useMemo(() => {
    const mapa = new Map<string, ConfigMarcas[]>();
    for (const c of filtradas) {
      if (!mapa.has(c.hipodromo)) mapa.set(c.hipodromo, []);
      mapa.get(c.hipodromo)!.push(c);
    }
    return Array.from(mapa.entries()).map(([hipo, list]) => ({
      hipodromo: hipo,
      carreras: list.sort((a, b) => a.carrera - b.carrera),
    }));
  }, [filtradas]);

  const abrirCompra = (cfg: ConfigMarcas) => {
    if (cfg.estado === "Cerrada" || bloqueada) return;

    // Buscar carrera central coincidente para obtener nombres de caballos
    const centralMatch = carrerasCentrales.find(
      (c) =>
        c.hipodromo?.trim().toUpperCase() === cfg.hipodromo.trim().toUpperCase() &&
        Number(c.carrera) === Number(cfg.carrera)
    );

    setCarreraCompra({
      hipodromo: cfg.hipodromo,
      carrera: cfg.carrera,
      fecha: cfg.fecha,
      cfg,
      caballos: centralMatch?.caballos?.map((cab) => ({
        numero: cab.numero,
        nombre: cab.nombre || `Ejemplar #${cab.numero}`,
        retirado: Boolean(cab.retirado),
      })),
    });
  };

  return (
    <div className="space-y-4">
      {/* AVISO DE BLOQUEO GLOBAL SI APLICA */}
      {bloqueada && (
        <div className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-xs text-rose-900 flex flex-wrap items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="text-xl">🔒</span>
            <div>
              <div className="font-black text-sm">Venta de Marcas Bloqueada</div>
              <div>Tu cuenta o grupo tiene restringida la compra de jugadas de Marcas en este momento.</div>
            </div>
          </div>
          {onPedirDesbloqueo && (
            <button
              type="button"
              onClick={() => void onPedirDesbloqueo()}
              className="rounded-lg bg-rose-600 px-3 py-1.5 font-bold text-white hover:bg-rose-500 shadow-sm"
            >
              Solicitar Desbloqueo al Administrador
            </button>
          )}
        </div>
      )}

      {/* FILTROS Y SELECTORES (ESTILO MONITOR TABLAS / PRINCIPAL) */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">⚔️</span>
            <div>
              <h2 className="text-base font-black text-slate-900">Cuadro de Marcas Disponibles</h2>
              <p className="text-xs text-slate-500">
                Selecciona la carrera para armar tu matchup (proporción 120 para 100).
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Fecha:</label>
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-black text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        {/* SELECTOR DE HIPODROMOS */}
        {hipodromosDisponibles.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setHipodromoFiltro("TODOS")}
              className={`rounded-lg px-3 py-1 text-xs font-black transition-colors ${
                hipodromoFiltro === "TODOS"
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              Todos los Hipódromos
            </button>
            {hipodromosDisponibles.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setHipodromoFiltro(h)}
                className={`rounded-lg px-3 py-1 text-xs font-black transition-colors ${
                  hipodromoFiltro === h
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                🏇 {nombreHipodromoParaMostrar(h)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* BANNER OFICIAL DE LA CASA (IDENTICO AL PRINCIPAL) */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border-2 border-amber-400 bg-gradient-to-r from-amber-50 via-amber-50 to-yellow-100 px-4 py-3 shadow-sm">
        <div className="flex items-baseline gap-2">
          <span className="text-[11px] font-bold uppercase tracking-widest text-amber-700">Observación</span>
          <span className="text-2xl font-black leading-none text-amber-900">{PROPORCION} para 100</span>
        </div>
        <p className="text-xs font-semibold text-amber-800">
          Se juega <b className="font-black">{PROPORCION}</b> para ganar <b className="font-black">100</b> netos
          (múltiplos de 6). El ejemplar elegido debe cruzar la meta por delante de su rival.
        </p>
      </div>

      {/* LISTADO DE CARRERAS AGRUPADAS POR HIPODROMO (IDENTICO EN DISENO AL PRINCIPAL) */}
      {cargando ? (
        <div className="py-12 text-center text-sm font-bold text-slate-400">
          Cargando carreras de marcas para {fecha}…
        </div>
      ) : bloques.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm font-bold text-slate-500">
          No hay carreras de marcas configuradas para la fecha seleccionada ({fecha}).
        </div>
      ) : (
        <div className="space-y-3">
          {bloques.map((b) => (
            <div key={b.hipodromo} className="overflow-hidden rounded-xl border border-line bg-white shadow-sm">
              {/* CABECERA DEL HIPODROMO */}
              <div className="flex items-center justify-between bg-amber-500 px-3 py-1.5 text-white">
                <span className="text-xs font-black tracking-wide">
                  🏟 {nombreHipodromoParaMostrar(b.hipodromo)}
                </span>
                <span className="text-[10px] font-bold text-amber-50">
                  {b.carreras.length} carrera{b.carreras.length === 1 ? "" : "s"} configurada{b.carreras.length === 1 ? "" : "s"}
                </span>
              </div>

              {/* TABLA DE CARRERAS DE MARCAS */}
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-line bg-surface text-[9px] uppercase tracking-wider text-slate-500">
                      <th className="px-3 py-2 text-left font-bold">Carrera</th>
                      <th className={`px-3 py-2 text-left font-bold ${sepCls}`}>Marcas Oficiales</th>
                      <th className={`px-3 py-2 text-left font-bold ${sepCls}`}>NV</th>
                      <th className={`px-3 py-2 text-left font-bold ${sepCls}`}>No Valen</th>
                      <th className={`px-3 py-2 text-left font-bold ${sepCls}`}>Debutantes</th>
                      <th className="border-l-2 border-slate-300 py-2 px-3 text-right font-bold">
                        Acción
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.carreras.map((cfg, i) => {
                      const marcas = separarNumeros(cfg.marcas);
                      const nvs = separarNumeros(cfg.nv);
                      const deb = separarNumeros(cfg.debutantes);
                      const noValenDeb = cfg.debutantes_valen === false;
                      const cerrada = cfg.estado === "Cerrada";

                      return (
                        <tr
                          key={`${cfg.hipodromo}-${cfg.carrera}`}
                          onClick={() => !cerrada && abrirCompra(cfg)}
                          className={`border-t border-line/60 text-xs transition-colors ${
                            cerrada
                              ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                              : "hover:bg-amber-50/60 cursor-pointer " + (i % 2 === 0 ? "bg-white" : "bg-slate-50/50")
                          }`}
                        >
                          <td className="whitespace-nowrap px-3 py-2.5 font-black text-sm text-slate-900">
                            C{cfg.carrera}
                            {cerrada && (
                              <span className="ml-1.5 rounded bg-slate-200 px-1.5 py-0.5 text-[9px] font-bold text-slate-600">
                                Cerrada
                              </span>
                            )}
                          </td>

                          {/* MARCAS */}
                          <td className={`px-3 py-2.5 ${sepCls}`}>
                            <div className="flex flex-wrap items-center gap-1">
                              {marcas.length === 0 ? (
                                <span className="text-slate-400">—</span>
                              ) : (
                                marcas.map((n, idx) => {
                                  const g = getHorseColor(n);
                                  const esPrimero = idx === 0;
                                  return (
                                    <span
                                      key={n}
                                      title={esPrimero ? "1ª Marca (Favorito principal)" : `${idx + 1}ª Marca`}
                                      className={`${chipCls} ${g.border} ${g.bg} ${g.text}`}
                                    >
                                      {n}
                                    </span>
                                  );
                                })
                              )}
                            </div>
                          </td>

                          {/* NV */}
                          <td className={`px-3 py-2.5 ${sepCls}`}>
                            {nvs.length > 0 ? (
                              <span className={`${chipCls} border-red-300 bg-red-100 text-red-700`}>
                                NV
                              </span>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>

                          {/* NO VALEN */}
                          <td className={`px-3 py-2.5 ${sepCls}`}>
                            <div className="flex flex-wrap items-center gap-1">
                              {nvs.length === 0 ? (
                                <span className="text-slate-400">—</span>
                              ) : (
                                nvs.map((n) => {
                                  const g = getHorseColor(n);
                                  return (
                                    <span
                                      key={n}
                                      className={`${chipCls} ${g.border} ${g.bg} ${g.text} opacity-60`}
                                    >
                                      {n}
                                    </span>
                                  );
                                })
                              )}
                            </div>
                          </td>

                          {/* DEBUTANTES */}
                          <td className={`px-3 py-2.5 ${sepCls}`}>
                            <div className="flex items-center gap-1">
                              {noValenDeb ? (
                                <span className={`${chipCls} border-red-300 bg-red-100 text-red-700`}>
                                  NV DEB.
                                </span>
                              ) : (
                                <span className={`${chipCls} border-emerald-300 bg-emerald-100 text-emerald-700`}>
                                  VALEN
                                </span>
                              )}
                              {deb.length > 0 && (
                                <span className="text-[10px] font-bold text-violet-700">
                                  ({deb.join(" ")})
                                </span>
                              )}
                            </div>
                          </td>

                          {/* ACCION: COMPRAR MARCAS */}
                          <td className="border-l-2 border-slate-300 px-3 py-2.5 text-right">
                            <button
                              type="button"
                              disabled={cerrada || bloqueada}
                              onClick={(e) => {
                                e.stopPropagation();
                                abrirCompra(cfg);
                              }}
                              className={`rounded-lg px-3 py-1 text-xs font-black shadow-sm transition-all ${
                                cerrada || bloqueada
                                  ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                                  : "bg-indigo-600 text-white hover:bg-indigo-500 hover:scale-105 active:scale-95"
                              }`}
                            >
                              💵 Comprar Marcas
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* MODAL DE COMPRA PARA EL CLIENTE */}
      {carreraCompra && (
        <ModalCompraMarcasCliente
          abierto={carreraCompra !== null}
          carreraData={carreraCompra}
          sesion={sesion}
          onCerrar={() => setCarreraCompra(null)}
          onComprado={() => {
            void onRealizada?.();
          }}
        />
      )}
    </div>
  );
}
