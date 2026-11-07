"use client";

import React, { useState } from "react";
import type { SalaChat } from "../lib/salas";

export interface GrupoVentaItem {
  id: string | number;
  nombre: string;
}

interface Props {
  // Grupos de Venta disponibles en el sistema
  gruposVenta: GrupoVentaItem[];
  grupoSeleccionadoId: string;
  onCambiarGrupo: (grupoId: string) => void;
  onEditarGrupo?: (grupoId: string, nuevoNombre: string) => Promise<{ ok: boolean; error?: string }>;
  onEliminarGrupo?: (grupoId: string) => Promise<{ ok: boolean; error?: string }>;

  // Salas pertenecientes exclusivamente al grupo seleccionado
  salas: SalaChat[];
  salaActivaId: string;
  onSeleccionarSala: (salaId: string) => void;
  onEditarSala?: (salaId: string, nuevoNombre: string, descripcion?: string) => Promise<{ ok: boolean; error?: string }>;
  onEliminarSala?: (salaId: string) => Promise<{ ok: boolean; error?: string }>;

  nombreUsuario: string;
  esOperadorOAdmin?: boolean;
  esAdmin?: boolean;
  onCrearSala?: (nombre: string, descripcion?: string) => Promise<{ ok: boolean; error?: string }>;
}

const FONT_WHATSAPP = {
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Helvetica, Arial, sans-serif',
};

export function SalaLeftPanelGrupos({
  gruposVenta,
  grupoSeleccionadoId,
  onCambiarGrupo,
  onEditarGrupo,
  onEliminarGrupo,
  salas,
  salaActivaId,
  onSeleccionarSala,
  onEditarSala,
  onEliminarSala,
  nombreUsuario,
  esOperadorOAdmin,
  esAdmin,
  onCrearSala,
}: Props) {
  const [busqueda, setBusqueda] = useState("");

  // Modales de Sala
  const [modalNuevaSala, setModalNuevaSala] = useState(false);
  const [nombreNuevaSala, setNombreNuevaSala] = useState("");
  const [descNuevaSala, setDescNuevaSala] = useState("");
  const [guardandoSala, setGuardandoSala] = useState(false);
  const [errorSala, setErrorSala] = useState<string | null>(null);

  const [salaParaEditar, setSalaParaEditar] = useState<SalaChat | null>(null);
  const [nombreEditSala, setNombreEditSala] = useState("");
  const [descEditSala, setDescEditSala] = useState("");

  const [salaParaEliminar, setSalaParaEliminar] = useState<SalaChat | null>(null);

  // Modales de Grupo
  const [modalEditarGrupo, setModalEditarGrupo] = useState(false);
  const [nombreEditGrupo, setNombreEditGrupo] = useState("");
  const [modalEliminarGrupo, setModalEliminarGrupo] = useState(false);
  const [guardandoGrupo, setGuardandoGrupo] = useState(false);
  const [errorGrupo, setErrorGrupo] = useState<string | null>(null);

  const grupoActivoObj = gruposVenta.find(
    (g) => String(g.id) === String(grupoSeleccionadoId)
  );
  const nombreGrupoActivo = grupoActivoObj?.nombre || "Grupo Oficial";

  const salasFiltradas = salas.filter((s) =>
    s.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
    (s.descripcion && s.descripcion.toLowerCase().includes(busqueda.toLowerCase()))
  );

  // Guardar nueva sala
  const handleGuardarNuevaSala = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombreNuevaSala.trim()) return;
    setGuardandoSala(true);
    setErrorSala(null);
    try {
      if (onCrearSala) {
        const res = await onCrearSala(nombreNuevaSala.trim(), descNuevaSala.trim() || undefined);
        if (res.ok) {
          setNombreNuevaSala("");
          setDescNuevaSala("");
          setModalNuevaSala(false);
        } else {
          setErrorSala(res.error || "No se pudo crear la sala");
        }
      }
    } catch (err: any) {
      setErrorSala(err.message || "Error al crear la sala");
    } finally {
      setGuardandoSala(false);
    }
  };

  // Guardar edición de sala (solo administrador)
  const handleGuardarEdicionSala = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!esAdmin) {
      setErrorSala("Solo los administradores pueden editar salas.");
      return;
    }
    if (!salaParaEditar || !nombreEditSala.trim()) return;
    setGuardandoSala(true);
    setErrorSala(null);
    try {
      if (onEditarSala) {
        const res = await onEditarSala(salaParaEditar.id, nombreEditSala.trim(), descEditSala.trim() || undefined);
        if (res.ok) {
          setSalaParaEditar(null);
        } else {
          setErrorSala(res.error || "No se pudo actualizar la sala");
        }
      }
    } catch (err: any) {
      setErrorSala(err.message || "Error al actualizar la sala");
    } finally {
      setGuardandoSala(false);
    }
  };

  // Confirmar eliminación de sala (solo administrador)
  const handleConfirmarEliminarSala = async () => {
    if (!esAdmin) {
      setErrorSala("Solo los administradores pueden eliminar salas.");
      return;
    }
    if (!salaParaEliminar) return;
    setGuardandoSala(true);
    try {
      if (onEliminarSala) {
        await onEliminarSala(salaParaEliminar.id);
      }
      setSalaParaEliminar(null);
    } catch (err: any) {
      setErrorSala(err.message || "Error al eliminar");
    } finally {
      setGuardandoSala(false);
    }
  };

  // Guardar edición de grupo
  const handleGuardarEdicionGrupo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombreEditGrupo.trim()) return;
    setGuardandoGrupo(true);
    setErrorGrupo(null);
    try {
      if (onEditarGrupo) {
        const res = await onEditarGrupo(grupoSeleccionadoId, nombreEditGrupo.trim());
        if (res.ok) {
          setModalEditarGrupo(false);
        } else {
          setErrorGrupo(res.error || "No se pudo renombrar el grupo");
        }
      }
    } catch (err: any) {
      setErrorGrupo(err.message || "Error al renombrar el grupo");
    } finally {
      setGuardandoGrupo(false);
    }
  };

  // Confirmar eliminación de grupo
  const handleConfirmarEliminarGrupo = async () => {
    setGuardandoGrupo(true);
    try {
      if (onEliminarGrupo) {
        await onEliminarGrupo(grupoSeleccionadoId);
      }
      setModalEliminarGrupo(false);
    } catch (err: any) {
      setErrorGrupo(err.message || "Error al eliminar el grupo");
    } finally {
      setGuardandoGrupo(false);
    }
  };

  return (
    <aside
      style={FONT_WHATSAPP}
      className="flex flex-col h-full w-full sm:w-80 md:w-96 bg-[#111b21] border-r border-[#222e35] text-[#e9edef] select-none antialiased"
    >
      {/* 1. Header estilo WhatsApp Web Desktop */}
      <div className="flex h-16 items-center justify-between bg-[#202c33] px-4 py-2 border-b border-[#222e35]">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#00a884] text-white font-semibold text-lg shadow-sm">
            {nombreUsuario ? nombreUsuario.charAt(0).toUpperCase() : "👤"}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-[14px] font-semibold text-[#e9edef] truncate">{nombreUsuario}</span>
            <span className="text-[12px] text-[#00a884] font-normal flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[#00a884]" /> en línea
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-[#aebac1]">
          <button
            type="button"
            onClick={() => {
              if (typeof window !== "undefined") window.location.href = "/inicio";
            }}
            title="Salir al Sistema Principal"
            className="flex items-center gap-1 text-[12px] bg-[#111b21] hover:bg-black/40 text-[#8696a0] hover:text-white px-2.5 py-1 rounded-full font-medium transition border border-[#2a3942]"
          >
            <span>←</span>
            <span>Salir</span>
          </button>
          {esOperadorOAdmin && (
            <button
              onClick={() => setModalNuevaSala(true)}
              title={`Crear Nueva Sala para ${nombreGrupoActivo}`}
              className="flex items-center gap-1 text-[13px] bg-[#00a884] hover:bg-[#029071] text-white px-3 py-1.5 rounded-full font-medium transition active:scale-95 shadow-sm cursor-pointer"
            >
              <span>+</span>
              <span className="text-[12px]">Nueva Sala</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Barra de Grupo de Venta con opciones Editar / Eliminar */}
      <div className="px-3.5 py-2.5 bg-[#182229] border-b border-[#222e35] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-base text-[#00a884]">📁</span>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-[10px] uppercase font-bold tracking-wider text-[#8696a0]">
              Grupo de Venta
            </span>
            {esOperadorOAdmin && gruposVenta.length > 1 ? (
              <select
                value={String(grupoSeleccionadoId)}
                onChange={(e) => onCambiarGrupo(e.target.value)}
                className="bg-[#202c33] text-[13px] font-semibold text-[#00a884] rounded-md px-2 py-1 border border-[#2a3942] focus:outline-none focus:border-[#00a884] truncate cursor-pointer"
                title="Cambiar grupo de venta"
              >
                {gruposVenta.map((gv) => (
                  <option key={gv.id} value={String(gv.id)} className="bg-[#202c33] text-white">
                    {gv.nombre}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-[13px] font-semibold text-[#00a884] truncate">
                {nombreGrupoActivo}
              </span>
            )}
          </div>
        </div>

        {/* Acciones de Edición / Eliminación de Grupo para Administrador */}
        {esAdmin && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => {
                setNombreEditGrupo(nombreGrupoActivo);
                setErrorGrupo(null);
                setModalEditarGrupo(true);
              }}
              title="Editar nombre del grupo de venta"
              className="p-1.5 text-[#8696a0] hover:text-[#00a884] hover:bg-[#202c33] rounded-md transition cursor-pointer text-xs"
            >
              ✏️
            </button>
            <button
              type="button"
              onClick={() => {
                setErrorGrupo(null);
                setModalEliminarGrupo(true);
              }}
              title="Eliminar o desactivar grupo de venta"
              className="p-1.5 text-[#8696a0] hover:text-red-400 hover:bg-[#202c33] rounded-md transition cursor-pointer text-xs"
            >
              🗑️
            </button>
          </div>
        )}
      </div>

      {/* 3. Buscador estilo WhatsApp Web */}
      <div className="px-3 py-2 bg-[#111b21] border-b border-[#222e35]">
        <div className="flex items-center rounded-lg bg-[#202c33] px-3 py-1.5 gap-2.5 border border-transparent focus-within:border-[#00a884]/70">
          <span className="text-xs text-[#8696a0]">🔍</span>
          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder={`Buscar salas en ${nombreGrupoActivo}...`}
            className="w-full bg-transparent text-[13px] text-[#e9edef] placeholder-[#8696a0] focus:outline-none"
          />
        </div>
      </div>

      {/* 4. Lista de Salas estilo WhatsApp */}
      <div className="flex-1 overflow-y-auto no-scrollbar divide-y divide-[#222e35]/40" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
        {/* Canal Privado con el Agente IA Bot */}
        <div
          onClick={() => onSeleccionarSala("bot-privado")}
          className={`flex items-center gap-3 px-3.5 py-3 cursor-pointer transition-colors ${
            salaActivaId === "bot-privado" ? "bg-[#2a3942]" : "hover:bg-[#202c33]"
          }`}
        >
          <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-[#128c7e] to-[#00a884] text-white text-xl shadow">
            🤖
            <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-emerald-400 border-2 border-[#111b21]" />
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <div className="flex items-center justify-between">
              <span className="text-[14px] font-semibold text-[#e9edef] truncate">Agente IA Oficial (DM)</span>
              <span className="text-[10px] text-[#00a884] font-bold">Oficial</span>
            </div>
            <p className="text-[12px] text-[#8696a0] truncate">
              Consultas privadas de saldo, liquidaciones y jugadas seguras
            </p>
          </div>
        </div>

        {/* Separador de Salas */}
        <div className="flex items-center justify-between px-3.5 py-1.5 bg-[#182229] text-[11px] font-semibold uppercase tracking-wider text-[#8696a0]">
          <span className="truncate">Salas de {nombreGrupoActivo}</span>
          {esOperadorOAdmin && (
            <button
              onClick={() => setModalNuevaSala(true)}
              className="text-[#00a884] hover:underline normal-case font-medium text-[11px] cursor-pointer"
            >
              + Crear sala
            </button>
          )}
        </div>

        {/* Salas del Grupo Activo */}
        {salasFiltradas.length === 0 ? (
          <div className="p-6 text-center text-[12px] text-[#8696a0]">
            <p className="mb-2">No hay salas creadas para este grupo.</p>
            {esOperadorOAdmin && (
              <button
                onClick={() => setModalNuevaSala(true)}
                className="text-[#00a884] font-semibold hover:underline cursor-pointer"
              >
                + Crear la primera sala
              </button>
            )}
          </div>
        ) : (
          salasFiltradas.map((s) => {
            const esActivo = s.id === salaActivaId;
            return (
              <div
                key={s.id}
                onClick={() => onSeleccionarSala(s.id)}
                className={`group flex items-center gap-3 px-3.5 py-3 cursor-pointer transition-colors ${
                  esActivo ? "bg-[#2a3942]" : "hover:bg-[#202c33]"
                }`}
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#1f2c34] text-2xl border border-[#2a3942]">
                  🐎
                </div>
                <div className="flex flex-col min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[14px] font-semibold text-[#e9edef] truncate">{s.nombre}</span>
                    <div className="flex items-center gap-1.5">
                      {s.es_principal && (
                        <span className="flex items-center rounded bg-[#00a884]/20 text-[#00a884] px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wider">
                          Principal
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-[12px] text-[#8696a0]">
                    <span className="truncate">{s.descripcion || "Sala oficial de jugadas P2P"}</span>
                    <span className="text-[10px] text-[#00a884] font-medium">Puestos</span>
                  </div>
                </div>

                {/* Acciones Hover: Editar / Eliminar Sala - Solo Administrador */}
                {esAdmin && (
                  <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 shrink-0 transition-opacity">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSalaParaEditar(s);
                        setNombreEditSala(s.nombre);
                        setDescEditSala(s.descripcion || "");
                        setErrorSala(null);
                      }}
                      title="Editar esta sala"
                      className="p-1 hover:text-[#00a884] text-[#8696a0] rounded transition cursor-pointer text-xs"
                    >
                      ✏️
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSalaParaEliminar(s);
                        setErrorSala(null);
                      }}
                      title="Eliminar esta sala"
                      className="p-1 hover:text-red-400 text-[#8696a0] rounded transition cursor-pointer text-xs"
                    >
                      🗑️
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Modal: Crear Nueva Sala */}
      {modalNuevaSala && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl bg-[#202c33] border border-[#2a3942] p-5 text-[#e9edef] shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between mb-4 border-b border-[#2a3942] pb-3">
              <div>
                <h3 className="text-[15px] font-bold text-[#e9edef] flex items-center gap-2">
                  <span>🏛️</span> Nueva Sala de Chat
                </h3>
                <p className="text-[11px] text-[#00a884] font-medium mt-0.5">
                  Grupo: {nombreGrupoActivo}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalNuevaSala(false)}
                className="text-[#8696a0] hover:text-[#e9edef] text-lg font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleGuardarNuevaSala} className="space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-[#8696a0] mb-1">
                  Nombre de la Sala *
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={nombreNuevaSala}
                  onChange={(e) => setNombreNuevaSala(e.target.value)}
                  placeholder="Ej. Sala Puestos 2, Sala VIP..."
                  className="w-full rounded-lg bg-[#111b21] border border-[#2a3942] px-3 py-2 text-[13px] text-[#e9edef] placeholder-[#8696a0] focus:border-[#00a884] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#8696a0] mb-1">
                  Descripción
                </label>
                <input
                  type="text"
                  value={descNuevaSala}
                  onChange={(e) => setDescNuevaSala(e.target.value)}
                  placeholder="Ej. Exclusivo jugadas directas y paradas"
                  className="w-full rounded-lg bg-[#111b21] border border-[#2a3942] px-3 py-2 text-[13px] text-[#e9edef] placeholder-[#8696a0] focus:border-[#00a884] focus:outline-none"
                />
              </div>

              {errorSala && (
                <div className="rounded-lg bg-red-950/60 border border-red-800/80 p-2.5 text-xs text-red-300">
                  ⚠️ {errorSala}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalNuevaSala(false)}
                  className="rounded-lg bg-[#111b21] px-3.5 py-2 text-[12px] font-medium text-[#8696a0] hover:text-[#e9edef] hover:bg-[#2a3942] cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardandoSala || !nombreNuevaSala.trim()}
                  className="flex items-center gap-1.5 rounded-lg bg-[#00a884] hover:bg-[#029071] px-4 py-2 text-[12px] font-bold text-white disabled:opacity-50 active:scale-95 transition cursor-pointer"
                >
                  {guardandoSala ? "Creando..." : "Crear en este Grupo"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Editar Sala Existente */}
      {salaParaEditar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl bg-[#202c33] border border-[#2a3942] p-5 text-[#e9edef] shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between mb-4 border-b border-[#2a3942] pb-3">
              <div>
                <h3 className="text-[15px] font-bold text-[#e9edef] flex items-center gap-2">
                  <span>✏️</span> Editar Sala
                </h3>
                <p className="text-[11px] text-[#00a884] font-medium mt-0.5">
                  Grupo: {nombreGrupoActivo}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSalaParaEditar(null)}
                className="text-[#8696a0] hover:text-[#e9edef] text-lg font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleGuardarEdicionSala} className="space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-[#8696a0] mb-1">
                  Nombre de la Sala *
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={nombreEditSala}
                  onChange={(e) => setNombreEditSala(e.target.value)}
                  className="w-full rounded-lg bg-[#111b21] border border-[#2a3942] px-3 py-2 text-[13px] text-[#e9edef] placeholder-[#8696a0] focus:border-[#00a884] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#8696a0] mb-1">
                  Descripción
                </label>
                <input
                  type="text"
                  value={descEditSala}
                  onChange={(e) => setDescEditSala(e.target.value)}
                  className="w-full rounded-lg bg-[#111b21] border border-[#2a3942] px-3 py-2 text-[13px] text-[#e9edef] placeholder-[#8696a0] focus:border-[#00a884] focus:outline-none"
                />
              </div>

              {errorSala && (
                <div className="rounded-lg bg-red-950/60 border border-red-800/80 p-2.5 text-xs text-red-300">
                  ⚠️ {errorSala}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSalaParaEditar(null)}
                  className="rounded-lg bg-[#111b21] px-3.5 py-2 text-[12px] font-medium text-[#8696a0] hover:text-[#e9edef] hover:bg-[#2a3942] cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardandoSala || !nombreEditSala.trim()}
                  className="flex items-center gap-1.5 rounded-lg bg-[#00a884] hover:bg-[#029071] px-4 py-2 text-[12px] font-bold text-white disabled:opacity-50 active:scale-95 transition cursor-pointer"
                >
                  {guardandoSala ? "Guardando..." : "Guardar Cambios"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Confirmar Eliminar Sala */}
      {salaParaEliminar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl bg-[#202c33] border border-[#2a3942] p-5 text-[#e9edef] shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <h3 className="text-[15px] font-bold text-red-400 flex items-center gap-2 mb-2">
              <span>🗑️</span> ¿Eliminar Sala?
            </h3>
            <p className="text-[13px] text-[#e9edef] mb-3">
              ¿Estás seguro de que deseas eliminar la sala <b>{salaParaEliminar.nombre}</b>?
            </p>
            <p className="text-[11px] text-[#8696a0] mb-4">
              Esta acción no se puede deshacer y retirará la sala de este grupo.
            </p>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setSalaParaEliminar(null)}
                className="rounded-lg bg-[#111b21] px-3.5 py-2 text-[12px] font-medium text-[#8696a0] hover:text-[#e9edef] hover:bg-[#2a3942] cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={guardandoSala}
                onClick={handleConfirmarEliminarSala}
                className="flex items-center gap-1.5 rounded-lg bg-red-600 hover:bg-red-700 px-4 py-2 text-[12px] font-bold text-white disabled:opacity-50 active:scale-95 transition cursor-pointer"
              >
                {guardandoSala ? "Eliminando..." : "Sí, Eliminar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Editar Grupo de Venta */}
      {modalEditarGrupo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl bg-[#202c33] border border-[#2a3942] p-5 text-[#e9edef] shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between mb-4 border-b border-[#2a3942] pb-3">
              <h3 className="text-[15px] font-bold text-[#e9edef] flex items-center gap-2">
                <span>📁</span> Renombrar Grupo
              </h3>
              <button
                type="button"
                onClick={() => setModalEditarGrupo(false)}
                className="text-[#8696a0] hover:text-[#e9edef] text-lg font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleGuardarEdicionGrupo} className="space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-[#8696a0] mb-1">
                  Nombre del Grupo de Venta *
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={nombreEditGrupo}
                  onChange={(e) => setNombreEditGrupo(e.target.value)}
                  className="w-full rounded-lg bg-[#111b21] border border-[#2a3942] px-3 py-2 text-[13px] text-[#e9edef] placeholder-[#8696a0] focus:border-[#00a884] focus:outline-none uppercase"
                />
              </div>

              {errorGrupo && (
                <div className="rounded-lg bg-red-950/60 border border-red-800/80 p-2.5 text-xs text-red-300">
                  ⚠️ {errorGrupo}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalEditarGrupo(false)}
                  className="rounded-lg bg-[#111b21] px-3.5 py-2 text-[12px] font-medium text-[#8696a0] hover:text-[#e9edef] hover:bg-[#2a3942] cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardandoGrupo || !nombreEditGrupo.trim()}
                  className="flex items-center gap-1.5 rounded-lg bg-[#00a884] hover:bg-[#029071] px-4 py-2 text-[12px] font-bold text-white disabled:opacity-50 active:scale-95 transition cursor-pointer"
                >
                  {guardandoGrupo ? "Guardando..." : "Guardar Nombre"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Confirmar Eliminar Grupo de Venta */}
      {modalEliminarGrupo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl bg-[#202c33] border border-[#2a3942] p-5 text-[#e9edef] shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <h3 className="text-[15px] font-bold text-red-400 flex items-center gap-2 mb-2">
              <span>🗑️</span> ¿Eliminar Grupo de Venta?
            </h3>
            <p className="text-[13px] text-[#e9edef] mb-3">
              ¿Estás seguro de que deseas eliminar o desactivar el grupo <b>{nombreGrupoActivo}</b>?
            </p>
            <p className="text-[11px] text-[#8696a0] mb-4">
              Esto desactivará el grupo y todas sus salas asociadas.
            </p>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalEliminarGrupo(false)}
                className="rounded-lg bg-[#111b21] px-3.5 py-2 text-[12px] font-medium text-[#8696a0] hover:text-[#e9edef] hover:bg-[#2a3942] cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={guardandoGrupo}
                onClick={handleConfirmarEliminarGrupo}
                className="flex items-center gap-1.5 rounded-lg bg-red-600 hover:bg-red-700 px-4 py-2 text-[12px] font-bold text-white disabled:opacity-50 active:scale-95 transition cursor-pointer"
              >
                {guardandoGrupo ? "Eliminando..." : "Sí, Eliminar Grupo"}
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
