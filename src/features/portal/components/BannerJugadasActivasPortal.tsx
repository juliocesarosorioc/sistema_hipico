"use client";

import { useEffect, useState, useMemo } from "react";
import {
  leerConfigActivasCache,
  leerConfigActivasPortal,
  esTablaActivaEnPortal,
  esMarcaActivaEnPortal,
  esPuestoActivoEnPortal,
  esRemateActivoEnPortal,
  esDupletaActivaEnPortal,
  esPollaActivaEnPortal,
  type ConfigActivasPortal,
  type ModalidadPortal,
} from "@/features/portal/lib/control-activas-portal";
import type { TablaFijaRow } from "@/features/tablas/lib/tablas-fijas";
import type { ConfigMarcas } from "@/features/marcas/lib/marcas";
import type { DupletaEstado } from "@/features/dupletas/lib/dupletas";
import type { Polla } from "@/features/pollas/lib/pollas";
import type { RematePortalRow } from "./SeccionJugadasPortal";

type Props = {
  tablas: TablaFijaRow[];
  marcas: ConfigMarcas[];
  dupletas: DupletaEstado[];
  pollas: Polla[];
  remates: RematePortalRow[];
  modalidadActiva: string;
  onSeleccionarModalidad: (mod: ModalidadPortal) => void;
};

export function BannerJugadasActivasPortal({
  tablas,
  marcas,
  dupletas,
  pollas,
  remates,
  modalidadActiva,
  onSeleccionarModalidad,
}: Props) {
  const [config, setConfig] = useState<ConfigActivasPortal>(() => leerConfigActivasCache());

  useEffect(() => {
    let cancel = false;
    void leerConfigActivasPortal().then((c) => {
      if (!cancel) setConfig(c);
    });

    const handler = (e: Event) => {
      const custom = e as CustomEvent<ConfigActivasPortal>;
      if (custom.detail) setConfig(custom.detail);
    };

    window.addEventListener("config-activas-portal-cambio", handler);
    return () => {
      cancel = true;
      window.removeEventListener("config-activas-portal-cambio", handler);
    };
  }, []);

  // Calcular conteo de ofertas activas para cada modalidad
  const tablasActivas = useMemo(() => {
    if (config.modalidades_pausadas.tablas_fijas) return 0;
    return tablas.filter((t) => esTablaActivaEnPortal(t.id, config)).length;
  }, [tablas, config]);

  const marcasActivas = useMemo(() => {
    if (config.modalidades_pausadas.marcas) return 0;
    return marcas.filter((m) => m.estado !== "Cerrada" && esMarcaActivaEnPortal(m.hipodromo, m.carrera, m.fecha, config)).length;
  }, [marcas, config]);

  const rematesActivos = useMemo(() => {
    if (config.modalidades_pausadas.remates) return 0;
    return remates.filter((r) => esRemateActivoEnPortal(r.id, config)).length;
  }, [remates, config]);

  const dupletasActivas = useMemo(() => {
    if (config.modalidades_pausadas.dupletas) return 0;
    return dupletas.filter((d) => {
      const k = `${String(d.hipodromo).trim().toUpperCase()}|${d.fecha}|${d.carrera1}|${d.carrera2}`;
      return esDupletaActivaEnPortal(k, config);
    }).length;
  }, [dupletas, config]);

  const pollasActivas = useMemo(() => {
    if (config.modalidades_pausadas.pollas) return 0;
    return pollas.filter((p) => p.estado === "Abierta" && esPollaActivaEnPortal(p.id, config)).length;
  }, [pollas, config]);

  const puestosActivos = useMemo(() => {
    if (config.modalidades_pausadas.puestos) return 0;
    return tablas.length > 0 ? tablas.length : 1;
  }, [tablas, config]);

  const modalidadesInfo: Array<{
    id: ModalidadPortal;
    titulo: string;
    icono: string;
    activa: boolean;
    conteo: number;
    etiquetaConteo: string;
  }> = [
    {
      id: "tablas_fijas",
      titulo: "Tablas Fijas",
      icono: "🏁",
      activa: !config.modalidades_pausadas.tablas_fijas && tablasActivas > 0,
      conteo: tablasActivas,
      etiquetaConteo: `${tablasActivas} carrera${tablasActivas === 1 ? "" : "s"}`,
    },
    {
      id: "marcas",
      titulo: "Marcas",
      icono: "⚔️",
      activa: !config.modalidades_pausadas.marcas && marcasActivas > 0,
      conteo: marcasActivas,
      etiquetaConteo: `${marcasActivas} carrera${marcasActivas === 1 ? "" : "s"}`,
    },
    {
      id: "puestos",
      titulo: "Puestos",
      icono: "🥇",
      activa: !config.modalidades_pausadas.puestos && puestosActivos > 0,
      conteo: puestosActivos,
      etiquetaConteo: "Disponible",
    },
    {
      id: "remates",
      titulo: "Remates",
      icono: "🔨",
      activa: !config.modalidades_pausadas.remates && rematesActivos > 0,
      conteo: rematesActivos,
      etiquetaConteo: `${rematesActivos} cuadro${rematesActivos === 1 ? "" : "s"}`,
    },
    {
      id: "dupletas",
      titulo: "Dupletas",
      icono: "🔀",
      activa: !config.modalidades_pausadas.dupletas && dupletasActivas > 0,
      conteo: dupletasActivas,
      etiquetaConteo: `${dupletasActivas} jugada${dupletasActivas === 1 ? "" : "s"}`,
    },
    {
      id: "pollas",
      titulo: "Pollas",
      icono: "🎯",
      activa: !config.modalidades_pausadas.pollas && pollasActivas > 0,
      conteo: pollasActivas,
      etiquetaConteo: `${pollasActivas} polla${pollasActivas === 1 ? "" : "s"}`,
    },
  ];

  const totalActivas = modalidadesInfo.filter((m) => m.activa).length;

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-gradient-to-b from-white to-slate-50 p-3.5 shadow-sm space-y-2.5">
      {/* BARRA SUPERIOR CON INDICADOR EN VIVO */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
          </span>
          <span className="text-[11px] font-black uppercase tracking-wider text-slate-800">
            Jornada de Hoy: {totalActivas} {totalActivas === 1 ? "Modalidad Activa" : "Modalidades Activas"} para Venta
          </span>
        </div>
        <span className="text-[10px] font-bold text-slate-500">
          La administración actualiza en tiempo real las carreras disponibles
        </span>
      </div>

      {/* PILLS INTERACTIVAS DE MODALIDADES */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
        {modalidadesInfo.map((m) => {
          const seleccionada = modalidadActiva === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onSeleccionarModalidad(m.id)}
              className={`flex flex-col items-start p-2.5 rounded-xl border text-left transition-all ${
                seleccionada
                  ? "border-indigo-600 bg-indigo-50/80 shadow-md ring-2 ring-indigo-400"
                  : m.activa
                    ? "border-emerald-200 bg-emerald-50/50 hover:bg-emerald-100/60 hover:border-emerald-300"
                    : "border-slate-200 bg-slate-50 opacity-60 hover:opacity-80"
              }`}
            >
              <div className="flex items-center justify-between w-full">
                <span className="text-base">{m.icono}</span>
                {m.activa ? (
                  <span className="rounded-full bg-emerald-600 px-1.5 py-0.5 text-[8px] font-black uppercase text-white leading-none">
                    Activa
                  </span>
                ) : (
                  <span className="rounded-full bg-slate-300 px-1.5 py-0.5 text-[8px] font-bold uppercase text-slate-700 leading-none">
                    En pausa
                  </span>
                )}
              </div>
              <div className="mt-1 text-xs font-black text-slate-900 leading-tight">
                {m.titulo}
              </div>
              <div className="text-[10px] font-bold text-slate-500 mt-0.5">
                {m.activa ? m.etiquetaConteo : "No disponible"}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
