"use client";

/**
 * ✏️ Editar jugadas guardadas de una carrera.
 *
 * Sirve para corregir o anular las jugadas YA REGISTRADAS en `tickets_apuestas`
 * (no las de la sesión en curso), incluso cuando la carrera está cerrada o
 * liquidada. Antes esas jugadas solo se podían tocar desde el Monitor de
 * Jugadas; acá quedan a mano en el mismo módulo donde se cargan los resultados.
 *
 * Todo cambio se audita: `editarJugada` / `anularJugada` dejan snapshot
 * antes/después en `jugadas_auditoria`, y además se agrega una traza en
 * `auditoria` con el motivo del operador.
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/shared/components/ui/Button";
import {
  listarJugadasDeCarrera,
  MOTIVOS_ANULACION,
  NOTAS_PREDEFINIDAS_EDICION,
  componerNota,
  restaurarJugada,
  type JugadaAdmin,
} from "@/features/jugadas/lib/jugadas";
import {
  anularJugadaYRecalcular,
  corregirJugadaYRecalcular,
  recalcularCarrera,
  type ResRecalcular,
} from "@/features/liquidacion/lib/recalcular";
import { nombreOficialDeCaballoSuelto } from "@/features/liquidacion/lib/resolver-ejemplar";
import { registrarAuditoria } from "@/features/grupos/lib/grupos";
import { usuarioVigente } from "@/features/seguridad/lib/vigente";

type Props = {
  hipodromo: string;
  nombreHipodromo: string;
  carrera: number;
  fecha: string;
  /** Comisión de la carrera (la misma con la que se liquidó). Se usa al
   *  recalcular para que la comisión neta por cruces cuadre con la original. */
  tasaComision?: number | null;
  onCerrar: () => void;
};

const money = (v: number | null | undefined, moneda: string): string =>
  `${moneda === "USD" ? "$" : "Bs"} ${Number(v ?? 0).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Resume el resultado de un recálculo de carrera para el aviso del operador. */
function textoRecalculo(r: ResRecalcular, accion: string): string {
  const partes = [accion];
  if (r.revertidos > 0) {
    partes.push(`se revirtieron ${r.revertidos} jugada(s) ya liquidada(s) ($${r.revertidoTotal.toFixed(2)} devuelto a los clientes)`);
  }
  if (r.reliquidados > 0) {
    partes.push(`se re-liquidaron ${r.reliquidados} jugada(s) ($${r.abonoTotal.toFixed(2)} abonado)`);
  }
  if (r.errores.length) {
    partes.push(`⚠️ ${r.errores.length} aviso(s): ${r.errores[0]}`);
  }
  return partes.join(" · ");
}

/** Motivos como string[] para poder usar `.includes` con texto libre. */
const MOTIVOS: readonly string[] = MOTIVOS_ANULACION;

type Edicion = {
  id: string;
  /** Nomenclatura de la jugada (nombre_jugada: "GANADOR", "2P", "TABLA 2"…). */
  nombre: string;
  /** El ÚNICO ejemplar/caballo que se juega (texto: "7", "1-2"…). */
  caballo: string;
  monto: string;
  /** Nota predefinida elegida (una de las 5) + detalle libre, para la auditoría. */
  nota: string;
  detalle: string;
  /** Nombre OFICIAL resuelto del padrón al cambiar el Nº ("" = no se pudo). */
  nombreOficial: string;
};

/**
 * Deriva `ejemplar_numero` del texto de `caballo`, replicando EXACTAMENTE la
 * regla de venta (`taquilla_venta.sql`): sólo si es un número suelto. Así los
 * dos campos que describen al MISMO caballo nunca se desincronizan al corregir.
 */
function ejemplarDeCaballo(caballo: string): number | null {
  const t = caballo.trim();
  return /^[0-9]+$/.test(t) ? Number(t) : null;
}

export default function ModalEditarJugadasCarrera({ hipodromo, nombreHipodromo, carrera, fecha, tasaComision, onCerrar }: Props) {
  const [jugadas, setJugadas] = useState<JugadaAdmin[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [edicion, setEdicion] = useState<Edicion | null>(null);
  const [motivo, setMotivo] = useState("");
  const [anulando, setAnulando] = useState<JugadaAdmin | null>(null);
  const [motivoAnular, setMotivoAnular] = useState("");
  const [soloVigentes, setSoloVigentes] = useState(true);

  const usuario = usuarioVigente();

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    const r = await listarJugadasDeCarrera(hipodromo, carrera, fecha);
    if (!r.ok) {
      setError(r.error ?? "No se pudieron leer las jugadas.");
      setJugadas([]);
    } else {
      setJugadas(r.jugadas);
    }
    setCargando(false);
  }, [hipodromo, carrera, fecha]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const visibles = soloVigentes ? jugadas.filter((j) => !j.anulada) : jugadas;
  const totalVigente = visibles.reduce((a, j) => a + Number(j.monto_jugado ?? 0), 0);

  const empezarEdicion = (j: JugadaAdmin) => {
    setEdicion({
      id: String(j.id),
      nombre: j.nombre_jugada ?? "",
      caballo: j.caballo ?? "",
      monto: j.monto_jugado != null ? String(j.monto_jugado) : "",
      nota: "",
      detalle: "",
      nombreOficial: "",
    });
    setMotivo("");
    setAviso("");
  };

  /**
   * Al cambiar el Nº de ejemplar, busca el nombre OFICIAL en el padrón de la
   * carrera y lo refleja en el campo `caballo`. Resuelve el bug de que quedaba
   * el nombre del caballo ANTERIOR (ej. "ETNA'S NAPPER(USA)") con el Nº nuevo.
   */
  const cambiarEjemplar = async (valor: string) => {
    if (!edicion) return;
    const limpio = valor.replace(/\D/g, "");
    // Si el campo `caballo` era el número viejo (solo dígitos), se reemplaza por
    // el número nuevo; si era un nombre, se reemplaza por el nombre oficial.
    const caballoEraNumero = /^[0-9]*$/.test(edicion.caballo.trim());
    setEdicion({ ...edicion, caballo: caballoEraNumero ? limpio : edicion.caballo, nombreOficial: "" });
    if (!/^[0-9]+$/.test(limpio)) return;
    const nombre = await nombreOficialDeCaballoSuelto({ fecha, hipodromo, carrera, caballo: limpio });
    if (nombre) {
      setEdicion((prev) => (prev ? { ...prev, caballo: nombre, nombreOficial: nombre } : prev));
    }
  };

  const guardarEdicion = async () => {
    if (!edicion) return;
    const motivoFinal = componerNota(edicion.nota, edicion.detalle) || motivo.trim();
    if (!motivoFinal) {
      setAviso("⚠️ Indicá el motivo de la corrección (queda auditado).");
      return;
    }
    if (!edicion.nombre.trim()) {
      setAviso("⚠️ La jugada (nomenclatura) no puede quedar vacía.");
      return;
    }
    const monto = Number(String(edicion.monto).replace(",", "."));
    if (edicion.monto.trim() !== "" && (!Number.isFinite(monto) || monto < 0)) {
      setAviso("⚠️ El monto no es válido.");
      return;
    }
    const caballo = edicion.caballo.trim().toUpperCase();
    setOcupado(true);
    const r = await corregirJugadaYRecalcular({
      id: edicion.id,
      campos: {
        monto_jugado: edicion.monto.trim() === "" ? null : monto,
        // Un solo caballo: `caballo` (texto) y `ejemplar_numero` (entero) se
        // derivan del MISMO valor, igual que en la venta. Antes se editaba solo
        // `caballo` y `ejemplar_numero` quedaba viejo → el renglón mostraba dos
        // caballos distintos. Además, si se cambió el Nº, `caballo` ya trae el
        // NOMBRE OFICIAL resuelto del padrón.
        nombre_jugada: edicion.nombre.trim().toUpperCase(),
        caballo: caballo === "" ? null : caballo,
        ejemplar_numero: ejemplarDeCaballo(edicion.caballo),
      },
      motivo: motivoFinal,
      usuario,
      hipodromo,
      carrera,
      fecha,
      tasaComision,
    });
    setOcupado(false);
    if (!r.ok) {
      setAviso(`❌ ${r.motivo}${r.errores.length ? ` · ${r.errores[0]}` : ""}`);
      return;
    }
    void registrarAuditoria(
      "GESTION_JUGADAS",
      "EDITAR_JUGADA_CARRERA",
      `Jugada #${edicion.id} corregida y carrera recalculada en ${nombreHipodromo} C${carrera} (${fecha}) por ${usuario}. Motivo: ${motivoFinal}`
    );
    setAviso(`✅ ${textoRecalculo(r, "Corrección guardada.")} · Auditada.`);
    setEdicion(null);
    await cargar();
  };

  const confirmarAnulacion = async () => {
    if (!anulando) return;
    if (!motivoAnular.trim()) {
      setAviso("⚠️ Indicá el motivo de la anulación.");
      return;
    }
    // Si el motivo es uno de la lista, se prefija para dejar la traza legible.
    const texto = motivoAnular.trim();
    setOcupado(true);
    const r = await anularJugadaYRecalcular({
      id: anulando.id,
      motivo: texto,
      imagen: null,
      usuario,
      hipodromo,
      carrera,
      fecha,
      tasaComision,
    });
    setOcupado(false);
    if (!r.ok) {
      setAviso(`❌ ${r.motivo}${r.errores.length ? ` · ${r.errores[0]}` : ""}`);
      return;
    }
    void registrarAuditoria(
      "GESTION_JUGADAS",
      "ANULAR_JUGADA_CARRERA",
      `Jugada #${anulando.id} anulada y carrera recalculada en ${nombreHipodromo} C${carrera} (${fecha}) por ${usuario}. Motivo: ${texto}`
    );
    setAviso(`✅ ${textoRecalculo(r, "Jugada anulada.")} · Auditada.`);
    setAnulando(null);
    setMotivoAnular("");
    await cargar();
  };

  const restaurar = async (j: JugadaAdmin) => {
    setOcupado(true);
    const r = await restaurarJugada(j.id, "Restauración desde edición de jugadas", usuario);
    if (!r.ok) {
      setOcupado(false);
      setAviso(`❌ ${r.error ?? "No se pudo restaurar."}`);
      return;
    }
    // Al volver al motor, la carrera se rehace para que premios y comisión
    // cuadren con el nuevo conjunto de jugadas.
    const rec = await recalcularCarrera({ hipodromo, carrera, fecha, tasaComision });
    setOcupado(false);
    void registrarAuditoria(
      "GESTION_JUGADAS",
      "RESTAURAR_JUGADA_CARRERA",
      `Jugada #${j.id} restaurada y carrera recalculada en ${nombreHipodromo} C${carrera} (${fecha}) por ${usuario}.`
    );
    setAviso(`✅ ${textoRecalculo(rec, "Jugada restaurada.")} · Auditada.`);
    await cargar();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col rounded-2xl border border-line bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-line bg-slate-800 px-4 py-3 text-white">
          <div>
            <h3 className="text-xs font-black uppercase">
              ✏️ Editar jugadas guardadas · {nombreHipodromo} C{carrera}
            </h3>
            <p className="text-[10px] font-semibold text-slate-300">
              Fecha {fecha} · corrige o anula las jugadas YA registradas (aunque la carrera esté cerrada). Todo queda auditado.
            </p>
          </div>
          <button type="button" onClick={onCerrar} className="text-slate-300 hover:text-white" aria-label="Cerrar">
            ✕
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-gray-50 px-4 py-2 text-xs">
          <label className="inline-flex items-center gap-1.5 font-semibold text-slate-600">
            <input type="checkbox" checked={soloVigentes} onChange={(e) => setSoloVigentes(e.target.checked)} />
            Solo vigentes (oculta anuladas)
          </label>
          <span className="rounded-full bg-slate-200 px-2 py-0.5 font-bold text-slate-700">
            {visibles.length} jugada(s) · {money(totalVigente, "VES")}
          </span>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => void cargar()} disabled={cargando || ocupado}>
            {cargando ? "Cargando…" : "↻ Refrescar"}
          </Button>
        </div>

        {aviso && <p className="border-b border-line bg-amber-50 px-4 py-2 text-xs font-bold text-amber-800">{aviso}</p>}
        {error && <p className="border-b border-line bg-red-50 px-4 py-2 text-xs font-bold text-red-700">{error}</p>}

        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-slate-50 text-[10px] font-black uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-2 py-2 text-left">Cliente</th>
                <th className="px-2 py-2 text-left">Jugada</th>
                <th className="px-2 py-2 text-left">Caballo</th>
                <th className="px-2 py-2 text-right">Monto</th>
                <th className="px-2 py-2 text-right">Premio</th>
                <th className="px-2 py-2 text-left">Estado</th>
                <th className="px-2 py-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {!cargando && visibles.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                    No hay jugadas {soloVigentes ? "vigentes" : ""} para esta carrera.
                  </td>
                </tr>
              )}
              {visibles.map((j) => {
                const estado = j.anulada ? "Anulado" : j.estado ?? "Pendiente";
                const enEdicion = edicion?.id === String(j.id);
                return (
                  <tr key={String(j.id)} className={`border-t border-line ${j.anulada ? "bg-amber-50/50" : ""}`}>
                    <td className="px-2 py-1.5 font-semibold text-slate-700">{j.cliente_juega_nombre ?? "—"}</td>
                    <td className="px-2 py-1.5 text-slate-600">
                      {enEdicion ? (
                        <input
                          value={edicion.nombre}
                          onChange={(e) => setEdicion({ ...edicion, nombre: e.target.value })}
                          placeholder="jugada (ej. 2P)"
                          className="w-24 rounded border border-line px-1 py-0.5 text-xs"
                        />
                      ) : (
                        j.nombre_jugada ?? "—"
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-slate-600">
                      {enEdicion ? (
                        <div>
                          <input
                            value={edicion.caballo}
                            onChange={(e) => void cambiarEjemplar(e.target.value)}
                            placeholder="Nº / caballo"
                            className="w-28 rounded border border-line px-1 py-0.5 text-xs"
                          />
                          {edicion.nombreOficial && (
                            <span className="mt-0.5 block text-[9px] font-bold text-emerald-600">
                              ✓ {edicion.nombreOficial}
                            </span>
                          )}
                        </div>
                      ) : (
                        <>{j.caballo?.trim() || (j.ejemplar_numero != null ? String(j.ejemplar_numero) : "—")}</>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right font-bold text-slate-700">
                      {enEdicion ? (
                        <input
                          value={edicion.monto}
                          onChange={(e) => setEdicion({ ...edicion, monto: e.target.value })}
                          className="w-24 rounded border border-line px-1 py-0.5 text-right text-xs"
                        />
                      ) : (
                        money(j.monto_jugado, j.moneda ?? "VES")
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right font-bold text-slate-700">
                      {Number(j.premio_pagar ?? 0) > 0 ? money(j.premio_pagar, j.moneda ?? "VES") : "—"}
                    </td>
                    <td className="px-2 py-1.5">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black uppercase text-slate-600">{estado}</span>
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex justify-end gap-1">
                        {enEdicion ? (
                          <>
                            <Button size="sm" variant="success" onClick={() => void guardarEdicion()} disabled={ocupado}>
                              Guardar
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEdicion(null)} disabled={ocupado}>
                              Cancelar
                            </Button>
                          </>
                        ) : j.anulada ? (
                          <Button size="sm" variant="ghost" onClick={() => void restaurar(j)} disabled={ocupado}>
                            ↩️ Restaurar
                          </Button>
                        ) : (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => empezarEdicion(j)} disabled={ocupado}>
                              ✏️ Corregir
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => { setAnulando(j); setMotivoAnular(""); setAviso(""); }} disabled={ocupado}>
                              🚫 Anular
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {edicion && (
          <div className="border-t border-line bg-slate-50 px-4 py-2">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-[10px] font-black uppercase tracking-wide text-slate-500">
                  Nota predefinida
                </label>
                <select
                  value={NOTAS_PREDEFINIDAS_EDICION.includes(edicion.nota as (typeof NOTAS_PREDEFINIDAS_EDICION)[number]) ? edicion.nota : ""}
                  onChange={(e) => setEdicion({ ...edicion, nota: e.target.value })}
                  className="w-full rounded border border-line px-2 py-1 text-xs"
                >
                  <option value="">— Elegir nota —</option>
                  {NOTAS_PREDEFINIDAS_EDICION.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-black uppercase tracking-wide text-slate-500">
                  Detalle adicional (opcional)
                </label>
                <input
                  value={edicion.detalle}
                  onChange={(e) => setEdicion({ ...edicion, detalle: e.target.value })}
                  placeholder="Texto adicional para la auditoría"
                  className="w-full rounded border border-line px-2 py-1 text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-black uppercase tracking-wide text-slate-500">
                  Motivo libre (si no elegís nota)
                </label>
                <input
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Ej. error de carga del operador"
                  className="w-full rounded border border-line px-2 py-1 text-xs"
                />
              </div>
            </div>
            <p className="mt-1 text-[9px] font-semibold text-slate-400">
              La nota elegida + el detalle se guardan como motivo de la auditoría. Si la carrera está liquidada, al
              guardar se recalcula completa.
            </p>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-line bg-gray-50 px-4 py-3">
          <Button variant="ghost" size="sm" onClick={onCerrar}>
            Cerrar
          </Button>
        </div>
      </div>

      {anulando && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-line bg-white shadow-2xl">
            <div className="border-b border-line bg-rose-800 px-4 py-3 text-white">
              <h3 className="text-xs font-black uppercase">🚫 Anular jugada</h3>
              <p className="text-[10px] font-semibold text-rose-100">
                {anulando.cliente_juega_nombre ?? "—"} · {anulando.nombre_jugada ?? "—"} · {money(anulando.monto_jugado, anulando.moneda ?? "VES")}
              </p>
            </div>
            <div className="space-y-2 p-4">
              <label className="block text-[10px] font-black uppercase tracking-wide text-slate-500">Motivo (obligatorio)</label>
              <select
                value={MOTIVOS.includes(motivoAnular) ? motivoAnular : ""}
                onChange={(e) => setMotivoAnular(e.target.value)}
                className="w-full rounded border border-line px-2 py-1 text-xs"
              >
                <option value="">— Elegir motivo —</option>
                {MOTIVOS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <input
                value={motivoAnular}
                onChange={(e) => setMotivoAnular(e.target.value)}
                placeholder="Detalle / otro motivo"
                className="w-full rounded border border-line px-2 py-1 text-xs"
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-line bg-gray-50 px-4 py-3">
              <Button variant="ghost" size="sm" onClick={() => setAnulando(null)} disabled={ocupado}>
                Cancelar
              </Button>
              <Button size="sm" onClick={() => void confirmarAnulacion()} disabled={ocupado}>
                {ocupado ? "Anulando…" : "🚫 Anular jugada"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
