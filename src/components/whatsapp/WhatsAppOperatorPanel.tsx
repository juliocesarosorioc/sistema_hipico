"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import QRCode from "react-qr-code";
import { PLANTILLAS_GRUPO_DEFAULT, PlantillaGrupoItem, aplicarVariablesPlantilla } from "@/features/whatsapp/lib/plantillas-grupo";

export interface WhatsAppOperatorPanelProps {
  grupo_id: string;
  className?: string;
}

type BotStatus = "connected" | "qr" | "disconnected" | "loading";
type TabType = "conexion" | "plantillas" | "control";

const CONTABO_IP = "80.190.77.210";
const BOT_SERVER_URL = process.env.NEXT_PUBLIC_BOT_URL || `http://${CONTABO_IP}:3005`;

export default function WhatsAppOperatorPanel({ grupo_id, className = "" }: WhatsAppOperatorPanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>("conexion");

  // Estado Conexión WhatsApp
  const [status, setStatus] = useState<BotStatus>("loading");
  const [qrValue, setQrValue] = useState<string | null>(null);
  const [numero, setNumero] = useState<string | null>(null);
  const [procesando, setProcesando] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [feedbackSuccess, setFeedbackSuccess] = useState<string | null>(null);
  const isMounted = useRef<boolean>(true);

  // Estado Plantillas (Tab 2)
  const [plantillas, setPlantillas] = useState<PlantillaGrupoItem[]>(PLANTILLAS_GRUPO_DEFAULT);
  const [plantillaSeleccionada, setPlantillaSeleccionada] = useState<string>("confirmacion_jugada");
  const [textoEditado, setTextoEditado] = useState<string>("");
  const [cargandoPlantillas, setCargandoPlantillas] = useState<boolean>(false);
  const [guardandoPlantilla, setGuardandoPlantilla] = useState<boolean>(false);
  const [modalPlantillaAbierto, setModalPlantillaAbierto] = useState<boolean>(false);

  // Estado Control de Salas (Tab 3)
  const [salas, setSalas] = useState<any[]>([]);
  const [salaSeleccionadaId, setSalaSeleccionadaId] = useState<string>("");
  const [hipodromoInput, setHipodromoInput] = useState<string>("LA RINCONADA");
  const [carreraInput, setCarreraInput] = useState<number>(1);
  const [pizarraInput, setPizarraInput] = useState<string>("");
  const [cargandoSalas, setCargandoSalas] = useState<boolean>(false);
  const [accionEnCurso, setAccionEnCurso] = useState<string | null>(null);

  // 1. Polling de Estado Bot
  const consultarEstado = useCallback(async () => {
    if (!grupo_id) return;
    try {
      let res: Response | null = null;
      try {
        res = await fetch(`${BOT_SERVER_URL}/api/whatsapp/status?session_id=${encodeURIComponent(grupo_id)}`, {
          cache: "no-store",
        });
      } catch {
        res = await fetch(`/api/whatsapp/status?session_id=${encodeURIComponent(grupo_id)}`, {
          cache: "no-store",
        });
      }

      if (!isMounted.current) return;

      if (res && res.ok) {
        const data = await res.json();
        const rawStatus = String(data?.status || "").toLowerCase();
        const conectado = Boolean(data?.conectado || rawStatus === "connected" || rawStatus === "open");
        const qrRaw = data?.qr || data?.qrDataUrl || null;

        if (conectado) {
          setStatus("connected");
          setQrValue(null);
        } else if (rawStatus === "qr" || qrRaw) {
          setStatus("qr");
          setQrValue(qrRaw);
        } else {
          setStatus("disconnected");
          setQrValue(null);
        }

        setNumero(data?.numero || data?.numeroVinculado || null);
        setErrorMsg(null);
      } else {
        if (!isMounted.current) return;
        setStatus("disconnected");
      }
    } catch (err: any) {
      if (!isMounted.current) return;
      setErrorMsg(err?.message || "Error al consultar estado");
    }
  }, [grupo_id]);

  useEffect(() => {
    isMounted.current = true;
    void consultarEstado();

    const interval = setInterval(() => {
      void consultarEstado();
    }, 3000);

    return () => {
      isMounted.current = false;
      clearInterval(interval);
    };
  }, [consultarEstado]);

  // 2. Cargar Plantillas
  const cargarPlantillas = useCallback(async () => {
    if (!grupo_id) return;
    setCargandoPlantillas(true);
    try {
      const res = await fetch(`/api/whatsapp-sala/plantillas?grupo_id=${encodeURIComponent(grupo_id)}`, {
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.plantillas) && data.plantillas.length > 0) {
          setPlantillas(data.plantillas);
          const sel = data.plantillas.find((p: any) => p.clave === plantillaSeleccionada) || data.plantillas[0];
          setTextoEditado(sel?.contenido || "");
        }
      }
    } catch {
      // Usar defaults
    } finally {
      setCargandoPlantillas(false);
    }
  }, [grupo_id, plantillaSeleccionada]);

  useEffect(() => {
    if (activeTab === "plantillas") {
      void cargarPlantillas();
    }
  }, [activeTab, cargarPlantillas]);

  // 3. Cargar Salas vinculadas al grupo
  const cargarSalas = useCallback(async () => {
    if (!grupo_id) return;
    setCargandoSalas(true);
    try {
      const res = await fetch(`/api/whatsapp-sala/salas-grupos?grupo_id=${encodeURIComponent(grupo_id)}`, {
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        const lista = data?.salas || [];
        setSalas(lista);
        if (lista.length > 0 && !salaSeleccionadaId) {
          setSalaSeleccionadaId(lista[0].id);
          setHipodromoInput(lista[0].hipodromo_activo || "LA RINCONADA");
          setCarreraInput(Number(lista[0].numero_carrera_activa || 1));
        }
      }
    } catch {} finally {
      setCargandoSalas(false);
    }
  }, [grupo_id, salaSeleccionadaId]);

  useEffect(() => {
    if (activeTab === "control") {
      void cargarSalas();
    }
  }, [activeTab, cargarSalas]);

  // Acciones de Conexión
  const conectarBot = async () => {
    setProcesando(true);
    setErrorMsg(null);
    try {
      let res: Response | null = null;
      try {
        res = await fetch(`${BOT_SERVER_URL}/api/whatsapp/connect`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: grupo_id }),
        });
      } catch {
        res = await fetch("/api/whatsapp/connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: grupo_id }),
        });
      }

      if (res && res.ok) {
        const data = await res.json();
        if (data?.status === "connected") {
          setStatus("connected");
        } else if (data?.status === "qr" || data?.qr) {
          setStatus("qr");
          setQrValue(data.qr);
        } else {
          setStatus("loading");
        }
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "No se pudo iniciar el bot");
    } finally {
      setProcesando(false);
      void consultarEstado();
    }
  };

  const desconectarBot = async () => {
    setProcesando(true);
    setErrorMsg(null);
    try {
      let res: Response | null = null;
      try {
        res = await fetch("/disconnect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: grupo_id }),
        });
      } catch {
        res = await fetch(`${BOT_SERVER_URL}/disconnect`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: grupo_id }),
        });
      }

      if (res && res.ok) {
        setStatus("disconnected");
        setQrValue(null);
        setNumero(null);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "No se pudo desconectar");
    } finally {
      setProcesando(false);
      void consultarEstado();
    }
  };

  const limpiarSesionHuerfana = async () => {
    setProcesando(true);
    setErrorMsg(null);
    try {
      await fetch("/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: grupo_id, forzar_limpieza: true }),
      }).catch(() => {});

      await fetch(`${BOT_SERVER_URL}/disconnect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: grupo_id, forzar_limpieza: true }),
      }).catch(() => {});

      await fetch("/api/whatsapp-sala/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "limpiar_vinculos_huerfanos", grupoId: grupo_id }),
      }).catch(() => {});

      setFeedbackSuccess("Sesión huérfana y vínculos 1 a 1 limpiados correctamente. Listo para vincular.");
      setTimeout(() => setFeedbackSuccess(null), 5000);
      setStatus("disconnected");
      setQrValue(null);
      setNumero(null);
    } catch (err: any) {
      setErrorMsg("Error al limpiar sesión: " + (err?.message || "desconocido"));
    } finally {
      setProcesando(false);
      setTimeout(() => void consultarEstado(), 1500);
    }
  };

  // Guardar Plantilla
  const guardarPlantillaActual = async () => {
    if (!grupo_id || !plantillaSeleccionada) return;
    setGuardandoPlantilla(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/whatsapp-sala/plantillas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grupo_id,
          clave: plantillaSeleccionada,
          contenido: textoEditado,
        }),
      });
      if (res.ok) {
        setFeedbackSuccess("Plantilla guardada correctamente.");
        setTimeout(() => setFeedbackSuccess(null), 4000);
        void cargarPlantillas();
      } else {
        setErrorMsg("No se pudo guardar la plantilla.");
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Error al guardar");
    } finally {
      setGuardandoPlantilla(false);
    }
  };

  const restaurarPlantillaDefault = () => {
    const def = PLANTILLAS_GRUPO_DEFAULT.find((p) => p.clave === plantillaSeleccionada);
    if (def) {
      setTextoEditado(def.contenido);
    }
  };

  const insertarVariable = (variable: string) => {
    setTextoEditado((prev) => `${prev} ${variable}`);
  };

  // Acciones de Carrera
  const ejecutarAccionCarrera = async (accion: string, extraData: any = {}) => {
    if (!salaSeleccionadaId) return;
    setAccionEnCurso(accion);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/whatsapp-sala/procesar", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-bot-secret": "SH-BOT-SECRET-2026",
        },
        body: JSON.stringify({
          accion,
          salaId: salaSeleccionadaId,
          ...extraData,
        }),
      });
      const data = await res.json();
      if (data?.ok) {
        setFeedbackSuccess(data?.respuestaGrupo || data?.textoPlano || `Acción ${accion} ejecutada correctamente.`);
        setTimeout(() => setFeedbackSuccess(null), 5000);
        void cargarSalas();
      } else {
        setErrorMsg(data?.error || data?.mensaje || "Error al ejecutar acción.");
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Error de red al procesar acción.");
    } finally {
      setAccionEnCurso(null);
    }
  };

  const salaActiva = salas.find((s) => s.id === salaSeleccionadaId) || salas[0];
  const plantillaActiva = plantillas.find((p) => p.clave === plantillaSeleccionada) || plantillas[0];

  return (
    <div className={`rounded-3xl border border-slate-800 bg-slate-950 p-5 text-white shadow-2xl ${className}`}>
      {/* Cabecera del Panel */}
      <div className="mb-4 flex flex-wrap items-center justify-between border-b border-slate-800/80 pb-3 gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xl">💬</span>
          <div>
            <h2 className="text-xs font-black uppercase tracking-[0.14em] text-emerald-400">
              Centro Integral WhatsApp SaaS
            </h2>
            <p className="text-[10px] text-slate-400">
              Inquilino / Grupo ID: <span className="font-mono text-emerald-300">{grupo_id || "Sin ID"}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              status === "connected"
                ? "bg-emerald-400 shadow-md shadow-emerald-500/50"
                : status === "qr"
                ? "bg-amber-400 animate-pulse"
                : "bg-slate-600"
            }`}
          />
          <span className="text-[11px] font-bold capitalize text-slate-300">
            {status === "loading"
              ? "Cargando…"
              : status === "connected"
              ? "En línea"
              : status === "qr"
              ? "Esperando QR"
              : "Desconectado"}
          </span>
        </div>
      </div>

      {/* Navegación por Pestañas (Tabs) */}
      <div className="mb-5 flex rounded-2xl bg-slate-900/90 p-1 border border-slate-800 text-xs font-black">
        <button
          type="button"
          onClick={() => setActiveTab("conexion")}
          className={`flex-1 py-2 px-3 rounded-xl transition text-center ${
            activeTab === "conexion"
              ? "bg-emerald-600 text-white shadow-md shadow-emerald-950/60"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          📱 Conexión QR (1 a 1)
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("plantillas")}
          className={`flex-1 py-2 px-3 rounded-xl transition text-center ${
            activeTab === "plantillas"
              ? "bg-emerald-600 text-white shadow-md shadow-emerald-950/60"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          📝 Plantillas Bot
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("control")}
          className={`flex-1 py-2 px-3 rounded-xl transition text-center ${
            activeTab === "control"
              ? "bg-emerald-600 text-white shadow-md shadow-emerald-950/60"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          🏇 Salas y Carreras
        </button>
      </div>

      {/* Alertas Globales */}
      {errorMsg && (
        <div className="mb-3 rounded-xl border border-rose-500/30 bg-rose-950/40 px-3 py-2 text-[11px] text-rose-300">
          ⚠️ {errorMsg}
        </div>
      )}
      {feedbackSuccess && (
        <div className="mb-3 rounded-xl border border-emerald-500/30 bg-emerald-950/40 px-3 py-2 text-[11px] text-emerald-300">
          ✅ {feedbackSuccess}
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 1: CONEXIÓN QR Y LIMPIEZA DE SESIONES HUÉRFANAS (REGLA 1 A 1)    */}
      {/* ==================================================================== */}
      {activeTab === "conexion" && (
        <div className="flex flex-col items-center justify-center py-2 space-y-4">
          {/* ESTADO 1: Cargando */}
          {status === "loading" && (
            <div className="flex flex-col items-center gap-2 py-8 text-center text-slate-400">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
              <p className="text-xs">Sincronizando estado con el bot…</p>
            </div>
          )}

          {/* ESTADO 2: CONNECTED -> Muestra Check Verde */}
          {status === "connected" && (
            <div className="flex flex-col items-center gap-3 py-4 text-center w-full">
              <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-emerald-400/80 bg-emerald-500/15 text-emerald-400 ring-4 ring-emerald-500/20 shadow-lg shadow-emerald-950/60">
                <svg
                  className="h-10 w-10 text-emerald-400 stroke-current"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth="2.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 13l4 4L19 7" />
                </svg>
              </div>

              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 border border-emerald-400/40 px-3 py-0.5 text-xs font-black text-emerald-300">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span>Online Activo</span>
                </div>
                <p className="mt-1 text-sm font-black text-emerald-400">
                  ✅ Bot de WhatsApp Vinculado
                </p>
                {numero && (
                  <p className="mt-1 font-mono text-xs font-bold text-slate-200">
                    +{numero}
                  </p>
                )}
                <p className="mt-1 max-w-xs text-[11px] leading-relaxed text-slate-400">
                  Tu banca tiene la sesión 1 a 1 activa, procesando y casando jugadas en tiempo real.
                </p>
              </div>

              <div className="mt-2 pt-2 border-t border-slate-800/80 w-full flex flex-wrap gap-2 justify-center">
                <button
                  type="button"
                  onClick={desconectarBot}
                  disabled={procesando}
                  className="inline-flex items-center gap-2 rounded-xl border border-rose-500/50 bg-rose-950/60 px-4 py-2 text-[11px] font-black text-rose-200 shadow transition hover:bg-rose-900/70 disabled:opacity-40"
                >
                  {procesando ? "Desconectando…" : "🔌 Desconectar"}
                </button>
                <button
                  type="button"
                  onClick={limpiarSesionHuerfana}
                  disabled={procesando}
                  className="inline-flex items-center gap-2 rounded-xl border border-amber-500/50 bg-amber-950/40 px-4 py-2 text-[11px] font-black text-amber-200 shadow transition hover:bg-amber-900/60 disabled:opacity-40"
                  title="Resetea credenciales residuales si el bot queda en loop o trabado"
                >
                  🧹 Limpiar Sesión Huérfana
                </button>
              </div>
            </div>
          )}

          {/* ESTADO 3: QR -> Muestra Código QR */}
          {status === "qr" && qrValue && (
            <div className="flex flex-col items-center gap-3 py-2 text-center w-full">
              <div className="rounded-2xl bg-white p-3.5 shadow-2xl">
                <QRCode
                  value={qrValue}
                  size={200}
                  style={{ height: "auto", maxWidth: "100%", width: "100%" }}
                  viewBox="0 0 256 256"
                />
              </div>

              <div className="max-w-xs text-center space-y-1">
                <p className="text-xs font-black text-slate-200">
                  Escanea el código QR desde WhatsApp
                </p>
                <ol className="rounded-xl border border-slate-800 bg-slate-900/60 p-2 text-left text-[10px] leading-relaxed text-slate-400 space-y-0.5">
                  <li>1. Abre WhatsApp &gt; Dispositivos vinculados.</li>
                  <li>2. Toca <strong>Vincular un dispositivo</strong>.</li>
                  <li>3. Apunta la cámara al QR.</li>
                </ol>
              </div>

              <div className="mt-1 pt-2 border-t border-slate-800/80 w-full flex flex-wrap gap-2 justify-center">
                <button
                  type="button"
                  onClick={desconectarBot}
                  disabled={procesando}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-1.5 text-[11px] font-bold text-slate-300 transition hover:bg-slate-800 disabled:opacity-40"
                >
                  {procesando ? "Cancelando…" : "Cancelar / Reiniciar QR"}
                </button>
                <button
                  type="button"
                  onClick={limpiarSesionHuerfana}
                  disabled={procesando}
                  className="inline-flex items-center gap-2 rounded-xl border border-amber-500/50 bg-amber-950/40 px-3.5 py-1.5 text-[11px] font-bold text-amber-200 transition hover:bg-amber-900/60 disabled:opacity-40"
                >
                  🧹 Limpiar Sesión Huérfana
                </button>
              </div>
            </div>
          )}

          {/* ESTADO 4: DISCONNECTED */}
          {status === "disconnected" && (
            <div className="flex flex-col items-center gap-3 py-4 text-center w-full">
              <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-dashed border-slate-700 bg-slate-900 text-2xl text-slate-400">
                📱
              </div>

              <div>
                <p className="text-xs font-black text-slate-200">
                  Bot Desconectado (Regla 1 a 1)
                </p>
                <p className="mt-1 max-w-xs text-[11px] leading-relaxed text-slate-400">
                  Cada inquilino cuenta con una conexión exclusiva 1 a 1. Presiona para generar el QR.
                </p>
              </div>

              <div className="flex flex-wrap gap-2 justify-center mt-2">
                <button
                  type="button"
                  onClick={conectarBot}
                  disabled={procesando || !grupo_id}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-black text-white shadow-lg shadow-emerald-900/40 transition hover:bg-emerald-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {procesando ? "Conectando…" : "🚀 Conectar Mi Bot"}
                </button>
                <button
                  type="button"
                  onClick={limpiarSesionHuerfana}
                  disabled={procesando}
                  className="inline-flex items-center gap-2 rounded-xl border border-amber-600/50 bg-amber-950/30 px-3 py-2 text-xs font-bold text-amber-300 transition hover:bg-amber-900/50"
                >
                  🧹 Forzar Limpieza
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 2: PLANTILLAS PERSONALIZABLES POR GRUPO (MODAL / TABS)           */}
      {/* ==================================================================== */}
      {activeTab === "plantillas" && (
        <div className="space-y-4 py-1">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Selecciona la Plantilla a Editar:
              </label>
              <select
                value={plantillaSeleccionada}
                onChange={(e) => {
                  setPlantillaSeleccionada(e.target.value);
                  const p = plantillas.find((item) => item.clave === e.target.value);
                  setTextoEditado(p?.contenido || "");
                }}
                className="mt-1 block w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-bold text-emerald-300 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                {plantillas.map((p) => (
                  <option key={p.clave} value={p.clave}>
                    {p.titulo}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={() => setModalPlantillaAbierto(true)}
              className="text-xs font-bold text-emerald-400 hover:text-emerald-300 underline"
            >
              🔍 Ver en Modal Interactivo
            </button>
          </div>

          <div className="rounded-2xl border border-slate-800/80 bg-slate-900/60 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-black text-slate-200">
                {plantillaActiva?.titulo}
              </span>
              <span className="text-[9px] uppercase font-mono tracking-wider px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
                {plantillaActiva?.clave}
              </span>
            </div>
            <p className="text-[10px] text-slate-400">
              {plantillaActiva?.descripcion}
            </p>

            {/* Pastillas de variables disponibles para insertar con 1 clic */}
            <div className="space-y-1 pt-1">
              <span className="text-[9px] font-bold uppercase text-slate-500">Variables Disponibles (Clic para insertar):</span>
              <div className="flex flex-wrap gap-1">
                {plantillaActiva?.variables?.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => insertarVariable(v)}
                    className="rounded-lg bg-emerald-950/60 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-mono text-emerald-300 hover:bg-emerald-900/60 transition"
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {/* Editor de Texto */}
            <div className="pt-2">
              <textarea
                value={textoEditado}
                onChange={(e) => setTextoEditado(e.target.value)}
                rows={4}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 font-mono text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                placeholder="Escribe el texto de la plantilla..."
              />
            </div>

            {/* Botones Guardar / Restaurar */}
            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={restaurarPlantillaDefault}
                className="text-[11px] font-bold text-slate-400 hover:text-slate-200"
              >
                ↩️ Restaurar Predeterminado
              </button>
              <button
                type="button"
                onClick={guardarPlantillaActual}
                disabled={guardandoPlantilla}
                className="rounded-xl bg-emerald-600 px-4 py-1.5 text-xs font-black text-white hover:bg-emerald-500 transition shadow"
              >
                {guardandoPlantilla ? "Guardando…" : "💾 Guardar Plantilla"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 3: CONTROL DE SALAS Y CARRERAS                                   */}
      {/* ==================================================================== */}
      {activeTab === "control" && (
        <div className="space-y-4 py-1">
          {cargandoSalas ? (
            <div className="py-6 text-center text-xs text-slate-400">
              Cargando salas activas de tu banca…
            </div>
          ) : salas.length === 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 text-center text-xs text-slate-400">
              No tienes ninguna sala vinculada a este grupo actualmente.
            </div>
          ) : (
            <>
              {/* Selector de Sala */}
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Sala de Juegos Activa:
                </label>
                <select
                  value={salaSeleccionadaId}
                  onChange={(e) => {
                    setSalaSeleccionadaId(e.target.value);
                    const s = salas.find((item) => item.id === e.target.value);
                    if (s) {
                      setHipodromoInput(s.hipodromo_activo || "LA RINCONADA");
                      setCarreraInput(Number(s.numero_carrera_activa || 1));
                    }
                  }}
                  className="mt-1 block w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-bold text-emerald-300 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  {salas.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre_sala} — {String(s.estado_carrera || "CERRADA").toUpperCase()} ({s.hipodromo_activo} C{s.numero_carrera_activa})
                    </option>
                  ))}
                </select>
              </div>

              {/* Tarjeta de Estado de la Carrera */}
              <div className="rounded-2xl border border-slate-800/80 bg-slate-900/60 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400">Estatus Taquilla:</span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${
                          String(salaActiva?.estado_carrera || "").toLowerCase() === "abierta"
                            ? "bg-emerald-400 shadow-md shadow-emerald-500/50"
                            : "bg-rose-500"
                        }`}
                      />
                      <span className="text-xs font-black uppercase text-slate-200">
                        {salaActiva?.estado_carrera || "CERRADA"}
                      </span>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="text-[10px] uppercase font-bold text-slate-400">Carrera Activa:</span>
                    <p className="text-xs font-black text-emerald-400">
                      {salaActiva?.hipodromo_activo || "LA RINCONADA"} #{salaActiva?.numero_carrera_activa || 1}
                    </p>
                  </div>
                </div>

                {/* Formulario Apertura Rápida */}
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800/80">
                  <div>
                    <label className="text-[9px] font-bold uppercase text-slate-400">Hipódromo:</label>
                    <input
                      type="text"
                      value={hipodromoInput}
                      onChange={(e) => setHipodromoInput(e.target.value)}
                      className="mt-0.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs font-bold text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-bold uppercase text-slate-400">Carrera Nro:</label>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={carreraInput}
                      onChange={(e) => setCarreraInput(parseInt(e.target.value, 10) || 1)}
                      className="mt-0.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs font-bold text-slate-200"
                    />
                  </div>
                </div>

                {/* Botones de Control Maestro */}
                <div className="grid grid-cols-3 gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() =>
                      ejecutarAccionCarrera("abrir-carrera", {
                        hipodromo: hipodromoInput,
                        carrera: carreraInput,
                      })
                    }
                    disabled={Boolean(accionEnCurso)}
                    className="rounded-xl bg-emerald-600 px-3 py-2 text-[11px] font-black text-white hover:bg-emerald-500 transition shadow disabled:opacity-40"
                  >
                    🟢 Abrir
                  </button>
                  <button
                    type="button"
                    onClick={() => ejecutarAccionCarrera("cerrar-carrera")}
                    disabled={Boolean(accionEnCurso)}
                    className="rounded-xl bg-rose-600 px-3 py-2 text-[11px] font-black text-white hover:bg-rose-500 transition shadow disabled:opacity-40"
                  >
                    🔒 Trancar
                  </button>
                  <button
                    type="button"
                    onClick={() => ejecutarAccionCarrera("publicar-plano")}
                    disabled={Boolean(accionEnCurso)}
                    className="rounded-xl bg-indigo-600 px-3 py-2 text-[11px] font-black text-white hover:bg-indigo-500 transition shadow disabled:opacity-40"
                  >
                    📋 Plano
                  </button>
                </div>

                {/* Sentenciar y Liquidar Pizarra */}
                <div className="pt-2 border-t border-slate-800/80 space-y-2">
                  <label className="text-[10px] font-bold uppercase text-slate-400">
                    Sentenciar / Liquidar Pizarra Oficial (ej: 5-3-8-1-2):
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={pizarraInput}
                      onChange={(e) => setPizarraInput(e.target.value)}
                      placeholder="5-3-8-1-2"
                      className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-mono font-bold text-slate-200"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        ejecutarAccionCarrera("liquidar-pizarra", {
                          pizarra: pizarraInput,
                        })
                      }
                      disabled={Boolean(accionEnCurso) || !pizarraInput.trim()}
                      className="rounded-xl bg-amber-600 px-4 py-1.5 text-xs font-black text-white hover:bg-amber-500 transition disabled:opacity-40"
                    >
                      🏁 Liquidar
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Modal Interactivo de Plantilla */}
      {modalPlantillaAbierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-lg rounded-3xl border border-slate-800 bg-slate-950 p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-black uppercase text-emerald-400">
                📝 Editor de Plantilla Bot
              </h3>
              <button
                type="button"
                onClick={() => setModalPlantillaAbierto(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div>
              <p className="text-xs font-black text-slate-200">{plantillaActiva?.titulo}</p>
              <p className="text-[11px] text-slate-400">{plantillaActiva?.descripcion}</p>
            </div>

            <textarea
              value={textoEditado}
              onChange={(e) => setTextoEditado(e.target.value)}
              rows={6}
              className="w-full rounded-2xl border border-slate-700 bg-slate-900 p-3 font-mono text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setModalPlantillaAbierto(false)}
                className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-xs font-bold text-slate-300"
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={() => {
                  void guardarPlantillaActual();
                  setModalPlantillaAbierto(false);
                }}
                className="rounded-xl bg-emerald-600 px-5 py-2 text-xs font-black text-white hover:bg-emerald-500"
              >
                Guardar Cambios
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
