"use client";

import { useState, useEffect, useMemo, useTransition } from "react";
import {
  listarApuestasEventosEspeciales,
  registrarApuestaEventoEspecial,
  actualizarEstadoEventoEspecial,
  eliminarApuestaEventoEspecial,
  calcularPagoPotencial,
  type ApuestaEventoEspecial,
  type EstadoApuestaEspecial,
} from "@/features/apuestas/lib/eventos-especiales";
import { hoyLocal } from "@/core/utils/fechas";
import { emitirToast } from "@/shared/lib/mensajeria";

interface ClienteSimple {
  id?: string | number;
  nombre?: string | null;
  seudonimo?: string | null;
}

interface ModalApuestaEventoEspecialProps {
  abierto: boolean;
  onCerrar: () => void;
  clientes?: ClienteSimple[];
}

export function ModalApuestaEventoEspecial({
  abierto,
  onCerrar,
  clientes = [],
}: ModalApuestaEventoEspecialProps) {
  const [tab, setTab] = useState<"nueva" | "reporte">("nueva");
  const [apuestas, setApuestas] = useState<ApuestaEventoEspecial[]>([]);
  const [cargando, setCargando] = useState(false);
  const [, startTransition] = useTransition();

  // Formulario Nueva Apuesta
  const [evento, setEvento] = useState("");
  const [clienteNombre, setClienteNombre] = useState("");
  const [clienteId, setClienteId] = useState<string>("");
  const [monto, setMonto] = useState<string>("");
  const [logroCuota, setLogroCuota] = useState<string>("");
  const [pagoManual, setPagoManual] = useState<string>("");
  const [nota, setNota] = useState<string>("");
  const [guardando, setGuardando] = useState(false);

  // Filtro del Reporte
  const [filtroEstado, setFiltroEstado] = useState<"TODOS" | "PENDIENTE" | "GANADOR">("TODOS");
  const [busquedaReporte, setBusquedaReporte] = useState("");

  const cargarDatos = async () => {
    setCargando(true);
    try {
      const datos = await listarApuestasEventosEspeciales();
      setApuestas(datos);
    } catch {
      /* ignore */
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    if (abierto) {
      void cargarDatos();
    }
  }, [abierto]);

  // Cálculo en vivo del pago potencial
  const pagoPotencialCalculado = useMemo(() => {
    if (pagoManual.trim()) {
      const val = parseFloat(pagoManual);
      return Number.isNaN(val) ? 0 : val;
    }
    const m = parseFloat(monto) || 0;
    return calcularPagoPotencial(m, logroCuota);
  }, [monto, logroCuota, pagoManual]);

  if (!abierto) return null;

  const handleSeleccionarCliente = (idOValor: string) => {
    if (!idOValor) {
      setClienteId("");
      setClienteNombre("");
      return;
    }
    const c = clientes.find((item) => String(item.id) === idOValor || item.seudonimo === idOValor || item.nombre === idOValor);
    if (c) {
      setClienteId(String(c.id || ""));
      setClienteNombre(c.seudonimo || c.nombre || idOValor);
    } else {
      setClienteId("");
      setClienteNombre(idOValor);
    }
  };

  const handleRegistrar = async (e: React.FormEvent) => {
    e.preventDefault();
    const mNum = parseFloat(monto);
    if (!evento.trim()) {
      emitirToast("Escribe el nombre o descripción del evento.", "warning");
      return;
    }
    if (!clienteNombre.trim()) {
      emitirToast("Indica el cliente o jugador.", "warning");
      return;
    }
    if (Number.isNaN(mNum) || mNum <= 0) {
      emitirToast("Indica un monto válido mayor a 0.", "warning");
      return;
    }

    setGuardando(true);
    try {
      const res = await registrarApuestaEventoEspecial({
        fecha: hoyLocal(),
        evento: evento.trim(),
        cliente_id: clienteId || undefined,
        cliente_nombre: clienteNombre.trim(),
        monto: mNum,
        logro_cuota: logroCuota.trim() || undefined,
        pago_potencial: pagoPotencialCalculado,
        nota: nota.trim() || undefined,
      });

      if (res.ok) {
        emitirToast(`✅ Apuesta registrada: ${evento} · $${mNum}`, "success");
        setEvento("");
        setMonto("");
        setLogroCuota("");
        setPagoManual("");
        setNota("");
        await cargarDatos();
        setTab("reporte");
      } else {
        emitirToast(`❌ Error: ${res.error}`, "error");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      emitirToast(`❌ Falló registro: ${msg}`, "error");
    } finally {
      setGuardando(false);
    }
  };

  const handleCambiarEstado = async (id: string, nuevoEstado: EstadoApuestaEspecial) => {
    startTransition(() => {
      setApuestas((prev) =>
        prev.map((a) => (a.id === id ? { ...a, estado: nuevoEstado, ganador_seleccionado: nuevoEstado === "GANADOR" } : a))
      );
    });

    const res = await actualizarEstadoEventoEspecial(id, nuevoEstado);
    if (res.ok) {
      if (nuevoEstado === "GANADOR") {
        emitirToast("🏆 ¡Ganador seleccionado con éxito!", "success");
      } else if (nuevoEstado === "PERDEDOR") {
        emitirToast("❌ Marcada como no ganadora.", "info");
      } else {
        emitirToast("🔄 Estado restablecido.", "info");
      }
      await cargarDatos();
    } else {
      emitirToast(`❌ No se pudo actualizar: ${res.error}`, "error");
    }
  };

  const handleEliminar = async (id: string) => {
    if (!confirm("¿Deseas eliminar esta apuesta especial?")) return;
    await eliminarApuestaEventoEspecial(id);
    emitirToast("🗑️ Apuesta eliminada.", "info");
    await cargarDatos();
  };

  // Filtrado de apuestas para el reporte
  const apuestasFiltradas = apuestas.filter((a) => {
    if (filtroEstado !== "TODOS" && a.estado !== filtroEstado) return false;
    if (busquedaReporte.trim()) {
      const q = busquedaReporte.toLowerCase();
      const matchEv = a.evento.toLowerCase().includes(q);
      const matchCli = a.cliente_nombre.toLowerCase().includes(q);
      if (!matchEv && !matchCli) return false;
    }
    return true;
  });

  // Métricas
  const totalMonto = apuestas.reduce((acc, a) => acc + (a.estado !== "ANULADA" ? a.monto : 0), 0);
  const totalPagado = apuestas.reduce((acc, a) => acc + (a.estado === "GANADOR" ? a.pago_potencial : 0), 0);
  const balanceCasa = totalMonto - totalPagado;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-evento-esp-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-3 sm:p-4 backdrop-blur-sm"
    >
      <div className="relative flex max-h-[92vh] w-full max-w-2xl flex-col rounded-3xl border border-purple-500/40 bg-slate-900 text-slate-100 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Cabecera */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-gradient-to-r from-purple-900/50 via-slate-900 to-indigo-950/40 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-600 text-xl shadow-lg shadow-purple-950/50">
              🎯
            </div>
            <div>
              <h2 id="modal-evento-esp-title" className="text-sm font-black tracking-wide text-white uppercase sm:text-base">
                Apuesta Especial · Evento Libre
              </h2>
              <p className="text-[11px] font-semibold text-purple-200/80">
                Registra cualquier apuesta y selecciona al ganador en su reporte integrado.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
            aria-label="Cerrar modal"
          >
            ✕
          </button>
        </div>

        {/* Pestañas compactas */}
        <div className="flex border-b border-slate-800 bg-slate-950/60 px-5">
          <button
            type="button"
            onClick={() => setTab("nueva")}
            className={`border-b-2 px-4 py-2.5 text-xs font-black uppercase tracking-wider transition-all ${
              tab === "nueva"
                ? "border-purple-400 text-purple-300 bg-purple-500/10"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            📝 Registrar Apuesta
          </button>
          <button
            type="button"
            onClick={() => setTab("reporte")}
            className={`border-b-2 px-4 py-2.5 text-xs font-black uppercase tracking-wider transition-all ${
              tab === "reporte"
                ? "border-purple-400 text-purple-300 bg-purple-500/10"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            📊 Reporte & Ganador ({apuestas.length})
          </button>
        </div>

        {/* Contenido */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {tab === "nueva" ? (
            <form onSubmit={handleRegistrar} className="space-y-4">
              {/* Evento */}
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-purple-300 mb-1">
                  Nombre o Descripción del Evento <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={evento}
                  onChange={(e) => setEvento(e.target.value)}
                  placeholder="ej. 10/6 Milwaukee Brewers campeon serie mundial"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-purple-400 focus:outline-none"
                />
              </div>

              {/* Cliente y Monto */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-300 mb-1">
                    Cliente / Jugador (Seudónimo) <span className="text-rose-400">*</span>
                  </label>
                  {clientes.length > 0 ? (
                    <div className="space-y-1.5">
                      <select
                        value={clienteId || clienteNombre}
                        onChange={(e) => handleSeleccionarCliente(e.target.value)}
                        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-bold text-white focus:border-purple-400 focus:outline-none"
                      >
                        <option value="">— Seleccionar de la lista —</option>
                        {clientes.map((c) => (
                          <option key={String(c.id ?? c.seudonimo ?? c.nombre)} value={String(c.id ?? "")}>
                            {c.seudonimo ? `${c.seudonimo} (${c.nombre || "Jugador"})` : c.nombre}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={clienteNombre}
                        onChange={(e) => setClienteNombre(e.target.value)}
                        placeholder="O escribe nombre / seudónimo libre"
                        className="w-full rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-1.5 text-xs text-slate-300 placeholder:text-slate-600 focus:border-purple-400 focus:outline-none"
                      />
                    </div>
                  ) : (
                    <input
                      type="text"
                      required
                      value={clienteNombre}
                      onChange={(e) => setClienteNombre(e.target.value)}
                      placeholder="Nombre o seudónimo del cliente"
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-purple-400 focus:outline-none"
                    />
                  )}
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-emerald-300 mb-1">
                    Monto Apostado ($) <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={monto}
                    onChange={(e) => setMonto(e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-bold text-emerald-400 placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
                  />
                </div>
              </div>

              {/* Logro / Cuota y Pago si Gana */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-amber-300 mb-1">
                    Logro / Cuota (Opcional)
                  </label>
                  <input
                    type="text"
                    value={logroCuota}
                    onChange={(e) => setLogroCuota(e.target.value)}
                    placeholder="ej. 10/6, 1.65, +160"
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-amber-300 placeholder:text-slate-600 focus:border-amber-400 focus:outline-none"
                  />
                  <span className="text-[10px] text-slate-400">
                    Soporta fracciones americanas (10/6), decimales o líneas.
                  </span>
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-cyan-300 mb-1">
                    Pago si Gana ($)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={pagoManual || (pagoPotencialCalculado > 0 ? pagoPotencialCalculado : "")}
                    onChange={(e) => setPagoManual(e.target.value)}
                    placeholder="Calculado automático"
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-black text-cyan-300 placeholder:text-slate-600 focus:border-cyan-400 focus:outline-none"
                  />
                  <span className="text-[10px] text-cyan-400/80">
                    {pagoPotencialCalculado > 0
                      ? `Paga al ganador: $${pagoPotencialCalculado.toFixed(2)}`
                      : "Ingresa cuota o escribe el pago exacto."}
                  </span>
                </div>
              </div>

              {/* Botón de Registro */}
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={guardando}
                  className="w-full rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 py-2.5 text-xs font-black uppercase text-white shadow-lg shadow-purple-950/40 hover:from-purple-500 hover:to-indigo-500 active:scale-95 disabled:opacity-50 transition-all"
                >
                  {guardando ? "Guardando Apuesta…" : "💾 Registrar Apuesta de Evento Libre"}
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-3">
              {/* Barra de Métricas y Filtros */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                <div className="flex items-center gap-3 text-xs">
                  <div>
                    <span className="text-[10px] uppercase text-slate-400 block font-bold">Total Jugado</span>
                    <span className="font-mono font-black text-white">${totalMonto.toFixed(2)}</span>
                  </div>
                  <div className="border-l border-slate-700 pl-3">
                    <span className="text-[10px] uppercase text-slate-400 block font-bold">Pagado Ganadores</span>
                    <span className="font-mono font-black text-cyan-300">${totalPagado.toFixed(2)}</span>
                  </div>
                  <div className="border-l border-slate-700 pl-3">
                    <span className="text-[10px] uppercase text-slate-400 block font-bold">Balance Casa</span>
                    <span
                      className={`font-mono font-black ${
                        balanceCasa >= 0 ? "text-emerald-400" : "text-rose-400"
                      }`}
                    >
                      ${balanceCasa.toFixed(2)}
                    </span>
                  </div>
                </div>

                {/* Filtros */}
                <div className="flex items-center gap-1.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setFiltroEstado("TODOS")}
                    className={`rounded-lg px-2 py-1 text-[11px] font-bold ${
                      filtroEstado === "TODOS" ? "bg-purple-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                    }`}
                  >
                    Todos ({apuestas.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFiltroEstado("PENDIENTE")}
                    className={`rounded-lg px-2 py-1 text-[11px] font-bold ${
                      filtroEstado === "PENDIENTE" ? "bg-amber-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                    }`}
                  >
                    Pendientes ({apuestas.filter((a) => a.estado === "PENDIENTE").length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFiltroEstado("GANADOR")}
                    className={`rounded-lg px-2 py-1 text-[11px] font-bold ${
                      filtroEstado === "GANADOR" ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                    }`}
                  >
                    Ganadores ({apuestas.filter((a) => a.estado === "GANADOR").length})
                  </button>
                </div>
              </div>

              {/* Búsqueda rápida */}
              <div>
                <input
                  type="text"
                  value={busquedaReporte}
                  onChange={(e) => setBusquedaReporte(e.target.value)}
                  placeholder="🔍 Buscar por evento o cliente…"
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-white placeholder:text-slate-600 focus:border-purple-400 focus:outline-none"
                />
              </div>

              {/* Lista compacta de apuestas con Selección de Ganador */}
              {cargando ? (
                <div className="py-8 text-center text-xs text-slate-400">Cargando apuestas…</div>
              ) : apuestasFiltradas.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-800 py-8 text-center text-xs text-slate-500">
                  No hay apuestas registradas {filtroEstado !== "TODOS" ? `con estado ${filtroEstado}` : ""}.
                </div>
              ) : (
                <div className="space-y-2">
                  {apuestasFiltradas.map((ap) => (
                    <div
                      key={ap.id}
                      className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-2xl border p-3 transition-all ${
                        ap.estado === "GANADOR"
                          ? "border-emerald-500/50 bg-emerald-950/20"
                          : ap.estado === "PERDEDOR"
                          ? "border-rose-500/40 bg-rose-950/15 opacity-80"
                          : "border-slate-800 bg-slate-950/80 hover:border-purple-500/30"
                      }`}
                    >
                      {/* Información de la Apuesta */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded-md px-1.5 py-0.5 text-[10px] font-black uppercase ${
                              ap.estado === "GANADOR"
                                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                                : ap.estado === "PERDEDOR"
                                ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                                : "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                            }`}
                          >
                            {ap.estado}
                          </span>
                          <span className="text-[11px] font-bold text-slate-400">
                            {ap.fecha}
                          </span>
                          <span className="truncate text-xs font-black text-white">
                            {ap.evento}
                          </span>
                        </div>

                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-bold text-purple-300">
                            👤 {ap.cliente_nombre}
                          </span>
                          <span className="text-slate-400">·</span>
                          <span className="font-mono text-emerald-300 font-bold">
                            Jugó: ${ap.monto.toFixed(2)}
                          </span>
                          {ap.logro_cuota && (
                            <span className="rounded bg-slate-800 px-1.5 py-0.2 text-[10px] text-amber-300 font-bold">
                              {ap.logro_cuota}
                            </span>
                          )}
                          <span className="text-slate-400">·</span>
                          <span className="font-mono text-cyan-300 font-black">
                            Paga: ${ap.pago_potencial.toFixed(2)}
                          </span>
                        </div>
                      </div>

                      {/* Acciones para Seleccionar Ganador */}
                      <div className="flex items-center gap-1.5 shrink-0 pt-2 sm:pt-0">
                        {ap.estado !== "GANADOR" && (
                          <button
                            type="button"
                            onClick={() => void handleCambiarEstado(ap.id, "GANADOR")}
                            title="Seleccionar como ganador de este evento"
                            className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-2.5 py-1 text-xs font-black text-white hover:bg-emerald-500 active:scale-95 shadow-sm shadow-emerald-950/40 transition-all"
                          >
                            <span>🏆</span>
                            <span>Ganador</span>
                          </button>
                        )}
                        {ap.estado !== "PERDEDOR" && (
                          <button
                            type="button"
                            onClick={() => void handleCambiarEstado(ap.id, "PERDEDOR")}
                            title="Marcar como no ganadora"
                            className="rounded-xl border border-rose-500/40 bg-rose-950/40 px-2 py-1 text-xs font-bold text-rose-300 hover:bg-rose-900/60 transition-all"
                          >
                            ❌
                          </button>
                        )}
                        {ap.estado !== "PENDIENTE" && (
                          <button
                            type="button"
                            onClick={() => void handleCambiarEstado(ap.id, "PENDIENTE")}
                            title="Restablecer a Pendiente"
                            className="rounded-xl border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 transition-all"
                          >
                            🔄
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void handleEliminar(ap.id)}
                          title="Eliminar apuesta"
                          className="rounded-xl p-1 text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition-colors"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Pie */}
        <div className="flex items-center justify-between border-t border-slate-800 bg-slate-950 px-5 py-3">
          <span className="text-[11px] text-slate-400">
            {apuestas.length} apuesta(s) registradas · Evento libre independiente
          </span>
          <button
            type="button"
            onClick={onCerrar}
            className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-1.5 text-xs font-bold text-slate-300 hover:bg-slate-700 hover:text-white transition-all"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
