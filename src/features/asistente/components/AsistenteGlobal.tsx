"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/core/supabase";
import { leerCarrerasDeInteligencia } from "@/features/inteligencia/lib/datos";
import { fechaJornadaCaracas } from "@/core/utils/fechas";
import {
  esConsultaDeCarreras,
  fechaSolicitada,
  rutaSugeridaAutorizada,
  rutasDisponiblesPara,
  resumirCarreras,
} from "@/features/asistente/lib/contrato";
import { useAuthStore } from "@/shared/store/useAuthStore";

type Mensaje = {
  id: number;
  rol: "user" | "assistant";
  texto: string;
  ruta?: string | null;
};

const SUGERENCIAS = [
  "¿Qué módulos tengo disponibles?",
  "¿Qué carreras hay hoy?",
  "Ayúdame a encontrar un módulo",
];

export function AsistenteGlobal() {
  const router = useRouter();
  const permisos = useAuthStore((estado) => estado.permisos);
  const rutas = useMemo(() => rutasDisponiblesPara(permisos), [permisos]);
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);

  async function enviar(evento?: FormEvent, sugerencia?: string) {
    evento?.preventDefault();
    const consulta = (sugerencia ?? texto).trim();
    if (!consulta || cargando) return;
    setTexto("");
    setError(null);
    setCargando(true);
    const id = Date.now();
    setMensajes((actuales) => [...actuales, { id, rol: "user", texto: consulta }]);

    try {
      if (!supabase) throw new Error("La conexión con la plataforma no está configurada.");
      let carreras: ReturnType<typeof resumirCarreras> = [];
      if (
        esConsultaDeCarreras(consulta) &&
        rutas.some((ruta) => ruta.ruta === "/carreras" || ruta.ruta.includes("inteligencia-hipica"))
      ) {
        const hoy = fechaJornadaCaracas();
        const fecha = fechaSolicitada(consulta, hoy);
        const resultado = await leerCarrerasDeInteligencia(fecha);
        if (!resultado.ok) throw new Error(resultado.error || "No se pudieron consultar las carreras.");
        carreras = resumirCarreras(resultado.carreras);
      }

      const { data, error: errorFuncion } = await supabase.functions.invoke("asistente-plataforma", {
        body: {
          mensaje: consulta,
          historial: mensajes.slice(-8).map(({ rol, texto }) => ({ rol, texto })),
          rutas: rutas.map(({ ruta, nombre }) => ({ ruta, nombre })),
          carreras,
        },
      });
      if (errorFuncion) throw new Error(errorFuncion.message || "No se pudo contactar al asistente.");
      if (!data || typeof data.answer !== "string" || !data.answer.trim()) {
        throw new Error("El asistente devolvió una respuesta no válida.");
      }

      setMensajes((actuales) => [
        ...actuales,
        {
          id: id + 1,
          rol: "assistant",
          texto: data.answer,
          ruta: rutaSugeridaAutorizada(data.navigateTo, rutas),
        },
      ]);
    } catch (causa) {
      setError(causa instanceof Error ? causa.message : "Ocurrió un error al consultar al asistente.");
    } finally {
      setCargando(false);
    }
  }

  function abrirRuta(ruta: string) {
    const autorizada = rutaSugeridaAutorizada(ruta, rutas);
    if (!autorizada) return;
    setAbierto(false);
    router.push(autorizada);
  }

  return (
    <div className="fixed bottom-5 right-5 z-[80]">
      {abierto && (
        <section
          aria-label="Asistente de la plataforma"
          className="mb-3 flex h-[min(34rem,calc(100dvh-7rem))] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl"
        >
          <header className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="rounded-lg bg-cyan-400/10 p-2 text-cyan-300">
                <span aria-hidden="true">IA</span>
              </span>
              <div>
                <h2 className="text-sm font-semibold">Asistente de la plataforma</h2>
                <p className="text-xs text-slate-400">Ayuda y consultas según tus permisos</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setAbierto(false)}
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
              aria-label="Cerrar asistente"
            >
              <span aria-hidden="true">×</span>
            </button>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
            {mensajes.length === 0 && (
              <div className="rounded-xl border border-slate-700 bg-slate-800/70 p-4">
                <div className="mb-2 flex items-center gap-2 text-cyan-300">
                  <span aria-hidden="true">✦</span>
                  <span className="text-sm font-medium">¿En qué te ayudo?</span>
                </div>
                <p className="mb-3 text-xs leading-relaxed text-slate-400">
                  Puedo orientarte y consultar carreras a las que tengas acceso. En esta primera versión
                  no ejecuto cambios, pagos ni cierres.
                </p>
                <div className="flex flex-col gap-2">
                  {SUGERENCIAS.map((sugerencia) => (
                    <button
                      key={sugerencia}
                      type="button"
                      onClick={() => void enviar(undefined, sugerencia)}
                      disabled={cargando}
                      className="rounded-lg border border-slate-700 px-3 py-2 text-left text-xs text-slate-300 hover:border-cyan-500/60 hover:bg-slate-800 disabled:opacity-50"
                    >
                      {sugerencia}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {mensajes.map((mensaje) => (
              <div
                key={mensaje.id}
                className={`max-w-[92%] rounded-xl px-3 py-2.5 text-sm leading-relaxed ${
                  mensaje.rol === "user"
                    ? "ml-auto bg-cyan-500/15 text-cyan-50"
                    : "mr-auto border border-slate-700 bg-slate-800 text-slate-200"
                }`}
              >
                <p className="whitespace-pre-wrap">{mensaje.texto}</p>
                {mensaje.ruta && (
                  <button
                    type="button"
                    onClick={() => {
                      if (mensaje.ruta) abrirRuta(mensaje.ruta);
                    }}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-amber-300 hover:text-amber-200"
                  >
                    Abrir módulo <span aria-hidden="true">↗</span>
                  </button>
                )}
              </div>
            ))}
            {cargando && (
              <div className="flex items-center gap-2 text-xs text-slate-400" role="status">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-500 border-t-cyan-300" aria-hidden="true" />
                Consultando con acceso limitado a tus permisos…
              </div>
            )}
            {error && (
              <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200" role="alert">
                {error}
              </p>
            )}
          </div>

          <form onSubmit={(evento) => void enviar(evento)} className="border-t border-slate-700 p-3">
            <label className="sr-only" htmlFor="asistente-mensaje">Escribe tu consulta</label>
            <div className="flex items-end gap-2 rounded-xl border border-slate-700 bg-slate-800 p-2 focus-within:border-cyan-500/70">
              <textarea
                id="asistente-mensaje"
                value={texto}
                onChange={(evento) => setTexto(evento.target.value)}
                onKeyDown={(evento) => {
                  if (evento.key === "Enter" && !evento.shiftKey) {
                    evento.preventDefault();
                    void enviar();
                  }
                }}
                maxLength={4000}
                rows={1}
                placeholder="Escribe una consulta…"
                className="max-h-24 min-h-9 flex-1 resize-y bg-transparent px-1 py-2 text-sm text-white outline-none placeholder:text-slate-500"
              />
              <button
                type="submit"
                disabled={cargando || !texto.trim()}
                aria-label="Enviar consulta"
                className="rounded-lg bg-cyan-500 p-2 text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span aria-hidden="true">➤</span>
              </button>
            </div>
          </form>
        </section>
      )}
      <button
        type="button"
        onClick={() => setAbierto((actual) => !actual)}
        aria-expanded={abierto}
        aria-label={abierto ? "Cerrar asistente" : "Abrir asistente de la plataforma"}
        className="ml-auto flex h-14 w-14 items-center justify-center rounded-full border border-cyan-300/30 bg-slate-900 text-cyan-300 shadow-xl transition hover:scale-105 hover:bg-slate-800"
      >
        {abierto ? <span aria-hidden="true">×</span> : <span aria-hidden="true">IA</span>}
      </button>
    </div>
  );
}
