"use client";

/**
 * MODAL ➕ SOLICITAR INCLUIR "JUGADA NO RELACIONADA" — PORTAL
 * =====================================================================
 * Incluye el filtro de hipódromo optimizado (`SearchableSelect` con catálogo
 * de la jornada + logos) y las carreras registradas en números (botones
 * seleccionables `1`, `2`, `3`...) para que el jugador las seleccione con un clic.
 */

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/shared/components/ui/Button";
import { DateInput } from "@/shared/components/ui/DateInput";
import { SearchableSelect } from "@/shared/components/ui/SearchableSelect";
import { opcionesHipodromo } from "@/features/hipodromos/lib/nombre";
import { listarHipodromos } from "@/features/hipodromos/lib/servicio";
import type { Hipodromo } from "@/features/hipodromos/lib/tipos";
import { useVersionLogos } from "@/shared/store/useHipodromosStore";
import { listarCarrerasPorDia } from "@/features/tablas/lib/rpc";
import { cargarCarrerasDelDia } from "@/features/carreras/lib/carreras-dia";
import { solicitarJugadaNoRelacionada, type SesionPortal } from "@/features/portal/lib/portal";
import { TIPOS_JUGADA, ETIQUETA_TIPO, type TipoJugada } from "@/features/portal/lib/jugada-usuario";
import {
  explicarVentana,
  fechaPisoReclamo,
  fechaTopeReclamo,
  normalizarVentana,
  type CicloGrupo,
} from "@/features/portal/lib/ventana-reclamos";

const toast = (msg: string, tipo: "success" | "warning" | "error" | "info" = "info") =>
  window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));

const hoyIso = (): string => {
  const d = new Date();
  const p = (v: number): string => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const lbl = "modal-campo-label";

export function ModalJugadaNoRelacionada({
  sesion,
  ventana,
  ciclo,
  onCerrar,
}: {
  sesion: SesionPortal;
  /** Ventana configurada en el grupo del jugador. */
  ventana: string;
  /** Ciclo semanal del grupo (para el rango de SEMANA_EN_CURSO). */
  ciclo?: CicloGrupo | null;
  onCerrar: () => void;
}) {
  const hoy = hoyIso();
  const modo = normalizarVentana(ventana);
  const piso = fechaPisoReclamo(hoy, modo, ciclo);
  const tope = fechaTopeReclamo(hoy, modo, ciclo);

  const [fecha, setFecha] = useState(hoy);
  const [hipodromo, setHipodromo] = useState("");
  const [carrera, setCarrera] = useState("1");
  const [carrerasRegistradas, setCarrerasRegistradas] = useState<number[]>([]);
  const [cargandoCarreras, setCargandoCarreras] = useState(false);
  const [tipoJugada, setTipoJugada] = useState<TipoJugada>("TABLA_FIJA");
  const [ejemplares, setEjemplares] = useState("");
  const [monto, setMonto] = useState("");
  const [explicacion, setExplicacion] = useState("");
  const [imagen, setImagen] = useState<File | null>(null);
  const [previa, setPrevia] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  // Catálogo REAL de hipódromos (con país y logo) para el buscador optimizado
  const [catalogo, setCatalogo] = useState<Hipodromo[]>([]);
  const versionLogos = useVersionLogos();
  useEffect(() => {
    let vivo = true;
    listarHipodromos()
      .then((r) => vivo && setCatalogo(r.data))
      .catch(() => vivo && setCatalogo([]));
    return () => {
      vivo = false;
    };
  }, [versionLogos]);

  const opcionesHip = useMemo(() => opcionesHipodromo(catalogo), [catalogo]);

  // Trae las carreras registradas en números para el hipódromo y fecha seleccionados
  useEffect(() => {
    let vivo = true;
    const h = hipodromo.trim();
    if (!h || !fecha) {
      setCarrerasRegistradas([]);
      return;
    }
    setCargandoCarreras(true);
    Promise.all([
      listarCarrerasPorDia(h, fecha).catch(() => [] as number[]),
      cargarCarrerasDelDia(fecha).catch(() => []),
    ])
      .then(([porRpc, porCentral]) => {
        if (!vivo) return;
        const setNums = new Set<number>();
        for (const n of porRpc) {
          const num = Number(n);
          if (Number.isFinite(num) && num > 0) setNums.add(num);
        }
        const hUpper = h.toUpperCase();
        for (const c of porCentral) {
          if (String(c.hipodromo ?? "").trim().toUpperCase() !== hUpper) continue;
          const num = Number(c.carrera);
          if (Number.isFinite(num) && num > 0) setNums.add(num);
        }
        const ordenadas = [...setNums].sort((a, b) => a - b);
        setCarrerasRegistradas(ordenadas);
        if (ordenadas.length > 0 && !ordenadas.includes(Number(carrera))) {
          setCarrera(String(ordenadas[0]));
        }
      })
      .finally(() => {
        if (vivo) setCargandoCarreras(false);
      });
    return () => {
      vivo = false;
    };
  }, [hipodromo, fecha]);

  const numerosParaSeleccionar = useMemo(() => {
    if (carrerasRegistradas.length > 0) return carrerasRegistradas;
    return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  }, [carrerasRegistradas]);

  const elegirImagen = (f: File | null) => {
    setImagen(f);
    if (f) setPrevia(URL.createObjectURL(f));
    else setPrevia(null);
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const it of Array.from(items)) {
      if (it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) {
          elegirImagen(f);
          e.preventDefault();
          return;
        }
      }
    }
  };

  const enviar = async () => {
    setError("");
    if (!fecha) return setError("Elegí la fecha de la jugada.");
    if (fecha < piso || fecha > tope) {
      return setError(`La fecha tiene que estar entre ${piso} y ${tope} (ventana de tu grupo).`);
    }
    if (!hipodromo.trim()) return setError("Indicá el hipódromo.");
    if (!carrera.trim()) return setError("Seleccioná el número de carrera.");
    if (!ejemplares.trim()) return setError("Indicá el ejemplar o los ejemplares.");
    if (!explicacion.trim()) return setError("Contá qué pasó con la jugada.");
    const m = parseFloat(monto.replace(",", "."));
    if (!(m > 0)) return setError("El monto tiene que ser mayor que cero.");

    setEnviando(true);
    const r = await solicitarJugadaNoRelacionada(sesion.cliente.id, {
      fecha,
      hipodromo: hipodromo.trim().toUpperCase(),
      carrera: carrera.trim(),
      tipo_jugada: ETIQUETA_TIPO[tipoJugada].etiqueta.toUpperCase(),
      ejemplares: ejemplares.trim(),
      monto: m,
      explicacion: explicacion.trim(),
      image: imagen,
    });
    setEnviando(false);
    if (!r.ok) {
      setError(r.error ?? "No se pudo enviar la solicitud.");
      return toast(r.error ?? "No se pudo enviar la solicitud.", "error");
    }
    toast("Solicitud enviada. La casa la revisará y te responderá.", "success");
    onCerrar();
  };

  return (
    <div className="modal-overlay" onClick={onCerrar}>
      <div className="modal-editorial" onClick={(e) => e.stopPropagation()}>
        <header className="modal-editorial__cabecera">
          <div className="modal-editorial__titulos">
            <h2 className="modal-editorial__titulo">➕ Solicitar Incluir Jugada No Relacionada</h2>
            <p className="modal-editorial__sub">Pedile a la casa que revise una jugada que no te aparece.</p>
          </div>
          <button onClick={onCerrar} className="modal-editorial__cerrar" aria-label="Cerrar">
            ✕
          </button>
        </header>

        <div className="modal-editorial__cuerpo space-y-3" onPaste={onPaste}>
          <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] font-bold text-amber-300">
            ⏱️ {explicarVentana(modo)}
          </p>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className={lbl}>1 · Fecha (Día)</label>
              <DateInput
                value={fecha}
                onFechaChange={(val) => setFecha(val)}
                className="modal-campo text-xs font-bold"
              />
            </div>
            <div>
              <label className={lbl}>2 · Hipódromo (Filtro Optimizado)</label>
              <SearchableSelect
                options={opcionesHip}
                value={hipodromo}
                onChange={(v) => setHipodromo(v)}
                placeholder="Buscar y seleccionar hipódromo…"
                allowCustom
                temaOscuro
              />
            </div>
          </div>

          {/* Selector numérico de carreras registradas */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className={lbl}>
                3 · Seleccioná la Carrera en Números{" "}
                {carrerasRegistradas.length > 0 ? (
                  <span className="ml-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-black text-emerald-300">
                    {carrerasRegistradas.length} registrada(s) en el día
                  </span>
                ) : null}
              </label>
              {cargandoCarreras && (
                <span className="text-[10px] font-bold text-slate-400">Cargando carreras…</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-700/80 bg-slate-900/70 p-2.5">
              {numerosParaSeleccionar.map((num) => {
                const activa = String(carrera) === String(num);
                const esRegistrada = carrerasRegistradas.includes(num);
                return (
                  <button
                    key={num}
                    type="button"
                    onClick={() => setCarrera(String(num))}
                    className={`flex h-9 min-w-[2.5rem] items-center justify-center rounded-lg border px-2.5 font-mono text-xs font-black transition ${
                      activa
                        ? "border-amber-400 bg-amber-400 text-slate-950 shadow-md scale-105"
                        : esRegistrada
                          ? "border-emerald-500/50 bg-emerald-950/60 text-emerald-200 hover:border-amber-400"
                          : "border-slate-700 bg-slate-800/80 text-slate-300 hover:border-slate-500"
                    }`}
                    title={esRegistrada ? `Carrera ${num} registrada` : `Carrera ${num}`}
                  >
                    {num}
                  </button>
                );
              })}
              <input
                className="ml-auto w-20 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-center font-mono text-xs font-black text-amber-300"
                inputMode="numeric"
                value={carrera}
                onChange={(e) => setCarrera(e.target.value.replace(/\D/g, ""))}
                placeholder="Nº"
                title="O escribí otro número de carrera"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label className={lbl}>Tipo de jugada</label>
              <select className="modal-campo" value={tipoJugada} onChange={(e) => setTipoJugada(e.target.value as TipoJugada)}>
                {TIPOS_JUGADA.map((t) => (
                  <option key={t} value={t}>
                    {ETIQUETA_TIPO[t].icono} {ETIQUETA_TIPO[t].etiqueta}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className={lbl}>Ejemplar(es)</label>
              <input
                className="modal-campo"
                value={ejemplares}
                onChange={(e) => setEjemplares(e.target.value)}
                placeholder="Ej: 3 / 5x7"
              />
            </div>
          </div>

          <div>
            <label className={lbl}>Monto jugado</label>
            <input
              className="modal-campo text-right font-mono"
              inputMode="decimal"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              placeholder="0.00"
            />
          </div>

          <div>
            <label className={lbl}>Explicación</label>
            <textarea
              className="modal-campo min-h-[80px]"
              value={explicacion}
              onChange={(e) => setExplicacion(e.target.value)}
              placeholder="Contá qué jugaste, dónde y por qué creés que no aparece."
            />
          </div>

          <div>
            <label className={lbl}>Soporte (opcional · pegá con Ctrl+V o elegí un archivo)</label>
            <input
              type="file"
              accept="image/*"
              className="block w-full text-[11px] text-slate-400"
              onChange={(e) => elegirImagen(e.target.files?.[0] ?? null)}
            />
            {previa ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previa} alt="Soporte" className="mt-2 max-h-40 rounded-xl border border-slate-700" />
            ) : null}
          </div>

          {error ? (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] font-bold text-rose-300">{error}</div>
          ) : null}
        </div>

        <footer className="modal-editorial__pie">
          <Button variant="ghost" size="sm" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button variant="default" size="sm" disabled={enviando} onClick={() => void enviar()}>
            {enviando ? <span className="mr-1">⏳</span> : <span className="mr-1">📤</span>} Enviar solicitud
          </Button>
        </footer>
      </div>
    </div>
  );
}
