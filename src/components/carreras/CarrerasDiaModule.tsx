"use client";

import { getHorseColor } from "@/lib/horseColors";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ToastHost } from "@/components/ui/ToastHost";
import { listarHipodromos, type OpcionHipodromo } from "@/lib/tablas/rpc";
import { nombrePropioHipodromo } from "@/lib/hipodromos/nombre";
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
import { claveCarrera, claveHipodromo } from "@/lib/carreras/claves";
import { marcarCarreraVerificada, guardarInvalidadosRemate } from "@/lib/carreras/maestro";
import { MonitorHipodromos } from "@/components/ui/MonitorHipodromos";
import { agruparPorHipodromo } from "@/lib/carreras/agruparHipodromos";
import { ModalMarcasEditor } from "@/components/marcas/ModalMarcasEditor";

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
 * Gestión de Jugadas, Tablas Fijas y Dupletas.
 */
export function CarrerasDiaModule() {
  const [hipodromos, setHipodromos] = useState<OpcionHipodromo[]>([]);
  const [hipodromo, setHipodromo] = useState("");
  const [fecha, setFecha] = useState(() => hoyLocal());
  const nombreHipoFiltro = nombrePropioHipodromo(hipodromo, hipodromos);

  /** Todas las carreras de `fecha`, sin filtro de hipódromo. */
  const [todas, setTodas] = useState<CarreraCentral[]>([]);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [modal, setModal] = useState<ModalForm>(() => vacioModal());
  const [confirmarEliminar, setConfirmarEliminar] = useState<CarreraCentral | null>(null);
  // El módulo de Marcas vive dentro del módulo hípico: se abre sobre la carrera
  // que se está mirando, sin salir de la tabla de carreras del día.
  const [editorMarcas, setEditorMarcas] = useState<{ hipodromo: string; carrera: number } | null>(null);
  /** Muestra las carreras del filtro que llegaron sin ejemplares (ocultas por defecto). */
  const [verSinEjemplares, setVerSinEjemplares] = useState(false);

  const toast = useCallback((msg: string, tipo: "success" | "warning" | "error" | "info" = "info") => {
    window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));
  }, []);

  // El día arranca en hoy y el filtro en "todos los hipódromos": no se
  // preselecciona ningún hipódromo, así la jornada completa se ve de entrada.
  useEffect(() => {
    let v = true;
    void listarHipodromos().then((hs) => {
      if (!v) return;
      setHipodromos(hs);
    });
    return () => {
      v = false;
    };
  }, []);

  /**
   * Una sola carga por día: TODAS las carreras de la fecha, sin filtrar. El
   * editor y el monitor beben del mismo array, así el filtro por hipódromo es
   * instantáneo y ambos paneles siempre muestran la misma data.
   */
  const refrescar = useCallback(async () => {
    setCargando(true);
    const r = await listarCarrerasCentrales(fecha, "");
    setCargando(false);
    if (!r.ok) {
      toast(r.error ?? "No se pudo leer las carreras del día.", "error");
      return;
    }
    setTodas(r.datos ?? []);
  }, [fecha, toast]);

  useEffect(() => {
    void refrescar();
  }, [fecha, refrescar]);

  /** Vista del editor: sin hipódromo seleccionado, todas las de la fecha. */
  const carreras = useMemo(() => {
    // Comparación por clave normalizada, no por texto: el hipódromo llega del
    // selector en una forma ("LARINCONADA") y la fila lo trae como lo escribió
    // el operador ("LA RINCONADA"). Con `===` el editor se quedaba vacío
    // mientras el monitor, que normaliza, sí mostraba la jornada.
    const h = claveHipodromo(hipodromo);
    return h ? todas.filter((c) => claveHipodromo(c.hipodromo) === h) : todas;
  }, [todas, hipodromo]);

  /**
   * Una carrera sin ejemplares no se puede jugar ni rematar: la fila solo
   * mostraba "Sin ejemplares registrados" y ocupaba el mismo lugar que una
   * carrera real (con 13 del día, varias filas eran puro ruido). Se ocultan,
   * pero NO se borran ni se pierden: el contador de arriba las deja a un clic,
   * porque a la carrera que quedó sin ejemplares hay que poder abrirla y
   * cargárselos.
   */
  const conEjemplares = useMemo(() => carreras.filter((c) => (c.caballos?.length ?? 0) > 0), [carreras]);
  const sinEjemplares = useMemo(() => carreras.filter((c) => (c.caballos?.length ?? 0) === 0), [carreras]);
  const carrerasVisibles = verSinEjemplares ? carreras : conEjemplares;

  const gruposMonitor = useMemo(
    () =>
      agruparPorHipodromo(
        todas.map((c) => ({
          id: c.id,
          hipodromo: c.hipodromo,
          carrera: c.carrera,
          estado: c.estado,
        })),
        fecha
      ),
    [todas, fecha]
  );

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
    // El filtro arranca en "todos", pero para guardar hay que elegir uno.
    if (!hipodromo)
      return toast("Elija un hipódromo para registrar la carrera (arriba, en el filtro).", "warning");
    if (!num) return toast("Nº de carrera requerido.", "warning");
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
    // que propaga a Tablas Fijas, Dupletas y Taquilla, reembolsa lo
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

  const alternarVerificada = async (c: CarreraCentral) => {
    const r = await marcarCarreraVerificada(fecha, c.hipodromo, c.carrera, !c.verificado);
    if (!r.ok) return toast("No se pudo marcar: " + (r.error ?? "sin conexión"), "error");
    toast(
      c.verificado
        ? `C${c.carrera} vuelve a estado sin verificar.`
        : `✔️ C${c.carrera} verificada. Queda registrado quién y cuándo.`,
      "success"
    );
    void refrescar();
  };

  const alternarInvalitado = async (c: CarreraCentral, numero: string) => {
    const lista = new Set(c.invalidados ?? []);
    const estaba = lista.has(numero);
    if (estaba) lista.delete(numero);
    else lista.add(numero);
    const r = await guardarInvalidadosRemate(fecha, c.hipodromo, c.carrera, [...lista]);
    if (!r.ok) return toast("No se pudo invalidar: " + (r.error ?? "sin conexión"), "error");
    toast(
      estaba
        ? `Nº ${numero} vuelve a ser pujable en Remates.`
        : `Nº ${numero} invalidado para Remates: no puja y no requiere valor. No se retira de los demás módulos.`,
      "success"
    );
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
          <p className="text-xs font-medium text-cyan-100">Data central de la jornada — alimenta Gestión, Tablas y Dupletas.</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={hipodromo}
            onChange={(e) => setHipodromo(e.target.value)}
            className="rounded-lg border border-cyan-400/60 bg-white px-2 py-1 text-xs font-bold uppercase text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
          >
            <option value="">Todos los hipódromos</option>
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

      {/* Monitor de Hipódromos del Día — mismo panel y mismo CSS que Tablas Fijas */}
      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <MonitorHipodromos
          grupos={gruposMonitor}
          filtro={hipodromo}
          onFiltro={(h) => setHipodromo(h)}
          fecha={fecha}
          onFecha={(f) => setFecha(f || hoyLocal())}
          vacio={`Sin carreras registradas en la fecha ${fecha}. Regístralas con el formulario de abajo o desde Ejemplares y Gaceta.`}
        />
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
        {sinEjemplares.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] font-semibold text-amber-800">
            <span>
              ⚠️ {sinEjemplares.length} carrera(s) del filtro sin ejemplares
              {verSinEjemplares ? "" : " (ocultas del listado)"}.
            </span>
            <button
              type="button"
              onClick={() => setVerSinEjemplares((v) => !v)}
              className="rounded border border-amber-300 bg-white px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-amber-800 transition-colors hover:bg-amber-100"
            >
              {verSinEjemplares ? "Ocultarlas" : "Mostrarlas"}
            </button>
          </div>
        )}
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
              {!cargando && carrerasVisibles.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-2 py-4 text-center text-xs font-semibold text-amber-600">
                    {sinEjemplares.length > 0 && !verSinEjemplares ? (
                      <>⚠️ Las {carreras.length} carreras del filtro no tienen ejemplares: mostralas para cargárselos.</>
                    ) : (
                      <>⚠️ No hay carreras registradas para {hipodromo || "este hipódromo"} · {fecha}.</>
                    )}
                  </td>
                </tr>
              )}
              {carrerasVisibles.map((c, i) => {
                const n = c.caballos?.length ?? 0;
                return (
                  <tr
                    key={claveCarrera(c.hipodromo, c.carrera, fecha)}
                    className={i % 2 ? "bg-cyan-50/50" : "bg-white"}
                  >
                    <td className="border border-cyan-100 px-1 py-1 text-center text-sm font-extrabold text-cyan-700">
                      C{c.carrera}
                    </td>
                    <td className="border border-cyan-100 px-1 py-1 align-middle">
                      {n === 0 ? (
                        <span className="text-[10px] font-semibold text-slate-400">Sin ejemplares registrados</span>
                      ) : (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                          <span className="text-[10px] font-bold text-slate-500">{n} ejemplar(es)</span>
                          <span className="text-[9px] font-semibold text-slate-400">
                            clic en un ejemplar = invalidar solo en Remates (INV)
                          </span>
                          <span className="flex flex-wrap gap-0.5">
                            {(c.caballos ?? []).map((cb) => {
                              const nombre = cb.nombre?.trim();
                              const ret = Boolean(cb.retirado) || (c.retirados ?? []).includes(String(cb.numero));
                              const guald = getHorseColor(cb.numero);
                              const inv = (c.invalidados ?? []).includes(String(cb.numero));
                              // El chip entero alterna INV: si el badge solo aparecia
                              // cuando ya estaba invalidado, no habia forma de
                              // invalidar desde aca. Retirado manda sobre INV (un
                              // ejemplar fuera no puja igual), asi que ahi no aplica.
                              const alternaInv = !ret;
                              const etiqueta = ret
                                ? `${nombre || `Nº ${cb.numero}`} — retirado en esta carrera`
                                : inv
                                  ? `${nombre || `Nº ${cb.numero}`} — invalidado para Remates. Clic para revertir.`
                                  : `${nombre || `Nº ${cb.numero}`} — clic para invalidar solo en Remates`;
                              return (
                                <span
                                  key={cb.numero}
                                  title={etiqueta}
                                  role={alternaInv ? "button" : undefined}
                                  tabIndex={alternaInv ? 0 : undefined}
                                  onClick={alternaInv ? () => void alternarInvalitado(c, String(cb.numero)) : undefined}
                                  onKeyDown={
                                    alternaInv
                                      ? (e) => {
                                          if (e.key === "Enter" || e.key === " ") {
                                            e.preventDefault();
                                            void alternarInvalitado(c, String(cb.numero));
                                          }
                                        }
                                      : undefined
                                  }
                                  className={`inline-flex items-center gap-1 rounded border px-1 py-0.5 text-[10px] font-bold leading-none ${
                                    ret
                                      ? "border-red-300 bg-red-50"
                                      : inv
                                        ? "border-amber-400 bg-amber-50"
                                        : `${guald.border} ${guald.bg} ${guald.text}`
                                  } ${alternaInv ? "cursor-pointer hover:ring-1 hover:ring-amber-400" : ""}`}
                                >
                                  <span
                                    className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm text-[9px] font-black leading-none ${
                                      ret ? "bg-red-200 text-red-700 line-through" : ""
                                    }`}
                                  >
                                    {cb.numero}
                                  </span>
                                  {ret && <span className="font-black text-red-600">⛔</span>}
                                  {nombre && (
                                    <span className={`font-semibold ${ret ? "text-red-600" : "opacity-80"}`}>
                                      · {nombre}
                                    </span>
                                  )}
                                  {inv && !ret && (
                                    <span className="rounded bg-amber-200 px-1 text-[9px] font-black leading-none text-amber-900">
                                      INV
                                    </span>
                                  )}
                                </span>
                              );
                            })}
                          </span>
                          {(c.retirados?.length ?? 0) > 0 && (
                            <span className="inline-flex items-center gap-0.5 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-black leading-none text-red-700">
                              RETIRADOS:
                              <span className="flex gap-0.5">
                                {(c.retirados ?? []).map((rn) => (
                                  <span
                                    key={rn}
                                    className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm bg-red-200 text-[9px] font-black leading-none text-red-700 line-through"
                                  >
                                    {rn}
                                  </span>
                                ))}
                              </span>
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
                    <td className="border border-cyan-100 px-1 py-1 align-middle">
                      <div className="flex flex-col items-start gap-1">
                        <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => alternarVerificada(c)}
                          title={
                            c.verificado
                              ? `Verificada por ${c.verificado_por ?? "—"} · volver a marcar como pendiente`
                              : "Marcar esta carrera como verificada"
                          }
                          className={`rounded px-1.5 py-0.5 text-[11px] transition-colors ${
                            c.verificado
                              ? "bg-emerald-600 text-white hover:bg-emerald-500"
                              : "bg-slate-200 text-slate-500 hover:bg-emerald-100 hover:text-emerald-700"
                          }`}
                        >
                          ✓
                        </button>
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
                          onClick={() => setEditorMarcas({ hipodromo: c.hipodromo, carrera: c.carrera })}
                          title="Marcas: configurar NV y debutantes de esta carrera"
                          className="rounded bg-cyan-600 px-1.5 py-0.5 text-[11px] text-white transition-colors hover:bg-cyan-500"
                        >
                          🏷️
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
                        <div className="max-w-[16rem] text-[9px] leading-tight text-slate-500">
                          {c.verificado ? (
                            <>
                              <span className="font-bold text-emerald-700">Verificada</span>
                              {c.verificado_por ? ` por ${c.verificado_por}` : ""}
                              {c.verificado_at ? ` · ${c.verificado_at.slice(0, 16).replace("T", " ")}` : ""}
                            </>
                          ) : (
                            <>
                              <span className="font-bold text-amber-700">Sin verificar</span>
                              {c.actualizado_por ? ` · última edición: ${c.actualizado_por}` : ""}
                            </>
                          )}
                        </div>
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
                ¿Quitar la carrera C{confirmarEliminar.carrera} de la jornada de {nombreHipoFiltro} · {fecha}?
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

      {/* Editor de marcas (NV + debutantes) de la carrera elegida. La ventana de
          ventas y resultados vive en el panel de Marcas, que es donde se lleva
          el seguimiento de la jornada. */}
      {editorMarcas && (
        <ModalMarcasEditor
          hipodromoInicial={editorMarcas.hipodromo}
          carreraInicial={editorMarcas.carrera}
          onCerrar={() => setEditorMarcas(null)}
          onToast={toast}
          onCambio={() => void refrescar()}
        />
      )}
    </div>
  );
}

export default CarrerasDiaModule;