"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ToastHost } from "@/components/ui/ToastHost";
import { listarHipodromos, type OpcionHipodromo } from "@/lib/tablas/rpc";
import { hoyLocal } from "@/lib/gaceta/programa";
import {
  eliminarCarreraCentral,
  guardarCarreraCentral,
  listarCarrerasCentrales,
  numerosEjemplares,
  type CarreraCentral,
  type EjemplarCarreraCentral,
} from "@/lib/carreras/central";
import { aplicarRetirosCarrera, parsearRetirados } from "@/lib/carreras/retiros";

const inputLbl = "text-[10px] font-bold uppercase tracking-wider text-slate-500";

type ModalForm = {
  abierta: boolean;
  editar?: CarreraCentral | null;
  carrera: string;
  ejemplares: string;
  distancia: string;
  superficie: string;
  premio: string;
  hora: string;
  retirados: string;
};

const vacioModal = (): ModalForm => ({
  abierta: false,
  editar: null,
  carrera: "",
  ejemplares: "",
  distancia: "",
  superficie: "ARENA",
  premio: "",
  hora: "",
  retirados: "",
});

/** Parsea un textarea de ejemplares: cada línea "numero nombre" (o solo numero). */
function parsearEjemplares(txt: string): EjemplarCarreraCentral[] {
  const salida: EjemplarCarreraCentral[] = [];
  for (const lineaRaw of txt.split("\n")) {
    const linea = lineaRaw.trim();
    if (!linea) continue;
    const trozos = linea.split(/\s+/);
    const numero = trozos[0]?.replace(/^N[:ºo]?/i, "").trim() ?? "";
    const nombre = trozos.slice(1).join(" ").trim();
    if (!numero) continue;
    salida.push(nombre ? { numero, nombre: nombre.toUpperCase() } : { numero });
  }
  return salida;
}

/** Texto editable de ejemplares a partir de la lista persistida. */
function ejemplaresATexto(caballos: EjemplarCarreraCentral[] | undefined): string {
  return (caballos ?? [])
    .map((c) => (c.nombre ? `${c.numero} ${c.nombre}` : c.numero))
    .join("\n");
}

/**
 * Carreras del Día — editor CENTRAL de la jornada (data única).
 * Registra las carreras que se van a jugar — incluso con ejemplares SOLO por
 * número (sin nombres) para apostar por número y resolver con la pizarra.
 * `resultados_carreras` es la fuente de verdad que ya alimenta el semáforo de
 * Gestión de Jugadas, Marcas, Tablas Fijas y Dupletas.
 */
export function CarrerasDiaModule() {
  const [hipodromos, setHipodromos] = useState<OpcionHipodromo[]>([]);
  const [hipodromo, setHipodromo] = useState("");
  const [fecha, setFecha] = useState(() => hoyLocal());

  const [carreras, setCarreras] = useState<CarreraCentral[]>([]);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [modal, setModal] = useState<ModalForm>(() => vacioModal());
  const [confirmarEliminar, setConfirmarEliminar] = useState<CarreraCentral | null>(null);

  const toast = useCallback((msg: string, tipo: "success" | "warning" | "error" | "info" = "info") => {
    window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));
  }, []);

  useEffect(() => {
    let v = true;
    void listarHipodromos().then((hs) => {
      if (!v) return;
      setHipodromos(hs);
      if (hs.length && !hipodromo) setHipodromo(hs[0].value);
    });
    return () => {
      v = false;
    };
  }, [hipodromo]);

  const refrescar = useCallback(async () => {
    setCargando(true);
    const r = await listarCarrerasCentrales(fecha, hipodromo);
    setCargando(false);
    if (!r.ok) {
      toast(r.error ?? "No se pudo leer las carreras del día.", "error");
      return;
    }
    setCarreras(r.datos ?? []);
  }, [fecha, hipodromo, toast]);

  useEffect(() => {
    if (hipodromo) void refrescar();
  }, [fecha, hipodromo, refrescar]);

  const abrirEditar = (c: CarreraCentral) => {
    setModal({
      abierta: true,
      editar: c,
      carrera: String(c.carrera),
      ejemplares: ejemplaresATexto(c.caballos),
      distancia: c.distancia ?? "",
      superficie: c.superficie ?? "ARENA",
      premio: c.premio != null ? String(c.premio) : "",
      hora: c.hora ?? "",
      retirados: (c.retirados ?? []).join(","),
    });
  };

  const guardar = async () => {
    const num = Number(modal.carrera) || 0;
    if (!hipodromo || !num) return toast("Hipódromo y Nº de carrera requeridos.", "warning");
    const ejemplares = modal.editar ? parsearEjemplares(modal.ejemplares) : [];
    // Registro rápido: si solo escribió un número en el campo ejemplares, se
    // interpreta como CANTIDAD de ejemplares (genera 1..n).
    const rapido = Number(modal.ejemplares.trim());
    const caballos =
      ejemplares.length > 0 || modal.editar
        ? ejemplares
        : Number.isFinite(rapido) && rapido > 0
          ? numerosEjemplares(rapido)
          : [];
    setGuardando(true);
    const r = await guardarCarreraCentral({
      fecha,
      hipodromo,
      carrera: num,
      caballos,
      distancia: modal.distancia.trim() || null,
      superficie: modal.superficie.trim().toUpperCase() || null,
      premio: modal.premio.trim() ? Number(modal.premio) : null,
      hora: modal.hora.trim() || null,
    });
    setGuardando(false);
    if (!r.ok) return toast("Error al guardar: " + (r.error ?? "desconocido"), "error");

    // RETIROS: lista canónica de la carrera. Se escribe por el servicio único,
    // que propaga a Tablas Fijas, Marcas, Dupletas y Taquilla, reembolsa lo
    // pendiente y recalcula premios.
    const ret = await aplicarRetirosCarrera({
      fecha,
      hipodromo,
      carrera: num,
      numeros: parsearRetirados(modal.retirados),
    });
    if (!ret.ok) return toast("Carrera guardada, pero los retiros no se propagaron: " + (ret.error ?? "sin conexión"), "warning");

    const base = modal.editar
      ? `✏️ Carrera C${num} actualizada (${caballos.length} ejemplar(es)).`
      : `✅ Carrera C${num} registrada (${caballos.length} ejemplar(es)).`;
    const detalle = ret.retirados.length
      ? ` ⛔ Retirados ${ret.retirados.join(",")} · ${ret.tablasAfectadas} tabla(s) sincronizada(s)` +
        (ret.reembolsos ? ` · ${ret.reembolsos} ticket(s) reembolsado(s)` : "")
      : "";
    toast(base + detalle, "success");
    setModal(vacioModal());
    void refrescar();
  };

  const eliminar = async (c: CarreraCentral) => {
    const r = await eliminarCarreraCentral(fecha, hipodromo, c.carrera);
    if (!r.ok) return toast("Error al eliminar: " + (r.error ?? "desconocido"), "error");
    toast(`🗑️ Carrera C${c.carrera} quitada del día (no se borran tablas ni jugadas).`, "success");
    setConfirmarEliminar(null);
    void refrescar();
  };

  const previstos = useMemo(
    () => [...new Set(carreras.map((c) => Number(c.carrera) || 0))].sort((a, b) => a - b),
    [carreras]
  );
  const masAlto = previstos.length ? previstos[previstos.length - 1] : 0;

  return (
    <div className="space-y-3">
      <ToastHost />

      {/* Cabecera */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-cyan-200 bg-cyan-700 px-4 py-2.5 text-white shadow-sm">
        <span className="text-2xl">🏁</span>
        <div>
          <h2 className="text-lg font-extrabold uppercase tracking-wide">Carreras del Día</h2>
          <p className="text-xs font-medium text-cyan-100">Data central de la jornada — alimenta Gestión, Tablas, Marcas y Dupletas.</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={hipodromo}
            onChange={(e) => setHipodromo(e.target.value)}
            className="rounded-lg border border-cyan-400/60 bg-white px-2 py-1 text-xs font-bold uppercase text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
          >
            <option value="">Hipódromo…</option>
            {hipodromos.map((h) => (
              <option key={h.value} value={h.value}>
                {h.label}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value || hoyLocal())}
            className="rounded-lg border border-cyan-400/60 bg-white px-2 py-1 text-xs font-bold uppercase text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
          />
        </div>
      </div>

      {/* Ayuda de uso */}
      <div className="rounded-lg border border-cyan-200 bg-cyan-50/60 px-3 py-1.5 text-[10px] font-semibold leading-relaxed text-cyan-900">
        📌 Registre hoy las carreras que se van a jugar. Puede cargar una carrera <b>solo con el Nº de ejemplares</b>{" "}
        (ej. <b>15</b>) cuando no se tiene la información completa (caso carrera extranjera): se generan los números 1..15
        sin nombres y la pizarra decide el ganador. Si ya tiene nombres, escríbalos como <b>1 NOMBRE DEL CABALLO</b> (uno por línea).
      </div>

      {/* Registro rápido */}
      <div className="rounded-2xl border border-cyan-200 bg-white p-3 shadow-sm">
        <div className="grid grid-cols-1 gap-x-3 gap-y-1.5 md:grid-cols-4 xl:grid-cols-6">
          <label className="block">
            <span className={inputLbl}>Nº Carrera</span>
            <input
              value={modal.abierta ? modal.carrera : ""}
              onChange={(e) => setModal((m) => ({ ...m, abierta: true, carrera: e.target.value }))}
              placeholder="1"
              inputMode="numeric"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-black text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            />
          </label>
          <label className="block">
            <span className={inputLbl}>Ejemplares (Nº o cantidad)</span>
            <input
              value={modal.abierta ? modal.ejemplares : ""}
              onChange={(e) => setModal((m) => ({ ...m, abierta: true, ejemplares: e.target.value }))}
              placeholder="15"
              inputMode="numeric"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-bold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            />
          </label>
          <label className="block">
            <span className={inputLbl}>Distancia (m)</span>
            <input
              value={modal.abierta ? modal.distancia : ""}
              onChange={(e) => setModal((m) => ({ ...m, abierta: true, distancia: e.target.value }))}
              placeholder="1600"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-bold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            />
          </label>
          <label className="block">
            <span className={inputLbl}>Superficie</span>
            <select
              value={modal.abierta ? modal.superficie : "ARENA"}
              onChange={(e) => setModal((m) => ({ ...m, abierta: true, superficie: e.target.value }))}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-black uppercase text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              {["ARENA", "PASTO", "HIPICA", "SINTETICA"].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={inputLbl}>Premio</span>
            <input
              value={modal.abierta ? modal.premio : ""}
              onChange={(e) => setModal((m) => ({ ...m, abierta: true, premio: e.target.value }))}
              placeholder="0.00"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-bold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            />
          </label>
          <label className="block">
            <span className={inputLbl}>Hora</span>
            <input
              value={modal.abierta ? modal.hora : ""}
              onChange={(e) => setModal((m) => ({ ...m, abierta: true, hora: e.target.value }))}
              placeholder="14:30"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-bold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            />
            <Button variant="success" size="sm" className="mt-1 w-full" onClick={() => void guardar()} disabled={guardando || !hipodromo}>
              {guardando ? "Guardando…" : "💾 Registrar Carrera"}
            </Button>
          </label>
        </div>
      </div>

      {/* Listado del día */}
      <div className="overflow-hidden rounded-lg border border-cyan-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-cyan-700 text-cyan-50">
                <th className="w-14 border border-cyan-800 px-1 py-1 text-center text-[10px] font-bold uppercase">Nº</th>
                <th className="border border-cyan-800 px-1 py-1 text-left text-[10px] font-bold uppercase">Ejemplares</th>
                <th className="border border-cyan-800 px-1 py-1 text-center text-[10px] font-bold uppercase">Dist.</th>
                <th className="border border-cyan-800 px-1 py-1 text-center text-[10px] font-bold uppercase">Sup.</th>
                <th className="border border-cyan-800 px-1 py-1 text-right text-[10px] font-bold uppercase">Premio</th>
                <th className="border border-cyan-800 px-1 py-1 text-center text-[10px] font-bold uppercase">Hora</th>
                <th className="w-20 border border-cyan-800 px-1 py-1 text-center text-[10px] font-bold uppercase">—</th>
              </tr>
            </thead>
            <tbody>
              {cargando && (
                <tr>
                  <td colSpan={7} className="px-2 py-3 text-center text-xs font-semibold text-slate-500">
                    Cargando carreras del día…
                  </td>
                </tr>
              )}
              {!cargando && carreras.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-2 py-4 text-center text-xs font-semibold text-amber-600">
                    ⚠️ No hay carreras registradas para {hipodromo || "este hipódromo"} · {fecha}.
                  </td>
                </tr>
              )}
              {carreras.map((c, i) => {
                const n = c.caballos?.length ?? 0;
                return (
                  <tr key={`${c.hipodromo}-${c.carrera}`} className={i % 2 ? "bg-cyan-50/50" : "bg-white"}>
                    <td className="border border-cyan-100 px-1 py-1 text-center text-sm font-extrabold text-cyan-700">
                      C{c.carrera}
                    </td>
                    <td className="border border-cyan-100 px-1 py-1 align-middle">
                      {n === 0 ? (
                        <span className="text-[10px] font-semibold text-slate-400">Sin ejemplares registrados</span>
                      ) : (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                          <span className="text-[10px] font-bold text-slate-500">{n} ejemplar(es)</span>
                          <span className="flex flex-wrap gap-0.5">
                            {(c.caballos ?? []).map((cb) => {
                              const nombre = cb.nombre?.trim();
                              const ret = Boolean(cb.retirado) || (c.retirados ?? []).includes(String(cb.numero));
                              return (
                                <span
                                  key={cb.numero}
                                  title={nombre || `Nº ${cb.numero}`}
                                  className={`inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] font-bold ${
                                    ret ? "bg-red-100 text-red-700 line-through" : "bg-slate-100 text-slate-700"
                                  }`}
                                >
                                  {cb.numero}
                                  {ret && <span className="font-black">⛔</span>}
                                  {nombre && <span className="font-semibold text-slate-500">· {nombre}</span>}
                                </span>
                              );
                            })}
                          </span>
                          {(c.retirados?.length ?? 0) > 0 && (
                            <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-black text-red-700">
                              RETIRADOS: {(c.retirados ?? []).join(", ")}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="border border-cyan-100 px-1 py-1 text-center font-bold text-slate-700">{c.distancia ?? "—"}</td>
                    <td className="border border-cyan-100 px-1 py-1 text-center text-[10px] font-bold uppercase text-slate-600">{c.superficie ?? "—"}</td>
                    <td className="border border-cyan-100 px-1 py-1 text-right font-bold text-slate-700">
                      {c.premio != null ? Number(c.premio).toLocaleString("es-VE", { maximumFractionDigits: 2 }) : "—"}
                    </td>
                    <td className="border border-cyan-100 px-1 py-1 text-center font-bold text-slate-700">{c.hora ?? "—"}</td>
                    <td className="border border-cyan-100 px-1 py-1 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => abrirEditar(c)}
                          title="Editar carrera"
                          className="rounded bg-indigo-600 px-1.5 py-0.5 text-[11px] text-white transition-colors hover:bg-indigo-500"
                        >
                          ✏️
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmarEliminar(c)}
                          title="Quitar del día (no borra tablas ni jugadas)"
                          className="rounded px-1 py-0.5 text-[11px] text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!cargando && previstos.length > 0 && (
          <div className="flex items-center justify-between border-t border-cyan-100 bg-cyan-50 px-3 py-1.5 text-[10px] font-semibold text-slate-500">
            <span>{previstos.length} carrera(s) en la jornada</span>
            <span>Asignadas: {previstos.join(", ")} · siguiente: C{masAlto + 1}</span>
          </div>
        )}
      </div>

      {/* Modal edición completa */}
      {modal.abierta && modal.editar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4" onClick={() => setModal(vacioModal())}>
          <div className="w-full max-w-lg rounded-2xl border border-cyan-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between rounded-t-2xl bg-cyan-700 px-4 py-2.5 text-white">
              <h3 className="text-sm font-extrabold uppercase tracking-wide">✏️ Editar Carrera C{modal.carrera}</h3>
              <button type="button" onClick={() => setModal(vacioModal())} className="text-lg leading-none hover:text-cyan-200">
                ✕
              </button>
            </div>
            <div className="space-y-3 p-4">
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className={inputLbl}>Distancia (m)</span>
                  <input value={modal.distancia} onChange={(e) => setModal((m) => ({ ...m, distancia: e.target.value }))} placeholder="1600" className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm font-bold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500" />
                </label>
                <label className="block">
                  <span className={inputLbl}>Superficie</span>
                  <select value={modal.superficie} onChange={(e) => setModal((m) => ({ ...m, superficie: e.target.value }))} className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm font-black uppercase text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500">
                    {["ARENA", "PASTO", "HIPICA", "SINTETICA"].map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className={inputLbl}>Premio</span>
                  <input value={modal.premio} onChange={(e) => setModal((m) => ({ ...m, premio: e.target.value }))} className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm font-bold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500" />
                </label>
                <label className="block">
                  <span className={inputLbl}>Hora</span>
                  <input value={modal.hora} onChange={(e) => setModal((m) => ({ ...m, hora: e.target.value }))} className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm font-bold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500" />
                </label>
              </div>
              <label className="block">
                <span className={inputLbl}>Retirados de la carrera (aplica a TODOS los módulos · vacío = NO HUBO RETIROS)</span>
                <input
                  value={modal.retirados}
                  onChange={(e) => setModal((m) => ({ ...m, retirados: e.target.value }))}
                  placeholder='ej. "2,5" o "2-5"'
                  className="w-full rounded-lg border border-red-200 bg-red-50/40 px-3 py-2 text-sm font-bold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                />
              </label>
              <label className="block">
                <span className={inputLbl}>Ejemplares (1 NOMBRE por línea · solo número si no se conoce)</span>
                <textarea
                  value={modal.ejemplares}
                  onChange={(e) => setModal((m) => ({ ...m, ejemplares: e.target.value }))}
                  rows={8}
                  placeholder={"1 ALFOMBRA\n2 QUINTO PATIO\n3\n4\n15"}
                  className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs font-bold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
                />
              </label>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-cyan-100 px-4 py-3">
              <Button variant="ghost" size="md" onClick={() => setModal(vacioModal())}>
                Cancelar
              </Button>
              <Button variant="success" size="md" onClick={() => void guardar()} disabled={guardando}>
                {guardando ? "Guardando…" : "💾 Guardar"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmación de baja */}
      {confirmarEliminar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4" onClick={() => setConfirmarEliminar(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-red-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between rounded-t-2xl border-b border-red-200 bg-red-50 px-4 py-3">
              <h3 className="text-xs font-black uppercase text-red-700">🗑️ Quitar carrera C{confirmarEliminar.carrera}</h3>
              <button type="button" onClick={() => setConfirmarEliminar(null)} className="text-red-400 hover:text-red-600">✕</button>
            </div>
            <div className="space-y-2 p-4">
              <p className="text-sm font-bold text-slate-800">
                ¿Quitar la carrera C{confirmarEliminar.carrera} de la jornada de {hipodromo} · {fecha}?
              </p>
              <p className="text-[11px] font-semibold text-slate-500">
                No se borran las tablas fijas publicadas ni las jugadas ya registradas: solo sale de la lista central del día.
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-red-100 bg-gray-50 px-4 py-3">
              <Button variant="ghost" size="sm" onClick={() => setConfirmarEliminar(null)}>Cancelar</Button>
              <Button variant="danger" size="sm" onClick={() => void eliminar(confirmarEliminar)}>🗑️ Quitar</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default CarrerasDiaModule;