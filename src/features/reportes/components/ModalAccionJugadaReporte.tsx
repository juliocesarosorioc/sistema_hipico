"use client";

/**
 * MODAL DE ACCIÓN sobre una jugada del REPORTE (Marcas / Tablas Fijas).
 *
 * Un solo modal para los tres modos —corregir, anular y restaurar—, con el
 * motivo OBLIGATORIO (la operación queda auditada). No existe el "crear": la
 * venta se hace por su flujo (Taquilla / Tablas / Marcas).
 *
 * EDICIÓN TOTAL
 * -------------
 * El modo "corregir" habilita TODOS los campos del ticket:
 *   · Jugador 1 (juega) y Jugador 2 (paga/banquero);
 *   · Monto / precio y premio a pagar;
 *   · Tipo de jugada (nomenclatura);
 *   · Ejemplar(es) y su Nº (con SINCRONIZACIÓN nº→nombre oficial del padrón);
 *   · Estado (los estados MAESTROS: Pendiente / Liquidada / Anulada).
 *
 * NOTAS PREDEFINIDAS
 * ------------------
 * El motivo de la corrección se compone de una NOTA PREDEFINIDA (una de las 5
 * de `NOTAS_PREDEFINIDAS_EDICION`) más un detalle libre, para no reescribir a
 * mano lo mismo en cada corrección.
 *
 * RECÁLCULO
 * ---------
 * Al guardar, `edicion-reporte.ts` rehace la carrera si YA está liquidada, así
 * los totales del reporte (cobrado / pagado / comisión de grupo / balance)
 * quedan recalculados.
 *
 * El permiso NO se decide acá: la puerta está en `edicion-reporte.ts`
 * (perfil Administrador Principal). Este componente solo pinta y llama.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/shared/components/ui/Button";
import {
  MOTIVOS_ANULACION,
  NOTAS_PREDEFINIDAS_EDICION,
  componerNota,
  type EditablesJugada,
} from "@/features/jugadas/lib/jugadas";
import type { VentaTablaReporte } from "@/features/tablas/lib/reporte-tablas-nucleo";
import {
  anularJugadaDeReporte,
  editarJugadaDeReporte,
  restaurarJugadaDeReporte,
} from "@/features/reportes/lib/edicion-reporte";
import { ETIQUETA_ESTADO, ESTADOS_MAESTROS, estadoMaestro, type EstadoMaestro } from "@/features/liquidacion/lib/estados-jugada";
import { nombreOficialDeCaballoSuelto } from "@/features/liquidacion/lib/resolver-ejemplar";

export type ModoAccionJugada = "editar" | "anular" | "restaurar";

const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-semibold text-slate-800 focus:border-slate-400 focus:outline-none";

/**
 * Estado MAESTRO que el operador elige. Se mapea al estado INTERNO que entiende
 * el motor: PENDIENTE→"Pendiente", LIQUIDADA→se conserva el interno actual
 * (Ganador/Perdedor/Retirado) o "Ganador" si venía pendiente, ANULADA→"Anulado".
 */
const ESTADOS_MAESTROS_UI: readonly EstadoMaestro[] = ESTADOS_MAESTROS;

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
  const [nombreJugada, setNombreJugada] = useState(venta.caballo ?? "");
  const [jugador1, setJugador1] = useState(venta.jugador ?? "");
  const [jugador2, setJugador2] = useState("");
  const [caballo, setCaballo] = useState(venta.caballo ?? "");
  const [ejemplar, setEjemplar] = useState(venta.numero ?? "");
  /** Nombre oficial resuelto del padrón al cambiar el Nº ("" = no se pudo). */
  const [nombreOficial, setNombreOficial] = useState("");
  const [monto, setMonto] = useState(venta.monto ? String(venta.monto) : "");
  const [premio, setPremio] = useState(venta.pagado ? String(venta.pagado) : "");
  const [estado, setEstado] = useState<EstadoMaestro>(() => estadoMaestro({ estado: venta.estado, anulada: venta.anulada }));
  const [nota, setNota] = useState<string>("");
  const [detalle, setDetalle] = useState("");
  const [motivoLibre, setMotivoLibre] = useState(modo === "anular" ? MOTIVOS_ANULACION[0] : "");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancelar();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancelar]);

  /**
   * Al cambiar el Nº de ejemplar, busca el nombre OFICIAL en el padrón de la
   * carrera y lo deja listo para guardar. Esto resuelve el bug de que quedaba el
   * nombre del caballo ANTERIOR (ej. "ETNA'S NAPPER(USA)") con el Nº nuevo.
   */
  const cambiarEjemplar = async (valor: string) => {
    const limpio = valor.replace(/\D/g, "");
    setEjemplar(limpio);
    setNombreOficial("");
    if (!/^[0-9]+$/.test(limpio)) return;
    const nombre = await nombreOficialDeCaballoSuelto({
      fecha: venta.fecha,
      hipodromo: venta.hipodromo,
      carrera: venta.carrera,
      caballo: limpio,
    });
    if (nombre) {
      setNombreOficial(nombre);
      // El campo `caballo` (etiqueta) pasa a mostrar el nombre real del Nº nuevo.
      setCaballo(nombre);
    }
  };

  const confirmar = async () => {
    setError("");
    const motivoEdicion = componerNota(nota, detalle) || motivoLibre;
    if (modo === "editar" && !motivoEdicion.trim()) {
      setError("Indicá el motivo/nota de la corrección.");
      return;
    }
    if (modo === "anular" && !motivoLibre.trim()) {
      setError("Indicá el motivo de la anulación.");
      return;
    }
    setGuardando(true);
    const ctx = { hipodromo: venta.hipodromo, carrera: venta.carrera, fecha: venta.fecha };
    let r;
    if (modo === "editar") {
      // Estado INTERNO derivado del maestro elegido. LIQUIDADA respeta el estado
      // actual del ticket (no inventa un ganador): solo cambia si venía pendiente.
      const estadoInterno =
        estado === "ANULADA" ? "Anulado" : estado === "PENDIENTE" ? "Pendiente" : venta.estado || "Ganador";
      r = await editarJugadaDeReporte(
        venta.id,
        {
          nombre_jugada: nombreJugada.trim() || null,
          caballo: caballo.trim() || null,
          cliente_juega_nombre: jugador1.trim() || null,
          cliente_consigue_nombre: jugador2.trim() || null,
          ejemplar_numero: ejemplar.trim() === "" ? null : Number(ejemplar),
          monto_jugado: monto.trim() === "" ? null : Number(monto),
          premio_pagar: premio.trim() === "" ? null : Number(premio),
          estado: estadoInterno,
        } as EditablesJugada,
        motivoEdicion.trim(),
        ctx
      );
    } else if (modo === "anular") {
      r = await anularJugadaDeReporte(venta.id, detalle.trim() ? `${motivoLibre} · ${detalle.trim()}` : motivoLibre, ctx);
    } else {
      r = await restaurarJugadaDeReporte(venta.id, motivoLibre.trim() || "Restauración desde el reporte", ctx);
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
              <Campo label="Jugador 1 (juega)">
                <input value={jugador1} onChange={(e) => setJugador1(e.target.value)} className={inputCls} />
              </Campo>
              <Campo label="Jugador 2 / paga (banquero)">
                <input
                  value={jugador2}
                  onChange={(e) => setJugador2(e.target.value)}
                  placeholder="Cliente que paga / banquero"
                  className={inputCls}
                />
              </Campo>
              <Campo label="Tipo de jugada (nomenclatura)">
                <input
                  value={nombreJugada}
                  onChange={(e) => setNombreJugada(e.target.value)}
                  placeholder="ej. TABLA FIJA, MARCA, 2P…"
                  className={inputCls}
                />
              </Campo>
              <Campo label="Ejemplar (etiqueta / nombre)">
                <input value={caballo} onChange={(e) => setCaballo(e.target.value)} className={inputCls} />
              </Campo>
              <Campo label="Nº ejemplar">
                <input value={ejemplar} onChange={(e) => void cambiarEjemplar(e.target.value)} className={inputCls} />
                {nombreOficial && (
                  <span className="mt-0.5 block text-[10px] font-bold text-emerald-600">
                    ✓ Nombre oficial: {nombreOficial}
                  </span>
                )}
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
                <select
                  value={estado}
                  onChange={(e) => setEstado(e.target.value as EstadoMaestro)}
                  className={inputCls}
                >
                  {ESTADOS_MAESTROS_UI.map((m) => (
                    <option key={m} value={m}>
                      {ETIQUETA_ESTADO[m]}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo label="Nota predefinida">
                <select value={nota} onChange={(e) => setNota(e.target.value)} className={inputCls}>
                  <option value="">— Sin nota predefinida —</option>
                  {NOTAS_PREDEFINIDAS_EDICION.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo label="Detalle adicional (opcional)">
                <input
                  value={detalle}
                  onChange={(e) => setDetalle(e.target.value)}
                  placeholder="Texto adicional para la auditoría"
                  className={inputCls}
                />
              </Campo>
            </div>
          ) : modo === "anular" ? (
            <div className="space-y-3">
              <Campo label="Motivo (obligatorio)">
                <select value={motivoLibre} onChange={(e) => setMotivoLibre(e.target.value)} className={inputCls}>
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
                  value={motivoLibre}
                  onChange={(e) => setMotivoLibre(e.target.value)}
                  placeholder="Restauración desde el reporte"
                  className={inputCls}
                />
              </Campo>
            </div>
          )}

          <p className="mt-3 text-[10px] font-semibold text-amber-600">
            Todo cambio queda auditado (usuario, motivo y snapshot). Si la carrera ya está LIQUIDADA, al guardar se
            recalcula completa (premios, comisión del grupo y balance).
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
