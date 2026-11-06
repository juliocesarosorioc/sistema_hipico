"use client";

import { useEffect, useState, useMemo } from "react";
import {
  listarGacetasRepositorio,
  descargarArchivoGaceta,
  type GacetaAlmacenada,
} from "@/features/gaceta/lib/repositorio-gacetas";

interface Props {
  nombreJugador?: string | null;
  nombreGrupo?: string | null;
}

export function SeccionGacetasPortal({ nombreJugador, nombreGrupo }: Props) {
  const [gacetas, setGacetas] = useState<GacetaAlmacenada[]>([]);
  const [cargando, setCargando] = useState(true);
  const [filtroHipo, setFiltroHipo] = useState("TODOS");
  const [filtroFecha, setFiltroFecha] = useState("");

  const cargarGacetas = async () => {
    setCargando(true);
    try {
      // Solo las marcadas como públicas para jugadores
      const lista = await listarGacetasRepositorio({ soloPublicadas: true });
      setGacetas(lista);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    void cargarGacetas();

    const onActualizada = () => {
      void cargarGacetas();
    };
    window.addEventListener("gaceta:guardada", onActualizada);
    window.addEventListener("gaceta:actualizada", onActualizada);
    window.addEventListener("gaceta:eliminada", onActualizada);

    return () => {
      window.removeEventListener("gaceta:guardada", onActualizada);
      window.removeEventListener("gaceta:actualizada", onActualizada);
      window.removeEventListener("gaceta:eliminada", onActualizada);
    };
  }, []);

  const hipodromosUnicos = useMemo(() => {
    const setH = new Set<string>();
    gacetas.forEach((g) => {
      if (g.hipodromo) setH.add(g.hipodromo);
    });
    return ["TODOS", ...Array.from(setH)];
  }, [gacetas]);

  const filtradas = useMemo(() => {
    return gacetas.filter((g) => {
      if (filtroHipo !== "TODOS" && g.hipodromo.toUpperCase() !== filtroHipo.toUpperCase()) {
        return false;
      }
      if (filtroFecha && g.fecha !== filtroFecha) {
        return false;
      }
      return true;
    });
  }, [gacetas, filtroHipo, filtroFecha]);

  const compartirWhatsApp = (g: GacetaAlmacenada) => {
    const texto = encodeURIComponent(
      `📰 *Gaceta Oficial ${g.hipodromo} - ${g.fecha}*\n${g.titulo}\nDescárgala en tu Portal de Jugador: ${window.location.origin}/portal`
    );
    window.open(`https://api.whatsapp.com/send?text=${texto}`, "_blank");
  };

  return (
    <section className="space-y-4">
      {/* Cabecera de bienvenida */}
      <div className="rounded-3xl border border-indigo-200/80 bg-gradient-to-br from-indigo-900 via-indigo-950 to-slate-950 p-5 sm:p-6 text-white shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-400/20 text-amber-300 font-black text-2xl border border-amber-400/30 shadow-inner">
              📰
            </span>
            <div>
              <span className="inline-block rounded-md bg-amber-400/20 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-amber-300 border border-amber-400/30">
                Oficial {nombreGrupo ? `· ${nombreGrupo}` : ""}
              </span>
              <h2 className="text-lg sm:text-xl font-black tracking-tight text-white mt-0.5">
                Gacetas Hípicas, Retrospectos y Programas
              </h2>
              <p className="text-xs text-indigo-200">
                Consulta y descarga los programas de carreras oficiales en PDF para planificar tus jugadas.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void cargarGacetas()}
            className="rounded-xl border border-indigo-400/30 bg-indigo-800/40 px-3 py-1.5 text-xs font-bold text-indigo-200 hover:bg-indigo-800/70 hover:text-white transition"
          >
            🔄 Actualizar
          </button>
        </div>

        {/* Filtros rápidos */}
        <div className="mt-4 pt-4 border-t border-indigo-800/60 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-black uppercase text-indigo-300 mr-1">
              Hipódromo:
            </span>
            {hipodromosUnicos.map((h) => {
              const activo = filtroHipo === h;
              return (
                <button
                  key={h}
                  type="button"
                  onClick={() => setFiltroHipo(h)}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition ${
                    activo
                      ? "bg-amber-400 text-slate-950 shadow-md font-black"
                      : "bg-indigo-900/60 text-indigo-200 hover:bg-indigo-800/60 hover:text-white"
                  }`}
                >
                  {h}
                </button>
              );
            })}
          </div>

          {filtroFecha && (
            <button
              type="button"
              onClick={() => setFiltroFecha("")}
              className="text-[11px] font-bold text-amber-300 hover:underline"
            >
              ✕ Quitar filtro de fecha
            </button>
          )}
        </div>
      </div>

      {/* Grid de Gacetas */}
      {cargando ? (
        <div className="rounded-3xl border border-line bg-surface p-12 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
          <p className="mt-3 text-xs font-bold text-slate-500">
            Cargando programas y gacetas publicadas...
          </p>
        </div>
      ) : filtradas.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-line bg-surface p-10 text-center space-y-2">
          <span className="text-4xl">🏇</span>
          <h3 className="text-sm font-black text-slate-800">
            No hay gacetas disponibles en este momento
          </h3>
          <p className="mx-auto max-w-md text-xs text-slate-500">
            La administración publicará aquí los retrospectos y revistas oficiales para las próximas carreras de {filtroHipo !== "TODOS" ? filtroHipo : "la jornada"}.
          </p>
        </div>
      ) : (
        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {filtradas.map((g) => (
            <div
              key={g.id}
              className="flex flex-col justify-between rounded-3xl border border-line bg-surface p-4 shadow-sm hover:border-indigo-300 hover:shadow-md transition-all duration-200"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded-lg bg-indigo-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-indigo-700 border border-indigo-200/60">
                    🏇 {g.hipodromo}
                  </span>
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-mono font-bold text-slate-600">
                    📅 {g.fecha}
                  </span>
                </div>

                <div className="mt-3 flex items-start gap-2.5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 font-black text-xl border border-rose-200/60 shadow-2xs">
                    📄
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-xs font-black text-slate-900 leading-snug line-clamp-2">
                      {g.titulo}
                    </h3>
                    <p className="mt-0.5 text-[10px] font-medium text-slate-500 truncate">
                      {g.nombreArchivo}
                    </p>
                  </div>
                </div>

                {g.descripcion && (
                  <p className="mt-2 text-[11px] text-slate-600 line-clamp-2 bg-slate-50 p-2 rounded-xl border border-slate-100">
                    {g.descripcion}
                  </p>
                )}
              </div>

              {/* Botones de acción */}
              <div className="mt-4 pt-3 border-t border-line flex items-center justify-between gap-2">
                <span className="text-[10px] font-mono text-slate-400 font-bold">
                  {(g.tamanoBytes / 1024 / 1024).toFixed(2)} MB · PDF
                </span>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => compartirWhatsApp(g)}
                    title="Compartir por WhatsApp"
                    className="flex h-8 w-8 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition shadow-2xs"
                  >
                    💬
                  </button>

                  <button
                    type="button"
                    onClick={() => descargarArchivoGaceta(g)}
                    title="Descargar Gaceta Oficial (PDF)"
                    className="inline-flex items-center gap-1 rounded-xl bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 text-xs font-black text-white shadow-sm transition active:scale-95"
                  >
                    <span>⬇️ Descargar</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default SeccionGacetasPortal;
