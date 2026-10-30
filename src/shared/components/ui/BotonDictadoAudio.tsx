"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { transcribirArchivoAudioConIA } from "@/features/carreras/lib/audio-carrera";
import { emitirToast } from "@/shared/lib/mensajeria";

type InstanciaReconocimientoVoz = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: {
    resultIndex: number;
    results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
  }) => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type ConstructorReconocimientoVoz = new () => InstanciaReconocimientoVoz;

type Props = {
  /** Se dispara cuando hay texto final reconocido (por micrófono o por archivo de audio). */
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

/**
 * Botón reutilizable de dictado por voz en vivo + interpretación de archivo de audio
 * optimizado para celulares (Android / iOS) y escritorio.
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
  const recRef = useRef<InstanciaReconocimientoVoz | null>(null);
  const inputAudioRef = useRef<HTMLInputElement | null>(null);
  const acumuladoRef = useRef<string>("");

  useEffect(() => {
    return () => {
      try {
        recRef.current?.stop();
      } catch {
        /* ignore */
      }
    };
  }, []);

  const alternarDictado = useCallback(() => {
    if (escuchando) {
      try {
        recRef.current?.stop();
      } catch {
        /* ignore */
      }
      setEscuchando(false);
      return;
    }

    if (typeof window === "undefined") return;
    const w = window as unknown as {
      SpeechRecognition?: ConstructorReconocimientoVoz;
      webkitSpeechRecognition?: ConstructorReconocimientoVoz;
    };
    const SpeechRec = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SpeechRec) {
      if (permitirArchivoAudio && inputAudioRef.current) {
        inputAudioRef.current.click();
      } else {
        emitirToast("Tu navegador no soporta dictado directo. Usa Chrome/Safari o sube una nota de voz.", "warning");
      }
      return;
    }

    try {
      const rec = new SpeechRec();
      rec.lang = "es-VE";
      rec.continuous = true;
      rec.interimResults = true;
      acumuladoRef.current = "";
      setParcial("");

      rec.onresult = (ev) => {
        let nuevoFinal = "";
        let nuevoInterino = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const item = ev.results[i];
          const txt = item?.[0]?.transcript ?? "";
          if (item.isFinal) {
            nuevoFinal += txt + " ";
          } else {
            nuevoInterino += txt;
          }
        }
        if (nuevoFinal.trim()) {
          acumuladoRef.current = `${acumuladoRef.current} ${nuevoFinal}`.trim();
          onTextoReconocido(nuevoFinal.trim());
        }
        setParcial(nuevoInterino.trim());
      };

      rec.onerror = () => {
        setEscuchando(false);
        setParcial("");
      };

      rec.onend = () => {
        setEscuchando(false);
        setParcial("");
      };

      recRef.current = rec;
      rec.start();
      setEscuchando(true);
    } catch {
      setEscuchando(false);
      emitirToast("No se pudo iniciar el micrófono. Verifica el permiso de audio en tu celular.", "warning");
    }
  }, [escuchando, onTextoReconocido, permitirArchivoAudio]);

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
    onTextoReconocido(res.texto);
    emitirToast("🎧 Audio interpretado correctamente.", "success");
  };

  return (
    <div className={`inline-flex flex-wrap items-center gap-1.5 ${className}`}>
      <button
        type="button"
        onClick={alternarDictado}
        disabled={transcribiendoArchivo}
        title={
          escuchando
            ? "Detener dictado por voz (toca para finalizar)"
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
        <span>{escuchando ? "Escuchando… (Toca para parar)" : etiqueta}</span>
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
            title="Subir o grabar nota de voz / archivo de audio desde el celular"
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
        <span className="inline-flex max-w-xs items-center gap-1.5 truncate rounded-full border border-red-300 bg-red-50 px-2.5 py-0.5 text-[11px] font-bold text-red-700">
          <span className="h-2 w-2 shrink-0 rounded-full bg-red-600 animate-ping" />
          <span className="truncate">{parcial || "Habla ahora…"}</span>
        </span>
      )}
    </div>
  );
}

export default BotonDictadoAudio;
