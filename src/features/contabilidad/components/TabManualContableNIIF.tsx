"use client";

import { useState } from "react";

export function TabManualContableNIIF() {
  const [seccionAbierta, setSeccionAbierta] = useState<string>("avalados");

  const toggle = (sec: string) => {
    setSeccionAbierta(seccionAbierta === sec ? "" : sec);
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Encabezado */}
      <div className="rounded-2xl border border-indigo-200 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-5 text-white shadow-md">
        <div className="flex items-center gap-2">
          <span className="text-2xl">📖</span>
          <h2 className="text-base font-black">Manual de Contabilidad NIIF, Partida Doble y Reglas Hípicas</h2>
        </div>
        <p className="mt-1 text-xs text-indigo-200">
          Guía oficial para operadores y administradores: criterios de avalados, desglose de comisiones, inter-grupos Argentina y honorarios.
        </p>
      </div>

      {/* Acordeón de Secciones del Manual */}
      <div className="space-y-3">
        {/* 1. Clientes Avalados */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <button
            type="button"
            onClick={() => toggle("avalados")}
            className="w-full flex items-center justify-between p-4 text-left font-bold text-slate-800 hover:bg-slate-50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="text-lg">⚖️</span>
              <span className="text-sm font-black">1. Tratamiento Contable de Clientes Avalados vs Prepago</span>
            </div>
            <span className="font-mono text-xs text-indigo-600 font-bold">
              {seccionAbierta === "avalados" ? "▲" : "▼"}
            </span>
          </button>
          {seccionAbierta === "avalados" ? (
            <div className="border-t border-slate-100 p-4 text-xs text-slate-700 space-y-3 bg-slate-50/50">
              <p>
                <b>Principio contable:</b> En clientes con modalidad de juego a crédito o aval (<code>modo === "aval"</code>):
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 space-y-1">
                  <div className="font-black text-rose-800 uppercase text-[10px]">
                    📉 Clientes Avalados que Pierden
                  </div>
                  <p className="text-[11px] text-rose-900">
                    Su pérdida genera un <b>derecho de cobro a favor de la casa</b>. Se debita en el Activo:
                  </p>
                  <div className="font-mono font-bold text-[11px] text-rose-950 bg-white/70 p-1 rounded border border-rose-200">
                    DEBE: 1.2.02.001 — Cartera de Avales Otorgados por Cobrar
                  </div>
                </div>

                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 space-y-1">
                  <div className="font-black text-emerald-800 uppercase text-[10px]">
                    📈 Clientes Avalados que Ganan
                  </div>
                  <p className="text-[11px] text-emerald-900">
                    Su ganancia neta representa una <b>obligación exigible a pagar</b>. Se acredita en el Pasivo:
                  </p>
                  <div className="font-mono font-bold text-[11px] text-emerald-950 bg-white/70 p-1 rounded border border-emerald-200">
                    HABER: 2.1.01.003 — Cuentas por Pagar Premios Clientes Avalados
                  </div>
                </div>
              </div>

              <p className="text-[11px] text-slate-500 italic">
                * En clientes regulares (prepago), el movimiento se aplica debitando o acreditando su custodia en la cuenta <b>2.1.01.001 (Depósitos y Saldos Acreedores)</b>.
              </p>
            </div>
          ) : null}
        </div>

        {/* 2. Desglose de Comisiones */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <button
            type="button"
            onClick={() => toggle("comisiones")}
            className="w-full flex items-center justify-between p-4 text-left font-bold text-slate-800 hover:bg-slate-50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="text-lg">📊</span>
              <span className="text-sm font-black">2. Desglose de Ingresos por Comisión según Modalidad</span>
            </div>
            <span className="font-mono text-xs text-indigo-600 font-bold">
              {seccionAbierta === "comisiones" ? "▲" : "▼"}
            </span>
          </button>
          {seccionAbierta === "comisiones" ? (
            <div className="border-t border-slate-100 p-4 text-xs text-slate-700 space-y-2 bg-slate-50/50">
              <p>Cada modalidad de juego asienta sus ingresos por comisión en su respectiva subcuenta:</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
                <div className="p-2 bg-white rounded-lg border border-slate-200 font-mono">
                  <b>4.1.01.001</b>: Cruces y Apuestas Entre Tercios
                </div>
                <div className="p-2 bg-white rounded-lg border border-slate-200 font-mono">
                  <b>4.1.01.002</b>: Comisión Tablas Fijas
                </div>
                <div className="p-2 bg-white rounded-lg border border-slate-200 font-mono">
                  <b>4.1.01.003</b>: Comisión Marcas
                </div>
                <div className="p-2 bg-white rounded-lg border border-slate-200 font-mono">
                  <b>4.1.01.004</b>: Comisión Dupletas
                </div>
                <div className="p-2 bg-white rounded-lg border border-slate-200 font-mono">
                  <b>4.1.01.005</b>: Comisión Pollas y Remates
                </div>
                <div className="p-2 bg-white rounded-lg border border-slate-200 font-mono">
                  <b>4.1.01.006</b>: Comisión Taquilla WPS
                </div>
                <div className="p-2 bg-white rounded-lg border border-slate-200 font-mono">
                  <b>4.1.01.007</b>: Comisión Eventos Especiales y Libres
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* 3. Imputación Inter-Grupos Argentina */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <button
            type="button"
            onClick={() => toggle("argentina")}
            className="w-full flex items-center justify-between p-4 text-left font-bold text-slate-800 hover:bg-slate-50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="text-lg">🇦🇷</span>
              <span className="text-sm font-black">3. Regla de Imputación Inter-Grupos para "Argentina"</span>
            </div>
            <span className="font-mono text-xs text-indigo-600 font-bold">
              {seccionAbierta === "argentina" ? "▲" : "▼"}
            </span>
          </button>
          {seccionAbierta === "argentina" ? (
            <div className="border-t border-slate-100 p-4 text-xs text-slate-700 space-y-3 bg-slate-50/50">
              <p>
                Cuando una venta de Tablas Fijas, Marcas o Dupletas se realiza en otro grupo pero está respaldada por el grupo Argentina:
              </p>
              <div className="space-y-2">
                <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200">
                  <div className="font-bold text-emerald-900">Caso 1: NO Resulta Ganador</div>
                  <div className="text-[11px] text-emerald-800 mt-0.5">
                    La casa retiene la jugada. Todo el monto cobrado se imputa como ganancia neta para Argentina:
                    <br />
                    <code>DEBE: 1.2.03.001 (Cobro a Grupo Origen) / HABER: 4.3.01.002 (Ingreso Venta Argentina)</code>
                  </div>
                </div>

                <div className="p-3 bg-indigo-50 rounded-xl border border-indigo-200">
                  <div className="font-bold text-indigo-900">Caso 2: SI Resulta Ganador</div>
                  <div className="text-[11px] text-indigo-800 mt-0.5">
                    Argentina asume el pago del premio y percibe la recaudación de la jugada:
                    <br />
                    <code>DEBE: 5.2.01.001 (Costo de Premio) / HABER: 2.1.01.001 (Premios por Pagar)</code>
                    <br />
                    <code>DEBE: 1.2.03.001 (Cobro a Grupo Origen) / HABER: 4.3.01.002 (Ingreso Bruto Argentina)</code>
                    <br />
                    <b>Resultado Neto:</b> <code>Monto Cobrado - Premio Pagado</code>.
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* 4. Honorarios del Equipo */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <button
            type="button"
            onClick={() => toggle("honorarios")}
            className="w-full flex items-center justify-between p-4 text-left font-bold text-slate-800 hover:bg-slate-50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="text-lg">👥</span>
              <span className="text-sm font-black">4. Honorarios del Equipo de Trabajo</span>
            </div>
            <span className="font-mono text-xs text-indigo-600 font-bold">
              {seccionAbierta === "honorarios" ? "▲" : "▼"}
            </span>
          </button>
          {seccionAbierta === "honorarios" ? (
            <div className="border-t border-slate-100 p-4 text-xs text-slate-700 space-y-2 bg-slate-50/50">
              <p>
                Cada colaborador cuenta con su ficha identificatoria (Cédula, Rol, Teléfono y Método de Pago).
              </p>
              <div className="space-y-1 text-[11px]">
                <div className="p-2 bg-white rounded border border-slate-200">
                  <b>Desembolso Inmediato (PAGADO):</b> Debe <code>6.1.03.001 (Gastos de Honorarios)</code> / Haber <code>1.1.01.001 (Caja) o 1.1.02.x (Bancos)</code>.
                </div>
                <div className="p-2 bg-white rounded border border-slate-200">
                  <b>Obligación Pendiente (POR PAGAR):</b> Debe <code>6.1.03.001 (Gastos de Honorarios)</code> / Haber <code>2.1.06.001 (Cuentas por Pagar Honorarios)</code>.
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* 5. Motor Asíncrono */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <button
            type="button"
            onClick={() => toggle("asincrono")}
            className="w-full flex items-center justify-between p-4 text-left font-bold text-slate-800 hover:bg-slate-50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="text-lg">⚡</span>
              <span className="text-sm font-black">5. Motor de Actualización Asíncrona en Segundo Plano</span>
            </div>
            <span className="font-mono text-xs text-indigo-600 font-bold">
              {seccionAbierta === "asincrono" ? "▲" : "▼"}
            </span>
          </button>
          {seccionAbierta === "asincrono" ? (
            <div className="border-t border-slate-100 p-4 text-xs text-slate-700 space-y-2 bg-slate-50/50">
              <p>
                Al pagar carreras en taquilla o resolver eventos, la plataforma actualiza los estados de tickets al instante y <b>encola las transacciones contables en background</b>.
              </p>
              <p className="text-[11px] text-slate-600">
                Esto garantiza que la interfaz de usuario nunca sufra demoras ni congelamientos, mientras los asientos de partida doble se registran de forma confiable e idempotente en el Libro Diario.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
