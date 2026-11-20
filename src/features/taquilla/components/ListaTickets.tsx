"use client";

import { useMemo } from "react";
import { useTaquillaStore } from "@/shared/store/useTaquillaStore";
import { Button } from "@/shared/components/ui/Button";
import { anularJugada } from "@/features/taquilla/lib/venta";
import { formatearMontoRegional } from "@/shared/lib/dinero";
import type { TicketCarreraRow } from "@/features/taquilla/lib/tickets-carrera";
import type { ContextoCarreraTaquilla } from "@/features/taquilla/components/BetSlip";
import { leerNotaSala } from "@/features/whatsapp-sala/lib/sincronizar-tickets-sala";

const toast = (msg: string, tipo: "success" | "warning" | "error" | "info" = "info") =>
  window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));

const COP = { format: (n: number) => `$${formatearMontoRegional(n)}` };

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function estadoEsVigente(est?: string | null): boolean {
  const s = String(est || "").trim().toUpperCase();
  if (!s) return true;
  return s === "PENDIENTE" || s === "ACTIVO" || s === "ABIERTA";
}

type Props = {
  /** Tickets vigentes de la carrera activa cargados desde BD (incluye Sala sincronizada). */
  ticketsBD?: TicketCarreraRow[];
  contexto?: ContextoCarreraTaquilla;
  cargando?: boolean;
  onRefrescar?: () => void | Promise<void>;
};

/**
 * Tickets de la carrera activa (BD, con actualización en vivo) + respaldo de sesión.
 * Muestra jugadas manuales y las concretadas/sincronizadas desde Sala sin duplicar
 * la sesión local cuando ya existe el ticket en BD.
 */
export function ListaTickets({ ticketsBD, contexto, cargando, onRefrescar }: Props) {
  const ticketsSesion = useTaquillaStore((s) => s.tickets);
  const eliminarTicket = useTaquillaStore((s) => s.eliminarTicket);

  const nCarrera = Number(String(contexto?.carrera ?? "").replace(/[^0-9]/g, "")) || 0;
  const hip = String(contexto?.hipodromo ?? "").trim().toUpperCase();
  const fecha = String(contexto?.fecha ?? "").slice(0, 10);

  const sesionDeCarrera = useMemo(() => {
    if (!hip || !nCarrera) return [] as typeof ticketsSesion;
    return ticketsSesion.filter(
      (t) =>
        String(t.hipodromo || "").trim().toUpperCase() === hip &&
        Number(t.carrera) === nCarrera &&
        (!fecha || String(t.fecha || "").slice(0, 10) === fecha)
    );
  }, [ticketsSesion, hip, nCarrera, fecha]);

  const idsSesionVendidos = useMemo(
    () => new Set(sesionDeCarrera.map((t) => String(t.ticketId ?? "")).filter(Boolean)),
    [sesionDeCarrera]
  );

  const filasBD = useMemo(() => {
    const rows = (ticketsBD ?? []).filter((r) => estadoEsVigente(r.estado));
    return rows.map((r) => {
      const nota = leerNotaSala(r.nota_auditoria);
      const origenSala = nota.origen === "TAQUILLA" || nota.origen === "SALA_P2P";
      return { ...r, _origenSala: origenSala, _codigoSala: nota.codigo_ticket || nota.idempotencia || "" };
    });
  }, [ticketsBD]);

  const sesionSinBD = useMemo(
    () => sesionDeCarrera.filter((t) => t.ticketId === undefined || !idsSesionVendidos.has(String(t.ticketId))),
    [sesionDeCarrera, idsSesionVendidos]
  );

  const totalInvertidoBD = filasBD.reduce((a, r) => a + num(r.monto_jugado), 0);
  const totalInvertido = totalInvertidoBD + sesionSinBD.reduce((a, t) => a + t.monto, 0);
  const cantidad = filasBD.length + sesionSinBD.length;

  const borrarBD = async (row: TicketCarreraRow) => {
    const id = num(row.id);
    if (!id) return;
    const r = await anularJugada(id, "Quitado por el operador");
    if (!r.ok) {
      toast(`No se pudo anular el ticket #${id}: ${r.error ?? "sin conexión"}`, "error");
      return;
    }
    // Quitar también de la sesión local si estaba vinculado.
    const ses = ticketsSesion.find((t) => String(t.ticketId ?? "") === String(id));
    if (ses) eliminarTicket(ses.id);
    if (onRefrescar) await onRefrescar();
  };

  const borrarSesion = async (id: string) => {
    const t = ticketsSesion.find((x) => x.id === id);
    if (t?.ticketId !== undefined) {
      const r = await anularJugada(t.ticketId, "Quitado por el operador");
      if (!r.ok) {
        toast(`No se pudo anular el ticket #${t.ticketId}: ${r.error ?? "sin conexión"}`, "error");
        return;
      }
      if (onRefrescar) await onRefrescar();
    }
    eliminarTicket(id);
  };

  const vaciar = async () => {
    // Anular todos los tickets de la carrera activa (BD) una sola vez por id.
    const ids = new Set<string>();
    for (const r of filasBD) ids.add(String(r.id));
    for (const t of sesionSinBD) if (t.ticketId !== undefined) ids.add(String(t.ticketId));
    for (const idStr of ids) {
      const r = await anularJugada(Number(idStr), "Sesión vaciada por el operador");
      if (!r.ok) {
        toast(`No se pudo anular el ticket #${idStr}: ${r.error ?? "sin conexión"}`, "error");
        return;
      }
    }
    for (const t of sesionDeCarrera) eliminarTicket(t.id);
    if (onRefrescar) await onRefrescar();
  };

  return (
    <div className="rounded-2xl border border-line bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
          🧾 Tickets de la Carrera ({cantidad})
          {cargando ? <span className="ml-2 font-normal normal-case text-slate-400">actualizando…</span> : null}
        </h3>
        <div className="flex items-center gap-1">
          {onRefrescar ? (
            <Button variant="ghost" size="sm" onClick={() => void onRefrescar()} title="Actualizar desde la base">
              ↻
            </Button>
          ) : null}
          {cantidad > 0 && (
            <Button variant="ghost" size="sm" onClick={() => void vaciar()}>
              Vaciar
            </Button>
          )}
        </div>
      </div>

      {cantidad === 0 ? (
        <div className="px-4 py-8 text-center text-[11px] italic text-slate-500">
          Sin tickets registrados para esta carrera. Las jugadas manuales y las concretadas en Sala aparecerán aquí.
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {filasBD.map((r) => {
            const ej = r.caballo || (r.ejemplar_numero ? String(r.ejemplar_numero) : "");
            const juega = String(r.cliente_juega_nombre || "").trim();
            const consigue = String(r.cliente_consigue_nombre || "").trim();
            const esSala = Boolean((r as any)._origenSala);
            const codigoSala = String((r as any)._codigoSala || "").trim();
            return (
              <li key={`db-${String(r.id)}`} className="flex items-center justify-between gap-2 px-4 py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-7 min-w-10 shrink-0 place-items-center rounded-md bg-surfaceAlt px-1 text-[10px] font-black text-slate-500">
                    #{String(r.id)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-mono text-[12px] font-bold text-slate-700">
                      {String(r.nombre_jugada || "—").trim()} {ej ? `(${ej})` : ""}
                      {r.es_adelantada ? (
                        <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 align-middle text-[9px] font-black uppercase text-amber-800">
                          ⏳ Adelantada
                        </span>
                      ) : null}
                      {esSala ? (
                        <span
                          className="ml-1 rounded bg-sky-100 px-1 py-0.5 align-middle text-[9px] font-black uppercase text-sky-700"
                          title={codigoSala ? `Concretada en Sala · ${codigoSala}` : "Concretada en Sala"}
                        >
                          💬 Sala
                        </span>
                      ) : null}
                      <span className="ml-1 rounded bg-emerald-100 px-1 py-0.5 align-middle text-[9px] font-black uppercase text-emerald-700">
                        ✅ {String(r.estado || "Registrada")}
                      </span>
                    </p>
                    <p className="text-[10px] text-slate-500">
                      {juega ? `${juega}${consigue ? ` vs ${consigue}` : ""}` : "—"}
                      {codigoSala ? ` · ${codigoSala}` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-sm font-extrabold text-success-500">{COP.format(num(r.monto_jugado))}</span>
                  <button
                    type="button"
                    onClick={() => void borrarBD(r)}
                    aria-label={`Anular ticket ${String(r.id)}`}
                    className="grid h-7 w-7 place-items-center rounded-lg border border-danger-500/40 bg-danger-500/10 text-[11px] font-bold text-danger-500 transition-colors hover:bg-danger-500 hover:text-white"
                    title="Anular ticket (devuelve el saldo si aplica)"
                  >
                    ✕
                  </button>
                </div>
              </li>
            );
          })}
          {sesionSinBD.map((t) => (
            <li key={`ses-${t.id}`} className="flex items-center justify-between gap-2 px-4 py-2.5">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-7 w-10 shrink-0 place-items-center rounded-md bg-surfaceAlt text-[10px] font-black text-slate-500">
                  #{t.id}
                </span>
                <div className="min-w-0">
                  <p className="truncate font-mono text-[12px] font-bold text-slate-700">
                    {t.comando}{" "}
                    <span className="ml-1 rounded bg-slate-100 px-1 py-0.5 align-middle text-[9px] font-black uppercase text-slate-500">
                      ⏳ Sesión
                    </span>
                  </p>
                  <p className="text-[10px] text-slate-500">
                    {t.cliente1 ? `${t.cliente1}${t.cliente2 ? ` vs ${t.cliente2}` : ""} · ` : ""}Gana {COP.format(t.gananciaProyectada)} · casa {COP.format(t.comision)}
                  </p>
                  {t.observacion ? <p className="text-[10px] font-semibold text-amber-700">{t.observacion}</p> : null}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-sm font-extrabold text-success-500">{COP.format(t.monto)}</span>
                <button
                  type="button"
                  onClick={() => void borrarSesion(t.id)}
                  aria-label={`Eliminar ticket ${t.comando}`}
                  className="grid h-7 w-7 place-items-center rounded-lg border border-danger-500/40 bg-danger-500/10 text-[11px] font-bold text-danger-500 transition-colors hover:bg-danger-500 hover:text-white"
                  title="Eliminar ticket"
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {cantidad > 0 && (
        <div className="flex items-center justify-between border-t border-line bg-surfaceAlt/40 px-4 py-2.5 rounded-b-2xl">
          <span className="text-[11px] font-semibold text-slate-500">Total invertido</span>
          <span className="text-sm font-extrabold text-success-500">{COP.format(totalInvertido)}</span>
        </div>
      )}
    </div>
  );
}

export default ListaTickets;