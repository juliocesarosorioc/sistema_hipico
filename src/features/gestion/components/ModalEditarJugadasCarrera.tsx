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
import { listarClientes, type Cliente } from "@/features/clientes/lib/clientes";

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
  /** Jugador 1 (Quien Juega). */
  jugador1: string;
  /** Jugador 2 (Quien Da / Consigue). */
  jugador2: string;
  /** Carrera destino (número). */
  carrera: string;
  /** Hipódromo destino. */
  hipodromo: string;
  /** Fecha de la carrera destino (YYYY-MM-DD). */
  fechaCarrera: string;
  /** Modalidad adelantada o en vivo. */
  esAdelantada: boolean;
  /** Nomenclatura de la jugada (nombre_jugada: "GANADOR", "2P", "TABLA 2"…). */
  nombre: string;
  /** El ÚNICO ejemplar/caballo que se juega (texto: "7", "1-2"…). */
  caballo: string;
  monto: string;
  /** Nota predefinida elegida (o "OTRO" para introducir libremente) + detalle libre, para la auditoría. */
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
  if (/^[0-9]+$/.test(t)) return Number(t);
  const m = t.match(/\b(\d{1,2})\b/);
  return m ? Number(m[1]) : null;
}

export default function ModalEditarJugadasCarrera({ hipodromo, nombreHipodromo, carrera, fecha, tasaComision, onCerrar }: Props) {
  const [jugadas, setJugadas] = useState<JugadaAdmin[]>([]);
  const [clientesCatalogo, setClientesCatalogo] = useState<Cliente[]>([]);
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
    const [r, cli] = await Promise.all([
      listarJugadasDeCarrera(hipodromo, carrera, fecha),
      listarClientes().catch(() => [] as Cliente[]),
    ]);
    setClientesCatalogo(cli);
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
    const cabStr = j.caballo?.trim() || (j.ejemplar_numero != null ? String(j.ejemplar_numero) : "");
    setEdicion({
      id: String(j.id),
      jugador1: j.cliente_juega_nombre ?? "",
      jugador2: j.cliente_consigue_nombre ?? "",
      carrera: String(j.carrera ?? carrera),
      hipodromo: String(j.hipodromo ?? hipodromo),
      fechaCarrera: String(j.fecha_carrera ?? fecha),
      esAdelantada: Boolean(j.es_adelantada),
      nombre: j.nombre_jugada ?? "",
      caballo: cabStr,
      monto: j.monto_jugado != null ? String(j.monto_jugado) : "",
      nota: NOTAS_PREDEFINIDAS_EDICION[0],
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
    setEdicion({ ...edicion, caballo: valor, nombreOficial: "" });
    const limpio = valor.trim();
    if (!/^[0-9]+$/.test(limpio)) return;
    const carreraDest = Number(edicion.carrera) || carrera;
    const hipDest = edicion.hipodromo.trim() || hipodromo;
    const fechaDest = edicion.fechaCarrera.trim() || fecha;
    const nombre = await nombreOficialDeCaballoSuelto({
      fecha: fechaDest,
      hipodromo: hipDest,
      carrera: carreraDest,
      caballo: limpio,
    });
    if (nombre) {
      setEdicion((prev) => (prev ? { ...prev, nombreOficial: nombre } : prev));
    }
  };

  const guardarEdicion = async () => {
    if (!edicion) return;
    const notaBase = edicion.nota === "OTRO" ? "" : edicion.nota;
    const motivoFinal = componerNota(notaBase, edicion.detalle || motivo);
    if (!motivoFinal) {
      setAviso("⚠️ Indicá el motivo de la corrección (seleccioná una opción o introducí el motivo libremente).");
      return;
    }
    if (!edicion.jugador1.trim()) {
      setAviso("⚠️ El Jugador 1 (Quien Juega) no puede quedar vacío.");
      return;
    }
    if (!edicion.nombre.trim()) {
      setAviso("⚠️ La jugada (nomenclatura) no puede quedar vacía.");
      return;
    }
    const caballo = edicion.caballo.trim().toUpperCase();
    if (!caballo || !/\d/.test(caballo)) {
      setAviso("⚠️ Condición sine qua non: toda jugada debe tener ejemplar (número de caballo).");
      return;
    }
    const carreraNueva = Number(edicion.carrera);
    if (!Number.isFinite(carreraNueva) || carreraNueva < 1) {
      setAviso("⚠️ El número de carrera debe ser mayor o igual a 1.");
      return;
    }
    const monto = Number(String(edicion.monto).replace(",", "."));
    if (edicion.monto.trim() === "" || !Number.isFinite(monto) || monto <= 0) {
      setAviso("⚠️ El monto jugado debe ser mayor a 0.");
      return;
    }
    setOcupado(true);
    const r = await corregirJugadaYRecalcular({
      id: edicion.id,
      campos: {
        cliente_juega_nombre: edicion.jugador1.trim().toUpperCase(),
        cliente_consigue_nombre: edicion.jugador2.trim() ? edicion.jugador2.trim().toUpperCase() : null,
        carrera: carreraNueva,
        hipodromo: edicion.hipodromo.trim().toUpperCase() || hipodromo,
        fecha_carrera: edicion.fechaCarrera.trim() || fecha,
        es_adelantada: edicion.esAdelantada,
        monto_jugado: monto,
        nombre_jugada: edicion.nombre.trim().toUpperCase(),
        caballo,
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
    setAviso(`✅ ${textoRecalculo(r, "Corrección guardada y recalculada con los nuevos valores.")} · Auditada.`);
    setEdicion(null);
    await cargar();
  };

  const confirmarAnulacion = async () => {
    if (!anulando) return;
    const texto = motivoAnular.trim() || "Anulación de jugada por el operador";
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
    setJugadas((prev) =>
      prev.map((j) => (String(j.id) === String(anulando.id) ? { ...j, anulada: true, anulada_motivo: texto } : j))
    );
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
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col rounded-2xl border border-line bg-white shadow-2xl">
        <datalist id="clientes-editar-carrera-datalist">
          {clientesCatalogo.map((c) => (
            <option key={c.id} value={c.nombre ?? ""} />
          ))}
        </datalist>

        <div className="flex items-center justify-between border-b border-line bg-slate-800 px-4 py-3 text-white">
          <div>
            <h3 className="text-xs font-black uppercase">
              ✏️ Editar jugadas guardadas · {nombreHipodromo} C{carrera}
            </h3>
            <p className="text-[10px] font-semibold text-slate-300">
              Fecha {fecha} · permite modificar Jugadores, Carrera, Ejemplar, Jugada y Monto; recalcula todo con los valores nuevos.
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
                <th className="px-2 py-2 text-left">Jugador 1 (Juega)</th>
                <th className="px-2 py-2 text-left">Jugador 2 (Da)</th>
                <th className="px-2 py-2 text-center">Carrera</th>
                <th className="px-2 py-2 text-left">Jugada</th>
                <th className="px-2 py-2 text-left">Ejemplar</th>
                <th className="px-2 py-2 text-right">Monto</th>
                <th className="px-2 py-2 text-right">Premio</th>
                <th className="px-2 py-2 text-left">Estado</th>
                <th className="px-2 py-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {!cargando && visibles.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-slate-400">
                    No hay jugadas {soloVigentes ? "vigentes" : ""} para esta carrera.
                  </td>
                </tr>
              )}
              {visibles.map((j) => {
                const esEmpateNini =
                  !j.anulada &&
                  /\b[1-5]N\b/i.test(String(j.nombre_jugada ?? "")) &&
                  (j.estado === "Retirado" ||
                    (j.estado === "Perdedor" &&
                      Number(j.monto_jugado ?? 0) > 0 &&
                      Math.abs(Number(j.premio_pagar ?? 0) - Number(j.monto_jugado ?? 0)) < 0.01));
                const estado = j.anulada
                  ? "Anulado"
                  : esEmpateNini
                    ? "Empate (0/0)"
                    : j.estado ?? "Pendiente";
                const enEdicion = edicion?.id === String(j.id);
                return (
                  <tr key={String(j.id)} className={`border-t border-line ${enEdicion ? "bg-indigo-50/60" : j.anulada ? "bg-amber-50/50" : ""}`}>
                    <td className="px-2 py-1.5 font-semibold text-slate-700">
                      {enEdicion ? (
                        <input
                          list="clientes-editar-carrera-datalist"
                          value={edicion.jugador1}
                          onChange={(e) => setEdicion({ ...edicion, jugador1: e.target.value.toUpperCase() })}
                          placeholder="QUIEN JUEGA"
                          className="w-32 rounded border border-indigo-300 bg-white px-1.5 py-0.5 text-xs font-bold uppercase"
                        />
                      ) : (
                        j.cliente_juega_nombre ?? "—"
                      )}
                    </td>
                    <td className="px-2 py-1.5 font-semibold text-slate-600">
                      {enEdicion ? (
                        <input
                          list="clientes-editar-carrera-datalist"
                          value={edicion.jugador2}
                          onChange={(e) => setEdicion({ ...edicion, jugador2: e.target.value.toUpperCase() })}
                          placeholder="TAQUILLA / QUIEN DA"
                          className="w-32 rounded border border-indigo-300 bg-white px-1.5 py-0.5 text-xs font-bold uppercase"
                        />
                      ) : (
                        j.cliente_consigue_nombre || "TAQUILLA"
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-center font-bold text-slate-700">
                      {enEdicion ? (
                        <input
                          type="number"
                          min={1}
                          max={25}
                          value={edicion.carrera}
                          onChange={(e) => setEdicion({ ...edicion, carrera: e.target.value.replace(/\D/g, "") })}
                          className="w-14 rounded border border-indigo-300 bg-white px-1 py-0.5 text-center text-xs font-bold"
                        />
                      ) : (
                        `C${j.carrera ?? carrera}`
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-slate-600">
                      {enEdicion ? (
                        <input
                          value={edicion.nombre}
                          onChange={(e) => setEdicion({ ...edicion, nombre: e.target.value.toUpperCase() })}
                          placeholder="jugada (ej. 2P)"
                          className="w-24 rounded border border-indigo-300 bg-white px-1.5 py-0.5 text-xs font-bold uppercase"
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
                            placeholder="Nº / ejemplar"
                            className="w-24 rounded border border-indigo-300 bg-white px-1.5 py-0.5 text-xs font-bold uppercase"
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
                          className="w-24 rounded border border-indigo-300 bg-white px-1.5 py-0.5 text-right text-xs font-bold"
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
          <div className="border-t border-indigo-200 bg-indigo-50/70 px-4 py-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-black uppercase text-indigo-900">
                ✏️ Editando todos los campos de la jugada #{edicion.id}
              </span>
              <label className="inline-flex items-center gap-1.5 text-[11px] font-bold text-indigo-800">
                <input
                  type="checkbox"
                  checked={edicion.esAdelantada}
                  onChange={(e) => setEdicion({ ...edicion, esAdelantada: e.target.checked })}
                />
                Modalidad Adelantada
              </label>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <div>
                <label className="mb-0.5 block text-[10px] font-black uppercase tracking-wide text-slate-600">
                  Jugador 1 (Quien Juega)
                </label>
                <input
                  list="clientes-editar-carrera-datalist"
                  value={edicion.jugador1}
                  onChange={(e) => setEdicion({ ...edicion, jugador1: e.target.value.toUpperCase() })}
                  className="w-full rounded border border-line bg-white px-2 py-1 text-xs font-bold uppercase"
                />
              </div>
              <div>
                <label className="mb-0.5 block text-[10px] font-black uppercase tracking-wide text-slate-600">
                  Jugador 2 (Quien Da)
                </label>
                <input
                  list="clientes-editar-carrera-datalist"
                  value={edicion.jugador2}
                  onChange={(e) => setEdicion({ ...edicion, jugador2: e.target.value.toUpperCase() })}
                  placeholder="TAQUILLA"
                  className="w-full rounded border border-line bg-white px-2 py-1 text-xs font-bold uppercase"
                />
              </div>
              <div>
                <label className="mb-0.5 block text-[10px] font-black uppercase tracking-wide text-slate-600">
                  Carrera N°
                </label>
                <input
                  type="number"
                  min={1}
                  max={25}
                  value={edicion.carrera}
                  onChange={(e) => setEdicion({ ...edicion, carrera: e.target.value.replace(/\D/g, "") })}
                  className="w-full rounded border border-line bg-white px-2 py-1 text-xs font-bold"
                />
              </div>
              <div>
                <label className="mb-0.5 block text-[10px] font-black uppercase tracking-wide text-slate-600">
                  Jugada
                </label>
                <input
                  value={edicion.nombre}
                  onChange={(e) => setEdicion({ ...edicion, nombre: e.target.value.toUpperCase() })}
                  className="w-full rounded border border-line bg-white px-2 py-1 text-xs font-bold uppercase"
                />
              </div>
              <div>
                <label className="mb-0.5 block text-[10px] font-black uppercase tracking-wide text-slate-600">
                  Ejemplar (Obligatorio)
                </label>
                <input
                  value={edicion.caballo}
                  onChange={(e) => void cambiarEjemplar(e.target.value)}
                  className="w-full rounded border border-line bg-white px-2 py-1 text-xs font-bold uppercase"
                />
              </div>
              <div>
                <label className="mb-0.5 block text-[10px] font-black uppercase tracking-wide text-slate-600">
                  Monto
                </label>
                <input
                  value={edicion.monto}
                  onChange={(e) => setEdicion({ ...edicion, monto: e.target.value })}
                  className="w-full rounded border border-line bg-white px-2 py-1 text-xs font-bold"
                />
              </div>
            </div>

            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <label className="mb-0.5 block text-[10px] font-black uppercase tracking-wide text-slate-600">
                  Motivo de modificación (listado predeterminado)
                </label>
                <select
                  value={edicion.nota}
                  onChange={(e) => setEdicion({ ...edicion, nota: e.target.value })}
                  className="w-full rounded border border-line bg-white px-2 py-1 text-xs font-semibold"
                >
                  {NOTAS_PREDEFINIDAS_EDICION.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                  <option value="OTRO">✍️ Otro (introducir libremente)</option>
                </select>
              </div>
              <div>
                <label className="mb-0.5 block text-[10px] font-black uppercase tracking-wide text-slate-600">
                  {edicion.nota === "OTRO" ? "Introducir motivo libremente (obligatorio)" : "Detalle adicional / observación libre (opcional)"}
                </label>
                <input
                  value={edicion.detalle}
                  onChange={(e) => setEdicion({ ...edicion, detalle: e.target.value })}
                  placeholder={edicion.nota === "OTRO" ? "Escriba el motivo de la modificación…" : "Observación adicional para la auditoría…"}
                  className="w-full rounded border border-line bg-white px-2 py-1 text-xs font-semibold"
                />
              </div>
            </div>
            <p className="mt-1 text-[10px] font-semibold text-indigo-800">
              Al guardar, la jugada toma todos los valores nuevos, ajusta los saldos de los jugadores involucrados y recalcula la carrera automáticamente.
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
