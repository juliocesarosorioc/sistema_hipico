"use client";

import { useEffect, useMemo, useState } from "react";
import {
  cargarEventosLibres,
  crearEventoLibre,
  liquidarEventoLibre,
  reversarOAnularEventoLibre,
  leerEventosLibresMemoria,
  type CategoriaDeporte,
  type EventoLibreRow,
} from "@/features/eventos-libres/lib/eventos-libres";
import type { ClienteVenta } from "@/features/grupos/lib/grupos";
import { formatoMoneda } from "@/shared/lib/vzla";
import { SearchableSelect } from "@/shared/components/ui/SearchableSelect";
import { hoyLocal } from "@/core/utils/fechas";

interface Props {
  clientes: ClienteVenta[];
  onClose: () => void;
  comisionGrupoDefault?: number;
}

export function ModalEventoLibre({ clientes, onClose, comisionGrupoDefault = 5 }: Props) {
  const [eventos, setEventos] = useState<EventoLibreRow[]>(() => leerEventosLibresMemoria());
  const [categoria, setCategoria] = useState<CategoriaDeporte>("LIBRE");
  const [fechaEvento, setFechaEvento] = useState(hoyLocal());
  const [concepto, setConcepto] = useState("");
  const [logro, setLogro] = useState("");
  const [j1Id, setJ1Id] = useState("");
  const [j2Id, setJ2Id] = useState("");
  const [riesgoJuega, setRiesgoJuega] = useState("");
  const [riesgoDa, setRiesgoDa] = useState("");
  const [comisionGrupo, setComisionGrupo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState("");
  const [eventoEnLiquidacion, setEventoEnLiquidacion] = useState("");
  const [ganadorSeleccionado, setGanadorSeleccionado] = useState<"JUGADOR_1" | "JUGADOR_2" | "EMPATE">("JUGADOR_1");
  const [montoGanancia, setMontoGanancia] = useState("");

  const cli1 = clientes.find((c) => String(c.id) === String(j1Id));
  const cli2 = clientes.find((c) => String(c.id) === String(j2Id));
  const opcionesClientes = useMemo(
    () =>
      clientes.map((c) => ({
        value: String(c.id),
        label:
          c.seudonimo && c.nombre_real && c.nombre_real !== c.seudonimo
            ? `${c.seudonimo} — ${c.nombre_real}`
            : c.seudonimo || c.nombre,
      })),
    [clientes]
  );

  const calcDisponible = (c?: ClienteVenta | null) => (c ? ((c.saldo_actual ?? 0) + (c.aval ?? 0)) : 0);

  useEffect(() => {
    let vigente = true;
    void cargarEventosLibres()
      .then((r) => {
        if (!vigente) return;
        setEventos(r.eventos);
        if (r.warning) setMensaje(r.warning);
      })
      .catch((error: unknown) => {
        if (vigente) {
          setMensaje(
            `No se pudieron cargar los eventos: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      });
    return () => {
      vigente = false;
    };
  }, []);

  const registrar = async () => {
    if (!fechaEvento) return setMensaje("Seleccione la fecha del evento.");
    if (!concepto.trim()) return setMensaje("Escriba el concepto de la apuesta.");
    if (!logro.trim()) return setMensaje("Escriba el logro o mercado manualmente.");
    if (!cli1) return setMensaje("Seleccione quién juega (Jugador 1).");
    if (!cli2) return setMensaje("Seleccione quién da (Jugador 2).");
    if (cli1.id === cli2.id) return setMensaje("Jugador 1 y Jugador 2 deben ser distintos.");
    const riesgoJ1 = Number(riesgoJuega);
    const riesgoJ2 = Number(riesgoDa);
    if (!comisionGrupo.trim()) return setMensaje("Escriba manualmente la comisión del grupo para esta apuesta.");
    const comision = Number(comisionGrupo);
    if (!Number.isFinite(riesgoJ1) || riesgoJ1 <= 0 || !Number.isFinite(riesgoJ2) || riesgoJ2 <= 0) {
      return setMensaje("Indique manualmente un monto de riesgo mayor a 0 para cada jugador.");
    }
    if (!Number.isFinite(comision) || comision < 0 || comision > 100) {
      return setMensaje("La comisión del grupo debe estar entre 0% y 100%.");
    }

    setGuardando(true);
    const r = await crearEventoLibre({
      fecha: fechaEvento,
      categoria,
      concepto,
      mercado: logro,
      jugador1: { id: cli1.id, nombre: cli1.nombre, disponible: calcDisponible(cli1) },
      jugador2: { id: cli2.id, nombre: cli2.nombre, disponible: calcDisponible(cli2) },
      riesgo1: riesgoJ1,
      riesgo2: riesgoJ2,
      comisionGrupoPct: comision,
    });
    setGuardando(false);

    if (!r.ok) {
      setMensaje(r.error || "Error al registrar evento libre.");
      return;
    }

    setEventos(leerEventosLibresMemoria());
    setFechaEvento(hoyLocal());
    setConcepto("");
    setLogro("");
    setRiesgoJuega("");
    setRiesgoDa("");
    setMensaje(r.warning ? `✅ Evento guardado. ${r.warning}` : "✅ Evento libre registrado con éxito.");
  };

  const decidir = async (
    ev: EventoLibreRow,
    ganador: "JUGADOR_1" | "JUGADOR_2" | "EMPATE",
    monto?: number
  ) => {
    if (ganador !== "EMPATE" && (!monto || !Number.isFinite(monto) || monto <= 0)) {
      setMensaje("Indique la ganancia bruta a liquidar antes de la comisión.");
      return;
    }
    setGuardando(true);
    const r = await liquidarEventoLibre({
      eventoId: ev.id,
      ganador,
      montoGanancia: monto,
      config1: {
        clienteId: ev.jugador1Id,
        clienteNombre: ev.jugador1Nombre,
      },
      config2: {
        clienteId: ev.jugador2Id,
        clienteNombre: ev.jugador2Nombre,
      },
      comisionGrupoDefault: ev.comisionGrupoPct ?? comisionGrupoDefault,
    });
    setGuardando(false);

    if (r.ok) {
      setEventos(leerEventosLibresMemoria());
      setMensaje(
        r.warning
          ? `✅ Evento liquidado. ${r.warning}`
          : `✅ Evento liquidado. Ganador: ${ganador}`
      );
      setEventoEnLiquidacion("");
      setMontoGanancia("");
    } else {
      setMensaje(r.error || "Error al liquidar.");
    }
  };

  const handleReversar = async (ev: EventoLibreRow) => {
    const esLiquidado = ev.estado === "GANO_JUGADOR_1" || ev.estado === "GANO_JUGADOR_2";
    const accion = esLiquidado ? "reversar la liquidación y restaurar los saldos y asientos contables" : "anular este evento";
    if (!confirm(`¿Está seguro de que desea ${accion} del evento "${ev.concepto}"?`)) {
      return;
    }
    setGuardando(true);
    const r = await reversarOAnularEventoLibre({
      eventoId: ev.id,
      motivo: "Anulación / Reversión manual desde taquilla",
    });
    setGuardando(false);

    if (r.ok) {
      setEventos(leerEventosLibresMemoria());
      setMensaje(`✅ Evento "${ev.concepto}" anulado/reversado con éxito.`);
      setEventoEnLiquidacion("");
    } else {
      setMensaje(r.error || "Error al anular/reversar el evento.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between bg-gradient-to-r from-slate-900 to-indigo-950 px-4 py-3 text-white">
          <div className="flex items-center gap-2">
            <span className="text-xl">🏆</span>
            <div>
              <h2 className="text-sm font-black uppercase tracking-wider">Evento Libre P2P & Sportsbook</h2>
              <p className="text-[10px] text-slate-300">Apuestas entre jugadores de Béisbol, Fútbol, Baloncesto, Hipismo Especial y Libres</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {mensaje && (
            <div className="rounded-lg bg-indigo-50 border border-indigo-200 p-2 text-xs font-bold text-indigo-900">
              {mensaje}
            </div>
          )}

          {/* Formulario de Registro */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-3">
            <div className="text-xs font-black uppercase text-slate-700 flex items-center gap-1.5">
              <span>✍️</span> Registrar Nueva Apuesta Deportiva / Evento Libre
            </div>

            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-5">
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Fecha del evento</label>
                <input
                  type="date"
                  required
                  value={fechaEvento}
                  onChange={(e) => setFechaEvento(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-bold text-slate-800"
                />
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Categoría</label>
                <select
                  value={categoria}
                  onChange={(e) => setCategoria(e.target.value as CategoriaDeporte)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-bold text-slate-800"
                >
                  <option value="LIBRE">Libre / Especial</option>
                  <option value="BEISBOL">⚾ Béisbol</option>
                  <option value="FUTBOL">⚽ Fútbol</option>
                  <option value="BASKETBALL">🏀 Basketball</option>
                  <option value="HIPISMO_ESPECIAL">🏇 Hipismo Especial</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Logro / Mercado</label>
                <input
                  type="text"
                  value={logro}
                  onChange={(e) => setLogro(e.target.value)}
                  placeholder="Ej: 10/6, ganador, más de 2.5 goles"
                  className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-bold text-indigo-900"
                />
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Concepto / Apuesta</label>
                <input
                  type="text"
                  placeholder="Ej: Real Madrid vs Barcelona - Real Madrid Ganador"
                  value={concepto}
                  onChange={(e) => setConcepto(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-bold text-slate-800"
                />
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Comisión del grupo (%)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={comisionGrupo}
                  onChange={(e) => setComisionGrupo(e.target.value)}
                  placeholder={`Ingrese porcentaje (referencia del grupo: ${comisionGrupoDefault}%)`}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-bold text-indigo-900"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1 border-t border-slate-200">
              {/* Quien Juega */}
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-2 space-y-1.5">
                <div className="text-[11px] font-black uppercase text-emerald-800 flex items-center justify-between">
                  <span>🟢 Quien Juega (Jugador 1)</span>
                  {cli1 && <span className="font-mono text-[10px] text-emerald-700">Disp: {formatoMoneda("USD", calcDisponible(cli1))}</span>}
                </div>
                <SearchableSelect
                  options={opcionesClientes}
                  value={j1Id}
                  onChange={setJ1Id}
                  placeholder="Buscar quién juega…"
                  allowCustom={false}
                  displayValue={cli1?.seudonimo || cli1?.nombre}
                  inputClassName="w-full rounded border border-emerald-300 bg-white px-2 py-1 text-xs font-bold text-slate-800"
                />
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-slate-600">Arriesga:</span>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={riesgoJuega}
                    onChange={(e) => setRiesgoJuega(e.target.value)}
                    className="w-28 rounded border border-emerald-300 bg-white px-2 py-0.5 text-right font-mono text-xs font-black text-emerald-900"
                  />
                </div>
              </div>

              {/* Quien Da */}
              <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-2 space-y-1.5">
                <div className="text-[11px] font-black uppercase text-amber-800 flex items-center justify-between">
                  <span>🟡 Quien Da (Jugador 2)</span>
                  {cli2 && <span className="font-mono text-[10px] text-amber-700">Disp: {formatoMoneda("USD", calcDisponible(cli2))}</span>}
                </div>
                <SearchableSelect
                  options={opcionesClientes}
                  value={j2Id}
                  onChange={setJ2Id}
                  placeholder="Buscar quién da…"
                  allowCustom={false}
                  displayValue={cli2?.seudonimo || cli2?.nombre}
                  inputClassName="w-full rounded border border-amber-300 bg-white px-2 py-1 text-xs font-bold text-slate-800"
                />
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-slate-600">Arriesga:</span>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={riesgoDa}
                    onChange={(e) => setRiesgoDa(e.target.value)}
                    className="w-28 rounded border border-amber-300 bg-white px-2 py-0.5 text-right font-mono text-xs font-black text-amber-900"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={registrar}
                disabled={guardando}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black uppercase text-white shadow-md hover:bg-indigo-700 disabled:opacity-50"
              >
                {guardando ? "Registrando..." : "➕ Registrar Evento Libre"}
              </button>
            </div>
          </div>

          {/* Tabla de Eventos Registrados */}
          <div className="space-y-2">
            <div className="text-xs font-black uppercase text-slate-700">Eventos Activos y Liquidación</div>
            {eventos.length === 0 ? (
              <p className="text-xs text-slate-400 italic">No hay eventos libres registrados aún.</p>
            ) : (
              <div className="space-y-2">
                {eventos.map((ev) => (
                  <div
                    key={ev.id}
                    className={`rounded-xl border p-3 transition-colors ${
                      ev.estado === "PENDIENTE" ? "border-slate-300 bg-white" : "border-slate-200 bg-slate-50"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[9px] font-black uppercase text-indigo-700">
                          {ev.categoria}
                        </span>
                        <span className="font-bold text-xs text-slate-800">{ev.concepto}</span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
                          {ev.mercado}
                        </span>
                        <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700">
                          Comisión grupo: {Number(ev.comisionGrupoPct ?? 5)}%
                        </span>
                      </div>
                      <div>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase ${
                            ev.estado === "PENDIENTE"
                              ? "bg-amber-100 text-amber-800"
                              : ev.estado === "GANO_JUGADOR_1"
                              ? "bg-emerald-100 text-emerald-800"
                              : ev.estado === "GANO_JUGADOR_2"
                              ? "bg-blue-100 text-blue-800"
                              : "bg-slate-200 text-slate-700"
                          }`}
                        >
                          {ev.estado}
                        </span>
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-xs">
                      <div>
                        <span className="font-semibold text-slate-500">Juega: </span>
                        <span className="font-bold text-slate-800">{ev.jugador1Nombre}</span>
                        <span className="ml-1 font-mono font-black text-emerald-700">(${ev.riesgoJugador1})</span>
                      </div>
                      <div className="font-black text-slate-400">vs</div>
                      <div>
                        <span className="font-semibold text-slate-500">Da: </span>
                        <span className="font-bold text-slate-800">{ev.jugador2Nombre}</span>
                        <span className="ml-1 font-mono font-black text-amber-700">(${ev.riesgoJugador2})</span>
                      </div>

                      {/* Registrar el resultado después de crear la apuesta. */}
                      {ev.estado === "PENDIENTE" ? (
                        <div className="w-full space-y-2 border-t border-slate-100 pt-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[10px] font-black uppercase text-slate-500">Resultado:</span>
                            <button
                              type="button"
                              onClick={() => {
                                setEventoEnLiquidacion(ev.id);
                                setGanadorSeleccionado("JUGADOR_1");
                                setMontoGanancia("");
                              }}
                              disabled={guardando}
                              className={`rounded-lg px-2.5 py-1 text-[11px] font-bold text-white shadow ${
                                eventoEnLiquidacion === ev.id && ganadorSeleccionado === "JUGADOR_1"
                                  ? "bg-emerald-800 ring-2 ring-emerald-300"
                                  : "bg-emerald-600 hover:bg-emerald-700"
                              }`}
                            >
                              🏆 Ganó {ev.jugador1Nombre}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEventoEnLiquidacion(ev.id);
                                setGanadorSeleccionado("JUGADOR_2");
                                setMontoGanancia("");
                              }}
                              disabled={guardando}
                              className={`rounded-lg px-2.5 py-1 text-[11px] font-bold text-white shadow ${
                                eventoEnLiquidacion === ev.id && ganadorSeleccionado === "JUGADOR_2"
                                  ? "bg-amber-800 ring-2 ring-amber-300"
                                  : "bg-amber-600 hover:bg-amber-700"
                              }`}
                            >
                              🏆 Ganó {ev.jugador2Nombre}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEventoEnLiquidacion(ev.id);
                                setGanadorSeleccionado("EMPATE");
                                setMontoGanancia("");
                              }}
                              disabled={guardando}
                              className={`rounded-lg px-2 py-1 text-[11px] font-bold ${
                                eventoEnLiquidacion === ev.id && ganadorSeleccionado === "EMPATE"
                                  ? "bg-slate-500 text-white ring-2 ring-slate-300"
                                  : "bg-slate-200 text-slate-700 hover:bg-slate-300"
                              }`}
                            >
                              🤝 Empate / Nulo
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleReversar(ev)}
                              disabled={guardando}
                              className="rounded-lg bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                            >
                              ❌ Anular Evento
                            </button>
                          </div>
                          {eventoEnLiquidacion === ev.id && (
                            <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
                              {ganadorSeleccionado !== "EMPATE" ? (
                                <label className="flex min-w-48 flex-1 flex-col gap-1 text-[10px] font-black uppercase text-slate-600">
                                  Ganancia bruta antes de comisión
                                  <input
                                    type="number"
                                    min="0.01"
                                    max={ganadorSeleccionado === "JUGADOR_1" ? ev.riesgoJugador2 : ev.riesgoJugador1}
                                    step="0.01"
                                    value={montoGanancia}
                                    onChange={(e) => setMontoGanancia(e.target.value)}
                                    placeholder="Monto acordado"
                                    className="rounded border border-slate-300 bg-white px-2 py-1 text-right font-mono text-xs font-black text-slate-900"
                                  />
                                  <span className="font-semibold normal-case text-slate-500">
                                    Máximo por riesgo acordado:{" "}
                                    {formatoMoneda(
                                      "USD",
                                      ganadorSeleccionado === "JUGADOR_1"
                                        ? ev.riesgoJugador2
                                        : ev.riesgoJugador1
                                    )}
                                  </span>
                                </label>
                              ) : (
                                <p className="flex-1 text-[10px] font-semibold text-slate-600">
                                  El empate no genera ganancia ni comisión.
                                </p>
                              )}
                              {ganadorSeleccionado !== "EMPATE" && Number(montoGanancia) > 0 && (
                                <p className="pb-1 text-[10px] font-bold text-indigo-800">
                                  Comisión ({Number(ev.comisionGrupoPct ?? 5)}%):{" "}
                                  {formatoMoneda(
                                    "USD",
                                    Math.round(Number(montoGanancia) * Number(ev.comisionGrupoPct ?? 5)) / 100
                                  )}
                                </p>
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  void decidir(
                                    ev,
                                    ganadorSeleccionado,
                                    ganadorSeleccionado === "EMPATE" ? undefined : Number(montoGanancia)
                                  )
                                }
                                disabled={guardando}
                                className="rounded-lg bg-indigo-700 px-3 py-1.5 text-[11px] font-black text-white shadow hover:bg-indigo-800 disabled:opacity-50"
                              >
                                {guardando ? "Liquidando…" : "Confirmar resultado"}
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 w-full">
                          <div className="text-[10px] text-slate-500 font-mono">
                            Ganancia bruta: ${ev.montoLiquidadoGanador?.toFixed(2)} · Comisión Casa: ${ev.comisionCobrada?.toFixed(2)} · Incentivo: ${ev.incentivoAcreditado?.toFixed(2)} · Socio: ${ev.comisionSocioAcreditada?.toFixed(2)}
                          </div>
                          {ev.estado !== "ANULADA" && (
                            <button
                              type="button"
                              onClick={() => void handleReversar(ev)}
                              disabled={guardando}
                              className="rounded-lg bg-rose-600 px-2.5 py-1 text-[10px] font-black uppercase text-white shadow hover:bg-rose-700 disabled:opacity-50"
                            >
                              🔄 Reversar / Anular
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
