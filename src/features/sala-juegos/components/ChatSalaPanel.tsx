"use client";

import React, { useState, useEffect, useRef } from "react";
import { salaApi } from "../lib/sala-api";
import { supabase } from "@/core/supabase";

interface PropsChatSalaPanel {
  sala: any;
  grupoId: string;
  grupoNombre: string;
  identidad: any;
  tamanoLetra: number;
  onActualizarSaldo?: () => void;
  onAbrirOperador?: () => void;
}

export function ChatSalaPanel({
  sala,
  grupoId,
  grupoNombre,
  identidad,
  tamanoLetra,
  onActualizarSaldo,
  onAbrirOperador,
}: PropsChatSalaPanel) {
  const [mensajes, setMensajes] = useState<any[]>([]);
  const [textoInput, setTextoInput] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [replyToPropuesta, setReplyToPropuesta] = useState<any | null>(null);
  const [tomandoParteId, setTomandoParteId] = useState<string | null>(null);
  const [montoParcialInput, setMontoParcialInput] = useState<string>("");
  const [sugerenciaPedagogica, setSugerenciaPedagogica] = useState<{
    mensaje: string;
    sugerencias: string[];
    jugadaEstandarizada?: string;
  } | null>(null);

  // Control de menú contextual estilo WhatsApp
  const [menuContextual, setMenuContextual] = useState<{
    x: number;
    y: number;
    msg: any;
  } | null>(null);

  // Control táctil Swipe-to-reply
  const [swipingId, setSwipingId] = useState<string | null>(null);
  const [swipeOffset, setSwipeOffset] = useState<number>(0);
  const touchStartXRef = useRef<number>(0);
  const touchStartYRef = useRef<number>(0);
  const isSwipingRef = useRef<boolean>(false);

  // Timer tick en vivo para actualizar expiración de vigencia cada 3s
  const [ahora, setAhora] = useState<number>(Date.now());
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 3000);
    return () => clearInterval(t);
  }, []);

  // Cerrar menú contextual al hacer clic fuera
  useEffect(() => {
    const handleClickFuera = () => setMenuContextual(null);
    window.addEventListener("click", handleClickFuera);
    return () => window.removeEventListener("click", handleClickFuera);
  }, []);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleTouchStart = (e: React.TouchEvent, msg: any) => {
    touchStartXRef.current = e.touches[0].clientX;
    touchStartYRef.current = e.touches[0].clientY;
    isSwipingRef.current = false;
  };

  const handleTouchMove = (e: React.TouchEvent, msg: any) => {
    const deltaX = e.touches[0].clientX - touchStartXRef.current;
    const deltaY = Math.abs(e.touches[0].clientY - touchStartYRef.current);

    if (deltaX > 8 && deltaY < 40) {
      isSwipingRef.current = true;
      setSwipingId(msg.id);
      const capped = Math.min(80, Math.max(0, deltaX));
      setSwipeOffset(capped);
    }
  };

  const handleTouchEnd = (msg: any) => {
    if (isSwipingRef.current && swipeOffset >= 40) {
      if (typeof window !== "undefined" && (window as any).navigator?.vibrate) {
        try {
          (window as any).navigator.vibrate(20);
        } catch {}
      }
      setReplyToPropuesta(msg);
      inputRef.current?.focus();
    }
    setSwipingId(null);
    setSwipeOffset(0);
    isSwipingRef.current = false;
  };

  const cargarMensajes = async () => {
    if (!sala?.id) return;
    const res = await salaApi.getMensajes(sala.id, 60);
    if (res.ok && res.data?.mensajes) {
      setMensajes(res.data.mensajes);
    }
  };

  useEffect(() => {
    cargarMensajes();

    // Polling resiliente cada 2500ms
    const interval = setInterval(cargarMensajes, 2500);

    // Suscripción en tiempo real instantánea (<100ms) vía Supabase Channel
    let canal: any = null;
    if (supabase && sala?.id) {
      try {
        canal = supabase
          .channel(`sala-${sala.id}`)
          .on("broadcast", { event: "nuevo_mensaje" }, () => {
            cargarMensajes();
          })
          .on("broadcast", { event: "carrera_abierta" }, () => {
            cargarMensajes();
          })
          .on("broadcast", { event: "carrera_cerrada" }, () => {
            cargarMensajes();
          })
          .on("broadcast", { event: "carrera_liquidada" }, () => {
            cargarMensajes();
            onActualizarSaldo?.();
          })
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "chat_mensajes",
              filter: `sala_id=eq.${sala.id}`,
            },
            () => {
              cargarMensajes();
            }
          )
          .subscribe();
      } catch {
        // En caso de que Realtime no esté habilitado en el entorno
      }
    }

    return () => {
      clearInterval(interval);
      if (canal && supabase) {
        try {
          supabase.removeChannel(canal);
        } catch {
          // noop
        }
      }
    };
  }, [sala?.id]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [mensajes, sugerenciaPedagogica]);

  const enviarMensaje = async (textoAEnviar?: string) => {
    const texto = (textoAEnviar || textoInput).trim();
    if (!texto || !sala?.id) return;

    setEnviando(true);
    try {
      const payload: any = {
        salaId: sala.id,
        grupoId,
        texto,
      };

      if (replyToPropuesta?.id) {
        payload.propuestaId = replyToPropuesta.id;
      }

      const res = await salaApi.enviarMensaje(payload);

      if (res.ok) {
        if (res.data?.esCorreccionPedagogica) {
          setSugerenciaPedagogica({
            mensaje: res.data.mensajePedagogico || "Corrección pedagógica",
            sugerencias: res.data.sugerencias || [],
            jugadaEstandarizada: res.data.jugadaEstandarizada,
          });
        } else {
          setSugerenciaPedagogica(null);
          setTextoInput("");
          setReplyToPropuesta(null);
          setTomandoParteId(null);
          setMontoParcialInput("");
          await cargarMensajes();
          onActualizarSaldo?.();
        }
      } else {
        alert(res.error || "No se pudo procesar la jugada");
      }
    } catch (err: any) {
      alert("Error: " + (err?.message || err));
    } finally {
      setEnviando(false);
    }
  };

  const aceptarPropuesta = async (propuestaId: string, monto?: number, textoPersonalizado?: string) => {
    if (!sala?.id) return;
    if (sala.estado_carrera !== "abierta") {
      alert("La carrera está cerrada para nuevas jugadas.");
      return;
    }

    setEnviando(true);
    try {
      const res = await salaApi.enviarMensaje({
        salaId: sala.id,
        grupoId,
        texto: textoPersonalizado || (monto ? `Tomar $${monto}` : "Tomar jugada total"),
        propuestaId,
        monto: monto,
      } as any);

      if (res.ok) {
        setTomandoParteId(null);
        setMontoParcialInput("");
        setReplyToPropuesta(null);
        await cargarMensajes();
        onActualizarSaldo?.();
      } else {
        alert(res.error || "No se pudo tomar la jugada");
      }
    } catch (err: any) {
      alert("Error: " + (err?.message || err));
    } finally {
      setEnviando(false);
    }
  };

  const aplicarSugerencia = (sug: string) => {
    setTextoInput(sug);
    setSugerenciaPedagogica(null);
    enviarMensaje(sug);
  };

  const miId = identidad?.usuarioId || identidad?.clienteRow?.id;
  const miNombre = identidad?.nombre || identidad?.clienteRow?.nombre;

  const esMio = (remitenteId?: string, remitenteNombre?: string) => {
    if (miId && remitenteId && String(remitenteId).toLowerCase() === String(miId).toLowerCase()) return true;
    if (miNombre && remitenteNombre && remitenteNombre.trim().toLowerCase() === miNombre.trim().toLowerCase()) return true;
    return false;
  };

  const mensajesMap = React.useMemo(() => {
    const map = new Map<string, any>();
    for (const m of mensajes) {
      if (m?.id) map.set(m.id, m);
    }
    return map;
  }, [mensajes]);

  const esCarreraAbierta = sala?.estado_carrera === "abierta";

  return (
    <div className="flex flex-col h-full bg-[#0b141a] border-x border-[#202c33] overflow-hidden select-none">
      {/* Cabecera de la Sala */}
      <div className="bg-[#202c33] px-4 py-2.5 flex items-center justify-between border-b border-[#2a3942]">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-emerald-700/40 border border-emerald-500/40 flex items-center justify-center text-sm font-black text-emerald-400">
            🏇
          </div>
          <div>
            <h2 className="text-xs font-bold text-white flex items-center gap-1.5">
              <span>{sala?.nombre_sala}</span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full font-black uppercase ${
                  esCarreraAbierta
                    ? "bg-emerald-950 text-emerald-400 border border-emerald-600/50"
                    : "bg-amber-950 text-amber-400 border border-amber-600/50"
                }`}
              >
                ● {sala?.estado_carrera || "CERRADA"}
              </span>
            </h2>
            <p className="text-[11px] text-gray-400">
              {sala?.hipodromo_activo || "HIPÓDROMO"} — Carrera #{sala?.numero_carrera_activa || 1}
              {sala?.distancia_activa ? ` (${sala.distancia_activa}m)` : ""}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-emerald-400 font-mono hidden sm:inline bg-[#111b21] px-2 py-0.5 rounded border border-gray-800">
            🔒 E2EE SHA-256
          </span>
          {identidad.esOperador && (
            <button
              onClick={onAbrirOperador}
              className="bg-emerald-600 hover:bg-emerald-500 text-black font-bold text-[11px] px-2.5 py-1 rounded-md transition flex items-center gap-1"
            >
              <span>🛠️</span>
              <span>Operador</span>
            </button>
          )}
        </div>
      </div>

      {/* Feed de Mensajes */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#0b141a]/95"
        style={{ fontSize: `${tamanoLetra}px` }}
      >
        {mensajes.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-gray-500 text-xs text-center p-6 space-y-2">
            <span className="text-3xl">🏇</span>
            <p className="font-semibold text-gray-400">La sala está lista y segura.</p>
            <p className="text-[11px] max-w-xs">
              Escribe tus jugadas de puestos (ej. <code className="text-emerald-400">Juego 1p del 5 con 100</code>) o
              match (ej. <code className="text-emerald-400">Juego 1x4 50</code>).
            </p>
          </div>
        )}

        {mensajes.map((m) => {
          const mio = esMio(m.remitente_id, m.remitente_nombre);

          // VISTA DESTACADA: ESTADO DE CARRERA
          if (m.tipo_mensaje === "ESTADO_CARRERA") {
            return (
              <div
                key={m.id}
                className="my-3 mx-auto max-w-lg bg-gradient-to-r from-emerald-950/80 via-[#111b21] to-emerald-950/80 border-2 border-emerald-500/50 rounded-2xl p-3.5 shadow-xl text-center"
              >
                <div className="text-emerald-400 text-xs font-black tracking-wide uppercase flex items-center justify-center gap-1.5 mb-1">
                  <span>🏇</span>
                  <span>AVISO OFICIAL DE PISTA</span>
                  <span>🏇</span>
                </div>
                <p className="text-white text-xs font-semibold whitespace-pre-wrap leading-relaxed">
                  {m.contenido}
                </p>
                <span className="text-[10px] text-gray-400 font-mono mt-1 block">
                  {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            );
          }

          // VISTA PIZARRA DE LIQUIDACIÓN
          if (m.tipo_mensaje === "PIZARRA") {
            return (
              <div
                key={m.id}
                className="my-3 mx-auto max-w-lg bg-[#111b21] border border-amber-500/40 rounded-2xl p-4 shadow-xl"
              >
                <div className="text-amber-400 text-xs font-black uppercase flex items-center gap-2 mb-2">
                  <span>🏁</span>
                  <span>RESULTADOS Y LIQUIDACIÓN</span>
                </div>
                <div className="text-gray-200 text-xs font-mono whitespace-pre-wrap leading-relaxed">
                  {m.contenido}
                </div>
                <span className="text-[10px] text-gray-500 font-mono mt-2 block text-right">
                  {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            );
          }

          // VISTA PROPUESTA DE JUGADA
          const esPropuesta = m.tipo_mensaje === "propuesta_jugada" || m.tipo_mensaje === "PROPUESTA";
          if (esPropuesta) {
            const tiempoVigencia = Number(sala?.tiempo_vigencia_segundos || 120);
            const edadSegundos = (ahora - new Date(m.created_at).getTime()) / 1000;
            const disponible = Number(m.monto_disponible ?? m.monto_original ?? 0);
            const estaVencida =
              edadSegundos > tiempoVigencia ||
              m.estado_propuesta === "cerrada" ||
              m.estado_propuesta === "vencida" ||
              disponible <= 0;
            const activa = m.estado_propuesta === "abierta" && disponible > 0 && esCarreraAbierta && !estaVencida;
            const segundosRestantes = Math.max(0, Math.ceil(tiempoVigencia - edadSegundos));

            const isSwipingEste = swipingId === m.id;
            const transformStyle = isSwipingEste
              ? { transform: `translateX(${swipeOffset}px)`, transition: "transform 0.05s ease-out" }
              : { transition: "transform 0.2s ease" };

            return (
              <div
                key={m.id}
                className="relative group select-none flex items-center"
                onTouchStart={(e) => handleTouchStart(e, m)}
                onTouchMove={(e) => handleTouchMove(e, m)}
                onTouchEnd={() => handleTouchEnd(m)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenuContextual({
                    x: Math.min(e.clientX, window.innerWidth - 200),
                    y: Math.min(e.clientY, window.innerHeight - 240),
                    msg: m,
                  });
                }}
              >
                {/* Indicador elástico de Swipe para responder estilo WhatsApp */}
                {isSwipingEste && swipeOffset > 10 && (
                  <div
                    className="absolute left-2 z-10 w-7 h-7 rounded-full bg-emerald-500/90 text-black flex items-center justify-center text-xs font-bold shadow-lg transition-transform"
                    style={{
                      transform: `scale(${Math.min(1.2, swipeOffset / 35)}) rotate(${Math.min(360, swipeOffset * 4)}deg)`,
                      opacity: Math.min(1, swipeOffset / 30),
                    }}
                  >
                    ↩️
                  </div>
                )}

                <div
                  style={transformStyle}
                  className={`w-full max-w-[85%] sm:max-w-[75%] rounded-2xl p-3 shadow-md relative ${
                    mio
                      ? "ml-auto bg-[#005c4b] border border-emerald-400/30 text-white rounded-tr-xs"
                      : "mr-auto bg-[#202c33] border border-gray-700/60 text-[#e9edef] rounded-tl-xs"
                  }`}
                >
                  {/* Botón flotante desktop hover para citar/responder */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setReplyToPropuesta(m);
                      inputRef.current?.focus();
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity absolute -top-2 right-2 bg-[#202c33] hover:bg-[#2a3942] text-emerald-400 p-1 rounded-full shadow-lg border border-gray-700 text-[10px] z-10 flex items-center justify-center w-6 h-6"
                    title="Responder citando (WhatsApp)"
                  >
                    ↩️
                  </button>

                  <div className="flex items-center justify-between text-[11px] mb-1 font-bold gap-2">
                    <span className={mio ? "text-emerald-200" : "text-emerald-400"}>
                      {mio ? "Tú" : (m.remitente_nombre || "Usuario")} {m.es_operador && "👑 [Operador]"}
                    </span>
                    <div className="flex items-center gap-1.5 text-[10px] text-gray-400 font-mono">
                      {activa && (
                        <span className="text-emerald-400 font-semibold flex items-center gap-0.5">
                          <span>⏱️</span> {segundosRestantes}s
                        </span>
                      )}
                      <span>
                        {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  </div>

                  <div className="bg-black/30 rounded-xl p-2.5 my-1.5 border border-white/10">
                    <div className="font-bold text-sm text-amber-300 font-mono flex items-center justify-between">
                      <span>{m.jugada_estandarizada || m.contenido}</span>
                      <span className="text-emerald-400 font-black">${m.monto_original}</span>
                    </div>
                    {m.monto_disponible < m.monto_original && (
                      <div className="text-[10px] text-gray-300 font-mono mt-1">
                        Remanente disponible:{" "}
                        <span className="text-emerald-400 font-bold">${m.monto_disponible}</span>
                      </div>
                    )}
                    {m.firma_sha256 && (
                      <div className="text-[9px] text-gray-400 font-mono mt-0.5 truncate">
                        Huella: {m.firma_sha256.slice(0, 16)}...
                      </div>
                    )}
                  </div>

                  {/* Estado de Expiración Automática sin interrumpir */}
                  {estaVencida && m.estado_propuesta !== "anulada" && (
                    <div className="flex items-center gap-1 text-[10px] font-bold text-amber-400 bg-amber-950/60 border border-amber-600/40 px-2 py-0.5 rounded-md mt-1">
                      <span>⏰</span>
                      <span>Jugada vencida / cerrada</span>
                    </div>
                  )}

                  {!mio && activa && (
                    <div className="space-y-1.5 mt-2">
                      <button
                        onClick={() => aceptarPropuesta(m.id)}
                        disabled={enviando}
                        className="w-full bg-[#00a884] hover:bg-emerald-400 text-black font-black py-2 px-3 rounded-lg text-xs transition flex items-center justify-center gap-1 shadow-md"
                      >
                        <span>⚡</span>
                        <span>Tomar Jugada Total (${disponible})</span>
                      </button>

                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          onClick={() => {
                            setTomandoParteId(tomandoParteId === m.id ? null : m.id);
                            setMontoParcialInput("");
                          }}
                          className="bg-[#111b21] hover:bg-[#2a3942] border border-gray-600 text-gray-200 font-bold py-1.5 px-2 rounded-md text-[11px] transition flex items-center justify-center gap-1"
                        >
                          <span>✂️</span>
                          <span>Tomar una parte</span>
                        </button>
                        <button
                          onClick={() => {
                            setReplyToPropuesta(m);
                            inputRef.current?.focus();
                          }}
                          className="bg-[#111b21] hover:bg-[#2a3942] border border-emerald-600/50 text-emerald-300 font-bold py-1.5 px-2 rounded-md text-[11px] transition flex items-center justify-center gap-1"
                        >
                          <span>↩️</span>
                          <span>Responder WA</span>
                        </button>
                      </div>

                      {tomandoParteId === m.id && (
                        <div className="p-2 bg-[#111b21] rounded-lg border border-emerald-500/40 space-y-2 mt-1">
                          <div className="text-[10px] text-gray-300 font-semibold flex items-center justify-between">
                            <span>Indica cuánto quieres tomar (Máx: ${disponible}):</span>
                            <button
                              onClick={() => setTomandoParteId(null)}
                              className="text-gray-400 hover:text-white text-xs font-bold"
                            >
                              ✕
                            </button>
                          </div>
                          <div className="flex gap-1.5 flex-wrap">
                            {[10, 20, 50].filter((v) => v < disponible).map((val) => (
                              <button
                                key={val}
                                onClick={() => aceptarPropuesta(m.id, val)}
                                disabled={enviando}
                                className="bg-[#202c33] hover:bg-emerald-600 hover:text-black text-emerald-300 border border-emerald-500/40 px-2 py-0.5 rounded text-xs font-mono font-bold"
                              >
                                Tomar ${val}
                              </button>
                            ))}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              min="1"
                              max={disponible}
                              value={montoParcialInput}
                              onChange={(e) => setMontoParcialInput(e.target.value)}
                              placeholder={`Monto (1 - ${disponible})`}
                              className="flex-1 bg-[#202c33] text-white text-xs px-2.5 py-1.5 rounded border border-gray-700 outline-none focus:border-emerald-400 font-mono"
                            />
                            <button
                              onClick={() => {
                                const n = Number(montoParcialInput);
                                if (!n || n <= 0 || n > disponible) {
                                  alert(`Ingresa un monto válido entre 1 y ${disponible}`);
                                  return;
                                }
                                aceptarPropuesta(m.id, n);
                              }}
                              disabled={enviando || !montoParcialInput}
                              className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-black font-black px-3 py-1.5 rounded text-xs"
                            >
                              ✓ Tomar
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Botón de Retiro Rápido para el autor */}
                  {mio && activa && (
                    <button
                      onClick={() => enviarMensaje("Se fue")}
                      disabled={enviando}
                      className="w-full mt-2 bg-red-950/50 hover:bg-red-900/60 border border-red-600/40 text-red-300 py-1.5 px-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5"
                    >
                      <span>🚫</span>
                      <span>Retirar esta jugada ("Se fue")</span>
                    </button>
                  )}

                  {m.estado_propuesta === "anulada" && (
                    <span className="text-[10px] text-red-400 font-bold block mt-1">🚫 Propuesta Anulada</span>
                  )}
                </div>
              </div>
            );
          }

          // VISTA BURBUJA DE TEXTO ESTÁNDAR / CONCRECIÓN / MENSAJE NORMAL
          const citado = m.reply_to_msg_id ? mensajesMap.get(m.reply_to_msg_id) : null;
          const citadoEsMio = citado ? esMio(citado.remitente_id, citado.remitente_nombre) : false;

          const isSwipingEste = swipingId === m.id;
          const transformStyle = isSwipingEste
            ? { transform: `translateX(${swipeOffset}px)`, transition: "transform 0.05s ease-out" }
            : { transition: "transform 0.2s ease" };

          return (
            <div
              key={m.id}
              className="relative group select-none flex items-center"
              onTouchStart={(e) => handleTouchStart(e, m)}
              onTouchMove={(e) => handleTouchMove(e, m)}
              onTouchEnd={() => handleTouchEnd(m)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenuContextual({
                  x: Math.min(e.clientX, window.innerWidth - 200),
                  y: Math.min(e.clientY, window.innerHeight - 200),
                  msg: m,
                });
              }}
            >
              {/* Indicador elástico de Swipe para responder estilo WhatsApp */}
              {isSwipingEste && swipeOffset > 10 && (
                <div
                  className="absolute left-2 z-10 w-7 h-7 rounded-full bg-emerald-500/90 text-black flex items-center justify-center text-xs font-bold shadow-lg transition-transform"
                  style={{
                    transform: `scale(${Math.min(1.2, swipeOffset / 35)}) rotate(${Math.min(360, swipeOffset * 4)}deg)`,
                    opacity: Math.min(1, swipeOffset / 30),
                  }}
                >
                  ↩️
                </div>
              )}

              <div
                style={transformStyle}
                className={`w-full max-w-[85%] sm:max-w-[70%] rounded-2xl px-3.5 py-2 shadow relative ${
                  mio
                    ? "ml-auto bg-[#005c4b] text-white rounded-tr-xs"
                    : "mr-auto bg-[#202c33] text-[#e9edef] rounded-tl-xs border border-gray-700/40"
                }`}
              >
                {/* Botón flotante desktop hover para citar/responder */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setReplyToPropuesta(m);
                    inputRef.current?.focus();
                  }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity absolute -top-2 right-2 bg-[#202c33] hover:bg-[#2a3942] text-emerald-400 p-1 rounded-full shadow-lg border border-gray-700 text-[10px] z-10 flex items-center justify-center w-6 h-6"
                  title="Responder citando (WhatsApp)"
                >
                  ↩️
                </button>

                <div className="flex items-center justify-between text-[11px] mb-1 font-bold gap-2">
                  <span className={mio ? "text-emerald-200" : "text-emerald-400"}>
                    {mio ? "Tú" : (m.remitente_nombre || "Usuario")} {m.es_operador && "👑 [Operador]"}
                  </span>
                  <span className="text-[9px] text-gray-400 font-mono">
                    {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>

                {/* Caja de cita estilo WhatsApp si cita o responde a otro mensaje */}
                {citado && (
                  <div className="mb-2 p-2 rounded-lg bg-black/35 border-l-4 border-emerald-400 text-[11px] select-text">
                    <div className="font-bold text-emerald-300 text-[10px] flex items-center gap-1">
                      <span>↩️</span>
                      <span>{citadoEsMio ? "Tú" : (citado.remitente_nombre || "Usuario")}</span>
                    </div>
                    <div className="text-gray-300 truncate font-mono text-[11px] mt-0.5">
                      {citado.jugada_estandarizada || citado.contenido}
                    </div>
                  </div>
                )}

                <p className="text-xs break-words leading-relaxed whitespace-pre-wrap">{m.contenido}</p>
              </div>
            </div>
          );
        })}

        {/* Tarjeta de Corrección Pedagógica Privada */}
        {sugerenciaPedagogica && (
          <div className="my-2 p-3.5 bg-[#182229] border border-emerald-500/60 rounded-2xl shadow-xl space-y-2">
            <div className="flex items-center gap-1.5 text-emerald-400 font-bold text-xs">
              <span>🤖</span>
              <span>Corrección Pedagógica (Privado para ti)</span>
            </div>
            <p className="text-xs text-gray-300 whitespace-pre-wrap leading-relaxed font-mono">
              {sugerenciaPedagogica.mensaje}
            </p>
            {sugerenciaPedagogica.sugerencias.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {sugerenciaPedagogica.sugerencias.map((sug, i) => (
                  <button
                    key={i}
                    onClick={() => aplicarSugerencia(sug)}
                    className="bg-[#00a884] hover:bg-emerald-400 text-black font-black text-xs px-3 py-1.5 rounded-lg transition shadow"
                  >
                    👉 {sug}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Barra de Entrada / Envío con Cita y Respuestas Rápidas estilo WhatsApp */}
      <div className="bg-[#202c33] p-3 border-t border-[#2a3942] space-y-2">
        {/* Banner de Citación Activa estilo WhatsApp */}
        {replyToPropuesta && (
          <div className="bg-[#111b21] border-l-4 border-emerald-400 rounded-lg p-2.5 flex items-center justify-between text-xs animate-fadeIn">
            <div className="truncate mr-2">
              <div className="flex items-center gap-1.5 text-emerald-400 font-bold text-[11px]">
                <span>↩️</span>
                <span>
                  Respondiendo a: {replyToPropuesta.remitente_nombre || "Usuario"}
                </span>
                <span className="text-amber-300 font-mono">
                  (Disp: ${replyToPropuesta.monto_disponible || replyToPropuesta.monto_original})
                </span>
              </div>
              <p className="text-gray-300 text-[11px] truncate font-mono mt-0.5">
                {replyToPropuesta.jugada_estandarizada || replyToPropuesta.contenido}
              </p>
            </div>
            <button
              onClick={() => setReplyToPropuesta(null)}
              className="text-gray-400 hover:text-white bg-[#202c33] p-1.5 rounded-full text-xs font-bold"
              title="Cancelar citación"
            >
              ✕
            </button>
          </div>
        )}

        {/* Chips de Respuestas Predefinidas estilo WhatsApp */}
        {replyToPropuesta ? (
          <div className="flex gap-1.5 overflow-x-auto pb-1 text-[11px] text-gray-300">
            {/* Opciones inteligentes según verbo */}
            {(() => {
              const textoProp = (replyToPropuesta.contenido || replyToPropuesta.jugada_estandarizada || "").toLowerCase();
              const esPropJuego = textoProp.includes("juego") || (replyToPropuesta.accion_proponente || "").toUpperCase() === "JUEGA";
              const disp = Number(replyToPropuesta.monto_disponible || replyToPropuesta.monto_original || 0);

              if (esPropJuego) {
                return (
                  <>
                    <button
                      onClick={() => aceptarPropuesta(replyToPropuesta.id)}
                      disabled={enviando}
                      className="bg-emerald-600 hover:bg-emerald-500 text-black font-black px-2.5 py-1 rounded text-xs shadow font-mono"
                    >
                      ⚡ Tomar Total (${disp})
                    </button>
                    {[10, 20, 50].filter(v => v < disp).map(val => (
                      <button
                        key={val}
                        onClick={() => enviarMensaje(`Consigo ${val}`)}
                        className="bg-[#111b21] hover:bg-gray-800 px-2 py-1 rounded border border-emerald-600/50 font-mono text-emerald-300"
                      >
                        + Consigo {val}
                      </button>
                    ))}
                    <button
                      onClick={() => enviarMensaje("Doy")}
                      className="bg-[#111b21] hover:bg-gray-800 px-2 py-1 rounded border border-gray-700 font-mono"
                    >
                      + Doy
                    </button>
                    <button
                      onClick={() => enviarMensaje("J")}
                      className="bg-[#111b21] hover:bg-gray-800 px-2 py-1 rounded border border-gray-700 font-mono"
                    >
                      + J
                    </button>
                    <button
                      onClick={() => enviarMensaje("Ponte")}
                      className="bg-[#111b21] hover:bg-gray-800 px-2 py-1 rounded border border-gray-700 font-mono"
                    >
                      + Ponte
                    </button>
                    <button
                      onClick={() => enviarMensaje("Jugaste")}
                      className="bg-[#111b21] hover:bg-gray-800 px-2 py-1 rounded border border-gray-700 font-mono"
                    >
                      + Jugaste
                    </button>
                  </>
                );
              } else {
                return (
                  <>
                    <button
                      onClick={() => aceptarPropuesta(replyToPropuesta.id)}
                      disabled={enviando}
                      className="bg-emerald-600 hover:bg-emerald-500 text-black font-black px-2.5 py-1 rounded text-xs shadow font-mono"
                    >
                      ⚡ Tomar Total (${disp})
                    </button>
                    {[10, 20, 50].filter(v => v < disp).map(val => (
                      <button
                        key={val}
                        onClick={() => enviarMensaje(`Juego ${val}`)}
                        className="bg-[#111b21] hover:bg-gray-800 px-2 py-1 rounded border border-emerald-600/50 font-mono text-emerald-300"
                      >
                        + Juego {val}
                      </button>
                    ))}
                    <button
                      onClick={() => enviarMensaje("Voy")}
                      className="bg-[#111b21] hover:bg-gray-800 px-2 py-1 rounded border border-gray-700 font-mono"
                    >
                      + Voy
                    </button>
                    <button
                      onClick={() => enviarMensaje("J")}
                      className="bg-[#111b21] hover:bg-gray-800 px-2 py-1 rounded border border-gray-700 font-mono"
                    >
                      + J
                    </button>
                    <button
                      onClick={() => enviarMensaje("Ponte")}
                      className="bg-[#111b21] hover:bg-gray-800 px-2 py-1 rounded border border-gray-700 font-mono"
                    >
                      + Ponte
                    </button>
                    <button
                      onClick={() => enviarMensaje("Jugue")}
                      className="bg-[#111b21] hover:bg-gray-800 px-2 py-1 rounded border border-gray-700 font-mono"
                    >
                      + Jugue
                    </button>
                  </>
                );
              }
            })()}
          </div>
        ) : (
          /* Atajos rápidos generales para proponer */
          <div className="flex gap-1.5 overflow-x-auto pb-1 text-[11px] text-gray-300">
            <button
              onClick={() => setTextoInput("Juego 1P ")}
              className="bg-[#111b21] hover:bg-gray-800 px-2 py-0.5 rounded border border-gray-700 font-mono"
            >
              + Juego 1P
            </button>
            <button
              onClick={() => setTextoInput("Consigo 1P ")}
              className="bg-[#111b21] hover:bg-gray-800 px-2 py-0.5 rounded border border-gray-700 font-mono"
            >
              + Consigo 1P
            </button>
            <button
              onClick={() => setTextoInput("Juego 1 x 4 50")}
              className="bg-[#111b21] hover:bg-gray-800 px-2 py-0.5 rounded border border-gray-700 font-mono"
            >
              + Match (x)
            </button>
            <button
              onClick={() => setTextoInput("Doy ")}
              className="bg-[#111b21] hover:bg-gray-800 px-2 py-0.5 rounded border border-gray-700 font-mono"
            >
              + Doy
            </button>
            <button
              onClick={() => enviarMensaje("Se fue")}
              disabled={enviando}
              className="bg-red-950/70 hover:bg-red-900/80 text-red-300 border border-red-700/50 px-2 py-0.5 rounded font-mono font-bold text-[11px] flex items-center gap-1 transition"
              title="Cierra todas tus jugadas abiertas no concretadas"
            >
              <span>🚫</span> Se fue (Retirar)
            </button>
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            enviarMensaje();
          }}
          className="flex items-center gap-2"
        >
          <input
            ref={inputRef}
            type="text"
            value={textoInput}
            onChange={(e) => setTextoInput(e.target.value)}
            placeholder={
              replyToPropuesta
                ? `Responder a ${replyToPropuesta.remitente_nombre || "propuesta"} (ej. Consigo 20, Ponte, J)...`
                : esCarreraAbierta
                ? "Escribe tu jugada (ej. Juego 1p del 5 con 100)..."
                : "Carrera cerrada (solo mensajes de consulta)..."
            }
            className="flex-1 bg-[#2a3942] text-white placeholder-gray-400 text-xs rounded-xl px-4 py-2.5 outline-none focus:ring-1 focus:ring-emerald-500 font-medium"
          />
          <button
            type="submit"
            disabled={enviando || !textoInput.trim()}
            className="bg-[#00a884] hover:bg-emerald-400 disabled:opacity-40 text-black font-black p-2.5 rounded-xl transition flex items-center justify-center text-sm shadow"
          >
            <span>➤</span>
          </button>
        </form>
      </div>

      {/* Menú Contextual Flotante estilo WhatsApp */}
      {menuContextual && (
        <div
          className="fixed z-50 bg-[#233138] border border-[#2a3942] rounded-xl shadow-2xl py-1.5 min-w-[190px] text-xs font-semibold text-[#e9edef] select-none"
          style={{ left: menuContextual.x, top: menuContextual.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              setReplyToPropuesta(menuContextual.msg);
              setMenuContextual(null);
              inputRef.current?.focus();
            }}
            className="w-full text-left px-3.5 py-2 hover:bg-[#182229] flex items-center gap-2 transition"
          >
            <span>↩️</span>
            <span>Responder / Citar</span>
          </button>

          {(menuContextual.msg.tipo_mensaje === "propuesta_jugada" ||
            menuContextual.msg.tipo_mensaje === "PROPUESTA") && (
            <>
              {!esMio(menuContextual.msg.remitente_id, menuContextual.msg.remitente_nombre) && (
                <>
                  <button
                    onClick={() => {
                      aceptarPropuesta(menuContextual.msg.id);
                      setMenuContextual(null);
                    }}
                    className="w-full text-left px-3.5 py-2 hover:bg-[#182229] text-emerald-400 flex items-center gap-2 transition"
                  >
                    <span>⚡</span>
                    <span>Tomar Jugada Total</span>
                  </button>
                  <button
                    onClick={() => {
                      setTomandoParteId(menuContextual.msg.id);
                      setMenuContextual(null);
                    }}
                    className="w-full text-left px-3.5 py-2 hover:bg-[#182229] text-amber-300 flex items-center gap-2 transition"
                  >
                    <span>✂️</span>
                    <span>Tomar una parte</span>
                  </button>
                </>
              )}

              {esMio(menuContextual.msg.remitente_id, menuContextual.msg.remitente_nombre) && (
                <button
                  onClick={() => {
                    enviarMensaje("Se fue");
                    setMenuContextual(null);
                  }}
                  className="w-full text-left px-3.5 py-2 hover:bg-[#182229] text-red-400 flex items-center gap-2 transition"
                >
                  <span>🚫</span>
                  <span>Retirar mis jugadas ("Se fue")</span>
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
