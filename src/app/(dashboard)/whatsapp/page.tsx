"use client";

import React, { useState, useEffect, useCallback } from "react";

interface GrupoWhatsApp {
  jid: string;
  nombre: string;
}

interface SalaJuego {
  id: string;
  nombre_sala: string;
  orden_sala?: number;
  hipodromo_activo?: string;
  numero_carrera_activa?: number;
  estado_carrera?: string;
  whatsapp_group_jid?: string | null;
}

interface StatusResponse {
  ok?: boolean;
  conectado: boolean;
  qrDataUrl: string | null;
  numeroVinculado: string | null;
  grupos: GrupoWhatsApp[];
  daemonOnline?: boolean;
  salas?: SalaJuego[];
}

export default function WhatsappPage() {
  const [status, setStatus] = useState<StatusResponse>({
    conectado: false,
    qrDataUrl: null,
    numeroVinculado: null,
    grupos: [],
    daemonOnline: false,
    salas: [],
  });
  const [cargandoStatus, setCargandoStatus] = useState(true);
  const [salas, setSalas] = useState<SalaJuego[]>([]);
  const [seleccionGrupoPorSala, setSeleccionGrupoPorSala] = useState<Record<string, string>>({});
  const [pizarraPorSala, setPizarraPorSala] = useState<Record<string, string>>({});
  const [procesandoAccion, setProcesandoAccion] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    tipo: "ok" | "error" | "info";
    texto: string;
    detalle?: string;
  } | null>(null);

  const consultarEstado = useCallback(async (silencioso = false) => {
    if (!silencioso) setCargandoStatus(true);
    try {
      const res = await fetch("/api/whatsapp-sala/status", { cache: "no-store" });
      if (!res.ok) return;
      const data: StatusResponse = await res.json();

      setStatus({
        conectado: Boolean(data.conectado),
        qrDataUrl: data.qrDataUrl || null,
        numeroVinculado: data.numeroVinculado || null,
        grupos: Array.isArray(data.grupos) ? data.grupos : [],
        daemonOnline: Boolean(data.daemonOnline),
      });

      if (Array.isArray(data.salas) && data.salas.length > 0) {
        setSalas(data.salas);
        setSeleccionGrupoPorSala((prev) => {
          const next = { ...prev };
          for (const s of data.salas!) {
            if (next[s.id] === undefined) {
              next[s.id] = s.whatsapp_group_jid || "";
            }
          }
          return next;
        });
      }
    } catch {
      // Continuar reintentando en el próximo ciclo
    } finally {
      if (!silencioso) setCargandoStatus(false);
    }
  }, []);

  useEffect(() => {
    consultarEstado(false);
    const timer = setInterval(() => {
      consultarEstado(true);
    }, 4000);
    return () => clearInterval(timer);
  }, [consultarEstado]);

  // Vincular con 1 clic un grupo de WhatsApp a una Sala (Sala 1 - Nacionales / Sala 2 - Americanas)
  const vincularGrupoASala = async (sala: SalaJuego, nuevoGroupJid: string) => {
    setSeleccionGrupoPorSala((prev) => ({ ...prev, [sala.id]: nuevoGroupJid }));
    setProcesandoAccion(`vincular-${sala.id}`);
    setFeedback(null);

    const grupoObj = status.grupos.find((g) => g.jid === nuevoGroupJid);

    try {
      const res = await fetch("/api/whatsapp-sala/procesar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accion: "vincular-sala",
          salaId: sala.id,
          groupJid: nuevoGroupJid || null,
          groupNombre: grupoObj?.nombre || null,
        }),
      });
      const json = await res.json();

      if (json.ok) {
        setSalas((prev) =>
          prev.map((s) =>
            s.id === sala.id ? { ...s, whatsapp_group_jid: nuevoGroupJid || null } : s
          )
        );
        setFeedback({
          tipo: "ok",
          texto: nuevoGroupJid
            ? `✅ ${sala.nombre_sala} vinculada exitosamente al grupo "${grupoObj?.nombre || nuevoGroupJid}".`
            : `ℹ️ Se desvinculó el grupo de WhatsApp de ${sala.nombre_sala}.`,
        });
      } else {
        setFeedback({
          tipo: "error",
          texto: json.error || "No se pudo guardar la vinculación de la sala.",
        });
      }
    } catch (err: any) {
      setFeedback({
        tipo: "error",
        texto: err?.message || "Error de red al vincular la sala.",
      });
    } finally {
      setProcesandoAccion(null);
    }
  };

  // Disparar manualmente: 📋 Publicar Plano de Jugadas
  const publicarPlanoJugadas = async (sala: SalaJuego) => {
    setProcesandoAccion(`plano-${sala.id}`);
    setFeedback(null);
    try {
      const res = await fetch("/api/whatsapp-sala/procesar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accion: "publicar-plano",
          salaId: sala.id,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setFeedback({
          tipo: "ok",
          texto: json.enviadoWhatsApp
            ? `📋 Plano de Jugadas enviado en vivo al grupo de WhatsApp (${sala.nombre_sala}).`
            : `📋 Plano de Jugadas generado (${sala.nombre_sala}). Conecta el bot o vincula un grupo para enviarlo en vivo.`,
          detalle: json.textoPlano,
        });
      } else {
        setFeedback({
          tipo: "error",
          texto: json.error || "No se pudo publicar el Plano de Jugadas.",
        });
      }
    } catch (err: any) {
      setFeedback({
        tipo: "error",
        texto: err?.message || "Error al publicar el Plano de Jugadas.",
      });
    } finally {
      setProcesandoAccion(null);
    }
  };

  // Disparar manualmente: 🏁 Publicar Sentencia / Pizarra
  const publicarSentenciaPizarra = async (sala: SalaJuego) => {
    const pizarra = (pizarraPorSala[sala.id] || "").trim();
    if (!pizarra) {
      setFeedback({
        tipo: "error",
        texto: `⚠️ Escribe el orden de llegada (ej. 10.5.1.2.7) antes de publicar la sentencia en ${sala.nombre_sala}.`,
      });
      return;
    }

    setProcesandoAccion(`sentencia-${sala.id}`);
    setFeedback(null);
    try {
      const res = await fetch("/api/whatsapp-sala/procesar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accion: "publicar-sentencia",
          salaId: sala.id,
          pizarra,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setFeedback({
          tipo: "ok",
          texto: json.enviadoWhatsApp
            ? `🏁 Sentencia / Pizarra (${pizarra}) liquidada y publicada en el grupo de WhatsApp.`
            : `🏁 Sentencia / Pizarra (${pizarra}) liquidada en Supabase.`,
          detalle: json.textoResultado,
        });
      } else {
        setFeedback({
          tipo: "error",
          texto: json.error || "No se pudo ejecutar la sentencia de la carrera.",
        });
      }
    } catch (err: any) {
      setFeedback({
        tipo: "error",
        texto: err?.message || "Error al publicar la sentencia.",
      });
    } finally {
      setProcesandoAccion(null);
    }
  };

  const etiquetaSala = (sala: SalaJuego, index: number) => {
    if (index === 0) return "Sala 1 - Nacionales";
    if (index === 1) return "Sala 2 - Americanas";
    return sala.nombre_sala || `Sala ${index + 1}`;
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-20">
      {/* ENCABEZADO Y ESTADO DE CONEXIÓN */}
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-950 p-5 text-white shadow-lg">
        <div>
          <h1 className="text-lg font-black uppercase tracking-wide text-white flex items-center gap-2">
            <span className="text-emerald-400">💬</span> Motor Bot de WhatsApp en Vivo (Baileys 24/7)
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            Escanea el código QR, vincula tus grupos de WhatsApp a las Salas de Juego y dispara el Plano de Jugadas o la Sentencia Oficial.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {status.conectado ? (
            <div className="flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-950/80 px-4 py-2 text-xs font-black text-emerald-300 shadow">
              <span>🟢 Conectado</span>
              {status.numeroVinculado && (
                <span className="font-mono text-[11px] text-emerald-200">
                  (+{status.numeroVinculado})
                </span>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-950/80 px-4 py-2 text-xs font-black text-amber-300">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-400 animate-pulse" />
              <span>{status.qrDataUrl ? "Esperando Escaneo QR" : "Desconectado"}</span>
            </div>
          )}

          <button
            type="button"
            onClick={() => consultarEstado(false)}
            disabled={cargandoStatus}
            className="rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-bold text-slate-200 hover:bg-slate-800 disabled:opacity-50 transition"
          >
            {cargandoStatus ? "Actualizando…" : "⟳ Refrescar"}
          </button>
        </div>
      </header>

      {/* SECCIÓN 1: CÓDIGO QR EN VIVO Y ESTADO */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-800 bg-slate-950 p-6 text-center text-white shadow-lg">
          <h2 className="text-xs font-black uppercase tracking-wider text-emerald-400 mb-3">
            1. Vinculación por Código QR
          </h2>

          {status.conectado ? (
            <div className="flex flex-col items-center justify-center space-y-3 py-6">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/20 border-2 border-emerald-400 text-4xl">
                🟢
              </div>
              <p className="text-base font-black text-emerald-400">🟢 Conectado</p>
              <p className="text-xs text-slate-300">
                Sesión activa 24/7 en{" "}
                <code className="rounded bg-slate-900 px-1.5 py-0.5 text-emerald-300">
                  /root/sistema_hipico/whatsapp_auth
                </code>
              </p>
              {status.numeroVinculado && (
                <span className="rounded-lg bg-slate-900 px-3 py-1 font-mono text-xs font-bold text-slate-200 border border-slate-800">
                  Número: +{status.numeroVinculado}
                </span>
              )}
              <span className="text-[11px] text-slate-400">
                Grupos detectados: <strong className="text-white">{status.grupos.length}</strong>
              </span>
            </div>
          ) : status.qrDataUrl ? (
            <div className="flex flex-col items-center space-y-3">
              <div className="rounded-2xl bg-white p-3 shadow-xl">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={status.qrDataUrl}
                  alt="Código QR de WhatsApp"
                  className="h-56 w-56 object-contain"
                />
              </div>
              <p className="text-xs font-semibold text-slate-300">
                Abre WhatsApp en tu teléfono → <strong>Dispositivos vinculados</strong> →{" "}
                <strong>Vincular un dispositivo</strong> y escanea este QR.
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center space-y-3 py-8 text-slate-400">
              <div className="h-12 w-12 rounded-full border-2 border-dashed border-slate-600 flex items-center justify-center text-xl">
                📱
              </div>
              <p className="text-xs font-bold text-slate-300">
                {status.daemonOnline
                  ? "Generando código QR desde Baileys…"
                  : "Servicio bot-whatsapp-server.mjs en espera (Puerto 3005)"}
              </p>
              <p className="text-[11px] text-slate-500 max-w-xs">
                Ejecuta <code className="text-emerald-400">node bot-whatsapp-server.mjs</code> en el
                servidor para iniciar el demonio 24/7 en el puerto 3005.
              </p>
            </div>
          )}
        </div>

        {/* SECCIÓN 2: VINCULACIÓN DE GRUPOS A SALAS Y BOTONES RÁPIDOS */}
        <div className="lg:col-span-2 space-y-4">
          {salas.map((sala, index) => {
            const tituloSala = etiquetaSala(sala, index);
            const jidActual = seleccionGrupoPorSala[sala.id] ?? sala.whatsapp_group_jid ?? "";
            const pizarraValor = pizarraPorSala[sala.id] ?? "";

            return (
              <div
                key={sala.id}
                className="rounded-2xl border border-slate-800 bg-slate-950 p-5 text-white shadow-lg space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2.5">
                    <span className="rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-2.5 py-1 text-xs font-black text-emerald-300">
                      {tituloSala}
                    </span>
                    <span className="text-xs font-bold text-slate-300">
                      {sala.hipodromo_activo || "HIPÓDROMO"} · Carrera #{sala.numero_carrera_activa || 1}
                    </span>
                  </div>

                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase ${
                      String(sala.estado_carrera || "").toLowerCase() === "abierta"
                        ? "bg-emerald-950 text-emerald-300 border border-emerald-600/50"
                        : "bg-amber-950 text-amber-300 border border-amber-600/50"
                    }`}
                  >
                    ● {sala.estado_carrera || "ABIERTA"}
                  </span>
                </div>

                {/* Selector desplegable de grupo de WhatsApp con vinculación en 1 clic */}
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Grupo de WhatsApp vinculado a {tituloSala}:
                  </label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <select
                      value={jidActual}
                      onChange={(e) => vincularGrupoASala(sala, e.target.value)}
                      disabled={procesandoAccion === `vincular-${sala.id}`}
                      className="flex-1 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-xs font-bold text-white outline-none focus:border-emerald-500"
                    >
                      <option value="">— Seleccionar grupo de WhatsApp para vincular —</option>
                      {status.grupos.map((g) => (
                        <option key={g.jid} value={g.jid}>
                          {g.nombre} ({g.jid})
                        </option>
                      ))}
                      {jidActual && !status.grupos.some((g) => g.jid === jidActual) && (
                        <option value={jidActual}>Grupo vinculado actual ({jidActual})</option>
                      )}
                    </select>

                    <button
                      type="button"
                      onClick={() => vincularGrupoASala(sala, jidActual)}
                      disabled={procesandoAccion === `vincular-${sala.id}`}
                      className="rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-4 py-2.5 text-xs font-black text-white transition shadow"
                    >
                      {procesandoAccion === `vincular-${sala.id}` ? "Vinculando…" : "🔗 Vincular Sala"}
                    </button>
                  </div>
                </div>

                {/* Botones rápidos para disparar manualmente al grupo de WhatsApp */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-slate-800/80">
                  {/* Botón 1: Publicar Plano de Jugadas */}
                  <div className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-900/70 p-3 space-y-2">
                    <span className="text-[11px] font-bold text-slate-300">
                      Publicar lista numerada de tickets activos en el grupo:
                    </span>
                    <button
                      type="button"
                      onClick={() => publicarPlanoJugadas(sala)}
                      disabled={procesandoAccion === `plano-${sala.id}`}
                      className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-4 py-2.5 text-xs font-black text-white transition shadow flex items-center justify-center gap-2"
                    >
                      <span>📋 Publicar Plano de Jugadas</span>
                    </button>
                  </div>

                  {/* Botón 2: Publicar Sentencia / LLEGADA */}
                  <div className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-900/70 p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={pizarraValor}
                        onChange={(e) =>
                          setPizarraPorSala((prev) => ({ ...prev, [sala.id]: e.target.value }))
                        }
                        placeholder="LLEGADA ej: 10.5.1.2.7"
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-mono font-bold text-emerald-300 placeholder-slate-500 outline-none focus:border-emerald-500"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => publicarSentenciaPizarra(sala)}
                      disabled={procesandoAccion === `sentencia-${sala.id}`}
                      className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-4 py-2.5 text-xs font-black text-white transition shadow flex items-center justify-center gap-2"
                    >
                      <span>🏁 Publicar LLEGADA / Pizarra</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* PANEL DE CONFIRMACIÓN Y PREVISUALIZACIÓN DE MENSAJE DISPARADO */}
      {feedback && (
        <section
          className={`rounded-2xl border p-4 text-xs shadow-lg ${
            feedback.tipo === "ok"
              ? "border-emerald-500/50 bg-emerald-950/60 text-emerald-100"
              : feedback.tipo === "error"
              ? "border-rose-500/50 bg-rose-950/60 text-rose-100"
              : "border-slate-700 bg-slate-900 text-slate-200"
          }`}
        >
          <p className="font-black text-sm">{feedback.texto}</p>
          {feedback.detalle && (
            <pre className="mt-3 whitespace-pre-wrap rounded-xl border border-black/30 bg-black/40 p-3 font-mono text-xs text-slate-200">
              {feedback.detalle}
            </pre>
          )}
        </section>
      )}

      {/* GUÍA RÁPIDA DE COMANDOS DE OPERADOR DESDE WHATSAPP */}
      <section className="rounded-2xl border border-slate-800 bg-slate-950 p-5 text-white shadow">
        <h3 className="text-xs font-black uppercase tracking-wider text-emerald-400 mb-3">
          ⚡ Comandos Directos del Operador dentro del Grupo de WhatsApp
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
            <code className="font-mono font-black text-emerald-300">!abrir [hipodromo] [carrera]</code>
            <p className="mt-1 text-[11px] text-slate-400">
              Abre la carrera directamente en el grupo. Ej: <code className="text-white">!abrir La Rinconada 1</code> o <code className="text-white">!abrir Gulfstream 4</code>.
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
            <code className="font-mono font-black text-rose-300">!cerrar</code>
            <p className="mt-1 text-[11px] text-slate-400">
              Cierra la carrera para bloquear nuevas jugadas. También responde a <code className="text-white">cerrada</code>.
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
            <code className="font-mono font-black text-indigo-300">LLEGADA: 10.5.1.2.7</code>
            <p className="mt-1 text-[11px] text-slate-400">
              Liquida oficialmente la carrera, actualiza saldos y publica POSITIVOS (+) y NEGATIVOS (-).
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
            <code className="font-mono font-black text-amber-300">!plano</code> / <code className="font-mono font-black text-amber-300">!anular</code>
            <p className="mt-1 text-[11px] text-slate-400">
              Publica el plano numerado de jugadas activas o anula tickets/retirados en vivo.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
