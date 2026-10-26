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
          <div className="font-mono font-black text-slate-700">{formatoMoneda("USD", nivel.monto)}</div>
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
      {nivel.hijos.map((c, i) => (
        <div key={`${nivelProf}-${i}-${c.titulo}`} className="rounded-xl border border-line px-3 py-2 bg-slate-50" style={{ marginLeft: (nivelProf + 1) * 12 }}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-700">
              <span className="mr-1 text-indigo-500">🏁</span>
              {c.titulo} <span className="font-medium text-slate-400">· {c.subtitulo}</span>
            </span>
            <span className="text-[10px] font-mono font-black text-slate-700">{formatoMoneda("USD", c.monto)}</span>
          </div>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-slate-400 uppercase tracking-wider">
                  <th className="text-left font-black px-2 py-1">Caballo</th>
                  <th className="text-left font-black px-2 py-1">Jugada</th>
                  <th className="text-right font-black px-2 py-1">Jugado</th>
                  <th className="text-right font-black px-2 py-1">Decidido</th>
                  <th className="text-right font-black px-2 py-1 text-purple-600">Devolución</th>
                  <th className="text-right font-black px-2 py-1">Premio</th>
                  <th className="text-left font-black px-2 py-1">Estado</th>
                </tr>
              </thead>
              <tbody>
                {c.jugadas.map((j) => (
                  <tr key={j.id} className="border-t border-line">
                    <td className="px-2 py-1 font-bold text-slate-700">{j.caballo}</td>
                    <td className="px-2 py-1">{j.jugada}</td>
                    <td className="px-2 py-1 text-right font-mono">{formatoMoneda(j.moneda, j.montoJugado)}</td>
                    <td className="px-2 py-1 text-right font-mono font-bold">{formatoMoneda(j.moneda, j.montoDecidido)}</td>
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
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-1 text-[10px] text-slate-400 text-right font-mono font-bold text-purple-600">
            Devolución / Incentivo del día: {formatoMoneda("USD", c.dec ?? 0, 2)}
          </div>
        </div>
      ))}
    </div>
  );
}

function ResumenNivel({ nivel, devPct }: { nivel: NivelAcordeon; devPct: number }) {
  return (
    <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2" style={{ marginLeft: 12 }}>
      {[
        { lbl: "Total decidido", val: nivel.monto, icon: "🪙", color: "text-slate-800", prefijo: "" },
        { lbl: `🎁 Devolución / Incentivo a favor (${devPct}%)`, val: nivel.dec, icon: "🎁", color: "text-emerald-600", prefijo: "+" },
        { lbl: "Saldo Final Cliente (+ Incentivo)", val: nivel.monto + nivel.dec, icon: "🤲", color: "text-emerald-700", prefijo: "" },
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

  const seleccionar = async (c: ClienteRow | null) => {
    onActivo(c);
    if (!c) {
      setRaiz(null);
      setFicha(null);
      return;
    }
    setCargando(true);
    setRaiz(null);
    const pct = parseFloat(String(c.devolucion ?? "")) || 0;
    setDevolucionPct(pct);
    const tickets = await onCargarTickets(c.id);
    const tree = construirEstadoCuenta(tickets, pct);
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
        cliente_juega_id: c.id,
        cliente_juega_nombre: c.nombre ?? c.seudonimo ?? "",
        hipodromo: t.hipodromo,
        carrera: t.carrera,
        fecha_carrera: t.fecha_carrera,
        fecha_registro: t.fecha_registro,
        nombre_jugada: t.nombre_jugada,
        caballo: t.caballo,
        monto_jugado: t.monto_jugado,
        monto_decidido: t.monto_decidido,
        premio_pagar: t.premio_pagar,
        estado: t.estado,
        anulada: t.anulada,
      })),
    });
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
                <div className="text-[9px] font-black uppercase text-emerald-700">6. 🎁 Devolución / Incentivo a favor</div>
                <div className="font-mono font-black text-emerald-700">+{formatoMoneda("USD", ficha.devolucionIncentivo)}</div>
              </div>
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
                <div className="font-mono font-black text-slate-900">{formatoMoneda("USD", ficha.saldoContable)}</div>
              </div>
              <div className="rounded-lg bg-indigo-50 p-2">
                <div className="text-[9px] font-black uppercase text-indigo-700">10. Disponible Total para Apostar</div>
                <div className="font-mono font-black text-indigo-800">
                  {Number.isFinite(ficha.disponibleParaJugar) ? formatoMoneda("USD", ficha.disponibleParaJugar) : "LIBRE"}
                </div>
              </div>
            </div>
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