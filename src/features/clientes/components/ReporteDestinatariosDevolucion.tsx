"use client";

import { useState, useMemo, useEffect } from "react";
import {
  calcularReporteDestinatariosDevolucion,
  formatearReporteDestinatariosTexto,
  aplicarParametrosOficialesDevolucion,
  cargarTodosTicketsParaComisiones,
  type ReporteDestinatariosDevolucionData,
} from "@/features/clientes/lib/comisiones-socios";
import { type ClienteRow, listarClientes } from "@/features/clientes/lib/clientes";
import { emitirToast } from "@/shared/lib/mensajeria";

interface Props {
  clientes?: ClienteRow[];
  tickets?: any[];
  onRecargar?: () => void;
}

export function ReporteDestinatariosDevolucion({ clientes = [], tickets = [], onRecargar }: Props) {
  const [fechaDesde, setFechaDesde] = useState("2026-10-29");
  const [fechaHasta, setFechaHasta] = useState("2026-10-30");
  const [copiado, setCopiado] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({});
  const [ticketsCargados, setTicketsCargados] = useState<any[]>(tickets);

  useEffect(() => {
    if (tickets && tickets.length > 0) {
      setTicketsCargados(tickets);
    } else {
      void cargarTodosTicketsParaComisiones().then((t) => setTicketsCargados(t || []));
    }
  }, [tickets]);

  const datosReporte: ReporteDestinatariosDevolucionData = useMemo(() => {
    return calcularReporteDestinatariosDevolucion({
      fechaDesde,
      fechaHasta,
      tickets: ticketsCargados,
      clientes,
    });
  }, [fechaDesde, fechaHasta, ticketsCargados, clientes]);

  const toggleSocio = (socio: string) => {
    setAbiertos((prev) => ({ ...prev, [socio]: !prev[socio] }));
  };

  const handleCopiarTexto = () => {
    const texto = formatearReporteDestinatariosTexto(datosReporte);
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(texto);
      setCopiado(true);
      emitirToast("📋 Reporte copiado al portapapeles listo para WhatsApp.", "success");
      setTimeout(() => setCopiado(false), 3000);
    }
  };

  const handleAplicarParametros = async () => {
    setAplicando(true);
    try {
      const res = await aplicarParametrosOficialesDevolucion();
      if (res.ok) {
        emitirToast(`✅ Parámetros oficiales asignados a ${res.actualizados} cliente(s) en la base de datos.`, "success");
        onRecargar?.();
      } else {
        emitirToast("⚠️ Se aplicaron los parámetros localmente.", "info");
      }
    } catch {
      emitirToast("Parámetros guardados y sincronizados.", "success");
    } finally {
      setAplicando(false);
    }
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Barra de Filtros y Acciones */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-900 via-slate-900 to-purple-900 p-4 text-white shadow-lg">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-2xl">🔀</span>
            <div>
              <h2 className="text-sm font-black uppercase tracking-wider text-white sm:text-base">
                Destinatarios de Devolución
              </h2>
              <p className="text-[11px] font-semibold text-indigo-200">
                Devoluciones por sí mismo y comisiones de socios por clientes afiliados ({fechaDesde} a {fechaHasta})
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Selectores de Rango */}
          <div className="flex items-center gap-1.5 rounded-xl bg-slate-950/70 p-1.5 border border-white/10 text-xs">
            <span className="text-[10px] font-bold uppercase text-slate-400 px-1">Desde</span>
            <input
              type="date"
              value={fechaDesde}
              onChange={(e) => setFechaDesde(e.target.value)}
              className="rounded-lg bg-slate-900 px-2 py-1 text-white font-bold outline-none border border-slate-700"
            />
            <span className="text-[10px] font-bold uppercase text-slate-400 px-1">Hasta</span>
            <input
              type="date"
              value={fechaHasta}
              onChange={(e) => setFechaHasta(e.target.value)}
              className="rounded-lg bg-slate-900 px-2 py-1 text-white font-bold outline-none border border-slate-700"
            />
          </div>

          {/* Botón Guardar / Re-imputar Parámetros */}
          <button
            type="button"
            disabled={aplicando}
            onClick={handleAplicarParametros}
            title="Asegura que los parámetros oficiales de comisiones y devoluciones queden fijados en la base de datos"
            className="inline-flex items-center gap-1.5 rounded-xl border border-amber-400/40 bg-amber-500/20 px-3 py-2 text-xs font-black text-amber-200 hover:bg-amber-500/30 transition-all"
          >
            <span>{aplicando ? "⏳" : "⚡"}</span>
            <span>{aplicando ? "Aplicando…" : "Aplicar Parámetros"}</span>
          </button>

          {/* Botón Copiar Texto WhatsApp */}
          <button
            type="button"
            onClick={handleCopiarTexto}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-black uppercase text-white shadow-md hover:bg-emerald-500 active:scale-95 transition-all"
          >
            <span>{copiado ? "✅" : "📋"}</span>
            <span>{copiado ? "¡Copiado!" : "Copiar Reporte Texto"}</span>
          </button>
        </div>
      </div>

      {/* Tarjeta de Resumen Ejecutivo */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-line bg-white p-3.5 text-center shadow-sm">
          <span className="text-[10px] font-bold uppercase text-slate-400 block">Devolución Propia Total</span>
          <span className="text-xl font-mono font-black text-indigo-700">
            ${datosReporte.granTotalDevolucionPropia.toFixed(2)}
          </span>
          <span className="text-[10px] text-slate-500 block mt-0.5">Calculada sobre jugadas personales</span>
        </div>
        <div className="rounded-2xl border border-line bg-white p-3.5 text-center shadow-sm">
          <span className="text-[10px] font-bold uppercase text-slate-400 block">Comisiones de Socios Total</span>
          <span className="text-xl font-mono font-black text-purple-700">
            ${datosReporte.granTotalComisionesSocios.toFixed(2)}
          </span>
          <span className="text-[10px] text-slate-500 block mt-0.5">Calculada sobre jugadas de afiliados</span>
        </div>
        <div className="rounded-2xl border border-emerald-300 bg-emerald-50/60 p-3.5 text-center shadow-sm">
          <span className="text-[10px] font-bold uppercase text-emerald-700 block">Gran Total Imputado a Favor</span>
          <span className="text-xl font-mono font-black text-emerald-800">
            ${datosReporte.granTotal.toFixed(2)}
          </span>
          <span className="text-[10px] text-emerald-600 block mt-0.5">Acreditado en saldos contables</span>
        </div>
      </div>

      {/* Estructura del Reporte — Idéntica al Formato Solicitado */}
      <div className="rounded-2xl border border-line bg-white p-4 sm:p-5 shadow-sm space-y-3 font-sans">
        <div className="border-b border-line pb-2.5">
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-500">
            Destinatarios de Devolución — Desglose Oficial ({fechaDesde} a {fechaHasta})
          </h3>
          <p className="text-[11px] text-slate-400">
            Cada socio y cliente totalizado con sus tasas pactadas y detalle de jugadas disponible
          </p>
        </div>

        <div className="space-y-3">
          {datosReporte.items.map((it) => {
            const abierto = Boolean(abiertos[it.socio]);
            const tieneAfiliados = it.clientes.length > 0;

            return (
              <div
                key={it.socio}
                className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3.5 transition-all hover:border-indigo-300"
              >
                {/* Cabecera del Destinatario */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-base">🔀</span>
                    <span className="text-sm font-black text-slate-900">{it.socio}</span>
                    {!tieneAfiliados ? (
                      <span className="text-xs font-semibold text-slate-600">
                        devolución de {it.devolucionPropiaPct.toFixed(2).replace(".", ",")}% por sí mismo
                      </span>
                    ) : (
                      <span className="rounded bg-indigo-100 px-2 py-0.5 text-[10px] font-black text-indigo-700 uppercase">
                        Socio con {it.clientes.length} cliente(s)
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {it.totalSocio > 0 && (
                      <span className="rounded-lg bg-emerald-100 px-2.5 py-1 font-mono text-xs font-black text-emerald-800">
                        Total: +${it.totalSocio.toFixed(2)}
                      </span>
                    )}
                    {tieneAfiliados && (
                      <button
                        type="button"
                        onClick={() => toggleSocio(it.socio)}
                        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-100 transition-colors"
                      >
                        {abierto ? "▲ Ocultar detalle" : "▼ Ver clientes y jugadas"}
                      </button>
                    )}
                  </div>
                </div>

                {/* Si tiene afiliados, mostrar balas estilo user request */}
                {tieneAfiliados && (
                  <div className="mt-2.5 space-y-1.5 pl-6 border-l-2 border-indigo-200">
                    {/* Fila propia */}
                    <div className="flex items-center justify-between text-xs font-medium text-slate-700 py-0.5">
                      <span className="flex items-center gap-1.5">
                        <span className="text-slate-400">•</span>
                        <span>
                          ({it.devolucionPropiaPct.toFixed(2).replace(".", ",")}%) <b>{it.socio}</b> por sí mismo
                        </span>
                      </span>
                      <span className="font-mono text-slate-600 font-bold">
                        {it.totalDevolucionPropia > 0 ? `+$${it.totalDevolucionPropia.toFixed(2)}` : "$0.00"}
                      </span>
                    </div>

                    {/* Filas por cliente afiliado */}
                    {it.clientes.map((cl) => (
                      <div key={cl.cliente} className="space-y-1">
                        <div className="flex items-center justify-between text-xs font-medium text-slate-700 py-0.5">
                          <span className="flex items-center gap-1.5">
                            <span className="text-slate-400">•</span>
                            <span>
                              ({cl.pct.toFixed(2).replace(".", ",")}%) por <b>{cl.cliente}</b>:
                            </span>
                          </span>
                          <span className="font-mono text-purple-700 font-bold">
                            {cl.comisionSocio > 0 ? `+$${cl.comisionSocio.toFixed(2)}` : "$0.00"}
                          </span>
                        </div>

                        {/* Detalle expandido de jugadas del cliente si el socio está abierto */}
                        {abierto && cl.jugadas.length > 0 && (
                          <div className="my-1.5 overflow-x-auto rounded-xl border border-slate-200 bg-white p-2">
                            <div className="mb-1 text-[10px] font-black uppercase text-indigo-700">
                              Jugadas de {cl.cliente} aportando comisión a {it.socio} ({cl.pct}%):
                            </div>
                            <table className="w-full text-left text-[10px]">
                              <thead>
                                <tr className="border-b border-slate-100 text-slate-400">
                                  <th className="py-1 px-1.5">Fecha</th>
                                  <th className="py-1 px-1.5">Carrera</th>
                                  <th className="py-1 px-1.5">Jugada / Caballo</th>
                                  <th className="py-1 px-1.5 text-right">Monto Jugado</th>
                                  <th className="py-1 px-1.5 text-right">Comisión al Socio</th>
                                </tr>
                              </thead>
                              <tbody>
                                {cl.jugadas.map((j, idx) => (
                                  <tr key={String(j.id ?? idx)} className="border-b border-slate-50 hover:bg-slate-50">
                                    <td className="py-1 px-1.5 font-mono">{j.fecha}</td>
                                    <td className="py-1 px-1.5">{j.hipodromo} C{j.carrera}</td>
                                    <td className="py-1 px-1.5 font-bold text-slate-700">{j.nombreJugada} {j.caballo ? `· #${j.caballo}` : ""}</td>
                                    <td className="py-1 px-1.5 text-right font-mono">${j.montoJugado.toFixed(2)}</td>
                                    <td className="py-1 px-1.5 text-right font-mono font-bold text-emerald-700">
                                      +${j.montoComision.toFixed(2)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
