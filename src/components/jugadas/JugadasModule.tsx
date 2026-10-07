"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { ToastHost } from "@/components/ui/ToastHost";
import { useAuthStore } from "@/store/useAuthStore";
import { useHipodromosActivos } from "@/store/useHipodromosStore";
import {
  listarMonitorJugadas,
  listarJugadasDeCarrera,
  listarAuditoriaJugadas,
  editarJugada,
  anularJugada,
  restaurarJugada,
  marcarJugadaPagada,
  usuarioDeJugada,
  fechaCarreraDeJugada,
  MOTIVOS_ANULACION,
  type FilaMonitorJugada,
  type JugadaAdmin,
  type AuditoriaJugada,
} from "@/lib/jugadas";

const toast = (msg: string, tipo: "success" | "warning" | "error" | "info" = "info") =>
  window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const money = (v: unknown, moneda = "VES"): string => {
  const n = num(v);
  return `${moneda === "USD" ? "$" : "Bs."}${n.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

type FiltroEstado =
  | ""
  | "con_resultado"
  | "sin_resultado"
  | "en_juego"
  | "por_pagar"
  | "liquidadas"
  | "anuladas";

const ESTADOS_JUGADA = ["Pendiente", "Ganador", "Perdedor", "Retirado"] as const;

const ESTADO_BADGE: Record<string, string> = {
  Pendiente: "bg-sky-100 text-sky-700",
  Ganador: "bg-emerald-100 text-emerald-700",
  Perdedor: "bg-rose-100 text-rose-700",
  Retirado: "bg-slate-200 text-slate-600",
  Anulado: "bg-amber-200 text-amber-800",
  Pagado: "bg-emerald-200 text-emerald-900",
};

/** Comprime una imagen a JPEG (data URL) para adjuntarla a la auditoría. */
async function comprimirImagen(file: File, maxLado = 900, calidad = 0.6): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const escala = Math.min(1, maxLado / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * escala));
        const h = Math.max(1, Math.round(img.height * escala));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas no disponible.");
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", calidad));
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("La imagen no es válida."));
    };
    img.src = url;
  });
}

function chipClase(estado: string): string {
  return ESTADO_BADGE[estado] ?? "bg-slate-100 text-slate-600";
}

export function JugadasModule() {
  const usuario = useAuthStore((s) => s.usuario);
  const hipodromos = useHipodromosActivos();

  const [filas, setFilas] = useState<FilaMonitorJugada[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState("");

  const [fHipodromo, setFHipodromo] = useState("");
  const [fCarrera, setFCarrera] = useState("");
  const [fEstado, setFEstado] = useState<FiltroEstado>("");
  const [fUsuario, setFUsuario] = useState("");
  const [fTexto, setFTexto] = useState("");

  const [seleccion, setSeleccion] = useState<FilaMonitorJugada | null>(null);
  const [detalle, setDetalle] = useState<JugadaAdmin[]>([]);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [errorDetalle, setErrorDetalle] = useState("");

  const [editando, setEditando] = useState<JugadaAdmin | null>(null);
  const [anulando, setAnulando] = useState<JugadaAdmin | null>(null);
  const [historial, setHistorial] = useState<{ jugada: JugadaAdmin; items: AuditoriaJugada[] } | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    const r = await listarMonitorJugadas();
    setFilas(r.filas);
    setErrorCarga(r.ok ? "" : r.error ?? "No se pudo cargar el monitor.");
    setCargando(false);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const cargarDetalle = useCallback(async (fila: FilaMonitorJugada) => {
    setSeleccion(fila);
    setCargandoDetalle(true);
    const r = await listarJugadasDeCarrera(fila.hipodromo, fila.carrera, fila.fecha_carrera);
    if (!r.ok) {
      setErrorDetalle(r.error ?? "No se pudieron cargar las jugadas.");
      setDetalle([]);
    } else {
      setErrorDetalle("");
      setDetalle(r.jugadas);
    }
    setCargandoDetalle(false);
  }, []);

  const refrescar = useCallback(async () => {
    await cargar();
    if (seleccion) await cargarDetalle(seleccion);
  }, [cargar, cargarDetalle, seleccion]);

  const usuarios = useMemo(() => {
    const set = new Set<string>();
    for (const f of filas) (f.usuarios ?? []).forEach((u) => u && set.add(u));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [filas]);

  const filtradas = useMemo(() => {
    const q = fTexto.trim().toUpperCase();
    return filas.filter((f) => {
      if (fHipodromo && f.hipodromo !== fHipodromo.toUpperCase()) return false;
      if (fCarrera && String(f.carrera) !== fCarrera.trim()) return false;
      if (fUsuario && !(f.usuarios ?? []).includes(fUsuario)) return false;
      if (q && !f.hipodromo.includes(q) && !String(f.carrera).includes(q)) return false;
      if (fEstado === "con_resultado" && !f.resultado_cargado) return false;
      if (fEstado === "sin_resultado" && f.resultado_cargado) return false;
      if (fEstado === "en_juego" && f.en_juego <= 0) return false;
      if (fEstado === "por_pagar" && f.por_pagar <= 0) return false;
      if (fEstado === "liquidadas" && f.liquidadas <= 0) return false;
      if (fEstado === "anuladas" && f.anuladas <= 0) return false;
      return true;
    });
  }, [filas, fHipodromo, fCarrera, fUsuario, fTexto, fEstado]);

  const totales = useMemo(
    () =>
      filtradas.reduce(
        (a, f) => {
          a.carreras += 1;
          a.jugadas += f.total_jugadas;
          a.enJuego += f.en_juego;
          a.porPagar += f.por_pagar;
          a.liquidadas += f.liquidadas;
          a.anuladas += f.anuladas;
          a.monto += f.monto_vigente;
          a.porPagarMonto += f.premio_ganador;
          if (f.resultado_cargado) a.conResultado += 1;
          return a;
        },
        {
          carreras: 0,
          jugadas: 0,
          enJuego: 0,
          porPagar: 0,
          liquidadas: 0,
          anuladas: 0,
          monto: 0,
          porPagarMonto: 0,
          conResultado: 0,
        }
      ),
    [filtradas]
  );

  const progreso = totales.carreras ? Math.round((totales.conResultado / totales.carreras) * 100) : 0;

  const guardarEdicion = async (campos: Parameters<typeof editarJugada>[1], motivo: string): Promise<void> => {
    if (!editando) return;
    const r = await editarJugada(editando.id, campos, motivo, usuario);
    if (!r.ok) {
      toast(r.error ?? "No se pudo guardar.", "error");
      return;
    }
    toast(r.error ?? "Jugada corregida.", r.error ? "warning" : "success");
    setEditando(null);
    await refrescar();
  };

  const confirmarAnulacion = async (motivo: string, imagen: string | null): Promise<void> => {
    if (!anulando) return;
    const r = await anularJugada(anulando.id, motivo, imagen, usuario);
    if (!r.ok) {
      toast(r.error ?? "No se pudo anular.", "error");
      return;
    }
    toast(r.error ?? "Jugada anulada.", r.error ? "warning" : "success");
    setAnulando(null);
    await refrescar();
  };

  const accionSimple = async (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) => {
    const r = await fn();
    if (!r.ok) return toast(r.error ?? "No se pudo completar.", "error");
    toast(r.error ?? ok, r.error ? "warning" : "success");
    await refrescar();
  };

  const verHistorial = async (j: JugadaAdmin) => {
    const items = await listarAuditoriaJugadas(j.id);
    setHistorial({ jugada: j, items });
  };

  return (
    <div className="space-y-4">
      <ToastHost />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-800">
            <span className="mr-2 text-indigo-600">📈</span> Monitor de Jugadas
          </h1>
          <p className="text-xs text-slate-500">
            Progreso de resultados por carrera y estado de las jugadas. Corrección y anulación auditadas.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refrescar()}>
          <span className="mr-1">🔄</span> Recargar
        </Button>
      </div>

      {errorCarga && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-800">
          <span className="mr-2">⚠️</span>
          {errorCarga}
        </div>
      )}

      {/* Tarjetas resumen */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <TarjetaResumen titulo="Carreras" valor={String(totales.carreras)} pie={`${totales.jugadas} jugadas`} tono="bg-white" />
        <TarjetaResumen titulo="En juego" valor={String(totales.enJuego)} pie="sin resultado" tono="bg-sky-50" />
        <TarjetaResumen titulo="Por pagar" valor={String(totales.porPagar)} pie={money(totales.porPagarMonto)} tono="bg-emerald-50" />
        <TarjetaResumen titulo="Liquidadas" valor={String(totales.liquidadas)} pie="cerradas" tono="bg-slate-50" />
        <TarjetaResumen titulo="Anuladas" valor={String(totales.anuladas)} pie="con auditoría" tono="bg-amber-50" />
        <TarjetaResumen titulo="Monto vigente" valor={money(totales.monto)} pie="sin anuladas" tono="bg-indigo-50" />
      </div>

      {/* Progreso de resultados */}
      <div className="rounded-2xl border border-line bg-white p-4">
        <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wide text-slate-500">
          <span>
            Resultados cargados: <b className="text-slate-800">{totales.conResultado}</b> / {totales.carreras}
          </span>
          <span className={progreso === 100 ? "text-emerald-600" : "text-indigo-600"}>{progreso}%</span>
        </div>
        <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full transition-all ${progreso === 100 ? "bg-emerald-500" : "bg-indigo-500"}`}
            style={{ width: `${progreso}%` }}
          />
        </div>
        {usuarios.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">Operadores:</span>
            {usuarios.map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => setFUsuario(fUsuario === u ? "" : u)}
                className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase transition-colors ${
                  fUsuario === u ? "border-indigo-500 bg-indigo-500 text-white" : "border-line bg-white text-slate-600 hover:border-indigo-300"
                }`}
              >
                {u}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Filtros */}
      <div className="grid grid-cols-2 gap-2 rounded-2xl border border-line bg-white p-3 md:grid-cols-3 xl:grid-cols-5">
        <label className="col-span-1 text-[10px] font-bold uppercase text-slate-400">
          Hipódromo
          <SearchableSelect
            options={[{ value: "", label: "Todos" }, ...hipodromos.map((h) => ({ value: h.value, label: h.label }))]}
            value={fHipodromo}
            onChange={setFHipodromo}
            allowCustom={false}
            placeholder="Todos"
            inputClassName="mt-0.5 w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-bold uppercase text-slate-800 focus:outline-none"
          />
        </label>
        <label className="text-[10px] font-bold uppercase text-slate-400">
          Carrera
          <input
            value={fCarrera}
            onChange={(e) => setFCarrera(e.target.value.replace(/\D/g, ""))}
            placeholder="Todas"
            className="mt-0.5 w-full rounded-lg border border-line px-2.5 py-1.5 text-xs font-bold text-slate-800 focus:outline-none"
          />
        </label>
        <label className="text-[10px] font-bold uppercase text-slate-400">
          Estado
          <select
            value={fEstado}
            onChange={(e) => setFEstado(e.target.value as FiltroEstado)}
            className="mt-0.5 w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs font-bold uppercase text-slate-800 focus:outline-none"
          >
            <option value="">Todas</option>
            <option value="con_resultado">Con resultado</option>
            <option value="sin_resultado">Sin resultado</option>
            <option value="en_juego">En juego</option>
            <option value="por_pagar">Por pagar</option>
            <option value="liquidadas">Liquidadas</option>
            <option value="anuladas">Anuladas</option>
          </select>
        </label>
        <label className="text-[10px] font-bold uppercase text-slate-400">
          Operador
          <select
            value={fUsuario}
            onChange={(e) => setFUsuario(e.target.value)}
            className="mt-0.5 w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs font-bold uppercase text-slate-800 focus:outline-none"
          >
            <option value="">Todos</option>
            {usuarios.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[10px] font-bold uppercase text-slate-400">
          Buscar
          <input
            value={fTexto}
            onChange={(e) => setFTexto(e.target.value)}
            placeholder="Hipódromo o Nº"
            className="mt-0.5 w-full rounded-lg border border-line px-2.5 py-1.5 text-xs font-bold uppercase text-slate-800 focus:outline-none"
          />
        </label>
      </div>

      {/* Tabla */}
      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Hipódromo</th>
                <th className="px-3 py-2">Carrera</th>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2 text-right">Jugadas</th>
                <th className="px-3 py-2 text-right">Monto</th>
                <th className="px-3 py-2 text-center">Resultado</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {cargando ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-slate-400">
                    Cargando monitor…
                  </td>
                </tr>
              ) : filtradas.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-slate-400">
                    Sin carreras con jugadas para estos filtros.
                  </td>
                </tr>
              ) : (
                filtradas.map((f) => (
                  <tr key={`${f.hipodromo}-${f.carrera}-${f.fecha_carrera ?? ""}`} className="border-t border-line hover:bg-slate-50/60">
                    <td className="px-3 py-2 font-bold uppercase text-slate-700">{f.hipodromo}</td>
                    <td className="px-3 py-2 font-black text-slate-800">C{f.carrera}</td>
                    <td className="px-3 py-2 text-slate-500">{f.fecha_carrera ?? "—"}</td>
                    <td className="px-3 py-2 text-right font-bold text-slate-700">{f.total_jugadas}</td>
                    <td className="px-3 py-2 text-right font-bold text-slate-700">{money(f.monto_vigente)}</td>
                    <td className="px-3 py-2 text-center">
                      {f.resultado_cargado ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black uppercase text-emerald-700">Cargado</span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase text-amber-700">Faltante</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {f.en_juego > 0 && <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-700">{f.en_juego} en juego</span>}
                        {f.por_pagar > 0 && <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">{f.por_pagar} por pagar</span>}
                        {f.liquidadas > 0 && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">{f.liquidadas} liq.</span>}
                        {f.anuladas > 0 && <span className="rounded-full bg-amber-200 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">{f.anuladas} anul.</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button variant="outline" size="sm" onClick={() => void cargarDetalle(f)}>
                        Ver
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detalle de la carrera */}
      {seleccion && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/60 p-4">
          <div className="mt-6 w-full max-w-5xl rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div>
                <h2 className="text-sm font-black uppercase text-slate-800">
                  {seleccion.hipodromo} · Carrera {seleccion.carrera}
                  {seleccion.fecha_carrera ? ` · ${seleccion.fecha_carrera}` : ""}
                </h2>
                <p className="text-[11px] text-slate-500">
                  {seleccion.total_jugadas} jugadas · monto {money(seleccion.monto_vigente)} ·{" "}
                  {seleccion.resultado_cargado ? "resultado cargado" : "resultado faltante"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSeleccion(null)}
                className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <span className="text-lg">✕</span>
              </button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto p-4">
              {cargandoDetalle ? (
                <p className="py-8 text-center text-xs text-slate-400">Cargando jugadas…</p>
              ) : errorDetalle ? (
                <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-800">
                  <span className="mr-2">⚠️</span>
                  {errorDetalle}
                </div>
              ) : detalle.length === 0 ? (
                <p className="py-8 text-center text-xs text-slate-400">No hay jugadas cargadas para esta carrera.</p>
              ) : (
                <table className="min-w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-[10px] font-black uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-2 py-2">Cliente</th>
                      <th className="px-2 py-2">Jugada</th>
                      <th className="px-2 py-2">Caballo</th>
                      <th className="px-2 py-2 text-right">Monto</th>
                      <th className="px-2 py-2 text-right">Premio</th>
                      <th className="px-2 py-2">Operador</th>
                      <th className="px-2 py-2">Estado</th>
                      <th className="px-2 py-2 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalle.map((j) => {
                      const estado = j.anulada ? "Anulado" : j.estado ?? "Pendiente";
                      return (
                        <tr key={String(j.id)} className={`border-t border-line ${j.anulada ? "bg-amber-50/50" : ""}`}>
                          <td className="px-2 py-1.5 font-semibold text-slate-700">{j.cliente_juega_nombre ?? "—"}</td>
                          <td className="px-2 py-1.5 text-slate-600">{j.nombre_jugada ?? "—"}</td>
                          <td className="px-2 py-1.5 text-slate-600">
                            {j.ejemplar_numero != null ? `${j.ejemplar_numero} · ` : ""}
                            {j.caballo ?? "—"}
                          </td>
                          <td className="px-2 py-1.5 text-right font-bold text-slate-700">{money(j.monto_jugado, j.moneda ?? "VES")}</td>
                          <td className="px-2 py-1.5 text-right font-bold text-slate-700">{num(j.premio_pagar) > 0 ? money(j.premio_pagar, j.moneda ?? "VES") : "—"}</td>
                          <td className="px-2 py-1.5 text-slate-500">{usuarioDeJugada(j) || "—"}</td>
                          <td className="px-2 py-1.5">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${chipClase(estado)}`}>{estado}</span>
                            {j.pagado_en && <span className="ml-1 rounded-full bg-emerald-200 px-1.5 py-0.5 text-[9px] font-bold text-emerald-900">pagada</span>}
                            {j.anulada && j.anulada_motivo && (
                              <span className="ml-1 text-[9px] italic text-amber-700" title={j.anulada_motivo}>
                                ({j.anulada_motivo})
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-1.5">
                            <div className="flex justify-end gap-1">
                              <IconBtn titulo="Corregir" icono="✏️" onClick={() => setEditando(j)} />
                              {j.anulada ? (
                                <IconBtn
                                  titulo="Restaurar"
                                  icono="↩️"
                                  onClick={() => void accionSimple(() => restaurarJugada(j.id, "Restauración desde el monitor", usuario), "Jugada restaurada.")}
                                />
                              ) : (
                                <IconBtn titulo="Anular" icono="🚫" tono="text-rose-600" onClick={() => setAnulando(j)} />
                              )}
                              {j.estado === "Ganador" && !j.pagado_en && (
                                <IconBtn
                                  titulo="Marcar pagada"
                                  icono="🤲"
                                  tono="text-emerald-600"
                                  onClick={() => void accionSimple(() => marcarJugadaPagada(j.id, usuario), "Jugada marcada como pagada.")}
                                />
                              )}
                              <IconBtn titulo="Historial" icono="🕙" onClick={() => void verHistorial(j)} />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {editando && <ModalEditar jugada={editando} onCancelar={() => setEditando(null)} onGuardar={guardarEdicion} />}
      {anulando && <ModalAnular jugada={anulando} onCancelar={() => setAnulando(null)} onConfirmar={confirmarAnulacion} />}
      {historial && (
        <ModalHistorial
          jugada={historial.jugada}
          items={historial.items}
          onCerrar={() => setHistorial(null)}
        />
      )}
    </div>
  );
}

function TarjetaResumen({ titulo, valor, pie, tono }: { titulo: string; valor: string; pie: string; tono: string }) {
  return (
    <div className={`rounded-2xl border border-line p-3 ${tono}`}>
      <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">{titulo}</p>
      <p className="mt-0.5 text-lg font-black text-slate-800">{valor}</p>
      <p className="text-[10px] font-semibold uppercase text-slate-400">{pie}</p>
    </div>
  );
}

function IconBtn({ titulo, icono, onClick, tono = "text-slate-500" }: { titulo: string; icono: string; onClick: () => void; tono?: string }) {
  return (
    <button
      type="button"
      title={titulo}
      onClick={onClick}
      className={`rounded-md border border-line px-1.5 py-1 text-[11px] transition-colors hover:bg-slate-100 ${tono}`}
    >
            <span>{icono}</span>
    </button>
  );
}

function ModalEditar({
  jugada,
  onCancelar,
  onGuardar,
}: {
  jugada: JugadaAdmin;
  onCancelar: () => void;
  onGuardar: (campos: Parameters<typeof editarJugada>[1], motivo: string) => Promise<void>;
}) {
  const [nombre, setNombre] = useState(jugada.nombre_jugada ?? "");
  const [caballo, setCaballo] = useState(jugada.caballo ?? "");
  const [ejemplar, setEjemplar] = useState(jugada.ejemplar_numero != null ? String(jugada.ejemplar_numero) : "");
  const [monto, setMonto] = useState(jugada.monto_jugado != null ? String(jugada.monto_jugado) : "");
  const [decidido, setDecidido] = useState(jugada.monto_decidido != null ? String(jugada.monto_decidido) : "");
  const [premio, setPremio] = useState(jugada.premio_pagar != null ? String(jugada.premio_pagar) : "");
  const [estado, setEstado] = useState(jugada.estado ?? "Pendiente");
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);

  const guardar = async () => {
    if (!motivo.trim()) return toast("Indicá el motivo de la corrección.", "warning");
    setGuardando(true);
    await onGuardar(
      {
        nombre_jugada: nombre.trim(),
        caballo: caballo.trim(),
        ejemplar_numero: ejemplar.trim() === "" ? null : Number(ejemplar),
        monto_jugado: monto.trim() === "" ? null : Number(monto),
        monto_decidido: decidido.trim() === "" ? null : Number(decidido),
        premio_pagar: premio.trim() === "" ? null : Number(premio),
        estado,
      },
      motivo
    );
    setGuardando(false);
  };

  return (
    <Overlay onCerrar={onCancelar} titulo={`Corregir jugada · ${jugada.cliente_juega_nombre ?? ""}`}>
      <div className="grid grid-cols-2 gap-3">
        <Campo label="Jugada">
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} className={inputClase} />
        </Campo>
        <Campo label="Caballo">
          <input value={caballo} onChange={(e) => setCaballo(e.target.value)} className={inputClase} />
        </Campo>
        <Campo label="Nº ejemplar">
          <input value={ejemplar} onChange={(e) => setEjemplar(e.target.value.replace(/\D/g, ""))} className={inputClase} />
        </Campo>
        <Campo label="Estado">
          <select value={estado} onChange={(e) => setEstado(e.target.value)} className={inputClase}>
            {ESTADOS_JUGADA.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </Campo>
        <Campo label="Monto jugado">
          <input value={monto} onChange={(e) => setMonto(e.target.value.replace(/[^\d.]/g, ""))} className={inputClase} />
        </Campo>
        <Campo label="Monto decidido">
          <input value={decidido} onChange={(e) => setDecidido(e.target.value.replace(/[^\d.]/g, ""))} className={inputClase} />
        </Campo>
        <Campo label="Premio a pagar">
          <input value={premio} onChange={(e) => setPremio(e.target.value.replace(/[^\d.]/g, ""))} className={inputClase} />
        </Campo>
        <Campo label="Motivo (obligatorio)" className="col-span-2">
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Por qué se corrige" className={inputClase} />
        </Campo>
      </div>
      <p className="mt-2 text-[10px] text-amber-600">
        Cambiar montos o premios no ajusta el saldo del cliente por sí solo: verificalo en contabilidad.
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancelar}>
          Cancelar
        </Button>
        <Button variant="default" size="sm" disabled={guardando} onClick={() => void guardar()}>
          {guardando ? "Guardando…" : "Guardar corrección"}
        </Button>
      </div>
    </Overlay>
  );
}

function ModalAnular({
  jugada,
  onCancelar,
  onConfirmar,
}: {
  jugada: JugadaAdmin;
  onCancelar: () => void;
  onConfirmar: (motivo: string, imagen: string | null) => Promise<void>;
}) {
  const [motivo, setMotivo] = useState<string>(MOTIVOS_ANULACION[0]);
  const [detalle, setDetalle] = useState("");
  const [imagen, setImagen] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [procesando, setProcesando] = useState(false);

  const elegirImagen = async (file: File | null) => {
    if (!file) return;
    setSubiendo(true);
    try {
      setImagen(await comprimirImagen(file));
      toast("Imagen adjuntada a la anulación.", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "No se pudo procesar la imagen.", "error");
    } finally {
      setSubiendo(false);
    }
  };

  const confirmar = async () => {
    const texto = detalle.trim() ? `${motivo}: ${detalle.trim()}` : motivo;
    setProcesando(true);
    await onConfirmar(texto, imagen);
    setProcesando(false);
  };

  return (
    <Overlay onCerrar={onCancelar} titulo={`Anular jugada · ${jugada.cliente_juega_nombre ?? ""}`}>
      <div className="space-y-3">
        <Campo label="Motivo (auditable)">
          <select value={motivo} onChange={(e) => setMotivo(e.target.value)} className={inputClase}>
            {MOTIVOS_ANULACION.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Campo>
        <Campo label="Observación">
          <textarea
            value={detalle}
            onChange={(e) => setDetalle(e.target.value)}
            rows={3}
            placeholder="Detalle adicional para el registro"
            className={inputClase}
          />
        </Campo>
        <div>
          <p className="text-[10px] font-bold uppercase text-slate-400">Imagen de verificación (opcional)</p>
          <div className="mt-1 flex items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => void elegirImagen(e.target.files?.[0] ?? null)}
            />
            <Button variant="outline" size="sm" disabled={subiendo} onClick={() => fileRef.current?.click()}>
              <span className="mr-1">📷</span> {subiendo ? "Procesando…" : "Adjuntar foto"}
            </Button>
            {imagen && (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imagen} alt="Verificación" className="h-16 w-24 rounded-lg border border-line object-cover" />
                <button
                  type="button"
                  onClick={() => setImagen(null)}
                  className="absolute -right-2 -top-2 rounded-full bg-rose-600 px-1.5 text-[10px] font-bold text-white"
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancelar}>
          Cancelar
        </Button>
        <Button variant="danger" size="sm" disabled={procesando} onClick={() => void confirmar()}>
          {procesando ? "Anulando…" : "Confirmar anulación"}
        </Button>
      </div>
    </Overlay>
  );
}

function ModalHistorial({ jugada, items, onCerrar }: { jugada: JugadaAdmin; items: AuditoriaJugada[]; onCerrar: () => void }) {
  return (
    <Overlay onCerrar={onCerrar} titulo={`Historial · ${jugada.cliente_juega_nombre ?? ""}`}>
      {items.length === 0 ? (
        <p className="py-6 text-center text-xs text-slate-400">Sin movimientos de auditoría.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((a) => (
            <li key={String(a.id)} className="rounded-lg border border-line p-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-black uppercase text-slate-700">{a.accion}</span>
                <span className="text-[10px] text-slate-400">{a.creado_at ? new Date(a.creado_at).toLocaleString("es-VE") : ""}</span>
              </div>
              <p className="text-slate-600">
                {a.motivo ?? "—"} <span className="text-slate-400">·</span> {a.usuario ?? "—"}
              </p>
              {a.imagen && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.imagen} alt="Verificación" className="mt-1 h-20 w-28 rounded border border-line object-cover" />
              )}
            </li>
          ))}
        </ul>
      )}
    </Overlay>
  );
}

const inputClase =
  "mt-0.5 w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500";

function Campo({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <label className={`block text-[10px] font-bold uppercase text-slate-400 ${className}`}>
      {label}
      {children}
    </label>
  );
}

function Overlay({ titulo, children, onCerrar }: { titulo: string; children: ReactNode; onCerrar: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-slate-900/60 p-4">
      <div className="mt-8 w-full max-w-xl rounded-2xl bg-white p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between border-b border-line pb-2">
          <h3 className="text-sm font-black uppercase text-slate-800">{titulo}</h3>
          <button type="button" onClick={onCerrar} className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <span className="text-lg">✕</span>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default JugadasModule;
