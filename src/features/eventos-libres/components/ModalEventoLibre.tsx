"use client";

import { useState, useEffect } from "react";
import {
  crearEventoLibre,
  liquidarEventoLibre,
  calcularRiesgosLogro,
  leerEventosLibresMemoria,
  type CategoriaDeporte,
  type EventoLibreRow,
} from "@/features/eventos-libres/lib/eventos-libres";
import type { ClienteVenta } from "@/features/grupos/lib/grupos";
import { formatoMoneda } from "@/shared/lib/vzla";

interface Props {
  clientes: ClienteVenta[];
  onClose: () => void;
  comisionGrupoDefault?: number;
}

export function ModalEventoLibre({ clientes, onClose, comisionGrupoDefault = 5 }: Props) {
  const [eventos, setEventos] = useState<EventoLibreRow[]>(() => leerEventosLibresMemoria());
  const [categoria, setCategoria] = useState<CategoriaDeporte>("LIBRE");
  const [concepto, setConcepto] = useState("");
  const [logro, setLogro] = useState("10/6");
  const [j1Id, setJ1Id] = useState("");
  const [j2Id, setJ2Id] = useState("");
  const [montoJuega, setMontoJuega] = useState("1000");
  const [riesgoJuega, setRiesgoJuega] = useState(1000);
  const [riesgoDa, setRiesgoDa] = useState(600);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState("");

  const cli1 = clientes.find((c) => String(c.id) === String(j1Id));
  const cli2 = clientes.find((c) => String(c.id) === String(j2Id));

  const calcDisponible = (c?: ClienteVenta | null) => (c ? ((c.saldo_actual ?? 0) + (c.aval ?? 0)) : 0);

  useEffect(() => {
    const val = parseFloat(montoJuega) || 0;
    const res = calcularRiesgosLogro(val, logro);
    setRiesgoJuega(res.riesgoJuega);
    setRiesgoDa(res.riesgoDa);
  }, [montoJuega, logro]);

  const registrar = async () => {
    if (!concepto.trim()) return setMensaje("Escriba el concepto de la apuesta.");
    if (!cli1) return setMensaje("Seleccione quién juega (Jugador 1).");
    if (!cli2) return setMensaje("Seleccione quién da (Jugador 2).");
    if (cli1.id === cli2.id) return setMensaje("Jugador 1 y Jugador 2 deben ser distintos.");

    setGuardando(true);
    const r = await crearEventoLibre({
      categoria,
      concepto,
      mercado: logro,
      jugador1: { id: cli1.id, nombre: cli1.nombre, disponible: calcDisponible(cli1) },
      jugador2: { id: cli2.id, nombre: cli2.nombre, disponible: calcDisponible(cli2) },
      riesgo1: riesgoJuega,
      riesgo2: riesgoDa,
    });
    setGuardando(false);

    if (!r.ok) {
      setMensaje(r.error || "Error al registrar evento libre.");
      return;
    }

    setEventos(leerEventosLibresMemoria());
    setConcepto("");
    setMensaje("✅ Evento libre registrado con éxito.");
  };

  const decidir = async (ev: EventoLibreRow, ganador: "JUGADOR_1" | "JUGADOR_2" | "EMPATE") => {
    const c1Obj = clientes.find((c) => String(c.id) === String(ev.jugador1Id));
    const c2Obj = clientes.find((c) => String(c.id) === String(ev.jugador2Id));

    setGuardando(true);
    const r = await liquidarEventoLibre({
      eventoId: ev.id,
      ganador,
      config1: {
        clienteId: ev.jugador1Id,
        clienteNombre: ev.jugador1Nombre,
        comision_particular_pct: (c1Obj as any)?.comision_particular_pct ?? null,
        incentivo_pct: (c1Obj as any)?.incentivo_pct ?? (c1Obj as any)?.devolucion ?? 0,
        incentivo_base: (c1Obj as any)?.incentivo_base ?? "MONTO_DECIDIDO",
        socio_id: (c1Obj as any)?.socio_id ?? (c1Obj as any)?.socio_asignado ?? null,
        socio_comision_pct: (c1Obj as any)?.socio_comision_pct ?? (c1Obj as any)?.comision_socio_pct ?? 0,
        socio_base: (c1Obj as any)?.socio_base ?? "MONTO_DECIDIDO",
      },
      config2: {
        clienteId: ev.jugador2Id,
        clienteNombre: ev.jugador2Nombre,
        comision_particular_pct: (c2Obj as any)?.comision_particular_pct ?? null,
        incentivo_pct: (c2Obj as any)?.incentivo_pct ?? (c2Obj as any)?.devolucion ?? 0,
        incentivo_base: (c2Obj as any)?.incentivo_base ?? "MONTO_DECIDIDO",
        socio_id: (c2Obj as any)?.socio_id ?? (c2Obj as any)?.socio_asignado ?? null,
        socio_comision_pct: (c2Obj as any)?.socio_comision_pct ?? (c2Obj as any)?.comision_socio_pct ?? 0,
        socio_base: (c2Obj as any)?.socio_base ?? "MONTO_DECIDIDO",
      },
      comisionGrupoDefault,
    });
    setGuardando(false);

    if (r.ok) {
      setEventos(leerEventosLibresMemoria());
      setMensaje(`✅ Evento liquidado. Ganador: ${ganador}`);
    } else {
      setMensaje(r.error || "Error al liquidar.");
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

            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
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
                <select
                  value={logro}
                  onChange={(e) => setLogro(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-bold text-indigo-900"
                >
                  <option value="10/6">10/6 (1000 Juega / 600 Da)</option>
                  <option value="10A7">10A7 (1000 Juega / 700 Da)</option>
                  <option value="1P">1P / Parejo (1 a 1)</option>
                  <option value="PP">PP (Parejo)</option>
                  <option value="GANADOR">Ganador Directo</option>
                  <option value="ALTA">Alta (Over)</option>
                  <option value="BAJA">Baja (Under)</option>
                  <option value="1_GOL">1 Gol</option>
                </select>
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
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1 border-t border-slate-200">
              {/* Quien Juega */}
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-2 space-y-1.5">
                <div className="text-[11px] font-black uppercase text-emerald-800 flex items-center justify-between">
                  <span>🟢 Quien Juega (Jugador 1)</span>
                  {cli1 && <span className="font-mono text-[10px] text-emerald-700">Disp: {formatoMoneda("USD", calcDisponible(cli1))}</span>}
                </div>
                <select
                  value={j1Id}
                  onChange={(e) => setJ1Id(e.target.value)}
                  className="w-full rounded border border-emerald-300 bg-white px-2 py-1 text-xs font-bold text-slate-800"
                >
                  <option value="">— Seleccione Jugador 1 —</option>
                  {clientes.map((c) => (
                    <option key={String(c.id)} value={String(c.id)}>
                      {c.nombre} (Disp: {formatoMoneda("USD", calcDisponible(c))})
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-slate-600">Arriesga:</span>
                  <input
                    type="number"
                    value={riesgoJuega}
                    onChange={(e) => {
                      setRiesgoJuega(parseFloat(e.target.value) || 0);
                      setMontoJuega(e.target.value);
                    }}
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
                <select
                  value={j2Id}
                  onChange={(e) => setJ2Id(e.target.value)}
                  className="w-full rounded border border-amber-300 bg-white px-2 py-1 text-xs font-bold text-slate-800"
                >
                  <option value="">— Seleccione Jugador 2 —</option>
                  {clientes.map((c) => (
                    <option key={String(c.id)} value={String(c.id)}>
                      {c.nombre} (Disp: {formatoMoneda("USD", calcDisponible(c))})
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-slate-600">Arriesga:</span>
                  <input
                    type="number"
                    value={riesgoDa}
                    onChange={(e) => setRiesgoDa(parseFloat(e.target.value) || 0)}
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

                      {/* Botones de decisión rápida */}
                      {ev.estado === "PENDIENTE" ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => decidir(ev, "JUGADOR_1")}
                            disabled={guardando}
                            className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white shadow hover:bg-emerald-700"
                          >
                            🏆 Ganó {ev.jugador1Nombre}
                          </button>
                          <button
                            type="button"
                            onClick={() => decidir(ev, "JUGADOR_2")}
                            disabled={guardando}
                            className="rounded-lg bg-amber-600 px-2.5 py-1 text-[11px] font-bold text-white shadow hover:bg-amber-700"
                          >
                            🏆 Ganó {ev.jugador2Nombre}
                          </button>
                          <button
                            type="button"
                            onClick={() => decidir(ev, "EMPATE")}
                            disabled={guardando}
                            className="rounded-lg bg-slate-200 px-2 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-300"
                          >
                            🤝 Empate / Nulo
                          </button>
                        </div>
                      ) : (
                        <div className="text-[10px] text-slate-500 font-mono">
                          Comisión Casa: ${ev.comisionCobrada?.toFixed(2)} · Incentivo: ${ev.incentivoAcreditado?.toFixed(2)} · Socio: ${ev.comisionSocioAcreditada?.toFixed(2)}
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
