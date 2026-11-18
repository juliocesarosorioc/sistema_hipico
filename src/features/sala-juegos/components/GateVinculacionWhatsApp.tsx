"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";

/** JID válido de grupo de WhatsApp (Baileys). */
export function esJidWhatsAppValido(valor?: string | null): boolean {
  return /@g\.us$/i.test(String(valor || "").trim());
}

interface EstadoWa {
  cargado: boolean;
  conectado: boolean;
  qr: string | null;
  motivo: string;
}

interface GrupoWa {
  jid: string;
  nombre: string;
  participantes: number;
}

/**
 * Verificación centralizada: la Sala queda cerrada si la sala activa no tiene
 * un `whatsapp_group_jid` terminado en @g.us o si el motor Baileys está caído.
 * Se llama SIEMPRE (antes de cualquier return temprano) para no romper el orden
 * de los hooks.
 */
export function usarBloqueoWhatsApp(salas: any[], salaId?: string) {
  const [estado, setEstado] = useState<EstadoWa>({
    cargado: false,
    conectado: false,
    qr: null,
    motivo: "",
  });

  const consultar = useCallback(async () => {
    try {
      const res = await fetch("/api/whatsapp/status", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      const conectado = Boolean(
        data?.conectado ||
          /^(connected|open|authenticated)$/i.test(String(data?.status || ""))
      );
      setEstado({
        cargado: true,
        conectado,
        qr: data?.qr || data?.qrDataUrl || null,
        motivo: String(data?.motivo || data?.error || ""),
      });
    } catch (err: any) {
      setEstado({
        cargado: true,
        conectado: false,
        qr: null,
        motivo: err?.message || "",
      });
    }
  }, []);

  useEffect(() => {
    void consultar();
    const intervalo = setInterval(() => void consultar(), 5000);
    return () => clearInterval(intervalo);
  }, [consultar]);

  const sala = (salas || []).find((s: any) => s?.id === salaId) || (salas || [])[0];
  const jid = String(sala?.whatsapp_group_jid || sala?.whatsappGroupJid || "").trim();
  const nombre = String(sala?.whatsapp_group_nombre || sala?.whatsappGroupNombre || "").trim();
  const bloqueado = !esJidWhatsAppValido(jid) || (estado.cargado && !estado.conectado);

  return { bloqueado, jid, nombre, estado };
}

interface PropsGate {
  esAdmin: boolean;
  salas: any[];
  salaId?: string;
  grupoId?: string;
  estado: EstadoWa;
  onVinculado: (jid: string, nombre: string) => void;
}

/** Pantalla única de vinculación obligatoria (admin/superadmin) o espera (cliente). */
export function GateVinculacionWhatsApp({
  esAdmin,
  salas,
  salaId,
  grupoId,
  estado,
  onVinculado,
}: PropsGate) {
  const [grupos, setGrupos] = useState<GrupoWa[]>([]);
  const [seleccion, setSeleccion] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actualizando, setActualizando] = useState(false);

  const sala = useMemo(
    () => (salas || []).find((s: any) => s?.id === salaId) || (salas || [])[0],
    [salas, salaId]
  );
  const jidActual = String(sala?.whatsapp_group_jid || sala?.whatsappGroupJid || "").trim();
  const nombreActual = String(sala?.whatsapp_group_nombre || sala?.whatsappGroupNombre || "").trim();

  const listarGrupos = useCallback(async () => {
    if (!esAdmin || !estado.conectado) {
      setGrupos([]);
      return;
    }
    setActualizando(true);
    try {
      const res = await fetch("/api/whatsapp/groups", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      const crudos: any[] = Array.isArray(data?.grupos)
        ? data.grupos
        : Array.isArray(data?.data)
          ? data.data
          : [];
      const lista: GrupoWa[] = crudos
        .map((g: any) => ({
          jid: String(g?.jid || g?.id || g?.groupJid || "").trim(),
          nombre: String(g?.nombre || g?.subject || g?.name || g?.jid || "Grupo").trim(),
          participantes: Number(g?.participantes ?? g?.totalParticipantes ?? 0),
        }))
        .filter((g: GrupoWa) => esJidWhatsAppValido(g.jid))
        .sort((a: GrupoWa, b: GrupoWa) => a.nombre.localeCompare(b.nombre));
      setGrupos(lista);
      setSeleccion((prev) =>
        prev && lista.some((g) => g.jid === prev)
          ? prev
          : lista.find((g) => g.jid === jidActual)?.jid || ""
      );
    } catch {
      setGrupos([]);
    } finally {
      setActualizando(false);
    }
  }, [esAdmin, estado.conectado, jidActual]);

  useEffect(() => {
    void listarGrupos();
  }, [listarGrupos]);

  const guardar = async () => {
    if (!seleccion || !esJidWhatsAppValido(seleccion)) {
      setError("Seleccioná un grupo de WhatsApp válido.");
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const nombreGrupo = grupos.find((g) => g.jid === seleccion)?.nombre || seleccion;
      const res = await fetch("/api/whatsapp-sala/salas-grupos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accion: "vincular-grupo-sala",
          grupoId: grupoId || sala?.grupo_id || undefined,
          salaId: sala?.id || salaId,
          groupJid: seleccion,
          nombreGrupo,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        throw new Error(json?.motivo || json?.error || `HTTP ${res.status}`);
      }
      onVinculado(seleccion, nombreGrupo);
    } catch (err: any) {
      setError(err?.message || "No se pudo guardar la vinculación.");
    } finally {
      setGuardando(false);
    }
  };

  if (!esAdmin) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-white p-6 text-center">
        <div className="max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-8 shadow-sm">
          <div className="mb-3 text-4xl">⏳</div>
          <p className="text-base font-extrabold leading-snug text-slate-900">
            ⏳ Sala no disponible: Esperando vinculación del grupo de WhatsApp por el administrador
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center overflow-y-auto bg-white p-4 text-slate-900 sm:p-8">
      <div className="w-full max-w-2xl rounded-3xl border border-slate-200 bg-white p-6 shadow-lg sm:p-8">
        <div className="mb-5 text-center">
          <div className="mb-3 text-4xl">🔗</div>
          <h1 className="text-xl font-black tracking-tight text-slate-900 sm:text-2xl">
            Vinculación Obligatoria de Grupo de WhatsApp
          </h1>
          <p className="mt-2 text-xs leading-relaxed text-slate-600">
            La Sala de Juegos permanece cerrada hasta vincular un grupo de WhatsApp válido y
            confirmar que el bot esté conectado.
          </p>
        </div>

        <div className="mb-5 flex items-center justify-center gap-2">
          <span
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold ${
              estado.conectado
                ? "bg-emerald-100 text-emerald-800"
                : "bg-amber-100 text-amber-800"
            }`}
          >
            <span>{estado.conectado ? "🟢" : "🔴"}</span>
            {estado.conectado ? "Bot de WhatsApp conectado" : "Bot de WhatsApp desconectado"}
          </span>
        </div>

        {!estado.conectado && (
          <div className="mb-6 flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-center text-xs font-bold text-slate-700">
              Escaneá este código QR con WhatsApp para vincular el bot
            </p>
            {estado.qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={estado.qr}
                alt="Código QR de vinculación de WhatsApp"
                className="h-56 w-56 rounded-lg bg-white object-contain"
              />
            ) : (
              <div className="flex h-32 w-full items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white text-center text-xs text-slate-500">
                {estado.cargado
                  ? "Solicitando código QR al motor Baileys…"
                  : "Conectando con el motor Baileys…"}
              </div>
            )}
            {estado.motivo ? (
              <p className="text-center text-[11px] text-red-600">{estado.motivo}</p>
            ) : null}
          </div>
        )}

        {estado.conectado && (
          <>
            {jidActual && !esJidWhatsAppValido(jidActual) ? (
              <p className="mb-3 rounded-lg bg-red-50 p-3 text-center text-xs font-bold text-red-700">
                El vínculo actual no es válido. Debe terminar en @g.us.
              </p>
            ) : null}
            {nombreActual ? (
              <p className="mb-3 text-center text-xs text-slate-600">
                Vínculo actual: <strong className="text-slate-900">{nombreActual}</strong>
              </p>
            ) : null}

            <label className="mb-2 block text-xs font-black uppercase tracking-wide text-slate-600">
              Grupo de WhatsApp disponible
            </label>
            <select
              value={seleccion}
              onChange={(e) => setSeleccion(e.target.value)}
              className="mb-3 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm font-bold text-slate-900 outline-none focus:border-[#008069]"
            >
              <option value="">Seleccioná un grupo (@g.us)</option>
              {grupos.map((g) => (
                <option key={g.jid} value={g.jid}>
                  {g.nombre} — {g.participantes} participantes
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => void listarGrupos()}
              disabled={actualizando}
              className="mb-4 w-full rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {actualizando ? "Actualizando…" : "🔄 Actualizar lista de grupos"}
            </button>

            {error ? (
              <p className="mb-3 rounded-lg bg-red-50 p-3 text-center text-xs font-bold text-red-700">
                {error}
              </p>
            ) : null}

            <button
              type="button"
              onClick={() => void guardar()}
              disabled={!seleccion || guardando}
              className="w-full rounded-xl bg-[#008069] px-4 py-3 text-sm font-black text-white hover:bg-[#006d56] disabled:opacity-50"
            >
              {guardando ? "Guardando…" : "Guardar y desbloquear Sala"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default GateVinculacionWhatsApp;
