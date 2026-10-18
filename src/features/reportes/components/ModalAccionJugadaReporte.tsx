"use client";

/**
 * MODAL DE ACCIÓN sobre una jugada del REPORTE (Marcas / Tablas Fijas).
 *
 * Un solo modal para los tres modos —corregir, anular y restaurar—, con el
 * motivo OBLIGATORIO (la operación queda auditada). No existe el "crear": la
 * venta se hace por su flujo (Taquilla / Tablas / Marcas).
 *
 * El permiso NO se decide acá: la puerta está en `edicion-reporte.ts`
 * (perfil Administrador Principal). Este componente solo pinta y llama.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/shared/components/ui/Button";
import { MOTIVOS_ANULACION, type EditablesJugada } from "@/features/jugadas/lib/jugadas";
import type { VentaTablaReporte } from "@/features/tablas/lib/reporte-tablas-nucleo";
import {
  anularJugadaDeReporte,
  editarJugadaDeReporte,
  restaurarJugadaDeReporte,
} from "@/features/reportes/lib/edicion-reporte";

export type ModoAccionJugada = "editar" | "anular" | "restaurar";

const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-semibold text-slate-800 focus:border-slate-400 focus:outline-none";

const ESTADOS = ["Pendiente", "Ganador", "Perdedor", "Retirado"] as const;

const TITULO: Record<ModoAccionJugada, string> = {
  editar: "✏️ Corregir jugada",
  anular: "🚫 Anular jugada",
  restaurar: "♻️ Restaurar jugada",
};

const EXITO: Record<ModoAccionJugada, string> = {
  editar: "Jugada corregida.",
  anular: "Jugada anulada.",
  restaurar: "Jugada restaurada.",
};

function Campo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] font-black uppercase tracking-wider text-slate-500">{label}</span>
      {children}
    </label>
  );
}

export function ModalAccionJugadaReporte({
  venta,
  modo,
  onCancelar,
  onHecho,
}: {
  venta: VentaTablaReporte;
  modo: ModoAccionJugada;
  onCancelar: () => void;
  /** Se llama con un mensaje de éxito (o el aviso de auditoría) y ya cerrado. */
  onHecho: (mensaje: string) => void;
}) {
  const [caballo, setCaballo] = useState(venta.caballo ?? "");
  const [ejemplar, setEjemplar] = useState(venta.numero ?? "");
  const [monto, setMonto] = useState(venta.monto ? String(venta.monto) : "");
  const [premio, setPremio] = useState(venta.pagado ? String(venta.pagado) : "");
  const [estado, setEstado] = useState(venta.estado || "Pendiente");
  const [motivo, setMotivo] = useState(modo === "anular" ? MOTIVOS_ANULACION[0] : "");
  const [detalle, setDetalle] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancelar();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancelar]);

  const confirmar = async () => {
    setError("");
    if (modo !== "restaurar" && !motivo.trim()) {
      setError(modo === "anular" ? "Indicá el motivo de la anulación." : "Indicá el motivo de la corrección.");
      return;
    }
    setGuardando(true);
    let r;
    if (modo === "editar") {
      r = await editarJugadaDeReporte(
        venta.id,
        {
          caballo: caballo.trim(),
          ejemplar_numero: ejemplar.trim() === "" ? null : Number(ejemplar),
          monto_jugado: monto.trim() === "" ? null : Number(monto),
          premio_pagar: premio.trim() === "" ? null : Number(premio),
          estado,
        } as EditablesJugada,
        motivo.trim()
      );
    } else if (modo === "anular") {
      r = await anularJugadaDeReporte(venta.id, detalle.trim() ? `${motivo} · ${detalle.trim()}` : motivo);
    } else {
      r = await restaurarJugadaDeReporte(venta.id, motivo.trim() || "Restauración desde el reporte");
    }
    setGuardando(false);
    if (!r.ok) {
      setError(r.error ?? "No se pudo aplicar el cambio.");
      return;
    }
    onHecho(r.error ?? EXITO[modo]);
  };

  const cabecera = `${venta.hipodromo} · C${venta.carrera} · ${venta.caballo || "—"}`;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/60 p-3"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancelar();
      }}
    >
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-black text-slate-800">{TITULO[modo]}</h3>
            <p className="truncate text-[10px] font-semibold text-slate-500">{cabecera}</p>
          </div>
          <button
            type="button"
            onClick={onCancelar}
            title="Cerrar (Esc)"
            className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-black text-slate-500 hover:bg-slate-100"
          >
            ✕
          </button>
        </div>

        <div className="max-h-[65vh] overflow-y-auto p-4">
          <div className="mb-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-600">
            Jugador: <b className="text-slate-800">{venta.jugador || "—"}</b> · Grupo:{" "}
            <b className="text-slate-800">{venta.grupo || "—"}</b> · Monto:{" "}
            <b className="text-slate-800">{venta.monto.toLocaleString("es-VE")}</b>
          </div>

          {modo === "editar" ? (
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Caballo / etiqueta">
                <input value={caballo} onChange={(e) => setCaballo(e.target.value)} className={inputCls} />
              </Campo>
              <Campo label="Nº ejemplar">
                <input
                  value={ejemplar}
                  onChange={(e) => setEjemplar(e.target.value.replace(/\D/g, ""))}
                  className={inputCls}
                />
              </Campo>
              <Campo label="Monto jugado">
                <input
                  value={monto}
                  onChange={(e) => setMonto(e.target.value.replace(/[^\d.]/g, ""))}
                  className={inputCls}
                />
              </Campo>
              <Campo label="Premio a pagar">
                <input
                  value={premio}
                  onChange={(e) => setPremio(e.target.value.replace(/[^\d.]/g, ""))}
                  className={inputCls}
                />
              </Campo>
              <Campo label="Estado">
                <select value={estado} onChange={(e) => setEstado(e.target.value)} className={inputCls}>
                  {ESTADOS.map((e) => (
                    <option key={e} value={e}>
                      {e}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo label="Motivo (obligatorio)">
                <input
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Por qué se corrige"
                  className={inputCls}
                />
              </Campo>
            </div>
          ) : modo === "anular" ? (
            <div className="space-y-3">
              <Campo label="Motivo (obligatorio)">
                <select value={motivo} onChange={(e) => setMotivo(e.target.value)} className={inputCls}>
                  {MOTIVOS_ANULACION.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo label="Detalle (opcional)">
                <textarea
                  value={detalle}
                  onChange={(e) => setDetalle(e.target.value)}
                  rows={3}
                  placeholder="Detalle adicional para el registro"
                  className={inputCls}
                />
              </Campo>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-slate-600">
                Esta jugada está <b className="text-rose-600">anulada</b>. Al restaurarla vuelve a contar para el
                grupo y para la liquidación.
              </p>
              <Campo label="Motivo (por defecto: restauración desde el reporte)">
                <input
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Restauración desde el reporte"
                  className={inputCls}
                />
              </Campo>
            </div>
          )}

          <p className="mt-3 text-[10px] font-semibold text-amber-600">
            Todo cambio queda auditado (usuario, motivo y snapshot). Corregir montos o premios no ajusta el saldo del
            cliente por sí solo: verificalo en contabilidad.
          </p>

          {error && (
            <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-600">
              ⚠️ {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
          <Button variant="outline" size="sm" onClick={onCancelar}>
            Cancelar
          </Button>
          <Button variant="default" size="sm" disabled={guardando} onClick={() => void confirmar()}>
            {guardando ? "Aplicando…" : `${TITULO[modo]} `}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ModalAccionJugadaReporte;
