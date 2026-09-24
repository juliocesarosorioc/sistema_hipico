"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  aplicarNotificacion,
  fmtFechaHora,
  ignorarNotificacion,
  listarNotificaciones,
  listarReclamos,
  resumenNotificacion,
  responderReclamo,
  type NotificacionRow,
  type ReclamoRow,
} from "@/lib/clientes";
import { formatoMoneda } from "@/lib/vzla";

const toast = (msg: string, tipo: "success" | "warning" | "error" | "info" = "info") =>
  window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));

const BADGE_ESTADO: Record<string, string> = {
  Pendiente: "bg-amber-100 text-amber-700",
  Aplicada: "bg-emerald-100 text-emerald-700",
  Ignorada: "bg-slate-200 text-slate-600",
  EN_REVISION: "bg-amber-100 text-amber-700",
  SOLUCIONADO: "bg-emerald-100 text-emerald-700",
  RECHAZADO: "bg-red-100 text-red-700",
};

/**
 * Notificaciones del Portal — clon de js/clientes.js btnConfigPortal.
 * Pestañas internas: Solicitudes de datos (tabla notificaciones) y
 * Reclamos de jugadas (tickets_jugadas) con respuesta de la casa.
 */
export function NotificacionesPortal() {
  const [modo, setModo] = useState<"datos" | "reclamos">("datos");
  const [nnotis, setNnotis] = useState<NotificacionRow[]>([]);
  const [reclamos, setReclamos] = useState<ReclamoRow[]>([]);
  const [cargando, setCargando] = useState(true);
  const [respuestas, setRespuestas] = useState<Record<string, string>>({});

  const recargar = useCallback(async () => {
    setCargando(true);
    const [nn, rc] = await Promise.all([listarNotificaciones(50), listarReclamos(50)]);
    setNnotis(nn);
    setReclamos(rc);
    setCargando(false);
  }, []);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  const aplicar = async (n: NotificacionRow) => {
    const r = await aplicarNotificacion(n, "Administrador");
    if (!r.ok) return toast(r.error ?? "Error al aplicar.", "error");
    toast("Datos aplicados al cliente.", "success");
    void recargar();
  };

  const ignorar = async (n: NotificacionRow) => {
    const r = await ignorarNotificacion(n, "Administrador");
    if (!r.ok) return toast(r.error ?? "Error.", "error");
    toast("Notificación marcada como ignorada.", "info");
    void recargar();
  };

  const resolver = async (r: ReclamoRow, estado: "SOLUCIONADO" | "RECHAZADO") => {
    const res = respuestas[r.id] || "";
    const base: { estado: string; respuesta_casa: string | null; accion_aplicada: string | null; monto_resuelto: number | null } = {
      estado,
      respuesta_casa: res || null,
      accion_aplicada: null,
      monto_resuelto: null,
    };
    if (estado === "SOLUCIONADO") {
      base.accion_aplicada = "ABONO";
      base.monto_resuelto = parseFloat(String(r.monto)) || 0;
    } else {
      base.accion_aplicada = "RECHAZO";
    }
    const out = await responderReclamo(r.id, base);
    if (!out.ok) return toast(out.error ?? "Error al responder.", "error");
    toast(estado === "SOLUCIONADO" ? "Reclamo solucionado." : "Reclamo rechazado.", "success");
    void recargar();
  };

  const th = "px-3 py-2 text-left text-[9px] font-black uppercase tracking-wider text-slate-500";
  const td = "px-3 py-2 align-middle";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 w-fit">
        {(
          [
            ["datos", `Solicitudes de datos (${nnotis.filter((n) => !n.estado || n.estado === "Pendiente").length})`],
            ["reclamos", `Reclamos de jugadas (${reclamos.filter((r) => r.estado === "EN_REVISION").length})`],
          ] as [typeof modo, string][]
        ).map(([k, lbl]) => (
          <button
            key={k}
            onClick={() => setModo(k)}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
              modo === k ? "bg-primary-600 text-white shadow" : "text-slate-600 hover:bg-white"
            }`}
          >
            {lbl}
          </button>
        ))}
      </div>

      {modo === "datos" ? (
        <div className="overflow-x-auto rounded-2xl border border-line bg-white shadow-sm">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-line">
              <tr>
                <th className={th}>Fecha</th>
                <th className={th}>Cliente</th>
                <th className={th}>Solicitud</th>
                <th className={th}>Estado</th>
                <th className={th + " w-44"}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {nnotis.map((n) => (
                <tr key={String(n.id)} className="border-b border-line last:border-0 hover:bg-slate-50">
                  <td className={td + " whitespace-nowrap text-slate-500"}>{fmtFechaHora(n.created_at)}</td>
                  <td className={td}>
                    <b>{n.cliente_nombre || "—"}</b>
                    {n.tipo ? <div className="text-[10px] text-slate-400 uppercase">{n.tipo}</div> : null}
                  </td>
                  <td className={td} dangerouslySetInnerHTML={{ __html: resumenNotificacion(n) }} />
                  <td className={td}>
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase ${BADGE_ESTADO[n.estado || ""] ?? "bg-slate-100 text-slate-600"}`}>
                      {n.estado || "Pendiente"}
                    </span>
                  </td>
                  <td className={td}>
                    {!n.estado || n.estado === "Pendiente" ? (
                      <div className="flex gap-1">
                        <Button variant="success" size="sm" onClick={() => void aplicar(n)}>
                          <i className="fas fa-check"></i> Aplicar
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => void ignorar(n)}>
                          Ignorar
                        </Button>
                      </div>
                    ) : (
                      <span className="text-[10px] text-slate-400">
                        {n.atendida_por ? `por ${n.atendida_por}` : ""} · {fmtFechaHora(n.atendida_at)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {nnotis.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-10 text-center text-slate-400">
                    {cargando ? <i className="fas fa-spinner fa-spin mr-2"></i> : <i className="fas fa-bell-slash mr-2"></i>}
                    Sin solicitudes del portal.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="space-y-3">
          {reclamos.map((r) => (
            <div key={String(r.id)} className="rounded-2xl border border-line bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <i className="fas fa-flag text-danger-600"></i>
                  <div>
                    <div className="text-xs font-black text-slate-800">
                      Ticket #{r.numero_ticket} — {r.cliente_nombre || "Cliente"}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {fmtFechaHora(r.created_at)} · {r.hipodromo} · Carrera {r.carrera} · {r.jugada_origen || r.tipo_jugada}
                    </div>
                  </div>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase ${BADGE_ESTADO[r.estado || ""] ?? "bg-slate-100 text-slate-600"}`}>
                  {r.estado || "EN_REVISION"}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2 text-[11px]">
                <div className="rounded-lg bg-slate-50 p-2">
                  <span className="text-slate-400 block text-[9px] uppercase font-black">Motivo</span>
                  <b>{r.motivo}</b>
                </div>
                <div className="rounded-lg bg-slate-50 p-2">
                  <span className="text-slate-400 block text-[9px] uppercase font-black">Monto</span>
                  <b className="font-mono">{formatoMoneda("USD", r.monto)}</b>
                </div>
                <div className="rounded-lg bg-slate-50 p-2">
                  <span className="text-slate-400 block text-[9px] uppercase font-black">Soporte</span>
                  {r.imagen_soporte ? (
                    <a href={r.imagen_soporte} target="_blank" rel="noreferrer" className="text-indigo-600 font-bold hover:underline">
                      <i className="fas fa-image mr-1"></i> Ver imagen
                    </a>
                  ) : (
                    <span className="text-slate-400">Sin imagen</span>
                  )}
                </div>
              </div>

              {r.respuesta_casa ? (
                <div className="mt-2 rounded-lg border border-indigo-100 bg-indigo-50 p-2 text-[11px]">
                  <span className="text-indigo-400 text-[9px] uppercase font-black block">Respuesta de la casa</span>
                  {r.respuesta_casa}
                  {r.accion_aplicada ? <div className="mt-1 font-bold text-indigo-700">{r.accion_aplicada}</div> : null}
                </div>
              ) : null}

              {r.estado === "EN_REVISION" ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    value={respuestas[r.id] ?? ""}
                    onChange={(e) => setRespuestas((s) => ({ ...s, [String(r.id)]: e.target.value }))}
                    placeholder="Respuesta de la casa (WhatsApp/correo)…"
                    className="min-w-0 flex-1 border border-line rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-primary-500 bg-surface"
                  />
                  <Button variant="success" size="sm" onClick={() => void resolver(r, "SOLUCIONADO")}>
                    <i className="fas fa-check mr-1"></i> Solucionar
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => void resolver(r, "RECHAZADO")}>
                    <i className="fas fa-ban mr-1"></i> Rechazar
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
          {reclamos.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line bg-white/60 p-10 text-center text-slate-400">
              <i className="fas fa-flag-checkered text-2xl mb-2"></i>
              <p className="text-xs font-bold">Sin reclamos registrados.</p>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}