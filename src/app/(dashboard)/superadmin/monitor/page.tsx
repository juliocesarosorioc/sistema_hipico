"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useAuthStore } from "@/shared/store/useAuthStore";
import WhatsAppBotSemaforo, { BotSemaforoStatus } from "@/components/superadmin/WhatsAppBotSemaforo";

interface Inquilino {
  id: string;
  nombre: string;
  responsable: string;
  activo: boolean;
  estatus_suscripcion: "al_dia" | "vencido" | string;
  moneda: string;
  cupo_tabla?: number | null;
  created_at?: string;
}

export default function SuperAdminMonitorPage() {
  const [inquilinos, setInquilinos] = useState<Inquilino[]>([]);
  const [cargando, setCargando] = useState<boolean>(true);
  const [busqueda, setBusqueda] = useState<string>("");
  const [filtroSuscripcion, setFiltroSuscripcion] = useState<"todos" | "al_dia" | "vencido">("todos");
  const [filtroBot, setFiltroBot] = useState<"todos" | "connected" | "disconnected">("todos");
  const [procesandoAccion, setProcesandoAccion] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [botEstados, setBotEstados] = useState<Record<string, BotSemaforoStatus>>({});

  // Cargar lista de inquilinos / banqueros
  const cargarInquilinos = useCallback(async () => {
    try {
      setCargando(true);
      const res = await fetch("/api/superadmin/inquilinos", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (json?.ok && Array.isArray(json.inquilinos)) {
        setInquilinos(json.inquilinos);
      } else {
        setFeedback({ tipo: "error", texto: json?.error || "Error al cargar la lista de inquilinos." });
      }
    } catch (err: any) {
      setFeedback({ tipo: "error", texto: err?.message || "Fallo de conexión al cargar inquilinos." });
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargarInquilinos();
  }, [cargarInquilinos]);

  // Actualizar estado del bot reportado por cada semáforo
  const handleBotStatusChange = useCallback((grupoId: string, status: BotSemaforoStatus) => {
    setBotEstados((prev) => {
      if (prev[grupoId] === status) return prev;
      return { ...prev, [grupoId]: status };
    });
  }, []);

  // Control Maestro 1: Forzar Desconexión del Bot de WhatsApp
  const handleForzarDesconexion = async (inquilino: Inquilino) => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(`⚠️ ¿Estás seguro de FORZAR la desconexión del Bot de WhatsApp para "${inquilino.nombre}"?`)
    ) {
      return;
    }

    setProcesandoAccion(`desconectar-${inquilino.id}`);
    setFeedback(null);

    try {
      // 1. Intentar endpoint Next.js
      let exito = false;
      try {
        const res = await fetch("/api/whatsapp/disconnect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: inquilino.id }),
        });
        const json = await res.json().catch(() => ({}));
        if (res.ok && json?.ok !== false) {
          exito = true;
        }
      } catch {
        // Fallback directo a Contabo
        const resDirect = await fetch(`http://80.190.77.210:3005/api/whatsapp/disconnect`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: inquilino.id }),
        }).catch(() => null);
        if (resDirect && resDirect.ok) exito = true;
      }

      if (exito) {
        setFeedback({
          tipo: "ok",
          texto: `✅ Desconexión forzada exitosa para el grupo "${inquilino.nombre}".`,
        });
        setBotEstados((prev) => ({ ...prev, [inquilino.id]: "disconnected" }));
      } else {
        setFeedback({
          tipo: "error",
          texto: `No se pudo forzar la desconexión del grupo "${inquilino.nombre}".`,
        });
      }
    } catch (err: any) {
      setFeedback({ tipo: "error", texto: err?.message || "Error al forzar la desconexión." });
    } finally {
      setProcesandoAccion(null);
    }
  };

  // Control Maestro 2: Suspender Sistema / Reactivar Acceso (Toggle Estatus Suscripción)
  const handleToggleSuspension = async (inquilino: Inquilino) => {
    const vaASuspender = inquilino.activo;
    const mensaje = vaASuspender
      ? `⛔ ¿Confirmas que deseas SUSPENDER el sistema a "${inquilino.nombre}"? Su acceso quedará bloqueado y su suscripción pasará a "Vencido".`
      : `✅ ¿Confirmas que deseas REACTIVAR el sistema a "${inquilino.nombre}"? Su suscripción pasará a "Al Día".`;

    if (typeof window !== "undefined" && !window.confirm(mensaje)) {
      return;
    }

    setProcesandoAccion(`suspender-${inquilino.id}`);
    setFeedback(null);

    try {
      const res = await fetch("/api/superadmin/inquilinos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grupoId: inquilino.id,
          accion: "suspender_sistema",
          suspender: vaASuspender,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (json?.ok) {
        setFeedback({
          tipo: "ok",
          texto: `✅ ${json.motivo || "Estado del sistema actualizado"} para "${inquilino.nombre}".`,
        });
        // Actualizar localmente el inquilino
        setInquilinos((prev) =>
          prev.map((item) =>
            item.id === inquilino.id
              ? {
                  ...item,
                  activo: json.activo,
                  estatus_suscripcion: json.estatus_suscripcion,
                }
              : item
          )
        );
      } else {
        setFeedback({ tipo: "error", texto: json?.error || "No se pudo actualizar el estado de suscripción." });
      }
    } catch (err: any) {
      setFeedback({ tipo: "error", texto: err?.message || "Error al procesar la suspensión." });
    } finally {
      setProcesandoAccion(null);
    }
  };

  // Filtrado reactivo de inquilinos
  const inquilinosFiltrados = useMemo(() => {
    return inquilinos.filter((inq) => {
      // Búsqueda por texto (Nombre, Responsable, ID)
      if (busqueda.trim()) {
        const query = busqueda.toLowerCase();
        const coincide =
          inq.nombre.toLowerCase().includes(query) ||
          inq.responsable.toLowerCase().includes(query) ||
          inq.id.toLowerCase().includes(query);
        if (!coincide) return false;
      }

      // Filtro de suscripción
      if (filtroSuscripcion === "al_dia" && inq.estatus_suscripcion !== "al_dia") return false;
      if (filtroSuscripcion === "vencido" && inq.estatus_suscripcion !== "vencido") return false;

      // Filtro de bot
      const estadoBot = botEstados[inq.id];
      if (filtroBot === "connected" && estadoBot !== "connected") return false;
      if (filtroBot === "disconnected" && estadoBot === "connected") return false;

      return true;
    });
  }, [inquilinos, busqueda, filtroSuscripcion, filtroBot, botEstados]);

  // Métricas para KPI Header
  const totalInquilinos = inquilinos.length;
  const totalAlDia = inquilinos.filter((i) => i.estatus_suscripcion === "al_dia").length;
  const totalVencidos = inquilinos.filter((i) => i.estatus_suscripcion === "vencido" || !i.activo).length;
  const totalBotsConectados = Object.values(botEstados).filter((st) => st === "connected").length;

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6 space-y-6">
      {/* Cabecera Principal */}
      <header className="rounded-3xl border border-slate-800 bg-slate-950 p-6 text-white shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 -mt-8 -mr-8 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-wrap items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex items-center gap-3">
              <span className="text-3xl">🌐</span>
              <div>
                <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
                  Monitor Global SaaS
                  <span className="rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-[10px] uppercase font-black px-2.5 py-0.5 tracking-wider">
                    Super Admin
                  </span>
                </h1>
                <p className="mt-0.5 text-xs text-slate-400">
                  Panel de control multi-tenant: Supervisión en tiempo real de inquilinos, suscripciones y bots de WhatsApp.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void cargarInquilinos()}
              disabled={cargando}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-slate-800 hover:border-slate-600 transition-all shadow-sm active:scale-95 disabled:opacity-50"
            >
              <span>{cargando ? "🔄" : "⚡"}</span>
              <span>{cargando ? "Actualizando..." : "Refrescar"}</span>
            </button>
          </div>
        </div>

        {/* Tarjetas KPI */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 relative z-10">
          <div className="rounded-2xl border border-slate-800/80 bg-slate-900/60 p-3.5 backdrop-blur-sm">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Total Inquilinos</div>
            <div className="mt-1 text-2xl font-black text-white">{totalInquilinos}</div>
            <div className="text-[10px] text-slate-500">Banqueros registrados</div>
          </div>

          <div className="rounded-2xl border border-emerald-900/40 bg-emerald-950/20 p-3.5 backdrop-blur-sm">
            <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">Suscripción Al Día</div>
            <div className="mt-1 text-2xl font-black text-emerald-300">{totalAlDia}</div>
            <div className="text-[10px] text-emerald-500/80">Acceso activo al sistema</div>
          </div>

          <div className="rounded-2xl border border-rose-900/40 bg-rose-950/20 p-3.5 backdrop-blur-sm">
            <div className="text-[11px] font-bold uppercase tracking-wider text-rose-400">Vencidos / Suspendidos</div>
            <div className="mt-1 text-2xl font-black text-rose-300">{totalVencidos}</div>
            <div className="text-[10px] text-rose-500/80">Acceso bloqueado</div>
          </div>

          <div className="rounded-2xl border border-sky-900/40 bg-sky-950/20 p-3.5 backdrop-blur-sm">
            <div className="text-[11px] font-bold uppercase tracking-wider text-sky-400">Bots Conectados</div>
            <div className="mt-1 text-2xl font-black text-sky-300">{totalBotsConectados}</div>
            <div className="text-[10px] text-sky-500/80">En línea y operativos</div>
          </div>
        </div>
      </header>

      {/* Alerta de Feedback */}
      {feedback && (
        <div
          className={`flex items-center justify-between rounded-2xl border p-4 text-xs font-semibold shadow-lg transition-all ${
            feedback.tipo === "ok"
              ? "border-emerald-500/40 bg-emerald-950/70 text-emerald-200"
              : "border-rose-500/40 bg-rose-950/70 text-rose-200"
          }`}
        >
          <div className="flex items-center gap-2">
            <span>{feedback.tipo === "ok" ? "✅" : "⚠️"}</span>
            <span>{feedback.texto}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="rounded-lg px-2 py-1 text-slate-400 hover:text-white hover:bg-slate-800/50"
          >
            ✕
          </button>
        </div>
      )}

      {/* Barra de Filtros y Búsqueda */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950 p-4 shadow-xl">
        <div className="flex-1 min-w-[260px]">
          <div className="relative">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-500">🔍</span>
            <input
              type="text"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por nombre de grupo, responsable o ID..."
              className="w-full rounded-xl border border-slate-800 bg-slate-900/80 py-2 pl-9 pr-3 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-all"
            />
          </div>
        </div>

        {/* Filtros rápidos de Suscripción */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          <button
            type="button"
            onClick={() => setFiltroSuscripcion("todos")}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-all ${
              filtroSuscripcion === "todos"
                ? "bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20"
                : "border border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700"
            }`}
          >
            Todos ({inquilinos.length})
          </button>
          <button
            type="button"
            onClick={() => setFiltroSuscripcion("al_dia")}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-all ${
              filtroSuscripcion === "al_dia"
                ? "bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20"
                : "border border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700"
            }`}
          >
            Al Día ({totalAlDia})
          </button>
          <button
            type="button"
            onClick={() => setFiltroSuscripcion("vencido")}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-all ${
              filtroSuscripcion === "vencido"
                ? "bg-rose-500 text-white shadow-md shadow-rose-500/20"
                : "border border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700"
            }`}
          >
            Vencidos ({totalVencidos})
          </button>
        </div>
      </div>

      {/* Cuadrícula de Inquilinos (Grid) */}
      {cargando && inquilinos.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center rounded-3xl border border-slate-800 bg-slate-950 p-6 text-center shadow-xl">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent mb-3" />
          <p className="text-xs font-bold text-slate-400">Cargando inquilinos del sistema...</p>
        </div>
      ) : inquilinosFiltrados.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center rounded-3xl border border-slate-800 bg-slate-950 p-6 text-center shadow-xl">
          <span className="text-3xl mb-2">📭</span>
          <p className="text-xs font-bold text-slate-300">No se encontraron inquilinos con los filtros actuales.</p>
          <p className="text-[11px] text-slate-500 mt-1">Prueba borrando los términos de búsqueda.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {inquilinosFiltrados.map((inq) => {
            const estaAlDia = inq.estatus_suscripcion === "al_dia" && inq.activo;
            const estaProcesandoDesc = procesandoAccion === `desconectar-${inq.id}`;
            const estaProcesandoSusp = procesandoAccion === `suspender-${inq.id}`;

            return (
              <div
                key={inq.id}
                className={`flex flex-col justify-between rounded-3xl border transition-all duration-200 bg-slate-950 p-5 shadow-xl hover:border-slate-700 relative overflow-hidden ${
                  estaAlDia
                    ? "border-slate-800/90 hover:shadow-emerald-950/20"
                    : "border-rose-900/60 bg-rose-950/10 hover:shadow-rose-950/20"
                }`}
              >
                {/* Header de la Tarjeta */}
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-base">🏢</span>
                        <h2 className="text-sm font-black text-white truncate tracking-tight" title={inq.nombre}>
                          {inq.nombre}
                        </h2>
                      </div>
                      <div className="mt-1 flex items-center gap-1 text-[11px] text-slate-400 truncate">
                        <span>👤</span>
                        <span className="font-semibold text-slate-300 truncate" title={inq.responsable}>
                          {inq.responsable || "Sin Responsable"}
                        </span>
                      </div>
                    </div>

                    {/* Badge de Suscripción */}
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase shrink-0 border ${
                        estaAlDia
                          ? "border-emerald-500/50 bg-emerald-950 text-emerald-300"
                          : "border-rose-500/50 bg-rose-950 text-rose-300"
                      }`}
                    >
                      {estaAlDia ? "Al Día" : "Vencido"}
                    </span>
                  </div>

                  {/* Metadatos adicionales */}
                  <div className="mt-3 flex items-center justify-between border-t border-slate-900 pt-2 text-[10px] text-slate-500">
                    <span>Moneda: <strong className="text-slate-300">{inq.moneda || "USD"}</strong></span>
                    <span className="font-mono text-[9px] text-slate-600 truncate max-w-[110px]" title={inq.id}>
                      ID: {inq.id.slice(0, 8)}…
                    </span>
                  </div>

                  {/* Estado del Bot de WhatsApp (Semáforo Polling) */}
                  <div className="mt-3.5">
                    <WhatsAppBotSemaforo
                      grupo_id={inq.id}
                      onStatusChange={(status) => handleBotStatusChange(inq.id, status)}
                    />
                  </div>
                </div>

                {/* Controles Maestros por Inquilino */}
                <div className="mt-4 pt-3 border-t border-slate-800/80 space-y-2">
                  <div className="text-[10px] font-black uppercase tracking-wider text-slate-500 flex items-center gap-1">
                    <span>⚙️</span> Controles Maestros
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {/* Botón: Forzar Desconexión */}
                    <button
                      type="button"
                      onClick={() => void handleForzarDesconexion(inq)}
                      disabled={estaProcesandoDesc}
                      className="inline-flex items-center justify-center gap-1 rounded-xl border border-rose-800/60 bg-rose-950/40 px-2 py-1.5 text-[10px] font-black text-rose-300 hover:bg-rose-900/60 hover:border-rose-700 transition-all active:scale-95 disabled:opacity-50"
                      title="Fuerza el cierre de sesión de WhatsApp para este inquilino"
                    >
                      <span>{estaProcesandoDesc ? "⏳" : "🔌"}</span>
                      <span>{estaProcesandoDesc ? "Tumbando..." : "Forzar Desconexión"}</span>
                    </button>

                    {/* Botón: Suspender Sistema (Toggle) */}
                    <button
                      type="button"
                      onClick={() => void handleToggleSuspension(inq)}
                      disabled={estaProcesandoSusp}
                      className={`inline-flex items-center justify-center gap-1 rounded-xl border px-2 py-1.5 text-[10px] font-black transition-all active:scale-95 disabled:opacity-50 ${
                        inq.activo
                          ? "border-amber-700/60 bg-amber-950/40 text-amber-300 hover:bg-amber-900/60 hover:border-amber-600"
                          : "border-emerald-700/60 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/60 hover:border-emerald-600"
                      }`}
                      title={inq.activo ? "Suspender el acceso al sistema de este inquilino" : "Reactivar acceso al sistema"}
                    >
                      <span>{estaProcesandoSusp ? "⏳" : inq.activo ? "⛔" : "✅"}</span>
                      <span>
                        {estaProcesandoSusp
                          ? "Procesando..."
                          : inq.activo
                          ? "Suspender Sistema"
                          : "Reactivar Sistema"}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
