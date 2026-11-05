"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ETIQUETAS_MODALIDAD,
  listarCargasRapidas,
  realizarCargaRapidaSaldoYAval,
  anexarSoporteCargaRapida,
  verificarCargaRapidaAdmin,
  type CargaRapidaRegistro,
  type ModalidadCargaRapida,
} from "@/features/contabilidad/lib/cargas-rapidas-saldo";
import { listarClientesVenta, type ClienteVenta } from "@/features/grupos/lib/grupos";
import { emitirToast } from "@/shared/lib/mensajeria";
import { useAuthStore } from "@/shared/store/useAuthStore";

type Props = {
  abierto: boolean;
  onCerrar: () => void;
  clienteInicialId?: string;
  onCompletado?: () => void;
};

export function ModalCargaRapidaSaldoYAval({
  abierto,
  onCerrar,
  clienteInicialId,
  onCompletado,
}: Props) {
  const usuario = useAuthStore((s) => s.usuario);
  const esPrincipal = useAuthStore((s) => s.esPrincipal);

  const [pestana, setPestana] = useState<"formulario" | "tareas">("formulario");
  const [clientes, setClientes] = useState<ClienteVenta[]>([]);
  const [busquedaCliente, setBusquedaCliente] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [modalidad, setModalidad] = useState<ModalidadCargaRapida>("SUMAR_POZO");
  const [monto, setMonto] = useState("");
  const [nota, setNota] = useState("");

  // Soporte voluntario preliminar
  const [captureDataUrl, setCaptureDataUrl] = useState("");
  const [bancoNombre, setBancoNombre] = useState("");
  const [referencia, setReferencia] = useState("");

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lista de tareas pendientes
  const [cargas, setCargas] = useState<CargaRapidaRegistro[]>([]);
  const [filtroEstado, setFiltroEstado] = useState<"TODAS" | "PENDIENTES" | "ANEXADAS" | "VERIFICADAS">("TODAS");

  // Modal de anexar soporte a una tarea existente
  const [tareaSeleccionada, setTareaSeleccionada] = useState<CargaRapidaRegistro | null>(null);
  const [soporteModalAbierto, setSoporteModalAbierto] = useState(false);
  const [soporteImgTemp, setSoporteImgTemp] = useState("");
  const [bancoTemp, setBancoTemp] = useState("");
  const [refTemp, setRefTemp] = useState("");
  const [verCaptureGrande, setVerCaptureGrande] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const cargarDatos = async () => {
    try {
      const [cls, list] = await Promise.all([
        listarClientesVenta(),
        listarCargasRapidas(),
      ]);
      setClientes(cls);
      setCargas(list);
      if (clienteInicialId && !clienteId) {
        setClienteId(clienteInicialId);
        const match = cls.find((c) => String(c.id) === String(clienteInicialId));
        if (match) setBusquedaCliente(match.nombre);
      }
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (!abierto) return;
    void cargarDatos();
    const handler = () => void cargarDatos();
    window.addEventListener("hipico:cargas-rapidas-actualizadas", handler);
    return () => window.removeEventListener("hipico:cargas-rapidas-actualizadas", handler);
  }, [abierto, clienteInicialId]);

  // Soporte para pegar capture con Ctrl+V
  useEffect(() => {
    if (!abierto) return;
    const onPaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const f = item.getAsFile();
          if (f) {
            e.preventDefault();
            const reader = new FileReader();
            reader.onload = () => {
              const res = String(reader.result ?? "");
              if (soporteModalAbierto) {
                setSoporteImgTemp(res);
              } else {
                setCaptureDataUrl(res);
              }
              emitirToast("📸 Imagen de comprobante pegada desde el portapapeles.", "info");
            };
            reader.readAsDataURL(f);
            break;
          }
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [abierto, soporteModalAbierto]);

  const clienteSeleccionado = useMemo(() => {
    return (
      clientes.find((c) => String(c.id) === String(clienteId)) ||
      clientes.find((c) => c.nombre.trim().toUpperCase() === busquedaCliente.trim().toUpperCase()) ||
      null
    );
  }, [clientes, clienteId, busquedaCliente]);

  const clientesFiltrados = useMemo(() => {
    const q = busquedaCliente.trim().toUpperCase();
    if (!q) return clientes.slice(0, 20);
    return clientes.filter((c) => c.nombre.toUpperCase().includes(q)).slice(0, 20);
  }, [clientes, busquedaCliente]);

  // Cálculo de vista previa
  const { valorAnterior, valorNuevo } = useMemo(() => {
    if (!clienteSeleccionado) return { valorAnterior: 0, valorNuevo: 0 };
    const m = parseFloat(monto.replace(",", ".")) || 0;
    const saldo = Number(clienteSeleccionado.saldo_actual || 0);
    const aval = Number(clienteSeleccionado.aval || 0);

    if (modalidad === "COLOCAR_AVAL") {
      return { valorAnterior: aval, valorNuevo: m };
    }
    if (modalidad === "SUMAR_AVAL") {
      return { valorAnterior: aval, valorNuevo: aval + m };
    }
    if (modalidad === "COLOCAR_POZO") {
      return { valorAnterior: saldo, valorNuevo: m };
    }
    return { valorAnterior: saldo, valorNuevo: saldo + m };
  }, [clienteSeleccionado, modalidad, monto]);

  if (!abierto) return null;

  const tareasPendientesTotal = cargas.filter((c) => c.estado_soporte !== "VERIFICADO_ADMIN").length;

  const cargasFiltradas = cargas.filter((c) => {
    if (filtroEstado === "PENDIENTES") return c.estado_soporte === "PENDIENTE_SOPORTE";
    if (filtroEstado === "ANEXADAS") return c.estado_soporte === "SOPORTE_ANEXADO";
    if (filtroEstado === "VERIFICADAS") return c.estado_soporte === "VERIFICADO_ADMIN";
    return true;
  });

  const handleCargaRapida = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!clienteSeleccionado) {
      setError("Seleccione un cliente de la lista.");
      return;
    }
    const montoNum = parseFloat(monto.replace(",", "."));
    if (!Number.isFinite(montoNum) || montoNum <= 0) {
      setError("Ingrese un monto válido mayor a 0.");
      return;
    }

    setGuardando(true);
    try {
      const res = await realizarCargaRapidaSaldoYAval({
        cliente_id: String(clienteSeleccionado.id),
        cliente_nombre: clienteSeleccionado.nombre,
        modalidad,
        monto: montoNum,
        nota: nota.trim(),
        comprobante_imagen: captureDataUrl || null,
        banco_nombre: bancoNombre.trim() || null,
        referencia: referencia.trim() || null,
      });

      if (!res.ok) {
        setError(res.error || "No se pudo realizar la carga rápida.");
        return;
      }

      emitirToast(
        `⚡ ${ETIQUETAS_MODALIDAD[modalidad].titulo} aplicada con éxito a ${clienteSeleccionado.nombre}: $${valorAnterior.toFixed(
          2
        )} → $${valorNuevo.toFixed(2)}. ${
          captureDataUrl
            ? "Comprobante preliminar registrado."
            : "Queda registrada como tarea pendiente para anexar soporte."
        }`,
        "success"
      );

      // Limpiar y resetear
      setMonto("");
      setNota("");
      setCaptureDataUrl("");
      setBancoNombre("");
      setReferencia("");
      void cargarDatos();

      if (onCompletado) onCompletado();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error inesperado.";
      setError(msg);
    } finally {
      setGuardando(false);
    }
  };

  const handleAbrirAnexarSoporte = (tarea: CargaRapidaRegistro) => {
    setTareaSeleccionada(tarea);
    setSoporteImgTemp(tarea.comprobante_imagen || "");
    setBancoTemp(tarea.banco_nombre || "");
    setRefTemp(tarea.referencia || "");
    setSoporteModalAbierto(true);
  };

  const handleGuardarSoporte = async () => {
    if (!tareaSeleccionada) return;
    if (!soporteImgTemp.trim()) {
      emitirToast("Debe anexar o pegar el capture del comprobante.", "warning");
      return;
    }
    const res = await anexarSoporteCargaRapida({
      id: tareaSeleccionada.id,
      comprobante_imagen: soporteImgTemp,
      banco_nombre: bancoTemp.trim(),
      referencia: refTemp.trim(),
    });

    if (res.ok) {
      emitirToast("📋 Soporte anexado correctamente a la carga rápida.", "success");
      setSoporteModalAbierto(false);
      setTareaSeleccionada(null);
      void cargarDatos();
    } else {
      emitirToast(res.error || "No se pudo guardar el soporte.", "error");
    }
  };

  const handleVerificarAdmin = async (id: string) => {
    const res = await verificarCargaRapidaAdmin(id);
    if (res.ok) {
      emitirToast("✅ Incremento de saldo verificado y conciliado por administración.", "success");
      void cargarDatos();
    } else {
      emitirToast(res.error || "No se pudo verificar el registro.", "error");
    }
  };

  return (
    <div
      className="fixed inset-0 z-[75] flex items-center justify-center overflow-y-auto bg-black/80 p-3 sm:p-5 backdrop-blur-sm animate-fadeIn"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative w-full max-w-3xl overflow-hidden rounded-3xl border border-amber-500/30 bg-slate-950 text-white shadow-2xl">
        {/* Cabecera */}
        <div className="relative bg-gradient-to-r from-slate-950 via-slate-900 to-amber-950/60 p-5 border-b border-amber-500/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-500 text-2xl shadow-lg shadow-amber-500/20 text-slate-950 font-black">
                ⚡
              </span>
              <div>
                <h2 className="text-lg font-black text-white tracking-tight">
                  Carga Rápida de Saldo & Aval
                </h2>
                <p className="text-xs text-amber-300">
                  Acredita saldo o aval de inmediato · Comprobante diferido como tarea pendiente
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onCerrar}
              className="h-8 w-8 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center transition"
            >
              ✕
            </button>
          </div>

          {/* Pestañas de Navegación */}
          <div className="mt-4 flex gap-2 border-b border-slate-800">
            <button
              type="button"
              onClick={() => setPestana("formulario")}
              className={`pb-2 px-3 text-xs font-black uppercase tracking-wider transition border-b-2 ${
                pestana === "formulario"
                  ? "border-amber-400 text-amber-400"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              ⚡ Nueva Carga Rápida
            </button>
            <button
              type="button"
              onClick={() => setPestana("tareas")}
              className={`pb-2 px-3 text-xs font-black uppercase tracking-wider transition border-b-2 flex items-center gap-1.5 ${
                pestana === "tareas"
                  ? "border-amber-400 text-amber-400"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              <span>📋 Tareas Pendientes & Auditoría</span>
              {tareasPendientesTotal > 0 && (
                <span className="rounded-full bg-amber-500 px-1.5 py-0.2 text-[10px] font-black text-slate-950">
                  {tareasPendientesTotal}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* =========================================================================
            PESTAÑA 1: FORMULARIO DE CARGA RÁPIDA
            ========================================================================= */}
        {pestana === "formulario" && (
          <form onSubmit={handleCargaRapida} className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
            {error && (
              <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300">
                ⚠️ {error}
              </div>
            )}

            {/* Aviso de Sin Comprobante / Tarea Pendiente */}
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-200 leading-relaxed flex items-start gap-3">
              <span className="text-xl">ℹ️</span>
              <div className="flex-1">
                <span className="font-bold">No se necesita comprobante en este momento:</span> El saldo o aval se acreditará inmediatamente en la cuenta del cliente para que no se detenga. Quedará registrado como <b>tarea pendiente</b> para que el operador anexe el voucher o la administración verifique el incremento.
              </div>
            </div>

            {/* Selector de Cliente */}
            <div>
              <label className="block text-[11px] font-black uppercase text-slate-300 mb-1">
                Cliente / Jugador / Sala *
              </label>
              <div className="relative">
                <input
                  type="text"
                  required
                  value={busquedaCliente}
                  onChange={(e) => {
                    setBusquedaCliente(e.target.value);
                    setClienteId("");
                  }}
                  placeholder="Escriba el nombre o seudónimo del cliente..."
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-xs font-bold text-white placeholder-slate-500 outline-none focus:border-amber-400"
                />
                {busquedaCliente && !clienteSeleccionado && (
                  <div className="absolute left-0 right-0 top-full mt-1 z-20 max-h-48 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-1 shadow-2xl">
                    {clientesFiltrados.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setClienteId(String(c.id));
                          setBusquedaCliente(c.nombre);
                        }}
                        className="w-full text-left p-2 rounded-lg text-xs hover:bg-slate-800 flex items-center justify-between"
                      >
                        <span className="font-bold text-white">{c.nombre}</span>
                        <div className="text-[10px] text-slate-400 space-x-2">
                          <span>Pozo: ${Number(c.saldo_actual || 0).toFixed(2)}</span>
                          <span>· Aval: ${Number(c.aval || 0).toFixed(2)}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {clienteSeleccionado && (
                <div className="mt-1.5 flex items-center gap-3 text-[11px] bg-slate-900/60 border border-slate-800 rounded-lg p-2 text-slate-300">
                  <span>
                    👤 Seleccionado: <b className="text-white">{clienteSeleccionado.nombre}</b>
                  </span>
                  <span>|</span>
                  <span>
                    Pozo actual: <b className="text-emerald-400">${Number(clienteSeleccionado.saldo_actual || 0).toFixed(2)}</b>
                  </span>
                  <span>|</span>
                  <span>
                    Aval actual: <b className="text-amber-400">${Number(clienteSeleccionado.aval || 0).toFixed(2)}</b>
                  </span>
                </div>
              )}
            </div>

            {/* Las 4 Modalidades Solicitadas */}
            <div>
              <label className="block text-[11px] font-black uppercase text-slate-300 mb-2">
                Seleccione la Operación a Realizar *
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {(Object.keys(ETIQUETAS_MODALIDAD) as ModalidadCargaRapida[]).map((mod) => {
                  const cfg = ETIQUETAS_MODALIDAD[mod];
                  const sel = modalidad === mod;
                  return (
                    <button
                      key={mod}
                      type="button"
                      onClick={() => setModalidad(mod)}
                      className={`flex items-start gap-3 p-3 rounded-2xl border text-left transition-all ${
                        sel
                          ? "border-amber-400 bg-amber-500/20 text-white shadow-md ring-1 ring-amber-400"
                          : "border-slate-800 bg-slate-900/60 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                      }`}
                    >
                      <span className="text-2xl mt-0.5">{cfg.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-black text-xs uppercase leading-tight text-white">
                          {cfg.titulo}
                        </div>
                        <p className="mt-1 text-[10px] text-slate-400 leading-snug">
                          {cfg.desc}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Monto y Cálculo */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
              <div>
                <label className="block text-[11px] font-black uppercase text-slate-300 mb-1">
                  Monto ($ / USD) *
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-500 font-bold">
                    $
                  </span>
                  <input
                    type="text"
                    required
                    value={monto}
                    onChange={(e) => setMonto(e.target.value.replace(/[^0-9.,]/g, ""))}
                    placeholder="0.00"
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 pl-7 pr-3 py-2.5 text-base font-black text-white outline-none focus:border-amber-400"
                  />
                </div>
              </div>

              {/* Vista previa en tiempo real */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3 text-xs">
                <div className="text-[10px] uppercase font-bold text-slate-400">
                  {ETIQUETAS_MODALIDAD[modalidad].campo === "aval" ? "Aval del Cliente" : "Pozo del Cliente"}
                </div>
                <div className="mt-1 flex items-center gap-2 font-black text-sm">
                  <span className="text-slate-400">${valorAnterior.toFixed(2)}</span>
                  <span className="text-slate-500">→</span>
                  <span className="text-emerald-400 text-base">${valorNuevo.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Nota u Observación (Opcional) */}
            <div>
              <label className="block text-[11px] font-black uppercase text-slate-300 mb-1">
                Nota u Observación (Opcional)
              </label>
              <input
                type="text"
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                placeholder="Ej: Autorizado por José vía llamada / Pago pendiente de reporte..."
                className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-amber-400"
              />
            </div>

            {/* Sección de Comprobante Voluntario (Opcional) */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-300">
                  📎 Anexar Comprobante Ahora (Opcional · Puedes hacerlo después)
                </span>
                {captureDataUrl && (
                  <button
                    type="button"
                    onClick={() => setCaptureDataUrl("")}
                    className="text-[10px] text-red-400 hover:underline"
                  >
                    Quitar comprobante
                  </button>
                )}
              </div>

              {!captureDataUrl ? (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-700 hover:border-amber-400 rounded-xl p-3 text-center cursor-pointer transition text-xs text-slate-400"
                >
                  <span>📷 Haz clic para subir imagen o <b>pega con Ctrl+V</b></span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        const r = new FileReader();
                        r.onload = () => setCaptureDataUrl(String(r.result ?? ""));
                        r.readAsDataURL(f);
                      }
                    }}
                  />
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <img
                    src={captureDataUrl}
                    alt="Capture"
                    className="h-12 w-12 object-cover rounded-lg border border-slate-700 cursor-pointer"
                    onClick={() => setVerCaptureGrande(captureDataUrl)}
                  />
                  <div className="grid grid-cols-2 gap-2 flex-1">
                    <input
                      type="text"
                      value={bancoNombre}
                      onChange={(e) => setBancoNombre(e.target.value)}
                      placeholder="Banco (ej: Banesco)"
                      className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-white"
                    />
                    <input
                      type="text"
                      value={referencia}
                      onChange={(e) => setReferencia(e.target.value)}
                      placeholder="N° Referencia"
                      className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-white"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Botón de Acción Inmediata */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={guardando}
                className="w-full rounded-2xl bg-gradient-to-r from-amber-500 via-amber-600 to-amber-500 py-3 text-xs font-black uppercase tracking-wider text-slate-950 shadow-xl shadow-amber-500/20 hover:brightness-110 active:scale-95 transition disabled:opacity-50"
              >
                {guardando ? "Acreditando saldo..." : "⚡ Acreditar Saldo Inmediatamente"}
              </button>
            </div>
          </form>
        )}

        {/* =========================================================================
            PESTAÑA 2: TAREAS PENDIENTES & AUDITORÍA
            ========================================================================= */}
        {pestana === "tareas" && (
          <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
            {/* Filtros de Estado */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <div className="flex gap-1.5 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setFiltroEstado("TODAS")}
                  className={`rounded-lg px-2.5 py-1 text-[11px] transition ${
                    filtroEstado === "TODAS"
                      ? "bg-slate-700 text-white"
                      : "bg-slate-900 text-slate-400 hover:text-white"
                  }`}
                >
                  Todas ({cargas.length})
                </button>
                <button
                  type="button"
                  onClick={() => setFiltroEstado("PENDIENTES")}
                  className={`rounded-lg px-2.5 py-1 text-[11px] transition ${
                    filtroEstado === "PENDIENTES"
                      ? "bg-amber-500 text-slate-950 font-black"
                      : "bg-slate-900 text-amber-400 hover:text-amber-300"
                  }`}
                >
                  🟡 Pendientes de Soporte ({cargas.filter((c) => c.estado_soporte === "PENDIENTE_SOPORTE").length})
                </button>
                <button
                  type="button"
                  onClick={() => setFiltroEstado("ANEXADAS")}
                  className={`rounded-lg px-2.5 py-1 text-[11px] transition ${
                    filtroEstado === "ANEXADAS"
                      ? "bg-blue-600 text-white"
                      : "bg-slate-900 text-blue-400 hover:text-blue-300"
                  }`}
                >
                  🔵 Soporte Anexado ({cargas.filter((c) => c.estado_soporte === "SOPORTE_ANEXADO").length})
                </button>
                <button
                  type="button"
                  onClick={() => setFiltroEstado("VERIFICADAS")}
                  className={`rounded-lg px-2.5 py-1 text-[11px] transition ${
                    filtroEstado === "VERIFICADAS"
                      ? "bg-emerald-600 text-white"
                      : "bg-slate-900 text-emerald-400 hover:text-emerald-300"
                  }`}
                >
                  🟢 Verificadas ({cargas.filter((c) => c.estado_soporte === "VERIFICADO_ADMIN").length})
                </button>
              </div>

              <button
                type="button"
                onClick={() => void cargarDatos()}
                className="text-[11px] font-bold text-slate-400 hover:text-white"
              >
                🔄 Actualizar
              </button>
            </div>

            {/* Listado de Cargas */}
            {cargasFiltradas.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-500">
                No hay cargas rápidas registradas en esta categoría.
              </div>
            ) : (
              <div className="space-y-3">
                {cargasFiltradas.map((c) => {
                  const cfg = ETIQUETAS_MODALIDAD[c.modalidad];
                  const esPendienteSoporte = c.estado_soporte === "PENDIENTE_SOPORTE";
                  const esAnexado = c.estado_soporte === "SOPORTE_ANEXADO";
                  const esVerificado = c.estado_soporte === "VERIFICADO_ADMIN";

                  return (
                    <div
                      key={c.id}
                      className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-2 hover:border-slate-700 transition"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xl">{cfg?.emoji || "⚡"}</span>
                          <div>
                            <span className="font-black text-sm text-white">
                              {c.cliente_nombre}
                            </span>
                            <span className="ml-2 rounded bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                              {cfg?.titulo || c.modalidad}
                            </span>
                          </div>
                        </div>

                        {/* Badges de Estado */}
                        <div>
                          {esPendienteSoporte && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2.5 py-0.5 text-[10px] font-black text-amber-300 border border-amber-500/30">
                              <span>🟡</span>
                              <span>PENDIENTE DE SOPORTE</span>
                            </span>
                          )}
                          {esAnexado && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/20 px-2.5 py-0.5 text-[10px] font-black text-blue-300 border border-blue-500/30">
                              <span>🔵</span>
                              <span>SOPORTE ANEXADO · POR VERIFICAR</span>
                            </span>
                          )}
                          {esVerificado && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[10px] font-black text-emerald-300 border border-emerald-500/30">
                              <span>🟢</span>
                              <span>VERIFICADO Y CONCILIADO</span>
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Detalles Financieros y Metadatos */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] bg-slate-950/60 rounded-xl p-2.5 border border-slate-800/80">
                        <div>
                          <span className="text-slate-500 block text-[9px] uppercase font-bold">Monto Cargado</span>
                          <span className="font-black text-emerald-400 text-xs">${c.monto.toFixed(2)}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block text-[9px] uppercase font-bold">Ajuste</span>
                          <span className="font-bold text-slate-300 text-[10px]">
                            ${c.valor_anterior.toFixed(2)} → ${c.valor_nuevo.toFixed(2)}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block text-[9px] uppercase font-bold">Operador / Fecha</span>
                          <span className="text-slate-400 text-[10px]">
                            {c.operador} · {new Date(c.fecha_creacion).toLocaleDateString()}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block text-[9px] uppercase font-bold">Referencia / Banco</span>
                          <span className="text-slate-300 text-[10px] truncate block">
                            {c.referencia || "Sin referencia"}
                          </span>
                        </div>
                      </div>

                      {/* Nota u Observación */}
                      {c.nota && (
                        <p className="text-[11px] text-slate-400 italic">
                          💬 &ldquo;{c.nota}&rdquo;
                        </p>
                      )}

                      {/* Acciones para Operador y Administración */}
                      <div className="pt-1 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80">
                        <div className="flex items-center gap-2">
                          {c.comprobante_imagen && (
                            <button
                              type="button"
                              onClick={() => setVerCaptureGrande(c.comprobante_imagen || null)}
                              className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-bold text-slate-200 hover:text-white transition inline-flex items-center gap-1"
                            >
                              <span>👁️</span> Ver Capture
                            </button>
                          )}

                          {/* Botón para que el Operador o Admin anexe soporte */}
                          <button
                            type="button"
                            onClick={() => handleAbrirAnexarSoporte(c)}
                            className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11px] font-bold text-amber-300 hover:bg-amber-500/20 transition inline-flex items-center gap-1"
                          >
                            <span>📎</span>
                            <span>{c.comprobante_imagen ? "Modificar Soporte" : "Anexar Soporte"}</span>
                          </button>
                        </div>

                        {/* Botón de Verificación para Administración */}
                        {!esVerificado && (
                          <button
                            type="button"
                            onClick={() => void handleVerificarAdmin(c.id)}
                            className="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-1 text-[11px] font-black uppercase text-white shadow-sm transition inline-flex items-center gap-1"
                          >
                            <span>✅</span>
                            <span>Verificar y Conciliar</span>
                          </button>
                        )}

                        {esVerificado && c.verificado_por && (
                          <span className="text-[10px] text-emerald-400 font-bold">
                            ✓ Verificado por {c.verificado_por}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* =========================================================================
          SUB-MODAL: ANEXAR SOPORTE / VOUCHER
          ========================================================================= */}
      {soporteModalAbierto && tareaSeleccionada && (
        <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/85 p-4">
          <div className="w-full max-w-md rounded-2xl border border-amber-500/30 bg-slate-900 p-5 space-y-4 text-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h3 className="font-black text-sm text-white">
                📎 Anexar Soporte a Carga Rápida
              </h3>
              <button
                type="button"
                onClick={() => setSoporteModalAbierto(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="text-xs text-slate-300">
              Cliente: <b>{tareaSeleccionada.cliente_nombre}</b> · Monto: <b>${tareaSeleccionada.monto.toFixed(2)}</b>
            </div>

            {/* Subida o Pegado de Imagen */}
            <div>
              <label className="block text-[11px] font-bold text-slate-300 mb-1">
                Capture de Pantalla / Voucher (Pega con Ctrl+V) *
              </label>
              {!soporteImgTemp ? (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-700 hover:border-amber-400 rounded-xl p-5 text-center cursor-pointer transition text-xs text-slate-400"
                >
                  📷 Haz clic para seleccionar archivo o <b>pega con Ctrl+V</b>
                </div>
              ) : (
                <div className="relative">
                  <img
                    src={soporteImgTemp}
                    alt="Soporte"
                    className="max-h-48 w-full object-contain rounded-xl border border-slate-700 bg-black/50"
                  />
                  <button
                    type="button"
                    onClick={() => setSoporteImgTemp("")}
                    className="absolute top-2 right-2 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold text-white shadow-md"
                  >
                    Quitar
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-1">
                  Banco / Vía
                </label>
                <input
                  type="text"
                  value={bancoTemp}
                  onChange={(e) => setBancoTemp(e.target.value)}
                  placeholder="Ej: Pago Móvil Banesco / Zelle"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-1">
                  N° Referencia
                </label>
                <input
                  type="text"
                  value={refTemp}
                  onChange={(e) => setRefTemp(e.target.value)}
                  placeholder="Ej: 984523"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
                />
              </div>
            </div>

            <div className="pt-2 flex gap-2">
              <button
                type="button"
                onClick={() => setSoporteModalAbierto(false)}
                className="w-1/2 rounded-xl border border-slate-700 py-2 text-xs font-bold text-slate-300 hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleGuardarSoporte}
                className="w-1/2 rounded-xl bg-amber-500 hover:bg-amber-400 py-2 text-xs font-black uppercase text-slate-950 shadow-md"
              >
                Guardar Soporte
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          VISOR DE CAPTURE EN GRANDE
          ========================================================================= */}
      {verCaptureGrande && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/90 p-4"
          onClick={() => setVerCaptureGrande(null)}
        >
          <div className="relative max-w-2xl max-h-[90vh]">
            <img
              src={verCaptureGrande}
              alt="Capture Completo"
              className="max-h-[85vh] w-auto rounded-2xl border border-slate-700 object-contain shadow-2xl"
            />
            <button
              type="button"
              onClick={() => setVerCaptureGrande(null)}
              className="absolute top-3 right-3 rounded-full bg-slate-900/90 p-2 text-white hover:bg-black"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
