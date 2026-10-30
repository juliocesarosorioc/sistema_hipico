"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { transcribirArchivoAudioConIA } from "@/features/carreras/lib/audio-carrera";
import { emitirToast } from "@/shared/lib/mensajeria";

type InstanciaReconocimientoVoz = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives?: number;
  onresult: ((ev: {
    resultIndex: number;
    results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
  }) => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onend: (() => void) | null;
  onstart?: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
};

type ConstructorReconocimientoVoz = new () => InstanciaReconocimientoVoz;

type Props = {
  /** Se dispara cuando hay texto reconocido (por micrófono o por archivo de audio). */
  onTextoReconocido: (texto: string) => void;
  /** Etiqueta del botón principal. */
  etiqueta?: string;
  /** Modo para transcripción de archivos de audio ("carrera" | "jugadas"). */
  modo?: "carrera" | "jugadas";
  /** Mostrar también el botón compacto para adjuntar nota de voz / audio del celular. */
  permitirArchivoAudio?: boolean;
  /** Clases extra para el contenedor. */
  className?: string;
  /** Tamaño visual. */
  compacto?: boolean;
};

function detectarIdiomaVoz(): string {
  if (typeof navigator !== "undefined") {
    const userLang = navigator.language || (navigator.languages && navigator.languages[0]);
    if (userLang && userLang.toLowerCase().startsWith("es")) {
      return userLang;
    }
  }
  return "es-419";
}

/**
 * Botón de dictado por voz en vivo y audio optimizado para celulares (Android/iOS) y escritorio.
 * Garantiza que todo lo dictado (tanto segmentos finales como interinos) se entregue fielmente al parar.
 */
export function BotonDictadoAudio({
  onTextoReconocido,
  etiqueta = "🎙️ Dictar por Audio",
  modo = "carrera",
  permitirArchivoAudio = true,
  className = "",
  compacto = false,
}: Props) {
  const [escuchando, setEscuchando] = useState(false);
  const [transcribiendoArchivo, setTranscribiendoArchivo] = useState(false);
  const [parcial, setParcial] = useState("");
  const [modalManual, setModalManual] = useState(false);
  const [textoManual, setTextoManual] = useState("");

  const recRef = useRef<InstanciaReconocimientoVoz | null>(null);
  const inputAudioRef = useRef<HTMLInputElement | null>(null);

  const transcripcionFinalRef = useRef<string>("");
  const transcripcionInterinaRef = useRef<string>("");
  const entregadoRef = useRef<string>("");

  useEffect(() => {
    return () => {
      try {
        recRef.current?.stop();
      } catch {
        /* ignore */
      }
    };
  }, []);

  const emitirTextoReconocido = useCallback(
    (txt: string) => {
      const limpio = txt.trim();
      if (!limpio) return;
      if (limpio === entregadoRef.current) return;
      entregadoRef.current = limpio;
      onTextoReconocido(limpio);
      emitirToast(`🎙️ Transcrito: "${limpio}"`, "info");
    },
    [onTextoReconocido]
  );

  const alternarDictado = useCallback(() => {
    if (escuchando) {
      // Al parar manualmente, entregar inmediatamente todo lo hablado (final + interino)
      const total = `${transcripcionFinalRef.current} ${transcripcionInterinaRef.current}`.trim();
      if (total) {
        emitirTextoReconocido(total);
      }
      try {
        recRef.current?.stop();
      } catch {
        /* ignore */
      }
      setEscuchando(false);
      setParcial("");
      return;
    }

    if (typeof window === "undefined") return;
    const w = window as unknown as {
      SpeechRecognition?: ConstructorReconocimientoVoz;
      webkitSpeechRecognition?: ConstructorReconocimientoVoz;
    };
    const SpeechRec = w.SpeechRecognition || w.webkitSpeechRecognition;

    if (!SpeechRec) {
      // Si el navegador no soporta Web Speech API (ej. Firefox o HTTP sin SSL), abrimos el modal asistido
      setModalManual(true);
      return;
    }

    try {
      const rec = new SpeechRec();
      rec.lang = detectarIdiomaVoz();
      const esMovil =
        typeof navigator !== "undefined" &&
        /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
      rec.continuous = !esMovil;
      rec.interimResults = true;
      if ("maxAlternatives" in rec) rec.maxAlternatives = 1;

      transcripcionFinalRef.current = "";
      transcripcionInterinaRef.current = "";
      entregadoRef.current = "";
      setParcial("");

      rec.onstart = () => {
        setEscuchando(true);
      };

      rec.onresult = (ev) => {
        let finalActual = "";
        let interinoActual = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const item = ev.results[i];
          const txt = item?.[0]?.transcript ?? "";
          if (item.isFinal) {
            finalActual += txt + " ";
          } else {
            interinoActual += txt;
          }
        }

        if (finalActual) {
          transcripcionFinalRef.current = `${transcripcionFinalRef.current} ${finalActual}`.trim();
        }
        transcripcionInterinaRef.current = interinoActual.trim();

        const combinado = `${transcripcionFinalRef.current} ${transcripcionInterinaRef.current}`.trim();
        setParcial(combinado);
      };

      rec.onerror = (ev) => {
        const err = ev?.error || "desconocido";
        const total = `${transcripcionFinalRef.current} ${transcripcionInterinaRef.current}`.trim();
        if (total) {
          emitirTextoReconocido(total);
        }
        setEscuchando(false);
        setParcial("");

        if (err === "no-speech") {
          emitirToast("No se detectó voz. Habla cerca del micrófono del celular.", "info");
        } else if (err === "not-allowed" || err === "service-not-allowed") {
          emitirToast("Permiso de micrófono bloqueado. Habilita el micrófono en tu navegador.", "warning");
        } else if (err === "network") {
          emitirToast("Error de conexión al servicio de voz. Revisa tu internet o usa nota de audio.", "warning");
        } else if (err === "audio-capture") {
          emitirToast("No se encontró ningún micrófono disponible.", "warning");
        }
      };

      rec.onend = () => {
        const total = `${transcripcionFinalRef.current} ${transcripcionInterinaRef.current}`.trim();
        if (total) {
          emitirTextoReconocido(total);
        }
        setEscuchando(false);
        setParcial("");
      };

      recRef.current = rec;
      rec.start();
      setEscuchando(true);
    } catch {
      setEscuchando(false);
      emitirToast("No se pudo iniciar el micrófono. Verifica los permisos de audio en tu celular.", "warning");
    }
  }, [escuchando, emitirTextoReconocido]);

  const manejarArchivoAudio = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setTranscribiendoArchivo(true);
    const res = await transcribirArchivoAudioConIA(file, modo);
    setTranscribiendoArchivo(false);
    if (!res.ok) {
      emitirToast(res.error ?? "No se pudo interpretar el audio.", "warning");
      return;
    }
    emitirTextoReconocido(res.texto);
    emitirToast("🎧 Audio interpretado correctamente.", "success");
  };

  const aplicarManual = () => {
    const txt = textoManual.trim();
    if (!txt) return;
    emitirTextoReconocido(txt);
    setTextoManual("");
    setModalManual(false);
  };

  return (
    <>
      <div className={`inline-flex flex-wrap items-center gap-1.5 ${className}`}>
        <button
          type="button"
          onClick={alternarDictado}
          disabled={transcribiendoArchivo}
          title={
            escuchando
              ? "Detener dictado por voz (toca para procesar lo hablado)"
              : "Dictar por micrófono desde el celular o PC (interpreta números, carreras, ejemplares y jugadas)"
          }
          className={`inline-flex items-center gap-1.5 rounded-lg border font-black uppercase tracking-wide shadow-sm transition active:scale-95 ${
            compacto ? "px-2.5 py-1 text-[10px]" : "px-3 py-1.5 text-xs"
          } ${
            escuchando
              ? "animate-pulse border-red-400 bg-red-600 text-white ring-2 ring-red-400/50"
              : "border-rose-400/70 bg-gradient-to-r from-rose-600 to-pink-600 text-white hover:from-rose-500 hover:to-pink-500"
          }`}
        >
          <span>{escuchando ? "⏹️" : "🎙️"}</span>
          <span>{escuchando ? "Escuchando… (Toca para aplicar)" : etiqueta}</span>
        </button>

        {permitirArchivoAudio && (
          <>
            <input
              ref={inputAudioRef}
              type="file"
              accept="audio/*"
              onChange={(e) => void manejarArchivoAudio(e)}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => inputAudioRef.current?.click()}
              disabled={transcribiendoArchivo || escuchando}
              title="Subir nota de voz de WhatsApp o audio grabado desde el celular"
              className={`inline-flex items-center gap-1 rounded-lg border border-indigo-300 bg-indigo-50 font-black uppercase tracking-wide text-indigo-800 shadow-2xs transition hover:bg-indigo-100 active:scale-95 disabled:opacity-50 ${
                compacto ? "px-2 py-1 text-[10px]" : "px-2.5 py-1.5 text-[11px]"
              }`}
            >
              <span>{transcribiendoArchivo ? "⏳" : "🎧"}</span>
              <span>{transcribiendoArchivo ? "Interpretando…" : "Audio"}</span>
            </button>
          </>
        )}

        {(escuchando || parcial) && (
          <span className="inline-flex max-w-xs items-center gap-1.5 truncate rounded-full border border-red-300 bg-red-50 px-2.5 py-0.5 text-[11px] font-bold text-red-700 shadow-xs">
            <span className="h-2 w-2 shrink-0 rounded-full bg-red-600 animate-ping" />
            <span className="truncate">{parcial || "Habla ahora..."}</span>
          </span>
        )}
      </div>

      {/* Modal fallback para navegadores o entornos donde el micrófono directo no esté activo */}
      {modalManual && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="text-sm font-black uppercase tracking-wider text-slate-800 flex items-center gap-2">
                <span>🎙️</span>
                <span>Dictado o Texto Rápido</span>
              </h3>
              <button
                type="button"
                onClick={() => setModalManual(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Dicta usando el <b>micrófono de tu teclado del celular</b> (icono 🎙️ en la barra espaciadora) o pega el texto:
            </p>

            <textarea
              value={textoManual}
              onChange={(e) => setTextoManual(e.target.value)}
              placeholder="Ejemplo: Carrera 3 con 12 ejemplares 1600 metros arena"
              rows={4}
              autoFocus
              className="w-full rounded-xl border border-slate-300 bg-slate-50 p-3 text-xs font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-rose-500"
            />

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setModalManual(false)}
                className="rounded-lg px-3 py-1.5 text-xs font-bold text-slate-500 hover:bg-slate-100"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={aplicarManual}
                disabled={!textoManual.trim()}
                className="rounded-lg bg-rose-600 px-4 py-1.5 text-xs font-black uppercase text-white shadow hover:bg-rose-700 disabled:opacity-50"
              >
                Aplicar Dictado
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default BotonDictadoAudio;
