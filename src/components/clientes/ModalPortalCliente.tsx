"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ToastHost } from "@/components/ui/ToastHost";
import {
  acortarEnlace,
  enlacePortalLargo,
  generarCodigo,
  guardarPortal,
  limpiarCacheClientes,
  type ClienteRow,
} from "@/lib/clientes";

const toast = (msg: string, tipo: "success" | "warning" | "error" | "info" = "info") =>
  window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));

type Props = {
  cliente: ClienteRow | null;
  onClose: () => void;
  onGuardado: () => void;
};

/**
 * Modal "Portal de Consulta del Cliente" — genera (o conserva) el Código del
 * enlace + Contraseña y construye el enlace largo + corto (is.gd con fallback).
 * Clon de js/clientes.js abrirModalPortal / btnGuardarPortal.
 */
export function ModalPortalCliente({ cliente, onClose, onGuardado }: Props) {
  const [habilitado, setHabilitado] = useState(false);
  const [token, setToken] = useState("");
  const [clavePortal, setClavePortal] = useState("");
  const [linkLargo, setLinkLargo] = useState("");
  const [linkCorto, setLinkCorto] = useState("");
  const [msgRecibido, setMsgRecibido] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!cliente) return;
    setHabilitado(Boolean(cliente.portal_habilitado));
    setToken(cliente.portal_token || generarCodigo(6));
    setClavePortal(cliente.portal_clave || generarCodigo(4));
    setMsgRecibido(cliente.portal_habilitado ? "El cliente ya tiene acceso; puede regenerar el código y la contraseña." : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cliente?.id]);

  useEffect(() => {
    if (!cliente) return;
    setLinkLargo(enlacePortalLargo(cliente.id, token));
    setLinkCorto("Generando enlace corto...");
    let vivo = true;
    acortarEnlace(enlacePortalLargo(cliente.id, token)).then((corto) => {
      if (vivo) setLinkCorto(corto);
    });
    return () => {
      vivo = false;
    };
  }, [token, clavePortal, cliente]);

  if (!cliente) return null;

  const copiar = (texto: string) => {
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(texto).catch(() => undefined);
    toast("Enlace copiado al portapapeles.", "success");
  };

  const guardar = async () => {
    setGuardando(true);
    const r = await guardarPortal(cliente.id, { portal_habilitado: habilitado, portal_token: token, portal_clave: clavePortal }, cliente);
    setGuardando(false);
    if (!r.ok) return toast(r.error ?? "Error al guardar el portal.", "error");
    limpiarCacheClientes();
    toast("Portal guardado. Entregue el enlace y la contraseña al cliente.", "success");
    onGuardado();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden">
        <div className="bg-cyan-700 px-5 py-4 text-xs font-black uppercase tracking-wider text-white flex items-center justify-between">
          <span>
            <i className="fas fa-link mr-2"></i> Portal de Consulta del Cliente
          </span>
          <button className="text-cyan-200 hover:text-white" onClick={onClose} aria-label="Cerrar">
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          <p className="font-bold text-slate-800">
            <i className="fas fa-user mr-1 text-cyan-600"></i>
            {cliente.nombre}
          </p>

          <label className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            <input type="checkbox" checked={habilitado} onChange={(e) => setHabilitado(e.target.checked)} className="h-4 w-4 accent-cyan-600" />
            <span className="text-xs font-black text-slate-700 uppercase">Habilitar acceso al portal</span>
          </label>
          {msgRecibido ? <p className="text-[10px] font-bold text-amber-600">{msgRecibido}</p> : null}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">Código del enlace</label>
              <div className="flex gap-1">
                <input
                  value={token}
                  onChange={(e) => setToken(e.target.value.toUpperCase().slice(0, 12))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-center font-mono text-sm font-black uppercase outline-none focus:border-cyan-500"
                />
                <button
                  type="button"
                  title="Regenerar código"
                  className="px-2 rounded-lg bg-slate-200 hover:bg-cyan-100 text-slate-600"
                  onClick={() => setToken(generarCodigo(6))}
                >
                  <i className="fas fa-sync-alt"></i>
                </button>
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">Contraseña</label>
              <div className="flex gap-1">
                <input
                  value={clavePortal}
                  onChange={(e) => setClavePortal(e.target.value.toUpperCase().slice(0, 8))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-center font-mono text-sm font-black uppercase outline-none focus:border-cyan-500"
                />
                <button
                  type="button"
                  title="Regenerar contraseña"
                  className="px-2 rounded-lg bg-slate-200 hover:bg-cyan-100 text-slate-600"
                  onClick={() => setClavePortal(generarCodigo(4))}
                >
                  <i className="fas fa-sync-alt"></i>
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider">Enlace largo (copia manual)</label>
            <div className="flex gap-1">
              <input readOnly value={linkLargo} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[11px] font-mono text-slate-600 bg-slate-50" />
              <button type="button" className="px-2 rounded-lg bg-slate-200 hover:bg-cyan-100 text-slate-600" onClick={() => copiar(linkLargo)} title="Copiar">
                <i className="fas fa-copy"></i>
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider">Enlace corto (WhatsApp)</label>
            <div className="flex gap-1">
              <input readOnly value={linkCorto} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[11px] font-mono text-cyan-700 font-bold bg-cyan-50" />
              <button type="button" className="px-2 rounded-lg bg-slate-200 hover:bg-cyan-100 text-slate-600" onClick={() => copiar(linkCorto)} title="Copiar">
                <i className="fas fa-copy"></i>
              </button>
            </div>
          </div>

          {habilitado ? (
            <p className="text-[10px] italic text-slate-400">Entréguele al cliente el enlace y la contraseña. Pedirá ambos al entrar.</p>
          ) : (
            <p className="text-[10px] italic text-amber-600">El acceso queda DESHABILITADO hasta que lo active.</p>
          )}
        </div>

        <div className="px-5 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="default" size="sm" onClick={guardar} disabled={guardando}>
            {guardando ? <i className="fas fa-spinner fa-spin mr-1"></i> : <i className="fas fa-save mr-1"></i>} Guardar
          </Button>
        </div>
        <ToastHost />
      </div>
    </div>
  );
}