"use client";

import { Button } from "@/components/ui/Button";

export type TicketVentaModalidad = "MARCAS" | "DUPLETA" | "TABLA FIJA";

export type TicketVentaModel = {
  modalidad: TicketVentaModalidad;
  hipodromo: string;
  fecha: string;
  carrera: number | string;
  titulo: string;
  detalle?: string | null;
  jugador: string;
  grupo?: string | null;
  monto: number;
  moneda?: string | null;
  pago?: number | null;
  saldoAntes?: number | null;
  saldoDespues?: number | null;
  banquero?: string | null;
  banqueroCobra?: boolean | null;
  banqueroComision?: number | null;
  banqueroBase?: string | null;
};

const BASE_CORTA: Record<string, string> = {
  MONTO_DECIDIDO: "del monto decidido",
  MONTO_JUGADO: "del monto jugado",
  GANANCIA: "de la ganancia",
};

type Props = {
  abierto: boolean;
  ticket: TicketVentaModel | null;
  confirmando?: boolean;
  error?: string | null;
  onCorregir: () => void;
  onConfirmar: () => void;
};

const ESTILO: Record<TicketVentaModalidad, { cab: string; badge: string; etiqueta: string }> = {
  MARCAS: { cab: "bg-cyan-700", badge: "bg-cyan-100 text-cyan-800", etiqueta: "🏷️ Marca" },
  DUPLETA: { cab: "bg-indigo-700", badge: "bg-indigo-100 text-indigo-800", etiqueta: "🎯 Dupleta" },
  "TABLA FIJA": { cab: "bg-emerald-700", badge: "bg-emerald-100 text-emerald-800", etiqueta: "📋 Tabla Fija" },
};

function money(n: number, moneda?: string | null): string {
  const s = n.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moneda && moneda.toUpperCase() !== "USD" ? `${s} ${moneda}` : `$${s}`;
}

export function TicketVentaPreview({ abierto, ticket, confirmando, error, onCorregir, onConfirmar }: Props) {
  if (!abierto || !ticket) return null;
  const e = ESTILO[ticket.modalidad];
  const filas: Array<[string, string]> = [
    ["Hipódromo", `${ticket.hipodromo} · C${ticket.carrera}`],
    ["Fecha", ticket.fecha],
    ["Juega", ticket.grupo ? `${ticket.jugador} · ${ticket.grupo}` : ticket.jugador],
    ["Apuesta", ticket.titulo],
  ];
  if (ticket.detalle) filas.push(["Detalle", ticket.detalle]);
  if (ticket.banquero) {
    const com = ticket.banqueroCobra
      ? `comisión ${ticket.banqueroComision ?? 0}% ${BASE_CORTA[ticket.banqueroBase ?? "MONTO_DECIDIDO"] ?? ""}`.trim()
      : "sin comisión";
    filas.push(["Banquero", `${ticket.banquero} · ${com}`]);
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4 no-print"
      onClick={confirmando ? undefined : onCorregir}
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className={`flex items-center justify-between px-4 py-2.5 text-white ${e.cab}`}>
          <div className="flex items-center gap-2">
            <span className="text-lg">🧾</span>
            <div>
              <h3 className="text-sm font-black uppercase tracking-wide">Ticket de venta</h3>
              <p className="text-[10px] font-semibold opacity-80">Revisá la jugada antes de confirmar</p>
            </div>
          </div>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${e.badge}`}>
            {e.etiqueta}
          </span>
        </div>

        <div className="space-y-1 p-3">
          {filas.map(([k, v]) => (
            <div
              key={k}
              className="flex items-start justify-between gap-3 border-b border-slate-100 py-1 text-[11px] last:border-0"
            >
              <span className="shrink-0 font-bold uppercase tracking-wider text-slate-400">{k}</span>
              <span className="text-right font-black uppercase text-slate-800">{v}</span>
            </div>
          ))}

          <div className="mt-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] font-semibold">
            <div className="flex justify-between">
              <span className="text-slate-500">Monto jugado</span>
              <span className="font-black text-slate-900">{money(ticket.monto, ticket.moneda)}</span>
            </div>
            {ticket.pago != null && (
              <div className="flex justify-between">
                <span className="text-slate-500">Pago si gana</span>
                <span className="font-black text-emerald-700">{money(ticket.pago, ticket.moneda)}</span>
              </div>
            )}
            {ticket.saldoAntes != null && ticket.saldoDespues != null && (
              <div className="mt-1 flex justify-between border-t border-slate-200 pt-1">
                <span className="text-slate-500">Saldo del jugador</span>
                <span className="font-black text-slate-700">
                  {money(ticket.saldoAntes, ticket.moneda)} →{" "}
                  <span className={ticket.saldoDespues < 0 ? "text-amber-700" : "text-emerald-700"}>
                    {money(ticket.saldoDespues, ticket.moneda)}
                  </span>
                </span>
              </div>
            )}
            {ticket.banquero && (
              <div className="flex justify-between">
                <span className="text-slate-500">Comisión banquero</span>
                <span className="font-black text-amber-700">
                  {ticket.banqueroCobra ? `${ticket.banqueroComision ?? 0}%` : "sin comisión"}
                </span>
              </div>
            )}
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 px-2.5 py-1.5 text-[11px] font-bold text-red-700">{error}</p>
          )}
        </div>

        <div className="flex gap-2 border-t border-slate-200 bg-slate-50 px-3 py-2.5">
          <Button variant="outline" size="md" className="flex-1" onClick={onCorregir} disabled={confirmando}>
            ✏️ Corregir
          </Button>
          <Button variant="success" size="md" className="flex-1" onClick={onConfirmar} disabled={confirmando}>
            {confirmando ? "Registrando…" : "✅ Confirmar venta"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default TicketVentaPreview;
