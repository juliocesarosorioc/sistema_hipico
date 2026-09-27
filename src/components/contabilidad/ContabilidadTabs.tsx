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
import { Button } from "@/components/ui/Button";
import {
  aUsd,
  crearMoneda,
  eliminarBanco,
  esVes,
  guardarBanco,
  guardarTasaReferencia,
  listarHistorialTasas,
  MODALIDADES_EGRESO,
  MODALIDADES_INGRESO,
  registrarDeposito,
  registrarRetiro,
  registrarTasaCambio,
  registrarTraslado,
  round2,
  saldoBancoUsd,
  totalCaja,
  TIPOS_CUENTA,
  type BancoRow,
  type ClienteSaldo,
  type DepositoRow,
  type MonedaRow,
  type TasaCambioRow,
  type TasaReferenciaRow,
  type TipoDeposito,
  type TransaccionRow,
} from "@/lib/contabilidad";

const inp =
  "w-full border border-line rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-primary-500 bg-surface";
const lbl = "block text-[10px] font-bold text-slate-600 mb-1 uppercase tracking-wider";
const th = "px-3 py-2 text-left text-[9px] font-black uppercase tracking-wider text-slate-500";
const td = "px-3 py-2 align-middle";

const numDe = (s: string) => parseFloat(s.replace(",", ".")) || 0;
const fechaCorta = (f: string | null) =>
  f ? new Date(f).toLocaleString("es-VE", { dateStyle: "short", timeStyle: "short" }) : "—";

const toast = (msg: string, tipo: "success" | "warning" | "error" | "info" = "info") =>
  window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));

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
  const [monto, setMonto] = useState("");
  const [moneda, setMoneda] = useState<"USD" | "VES">("USD");
  const [tasa, setTasa] = useState(String(tasaVes));
  const [modalidad, setModalidad] = useState("");
  const [bancoId, setBancoId] = useState("");
  const [referencia, setReferencia] = useState("");
  const [nota, setNota] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (esVes(moneda)) setTasa(String(tasaVes));
  }, [moneda, tasaVes]);

  const montoNum = numDe(monto);
  const montoUsd = aUsd(montoNum, moneda, parseFloat(tasa));
  // El aval no es dinero: suma al límite del cliente, no entra a la cuenta.
  const esAval = tipo === "Otorgar Aval";

  const visibles = useMemo(() => {
    const f = filtro.trim().toUpperCase();
    return f ? clientes.filter((c) => c.nombre.toUpperCase().includes(f)) : clientes;
  }, [clientes, filtro]);

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
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="rounded-2xl border border-line bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-black uppercase text-slate-700">
          <i className="fas fa-plus-circle mr-1 text-emerald-600"></i> Registrar ingreso
        </h2>
        <div className="space-y-2">
          <div>
            <label className={lbl}>Cliente *</label>
            <input
              value={filtro}
              onChange={(e) => setFiltro(e.target.value.toUpperCase())}
              placeholder="Buscar cliente…"
              className={inp}
            />
            <select value={clienteId} onChange={(e) => setClienteId(e.target.value)} className={`${inp} mt-1 font-bold`}>
              <option value="">— Seleccione —</option>
              {visibles.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre} · saldo ${round2(c.saldo_actual)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={lbl}>Tipo de operación</label>
            <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoDeposito)} className={`${inp} font-bold`}>
              <option value="Normal">Normal (ingreso real)</option>
              <option value="Otorgar Aval">Otorgar Aval</option>
              <option value="Pagar Aval">Pagar Aval</option>
            </select>
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
            <i className="fas fa-check"></i> {guardando ? "Guardando…" : "Registrar"}
          </Button>
        </div>
      </div>

      <div className="space-y-4 lg:col-span-2">
        <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
          <div className="border-b border-line px-4 py-2 text-sm font-black uppercase text-slate-700">
            <i className="fas fa-users mr-1 text-primary-600"></i> Saldos y deudas
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
          <div className="border-b border-line px-4 py-2 text-sm font-black uppercase text-slate-700">
            <i className="fas fa-clock-rotate-left mr-1 text-primary-600"></i> Historial de ingresos
          </div>
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  <th className={th}>Fecha</th>
                  <th className={th}>Cliente</th>
                  <th className={th}>Tipo</th>
                  <th className={th}>Modalidad</th>
                  <th className={th + " text-right"}>Monto</th>
                </tr>
              </thead>
              <tbody>
                {depositos.map((d) => (
                  <tr key={d.id} className="border-t border-line">
                    <td className={td + " text-slate-500"}>{fechaCorta(d.fecha)}</td>
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
                {depositos.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-slate-400">
                      Sin ingresos registrados.
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
  const [guardando, setGuardando] = useState(false);

  const montoNum = numDe(monto);
  const montoUsd = aUsd(montoNum, moneda, parseFloat(tasa));
  const total = totalCaja(clientes);
  const conSaldo = clientes.filter((c) => c.saldo_actual !== 0);
  const deudores = clientes.filter((c) => c.saldo_actual < 0);

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
          <p className="text-[10px] text-slate-400">
            Total ${round2(deudores.reduce((a, c) => a + c.saldo_actual, 0)).toFixed(2)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-line bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-black uppercase text-slate-700">
            <i className="fas fa-right-left mr-1 text-primary-600"></i> Movimiento de caja
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
              <i className="fas fa-check"></i>{" "}
              {guardando ? "Guardando…" : modo === "traslado" ? "Registrar traslado" : "Registrar retiro"}
            </Button>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm lg:col-span-2">
          <div className="border-b border-line px-4 py-2 text-sm font-black uppercase text-slate-700">
            <i className="fas fa-book mr-1 text-primary-600"></i> Libro mayor
          </div>
          <div className="max-h-[32rem] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  <th className={th}>Fecha</th>
                  <th className={th}>Tipo</th>
                  <th className={th}>Origen</th>
                  <th className={th}>Destino</th>
                  <th className={th}>Modalidad</th>
                  <th className={th}>Ref.</th>
                  <th className={th + " text-right"}>Monto</th>
                </tr>
              </thead>
              <tbody>
                {transacciones.map((t) => (
                  <tr key={t.id} className="border-t border-line">
                    <td className={td + " text-slate-500"}>{fechaCorta(t.fecha)}</td>
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
                {transacciones.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-slate-400">
                      Sin movimientos registrados.
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
    if (!confirm(`¿Eliminar la cuenta "${b.nombre}"?`)) return;
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
            <i className="fas fa-plus"></i> Nueva cuenta
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
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
                      <i className="fas fa-pen"></i>
                    </Button>{" "}
                    <Button variant="danger" size="sm" onClick={() => void borrar(b)}>
                      <i className="fas fa-trash"></i>
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
                <i className="fas fa-check"></i> Guardar
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
  const [monedaId, setMonedaId] = useState("");
  const [nuevaTasa, setNuevaTasa] = useState("");
  const [nuevaMoneda, setNuevaMoneda] = useState({ nombre: "", codigo: "", simbolo: "", tasa: "" });
  const [refTipo, setRefTipo] = useState<"BCV" | "BINANCE" | "EURO">("BCV");
  const [refTasa, setRefTasa] = useState("");
  const [refFecha, setRefFecha] = useState(() => new Date().toISOString().slice(0, 10));

  const guardarTasa = async () => {
    if (!monedaId) return toast("Seleccione la moneda.", "warning");
    const t = numDe(nuevaTasa);
    if (!(t > 0)) return toast("La tasa debe ser un número mayor a cero.", "warning");
    if (
      !confirm(
        `Registrar la tasa ${t}?\n\nLa vigente es la más reciente por fecha; la anterior se conserva como histórico.`
      )
    )
      return;
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
            <i className="fas fa-exchange-alt mr-1 text-primary-600"></i> Tasa de cambio
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
              <i className="fas fa-check"></i> Registrar tasa
            </Button>
            <p className="text-[10px] leading-relaxed text-slate-400">
              El historial es <b>append-only</b>: cada cambio guarda una fila nueva y la vigente es la más
              reciente por fecha. Nunca se reescribe una tasa anterior.
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-black uppercase text-slate-700">
            <i className="fas fa-plus-circle mr-1 text-primary-600"></i> Nueva moneda
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
              <i className="fas fa-check"></i> Crear moneda
            </Button>
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-black uppercase text-slate-700">
            <i className="fas fa-chart-line mr-1 text-primary-600"></i> Tasa de referencia
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
                <input type="date" value={refFecha} onChange={(e) => setRefFecha(e.target.value)} className={inp} />
              </div>
            </div>
            <Button variant="default" size="sm" className="w-full" onClick={guardarReferencia}>
              <i className="fas fa-check"></i> Registrar referencia
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
          <div className="border-b border-line px-4 py-2 text-sm font-black uppercase text-slate-700">
            <i className="fas fa-history mr-1 text-primary-600"></i> Histórico de tasas
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
                {historial.map((h) => (
                  <tr key={h.id} className="border-t border-line">
                    <td className={td + " text-slate-500"}>{fechaCorta(h.fecha_registro)}</td>
                    <td className={td + " font-semibold text-slate-700"}>{h.monedas?.nombre ?? "—"}</td>
                    <td className={`${td} text-right font-mono font-black`}>{Number(h.tasa).toFixed(2)}</td>
                  </tr>
                ))}
                {historial.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-3 py-8 text-center text-slate-400">
                      Sin tasas registradas.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
          <div className="border-b border-line px-4 py-2 text-sm font-black uppercase text-slate-700">
            <i className="fas fa-satellite mr-1 text-primary-600"></i> Tasas de referencia
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
                {referencias.map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className={td + " text-slate-500"}>{r.fecha_aplicar}</td>
                    <td className={td + " font-semibold text-slate-700"}>{r.tipo}</td>
                    <td className={`${td} text-right font-mono font-black`}>{Number(r.tasa).toFixed(2)}</td>
                  </tr>
                ))}
                {referencias.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-3 py-8 text-center text-slate-400">
                      Sin tasas de referencia.
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
