"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { salaApi } from "../lib/sala-api";
import { esJidWhatsAppValido } from "./GateVinculacionWhatsApp";
import { notificarActividadSala } from "@/features/auth/components/IdleSessionTimer";
import { supabase } from "@/core/supabase";
import {
  formatearMontoRegional,
  esGrupoBolivares,
  prefijoMonedaGrupo,
} from "@/shared/lib/dinero";
import { extraerMontoNumerico } from "../lib/parser-pedagogico";
import {
  ORDEN_MODALIDADES_PROGRESIVO,
  limpiarEtiquetasProhibidas,
  normalizarModalidadProgresiva,
  parsearBloqueEnfrentamiento,
} from "@/features/sala-juegos/lib/modalidades-progresivas";

export type ClaveFuenteSala = "whatsapp" | "inter" | "roboto" | "sf" | "tabular";
export type TemaSala = "claro" | "oscuro";

export const MONTOS_BOTONES_USD = [
  { val: "todo", label: "⚡ Voy Todo" },
  { val: "10", label: "10" },
  { val: "20", label: "20" },
  { val: "50", label: "50" },
  { val: "100", label: "100" },
];

export const MONTOS_BOTONES_VES = [
  { val: "todo", label: "⚡ Voy Todo" },
  { val: "10000", label: "10" },
  { val: "20000", label: "20" },
  { val: "50000", label: "50" },
  { val: "100000", label: "100" },
];

const MONTO_TODO = "todo";
const MONTO_POR_DEFECTO_USD = "20";
const MONTO_POR_DEFECTO_VES = "20000";

/** Aliases progresivos que el bot reconoce y que deben estar visibles en el compositor. */
const ALIAS_MODALIDAD_PROGRESIVA: Record<string, string> = {
  "2N y 2P": "2/2N",
  "3N y 3P": "3/3N",
  "4N y 4P": "4/4N",
  "5N y 5P": "5/5N",
};

const MODALIDADES_RAPIDAS = ORDEN_MODALIDADES_PROGRESIVO.flatMap((mod) => {
  const alias = ALIAS_MODALIDAD_PROGRESIVA[mod];
  return alias ? [mod, alias] : [mod];
});

const EJEMPLOS_BLOQUE = ["1,2x5", "1,3,4x2,6", "1y2x3y4", "Bloque 1-2 contra 5-6"];

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
  onAbrirOperador?: (tab?: "carrera" | "retirados" | "liquidacion" | "publicidad") => void;
  onAbrirPrejugadas?: () => void;
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
  onAbrirPrejugadas,
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
  const [accionRapida, setAccionRapida] = useState<"Juego" | "Consigo">("Juego");
  const [modalidadRapida, setModalidadRapida] = useState<string>("1P");
  const [ejemplarRapido, setEjemplarRapido] = useState<string>("1");
  const [bloqueRapido, setBloqueRapido] = useState<string>("");
  const [montoRapido, setMontoRapido] = useState<string>(esBs ? MONTO_POR_DEFECTO_VES : MONTO_POR_DEFECTO_USD);
  const [montoManual, setMontoManual] = useState<string>("");
  const [imagenAdjunta, setImagenAdjunta] = useState<{ url: string; path: string } | null>(null);
  const [subiendoImagen, setSubiendoImagen] = useState(false);
  const inputImagenRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMontoRapido(esBs ? MONTO_POR_DEFECTO_VES : MONTO_POR_DEFECTO_USD);
    setMontoManual("");
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
    if (sala?.id) {
      void cargarMensajes();
    }
  }, [sala?.id, sala?.estado_carrera, sala?.hipodromo_activo, sala?.numero_carrera_activa]);

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
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "chat_tickets_fifo",
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
    notificarActividadSala();

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
          if (res.data?.advertenciaSaldo) {
            setSugerenciaPedagogica({
              mensaje: res.data.advertenciaSaldo,
              sugerencias: [],
            });
          } else {
            setSugerenciaPedagogica(null);
          }
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

  /** Ctrl+V / botón Adjuntar → /api/whatsapp/upload (service_role) → URL pública. */
  const subirImagenAdjunta = async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    setSubiendoImagen(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("grupoId", grupoId);
      const res = await fetch("/api/whatsapp/upload", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      const url = String(data.publicUrl || data.media_url || "");
      if (!url) throw new Error("No se obtuvo URL pública del archivo");
      setImagenAdjunta({ url, path: String(data.path || "") });
    } catch (err: any) {
      console.warn("Error subiendo imagen adjunta:", err);
      alert(`No se pudo adjuntar la imagen: ${err?.message || "error desconocido"}`);
    } finally {
      setSubiendoImagen(false);
    }
  };

  const manejarPasteImagen = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const archivo = Array.from(e.clipboardData?.items || [])
      .find((item) => item.kind === "file" && item.type.startsWith("image/"))
      ?.getAsFile();
    if (archivo) {
      e.preventDefault();
      void subirImagenAdjunta(archivo);
    }
  };

  const enviarImagenAdjunta = async () => {
    if (!imagenAdjunta) return;
    notificarActividadSala();
    // El destinatario SIEMPRE sale del vínculo guardado en `salas_juego`.
    const jid = String(sala?.whatsapp_group_jid || sala?.whatsappGroupJid || "").trim();
    if (!esJidWhatsAppValido(jid)) return;
    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grupoId,
          media_url: imagenAdjunta.url,
          tipo: "IMAGEN",
          session_id: "default",
          to_jid: jid,
          message_text: textoInput.trim(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!json?.ok) throw new Error(json?.error || "No se pudo enviar la imagen al grupo de WhatsApp");
      setTextoInput("");
      setImagenAdjunta(null);
      await cargarMensajes();
    } catch (err: any) {
      alert(`No se pudo enviar la imagen: ${err?.message || "error desconocido"}`);
    }
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
  const esClaro = true; // Tema claro estricto

  const bloqueDetectado = useMemo(() => parsearBloqueEnfrentamiento(bloqueRapido), [bloqueRapido]);
  const caballosRapidosTexto = bloqueDetectado
    ? `${bloqueDetectado.ladoA.join("-")} x ${bloqueDetectado.ladoB.join("-")}`
    : ejemplarRapido;
  const modalidadCanon = normalizarModalidadProgresiva(modalidadRapida) || modalidadRapida;
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
        esClaro ? "bg-white border-slate-200 text-slate-900" : "bg-white border-slate-200 text-slate-900"
      }`}
    >
      {/* Sub-Cabecera Compacta de la Sala + Filtros Rápidos */}
      <div
        className={`px-2 py-1 flex flex-wrap items-center justify-between gap-1 border-b ${
          esClaro ? "bg-slate-50 border-slate-200" : "bg-slate-50 border-slate-200"
        }`}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <div
            className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black shrink-0 ${
              esClaro
                ? "bg-emerald-600 text-white"
                : "bg-emerald-700/40 border border-emerald-500/40 text-emerald-700"
            }`}
          >
            🏇
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              <span className={`text-xs font-extrabold truncate ${esClaro ? "text-slate-900" : "text-white"}`}>
                {sala?.hipodromo_activo || "HIPÓDROMO"} · C{sala?.numero_carrera_activa || 1}
              </span>
              <span
                className={`text-[9px] px-1.5 py-0.2 rounded-full font-black uppercase ${
                  esCarreraAbierta
                    ? esClaro
                      ? "bg-[#d9fdd3] text-[#008069] border border-[#008069]/30"
                      : "bg-emerald-950 text-emerald-700 border border-emerald-600/50"
                    : esClaro
                      ? "bg-amber-100 text-amber-800 border border-amber-300"
                      : "bg-amber-950 text-amber-400 border border-amber-600/50"
                }`}
              >
                ● {sala?.estado_carrera || "CERRADA"}
              </span>
              <span className={`text-[10px] hidden sm:inline ${esClaro ? "text-[#667781]" : "text-slate-500"}`}>
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
                    ? "bg-emerald-600 text-white shadow-xs"
                    : "bg-[#00a884] text-white shadow-xs"
                  : esClaro
                    ? "bg-white text-[#54656f] border border-slate-200 hover:bg-gray-50"
                    : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-200"
              }`}
            >
              {tab.label}
            </button>
          ))}

          {identidad?.esOperador && (
            <button
              onClick={() => onAbrirOperador?.("carrera")}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] px-2 py-0.5 rounded-full transition flex items-center gap-0.5 shrink-0"
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
          esClaro ? "bg-white" : "bg-white"
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
            <p className={`font-bold text-xs ${esClaro ? "text-slate-900" : "text-slate-700"}`}>
              {filtroFeed === "todos" ? "Sala Hípica lista para tus jugadas." : "No hay mensajes en este filtro."}
            </p>
            <p className={`text-[11px] max-w-xs ${esClaro ? "text-[#667781]" : "text-slate-500"}`}>
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
                    ? "bg-[#fff8e6] border-amber-300 text-slate-900"
                    : "bg-slate-50 border-emerald-500/40 text-slate-900"
                }`}
              >
                <div className="text-[#008069] text-[10px] font-black tracking-wide uppercase flex items-center justify-center gap-1">
                  <span>🏇</span>
                  <span>AVISO OFICIAL DE PISTA</span>
                </div>
                <p className="text-[12px] font-semibold whitespace-pre-wrap leading-snug">
                  {contenidoNormalizado}
                </p>
                <span className={`text-[9px] font-mono block ${esClaro ? "text-[#667781]" : "text-slate-500"}`}>
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
                    ? "bg-white border-[#008069]/40 text-slate-900"
                    : "bg-white border-amber-500/40 text-slate-800"
                }`}
              >
                <div className="text-[#008069] text-[11px] font-black uppercase flex items-center gap-1.5 mb-1">
                  <span>🏁</span>
                  <span>RESULTADOS Y LIQUIDACIÓN OFICIAL</span>
                </div>
                <div className="text-[12px] font-mono whitespace-pre-wrap leading-snug">
                  {contenidoNormalizado}
                </div>
                <span className={`text-[9px] font-mono mt-1 block text-right ${esClaro ? "text-[#667781]" : "text-slate-500"}`}>
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
                    className="absolute left-1.5 z-10 w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs font-bold shadow"
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
                        ? "ml-auto bg-[#d9fdd3] text-slate-900 rounded-tr-none shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]"
                        : "ml-auto bg-emerald-100 text-slate-900 rounded-tr-none shadow"
                      : esClaro
                        ? "mr-auto bg-white text-slate-900 rounded-tl-none shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]"
                        : "mr-auto bg-slate-50 text-slate-900 rounded-tl-none shadow"
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
                        : "bg-slate-50 text-emerald-700 border border-slate-200"
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
                            esClaro ? "bg-emerald-600/10 text-[#008069]" : "text-emerald-700"
                          }`}
                        >
                          ⏱️{segundosRestantes}s
                        </span>
                      )}
                      <span className={esClaro ? "text-[#667781]" : "text-slate-500"}>
                        {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      {mio && <span className="text-[#53bdeb] font-bold text-[10px]">✓✓</span>}
                    </div>
                  </div>

                  {/* Tarjeta interna de la jugada */}
                  <div
                    className={`rounded-md px-2 py-1 my-0.5 border ${
                      esClaro
                        ? "bg-slate-100 border-slate-200"
                        : "bg-slate-100 border-slate-200"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 font-bold">
                      <span className={esClaro ? "text-slate-900" : "text-amber-300"}>
                        🏇 {m.jugada_estandarizada || contenidoNormalizado}
                      </span>
                      <span
                        className={`font-black font-mono shrink-0 ${
                          esClaro ? "text-[#008069]" : "text-emerald-700"
                        }`}
                      >
                        {formatearMontoRegional(m.monto_original)}
                      </span>
                    </div>
                    {m.monto_disponible < m.monto_original && m.monto_disponible > 0 && (
                      <div className="text-[10px] font-mono mt-0.5 flex items-center justify-between">
                        <span className={esClaro ? "text-[#54656f]" : "text-slate-700"}>Disponible:</span>
                        <span className="font-bold text-[#008069]">
                          {formatearMontoRegional(m.monto_disponible)} de {formatearMontoRegional(m.monto_original)}
                        </span>
                      </div>
                    )}

                    {/* Desglose en vivo de quiénes van jugando en esta propuesta ("Eddie jugó 43,50") */}
                    {Array.isArray(m.desglose_jugaron) && m.desglose_jugaron.length > 0 && (
                      <div
                        className={`mt-1 pt-1 border-t text-[11px] font-mono space-y-0.5 ${
                          esClaro ? "border-slate-200 text-slate-900" : "border-slate-200 text-emerald-800"
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
                            : "bg-emerald-950/60 text-emerald-700"
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
                          className="col-span-1 bg-emerald-600 hover:bg-emerald-700 text-white font-black py-1 px-1.5 rounded text-[11px] transition flex items-center justify-center gap-0.5 shadow-xs"
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
                              ? "bg-white hover:bg-gray-50 border-gray-300 text-slate-900"
                              : "bg-white hover:bg-slate-100 border-slate-300 text-slate-700"
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
                              : "bg-white hover:bg-slate-100 border-emerald-600/50 text-emerald-700"
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
                              : "bg-white border-emerald-500/40"
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
                                className="bg-emerald-600 text-white px-2 py-0.5 rounded text-[10px] font-mono font-bold"
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
                                  ? "bg-white text-slate-900 border-gray-300"
                                  : "bg-slate-50 text-white border-slate-200"
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
                              className="bg-emerald-600 text-white font-black px-2.5 py-1 rounded text-xs"
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
                  className="absolute left-1.5 z-10 w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs font-bold shadow"
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
                      ? "mx-auto sm:ml-0 bg-[#e7fce3] border border-[#008069]/35 text-slate-900 shadow-xs"
                      : "mx-auto sm:ml-0 bg-emerald-950/60 border border-emerald-500/40 text-emerald-100 shadow"
                    : mio
                      ? esClaro
                        ? "ml-auto bg-[#d9fdd3] text-slate-900 rounded-tr-none shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]"
                        : "ml-auto bg-emerald-100 text-slate-900 rounded-tr-none shadow"
                      : esClaro
                        ? "mr-auto bg-white text-slate-900 rounded-tl-none shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]"
                        : "mr-auto bg-slate-50 text-slate-900 rounded-tl-none shadow"
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
                      : "bg-slate-50 text-emerald-700 border border-slate-200"
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
                    <span className={esClaro ? "text-[#667781]" : "text-slate-500"}>
                      {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    {mio && <span className="text-[#53bdeb] font-bold text-[10px]">✓✓</span>}
                  </div>
                </div>

                {/* Caja de cita estilo WhatsApp */}
                {citado && (
                  <div
                    className={`mb-1 px-2 py-1 rounded border-l-4 border-[#008069] text-[11px] select-text ${
                      esClaro ? "bg-slate-100" : "bg-slate-100"
                    }`}
                  >
                    <div className="font-bold text-[#008069] text-[10px] flex items-center gap-1">
                      <span>↩️</span>
                      <span>{citadoEsMio ? "Tú" : citado.remitente_nombre || "Jugador"}</span>
                    </div>
                    <div className={`truncate font-mono text-[11px] ${esClaro ? "text-[#54656f]" : "text-slate-700"}`}>
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
                ? "bg-white border-[#008069] text-slate-900"
                : "bg-slate-50 border-emerald-500/60 text-slate-900"
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
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs px-2.5 py-1 rounded-lg transition shadow-xs"
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
          esClaro ? "bg-slate-50 border-slate-200" : "bg-slate-50 border-slate-200"
        }`}
      >
        {/* Banner de Citación Activa */}
        {replyToPropuesta && (
          <div
            className={`border-l-4 border-[#008069] rounded-md px-2.5 py-1 flex items-center justify-between text-xs ${
              esClaro ? "bg-white text-slate-900 shadow-xs" : "bg-white text-slate-900"
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
              <p className={`text-[11px] truncate font-mono ${esClaro ? "text-[#54656f]" : "text-slate-700"}`}>
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

        {/* Teclado Rápido 1-Toque desplegable para Jugadores */}
        {tecladoRapidoAbierto && !replyToPropuesta && !identidad?.esOperador && (
          <div
            className={`p-2.5 rounded-xl border space-y-2 text-xs shadow-md ${
              esClaro ? "bg-white border-slate-200" : "bg-white border-slate-200"
            }`}
          >
            <div className="flex items-center justify-between border-b pb-1 border-current/10">
              <span className="font-black text-[11px] uppercase tracking-wider text-[#008069] flex items-center gap-1">
                <span>⚡</span>
                <span>Compositor Rápido de Jugadas</span>
              </span>
              <button
                type="button"
                onClick={() => setTecladoRapidoAbierto(false)}
                className="text-[11px] font-bold opacity-60 hover:opacity-100"
              >
                ✕ Cerrar
              </button>
            </div>

            {/* 1. Condición: 🟢 JUEGO / 🟠 DOY (DOY mapea a Consigo para el bot) */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-bold shrink-0 opacity-80">Condición:</span>
              {(
                [
                  { acc: "Juego", label: "🟢 JUEGO" },
                  { acc: "Consigo", label: "🟠 DOY" },
                ] as const
              ).map((op) => (
                <button
                  key={op.acc}
                  type="button"
                  onClick={() => setAccionRapida(op.acc)}
                  className={`px-3 py-1 rounded-lg font-black text-xs transition ${
                    accionRapida === op.acc
                      ? "bg-emerald-600 text-white shadow-xs"
                      : esClaro
                        ? "bg-gray-100 text-gray-700 hover:bg-gray-200"
                        : "bg-slate-50 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  {limpiarEtiquetasProhibidas(op.label)}
                </button>
              ))}
            </div>

            {/* 2. Caballos (ejemplar): selección simple o bloques enfrentados */}
            <div className="space-y-1">
              <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
                <span className="text-[10px] font-bold shrink-0 opacity-80">Caballos (ejemplar):</span>
                {Array.from({ length: 14 }, (_, i) => String(i + 1)).map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => {
                      setEjemplarRapido(num);
                      setBloqueRapido("");
                    }}
                    className={`w-6 h-6 rounded-full font-mono font-bold text-[11px] shrink-0 transition ${
                      !bloqueDetectado && ejemplarRapido === num
                        ? "bg-emerald-600 text-white shadow-xs scale-105"
                        : esClaro
                          ? "bg-gray-100 text-gray-800 hover:bg-gray-200"
                          : "bg-slate-50 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    {num}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <input
                  type="text"
                  value={bloqueRapido}
                  onChange={(e) => setBloqueRapido(e.target.value)}
                  placeholder="Bloque (ej. 1,2x5)"
                  className={`w-40 text-[11px] font-mono font-bold rounded-lg px-2 py-0.5 border outline-none transition ${
                    bloqueDetectado
                      ? "border-[#008069] ring-1 ring-[#008069] bg-white text-slate-900"
                      : esClaro
                        ? "bg-white border-gray-300 text-slate-900 placeholder-gray-400 focus:border-[#008069]"
                        : "bg-slate-50 border-slate-200 text-slate-700 placeholder-gray-500 focus:border-emerald-500"
                  }`}
                />
                {EJEMPLOS_BLOQUE.map((ej) => (
                  <button
                    key={ej}
                    type="button"
                    onClick={() => setBloqueRapido(ej)}
                    className={`px-1.5 py-0.5 rounded font-mono text-[10px] whitespace-nowrap border ${
                      bloqueRapido === ej
                        ? "bg-emerald-600 text-white border-[#008069]"
                        : esClaro
                          ? "bg-white text-[#008069] border-[#008069]/40 hover:bg-gray-50"
                          : "bg-white text-emerald-700 border-emerald-600/40"
                    }`}
                    title="Generar bloque enfrentado entendible por el bot"
                  >
                    {limpiarEtiquetasProhibidas(ej)}
                  </button>
                ))}
                {bloqueRapido && !bloqueDetectado && (
                  <span className="text-[10px] text-amber-700 font-semibold">Revisa el bloque: usa 1,2x5</span>
                )}
              </div>
            </div>

            {/* 3. Modalidad progresiva (SSOT) con alias y sin etiquetas prohibidas */}
            <div className="space-y-1">
              <span className="text-[10px] font-bold shrink-0 opacity-80">Modalidad:</span>
              <div className="flex flex-wrap items-center gap-1 max-h-24 overflow-y-auto">
                {MODALIDADES_RAPIDAS.map((mod) => {
                  const canon = normalizarModalidadProgresiva(mod) || mod;
                  return (
                    <button
                      key={mod}
                      type="button"
                      onClick={() => setModalidadRapida(mod)}
                      className={`px-1.5 py-0.5 rounded font-mono font-bold text-[11px] whitespace-nowrap ${
                        (normalizarModalidadProgresiva(modalidadRapida) || modalidadRapida) === canon
                          ? "bg-emerald-600 text-white shadow-xs"
                          : esClaro
                            ? "bg-gray-100 text-gray-700 hover:bg-gray-200"
                            : "bg-slate-50 text-slate-700 hover:bg-slate-200"
                      }`}
                    >
                      {limpiarEtiquetasProhibidas(mod)}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 4. Montos: ⚡ Voy Todo / 10 / 20 / 50 / 100 */}
            <div className="space-y-1.5 pt-1 border-t border-current/10">
              <div className="flex items-center justify-between gap-1 flex-wrap">
                <span className="text-[10px] font-bold shrink-0">
                  {esBs ? "Montos Bolívares (Bs):" : "Montos Dólares ($ USD):"}
                </span>
                {/* Entrada Manual de Monto */}
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-[10px] opacity-70 font-semibold">Manual:</span>
                  <input
                    type="text"
                    inputMode="text"
                    value={montoManual}
                    onChange={(e) => {
                      setMontoManual(e.target.value);
                      setMontoRapido("");
                    }}
                    placeholder={esBs ? "Ej. 15000 o 15k" : "Ej. 25 o 75"}
                    className={`w-28 text-[11px] font-mono font-bold rounded-lg px-2 py-0.5 border outline-none transition ${
                      montoManual.trim()
                        ? "border-[#008069] ring-1 ring-[#008069] bg-white text-slate-900"
                        : esClaro
                          ? "bg-gray-50 border-gray-300 text-gray-700 placeholder-gray-400 focus:border-[#008069]"
                          : "bg-slate-50 border-slate-200 text-slate-700 placeholder-gray-500 focus:border-emerald-500"
                    }`}
                  />
                  {montoManual && (
                    <button
                      type="button"
                      onClick={() => {
                        setMontoManual("");
                        setMontoRapido(esBs ? MONTO_POR_DEFECTO_VES : MONTO_POR_DEFECTO_USD);
                      }}
                      className="text-[10px] opacity-60 hover:opacity-100 font-bold px-1"
                      title="Restablecer"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>

              {/* Botones de Montos Rápidos en scroll horizontal ordenado */}
              <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-thin">
                {(esBs ? MONTOS_BOTONES_VES : MONTOS_BOTONES_USD).map((item) => {
                  const seleccionado = !montoManual.trim() && montoRapido === item.val;
                  return (
                    <button
                      key={item.val}
                      type="button"
                      onClick={() => {
                        setMontoRapido(item.val);
                        setMontoManual("");
                      }}
                      className={`px-2.5 py-1 rounded-lg font-mono font-bold text-[11px] whitespace-nowrap transition shrink-0 ${
                        seleccionado
                          ? "bg-emerald-600 text-white shadow-xs scale-[1.02]"
                          : esClaro
                            ? "bg-gray-100 text-gray-800 hover:bg-gray-200 border border-gray-200"
                            : "bg-slate-50 text-slate-700 hover:bg-slate-200 border border-slate-200"
                      }`}
                    >
                      {limpiarEtiquetasProhibidas(item.label)}
                    </button>
                  );
                })}
              </div>

              {/* Publicación: "Juego 1P 5 20" o bloque "Juego 1-2 x 5-6 20" */}
              {(() => {
                const rawSeleccionado = (
                  montoManual.trim() ||
                  montoRapido ||
                  (esBs ? MONTO_POR_DEFECTO_VES : MONTO_POR_DEFECTO_USD)
                ).trim();
                const extraido = extraerMontoNumerico(rawSeleccionado);
                const montoLimpio =
                  rawSeleccionado === MONTO_TODO
                    ? "Todo"
                    : extraido.monto > 0
                      ? String(extraido.monto)
                      : rawSeleccionado;
                const parteModalidad = bloqueDetectado ? "" : ` ${modalidadCanon}`;
                const cadenaJugada = `${accionRapida}${parteModalidad} ${caballosRapidosTexto} ${montoLimpio}`;
                const cadenaVisible = limpiarEtiquetasProhibidas(cadenaJugada);
                const montoVisual =
                  rawSeleccionado === MONTO_TODO
                    ? "Todo"
                    : extraido.monto > 0
                      ? formatearMontoRegional(extraido.monto)
                      : rawSeleccionado;

                return (
                  <div className="flex justify-end pt-1">
                    <button
                      type="button"
                      disabled={enviando || (!montoManual.trim() && !montoRapido)}
                      onClick={() => enviarMensaje(cadenaJugada)}
                      className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-black px-4 py-2 rounded-xl text-xs shadow-md text-center transition active:scale-[0.98] flex items-center justify-center gap-2"
                    >
                      <span>➤ Publicar:</span>
                      <span className="font-mono bg-slate-200 px-2 py-0.5 rounded text-[11px]">{cadenaVisible}</span>
                      <span className="text-[10px] opacity-80">
                        ({esBs ? `Bs. ${montoVisual}` : `$${montoVisual}`})
                      </span>
                    </button>
                  </div>
                );
              })()}
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
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-black px-2 py-0.5 rounded text-[11px] shadow-xs font-mono whitespace-nowrap"
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
                            : "bg-white border-emerald-600/50 text-emerald-700"
                        }`}
                      >
                        + Consigo {opt.label}
                      </button>
                    ))}
                    {["Consigo", "J", "Ponte", "Jugaste"].map((v) => (
                      <button
                        key={v}
                        onClick={() => enviarMensaje(v)}
                        className={`px-2 py-0.5 rounded border font-mono whitespace-nowrap ${
                          esClaro
                            ? "bg-white border-gray-300 text-slate-900"
                            : "bg-white border-slate-200 text-slate-700"
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
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-black px-2 py-0.5 rounded text-[11px] shadow-xs font-mono whitespace-nowrap"
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
                            : "bg-white border-emerald-600/50 text-emerald-700"
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
                            ? "bg-white border-gray-300 text-slate-900"
                            : "bg-white border-slate-200 text-slate-700"
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
        ) : identidad?.esOperador ? (
          /* Barra Dinámica y Ágil de Control y Gestión de Operador de Grupo (PASO 4) */
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 text-[11px] scrollbar-thin">
            <span className="text-[10px] font-black uppercase tracking-wider text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-md border border-emerald-500/40 shrink-0 flex items-center gap-1 shadow-2xs">
              <span>🛠️</span> Operador
            </span>
            <button
              type="button"
              onClick={() => onAbrirOperador?.("carrera")}
              className={`px-2.5 py-1 rounded-lg font-bold text-white transition whitespace-nowrap shadow-xs flex items-center gap-1 shrink-0 active:scale-95 ${
                esCarreraAbierta
                  ? "bg-amber-600 hover:bg-amber-500"
                  : "bg-emerald-600 hover:bg-emerald-500"
              }`}
              title="Abrir o cerrar la carrera activa rápidamente"
            >
              <span>🏁</span>
              <span>{esCarreraAbierta ? "Cerrar Carrera" : "Abrir Carrera"}</span>
            </button>
            <button
              type="button"
              onClick={() => onAbrirOperador?.("retirados")}
              className="px-2.5 py-1 rounded-lg font-bold text-white bg-red-600 hover:bg-red-500 transition whitespace-nowrap shadow-xs flex items-center gap-1 shrink-0 active:scale-95"
              title="Marcar ejemplares retirados y cancelar apuestas"
            >
              <span>🚫</span>
              <span>Retirados</span>
            </button>
            <button
              type="button"
              onClick={() => onAbrirOperador?.("liquidacion")}
              className="px-2.5 py-1 rounded-lg font-bold text-white bg-emerald-600 hover:bg-emerald-700 transition whitespace-nowrap shadow-xs flex items-center gap-1 shrink-0 active:scale-95"
              title="Cargar pizarra oficial y liquidar carrera"
            >
              <span>🏆</span>
              <span>Liquidar</span>
            </button>
            <button
              type="button"
              onClick={() => onAbrirPrejugadas?.()}
              className="px-2.5 py-1 rounded-lg font-bold text-amber-950 bg-amber-100 hover:bg-amber-200 border border-amber-300 transition whitespace-nowrap shadow-xs flex items-center gap-1 shrink-0 active:scale-95"
              title="Auditar reporte preliminar de jugadas pactadas"
            >
              <span>📋</span>
              <span>Prejugadas</span>
            </button>
            <button
              type="button"
              onClick={() => onAbrirOperador?.("publicidad")}
              className="px-2.5 py-1 rounded-lg font-bold text-slate-700 bg-gray-100 hover:bg-gray-200 border border-gray-300 transition whitespace-nowrap shadow-xs flex items-center gap-1 shrink-0 active:scale-95"
              title="Crear o fijar aviso en el chat"
            >
              <span>📢</span>
              <span>Aviso</span>
            </button>
            <button
              type="button"
              onClick={() => setTextoInput("📢 ATENCIÓN SALA: ")}
              className="px-2 py-0.5 rounded border border-dashed border-gray-400/60 font-mono text-gray-500 hover:text-gray-900 whitespace-nowrap shrink-0"
              title="Insertar prefijo de aviso en chat"
            >
              + Mensaje Sala
            </button>
          </div>
        ) : (
          /* Atajos rápidos generales para proponer (JUGADORES) */
          <div className="flex gap-1 overflow-x-auto pb-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => setTecladoRapidoAbierto((v) => !v)}
              className={`px-2 py-0.5 rounded font-bold whitespace-nowrap border ${
                tecladoRapidoAbierto
                  ? "bg-emerald-600 text-white border-[#008069]"
                  : esClaro
                    ? "bg-white text-[#008069] border-[#008069]/40"
                    : "bg-white text-emerald-700 border-emerald-600/40"
              }`}
            >
              ⚡ 1-Toque
            </button>
            <button
              onClick={() => setTextoInput("Juego 1P ")}
              className={`px-2 py-0.5 rounded border font-mono whitespace-nowrap ${
                esClaro ? "bg-white border-gray-300 text-slate-900" : "bg-white border-slate-200 text-slate-700"
              }`}
            >
              + Juego 1P
            </button>
            <button
              onClick={() => setTextoInput("Consigo 1P ")}
              className={`px-2 py-0.5 rounded border font-mono whitespace-nowrap ${
                esClaro ? "bg-white border-gray-300 text-slate-900" : "bg-white border-slate-200 text-slate-700"
              }`}
            >
              + Consigo 1P
            </button>
            <button
              onClick={() => setTextoInput("Juego 1 x 4 50")}
              className={`px-2 py-0.5 rounded border font-mono whitespace-nowrap ${
                esClaro ? "bg-white border-gray-300 text-slate-900" : "bg-white border-slate-200 text-slate-700"
              }`}
            >
              {limpiarEtiquetasProhibidas("+ A Premio (x)")}
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

        {/* Preview de imagen adjunta (Ctrl+V o botón Adjuntar) */}
        {imagenAdjunta && (
          <div
            className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${
              esClaro ? "bg-white border-slate-200" : "bg-white border-slate-200"
            }`}
          >
            <img
              src={imagenAdjunta.url}
              alt="Imagen adjunta"
              className="h-10 w-10 rounded-md object-cover border border-slate-200 shrink-0"
            />
            <span className="flex-1 truncate text-[11px] font-semibold text-slate-700">
              🖼️ Imagen lista para enviar al grupo
            </span>
            <button
              type="button"
              onClick={() => void enviarImagenAdjunta()}
              disabled={enviando}
              className="shrink-0 rounded-lg bg-emerald-600 px-2 py-1 text-[11px] font-bold text-white disabled:opacity-40"
            >
              📤 Enviar
            </button>
            <button
              type="button"
              onClick={() => setImagenAdjunta(null)}
              className="shrink-0 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-700"
            >
              ✕ Quitar
            </button>
          </div>
        )}
        <input
          ref={inputImagenRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void subirImagenAdjunta(file);
            e.target.value = "";
          }}
        />

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
            onPaste={manejarPasteImagen}
            placeholder={
              identidad?.esOperador
                ? "Escribe mensaje como Operador oficial de la sala (ej. Carrera abierta, aviso)..."
                : replyToPropuesta
                  ? `Responder a ${replyToPropuesta.remitente_nombre || "propuesta"} (ej. Consigo 20, Ponte, J)...`
                  : esCarreraAbierta
                    ? "Escribe un mensaje o jugada (ej. Juego 1p 5 20)..."
                    : "Carrera cerrada (solo mensajes de consulta)..."
            }
            className={`flex-1 text-xs rounded-full px-3.5 py-2 outline-none font-medium border ${
              esClaro
                ? "bg-white text-slate-900 placeholder-[#667781] border-slate-200 focus:border-[#008069]"
                : "bg-slate-100 text-slate-900 placeholder-gray-400 border-transparent focus:border-emerald-500"
            }`}
          />
          <button
            type="button"
            onClick={() => inputImagenRef.current?.click()}
            disabled={subiendoImagen}
            title="Adjuntar imagen (o Ctrl+V en el cuadro de texto)"
            className="shrink-0 rounded-full px-2.5 py-2 text-[11px] font-bold border border-slate-200 bg-white text-slate-700 hover:bg-gray-50 disabled:opacity-40"
          >
            {subiendoImagen ? "⏳" : "📎 Adjuntar"}
          </button>
          <button
            type="submit"
            disabled={enviando || !textoInput.trim()}
            className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-black w-9 h-9 rounded-full transition flex items-center justify-center text-sm shadow-sm shrink-0"
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
              ? "bg-white border-gray-200 text-slate-900"
              : "bg-slate-50 border-slate-200 text-slate-900"
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
              esClaro ? "hover:bg-gray-100" : "hover:bg-slate-50"
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
                      esClaro ? "hover:bg-gray-100" : "hover:bg-slate-50"
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
                      esClaro ? "hover:bg-gray-100" : "hover:bg-slate-50"
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
                    esClaro ? "hover:bg-gray-100" : "hover:bg-slate-50"
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
