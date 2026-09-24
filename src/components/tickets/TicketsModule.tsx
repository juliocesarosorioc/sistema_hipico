"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ToastHost } from "@/components/ui/ToastHost";
import { useAuthStore } from "@/store/useAuthStore";
import {
  listarTicketsAdmin,
  pasarARevision,
  resolverTicket,
  enlaceWhatsAppTicket,
  type AccionTicket,
  type EstadoTicket,
  type TicketDisputa,
} from "@/lib/tickets";

const toast = (msg: string, tipo: "success" | "warning" | "error" | "info" = "info") =>
  window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));

const num = (v: number | string | null | undefined): number => {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};

const usd = (v: number | string | null | undefined) => `$${num(v).toFixed(2)}`;

const ESTADOS: EstadoTicket[] = ["CREADO", "EN_REVISION", "SOLUCIONADO"];

const BADGE: Record<string, string> = {
  CREADO: "bg-sky-100 text-sky-700",
  EN_REVISION: "bg-amber-100 text-amber-700",
  SOLUCIONADO: "bg-emerald-100 text-emerald-700",
};

const ACCIONES: Record<AccionTicket, string> = {
  ABONO: "Abono a cuenta",
  REEMBOLSO: "Reembolso al cliente",
  AJUSTE: "Ajuste del monto",
  RECHAZO: "Rechazo del reclamo",
};

const ICON_TIPO: Record<string, string> = {
  REPORTE_FALTANTE: "fa-flag",
  DISPUTA: "fa-scale-balanced",
};

/**
 * TicketsModule — Consola de la casa (Tickets por solucionar).
 * Flujo CREADO → EN_REVISION → SOLUCIONADO, sobre la tabla tickets_jugadas.
 */
export function TicketsModule() {
  const [tickets, setTickets] = useState<TicketDisputa[]>([]);
  const [tabla, setTabla] = useState("todas");
  const [cargando, setCargando] = useState(true);
  const [resolviendo, setResolviendo] = useState<TicketDisputa | null>(null);
  const usuario = useAuthStore((s) => s.usuario);

  const cargar = useCallback(async () => {
    setCargando(true);
    const lista = await listarTicketsAdmin();
    setTickets(lista);
    setCargando(false);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const filtradas = useMemo(() => {
    if (tabla === "todas") return tickets;
    return tickets.filter((t) => t.estado === tabla);
  }, [tickets, tabla]);

  const contar = (e?: EstadoTicket) =>
    e ? tickets.filter((t) => t.estado === e).length : tickets.length;

  const iniciarRevision = async (t: TicketDisputa) => {
    const r = await pasarARevision(t.id);
    if (!r.ok) return toast(r.error ?? "No se pudo cambiar el estado.", "error");
    toast("Ticket en revisión.", "success");
    void cargar();
  };

  const resolver = async (t: TicketDisputa, datos: { respuesta: string; accion: AccionTicket; monto: number | null }) => {
    const r = await resolverTicket(t.id, { ...datos, por: usuario });
    if (!r.ok) return toast(r.error ?? "No se pudo resolver.", "error");
    toast("Ticket resuelto. El cliente ya puede ver la respuesta.", "success");
    setResolviendo(null);
    void cargar();
    void notificarWhatsApp(t, datos);
  };

  const notificarWhatsApp = async (t: TicketDisputa, datos: { respuesta: string; accion: AccionTicket; monto: number | null }) => {
    const link = await enlaceWhatsAppTicket({ ...t, respuesta_casa: datos.respuesta, accion_aplicada: datos.accion, monto_resuelto: datos.monto });
    if (!link) return toast("SIN teléfono registrado del cliente — no se pudo armar el enlace wa.me.", "warning");
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(link);
    } catch {
      /* clipboard opcional */
    }
    window.open(link, "_blank");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-800">
            <i className="fas fa-life-ring mr-2 text-sky-600"></i> Tickets / Reclamos
          </h1>
          <p className="text-xs text-slate-500">
            Disputas del portal y reclamos de jugadas. Flujo: <b>CREADO</b> → <b>EN REVISIÓN</b> → <b>SOLUCIONADO</b>.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void cargar()}>
          <i className="fas fa-rotate mr-1"></i> Recargar
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(["todas", ...ESTADOS] as const).map((k) => {
          const esTodo = k === "todas";
          const activo = tabla === k;
          const n = esTodo ? contar() : contar(k as EstadoTicket);
          const tono = !esTodo ? BADGE[k] : "bg-white border-line text-slate-600";
          return (
            <button
              key={k}
              onClick={() => setTabla(k)}
              className={`rounded-2xl border p-3 text-left transition-all ${activo ? "ring-2 ring-sky-400 border-transparent shadow" : "opacity-80 hover:opacity-100"} bg-white border-line`}
            >
              <div className="flex items-center justify-between">
                <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase ${!esTodo ? BADGE[k] : "bg-slate-100 text-slate-500"}`}>
                  {esTodo ? "Todos" : k.replace("_", " ")}
                </span>
                <span className={`text-lg font-black ${!esTodo ? "text-slate-800" : ""}`}>{n}</span>
              </div>
            </button>
          );
        })}
      </div>

      {cargando ? (
        <div className="rounded-2xl bg-white p-10 text-center text-slate-400">
          <i className="fas fa-spinner fa-spin text-2xl"></i>
          <p className="mt-2 text-xs font-bold uppercase tracking-wider">Cargando tickets…</p>
        </div>
      ) : filtradas.length === 0 ? (
        <div className="rounded-2xl bg-white p-10 text-center text-slate-400">
          <i className="fas fa-inbox text-2xl"></i>
          <p className="mt-2 text-xs font-bold uppercase tracking-wider">Sin tickets en este estado.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtradas.map((t) => (
            <TicketCard
              key={String(t.id)}
              t={t}
              onRevision={() => void iniciarRevision(t)}
              onResolver={() => setResolviendo(t)}
            />
          ))}
        </div>
      )}

      {resolviendo ? (
        <ResolverModal t={resolviendo} onCerrar={() => setResolviendo(null)} onResolver={(d) => void resolver(resolviendo, d)} />
      ) : null}

      <ToastHost />
    </div>
  );
}

const tono = (t: TicketDisputa) =>
  t.estado ? BADGE[t.estado] ?? "bg-slate-100 text-slate-500" : "bg-slate-100 text-slate-500";

function TicketCard({ t, onRevision, onResolver }: { t: TicketDisputa; onRevision: () => void; onResolver: () => void }) {
  const tipo = t.tipo_jugada ?? "DISPUTA";
  const [wa, setWa] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    if (t.estado === "SOLUCIONADO") {
      void enlaceWhatsAppTicket(t).then((l) => {
        if (vivo) setWa(l);
      });
    }
    return () => {
      vivo = false;
    };
  }, [t.id, t.estado]);

  const abrirWa = () => {
    if (!wa) return;
    try {
      if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(wa);
    } catch {
      /* sinop */
    }
    window.open(wa, "_blank");
  };

  return (
    <div className="rounded-2xl border border-line bg-white p-4 shadow-sm space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
            <i className={`fas ${ICON_TIPO[tipo] ?? "fa-life-ring"}`}></i>
          </span>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-black text-slate-800">
                T-{t.numero_ticket ?? String(t.id).slice(0, 6)}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase ${tono(t)}`}>{t.estado}</span>
            </div>
            <div className="text-xs text-slate-500">
              <b className="text-slate-700">{t.cliente_nombre || "Cliente"}</b>
              {t.hipodromo ? ` · ${t.hipodromo}${t.carrera ? " C" + t.carrera : ""}` : ""}
              {t.fecha_jugada ? ` · ${String(t.fecha_jugada).slice(0, 10)}` : ""}
            </div>
          </div>
        </div>
        <span className="text-[10px] text-slate-400">{t.creado_at ? new Date(t.creado_at).toLocaleString("es-VE") : ""}</span>
      </div>

      <div className="grid grid-cols-1 gap-3 text-xs md:grid-cols-3">
        <div className="rounded-xl bg-slate-50 px-3 py-2">
          <div className="text-[9px] font-black uppercase text-slate-400">Motivo</div>
          <div className="font-bold text-slate-700">{t.motivo || tipo}</div>
        </div>
        <div className="rounded-xl bg-slate-50 px-3 py-2">
          <div className="text-[9px] font-black uppercase text-slate-400">Jugada / Monto</div>
          <div className="font-bold text-slate-700">
            {t.jugada_origen ?? t.tipo_jugada ?? "—"} · <span className="font-mono">{usd(t.monto)}</span>
            {num(t.premio_recalculado) > 0 ? <span className="text-purple-600"> (premio {usd(t.premio_recalculado)})</span> : null}
          </div>
        </div>
        <div className="rounded-xl bg-slate-50 px-3 py-2">
          <div className="text-[9px] font-black uppercase text-slate-400">Soporte</div>
          {t.imagen_soporte ? (
            <a href={t.imagen_soporte} target="_blank" rel="noreferrer" className="font-bold text-sky-600 underline">
              <i className="fas fa-image mr-1"></i> Ver comprobante
            </a>
          ) : (
            <span className="text-slate-400">Sin imagen</span>
          )}
        </div>
      </div>

      {t.estado === "SOLUCIONADO" ? (
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs">
          <div className="text-[9px] font-black uppercase text-emerald-500">Respuesta de la casa</div>
          <div className="font-bold text-emerald-800">
            {t.accion_aplicada ? ACCIONES[t.accion_aplicada] + (num(t.monto_resuelto) > 0 ? ` · ${usd(t.monto_resuelto)}` : "") : ""}
            {t.respuesta_casa ? ` — ${t.respuesta_casa}` : ""}
            {t.respondido_por ? ` <span className="text-emerald-500">(${t.respondido_por})</span>` : ""}
          </div>
          {t.encuesta_satisfaccion != null ? (
            <div className="mt-1 text-emerald-600">
              <i className="fas fa-star mr-1 text-amber-400"></i> Encuesta: {t.encuesta_satisfaccion}/5
              {t.encuesta_comentario ? ` · “${t.encuesta_comentario}”` : ""}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex justify-end gap-2">
        {t.estado === "SOLUCIONADO" && wa ? (
          <Button variant="outline" size="sm" onClick={abrirWa} title="Copia el enlace y abre WhatsApp con el cliente">
            <i className="fab fa-whatsapp mr-1 text-green-600"></i> Enviar por WhatsApp
          </Button>
        ) : null}
        {t.estado === "CREADO" ? (
          <Button variant="outline" size="sm" onClick={onRevision}>
            <i className="fas fa-magnifying-glass mr-1"></i> Marcar en revisión
          </Button>
        ) : null}
        {t.estado === "EN_REVISION" ? (
          <Button variant="success" size="sm" onClick={onResolver}>
            <i className="fas fa-check-double mr-1"></i> Resolver
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function ResolverModal({
  t,
  onCerrar,
  onResolver,
}: {
  t: TicketDisputa;
  onCerrar: () => void;
  onResolver: (datos: { respuesta: string; accion: AccionTicket; monto: number | null }) => void;
}) {
  const usuario = useAuthStore((s) => s.usuario);
  const [respuesta, setRespuesta] = useState("");
  const [accion, setAccion] = useState<AccionTicket>("ABONO");
  const [monto, setMonto] = useState(num(t.monto) > 0 ? String(t.monto) : "");

  const conMonto = accion !== "RECHAZO";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4" role="dialog" aria-modal>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black text-slate-800">
            <i className="fas fa-check-double mr-1 text-emerald-600"></i> Resolver T-{t.numero_ticket ?? String(t.id).slice(0, 6)}
          </h3>
          <button onClick={onCerrar} className="text-slate-400 hover:text-slate-600" aria-label="Cerrar">
            <i className="fas fa-xmark"></i>
          </button>
        </div>

        <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <b>{t.cliente_nombre}</b> · {t.motivo} · Monto reclamado <span className="font-mono">{usd(t.monto)}</span>
        </div>

        <div>
          <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Acción aplicada *</label>
          <select
            value={accion}
            onChange={(e) => setAccion(e.target.value as AccionTicket)}
            className="w-full border border-line rounded-xl bg-surface px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-200 font-bold"
          >
            {Object.entries(ACCIONES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>

        {conMonto ? (
          <div>
            <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Monto (USD)</label>
            <input
              value={monto}
              onChange={(e) => setMonto(e.target.value.replace(/[^\d.]/g, ""))}
              className="w-full border border-line rounded-xl bg-surface px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-200 font-mono"
              placeholder="0.00"
              inputMode="decimal"
            />
          </div>
        ) : null}

        <div>
          <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Respuesta para el cliente *</label>
          <textarea
            value={respuesta}
            onChange={(e) => setRespuesta(e.target.value)}
            className="w-full border border-line rounded-xl bg-surface px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-200 resize-none"
            rows={3}
            placeholder="Describa la resolución (ej. ABONO CONFIRMADO DE $2.50 A SU CUENTA)…"
          />
        </div>

        <p className="text-[10px] text-slate-400">
          Respondido por: <b className="font-mono text-slate-600">{usuario}</b>
        </p>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button
            variant="success"
            size="sm"
            disabled={!respuesta.trim() || (conMonto && num(monto) <= 0)}
            onClick={() => onResolver({ respuesta, accion, monto: conMonto ? num(monto) : null })}
          >
            <i className="fas fa-check-double mr-1"></i> Confirmar resolución
          </Button>
        </div>
      </div>
    </div>
  );
}