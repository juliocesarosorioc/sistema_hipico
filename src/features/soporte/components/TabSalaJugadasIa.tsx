"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  procesarMensajeSalaJugadas,
  asegurarSaldoJugador,
  formatearMonto,
  normalizarNombre,
  type EstadoSalaJugadas,
  type MensajeSalaWhatsApp,
  type ReferenciaRespuesta,
} from "@/features/portal/lib/sala-jugadas-whatsapp";
import {
  alternarEstadoCarreraGlobal,
  obtenerEstadoCarreraEnMemoria,
  EVENTO_ESTADO_CARRERA_CAMBIADO,
  type EstadoOperativoCarrera,
} from "@/features/portal/lib/bloqueo-jugadas";

const JUGADORES_DEFECTO = [
  "ARRAEZ",
  "EDDIE",
  "FORTUNA",
  "INFANTINO",
  "MEMPHIS",
  "PARTNER",
  "RUSSO",
  "SAM",
  "THOR",
  "PEDRO",
  "JUAN",
];

/** Cliente real del grupo activo con su saldo disponible para jugar. */
export interface JugadorSalaCliente {
  id?: string | number | null;
  nombre?: string | null;
  seudonimo?: string | null;
  saldo_actual?: number | string | null;
  disponible?: number | string | null;
}

function nombreVisibleCliente(c: JugadorSalaCliente): string {
  return String(c.seudonimo || c.nombre || "").trim();
}

function saldoDisponibleCliente(c: JugadorSalaCliente): number {
  const raw = c.disponible ?? c.saldo_actual ?? 0;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

export function TabSalaJugadasIa({
  hipodromoInicial = "LA RINCONADA",
  carreraInicial = 1,
  clientes = [],
}: {
  hipodromoInicial?: string;
  carreraInicial?: number;
  /** Clientes reales del grupo: habilitan los saldos y jugadores de la sala. */
  clientes?: JugadorSalaCliente[];
}) {
  const clientesConNombre = clientes.filter((c) => nombreVisibleCliente(c) !== "");
  const nombresReales = clientesConNombre.map((c) => nombreVisibleCliente(c).toUpperCase());
  const jugadoresIniciales =
    nombresReales.length > 0
      ? Array.from(new Set(nombresReales))
      : JUGADORES_DEFECTO;

  const [hipodromo, setHipodromo] = useState(hipodromoInicial);
  const [carrera, setCarrera] = useState(carreraInicial);
  const [estadoCarrera, setEstadoCarrera] = useState<EstadoOperativoCarrera>("ABIERTA");

  const [jugadorActivo, setJugadorActivo] = useState<string>(
    jugadoresIniciales[0] ?? "PEDRO"
  );
  const [nuevoJugadorNombre, setNuevoJugadorNombre] = useState("");
  const [listaJugadores, setListaJugadores] = useState<string[]>(jugadoresIniciales);

  const [textoInput, setTextoInput] = useState("");
  const [mensajeRespondiendo, setMensajeRespondiendo] = useState<MensajeSalaWhatsApp | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);

  // Estado centralizado de la sala
  const [estadoSala, setEstadoSala] = useState<EstadoSalaJugadas>(() => {
    const saldosIni: EstadoSalaJugadas["saldos"] = {};
    if (clientesConNombre.length > 0) {
      for (const c of clientesConNombre) {
        const nombre = nombreVisibleCliente(c);
        asegurarSaldoJugador(saldosIni, nombre, saldoDisponibleCliente(c));
      }
    } else {
      for (const j of JUGADORES_DEFECTO) {
        asegurarSaldoJugador(saldosIni, j, 200);
      }
    }
    return {
      hipodromo: hipodromoInicial,
      carrera: carreraInicial,
      estadoCarrera: "ABIERTA",
      mensajes: [
        {
          id: "bienvenida-sala",
          autor: "🤖 Agente IA",
          texto:
            "👋 **¡Bienvenidos a la Sala de Jugadas de Puestos en Vivo!**\nLos jugadores pueden proponer puestos (ej. `consigo 1p del 5 con 50` o `juego 1p del 2 con 40`).\nPara concretar, **respondan sobre el mensaje** diciendo `voy`, `te doy`, `jugaste`, etc.\nSolo se aceptan jugadas con **saldo disponible** y con la **carrera abierta**.",
          fecha: new Date().toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" }),
          esIa: true,
        },
      ],
      saldos: saldosIni,
      concrecionesConfirmadas: [],
    };
  });

  // Sincronizar saldos reales cuando el administrador carga los clientes.
  useEffect(() => {
    if (clientesConNombre.length === 0) return;

    setListaJugadores((prev) => {
      const previos = new Set(prev);
      const nuevos = nombresReales.filter((n) => !previos.has(n));
      return nuevos.length > 0 ? [...prev, ...nuevos] : prev;
    });
    setJugadorActivo((prev) => {
      if (nombresReales.includes(prev.toUpperCase())) return prev;
      return nombresReales[0] ?? prev;
    });
    setEstadoSala((prev) => {
      const saldos: EstadoSalaJugadas["saldos"] = { ...prev.saldos };
      for (const c of clientesConNombre) {
        const nombre = nombreVisibleCliente(c);
        const key = normalizarNombre(nombre);
        const total = saldoDisponibleCliente(c);
        const bloqueado = saldos[key]?.bloqueado ?? 0;
        saldos[key] = {
          nombre,
          total,
          bloqueado,
          disponible: Math.max(0, Math.round((total - bloqueado) * 100) / 100),
        };
      }
      return { ...prev, saldos };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientes]);

  // Escuchar cambios de apertura/cierre de carreras desde cualquier parte de la plataforma
  useEffect(() => {
    const mem = obtenerEstadoCarreraEnMemoria({ hipodromo, carrera });
    if (mem) {
      setEstadoCarrera(mem.cerrada ? "CERRADA" : "ABIERTA");
      setEstadoSala((prev) => ({
        ...prev,
        hipodromo,
        carrera,
        estadoCarrera: mem.cerrada ? "CERRADA" : "ABIERTA",
      }));
    }

    const handler = (ev: Event) => {
      const d = ((ev as CustomEvent).detail ?? {}) as {
        hipodromo?: string;
        carrera?: number | string;
        estado?: EstadoOperativoCarrera;
      };
      if (
        (!d.hipodromo || d.hipodromo.toUpperCase() === hipodromo.toUpperCase()) &&
        (d.carrera == null || Number(d.carrera) === Number(carrera))
      ) {
        const nuevoEst = d.estado ?? "ABIERTA";
        setEstadoCarrera(nuevoEst);
        setEstadoSala((prev) => ({
          ...prev,
          estadoCarrera: nuevoEst,
        }));
      }
    };

    window.addEventListener(EVENTO_ESTADO_CARRERA_CAMBIADO, handler);
    return () => window.removeEventListener(EVENTO_ESTADO_CARRERA_CAMBIADO, handler);
  }, [hipodromo, carrera]);

  // Autoscroll del chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [estadoSala.mensajes]);

  // Alternar apertura y cierre de la carrera
  const handleAlternarEstadoCarrera = (nuevoEst: EstadoOperativoCarrera) => {
    setEstadoCarrera(nuevoEst);
    alternarEstadoCarreraGlobal({
      hipodromo,
      carrera,
      estado: nuevoEst,
    });
    setEstadoSala((prev) => ({
      ...prev,
      estadoCarrera: nuevoEst,
      mensajes: [
        ...prev.mensajes,
        {
          id: `sys-${Date.now()}`,
          autor: "🤖 Agente IA",
          texto:
            nuevoEst === "CERRADA"
              ? "🔴 **CARRERA CERRADA**. Se bloquea la recepción de nuevas jugadas, propuestas y concreciones."
              : "🟢 **CARRERA ABIERTA**. Se habilita la recepción de propuestas de puestos y concreciones.",
          fecha: new Date().toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" }),
          esIa: true,
        },
      ],
    }));
  };

  const handleEnviarMensaje = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const texto = textoInput.trim();
    if (!texto) return;

    let ref: ReferenciaRespuesta | null = null;
    if (mensajeRespondiendo) {
      ref = {
        id: mensajeRespondiendo.id,
        autor: mensajeRespondiendo.autor,
        texto: mensajeRespondiendo.texto,
        propuesta: mensajeRespondiendo.propuesta,
      };
    }

    const { nuevoEstado } = procesarMensajeSalaJugadas(estadoSala, {
      autor: jugadorActivo,
      texto,
      respuestaA: ref,
    });

    setEstadoSala(nuevoEstado);
    setTextoInput("");
    setMensajeRespondiendo(null);
  };

  const handleAgregarJugador = () => {
    const n = nuevoJugadorNombre.trim().toUpperCase();
    if (!n) return;
    if (!listaJugadores.includes(n)) {
      setListaJugadores((prev) => [...prev, n]);
    }
    asegurarSaldoJugador(estadoSala.saldos, n, 200);
    setJugadorActivo(n);
    setNuevoJugadorNombre("");
  };

  const saldoActual = asegurarSaldoJugador(estadoSala.saldos, jugadorActivo);

  return (
    <div className="flex h-full flex-col bg-slate-950 text-slate-100 font-sans text-xs">
      {/* CABECERA TIPO WHATSAPP & ESTADO DE CARRERA */}
      <div className="shrink-0 border-b border-slate-800 bg-slate-900 px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Selector de Hipódromo y Carrera */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 font-bold text-slate-300">
              <span>🏟️</span>
              <input
                type="text"
                value={hipodromo}
                onChange={(e) => setHipodromo(e.target.value.toUpperCase())}
                className="w-28 rounded border border-slate-700 bg-slate-850 px-1.5 py-0.5 text-[11px] font-bold text-white uppercase focus:border-emerald-500 focus:outline-none"
                placeholder="HIPÓDROMO"
              />
            </div>

            <div className="flex items-center gap-1">
              <span className="font-bold text-slate-400">C#</span>
              <select
                value={carrera}
                onChange={(e) => setCarrera(Number(e.target.value))}
                className="rounded border border-slate-700 bg-slate-850 px-1.5 py-0.5 text-[11px] font-black text-white focus:border-emerald-500 focus:outline-none"
              >
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {/* Badge de Estado Abierta/Cerrada */}
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black shadow-xs ${
                estadoCarrera === "ABIERTA"
                  ? "bg-emerald-950 text-emerald-300 border border-emerald-600/60"
                  : "bg-rose-950 text-rose-300 border border-rose-600/60"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  estadoCarrera === "ABIERTA" ? "bg-emerald-400 animate-pulse" : "bg-rose-500"
                }`}
              />
              {estadoCarrera === "ABIERTA" ? "ABIERTA" : "CERRADA"}
            </span>
          </div>

          {/* Botón de Abrir / Cerrar Carrera */}
          <div className="flex items-center gap-1.5">
            {estadoCarrera === "ABIERTA" ? (
              <button
                type="button"
                onClick={() => handleAlternarEstadoCarrera("CERRADA")}
                className="rounded bg-rose-700 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-rose-600 active:scale-95 transition"
                title="Cerrar la carrera (Bloquea jugadas y propuestas)"
              >
                🔴 Cerrar Carrera
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleAlternarEstadoCarrera("ABIERTA")}
                className="rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-emerald-500 active:scale-95 transition"
                title="Abrir la carrera (Permite jugadas y propuestas)"
              >
                🟢 Abrir Carrera
              </button>
            )}
          </div>
        </div>

        {/* BARRA DE JUGADOR ACTIVO Y SALDOS EN CALIENTE */}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-1.5 text-[11px]">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-slate-400">👤 Escribir como:</span>
            <select
              value={jugadorActivo}
              onChange={(e) => setJugadorActivo(e.target.value)}
              className="rounded border border-slate-700 bg-slate-850 px-2 py-0.5 text-[11px] font-black text-amber-300 focus:outline-none"
            >
              {listaJugadores.map((j) => (
                <option key={j} value={j}>
                  {j}
                </option>
              ))}
            </select>
          </div>

          {/* Pastilla de Saldos */}
          <div className="flex items-center gap-2 rounded bg-slate-950 px-2 py-0.5 border border-slate-800">
            <span className="text-[10px] text-slate-400">
              Total: <strong className="text-white">{formatearMonto(saldoActual.total)}</strong>
            </span>
            <span className="text-[10px] text-amber-400">
              🔒 Bloqueado: <strong>{formatearMonto(saldoActual.bloqueado)}</strong>
            </span>
            <span className="text-[10px] text-emerald-400">
              ✨ Disp: <strong>{formatearMonto(saldoActual.disponible)}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* FEED DEL CHAT TIPO WHATSAPP */}
      <div
        className="flex-1 overflow-y-auto p-3 space-y-2.5"
        style={{
          backgroundImage:
            "radial-gradient(circle at 50% 50%, rgba(15, 23, 42, 0.7) 0%, rgba(2, 6, 23, 0.95) 100%)",
        }}
      >
        {estadoSala.mensajes.map((m) => {
          const esMio = m.autor === jugadorActivo;
          const esIa = m.esIa === true;

          return (
            <div
              key={m.id}
              className={`flex flex-col ${
                esIa ? "items-center" : esMio ? "items-end" : "items-start"
              }`}
            >
              <div
                className={`group relative max-w-[85%] sm:max-w-[78%] rounded-xl px-3 py-2 text-xs shadow-md transition-all ${
                  m.sombrear
                    ? "border-2 border-emerald-400/80 bg-emerald-950/70 text-emerald-100 shadow-emerald-500/20"
                    : esIa
                    ? "border border-indigo-700/50 bg-indigo-950/80 text-indigo-100 text-center"
                    : esMio
                    ? "border border-emerald-800/50 bg-emerald-900/40 text-emerald-50 rounded-tr-none"
                    : "border border-slate-800 bg-slate-900/90 text-slate-100 rounded-tl-none"
                }`}
              >
                {/* CABECERA DEL MENSAJE (Autor) */}
                {!esIa && (
                  <div className="flex items-center justify-between gap-3 text-[10px] font-bold pb-1 mb-1 border-b border-white/10">
                    <span className={esMio ? "text-emerald-300" : "text-amber-400"}>
                      {m.autor}
                    </span>
                    <button
                      type="button"
                      onClick={() => setMensajeRespondiendo(m)}
                      className="opacity-60 hover:opacity-100 hover:text-white transition flex items-center gap-0.5 text-[9px] bg-slate-800/60 px-1 rounded"
                      title="Responder a este mensaje"
                    >
                      ↩️ Responder
                    </button>
                  </div>
                )}

                {/* MENSAJE CITADO (RESPUESTA SOBRE MENSAJE PREVIO) */}
                {m.respuestaA && (
                  <div className="mb-1.5 rounded border-l-2 border-amber-400 bg-black/40 px-2 py-1 text-[10px] text-slate-300">
                    <span className="font-bold text-amber-300 block">{m.respuestaA.autor}</span>
                    <p className="truncate text-slate-400 max-w-[240px]">{m.respuestaA.texto}</p>
                    {m.respuestaA.propuesta && (
                      <span className="text-[9px] text-emerald-400 font-semibold block mt-0.5">
                        🎯 {m.respuestaA.propuesta.jugada} #{m.respuestaA.propuesta.caballos} por{" "}
                        {formatearMonto(m.respuestaA.propuesta.montoAbierto)}
                      </span>
                    )}
                  </div>
                )}

                {/* TEXTO DEL MENSAJE */}
                <p className="whitespace-pre-wrap leading-relaxed font-normal">
                  {m.texto.includes("*Aquí Jugaron*") ? (
                    <span className="font-black text-emerald-300 text-[13px] tracking-wide block">
                      {m.texto}
                    </span>
                  ) : m.texto.includes("*Jugaron") ? (
                    <span className="font-black text-amber-300 text-[12px] block">
                      {m.texto}
                    </span>
                  ) : (
                    m.texto
                  )}
                </p>

                {/* BADGE DE PROPUESTA ACTIVA */}
                {m.propuesta && m.propuesta.montoAbierto > 0 && (
                  <div className="mt-1.5 flex items-center justify-between gap-2 rounded bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 text-[10px]">
                    <span className="font-bold text-amber-300">
                      🎯 {m.propuesta.rol === "DA" ? "Consigue/Da" : "Juega"}{" "}
                      {m.propuesta.jugada} #{m.propuesta.caballos}
                    </span>
                    <span className="font-black text-emerald-400">
                      Disp: {formatearMonto(m.propuesta.montoAbierto)}
                    </span>
                  </div>
                )}

                {/* HORA Y TICKS */}
                <div className="mt-1 flex items-center justify-end gap-1 text-[9px] text-slate-400">
                  <span>{m.fecha}</span>
                  {!esIa && <span className="text-emerald-400 font-bold">✓✓</span>}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={chatEndRef} />
      </div>

      {/* ÁREA DE ENTRADA Y RESPUESTA (TIPO WHATSAPP) */}
      <div className="shrink-0 border-t border-slate-800 bg-slate-900 p-2.5">
        {/* BANNER DE RESPUESTA A MENSAJE SELECCIONADO */}
        {mensajeRespondiendo && (
          <div className="mb-2 flex items-center justify-between rounded-md border-l-4 border-amber-400 bg-slate-800/80 px-2.5 py-1.5 text-[11px] animate-in fade-in duration-150">
            <div className="flex flex-col min-w-0 pr-2">
              <span className="font-bold text-amber-400 flex items-center gap-1">
                ↩️ Respondiendo a: <strong>{mensajeRespondiendo.autor}</strong>
              </span>
              <p className="truncate text-slate-300 text-[10px]">
                {mensajeRespondiendo.texto}
              </p>
              {mensajeRespondiendo.propuesta && (
                <span className="text-[10px] font-semibold text-emerald-400">
                  Propuesta: {mensajeRespondiendo.propuesta.jugada} #{mensajeRespondiendo.propuesta.caballos} con {formatearMonto(mensajeRespondiendo.propuesta.montoAbierto)}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setMensajeRespondiendo(null)}
              className="grid h-5 w-5 place-items-center rounded bg-slate-750 text-slate-400 hover:text-white"
              title="Cancelar respuesta"
            >
              ✕
            </button>
          </div>
        )}

        {/* ATAJOS RÁPIDOS */}
        <div className="mb-1.5 flex flex-wrap gap-1">
          {mensajeRespondiendo?.propuesta ? (
            <>
              {mensajeRespondiendo.propuesta.rol === "DA" ? (
                <>
                  <button
                    type="button"
                    onClick={() => setTextoInput("voy")}
                    className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-emerald-300 hover:bg-slate-700"
                  >
                    voy
                  </button>
                  <button
                    type="button"
                    onClick={() => setTextoInput("juego")}
                    className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-emerald-300 hover:bg-slate-700"
                  >
                    juego
                  </button>
                  <button
                    type="button"
                    onClick={() => setTextoInput("jugué")}
                    className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-emerald-300 hover:bg-slate-700"
                  >
                    jugué
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setTextoInput("te doy")}
                    className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-amber-300 hover:bg-slate-700"
                  >
                    te doy
                  </button>
                  <button
                    type="button"
                    onClick={() => setTextoInput("consigo")}
                    className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-amber-300 hover:bg-slate-700"
                  >
                    consigo
                  </button>
                  <button
                    type="button"
                    onClick={() => setTextoInput("jugaste")}
                    className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-amber-300 hover:bg-slate-700"
                  >
                    jugaste
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setTextoInput("consigo 1p del 5 con 50")}
                className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-slate-300 hover:bg-slate-700"
              >
                consigo 1p del 5 con 50
              </button>
              <button
                type="button"
                onClick={() => setTextoInput("juego 1p del 2 con 40")}
                className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-slate-300 hover:bg-slate-700"
              >
                juego 1p del 2 con 40
              </button>
              <button
                type="button"
                onClick={() => setTextoInput("doy 2p del 3 con 100")}
                className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-slate-300 hover:bg-slate-700"
              >
                doy 2p del 3 con 100
              </button>
            </>
          )}
        </div>

        {/* FORMULARIO DE ENTRADA */}
        <form onSubmit={handleEnviarMensaje} className="flex items-center gap-1.5">
          <input
            type="text"
            value={textoInput}
            onChange={(e) => setTextoInput(e.target.value)}
            placeholder={
              mensajeRespondiendo
                ? `Responde a ${mensajeRespondiendo.autor} (ej. voy, te doy, o monto)...`
                : "Mensaje o propuesta (ej. consigo 1p del 5 con 50)..."
            }
            className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
          />

          <button
            type="submit"
            className="rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-black text-white hover:bg-emerald-500 active:scale-95 transition"
            title="Enviar mensaje"
          >
            ➤
          </button>
        </form>
      </div>

      {/* PANEL RESUMEN DE CONCRECIONES CONFIRMADAS */}
      {estadoSala.concrecionesConfirmadas.length > 0 && (
        <div className="shrink-0 border-t border-slate-800 bg-slate-900/90 px-3 py-1.5">
          <details className="group">
            <summary className="flex cursor-pointer items-center justify-between text-[10px] font-bold text-emerald-400 hover:text-emerald-300">
              <span>
                ✅ Concreciones Confirmadas de la Carrera (
                {estadoSala.concrecionesConfirmadas.length})
              </span>
              <span className="text-slate-400 group-open:rotate-180 transition">▼</span>
            </summary>
            <div className="mt-1 max-h-24 overflow-y-auto space-y-1 pt-1 border-t border-slate-800 text-[10px]">
              {estadoSala.concrecionesConfirmadas.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between rounded bg-slate-950/70 px-2 py-0.5 border border-emerald-900/50"
                >
                  <span className="text-slate-300">
                    <strong className="text-amber-300">{c.proponente}</strong> ↔{" "}
                    <strong className="text-emerald-300">{c.aceptante}</strong> ({c.jugada} #{c.caballos})
                  </span>
                  <span className="font-black text-emerald-400">
                    {formatearMonto(c.monto)} comprometido
                  </span>
                </div>
              ))}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
