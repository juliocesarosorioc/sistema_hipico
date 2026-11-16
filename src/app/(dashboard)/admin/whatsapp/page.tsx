"use client";

import React from "react";
import { useAuthStore } from "@/shared/store/useAuthStore";
import WhatsAppOperatorPanel from "@/components/whatsapp/WhatsAppOperatorPanel";

export default function AdminWhatsAppPage() {
  const storeGrupoId = useAuthStore((s) => s.grupoId);
  const grupoUsuarioId = storeGrupoId ? String(storeGrupoId) : "";

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6 space-y-6">
      <header className="rounded-3xl border border-slate-800 bg-slate-950 p-5 text-white shadow-xl">
        <h1 className="text-xl font-black text-white flex items-center gap-2">
          <span>📲</span> Administración WhatsApp del Operador
        </h1>
        <p className="mt-1 text-xs text-slate-400">
          Escanea el código QR con el WhatsApp de tu banca o grupo para activar el bot de jugadas en vivo.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
        <WhatsAppOperatorPanel grupo_id={grupoUsuarioId} />

        <div className="rounded-3xl border border-slate-800 bg-slate-950 p-5 text-white shadow-xl space-y-4">
          <h3 className="text-xs font-black uppercase tracking-wider text-emerald-400">
            Instrucciones para Operadores
          </h3>
          <ul className="space-y-3 text-xs text-slate-300">
            <li className="flex items-start gap-2">
              <span className="font-bold text-emerald-400">1.</span>
              <span>Haz clic en <strong>&quot;Conectar Mi Bot&quot;</strong> si el bot está desconectado.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-bold text-emerald-400">2.</span>
              <span>En tu teléfono, abre WhatsApp &gt; Dispositivos vinculados &gt; <strong>Vincular un dispositivo</strong>.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-bold text-emerald-400">3.</span>
              <span>Apunta la cámara de tu teléfono al código QR que aparece en pantalla.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-bold text-emerald-400">4.</span>
              <span>Al conectarse, verás el <strong>check verde</strong> indicando que la sesión está activa y lista.</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
