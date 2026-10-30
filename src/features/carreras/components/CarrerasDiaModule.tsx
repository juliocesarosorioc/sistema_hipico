"use client";

import { getHorseColor } from "@/shared/lib/horseColors";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/shared/components/ui/Button";
import { ToastHost } from "@/shared/components/ui/ToastHost";
import { BuscadorJornada } from "@/shared/components/ui/BuscadorJornada";
import { BotonDictadoAudio } from "@/shared/components/ui/BotonDictadoAudio";
import { interpretarAudioCarrera } from "@/features/carreras/lib/audio-carrera";
import { listarHipodromos } from "@/features/hipodromos/lib/servicio";
import type { Hipodromo } from "@/features/hipodromos/lib/tipos";
import { useVersionLogos } from "@/shared/store/useHipodromosStore";
import { useCarrerasDiaStore } from "@/shared/store/useCarrerasDiaStore";
import {
  nombreHipodromoParaMostrar,
  nombrePropioHipodromo,
  opcionesHipodromo,
} from "@/features/hipodromos/lib/nombre";
import {
  eliminarCarreraCentral,
  guardarCarreraCentral,
  listarCarrerasCentrales,
  numerosEjemplares,
  type CarreraCentral,
  type EjemplarCarreraCentral,
} from "@/features/carreras/lib/central";
import { aplicarRetirosCarrera, parsearRetirados } from "@/features/carreras/lib/retiros";
import { claveCarrera, claveHipodromo } from "@/features/carreras/lib/claves";
import { marcarCarreraVerificada, guardarInvalidadosRemate } from "@/features/carreras/lib/maestro";
import { MonitorHipodromos } from "@/shared/components/ui/MonitorHipodromos";
import { agruparPorHipodromo } from "@/features/carreras/lib/agruparHipodromos";
import { ModalMarcasEditor } from "@/features/marcas/components/ModalMarcasEditor";

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

/** Parsea un textarea o línea de ejemplares: cada línea o coma "numero nombre" (o solo numero). */
function parsearEjemplares(txt: string): EjemplarCarreraCentral[] {
  const salida: EjemplarCarreraCentral[] = [];
  const normalizado = txt.includes("\n") ? txt : txt.replace(/[,;]+/g, "\n");
  for (const lineaRaw of normalizado.split("\n")) {
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

const CHIPS_EJEMPLARES_RAPIDOS = [6, 8, 9, 10, 11, 12, 14, 16];

/**
 * Carreras del Día — editor CENTRAL de la jornada (data única).
 * Optimizado para carga táctil rápida desde el celular y dictado por voz / audio.
 */
export function CarrerasDiaModule() {
  const [catalogo, setCatalogo] = useState<Hipodromo[]>([]);
  const hipodromos = useMemo(() => opcionesHipodromo(catalogo), [catalogo]);
  const versionLogos = useVersionLogos();
  const [hipodromo, setHipodromo] = useState("");
  const fecha = useCarrerasDiaStore((s) => s.fechaSeleccionada);
  const setFecha = useCarrerasDiaStore((s) => s.setFecha);
  const nombreHipoFiltro = nombrePropioHipodromo(hipodromo, hipodromos);

  /** Todas las carreras de `fecha`, sin filtro de hipódromo. */
  const [todas, setTodas] = useState<CarreraCentral[]>([]);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [modal, setModal] = useState<ModalForm>(() => vacioModal());
  const [confirmarEliminar, setConfirmarEliminar] = useState<CarreraCentral | null>(null);
  const [editorMarcas, setEditorMarcas] = useState<{ hipodromo: string; carrera: number; fecha: string } | null>(null);
  const [verSinEjemplares, setVerSinEjemplares] = useState(false);
  const [ultimoDictado, setUltimoDictado] = useState<{ texto: string; resumen: string[] } | null>(null);
  const [rangoLote, setRangoLote] = useState<{ desde: number; hasta: number; ejemplares: number } | null>(null);

  const toast = useCallback((msg: string, tipo: "success" | "warning" | "error" | "info" = "info") => {
    window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));
  }, []);

  useEffect(() => {
    let v = true;
    void listarHipodromos().then((r) => {
      if (!v) return;
      setCatalogo(r.data);
    });
    return () => {
      v = false;
    };
  }, [versionLogos]);

  const refrescar = useCallback(async () => {
    if (!fecha) {
      setTodas([]);
      setCargando(false);
      return;
    }
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

  const carreras = useMemo(() => {
    const h = claveHipodromo(hipodromo);
    return h ? todas.filter((c) => claveHipodromo(c.hipodromo) === h) : todas;
  }, [todas, hipodromo]);

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
  const hipodromosDelDia = useMemo(() => todas.map((c) => c.hipodromo), [todas]);

  const previstos = useMemo(
    () => [...new Set(carreras.map((c) => Number(c.carrera) || 0))].sort((a, b) => a - b),
    [carreras]
  );
  const masAlto = previstos.length ? previstos[previstos.length - 1] : 0;

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

  /**
   * Procesa el dictado por voz / audio y rellena los campos del formulario
   * (o del modal de edición si está abierto).
   */
  const aplicarDictadoAudio = useCallback(
    (texto: string) => {
      const info = interpretarAudioCarrera(texto);
      setUltimoDictado({ texto: info.textoOriginal, resumen: info.resumen });

      if (info.rangoCarreras) {
        setRangoLote({
          desde: info.rangoCarreras.desde,
          hasta: info.rangoCarreras.hasta,
          ejemplares: info.cantidadEjemplares ?? 12,
        });
      }

      setModal((prev) => {
        const carreraSugerida = info.carrera ?? (prev.carrera || String(masAlto + 1));
        let ejemplaresNuevos = prev.ejemplares;
        if (info.ejemplaresLista.length > 0) {
          const bloque = info.ejemplaresLista.map((e) => `${e.numero} ${e.nombre}`).join("\n");
          ejemplaresNuevos = prev.editar && prev.ejemplares.trim() ? `${prev.ejemplares.trim()}\n${bloque}` : bloque;
        } else if (info.ejemplaresTexto) {
          ejemplaresNuevos = info.ejemplaresTexto;
        }
        return {
          ...prev,
          abierta: true,
          carrera: carreraSugerida,
          ejemplares: ejemplaresNuevos,
          distancia: info.distancia ?? prev.distancia,
          superficie: info.superficie ?? prev.superficie,
          premio: info.premio ?? prev.premio,
          hora: info.hora ?? prev.hora,
          retirados: info.retirados ?? prev.retirados,
        };
      });

      toast(
        info.resumen.length > 0
          ? `🎙️ Interpretado: ${info.resumen.join(" · ")}`
          : `🎙️ Dictado recibido: "${texto}"`,
        "info"
      );
    },
    [masAlto, toast]
  );

  const guardarLoteCarreras = async (desde: number, hasta: number, cantEjemplares: number) => {
    if (!fecha) return toast("Seleccione primero una fecha en el buscador.", "warning");
    if (!hipodromo) return toast("Elija un hipódromo arriba antes de crear el lote.", "warning");
    setGuardando(true);
    let creadas = 0;
    const caballos = numerosEjemplares(Math.max(1, cantEjemplares));
    for (let n = desde; n <= hasta; n++) {
      const r = await guardarCarreraCentral({
        fecha,
        hipodromo,
        carrera: n,
        caballos,
        distancia: modal.distancia.trim() || null,
        superficie: modal.superficie.trim().toUpperCase() || "ARENA",
        premio: modal.premio.trim() ? Number(modal.premio) : null,
        hora: null,
      });
      if (r.ok) creadas++;
    }
    setGuardando(false);
    setRangoLote(null);
    toast(`✅ ${creadas} carrera(s) registradas en lote (C${desde}–C${hasta} con ${cantEjemplares} ejemplares).`, "success");
    void refrescar();
  };

  const guardar = async () => {
    const num = Number(modal.carrera) || 0;
    if (!fecha) return toast("Seleccione primero una fecha en el buscador.", "warning");
    if (!hipodromo) return toast("Elija un hipódromo para registrar la carrera (arriba, en el filtro).", "warning");
    if (!num) return toast("Nº de carrera requerido.", "warning");

    const textoEj = modal.ejemplares.trim();
    const esSoloNumero = /^\d{1,2}$/.test(textoEj);
    const rapido = esSoloNumero ? Number(textoEj) : 0;
    const ejemplaresConNombre = !esSoloNumero ? parsearEjemplares(textoEj) : [];

    const caballos =
      ejemplaresConNombre.length > 0
        ? ejemplaresConNombre
        : rapido > 0
          ? numerosEjemplares(rapido)
          : modal.editar
            ? parsearEjemplares(textoEj)
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
    // Al registrar desde celular, avanzamos automáticamente el número sugerido a la siguiente carrera
    const siguienteNum = !modal.editar ? String(num + 1) : "";
    setModal({ ...vacioModal(), abierta: !modal.editar, carrera: siguienteNum, ejemplares: esSoloNumero ? textoEj : "" });
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
    const r = await eliminarCarreraCentral(fecha, hipodromo || c.hipodromo, c.carrera);
    if (!r.ok) return toast("Error al eliminar: " + (r.error ?? "desconocido"), "error");
    toast(`🗑️ Carrera C${c.carrera} quitada del día (no se borran tablas ni jugadas).`, "success");
    setConfirmarEliminar(null);
    void refrescar();
  };

  return (
    <div className="space-y-3">
      <ToastHost />

      {/* Cabecera */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-cyan-200 bg-cyan-700 px-4 py-2.5 text-white shadow-sm">
        <div className="flex items-center gap-2.5">
          <span className="text-2xl">🏁</span>
          <div>
            <h2 className="text-base font-extrabold uppercase tracking-wide sm:text-lg">Carreras del Día</h2>
            <p className="text-[11px] font-medium text-cyan-100">
              Carga móvil rápida, manual y por voz — alimenta Apuestas, Tablas y Dupletas.
            </p>
          </div>
        </div>
        <BotonDictadoAudio
          etiqueta="🎙️ Dictar Carrera / Ejemplares"
          modo="carrera"
          onTextoReconocido={aplicarDictadoAudio}
        />
      </div>

      <BuscadorJornada
        fecha={fecha}
        onFecha={(valor) => setFecha(valor || "")}
        hipodromo={hipodromo}
        onHipodromo={setHipodromo}
        hipodromos={[{ value: "", label: "Todos los hipódromos" }, ...hipodromos]}
        delDia={hipodromosDelDia}
        columnas={7}
        placeholderHipodromo="Todos los hipódromos"
      />

      {/* Monitor de Hipódromos del Día */}
      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <MonitorHipodromos
          grupos={gruposMonitor}
          filtro={hipodromo}
          onFiltro={(h) => setHipodromo(h)}
          fecha={fecha}
          onFecha={(f) => setFecha(f || "")}
          vacio={
            !fecha
              ? "Selecciona una fecha en el buscador de arriba para consultar el monitor."
              : `Sin carreras registradas en la fecha ${fecha}. Regístralas abajo con un toque o dictando por audio.`
          }
        />
      </div>

      {/* Panel de Registro Manual Optimizado para Celular + Dictado por Voz */}
      <div className="rounded-2xl border border-cyan-200 bg-white p-3 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
          <div>
            <h3 className="text-xs font-black uppercase tracking-wider text-cyan-800">
              📱 Carga Manual Rápida (Celular / Audio)
            </h3>
            <p className="text-[10px] font-semibold text-slate-500">
              Toca el Nº de carrera y la cantidad de ejemplares, o dicta: <i>&ldquo;Carrera 3 con 12 ejemplares 1600 metros arena&rdquo;</i>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <BotonDictadoAudio
              compacto
              etiqueta="🎙️ Dictar"
              modo="carrera"
              onTextoReconocido={aplicarDictadoAudio}
            />
            <button
              type="button"
              onClick={() =>
                setRangoLote((prev) =>
                  prev ? null : { desde: 1, hasta: 10, ejemplares: 12 }
                )
              }
              className="rounded-lg border border-cyan-300 bg-cyan-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-cyan-800 hover:bg-cyan-100 active:scale-95"
            >
              ⚡ Crear Lote (C1–C10)
            </button>
          </div>
        </div>

        {ultimoDictado && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50/70 px-3 py-1.5 text-[11px]">
            <div className="min-w-0">
              <span className="font-black text-rose-700">🎙️ Audio interpretado:</span>{" "}
              <span className="italic text-slate-700">&ldquo;{ultimoDictado.texto}&rdquo;</span>
              {ultimoDictado.resumen.length > 0 && (
                <span className="ml-2 rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-black text-white">
                  {ultimoDictado.resumen.join(" · ")}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setUltimoDictado(null)}
              className="text-xs font-bold text-slate-400 hover:text-slate-600"
            >
              ✕
            </button>
          </div>
        )}

        {/* Generador de lote de carreras en 1 toque (ideal para celular) */}
        {rangoLote && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-300 bg-emerald-50/80 p-2.5 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-black uppercase text-emerald-900">⚡ Lote de Carreras:</span>
              <label className="inline-flex items-center gap-1 font-bold text-slate-700">
                Desde C
                <input
                  type="number"
                  min={1}
                  max={25}
                  value={rangoLote.desde}
                  onChange={(e) => setRangoLote((r) => (r ? { ...r, desde: Number(e.target.value) || 1 } : null))}
                  className="w-14 rounded border border-emerald-400 bg-white px-2 py-1 text-center font-black"
                />
              </label>
              <label className="inline-flex items-center gap-1 font-bold text-slate-700">
                Hasta C
                <input
                  type="number"
                  min={1}
                  max={25}
                  value={rangoLote.hasta}
                  onChange={(e) => setRangoLote((r) => (r ? { ...r, hasta: Number(e.target.value) || 10 } : null))}
                  className="w-14 rounded border border-emerald-400 bg-white px-2 py-1 text-center font-black"
                />
              </label>
              <label className="inline-flex items-center gap-1 font-bold text-slate-700">
                Ejemplares c/u:
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={rangoLote.ejemplares}
                  onChange={(e) => setRangoLote((r) => (r ? { ...r, ejemplares: Number(e.target.value) || 12 } : null))}
                  className="w-16 rounded border border-emerald-400 bg-white px-2 py-1 text-center font-black"
                />
              </label>
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                variant="success"
                size="sm"
                disabled={guardando || !hipodromo || !fecha}
                onClick={() => void guardarLoteCarreras(rangoLote.desde, rangoLote.hasta, rangoLote.ejemplares)}
              >
                {guardando ? "Creando…" : `💾 Crear C${rangoLote.desde} a C${rangoLote.hasta}`}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setRangoLote(null)}>
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {/* Botonera táctil para celular: Selección de Carrera y Cantidad de Ejemplares en 1 toque */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                1. Toca Nº Carrera
              </span>
              <button
                type="button"
                onClick={() => setModal((m) => ({ ...m, abierta: true, carrera: String(masAlto + 1) }))}
                className="rounded bg-cyan-600 px-2 py-0.5 text-[10px] font-black text-white hover:bg-cyan-500"
              >
                Siguiente: C{masAlto + 1}
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              {Array.from({ length: 12 }, (_, idx) => idx + 1).map((n) => {
                const activa = modal.abierta && Number(modal.carrera) === n;
                const yaExiste = previstos.includes(n);
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setModal((m) => ({ ...m, abierta: true, carrera: String(n) }))}
                    className={`h-8 min-w-[2.1rem] rounded-lg border px-1.5 text-xs font-black transition active:scale-95 ${
                      activa
                        ? "border-cyan-700 bg-cyan-600 text-white ring-2 ring-cyan-300"
                        : yaExiste
                          ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    C{n}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                2. Toca Cantidad de Ejemplares
              </span>
              <span className="text-[10px] font-bold text-slate-400">o escribe nombres abajo</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {CHIPS_EJEMPLARES_RAPIDOS.map((cant) => {
                const activo = modal.abierta && modal.ejemplares.trim() === String(cant);
                return (
                  <button
                    key={cant}
                    type="button"
                    onClick={() =>
                      setModal((m) => ({
                        ...m,
                        abierta: true,
                        carrera: m.carrera || String(masAlto + 1),
                        ejemplares: String(cant),
                      }))
                    }
                    className={`h-8 min-w-[2.4rem] rounded-lg border px-2 text-xs font-black transition active:scale-95 ${
                      activo
                        ? "border-indigo-700 bg-indigo-600 text-white ring-2 ring-indigo-300"
                        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    {cant} ej.
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Campos detallados */}
        <div className="grid grid-cols-2 gap-x-2.5 gap-y-2 sm:grid-cols-3 xl:grid-cols-6">
          <label className="block">
            <span className={inputLbl}>Nº Carrera</span>
            <input
              value={modal.abierta ? modal.carrera : ""}
              onChange={(e) => setModal((m) => ({ ...m, abierta: true, carrera: e.target.value }))}
              placeholder={String(masAlto + 1)}
              inputMode="numeric"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-black text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            />
          </label>
          <label className="block col-span-1 sm:col-span-2 xl:col-span-1">
            <span className={inputLbl}>Ejemplares (Cant. o 1 NOMBRE)</span>
            <input
              value={modal.abierta ? modal.ejemplares : ""}
              onChange={(e) => setModal((m) => ({ ...m, abierta: true, ejemplares: e.target.value }))}
              placeholder="12 ó 1 RAYO, 2 SOL"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-bold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            />
          </label>
          <label className="block">
            <span className={inputLbl}>Distancia (m)</span>
            <input
              value={modal.abierta ? modal.distancia : ""}
              onChange={(e) => setModal((m) => ({ ...m, abierta: true, distancia: e.target.value }))}
              placeholder="1600"
              inputMode="numeric"
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
            <span className={inputLbl}>Retirados (opc.)</span>
            <input
              value={modal.abierta ? modal.retirados : ""}
              onChange={(e) => setModal((m) => ({ ...m, abierta: true, retirados: e.target.value }))}
              placeholder="ej. 2,5"
              className="w-full rounded-lg border border-red-200 bg-red-50/40 px-3 py-2 text-sm font-bold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            />
          </label>
          <div className="col-span-2 flex items-end gap-2 sm:col-span-3 xl:col-span-1">
            <Button
              variant="success"
              size="md"
              className="w-full py-2.5 font-black"
              onClick={() => void guardar()}
              disabled={guardando || !hipodromo || !fecha}
            >
              {guardando ? "Guardando…" : "💾 Registrar Carrera"}
            </Button>
          </div>
        </div>
      </div>

      {/* Listado del día (Tarjetas táctiles en Celular + Tabla en Escritorio) */}
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

        {/* Vista Móvil (Tarjetas ergonómicas para celular) */}
        <div className="divide-y divide-cyan-100 md:hidden">
          {cargando && (
            <div className="px-3 py-4 text-center text-xs font-semibold text-slate-500">
              Cargando carreras del día…
            </div>
          )}
          {!cargando && carrerasVisibles.length === 0 && (
            <div className="px-3 py-5 text-center text-xs font-semibold text-amber-600">
              {sinEjemplares.length > 0 && !verSinEjemplares ? (
                <>⚠️ Las {carreras.length} carreras del filtro no tienen ejemplares: tócalas arriba en &ldquo;Mostrarlas&rdquo; para cargárselos.</>
              ) : !fecha ? (
                <>📅 Selecciona una fecha en el buscador de arriba para consultar o registrar carreras.</>
              ) : (
                <>⚠️ No hay carreras registradas para {nombreHipodromoParaMostrar(hipodromo) || "este hipódromo"} · {fecha}.</>
              )}
            </div>
          )}
          {carrerasVisibles.map((c) => {
            const n = c.caballos?.length ?? 0;
            return (
              <div key={claveCarrera(c.hipodromo, c.carrera, fecha)} className="p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-700 text-xs font-black text-white">
                      C{c.carrera}
                    </span>
                    <div>
                      <div className="text-xs font-black text-slate-800">
                        {nombreHipodromoParaMostrar(c.hipodromo)} · {n} ejemplar(es)
                      </div>
                      <div className="text-[10px] font-semibold text-slate-500">
                        {c.distancia ? `${c.distancia}m` : "—"} · {c.superficie ?? "ARENA"}
                        {c.hora ? ` · 🕒 ${c.hora}` : ""}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => void alternarVerificada(c)}
                      className={`rounded-lg px-2.5 py-1.5 text-xs font-black ${
                        c.verificado
                          ? "bg-emerald-600 text-white"
                          : "bg-slate-200 text-slate-600"
                      }`}
                    >
                      ✓
                    </button>
                    <button
                      type="button"
                      onClick={() => abrirEditar(c)}
                      className="rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-black text-white"
                    >
                      ✏️ Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditorMarcas({ hipodromo: c.hipodromo, carrera: c.carrera, fecha })}
                      className="rounded-lg bg-cyan-600 px-2 py-1.5 text-xs font-black text-white"
                    >
                      🏷️
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmarEliminar(c)}
                      className="rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-600"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
                {n > 0 && (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {(c.caballos ?? []).map((cb) => {
                      const nombre = cb.nombre?.trim();
                      const ret = Boolean(cb.retirado) || (c.retirados ?? []).includes(String(cb.numero));
                      const guald = getHorseColor(cb.numero);
                      const inv = (c.invalidados ?? []).includes(String(cb.numero));
                      return (
                        <button
                          key={cb.numero}
                          type="button"
                          disabled={ret}
                          onClick={() => !ret && void alternarInvalitado(c, String(cb.numero))}
                          className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-1 text-[11px] font-bold leading-none ${
                            ret
                              ? "border-red-300 bg-red-50 text-red-600 line-through"
                              : inv
                                ? "border-amber-400 bg-amber-50 text-amber-900"
                                : `${guald.border} ${guald.bg} ${guald.text}`
                          }`}
                        >
                          <span className="font-black">{cb.numero}</span>
                          {nombre && <span className="max-w-[7rem] truncate">· {nombre}</span>}
                          {inv && !ret && <span className="rounded bg-amber-200 px-1 text-[9px] font-black">INV</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Vista Escritorio (Tabla completa) */}
        <div className="hidden overflow-x-auto md:block">
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
                    ) : !fecha ? (
                      <>📅 Selecciona una fecha en el buscador de arriba para consultar o registrar carreras.</>
                    ) : (
                      <>⚠️ No hay carreras registradas para {nombreHipodromoParaMostrar(hipodromo) || "este hipódromo"} · {fecha}.</>
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
                            onClick={() => void alternarVerificada(c)}
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
                            onClick={() => setEditorMarcas({ hipodromo: c.hipodromo, carrera: c.carrera, fecha })}
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
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50/60 px-3 py-2">
                <span className="text-[11px] font-bold text-rose-800">
                  🎙️ Dicta ejemplares o cambios por voz:
                </span>
                <BotonDictadoAudio
                  compacto
                  etiqueta="🎙️ Dictar Ejemplares"
                  modo="carrera"
                  onTextoReconocido={aplicarDictadoAudio}
                />
              </div>
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
                <div className="mb-1 flex flex-wrap items-center justify-between gap-1">
                  <span className={inputLbl}>Ejemplares (1 NOMBRE por línea · o toca cantidad rápida)</span>
                  <div className="flex gap-1">
                    {[6, 8, 10, 12, 14].map((cant) => (
                      <button
                        key={cant}
                        type="button"
                        onClick={() =>
                          setModal((m) => ({
                            ...m,
                            ejemplares: Array.from({ length: cant }, (_, idx) => String(idx + 1)).join("\n"),
                          }))
                        }
                        className="rounded border border-cyan-300 bg-cyan-50 px-1.5 py-0.5 text-[10px] font-black text-cyan-800 hover:bg-cyan-100"
                      >
                        1..{cant}
                      </button>
                    ))}
                  </div>
                </div>
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
                ¿Quitar la carrera C{confirmarEliminar.carrera} de la jornada de {nombreHipoFiltro || confirmarEliminar.hipodromo} · {fecha}?
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

      {editorMarcas && (
        <ModalMarcasEditor
          hipodromoInicial={editorMarcas.hipodromo}
          carreraInicial={editorMarcas.carrera}
          fechaInicial={editorMarcas.fecha}
          onCerrar={() => setEditorMarcas(null)}
          onToast={toast}
          onCambio={() => void refrescar()}
        />
      )}
    </div>
  );
}

export default CarrerasDiaModule;
