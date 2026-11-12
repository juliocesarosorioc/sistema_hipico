"use client";

import React, { useState, useRef, useCallback } from "react";
import type { MensajeSala, EstadoCarreraGrupo } from "../lib/chat-p2p";
import { SalaTarjetaCarreraGrafica } from "./SalaTarjetaCarreraGrafica";
import { obtenerColorGualdrapa } from "../lib/chat-p2p";
import { formatearMontoRegional } from "@/shared/lib/dinero";

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

  // Estados para Swipe to Reply (Deslizar para responder estilo WhatsApp)
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [haVibrado, setHaVibrado] = useState(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const mouseStartRef = useRef<{ x: number; y: number } | null>(null);

  // Estado para modal / popover de "Info del mensaje y Estatus"
  const [mostrarInfoEstatus, setMostrarInfoEstatus] = useState(false);

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

  const fechaObj = mensaje.created_at ? new Date(mensaje.created_at) : new Date();
  const horaFmt = fechaObj.toLocaleTimeString("es-VE", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  const fechaCompletaFmt = fechaObj.toLocaleString("es-VE", {
    dateStyle: "medium",
    timeStyle: "medium",
  });

  // Manejadores Touch para Swipe-to-Reply
  const handleTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY };
    setIsDragging(true);
    setHaVibrado(false);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const t = e.touches[0];
    const diffX = t.clientX - touchStartRef.current.x;
    const diffY = t.clientY - touchStartRef.current.y;

    // Si el usuario se está desplazando verticalmente para leer el chat, no interceptamos
    if (Math.abs(diffY) > Math.abs(diffX) && Math.abs(diffX) < 12) {
      return;
    }

    // Permitir deslizamiento hacia la derecha (estilo WhatsApp)
    if (diffX > 0) {
      if (e.cancelable) e.preventDefault();
      // Resistencia elástica hasta un máximo de 75px
      const nuevoOffset = Math.min(75, diffX * 0.72);
      setDragOffset(nuevoOffset);

      if (nuevoOffset >= 42 && !haVibrado) {
        if (typeof window !== "undefined" && window.navigator?.vibrate) {
          window.navigator.vibrate(15);
        }
        setHaVibrado(true);
      }
    }
  };

  const handleTouchEnd = () => {
    if (dragOffset >= 42) {
      onCitar(mensaje);
    }
    setDragOffset(0);
    setIsDragging(false);
    touchStartRef.current = null;
    setHaVibrado(false);
  };

  // Manejadores Mouse (Desktop drag) para Swipe-to-Reply
  const handleMouseDown = (e: React.MouseEvent) => {
    // Solo clic primario izquierdo
    if (e.button !== 0) return;
    mouseStartRef.current = { x: e.clientX, y: e.clientY };
    setIsDragging(true);
    setHaVibrado(false);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!mouseStartRef.current || !isDragging) return;
    const diffX = e.clientX - mouseStartRef.current.x;
    const diffY = e.clientY - mouseStartRef.current.y;

    if (diffX > 4 && Math.abs(diffX) > Math.abs(diffY)) {
      const nuevoOffset = Math.min(75, diffX * 0.72);
      setDragOffset(nuevoOffset);

      if (nuevoOffset >= 42 && !haVibrado) {
        setHaVibrado(true);
      }
    }
  };

  const handleMouseUp = () => {
    if (dragOffset >= 42) {
      onCitar(mensaje);
    }
    setDragOffset(0);
    setIsDragging(false);
    mouseStartRef.current = null;
    setHaVibrado(false);
  };

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
            style={{
              fontSize: `${tamanoLetra}px`,
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Helvetica, Arial, sans-serif',
            }}
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

  // 3. Mensajes regulares, privados, propuestas y concreciones con Swipe to Reply y Estatus
  return (
    <div
      className={`relative flex flex-col w-full my-1 select-none overflow-x-hidden ${
        esMio ? "items-end" : "items-start"
      }`}
    >
      {/* Icono animado de Responder detrás de la burbuja (estilo WhatsApp) */}
      <div
        className="absolute left-2 top-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-none transition-transform duration-75 z-0"
        style={{
          opacity: Math.min(1, dragOffset / 30),
          transform: `translateY(-50%) translateX(${Math.max(0, dragOffset - 38)}px) scale(${Math.min(
            1.2,
            0.65 + dragOffset / 60
          )})`,
        }}
      >
        <div
          className={`h-9 w-9 rounded-full flex items-center justify-center shadow-lg transition-colors duration-150 ${
            dragOffset >= 42
              ? "bg-[#00a884] text-white ring-2 ring-[#00a884]/50"
              : "bg-[#202c33] text-[#8696a0] border border-[#2a3942]"
          }`}
        >
          <svg
            className={`w-4 h-4 transition-transform duration-150 ${
              dragOffset >= 42 ? "scale-110 -rotate-12" : ""
            }`}
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z" />
          </svg>
        </div>
      </div>

      {/* Contenedor deslizable de la Burbuja */}
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{
          transform: `translateX(${dragOffset}px)`,
          transition: isDragging ? "none" : "transform 0.22s cubic-bezier(0.25, 1, 0.5, 1)",
          fontSize: `${tamanoLetra}px`,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Helvetica, Arial, sans-serif',
        }}
        className={`group relative z-10 max-w-[88%] sm:max-w-[75%] rounded-2xl p-3 shadow-sm select-text cursor-grab active:cursor-grabbing transition-shadow ${
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
        {/* Encabezado: Autor, Rol y Botones de Acción Rápida */}
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

          <div className="flex items-center gap-1">
            {/* Botón para ver Estatus Detallado estilo WhatsApp */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMostrarInfoEstatus(true);
              }}
              className="text-[10px] text-[#8696a0] hover:text-[#53bdeb] px-1 py-0.5 rounded hover:bg-black/20 transition-colors flex items-center gap-0.5"
              title="Ver estatus y detalles del mensaje"
            >
              <span className="text-xs">ℹ️</span>
              <span className="hidden sm:inline">Estatus</span>
            </button>

            {/* Botón de Citar (Clic tradicional además del swipe) */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onCitar(mensaje);
              }}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-[11px] text-[#8696a0] hover:text-white px-1.5 py-0.5 rounded hover:bg-black/20"
              title="Desliza a la derecha o haz clic para responder"
            >
              ↩ Responder
            </button>
          </div>
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

        {/* Imagen adjunta si existe (solo administrador) */}
        {mensaje.imagen_url && (
          <div className="my-2 overflow-hidden rounded-xl border border-[#2a3942] bg-[#111b21] max-w-sm">
            <img
              src={mensaje.imagen_url}
              alt="Adjunto"
              className="max-h-72 w-auto object-contain cursor-pointer rounded-lg hover:opacity-95 transition"
              onClick={() => {
                if (typeof window !== "undefined") {
                  const w = window.open("");
                  w?.document.write(
                    `<img src="${mensaje.imagen_url}" style="max-width:100%;height:auto;margin:auto;display:block;" />`
                  );
                }
              }}
            />
          </div>
        )}

        {/* Cuerpo del Texto */}
        <div className="whitespace-pre-wrap leading-relaxed select-text">
          {mensaje.texto}
        </div>

        {/* Tarjeta Interactiva de Propuesta Abierta con FIFO */}
        {esPropuesta && mensaje.datos_jugada && (
          <div
            className={`mt-2.5 rounded-xl bg-black/40 p-2.5 border transition-all ${
              esAnulada
                ? "border-rose-500/40 opacity-75"
                : esExpirada
                ? "border-amber-500/40 opacity-75"
                : "border-cyan-500/30"
            }`}
          >
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

                {/* Badges de Estado de la Propuesta */}
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
                <span className="text-[10px] text-[#8696a0] block uppercase font-bold">
                  Disponible
                </span>
                <span
                  className={`font-mono font-black tabular-nums ${
                    esAnulada
                      ? "line-through text-rose-400"
                      : esExpirada
                      ? "text-amber-400"
                      : "text-cyan-300"
                  }`}
                >
                  ${formatearMontoRegional(Number(mensaje.monto_disponible ?? mensaje.monto_propuesto))}
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

            {/* Desglose en vivo: Van jugando por X + quiénes jugaron */}
            {Array.isArray(mensaje.desglose_jugaron) && mensaje.desglose_jugaron.length > 0 && (
              <div className="mb-2 rounded-lg bg-emerald-950/40 border border-emerald-500/30 px-2.5 py-1.5 text-[11px] space-y-0.5">
                <div className="font-bold text-emerald-300">
                  🤝 Van jugando por{" "}
                  {formatearMontoRegional(
                    mensaje.desglose_jugaron.reduce((acc, x) => acc + Number(x.monto || 0), 0)
                  )}
                </div>
                {mensaje.desglose_jugaron.map((item, idx) => (
                  <div key={idx} className="text-emerald-100/90 font-medium">
                    • <span className="font-bold">{item.jugador}</span> jugó{" "}
                    <span className="font-mono font-bold">{formatearMontoRegional(item.monto)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Acciones de la propuesta */}
            <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1 border-t border-[#2a3942]">
              {/* Botón para que el proponente anule su propia jugada ("Se fue") */}
              {esMio &&
                !esAnulada &&
                !esExpirada &&
                (mensaje.monto_disponible ?? 0) > 0 &&
                onAnularPropuestaUsuario && (
                  <button
                    type="button"
                    onClick={() => onAnularPropuestaUsuario(mensaje)}
                    className="rounded-lg bg-rose-950/80 hover:bg-rose-900 border border-rose-600/50 text-rose-200 font-bold text-[11px] py-1 px-2.5 active:scale-95 transition-all flex items-center gap-1"
                  >
                    🚫 Retirar propuesta ("Se fue")
                  </button>
                )}

              {/* Botón exclusivo para que el Administrador / Operador anule propuestas */}
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
                      ⚡ Jugar Todo (${formatearMontoRegional(Number(mensaje.monto_disponible))})
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

        {/* Pie de burbuja interactivo: Hora, Estatus de Entrega y Doble Check WhatsApp */}
        <div
          onClick={(e) => {
            e.stopPropagation();
            setMostrarInfoEstatus(true);
          }}
          className="flex items-center justify-end gap-1.5 pt-1 text-[10px] text-[#8696a0] cursor-pointer hover:text-[#53bdeb] transition-colors select-none"
          title="Toca para ver el estatus completo del mensaje"
        >
          <span className="font-mono tabular-nums">{horaFmt}</span>

          {/* Iconos de Estatus estilo WhatsApp */}
          <span className="inline-flex items-center gap-0.5 font-bold">
            {esMio ? (
              <span className="text-[#53bdeb] text-xs font-black tracking-tighter" title="Entregado y Leído en Sala">
                ✓✓
              </span>
            ) : (
              <span className="text-[#8696a0] text-xs" title="Recibido en Sala">
                ✓✓
              </span>
            )}
          </span>
        </div>
      </div>

      {/* Modal / Popover Informativo de Estatus estilo WhatsApp */}
      {mostrarInfoEstatus && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-fade-in"
          onClick={() => setMostrarInfoEstatus(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-[#202c33] border border-[#2a3942] p-4 text-[#e9edef] shadow-2xl space-y-3.5"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header del Modal */}
            <div className="flex items-center justify-between border-b border-[#2a3942] pb-2.5">
              <div className="flex items-center gap-2">
                <span className="text-base text-[#00a884]">ℹ️</span>
                <h3 className="text-sm font-bold text-white">Info. del Mensaje & Estatus</h3>
              </div>
              <button
                type="button"
                onClick={() => setMostrarInfoEstatus(false)}
                className="h-6 w-6 rounded-full bg-[#111b21] hover:bg-[#2a3942] text-slate-300 flex items-center justify-center text-xs"
              >
                ✕
              </button>
            </div>

            {/* Previsualización del Contenido del Mensaje */}
            <div className="rounded-xl bg-[#111b21] p-3 border border-[#2a3942] text-xs space-y-1">
              <span className="block font-bold text-[#53bdeb]">
                {esMio ? "Tú" : mensaje.autor_nombre} ({mensaje.autor_rol})
              </span>
              <p className="text-[#d1d7db] line-clamp-3 italic">{mensaje.texto}</p>
            </div>

            {/* Lista de Estatus Estilo WhatsApp */}
            <div className="space-y-2.5 text-xs">
              <div className="flex items-center justify-between p-2 rounded-lg bg-black/20">
                <div className="flex items-center gap-2">
                  <span className="text-[#53bdeb] text-sm font-bold">✓✓</span>
                  <div>
                    <span className="font-bold block text-white">Leído en Sala</span>
                    <span className="text-[10px] text-[#8696a0]">Visto por los miembros y Agente IA</span>
                  </div>
                </div>
                <span className="font-mono text-[11px] text-[#53bdeb] font-semibold">{horaFmt}</span>
              </div>

              <div className="flex items-center justify-between p-2 rounded-lg bg-black/20">
                <div className="flex items-center gap-2">
                  <span className="text-[#8696a0] text-sm font-bold">✓✓</span>
                  <div>
                    <span className="font-bold block text-white">Entregado</span>
                    <span className="text-[10px] text-[#8696a0]">Sincronizado en tiempo real</span>
                  </div>
                </div>
                <span className="font-mono text-[11px] text-[#8696a0]">{horaFmt}</span>
              </div>

              <div className="flex items-center justify-between p-2 rounded-lg bg-black/20">
                <div>
                  <span className="font-bold block text-white">Fecha y Hora de Auditoría</span>
                  <span className="font-mono text-[10px] text-[#8696a0]">{fechaCompletaFmt}</span>
                </div>
                <span className="text-[10px] text-emerald-400 font-mono">En línea</span>
              </div>

              {/* Si es una propuesta / jugada, mostrar su estado financiero */}
              {esPropuesta && mensaje.datos_jugada && (
                <div className="p-2.5 rounded-lg border border-cyan-500/30 bg-cyan-950/20 space-y-1.5">
                  <span className="text-[11px] font-bold text-cyan-300 block uppercase">
                    Estatus de la Jugada Hípica
                  </span>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-[#8696a0]">Estado actual:</span>
                    <span className="font-bold">
                      {esAnulada ? (
                        <span className="text-rose-400">🚫 Anulada / Retirada</span>
                      ) : esExpirada ? (
                        <span className="text-amber-400">⏳ Expirada</span>
                      ) : (mensaje.monto_disponible ?? 0) <= 0 ? (
                        <span className="text-emerald-400">⚡ Concretada / Casada al 100%</span>
                      ) : (
                        <span className="text-cyan-300">🟢 Activa (${formatearMontoRegional(Number(mensaje.monto_disponible))} disponible)</span>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-[#8696a0]">Monto inicial:</span>
                    <span className="font-mono font-bold text-white">${formatearMontoRegional(Number(mensaje.monto_propuesto))}</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-[#8696a0]">Caballo & Carrera:</span>
                    <span className="font-bold text-white">#{mensaje.datos_jugada.caballo} ({mensaje.datos_jugada.jugada})</span>
                  </div>
                </div>
              )}
            </div>

            {/* Acciones en el modal */}
            <div className="pt-2 flex items-center justify-end gap-2 border-t border-[#2a3942]">
              <button
                type="button"
                onClick={() => {
                  setMostrarInfoEstatus(false);
                  onCitar(mensaje);
                }}
                className="flex items-center gap-1.5 rounded-xl bg-[#00a884] hover:bg-[#02906f] px-3 py-1.5 text-xs font-bold text-white shadow active:scale-95 transition-all"
              >
                <span>↩</span> Responder
              </button>
              <button
                type="button"
                onClick={() => setMostrarInfoEstatus(false)}
                className="rounded-xl bg-[#2a3942] hover:bg-[#32424b] px-3 py-1.5 text-xs font-semibold text-slate-300 active:scale-95 transition-all"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
