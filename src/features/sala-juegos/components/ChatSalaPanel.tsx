"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { salaApi } from "../lib/sala-api";
import { supabase } from "@/core/supabase";
import {
  formatearMontoRegional,
  esGrupoBolivares,
  prefijoMonedaGrupo,
} from "@/shared/lib/dinero";

export type ClaveFuenteSala = "whatsapp" | "inter" | "roboto" | "sf" | "tabular";
export type TemaSala = "claro" | "oscuro";

export const FAMILIAS_FUENTE_SALA: Record<ClaveFuenteSala, { nombre: string; css: string }> = {
  whatsapp: {
    nombre: "WhatsApp Original (Predeterminada)",
    css: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
  inter: {
    nombre: "Inter Hípica Nítida",
    css: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
  },
  roboto: {
    nombre: "Roboto Android Nativa",
    css: 'Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  sf: {
    nombre: "Apple SF Pro (iPhone / Mac)",
    css: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif',
  },
  tabular: {
    nombre: "Gaceta Tabular (Monospace)",
    css: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  },
};

const COLORES_NOMBRE_REMITENTE = [
  "#008069",
  "#1b6ca8",
  "#b45309",
  "#7c3aed",
  "#be123c",
  "#0f766e",
  "#4338ca",
  "#9a3412",
];

function colorNombreRemitente(nombre?: string): string {
  const s = String(nombre || "Usuario");
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = s.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLORES_NOMBRE_REMITENTE[Math.abs(hash) % COLORES_NOMBRE_REMITENTE.length];
}

/**
 * Regla Oficial: Cuando se concretan jugadas NUNCA se dice CRUCE, se dice "Jugaron".
 */
function normalizarTerminologiaJugaron(texto?: string | null): string {
  if (!texto) return "";
  return String(texto)
    .replace(/¡?CRUCE\s+CONFIRMADO!?/gi, "*Jugaron*")
    .replace(/¡?CRUCE\s+REGISTRADO!?/gi, "*Jugaron*")
    .replace(/¡?AQU[IÍ]\s+JUGARON!?/gi, "*Jugaron*")
    .replace(/\bCRUCE\b/gi, "Jugaron");
}

interface PropsChatSalaPanel {
  sala: any;
  grupoId: string;
  grupoNombre: string;
  identidad: any;
  tamanoLetra: number;
  fuenteId?: ClaveFuenteSala;
  tema?: TemaSala;
  moneda?: string;
  onActualizarSaldo?: () => void;
  onAbrirOperador?: () => void;
  onSalirPlataforma?: () => void;
}

export function ChatSalaPanel({
  sala,
  grupoId,
  grupoNombre,
  identidad,
  tamanoLetra,
  fuenteId = "whatsapp",
  tema = "claro",
  moneda = "USD",
  onActualizarSaldo,
  onAbrirOperador,
  onSalirPlataforma,
}: PropsChatSalaPanel) {
  const esBs = esGrupoBolivares(moneda);
  const prefijo = prefijoMonedaGrupo(moneda);

  const [mensajes, setMensajes] = useState<any[]>([]);
  const [textoInput, setTextoInput] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [replyToPropuesta, setReplyToPropuesta] = useState<any | null>(null);
  const [tomandoParteId, setTomandoParteId] = useState<string | null>(null);
  const [montoParcialInput, setMontoParcialInput] = useState<string>("");
  const [filtroFeed, setFiltroFeed] = useState<"todos" | "abiertas" | "jugaron" | "mias">("todos");
  const [tecladoRapidoAbierto, setTecladoRapidoAbierto] = useState<boolean>(false);
  const [accionRapida, setAccionRapida] = useState<"Juego" | "Consigo" | "Doy">("Juego");
  const [puestoRapido, setPuestoRapido] = useState<string>("1P");
  const [ejemplarRapido, setEjemplarRapido] = useState<string>("1");
  const [montoRapido, setMontoRapido] = useState<string>(esBs ? "5k" : "20");

  useEffect(() => {
    if (esBs) {
      setMontoRapido("5k");
    } else {
      setMontoRapido("20");
    }
  }, [esBs]);

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

  // Control táctil Swipe-to-reply (celular Android/iPhone y PC)
  const [swipingId, setSwipingId] = useState<string | null>(null);
  const [swipeOffset, setSwipeOffset] = useState<number>(0);
  const touchStartXRef = useRef<number>(0);
  const touchStartYRef = useRef<number>(0);
  const isSwipingRef = useRef<boolean>(false);

  // Timer tick en vivo para actualizar expiración de vigencia cada 2s
  const [ahora, setAhora] = useState<number>(Date.now());
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 2000);
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

  const handleTouchStart = (e: React.TouchEvent, _msg: any) => {
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
      const capped = Math.min(76, Math.max(0, deltaX));
      setSwipeOffset(capped);
    }
  };

  const handleTouchEnd = (msg: any) => {
    if (isSwipingRef.current && swipeOffset >= 38) {
      if (typeof window !== "undefined" && (window as any).navigator?.vibrate) {
        try {
          (window as any).navigator.vibrate(18);
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
    const res = await salaApi.getMensajes(sala.id, 80);
    if (res.ok && res.data?.mensajes) {
      setMensajes(res.data.mensajes);
    }
  };

  useEffect(() => {
    cargarMensajes();
    const interval = setInterval(cargarMensajes, 2500);

    let canal: any = null;
    if (supabase && sala?.id) {
      try {
        canal = supabase
          .channel(`sala-${sala.id}`)
          .on("broadcast", { event: "nuevo_mensaje" }, () => cargarMensajes())
          .on("broadcast", { event: "carrera_abierta" }, () => cargarMensajes())
          .on("broadcast", { event: "carrera_cerrada" }, () => cargarMensajes())
          .on("broadcast", { event: "carrera_liquidada" }, () => {
            cargarMensajes();
            onActualizarSaldo?.();
          })
          .on("broadcast", { event: "carrera_reversada" }, () => {
            cargarMensajes();
            onActualizarSaldo?.();
          })
          .on("broadcast", { event: "carrera_anulada" }, () => {
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
            () => cargarMensajes()
          )
          .subscribe();
      } catch {
        // Realtime fallback
      }
    }

    return () => {
      clearInterval(interval);
      if (canal && supabase) {
        try {
          supabase.removeChannel(canal);
        } catch {}
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
          setTecladoRapidoAbierto(false);
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
        texto: textoPersonalizado || (monto ? `Tomar ${prefijo}${formatearMontoRegional(monto)}` : "Tomar jugada total"),
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

  /**
   * Cierra directamente cada jugada abierta del jugador (todas o una individual)
   * SIN enviar ningún mensaje al chat para no saturar el grupo.
   */
  const cerrarPropuestasDirectamente = async (propuestaIdEspecifica?: string) => {
    if (!sala?.id) return;
    // Actualización optimista inmediata de cada propuesta abierta
    setMensajes((prev) =>
      prev.map((m) => {
        const esProp = m.tipo_mensaje === "propuesta_jugada" || m.tipo_mensaje === "PROPUESTA";
        if (!esProp) return m;
        if (!esMio(m.remitente_id, m.remitente_nombre)) return m;
        if (propuestaIdEspecifica && m.id !== propuestaIdEspecifica) return m;
        if (m.estado_propuesta === "abierta" && Number(m.monto_disponible ?? 0) > 0) {
          return { ...m, estado_propuesta: "cerrada", monto_disponible: 0 };
        }
        return m;
      })
    );

    try {
      await salaApi.enviarMensaje({
        salaId: sala.id,
        grupoId,
        texto: "Se fue",
        ...(propuestaIdEspecifica ? { cerrarPropuestaId: propuestaIdEspecifica } : {}),
      } as any);
      await cargarMensajes();
      onActualizarSaldo?.();
    } catch {
      await cargarMensajes();
    }
  };

  const miId = identidad?.usuarioId || identidad?.clienteRow?.id;
  const miNombre = identidad?.nombre || identidad?.clienteRow?.nombre;

  const esMio = (remitenteId?: string, remitenteNombre?: string) => {
    if (miId && remitenteId && String(remitenteId).toLowerCase() === String(miId).toLowerCase()) return true;
    if (miNombre && remitenteNombre && remitenteNombre.trim().toLowerCase() === miNombre.trim().toLowerCase()) return true;
    return false;
  };

  const mensajesMap = useMemo(() => {
    const map = new Map<string, any>();
    for (const m of mensajes) {
      if (m?.id) map.set(m.id, m);
    }
    return map;
  }, [mensajes]);

  const esCarreraAbierta = sala?.estado_carrera === "abierta";
  const esClaro = tema === "claro";
  const fontFamilyCss = FAMILIAS_FUENTE_SALA[fuenteId]?.css || FAMILIAS_FUENTE_SALA.whatsapp.css;

  const mensajesFiltrados = useMemo(() => {
    if (filtroFeed === "todos") return mensajes;
    const tiempoVigencia = Number(sala?.tiempo_vigencia_segundos || 120);
    return mensajes.filter((m) => {
      if (filtroFeed === "mias") {
        return esMio(m.remitente_id, m.remitente_nombre);
      }
      if (filtroFeed === "jugaron") {
        return m.tipo_mensaje === "CONCRECION";
      }
      if (filtroFeed === "abiertas") {
        const esProp = m.tipo_mensaje === "propuesta_jugada" || m.tipo_mensaje === "PROPUESTA";
        if (!esProp) return false;
        const disp = Number(m.monto_disponible ?? m.monto_original ?? 0);
        const edad = (ahora - new Date(m.created_at).getTime()) / 1000;
        return m.estado_propuesta === "abierta" && disp > 0 && edad <= tiempoVigencia;
      }
      return true;
    });
  }, [mensajes, filtroFeed, ahora, sala?.tiempo_vigencia_segundos]);

  return (
    <div
      style={{ fontFamily: fontFamilyCss }}
      className={`flex flex-col h-full overflow-hidden select-none border-x ${
        esClaro ? "bg-[#efeae2] border-[#d1d7db] text-[#111b21]" : "bg-[#0b141a] border-[#202c33] text-[#e9edef]"
      }`}
    >
      {/* Sub-Cabecera Compacta de la Sala + Filtros Rápidos */}
      <div
        className={`px-2 py-1 flex flex-wrap items-center justify-between gap-1 border-b ${
          esClaro ? "bg-[#f0f2f5] border-[#d1d7db]" : "bg-[#202c33] border-[#2a3942]"
        }`}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <div
            className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black shrink-0 ${
              esClaro
                ? "bg-[#008069] text-white"
                : "bg-emerald-700/40 border border-emerald-500/40 text-emerald-400"
            }`}
          >
            🏇
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              <span className={`text-xs font-extrabold truncate ${esClaro ? "text-[#111b21]" : "text-white"}`}>
                {sala?.hipodromo_activo || "HIPÓDROMO"} · C{sala?.numero_carrera_activa || 1}
              </span>
              <span
                className={`text-[9px] px-1.5 py-0.2 rounded-full font-black uppercase ${
                  esCarreraAbierta
                    ? esClaro
                      ? "bg-[#d9fdd3] text-[#008069] border border-[#008069]/30"
                      : "bg-emerald-950 text-emerald-400 border border-emerald-600/50"
                    : esClaro
                      ? "bg-amber-100 text-amber-800 border border-amber-300"
                      : "bg-amber-950 text-amber-400 border border-amber-600/50"
                }`}
              >
                ● {sala?.estado_carrera || "CERRADA"}
              </span>
              <span className={`text-[10px] hidden sm:inline ${esClaro ? "text-[#667781]" : "text-gray-400"}`}>
                ⏱️ Vigencia: {Number(sala?.tiempo_vigencia_segundos || 120)}s
              </span>
            </div>
          </div>
        </div>

        {/* Filtros de Agilidad estilo WhatsApp + Botón Operador / Salir */}
        <div className="flex items-center gap-1 overflow-x-auto">
          {(
            [
              { id: "todos", label: "Todos" },
              { id: "abiertas", label: "🟢 Abiertas" },
              { id: "jugaron", label: "🤝 Jugaron" },
              { id: "mias", label: "🙋‍♂️ Mías" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFiltroFeed(tab.id)}
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition whitespace-nowrap ${
                filtroFeed === tab.id
                  ? esClaro
                    ? "bg-[#008069] text-white shadow-xs"
                    : "bg-[#00a884] text-black shadow-xs"
                  : esClaro
                    ? "bg-white text-[#54656f] border border-[#d1d7db] hover:bg-gray-50"
                    : "bg-[#111b21] text-gray-300 border border-gray-700 hover:bg-gray-800"
              }`}
            >
              {tab.label}
            </button>
          ))}

          {identidad?.esOperador && (
            <button
              onClick={onAbrirOperador}
              className="bg-[#008069] hover:bg-[#017561] text-white font-bold text-[10px] px-2 py-0.5 rounded-full transition flex items-center gap-0.5 shrink-0"
            >
              <span>🛠️</span>
              <span>Operador</span>
            </button>
          )}
        </div>
      </div>

      {/* Feed de Mensajes con Márgenes Mínimos y Densidad WhatsApp */}
      <div
        ref={scrollRef}
        className={`flex-1 overflow-y-auto px-1.5 sm:px-2.5 py-1 space-y-1 ${
          esClaro ? "bg-[#efeae2]" : "bg-[#0b141a]"
        }`}
        style={{
          fontSize: `${tamanoLetra}px`,
          backgroundImage: esClaro
            ? "radial-gradient(rgba(0, 128, 105, 0.05) 1px, transparent 0)"
            : "radial-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 0)",
          backgroundSize: "18px 18px",
        }}
      >
        {mensajesFiltrados.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center p-4 space-y-1.5">
            <span className="text-2xl">🏇</span>
            <p className={`font-bold text-xs ${esClaro ? "text-[#111b21]" : "text-gray-300"}`}>
              {filtroFeed === "todos" ? "Sala Hípica lista para tus jugadas." : "No hay mensajes en este filtro."}
            </p>
            <p className={`text-[11px] max-w-xs ${esClaro ? "text-[#667781]" : "text-gray-400"}`}>
              Desliza cualquier jugada a la derecha para responder como en WhatsApp o escribe ej.{" "}
              <code className="font-bold text-[#008069]">Juego 1p del 5 con 100</code>.
            </p>
          </div>
        )}

        {mensajesFiltrados.map((m) => {
          const mio = esMio(m.remitente_id, m.remitente_nombre);
          const contenidoNormalizado = normalizarTerminologiaJugaron(m.contenido);

          // 1. AVISO OFICIAL DE ESTADO DE CARRERA
          if (m.tipo_mensaje === "ESTADO_CARRERA") {
            return (
              <div
                key={m.id}
                className={`my-1 mx-auto max-w-md rounded-xl px-3 py-1.5 shadow-xs text-center border ${
                  esClaro
                    ? "bg-[#fff8e6] border-amber-300 text-[#111b21]"
                    : "bg-[#182229] border-emerald-500/40 text-white"
                }`}
              >
                <div className="text-[#008069] text-[10px] font-black tracking-wide uppercase flex items-center justify-center gap-1">
                  <span>🏇</span>
                  <span>AVISO OFICIAL DE PISTA</span>
                </div>
                <p className="text-[12px] font-semibold whitespace-pre-wrap leading-snug">
                  {contenidoNormalizado}
                </p>
                <span className={`text-[9px] font-mono block ${esClaro ? "text-[#667781]" : "text-gray-400"}`}>
                  {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            );
          }

          // 2. PIZARRA DE LIQUIDACIÓN
          if (m.tipo_mensaje === "PIZARRA") {
            return (
              <div
                key={m.id}
                className={`my-1 mx-auto max-w-md rounded-xl px-3 py-2 shadow-sm border ${
                  esClaro
                    ? "bg-white border-[#008069]/40 text-[#111b21]"
                    : "bg-[#111b21] border-amber-500/40 text-gray-100"
                }`}
              >
                <div className="text-[#008069] text-[11px] font-black uppercase flex items-center gap-1.5 mb-1">
                  <span>🏁</span>
                  <span>RESULTADOS Y LIQUIDACIÓN OFICIAL</span>
                </div>
                <div className="text-[12px] font-mono whitespace-pre-wrap leading-snug">
                  {contenidoNormalizado}
                </div>
                <span className={`text-[9px] font-mono mt-1 block text-right ${esClaro ? "text-[#667781]" : "text-gray-400"}`}>
                  {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            );
          }

          // 3. PROPUESTA DE JUGADA (BURBUJA INTERACTIVA WHATSAPP)
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
              ? { transform: `translateX(${swipeOffset}px)`, transition: "transform 0.04s ease-out" }
              : { transition: "transform 0.18s ease" };

            return (
              <div
                key={m.id}
                className="relative group select-none flex items-center"
                onTouchStart={(e) => handleTouchStart(e, m)}
                onTouchMove={(e) => handleTouchMove(e, m)}
                onTouchEnd={() => handleTouchEnd(m)}
                onDoubleClick={() => {
                  setReplyToPropuesta(m);
                  inputRef.current?.focus();
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenuContextual({
                    x: Math.min(e.clientX, window.innerWidth - 200),
                    y: Math.min(e.clientY, window.innerHeight - 240),
                    msg: m,
                  });
                }}
              >
                {isSwipingEste && swipeOffset > 10 && (
                  <div
                    className="absolute left-1.5 z-10 w-6 h-6 rounded-full bg-[#008069] text-white flex items-center justify-center text-xs font-bold shadow"
                    style={{
                      transform: `scale(${Math.min(1.15, swipeOffset / 35)})`,
                      opacity: Math.min(1, swipeOffset / 28),
                    }}
                  >
                    ↩️
                  </div>
                )}

                <div
                  style={transformStyle}
                  className={`w-full max-w-[90%] sm:max-w-[76%] rounded-lg px-2.5 py-1.5 relative ${
                    mio
                      ? esClaro
                        ? "ml-auto bg-[#d9fdd3] text-[#111b21] rounded-tr-none shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]"
                        : "ml-auto bg-[#005c4b] text-white rounded-tr-none shadow"
                      : esClaro
                        ? "mr-auto bg-white text-[#111b21] rounded-tl-none shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]"
                        : "mr-auto bg-[#202c33] text-[#e9edef] rounded-tl-none shadow"
                  }`}
                >
                  {/* Botón rápido citar en hover */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setReplyToPropuesta(m);
                      inputRef.current?.focus();
                    }}
                    className={`opacity-0 group-hover:opacity-100 transition-opacity absolute top-1 right-1 px-1.5 py-0.5 rounded text-[10px] z-10 shadow-xs ${
                      esClaro
                        ? "bg-white/90 text-[#008069] border border-gray-200"
                        : "bg-[#202c33] text-emerald-400 border border-gray-700"
                    }`}
                    title="Responder citando (WhatsApp)"
                  >
                    ↩️
                  </button>

                  {/* Cabecera compacta de remitente y vigencia */}
                  <div className="flex items-center justify-between gap-2 leading-tight mb-0.5">
                    <span
                      style={{ color: mio ? (esClaro ? "#008069" : "#a7f3d0") : colorNombreRemitente(m.remitente_nombre) }}
                      className="font-bold text-[11px] truncate"
                    >
                      {mio ? "Tú" : m.remitente_nombre || "Jugador"} {m.es_operador && "👑"}
                    </span>
                    <div className="flex items-center gap-1 text-[10px] font-mono shrink-0">
                      {activa && (
                        <span
                          className={`font-bold px-1 rounded ${
                            esClaro ? "bg-[#008069]/10 text-[#008069]" : "text-emerald-400"
                          }`}
                        >
                          ⏱️{segundosRestantes}s
                        </span>
                      )}
                      <span className={esClaro ? "text-[#667781]" : "text-gray-400"}>
                        {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      {mio && <span className="text-[#53bdeb] font-bold text-[10px]">✓✓</span>}
                    </div>
                  </div>

                  {/* Tarjeta interna de la jugada */}
                  <div
                    className={`rounded-md px-2 py-1 my-0.5 border ${
                      esClaro
                        ? "bg-black/[0.04] border-black/10"
                        : "bg-black/30 border-white/10"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 font-bold">
                      <span className={esClaro ? "text-[#111b21]" : "text-amber-300"}>
                        🏇 {m.jugada_estandarizada || contenidoNormalizado}
                      </span>
                      <span
                        className={`font-black font-mono shrink-0 ${
                          esClaro ? "text-[#008069]" : "text-emerald-400"
                        }`}
                      >
                        {formatearMontoRegional(m.monto_original)}
                      </span>
                    </div>
                    {m.monto_disponible < m.monto_original && m.monto_disponible > 0 && (
                      <div className="text-[10px] font-mono mt-0.5 flex items-center justify-between">
                        <span className={esClaro ? "text-[#54656f]" : "text-gray-300"}>Disponible:</span>
                        <span className="font-bold text-[#008069]">
                          {formatearMontoRegional(m.monto_disponible)} de {formatearMontoRegional(m.monto_original)}
                        </span>
                      </div>
                    )}

                    {/* Desglose en vivo de quiénes van jugando en esta propuesta ("Eddie jugó 43,50") */}
                    {Array.isArray(m.desglose_jugaron) && m.desglose_jugaron.length > 0 && (
                      <div
                        className={`mt-1 pt-1 border-t text-[11px] font-mono space-y-0.5 ${
                          esClaro ? "border-black/10 text-[#111b21]" : "border-white/10 text-emerald-200"
                        }`}
                      >
                        <div className="font-extrabold text-[#008069] flex items-center justify-between">
                          <span>
                            🤝 Van jugando por{" "}
                            {formatearMontoRegional(
                              m.monto_jugado_total ??
                                m.desglose_jugaron.reduce((a: number, b: any) => a + Number(b.monto || 0), 0)
                            )}
                          </span>
                        </div>
                        {m.desglose_jugaron.map((item: any, idx: number) => (
                          <div key={idx} className="flex items-center justify-between text-[10px] pl-1">
                            <span>
                              • <strong>{item.jugador}</strong> jugó {formatearMontoRegional(item.monto)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Vigencia expirada o cerrada sin interrumpir el chat */}
                  {estaVencida && m.estado_propuesta !== "anulada" && (
                    <div
                      className={`flex items-center justify-between text-[10px] font-bold px-2 py-0.5 rounded mt-0.5 ${
                        disponible <= 0 && Number(m.monto_jugado_total || 0) > 0
                          ? esClaro
                            ? "bg-[#e7fce3] text-[#008069]"
                            : "bg-emerald-950/60 text-emerald-300"
                          : esClaro
                            ? "bg-amber-50 text-amber-800 border border-amber-200"
                            : "bg-amber-950/60 text-amber-400 border border-amber-600/40"
                      }`}
                    >
                      <span>
                        {disponible <= 0 && Number(m.monto_jugado_total || 0) >= Number(m.monto_original || 0)
                          ? `🤝 Van jugando por ${formatearMontoRegional(m.monto_jugado_total || m.monto_original)} (100%)`
                          : m.estado_propuesta === "cerrada" && disponible <= 0
                            ? "🚫 Se fue (Jugada cerrada)"
                            : "⏰ Jugada cerrada por tiempo"}
                      </span>
                    </div>
                  )}

                  {/* Botones de Acción Rápida si está activa y es de otro jugador */}
                  {!mio && activa && (
                    <div className="space-y-1 mt-1">
                      <div className="grid grid-cols-3 gap-1">
                        <button
                          onClick={() => aceptarPropuesta(m.id)}
                          disabled={enviando}
                          className="col-span-1 bg-[#008069] hover:bg-[#017561] text-white font-black py-1 px-1.5 rounded text-[11px] transition flex items-center justify-center gap-0.5 shadow-xs"
                        >
                          <span>⚡</span>
                          <span>Total ({formatearMontoRegional(disponible)})</span>
                        </button>
                        <button
                          onClick={() => {
                            setTomandoParteId(tomandoParteId === m.id ? null : m.id);
                            setMontoParcialInput("");
                          }}
                          className={`py-1 px-1.5 rounded text-[11px] font-bold border transition flex items-center justify-center gap-0.5 ${
                            esClaro
                              ? "bg-white hover:bg-gray-50 border-gray-300 text-[#111b21]"
                              : "bg-[#111b21] hover:bg-[#2a3942] border-gray-600 text-gray-200"
                          }`}
                        >
                          <span>✂️</span>
                          <span>Parte</span>
                        </button>
                        <button
                          onClick={() => {
                            setReplyToPropuesta(m);
                            inputRef.current?.focus();
                          }}
                          className={`py-1 px-1.5 rounded text-[11px] font-bold border transition flex items-center justify-center gap-0.5 ${
                            esClaro
                              ? "bg-white hover:bg-gray-50 border-[#008069]/40 text-[#008069]"
                              : "bg-[#111b21] hover:bg-[#2a3942] border-emerald-600/50 text-emerald-300"
                          }`}
                        >
                          <span>↩️</span>
                          <span>Responder</span>
                        </button>
                      </div>

                      {tomandoParteId === m.id && (
                        <div
                          className={`p-1.5 rounded-md border space-y-1 ${
                            esClaro
                              ? "bg-gray-50 border-[#008069]/40"
                              : "bg-[#111b21] border-emerald-500/40"
                          }`}
                        >
                          <div className="flex items-center justify-between text-[10px] font-semibold">
                            <span>¿Cuánto tomas? (Máx: {formatearMontoRegional(disponible)})</span>
                            <button onClick={() => setTomandoParteId(null)} className="font-bold">
                              ✕
                            </button>
                          </div>
                          <div className="flex gap-1 flex-wrap">
                            {[10, 20, 50, 100].filter((v) => v < disponible).map((val) => (
                              <button
                                key={val}
                                onClick={() => aceptarPropuesta(m.id, val)}
                                disabled={enviando}
                                className="bg-[#008069] text-white px-2 py-0.5 rounded text-[10px] font-mono font-bold"
                              >
                                {formatearMontoRegional(val)}
                              </button>
                            ))}
                          </div>
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={montoParcialInput}
                              onChange={(e) => setMontoParcialInput(e.target.value)}
                              placeholder={`Monto (ej. 43,50 — máx ${formatearMontoRegional(disponible)})`}
                              className={`flex-1 text-xs px-2 py-1 rounded border outline-none font-mono ${
                                esClaro
                                  ? "bg-white text-[#111b21] border-gray-300"
                                  : "bg-[#202c33] text-white border-gray-700"
                              }`}
                            />
                            <button
                              onClick={() => {
                                const n = parseFloat(String(montoParcialInput).replace(",", "."));
                                if (!n || n <= 0 || n > disponible) {
                                  alert(`Ingresa un monto válido entre 0,01 y ${formatearMontoRegional(disponible)}`);
                                  return;
                                }
                                aceptarPropuesta(m.id, n);
                              }}
                              disabled={enviando || !montoParcialInput}
                              className="bg-[#008069] text-white font-black px-2.5 py-1 rounded text-xs"
                            >
                              ✓ Jugaron
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Botón de Cierre Individual para el autor (sin saturar el chat) */}
                  {mio && activa && (
                    <button
                      onClick={() => cerrarPropuestasDirectamente(m.id)}
                      disabled={enviando}
                      className={`w-full mt-1 py-1 px-2 rounded text-[10px] font-bold transition flex items-center justify-center gap-1 border ${
                        esClaro
                          ? "bg-red-50 hover:bg-red-100 border-red-200 text-red-700"
                          : "bg-red-950/50 hover:bg-red-900/60 border-red-600/40 text-red-300"
                      }`}
                    >
                      <span>🚫</span>
                      <span>Se fue (Cerrar esta jugada)</span>
                    </button>
                  )}

                  {m.estado_propuesta === "anulada" && (
                    <span className="text-[10px] text-red-500 font-bold block mt-0.5">🚫 Jugada Retirada ("Se fue")</span>
                  )}
                </div>
              </div>
            );
          }

          // 4. BURBUJA DE TEXTO ESTÁNDAR / CONCRECIÓN ("Jugaron") / MENSAJE NORMAL
          const citado = m.reply_to_msg_id ? mensajesMap.get(m.reply_to_msg_id) : null;
          const citadoEsMio = citado ? esMio(citado.remitente_id, citado.remitente_nombre) : false;
          const esJugaron = m.tipo_mensaje === "CONCRECION" || /\bJugaron\b/i.test(contenidoNormalizado);

          const isSwipingEste = swipingId === m.id;
          const transformStyle = isSwipingEste
            ? { transform: `translateX(${swipeOffset}px)`, transition: "transform 0.04s ease-out" }
            : { transition: "transform 0.18s ease" };

          return (
            <div
              key={m.id}
              className="relative group select-none flex items-center"
              onTouchStart={(e) => handleTouchStart(e, m)}
              onTouchMove={(e) => handleTouchMove(e, m)}
              onTouchEnd={() => handleTouchEnd(m)}
              onDoubleClick={() => {
                setReplyToPropuesta(m);
                inputRef.current?.focus();
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenuContextual({
                  x: Math.min(e.clientX, window.innerWidth - 200),
                  y: Math.min(e.clientY, window.innerHeight - 200),
                  msg: m,
                });
              }}
            >
              {isSwipingEste && swipeOffset > 10 && (
                <div
                  className="absolute left-1.5 z-10 w-6 h-6 rounded-full bg-[#008069] text-white flex items-center justify-center text-xs font-bold shadow"
                  style={{
                    transform: `scale(${Math.min(1.15, swipeOffset / 35)})`,
                    opacity: Math.min(1, swipeOffset / 28),
                  }}
                >
                  ↩️
                </div>
              )}

              <div
                style={transformStyle}
                className={`w-full max-w-[90%] sm:max-w-[74%] rounded-lg px-2.5 py-1.5 relative ${
                  esJugaron
                    ? esClaro
                      ? "mx-auto sm:ml-0 bg-[#e7fce3] border border-[#008069]/35 text-[#111b21] shadow-xs"
                      : "mx-auto sm:ml-0 bg-emerald-950/60 border border-emerald-500/40 text-emerald-100 shadow"
                    : mio
                      ? esClaro
                        ? "ml-auto bg-[#d9fdd3] text-[#111b21] rounded-tr-none shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]"
                        : "ml-auto bg-[#005c4b] text-white rounded-tr-none shadow"
                      : esClaro
                        ? "mr-auto bg-white text-[#111b21] rounded-tl-none shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]"
                        : "mr-auto bg-[#202c33] text-[#e9edef] rounded-tl-none shadow"
                }`}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setReplyToPropuesta(m);
                    inputRef.current?.focus();
                  }}
                  className={`opacity-0 group-hover:opacity-100 transition-opacity absolute top-1 right-1 px-1.5 py-0.5 rounded text-[10px] z-10 shadow-xs ${
                    esClaro
                      ? "bg-white/90 text-[#008069] border border-gray-200"
                      : "bg-[#202c33] text-emerald-400 border border-gray-700"
                  }`}
                  title="Responder citando (WhatsApp)"
                >
                  ↩️
                </button>

                <div className="flex items-center justify-between gap-2 leading-tight mb-0.5">
                  <span
                    style={{ color: mio ? (esClaro ? "#008069" : "#a7f3d0") : colorNombreRemitente(m.remitente_nombre) }}
                    className="font-bold text-[11px] truncate"
                  >
                    {esJugaron ? "🤝 Jugaron" : mio ? "Tú" : m.remitente_nombre || "Jugador"}{" "}
                    {m.es_operador && "👑"}
                  </span>
                  <div className="flex items-center gap-1 text-[9px] font-mono shrink-0">
                    <span className={esClaro ? "text-[#667781]" : "text-gray-400"}>
                      {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    {mio && <span className="text-[#53bdeb] font-bold text-[10px]">✓✓</span>}
                  </div>
                </div>

                {/* Caja de cita estilo WhatsApp */}
                {citado && (
                  <div
                    className={`mb-1 px-2 py-1 rounded border-l-4 border-[#008069] text-[11px] select-text ${
                      esClaro ? "bg-black/[0.05]" : "bg-black/30"
                    }`}
                  >
                    <div className="font-bold text-[#008069] text-[10px] flex items-center gap-1">
                      <span>↩️</span>
                      <span>{citadoEsMio ? "Tú" : citado.remitente_nombre || "Jugador"}</span>
                    </div>
                    <div className={`truncate font-mono text-[11px] ${esClaro ? "text-[#54656f]" : "text-gray-300"}`}>
                      {citado.jugada_estandarizada || normalizarTerminologiaJugaron(citado.contenido)}
                    </div>
                  </div>
                )}

                <p className="break-words leading-snug whitespace-pre-wrap">{contenidoNormalizado}</p>
              </div>
            </div>
          );
        })}

        {/* Tarjeta de Corrección Pedagógica Privada */}
        {sugerenciaPedagogica && (
          <div
            className={`my-1 p-2.5 border rounded-xl shadow-md space-y-1.5 ${
              esClaro
                ? "bg-white border-[#008069] text-[#111b21]"
                : "bg-[#182229] border-emerald-500/60 text-white"
            }`}
          >
            <div className="flex items-center justify-between text-[#008069] font-bold text-xs">
              <span>🤖 Asistente de Sala (Privado para ti)</span>
              <button onClick={() => setSugerenciaPedagogica(null)} className="text-xs opacity-60 hover:opacity-100">
                ✕
              </button>
            </div>
            <p className="text-xs whitespace-pre-wrap leading-snug font-mono">{sugerenciaPedagogica.mensaje}</p>
            {sugerenciaPedagogica.sugerencias.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-0.5">
                {sugerenciaPedagogica.sugerencias.map((sug, i) => (
                  <button
                    key={i}
                    onClick={() => aplicarSugerencia(sug)}
                    className="bg-[#008069] hover:bg-[#017561] text-white font-black text-xs px-2.5 py-1 rounded-lg transition shadow-xs"
                  >
                    👉 {sug}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Barra Inferior Compacta estilo WhatsApp con Citación + Compositor Rápido 1-Toque */}
      <div
        className={`px-2 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] border-t space-y-1 ${
          esClaro ? "bg-[#f0f2f5] border-[#d1d7db]" : "bg-[#202c33] border-[#2a3942]"
        }`}
      >
        {/* Banner de Citación Activa */}
        {replyToPropuesta && (
          <div
            className={`border-l-4 border-[#008069] rounded-md px-2.5 py-1 flex items-center justify-between text-xs ${
              esClaro ? "bg-white text-[#111b21] shadow-xs" : "bg-[#111b21] text-white"
            }`}
          >
            <div className="truncate mr-2">
              <div className="flex items-center gap-1 text-[#008069] font-bold text-[11px]">
                <span>↩️</span>
                <span>Respondiendo a: {replyToPropuesta.remitente_nombre || "Jugador"}</span>
                {(replyToPropuesta.monto_disponible || replyToPropuesta.monto_original) && (
                  <span className="font-mono text-amber-600">
                    (Disp: {prefijo}{formatearMontoRegional(replyToPropuesta.monto_disponible || replyToPropuesta.monto_original)})
                  </span>
                )}
              </div>
              <p className={`text-[11px] truncate font-mono ${esClaro ? "text-[#54656f]" : "text-gray-300"}`}>
                {replyToPropuesta.jugada_estandarizada || normalizarTerminologiaJugaron(replyToPropuesta.contenido)}
              </p>
            </div>
            <button
              onClick={() => setReplyToPropuesta(null)}
              className="opacity-70 hover:opacity-100 px-1.5 py-0.5 rounded-full text-xs font-bold"
              title="Cancelar citación"
            >
              ✕
            </button>
          </div>
        )}

        {/* Teclado Rápido 1-Toque desplegable */}
        {tecladoRapidoAbierto && !replyToPropuesta && (
          <div
            className={`p-2 rounded-lg border space-y-1.5 text-xs ${
              esClaro ? "bg-white border-[#d1d7db]" : "bg-[#111b21] border-gray-700"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-black text-[10px] uppercase tracking-wider text-[#008069]">
                ⚡ Compositor Rápido 1-Toque
              </span>
              <button
                type="button"
                onClick={() => setTecladoRapidoAbierto(false)}
                className="text-[11px] font-bold opacity-60 hover:opacity-100"
              >
                ✕ Cerrar
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {(["Juego", "Consigo", "Doy"] as const).map((acc) => (
                <button
                  key={acc}
                  type="button"
                  onClick={() => setAccionRapida(acc)}
                  className={`px-2 py-0.5 rounded font-bold text-[11px] ${
                    accionRapida === acc
                      ? "bg-[#008069] text-white"
                      : esClaro
                        ? "bg-gray-100 text-gray-700"
                        : "bg-[#202c33] text-gray-300"
                  }`}
                >
                  {acc}
                </button>
              ))}
              <span className="opacity-40">|</span>
              <div className="flex flex-wrap items-center gap-1 max-h-24 overflow-y-auto">
                {[
                  "1P",
                  "1P-1/2N",
                  "1/2N",
                  "1/2N-2N",
                  "2N",
                  "2N-2/2N",
                  "2/2N",
                  "2/2N-2P",
                  "2P",
                  "2P-2/3N",
                  "2/3N",
                  "2/3N-3N",
                  "3N",
                  "3N-3/3N",
                  "3/3N",
                  "3/3N-3P",
                  "3P",
                  "3P-3/4N",
                  "3/4N",
                  "3/4N-4N",
                  "4N",
                  "4N-4/4N",
                  "4/4N",
                  "4/4N-4P",
                  "4P",
                  "4P-4/5N",
                  "4/5N",
                  "4/5N-5N",
                  "5N",
                  "5N-5/5N",
                  "5/5N",
                  "5/5N-5P",
                  "5P",
                ].map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPuestoRapido(p)}
                    className={`px-1.5 py-0.5 rounded font-mono font-bold text-[11px] whitespace-nowrap ${
                      puestoRapido === p
                        ? "bg-[#008069] text-white"
                        : esClaro
                          ? "bg-gray-100 text-gray-700"
                          : "bg-[#202c33] text-gray-300"
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
              <span className="text-[10px] font-bold shrink-0">Ejemplar #:</span>
              {Array.from({ length: 14 }, (_, i) => String(i + 1)).map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => setEjemplarRapido(num)}
                  className={`w-6 h-6 rounded-full font-mono font-bold text-[11px] shrink-0 ${
                    ejemplarRapido === num
                      ? "bg-[#008069] text-white"
                      : esClaro
                        ? "bg-gray-100 text-gray-800"
                        : "bg-[#202c33] text-gray-300"
                  }`}
                >
                  {num}
                </button>
              ))}
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-1.5 pt-0.5">
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-[10px] font-bold">{esBs ? "Monto Bs:" : "Monto $:"}</span>
                {esBs ? (
                  [
                    { val: "5k", label: "5k (5.000)" },
                    { val: "10.000", label: "10.000" },
                    { val: "20.000", label: "20.000" },
                    { val: "50.000", label: "50.000" },
                    { val: "100.000", label: "100.000" },
                  ].map((item) => (
                    <button
                      key={item.val}
                      type="button"
                      onClick={() => setMontoRapido(item.val)}
                      className={`px-2 py-0.5 rounded font-mono font-bold text-[11px] ${
                        montoRapido === item.val
                          ? "bg-[#008069] text-white"
                          : esClaro
                            ? "bg-gray-100 text-gray-800"
                            : "bg-[#202c33] text-gray-300"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))
                ) : (
                  ["10", "20", "50", "100", "200"].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMontoRapido(m)}
                      className={`px-2 py-0.5 rounded font-mono font-bold text-[11px] ${
                        montoRapido === m
                          ? "bg-[#008069] text-white"
                          : esClaro
                            ? "bg-gray-100 text-gray-800"
                            : "bg-[#202c33] text-gray-300"
                      }`}
                    >
                      ${m}
                    </button>
                  ))
                )}
              </div>
              <button
                type="button"
                disabled={enviando}
                onClick={() => enviarMensaje(`${accionRapida} ${puestoRapido} del ${ejemplarRapido} con ${montoRapido}`)}
                className="bg-[#008069] hover:bg-[#017561] text-white font-black px-3 py-1.5 rounded-lg text-xs shadow-xs shrink-0 text-center transition active:scale-[0.98]"
              >
                ➤ Publicar: {accionRapida} {puestoRapido} #{ejemplarRapido} {esBs ? `Bs. ${montoRapido}` : `$${montoRapido}`}
              </button>
            </div>
          </div>
        )}

        {/* Chips de Respuestas Predefinidas estilo WhatsApp */}
        {replyToPropuesta ? (
          <div className="flex gap-1 overflow-x-auto pb-0.5 text-[11px]">
            {(() => {
              const textoProp = (replyToPropuesta.contenido || replyToPropuesta.jugada_estandarizada || "").toLowerCase();
              const esPropJuego =
                textoProp.includes("juego") || (replyToPropuesta.accion_proponente || "").toUpperCase() === "JUEGA";
              const disp = Number(replyToPropuesta.monto_disponible || replyToPropuesta.monto_original || 0);

              const opcionesMonto = esBs
                ? [
                    { val: "5k", num: 5000, label: "5k (5.000)" },
                    { val: "10.000", num: 10000, label: "10.000" },
                    { val: "20.000", num: 20000, label: "20.000" },
                    { val: "50.000", num: 50000, label: "50.000" },
                  ]
                : [
                    { val: "10", num: 10, label: "$10" },
                    { val: "20", num: 20, label: "$20" },
                    { val: "50", num: 50, label: "$50" },
                    { val: "100", num: 100, label: "$100" },
                  ];

              if (esPropJuego) {
                return (
                  <>
                    <button
                      onClick={() => aceptarPropuesta(replyToPropuesta.id)}
                      disabled={enviando}
                      className="bg-[#008069] hover:bg-[#017561] text-white font-black px-2 py-0.5 rounded text-[11px] shadow-xs font-mono whitespace-nowrap"
                    >
                      ⚡ Tomar Total ({prefijo}{formatearMontoRegional(disp)})
                    </button>
                    {opcionesMonto.filter((opt) => opt.num < disp).map((opt) => (
                      <button
                        key={opt.val}
                        onClick={() => enviarMensaje(`Consigo ${opt.val}`)}
                        className={`px-2 py-0.5 rounded border font-mono font-bold whitespace-nowrap ${
                          esClaro
                            ? "bg-white border-[#008069]/40 text-[#008069]"
                            : "bg-[#111b21] border-emerald-600/50 text-emerald-300"
                        }`}
                      >
                        + Consigo {opt.label}
                      </button>
                    ))}
                    {["Doy", "J", "Ponte", "Jugaste"].map((v) => (
                      <button
                        key={v}
                        onClick={() => enviarMensaje(v)}
                        className={`px-2 py-0.5 rounded border font-mono whitespace-nowrap ${
                          esClaro
                            ? "bg-white border-gray-300 text-[#111b21]"
                            : "bg-[#111b21] border-gray-700 text-gray-200"
                        }`}
                      >
                        + {v}
                      </button>
                    ))}
                  </>
                );
              } else {
                return (
                  <>
                    <button
                      onClick={() => aceptarPropuesta(replyToPropuesta.id)}
                      disabled={enviando}
                      className="bg-[#008069] hover:bg-[#017561] text-white font-black px-2 py-0.5 rounded text-[11px] shadow-xs font-mono whitespace-nowrap"
                    >
                      ⚡ Tomar Total ({prefijo}{formatearMontoRegional(disp)})
                    </button>
                    {opcionesMonto.filter((opt) => opt.num < disp).map((opt) => (
                      <button
                        key={opt.val}
                        onClick={() => enviarMensaje(`Juego ${opt.val}`)}
                        className={`px-2 py-0.5 rounded border font-mono font-bold whitespace-nowrap ${
                          esClaro
                            ? "bg-white border-[#008069]/40 text-[#008069]"
                            : "bg-[#111b21] border-emerald-600/50 text-emerald-300"
                        }`}
                      >
                        + Juego {opt.label}
                      </button>
                    ))}
                    {["Voy", "J", "Ponte", "Jugue"].map((v) => (
                      <button
                        key={v}
                        onClick={() => enviarMensaje(v)}
                        className={`px-2 py-0.5 rounded border font-mono whitespace-nowrap ${
                          esClaro
                            ? "bg-white border-gray-300 text-[#111b21]"
                            : "bg-[#111b21] border-gray-700 text-gray-200"
                        }`}
                      >
                        + {v}
                      </button>
                    ))}
                  </>
                );
              }
            })()}
          </div>
        ) : (
          /* Atajos rápidos generales para proponer */
          <div className="flex gap-1 overflow-x-auto pb-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => setTecladoRapidoAbierto((v) => !v)}
              className={`px-2 py-0.5 rounded font-bold whitespace-nowrap border ${
                tecladoRapidoAbierto
                  ? "bg-[#008069] text-white border-[#008069]"
                  : esClaro
                    ? "bg-white text-[#008069] border-[#008069]/40"
                    : "bg-[#111b21] text-emerald-400 border-emerald-600/40"
              }`}
            >
              ⚡ 1-Toque
            </button>
            <button
              onClick={() => setTextoInput("Juego 1P ")}
              className={`px-2 py-0.5 rounded border font-mono whitespace-nowrap ${
                esClaro ? "bg-white border-gray-300 text-[#111b21]" : "bg-[#111b21] border-gray-700 text-gray-200"
              }`}
            >
              + Juego 1P
            </button>
            <button
              onClick={() => setTextoInput("Consigo 1P ")}
              className={`px-2 py-0.5 rounded border font-mono whitespace-nowrap ${
                esClaro ? "bg-white border-gray-300 text-[#111b21]" : "bg-[#111b21] border-gray-700 text-gray-200"
              }`}
            >
              + Consigo 1P
            </button>
            <button
              onClick={() => setTextoInput("Juego 1 x 4 50")}
              className={`px-2 py-0.5 rounded border font-mono whitespace-nowrap ${
                esClaro ? "bg-white border-gray-300 text-[#111b21]" : "bg-[#111b21] border-gray-700 text-gray-200"
              }`}
            >
              + Match (x)
            </button>
            <button
              onClick={() => cerrarPropuestasDirectamente()}
              disabled={enviando}
              className={`px-2 py-0.5 rounded font-mono font-bold text-[11px] flex items-center gap-0.5 transition whitespace-nowrap border ${
                esClaro
                  ? "bg-red-50 hover:bg-red-100 text-red-700 border-red-200"
                  : "bg-red-950/70 hover:bg-red-900/80 text-red-300 border-red-700/50"
              }`}
              title="Cierra todas tus jugadas abiertas individualmente sin saturar el chat"
            >
              <span>🚫</span> Se fue
            </button>
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            enviarMensaje();
          }}
          className="flex items-center gap-1.5"
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
                  ? "Escribe un mensaje o jugada (ej. Juego 1p del 5 con 100)..."
                  : "Carrera cerrada (solo mensajes de consulta)..."
            }
            className={`flex-1 text-xs rounded-full px-3.5 py-2 outline-none font-medium border ${
              esClaro
                ? "bg-white text-[#111b21] placeholder-[#667781] border-[#d1d7db] focus:border-[#008069]"
                : "bg-[#2a3942] text-white placeholder-gray-400 border-transparent focus:border-emerald-500"
            }`}
          />
          <button
            type="submit"
            disabled={enviando || !textoInput.trim()}
            className="bg-[#008069] hover:bg-[#017561] disabled:opacity-40 text-white font-black w-9 h-9 rounded-full transition flex items-center justify-center text-sm shadow-sm shrink-0"
          >
            <span>➤</span>
          </button>
        </form>
      </div>

      {/* Menú Contextual Flotante estilo WhatsApp */}
      {menuContextual && (
        <div
          className={`fixed z-50 border rounded-xl shadow-2xl py-1 min-w-[185px] text-xs font-semibold select-none ${
            esClaro
              ? "bg-white border-gray-200 text-[#111b21]"
              : "bg-[#233138] border-[#2a3942] text-[#e9edef]"
          }`}
          style={{ left: menuContextual.x, top: menuContextual.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              setReplyToPropuesta(menuContextual.msg);
              setMenuContextual(null);
              inputRef.current?.focus();
            }}
            className={`w-full text-left px-3 py-2 flex items-center gap-2 transition ${
              esClaro ? "hover:bg-gray-100" : "hover:bg-[#182229]"
            }`}
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
                    className={`w-full text-left px-3 py-2 text-[#008069] font-bold flex items-center gap-2 transition ${
                      esClaro ? "hover:bg-gray-100" : "hover:bg-[#182229]"
                    }`}
                  >
                    <span>⚡</span>
                    <span>Tomar Jugada Total</span>
                  </button>
                  <button
                    onClick={() => {
                      setTomandoParteId(menuContextual.msg.id);
                      setMenuContextual(null);
                    }}
                    className={`w-full text-left px-3 py-2 text-amber-600 font-bold flex items-center gap-2 transition ${
                      esClaro ? "hover:bg-gray-100" : "hover:bg-[#182229]"
                    }`}
                  >
                    <span>✂️</span>
                    <span>Tomar una parte</span>
                  </button>
                </>
              )}

              {esMio(menuContextual.msg.remitente_id, menuContextual.msg.remitente_nombre) && (
                <button
                  onClick={() => {
                    cerrarPropuestasDirectamente(menuContextual.msg.id);
                    setMenuContextual(null);
                  }}
                  className={`w-full text-left px-3 py-2 text-red-600 font-bold flex items-center gap-2 transition ${
                    esClaro ? "hover:bg-gray-100" : "hover:bg-[#182229]"
                  }`}
                >
                  <span>🚫</span>
                  <span>Cerrar jugada ("Se fue")</span>
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
