"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { getHorseColor } from "@/shared/lib/horseColors";
import { nombreHipodromoParaMostrar } from "@/features/hipodromos/lib/nombre";
import { Button } from "@/shared/components/ui/Button";
import {
  obtenerAnalisisRiesgoMarcas,
  guardarLimitesMarcas,
  ampliarCupoMarca,
  modificarOrdenMarcas,
  type AnalisisRiesgoMarcas,
  type AnalisisMarcaItem,
  type LimitesMarcas,
} from "@/features/marcas/lib/control-riesgo-marcas";

type Props = {
  abierto: boolean;
  hipodromo: string;
  carrera: number;
  fecha: string;
  onCerrar: () => void;
  onActualizado?: () => void;
};

export function ControlRiesgoMarcasModal({
  abierto,
  hipodromo,
  carrera,
  fecha,
  onCerrar,
  onActualizado,
}: Props) {
  const [tabActiva, setTabActiva] = useState<"riesgo" | "orden" | "limites" | "compradores">("riesgo");
  const [analisis, setAnalisis] = useState<AnalisisRiesgoMarcas | null>(null);
  const [cargando, setCargando] = useState(false);
  const [aviso, setAviso] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // Submodal para ampliar cupo de una marca específica
  const [ampliandoMarca, setAmpliandoMarca] = useState<AnalisisMarcaItem | null>(null);
  const [montoAmpliacion, setMontoAmpliacion] = useState("60");
  const [motivoAmpliacion, setMotivoAmpliacion] = useState("Demanda de jugadores en taquilla/portal");
  const [procesandoAmpliacion, setProcesandoAmpliacion] = useState(false);

  // Submodal para ver compradores de una marca
  const [viendoCompradores, setViendoCompradores] = useState<AnalisisMarcaItem | null>(null);

  // Estado para modificar orden de marcas
  const [nuevoOrdenMarcas, setNuevoOrdenMarcas] = useState<string[]>([]);
  const [motivoOrden, setMotivoOrden] = useState("Rebalanceo de jerarquía por exposición al riesgo");
  const [guardandoOrden, setGuardandoOrden] = useState(false);

  // Estado para editar límites de la plataforma y grupo
  const [limiteGeneralInput, setLimiteGeneralInput] = useState("120");
  const [limiteGrupoInput, setLimiteGrupoInput] = useState("60");
  const [guardandoLimites, setGuardandoLimites] = useState(false);

  const cargarDatos = useCallback(async () => {
    if (!hipodromo || !carrera || !fecha) return;
    setCargando(true);
    setErrorMsg("");
    try {
      const data = await obtenerAnalisisRiesgoMarcas(hipodromo, carrera, fecha);
      setAnalisis(data);
      if (data) {
        setNuevoOrdenMarcas([...data.marcasConfiguradas]);
        setLimiteGeneralInput(String(data.limites.limite_general_plataforma ?? 120));
        setLimiteGrupoInput(String(data.limites.limite_por_grupo ?? 60));
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Error al cargar análisis de riesgo.");
    } finally {
      setCargando(false);
    }
  }, [hipodromo, carrera, fecha]);

  useEffect(() => {
    if (abierto) {
      void cargarDatos();
      setAviso("");
      setErrorMsg("");
    }
  }, [abierto, cargarDatos]);

  if (!abierto) return null;

  const ejecutarAmpliacion = async () => {
    if (!ampliandoMarca) return;
    const monto = parseFloat(montoAmpliacion);
    if (!(monto > 0)) {
      setErrorMsg("Indique un monto de ampliación válido mayor a cero.");
      return;
    }

    setProcesandoAmpliacion(true);
    setErrorMsg("");
    setAviso("");

    const r = await ampliarCupoMarca({
      hipodromo,
      carrera,
      fecha,
      caballoNumero: ampliandoMarca.caballoNumero,
      montoAdicional: monto,
      motivo: motivoAmpliacion,
    });

    setProcesandoAmpliacion(false);
    if (!r.ok) {
      setErrorMsg(r.error ?? "No se pudo ampliar el cupo.");
      return;
    }

    setAviso(
      `🔓 Cupo ampliado exitosamente para la Marca #${ampliandoMarca.caballoNumero} (+ $${monto}). Nuevo límite: $${r.nuevoLimite}.`
    );
    setAmpliandoMarca(null);
    void cargarDatos();
    onActualizado?.();
  };

  const ejecutarGuardarOrden = async () => {
    if (nuevoOrdenMarcas.length === 0) {
      setErrorMsg("Debe haber al menos una marca en el orden.");
      return;
    }

    setGuardandoOrden(true);
    setErrorMsg("");
    setAviso("");

    const r = await modificarOrdenMarcas({
      hipodromo,
      carrera,
      fecha,
      nuevasMarcas: nuevoOrdenMarcas.join("/"),
      motivo: motivoOrden,
    });

    setGuardandoOrden(false);
    if (!r.ok) {
      setErrorMsg(r.error ?? "No se pudo guardar el nuevo orden de marcas.");
      return;
    }

    setAviso(`✅ Jerarquía de marcas actualizada exitosamente: ${nuevoOrdenMarcas.join(" → ")}`);
    void cargarDatos();
    onActualizado?.();
  };

  const moverMarca = (indiceOrigen: number, direccion: -1 | 1) => {
    const destino = indiceOrigen + direccion;
    if (destino < 0 || destino >= nuevoOrdenMarcas.length) return;
    const copia = [...nuevoOrdenMarcas];
    const temp = copia[indiceOrigen];
    copia[indiceOrigen] = copia[destino];
    copia[destino] = temp;
    setNuevoOrdenMarcas(copia);
  };

  const ejecutarGuardarLimites = async () => {
    const limGen = parseFloat(limiteGeneralInput);
    const limGrp = parseFloat(limiteGrupoInput);

    if (!(limGen > 0) || !(limGrp > 0)) {
      setErrorMsg("Indique límites válidos mayores a cero.");
      return;
    }

    setGuardandoLimites(true);
    setErrorMsg("");
    setAviso("");

    const nuevos: LimitesMarcas = {
      ...(analisis?.limites ?? {}),
      limite_general_plataforma: limGen,
      limite_por_grupo: limGrp,
    };

    const r = await guardarLimitesMarcas(hipodromo, carrera, fecha, nuevos);
    setGuardandoLimites(false);
    if (!r.ok) {
      setErrorMsg(r.error ?? "No se pudieron guardar los límites.");
      return;
    }

    setAviso("✅ Límites de la plataforma y por grupo guardados con éxito.");
    void cargarDatos();
    onActualizado?.();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-3 sm:p-5 overflow-y-auto"
      role="dialog"
      aria-modal
    >
      <div className="my-auto w-full max-w-5xl rounded-2xl bg-white shadow-2xl overflow-hidden border border-slate-200 max-h-[94vh] flex flex-col">
        {/* CABECERA */}
        <div className="flex flex-wrap items-center justify-between gap-2 bg-gradient-to-r from-cyan-900 via-indigo-900 to-slate-900 px-5 py-3.5 text-white shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="text-2xl">🛡️</span>
            <div>
              <div className="text-[10px] font-black uppercase tracking-wider text-cyan-300">
                Control de Pérdida & Gestión de Cupos de Marcas
              </div>
              <h2 className="text-base sm:text-lg font-black leading-tight">
                {nombreHipodromoParaMostrar(hipodromo)} · Carrera {carrera} · {fecha}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            className="rounded-lg bg-white/10 px-2.5 py-1 text-xs font-bold text-white hover:bg-white/20"
          >
            ✕ Cerrar
          </button>
        </div>

        {/* METRICAS DE RIESGO SUPERIORES */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 bg-slate-900 px-5 py-3 text-white shrink-0 border-b border-slate-800">
          <div className="rounded-xl bg-white/5 p-2.5 border border-white/10">
            <div className="text-[9px] font-black uppercase tracking-wider text-slate-400">Total Recaudado</div>
            <div className="text-lg font-black text-emerald-400">
              ${(analisis?.totalRecaudado ?? 0).toLocaleString("es-VE", { minimumFractionDigits: 2 })}
            </div>
            <div className="text-[10px] text-slate-400">{analisis?.totalJugadas ?? 0} jugadas registradas</div>
          </div>

          <div className="rounded-xl bg-white/5 p-2.5 border border-white/10">
            <div className="text-[9px] font-black uppercase tracking-wider text-slate-400">Peor Escenario</div>
            <div
              className={`text-lg font-black ${
                (analisis?.peorEscenario.balanceNeto ?? 0) < 0 ? "text-rose-400" : "text-emerald-400"
              }`}
            >
              ${(analisis?.peorEscenario.balanceNeto ?? 0).toLocaleString("es-VE", { minimumFractionDigits: 2 })}
            </div>
            <div className="text-[10px] text-slate-400">
              Caballo #{analisis?.peorEscenario.caballoNumero || "—"}
            </div>
          </div>

          <div className="rounded-xl bg-white/5 p-2.5 border border-white/10">
            <div className="text-[9px] font-black uppercase tracking-wider text-slate-400">Límite Plataforma</div>
            <div className="text-lg font-black text-cyan-300">
              ${analisis?.limites.limite_general_plataforma ?? 120}
            </div>
            <div className="text-[10px] text-slate-400">Por marca individual</div>
          </div>

          <div className="rounded-xl bg-white/5 p-2.5 border border-white/10">
            <div className="text-[9px] font-black uppercase tracking-wider text-slate-400">Límite Grupo</div>
            <div className="text-lg font-black text-amber-300">
              ${analisis?.limites.limite_por_grupo ?? 60}
            </div>
            <div className="text-[10px] text-slate-400">Por marca / grupo</div>
          </div>
        </div>

        {/* ALERTAS Y MENSAJES */}
        {analisis?.hayCupoAgotado && (
          <div className="bg-rose-50 border-b border-rose-200 px-5 py-2 text-xs font-bold text-rose-800 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <span>🚨</span>
              <span>
                Hay marcas que han alcanzado el tope de cupo o límite de riesgo en esta carrera. Los jugadores no
                podrán comprar hasta que amplíes el cupo o modifiques el orden.
              </span>
            </span>
          </div>
        )}

        {aviso && (
          <div className="bg-emerald-50 border-b border-emerald-200 px-5 py-2 text-xs font-bold text-emerald-800">
            {aviso}
          </div>
        )}

        {errorMsg && (
          <div className="bg-rose-50 border-b border-rose-200 px-5 py-2 text-xs font-bold text-rose-800">
            {errorMsg}
          </div>
        )}

        {/* NAVEGACIÓN DE PESTAÑAS */}
        <div className="flex border-b border-slate-200 bg-slate-50 px-5 pt-2 shrink-0 overflow-x-auto gap-2">
          <button
            type="button"
            onClick={() => setTabActiva("riesgo")}
            className={`px-4 py-2 text-xs font-black uppercase tracking-wider border-b-2 transition-colors ${
              tabActiva === "riesgo"
                ? "border-cyan-600 text-cyan-700 bg-white rounded-t-lg"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            📊 Matriz de Riesgo por Marca
          </button>
          <button
            type="button"
            onClick={() => setTabActiva("orden")}
            className={`px-4 py-2 text-xs font-black uppercase tracking-wider border-b-2 transition-colors ${
              tabActiva === "orden"
                ? "border-cyan-600 text-cyan-700 bg-white rounded-t-lg"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            ✏️ Modificar Orden / Jerarquía
          </button>
          <button
            type="button"
            onClick={() => setTabActiva("limites")}
            className={`px-4 py-2 text-xs font-black uppercase tracking-wider border-b-2 transition-colors ${
              tabActiva === "limites"
                ? "border-cyan-600 text-cyan-700 bg-white rounded-t-lg"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            ⚙️ Límites de Plataforma y Grupos
          </button>
          <button
            type="button"
            onClick={() => setTabActiva("compradores")}
            className={`px-4 py-2 text-xs font-black uppercase tracking-wider border-b-2 transition-colors ${
              tabActiva === "compradores"
                ? "border-cyan-600 text-cyan-700 bg-white rounded-t-lg"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            👥 Auditoría de Compradores
          </button>
        </div>

        {/* CONTENIDO PRINCIPAL */}
        <div className="flex-1 overflow-y-auto p-5">
          {cargando ? (
            <div className="py-12 text-center text-sm font-bold text-slate-500">
              Analizando balance de riesgo y apuestas de marcas…
            </div>
          ) : !analisis ? (
            <div className="py-12 text-center text-sm text-slate-500">
              No se pudo obtener la información de esta carrera.
            </div>
          ) : (
            <>
              {/* TAB 1: MATRIZ DE RIESGO */}
              {tabActiva === "riesgo" && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                    <table className="w-full border-collapse text-left text-xs">
                      <thead>
                        <tr className="bg-slate-100 text-[10px] font-black uppercase tracking-wider text-slate-600 border-b border-slate-200">
                          <th className="px-3 py-2.5">Jerarquía</th>
                          <th className="px-3 py-2.5">Ejemplar</th>
                          <th className="px-3 py-2.5 text-right">Monto Jugado</th>
                          <th className="px-3 py-2.5 text-right">Pago Potencial</th>
                          <th className="px-3 py-2.5 text-right">Balance Neto Banca</th>
                          <th className="px-3 py-2.5 text-center">Estado Cupo</th>
                          <th className="px-3 py-2.5 text-right">Acciones</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {analisis.marcas.map((m) => {
                          const col = getHorseColor(m.caballoNumero);
                          const esNegativo = m.balanceNetoBanca < 0;
                          return (
                            <tr
                              key={m.caballoNumero}
                              className={`hover:bg-slate-50/80 transition-colors ${
                                m.cupoAgotado ? "bg-rose-50/40" : ""
                              }`}
                            >
                              <td className="px-3 py-2 font-black text-slate-500">
                                {m.esPrimeraMarca ? (
                                  <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-black text-indigo-900">
                                    1ª Marca (Bloqueada)
                                  </span>
                                ) : (
                                  <span className="text-[11px] font-bold text-slate-700">
                                    {m.ordenJerarquia}ª Marca
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className={`inline-flex h-6 w-6 items-center justify-center rounded font-mono font-black text-xs ${col.bg} ${col.text} ${col.border} border`}
                                  >
                                    {m.caballoNumero}
                                  </span>
                                  {m.ampliacionAutorizada > 0 && (
                                    <span className="rounded bg-cyan-100 px-1.5 py-0.5 text-[9px] font-black text-cyan-800">
                                      +${m.ampliacionAutorizada} extra
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-3 py-2 text-right font-black text-slate-900">
                                ${m.montoJugadoTotal.toLocaleString("es-VE", { minimumFractionDigits: 2 })}
                              </td>
                              <td className="px-3 py-2 text-right font-bold text-slate-600">
                                ${m.pagoPotencialBanca.toLocaleString("es-VE", { minimumFractionDigits: 2 })}
                              </td>
                              <td
                                className={`px-3 py-2 text-right font-black ${
                                  esNegativo ? "text-rose-600" : "text-emerald-700"
                                }`}
                              >
                                {esNegativo ? "-" : "+"}$
                                {Math.abs(m.balanceNetoBanca).toLocaleString("es-VE", {
                                  minimumFractionDigits: 2,
                                })}
                              </td>
                              <td className="px-3 py-2 text-center">
                                {m.cupoAgotado ? (
                                  <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-black text-rose-800">
                                    🚫 Cupo Agotado (${m.limitePlataforma})
                                  </span>
                                ) : (
                                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                                    Disp: ${m.disponiblePlataforma} / ${m.limitePlataforma}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => setAmpliandoMarca(m)}
                                    title="Ampliar cupo para esta marca"
                                    className="rounded bg-cyan-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-cyan-500 shadow-sm"
                                  >
                                    🔓 Ampliar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setViendoCompradores(m)}
                                    title="Ver jugadores que apostaron a este caballo"
                                    className="rounded bg-slate-200 px-2 py-1 text-[11px] font-bold text-slate-800 hover:bg-slate-300"
                                  >
                                    👥 ({m.compradores.length})
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="rounded-xl border border-cyan-200 bg-cyan-50/60 p-3 text-xs text-cyan-900 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <b className="font-black">💡 Regla de Control de Pérdida:</b> Si una marca acumula muchas
                      apuestas y pone en riesgo el balance de la carrera, puedes:
                      <ul className="list-disc pl-5 mt-1 space-y-0.5 text-[11px]">
                        <li>
                          <b>Ampliar el cupo</b> si la banca decide aceptar mayor volumen.
                        </li>
                        <li>
                          <b>Modificar el orden actual</b> en la pestaña <i>"Modificar Orden"</i> para equilibrar la
                          jerarquía de la carrera.
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: MODIFICAR ORDEN / JERARQUIA */}
              {tabActiva === "orden" && (
                <div className="space-y-4 max-w-2xl mx-auto">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <h3 className="text-sm font-black text-slate-900 mb-1">
                      Reorganizar Jerarquía de Marcas de la Carrera
                    </h3>
                    <p className="text-xs text-slate-600 mb-3">
                      El orden de izquierda a derecha define la jerarquía: la primera marca no se puede jugar
                      (favorito principal). Cada caballo solo puede enfrentarse a los que tiene a su izquierda. Mueve
                      los caballos para ajustar la exposición.
                    </p>

                    <div className="space-y-2">
                      {nuevoOrdenMarcas.map((num, idx) => {
                        const col = getHorseColor(num);
                        const esPrimero = idx === 0;
                        return (
                          <div
                            key={num}
                            className="flex items-center justify-between rounded-lg bg-white p-2.5 border border-slate-200 shadow-sm"
                          >
                            <div className="flex items-center gap-2.5">
                              <span className="font-mono text-xs font-black text-slate-400 w-5">
                                #{idx + 1}
                              </span>
                              <span
                                className={`inline-flex h-7 w-7 items-center justify-center rounded font-mono font-black text-sm ${col.bg} ${col.text} ${col.border} border`}
                              >
                                {num}
                              </span>
                              <span className="text-xs font-bold text-slate-800">
                                {esPrimero ? "1ª Marca · Favorito Principal (Bloqueado)" : `${idx + 1}ª Marca`}
                              </span>
                            </div>

                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                disabled={idx === 0}
                                onClick={() => moverMarca(idx, -1)}
                                className="h-7 w-7 rounded bg-slate-100 hover:bg-slate-200 disabled:opacity-30 text-xs font-bold"
                                title="Subir jerarquía"
                              >
                                ▲
                              </button>
                              <button
                                type="button"
                                disabled={idx === nuevoOrdenMarcas.length - 1}
                                onClick={() => moverMarca(idx, 1)}
                                className="h-7 w-7 rounded bg-slate-100 hover:bg-slate-200 disabled:opacity-30 text-xs font-bold"
                                title="Bajar jerarquía"
                              >
                                ▼
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="mt-4">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">
                        Motivo del cambio de orden (Auditoría)
                      </label>
                      <input
                        type="text"
                        value={motivoOrden}
                        onChange={(e) => setMotivoOrden(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-900"
                        placeholder="Ej. Rebalanceo de jerarquía por alto volumen"
                      />
                    </div>

                    <div className="mt-4 flex justify-end">
                      <Button
                        size="md"
                        disabled={guardandoOrden}
                        onClick={() => void ejecutarGuardarOrden()}
                      >
                        {guardandoOrden ? "Guardando…" : "💾 Guardar Nuevo Orden"}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: LIMITES DE PLATAFORMA Y GRUPOS */}
              {tabActiva === "limites" && (
                <div className="space-y-4 max-w-xl mx-auto">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-4">
                    <h3 className="text-sm font-black text-slate-900">
                      Configuración de Límites por Marca en la Carrera
                    </h3>

                    <div>
                      <label className="text-xs font-black text-slate-800 block mb-1">
                        Límite General de la Plataforma por Marca ($)
                      </label>
                      <p className="text-[11px] text-slate-500 mb-1.5">
                        Monto máximo acumulado que la casa aceptará en total para cada caballo en esta carrera.
                      </p>
                      <input
                        type="number"
                        min="1"
                        value={limiteGeneralInput}
                        onChange={(e) => setLimiteGeneralInput(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-black text-slate-900"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-black text-slate-800 block mb-1">
                        Límite por Grupo por Marca ($)
                      </label>
                      <p className="text-[11px] text-slate-500 mb-1.5">
                        Monto máximo que un grupo individual puede jugar en cada marca antes de bloquear la venta.
                      </p>
                      <input
                        type="number"
                        min="1"
                        value={limiteGrupoInput}
                        onChange={(e) => setLimiteGrupoInput(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-black text-slate-900"
                      />
                    </div>

                    <div className="pt-2 flex justify-end">
                      <Button
                        size="md"
                        disabled={guardandoLimites}
                        onClick={() => void ejecutarGuardarLimites()}
                      >
                        {guardandoLimites ? "Guardando…" : "💾 Guardar Límites de la Carrera"}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 4: AUDITORIA DE COMPRADORES */}
              {tabActiva === "compradores" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-black uppercase tracking-wider text-slate-700">
                      Historial de Apuestas Registradas en Marcas ({analisis.totalJugadas} jugadas)
                    </h3>
                  </div>

                  {analisis.marcas.every((m) => m.compradores.length === 0) ? (
                    <div className="py-8 text-center text-xs text-slate-400">
                      Aún no se han registrado jugadas de marcas para esta carrera.
                    </div>
                  ) : (
                    <div className="rounded-xl border border-slate-200 overflow-hidden">
                      <table className="w-full border-collapse text-left text-xs">
                        <thead>
                          <tr className="bg-slate-100 text-[10px] font-black uppercase tracking-wider text-slate-600 border-b border-slate-200">
                            <th className="px-3 py-2">Hora</th>
                            <th className="px-3 py-2">Jugador</th>
                            <th className="px-3 py-2">Grupo</th>
                            <th className="px-3 py-2">Matchup</th>
                            <th className="px-3 py-2 text-right">Monto</th>
                            <th className="px-3 py-2 text-right">Premio Potencial</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {analisis.marcas.flatMap((m) =>
                            m.compradores.map((c) => (
                              <tr key={c.ticketId} className="hover:bg-slate-50">
                                <td className="px-3 py-2 font-mono text-slate-400 text-[11px]">{c.fecha}</td>
                                <td className="px-3 py-2 font-bold text-slate-900">{c.jugadorNombre}</td>
                                <td className="px-3 py-2 text-slate-600">{c.grupoNombre}</td>
                                <td className="px-3 py-2">
                                  <span className="font-black text-indigo-700">#{c.caballo}</span>{" "}
                                  <span className="text-slate-400">vs</span>{" "}
                                  <span className="font-black text-amber-700">#{c.rival || "?"}</span>
                                </td>
                                <td className="px-3 py-2 text-right font-black text-slate-900">
                                  ${c.monto.toLocaleString("es-VE", { minimumFractionDigits: 2 })}
                                </td>
                                <td className="px-3 py-2 text-right font-bold text-emerald-600">
                                  ${c.premioPotencial.toLocaleString("es-VE", { minimumFractionDigits: 2 })}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* SUBMODAL: AMPLIAR CUPO DE UNA MARCA */}
        {ampliandoMarca && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl border border-slate-200">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <span className="text-xl">🔓</span>
                  <h4 className="text-sm font-black text-slate-900">
                    Ampliar Cupo: Marca #{ampliandoMarca.caballoNumero}
                  </h4>
                </div>
                <button
                  type="button"
                  onClick={() => setAmpliandoMarca(null)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  ✕
                </button>
              </div>

              <div className="mt-3 space-y-3">
                <div className="rounded-lg bg-slate-50 p-2.5 text-xs">
                  <div>
                    Límite actual: <b>${ampliandoMarca.limitePlataforma}</b> (Jugado:{" "}
                    <b>${ampliandoMarca.montoJugadoTotal}</b>)
                  </div>
                  <div className="text-slate-500 mt-0.5">
                    Disponible actual: <b>${ampliandoMarca.disponiblePlataforma}</b>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">
                    Monto adicional a autorizar ($)
                  </label>
                  <input
                    type="number"
                    min="6"
                    step="6"
                    value={montoAmpliacion}
                    onChange={(e) => setMontoAmpliacion(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-black text-slate-900"
                  />
                  <div className="mt-1 flex gap-1">
                    {["30", "60", "120", "240"].map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setMontoAmpliacion(val)}
                        className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700 hover:bg-slate-200"
                      >
                        +${val}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">
                    Motivo de la ampliación (Auditoría)
                  </label>
                  <input
                    type="text"
                    value={motivoAmpliacion}
                    onChange={(e) => setMotivoAmpliacion(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-900"
                  />
                </div>
              </div>

              <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-3">
                <Button variant="ghost" size="sm" onClick={() => setAmpliandoMarca(null)}>
                  Cancelar
                </Button>
                <Button
                  size="md"
                  disabled={procesandoAmpliacion}
                  onClick={() => void ejecutarAmpliacion()}
                >
                  {procesandoAmpliacion ? "Autorizando…" : "🔓 Autorizar Ampliación"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* SUBMODAL: COMPRADORES DE UNA MARCA */}
        {viendoCompradores && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl border border-slate-200 max-h-[80vh] flex flex-col">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 shrink-0">
                <div className="flex items-center gap-2">
                  <span className="text-xl">👥</span>
                  <h4 className="text-sm font-black text-slate-900">
                    Compradores: Marca #{viendoCompradores.caballoNumero} ({viendoCompradores.compradores.length})
                  </h4>
                </div>
                <button
                  type="button"
                  onClick={() => setViendoCompradores(null)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  ✕
                </button>
              </div>

              <div className="flex-1 overflow-y-auto mt-3">
                {viendoCompradores.compradores.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-400">
                    Nadie ha apostado a este ejemplar todavía.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {viendoCompradores.compradores.map((c) => (
                      <div
                        key={c.ticketId}
                        className="rounded-lg bg-slate-50 p-2.5 border border-slate-200 flex items-center justify-between text-xs"
                      >
                        <div>
                          <div className="font-black text-slate-900">{c.jugadorNombre}</div>
                          <div className="text-[10px] text-slate-500">
                            {c.grupoNombre} · vs #{c.rival || "?"} · {c.fecha}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-black text-slate-900">${c.monto}</div>
                          <div className="text-[10px] font-bold text-emerald-600">
                            Premio: ${c.premioPotencial}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-4 flex justify-end border-t border-slate-100 pt-3 shrink-0">
                <Button variant="ghost" size="sm" onClick={() => setViendoCompradores(null)}>
                  Cerrar
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
