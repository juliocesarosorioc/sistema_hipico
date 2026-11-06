"use client";

import React from "react";
import type { MensajeSala, EstadoCarreraGrupo } from "../lib/chat-p2p";
import { SalaTarjetaCarreraGrafica } from "./SalaTarjetaCarreraGrafica";
import { obtenerColorGualdrapa } from "../lib/chat-p2p";

interface Props {
  mensaje: MensajeSala;
  mensajeCitado?: MensajeSala | null;
  carreraActiva: EstadoCarreraGrupo;
  nombreUsuarioActual: string;
  tamanoLetra: number;
  esOperadorOAdmin?: boolean;
  onCitar: (msg: MensajeSala) => void;
  onTomarPropuestaFifo: (msg: MensajeSala, montoOComando: string) => void;
  onAnularPropuestaUsuario?: (msg: MensajeSala) => void;
  onAnularPropuestaAdmin?: (msgId: string) => void;
  onEliminarMensajeOperador?: (msgId: string) => void;
}

export function SalaBurbujaMensaje({
  mensaje,
  mensajeCitado,
  carreraActiva,
  nombreUsuarioActual,
  tamanoLetra,
  esOperadorOAdmin,
  onCitar,
  onTomarPropuestaFifo,
  onAnularPropuestaUsuario,
  onAnularPropuestaAdmin,
  onEliminarMensajeOperador,
}: Props) {
  const esMio = mensaje.esMio ?? false;
  const esBot = mensaje.autor_rol === "BOT";
  const esPrivado = Boolean(mensaje.destinatario_privado_id);
  const esPropuesta = mensaje.tipo === "PROPUESTA";
  const esConcrecion = mensaje.tipo === "CONCRECION";
  const esImagenCarrera = mensaje.tipo === "IMAGEN_CARRERA";
  const esPizarra = mensaje.tipo === "PIZARRA";
  const esCerrada = carreraActiva.estado === "CERRADA" || carreraActiva.estado === "LIQUIDADA";

  // Control de expiración de 3 minutos para propuestas
  const creadoMs = mensaje.created_at ? new Date(mensaje.created_at).getTime() : Date.now();
  const transcurridoMs = Date.now() - creadoMs;
  const esExpirada = esPropuesta && transcurridoMs > 3 * 60 * 1000;
  const esAnulada =
    esPropuesta &&
    ((mensaje.monto_disponible ?? 0) <= 0 &&
      (mensaje.datos_jugada?.estado === "ANULADA" ||
        mensaje.texto.toLowerCase().includes("anulada") ||
        mensaje.texto.toLowerCase().includes("se fue")));
  const tiempoRestanteSeg = Math.max(0, Math.ceil((3 * 60 * 1000 - transcurridoMs) / 1000));
  const minRest = Math.floor(tiempoRestanteSeg / 60);
  const segRest = tiempoRestanteSeg % 60;

  const horaFmt = mensaje.created_at
    ? new Date(mensaje.created_at).toLocaleTimeString("es-VE", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      })
    : "";

  // 1. Tarjeta Gráfica de Carrera (Publicada automáticamente al abrir carrera)
  if (esImagenCarrera) {
    return (
      <div className="flex flex-col items-center my-3 w-full">
        <SalaTarjetaCarreraGrafica
          carrera={carreraActiva}
          horaPublicacion={horaFmt}
          esOperadorOAdmin={esOperadorOAdmin}
          onEliminar={
            esOperadorOAdmin && onEliminarMensajeOperador
              ? () => onEliminarMensajeOperador(mensaje.id)
              : undefined
          }
        />
      </div>
    );
  }

  // 2. Anuncio Oficial de Pizarra de Llegada y Liquidación
  if (esPizarra) {
    return (
      <div className="flex flex-col items-center my-3 w-full">
        <div className="w-full max-w-lg rounded-2xl bg-gradient-to-r from-amber-950/70 via-slate-900 to-amber-950/70 border-2 border-amber-500/60 p-4 shadow-xl text-white">
          <div className="flex items-center gap-2 pb-2 border-b border-amber-500/30 text-amber-300 font-bold text-xs uppercase tracking-wider">
            <span>🏁</span> Pizarra Oficial & Liquidación de Sala
          </div>
          <div
            style={{ fontSize: `${tamanoLetra}px` }}
            className="whitespace-pre-wrap pt-2 leading-relaxed text-[#e9edef]"
          >
            {mensaje.texto}
          </div>
          <div className="pt-2 text-right text-[10px] text-amber-200/70 font-mono tabular-nums">
            {horaFmt}
          </div>
        </div>
      </div>
    );
  }

  // 3. Mensajes regulares, privados, propuestas y concreciones
  return (
    <div
      className={`flex flex-col w-full my-1 ${
        esMio ? "items-end" : "items-start"
      }`}
    >
      <div
        style={{ fontSize: `${tamanoLetra}px` }}
        className={`group relative max-w-[88%] sm:max-w-[75%] rounded-2xl p-3 shadow-sm select-text transition-all ${
          esPrivado
            ? "bg-purple-950/90 text-purple-100 border-2 border-purple-500/70 shadow-md"
            : esConcrecion
            ? "bg-emerald-950/90 text-emerald-100 border-2 border-emerald-500/70 shadow-md"
            : esPropuesta
            ? "bg-[#202c33] text-[#e9edef] border-2 border-cyan-500/50 shadow-md"
            : esMio
            ? "bg-[#005c4b] text-[#e9edef] rounded-tr-sm"
            : esBot
            ? "bg-[#202c33] text-[#e9edef] rounded-tl-sm border border-[#2a3942]"
            : "bg-[#202c33] text-[#e9edef] rounded-tl-sm border border-[#2a3942]"
        }`}
      >
        {/* Encabezado: Autor y Rol */}
        <div className="flex items-center justify-between gap-3 pb-1 text-[11px]">
          <div className="flex items-center gap-1.5 font-bold">
            {esBot ? (
              <span className="text-[#00a884] flex items-center gap-1">
                🤖 Agente IA Oficial
              </span>
            ) : esMio ? (
              <span className="text-emerald-200">Tú</span>
            ) : (
              <span className="text-[#53bdeb]">{mensaje.autor_nombre}</span>
            )}

            {esPrivado && (
              <span className="rounded bg-purple-600 px-1.5 py-0.2 text-[9px] font-black text-white flex items-center gap-0.5">
                🔒 Privado (DM)
              </span>
            )}
          </div>

          {/* Botón de Citar (Swipe/Click-to-reply) */}
          <button
            type="button"
            onClick={() => onCitar(mensaje)}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-[11px] text-[#8696a0] hover:text-white px-1"
            title="Responder / Citar este mensaje"
          >
            ↩ Citar
          </button>
        </div>

        {/* Cita de mensaje previo (si reply_to_msg_id existe) */}
        {mensajeCitado && (
          <div className="mb-2 rounded-lg border-l-4 border-[#00a884] bg-black/30 p-2 text-xs">
            <span className="block font-bold text-[#00a884] text-[10px]">
              {mensajeCitado.autor_nombre}
            </span>
            <p className="line-clamp-2 text-[#8696a0] italic">{mensajeCitado.texto}</p>
          </div>
        )}

        {/* Cuerpo del Texto */}
        <div className="whitespace-pre-wrap leading-relaxed">
          {mensaje.texto}
        </div>

        {/* Tarjeta Interactiva de Propuesta Abierta con FIFO */}
        {esPropuesta && mensaje.datos_jugada && (
          <div className={`mt-2.5 rounded-xl bg-black/40 p-2.5 border transition-all ${
            esAnulada
              ? "border-rose-500/40 opacity-75"
              : esExpirada
              ? "border-amber-500/40 opacity-75"
              : "border-cyan-500/30"
          }`}>
            <div className="flex items-center justify-between text-xs pb-1.5">
              <div className="flex items-center gap-1.5">
                {(() => {
                  const gualdrapa = obtenerColorGualdrapa(mensaje.datos_jugada.caballo);
                  return (
                    <span
                      style={{ backgroundColor: gualdrapa.bg, color: gualdrapa.text }}
                      className="h-6 w-6 rounded-full flex items-center justify-center font-mono font-black text-xs shadow"
                    >
                      {mensaje.datos_jugada.caballo}
                    </span>
                  );
                })()}
                <span className="font-bold text-white">
                  {mensaje.datos_jugada.jugada} #{mensaje.datos_jugada.caballo}
                </span>

                {/* Badges de Estado */}
                {esAnulada && (
                  <span className="rounded bg-rose-900/90 border border-rose-500/60 px-1.5 py-0.5 text-[9px] font-black uppercase text-rose-200">
                    🚫 Se fue
                  </span>
                )}
                {esExpirada && !esAnulada && (
                  <span className="rounded bg-amber-900/90 border border-amber-500/60 px-1.5 py-0.5 text-[9px] font-black uppercase text-amber-200">
                    ⏳ Vencida (3m)
                  </span>
                )}
                {!esAnulada && !esExpirada && (mensaje.monto_disponible ?? 0) > 0 && (
                  <span className="text-[10px] text-cyan-300 font-mono flex items-center gap-1">
                    ⏱️ {minRest}:{String(segRest).padStart(2, "0")}
                  </span>
                )}
              </div>

              <div className="text-right">
                <span className="text-[10px] text-[#8696a0] block uppercase font-bold">Disponible</span>
                <span className={`font-mono font-black tabular-nums ${
                  esAnulada ? "line-through text-rose-400" : esExpirada ? "text-amber-400" : "text-cyan-300"
                }`}>
                  ${Number(mensaje.monto_disponible ?? mensaje.monto_propuesto).toFixed(2)}
                </span>
              </div>
            </div>

            {/* Barra de progreso de consumo FIFO */}
            {mensaje.monto_propuesto && (
              <div className="w-full bg-[#111b21] rounded-full h-1.5 mb-2 overflow-hidden">
                <div
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    esAnulada ? "bg-rose-500" : esExpirada ? "bg-amber-500" : "bg-cyan-400"
                  }`}
                  style={{
                    width: `${Math.min(
                      100,
                      Math.max(
                        0,
                        (1 - (mensaje.monto_disponible ?? 0) / mensaje.monto_propuesto) * 100
                      )
                    )}%`,
                  }}
                />
              </div>
            )}

            {/* Acciones de la propuesta */}
            <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1 border-t border-[#2a3942]">
              {/* Botón para que el proponente anule su propia jugada ("Se fue") */}
              {esMio && !esAnulada && !esExpirada && (mensaje.monto_disponible ?? 0) > 0 && onAnularPropuestaUsuario && (
                <button
                  type="button"
                  onClick={() => onAnularPropuestaUsuario(mensaje)}
                  className="rounded-lg bg-rose-950/80 hover:bg-rose-900 border border-rose-600/50 text-rose-200 font-bold text-[11px] py-1 px-2.5 active:scale-95 transition-all flex items-center gap-1"
                >
                  🚫 Retirar propuesta ("Se fue")
                </button>
              )}

              {/* Botón exclusivo para que el Administrador / Operador anule propuestas por error de herramienta */}
              {esOperadorOAdmin && !esAnulada && onAnularPropuestaAdmin && (
                <button
                  type="button"
                  onClick={() => onAnularPropuestaAdmin(mensaje.id)}
                  className="rounded-lg bg-amber-950/80 hover:bg-amber-900 border border-amber-600/50 text-amber-200 font-bold text-[11px] py-1 px-2.5 active:scale-95 transition-all flex items-center gap-1 ml-auto"
                >
                  ❌ Anular (Admin)
                </button>
              )}

              {/* Mensaje de expirada o anulada si no se puede tomar */}
              {esAnulada && (
                <div className="text-[11px] text-rose-300 italic w-full text-center py-1">
                  🚫 Esta propuesta fue retirada por el usuario o administración ("Se fue").
                </div>
              )}
              {esExpirada && !esAnulada && (
                <div className="text-[11px] text-amber-300 italic w-full text-center py-1">
                  ⏳ La propuesta superó la duración máxima de 3 minutos y ha expirado.
                </div>
              )}

              {/* Botones FIFO para que otros jugadores o administradores tomen la jugada */}
              {!esMio &&
                !esCerrada &&
                !esAnulada &&
                !esExpirada &&
                (mensaje.monto_disponible ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-1.5 w-full">
                    <button
                      type="button"
                      onClick={() => onTomarPropuestaFifo(mensaje, "J")}
                      className="flex-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs py-1.5 px-2 shadow active:scale-95 transition-all text-center font-mono tabular-nums"
                    >
                      ⚡ Jugar Todo (${Number(mensaje.monto_disponible).toFixed(0)})
                    </button>
                    {Number(mensaje.monto_disponible) >= 50 && (
                      <button
                        type="button"
                        onClick={() => onTomarPropuestaFifo(mensaje, "50")}
                        className="rounded-lg bg-[#2a3942] hover:bg-[#32424b] text-cyan-200 font-bold text-xs py-1.5 px-2.5 font-mono tabular-nums active:scale-95 transition-all"
                      >
                        $50
                      </button>
                    )}
                    {Number(mensaje.monto_disponible) >= 20 && (
                      <button
                        type="button"
                        onClick={() => onTomarPropuestaFifo(mensaje, "20")}
                        className="rounded-lg bg-[#2a3942] hover:bg-[#32424b] text-cyan-200 font-bold text-xs py-1.5 px-2.5 font-mono tabular-nums active:scale-95 transition-all"
                      >
                        $20
                      </button>
                    )}
                    {Number(mensaje.monto_disponible) >= 10 && (
                      <button
                        type="button"
                        onClick={() => onTomarPropuestaFifo(mensaje, "10")}
                        className="rounded-lg bg-[#2a3942] hover:bg-[#32424b] text-cyan-200 font-bold text-xs py-1.5 px-2.5 font-mono tabular-nums active:scale-95 transition-all"
                      >
                        $10
                      </button>
                    )}
                  </div>
                )}
            </div>
          </div>
        )}

        {/* Pie de burbuja: Hora y Checks */}
        <div className="flex items-center justify-end gap-1 pt-1 text-[10px] text-[#8696a0]">
          <span className="font-mono tabular-nums">{horaFmt}</span>
          {esMio && <span className="text-[#53bdeb] font-bold">✓✓</span>}
        </div>
      </div>
    </div>
  );
}
