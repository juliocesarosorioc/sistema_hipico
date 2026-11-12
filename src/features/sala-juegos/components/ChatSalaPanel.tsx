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
  const [sugerenciaPedagogica, setSugerenciaPedagogica] = useState<{
    mensaje: string;
    sugerencias: string[];
    jugadaEstandarizada?: string;
  } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
      const res = await salaApi.enviarMensaje({
        salaId: sala.id,
        grupoId,
        texto,
      });

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
          await cargarMensajes();
          onActualizarSaldo?.();
        }
      } else {
        alert(res.error || "No se pudo enviar el mensaje");
      }
    } catch (err: any) {
      alert("Error: " + (err?.message || err));
    } finally {
      setEnviando(false);
    }
  };

  const aceptarPropuesta = async (propuestaId: string) => {
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
        texto: "Acepto",
        propuestaId,
      });

      if (res.ok) {
        await cargarMensajes();
        onActualizarSaldo?.();
      } else {
        alert(res.error || "No se pudo concretar el cruce");
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

  const esMio = (remitenteId?: string, remitenteNombre?: string) =>
    (Boolean(remitenteId) && remitenteId === identidad?.usuarioId) ||
    (Boolean(remitenteNombre) && Boolean(identidad?.nombre) && remitenteNombre === identidad?.nombre);

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
            const disponible = Number(m.monto_disponible || m.monto_original || 0);
            const activa = m.estado_propuesta === "abierta" && disponible > 0 && esCarreraAbierta;

            return (
              <div
                key={m.id}
                className={`max-w-[85%] sm:max-w-[75%] rounded-2xl p-3 shadow-md ${
                  mio
                    ? "ml-auto bg-[#005c4b] border border-emerald-400/30 text-white"
                    : "mr-auto bg-[#202c33] border border-gray-700/60 text-[#e9edef]"
                }`}
              >
                <div className="flex items-center justify-between text-[11px] mb-1 font-bold">
                  <span className={mio ? "text-emerald-200" : "text-emerald-400"}>
                    {m.remitente_nombre} {mio && "(Tú)"}
                  </span>
                  <span className="text-[10px] text-gray-400 font-mono">
                    {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
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

                {!mio && activa && (
                  <button
                    onClick={() => aceptarPropuesta(m.id)}
                    disabled={enviando}
                    className="w-full mt-1.5 bg-[#00a884] hover:bg-emerald-400 text-black font-black py-1.5 px-3 rounded-lg text-xs transition flex items-center justify-center gap-1 shadow-md"
                  >
                    <span>⚡</span>
                    <span>Cerrar Jugada (${disponible})</span>
                  </button>
                )}

                {m.estado_propuesta === "anulada" && (
                  <span className="text-[10px] text-red-400 font-bold block mt-1">🚫 Propuesta Anulada</span>
                )}
              </div>
            );
          }

          // VISTA BURBUJA DE TEXTO ESTÁNDAR
          return (
            <div
              key={m.id}
              className={`max-w-[85%] sm:max-w-[70%] rounded-2xl px-3.5 py-2 shadow ${
                mio
                  ? "ml-auto bg-[#005c4b] text-white rounded-tr-none"
                  : "mr-auto bg-[#202c33] text-[#e9edef] rounded-tl-none border border-gray-700/40"
              }`}
            >
              {!mio && (
                <span className="text-[11px] font-bold text-emerald-400 block mb-0.5">
                  {m.remitente_nombre} {m.es_operador && "👑 [Operador]"}
                </span>
              )}
              <p className="text-xs break-words leading-relaxed">{m.contenido}</p>
              <span className="text-[9px] text-gray-400 font-mono block text-right mt-0.5">
                {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
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

      {/* Barra de Entrada / Envío */}
      <div className="bg-[#202c33] p-3 border-t border-[#2a3942] space-y-2">
        {/* Atajos rápidos */}
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
        </div>

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
              esCarreraAbierta
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
    </div>
  );
}
