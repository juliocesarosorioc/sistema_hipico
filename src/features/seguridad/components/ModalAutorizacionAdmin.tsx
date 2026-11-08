"use client";

import React, { useState } from "react";
import { verificarPasswordAdmin, registrarAutorizacionVentaFueraLimite } from "@/features/seguridad/lib/autorizacion-admin";
import { useAuthStore } from "@/shared/store/useAuthStore";
import { esPerfilAdministradorVigente } from "@/features/seguridad/lib/vigente";

export type ModalAutorizacionAdminProps = {
  abierto: boolean;
  onCerrar: () => void;
  onAutorizado: (adminUser: string) => void | Promise<void>;
  titulo?: string;
  motivo: string;
  modalidad: "TABLAS_FIJAS" | "MARCAS";
  grupoNombre: string;
  jugadorNombre: string;
  monto: number;
  cantidad?: number;
  limiteEstablecido?: string | number;
};

export function ModalAutorizacionAdmin({
  abierto,
  onCerrar,
  onAutorizado,
  titulo = "Autorización de Administrador Requerida",
  motivo,
  modalidad,
  grupoNombre,
  jugadorNombre,
  monto,
  cantidad,
  limiteEstablecido,
}: ModalAutorizacionAdminProps) {
  const usuarioActual = useAuthStore((s) => s.usuario);
  const esAdminActual = esPerfilAdministradorVigente();

  const [usuario, setUsuario] = useState(usuarioActual && esAdminActual ? usuarioActual : "");
  const [password, setPassword] = useState("");
  const [verPassword, setVerPassword] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!abierto) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usuario.trim()) {
      setError("Ingrese el usuario o correo del administrador.");
      return;
    }
    if (!password) {
      setError("Ingrese la contraseña del administrador.");
      return;
    }

    setCargando(true);
    setError(null);

    const res = await verificarPasswordAdmin(usuario.trim(), password);
    if (!res.ok) {
      setCargando(false);
      setError(res.error ?? "Contraseña de administrador inválida.");
      return;
    }

    const adminUser = res.usuarioAdmin || usuario.trim();

    await registrarAutorizacionVentaFueraLimite({
      modalidad,
      usuarioAdmin: adminUser,
      grupoNombre,
      jugadorNombre,
      monto,
      cantidad,
      detalle: motivo,
    });

    setCargando(false);
    setPassword("");
    setError(null);
    await onAutorizado(adminUser);
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/65 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget && !cargando) onCerrar();
      }}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-amber-300 bg-white p-6 shadow-2xl animate-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
      >
        {/* Header con icono de advertencia/seguridad */}
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-black text-slate-900">{titulo}</h3>
            <p className="mt-0.5 text-xs font-semibold text-amber-800">
              Límite excedido para el grupo: <span className="font-black text-slate-900">{grupoNombre}</span>
            </p>
          </div>
        </div>

        {/* Detalle del límite superado */}
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/80 p-3.5 text-xs text-amber-900">
          <p className="font-semibold leading-relaxed">{motivo}</p>
          {limiteEstablecido != null && (
            <p className="mt-1.5 font-bold text-amber-950">
              Límite establecido: <span className="underline">{limiteEstablecido}</span>
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-amber-200/60 pt-2 text-[11px] text-amber-800">
            <span>Jugador: <strong>{jugadorNombre}</strong></span>
            <span>Monto: <strong>${monto}</strong></span>
            {cantidad ? <span>Cantidad: <strong>{cantidad}</strong></span> : null}
          </div>
        </div>

        <p className="mt-3 text-xs text-slate-600 font-medium">
          Para continuar con esta venta fuera de límite se requiere la validación explícita de un
          <strong> Administrador</strong> mediante su contraseña.
        </p>

        {/* Formulario de autorización */}
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div>
            <label className="block text-xs font-bold text-slate-700">Usuario o Correo Administrador</label>
            <input
              type="text"
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              placeholder="ej. josorioc"
              disabled={cargando}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-900 outline-none focus:border-amber-500 focus:bg-white"
              autoFocus={!usuario}
              required
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700">Contraseña de Administrador</label>
            <div className="relative mt-1">
              <input
                type={verPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                disabled={cargando}
                className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 pr-10 text-xs font-bold text-slate-900 outline-none focus:border-amber-500 focus:bg-white"
                autoFocus={!!usuario}
                required
              />
              <button
                type="button"
                onClick={() => setVerPassword((v) => !v)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600"
                tabIndex={-1}
              >
                {verPassword ? (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-center text-xs font-bold text-red-600 animate-in fade-in">
              {error}
            </div>
          )}

          <div className="mt-5 flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onCerrar}
              disabled={cargando}
              className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition active:scale-95 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={cargando}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-amber-500 transition active:scale-95 disabled:opacity-50"
            >
              {cargando ? (
                <>
                  <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Verificando...
                </>
              ) : (
                <>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  Autorizar y Vender
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
