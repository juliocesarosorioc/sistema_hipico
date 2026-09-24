"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  construirEstadoCuenta,
  type ClienteRow,
  type NivelAcordeon,
  type TicketApuesta,
} from "@/lib/clientes";
import { formatoMoneda } from "@/lib/vzla";

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
          <i className={`fas fa-chevron-right text-[10px] text-slate-400 transition-transform ${abierto ? "rotate-90" : ""}`}></i>
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
              <i className="fas fa-flag-checkered mr-1 text-indigo-500"></i>
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
        { lbl: "Total decidido", val: nivel.monto, icon: "fa-coins", color: "text-slate-800" },
        { lbl: `Devolución / Incentivo (${devPct}%)`, val: nivel.dec, icon: "fa-percent", color: "text-purple-600" },
        { lbl: "Disponible (mínimo a cubrir)", val: nivel.monto - nivel.dec, icon: "fa-hand-holding-dollar", color: "text-emerald-600" },
      ].map((k) => (
        <div key={k.lbl} className="rounded-xl border border-line bg-white px-4 py-3 flex items-center gap-3">
          <i className={`fas ${k.icon} ${k.color} text-lg`}></i>
          <div>
            <div className="text-[9px] font-black uppercase tracking-wider text-slate-400">{k.lbl}</div>
            <div className={`text-sm font-black ${k.color}`}>{formatoMoneda("USD", k.val)}</div>
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

  const seleccionar = async (c: ClienteRow | null) => {
    onActivo(c);
    if (!c) {
      setRaiz(null);
      return;
    }
    setCargando(true);
    setRaiz(null);
    const pct = parseFloat(String(c.devolucion ?? "")) || 0;
    setDevolucionPct(pct);
    const tickets = await onCargarTickets(c.id);
    const tree = construirEstadoCuenta(tickets, pct);
    setRaiz(tree);
    setTotales({ monto: tree.monto, dec: tree.dec });
    setCargando(false);
  };

  useEffect(() => {
    void seleccionar(clienteEstado ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteEstado?.id ?? null]);

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

      {!clienteEstado ? (
        <div className="rounded-2xl border border-dashed border-line bg-white/60 p-10 text-center text-slate-400">
          <i className="fas fa-list-alt text-3xl mb-2"></i>
          <p className="text-xs font-bold">Seleccione un cliente para construir su estado de cuenta.</p>
        </div>
      ) : cargando ? (
        <div className="rounded-2xl border border-line bg-white p-10 text-center text-slate-500">
          <i className="fas fa-spinner fa-spin mr-2"></i> Construyendo estado de cuenta…
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
              <div className="text-[9px] text-slate-300 uppercase">Totales</div>
              <div className="text-sm font-black">{formatoMoneda("USD", totales.monto)}</div>
              <div className="text-[10px] font-bold text-purple-300">- {formatoMoneda("USD", totales.dec)}</div>
            </div>
          </div>

          <div className="space-y-1">
            {raiz.hijos.map((g, i) => (
              <Nodo key={`g-${i}-${g.titulo}`} nivel={g} devPct={devolucionPct} nivelProf={0} />
            ))}
            {raiz.hijos.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line bg-white p-8 text-center text-slate-400">
                <i className="fas fa-inbox text-2xl mb-2"></i>
                <p className="text-xs font-bold">Sin movimientos registrados.</p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {clienteEstado ? (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => void seleccionar(null)}>
            <i className="fas fa-times mr-1"></i> Limpiar
          </Button>
        </div>
      ) : null}
    </div>
  );
}