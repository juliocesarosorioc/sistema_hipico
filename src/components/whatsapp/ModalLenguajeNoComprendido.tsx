"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";

type Revision = {
  id: string;
  usuario_nombre: string;
  mensaje_usuario_original: string;
  jugada_corregida_sugerida: string;
  motivo_rechazo: string;
  intencion_detectada: string;
  respuesta_ia_enviada: string;
  nivel_confianza: number;
  estado: string;
  created_at: string | null;
};

type Aprendido = {
  id: string;
  termino_original: string;
  jugada_corregida: string;
  intencion_detectada: string;
  motivo_rechazo: string;
  nivel_confianza: number;
  created_at: string | null;
};

type Semilla = {
  termino_original: string;
  jugada_corregida: string;
  intencion_detectada: string;
  motivo_rechazo: string;
  nivel_confianza: number;
};

type Edicion = Record<string, { corregida: string; intencion: string }>;

type Props = {
  open: boolean;
  onClose: () => void;
  grupoId: string;
  salaId?: string | null;
};

export default function ModalLenguajeNoComprendido({
  open,
  onClose,
  grupoId,
  salaId = null,
}: Props) {
  const [revisiones, setRevisiones] = useState<Revision[]>([]);
  const [aprendido, setAprendido] = useState<Aprendido[]>([]);
  const [semilla, setSemilla] = useState<Semilla[]>([]);
  const [edicion, setEdicion] = useState<Edicion>({});
  const [cargando, setCargando] = useState(false);
  const [procesando, setProcesando] = useState<string | null>(null);
  const [estado, setEstado] = useState<string>("");

  const cargar = useCallback(async () => {
    if (!open || !grupoId) return;
    setCargando(true);
    setEstado("");
    try {
      const res = await fetch(
        `/api/whatsapp-sala/lenguaje?grupo_id=${encodeURIComponent(grupoId)}`,
        { cache: "no-store" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error || "No se pudo cargar");
      const filas: Revision[] = Array.isArray(data.revisiones) ? data.revisiones : [];
      setRevisiones(filas);
      setAprendido(Array.isArray(data.aprendido) ? data.aprendido : []);
      setSemilla(Array.isArray(data.semilla) ? data.semilla : []);
      setEdicion(
        Object.fromEntries(
          filas.map((r) => [
            r.id,
            {
              corregida: r.jugada_corregida_sugerida || "",
              intencion: r.intencion_detectada || "LENGUAJE_ENSENADO",
            },
          ])
        )
      );
    } catch (err: any) {
      setEstado(err?.message || "No se pudo cargar el lenguaje del bot");
    } finally {
      setCargando(false);
    }
  }, [open, grupoId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const pendientes = useMemo(
    () => revisiones.filter((r) => String(r.estado || "").toUpperCase() !== "DESCARTADO"),
    [revisiones]
  );

  async function enviar(accion: "ensenar" | "descartar" | "sembrar", fila?: Revision) {
    setProcesando(accion + (fila?.id || ""));
    setEstado("");
    try {
      const payload: Record<string, unknown> = { accion, grupo_id: grupoId, sala_id: salaId };
      if (fila) {
        const actual = edicion[fila.id] || {
          corregida: fila.jugada_corregida_sugerida || "",
          intencion: fila.intencion_detectada || "LENGUAJE_ENSENADO",
        };
        Object.assign(payload, {
          id: fila.id,
          usuario_id: fila.id,
          usuario_nombre: fila.usuario_nombre,
          termino_original: fila.mensaje_usuario_original,
          jugada_corregida: actual.corregida,
          intencion_detectada: actual.intencion,
          motivo_rechazo: fila.motivo_rechazo,
          nivel_confianza: fila.nivel_confianza,
        });
      }
      const res = await fetch("/api/whatsapp-sala/lenguaje", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error || "No se pudo guardar");
      setEstado(
        accion === "ensenar"
          ? "✅ Lenguaje enseñado al bot."
          : accion === "descartar"
          ? "🗑️ Registro descartado."
          : "🌱 Lenguaje humanizado inicial cargado."
      );
      await cargar();
    } catch (err: any) {
      setEstado(err?.message || "No se pudo guardar");
    } finally {
      setProcesando(null);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-slate-900/40 p-3 sm:p-6">
      <div className="my-2 w-full max-w-5xl rounded-3xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4">
          <div>
            <h2 className="text-sm font-black uppercase tracking-wide text-slate-900">
              🧠 Lenguaje que la plataforma no comprende
            </h2>
            <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-slate-600">
              Estudia lo que escribieron los jugadores, corrige la forma y enséñale al bot.
              Todo queda registrado en el diccionario de aprendizaje del grupo.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void enviar("sembrar")}
              disabled={Boolean(procesando)}
              className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] font-black text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
            >
              🌱 Cargar lenguaje inicial
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-black text-slate-600 transition hover:bg-slate-100"
            >
              ✕ Cerrar
            </button>
          </div>
        </div>

        <div className="max-h-[78vh] space-y-5 overflow-y-auto px-5 py-4">
          {estado && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-700">
              {estado}
            </div>
          )}

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-700">
                Casos detectados ({pendientes.length})
              </h3>
              <button
                type="button"
                onClick={() => void cargar()}
                disabled={cargando}
                className="text-[11px] font-bold text-emerald-700 underline disabled:opacity-40"
              >
                {cargando ? "Cargando…" : "Refrescar"}
              </button>
            </div>

            {pendientes.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-[11px] font-bold text-slate-500">
                No hay lenguaje pendiente por estudiar.
              </div>
            ) : (
              <div className="space-y-2">
                {pendientes.map((r) => {
                  const actual = edicion[r.id] || {
                    corregida: r.jugada_corregida_sugerida || "",
                    intencion: r.intencion_detectada || "LENGUAJE_ENSENADO",
                  };
                  return (
                    <article
                      key={r.id}
                      className="rounded-2xl border border-slate-200 bg-slate-50 p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[10px] font-black uppercase text-slate-500">
                            {r.usuario_nombre || "Jugador"} · {r.motivo_rechazo}
                          </p>
                          <p className="mt-0.5 break-words text-sm font-bold text-slate-900">
                            “{r.mensaje_usuario_original}”
                          </p>
                        </div>
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700">
                          Conf. {Math.round((r.nivel_confianza || 0) * 100)}%
                        </span>
                      </div>

                      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <input
                          value={actual.corregida}
                          onChange={(e) =>
                            setEdicion((prev) => ({
                              ...prev,
                              [r.id]: { ...actual, corregida: e.target.value },
                            }))
                          }
                          placeholder="Forma correcta que debe entender el bot"
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-emerald-500"
                        />
                        <input
                          value={actual.intencion}
                          onChange={(e) =>
                            setEdicion((prev) => ({
                              ...prev,
                              [r.id]: { ...actual, intencion: e.target.value },
                            }))
                          }
                          placeholder="Intención detectada"
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-emerald-500"
                        />
                      </div>

                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void enviar("ensenar", r)}
                          disabled={Boolean(procesando) || !actual.corregida.trim()}
                          className="rounded-xl bg-emerald-600 px-3 py-1.5 text-[11px] font-black text-white transition hover:bg-emerald-500 disabled:opacity-40"
                        >
                          🎓 Enseñar al bot
                        </button>
                        <button
                          type="button"
                          onClick={() => void enviar("descartar", r)}
                          disabled={Boolean(procesando)}
                          className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-[11px] font-black text-rose-700 transition hover:bg-rose-100 disabled:opacity-40"
                        >
                          Descartar
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-3">
              <h3 className="mb-2 text-[11px] font-black uppercase tracking-wider text-slate-700">
                Diccionario aprendido ({aprendido.length})
              </h3>
              <div className="space-y-1.5">
                {aprendido.length === 0 ? (
                  <p className="text-[11px] text-slate-500">Aún no hay términos enseñados.</p>
                ) : (
                  aprendido.map((a) => (
                    <div
                      key={a.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-2.5 py-1.5"
                    >
                      <span className="text-[11px] font-bold text-slate-800">
                        {a.termino_original}
                      </span>
                      <span className="text-[11px] font-black text-emerald-700">
                        → {a.jugada_corregida}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-3">
              <h3 className="mb-2 text-[11px] font-black uppercase tracking-wider text-slate-700">
                Data humanizada para estudiar ({semilla.length})
              </h3>
              <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
                {semilla.map((s, idx) => (
                  <div key={`${s.termino_original}-${idx}`} className="rounded-xl bg-slate-50 px-2.5 py-1.5">
                    <p className="text-[11px] font-bold text-slate-800">
                      {s.termino_original} <span className="text-emerald-700">→ {s.jugada_corregida}</span>
                    </p>
                    <p className="text-[10px] text-slate-500">
                      {s.intencion_detectada} · {s.motivo_rechazo}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
