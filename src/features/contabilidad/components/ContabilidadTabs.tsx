"use client";

/**
 * Pantallas internas de Contabilidad. Se separan del shell (`ContabilidadModule`)
 * para que ese archivo quede reducido a la navegación entre secciones.
 *
 * Cada función replica la lógica del legacy correspondiente:
 *   TabIngresos → js/depositos.js · TabCaja → js/caja.js
 *   TabBancos   → js/bancos.js    · TabMonedas → js/monedas.js
 */

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/shared/components/ui/Button";
import { DateInput } from "@/shared/components/ui/DateInput";
import {
  aUsd,
  crearMoneda,
  eliminarBanco,
  esVes,
  filtrarBalanceNIIF,
  guardarBanco,
  guardarTasaReferencia,
  listarHistorialTasas,
  MODALIDADES_EGRESO,
  MODALIDADES_INGRESO,
  registrarAsientoPartidaDobleNIIF,
  registrarContraAsientoNIIF,
  registrarDeposito,
  registrarRetiro,
  registrarTasaCambio,
  registrarTraslado,
  round2,
  saldoBancoUsd,
  totalCaja,
  TIPOS_CUENTA,
  type AsientoNIIFResumen,
  type BancoRow,
  type ClienteSaldo,
  type DepositoRow,
  type FilaBalanceNIIF,
  type MonedaRow,
  type TasaCambioRow,
  type TasaReferenciaRow,
  type TipoDeposito,
  type TransaccionRow,
} from "@/features/contabilidad/lib/contabilidad";
import { emitirToast } from "@/shared/lib/mensajeria";
import { exportarCSV, monedaExacta } from "@/shared/lib/utils";
import { useConfirmar } from "@/shared/store/useConfirmStore";
import { crearCliente } from "@/features/clientes/lib/clientes";
import {
  CONCEPTO_RESUMEN_DUENO,
  completarMovimientoOperadorPendiente,
  listarMovimientosOperadorPendientes,
  type MovimientoOperadorPendiente,
} from "@/features/contabilidad/lib/movimientos-operador";
import {
  PLAN_CUENTAS_HIPICO,
  calcularSaldosPlanCuentas,
  calcularEstadoResultadosSemana,
  obtenerAsientosMemoria,
  generarAsientoPartidaDoble,
  type AsientoContableRegistrado,
  type CuentaContableDef,
  type ClaseCuenta,
  type ModuloOrigenCuenta,
} from "@/features/contabilidad/lib/plan-cuentas";
import { formatearMontoSinMoneda, sumarDinero, restarDinero } from "@/shared/lib/dinero";
import { supabase } from "@/core/supabase";

const inp =
  "w-full border border-line rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-primary-500 bg-surface";
const lbl = "block text-[10px] font-bold text-slate-600 mb-1 uppercase tracking-wider";
const th = "px-3 py-2 text-left text-[9px] font-black uppercase tracking-wider text-slate-500";
const td = "px-3 py-2 align-middle";

const numDe = (s: string) => parseFloat(s.replace(",", ".")) || 0;
const fechaCorta = (f: string | null) =>
  f ? new Date(f).toLocaleString("es-VE", { dateStyle: "short", timeStyle: "short" }) : "—";

const toast = (msg: string, tipo: "success" | "warning" | "error" | "info" = "info") =>
  emitirToast(msg, tipo);

/**
 * Descarga la tabla que se está viendo como CSV y avisa al operador.
 *
 * POR QUÉ CSV Y NO UNA IMAGEN: estos reportes se revisan y se corrigen en
 * Excel, no en la pantalla. El CSV sale con el MISMO contenido que la tabla
 * (ya filtrado), con BOM UTF-8 para que Excel respete los acentos y con
 * separador `;`, que es el que espera el Excel en español.
 */
const exportarTabla = (
  nombre: string,
  cabeceras: string[],
  filas: Array<Array<unknown>>
): void => {
  const ok = exportarCSV(nombre, cabeceras, filas);
  toast(
    ok ? `CSV generado: ${nombre}.csv` : "No se pudo generar el CSV.",
    ok ? "success" : "error"
  );
};

/** Fecha corta para el CSV: la hora no aporta en un reporte contable. */
const csvFecha = (f: string | null): string => (f ? String(f).slice(0, 19).replace("T", " ") : "");

/**
 * Bandeja para el Administrador del Grupo con los movimientos de saldo cargados
 * desde la Vista de Operador ("Por instrucciones del Dueño del grupo (Resumen)")
 * pendientes por registrar banco, referencia, día y demás información.
 */
function BandejaMovimientosOperadorPendientes({
  bancos,
  onCompletado,
}: {
  bancos: BancoRow[];
  onCompletado: () => Promise<void>;
}) {
  const [pendientes, setPendientes] = useState<MovimientoOperadorPendiente[]>([]);
  const [activo, setActivo] = useState<MovimientoOperadorPendiente | null>(null);
  const [verImagen, setVerImagen] = useState<string | null>(null);
  const [bancoId, setBancoId] = useState("");
  const [referencia, setReferencia] = useState("");
  const [fechaMov, setFechaMov] = useState(() => new Date().toISOString().slice(0, 10));
  const [modalidad, setModalidad] = useState(CONCEPTO_RESUMEN_DUENO);
  const [nota, setNota] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cargar = async () => {
    const lista = await listarMovimientosOperadorPendientes();
    setPendientes(lista);
  };

  useEffect(() => {
    void cargar();
    const handler = () => void cargar();
    window.addEventListener("hipico:movimientos-operador-actualizados", handler);
    return () => window.removeEventListener("hipico:movimientos-operador-actualizados", handler);
  }, []);

  if (pendientes.length === 0) return null;

  const abrirCompletar = (m: MovimientoOperadorPendiente) => {
    setActivo(m);
    setBancoId(m.banco_id ?? "");
    setReferencia(m.referencia && m.referencia !== "PENDIENTE" ? m.referencia : "");
    setFechaMov(m.fecha_creacion ? m.fecha_creacion.slice(0, 10) : new Date().toISOString().slice(0, 10));
    setModalidad(CONCEPTO_RESUMEN_DUENO);
    setNota("");
  };

  const guardarDatos = async () => {
    if (!activo) return;
    const bObj = bancos.find((b) => String(b.id) === String(bancoId));
    if (!bancoId) {
      toast("Seleccione el banco del movimiento.", "warning");
      return;
    }
    if (!referencia.trim()) {
      toast("Indique la referencia del comprobante.", "warning");
      return;
    }
    setGuardando(true);
    const res = await completarMovimientoOperadorPendiente({
      movimiento: activo,
      banco_id: bancoId,
      banco_nombre: bObj?.nombre ?? "BANCO",
      referencia: referencia.trim(),
      fecha_movimiento: fechaMov,
      modalidad: modalidad || CONCEPTO_RESUMEN_DUENO,
      nota: nota.trim(),
    });
    setGuardando(false);
    if (!res.ok) {
      toast(res.error ?? "No se pudo completar el movimiento.", "error");
      return;
    }
    toast(`✅ Movimiento de ${activo.cliente_nombre} completado con banco, referencia y fecha.`, "success");
    setActivo(null);
    await cargar();
    await onCompletado();
  };

  return (
    <div className="mb-4 rounded-2xl border-2 border-amber-400 bg-amber-50/90 p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="inline-block rounded-full bg-amber-500 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-white">
            ⏳ Pendientes de Operador ({pendientes.length})
          </span>
          <h3 className="mt-1 text-xs font-black uppercase tracking-wide text-amber-950">
            Movimientos por Instrucciones del Dueño del Grupo (Resumen) · Pendientes por Completar Datos
          </h3>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {pendientes.map((m) => (
          <div
            key={m.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-white px-3.5 py-2.5 text-xs shadow-xs"
          >
            <div className="space-y-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded px-2 py-0.5 text-[10px] font-black uppercase ${
                    m.tipo === "INGRESO"
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-rose-100 text-rose-800"
                  }`}
                >
                  {m.tipo === "INGRESO" ? "➕ Ingreso" : "➖ Egreso"}
                </span>
                <span className="font-black text-slate-900">{m.cliente_nombre}</span>
                <span className="font-mono font-black text-indigo-700">${m.monto.toFixed(2)}</span>
                <span className="text-[10px] font-bold text-slate-500">
                  (Saldo: ${m.saldo_anterior.toFixed(2)} → ${m.saldo_nuevo.toFixed(2)})
                </span>
              </div>
              <p className="text-[10px] font-semibold text-slate-500">
                📋 {m.concepto} · Cargado por <strong>{m.operador}</strong> el {fechaCorta(m.fecha_creacion)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {m.comprobante_imagen && (
                <button
                  type="button"
                  onClick={() => setVerImagen(m.comprobante_imagen)}
                  className="rounded-lg border border-indigo-300 bg-indigo-50 px-2.5 py-1.5 text-[10px] font-black text-indigo-800 hover:bg-indigo-100"
                >
                  🖼️ Ver Capture
                </button>
              )}
              <button
                type="button"
                onClick={() => abrirCompletar(m)}
                className="rounded-lg bg-amber-600 px-3 py-1.5 text-[10px] font-black text-white shadow-xs hover:bg-amber-700"
              >
                ✏️ Registrar Banco, Referencia y Día
              </button>
            </div>
          </div>
        ))}
      </div>

      {activo && (
        <div className="mt-3 rounded-xl border-2 border-indigo-400 bg-white p-4 shadow-md">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-black uppercase text-indigo-950">
              Completar Datos Bancarios · {activo.cliente_nombre} ({activo.tipo === "INGRESO" ? "Ingreso" : "Egreso"} ${activo.monto.toFixed(2)})
            </h4>
            <button
              type="button"
              onClick={() => setActivo(null)}
              className="text-xs font-bold text-slate-500 hover:text-slate-800"
            >
              ✕ Cerrar
            </button>
          </div>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className={lbl}>Banco *</label>
              <select value={bancoId} onChange={(e) => setBancoId(e.target.value)} className={`${inp} font-bold`}>
                <option value="">— Seleccione Banco —</option>
                {bancos.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.nombre} ({b.moneda_codigo ?? "USD"})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={lbl}>N° de Referencia *</label>
              <input
                value={referencia}
                onChange={(e) => setReferencia(e.target.value)}
                placeholder="Ej: 00492817"
                className={inp}
              />
            </div>
            <div>
              <label className={lbl}>Día del Movimiento *</label>
              <DateInput value={fechaMov} onFechaChange={(val) => setFechaMov(val)} className={inp} />
            </div>
            <div>
              <label className={lbl}>Modalidad / Concepto</label>
              <select value={modalidad} onChange={(e) => setModalidad(e.target.value)} className={`${inp} font-bold`}>
                <option value={CONCEPTO_RESUMEN_DUENO}>{CONCEPTO_RESUMEN_DUENO}</option>
                {(activo.tipo === "INGRESO" ? MODALIDADES_INGRESO : MODALIDADES_EGRESO).map((mod) => (
                  <option key={mod} value={mod}>
                    {mod}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
            <input
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Observación o detalle adicional del movimiento..."
              className={`${inp} max-w-md`}
            />
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setActivo(null)}>
                Cancelar
              </Button>
              <Button variant="success" size="sm" disabled={guardando} onClick={() => void guardarDatos()}>
                {guardando ? "Guardando..." : "✅ Guardar Banco, Referencia y Día"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {verImagen && (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/75 p-4"
          onClick={() => setVerImagen(null)}
        >
          <div
            className="max-w-2xl overflow-hidden rounded-2xl bg-white p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-black uppercase text-slate-800">
                📸 Capture de Comprobante Adjunto por el Operador
              </span>
              <button
                type="button"
                onClick={() => setVerImagen(null)}
                className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-slate-200"
              >
                ✕ Cerrar
              </button>
            </div>
            <img
              src={verImagen}
              alt="Capture comprobante"
              className="max-h-[75vh] w-full rounded-xl border border-slate-200 object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ===========================================================================
//  📥  INGRESOS / AVALES   (js/depositos.js)
// ===========================================================================

export function TabIngresos({
  clientes,
  bancos,
  depositos,
  tasaVes,
  onHecho,
}: {
  clientes: ClienteSaldo[];
  bancos: BancoRow[];
  depositos: DepositoRow[];
  tasaVes: number;
  onHecho: () => Promise<void>;
}) {
  const [filtro, setFiltro] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [tipo, setTipo] = useState<TipoDeposito>("Normal");
  const [fechaAsiento, setFechaAsiento] = useState(() => new Date().toISOString().slice(0, 10));
  const [monto, setMonto] = useState("");
  const [moneda, setMoneda] = useState<"USD" | "VES">("USD");
  const [tasa, setTasa] = useState(String(tasaVes));
  const [modalidad, setModalidad] = useState("");
  const [bancoId, setBancoId] = useState("");
  const [referencia, setReferencia] = useState("");
  const [nota, setNota] = useState("");
  const [filtroHistorial, setFiltroHistorial] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [mostrarListaCliente, setMostrarListaCliente] = useState(false);
  const [registrandoClienteRapido, setRegistrandoClienteRapido] = useState(false);

  useEffect(() => {
    if (esVes(moneda)) setTasa(String(tasaVes));
  }, [moneda, tasaVes]);

  const montoNum = numDe(monto);
  const montoUsd = aUsd(montoNum, moneda, parseFloat(tasa));
  // El aval no es dinero: suma al límite del cliente, no entra a la cuenta.
  const esAval = tipo === "Otorgar Aval";

  /** Historial de ingresos filtrado por cliente, tipo, modalidad o referencia. */
  const visiblesDepositos = useMemo(() => {
    const f = filtroHistorial.trim().toUpperCase();
    if (!f) return depositos;
    return depositos.filter((d) =>
      `${d.cliente_nombre ?? ""} ${d.tipo_operacion ?? ""} ${d.modalidad ?? ""} ${
        d.referencia ?? ""
      } ${d.nota ?? ""}`
        .toUpperCase()
        .includes(f)
    );
  }, [depositos, filtroHistorial]);

  const visibles = useMemo(() => {
    const f = filtro.trim().toUpperCase();
    return f ? clientes.filter((c) => c.nombre.toUpperCase().includes(f)) : clientes;
  }, [clientes, filtro]);

  const clienteSeleccionadoObj = useMemo(
    () => clientes.find((c) => String(c.id) === String(clienteId)) ?? null,
    [clientes, clienteId]
  );

  const existeExactoEnGrupo = useMemo(() => {
    const f = filtro.trim().toUpperCase();
    if (!f) return true;
    return clientes.some((c) => c.nombre.trim().toUpperCase() === f);
  }, [clientes, filtro]);

  const registrarClienteDirecto = async () => {
    const nombreNuevo = filtro.trim().toUpperCase();
    if (!nombreNuevo) return;
    if (existeExactoEnGrupo) {
      toast(`⚠️ El cliente "${nombreNuevo}" ya existe en este grupo. No puede haber dos clientes iguales en el mismo grupo.`, "warning");
      return;
    }
    setRegistrandoClienteRapido(true);
    try {
      const res = await crearCliente({
        nombre: nombreNuevo,
        seudonimo: nombreNuevo,
        modo_juego: "aval",
        saldo_actual: 0,
        aval: 0,
      });
      if (!res.ok) {
        toast(res.error ?? "No se pudo registrar el cliente.", "error");
        return;
      }
      toast(`✅ Cliente "${nombreNuevo}" registrado directamente en el grupo.`, "success");
      await onHecho();
      if (res.id) {
        setClienteId(String(res.id));
      }
      setMostrarListaCliente(false);
    } finally {
      setRegistrandoClienteRapido(false);
    }
  };

  const guardar = async () => {
    if (!clienteId) return toast("Debe seleccionar un cliente.", "warning");
    if (!(montoNum > 0)) return toast("Indique un monto válido.", "warning");
    if (tipo !== "Otorgar Aval") {
      if (!modalidad) return toast("Debe indicar la modalidad del ingreso.", "warning");
      if (!bancoId) return toast("Debe seleccionar el banco receptor.", "warning");
    }
    if (esVes(moneda) && !(parseFloat(tasa) > 0))
      return toast("Indique la tasa aplicada al ingreso en Bs.", "warning");

    setGuardando(true);
    const r = await registrarDeposito({
      cliente_id: clienteId,
      tipo_operacion: tipo,
      monto: montoNum,
      moneda,
      tasa_cambio: parseFloat(tasa) || 1,
      modalidad: modalidad || null,
      banco_id: bancoId || null,
      referencia: referencia.trim() || null,
      nota: nota.trim() || null,
      fecha_asiento: fechaAsiento,
    });
    setGuardando(false);
    if (!r.ok) return toast(r.error ?? "Error al registrar.", "error");
    toast(
      `${tipo} registrada por $${round2(montoUsd)}.` +
        (r.aval_nuevo != null && tipo !== "Normal" ? ` Aval restante: $${r.aval_nuevo}.` : ""),
      "success"
    );
    setMonto("");
    setReferencia("");
    setNota("");
    await onHecho();
  };

  return (
    <div className="space-y-4">
      <BandejaMovimientosOperadorPendientes bancos={bancos} onCompletado={onHecho} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-line bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-black uppercase text-slate-700">
            <span className="mr-1 text-emerald-600">➕</span> Registrar ingreso
          </h2>
          <div className="space-y-2">
            <div className="relative">
              <label className={lbl}>Cliente * (búsqueda automática al escribir)</label>
              <input
                value={filtro}
                onFocus={() => setMostrarListaCliente(true)}
                onChange={(e) => {
                  const val = e.target.value.toUpperCase();
                  setFiltro(val);
                  setMostrarListaCliente(true);
                  const exacto = clientes.find((c) => c.nombre.trim().toUpperCase() === val.trim());
                  setClienteId(exacto ? String(exacto.id) : "");
                }}
                placeholder="Escriba el nombre del cliente…"
                className={`${inp} font-bold`}
              />
              {clienteSeleccionadoObj && (
                <div className="mt-1 flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-900">
                  <span>✅ {clienteSeleccionadoObj.nombre}</span>
                  <span>Saldo: ${round2(clienteSeleccionadoObj.saldo_actual).toFixed(2)}</span>
                </div>
              )}
              {mostrarListaCliente && (filtro.trim().length > 0 || !clienteSeleccionadoObj) && (
                <div className="mt-1 max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                  {visibles.slice(0, 30).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setClienteId(String(c.id));
                        setFiltro(c.nombre);
                        setMostrarListaCliente(false);
                      }}
                      className={`flex w-full items-center justify-between border-b border-slate-100 px-3 py-1.5 text-left text-xs font-bold transition hover:bg-emerald-50 ${
                        String(clienteId) === String(c.id) ? "bg-emerald-50 text-emerald-900" : "text-slate-800"
                      }`}
                    >
                      <span>{c.nombre}</span>
                      <span className="font-mono text-[11px] text-slate-600">
                        saldo ${round2(c.saldo_actual).toFixed(2)}
                      </span>
                    </button>
                  ))}
                  {filtro.trim().length > 0 && !existeExactoEnGrupo && (
                    <div className="border-t border-amber-200 bg-amber-50 p-2.5">
                      <p className="text-[10px] font-bold text-amber-900">
                        El cliente <strong>«{filtro.trim()}»</strong> no existe en este grupo.
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          disabled={registrandoClienteRapido}
                          onClick={() => void registrarClienteDirecto()}
                          className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[10px] font-black text-white shadow-xs hover:bg-emerald-700 disabled:opacity-50"
                        >
                          {registrandoClienteRapido
                            ? "Registrando..."
                            : `➕ Registrar «${filtro.trim()}» en este grupo`}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          <div>
            <label className={lbl}>Tipo de operación</label>
            <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoDeposito)} className={`${inp} font-bold`}>
              <option value="Normal">Normal (ingreso real)</option>
              <option value="Otorgar Aval">Otorgar Aval</option>
              <option value="Pagar Aval">Pagar Aval</option>
            </select>
          </div>
          <div>
            <label className={lbl}>Fecha del Asiento (Operación Contable) *</label>
            <DateInput
              value={fechaAsiento}
              onFechaChange={(val) => setFechaAsiento(val)}
              className={inp}
            />
            <p className="mt-0.5 text-[9px] text-slate-500">
              * Fecha contable manual. La fecha del movimiento se registra internamente en el sistema al guardar.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={lbl}>Monto *</label>
              <input
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                inputMode="decimal"
                className={`${inp} text-right font-mono font-black text-emerald-700`}
              />
            </div>
            <div>
              <label className={lbl}>Moneda</label>
              <select value={moneda} onChange={(e) => setMoneda(e.target.value as "USD" | "VES")} className={`${inp} font-bold`}>
                <option value="USD">USD</option>
                <option value="VES">Bs (VES)</option>
              </select>
            </div>
          </div>
          {esVes(moneda) && (
            <div>
              <label className={lbl}>Tasa (Bs por 1 USD) *</label>
              <input
                value={tasa}
                onChange={(e) => setTasa(e.target.value)}
                inputMode="decimal"
                className={`${inp} text-right font-mono font-bold`}
              />
            </div>
          )}
          {!esAval && (
            <>
              <div>
                <label className={lbl}>Modalidad *</label>
                <select value={modalidad} onChange={(e) => setModalidad(e.target.value)} className={`${inp} font-bold`}>
                  <option value="">— Seleccione —</option>
                  {MODALIDADES_INGRESO.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                  {bancos.map((b) => (
                    <option key={b.id} value={`BANCO ${b.nombre}`}>
                      BANCO {b.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={lbl}>Banco receptor *</label>
                <select value={bancoId} onChange={(e) => setBancoId(e.target.value)} className={`${inp} font-bold`}>
                  <option value="">— Seleccione —</option>
                  {bancos.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.nombre} · {b.moneda_codigo ?? "USD"} · ${round2(Number(b.saldo_local ?? 0))}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={lbl}>Referencia</label>
                <input value={referencia} onChange={(e) => setReferencia(e.target.value)} className={inp} />
              </div>
            </>
          )}
          <div>
            <label className={lbl}>Nota</label>
            <input value={nota} onChange={(e) => setNota(e.target.value)} className={inp} />
          </div>

          <div className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-600">
            {esVes(moneda) ? (
              <>
                {montoNum.toFixed(2)} Bs ÷ {parseFloat(tasa) || 0} ={" "}
                <span className="font-black text-emerald-700">${montoUsd.toFixed(2)}</span>
              </>
            ) : (
              <>
                Equivalente: <span className="font-black text-emerald-700">${montoUsd.toFixed(2)}</span>
              </>
            )}
            {esAval && <div className="mt-1 text-[10px] text-amber-700">El aval no mueve el banco.</div>}
          </div>

          <Button variant="success" size="sm" className="w-full" disabled={guardando} onClick={guardar}>
            <span >✅</span> {guardando ? "Guardando…" : "Registrar"}
          </Button>
        </div>
      </div>

      <div className="space-y-4 lg:col-span-2">
        <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
          <div className="border-b border-line px-4 py-2 text-sm font-black uppercase text-slate-700">
            <span className="mr-1 text-primary-600">👥</span> Saldos y deudas
          </div>
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  <th className={th}>Cliente</th>
                  <th className={th + " text-right"}>Saldo</th>
                  <th className={th + " text-right"}>Aval</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((c) => (
                  <tr key={c.id} className="border-t border-line">
                    <td className={td + " font-semibold text-slate-700"}>{c.nombre}</td>
                    <td className={`${td} text-right font-mono font-black ${c.saldo_actual < 0 ? "text-danger-600" : "text-emerald-700"}`}>
                      {round2(c.saldo_actual).toFixed(2)}
                    </td>
                    <td className={`${td} text-right font-mono ${c.aval > 0 ? "font-black text-amber-700" : "text-slate-400"}`}>
                      {round2(c.aval).toFixed(2)}
                    </td>
                  </tr>
                ))}
                {visibles.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-3 py-8 text-center text-slate-400">
                      Sin clientes que coincidan.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
            <span className="text-sm font-black uppercase text-slate-700">
              <span className="mr-1 text-primary-600">🕙</span> Historial de ingresos
            </span>
            <div className="flex items-center gap-2">
              <input
                value={filtroHistorial}
                onChange={(e) => setFiltroHistorial(e.target.value.toUpperCase())}
                placeholder="Filtrar ingresos…"
                className={`${inp} w-48 py-1`}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  exportarTabla(
                    "contabilidad_ingresos",
                    ["Fecha Asiento", "Fecha Movimiento", "Cliente", "Tipo", "Modalidad", "Moneda", "Monto", "Monto USD"],
                    visiblesDepositos.map((d) => [
                      d.fecha_asiento ? String(d.fecha_asiento).slice(0, 10) : (d.fecha ? String(d.fecha).slice(0, 10) : ""),
                      csvFecha(d.fecha_movimiento ?? d.fecha),
                      d.cliente_nombre ?? "",
                      d.tipo_operacion ?? "Normal",
                      d.modalidad ?? "",
                      d.moneda ?? "USD",
                      round2(Number(d.monto ?? 0)).toFixed(2),
                      round2(Number(d.monto_usd ?? d.monto ?? 0)).toFixed(2),
                    ])
                  )
                }
              >
                <span>⬇️</span> CSV
              </Button>
            </div>
          </div>
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  <th className={th}>Fecha Asiento</th>
                  <th className={th}>Fecha Movimiento</th>
                  <th className={th}>Cliente</th>
                  <th className={th}>Tipo</th>
                  <th className={th}>Modalidad</th>
                  <th className={th + " text-right"}>Monto</th>
                </tr>
              </thead>
              <tbody>
                {visiblesDepositos.map((d) => (
                  <tr key={d.id} className="border-t border-line">
                    <td className={td + " font-mono font-bold text-slate-700"}>
                      {d.fecha_asiento ? String(d.fecha_asiento).slice(0, 10) : (d.fecha ? String(d.fecha).slice(0, 10) : "—")}
                    </td>
                    <td className={td + " text-[11px] text-slate-500"}>
                      {fechaCorta(d.fecha_movimiento ?? d.fecha)}
                    </td>
                    <td className={td + " font-semibold text-slate-700"}>{d.cliente_nombre ?? "—"}</td>
                    <td className={td}>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[9px] font-black uppercase ${
                          d.tipo_operacion === "Otorgar Aval"
                            ? "bg-amber-100 text-amber-800"
                            : d.tipo_operacion === "Pagar Aval"
                              ? "bg-purple-100 text-purple-800"
                              : "bg-emerald-100 text-emerald-800"
                        }`}
                      >
                        {d.tipo_operacion ?? "Normal"}
                      </span>
                    </td>
                    <td className={td + " text-slate-600"}>{d.modalidad || "—"}</td>
                    <td className={`${td} text-right font-mono font-black ${d.tipo_operacion === "Pagar Aval" ? "text-purple-700" : "text-emerald-700"}`}>
                      {esVes(d.moneda)
                        ? `${Number(d.monto ?? 0).toFixed(2)} Bs`
                        : `$${round2(Number(d.monto_usd ?? d.monto ?? 0)).toFixed(2)}`}
                    </td>
                  </tr>
                ))}
                {visiblesDepositos.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-slate-400">
                      {depositos.length === 0
                        ? "Sin ingresos registrados."
                        : "Ningún ingreso coincide con el filtro."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

// ===========================================================================
//  💵  CAJA UNIFICADA   (js/caja.js)
// ===========================================================================

export function TabCaja({
  clientes,
  bancos,
  transacciones,
  tasaVes,
  onHecho,
}: {
  clientes: ClienteSaldo[];
  bancos: BancoRow[];
  transacciones: TransaccionRow[];
  tasaVes: number;
  onHecho: () => Promise<void>;
}) {
  const [modo, setModo] = useState<"traslado" | "retiro">("traslado");
  const [fechaAsiento, setFechaAsiento] = useState(() => new Date().toISOString().slice(0, 10));

  const [origen, setOrigen] = useState("");
  const [destino, setDestino] = useState("");
  const [monto, setMonto] = useState("");
  const [moneda, setMoneda] = useState<"USD" | "VES">("USD");
  const [tasa, setTasa] = useState(String(tasaVes));
  const [nota, setNota] = useState("");

  const [modalidad, setModalidad] = useState("");
  const [bancoId, setBancoId] = useState("");
  const [referencia, setReferencia] = useState("");
  const [numeroCuenta, setNumeroCuenta] = useState("");
  const [tipoCuenta, setTipoCuenta] = useState("");
  const [cedula, setCedula] = useState("");
  const [beneficiario, setBeneficiario] = useState("");
  const [filtro, setFiltro] = useState("");
  const [guardando, setGuardando] = useState(false);

  const montoNum = numDe(monto);
  const montoUsd = aUsd(montoNum, moneda, parseFloat(tasa));
  const total = totalCaja(clientes);
  const conSaldo = clientes.filter((c) => c.saldo_actual !== 0);
  const deudores = clientes.filter((c) => c.saldo_actual < 0);

  /**
   * Libro mayor filtrado. El filtro es de texto libre sobre TODO lo que
   * identifica el movimiento (tipo, origen, destino, modalidad, referencia),
   * porque el operador busca "el retiro de Juan" o "la referencia 12345", no
   * por un campo y otro.
   */
  const visiblesTransacciones = useMemo(() => {
    const f = filtro.trim().toUpperCase();
    if (!f) return transacciones;
    return transacciones.filter((t) =>
      `${t.tipo_operacion ?? ""} ${t.cliente_origen_nombre ?? ""} ${
        t.cliente_destino_nombre ?? ""
      } ${t.modalidad ?? ""} ${t.referencia ?? ""} ${t.nota ?? ""}`
        .toUpperCase()
        .includes(f)
    );
  }, [transacciones, filtro]);

  const guardar = async () => {
    if (!origen) return toast("Debe seleccionar un cliente origen.", "warning");
    if (!(montoNum > 0)) return toast("El monto debe ser un número mayor a cero.", "warning");

    setGuardando(true);
    const r =
      modo === "traslado"
        ? await registrarTraslado({
            origen_id: origen,
            destino_id: destino,
            monto: montoNum,
            nota: nota.trim() || null,
            fecha_asiento: fechaAsiento,
          })
        : await registrarRetiro({
            origen_id: origen,
            monto: montoNum,
            moneda,
            tasa_cambio: parseFloat(tasa) || 1,
            modalidad,
            banco_id: bancoId || null,
            referencia: referencia.trim() || null,
            numero_cuenta: numeroCuenta.trim() || null,
            tipo_cuenta: tipoCuenta || null,
            cedula_rif: cedula.trim().toUpperCase() || null,
            beneficiario: beneficiario.trim() || null,
            nota: nota.trim() || null,
            fecha_asiento: fechaAsiento,
          });
    setGuardando(false);
    if (!r.ok) return toast(r.error ?? "Error al registrar.", "error");
    toast(
      modo === "traslado"
        ? `Traslado de $${round2(montoNum)} registrado.`
        : `Retiro de $${round2(r.monto_usd ?? montoNum)} registrado.`,
      "success"
    );
    setMonto("");
    setNota("");
    setReferencia("");
    await onHecho();
  };

  return (
    <div className="space-y-4">
      <BandejaMovimientosOperadorPendientes bancos={bancos} onCompletado={onHecho} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-line bg-white p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Saldo en caja</p>
          <p className={`text-2xl font-black ${total < 0 ? "text-danger-600" : "text-emerald-700"}`}>${total.toFixed(2)}</p>
          <p className="text-[10px] text-slate-400">Suma de los saldos de los clientes</p>
        </div>
        <div className="rounded-2xl border border-line bg-white p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Clientes con saldo</p>
          <p className="text-2xl font-black text-slate-700">{conSaldo.length}</p>
          <p className="text-[10px] text-slate-400">de {clientes.length} clientes</p>
        </div>
        <div className="rounded-2xl border border-line bg-white p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Deben (saldo negativo)</p>
          <p className="text-2xl font-black text-danger-600">{deudores.length}</p>
          {/* Con aval, un saldo negativo NO es mora: es deuda garantizada, y el
              banco respalda hasta donde llega el aval. Mostrar solo el saldo
              bruto hacía creer que la banca estaba exponida a clientes que en
              realidad no le deben nada. */}
          <p className="text-[10px] text-slate-400">
            Bruto ${round2(deudores.reduce((a, c) => a + c.saldo_actual, 0)).toFixed(2)}
            {deudores.some((c) => (c.aval ?? 0) > 0) ? (
              <>
                {" · "}
                <span className="font-bold text-amber-700">
                  neto ${round2(deudores.reduce((a, c) => a + Math.min(0, c.saldo_actual + (c.aval ?? 0)), 0)).toFixed(2)}
                </span>
              </>
            ) : null}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-line bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-black uppercase text-slate-700">
            <span className="mr-1 text-primary-600">↔️</span> Movimiento de caja
          </h2>
          <div className="mb-3 flex gap-1 rounded-lg bg-slate-100 p-1">
            {(["traslado", "retiro"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setModo(m)}
                className={`flex-1 rounded-md px-2 py-1.5 text-[10px] font-black uppercase transition-colors ${
                  modo === m ? "bg-white text-primary-700 shadow-sm" : "text-slate-500"
                }`}
              >
                {m === "traslado" ? "Traslado" : "Retiro"}
              </button>
            ))}
          </div>
          <div className="space-y-2">
            <div>
              <label className={lbl}>Fecha del Asiento (Operación Contable) *</label>
              <DateInput
                value={fechaAsiento}
                onFechaChange={(val) => setFechaAsiento(val)}
                className={inp}
              />
              <p className="mt-0.5 text-[9px] text-slate-500">
                * Fecha contable manual. La fecha del movimiento se registra internamente en el sistema al guardar.
              </p>
            </div>
            <div>
              <label className={lbl}>Cliente origen *</label>
              <select value={origen} onChange={(e) => setOrigen(e.target.value)} className={`${inp} font-bold`}>
                <option value="">— Seleccione —</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre} · ${round2(c.saldo_actual)}
                  </option>
                ))}
              </select>
            </div>
            {modo === "traslado" && (
              <div>
                <label className={lbl}>Cliente destino *</label>
                <select value={destino} onChange={(e) => setDestino(e.target.value)} className={`${inp} font-bold`}>
                  <option value="">— Seleccione —</option>
                  {clientes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre} · ${round2(c.saldo_actual)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={lbl}>Monto *</label>
                <input
                  value={monto}
                  onChange={(e) => setMonto(e.target.value)}
                  inputMode="decimal"
                  className={`${inp} text-right font-mono font-black text-danger-700`}
                />
              </div>
              {modo === "retiro" && (
                <div>
                  <label className={lbl}>Moneda</label>
                  <select value={moneda} onChange={(e) => setMoneda(e.target.value as "USD" | "VES")} className={`${inp} font-bold`}>
                    <option value="USD">USD</option>
                    <option value="VES">Bs (VES)</option>
                  </select>
                </div>
              )}
            </div>
            {modo === "retiro" && (
              <>
                {esVes(moneda) && (
                  <div>
                    <label className={lbl}>Tasa (Bs por 1 USD) *</label>
                    <input value={tasa} onChange={(e) => setTasa(e.target.value)} inputMode="decimal" className={`${inp} text-right font-mono font-bold`} />
                  </div>
                )}
                <div>
                  <label className={lbl}>Modalidad *</label>
                  <select value={modalidad} onChange={(e) => setModalidad(e.target.value)} className={`${inp} font-bold`}>
                    <option value="">— Seleccione —</option>
                    {MODALIDADES_EGRESO.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                    {bancos.map((b) => (
                      <option key={b.id} value={`BANCO ${b.nombre}`}>
                        BANCO {b.nombre}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={lbl}>Banco de salida</label>
                  <select value={bancoId} onChange={(e) => setBancoId(e.target.value)} className={`${inp} font-bold`}>
                    <option value="">— Seleccione —</option>
                    {bancos.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.nombre} · {b.moneda_codigo ?? "USD"} · ${round2(Number(b.saldo_local ?? 0))}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={lbl}>Referencia</label>
                  <input value={referencia} onChange={(e) => setReferencia(e.target.value)} className={inp} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={lbl}>Nº de cuenta</label>
                    <input value={numeroCuenta} onChange={(e) => setNumeroCuenta(e.target.value)} className={`${inp} font-mono`} />
                  </div>
                  <div>
                    <label className={lbl}>Tipo de cuenta</label>
                    <select value={tipoCuenta} onChange={(e) => setTipoCuenta(e.target.value)} className={`${inp} font-bold`}>
                      {TIPOS_CUENTA.map((t) => (
                        <option key={t || "na"} value={t}>
                          {t || "— No aplica —"}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={lbl}>Cédula / RIF</label>
                    <input value={cedula} onChange={(e) => setCedula(e.target.value.toUpperCase())} className={`${inp} font-mono uppercase`} />
                  </div>
                  <div>
                    <label className={lbl}>Beneficiario</label>
                    <input value={beneficiario} onChange={(e) => setBeneficiario(e.target.value.toUpperCase())} className={`${inp} uppercase`} />
                  </div>
                </div>
              </>
            )}
            <div>
              <label className={lbl}>Nota</label>
              <input value={nota} onChange={(e) => setNota(e.target.value)} className={inp} />
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-600">
              {modo === "traslado" ? (
                <>
                  Se debitan <span className="font-black text-danger-700">${round2(montoNum).toFixed(2)}</span> al
                  origen y se acreditan al destino.
                </>
              ) : esVes(moneda) ? (
                <>
                  {montoNum.toFixed(2)} Bs ÷ {parseFloat(tasa) || 0} ={" "}
                  <span className="font-black text-danger-700">${montoUsd.toFixed(2)}</span>
                </>
              ) : (
                <>
                  Sale de la caja: <span className="font-black text-danger-700">${montoUsd.toFixed(2)}</span>
                </>
              )}
            </div>
            <Button variant="danger" size="sm" className="w-full" disabled={guardando} onClick={guardar}>
              <span >✅</span>{" "}
              {guardando ? "Guardando…" : modo === "traslado" ? "Registrar traslado" : "Registrar retiro"}
            </Button>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm lg:col-span-2">
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
            <span className="text-sm font-black uppercase text-slate-700">
              <span className="mr-1 text-primary-600">📕</span> Libro mayor
            </span>
            <div className="flex items-center gap-2">
              <input
                value={filtro}
                onChange={(e) => setFiltro(e.target.value.toUpperCase())}
                placeholder="Filtrar movimientos…"
                className={`${inp} w-48 py-1`}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  exportarTabla(
                    "contabilidad_caja",
                    [
                      "Fecha Asiento",
                      "Fecha Movimiento",
                      "Tipo",
                      "Origen",
                      "Destino",
                      "Modalidad",
                      "Referencia",
                      "Moneda",
                      "Monto",
                      "Monto USD",
                    ],
                    visiblesTransacciones.map((t) => [
                      t.fecha_asiento ? String(t.fecha_asiento).slice(0, 10) : (t.fecha ? String(t.fecha).slice(0, 10) : ""),
                      csvFecha(t.fecha_movimiento ?? t.fecha),
                      t.tipo_operacion ?? "TRANSFERENCIA",
                      t.cliente_origen_nombre ?? "",
                      t.cliente_destino_nombre ?? "",
                      t.modalidad ?? "",
                      t.referencia ?? "",
                      t.moneda ?? "USD",
                      round2(Number(t.monto ?? 0)).toFixed(2),
                      round2(Number(t.monto_usd ?? t.monto ?? 0)).toFixed(2),
                    ])
                  )
                }
              >
                <span>⬇️</span> CSV
              </Button>
            </div>
          </div>
          <div className="max-h-[32rem] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  <th className={th}>Fecha Asiento</th>
                  <th className={th}>Fecha Movimiento</th>
                  <th className={th}>Tipo</th>
                  <th className={th}>Origen</th>
                  <th className={th}>Destino</th>
                  <th className={th}>Modalidad</th>
                  <th className={th}>Ref.</th>
                  <th className={th + " text-right"}>Monto</th>
                </tr>
              </thead>
              <tbody>
                {visiblesTransacciones.map((t) => (
                  <tr key={t.id} className="border-t border-line">
                    <td className={td + " font-mono font-bold text-slate-700"}>
                      {t.fecha_asiento ? String(t.fecha_asiento).slice(0, 10) : (t.fecha ? String(t.fecha).slice(0, 10) : "—")}
                    </td>
                    <td className={td + " text-[11px] text-slate-500"}>
                      {fechaCorta(t.fecha_movimiento ?? t.fecha)}
                    </td>
                    <td className={td}>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[9px] font-black uppercase ${
                          t.tipo_operacion === "RETIRO" ? "bg-red-100 text-red-800" : "bg-blue-100 text-blue-800"
                        }`}
                      >
                        {t.tipo_operacion === "RETIRO" ? "Retiro" : "Traslado"}
                      </span>
                    </td>
                    <td className={td + " font-semibold text-slate-700"}>{t.cliente_origen_nombre ?? "—"}</td>
                    <td className={td + " text-slate-600"}>{t.cliente_destino_nombre ?? "—"}</td>
                    <td className={td + " text-slate-600"}>{t.modalidad || "—"}</td>
                    <td className={`${td} font-mono text-slate-500`}>{t.referencia || "—"}</td>
                    <td className={`${td} text-right font-mono font-black ${t.tipo_operacion === "RETIRO" ? "text-danger-600" : "text-slate-700"}`}>
                      {esVes(t.moneda)
                        ? `${Number(t.monto ?? 0).toFixed(2)} Bs`
                        : `$${round2(Number(t.monto_usd ?? t.monto ?? 0)).toFixed(2)}`}
                    </td>
                  </tr>
                ))}
                {visiblesTransacciones.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-slate-400">
                      {transacciones.length === 0
                        ? "Sin movimientos registrados."
                        : "Ningún movimiento coincide con el filtro."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
//  🏦  BANCOS REALES   (js/bancos.js)
// ===========================================================================

export function TabBancos({
  bancos,
  monedas,
  onHecho,
}: {
  bancos: BancoRow[];
  monedas: MonedaRow[];
  onHecho: () => Promise<void>;
}) {
  const confirmar = useConfirmar();
  const [filtro, setFiltro] = useState("");
  const [editando, setEditando] = useState<BancoRow | null>(null);
  const [nombre, setNombre] = useState("");
  const [moneda, setMoneda] = useState("USD");
  const [saldo, setSaldo] = useState("0");

  const abrirNuevo = () => {
    setEditando({ id: "", nombre: "", moneda_codigo: "USD", saldo_local: 0 });
    setNombre("");
    setMoneda("USD");
    setSaldo("0");
  };
  const abrir = (b: BancoRow) => {
    setEditando(b);
    setNombre(b.nombre);
    setMoneda(b.moneda_codigo ?? "USD");
    setSaldo(String(Number(b.saldo_local ?? 0)));
  };
  const cerrar = () => setEditando(null);

  const guardar = async () => {
    const valor = numDe(saldo);
    if (!nombre.trim()) return toast("El nombre del banco es obligatorio.", "warning");
    if (!Number.isFinite(valor)) return toast("El saldo es obligatorio.", "warning");
    const r = await guardarBanco({
      id: editando?.id || null,
      nombre,
      moneda_codigo: moneda,
      saldo_local: valor,
    });
    if (!r.ok) return toast(r.error ?? "Error al guardar.", "error");
    toast("Banco guardado.", "success");
    cerrar();
    await onHecho();
  };

  const borrar = async (b: BancoRow) => {
    const ok = await confirmar({
      titulo: "Eliminar cuenta",
      mensaje: `¿Eliminar la cuenta "${b.nombre}"?`,
      tipo: "error",
      textoConfirmar: "Eliminar",
      destructivo: true,
    });
    if (!ok) return;
    const r = await eliminarBanco(b.id);
    if (!r.ok) return toast(r.error ?? "Error al eliminar.", "error");
    toast("Banco eliminado.", "success");
    await onHecho();
  };

  const visibles = useMemo(() => {
    const f = filtro.trim().toUpperCase();
    return f
      ? bancos.filter((b) => `${b.nombre} ${b.moneda_codigo ?? ""}`.toUpperCase().includes(f))
      : bancos;
  }, [bancos, filtro]);

  // El legacy convertía con la tasa del catálogo; aquí se usa la del catálogo de
  // monedas para que el total en USD no salga NaN (bug de js/bancos.js:54).
  const tasaDe = (codigo: string | null) => {
    if (!esVes(codigo)) return 1;
    const m = monedas.find((x) => x.codigo === "VES") ?? monedas.find((x) => x.es_base);
    const t = Number(m?.tasa_cambio ?? 0);
    return t > 0 ? t : 1;
  };
  const granTotal = round2(
    bancos.reduce(
      (acc, b) => acc + saldoBancoUsd(Number(b.saldo_local ?? 0), b.moneda_codigo, tasaDe(b.moneda_codigo)),
      0
    )
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          value={filtro}
          onChange={(e) => setFiltro(e.target.value.toUpperCase())}
          placeholder="Filtrar cuentas…"
          className={`${inp} w-64`}
        />
        <div className="flex items-center gap-3">
          <span className="text-sm font-black text-slate-700">
            Total en USD: <span className="text-emerald-700">${granTotal.toFixed(2)}</span>
          </span>
          <Button variant="default" size="sm" onClick={abrirNuevo}>
            <span >➕</span> Nueva cuenta
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-line px-4 py-2">
          <span className="text-sm font-black uppercase text-slate-700">
            <span className="mr-1 text-primary-600">🏦</span> Cuentas bancarias
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              exportarTabla(
                "contabilidad_bancos",
                ["Cuenta", "Moneda", "Saldo local", "Equivalente USD"],
                visibles.map((b) => {
                  const local = Number(b.saldo_local ?? 0);
                  return [
                    b.nombre,
                    b.moneda_codigo ?? "USD",
                    round2(local).toFixed(2),
                    round2(saldoBancoUsd(local, b.moneda_codigo, tasaDe(b.moneda_codigo))).toFixed(2),
                  ];
                })
              )
            }
          >
            <span>⬇️</span> CSV
          </Button>
        </div>
        <table className="w-full text-xs">
          <thead className="bg-slate-50">
            <tr>
              <th className={th}>Cuenta</th>
              <th className={th}>Moneda</th>
              <th className={th + " text-right"}>Saldo local</th>
              <th className={th + " text-right"}>Equivalente USD</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {visibles.map((b) => {
              const local = Number(b.saldo_local ?? 0);
              const usd = saldoBancoUsd(local, b.moneda_codigo, tasaDe(b.moneda_codigo));
              return (
                <tr key={b.id} className="border-t border-line">
                  <td className={td + " font-black uppercase text-slate-800"}>{b.nombre}</td>
                  <td className={td + " text-slate-600"}>{b.moneda_codigo ?? "USD"}</td>
                  <td className={`${td} text-right font-mono font-black ${local < 0 ? "text-danger-600" : "text-slate-700"}`}>
                    {esVes(b.moneda_codigo) ? `Bs ${local.toFixed(2)}` : `$${local.toFixed(2)}`}
                  </td>
                  <td className={`${td} text-right font-mono font-black ${usd < 0 ? "text-danger-600" : "text-emerald-700"}`}>
                    ${usd.toFixed(2)}
                  </td>
                  <td className={td + " text-right whitespace-nowrap"}>
                    <Button variant="outline" size="sm" onClick={() => abrir(b)}>
                      <span >✏️</span>
                    </Button>{" "}
                    <Button variant="danger" size="sm" onClick={() => void borrar(b)}>
                      <span >🗑️</span>
                    </Button>
                  </td>
                </tr>
              );
            })}
            {visibles.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-slate-400">
                  Sin cuentas registradas.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editando && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.target === e.currentTarget && cerrar()}
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h3 className="mb-4 text-sm font-black uppercase text-slate-800">
              {editando.id ? "Editar cuenta" : "Nueva cuenta bancaria"}
            </h3>
            <div className="space-y-2">
              <div>
                <label className={lbl}>Nombre *</label>
                <input value={nombre} onChange={(e) => setNombre(e.target.value.toUpperCase())} className={`${inp} font-bold uppercase`} />
              </div>
              <div>
                <label className={lbl}>Moneda de la cuenta *</label>
                <select value={moneda} onChange={(e) => setMoneda(e.target.value)} className={`${inp} font-bold`}>
                  <option value="USD">USD</option>
                  <option value="VES">VES (Bolívares)</option>
                </select>
              </div>
              <div>
                <label className={lbl}>Saldo en {moneda === "VES" ? "Bs" : "USD"} *</label>
                <input value={saldo} onChange={(e) => setSaldo(e.target.value)} inputMode="decimal" className={`${inp} text-right font-mono font-black`} />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={cerrar}>
                Cancelar
              </Button>
              <Button variant="success" size="sm" onClick={guardar}>
                <span >✅</span> Guardar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ===========================================================================
//  💱  MONEDAS Y TASAS   (js/monedas.js)
// ===========================================================================

export function TabMonedas({
  monedas,
  historial,
  referencias,
  onHecho,
}: {
  monedas: MonedaRow[];
  historial: TasaCambioRow[];
  referencias: TasaReferenciaRow[];
  onHecho: () => Promise<void>;
}) {
  const confirmar = useConfirmar();
  const [monedaId, setMonedaId] = useState("");
  const [nuevaTasa, setNuevaTasa] = useState("");
  const [nuevaMoneda, setNuevaMoneda] = useState({ nombre: "", codigo: "", simbolo: "", tasa: "" });
  const [refTipo, setRefTipo] = useState<"BCV" | "BINANCE" | "EURO">("BCV");
  const [refTasa, setRefTasa] = useState("");
  const [refFecha, setRefFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [filtro, setFiltro] = useState("");

  /**
   * Filtro de texto para las dos tablas de tasas. El histórico se filtra por
   * la moneda y las referencias por su origen (BCV/BINANCE/EURO): es lo que
   * el operador busca cuando revisa "cuál era la tasa del dólar ese día".
   */
  const visiblesHistorial = useMemo(() => {
    const f = filtro.trim().toUpperCase();
    if (!f) return historial;
    return historial.filter((h) => `${h.monedas?.nombre ?? ""} ${h.monedas?.codigo ?? ""}`.toUpperCase().includes(f));
  }, [historial, filtro]);
  const visiblesReferencias = useMemo(() => {
    const f = filtro.trim().toUpperCase();
    if (!f) return referencias;
    return referencias.filter((r) => `${r.tipo} ${r.fecha_aplicar}`.toUpperCase().includes(f));
  }, [referencias, filtro]);

  const guardarTasa = async () => {
    if (!monedaId) return toast("Seleccione la moneda.", "warning");
    const t = numDe(nuevaTasa);
    if (!(t > 0)) return toast("La tasa debe ser un número mayor a cero.", "warning");
    const ok = await confirmar({
      titulo: "Registrar tasa",
      mensaje: `Registrar la tasa ${t}?\n\nLa vigente es la más reciente por fecha; la anterior se conserva como histórico.`,
      tipo: "info",
      textoConfirmar: "Registrar",
    });
    if (!ok) return;
    const r = await registrarTasaCambio(monedaId, t);
    if (!r.ok) return toast(r.error ?? "Error al registrar.", "error");
    toast("Tasa registrada.", "success");
    setNuevaTasa("");
    await onHecho();
  };

  const guardarMoneda = async () => {
    const r = await crearMoneda({
      nombre: nuevaMoneda.nombre,
      codigo: nuevaMoneda.codigo,
      simbolo: nuevaMoneda.simbolo,
      tasa: numDe(nuevaMoneda.tasa),
    });
    if (!r.ok) return toast(r.error ?? "Error al crear.", "error");
    toast("Moneda creada.", "success");
    setNuevaMoneda({ nombre: "", codigo: "", simbolo: "", tasa: "" });
    await onHecho();
  };

  const guardarReferencia = async () => {
    const t = numDe(refTasa);
    if (!refFecha) return toast("Indique la fecha de aplicación.", "warning");
    if (!(t > 0)) return toast("La tasa debe ser un número mayor a cero.", "warning");
    const r = await guardarTasaReferencia(refTipo, t, refFecha);
    if (!r.ok) return toast(r.error ?? "Error al registrar.", "error");
    toast("Tasa de referencia registrada.", "success");
    setRefTasa("");
    await onHecho();
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-line bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-black uppercase text-slate-700">
            <span className="mr-1 text-primary-600">🔄</span> Tasa de cambio
          </h2>
          <div className="space-y-2">
            <div>
              <label className={lbl}>Moneda</label>
              <select value={monedaId} onChange={(e) => setMonedaId(e.target.value)} className={`${inp} font-bold`}>
                <option value="">— Seleccione —</option>
                {monedas.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nombre} ({m.codigo}){m.es_base ? " · base" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={lbl}>Nueva tasa</label>
              <input value={nuevaTasa} onChange={(e) => setNuevaTasa(e.target.value)} inputMode="decimal" className={`${inp} text-right font-mono font-black`} />
            </div>
            <Button variant="success" size="sm" className="w-full" onClick={guardarTasa}>
              <span >✅</span> Registrar tasa
            </Button>
            <p className="text-[10px] leading-relaxed text-slate-400">
              El historial es <b>append-only</b>: cada cambio guarda una fila nueva y la vigente es la más
              reciente por fecha. Nunca se reescribe una tasa anterior.
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-black uppercase text-slate-700">
            <span className="mr-1 text-primary-600">➕</span> Nueva moneda
          </h2>
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={lbl}>Nombre *</label>
                <input value={nuevaMoneda.nombre} onChange={(e) => setNuevaMoneda({ ...nuevaMoneda, nombre: e.target.value })} className={inp} />
              </div>
              <div>
                <label className={lbl}>Código *</label>
                <input value={nuevaMoneda.codigo} onChange={(e) => setNuevaMoneda({ ...nuevaMoneda, codigo: e.target.value.toUpperCase() })} className={`${inp} font-mono uppercase`} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={lbl}>Símbolo *</label>
                <input value={nuevaMoneda.simbolo} onChange={(e) => setNuevaMoneda({ ...nuevaMoneda, simbolo: e.target.value })} className={inp} />
              </div>
              <div>
                <label className={lbl}>Tasa inicial *</label>
                <input value={nuevaMoneda.tasa} onChange={(e) => setNuevaMoneda({ ...nuevaMoneda, tasa: e.target.value })} inputMode="decimal" className={`${inp} text-right font-mono font-black`} />
              </div>
            </div>
            <Button variant="default" size="sm" className="w-full" onClick={guardarMoneda}>
              <span >✅</span> Crear moneda
            </Button>
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-black uppercase text-slate-700">
            <span className="mr-1 text-primary-600">📈</span> Tasa de referencia
          </h2>
          <div className="space-y-2">
            <div>
              <label className={lbl}>Origen</label>
              <select value={refTipo} onChange={(e) => setRefTipo(e.target.value as "BCV" | "BINANCE" | "EURO")} className={`${inp} font-bold`}>
                <option value="BCV">BCV</option>
                <option value="BINANCE">BINANCE</option>
                <option value="EURO">EURO</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={lbl}>Tasa *</label>
                <input value={refTasa} onChange={(e) => setRefTasa(e.target.value)} inputMode="decimal" className={`${inp} text-right font-mono font-black`} />
              </div>
              <div>
                <label className={lbl}>A partir de *</label>
                <DateInput value={refFecha} onFechaChange={(val) => setRefFecha(val || new Date().toISOString().slice(0, 10))} className={inp} />
              </div>
            </div>
            <Button variant="default" size="sm" className="w-full" onClick={guardarReferencia}>
              <span >✅</span> Registrar referencia
            </Button>
            <p className="text-[10px] leading-relaxed text-slate-400">
              La tasa vigente es la última cuyo campo <b>«A partir de»</b> ya haya llegado, así que se puede
              cargar la tasa del día antes de que rija.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
            <span className="text-sm font-black uppercase text-slate-700">
              <span className="mr-1 text-primary-600">🕙</span> Histórico de tasas
            </span>
            <div className="flex items-center gap-2">
              <input
                value={filtro}
                onChange={(e) => setFiltro(e.target.value.toUpperCase())}
                placeholder="Filtrar por moneda u origen…"
                className={`${inp} w-48 py-1`}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  exportarTabla(
                    "contabilidad_tasas",
                    ["Fecha", "Moneda", "Tasa"],
                    visiblesHistorial.map((h) => [
                      csvFecha(h.fecha_registro),
                      h.monedas?.nombre ?? "",
                      round2(Number(h.tasa)).toFixed(2),
                    ])
                  )
                }
              >
                <span>⬇️</span> CSV
              </Button>
            </div>
          </div>
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  <th className={th}>Fecha</th>
                  <th className={th}>Moneda</th>
                  <th className={th + " text-right"}>Tasa</th>
                </tr>
              </thead>
              <tbody>
                {visiblesHistorial.map((h) => (
                  <tr key={h.id} className="border-t border-line">
                    <td className={td + " text-slate-500"}>{fechaCorta(h.fecha_registro)}</td>
                    <td className={td + " font-semibold text-slate-700"}>{h.monedas?.nombre ?? "—"}</td>
                    <td className={`${td} text-right font-mono font-black`}>{Number(h.tasa).toFixed(2)}</td>
                  </tr>
                ))}
                {visiblesHistorial.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-3 py-8 text-center text-slate-400">
                      {historial.length === 0 ? "Sin tasas registradas." : "Ninguna tasa coincide con el filtro."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-line px-4 py-2">
            <span className="text-sm font-black uppercase text-slate-700">
              <span className="mr-1 text-primary-600">📡</span> Tasas de referencia
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                exportarTabla(
                  "contabilidad_tasas_referencia",
                  ["A partir de", "Origen", "Tasa"],
                  visiblesReferencias.map((r) => [
                    r.fecha_aplicar,
                    r.tipo,
                    round2(Number(r.tasa)).toFixed(2),
                  ])
                )
              }
            >
              <span>⬇️</span> CSV
            </Button>
          </div>
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  <th className={th}>A partir de</th>
                  <th className={th}>Origen</th>
                  <th className={th + " text-right"}>Tasa</th>
                </tr>
              </thead>
              <tbody>
                {visiblesReferencias.map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className={td + " text-slate-500"}>{r.fecha_aplicar}</td>
                    <td className={td + " font-semibold text-slate-700"}>{r.tipo}</td>
                    <td className={`${td} text-right font-mono font-black`}>{Number(r.tasa).toFixed(2)}</td>
                  </tr>
                ))}
                {visiblesReferencias.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-3 py-8 text-center text-slate-400">
                      {referencias.length === 0
                        ? "Sin tasas de referencia."
                        : "Ninguna tasa coincide con el filtro."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
//  📘  BALANCE DE COMPROBACIÓN NIIF
//
//  Tres cosas que el resto del módulo no tiene:
//
//   · PARTIDA DOBLE: cada asiento tiene un debe y un haber que TIENEN que
//     sumar lo mismo. El formulario muestra la diferencia EN VIVO y la
//     validación de la base la vuelve a exigir en el servidor.
//   · MULTIMONEDA (NIC 21): se declara la moneda en la que ocurrió el hecho
//     económico (operación) y la en la que se presenta el balance, con la tasa
//     HISTÓRICA del día. El importe original se conserva junto al convertido.
//   · PRECISIÓN: los importes se suman en CENTAVOS ENTEROS, así que el
//     total de la tabla es exactamente la suma de sus filas.
// ===========================================================================

/** Línea del asiento que se está armando en pantalla (todo en texto). */
type LineaBorrador = {
  cuenta: string;
  nombre_cuenta: string;
  debe: string;
  haber: string;
};

const lineaVacia = (): LineaBorrador => ({
  cuenta: "",
  nombre_cuenta: "",
  debe: "",
  haber: "",
});

/**
 * Clave de idempotencia sugerida.
 *
 * POR QUÉ LA LLEVA EL USUARIO Y NO EL SISTEMA: la clave es la que garantiza
 * que un reintento (o un doble clic) NO registre dos veces el mismo hecho.
 * Si la generara el servidor en cada llamada, la protección no serviría de
 * nada; tiene que poder reproducirse la misma clave.
 */
function claveSugerida(): string {
  const d = new Date();
  const sello = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const azar = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `NIIF-${sello}-${azar}`;
}

export function TabBalanceNIIF({
  balance,
  asientos,
  monedas,
  tasaVes,
  onRango,
  onHecho,
}: {
  balance: FilaBalanceNIIF[];
  asientos: AsientoNIIFResumen[];
  monedas: MonedaRow[];
  tasaVes: number;
  /** Recarga el balance para un rango de fechas (el acumulado no se puede recortar). */
  onRango: (rango: { desde?: string; hasta?: string }) => Promise<void>;
  onHecho: () => Promise<void>;
}) {
  const confirmar = useConfirmar();

  // ── Filtros del balance ────────────────────────────────────────────────
  const [texto, setTexto] = useState("");
  const [moneda, setMoneda] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");

  // ── Borrador del asiento ───────────────────────────────────────────────
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [concepto, setConcepto] = useState("");
  const [clave, setClave] = useState(claveSugerida);
  const [monedaOperacion, setMonedaOperacion] = useState("USD");
  const [monedaPresentacion, setMonedaPresentacion] = useState("USD");
  const [tasa, setTasa] = useState("1");
  const [lineas, setLineas] = useState<LineaBorrador[]>([lineaVacia(), lineaVacia()]);
  const [guardando, setGuardando] = useState(false);

  // Cuando la operación es en bolívares, la tasa por defecto es la del día
  // (la misma que usa el resto del módulo). El operador puede cambiarla: la
  // que se registra es la HISTÓRICA de ese hecho económico (NIC 21.39).
  useEffect(() => {
    setTasa(String(esVes(monedaOperacion) ? tasaVes : 1));
  }, [monedaOperacion, tasaVes]);

  /** Monedas que se ofrecen en los filtros: las del catálogo + las del módulo. */
  const codigosMoneda = useMemo(() => {
    const set = new Set<string>(["USD", "VES"]);
    monedas.forEach((m) => {
      if (m.codigo) set.add(m.codigo.toUpperCase());
    });
    return Array.from(set);
  }, [monedas]);

  /** Filas que se ven: el filtro de texto y de moneda es local e instantáneo. */
  const visibles = useMemo(
    () => filtrarBalanceNIIF(balance, { texto, moneda }),
    [balance, texto, moneda]
  );

  /** Totales del balance, en CENTAVOS ENTEROS (el total es la suma exacta). */
  const totales = useMemo(() => {
    let debe = 0;
    let haber = 0;
    visibles.forEach((f) => {
      debe += Math.round(f.total_debe * 100);
      haber += Math.round(f.total_haber * 100);
    });
    return { debe: debe / 100, haber: haber / 100, diferencia: (debe - haber) / 100 };
  }, [visibles]);

  /** Totales del borrador, con la misma aritmética de centavos. */
  const totalesBorrador = useMemo(() => {
    let debe = 0;
    let haber = 0;
    lineas.forEach((l) => {
      debe += Math.round(monedaExacta(l.debe) * 100);
      haber += Math.round(monedaExacta(l.haber) * 100);
    });
    return { debe: debe / 100, haber: haber / 100, diferencia: (debe - haber) / 100 };
  }, [lineas]);

  const editarLinea = (i: number, campo: keyof LineaBorrador, valor: string) =>
    setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, [campo]: valor } : l)));
  const agregarLinea = () => setLineas((ls) => [...ls, lineaVacia()]);
  const quitarLinea = (i: number) =>
    setLineas((ls) => (ls.length <= 2 ? ls : ls.filter((_, j) => j !== i)));

  const aplicarRango = async () => {
    await onRango({ desde: desde || undefined, hasta: hasta || undefined });
  };

  const limpiarRango = async () => {
    setDesde("");
    setHasta("");
    await onRango({});
  };

  const registrar = async () => {
    setGuardando(true);
    try {
      const r = await registrarAsientoPartidaDobleNIIF({
        clave: clave.trim(),
        fecha,
        concepto: concepto.trim(),
        moneda_operacion: monedaOperacion,
        moneda_presentacion: monedaPresentacion,
        tasa_cambio: numDe(tasa),
        lineas: lineas.map((l) => ({
          cuenta: l.cuenta.trim(),
          nombre_cuenta: l.nombre_cuenta.trim(),
          debe: numDe(l.debe),
          haber: numDe(l.haber),
        })),
      });
      if (!r.ok) {
        toast(r.error ?? "Error al registrar el asiento.", "error");
        return;
      }
      toast(
        r.ya_existia
          ? `El asiento ${r.clave} ya estaba registrado: no se duplicó.`
          : `Asiento ${r.clave} registrado: debe ${(r.total_debe ?? 0).toFixed(2)} = haber ${(
              r.total_haber ?? 0
            ).toFixed(2)}.`,
        "success"
      );
      setClave(claveSugerida());
      setConcepto("");
      setLineas([lineaVacia(), lineaVacia()]);
      await onHecho();
    } catch (e) {
      // La validación del cuadre LANZA: el problema es del dato armado, no del
      // servidor, y el mensaje dice exactamente qué línea hay que corregir.
      toast((e as Error).message, "error");
    } finally {
      setGuardando(false);
    }
  };

  const revertir = async (a: AsientoNIIFResumen) => {
    const ok = await confirmar({
      titulo: "Registrar contra-asiento",
      mensaje:
        `Se registrará el CONTRA-ASIENTO de "${a.clave}" (${a.concepto ?? "sin concepto"}).\n\n` +
        "El asiento original NO se borra: queda en el libro al lado del reverso. " +
        "Un asiento ya registrado es inmutable; la forma correcta de corregirlo es el reverso.",
      tipo: "warning",
      textoConfirmar: "Registrar reverso",
    });
    if (!ok) return;
    const r = await registrarContraAsientoNIIF(a.clave);
    if (!r.ok) return toast(r.error ?? "Error al registrar el reverso.", "error");
    toast(
      r.ya_existia ? "El contra-asiento ya estaba registrado." : "Contra-asiento registrado.",
      "success"
    );
    await onHecho();
  };

  const exportarBalance = () =>
    exportarTabla(
      "contabilidad_balance_niif",
      ["Cuenta", "Nombre", "Moneda", "Debe", "Haber", "Saldo"],
      [
        ...visibles.map((f) => [
          f.cuenta,
          f.nombre_cuenta,
          f.moneda_presentacion,
          f.total_debe.toFixed(2),
          f.total_haber.toFixed(2),
          f.saldo.toFixed(2),
        ]),
        [
          "TOTALES",
          "",
          "",
          totales.debe.toFixed(2),
          totales.haber.toFixed(2),
          totales.diferencia.toFixed(2),
        ],
      ]
    );

  return (
    <div className="space-y-4">
      {/* ── Indicadores: el libro tiene que cuadrar ─────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-line bg-white p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Total debe</p>
          <p className="text-2xl font-black text-slate-700">{totales.debe.toFixed(2)}</p>
          <p className="text-[10px] text-slate-400">Suma del debe de las cuentas</p>
        </div>
        <div className="rounded-2xl border border-line bg-white p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Total haber</p>
          <p className="text-2xl font-black text-slate-700">{totales.haber.toFixed(2)}</p>
          <p className="text-[10px] text-slate-400">Suma del haber de las cuentas</p>
        </div>
        <div className="rounded-2xl border border-line bg-white p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Diferencia</p>
          <p
            className={`text-2xl font-black ${
              totales.diferencia === 0 ? "text-emerald-700" : "text-danger-600"
            }`}
          >
            {totales.diferencia.toFixed(2)}
          </p>
          <p className="text-[10px] text-slate-400">
            {totales.diferencia === 0
              ? "✅ El libro cuadra: debe = haber"
              : "🚫 El libro NO cuadra: revisá las líneas del período"}
          </p>
        </div>
      </div>

      {/* ── Filtros ──────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-line bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[12rem] flex-1">
            <label className={lbl}>Filtrar cuenta</label>
            <input
              value={texto}
              onChange={(e) => setTexto(e.target.value.toUpperCase())}
              placeholder="Código o nombre de la cuenta…"
              className={inp}
            />
          </div>
          <div>
            <label className={lbl}>Moneda</label>
            <select value={moneda} onChange={(e) => setMoneda(e.target.value)} className={`${inp} font-bold`}>
              <option value="">Todas</option>
              {codigosMoneda.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={lbl}>Desde</label>
            <DateInput value={desde} onFechaChange={(val) => setDesde(val)} className={inp} />
          </div>
          <div>
            <label className={lbl}>Hasta</label>
            <DateInput value={hasta} onFechaChange={(val) => setHasta(val)} className={inp} />
          </div>
          <Button variant="default" size="sm" onClick={() => void aplicarRango()}>
            <span>🔎</span> Aplicar rango
          </Button>
          {(desde || hasta) && (
            <Button variant="outline" size="sm" onClick={() => void limpiarRango()}>
              <span>✖</span> Todo el histórico
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={exportarBalance}>
            <span>⬇️</span> CSV
          </Button>
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
          El balance acumulado no se puede recortar por fecha (mezclaría saldos de antes y después del
          corte), así que el rango se recalcula sobre el DETALLE del período. Sin rango, el saldo es el
          acumulado de todo el libro.
        </p>
      </div>

      {/* ── Balance de comprobación ─────────────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
        <div className="border-b border-line px-4 py-2 text-sm font-black uppercase text-slate-700">
          <span className="mr-1 text-primary-600">⚖️</span> Balance de comprobación
        </div>
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50">
              <tr>
                <th className={th}>Cuenta</th>
                <th className={th}>Nombre</th>
                <th className={th}>Moneda</th>
                <th className={th + " text-right"}>Debe</th>
                <th className={th + " text-right"}>Haber</th>
                <th className={th + " text-right"}>Saldo</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((f) => (
                <tr key={`${f.cuenta}-${f.moneda_presentacion}`} className="border-t border-line">
                  <td className={td + " font-mono font-bold text-slate-700"}>{f.cuenta}</td>
                  <td className={td + " text-slate-600"}>{f.nombre_cuenta}</td>
                  <td className={td + " text-slate-500"}>{f.moneda_presentacion}</td>
                  <td className={td + " text-right font-mono"}>{f.total_debe.toFixed(2)}</td>
                  <td className={td + " text-right font-mono"}>{f.total_haber.toFixed(2)}</td>
                  <td
                    className={`${td} text-right font-mono font-black ${
                      f.saldo < 0 ? "text-danger-600" : "text-emerald-700"
                    }`}
                  >
                    {f.saldo.toFixed(2)}
                  </td>
                </tr>
              ))}
              {visibles.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-slate-400">
                    Sin asientos en el período (o sin permiso para verlos).
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-line bg-slate-50">
                <td className={td + " font-black uppercase text-slate-700"} colSpan={3}>
                  Totales
                </td>
                <td className={td + " text-right font-mono font-black text-slate-700"}>
                  {totales.debe.toFixed(2)}
                </td>
                <td className={td + " text-right font-mono font-black text-slate-700"}>
                  {totales.haber.toFixed(2)}
                </td>
                <td
                  className={`${td} text-right font-mono font-black ${
                    totales.diferencia === 0 ? "text-emerald-700" : "text-danger-600"
                  }`}
                >
                  {totales.diferencia.toFixed(2)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* ── Asiento en partida doble + libro de asientos ─────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-line bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-black uppercase text-slate-700">
            <span className="mr-1 text-primary-600">📘</span> Registrar asiento (partida doble)
          </h2>
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={lbl}>Fecha del Asiento (Operación Contable) *</label>
                <DateInput value={fecha} onFechaChange={(val) => setFecha(val)} className={inp} />
                <p className="mt-0.5 text-[9px] text-slate-500">* Fecha contable manual del asiento.</p>
              </div>
              <div>
                <label className={lbl}>Clave de idempotencia *</label>
                <input value={clave} onChange={(e) => setClave(e.target.value)} className={`${inp} font-mono`} />
              </div>
            </div>
            <div>
              <label className={lbl}>Concepto *</label>
              <input value={concepto} onChange={(e) => setConcepto(e.target.value)} className={inp} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className={lbl}>Moneda de operación *</label>
                <select
                  value={monedaOperacion}
                  onChange={(e) => setMonedaOperacion(e.target.value)}
                  className={`${inp} font-bold`}
                >
                  <option value="USD">USD</option>
                  <option value="VES">VES (Bs)</option>
                </select>
              </div>
              <div>
                <label className={lbl}>Moneda de presentación *</label>
                <select
                  value={monedaPresentacion}
                  onChange={(e) => setMonedaPresentacion(e.target.value)}
                  className={`${inp} font-bold`}
                >
                  <option value="USD">USD</option>
                  <option value="VES">VES (Bs)</option>
                </select>
              </div>
              <div>
                <label className={lbl}>Tasa histórica *</label>
                <input
                  value={tasa}
                  onChange={(e) => setTasa(e.target.value)}
                  inputMode="decimal"
                  className={`${inp} text-right font-mono font-bold`}
                />
              </div>
            </div>
            <p className="text-[10px] leading-relaxed text-slate-400">
              NIC 21: la tasa es la del DÍA del hecho económico, no la de hoy. Con la operación en Bs y la
              presentación en USD, la tasa es Bs por 1 USD. El importe original se conserva junto al
              convertido.
            </p>

            <div className="overflow-hidden rounded-lg border border-line">
              <table className="w-full text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <th className={th}>Cuenta</th>
                    <th className={th}>Nombre</th>
                    <th className={th + " text-right"}>Debe</th>
                    <th className={th + " text-right"}>Haber</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {lineas.map((l, i) => (
                    <tr key={i} className="border-t border-line">
                      <td className={td}>
                        <input
                          value={l.cuenta}
                          onChange={(e) => editarLinea(i, "cuenta", e.target.value)}
                          placeholder="1.1.01"
                          className={`${inp} px-2 py-1 font-mono`}
                        />
                      </td>
                      <td className={td}>
                        <input
                          value={l.nombre_cuenta}
                          onChange={(e) => editarLinea(i, "nombre_cuenta", e.target.value)}
                          placeholder="Caja"
                          className={`${inp} px-2 py-1`}
                        />
                      </td>
                      <td className={td}>
                        <input
                          value={l.debe}
                          onChange={(e) => editarLinea(i, "debe", e.target.value)}
                          inputMode="decimal"
                          className={`${inp} px-2 py-1 text-right font-mono`}
                        />
                      </td>
                      <td className={td}>
                        <input
                          value={l.haber}
                          onChange={(e) => editarLinea(i, "haber", e.target.value)}
                          inputMode="decimal"
                          className={`${inp} px-2 py-1 text-right font-mono`}
                        />
                      </td>
                      <td className={td + " text-right"}>
                        <button
                          type="button"
                          onClick={() => quitarLinea(i)}
                          title="Quitar línea"
                          className="text-slate-400 hover:text-danger-600"
                        >
                          ✖
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div
              className={`rounded-lg px-3 py-2 text-[11px] font-bold ${
                totalesBorrador.diferencia === 0
                  ? "bg-emerald-50 text-emerald-800"
                  : "bg-amber-50 text-amber-800"
              }`}
            >
              Debe {totalesBorrador.debe.toFixed(2)} · Haber {totalesBorrador.haber.toFixed(2)} ·{" "}
              {totalesBorrador.diferencia === 0
                ? "✅ cuadra"
                : `diferencia ${totalesBorrador.diferencia.toFixed(2)}`}
            </div>

            <div className="flex gap-2">
              <Button
                variant="success"
                size="sm"
                className="flex-1"
                disabled={guardando}
                onClick={() => void registrar()}
              >
                <span>✅</span> {guardando ? "Registrando…" : "Registrar asiento"}
              </Button>
              <Button variant="outline" size="sm" onClick={agregarLinea}>
                <span>➕</span> Línea
              </Button>
            </div>
            <p className="text-[10px] leading-relaxed text-slate-400">
              Un asiento descuadrado NO se registra: la validación corre en el navegador (para avisarte al
              instante) y otra vez en el servidor (que es la garantía real). Repetir el registro con la misma
              clave no duplica nada.
            </p>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-line px-4 py-2">
            <span className="text-sm font-black uppercase text-slate-700">
              <span className="mr-1 text-primary-600">🧾</span> Asientos registrados
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                exportarTabla(
                  "contabilidad_asientos_niif",
                  ["Fecha", "Clave", "Concepto", "Moneda operación", "Moneda presentación", "Tasa", "Debe", "Haber", "Reverso"],
                  asientos.map((a) => [
                    a.fecha ?? "",
                    a.clave,
                    a.concepto ?? "",
                    a.moneda_operacion ?? "",
                    a.moneda_presentacion ?? "",
                    round2(Number(a.tasa_cambio ?? 0)).toFixed(2),
                    round2(Number(a.total_debe ?? 0)).toFixed(2),
                    round2(Number(a.total_haber ?? 0)).toFixed(2),
                    a.es_contra_asiento ? "Si" : "No",
                  ])
                )
              }
            >
              <span>⬇️</span> CSV
            </Button>
          </div>
          <div className="max-h-[32rem] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  <th className={th}>Fecha Asiento</th>
                  <th className={th}>Clave</th>
                  <th className={th}>Concepto</th>
                  <th className={th + " text-right"}>Debe</th>
                  <th className={th + " text-right"}>Haber</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {asientos.map((a) => (
                  <tr key={a.id} className="border-t border-line">
                    <td className={td + " text-slate-500"}>{a.fecha ?? "—"}</td>
                    <td className={td + " font-mono text-slate-600"}>{a.clave}</td>
                    <td className={td + " font-semibold text-slate-700"}>
                      {a.concepto ?? "—"}
                      {a.es_contra_asiento && (
                        <span className="ml-1 rounded bg-purple-100 px-1.5 py-0.5 text-[9px] font-black uppercase text-purple-800">
                          Reverso
                        </span>
                      )}
                    </td>
                    <td className={td + " text-right font-mono"}>{round2(Number(a.total_debe ?? 0)).toFixed(2)}</td>
                    <td className={td + " text-right font-mono"}>{round2(Number(a.total_haber ?? 0)).toFixed(2)}</td>
                    <td className={td + " text-right whitespace-nowrap"}>
                      {!a.es_contra_asiento && (
                        <Button variant="outline" size="sm" onClick={() => void revertir(a)}>
                          <span>↩️</span> Reversar
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {asientos.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-slate-400">
                      Todavía no hay asientos NIIF registrados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
//  📘  PESTAÑA 1: PLAN ÚNICO DE CUENTAS (PUC-NIIF HÍPICO)
// ===========================================================================

export function TabPlanCuentasPUC() {
  const [cuentas, setCuentas] = useState<CuentaContableDef[]>([...PLAN_CUENTAS_HIPICO]);
  const [filtroTexto, setFiltroTexto] = useState("");
  const [filtroClase, setFiltroClase] = useState<string>("TODAS");
  const [filtroModulo, setFiltroModulo] = useState<string>("TODOS");
  const [modalNuevaCuenta, setModalNuevaCuenta] = useState(false);

  // Formulario nueva subcuenta
  const [nuevoCodigo, setNuevoCodigo] = useState("");
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [nuevaClase, setNuevaClase] = useState<ClaseCuenta>("ACTIVO");
  const [nuevaNaturaleza, setNuevaNaturaleza] = useState<"DEUDORA" | "ACREEDORA">("DEUDORA");
  const [nuevoPadre, setNuevoPadre] = useState("1.1.02");
  const [nuevoModulo, setNuevoModulo] = useState<ModuloOrigenCuenta>("TESORERIA");
  const [guardando, setGuardando] = useState(false);

  // Saldos en vivo
  const saldos = useMemo(() => {
    return calcularSaldosPlanCuentas();
  }, []);

  const cuentasFiltradas = useMemo(() => {
    const txt = filtroTexto.trim().toUpperCase();
    return cuentas.filter((c) => {
      const coincideTxt =
        !txt ||
        c.codigo.toUpperCase().includes(txt) ||
        c.nombre.toUpperCase().includes(txt);
      const coincideClase = filtroClase === "TODAS" || c.clase === filtroClase;
      const coincideModulo = filtroModulo === "TODOS" || c.modulo_origen === filtroModulo;
      return coincideTxt && coincideClase && coincideModulo;
    });
  }, [cuentas, filtroTexto, filtroClase, filtroModulo]);

  const guardarSubcuenta = async () => {
    if (!nuevoCodigo.trim()) return toast("Indique el código de la cuenta (ej. 1.1.02.004).", "warning");
    if (!nuevoNombre.trim()) return toast("Indique el nombre de la subcuenta.", "warning");

    const existente = cuentas.find((c) => c.codigo === nuevoCodigo.trim());
    if (existente) return toast("Ese código de cuenta ya existe en el PUC.", "warning");

    setGuardando(true);
    const nuevaDef: CuentaContableDef = {
      codigo: nuevoCodigo.trim(),
      nombre: nuevoNombre.trim().toUpperCase(),
      clase: nuevaClase,
      naturaleza: nuevaNaturaleza,
      nivel: 4,
      codigo_padre: nuevoPadre || null,
      acepta_movimientos: true,
      modulo_origen: nuevoModulo,
      activa: true,
    };

    if (supabase) {
      try {
        await supabase.from("plan_cuentas_contables").insert({
          codigo: nuevaDef.codigo,
          nombre: nuevaDef.nombre,
          clase: nuevaDef.clase,
          naturaleza: nuevaDef.naturaleza,
          nivel: nuevaDef.nivel,
          codigo_padre: nuevaDef.codigo_padre,
          acepta_movimientos: true,
          modulo_origen: nuevaDef.modulo_origen,
          activa: true,
        });
      } catch {
        /* fallback en memoria */
      }
    }

    setCuentas((prev) => [...prev, nuevaDef]);
    setGuardando(false);
    setModalNuevaCuenta(false);
    toast(`Subcuenta ${nuevaDef.codigo} - ${nuevaDef.nombre} creada con éxito.`, "success");
    setNuevoCodigo("");
    setNuevoNombre("");
  };

  const CLASE_BADGE: Record<string, string> = {
    ACTIVO: "bg-blue-100 text-blue-800 border-blue-200",
    PASIVO: "bg-amber-100 text-amber-800 border-amber-200",
    PATRIMONIO: "bg-purple-100 text-purple-800 border-purple-200",
    INGRESO: "bg-emerald-100 text-emerald-800 border-emerald-200",
    COSTO_CONTRA_INGRESO: "bg-rose-100 text-rose-800 border-rose-200",
    GASTO: "bg-red-100 text-red-800 border-red-200",
    ORDEN: "bg-slate-100 text-slate-800 border-slate-300",
  };

  return (
    <div className="space-y-4">
      {/* Barra superior de herramientas y filtros */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white p-4 shadow-sm">
        <div>
          <h2 className="text-sm font-black uppercase text-slate-800">
            <span className="mr-1.5 text-primary-600">📘</span> Plan Único de Cuentas (PUC-NIIF Hípico)
          </h2>
          <p className="text-xs text-slate-500">
            Catálogo jerárquico oficial de cuentas contables. Cifras puras sin símbolos de moneda.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            value={filtroTexto}
            onChange={(e) => setFiltroTexto(e.target.value)}
            placeholder="Buscar por código o nombre…"
            className={`${inp} w-52 py-1.5 font-bold`}
          />

          <select
            value={filtroClase}
            onChange={(e) => setFiltroClase(e.target.value)}
            className={`${inp} w-40 py-1.5 font-bold`}
          >
            <option value="TODAS">Todas las clases</option>
            <option value="ACTIVO">1 · Activos</option>
            <option value="PASIVO">2 · Pasivos</option>
            <option value="PATRIMONIO">3 · Patrimonio</option>
            <option value="INGRESO">4 · Ingresos</option>
            <option value="COSTO_CONTRA_INGRESO">5 · Cruces / Costos</option>
            <option value="GASTO">6 · Gastos</option>
            <option value="ORDEN">7 · Cuentas de Orden</option>
          </select>

          <Button
            variant="default"
            size="sm"
            onClick={() => setModalNuevaCuenta(true)}
          >
            <span>➕</span> Nueva Subcuenta
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              exportarTabla(
                "puc_cuentas_contables",
                ["Codigo", "Nombre", "Clase", "Naturaleza", "Nivel", "Modulo", "Saldo"],
                cuentasFiltradas.map((c) => {
                  const s = saldos.get(c.codigo)?.saldo ?? 0;
                  return [c.codigo, c.nombre, c.clase, c.naturaleza, c.nivel, c.modulo_origen ?? "", formatearMontoSinMoneda(s)];
                })
              )
            }
          >
            <span>⬇️</span> CSV
          </Button>
        </div>
      </div>

      {/* Tabla del Plan de Cuentas */}
      <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
        <div className="max-h-[38rem] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 border-b border-line shadow-xs z-10">
              <tr>
                <th className={th}>Código</th>
                <th className={th}>Nombre de la Cuenta</th>
                <th className={th}>Clase</th>
                <th className={th}>Naturaleza</th>
                <th className={th}>Nivel</th>
                <th className={th}>Módulo</th>
                <th className={th + " text-right"}>Saldo Acumulado</th>
              </tr>
            </thead>
            <tbody>
              {cuentasFiltradas.map((c) => {
                const s = saldos.get(c.codigo)?.saldo ?? 0;
                const esMayor = c.nivel <= 2;
                return (
                  <tr
                    key={c.codigo}
                    className={`border-t border-line/70 transition-colors hover:bg-slate-50/70 ${
                      esMayor ? "bg-slate-50/40 font-bold" : ""
                    }`}
                  >
                    <td className={`${td} font-mono font-bold text-slate-800`}>
                      {c.codigo}
                    </td>
                    <td className={td}>
                      <span
                        style={{ paddingLeft: `${Math.max(0, (c.nivel - 1) * 16)}px` }}
                        className={`inline-block ${
                          esMayor ? "text-slate-900 font-black text-xs" : "text-slate-700 font-semibold"
                        }`}
                      >
                        {c.nivel === 1 ? "📁 " : c.nivel === 2 ? "📂 " : c.nivel === 3 ? "📋 " : "🔹 "}
                        {c.nombre}
                      </span>
                    </td>
                    <td className={td}>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[9px] font-black uppercase ${
                          CLASE_BADGE[c.clase] || "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {c.clase.replace("_", " ")}
                      </span>
                    </td>
                    <td className={td}>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
                          c.naturaleza === "DEUDORA"
                            ? "bg-blue-50 text-blue-700 border border-blue-200"
                            : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        }`}
                      >
                        {c.naturaleza}
                      </span>
                    </td>
                    <td className={`${td} text-slate-500 font-mono text-center`}>
                      N{c.nivel}
                    </td>
                    <td className={`${td} text-slate-500 text-[10px]`}>
                      {c.modulo_origen || "—"}
                    </td>
                    <td
                      className={`${td} text-right font-mono font-black ${
                        s < 0 ? "text-danger-600" : s > 0 ? "text-emerald-700" : "text-slate-400"
                      }`}
                    >
                      {formatearMontoSinMoneda(s)}
                    </td>
                  </tr>
                );
              })}
              {cuentasFiltradas.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                    No hay cuentas contables que coincidan con los filtros aplicados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal para crear subcuenta auxiliar */}
      {modalNuevaCuenta && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-line bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-line bg-slate-900 px-4 py-3 text-white">
              <h3 className="text-xs font-black uppercase tracking-wider">
                ➕ Crear Subcuenta Auxiliar Imputable (Nivel 4)
              </h3>
              <button
                type="button"
                onClick={() => setModalNuevaCuenta(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 p-4">
              <div>
                <label className={lbl}>Código Imputable (ej. 1.1.02.004) *</label>
                <input
                  value={nuevoCodigo}
                  onChange={(e) => setNuevoCodigo(e.target.value)}
                  placeholder="1.1.02.004"
                  className={`${inp} font-mono font-bold`}
                />
              </div>

              <div>
                <label className={lbl}>Nombre de la Subcuenta *</label>
                <input
                  value={nuevoNombre}
                  onChange={(e) => setNuevoNombre(e.target.value.toUpperCase())}
                  placeholder="BANCO MERCANTIL EMPRESARIAL"
                  className={`${inp} uppercase font-bold`}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={lbl}>Clase Contable</label>
                  <select
                    value={nuevaClase}
                    onChange={(e) => setNuevaClase(e.target.value as ClaseCuenta)}
                    className={`${inp} font-bold`}
                  >
                    <option value="ACTIVO">ACTIVO</option>
                    <option value="PASIVO">PASIVO</option>
                    <option value="PATRIMONIO">PATRIMONIO</option>
                    <option value="INGRESO">INGRESO</option>
                    <option value="COSTO_CONTRA_INGRESO">COSTO / CRUCES</option>
                    <option value="GASTO">GASTO</option>
                    <option value="ORDEN">ORDEN</option>
                  </select>
                </div>

                <div>
                  <label className={lbl}>Naturaleza</label>
                  <select
                    value={nuevaNaturaleza}
                    onChange={(e) => setNuevaNaturaleza(e.target.value as "DEUDORA" | "ACREEDORA")}
                    className={`${inp} font-bold`}
                  >
                    <option value="DEUDORA">DEUDORA</option>
                    <option value="ACREEDORA">ACREEDORA</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={lbl}>Cuenta Padre</label>
                  <input
                    value={nuevoPadre}
                    onChange={(e) => setNuevoPadre(e.target.value)}
                    placeholder="1.1.02"
                    className={`${inp} font-mono`}
                  />
                </div>

                <div>
                  <label className={lbl}>Módulo Origen</label>
                  <select
                    value={nuevoModulo}
                    onChange={(e) => setNuevoModulo(e.target.value as ModuloOrigenCuenta)}
                    className={`${inp} font-bold`}
                  >
                    <option value="TESORERIA">TESORERÍA</option>
                    <option value="CLIENTES">CLIENTES</option>
                    <option value="AVALES">AVALES</option>
                    <option value="APUESTAS_TERCIOS">APUESTAS TERCIOS</option>
                    <option value="CRUCES">CRUCES</option>
                    <option value="INCENTIVOS">INCENTIVOS</option>
                    <option value="TABLAS_FIJAS">TABLAS FIJAS</option>
                    <option value="MARCAS">MARCAS</option>
                    <option value="REMATES">REMATES</option>
                    <option value="POLLAS">POLLAS</option>
                    <option value="DUPLETAS">DUPLETAS</option>
                    <option value="TAQUILLA_WPS">TAQUILLA WPS</option>
                    <option value="CONVENIOS">CONVENIOS</option>
                    <option value="CIERRE_SEMANAL">CIERRE SEMANAL</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-line bg-slate-50 px-4 py-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setModalNuevaCuenta(false)}
              >
                Cancelar
              </Button>
              <Button
                variant="default"
                size="sm"
                disabled={guardando}
                onClick={() => void guardarSubcuenta()}
              >
                {guardando ? "Guardando…" : "Guardar Subcuenta"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ===========================================================================
//  📒  PESTAÑA 2: LIBRO DIARIO Y MAYOR ANALÍTICO (PARTIDA DOBLE)
// ===========================================================================

export function TabLibroDiarioMayor() {
  const [filtroTexto, setFiltroTexto] = useState("");
  const [filtroEvento, setFiltroEvento] = useState("TODOS");
  const [asientos, setAsientos] = useState<AsientoContableRegistrado[]>(() => obtenerAsientosMemoria());

  const recargarAsientos = () => {
    setAsientos(obtenerAsientosMemoria());
  };

  const asientosFiltrados = useMemo(() => {
    const f = filtroTexto.trim().toUpperCase();
    return asientos.filter((a) => {
      const coincideEvt = filtroEvento === "TODOS" || a.tipo_evento === filtroEvento;
      const coincideTxt =
        !f ||
        a.descripcion.toUpperCase().includes(f) ||
        (a.referencia_id && a.referencia_id.toUpperCase().includes(f)) ||
        a.lineas.some(
          (l) =>
            l.cuenta_codigo.includes(f) ||
            (l.cliente_nombre && l.cliente_nombre.toUpperCase().includes(f)) ||
            (l.concepto && l.concepto.toUpperCase().includes(f))
        );
      return coincideEvt && coincideTxt;
    });
  }, [asientos, filtroTexto, filtroEvento]);

  const totales = useMemo(() => {
    let d = 0;
    let h = 0;
    for (const a of asientosFiltrados) {
      d = sumarDinero(d, a.total_debe);
      h = sumarDinero(h, a.total_haber);
    }
    return { debe: d, haber: h, diferencia: restarDinero(d, h) };
  }, [asientosFiltrados]);

  return (
    <div className="space-y-4">
      {/* Indicadores de balance de partida doble */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-line bg-white p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Total Debe (Libro Diario)</p>
          <p className="text-2xl font-black font-mono text-slate-800">{formatearMontoSinMoneda(totales.debe)}</p>
          <p className="text-[10px] text-slate-400">Sumatoria debitada en centavos exactos</p>
        </div>

        <div className="rounded-2xl border border-line bg-white p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Total Haber (Libro Diario)</p>
          <p className="text-2xl font-black font-mono text-slate-800">{formatearMontoSinMoneda(totales.haber)}</p>
          <p className="text-[10px] text-slate-400">Sumatoria acreditada en centavos exactos</p>
        </div>

        <div className="rounded-2xl border border-line bg-white p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Estado de Partida Doble</p>
          <p
            className={`text-2xl font-black font-mono ${
              totales.diferencia === 0 ? "text-emerald-700" : "text-danger-600"
            }`}
          >
            {totales.diferencia === 0 ? "0,00" : formatearMontoSinMoneda(totales.diferencia)}
          </p>
          <p className="text-[10px] font-bold text-slate-500">
            {totales.diferencia === 0
              ? "✅ Partida doble cuadrada: Debe = Haber"
              : "🚫 Descuadre contable detectado"}
          </p>
        </div>
      </div>

      {/* Barra de filtros y exportación */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white p-4 shadow-sm">
        <div>
          <h2 className="text-sm font-black uppercase text-slate-800">
            <span className="mr-1.5 text-primary-600">📒</span> Libro Diario y Mayor Analítico
          </h2>
          <p className="text-xs text-slate-500">
            Registro cronológico inmutable de asientos contables en doble partida.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            value={filtroTexto}
            onChange={(e) => setFiltroTexto(e.target.value)}
            placeholder="Filtrar por cliente, ref o concepto…"
            className={`${inp} w-60 py-1.5 font-bold`}
          />

          <select
            value={filtroEvento}
            onChange={(e) => setFiltroEvento(e.target.value)}
            className={`${inp} w-48 py-1.5 font-bold`}
          >
            <option value="TODOS">Todos los eventos</option>
            <option value="LIQUIDACION_APUESTAS">Liquidación de Apuestas</option>
            <option value="REEMBOLSO_CRUCE">Reembolso por Cruce (🔀)</option>
            <option value="DEVOLUCION_INCENTIVO">Devolución de Incentivos</option>
            <option value="DEPOSITO_CLIENTE">Depósitos de Clientes</option>
            <option value="RETIRO_CLIENTE">Retiros de Clientes</option>
            <option value="TRASLADO_CLIENTES">Traslados entre Clientes</option>
            <option value="AVAL_OTORGADO">Aval Otorgado</option>
            <option value="AVAL_PAGADO">Aval Pagado</option>
            <option value="REVERSION_LIQUIDACION">Reversiones / Contra-asientos</option>
          </select>

          <Button variant="outline" size="sm" onClick={recargarAsientos}>
            <span>🔄</span> Refrescar
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const filasCsv: Array<Array<unknown>> = [];
              asientosFiltrados.forEach((a) => {
                a.lineas.forEach((l) => {
                  filasCsv.push([
                    a.fecha_contable,
                    a.numero_asiento,
                    a.tipo_evento,
                    l.cuenta_codigo,
                    l.cuenta_nombre,
                    l.cliente_nombre || "",
                    l.concepto,
                    formatearMontoSinMoneda(l.debe),
                    formatearMontoSinMoneda(l.haber),
                  ]);
                });
              });
              exportarTabla(
                "libro_diario_analitico",
                ["Fecha", "Asiento N°", "Evento", "Cuenta", "Nombre Cuenta", "Cliente", "Concepto", "Debe", "Haber"],
                filasCsv
              );
            }}
          >
            <span>⬇️</span> CSV
          </Button>
        </div>
      </div>

      {/* Asientos Contables */}
      <div className="space-y-3">
        {asientosFiltrados.map((a) => (
          <div
            key={a.id}
            className="overflow-hidden rounded-2xl border border-line bg-white shadow-xs"
          >
            <div className="flex flex-wrap items-center justify-between border-b border-line/80 bg-slate-50/70 px-4 py-2.5 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-black text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-md">
                  Asiento #{a.numero_asiento}
                </span>
                <span className="font-mono text-slate-500 font-bold">📅 {a.fecha_contable}</span>
                <span className="rounded-full bg-slate-200/80 px-2 py-0.5 text-[10px] font-black uppercase text-slate-700">
                  {a.tipo_evento.replace("_", " ")}
                </span>
                {a.estado === "REVERSADO" && (
                  <span className="rounded-full bg-purple-100 text-purple-800 border border-purple-200 px-2 py-0.5 text-[10px] font-black uppercase">
                    Reversado
                  </span>
                )}
              </div>
              <div className="font-semibold text-slate-600 truncate max-w-md">
                {a.descripcion}
              </div>
            </div>

            <table className="w-full text-xs">
              <thead className="bg-slate-50/40 text-[9px] uppercase font-bold text-slate-500 border-b border-line/60">
                <tr>
                  <th className="px-3 py-1.5 text-left">Cuenta</th>
                  <th className="px-3 py-1.5 text-left">Nombre de la Cuenta</th>
                  <th className="px-3 py-1.5 text-left">Cliente / Tercero</th>
                  <th className="px-3 py-1.5 text-left">Concepto</th>
                  <th className="px-3 py-1.5 text-right">Debe</th>
                  <th className="px-3 py-1.5 text-right">Haber</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/40">
                {a.lineas.map((l, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/50">
                    <td className="px-3 py-1.5 font-mono font-bold text-slate-800">{l.cuenta_codigo}</td>
                    <td className="px-3 py-1.5 text-slate-700 font-semibold">{l.cuenta_nombre}</td>
                    <td className="px-3 py-1.5 font-semibold text-indigo-900">{l.cliente_nombre || "—"}</td>
                    <td className="px-3 py-1.5 text-slate-500 text-[11px]">{l.concepto}</td>
                    <td className="px-3 py-1.5 text-right font-mono font-black text-slate-800">
                      {l.debe > 0 ? formatearMontoSinMoneda(l.debe) : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono font-black text-slate-800">
                      {l.haber > 0 ? formatearMontoSinMoneda(l.haber) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-line bg-slate-50/60 font-mono text-[11px] font-black">
                <tr>
                  <td colSpan={4} className="px-3 py-1.5 text-right uppercase text-slate-600">
                    Totales del Asiento #{a.numero_asiento}:
                  </td>
                  <td className="px-3 py-1.5 text-right text-slate-900">
                    {formatearMontoSinMoneda(a.total_debe)}
                  </td>
                  <td className="px-3 py-1.5 text-right text-slate-900">
                    {formatearMontoSinMoneda(a.total_haber)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ))}

        {asientosFiltrados.length === 0 && (
          <div className="rounded-2xl border border-dashed border-line bg-white p-8 text-center text-xs font-semibold text-slate-400">
            No se han generado asientos que coincidan con los filtros seleccionados.
          </div>
        )}
      </div>
    </div>
  );
}

// ===========================================================================
//  📊  PESTAÑA 3: BALANCE DE COMPROBACIÓN Y ESTADO DE RESULTADOS DE LA SEMANA
// ===========================================================================

export function TabEstadoResultadosSemana() {
  const [asientos] = useState<AsientoContableRegistrado[]>(() => obtenerAsientosMemoria());
  const r = useMemo(() => {
    return calcularEstadoResultadosSemana(asientos);
  }, [asientos]);

  return (
    <div className="space-y-4">
      {/* Tarjetas resumen */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-wider text-emerald-800">Ingresos Brutos</p>
          <p className="text-2xl font-black font-mono text-emerald-700">
            {formatearMontoSinMoneda(r.ingresos.totalIngresosBrutos)}
          </p>
          <p className="text-[10px] text-emerald-600">Comisiones y ventas brutas</p>
        </div>

        <div className="rounded-2xl border border-rose-200 bg-rose-50/50 p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-wider text-rose-800">Rebajas, Cruces e Incentivos</p>
          <p className="text-2xl font-black font-mono text-rose-700">
            {formatearMontoSinMoneda(r.rebajasEIncentivos.totalRebajasEIncentivos)}
          </p>
          <p className="text-[10px] text-rose-600">Cruces (5.1.01) + Incentivos (5.1.02/03)</p>
        </div>

        <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-wider text-blue-800">Ingreso Neto Operacional</p>
          <p className="text-2xl font-black font-mono text-blue-700">
            {formatearMontoSinMoneda(r.ingresoNetoOperacional)}
          </p>
          <p className="text-[10px] text-blue-600">Ingresos brutos menos deducciones</p>
        </div>

        <div className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-wider text-indigo-800">Utilidad Neta de la Semana</p>
          <p
            className={`text-2xl font-black font-mono ${
              r.utilidadNeta < 0 ? "text-danger-600" : "text-emerald-700"
            }`}
          >
            {formatearMontoSinMoneda(r.utilidadNeta)}
          </p>
          <p className="text-[10px] text-indigo-600">Margen neto final consolidado</p>
        </div>
      </div>

      {/* Cascada Financiera del Estado de Resultados */}
      <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
        <div className="border-b border-line bg-slate-900 px-4 py-3 text-white flex items-center justify-between">
          <h2 className="text-xs font-black uppercase tracking-wider">
            📊 Estado de Resultados de la Semana (NIIF Cascada Operacional)
          </h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              exportarTabla(
                "estado_resultados_semana",
                ["Concepto", "Cuenta", "Monto"],
                [
                  ["Comisión Apuestas Tercios", "4.1.01.001", formatearMontoSinMoneda(r.ingresos.comisionTercios)],
                  ["Comisión Remates", "4.1.02.001", formatearMontoSinMoneda(r.ingresos.comisionRemates)],
                  ["Comisión Pollas", "4.1.03.001", formatearMontoSinMoneda(r.ingresos.comisionPollas)],
                  ["Comisión Dupletas", "4.1.04.001", formatearMontoSinMoneda(r.ingresos.comisionDupletas)],
                  ["Ventas Tablas Fijas", "4.2.01.001", formatearMontoSinMoneda(r.ingresos.ventasTablas)],
                  ["Ventas Marcas", "4.2.02.001", formatearMontoSinMoneda(r.ingresos.ventasMarcas)],
                  ["Ventas Taquilla WPS", "4.2.03.001", formatearMontoSinMoneda(r.ingresos.ventasWps)],
                  ["Ingresos Convenios", "4.3.01.001", formatearMontoSinMoneda(r.ingresos.convenios)],
                  ["TOTAL INGRESOS BRUTOS", "4", formatearMontoSinMoneda(r.ingresos.totalIngresosBrutos)],
                  ["(-) Reembolso Comisión por Cruces (🔀 CRUCE)", "5.1.01.001", formatearMontoSinMoneda(r.rebajasEIncentivos.reembolsosCruces)],
                  ["(-) Devolución de Incentivos a Clientes", "5.1.02.001", formatearMontoSinMoneda(r.rebajasEIncentivos.incentivosClientes)],
                  ["(-) Devolución a Avaladores", "5.1.03.001", formatearMontoSinMoneda(r.rebajasEIncentivos.incentivosAvaladores)],
                  ["(=) INGRESO NETO OPERACIONAL", "", formatearMontoSinMoneda(r.ingresoNetoOperacional)],
                  ["(-) Costo de Premios Pagados", "5.2", formatearMontoSinMoneda(r.costosPremios.totalPremios)],
                  ["(-) Gastos Operativos y Bancarios", "6.1", formatearMontoSinMoneda(r.gastos.totalGastos)],
                  ["(=) UTILIDAD NETA DE LA SEMANA", "", formatearMontoSinMoneda(r.utilidadNeta)],
                ]
              )
            }
          >
            <span>⬇️</span> CSV
          </Button>
        </div>

        <div className="p-4 space-y-4">
          {/* 1. Ingresos Brutos */}
          <div>
            <h3 className="mb-2 text-xs font-black uppercase text-emerald-800 flex items-center gap-1.5">
              <span>➕</span> 1. Ingresos Brutos por Comisiones y Ventas (4.x)
            </h3>
            <div className="rounded-xl border border-line bg-slate-50/60 p-3 space-y-1.5 text-xs">
              <div className="flex justify-between items-center py-1 border-b border-line/60">
                <span className="font-semibold text-slate-700">Comisión Apuestas entre Tercios (4.1.01.001)</span>
                <span className="font-mono font-bold text-slate-900">{formatearMontoSinMoneda(r.ingresos.comisionTercios)}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-line/60">
                <span className="font-semibold text-slate-700">Comisión Remates Hípicos (4.1.02.001)</span>
                <span className="font-mono font-bold text-slate-900">{formatearMontoSinMoneda(r.ingresos.comisionRemates)}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-line/60">
                <span className="font-semibold text-slate-700">Comisión Pollas Hípicas (4.1.03.001)</span>
                <span className="font-mono font-bold text-slate-900">{formatearMontoSinMoneda(r.ingresos.comisionPollas)}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-line/60">
                <span className="font-semibold text-slate-700">Comisión Dupletas (4.1.04.001)</span>
                <span className="font-mono font-bold text-slate-900">{formatearMontoSinMoneda(r.ingresos.comisionDupletas)}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-line/60">
                <span className="font-semibold text-slate-700">Ventas Tablas Fijas (4.2.01.001)</span>
                <span className="font-mono font-bold text-slate-900">{formatearMontoSinMoneda(r.ingresos.ventasTablas)}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-line/60">
                <span className="font-semibold text-slate-700">Ventas Marcas (4.2.02.001)</span>
                <span className="font-mono font-bold text-slate-900">{formatearMontoSinMoneda(r.ingresos.ventasMarcas)}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-line/60">
                <span className="font-semibold text-slate-700">Ventas Taquilla WPS (4.2.03.001)</span>
                <span className="font-mono font-bold text-slate-900">{formatearMontoSinMoneda(r.ingresos.ventasWps)}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-line/60">
                <span className="font-semibold text-slate-700">Ingresos por Convenios Inter-Grupos (4.3.01.001)</span>
                <span className="font-mono font-bold text-slate-900">{formatearMontoSinMoneda(r.ingresos.convenios)}</span>
              </div>
              <div className="flex justify-between items-center pt-2 font-black text-emerald-800 text-sm">
                <span>Subtotal Ingresos Brutos de la Casa:</span>
                <span className="font-mono">{formatearMontoSinMoneda(r.ingresos.totalIngresosBrutos)}</span>
              </div>
            </div>
          </div>

          {/* 2. Deducciones, Cruces e Incentivos */}
          <div>
            <h3 className="mb-2 text-xs font-black uppercase text-rose-800 flex items-center gap-1.5">
              <span>➖</span> 2. Rebajas sobre Ingresos: Cruces e Incentivos (5.1.x)
            </h3>
            <div className="rounded-xl border border-line bg-rose-50/30 p-3 space-y-1.5 text-xs">
              <div className="flex justify-between items-center py-1 border-b border-line/60">
                <span className="font-semibold text-rose-900">
                  Reembolso Comisión por Cruces (🔀 CRUCE Modalidad CON CRUCES) (5.1.01.001)
                </span>
                <span className="font-mono font-bold text-rose-700">
                  -{formatearMontoSinMoneda(r.rebajasEIncentivos.reembolsosCruces)}
                </span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-line/60">
                <span className="font-semibold text-rose-900">
                  Devolución de Incentivos a Clientes (A favor del cliente) (5.1.02.001)
                </span>
                <span className="font-mono font-bold text-rose-700">
                  -{formatearMontoSinMoneda(r.rebajasEIncentivos.incentivosClientes)}
                </span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-line/60">
                <span className="font-semibold text-rose-900">
                  Devolución de Comisión a Avaladores / Corredores (5.1.03.001)
                </span>
                <span className="font-mono font-bold text-rose-700">
                  -{formatearMontoSinMoneda(r.rebajasEIncentivos.incentivosAvaladores)}
                </span>
              </div>
              <div className="flex justify-between items-center pt-2 font-black text-rose-800 text-sm">
                <span>Total Rebajas, Cruces e Incentivos:</span>
                <span className="font-mono">-{formatearMontoSinMoneda(r.rebajasEIncentivos.totalRebajasEIncentivos)}</span>
              </div>
            </div>
          </div>

          {/* 3. Ingreso Neto Operacional */}
          <div className="rounded-xl border-2 border-blue-400 bg-blue-50/80 p-3.5 flex justify-between items-center font-black text-blue-950">
            <span className="text-sm uppercase tracking-wide">
              (=) Ingreso Neto Operacional de la Casa:
            </span>
            <span className="text-xl font-mono text-blue-800">
              {formatearMontoSinMoneda(r.ingresoNetoOperacional)}
            </span>
          </div>

          {/* 4. Costos y Gastos */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-xl border border-line bg-slate-50/60 p-3 space-y-1.5 text-xs">
              <span className="font-black uppercase text-slate-700 block mb-1">
                Costos de Premios Pagados (5.2.x)
              </span>
              <div className="flex justify-between items-center py-0.5">
                <span className="text-slate-600">Tablas Fijas:</span>
                <span className="font-mono font-bold">{formatearMontoSinMoneda(r.costosPremios.premiosTablas)}</span>
              </div>
              <div className="flex justify-between items-center py-0.5">
                <span className="text-slate-600">Marcas y Dupletas:</span>
                <span className="font-mono font-bold">{formatearMontoSinMoneda(r.costosPremios.premiosMarcasDupletas)}</span>
              </div>
              <div className="flex justify-between items-center py-0.5">
                <span className="text-slate-600">Taquilla WPS:</span>
                <span className="font-mono font-bold">{formatearMontoSinMoneda(r.costosPremios.premiosWps)}</span>
              </div>
              <div className="flex justify-between items-center pt-1 border-t border-line font-black text-slate-800">
                <span>Total Premios:</span>
                <span className="font-mono">-{formatearMontoSinMoneda(r.costosPremios.totalPremios)}</span>
              </div>
            </div>

            <div className="rounded-xl border border-line bg-slate-50/60 p-3 space-y-1.5 text-xs">
              <span className="font-black uppercase text-slate-700 block mb-1">
                Gastos Operativos (6.x)
              </span>
              <div className="flex justify-between items-center py-0.5">
                <span className="text-slate-600">Comisiones Bancarias (6.1.01):</span>
                <span className="font-mono font-bold">{formatearMontoSinMoneda(r.gastos.comisionesBancarias)}</span>
              </div>
              <div className="flex justify-between items-center py-0.5">
                <span className="text-slate-600">Diferencial Cambiario (6.1.02):</span>
                <span className="font-mono font-bold">{formatearMontoSinMoneda(r.gastos.diferencialCambiario)}</span>
              </div>
              <div className="flex justify-between items-center py-0.5">
                <span className="text-slate-600">Administración y Operadores (6.1.03):</span>
                <span className="font-mono font-bold">{formatearMontoSinMoneda(r.gastos.administracionOperadores)}</span>
              </div>
              <div className="flex justify-between items-center pt-1 border-t border-line font-black text-slate-800">
                <span>Total Gastos:</span>
                <span className="font-mono">-{formatearMontoSinMoneda(r.gastos.totalGastos)}</span>
              </div>
            </div>
          </div>

          {/* 5. Utilidad Neta Final */}
          <div className="rounded-2xl border-2 border-emerald-500 bg-emerald-50 p-4 flex flex-wrap justify-between items-center font-black text-emerald-950 shadow-md">
            <div>
              <span className="text-base uppercase tracking-wide block">
                (=) Utilidad Neta de la Semana (Margen Final Consolidado)
              </span>
              <span className="text-xs font-semibold text-emerald-800">
                Ingreso Neto Operacional menos costos de premios y gastos operativos
              </span>
            </div>
            <span
              className={`text-3xl font-mono ${
                r.utilidadNeta < 0 ? "text-danger-600" : "text-emerald-700"
              }`}
            >
              {formatearMontoSinMoneda(r.utilidadNeta)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

