"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/shared/components/ui/Button";
import {
  construirEstadoCuenta,
  formasPagoDe,
  resumenFormaPago,
  type ClienteRow,
  type NivelAcordeon,
  type TicketApuesta,
} from "@/features/clientes/lib/clientes";
import {
  construirFichaEstadoCuentaUnificada,
  type FichaEstadoCuentaUnificada,
} from "@/features/saldos/lib/contabilidad-central";
import {
  calcularComisionesSocioPorClientes,
  cargarTodosTicketsParaComisiones,
  type ResumenComisionesSocio,
} from "@/features/clientes/lib/comisiones-socios";
import { formatoMoneda } from "@/shared/lib/vzla";

/** Nodo acordeón recursivo con el mismo criterio de totales del legacy. */
function Nodo({ nivel, devPct, nivelProf }: { nivel: NivelAcordeon; devPct: number; nivelProf: number }) {
  const [abierto, setAbierto] = useState(nivelProf === 0);
  const tieneHijos = nivel.hijos.length > 0;
  const dec = nivel.dec;

  return (
    <div className="select-none">
      <div
        className={`flex cursor-pointer items-center gap-2 rounded-xl border border-line px-3 py-2 transition-colors hover:bg-slate-50 ${
          abierto ? "bg-white shadow-sm" : "bg-white"
        }`}
        onClick={() => tieneHijos && setAbierto((a) => !a)}
        style={{ marginLeft: nivelProf * 12 }}
      >
        {tieneHijos ? (
          <span className={`text-[10px] text-slate-400 transition-transform ${abierto ? "rotate-90" : ""}`}>▶</span>
        ) : (
          <span className="inline-block w-3"></span>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold text-slate-800 truncate">{nivel.titulo}</div>
          {nivel.subtitulo ? <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">{nivel.subtitulo}</div> : null}
        </div>
        <div className="text-right text-[11px]">
          {(() => {
            const resTotalNivel = Math.round(((nivel.monto ?? 0) + (dec ?? 0)) * 100) / 100;
            return (
              <div
                className={`font-mono font-black ${
                  resTotalNivel > 0
                    ? "text-emerald-700"
                    : resTotalNivel < 0
                      ? "text-rose-700"
                      : "text-slate-700"
                }`}
              >
                {resTotalNivel > 0 ? "+" : ""}
                {formatoMoneda("USD", resTotalNivel)}
              </div>
            );
          })()}
          <div className="font-mono font-bold text-purple-600">{formatoMoneda("USD", dec)} <span className="text-[9px]">({dec > 0 ? `+${devPct}%` : devPct}%)</span></div>
        </div>
      </div>

      {abierto && tieneHijos ? (
        nivelProf < 3 ? (
          <div className="mt-1 space-y-1">
            {nivel.hijos.map((h, i) => (
              <Nodo key={`${nivelProf}-${i}-${h.titulo}-${h.subtitulo ?? ""}`} nivel={h} devPct={devPct} nivelProf={nivelProf + 1} />
            ))}
          </div>
        ) : (
          <JugadasDesplegables nivel={nivel} devPct={devPct} nivelProf={nivelProf} />
        )
      ) : null}

      {abierto && nivelProf === 0 ? <ResumenNivel nivel={nivel} devPct={devPct} /> : null}
    </div>
  );
}

function JugadasDesplegables({ nivel, devPct, nivelProf }: { nivel: NivelAcordeon; devPct: number; nivelProf: number }) {
  return (
    <div className="mt-1 space-y-1">
      {nivel.hijos.map((c, i) => {
        const resultadoTotalCarrera =
          Math.round(
            c.jugadas.reduce((acc, item) => acc + (item.resultadoNeto ?? 0) + (item.devolucion ?? 0), 0) * 100
          ) / 100;
        return (
          <div key={`${nivelProf}-${i}-${c.titulo}`} className="rounded-xl border border-line px-3 py-2 bg-slate-50" style={{ marginLeft: (nivelProf + 1) * 12 }}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-700">
                <span className="mr-1 text-indigo-500">🏁</span>
                {c.titulo} <span className="font-medium text-slate-400">· {c.subtitulo}</span>
              </span>
              <span
                className={`text-[10px] font-mono font-black ${
                  resultadoTotalCarrera > 0
                    ? "text-emerald-700"
                    : resultadoTotalCarrera < 0
                      ? "text-rose-700"
                      : "text-slate-700"
                }`}
                title="Resultado total ganador o perdedor en la carrera (con devolución incluida)"
              >
                Resultado: {resultadoTotalCarrera > 0 ? "+" : ""}
                {formatoMoneda("USD", resultadoTotalCarrera)}
              </span>
            </div>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="text-slate-400 uppercase tracking-wider">
                    <th className="text-left font-black px-2 py-1">Caballo</th>
                    <th className="text-left font-black px-2 py-1">Jugada</th>
                    <th className="text-right font-black px-2 py-1">Jugado</th>
                    <th className="text-right font-black px-2 py-1" title="Monto total ganador o perdedor en la carrera con la devolución incluida a quien aplique">Resultado</th>
                    <th className="text-right font-black px-2 py-1 text-purple-600">Devolución</th>
                    <th className="text-right font-black px-2 py-1">Premio</th>
                    <th className="text-left font-black px-2 py-1">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {c.jugadas.map((j) => {
                    const resJugadaConDev = Math.round(((j.resultadoNeto ?? 0) + (j.devolucion ?? 0)) * 100) / 100;
                    return (
                      <tr key={j.id} className="border-t border-line">
                        <td className="px-2 py-1 font-bold text-slate-700">{j.caballo}</td>
                        <td className="px-2 py-1">{j.jugada}</td>
                        <td className="px-2 py-1 text-right font-mono">{formatoMoneda(j.moneda, j.montoJugado)}</td>
                        <td
                          className={`px-2 py-1 text-right font-mono font-black ${
                            String(j.estado ?? "").toUpperCase().startsWith("RETIR")
                              ? "text-rose-700"
                              : resJugadaConDev > 0
                                ? "text-emerald-700"
                                : resJugadaConDev < 0
                                  ? "text-rose-700"
                                  : "text-slate-600"
                          }`}
                        >
                          {String(j.estado ?? "").toUpperCase().startsWith("RETIR")
                            ? "RETIRADO"
                            : `${resJugadaConDev > 0 ? "+" : ""}${formatoMoneda(j.moneda, resJugadaConDev)}`}
                        </td>
                        <td className="px-2 py-1 text-right font-mono font-bold text-purple-600">{formatoMoneda(j.moneda, j.devolucion)}</td>
                        <td className="px-2 py-1 text-right font-mono">{formatoMoneda(j.moneda, j.premio)}</td>
                        <td className="px-2 py-1">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase ${
                              j.estado === "Ganador"
                                ? "bg-emerald-100 text-emerald-700"
                                : j.estado === "Perdedor"
                                  ? "bg-red-100 text-red-700"
                                  : j.estado === "Pendiente"
                                    ? "bg-amber-100 text-amber-700"
                                    : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {j.estado}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-1 flex items-center justify-between text-[10px] font-mono font-bold">
              <span className="text-purple-600">
                Devolución / Incentivo en carrera: {formatoMoneda("USD", c.dec ?? 0, 2)}
              </span>
              <span
                className={
                  resultadoTotalCarrera > 0
                    ? "text-emerald-700 font-black"
                    : resultadoTotalCarrera < 0
                      ? "text-rose-700 font-black"
                      : "text-slate-600 font-black"
                }
              >
                Total Carrera (c/ Devolución): {resultadoTotalCarrera > 0 ? "+" : ""}
                {formatoMoneda("USD", resultadoTotalCarrera, 2)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ResumenNivel({ nivel, devPct }: { nivel: NivelAcordeon; devPct: number }) {
  const resultadoTotalConDev = Math.round(((nivel.monto ?? 0) + (nivel.dec ?? 0)) * 100) / 100;
  return (
    <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2" style={{ marginLeft: 12 }}>
      {[
        {
          lbl: "Resultado Neto Carreras",
          val: nivel.monto,
          icon: "🏇",
          color: nivel.monto > 0 ? "text-emerald-700" : nivel.monto < 0 ? "text-rose-700" : "text-slate-800",
          prefijo: nivel.monto > 0 ? "+" : "",
        },
        { lbl: `🎁 Devolución / Incentivo a favor (${devPct}%)`, val: nivel.dec, icon: "🎁", color: "text-emerald-600", prefijo: "+" },
        {
          lbl: "Resultado Total (+ Devolución)",
          val: resultadoTotalConDev,
          icon: "🤲",
          color: resultadoTotalConDev > 0 ? "text-emerald-700" : resultadoTotalConDev < 0 ? "text-rose-700" : "text-slate-800",
          prefijo: resultadoTotalConDev > 0 ? "+" : "",
        },
      ].map((k) => (
        <div key={k.lbl} className="rounded-xl border border-line bg-white px-4 py-3 flex items-center gap-3">
          <span className={`${k.color} text-lg`}>{k.icon}</span>
          <div>
            <div className="text-[9px] font-black uppercase tracking-wider text-slate-400">{k.lbl}</div>
            <div className={`text-sm font-black ${k.color}`}>{k.prefijo}{formatoMoneda("USD", k.val)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

type Props = {
  clientes: ClienteRow[];
  clienteEstado: ClienteRow | null;
  onActivo: (c: ClienteRow | null) => void;
  onCargarTickets: (id: string | number) => Promise<TicketApuesta[]>;
};

/**
 * Estado de cuenta dinámico (acordeón) — clon de js/clientes.js btnVerEstadoCuenta.
 * Jerarquía: Grupo > Semana > Día > Hipódromo > Carrera > Jugadas.
 */
export function EstadoCuentaAcordeon({ clientes, clienteEstado, onActivo, onCargarTickets }: Props) {
  const [cargando, setCargando] = useState(false);
  const [raiz, setRaiz] = useState<NivelAcordeon | null>(null);
  const [devolucionPct, setDevolucionPct] = useState(0);
  const [totales, setTotales] = useState({ monto: 0, dec: 0 });
  const [ficha, setFicha] = useState<FichaEstadoCuentaUnificada | null>(null);
  const [resumenSocio, setResumenSocio] = useState<ResumenComisionesSocio | null>(null);
  const [desplegadosClientes, setDesplegadosClientes] = useState<Record<string, boolean>>({});

  const seleccionar = async (c: ClienteRow | null) => {
    onActivo(c);
    if (!c) {
      setRaiz(null);
      setFicha(null);
      setResumenSocio(null);
      return;
    }
    setCargando(true);
    setRaiz(null);
    setResumenSocio(null);
    const pct = parseFloat(String(c.devolucion ?? "")) || 0;
    setDevolucionPct(pct);
    const tickets = await onCargarTickets(c.id);
    const tree = construirEstadoCuenta(tickets, pct, c);
    const fichaCalc = construirFichaEstadoCuentaUnificada({
      id: c.id,
      nombre: c.nombre ?? c.seudonimo ?? "",
      saldoBaseBd: c.saldo_actual ?? 0,
      aval: c.aval ?? 0,
      comisionPct: c.comision ?? 5,
      devolucionPct: pct,
      devolucionIncentivo: tree.dec,
      libre: String(c.modo_juego ?? "").toLowerCase().trim() === "libre",
      movimientos: tickets.map((t) => ({
        id: t.id,
        cliente_juega_id: t.cliente_juega_id ?? null,
        cliente_juega_nombre: t.cliente_juega_nombre ?? "",
        cliente_consigue_id: t.cliente_consigue_id ?? null,
        cliente_consigue_nombre: t.cliente_consigue_nombre ?? "",
        hipodromo: t.hipodromo,
        carrera: t.carrera,
        fecha_carrera: t.fecha_carrera,
        fecha_registro: t.fecha_registro,
        nombre_jugada: t.nombre_jugada,
        caballo: t.caballo,
        monto_jugado: t.monto_jugado,
        monto_decidido: t.monto_decidido,
        premio_pagar: t.premio_pagar,
        comision_porcentaje: t.comision_porcentaje,
        comision_pagada: t.comision_pagada,
        estado: t.estado,
        anulada: t.anulada,
      })),
    });

    // Cargar comisiones como socio por sus clientes asignados
    const cNom = String(c.nombre ?? c.seudonimo ?? "").trim().toUpperCase();
    const cId = String(c.id);
    const tieneAfiliados = clientes.some((x) => {
      const val = String(x.socio_asignado || x.socio_id || "").trim();
      return val === cId || (cNom && val.toUpperCase() === cNom);
    });
    if (c.es_socio || tieneAfiliados) {
      try {
        const allTickets = await cargarTodosTicketsParaComisiones();
        const resCom = calcularComisionesSocioPorClientes({
          socioNombre: cNom,
          tickets: allTickets,
          clientes,
        });
        setResumenSocio(resCom);
      } catch (err) {
        console.error("Error al calcular comisiones de socio:", err);
      }
    }

    setRaiz(tree);
    setTotales({ monto: tree.monto, dec: tree.dec });
    setFicha(fichaCalc);
    setCargando(false);
  };

  useEffect(() => {
    void seleccionar(clienteEstado ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteEstado?.id ?? null]);

  const formasPago = useMemo(() => formasPagoDe(clienteEstado), [clienteEstado]);

  return (
    <div className="space-y-3">
      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider">Cliente</label>
      <select
        className="w-full max-w-md border border-line rounded-xl px-3 py-2 text-sm font-bold text-slate-800 bg-white outline-none focus:ring-1 focus:ring-primary-500"
        value={clienteEstado ? String(clienteEstado.id) : ""}
        onChange={(e) => {
          const c = clientes.find((x) => String(x.id) === e.target.value) ?? null;
          void seleccionar(c);
        }}
      >
        <option value="">— Seleccione un cliente —</option>
        {clientes.map((c) => (
          <option key={String(c.id)} value={String(c.id)}>
            {c.nombre || c.seudonimo}
            {c.es_socio ? " ★Socio" : ""}
          </option>
        ))}
      </select>

      {/* Cómo se le paga o se le cobra al cliente elegido (PROMPT #7): todas
          sus formas de pago, la ⭐ principal primero. Va acá y no dentro del
          acordeón para que esté visible aunque el cliente no tenga movimientos. */}
      {clienteEstado && formasPago.length ? (
        <div className="rounded-xl border border-cyan-200 bg-cyan-50/70 px-3 py-2">
          <div className="text-[9px] font-black uppercase tracking-wider text-cyan-700">
            💳 Formas de pago para pagar / cobrar
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {formasPago.map((f, i) => (
              <span
                key={String(f.uid ?? i)}
                className={`rounded-lg border px-2 py-1 text-[11px] ${
                  f.principal
                    ? "border-amber-300 bg-amber-50 text-amber-800"
                    : "border-slate-200 bg-white text-slate-600"
                }`}
                title={resumenFormaPago(f)}
              >
                <b>{f.principal ? "⭐ " : ""}{resumenFormaPago(f)}</b>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {!clienteEstado ? (
        <div className="rounded-2xl border border-dashed border-line bg-white/60 p-10 text-center text-slate-400">
          <span className="text-3xl mb-2">🗒️</span>
          <p className="text-xs font-bold">Seleccione un cliente para construir su estado de cuenta.</p>
        </div>
      ) : cargando ? (
        <div className="rounded-2xl border border-line bg-white p-10 text-center text-slate-500">
          <span className="mr-2">⏳</span> Construyendo estado de cuenta…
        </div>
      ) : raiz ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between rounded-2xl border border-line bg-gradient-to-r from-slate-800 to-slate-700 px-4 py-3 text-white">
            <div>
              <div className="text-sm font-black">{clienteEstado.nombre || clienteEstado.seudonimo}</div>
              <div className="text-[10px] text-slate-300 uppercase tracking-wider">
                {devolucionPct > 0 ? `Devolución / Incentivo: ${devolucionPct}%` : "Sin devolución configurada"}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[9px] text-slate-300 uppercase">Totales + Incentivo</div>
              <div className="text-sm font-black">{formatoMoneda("USD", totales.monto + totales.dec)}</div>
              <div className="text-[10px] font-bold text-emerald-300">
                🎁 Devolución / Incentivo a favor: +{formatoMoneda("USD", totales.dec)}
              </div>
            </div>
          </div>

          {ficha ? (
            (() => {
              const comisionesSociosTotal = resumenSocio?.totalComisionesClientes ?? 0;
              const saldoContableNetoFinal = ficha.saldoContable + comisionesSociosTotal;
              const disponibleParaJugarFinal = Number.isFinite(ficha.disponibleParaJugar)
                ? ficha.disponibleParaJugar + comisionesSociosTotal
                : NaN;

              return (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 rounded-2xl border border-line bg-white p-3 text-[11px] shadow-sm">
                    <div className="rounded-lg bg-slate-50 p-2">
                      <div className="text-[9px] font-black uppercase text-slate-400">1. Saldo Inicial / Anterior</div>
                      <div className="font-mono font-bold text-slate-800">{formatoMoneda("USD", ficha.saldoInicial)}</div>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-2">
                      <div className="text-[9px] font-black uppercase text-slate-400">2. Depósitos (+) / Retiros (-)</div>
                      <div className="font-mono font-bold text-slate-800">
                        +{formatoMoneda("USD", ficha.depositos)} / -{formatoMoneda("USD", ficha.retiros)}
                      </div>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-2">
                      <div className="text-[9px] font-black uppercase text-amber-600">3. Aval Vigente</div>
                      <div className="font-mono font-bold text-amber-700">{formatoMoneda("USD", ficha.avalVigente)}</div>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-2">
                      <div className="text-[9px] font-black uppercase text-indigo-600">4. En Vivo / Adelantadas</div>
                      <div className="font-mono font-bold text-indigo-700">
                        {ficha.jugadasEnVivoCount} en vivo · {ficha.jugadasAdelantadasCount} adel.
                      </div>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-2">
                      <div className="text-[9px] font-black uppercase text-emerald-600">5. Ganadas / Com. / Reemb. Cruce</div>
                      <div className="font-mono font-bold text-emerald-700">
                        {formatoMoneda("USD", ficha.jugadasGanadasBruto)} (-{formatoMoneda("USD", ficha.comisionesCobradas)} / +{formatoMoneda("USD", ficha.reembolsoCruce)})
                      </div>
                    </div>
                    <div className="rounded-lg bg-emerald-50 p-2">
                      <div className="text-[9px] font-black uppercase text-emerald-700">6. 🎁 Devolución propia</div>
                      <div className="font-mono font-black text-emerald-700">+{formatoMoneda("USD", ficha.devolucionIncentivo)}</div>
                    </div>
                    {comisionesSociosTotal > 0 ? (
                      <div className="rounded-lg bg-purple-50 p-2 border border-purple-200">
                        <div className="text-[9px] font-black uppercase text-purple-700">6b. 🤝 Comisiones Afiliados (+)</div>
                        <div className="font-mono font-black text-purple-700">+{formatoMoneda("USD", comisionesSociosTotal)}</div>
                      </div>
                    ) : null}
                    <div className="rounded-lg bg-rose-50 p-2">
                      <div className="text-[9px] font-black uppercase text-rose-600">7. Jugadas Perdidas (-)</div>
                      <div className="font-mono font-bold text-rose-700">-{formatoMoneda("USD", ficha.jugadasPerdidas)}</div>
                    </div>
                    <div className="rounded-lg bg-amber-50 p-2">
                      <div className="text-[9px] font-black uppercase text-amber-600">8. Riesgo en Curso (-)</div>
                      <div className="font-mono font-bold text-amber-700">-{formatoMoneda("USD", ficha.riesgoEnCurso)}</div>
                    </div>
                    <div className="rounded-lg bg-slate-100 p-2">
                      <div className="text-[9px] font-black uppercase text-slate-600">9. Saldo Contable Neto</div>
                      <div className="font-mono font-black text-slate-900">{formatoMoneda("USD", saldoContableNetoFinal)}</div>
                    </div>
                    <div className="rounded-lg bg-indigo-50 p-2">
                      <div className="text-[9px] font-black uppercase text-indigo-700">10. Disponible Total para Apostar</div>
                      <div className="font-mono font-black text-indigo-800">
                        {Number.isFinite(disponibleParaJugarFinal) ? formatoMoneda("USD", disponibleParaJugarFinal) : "LIBRE"}
                      </div>
                    </div>
                  </div>

                  {/* SECCIÓN SEGMENTADA POR COMISIONES DE OTROS JUGADORES (SOCIOS) */}
                  {resumenSocio && resumenSocio.desglosePorCliente.length > 0 ? (
                    <div className="rounded-2xl border border-purple-200 bg-white p-4 shadow-sm space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-purple-100 pb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xl">🤝</span>
                          <div>
                            <h3 className="text-sm font-black text-slate-800">
                              Comisiones Ganadas por Clientes Asignados
                            </h3>
                            <p className="text-[10px] text-slate-500">
                              Imputadas directamente en el saldo del socio. No alteran el cobro ni pago nominal de tickets.
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[9px] font-black uppercase text-purple-600">Total Comisiones</div>
                          <div className="text-base font-black text-purple-700 font-mono">
                            +{formatoMoneda("USD", resumenSocio.totalComisionesClientes)}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-2">
                        {resumenSocio.desglosePorCliente.map((cl) => {
                          const estaAbierto = Boolean(desplegadosClientes[cl.clienteNombre]);
                          return (
                            <div
                              key={cl.clienteNombre}
                              className="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden"
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  setDesplegadosClientes((prev) => ({
                                    ...prev,
                                    [cl.clienteNombre]: !prev[cl.clienteNombre],
                                  }))
                                }
                                className="w-full flex flex-wrap items-center justify-between gap-2 p-3 text-left hover:bg-purple-50/50 transition-colors"
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-mono text-xs text-purple-600 font-bold">
                                    {estaAbierto ? "▼" : "▶"}
                                  </span>
                                  <span className="font-bold text-xs text-slate-800">
                                    👤 {cl.clienteNombre}
                                  </span>
                                  <span className="text-[10px] bg-purple-100 text-purple-800 font-bold px-2 py-0.5 rounded-full">
                                    {cl.comisionPct}% comisión
                                  </span>
                                  <span className="text-[10px] text-slate-400">
                                    (desde {cl.fechaInicio})
                                  </span>
                                </div>
                                <div className="flex items-center gap-3 text-right">
                                  <div>
                                    <div className="text-[9px] text-slate-400 uppercase">Jugado</div>
                                    <div className="font-mono font-bold text-xs text-slate-700">
                                      {formatoMoneda("USD", cl.totalJugado)}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-[9px] text-purple-600 uppercase font-black">Comisión Socio</div>
                                    <div className="font-mono font-black text-xs text-purple-700">
                                      +{formatoMoneda("USD", cl.totalComision)}
                                    </div>
                                  </div>
                                  <span className="text-[11px] text-slate-400 font-semibold">
                                    {cl.jugadas.length} jugada(s)
                                  </span>
                                </div>
                              </button>

                              {estaAbierto ? (
                                <div className="border-t border-slate-200 bg-white p-3">
                                  {cl.jugadas.length === 0 ? (
                                    <p className="text-xs text-slate-400 italic text-center py-2">
                                      No hay jugadas registradas para {cl.clienteNombre} desde {cl.fechaInicio}.
                                    </p>
                                  ) : (
                                    <div className="overflow-x-auto">
                                      <table className="w-full text-left text-[11px]">
                                        <thead>
                                          <tr className="border-b border-slate-200 text-slate-500 uppercase text-[9px] font-black">
                                            <th className="py-1">Fecha</th>
                                            <th className="py-1">Hipódromo / Carr.</th>
                                            <th className="py-1">Jugada / Ejemplar</th>
                                            <th className="py-1 text-right">Monto Jugado</th>
                                            <th className="py-1 text-right">% Com.</th>
                                            <th className="py-1 text-right text-purple-700">Comisión Socio</th>
                                            <th className="py-1 text-center">Estado</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                          {cl.jugadas.map((j) => (
                                            <tr key={String(j.id)} className="hover:bg-slate-50">
                                              <td className="py-1 font-mono text-slate-600">{j.fecha}</td>
                                              <td className="py-1 font-bold text-slate-700">
                                                {j.hipodromo} C{j.carrera}
                                              </td>
                                              <td className="py-1 text-slate-800">
                                                <span className="font-semibold">{j.nombreJugada}</span> {j.caballo ? `• #${j.caballo}` : ""}
                                              </td>
                                              <td className="py-1 text-right font-mono text-slate-700">
                                                {formatoMoneda("USD", j.montoJugado)}
                                              </td>
                                              <td className="py-1 text-right font-mono text-slate-500">
                                                {j.comisionPct}%
                                              </td>
                                              <td className="py-1 text-right font-mono font-black text-purple-700">
                                                +{formatoMoneda("USD", j.montoComision)}
                                              </td>
                                              <td className="py-1 text-center">
                                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-bold uppercase">
                                                  {j.estado}
                                                </span>
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </>
              );
            })()
          ) : null}

          <div className="space-y-1">
            {raiz.hijos.map((g, i) => (
              <Nodo key={`g-${i}-${g.titulo}`} nivel={g} devPct={devolucionPct} nivelProf={0} />
            ))}
            {raiz.hijos.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line bg-white p-8 text-center text-slate-400">
                <span className="text-2xl mb-2">📥</span>
                <p className="text-xs font-bold">Sin movimientos registrados.</p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {clienteEstado ? (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => void seleccionar(null)}>
            <span className="mr-1">✕</span> Limpiar
          </Button>
        </div>
      ) : null}
    </div>
  );
}